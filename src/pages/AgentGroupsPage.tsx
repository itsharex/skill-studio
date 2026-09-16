import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageTools } from "@/components/common/PageTools";
import { useState, type ReactNode } from "react";
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
import { queryKeys } from "@/lib/queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Play,
  Square,
  Pencil,
  Trash2,
  Layers,
  Download,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { groupsApi, settingsApi } from "@/lib/api";
import { useAgents, useGroups, useSkills, useSettings } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { AgentSkills } from "@/pages/AgentPage";
import type { Group } from "@/types";

export function AgentPage({ agentId }: { agentId: string }) {
  const { data: agents = [] } = useAgents();
  const { data: settings } = useSettings();
  const { data: groups = [] } = useGroups();
  const { data: skills = [] } = useSkills();
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: settingsApi.getConfig,
  });
  const client = useQueryClient();
  const [editing, setEditing] = useState<{
    id: string | null;
    name: string;
    skillIds: string[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInstalled, setShowInstalled] = useState(false);
  const current = config?.activeGroups?.[agentId];
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const own = sortedGroups.filter((g) => g.agentId === agentId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const reorder = useMutation({
    mutationFn: (next: Group[]) => groupsApi.reorder(next.map((g) => g.id)),
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: queryKeys.groups });
      const previous = client.getQueryData<Group[]>(queryKeys.groups);
      client.setQueryData(queryKeys.groups, next);
      return { previous };
    },
    onSuccess: (saved) => client.setQueryData(queryKeys.groups, saved),
    onError: (e, _, context) => {
      if (context?.previous)
        client.setQueryData(queryKeys.groups, context.previous);
      toast.error(`排序保存失败：${String(e)}`);
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.groups }),
  });
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || reorder.isPending) return;
    const from = own.findIndex((g) => g.id === active.id);
    const to = own.findIndex((g) => g.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(own, from, to);
    let index = 0;
    // Only replace this Agent's slots; other Agents and legacy groups keep their order.
    const next = sortedGroups.map((g, sortOrder) => ({
      ...(g.agentId === agentId ? moved[index++] : g),
      sortOrder,
    }));
    reorder.mutate(next);
  };
  const legacy = groups.filter((g) => !g.agentId);

  const agent = agents.find((a) => a.id === agentId);
  const refresh = () => client.invalidateQueries();
  const save = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("没有正在编辑的分组");
      return groupsApi.saveAgent(
        editing.id,
        agentId,
        editing.name,
        editing.skillIds,
      );
    },
    onSuccess: () => {
      setEditing(null);
      toast.success("组合已保存，点击启用后生效");
    },
    onError: (e) => setError(String(e)),
    onSettled: refresh,
  });
  const activate = useMutation({
    mutationFn: (id: string | null) => groupsApi.activate(agentId, id),
    onSuccess: (_, id) => toast.success(id ? "分组已启用" : "分组已停用"),
    onError: (e) => toast.error(String(e)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => groupsApi.remove(id),
    onSuccess: () => setDeleting(null),
    onError: (e) => toast.error(String(e)),
    onSettled: refresh,
  });
  const edit = (g?: Group, copy = false) => {
    setError(null);
    setSkillSearch("");
    setEditing({
      id: copy ? null : (g?.id ?? null),
      name: g?.name ?? "",
      skillIds: [...(g?.skillIds ?? [])],
    });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageTools
        query={query}
        onQueryChange={setQuery}
        placeholder={showInstalled ? "搜索已安装 skill…" : "搜索分组…"}
        createLabel="新建分组"
        onCreate={() => edit()}
      />
      <Tabs
        value={showInstalled ? "installed" : "groups"}
        onValueChange={(value) => {
          setShowInstalled(value === "installed");
          setQuery("");
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="py-3">
          <TabsList aria-label="Agent 内容">
            <TabsTrigger
              value="groups"
              className="gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-background"
            >
              分组<span className="text-xs opacity-60">{own.length}</span>
            </TabsTrigger>
            <TabsTrigger
              value="installed"
              className="gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-background"
            >
              已安装 skill
              <span className="text-xs opacity-60">
                {
                  skills.filter(
                    (s) =>
                      s.agents[agentId] &&
                      s.agents[agentId].status !== "notLinked",
                  ).length
                }
              </span>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="groups"
          className="min-h-0 flex-1 overflow-y-auto pb-6"
        >
          {own.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              还没有分组。新建一个组合，从 Skill Hub 选择需要的 skill。
            </div>
          )}
          <DndContext
            key={agentId}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={own.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              <ListContainer cards>
                {own
                  .filter((g) =>
                    `${g.name} ${g.skillIds.map((id) => skills.find((s) => s.id === id)?.name ?? "").join(" ")}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                  )
                  .map((g) => {
                    const active = current?.groupId === g.id;
                    const changed =
                      active &&
                      (JSON.stringify(current.skillIds) !==
                        JSON.stringify(g.skillIds) ||
                        (current.preserveManualSkills ?? true) !==
                          (settings?.preserveManualSkills ?? true));
                    const unavailable =
                      active &&
                      current.skillIds.some((id) => {
                        const state = skills.find((s) => s.id === id)?.agents[
                          agentId
                        ];
                        return (
                          !state ||
                          state.disabled ||
                          ![
                            "source",
                            "linked",
                            "copied",
                            "copyStale",
                            "copyModified",
                          ].includes(state.status)
                        );
                      });
                    return (
                      <SortableGroupCard
                        key={g.id}
                        group={g}
                        disabled={reorder.isPending}
                        className={
                          active
                            ? "border-emerald-500/40 bg-card bg-gradient-to-r from-emerald-500/10 to-transparent shadow-sm shadow-emerald-500/5 hover:border-emerald-500/60 hover:bg-card dark:from-emerald-500/15"
                            : undefined
                        }
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                          <Layers className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{g.name}</span>
                            <Badge variant="outline">
                              {g.skillIds.length} 个 skill
                            </Badge>
                            {active && (
                              <Badge
                                variant={unavailable ? "warning" : "success"}
                              >
                                {unavailable ? "需要检查" : "使用中"}
                              </Badge>
                            )}
                            {changed && (
                              <Badge variant="warning">有待应用修改</Badge>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {g.skillIds
                              .map(
                                (id) =>
                                  skills.find((s) => s.id === id)?.name ??
                                  `已缺失：${id}`,
                              )
                              .join(" · ") || "尚未选择 skill"}
                          </p>
                        </div>
                        <RowActions>
                          <Button
                            size="sm"
                            variant={active ? "outline" : "default"}
                            disabled={
                              activate.isPending ||
                              (!active && !g.skillIds.length)
                            }
                            onClick={() =>
                              activate.mutate(active ? null : g.id)
                            }
                          >
                            {active ? (
                              <Square className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            {active ? "停用" : "启用"}
                          </Button>
                          {active && (changed || unavailable) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={changed ? "应用修改" : "重新应用"}
                              aria-label={changed ? "应用修改" : "重新应用"}
                              disabled={
                                activate.isPending || !g.skillIds.length
                              }
                              onClick={() => activate.mutate(g.id)}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="编辑分组"
                            aria-label={`编辑 ${g.name}`}
                            onClick={() => edit(g)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={active ? "请先停用分组" : "删除分组"}
                            aria-label={`删除 ${g.name}`}
                            disabled={active || activate.isPending}
                            onClick={() => setDeleting(g)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </RowActions>
                      </SortableGroupCard>
                    );
                  })}
              </ListContainer>
            </SortableContext>
          </DndContext>
          {legacy.length > 0 && (
            <details className="mt-5 rounded-xl border p-4">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                导入旧共享分组（{legacy.length}）
              </summary>
              <p className="my-2 text-xs text-muted-foreground">
                导入为当前 Agent 的独立组合，原分组及项目引用保留。
              </p>
              {legacy.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>{g.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => edit(g, true)}
                  >
                    <Download className="h-4 w-4" />
                    导入
                  </Button>
                </div>
              ))}
            </details>
          )}
        </TabsContent>
        <TabsContent
          value="installed"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <AgentSkills agentId={agentId} searchQuery={query} />
        </TabsContent>
      </Tabs>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "编辑分组" : "新建分组"}</DialogTitle>
            <DialogDescription>
              为 {agent?.displayName ?? agentId} 选择 skill
              组合，保存后点击启用。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto px-6 py-4">
            <p className="text-sm font-medium">分组名称</p>
            <Input
              aria-label="分组名称"
              placeholder="例如：前端开发"
              value={editing?.name ?? ""}
              disabled={save.isPending}
              onChange={(e) =>
                setEditing((prev) => prev && { ...prev, name: e.target.value })
              }
            />
            <p className="text-sm font-medium">
              选择 skill{" "}
              <span className="font-normal text-muted-foreground">
                · 已选 {editing?.skillIds.length ?? 0} 个
              </span>
            </p>
            <Input
              aria-label="搜索 Hub skill"
              placeholder="搜索 Skill Hub…"
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
            />
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {skills
                .filter((s) =>
                  `${s.name} ${s.description ?? ""}`
                    .toLowerCase()
                    .includes(skillSearch.toLowerCase()),
                )
                .map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      aria-label={`选择 ${s.name}`}
                      checked={editing?.skillIds.includes(s.id) ?? false}
                      disabled={save.isPending}
                      onCheckedChange={(on) =>
                        setEditing(
                          (prev) =>
                            prev && {
                              ...prev,
                              skillIds: on
                                ? [...prev.skillIds, s.id]
                                : prev.skillIds.filter((id) => id !== s.id),
                            },
                        )
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.description}
                      </p>
                      <p
                        className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                        title={s.sourcePath}
                      >
                        {s.sourcePath}
                      </p>
                    </div>
                  </label>
                ))}
              {editing?.skillIds
                .filter((id) => !skills.some((s) => s.id === id))
                .map((id) => (
                  <label
                    key={id}
                    className="flex items-center gap-3 text-sm text-red-600"
                  >
                    <Checkbox
                      checked
                      aria-label={`移除缺失成员 ${id}`}
                      disabled={save.isPending}
                      onCheckedChange={() =>
                        setEditing(
                          (prev) =>
                            prev && {
                              ...prev,
                              skillIds: prev.skillIds.filter((x) => x !== id),
                            },
                        )
                      }
                    />
                    已缺失：{id}
                  </label>
                ))}
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
              disabled={save.isPending}
              onClick={() => setEditing(null)}
            >
              取消
            </Button>
            <Button
              disabled={save.isPending || !editing?.name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`删除分组「${deleting?.name ?? ""}」`}
        description="删除组合记录，不删除 Skill Hub 中的源文件。"
        confirmText="删除"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function SortableGroupCard({
  group,
  disabled,
  className,
  children,
}: {
  group: Group;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <ListItemRow
        card
        className={`${className ?? ""} ${isDragging ? "shadow-lg ring-1 ring-primary/30" : ""}`}
      >
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`拖拽排序 ${group.name}`}
          title="拖拽排序（也可按空格后用方向键移动）"
          disabled={disabled}
          className="touch-none shrink-0 cursor-grab rounded p-1 text-muted-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-wait"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {children}
      </ListItemRow>
    </div>
  );
}
