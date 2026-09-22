// 生产构建下不弹控制台窗口（Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--mcp-client") {
        let Some(id) = std::env::args().nth(2) else {
            std::process::exit(2);
        };
        let Some(dir) = std::env::args_os().nth(3) else {
            std::process::exit(2);
        };
        let result = tokio::runtime::Runtime::new()
            .expect("MCP runtime")
            .block_on(skill_studio_mcp::gateway::bridge_stdio(dir.into(), id));
        if let Err(error) = result {
            eprintln!("MCP gateway: {error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--mcp-daemon") {
        let Some(dir) = std::env::args_os().nth(2) else {
            std::process::exit(2);
        };
        let result = tokio::runtime::Runtime::new()
            .expect("MCP runtime")
            .block_on(skill_studio_mcp::gateway::serve(dir.into()));
        if let Err(error) = result {
            eprintln!("MCP gateway: {error}");
            std::process::exit(1);
        }
        return;
    }
    if skill_studio_lib::remote::run_askpass() {
        return;
    }
    // Linux 上 WebKitGTK 的 DMABUF 渲染器在多数发行版里会导致白屏，
    // 必须在 GTK 初始化之前设好这两个变量。
    #[cfg(target_os = "linux")]
    {
        if std::env::var("SKILL_STUDIO_GDK_BACKEND").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    skill_studio_lib::run();
}
