import { z } from "zod";

/**
 * 证据包 Schema (v1.2.0 / EvidenceBundleV11)
 * 严格对齐《Stagent 系统架构设计规范 v1.2.1》§9.2。
 * 结论状态（PASSED/FAILED/BLOCKED/STALE）仅归属于 Evidence，严禁混入合同生命周期。
 *
 * v1.2.0 增量（相对 v1.1.3 的三个新增可选字段）：
 *  - `contract_revision?`：证据对应的合同版本，用于核销时比对审批版本
 *  - `worker_session_id?`：证据来源的 Worker 会话，便于跨会话归因
 *  - `supervisor_suggestion_ids?`：建议溯源，**不构成验收依据**
 */

// --- 1. 证据结论状态 (§9.2 verdict.status) ---

export const evidenceVerdictStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "BLOCKED",
  "STALE", // 生成后 Worktree 文件快照/HEAD 变化，须重新验证
]);
export type EvidenceVerdictStatus = z.infer<typeof evidenceVerdictStatusSchema>;

// --- 2. 原因码 (§9.2 reason_code 完整闭环，含崩溃恢复两码) ---

export const reasonCodeSchema = z.enum([
  "SCOPE_VIOLATION",
  "BUDGET_EXHAUSTED",
  "WORKSPACE_LOCKED",
  "UNAUTHORIZED_COMMAND",
  "VERIFICATION_RETRY_LIMIT",
  "UNSAFE_EXECUTION",
  "EVIDENCE_STALE",
  "PREPARATION_INTERRUPTED",
  "WORKTREE_LOST",
  // TASK-L.3 / verification-strategy §3.2 / §5
  "OBLIGATION_NOT_RED",
  "OBLIGATION_RED_INVALID",
  "OBLIGATION_NOT_GREEN",
  "TEST_WEAKENED",
  // TASK-L.12 / technical-design-and-knowledge §4.4
  "KNOWLEDGE_DRIFT",
]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

// --- 3. 用量与账单 (§9.2 usage) ---

export const usageAccountingModeSchema = z.enum([
  "PROVIDER_REPORTED",
  "ESTIMATED",
  "UNAVAILABLE",
]);
export type UsageAccountingMode = z.infer<typeof usageAccountingModeSchema>;

export const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    estimated_cost_minor_units: z.number().int().nonnegative().optional(),
    reported_cost_minor_units: z.number().int().nonnegative().optional(),
    currency: z.string().min(1),
    pricing_version: z.string().min(1),
    accounting_mode: usageAccountingModeSchema,
    limit_reached: z.boolean(),
    reserved_cost_minor_units: z.number().int().nonnegative().optional(),
    cumulative_cost_minor_units: z.number().int().nonnegative().optional(),
  })
  .superRefine((usage, ctx) => {
    // 账单模式一致性：PROVIDER_REPORTED 必须有 reported 值；ESTIMATED 必须有 estimated 值
    if (
      usage.accounting_mode === "PROVIDER_REPORTED" &&
      usage.reported_cost_minor_units === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "accounting_mode=PROVIDER_REPORTED requires reported_cost_minor_units",
      });
    }
    if (
      usage.accounting_mode === "ESTIMATED" &&
      usage.estimated_cost_minor_units === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "accounting_mode=ESTIMATED requires estimated_cost_minor_units",
      });
    }
  });
export type Usage = z.infer<typeof usageSchema>;

// --- 4. 工作树快照 / Scope 审计 / 验证结果 / Git 信息 (§9.2) ---

export const worktreeSnapshotSchema = z.object({
  head_sha: z.string().min(1),
  snapshot_fingerprint: z.string().min(1),
  captured_at: z.string(),
});
export type WorktreeSnapshot = z.infer<typeof worktreeSnapshotSchema>;

export const scopeAuditSchema = z.object({
  passed: z.boolean(),
  files_changed: z.array(
    z.object({
      path: z.string().min(1),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      binary: z.boolean(),
    }),
  ),
  forbidden_violations: z.array(z.string()),
  budget_exhausted: z.boolean(),
  /**
   * TASK-J.18d：墓地检查可用性。
   * snapshot = 合同绑定快照墓地；unavailable = 旧直签（W_GRAVEYARD_CHECK_UNAVAILABLE）。
   */
  graveyard_check: z.enum(["snapshot", "unavailable"]).optional(),
});
export type ScopeAudit = z.infer<typeof scopeAuditSchema>;

export const verificationResultSchema = z.object({
  command_alias: z.string().min(1),
  exit_code: z.number().int(),
  stdout_tail: z.string(),
  stderr_tail: z.string(),
  duration_ms: z.number().nonnegative(),
  passed: z.boolean(),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const gitInfoSchema = z.object({
  base_commit_sha: z.string().min(1),
  task_commit_sha: z.string().min(1),
  diff_stat: z.string(),
  patch_fingerprint: z.string().min(1), // SHA-256 一致性校验指纹（非防篡改签名）
});
export type GitInfo = z.infer<typeof gitInfoSchema>;

// --- 5. 证据包 (§9.2 EvidenceBundleV11) ---

export const verdictSchema = z.object({
  status: evidenceVerdictStatusSchema,
  /**
   * 派生字段：仅 status === PASSED 且快照/Scope/预算门禁全通过时为 true。
   * 外部写入方必须使用 `DraftVerdict`（Omit<Verdict, "can_merge">），
   * 由 `deriveCanMerge()` 统一计算，禁止手写。
   */
  can_merge: z.boolean(),
  summary: z.string(),
  reason_code: reasonCodeSchema.optional(),
  verification_retry_count: z.number().int().nonnegative().optional(),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** 外部写入证据时使用的 verdict 类型：剥离派生字段 */
export type DraftVerdict = Omit<Verdict, "can_merge">;

export const manualConfirmationRecordSchema = z.object({
  actor: z.string().min(1),
  confirmed_at: z.string().min(1),
  reason: z.string().min(1),
});
export type ManualConfirmationRecord = z.infer<
  typeof manualConfirmationRecordSchema
>;

export const evidenceBundleSchema = z
  .object({
    evidence_id: z.string().min(1),
    contract_id: z.string().min(1),
    /** v1.2.0 新增：证据对应的合同版本 */
    contract_revision: z.number().int().min(1).optional(),
    /** v1.2.0 新增：证据来源的 Worker 会话 */
    worker_session_id: z.string().min(1).optional(),
    /** v1.2.0 新增：建议溯源，不构成验收依据 */
    supervisor_suggestion_ids: z.array(z.string().min(1)).optional(),
    /** TASK-W.4：运行时复检降级后记录实际控制模式（默认受控） */
    worker_control_mode: z
      .enum(["GATEWAY_ENFORCED", "UNCONTROLLED_EXTERNAL"])
      .optional(),
    generated_at: z.string(),
    usage: usageSchema,
    worktree_snapshot: worktreeSnapshotSchema,
    verdict: verdictSchema,
    scope_audit: scopeAuditSchema,
    verification_results: z.array(verificationResultSchema),
    git_info: gitInfoSchema,
    /**
     * 【非 §9.2 字段】测试完整性留痕（Test Integrity Guard）：本任务是否修改过测试文件。
     * true 时控制台必须高亮预警——验证退出码可能由 Agent 自证，核销人须人工
     * 核对测试改动后再合并。以可选字段承载以保持旧证据包向后兼容，
     * 属已登记的规格外扩展（待 A 文档回写后转正）。
     */
    tests_modified: z.boolean().optional(),
    /**
     * 【非 §9.2 字段】人工确认留痕记录（G2 守卫条款 / 兜底语义）：
     * 零命令合同在完成人工确认记录（actor / confirmed_at / reason 齐全）后方可放行。
     */
    manual_confirmation: manualConfirmationRecordSchema.optional(),
    /**
     * TASK-L.3 / verification-strategy §3.4：测试义务红绿证据（可选，向后兼容）。
     * 每条对应一份 acceptance_id；red.exit_code 必须 ≠ 0，green.exit_code 必须 = 0。
     */
    obligations: z
      .array(
        z.object({
          acceptance_id: z.string().min(1),
          test_path: z.string().min(1),
          red: z.object({
            sha: z.string().min(1),
            exit_code: z.number().int(),
          }),
          green: z.object({
            sha: z.string().min(1),
            exit_code: z.number().int(),
          }),
        }),
      )
      .optional(),
  })
  .superRefine((bundle, ctx) => {
    // §9.2 Schema 不变式一：status !== "PASSED" 时 can_merge 必须为 false
    if (bundle.verdict.status !== "PASSED" && bundle.verdict.can_merge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "can_merge must be false when verdict.status is not PASSED (§9.2 invariant)",
      });
    }

    // §9.2 Schema 不变式二：can_merge=true 要求快照/Scope/预算门禁全通过
    if (bundle.verdict.can_merge) {
      const blocking: string[] = [];
      if (bundle.verdict.status !== "PASSED") blocking.push("status");
      if (!bundle.scope_audit.passed) blocking.push("scope_audit.passed");
      if (bundle.scope_audit.budget_exhausted)
        blocking.push("scope_audit.budget_exhausted");
      if (bundle.scope_audit.forbidden_violations.length > 0)
        blocking.push("scope_audit.forbidden_violations");
      if (blocking.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `can_merge=true is only allowed when every merge gate passes; ` +
            `blocked by: ${blocking.join(", ")} (§9.2 invariant)`,
        });
      }
    }
  });
export type EvidenceBundleV11 = z.infer<typeof evidenceBundleSchema>;
/** 兼容别名：全仓既有代码使用 `EvidenceBundle` */
export type EvidenceBundle = EvidenceBundleV11;

/**
 * 合并门禁的唯一派生函数（§9.2：`can_merge` 必须等于完整合并门禁的派生结果）。
 * 任何写入 Evidence 的路径都必须调用它，不得手写布尔表达式。
 */
export function deriveCanMerge(input: {
  status: EvidenceVerdictStatus;
  scopePassed: boolean;
  budgetExhausted: boolean;
  forbiddenViolationCount: number;
  /** 合同是否声明 manual_confirmation（兜底语义：在穷尽自动化手段证明后凭人工确认放行） */
  manualConfirmationDeclared?: boolean | undefined;
  /** 人工确认记录（需 actor / confirmed_at / reason 齐全） */
  manualConfirmationRecord?:
    | {
        actor?: string;
        confirmed_at?: string;
        reason?: string;
      }
    | null
    | undefined;
}): boolean {
  if (input.manualConfirmationDeclared) {
    const rec = input.manualConfirmationRecord;
    const isComplete =
      Boolean(rec) &&
      typeof rec?.actor === "string" &&
      rec.actor.trim().length > 0 &&
      typeof rec?.confirmed_at === "string" &&
      rec.confirmed_at.trim().length > 0 &&
      typeof rec?.reason === "string" &&
      rec.reason.trim().length > 0;
    if (!isComplete) {
      return false;
    }
  }

  return (
    input.status === "PASSED" &&
    input.scopePassed &&
    !input.budgetExhausted &&
    input.forbiddenViolationCount === 0
  );
}
