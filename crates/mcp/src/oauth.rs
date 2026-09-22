use async_trait::async_trait;
use rmcp::transport::auth::{
    AuthError, CredentialRefreshGuard, CredentialStore, StoredCredentials,
};
use skill_studio_core::fs::atomic;
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Credentials {
    pub path: PathBuf,
    pub refresh: Arc<Mutex<()>>,
    pub active: Arc<std::sync::Mutex<bool>>,
}
fn err(e: impl std::fmt::Display) -> AuthError {
    AuthError::CredentialStoreError(e.to_string())
}
#[async_trait]
impl CredentialStore for Credentials {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        let active = self.active.lock().map_err(err)?;
        if !*active {
            return Ok(None);
        }
        atomic::read_json_file(&self.path).map_err(err)
    }
    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        let active = self.active.lock().map_err(err)?;
        if !*active {
            return Err(err("授权已清除，请重新连接"));
        }
        atomic::write_json_file(&self.path, &credentials).map_err(err)
    }
    async fn clear(&self) -> Result<(), AuthError> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(err(e)),
        }
    }
    async fn acquire_refresh_guard(&self) -> Result<Option<CredentialRefreshGuard>, AuthError> {
        Ok(Some(CredentialRefreshGuard::new(
            self.refresh.clone().lock_owned().await,
        )))
    }
}

impl Credentials {
    pub fn revoke(&self) -> Result<(), AuthError> {
        let mut active = self.active.lock().map_err(err)?;
        *active = false;
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(err(e)),
        }
    }
}
