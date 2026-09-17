// 生产构建下不弹控制台窗口（Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
