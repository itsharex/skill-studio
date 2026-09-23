import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  NavigationGuard,
  useUnsavedProject,
} from "@/components/common/NavigationGuard";
import { renderWithProviders } from "./utils/render";

const native = vi.hoisted(() => ({
  handler: null as null | ((e: { preventDefault: () => void }) => void),
  destroy: vi.fn(async () => {}),
  hide: vi.fn(async () => {}),
  off: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: typeof native.handler) => {
      native.handler = handler;
      return native.off;
    },
    destroy: native.destroy,
    hide: native.hide,
  }),
}));
function Draft() {
  useUnsavedProject(true, false);
  return <p>编辑中</p>;
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).__TAURI_INTERNALS__;
  native.handler = null;
  vi.restoreAllMocks();
  native.destroy.mockClear();
  native.hide.mockClear();
});
it("blocks native close and destroys the window only after discard confirmation", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  renderWithProviders(
    <NavigationGuard>
      <Draft />
    </NavigationGuard>,
  );
  await waitFor(() => expect(native.handler).not.toBeNull());
  const preventDefault = vi.fn();
  act(() => native.handler!({ preventDefault }));
  expect(preventDefault).toHaveBeenCalled();
  expect(native.destroy).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
  expect(native.destroy).not.toHaveBeenCalled();
  act(() => native.handler!({ preventDefault }));
  fireEvent.click(
    await screen.findByRole("button", { name: "放弃修改并离开" }),
  );
  expect(native.destroy).toHaveBeenCalledTimes(1);
});

it("hides the macOS window on Cmd+W while keeping the app alive", async () => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  );
  (window as any).__TAURI_INTERNALS__ = {};
  renderWithProviders(<NavigationGuard>窗口内容</NavigationGuard>);
  await waitFor(() => expect(native.handler).not.toBeNull());
  const preventDefault = vi.fn();
  act(() => native.handler!({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  await waitFor(() => expect(native.hide).toHaveBeenCalledOnce());
  expect(native.destroy).not.toHaveBeenCalled();
});

it("confirms unsaved macOS work before hiding the window", async () => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  );
  (window as any).__TAURI_INTERNALS__ = {};
  renderWithProviders(
    <NavigationGuard>
      <Draft />
    </NavigationGuard>,
  );
  await waitFor(() => expect(native.handler).not.toBeNull());
  const preventDefault = vi.fn();
  act(() => native.handler!({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(native.hide).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
  expect(native.hide).not.toHaveBeenCalled();
  act(() => native.handler!({ preventDefault }));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }));
  await waitFor(() => expect(native.hide).toHaveBeenCalledOnce());
  expect(native.destroy).not.toHaveBeenCalled();
});
