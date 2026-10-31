/**
 * TASK-J.4 / SSOT §15.5：范围预检、冻结漂移与签署链快照绑定。
 *
 * 只读组合：不落盘、不调模型；HTTP 层负责鉴权与状态码映射。
 */
import { gradeWritableScope } from "../../src/lib/writable-scope-grade";
import {
  contractMatchesScopePlan,
  decisionsFromScopePlan,
  type ScopePlan,
  type ScopePlanDecisions,
} from "../../src/lib/journey/scope-plan";
import type { SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { SchemeSnapshot } from "../pipeline/scheme-snapshot-store";
import {
  buildScopePlan,
  type ScopePlanSchemeInput,
} from "./scope-plan-builder";
import { isGreenfieldRepo } from "./rules-l0";

export class ScopePlanDriftError extends Error {
  readonly code = "E_SCOPE_PLAN_DRIFT" as const;
  readonly scope_plan: ScopePlan;
  constructor(fresh: ScopePlan) {
    super(
      "项目状态相对预检结果已变化，范围摘要不一致；请用新的范围计划重新确认",
    );
    this.name = "ScopePlanDriftError";
    this.scope_plan = fresh;
  }
}

export class SchemeSnapshotMismatchError extends Error {
  readonly code = "E_SCHEME_SNAPSHOT_MISMATCH" as const;
  constructor() {
    super(
      "合同的可写范围 / 禁写 / 验收命令 / 预算与确认快照中的 ScopePlan 不一致",
    );
    this.name = "SchemeSnapshotMismatchError";
  }
}

export class ScopeInvariantBrokenError extends Error {
  readonly code = "E_SCOPE_INVARIANT_BROKEN" as const;
  constructor(detail: string) {
    super(`签署链范围不变量被破坏（D1）：${detail}`);
    this.name = "ScopeInvariantBrokenError";
  }
}

function asSchemeInput(
  scheme: SchemeDraft | ScopePlanSchemeInput,
): ScopePlanSchemeInput {
  const base: ScopePlanSchemeInput = {
    scheme_revision: scheme.scheme_revision,
    title: scheme.title,
    summary: scheme.summary,
    modules: scheme.modules,
    notes: scheme.notes,
  };
  let next: ScopePlanSchemeInput = base;
  if ("out_of_scope" in scheme && scheme.out_of_scope !== undefined) {
    next = { ...next, out_of_scope: scheme.out_of_scope };
  }
  if ("acceptance" in scheme && scheme.acceptance !== undefined) {
    next = { ...next, acceptance: scheme.acceptance };
  }
  if ("modules_v2" in scheme && scheme.modules_v2 !== undefined) {
    next = { ...next, modules_v2: scheme.modules_v2 };
  }
  return next;
}

/** 只读预检：零模型、零落盘。 */
export function preflightScopePlan(input: {
  repoRoot: string;
  scheme: SchemeDraft | ScopePlanSchemeInput;
  decisions?: ScopePlanDecisions;
}): ScopePlan {
  return buildScopePlan({
    repoRoot: input.repoRoot,
    scheme: asSchemeInput(input.scheme),
    ...(input.decisions ? { decisions: input.decisions } : {}),
  });
}

/**
 * 冻结前用快照内 scheme + 用户表态重跑预检；digest 不一致抛漂移。
 * 返回用于写入快照的权威 plan（与提交 plan digest 一致时即提交 plan 的重算结果）。
 */
export function assertScopePlanFreshForFreeze(input: {
  repoRoot: string;
  scheme: SchemeDraft;
  submitted: ScopePlan;
}): ScopePlan {
  const decisions = decisionsFromScopePlan(input.submitted);
  const fresh = preflightScopePlan({
    repoRoot: input.repoRoot,
    scheme: input.scheme,
    decisions,
  });
  if (fresh.plan_digest !== input.submitted.plan_digest) {
    throw new ScopePlanDriftError(fresh);
  }
  return fresh;
}

function contractScopeFields(contract: SoftwareContract) {
  return {
    writable_paths: contract.authorization.file_system_scope.writable_paths,
    strictly_forbidden_paths:
      contract.authorization.file_system_scope.strictly_forbidden_paths,
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
  };
}

/**
 * 带 confirmation_id 的签署链：快照必须含 scope_plan，且合同与投影一字不差。
 * 一致时调用方应跳过 assertContractScopeAllowed；此处先 grade 断言，失败抛 500 语义错误。
 *
 * @returns 'bound' 表示已按快照绑定并完成不变量检查
 */
export function assertSignedContractMatchesSnapshot(input: {
  repoRoot: string;
  contract: SoftwareContract;
  snapshot: SchemeSnapshot;
}): "bound" {
  const plan = input.snapshot.scope_plan;
  if (!plan) {
    const err = new Error(
      "确认快照版本过旧（缺少 scope_plan），请重新确认方案后再签署",
    ) as Error & { code?: string };
    err.code = "E_SCHEME_SNAPSHOT_NOT_FOUND";
    err.name = "SchemeSnapshotScopeMissingError";
    throw err;
  }

  if (!contractMatchesScopePlan(contractScopeFields(input.contract), plan)) {
    throw new SchemeSnapshotMismatchError();
  }

  const greenfield = isGreenfieldRepo(input.repoRoot);
  const grade = gradeWritableScope({
    writable_paths: input.contract.authorization.file_system_scope.writable_paths,
    greenfield,
  });
  if (!grade.ok) {
    throw new ScopeInvariantBrokenError(
      grade.rejected.map((r) => `${r.path} (${r.kind})`).join("、"),
    );
  }
  return "bound";
}
