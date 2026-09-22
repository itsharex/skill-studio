import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect } from "vitest";
import { SettingsPage } from "@/pages/SettingsPage";
import { renderWithProviders } from "./utils/render";
import {
  handlers,
  calls,
  defaultSettings,
  claudeAgent,
  codexAgent,
} from "./mocks/tauri";

it("only saves backup retention as an integer within 0..100 and never saves an empty input as zero", async () => {
  let settings = defaultSettings();
  handlers.set("get_settings", () => settings);
  handlers.set("update_settings", ({ patch }) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  await user.click(await screen.findByRole("tab", { name: "维护" }));
  const input = screen.getByRole("spinbutton", { name: "配置备份保留份数" });
  for (const value of ["101", "-1", "1.5", ""]) {
    fireEvent.change(input, { target: { value } });
  }
  expect(calls.filter((c) => c.command === "update_settings")).toHaveLength(0);
  fireEvent.change(input, { target: { value: "25" } });
  await waitFor(() =>
    expect(calls.filter((c) => c.command === "update_settings")).toHaveLength(
      1,
    ),
  );
  expect(settings.backupKeep).toBe(25);
});

it("backup restore requires confirmation and cancel does not restore", async () => {
  handlers.set("list_backups", () => ["/tmp/config-2026.json"]);
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  await user.click(await screen.findByRole("tab", { name: "维护" }));
  await user.click(await screen.findByRole("button", { name: "恢复" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("从备份恢复配置");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(calls.filter((c) => c.command === "restore_backup")).toHaveLength(0);
});

it("does not persist partial Hub paths while typing", async () => {
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  await user.click(await screen.findByRole("tab", { name: "目录" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Hub 目录" }), {
    target: { value: "/tmp/new-hub" },
  });
  expect(calls.filter((c) => c.command === "update_settings")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "保存目录" }));
  await waitFor(() =>
    expect(calls.filter((c) => c.command === "update_settings")).toHaveLength(
      1,
    ),
  );
  expect(calls.find((c) => c.command === "update_settings")?.args).toEqual({
    patch: { hubDir: "/tmp/new-hub" },
  });
});

it("persists application toggles and allows all applications to be hidden and restored", async () => {
  let settings = defaultSettings();
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("get_settings", () => settings);
  handlers.set("update_settings", ({ patch }) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  const user = userEvent.setup();
  renderWithProviders(<SettingsPage />);
  const claude = await screen.findByRole("button", { name: "Claude Code" });
  const codex = screen.getByRole("button", { name: "Codex" });
  expect(claude).toHaveAttribute("aria-pressed", "true");
  await user.click(claude);
  await waitFor(() => expect(claude).toHaveAttribute("aria-pressed", "false"));
  await user.click(codex);
  await waitFor(() =>
    expect(settings.disabledAgents).toEqual(["claude-code", "codex"]),
  );
  await waitFor(() => expect(codex).toBeEnabled());
  await user.click(codex);
  await waitFor(() => expect(settings.disabledAgents).toEqual(["claude-code"]));
});

it("defaults builtin MCP visibility off and saves the display preference", async () => {
  let settings = { ...defaultSettings(), showCodexBuiltinMcp: false };
  handlers.set("get_settings", () => settings);
  handlers.set("update_settings", ({ patch }) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  renderWithProviders(<SettingsPage />);
  const toggle = await screen.findByRole("switch", {
    name: "显示 Codex App 内置 MCP",
  });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
  expect(settings.showCodexBuiltinMcp).toBe(true);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(settings.showCodexBuiltinMcp).toBe(false);
});
