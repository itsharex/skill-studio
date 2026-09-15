use std::sync::OnceLock;
use std::sync::RwLock;

/// 启动期错误的暂存处。前端首屏 `invoke("get_init_error")` 拉取，
/// 拿到非空就渲染恢复界面而不是主界面。
fn slot() -> &'static RwLock<Option<String>> {
    static SLOT: OnceLock<RwLock<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| RwLock::new(None))
}

pub fn set(message: impl Into<String>) {
    let message = message.into();
    log::error!("初始化失败: {message}");
    if let Ok(mut guard) = slot().write() {
        *guard = Some(message);
    }
}

pub fn get() -> Option<String> {
    slot().read().ok().and_then(|g| g.clone())
}
