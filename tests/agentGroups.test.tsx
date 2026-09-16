import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentPage } from "@/pages/AgentGroupsPage";
import {
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
