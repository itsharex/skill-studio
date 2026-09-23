use super::*;
use crate::native;
fn entry(definition: Value, mode: &str) -> Entry {
    Entry {
        id: "sample".into(),
        name: "Sample".into(),
        mode: mode.into(),
        definition,
        oauth: false,
        client_id: None,
        scopes: vec![],
        bindings: vec![],
    }
}
fn target(path: PathBuf, agent: &str, key: &str, expected: Option<Value>) -> Target {
    Target {
        agent: agent.into(),
        path,
        project: None,
        key: key.into(),
        expected,
    }
}
fn current_targets(entry: &Entry) -> Vec<Target> {
    entry
        .bindings
        .iter()
        .map(|b| Target {
            agent: b.agent.clone(),
            path: b.path.clone(),
            project: b.project.clone(),
            key: b.key.clone(),
            expected: Some(b.installed.clone()),
        })
        .collect()
}
#[test]
fn direct_save_preserves_extensions_for_both_agents_without_a_gateway() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let claude = root.path().join("claude.json");
    let codex = root.path().join("config.toml");
    std::fs::write(&claude,r#"{"env":{"ANTHROPIC_BASE_URL":"http://provider"},"mcpServers":{"other":{"command":"other"}}}"#).unwrap();
    std::fs::write(
        &codex,
        "# provider\nmodel_provider='custom'\n[mcp_servers.other]\ncommand='other'\n",
    )
    .unwrap();
    let e = entry(
        json!({"type":"stdio","command":"demo","args":[" argument with spaces "],"startup_timeout_sec":120,"cwd":"relative"}),
        "direct",
    );
    save(
        &dir,
        e,
        vec![
            target(claude.clone(), "claude", "sample", None),
            target(codex.clone(), "codex", "sample", None),
        ],
        Path::new("/app"),
        None,
    )
    .unwrap();
    assert!(!dir.join("config.json").exists());
    let text = std::fs::read_to_string(&codex).unwrap();
    assert!(text.contains("# provider"));
    assert!(text.contains("model_provider='custom'"));
    for (path, agent) in [(&claude, "claude"), (&codex, "codex")] {
        let value = native::entry(
            &std::fs::read_to_string(path).unwrap(),
            agent,
            None,
            "sample",
        )
        .unwrap()
        .unwrap();
        assert_eq!(value["startup_timeout_sec"], 120);
        assert_eq!(value["cwd"], "relative");
        assert_eq!(value["args"][0], " argument with spaces ");
        assert!(native::entry(
            &std::fs::read_to_string(path).unwrap(),
            agent,
            None,
            "other"
        )
        .unwrap()
        .is_some());
    }
    assert_eq!(read(&dir).unwrap().entries[0].bindings.len(), 2);
}
#[test]
fn direct_probe_accepts_agent_extensions_and_startup_timeout() {
    let e = entry(
        json!({"type":"stdio","command":"demo","startup_timeout_sec":120,"tool_timeout_sec":45}),
        "direct",
    );
    let (server, timeout) = direct_probe_server(&e).unwrap();
    assert_eq!(timeout.as_secs(), 120);
    assert!(matches!(
        server.connection,
        config::Connection::Stdio { .. }
    ));
    assert!(gateway_server(&e).is_err());
}
#[test]
fn direct_probe_does_not_convert_sse_to_streamable_http() {
    let e = entry(
        json!({"type":"sse","url":"https://example.com/sse"}),
        "direct",
    );
    // SSE is valid for Claude, but Studio's probe has no SSE transport.
    assert!(native::for_agent(&e.definition, "claude").is_ok());
    let result = direct_probe_server(&e);
    assert!(
        result.is_err(),
        "SSE must not become a Streamable HTTP probe"
    );
    assert!(result.err().unwrap().to_string().contains("请在 Agent 中"));
}
#[test]
fn migration_reuses_original_keys_and_restores_original_entries() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let claude = root.path().join("claude.json");
    let codex = root.path().join("config.toml");
    let original = json!({"command":"demo","args":["--serve"]});
    std::fs::write(
        &claude,
        json!({"mcpServers":{"original-name":original}}).to_string(),
    )
    .unwrap();
    std::fs::write(
        &codex,
        "[mcp_servers.original_name]\ncommand='demo'\nargs=['--serve']\n",
    )
    .unwrap();
    let e = entry(native::canonical(&original, "claude"), "gateway");
    save(
        &dir,
        e,
        vec![
            target(
                claude.clone(),
                "claude",
                "original-name",
                Some(original.clone()),
            ),
            target(
                codex.clone(),
                "codex",
                "original_name",
                Some(original.clone()),
            ),
        ],
        Path::new("/app"),
        None,
    )
    .unwrap();
    let catalog = read(&dir).unwrap();
    let managed = &catalog.entries[0];
    for b in &managed.bindings {
        let text = std::fs::read_to_string(&b.path).unwrap();
        assert_eq!(
            native::entry(&text, &b.agent, None, &b.key)
                .unwrap()
                .unwrap()["args"][0],
            "--mcp-client"
        );
        assert!(!text.contains("studio-sample"));
    }
    assert!(projection(&dir).unwrap().is_some_and(|s| s.len() == 1));
    let mut direct = managed.clone();
    direct.mode = "direct".into();
    save(
        &dir,
        direct,
        current_targets(managed),
        Path::new("/app"),
        Some(managed),
    )
    .unwrap();
    assert!(projection(&dir).unwrap().unwrap().is_empty());
    remove(&dir, "sample", true).unwrap();
    assert_eq!(
        native::entry(
            &std::fs::read_to_string(&claude).unwrap(),
            "claude",
            None,
            "original-name"
        )
        .unwrap(),
        Some(original.clone())
    );
    assert_eq!(
        native::entry(
            &std::fs::read_to_string(&codex).unwrap(),
            "codex",
            None,
            "original_name"
        )
        .unwrap(),
        Some(original)
    );
    assert!(std::fs::read_dir(root.path())
        .unwrap()
        .flatten()
        .any(|f| f.file_name().to_string_lossy().contains("studio-backup")));
}
#[test]
fn conflicts_do_not_partially_change_other_agents_and_stale_edits_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let a = root.path().join("a.json");
    let b = root.path().join("b.toml");
    std::fs::write(&a, "{}").unwrap();
    std::fs::write(&b, "[mcp_servers.sample]\ncommand='foreign'\n").unwrap();
    let e = entry(json!({"type":"stdio","command":"demo"}), "direct");
    assert!(save(
        &dir,
        e.clone(),
        vec![
            target(a.clone(), "claude", "sample", None),
            target(b, "codex", "sample", None)
        ],
        Path::new("/app"),
        None
    )
    .is_err());
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "{}");
    assert!(!dir.join("catalog.json").exists());
    save(
        &dir,
        e.clone(),
        vec![target(a, "claude", "sample", None)],
        Path::new("/app"),
        None,
    )
    .unwrap();
    assert!(save(&dir, e, vec![], Path::new("/app"), None).is_err());
}
#[test]
fn interrupted_transaction_rolls_back_without_overwriting_external_changes() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path();
    let a = dir.join("agent.json");
    std::fs::write(&a, "new").unwrap();
    let journal = Journal {
        changes: vec![Change {
            path: a.clone(),
            before: Some("old".into()),
            after: "new".into(),
        }],
        catalog: Change {
            path: dir.join("catalog.json"),
            before: None,
            after: "committed".into(),
        },
    };
    atomic::write_json_file(&dir.join("management-transaction.json"), &journal).unwrap();
    recover(dir).unwrap();
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "old");
    std::fs::write(&a, "external").unwrap();
    atomic::write_json_file(&dir.join("management-transaction.json"), &journal).unwrap();
    assert!(recover(dir).is_err());
    assert_eq!(std::fs::read_to_string(a).unwrap(), "external");
}
#[test]
fn claude_local_scope_is_preserved_during_migration() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("claude.json");
    let dir = root.path().join("studio");
    let old = json!({"command":"demo"});
    std::fs::write(&path,json!({"projects":{"/work":{"mcpServers":{"tool":old},"other":"keep"}},"mcpServers":{"global":{"command":"global"}}}).to_string()).unwrap();
    let t = Target {
        project: Some("/work".into()),
        ..target(path.clone(), "claude", "tool", Some(old.clone()))
    };
    save(
        &dir,
        entry(native::canonical(&old, "claude"), "gateway"),
        vec![t],
        Path::new("/app"),
        None,
    )
    .unwrap();
    remove(&dir, "sample", true).unwrap();
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(doc["projects"]["/work"]["mcpServers"]["tool"], old);
    assert_eq!(doc["projects"]["/work"]["other"], "keep");
    assert_eq!(doc["mcpServers"]["global"]["command"], "global");
}

fn group(id: &str, agent: &str, ids: &[&str]) -> groups::Group {
    groups::Group {
        id: id.into(),
        agent: agent.into(),
        name: id.into(),
        entry_ids: ids.iter().map(|s| s.to_string()).collect(),
        references: vec![],
        sort_order: 0,
    }
}
#[test]
fn groups_switch_restore_and_isolate_agents_and_provider_settings() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let claude = root.path().join("claude.json");
    let codex = root.path().join("config.toml");
    std::fs::write(&claude, r#"{"env":{"ANTHROPIC_BASE_URL":"provider"},"projects":{"/work":{"mcpServers":{"project":{"command":"project"}}}},"mcpServers":{"manual":{"command":"manual"}}}"#).unwrap();
    std::fs::write(
        &codex,
        "# provider\nmodel_provider='ccswitch'\n[mcp_servers.manual]\ncommand='manual'\n",
    )
    .unwrap();
    let a = entry(json!({"type":"stdio","command":"a"}), "direct");
    let mut b = entry(
        json!({"type":"http","url":"https://example.com/mcp"}),
        "gateway",
    );
    b.id = "b".into();
    b.name = "B".into();
    save(&dir, a, vec![], Path::new("/app"), None).unwrap();
    save(&dir, b, vec![], Path::new("/app"), None).unwrap();
    groups::save_group(&dir, group("one", "claude", &["sample"]), vec![]).unwrap();
    groups::save_group(&dir, group("two", "claude", &["b"]), vec![]).unwrap();
    groups::save_group(&dir, group("code", "codex", &["sample"]), vec![]).unwrap();
    assert!(native::entry(
        &std::fs::read_to_string(&claude).unwrap(),
        "claude",
        None,
        "Sample"
    )
    .unwrap()
    .is_none());
    groups::activate(&dir, "claude", Some("one"), &claude, Path::new("/app")).unwrap();
    groups::activate(&dir, "codex", Some("code"), &codex, Path::new("/app")).unwrap();
    let codex_active = std::fs::read_to_string(&codex).unwrap();
    groups::activate(&dir, "claude", Some("two"), &claude, Path::new("/app")).unwrap();
    assert_eq!(std::fs::read_to_string(&codex).unwrap(), codex_active);
    let current = std::fs::read_to_string(&claude).unwrap();
    assert!(native::entry(&current, "claude", None, "Sample")
        .unwrap()
        .is_none());
    assert_eq!(
        native::entry(&current, "claude", None, "B")
            .unwrap()
            .unwrap()["args"][0],
        "--mcp-client"
    );
    assert!(!dir.join("config.json").exists()); // No gateway start required.
    groups::activate(&dir, "claude", None, &claude, Path::new("/app")).unwrap();
    let final_doc: Value =
        serde_json::from_str(&std::fs::read_to_string(&claude).unwrap()).unwrap();
    assert_eq!(final_doc["env"]["ANTHROPIC_BASE_URL"], "provider");
    assert_eq!(
        final_doc["mcpServers"],
        json!({"manual":{"command":"manual"}})
    );
    assert_eq!(
        final_doc["projects"]["/work"]["mcpServers"]["project"]["command"],
        "project"
    );
    assert!(read(&dir).unwrap().active_groups.contains_key("codex"));
    groups::activate(&dir, "codex", None, &codex, Path::new("/app")).unwrap();
    let final_codex = std::fs::read_to_string(&codex).unwrap();
    assert!(final_codex.starts_with("# provider\nmodel_provider='ccswitch'\n"));
    let doc: Value = toml_edit::de::from_str(&final_codex).unwrap();
    assert_eq!(doc["mcp_servers"], json!({"manual":{"command":"manual"}}));
}
#[test]
fn group_edits_are_pending_and_external_drift_prevents_partial_switch() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let path = root.path().join("config.toml");
    let a = entry(json!({"type":"stdio","command":"a"}), "direct");
    save(&dir, a, vec![], Path::new("/app"), None).unwrap();
    groups::save_group(&dir, group("one", "codex", &["sample"]), vec![]).unwrap();
    groups::activate(&dir, "codex", Some("one"), &path, Path::new("/app")).unwrap();
    let old = read(&dir).unwrap().entries[0].clone();
    let mut updated = old.clone();
    updated.definition["command"] = json!("new");
    let before = std::fs::read_to_string(&path).unwrap();
    save(&dir, updated, vec![], Path::new("/app"), Some(&old)).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    assert!(groups::remove_group(&dir, "codex", "one").is_err());
    assert!(remove(&dir, "sample", true).is_err());
    groups::activate(&dir, "codex", Some("one"), &path, Path::new("/app")).unwrap();
    assert_eq!(
        native::entry(
            &std::fs::read_to_string(&path).unwrap(),
            "codex",
            None,
            "Sample"
        )
        .unwrap()
        .unwrap()["command"],
        "new"
    );
    groups::save_group(&dir, group("two", "codex", &["sample"]), vec![]).unwrap();
    std::fs::write(
        &path,
        "model_provider='custom'\n[mcp_servers.Sample]\ncommand='externally-edited'\n",
    )
    .unwrap();
    let changed = std::fs::read(&path).unwrap();
    let catalog_before = std::fs::read(dir.join("catalog.json")).unwrap();
    assert!(groups::activate(&dir, "codex", Some("two"), &path, Path::new("/app")).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), changed);
    assert_eq!(
        std::fs::read(dir.join("catalog.json")).unwrap(),
        catalog_before
    );
    assert!(groups::issues(&read(&dir).unwrap()).contains_key("codex"));
}
#[test]
fn group_references_do_not_adopt_or_overwrite_manual_entries() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let path = root.path().join("config.toml");
    let original = "# keep formatting\n[mcp_servers.Sample]\ncommand='a'\n";
    std::fs::write(&path, original).unwrap();
    let definition = json!({"command":"a"});
    let mut imported = entry(native::canonical(&definition, "codex"), "direct");
    imported.name = "Display name".into();
    imported.bindings.push(Binding {
        id: "source".into(),
        agent: "codex".into(),
        path: path.clone(),
        project: None,
        key: "Sample".into(),
        original: Some(definition.clone()),
        installed: definition,
    });
    groups::save_group(&dir, group("one", "codex", &["sample"]), vec![imported]).unwrap();
    assert!(read(&dir).unwrap().entries.is_empty());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    groups::activate(&dir, "codex", Some("one"), &path, Path::new("/app")).unwrap();
    assert!(read(&dir).unwrap().active_groups["codex"]
        .bindings
        .is_empty());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    groups::activate(&dir, "codex", None, &path, Path::new("/app")).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    std::fs::write(&path, "[mcp_servers.Sample]\ncommand='changed'\n").unwrap();
    assert!(groups::activate(&dir, "codex", Some("one"), &path, Path::new("/app")).is_err());
    assert!(read(&dir).unwrap().active_groups.is_empty());
}
#[test]
fn groups_validate_ownership_missing_members_names_and_order_without_writing_targets() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let path = root.path().join("claude.json");
    groups::save_group(&dir, group("one", "claude", &["missing"]), vec![]).unwrap();
    groups::save_group(&dir, group("two", "claude", &[]), vec![]).unwrap();
    assert!(groups::save_group(&dir, group("one", "codex", &[]), vec![]).is_err());
    let mut duplicate = group("three", "claude", &[]);
    duplicate.name = "one".into();
    assert!(groups::save_group(&dir, duplicate, vec![]).is_err());
    assert!(groups::activate(&dir, "codex", Some("one"), &path, Path::new("/app")).is_err());
    assert!(groups::activate(&dir, "claude", Some("one"), &path, Path::new("/app")).is_err());
    assert!(groups::activate(&dir, "claude", Some("two"), &path, Path::new("/app")).is_err());
    assert!(!path.exists());
    groups::reorder(&dir, "claude", &["two".into(), "one".into()]).unwrap();
    assert!(groups::reorder(&dir, "claude", &["two".into(), "two".into()]).is_err());
    assert_eq!(
        read(&dir)
            .unwrap()
            .groups
            .iter()
            .find(|g| g.id == "two")
            .unwrap()
            .sort_order,
        0
    );
    groups::remove_group(&dir, "claude", "one").unwrap();
}

#[test]
fn deleting_unmanaged_sources_preserves_other_keys_and_rejects_stale_snapshots() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let claude = root.path().join("claude.json");
    let codex = root.path().join("config.toml");
    let original = r#"{"env":{"KEEP":"yes"},"mcpServers":{"sample":{"command":"sample"},"other":{"command":"other"}}}"#;
    std::fs::write(&claude, original).unwrap();
    std::fs::write(
        &codex,
        "model='keep'\n[mcp_servers.sample]\ncommand='changed'\n",
    )
    .unwrap();
    let targets = || {
        vec![
            target(
                claude.clone(),
                "claude",
                "sample",
                Some(json!({"command":"sample"})),
            ),
            target(
                codex.clone(),
                "codex",
                "sample",
                Some(json!({"command":"sample"})),
            ),
        ]
    };
    assert!(remove_sources(&dir, targets()).is_err());
    assert_eq!(std::fs::read_to_string(&claude).unwrap(), original);
    std::fs::write(
        &codex,
        "model='keep'\n[mcp_servers.sample]\ncommand='sample'\n",
    )
    .unwrap();
    remove_sources(&dir, targets()).unwrap();
    let text = std::fs::read_to_string(&claude).unwrap();
    assert!(native::entry(&text, "claude", None, "sample")
        .unwrap()
        .is_none());
    assert!(native::entry(&text, "claude", None, "other")
        .unwrap()
        .is_some());
    assert!(text.contains("KEEP"));
    let text = std::fs::read_to_string(&codex).unwrap();
    assert!(native::entry(&text, "codex", None, "sample")
        .unwrap()
        .is_none());
    assert!(text.contains("keep"));
    assert!(read(&dir).unwrap().entries.is_empty());
}

#[test]
fn deleting_scanned_sources_rejects_managed_bindings() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let path = root.path().join("claude.json");
    save(
        &dir,
        entry(json!({"type":"stdio","command":"sample"}), "direct"),
        vec![target(path.clone(), "claude", "sample", None)],
        Path::new("/app"),
        None,
    )
    .unwrap();
    let catalog = read(&dir).unwrap();
    assert!(remove_sources(&dir, current_targets(&catalog.entries[0])).is_err());
    assert!(native::entry(
        &std::fs::read_to_string(path).unwrap(),
        "claude",
        None,
        "sample"
    )
    .unwrap()
    .is_some());
}

#[test]
fn deleting_scanned_sources_rejects_active_group_bindings() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let path = root.path().join("config.toml");
    save(
        &dir,
        entry(json!({"type":"stdio","command":"sample"}), "direct"),
        vec![],
        Path::new("/app"),
        None,
    )
    .unwrap();
    groups::save_group(&dir, group("one", "codex", &["sample"]), vec![]).unwrap();
    groups::activate(&dir, "codex", Some("one"), &path, Path::new("/app")).unwrap();
    let before = std::fs::read_to_string(&path).unwrap();
    let current = native::entry(&before, "codex", None, "Sample")
        .unwrap()
        .unwrap();
    assert!(remove_sources(
        &dir,
        vec![target(path.clone(), "codex", "Sample", Some(current))]
    )
    .is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
}

#[test]
fn referenced_group_deploys_only_missing_target_and_removes_only_its_copy() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let source = root.path().join("claude.json");
    let target = root.path().join("config.toml");
    let definition = json!({"command":"demo"});
    std::fs::write(
        &source,
        json!({"mcpServers":{"Sample":definition}}).to_string(),
    )
    .unwrap();
    let original = std::fs::read(&source).unwrap();
    let mut reference = entry(native::canonical(&definition, "claude"), "direct");
    reference.bindings.push(Binding {
        id: "source".into(),
        agent: "claude".into(),
        path: source.clone(),
        project: None,
        key: "Sample".into(),
        original: Some(definition.clone()),
        installed: definition,
    });
    groups::save_group(&dir, group("one", "codex", &["sample"]), vec![reference]).unwrap();
    assert!(read(&dir).unwrap().entries.is_empty());
    assert!(!target.exists());
    for _ in 0..2 {
        groups::activate(&dir, "codex", Some("one"), &target, Path::new("/app")).unwrap();
        assert_eq!(read(&dir).unwrap().active_groups["codex"].bindings.len(), 1);
    }
    groups::activate(&dir, "codex", None, &target, Path::new("/app")).unwrap();
    assert!(native::entry(
        &std::fs::read_to_string(&target).unwrap(),
        "codex",
        None,
        "Sample"
    )
    .unwrap()
    .is_none());
    groups::remove_group(&dir, "codex", "one").unwrap();
    assert_eq!(std::fs::read(&source).unwrap(), original);
    assert!(read(&dir).unwrap().entries.is_empty());
}

#[test]
fn group_does_not_reenable_manually_disabled_mcp() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("studio");
    let path = root.path().join("config.toml");
    let definition = json!({"command":"demo","enabled":false});
    let mut reference = entry(native::canonical(&definition, "codex"), "direct");
    std::fs::write(
        &path,
        "[mcp_servers.Sample]\ncommand='demo'\nenabled=false\n",
    )
    .unwrap();
    let original = std::fs::read(&path).unwrap();
    reference.bindings.push(Binding {
        id: "source".into(),
        agent: "codex".into(),
        path: path.clone(),
        project: None,
        key: "Sample".into(),
        original: Some(definition.clone()),
        installed: definition,
    });
    groups::save_group(&dir, group("one", "codex", &["sample"]), vec![reference]).unwrap();
    assert!(
        groups::activate(&dir, "codex", Some("one"), &path, Path::new("/app"))
            .unwrap_err()
            .to_string()
            .contains("手动停用")
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert!(read(&dir).unwrap().active_groups.is_empty());
}
