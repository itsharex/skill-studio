use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use skill_studio_core::fs::atomic;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub connection: Connection,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub oauth: bool,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
}
fn yes() -> bool {
    true
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "transport", rename_all = "lowercase")]
pub enum Connection {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default)]
        cwd: Option<PathBuf>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Binding {
    pub id: String,
    pub agent: String,
    pub path: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub bindings: Vec<Binding>,
    pub port: u16,
    pub admin_token: String,
    pub servers: Vec<Server>,
    pub tokens: BTreeMap<String, String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            bindings: vec![],
            port: 0,
            admin_token: uuid::Uuid::new_v4().to_string(),
            servers: vec![],
            tokens: BTreeMap::new(),
        }
    }
}
pub fn read(dir: &Path) -> Result<Config> {
    Ok(atomic::read_json_file(&dir.join("config.json"))?.unwrap_or_default())
}
pub fn save(dir: &Path, config: &Config) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    atomic::write_json_file(&dir.join("config.json"), config)?;
    Ok(())
}
pub fn validate(s: &Server) -> Result<()> {
    if s.id.is_empty()
        || !s
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        bail!("MCP ID 只能包含字母、数字、横线和下划线");
    }
    if s.name.trim().is_empty() {
        bail!("请填写名称");
    }
    match &s.connection {
        Connection::Stdio { command, .. } => {
            if command.trim().is_empty() {
                bail!("请填写启动命令");
            }
            if s.oauth {
                bail!("stdio 服务的认证由服务自身管理");
            }
        }
        Connection::Http { url, headers } => {
            let u = reqwest::Url::parse(url)?;
            if !matches!(u.scheme(), "https" | "http")
                || !u.username().is_empty()
                || u.password().is_some()
                || u.fragment().is_some()
            {
                bail!("请使用不含用户名、密码和片段的 HTTP(S) 地址");
            }
            for (k, v) in headers {
                let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())?;
                reqwest::header::HeaderValue::from_str(v)?;
                if matches!(
                    name.as_str(),
                    "host"
                        | "mcp-session-id"
                        | "mcp-protocol-version"
                        | "content-length"
                        | "connection"
                ) {
                    bail!("不能覆盖协议请求头 {k}");
                }
                if s.oauth && name == reqwest::header::AUTHORIZATION {
                    bail!("OAuth 与 Authorization 请求头不能同时配置");
                }
            }
        }
    }
    Ok(())
}
