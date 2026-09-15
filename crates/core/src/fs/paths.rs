//! 路径解析与比较。移植自 cc-switch `src-tauri/src/config.rs`，
//! 并补上了它没有的 `paths_overlap`（含悬空 symlink 处理）。

use std::path::{Component, Path, PathBuf};

/// 测试用的 HOME 覆盖。**必须**存在这个逃生阀：Windows 上 `dirs::home_dir()` 走
/// `SHGetKnownFolderPath(FOLDERID_Profile)`，不受 `HOME` / `USERPROFILE` 影响，
/// 测试无法隔离真实用户目录。
pub const TEST_HOME_ENV: &str = "SKILL_STUDIO_TEST_HOME";

/// 应用自己的目录名（放在 home 下）
pub const APP_DIR_NAME: &str = ".skill-studio";

/// 获取用户主目录。
///
/// - 用 `dirs::home_dir()`，它在 Windows 上走 Known Folder API，结果稳定。
/// - **不要直接读 `HOME` 环境变量**：它可能由 Git / Cygwin / MSYS 等第三方工具注入，
///   不一定等于用户目录，会让配置路径漂移，表现出来就像"数据丢失"。
/// - 需要在测试或 CI 里隔离时，用 `SKILL_STUDIO_TEST_HOME` 显式覆盖。
pub fn home_dir() -> PathBuf {
    if let Ok(home) = std::env::var(TEST_HOME_ENV) {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    dirs::home_dir().unwrap_or_else(|| {
        log::warn!("无法获取用户主目录，回退到当前目录");
        PathBuf::from(".")
    })
}

/// 应用配置目录 `~/.skill-studio`
pub fn config_dir() -> PathBuf {
    home_dir().join(APP_DIR_NAME)
}

/// 配置文件 `~/.skill-studio/config.json`
pub fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

/// Hub 模式下 skill 真身所在 `~/.skill-studio/skills`
pub fn hub_skills_dir() -> PathBuf {
    config_dir().join("skills")
}

/// 配置备份目录
pub fn backups_dir() -> PathBuf {
    config_dir().join("backups")
}

/// 读取环境变量指定的目录覆盖（如 `CLAUDE_CONFIG_DIR` / `CODEX_HOME`）。
/// 空字符串视为未设置。
pub fn env_dir_override(var: &str) -> Option<PathBuf> {
    std::env::var(var).ok().and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    })
}

/// 纯词法归一化：不触碰文件系统，因此对不存在的路径同样有效。
/// `.` 被丢弃，`..` 在可能时回退一级。
pub fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

/// 可比较的路径键：归一化 + Windows 上统一分隔符并忽略大小写 + 去掉尾部斜杠。
pub fn comparable_path_key(path: &Path) -> String {
    let mut key = normalize_path_lexically(path).to_string_lossy().to_string();

    #[cfg(windows)]
    {
        key = key.replace('\\', "/");
    }

    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }

    #[cfg(windows)]
    {
        key.make_ascii_lowercase();
    }

    key
}

/// `path` 是否位于 `base` 之内（含相等）。
///
/// 这**不是** symlink 防线：`base` 内的一个 symlink 仍可把解析结果指到外面。
/// 后续真要打开文件的调用方必须先 `canonicalize()` 再重新校验包含关系。
pub fn path_is_within(base: &Path, path: &Path) -> bool {
    let base_key = comparable_path_key(base);
    let path_key = comparable_path_key(path);
    if path_key == base_key {
        return true;
    }
    let prefix = if base_key.ends_with('/') {
        base_key
    } else {
        format!("{base_key}/")
    };
    path_key.starts_with(&prefix)
}

/// 两个路径是否指向同一个目标（解析 symlink 后比较）。
pub fn paths_alias(left: &Path, right: &Path) -> bool {
    if comparable_path_key(left) == comparable_path_key(right) {
        return true;
    }
    matches!(
        (left.canonicalize(), right.canonicalize()),
        (Ok(l), Ok(r)) if l == r
    )
}

/// 把"父目录解析 + 末段拼回"的方式得到一个可比较的条目路径。
///
/// `canonicalize()` 会跟随最后一段，因此对**悬空 symlink** 直接失败。分别解析父目录
/// 再拼上文件名，才能保证两个互为别名的根不会删掉同一个目录项。
fn canonical_entry(path: &Path) -> Option<PathBuf> {
    let parent = path.parent()?;
    let name = path.file_name()?;
    Some(parent.canonicalize().ok()?.join(name))
}

/// 两个目录是否重叠（相同、互为别名，或一方在另一方内部）。
/// Hub 目录与任何 agent 的 skills 目录重叠时必须拒绝，否则同步会自己吃自己。
pub fn paths_overlap(left: &Path, right: &Path) -> bool {
    if paths_alias(left, right) {
        return true;
    }
    if path_is_within(left, right) || path_is_within(right, left) {
        return true;
    }
    match (canonical_entry(left), canonical_entry(right)) {
        (Some(l), Some(r)) => {
            paths_alias(&l, &r) || path_is_within(&l, &r) || path_is_within(&r, &l)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    fn normalize_drops_curdir_and_pops_parentdir() {
        assert_eq!(
            normalize_path_lexically(Path::new("/a/./b/../c")),
            PathBuf::from("/a/c")
        );
        // 无处可退时保留 ..，避免把相对路径悄悄变成绝对语义
        assert_eq!(
            normalize_path_lexically(Path::new("../x")),
            PathBuf::from("../x")
        );
    }

    #[test]
    fn comparable_key_strips_trailing_separator() {
        assert_eq!(
            comparable_path_key(Path::new("/a/b/")),
            comparable_path_key(Path::new("/a/b"))
        );
    }

    #[test]
    fn path_is_within_matches_self_and_children_only() {
        let base = Path::new("/home/u/.claude/skills");
        assert!(path_is_within(base, base));
        assert!(path_is_within(
            base,
            Path::new("/home/u/.claude/skills/pdf")
        ));
        assert!(!path_is_within(base, Path::new("/home/u/.claude")));
        // 前缀相同但不是子目录，不能误判
        assert!(!path_is_within(
            base,
            Path::new("/home/u/.claude/skills-backup")
        ));
    }

    #[test]
    fn path_is_within_rejects_parent_traversal() {
        let base = Path::new("/home/u/.claude/skills");
        assert!(!path_is_within(
            base,
            Path::new("/home/u/.claude/skills/../../evil")
        ));
    }

    #[test]
    #[serial]
    fn home_dir_honors_test_override() {
        // 该用例独占进程环境变量，靠 serial_test 串行化
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var(TEST_HOME_ENV, dir.path());
        assert_eq!(home_dir(), dir.path());
        assert_eq!(config_dir(), dir.path().join(APP_DIR_NAME));
        std::env::remove_var(TEST_HOME_ENV);
    }

    #[test]
    #[serial]
    fn env_dir_override_treats_blank_as_unset() {
        std::env::set_var("SKILL_STUDIO_BLANK_TEST", "   ");
        assert!(env_dir_override("SKILL_STUDIO_BLANK_TEST").is_none());
        std::env::remove_var("SKILL_STUDIO_BLANK_TEST");
    }

    #[test]
    fn paths_overlap_detects_nesting_and_identity() {
        assert!(paths_overlap(Path::new("/a/b"), Path::new("/a/b")));
        assert!(paths_overlap(Path::new("/a"), Path::new("/a/b")));
        assert!(!paths_overlap(Path::new("/a/b"), Path::new("/a/c")));
    }

    #[cfg(unix)]
    #[test]
    fn paths_overlap_detects_symlinked_root() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(paths_overlap(&real, &link));
    }

    #[cfg(unix)]
    #[test]
    fn paths_overlap_handles_dangling_symlink() {
        // canonicalize() 对悬空链接会失败，canonical_entry 靠解析父目录兜住
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");
        let dangling = dir.path().join("dangling");
        std::os::unix::fs::symlink(&missing, &dangling).unwrap();
        assert!(dangling.symlink_metadata().is_ok());
        assert!(dangling.canonicalize().is_err());
        // 不同条目名，不应误判为重叠
        assert!(!paths_overlap(&dangling, &dir.path().join("other")));
        // 同一条目，应判为重叠
        assert!(paths_overlap(&dangling, &dangling));
    }
}
