use crate::remote::{self, ServerProfile};
use serde_json::Value;
use tauri::Manager;

#[tauri::command]
pub fn list_servers() -> Result<Vec<ServerProfile>, String> {
    remote::profiles()
}

#[tauri::command]
pub fn save_servers(servers: Vec<ServerProfile>) -> Result<(), String> {
    remote::save_profiles(&servers)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn connect_server(
    app: tauri::AppHandle,
    profile: ServerProfile,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || remote::connect(&app, profile))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn disconnect_server(app: tauri::AppHandle, server_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        remote::disconnect(&app.state::<remote::RemoteState>(), &server_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn remote_request(
    app: tauri::AppHandle,
    server_id: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remote::request(
            &app.state::<remote::RemoteState>(),
            &server_id,
            &method,
            params,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub fn answer_ssh_prompt(
    app: tauri::AppHandle,
    request_id: String,
    answer: Option<String>,
) -> Result<(), String> {
    remote::answer(&app.state::<remote::RemoteState>(), &request_id, answer)
}

#[tauri::command]
pub async fn list_ssh_hosts() -> Result<crate::ssh_config::ConfigHosts, String> {
    tauri::async_runtime::spawn_blocking(crate::ssh_config::list)
        .await
        .map_err(|e| e.to_string())?
}
