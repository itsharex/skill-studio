#[path = "support.rs"]
mod support;
use serial_test::serial;
use skill_studio_core::{
    models::{
        project::{ProjectBinding, ProjectSelection},
        skill::LinkMode,
    },
    services::scanner,
};
use std::fs;
use support::Env;
fn selection(ids: Vec<String>) -> ProjectSelection {
    ProjectSelection {
        agent_ids: vec!["codex".into()],
        skill_ids: ids,
        group_ids: vec![],
        link_mode: LinkMode::Copy,
    }
}

#[test]
#[serial]
fn selection_and_files_commit_together_and_deselection_removes_only_owned_copies() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let root = env.path().join("project");
    fs::create_dir(&root).unwrap();
    c.projects
        .push(ProjectBinding::new("p".into(), "P".into(), root.clone()));
    studio.save_config(&c).unwrap();
    env.write_simple_skill(&env.hub(), "demo");
    let id = studio.scan_skills(&c).unwrap()[0].skill.id.clone();
    let manual = env.write_simple_skill(&root.join(".agents/skills"), "manual");
    studio
        .write_project(&mut c, "p", Some(selection(vec![id.clone()])))
        .unwrap();
    assert_eq!(
        studio.load_config().unwrap().projects[0].skill_ids,
        vec![id]
    );
    assert!(root.join(".agents/skills/demo/SKILL.md").is_file());
    assert_eq!(c.projects[0].managed_entries.len(), 1);
    studio
        .write_project(&mut c, "p", Some(selection(vec![])))
        .unwrap();
    assert!(!root.join(".agents/skills/demo").exists());
    assert!(manual.exists());
    assert!(studio.load_config().unwrap().projects[0]
        .skill_ids
        .is_empty());
}

#[test]
#[serial]
fn conflict_does_not_save_selection_or_touch_existing_files() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let root = env.path().join("project");
    fs::create_dir(&root).unwrap();
    c.projects
        .push(ProjectBinding::new("p".into(), "P".into(), root.clone()));
    studio.save_config(&c).unwrap();
    env.write_simple_skill(&env.hub(), "demo");
    let id = studio.scan_skills(&c).unwrap()[0].skill.id.clone();
    let foreign = env.write_simple_skill(&root.join(".agents/skills"), "demo");
    let hash = scanner::dir_content_hash(&foreign).unwrap();
    let before = fs::read(studio.store().config_path()).unwrap();
    assert!(studio
        .write_project(&mut c, "p", Some(selection(vec![id])))
        .is_err());
    assert!(c.projects[0].skill_ids.is_empty());
    assert_eq!(before, fs::read(studio.store().config_path()).unwrap());
    assert_eq!(hash, scanner::dir_content_hash(&foreign).unwrap());
}

#[test]
#[serial]
fn modified_owned_copy_blocks_deselection_and_source_refresh() {
    let env = Env::new();
    let studio = env.studio();
    let mut c = studio.load_config().unwrap();
    let root = env.path().join("project");
    fs::create_dir(&root).unwrap();
    c.projects
        .push(ProjectBinding::new("p".into(), "P".into(), root.clone()));
    let source = env.write_simple_skill(&env.hub(), "demo");
    let id = studio.scan_skills(&c).unwrap()[0].skill.id.clone();
    studio
        .write_project(&mut c, "p", Some(selection(vec![id.clone()])))
        .unwrap();
    let dest = root.join(".agents/skills/demo/SKILL.md");
    fs::write(&dest, "local edits").unwrap();
    assert!(studio
        .write_project(&mut c, "p", Some(selection(vec![])))
        .is_err());
    fs::write(source.join("SKILL.md"), "source edits").unwrap();
    assert!(studio
        .write_project(&mut c, "p", Some(selection(vec![id])))
        .is_err());
    assert_eq!(fs::read_to_string(dest).unwrap(), "local edits");
}

#[test]
#[serial]
fn interrupted_project_write_restores_configuration_and_deployments() {
    let env = Env::new();
    let studio = env.studio();
    let c = studio.load_config().unwrap();
    studio.save_config(&c).unwrap();
    let before = fs::read(studio.store().config_path()).unwrap();
    let dest = env.path().join("project/skill");
    fs::create_dir_all(&dest).unwrap();
    fs::write(dest.join("SKILL.md"), "old").unwrap();
    let backup = dest.with_extension("backup");
    fs::rename(&dest, &backup).unwrap();
    fs::create_dir(&dest).unwrap();
    fs::write(dest.join("SKILL.md"), "new").unwrap();
    let config_path = studio.store().config_path();
    let config_backup = config_path.with_extension("backup");
    fs::rename(&config_path, &config_backup).unwrap();
    fs::write(&config_path, "bad").unwrap();
    let journal = studio.store().dir().join("project-write.json");
    fs::write(
        &journal,
        serde_json::to_vec(&serde_json::json!({
            "journal": journal, "committed": false,
            "entries": [
                {"target": dest, "backup": backup, "existed": true},
                {"target": config_path, "backup": config_backup, "existed": true}
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    studio.load_config().unwrap();
    assert_eq!(fs::read(studio.store().config_path()).unwrap(), before);
    assert_eq!(fs::read_to_string(dest.join("SKILL.md")).unwrap(), "old");
}
