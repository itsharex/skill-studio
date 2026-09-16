import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "@/App";
import {
  claudeAgent,
  codexAgent,
  handlers,
  calls,
  defaultSettings,
  makeGroup,
  makeSkill,
  makeProject,
} from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

function withAgents() {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("get_config", () => ({ activeGroups: {} }));
}

describe("窗口壳与侧栏导航", () => {
  it("首次启动默认停在「Skill Hub」并高亮该项", async () => {
    withAgents();
    renderWithProviders(<App />);
    const active = await screen.findByRole("button", { current: "page" });
    expect(active.textContent).toBe("Skill Hub");
  });

  it("侧栏按 agent 列表动态生成", async () => {
    withAgents();
    renderWithProviders(<App />);
    await waitFor(() => {
      expect(
        within(screen.getByRole("navigation", { name: "主导航" })).getByRole(
          "button",
          { name: /Claude Code/ },
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("navigation", { name: "主导航" })).getByRole(
          "button",
          { name: /Codex/ },
        ),
      ).toBeInTheDocument();
    });
  });

  it("未安装的 agent 在侧栏标注出来", async () => {
    handlers.set("list_agents", () => [
      claudeAgent,
      { ...codexAgent, detected: false },
    ]);
    renderWithProviders(<App />);
    const codexNav = await within(
      screen.getByRole("navigation", { name: "主导航" }),
    ).findByRole("button", { name: /Codex/ });
    expect(codexNav.textContent).toContain("未装");
  });

  it("点击侧栏切换视图，并把选择持久化到 localStorage", async () => {
    withAgents();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(
      await within(
        screen.getByRole("navigation", { name: "主导航" }),
      ).findByRole("button", { name: /Codex/ }),
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Codex");
    expect(localStorage.getItem("skill-studio-view")).toBe("agent:codex");
  });

  it("恢复上次停留的视图", async () => {
    withAgents();
    localStorage.setItem("skill-studio-view", "projects");
    renderWithProviders(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "项目",
      ),
    );
  });

  it("主题切换会写入 localStorage 并给 <html> 加上对应 class", async () => {
    withAgents();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    expect(screen.queryByRole("button", { name: "深色" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(await screen.findByRole("button", { name: "深色" }));
    expect(localStorage.getItem("skill-studio-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("启动期错误会以横幅提示，而不是静默吞掉", async () => {
    withAgents();
    handlers.set("get_init_error", () => "配置文件损坏，请从 backups/ 恢复");
    renderWithProviders(<App />);
    expect(await screen.findByText(/配置文件损坏/)).toBeInTheDocument();
  });
});

describe("设置视图", () => {
  it("进入设置后侧栏收起，靠返回键退出，并回到进入前停留的视图", async () => {
    withAgents();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(
      await within(
        screen.getByRole("navigation", { name: "主导航" }),
      ).findByRole("button", { name: /Codex/ }),
    );
    expect(
      screen.getByRole("navigation", { name: "主导航" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("设置");
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Codex");
    expect(
      screen.getByRole("navigation", { name: "主导航" }),
    ).toBeInTheDocument();
  });

  it("设置是临时视图，不会被记成下次启动的落脚点", async () => {
    withAgents();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(localStorage.getItem("skill-studio-view")).toBe("library");
  });

  it("旧版本存下的 settings 不会让应用启动就停在设置页", async () => {
    withAgents();
    localStorage.setItem("skill-studio-view", "settings");
    renderWithProviders(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Skill Hub",
      ),
    );
  });

  it("设置内容按顶部标签栏分页，默认停在「通用」", async () => {
    withAgents();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(await screen.findByText("默认链接方式")).toBeInTheDocument();
    expect(screen.queryByText("Agent 目录覆盖")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "目录" }));
    expect(await screen.findByText("Agent 目录覆盖")).toBeInTheDocument();
    expect(screen.queryByText("默认链接方式")).toBeNull();
  });
});

it("navigation replaces the body immediately without waiting for exit animation", async () => {
  withAgents();
  renderWithProviders(<App />);
  await screen.findByRole("button", { name: "Skill Hub" });
  fireEvent.click(screen.getByRole("button", { name: "项目" }));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("项目");
  expect(
    screen.getAllByRole("button", { name: "添加项目" }).length,
  ).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(await screen.findByText("默认链接方式")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(
    screen.getAllByRole("button", { name: "添加项目" }).length,
  ).toBeGreaterThan(0);
});

it("header search and create actions follow the current page without leaking searches", async () => {
  withAgents();
  handlers.set("scan_skills", () => [
    makeSkill({ name: "Alpha" }),
    makeSkill({ id: "s2", name: "Beta" }),
  ]);
  handlers.set("list_groups", () => [
    makeGroup({ name: "Dev", agentId: "codex" }),
    makeGroup({ id: "g2", name: "Write", agentId: "codex" }),
  ]);
  handlers.set("list_projects", () => [
    makeProject({ name: "Site" }),
    makeProject({ id: "p2", name: "Docs", root: "/work/docs" }),
  ]);
  renderWithProviders(<App />);
  const header = within(screen.getByRole("banner"));
  await screen.findByText("Alpha");
  fireEvent.change(header.getByRole("textbox"), { target: { value: "Alpha" } });
  expect(screen.queryByText("Beta")).toBeNull();
  fireEvent.click(header.getByRole("button", { name: "新增 skill" }));
  expect(
    screen.getByRole("heading", { name: "安装 skill" }),
  ).toBeInTheDocument();
  fireEvent.click(header.getByRole("button", { name: "返回" }));
  fireEvent.click(header.getByRole("button", { name: /Codex/ }));
  expect(header.getByRole("textbox")).toHaveValue("");
  await screen.findByText("Dev");
  fireEvent.change(header.getByRole("textbox"), { target: { value: "Write" } });
  expect(screen.queryByText("Dev")).toBeNull();
  fireEvent.click(header.getByRole("button", { name: "新建分组" }));
  expect(screen.getByLabelText("分组名称")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(header.getByRole("button", { name: "项目" }));
  await screen.findByText("Site");
  fireEvent.change(header.getByRole("textbox"), { target: { value: "Docs" } });
  expect(screen.queryByText("Site")).toBeNull();
  expect(screen.getByText("Docs")).toBeInTheDocument();
  fireEvent.click(header.getByRole("button", { name: "添加项目" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it.each([false, true])(
  "manual skill preference persists or retains previous value on failure=%s",
  async (fail) => {
    withAgents();
    let settings = { ...defaultSettings(), preserveManualSkills: true };
    handlers.set("get_settings", () => settings);
    handlers.set("update_settings", (args) => {
      if (fail) throw new Error("disk full");
      settings = { ...settings, ...(args.patch as object) };
      return settings;
    });
    renderWithProviders(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const toggle = await screen.findByRole("switch", {
      name: "切换分组时保留手动安装的 skill",
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(calls.find((c) => c.command === "update_settings")?.args).toEqual({
        patch: { preserveManualSkills: false },
      }),
    );
    await waitFor(() => expect(toggle).not.toBeDisabled());
    if (fail) expect(toggle).toBeChecked();
    else expect(toggle).not.toBeChecked();
    expect(
      within(screen.getByRole("banner")).queryByRole("textbox"),
    ).toBeNull();
  },
);
