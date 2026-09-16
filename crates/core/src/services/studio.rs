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
    /// 同一来源在该 agent 下的全部入口（含别名）。
    pub entry_paths: Vec<PathBuf>,
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
    pub frontmatter_error: Option<String>,
    pub diagnostics: Vec<String>,
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
        let config = self.store.load()?;
        let mut roots: Vec<PathBuf> = AGENTS
            .iter()
            .flat_map(|a| a.resolved_global_roots(&config.settings.agent_dir_overrides))
            .collect();
        for project in &config.projects {
            for agent in AGENTS {
                if let Some(root) = agent.project_root(&project.root) {
                    roots.push(root);
                }
            }
        }
        for regs in config.registrations.values() {
            for reg in regs.values() {
                if let Some(parent) = reg.target_path.parent() {
                    roots.push(parent.to_path_buf());
                }
            }
        }
        for root in roots {
            linker::recover_replacements(&root)?;
        }
        Ok(config)
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
                    if sources
                        .values()
                        .any(|s| crate::fs::paths::paths_alias(&s.source_path, &entry.path))
                    {
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
            if sources
                .values()
                .any(|s| crate::fs::paths::paths_alias(&s.source_path, &entry.path))
            {
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

        // Resolve links only after real sources, so an alias cannot change an
        // existing source's ID or ownership. Never recurse through directory links.
        let mut identities: HashMap<PathBuf, String> = sources
            .values()
            .map(|skill| {
                (
                    skill
                        .source_path
                        .canonicalize()
                        .unwrap_or_else(|_| skill.source_path.clone()),
                    skill.id.clone(),
                )
            })
            .collect();
        for agent in AGENTS {
            for root in agent.resolved_global_roots(overrides) {
                for entry in scanner::scan_root(&root, agent)? {
                    if !matches!(entry.kind, EntryKind::Link { .. }) {
                        continue;
                    }
                    let source = entry.path.canonicalize().unwrap_or_else(|_| {
                        scanner::link_destination(&entry.path)
                            .unwrap_or_else(|_| entry.path.clone())
                    });
                    if identities.contains_key(&source) {
                        continue;
                    }
                    let id = skill_id_for(&source);
                    identities.insert(source.clone(), id.clone());
                    let name = source
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or(&entry.name)
                        .to_string();
                    sources.insert(
                        id.clone(),
                        build_skill(
                            id,
                            &name,
                            source,
                            root.clone(),
                            SkillOrigin::External,
                            entry.frontmatter,
                        ),
                    );
                }
            }
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
                let fm = scanner::parse_frontmatter(&skill.source_path.join(scanner::SKILL_FILE));
                let diagnostics = if !skill.source_path.join(scanner::SKILL_FILE).is_file() {
                    vec!["链接目标不可用：目标缺失、存在循环，或不含 SKILL.md".into()]
                } else {
                    vec![]
                };
                SkillView {
                    malformed_frontmatter: fm.malformed,
                    frontmatter_error: fm.error,
                    diagnostics,
                    skill,
                    agents,
                    group_ids,
                }
            })
            .collect();

        views.sort_by(|a, b| a.skill.name.cmp(&b.skill.name));
        Ok(views)
    }

    fn agent_targets(
        &self,
        config: &AppConfig,
        skill: &Skill,
        agent: &crate::models::agent::AgentDescriptor,
    ) -> Vec<PathBuf> {
        let mut targets = Vec::new();
        if let Some(reg) = config.registration(&skill.id, agent.id) {
            targets.push(reg.target_path.clone());
        }
        for root in agent.resolved_global_roots(&config.settings.agent_dir_overrides) {
            targets.push(root.join(&skill.name));
            if let Ok(entries) = scanner::scan_root(&root, agent) {
                for entry in entries {
                    let matches = match entry.kind {
                        EntryKind::Link { .. } => {
                            crate::fs::paths::paths_alias(&entry.path, &skill.source_path)
                                || scanner::link_destination(&entry.path).is_ok_and(|p| {
                                    crate::fs::paths::paths_alias(&p, &skill.source_path)
                                })
                        }
                        EntryKind::ManagedCopy { source_path, .. } => {
                            crate::fs::paths::paths_alias(&source_path, &skill.source_path)
                        }
                        EntryKind::RealSkill => {
                            crate::fs::paths::paths_alias(&entry.path, &skill.source_path)
                        }
                        _ => false,
                    };
                    if matches {
                        targets.push(entry.path);
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        targets.retain(|p| {
            seen.insert(
                p.parent()
                    .and_then(|parent| parent.canonicalize().ok())
                    .unwrap_or_default()
                    .join(p.file_name().unwrap_or_default()),
            )
        });
        targets
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

            let targets = self.agent_targets(config, skill, agent);
            let entry_paths: Vec<PathBuf> = targets
                .iter()
                .filter(|p| p.symlink_metadata().is_ok())
                .cloned()
                .collect();
            for dest in targets {
                // 真身就在这个 root 里
                let status = if dest.join(scanner::SKILL_FILE).is_file()
                    && !scanner::is_symlink_or_junction(&dest)
                    && crate::fs::paths::paths_alias(&dest, &skill.source_path)
                {
                    LinkStatus::Source
                } else {
                    let status = linker::link_status(&skill.source_path, &dest);
                    if status == LinkStatus::Linked && !dest.join(scanner::SKILL_FILE).is_file() {
                        LinkStatus::BrokenLink
                    } else {
                        status
                    }
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
            let document = target_path.join(scanner::SKILL_FILE);
            let declared = scanner::parse_frontmatter(&document)
                .name
                .unwrap_or_else(|| skill.name.clone());
            let toggle_name = if agent.id == "codex" {
                &declared
            } else {
                target_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&skill.name)
            };
            let disabled = status.is_registered()
                && native_toggle::is_skill_disabled_at(agent, overrides, toggle_name, &document);
            let mode = config.registration(&skill.id, agent.id).map(|r| r.mode);

            out.insert(
                agent.id.to_string(),
                AgentSkillState {
                    status,
                    target_path,
                    disabled,
                    mode,
                    entry_paths,
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
                let dest = self
                    .agent_targets(config, skill, agent)
                    .into_iter()
                    .find(|p| {
                        crate::fs::paths::paths_alias(p, &skill.source_path)
                            || matches!(
                                linker::link_status(&skill.source_path, p),
                                LinkStatus::Copied
                                    | LinkStatus::CopyStale
                                    | LinkStatus::CopyModified
                                    | LinkStatus::CopyConflict
                                    | LinkStatus::CopyDamaged
                            )
                    })
                    .unwrap_or_else(|| root.join(&skill.name));
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
        let mut report = LinkReport::default();

        for agent_id in agent_ids {
            let agent = crate::models::agent::require_agent(agent_id)?;
            for skill in &skills {
                // 遍历全部根，把散落在共享根里的注册也清掉
                for dest in self.agent_targets(config, skill, agent) {
                    if !scanner::is_symlink_or_junction(&dest)
                        && crate::fs::paths::paths_alias(&dest, &skill.source_path)
                    {
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
        skill_id: &str,
        agent_id: &str,
        enabled: bool,
    ) -> Result<()> {
        let skill = self.find_skill(config, skill_id)?;
        let agent = crate::models::agent::require_agent(agent_id)?;
        let state = self
            .agent_states(config, &skill)
            .remove(agent_id)
            .ok_or_else(|| Error::invalid("未知 agent"))?;
        if !state.status.is_registered() {
            return Err(Error::invalid("该 skill 在目标 agent 上不可用"));
        }
        for target in state.entry_paths {
            if !linker::link_status(&skill.source_path, &target).is_registered()
                && !crate::fs::paths::paths_alias(&target, &skill.source_path)
            {
                continue;
            }
            let document = target.join(scanner::SKILL_FILE);
            let name = if agent_id == "codex" {
                scanner::parse_frontmatter(&document)
                    .name
                    .unwrap_or_else(|| skill.name.clone())
            } else {
                target.file_name().unwrap().to_string_lossy().into_owned()
            };
            native_toggle::set_skill_enabled_at(
                agent,
                &config.settings.agent_dir_overrides,
                &name,
                &document,
                enabled,
            )?;
        }
        Ok(())
    }

    /// 把一个原地 skill 收编到 Hub：移动真身，并把原位置改成指向 Hub 的注册。
    ///
    /// 移动前会校验 Hub 与所有 agent 目录不重叠，且目标不存在。
    pub fn adopt_to_hub(&self, config: &mut AppConfig, skill_id: &str) -> Result<Skill> {
        let skill = self.find_skill(config, skill_id)?;
        if matches!(skill.origin, SkillOrigin::Hub) {
            return Ok(skill);
        }
        if matches!(skill.origin, SkillOrigin::External) {
            return Err(Error::invalid(
                "外部来源仅通过链接引用，不能自动迁移或接管源目录",
            ));
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

        // Discover affected entries before moving the source; shared roots may alias.
        let old_path = skill.source_path.clone();
        let new_id = skill_id_for(&target);
        let mut candidates: Vec<PathBuf> = all_roots.iter().map(|r| r.join(&skill.name)).collect();
        for agent in AGENTS {
            candidates.extend(self.agent_targets(config, &skill, agent));
        }
        if let Some(regs) = config.registrations.get(&skill.id) {
            candidates.extend(regs.values().map(|r| r.target_path.clone()));
        }
        for project in &config.projects {
            if !project.root.is_dir() {
                return Err(Error::invalid(format!(
                    "项目不可访问，无法检查迁移引用: {}",
                    project.root.display()
                )));
            }
            // Include all supported roots, including deployments whose selection was later changed.
            for agent in AGENTS {
                if let Some(root) = agent.project_root(&project.root) {
                    candidates.push(root.join(&skill.name));
                }
            }
        }
        let mut seen = HashSet::new();
        let mut copies = Vec::new();
        let mut links = Vec::new();
        for dest in candidates {
            let parent = dest.parent().unwrap();
            let key = parent
                .canonicalize()
                .unwrap_or_else(|_| parent.to_path_buf())
                .join(dest.file_name().unwrap());
            if !seen.insert(key) || crate::fs::paths::is_same_path(&dest, &old_path) {
                continue;
            }
            match std::fs::symlink_metadata(&dest) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(Error::io(&dest, e)),
                Ok(_) => {}
            }
            if scanner::is_symlink_or_junction(&dest) {
                if linker::link_status(&old_path, &dest) == LinkStatus::Linked {
                    links.push(dest);
                }
            } else if let Some(mut sidecar) = scanner::read_copy_sidecar(&dest) {
                if crate::fs::paths::paths_alias(&sidecar.source_path, &old_path) {
                    sidecar.source_path = target.clone();
                    sidecar.skill_id = new_id.clone();
                    copies.push((dest.join(scanner::COPY_SIDECAR), sidecar));
                }
            } else if dest.join(scanner::COPY_SIDECAR).symlink_metadata().is_ok() {
                return Err(Error::invalid(format!(
                    "无法读取副本元数据: {}",
                    dest.display()
                )));
            }
        }
        let mut next = config.clone();
        migrate_skill_id(&mut next, &skill.id, &new_id);
        let mut tx =
            super::transaction::Transaction::begin(self.store.dir().join("migration.json"))?;
        let operation = (|| -> Result<()> {
            let before = scanner::dir_content_hash(&old_path)?;
            tx.reserve(&target)?;
            linker::copy_tree(&old_path, &target)?;
            if scanner::dir_content_hash(&target)? != before
                || scanner::dir_content_hash(&old_path)? != before
            {
                return Err(Error::invalid("迁移校验失败或源在迁移期间发生变化"));
            }
            scanner::validate_sync_source(&target)?;
            tx.reserve(&old_path)?;
            // Stay inside the outer journal: a nested copy transaction could undo
            // the restored source during startup recovery.
            let mode = config.settings.default_link_mode;
            let linked = if mode == LinkMode::Copy {
                false
            } else {
                match linker::create_symlink(&target, &old_path) {
                    Ok(()) => true,
                    Err(err) if mode == LinkMode::Symlink => return Err(err),
                    Err(_) => false,
                }
            };
            let done = if linked {
                linker::Registered {
                    mode: LinkMode::Symlink,
                    status: LinkStatus::Linked,
                    source_hash: None,
                }
            } else {
                linker::copy_tree(&target, &old_path)?;
                if scanner::dir_content_hash(&old_path)? != before {
                    return Err(Error::invalid("原位置副本校验失败"));
                }
                crate::fs::atomic::write_json_file(
                    &old_path.join(scanner::COPY_SIDECAR),
                    &scanner::CopySidecar {
                        skill_id: new_id.clone(),
                        source_path: target.clone(),
                        source_hash: before.clone(),
                        copied_at: linker::now_secs(),
                    },
                )?;
                linker::Registered {
                    mode: LinkMode::Copy,
                    status: LinkStatus::Copied,
                    source_hash: Some(before),
                }
            };
            if let SkillOrigin::InPlace { ref owner_agent } = skill.origin {
                next.set_registration(
                    &new_id,
                    owner_agent,
                    Registration {
                        mode: done.mode,
                        target_path: old_path.clone(),
                        registered_at: linker::now_secs(),
                        source_hash_at_copy: done.source_hash,
                    },
                );
            }
            for dest in &links {
                tx.reserve(dest)?;
                linker::create_symlink(&target, dest)?;
            }
            for (path, sidecar) in &copies {
                tx.reserve(path)?;
                crate::fs::atomic::write_json_file(path, sidecar)?;
            }
            // Configuration is part of the same undo journal as filesystem changes.
            tx.reserve(&self.store.config_path())?;
            self.store.save(&next)?;
            Ok(())
        })();
        if let Err(err) = operation {
            if let Err(recovery) = tx.rollback() {
                return Err(Error::Other(format!(
                    "{err}; 自动回滚未完成，请重启恢复: {recovery}"
                )));
            }
            return Err(err);
        }
        tx.commit()?;
        *config = next;

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
            .filter(|v| v.skill.source_path.join(scanner::SKILL_FILE).is_file())
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
