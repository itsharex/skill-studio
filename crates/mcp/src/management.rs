//! Configuration management remains available while the gateway is stopped.
use crate::{
    config::{self, Server},
    native,
};
use anyhow::{bail, Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use skill_studio_core::fs::atomic;
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub definition: Value,
    #[serde(default)]
    pub oauth: bool,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub bindings: Vec<Binding>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub id: String,
    pub agent: String,
    pub path: PathBuf,
    pub project: Option<String>,
    pub key: String,
    pub original: Option<Value>,
    pub installed: Value,
}
#[derive(Clone)]
pub struct Target {
    pub agent: String,
    pub path: PathBuf,
    pub project: Option<String>,
    pub key: String,
    pub expected: Option<Value>,
}
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub groups: Vec<groups::Group>,
    #[serde(default, rename = "activeGroups")]
    pub active_groups: BTreeMap<String, groups::ActiveGroup>,
}

fn lock(dir: &Path) -> Result<std::fs::File> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let f = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("management.lock"))?;
    f.lock_exclusive()?;
    recover(dir)?;
    Ok(f)
}
pub fn read(dir: &Path) -> Result<Catalog> {
    let _lock = lock(dir)?;
    read_unlocked(dir)
}
fn read_unlocked(dir: &Path) -> Result<Catalog> {
    if let Some(catalog) = atomic::read_json_file(&dir.join("catalog.json"))? {
        return Ok(catalog);
    }
    let legacy = config::read(dir)?;
    let mut entries = vec![];
    for server in legacy.servers {
        let mut definition = serde_json::to_value(&server.connection)?;
        let kind = definition
            .as_object_mut()
            .unwrap()
            .remove("transport")
            .unwrap();
        definition["type"] = kind;
        let mut bindings = vec![];
        for b in legacy.bindings.iter().filter(|b| b.id == server.id) {
            let key = format!("studio-{}", server.id);
            let text = read_text(&b.path)?.unwrap_or_default();
            if let Some(installed) = native::entry(&text, &b.agent, None, &key)? {
                // Retain an expected snapshot only for a recognizable legacy adapter.
                if installed["args"] != json!(["--mcp-client", server.id, dir]) {
                    bail!("旧 MCP 接入已修改，请先核对 {}", b.path.display());
                }
                bindings.push(Binding {
                    id: format!("legacy-{}-{}", server.id, bindings.len()),
                    agent: b.agent.clone(),
                    path: b.path.clone(),
                    project: None,
                    key,
                    original: None,
                    installed,
                });
            }
        }
        entries.push(Entry {
            id: server.id,
            name: server.name,
            mode: "gateway".into(),
            definition,
            oauth: server.oauth,
            client_id: server.client_id,
            scopes: server.scopes,
            bindings,
        });
    }
    Ok(Catalog {
        entries,
        ..Default::default()
    })
}
pub fn gateway_server(entry: &Entry) -> Result<Server> {
    let mut server =
        crate::discovery::normalize(&entry.name, &entry.id, &entry.definition, "claude")?;
    server.oauth = entry.oauth;
    server.client_id = entry.client_id.clone();
    server.scopes = entry.scopes.clone();
    config::validate(&server)?;
    Ok(server)
}
pub fn projection(dir: &Path) -> Result<Option<Vec<Server>>> {
    // The catalog is the transaction's final write. Never inspect partial native writes.
    let Some(catalog): Option<Catalog> = atomic::read_json_file(&dir.join("catalog.json"))? else {
        return Ok(None);
    };
    Ok(Some(
        catalog
            .entries
            .iter()
            .filter(|e| e.mode == "gateway")
            .map(gateway_server)
            .collect::<Result<_>>()?,
    ))
}
pub fn save(
    dir: &Path,
    mut entry: Entry,
    targets: Vec<Target>,
    executable: &Path,
    expected_entry: Option<&Entry>,
) -> Result<()> {
    let _lock = lock(dir)?;
    if entry.id.is_empty()
        || !entry
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        bail!("无效的 MCP ID");
    }
    if entry.name.trim().is_empty() {
        bail!("请填写名称");
    }
    native::validate(&entry.definition)?;
    if !matches!(entry.mode.as_str(), "direct" | "gateway") {
        bail!("请选择直连或网关");
    }
    if entry.mode == "gateway" {
        gateway_server(&entry)?;
    }
    let mut catalog = read_unlocked(dir)?;
    let old = catalog.entries.iter().find(|e| e.id == entry.id).cloned();
    if serde_json::to_value(&old)? != serde_json::to_value(expected_entry)? {
        bail!("MCP 已被其他操作修改，请关闭编辑器后重新打开");
    }
    let mut files = BTreeMap::new();
    let mut installed = vec![];
    let mut seen = HashSet::new();
    for target in targets {
        let identity = (
            target.agent.clone(),
            target.path.clone(),
            target.project.clone(),
            target.key.clone(),
        );
        if !seen.insert(identity) {
            continue;
        }
        if catalog
            .entries
            .iter()
            .filter(|e| e.id != entry.id)
            .flat_map(|e| &e.bindings)
            .any(|b| b.path == target.path && b.project == target.project && b.key == target.key)
        {
            bail!("目标条目已由其他 MCP 管理");
        }
        let prior = old.as_ref().and_then(|e| {
            e.bindings.iter().find(|b| {
                b.path == target.path && b.project == target.project && b.key == target.key
            })
        });
        if let Some(binding) = catalog
            .active_groups
            .values()
            .flat_map(|g| &g.bindings)
            .find(|b| b.path == target.path && b.project == target.project && b.key == target.key)
        {
            let prior = prior.context("目标正由分组使用，请先停用分组再改变接入")?;
            stage(
                &mut files,
                &target,
                &Some(binding.installed.clone()),
                &Some(binding.installed.clone()),
            )?;
            installed.push(prior.clone());
            continue;
        }
        let value = if entry.mode == "gateway" {
            let mut value = json!({"command":executable,"args":["--mcp-client",entry.id,dir]});
            if target.agent == "claude" {
                value["type"] = json!("stdio");
            }
            value
        } else {
            native::for_agent(&entry.definition, &target.agent)?
        };
        let expected = prior
            .map(|b| Some(b.installed.clone()))
            .unwrap_or(target.expected.clone());
        stage(&mut files, &target, &expected, &Some(value.clone()))?;
        installed.push(Binding {
            id: prior
                .map(|b| b.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            agent: target.agent,
            path: target.path,
            project: target.project,
            key: target.key,
            original: prior.map(|b| b.original.clone()).unwrap_or(expected),
            installed: value,
        });
    }
    if let Some(old) = old {
        for binding in old
            .bindings
            .iter()
            .filter(|b| !installed.iter().any(|next| next.id == b.id))
        {
            if catalog
                .active_groups
                .values()
                .flat_map(|g| &g.bindings)
                .any(|b| {
                    b.path == binding.path && b.project == binding.project && b.key == binding.key
                })
            {
                bail!("接入正由分组使用，请先停用分组再移除接入");
            }
            let target = Target {
                agent: binding.agent.clone(),
                path: binding.path.clone(),
                project: binding.project.clone(),
                key: binding.key.clone(),
                expected: None,
            };
            stage(&mut files, &target, &Some(binding.installed.clone()), &None)?;
        }
    }
    entry.bindings = installed;
    catalog.entries.retain(|e| e.id != entry.id);
    catalog.entries.push(entry);
    commit(dir, files, &catalog)
}
pub fn remove(dir: &Path, id: &str, restore: bool) -> Result<()> {
    let _lock = lock(dir)?;
    let mut catalog = read_unlocked(dir)?;
    let entry = catalog
        .entries
        .iter()
        .find(|e| e.id == id)
        .context("MCP 不存在")?;
    if catalog
        .active_groups
        .values()
        .any(|g| g.entries.iter().any(|e| e.id == id))
    {
        bail!("请先停用引用此 MCP 的分组");
    }
    let mut files = BTreeMap::new();
    for b in &entry.bindings {
        let target = Target {
            agent: b.agent.clone(),
            path: b.path.clone(),
            project: b.project.clone(),
            key: b.key.clone(),
            expected: None,
        };
        stage(
            &mut files,
            &target,
            &Some(b.installed.clone()),
            &if restore { b.original.clone() } else { None },
        )?;
    }
    catalog.entries.retain(|e| e.id != id);
    commit(dir, files, &catalog)
}
#[derive(Clone, Serialize, Deserialize)]
struct Change {
    path: PathBuf,
    before: Option<String>,
    after: String,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    changes: Vec<Change>,
    catalog: Change,
}
fn read_text(path: &Path) -> Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
fn stage(
    files: &mut BTreeMap<PathBuf, Change>,
    target: &Target,
    expected: &Option<Value>,
    next: &Option<Value>,
) -> Result<()> {
    if !files.contains_key(&target.path) {
        let before = read_text(&target.path)?;
        files.insert(
            target.path.clone(),
            Change {
                path: target.path.clone(),
                after: before.clone().unwrap_or_default(),
                before,
            },
        );
    }
    let change = files.get_mut(&target.path).unwrap();
    change.after = native::patch(
        &change.after,
        &target.agent,
        target.project.as_deref(),
        &target.key,
        expected,
        next,
    )?;
    Ok(())
}
fn commit(dir: &Path, files: BTreeMap<PathBuf, Change>, catalog: &Catalog) -> Result<()> {
    let catalog_path = dir.join("catalog.json");
    let journal = Journal {
        changes: files
            .into_values()
            .filter(|c| c.before.as_deref() != Some(&c.after))
            .collect(),
        catalog: Change {
            before: read_text(&catalog_path)?,
            path: catalog_path,
            after: serde_json::to_string_pretty(catalog)?,
        },
    };
    for c in &journal.changes {
        if read_text(&c.path)? != c.before {
            bail!("配置已被修改，请刷新后重试：{}", c.path.display());
        }
        if let Some(before) = &c.before {
            atomic::atomic_write_private(
                &c.path
                    .with_extension(format!("studio-backup-{}", uuid::Uuid::new_v4())),
                before.as_bytes(),
            )?;
        }
    }
    atomic::write_json_file(&dir.join("management-transaction.json"), &journal)?;
    let outcome = (|| -> Result<()> {
        for c in journal
            .changes
            .iter()
            .chain(std::iter::once(&journal.catalog))
        {
            if read_text(&c.path)? != c.before {
                bail!("配置已被修改，请刷新后重试：{}", c.path.display());
            }
            atomic::atomic_write_private(&c.path, c.after.as_bytes())?;
        }
        Ok(())
    })();
    if let Err(error) = outcome {
        recover(dir).context("保存失败，自动恢复遇到外部修改，请保留事务文件并恢复配置")?;
        return Err(error);
    }
    std::fs::remove_file(dir.join("management-transaction.json"))?;
    Ok(())
}
fn recover(dir: &Path) -> Result<()> {
    let path = dir.join("management-transaction.json");
    let Some(journal): Option<Journal> = atomic::read_json_file(&path)? else {
        return Ok(());
    };
    if read_text(&journal.catalog.path)?.as_deref() == Some(&journal.catalog.after) {
        std::fs::remove_file(path)?;
        return Ok(());
    }
    // Check every file before rollback; never overwrite edits made after interruption.
    for c in &journal.changes {
        let current = read_text(&c.path)?;
        if current != c.before && current.as_deref() != Some(&c.after) {
            bail!("事务恢复检测到外部修改：{}", c.path.display());
        }
    }
    for c in journal.changes.iter().rev() {
        if read_text(&c.path)?.as_deref() == Some(&c.after) {
            if let Some(before) = &c.before {
                atomic::atomic_write_private(&c.path, before.as_bytes())?;
            } else {
                std::fs::remove_file(&c.path)?;
            }
        }
    }
    std::fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
#[path = "management_tests.rs"]
mod tests;

pub mod groups;
