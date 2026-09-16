use std::path::PathBuf;

use skill_studio_core::models::project::ProjectBinding;
use skill_studio_core::models::skill::{LinkMode, LinkReport};
use skill_studio_core::Error;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::state::AppState;

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectBinding>, String> {
    Ok(state.config().projects.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_project(
    state: State<'_, AppState>,
    name: String,
    root: PathBuf,
) -> Result<ProjectBinding, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("项目名不能为空".into());
    }
    if !root.is_dir() {
        return Err(format!("项目目录不存在: {}", root.display()));
    }
    state
        .mutate(|_, config| {
            if config
                .projects
                .iter()
                .any(|p| skill_studio_core::fs::paths::is_same_path(&p.root, &root))
            {
                return Err(Error::invalid(format!(
                    "该目录已绑定为项目: {}",
                    root.display()
                )));
            }
            let project = ProjectBinding::new(uuid_v4(), name, root);
            config.projects.push(project.clone());
            Ok(project)
        })
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_project(
    state: State<'_, AppState>,
    project_id: String,
    name: Option<String>,
    agent_ids: Option<Vec<String>>,
    skill_ids: Option<Vec<String>>,
    group_ids: Option<Vec<String>>,
    link_mode: Option<LinkMode>,
) -> Result<ProjectBinding, String> {
    state
        .mutate(|_, config| {
            let project = config
                .project_mut(&project_id)
                .ok_or_else(|| Error::NotFound(format!("项目 {project_id}")))?;
            if let Some(n) = name {
                let n = n.trim().to_string();
                if n.is_empty() {
                    return Err(Error::invalid("项目名不能为空"));
                }
                project.name = n;
            }
            if let Some(a) = agent_ids {
                project.agent_ids = a;
            }
            if let Some(s) = skill_ids {
                project.skill_ids = s;
            }
            if let Some(g) = group_ids {
                project.group_ids = g;
            }
            if let Some(m) = link_mode {
                project.link_mode = m;
            }
            Ok(project.clone())
        })
        .map_err(Into::into)
}

/// 删除项目绑定。只删元数据，已写进项目目录的 skill 不动 ——
/// 那些文件可能已经提交进 git 了，替用户决定删除是越权。
#[tauri::command(rename_all = "camelCase")]
pub fn delete_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    state
        .mutate(|_, config| {
            let before = config.projects.len();
            config.projects.retain(|p| p.id != project_id);
            if config.projects.len() == before {
                return Err(Error::NotFound(format!("项目 {project_id}")));
            }
            Ok(())
        })
        .map_err(Into::into)
}

/// 把项目绑定写进各 agent 的项目目录
#[tauri::command(rename_all = "camelCase")]
pub fn apply_project(state: State<'_, AppState>, project_id: String) -> Result<LinkReport, String> {
    state
        .mutate(|studio, config| studio.apply_project(config, &project_id))
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn unapply_project(
    state: State<'_, AppState>,
    project_id: String,
    skill_ids: Vec<String>,
    force: Option<bool>,
) -> Result<LinkReport, String> {
    state
        .mutate(|studio, config| {
            studio.unapply_project(config, &project_id, &skill_ids, force.unwrap_or(false))
        })
        .map_err(Into::into)
}

/// 往项目的 .gitignore 追加托管痕迹文件。
///
/// 项目级默认 Copy，会在每个 skill 目录里留下 `.skill-studio-copy.json`。
/// 那是本机溯源信息，不该进版本库。
#[tauri::command(rename_all = "camelCase")]
pub fn write_project_gitignore(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<bool, String> {
    let root = state
        .config()
        .project(&project_id)
        .map(|p| p.root.clone())
        .ok_or_else(|| format!("项目 {project_id} 不存在"))?;

    write_skill_gitignore(&root).map_err(|e| e.to_string())
}

fn write_skill_gitignore(root: &std::path::Path) -> skill_studio_core::Result<bool> {
    const ENTRIES: &[&str] = &[
        "**/.skill-studio-copy.json",
        "**/.skill-studio-replace-*.json.lock",
        "**/.skill-studio-replace-*.json",
    ];
    let path = root.join(".gitignore");
    let existing = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(Error::io(&path, e)),
    };
    let missing: Vec<_> = ENTRIES
        .iter()
        .filter(|entry| !existing.lines().any(|line| line.trim() == **entry))
        .collect();
    if missing.is_empty() {
        return Ok(false);
    }
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    if !next.is_empty() {
        next.push('\n');
    }
    next.push_str("# Skill Studio 的本机溯源信息与事务记录，不应进版本库\n");
    for entry in missing {
        next.push_str(entry);
        next.push('\n');
    }
    skill_studio_core::fs::atomic::write_text_file(&path, &next)?;
    Ok(true)
}

#[cfg(test)]
mod gitignore_tests {
    use super::write_skill_gitignore;
    #[test]
    fn upgrades_existing_rules_without_duplicates_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".gitignore");
        std::fs::write(&path, "node_modules/\n**/.skill-studio-copy.json\n").unwrap();
        assert!(write_skill_gitignore(dir.path()).unwrap());
        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.starts_with("node_modules/\n"));
        assert_eq!(result.matches("**/.skill-studio-copy.json").count(), 1);
        assert!(result.contains("**/.skill-studio-replace-*.json.lock"));
        assert!(result.contains("**/.skill-studio-replace-*.json\n"));
        assert!(!write_skill_gitignore(dir.path()).unwrap());
        assert_eq!(std::fs::read_to_string(path).unwrap(), result);
    }
    #[test]
    fn unreadable_text_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".gitignore");
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(write_skill_gitignore(dir.path()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), [0xff, 0xfe]);
    }
}

/// 弹目录选择器
#[tauri::command(rename_all = "camelCase")]
pub async fn pick_directory(
    app: tauri::AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let initial = default_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    // State 不是 Send，不能跨 await；这里只用 AppHandle
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        if let Some(dir) = initial {
            builder = builder.set_directory(dir);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("目录选择器执行失败: {e}"))?;

    Ok(picked.map(|p| p.to_string()))
}

fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}
