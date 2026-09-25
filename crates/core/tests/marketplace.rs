#[path = "support.rs"]
mod support;
use serial_test::serial;
use skill_studio_core::services::{
    marketplace::{self, prepare_archive},
    scanner,
};
use std::io::{Cursor, Write};
use support::Env;

fn archive(files: &[(&str, &str)]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, text) in files {
        zip.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(text.as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[test]
#[serial]
fn install_nested_skill_is_atomic_idempotent_and_has_studio_origin() {
    let env = Env::new();
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let bytes = archive(&[
        (
            "repo-HEAD/plugins/demo/SKILL.md",
            "---\nname: demo\ndescription: test\n---\nbody",
        ),
        ("repo-HEAD/plugins/demo/scripts/test.txt", "resource"),
        ("repo-HEAD/other/SKILL.md", "---\nname: other\n---"),
    ]);
    let prepared = prepare_archive("owner/repo", "demo", &bytes).unwrap();
    let skill = studio
        .install_catalog_skill(&mut config, &prepared)
        .unwrap();
    assert_eq!(skill.source_path, env.hub().join("demo"));
    assert_eq!(
        std::fs::read_to_string(skill.source_path.join("scripts/test.txt")).unwrap(),
        "resource"
    );
    assert!(!env.hub().join("other").exists());
    assert!(config.registrations.is_empty());
    assert!(!env.codex_skills().exists());
    assert!(!env.claude_skills().exists());
    let mut reloaded = studio.load_config().unwrap();
    let views = studio.scan_skills(&reloaded).unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].source_ids, vec!["studio"]);
    assert!(views[0].provenance.is_none());
    assert_eq!(
        views[0].installation.as_ref().unwrap().repository_path,
        "plugins/demo"
    );
    assert_eq!(
        views[0].installation.as_ref().unwrap().content_hash,
        scanner::dir_content_hash(&skill.source_path).unwrap()
    );
    assert_eq!(
        studio
            .install_catalog_skill(&mut reloaded, &prepared)
            .unwrap()
            .id,
        skill.id
    );
    assert!(studio.release_from_hub(&mut reloaded, &skill.id).is_err());
}

#[test]
#[serial]
fn same_name_collision_never_overwrites_existing_hub_skill() {
    let env = Env::new();
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let existing = env.write_simple_skill(&env.hub(), "demo");
    let original = std::fs::read(existing.join("SKILL.md")).unwrap();
    let bytes = archive(&[("repo/demo/SKILL.md", "---\nname: demo\n---\nnew")]);
    let prepared = prepare_archive("owner/repo", "demo", &bytes).unwrap();
    assert!(studio
        .install_catalog_skill(&mut config, &prepared)
        .is_err());
    assert_eq!(std::fs::read(existing.join("SKILL.md")).unwrap(), original);
    assert!(config.skill_installations.is_empty());
}

#[test]
fn malformed_ambiguous_and_unsafe_archives_are_rejected() {
    for files in [
        vec![("../escape", "bad")],
        vec![
            ("root/a/demo/SKILL.md", "---\nname: demo\n---"),
            ("root/b/demo/SKILL.md", "---\nname: demo\n---"),
        ],
        vec![("root/demo/SKILL.md", "---\nname: [invalid\n---")],
        vec![("root/README.md", "no skill")],
    ] {
        assert!(prepare_archive("owner/repo", "demo", &archive(&files)).is_err());
    }
    assert!(prepare_archive("owner/repo", "demo", b"not a zip").is_err());
    for (source, id) in [
        ("../repo", "demo"),
        ("owner/repo/extra", "demo"),
        ("owner/repo", "../demo"),
        ("https://evil/repo", "demo"),
    ] {
        assert!(marketplace::validate_coordinates(source, id).is_err());
    }
}

#[test]
fn catalog_excludes_openclaw_but_preserves_generic_and_supported_agent_paths() {
    for path in [
        "skills/demo",
        ".claude/skills/demo",
        ".codex/skills/demo",
        ".agents/skills/demo",
    ] {
        let file = format!("root/{path}/SKILL.md");
        let bytes = archive(&[
            (&file, "---\nname: demo\n---\ngeneric"),
            (
                "root/.openclaw/skills/demo/SKILL.md",
                "---\nname: demo\n---\nopenclaw",
            ),
            (
                "root/nested/.openclaw/skills/demo/SKILL.md",
                "---\nname: demo\n---\nopenclaw",
            ),
        ]);
        assert_eq!(
            prepare_archive("owner/repo", "demo", &bytes)
                .unwrap()
                .repository_path,
            path
        );
        assert!(marketplace::prepare_catalog_archive(
            "owner/repo",
            "demo",
            &bytes,
            Some(".openclaw/skills/demo")
        )
        .is_err());
    }
    let only_openclaw = archive(&[(
        "root/.openclaw/skills/demo/SKILL.md",
        "---\nname: demo\n---",
    )]);
    assert!(prepare_archive("owner/repo", "demo", &only_openclaw).is_err());
}

#[test]
#[serial]
fn catalog_candidates_use_complete_content_and_install_only_the_selected_path() {
    use marketplace::{prepare_catalog_archive, CatalogPreparation};
    let document = "---\nname: demo\ndescription: shared description\n---\nbody";
    let bytes = archive(&[
        ("root/.codex/skills/demo/SKILL.md", document),
        ("root/.codex/skills/demo/scripts/tool.txt", "codex resource"),
        ("root/.claude/skills/demo/SKILL.md", document),
        (
            "root/.claude/skills/demo/scripts/tool.txt",
            "claude resource",
        ),
        ("root/.openclaw/skills/demo/SKILL.md", document),
        ("root/skills/other/SKILL.md", "---\nname: other\n---"),
    ]);
    let CatalogPreparation::SelectionRequired(candidates) =
        prepare_catalog_archive("owner/repo", "demo", &bytes, None).unwrap()
    else {
        panic!("expected selection")
    };
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].repository_path, ".claude/skills/demo");
    assert_eq!(candidates[1].repository_path, ".codex/skills/demo");
    assert_eq!(
        candidates[0].description.as_deref(),
        Some("shared description")
    );
    assert_ne!(candidates[0].content_hash, candidates[1].content_hash);
    for invalid in [
        "../demo",
        "/.codex/skills/demo",
        ".codex/skills/demo/../demo",
        "skills/other",
        "missing",
        ".openclaw/skills/demo",
    ] {
        assert!(prepare_catalog_archive("owner/repo", "demo", &bytes, Some(invalid)).is_err());
    }
    let CatalogPreparation::Ready(prepared) =
        prepare_catalog_archive("owner/repo", "demo", &bytes, Some(".codex/skills/demo")).unwrap()
    else {
        panic!("expected ready")
    };
    let env = Env::new();
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let skill = studio
        .install_catalog_skill(&mut config, &prepared)
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(skill.source_path.join("scripts/tool.txt")).unwrap(),
        "codex resource"
    );
    assert_eq!(
        config.skill_installations[&skill.id].repository_path,
        ".codex/skills/demo"
    );
    let CatalogPreparation::Ready(other) =
        prepare_catalog_archive("owner/repo", "demo", &bytes, Some(".claude/skills/demo")).unwrap()
    else {
        panic!("expected ready")
    };
    assert!(studio.install_catalog_skill(&mut config, &other).is_err());
}

#[test]
fn identical_candidates_report_matching_hashes() {
    let document = "---\nname: demo\n---\nbody";
    let bytes = archive(&[
        ("root/a/demo/SKILL.md", document),
        ("root/b/demo/SKILL.md", document),
    ]);
    let marketplace::CatalogPreparation::SelectionRequired(candidates) =
        marketplace::prepare_catalog_archive("owner/repo", "demo", &bytes, None).unwrap()
    else {
        panic!("expected selection")
    };
    assert_eq!(candidates[0].content_hash, candidates[1].content_hash);
}

#[test]
#[serial]
#[ignore = "requires live skills.sh and GitHub network"]
fn live_search_download_and_install_in_temporary_home() {
    let hits = marketplace::search("defuddle").unwrap();
    let hit = hits
        .iter()
        .find(|s| s.source == "kepano/obsidian-skills" && s.skill_id == "defuddle")
        .unwrap();
    let prepared = marketplace::prepare(&hit.source, &hit.skill_id).unwrap();
    let env = Env::new();
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let installed = studio
        .install_catalog_skill(&mut config, &prepared)
        .unwrap();
    assert!(installed.source_path.join("SKILL.md").is_file());
    assert_eq!(
        studio.scan_skills(&studio.load_config().unwrap()).unwrap()[0].source_ids,
        vec!["studio"]
    );
    assert!(config.registrations.is_empty());
    println!("Live search, repository resolution, complete install and persisted Studio origin passed: {}/{}", hit.source, hit.skill_id);
}

#[test]
#[serial]
fn local_collection_import_preserves_source_and_persists_studio_origin() {
    let env = Env::new();
    let collection = env.path().join("personal-agent-skills");
    let source = env.write_simple_skill(&collection.join("nested"), "demo");
    std::fs::write(source.join("reference.txt"), "keep me").unwrap();
    env.write_simple_skill(&collection, "second");
    env.write_simple_skill(&collection.join(".git"), "hidden");
    let found = marketplace::discover_local(&collection).unwrap();
    assert_eq!(found.len(), 2);
    assert_eq!(marketplace::discover_local(&source).unwrap().len(), 1);
    let before = scanner::dir_content_hash(&source).unwrap();
    let prepared = marketplace::prepare_local(&source).unwrap();
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let installed = studio
        .install_catalog_skill(&mut config, &prepared)
        .unwrap();
    assert_eq!(installed.source_path, env.hub().join("demo"));
    assert_eq!(scanner::dir_content_hash(&source).unwrap(), before);
    assert_eq!(
        scanner::dir_content_hash(&installed.source_path).unwrap(),
        before
    );
    let view = studio
        .scan_skills(&studio.load_config().unwrap())
        .unwrap()
        .remove(0);
    assert_eq!(view.source_ids, vec!["studio"]);
    assert_eq!(
        view.installation.unwrap().source,
        format!("local:{}", source.canonicalize().unwrap().display())
    );
    assert!(config.registrations.is_empty());
    studio
        .install_catalog_skill(&mut config, &prepared)
        .unwrap();
    assert_eq!(studio.scan_skills(&config).unwrap().len(), 1);
}

#[test]
#[serial]
fn local_import_rejects_invalid_and_conflicting_skills() {
    let env = Env::new();
    let source = env.write_skill(
        &env.path().join("local"),
        "demo",
        "---\nname: [invalid\n---",
    );
    assert!(marketplace::discover_local(&source).unwrap()[0]
        .error
        .is_some());
    assert!(marketplace::prepare_local(&source).is_err());
    env.write_simple_skill(&env.path().join("local"), "demo");
    let studio = env.studio();
    let mut config = studio.load_config().unwrap();
    let existing = env.write_simple_skill(&env.hub(), "demo");
    let before = scanner::dir_content_hash(&existing).unwrap();
    let prepared = marketplace::prepare_local(&source).unwrap();
    assert!(studio
        .install_catalog_skill(&mut config, &prepared)
        .is_err());
    assert_eq!(before, scanner::dir_content_hash(&existing).unwrap());
    assert!(config.skill_installations.is_empty());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/etc/hosts", source.join("outside")).unwrap();
        assert!(marketplace::prepare_local(&source).is_err());
    }
}
