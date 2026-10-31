import { describe, expect, it } from "vitest";
import {
  buildTombstone,
  judgeRevival,
  matchesTombstone,
  migrateGraveyardEntry,
  type RevivalOpView,
} from "../../src/lib/journey/graveyard-revival";
import type {
  GraveyardEntry,
  TurnRef,
} from "../../src/lib/journey/scheme-patch-types";
import {
  makeTranscript,
  type TurnSpec,
} from "../helpers/scheme-patch-fixtures";

/** 墓碑：否决了「Excel 导出」，否决发生在第 10 条消息之后 */
function tomb(
  over: Partial<Parameters<typeof buildTombstone>[0]> = {},
): GraveyardEntry {
  return buildTombstone({
    rejected_id: "REJ-001",
    proposal: "Excel 导出",
    rejected_by: "user",
    rejection_reason: "不要",
    evidence: [],
    disallow_revival: true,
    updated_in_revision: 1,
    rejected_after_turn_seq: 10,
    quotes: ["Excel 导出"],
    ...over,
  });
}

interface JudgeOpts {
  turnId?: string;
  quote?: string | undefined;
  occurrence?: number;
  explicit?: boolean;
  batch?: string[];
  texts?: string[];
  claimed?: string;
  entry?: GraveyardEntry;
  noQuote?: boolean;
}

/** 构造一条消息并判定（§4.4 路径） */
function judgeOne(turns: TurnSpec[], opts: JudgeOpts = {}) {
  const tr = makeTranscript(turns);
  const turnId = opts.turnId ?? tr.turns[tr.turns.length - 1]!.turn_id;
  const ref: TurnRef = opts.noQuote
    ? { turn_id: turnId }
    : {
        turn_id: turnId,
        quote: opts.quote ?? turns[turns.length - 1]!.text,
        ...(opts.occurrence !== undefined
          ? { occurrence: opts.occurrence }
          : {}),
      };
  const explicit = opts.explicit ?? true;
  const op: RevivalOpView = {
    explicit,
    evidence: [ref],
    texts: opts.texts ?? ["Excel 导出"],
    ...(opts.claimed !== undefined ? { claimedRevivalId: opts.claimed } : {}),
  };
  return judgeRevival({
    op,
    entry: opts.entry ?? tomb(),
    batch: new Set(opts.batch ?? [turnId]),
    transcript: tr.view,
  });
}

describe("§4.4 复活判定（TM-Y，R 表）", () => {
  it("R-01 明确、晚于否决、含关键词、有肯定词 → LEGAL", () => {
    const j = judgeOne([
      { seq: 14, role: "user", text: "还是把 Excel 导出加上吧" },
    ]);
    expect(j.kind).toBe("LEGAL");
  });
  it("R-02 关键词左侧窗口有否定词 → ILLEGAL E_REVIVAL_NEGATED", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "还是不要 Excel 导出" }]),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_REVIVAL_NEGATED",
    });
  });
  it("R-03 问句 → AMBIGUOUS（QUESTION）", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "Excel 导出要不要加？" }]),
    ).toMatchObject({
      kind: "AMBIGUOUS",
      why: "QUESTION",
    });
  });
  it("R-04 无肯定动作词 → AMBIGUOUS（NO_AFFIRMATION）", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "Excel 导出那个" }]),
    ).toMatchObject({
      kind: "AMBIGUOUS",
      why: "NO_AFFIRMATION",
    });
  });
  it("R-05 明确声明但锚定句无复活关键词 → AMBIGUOUS（NO_KEY）", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "刚才否掉的那个还是加上吧" }], {
        quote: "刚才否掉的那个还是加上吧",
        texts: ["Excel 导出"],
      }),
    ).toMatchObject({
      kind: "AMBIGUOUS",
      why: "NO_KEY",
    });
  });
  it("R-06 否决之前的消息（seq 9 ≤ 10）→ ILLEGAL NOT_AFTER_REJECTION", () => {
    expect(
      judgeOne([{ seq: 9, role: "user", text: "要 Excel 导出" }]),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_REVIVAL_NOT_AFTER_REJECTION",
    });
  });
  it("R-07 否决那一条消息本身（seq 10 = 10）→ ILLEGAL NOT_AFTER_REJECTION", () => {
    expect(
      judgeOne([{ seq: 10, role: "user", text: "不要 Excel 导出" }]),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_REVIVAL_NOT_AFTER_REJECTION",
    });
  });
  it("R-08 晚于否决但不在本批 → ILLEGAL TURN_NOT_IN_BATCH", () => {
    expect(
      judgeOne([{ seq: 12, role: "user", text: "要 Excel 导出" }], {
        batch: ["T14"],
      }),
    ).toMatchObject({ kind: "ILLEGAL", code: "E_REVIVAL_TURN_NOT_IN_BATCH" });
  });
  it("R-09 quote 与原文不逐字一致 → ILLEGAL E_QUOTE_NOT_FOUND", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "要 Excel 导出" }], {
        quote: "要 excel 导出",
      }),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_QUOTE_NOT_FOUND",
    });
  });
  it("R-10 无 quote → ILLEGAL E_QUOTE_REQUIRED", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "要 Excel 导出" }], {
        noQuote: true,
      }),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_QUOTE_REQUIRED",
    });
  });
  it("R-11 证据来自 AI 消息 → ILLEGAL E_EVIDENCE_NOT_USER_TURN", () => {
    expect(
      judgeOne([{ seq: 14, role: "assistant", text: "要 Excel 导出" }]),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_EVIDENCE_NOT_USER_TURN",
    });
  });
  it("R-12 门禁否决的墓碑永不复活（K-5）→ E_REVIVAL_SECURITY_LOCKED", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "还是把 Excel 导出加上吧" }], {
        entry: tomb({ rejected_by: "security_gate" }),
      }),
    ).toMatchObject({ kind: "ILLEGAL", code: "E_REVIVAL_SECURITY_LOCKED" });
  });
  it("R-13 内容不命中墓碑 → E_REVIVAL_FINGERPRINT_MISMATCH", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "还是把 Excel 导出加上吧" }], {
        texts: ["PDF 导出"],
      }),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_REVIVAL_FINGERPRINT_MISMATCH",
    });
  });
  it("R-13b 显式 rejected_id 与墓碑不一致 → E_REVIVAL_FINGERPRINT_MISMATCH", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "还是把 Excel 导出加上吧" }], {
        claimed: "REJ-002",
      }),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_REVIVAL_FINGERPRINT_MISMATCH",
    });
  });
  it("R-14 无 occurrence：锚定整句，取最后一处所在句（K-12）", () => {
    const j = judgeOne(
      [
        {
          seq: 14,
          role: "user",
          text: "先不要 Excel 导出。想了想还是加上 Excel 导出",
        },
      ],
      { quote: "Excel 导出" },
    );
    expect(j.kind).toBe("LEGAL");
  });
  it("R-15 显式 occurrence：忽略并记 W_REVIVAL_OCCURRENCE_IGNORED，仍判 LEGAL", () => {
    const j = judgeOne(
      [
        {
          seq: 14,
          role: "user",
          text: "先不要 Excel 导出。想了想还是加上 Excel 导出",
        },
      ],
      { quote: "Excel 导出", occurrence: 0 },
    );
    expect(j).toMatchObject({
      kind: "LEGAL",
      warnings: ["W_REVIVAL_OCCURRENCE_IGNORED"],
    });
  });
  it("R-16 隐式路径：证据句明确复活 → LEGAL", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "还是把 Excel 导出加上吧" }], {
        explicit: false,
      }).kind,
    ).toBe("LEGAL");
  });
  it("R-17 隐式路径：模糊候选即偷渡 → ILLEGAL E_PROPOSAL_PREVIOUSLY_REJECTED", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "我想要报表" }], {
        explicit: false,
        quote: "我想要报表",
        texts: ["Excel 导出"],
      }),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
    });
  });
  it("R-18 无 occurrence 取最后一处：该句含否定词 → ILLEGAL E_REVIVAL_NEGATED", () => {
    expect(
      judgeOne(
        [
          {
            seq: 14,
            role: "user",
            text: "还是加上 Excel 导出。算了，不要 Excel 导出",
          },
        ],
        {
          quote: "Excel 导出",
          occurrence: 0,
        },
      ),
    ).toMatchObject({ kind: "ILLEGAL", code: "E_REVIVAL_NEGATED" });
  });
});

describe("§4.2 命中判定 matchesTombstone（TM-Y 命中部分）", () => {
  it("(a) 目标 id 相同即命中", () => {
    const e = tomb({ item_ref: { collection: "modules", id: "M1" } } as Partial<
      Parameters<typeof buildTombstone>[0]
    >);
    expect(
      matchesTombstone({ targetId: "M1", texts: ["完全无关"] }, e).via,
    ).toContain("a");
  });
  it("(b) 指纹精确相等（忽略大小写与空白）", () => {
    expect(matchesTombstone({ texts: ["excel  导出"] }, tomb()).via).toContain(
      "b",
    );
  });
  it("(c) Dice ≥ 0.75 命中：{excel,导出,功能} vs {excel,导出} = 0.80", () => {
    expect(
      matchesTombstone({ texts: ["Excel 导出 功能"] }, tomb()).via,
    ).toContain("c");
  });
  it("(c) 不相似：MongoDB 存储 vs 用 MongoDB 存数据 = 0.33 不命中", () => {
    const e = tomb({
      proposal: "用 MongoDB 存数据",
      quotes: ["用 MongoDB 存数据"],
      rejected_id: "REJ-M",
    });
    expect(matchesTombstone({ texts: ["MongoDB 存储"] }, e).hit).toBe(false);
  });
  it("(d) 复活关键词 ≥4 字素子串命中", () => {
    const e = tomb({
      proposal: "用 MongoDB 存数据",
      quotes: ["用 MongoDB 存数据"],
      rejected_id: "REJ-M",
    });
    expect(
      matchesTombstone({ texts: ["用 MongoDB 存数据 模块"] }, e).via,
    ).toContain("d");
  });
  it("(d) 关键词不足 4 字素不参与判定", () => {
    const e = tomb({ quotes: ["导出"] });
    expect(matchesTombstone({ texts: ["导出报表"] }, e).hit).toBe(false);
  });
  it("非 active 墓碑不参与命中", () => {
    expect(
      matchesTombstone({ texts: ["Excel 导出"] }, {
        ...tomb(),
        status: "revived",
      } as GraveyardEntry).hit,
    ).toBe(false);
  });
});

describe("§4.3 墓碑构造与迁移（TM-Y-29）", () => {
  it("旧数据迁移结果与同输入 buildTombstone 相等", () => {
    const migrated = migrateGraveyardEntry({
      rejected_id: "REJ-001",
      proposal: "Excel 导出",
      evidence: [
        { kind: "turn", ref: { turn_id: "T14", quote: "Excel 导出" } },
      ],
      rejected_after_turn_seq: 10,
    });
    const built = buildTombstone({
      rejected_id: "REJ-001",
      proposal: "Excel 导出",
      rejected_by: "user",
      rejection_reason: "",
      evidence: [
        { kind: "turn", ref: { turn_id: "T14", quote: "Excel 导出" } },
      ],
      disallow_revival: true,
      updated_in_revision: 0,
      rejected_after_turn_seq: 10,
      quotes: ["Excel 导出"],
    });
    expect(migrated).toEqual(built);
  });
});

describe("疑问式惯用语不构成否定（修复「要不要」误判）", () => {
  it("R-03b「要不要加 Excel 导出」在关键词前有「要不要」→ AMBIGUOUS QUESTION，而非 NEGATED", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "要不要加Excel导出？" }]),
    ).toMatchObject({
      kind: "AMBIGUOUS",
      why: "QUESTION",
    });
  });
  it("真否定仍然判 NEGATED：「不要加 Excel 导出」", () => {
    expect(
      judgeOne([{ seq: 14, role: "user", text: "不要加Excel导出" }]),
    ).toMatchObject({
      kind: "ILLEGAL",
      code: "E_REVIVAL_NEGATED",
    });
  });
});
