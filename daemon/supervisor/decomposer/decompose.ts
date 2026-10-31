/**
 * TASK-L.8：方案 → 计划补丁分解器。
 * 规格：project-decomposition.md §1、§4；ADR-0018 / ADR-0019。
 *
 * - size_hint === "standard"：零模型，确定性单里程碑单桩
 * - 其他：可注入模型调用（zod Schema 约束）；失败回喂 violations 重试 1 次
 * - PAB 缺失 / stale / 有阻断 open_decisions → 不得生成可签署合同桩
 */

import { z } from "zod";
import type { SchemeDraftV2 } from "../../../src/lib/journey/scheme-patch-types";
import {
  applyPlanPatch,
  emptyProjectPlan,
  type PlanOp,
  type PlanPatch,
} from "../../../src/lib/project/plan-patch";
import type {
  ArchitectureBaselineRef,
  PlanViolation,
  ProjectPlan,
  RepoFacts,
} from "../../../src/lib/project/project-plan";

/** L.8 所需的最小 ready PAB 视图（完整 PAB Schema 属后续卡） */
export interface ReadyPabView {
  baseline_id: string;
  baseline_revision: number;
  baseline_digest: string;
  status: "draft" | "ready" | "stale";
  open_decisions?: ReadonlyArray<{ blocking: boolean }>;
}

export type DecomposeFailureCode =
  | "E_PAB_NOT_READY"
  | "E_PLAN_INVALID"
  | "E_DECOMPOSE_FAILED";

export type DecomposeResult =
  | {
      ok: true;
      plan: ProjectPlan;
      patch: PlanPatch;
      model_calls: number;
    }
  | {
      ok: false;
      code: DecomposeFailureCode;
      plain_message: string;
      violations?: PlanViolation[];
      model_calls: number;
    };

export interface ModelPlanPatch {
  ops: PlanOp[];
}

export type DecomposeModelFn = (input: {
  scheme: SchemeDraftV2;
  repoFacts: RepoFacts;
  pab: ReadyPabView;
  priorViolations?: PlanViolation[];
}) => Promise<ModelPlanPatch>;

export interface DecomposeInput {
  scheme: SchemeDraftV2;
  repoFacts: RepoFacts;
  pab: ReadyPabView | null;
  /** 已有计划（重新分解）；缺省从空计划起步 */
  existingPlan?: ProjectPlan | null;
  project_id?: string;
  /** 模型调用；standard 路径不会调用 */
  model?: DecomposeModelFn;
}

const sizeEstimateSchema = z.object({
  files: z.number().int().nonnegative(),
  diff_lines: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
});

const stubBodySchema = z.object({
  stub_id: z.string().min(1),
  milestone_id: z.string().min(1),
  kind: z.enum([
    "feature",
    "interface_first",
    "test_foundation",
    "refactor",
    "knowledge_bootstrap",
    "dependency",
  ]),
  origin: z.enum(["scheme", "system"]),
  title: z.string().min(1),
  scheme_item_ids: z.array(z.string()),
  acceptance_ids: z.array(z.string()).min(1),
  area_hints: z.array(z.string()),
  depends_on: z.array(z.string()),
  size_estimate: sizeEstimateSchema,
  context: z
    .object({
      release_id: z.string().optional(),
      commit_sha: z.string().optional(),
      log_tail: z.string().optional(),
      flaky_test: z.string().optional(),
      dependency: z
        .object({ name: z.string(), version: z.string() })
        .optional(),
    })
    .optional(),
});

const milestoneSchema = z.object({
  milestone_id: z.string().min(1),
  title: z.string().min(1),
  exit_acceptance_ids: z.array(z.string()).min(1),
  contract_ids: z.array(z.string()),
});

/** 模型输出 zod Schema（约束 PlanOp 子集） */
export const modelPlanPatchSchema = z.object({
  ops: z.array(
    z.discriminatedUnion("op", [
      z.object({ op: z.literal("add_milestone"), milestone: milestoneSchema }),
      z.object({ op: z.literal("add_stub"), stub: stubBodySchema }),
      z.object({
        op: z.literal("split_stub"),
        stub_id: z.string().min(1),
        into: z.array(stubBodySchema).min(1),
      }),
      z.object({
        op: z.literal("reorder"),
        milestone_id: z.string().min(1),
        contract_ids: z.array(z.string()),
      }),
      z.object({
        op: z.literal("remove_stub"),
        stub_id: z.string().min(1),
        reason: z.string(),
      }),
      z.object({
        op: z.literal("edit_stub"),
        stub_id: z.string().min(1),
        fields: z
          .object({
            title: z.string().optional(),
            area_hints: z.array(z.string()).optional(),
            depends_on: z.array(z.string()).optional(),
            size_estimate: sizeEstimateSchema.optional(),
            acceptance_ids: z.array(z.string()).optional(),
            scheme_item_ids: z.array(z.string()).optional(),
          })
          .passthrough(),
      }),
    ]),
  ),
});

export function pabRefFrom(pab: ReadyPabView): ArchitectureBaselineRef {
  return {
    baseline_id: pab.baseline_id,
    baseline_revision: pab.baseline_revision,
    baseline_digest: pab.baseline_digest,
  };
}

function assertPabReady(pab: ReadyPabView | null): DecomposeResult | null {
  if (!pab) {
    return {
      ok: false,
      code: "E_PAB_NOT_READY",
      plain_message: "这个需求我还没拆好",
      model_calls: 0,
    };
  }
  if (pab.status !== "ready") {
    return {
      ok: false,
      code: "E_PAB_NOT_READY",
      plain_message: "这个需求我还没拆好",
      model_calls: 0,
    };
  }
  const blocking = (pab.open_decisions ?? []).some((d) => d.blocking);
  if (blocking) {
    return {
      ok: false,
      code: "E_PAB_NOT_READY",
      plain_message: "这个需求我还没拆好",
      model_calls: 0,
    };
  }
  return null;
}

/** standard：确定性单里程碑 + 单桩，覆盖全部 goals / user_visible modules / acceptance */
export function buildStandardPlanPatch(scheme: SchemeDraftV2): PlanPatch {
  const schemeItemIds: string[] = [
    ...scheme.goals.map((g) => g.id),
    ...scheme.modules.filter((m) => m.user_visible).map((m) => m.id),
  ];
  // 去重保序
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of schemeItemIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  const acceptanceIds = scheme.acceptance.map((a) => a.id);
  if (acceptanceIds.length < 1) {
    // 无验收时仍给占位，让校验暴露 D-2（调用方应保证密封方案合法）
  }
  const title =
    scheme.goals[0]?.text?.trim() ||
    scheme.modules.find((m) => m.user_visible)?.name ||
    "第一份交付";

  const stubId = "cs-1";
  const milestoneId = "ms-1";
  const ops: PlanOp[] = [
    {
      op: "add_milestone",
      milestone: {
        milestone_id: milestoneId,
        title: "第一期",
        exit_acceptance_ids:
          acceptanceIds.length > 0 ? [...acceptanceIds] : ["acc-missing"],
        contract_ids: [stubId],
      },
    },
    {
      op: "add_stub",
      stub: {
        stub_id: stubId,
        milestone_id: milestoneId,
        kind: "feature",
        origin: "scheme",
        title,
        scheme_item_ids: ids.length > 0 ? ids : ["g-missing"],
        acceptance_ids:
          acceptanceIds.length > 0 ? [...acceptanceIds] : ["acc-missing"],
        area_hints: ["src"],
        depends_on: [],
        size_estimate: { files: 5, diff_lines: 400, minutes: 20 },
      },
    },
  ];
  return { base_revision: 0, reason: "initial", ops };
}

function basePlanFor(
  input: DecomposeInput,
  pab: ReadyPabView,
): ProjectPlan {
  if (input.existingPlan) return input.existingPlan;
  return emptyProjectPlan({
    project_id: input.project_id ?? `proj-${input.scheme.scheme_id}`,
    scheme_id: input.scheme.scheme_id,
    scheme_revision: input.scheme.scheme_revision,
    architecture_baseline_ref: pabRefFrom(pab),
  });
}

async function tryApply(
  plan: ProjectPlan,
  patch: PlanPatch,
  scheme: SchemeDraftV2,
  repoFacts: RepoFacts,
): Promise<
  | { ok: true; plan: ProjectPlan }
  | { ok: false; violations: PlanViolation[]; code: "E_PLAN_INVALID" | "E_PLAN_STUB_REVIVED" | "E_PLAN_STALE" | "E_PLAN_STUB_LOCKED" }
> {
  // initial 分解对空计划 base_revision 必须为 0；若 existing 非空则以计划 revision 为准
  const aligned: PlanPatch = {
    ...patch,
    base_revision: plan.plan_revision,
  };
  const result = applyPlanPatch(plan, aligned, scheme, repoFacts, {
    removed_by: "replan",
  });
  if (result.ok) return { ok: true, plan: result.plan };
  return {
    ok: false,
    violations: result.violations,
    code: result.code,
  };
}

/**
 * 分解入口。
 * 合并失败把 violations 回喂模型重试一次；仍失败 → 白话「这个需求我还没拆好」。
 */
export async function decompose(
  input: DecomposeInput,
): Promise<DecomposeResult> {
  const pabGate = assertPabReady(input.pab);
  if (pabGate) return pabGate;
  const pab = input.pab!;

  const scheme = input.scheme;
  const plan0 = basePlanFor(input, pab);
  // 首次分解：若已有非空计划且 reason initial，调用方应传 existing；此处对空计划用 initial
  let modelCalls = 0;

  if (scheme.size_hint === "standard" || scheme.size_hint === "tiny") {
    // tiny 本不建计划；若仍调用分解器，按 standard 确定性路径（升 standard 的前置由编译器负责）
    const patch = buildStandardPlanPatch(scheme);
    // 空计划 revision 0；若已有计划则对齐
    const applied = await tryApply(plan0, patch, scheme, input.repoFacts);
    if (!applied.ok) {
      return {
        ok: false,
        code: "E_PLAN_INVALID",
        plain_message: "这个需求我还没拆好",
        violations: applied.violations,
        model_calls: 0,
      };
    }
    return {
      ok: true,
      plan: applied.plan,
      patch: { ...patch, base_revision: plan0.plan_revision },
      model_calls: 0,
    };
  }

  // large（或升 large）：需要模型
  if (!input.model) {
    return {
      ok: false,
      code: "E_DECOMPOSE_FAILED",
      plain_message: "这个需求我还没拆好",
      model_calls: 0,
    };
  }

  let priorViolations: PlanViolation[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    modelCalls += 1;
    let raw: ModelPlanPatch;
    try {
      raw = await input.model({
        scheme,
        repoFacts: input.repoFacts,
        pab,
        priorViolations,
      });
    } catch {
      return {
        ok: false,
        code: "E_DECOMPOSE_FAILED",
        plain_message: "这个需求我还没拆好",
        model_calls: modelCalls,
      };
    }
    const parsed = modelPlanPatchSchema.safeParse(raw);
    if (!parsed.success) {
      priorViolations = [
        { rule: "D-1", target: "model_schema" },
      ];
      continue;
    }
    const patch: PlanPatch = {
      base_revision: plan0.plan_revision,
      reason: "initial",
      ops: parsed.data.ops as PlanOp[],
    };
    const applied = await tryApply(plan0, patch, scheme, input.repoFacts);
    if (applied.ok) {
      return {
        ok: true,
        plan: applied.plan,
        patch,
        model_calls: modelCalls,
      };
    }
    priorViolations = applied.violations;
  }

  return {
    ok: false,
    code: "E_PLAN_INVALID",
    plain_message: "这个需求我还没拆好",
    violations: priorViolations,
    model_calls: modelCalls,
  };
}

export { modelPlanPatchSchema as planPatchModelSchema };
