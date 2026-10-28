/**
 * 墓地逃生口的确定性判定（INV-LEDGER-03，TASK-J.9）。实施口径见 scheme-patch-engine.md §4。
 * 纯函数：零 node:* 导入、零时钟、零随机数、零网络。
 */
import {
  GRAVEYARD_DICE_THRESHOLD,
  NEGATION_WINDOW_GRAPHEMES,
  type GraveyardEntry,
  type QuoteAnchor,
  type RevivalErrorCode,
  type SchemeCollection,
  type TranscriptView,
  type TurnRef,
} from "./scheme-patch-types";
import {
  anchorQuote,
  dice,
  graphemeCount,
  lexemes,
  matchNormalize,
  normalizeForAnchor,
  sentenceAt,
} from "./evidence-anchor";

/** 词表（常量，冻结在代码里；改动须改测试）。匹配作用于 matchNormalize 之后的文本。 */
export const NEGATION_CUES = [
  "不要",
  "不用",
  "不需要",
  "别",
  "甭",
  "不做",
  "不加",
  "去掉",
  "取消",
  "删掉",
  "算了",
  "no",
  "not",
  "don't",
  "dont",
  "without",
  "remove",
  "drop",
] as const;

/** 问句：问号在 matchNormalize 中被删除，故单独检测；其余词条走 matchNormalize 后的子串 */
export const QUESTION_WORDS = [
  "吗",
  "么",
  "呢",
  "要不要",
  "是否",
  "是不是",
  "好不好",
  "行不行",
] as const;

export const AFFIRMATION_CUES = [
  "要",
  "加上",
  "加回",
  "还是",
  "恢复",
  "改回",
  "用回",
  "就用",
  "重新",
  "需要",
  "做",
  "保留",
  "留着",
  "add",
  "bring back",
  "restore",
  "keep",
  "use",
  "need",
] as const;

/** 指纹：key 为 matchNormalize(主文本)，lexemes 为 lexemes(主文本) */
export interface GraveyardFingerprint {
  key: string;
  lexemes: string[];
}

/** 主文本：按条目类别取（§4.2） */
export function mainTextOf(
  collection: SchemeCollection,
  obj: Record<string, unknown>,
): string {
  const s = (k: string) =>
    typeof obj[k] === "string" ? (obj[k] as string) : "";
  switch (collection) {
    case "modules":
      return `${s("name")} ${s("purpose")}`.trim();
    case "goals":
    case "out_of_scope":
    case "acceptance":
    case "open_questions":
      return s("text");
    case "flows":
    case "entities":
      return s("name");
    case "decisions": {
      const chosen =
        typeof obj["chosen"] === "string" ? obj["chosen"] : s("recommended");
      return `${s("question")} ${chosen}`.trim();
    }
    case "conflicts":
      return s("question");
  }
}

export function fingerprintOf(main: string): GraveyardFingerprint {
  return { key: matchNormalize(main), lexemes: lexemes(main) };
}

/** 词表匹配：ASCII 词条要求两侧非字母（避免 know 命中 no）；其余为子串 */
export function hasCue(compact: string, cues: readonly string[]): boolean {
  return cues.some((c) => {
    const n = matchNormalize(c);
    if (n.length === 0) return false;
    if (/^[a-z]+$/.test(n))
      return new RegExp(`(?<![a-z])${n}(?![a-z])`).test(compact);
    return compact.includes(n);
  });
}

function spacedLower(s: string): string {
  return normalizeForAnchor(s).text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * 疑问式惯用语：其中的字符含否定词但语义是提问（「要不要」含「不要」）。
 * 否定判定前先剥离，否则「要不要加 Excel 导出？」会被误判为否定。
 */
const QUESTION_IDIOMS = [
  "要不要",
  "是不是",
  "好不好",
  "行不行",
  "对不对",
] as const;

function stripQuestionIdioms(compact: string): string {
  let s = compact;
  for (const idiom of QUESTION_IDIOMS)
    s = s.split(matchNormalize(idiom)).join("");
  return s;
}

/** 整句否定（P2 确认与 reject_item 使用） */
export function isNegated(sentence: string): boolean {
  return hasCue(stripQuestionIdioms(matchNormalize(sentence)), NEGATION_CUES);
}

/** 问句：含问号，或含疑问词 */
export function isQuestion(sentence: string): boolean {
  const sl = spacedLower(sentence);
  if (/[?？]/.test(sl)) return true;
  return hasCue(sl.replace(/\s+/g, ""), QUESTION_WORDS);
}

// ───────────── 命中判定（§4.2） ─────────────

export interface TombstoneProbe {
  targetId?: string | undefined;
  /** 主文本列表（raise_conflict 含各选项标签） */
  texts: readonly string[];
}

export interface TombstoneMatch {
  hit: boolean;
  via: ("a" | "b" | "c" | "d")[];
}

/**
 * matchesTombstone：(a) 目标 id 相同；(b) 指纹精确相等；(c) Dice ≥ 0.75；(d) 复活关键词（≥4 字素）子串命中。
 * 只检查 status === "active"。
 */
export function matchesTombstone(
  probe: TombstoneProbe,
  entry: GraveyardEntry,
): TombstoneMatch {
  if (entry.status !== "active") return { hit: false, via: [] };
  const via = new Set<"a" | "b" | "c" | "d">();
  if (
    entry.item_ref &&
    probe.targetId !== undefined &&
    probe.targetId === entry.item_ref.id
  )
    via.add("a");
  for (const t of probe.texts) {
    const key = matchNormalize(t);
    if (key.length > 0 && key === entry.fingerprint.key) via.add("b");
    if (dice(lexemes(t), entry.fingerprint.lexemes) >= GRAVEYARD_DICE_THRESHOLD)
      via.add("c");
    for (const rk of entry.revival_keys) {
      if (graphemeCount(rk) >= 4 && key.includes(rk)) via.add("d");
    }
  }
  const out = [...via];
  return { hit: out.length > 0, via: out };
}

// ───────────── 判定（§4.4） ─────────────

export interface RevivalOpView {
  /** 显式复活声明（op.revival 存在）；否则为隐式 */
  explicit: boolean;
  /** 候选证据：显式取 revival.evidence，隐式取 op.evidence（仅 TurnRef） */
  evidence: TurnRef[];
  targetId?: string | undefined;
  texts: readonly string[];
  claimedRevivalId?: string | undefined;
}

export type RevivalAmbiguity = "NO_KEY" | "QUESTION" | "NO_AFFIRMATION";

export type RevivalJudgement =
  | {
      kind: "LEGAL";
      rejected_id: string;
      turn_id: string;
      anchor: QuoteAnchor;
      key: string;
      warnings: "W_REVIVAL_OCCURRENCE_IGNORED"[];
    }
  | {
      kind: "AMBIGUOUS";
      code: "S_REVIVAL_AMBIGUOUS";
      why: RevivalAmbiguity;
      rejected_id: string;
    }
  | { kind: "ILLEGAL"; code: RevivalErrorCode; rejected_id: string };

export interface RevivalInput {
  op: RevivalOpView;
  entry: GraveyardEntry;
  batch: ReadonlySet<string>;
  transcript: TranscriptView;
}

function judgeCandidate(ref: TurnRef, input: RevivalInput): RevivalJudgement {
  const { entry, batch, transcript } = input;
  const id = entry.rejected_id;
  const t = transcript.get(ref.turn_id);
  // R1
  if (!t || t.role !== "user")
    return {
      kind: "ILLEGAL",
      code: "E_EVIDENCE_NOT_USER_TURN",
      rejected_id: id,
    };
  // R2：严格晚于否决
  if (t.seq <= entry.rejected_after_turn_seq)
    return {
      kind: "ILLEGAL",
      code: "E_REVIVAL_NOT_AFTER_REJECTION",
      rejected_id: id,
    };
  // R3：必须来自本批
  if (!batch.has(t.turn_id))
    return {
      kind: "ILLEGAL",
      code: "E_REVIVAL_TURN_NOT_IN_BATCH",
      rejected_id: id,
    };
  // R4：quote 必填，锚点取最后一处（K-12）
  const a = anchorQuote(t, ref, { requireQuote: true, ignoreOccurrence: true });
  if (!a.ok) return { kind: "ILLEGAL", code: a.code, rejected_id: id };
  const warnings: "W_REVIVAL_OCCURRENCE_IGNORED"[] = [];
  if (ref.occurrence !== undefined)
    warnings.push("W_REVIVAL_OCCURRENCE_IGNORED");
  if (a.kind !== "span")
    return { kind: "ILLEGAL", code: "E_QUOTE_REQUIRED", rejected_id: id };

  const anchor = a.anchor;
  const sentence = sentenceAt(t.text, anchor.raw_start, anchor.raw_end);
  const compact = matchNormalize(sentence);
  // R6：锚定句含复活关键词
  const keys = entry.revival_keys.filter((k) => k.length > 0);
  const keyHits: { key: string; at: number }[] = [];
  for (const k of keys) {
    for (let from = 0; ;) {
      const i = compact.indexOf(k, from);
      if (i < 0) break;
      keyHits.push({ key: k, at: i });
      from = i + 1;
    }
  }
  if (keyHits.length === 0)
    return {
      kind: "AMBIGUOUS",
      code: "S_REVIVAL_AMBIGUOUS",
      why: "NO_KEY",
      rejected_id: id,
    };
  // R7：每个关键词左侧窗口内无否定词，否则为明确的反向意图
  for (const { at } of keyHits) {
    const window = stripQuestionIdioms(
      compact.slice(Math.max(0, at - NEGATION_WINDOW_GRAPHEMES), at),
    );
    if (hasCue(window, NEGATION_CUES))
      return { kind: "ILLEGAL", code: "E_REVIVAL_NEGATED", rejected_id: id };
  }
  // R8：非问句
  if (isQuestion(sentence))
    return {
      kind: "AMBIGUOUS",
      code: "S_REVIVAL_AMBIGUOUS",
      why: "QUESTION",
      rejected_id: id,
    };
  // R9：含肯定动作词（先剥离否定词，避免「不要」中的「要」被当成肯定）
  let stripped = compact;
  for (const c of NEGATION_CUES) {
    const n = matchNormalize(c);
    if (n) stripped = stripped.split(n).join("");
  }
  if (!hasCue(stripped, AFFIRMATION_CUES))
    return {
      kind: "AMBIGUOUS",
      code: "S_REVIVAL_AMBIGUOUS",
      why: "NO_AFFIRMATION",
      rejected_id: id,
    };

  return {
    kind: "LEGAL",
    rejected_id: id,
    turn_id: t.turn_id,
    anchor,
    key: keyHits[0]?.key ?? "",
    warnings,
  };
}

/**
 * judgeRevival：六个硬条件（R0–R5）+ 三个明确性条件（R6–R9）。
 * 候选证据任一 LEGAL 即 LEGAL；否则任一 AMBIGUOUS 即 AMBIGUOUS；否则 ILLEGAL。
 * 隐式路径（op 未声明 revival）下，AMBIGUOUS 视为偷渡，直接 ILLEGAL E_PROPOSAL_PREVIOUSLY_REJECTED。
 */
export function judgeRevival(input: RevivalInput): RevivalJudgement {
  const { op, entry } = input;
  const id = entry.rejected_id;
  // R0：门禁否决的墓碑永不经补丁复活（K-5）
  if (entry.rejected_by !== "user")
    return {
      kind: "ILLEGAL",
      code: "E_REVIVAL_SECURITY_LOCKED",
      rejected_id: id,
    };
  // R5：内容必须命中该墓碑，且显式声明的 rejected_id 必须一致
  const probe = matchesTombstone(
    { targetId: op.targetId, texts: op.texts },
    entry,
  );
  if (
    !probe.hit ||
    (op.claimedRevivalId !== undefined && op.claimedRevivalId !== id)
  )
    return {
      kind: "ILLEGAL",
      code: "E_REVIVAL_FINGERPRINT_MISMATCH",
      rejected_id: id,
    };

  let firstAmbiguous: RevivalJudgement | undefined;
  let firstIllegal: RevivalJudgement | undefined;
  for (const ref of op.evidence) {
    const j = judgeCandidate(ref, input);
    if (j.kind === "LEGAL") return j;
    if (j.kind === "AMBIGUOUS" && !firstAmbiguous) firstAmbiguous = j;
    if (j.kind === "ILLEGAL" && !firstIllegal) firstIllegal = j;
  }
  if (op.explicit) {
    return (
      firstAmbiguous ??
      firstIllegal ?? {
        kind: "ILLEGAL",
        code: "E_EVIDENCE_NOT_USER_TURN",
        rejected_id: id,
      }
    );
  }
  if (firstAmbiguous)
    return {
      kind: "ILLEGAL",
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
      rejected_id: id,
    };
  return (
    firstIllegal ?? {
      kind: "ILLEGAL",
      code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
      rejected_id: id,
    }
  );
}

// ───────────── 墓碑构造与迁移（K-4） ─────────────

export interface TombstoneInput {
  rejected_id: string;
  proposal: string;
  rejected_by: "user" | "security_gate";
  rejection_reason: string;
  evidence: GraveyardEntry["evidence"];
  disallow_revival: boolean;
  updated_in_revision: number;
  item_ref?: GraveyardEntry["item_ref"];
  rejected_after_turn_seq: number;
  /** 入墓前用户证据的原话（revival_keys 第二项的来源） */
  quotes: readonly string[];
}

/** revival_keys = 去重排序([fingerprint.key] ∪ {matchNormalize(q) | 字素数 ≥ 2})（§4.3） */
export function revivalKeysOf(
  key: string,
  quotes: readonly string[],
): string[] {
  const set = new Set<string>();
  if (key.length > 0) set.add(key);
  for (const q of quotes) {
    const k = matchNormalize(q);
    if (k.length > 0 && graphemeCount(k) >= 2) set.add(k);
  }
  return [...set].sort();
}

export function buildTombstone(input: TombstoneInput): GraveyardEntry {
  const fp = fingerprintOf(input.proposal);
  return {
    rejected_id: input.rejected_id,
    proposal: input.proposal,
    rejected_by: input.rejected_by,
    rejection_reason: input.rejection_reason,
    evidence: input.evidence,
    disallow_revival: input.disallow_revival,
    updated_in_revision: input.updated_in_revision,
    ...(input.item_ref ? { item_ref: input.item_ref } : {}),
    fingerprint: fp,
    revival_keys: revivalKeysOf(fp.key, input.quotes),
    rejected_after_turn_seq: input.rejected_after_turn_seq,
    status: "active",
  };
}

/**
 * migrateGraveyardEntry：旧数据缺 K-4 字段时确定性补全。与 buildTombstone 对同一输入结果相等（TM-Y-29）。
 * 缺失的 rejected_after_turn_seq 默认 0（信息不足时的保守口径，见 PR 说明）。
 */
export function migrateGraveyardEntry(
  raw: Partial<GraveyardEntry> &
    Pick<GraveyardEntry, "rejected_id" | "proposal">,
): GraveyardEntry {
  const quotes = (raw.evidence ?? []).flatMap((e) =>
    e.kind === "turn" && e.ref.quote !== undefined ? [e.ref.quote] : [],
  );
  return buildTombstone({
    rejected_id: raw.rejected_id,
    proposal: raw.proposal,
    rejected_by: raw.rejected_by ?? "user",
    rejection_reason: raw.rejection_reason ?? "",
    evidence: raw.evidence ?? [],
    disallow_revival: raw.disallow_revival ?? true,
    updated_in_revision: raw.updated_in_revision ?? 0,
    item_ref: raw.item_ref,
    rejected_after_turn_seq: raw.rejected_after_turn_seq ?? 0,
    quotes,
  });
}
