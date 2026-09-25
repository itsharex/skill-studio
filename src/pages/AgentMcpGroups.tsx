import {
  SummaryBar,
  SummaryStart,
  SummaryEnd,
  summaryPillClass,
  summaryTabClass,
} from "@/components/common/SummaryBar";
import { mcpAgentName } from "@/lib/mcpAgents";
import { McpAgentNote } from "@/components/mcp/McpAgentNote";
import { McpAssignments } from "@/components/mcp/McpAssignments";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Layers,
  Play,
  Square,
  RefreshCw,
  Pencil,
  Trash2,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PageTools } from "@/components/common/PageTools";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { useTarget } from "@/components/targets/TargetProvider";
import { useUnsavedProject } from "@/components/common/NavigationGuard";
import {
  managementApi,
  MCP_STATUS_STALE_TIME,
  MCP_STATUS_POLL_INTERVAL,
  rows,
  type McpGroup,
  type ManagedMcp,
} from "@/lib/api/mcpManagement";
import { mcpRequest } from "@/lib/api/mcp";

export function AgentMcpGroups({ agentId }: { agentId: string }) {
  const target = useTarget();
  if (target.id !== "local")
    return (
      <p className="p-6 text-sm text-muted-foreground">
        MCP 分组当前仅支持本机。
      </p>
    );
  const agent = agentId === "claude-code" ? "claude" : agentId;
  return <LocalGroups key={agent} agent={agent} />;
}
function snapshot(entry: ManagedMcp) {
  return JSON.stringify([
    entry.id,
    entry.name,
    entry.mode,
    entry.definition,
    entry.oauth,
    entry.clientId,
    entry.scopes,
  ]);
}
function LocalGroups({ agent }: { agent: string }) {
  const status = useQuery({
    queryKey: ["mcp", "local"],
    queryFn: managementApi.list,
    // Keep polling in the background without fetching again on every Agent switch.
    staleTime: MCP_STATUS_STALE_TIME,
    refetchInterval: MCP_STATUS_POLL_INTERVAL,
  });
  const catalog = rows(status.data);
  const groups = (status.data?.groups ?? [])
    .filter((g) => g.agent === agent)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const active = status.data?.activeGroups?.[agent];
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("groups");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<McpGroup | null>(null);
  const [deleting, setDeleting] = useState<McpGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedProject(false, busy);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  async function run(
    method: string,
    params: Record<string, unknown>,
    message: string,
    done?: () => void,
  ) {
    setBusy(true);
    setError(null);
    try {
      await mcpRequest(method, { ...params, agent });
      await status.refetch();
      done?.();
      toast.success(message);
    } catch (e) {
      setError(String(e));
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(group?: McpGroup) {
    setSearch("");
    setError(null);
    setEditing(
      group
        ? { ...group, entryIds: [...group.entryIds] }
        : {
            id: crypto.randomUUID(),
            agent,
            name: "",
            entryIds: [],
            sortOrder: groups.length,
          },
    );
  }
  function reorder({ active: dragged, over }: DragEndEvent) {
    if (!over || busy || dragged.id === over.id) return;
    const from = groups.findIndex((g) => g.id === dragged.id),
      to = groups.findIndex((g) => g.id === over.id);
    if (from < 0 || to < 0) return;
    void run(
      "reorderGroups",
      { ids: arrayMove(groups, from, to).map((g) => g.id) },
      "分组顺序已保存",
    );
  }
  const configured = catalog.filter((r) =>
    r.sources.some((s) => s.agent === agent && s.scope === "用户全局"),
  );
  const installed = configured.filter((r) =>
    r.sources.some(
      (s) => s.agent === agent && s.scope === "用户全局" && s.enabled,
    ),
  );
  const manual = configured.filter(
    (r) =>
      !r.managed &&
      !r.sources.some((s) =>
        Object.values(status.data?.activeGroups ?? {}).some((g) =>
          g.bindings.some(
            (b) => b.path === s.path && b.key === s.key && b.agent === s.agent,
          ),
        ),
      ),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageTools
        query={query}
        onQueryChange={setQuery}
        placeholder={tab === "groups" ? "搜索 MCP 分组…" : "搜索已配置 MCP…"}
        createLabel={tab === "groups" ? "新建 MCP 分组" : "添加 MCP"}
        onCreate={() => !busy && (tab === "groups" ? edit() : setAdding(true))}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          setQuery("");
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <SummaryBar>
          <SummaryStart>
            <TabsList className="h-9 shrink-0" aria-label="MCP 内容">
              <TabsTrigger
                value="groups"
                className={`${summaryTabClass} gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-background`}
              >
                分组 <span className="text-xs opacity-60">{groups.length}</span>
              </TabsTrigger>
              <TabsTrigger
                value="installed"
                className={`${summaryTabClass} gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-background`}
              >
                已配置 MCP{" "}
                <span className="text-xs opacity-60">{configured.length}</span>
              </TabsTrigger>
              <TabsTrigger
                value="manual"
                className={`${summaryTabClass} gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-background`}
              >
                未托管 MCP{" "}
                <span className="text-xs opacity-60">{manual.length}</span>
              </TabsTrigger>
            </TabsList>
          </SummaryStart>
          <SummaryEnd>
            <Badge variant="outline" className={summaryPillClass}>
              已启用 {groups.some((g) => g.id === active?.groupId) ? 1 : 0}{" "}
              个分组
            </Badge>
            <Badge variant="outline" className={summaryPillClass}>
              已启用 {installed.length} 个 MCP
            </Badge>
            <McpAgentNote agent={agent} compact />
          </SummaryEnd>
        </SummaryBar>
        <TabsContent
          value="groups"
          className="min-h-0 flex-1 overflow-y-auto pb-6"
        >
          {status.error && (
            <p role="alert" className="mb-3 text-sm text-red-600">
              {String(status.error)}
            </p>
          )}
          {status.data?.groupIssues?.[agent] && (
            <p role="alert" className="mb-3 text-sm text-amber-600">
              {status.data.groupIssues[agent]}
            </p>
          )}
          <div>
            {status.isPending ? (
              <p className="p-8 text-sm text-muted-foreground">正在扫描 MCP…</p>
            ) : (
              !groups.length && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  还没有分组。新建一个组合，从 MCP Hub 选择需要的 MCP。
                </p>
              )
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={reorder}
            >
              <SortableContext
                items={groups.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                <ListContainer cards>
                  {groups
                    .filter((g) =>
                      `${g.name} ${g.entryIds.map((id) => catalog.find((r) => r.entry.id === id)?.entry.name ?? "").join(" ")}`
                        .toLowerCase()
                        .includes(query.trim().toLowerCase()),
                    )
                    .map((group) => {
                      const isActive = active?.groupId === group.id;
                      const missing = group.entryIds.some(
                        (id) => !catalog.some((r) => r.entry.id === id),
                      );
                      const changed =
                        isActive &&
                        (JSON.stringify(active.entries.map((e) => e.id)) !==
                          JSON.stringify(group.entryIds) ||
                          active.entries.some((e) => {
                            const current = catalog.find(
                              (r) => r.entry.id === e.id,
                            )?.entry;
                            return (
                              !current || snapshot(current) !== snapshot(e)
                            );
                          }));
                      return (
                        <GroupCard
                          key={group.id}
                          group={group}
                          disabled={busy}
                          active={isActive}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                            <Layers className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{group.name}</span>
                              <Badge variant="outline">
                                {group.entryIds.length} 个 MCP
                              </Badge>
                              {isActive && (
                                <Badge
                                  variant={
                                    status.data?.groupIssues?.[agent]
                                      ? "warning"
                                      : "success"
                                  }
                                >
                                  {status.data?.groupIssues?.[agent]
                                    ? "需要检查"
                                    : "使用中"}
                                </Badge>
                              )}
                              {changed && (
                                <Badge variant="warning">有待应用修改</Badge>
                              )}
                              {missing && (
                                <Badge variant="warning">成员已缺失</Badge>
                              )}
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {group.entryIds
                                .map(
                                  (id) =>
                                    catalog.find((r) => r.entry.id === id)
                                      ?.entry.name ?? `已缺失：${id}`,
                                )
                                .join(" · ") || "尚未选择 MCP"}
                            </p>
                          </div>
                          <RowActions busy={busy}>
                            <Button
                              size="sm"
                              variant={isActive ? "outline" : "default"}
                              disabled={
                                busy ||
                                (!isActive &&
                                  (missing || !group.entryIds.length))
                              }
                              onClick={() =>
                                void run(
                                  "activateGroup",
                                  { id: isActive ? null : group.id },
                                  isActive
                                    ? "分组已停用，请在 Agent 中重新加载 MCP"
                                    : "分组已启用，请在 Agent 中重新加载 MCP",
                                )
                              }
                            >
                              {isActive ? (
                                <Square className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                              {isActive ? "停用" : "启用"}
                            </Button>
                            {isActive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={changed ? "应用修改" : "重新应用"}
                                title={changed ? "应用修改" : "重新应用"}
                                disabled={
                                  busy || missing || !group.entryIds.length
                                }
                                onClick={() =>
                                  void run(
                                    "activateGroup",
                                    { id: group.id },
                                    "分组已重新应用，请在 Agent 中重新加载 MCP",
                                  )
                                }
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`编辑 ${group.name}`}
                              disabled={busy}
                              onClick={() => edit(group)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`删除 ${group.name}`}
                              title={isActive ? "请先停用分组" : "删除分组"}
                              disabled={busy || isActive}
                              onClick={() => setDeleting(group)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </RowActions>
                        </GroupCard>
                      );
                    })}
                </ListContainer>
              </SortableContext>
            </DndContext>
          </div>
        </TabsContent>
        {["installed", "manual"].map((value) => (
          <TabsContent
            key={value}
            value={value}
            className="min-h-0 flex-1 overflow-y-auto pb-6"
          >
            <McpAssignments
              agent={agent}
              searchQuery={query}
              manualOnly={value === "manual"}
              addOpen={adding}
              onAddOpenChange={setAdding}
            />
          </TabsContent>
        ))}
      </Tabs>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && !busy && setEditing(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {groups.some((g) => g.id === editing?.id)
                ? "编辑 MCP 分组"
                : "新建 MCP 分组"}
            </DialogTitle>
            <DialogDescription>
              为 {mcpAgentName(agent)} 选择 MCP
              组合，保存后点击启用。保存只记录成员，不会托管或修改已有配置。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto px-6 py-4">
            <p className="text-sm font-medium">分组名称</p>
            <Input
              aria-label="MCP 分组名称"
              placeholder="例如：日常开发"
              disabled={busy}
              value={editing?.name ?? ""}
              onChange={(e) =>
                setEditing((v) => v && { ...v, name: e.target.value })
              }
            />
            <p className="text-sm font-medium">
              选择 MCP · 已选 {editing?.entryIds.length ?? 0} 个
            </p>
            <Input
              aria-label="搜索 Hub MCP"
              placeholder="搜索 MCP Hub…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {catalog
                .filter((r) =>
                  `${r.entry.name} ${r.entry.definition.command ?? ""} ${r.entry.definition.url ?? ""}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((row) => (
                  <label
                    key={row.entry.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-default p-3"
                  >
                    <Checkbox
                      aria-label={`选择 ${row.entry.name}`}
                      disabled={
                        busy ||
                        (!row.managed && row.sources.some((s) => s.gateway))
                      }
                      checked={
                        editing?.entryIds.includes(row.entry.id) ?? false
                      }
                      onCheckedChange={(checked) =>
                        setEditing(
                          (v) =>
                            v && {
                              ...v,
                              entryIds: checked
                                ? [...v.entryIds, row.entry.id]
                                : v.entryIds.filter(
                                    (id) => id !== row.entry.id,
                                  ),
                            },
                        )
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{row.entry.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {String(
                          row.entry.definition.command ??
                            row.entry.definition.url ??
                            "",
                        )}{" "}
                        · {row.entry.mode === "gateway" ? "网关" : "直连"}
                      </p>
                    </div>
                  </label>
                ))}
              {editing?.entryIds
                .filter((id) => !catalog.some((r) => r.entry.id === id))
                .map((id) => (
                  <label key={id} className="flex gap-3 text-sm text-red-600">
                    <Checkbox
                      checked
                      disabled={busy}
                      aria-label={`移除缺失成员 ${id}`}
                      onCheckedChange={() =>
                        setEditing(
                          (v) =>
                            v && {
                              ...v,
                              entryIds: v.entryIds.filter((x) => x !== id),
                            },
                        )
                      }
                    />
                    已缺失：{id}
                  </label>
                ))}
              {!catalog.length && (
                <p className="py-4 text-sm text-muted-foreground">
                  MCP Hub 暂无服务，请先添加 MCP。
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              取消
            </Button>
            <Button
              disabled={
                busy ||
                status.isPending ||
                !!status.error ||
                !editing?.name.trim()
              }
              onClick={() =>
                editing &&
                void run(
                  "saveGroup",
                  {
                    group: editing,
                    imports: catalog
                      .filter(
                        (r) =>
                          !r.managed && editing.entryIds.includes(r.entry.id),
                      )
                      .map((r) => ({
                        id: r.entry.id,
                        definition: r.entry.definition,
                        sourceIds: r.sources.map((source) => source.id),
                      })),
                  },
                  "组合已保存，点击启用后生效",
                  () => setEditing(null),
                )
              }
            >
              {busy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`删除分组「${deleting?.name ?? ""}」`}
        description="只删除组合记录，不删除 MCP Hub 中的服务。"
        confirmText="删除"
        pending={busy}
        onConfirm={() =>
          deleting &&
          void run("removeGroup", { id: deleting.id }, "分组已删除", () =>
            setDeleting(null),
          )
        }
      />
    </div>
  );
}
function GroupCard({
  group,
  disabled,
  active,
  children,
}: {
  group: McpGroup;
  disabled: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: group.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <ListItemRow
        card
        className={
          active
            ? "border-emerald-500/40 bg-card bg-gradient-to-r from-emerald-500/10 to-transparent"
            : undefined
        }
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`拖动排序 ${group.name}`}
          className="touch-none text-muted-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {children}
      </ListItemRow>
    </div>
  );
}
