use tauri::{Manager, Theme};

/// 让原生标题栏跟随应用主题。传 "system" 时交回给操作系统。
#[tauri::command]
pub fn set_window_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    let resolved = match theme.as_str() {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        "system" => None,
        other => return Err(format!("未知主题: {other}")),
    };
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window
        .set_theme(resolved)
        .map_err(|e| format!("设置窗口主题失败: {e}"))
}

/// 启动期错误。前端首屏拉取，非空则渲染恢复界面而不是主界面。
#[tauri::command]
pub fn get_init_error() -> Option<String> {
    crate::init_status::get()
}

/// 应用版本，用于设置页展示
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
