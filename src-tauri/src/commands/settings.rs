use std::collections::HashMap;
use std::path::PathBuf;

use skill_studio_core::models::config::{AppConfig, Settings};
use skill_studio_core::models::skill::LinkMode;
use tauri::State;

use crate::state::AppState;

/// 整份配置（前端首屏一次性拿走）
#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config().clone())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.config().settings.clone())
}

/// 设置的增量补丁。字段为 `None` 表示不改动。
///
/// 用一个结构体而不是一长串可选参数：Tauri 命令参数超过 7 个 clippy 会报警，
/// 而且前端只想改一项时也不必凑齐全部参数。
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub default_link_mode: Option<LinkMode>,
    pub preserve_manual_skills: Option<bool>,
    pub language: Option<String>,
    pub theme: Option<String>,
    pub agent_dir_overrides: Option<HashMap<String, PathBuf>>,
    pub hub_dir: Option<PathBuf>,
    /// 显式把 Hub 目录恢复为默认值（`hub_dir: None` 只是"不改动"）
    pub clear_hub_dir: Option<bool>,
    pub backup_keep: Option<usize>,
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    state
        .mutate(|studio, config| {
            let paths_changed = patch.hub_dir.is_some()
                || patch.clear_hub_dir.unwrap_or(false)
                || patch.agent_dir_overrides.is_some();
            let old_hub = studio.store().hub_dir(config);
            let s = &mut config.settings;
            if let Some(preserve) = patch.preserve_manual_skills {
                s.preserve_manual_skills = preserve;
            }
            if let Some(m) = patch.default_link_mode {
                s.default_link_mode = m;
            }
            if let Some(l) = patch.language {
                s.language = l;
            }
            if let Some(t) = patch.theme {
                s.theme = t;
            }
            if let Some(o) = patch.agent_dir_overrides {
                // 空路径视为取消该 agent 的覆盖
                let next: HashMap<_, _> = o
                    .into_iter()
                    .filter(|(_, v)| !v.as_os_str().is_empty())
                    .collect();
                if config
                    .active_groups
                    .keys()
                    .any(|id| next.get(id) != s.agent_dir_overrides.get(id))
                {
                    return Err(skill_studio_core::Error::invalid(
                        "请先停用该 Agent 的分组，再修改目录",
                    ));
                }
                s.agent_dir_overrides = next;
            }
            if patch.clear_hub_dir.unwrap_or(false) {
                s.hub_dir = None;
            } else if let Some(h) = patch.hub_dir {
                s.hub_dir = Some(h);
            }
            if let Some(k) = patch.backup_keep {
                // 上限兜一下，避免用户填个天文数字把磁盘写满
                s.backup_keep = k.min(100);
            }
            let result = s.clone();
            if paths_changed {
                validate_hub_change(&old_hub, &studio.store().hub_dir(config), config)?;
            }
            Ok(result)
        })
        .map_err(Into::into)
}

/// 配置备份列表，最新在前
#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state
        .studio()
        .store()
        .list_backups()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// 从备份恢复配置。恢复动作本身也会先备份当前状态，可再次回退。
#[tauri::command(rename_all = "camelCase")]
pub fn restore_backup(state: State<'_, AppState>, path: String) -> Result<AppConfig, String> {
    state
        .restore_backup(std::path::Path::new(&path))
        .map_err(Into::into)
}

/// 配置目录路径，供前端"在 Finder 中显示"用
#[tauri::command]
pub fn get_config_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.studio().store().dir().to_string_lossy().to_string())
}

/// 用系统默认程序打开一个路径（文件管理器 / 编辑器）
#[tauri::command(rename_all = "camelCase")]
pub fn reveal_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("打开路径失败: {e}"))
}

fn validate_hub_change(
    old_hub: &std::path::Path,
    hub: &std::path::Path,
    config: &AppConfig,
) -> skill_studio_core::Result<()> {
    use skill_studio_core::{fs::paths, models::agent::AGENTS, services::linker, Error};
    if !hub.is_absolute() {
        return Err(Error::invalid("请选择绝对路径作为 Hub 目录"));
    }
    let roots: Vec<_> = AGENTS
        .iter()
        .flat_map(|a| a.resolved_global_roots(&config.settings.agent_dir_overrides))
        .collect();
    linker::ensure_distinct_roots(hub, &roots)?;
    if !paths::paths_alias(hub, old_hub)
        && (!config.active_groups.is_empty()
            || (old_hub.exists()
                && std::fs::read_dir(old_hub)
                    .map_err(|e| Error::io(old_hub, e))?
                    .next()
                    .is_some()))
    {
        return Err(Error::invalid(
            "当前 Hub 非空或有启用中的分组，请先移出或剔除收录的 skill；修改目录不会自动迁移文件",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hub_change_rejects_relative_overlapping_and_nonempty_roots() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old");
        let new = temp.path().join("new");
        std::fs::create_dir(&old).unwrap();
        let mut config = AppConfig::default();
        assert!(validate_hub_change(&old, &new, &config).is_ok());
        assert!(validate_hub_change(&old, std::path::Path::new("relative"), &config).is_err());
        config
            .settings
            .agent_dir_overrides
            .insert("codex".into(), new.clone());
        assert!(validate_hub_change(&old, &new, &config).is_err());
        config.settings.agent_dir_overrides.clear();
        std::fs::write(old.join("SKILL.md"), "keep").unwrap();
        assert!(validate_hub_change(&old, &new, &config).is_err());
        assert!(validate_hub_change(&old, &old, &config).is_ok());
    }
}
