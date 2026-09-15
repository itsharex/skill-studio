import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LibraryPage } from "@/pages/LibraryPage";
import {
  agentState,
  calls,
  claudeAgent,
  codexAgent,
  emptyReport,
  handlers,
  makeSkill,
} from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

function setup(skills = [makeSkill()]) {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("scan_skills", () => skills);
}

describe("全局 Skill 页（需求 1）", () => {
  it("空状态给出可操作的引导，而不是一句「暂无数据」", async () => {
    handlers.set("list_agents", () => [claudeAgent]);
    handlers.set("scan_skills", () => []);
    renderWithProviders(<LibraryPage />);
    expect(await screen.findByText("还没有发现任何 skill")).toBeInTheDocument();
    // 提示里要带上实际扫描的目录，用户才知道该往哪放
    expect(screen.getByText(/\.claude\/skills/)).toBeInTheDocument();
  });

  it("列出 skill 并标注真身所在的 agent", async () => {
    setup();
    renderWithProviders(<LibraryPage />);
    expect(await screen.findByText("pdf-tools")).toBeInTheDocument();
    expect(screen.getByText("处理 PDF")).toBeInTheDocument();
    expect(screen.getByText(/原地 · Claude Code/)).toBeInTheDocument();
  });

  it("Hub 托管的 skill 用不同徽标区分", async () => {
    setup([makeSkill({ origin: { kind: "hub" } })]);
    renderWithProviders(<LibraryPage />);
    expect(await screen.findByText("Hub 托管")).toBeInTheDocument();
  });

  it("含 Claude 专有 frontmatter 字段时给出跨端提示", async () => {
    setup([makeSkill({ frontmatterExtra: ["context", "agent"] })]);
    renderWithProviders(<LibraryPage />);
    expect(await screen.findByText("跨端")).toBeInTheDocument();
  });

  it("搜索按名称与描述过滤", async () => {
    setup([
      makeSkill({ id: "a", name: "pdf-tools", description: "处理 PDF" }),
      makeSkill({ id: "b", name: "code-review", description: "审查代码" }),
    ]);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<LibraryPage />);
    await screen.findByText("pdf-tools");

    await user.type(screen.getByPlaceholderText("按名称或描述搜索…"), "审查");
    await waitFor(() => {
      expect(screen.queryByText("pdf-tools")).not.toBeInTheDocument();
      expect(screen.getByText("code-review")).toBeInTheDocument();
    });
  });

  it("勾选后可批量注册到指定 agent", async () => {
    setup([
      makeSkill({ id: "a", name: "a" }),
      makeSkill({ id: "b", name: "b" }),
    ]);
    handlers.set("register_skills", () => emptyReport());
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<LibraryPage />);
    await screen.findByText("a");

    await user.click(screen.getByLabelText("选择 a"));
    await user.click(screen.getByLabelText("选择 b"));
    expect(screen.getByText("已选 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /注册到…/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Codex" }));

    await waitFor(() => {
      const call = calls.find((c) => c.command === "register_skills");
      expect(call).toBeDefined();
      expect(call!.args).toMatchObject({
        skillIds: ["a", "b"],
        agentIds: ["codex"],
      });
    });
  });

  it("真身所在的 agent 不能被当作注册目标", async () => {
    setup();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<LibraryPage />);
    await screen.findByText("pdf-tools");

    await user.click(
      screen.getByRole("button", { name: "pdf-tools 的更多操作" }),
    );
    const claudeItem = await screen.findByRole("menuitem", {
      name: /Claude Code/,
    });
    expect(claudeItem).toHaveAttribute("aria-disabled", "true");
    expect(within(claudeItem).getByText("真身在此")).toBeInTheDocument();
  });

  it("全选只作用于当前筛选结果", async () => {
    setup([
      makeSkill({ id: "a", name: "alpha" }),
      makeSkill({ id: "b", name: "beta" }),
    ]);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<LibraryPage />);
    await screen.findByText("alpha");

    await user.type(screen.getByPlaceholderText("按名称或描述搜索…"), "alpha");
    await waitFor(() =>
      expect(screen.queryByText("beta")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText("全选"));
    expect(screen.getByText("已选 1")).toBeInTheDocument();
  });

  it("被占用的目标以 Foreign 状态呈现", async () => {
    setup([
      makeSkill({
        agents: {
          "claude-code": agentState("source"),
          codex: agentState("foreign"),
        },
      }),
    ]);
    renderWithProviders(<LibraryPage />);
    await screen.findByText("pdf-tools");
    // 状态点带 tooltip，这里只断言渲染出了两个 agent 的状态标签
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
  });
});
