//! Read native MCP definitions without starting processes or touching auth caches.
use crate::config::{self, Connection, Server};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct ScanFile {
    pub agent: String,
    pub path: PathBuf,
    pub scope: String,
}

/// Shared native paths for desktop management and the remote read-only inventory.
pub fn scan_files(
    config: &skill_studio_core::models::config::AppConfig,
) -> (Vec<ScanFile>, Vec<String>) {
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for agent in crate::agents::IDS {
        match crate::agents::global_files(agent, &config.settings.agent_dir_overrides) {
            Ok(paths) => files.extend(paths.into_iter().map(|path| ScanFile {
                agent: (*agent).into(),
                path,
                scope: "用户全局".into(),
            })),
            Err(e) => warnings.push(e.to_string()),
        }
        for project in &config.projects {
            if let Ok(paths) = crate::agents::project_files(agent, &project.root) {
                files.extend(paths.into_iter().map(|path| ScanFile {
                    agent: (*agent).into(),
                    path,
                    scope: format!("项目 · {}", project.name),
                }));
            }
        }
    }
    (files, warnings)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub agent: String,
    pub path: PathBuf,
    pub scope: String,
    pub key: String,
    pub enabled: bool,
    pub gateway: bool,
    pub project: Option<String>,
    pub definition: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovered {
    pub id: String,
    pub name: String,
    pub server: Option<Server>,
    pub sources: Vec<Source>,
    pub issue: Option<String>,
    pub managed_id: Option<String>,
    #[serde(skip)]
    comparison: Value,
}
/// Identify bundled executables, never service names alone. Unknown paths remain user-managed.
pub fn is_codex_builtin(value: &Value) -> bool {
    let Some(command) = value["command"].as_str() else {
        return false;
    };
    let command = command.replace('\\', "/");
    [
        "ChatGPT.app/Contents/Resources/cua_node/bin/node_repl",
        "Codex.app/Contents/Resources/cua_node/bin/node_repl",
        "Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
    ].iter().any(|suffix| command == *suffix || command.strip_suffix(suffix).is_some_and(|prefix| prefix.ends_with('/')))
}

#[derive(Serialize)]
pub struct BuiltinService {
    pub name: String,
    pub agent: String,
    pub path: PathBuf,
    pub scope: String,
}
#[derive(Default, Serialize)]
pub struct ScanResult {
    pub builtins: Vec<BuiltinService>,
    pub discovered: Vec<Discovered>,
    pub warnings: Vec<String>,
}

pub fn scan(files: &[ScanFile], managed: &[Server], studio_dir: &Path) -> ScanResult {
    let mut result = ScanResult::default();
    let mut seen = std::collections::HashSet::new();
    let mut grok_disabled = std::collections::HashSet::new();
    for file in files {
        if !seen.insert((file.agent.clone(), file.path.clone(), file.scope.clone())) {
            continue;
        }
        let text = match std::fs::read_to_string(&file.path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                result
                    .warnings
                    .push(format!("无法读取 {}，请检查文件权限", file.path.display()));
                continue;
            }
        };
        let doc = match crate::native::document(&text, &file.agent) {
            Ok(doc) => doc,
            Err(e) => {
                result
                    .warnings
                    .push(format!("{}：{e}", file.path.display()));
                continue;
            }
        };
        match crate::native::entries(&doc, &file.agent) {
            Ok(Some(entries)) => {
                read_entries(&mut result, file, &json!(entries), managed, studio_dir)
            }
            Ok(None) => {}
            Err(e) => result
                .warnings
                .push(format!("{}：{e}", file.path.display())),
        }
        if file.agent == "grok" && file.scope == "用户全局" {
            if let Some(names) = doc["disabled_mcp_servers"].as_array() {
                grok_disabled.extend(names.iter().filter_map(Value::as_str).map(str::to_owned));
            }
        }
        // Claude stores local-scope definitions inside its user config, keyed by project path.
        if file.agent == "claude" {
            if let Some(projects) = doc.get("projects").and_then(Value::as_object) {
                for (path, project) in projects {
                    let scoped = ScanFile {
                        scope: format!("项目本地 · {path}"),
                        ..file.clone()
                    };
                    read_entries(
                        &mut result,
                        &scoped,
                        &project["mcpServers"],
                        managed,
                        studio_dir,
                    );
                }
            }
        }
    }
    for discovered in &mut result.discovered {
        for source in &mut discovered.sources {
            if source.agent == "grok" && grok_disabled.contains(&source.key) {
                source.enabled = false;
            }
        }
        if let Some(server) = &mut discovered.server {
            server.enabled = discovered.sources.iter().any(|s| s.enabled);
        }
    }
    result
}
fn connection_eq(a: &Server, b: &Server) -> bool {
    serde_json::to_value(&a.connection).ok() == serde_json::to_value(&b.connection).ok()
}
fn read_entries(
    result: &mut ScanResult,
    file: &ScanFile,
    entries: &Value,
    managed: &[Server],
    studio_dir: &Path,
) {
    if entries.is_null() {
        return;
    }
    let Some(entries) = entries.as_object() else {
        result.warnings.push(format!(
            "{} · {} 的 MCP 列表必须为对象",
            file.path.display(),
            file.scope
        ));
        return;
    };
    for (key, entry) in entries {
        if file.agent == "codex" && is_codex_builtin(entry) {
            result.builtins.push(BuiltinService {
                name: key.clone(),
                agent: file.agent.clone(),
                path: file.path.clone(),
                scope: file.scope.clone(),
            });
            continue;
        }
        let identity = json!([file.agent, file.path, file.scope, key]).to_string();
        let id = format!("discovered-{:x}", Sha256::digest(identity.as_bytes()));
        let canonical = crate::native::canonical(entry, &file.agent);
        let gateway = canonical["args"]
            .as_array()
            .is_some_and(|args| args.first().and_then(Value::as_str) == Some("--mcp-client"));
        let own = if gateway && canonical["args"][2].as_str().map(Path::new) == Some(studio_dir) {
            managed
                .iter()
                .find(|s| Some(s.id.as_str()) == canonical["args"][1].as_str())
        } else {
            None
        };
        let parsed = if let Some(server) = own {
            Ok(server.clone())
        } else if gateway {
            Err(anyhow::anyhow!(
                "这是网关转发入口，不能再次托管，以免形成循环"
            ))
        } else {
            normalize(key, &id, entry, &file.agent)
        };
        let (server, issue) = match parsed {
            Ok(s) => (Some(s), None),
            Err(e) => (None, Some(e.to_string())),
        };
        let source = Source {
            id: format!("source-{id}"),
            agent: file.agent.clone(),
            path: file.path.clone(),
            scope: file.scope.clone(),
            key: key.clone(),
            enabled: crate::native::enabled(entry, &file.agent),
            gateway,
            project: file.scope.strip_prefix("项目本地 · ").map(str::to_owned),
            definition: entry.clone(),
        };
        let managed_id = own
            .or_else(|| {
                server
                    .as_ref()
                    .and_then(|s| managed.iter().find(|m| connection_eq(s, m)))
            })
            .map(|s| s.id.clone());
        // Merge equivalent connections across names and agents, retaining every source.
        let comparison = comparison_key(entry, file);
        let existing = result.discovered.iter_mut().find(|d| {
            if managed_id.is_some() {
                d.managed_id == managed_id
            } else {
                d.managed_id.is_none()
                    && match (server.as_ref(), d.server.as_ref()) {
                        (Some(a), Some(b)) => connection_eq(a, b),
                        (None, None) => d.comparison == comparison,
                        _ => false,
                    }
            }
        });
        if let Some(existing) = existing {
            if let Some(s) = existing.server.as_mut() {
                s.enabled |= source.enabled;
            }
            existing.sources.push(source);
        } else {
            result.discovered.push(Discovered {
                id,
                name: key.clone(),
                server,
                sources: vec![source],
                issue,
                managed_id,
                comparison,
            });
        }
    }
}
// Preserve unknown fields when comparing read-only entries. Do not turn a partial
// parse into a definition that can be adopted with missing client behavior.
fn comparison_key(value: &Value, file: &ScanFile) -> Value {
    let mut result = crate::native::canonical(value, &file.agent);
    if let Some(object) = result.as_object_mut() {
        object.remove("enabled");
        if file.agent == "codex" {
            if let Some(headers) = object.remove("http_headers") {
                object.insert("headers".into(), headers);
            }
        }
        let http = object.contains_key("url");
        object
            .entry("type")
            .or_insert(json!(if http { "http" } else { "stdio" }));
        if http {
            object.entry("headers").or_insert(json!({}));
        } else {
            object.entry("args").or_insert(json!([]));
            object.entry("env").or_insert(json!({}));
            object.entry("cwd").or_insert(Value::Null);
            // Relative working directories can mean different things by scope.
            if object
                .get("cwd")
                .and_then(Value::as_str)
                .is_some_and(|cwd| !Path::new(cwd).is_absolute())
            {
                return json!([result, file.path, file.scope]);
            }
        }
    }
    result
}

pub fn normalize(name: &str, id: &str, value: &Value, agent: &str) -> Result<Server> {
    let value = crate::native::canonical(value, agent);
    let input = value.as_object().context("服务配置必须为对象")?;
    if input.get("type").is_some_and(|value| !value.is_string()) {
        bail!("传输类型必须为字符串");
    }
    let kind = input
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(if input.contains_key("url") {
            "http"
        } else {
            "stdio"
        });
    if !matches!(kind, "http" | "streamable-http" | "stdio") {
        bail!("暂不支持该传输类型，保留原 Agent 配置");
    }
    let http = kind != "stdio";
    if http && input.contains_key("command") || !http && input.contains_key("url") {
        bail!("连接类型与地址或命令冲突");
    }
    let allowed = if http {
        vec!["type", "url", "headers", "enabled"]
    } else {
        vec!["type", "command", "args", "env", "cwd", "enabled"]
    };
    let unknown: Vec<_> = input
        .keys()
        .filter(|k| !allowed.contains(&k.as_str()))
        .cloned()
        .collect();
    if !unknown.is_empty() {
        bail!(
            "暂不支持配置字段：{}。仍可在原 Agent 中使用",
            unknown.join("、")
        );
    }
    if contains_expansion(&value) {
        bail!("配置包含变量引用，暂不自动托管；仍由原 Agent 解析");
    }
    let mut normalized = value.clone();
    let object = normalized.as_object_mut().unwrap();
    object.remove("type");
    if let Some(headers) = object.remove("http_headers") {
        object.insert("headers".into(), headers);
    }
    object.insert("id".into(), json!(id));
    object.insert("name".into(), json!(name));
    object.insert(
        "transport".into(),
        json!(if http { "http" } else { "stdio" }),
    );
    // Avoid serde errors containing header/env values in UI or logs.
    let server: Server = serde_json::from_value(normalized)
        .map_err(|_| anyhow::anyhow!("配置字段类型无效，请在原 Agent 中检查"))?;
    config::validate(&server)
        .map_err(|_| anyhow::anyhow!("连接配置无效或包含不支持的请求头，请检查原配置"))?;
    if let Connection::Stdio { cwd: Some(cwd), .. } = &server.connection {
        if !cwd.is_absolute() {
            bail!("工作目录为相对路径，暂不自动托管，避免改变运行目录");
        }
    }
    Ok(server)
}
fn contains_expansion(value: &Value) -> bool {
    match value {
        Value::String(s) => s.contains("${") || s.contains("{env:") || s.contains("{file:"),
        Value::Array(a) => a.iter().any(contains_expansion),
        Value::Object(o) => o.values().any(contains_expansion),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(root: &Path, name: &str, agent: &str, text: &str) -> ScanFile {
        let path = root.join(name);
        std::fs::write(&path, text).unwrap();
        ScanFile {
            agent: agent.into(),
            path,
            scope: "用户全局".into(),
        }
    }
    #[test]
    fn builtins_are_read_only_and_names_alone_are_not_reserved() {
        let temp = tempfile::tempdir().unwrap();
        let text = r#"
[mcp_servers.node_repl]
command='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl'
[mcp_servers.computer-use]
command='./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient'
args=['mcp']
[mcp_servers.custom]
command='/usr/local/bin/node_repl'
"#;
        let f = file(temp.path(), "config.toml", "codex", text);
        let result = scan(std::slice::from_ref(&f), &[], temp.path());
        assert_eq!(result.builtins.len(), 2);
        assert_eq!(result.discovered.len(), 1);
        assert_eq!(result.discovered[0].name, "custom");
        let original = crate::native::entry(text, "codex", None, "node_repl").unwrap();
        assert!(crate::native::patch(text, "codex", None, "node_repl", &original, &None).is_err());
        assert!(crate::native::patch(
            text,
            "codex",
            None,
            "node_repl",
            &original,
            &Some(json!({"command":"demo"}))
        )
        .is_err());
        let canonical = crate::native::canonical(original.as_ref().unwrap(), "codex");
        assert!(crate::native::validate(&canonical).is_err());
        assert_eq!(std::fs::read_to_string(&f.path).unwrap(), text);
        std::fs::write(&f.path, "[mcp_servers.node_repl]\ncommand='/usr/local/bin/node_repl'\n[mcp_servers.computer-use]\ncommand='npx'\n").unwrap();
        let custom = scan(&[f], &[], temp.path());
        assert!(custom.builtins.is_empty());
        assert_eq!(custom.discovered.len(), 2);
        assert!(!is_codex_builtin(
            &json!({"command":"/custom/FakeChatGPT.app/Contents/Resources/cua_node/bin/node_repl"})
        ));
    }
    #[test]
    fn merges_equal_connections_keeps_conflicts_and_all_scopes_without_writing() {
        let temp = tempfile::tempdir().unwrap();
        let claude = file(
            temp.path(),
            "claude.json",
            "claude",
            r#"{"mcpServers":{"shared":{"command":"npx","args":["demo"],"env":{"B":"2","A":"1"}}},"projects":{"/work":{"mcpServers":{"project":{"url":"https://example.com/mcp","type":"http"}}}}}"#,
        );
        let codex = file(temp.path(), "config.toml", "codex", "model_provider='ccswitch'\n[mcp_servers.shared]\ncommand='npx'\nargs=['demo']\nenabled=false\nenv={A='1',B='2'}\n[mcp_servers.project]\nurl='https://different.example/mcp'\n");
        let original = std::fs::read(&codex.path).unwrap();
        let result = scan(&[claude, codex.clone()], &[], temp.path());
        assert!(result.warnings.is_empty());
        assert_eq!(result.discovered.len(), 3);
        let shared = &result.discovered[0];
        assert_eq!(shared.sources.len(), 2);
        assert!(!shared.sources[1].enabled);
        assert!(shared.server.as_ref().unwrap().enabled);
        assert!(result
            .discovered
            .iter()
            .any(|d| d.sources[0].scope.contains("/work")));
        assert_eq!(std::fs::read(&codex.path).unwrap(), original);
        // A new scan reflects edits instead of importing a permanently stale snapshot.
        std::fs::write(&codex.path, "[mcp_servers.changed]\ncommand='changed'\n").unwrap();
        let refreshed = scan(&[codex], &[], temp.path());
        assert_eq!(refreshed.discovered[0].name, "changed");
    }
    #[test]
    fn unsupported_and_broken_configs_remain_visible_without_exposing_values() {
        let temp = tempfile::tempdir().unwrap();
        let valid = file(temp.path(), "config.toml", "codex", "[mcp_servers.tools]\ncommand='tools'\nstartup_timeout_sec=120\n[mcp_servers.remote]\nurl='https://example.com/mcp'\nhttp_headers={Authorization='secret'}\n[mcp_servers.bad]\ncommand=42\nenv={TOKEN='very-secret'}\n");
        let broken = file(
            temp.path(),
            "claude.json",
            "claude",
            "{broken: 'private-token'",
        );
        let missing = ScanFile {
            path: temp.path().join("missing"),
            ..broken.clone()
        };
        let result = scan(&[valid, broken, missing], &[], temp.path());
        assert_eq!(result.discovered.len(), 3);
        assert_eq!(result.warnings.len(), 1);
        let unsupported = result
            .discovered
            .iter()
            .find(|d| d.name == "tools")
            .unwrap();
        assert!(unsupported.server.is_none());
        assert!(unsupported
            .issue
            .as_ref()
            .unwrap()
            .contains("startup_timeout_sec"));
        let remote = result
            .discovered
            .iter()
            .find(|d| d.name == "remote")
            .unwrap();
        let Connection::Http { headers, .. } = &remote.server.as_ref().unwrap().connection else {
            panic!()
        };
        assert_eq!(headers["Authorization"], "secret");
        let bad = result.discovered.iter().find(|d| d.name == "bad").unwrap();
        assert!(!bad.issue.as_ref().unwrap().contains("very-secret"));
        assert!(!result.warnings[0].contains("private-token"));
    }
    #[test]
    fn merges_read_only_entries_only_when_all_fields_match() {
        let temp = tempfile::tempdir().unwrap();
        let claude = file(
            temp.path(),
            "claude.json",
            "claude",
            r#"{"mcpServers":{"slow":{"type":"stdio","command":"demo","startup_timeout_sec":120}}}"#,
        );
        let codex = file(temp.path(), "config.toml", "codex", "[mcp_servers.slow]\ncommand='demo'\nargs=[]\nenv={}\nstartup_timeout_sec=120\n[mcp_servers.different]\ncommand='demo'\nstartup_timeout_sec=60\n");
        let result = scan(&[claude, codex], &[], temp.path());
        assert_eq!(result.discovered.len(), 2);
        assert_eq!(result.discovered[0].sources.len(), 2);
        assert!(result.discovered.iter().all(|d| d.server.is_none()));
        // Internal comparison data must never expose unparsed configuration values.
        assert!(serde_json::to_value(&result).unwrap()["discovered"][0]
            .get("comparison")
            .is_none());
    }

    #[test]
    fn associates_managed_connections_and_does_not_reimport_gateway_adapters() {
        let temp = tempfile::tempdir().unwrap();
        let server = normalize(
            "managed",
            "managed-id",
            &json!({"command":"demo"}),
            "claude",
        )
        .unwrap();
        let config = json!({"mcpServers":{
            "direct":{"command":"demo"},
            "studio-managed-id":{"command":"/app/studio","args":["--mcp-client","managed-id",temp.path()]},
            "orphan":{"command":"/app/studio","args":["--mcp-client","unknown",temp.path()]}
        }});
        let f = file(temp.path(), "claude.json", "claude", &config.to_string());
        let result = scan(&[f], &[server], temp.path());
        assert_eq!(result.discovered.len(), 2);
        let managed = result
            .discovered
            .iter()
            .find(|d| d.managed_id.is_some())
            .unwrap();
        assert_eq!(managed.managed_id.as_deref(), Some("managed-id"));
        assert_eq!(managed.sources.len(), 2);
        assert!(managed.sources.iter().any(|s| s.gateway));
        let orphan = result
            .discovered
            .iter()
            .find(|d| d.name == "orphan")
            .unwrap();
        assert!(orphan.server.is_none());
        assert!(orphan.issue.as_ref().unwrap().contains("循环"));
    }
}
