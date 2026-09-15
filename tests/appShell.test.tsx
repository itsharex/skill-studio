import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "@/App";
import { claudeAgent, codexAgent, handlers } from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

function withAgents() {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
}

describe("窗口壳与侧栏导航", () => {
  it("首次启动默认停在「全局 Skill」并高亮该项", async () => {
    withAgents();
    renderWithProviders(<App />);
    const active = await screen.findByRole("button", { current: "page" });
    expect(active.textContent).toBe("全局 Skill");
  });

  it("侧栏按 agent 列表动态生成", async () => {
    withAgents();
    renderWithProviders(<App />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Claude Code/ }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Codex/ })).toBeInTheDocument();
    });
  });

  it("未安装的 agent 在侧栏标注出来", async () => {
    handlers.set("list_agents", () => [
      claudeAgent,
      { ...codexAgent, detected: false },
    ]);
    renderWithProviders(<App />);
    const codexNav = await screen.findByRole("button", { name: /Codex/ });
    expect(codexNav.textContent).toContain("未装");
  });

  it("点击侧栏切换视图，并把选择持久化到 localStorage", async () => {
    withAgents();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Codex");
    expect(localStorage.getItem("skill-studio-view")).toBe("agent:codex");
  });

  it("恢复上次停留的视图", async () => {
    withAgents();
    localStorage.setItem("skill-studio-view", "groups");
    renderWithProviders(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "分组",
      ),
    );
  });

  it("主题切换会写入 localStorage 并给 <html> 加上对应 class", async () => {
    withAgents();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole("button", { name: "深色" }));
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
