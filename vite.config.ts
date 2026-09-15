import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri 期望前端产物在 ../dist，且 index.html 位于 src/ 下（与 cc-switch 一致）。
export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 3000,
    strictPort: true,
    // Tauri 在固定端口上等待 dev server，不允许自动换端口
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
  },
  // 只暴露这两个前缀的环境变量给渲染进程
  envPrefix: ["VITE_", "TAURI_"],
});
