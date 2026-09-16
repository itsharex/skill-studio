import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  NavigationGuard,
  useUnsavedProject,
} from "@/components/common/NavigationGuard";
import { renderWithProviders } from "./utils/render";

const native = vi.hoisted(() => ({
  handler: null as null | ((e: { preventDefault: () => void }) => void),
  destroy: vi.fn(async () => {}),
  off: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: typeof native.handler) => {
      native.handler = handler;
      return native.off;
    },
    destroy: native.destroy,
  }),
}));
function Draft() {
  useUnsavedProject(true, false);
  return <p>编辑中</p>;
}
afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
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
