import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DemoGate, SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import type { SchemeBinding } from "../../src/lib/contract.schema";
import { writeJsonAtomic } from "../../src/lib/state-machine";
import type { TranscriptRecord } from "../supervisor/intent-compiler/transcript-store";

/**
 * TASK-C.22 / SSOT v2.0.2 §5.2.1：确认方案不可变快照。
 * TASK-J.4：schema 1.1 绑定 ScopePlan；digest 纳入 plan_digest。
 * TASK-J.18b：schema 1.2 绑定 graveyard（GAP-W2）；digest 纳入 graveyard_digest。
 *
 * 只负责“冻结事实”，不负责签署。相同 confirmation_id + 相同内容幂等返回；
 * 同一 id 对应不同内容则拒绝，避免前端重试时悄悄替换用户已确认的方案。
 */

export const SCHEME_SNAPSHOT_DIR = ".stagent/drafts/schemes" as const;
/** 现行写入版本；读侧仍接受 1.1 / 1.0。 */
export const SCHEME_SNAPSHOT_SCHEMA_VERSION = "1.2" as const;
/** J.4 基线：含 scope_plan，不含 graveyard。 */
export const SCHEME_SNAPSHOT_SCHEMA_VERSION_V11 = "1.1" as const;
export const SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY = "1.0" as const;

/**
 * 确认时封存的一句用户原话（J16-P5 / P-201）。
 * 原文逐字取自意图编译器 transcript，哈希口径与 intent-compiler/host.ts 一致：sha256(utf8)。
 */
export interface FrozenQuote {
  turn_id: string;
  seq: number;
  user_alias_seq?: number;
  text: string;
  turn_text_sha256: string;
}

export interface FrozenQuotes {
  source: "intent-compiler-transcript";
  /** 封存原话里最大的序号；只由原话清单决定，同一确认重试时快照才能幂等 */
  sealed_through_seq: number;
  /** 按 seq 升序 */
  quotes: FrozenQuote[];
}

/** 前端只回传已登记原话的 id 与哈希，不带原文。 */
export interface SourceTurnRef {
  turn_id: string;
  turn_text_sha256: string;
}

export const FROZEN_QUOTES_MAX = 200;
export const FROZEN_QUOTE_MAX_CHARS = 4000;

export type FrozenQuotesFailureReason =
  | "quotes_missing"
  | "quotes_malformed"
  | "quotes_empty"
  | "quotes_too_many"
  | "quotes_duplicate"
  | "transcript_unreadable"
  | "turn_not_found"
  | "turn_not_user"
  | "turn_hash_mismatch"
  | "quote_too_long";

export interface SchemeSnapshot {
  schema_version:
    | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION
    | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION_V11
    | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY;
  snapshot_id: string;
  confirmation_id: string;
  status: "FROZEN";
  created_at: string;
  scheme_revision: number;
  scheme: SchemeDraft;
  demo: DemoGate;
  decision: {
    code: string;
    message: string;
    demo_mode: "none" | "interactive" | "degraded";
  };
  digest: string;
  /** 1.1+ 必有；读 1.0 旧快照时为 undefined（视为缺失）。 */
  scope_plan?: ScopePlan;
  /** 1.2 必有（可空数组）；读 1.1/1.0 时为 undefined。 */
  graveyard?: GraveyardEntry[];
  /** 1.2：墓地内容的稳定摘要；与 digest 一并用于篡改检测。 */
  graveyard_digest?: string;
  /** TASK-C.22 / L.17a：可选参考源 URL 列表（与 scheme.references 对齐）。 */
  references?: string[];
  /**
   * P-201：确认时封存的原话，计入 digest。以 1.2 追加段落地、不升 schema_version：
   * 派工绑定按版本相等判定墓地权威，升版会让存量或新签合同之一派工失败。旧快照没有此段。
   */
  frozen_quotes?: FrozenQuotes;
  quotes_digest?: string;
}

export class SchemeSnapshotConflictError extends Error {
  readonly code = "E_SCHEME_CONFIRMATION_CONFLICT";
  constructor(confirmationId: string) {
    super(
      `confirmation_id=${confirmationId} 已冻结另一版方案；拒绝覆盖不可变快照`,
    );
    this.name = "SchemeSnapshotConflictError";
  }
}

function assertConfirmationId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9._-]{8,96}$/.test(id)) {
    const err = new Error("confirmation_id 格式非法") as Error & {
      code?: string;
    };
    err.code = "E_CONFIRMATION_ID_INVALID";
    throw err;
  }
  return id;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/**
 * 方案内容的稳定摘要。
 *
 * 刻意剔除 `updatedAt`：它只是本地写入时间戳，不承载任何用户决策；
 * 纳入摘要会让“同一份方案重放”被误判成“另一版方案”。其余字段
 * （含 scheme_id / scheme_revision / 模块 / 链路 / 抉择）全部参与，
 * 任何实质改动都必须改变 digest。
 */
function decisionBearingScheme(
  scheme: SchemeDraft,
): Omit<SchemeDraft, "updatedAt"> {
  const { updatedAt: _ignored, ...rest } = scheme;
  return rest;
}

/** 墓地内容的稳定摘要（GAP-W2）。 */
export function graveyardDigest(graveyard: readonly GraveyardEntry[]): string {
  return createHash("sha256").update(stableStringify(graveyard)).digest("hex");
}

/** 封存原话的稳定摘要（P-201）。 */
export function frozenQuotesDigest(frozen: FrozenQuotes): string {
  return createHash("sha256").update(stableStringify(frozen)).digest("hex");
}

/** 单句原话哈希：sha256(utf8)，与 intent-compiler/host.ts 同口径。 */
export function quoteTextSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function schemeSnapshotDigest(input: {
  scheme_revision: number;
  scheme: SchemeDraft;
  demo: DemoGate;
  /** 1.1+：纳入 plan_digest；缺省（旧 1.0 口径）不参与。 */
  scope_plan?: ScopePlan;
  /** 1.2：纳入 graveyard_digest；缺省（旧 1.1/1.0）不参与。 */
  graveyard?: readonly GraveyardEntry[];
  /** P-201：纳入 quotes_digest；缺省（未封存的旧快照）不参与。 */
  frozen_quotes?: FrozenQuotes;
}): string {
  const payload = stableStringify({
    scheme_revision: input.scheme_revision,
    scheme: decisionBearingScheme(input.scheme),
    demo: input.demo,
    ...(input.scope_plan
      ? { scope_plan_digest: input.scope_plan.plan_digest }
      : {}),
    ...(input.graveyard !== undefined
      ? { graveyard_digest: graveyardDigest(input.graveyard) }
      : {}),
    ...(input.frozen_quotes !== undefined
      ? { quotes_digest: frozenQuotesDigest(input.frozen_quotes) }
      : {}),
  });
  return createHash("sha256").update(payload).digest("hex");
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 解析冻结请求里的原话清单（只含 id 与哈希）；任一条不合法即整体失败，不做部分采纳。 */
export function parseSourceTurnRefs(
  raw: unknown,
):
  | { ok: true; value: SourceTurnRef[] }
  | { ok: false; reason: FrozenQuotesFailureReason } {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: "quotes_missing" };
  }
  if (!Array.isArray(raw)) return { ok: false, reason: "quotes_malformed" };
  if (raw.length === 0) return { ok: false, reason: "quotes_empty" };
  if (raw.length > FROZEN_QUOTES_MAX) {
    return { ok: false, reason: "quotes_too_many" };
  }
  const seen = new Set<string>();
  const value: SourceTurnRef[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, reason: "quotes_malformed" };
    }
    const { turn_id, turn_text_sha256 } = item as Record<string, unknown>;
    if (
      typeof turn_id !== "string" ||
      !TURN_ID_PATTERN.test(turn_id) ||
      typeof turn_text_sha256 !== "string" ||
      !SHA256_HEX.test(turn_text_sha256)
    ) {
      return { ok: false, reason: "quotes_malformed" };
    }
    if (seen.has(turn_id)) return { ok: false, reason: "quotes_duplicate" };
    seen.add(turn_id);
    value.push({ turn_id, turn_text_sha256 });
  }
  return { ok: true, value };
}

/**
 * 按已登记的 id 与哈希，从 transcript 逐字取出原话（P-201）。
 * 任一句找不到、不是用户发言或哈希对不上即整体失败：宁可不冻结，也不部分封存或拼凑。
 */
export function sealFrozenQuotes(
  transcript: Pick<TranscriptRecord, "seq" | "turns"> | null,
  refs: readonly SourceTurnRef[],
):
  | { ok: true; value: FrozenQuotes }
  | { ok: false; reason: FrozenQuotesFailureReason; turn_id?: string } {
  const byId = new Map((transcript?.turns ?? []).map((t) => [t.turn_id, t]));
  const quotes: FrozenQuote[] = [];
  for (const ref of refs) {
    const turn = byId.get(ref.turn_id);
    if (!turn) {
      return { ok: false, reason: "turn_not_found", turn_id: ref.turn_id };
    }
    if (turn.role !== "user") {
      return { ok: false, reason: "turn_not_user", turn_id: ref.turn_id };
    }
    if (turn.text.length > FROZEN_QUOTE_MAX_CHARS) {
      return { ok: false, reason: "quote_too_long", turn_id: ref.turn_id };
    }
    const recomputed = quoteTextSha256(turn.text);
    if (
      recomputed !== ref.turn_text_sha256 ||
      turn.text_sha256 !== ref.turn_text_sha256
    ) {
      return { ok: false, reason: "turn_hash_mismatch", turn_id: ref.turn_id };
    }
    quotes.push({
      turn_id: turn.turn_id,
      seq: turn.seq,
      ...(turn.user_alias_seq === undefined
        ? {}
        : { user_alias_seq: turn.user_alias_seq }),
      text: turn.text,
      turn_text_sha256: recomputed,
    });
  }
  quotes.sort((a, b) => a.seq - b.seq);
  return {
    ok: true,
    value: {
      source: "intent-compiler-transcript",
      sealed_through_seq: quotes.at(-1)?.seq ?? 0,
      quotes,
    },
  };
}

function isFrozenQuotesShape(value: unknown): value is FrozenQuotes {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Record<keyof FrozenQuotes, unknown>>;
  if (v.source !== "intent-compiler-transcript") return false;
  if (
    typeof v.sealed_through_seq !== "number" ||
    !Number.isFinite(v.sealed_through_seq)
  ) {
    return false;
  }
  if (!Array.isArray(v.quotes) || v.quotes.length === 0) return false;
  return v.quotes.every((q: unknown) => {
    if (typeof q !== "object" || q === null) return false;
    const x = q as Partial<Record<keyof FrozenQuote, unknown>>;
    return (
      typeof x.turn_id === "string" &&
      x.turn_id !== "" &&
      typeof x.seq === "number" &&
      Number.isFinite(x.seq) &&
      typeof x.text === "string" &&
      typeof x.turn_text_sha256 === "string" &&
      SHA256_HEX.test(x.turn_text_sha256) &&
      (x.user_alias_seq === undefined ||
        (typeof x.user_alias_seq === "number" &&
          Number.isFinite(x.user_alias_seq)))
    );
  });
}

export type FrozenQuotesIntegrity =
  | { ok: true; sealed: false }
  | { ok: true; sealed: true; frozen_quotes: FrozenQuotes }
  | {
      ok: false;
      reason:
        | "quotes_malformed"
        | "quote_hash_mismatch"
        | "quotes_digest_mismatch"
        | "digest_mismatch";
    };

/**
 * 封存段完整性校验（P-201）：结构、逐句哈希、quotes_digest 与按内容重算的 digest 必须全部一致。
 * 只要出现封存段或 quotes_digest 之一就按已封存校验，删段或改字都判不通过；
 * 两者都没有的旧快照视为未封存，不重算 digest。
 */
export function verifyFrozenQuotes(
  snapshot: SchemeSnapshot,
): FrozenQuotesIntegrity {
  const frozen: unknown = snapshot.frozen_quotes;
  const quotesDigest: unknown = snapshot.quotes_digest;
  if (frozen === undefined && quotesDigest === undefined) {
    return { ok: true, sealed: false };
  }
  if (typeof quotesDigest !== "string" || !isFrozenQuotesShape(frozen)) {
    return { ok: false, reason: "quotes_malformed" };
  }
  for (const quote of frozen.quotes) {
    if (quoteTextSha256(quote.text) !== quote.turn_text_sha256) {
      return { ok: false, reason: "quote_hash_mismatch" };
    }
  }
  if (frozenQuotesDigest(frozen) !== quotesDigest) {
    return { ok: false, reason: "quotes_digest_mismatch" };
  }
  const recomputed = schemeSnapshotDigest({
    scheme_revision: snapshot.scheme.scheme_revision,
    scheme: snapshot.scheme,
    demo: snapshot.demo,
    ...(snapshot.scope_plan ? { scope_plan: snapshot.scope_plan } : {}),
    ...(snapshot.graveyard === undefined
      ? {}
      : { graveyard: snapshot.graveyard }),
    frozen_quotes: frozen,
  });
  if (recomputed !== snapshot.digest) {
    return { ok: false, reason: "digest_mismatch" };
  }
  return { ok: true, sealed: true, frozen_quotes: frozen };
}

export function schemeSnapshotPath(
  repoRoot: string,
  confirmationId: string,
): string {
  const id = assertConfirmationId(confirmationId);
  return path.join(path.resolve(repoRoot), SCHEME_SNAPSHOT_DIR, `${id}.json`);
}

function isSupportedSchemaVersion(
  value: unknown,
): value is
  | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION
  | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION_V11
  | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY {
  return (
    value === SCHEME_SNAPSHOT_SCHEMA_VERSION ||
    value === SCHEME_SNAPSHOT_SCHEMA_VERSION_V11 ||
    value === SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY
  );
}

/**
 * 从已校验的确认快照组装合同 `scheme_binding`（GAP-W1）。
 * 仅在带 confirmation_id 且快照含 scope_plan 时使用；旧直签不得调用。
 */
export function schemeBindingFromSnapshot(
  confirmationId: string,
  snapshot: SchemeSnapshot,
): SchemeBinding {
  const plan = snapshot.scope_plan;
  if (!plan?.plan_digest) {
    const err = new Error(
      "确认快照版本过旧（缺少 scope_plan），请重新确认方案后再签署",
    ) as Error & { code?: string };
    err.code = "E_SCHEME_SNAPSHOT_NOT_FOUND";
    err.name = "SchemeSnapshotScopeMissingError";
    throw err;
  }
  return {
    confirmation_id: assertConfirmationId(confirmationId),
    snapshot_digest: snapshot.digest,
    plan_digest: plan.plan_digest,
  };
}

export function readSchemeSnapshot(
  repoRoot: string,
  confirmationId: string,
): SchemeSnapshot | null {
  let file: string;
  try {
    file = schemeSnapshotPath(repoRoot, confirmationId);
  } catch {
    return null;
  }
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SchemeSnapshot;
    if (
      !isSupportedSchemaVersion(parsed.schema_version) ||
      parsed.status !== "FROZEN" ||
      typeof parsed.digest !== "string" ||
      parsed.confirmation_id !== confirmationId
    ) {
      return null;
    }
    // 1.0：scope_plan / graveyard / 封存段视为缺失（即使文件里被人塞了字段也不采信）
    if (parsed.schema_version === SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY) {
      const {
        scope_plan: _dropPlan,
        graveyard: _dropGy,
        graveyard_digest: _dropGd,
        frozen_quotes: _dropFq,
        quotes_digest: _dropQd,
        ...rest
      } = parsed;
      return rest;
    }
    // 1.1：graveyard / 封存段视为缺失
    if (parsed.schema_version === SCHEME_SNAPSHOT_SCHEMA_VERSION_V11) {
      const {
        graveyard: _dropGy,
        graveyard_digest: _dropGd,
        frozen_quotes: _dropFq,
        quotes_digest: _dropQd,
        ...rest
      } = parsed;
      return rest;
    }
    // 1.2：须含 graveyard 数组与 graveyard_digest
    if (
      !Array.isArray(parsed.graveyard) ||
      typeof parsed.graveyard_digest !== "string" ||
      !parsed.graveyard_digest
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSchemeSnapshot(
  repoRoot: string,
  input: {
    confirmation_id: string;
    scheme: SchemeDraft;
    demo: DemoGate;
    decision: SchemeSnapshot["decision"];
    scope_plan: ScopePlan;
    /** 冻结时完整墓地（含 revived）；缺省写空数组。 */
    graveyard?: readonly GraveyardEntry[];
    /** P-201：确认时封存的原话；生产冻结路由必传，缺省即未封存。 */
    frozen_quotes?: FrozenQuotes;
    now?: () => Date;
  },
): { snapshot: SchemeSnapshot; idempotent: boolean } {
  const confirmationId = assertConfirmationId(input.confirmation_id);
  const graveyard = [...(input.graveyard ?? [])];
  const gyDigest = graveyardDigest(graveyard);
  const digest = schemeSnapshotDigest({
    scheme_revision: input.scheme.scheme_revision,
    scheme: input.scheme,
    demo: input.demo,
    scope_plan: input.scope_plan,
    graveyard,
    ...(input.frozen_quotes === undefined
      ? {}
      : { frozen_quotes: input.frozen_quotes }),
  });
  const existing = readSchemeSnapshot(repoRoot, confirmationId);
  if (existing) {
    if (existing.digest !== digest) {
      throw new SchemeSnapshotConflictError(confirmationId);
    }
    return { snapshot: existing, idempotent: true };
  }

  const now = input.now ?? (() => new Date());
  const snapshot: SchemeSnapshot = {
    schema_version: SCHEME_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: confirmationId,
    confirmation_id: confirmationId,
    status: "FROZEN",
    created_at: now().toISOString(),
    scheme_revision: input.scheme.scheme_revision,
    scheme: input.scheme,
    demo: input.demo,
    decision: input.decision,
    digest,
    scope_plan: input.scope_plan,
    graveyard,
    graveyard_digest: gyDigest,
    ...(input.scheme.references && input.scheme.references.length > 0
      ? { references: [...input.scheme.references] }
      : {}),
    ...(input.frozen_quotes === undefined
      ? {}
      : {
          frozen_quotes: input.frozen_quotes,
          quotes_digest: frozenQuotesDigest(input.frozen_quotes),
        }),
  };
  writeJsonAtomic(schemeSnapshotPath(repoRoot, confirmationId), snapshot);
  return { snapshot, idempotent: false };
}
