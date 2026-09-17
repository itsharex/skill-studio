use skill_studio_core::models::skill::{LinkMode, LinkReport, Skill};
use skill_studio_core::services::studio::SkillView;
use tauri::State;

use crate::state::AppState;

/// 扫描全部 skill 真身及其在各 agent 上的状态
#[tauri::command]
pub fn scan_skills(state: State<'_, AppState>) -> Result<Vec<SkillView>, String> {
    state.scan_with_policy().map_err(Into::into)
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
    skill_id: String,
    agent_id: String,
    enabled: bool,
) -> Result<(), String> {
    state
        .with_exclusive(|studio, config| {
            studio.set_skill_enabled(config, &skill_id, &agent_id, enabled)
        })
        .map_err(Into::into)
}

/// 把一个原地 skill 收编到 Hub 集中托管
#[tauri::command(rename_all = "camelCase")]
pub fn adopt_to_hub(state: State<'_, AppState>, skill_id: String) -> Result<Skill, String> {
    state.adopt_to_hub(&skill_id).map_err(Into::into)
}

/// 清理引用了已消失 skill 的分组成员与注册记录，返回清理条数
#[tauri::command]
pub fn prune_missing(state: State<'_, AppState>) -> Result<usize, String> {
    state
        .mutate(|studio, config| studio.prune(config))
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn release_from_hub(state: State<'_, AppState>, skill_id: String) -> Result<Skill, String> {
    state.release_from_hub(&skill_id).map_err(Into::into)
}

#[tauri::command]
pub async fn search_catalog_skills(
    query: String,
) -> Result<Vec<skill_studio_core::services::marketplace::CatalogSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        skill_studio_core::services::marketplace::search(&query).map_err(String::from)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_catalog_skill(
    app: tauri::AppHandle,
    source: String,
    skill_id: String,
) -> Result<Skill, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = skill_studio_core::services::marketplace::prepare(&source, &skill_id)
            .map_err(String::from)?;
        app.state::<AppState>()
            .install_catalog_skill(&prepared)
            .map_err(String::from)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discover_local_skills(
    path: String,
) -> Result<Vec<skill_studio_core::services::marketplace::LocalSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        skill_studio_core::services::marketplace::discover_local(std::path::Path::new(&path))
            .map_err(String::from)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_local_skill(app: tauri::AppHandle, path: String) -> Result<Skill, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared =
            skill_studio_core::services::marketplace::prepare_local(std::path::Path::new(&path))
                .map_err(String::from)?;
        app.state::<AppState>()
            .install_catalog_skill(&prepared)
            .map_err(String::from)
    })
    .await
    .map_err(|e| e.to_string())?
}
