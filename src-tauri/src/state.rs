use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use skill_studio_core::models::config::AppConfig;
use skill_studio_core::services::store::Store;
use skill_studio_core::services::studio::Studio;
use skill_studio_core::Result;

/// 全局状态。内部全 `Arc`，本身 `Clone`；锁只包住 `AppConfig`，
/// 不做粗粒度全局锁（cc-switch 的教训：粗锁跨 IO 会连锁阻塞）。
#[derive(Clone)]
pub struct AppState {
    studio: Arc<Studio>,
    config: Arc<RwLock<AppConfig>>,
}

impl AppState {
    /// 启动时加载配置。加载失败**不静默回落默认值**，把错误交给上层决定怎么提示。
    pub fn bootstrap(store: Store) -> Result<Self> {
        let studio = Studio::new(store);
        let config = studio.load_config()?;
        Ok(Self {
            studio: Arc::new(studio),
            config: Arc::new(RwLock::new(config)),
        })
    }

    pub fn studio(&self) -> &Studio {
        &self.studio
    }

    /// 读配置。锁被毒化时恢复而不 panic（cc-switch 的惯例）。
    pub fn config(&self) -> RwLockReadGuard<'_, AppConfig> {
        self.config.read().unwrap_or_else(|poisoned| {
            log::warn!("配置读锁被毒化，已恢复");
            poisoned.into_inner()
        })
    }

    fn config_mut(&self) -> RwLockWriteGuard<'_, AppConfig> {
        self.config.write().unwrap_or_else(|poisoned| {
            log::warn!("配置写锁被毒化，已恢复");
            poisoned.into_inner()
        })
    }

    /// 在写锁内改配置，成功后立刻落盘。
    ///
    /// 落盘失败会把内存里的改动一起报错返回 —— 让用户知道这次改动没有持久化，
    /// 而不是界面看起来成功、重启后消失。
    pub fn mutate<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Studio, &mut AppConfig) -> Result<T>,
    {
        let mut guard = self.config_mut();
        let outcome = f(&self.studio, &mut guard)?;
        self.studio.save_config(&guard)?;
        Ok(outcome)
    }

    /// Hub adoption persists its own filesystem/config transaction under the write lock.
    pub fn adopt_to_hub(&self, skill_id: &str) -> Result<skill_studio_core::models::skill::Skill> {
        let mut guard = self.config_mut();
        self.studio.adopt_to_hub(&mut guard, skill_id)
    }

    /// Native settings writes share the configuration write lock to prevent two
    /// toggles from replacing each other's read/modify/write results.
    pub fn with_exclusive<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Studio, &AppConfig) -> Result<T>,
    {
        let guard = self.config_mut();
        f(&self.studio, &guard)
    }

    /// 只读操作
    pub fn with_config<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Studio, &AppConfig) -> Result<T>,
    {
        let guard = self.config();
        f(&self.studio, &guard)
    }
}
