/**
 * TASK-J.5：按 ScopePlan 投影组装待签合同（确认链唯一范围来源）。
 *
 * 禁止从意图文本 / submitJourneyMessage 推断 writable_paths。
 */

import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../contract.schema";
import type { SchemeDraft } from "./scheme-draft";
import { scopePlanToContractScope, type ScopePlan } from "./scope-plan";

/**
 * 用方案标题/摘要 + `scopePlanToContractScope` 投影生成合同。
 * 调用方再设 lifecycle / confirmation_id 后交给 `createContractWithAdmission`。
 */
export function buildConfirmContractFromScopePlan(
  scheme: SchemeDraft,
  plan: ScopePlan,
): SoftwareContract {
  const projected = scopePlanToContractScope(plan);
  if (projected.writable_paths.length === 0) {
    throw new Error("范围计划没有可写路径，无法签署");
  }
  const useManual =
    projected.verification_spec.commands.length === 0 ||
    Boolean(projected.verification_spec.manual_confirmation);
  const draft = createContractDraft({
    title: scheme.title.trim() || "确认方案",
    description: scheme.summary.trim() || scheme.title.trim() || "按范围计划签署",
    acceptanceCriteria:
      plan.verification.plain.length > 0
        ? [...plan.verification.plain]
        : ["按方案验收"],
    writablePaths: projected.writable_paths,
    strictlyForbiddenPaths: projected.forbidden_paths,
    ...(useManual
      ? {
          commands: projected.verification_spec.commands,
          manualConfirmation: projected.verification_spec.manual_confirmation ?? {
            reason_required: true as const,
            capture_evidence: [
              "actor",
              "confirmed_at",
              "reason",
            ] as Array<"actor" | "confirmed_at" | "reason">,
          },
        }
      : { commands: projected.verification_spec.commands }),
    maxFileModifications: projected.budget.max_file_modifications,
    maxDurationSeconds: projected.budget.max_duration_seconds,
    maxVerificationRetries: projected.budget.max_verification_retries,
  });

  const acceptance = scheme.acceptance ?? [];
  const acceptance_refs = acceptance.map((a) => ({
    id: a.id,
    text: a.text,
    check: a.check,
  }));
  const scheme_item_ids = acceptance_refs.map((a) => a.id);

  return softwareContractSchema.parse({
    ...draft,
    authorization: {
      ...draft.authorization,
      budget_limits: { ...projected.budget },
      file_system_scope: {
        ...draft.authorization.file_system_scope,
        writable_paths: projected.writable_paths,
        strictly_forbidden_paths: projected.forbidden_paths,
      },
    },
    verification_spec: {
      commands: projected.verification_spec.commands,
      ...(projected.verification_spec.manual_confirmation
        ? {
            manual_confirmation:
              projected.verification_spec.manual_confirmation,
          }
        : useManual
          ? {
              manual_confirmation: {
                reason_required: true,
                capture_evidence: ["actor", "confirmed_at", "reason"],
              },
            }
          : {}),
    },
    // TASK-L.3 / delivery-lifecycle §6：按快照方案填充追踪元数据（签署后不改）
    supervisor_metadata: {
      suggestion_id: `scheme:${scheme.scheme_id}`,
      ...(acceptance_refs.length > 0
        ? { acceptance_refs, scheme_item_ids }
        : {}),
      stub_id: null,
    },
  });
}
