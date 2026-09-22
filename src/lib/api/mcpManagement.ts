import {
  mcpRequest,
  type McpServer,
  type McpSource,
  type DiscoveredMcp,
} from "./mcp";
export type Definition = Record<string, unknown>;
export interface ParsedMcp {
  name: string;
  definition: Definition;
  agent?: string;
  scope?: "user" | "project" | "local";
}
export interface McpInstallResult {
  gatewayStarted?: boolean;
  loginUrl?: string;
  setupError?: string;
  installed?: boolean;
}
export interface ManagedBinding {
  id: string;
  agent: string;
  path: string;
  project: string | null;
  key: string;
  original: Definition | null;
  installed: Definition;
}
export interface ManagedMcp {
  id: string;
  name: string;
  mode: "direct" | "gateway";
  definition: Definition;
  oauth: boolean;
  clientId: string | null;
  scopes: string[];
  bindings: ManagedBinding[];
}
export interface McpGroup {
  id: string;
  agent: string;
  name: string;
  entryIds: string[];
  sortOrder: number;
}
export interface ActiveMcpGroup {
  groupId: string;
  entries: ManagedMcp[];
  bindings: ManagedBinding[];
}
export interface ManagementStatus {
  groupIssues?: Record<string, string>;
  groups?: McpGroup[];
  activeGroups?: Record<string, ActiveMcpGroup>;
  gatewayOutdated?: boolean;
  running: boolean;
  entries: ManagedMcp[];
  servers: McpServer[];
  discovered: DiscoveredMcp[];
  scanWarnings: string[];
}
export interface McpRow {
  entry: ManagedMcp;
  managed: boolean;
  sources: McpSource[];
  authorized?: boolean;
}
export function canonical(
  definition: Definition,
  agent = "claude",
): Definition {
  const value = { ...definition };
  if (agent === "codex" && "http_headers" in value) {
    value.headers = value.http_headers;
    delete value.http_headers;
  }
  value.type ??= value.url ? "http" : "stdio";
  return value;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function rows(status?: ManagementStatus): McpRow[] {
  if (!status) return [];
  const entries = status.entries ?? [];
  const result: McpRow[] = entries.map((entry) => ({
    entry,
    managed: true,
    sources: [],
    authorized: status.servers?.find((s) => s.id === entry.id)?.authorized,
  }));
  for (const discovered of status.discovered ?? []) {
    const definition = canonical(
      discovered.sources[0]?.definition ?? {},
      discovered.sources[0]?.agent,
    );
    const match = result.find(
      (row) =>
        row.entry.id === discovered.managedId ||
        [
          ...row.entry.bindings,
          ...Object.values(status.activeGroups ?? {}).flatMap((g) =>
            g.bindings.filter((b) => b.id === row.entry.id),
          ),
        ].some((b) =>
          discovered.sources.some(
            (s) =>
              b.agent === s.agent &&
              b.path === s.path &&
              b.project === (s.project ?? null) &&
              b.key === s.key,
          ),
        ) ||
        stable(canonical(row.entry.definition)) === stable(definition),
    );
    if (match) {
      match.sources.push(...discovered.sources);
      continue;
    }
    result.push({
      managed: false,
      sources: discovered.sources,
      entry: {
        id: discovered.id,
        name: discovered.name,
        mode: "direct",
        definition,
        oauth: false,
        clientId: null,
        scopes: [],
        bindings: [],
      },
    });
  }
  return result;
}
export const managementApi = {
  list: () => mcpRequest<ManagementStatus>("list"),
  parse: (text: string) => mcpRequest<ParsedMcp[]>("parse", { text }),
};
