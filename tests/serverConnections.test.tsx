import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  TargetProvider,
  TargetPicker,
} from "@/components/targets/TargetProvider";
import { NavigationGuard } from "@/components/common/NavigationGuard";
import { SettingsPage } from "@/pages/SettingsPage";
import { getTarget, setTarget, invoke } from "@/lib/api/transport";
import { queryClient } from "@/lib/query/queryClient";
import { calls, handlers, defaultSettings } from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));
const storageKey = "skill-studio:server-connections-enabled";
const server = {
  id: "server-a",
  name: "Test server",
  host: "test-host",
  user: null,
  port: null,
  identityFile: null,
  jumpHost: null,
  passwordAuth: false,
  helperBinary: null,
};
beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
  queryClient.clear();
  setTarget({ id: "local", name: "本机", connected: true });
  handlers.set("list_servers", () => [server]);
  handlers.set("remote_request", ({ method }) => {
    if (method === "get_settings") return defaultSettings();
    if (method === "get_config_dir") return "/remote/config";
    return [];
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  queryClient.clear();
  setTarget({ id: "local", name: "本机", connected: true });
});
const renderSettings = async () => {
  const view = renderWithProviders(
    <NavigationGuard>
      <TargetProvider>
        <TargetPicker />
        <SettingsPage />
      </TargetProvider>
    </NavigationGuard>,
  );
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "服务器" }), {
    button: 0,
    ctrlKey: false,
  });
  return view;
};

it("hides the picker and server settings, persists the preference, and preserves saved profiles", async () => {
  const view = await renderSettings();
  const toggle = await screen.findByRole("switch", { name: "启用服务器连接" });
  expect(toggle).toBeChecked();
  expect(screen.getByRole("button", { name: "本机" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "服务器" })).toBeVisible();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(screen.queryByRole("button", { name: "本机" })).toBeNull();
  expect(screen.getByRole("tab", { name: "服务器" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "服务器" })).toHaveAttribute(
    "data-state",
    "active",
  );
  expect(screen.queryByRole("button", { name: "添加服务器" })).toBeNull();
  expect(localStorage.getItem(storageKey)).toBe("false");
  expect(calls.some((c) => c.command === "save_servers")).toBe(false);
  view.unmount();
  queryClient.clear();
  calls.length = 0;
  await renderSettings();
  const restored = await screen.findByRole("switch", {
    name: "启用服务器连接",
  });
  expect(restored).not.toBeChecked();
  expect(calls.some((c) => c.command === "list_servers")).toBe(false);
  fireEvent.click(restored);
  await waitFor(() => expect(restored).toBeChecked());
  fireEvent.mouseDown(screen.getByRole("tab", { name: "服务器" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByText("Test server")).toBeVisible();
  expect(screen.getByRole("button", { name: "连接" })).toBeVisible();
  expect(calls.some((c) => c.command === "connect_server")).toBe(false);
});

it("disconnects the current server and returns to local before disabling", async () => {
  setTarget({ id: server.id, name: server.name, connected: true });
  await renderSettings();
  fireEvent.click(
    await screen.findByRole("switch", { name: "启用服务器连接" }),
  );
  await waitFor(() => expect(getTarget().id).toBe("local"));
  expect(calls).toContainEqual({
    command: "disconnect_server",
    args: { serverId: server.id },
  });
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "服务器" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(
    await screen.findByRole("switch", { name: "启用服务器连接" }),
  ).not.toBeChecked();
  expect(calls.some((c) => c.command === "update_settings")).toBe(false);
});

it("does not hide the controls if disconnecting fails", async () => {
  handlers.set("disconnect_server", () => {
    throw new Error("disconnect failed");
  });
  await renderSettings();
  const toggle = await screen.findByRole("switch", { name: "启用服务器连接" });
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "disconnect failed",
  );
  expect(toggle).toBeChecked();
  expect(screen.getByRole("tab", { name: "服务器" })).toBeVisible();
  expect(localStorage.getItem(storageKey)).not.toBe("false");
});

it("prevents disabling while a management operation is in flight", async () => {
  await renderSettings();
  const toggle = await screen.findByRole("switch", { name: "启用服务器连接" });
  let finish!: () => void;
  handlers.set(
    "register_skills",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let operation!: Promise<unknown>;
  act(() => {
    operation = invoke("register_skills");
  });
  expect(toggle).toBeDisabled();
  await act(async () => {
    finish();
    await operation;
  });
  expect(toggle).toBeEnabled();
});
