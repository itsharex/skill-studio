import { HelpPopover } from "@/components/common/HelpPopover";
import { mcpAgentName } from "@/lib/mcpAgents";

function NoteText({ agent }: { agent: string }) {
  return agent === "pi" ? (
    <>
      Pi 通过 pi-mcp-adapter 扩展使用 MCP。请先在终端运行{" "}
      <code className="select-text break-words">
        pi install npm:pi-mcp-adapter
      </code>
      ，再重启 Pi。Studio 管理 Pi 专属配置，不会自动安装扩展或改动其他 Agent
      的共享配置。
    </>
  ) : (
    <>
      适用于 OpenCode v2；修改后请在 OpenCode 中重新加载 MCP。旧版配置需先迁移到
      v2。
    </>
  );
}

export function McpAgentNote({
  agent,
  compact = false,
}: {
  agent: string;
  compact?: boolean;
}) {
  if (agent !== "pi" && agent !== "opencode") return null;
  if (!compact)
    return (
      <p className="rounded-xl border border-border-default bg-muted/40 p-3 text-xs text-muted-foreground">
        <NoteText agent={agent} />
      </p>
    );
  return (
    <HelpPopover label={`${mcpAgentName(agent)} MCP 使用说明`}>
      <NoteText agent={agent} />
    </HelpPopover>
  );
}
