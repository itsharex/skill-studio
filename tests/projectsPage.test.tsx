import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProjectsPage } from "@/pages/ProjectsPage";
import {
  claudeAgent,
  codexAgent,
  handlers,
  makeGroup,
  makeProject,
  makeSkill,
} from "./mocks/tauri";
import { renderWithProviders } from "./utils/render";

function setupSkills() {
  handlers.set("list_agents", () => [claudeAgent, codexAgent]);
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
}

it("项目卡片上的 token 体量按「直接绑定 + 绑定分组」去重后合计", async () => {
  setupSkills();
  handlers.set("list_groups", () => [
    makeGroup({ id: "g1", name: "Dev", skillIds: ["a", "b"] }),
  ]);
  handlers.set("list_projects", () => [
    // a 既单独绑定又在 g1 里 —— 只占一份文件，只该算一次
    makeProject({
      id: "p1",
      name: "webapp",
      agentIds: ["claude-code"],
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

it("绑了别的 agent 的分组时不虚报 —— 后端不会为它写任何文件", async () => {
  setupSkills();
  handlers.set("list_groups", () => [
    // 分组选择器会把别的 agent 的分组一并列出，一次点击就能绑上
    makeGroup({
      id: "g1",
      name: "Codex 组",
      agentId: "codex",
      skillIds: ["b"],
    }),
    makeGroup({ id: "g2", name: "旧共享组", agentId: null, skillIds: ["c"] }),
  ]);
  handlers.set("list_projects", () => [
    makeProject({
      id: "p1",
      name: "webapp",
      agentIds: ["claude-code"],
      skillIds: ["a"],
      groupIds: ["g1", "g2"],
    }),
  ]);
  renderWithProviders(<ProjectsPage />);
  // a(500) + 归属为空的旧共享组带进来的 c(900)；归属 codex 的 b(1200) 不算
  expect(await screen.findByText("≈ 1.4k tokens")).toBeInTheDocument();
});

it("还没勾 agent 的项目不显示 token 徽标 —— 此时后端一个文件都不写", async () => {
  setupSkills();
  handlers.set("list_groups", () => [
    makeGroup({ id: "g1", name: "Dev", skillIds: ["a", "b"] }),
  ]);
  handlers.set("list_projects", () => [
    makeProject({
      id: "p1",
      name: "webapp",
      agentIds: [],
      skillIds: ["a"],
      groupIds: ["g1"],
    }),
  ]);
  renderWithProviders(<ProjectsPage />);
  expect(await screen.findByText("webapp")).toBeInTheDocument();
  expect(screen.queryByText(/tokens$/)).toBeNull();
});
