/**
 * TASK-J.20 / OP-1（dec-10）：确认路径敏感项授权清单——纯类型与判定（零 fs）。
 *
 * - 清单只服务「确认开工」路径的 SA-1 自动放行；跨合同复用 ≠ 永久免检。
 * - 复活路径（K-12）不读本清单；occurrence 忽略逻辑在 graveyard-revival，本模块不得改动。
 * - 存储侧车见 daemon/supervisor/authorization-allowlist-store.ts
 *   （`.stagent/records/authorization-allowlist.json`，禁止 `.stagent/metadata/`）。
 */

import { normalizePath } from "../scope";
import {
  applyScopeDecisions,
  type ScopePlan,
  type ScopePlanNeedsApproval,
} from "./scope-plan";

/** 默认 TTL：90 天（卡内写死上限；可配置下调，不可超过） */
export const DEFAULT_ALLOWLIST_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_ALLOWLIST_TTL_MS = DEFAULT_ALLOWLIST_TTL_MS;

export const ALLOWLIST_FILE_REL =
  ".stagent/records/authorization-allowlist.json" as const;

export interface AuthorizationAllowlistEntry {
  /** 规范化敏感键：排序后的路径以 `|` 连接 */
  sensitive_id: string;
  paths: string[];
  label: string;
  authorized_at: string;
  /** ISO；authorized_at + TTL */
  expires_at: string;
  source_contract_id: string | null;
  source_confirmation_id: string | null;
  /** 溯源摘录（原话点名 / 标签兜底） */
  quote: string;
  /** 授权时保护清单指纹；清单升级则条目失效 */
  protection_fingerprint: string;
  revoked_at: string | null;
}

export interface AuthorizationAllowlist {
  version: 1;
  entries: AuthorizationAllowlistEntry[];
}

export function emptyAllowlist(): AuthorizationAllowlist {
  return { version: 1, entries: [] };
}

/** 条目键 = 规范化敏感路径集合（与 SA-1 点名路径同款） */
export function sensitiveIdFromPaths(paths: readonly string[]): string {
  const normalized = [...paths]
    .map((p) => normalizePath(p))
    .filter((p) => p.length > 0)
    .sort();
  return normalized.join("|");
}

export function clampAllowlistTtlMs(ttlMs: number | undefined): number {
  if (ttlMs === undefined || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return DEFAULT_ALLOWLIST_TTL_MS;
  }
  return Math.min(ttlMs, MAX_ALLOWLIST_TTL_MS);
}

export function computeExpiresAt(
  authorizedAtIso: string,
  ttlMs: number = DEFAULT_ALLOWLIST_TTL_MS,
): string {
  const base = Date.parse(authorizedAtIso);
  const start = Number.isFinite(base) ? base : Date.now();
  return new Date(start + clampAllowlistTtlMs(ttlMs)).toISOString();
}

export type AllowlistInvalidReason =
  | "missing"
  | "revoked"
  | "ttl_expired"
  | "protection_reclassified"
  | "cleared";

export interface PreauthorizeOptions {
  now?: Date | number | string;
  /** 当前仓库保护清单指纹；与条目不一致 → 重分类失效 */
  protectionFingerprint?: string;
}

export function isEntryValid(
  entry: AuthorizationAllowlistEntry,
  opts: PreauthorizeOptions = {},
): { ok: true } | { ok: false; reason: AllowlistInvalidReason } {
  if (entry.revoked_at) {
    return { ok: false, reason: "revoked" };
  }
  const nowMs = resolveNowMs(opts.now);
  const exp = Date.parse(entry.expires_at);
  if (!Number.isFinite(exp) || nowMs >= exp) {
    return { ok: false, reason: "ttl_expired" };
  }
  if (
    opts.protectionFingerprint !== undefined &&
    opts.protectionFingerprint !== entry.protection_fingerprint
  ) {
    return { ok: false, reason: "protection_reclassified" };
  }
  return { ok: true };
}

/**
 * 同项已授权且未失效 → true。
 * 不读盘；调用方传入清单。
 */
export function isPreauthorized(
  list: AuthorizationAllowlist | null | undefined,
  sensitiveId: string,
  opts: PreauthorizeOptions = {},
): boolean {
  if (!list || !sensitiveId) return false;
  const entry = list.entries.find((e) => e.sensitive_id === sensitiveId);
  if (!entry) return false;
  return isEntryValid(entry, opts).ok;
}

export function findAllowlistEntry(
  list: AuthorizationAllowlist,
  sensitiveId: string,
): AuthorizationAllowlistEntry | undefined {
  return list.entries.find((e) => e.sensitive_id === sensitiveId);
}

export interface AuthorizeItemInput {
  paths: readonly string[];
  label: string;
  quote?: string;
  source_contract_id?: string | null;
  source_confirmation_id?: string | null;
  protection_fingerprint: string;
  authorized_at?: string;
  ttlMs?: number;
}

/** 纯函数：写入/刷新授权条目（同 sensitive_id 覆盖） */
export function upsertAllowlistEntries(
  list: AuthorizationAllowlist,
  items: readonly AuthorizeItemInput[],
): AuthorizationAllowlist {
  const next = cloneAllowlist(list);
  for (const item of items) {
    const sensitive_id = sensitiveIdFromPaths(item.paths);
    if (!sensitive_id) continue;
    const authorized_at = item.authorized_at ?? new Date().toISOString();
    const entry: AuthorizationAllowlistEntry = {
      sensitive_id,
      paths: sensitive_id.split("|"),
      label: item.label,
      authorized_at,
      expires_at: computeExpiresAt(authorized_at, item.ttlMs),
      source_contract_id: item.source_contract_id ?? null,
      source_confirmation_id: item.source_confirmation_id ?? null,
      quote: (item.quote ?? item.label).trim() || item.label,
      protection_fingerprint: item.protection_fingerprint,
      revoked_at: null,
    };
    const idx = next.entries.findIndex((e) => e.sensitive_id === sensitive_id);
    if (idx >= 0) next.entries[idx] = entry;
    else next.entries.push(entry);
  }
  return next;
}

/** 显式撤销：满足失效条件「用户撤销」 */
export function revokeAllowlistEntry(
  list: AuthorizationAllowlist,
  sensitiveId: string,
  revokedAt: string = new Date().toISOString(),
): AuthorizationAllowlist {
  const next = cloneAllowlist(list);
  next.entries = next.entries.map((e) =>
    e.sensitive_id === sensitiveId ? { ...e, revoked_at: revokedAt } : e,
  );
  return next;
}

/**
 * 「清空授权」动作：整表清空（跨合同基线作废）。
 * 对应失效条件：plan_digest 基线被清空授权清除。
 */
export function clearAllowlist(
  _list?: AuthorizationAllowlist,
): AuthorizationAllowlist {
  return emptyAllowlist();
}

/**
 * 将仍未表态（approved===null）且清单命中未失效的敏感项自动标为 approved:true。
 * 已显式拒绝（false）或已同意（true）不动。重算 digest。
 */
export function applyAllowlistToScopePlan(
  plan: ScopePlan,
  list: AuthorizationAllowlist | null | undefined,
  opts: PreauthorizeOptions = {},
): ScopePlan {
  if (!list || list.entries.length === 0) return plan;
  const approvals: Record<string, boolean> = {};
  for (const item of plan.needs_approval) {
    if (item.approved !== null) continue;
    const sid = sensitiveIdFromPaths(item.paths);
    if (isPreauthorized(list, sid, opts)) {
      approvals[item.id] = true;
    }
  }
  if (Object.keys(approvals).length === 0) return plan;
  return applyScopeDecisions(plan, { approvals });
}

/** 从 ScopePlan 抽出本次应写入清单的已授权敏感项（approved===true） */
export function authorizedItemsFromScopePlan(
  plan: ScopePlan,
): ScopePlanNeedsApproval[] {
  return plan.needs_approval.filter((item) => item.approved === true);
}

function cloneAllowlist(list: AuthorizationAllowlist): AuthorizationAllowlist {
  return {
    version: 1,
    entries: list.entries.map((e) => ({
      ...e,
      paths: [...e.paths],
    })),
  };
}

function resolveNowMs(now?: Date | number | string): number {
  if (now === undefined) return Date.now();
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
