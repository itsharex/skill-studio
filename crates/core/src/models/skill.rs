use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// skill 真身的所在
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SkillOrigin {
    /// 真身在某个 agent 的全局目录里（默认模式，零迁移）
    #[serde(rename_all = "camelCase")]
    InPlace { owner_agent: String },
    /// 已收编到 `~/.skill-studio/skills/`
    Hub,
}

/// 链接方式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkMode {
    /// 优先 symlink，失败自动回退 copy（Windows 无开发者模式时会走到这里）
    #[default]
    Auto,
    Symlink,
    Copy,
}

/// 某个 skill 在某个 agent 上的实际状态。
/// 比 cc-switch 的"装了 / 没装"细，因为原地模式下目标可能是用户自己放的东西。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkStatus {
    /// 目标不存在
    NotLinked,
    /// symlink / junction，且指向正确
    Linked,
    /// 复制且与源一致
    Copied,
    /// 复制但源已变更（哈希不匹配）→ 提示重新复制
    CopyStale,
    /// 目标存在但非本工具管理 → **绝不覆盖**，UI 标红
    Foreign,
    /// symlink 悬空
    BrokenLink,
    /// 是链接但指向别处
    Conflict,
}

impl LinkStatus {
    /// 是否由本工具管理（决定能否安全移除）
    pub fn is_managed(self) -> bool {
        matches!(
            self,
            Self::Linked | Self::Copied | Self::CopyStale | Self::BrokenLink
        )
    }

    /// 是否算"已注册"（UI 计数用）
    pub fn is_registered(self) -> bool {
        matches!(self, Self::Linked | Self::Copied | Self::CopyStale)
    }

    /// 是否需要用户关注
    pub fn needs_attention(self) -> bool {
        matches!(
            self,
            Self::CopyStale | Self::Foreign | Self::BrokenLink | Self::Conflict
        )
    }
}

/// 一个 skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// 稳定 ID = 真身绝对路径的 SHA-256 前 16 位十六进制。
    /// 重命名目录会换 ID，因此重命名走专门流程同步更新分组 / 项目里的引用。
    pub id: String,
    /// 目录名，也是在 agent 里的调用名（`/my-skill`）
    pub name: String,
    /// frontmatter 的 `name` 字段
    pub display_name: Option<String>,
    pub description: Option<String>,
    /// 真身所在目录
    pub source_path: PathBuf,
    pub origin: SkillOrigin,
    /// 目录内容哈希，复制模式的 drift 检测用
    pub content_hash: String,
    /// frontmatter 里出现的非标准字段。
    /// Agent Skills 标准与 Codex 只要求 name + description；Claude Code 支持一批
    /// 扩展字段（context / agent / model / effort / hooks / paths / allowed-tools…），
    /// 而上传到 claude.ai 时只允许 6 个字段，多一个是硬报错。收集起来给用户提示。
    #[serde(default)]
    pub frontmatter_extra: Vec<String>,
    /// 所在的全局根（用于区分 `~/.codex/skills` 与共享的 `~/.agents/skills`）
    pub root: PathBuf,
}

/// 计算 skill 的稳定 ID
pub fn skill_id_for(path: &Path) -> String {
    let key = crate::fs::paths::comparable_path_key(path);
    let digest = Sha256::digest(key.as_bytes());
    hex16(&digest)
}

fn hex16(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
}

/// 批量操作的单条结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkResult {
    pub skill_id: String,
    pub skill_name: String,
    pub agent_id: String,
    pub status: LinkStatus,
    pub message: Option<String>,
}

/// 批量操作报告。不用 `Result<(), E>` 一失败全断 —— UI 要逐条展示。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkReport {
    pub success: Vec<LinkResult>,
    pub failed: Vec<LinkResult>,
}

impl LinkReport {
    pub fn push_ok(&mut self, r: LinkResult) {
        self.success.push(r);
    }

    pub fn push_err(&mut self, r: LinkResult) {
        self.failed.push(r);
    }

    pub fn is_all_ok(&self) -> bool {
        self.failed.is_empty()
    }

    pub fn total(&self) -> usize {
        self.success.len() + self.failed.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_id_is_stable_and_path_sensitive() {
        let a = skill_id_for(Path::new("/home/u/.claude/skills/pdf"));
        let b = skill_id_for(Path::new("/home/u/.claude/skills/pdf"));
        let c = skill_id_for(Path::new("/home/u/.claude/skills/other"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn skill_id_ignores_trailing_separator() {
        assert_eq!(
            skill_id_for(Path::new("/a/b/")),
            skill_id_for(Path::new("/a/b"))
        );
    }

    #[test]
    fn status_classification_is_consistent() {
        assert!(LinkStatus::Linked.is_managed() && LinkStatus::Linked.is_registered());
        assert!(LinkStatus::Copied.is_registered());
        assert!(LinkStatus::CopyStale.is_registered() && LinkStatus::CopyStale.needs_attention());
        // Foreign 是用户自己放的，既不算本工具管理，也不算注册
        assert!(!LinkStatus::Foreign.is_managed());
        assert!(!LinkStatus::Foreign.is_registered());
        assert!(LinkStatus::Foreign.needs_attention());
        // 悬空链接是我们建的，可以清理，但不算注册成功
        assert!(LinkStatus::BrokenLink.is_managed());
        assert!(!LinkStatus::BrokenLink.is_registered());
        assert!(!LinkStatus::NotLinked.needs_attention());
    }

    #[test]
    fn report_tracks_totals() {
        let mut report = LinkReport::default();
        assert!(report.is_all_ok());
        report.push_ok(LinkResult {
            skill_id: "a".into(),
            skill_name: "a".into(),
            agent_id: "codex".into(),
            status: LinkStatus::Linked,
            message: None,
        });
        report.push_err(LinkResult {
            skill_id: "b".into(),
            skill_name: "b".into(),
            agent_id: "codex".into(),
            status: LinkStatus::Foreign,
            message: Some("目标已被占用".into()),
        });
        assert_eq!(report.total(), 2);
        assert!(!report.is_all_ok());
    }

    #[test]
    fn link_mode_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&LinkMode::Auto).unwrap(), "\"auto\"");
        assert_eq!(
            serde_json::to_string(&LinkMode::Symlink).unwrap(),
            "\"symlink\""
        );
    }

    #[test]
    fn origin_roundtrips_with_tag() {
        let o = SkillOrigin::InPlace {
            owner_agent: "claude-code".into(),
        };
        let json = serde_json::to_string(&o).unwrap();
        assert!(json.contains("\"kind\":\"inPlace\""), "{json}");
        assert!(json.contains("ownerAgent"), "{json}");
        let back: SkillOrigin = serde_json::from_str(&json).unwrap();
        assert_eq!(back, o);
    }
}
