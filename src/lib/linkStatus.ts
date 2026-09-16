import type { LinkStatus } from "@/types";

/**
 * 该 agent 真的能用上这个 skill —— 与 Rust 侧 `LinkStatus::is_registered` 对齐。
 * `foreign`（别人放的）、`brokenLink`（悬空）、`conflict`、`copyDamaged` 都不算：
 * 目录里有痕迹，但 agent 用不上，计进"已启用"会虚报。
 */
const REGISTERED: readonly LinkStatus[] = [
  "source",
  "linked",
  "copied",
  "copyStale",
  "copyModified",
  "copyConflict",
];

export function isRegistered(status: LinkStatus): boolean {
  return REGISTERED.includes(status);
}
