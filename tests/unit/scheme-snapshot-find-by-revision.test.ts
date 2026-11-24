/**
 * TASK-J.55：按 scheme_id + 修订号找出已冻结快照（只读，不写盘）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findFrozenSnapshotBySchemeRevision,
  readSchemeSnapshot,
  writeSchemeSnapshot,
  SCHEME_SNAPSHOT_DIR,
} from "../../daemon/pipeline/scheme-snapshot-store";
import { emptySchemeDraft, type DemoGate } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";

const SCHEME_ID = "scheme-j55-unit";
const REVISION = 3;
const plan = { plan_digest: "p".repeat(64) } as unknown as ScopePlan;
const demo: DemoGate = {
  status: "none",
  scheme_revision: null,
  decision_revision: null,
};
const decision = {
  code: "OK" as const,
  message: "ok",
  demo_mode: "none" as const,
};

function scheme(over: { title?: string; scheme_id?: string; scheme_revision?: number } = {}) {
  return emptySchemeDraft({
    scheme_id: over.scheme_id ?? SCHEME_ID,
    scheme_revision: over.scheme_revision ?? REVISION,
    title: over.title ?? "J.55 查找",
    frozen: true,
    modules: ["核心业务模块"],
    notes: "验收通过",
  });
}

function writeFrozen(
  repo: string,
  confirmationId: string,
  options: {
    title?: string;
    scheme_id?: string;
    scheme_revision?: number;
    now?: Date;
  } = {},
) {
  return writeSchemeSnapshot(repo, {
    confirmation_id: confirmationId,
    scheme: scheme(options),
    demo,
    decision,
    scope_plan: plan,
    ...(options.now ? { now: () => options.now as Date } : {}),
  }).snapshot;
}

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "j55-find-by-rev-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("findFrozenSnapshotBySchemeRevision", () => {
  it("目录不存在或零份匹配时找不到", () => {
    expect(findFrozenSnapshotBySchemeRevision(repo, SCHEME_ID, REVISION)).toEqual({
      ok: false,
    });
    fs.mkdirSync(path.join(repo, SCHEME_SNAPSHOT_DIR), { recursive: true });
    expect(findFrozenSnapshotBySchemeRevision(repo, SCHEME_ID, REVISION)).toEqual({
      ok: false,
    });
  });

  it("恰好一份匹配时用之，并忽略不同 scheme_id 或修订号", () => {
    writeFrozen(repo, "scheme-plan-other-id", { scheme_id: "scheme-other" });
    writeFrozen(repo, "scheme-plan-other-rev", { scheme_revision: 2 });
    const hit = writeFrozen(repo, "scheme-plan-j55-one");
    const found = findFrozenSnapshotBySchemeRevision(repo, SCHEME_ID, REVISION);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.snapshot.confirmation_id).toBe("scheme-plan-j55-one");
    expect(found.snapshot.digest).toBe(hit.digest);
    expect(found.snapshot.scheme_revision).toBe(REVISION);
  });

  it("多份 digest 相同则取 created_at 最新；再相同按 confirmation_id 排序", () => {
    writeFrozen(repo, "scheme-plan-j55-older", {
      now: new Date("2026-11-25T00:00:00.000Z"),
    });
    const newer = writeFrozen(repo, "scheme-plan-j55-newer", {
      now: new Date("2026-11-25T01:00:00.000Z"),
    });
    const found = findFrozenSnapshotBySchemeRevision(repo, SCHEME_ID, REVISION);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.snapshot.confirmation_id).toBe("scheme-plan-j55-newer");
    expect(found.snapshot.digest).toBe(newer.digest);
  });

  it("多份 digest 相同且 created_at 相同，按 confirmation_id 排序取最后一份", () => {
    const a = writeFrozen(repo, "scheme-plan-j55-aaa", {
      now: new Date("2026-11-25T02:00:00.000Z"),
    });
    const z = writeFrozen(repo, "scheme-plan-j55-zzz", {
      now: new Date("2026-11-25T02:00:00.000Z"),
    });
    expect(a.digest).toBe(z.digest);
    const found = findFrozenSnapshotBySchemeRevision(repo, SCHEME_ID, REVISION);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.snapshot.confirmation_id).toBe("scheme-plan-j55-zzz");
  });

  it("J55-P4: 同一 scheme_id+修订号多份内容不同的冻结快照 → 视为定位不到", () => {
    const first = writeFrozen(repo, "scheme-plan-j55-alpha", { title: "方案甲" });
    const second = writeFrozen(repo, "scheme-plan-j55-beta", { title: "方案乙" });
    expect(first.digest).not.toBe(second.digest);
    expect(findFrozenSnapshotBySchemeRevision(repo, SCHEME_ID, REVISION)).toEqual({
      ok: false,
    });
    // 查找不得改写或删除已有快照
    const afterA = readSchemeSnapshot(repo, "scheme-plan-j55-alpha");
    const afterB = readSchemeSnapshot(repo, "scheme-plan-j55-beta");
    expect(afterA?.digest).toBe(first.digest);
    expect(afterB?.digest).toBe(second.digest);
    const dir = path.join(repo, SCHEME_SNAPSHOT_DIR);
    expect(fs.readdirSync(dir).sort()).toEqual([
      "scheme-plan-j55-alpha.json",
      "scheme-plan-j55-beta.json",
    ]);
  });

  it("查找不改写已有快照文件内容", () => {
    writeFrozen(repo, "scheme-plan-j55-keep", {
      now: new Date("2026-11-25T00:00:00.000Z"),
    });
    const file = path.join(repo, SCHEME_SNAPSHOT_DIR, "scheme-plan-j55-keep.json");
    const before = fs.readFileSync(file);
    const found = findFrozenSnapshotBySchemeRevision(repo, SCHEME_ID, REVISION);
    expect(found.ok).toBe(true);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});
