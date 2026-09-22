import { SettingCard, SettingsSection } from "@/components/common/SettingCard";
import {
  ClipboardPaste,
  Settings2,
  Bot,
  LogIn,
  FolderOpen,
} from "lucide-react";
import { McpChoiceCards } from "./McpChoiceCards";
import { McpDefinitionFields, readDefinition } from "./McpDefinitionFields";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AgentIcon } from "@/components/common/AgentIcon";
import { useUnsavedProject } from "@/components/common/NavigationGuard";
import { useProjects } from "@/hooks/useData";
import { mcpRequest } from "@/lib/api/mcp";
import {
  managementApi,
  type ManagedMcp,
  type ParsedMcp,
  type McpInstallResult,
} from "@/lib/api/mcpManagement";

function emptyEntry(): ManagedMcp {
  return {
    id: crypto.randomUUID(),
    name: "",
    mode: "direct",
    definition: { type: "http", url: "" },
    oauth: false,
    clientId: null,
    scopes: [],
    bindings: [],
  };
}
export function McpQuickInstall({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (entry: ManagedMcp, result?: McpInstallResult) => void;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<ParsedMcp[]>([]);
  const [entry, setEntry] = useState<ManagedMcp | null>(() => emptyEntry());
  const [raw, setRaw] = useState('{"type":"http","url":""}');
  const { definition, error: configError } = readDefinition(raw);
  const [agents, setAgents] = useState<string[]>([]);
  const [scope, setScope] = useState<"user" | "project" | "local">("user");
  const [projectId, setProjectId] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const { data: projects = [] } = useProjects();
  useUnsavedProject(false, busy);
  function choose(item: ParsedMcp) {
    const definition = item.definition;
    setRaw(JSON.stringify(definition, null, 2));
    let login = false;
    try {
      login = new URL(String(definition.url)).searchParams.has("login");
    } catch {
      /* Local process. */
    }
    setEntry({
      id: crypto.randomUUID(),
      name: item.name,
      mode: "direct",
      definition,
      oauth: login,
      clientId: null,
      scopes: [],
      bindings: [],
    });
    setAgents(item.agent ? [item.agent] : []);
    setScope(item.scope ?? "user");
    setProjectId("");
  }
  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setItems([]);
    setError(null);
    setParsing(!!text.trim());
    if (!text.trim()) {
      setEntry(emptyEntry());
      setRaw('{"type":"http","url":""}');
      return;
    }
    const timer = setTimeout(() => {
      void managementApi
        .parse(text)
        .then((results) => {
          if (cancelled) return;
          setItems(results);
          if (results.length === 1) choose(results[0]);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        })
        .finally(() => {
          if (!cancelled) setParsing(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text]);
  const gateway = entry?.mode === "gateway";
  const local = definition.type === "stdio";
  const effective = entry
    ? { ...entry, definition, oauth: !!gateway && !local && entry.oauth }
    : null;
  const check = useQuery({
    queryKey: ["mcp-check", effective],
    queryFn: () =>
      mcpRequest<{ issue: string | null }>("gatewayCheck", {
        entry: effective,
      }),
    enabled: !!gateway && !!effective,
    retry: false,
  });
  const invalidScope =
    agents.length > 0 &&
    scope !== "user" &&
    (!projectId || (scope === "local" && agents.includes("codex")));
  const invalid =
    !entry ||
    !entry.name.trim() ||
    !!configError ||
    !String(
      local ? (definition.command ?? "") : (definition.url ?? ""),
    ).trim() ||
    parsing ||
    invalidScope ||
    (gateway && (check.isPending || !!check.data?.issue || !!check.error));
  const installing = agents.length > 0;
  const label = !installing
    ? "添加到 Hub"
    : gateway
      ? effective?.oauth
        ? "安装并登录"
        : "安装并开启代理"
      : "安装";
  async function install() {
    if (!effective || invalid || busy) return;
    setBusy(true);
    setError(null);
    setPhase("正在保存配置…");
    let saved = false;
    const result: McpInstallResult = { installed: installing };
    try {
      await mcpRequest("saveEntry", {
        entry: effective,
        expectedEntry: null,
        bindingIds: [],
        sources: [],
        agents,
        scope: installing ? scope : "user",
        projectId: installing && scope !== "user" ? projectId : "",
      });
      saved = true;
      if (gateway && installing) {
        setPhase("正在开启代理…");
        await mcpRequest("start");
        result.gatewayStarted = true;
        if (effective.oauth) {
          setPhase("正在打开登录页面…");
          result.loginUrl = (
            await mcpRequest<{ url: string }>("login", { id: effective.id })
          ).url;
        } else {
          setPhase("正在检查连接…");
          await mcpRequest("test", { id: effective.id });
        }
      }
      onSaved(effective, result);
    } catch (e) {
      // Once saved, return to the existing entry so retries cannot duplicate it.
      if (saved) onSaved(effective, { ...result, setupError: String(e) });
      else setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void install();
      }}
    >
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <fieldset disabled={busy} className="min-w-0 space-y-3 py-3">
          <SettingsSection title="快速填写" icon={<ClipboardPaste />}>
            <SettingCard
              compact
              icon={<ClipboardPaste />}
              title={
                <Label htmlFor="mcp-install-input">
                  粘贴安装命令、网址或配置
                </Label>
              }
              description="支持 Codex／Claude 安装命令、HTTP 网址、JSON 和 TOML，粘贴后自动填入下方。"
              details={
                <div className="space-y-3">
                  <textarea
                    id="mcp-install-input"
                    className="min-h-20 w-full rounded-lg border border-border-default bg-background p-3 font-mono text-sm outline-none focus:border-border-active focus:ring-2 focus:ring-blue-500/20"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                      'codex mcp add hf-mcp-server --url "https://huggingface.co/mcp?login"'
                    }
                  />
                  {parsing && (
                    <p role="status" className="text-sm text-muted-foreground">
                      正在识别…
                    </p>
                  )}
                  {items.length > 1 && (
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label="选择要安装的 MCP"
                    >
                      {items.map((item, i) => (
                        <Button
                          type="button"
                          variant="outline"
                          key={i}
                          onClick={() => choose(item)}
                        >
                          {item.name || `服务 ${i + 1}`}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              }
            />
          </SettingsSection>
          {entry && (
            <>
              <SettingsSection title="服务配置" icon={<Settings2 />}>
                <SettingCard
                  compact
                  icon={<Settings2 />}
                  title={<Label htmlFor="mcp-install-name">名称</Label>}
                  description="用于在 Hub 和 Agent 中识别此 MCP。"
                >
                  <Input
                    className="w-52 sm:w-72"
                    id="mcp-install-name"
                    required
                    value={entry.name}
                    onChange={(e) =>
                      setEntry({ ...entry, name: e.target.value })
                    }
                  />
                </SettingCard>
              </SettingsSection>
              <McpDefinitionFields raw={raw} setRaw={setRaw} />
              <SettingsSection title="安装到" icon={<Bot />}>
                <div className="flex flex-wrap gap-2 rounded-xl border border-border-default bg-card p-2">
                  {["claude", "codex"].map((agent) => (
                    <label
                      key={agent}
                      className="relative cursor-pointer rounded-lg focus-within:ring-2 focus-within:ring-blue-500/40"
                    >
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        aria-label={
                          agent === "claude" ? "Claude Code" : "Codex"
                        }
                        checked={agents.includes(agent)}
                        onChange={() =>
                          setAgents(
                            agents.includes(agent)
                              ? agents.filter((a) => a !== agent)
                              : [...agents, agent],
                          )
                        }
                      />
                      <span
                        className={buttonVariants({
                          variant: agents.includes(agent) ? "default" : "ghost",
                          className:
                            "peer-disabled:pointer-events-none peer-disabled:opacity-50",
                        })}
                      >
                        <AgentIcon
                          agentId={agent === "claude" ? "claude-code" : agent}
                          className="h-4 w-4"
                        />
                        {agent === "claude" ? "Claude Code" : "Codex"}
                      </span>
                    </label>
                  ))}
                </div>
                {!installing && (
                  <p className="text-xs text-muted-foreground">
                    未选择 Agent：仅添加到 Hub，之后可在 MCP 分组中使用。
                  </p>
                )}
              </SettingsSection>
              <div className="space-y-3">
                <McpChoiceCards
                  label="连接方式"
                  value={entry.mode}
                  onChange={(mode) => setEntry({ ...entry, mode })}
                  options={[
                    {
                      value: "direct",
                      title: "Agent 直连",
                      description: "由各 Agent 连接和登录，适合大多数情况。",
                    },
                    {
                      value: "gateway",
                      title: "Studio 代理",
                      description:
                        "由 Studio 连接服务，可让多个 Agent 共用登录。",
                    },
                  ]}
                />
                {gateway && !local && (
                  <label className="block cursor-pointer">
                    <SettingCard
                      compact
                      icon={<LogIn />}
                      title="此服务需要网页登录"
                      description="安装时打开浏览器，完成服务授权。"
                    >
                      <input
                        type="checkbox"
                        aria-label="此服务需要网页登录"
                        checked={entry.oauth}
                        onChange={(e) =>
                          setEntry({
                            ...entry,
                            definition,
                            oauth: e.target.checked,
                          })
                        }
                      />
                    </SettingCard>
                  </label>
                )}
                {gateway && !local && entry.oauth && (
                  <details className="space-y-3">
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      授权设置（可选）
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
                {gateway && installing && (
                  <p className="text-xs text-muted-foreground">
                    {effective?.oauth
                      ? "点击安装后会开启代理并打开登录页面，完成登录后各 Agent 共用授权。"
                      : "点击安装后会开启代理并检查连接。"}
                  </p>
                )}
                {gateway && (check.data?.issue || check.error) && (
                  <p role="alert" className="text-sm text-amber-600">
                    {check.data?.issue || String(check.error)}。可改用 Agent
                    直连或修改上方配置。
                  </p>
                )}
                {entry.mode === "direct" && installing && (
                  <p className="text-xs text-muted-foreground">
                    安装后在 Agent 中重新加载 MCP；需要登录时由 Agent 引导完成。
                  </p>
                )}
              </div>
              <div className="space-y-3">
                <McpChoiceCards
                  label="安装位置"
                  value={scope}
                  onChange={setScope}
                  options={[
                    {
                      value: "user",
                      title: "用户全局",
                      description: "当前用户的所有项目都可使用。",
                    },
                    {
                      value: "project",
                      title: "项目配置",
                      description: "写入项目目录，可随项目分享。",
                    },
                    {
                      value: "local",
                      title: "项目本地",
                      description: "仅自己在指定项目使用，限 Claude Code。",
                    },
                  ]}
                />
                <div className="space-y-3">
                  {scope !== "user" && (
                    <SettingCard
                      compact
                      title="安装项目"
                      description="选择此 MCP 生效的项目。"
                      icon={<FolderOpen />}
                      details={
                        <div className="space-y-3">
                          <select
                            aria-label="安装项目"
                            className="w-full rounded-md border border-border-default bg-background p-2 text-sm"
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                          >
                            <option value="">请选择项目</option>
                            {projects.map((p) => (
                              <option value={p.id} key={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-muted-foreground">
                            {scope === "local"
                              ? "与 Claude 命令的 local 作用域一致，记录在用户配置中，不写入项目文件。"
                              : "写入项目的 MCP 配置，使用时可能需要 Agent 确认信任。"}
                          </p>
                          {scope === "local" && agents.includes("codex") && (
                            <p role="alert" className="text-sm text-amber-600">
                              Codex 不支持项目本地作用域，请改选全局或项目配置。
                            </p>
                          )}
                        </div>
                      }
                    />
                  )}
                </div>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </fieldset>
      </div>
      <footer className="-mx-6 flex shrink-0 items-center justify-end gap-2 border-t border-border-default bg-background px-6 py-4">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </Button>
        <Button type="submit" disabled={busy || !!invalid}>
          {busy ? phase : label}
        </Button>
      </footer>
    </form>
  );
}
