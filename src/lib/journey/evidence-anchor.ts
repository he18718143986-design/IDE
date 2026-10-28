/**
 * 零模型子串校验与锚定（INV-LEDGER-01，TASK-J.9）。实施口径见 scheme-patch-engine.md §3。
 * 纯函数：零 node:* 导入、零时钟、零随机数、零网络。
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

const SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });
const FORMAT_CHARS = /\u200B|\u200C|\u200D|\u2060|\uFEFF|\u00AD/g;
const WS = /\s/;

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

export interface NormalizedText {
  text: string;
  /** rawStart[i]：规范化第 i 个 UTF-16 码元对应的原文起始偏移 */
  rawStart: number[];
  /** rawEnd[i]：对应原文簇的结束偏移（不含） */
  rawEnd: number[];
}

export function graphemeCount(s: string): number {
  return Array.from(SEGMENTER.segment(s)).length;
}

/**
 * normalizeForAnchor：N1 换行统一 → N2 删零宽 → N3 按字素 NFKC → N4 空白折叠 → N5 去首尾空白。
 * 同时为原文构建偏移映射。
 */
export function normalizeForAnchor(raw: string): NormalizedText {
  const units: { ch: string; rs: number; re: number }[] = [];
  for (const { segment, index } of SEGMENTER.segment(raw)) {
    const base = segment === "\r\n" || segment === "\r" ? "\n" : segment;
    const kept = base.replace(FORMAT_CHARS, "");
    if (kept.length === 0) continue;
    const nfkc = kept.normalize("NFKC");
    const end = index + segment.length;
    for (let i = 0; i < nfkc.length; i++)
      units.push({ ch: nfkc.charAt(i), rs: index, re: end });
  }

  let text = "";
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let lastWs = false;
  for (const u of units) {
    if (WS.test(u.ch)) {
      if (lastWs) {
        rawEnd[rawEnd.length - 1] = u.re;
        continue;
      }
      text += " ";
      rawStart.push(u.rs);
      rawEnd.push(u.re);
      lastWs = true;
    } else {
      text += u.ch;
      rawStart.push(u.rs);
      rawEnd.push(u.re);
      lastWs = false;
    }
  }

  let a = 0;
  let b = text.length;
  while (a < b && text[a] === " ") a++;
  while (b > a && text[b - 1] === " ") b--;
  return {
    text: text.slice(a, b),
    rawStart: rawStart.slice(a, b),
    rawEnd: rawEnd.slice(a, b),
  };
}

/** matchNormalize：规范化之后 ASCII 小写，删除全部空白与 \p{P}\p{S}。只用于指纹与关键词比较。 */
export function matchNormalize(s: string): string {
  return normalizeForAnchor(s)
    .text.replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * lexemes：汉字连续段取相邻二元组（长度为 1 的段取单字）；ASCII 字母数字词（长度 ≥ 2）整体作为一个元素。
 * 排序去重后返回。
 */
export function lexemes(s: string): string[] {
  const t = normalizeForAnchor(s).text.replace(/[A-Z]/g, (c) =>
    c.toLowerCase(),
  );
  const out = new Set<string>();
  for (const m of t.matchAll(/[a-z0-9]{2,}/g)) out.add(m[0]);
  for (const m of t.matchAll(/\p{Script=Han}+/gu)) {
    const run = m[0];
    if (run.length === 1) out.add(run);
    else for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return [...out].sort();
}

/** Dice 系数：2|A∩B| / (|A|+|B|)，按集合计；两侧皆空返回 0 */
export function dice(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const denom = sa.size + sb.size;
  if (denom === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return (2 * inter) / denom;
}

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
