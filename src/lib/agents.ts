import type { AgentInfo } from "@/types";

// Older remote helpers predate projectSkillDir and only support these two Agents.
const LEGACY_PROJECT_DIRS: Record<string, string> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
};

export function projectSkillDirectory(agent: AgentInfo): string | null {
  if (!agent.supportsProjectSkills) return null;
  return agent.projectSkillDir ?? LEGACY_PROJECT_DIRS[agent.id] ?? null;
}

const AGENT_SOURCE_COLORS: Record<string, string> = {
  "claude-code": "bg-orange-500/10 text-orange-600 dark:text-orange-300",
  codex: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  opencode: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  pi: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  grok: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

export function agentSourceColor(id: string): string {
  return AGENT_SOURCE_COLORS[id] ?? "bg-muted text-muted-foreground";
}
