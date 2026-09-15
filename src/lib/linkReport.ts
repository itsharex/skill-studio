import { toast } from "sonner";
import type { LinkReport, LinkStatus } from "@/types";

/** 状态对应的中文说明。UI 到处要用，集中一份。 */
export const STATUS_LABEL: Record<LinkStatus, string> = {
  notLinked: "未注册",
  source: "真身在此",
  linked: "已软链",
  copied: "已复制",
  copyStale: "副本过期",
  foreign: "被占用",
  brokenLink: "链接失效",
  conflict: "指向冲突",
};

/** 状态对应的说明文案，hover 时给用户看清到底怎么了 */
export const STATUS_HINT: Record<LinkStatus, string> = {
  notLinked: "这个 agent 还没有这个 skill",
  source: "skill 的真身就存放在这个 agent 的目录里",
  linked: "通过符号链接指向真身，改真身即刻生效",
  copied: "已复制一份副本，内容与真身一致",
  copyStale: "真身已变更，副本是旧的，需要重新复制",
  foreign: "该位置已有非本工具管理的内容，不会被覆盖",
  brokenLink: "符号链接指向的目标已不存在",
  conflict: "该位置的链接指向了别的地方",
};

/** 状态点的颜色。蓝=正常可用，emerald=真身，amber=需处理，红=冲突，灰=未注册 */
export const STATUS_DOT_CLASS: Record<LinkStatus, string> = {
  notLinked: "bg-gray-300 dark:bg-gray-700",
  source: "bg-emerald-500",
  linked: "bg-blue-500",
  copied: "bg-blue-500",
  copyStale: "bg-amber-500",
  foreign: "bg-red-500",
  brokenLink: "bg-red-500",
  conflict: "bg-red-500",
};

/**
 * 把批量操作报告变成一条 toast。
 *
 * 部分失败是常态（比如目标被用户自己的 skill 占用），所以既报成功数也报失败原因，
 * 而不是笼统地说"操作失败"。
 */
export function toastLinkReport(report: LinkReport, verb: string) {
  const ok = report.success.length;
  const bad = report.failed.length;

  if (bad === 0) {
    if (ok === 0) {
      toast.info("没有需要处理的项目");
      return;
    }
    toast.success(`${verb}成功：${ok} 项`);
    return;
  }

  // 相同原因的失败合并展示，避免十几条一模一样的提示
  const reasons = new Map<string, string[]>();
  for (const f of report.failed) {
    const key = f.message ?? STATUS_LABEL[f.status];
    const list = reasons.get(key) ?? [];
    list.push(f.skillName);
    reasons.set(key, list);
  }
  const detail = Array.from(reasons.entries())
    .map(([reason, names]) => `${names.join("、")}：${reason}`)
    .join("\n");

  if (ok === 0) {
    toast.error(`${verb}未完成（${bad} 项）`, { description: detail });
  } else {
    toast.warning(`${verb}部分完成：成功 ${ok}，失败 ${bad}`, {
      description: detail,
    });
  }
}
