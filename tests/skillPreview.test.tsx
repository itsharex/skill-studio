import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { LibraryPage } from "@/pages/LibraryPage";
import { AgentSkills } from "@/pages/AgentPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { renderWithProviders } from "./utils/render";
import {
  handlers,
  calls,
  makeSkill,
  makeProject,
  claudeAgent,
} from "./mocks/tauri";

it("Hub card previews plain text and action buttons do not open preview", async () => {
  handlers.set("scan_skills", () => [makeSkill()]);
  handlers.set("read_skill_document", () => "# Demo\n<script>unsafe</script>");
  renderWithProviders(<LibraryPage />);
  const card = await screen.findByRole("button", { name: "预览 pdf-tools" });
  const buttons = within(card).getAllByRole("button");
  expect(buttons.at(-1)).toHaveAccessibleName("删除 pdf-tools");
  fireEvent.click(
    screen.getByRole("button", { name: "打开 pdf-tools 所在目录" }),
  );
  expect(calls.some((c) => c.command === "read_skill_document")).toBe(false);
  fireEvent.keyDown(card, { key: "Enter" });
  expect(await screen.findByText(/<script>unsafe<\/script>/)).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
});
it("Agent preview reads installed path and displays missing-file errors", async () => {
  handlers.set("list_agents", () => [claudeAgent]);
  const skill = makeSkill();
  skill.agents["claude-code"].targetPath = "/installed/pdf-tools";
  handlers.set("scan_skills", () => [skill]);
  handlers.set("read_skill_document", (args) => {
    expect(args.path).toBe("/installed/pdf-tools");
    throw Error("文件不存在");
  });
  renderWithProviders(<AgentSkills agentId="claude-code" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "预览 pdf-tools" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("文件不存在");
});
it("project preview uses suspended storage and delete remains last without triggering preview", async () => {
  handlers.set("list_projects", () => [makeProject()]);
  handlers.set("list_project_skills", () => [
    {
      name: "local",
      path: "/project/local",
      storagePath: "/backup/payload",
      agentId: "codex",
      disabled: true,
      collected: false,
      managed: false,
      frontmatter: { malformed: false },
    },
  ]);
  handlers.set("read_skill_document", () => "local document");
  renderWithProviders(<ProjectsPage />);
  fireEvent.click(await screen.findByText("webapp"));
  const card = await screen.findByRole("button", { name: "预览 local" });
  expect(within(card).getAllByRole("button").at(-1)).toHaveAccessibleName(
    "删除 local",
  );
  fireEvent.click(screen.getByRole("button", { name: "删除 local" }));
  expect(calls.some((c) => c.command === "read_skill_document")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(card);
  await waitFor(() =>
    expect(
      calls.find((c) => c.command === "read_skill_document")?.args,
    ).toEqual({ path: "/backup/payload" }),
  );
  expect(await screen.findByText("local document")).toBeVisible();
});
