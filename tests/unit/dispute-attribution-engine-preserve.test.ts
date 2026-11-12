/**
 * TASK-J.16 · K-14：补丁引擎重建 LedgerState 时必须保留 attributions（否则归因在下一次补丁后丢失）。
 */
import { describe, expect, it } from "vitest";
import {
  expireSuggestionsOnFreeze,
  mergeSchemePatch,
} from "../../src/lib/journey/scheme-patch-engine";
import type {
  AttributionEntry,
  SchemePatch,
} from "../../src/lib/journey/scheme-patch-types";
import {
  ctxCounter,
  makeTranscript,
  state,
} from "../helpers/scheme-patch-fixtures";

const entry: AttributionEntry = {
  attribution_id: "attr-keep",
  trigger: "user_dispute",
  category: "absent_from_diff",
  resolution_note: "差集中没有对应改动",
  created_in_revision: 0,
};

const TR = makeTranscript([
  { seq: 1, role: "user", text: "我要做一个报表工具" },
]);

describe("K-14 引擎保留 attributions", () => {
  it("applied 路径（修订号 +1）保留既有归因条目", () => {
    const st = state({}, { attributions: [entry] });
    const patch = {
      base_revision: st.draft.scheme_revision,
      compiled_from_turns: ["T1"],
      ops: [
        {
          op: "upsert_module",
          item: { id: "M9", name: "报表导出", purpose: "给管理者看" },
          evidence: [{ turn_id: "T1" }],
        },
      ],
    } as unknown as SchemePatch;
    const r = mergeSchemePatch({
      state: st,
      patch,
      transcript: TR.view,
      ctx: ctxCounter(0),
    });
    expect(r.status).toBe("applied");
    if (r.status !== "applied") throw new Error("expected applied");
    expect(r.next.attributions).toEqual([entry]);
  });

  it("冻结作废待决卡时保留归因条目", () => {
    const st = state({}, { attributions: [entry] });
    expect(expireSuggestionsOnFreeze(st).attributions).toEqual([entry]);
  });
});
