import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it } from "vitest";
import { McpPage } from "@/pages/McpPage";
import { calls, handlers } from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";
import type { ManagementStatus } from "@/lib/api/mcpManagement";
let status: ManagementStatus;
const parsed = {
  name: "hf-mcp-server",
  agent: "codex",
  scope: "user",
  definition: { type: "http", url: "https://huggingface.co/mcp?login" },
};
const methods = () =>
  calls
    .filter((c) => c.command === "mcp_request")
    .map((c) => (c.args as { method: string }).method);
const save = () =>
  calls.find(
    (c) =>
      c.command === "mcp_request" &&
      (c.args as { method: string }).method === "saveEntry",
  )?.args;
beforeEach(() => {
  status = {
    running: false,
    entries: [],
    servers: [],
    discovered: [],
    scanWarnings: [],
  };
  handlers.set("mcp_request", ({ method, params }) => {
    if (method === "list") return status;
    if (method === "parse") return [parsed];
    if (method === "gatewayCheck") return { issue: null };
    if (method === "saveEntry") status = { ...status, entries: [params.entry] };
    if (method === "login") return { url: "https://login.example/authorize" };
    return null;
  });
});
afterEach(cleanup);
async function open() {
  renderWithProviders(<McpPage />);
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  fireEvent.change(screen.getByLabelText("粘贴安装命令、网址或配置"), {
    target: {
      value:
        'codex mcp add hf-mcp-server --url "https://huggingface.co/mcp?login"',
    },
  });
  await screen.findByDisplayValue("hf-mcp-server");
}
it("recognizes a command and defaults to the named agent with no login or gateway steps", async () => {
  await open();
  expect(screen.getByRole("checkbox", { name: "Codex" })).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Claude Code" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "安装" }));
  await waitFor(() => expect(save()).toBeDefined());
  expect(save()).toMatchObject({
    params: {
      agents: ["codex"],
      scope: "user",
      projectId: "",
      entry: {
        name: "hf-mcp-server",
        mode: "direct",
        oauth: false,
        definition: parsed.definition,
      },
    },
  });
  expect(methods()).not.toContain("start");
  expect(methods()).not.toContain("login");
});
it("installs, starts the proxy and opens login in order through one explicit action", async () => {
  await open();
  fireEvent.click(screen.getByRole("radio", { name: /Studio 代理/ }));
  expect(
    screen.getByRole("checkbox", { name: "此服务需要网页登录" }),
  ).toBeChecked();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "安装并登录" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "安装并登录" }));
  await screen.findByDisplayValue("https://login.example/authorize");
  expect(
    methods().filter((m) => ["saveEntry", "start", "login"].includes(m)),
  ).toEqual(["saveEntry", "start", "login"]);
  expect(save()).toMatchObject({
    params: { entry: { mode: "gateway", oauth: true } },
  });
});
it("keeps a saved entry after proxy startup fails rather than leaving a duplicate-prone add form", async () => {
  handlers.set("mcp_request", ({ method, params }) => {
    if (method === "list") return status;
    if (method === "parse") return [parsed];
    if (method === "gatewayCheck") return { issue: null };
    if (method === "saveEntry") status = { ...status, entries: [params.entry] };
    if (method === "start") throw new Error("port unavailable");
    return null;
  });
  await open();
  fireEvent.click(screen.getByRole("radio", { name: /Studio 代理/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "安装并登录" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "安装并登录" }));
  await screen.findByText("hf-mcp-server · 连接详情");
  expect(
    screen.queryByLabelText("粘贴安装命令、网址或配置"),
  ).not.toBeInTheDocument();
  expect(methods().filter((m) => m === "saveEntry")).toHaveLength(1);
  expect(methods()).not.toContain("login");
});
it("requires a project for Claude local scope and preserves that scope in the save", async () => {
  handlers.set("list_projects", () => [
    { id: "p1", name: "Work", root: "/work" },
  ]);
  handlers.set("mcp_request", ({ method }) =>
    method === "list"
      ? status
      : method === "parse"
        ? [{ ...parsed, agent: "claude", scope: "local" }]
        : null,
  );
  await open();
  expect(screen.getByRole("button", { name: "安装" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("安装项目"), {
    target: { value: "p1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "安装" }));
  await waitFor(() => expect(save()).toBeDefined());
  expect(save()).toMatchObject({
    params: { agents: ["claude"], projectId: "p1", scope: "local" },
  });
});
it("lets users edit inferred fields inline and preserves extensions", async () => {
  await open();
  expect(
    screen.queryByRole("button", { name: "手动填写 / 高级配置" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("名称")).toHaveValue("hf-mcp-server");
  expect(screen.getByLabelText("MCP 地址")).toHaveValue(parsed.definition.url);
  fireEvent.change(screen.getByLabelText("MCP 地址"), {
    target: { value: "https://example.com/changed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加请求头" }));
  fireEvent.change(screen.getByLabelText("请求头名称 1"), {
    target: { value: "X-Test" },
  });
  fireEvent.change(screen.getByLabelText("请求头值 1"), {
    target: { value: "test" },
  });
  expect(screen.getByRole("checkbox", { name: "Codex" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "安装" }));
  await waitFor(() => expect(save()).toBeDefined());
  expect(save()).toMatchObject({
    params: {
      entry: {
        definition: {
          url: "https://example.com/changed",
          headers: { "X-Test": "test" },
        },
      },
    },
  });
});
it("invalidates a previous preview immediately when the input changes", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("粘贴安装命令、网址或配置"), {
    target: { value: "" },
  });
  expect(screen.getByLabelText("名称")).toHaveValue("");
  expect(screen.getByRole("button", { name: "安装" })).toBeDisabled();
  expect(methods()).not.toContain("saveEntry");
});
