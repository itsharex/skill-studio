use crate::state::AppState;
use skill_studio_core::models::agent::AgentInfo;
use tauri::State;

#[tauri::command(rename_all = "camelCase")]
pub async fn list_agents(
    state: State<'_, AppState>,
    skip_cli_probe: Option<bool>,
) -> Result<Vec<AgentInfo>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_studio_service::agents::list_agents(&state, skip_cli_probe)
    })
    .await
    .map_err(|e| e.to_string())?
}
