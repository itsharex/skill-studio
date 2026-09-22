import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plug,
  Pencil,
  Power,
  MoreHorizontal,
  Trash2,
  Play,
  LogIn,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  NavigationGuard,
  useNavigationGuard,
} from "@/components/common/NavigationGuard";
import { PageTools } from "@/components/common/PageTools";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { EmptyState } from "@/components/common/EmptyState";
import { AgentIcon } from "@/components/common/AgentIcon";
import { useTarget } from "@/components/targets/TargetProvider";
import { McpEditor } from "@/components/mcp/McpEditor";
import { mcpRequest } from "@/lib/api/mcp";
import {
  managementApi,
  rows,
  type McpRow,
  type ManagedMcp,
  type McpInstallResult,
} from "@/lib/api/mcpManagement";

export type McpEditorState = { row: McpRow | null };
type McpPageProps = {
  editor?: McpEditorState | null;
  onEditorChange?: (editor: McpEditorState | null) => void;
};
export function mcpEditorTitle(editor: McpEditorState) {
  return editor.row?.managed
    ? "编辑 MCP"
    : editor.row
      ? "管理已有 MCP"
      : "添加 MCP";
}
export function McpPage(props: McpPageProps) {
  const target = useTarget();
  if (target.id !== "local")
    return (
      <div className="p-6 text-sm text-muted-foreground">
        MCP Hub 当前支持本机。请切换到本机管理，当前服务器的配置不会被修改。
      </div>
    );
  return (
    <NavigationGuard>
      <LocalMcpPage {...props} />
    </NavigationGuard>
  );
}
function LocalMcpPage({
  editor: controlledEditor,
  onEditorChange,
}: McpPageProps) {
  const requestNavigation = useNavigationGuard();
  const status = useQuery({
    queryKey: ["mcp", "local"],
    queryFn: managementApi.list,
    refetchInterval: 4000,
  });
  const catalog = rows(status.data);
  const running = status.data?.running ?? false;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [localEditor, setLocalEditor] = useState<McpEditorState | null>(null);
  const editor =
    controlledEditor === undefined ? localEditor : controlledEditor;
  const setEditor = onEditorChange ?? setLocalEditor;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [remove, setRemove] = useState<ManagedMcp | null>(null);
  const [restore, setRestore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [tools, setTools] = useState<
    { name: string; description?: string }[] | null
  >(null);
  const detail = catalog.find((r) => r.entry.id === detailId);
  const hasAgent = (row: McpRow, agent: string) =>
    row.entry.bindings.some((b) => b.agent === agent) ||
    row.sources.some((s) => s.agent === agent);
  const matches = (row: McpRow, f: string) =>
    f === "all" ||
    (f === "managed"
      ? row.managed
      : f === "gateway"
        ? row.managed && row.entry.mode === "gateway"
        : hasAgent(row, f));
  const filtered = catalog.filter(
    (row) =>
      matches(row, filter) &&
      `${row.entry.name} ${row.entry.definition.command ?? ""} ${row.entry.definition.url ?? ""} ${row.sources.map((s) => s.scope).join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await status.refetch();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function runtime(entry: ManagedMcp, method: string) {
    if (!running) await mcpRequest("start");
    if (method === "test") {
      setTools(await mcpRequest("test", { id: entry.id }));
    } else {
      const result = await mcpRequest<{ url: string }>("login", {
        id: entry.id,
      });
      setLoginUrl(result.url);
    }
  }
  function saved(entry: ManagedMcp, result?: McpInstallResult) {
    setEditor(null);
    setQuery("");
    setFilter("all");
    void status.refetch();
    if (result?.setupError) {
      toast.warning(`配置已保存，连接设置尚未完成：${result.setupError}`);
      setDetailId(entry.id);
    } else if (result?.loginUrl) {
      toast.success("已安装，请在浏览器完成登录");
      setLoginUrl(result.loginUrl);
    } else {
      toast.success(
        result?.installed === false
          ? "已添加到 MCP Hub"
          : entry.mode === "gateway" && !running && !result?.gatewayStarted
            ? "已保存并应用，使用前请开启网关"
            : "已保存并应用，请在 Agent 中重新加载 MCP",
      );
      if (entry.mode === "gateway" && entry.oauth) setDetailId(entry.id);
    }
  }

  if (editor)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {!onEditorChange && (
          <header className="flex items-center gap-3 py-4">
            <Button
              variant="outline"
              size="icon"
              aria-label="返回"
              onClick={() => requestNavigation(() => setEditor(null))}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-semibold">{mcpEditorTitle(editor)}</h1>
          </header>
        )}
        <McpEditor
          row={editor.row}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageTools
        query={query}
        onQueryChange={setQuery}
        placeholder="按名称或地址搜索 MCP…"
        createLabel="添加 MCP"
        onCreate={() => setEditor({ row: null })}
      />
      <div className="my-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default px-5 py-4">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="筛选 MCP"
        >
          {[
            ["all", "全部"],
            ["claude", "Claude Code"],
            ["codex", "Codex"],
            ["managed", "已管理"],
            ["gateway", "网关连接"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border border-border-default px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === key ? "bg-muted ring-1 ring-current" : "text-muted-foreground"}`}
            >
              {["claude", "codex"].includes(key) && (
                <AgentIcon
                  agentId={key === "claude" ? "claude-code" : "codex"}
                  className="h-4 w-4"
                />
              )}
              {label} {catalog.filter((r) => matches(r, key)).length}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="MCP 网关"
          aria-pressed={running}
          title={running ? "点击关闭网关" : "点击开启网关"}
          disabled={busy || status.isLoading || !!status.error}
          onClick={() =>
            void run(async () => {
              await mcpRequest(running ? "stop" : "start");
              toast.success(running ? "网关已关闭" : "网关已开启");
            })
          }
        >
          <span
            className={`h-2 w-2 rounded-full ${running ? "bg-emerald-500" : "bg-muted-foreground"}`}
          />
          {running ? "网关已开启" : "网关已关闭"}
          <Power className="h-4 w-4" />
        </Button>
      </div>
      {status.data?.gatewayOutdated && (
        <p
          role="status"
          className="mb-3 text-sm text-amber-600 dark:text-amber-400"
        >
          后台网关仍是旧版本，请关闭后重新开启，以应用新的连接配置。直连管理不受影响。
        </p>
      )}
      {status.isLoading && (
        <p className="py-6 text-sm text-muted-foreground">正在扫描 MCP 配置…</p>
      )}
      {status.error && (
        <p role="alert" className="text-destructive">
          {String(status.error)}
        </p>
      )}
      {!!status.data?.scanWarnings?.length && (
        <details className="mb-3 rounded-lg border border-amber-500/30 p-3 text-sm">
          <summary className="cursor-pointer">
            部分配置未能扫描（{status.data.scanWarnings.length}）
          </summary>
          {status.data.scanWarnings.map((warning) => (
            <p
              key={warning}
              className="mt-2 break-all text-xs text-muted-foreground"
            >
              {warning}
            </p>
          ))}
        </details>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {!status.isLoading && !status.error && !catalog.length && (
          <EmptyState
            icon={Plug}
            title="MCP Hub 还没有发现服务"
            description="已扫描 Claude Code、Codex 的全局和已登记项目配置。点击添加 MCP，粘贴安装命令、网址或配置即可安装。"
          />
        )}
        <ListContainer cards>
          {filtered.map((row) => (
            <ListItemRow
              key={row.entry.id}
              card
              onPreview={() => setDetailId(row.entry.id)}
              previewLabel={`查看 ${row.entry.name}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {row.entry.name}
                  </span>
                  <Badge variant="outline">
                    {row.managed
                      ? row.entry.mode === "direct"
                        ? "Agent 直连"
                        : "Studio 网关"
                      : "原有配置"}
                  </Badge>
                  {row.managed && (
                    <Badge
                      variant="outline"
                      className="border-blue-500/30 text-blue-500"
                    >
                      已管理
                    </Badge>
                  )}
                  {row.entry.mode === "gateway" && row.entry.oauth && (
                    <Badge variant="outline">
                      {row.authorized
                        ? "已授权"
                        : running
                          ? "待授权"
                          : "授权待检查"}
                    </Badge>
                  )}
                  {["claude", "codex"]
                    .filter((a) => hasAgent(row, a))
                    .map((agent) => (
                      <span
                        key={agent}
                        title={`${agent === "claude" ? "Claude Code" : "Codex"} 中已配置`}
                      >
                        <AgentIcon
                          agentId={agent === "claude" ? "claude-code" : "codex"}
                          className="h-4 w-4"
                        />
                      </span>
                    ))}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {String(
                    row.entry.definition.url ??
                      row.entry.definition.command ??
                      "点击查看配置来源",
                  )}
                </p>
              </div>
              <RowActions busy={busy}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={
                    busy || (row.sources.some((s) => s.gateway) && !row.managed)
                  }
                  aria-label={`${row.managed ? "编辑" : "管理"} ${row.entry.name}`}
                  title={row.managed ? "编辑配置与接入" : "管理配置与接入"}
                  onClick={() => setEditor({ row })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {row.managed && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={busy}
                        aria-label={`${row.entry.name} 的更多操作`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setDetailId(row.entry.id)}
                      >
                        <Plug className="h-4 w-4" />
                        连接详情
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        destructive
                        onSelect={() => {
                          setRemove(row.entry);
                          setRestore(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        移出 Studio
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </RowActions>
            </ListItemRow>
          ))}
        </ListContainer>
        {!!catalog.length && !filtered.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            没有匹配的 MCP
          </p>
        )}
      </div>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => !open && setDetailId(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.entry.name} · 连接详情</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-6">
              <p className="text-sm text-muted-foreground">
                {detail.entry.mode === "gateway"
                  ? "由 Studio 网关连接服务，授权由 Studio 管理。"
                  : "由 Agent 直接连接服务，登录和运行状态由各 Agent 管理。"}
              </p>
              {detail.managed && detail.entry.mode === "gateway" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(() => runtime(detail.entry, "test"))
                    }
                  >
                    <Play className="h-4 w-4" />
                    {running ? "测试连接" : "启动并测试"}
                  </Button>
                  {detail.entry.oauth && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(() => runtime(detail.entry, "login"))
                      }
                    >
                      <LogIn className="h-4 w-4" />
                      {running ? "登录授权" : "启动并授权"}
                    </Button>
                  )}
                  {detail.authorized && (
                    <Button
                      variant="ghost"
                      disabled={busy || !running}
                      onClick={() =>
                        void run(async () => {
                          await mcpRequest("logout", { id: detail.entry.id });
                          toast.success("已清除本地授权");
                        })
                      }
                    >
                      <LogOut className="h-4 w-4" />
                      清除授权
                    </Button>
                  )}
                </div>
              )}
              {!!detail.entry.bindings.length && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Studio 管理的接入</h3>
                  {detail.entry.bindings.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-lg border border-border-default p-3"
                    >
                      <p className="text-sm">
                        {b.agent === "claude" ? "Claude Code" : "Codex"} ·{" "}
                        {detail.entry.mode === "gateway" ? "网关" : "直连"}
                      </p>
                      <p className="break-all text-xs text-muted-foreground">
                        {b.path} · {b.key}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {!!detail.sources.length && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">扫描到的配置来源</h3>
                  {detail.sources.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-lg border border-border-default p-3"
                    >
                      <p className="text-sm">
                        {s.agent === "claude" ? "Claude Code" : "Codex"} ·{" "}
                        {s.scope}
                      </p>
                      <p className="break-all text-xs text-muted-foreground">
                        {s.path} · {s.key}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <Button
                disabled={
                  busy ||
                  (!detail.managed && detail.sources.some((s) => s.gateway))
                }
                onClick={() => {
                  setEditor({ row: detail });
                  setDetailId(null);
                }}
              >
                {detail.managed ? "编辑配置与接入" : "管理此 MCP"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => !open && !busy && setRemove(null)}
      >
        <DialogContent className="gap-4 p-6">
          <DialogHeader>
            <DialogTitle>移出 {remove?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            移除 Studio
            的管理记录。接入文件会先备份；若条目已被外部修改，将停止操作。
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={restore}
              onChange={(e) => setRestore(e.target.checked)}
            />
            还原管理前的原始配置
          </label>
          <p className="text-xs text-muted-foreground">
            {restore
              ? "已有服务恢复原入口；由 Studio 新建的入口会移除。"
              : "从所有受管理的 Agent 中删除此服务的接入条目。"}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await mcpRequest("removeEntry", { id: remove!.id, restore });
                  setRemove(null);
                  toast.success("已移出 Studio");
                })
              }
            >
              确认移出
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!loginUrl}
        onOpenChange={(open) => !open && setLoginUrl(null)}
      >
        <DialogContent className="gap-3 p-6">
          <DialogHeader>
            <DialogTitle>完成浏览器授权</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            请在浏览器中完成授权。浏览器未打开时，可复制此临时链接：
          </p>
          <Input aria-label="授权链接" readOnly value={loginUrl ?? ""} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={tools !== null}
        onOpenChange={(open) => !open && setTools(null)}
      >
        <DialogContent className="gap-3 p-6">
          <DialogHeader>
            <DialogTitle>连接成功 · {tools?.length ?? 0} 个工具</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-3 overflow-auto">
            {tools?.map((tool) => (
              <div key={tool.name}>
                <p className="text-sm font-medium">{tool.name}</p>
                <p className="text-xs text-muted-foreground">
                  {tool.description}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
