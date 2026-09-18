//! Search the public skills.sh catalog and stage GitHub skills without executing repository code.
use crate::{
    models::{
        config::{AppConfig, SkillInstallation},
        skill::{skill_id_for, Skill},
    },
    services::{linker, scanner, studio::Studio, transaction::Transaction},
    Error, Result,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

const MAX_DOWNLOAD: u64 = 64 * 1024 * 1024;
const MAX_EXPANDED: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSkill {
    pub skill_id: String,
    pub name: String,
    pub source: String,
    #[serde(default)]
    pub installs: u64,
}
#[derive(Debug, Deserialize)]
struct SearchResponse {
    skills: Vec<CatalogSkill>,
}

pub fn validate_coordinates(source: &str, skill_id: &str) -> Result<()> {
    let parts: Vec<_> = source.split('/').collect();
    let valid = parts.len() == 2
        && !parts[0].is_empty()
        && parts[0].len() <= 100
        && parts[0]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        && !parts[1].is_empty()
        && parts[1].len() <= 100
        && parts[1] != "."
        && parts[1] != ".."
        && parts[1]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c));
    if !valid
        || skill_id.is_empty()
        || skill_id.len() > 100
        || !skill_id.as_bytes()[0].is_ascii_alphanumeric()
        || !skill_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        return Err(Error::invalid("仓库或 skill 标识无效"));
    }
    Ok(())
}
fn download(url: reqwest::Url, limit: u64) -> Result<Vec<u8>> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Skill-Studio/0.1")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| Error::Other(e.to_string()))?;
    let response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| Error::Other(format!("下载失败：{e}")))?;
    if response.status().is_redirection() {
        return Err(Error::invalid("下载地址发生重定向，请稍后重试"));
    }
    if response.content_length().is_some_and(|n| n > limit) {
        return Err(Error::invalid("下载内容过大"));
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| Error::Other(format!("读取下载内容失败：{e}")))?;
    if bytes.len() as u64 > limit {
        return Err(Error::invalid("下载内容过大"));
    }
    Ok(bytes)
}
pub fn search(query: &str) -> Result<Vec<CatalogSkill>> {
    let query = query.trim();
    if query.chars().count() < 2 || query.chars().count() > 200 {
        return Err(Error::invalid("请输入 2 至 200 个字符搜索"));
    }
    let mut url = reqwest::Url::parse("https://skills.sh/api/search").unwrap();
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("limit", "100");
    let bytes = download(url, 2 * 1024 * 1024)?;
    let data: SearchResponse = serde_json::from_slice(&bytes)
        .map_err(|e| Error::Other(format!("搜索服务响应无效：{e}")))?;
    let mut seen = std::collections::HashSet::new();
    Ok(data
        .skills
        .into_iter()
        .filter(|s| {
            validate_coordinates(&s.source, &s.skill_id).is_ok()
                && seen.insert((s.source.clone(), s.skill_id.clone()))
        })
        .take(100)
        .collect())
}

pub struct PreparedSkill {
    _temp: tempfile::TempDir,
    pub directory: PathBuf,
    pub source: String,
    pub skill_id: String,
    pub repository_path: String,
}

pub fn prepare(source: &str, skill_id: &str) -> Result<PreparedSkill> {
    validate_coordinates(source, skill_id)?;
    let url = reqwest::Url::parse(&format!("https://codeload.github.com/{source}/zip/HEAD"))
        .map_err(|e| Error::Other(e.to_string()))?;
    prepare_archive(source, skill_id, &download(url, MAX_DOWNLOAD)?)
}

/// Public for deterministic integration testing with repository archives.
pub fn prepare_archive(source: &str, skill_id: &str, bytes: &[u8]) -> Result<PreparedSkill> {
    validate_coordinates(source, skill_id)?;
    if bytes.len() as u64 > MAX_DOWNLOAD {
        return Err(Error::invalid("下载内容过大"));
    }
    let temp = tempfile::tempdir().map_err(|e| Error::Other(e.to_string()))?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| Error::Other(format!("无效仓库归档：{e}")))?;
    if archive.len() > MAX_ENTRIES {
        return Err(Error::invalid("仓库文件数量超过限制"));
    }
    let mut expanded = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| Error::Other(e.to_string()))?;
        let path = entry
            .enclosed_name()
            .ok_or_else(|| Error::invalid("归档包含越界路径"))?;
        if entry.name().contains('\\')
            || entry.name().contains(':')
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(Error::invalid("归档包含无效路径"));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(Error::invalid("仓库包含符号链接，暂不支持自动安装"));
        }
        expanded = expanded.saturating_add(if entry.is_dir() { 4096 } else { entry.size() });
        if expanded > MAX_EXPANDED {
            return Err(Error::invalid("解压内容超过限制"));
        }
        let target = temp.path().join(path);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| Error::io(&target, e))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
        }
        let declared = entry.size();
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| Error::io(&target, e))?;
        let copied = std::io::copy(&mut (&mut entry).take(declared + 1), &mut output)
            .map_err(|e| Error::io(&target, e))?;
        if copied != declared {
            return Err(Error::invalid("归档文件大小校验失败"));
        }
        output.flush().map_err(|e| Error::io(&target, e))?;
        #[cfg(unix)]
        if entry.unix_mode().is_some_and(|m| m & 0o111 != 0) {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
                .map_err(|e| Error::io(&target, e))?;
        }
    }
    fn find(dir: &Path, id: &str, depth: usize, matches: &mut Vec<PathBuf>) -> Result<()> {
        if depth > scanner::MAX_SCAN_DEPTH {
            return Err(Error::invalid("仓库目录层级过深"));
        }
        if dir.join("SKILL.md").is_file() {
            let fm = scanner::parse_frontmatter(&dir.join("SKILL.md"));
            if dir.file_name().is_some_and(|n| n == id) || fm.name.as_deref() == Some(id) {
                matches.push(dir.to_path_buf());
            }
        }
        for entry in fs::read_dir(dir).map_err(|e| Error::io(dir, e))? {
            let entry = entry.map_err(|e| Error::io(dir, e))?;
            if entry
                .file_type()
                .map_err(|e| Error::io(entry.path(), e))?
                .is_dir()
                && entry.file_name() != ".git"
                && entry.file_name() != "node_modules"
            {
                find(&entry.path(), id, depth + 1, matches)?;
            }
        }
        Ok(())
    }
    let mut found = Vec::new();
    find(temp.path(), skill_id, 0, &mut found)?;
    if found.len() != 1 {
        return Err(Error::invalid(if found.is_empty() {
            "仓库中未找到对应 skill，目录可能已变更"
        } else {
            "仓库内有多个同名 skill，无法确定安装目标"
        }));
    }
    let directory = found.remove(0);
    scanner::validate_sync_source(&directory)?;
    if scanner::parse_frontmatter(&directory.join("SKILL.md")).malformed {
        return Err(Error::invalid("Skill 的 YAML 格式无效"));
    }
    // The first archive component is the GitHub repository envelope.
    let repository_path = directory
        .strip_prefix(temp.path())
        .unwrap()
        .components()
        .skip(1)
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    Ok(PreparedSkill {
        _temp: temp,
        directory,
        source: source.into(),
        skill_id: skill_id.into(),
        repository_path,
    })
}

impl Studio {
    pub fn install_catalog_skill(
        &self,
        config: &mut AppConfig,
        prepared: &PreparedSkill,
    ) -> Result<Skill> {
        if let Some(source) = prepared.source.strip_prefix("local:") {
            if !Path::new(source).is_absolute()
                || prepared.skill_id.is_empty()
                || prepared.skill_id.starts_with('.')
                || prepared.skill_id.contains(['/', '\\', ':'])
                || Path::new(&prepared.skill_id).components().count() != 1
            {
                return Err(Error::invalid("本地 skill 路径无效"));
            }
        } else {
            validate_coordinates(&prepared.source, &prepared.skill_id)?;
        }
        let hub = self.store().hub_dir(config);
        let roots: Vec<_> = crate::models::agent::AGENTS
            .iter()
            .flat_map(|a| a.resolved_global_roots(&config.settings.agent_dir_overrides))
            .collect();
        linker::ensure_distinct_roots(&hub, &roots)?;
        let target = hub.join(&prepared.skill_id);
        let id = skill_id_for(&target);
        if target.symlink_metadata().is_ok() {
            if config
                .skill_installations
                .get(&id)
                .is_some_and(|r| r.source == prepared.source && r.skill_id == prepared.skill_id)
            {
                if let Some(view) = self
                    .scan_skills(config)?
                    .into_iter()
                    .find(|v| v.skill.id == id && v.diagnostics.is_empty())
                {
                    return Ok(view.skill);
                }
            }
            return Err(Error::invalid("Hub 已有同名 skill，未覆盖现有内容"));
        }
        scanner::validate_sync_source(&prepared.directory)?;
        let hash = scanner::dir_content_hash(&prepared.directory)?;
        let mut next = config.clone();
        next.skill_installations.insert(
            id.clone(),
            SkillInstallation {
                source: prepared.source.clone(),
                skill_id: prepared.skill_id.clone(),
                repository_path: prepared.repository_path.clone(),
                installed_at: linker::now_secs(),
                content_hash: hash.clone(),
            },
        );
        let mut tx = Transaction::begin(self.store().dir().join("migration.json"))?;
        let operation = (|| -> Result<Skill> {
            fs::create_dir_all(&hub).map_err(|e| Error::io(&hub, e))?;
            if target.symlink_metadata().is_ok() {
                return Err(Error::invalid("Hub 已有同名 skill，未覆盖现有内容"));
            }
            tx.reserve(&target)?;
            linker::copy_tree(&prepared.directory, &target)?;
            if scanner::dir_content_hash(&target)? != hash {
                return Err(Error::invalid("安装内容校验失败"));
            }
            let skill = self
                .scan_skills(&next)?
                .into_iter()
                .find(|v| v.skill.id == id)
                .ok_or_else(|| Error::invalid("安装后无法识别 skill"))?
                .skill;
            self.store().reserve_config(&mut tx, &next)?;
            self.save_config(&next)?;
            Ok(skill)
        })();
        match operation {
            Ok(skill) => {
                tx.commit()?;
                *config = next;
                Ok(skill)
            }
            Err(error) => {
                tx.rollback()
                    .map_err(|e| Error::Other(format!("{error}；回滚未完成：{e}")))?;
                Err(error)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkill {
    pub path: PathBuf,
    pub name: String,
    pub description: Option<String>,
    pub error: Option<String>,
}

/// Discover skills in a selected directory without following directory links.
pub fn discover_local(root: &Path) -> Result<Vec<LocalSkill>> {
    let root = fs::canonicalize(root).map_err(|e| Error::io(root, e))?;
    let mut found = Vec::new();
    let mut budget = MAX_ENTRIES;
    fn walk(dir: &Path, depth: usize, budget: &mut usize, out: &mut Vec<LocalSkill>) -> Result<()> {
        if depth > scanner::MAX_SCAN_DEPTH {
            return Err(Error::invalid("目录层级过深，请选择更具体的目录"));
        }
        if dir.join("SKILL.md").is_file() {
            let fm = scanner::parse_frontmatter(&dir.join("SKILL.md"));
            out.push(LocalSkill {
                path: dir.to_path_buf(),
                name: fm.name.unwrap_or_else(|| {
                    dir.file_name().unwrap_or_default().to_string_lossy().into()
                }),
                description: fm.description,
                error: fm.malformed.then(|| "SKILL.md 的 YAML 格式无效".into()),
            });
            return Ok(());
        }
        for entry in fs::read_dir(dir).map_err(|e| Error::io(dir, e))? {
            let entry = entry.map_err(|e| Error::io(dir, e))?;
            if *budget == 0 {
                return Err(Error::invalid("目录文件数量过多，请选择更具体的目录"));
            }
            *budget -= 1;
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.') || name == "node_modules" || name == "target"
            {
                continue;
            }
            if entry
                .file_type()
                .map_err(|e| Error::io(entry.path(), e))?
                .is_dir()
            {
                walk(&entry.path(), depth + 1, budget, out)?;
            }
        }
        Ok(())
    }
    walk(&root, 0, &mut budget, &mut found)?;
    found.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(found)
}

/// Stage an independent copy, retaining the user's original files.
pub fn prepare_local(path: &Path) -> Result<PreparedSkill> {
    let source = fs::canonicalize(path).map_err(|e| Error::io(path, e))?;
    scanner::validate_sync_source(&source)?;
    if scanner::parse_frontmatter(&source.join("SKILL.md")).malformed {
        return Err(Error::invalid("SKILL.md 的 YAML 格式无效"));
    }
    let skill_id = source
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && !n.starts_with('.') && !n.contains(['/', '\\', ':']))
        .ok_or_else(|| Error::invalid("Skill 目录名称无效"))?
        .to_owned();
    // Limit the copied tree and reject links so the Hub copy is self-contained.
    fn check(dir: &Path, depth: usize, count: &mut usize, size: &mut u64) -> Result<()> {
        if depth > 32 {
            return Err(Error::invalid("Skill 目录层级过深"));
        }
        for entry in fs::read_dir(dir).map_err(|e| Error::io(dir, e))? {
            let entry = entry.map_err(|e| Error::io(dir, e))?;
            let meta =
                fs::symlink_metadata(entry.path()).map_err(|e| Error::io(entry.path(), e))?;
            *count += 1;
            *size = size.saturating_add(meta.len());
            if *count > MAX_ENTRIES || *size > MAX_EXPANDED {
                return Err(Error::invalid("Skill 文件数量或大小超过限制"));
            }
            if meta.is_symlink() || (!meta.is_dir() && !meta.is_file()) {
                return Err(Error::invalid("Skill 包含链接或特殊文件，暂不支持导入"));
            }
            if meta.is_dir() {
                check(&entry.path(), depth + 1, count, size)?;
            }
        }
        Ok(())
    }
    check(&source, 0, &mut 0, &mut 0)?;
    let temp = tempfile::tempdir().map_err(|e| Error::Other(e.to_string()))?;
    let directory = temp.path().join(&skill_id);
    let before = scanner::dir_content_hash(&source)?;
    linker::copy_tree(&source, &directory)?;
    if scanner::dir_content_hash(&directory)? != before {
        return Err(Error::invalid("本地内容在导入期间发生变化，请重试"));
    }
    Ok(PreparedSkill {
        _temp: temp,
        directory,
        source: format!("local:{}", source.display()),
        skill_id,
        repository_path: String::new(),
    })
}
