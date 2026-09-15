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
    // 默认 5s 对首次渲染 + tooltip 偏紧，给一点余量。
    // 注意不要在 jsdom 里测 Radix 浮层的展开交互，那会慢到必然抖，
    // 相关约定见 tests/libraryPage.test.tsx 顶部说明。
    testTimeout: 10_000,
    coverage: { reporter: ["text", "lcov"] },
  },
});
