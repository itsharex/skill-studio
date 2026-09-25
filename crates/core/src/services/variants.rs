//! Agent-specific payloads share a Hub identity, never a deployment source.
use super::scanner;
use crate::error::{Error, Result};
use crate::models::{
    agent::AGENTS,
    config::{AppConfig, SkillVariant},
    skill::Skill,
};
use std::path::{Path, PathBuf};

pub const DIRECTORY: &str = ".skill-studio-variants";
pub const GENERIC: &str = "generic";

/// One whitelist shared by candidate discovery and variant classification.
/// Agent paths come from the supported registry, never an unsupported-Agent blacklist.
pub fn repository_roots() -> std::collections::BTreeMap<&'static str, &'static str> {
    let mut roots =
        std::collections::BTreeMap::from([("skills", GENERIC), (".agents/skills", GENERIC)]);
    for agent in AGENTS {
        if let Some(path) = agent.project_skill_dir.filter(|p| *p != ".agents/skills") {
            roots.insert(path, agent.id);
        }
        for root in agent.global_roots.iter().filter(|r| !r.shared) {
            roots.insert(root.home_relative, agent.id);
        }
    }
    roots
}

pub fn repository_key(path: &str) -> Option<String> {
    if path.is_empty() {
        return Some(GENERIC.into());
    }
    let (parent, _) = path.rsplit_once('/')?;
    repository_roots().get(parent).map(|key| (*key).into())
}

pub fn payload(root: &Path, key: &str) -> Result<PathBuf> {
    if key != GENERIC && !AGENTS.iter().any(|a| a.id == key) {
        return Err(Error::invalid("无效的 Skill 变体标识"));
    }
    let path = root.join(DIRECTORY).join(key);
    // Metadata never authorizes paths outside the managed bundle.
    if !crate::fs::paths::path_is_within(root, &path)
        || scanner::is_symlink_or_junction(&root.join(DIRECTORY))
        || scanner::is_symlink_or_junction(&path)
    {
        return Err(Error::invalid("Skill 变体目录越界或被替换为链接"));
    }
    Ok(path)
}

pub fn entries<'a>(config: &'a AppConfig, skill: &Skill) -> &'a [SkillVariant] {
    config
        .skill_installations
        .get(&skill.id)
        .map(|i| i.variants.as_slice())
        .unwrap_or(&[])
}

/// Resolve identity without reading source contents. Used for existing deployments,
/// including broken sources; this never authorizes copying from that path.
pub fn deployment_source(config: &AppConfig, skill: &Skill, agent: &str) -> Result<Skill> {
    let variants = entries(config, skill);
    if variants.is_empty() {
        return Ok(skill.clone());
    }
    let selected = variants
        .iter()
        .find(|v| v.key == agent)
        .or_else(|| variants.iter().find(|v| v.key == GENERIC))
        .ok_or_else(|| {
            Error::invalid(format!(
                "{} 没有适用于 {} 的专用版或通用版",
                skill.name, agent
            ))
        })?;
    if selected.key != GENERIC && !AGENTS.iter().any(|a| a.id == selected.key) {
        return Err(Error::invalid("无效的 Skill 变体标识"));
    }
    let mut resolved = skill.clone();
    resolved.source_path = skill.source_path.join(DIRECTORY).join(&selected.key);
    Ok(resolved)
}

pub fn for_agent(config: &AppConfig, skill: &Skill, agent: &str) -> Result<Skill> {
    let mut resolved = deployment_source(config, skill, agent)?;
    let source = resolved.source_path.clone();
    if !entries(config, skill).is_empty() {
        payload(
            &skill.source_path,
            source.file_name().unwrap().to_str().unwrap(),
        )?;
    }
    scanner::validate_sync_source(&source)?;
    let fm = scanner::parse_frontmatter(&source.join(scanner::SKILL_FILE));
    if fm.malformed {
        return Err(Error::invalid(format!(
            "Skill 的 YAML 格式无效：{}",
            source.display()
        )));
    }
    // Single-source views already carry their scanned hash and metadata.
    if entries(config, skill).is_empty() {
        return Ok(resolved);
    }
    resolved.content_hash = scanner::dir_content_hash(&source)?;
    resolved.source_path = source;
    resolved.description = fm.description;
    resolved.frontmatter_extra = fm.extra_keys;
    resolved.tokens = super::tokens::estimate_skill(&resolved.source_path);
    Ok(resolved)
}
