/**
 * TASK-L.9 / project-decomposition.md §5、§8 PD-10：选出「下一份」合同桩。
 *
 * 纯函数，零 fs。规则：
 * - 候选 = status === "planned" 且全部 depends_on 均为 merged；
 * - 取所在里程碑序号最小、在里程碑内序号最小的一份；
 * - 无候选但仍有 planned → 依赖被 aborted，应重新分解（reason: contract_aborted）。
 */

import type { ContractStub, ProjectPlan } from "./project-plan";

/** 合同级互斥：处于这些态时不得签署下一份（PREPARING～AUDITED）。 */
export const IN_FLIGHT_LIFECYCLE_STATES = [
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
  "PENDING_RESUME",
  "AUDITED",
] as const;

export type InFlightLifecycleState = (typeof IN_FLIGHT_LIFECYCLE_STATES)[number];

export function isInFlightLifecycleState(
  state: string,
): state is InFlightLifecycleState {
  return (IN_FLIGHT_LIFECYCLE_STATES as readonly string[]).includes(state);
}

/**
 * 选出下一份可签合同桩；无可选时返回 null。
 */
export function nextStub(plan: ProjectPlan): ContractStub | null {
  const byId = new Map(plan.contracts.map((c) => [c.stub_id, c]));
  const milestoneIndex = new Map(
    plan.milestones.map((m, i) => [m.milestone_id, i]),
  );

  type Candidate = { stub: ContractStub; msIdx: number; stubIdx: number };
  const candidates: Candidate[] = [];

  for (const ms of plan.milestones) {
    const msIdx = milestoneIndex.get(ms.milestone_id) ?? Number.MAX_SAFE_INTEGER;
    for (let stubIdx = 0; stubIdx < ms.contract_ids.length; stubIdx++) {
      const id = ms.contract_ids[stubIdx]!;
      const stub = byId.get(id);
      if (!stub) continue;
      if (stub.status !== "planned") continue;
      const depsOk = stub.depends_on.every((dep) => {
        const d = byId.get(dep);
        return d?.status === "merged";
      });
      if (!depsOk) continue;
      candidates.push({ stub, msIdx, stubIdx });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.msIdx !== b.msIdx) return a.msIdx - b.msIdx;
    return a.stubIdx - b.stubIdx;
  });
  return candidates[0]!.stub;
}

/**
 * 中止后是否应触发重新分解：nextStub 为 null，但仍有 planned 桩。
 */
export function shouldRedecomposeAfterAbort(plan: ProjectPlan): boolean {
  if (nextStub(plan) !== null) return false;
  return plan.contracts.some((c) => c.status === "planned");
}
