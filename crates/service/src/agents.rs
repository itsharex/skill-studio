use skill_studio_core::models::agent::AgentInfo;

use crate::state::AppState;

/// 列出全部 agent 及其运行时状态。
///
/// `skipCliProbe` 为 true 时跳过 `--version` 子进程探测，用于需要高频刷新的场景。
pub fn list_agents(
    state: &AppState,
    skip_cli_probe: Option<bool>,
) -> Result<Vec<AgentInfo>, String> {
    let skip = skip_cli_probe.unwrap_or(false);
    let config = state.config();
    Ok(state.studio().agents(&config, skip))
}
