#[path = "support.rs"]
mod support;
use serial_test::serial;
use skill_studio_core::{
    models::skill::{LinkMode, LinkStatus, SkillOrigin},
    services::{native_toggle, scanner},
};
use std::fs;
use support::Env;

#[test]
#[serial]
#[cfg(unix)]
fn external_aliases_are_deduplicated_unlinked_without_touching_source_and_not_adopted() {
    let env = Env::new();
    let source = env.write_simple_skill(&env.path().join("repository"), "real-name");
    fs::create_dir_all(env.codex_skills()).unwrap();
    for name in ["alias-one", "alias-two"] {
        std::os::unix::fs::symlink(&source, env.codex_skills().join(name)).unwrap();
    }
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let views = studio.scan_skills(&config).unwrap();
    assert_eq!(views.len(), 1);
    let view = &views[0];
    assert_eq!(view.skill.origin, SkillOrigin::External);
    assert_eq!(view.agents["codex"].status, LinkStatus::Linked);
    assert_eq!(view.agents["codex"].entry_paths.len(), 2);
    assert!(studio.adopt_to_hub(&mut config, &view.skill.id).is_err());
    assert!(studio
        .unregister(
            &mut config,
            std::slice::from_ref(&view.skill.id),
            &["codex".into()],
            false
        )
        .unwrap()
        .is_all_ok());
    assert!(source.join("SKILL.md").is_file());
    assert!(!env
        .codex_skills()
        .join("alias-one")
        .symlink_metadata()
        .is_ok());
    assert!(!env
        .codex_skills()
        .join("alias-two")
        .symlink_metadata()
        .is_ok());
}

#[test]
#[serial]
#[cfg(unix)]
fn existing_in_place_source_retains_id_when_referenced_by_an_alias() {
    let env = Env::new();
    let source = env.write_simple_skill(&env.claude_skills(), "real");
    let studio = env.studio();
    let config = studio.load_config().unwrap();
    let before = studio.scan_skills(&config).unwrap().remove(0);
    fs::create_dir_all(env.codex_skills()).unwrap();
    std::os::unix::fs::symlink(source, env.codex_skills().join("different-name")).unwrap();
    let views = studio.scan_skills(&config).unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].skill.id, before.skill.id);
    assert_eq!(
        views[0].agents["codex"].target_path,
        env.codex_skills().join("different-name")
    );
}

#[test]
#[serial]
#[cfg(unix)]
fn broken_and_cyclic_entries_are_visible_with_diagnostics() {
    let env = Env::new();
    fs::create_dir_all(env.codex_skills()).unwrap();
    std::os::unix::fs::symlink("missing", env.codex_skills().join("broken")).unwrap();
    std::os::unix::fs::symlink("cycle", env.codex_skills().join("cycle")).unwrap();
    let studio = env.studio();
    let config = studio.load_config().unwrap();
    let views = studio.scan_skills(&config).unwrap();
    assert_eq!(views.len(), 2);
    for v in views {
        assert!(!v.diagnostics.is_empty());
        assert_eq!(v.agents["codex"].status, LinkStatus::BrokenLink);
    }
}

#[test]
#[serial]
fn malformed_yaml_and_unclosed_frontmatter_remain_visible() {
    let env = Env::new();
    for (name, body) in [
        ("invalid", "---\nname: [invalid\n---\nbody"),
        ("unclosed", "---\nname: missing-end\n"),
    ] {
        env.write_skill(&env.claude_skills(), name, body);
    }
    let studio = env.studio();
    let config = studio.load_config().unwrap();
    for view in studio.scan_skills(&config).unwrap() {
        assert!(view.malformed_frontmatter);
        assert!(!view.frontmatter_error.unwrap().is_empty());
    }
}

#[test]
#[serial]
fn codex_path_rule_and_declared_name_precedence_follow_actual_document() {
    let env = Env::new();
    let source = env.write_skill(
        &env.codex_skills(),
        "directory-name",
        "---\nname: declared-name\ndescription: test\n---\nbody",
    );
    let other = env.write_skill(
        &env.codex_skills(),
        "other",
        "---\nname: declared-name\ndescription: test\n---\nbody",
    );
    let config_path = env.path().join(".codex/config.toml");
    fs::write(&config_path,format!("# keep\nmodel = \"test-model\"\n[[skills.config]]\npath = {:?}\nenabled = false\n[[skills.config]]\nname = \"declared-name\"\nenabled = true\n",source.join("SKILL.md").to_str().unwrap())).unwrap();
    let studio = env.studio();
    let config = studio.load_config().unwrap();
    let id = studio
        .scan_skills(&config)
        .unwrap()
        .into_iter()
        .find(|v| v.skill.name == "directory-name")
        .unwrap()
        .skill
        .id;
    assert!(!studio.find_skill(&config, &id).unwrap().name.is_empty());
    assert!(!native_toggle::is_codex_skill_disabled_at(
        &config_path,
        "declared-name",
        &source.join("SKILL.md")
    ));
    studio
        .set_skill_enabled(&config, &id, "codex", false)
        .unwrap();
    assert!(
        studio
            .scan_skills(&config)
            .unwrap()
            .iter()
            .find(|v| v.skill.id == id)
            .unwrap()
            .agents["codex"]
            .disabled
    );
    assert!(!native_toggle::is_codex_skill_disabled_at(
        &config_path,
        "declared-name",
        &other.join("SKILL.md")
    ));
    // A later broad disable must be overridden only for the selected document.
    use std::io::Write;
    fs::OpenOptions::new()
        .append(true)
        .open(&config_path)
        .unwrap()
        .write_all(b"\n[[skills.config]]\nname = \"declared-name\"\nenabled = false\n")
        .unwrap();
    studio
        .set_skill_enabled(&config, &id, "codex", true)
        .unwrap();
    studio
        .set_skill_enabled(&config, &id, "codex", true)
        .unwrap();
    assert!(!native_toggle::is_codex_skill_disabled_at(
        &config_path,
        "declared-name",
        &source.join("SKILL.md")
    ));
    assert!(native_toggle::is_codex_skill_disabled_at(
        &config_path,
        "declared-name",
        &other.join("SKILL.md")
    ));
    let text = fs::read_to_string(config_path).unwrap();
    assert!(text.contains("# keep"));
    assert!(text.contains("test-model"));
    assert_eq!(text.matches("path = ").count(), 1);
}

#[test]
#[serial]
#[cfg(unix)]
fn codex_uses_copy_document_but_canonicalizes_symlink_document() {
    let env = Env::new();
    let source = env.write_simple_skill(&env.claude_skills(), "demo");
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let id = studio.scan_skills(&config).unwrap()[0].skill.id.clone();
    for mode in [LinkMode::Copy, LinkMode::Symlink] {
        assert!(studio
            .register(
                &mut config,
                std::slice::from_ref(&id),
                &["codex".into()],
                Some(mode),
                false
            )
            .unwrap()
            .is_all_ok());
        studio
            .set_skill_enabled(&config, &id, "codex", false)
            .unwrap();
        let text = fs::read_to_string(env.path().join(".codex/config.toml")).unwrap();
        let expected = if mode == LinkMode::Copy {
            env.codex_skills()
                .join("demo/SKILL.md")
                .canonicalize()
                .unwrap()
        } else {
            source.join("SKILL.md").canonicalize().unwrap()
        };
        assert!(text.contains(expected.to_str().unwrap()));
    }
}

#[test]
fn inline_codex_rules_are_supported_and_invalid_selectors_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let doc = dir.path().join("SKILL.md");
    fs::write(&doc, "body").unwrap();
    let config = dir.path().join("config.toml");
    fs::write(&config,format!("[skills]\nconfig = [{{name = \"n\", enabled = false}}, {{name = \"n\", path = {:?}, enabled = true}}]\n",doc.to_str().unwrap())).unwrap();
    assert!(native_toggle::is_codex_skill_disabled_at(
        &config, "n", &doc
    ));
    native_toggle::set_codex_skill_enabled_at(&config, &doc, true).unwrap();
    assert!(!native_toggle::is_codex_skill_disabled_at(
        &config, "n", &doc
    ));
    assert!(!scanner::parse_frontmatter(&doc).malformed);
}
