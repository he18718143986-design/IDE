/**
 * 意图编译器生成端 Schema 与组装（TASK-J.10）。
 *
 * 实施口径：docs/specs/intent-compiler-prompt.md §6.4；
 * ADR-0014 / DEC-004：生成 Schema **不含** partner_hint，组装结果不回流右栏。
 * 纯函数：零 node:*、零时钟、零网络。
 */
import { z } from "zod";
import type {
  SchemeOp,
  SchemePatch,
  TurnRef,
} from "./scheme-patch-types";

/** 别名 → turn_id；只在 Daemon 内存，不进提示词 */
export type AliasMap = ReadonlyMap<string, string>;

export interface AssembleBatch {
  /** 本批用户别名，如 ["U7"] */
  batchAliases: readonly string[];
  /** 本批对应的真实 turn_id（与 batchAliases 同序或按 aliasMap 解析） */
  batchTurnIds: readonly string[];
}

export type AssembleSubreason =
  | "assemble.unknown_qid"
  | "assemble.revival_not_in_batch"
  | "assemble.confirm_not_in_batch"
  | "assemble.reject_not_in_batch"
  | "assemble.unknown_alias"
  | "assemble.dangling_new_id"
  | "assemble.forbidden_field"
  | "assemble.schema_invalid"
  | "assemble.partner_hint_forbidden"
  | "assemble.empty_evidence"
  | "assemble.unknown_op";

export interface AssembleError {
  ok: false;
  code: "E_PATCH_SCHEMA_INVALID";
  subreason: AssembleSubreason;
  detail?: string;
}

export interface AssembleOk {
  ok: true;
  patch: SchemePatch;
}

export type AssembleResult = AssembleOk | AssembleError;

export interface CompilerSchemaEnums {
  /** 窗口内全部 U 别名 */
  ua: readonly string[];
  /** 本批 U 别名 */
  ub: readonly string[];
  /** 现有条目 id */
  ids: readonly string[];
  /** 注入的墓碑 id */
  rej: readonly string[];
}

const QID_RE = /^q[0-9]{1,2}$/;
const NEW_ID_RE = /^new:[A-Za-z0-9_.:-]+$/;

function enumOrNever(values: readonly string[]): z.ZodType<string> {
  if (values.length === 0) {
    // 空枚举：任何字符串都失败（仍允许 schema 构造）
    return z.string().refine(() => false, { message: "empty enum" });
  }
  return z.enum(values as [string, ...string[]]);
}

function quoteItemSchema(ua: readonly string[]) {
  return z
    .object({
      qid: z.string().regex(QID_RE),
      from: enumOrNever(ua),
      text: z
        .string()
        .min(1)
        .max(120)
        .refine((t) => /\S/.test(t), { message: "text must contain non-space" }),
    })
    .strict();
}

function evSchema() {
  return z
    .array(z.object({ qid: z.string() }).strict())
    .min(1)
    .max(4);
}

function revivalSchema(rej: readonly string[]) {
  return z
    .object({
      rejected_id: enumOrNever(rej.length > 0 ? rej : ["__none__"]),
      qid: z.string(),
    })
    .strict()
    .nullable();
}

function moduleItemSchema(ids: readonly string[]) {
  const idSchema =
    ids.length > 0
      ? z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE)])
      : z.string().regex(NEW_ID_RE);
  return z
    .object({
      id: idSchema,
      name: z.string().min(1).max(80),
      purpose: z.string().min(1).max(200),
      user_visible: z.boolean(),
      kind: z.enum(["new", "change_existing"]),
      project_anchor: z.string().max(120).nullable(),
    })
    .strict();
}

function flowItemSchema(ids: readonly string[]) {
  const idSchema =
    ids.length > 0
      ? z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE)])
      : z.string().regex(NEW_ID_RE);
  const modId =
    ids.length > 0
      ? z
          .union([enumOrNever(ids), z.string().regex(NEW_ID_RE)])
          .nullable()
      : z.string().regex(NEW_ID_RE).nullable();
  return z
    .object({
      id: idSchema,
      name: z.string().min(1).max(80),
      steps: z
        .array(
          z
            .object({
              actor: z.string().min(1).max(40),
              action: z.string().min(1).max(120),
              module_id: modId,
            })
            .strict(),
        )
        .min(1)
        .max(24),
    })
    .strict();
}

function entityItemSchema(ids: readonly string[]) {
  const idSchema =
    ids.length > 0
      ? z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE)])
      : z.string().regex(NEW_ID_RE);
  return z
    .object({
      id: idSchema,
      name: z.string().min(1).max(80),
      fields_hint: z.array(z.string().max(40)).max(24),
    })
    .strict();
}

function textItemSchema(ids: readonly string[], withCheck = false) {
  const idSchema =
    ids.length > 0
      ? z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE)])
      : z.string().regex(NEW_ID_RE);
  if (withCheck) {
    return z
      .object({
        id: idSchema,
        text: z.string().min(1).max(200),
        check: z.enum(["auto", "playtest", "both"]),
      })
      .strict();
  }
  return z
    .object({
      id: idSchema,
      text: z.string().min(1).max(200),
    })
    .strict();
}

function decisionItemSchema(ids: readonly string[]) {
  const idSchema =
    ids.length > 0
      ? z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE)])
      : z.string().regex(NEW_ID_RE);
  return z
    .object({
      id: idSchema,
      question: z.string().min(1).max(200),
      recommended: z.string().min(1).max(200),
      alternatives: z.array(z.string().max(120)).max(8),
      rationale: z.string().max(200),
      risk: z.enum(["low", "high"]),
    })
    .strict();
}

function conflictItemSchema(ids: readonly string[]) {
  const idSchema =
    ids.length > 0
      ? z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE)])
      : z.string().regex(NEW_ID_RE);
  return z
    .object({
      id: idSchema,
      question: z.string().min(1).max(200),
      options: z
        .array(
          z
            .object({
              id: z.string().min(1).max(40),
              label: z.string().min(1).max(120),
              qids: z.array(z.string()).min(1).max(4),
            })
            .strict(),
        )
        .min(2)
        .max(6),
    })
    .strict();
}

/**
 * 按别名/本批/现有 id/墓碑 id 动态构造生成端 zod Schema。
 * 故意不含：occurrence、anchor、edit 证据、user_confirmed、base_revision、
 * compiled_from_turns、partner_hint、introduced_after_turn_seq、attributions。
 */
export function buildCompilerOutputSchema(enums: CompilerSchemaEnums) {
  const { ua, ub, ids, rej } = enums;
  const uaEnum = ua.length > 0 ? ua : ["__no_ua__"];
  const ubEnum = ub.length > 0 ? ub : ["__no_ub__"];
  const idEnum = ids;
  const rejEnum = rej;

  const revival = revivalSchema(rejEnum).optional();
  // confirm / reject / remove / revival 证据必须能引用本批摘录（组装期再验 from∈UB）
  const idRef =
    idEnum.length > 0
      ? enumOrNever(idEnum)
      : z.string().refine(() => false, { message: "no ids" });

  const setText = z
    .object({
      op: z.enum(["set_title", "set_summary", "set_audience"]),
      value: z.string().max(200),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const upsertModule = z
    .object({
      op: z.literal("upsert_module"),
      source: z.enum(["user_said", "ai_inferred"]),
      item: moduleItemSchema(idEnum),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const upsertFlow = z
    .object({
      op: z.literal("upsert_flow"),
      source: z.enum(["user_said", "ai_inferred"]),
      item: flowItemSchema(idEnum),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const upsertEntity = z
    .object({
      op: z.literal("upsert_entity"),
      source: z.enum(["user_said", "ai_inferred"]),
      item: entityItemSchema(idEnum),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const upsertGoal = z
    .object({
      op: z.literal("upsert_goal"),
      source: z.enum(["user_said", "ai_inferred"]),
      item: textItemSchema(idEnum),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const upsertOos = z
    .object({
      op: z.literal("upsert_out_of_scope"),
      source: z.enum(["user_said", "ai_inferred"]),
      item: textItemSchema(idEnum),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const upsertAcc = z
    .object({
      op: z.literal("upsert_acceptance"),
      source: z.enum(["user_said", "ai_inferred"]),
      item: textItemSchema(idEnum, true),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const removeItem = z
    .object({
      op: z.literal("remove_item"),
      id: idRef,
      reason: z.string().max(80),
      evidence: evSchema(),
    })
    .strict();

  const rejectItem = z
    .object({
      op: z.literal("reject_item"),
      id: idRef,
      reason: z.string().max(80).optional(),
      evidence: evSchema(),
    })
    .strict();

  const propose = z
    .object({
      op: z.literal("propose_decision"),
      item: decisionItemSchema(idEnum),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const raise = z
    .object({
      op: z.literal("raise_conflict"),
      item: conflictItemSchema(idEnum),
      evidence: evSchema(),
      revival,
    })
    .strict();

  const confirm = z
    .object({
      op: z.literal("confirm"),
      id: idRef,
      evidence: evSchema(),
    })
    .strict();

  const addQ = z
    .object({
      op: z.literal("add_open_question"),
      text: z.string().max(120),
      evidence: evSchema(),
    })
    .strict();

  const sizeHint = z
    .object({
      op: z.literal("set_size_hint"),
      value: z.enum(["tiny", "standard", "large"]),
      evidence: evSchema(),
    })
    .strict();

  // 强制 Schema 认识 ubEnum（编译期保留引用，避免 tree-shake 误判未用）
  void ubEnum;
  void uaEnum;

  return z
    .object({
      quotes: z.array(quoteItemSchema(uaEnum)).max(24),
      ops: z
        .array(
          z.union([
            setText,
            upsertModule,
            upsertFlow,
            upsertEntity,
            upsertGoal,
            upsertOos,
            upsertAcc,
            removeItem,
            rejectItem,
            propose,
            raise,
            confirm,
            addQ,
            sizeHint,
          ]),
        )
        .max(24),
    })
    .strict();
}

export type CompilerRawOutput = z.infer<
  ReturnType<typeof buildCompilerOutputSchema>
>;

const FORBIDDEN_TOP = new Set([
  "base_revision",
  "compiled_from_turns",
  "partner_hint",
  "attributions",
]);

const FORBIDDEN_EV_KEYS = new Set([
  "occurrence",
  "anchor",
  "kind",
  "edit",
  "ref",
  "turn_id",
]);

function fail(
  subreason: AssembleSubreason,
  detail?: string,
): AssembleError {
  return detail === undefined
    ? { ok: false, code: "E_PATCH_SCHEMA_INVALID", subreason }
    : { ok: false, code: "E_PATCH_SCHEMA_INVALID", subreason, detail };
}

function looksLikeForbiddenEvidence(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (FORBIDDEN_EV_KEYS.has(k) && k !== "qid") return true;
  }
  if ("occurrence" in o || "anchor" in o) return true;
  if (o["kind"] === "edit") return true;
  return false;
}

/**
 * 将模型原始输出组装为引擎 SchemePatch。
 * - 别名 → turn_id；qid 展开；new: id 替换；代填 base_revision / compiled_from_turns
 * - 失败一律 E_PATCH_SCHEMA_INVALID + 子原因
 */
export function assembleCompilerOutput(
  raw: unknown,
  aliasMap: AliasMap,
  baseRevision: number,
  batch: AssembleBatch,
  enums: CompilerSchemaEnums,
  newId: (prefix: "ITEM") => string = (() => {
    let n = 0;
    return () => `ITEM-${++n}`;
  })(),
): AssembleResult {
  if (raw == null || typeof raw !== "object") {
    return fail("assemble.schema_invalid", "not_object");
  }
  const obj = raw as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_TOP.has(k)) {
      return fail(
        k === "partner_hint"
          ? "assemble.partner_hint_forbidden"
          : "assemble.forbidden_field",
        k,
      );
    }
  }

  const schema = buildCompilerOutputSchema(enums);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return fail("assemble.schema_invalid", parsed.error.issues[0]?.message);
  }
  const data = parsed.data;

  const batchAliasSet = new Set(batch.batchAliases);
  const quoteByQid = new Map<
    string,
    { from: string; text: string; turn_id: string }
  >();

  for (const q of data.quotes) {
    const turnId = aliasMap.get(q.from);
    if (!turnId) return fail("assemble.unknown_alias", q.from);
    if (quoteByQid.has(q.qid)) {
      return fail("assemble.schema_invalid", `duplicate_qid:${q.qid}`);
    }
    quoteByQid.set(q.qid, { from: q.from, text: q.text, turn_id: turnId });
  }

  const idRemap = new Map<string, string>();

  const resolveId = (id: string): string | AssembleError => {
    if (id.startsWith("new:")) {
      const existing = idRemap.get(id);
      if (existing) return existing;
      const nid = newId("ITEM");
      idRemap.set(id, nid);
      return nid;
    }
    return id;
  };

  const expandEvidence = (
    refs: { qid: string }[],
    requireBatch: boolean,
    batchSubreason: AssembleSubreason,
  ): TurnRef[] | AssembleError => {
    const out: TurnRef[] = [];
    for (const r of refs) {
      if (looksLikeForbiddenEvidence(r)) {
        return fail("assemble.forbidden_field", "evidence");
      }
      const q = quoteByQid.get(r.qid);
      if (!q) return fail("assemble.unknown_qid", r.qid);
      if (requireBatch && !batchAliasSet.has(q.from)) {
        return fail(batchSubreason, q.from);
      }
      out.push({ turn_id: q.turn_id, quote: q.text });
    }
    if (out.length === 0) return fail("assemble.empty_evidence");
    return out;
  };

  const expandRevival = (
    revival: { rejected_id: string; qid: string } | null | undefined,
  ): { rejected_id: string; evidence: TurnRef[] } | undefined | AssembleError => {
    if (revival == null) return undefined;
    const q = quoteByQid.get(revival.qid);
    if (!q) return fail("assemble.unknown_qid", revival.qid);
    if (!batchAliasSet.has(q.from)) {
      return fail("assemble.revival_not_in_batch", q.from);
    }
    return {
      rejected_id: revival.rejected_id,
      evidence: [{ turn_id: q.turn_id, quote: q.text }],
    };
  };

  const ops: SchemeOp[] = [];

  for (const op of data.ops) {
    // 深检：禁止偷渡 occurrence/anchor/edit/user_confirmed
    const blob = JSON.stringify(op);
    if (
      /"occurrence"\s*:/.test(blob) ||
      /"anchor"\s*:/.test(blob) ||
      /"kind"\s*:\s*"edit"/.test(blob) ||
      /"source"\s*:\s*"user_confirmed"/.test(blob) ||
      /"introduced_after_turn_seq"\s*:/.test(blob)
    ) {
      return fail("assemble.forbidden_field", "op_payload");
    }

    switch (op.op) {
      case "set_title":
      case "set_summary":
      case "set_audience": {
        const evidence = expandEvidence(op.evidence, false, "assemble.unknown_qid");
        if (!Array.isArray(evidence)) return evidence;
        const revivalOrErr = expandRevival(op.revival);
        if (revivalOrErr && "ok" in revivalOrErr) return revivalOrErr;
        ops.push({
          op: op.op,
          value: op.value,
          evidence,
          ...(revivalOrErr ? { revival: revivalOrErr } : {}),
        });
        break;
      }
      case "upsert_module":
      case "upsert_flow":
      case "upsert_entity":
      case "upsert_goal":
      case "upsert_out_of_scope":
      case "upsert_acceptance": {
        const evidence = expandEvidence(op.evidence, false, "assemble.unknown_qid");
        if (!Array.isArray(evidence)) return evidence;
        const revivalOrErr = expandRevival(op.revival);
        if (revivalOrErr && "ok" in revivalOrErr) return revivalOrErr;
        const item = { ...op.item } as Record<string, unknown> & { id: string };
        const rid = resolveId(String(item.id));
        if (typeof rid !== "string") return rid;
        item.id = rid;
        if (op.op === "upsert_flow" && Array.isArray(item["steps"])) {
          item["steps"] = (item["steps"] as { module_id?: string | null }[]).map(
            (s) => {
              if (s.module_id == null) return s;
              const mid = resolveId(s.module_id);
              if (typeof mid !== "string") return s;
              return { ...s, module_id: mid };
            },
          );
        }
        item["source"] = op.source;
        // 剥离 project_anchor null → undefined 以贴合引擎可选字段
        if (item["project_anchor"] === null) delete item["project_anchor"];
        ops.push({
          op: op.op,
          item: item as SchemeOp & { item: never } extends never
            ? typeof item
            : never,
          evidence,
          ...(revivalOrErr ? { revival: revivalOrErr } : {}),
        } as SchemeOp);
        break;
      }
      case "remove_item": {
        const evidence = expandEvidence(op.evidence, false, "assemble.unknown_qid");
        if (!Array.isArray(evidence)) return evidence;
        ops.push({
          op: "remove_item",
          id: op.id,
          reason: op.reason,
          evidence,
        });
        break;
      }
      case "reject_item": {
        const evidence = expandEvidence(
          op.evidence,
          true,
          "assemble.reject_not_in_batch",
        );
        if (!Array.isArray(evidence)) return evidence;
        ops.push({
          op: "reject_item",
          id: op.id,
          ...(op.reason !== undefined
            ? { reason: op.reason }
            : { reason: "用户在聊天中否决" }),
          evidence,
        });
        break;
      }
      case "propose_decision":
      case "raise_conflict": {
        const evidence = expandEvidence(op.evidence, false, "assemble.unknown_qid");
        if (!Array.isArray(evidence)) return evidence;
        const revivalOrErr = expandRevival(op.revival);
        if (revivalOrErr && "ok" in revivalOrErr) return revivalOrErr;
        const item = { ...op.item } as Record<string, unknown> & { id: string };
        const rid = resolveId(String(item.id));
        if (typeof rid !== "string") return rid;
        item.id = rid;
        if (op.op === "raise_conflict" && Array.isArray(item["options"])) {
          const options = [];
          for (const opt of item["options"] as {
            id: string;
            label: string;
            qids: string[];
          }[]) {
            const ev: TurnRef[] = [];
            for (const qid of opt.qids) {
              const q = quoteByQid.get(qid);
              if (!q) return fail("assemble.unknown_qid", qid);
              ev.push({ turn_id: q.turn_id, quote: q.text });
            }
            options.push({ id: opt.id, label: opt.label, evidence: ev });
          }
          item["options"] = options;
        }
        // 生成端 propose_decision 禁止 status/chosen
        delete item["status"];
        delete item["chosen"];
        ops.push({
          op: op.op,
          item: item as never,
          evidence,
          ...(revivalOrErr ? { revival: revivalOrErr } : {}),
        } as SchemeOp);
        break;
      }
      case "confirm": {
        const evidence = expandEvidence(
          op.evidence,
          true,
          "assemble.confirm_not_in_batch",
        );
        if (!Array.isArray(evidence)) return evidence;
        ops.push({
          op: "mark_user_confirmed",
          id: op.id,
          evidence,
        });
        break;
      }
      case "add_open_question": {
        const evidence = expandEvidence(op.evidence, false, "assemble.unknown_qid");
        if (!Array.isArray(evidence)) return evidence;
        ops.push({ op: "add_open_question", text: op.text, evidence });
        break;
      }
      case "set_size_hint": {
        const evidence = expandEvidence(op.evidence, false, "assemble.unknown_qid");
        if (!Array.isArray(evidence)) return evidence;
        ops.push({ op: "set_size_hint", value: op.value, evidence });
        break;
      }
      default:
        return fail("assemble.unknown_op");
    }
  }

  // 同一补丁内 new: 引用若有未解析残留（理论上 resolveId 已处理）
  for (const [k, v] of idRemap) {
    if (!v) return fail("assemble.dangling_new_id", k);
  }

  const compiled =
    batch.batchTurnIds.length > 0
      ? [...batch.batchTurnIds]
      : batch.batchAliases
          .map((a) => aliasMap.get(a))
          .filter((x): x is string => typeof x === "string");

  return {
    ok: true,
    patch: {
      base_revision: baseRevision,
      compiled_from_turns: compiled,
      ops,
    },
  };
}

/** S 类：生成 Schema / 组装后不可能合法出现的引擎码（接线验收用） */
export const S_CLASS_CODES_KILLED_BY_SCHEMA = [
  "E_PATCH_BATCH_INVALID", // 模型不输出 compiled_from_turns
  "E_PATCH_REVISION_AHEAD", // 模型不输出 base_revision
  "E_EVIDENCE_EDIT_FORGED", // 无 edit 证据形态
  "E_QUOTE_OCCURRENCE_OUT_OF_RANGE", // 无 occurrence
  "E_SOURCE_CLAIM_FORBIDDEN", // source 仅 user_said|ai_inferred
  "W_COMPILER_ANCHOR_IGNORED", // 无 anchor / introduced_after_turn_seq
  "W_PARTNER_HINT_TRUNCATED", // 无 partner_hint（ADR-0014）
  "W_REVIVAL_OCCURRENCE_IGNORED", // 无 occurrence
] as const;
