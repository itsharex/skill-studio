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
it("prefills a reviewed Registry result without installing or starting it", async () => {
  handlers.set("mcp_request", ({ method, params }) => {
    if (method === "list") return status;
    if (method === "searchRegistry") {
      expect(params.query).toBe("example");
      return {
        items: [
          {
            name: "Example Remote",
            description: "Remote service",
            version: "1.0.0",
            source: "HTTP",
            definition: { type: "http", url: "https://example.com/mcp" },
          },
          {
            name: "Needs Key",
            description: "Requires setup",
            version: "2.0.0",
            source: "需手动配置",
            definition: null,
          },
        ],
        nextCursor: null,
      };
    }
    if (method === "saveEntry") status = { ...status, entries: [params.entry] };
    return null;
  });
  renderWithProviders(<McpPage />);
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  fireEvent.click(screen.getByRole("button", { name: "官方目录" }));
  fireEvent.change(screen.getByLabelText("搜索官方 MCP 目录"), {
    target: { value: "example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await screen.findByText("Example Remote");
  expect(screen.getByRole("button", { name: "需手动配置" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "填入" }));
  expect(screen.getByLabelText("MCP 地址")).toHaveValue(
    "https://example.com/mcp",
  );
  fireEvent.click(screen.getByRole("button", { name: "添加到 Hub" }));
  await waitFor(() => expect(save()).toBeDefined());
  expect(save()).toMatchObject({
    params: {
      entry: {
        name: "Example Remote",
        definition: { type: "http", url: "https://example.com/mcp" },
      },
      agents: [],
    },
  });
  expect(methods()).not.toContain("start");
});
it("loads additional Registry pages and can choose a later result", async () => {
  handlers.set("mcp_request", ({ method, params }) => {
    if (method === "list") return status;
    if (method === "searchRegistry") {
      if (params.cursor === "page-2") {
        return {
          items: [
            {
              name: "Second Page",
              description: "",
              version: "2",
              source: "HTTP",
              definition: { type: "http", url: "https://second.example/mcp" },
            },
          ],
          nextCursor: null,
        };
      }
      return {
        items: [
          {
            name: "First Page",
            description: "",
            version: "1",
            source: "HTTP",
            definition: { type: "http", url: "https://first.example/mcp" },
          },
        ],
        nextCursor: "page-2",
      };
    }
    return null;
  });
  renderWithProviders(<McpPage />);
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
  fireEvent.click(screen.getByRole("button", { name: "官方目录" }));
  fireEvent.change(screen.getByLabelText("搜索官方 MCP 目录"), {
    target: { value: "example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await screen.findByText("First Page");
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  await screen.findByText("Second Page");
  expect(screen.getByText("First Page")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "加载更多" }),
  ).not.toBeInTheDocument();
  const second = screen
    .getByText("Second Page")
    .closest("div.flex.items-start");
  fireEvent.click(second!.querySelector("button")!);
  expect(screen.getByLabelText("MCP 地址")).toHaveValue(
    "https://second.example/mcp",
  );
});
