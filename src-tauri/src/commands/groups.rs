use skill_studio_core::models::group::{Group, GroupApplyMode};
use skill_studio_core::models::skill::LinkReport;
use skill_studio_core::Error;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn list_groups(state: State<'_, AppState>) -> Result<Vec<Group>, String> {
    let mut groups = state.config().groups.clone();
    groups.sort_by_key(|g| g.sort_order);
    Ok(groups)
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_group(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    icon: Option<String>,
) -> Result<Group, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("分组名不能为空".into());
    }
    state
        .mutate(|_, config| {
            if config.groups.iter().any(|g| g.name == name) {
                return Err(Error::invalid(format!("已存在同名分组: {name}")));
            }
            let mut group = Group::new(uuid_v4(), name);
            group.description = description;
            group.icon = icon;
            group.sort_order = config.groups.len() as i32;
            config.groups.push(group.clone());
            Ok(group)
        })
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_group(
    state: State<'_, AppState>,
    group_id: String,
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
) -> Result<Group, String> {
    state
        .mutate(|_, config| {
            // 重名检查要排除自己
            if let Some(new_name) = name.as_ref().map(|n| n.trim().to_string()) {
                if new_name.is_empty() {
                    return Err(Error::invalid("分组名不能为空"));
                }
                if config
                    .groups
                    .iter()
                    .any(|g| g.name == new_name && g.id != group_id)
                {
                    return Err(Error::invalid(format!("已存在同名分组: {new_name}")));
                }
            }
            let group = config
                .group_mut(&group_id)
                .ok_or_else(|| Error::NotFound(format!("分组 {group_id}")))?;
            if let Some(n) = name {
                group.name = n.trim().to_string();
            }
            if description.is_some() {
                group.description = description;
            }
            if icon.is_some() {
                group.icon = icon;
            }
            Ok(group.clone())
        })
        .map_err(Into::into)
}

/// 删除分组。**只删元数据，不动任何已注册的文件** —— 分组是一次性应用语义，
/// 删组不等于撤销之前的注册。
#[tauri::command(rename_all = "camelCase")]
pub fn delete_group(state: State<'_, AppState>, group_id: String) -> Result<(), String> {
    state
        .mutate(|_, config| {
            let before = config.groups.len();
            config.groups.retain(|g| g.id != group_id);
            if config.groups.len() == before {
                return Err(Error::NotFound(format!("分组 {group_id}")));
            }
            for project in &mut config.projects {
                project.group_ids.retain(|id| id != &group_id);
            }
            Ok(())
        })
        .map_err(Into::into)
}

/// 整体替换分组成员（前端拖拽排序后直接提交顺序）
#[tauri::command(rename_all = "camelCase")]
pub fn set_group_skills(
    state: State<'_, AppState>,
    group_id: String,
    skill_ids: Vec<String>,
) -> Result<Group, String> {
    state
        .mutate(|_, config| {
            let group = config
                .group_mut(&group_id)
                .ok_or_else(|| Error::NotFound(format!("分组 {group_id}")))?;
            // 去重但保留前端给的顺序
            let mut seen = std::collections::HashSet::new();
            group.skill_ids = skill_ids
                .into_iter()
                .filter(|id| seen.insert(id.clone()))
                .collect();
            Ok(group.clone())
        })
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn reorder_groups(
    state: State<'_, AppState>,
    group_ids: Vec<String>,
) -> Result<Vec<Group>, String> {
    state
        .mutate(|_, config| {
            for (i, id) in group_ids.iter().enumerate() {
                if let Some(g) = config.group_mut(id) {
                    g.sort_order = i as i32;
                }
            }
            let mut groups = config.groups.clone();
            groups.sort_by_key(|g| g.sort_order);
            Ok(groups)
        })
        .map_err(Into::into)
}

/// 把分组应用到若干 agent：一次性 Add / Remove
#[tauri::command(rename_all = "camelCase")]
pub fn apply_group(
    state: State<'_, AppState>,
    group_id: String,
    agent_ids: Vec<String>,
    mode: GroupApplyMode,
    force: Option<bool>,
) -> Result<LinkReport, String> {
    state
        .mutate(|studio, config| {
            studio.apply_group(config, &group_id, &agent_ids, mode, force.unwrap_or(false))
        })
        .map_err(Into::into)
}

fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}
