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

/// 后端初始化期的错误暂存，供前端在首屏拉取。
/// 目前恒为 None，等 store 接入后会返回配置加载失败的详情。
#[tauri::command]
pub fn get_init_error() -> Option<String> {
    None
}
