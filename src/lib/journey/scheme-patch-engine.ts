/**
 * SchemePatch 零模型确定性合并引擎（TASK-J.9）。
 *
 * 纯函数：(台账状态, 编译器补丁, 只读对话记录, 上下文) → (新状态 | 拒绝 | 过期 | 冻结, 逐 op 判决日志)。
 * 零模型、零时钟、零随机数、零网络；id 由 ctx.newId 注入。实施口径见 docs/specs/scheme-patch-engine.md。
 */
import { z } from "zod";
import {
  anchorQuote,
  graphemeCount,
  lexemes,
  matchNormalize,
  normalizeForAnchor,
  sentenceAt,
} from "./evidence-anchor";
import {
  NEGATION_CUES,
  buildTombstone,
  isNegated,
  isQuestion,
  judgeRevival,
  mainTextOf,
  matchesTombstone,
  type RevivalJudgement,
} from "./graveyard-revival";
import {
  BUSINESS_KEYS,
  KNOWN_OPS,
  MAX_OPS_PER_PATCH,
  PARTNER_HINT_MAX_CHARS,
  PatchEnvelopeSchema,
  SUGGESTION_KINDS,
  TurnRefSchema,
  UPSERT_OP_COLLECTION,
  stableStringify,
  type CompilerEvidence,
  type EditErrorCode,
  type EditRef,
  type EvidenceItem,
  type GraveyardEntry,
  type ItemSource,
  type LedgerState,
  type MergeContext,
  type MergeInput,
  type MergeJournal,
  type MergeResult,
  type OpCode,
  type OpVerdict,
  type PatchCode,
  type QuoteAnchor,
  type SchemeCollection,
  type SchemeDraftV2,
  type SchemeItemMeta,
  type SchemeOp,
  type Suggestion,
  type SuggestionKind,
  type SuggestionRevive,
  type TranscriptView,
  type TurnRef,
  type WarningCode,
} from "./scheme-patch-types";

// ───────────── 常量与小工具 ─────────────

const COLLECTIONS: SchemeCollection[] = [
  "goals",
  "out_of_scope",
  "modules",
  "flows",
  "entities",
  "decisions",
  "conflicts",
  "open_questions",
  "acceptance",
];

/** 受保护条目（§1.2） */
const PROTECTED_SOURCES: ReadonlySet<ItemSource> = new Set<ItemSource>([
  "user_said",
  "user_confirmed",
  "user_edited",
]);

/** 卡型优先级（表 C，高 → 低） */
const SUGGESTION_PRIORITY: readonly SuggestionKind[] = [
  "S_REVIVAL_AMBIGUOUS",
  "S_OVERRIDE_PINNED",
  "S_OVERRIDE_PROTECTED",
  "S_GRAVEYARD_SOFT",
];

type AuditId =
  "A-01" | "A-02" | "A-03" | "A-04" | "A-05" | "A-06" | "A-07" | "A-08";
export interface AuditIssue {
  id: AuditId;
  message: string;
}

export interface UserEdit {
  edit_event_id: string;
  edited_at: number;
  collection: SchemeCollection;
  id: string;
  /** 只接受 BUSINESS_KEYS 中的字段 */
  patch: Record<string, unknown>;
  field_name?: string;
  previous_value?: string;
}

export type EditResult =
  | {
      ok: true;
      state: LedgerState;
      expected_prev_revision: number;
      revision: number;
    }
  | { ok: false; code: EditErrorCode };

export interface RejectItemInput {
  collection: SchemeCollection;
  id: string;
  reason?: string;
  /** 否决发生时的用户消息水位（严格晚于它的话才可能复活） */
  rejected_after_turn_seq: number;
  evidence: EvidenceItem[];
}

/** 台账投影的附加子账本（K-14 归因账本由其他模块维护，此处原样透传） */
export interface EvidenceLedgerProjection {
  claims: {
    goals: SchemeItemMeta[];
    boundaries: SchemeItemMeta[];
    acceptance: SchemeItemMeta[];
  };
  decisions: (SchemeItemMeta & {
    topic: string;
    chosen: string;
    status: "pending" | "confirmed";
  })[];
  graveyard: GraveyardEntry[];
  attributions: unknown[];
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

function arrOf(draft: SchemeDraftV2, c: SchemeCollection): SchemeItemMeta[] {
  return draft[c] as unknown as SchemeItemMeta[];
}

function findItem(
  draft: SchemeDraftV2,
  c: SchemeCollection,
  id: string,
): SchemeItemMeta | undefined {
  return arrOf(draft, c).find((x) => x.id === id);
}

function allIds(draft: SchemeDraftV2): Set<string> {
  const s = new Set<string>();
  for (const c of COLLECTIONS) for (const x of arrOf(draft, c)) s.add(x.id);
  return s;
}

function pickBusiness(
  obj: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEditEvidence(
  e: CompilerEvidence,
): e is { kind: "edit"; ref: Record<string, unknown> } {
  return "kind" in e && e.kind === "edit";
}

function turnEvidence(e: EvidenceItem[]): TurnRef[] {
  return e.flatMap((x) => (x.kind === "turn" ? [x.ref] : []));
}

function maxSeq(refs: readonly TurnRef[], transcript: TranscriptView): number {
  let m = 0;
  for (const r of refs) {
    const t = transcript.get(r.turn_id);
    if (t && t.seq > m) m = t.seq;
  }
  return m;
}

function mergeEvidence(
  existing: EvidenceItem[],
  add: EvidenceItem[],
): EvidenceItem[] {
  const out = [...existing];
  for (const a of add) {
    const dup = out.some(
      (x) =>
        x.kind === "turn" &&
        a.kind === "turn" &&
        x.ref.turn_id === a.ref.turn_id &&
        x.ref.anchor?.raw_start === a.ref.anchor?.raw_start,
    );
    if (!dup) out.push(a);
  }
  return out;
}

/** 编译器 op 的主文本（用于墓地命中与指纹） */
function mainTextsOfOp(op: SchemeOp): string[] {
  switch (op.op) {
    case "upsert_module":
    case "upsert_flow":
    case "upsert_entity":
    case "upsert_goal":
    case "upsert_out_of_scope":
    case "upsert_acceptance":
    case "propose_decision": {
      const c = UPSERT_OP_COLLECTION[op.op] as SchemeCollection;
      return [mainTextOf(c, op.item)];
    }
    case "raise_conflict": {
      const opts = Array.isArray(op.item["options"])
        ? (op.item["options"] as { label?: unknown }[])
        : [];
      return [
        mainTextOf("conflicts", op.item),
        ...opts.map((o) => (typeof o.label === "string" ? o.label : "")),
      ];
    }
    case "add_open_question":
      return [op.text];
    default:
      return [];
  }
}

function itemIdOf(op: SchemeOp): string | undefined {
  if (op.op in UPSERT_OP_COLLECTION) {
    const item = (op as { item: { id: string } }).item;
    return item.id;
  }
  if (
    op.op === "remove_item" ||
    op.op === "reject_item" ||
    op.op === "mark_user_confirmed"
  )
    return op.id;
  return undefined;
}

function collectionOfOp(op: SchemeOp): SchemeCollection | undefined {
  return op.op in UPSERT_OP_COLLECTION
    ? UPSERT_OP_COLLECTION[op.op]
    : undefined;
}

/** 按集合补全默认值，产出可写入的业务字段（不含 id / source / 证据 / 元数据） */
function normalizePayload(
  c: SchemeCollection,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const str = (k: string) =>
    typeof raw[k] === "string" ? (raw[k] as string) : "";
  const strs = (k: string) =>
    Array.isArray(raw[k])
      ? (raw[k] as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  const stripRefs = (arr: unknown): TurnRef[] =>
    Array.isArray(arr)
      ? arr.flatMap((r) =>
          isRecord(r) && typeof r["turn_id"] === "string"
            ? [
                {
                  turn_id: r["turn_id"],
                  ...(typeof r["quote"] === "string"
                    ? { quote: r["quote"] }
                    : {}),
                },
              ]
            : [],
        )
      : [];
  switch (c) {
    case "goals":
    case "out_of_scope":
    case "acceptance":
    case "open_questions":
      return { text: str("text") };
    case "modules":
      return {
        name: str("name"),
        purpose: str("purpose"),
        user_visible: raw["user_visible"] === true,
        kind: raw["kind"] === "change_existing" ? "change_existing" : "new",
        ...(typeof raw["project_anchor"] === "string"
          ? { project_anchor: raw["project_anchor"] }
          : {}),
      };
    case "flows":
      return {
        name: str("name"),
        steps: Array.isArray(raw["steps"])
          ? (raw["steps"] as Record<string, unknown>[]).map((s) => ({
              actor: typeof s["actor"] === "string" ? s["actor"] : "",
              action: typeof s["action"] === "string" ? s["action"] : "",
              ...(typeof s["module_id"] === "string"
                ? { module_id: s["module_id"] }
                : {}),
            }))
          : [],
      };
    case "entities":
      return { name: str("name"), fields_hint: strs("fields_hint") };
    case "decisions":
      return {
        question: str("question"),
        recommended: str("recommended"),
        alternatives: strs("alternatives"),
        rationale: str("rationale"),
        risk: raw["risk"] === "high" ? "high" : "low",
      };
    case "conflicts":
      return {
        question: str("question"),
        options: Array.isArray(raw["options"])
          ? (raw["options"] as Record<string, unknown>[]).map((o) => ({
              id: typeof o["id"] === "string" ? o["id"] : "",
              label: typeof o["label"] === "string" ? o["label"] : "",
              evidence: stripRefs(o["evidence"]),
            }))
          : [],
        chosen_id: null,
      };
  }
}

function refIdsOf(op: SchemeOp): string[] {
  if (op.op !== "upsert_flow") return [];
  return op.item["steps"] && Array.isArray(op.item["steps"])
    ? (op.item["steps"] as { module_id?: unknown }[]).flatMap((s) =>
        typeof s.module_id === "string" ? [s.module_id] : [],
      )
    : [];
}

// ───────────── 补丁级阶段 ─────────────

/** 冻结闸门（第 1 级，§2.3.1） */
export function stageFreezeGate(state: LedgerState): boolean {
  return state.draft.frozen;
}

/** 基线审计（第 2 级）：同时用于补丁前与补丁后（§5.5） */
export function auditLedgerState(
  state: LedgerState,
  transcript: TranscriptView,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const d = state.draft;
  const all = COLLECTIONS.flatMap((c) => arrOf(d, c).map((x) => ({ c, x })));

  // A-05 id 全局唯一
  const counts = new Map<string, number>();
  for (const { x } of all) counts.set(x.id, (counts.get(x.id) ?? 0) + 1);
  for (const [id, n] of counts)
    if (n > 1) issues.push({ id: "A-05", message: `id 重复：${id}` });

  for (const { c, x } of all) {
    // A-01：用户来源必须有指向用户消息、哈希一致的锚点
    if (x.source === "user_said" || x.source === "user_confirmed") {
      const refs = turnEvidence(x.evidence);
      const anchored = refs.filter((r) => r.anchor !== undefined);
      const valid = anchored.every((r) => {
        const t = transcript.get(r.turn_id);
        return (
          t !== undefined &&
          t.role === "user" &&
          r.anchor?.turn_text_sha256 === t.text_sha256
        );
      });
      const hasUser = refs.some((r) => {
        const t = transcript.get(r.turn_id);
        return t !== undefined && t.role === "user";
      });
      if (anchored.length === 0 || !valid || !hasUser)
        issues.push({ id: "A-01", message: `${x.id} 用户来源缺少有效锚点` });
    }
    // A-02：手改来源必须有 edit 证据
    if (
      x.source === "user_edited" &&
      !x.evidence.some((e) => e.kind === "edit")
    )
      issues.push({ id: "A-02", message: `${x.id} 手改来源缺少 edit 证据` });
    // A-04：不得存在命中活跃且禁止复活墓碑的条目
    const texts =
      c === "conflicts"
        ? [
            mainTextOf(c, x as unknown as Record<string, unknown>),
            ...(
              (x as unknown as { options: { label: string }[] }).options ?? []
            ).map((o) => o.label),
          ]
        : [mainTextOf(c, x as unknown as Record<string, unknown>)];
    for (const g of state.graveyard) {
      // 豁免（规格 scheme-patch-engine.md §5.5 A-04 豁免条款）：被拒建议的 item_ref 指向仍保留的条目本身，
      // 该条目是用户选择保留的版本，不视为命中。后续补丁仍由 P3 的 (a) 拦截。
      if (g.item_ref && g.item_ref.id === x.id && g.status === "active")
        continue;
      if (
        g.disallow_revival &&
        matchesTombstone({ targetId: x.id, texts }, g).hit
      )
        issues.push({
          id: "A-04",
          message: `${x.id} 命中活跃墓碑 ${g.rejected_id}`,
        });
    }
  }

  // A-03：已确认的决议必须有确认来源
  for (const dec of d.decisions)
    if (
      (dec.status === "accepted" || dec.status === "changed") &&
      dec.source !== "user_confirmed" &&
      dec.source !== "user_edited"
    )
      issues.push({
        id: "A-03",
        message: `${dec.id} 已确认但来源不是用户确认`,
      });

  // A-06：引用可解析
  const moduleIds = new Set(d.modules.map((m) => m.id));
  for (const f of d.flows)
    for (const s of f.steps)
      if (s.module_id !== undefined && !moduleIds.has(s.module_id))
        issues.push({
          id: "A-06",
          message: `${f.id} 引用了不存在的模块 ${s.module_id}`,
        });
  for (const cf of d.conflicts)
    if (cf.chosen_id !== null && !cf.options.some((o) => o.id === cf.chosen_id))
      issues.push({ id: "A-06", message: `${cf.id} 的 chosen_id 不在选项中` });

  // A-07：已复活墓碑必须指向用户消息
  for (const g of state.graveyard) {
    if (g.status === "revived") {
      const t = g.revived ? transcript.get(g.revived.turn_id) : undefined;
      if (!g.revived || !t || t.role !== "user")
        issues.push({ id: "A-07", message: `${g.rejected_id} 复活证据无效` });
    }
  }

  // A-08：修订号合法
  if (!Number.isInteger(d.scheme_revision) || d.scheme_revision < 0)
    issues.push({ id: "A-08", message: "scheme_revision 非法" });
  for (const { x } of all)
    if (x.updated_in_revision > d.scheme_revision)
      issues.push({ id: "A-08", message: `${x.id} 的修订号超前` });

  return issues;
}

export function stageAuditBase(
  state: LedgerState,
  transcript: TranscriptView,
): AuditIssue[] {
  return auditLedgerState(state, transcript);
}

// ───────────── 解析（stageParse） ─────────────

type ParseOk = { ok: true; value: ParsedPatch };
type ParseFail = { ok: false; code: PatchCode };
export interface ParsedPatch {
  base_revision: number;
  compiled_from_turns: string[];
  ops: { index: number; op: SchemeOp; opWarnings: WarningCode[] }[];
  partner_hint?: string;
  patch_warnings: WarningCode[];
}

const SOURCE_VALUES: ReadonlySet<string> = new Set([
  "user_said",
  "user_confirmed",
  "ai_inferred",
  "user_edited",
]);

function parseEvidence(
  raw: unknown,
  warnings: WarningCode[],
): CompilerEvidence[] | PatchCode {
  if (!Array.isArray(raw)) return "E_PATCH_SCHEMA_INVALID";
  if (raw.length === 0) return "E_PATCH_EVIDENCE_EMPTY";
  const out: CompilerEvidence[] = [];
  for (const e of raw) {
    if (isRecord(e) && e["kind"] === "edit" && isRecord(e["ref"])) {
      out.push({ kind: "edit", ref: e["ref"] });
      continue;
    }
    const r = TurnRefSchema.safeParse(e);
    if (!r.success) return "E_PATCH_SCHEMA_INVALID";
    if (r.data.anchor !== undefined) warnings.push("W_COMPILER_ANCHOR_IGNORED");
    out.push({
      turn_id: r.data.turn_id,
      ...(r.data.quote !== undefined ? { quote: r.data.quote } : {}),
      ...(r.data.occurrence !== undefined
        ? { occurrence: r.data.occurrence }
        : {}),
    });
  }
  return out;
}

const REQUIRED_ITEM_FIELDS: Record<
  SchemeCollection,
  { str: string[]; arr?: string[] }
> = {
  goals: { str: ["text"] },
  out_of_scope: { str: ["text"] },
  acceptance: { str: ["text"] },
  open_questions: { str: ["text"] },
  modules: { str: ["name", "purpose"] },
  flows: { str: ["name"], arr: ["steps"] },
  entities: { str: ["name"] },
  decisions: { str: ["question", "recommended"] },
  conflicts: { str: ["question"], arr: ["options"] },
};

function validItem(
  c: SchemeCollection,
  item: Record<string, unknown>,
): boolean {
  const req = REQUIRED_ITEM_FIELDS[c];
  if (
    !req.str.every(
      (k) => typeof item[k] === "string" && (item[k] as string).length > 0,
    )
  )
    return false;
  if (req.arr && !req.arr.every((k) => Array.isArray(item[k]))) return false;
  if (c === "conflicts") {
    const opts = item["options"] as unknown[];
    if (opts.length < 2) return false;
    if (
      !opts.every(
        (o) =>
          isRecord(o) &&
          typeof o["id"] === "string" &&
          typeof o["label"] === "string",
      )
    )
      return false;
  }
  if (c === "flows") {
    const steps = item["steps"] as unknown[];
    if (
      !steps.every(
        (s) =>
          isRecord(s) &&
          typeof s["actor"] === "string" &&
          typeof s["action"] === "string",
      )
    )
      return false;
  }
  return true;
}

function parseOp(
  raw: unknown,
):
  | { ok: true; op: SchemeOp; warnings: WarningCode[] }
  | { ok: false; code: PatchCode } {
  if (
    !isRecord(raw) ||
    typeof raw["op"] !== "string" ||
    !(KNOWN_OPS as readonly string[]).includes(raw["op"])
  )
    return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
  const warnings: WarningCode[] = [];
  const ev = parseEvidence(raw["evidence"], warnings);
  if (typeof ev === "string") return { ok: false, code: ev };

  let revival: SchemeOp extends infer _
    ? { rejected_id: string; evidence: TurnRef[] } | undefined
    : never;
  revival = undefined;
  if (raw["revival"] !== undefined) {
    const rv = z
      .object({
        rejected_id: z.string().min(1),
        evidence: z.array(TurnRefSchema).min(1),
      })
      .safeParse(raw["revival"]);
    if (!rv.success) return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
    revival = {
      rejected_id: rv.data.rejected_id,
      evidence: rv.data.evidence.map((r) => {
        if (r.anchor !== undefined) warnings.push("W_COMPILER_ANCHOR_IGNORED");
        return {
          turn_id: r.turn_id,
          ...(r.quote !== undefined ? { quote: r.quote } : {}),
          ...(r.occurrence !== undefined ? { occurrence: r.occurrence } : {}),
        };
      }),
    };
  }
  const withRevival = revival ? { revival } : {};

  const name = raw["op"] as string;
  switch (name) {
    case "set_title":
    case "set_summary":
    case "set_audience": {
      if (typeof raw["value"] !== "string")
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      return {
        ok: true,
        op: { op: name, value: raw["value"], evidence: ev, ...withRevival },
        warnings,
      };
    }
    case "set_size_hint": {
      if (
        raw["value"] !== "tiny" &&
        raw["value"] !== "standard" &&
        raw["value"] !== "large"
      )
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      return {
        ok: true,
        op: { op: name, value: raw["value"], evidence: ev },
        warnings,
      };
    }
    case "add_open_question": {
      if (typeof raw["text"] !== "string" || raw["text"].length === 0)
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      return {
        ok: true,
        op: { op: name, text: raw["text"], evidence: ev },
        warnings,
      };
    }
    case "remove_item":
    case "reject_item": {
      if (typeof raw["id"] !== "string" || raw["id"].length === 0)
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      return {
        ok: true,
        op: {
          op: name,
          id: raw["id"],
          evidence: ev,
          ...(typeof raw["reason"] === "string"
            ? { reason: raw["reason"] }
            : {}),
        },
        warnings,
      };
    }
    case "mark_user_confirmed": {
      if (typeof raw["id"] !== "string" || raw["id"].length === 0)
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      return {
        ok: true,
        op: { op: name, id: raw["id"], evidence: ev },
        warnings,
      };
    }
    default: {
      // upsert_* / propose_decision / raise_conflict
      if (
        !isRecord(raw["item"]) ||
        typeof raw["item"]["id"] !== "string" ||
        raw["item"]["id"].length === 0
      )
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      const item: Record<string, unknown> = { ...raw["item"] };
      if (item["introduced_after_turn_seq"] !== undefined) {
        delete item["introduced_after_turn_seq"];
        warnings.push("W_COMPILER_ANCHOR_IGNORED");
      }
      delete item["user_pinned"];
      if (
        item["source"] !== undefined &&
        (typeof item["source"] !== "string" ||
          !SOURCE_VALUES.has(item["source"]))
      )
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      const c = UPSERT_OP_COLLECTION[name] as SchemeCollection;
      if (!validItem(c, item))
        return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
      if (c === "conflicts") {
        item["options"] = (item["options"] as Record<string, unknown>[]).map(
          (o) => {
            const evs = Array.isArray(o["evidence"]) ? o["evidence"] : [];
            return {
              id: o["id"],
              label: o["label"],
              evidence: evs.flatMap((r) =>
                isRecord(r) && typeof r["turn_id"] === "string"
                  ? [{ turn_id: r["turn_id"] }]
                  : [],
              ),
            };
          },
        );
      }
      return {
        ok: true,
        op: {
          op: name,
          item: item as SchemeOp extends { item: infer I } ? I : never,
          evidence: ev,
          ...withRevival,
        } as SchemeOp,
        warnings,
      };
    }
  }
}

export function stageParse(patch: unknown): ParseOk | ParseFail {
  const env = PatchEnvelopeSchema.safeParse(patch);
  if (!env.success) return { ok: false, code: "E_PATCH_SCHEMA_INVALID" };
  const p = env.data;
  if (p.ops.length > MAX_OPS_PER_PATCH)
    return { ok: false, code: "E_PATCH_TOO_LARGE" };
  const patchWarnings: WarningCode[] = [];
  let hint = p.partner_hint;
  if (hint !== undefined) {
    const chars = Array.from(hint);
    if (chars.length > PARTNER_HINT_MAX_CHARS) {
      hint = chars.slice(0, PARTNER_HINT_MAX_CHARS).join("");
      patchWarnings.push("W_PARTNER_HINT_TRUNCATED");
    }
  }
  const ops: ParsedPatch["ops"] = [];
  for (let i = 0; i < p.ops.length; i++) {
    const r = parseOp(p.ops[i]);
    if (!r.ok) return { ok: false, code: r.code };
    ops.push({ index: i, op: r.op, opWarnings: r.warnings });
  }
  return {
    ok: true,
    value: {
      base_revision: p.base_revision,
      compiled_from_turns: p.compiled_from_turns,
      ops,
      ...(hint !== undefined ? { partner_hint: hint } : {}),
      patch_warnings: patchWarnings,
    },
  };
}

// ───────────── 结构与修订号 ─────────────

export interface ResolvedStructure {
  batch: Set<string>;
  watermark: number;
  baselineIds: Set<string>;
}

export function stageResolveStructure(
  parsed: ParsedPatch,
  state: LedgerState,
  transcript: TranscriptView,
): { ok: true; value: ResolvedStructure } | { ok: false; code: PatchCode } {
  const batchIds = parsed.compiled_from_turns;
  if (batchIds.length === 0 || new Set(batchIds).size !== batchIds.length)
    return { ok: false, code: "E_PATCH_BATCH_INVALID" };
  let watermark = 0;
  for (const id of batchIds) {
    const t = transcript.get(id);
    if (!t || t.role !== "user")
      return { ok: false, code: "E_PATCH_BATCH_INVALID" };
    if (t.seq > watermark) watermark = t.seq;
  }

  const created = new Set<string>();
  for (const { op } of parsed.ops) {
    if (op.op in UPSERT_OP_COLLECTION) created.add(itemIdOf(op) as string);
  }
  const baselineIds = allIds(state.draft);
  const resolvable = new Set([...baselineIds, ...created]);

  const targetCount = new Map<string, number>();
  for (const { op } of parsed.ops) {
    const evidence =
      op.op === "set_size_hint" ||
      op.op === "add_open_question" ||
      op.op.startsWith("set_")
        ? op.evidence
        : op.evidence;
    for (const e of evidence) {
      if (isEditEvidence(e)) continue;
      if (!transcript.get(e.turn_id))
        return { ok: false, code: "E_PATCH_UNKNOWN_TURN" };
    }
    if ("revival" in op && op.revival) {
      for (const r of op.revival.evidence)
        if (!transcript.get(r.turn_id))
          return { ok: false, code: "E_PATCH_UNKNOWN_TURN" };
    }
    const tid = itemIdOf(op);
    if (tid !== undefined)
      targetCount.set(tid, (targetCount.get(tid) ?? 0) + 1);
    if (op.op === "remove_item" || op.op === "mark_user_confirmed") {
      if (!resolvable.has(op.id))
        return { ok: false, code: "E_PATCH_DANGLING_ID" };
    }
    for (const mid of refIdsOf(op))
      if (!resolvable.has(mid))
        return { ok: false, code: "E_PATCH_DANGLING_ID" };
  }
  for (const n of targetCount.values())
    if (n > 1) return { ok: false, code: "E_PATCH_DUPLICATE_TARGET" };

  return {
    ok: true,
    value: { batch: new Set(batchIds), watermark, baselineIds },
  };
}

export function stageFreshness(
  base: number,
  cur: number,
  attempt: 0 | 1,
): "ok" | "AHEAD" | "STALE_RETRY" | "STALE_EXHAUSTED" {
  if (base > cur) return "AHEAD";
  if (base < cur) return attempt === 0 ? "STALE_RETRY" : "STALE_EXHAUSTED";
  return "ok";
}

// ───────────── 逐 op 判决（P1–P5） ─────────────

interface Classified {
  index: number;
  op: SchemeOp;
  opWarnings: WarningCode[];
  verdict: "APPLY" | "SUGGEST" | "DROP" | "NOOP";
  code?: OpCode | SuggestionKind | undefined;
  detail?: string | undefined;
  stage: OpVerdict["stage"];
  suggestKinds: SuggestionKind[];
  tombIds: string[];
  revive?:
    | { rejected_ids: string[]; turn_id: string; anchor: QuoteAnchor }
    | undefined;
  /** 与 op.evidence 一一对应的已锚定证据（turn） */
  anchored: EvidenceItem[];
  sourceResolved?: ItemSource | undefined;
  confirm?: EvidenceItem | undefined;
  collection?: SchemeCollection | undefined;
  targetId?: string | undefined;
  createsId?: string | undefined;
  refIds: string[];
  sourceSeq: number;
}

function newClassified(
  index: number,
  op: SchemeOp,
  opWarnings: WarningCode[],
): Classified {
  return {
    index,
    op,
    opWarnings,
    verdict: "APPLY",
    stage: "P5",
    suggestKinds: [],
    tombIds: [],
    anchored: [],
    refIds: refIdsOf(op),
    sourceSeq: 0,
    collection: collectionOfOp(op),
    targetId: itemIdOf(op),
  };
}

function drop(
  c: Classified,
  stage: OpVerdict["stage"],
  code: OpCode,
  detail?: string,
): Classified {
  return { ...c, verdict: "DROP", stage, code, ...(detail ? { detail } : {}) };
}

export function stageClassifyOps(
  parsed: ParsedPatch,
  st: ResolvedStructure,
  state: LedgerState,
  transcript: TranscriptView,
): Classified[] {
  const draft = state.draft;
  const out: Classified[] = [];
  for (const { index, op, opWarnings } of parsed.ops) {
    const c = newClassified(index, op, [...opWarnings]);
    c.sourceSeq = maxSeq(
      op.evidence.flatMap((e) => (isEditEvidence(e) ? [] : [e])),
      transcript,
    );
    // remove / reject / mark 不携带集合：按 id 在草稿中定位所属集合（TM-A/TM-C）
    if (
      op.op === "mark_user_confirmed" ||
      op.op === "remove_item" ||
      op.op === "reject_item"
    ) {
      c.collection = COLLECTIONS.find(
        (col) => findItem(draft, col, op.id) !== undefined,
      );
    }
    const existing =
      c.collection && c.targetId !== undefined
        ? findItem(draft, c.collection, c.targetId)
        : undefined;
    if (c.collection && !existing && c.targetId !== undefined)
      c.createsId = c.targetId;

    // ── P1 溯源 ──
    const confirmOrReject =
      op.op === "mark_user_confirmed" || op.op === "reject_item";
    const anchored: EvidenceItem[] = [];
    let p1Failed: Classified | undefined;
    for (const e of op.evidence) {
      if (isEditEvidence(e)) {
        p1Failed = drop(c, "P1", "E_EVIDENCE_EDIT_FORGED");
        break;
      }
      const t = transcript.get(e.turn_id);
      if (!t) {
        p1Failed = drop(c, "P1", "E_EVIDENCE_NOT_USER_TURN");
        break;
      }
      if (t.role !== "user") {
        p1Failed = drop(c, "P1", "E_EVIDENCE_NOT_USER_TURN");
        break;
      }
      if (op.op === "reject_item" && !st.batch.has(t.turn_id)) {
        p1Failed = drop(c, "P1", "E_REJECT_TURN_NOT_IN_BATCH");
        break;
      }
      if (t.seq > st.watermark) {
        p1Failed = drop(c, "P1", "E_EVIDENCE_FUTURE_TURN");
        break;
      }
      const a = anchorQuote(t, e, { requireQuote: confirmOrReject });
      if (!a.ok) {
        p1Failed = drop(c, "P1", a.code);
        break;
      }
      if (a.kind === "span") {
        anchored.push({
          kind: "turn",
          ref: {
            turn_id: e.turn_id,
            ...(e.quote !== undefined ? { quote: e.quote } : {}),
            anchor: a.anchor,
          },
        });
        c.opWarnings.push(...a.warnings);
      } else {
        anchored.push({ kind: "turn", ref: { turn_id: e.turn_id } });
      }
    }
    if (p1Failed) {
      out.push({ ...p1Failed, opWarnings: c.opWarnings });
      continue;
    }
    c.anchored = anchored;
    if (op.op === "reject_item") {
      // K-11：锚定句须含否定词且非问句
      for (const a of anchored) {
        if (a.kind !== "turn" || !a.ref.anchor) continue;
        const t = transcript.get(a.ref.turn_id)!;
        const sentence = sentenceAt(
          t.text,
          a.ref.anchor.raw_start,
          a.ref.anchor.raw_end,
        );
        if (!isNegated(sentence) || isQuestion(sentence)) {
          out.push({
            ...drop(c, "P1", "E_REJECT_NOT_NEGATED"),
            opWarnings: c.opWarnings,
          });
          c.opWarnings = [];
          break;
        }
      }
      if (out.length && out[out.length - 1]?.index === index) continue;
    }

    // ── P2 来源声明 ──
    if (op.op in UPSERT_OP_COLLECTION) {
      const coll = c.collection!;
      const item =
        op.op === "remove_item"
          ? undefined
          : (op as { item: Record<string, unknown> }).item;
      const claimed = item?.["source"] as ItemSource | undefined;
      if (
        item &&
        (item["status"] === "accepted" || item["status"] === "changed")
      ) {
        out.push(drop(c, "P2", "E_SOURCE_ESCALATION_FORBIDDEN"));
        continue;
      }
      if (claimed === "user_confirmed" || claimed === "user_edited") {
        out.push(drop(c, "P2", "E_SOURCE_CLAIM_FORBIDDEN"));
        continue;
      }
      if (existing) {
        if (existing.source === "ai_inferred" && claimed === "user_said") {
          out.push(drop(c, "P2", "E_SOURCE_ESCALATION_FORBIDDEN"));
          continue;
        }
        c.sourceResolved = existing.source;
      } else if (op.op === "propose_decision" || op.op === "raise_conflict") {
        c.sourceResolved = "ai_inferred";
      } else if (claimed === "user_said") {
        const quoted = anchored.find(
          (a) => a.kind === "turn" && a.ref.quote !== undefined,
        );
        if (!quoted || quoted.kind !== "turn") {
          c.sourceResolved = "ai_inferred";
          c.opWarnings.push("W_SOURCE_DOWNGRADED_NO_QUOTE");
        } else {
          const qLex = lexemes(quoted.ref.quote as string);
          const mLex = lexemes(
            mainTextOf(
              coll,
              normalizePayload(coll, item as Record<string, unknown>),
            ),
          );
          const tethered = qLex.some((x) => mLex.includes(x));
          c.sourceResolved = tethered ? "user_said" : "ai_inferred";
          if (!tethered) c.opWarnings.push("W_SOURCE_DOWNGRADED_UNTETHERED");
        }
      } else {
        c.sourceResolved = "ai_inferred";
      }
    }

    if (op.op === "mark_user_confirmed") {
      const target = existing!;
      if (target.source === "user_confirmed") {
        out.push({ ...c, verdict: "NOOP", stage: "P2" });
        continue;
      }
      if (target.source !== "ai_inferred") {
        out.push(drop(c, "P2", "E_CONFIRM_TARGET_NOT_INFERRED"));
        continue;
      }
      let firstErr: OpCode | undefined;
      let ok: EvidenceItem | undefined;
      for (const a of anchored) {
        if (a.kind !== "turn" || !a.ref.anchor) continue;
        const t = transcript.get(a.ref.turn_id)!;
        if (!st.batch.has(t.turn_id)) {
          firstErr ??= "E_CONFIRM_TURN_NOT_IN_BATCH";
          continue;
        }
        if (t.seq <= (target.introduced_after_turn_seq ?? 0)) {
          firstErr ??= "E_CONFIRM_PREDATES_TARGET";
          continue;
        }
        const sentence = sentenceAt(
          t.text,
          a.ref.anchor.raw_start,
          a.ref.anchor.raw_end,
        );
        if (isNegated(sentence)) {
          firstErr ??= "E_CONFIRM_NEGATED";
          continue;
        }
        if (isQuestion(sentence)) {
          firstErr ??= "E_CONFIRM_QUESTION";
          continue;
        }
        ok = a;
        break;
      }
      if (!ok) {
        out.push(drop(c, "P2", firstErr ?? "E_QUOTE_REQUIRED"));
        continue;
      }
      c.confirm = ok;
      out.push({ ...c, stage: "P2" });
      continue;
    }

    // ── P3 墓地（内容类 op；删除 / 否决 / 确认不走墓地） ──
    let revivalSuggest = false;
    let ilOut: Classified | undefined;
    const contentOp =
      op.op in UPSERT_OP_COLLECTION || op.op === "add_open_question";
    if (contentOp) {
      const texts = mainTextsOfOp(op);
      const hits = state.graveyard
        .filter((g) => matchesTombstone({ targetId: c.targetId, texts }, g).hit)
        .sort((a, b) =>
          a.rejected_id < b.rejected_id
            ? -1
            : a.rejected_id > b.rejected_id
              ? 1
              : 0,
        );
      if (hits.length > 0) {
        if (hits.some((g) => g.rejected_by !== "user")) {
          out.push(drop(c, "P3", "E_REVIVAL_SECURITY_LOCKED"));
          continue;
        }
        const strict = hits.filter((g) => g.disallow_revival);
        const soft = hits.filter((g) => !g.disallow_revival);
        if (soft.length > 0) {
          c.suggestKinds.push("S_GRAVEYARD_SOFT");
          c.tombIds.push(...soft.map((g) => g.rejected_id));
        }
        const rawEvidence = op.evidence.filter(
          (e): e is TurnRef => !isEditEvidence(e),
        );
        const judgements: RevivalJudgement[] = strict.map((g) =>
          judgeRevival({
            op: {
              explicit: "revival" in op && op.revival !== undefined,
              evidence:
                "revival" in op && op.revival
                  ? op.revival.evidence
                  : rawEvidence,
              targetId: c.targetId,
              texts,
              ...("revival" in op && op.revival
                ? { claimedRevivalId: op.revival.rejected_id }
                : {}),
            },
            entry: g,
            batch: st.batch,
            transcript,
          }),
        );
        const illegal = judgements.find((j) => j.kind === "ILLEGAL");
        if (illegal && illegal.kind === "ILLEGAL") {
          ilOut = drop(c, "P3", "E_PROPOSAL_PREVIOUSLY_REJECTED", illegal.code);
        } else {
          const ambiguous = judgements.filter((j) => j.kind === "AMBIGUOUS");
          if (ambiguous.length > 0) {
            revivalSuggest = true;
            c.suggestKinds.push("S_REVIVAL_AMBIGUOUS");
            c.tombIds.push(...ambiguous.map((j) => j.rejected_id));
          } else if (judgements.length > 0) {
            const legal = judgements.filter(
              (j): j is Extract<RevivalJudgement, { kind: "LEGAL" }> =>
                j.kind === "LEGAL",
            );
            const first = legal[0];
            if (first)
              c.revive = {
                rejected_ids: legal.map((j) => j.rejected_id),
                turn_id: first.turn_id,
                anchor: first.anchor,
              };
            for (const j of legal) c.opWarnings.push(...j.warnings);
          }
        }
        if (ilOut) {
          out.push({ ...ilOut, opWarnings: c.opWarnings });
          continue;
        }
      }
    }

    // ── P4 钉选与受保护 ──
    if (
      op.op === "set_title" ||
      op.op === "set_summary" ||
      op.op === "set_audience" ||
      op.op === "set_size_hint"
    ) {
      out.push({ ...c, stage: "P5" });
      continue;
    }
    if (op.op === "add_open_question") {
      out.push({ ...c, stage: "P5" });
      continue;
    }
    if (op.op === "remove_item" || op.op === "reject_item") {
      if (!existing) {
        if (op.op === "reject_item") {
          out.push(drop(c, "P4", "E_REJECT_TARGET_MISSING"));
        } else {
          out.push({ ...c, verdict: "NOOP", stage: "P4" });
        }
        continue;
      }
      if (existing.user_pinned) c.suggestKinds.push("S_OVERRIDE_PINNED");
      else if (PROTECTED_SOURCES.has(existing.source))
        c.suggestKinds.push("S_OVERRIDE_PROTECTED");
    } else if (op.op in UPSERT_OP_COLLECTION && existing) {
      const coll = c.collection!;
      const payload = normalizePayload(
        coll,
        (op as { item: Record<string, unknown> }).item,
      );
      const same =
        stableStringify(
          pickBusiness(
            existing as unknown as Record<string, unknown>,
            BUSINESS_KEYS[coll],
          ),
        ) === stableStringify(pickBusiness(payload, BUSINESS_KEYS[coll]));
      if (same && !revivalSuggest && c.suggestKinds.length === 0) {
        out.push({
          ...c,
          verdict: "NOOP",
          stage: "P4",
          opWarnings: [...c.opWarnings, "W_NOOP_IDENTICAL"],
        });
        continue;
      }
      if (existing.user_pinned) c.suggestKinds.push("S_OVERRIDE_PINNED");
      else if (PROTECTED_SOURCES.has(existing.source)) {
        const newest = maxSeq(turnEvidence(existing.evidence), transcript);
        const fresh =
          c.sourceSeq > newest &&
          anchored.some((a) => a.kind === "turn" && a.ref.quote !== undefined);
        if (!fresh) c.suggestKinds.push("S_OVERRIDE_PROTECTED");
      }
    }

    // ── P5 判决 ──
    if (c.suggestKinds.length > 0) {
      const top = SUGGESTION_PRIORITY.find((k) => c.suggestKinds.includes(k))!;
      out.push({
        ...c,
        verdict: "SUGGEST",
        stage: "P4",
        code: top,
        suggestKinds: [...new Set(c.suggestKinds)],
      });
    } else {
      out.push({ ...c, verdict: "APPLY", stage: "P5" });
    }
  }
  return out;
}

// ───────────── 依赖闭包（§2.4 第 3 条） ─────────────

export function stageDependencyClosure(
  list: Classified[],
  baselineIds: Set<string>,
): Classified[] {
  const dropped = new Set<string>();
  for (const c of list)
    if (c.createsId !== undefined && c.verdict !== "APPLY")
      dropped.add(c.createsId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of list) {
      if (c.verdict !== "APPLY") continue;
      if (c.refIds.some((r) => dropped.has(r) && !baselineIds.has(r))) {
        c.verdict = "DROP";
        c.code = "E_OP_DEPENDENCY_DROPPED";
        c.stage = "CLOSURE";
        if (c.createsId !== undefined && !baselineIds.has(c.createsId))
          dropped.add(c.createsId);
        changed = true;
      }
    }
  }
  return list;
}

// ───────────── 卡片合并（表 C，同一 op 至多一张卡） ─────────────

export function stageBuildSuggestions(
  list: Classified[],
  state: LedgerState,
  ctx: MergeContext,
): Suggestion[] {
  const out: Suggestion[] = [];
  const seenKeys = new Set<string>();
  for (const c of list) {
    if (c.verdict !== "SUGGEST") continue;
    const fp = stableStringify(c.op);
    const target =
      c.collection && c.targetId !== undefined
        ? { collection: c.collection, id: c.targetId }
        : undefined;
    const key = `${stableStringify(target ?? null)}|${fp}`;
    const dupPending = state.suggestions.some(
      (s) =>
        s.status === "pending" &&
        stableStringify(s.target ?? null) === stableStringify(target ?? null) &&
        s.op_fingerprint === fp,
    );
    if (dupPending || seenKeys.has(key)) {
      c.opWarnings.push("W_SUGGESTION_DEDUPED");
      continue;
    }
    seenKeys.add(key);
    const kinds = SUGGESTION_PRIORITY.filter((k) => c.suggestKinds.includes(k));
    const revive: SuggestionRevive | undefined = c.revive
      ? {
          rejected_ids: c.revive.rejected_ids,
          turn_id: c.revive.turn_id,
          anchor: c.revive.anchor,
        }
      : undefined;
    out.push({
      suggestion_id: ctx.newId("SUG"),
      kind: kinds[0] as SuggestionKind,
      reasons: kinds,
      ...(target ? { target } : {}),
      op: c.op,
      evidence: c.anchored,
      op_fingerprint: fp,
      tombstone_ids: [...new Set(c.tombIds)],
      created_in_revision: state.draft.scheme_revision,
      source_seq: c.sourceSeq,
      ...(revive ? { revive } : {}),
      status: "pending",
    });
  }
  return out;
}

// ───────────── 应用（§5.4 写入规则） ─────────────

function reviveTombs(
  graveyard: GraveyardEntry[],
  ids: string[],
  turnId: string,
  anchor: QuoteAnchor,
  rev: number,
): void {
  for (const id of ids) {
    const g = graveyard.find((x) => x.rejected_id === id);
    if (g && g.status === "active") {
      g.status = "revived";
      g.revived = { turn_id: turnId, anchor, at_revision: rev };
    }
  }
}

function removeFrom(
  draft: SchemeDraftV2,
  c: SchemeCollection,
  id: string,
): SchemeItemMeta | undefined {
  const arr = arrOf(draft, c);
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return undefined;
  const [gone] = arr.splice(i, 1);
  return gone;
}

function tombstoneOf(
  draft: SchemeDraftV2,
  gone: SchemeItemMeta,
  c: SchemeCollection,
  evidence: EvidenceItem[],
  rev: number,
  ctx: MergeContext,
  reason: string,
  seq: number,
): GraveyardEntry {
  const proposal = mainTextOf(c, gone as unknown as Record<string, unknown>);
  const quotes = turnEvidence(evidence).flatMap((r) =>
    r.quote !== undefined ? [r.quote] : [],
  );
  void draft;
  return buildTombstone({
    rejected_id: ctx.newId("REJ"),
    proposal,
    rejected_by: "user",
    rejection_reason: reason,
    evidence,
    disallow_revival: true,
    updated_in_revision: rev,
    item_ref: { collection: c, id: gone.id },
    rejected_after_turn_seq: seq,
    quotes,
  });
}

function applyOne(
  c: Classified,
  draft: SchemeDraftV2,
  graveyard: GraveyardEntry[],
  rev: number,
  watermark: number,
  ctx: MergeContext,
): void {
  const op = c.op;
  switch (op.op) {
    case "set_title":
      draft.title = op.value;
      return;
    case "set_summary":
      draft.summary = op.value;
      return;
    case "set_audience":
      draft.audience = op.value;
      return;
    case "set_size_hint":
      draft.size_hint = op.value;
      return;
    case "add_open_question": {
      const id = ctx.newId("ITEM");
      draft.open_questions.push({
        id,
        source: "ai_inferred",
        evidence: c.anchored,
        user_pinned: false,
        updated_in_revision: rev,
        introduced_after_turn_seq: watermark,
        text: op.text,
      });
      return;
    }
    case "remove_item":
      removeFrom(draft, c.collection!, op.id);
      return;
    case "reject_item": {
      const coll = c.collection!;
      const gone = removeFrom(draft, coll, op.id);
      if (gone) {
        graveyard.push(
          tombstoneOf(
            draft,
            gone,
            coll,
            c.anchored,
            rev,
            ctx,
            op.reason ?? "用户在聊天中否决",
            maxSeq(turnEvidence(c.anchored), { get: () => undefined }),
          ),
        );
      }
      return;
    }
    case "mark_user_confirmed": {
      const coll = c.collection!;
      const it = findItem(draft, coll, op.id)!;
      it.source = "user_confirmed";
      it.updated_in_revision = rev;
      if (c.confirm) it.evidence = mergeEvidence([c.confirm], it.evidence);
      if (coll === "decisions") {
        const d = it as unknown as {
          status: string;
          chosen?: string;
          recommended: string;
        };
        d.status = "accepted";
        d.chosen ??= d.recommended;
      }
      return;
    }
    default: {
      const coll = c.collection!;
      const payload = normalizePayload(
        coll,
        (op as { item: Record<string, unknown> }).item,
      );
      const existing = findItem(
        draft,
        coll,
        (op as { item: { id: string } }).item.id,
      );
      const reviveRef: EvidenceItem[] = c.revive
        ? [
            {
              kind: "turn",
              ref: { turn_id: c.revive.turn_id, anchor: c.revive.anchor },
            },
          ]
        : [];
      if (existing) {
        Object.assign(existing, payload);
        existing.evidence = mergeEvidence(existing.evidence, [
          ...reviveRef,
          ...c.anchored,
        ]);
        existing.updated_in_revision = rev;
      } else {
        const id = (op as { item: { id: string } }).item.id;
        const meta: Record<string, unknown> = {
          id,
          source: c.sourceResolved ?? "ai_inferred",
          evidence: mergeEvidence([], [...reviveRef, ...c.anchored]),
          user_pinned: false,
          updated_in_revision: rev,
          introduced_after_turn_seq: watermark,
          ...payload,
        };
        if (coll === "decisions") meta["status"] = "pending";
        arrOf(draft, coll).push(meta as unknown as SchemeItemMeta);
      }
      return;
    }
  }
}

function applyAll(
  applied: Classified[],
  state: LedgerState,
  rev: number,
  watermark: number,
  ctx: MergeContext,
): { draft: SchemeDraftV2; graveyard: GraveyardEntry[] } {
  const draft = clone(state.draft);
  const graveyard = clone(state.graveyard);
  for (const c of applied) {
    applyOne(c, draft, graveyard, rev, watermark, ctx);
    if (c.revive)
      reviveTombs(
        graveyard,
        c.revive.rejected_ids,
        c.revive.turn_id,
        c.revive.anchor,
        rev,
      );
  }
  draft.scheme_revision = rev;
  return { draft, graveyard };
}

// ───────────── 主函数 ─────────────

function toVerdict(c: Classified, warnings: WarningCode[]): OpVerdict {
  return {
    index: c.index,
    op_kind: c.op.op,
    ...(c.targetId !== undefined ? { target_id: c.targetId } : {}),
    verdict: c.verdict,
    ...(c.code !== undefined ? { code: c.code } : {}),
    ...(c.detail !== undefined ? { detail: c.detail } : {}),
    warnings: [...new Set(warnings)],
    stage: c.stage,
  };
}

export function mergeSchemePatch(input: MergeInput): MergeResult {
  const { state, patch, transcript, ctx } = input;
  const cur = state.draft.scheme_revision;
  const journal: MergeJournal = {
    base_revision: null,
    observed_revision: cur,
    verdicts: [],
    patch_warnings: [],
  };

  if (stageFreezeGate(state))
    return {
      status: "frozen",
      code: "E_PATCH_FROZEN",
      batch_consumed: false,
      journal,
    };
  if (stageAuditBase(state, transcript).length > 0)
    return {
      status: "rejected",
      code: "E_STATE_CORRUPT",
      batch_consumed: false,
      journal,
    };

  const parsed = stageParse(patch);
  if (!parsed.ok)
    return {
      status: "rejected",
      code: parsed.code,
      batch_consumed: false,
      journal,
    };
  const pv = parsed.value;
  journal.base_revision = pv.base_revision;
  journal.patch_warnings = pv.patch_warnings;
  if (pv.partner_hint !== undefined) journal.partner_hint = pv.partner_hint;

  const st = stageResolveStructure(pv, state, transcript);
  if (!st.ok)
    return {
      status: "rejected",
      code: st.code,
      batch_consumed: false,
      journal,
    };

  const fresh = stageFreshness(pv.base_revision, cur, ctx.attempt);
  if (fresh === "AHEAD")
    return {
      status: "rejected",
      code: "E_PATCH_REVISION_AHEAD",
      batch_consumed: false,
      journal,
    };
  if (fresh === "STALE_RETRY")
    return {
      status: "stale",
      code: "E_PATCH_STALE",
      retry: true,
      batch_consumed: false,
      journal,
    };
  if (fresh === "STALE_EXHAUSTED")
    return {
      status: "stale",
      code: "E_PATCH_STALE_RETRY_EXHAUSTED",
      retry: false,
      batch_consumed: false,
      journal,
    };

  const sv = st.value;
  const classified = stageDependencyClosure(
    stageClassifyOps(pv, sv, state, transcript),
    sv.baselineIds,
  );
  const suggestions = stageBuildSuggestions(classified, state, ctx);
  const verdictsOf = (): OpVerdict[] =>
    classified.map((c) => toVerdict(c, c.opWarnings));
  const applied = classified.filter((c) => c.verdict === "APPLY");

  if (applied.length === 0) {
    journal.verdicts = verdictsOf();
    return {
      status: "noop",
      next: { ...state, suggestions: [...state.suggestions, ...suggestions] },
      expected_prev_revision: cur,
      batch_consumed: true,
      journal,
    };
  }

  const rev = cur + 1;
  const { draft, graveyard } = applyAll(applied, state, rev, sv.watermark, ctx);
  const issues = auditLedgerState(
    { draft, graveyard, suggestions: state.suggestions },
    transcript,
  );
  if (issues.length > 0)
    return {
      status: "rejected",
      code: "E_PATCH_POST_INVARIANT",
      batch_consumed: false,
      journal,
    };

  journal.verdicts = verdictsOf();
  return {
    status: "applied",
    next: {
      draft,
      graveyard,
      suggestions: [...state.suggestions, ...suggestions],
    },
    expected_prev_revision: cur,
    revision: rev,
    batch_consumed: true,
    journal,
  };
}

// ───────────── 用户编辑与卡片操作（§5.4 配套函数） ─────────────

function failIfFrozen(state: LedgerState): EditResult | undefined {
  return state.draft.frozen ? { ok: false, code: "E_PATCH_FROZEN" } : undefined;
}

function finish(
  state: LedgerState,
  draft: SchemeDraftV2,
  graveyard: GraveyardEntry[],
  suggestions: Suggestion[],
  transcript: TranscriptView,
): EditResult {
  const issues = auditLedgerState(
    { draft, graveyard, suggestions },
    transcript,
  );
  if (issues.length > 0) return { ok: false, code: "E_PATCH_POST_INVARIANT" };
  return {
    ok: true,
    state: { draft, graveyard, suggestions },
    expected_prev_revision: state.draft.scheme_revision,
    revision: draft.scheme_revision,
  };
}

/** 用户手改：打钉选，来源改为 user_edited，追加 EditRef，修订号 +1 */
export function applyUserEdit(
  state: LedgerState,
  edit: UserEdit,
  _ctx: MergeContext,
  transcript: TranscriptView,
): EditResult {
  const f = failIfFrozen(state);
  if (f) return f;
  if (!findItem(state.draft, edit.collection, edit.id))
    return { ok: false, code: "E_PATCH_DANGLING_ID" };
  const draft = clone(state.draft);
  const rev = draft.scheme_revision + 1;
  const item = findItem(draft, edit.collection, edit.id)!;
  for (const k of BUSINESS_KEYS[edit.collection])
    if (k in edit.patch)
      (item as unknown as Record<string, unknown>)[k] = edit.patch[k];
  const ref: EditRef = {
    edit_event_id: edit.edit_event_id,
    edited_at: edit.edited_at,
    ...(edit.field_name !== undefined ? { field_name: edit.field_name } : {}),
    ...(edit.previous_value !== undefined
      ? { previous_value: edit.previous_value }
      : {}),
  };
  item.user_pinned = true;
  item.source = "user_edited";
  item.evidence = [...item.evidence, { kind: "edit", ref }];
  item.updated_in_revision = rev;
  draft.scheme_revision = rev;
  return finish(
    state,
    draft,
    clone(state.graveyard),
    state.suggestions,
    transcript,
  );
}

/** 撤销：内容回到 previous，修订号仍 +1（K-7）；内容有变化的条目打钉选 */
export function undoLastPatch(
  state: LedgerState,
  previous: SchemeDraftV2,
  _edit: UserEdit,
  _ctx: MergeContext,
  transcript: TranscriptView,
): EditResult {
  const f = failIfFrozen(state);
  if (f) return f;
  const rev = state.draft.scheme_revision + 1;
  const restored = clone(previous);
  restored.frozen = state.draft.frozen;
  restored.scheme_revision = rev;
  for (const c of COLLECTIONS) {
    const arr = arrOf(restored, c);
    arr.forEach((item, i) => {
      const cur = findItem(state.draft, c, item.id);
      if (!cur) {
        arr[i] = { ...item, user_pinned: true, updated_in_revision: rev };
        return;
      }
      const same =
        stableStringify(
          pickBusiness(
            item as unknown as Record<string, unknown>,
            BUSINESS_KEYS[c],
          ),
        ) ===
        stableStringify(
          pickBusiness(
            cur as unknown as Record<string, unknown>,
            BUSINESS_KEYS[c],
          ),
        );
      arr[i] = same
        ? clone(cur)
        : { ...item, user_pinned: true, updated_in_revision: rev };
    });
  }
  return finish(
    state,
    restored,
    clone(state.graveyard),
    state.suggestions,
    transcript,
  );
}

function pendingSuggestion(
  state: LedgerState,
  id: string,
): Suggestion | EditErrorCode {
  const s = state.suggestions.find((x) => x.suggestion_id === id);
  if (!s) return "E_SUGGESTION_NOT_FOUND";
  if (s.status !== "pending") return "E_SUGGESTION_NOT_PENDING";
  return s;
}

/** 采纳卡片：按卡片 op 强制写入（来源 user_edited，保留钉选），并复活关联墓碑 */
export function acceptSuggestion(
  state: LedgerState,
  suggestion_id: string,
  edit: UserEdit,
  ctx: MergeContext,
  transcript: TranscriptView,
): EditResult {
  const f = failIfFrozen(state);
  if (f) return f;
  const s = pendingSuggestion(state, suggestion_id);
  if (typeof s === "string") return { ok: false, code: s };

  const draft = clone(state.draft);
  const graveyard = clone(state.graveyard);
  const rev = draft.scheme_revision + 1;
  const editRef: EvidenceItem = {
    kind: "edit",
    ref: { edit_event_id: edit.edit_event_id, edited_at: edit.edited_at },
  };
  const op = s.op;
  const coll = collectionOfOp(op);

  if (coll && op.op in UPSERT_OP_COLLECTION) {
    const item = (op as { item: Record<string, unknown> }).item;
    const payload = normalizePayload(coll, item);
    const ex = findItem(draft, coll, item["id"] as string);
    if (ex) {
      Object.assign(ex, payload);
      ex.source = "user_edited";
      ex.evidence = mergeEvidence(ex.evidence, [...s.evidence, editRef]);
      ex.updated_in_revision = rev;
      if (coll === "decisions") {
        const d = ex as unknown as {
          status: string;
          chosen?: string;
          recommended: string;
        };
        d.status = "accepted";
        d.chosen ??= d.recommended;
      }
    } else {
      const meta: Record<string, unknown> = {
        id: item["id"],
        source: "user_edited",
        evidence: mergeEvidence([], [...s.evidence, editRef]),
        user_pinned: true,
        updated_in_revision: rev,
        introduced_after_turn_seq: s.source_seq,
        ...payload,
      };
      if (coll === "decisions") {
        meta["status"] = "accepted";
        meta["chosen"] = payload["recommended"];
      }
      if (coll === "conflicts") meta["chosen_id"] = null;
      arrOf(draft, coll).push(meta as unknown as SchemeItemMeta);
    }
  } else if (op.op === "remove_item") {
    removeFrom(draft, coll!, op.id);
  } else if (op.op === "reject_item") {
    const gone = removeFrom(draft, coll!, op.id);
    if (gone)
      graveyard.push(
        tombstoneOf(
          draft,
          gone,
          coll!,
          [...s.evidence, editRef],
          rev,
          ctx,
          op.reason ?? "用户接受了否决建议",
          s.source_seq,
        ),
      );
  } else if (op.op === "add_open_question") {
    draft.open_questions.push({
      id: ctx.newId("ITEM"),
      source: "user_edited",
      evidence: mergeEvidence([], [...s.evidence, editRef]),
      user_pinned: true,
      updated_in_revision: rev,
      introduced_after_turn_seq: s.source_seq,
      text: op.text,
    });
  } else if (
    op.op === "set_title" ||
    op.op === "set_summary" ||
    op.op === "set_audience"
  ) {
    draft[
      op.op === "set_title"
        ? "title"
        : op.op === "set_summary"
          ? "summary"
          : "audience"
    ] = op.value;
  } else if (op.op === "set_size_hint") {
    draft.size_hint = op.value;
  }

  // 复活：卡片显式复活（revive）或随卡片的软墓碑 / 模糊墓碑
  const anchorEv = s.evidence.find(
    (e) => e.kind === "turn" && e.ref.anchor !== undefined,
  );
  if (s.revive)
    reviveTombs(
      graveyard,
      s.revive.rejected_ids,
      s.revive.turn_id,
      s.revive.anchor,
      rev,
    );
  else if (
    s.tombstone_ids.length > 0 &&
    anchorEv &&
    anchorEv.kind === "turn" &&
    anchorEv.ref.anchor
  )
    reviveTombs(
      graveyard,
      s.tombstone_ids,
      anchorEv.ref.turn_id,
      anchorEv.ref.anchor,
      rev,
    );

  draft.scheme_revision = rev;
  const suggestions = state.suggestions.map((x) =>
    x.suggestion_id === s.suggestion_id
      ? { ...x, status: "accepted" as const }
      : x,
  );
  void transcript;
  return finish(state, draft, graveyard, suggestions, transcript);
}

/** 拒绝卡片：卡片 op 的内容指纹以 user / disallow_revival:true 入墓，同一建议不会再冒出（D-3） */
export function rejectSuggestion(
  state: LedgerState,
  suggestion_id: string,
  edit: UserEdit,
  ctx: MergeContext,
  transcript: TranscriptView,
): EditResult {
  const f = failIfFrozen(state);
  if (f) return f;
  const s = pendingSuggestion(state, suggestion_id);
  if (typeof s === "string") return { ok: false, code: s };

  const draft = clone(state.draft);
  const graveyard = clone(state.graveyard);
  const rev = draft.scheme_revision + 1;
  let proposal = mainTextsOfOp(s.op)[0] ?? "";
  if (proposal === "" && s.target) {
    const it = findItem(draft, s.target.collection, s.target.id);
    if (it)
      proposal = mainTextOf(
        s.target.collection,
        it as unknown as Record<string, unknown>,
      );
  }
  const quotes = turnEvidence(s.evidence).flatMap((r) =>
    r.quote !== undefined ? [r.quote] : [],
  );
  void edit;
  graveyard.push(
    buildTombstone({
      rejected_id: ctx.newId("REJ"),
      proposal,
      rejected_by: "user",
      rejection_reason: "用户拒绝了建议",
      evidence: s.evidence,
      disallow_revival: true,
      updated_in_revision: rev,
      ...(s.target ? { item_ref: s.target } : {}),
      rejected_after_turn_seq: s.source_seq,
      quotes,
    }),
  );
  draft.scheme_revision = rev;
  const suggestions = state.suggestions.map((x) =>
    x.suggestion_id === s.suggestion_id
      ? { ...x, status: "rejected" as const }
      : x,
  );
  return finish(state, draft, graveyard, suggestions, transcript);
}

/** 用户直接否决某条目：移出方案并入墓（不经补丁） */
export function rejectItemToGraveyard(
  state: LedgerState,
  input: RejectItemInput,
  ctx: MergeContext,
  transcript: TranscriptView,
): EditResult {
  const f = failIfFrozen(state);
  if (f) return f;
  const existing = findItem(state.draft, input.collection, input.id);
  if (!existing) return { ok: false, code: "E_PATCH_DANGLING_ID" };
  const draft = clone(state.draft);
  const graveyard = clone(state.graveyard);
  const rev = draft.scheme_revision + 1;
  const gone = removeFrom(draft, input.collection, input.id)!;
  graveyard.push(
    tombstoneOf(
      draft,
      gone,
      input.collection,
      input.evidence,
      rev,
      ctx,
      input.reason ?? "用户否决",
      input.rejected_after_turn_seq,
    ),
  );
  draft.scheme_revision = rev;
  return finish(state, draft, graveyard, state.suggestions, transcript);
}

/** 冻结时作废所有待决卡（D-6） */
export function expireSuggestionsOnFreeze(state: LedgerState): LedgerState {
  return {
    ...state,
    suggestions: state.suggestions.map((s) =>
      s.status === "pending"
        ? { ...s, status: "expired_by_freeze" as const }
        : s,
    ),
  };
}

/** 台账投影（§5.6）。归因子账本 K-14 由调用方传入，本函数不生成。 */
export function projectEvidenceLedger(
  state: LedgerState,
  attributions: unknown[] = [],
): EvidenceLedgerProjection {
  const d = state.draft;
  return {
    claims: {
      goals: clone(d.goals),
      boundaries: clone(d.out_of_scope),
      acceptance: clone(d.acceptance),
    },
    decisions: d.decisions.map((x) => ({
      ...clone(x),
      topic: x.question,
      chosen: x.chosen ?? x.recommended,
      status: x.status === "pending" ? "pending" : "confirmed",
    })),
    graveyard: clone(state.graveyard),
    attributions: clone(attributions),
  };
}

// 仅供测试与调用方引用的类型再导出
export type { EditErrorCode, SuggestionKind };
export {
  SUGGESTION_KINDS,
  NEGATION_CUES,
  graphemeCount,
  matchNormalize,
  normalizeForAnchor,
};
