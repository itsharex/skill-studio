//! Agent-local combinations. Metadata and all native edits share the management journal.
use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub agent: String,
    pub name: String,
    pub entry_ids: Vec<String>,
    #[serde(default)]
    pub sort_order: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveGroup {
    pub group_id: String,
    pub entries: Vec<Entry>,
    pub bindings: Vec<Binding>,
}
fn agent(agent: &str) -> Result<()> {
    if !matches!(agent, "claude" | "codex") {
        bail!("此 Agent 暂不支持 MCP 分组");
    }
    Ok(())
}
pub fn save_group(dir: &Path, mut group: Group, imports: Vec<Entry>) -> Result<()> {
    agent(&group.agent)?;
    group.name = group.name.trim().into();
    if group.name.is_empty() || group.id.is_empty() {
        bail!("请填写分组名称");
    }
    let _lock = lock(dir)?;
    let mut catalog = read_unlocked(dir)?;
    if catalog
        .groups
        .iter()
        .any(|g| g.id == group.id && g.agent != group.agent)
    {
        bail!("不能修改其他 Agent 的分组");
    }
    if catalog
        .groups
        .iter()
        .any(|g| g.agent == group.agent && g.name == group.name && g.id != group.id)
    {
        bail!("此 Agent 已存在同名分组");
    }
    for entry in imports {
        if !group.entry_ids.contains(&entry.id) {
            continue;
        }
        if let Some(existing) = catalog.entries.iter().find(|e| e.id == entry.id) {
            if existing.definition != entry.definition {
                bail!("MCP 已变化，请刷新后重试");
            }
        } else {
            native::validate(&entry.definition)?;
            if entry.bindings.iter().any(|b| {
                catalog
                    .entries
                    .iter()
                    .flat_map(|e| &e.bindings)
                    .any(|other| {
                        other.path == b.path && other.project == b.project && other.key == b.key
                    })
            }) {
                bail!("来源已由其他 MCP 管理，请刷新后重试");
            }
            catalog.entries.push(entry);
        }
    }
    let mut seen = HashSet::new();
    group.entry_ids.retain(|id| seen.insert(id.clone()));
    // Keep missing members visible on edit, as with Skill groups.
    if let Some(i) = catalog.groups.iter().position(|g| g.id == group.id) {
        group.sort_order = catalog.groups[i].sort_order;
        catalog.groups[i] = group;
    } else {
        group.sort_order = catalog
            .groups
            .iter()
            .filter(|g| g.agent == group.agent)
            .count();
        catalog.groups.push(group);
    }
    commit(dir, BTreeMap::new(), &catalog)
}
pub fn remove_group(dir: &Path, agent_id: &str, id: &str) -> Result<()> {
    agent(agent_id)?;
    let _lock = lock(dir)?;
    let mut catalog = read_unlocked(dir)?;
    if catalog.active_groups.values().any(|g| g.group_id == id) {
        bail!("请先停用分组");
    }
    if !catalog
        .groups
        .iter()
        .any(|g| g.agent == agent_id && g.id == id)
    {
        bail!("分组不存在或不属于此 Agent");
    }
    catalog.groups.retain(|g| g.id != id);
    commit(dir, BTreeMap::new(), &catalog)
}
pub fn reorder(dir: &Path, agent_id: &str, ids: &[String]) -> Result<()> {
    agent(agent_id)?;
    let _lock = lock(dir)?;
    let mut catalog = read_unlocked(dir)?;
    let own: HashSet<_> = catalog
        .groups
        .iter()
        .filter(|g| g.agent == agent_id)
        .map(|g| &g.id)
        .collect();
    if ids.len() != own.len() || ids.iter().collect::<HashSet<_>>() != own {
        bail!("分组列表已变化，请刷新后重试");
    }
    for group in catalog.groups.iter_mut().filter(|g| g.agent == agent_id) {
        group.sort_order = ids.iter().position(|id| id == &group.id).unwrap();
    }
    commit(dir, BTreeMap::new(), &catalog)
}
pub fn activate(
    dir: &Path,
    agent_id: &str,
    id: Option<&str>,
    path: &Path,
    executable: &Path,
) -> Result<()> {
    agent(agent_id)?;
    let _lock = lock(dir)?;
    let mut catalog = read_unlocked(dir)?;
    let mut entries = vec![];
    if let Some(id) = id {
        let group = catalog
            .groups
            .iter()
            .find(|g| g.id == id && g.agent == agent_id)
            .context("分组不存在或不属于此 Agent")?;
        if group.entry_ids.is_empty() {
            bail!("请先为分组选择 MCP");
        }
        let mut names = HashSet::new();
        for entry_id in &group.entry_ids {
            let mut entry = catalog
                .entries
                .iter()
                .find(|e| &e.id == entry_id)
                .context("分组包含已缺失的 MCP，请编辑分组")?
                .clone();
            if !names.insert(entry.name.trim().to_string()) {
                bail!("组内 MCP 名称重复，请先在 Hub 修改名称");
            }
            entry.bindings.clear();
            entries.push(entry);
        }
    }
    let mut files = BTreeMap::new();
    if let Some(previous) = catalog.active_groups.remove(agent_id) {
        for b in previous.bindings {
            let target = Target {
                agent: agent_id.into(),
                path: b.path,
                project: b.project,
                key: b.key,
                expected: None,
            };
            stage(&mut files, &target, &Some(b.installed), &b.original)?;
        }
    }
    let mut bindings = vec![];
    let mut keys = HashSet::new();
    for entry in &entries {
        // Reuse the managed native key even when the Hub display name was changed.
        let key = catalog
            .entries
            .iter()
            .find(|e| e.id == entry.id)
            .and_then(|e| {
                e.bindings
                    .iter()
                    .find(|b| b.agent == agent_id && b.path == path && b.project.is_none())
            })
            .map(|b| b.key.clone())
            .unwrap_or_else(|| entry.name.trim().to_string());
        if !keys.insert(key.clone()) {
            bail!("组内 MCP 使用了相同的配置名称，请先在 Hub 核对");
        }
        let text = match files.get(path) {
            Some(c) => c.after.clone(),
            None => read_text(path)?.unwrap_or_default(),
        };
        let original = native::entry(&text, agent_id, None, &key)?;
        if let Some(value) = &original {
            let owned = catalog
                .entries
                .iter()
                .find(|e| e.id == entry.id)
                .is_some_and(|e| {
                    e.bindings.iter().any(|b| {
                        b.path == path
                            && b.project.is_none()
                            && b.key == key
                            && b.installed == *value
                    })
                });
            if !owned && native::canonical(value, agent_id) != entry.definition {
                bail!("MCP「{key}」存在不同的同名配置，请先在 Hub 核对");
            }
        }
        let mut installed = if entry.mode == "gateway" {
            gateway_server(entry)?;
            let mut value = json!({"command":executable,"args":["--mcp-client",entry.id,dir]});
            if agent_id == "claude" {
                value["type"] = json!("stdio");
            }
            value
        } else {
            native::for_agent(&entry.definition, agent_id)?
        };
        if agent_id == "codex" {
            installed["enabled"] = json!(true);
        }
        let target = Target {
            agent: agent_id.into(),
            path: path.into(),
            project: None,
            key: key.clone(),
            expected: original.clone(),
        };
        stage(&mut files, &target, &original, &Some(installed.clone()))?;
        bindings.push(Binding {
            id: entry.id.clone(),
            agent: agent_id.into(),
            path: path.into(),
            project: None,
            key,
            original,
            installed,
        });
    }
    if let Some(id) = id {
        catalog.active_groups.insert(
            agent_id.into(),
            ActiveGroup {
                group_id: id.into(),
                entries,
                bindings,
            },
        );
    }
    commit(dir, files, &catalog)
}

pub fn issues(catalog: &Catalog) -> BTreeMap<String, String> {
    catalog
        .active_groups
        .iter()
        .filter_map(|(agent, group)| {
            let issue = group.bindings.iter().find_map(|b| {
                let check = read_text(&b.path).and_then(|text| {
                    native::entry(
                        &text.unwrap_or_default(),
                        &b.agent,
                        b.project.as_deref(),
                        &b.key,
                    )
                });
                match check {
                    Ok(value) if value == Some(b.installed.clone()) => None,
                    _ => Some(format!(
                        "MCP「{}」的配置已在外部修改或移除，请先核对 {}",
                        b.key,
                        b.path.display()
                    )),
                }
            });
            issue.map(|issue| (agent.clone(), issue))
        })
        .collect()
}
