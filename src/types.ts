/**
 * 与 Rust 侧 DTO 一一对应。字段名是后端 serde 的 camelCase 输出，
 * 改这里必须同步改 crates/core/src/models 与 src-tauri/src/commands。
 */

export type LinkMode = "auto" | "symlink" | "copy";

/** 某个 skill 在某个 agent 上的状态。7 态而非布尔——原地模式下目标可能是用户自己放的。 */
export type LinkStatus =
  | "notLinked"
  /** 真身就在这个 agent 的目录里，天然可用但不能当注册移除 */
  | "source"
  | "linked"
  | "copied"
  /** 复制过但源已变更 */
  | "copyStale"
  | "copyModified"
  | "copyConflict"
  | "copyDamaged"
  /** 目标被非本工具管理的内容占用，绝不覆盖 */
  | "foreign"
  | "brokenLink"
  | "conflict";

export type SkillOrigin =
  | { kind: "inPlace"; ownerAgent: string }
  | { kind: "hub" }
  | { kind: "external" };

export interface Skill {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  sourcePath: string;
  origin: SkillOrigin;
  contentHash: string;
  /** frontmatter 里的非可移植字段：注册到 Codex 会被忽略，上传 claude.ai 会报错 */
  frontmatterExtra: string[];
  root: string;
}

export interface AgentSkillState {
  status: LinkStatus;
  /** 实际检查到的位置；未注册时是"将会写入"的位置 */
  targetPath: string;
  entryPaths?: string[];
  /** 通过 agent 原生配置停用（文件仍在） */
  disabled: boolean;
  mode: LinkMode | null;
}

/** 后端用 #[serde(flatten)] 把 Skill 摊平进来 */
export interface CatalogSkill {
  skillId: string;
  name: string;
  source: string;
  installs: number;
}

export interface SkillView extends Skill {
  installation?: {
    source: string;
    skillId: string;
    repositoryPath: string;
    installedAt: number;
    contentHash: string;
  } | null;
  agents: Record<string, AgentSkillState>;
  groupIds: string[];
  malformedFrontmatter: boolean;
  frontmatterError?: string | null;
  diagnostics?: string[];
  sourceIds?: string[];
  provenance?: {
    sourceIds: string[];
    originalPath: string;
    originalRoot: string;
    originalOrigin: SkillOrigin;
    backupPath: string;
    originalHash: string;
    collectedAt: number;
    entryPaths: string[];
  } | null;
}

export interface AgentInfo {
  id: string;
  displayName: string;
  /** 配置目录或任一 skill 根存在 */
  detected: boolean;
  cliAvailable: boolean;
  /** 找到可执行文件但 --version 失败：装了却跑不起来 */
  cliBroken: boolean;
  cliVersion: string | null;
  configDir: string;
  globalSkillDirs: string[];
  supportsProjectSkills: boolean;
  supportsNativeToggle: boolean;
}

export interface Group {
  agentId?: string | null;
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder: number;
  skillIds: string[];
}

/** 分组是一次性应用语义，不做持续对账 */
export type GroupApplyMode = "add" | "remove";

export interface ProjectBinding {
  id: string;
  name: string;
  root: string;
  agentIds: string[];
  skillIds: string[];
  groupIds: string[];
  /** 项目级默认 copy：symlink 进 git 是指向本机绝对路径的死链 */
  linkMode: LinkMode;
}

export interface Settings {
  defaultLinkMode: LinkMode;
  preserveManualSkills?: boolean;
  language: string;
  theme: string;
  agentDirOverrides: Record<string, string>;
  hubDir?: string | null;
  backupKeep: number;
}

export interface Registration {
  mode: LinkMode;
  targetPath: string;
  entryPaths?: string[];
  registeredAt: number;
  sourceHashAtCopy?: string | null;
}

export interface SkillMeta {
  note?: string | null;
  favorite: boolean;
  pinned: boolean;
}

export interface AppConfig {
  version: number;
  settings: Settings;
  groups: Group[];
  activeGroups?: Record<
    string,
    {
      groupId: string;
      preserveManualSkills?: boolean;
      skillIds: string[];
      entries: { skillId: string; sourcePath: string; targetPath: string }[];
    }
  >;
  projects: ProjectBinding[];
  registrations: Record<string, Record<string, Registration>>;
  skillMeta: Record<string, SkillMeta>;
}

export interface LinkResult {
  skillId: string;
  skillName: string;
  agentId: string;
  status: LinkStatus;
  message: string | null;
}

/** 批量操作逐条汇报，不因单条失败中断 */
export interface LinkReport {
  success: LinkResult[];
  failed: LinkResult[];
}

export interface SettingsPatch {
  defaultLinkMode?: LinkMode;
  preserveManualSkills?: boolean;
  language?: string;
  theme?: string;
  agentDirOverrides?: Record<string, string>;
  hubDir?: string;
  clearHubDir?: boolean;
  backupKeep?: number;
}

export interface LocalSkill {
  path: string;
  name: string;
  description?: string | null;
  error?: string | null;
}
