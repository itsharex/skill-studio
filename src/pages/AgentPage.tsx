import { useMemo, useState } from "react";
import {
  FolderOpen,
  Minus,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { agentIcon } from "@/components/common/AgentIcon";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { ListToolbar } from "@/components/common/ListToolbar";
import { STATUS_HINT, STATUS_LABEL } from "@/lib/linkReport";
import { systemApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  useAgents,
  useApplyGroup,
  useGroups,
  useRegisterSkills,
  useSetSkillEnabled,
  useSkills,
  useUnregisterSkills,
} from "@/hooks/useData";
import type { LinkStatus, SkillView } from "@/types";

/** 状态徽标的配色：能用=默认灰、需处理=amber、冲突=红、真身=emerald */
function statusBadgeVariant(
  status: LinkStatus,
): "outline" | "success" | "warning" | "destructive" {
  switch (status) {
    case "source":
      return "success";
    case "copyModified":
    case "copyStale":
      return "warning";
    case "copyConflict":
    case "copyDamaged":
    case "foreign":
    case "brokenLink":
    case "conflict":
      return "destructive";
    default:
      return "outline";
  }
}

export function AgentPage({ agentId }: { agentId: string }) {
  const { data: agents = [] } = useAgents();
  const { data: skills = [] } = useSkills();
  const { data: groups = [] } = useGroups();
  const applyGroup = useApplyGroup();
  const register = useRegisterSkills();
  const unregister = useUnregisterSkills();
  const setEnabled = useSetSkillEnabled();

  const [query, setQuery] = useState("");
  const agent = agents.find((a) => a.id === agentId);

  /** 这个 agent 上"有东西"的 skill：真身在此、已注册、或占用/异常都要显示 */
  const present = useMemo(
    () =>
      skills.filter((s) => {
        const st = s.agents[agentId]?.status;
        return st !== undefined && st !== "notLinked";
      }),
    [skills, agentId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return present;
    return present.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [present, query]);

  const notHere = useMemo(
    () => skills.filter((s) => s.agents[agentId]?.status === "notLinked"),
    [skills, agentId],
  );

  if (!agent) {
    return (
      <EmptyState
        icon={agentIcon(agentId)}
        title="未知 agent"
        description={agentId}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* agent 概况 */}
      <div className="flex flex-wrap items-center gap-2 pt-4">
        {agent.detected ? (
          <Badge variant="success">已安装</Badge>
        ) : (
          <Badge variant="outline">未检测到</Badge>
        )}
        {agent.cliVersion && (
          <Badge variant="outline" className="font-mono">
            {agent.cliVersion}
          </Badge>
        )}
        {agent.cliBroken && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="warning" className="cursor-default gap-1">
                <TriangleAlert className="h-3 w-3" />
                CLI 无法运行
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              找到了可执行文件，但 <code>--version</code> 执行失败。 常见原因是
              Node 版本不达标。
            </TooltipContent>
          </Tooltip>
        )}
        <button
          type="button"
          onClick={() => void systemApi.revealPath(agent.globalSkillDirs[0])}
          className="inline-flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="打开目录"
        >
          <FolderOpen className="h-3 w-3 shrink-0" />
          {agent.globalSkillDirs[0]}
        </button>
        {agent.globalSkillDirs.length > 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-default">
                +{agent.globalSkillDirs.length - 1} 个根目录
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">该 agent 有多个全局 skill 根</p>
              {agent.globalSkillDirs.map((d) => (
                <p key={d} className="break-all font-mono text-[10px]">
                  {d}
                </p>
              ))}
              <p className="pt-1 text-muted-foreground">
                第一个是注册写入目标，其余也会被扫描
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* 分组 pill 条 —— 一次性 Add / Remove */}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            分组
          </span>
          {groups.map((g) => {
            const total = g.skillIds.length;
            const registered = g.skillIds.filter((id) => {
              const st = skills.find((s) => s.id === id)?.agents[agentId]
                ?.status;
              return st !== undefined && st !== "notLinked";
            }).length;
            const full = total > 0 && registered === total;
            return (
              <DropdownMenu key={g.id}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                      full
                        ? "border-blue-500/60 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "border-border-default text-muted-foreground hover:border-border-hover hover:text-foreground",
                    )}
                  >
                    {g.name}
                    <span className="tabular-nums opacity-70">
                      {registered}/{total}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>{g.name}</DropdownMenuLabel>
                  <DropdownMenuItem
                    disabled={total === 0}
                    onClick={() =>
                      applyGroup.mutate({
                        groupId: g.id,
                        agentIds: [agentId],
                        mode: "add",
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    应用到本 agent
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    disabled={registered === 0}
                    onClick={() =>
                      applyGroup.mutate({
                        groupId: g.id,
                        agentIds: [agentId],
                        mode: "remove",
                      })
                    }
                  >
                    <Minus className="h-4 w-4" />
                    从本 agent 移除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-[11px] text-muted-foreground">
                一次性应用
              </span>
            </TooltipTrigger>
            <TooltipContent>
              点击是一次性操作：只加/只减组内 skill， 该 agent 上其他 skill
              一律不动，不会误删你手动添加的。
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      <ListToolbar
        count={filtered.length}
        total={present.length}
        unit="个 skill"
        query={query}
        onQueryChange={setQuery}
        placeholder="搜索本 agent 的 skill…"
      >
        {notHere.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                添加（{notHere.length}）
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-80 overflow-y-auto"
            >
              <DropdownMenuLabel>尚未注册到此</DropdownMenuLabel>
              {notHere.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() =>
                    register.mutate({ skillIds: [s.id], agentIds: [agentId] })
                  }
                >
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ListToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {filtered.length === 0 ? (
          <EmptyState
            icon={agentIcon(agentId)}
            title={
              present.length === 0
                ? `${agent.displayName} 还没有任何 skill`
                : "没有匹配的 skill"
            }
            description={
              present.length === 0
                ? "用右上角的「添加」把已有 skill 注册进来，或先在分组里编排好再整组应用。"
                : undefined
            }
          />
        ) : (
          <ListContainer>
            {filtered.map((skill, i) => {
              const state = skill.agents[agentId]!;
              const attention =
                state.status === "copyModified" ||
                state.status === "copyConflict" ||
                state.status === "copyDamaged" ||
                state.status === "foreign" ||
                state.status === "brokenLink" ||
                state.status === "conflict";
              return (
                <ListItemRow
                  key={skill.id}
                  isLast={i === filtered.length - 1}
                  className={attention ? "bg-red-500/5" : undefined}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {skill.name}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant={statusBadgeVariant(state.status)}
                            className="h-4 cursor-default px-1.5 text-[10px]"
                          >
                            {STATUS_LABEL[state.status]}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{STATUS_HINT[state.status]}</p>
                          <p className="pt-1 break-all font-mono text-[10px] text-muted-foreground">
                            {state.targetPath}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                      {skill.malformedFrontmatter && (
                        <span
                          className="text-xs text-red-600"
                          title={skill.frontmatterError ?? undefined}
                        >
                          YAML 格式错误
                        </span>
                      )}
                      {skill.diagnostics?.map((message) => (
                        <span key={message} className="text-xs text-red-600">
                          {message}
                        </span>
                      ))}
                      {state.disabled && (
                        <Badge
                          variant="outline"
                          className="h-4 px-1.5 text-[10px]"
                        >
                          已停用
                        </Badge>
                      )}
                    </div>
                    {skill.description && (
                      <p className="truncate pt-0.5 text-xs text-muted-foreground">
                        {skill.description}
                      </p>
                    )}
                  </div>

                  {state.status === "copyStale" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        register.mutate({
                          skillIds: [skill.id],
                          agentIds: [agentId],
                          mode: "copy",
                        })
                      }
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      重新复制
                    </Button>
                  )}

                  {/* 原生启停：只在该 agent 支持、且 skill 确实可用时才给开关 */}
                  {agent.supportsNativeToggle &&
                    state.status !== "copyDamaged" &&
                    state.status !== "foreign" &&
                    state.status !== "conflict" &&
                    state.status !== "brokenLink" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <Switch
                              checked={!state.disabled}
                              onCheckedChange={(next) =>
                                setEnabled.mutate({
                                  skillId: skill.id,
                                  agentId,
                                  enabled: next,
                                })
                              }
                              aria-label={`启用 ${skill.name}`}
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          用 {agent.displayName} 自己的配置开关启停，
                          不删文件、随时可恢复
                        </TooltipContent>
                      </Tooltip>
                    )}

                  <RowActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="打开所在目录"
                      onClick={() =>
                        void systemApi.revealPath(state.targetPath)
                      }
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    {state.status !== "source" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-red-500"
                        title="从本 agent 移除"
                        onClick={() =>
                          unregister.mutate({
                            skillIds: [skill.id],
                            agentIds: [agentId],
                          })
                        }
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    )}
                  </RowActions>
                </ListItemRow>
              );
            })}
          </ListContainer>
        )}
      </div>
    </div>
  );
}

export type { SkillView };
