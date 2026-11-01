/**
 * TASK-J.19：无 scheme ledger 时，按计划桩引用合成最小 ProjectPlanScheme，
 * 供 DN-2 插依赖桩通过 D-2/D-3/D-4 校验。有 ledger 时勿用本函数。
 */
import type {
  ProjectPlan,
  ProjectPlanScheme,
} from "../../../src/lib/project/project-plan";

export function synthesizeSchemeFromPlan(plan: ProjectPlan): ProjectPlanScheme {
  const goalIds = new Set<string>();
  const moduleIds = new Set<string>();
  const acceptanceIds = new Set<string>();
  for (const stub of plan.contracts) {
    if (stub.origin !== "scheme") continue;
    for (const id of stub.scheme_item_ids) {
      if (id.startsWith("m-") || id.startsWith("mod-")) moduleIds.add(id);
      else goalIds.add(id);
    }
    for (const id of stub.acceptance_ids) acceptanceIds.add(id);
  }
  for (const ms of plan.milestones) {
    for (const id of ms.exit_acceptance_ids) acceptanceIds.add(id);
  }
  return {
    scheme_id: plan.scheme_id,
    scheme_revision: plan.scheme_revision,
    size_hint: "standard",
    goals: [...goalIds].sort().map((id) => ({
      id,
      text: id,
      source: "user_said" as const,
      evidence: [],
      user_pinned: false,
      updated_in_revision: plan.scheme_revision,
    })),
    out_of_scope: [],
    modules: [...moduleIds].sort().map((id) => ({
      id,
      name: id,
      purpose: id,
      user_visible: true,
      kind: "new" as const,
      source: "user_said" as const,
      evidence: [],
      user_pinned: false,
      updated_in_revision: plan.scheme_revision,
    })),
    entities: [],
    acceptance: [...acceptanceIds].sort().map((id) => ({
      id,
      text: id,
      source: "user_said" as const,
      evidence: [],
      user_pinned: false,
      updated_in_revision: plan.scheme_revision,
    })),
  };
}
