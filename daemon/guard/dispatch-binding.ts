/**
 * 派工绑定（TASK-J.18c / worker-graveyard-gate.md §3.4、§6.2）。
 * 只信任合同 scheme_binding；旧直签 → legacy（墓地检查不可用）。
 */
import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  contractMatchesScopePlan,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import {
  readSchemeSnapshot,
  SCHEME_SNAPSHOT_SCHEMA_VERSION,
  type SchemeSnapshot,
} from "../pipeline/scheme-snapshot-store";
import { buildGatePack, type GatePack } from "./worker-graveyard-gate";

export type DispatchBindingResult =
  | { ok: true; mode: "bound"; graveyard: GraveyardEntry[]; pack: GatePack }
  | { ok: true; mode: "legacy" }
  | {
      ok: false;
      code: "E_SCHEME_SNAPSHOT_NOT_FOUND" | "E_SCHEME_SNAPSHOT_MISMATCH";
      message: string;
    };

function notFound(message: string): DispatchBindingResult {
  return { ok: false, code: "E_SCHEME_SNAPSHOT_NOT_FOUND", message };
}

function mismatch(message: string): DispatchBindingResult {
  return { ok: false, code: "E_SCHEME_SNAPSHOT_MISMATCH", message };
}

function snapshotHasGraveyardAuthority(
  snapshot: SchemeSnapshot,
): snapshot is SchemeSnapshot & {
  schema_version: typeof SCHEME_SNAPSHOT_SCHEMA_VERSION;
  graveyard: GraveyardEntry[];
  scope_plan: ScopePlan;
} {
  return (
    snapshot.schema_version === SCHEME_SNAPSHOT_SCHEMA_VERSION &&
    Array.isArray(snapshot.graveyard) &&
    snapshot.scope_plan !== undefined
  );
}

/**
 * 派工前校验合同与确认快照绑定。
 * - 无 scheme_binding → legacy（不静默启用活台账墓地）
 * - 快照缺失 / 1.1 无墓地 → E_SCHEME_SNAPSHOT_NOT_FOUND
 * - digest / plan_digest / 可写范围不一致 → E_SCHEME_SNAPSHOT_MISMATCH
 */
export async function verifyDispatchBinding(
  repoRoot: string,
  contract: SoftwareContract,
): Promise<DispatchBindingResult> {
  const binding = contract.scheme_binding;
  if (!binding) {
    return { ok: true, mode: "legacy" };
  }

  const snapshot = readSchemeSnapshot(repoRoot, binding.confirmation_id);
  if (!snapshot) {
    return notFound(
      `找不到 confirmation_id=${binding.confirmation_id} 的方案快照，请重新确认方案后再开工`,
    );
  }

  // 1.1 / 1.0：无墓地权威源，口径同 J.4 T-HTTP-S207d「快照版本过旧」
  if (!snapshotHasGraveyardAuthority(snapshot)) {
    return notFound(
      `确认快照版本过旧（schema ${snapshot.schema_version}，缺少墓地权威源），请重新确认方案后再开工`,
    );
  }

  if (snapshot.digest !== binding.snapshot_digest) {
    return mismatch(
      "方案快照内容与合同 scheme_binding.snapshot_digest 不一致（可能被篡改）",
    );
  }

  if (snapshot.scope_plan.plan_digest !== binding.plan_digest) {
    return mismatch(
      "方案范围摘要与合同 scheme_binding.plan_digest 不一致",
    );
  }

  const scope = contract.authorization.file_system_scope;
  const matches = contractMatchesScopePlan(
    {
      writable_paths: scope.writable_paths,
      strictly_forbidden_paths: scope.strictly_forbidden_paths ?? [],
      verification_spec: {
        commands: contract.verification_spec.commands,
        ...(contract.verification_spec.manual_confirmation !== undefined
          ? {
              manual_confirmation:
                contract.verification_spec.manual_confirmation,
            }
          : {}),
      },
      budget_limits: contract.authorization.budget_limits,
    },
    snapshot.scope_plan,
  );
  if (!matches) {
    return mismatch(
      "合同可写范围与确认快照 ScopePlan 投影不一致",
    );
  }

  const graveyard = [...snapshot.graveyard];
  return {
    ok: true,
    mode: "bound",
    graveyard,
    pack: buildGatePack(graveyard),
  };
}

/** gate pack 落盘相对路径（接线方写入；本卡只导出常量）。 */
export const GATE_PACK_RELATIVE_PATH =
  ".stagent/claude-config/graveyard-pack.json" as const;

/** CLI deny 规则中保护 gate pack 的既有条目（TM-GB-07 对拍）。 */
export const GATE_PACK_DENY_READ_RULE =
  "Read(./.stagent/claude-config/**)" as const;
