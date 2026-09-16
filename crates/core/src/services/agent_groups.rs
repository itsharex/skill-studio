//! Agent-scoped combinations with reversible suspension of manual skills.
use super::{linker, native_toggle, scanner, studio::Studio, transaction::Transaction};
use crate::{
    fs::{atomic, paths},
    models::{
        agent::require_agent,
        config::{AppConfig, Registration},
        group::{ActiveGroup, Group, GroupEntry},
        skill::LinkMode,
    },
    Error, Result,
};
use std::collections::HashSet;

impl Studio {
    pub fn save_agent_group(
        &self,
        config: &mut AppConfig,
        id: String,
        agent_id: &str,
        name: &str,
        skill_ids: Vec<String>,
    ) -> Result<Group> {
        require_agent(agent_id)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::invalid("分组名不能为空"));
        }
        if config
            .groups
            .iter()
            .any(|g| g.agent_id.as_deref() == Some(agent_id) && g.name == name && g.id != id)
        {
            return Err(Error::invalid("此 Agent 已存在同名分组"));
        }
        if let Some(group) = config.group(&id) {
            if group.agent_id.as_deref() != Some(agent_id) {
                return Err(Error::invalid("不能修改其他 Agent 或旧共享分组"));
            }
        }
        let mut seen = HashSet::new();
        let skill_ids: Vec<_> = skill_ids
            .into_iter()
            .filter(|id| seen.insert(id.clone()))
            .collect();
        // Preserve missing members on edit so users can see and explicitly remove them.
        let mut group = config
            .group(&id)
            .cloned()
            .unwrap_or_else(|| Group::new(id, name.into()));
        group.agent_id = Some(agent_id.into());
        group.name = name.into();
        group.skill_ids = skill_ids;
        if let Some(index) = config.groups.iter().position(|g| g.id == group.id) {
            config.groups[index] = group.clone();
        } else {
            group.sort_order = config.groups.len() as i32;
            config.groups.push(group.clone());
        }
        Ok(group)
    }

    /// Persist files and active metadata in one undo journal. None stops the current combination.
    pub fn activate_agent_group(
        &self,
        config: &mut AppConfig,
        agent_id: &str,
        group_id: Option<&str>,
    ) -> Result<()> {
        let agent = require_agent(agent_id)?;
        let group = group_id
            .map(|id| {
                config
                    .group(id)
                    .cloned()
                    .ok_or_else(|| Error::NotFound(format!("分组 {id}")))
            })
            .transpose()?;
        if let Some(g) = &group {
            if g.agent_id.as_deref() != Some(agent_id) {
                return Err(Error::invalid("分组不属于此 Agent"));
            }
            if g.skill_ids.is_empty() {
                return Err(Error::invalid("请先为分组选择 skill"));
            }
        }
        let ids = group
            .as_ref()
            .map(|g| g.skill_ids.clone())
            .unwrap_or_default();
        let views = self.scan_skills(config)?;
        let previous = config.active_groups.get(agent_id).cloned();
        let owned = previous
            .as_ref()
            .map(|g| g.entries.clone())
            .unwrap_or_default();
        let previously_suspended = previous
            .as_ref()
            .map(|g| g.suspended_manual.as_slice())
            .unwrap_or_default();
        let mut suspended_manual = Vec::new();
        let mut manual_toggles = Vec::new();
        for view in &views {
            let state = &view.agents[agent_id];
            if !state.status.is_registered() {
                continue;
            }
            for target in &state.entry_paths {
                if owned.iter().any(|e| e.target_path == *target) {
                    continue;
                }
                if !linker::link_status(&view.skill.source_path, target).is_registered()
                    && !paths::paths_alias(target, &view.skill.source_path)
                {
                    continue;
                }
                let was_suspended = previously_suspended.iter().any(|e| {
                    e.target_path == *target
                        && paths::paths_alias(&e.source_path, &view.skill.source_path)
                });
                let document = target.join(scanner::SKILL_FILE);
                let name = if agent_id == "codex" {
                    scanner::parse_frontmatter(&document)
                        .name
                        .unwrap_or_else(|| view.skill.name.clone())
                } else {
                    target.file_name().unwrap().to_string_lossy().into_owned()
                };
                let disabled = native_toggle::is_skill_disabled_at(
                    agent,
                    &config.settings.agent_dir_overrides,
                    &name,
                    &document,
                );
                let keep = group.is_none()
                    || config.settings.preserve_manual_skills
                    || ids.contains(&view.skill.id);
                if keep {
                    if was_suspended && disabled {
                        manual_toggles.push((view.skill.id.clone(), name, document, true));
                    }
                } else if was_suspended || !disabled {
                    if !disabled {
                        manual_toggles.push((view.skill.id.clone(), name, document, false));
                    }
                    suspended_manual.push(GroupEntry {
                        skill_id: view.skill.id.clone(),
                        source_path: view.skill.source_path.clone(),
                        target_path: target.clone(),
                    });
                }
            }
        }
        // Validate ownership/content even for retained members. Never silently discard local edits.
        for entry in &owned {
            if entry.target_path.symlink_metadata().is_err() {
                continue;
            }
            let valid = !scanner::is_symlink_or_junction(&entry.target_path)
                && scanner::read_copy_sidecar(&entry.target_path).is_some_and(|m| {
                    m.skill_id == entry.skill_id
                        && paths::paths_alias(&m.source_path, &entry.source_path)
                        && scanner::dir_content_hash(&entry.target_path)
                            .is_ok_and(|hash| hash == m.source_hash)
                });
            if !valid {
                return Err(Error::invalid(format!(
                    "分组副本已被修改或替换，请先处理后再切换：{}",
                    entry.target_path.display()
                )));
            }
        }
        let mut additions = Vec::new();
        let mut targets = HashSet::new();
        for id in &ids {
            let view = views
                .iter()
                .find(|v| &v.skill.id == id)
                .ok_or_else(|| Error::NotFound(format!("分组成员已不存在：{id}")))?;
            scanner::validate_sync_source(&view.skill.source_path)?;
            if view.malformed_frontmatter {
                return Err(Error::invalid(format!(
                    "{} 的 YAML 有误，请先修复后启用",
                    view.skill.name
                )));
            }
            let state = &view.agents[agent_id];
            let retained = owned
                .iter()
                .any(|e| e.skill_id == *id && e.target_path.is_dir());
            if retained {
                if state.disabled {
                    return Err(Error::invalid(format!(
                        "{} 已被手动停用，请先恢复启用",
                        view.skill.name
                    )));
                }
                continue;
            }
            if state.status != crate::models::skill::LinkStatus::NotLinked {
                use crate::models::skill::LinkStatus::*;
                if !matches!(
                    state.status,
                    Source | Linked | Copied | CopyStale | CopyModified
                ) || (state.disabled
                    && !manual_toggles
                        .iter()
                        .any(|(sid, _, _, enabled)| sid == id && *enabled))
                {
                    return Err(Error::invalid(format!(
                        "{} 在此 Agent 中不可用或被手动停用，请先处理",
                        view.skill.name
                    )));
                }
                // Existing manual skill is usable: do not take ownership or overwrite it.
                continue;
            }
            let dest = agent
                .primary_global_root(&config.settings.agent_dir_overrides)
                .join(&view.skill.name);
            if !targets.insert(dest.clone()) {
                return Err(Error::invalid("组合包含同目录名的多个 skill，请调整成员"));
            }
            let source = view
                .skill
                .source_path
                .canonicalize()
                .map_err(|e| Error::io(&view.skill.source_path, e))?;
            if paths::path_is_within(&source, &dest) || paths::path_is_within(&dest, &source) {
                return Err(Error::invalid("skill 来源与注册目录重叠"));
            }
            additions.push((view.skill.clone(), dest));
        }
        let mut next = config.clone();
        let mut entries = Vec::new();
        let mut tx = Transaction::begin(self.store().dir().join("group-switch.json"))?;
        let operation = (|| -> Result<()> {
            for entry in &owned {
                if ids.contains(&entry.skill_id) && entry.target_path.is_dir() {
                    entries.push(entry.clone());
                    continue;
                }
                tx.reserve(&entry.target_path)?;
                next.remove_registration(&entry.skill_id, agent_id);
            }
            // Keep the native config bytes in the outer journal before adding path enable rules.
            if !additions.is_empty() || !manual_toggles.is_empty() {
                if let Some(path) = agent.toggle_config_path(&config.settings.agent_dir_overrides) {
                    let bytes = match std::fs::read(&path) {
                        Ok(b) => Some(b),
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                        Err(e) => return Err(Error::io(&path, e)),
                    };
                    tx.reserve(&path)?;
                    if let Some(bytes) = bytes {
                        atomic::atomic_write(&path, &bytes)?;
                    }
                }
            }
            for (_, name, document, enabled) in &manual_toggles {
                native_toggle::set_skill_enabled_at(
                    agent,
                    &config.settings.agent_dir_overrides,
                    name,
                    document,
                    *enabled,
                )?;
            }
            for (skill, dest) in &additions {
                // Recheck before reserving: don't overwrite an entry created during preflight.
                if dest.symlink_metadata().is_ok() {
                    return Err(Error::invalid("目标已存在，停止切换"));
                }
                tx.reserve(dest)?;
                linker::copy_tree(&skill.source_path, dest)?;
                let hash = scanner::dir_content_hash(&skill.source_path)?;
                if scanner::dir_content_hash(dest)? != hash {
                    return Err(Error::invalid("分组副本校验失败"));
                }
                atomic::write_json_file(
                    &dest.join(scanner::COPY_SIDECAR),
                    &scanner::CopySidecar {
                        skill_id: skill.id.clone(),
                        source_path: skill.source_path.clone(),
                        source_hash: hash.clone(),
                        copied_at: linker::now_secs(),
                    },
                )?;
                if agent
                    .toggle_config_path(&config.settings.agent_dir_overrides)
                    .is_some()
                {
                    let fm = scanner::parse_frontmatter(&dest.join("SKILL.md"));
                    native_toggle::set_skill_enabled_at(
                        agent,
                        &config.settings.agent_dir_overrides,
                        &if agent_id == "codex" {
                            fm.name.unwrap_or_else(|| skill.name.clone())
                        } else {
                            skill.name.clone()
                        },
                        &dest.join("SKILL.md"),
                        true,
                    )?;
                }
                next.set_registration(
                    &skill.id,
                    agent_id,
                    Registration {
                        mode: LinkMode::Copy,
                        target_path: dest.clone(),
                        registered_at: linker::now_secs(),
                        source_hash_at_copy: Some(hash),
                    },
                );
                entries.push(GroupEntry {
                    skill_id: skill.id.clone(),
                    source_path: skill.source_path.clone(),
                    target_path: dest.clone(),
                });
            }
            if let Some(group) = &group {
                next.active_groups.insert(
                    agent_id.into(),
                    ActiveGroup {
                        group_id: group.id.clone(),
                        skill_ids: ids.clone(),
                        entries,
                        suspended_manual,
                        preserve_manual_skills: config.settings.preserve_manual_skills,
                    },
                );
            } else {
                next.active_groups.remove(agent_id);
            }
            tx.reserve(&self.store().config_path())?;
            self.save_config(&next)?;
            Ok(())
        })();
        if let Err(e) = operation {
            if let Err(recovery) = tx.rollback() {
                return Err(Error::Other(format!(
                    "{e}；回滚未完成，请重启恢复：{recovery}"
                )));
            }
            return Err(e);
        }
        tx.commit()?;
        *config = next;
        Ok(())
    }
}
