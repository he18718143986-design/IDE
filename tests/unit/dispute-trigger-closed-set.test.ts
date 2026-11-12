/**
 * TASK-J.16 · J16-P3：K-16 `attributions.trigger` 闭集、`linked_reason_code` 约束，写入未知值被拒。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reasonCodeSchema } from "../../src/lib/evidence.schema";
import {
  appendAttributionEntries,
  validateAttributionEntry,
} from "../../daemon/supervisor/dispute/attribution-ledger";
import {
  casWriteSchemeLedger,
  emptyLedgerState,
  emptySchemeDraftV2,
  readSchemeLedger,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "k16-trigger-"));
  casWriteSchemeLedger(repo, {
    expectedPrevRevision: 0,
    next: emptyLedgerState({
      draft: emptySchemeDraftV2({ scheme_revision: 0 }),
    }),
    journal: null,
    modelId: null,
    offline: true,
  });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const base = {
  attribution_id: "attr-1",
  trigger: "user_dispute",
  category: "absent_from_diff",
  resolution_note: "差集中没有对应改动",
  created_in_revision: 0,
};

describe("K-16 trigger 闭集", () => {
  it("未知 trigger（如旧值 dispute）被拒，且不写盘", () => {
    const r = appendAttributionEntries(repo, [{ ...base, trigger: "dispute" }]);
    expect(r).toEqual({ ok: false, reason: "unknown_trigger" });
    expect(readSchemeLedger(repo)?.state.attributions).toEqual([]);
  });

  it("三个闭集值均可通过校验", () => {
    for (const trigger of [
      "first_impression",
      "user_dispute",
      "acceptance_fail",
    ]) {
      expect(validateAttributionEntry({ ...base, trigger }).ok).toBe(true);
    }
  });

  it("未知 category 被拒", () => {
    expect(validateAttributionEntry({ ...base, category: "maybe" })).toEqual({
      ok: false,
      reason: "unknown_category",
    });
  });

  it("no_surface_record 是合法 category", () => {
    expect(
      validateAttributionEntry({ ...base, category: "no_surface_record" }).ok,
    ).toBe(true);
  });
});

describe("K-16 linked_reason_code", () => {
  it("仅 acceptance_fail 可带 linked_reason_code", () => {
    const code = reasonCodeSchema.options[0];
    expect(
      validateAttributionEntry({
        ...base,
        trigger: "user_dispute",
        linked_reason_code: code,
      }),
    ).toEqual({
      ok: false,
      reason: "linked_reason_code_requires_acceptance_fail",
    });
    expect(
      validateAttributionEntry({
        ...base,
        trigger: "acceptance_fail",
        linked_reason_code: code,
      }).ok,
    ).toBe(true);
  });

  it("acceptance_fail 下非 reasonCodeSchema 的值被拒", () => {
    expect(
      validateAttributionEntry({
        ...base,
        trigger: "acceptance_fail",
        linked_reason_code: "NOT_A_REASON",
      }),
    ).toEqual({ ok: false, reason: "invalid_linked_reason_code" });
  });
});

describe("K-14 批量写入全有或全无", () => {
  it("批中任一条非法则整批拒绝，已合法的条目也不落盘", () => {
    const r = appendAttributionEntries(repo, [
      { ...base, attribution_id: "ok-1" },
      { ...base, attribution_id: "bad-1", trigger: "other" },
    ]);
    expect(r).toEqual({ ok: false, reason: "unknown_trigger" });
    expect(readSchemeLedger(repo)?.state.attributions).toEqual([]);
  });
});
