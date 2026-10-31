import { describe, expect, it } from "vitest";
import {
  acceptSuggestion,
  expireSuggestionsOnFreeze,
  mergeSchemePatch,
  rejectSuggestion,
  type UserEdit,
} from "../../src/lib/journey/scheme-patch-engine";
import { buildTombstone } from "../../src/lib/journey/graveyard-revival";
import type {
  LedgerState,
  SchemePatch,
} from "../../src/lib/journey/scheme-patch-types";
import {
  aiModule,
  ctxCounter,
  makeTranscript,
  state,
  turnEv,
  userModule,
} from "../helpers/scheme-patch-fixtures";

/** 优先级测试对话（TM-Z）：T1 原话；T3 明确复活；T4 疑问；T5 否定 */
const TZ = makeTranscript([
  { seq: 1, role: "user", text: "我要导出报表" },
  { seq: 2, role: "assistant", text: "好的" },
  { seq: 3, role: "user", text: "还是把Excel导出加上吧" },
  { seq: 4, role: "user", text: "要不要加Excel导出？" },
  { seq: 5, role: "user", text: "不要Excel导出了" },
]);

const PROPOSAL = "Excel 导出功能 导出报表";

function graveyardFor(kind: "-" | "H" | "S" | "G") {
  if (kind === "-") return [];
  return [
    buildTombstone({
      rejected_id: "REJ-001",
      proposal: PROPOSAL,
      rejected_by: kind === "G" ? "security_gate" : "user",
      rejection_reason: "用户否决",
      evidence: [],
      disallow_revival: kind !== "S",
      updated_in_revision: 1,
      rejected_after_turn_seq: 1,
      quotes: ["Excel 导出"],
    }),
  ];
}

function zState(pinned: boolean, grave: "-" | "H" | "S" | "G"): LedgerState {
  const m = pinned
    ? {
        ...aiModule("M1", "报表导出", "给管理者看"),
        source: "user_edited" as const,
        user_pinned: true,
        evidence: [
          { kind: "edit" as const, ref: { edit_event_id: "E1", edited_at: 1 } },
        ],
      }
    : aiModule("M1", "报表导出", "给管理者看");
  return state({ modules: [m] }, { graveyard: graveyardFor(grave) });
}

/** rev：'-' 无复活声明（证据为 T1，无关键词）；L/A/I 分别为明确复活、疑问、否定的用户原话 */
function zPatch(rev: "-" | "L" | "A" | "I"): SchemePatch {
  const turn = { "-": "T1", L: "T3", A: "T4", I: "T5" }[rev];
  const quote = {
    "-": "我要导出报表",
    L: "还是把Excel导出加上吧",
    A: "要不要加Excel导出？",
    I: "不要Excel导出了",
  }[rev];
  const op: Record<string, unknown> = {
    op: "upsert_module",
    item: { id: "M1", name: "Excel 导出功能", purpose: "导出报表" },
    evidence: [{ turn_id: turn, quote }],
  };
  if (rev !== "-")
    op["revival"] = {
      rejected_id: "REJ-001",
      evidence: [{ turn_id: turn, quote }],
    };
  return {
    base_revision: 5,
    compiled_from_turns: [turn],
    ops: [op],
  } as unknown as SchemePatch;
}

function zRun(
  pinned: boolean,
  grave: "-" | "H" | "S" | "G",
  rev: "-" | "L" | "A" | "I",
) {
  const r = mergeSchemePatch({
    state: zState(pinned, grave),
    patch: zPatch(rev),
    transcript: TZ.view,
    ctx: ctxCounter(),
  });
  if (r.status !== "applied" && r.status !== "noop")
    throw new Error(`unexpected ${r.status}`);
  return r;
}

describe("TM-Z 优先级：保护路径 > 安全门禁墓碑 > 用户墓碑 > 越界（Z 表）", () => {
  it("Z-01 无钉选、无墓碑 → APPLY", () => {
    const r = zRun(false, "-", "-");
    expect(r.status).toBe("applied");
    expect(r.next.draft.modules[0]?.name).toBe("Excel 导出功能");
  });
  it("Z-02 钉选、无墓碑 → SUGGEST S_OVERRIDE_PINNED", () => {
    const r = zRun(true, "-", "-");
    expect(r.next.suggestions[0]).toMatchObject({ kind: "S_OVERRIDE_PINNED" });
    expect(r.next.draft.modules[0]?.name).toBe("报表导出");
  });
  it("Z-03 未钉选、命中用户墓碑、否定 → DROP，detail 为 E_REVIVAL_NEGATED", () => {
    const r = zRun(false, "H", "I");
    expect(r.next.suggestions.length).toBe(0);
    expect(r.journal.verdicts[0]).toMatchObject({
      verdict: "DROP",
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
      detail: "E_REVIVAL_NEGATED",
    });
  });
  it("Z-04 钉选 × 墓碑 × 否定 → DROP，不出卡（墓地先于钉选）", () => {
    const r = zRun(true, "H", "I");
    expect(r.next.suggestions.length).toBe(0);
    expect(r.journal.verdicts[0]).toMatchObject({ verdict: "DROP" });
  });
  it("Z-05 未钉选 × 墓碑 × 明确复活 → APPLY，墓碑转 revived", () => {
    const r = zRun(false, "H", "L");
    expect(r.status).toBe("applied");
    expect(r.next.graveyard[0]?.status).toBe("revived");
    expect(r.next.draft.modules[0]?.name).toBe("Excel 导出功能");
  });
  it("Z-06 钉选 × 墓碑 × 明确复活 → SUGGEST S_OVERRIDE_PINNED（带复活意图），接受即复活", () => {
    const r = zRun(true, "H", "L");
    const sug = r.next.suggestions[0];
    expect(sug).toMatchObject({ kind: "S_OVERRIDE_PINNED" });
    expect(sug?.revive?.rejected_ids).toEqual(["REJ-001"]);
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 9,
      collection: "modules",
      id: "M1",
      patch: {},
    };
    const acc = acceptSuggestion(
      r.next,
      sug!.suggestion_id,
      edit,
      ctxCounter(),
      TZ.view,
    );
    expect(acc.ok).toBe(true);
    if (acc.ok) {
      expect(acc.state.graveyard[0]?.status).toBe("revived");
      expect(acc.state.draft.modules[0]?.name).toBe("Excel 导出功能");
      expect(acc.state.draft.modules[0]?.user_pinned).toBe(true);
    }
  });
  it("Z-07 未钉选 × 墓碑 × 疑问 → SUGGEST S_REVIVAL_AMBIGUOUS", () => {
    const r = zRun(false, "H", "A");
    expect(r.next.suggestions[0]).toMatchObject({
      kind: "S_REVIVAL_AMBIGUOUS",
    });
  });
  it("Z-08 钉选 × 墓碑 × 疑问 → 一张卡，kind 为 REVIVAL_AMBIGUOUS，reasons 含 PINNED", () => {
    const r = zRun(true, "H", "A");
    expect(r.next.suggestions.length).toBe(1);
    expect(r.next.suggestions[0]).toMatchObject({
      kind: "S_REVIVAL_AMBIGUOUS",
    });
    expect(r.next.suggestions[0]?.reasons).toContain("S_OVERRIDE_PINNED");
  });
  it("Z-09 未钉选 × 软墓碑 → SUGGEST S_GRAVEYARD_SOFT", () => {
    const r = zRun(false, "S", "-");
    expect(r.next.suggestions[0]).toMatchObject({ kind: "S_GRAVEYARD_SOFT" });
  });
  it("Z-10 钉选 × 软墓碑 → kind 为 PINNED，reasons 含 GRAVEYARD_SOFT", () => {
    const r = zRun(true, "S", "-");
    expect(r.next.suggestions[0]).toMatchObject({ kind: "S_OVERRIDE_PINNED" });
    expect(r.next.suggestions[0]?.reasons).toContain("S_GRAVEYARD_SOFT");
  });
  for (const rev of ["-", "L", "I"] as const)
    it(`Z-11 未钉选 × 门禁墓碑 × rev=${rev} → DROP E_REVIVAL_SECURITY_LOCKED（安全门禁不可经补丁复活）`, () => {
      const r = zRun(false, "G", rev);
      expect(r.next.suggestions.length).toBe(0);
      expect(r.journal.verdicts[0]).toMatchObject({
        verdict: "DROP",
        code: "E_REVIVAL_SECURITY_LOCKED",
      });
    });
  for (const rev of ["-", "L", "I"] as const)
    it(`Z-12 钉选 × 门禁墓碑 × rev=${rev} → DROP E_REVIVAL_SECURITY_LOCKED`, () => {
      const r = zRun(true, "G", rev);
      expect(r.next.suggestions.length).toBe(0);
      expect(r.journal.verdicts[0]).toMatchObject({
        verdict: "DROP",
        code: "E_REVIVAL_SECURITY_LOCKED",
      });
    });
});

describe("TM-Z 具名用例（§6.8）", () => {
  it("TM-Z-13 Z-08：每个 op 只产生 1 张卡，kind 为 S_REVIVAL_AMBIGUOUS，reasons 含 S_OVERRIDE_PINNED", () => {
    const r = zRun(true, "H", "A");
    expect(r.next.suggestions).toHaveLength(1);
    expect(r.next.suggestions[0]).toMatchObject({
      kind: "S_REVIVAL_AMBIGUOUS",
    });
    expect(r.next.suggestions[0]?.reasons).toContain("S_OVERRIDE_PINNED");
  });

  it("TM-Z-14 Z-06 采纳：同一修订内条目被覆盖 + 墓碑 revived", () => {
    const r = zRun(true, "H", "L");
    const sug = r.next.suggestions[0];
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 9,
      collection: "modules",
      id: "M1",
      patch: {},
    };
    const acc = acceptSuggestion(
      r.next,
      sug!.suggestion_id,
      edit,
      ctxCounter(),
      TZ.view,
    );
    expect(acc.ok).toBe(true);
    if (!acc.ok) return;
    const rev = acc.state.draft.scheme_revision;
    expect(acc.state.graveyard[0]).toMatchObject({ status: "revived" });
    expect(acc.state.graveyard[0]?.revived?.at_revision).toBe(rev);
    expect(acc.state.draft.modules[0]).toMatchObject({
      name: "Excel 导出功能",
      user_pinned: true,
      updated_in_revision: rev,
    });
  });

  it("TM-Z-15 Z-04：卡片数为 0（被否决的想法不得借覆盖卡重现）", () => {
    const r = zRun(true, "H", "I");
    expect(r.next.suggestions).toHaveLength(0);
    expect(r.journal.verdicts[0]).toMatchObject({ verdict: "DROP" });
  });
});

describe("TM-X 钉选与受保护条目", () => {
  const TX = makeTranscript([
    { seq: 1, role: "user", text: "我要做一个报表工具" },
    { seq: 2, role: "assistant", text: "好的" },
    { seq: 3, role: "user", text: "报表要能导出Excel" },
  ]);
  const pinnedM1 = () =>
    state({
      modules: [
        {
          ...aiModule("M1", "报表", "管理"),
          source: "user_edited",
          user_pinned: true,
          evidence: [
            { kind: "edit", ref: { edit_event_id: "E1", edited_at: 1 } },
          ],
        } as never,
      ],
    });
  const upsert = (name: string, turn: string, quote?: string, base = 5) =>
    ({
      base_revision: base,
      compiled_from_turns: [turn],
      ops: [
        {
          op: "upsert_module",
          item: { id: "M1", name, purpose: "管理", user_visible: true },
          evidence: [
            quote === undefined ? { turn_id: turn } : { turn_id: turn, quote },
          ],
        },
      ],
    }) as unknown as SchemePatch;
  const merge = (st: LedgerState, p: SchemePatch) =>
    mergeSchemePatch({
      state: st,
      patch: p,
      transcript: TX.view,
      ctx: ctxCounter(),
    });

  it("X-01 钉选条目内容被改 → SUGGEST，条目不变", () => {
    const r = merge(pinnedM1(), upsert("报表2", "T3", "报表要能导出Excel"));
    if (r.status !== "noop") throw new Error(r.status);
    expect(r.next.suggestions[0]).toMatchObject({ kind: "S_OVERRIDE_PINNED" });
    expect(r.next.draft.modules[0]?.name).toBe("报表");
  });
  it("X-02 钉选条目内容完全相同 → NOOP，W_NOOP_IDENTICAL", () => {
    const r = merge(pinnedM1(), upsert("报表", "T3", "报表要能导出Excel"));
    if (r.status !== "noop") throw new Error(r.status);
    expect(r.journal.verdicts[0]).toMatchObject({ verdict: "NOOP" });
    expect(r.journal.verdicts[0]?.warnings).toContain("W_NOOP_IDENTICAL");
    expect(r.next.suggestions.length).toBe(0);
  });
  it("X-03 钉选条目被删除 → SUGGEST S_OVERRIDE_PINNED", () => {
    const r = merge(pinnedM1(), {
      base_revision: 5,
      compiled_from_turns: ["T3"],
      ops: [
        {
          op: "remove_item",
          id: "M1",
          evidence: [{ turn_id: "T3", quote: "报表要能导出Excel" }],
        },
      ],
    } as unknown as SchemePatch);
    if (r.status !== "noop") throw new Error(r.status);
    expect(r.next.suggestions[0]).toMatchObject({ kind: "S_OVERRIDE_PINNED" });
    expect(r.next.draft.modules.length).toBe(1);
  });
  it("X-04 用户原话条目（未钉选）被删除 → SUGGEST S_OVERRIDE_PROTECTED", () => {
    const st = state({
      modules: [
        userModule(TX, "M1", "报表", "管理", "T1", "我要做一个报表工具"),
      ],
    });
    const r = merge(st, {
      base_revision: 5,
      compiled_from_turns: ["T3"],
      ops: [
        {
          op: "remove_item",
          id: "M1",
          evidence: [{ turn_id: "T3", quote: "报表要能导出Excel" }],
        },
      ],
    } as unknown as SchemePatch);
    if (r.status !== "noop") throw new Error(r.status);
    expect(r.next.suggestions[0]).toMatchObject({
      kind: "S_OVERRIDE_PROTECTED",
    });
  });
  it("X-06 用户原话条目被更新，但新证据比旧证据新且带原话 → APPLY", () => {
    const st = state({
      modules: [
        userModule(TX, "M1", "报表", "管理", "T1", "我要做一个报表工具"),
      ],
    });
    const r = merge(st, upsert("报表导出", "T3", "报表要能导出Excel"));
    expect(r.status).toBe("applied");
  });
  it("X-07 用户原话条目被更新，但证据不新于旧证据 → SUGGEST S_OVERRIDE_PROTECTED", () => {
    const st = state({
      modules: [
        userModule(TX, "M1", "报表", "管理", "T1", "我要做一个报表工具"),
      ],
    });
    const r = merge(st, upsert("报表导出", "T1", "我要做一个报表工具"));
    if (r.status !== "noop") throw new Error(r.status);
    expect(r.next.suggestions[0]).toMatchObject({
      kind: "S_OVERRIDE_PROTECTED",
    });
  });
  it("X-08 AI 推断条目（未钉选）更新 → APPLY", () => {
    const st = state({ modules: [aiModule("M1", "报表", "管理")] });
    expect(merge(st, upsert("报表导出", "T3")).status).toBe("applied");
  });
  it("X-09 AI 推断条目删除 → APPLY，不入墓", () => {
    const st = state({ modules: [aiModule("M1", "报表", "管理")] });
    const r = merge(st, {
      base_revision: 5,
      compiled_from_turns: ["T3"],
      ops: [{ op: "remove_item", id: "M1", evidence: [{ turn_id: "T3" }] }],
    } as unknown as SchemePatch);
    if (r.status !== "applied") throw new Error(r.status);
    expect(r.next.draft.modules.length).toBe(0);
    expect(r.next.graveyard.length).toBe(0);
  });
  it("X-10 同一建议重复出现 → 去重，W_SUGGESTION_DEDUPED，仍只一张卡", () => {
    const first = merge(pinnedM1(), upsert("报表2", "T3", "报表要能导出Excel"));
    if (first.status !== "noop") throw new Error(first.status);
    const second = merge(
      first.next,
      upsert("报表2", "T3", "报表要能导出Excel"),
    );
    if (second.status !== "noop") throw new Error(second.status);
    expect(second.next.suggestions.length).toBe(1);
    expect(second.journal.verdicts[0]?.warnings).toContain(
      "W_SUGGESTION_DEDUPED",
    );
  });
  it("X-11 接受建议：覆盖钉选条目，钉选标记保留", () => {
    const r = merge(pinnedM1(), upsert("报表2", "T3", "报表要能导出Excel"));
    if (r.status !== "noop") throw new Error(r.status);
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 9,
      collection: "modules",
      id: "M1",
      patch: {},
    };
    const acc = acceptSuggestion(
      r.next,
      r.next.suggestions[0]!.suggestion_id,
      edit,
      ctxCounter(),
      TX.view,
    );
    expect(acc.ok).toBe(true);
    if (acc.ok) {
      expect(acc.state.draft.modules[0]?.name).toBe("报表2");
      expect(acc.state.draft.modules[0]?.user_pinned).toBe(true);
      expect(acc.state.suggestions[0]?.status).toBe("accepted");
    }
  });
  it("X-12 拒绝建议后同一内容再次提出 → DROP E_PROPOSAL_PREVIOUSLY_REJECTED", () => {
    const r = merge(pinnedM1(), upsert("报表2", "T3", "报表要能导出Excel"));
    if (r.status !== "noop") throw new Error(r.status);
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 9,
      collection: "modules",
      id: "M1",
      patch: {},
    };
    const rej = rejectSuggestion(
      r.next,
      r.next.suggestions[0]!.suggestion_id,
      edit,
      ctxCounter(),
      TX.view,
    );
    expect(rej.ok).toBe(true);
    if (!rej.ok) return;
    const again = merge(
      rej.state,
      upsert(
        "报表2",
        "T3",
        "报表要能导出Excel",
        rej.state.draft.scheme_revision,
      ),
    );
    if (again.status !== "noop") throw new Error(again.status);
    expect(again.journal.verdicts[0]).toMatchObject({
      verdict: "DROP",
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
    });
  });
});

describe("TM-D 建议生命周期", () => {
  it("D-02 同一建议连续三次提出 → 始终一张卡", () => {
    let st = state({
      modules: [
        {
          ...aiModule("M1", "报表", "管理"),
          source: "user_edited",
          user_pinned: true,
          evidence: [
            { kind: "edit", ref: { edit_event_id: "E1", edited_at: 1 } },
          ],
        } as never,
      ],
    });
    const p = {
      base_revision: 5,
      compiled_from_turns: ["T3"],
      ops: [
        {
          op: "upsert_module",
          item: { id: "M1", name: "报表2", purpose: "管理" },
          evidence: [{ turn_id: "T3", quote: "报表要能导出Excel" }],
        },
      ],
    } as unknown as SchemePatch;
    const tr = makeTranscript([
      { seq: 1, role: "user", text: "我要做一个报表工具" },
      { seq: 2, role: "assistant", text: "好的" },
      { seq: 3, role: "user", text: "报表要能导出Excel" },
    ]);
    for (let i = 0; i < 3; i++) {
      const r = mergeSchemePatch({
        state: st,
        patch: p,
        transcript: tr.view,
        ctx: ctxCounter(),
      });
      if (r.status !== "noop") throw new Error(r.status);
      st = r.next;
    }
    expect(st.suggestions.length).toBe(1);
  });
  it("D-05 冻结后待处理建议过期，接受返回 E_PATCH_FROZEN", () => {
    const tr = makeTranscript([
      { seq: 1, role: "user", text: "我要做一个报表工具" },
    ]);
    const st = state({
      modules: [
        {
          ...aiModule("M1", "报表", "管理"),
          source: "user_edited",
          user_pinned: true,
          evidence: [
            { kind: "edit", ref: { edit_event_id: "E1", edited_at: 1 } },
          ],
        } as never,
      ],
    });
    const r = mergeSchemePatch({
      state: st,
      patch: {
        base_revision: 5,
        compiled_from_turns: ["T1"],
        ops: [
          {
            op: "upsert_module",
            item: { id: "M1", name: "报表2", purpose: "管理" },
            evidence: [{ turn_id: "T1", quote: "我要做一个报表工具" }],
          },
        ],
      } as unknown as SchemePatch,
      transcript: tr.view,
      ctx: ctxCounter(),
    });
    if (r.status !== "noop") throw new Error(r.status);
    const frozen = expireSuggestionsOnFreeze({
      ...r.next,
      draft: { ...r.next.draft, frozen: true },
    });
    expect(frozen.suggestions[0]?.status).toBe("expired_by_freeze");
    const edit: UserEdit = {
      edit_event_id: "UE1",
      edited_at: 9,
      collection: "modules",
      id: "M1",
      patch: {},
    };
    expect(
      acceptSuggestion(
        frozen,
        frozen.suggestions[0]!.suggestion_id,
        edit,
        ctxCounter(),
        tr.view,
      ),
    ).toEqual({ ok: false, code: "E_PATCH_FROZEN" });
  });
  it("TM-Y-21 辅助：turnEv 与引擎锚定一致（同一原话同一 raw_start）", () => {
    const tr = makeTranscript([
      { seq: 1, role: "user", text: "我要做一个报表工具" },
    ]);
    const ev = turnEv(tr, "T1", "报表工具");
    expect(ev.kind === "turn" && ev.ref.anchor?.raw_start).toBe(5);
  });
});
