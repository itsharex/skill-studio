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
const updates = () => calls.filter((c) => c.command === "update_project");

it("keeps rapid skill/agent/group selections and waits for all saves before applying", async () => {
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
  handlers.set("update_project", async (args) => {
    count++;
    if (count === 1) await first.promise;
    project = { ...project, ...args };
    return project;
  });
  renderWithProviders(<ProjectsPage />);
  fireEvent.click(await screen.findByText("webapp"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
  await waitFor(() => expect(updates()).toHaveLength(1));
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Claude Code" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Codex" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Group A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Group B" }));
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "写入项目" }));
  expect(calls.some((c) => c.command === "apply_project")).toBe(false);
  expect(updates()).toHaveLength(1);
  await act(async () => first.resolve({}));
  await waitFor(() =>
    expect(calls.filter((c) => c.command === "apply_project")).toHaveLength(1),
  );
  const last = updates().at(-1)!.args as typeof project;
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
  handlers.set("update_project", async (args) => {
    count++;
    if (count === 1) await first.promise;
    project = { ...project, ...args };
    return project;
  });
  renderWithProviders(<ProjectsPage />);
  fireEvent.click(await screen.findByText("webapp"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
  await waitFor(() => expect(updates()).toHaveLength(1));
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
  fireEvent.click(screen.getByRole("button", { name: "写入项目" }));
  await act(async () => first.reject(new Error("disk unavailable")));
  expect(await screen.findByRole("button", { name: "重试保存" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
  expect(calls.some((c) => c.command === "apply_project")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(updates()).toHaveLength(2));
  expect((updates()[1].args as typeof project).skillIds).toEqual(["a", "b"]);
});
