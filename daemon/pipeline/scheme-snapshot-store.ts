import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DemoGate, SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";
import { writeJsonAtomic } from "../../src/lib/state-machine";

/**
 * TASK-C.22 / SSOT v2.0.2 §5.2.1：确认方案不可变快照。
 * TASK-J.4：schema 1.1 绑定 ScopePlan；digest 纳入 plan_digest。
 *
 * 只负责“冻结事实”，不负责签署。相同 confirmation_id + 相同内容幂等返回；
 * 同一 id 对应不同内容则拒绝，避免前端重试时悄悄替换用户已确认的方案。
 */

export const SCHEME_SNAPSHOT_DIR = ".stagent/drafts/schemes" as const;
/** 现行写入版本；读侧仍接受 1.0（scope_plan 视为缺失）。 */
export const SCHEME_SNAPSHOT_SCHEMA_VERSION = "1.1" as const;
export const SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY = "1.0" as const;

export interface SchemeSnapshot {
  schema_version:
    | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION
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
  /** 1.1 必有；读 1.0 旧快照时为 undefined（视为缺失）。 */
  scope_plan?: ScopePlan;
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

export function schemeSnapshotDigest(input: {
  scheme_revision: number;
  scheme: SchemeDraft;
  demo: DemoGate;
  /** 1.1：纳入 plan_digest；缺省（旧 1.0 口径）不参与。 */
  scope_plan?: ScopePlan;
}): string {
  const payload = stableStringify({
    scheme_revision: input.scheme_revision,
    scheme: decisionBearingScheme(input.scheme),
    demo: input.demo,
    ...(input.scope_plan
      ? { scope_plan_digest: input.scope_plan.plan_digest }
      : {}),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function schemeSnapshotPath(
  repoRoot: string,
  confirmationId: string,
): string {
  const id = assertConfirmationId(confirmationId);
  return path.join(path.resolve(repoRoot), SCHEME_SNAPSHOT_DIR, `${id}.json`);
}

function isSupportedSchemaVersion(value: unknown): value is
  | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION
  | typeof SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY {
  return (
    value === SCHEME_SNAPSHOT_SCHEMA_VERSION ||
    value === SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY
  );
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
    // 1.0：scope_plan 视为缺失（即使文件里被人塞了字段也不采信）
    if (parsed.schema_version === SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY) {
      const { scope_plan: _drop, ...rest } = parsed;
      return rest;
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
    now?: () => Date;
  },
): { snapshot: SchemeSnapshot; idempotent: boolean } {
  const confirmationId = assertConfirmationId(input.confirmation_id);
  const digest = schemeSnapshotDigest({
    scheme_revision: input.scheme.scheme_revision,
    scheme: input.scheme,
    demo: input.demo,
    scope_plan: input.scope_plan,
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
  };
  writeJsonAtomic(schemeSnapshotPath(repoRoot, confirmationId), snapshot);
  return { snapshot, idempotent: false };
}
