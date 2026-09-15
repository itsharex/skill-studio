import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { invoke, resetTauriMock } from "./mocks/tauri";

// 所有用例共用一个 invoke 路由 mock：默认返回空数据，用例按需覆盖单个命令。
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
// 事件订阅在测试里不需要真的连上
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

afterEach(() => {
  cleanup();
  resetTauriMock();
  localStorage.clear();
  vi.clearAllMocks();
});
