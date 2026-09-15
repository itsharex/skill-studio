use skill_studio_core::models::skill::{LinkMode, LinkReport, Skill};
use skill_studio_core::services::studio::SkillView;
use tauri::State;

use crate::state::AppState;

/// 扫描全部 skill 真身及其在各 agent 上的状态
#[tauri::command]
pub fn scan_skills(state: State<'_, AppState>) -> Result<Vec<SkillView>, String> {
    state
        .with_config(|studio, config| studio.scan_skills(config))
        .map_err(Into::into)
}

/// 把若干 skill 注册到若干 agent。单条失败不影响其余，结果在报告里逐条给出。
#[tauri::command(rename_all = "camelCase")]
pub fn register_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    agent_ids: Vec<String>,
    mode: Option<LinkMode>,
    force: Option<bool>,
) -> Result<LinkReport, String> {
    state
        .mutate(|studio, config| {
            studio.register(config, &skill_ids, &agent_ids, mode, force.unwrap_or(false))
        })
        .map_err(Into::into)
}

/// 取消注册。只移除本工具管理的内容，用户手工放的会作为失败条目返回。
#[tauri::command(rename_all = "camelCase")]
pub fn unregister_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    agent_ids: Vec<String>,
    force: Option<bool>,
) -> Result<LinkReport, String> {
    state
        .mutate(|studio, config| {
            studio.unregister(config, &skill_ids, &agent_ids, force.unwrap_or(false))
        })
        .map_err(Into::into)
}

/// 通过 agent 原生配置启停某个 skill（不动文件）
#[tauri::command(rename_all = "camelCase")]
pub fn set_skill_enabled(
    state: State<'_, AppState>,
    skill_name: String,
    agent_id: String,
    enabled: bool,
) -> Result<(), String> {
    state
        .with_config(|studio, config| {
            studio.set_skill_enabled(config, &skill_name, &agent_id, enabled)
        })
        .map_err(Into::into)
}

/// 把一个原地 skill 收编到 Hub 集中托管
#[tauri::command(rename_all = "camelCase")]
pub fn adopt_to_hub(state: State<'_, AppState>, skill_id: String) -> Result<Skill, String> {
    state
        .mutate(|studio, config| studio.adopt_to_hub(config, &skill_id))
        .map_err(Into::into)
}

/// 清理引用了已消失 skill 的分组成员与注册记录，返回清理条数
#[tauri::command]
pub fn prune_missing(state: State<'_, AppState>) -> Result<usize, String> {
    state
        .mutate(|studio, config| studio.prune(config))
        .map_err(Into::into)
}
