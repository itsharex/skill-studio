import { useSkillPreview } from "@/components/common/SkillPreview";
import { DeleteSkillButton } from "@/components/common/SkillBackups";
import { useMemo } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { STATUS_HINT, STATUS_LABEL } from "@/lib/linkReport";
import { systemApi } from "@/lib/api";
import {
  useAgents,
  useRegisterSkills,
  useSetSkillEnabled,
  useSkills,
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

export function AgentSkills({
  agentId,
  searchQuery,
  manualOnly = false,
  addOpen = false,
  onAddOpenChange = () => {},
}: {
  agentId: string;
  searchQuery?: string;
  manualOnly?: boolean;
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
}) {
  const { data: agents = [] } = useAgents();
  const { data: skills = [] } = useSkills();
  const register = useRegisterSkills();
  const { previewSkill, previewDialog } = useSkillPreview();
  const setEnabled = useSetSkillEnabled();

  const query = searchQuery ?? "";
  const agent = agents.find((a) => a.id === agentId);

  /** 这个 agent 上"有东西"的 skill：真身在此、已注册、或占用/异常都要显示 */
  const present = useMemo(
    () =>
      skills.filter((s) => {
        const st = s.agents[agentId]?.status;
        return (
          st !== undefined &&
          st !== "notLinked" &&
          (!manualOnly || s.agents[agentId]?.manual)
        );
      }),
    [skills, agentId, manualOnly],
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
      {previewDialog}
      <Dialog open={addOpen} onOpenChange={onAddOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加 skill 到 {agent.displayName}</DialogTitle>
            <DialogDescription>
              从 Skill Hub 选择尚未安装到此应用的 skill。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {notHere.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                暂无可添加的 skill，请先在 Skill Hub 中安装或导入。
              </p>
            ) : (
              notHere.map((s) => (
                <Button
                  key={s.id}
                  variant="outline"
                  className="w-full justify-start"
                  disabled={register.isPending}
                  onClick={() =>
                    register.mutate(
                      { skillIds: [s.id], agentIds: [agentId] },
                      {
                        onSuccess: (report) => {
                          if (report.failed.length === 0)
                            onAddOpenChange(false);
                        },
                      },
                    )
                  }
                >
                  {s.name}
                </Button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                ? "用右上角的「+」把已有 skill 注册进来，或先在分组里编排好再整组应用。"
                : undefined
            }
          />
        ) : (
          <ListContainer cards>
            {filtered.map((skill) => {
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
                  onPreview={() =>
                    previewSkill(skill.name, skill.agents[agentId]!.targetPath)
                  }
                  previewLabel={`预览 ${skill.name}`}
                  card
                  className={attention ? "bg-red-500/5" : undefined}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {skill.name}
                      </span>
                      {state.manual && <Badge variant="outline">未托管</Badge>}
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

                  <RowActions>
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
                                disabled={
                                  setEnabled.isPending ||
                                  (state.policyBlocked && state.disabled)
                                }
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
                            {state.policyBlocked && state.disabled
                              ? "已按保留策略停用；开启保留开关或启用包含此 skill 的分组后恢复。"
                              : `用 ${agent.displayName} 自己的配置开关启停，不删除文件。`}
                          </TooltipContent>
                        </Tooltip>
                      )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="打开所在目录"
                      aria-label={`打开 ${skill.name} 所在目录`}
                      onClick={() =>
                        void systemApi.revealPath(state.targetPath)
                      }
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    {(state.entryPaths?.length
                      ? state.entryPaths
                      : [state.targetPath]
                    ).map((path) => (
                      <DeleteSkillButton
                        key={path}
                        scope={`agent:${agentId}`}
                        path={path}
                        name={skill.name}
                      />
                    ))}
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
