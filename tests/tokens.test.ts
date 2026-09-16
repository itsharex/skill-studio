import { describe, expect, it } from "vitest";
import {
  formatTokens,
  projectSkillIds,
  sumTokens,
  tokenIndex,
} from "@/lib/tokens";
import { makeGroup, makeProject, makeSkill } from "./mocks/tauri";

describe("token 体量汇总", () => {
  const skills = [
    makeSkill({ id: "a", tokens: { skillMd: 400, extras: 100 } }),
    makeSkill({ id: "b", tokens: { skillMd: 1200, extras: 0 } }),
  ];
  const index = tokenIndex(skills);

  it("SKILL.md 与附带文件分别累加，总数是两者之和", () => {
    expect(sumTokens(index, ["a", "b"])).toEqual({
      skillMd: 1600,
      extras: 100,
      total: 1700,
    });
  });

  it("重复 id 只算一次 —— 同一个 skill 既单独绑定又在组里，只占一份文件", () => {
    expect(sumTokens(index, ["a", "b", "a"]).total).toBe(1700);
  });

  it("真身已删的 id 按 0 计，不让整个数字变成 NaN", () => {
    expect(sumTokens(index, ["a", "已缺失"]).total).toBe(500);
  });

  it("项目的口径是「直接绑定 + 分组带进来」的并集", () => {
    const groups = [
      makeGroup({ id: "g1", skillIds: ["a", "b"] }),
      makeGroup({ id: "g2", skillIds: ["b"] }),
    ];
    const project = makeProject({ skillIds: ["a"], groupIds: ["g1", "g2"] });
    expect(projectSkillIds(project, groups).sort()).toEqual(["a", "b"]);
    expect(sumTokens(index, projectSkillIds(project, groups)).total).toBe(1700);
  });

  it("绑定了已删除的分组时按空处理", () => {
    const project = makeProject({ skillIds: ["a"], groupIds: ["没了"] });
    expect(projectSkillIds(project, [])).toEqual(["a"]);
  });

  it.each([
    [0, "0"],
    [820, "820"],
    [1000, "1k"],
    [1240, "1.2k"],
    [9950, "9.9k"],
    // 9.99 → toFixed(1) 是 "10.0"，尾巴上的 .0 要被剪掉，不能显示 "10.0k"
    [9990, "10k"],
    [24400, "24k"],
  ])("徽标格式：%i → %s", (n, expected) => {
    expect(formatTokens(n)).toBe(expected);
  });
});
