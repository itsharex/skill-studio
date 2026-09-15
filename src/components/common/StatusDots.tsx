import { STATUS_DOT_CLASS, STATUS_HINT, STATUS_LABEL } from "@/lib/linkReport";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AgentInfo, SkillView } from "@/types";

/**
 * 每个 agent 一个状态点。颜色一眼区分 7 种状态，hover 出实际路径。
 * 停用状态额外画一个空心环——文件在但被 agent 原生配置关掉了。
 */
export function StatusDots({
  skill,
  agents,
}: {
  skill: SkillView;
  agents: AgentInfo[];
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {agents.map((agent) => {
        const state = skill.agents[agent.id];
        if (!state) return null;
        return (
          <Tooltip key={agent.id}>
            <TooltipTrigger asChild>
              <div className="flex cursor-default items-center gap-1">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    STATUS_DOT_CLASS[state.status],
                    state.disabled && "ring-2 ring-muted-foreground/40",
                  )}
                />
                <span className="text-[11px] text-muted-foreground">
                  {agent.displayName}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">
                {agent.displayName} · {STATUS_LABEL[state.status]}
                {state.disabled && " · 已停用"}
              </p>
              <p className="pt-0.5 text-muted-foreground">
                {STATUS_HINT[state.status]}
              </p>
              {state.disabled && (
                <p className="pt-0.5 text-muted-foreground">
                  文件仍在，但已通过 {agent.displayName} 的配置停用
                </p>
              )}
              <p className="pt-1 break-all font-mono text-[10px] text-muted-foreground">
                {state.targetPath}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
