//! Native MCP definitions retain client-specific fields; gateway compatibility is separate.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use toml_edit::{DocumentMut, Item};

pub fn canonical(value: &Value, agent: &str) -> Value {
    let mut value = value.clone();
    if let Some(map) = value.as_object_mut() {
        if agent == "codex" {
            if let Some(headers) = map.remove("http_headers") {
                map.insert("headers".into(), headers);
            }
        }
        let kind = if map.contains_key("url") {
            "http"
        } else {
            "stdio"
        };
        map.entry("type").or_insert(json!(kind));
        if map.get("type").and_then(Value::as_str) == Some("streamable-http") {
            map.insert("type".into(), json!("http"));
        }
    }
    value
}
pub fn validate(value: &Value) -> Result<()> {
    let map = value.as_object().context("MCP 配置必须为对象")?;
    let kind = map
        .get("type")
        .and_then(Value::as_str)
        .context("请选择连接类型")?;
    match kind {
        "stdio" => {
            if map
                .get("command")
                .and_then(Value::as_str)
                .is_none_or(|s| s.trim().is_empty())
            {
                bail!("请填写启动命令");
            }
            if map.contains_key("url") {
                bail!("本地进程不能同时包含 URL");
            }
        }
        "http" | "streamable-http" | "sse" => {
            if map
                .get("url")
                .and_then(Value::as_str)
                .is_none_or(|s| s.trim().is_empty())
            {
                bail!("请填写 MCP 地址");
            }
            if map.contains_key("command") {
                bail!("HTTP 服务不能同时包含启动命令");
            }
        }
        _ => bail!("暂不支持该连接类型"),
    }
    if let Some(args) = map.get("args") {
        if !args
            .as_array()
            .is_some_and(|a| a.iter().all(Value::is_string))
        {
            bail!("参数必须为字符串数组");
        }
    }
    for field in ["headers", "env"] {
        if let Some(value) = map.get(field) {
            if !value.as_object().is_some_and(|m| {
                m.keys().all(|key| !key.trim().is_empty()) && m.values().all(Value::is_string)
            }) {
                bail!("{field} 必须为字符串键值表");
            }
        }
    }
    if map
        .get("cwd")
        .is_some_and(|v| !v.is_null() && !v.is_string())
    {
        bail!("工作目录必须为字符串");
    }
    Ok(())
}
pub fn for_agent(definition: &Value, agent: &str) -> Result<Value> {
    validate(definition)?;
    let mut value = definition.clone();
    let map = value.as_object_mut().unwrap();
    if agent == "codex" {
        if map.get("type").and_then(Value::as_str) == Some("sse") {
            bail!("Codex 不支持原生 SSE，请选择其他连接方式");
        }
        map.remove("type");
        if let Some(headers) = map.remove("headers") {
            map.insert("http_headers".into(), headers);
        }
        if map.get("cwd").is_some_and(Value::is_null) {
            map.remove("cwd");
        }
    } else if agent != "claude" {
        bail!("不支持的 Agent");
    }
    Ok(value)
}
pub fn entry(text: &str, agent: &str, project: Option<&str>, key: &str) -> Result<Option<Value>> {
    let doc: Value = if text.trim().is_empty() {
        json!({})
    } else if agent == "codex" {
        toml_edit::de::from_str(text).map_err(|_| anyhow::anyhow!("Codex TOML 格式无效"))?
    } else {
        serde_json::from_str(text).map_err(|_| anyhow::anyhow!("Claude JSON 格式无效"))?
    };
    if !doc.is_object() {
        bail!("配置根节点必须为对象");
    }
    let root = if let Some(project) = project {
        &doc["projects"][project]
    } else {
        &doc
    };
    let table = if agent == "codex" {
        "mcp_servers"
    } else {
        "mcpServers"
    };
    if root.get(table).is_some_and(|t| !t.is_object()) {
        bail!("MCP 列表必须为对象");
    }
    Ok(root.get(table).and_then(|t| t.get(key)).cloned())
}
pub fn patch(
    text: &str,
    agent: &str,
    project: Option<&str>,
    key: &str,
    expected: &Option<Value>,
    next: &Option<Value>,
) -> Result<String> {
    if &entry(text, agent, project, key)? != expected {
        bail!("MCP「{key}」已被其他程序修改或存在同名配置，请刷新后重试");
    }
    if expected == next {
        return Ok(text.into());
    }
    if agent == "codex" {
        let mut doc: DocumentMut = text
            .parse()
            .map_err(|_| anyhow::anyhow!("Codex TOML 格式无效"))?;
        if doc.get("mcp_servers").is_none() {
            doc["mcp_servers"] = Item::Table(Default::default());
        }
        let table = doc["mcp_servers"]
            .as_table_like_mut()
            .context("mcp_servers 必须为表")?;
        if let Some(value) = next {
            let encoded = toml_edit::ser::to_document(&json!({"mcp_servers": { key: value }}))
                .map_err(|_| anyhow::anyhow!("配置包含不能写入 TOML 的值"))?;
            table.insert(key, encoded["mcp_servers"][key].clone());
        } else {
            table.remove(key);
        }
        Ok(doc.to_string())
    } else if agent == "claude" {
        let mut doc: Value = if text.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(text)?
        };
        let mut root = &mut doc;
        if let Some(project) = project {
            if root.get("projects").is_none() {
                root["projects"] = json!({});
            }
            if !root["projects"].is_object() {
                bail!("projects 必须为对象");
            }
            if root["projects"].get(project).is_none() {
                root["projects"][project] = json!({});
            }
            root = &mut root["projects"][project];
            if !root.is_object() {
                bail!("项目配置必须为对象");
            }
        }
        if root.get("mcpServers").is_none() {
            root["mcpServers"] = json!({});
        }
        let table = root["mcpServers"]
            .as_object_mut()
            .context("mcpServers 必须为对象")?;
        if let Some(value) = next {
            table.insert(key.into(), value.clone());
        } else {
            table.remove(key);
        }
        Ok(format!("{}\n", serde_json::to_string_pretty(&doc)?))
    } else {
        bail!("不支持的 Agent");
    }
}
pub fn parse_definition(text: &str) -> anyhow::Result<Value> {
    let trimmed = text.trim();
    if let Some(parsed) = crate::install::parse_input(trimmed)? {
        return Ok(parsed);
    }
    let json_text = if trimmed.starts_with('"') {
        format!("{{{trimmed}}}")
    } else {
        trimmed.into()
    };
    let value: Value = serde_json::from_str(&json_text)
        .map_err(|_| ())
        .or_else(|_| toml_edit::de::from_str(trimmed).map_err(|_| ()))
        .map_err(|_| anyhow::anyhow!("无法解析，请粘贴 JSON 或 TOML 配置"))?;
    let (agent, entries) = if let Some(entries) = value.get("mcp_servers") {
        ("codex", Some(entries))
    } else if let Some(entries) = value.get("mcpServers") {
        ("claude", Some(entries))
    } else {
        ("claude", None)
    };
    let mut results = vec![];
    if let Some(entries) = entries {
        for (name, definition) in entries
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("服务列表必须为对象"))?
        {
            results.push(json!({"name":name,"definition":canonical(definition,agent)}));
        }
    } else if value.get("command").is_none()
        && value.get("url").is_none()
        && value.as_object().is_some_and(|m| m.len() == 1)
    {
        let (name, definition) = value.as_object().unwrap().iter().next().unwrap();
        results.push(json!({"name":name,"definition":canonical(definition,"claude")}));
    } else {
        results.push(json!({"name":"","definition":canonical(&value,"claude")}));
    }
    if results.is_empty() {
        anyhow::bail!("没有找到 MCP 配置");
    }
    for result in &results {
        validate(&result["definition"])?;
    }
    Ok(json!(results))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_json_fragments_and_toml_and_preserves_extensions() {
        let parsed =
            parse_definition(r#""tools": {"command":"demo","startup_timeout_sec":120}"#).unwrap();
        assert_eq!(parsed[0]["name"], "tools");
        assert_eq!(parsed[0]["definition"]["startup_timeout_sec"], 120);
        let parsed=parse_definition("[mcp_servers.one]\nurl='https://example.com/mcp'\nhttp_headers={Authorization='key'}\n[mcp_servers.two]\ncommand='demo'\n").unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
        assert_eq!(parsed[0]["definition"]["headers"]["Authorization"], "key");
    }
    #[test]
    fn malformed_roots_and_values_fail_before_writing() {
        assert!(patch(
            "[]",
            "claude",
            None,
            "tool",
            &None,
            &Some(json!({"command":"demo"}))
        )
        .is_err());
        assert!(patch(
            r#"{"projects":42}"#,
            "claude",
            Some("/work"),
            "tool",
            &None,
            &Some(json!({"command":"demo"}))
        )
        .is_err());
        assert!(validate(&json!({"type":"stdio","command":"demo","env":{"":"value"}})).is_err());
    }
}
