import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { AgentPage } from "@/pages/AgentGroupsPage";
import { renderWithProviders } from "./utils/render";
import { handlers, calls, claudeAgent, codexAgent } from "./mocks/tauri";
import { setTarget } from "@/lib/api/transport";
import type { ManagementStatus } from "@/lib/api/mcpManagement";
import { rows } from "@/lib/api/mcpManagement";

let status: ManagementStatus;
const entry = {
  id: "one",
  name: "Work",
  mode: "direct" as const,
  definition: { type: "stdio", command: "work" },
  oauth: false,
  clientId: null,
  scopes: [],
  bindings: [],
};
const group = {
  id: "g1",
  agent: "claude",
  name: "开发",
  entryIds: ["one"],
  sortOrder: 0,
};
const methods = () =>
  calls
    .filter((c) => c.command === "mcp_request")
    .map((c) => (c.args as { method: string }).method);
beforeEach(() => {
  setTarget({ id: "local", name: "本机", connected: true });
  status = {
    running: false,
    entries: [entry],
    servers: [],
    discovered: [],
    scanWarnings: [],
    groups: [group],
    activeGroups: {},
  };
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("get_config", () => ({ activeGroups: {} }));
  handlers.set("mcp_request", ({ method, params }) => {
    if (method === "list") return status;
    if (method === "saveGroup")
      status = {
        ...status,
        groups: [
          ...(status.groups ?? []).filter((g) => g.id !== params.group.id),
          params.group,
        ],
      };
    if (method === "activateGroup")
      status = {
        ...status,
        activeGroups: params.id
          ? { claude: { groupId: params.id, entries: [entry], bindings: [] } }
          : {},
      };
    return null;
  });
});
async function open() {
  const user = userEvent.setup();
  renderWithProviders(<AgentPage agentId="claude-code" />);
  await user.click(screen.getByRole("tab", { name: "MCP 分组" }));
  await screen.findByRole("button", { name: "编辑 开发" });
  return user;
}
it("keeps MCP groups agent-local and switches them without changing Skill groups or starting the gateway", async () => {
  status.groups!.push({
    ...group,
    id: "other",
    agent: "codex",
    name: "Codex only",
  });
  const user = await open();
  expect(screen.queryByText("Codex only")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "启用" }));
  await screen.findByText("使用中");
  expect(screen.getByRole("button", { name: "删除 开发" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "停用" }));
  await waitFor(() =>
    expect(screen.queryByText("使用中")).not.toBeInTheDocument(),
  );
  expect(methods()).not.toContain("start");
  expect(calls.some((c) => c.command === "activate_agent_group")).toBe(false);
  expect(
    calls
      .filter(
        (c) =>
          c.command === "mcp_request" &&
          (c.args as any).method === "activateGroup",
      )
      .map((c) => (c.args as any).params),
  ).toEqual([
    { agent: "claude", id: "g1" },
    { agent: "claude", id: null },
  ]);
});
it("saves membership without applying it and exposes pending changes on the active group", async () => {
  status.activeGroups = {
    claude: { groupId: "g1", entries: [entry], bindings: [] },
  };
  const user = await open();
  await user.click(screen.getByRole("button", { name: "编辑 开发" }));
  await user.click(screen.getByRole("checkbox", { name: "选择 Work" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("有待应用修改");
  expect(methods()).toContain("saveGroup");
  expect(methods()).not.toContain("activateGroup");
  expect(screen.getByRole("button", { name: "应用修改" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "停用" })).toBeEnabled();
});
it("can select automatically discovered MCPs from the Hub when creating a group", async () => {
  status.discovered = [
    {
      id: "scanned",
      name: "Scan",
      sources: [
        {
          id: "s1",
          agent: "codex",
          path: "/test/config.toml",
          scope: "用户全局",
          key: "Scan",
          enabled: true,
          gateway: false,
          project: null,
          definition: { command: "scan" },
        },
      ],
      server: null,
      issue: null,
      managedId: null,
    },
  ];
  const user = await open();
  await user.click(screen.getByRole("button", { name: "新建 MCP 分组" }));
  fireEvent.change(screen.getByRole("textbox", { name: "MCP 分组名称" }), {
    target: { value: "浏览器" },
  });
  await user.click(screen.getByRole("checkbox", { name: "选择 Scan" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(methods()).toContain("saveGroup"));
  expect(
    calls.find(
      (c) =>
        c.command === "mcp_request" && (c.args as any).method === "saveGroup",
    )?.args,
  ).toMatchObject({
    params: {
      agent: "claude",
      group: { name: "浏览器", entryIds: ["scanned"] },
      imports: [
        { id: "scanned", definition: { type: "stdio", command: "scan" } },
      ],
    },
  });
  expect(methods()).not.toContain("activateGroup");
});
it("does not duplicate Hub entries when group activation changes the native enabled field", () => {
  const binding = {
    id: entry.id,
    agent: "codex",
    path: "/test/config.toml",
    project: null,
    key: "Work",
    original: null,
    installed: { command: "work", enabled: true },
  };
  status.activeGroups = {
    codex: { groupId: "g1", entries: [entry], bindings: [binding] },
  };
  status.discovered = [
    {
      id: "changed",
      name: "Work",
      sources: [
        {
          ...binding,
          id: "source",
          scope: "用户全局",
          enabled: true,
          gateway: false,
          definition: binding.installed,
        },
      ],
      server: null,
      issue: null,
      managedId: null,
    },
  ];
  expect(rows(status)).toHaveLength(1);
  expect(rows(status)[0].sources).toHaveLength(1);
});
