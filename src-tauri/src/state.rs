use std::sync::Arc;

/// 全局状态。内部用 `Arc` 持有各服务，本身 `Clone`，
/// 锁下沉到最内层，避免持有粗粒度锁跨 await（cc-switch 的做法）。
#[derive(Clone)]
pub struct AppState {
    /// 配置目录（`~/.skill-studio`），启动时解析一次
    pub config_dir: Arc<std::path::PathBuf>,
}

impl AppState {
    pub fn new(config_dir: std::path::PathBuf) -> Self {
        Self {
            config_dir: Arc::new(config_dir),
        }
    }
}
