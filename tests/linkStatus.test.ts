import { describe, expect, it } from "vitest";
import { isCopyDrifted, isRegistered, needsManualFix } from "@/lib/linkStatus";
import { STATUS_LABEL } from "@/lib/linkReport";
import type { LinkStatus } from "@/types";

const ALL = Object.keys(STATUS_LABEL) as LinkStatus[];

describe("链接状态的三个谓词回答的是三个不同的问题", () => {
  it("copyConflict 同时「agent 能加载」和「需要用户处理」，两个谓词不该被统一", () => {
    expect(isRegistered("copyConflict")).toBe(true);
    expect(needsManualFix("copyConflict")).toBe(true);
  });

  it("正常三态既算已启用，也不需要处理", () => {
    for (const status of ["source", "linked", "copied"] as LinkStatus[]) {
      expect([status, isRegistered(status), needsManualFix(status)]).toEqual([
        status,
        true,
        false,
      ]);
    }
  });

  it("有痕迹但 agent 用不上的都不算已启用，且都要提醒检查", () => {
    for (const status of [
      "notLinked",
      "copyDamaged",
      "foreign",
      "brokenLink",
      "conflict",
    ] as LinkStatus[]) {
      expect([status, isRegistered(status), needsManualFix(status)]).toEqual([
        status,
        false,
        true,
      ]);
    }
  });

  it("copyStale / copyModified 算已启用（副本确实在），但不当作需要检查", () => {
    for (const status of ["copyStale", "copyModified"] as LinkStatus[]) {
      expect([status, isRegistered(status), needsManualFix(status)]).toEqual([
        status,
        true,
        false,
      ]);
    }
  });

  it("副本与源不一致的三态被单独识别出来 —— 按源估算的 token 对它们不可信", () => {
    expect(
      ALL.filter(isCopyDrifted).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["copyConflict", "copyModified", "copyStale"]);
  });
});
