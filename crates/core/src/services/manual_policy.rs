//! Persistent policy for installed skills outside the active combination.
use super::{
    linker, native_toggle, scanner,
    studio::{SkillView, Studio},
    transaction::Transaction,
};
use crate::{
    fs::{atomic, paths},
    models::{
        agent::{require_agent, AGENTS},
        config::AppConfig,
        group::GroupEntry,
    },
    Error, Result,
};
use std::path::PathBuf;
type Toggle = (String, String, PathBuf, bool);
pub(crate) fn plan(
    config: &AppConfig,
    agent_id: &str,
    ids: &[String],
    views: &[SkillView],
) -> Result<(Vec<GroupEntry>, Vec<Toggle>)> {
    let agent = require_agent(agent_id)?;
    let active = config.active_groups.get(agent_id);
    let owned = active.map(|g| g.entries.as_slice()).unwrap_or_default();
    let previously_suspended: Vec<_> = config
        .policy_suspensions
        .get(agent_id)
        .into_iter()
        .flatten()
        .chain(active.into_iter().flat_map(|g| &g.suspended_manual))
        .collect();
    let mut suspended_manual = Vec::new();
    let mut manual_toggles = Vec::new();
    for view in views {
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
                && !super::studio::restored_entry(config, &view.skill, target)
            {
                continue;
            }
            let was_suspended = previously_suspended.iter().any(|e| {
                e.target_path == *target
                    && (paths::paths_alias(&e.source_path, &view.skill.source_path)
                        || super::studio::restored_entry(config, &view.skill, target))
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
            let keep = config
                .settings
                .disabled_agents
                .iter()
                .any(|id| id == agent_id)
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

    Ok((suspended_manual, manual_toggles))
}
impl Studio {
    pub fn reconcile_manual_policy(&self, config: &mut AppConfig, force_save: bool) -> Result<()> {
        let views = self.scan_skills(config)?;
        let mut next = config.clone();
        let mut updates = Vec::new();
        for agent in AGENTS {
            if config
                .settings
                .disabled_agents
                .iter()
                .any(|id| id == agent.id)
            {
                continue;
            }
            let ids = config
                .active_groups
                .get(agent.id)
                .map(|g| g.skill_ids.as_slice())
                .unwrap_or_default();
            let (suspended, toggles) = plan(config, agent.id, ids, &views)?;
            if suspended.is_empty() {
                next.policy_suspensions.remove(agent.id);
            } else {
                next.policy_suspensions.insert(agent.id.into(), suspended);
            }
            if let Some(group) = next.active_groups.get_mut(agent.id) {
                group.suspended_manual.clear();
                group.preserve_manual_skills = config.settings.preserve_manual_skills;
            }
            if !toggles.is_empty() {
                updates.push((agent, toggles));
            }
        }
        if !force_save
            && updates.is_empty()
            && serde_json::to_value(&next).map_err(|source| Error::JsonSerialize { source })?
                == serde_json::to_value(&*config)
                    .map_err(|source| Error::JsonSerialize { source })?
        {
            return Ok(());
        }
        let mut tx = Transaction::begin(self.store().dir().join("manual-policy.json"))?;
        let result = (|| -> Result<()> {
            for (agent, toggles) in updates {
                let path = agent
                    .toggle_config_path(&config.settings.agent_dir_overrides)
                    .ok_or_else(|| Error::invalid("Agent 不支持启停"))?;
                let bytes = match std::fs::read(&path) {
                    Ok(bytes) => Some(bytes),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                    Err(e) => return Err(Error::io(&path, e)),
                };
                tx.reserve(&path)?;
                if let Some(bytes) = bytes {
                    atomic::atomic_write(&path, &bytes)?;
                }
                for (_, name, document, enabled) in toggles {
                    native_toggle::set_skill_enabled_at(
                        agent,
                        &config.settings.agent_dir_overrides,
                        &name,
                        &document,
                        enabled,
                    )?;
                }
            }
            tx.reserve(&self.store().config_path())?;
            self.save_config(&next)?;
            Ok(())
        })();
        if let Err(error) = result {
            tx.rollback()?;
            return Err(error);
        }
        tx.commit()?;
        *config = next;
        Ok(())
    }
}
