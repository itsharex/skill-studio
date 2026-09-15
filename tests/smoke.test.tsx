import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

// 非 Tauri 环境下 invoke 不可用，ThemeProvider 已做 catch，这里只测纯组件。
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("脚手架自检", () => {
  it("Button 渲染并带上 default 变体的蓝色底", () => {
    render(<Button>注册</Button>);
    const btn = screen.getByRole("button", { name: "注册" });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain("bg-blue-500");
  });
});
