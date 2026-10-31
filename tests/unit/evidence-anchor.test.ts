import { describe, expect, it } from "vitest";
import {
  anchorQuote,
  normalizeForAnchor,
  matchNormalize,
  lexemes,
  dice,
  sentenceAt,
} from "../../src/lib/journey/evidence-anchor";
import { sha } from "../helpers/scheme-patch-fixtures";
import type {
  TranscriptTurn,
  TurnRef,
} from "../../src/lib/journey/scheme-patch-types";

/**
 * 实施口径 scheme-patch-engine.md §3（TM-Q / TM-P 的锚定部分）。
 * Q-16、Q-19 按规格 §3.4 勘误口径编写：步骤 5 先过滤（整句边界）、步骤 6 再在候选中选取。
 */
function turn(text: string): TranscriptTurn {
  return { turn_id: "T1", role: "user", seq: 1, text, text_sha256: sha(text) };
}
function anchor(text: string, quote: string, extra: Partial<TurnRef> = {}) {
  return anchorQuote(
    turn(text),
    { turn_id: "T1", quote, ...extra },
    { requireQuote: true },
  );
}
function spanOf(text: string, quote: string, extra: Partial<TurnRef> = {}) {
  const r = anchor(text, quote, extra);
  if (!r.ok || r.kind !== "span")
    throw new Error(`expected span, got ${JSON.stringify(r)}`);
  return r;
}

describe("normalizeForAnchor（§3.2）", () => {
  it("N1 换行统一，CRLF 与 LF 等价（Q-02）", () => {
    expect(normalizeForAnchor("第一行\r\n第二行").text).toBe("第一行 第二行");
    expect(normalizeForAnchor("第一行\n第二行").text).toBe("第一行 第二行");
  });
  it("N2 删零宽字符（Q-06）", () => {
    expect(normalizeForAnchor("登\u200B录").text).toBe("登录");
  });
  it("N3 全角半角等价（Q-05）", () => {
    expect(normalizeForAnchor("ＡＰＩ").text).toBe("API");
  });
  it("N3 组合字符按字素 NFKC（Q-07）", () => {
    expect(normalizeForAnchor("cafe\u0301").text).toBe("café");
  });
  it("N4 连续空白折叠为单个空格（Q-03）", () => {
    expect(normalizeForAnchor("第一行\n\n  第二行").text).toBe("第一行 第二行");
  });
  it("N5 去首尾空白", () => {
    expect(normalizeForAnchor("  导出 ").text).toBe("导出");
  });
  it("偏移映射：折叠空白段映射回原文整段", () => {
    const n = normalizeForAnchor("甲\n\n乙");
    expect(n.text).toBe("甲 乙");
    expect(n.rawStart[1]).toBe(1);
    expect(n.rawEnd[1]).toBe(3);
  });
});

describe("anchorQuote 判例（§3.4 Q-01～Q-23）", () => {
  it("Q-01 精确子串", () => {
    const r = spanOf("我要导出报表", "导出报表");
    expect(r.anchor.raw_start).toBe(2);
    expect(r.anchor.raw_end).toBe(6);
  });
  it("Q-02 CRLF 与 LF 等价", () => {
    expect(anchor("第一行\r\n第二行", "第一行\n第二行").ok).toBe(true);
  });
  it("Q-03 空白折叠", () => {
    expect(anchor("第一行\n\n第二行", "第一行 第二行").ok).toBe(true);
  });
  it("Q-04 首尾空白与内部空白", () => {
    expect(anchor("要  导出", "  要 导出  ").ok).toBe(true);
  });
  it("Q-05 全角半角", () => {
    expect(anchor("调用ＡＰＩ", "调用API").ok).toBe(true);
  });
  it("Q-06 零宽字符", () => {
    expect(anchor("登\u200B录页", "登录页").ok).toBe(true);
  });
  it("Q-07 组合字符", () => {
    expect(anchor("cafe\u0301", "café").ok).toBe(true);
  });
  it("Q-08 释义不通过", () => {
    expect(anchor("我要导出报表", "我想导出报表")).toEqual({
      ok: false,
      code: "E_QUOTE_NOT_FOUND",
    });
  });
  it("Q-09 不折叠大小写", () => {
    expect(anchor("用 Excel", "用 excel")).toEqual({
      ok: false,
      code: "E_QUOTE_NOT_FOUND",
    });
  });
  it("Q-10 不插入空白", () => {
    expect(anchor("导出Excel", "导出 Excel")).toEqual({
      ok: false,
      code: "E_QUOTE_NOT_FOUND",
    });
  });
  it("Q-11 省略号拼接不通过", () => {
    expect(anchor("我要报表，还要导出", "我要报表…导出")).toEqual({
      ok: false,
      code: "E_QUOTE_NOT_FOUND",
    });
  });
  it("Q-12 不做繁简转换", () => {
    expect(anchor("用户登录", "用戶登錄")).toEqual({
      ok: false,
      code: "E_QUOTE_NOT_FOUND",
    });
  });
  it("Q-13 短引用不在整句边界则失败（「对比」中的「对」）", () => {
    expect(anchor("对比一下", "对")).toEqual({
      ok: false,
      code: "E_QUOTE_TOO_SHORT_UNBOUNDED",
    });
  });
  it("Q-14 短引用后接句界符则通过", () => {
    expect(anchor("对，就用假数据", "对").ok).toBe(true);
  });
  it("Q-15 整条消息即整句", () => {
    expect(anchor("对", "对").ok).toBe(true);
  });
  it("Q-16 多处出现：默认取整句边界中的最后一处（按步骤 5 只有第 1 处满足边界）", () => {
    const r = spanOf("导出，先导出再说", "导出");
    expect(r.anchor.occurrence_index).toBe(0);
    expect(r.anchor.occurrence_count).toBe(1);
    expect(r.anchor.raw_start).toBe(0);
    expect(r.warnings).toContain("W_QUOTE_MULTI_MATCH");
  });
  it("Q-17 显式 occurrence 在候选中取值", () => {
    expect(
      spanOf("导出，先导出再说", "导出", { occurrence: 0 }).anchor.raw_start,
    ).toBe(0);
  });
  it("Q-18 occurrence 越界", () => {
    expect(anchor("导出，先导出再说", "导出", { occurrence: 5 })).toEqual({
      ok: false,
      code: "E_QUOTE_OCCURRENCE_OUT_OF_RANGE",
    });
  });
  it("Q-19 重叠出现的短引用：无整句边界的出现位置被过滤，候选为空（§3.4 勘误）", () => {
    expect(anchor("哈哈哈", "哈哈")).toEqual({
      ok: false,
      code: "E_QUOTE_TOO_SHORT_UNBOUNDED",
    });
  });
  it("Q-20 emoji 占 UTF-16 码元，偏移按 UTF-16 计", () => {
    const r = spanOf("👍🏽 好的", "好的");
    expect(r.anchor.raw_start).toBe(5);
    expect(r.anchor.raw_end).toBe(7);
  });
  it("Q-21 规范化后为空", () => {
    expect(anchor("任意", "   ")).toEqual({ ok: false, code: "E_QUOTE_EMPTY" });
  });
  it("Q-22 超过 500 字素", () => {
    expect(anchor("任意", "字".repeat(501))).toEqual({
      ok: false,
      code: "E_QUOTE_TOO_LONG",
    });
  });
  it("Q-23 标点增加即变化", () => {
    expect(anchor("做登录页", "做登录页。")).toEqual({
      ok: false,
      code: "E_QUOTE_NOT_FOUND",
    });
  });
  it("缺失 quote：requireQuote 失败，否则整条消息", () => {
    expect(
      anchorQuote(turn("x"), { turn_id: "T1" }, { requireQuote: true }),
    ).toEqual({ ok: false, code: "E_QUOTE_REQUIRED" });
    expect(anchorQuote(turn("x"), { turn_id: "T1" })).toEqual({
      ok: true,
      kind: "whole_turn",
    });
  });
  it("TM-E-04 仅 \\r 换行的原文，偏移指向原文字符", () => {
    const r = spanOf("第一行\r第二行", "第一行 第二行");
    expect(r.anchor.raw_start).toBe(0);
    expect(r.anchor.raw_end).toBe(7);
  });
  it("锚点哈希与对话记录一致", () => {
    const t = turn("我要导出报表");
    const r = anchorQuote(
      t,
      { turn_id: "T1", quote: "导出报表" },
      { requireQuote: true },
    );
    expect(r.ok && r.kind === "span" && r.anchor.turn_text_sha256).toBe(
      t.text_sha256,
    );
  });
});

describe("辅助函数", () => {
  it("sentenceAt 按句界符切分（原文）", () => {
    const raw = "先不要 Excel 导出。想了想还是加上 Excel 导出";
    const start = raw.lastIndexOf("Excel");
    expect(sentenceAt(raw, start, start + 9)).toBe("想了想还是加上 Excel 导出");
  });
  it("matchNormalize 忽略大小写、空白与标点", () => {
    expect(matchNormalize("Excel 导出！")).toBe("excel导出");
  });
  it("lexemes：汉字二元组、单字、ASCII 词", () => {
    expect(lexemes("Excel 导出")).toEqual(["excel", "导出"]);
    expect(lexemes("用 MongoDB 存数据").sort()).toEqual(
      ["mongodb", "存数", "用", "数据"].sort(),
    );
  });
  it("dice：恰为 0.75 与 0.74 的边界", () => {
    const a = ["a", "b", "c", "d"];
    expect(dice(a, ["a", "b", "c", "x"])).toBe(0.75);
    expect(
      dice(["a", "b", "c", "d", "e"], ["a", "b", "c", "x", "y"]),
    ).toBeCloseTo(0.6);
  });
});
