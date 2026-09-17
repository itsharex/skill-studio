use super::{scanner, studio::Studio};
use crate::{
    fs::paths,
    models::{config::AppConfig, project::ProjectBinding, skill::skill_id_for},
    Result,
};
use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocalSkill {
    #[serde(flatten)]
    pub entry: scanner::ScannedEntry,
    pub collected: bool,
    pub managed: bool,
    pub disabled: bool,
    pub storage_path: PathBuf,
    pub tokens: crate::models::skill::TokenEstimate,
}

impl Studio {
    pub fn project_local_skills(
        &self,
        config: &AppConfig,
        project: &ProjectBinding,
    ) -> Result<Vec<ProjectLocalSkill>> {
        let hub = self.store().hub_dir(config);
        let mut entries = scanner::scan_project(&project.root)?;
        let suspended: Vec<_> = self
            .skill_backups()?
            .into_iter()
            .filter(|r| r.disabled && r.scope == format!("project:{}", project.id))
            .collect();
        for r in &suspended {
            let payload = self.backup_payload(r);
            let agent = crate::models::agent::AGENTS
                .iter()
                .find(|a| a.project_root(&project.root).as_deref() == r.original_path.parent());
            if let Some(a) = agent {
                entries.push(scanner::ScannedEntry {
                    name: r.name.clone(),
                    path: r.original_path.clone(),
                    root: r.original_path.parent().unwrap().into(),
                    agent_id: a.id.into(),
                    kind: scanner::classify_entry(&payload),
                    frontmatter: payload
                        .join("SKILL.md")
                        .is_file()
                        .then(|| scanner::parse_frontmatter(&payload.join("SKILL.md"))),
                });
            }
        }
        entries
            .into_iter()
            .map(|entry| {
                let managed = project
                    .managed_entries
                    .iter()
                    .any(|e| paths::paths_alias(&e.target_path, &entry.path));
                let collected =
                    entry.path.canonicalize().is_ok_and(|p| {
                        hub.canonicalize()
                            .is_ok_and(|h| p.parent() == Some(h.as_path()))
                    }) || config.skill_installations.iter().any(|(id, installation)| {
                        installation
                            .source
                            .strip_prefix("local:")
                            .is_some_and(|source| {
                                paths::paths_alias(Path::new(source), &entry.path)
                            })
                            && *id == skill_id_for(&hub.join(&installation.skill_id))
                            && hub.join(&installation.skill_id).join("SKILL.md").is_file()
                    });
                let record = suspended.iter().find(|r| r.original_path == entry.path);
                let storage_path = record
                    .map(|r| self.backup_payload(r))
                    .unwrap_or_else(|| entry.path.clone());
                Ok(ProjectLocalSkill {
                    tokens: super::tokens::estimate_skill(&storage_path),
                    disabled: record.is_some(),
                    storage_path,
                    entry,
                    collected,
                    managed,
                })
            })
            .collect()
    }

    pub fn delete_project_local_skill(
        &self,
        config: &AppConfig,
        project_id: &str,
        path: &Path,
    ) -> Result<()> {
        self.stash_skill(config, &format!("project:{project_id}"), path, false)
    }
}
