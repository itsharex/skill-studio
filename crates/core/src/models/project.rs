use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::skill::LinkMode;

/// 项目级 skill 绑定：这些 skill 只对这个项目生效。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBinding {
    pub id: String,
    pub name: String,
    pub root: PathBuf,
    /// 要为哪些 agent 写入项目 skill 目录
    #[serde(default)]
    pub agent_ids: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    /// 也可以整组绑到项目
    #[serde(default)]
    pub group_ids: Vec<String>,
    /// 项目级**默认 Copy**：项目 skill 通常要进 git 给团队共享，
    /// 而 symlink 进 git 只是一个指向本机绝对路径的文本文件，别人拉下来就是断链。
    #[serde(default = "default_project_link_mode")]
    pub link_mode: LinkMode,
}

fn default_project_link_mode() -> LinkMode {
    LinkMode::Copy
}

impl ProjectBinding {
    pub fn new(id: String, name: String, root: PathBuf) -> Self {
        Self {
            id,
            name,
            root,
            agent_ids: Vec::new(),
            skill_ids: Vec::new(),
            group_ids: Vec::new(),
            link_mode: LinkMode::Copy,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_defaults_to_copy_mode() {
        let p = ProjectBinding::new("p1".into(), "web".into(), PathBuf::from("/tmp/web"));
        assert_eq!(p.link_mode, LinkMode::Copy);
    }

    #[test]
    fn missing_link_mode_deserializes_to_copy() {
        // 老配置里没有 linkMode 字段时，必须回落到 Copy 而不是 Auto，
        // 否则项目 skill 会变成不可提交的 symlink
        let json = r#"{"id":"p1","name":"web","root":"/tmp/web"}"#;
        let p: ProjectBinding = serde_json::from_str(json).unwrap();
        assert_eq!(p.link_mode, LinkMode::Copy);
    }
}
