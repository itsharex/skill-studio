//! Parse installation instructions as data. Never execute the pasted shell command.
use anyhow::{bail, Context, Result};
use serde_json::{json, Map, Value};

fn url(text: &str) -> Result<String> {
    let text = text.trim();
    let text = if text.starts_with('[') && text.ends_with(')') {
        text.rsplit_once("](")
            .map(|(_, url)| &url[..url.len() - 1])
            .context("链接格式无效")?
    } else {
        text
    };
    let parsed = reqwest::Url::parse(text).context("请输入有效的 HTTP 或 HTTPS 地址")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        bail!("请输入 HTTP 或 HTTPS 地址");
    }
    Ok(text.into())
}
fn shell_words(text: &str) -> Result<Vec<String>> {
    let mut quote = None;
    let mut escaped = false;
    for c in text.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if c == '`' || (c == '$' && quote != Some('\'')) {
            bail!("不执行 Shell 变量或命令替换，请填写实际值或使用配置格式");
        }
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
        } else if matches!(c, '\'' | '"') {
            quote = Some(c);
        } else if matches!(c, ';' | '|' | '&' | '<' | '>' | '\n' | '\r') {
            bail!("请只粘贴一条 MCP 安装命令，不包含管道或其他 Shell 操作；地址和参数可加引号");
        }
    }
    shlex::split(text).context("命令引号未闭合，请检查输入")
}
pub fn parse_input(text: &str) -> Result<Option<Value>> {
    if text.starts_with("http://")
        || text.starts_with("https://")
        || (text.starts_with("[http") && text.contains("]("))
    {
        let address = url(text)?;
        let host = reqwest::Url::parse(&address)?
            .host_str()
            .unwrap()
            .trim_start_matches("mcp.")
            .trim_start_matches("www.")
            .replace('.', "-");
        return Ok(Some(
            json!([{"name":host,"definition":{"type":"http","url":address}}]),
        ));
    }
    if !text.starts_with("codex ") && !text.starts_with("claude ") {
        return Ok(None);
    }
    let words = shell_words(text)?;
    if words.len() < 4 || words[1] != "mcp" || words[2] != "add" {
        bail!("支持 codex mcp add 或 claude mcp add 命令");
    }
    let agent = if words[0] == "codex" {
        "codex"
    } else {
        "claude"
    };
    let mut scope = if agent == "claude" {
        "local".to_string()
    } else {
        "user".to_string()
    };
    let mut name = None;
    let mut command = vec![];
    let mut address = None;
    let mut transport = None;
    let mut bearer = None;
    let mut env = Map::new();
    let mut headers = Map::new();
    let mut i = 3;
    while i < words.len() {
        let word = &words[i];
        if word == "--" {
            command.extend_from_slice(&words[i + 1..]);
            break;
        }
        if word.starts_with('-') {
            let (flag, inline) = word
                .split_once('=')
                .map(|(k, v)| (k, Some(v.to_string())))
                .unwrap_or((word.as_str(), None));
            let allowed = matches!(flag, "--env")
                || (agent == "codex" && matches!(flag, "--url" | "--bearer-token-env-var"))
                || (agent == "claude"
                    && matches!(
                        flag,
                        "-e" | "--header" | "-H" | "--scope" | "-s" | "--transport" | "-t"
                    ));
            if !allowed {
                bail!("暂不支持安装选项 {flag}，请改用手动配置，避免遗漏参数");
            }
            let value = if let Some(value) = inline {
                value
            } else {
                i += 1;
                words
                    .get(i)
                    .filter(|v| !v.starts_with("--"))
                    .context("安装选项缺少值")?
                    .clone()
            };
            match flag {
                "--url" => address = Some(url(&value)?),
                "--bearer-token-env-var" => bearer = Some(value),
                "--scope" | "-s" => scope = value,
                "--transport" | "-t" => transport = Some(value),
                "--env" | "-e" => {
                    let (key, value) = value.split_once('=').context("环境变量应为 KEY=VALUE")?;
                    if key.is_empty() {
                        bail!("环境变量名称不能为空");
                    }
                    env.insert(key.into(), json!(value));
                }
                "--header" | "-H" => {
                    let (key, value) = value.split_once(':').context("请求头应为 Name: value")?;
                    if key.trim().is_empty() {
                        bail!("请求头名称不能为空");
                    }
                    headers.insert(key.trim().into(), json!(value.trim()));
                }
                _ => unreachable!(),
            }
        } else if name.is_none() {
            name = Some(word.clone());
        } else if agent == "claude"
            && (word.starts_with("http://")
                || word.starts_with("https://")
                || word.starts_with("[http"))
        {
            address = Some(url(word)?);
        } else {
            if agent == "claude" && word.contains('=') {
                bail!("多个环境变量请分别使用 --env KEY=VALUE");
            }
            command.extend_from_slice(&words[i..]);
            break;
        }
        i += 1;
    }
    if !matches!(scope.as_str(), "user" | "project" | "local") {
        bail!("不支持的安装作用域");
    }
    let name = name
        .filter(|n| !n.trim().is_empty())
        .context("缺少 MCP 名称")?;
    if agent == "claude"
        && command.len() == 1
        && (command[0].starts_with("http") || command[0].starts_with("[http"))
    {
        address = Some(url(&command.remove(0))?);
    }
    let definition = if let Some(address) = address {
        if !command.is_empty() || !env.is_empty() {
            bail!("HTTP 地址不能同时包含启动命令或进程环境变量");
        }
        let kind = transport.as_deref().unwrap_or("http");
        if !matches!(kind, "http" | "sse") {
            bail!("HTTP 地址需要 http 或 sse 连接类型");
        }
        let mut definition = json!({"type":kind,"url":address});
        if !headers.is_empty() {
            definition["headers"] = json!(headers);
        }
        if let Some(bearer) = bearer {
            definition["bearer_token_env_var"] = json!(bearer);
        }
        definition
    } else {
        if command.is_empty() {
            bail!("缺少 MCP 地址或启动命令");
        }
        if transport.as_deref().is_some_and(|t| t != "stdio")
            || !headers.is_empty()
            || bearer.is_some()
        {
            bail!("本地进程不能使用 HTTP 连接选项");
        }
        let mut definition = json!({"type":"stdio","command":command[0],"args":command[1..]});
        if !env.is_empty() {
            definition["env"] = json!(env);
        }
        definition
    };
    crate::native::validate(&definition)?;
    Ok(Some(
        json!([{"name":name,"definition":definition,"agent":agent,"scope":scope}]),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_urls_markdown_and_shell_quoting() {
        let item=parse_input(r#"codex mcp add hf-mcp-server --url "[https://huggingface.co/mcp?login](https://huggingface.co/mcp?login)""#).unwrap().unwrap();
        assert_eq!(
            item[0]["definition"]["url"],
            "https://huggingface.co/mcp?login"
        );
        assert_eq!(item[0]["agent"], "codex");
        assert_eq!(item[0]["scope"], "user");
        let item = parse_input(
            r#"codex mcp add memory --env 'TOKEN=a=b' -- npx -y server ' argument with spaces '"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(item[0]["definition"]["args"][2], " argument with spaces ");
        assert_eq!(item[0]["definition"]["env"]["TOKEN"], "a=b");
        assert_eq!(
            parse_input("https://example.com/mcp?a=1&b=2")
                .unwrap()
                .unwrap()[0]["definition"]["url"],
            "https://example.com/mcp?a=1&b=2"
        );
    }
    #[test]
    fn claude_preserves_scope_headers_and_arguments() {
        let item=parse_input(r#"claude mcp add --scope project --transport http --header 'Authorization: Bearer test' tools https://example.com/mcp"#).unwrap().unwrap();
        assert_eq!(item[0]["scope"], "project");
        assert_eq!(
            item[0]["definition"]["headers"]["Authorization"],
            "Bearer test"
        );
        assert_eq!(
            parse_input("claude mcp add test -- uvx mcp-server-fetch")
                .unwrap()
                .unwrap()[0]["scope"],
            "local"
        );
    }
    #[test]
    fn rejects_unsupported_flags_and_shell_operations() {
        for input in [
            "codex mcp add x --url https://a/mcp && rm file",
            "codex mcp add x -- echo $(whoami)",
            "codex mcp add x --url '$TOKEN' --config test",
            "codex mcp add x --url https://a -- npx server",
            "codex mcp add x --url",
            "claude mcp add -t sse x -- demo",
            "codex mcp add x --env A=1 --url https://a",
            "codex mcp add x -- 'unclosed",
        ] {
            assert!(parse_input(input).is_err(), "{input}");
        }
    }
}
