import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentPage } from "@/pages/AgentGroupsPage";
import {
  agentState,
  handlers,
  calls,
  makeGroup,
  makeSkill,
  claudeAgent,
  codexAgent,
} from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

function setup() {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("scan_skills", () => [
    makeSkill({ id: "a", name: "Alpha" }),
    makeSkill({ id: "b", name: "Beta" }),
  ]);
  handlers.set("get_config", () => ({ activeGroups: {} }));
}
it("creates an agent-scoped draft and saves the full rapid selection without activating", async () => {
  setup();
  handlers.set("save_agent_group", (args) => makeGroup(args));
  renderWithProviders(<AgentPage agentId="codex" />);
  fireEvent.click(screen.getByRole("button", { name: "新建分组" }));
  fireEvent.change(screen.getByLabelText("分组名称"), {
    target: { value: "Dev" },
  });
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择 Alpha" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 Beta" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(calls.find((c) => c.command === "save_agent_group")?.args).toEqual({
      groupId: null,
      agentId: "codex",
      name: "Dev",
      skillIds: ["a", "b"],
    }),
  );
  expect(calls.some((c) => c.command === "activate_agent_group")).toBe(false);
});
it("分组卡片给出组内 token 体量，空组不显示这个徽标", async () => {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("scan_skills", () => [
    makeSkill({ id: "a", name: "Alpha", tokens: { skillMd: 400, extras: 0 } }),
    makeSkill({ id: "b", name: "Beta", tokens: { skillMd: 1200, extras: 0 } }),
  ]);
  handlers.set("get_config", () => ({ activeGroups: {} }));
  handlers.set("list_groups", () => [
    makeGroup({ id: "c", name: "Dev", agentId: "codex", skillIds: ["a", "b"] }),
    makeGroup({ id: "e", name: "Empty", agentId: "codex", skillIds: [] }),
  ]);
  renderWithProviders(<AgentPage agentId="codex" />);
  expect(await screen.findByText("≈ 1.6k tokens")).toBeInTheDocument();
  // 两处：顶部统计卡片 + 文档组卡片。一个 skill 都没有的空组不该也顶一个
  expect(screen.getAllByText(/tokens$/)).toHaveLength(2);
});

it("顶部统计卡片只数真正生效的东西", async () => {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("scan_skills", () => [
    // 真身就在 codex 目录里、没被停用 → 计入
    makeSkill({
      id: "a",
      name: "Alpha",
      tokens: { skillMd: 400, extras: 100 },
      agents: { codex: agentState("source") },
    }),
    // 被 agent 的原生开关停用 → 文件在，但用不上，不计
    makeSkill({
      id: "b",
      name: "Beta",
      tokens: { skillMd: 1200, extras: 0 },
      agents: { codex: agentState("copied", true) },
    }),
    // 同名目录是用户自己放的，本工具没管 → 不计
    makeSkill({
      id: "c",
      name: "Gamma",
      tokens: { skillMd: 900, extras: 0 },
      agents: { codex: agentState("foreign") },
    }),
  ]);
  handlers.set("list_groups", () => [
    makeGroup({ id: "g", name: "Dev", agentId: "codex", skillIds: ["a", "b"] }),
  ]);
  handlers.set("get_config", () => ({
    activeGroups: {
      codex: { groupId: "g", skillIds: ["a", "b"], entries: [] },
    },
  }));
  renderWithProviders(<AgentPage agentId="codex" />);
  expect(await screen.findByText("已启用 1 个分组")).toBeInTheDocument();
  expect(screen.getByText("已启用 1 个 skill")).toBeInTheDocument();
  // 只有 Alpha 生效：400 + 100 附带文件
  expect(screen.getByText("≈ 500 tokens")).toBeInTheDocument();
  // 分组卡片仍然按组内全部成员算，两个数字不该互相污染
  expect(screen.getByText("≈ 1.7k tokens")).toBeInTheDocument();
});

it("启用记录指向已删除的分组时，统计卡片不虚报", async () => {
  setup();
  handlers.set("list_groups", () => []);
  handlers.set("get_config", () => ({
    activeGroups: { codex: { groupId: "没了", skillIds: [], entries: [] } },
  }));
  renderWithProviders(<AgentPage agentId="codex" />);
  expect(await screen.findByText("已启用 0 个分组")).toBeInTheDocument();
});

/**
 * 后端的估算恒定来自真身，而 copy 漂移的三态里 agent 读到的是另一份内容。
 * 不能把它们从计数里剔掉（agent 确实加载了），只能把不确定性说清楚。
 */
it("副本与源漂移时，token 胶囊在 tooltip 里交代这个数字可能偏高或偏低", async () => {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("scan_skills", () => [
    makeSkill({
      id: "a",
      name: "Alpha",
      tokens: { skillMd: 400, extras: 0 },
      agents: { codex: agentState("source") },
    }),
    // 源从 5000 改成 200 却没重新应用：codex 读的还是旧副本
    makeSkill({
      id: "b",
      name: "Beta",
      tokens: { skillMd: 200, extras: 0 },
      agents: { codex: agentState("copyStale") },
    }),
  ]);
  handlers.set("list_groups", () => []);
  handlers.set("get_config", () => ({ activeGroups: {} }));
  renderWithProviders(<AgentPage agentId="codex" />);
  const pill = await screen.findByText("≈ 600 tokens");
  // 计数不变：两个 skill 都算进去了
  expect(screen.getByText("已启用 2 个 skill")).toBeInTheDocument();
  expect(pill.getAttribute("title")).toContain("1 个 skill 的副本与源已不一致");
  expect(pill.getAttribute("title")).toContain("应用修改");
});

it("没有漂移时 tooltip 不说这句话，免得每次都像在报警", async () => {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("scan_skills", () => [
    makeSkill({
      id: "a",
      name: "Alpha",
      tokens: { skillMd: 400, extras: 0 },
      agents: { codex: agentState("source") },
    }),
    makeSkill({
      id: "b",
      name: "Beta",
      tokens: { skillMd: 200, extras: 0 },
      agents: { codex: agentState("copied") },
    }),
  ]);
  handlers.set("list_groups", () => []);
  handlers.set("get_config", () => ({ activeGroups: {} }));
  renderWithProviders(<AgentPage agentId="codex" />);
  const pill = await screen.findByText("≈ 600 tokens");
  expect(pill.getAttribute("title")).not.toContain("副本与源已不一致");
});

it("copyConflict 既计入已启用，又让分组卡片标出「需要检查」", async () => {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("scan_skills", () => [
    makeSkill({
      id: "a",
      name: "Alpha",
      tokens: { skillMd: 400, extras: 0 },
      agents: { codex: agentState("source") },
    }),
    makeSkill({
      id: "b",
      name: "Beta",
      tokens: { skillMd: 200, extras: 0 },
      agents: { codex: agentState("copyConflict") },
    }),
  ]);
  handlers.set("list_groups", () => [
    makeGroup({ id: "g", name: "Dev", agentId: "codex", skillIds: ["a", "b"] }),
  ]);
  handlers.set("get_config", () => ({
    activeGroups: {
      codex: { groupId: "g", skillIds: ["a", "b"], entries: [] },
    },
  }));
  renderWithProviders(<AgentPage agentId="codex" />);
  expect(await screen.findByText("需要检查")).toBeInTheDocument();
  expect(screen.getByText("已启用 2 个 skill")).toBeInTheDocument();
});

it("统计胶囊用主题边框，深色模式下不是硬编码的近白色", async () => {
  setup();
  handlers.set("list_groups", () => []);
  renderWithProviders(<AgentPage agentId="codex" />);
  for (const label of [
    "已启用 0 个分组",
    "已启用 0 个 skill",
    /^≈ .* tokens$/,
  ]) {
    const pill = await screen.findByText(label);
    expect(pill).toHaveClass("border-border-default");
    // 这一行没有筛选语义，胶囊不该变成可点的按钮
    expect(pill.tagName).not.toBe("BUTTON");
  }
});

it("filters groups by agent and activation sends exactly the selected group", async () => {
  setup();
  handlers.set("list_groups", () => [
    makeGroup({
      id: "c",
      name: "Codex group",
      agentId: "codex",
      skillIds: ["a"],
    }),
    makeGroup({
      id: "x",
      name: "Claude group",
      agentId: "claude-code",
      skillIds: ["b"],
    }),
  ]);
  renderWithProviders(<AgentPage agentId="codex" />);
  await screen.findByText("Codex group");
  expect(screen.queryByText("Claude group")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "启用" }));
  await waitFor(() =>
    expect(
      calls.find((c) => c.command === "activate_agent_group")?.args,
    ).toEqual({ agentId: "codex", groupId: "c" }),
  );
});
it("cancel discards unsaved selection and failed saves preserve the editable draft", async () => {
  setup();
  handlers.set("save_agent_group", () => {
    throw new Error("disk full");
  });
  renderWithProviders(<AgentPage agentId="codex" />);
  fireEvent.click(screen.getByRole("button", { name: "新建分组" }));
  fireEvent.change(screen.getByLabelText("分组名称"), {
    target: { value: "Dev" },
  });
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择 Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  expect(screen.getByLabelText("分组名称")).toHaveValue("Dev");
  expect(screen.getByRole("checkbox", { name: "选择 Alpha" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "新建分组" }));
  expect(screen.getByLabelText("分组名称")).toHaveValue("");
  expect(
    screen.getByRole("checkbox", { name: "选择 Alpha" }),
  ).not.toBeChecked();
});
it("editing an active combination shows pending changes and deletion is disabled", async () => {
  setup();
  handlers.set("list_groups", () => [
    makeGroup({ id: "c", name: "Dev", agentId: "codex", skillIds: ["a", "b"] }),
  ]);
  handlers.set("get_config", () => ({
    activeGroups: { codex: { groupId: "c", skillIds: ["a"], entries: [] } },
  }));
  renderWithProviders(<AgentPage agentId="codex" />);
  expect(await screen.findByText("有待应用修改")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除 Dev" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
  await waitFor(() =>
    expect(
      calls.find((c) => c.command === "activate_agent_group")?.args,
    ).toEqual({ agentId: "codex", groupId: "c" }),
  );
});

it.each([false, true])(
  "reorders via the drag handle, preserves other agents and rolls back on failure=%s",
  async (fail) => {
    setup();
    let saved = [
      makeGroup({ id: "a", name: "First", agentId: "codex", sortOrder: 0 }),
      makeGroup({
        id: "x",
        name: "Other",
        agentId: "claude-code",
        sortOrder: 1,
      }),
      makeGroup({ id: "b", name: "Second", agentId: "codex", sortOrder: 2 }),
    ];
    handlers.set("list_groups", () => saved);
    handlers.set("reorder_groups", (args) => {
      if (fail) throw new Error("disk full");
      saved = (args.groupIds as string[]).map((id, sortOrder) => ({
        ...saved.find((g) => g.id === id)!,
        sortOrder,
      }));
      return saved;
    });
    renderWithProviders(<AgentPage agentId="codex" />);
    const handle = await screen.findByRole("button", {
      name: "拖拽排序 First",
    });
    expect(screen.queryByRole("textbox", { name: "搜索分组" })).toBeNull();
    const handles = screen.getAllByRole("button", { name: /拖拽排序/ });
    // jsdom has no layout: give the actual sortable nodes realistic card bounds.
    const nodes = handles.map((h) => h.parentElement!.parentElement!);
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const index = nodes.indexOf(this);
        const top = Math.max(0, index) * 100;
        return {
          x: 0,
          y: top,
          top,
          bottom: top + 80,
          left: 0,
          right: 800,
          width: 800,
          height: 80,
          toJSON: () => ({}),
        };
      });
    try {
      handle.focus();
      fireEvent.keyDown(handle, { code: "Space" });
      await waitFor(() =>
        expect(handle).toHaveAttribute("aria-pressed", "true"),
      );
      fireEvent.keyDown(document, { code: "ArrowDown" });
      fireEvent.keyDown(document, { code: "Space" });
      await waitFor(() =>
        expect(calls.find((c) => c.command === "reorder_groups")?.args).toEqual(
          { groupIds: ["b", "x", "a"] },
        ),
      );
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: /拖拽排序/ })[0],
        ).toHaveAccessibleName(fail ? "拖拽排序 First" : "拖拽排序 Second"),
      );
      expect(calls.some((c) => c.command === "activate_agent_group")).toBe(
        false,
      );
    } finally {
      rect.mockRestore();
    }
  },
);

it("uses the same button to activate and stop a group after status refresh", async () => {
  setup();
  handlers.set("list_groups", () => [
    makeGroup({ id: "c", name: "Dev", agentId: "codex", skillIds: ["a"] }),
  ]);
  let active = false;
  handlers.set("get_config", () => ({
    activeGroups: active
      ? { codex: { groupId: "c", skillIds: ["a"], entries: [] } }
      : {},
  }));
  handlers.set("activate_agent_group", (args) => {
    active = args.groupId !== null;
  });
  renderWithProviders(<AgentPage agentId="codex" />);
  fireEvent.click(await screen.findByRole("button", { name: "启用" }));
  const stop = await screen.findByRole("button", { name: "停用" });
  await waitFor(() => expect(stop).not.toBeDisabled());
  expect(screen.queryByRole("button", { name: "启用" })).toBeNull();
  fireEvent.click(stop);
  await screen.findByRole("button", { name: "启用" });
  expect(
    calls
      .filter((c) => c.command === "activate_agent_group")
      .map((c) => c.args),
  ).toEqual([
    { agentId: "codex", groupId: "c" },
    { agentId: "codex", groupId: null },
  ]);
});
