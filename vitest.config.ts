import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setupGlobals.ts", "./tests/setupTests.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Radix 的浮层（菜单/下拉）在 jsdom + Node 26 下单次打开要数秒，
    // 是环境特性而非产品问题；涉及菜单交互的用例需要更宽的超时。
    testTimeout: 20_000,
    coverage: { reporter: ["text", "lcov"] },
  },
});
