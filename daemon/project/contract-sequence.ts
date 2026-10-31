/**
 * TASK-L.9：合同序列交接——互斥检查、桩终态回填、中止后重新分解请求。
 *
 * Daemon 侧（可触盘）；纯规则在 src/lib/project/next-stub.ts / plan-stub-sync.ts。
 */

import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  isInFlightLifecycleState,
  shouldRedecomposeAfterAbort,
} from "../../src/lib/project/next-stub";
import {
  syncStubStatus,
  type StubTerminal,
  type SyncStubResult,
} from "../../src/lib/project/plan-stub-sync";
import type { ProjectPlan } from "../../src/lib/project/project-plan";
import { readPlan, writePlan } from "./plan-store";
import fs from "node:fs";
import path from "node:path";

export interface InFlightHit {
  contract_id: string;
  lifecycle_state: string;
}

/** 在合同列表中找任一处于 PREPARING～AUDITED 的合同。 */
export function findInFlightContract(
  contracts: readonly SoftwareContract[],
  exceptContractId?: string,
): InFlightHit | null {
  for (const c of contracts) {
    if (exceptContractId && c.contract_id === exceptContractId) continue;
    if (isInFlightLifecycleState(c.lifecycle_state)) {
      return {
        contract_id: c.contract_id,
        lifecycle_state: c.lifecycle_state,
      };
    }
  }
  return null;
}

export function stubIdFromContract(
  contract: SoftwareContract,
): string | null {
  const meta = contract.supervisor_metadata;
  if (!meta) return null;
  const id = meta.stub_id;
  if (typeof id === "string" && id.length > 0) return id;
  return null;
}

/**
 * 回填计划桩终态并落盘。无计划或无桩时 no-op。
 */
export function applyContractStubTerminal(
  repoRoot: string,
  stubId: string,
  terminal: StubTerminal,
  contractId: string | null,
): SyncStubResult | null {
  const plan = readPlan(repoRoot);
  if (!plan) return null;
  const result = syncStubStatus(plan, stubId, terminal, contractId);
  if (!result.stub) return result;
  writePlan(repoRoot, result.plan);
  return result;
}

export const REDECOMPOSE_REQUEST_FILE = "redecompose-request.json";

export interface RedecomposeRequest {
  reason: "contract_aborted";
  at: string;
  aborted_stub_id: string;
  aborted_contract_id: string;
  plan_revision: number;
}

let redecomposeHook: ((req: RedecomposeRequest) => void) | null = null;

/** 测试用：注入重新分解调用探针。 */
export function setRedecomposeHook(
  hook: ((req: RedecomposeRequest) => void) | null,
): void {
  redecomposeHook = hook;
}

/**
 * 中止后若 nextStub 为空但仍有 planned → 写下请求并调用钩子（「触发重新分解」）。
 */
export function triggerRedecomposeIfNeeded(
  repoRoot: string,
  plan: ProjectPlan,
  abortedStubId: string,
  abortedContractId: string,
): RedecomposeRequest | null {
  if (!shouldRedecomposeAfterAbort(plan)) return null;
  const req: RedecomposeRequest = {
    reason: "contract_aborted",
    at: new Date().toISOString(),
    aborted_stub_id: abortedStubId,
    aborted_contract_id: abortedContractId,
    plan_revision: plan.plan_revision,
  };
  const dir = path.join(repoRoot, ".stagent", "project");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, REDECOMPOSE_REQUEST_FILE),
    JSON.stringify(req, null, 2),
    "utf8",
  );
  if (redecomposeHook) redecomposeHook(req);
  return req;
}
