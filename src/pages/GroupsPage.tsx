import { useQueuedDraft } from "@/hooks/useQueuedDraft";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  GripVertical,
  Layers,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AgentIcon } from "@/components/common/AgentIcon";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { ListToolbar } from "@/components/common/ListToolbar";
import {
  useAgents,
  useApplyGroup,
  useCreateGroup,
  useDeleteGroup,
  useGroups,
  useSetGroupSkills,
  useSkills,
  useUpdateGroup,
} from "@/hooks/useData";
import type { Group } from "@/types";

export function GroupsPage() {
  const { data: groups = [] } = useGroups();
  const { data: skills = [] } = useSkills();
  const { data: agents = [] } = useAgents();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const applyGroup = useApplyGroup();

  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });

  const active = groups.find((g) => g.id === editing) ?? null;
  if (active) {
    return (
      <GroupMemberEditor
        key={active.id}
        group={active}
        onBack={() => setEditing(null)}
      />
    );
  }

  const openCreate = () => {
    setForm({ name: "", description: "" });
    setCreating(true);
  };

  const openRename = (g: Group) => {
    setForm({ name: g.name, description: g.description ?? "" });
    setRenaming(g);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar
        count={groups.length}
        total={groups.length}
        unit="个分组"
        query=""
        onQueryChange={() => {}}
      >
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          新建分组
        </Button>
      </ListToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {groups.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="还没有分组"
            description="把常用的 skill 编排成分组，就能在各 agent 页面一键整组应用或移除。分组是一次性操作，不会影响组外的 skill。"
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新建分组
              </Button>
            }
          />
        ) : (
          <ListContainer>
            {groups.map((g, i) => (
              <ListItemRow
                key={g.id}
                isLast={i === groups.length - 1}
                onClick={() => setEditing(g.id)}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {g.name}
                    </span>
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      {g.skillIds.length} 个
                    </Badge>
                  </div>
                  {g.description && (
                    <p className="truncate pt-0.5 text-xs text-muted-foreground">
                      {g.description}
                    </p>
                  )}
                </div>

                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={g.skillIds.length === 0}
                      >
                        应用到…
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>整组应用</DropdownMenuLabel>
                      {agents.map((a) => (
                        <DropdownMenuItem
                          key={a.id}
                          onClick={() =>
                            applyGroup.mutate({
                              groupId: g.id,
                              agentIds: [a.id],
                              mode: "add",
                            })
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <AgentIcon agentId={a.id} className="h-4 w-4" />
                          {a.displayName}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuLabel>整组移除</DropdownMenuLabel>
                      {agents.map((a) => (
                        <DropdownMenuItem
                          key={`rm-${a.id}`}
                          destructive
                          onClick={() =>
                            applyGroup.mutate({
                              groupId: g.id,
                              agentIds: [a.id],
                              mode: "remove",
                            })
                          }
                        >
                          <Minus className="h-3.5 w-3.5" />
                          <AgentIcon agentId={a.id} className="h-4 w-4" />
                          {a.displayName}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div onClick={(e) => e.stopPropagation()}>
                  <RowActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="重命名"
                      onClick={() => openRename(g)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-red-500"
                      title="删除分组"
                      onClick={() => setDeleting(g)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </RowActions>
                </div>
              </ListItemRow>
            ))}
          </ListContainer>
        )}
      </div>

      {/* 新建 / 重命名 */}
      <Dialog
        open={creating || renaming !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setRenaming(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{renaming ? "编辑分组" : "新建分组"}</DialogTitle>
            <DialogDescription>
              分组只是一份 skill 名单，应用时才会真正建立注册。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">名称</Label>
              <Input
                id="group-name"
                value={form.name}
                autoFocus
                placeholder="例如：前端、写作、代码审查"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-desc">说明（可选）</Label>
              <Textarea
                id="group-desc"
                value={form.description}
                placeholder="这个分组用来做什么"
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreating(false);
                setRenaming(null);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={form.name.trim().length === 0}
              onClick={() => {
                if (renaming) {
                  updateGroup.mutate({
                    groupId: renaming.id,
                    name: form.name,
                    description: form.description,
                  });
                } else {
                  createGroup.mutate({
                    name: form.name,
                    description: form.description || undefined,
                  });
                }
                setCreating(false);
                setRenaming(null);
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除分组「${deleting?.name}」`}
        confirmText="删除"
        pending={deleteGroup.isPending}
        description={
          <>
            只删掉这份名单，
            <span className="font-medium">
              已经注册到各 agent 的 skill 不会被移除
            </span>
            。如果想撤销注册，请先用「应用到…」里的移除。
          </>
        }
        onConfirm={() => {
          if (deleting) deleteGroup.mutate(deleting.id);
          setDeleting(null);
        }}
      />
      {skills.length === 0 && groups.length > 0 && (
        <p className="pb-4 text-xs text-muted-foreground">
          当前没有扫描到任何 skill，分组成员将为空。
        </p>
      )}
    </div>
  );
}

/** 分组成员编辑：左侧是组内（可拖拽排序），右侧是候选 */
function GroupMemberEditor({
  group,
  onBack,
}: {
  group: Group;
  onBack: () => void;
}) {
  const { data: skills = [] } = useSkills();
  const setGroupSkills = useSetGroupSkills();
  const [query, setQuery] = useState("");
  const draft = useQueuedDraft(group.skillIds, (skillIds) =>
    setGroupSkills.mutateAsync({ groupId: group.id, skillIds }),
  );

  const members = useMemo(
    () =>
      draft.value
        .map((id) => skills.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => s !== undefined),
    [draft.value, skills],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills
      .filter((s) => !draft.value.includes(s.id))
      .filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [skills, draft.value, query]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    draft.edit((previous) => {
      const oldIndex = previous.indexOf(String(active.id));
      const newIndex = previous.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return previous;
      const next = [...previous];
      next.splice(newIndex, 0, next.splice(oldIndex, 1)[0]);
      return next;
    });
  };

  const add = (id: string) =>
    draft.edit((previous) =>
      previous.includes(id) ? previous : [...previous, id],
    );
  const remove = (id: string) =>
    draft.edit((previous) => previous.filter((x) => x !== id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 py-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() =>
            void draft
              .flush()
              .then(onBack)
              .catch(() => {})
          }
          title="返回"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{group.name}</p>
          <p className="text-xs text-muted-foreground">
            {members.length} 个成员 · 拖拽可调整顺序
          </p>
        </div>
      </div>

      <div role="status" className="text-xs text-muted-foreground">
        {draft.pending
          ? "正在保存成员…"
          : draft.error
            ? `保存失败，成员已保留：${draft.error}`
            : "成员会自动保存"}
        {draft.error && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void draft.flush().catch(() => {})}
          >
            重试保存
          </Button>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden pb-6 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col">
          <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            组内成员
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {members.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-default p-8 text-center text-sm text-muted-foreground">
                还没有成员，从右侧添加
              </div>
            ) : (
              <ListContainer>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={draft.value}
                    strategy={verticalListSortingStrategy}
                  >
                    {members.map((s, i) => (
                      <SortableMember
                        key={s.id}
                        id={s.id}
                        name={s.name}
                        description={s.description}
                        isLast={i === members.length - 1}
                        onRemove={() => remove(s.id)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </ListContainer>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            可添加
          </p>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 skill…"
            className="mb-2"
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-default p-8 text-center text-sm text-muted-foreground">
                没有可添加的 skill
              </div>
            ) : (
              <ListContainer>
                {candidates.map((s, i) => (
                  <ListItemRow
                    key={s.id}
                    isLast={i === candidates.length - 1}
                    onClick={() => add(s.id)}
                  >
                    <Checkbox checked={false} aria-label={`添加 ${s.name}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      {s.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {s.description}
                        </p>
                      )}
                    </div>
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </ListItemRow>
                ))}
              </ListContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SortableMember({
  id,
  name,
  description,
  isLast,
  onRemove,
}: {
  id: string;
  name: string;
  description: string | null;
  isLast: boolean;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <ListItemRow isLast={isLast}>
        <button
          type="button"
          className="-ml-1 cursor-grab p-1 text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="拖拽排序"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          {description && (
            <p className="truncate text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:text-red-500"
          title="移出分组"
          onClick={onRemove}
        >
          <Minus className="h-4 w-4" />
        </Button>
      </ListItemRow>
    </div>
  );
}
