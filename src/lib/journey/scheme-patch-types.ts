/**
 * SchemePatch 合并引擎：类型、Schema、码表与常量（TASK-J.9）。
 *
 * 实施口径见 docs/specs/scheme-patch-engine.md §5.2–§5.3；上位规格为 supervisor.md §14.2、§14.3、§14.11。
 * 本文件零 node:* 导入、零时钟、零随机数、零网络（同 scheme-patch-engine.ts 纪律）。
 */
import { z } from "zod";

// ───────────── 对话记录（只读视图，由调用方提供） ─────────────

export interface TranscriptTurn {
  turn_id: string;
  role: "user" | "assistant" | "system";
  /** 单调递增，全局唯一 */
  seq: number;
  /** 原文，提交后不可变 */
  text: string;
  /** 由 Daemon 计算（引擎不算哈希，保持零 node 依赖） */
  text_sha256: string;
}

export interface TranscriptView {
  get(turn_id: string): TranscriptTurn | undefined;
}

// ───────────── 证据 ─────────────

export interface QuoteAnchor {
  kind: "span";
  norm_start: number;
  norm_end: number;
  /** UTF-16 偏移，供 UI 高亮 */
  raw_start: number;
  raw_end: number;
  occurrence_index: number;
  occurrence_count: number;
  turn_text_sha256: string;
}

/** 引擎内部使用的对话引用；`anchor` 只由引擎写入 */
export interface TurnRef {
  turn_id: string;
  quote?: string;
  /** 编译器可选提示（0 起） */
  occurrence?: number;
  anchor?: QuoteAnchor;
}

export interface EditRef {
  edit_event_id: string;
  edited_at: number;
  field_name?: string;
  previous_value?: string;
}

export type EvidenceItem =
  { kind: "turn"; ref: TurnRef } | { kind: "edit"; ref: EditRef };

/** 编译器 op 中允许出现的证据：turn 引用，或被识别为伪造的 edit 形状（K-1） */
export type CompilerEvidence =
  TurnRef | { kind: "edit"; ref: Record<string, unknown> };

// 与 supervisor.md §14.2 ItemSource 同形
export type ItemSource =
  "user_said" | "user_confirmed" | "ai_inferred" | "user_edited";

export interface SchemeItemMeta {
  id: string;
  source: ItemSource;
  evidence: EvidenceItem[];
  user_pinned: boolean;
  updated_in_revision: number;
  /** K-8，引擎自有；编译器提交的同名字段一律忽略 */
  introduced_after_turn_seq?: number;
}

export type SchemeCollection =
  | "goals"
  | "out_of_scope"
  | "modules"
  | "flows"
  | "entities"
  | "decisions"
  | "conflicts"
  | "open_questions"
  | "acceptance";

export type WithText = SchemeItemMeta & { text: string };

export interface SchemeDraftV2 {
  scheme_id: string;
  scheme_revision: number;
  frozen: boolean;
  title: string;
  summary: string;
  audience: string | null;
  size_hint: "tiny" | "standard" | "large";
  goals: WithText[];
  out_of_scope: WithText[];
  modules: (SchemeItemMeta & {
    name: string;
    purpose: string;
    user_visible: boolean;
    kind: "new" | "change_existing";
    project_anchor?: string;
  })[];
  flows: (SchemeItemMeta & {
    name: string;
    steps: { actor: string; action: string; module_id?: string }[];
  })[];
  entities: (SchemeItemMeta & { name: string; fields_hint: string[] })[];
  decisions: (SchemeItemMeta & {
    question: string;
    recommended: string;
    alternatives: string[];
    rationale: string;
    risk: "low" | "high";
    status: "pending" | "accepted" | "changed";
    chosen?: string;
  })[];
  conflicts: (SchemeItemMeta & {
    question: string;
    options: { id: string; label: string; evidence: TurnRef[] }[];
    chosen_id: string | null;
  })[];
  open_questions: WithText[];
  acceptance: WithText[];
}

// ───────────── 墓地（§14.11 RejectedAlternative + K-4） ─────────────

export interface GraveyardEntry {
  rejected_id: string;
  proposal: string;
  rejected_by: "user" | "security_gate";
  rejection_reason: string;
  evidence: EvidenceItem[];
  disallow_revival: boolean;
  updated_in_revision: number;
  item_ref?: { collection: SchemeCollection; id: string };
  fingerprint: { key: string; lexemes: string[] };
  revival_keys: string[];
  rejected_after_turn_seq: number;
  status: "active" | "revived";
  revived?: { turn_id: string; anchor: QuoteAnchor; at_revision: number };
}

// ───────────── 卡片 ─────────────

export type SuggestionKind =
  | "S_REVIVAL_AMBIGUOUS"
  | "S_OVERRIDE_PINNED"
  | "S_OVERRIDE_PROTECTED"
  | "S_GRAVEYARD_SOFT";

export interface SuggestionRevive {
  rejected_ids: string[];
  turn_id: string;
  anchor: QuoteAnchor;
}

export interface Suggestion {
  suggestion_id: string;
  /** 表 C 最高者 */
  kind: SuggestionKind;
  /** 全部触发原因 */
  reasons: SuggestionKind[];
  target?: { collection: SchemeCollection; id: string };
  /** 原 op（编译器 anchor 已去掉） */
  op: SchemeOp;
  /** 已锚定的证据（引擎重算锚点） */
  evidence: EvidenceItem[];
  op_fingerprint: string;
  tombstone_ids: string[];
  created_in_revision: number;
  /** 证据消息中最大的 seq；拒绝入墓时作为 rejected_after_turn_seq */
  source_seq: number;
  /** 判定为合法复活时，采纳即复活这些墓碑 */
  revive?: SuggestionRevive;
  status: "pending" | "accepted" | "rejected" | "expired_by_freeze";
}

// ───────────── 引擎状态 ─────────────

export interface LedgerState {
  draft: SchemeDraftV2;
  graveyard: GraveyardEntry[];
  suggestions: Suggestion[];
}

// ───────────── 补丁（§14.3 + 可选 revival） ─────────────

export interface RevivalClaim {
  rejected_id: string;
  evidence: TurnRef[];
}

export type ItemPayload = Record<string, unknown> & {
  id: string;
  source?: ItemSource;
};

export type SchemeOp =
  | {
      op: "set_title" | "set_summary" | "set_audience";
      value: string;
      evidence: CompilerEvidence[];
      revival?: RevivalClaim;
    }
  | {
      op:
        | "upsert_module"
        | "upsert_flow"
        | "upsert_entity"
        | "upsert_goal"
        | "upsert_out_of_scope"
        | "upsert_acceptance";
      item: ItemPayload;
      evidence: CompilerEvidence[];
      revival?: RevivalClaim;
    }
  | {
      op: "remove_item";
      id: string;
      reason?: string;
      evidence: CompilerEvidence[];
    }
  | {
      op: "reject_item";
      id: string;
      reason?: string;
      evidence: CompilerEvidence[];
    }
  | {
      op: "propose_decision" | "raise_conflict";
      item: ItemPayload;
      evidence: CompilerEvidence[];
      revival?: RevivalClaim;
    }
  | { op: "mark_user_confirmed"; id: string; evidence: CompilerEvidence[] }
  | { op: "add_open_question"; text: string; evidence: CompilerEvidence[] }
  | {
      op: "set_size_hint";
      value: "tiny" | "standard" | "large";
      evidence: CompilerEvidence[];
    };

export interface SchemePatch {
  base_revision: number;
  compiled_from_turns: string[];
  ops: SchemeOp[];
  partner_hint?: string;
}

// ───────────── 上下文与结果 ─────────────

export interface MergeContext {
  attempt: 0 | 1;
  /** 确定性 id 生成；测试里用计数器 */
  newId: (prefix: "SUG" | "REJ" | "ITEM") => string;
}

export interface MergeInput {
  state: LedgerState;
  patch: unknown;
  transcript: TranscriptView;
  ctx: MergeContext;
}

export interface OpVerdict {
  index: number;
  op_kind: SchemeOp["op"] | "unknown";
  target_id?: string;
  verdict: "APPLY" | "SUGGEST" | "DROP" | "NOOP";
  code?: OpCode | SuggestionKind;
  /** 墓地 ILLEGAL 时的具体判定码（code 为 E_PROPOSAL_PREVIOUSLY_REJECTED） */
  detail?: string;
  warnings: WarningCode[];
  stage: "P1" | "P2" | "P3" | "P4" | "P5" | "CLOSURE";
}

export interface MergeJournal {
  base_revision: number | null;
  observed_revision: number;
  verdicts: OpVerdict[];
  patch_warnings: WarningCode[];
  partner_hint?: string;
}

export type MergeResult =
  | {
      status: "applied";
      next: LedgerState;
      expected_prev_revision: number;
      revision: number;
      batch_consumed: true;
      journal: MergeJournal;
    }
  | {
      status: "noop";
      next: LedgerState;
      expected_prev_revision: number;
      batch_consumed: true;
      journal: MergeJournal;
    }
  | {
      status: "rejected";
      code: PatchCode;
      batch_consumed: false;
      journal: MergeJournal;
    }
  | {
      status: "stale";
      code: "E_PATCH_STALE" | "E_PATCH_STALE_RETRY_EXHAUSTED";
      retry: boolean;
      batch_consumed: false;
      journal: MergeJournal;
    }
  | {
      status: "frozen";
      code: "E_PATCH_FROZEN";
      batch_consumed: false;
      journal: MergeJournal;
    };

// ───────────── 码表（§5.3） ─────────────

/** 补丁级：整补丁不生效 */
export const PATCH_CODES = [
  "E_PATCH_FROZEN",
  "E_STATE_CORRUPT",
  "E_PATCH_SCHEMA_INVALID",
  "E_PATCH_TOO_LARGE",
  "E_PATCH_EVIDENCE_EMPTY",
  "E_PATCH_BATCH_INVALID",
  "E_PATCH_UNKNOWN_TURN",
  "E_PATCH_DANGLING_ID",
  "E_PATCH_DUPLICATE_TARGET",
  "E_PATCH_REVISION_AHEAD",
  "E_PATCH_STALE",
  "E_PATCH_STALE_RETRY_EXHAUSTED",
  "E_PATCH_POST_INVARIANT",
] as const;
export type PatchCode = (typeof PATCH_CODES)[number];

/** op 级：单 op 丢弃 */
export const OP_CODES = [
  "E_EVIDENCE_NOT_USER_TURN",
  "E_EVIDENCE_FUTURE_TURN",
  "E_EVIDENCE_EDIT_FORGED",
  "E_QUOTE_REQUIRED",
  "E_QUOTE_EMPTY",
  "E_QUOTE_TOO_LONG",
  "E_QUOTE_NOT_FOUND",
  "E_QUOTE_TOO_SHORT_UNBOUNDED",
  "E_QUOTE_OCCURRENCE_OUT_OF_RANGE",
  "E_SOURCE_CLAIM_FORBIDDEN",
  "E_SOURCE_ESCALATION_FORBIDDEN",
  "E_CONFIRM_TARGET_NOT_INFERRED",
  "E_CONFIRM_TURN_NOT_IN_BATCH",
  "E_CONFIRM_PREDATES_TARGET",
  "E_CONFIRM_NEGATED",
  "E_CONFIRM_QUESTION",
  "E_PROPOSAL_PREVIOUSLY_REJECTED",
  "E_REVIVAL_SECURITY_LOCKED",
  "E_REVIVAL_NOT_AFTER_REJECTION",
  "E_REVIVAL_TURN_NOT_IN_BATCH",
  "E_REVIVAL_FINGERPRINT_MISMATCH",
  "E_REVIVAL_NEGATED",
  "E_REJECT_NOT_NEGATED",
  "E_REJECT_TURN_NOT_IN_BATCH",
  "E_REJECT_TARGET_MISSING",
  "E_OP_DEPENDENCY_DROPPED",
] as const;
export type OpCode = (typeof OP_CODES)[number];

export const SUGGESTION_KINDS = [
  "S_REVIVAL_AMBIGUOUS",
  "S_OVERRIDE_PINNED",
  "S_OVERRIDE_PROTECTED",
  "S_GRAVEYARD_SOFT",
] as const;

export const WARNING_CODES = [
  "W_SOURCE_DOWNGRADED_NO_QUOTE",
  "W_SOURCE_DOWNGRADED_UNTETHERED",
  "W_QUOTE_MULTI_MATCH",
  "W_SUGGESTION_DEDUPED",
  "W_NOOP_IDENTICAL",
  "W_COMPILER_ANCHOR_IGNORED",
  "W_REVIVAL_OCCURRENCE_IGNORED",
  "W_PARTNER_HINT_TRUNCATED",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

/** 墓地判定的裁决码（judgeRevival 输出，不进入 MergeResult 的 code 字段） */
export type RevivalErrorCode =
  | "E_REVIVAL_SECURITY_LOCKED"
  | "E_EVIDENCE_NOT_USER_TURN"
  | "E_REVIVAL_NOT_AFTER_REJECTION"
  | "E_REVIVAL_TURN_NOT_IN_BATCH"
  | "E_REVIVAL_FINGERPRINT_MISMATCH"
  | "E_REVIVAL_NEGATED"
  | "E_PROPOSAL_PREVIOUSLY_REJECTED"
  | AnchorErrorCode;

export type AnchorErrorCode =
  | "E_QUOTE_REQUIRED"
  | "E_QUOTE_EMPTY"
  | "E_QUOTE_TOO_LONG"
  | "E_QUOTE_NOT_FOUND"
  | "E_QUOTE_TOO_SHORT_UNBOUNDED"
  | "E_QUOTE_OCCURRENCE_OUT_OF_RANGE";

/** 用户面编辑 API 的错误码（非补丁码表；见 PR 说明） */
export type EditErrorCode =
  | "E_PATCH_FROZEN"
  | "E_PATCH_DANGLING_ID"
  | "E_SUGGESTION_NOT_FOUND"
  | "E_SUGGESTION_NOT_PENDING"
  | "E_PATCH_POST_INVARIANT";

export const MAX_OPS_PER_PATCH = 64;
export const MAX_QUOTE_GRAPHEMES = 500;
export const SHORT_QUOTE_GRAPHEMES = 4;
export const GRAVEYARD_DICE_THRESHOLD = 0.75;
export const NEGATION_WINDOW_GRAPHEMES = 8;
export const PARTNER_HINT_MAX_CHARS = 200;

// ───────────── Schema（补丁信封；op 细节在引擎 stageParse 中逐项校验） ─────────────

export const TurnRefSchema = z
  .object({
    turn_id: z.string().min(1),
    quote: z.string().optional(),
    occurrence: z.number().int().nonnegative().optional(),
    anchor: z.unknown().optional(),
  })
  .passthrough();

export const PatchEnvelopeSchema = z
  .object({
    base_revision: z.number().int().nonnegative(),
    compiled_from_turns: z.array(z.string()),
    ops: z.array(z.unknown()),
    partner_hint: z.string().optional(),
  })
  .passthrough();

export const KNOWN_OPS = [
  "set_title",
  "set_summary",
  "set_audience",
  "set_size_hint",
  "upsert_module",
  "upsert_flow",
  "upsert_entity",
  "upsert_goal",
  "upsert_out_of_scope",
  "upsert_acceptance",
  "remove_item",
  "reject_item",
  "propose_decision",
  "raise_conflict",
  "mark_user_confirmed",
  "add_open_question",
] as const;

/** 集合 → 写入 op 名（用于按集合查找） */
export const UPSERT_OP_COLLECTION: Record<string, SchemeCollection> = {
  upsert_module: "modules",
  upsert_flow: "flows",
  upsert_entity: "entities",
  upsert_goal: "goals",
  upsert_out_of_scope: "out_of_scope",
  upsert_acceptance: "acceptance",
  propose_decision: "decisions",
  raise_conflict: "conflicts",
};

/** 每个集合的业务字段（用于比较「内容是否相同」与覆盖写入） */
export const BUSINESS_KEYS: Record<SchemeCollection, readonly string[]> = {
  goals: ["text"],
  out_of_scope: ["text"],
  acceptance: ["text"],
  open_questions: ["text"],
  modules: ["name", "purpose", "user_visible", "kind", "project_anchor"],
  flows: ["name", "steps"],
  entities: ["name", "fields_hint"],
  decisions: ["question", "recommended", "alternatives", "rationale", "risk"],
  conflicts: ["question", "options"],
};

/**
 * 确定性 JSON 序列化：对象键排序。用于指纹、内容比较与日志。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
