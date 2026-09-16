import type { LinkStatus } from "@/types";

/**
 * 三个谓词共用一张表。
 *
 * 用 `Record<LinkStatus, …>` 而不是几个 `LinkStatus[]`：数组漏掉一个状态只会
 * 静默地把它当 false，将来后端加第 12 个状态时这里会直接编译报错
 * （同目录 linkReport.ts 的几张文案表也是这个理由）。
 *
 * 三列刻意不一致，尤其 `copyConflict` —— 它"能被加载"和"需要用户处理"同时成立，
 * 这不是矛盾，是两个不同的问题，见下面各自的说明。
 */
const TABLE: Record<
  LinkStatus,
  { registered: boolean; manualFix: boolean; drifted: boolean }
> = {
  notLinked: { registered: false, manualFix: true, drifted: false },
  source: { registered: true, manualFix: false, drifted: false },
  linked: { registered: true, manualFix: false, drifted: false },
  copied: { registered: true, manualFix: false, drifted: false },
  copyStale: { registered: true, manualFix: false, drifted: true },
  copyModified: { registered: true, manualFix: false, drifted: true },
  copyConflict: { registered: true, manualFix: true, drifted: true },
  copyDamaged: { registered: false, manualFix: true, drifted: false },
  foreign: { registered: false, manualFix: true, drifted: false },
  brokenLink: { registered: false, manualFix: true, drifted: false },
  conflict: { registered: false, manualFix: true, drifted: false },
};

/**
 * 回答"这个 agent 现在能不能加载到这个 skill" —— 与 Rust 侧
 * `LinkStatus::is_registered` 对齐，用来数"已启用 N 个 skill"。
 *
 * `foreign`（别人放的）、`brokenLink`（悬空）、`conflict`、`copyDamaged` 都不算：
 * 目录里有痕迹，但 agent 用不上，计进"已启用"会虚报。
 * 副本漂移的三态（copyStale / copyModified / copyConflict）都算 —— 副本确实在
 * 那儿、确实会被读进上下文，剔掉反而让数字虚低；只是内容未必是源的内容，
 * 这层不确定性由 `isCopyDrifted` 单独表达。
 */
export function isRegistered(status: LinkStatus): boolean {
  return TABLE[status].registered;
}

/**
 * 回答"这一项必须由人动手才能用" —— 分组卡片上那枚「需要检查」徽标的判定。
 *
 * 和 `isRegistered` 只差 `copyConflict`：源和副本都被改过，agent 照样能加载
 * （所以它 registered），但谁也不知道该保留哪一份，必须由人来合并。
 * 反过来 `notLinked` 是能加载的反面、也得人来处理。
 *
 * **刻意不叫 needsAttention**：Rust 侧 `LinkStatus::needs_attention` 是另一个
 * 更宽的问题（"值不值得在界面上提示一下"），它把 copyStale / copyModified 也算
 * 进去、把 notLinked 排除在外 —— 与这里几乎相反。同名会让人以为两边等价。
 */
export function needsManualFix(status: LinkStatus): boolean {
  return TABLE[status].manualFix;
}

/**
 * 回答"副本内容还等于源吗"。
 *
 * token 估算恒定来自真身（后端 `estimate_skill(&source_path)`），而这三态的定义
 * 恰恰是"副本与源不一致"：源改小了没重新应用，合计会偏高；副本被本地改大了，
 * 合计会偏低。所以计数照旧、但要把这份不确定性说出来。
 */
export function isCopyDrifted(status: LinkStatus): boolean {
  return TABLE[status].drifted;
}
