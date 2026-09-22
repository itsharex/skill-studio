import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, it } from "vitest";
import App from "@/App";
import { McpPage } from "@/pages/McpPage";
import { calls, handlers } from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";
import { setTarget } from "@/lib/api/transport";

const empty = {
  running: false,
  entries: [],
  servers: [],
  discovered: [],
  scanWarnings: [],
};
const methods = () =>
  calls
    .filter((c) => c.command === "mcp_request")
    .map((c) => (c.args as { method: string }).method);
beforeEach(() => {
  setTarget({ id: "local", name: "本机", connected: true });
  handlers.set("mcp_request", ({ method }) =>
    method === "list"
      ? empty
      : method === "gatewayCheck"
        ? { issue: null }
        : null,
  );
});
afterEach(() => {
  cleanup();
  setTarget({ id: "local", name: "本机", connected: true });
});
it("saves and applies direct configuration to multiple agents without starting the gateway", async () => {
  renderWithProviders(<McpPage />);
  await screen.findByText("网关已关闭");
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "Work" },
  });
  fireEvent.change(screen.getByLabelText("MCP 地址"), {
    target: { value: "https://example.com/mcp" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Claude Code" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Codex" }));
  fireEvent.click(screen.getByRole("button", { name: "安装" }));
  await waitFor(() => expect(methods()).toContain("saveEntry"));
  const save = calls.find(
    (c) =>
      c.command === "mcp_request" &&
      (c.args as { method: string }).method === "saveEntry",
  );
  expect(save?.args).toMatchObject({
    params: {
      entry: {
        name: "Work",
        mode: "direct",
        definition: { type: "http", url: "https://example.com/mcp" },
      },
      agents: ["claude", "codex"],
      projectId: "",
      expectedEntry: null,
    },
  });
  expect(methods()).not.toContain("start");
  expect(methods()).not.toContain("login");
});
it("fills a local process in the same page without templates or JSON", async () => {
  renderWithProviders(<McpPage />);
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  expect(screen.queryByText("常用模板")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "Memory" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /本地进程/ }));
  fireEvent.change(screen.getByLabelText("启动命令"), {
    target: { value: "npx" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加参数" }));
  fireEvent.change(screen.getByLabelText("参数 1"), {
    target: { value: " argument with spaces " },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
  await waitFor(() => expect(methods()).toContain("saveEntry"));
  expect(
    calls.find(
      (c) =>
        c.command === "mcp_request" &&
        (c.args as { method: string }).method === "saveEntry",
    )?.args,
  ).toMatchObject({
    params: {
      entry: {
        definition: {
          type: "stdio",
          command: "npx",
          args: [" argument with spaces "],
        },
      },
    },
  });
});
it("parses pasted configurations in the unified add flow and lets users choose a service", async () => {
  handlers.set("mcp_request", ({ method }) =>
    method === "list"
      ? empty
      : method === "parse"
        ? [
            { name: "first", definition: { type: "stdio", command: "one" } },
            {
              name: "second",
              definition: {
                type: "stdio",
                command: "two",
                startup_timeout_sec: 120,
              },
            },
          ]
        : null,
  );
  renderWithProviders(<McpPage />);
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  fireEvent.change(screen.getByLabelText("粘贴安装命令、网址或配置"), {
    target: { value: "[mcp_servers.first]\ncommand='one'" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "second" }));
  expect(screen.getByLabelText("名称")).toHaveValue("second");
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
  await waitFor(() => expect(methods()).toContain("saveEntry"));
  expect(
    calls.find(
      (c) =>
        c.command === "mcp_request" &&
        (c.args as { method: string }).method === "saveEntry",
    )?.args,
  ).toMatchObject({
    params: { entry: { definition: { startup_timeout_sec: 120 } } },
  });
});
it("allows managing discovered client extensions directly, but blocks incompatible gateway mode", async () => {
  const definition = { command: "node", startup_timeout_sec: 120 };
  handlers.set("mcp_request", ({ method }) =>
    method === "list"
      ? {
          ...empty,
          discovered: [
            {
              id: "found",
              name: "Tools",
              server: null,
              managedId: null,
              issue: "暂不支持 startup_timeout_sec",
              sources: [
                {
                  id: "source-found",
                  agent: "codex",
                  path: "/tmp/config.toml",
                  scope: "用户全局",
                  project: null,
                  key: "Tools",
                  enabled: true,
                  gateway: false,
                  definition,
                },
              ],
            },
          ],
        }
      : method === "gatewayCheck"
        ? { issue: "暂不支持 startup_timeout_sec" }
        : null,
  );
  renderWithProviders(<McpPage />);
  await screen.findByText("Tools");
  fireEvent.click(screen.getByRole("button", { name: "管理 Tools" }));
  expect(screen.getByRole("button", { name: "保存并应用" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("连接方式"), {
    target: { value: "gateway" },
  });
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "保存并应用" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("连接方式"), {
    target: { value: "direct" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
  await waitFor(() => expect(methods()).toContain("saveEntry"));
  expect(
    calls.find(
      (c) =>
        c.command === "mcp_request" &&
        (c.args as { method: string }).method === "saveEntry",
    )?.args,
  ).toMatchObject({
    params: {
      sources: [{ id: "source-found", definition }],
      entry: { mode: "direct", definition: { startup_timeout_sec: 120 } },
    },
  });
  expect(methods()).not.toContain("start");
});
it("saves OAuth gateway configuration without starting or logging in automatically", async () => {
  renderWithProviders(<McpPage />);
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "OAuth" },
  });
  fireEvent.change(screen.getByLabelText("MCP 地址"), {
    target: { value: "https://example.com/mcp" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /Studio 代理/ }));
  fireEvent.click(screen.getByLabelText("此服务需要网页登录"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "添加到 Hub" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
  await waitFor(() => expect(methods()).toContain("saveEntry"));
  expect(methods()).not.toContain("start");
  expect(methods()).not.toContain("login");
});
it("does not read local MCPs while viewing a remote machine", () => {
  setTarget({ id: "remote", name: "远程", connected: true });
  renderWithProviders(<McpPage />);
  expect(screen.getByText(/MCP Hub 当前支持本机/)).toBeVisible();
  expect(methods()).toEqual([]);
});
it("toggles the gateway directly from the list", async () => {
  renderWithProviders(<McpPage />);
  await screen.findByText("网关已关闭");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "MCP 网关" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "MCP 网关" }));
  await waitFor(() => expect(methods()).toContain("start"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("uses the app subpage header and preserves Hub search when returning", async () => {
  localStorage.setItem("skill-studio-view", "mcp");
  renderWithProviders(<App />);
  const search = await screen.findByRole("textbox", {
    name: "按名称或地址搜索 MCP…",
  });
  fireEvent.change(search, { target: { value: "work" } });
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  expect(
    screen.getByRole("heading", { name: "添加 MCP", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "主导航" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("网关已关闭")).not.toBeInTheDocument();
  expect(localStorage.getItem("skill-studio-view")).toBe("mcp");
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(screen.getByRole("heading", { name: "MCP Hub" })).toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "按名称或地址搜索 MCP…" }),
  ).toHaveValue("work");
});
