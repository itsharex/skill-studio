import { useMemo, useState } from "react";
import {
  FolderOpen,
  Library,
  MoreHorizontal,
  PackagePlus,
  Trash2,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { ListToolbar } from "@/components/common/ListToolbar";
import { StatusDots } from "@/components/common/StatusDots";
import {
  useAdoptToHub,
  useAgents,
  useRegisterSkills,
  useSkills,
  useUnregisterSkills,
} from "@/hooks/useData";
import { systemApi } from "@/lib/api";
import type { SkillView } from "@/types";

export function LibraryPage() {
  const { data: skills = [], isLoading } = useSkills();
  const { data: agents = [] } = useAgents();
  const register = useRegisterSkills();
  const unregister = useUnregisterSkills();
  const adopt = useAdoptToHub();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adoptTarget, setAdoptTarget] = useState<SkillView | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.displayName ?? "").toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [skills, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  const toggleAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filtered.forEach((s) => next.delete(s.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const bulkRegister = (agentId: string) => {
    register.mutate({ skillIds: Array.from(selected), agentIds: [agentId] });
    setSelected(new Set());
  };

  if (isLoading) {
    return (
      <div className="space-y-3 py-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 rounded-xl border border-dashed border-muted-foreground/40 bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={Library}
        title="还没有发现任何 skill"
        description={`已扫描各 agent 的全局 skill 目录与 Hub，都是空的。在 ${
          agents[0]?.globalSkillDirs[0] ?? "~/.claude/skills"
        } 下建一个含 SKILL.md 的文件夹就会出现在这里。`}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar
        count={filtered.length}
        total={skills.length}
        unit="个 skill"
        query={query}
        onQueryChange={setQuery}
        placeholder="按名称或描述搜索…"
      >
        {selected.size > 0 && (
          <>
            <span className="text-sm text-muted-foreground">
              已选 {selected.size}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <PackagePlus className="h-4 w-4" />
                  注册到…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>注册到 agent</DropdownMenuLabel>
                {agents.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onClick={() => bulkRegister(a.id)}
                    disabled={!a.detected}
                  >
                    {a.displayName}
                    {!a.detected && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        未安装
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onClick={() => {
                    unregister.mutate({
                      skillIds: Array.from(selected),
                      agentIds: agents.map((a) => a.id),
                    });
                    setSelected(new Set());
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  从所有 agent 移除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </Button>
          </>
        )}
      </ListToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <ListContainer>
          <ListItemRow className="bg-muted/30 py-2">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={toggleAll}
              aria-label="全选"
            />
            <span className="text-xs font-medium text-muted-foreground">
              名称
            </span>
            <span className="ml-auto text-xs font-medium text-muted-foreground">
              各 agent 状态
            </span>
          </ListItemRow>

          {filtered.map((skill, i) => (
            <ListItemRow key={skill.id} isLast={i === filtered.length - 1}>
              <Checkbox
                checked={selected.has(skill.id)}
                onCheckedChange={() => toggle(skill.id)}
                aria-label={`选择 ${skill.name}`}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {skill.name}
                  </span>
                  {skill.origin.kind === "hub" ? (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      Hub 托管
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      原地 · {agentName(agents, skill.origin.ownerAgent)}
                    </Badge>
                  )}
                  {skill.frontmatterExtra.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-default items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                          <TriangleAlert className="h-3 w-3" />
                          跨端
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">
                          含非可移植 frontmatter 字段
                        </p>
                        <p className="pt-0.5 font-mono text-[10px]">
                          {skill.frontmatterExtra.join(", ")}
                        </p>
                        <p className="pt-1 text-muted-foreground">
                          这些字段是 Claude Code 专有的：注册到 Codex
                          后会被忽略， 上传到 claude.ai 会直接报错。
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                {skill.description && (
                  <p className="truncate pt-0.5 text-xs text-muted-foreground">
                    {skill.description}
                  </p>
                )}
              </div>

              <StatusDots skill={skill} agents={agents} />

              <RowActions>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`${skill.name} 的更多操作`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>注册到</DropdownMenuLabel>
                    {agents.map((a) => {
                      const st = skill.agents[a.id]?.status;
                      const isSource = st === "source";
                      return (
                        <DropdownMenuItem
                          key={a.id}
                          disabled={isSource || !a.detected}
                          onClick={() =>
                            register.mutate({
                              skillIds: [skill.id],
                              agentIds: [a.id],
                            })
                          }
                        >
                          {a.displayName}
                          {isSource && (
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              真身在此
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        void systemApi.revealPath(skill.sourcePath)
                      }
                    >
                      <FolderOpen className="h-4 w-4" />
                      打开所在目录
                    </DropdownMenuItem>
                    {skill.origin.kind === "inPlace" && (
                      <DropdownMenuItem onClick={() => setAdoptTarget(skill)}>
                        <Warehouse className="h-4 w-4" />
                        收编到 Hub
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </RowActions>
            </ListItemRow>
          ))}
        </ListContainer>
      </div>

      <ConfirmDialog
        open={adoptTarget !== null}
        onOpenChange={(o) => !o && setAdoptTarget(null)}
        variant="info"
        title="收编到 Hub"
        confirmText="收编"
        pending={adopt.isPending}
        description={
          <>
            会把 <span className="font-mono">{adoptTarget?.name}</span> 的真身
            移动到 Hub 目录集中托管，原位置改成指向 Hub 的链接，
            <span className="font-medium">该 agent 仍可正常使用</span>。
            这一步会移动文件。
          </>
        }
        onConfirm={() => {
          if (adoptTarget) adopt.mutate(adoptTarget.id);
          setAdoptTarget(null);
        }}
      />
    </div>
  );
}

function agentName(
  agents: { id: string; displayName: string }[],
  id: string,
): string {
  return agents.find((a) => a.id === id)?.displayName ?? id;
}
