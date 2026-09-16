import { vi } from "vitest";
import type {
  AgentInfo,
  Group,
  LinkReport,
  LinkStatus,
  ProjectBinding,
  Settings,
  SkillView,
} from "@/types";

/**
 * 可配置的 invoke mock。
 *
 * 每个用例往 `handlers` 里塞自己关心的命令，其余走默认值 —— 这样加一个新命令
 * 不会让所有旧用例一起挂。命令调用记录留在 `calls` 里供断言。
 */
export const calls: { command: string; args: unknown }[] = [];
export const handlers = new Map<string, (args: any) => unknown>();

export function resetTauriMock() {
  calls.length = 0;
  handlers.clear();
}

export const invoke = vi.fn(async (command: string, args: unknown) => {
  calls.push({ command, args });
  const handler = handlers.get(command);
  if (handler) return handler(args as any);
  return defaultResult(command);
});

function defaultResult(command: string): unknown {
  switch (command) {
    case "list_agents":
      return [];
    case "scan_skills":
    case "list_groups":
    case "list_projects":
    case "list_backups":
      return [];
    case "get_settings":
      return defaultSettings();
    case "get_app_version":
      return "0.1.0";
    case "get_init_error":
      return null;
    case "get_config_dir":
      return "/tmp/.skill-studio";
    case "register_skills":
    case "unregister_skills":
    case "apply_group":
    case "apply_project":
      return emptyReport();
    default:
      return undefined;
  }
}

/* ─────────── 构造测试数据的小工具 ─────────── */

export function makeAgent(over: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    detected: true,
    cliAvailable: true,
    cliBroken: false,
    cliVersion: "1.0.0",
    configDir: "/home/u/.claude",
    globalSkillDirs: ["/home/u/.claude/skills"],
    supportsProjectSkills: true,
    supportsNativeToggle: true,
    ...over,
  };
}

export const claudeAgent = makeAgent();
export const codexAgent = makeAgent({
  id: "codex",
  displayName: "Codex",
  configDir: "/home/u/.codex",
  globalSkillDirs: ["/home/u/.codex/skills", "/home/u/.agents/skills"],
});

export function makeSkill(over: Partial<SkillView> = {}): SkillView {
  return {
    id: "s1",
    name: "pdf-tools",
    displayName: "pdf-tools",
    description: "处理 PDF",
    sourcePath: "/home/u/.claude/skills/pdf-tools",
    origin: { kind: "inPlace", ownerAgent: "claude-code" },
    contentHash: "abc",
    frontmatterExtra: [],
    root: "/home/u/.claude/skills",
    agents: {
      "claude-code": agentState("source"),
      codex: agentState("notLinked"),
    },
    groupIds: [],
    malformedFrontmatter: false,
    tokens: { skillMd: 100, extras: 0 },
    ...over,
  };
}

export function agentState(status: LinkStatus, disabled = false) {
  return {
    status,
    targetPath: `/target/${status}`,
    disabled,
    mode: null,
  };
}

export function makeGroup(over: Partial<Group> = {}): Group {
  return {
    id: "g1",
    name: "前端",
    description: null,
    icon: null,
    sortOrder: 0,
    skillIds: [],
    ...over,
  };
}

export function makeProject(
  over: Partial<ProjectBinding> = {},
): ProjectBinding {
  return {
    id: "p1",
    name: "webapp",
    root: "/work/webapp",
    agentIds: [],
    skillIds: [],
    groupIds: [],
    linkMode: "copy",
    ...over,
  };
}

export function defaultSettings(): Settings {
  return {
    defaultLinkMode: "auto",
    language: "zh",
    theme: "system",
    agentDirOverrides: {},
    hubDir: null,
    backupKeep: 10,
  };
}

export function emptyReport(): LinkReport {
  return { success: [], failed: [] };
}
