/**
 * TASK-J.5：按 ScopePlan 投影组装待签合同（确认链唯一范围来源）。
 * TASK-L.9：可选合同桩 → 写入 supervisor_metadata.stub_id / scheme_item_ids，
 *           并投影 §5.1 执行权限。
 *
 * 禁止从意图文本 / submitJourneyMessage 推断 writable_paths。
 */

import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../contract.schema";
import type { ContractStub } from "../project/project-plan";
import type { SchemeDraft } from "./scheme-draft";
import { scopePlanToContractScope, type ScopePlan } from "./scope-plan";

export interface BuildConfirmContractOptions {
  /** 项目计划中的合同桩；写入元数据并优先用桩的 scheme_item_ids */
  stub?: ContractStub | null;
}

/**
 * 用方案标题/摘要 + `scopePlanToContractScope` 投影生成合同。
 * 调用方再设 lifecycle / confirmation_id 后交给 `createContractWithAdmission`。
 */
export function buildConfirmContractFromScopePlan(
  scheme: SchemeDraft,
  plan: ScopePlan,
  options?: BuildConfirmContractOptions,
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
  const stub = options?.stub ?? null;
  const scheme_item_ids =
    stub && stub.scheme_item_ids.length > 0
      ? [...stub.scheme_item_ids]
      : acceptance_refs.map((a) => a.id);

  const exec = projected.execution_permissions;
  const nextAuth = {
    ...draft.authorization,
    budget_limits: { ...projected.budget },
    file_system_scope: {
      ...draft.authorization.file_system_scope,
      writable_paths: projected.writable_paths,
      strictly_forbidden_paths: projected.forbidden_paths,
    },
    execution_permissions: {
      ...draft.authorization.execution_permissions,
      ...(exec?.allowed_commands
        ? {
            allowed_commands: [
              ...new Set([
                ...draft.authorization.execution_permissions.allowed_commands,
                ...exec.allowed_commands,
              ]),
            ],
          }
        : {}),
      ...(exec?.network_policy
        ? { network_policy: exec.network_policy }
        : {}),
      ...(typeof exec?.dependency_changes_allowed === "boolean"
        ? { dependency_changes_allowed: exec.dependency_changes_allowed }
        : {}),
    },
  };

  return softwareContractSchema.parse({
    ...draft,
    authorization: nextAuth,
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
    // Tina 拍板 B：合同身份只认 contract_type（由桩 kind 投影）
    ...(stub ? { contract_type: stub.kind } : {}),
    // TASK-L.3 / L.9：追踪元数据（签署后不改合同正文）
    supervisor_metadata: {
      suggestion_id: stub
        ? `stub:${stub.stub_id}`
        : `scheme:${scheme.scheme_id}`,
      ...(acceptance_refs.length > 0 ? { acceptance_refs } : {}),
      ...(scheme_item_ids.length > 0 ? { scheme_item_ids } : {}),
      stub_id: stub ? stub.stub_id : null,
    },
  });
}
