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
        .mutate(|_, config| {
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
            Ok(s.clone())
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
    let restored = state
        .studio()
        .store()
        .restore_backup(std::path::Path::new(&path))
        .map_err(|e| e.to_string())?;
    // 内存里的配置也要换成恢复后的，否则下一次写入会把它盖回去
    state
        .mutate(|_, config| {
            *config = restored.clone();
            Ok(())
        })
        .map_err(|e: skill_studio_core::Error| e.to_string())?;
    Ok(restored)
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
