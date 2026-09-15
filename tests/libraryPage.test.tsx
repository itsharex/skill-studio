import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LibraryPage } from "@/pages/LibraryPage";
import {
  agentState,
  claudeAgent,
  codexAgent,
  emptyReport,
  handlers,
  makeSkill,
} from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

/**
 * 注意：这里刻意**不测 Radix 下拉菜单打开后的交互**。
 * Radix 浮层用 floating-ui 定位，在 jsdom 里单次打开要 3–50 秒（根因是 jsdom 的
 * getComputedStyle 性能；让 ResizeObserver 立即回调还会形成自激循环），
 * 在 CI 上必然抖。菜单里那几个动作的正确性由两处兜住：
 * - 参数形状：tests/apiLayer.test.ts 直接断言 invoke 收到的参数
 * - 命令名与参数名是否对得上后端：tests/ipcContract.test.ts 静态比对
 */

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

  it("勾选后出现批量操作入口，并带上已选数量", async () => {
    setup([
      makeSkill({ id: "a", name: "a" }),
      makeSkill({ id: "b", name: "b" }),
    ]);
    handlers.set("register_skills", () => emptyReport());
    const user = userEvent.setup();
    renderWithProviders(<LibraryPage />);
    await screen.findByText("a");

    await user.click(screen.getByLabelText("选择 a"));
    await user.click(screen.getByLabelText("选择 b"));

    expect(screen.getByText("已选 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /注册到…/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消选择" }),
    ).toBeInTheDocument();
  });

  it("取消选择会收起批量操作入口", async () => {
    setup([makeSkill({ id: "a", name: "a" })]);
    const user = userEvent.setup();
    renderWithProviders(<LibraryPage />);
    await screen.findByText("a");

    await user.click(screen.getByLabelText("选择 a"));
    await user.click(screen.getByRole("button", { name: "取消选择" }));
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
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
