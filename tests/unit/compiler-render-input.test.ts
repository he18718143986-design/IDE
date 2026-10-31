/**
 * TASK-J.10：render-input N1～N3、确定性、墓碑不含 revival_keys。
 */
import { describe, expect, it } from "vitest";
import {
  normalizeForCompilerPrompt,
  renderCompilerInput,
} from "../../daemon/supervisor/intent-compiler/render-input";
import { buildTombstone } from "../../src/lib/journey/graveyard-revival";
import {
  aiModule,
  state,
} from "../helpers/scheme-patch-fixtures";

describe("normalizeForCompilerPrompt N1～N3", () => {
  it("N1：\\r\\n / \\r → \\n", () => {
    expect(normalizeForCompilerPrompt("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("N2：删除零宽字符", () => {
    expect(normalizeForCompilerPrompt("a\u200Bb\uFEFFc")).toBe("abc");
  });

  it("N3：按字素 NFKC（全角数字）", () => {
    expect(normalizeForCompilerPrompt("Ａ１")).toBe("A1");
  });

  it("不做 N4：保留普通空白与换行", () => {
    expect(normalizeForCompilerPrompt("a  b\n\tc")).toBe("a  b\n\tc");
  });
});

describe("renderCompilerInput", () => {
  const nonce = "a1b2c3d4";
  const transcript = [
    { turn_id: "T1", role: "user" as const, text: "我要做一个报表工具" },
    { turn_id: "T2", role: "assistant" as const, text: "好的，先确认范围" },
    { turn_id: "T5", role: "user" as const, text: "首页要看板" },
  ];

  const graveyardEntry = buildTombstone({
    rejected_id: "REJ-001",
    proposal: "用 MongoDB 存数据",
    rejected_by: "user",
    rejection_reason: "不要 NoSQL",
    evidence: [],
    disallow_revival: true,
    updated_in_revision: 1,
    rejected_after_turn_seq: 1,
    quotes: ["MongoDB"],
  });

  it("同一状态两次渲染（同 nonce）逐字节相同", () => {
    const st = state(
      { modules: [aiModule("M1", "看板", "展示逾期")] },
      { graveyard: [graveyardEntry] },
    );
    const a = renderCompilerInput({
      state: st,
      transcript,
      batchTurnIds: ["T5"],
      nonce,
    });
    const b = renderCompilerInput({
      state: st,
      transcript,
      batchTurnIds: ["T5"],
      nonce,
    });
    expect(a.prompt).toBe(b.prompt);
    expect(a.ua).toEqual(b.ua);
    expect(a.ub).toEqual(b.ub);
  });

  it("AI 回复无别名；用户有 U 别名", () => {
    const st = state();
    const r = renderCompilerInput({
      state: st,
      transcript,
      batchTurnIds: ["T5"],
      nonce,
    });
    expect(r.prompt).toMatch(/alias="U\d+" role="user"/);
    expect(r.prompt).toMatch(/role="assistant" quotable="no"/);
    expect(r.prompt).not.toMatch(/alias="[^"]+" role="assistant"/);
    expect(r.aliasMap.has("U1") || [...r.aliasMap.keys()].some((k) => k.startsWith("U"))).toBe(
      true,
    );
  });

  it("nonce 出现在 transcript 边界标签", () => {
    const r = renderCompilerInput({
      state: state(),
      transcript,
      batchTurnIds: ["T5"],
      nonce,
    });
    expect(r.prompt).toContain(`<transcript_${nonce}>`);
    expect(r.prompt).toContain(`</transcript_${nonce}>`);
  });

  it("墓碑不含 revival_keys", () => {
    expect(graveyardEntry.revival_keys.length).toBeGreaterThan(0);
    const st = state({}, { graveyard: [graveyardEntry] });
    const r = renderCompilerInput({
      state: st,
      transcript,
      batchTurnIds: ["T5"],
      nonce,
      // 批内文本需触发墓碑选择——含 MongoDB 相关词
      // selectGraveyard 用 batchTexts；T5 是「首页要看板」可能不命中
    });
    // 强制用命中 MongoDB 的批次文本
    const r2 = renderCompilerInput({
      state: st,
      transcript: [
        ...transcript,
        { turn_id: "T9", role: "user", text: "数据量大，要不要 MongoDB" },
      ],
      batchTurnIds: ["T9"],
      nonce,
    });
    expect(r2.prompt).not.toContain("revival_keys");
    expect(r2.rej).toContain("REJ-001");
    // 顺带：原 r 也不应泄漏字段名
    expect(r.prompt).not.toContain("revival_keys");
  });
});
