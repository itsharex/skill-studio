//! skill 的 token 体量估算。
//!
//! 用来回答"启用这一组 / 这个项目，大概会吃掉多少上下文"。**是估算，不是精确值**：
//! Claude 的分词器没有离线实现，硬塞一份 tiktoken 词表也解决不了它与中文的差异，
//! 所以这里按字符类别近似。拉丁 + 汉字的混排文本误差大致在 ±20%，足够判断量级；
//! 其余文字（西里尔、泰文、阿拉伯、天城文……）只有"每 2 字符 1 token"这一刀切，
//! 误差更大，但不会像按 4 字符算那样成倍低估。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::models::skill::TokenEstimate;

use super::scanner::{is_symlink_or_junction, MAX_SCAN_DEPTH, SKILL_FILE};

/// CJK 表意文字、假名、韩文音节、注音、部首、全角标点 —— 这些在主流 BPE 分词器里
/// 基本是一个字一个 token，和拉丁文本"约 4 字符 1 token"完全不是一个量纲。
///
/// 范围取得比"常用汉字"宽：扩展 B（U+20000 起）里都是真汉字，漏掉它们等于把一个字
/// 当成 0.25 个 token，量级就错了。
fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        // 一整段连着取：部首扩展、康熙部首、CJK 标点、假名、注音、扩展 A、基本区
        0x2E80..=0xA4CF
            | 0xAC00..=0xD7AF   // 韩文音节
            | 0xF900..=0xFAFF   // 兼容表意文字
            | 0xFE30..=0xFE4F   // CJK 兼容形式（竖排标点）
            | 0xFF00..=0xFFEF   // 全角形式
            | 0x20000..=0x3FFFF // 扩展 B 及以上
    )
}

/// 估算一段文本的 token 数：CJK 每字 1 个，其余非 ASCII 每 2 字符 1 个，
/// ASCII 每 4 字符 1 个 —— 三档各自向上取整，宁可略高。
pub fn estimate_text(text: &str) -> u32 {
    let (mut cjk, mut other_script, mut ascii) = (0usize, 0usize, 0usize);
    for ch in text.chars() {
        if is_cjk(ch) {
            cjk += 1;
        } else if ch.is_ascii() {
            ascii += 1;
        } else {
            // 非 ASCII 又非 CJK 的文字（西里尔、泰文、阿拉伯……）在 BPE 下一个字符
            // 往往占 1~2 个 token，按 ASCII 的 4 字符 1 token 算会低估 2~4 倍
            other_script += 1;
        }
    }
    u32::try_from(cjk + other_script.div_ceil(2) + ascii.div_ceil(4)).unwrap_or(u32::MAX)
}

/// 估算一个 skill 目录的 token 体量，分成两半：
///
/// - `skill_md`：`SKILL.md`（含 frontmatter），被调用时必然进上下文的部分
/// - `extras`：`references/`、`scripts/` 等**文本**附带文件，agent 按需打开
///
/// 不计的东西：读不出文本的文件（图片、压缩包）、隐藏文件与隐藏目录 —— 复制边车
/// 以点开头，同一条规则就挡住了。任何读取错误都按 0 处理，估算不该让扫描失败。
///
/// 链接的口径与 `scanner::dir_content_hash` 那条遍历一致：
/// - **文件软链跟随**：`SKILL.md` 自己就可能是软链，那是必须算上的部分
/// - **目录软链不进入**：跟进去要处理环和内部别名
///
/// 两条各有代价，都是已知边界：目录软链指向的内容一律不计（少见）；目录内部指向
/// 文件的别名会被数两遍（同样少见，且宁可高估 —— 报少了会让人以为还有余量）。
pub fn estimate_skill(dir: &Path) -> TokenEstimate {
    TokenEstimate {
        skill_md: estimate_file(&skill_file(dir)),
        extras: walk_extras(dir, 0),
    }
}

/// 找出目录里的 `SKILL.md`，允许大小写不同。
///
/// macOS/Windows 的文件系统大小写不敏感，`dir.join(SKILL_FILE)` 本来就能读到
/// `skill.md`，Linux 上读不到。两边都按大小写不敏感找，同一个目录才会在各平台给出
/// 同样的拆分 —— 否则正文要么被数两遍（不敏感的系统上既进 `skill_md` 又进
/// `extras`），要么整份掉进 `extras`（Linux）。
fn skill_file(dir: &Path) -> PathBuf {
    let exact = dir.join(SKILL_FILE);
    if exact.is_file() {
        return exact;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return exact;
    };
    entries
        .flatten()
        .find(|e| is_skill_file_name(&e.file_name().to_string_lossy()))
        .map(|e| e.path())
        .unwrap_or(exact)
}

/// 正文的判定必须只有一处：`skill_file` 与 `walk_extras` 用同一把尺子，
/// 才不会一边把 `skill.md` 当正文读、另一边又把它当附带文件再数一遍。
fn is_skill_file_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(SKILL_FILE)
}

/// 读一个文件并估算。认 UTF-8，也认**带 BOM** 的 UTF-16LE/BE —— Windows 记事本存的
/// `.md` 就是后者，按 UTF-8 解不出来，以前一律当二进制算 0，和"跳过了一张图"分不开。
///
/// 已知边界：不带 BOM 的 UTF-16 不猜（会把二进制误判成文本），GBK / Big5 要引
/// encoding_rs 才能解，这里仍按不可读算 0。读不到也算 0。
fn estimate_file(path: &Path) -> u32 {
    // metadata 跟随软链：非目录目标也可能是 FIFO / 设备节点，不能直接读取。
    // 放在共同入口，SKILL.md 本身是软链时也走同样的检查。
    if !fs::metadata(path).is_ok_and(|meta| meta.is_file()) {
        return 0;
    }
    // Estimates are bounded per file; attachments can include multi-GB datasets.
    let Ok(file) = fs::File::open(path) else {
        return 0;
    };
    let mut bytes = Vec::new();
    if file.take(1024 * 1024).read_to_end(&mut bytes).is_err() {
        return 0;
    }

    match bytes.as_slice() {
        [0xFF, 0xFE, rest @ ..] => estimate_text(&decode_utf16(rest, u16::from_le_bytes)),
        [0xFE, 0xFF, rest @ ..] => estimate_text(&decode_utf16(rest, u16::from_be_bytes)),
        _ => std::str::from_utf8(&bytes).map(estimate_text).unwrap_or(0),
    }
}

/// 手工解 UTF-16（不为此引依赖）。只是要数字符，`from_utf16_lossy` 把落单的代理项
/// 换成 U+FFFD 正好够用；奇数长度的尾字节丢掉。
fn decode_utf16(bytes: &[u8], unit: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| unit(*pair))
        .collect();
    String::from_utf16_lossy(&units)
}

fn walk_extras(dir: &Path, depth: usize) -> u32 {
    // 超出上限就停在这一层、不报错：估算不该让整次扫描失败
    if depth > MAX_SCAN_DEPTH {
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
        // 隐藏文件/目录（.git、.DS_Store）不是 skill 内容；复制边车叫
        // `.skill-studio-copy.json`，也以点开头，同一条规则就挡住了
        if name.starts_with('.') {
            continue;
        }
        let is_link = is_symlink_or_junction(&path);
        // 目录软链不进入 —— 见 `estimate_skill` 的口径说明
        if is_link && path.is_dir() {
            continue;
        }
        let Ok(meta) = path.symlink_metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(walk_extras(&path, depth + 1));
        } else if (meta.is_file() || is_link) && !(depth == 0 && is_skill_file_name(&name)) {
            // 普通文件和软链交给 estimate_file；它会检查最终目标，跳过特殊文件。
            total = total.saturating_add(estimate_file(&path));
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::scanner::COPY_SIDECAR;

    /// 建目录别名：unix 用软链，Windows 用 junction。`mklink /J` 不需要特权，
    /// 目录 symlink 需要开发者模式 —— CI 上不保证有。
    fn link_dir(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                // mklink 把正斜杠当开关，即使它出现在路径中间。
                .arg(link.as_os_str().to_string_lossy().replace('/', "\\"))
                .arg(target.as_os_str().to_string_lossy().replace('/', "\\"))
                .stdout(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "mklink /J 建 junction 失败");
        }
    }

    /// 建文件别名，建不出来返回 false。Windows 上文件 symlink 需要开发者模式或
    /// 管理员权限，而 junction 只能指目录 —— 没有免特权的等价物，只能跳过。
    fn link_file(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).unwrap();
            true
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(target, link).is_ok()
        }
    }

    /// 造带 BOM 的 UTF-16 字节序列 —— Windows 记事本存 `.md` 就是这个样子
    fn utf16_with_bom(text: &str, little_endian: bool) -> Vec<u8> {
        let mut out = Vec::from(if little_endian {
            [0xFF, 0xFE]
        } else {
            [0xFE, 0xFF]
        });
        for unit in text.encode_utf16() {
            let pair = if little_endian {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            };
            out.extend_from_slice(&pair);
        }
        out
    }

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
    fn rare_cjk_blocks_also_count_one_token_per_char() {
        // 扩展 B（U+20000 起）是真汉字，人名、方言、古籍里都有；按 4 字符 1 token
        // 算等于把一个字当成 0.25 个 token
        assert_eq!(estimate_text("𠀋𠂉𠃌𡃁"), 4);
        // 注音 U+3105、康熙部首 U+2F00、带圈 CJK U+3231、兼容形式 U+FE30
        assert_eq!(estimate_text("ㄅ⼀㈱︰"), 4);
    }

    #[test]
    fn other_scripts_count_two_chars_per_token() {
        // 西里尔 6 字符 → 3；按 ASCII 的 4 字符 1 token 算只有 2，低估一半
        assert_eq!(estimate_text("Привет"), 3);
        // 阿拉伯 5 字符 → 3（向上取整）
        assert_eq!(estimate_text("مرحبا"), 3);
        // 泰文 4 字符 → 2
        assert_eq!(estimate_text("ภาษา"), 2);
    }

    #[test]
    fn mixed_text_counts_each_class_separately() {
        // "hello " 6 个 ASCII → 2，"中文" → 2
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
    fn lowercase_skill_md_is_still_the_body_not_an_extra() {
        let dir = tempfile::tempdir().unwrap();
        // 只写小写：macOS/Windows 的文件系统大小写不敏感，`join("SKILL.md")` 照样
        // 读得到，于是正文既进 skill_md 又进 extras；Linux 上则整份掉进 extras
        fs::write(dir.path().join("skill.md"), "abcdefgh").unwrap();

        let est = estimate_skill(dir.path());
        assert_eq!(est.skill_md, 2, "小写文件名也是正文");
        assert_eq!(est.extras, 0, "正文不该同时算进附带文件");
    }

    #[test]
    fn skips_binaries_and_dotfiles_including_the_copy_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SKILL_FILE), "abcd").unwrap();
        // 既不是 UTF-8 也没有 UTF-16 BOM：当二进制处理，不计
        fs::write(dir.path().join("logo.png"), [0x89, 0x50, 0x4E, 0x47, 0x00]).unwrap();
        fs::write(dir.path().join(".DS_Store"), "x".repeat(400)).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/objects"), "x".repeat(400)).unwrap();
        // 边车没有单独的判断，它是以点开头才被挡住的
        assert!(COPY_SIDECAR.starts_with('.'), "边车靠 dotfile 规则挡住");
        fs::write(dir.path().join(COPY_SIDECAR), "x".repeat(400)).unwrap();

        let est = estimate_skill(dir.path());
        assert_eq!(est.skill_md, 1);
        assert_eq!(est.extras, 0);
    }

    #[test]
    fn utf16_with_a_bom_is_text_not_binary() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SKILL_FILE), "abcd").unwrap();
        fs::create_dir(dir.path().join("references")).unwrap();
        fs::write(
            dir.path().join("references/le.md"),
            utf16_with_bom("中文正文", true),
        )
        .unwrap();
        fs::write(
            dir.path().join("references/be.md"),
            utf16_with_bom("中文", false),
        )
        .unwrap();

        // 4 + 2 个汉字；算 0 就和"跳过了一张图"分不出来了
        assert_eq!(estimate_skill(dir.path()).extras, 6);
    }

    #[test]
    fn directory_links_are_not_entered() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("big.md"), "abcd".repeat(100)).unwrap();
        fs::write(dir.path().join(SKILL_FILE), "abcd").unwrap();
        fs::create_dir(dir.path().join("references")).unwrap();
        fs::write(dir.path().join("references/real.md"), "abcd").unwrap();
        link_dir(outside.path(), &dir.path().join("references/ext"));

        // 目录软链指向的内容不计：`dir_content_hash` 那条遍历也不进入
        assert_eq!(estimate_skill(dir.path()).extras, 1);
    }

    #[test]
    fn file_links_are_followed() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("body.md"), "中文").unwrap();
        fs::create_dir(dir.path().join("references")).unwrap();
        fs::write(dir.path().join("references/real.md"), "abcd").unwrap();
        // SKILL.md 自己就可能是软链（真身在 hub 里），那是必须算上的部分
        if !link_file(
            &outside.path().join("body.md"),
            &dir.path().join(SKILL_FILE),
        ) {
            eprintln!("跳过：本机建不了文件软链（Windows 需开发者模式/管理员）");
            return;
        }
        assert!(link_file(
            &dir.path().join("references/real.md"),
            &dir.path().join("references/alias.md"),
        ));

        let est = estimate_skill(dir.path());
        assert_eq!(est.skill_md, 2, "软链的 SKILL.md 必须计入");
        // 内部的文件别名会被数两遍 —— 已知代价，宁可高估不低估
        assert_eq!(est.extras, 2, "文件软链跟随");
    }

    #[cfg(unix)]
    #[test]
    fn fifo_links_are_skipped_without_blocking() {
        let dir = tempfile::tempdir().unwrap();
        let pipe = dir.path().join("pipe");
        assert!(std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap()
            .success());
        fs::write(dir.path().join(SKILL_FILE), "abcd").unwrap();
        fs::write(dir.path().join("notes.md"), "abcd").unwrap();
        assert!(link_file(&pipe, &dir.path().join("reference")));

        // 无写入方的 FIFO 一旦被读取就会挂起；超时让回归以失败结束而非卡住测试。
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let extras = estimate_skill(dir.path());
            fs::remove_file(dir.path().join(SKILL_FILE)).unwrap();
            assert!(link_file(&pipe, &dir.path().join(SKILL_FILE)));
            let body = estimate_skill(dir.path());
            tx.send((extras, body)).unwrap();
        });
        let (extras, body) = rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("估算不能阻塞在 FIFO 软链上");
        assert_eq!(
            extras,
            TokenEstimate {
                skill_md: 1,
                extras: 1
            }
        );
        assert_eq!(
            body,
            TokenEstimate {
                skill_md: 0,
                extras: 1
            }
        );
    }

    #[test]
    fn stops_at_the_shared_scan_depth_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut deep = dir.path().to_path_buf();
        // 每层放一个 1 token 的文件，比上限多挖两层：上限以内的层都要算到
        for _ in 0..MAX_SCAN_DEPTH + 2 {
            deep = deep.join("d");
            fs::create_dir(&deep).unwrap();
            fs::write(deep.join("f.md"), "abcd").unwrap();
        }

        // 深度上限只有一份（`scanner::MAX_SCAN_DEPTH`），这里跟着它走：
        // 谁把它改了，这个断言会一起动，不会留下第二个偷偷失效的字面量
        let est = estimate_skill(dir.path());
        assert_eq!(est.extras, u32::try_from(MAX_SCAN_DEPTH).unwrap());
    }

    #[test]
    fn missing_skill_md_is_zero_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(estimate_skill(dir.path()), TokenEstimate::default());
    }
}

#[cfg(test)]
mod audit_regressions {
    use super::*;
    #[test]
    fn oversized_attachment_estimation_is_bounded() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("large.txt");
        fs::write(&path, vec![b'a'; 2 * 1024 * 1024]).unwrap();
        assert!(estimate_file(&path) <= 1024 * 1024 / 4);
    }
}
