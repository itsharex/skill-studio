//! 原子写入。移植自 cc-switch `src-tauri/src/config.rs`，并补上它缺的
//! `file.sync_all()` —— 否则断电时 rename 可能先于数据落盘。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::{Error, Result};

/// 临时文件名冲突时的最大重试次数
const MAX_TEMP_ATTEMPTS: usize = 16;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 递归按字母序排列 JSON 的 key，让输出确定性 —— 便于 diff 与备份比对。
pub fn sort_json_keys(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted = Map::new();
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), sort_json_keys(&map[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_json_keys).collect()),
        other => other.clone(),
    }
}

/// 读取 JSON 文件。文件不存在时返回 `Ok(None)`，便于首次启动走默认值。
pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read_to_string(path) {
        Ok(content) => {
            // 去掉 UTF-8 BOM，某些编辑器会加
            let content = content.trim_start_matches('\u{feff}');
            let parsed = serde_json::from_str(content).map_err(|e| Error::json(path, e))?;
            Ok(Some(parsed))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::io(path, e)),
    }
}

/// 写 JSON 配置文件（key 排序 + 原子替换），返回实际写入的字节，供调用方算哈希。
pub fn write_json_file_with_contents<T: Serialize>(path: &Path, data: &T) -> Result<Vec<u8>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let value = serde_json::to_value(data).map_err(|e| Error::JsonSerialize { source: e })?;
    let sorted = sort_json_keys(&value);
    let json =
        serde_json::to_string_pretty(&sorted).map_err(|e| Error::JsonSerialize { source: e })?;
    let mut contents = json.into_bytes();
    contents.push(b'\n');
    atomic_write(path, &contents)?;
    Ok(contents)
}

/// 写 JSON 配置文件
pub fn write_json_file<T: Serialize>(path: &Path, data: &T) -> Result<()> {
    write_json_file_with_contents(path, data).map(|_| ())
}

/// 原子写入文本文件（TOML / 纯文本）
pub fn write_text_file(path: &Path, data: &str) -> Result<()> {
    atomic_write(path, data.as_bytes())
}

/// 原子写入：先写临时文件，`sync_all` 落盘，再 rename 替换，避免半写状态。
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    atomic_write_with_unix_mode(path, data, None)
}

/// 原子写入含凭据的文件。Unix 上新文件与替换文件始终 0600。
pub fn atomic_write_private(path: &Path, data: &[u8]) -> Result<()> {
    atomic_write_with_unix_mode(path, data, Some(0o600))
}

fn create_temp_file(
    parent: &Path,
    file_name: &str,
    unix_mode: Option<u32>,
) -> Result<(PathBuf, fs::File)> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let mut last_collision = None;
    for _ in 0..MAX_TEMP_ATTEMPTS {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        // pid + 纳秒 + 进程内计数器，三者叠加避免并发写同一目录时抢占同名临时文件
        let candidate = parent.join(format!(
            "{file_name}.tmp.{}.{ts}.{counter}",
            std::process::id()
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if let Some(mode) = unix_mode {
            use std::os::unix::fs::OpenOptionsExt;
            // 从创建那一刻就是 0600，不留下短暂的宽权限窗口
            options.mode(mode);
        }
        #[cfg(not(unix))]
        let _ = unix_mode;

        match options.open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(source) if source.kind() == std::io::ErrorKind::AlreadyExists => {
                last_collision = Some((candidate, source));
            }
            Err(source) => return Err(Error::io(&candidate, source)),
        }
    }
    let (candidate, source) = last_collision.expect("临时文件名重试循环至少执行一次");
    Err(Error::io(&candidate, source))
}

fn atomic_write_with_unix_mode(path: &Path, data: &[u8], unix_mode: Option<u32>) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| Error::config("无效的路径：没有父目录"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| Error::config("无效的文件名"))?
        .to_string_lossy()
        .to_string();

    let (tmp, mut file) = create_temp_file(parent, &file_name, unix_mode)?;

    // cc-switch 只做了 write_all + flush，没有 sync_all：断电时 rename 可能先于
    // 数据落盘，留下一个长度正确但内容为空洞的配置文件。这里补上。
    let write_result = file
        .write_all(data)
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all());
    if let Err(source) = write_result {
        drop(file);
        let _ = fs::remove_file(&tmp);
        return Err(Error::io(&tmp, source));
    }
    drop(file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(mode) = unix_mode {
            if let Err(source) = fs::set_permissions(&tmp, fs::Permissions::from_mode(mode)) {
                let _ = fs::remove_file(&tmp);
                return Err(Error::io(&tmp, source));
            }
        } else if let Ok(meta) = fs::metadata(path) {
            // 继承目标文件原有权限，避免 rename 后权限被重置
            let perm = meta.permissions().mode();
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(perm));
        }
    }

    replace_file(&tmp, path)?;

    // rename 本身也需要落盘，否则崩溃后目录项可能丢失
    if let Ok(dir) = fs::File::open(parent) {
        let _ = dir.sync_all();
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(tmp: &Path, path: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{Foundation::ERROR_NOT_SUPPORTED, Storage::FileSystem::ReplaceFileW};

    let replaced: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replacement: Vec<u16> = tmp
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut last_error = None;
    for _ in 0..3 {
        // SAFETY: 两个路径缓冲都是 NUL 结尾的 UTF-16 且在调用期间存活；
        // backup / exclusion / reserved 指针按文档传空。
        let ok = unsafe {
            ReplaceFileW(
                replaced.as_ptr(),
                replacement.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if ok != 0 {
            return Ok(());
        }

        let err = std::io::Error::last_os_error();
        // WSL 的 UNC 路径会让 ReplaceFileW 返回 ERROR_NOT_SUPPORTED(50)；
        // 目标不存在时也用不上 ReplaceFileW。两种情况都降级到 fs::rename。
        let not_supported = err.raw_os_error() == Some(ERROR_NOT_SUPPORTED as i32);
        if err.kind() != std::io::ErrorKind::NotFound && !not_supported {
            last_error = Some(err);
            break;
        }

        match fs::rename(tmp, path) {
            Ok(()) => return Ok(()),
            Err(source)
                if matches!(
                    source.kind(),
                    std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
                ) =>
            {
                last_error = Some(source);
            }
            Err(source) => {
                last_error = Some(source);
                break;
            }
        }
    }

    let source = last_error.unwrap_or_else(std::io::Error::last_os_error);
    let _ = fs::remove_file(tmp);
    Err(Error::io_context(
        format!("原子替换失败: {} -> {}", tmp.display(), path.display()),
        source,
    ))
}

#[cfg(not(windows))]
fn replace_file(tmp: &Path, path: &Path) -> Result<()> {
    fs::rename(tmp, path).map_err(|source| {
        let _ = fs::remove_file(tmp);
        Error::io_context(
            format!("原子替换失败: {} -> {}", tmp.display(), path.display()),
            source,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    fn leftover_temps(dir: &Path, file_name: &str) -> Vec<PathBuf> {
        let prefix = format!("{file_name}.tmp.");
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap())
            .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
            .map(|e| e.path())
            .collect()
    }

    #[test]
    fn replaces_existing_file_without_leaving_temps() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, b"old").unwrap();

        atomic_write(&path, b"new").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert!(
            leftover_temps(dir.path(), "config.json").is_empty(),
            "残留临时文件"
        );
    }

    #[test]
    fn creates_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a/b/c/config.json");
        atomic_write(&path, b"x").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"x");
    }

    #[test]
    fn json_roundtrip_sorts_keys_and_is_stable() {
        #[derive(Serialize, Deserialize, PartialEq, Debug)]
        struct Cfg {
            z: u32,
            a: String,
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.json");
        let cfg = Cfg {
            z: 1,
            a: "hi".into(),
        };

        let first = write_json_file_with_contents(&path, &cfg).unwrap();
        let text = String::from_utf8(first.clone()).unwrap();
        // key 按字母序，a 在 z 之前
        assert!(text.find("\"a\"").unwrap() < text.find("\"z\"").unwrap());
        // 同样输入两次写出的字节必须一致
        let second = write_json_file_with_contents(&path, &cfg).unwrap();
        assert_eq!(first, second);

        let back: Cfg = read_json_file(&path).unwrap().unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn read_json_returns_none_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let missing: Option<serde_json::Value> =
            read_json_file(&dir.path().join("nope.json")).unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn read_json_strips_bom() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bom.json");
        fs::write(&path, "\u{feff}{\"a\":1}").unwrap();
        let v: serde_json::Value = read_json_file(&path).unwrap().unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn read_json_reports_path_on_parse_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        fs::write(&path, "{not json").unwrap();
        let err = read_json_file::<serde_json::Value>(&path).unwrap_err();
        assert!(err.to_string().contains("bad.json"), "错误信息应包含路径");
    }

    #[cfg(unix)]
    #[test]
    fn private_write_uses_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.json");
        atomic_write_private(&path, b"s").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "实际权限 {mode:o}");
    }

    #[cfg(unix)]
    #[test]
    fn preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keep.json");
        fs::write(&path, b"old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();

        atomic_write(&path, b"new").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640, "实际权限 {mode:o}");
    }
}
