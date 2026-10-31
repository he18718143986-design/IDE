/**
 * 零模型子串校验与锚定（INV-LEDGER-01，TASK-J.9）。实施口径见 scheme-patch-engine.md §3。
 * 纯函数：零 node:* 导入、零时钟、零随机数、零网络。
 *
 * G-MATCH NL 原语（matchNormalize / lexemes / dice）唯一实现在 graveyard-match.ts；
 * 本文件再导出，保持引擎既有导入路径有效（TASK-J.18a）。
 */
import {
  MAX_QUOTE_GRAPHEMES,
  SHORT_QUOTE_GRAPHEMES,
  type AnchorErrorCode,
  type QuoteAnchor,
  type TranscriptTurn,
  type TurnRef,
  type WarningCode,
} from "./scheme-patch-types";
import {
  graphemeCount,
  normalizeForAnchor,
  type NormalizedText,
} from "./text-normalize";

export { graphemeCount, normalizeForAnchor, type NormalizedText };
export { matchNormalize, lexemes, dice } from "./graveyard-match";

/** 整句边界：短引用两侧必须是文本端点或其中之一（NFKC 之后 "…" 变为 "..."，故两者都收） */
const BOUNDARY_SEPS = new Set([
  " ",
  "。",
  "！",
  "？",
  "!",
  "?",
  "；",
  ";",
  "，",
  ",",
  "、",
  "…",
  ".",
  "~",
]);
/** 句界符（用于锚定句切分，作用于原文） */
const SENTENCE_END = new Set([
  "。",
  "！",
  "？",
  "!",
  "?",
  "；",
  ";",
  "\n",
  "\r",
]);

function boundedAt(text: string, pos: number, len: number): boolean {
  const left = pos === 0 || BOUNDARY_SEPS.has(text.charAt(pos - 1));
  const right =
    pos + len === text.length || BOUNDARY_SEPS.has(text.charAt(pos + len));
  return left && right;
}

export type AnchorOutcome =
  | { ok: true; kind: "whole_turn" }
  | { ok: true; kind: "span"; anchor: QuoteAnchor; warnings: WarningCode[] }
  | { ok: false; code: AnchorErrorCode };

/**
 * anchorQuote：在对话原文上锚定 quote（INV-LEDGER-01）。
 * - 无 quote：requireQuote ? E_QUOTE_REQUIRED : whole_turn。
 * - 短引用（< 4 字素）只保留整句边界的出现位置；选取规则在候选上执行（默认最后一处）。
 * - ignoreOccurrence：忽略编译器 occurrence，固定取最后一处（K-12，复活判定路径）。
 */
export function anchorQuote(
  turn: TranscriptTurn,
  ref: TurnRef,
  opts: { requireQuote?: boolean; ignoreOccurrence?: boolean } = {},
): AnchorOutcome {
  if (ref.quote === undefined) {
    return opts.requireQuote
      ? { ok: false, code: "E_QUOTE_REQUIRED" }
      : { ok: true, kind: "whole_turn" };
  }
  const q = normalizeForAnchor(ref.quote).text;
  if (q.length === 0) return { ok: false, code: "E_QUOTE_EMPTY" };
  const qGraphemes = graphemeCount(q);
  if (qGraphemes > MAX_QUOTE_GRAPHEMES)
    return { ok: false, code: "E_QUOTE_TOO_LONG" };

  const h = normalizeForAnchor(turn.text);
  const positions: number[] = [];
  for (let from = 0; ;) {
    const i = h.text.indexOf(q, from);
    if (i < 0) break;
    positions.push(i);
    from = i + 1;
  }
  if (positions.length === 0) return { ok: false, code: "E_QUOTE_NOT_FOUND" };

  const candidates =
    qGraphemes < SHORT_QUOTE_GRAPHEMES
      ? positions.filter((p) => boundedAt(h.text, p, q.length))
      : positions;
  if (candidates.length === 0)
    return { ok: false, code: "E_QUOTE_TOO_SHORT_UNBOUNDED" };

  const explicit = !opts.ignoreOccurrence && ref.occurrence !== undefined;
  const pick = explicit ? (ref.occurrence as number) : candidates.length - 1;
  if (pick < 0 || pick >= candidates.length)
    return { ok: false, code: "E_QUOTE_OCCURRENCE_OUT_OF_RANGE" };

  const ns = candidates[pick] ?? 0;
  const ne = ns + q.length;
  const anchor: QuoteAnchor = {
    kind: "span",
    norm_start: ns,
    norm_end: ne,
    raw_start: h.rawStart[ns] ?? 0,
    raw_end: h.rawEnd[ne - 1] ?? 0,
    occurrence_index: pick,
    occurrence_count: candidates.length,
    turn_text_sha256: turn.text_sha256,
  };
  return {
    ok: true,
    kind: "span",
    anchor,
    warnings: positions.length > 1 ? ["W_QUOTE_MULTI_MATCH"] : [],
  };
}

/** 锚点所在句（作用于原文，句界符见 SENTENCE_END） */
export function sentenceAt(raw: string, start: number, end: number): string {
  let a = start;
  while (a > 0 && !SENTENCE_END.has(raw.charAt(a - 1))) a--;
  let b = end;
  while (b < raw.length && !SENTENCE_END.has(raw.charAt(b))) b++;
  return raw.slice(a, b);
}
