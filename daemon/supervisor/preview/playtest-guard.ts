/**
 * TASK-L.17b：`check playtest` 门禁 —— 单一判定源。
 *
 * 只读证据文件 + Release Store + 合同文件，不启动 Daemon、不碰 canvas 模块（禁忌）。
 * 判定顺序：
 *   合同存在 → 北极星场景(references[]) → 证据存在 → 完整性 → release_id 匹配。
 *
 * 版本指纹只用 `release_id` 单一事实源：与当前 LIVE 不匹配即 `STALE_VERSION`
 * （重置认可，不跨版本穿透）；合同无 `references[]` / 非北极星场景 → 明确错误码，
 * 绝不静默 PASS。
 */
import fs from "node:fs";
import path from "node:path";
import { playtestEvidenceSchema } from "../../../src/lib/journey/playtest-evidence";
import { readPlaytestEvidenceRaw } from "../../playtest/evidence";
import { resolveCurrentLiveReleaseId } from "../../release/active-live";

export type PlaytestGuardStatus =
  | "APPROVED"
  | "UNCONFIRMED"
  | "STALE_VERSION"
  | "EVIDENCE_INVALID"
  | "NOT_NORTHSTAR_SCENARIO"
  | "CONTRACT_NOT_FOUND";

export interface PlaytestGuardVerdict {
  ok: boolean;
  status: PlaytestGuardStatus;
  code: string;
  message: string;
  contract_id: string;
  evidence_release_id: string | null;
  current_release_id: string | null;
  /** STALE_VERSION 时为 true：认可已被重置，须重新试玩确认 */
  reset_approval: boolean;
}

export const PLAYTEST_GUARD_CODES = {
  APPROVED: "PLAYTEST_APPROVED",
  UNCONFIRMED: "PLAYTEST_UNCONFIRMED",
  STALE_VERSION: "STALE_VERSION",
  EVIDENCE_INVALID: "E_PLAYTEST_EVIDENCE_INVALID",
  NOT_NORTHSTAR_SCENARIO: "NOT_NORTHSTAR_SCENARIO",
  CONTRACT_NOT_FOUND: "E_CONTRACT_NOT_FOUND",
} as const;

function contractsDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".stagent", "contracts");
}

/**
 * 只读合同 `references[]`（北极星「一模一样」场景判据）。
 * 直接读盘、不触发 ContractStore 迁移 / 写盘，保证 check 是纯只读。
 */
function readContractReferences(
  repoRoot: string,
  contractId: string,
): { exists: boolean; references: string[] } {
  // 合同文件名与 ContractStore 落盘口径一致（contract_id 原样）；
  // `.stagent/contracts/` 是固定目录，check 为本地只读，不做别名归一以免找不到合同。
  const file = path.join(contractsDir(repoRoot), `${contractId}.json`);
  if (!fs.existsSync(file)) return { exists: false, references: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      references?: unknown;
    };
    const refs = Array.isArray(raw.references)
      ? raw.references.filter(
          (r): r is string => typeof r === "string" && r.trim().length > 0,
        )
      : [];
    return { exists: true, references: refs };
  } catch {
    return { exists: true, references: [] };
  }
}

export function evaluatePlaytestGuard(input: {
  repoRoot: string;
  contractId: string;
}): PlaytestGuardVerdict {
  const base = {
    contract_id: input.contractId,
    evidence_release_id: null as string | null,
    current_release_id: null as string | null,
    reset_approval: false,
  };

  const contract = readContractReferences(input.repoRoot, input.contractId);
  if (!contract.exists) {
    return {
      ...base,
      ok: false,
      status: "CONTRACT_NOT_FOUND",
      code: PLAYTEST_GUARD_CODES.CONTRACT_NOT_FOUND,
      message: `找不到合同 ${input.contractId}，无法进行试玩门禁判定`,
    };
  }
  // 北极星场景判据：合同必须带 references[]（参考站），否则明确错误码，不静默 PASS
  if (contract.references.length === 0) {
    return {
      ...base,
      ok: false,
      status: "NOT_NORTHSTAR_SCENARIO",
      code: PLAYTEST_GUARD_CODES.NOT_NORTHSTAR_SCENARIO,
      message:
        "该合同没有 references[] 参考站，非北极星「一模一样」场景；check playtest 不适用，明确不判 PASS",
    };
  }

  const currentReleaseId = resolveCurrentLiveReleaseId(
    input.repoRoot,
    input.contractId,
  );
  base.current_release_id = currentReleaseId;

  const raw = readPlaytestEvidenceRaw(input.repoRoot, input.contractId);
  if (!raw.exists) {
    return {
      ...base,
      ok: false,
      status: "UNCONFIRMED",
      code: PLAYTEST_GUARD_CODES.UNCONFIRMED,
      message:
        "还没有试玩认可证据，视为未认可（请先对照参考站试玩并明确表态）",
    };
  }

  const parsed = playtestEvidenceSchema.safeParse(raw.value);
  if (!parsed.success) {
    return {
      ...base,
      ok: false,
      status: "EVIDENCE_INVALID",
      code: PLAYTEST_GUARD_CODES.EVIDENCE_INVALID,
      message: `证据文件不完整或格式非法：${parsed.error.issues[0]?.message ?? "schema 校验失败"}`,
    };
  }
  const evidence = parsed.data;
  base.evidence_release_id = evidence.release_id;
  // 完整性：证据合同号必须与本合同一致，防串用
  if (evidence.contract_id !== input.contractId) {
    return {
      ...base,
      ok: false,
      status: "EVIDENCE_INVALID",
      code: PLAYTEST_GUARD_CODES.EVIDENCE_INVALID,
      message: "证据 contract_id 与当前合同不一致，完整性校验失败",
    };
  }

  // 版本指纹：只用 release_id 单一事实源；不匹配即 STALE_VERSION 重置认可
  if (currentReleaseId === null || evidence.release_id !== currentReleaseId) {
    return {
      ...base,
      ok: false,
      status: "STALE_VERSION",
      code: PLAYTEST_GUARD_CODES.STALE_VERSION,
      message: `LIVE 版本已变更（证据 ${evidence.release_id} / 当前 ${currentReleaseId ?? "无 LIVE"}），旧版认可即刻失效，请重新试玩确认`,
      reset_approval: true,
    };
  }

  return {
    ...base,
    ok: true,
    status: "APPROVED",
    code: PLAYTEST_GUARD_CODES.APPROVED,
    message: "证据完整且与当前 LIVE 版本匹配，试玩认可有效",
  };
}
