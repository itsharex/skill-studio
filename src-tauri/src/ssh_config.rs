//! Enumerate configured aliases only. OpenSSH remains responsible for resolving
//! Host/Match options at connection time; discovery never executes Match exec.
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigHosts {
    hosts: Vec<String>,
    config_path: String,
}

pub fn list() -> Result<ConfigHosts, String> {
    let home = dirs::home_dir().ok_or("无法找到本机用户目录")?;
    let base = home.join(".ssh");
    let config = base.join("config");
    let mut hosts = Vec::new();
    read(&config, &base, &home, &mut HashSet::new(), &mut hosts, 0)?;
    Ok(ConfigHosts {
        hosts,
        config_path: config.to_string_lossy().into_owned(),
    })
}

fn words(line: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut escaped = false;
    for c in line.chars() {
        if escaped {
            word.push(c);
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '"' => quoted = !quoted,
            '#' if !quoted => break,
            c if !quoted && (c.is_whitespace() || (c == '=' && result.len() < 2)) => {
                if !word.is_empty() {
                    result.push(std::mem::take(&mut word));
                }
            }
            _ => word.push(c),
        }
    }
    if !word.is_empty() {
        result.push(word);
    }
    result
}
fn read(
    path: &Path,
    base: &Path,
    home: &Path,
    visited: &mut HashSet<PathBuf>,
    hosts: &mut Vec<String>,
    depth: usize,
) -> Result<(), String> {
    if depth > 16 || visited.len() > 1024 {
        return Err("SSH Include 层级或文件数量过多".into());
    }
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("无法读取 SSH 配置 {}: {e}", path.display())),
    };
    if !visited.insert(canonical.clone()) {
        return Ok(());
    }
    let data = std::fs::read_to_string(&canonical)
        .map_err(|e| format!("无法读取 SSH 配置 {}: {e}", path.display()))?;
    for line in data.lines() {
        let tokens = words(line);
        let Some(key) = tokens.first() else {
            continue;
        };
        if key.eq_ignore_ascii_case("host") {
            for host in &tokens[1..] {
                if !host.starts_with(['!', '-'])
                    && !host.contains(['*', '?'])
                    && !hosts.contains(host)
                {
                    hosts.push(host.clone());
                }
            }
        } else if key.eq_ignore_ascii_case("include") {
            for pattern in &tokens[1..] {
                let path = if let Some(p) = pattern.strip_prefix("~/") {
                    home.join(p)
                } else if Path::new(pattern).is_absolute() {
                    PathBuf::from(pattern)
                } else {
                    base.join(pattern)
                };
                let matches = glob::glob(&path.to_string_lossy())
                    .map_err(|e| format!("无效 SSH Include: {e}"))?;
                for matched in matches {
                    let matched = matched.map_err(|e| format!("无法读取 SSH Include: {e}"))?;
                    read(&matched, base, home, visited, hosts, depth + 1)?;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aliases_include_quotes_duplicates_and_cycles() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().join(".ssh");
        std::fs::create_dir_all(base.join("conf.d")).unwrap();
        std::fs::write(base.join("config"), "Host=one two # comment\nHost * !excluded test-?\nInclude \"conf.d/*.conf\"\nMatch exec \"exit 1\"\nHost one three\n").unwrap();
        std::fs::write(
            base.join("conf.d/a.conf"),
            "hOsT \"four\"\nInclude config\n",
        )
        .unwrap();
        let mut hosts = vec![];
        read(
            &base.join("config"),
            &base,
            root.path(),
            &mut HashSet::new(),
            &mut hosts,
            0,
        )
        .unwrap();
        assert_eq!(hosts, ["one", "two", "four", "three"]);
    }
}
