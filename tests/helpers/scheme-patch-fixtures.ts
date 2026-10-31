/**
 * SchemePatch 引擎测试夹具（TASK-J.9）。测试可使用 node:crypto 计算 text_sha256；引擎本身不可。
 */
import { createHash } from "node:crypto";
import { anchorQuote } from "../../src/lib/journey/evidence-anchor";
import type {
  EvidenceItem,
  LedgerState,
  MergeContext,
  SchemeDraftV2,
  TranscriptTurn,
  TranscriptView,
} from "../../src/lib/journey/scheme-patch-types";

export function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface TurnSpec {
  role: "user" | "assistant" | "system";
  text: string;
  /** 显式 seq；缺省为上一条 + 1。turn_id 固定为 `T${seq}` */
  seq?: number;
}

export interface Transcript {
  view: TranscriptView;
  turns: TranscriptTurn[];
}

export function makeTranscript(specs: TurnSpec[]): Transcript {
  let last = 0;
  const turns: TranscriptTurn[] = specs.map((s) => {
    const seq = s.seq ?? last + 1;
    last = seq;
    return {
      turn_id: `T${seq}`,
      role: s.role,
      seq,
      text: s.text,
      text_sha256: sha(s.text),
    };
  });
  const map = new Map(turns.map((t) => [t.turn_id, t]));
  return { view: { get: (id: string) => map.get(id) }, turns };
}

/** 锚定一条带 quote 的 turn 证据（与引擎同一算法） */
export function turnEv(
  tr: Transcript,
  turnId: string,
  quote?: string,
): EvidenceItem {
  const t = tr.view.get(turnId);
  if (!t) throw new Error(`no turn ${turnId}`);
  const ref =
    quote === undefined ? { turn_id: turnId } : { turn_id: turnId, quote };
  if (quote === undefined) return { kind: "turn", ref };
  const a = anchorQuote(t, ref, { requireQuote: true });
  if (!a.ok || a.kind !== "span")
    throw new Error(`anchor failed for ${turnId}: ${JSON.stringify(a)}`);
  return { kind: "turn", ref: { ...ref, anchor: a.anchor } };
}

export function emptyDraft(over: Partial<SchemeDraftV2> = {}): SchemeDraftV2 {
  return {
    scheme_id: "S1",
    scheme_revision: 5,
    frozen: false,
    title: "",
    summary: "",
    audience: null,
    size_hint: "standard",
    goals: [],
    out_of_scope: [],
    modules: [],
    flows: [],
    entities: [],
    decisions: [],
    conflicts: [],
    open_questions: [],
    acceptance: [],
    ...over,
  };
}

export function state(
  draft: Partial<SchemeDraftV2> = {},
  extra: Partial<LedgerState> = {},
): LedgerState {
  return { draft: emptyDraft(draft), graveyard: [], suggestions: [], ...extra };
}

export function ctxCounter(attempt: 0 | 1 = 0): MergeContext {
  let n = 0;
  return { attempt, newId: (p) => `${p}-${++n}` };
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/** 一个用户来源的模块（带已锚定证据） */
export function userModule(
  tr: Transcript,
  id: string,
  name: string,
  purpose: string,
  turnId: string,
  quote: string,
) {
  return {
    id,
    name,
    purpose,
    user_visible: true,
    kind: "new" as const,
    source: "user_said" as const,
    evidence: [turnEv(tr, turnId, quote)],
    user_pinned: false,
    updated_in_revision: 1,
    introduced_after_turn_seq: 0,
  };
}

/** 一个 AI 推断模块 */
export function aiModule(id: string, name: string, purpose: string, rev = 1) {
  return {
    id,
    name,
    purpose,
    user_visible: true,
    kind: "new" as const,
    source: "ai_inferred" as const,
    evidence: [],
    user_pinned: false,
    updated_in_revision: rev,
    introduced_after_turn_seq: 0,
  };
}
