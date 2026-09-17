#[path = "support.rs"]
mod support;
use serial_test::serial;
use skill_studio_core::{models::config::AppConfig, services::studio::Studio};
use std::fs;
use support::Env;

fn make(
    env: &Env,
    studio: &Studio,
    config: &mut AppConfig,
    group: &str,
    agent: &str,
    names: &[&str],
) -> String {
    for name in names {
        if !env.hub().join(name).exists() {
            env.write_simple_skill(&env.hub(), name);
        }
    }
    let all = studio.scan_skills(config).unwrap();
    let ids = names
        .iter()
        .map(|name| {
            all.iter()
                .find(|v| v.skill.name == *name)
                .unwrap()
                .skill
                .id
                .clone()
        })
        .collect();
    studio
        .save_agent_group(config, group.into(), agent, group, ids)
        .unwrap();
    group.into()
}

#[test]
#[serial]
fn switching_preserves_manual_and_shared_members_and_survives_reload() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let manual = env.write_simple_skill(&env.codex_skills(), "manual");
    let before = fs::read(manual.join("SKILL.md")).unwrap();
    let a = make(&env, &studio, &mut c, "a", "codex", &["one", "shared"]);
    let b = make(&env, &studio, &mut c, "b", "codex", &["two", "shared"]);
    studio
        .activate_agent_group(&mut c, "codex", Some(&a))
        .unwrap();
    let stamp = fs::read(env.codex_skills().join("shared/.skill-studio-copy.json")).unwrap();
    studio
        .activate_agent_group(&mut c, "codex", Some(&b))
        .unwrap();
    assert!(!env.codex_skills().join("one").exists());
    assert!(env.codex_skills().join("two/SKILL.md").is_file());
    assert_eq!(
        stamp,
        fs::read(env.codex_skills().join("shared/.skill-studio-copy.json")).unwrap()
    );
    assert_eq!(before, fs::read(manual.join("SKILL.md")).unwrap());
    assert_eq!(
        studio.load_config().unwrap().active_groups["codex"].group_id,
        "b"
    );
    studio.activate_agent_group(&mut c, "codex", None).unwrap();
    assert!(!env.codex_skills().join("two").exists());
    assert!(!env.codex_skills().join("shared").exists());
    assert!(manual.is_dir());
    assert!(env.hub().join("one").is_dir());
}

#[test]
#[serial]
fn manual_member_is_never_claimed_and_other_agent_is_independent() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    env.write_simple_skill(&env.codex_skills(), "manual");
    let manual_id = studio.scan_skills(&c).unwrap()[0].skill.id.clone();
    studio
        .save_agent_group(&mut c, "a".into(), "codex", "a", vec![manual_id])
        .unwrap();
    let b = make(&env, &studio, &mut c, "b", "claude-code", &["two"]);
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    assert!(c.active_groups["codex"].entries.is_empty());
    assert!(studio
        .activate_agent_group(&mut c, "codex", Some(&b))
        .is_err());
    studio
        .activate_agent_group(&mut c, "claude-code", Some(&b))
        .unwrap();
    studio.activate_agent_group(&mut c, "codex", None).unwrap();
    assert!(env.codex_skills().join("manual/SKILL.md").exists());
    assert!(env.claude_skills().join("two/SKILL.md").exists());
}

#[test]
#[serial]
fn local_edits_block_switch_without_changing_files_or_active_group() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    make(&env, &studio, &mut c, "a", "codex", &["one"]);
    make(&env, &studio, &mut c, "b", "codex", &["two"]);
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    fs::write(env.codex_skills().join("one/local.txt"), "keep me").unwrap();
    assert!(studio
        .activate_agent_group(&mut c, "codex", Some("b"))
        .is_err());
    assert_eq!(c.active_groups["codex"].group_id, "a");
    assert_eq!(
        fs::read_to_string(env.codex_skills().join("one/local.txt")).unwrap(),
        "keep me"
    );
    assert!(!env.codex_skills().join("two").exists());
}

#[test]
#[serial]
fn native_write_failure_rolls_back_removed_group_and_partial_new_copy() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    make(&env, &studio, &mut c, "a", "codex", &["one"]);
    make(&env, &studio, &mut c, "b", "codex", &["two"]);
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    let config_before = fs::read(studio.store().config_path()).unwrap();
    let native = env.path().join(".codex/config.toml");
    fs::write(&native, "[invalid").unwrap();
    assert!(studio
        .activate_agent_group(&mut c, "codex", Some("b"))
        .is_err());
    assert!(env.codex_skills().join("one/SKILL.md").is_file());
    assert!(!env.codex_skills().join("two").exists());
    assert_eq!(fs::read_to_string(native).unwrap(), "[invalid");
    assert_eq!(
        fs::read(studio.store().config_path()).unwrap(),
        config_before
    );
    assert_eq!(c.active_groups["codex"].group_id, "a");
}

#[test]
#[serial]
fn edit_is_draft_until_apply_and_repeated_activation_is_idempotent() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    make(&env, &studio, &mut c, "a", "codex", &["one"]);
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    make(&env, &studio, &mut c, "a", "codex", &["two"]);
    assert!(env.codex_skills().join("one").exists());
    assert!(!env.codex_skills().join("two").exists());
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    let before = fs::read(env.codex_skills().join("two/.skill-studio-copy.json")).unwrap();
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    assert_eq!(
        before,
        fs::read(env.codex_skills().join("two/.skill-studio-copy.json")).unwrap()
    );
    assert!(!env.codex_skills().join("one").exists());
}

#[test]
#[serial]
fn v1_shared_groups_and_project_references_survive_upgrade() {
    let env = Env::new();
    let studio = env.studio();
    let path = studio.store().config_path();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path,r#"{"version":1,"groups":[{"id":"old","name":"Old","skillIds":["s"]}],"projects":[{"id":"p","name":"P","root":"/tmp/project","groupIds":["old"]}]}"#).unwrap();
    let c = studio.load_config().unwrap();
    assert_eq!(c.version, 2);
    assert_eq!(c.groups[0].agent_id, None);
    assert_eq!(c.projects[0].group_ids, vec!["old"]);
    assert!(c.active_groups.is_empty());
}

#[test]
#[serial]
fn invalid_member_leaves_previous_combination_active() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    make(&env, &studio, &mut c, "a", "codex", &["one"]);
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    studio
        .save_agent_group(&mut c, "b".into(), "codex", "b", vec!["missing".into()])
        .unwrap();
    assert!(studio
        .activate_agent_group(&mut c, "codex", Some("b"))
        .is_err());
    assert_eq!(c.active_groups["codex"].group_id, "a");
    assert!(env.codex_skills().join("one").exists());
}

#[test]
#[serial]
fn claude_uses_directory_name_and_does_not_change_unrelated_native_rules() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    env.write_skill(
        &env.hub(),
        "folder",
        "---\nname: declared\ndescription: test\n---\nbody",
    );
    make(&env, &studio, &mut c, "a", "claude-code", &["folder"]);
    fs::create_dir_all(env.path().join(".claude")).unwrap();
    fs::write(
        env.path().join(".claude/settings.json"),
        r#"{"skillOverrides":{"folder":"off","unrelated":"off"},"other":42}"#,
    )
    .unwrap();
    studio
        .activate_agent_group(&mut c, "claude-code", Some("a"))
        .unwrap();
    let views = studio.scan_skills(&c).unwrap();
    assert!(!views[0].agents["claude-code"].disabled);
    let v: serde_json::Value =
        serde_json::from_slice(&fs::read(env.path().join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(v["skillOverrides"]["unrelated"], "off");
    assert_eq!(v["other"], 42);
}

#[test]
#[serial]
fn project_only_applies_scoped_group_to_its_owner() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    make(&env, &studio, &mut c, "a", "codex", &["one"]);
    let mut p = skill_studio_core::models::project::ProjectBinding::new(
        "p".into(),
        "P".into(),
        env.path().join("project"),
    );
    p.agent_ids = vec!["codex".into(), "claude-code".into()];
    p.group_ids = vec!["a".into()];
    fs::create_dir_all(&p.root).unwrap();
    c.projects.push(p);
    let r = studio.apply_project(&mut c, "p").unwrap();
    assert!(r.failed.is_empty());
    assert_eq!(r.success.len(), 1);
    assert_eq!(r.success[0].agent_id, "codex");
}

#[test]
#[serial]
fn active_skill_cannot_be_adopted_until_group_stops() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    env.write_simple_skill(&env.claude_skills(), "manual");
    let id = studio.scan_skills(&c).unwrap()[0].skill.id.clone();
    studio
        .save_agent_group(&mut c, "a".into(), "codex", "a", vec![id.clone()])
        .unwrap();
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    assert!(studio.adopt_to_hub(&mut c, &id).is_err());
    studio.activate_agent_group(&mut c, "codex", None).unwrap();
    studio.adopt_to_hub(&mut c, &id).unwrap();
}

#[test]
#[serial]
fn startup_recovers_interrupted_group_switch_journal() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    make(&env, &studio, &mut c, "a", "codex", &["one"]);
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    let target = env.codex_skills().join("one");
    let backup = env.codex_skills().join(".one.test-backup");
    fs::rename(&target, &backup).unwrap();
    fs::write(studio.store().dir().join("group-switch.json"),serde_json::to_vec(&serde_json::json!({"journal":studio.store().dir().join("group-switch.json"),"entries":[{"target":target,"backup":backup,"existed":true}],"committed":false})).unwrap()).unwrap();
    let loaded = studio.load_config().unwrap();
    assert_eq!(loaded.active_groups["codex"].group_id, "a");
    assert!(target.join("SKILL.md").is_file());
    assert!(!backup.exists());
}

#[test]
#[serial]
fn disabled_manual_skill_is_not_enabled_or_claimed_silently() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    env.write_simple_skill(&env.codex_skills(), "manual");
    let id = studio.scan_skills(&c).unwrap()[0].skill.id.clone();
    studio.set_skill_enabled(&c, &id, "codex", false).unwrap();
    let before = fs::read(env.path().join(".codex/config.toml")).unwrap();
    studio
        .save_agent_group(&mut c, "a".into(), "codex", "a", vec![id])
        .unwrap();
    assert!(studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .is_err());
    assert!(c.active_groups.is_empty());
    assert_eq!(
        before,
        fs::read(env.path().join(".codex/config.toml")).unwrap()
    );
}

#[test]
#[serial]
fn exclusive_groups_suspend_manual_skills_and_restore_after_reload() {
    for agent_id in ["codex", "claude-code"] {
        let env = Env::new();
        let studio = env.studio();
        let mut c = studio.load_config().unwrap();
        assert!(c.settings.preserve_manual_skills);
        c.settings.preserve_manual_skills = false;
        let root = if agent_id == "codex" {
            env.codex_skills()
        } else {
            env.claude_skills()
        };
        let manual = env.write_simple_skill(&root, "manual");
        env.write_simple_skill(&root, "already-off");
        let views = studio.scan_skills(&c).unwrap();
        let manual_id = views
            .iter()
            .find(|s| s.skill.name == "manual")
            .unwrap()
            .skill
            .id
            .clone();
        let off_id = views
            .iter()
            .find(|s| s.skill.name == "already-off")
            .unwrap()
            .skill
            .id
            .clone();
        studio
            .set_skill_enabled(&c, &off_id, agent_id, false)
            .unwrap();
        let before = fs::read(manual.join("SKILL.md")).unwrap();
        make(&env, &studio, &mut c, "a", agent_id, &["one"]);
        studio
            .save_agent_group(&mut c, "b".into(), agent_id, "b", vec![manual_id.clone()])
            .unwrap();
        studio
            .activate_agent_group(&mut c, agent_id, Some("a"))
            .unwrap();
        assert!(
            studio
                .scan_skills(&c)
                .unwrap()
                .iter()
                .find(|v| v.skill.id == manual_id)
                .unwrap()
                .agents[agent_id]
                .disabled
        );
        assert_eq!(c.active_groups[agent_id].suspended_manual.len(), 1);
        let mut c = studio.load_config().unwrap();
        // Choosing a suspended manual skill as a member restores it without copying or claiming it.
        studio
            .activate_agent_group(&mut c, agent_id, Some("b"))
            .unwrap();
        assert!(
            !studio
                .scan_skills(&c)
                .unwrap()
                .iter()
                .find(|v| v.skill.id == manual_id)
                .unwrap()
                .agents[agent_id]
                .disabled
        );
        assert!(c.active_groups[agent_id].entries.is_empty());
        studio
            .activate_agent_group(&mut c, agent_id, Some("a"))
            .unwrap();
        studio.activate_agent_group(&mut c, agent_id, None).unwrap();
        let views = studio.scan_skills(&c).unwrap();
        assert!(
            !views
                .iter()
                .find(|v| v.skill.id == manual_id)
                .unwrap()
                .agents[agent_id]
                .disabled
        );
        assert!(views.iter().find(|v| v.skill.id == off_id).unwrap().agents[agent_id].disabled);
        assert_eq!(before, fs::read(manual.join("SKILL.md")).unwrap());
        // Reapplying after changing the setting also restores manual skills.
        studio
            .activate_agent_group(&mut c, agent_id, Some("a"))
            .unwrap();
        c.settings.preserve_manual_skills = true;
        studio
            .activate_agent_group(&mut c, agent_id, Some("a"))
            .unwrap();
        assert!(
            !studio
                .scan_skills(&c)
                .unwrap()
                .iter()
                .find(|v| v.skill.id == manual_id)
                .unwrap()
                .agents[agent_id]
                .disabled
        );
        assert!(c.active_groups[agent_id].suspended_manual.is_empty());
    }
}

#[test]
#[serial]
fn exclusive_switch_failure_keeps_manual_state_and_active_group() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let manual = env.write_simple_skill(&env.codex_skills(), "manual");
    make(&env, &studio, &mut c, "a", "codex", &["one"]);
    make(&env, &studio, &mut c, "b", "codex", &["two"]);
    studio
        .activate_agent_group(&mut c, "codex", Some("a"))
        .unwrap();
    c.settings.preserve_manual_skills = false;
    let native = env.path().join(".codex/config.toml");
    fs::write(&native, "[invalid").unwrap();
    let before = fs::read(manual.join("SKILL.md")).unwrap();
    assert!(studio
        .activate_agent_group(&mut c, "codex", Some("b"))
        .is_err());
    assert_eq!(c.active_groups["codex"].group_id, "a");
    assert!(c.active_groups["codex"].suspended_manual.is_empty());
    assert_eq!(fs::read_to_string(native).unwrap(), "[invalid");
    assert_eq!(before, fs::read(manual.join("SKILL.md")).unwrap());
    assert!(env.codex_skills().join("one/SKILL.md").is_file());
    assert!(!env.codex_skills().join("two").exists());
}

#[test]
#[serial]
fn reapply_refreshes_stale_owned_copy_without_changing_manual_skills() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let g = make(&env, &studio, &mut c, "dev", "codex", &["demo"]);
    studio
        .activate_agent_group(&mut c, "codex", Some(&g))
        .unwrap();
    fs::write(env.hub().join("demo/new.txt"), "new content").unwrap();
    studio
        .activate_agent_group(&mut c, "codex", Some(&g))
        .unwrap();
    assert_eq!(
        fs::read_to_string(env.codex_skills().join("demo/new.txt")).unwrap(),
        "new content"
    );
    studio.activate_agent_group(&mut c, "codex", None).unwrap();
    assert!(!env.codex_skills().join("demo").exists());
}

#[test]
#[serial]
fn leaving_management_restores_manual_and_adopted_content_and_keeps_hub() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let manual = env.write_simple_skill(&env.codex_skills(), "manual");
    let bytes = fs::read(manual.join("SKILL.md")).unwrap();
    let source = studio
        .scan_skills(&c)
        .unwrap()
        .into_iter()
        .find(|v| v.skill.name == "manual")
        .unwrap()
        .skill;
    let hub = studio.adopt_to_hub(&mut c, &source.id).unwrap();
    c.settings.preserve_manual_skills = false;
    let group = make(&env, &studio, &mut c, "g", "codex", &["group-only"]);
    studio
        .activate_agent_group(&mut c, "codex", Some(&group))
        .unwrap();
    studio.set_agent_management(&mut c, "codex", false).unwrap();
    assert!(!skill_studio_core::services::scanner::is_symlink_or_junction(&manual));
    assert_eq!(fs::read(manual.join("SKILL.md")).unwrap(), bytes);
    assert!(hub.source_path.join("SKILL.md").exists());
    assert!(!env.codex_skills().join("group-only").exists());
    assert!(!c.active_groups.contains_key("codex"));
    assert!(studio
        .load_config()
        .unwrap()
        .settings
        .disabled_agents
        .contains(&"codex".into()));
    let views = studio.scan_skills(&c).unwrap();
    assert!(views
        .iter()
        .filter(|v| v.skill.name == "manual")
        .any(|v| !v.agents["codex"].disabled));
    assert!(studio
        .activate_agent_group(&mut c, "codex", Some(&group))
        .is_err());
    studio.set_agent_management(&mut c, "codex", true).unwrap();
    assert!(!c.active_groups.contains_key("codex"));
}

#[test]
#[serial]
fn leaving_management_conflict_keeps_management_and_files_unchanged() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let group = make(&env, &studio, &mut c, "g", "codex", &["modified"]);
    studio
        .activate_agent_group(&mut c, "codex", Some(&group))
        .unwrap();
    let dest = env.codex_skills().join("modified/SKILL.md");
    fs::write(&dest, "local changes").unwrap();
    let before = fs::read(studio.store().config_path()).unwrap();
    assert!(studio.set_agent_management(&mut c, "codex", false).is_err());
    assert!(c.settings.disabled_agents.is_empty());
    assert!(c.active_groups.contains_key("codex"));
    assert_eq!(fs::read(studio.store().config_path()).unwrap(), before);
    assert_eq!(fs::read_to_string(dest).unwrap(), "local changes");
}

#[test]
#[serial]
fn leaving_management_keeps_other_agent_group_and_rejects_missing_backup() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let manual = env.write_simple_skill(&env.codex_skills(), "adopted");
    let original = studio
        .scan_skills(&c)
        .unwrap()
        .into_iter()
        .find(|v| v.skill.name == "adopted")
        .unwrap()
        .skill;
    let hub = studio.adopt_to_hub(&mut c, &original.id).unwrap();
    let other = make(
        &env,
        &studio,
        &mut c,
        "other",
        "claude-code",
        &["other-only"],
    );
    studio
        .activate_agent_group(&mut c, "claude-code", Some(&other))
        .unwrap();
    let backup = c.skill_provenance[&hub.id]
        .backup_path
        .join("content/SKILL.md");
    let bytes = fs::read(&backup).unwrap();
    fs::write(&backup, "corrupt").unwrap();
    assert!(studio.set_agent_management(&mut c, "codex", false).is_err());
    assert!(c.settings.disabled_agents.is_empty());
    assert!(
        skill_studio_core::services::linker::link_status(&hub.source_path, &manual).is_registered()
    );
    fs::write(&backup, bytes).unwrap();
    studio.set_agent_management(&mut c, "codex", false).unwrap();
    assert!(c.active_groups.contains_key("claude-code"));
    assert!(env.claude_skills().join("other-only/SKILL.md").exists());
    assert!(hub.source_path.join("SKILL.md").exists());
    assert!(studio
        .register(
            &mut c,
            std::slice::from_ref(&hub.id),
            &["codex".into()],
            None,
            false
        )
        .is_err());
}
