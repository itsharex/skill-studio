import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 非 Tauri 环境下 invoke 不可用，ThemeProvider 已做 catch，这里只测纯组件。
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("脚手架自检", () => {
  it("Button 渲染并带上 default 变体的蓝色底", () => {
    render(<Button>注册</Button>);
    const btn = screen.getByRole("button", { name: "注册" });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain("bg-blue-500");
  });

  // 同心圆角用的是自定义 borderRadius key，tailwind-merge 默认不认识它。
  // 不登记的话两个 rounded-* 会一起留下，最终谁生效取决于 CSS 顺序。
  it("cn 能让 rounded-xl-inner 确定性地覆盖内置圆角类", () => {
    expect(cn("rounded-md", "rounded-xl-inner")).toBe("rounded-xl-inner");
    expect(cn("rounded-xl-inner", "rounded-md")).toBe("rounded-md");
  });
});
