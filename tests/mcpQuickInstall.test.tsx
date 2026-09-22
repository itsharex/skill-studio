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
it("imports a command into the Hub without agent or scope controls", async () => {
  await open();
  expect(
    screen.queryByRole("checkbox", { name: "Codex" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("安装位置")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
  await waitFor(() => expect(save()).toBeDefined());
  expect(save()).toMatchObject({
    params: {
      agents: [],
      sources: [],
      bindingIds: [],
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
it("stores gateway authorization settings without starting the gateway or opening login", async () => {
  await open();
  fireEvent.click(screen.getByRole("radio", { name: /Studio 代理/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "添加到 Hub" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
  await waitFor(() => expect(save()).toBeDefined());
  expect(save()).toMatchObject({
    params: { agents: [], entry: { mode: "gateway", oauth: false } },
  });
  expect(methods()).not.toContain("start");
  expect(methods()).not.toContain("login");
});
it("does not apply agent or project scope inferred from pasted commands", async () => {
  handlers.set("mcp_request", ({ method }) =>
    method === "list"
      ? status
      : method === "parse"
        ? [{ ...parsed, agent: "claude", scope: "local" }]
        : null,
  );
  await open();
  expect(screen.queryByLabelText("安装项目")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
  await waitFor(() => expect(save()).toBeDefined());
  expect(save()).toMatchObject({
    params: { agents: [], projectId: "", scope: "user" },
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
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
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
  expect(screen.getByRole("button", { name: "添加到 Hub" })).toBeDisabled();
  expect(methods()).not.toContain("saveEntry");
});
