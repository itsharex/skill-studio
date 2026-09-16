import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProjectsPage } from "@/pages/ProjectsPage";
import {
  claudeAgent,
  handlers,
  makeGroup,
  makeProject,
  makeSkill,
} from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

it("项目卡片上的 token 体量按「直接绑定 + 绑定分组」去重后合计", async () => {
  handlers.set("list_agents", () => [claudeAgent]);
  handlers.set("scan_skills", () => [
    makeSkill({
      id: "a",
      name: "Alpha",
      tokens: { skillMd: 400, extras: 100 },
    }),
    makeSkill({ id: "b", name: "Beta", tokens: { skillMd: 1200, extras: 0 } }),
    // 没被任何项目用到，不该出现在合计里
    makeSkill({ id: "c", name: "Gamma", tokens: { skillMd: 900, extras: 0 } }),
  ]);
  handlers.set("list_groups", () => [
    makeGroup({ id: "g1", name: "Dev", skillIds: ["a", "b"] }),
  ]);
  handlers.set("list_projects", () => [
    // a 既单独绑定又在 g1 里 —— 只占一份文件，只该算一次
    makeProject({
      id: "p1",
      name: "webapp",
      skillIds: ["a"],
      groupIds: ["g1"],
    }),
    makeProject({ id: "p2", name: "docs", skillIds: [], groupIds: [] }),
  ]);
  renderWithProviders(<ProjectsPage />);
  // 400 + 100（附带文件）+ 1200，Alpha 不因为"既直接绑定又在组里"被数两遍
  expect(await screen.findByText("≈ 1.7k tokens")).toBeInTheDocument();
  // 什么都没绑的项目不显示这个徽标
  expect(screen.getAllByText(/tokens$/)).toHaveLength(1);
});
