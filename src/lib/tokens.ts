import type { Group, ProjectBinding, SkillView, TokenEstimate } from "@/types";

/**
 * token 体量估算的前端侧汇总。
 *
 * 每个 skill 的估算值由后端在扫描时算好（`services::tokens`），这里只负责按分组 /
 * 项目 / agent 把它们加起来 —— 口径集中在一处，前后端不会算出两个数。
 *
 * 两半分开保留：`SKILL.md` 被调用时必然进上下文，`references/` 之类是按需打开的，
 * 合计给个总数，tooltip 里再拆开说明。
 */

export interface TokenSum extends TokenEstimate {
  total: number;
}

const EMPTY: TokenEstimate = { skillMd: 0, extras: 0 };

/** skill id → 估算值。查表比每次 `skills.find` 少一层嵌套遍历。 */
export function tokenIndex(skills: SkillView[]): Map<string, TokenEstimate> {
  return new Map(skills.map((s) => [s.id, s.tokens ?? EMPTY]));
}

/** 汇总一批 skill id；重复 id 只算一次，真身已删的按 0 计。 */
export function sumTokens(
  index: Map<string, TokenEstimate>,
  ids: Iterable<string>,
): TokenSum {
  let skillMd = 0;
  let extras = 0;
  for (const id of new Set(ids)) {
    const est = index.get(id);
    if (!est) continue;
    skillMd += est.skillMd;
    extras += est.extras;
  }
  return { skillMd, extras, total: skillMd + extras };
}

/**
 * 一个项目实际会用到的 skill：直接绑定的 + 绑定分组带进来的，按 id 去重。
 * 同一个 skill 既单独绑定又在组里，只占一份文件，也只该算一次 token。
 */
export function projectSkillIds(
  project: ProjectBinding,
  groups: Group[],
): string[] {
  const ids = new Set(project.skillIds);
  for (const groupId of project.groupIds) {
    const group = groups.find((g) => g.id === groupId);
    for (const id of group?.skillIds ?? []) ids.add(id);
  }
  return [...ids];
}

/** 徽标用的短格式：820 / 1.2k / 24k */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k < 10 ? `${k.toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(k)}k`;
}

/** hover 说明：这个数字是怎么来的，以及两半各占多少 */
export function tokenTitle(sum: TokenSum, scope: string): string {
  return (
    `${scope}的 token 估算：SKILL.md ≈ ${formatTokens(sum.skillMd)}，` +
    `references / scripts 等文本附带文件 ≈ ${formatTokens(sum.extras)}。` +
    `二进制文件与隐藏文件不计，软链不重复计算。估算值，非精确分词。`
  );
}
