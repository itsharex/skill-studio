//! 三态启停：已注册 / 已注册但停用 / 未注册。
//!
//! 停用**不删文件**，而是写各 agent 自己的原生配置开关：
//! - Claude Code → `settings.json` 的 `skillOverrides: { "<name>": "off" }`
//! - Codex → `config.toml` 的 `[[skills.config]] name / enabled`
//!
//! 这样瞬时、无损、可逆，而且用户在 agent 里 `/skills` 看到的状态与 Studio 一致。
//!
//! 两条硬要求：
//! 1. **必须保住用户其他配置** —— JSON 深合并、TOML 用 `toml_edit` 保留注释与格式
//! 2. **重复写不产生重复条目** —— 幂等

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use toml_edit::{ArrayOfTables, DocumentMut, Item, Table};

use crate::error::{Error, Result};
use crate::fs::atomic;
use crate::models::agent::{AgentDescriptor, ToggleMechanism};

/// Claude Code `skillOverrides` 的取值
const CLAUDE_OFF: &str = "off";
const CLAUDE_OVERRIDES_KEY: &str = "skillOverrides";

/// 读 JSON，文件不存在或为空时返回空对象。
fn read_json_object(path: &Path) -> Result<Map<String, Value>> {
    match std::fs::read_to_string(path) {
        Ok(raw) => {
            let text = raw.trim_start_matches('\u{feff}').trim();
            if text.is_empty() {
                return Ok(Map::new());
            }
            match serde_json::from_str::<Value>(text).map_err(|e| Error::json(path, e))? {
                Value::Object(map) => Ok(map),
                other => Err(Error::config(format!(
                    "{} 的顶层不是 JSON 对象，实际是 {}",
                    path.display(),
                    kind_of(&other)
                ))),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(Error::io(path, e)),
    }
}

fn kind_of(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "布尔",
        Value::Number(_) => "数字",
        Value::String(_) => "字符串",
        Value::Array(_) => "数组",
        Value::Object(_) => "对象",
    }
}

/// 写回 JSON，**保留原有键序**。
///
/// 不能用 `atomic::write_json_file` —— 它会递归排序 key，那是我们自己配置文件的
/// 需求（确定性输出便于 diff），但用户的 settings.json 不该被我们重排。
/// serde_json 开了 `preserve_order` feature，Value 内部是 IndexMap，顺序天然保留。
fn write_json_preserving_order(path: &Path, map: &Map<String, Value>) -> Result<()> {
    let mut text = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| Error::JsonSerialize { source: e })?;
    text.push('\n');
    atomic::atomic_write(path, text.as_bytes())
}

/// 设置 Claude Code 里某个 skill 的启用状态。
///
/// 停用写 `"off"`；启用则**移除该键**（不存在即默认启用），保持用户配置最小。
pub fn set_claude_skill_enabled(
    settings_path: &Path,
    skill_name: &str,
    enabled: bool,
) -> Result<()> {
    let mut root = read_json_object(settings_path)?;

    let overrides_entry = root
        .entry(CLAUDE_OVERRIDES_KEY.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(overrides) = overrides_entry.as_object_mut() else {
        return Err(Error::config(format!(
            "{} 里的 {CLAUDE_OVERRIDES_KEY} 不是对象",
            settings_path.display()
        )));
    };

    if enabled {
        overrides.remove(skill_name);
    } else {
        overrides.insert(skill_name.to_string(), Value::String(CLAUDE_OFF.into()));
    }

    // 空的 skillOverrides 就别留了，免得在用户配置里堆垃圾
    if root
        .get(CLAUDE_OVERRIDES_KEY)
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
    {
        root.remove(CLAUDE_OVERRIDES_KEY);
    }

    write_json_preserving_order(settings_path, &root)
}

/// 读 Claude Code 里某个 skill 是否被停用
pub fn is_claude_skill_disabled(settings_path: &Path, skill_name: &str) -> bool {
    read_json_object(settings_path)
        .ok()
        .and_then(|root| {
            root.get(CLAUDE_OVERRIDES_KEY)?
                .as_object()?
                .get(skill_name)?
                .as_str()
                .map(|v| v == CLAUDE_OFF)
        })
        .unwrap_or(false)
}

/// 设置 Codex 里某个 skill 的启用状态。
///
/// schema 见 `codex-rs/config/src/skills_config.rs`：`[[skills.config]]` 是
/// array of tables，每项用 `name` 或 `path` 选中，`enabled` 是必填布尔。
/// 启用时移除对应条目（缺省即启用）。
pub fn set_codex_skill_enabled(config_path: &Path, skill_name: &str, enabled: bool) -> Result<()> {
    let existing = match std::fs::read_to_string(config_path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(Error::io(config_path, e)),
    };
    let mut doc: DocumentMut = existing.parse().map_err(|e| Error::Toml {
        path: config_path.display().to_string(),
        source: e,
    })?;

    if enabled {
        remove_codex_entry(&mut doc, skill_name);
    } else {
        upsert_codex_entry(&mut doc, skill_name)?;
    }

    atomic::write_text_file(config_path, &doc.to_string())
}

fn codex_config_array(doc: &mut DocumentMut) -> Result<&mut ArrayOfTables> {
    if !doc.contains_key("skills") {
        let mut table = Table::new();
        // implicit：只有 [[skills.config]] 时不额外输出一个空的 [skills] 头
        table.set_implicit(true);
        doc.insert("skills", Item::Table(table));
    }
    let skills = doc
        .get_mut("skills")
        .and_then(|i| i.as_table_mut())
        .ok_or_else(|| Error::config("config.toml 里的 [skills] 不是表"))?;

    if !skills.contains_key("config") {
        skills.insert("config", Item::ArrayOfTables(ArrayOfTables::new()));
    }
    skills
        .get_mut("config")
        .and_then(|i| i.as_array_of_tables_mut())
        .ok_or_else(|| Error::config("config.toml 里的 skills.config 不是表数组"))
}

fn entry_name(table: &Table) -> Option<String> {
    table.get("name")?.as_str().map(|s| s.to_string())
}

fn upsert_codex_entry(doc: &mut DocumentMut, skill_name: &str) -> Result<()> {
    let arr = codex_config_array(doc)?;
    // 已有同名条目就改它，避免重复写产生重复条目
    for table in arr.iter_mut() {
        if entry_name(table).as_deref() == Some(skill_name) {
            table["enabled"] = toml_edit::value(false);
            return Ok(());
        }
    }
    let mut table = Table::new();
    table["name"] = toml_edit::value(skill_name);
    table["enabled"] = toml_edit::value(false);
    arr.push(table);
    Ok(())
}

fn remove_codex_entry(doc: &mut DocumentMut, skill_name: &str) {
    let Some(arr) = doc
        .get_mut("skills")
        .and_then(|i| i.as_table_mut())
        .and_then(|t| t.get_mut("config"))
        .and_then(|i| i.as_array_of_tables_mut())
    else {
        return;
    };
    arr.retain(|t| entry_name(t).as_deref() != Some(skill_name));
    if arr.is_empty() {
        if let Some(skills) = doc.get_mut("skills").and_then(|i| i.as_table_mut()) {
            skills.remove("config");
            // [skills] 空了也一并清掉，不在用户配置里留空壳
            if skills.is_empty() {
                doc.remove("skills");
            }
        }
    }
}

/// 读 Codex 里某个 skill 是否被停用
pub fn is_codex_skill_disabled(config_path: &Path, skill_name: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(config_path) else {
        return false;
    };
    let Ok(doc) = text.parse::<DocumentMut>() else {
        return false;
    };
    let Some(arr) = doc
        .get("skills")
        .and_then(|i| i.as_table())
        .and_then(|t| t.get("config"))
        .and_then(|i| i.as_array_of_tables())
    else {
        return false;
    };
    // 必须先落成局部变量：尾表达式里的迭代器是借用 doc 的临时对象，
    // 函数返回时 doc 先析构，会触发 E0597。
    let disabled = arr.iter().any(|t| {
        entry_name(t).as_deref() == Some(skill_name)
            && t.get("enabled").and_then(|v| v.as_bool()) == Some(false)
    });
    disabled
}

/// Read ordered user-level Codex rules. Session flags belong to the running
/// Codex process and are not available to this desktop application.
pub fn is_codex_skill_disabled_at(config_path: &Path, skill_name: &str, document: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(config_path) else {
        return false;
    };
    let Ok(doc) = text.parse::<DocumentMut>() else {
        return false;
    };
    let Some(config) = doc.get("skills").and_then(|s| s.get("config")) else {
        return false;
    };
    let mut disabled = false;
    let mut apply = |name: Option<&str>, path: Option<&str>, enabled: Option<bool>| {
        let matches = match (name, path) {
            (Some(name), None) => !name.trim().is_empty() && name.trim() == skill_name,
            (None, Some(path)) => {
                Path::new(path).is_absolute()
                    && crate::fs::paths::paths_alias(Path::new(path), document)
            }
            _ => false,
        };
        if matches {
            if let Some(enabled) = enabled {
                disabled = !enabled;
            }
        }
    };
    if let Some(arr) = config.as_array_of_tables() {
        for t in arr {
            apply(
                t.get("name").and_then(Item::as_str),
                t.get("path").and_then(Item::as_str),
                t.get("enabled").and_then(Item::as_bool),
            );
        }
    } else if let Some(arr) = config.as_array() {
        for value in arr {
            if let Some(t) = value.as_inline_table() {
                apply(
                    t.get("name").and_then(toml_edit::Value::as_str),
                    t.get("path").and_then(toml_edit::Value::as_str),
                    t.get("enabled").and_then(toml_edit::Value::as_bool),
                );
            }
        }
    }
    disabled
}

/// Write an exact document selector after existing rules, preserving name rules
/// for other same-name skills. Explicit true overrides an earlier name disable.
pub fn set_codex_skill_enabled_at(
    config_path: &Path,
    document: &Path,
    enabled: bool,
) -> Result<()> {
    let document = document
        .canonicalize()
        .map_err(|e| Error::io(document, e))?;
    let text = match std::fs::read_to_string(config_path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(Error::io(config_path, e)),
    };
    let mut doc: DocumentMut = text.parse().map_err(|source| Error::Toml {
        path: config_path.display().to_string(),
        source,
    })?;
    // TOML also permits skills.config = [{ path = "...", enabled = false }].
    if let Some(item) = doc.get_mut("skills").and_then(|s| s.get_mut("config")) {
        if let Some(array) = item.as_array() {
            let mut tables = ArrayOfTables::new();
            for value in array {
                let table = value
                    .as_inline_table()
                    .ok_or_else(|| Error::config("skills.config 必须包含表"))?;
                tables.push(table.clone().into_table());
            }
            *item = Item::ArrayOfTables(tables);
        }
    }
    let array = codex_config_array(&mut doc)?;
    let matches = |table: &Table| {
        table.get("name").is_none()
            && table
                .get("path")
                .and_then(Item::as_str)
                .is_some_and(|p| crate::fs::paths::paths_alias(Path::new(p), &document))
    };
    let next_position = array.iter().filter_map(Table::position).max().unwrap_or(0) + 1;
    let mut entry = array
        .iter()
        .filter(|t| matches(t))
        .last()
        .cloned()
        .unwrap_or_default();
    array.retain(|t| !matches(t));
    // toml_edit retains document positions even after an array entry is moved.
    // Move its serialized position too, otherwise a later name rule wins again.
    entry.set_position(next_position);
    entry["path"] = toml_edit::value(document.to_string_lossy().as_ref());
    entry["enabled"] = toml_edit::value(enabled);
    array.push(entry);
    atomic::write_text_file(config_path, &doc.to_string())
}

pub fn is_skill_disabled_at(
    agent: &AgentDescriptor,
    overrides: &HashMap<String, PathBuf>,
    name: &str,
    document: &Path,
) -> bool {
    let Some(path) = agent.toggle_config_path(overrides) else {
        return false;
    };
    match agent.toggle {
        ToggleMechanism::ClaudeSettingsJson => is_claude_skill_disabled(&path, name),
        ToggleMechanism::CodexConfigToml => is_codex_skill_disabled_at(&path, name, document),
        ToggleMechanism::None => false,
    }
}

pub fn set_skill_enabled_at(
    agent: &AgentDescriptor,
    overrides: &HashMap<String, PathBuf>,
    name: &str,
    document: &Path,
    enabled: bool,
) -> Result<()> {
    let path = agent
        .toggle_config_path(overrides)
        .ok_or_else(|| Error::invalid("该 agent 不支持原生启停"))?;
    match agent.toggle {
        ToggleMechanism::ClaudeSettingsJson => set_claude_skill_enabled(&path, name, enabled),
        ToggleMechanism::CodexConfigToml => set_codex_skill_enabled_at(&path, document, enabled),
        ToggleMechanism::None => unreachable!(),
    }
}

/// 按 agent 分派
pub fn set_skill_enabled(
    agent: &AgentDescriptor,
    overrides: &HashMap<String, PathBuf>,
    skill_name: &str,
    enabled: bool,
) -> Result<()> {
    let Some(path) = agent.toggle_config_path(overrides) else {
        return Err(Error::invalid(format!(
            "{} 没有原生的 skill 启停机制",
            agent.display_name
        )));
    };
    match agent.toggle {
        ToggleMechanism::ClaudeSettingsJson => set_claude_skill_enabled(&path, skill_name, enabled),
        ToggleMechanism::CodexConfigToml => set_codex_skill_enabled(&path, skill_name, enabled),
        ToggleMechanism::None => unreachable!("toggle_config_path 已过滤 None"),
    }
}

/// 按 agent 分派的读取
pub fn is_skill_disabled(
    agent: &AgentDescriptor,
    overrides: &HashMap<String, PathBuf>,
    skill_name: &str,
) -> bool {
    let Some(path) = agent.toggle_config_path(overrides) else {
        return false;
    };
    match agent.toggle {
        ToggleMechanism::ClaudeSettingsJson => is_claude_skill_disabled(&path, skill_name),
        ToggleMechanism::CodexConfigToml => is_codex_skill_disabled(&path, skill_name),
        ToggleMechanism::None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_disable_then_enable_leaves_other_settings_intact() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(
            &p,
            r#"{
  "model": "opus",
  "permissions": { "allow": ["Bash(git *)"] },
  "env": { "FOO": "bar" }
}"#,
        )
        .unwrap();

        set_claude_skill_enabled(&p, "deploy", false).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["skillOverrides"]["deploy"], "off");
        // 用户其他配置必须完好
        assert_eq!(v["model"], "opus");
        assert_eq!(v["permissions"]["allow"][0], "Bash(git *)");
        assert_eq!(v["env"]["FOO"], "bar");
        assert!(is_claude_skill_disabled(&p, "deploy"));

        set_claude_skill_enabled(&p, "deploy", true).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        // 启用后移除键，且空的 skillOverrides 不留
        assert!(v.get("skillOverrides").is_none(), "{v}");
        assert_eq!(v["model"], "opus");
        assert!(!is_claude_skill_disabled(&p, "deploy"));
    }

    #[test]
    fn claude_preserves_key_order() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(&p, r#"{"zeta":1,"alpha":2,"middle":3}"#).unwrap();
        set_claude_skill_enabled(&p, "x", false).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        // 不能被重排成字母序 —— 那是我们自己配置的需求，不是用户文件的
        assert!(
            text.find("zeta").unwrap() < text.find("alpha").unwrap(),
            "键序被改动了:\n{text}"
        );
    }

    #[test]
    fn claude_creates_file_when_missing() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("nested/settings.json");
        set_claude_skill_enabled(&p, "deploy", false).unwrap();
        assert!(is_claude_skill_disabled(&p, "deploy"));
    }

    #[test]
    fn claude_keeps_other_skill_overrides() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(&p, r#"{"skillOverrides":{"other":"name-only"}}"#).unwrap();
        set_claude_skill_enabled(&p, "deploy", false).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["skillOverrides"]["other"], "name-only");
        assert_eq!(v["skillOverrides"]["deploy"], "off");
    }

    #[test]
    fn claude_rejects_non_object_root() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(&p, "[1,2,3]").unwrap();
        let err = set_claude_skill_enabled(&p, "x", false).unwrap_err();
        assert!(err.to_string().contains("不是 JSON 对象"), "{err}");
    }

    #[test]
    fn codex_disable_preserves_comments_and_other_tables() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        std::fs::write(
            &p,
            r#"# 我的 Codex 配置
model = "gpt-5"

[tui]
theme = "dark"   # 行内注释
"#,
        )
        .unwrap();

        set_codex_skill_enabled(&p, "deploy", false).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        // 注释与既有表必须原样保留
        assert!(text.contains("# 我的 Codex 配置"), "{text}");
        assert!(text.contains("# 行内注释"), "{text}");
        assert!(text.contains("model = \"gpt-5\""), "{text}");
        assert!(text.contains("[tui]"), "{text}");
        assert!(text.contains("[[skills.config]]"), "{text}");
        assert!(is_codex_skill_disabled(&p, "deploy"));
    }

    #[test]
    fn codex_repeated_disable_does_not_duplicate_entries() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        set_codex_skill_enabled(&p, "deploy", false).unwrap();
        set_codex_skill_enabled(&p, "deploy", false).unwrap();
        set_codex_skill_enabled(&p, "deploy", false).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert_eq!(
            text.matches("[[skills.config]]").count(),
            1,
            "重复写产生了重复条目:\n{text}"
        );
    }

    #[test]
    fn codex_enable_removes_entry_and_cleans_empty_tables() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        std::fs::write(&p, "model = \"gpt-5\"\n").unwrap();

        set_codex_skill_enabled(&p, "deploy", false).unwrap();
        set_codex_skill_enabled(&p, "deploy", true).unwrap();

        let text = std::fs::read_to_string(&p).unwrap();
        assert!(!text.contains("skills"), "空的 skills 表应被清掉:\n{text}");
        assert!(text.contains("model = \"gpt-5\""), "{text}");
        assert!(!is_codex_skill_disabled(&p, "deploy"));
    }

    #[test]
    fn codex_handles_multiple_skills_independently() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        set_codex_skill_enabled(&p, "a", false).unwrap();
        set_codex_skill_enabled(&p, "b", false).unwrap();
        assert!(is_codex_skill_disabled(&p, "a"));
        assert!(is_codex_skill_disabled(&p, "b"));

        set_codex_skill_enabled(&p, "a", true).unwrap();
        assert!(!is_codex_skill_disabled(&p, "a"));
        assert!(is_codex_skill_disabled(&p, "b"), "不该影响别的 skill");
    }

    #[test]
    fn codex_keeps_existing_skills_settings() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        std::fs::write(
            &p,
            "[skills]\ninclude_instructions = true\nmax_context_tokens = 10000\n",
        )
        .unwrap();
        set_codex_skill_enabled(&p, "deploy", false).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("include_instructions = true"), "{text}");
        assert!(text.contains("max_context_tokens = 10000"), "{text}");
        assert!(is_codex_skill_disabled(&p, "deploy"));
    }

    #[test]
    fn codex_reports_not_disabled_for_unknown_skill() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        set_codex_skill_enabled(&p, "a", false).unwrap();
        assert!(!is_codex_skill_disabled(&p, "never-touched"));
        assert!(!is_codex_skill_disabled(
            Path::new("/nope/config.toml"),
            "a"
        ));
    }

    #[test]
    fn dispatch_routes_to_the_right_mechanism() {
        use crate::models::agent::find_agent;
        let d = tempfile::tempdir().unwrap();
        let mut overrides = HashMap::new();
        overrides.insert("claude-code".to_string(), d.path().join("claude"));
        overrides.insert("codex".to_string(), d.path().join("codex"));

        let claude = find_agent("claude-code").unwrap();
        set_skill_enabled(claude, &overrides, "deploy", false).unwrap();
        assert!(is_skill_disabled(claude, &overrides, "deploy"));
        assert!(d.path().join("claude/settings.json").is_file());

        let codex = find_agent("codex").unwrap();
        set_skill_enabled(codex, &overrides, "deploy", false).unwrap();
        assert!(is_skill_disabled(codex, &overrides, "deploy"));
        assert!(d.path().join("codex/config.toml").is_file());
    }
}
