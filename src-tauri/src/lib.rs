mod commands;
mod error;
mod state;

pub use error::AppError;
pub use state::AppState;

use tauri::Manager;

fn config_dir() -> std::path::PathBuf {
    // 测试逃生阀：Windows 上 dirs::home_dir() 走 Known Folder API，
    // 不受 HOME/USERPROFILE 影响，测试无法隔离真实用户目录。
    if let Ok(dir) = std::env::var("SKILL_STUDIO_TEST_HOME") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return std::path::PathBuf::from(trimmed).join(".skill-studio");
        }
    }
    // 不要直接读 HOME：它可能被 Git/Cygwin/MSYS 注入，导致配置路径漂移。
    dirs::home_dir()
        .unwrap_or_else(|| {
            log::warn!("无法获取用户主目录，回退到当前目录");
            std::path::PathBuf::from(".")
        })
        .join(".skill-studio")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir = config_dir();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Folder {
                        path: dir.join("logs"),
                        file_name: Some("skill-studio".into()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(AppState::new(dir))
        .invoke_handler(tauri::generate_handler![
            commands::set_window_theme,
            commands::get_init_error,
        ])
        .setup(|app| {
            // 窗口在 tauri.conf.json 里是 visible: false，等前端挂载好再显示，
            // 避免深色模式下先闪一帧白底。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Skill Studio 失败");
}
