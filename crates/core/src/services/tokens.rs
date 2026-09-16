//! skill 的 token 体量估算。
//!
//! 用来回答"启用这一组 / 这个项目，大概会吃掉多少上下文"。**是估算，不是精确值**：
//! Claude 的分词器没有离线实现，硬塞一份 tiktoken 词表也解决不了它与中文的差异，
//! 所以这里按字符类别近似。混排文本上误差大致在 ±20%，足够判断量级。

use std::fs;
use std::path::Path;

use crate::models::skill::TokenEstimate;

use super::scanner::{is_symlink_or_junction, COPY_SIDECAR, SKILL_FILE};

/// 与 `scanner::MAX_SCAN_DEPTH` 同一量级：够深的 references 树，又不至于被
/// 恶意深目录拖住。超出就停在这一层，不报错 —— 估算不该让整次扫描失败。
const MAX_DEPTH: usize = 16;

/// CJK 表意文字、假名、韩文音节、全角标点 —— 这些在主流 BPE 分词器里
/// 基本是一个字一个 token，和拉丁文本"约 4 字符 1 token"完全不是一个量纲。
fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3000..=0x303F      // CJK 标点（，。、「」）
            | 0x3040..=0x30FF // 平假名 / 片假名
            | 0x3400..=0x4DBF // CJK 扩展 A
            | 0x4E00..=0x9FFF // CJK 基本区
            | 0xAC00..=0xD7AF // 韩文音节
            | 0xF900..=0xFAFF // 兼容表意文字
            | 0xFF00..=0xFFEF // 全角形式
    )
}

/// 估算一段文本的 token 数：CJK 每字算 1 个，其余按 4 字符 1 个向上取整。
pub fn estimate_text(text: &str) -> u32 {
    let (mut cjk, mut other) = (0usize, 0usize);
    for ch in text.chars() {
        if is_cjk(ch) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    u32::try_from(cjk + other.div_ceil(4)).unwrap_or(u32::MAX)
}

/// 估算一个 skill 目录的 token 体量，分成两半：
///
/// - `skill_md`：`SKILL.md`（含 frontmatter），被调用时必然进上下文的部分
/// - `extras`：`references/`、`scripts/` 等**文本**附带文件，agent 按需打开
///
/// 跳过的东西：二进制文件（图片、压缩包 —— 按 UTF-8 解不出来就算二进制）、
/// 隐藏文件与隐藏目录、我们自己的复制边车、符号链接（不跟随，免得循环或把
/// 同一份内容数两遍）。任何读取错误都按 0 处理，估算不该让扫描失败。
pub fn estimate_skill(dir: &Path) -> TokenEstimate {
    TokenEstimate {
        skill_md: estimate_file(&dir.join(SKILL_FILE)),
        extras: walk_extras(dir, 0),
    }
}

/// 读一个文件并估算；读不到或不是 UTF-8 文本，都算 0。
fn estimate_file(path: &Path) -> u32 {
    match fs::read(path) {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => estimate_text(&text),
            Err(_) => 0,
        },
        Err(_) => 0,
    }
}

fn walk_extras(dir: &Path, depth: usize) -> u32 {
    if depth > MAX_DEPTH {
        return 0;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut total: u32 = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // 隐藏文件/目录（.git、.DS_Store）与复制边车都不是 skill 内容
        if name.starts_with('.') || name == COPY_SIDECAR {
            continue;
        }
        // 链接不跟随：可能成环，也可能把已经数过的内容再数一遍
        if is_symlink_or_junction(&path) {
            continue;
        }
        let Ok(meta) = path.symlink_metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(walk_extras(&path, depth + 1));
        } else if meta.is_file() && !(depth == 0 && name == SKILL_FILE) {
            total = total.saturating_add(estimate_file(&path));
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_is_zero() {
        assert_eq!(estimate_text(""), 0);
    }

    #[test]
    fn ascii_rounds_up_at_four_chars_per_token() {
        assert_eq!(estimate_text("abcd"), 1);
        // 5 个字符不该被截成 1 —— 宁可略高，不要让用户以为更省
        assert_eq!(estimate_text("abcde"), 2);
    }

    #[test]
    fn cjk_counts_one_token_per_char() {
        assert_eq!(estimate_text("中文测试"), 4);
        // 全角标点同样按 1 个字算
        assert_eq!(estimate_text("你好，世界。"), 6);
    }

    #[test]
    fn mixed_text_counts_each_class_separately() {
        // "hello " 6 个非 CJK 字符 → 2，"中文" → 2
        assert_eq!(estimate_text("hello 中文"), 4);
    }

    #[test]
    fn splits_skill_md_from_bundled_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SKILL_FILE), "中文正文").unwrap();
        fs::create_dir(dir.path().join("references")).unwrap();
        fs::write(dir.path().join("references/a.md"), "abcdefgh").unwrap();
        // 根目录下除 SKILL.md 之外的文本文件同样算附带
        fs::write(dir.path().join("notes.txt"), "中").unwrap();

        let est = estimate_skill(dir.path());
        assert_eq!(est.skill_md, 4);
        // references/a.md 8 个 ASCII → 2，notes.txt 一个汉字 → 1
        assert_eq!(est.extras, 3);
        assert_eq!(est.total(), 7);
    }

    #[test]
    fn skips_binaries_hidden_entries_and_the_copy_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SKILL_FILE), "abcd").unwrap();
        // 非 UTF-8：当二进制处理，不计
        fs::write(dir.path().join("logo.png"), [0xff, 0xd8, 0xff, 0xe0, 0x00]).unwrap();
        fs::write(dir.path().join(COPY_SIDECAR), "x".repeat(400)).unwrap();
        fs::write(dir.path().join(".DS_Store"), "x".repeat(400)).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/objects"), "x".repeat(400)).unwrap();

        let est = estimate_skill(dir.path());
        assert_eq!(est.skill_md, 1);
        assert_eq!(est.extras, 0);
    }

    #[test]
    fn does_not_follow_links_so_content_is_never_counted_twice() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SKILL_FILE), "abcd").unwrap();
        fs::create_dir(dir.path().join("references")).unwrap();
        fs::write(dir.path().join("references/real.md"), "abcd").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            dir.path().join("references/real.md"),
            dir.path().join("references/alias.md"),
        )
        .unwrap();

        let est = estimate_skill(dir.path());
        assert_eq!(est.extras, 1, "别名不该让同一份内容被数两遍");
    }

    #[test]
    fn missing_skill_md_is_zero_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(estimate_skill(dir.path()), TokenEstimate::default());
    }
}
