import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProjectsPage } from "@/pages/ProjectsPage";
import {
  handlers,
  makeProject,
  makeSkill,
  makeGroup,
  claudeAgent,
  codexAgent,
  calls,
} from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const updates = () => calls.filter((c) => c.command === "apply_project");

it("keeps selections local and saves once before applying on explicit write", async () => {
  let project = makeProject();
  handlers.set("list_projects", () => [project]);
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
  handlers.set("list_groups", () => [
    makeGroup({ id: "g1", name: "Group A" }),
    makeGroup({ id: "g2", name: "Group B" }),
  ]);
  handlers.set("scan_skills", () => [
    makeSkill({ id: "a", name: "Alpha" }),
    makeSkill({ id: "b", name: "Beta" }),
  ]);
  const first = deferred<unknown>();
  let count = 0;
  handlers.set("apply_project", async (args) => {
    count++;
    if (count === 1) await first.promise;
    project = { ...project, ...args.selection };
    return { success: [], failed: [] };
  });
  renderWithProviders(<ProjectsPage />);
  fireEvent.click(await screen.findByText("webapp"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
  expect(updates()).toHaveLength(0);
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Claude Code" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Codex" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Group A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Group B" }));
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "写入项目" }));

  await waitFor(() => expect(updates()).toHaveLength(1));
  await act(async () => first.resolve({}));
  await waitFor(() =>
    expect(calls.filter((c) => c.command === "apply_project")).toHaveLength(1),
  );
  const last = (updates().at(-1)!.args as { selection: typeof project })
    .selection;
  expect(last.skillIds).toEqual(["a", "b"]);
  expect(last.agentIds).toEqual(["claude-code", "codex"]);
  expect(last.groupIds).toEqual(["g1", "g2"]);
});

it("preserves the draft after a failed save, blocks apply, and retries the latest selection", async () => {
  let project = makeProject({ agentIds: ["codex"] });
  handlers.set("list_projects", () => [project]);
  handlers.set("scan_skills", () => [
    makeSkill({ id: "a", name: "Alpha" }),
    makeSkill({ id: "b", name: "Beta" }),
  ]);
  const first = deferred<unknown>();
  let count = 0;
  handlers.set("apply_project", async (args) => {
    count++;
    if (count === 1) await first.promise;
    project = { ...project, ...args.selection };
    return { success: [], failed: [] };
  });
  renderWithProviders(<ProjectsPage />);
  fireEvent.click(await screen.findByText("webapp"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
  expect(updates()).toHaveLength(0);
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
  fireEvent.click(screen.getByRole("button", { name: "写入项目" }));
  await act(async () => first.reject(new Error("disk unavailable")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "disk unavailable",
  );
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "写入项目" }));
  await waitFor(() => expect(updates()).toHaveLength(2));
  expect(
    (updates()[1].args as { selection: typeof project }).selection.skillIds,
  ).toEqual(["a", "b"]);
});

it("confirms unsaved navigation, supports cancel and discard without saving", async () => {
  handlers.set("list_projects", () => [makeProject({ agentIds: ["codex"] })]);
  handlers.set("scan_skills", () => [makeSkill({ id: "a", name: "Alpha" })]);
  renderWithProviders(<ProjectsPage />);
  fireEvent.click(await screen.findByText("webapp"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
  expect(updates()).toHaveLength(0);
  expect(screen.queryByText("选择会自动保存")).toBeNull();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByTitle("返回"));
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "放弃未保存的修改",
  );
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  fireEvent.click(screen.getByTitle("返回"));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }));
  expect(updates()).toHaveLength(0);
  fireEvent.click(await screen.findByText("webapp"));
  expect(
    await screen.findByRole("checkbox", { name: "Alpha" }),
  ).not.toBeChecked();
});

it("does not prompt after successful write", async () => {
  let project = makeProject({ agentIds: ["codex"] });
  handlers.set("list_projects", () => [project]);
  handlers.set("scan_skills", () => [makeSkill({ id: "a", name: "Alpha" })]);
  handlers.set("apply_project", (args) => {
    project = { ...project, ...args.selection };
    return { success: [], failed: [] };
  });
  renderWithProviders(<ProjectsPage />);
  fireEvent.click(await screen.findByText("webapp"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "写入项目" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "写入项目" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByTitle("返回"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(updates()).toHaveLength(1);
});
