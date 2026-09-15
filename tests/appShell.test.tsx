import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import App from "@/App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("窗口壳与侧栏导航", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("首次启动默认停在「全局 Skill」并高亮该项", () => {
    renderApp();
    // 用 aria-current 判定选中项，不依赖具体的 Tailwind class
    const active = screen.getByRole("button", { current: "page" });
    expect(active.textContent).toBe("全局 Skill");
  });

  it("点击侧栏切换视图，并把选择持久化到 localStorage", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Codex" }));

    // 顶栏标题与占位内容都应更新为 Codex
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Codex");
    expect(localStorage.getItem("skill-studio-view")).toBe("agent:codex");
  });

  it("恢复上次停留的视图", () => {
    localStorage.setItem("skill-studio-view", "groups");
    renderApp();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("分组");
  });

  it("主题切换会写入 localStorage 并给 <html> 加上对应 class", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "深色" }));
    expect(localStorage.getItem("skill-studio-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
