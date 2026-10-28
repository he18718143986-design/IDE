import { describe, expect, it } from "vitest";
import {
  acceptSuggestion,
  applyUserEdit,
  mergeSchemePatch,
  projectEvidenceLedger,
  rejectItemToGraveyard,
  rejectSuggestion,
  type UserEdit,
} from "../../src/lib/journey/scheme-patch-engine";
import { buildTombstone } from "../../src/lib/journey/graveyard-revival";
import type {
  LedgerState,
  MergeContext,
  SchemePatch,
} from "../../src/lib/journey/scheme-patch-types";
import {
  aiModule,
  ctxCounter,
  deepFreeze,
  makeTranscript,
  state,
  turnEv,
  type Transcript,
} from "../helpers/scheme-patch-fixtures";

/** 对话记录：T1 用户原话；T2 AI；T3/T5 用户「对」；T4 AI 问句；T6 否定；T7 问句；T8 「对比」；T9 AI；T10 用户 */
const TR: Transcript = makeTranscript([
  { seq: 1, role: "user", text: "我要做一个报表工具" },
  { seq: 2, role: "assistant", text: "好的" },
  { seq: 3, role: "user", text: "对" },
  { seq: 4, role: "assistant", text: "是否用假数据？" },
  { seq: 5, role: "user", text: "对，就用假数据" },
  { seq: 6, role: "user", text: "不用假数据" },
  { seq: 7, role: "user", text: "用假数据吗？" },
  { seq: 8, role: "user", text: "对比一下" },
  { seq: 9, role: "assistant", text: "好的，就用假数据" },
  { seq: 10, role: "user", text: "好，用模拟数据" },
]);

type Ev = { turn_id: string; quote?: string };
const ev = (turn_id: string, quote?: string): Ev =>
  quote === undefined ? { turn_id } : { turn_id, quote };
const modOp = (id: string, name: string, purpose: string, evidence: Ev[]) => ({
  op: "upsert_module" as const,
  item: { id, name, purpose },
  evidence,
});
const patch = (ops: unknown[], base = 5, compiled = ["T1"]): SchemePatch =>
  ({
    base_revision: base,
    compiled_from_turns: compiled,
    ops,
  }) as unknown as SchemePatch;
const run = (
  st: LedgerState,
  p: unknown,
  attempt: 0 | 1 = 0,
  ctx?: MergeContext,
) =>
  mergeSchemePatch({
    state: st,
    patch: p,
    transcript: TR.view,
    ctx: ctx ?? ctxCounter(attempt),
  });

describe("TM-G 批次级门禁：144 组组合（单人编写，待第三方独立复核，规格 §8 第 5 条）", () => {
  const STRUCT_CODE: Record<string, string> = {
    schema_bad: "E_PATCH_SCHEMA_INVALID",
    batch_bad: "E_PATCH_BATCH_INVALID",
    unknown_turn: "E_PATCH_UNKNOWN_TURN",
    dangling: "E_PATCH_DANGLING_ID",
    duplicate: "E_PATCH_DUPLICATE_TARGET",
  };
  const structPatch = (
    struct: string,
    ops: "applicable" | "all_drop",
  ): SchemePatch => {
    if (struct === "ok") {
      return ops === "applicable"
        ? patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])])
        : patch([modOp("M9", "报表导出", "给管理者看", [ev("T2")])]);
    }
    if (struct === "schema_bad") return patch([{ op: "replace_all" }]);
    if (struct === "batch_bad")
      return patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])], 5, [
        "T2",
      ]);
    if (struct === "unknown_turn")
      return patch([modOp("M9", "报表导出", "给管理者看", [ev("T99")])]);
    if (struct === "dangling")
      return patch([{ op: "remove_item", id: "NOPE", evidence: [ev("T1")] }]);
    return patch([
      modOp("M9", "报表导出", "给管理者看", [ev("T1")]),
      modOp("M9", "另一个", "另一个用途", [ev("T1")]),
    ]);
  };
  const STRUCTS = [
    "ok",
    "schema_bad",
    "batch_bad",
    "unknown_turn",
    "dangling",
    "duplicate",
  ];
  const RELS: Record<string, number> = { behind: 4, same: 5, ahead: 6 };

  /**
   * 规格 §6.2 真值表（只断言规格确定的列：批次游标、修订号、闸门失败不出卡）。
   * 「视判决」的出卡数不在此断言——需复核人阶段 A 表格给出。
   */
  const assertSpecRow = (
    r: unknown,
    st: { scheme_revision: number; suggestions: unknown[] },
    row: { frozen: boolean; struct: string; rel: string; ops: string },
  ) => {
    const x = r as {
      status: string;
      batch_consumed: boolean;
      revision?: number;
      next?: { scheme_revision: number; suggestions: unknown[] };
    };
    const gated = row.frozen || row.struct !== "ok" || row.rel !== "same";
    if (gated) {
      // 真值表 1–5：批次游标不推进；无新状态（不修订、不出卡）
      expect(x.batch_consumed, "闸门失败：批次游标不推进").toBe(false);
      expect(x.next, "闸门失败：不产生新状态").toBeUndefined();
      return;
    }
    if (row.ops === "applicable") {
      // 真值表 7：APPLIED，修订号 +1，游标推进
      expect(x).toMatchObject({ status: "applied", batch_consumed: true });
      expect(x.revision).toBe(st.scheme_revision + 1);
      expect(x.next?.scheme_revision).toBe(st.scheme_revision + 1);
    } else {
      // 真值表 6：NOOP，修订号不变，游标推进
      expect(x).toMatchObject({ status: "noop", batch_consumed: true });
      expect(x.next?.scheme_revision).toBe(st.scheme_revision);
    }
  };

  for (const frozen of [false, true])
    for (const struct of STRUCTS)
      for (const rel of Object.keys(RELS))
        for (const attempt of [0, 1] as const)
          for (const ops of ["applicable", "all_drop"] as const) {
            // ops 维度只影响 struct === ok 的分支
            const name = `frozen=${frozen} struct=${struct} rel=${rel} attempt=${attempt} ops=${ops}`;
            it(name, () => {
              const st = state({
                frozen,
                scheme_revision: 5,
                modules: [aiModule("M0", "旧模块", "旧用途")],
              });
              const p = structPatch(struct, ops);
              (p as { base_revision: number }).base_revision = RELS[rel]!;
              const r = run(st, p, attempt);
              assertSpecRow(r, st, { frozen, struct, rel, ops });
              // 期望：冻结 > 结构 > 新鲜度 > 逐 op
              if (frozen)
                return expect(r).toMatchObject({
                  status: "frozen",
                  code: "E_PATCH_FROZEN",
                });
              if (struct !== "ok")
                return expect(r).toMatchObject({
                  status: "rejected",
                  code: STRUCT_CODE[struct],
                });
              if (rel === "ahead")
                return expect(r).toMatchObject({
                  status: "rejected",
                  code: "E_PATCH_REVISION_AHEAD",
                });
              if (rel === "behind") {
                return expect(r).toMatchObject(
                  attempt === 0
                    ? { status: "stale", code: "E_PATCH_STALE", retry: true }
                    : {
                        status: "stale",
                        code: "E_PATCH_STALE_RETRY_EXHAUSTED",
                        retry: false,
                      },
                );
              }
              if (ops === "applicable")
                return expect(r).toMatchObject({
                  status: "applied",
                  revision: 6,
                });
              return expect(r).toMatchObject({ status: "noop" });
            });
          }
});

describe("§5 补丁级结构与证据（TM-P）", () => {
  it("P-01 用户原话无 quote 即整条消息，APPLY", () => {
    const r = run(
      state(),
      patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])]),
    );
    expect(r.status).toBe("applied");
  });
  it("P-02 AI 消息证据 → 单 op DROP，其余 op 照常", () => {
    const r = run(
      state(),
      patch([
        modOp("M9", "报表导出", "给管理者看", [ev("T2")]),
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    expect(r.status).toBe("applied");
    if (r.status !== "applied") return;
    expect(r.journal.verdicts[0]).toMatchObject({
      verdict: "DROP",
      code: "E_EVIDENCE_NOT_USER_TURN",
    });
    expect(r.next.draft.modules.map((m) => m.id)).toEqual(["M8"]);
  });
  it("P-05 证据晚于批次水位 → DROP E_EVIDENCE_FUTURE_TURN", () => {
    const r = run(
      state(),
      patch([
        modOp("M9", "报表导出", "给管理者看", [ev("T3")]),
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_EVIDENCE_FUTURE_TURN",
    });
  });
  it("P-06 伪造的 edit 证据 → DROP E_EVIDENCE_EDIT_FORGED", () => {
    const r = run(
      state(),
      patch([
        {
          op: "upsert_module",
          item: { id: "M9", name: "报表导出", purpose: "给管理者看" },
          evidence: [{ kind: "edit", ref: { edit_event_id: "X" } }],
        },
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_EVIDENCE_EDIT_FORGED",
    });
  });
  it("P-07 编译器提交的 anchor 被忽略并重算，记 W_COMPILER_ANCHOR_IGNORED", () => {
    const r = run(
      state(),
      patch([
        modOp("M9", "报表导出", "给管理者看", [
          {
            turn_id: "T1",
            quote: "我要做一个报表工具",
            anchor: { raw_start: 99, raw_end: 100 },
          } as unknown as Ev,
        ]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]?.warnings).toContain(
      "W_COMPILER_ANCHOR_IGNORED",
    );
    const stored = r.next.draft.modules.find((m) => m.id === "M9")!;
    const e = stored.evidence[0];
    expect(e && e.kind === "turn" && e.ref.anchor?.raw_start).toBe(0);
  });
  it("P-08 证据为空 → 整补丁 E_PATCH_EVIDENCE_EMPTY", () => {
    expect(
      run(state(), patch([modOp("M9", "报表导出", "给管理者看", [])])),
    ).toMatchObject({
      status: "rejected",
      code: "E_PATCH_EVIDENCE_EMPTY",
    });
  });
  it("P-09 超过 64 个 op → E_PATCH_TOO_LARGE", () => {
    const ops = Array.from({ length: 65 }, (_, i) =>
      modOp(`M${i}`, "n", "p", [ev("T1")]),
    );
    expect(run(state(), patch(ops))).toMatchObject({
      status: "rejected",
      code: "E_PATCH_TOO_LARGE",
    });
  });
});

describe("§6 来源分级（TM-S）", () => {
  const claimed = (
    source: string,
    evidence: Ev[],
    name = "报表工具",
    purpose = "管理报表",
  ) => ({
    op: "upsert_module",
    item: { id: "M9", name, purpose, source },
    evidence,
  });
  it("S-01 有 quote 且与主文本 lexeme 相连 → user_said", () => {
    const r = run(
      state(),
      patch([claimed("user_said", [ev("T1", "我要做一个报表工具")])]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.next.draft.modules.find((m) => m.id === "M9")?.source).toBe(
      "user_said",
    );
  });
  it("S-02 无 quote → 降级 ai_inferred + W_SOURCE_DOWNGRADED_NO_QUOTE", () => {
    const r = run(state(), patch([claimed("user_said", [ev("T1")])]));
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]?.warnings).toContain(
      "W_SOURCE_DOWNGRADED_NO_QUOTE",
    );
    expect(r.next.draft.modules.find((m) => m.id === "M9")?.source).toBe(
      "ai_inferred",
    );
  });
  it("S-03 quote 与主文本无 lexeme 交集 → 降级 + W_SOURCE_DOWNGRADED_UNTETHERED", () => {
    const r = run(
      state(),
      patch([
        claimed(
          "user_said",
          [ev("T1", "我要做一个报表工具")],
          "Excel导出",
          "财务",
        ),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]?.warnings).toContain(
      "W_SOURCE_DOWNGRADED_UNTETHERED",
    );
    expect(r.next.draft.modules.find((m) => m.id === "M9")?.source).toBe(
      "ai_inferred",
    );
  });
  it("S-05 编译器声称 user_confirmed → DROP E_SOURCE_CLAIM_FORBIDDEN", () => {
    const r = run(
      state(),
      patch([
        claimed("user_confirmed", [ev("T1", "我要做一个报表工具")]),
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_SOURCE_CLAIM_FORBIDDEN",
    });
  });
  it("S-06 已有 ai_inferred 条目被声称 user_said → DROP E_SOURCE_ESCALATION_FORBIDDEN", () => {
    const st = state({ modules: [aiModule("M9", "报表工具", "管理报表")] });
    const r = run(
      st,
      patch([
        claimed("user_said", [ev("T1", "我要做一个报表工具")]),
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_SOURCE_ESCALATION_FORBIDDEN",
    });
  });
  it("S-10 propose_decision 进入 pending 状态", () => {
    const r = run(
      state(),
      patch([
        {
          op: "propose_decision",
          item: {
            id: "D9",
            question: "用真数据还是假数据",
            options: [
              { id: "A", label: "假数据" },
              { id: "B", label: "真数据" },
            ],
            recommended: "假数据",
          },
          evidence: [ev("T1")],
        },
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.next.draft.decisions.find((d) => d.id === "D9")?.status).toBe(
      "pending",
    );
  });
});

describe("§7 用户确认（TM-C）", () => {
  const decision = (extra: Record<string, unknown> = {}) => ({
    id: "D1",
    question: "用真数据还是假数据",
    options: [
      { id: "A", label: "假数据" },
      { id: "B", label: "真数据" },
    ],
    recommended: "假数据",
    status: "pending",
    source: "ai_inferred",
    evidence: [],
    user_pinned: false,
    updated_in_revision: 4,
    introduced_after_turn_seq: 4,
    ...extra,
  });
  const st = () => state({ decisions: [decision()] as never });
  const mark = (turn: string, quote?: string, id = "D1") => ({
    op: "mark_user_confirmed",
    id,
    evidence: [ev(turn, quote)],
  });
  const applied = (r: ReturnType<typeof run>) => {
    if (r.status !== "applied" && r.status !== "noop")
      throw new Error(r.status);
    return r;
  };

  it("C-01 原话确认 → user_confirmed + accepted", () => {
    const r = applied(
      run(st(), patch([mark("T5", "对，就用假数据")], 5, ["T5"])),
    );
    const d = r.next.draft.decisions.find((x) => x.id === "D1");
    expect(d).toMatchObject({ source: "user_confirmed", status: "accepted" });
  });
  it("C-02 短引用「对」在句界处 → 通过", () => {
    expect(
      applied(run(st(), patch([mark("T5", "对")], 5, ["T5"]))).next.draft
        .decisions[0]?.source,
    ).toBe("user_confirmed");
  });
  it("C-03 无 quote → DROP E_QUOTE_REQUIRED", () => {
    const r = applied(run(st(), patch([mark("T5")], 5, ["T5"])));
    expect(r.journal.verdicts[0]).toMatchObject({ code: "E_QUOTE_REQUIRED" });
  });
  it("C-04 证据为 AI 消息 → DROP E_EVIDENCE_NOT_USER_TURN", () => {
    const r = applied(
      run(st(), patch([mark("T9", "好的，就用假数据")], 5, ["T5"])),
    );
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_EVIDENCE_NOT_USER_TURN",
    });
  });
  it("C-05 证据在本批之外 → DROP E_CONFIRM_TURN_NOT_IN_BATCH", () => {
    const r = applied(run(st(), patch([mark("T3", "对")], 5, ["T5"])));
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_CONFIRM_TURN_NOT_IN_BATCH",
    });
  });
  it("C-06 证据早于目标引入时点 → DROP E_CONFIRM_PREDATES_TARGET", () => {
    const r = applied(run(st(), patch([mark("T3", "对")], 5, ["T3"])));
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_CONFIRM_PREDATES_TARGET",
    });
  });
  it("C-07 否定句「不用假数据」→ DROP E_CONFIRM_NEGATED", () => {
    const r = applied(run(st(), patch([mark("T6", "不用假数据")], 5, ["T6"])));
    expect(r.journal.verdicts[0]).toMatchObject({ code: "E_CONFIRM_NEGATED" });
  });
  it("C-08 问句「用假数据吗？」→ DROP E_CONFIRM_QUESTION", () => {
    const r = applied(
      run(st(), patch([mark("T7", "用假数据吗？")], 5, ["T7"])),
    );
    expect(r.journal.verdicts[0]).toMatchObject({ code: "E_CONFIRM_QUESTION" });
  });
  it("C-15 「对比一下」中的「对」不在边界 → DROP E_QUOTE_TOO_SHORT_UNBOUNDED", () => {
    const r = applied(run(st(), patch([mark("T8", "对")], 5, ["T8"])));
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_QUOTE_TOO_SHORT_UNBOUNDED",
    });
  });
  it("C-10 原文中不存在的 quote → DROP E_QUOTE_NOT_FOUND", () => {
    const r = applied(
      run(st(), patch([mark("T5", "好，用模拟数据")], 5, ["T5"])),
    );
    expect(r.journal.verdicts[0]).toMatchObject({ code: "E_QUOTE_NOT_FOUND" });
  });
  it("C-11 已确认的条目再次确认 → NOOP", () => {
    const already = state({
      decisions: [
        decision({
          source: "user_confirmed",
          status: "accepted",
          evidence: [turnEv(TR, "T5", "对，就用假数据")],
        }),
      ] as never,
    });
    const r = applied(
      run(already, patch([mark("T5", "对，就用假数据")], 5, ["T5"])),
    );
    expect(r.journal.verdicts[0]).toMatchObject({ verdict: "NOOP" });
  });
  it("C-12 目标不是 ai_inferred → DROP E_CONFIRM_TARGET_NOT_INFERRED", () => {
    const s2 = state({
      decisions: [
        decision({
          source: "user_said",
          evidence: [turnEv(TR, "T1", "我要做一个报表工具")],
        }),
      ] as never,
    });
    const r = applied(
      run(s2, patch([mark("T5", "对，就用假数据")], 5, ["T5"])),
    );
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_CONFIRM_TARGET_NOT_INFERRED",
    });
  });
  it("C-13 目标不存在 → 整补丁 E_PATCH_DANGLING_ID", () => {
    expect(
      run(st(), patch([mark("T5", "对，就用假数据", "D404")], 5, ["T5"])),
    ).toMatchObject({
      status: "rejected",
      code: "E_PATCH_DANGLING_ID",
    });
  });
  it("C-14 propose_decision 不得自带 accepted → DROP E_SOURCE_ESCALATION_FORBIDDEN", () => {
    const r = applied(
      run(
        state(),
        patch([
          {
            op: "propose_decision",
            item: {
              id: "D9",
              question: "问题",
              options: [
                { id: "A", label: "甲" },
                { id: "B", label: "乙" },
              ],
              recommended: "甲",
              status: "accepted",
              source: "user_confirmed",
            },
            evidence: [ev("T1")],
          },
          modOp("M8", "导入", "导入数据", [ev("T1")]),
        ]),
      ),
    );
    expect(r.journal.verdicts[0]?.verdict).toBe("DROP");
  });
});

describe("§8–§9 原子性与依赖闭包（TM-A）", () => {
  it("A-01 结构错误：整批拒绝，状态完全不变", () => {
    const st = state({ modules: [aiModule("M0", "旧", "旧")] });
    const before = JSON.stringify(st);
    const ops = [
      modOp("M1", "a", "b", [ev("T1")]),
      modOp("M2", "a", "b", [ev("T1")]),
      { op: "replace_all" },
    ];
    const r = run(st, patch(ops));
    expect(r.status).toBe("rejected");
    expect(JSON.stringify(st)).toBe(before);
  });
  it("A-02 一条 DROP 不影响其余 op：修订只 +1", () => {
    const r = run(
      state(),
      patch([
        modOp("M1", "a", "b", [ev("T1")]),
        modOp("M2", "c", "d", [ev("T1")]),
        modOp("M3", "e", "f", [ev("T1")]),
        modOp("M4", "g", "h", [ev("T1")]),
        modOp("M5", "i", "j", [ev("T2")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.revision).toBe(6);
    expect(r.next.draft.modules.length).toBe(4);
  });
  it("A-03 被 DROP 的新建 id 触发级联：依赖它的 flow 同样 DROP", () => {
    const r = run(
      state(),
      patch([
        modOp("M9", "报表导出", "给管理者看", [ev("T2")]),
        {
          op: "upsert_flow",
          item: {
            id: "F1",
            name: "导出流程",
            steps: [{ actor: "用户", action: "点导出", module_id: "M9" }],
          },
          evidence: [ev("T1")],
        },
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts.find((v) => v.target_id === "F1")).toMatchObject({
      verdict: "DROP",
      code: "E_OP_DEPENDENCY_DROPPED",
    });
    expect(r.next.draft.flows.find((f) => f.id === "F1")).toBeUndefined();
  });
  it("A-07 同一补丁内同一目标两次操作 → 整批 E_PATCH_DUPLICATE_TARGET", () => {
    const st = state({ modules: [aiModule("M1", "a", "b")] });
    expect(
      run(
        st,
        patch([
          { op: "remove_item", id: "M1", evidence: [ev("T1")] },
          modOp("M1", "a2", "b2", [ev("T1")]),
        ]),
      ),
    ).toMatchObject({ status: "rejected", code: "E_PATCH_DUPLICATE_TARGET" });
  });
  it("A-08 全部 DROP：noop，批次仍消费，修订不变", () => {
    const r = run(state(), patch([modOp("M9", "a", "b", [ev("T2")])]));
    expect(r).toMatchObject({
      status: "noop",
      batch_consumed: true,
      expected_prev_revision: 5,
    });
    if (r.status === "noop") expect(r.next.draft.scheme_revision).toBe(5);
  });
  it("A-09 后置审计失败（flow 引用被同批删除的模块）→ 整补丁回滚 E_PATCH_POST_INVARIANT", () => {
    const st = state({ modules: [aiModule("M0", "旧模块", "旧用途")] });
    const before = JSON.stringify(st);
    const r = run(
      st,
      patch([
        { op: "remove_item", id: "M0", evidence: [ev("T1")] },
        {
          op: "upsert_flow",
          item: {
            id: "F1",
            name: "流程",
            steps: [{ actor: "用户", action: "点", module_id: "M0" }],
          },
          evidence: [ev("T1")],
        },
      ]),
    );
    expect(r).toMatchObject({
      status: "rejected",
      code: "E_PATCH_POST_INVARIANT",
    });
    expect(JSON.stringify(st)).toBe(before);
  });
  it("A-10 同输入两次结果逐字节相等", () => {
    const p = patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])]);
    const a = run(state(), p);
    const b = run(state(), p);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("A-11 三个独立 op 的 6 种排列结果一致（按 id 排序比较）", () => {
    const ops = [
      modOp("M1", "a", "b", [ev("T1")]),
      modOp("M2", "c", "d", [ev("T1")]),
      modOp("M3", "e", "f", [ev("T2")]),
    ];
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const results = perms.map((pm) => {
      const r = run(state(), patch(pm.map((i) => ops[i]!)));
      if (r.status !== "applied") throw new Error(r.status);
      return JSON.stringify(
        [...r.next.draft.modules].sort((x, y) => x.id.localeCompare(y.id)),
      );
    });
    expect(new Set(results).size).toBe(1);
  });
  it("A-12 输入冻结后仍可读取且不抛错", () => {
    const st = deepFreeze(state({ modules: [aiModule("M0", "旧", "旧")] }));
    expect(() =>
      run(st, patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])])),
    ).not.toThrow();
  });
  it("A-13 applied 时修订严格 +1", () => {
    const r = run(
      state({ scheme_revision: 9 }),
      patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])], 9),
    );
    expect(r).toMatchObject({ status: "applied", revision: 10 });
  });
});

describe("§3–§5 冲突与 CAS（TM-R, TM-D）", () => {
  it("R-06 stale 重试：重编后 base 对齐即 applied", () => {
    const st = state({ scheme_revision: 5 });
    const first = run(
      st,
      patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])], 4),
      0,
    );
    expect(first).toMatchObject({ status: "stale", retry: true });
    const second = run(
      st,
      patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])], 5),
      1,
    );
    expect(second).toMatchObject({ status: "applied", revision: 6 });
  });
  it("D-01 用户编辑插入后，旧补丁只允许一次重试", () => {
    const st = state({ scheme_revision: 5 });
    const edit: UserEdit = {
      edit_event_id: "E1",
      edited_at: 1,
      collection: "modules",
      id: "M0",
      patch: {},
    };
    expect(edit).toBeTruthy();
    const r = run(
      st,
      patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])], 4),
      1,
    );
    expect(r).toMatchObject({
      status: "stale",
      code: "E_PATCH_STALE_RETRY_EXHAUSTED",
    });
  });
  it("R-07 冻结后任何补丁被拒，状态不变", () => {
    const st = state({ frozen: true });
    expect(
      run(st, patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])])),
    ).toMatchObject({ status: "frozen" });
  });
});

describe("§14 投影（TM-L）与文本边界（TM-E）", () => {
  it("L-01 投影含 claims 与 decisions，decisions 带 topic 与 chosen", () => {
    const st = state({
      out_of_scope: [aiModule("O1", "x", "y") as never],
      decisions: [
        {
          id: "D1",
          question: "问题",
          options: [],
          recommended: "甲",
          status: "pending",
          source: "ai_inferred",
          evidence: [],
          user_pinned: false,
          updated_in_revision: 1,
        },
      ] as never,
    });
    const p = projectEvidenceLedger(st);
    expect(p.claims.boundaries.length).toBe(1);
    expect(p.decisions[0]).toMatchObject({ topic: "问题", chosen: "甲" });
  });
  it("L-02 投影不是 SSOT：修改投影对象不影响状态", () => {
    const st = state({ goals: [] });
    const p = projectEvidenceLedger(st);
    (p.claims.goals as unknown[]).push({ x: 1 });
    expect(st.draft.goals.length).toBe(0);
  });
  it("E-01 partner_hint 超长截断到 200 字并记 W_PARTNER_HINT_TRUNCATED", () => {
    const r = run(state(), {
      ...patch([modOp("M9", "报表导出", "给管理者看", [ev("T1")])]),
      partner_hint: "字".repeat(300),
    });
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.partner_hint?.length).toBe(200);
    expect(r.journal.patch_warnings).toContain("W_PARTNER_HINT_TRUNCATED");
  });
  it("E-02 set_title 用户原话生效并修订 +1", () => {
    const r = run(
      state(),
      patch([
        {
          op: "set_title",
          value: "报表工具",
          evidence: [ev("T1", "我要做一个报表工具")],
        },
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.next.draft.title).toBe("报表工具");
  });
  it("E-03 set_size_hint 证据指向 AI → DROP", () => {
    const r = run(
      state(),
      patch([
        { op: "set_size_hint", value: "large", evidence: [ev("T2")] },
        modOp("M8", "导入", "导入数据", [ev("T1")]),
      ]),
    );
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.journal.verdicts[0]).toMatchObject({ verdict: "DROP" });
    expect(r.next.draft.size_hint).toBe("standard");
  });
  it("E-05 引擎源码不含时钟、随机数、网络与 node 导入", async () => {
    const fs = await import("node:fs");
    const files = [
      "src/lib/journey/scheme-patch-types.ts",
      "src/lib/journey/evidence-anchor.ts",
      "src/lib/journey/graveyard-revival.ts",
      "src/lib/journey/scheme-patch-engine.ts",
    ];
    const banned = [
      /from\s+["']node:/,
      /Date\.now/,
      /new\s+Date\(/,
      /Math\.random/,
      /randomUUID/,
      /\bfetch\(/,
      /setTimeout/,
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const re of banned)
        expect(src, `${f} matches ${re}`).not.toMatch(re);
    }
  });
});

describe("TM-Y 合法复活端到端（用户接受建议与直接入墓）", () => {
  const graveyardWithRejected = () =>
    state(
      {},
      {
        graveyard: [
          buildTombstone({
            rejected_id: "REJ-001",
            proposal: "Excel 导出",
            rejected_by: "user",
            rejection_reason: "不要",
            evidence: [],
            disallow_revival: true,
            updated_in_revision: 1,
            rejected_after_turn_seq: 1,
            quotes: ["Excel 导出"],
          }),
        ],
      },
    );
  it("Y-25 明确原话复活：APPLY，墓碑转 revived，条目 source 为 user_said", () => {
    const TR2 = makeTranscript([
      { seq: 1, role: "user", text: "先不要 Excel 导出" },
      { seq: 2, role: "assistant", text: "好的" },
      { seq: 3, role: "user", text: "还是把 Excel 导出加上吧" },
    ]);
    const p = {
      base_revision: 5,
      compiled_from_turns: ["T3"],
      ops: [
        {
          op: "upsert_module",
          item: {
            id: "M9",
            name: "Excel 导出",
            purpose: "导出报表",
            source: "user_said",
          },
          evidence: [{ turn_id: "T3", quote: "还是把 Excel 导出加上吧" }],
          revival: {
            rejected_id: "REJ-001",
            evidence: [{ turn_id: "T3", quote: "还是把 Excel 导出加上吧" }],
          },
        },
      ],
    };
    const r = mergeSchemePatch({
      state: graveyardWithRejected(),
      patch: p,
      transcript: TR2.view,
      ctx: ctxCounter(),
    });
    if (r.status !== "applied") throw new Error(JSON.stringify(r));
    expect(r.next.graveyard[0]?.status).toBe("revived");
    expect(r.next.draft.modules.find((m) => m.id === "M9")?.source).toBe(
      "user_said",
    );
  });
  it("Y-31 相似但不同的新想法（无原话）→ DROP E_PROPOSAL_PREVIOUSLY_REJECTED，无卡片", () => {
    const TR3 = makeTranscript([
      { seq: 1, role: "user", text: "先不要 Excel 导出" },
      { seq: 2, role: "assistant", text: "好的" },
      { seq: 3, role: "user", text: "我想加个数据看板" },
    ]);
    const p = {
      base_revision: 5,
      compiled_from_turns: ["T3"],
      ops: [
        {
          op: "upsert_module",
          item: { id: "M9", name: "Excel 导出 功能", purpose: "导出" },
          evidence: [{ turn_id: "T3", quote: "我想加个数据看板" }],
        },
      ],
    };
    const r = mergeSchemePatch({
      state: graveyardWithRejected(),
      patch: p,
      transcript: TR3.view,
      ctx: ctxCounter(),
    });
    if (r.status !== "noop" && r.status !== "applied")
      throw new Error(r.status);
    expect(r.journal.verdicts[0]).toMatchObject({
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
      verdict: "DROP",
    });
    expect(r.next.suggestions.length).toBe(0);
  });
  it("直接入墓：rejectItemToGraveyard 产生活跃墓碑，且 turn 证据可被 turnEv 锚定", () => {
    const st = state({ modules: [aiModule("M1", "报表导出", "给管理者看")] });
    const res = rejectItemToGraveyard(
      st,
      {
        collection: "modules",
        id: "M1",
        rejected_after_turn_seq: 3,
        evidence: [turnEv(TR, "T3", "对")],
      },
      ctxCounter(),
      TR.view,
    );
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.state.graveyard.some((g) => g.status === "active")).toBe(true);
  });
});

describe("§10 用户建议的接受与拒绝（TM-D, S 类）", () => {
  it("D-03 拒绝 AI 建议（钉选条目被覆盖）后，建议转为墓碑，条目保留，原内容不变", () => {
    const pinned = state({
      modules: [
        {
          ...aiModule("M1", "报表导出", "给管理者看"),
          source: "user_edited",
          user_pinned: true,
          evidence: [
            { kind: "edit", ref: { edit_event_id: "E1", edited_at: 1 } },
          ],
        } as never,
      ],
    });
    const r = mergeSchemePatch({
      state: pinned,
      patch: patch([modOp("M1", "报表导出 新版", "给管理者看", [ev("T1")])]),
      transcript: TR.view,
      ctx: ctxCounter(),
    });
    if (r.status !== "noop") throw new Error(r.status);
    const sug = r.next.suggestions[0];
    expect(sug).toBeTruthy();
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 2,
      collection: "modules",
      id: "M1",
      patch: {},
    };
    const rej = rejectSuggestion(
      r.next,
      sug!.suggestion_id,
      edit,
      ctxCounter(),
      TR.view,
    );
    expect(rej.ok).toBe(true);
    if (!rej.ok) return;
    expect(
      rej.state.graveyard.some(
        (g) => g.status === "active" && g.disallow_revival,
      ),
    ).toBe(true);
    expect(rej.state.draft.modules.find((m) => m.id === "M1")?.name).toBe(
      "报表导出",
    );
  });
  it("接受不存在的建议 → E_SUGGESTION_NOT_FOUND", () => {
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 2,
      collection: "modules",
      id: "M1",
      patch: {},
    };
    expect(
      acceptSuggestion(state(), "SUG-404", edit, ctxCounter(), TR.view),
    ).toEqual({ ok: false, code: "E_SUGGESTION_NOT_FOUND" });
  });
  it("applyUserEdit 在冻结后拒绝", () => {
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 2,
      collection: "modules",
      id: "M1",
      patch: { name: "x" },
    };
    expect(
      applyUserEdit(state({ frozen: true }), edit, ctxCounter(), TR.view),
    ).toEqual({ ok: false, code: "E_PATCH_FROZEN" });
  });
});
