/**
 * TASK-L.9：合同终态 ↔ 计划桩 status / contract_id 回填。
 */

import type { ContractStub, ProjectPlan } from "./project-plan";
import { shouldRedecomposeAfterAbort } from "./next-stub";

export type StubTerminal = "signed" | "merged" | "aborted";

export interface SyncStubResult {
  plan: ProjectPlan;
  stub: ContractStub | null;
  /** ABORTED 且 nextStub 为空但仍有 planned → 应触发 L.8 重新分解 */
  redecompose: boolean;
}

function bumpRevision(plan: ProjectPlan): ProjectPlan {
  return { ...plan, plan_revision: plan.plan_revision + 1 };
}

/**
 * 按 stub_id 回填桩状态。找不到桩时原样返回（不抛），便于旧直签合同无桩场景。
 */
export function syncStubStatus(
  plan: ProjectPlan,
  stubId: string,
  terminal: StubTerminal,
  contractId: string | null,
): SyncStubResult {
  const idx = plan.contracts.findIndex((c) => c.stub_id === stubId);
  if (idx < 0) {
    return { plan, stub: null, redecompose: false };
  }
  const prev = plan.contracts[idx]!;
  const nextStub: ContractStub = {
    ...prev,
    status: terminal,
    contract_id: contractId ?? prev.contract_id,
  };
  const contracts = plan.contracts.map((c, i) => (i === idx ? nextStub : c));
  const nextPlan = bumpRevision({ ...plan, contracts });
  const redecompose =
    terminal === "aborted" ? shouldRedecomposeAfterAbort(nextPlan) : false;
  return { plan: nextPlan, stub: nextStub, redecompose };
}
