import { McpDefinitionFields, readDefinition } from "./McpDefinitionFields";
import { McpQuickInstall } from "./McpQuickInstall";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUnsavedProject } from "@/components/common/NavigationGuard";
import { AgentIcon } from "@/components/common/AgentIcon";
import { useProjects } from "@/hooks/useData";
import { mcpRequest } from "@/lib/api/mcp";
import {
  type ManagedMcp,
  type McpRow,
  type McpInstallResult,
} from "@/lib/api/mcpManagement";

type EditorProps = {
  row: McpRow | null;
  onClose: () => void;
  onSaved: (entry: ManagedMcp, result?: McpInstallResult) => void;
};
export function McpEditor(props: EditorProps) {
  return props.row ? (
    <McpExistingEditor {...props} />
  ) : (
    <McpQuickInstall onClose={props.onClose} onSaved={props.onSaved} />
  );
}
function McpExistingEditor({ row, onClose, onSaved }: EditorProps) {
  const existing = row?.managed;
  const [entry, setEntry] = useState<ManagedMcp>(() =>
    row
      ? { ...row.entry, id: existing ? row.entry.id : crypto.randomUUID() }
      : {
          id: crypto.randomUUID(),
          name: "",
          mode: "direct",
          definition: { type: "http", url: "" },
          oauth: false,
          clientId: null,
          scopes: [],
          bindings: [],
        },
  );
  const [raw, setRaw] = useState(() =>
    JSON.stringify(entry.definition, null, 2),
  );
  const [busy, setBusy] = useState(false);
  useUnsavedProject(false, busy);
  const [agents, setAgents] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [bindings, setBindings] = useState(() =>
    entry.bindings.map((b) => b.id),
  );
  const [sources, setSources] = useState(() =>
    existing
      ? []
      : (row?.sources.filter((s) => !s.gateway).map((s) => s.id) ?? []),
  );
  const { data: projects = [] } = useProjects();
  const { definition, error } = readDefinition(raw);
  const effective = {
    ...entry,
    definition,
    oauth:
      entry.mode === "gateway" && definition.type !== "stdio" && entry.oauth,
  };
  const gatewayCheck = useQuery({
    queryKey: ["mcp-check", effective],
    queryFn: () =>
      mcpRequest<{ issue: string | null }>("gatewayCheck", {
        entry: effective,
      }),
    enabled: entry.mode === "gateway" && !error,
    retry: false,
  });
  function toggle(
    value: string,
    values: string[],
    set: (value: string[]) => void,
  ) {
    set(
      values.includes(value)
        ? values.filter((x) => x !== value)
        : [...values, value],
    );
  }
  const local = definition.type === "stdio";
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || error) return;
        setBusy(true);
        void mcpRequest("saveEntry", {
          entry: effective,
          expectedEntry: existing ? row?.entry : null,
          bindingIds: bindings,
          sources:
            row?.sources
              .filter((s) => sources.includes(s.id))
              .map((s) => ({ id: s.id, definition: s.definition })) ?? [],
          agents,
          projectId,
          scope: projectId ? "project" : "user",
        })
          .then(() => onSaved(effective))
          .catch((e) => toast.error(String(e)))
          .finally(() => setBusy(false));
      }}
    >
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <fieldset disabled={busy} className="min-w-0 space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="mcp-name">名称</Label>
            <Input
              id="mcp-name"
              required
              value={entry.name}
              onChange={(e) => setEntry({ ...entry, name: e.target.value })}
            />
          </div>
          <McpDefinitionFields raw={raw} setRaw={setRaw} />
          <div className="space-y-2">
            <Label htmlFor="mcp-mode">连接方式</Label>
            <select
              id="mcp-mode"
              className="w-full rounded-md border border-border-default bg-background p-2"
              value={entry.mode}
              onChange={(e) =>
                setEntry({
                  ...entry,
                  mode: e.target.value as ManagedMcp["mode"],
                })
              }
            >
              <option value="direct">Agent 直连</option>
              <option value="gateway">Studio 网关</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {entry.mode === "direct"
                ? "Agent 直接连接服务并管理登录，网关关闭时也可使用。"
                : "由 Studio 统一连接和授权。保存配置不会启动网关，使用前请开启网关。"}
            </p>
          </div>
          {entry.mode === "gateway" && (
            <>
              {!local && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.oauth}
                    onChange={(e) =>
                      setEntry({ ...entry, oauth: e.target.checked })
                    }
                  />
                  使用浏览器 OAuth 授权
                </label>
              )}
              {entry.oauth && !local && (
                <details>
                  <summary className="cursor-pointer text-sm">
                    高级授权设置
                  </summary>
                  <Input
                    aria-label="OAuth Client ID"
                    placeholder="Client ID（可选）"
                    value={entry.clientId ?? ""}
                    onChange={(e) =>
                      setEntry({
                        ...entry,
                        clientId: e.target.value || null,
                      })
                    }
                  />
                  <Input
                    aria-label="OAuth scopes"
                    placeholder="Scopes（空格分隔）"
                    value={entry.scopes.join(" ")}
                    onChange={(e) =>
                      setEntry({
                        ...entry,
                        scopes: e.target.value.split(/\s+/).filter(Boolean),
                      })
                    }
                  />
                </details>
              )}
              {(gatewayCheck.data?.issue || gatewayCheck.error) && (
                <p
                  role="alert"
                  className="text-sm text-amber-600 dark:text-amber-400"
                >
                  {gatewayCheck.data?.issue || String(gatewayCheck.error)}
                  。仍可选择 Agent 直连。
                </p>
              )}
            </>
          )}
          {!!row?.sources.filter((s) => !s.gateway).length && !existing && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">管理已有接入</legend>
              {row.sources
                .filter((s) => !s.gateway)
                .map((s) => (
                  <label key={s.id} className="flex items-start gap-2 text-sm">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={sources.includes(s.id)}
                      onChange={() => toggle(s.id, sources, setSources)}
                    />
                    <span>
                      {s.agent === "claude" ? "Claude Code" : "Codex"} ·{" "}
                      {s.scope}
                      <span className="block break-all text-xs text-muted-foreground">
                        {s.path} · {s.key}
                      </span>
                    </span>
                  </label>
                ))}
              <p className="text-xs text-muted-foreground">
                切换到网关时替换所选原入口，并保留备份，不另建重复入口。
              </p>
            </fieldset>
          )}
          {!!entry.bindings.length && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">现有接入</legend>
              {entry.bindings.map((b) => (
                <label key={b.id} className="flex items-start gap-2 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={bindings.includes(b.id)}
                    onChange={() => toggle(b.id, bindings, setBindings)}
                  />
                  <span>
                    {b.agent === "claude" ? "Claude Code" : "Codex"}
                    <span className="block break-all text-xs text-muted-foreground">
                      {b.path} · {b.key}
                    </span>
                  </span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                取消勾选会从该 Agent 移除条目。
              </p>
            </fieldset>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              {existing || row ? "增加接入" : "用于哪些 Agent"}
            </legend>
            <div className="flex gap-5">
              {["claude", "codex"].map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={agents.includes(a)}
                    onChange={() => toggle(a, agents, setAgents)}
                  />
                  <AgentIcon
                    agentId={a === "claude" ? "claude-code" : "codex"}
                    className="h-4 w-4"
                  />
                  {a === "claude" ? "Claude Code" : "Codex"}
                </label>
              ))}
            </div>
            <Label htmlFor="mcp-scope">作用域</Label>
            <select
              id="mcp-scope"
              className="w-full rounded-md border border-border-default bg-background p-2"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">用户全局</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            保存前自动备份。完成后在 Agent 中重新加载 MCP；项目配置需要由 Agent
            信任。
          </p>
        </fieldset>
      </div>
      <footer className="-mx-6 flex shrink-0 justify-end gap-2 border-t border-border-default bg-background px-6 py-4">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </Button>

        <Button
          type="submit"
          disabled={
            busy ||
            !!error ||
            (entry.mode === "gateway" &&
              (gatewayCheck.isPending ||
                !!gatewayCheck.data?.issue ||
                !!gatewayCheck.error))
          }
        >
          {busy ? "正在保存…" : "保存并应用"}
        </Button>
      </footer>
    </form>
  );
}
