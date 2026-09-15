//! 编排层：把 scanner / detector / linker / store / native_toggle 串起来，
//! 对上暴露 Tauri 命令直接需要的粗粒度操作。

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::models::agent::{AgentInfo, AGENTS};
use crate::models::config::{AppConfig, Registration};
use crate::models::group::GroupApplyMode;
use crate::models::skill::{
    skill_id_for, LinkMode, LinkReport, LinkResult, LinkStatus, Skill, SkillOrigin,
};
use crate::services::scanner::{EntryKind, Frontmatter};
use crate::services::{detector, linker, native_toggle, scanner, store::Store};

/// 某个 skill 在某个 agent 上的状态（给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillState {
    pub status: LinkStatus,
    /// 实际检查到的位置。未注册时是"将会写入"的位置。
    pub target_path: PathBuf,
    /// 通过 agent 原生配置停用（文件仍在）
    pub disabled: bool,
    pub mode: Option<LinkMode>,
}

/// 前端拿到的 skill 视图
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    #[serde(flatten)]
    pub skill: Skill,
    /// agent_id -> 状态
    pub agents: HashMap<String, AgentSkillState>,
    pub group_ids: Vec<String>,
    /// frontmatter 解析失败（YAML 坏了）
    pub malformed_frontmatter: bool,
}

pub struct Studio {
    store: Store,
}

impl Studio {
    pub fn new(store: Store) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn load_config(&self) -> Result<AppConfig> {
        self.store.load()
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<()> {
        self.store.save(config)
    }

    pub fn agents(&self, config: &AppConfig, skip_cli_probe: bool) -> Vec<AgentInfo> {
        detector::describe_all(&config.settings.agent_dir_overrides, skip_cli_probe)
    }

    /// 扫出全部 skill 真身。
    ///
    /// 真身来自两处：各 agent 全局根里的**真目录**（原地模式），以及 Hub 目录。
    /// 目标位置上的链接与复制不是真身，它们只是注册结果。
    pub fn scan_skills(&self, config: &AppConfig) -> Result<Vec<SkillView>> {
        let overrides = &config.settings.agent_dir_overrides;
        // skill_id -> Skill，同一路径只收一次
        let mut sources: HashMap<String, Skill> = HashMap::new();

        for agent in AGENTS {
            for root in agent.resolved_global_roots(overrides) {
                for entry in scanner::scan_root(&root, agent)? {
                    if !matches!(entry.kind, EntryKind::RealSkill) {
                        continue;
                    }
                    let id = skill_id_for(&entry.path);
                    sources.entry(id.clone()).or_insert_with(|| {
                        build_skill(
                            id.clone(),
                            &entry.name,
                            entry.path.clone(),
                            root.clone(),
                            SkillOrigin::InPlace {
                                owner_agent: agent.id.to_string(),
                            },
                            entry.frontmatter.clone(),
                        )
                    });
                }
            }
        }

        // Hub 目录：用任一 agent 的保留名规则都不合适，这里用 Claude 的（含 synced）
        // 只是为了复用扫描逻辑；Hub 里本不该有 synced。
        let hub = self.store.hub_dir(config);
        let claude = &AGENTS[0];
        for entry in scanner::scan_root(&hub, claude)? {
            if !matches!(entry.kind, EntryKind::RealSkill) {
                continue;
            }
            let id = skill_id_for(&entry.path);
            sources.entry(id.clone()).or_insert_with(|| {
                build_skill(
                    id.clone(),
                    &entry.name,
                    entry.path.clone(),
                    hub.clone(),
                    SkillOrigin::Hub,
                    entry.frontmatter.clone(),
                )
            });
        }

        let mut views: Vec<SkillView> = sources
            .into_values()
            .map(|skill| {
                let agents = self.agent_states(config, &skill);
                let group_ids = config
                    .groups_containing(&skill.id)
                    .into_iter()
                    .map(|g| g.id.clone())
                    .collect();
                SkillView {
                    malformed_frontmatter: false,
                    skill,
                    agents,
                    group_ids,
                }
            })
            .collect();

        views.sort_by(|a, b| a.skill.name.cmp(&b.skill.name));
        Ok(views)
    }

    /// 计算一个 skill 在所有 agent 上的状态。
    ///
    /// 会遍历该 agent 的**全部**全局根，而不是只看写入根 —— 否则用户手工放到
    /// `~/.agents/skills` 的 skill 会被误报成未注册。
    fn agent_states(&self, config: &AppConfig, skill: &Skill) -> HashMap<String, AgentSkillState> {
        let overrides = &config.settings.agent_dir_overrides;
        let mut out = HashMap::new();

        for agent in AGENTS {
            let roots = agent.resolved_global_roots(overrides);
            let primary = roots.first().cloned().unwrap_or_default();
            let mut best: Option<(LinkStatus, PathBuf)> = None;

            for root in &roots {
                let dest = root.join(&skill.name);
                // 真身就在这个 root 里
                let status = if crate::fs::paths::is_same_path(&dest, &skill.source_path) {
                    LinkStatus::Source
                } else {
                    linker::link_status(&skill.source_path, &dest)
                };
                if status == LinkStatus::NotLinked {
                    continue;
                }
                // 优先展示"能用"的状态；其次才是需要关注的异常
                let replace = match &best {
                    None => true,
                    Some((prev, _)) => !prev.is_registered() && status.is_registered(),
                };
                if replace {
                    best = Some((status, dest));
                }
            }

            let (status, target_path) =
                best.unwrap_or((LinkStatus::NotLinked, primary.join(&skill.name)));
            let disabled = status.is_registered()
                && native_toggle::is_skill_disabled(agent, overrides, &skill.name);
            let mode = config.registration(&skill.id, agent.id).map(|r| r.mode);

            out.insert(
                agent.id.to_string(),
                AgentSkillState {
                    status,
                    target_path,
                    disabled,
                    mode,
                },
            );
        }
        out
    }

    /// 按 ID 找一个 skill 真身
    pub fn find_skill(&self, config: &AppConfig, skill_id: &str) -> Result<Skill> {
        self.scan_skills(config)?
            .into_iter()
            .find(|v| v.skill.id == skill_id)
            .map(|v| v.skill)
            .ok_or_else(|| Error::NotFound(format!("skill {skill_id}")))
    }

    /// 把若干 skill 注册到若干 agent。
    ///
    /// 单条失败不影响其余，全部结果汇总在 `LinkReport` 里。
    pub fn register(
        &self,
        config: &mut AppConfig,
        skill_ids: &[String],
        agent_ids: &[String],
        mode: Option<LinkMode>,
        force: bool,
    ) -> Result<LinkReport> {
        let skills = self.resolve_skills(config, skill_ids)?;
        let mode = mode.unwrap_or(config.settings.default_link_mode);
        let overrides = config.settings.agent_dir_overrides.clone();
        let mut report = LinkReport::default();

        for agent_id in agent_ids {
            let agent = crate::models::agent::require_agent(agent_id)?;
            let root = agent.primary_global_root(&overrides);
            for skill in &skills {
                let dest = root.join(&skill.name);
                // 真身就在这儿，没什么可注册的
                if crate::fs::paths::is_same_path(&dest, &skill.source_path) {
                    report.push_ok(result(skill, agent_id, LinkStatus::Source, None));
                    continue;
                }
                match linker::register(&skill.source_path, &dest, mode, &skill.id, force) {
                    Ok(done) => {
                        config.set_registration(
                            &skill.id,
                            agent_id,
                            Registration {
                                mode: done.mode,
                                target_path: dest.clone(),
                                registered_at: linker::now_secs(),
                                source_hash_at_copy: done.source_hash,
                            },
                        );
                        report.push_ok(result(skill, agent_id, done.status, None));
                    }
                    Err(err) => report.push_err(result(
                        skill,
                        agent_id,
                        linker::link_status(&skill.source_path, &dest),
                        Some(err.to_string()),
                    )),
                }
            }
        }
        Ok(report)
    }

    /// 取消注册。只移除本工具管理的内容，`Foreign` 会以失败条目返回。
    pub fn unregister(
        &self,
        config: &mut AppConfig,
        skill_ids: &[String],
        agent_ids: &[String],
        force: bool,
    ) -> Result<LinkReport> {
        let skills = self.resolve_skills(config, skill_ids)?;
        let overrides = config.settings.agent_dir_overrides.clone();
        let mut report = LinkReport::default();

        for agent_id in agent_ids {
            let agent = crate::models::agent::require_agent(agent_id)?;
            for skill in &skills {
                // 遍历全部根，把散落在共享根里的注册也清掉
                for root in agent.resolved_global_roots(&overrides) {
                    let dest = root.join(&skill.name);
                    if crate::fs::paths::is_same_path(&dest, &skill.source_path) {
                        // 不能把真身当注册删掉
                        continue;
                    }
                    match linker::unregister(&skill.source_path, &dest, force) {
                        Ok(true) => {
                            config.remove_registration(&skill.id, agent_id);
                            report.push_ok(result(skill, agent_id, LinkStatus::NotLinked, None));
                        }
                        Ok(false) => {}
                        Err(err) => report.push_err(result(
                            skill,
                            agent_id,
                            linker::link_status(&skill.source_path, &dest),
                            Some(err.to_string()),
                        )),
                    }
                }
            }
        }
        Ok(report)
    }

    /// 分组应用：**一次性 Add / Remove**。
    ///
    /// Add 只加组内 skill，该 agent 上其他 skill 一律不动；
    /// Remove 只移除组内 skill，且只移除本工具管理的。不做持续对账。
    pub fn apply_group(
        &self,
        config: &mut AppConfig,
        group_id: &str,
        agent_ids: &[String],
        mode: GroupApplyMode,
        force: bool,
    ) -> Result<LinkReport> {
        let skill_ids = config
            .group(group_id)
            .ok_or_else(|| Error::NotFound(format!("分组 {group_id}")))?
            .skill_ids
            .clone();
        if skill_ids.is_empty() {
            return Ok(LinkReport::default());
        }
        match mode {
            GroupApplyMode::Add => self.register(config, &skill_ids, agent_ids, None, force),
            GroupApplyMode::Remove => self.unregister(config, &skill_ids, agent_ids, force),
        }
    }

    /// 应用项目绑定：把项目里的 skill（含所绑分组）写进该项目各 agent 的目录。
    ///
    /// 项目级默认 Copy —— symlink 进 git 只是个指向本机绝对路径的死链。
    pub fn apply_project(&self, config: &mut AppConfig, project_id: &str) -> Result<LinkReport> {
        let project = config
            .project(project_id)
            .ok_or_else(|| Error::NotFound(format!("项目 {project_id}")))?
            .clone();

        // 直接指定的 skill + 所绑分组展开后的 skill，去重
        let mut ids: Vec<String> = project.skill_ids.clone();
        let mut seen: HashSet<String> = ids.iter().cloned().collect();
        for gid in &project.group_ids {
            if let Some(group) = config.group(gid) {
                for sid in &group.skill_ids {
                    if seen.insert(sid.clone()) {
                        ids.push(sid.clone());
                    }
                }
            }
        }
        if ids.is_empty() {
            return Ok(LinkReport::default());
        }

        let skills = self.resolve_skills(config, &ids)?;
        let mut report = LinkReport::default();

        for agent_id in &project.agent_ids {
            let agent = crate::models::agent::require_agent(agent_id)?;
            let Some(root) = agent.project_root(&project.root) else {
                report.push_err(LinkResult {
                    skill_id: String::new(),
                    skill_name: String::new(),
                    agent_id: agent_id.clone(),
                    status: LinkStatus::NotLinked,
                    message: Some(format!("{} 不支持项目级 skill", agent.display_name)),
                });
                continue;
            };
            for skill in &skills {
                let dest = root.join(&skill.name);
                match linker::register(
                    &skill.source_path,
                    &dest,
                    project.link_mode,
                    &skill.id,
                    false,
                ) {
                    Ok(done) => report.push_ok(result(skill, agent_id, done.status, None)),
                    Err(err) => report.push_err(result(
                        skill,
                        agent_id,
                        linker::link_status(&skill.source_path, &dest),
                        Some(err.to_string()),
                    )),
                }
            }
        }
        Ok(report)
    }

    /// 从项目里移除某些 skill 的注册
    pub fn unapply_project(
        &self,
        config: &mut AppConfig,
        project_id: &str,
        skill_ids: &[String],
        force: bool,
    ) -> Result<LinkReport> {
        let project = config
            .project(project_id)
            .ok_or_else(|| Error::NotFound(format!("项目 {project_id}")))?
            .clone();
        let skills = self.resolve_skills(config, skill_ids)?;
        let mut report = LinkReport::default();

        for agent_id in &project.agent_ids {
            let agent = crate::models::agent::require_agent(agent_id)?;
            let Some(root) = agent.project_root(&project.root) else {
                continue;
            };
            for skill in &skills {
                let dest = root.join(&skill.name);
                match linker::unregister(&skill.source_path, &dest, force) {
                    Ok(true) => {
                        report.push_ok(result(skill, agent_id, LinkStatus::NotLinked, None))
                    }
                    Ok(false) => {}
                    Err(err) => report.push_err(result(
                        skill,
                        agent_id,
                        linker::link_status(&skill.source_path, &dest),
                        Some(err.to_string()),
                    )),
                }
            }
        }
        Ok(report)
    }

    /// 通过 agent 原生配置启停某个 skill（不动文件）
    pub fn set_skill_enabled(
        &self,
        config: &AppConfig,
        skill_name: &str,
        agent_id: &str,
        enabled: bool,
    ) -> Result<()> {
        let agent = crate::models::agent::require_agent(agent_id)?;
        native_toggle::set_skill_enabled(
            agent,
            &config.settings.agent_dir_overrides,
            skill_name,
            enabled,
        )
    }

    /// 把一个原地 skill 收编到 Hub：移动真身，并把原位置改成指向 Hub 的注册。
    ///
    /// 移动前会校验 Hub 与所有 agent 目录不重叠，且目标不存在。
    pub fn adopt_to_hub(&self, config: &mut AppConfig, skill_id: &str) -> Result<Skill> {
        let skill = self.find_skill(config, skill_id)?;
        if matches!(skill.origin, SkillOrigin::Hub) {
            return Ok(skill);
        }
        let hub = self.store.hub_dir(config);
        let overrides = config.settings.agent_dir_overrides.clone();
        let all_roots: Vec<PathBuf> = AGENTS
            .iter()
            .flat_map(|a| a.resolved_global_roots(&overrides))
            .collect();
        linker::ensure_distinct_roots(&hub, &all_roots)?;

        std::fs::create_dir_all(&hub).map_err(|e| Error::io(&hub, e))?;
        let target = hub.join(&skill.name);
        if target.exists() || scanner::is_symlink_or_junction(&target) {
            return Err(Error::invalid(format!(
                "Hub 里已存在同名 skill: {}",
                target.display()
            )));
        }

        // 先复制到 Hub（带校验），成功后再把原位置换成链接，最后删原目录。
        // 顺序保证任何一步失败都不会丢内容。
        linker::replace_dest_with_copy(&skill.source_path, &target, &skill.id)?;
        // Hub 里的真身不需要复制边车
        let _ = std::fs::remove_file(target.join(scanner::COPY_SIDECAR));

        let old_path = skill.source_path.clone();
        std::fs::remove_dir_all(&old_path).map_err(|e| Error::io(&old_path, e))?;
        linker::register(
            &target,
            &old_path,
            config.settings.default_link_mode,
            &skill.id,
            false,
        )?;

        // 真身路径变了 → ID 变了，迁移分组 / 项目 / 注册里的引用
        let new_id = skill_id_for(&target);
        migrate_skill_id(config, &skill.id, &new_id);

        let mut adopted = skill;
        adopted.id = new_id;
        adopted.source_path = target;
        adopted.root = hub;
        adopted.origin = SkillOrigin::Hub;
        Ok(adopted)
    }

    fn resolve_skills(&self, config: &AppConfig, ids: &[String]) -> Result<Vec<Skill>> {
        let all = self.scan_skills(config)?;
        let by_id: HashMap<&str, &Skill> = all
            .iter()
            .map(|v| (v.skill.id.as_str(), &v.skill))
            .collect();
        ids.iter()
            .map(|id| {
                by_id
                    .get(id.as_str())
                    .map(|s| (*s).clone())
                    .ok_or_else(|| Error::NotFound(format!("skill {id}")))
            })
            .collect()
    }

    /// 清理引用了已消失 skill 的分组成员与注册记录
    pub fn prune(&self, config: &mut AppConfig) -> Result<usize> {
        let existing: HashSet<String> = self
            .scan_skills(config)?
            .into_iter()
            .map(|v| v.skill.id)
            .collect();
        Ok(config.prune_missing_skills(&existing))
    }
}

fn migrate_skill_id(config: &mut AppConfig, old: &str, new: &str) {
    for group in &mut config.groups {
        for id in &mut group.skill_ids {
            if id == old {
                *id = new.to_string();
            }
        }
    }
    for project in &mut config.projects {
        for id in &mut project.skill_ids {
            if id == old {
                *id = new.to_string();
            }
        }
    }
    if let Some(regs) = config.registrations.remove(old) {
        config.registrations.insert(new.to_string(), regs);
    }
    if let Some(meta) = config.skill_meta.remove(old) {
        config.skill_meta.insert(new.to_string(), meta);
    }
}

fn build_skill(
    id: String,
    name: &str,
    source_path: PathBuf,
    root: PathBuf,
    origin: SkillOrigin,
    frontmatter: Option<Frontmatter>,
) -> Skill {
    let fm = frontmatter.unwrap_or_default();
    let content_hash = scanner::dir_content_hash(&source_path).unwrap_or_default();
    Skill {
        id,
        name: name.to_string(),
        display_name: fm.name.clone(),
        description: fm.description.clone(),
        source_path,
        origin,
        content_hash,
        frontmatter_extra: fm.extra_keys.clone(),
        root,
    }
}

fn result(
    skill: &Skill,
    agent_id: &str,
    status: LinkStatus,
    message: Option<String>,
) -> LinkResult {
    LinkResult {
        skill_id: skill.id.clone(),
        skill_name: skill.name.clone(),
        agent_id: agent_id.to_string(),
        status,
        message,
    }
}
