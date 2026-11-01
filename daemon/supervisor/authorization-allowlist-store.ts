/**
 * TASK-J.20：授权清单侧车读写（项目级 `.stagent/records/`）。
 *
 * 存储选型（PR 内二选一）：`.stagent/records/authorization-allowlist.json`
 * —— 按仓库自然隔离、跨合同复用、禁止写入已废止的 `.stagent/metadata/`。
 *
 * 本模块只服务确认开工路径；复活路径不得 import。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ALLOWLIST_FILE_REL,
  applyAllowlistToScopePlan,
  authorizedItemsFromScopePlan,
  clearAllowlist,
  emptyAllowlist,
  revokeAllowlistEntry,
  upsertAllowlistEntries,
  type AuthorizationAllowlist,
  type AuthorizeItemInput,
} from "../../src/lib/journey/authorization-allowlist";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";
import { PROTECTION_FILE_REL } from "../protection/protection-list";

/** 禁止路径：自证用常量（不得作为写入目标） */
export const FORBIDDEN_ALLOWLIST_METADATA_REL =
  ".stagent/metadata/authorization-allowlist.json" as const;

export { ALLOWLIST_FILE_REL };

function allowlistAbs(repoRoot: string): string {
  return path.join(repoRoot, ALLOWLIST_FILE_REL);
}

/** 当前保护清单内容指纹；文件不存在 → `empty` */
export function computeProtectionFingerprint(repoRoot: string): string {
  const file = path.join(repoRoot, PROTECTION_FILE_REL);
  if (!fs.existsSync(file)) return "empty";
  try {
    const raw = fs.readFileSync(file, "utf8");
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  } catch {
    return "unreadable";
  }
}

export function readAllowlist(repoRoot: string): AuthorizationAllowlist {
  const abs = allowlistAbs(repoRoot);
  if (!fs.existsSync(abs)) return emptyAllowlist();
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as {
      version?: unknown;
      entries?: unknown;
    };
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return emptyAllowlist();
    }
    return {
      version: 1,
      entries: parsed.entries as AuthorizationAllowlist["entries"],
    };
  } catch {
    return emptyAllowlist();
  }
}

export function writeAllowlist(
  repoRoot: string,
  list: AuthorizationAllowlist,
): void {
  const abs = allowlistAbs(repoRoot);
  // 硬拒：不得写 metadata
  if (abs.includes(`${path.sep}.stagent${path.sep}metadata${path.sep}`)) {
    throw new Error("authorization allowlist must not write under .stagent/metadata/");
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  const payload: AuthorizationAllowlist = {
    version: 1,
    entries: list.entries.map((e) => ({ ...e, paths: [...e.paths] })),
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, abs);
}

/**
 * 预检后应用清单：同项已授权且未失效 → 不再以 null 阻塞 E_SCOPE_APPROVAL_REQUIRED。
 */
export function applyRepoAllowlistToScopePlan(
  repoRoot: string,
  plan: ScopePlan,
  now?: Date | number | string,
): ScopePlan {
  const list = readAllowlist(repoRoot);
  return applyAllowlistToScopePlan(plan, list, {
    ...(now !== undefined ? { now } : {}),
    protectionFingerprint: computeProtectionFingerprint(repoRoot),
  });
}

export interface RecordConfirmAuthInput {
  scopePlan: ScopePlan;
  source_contract_id: string | null;
  source_confirmation_id: string | null;
  ttlMs?: number;
  now?: string;
}

/**
 * 确认开工成功：把本次 approved===true 的敏感项写入清单（可审计溯源）。
 */
export function recordConfirmAuthorizations(
  repoRoot: string,
  input: RecordConfirmAuthInput,
): AuthorizationAllowlist {
  const approved = authorizedItemsFromScopePlan(input.scopePlan);
  if (approved.length === 0) {
    return readAllowlist(repoRoot);
  }
  const fingerprint = computeProtectionFingerprint(repoRoot);
  const authorized_at = input.now ?? new Date().toISOString();
  const items: AuthorizeItemInput[] = approved.map((item) => ({
    paths: item.paths,
    label: item.label,
    quote: item.why || item.label,
    source_contract_id: input.source_contract_id,
    source_confirmation_id: input.source_confirmation_id,
    protection_fingerprint: fingerprint,
    authorized_at,
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
  }));
  const next = upsertAllowlistEntries(readAllowlist(repoRoot), items);
  writeAllowlist(repoRoot, next);
  return next;
}

export function revokeAuthorization(
  repoRoot: string,
  sensitiveId: string,
): AuthorizationAllowlist {
  const next = revokeAllowlistEntry(readAllowlist(repoRoot), sensitiveId);
  writeAllowlist(repoRoot, next);
  return next;
}

/** 「清空授权」动作 */
export function clearAuthorizations(repoRoot: string): AuthorizationAllowlist {
  const next = clearAllowlist();
  writeAllowlist(repoRoot, next);
  return next;
}
