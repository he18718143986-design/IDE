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

export const sandboxMountModeSchema = z.enum([
  "scoped",
  "readonly_enforced",
  "legacy_full_rw",
]);
export type SandboxMountMode = z.infer<typeof sandboxMountModeSchema>;

export const sandboxWitnessSchema = z.object({
  host_kind: z.string().min(1),
  via: z.enum(["exit", "timeout", "SIGKILL", "rejected"]),
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().nonnegative(),
  worktree_root: z.string().min(1),
  /** TASK-P0.3b-2: 容器挂载模式 */
  mount_mode: sandboxMountModeSchema.optional(),
  /** TASK-P0.3b-2: 容器生效挂载项总数 */
  mount_count: z.number().int().nonnegative().optional(),
  /** TASK-P1.4: 见证 Nonce 与上下文绑定 */
  nonce: z.string().min(1).optional(),
  contract_id: z.string().min(1).optional(),
  contract_revision: z.number().int().min(1).optional(),
  session_id: z.string().min(1).optional(),
});
export type SandboxWitness = z.infer<typeof sandboxWitnessSchema>;

export const manualConfirmationRecordSchema = z.object({
  actor: z.string().min(1),
  confirmed_at: z.string().min(1),
  reason: z.string().min(1),
});
export type ManualConfirmationRecord = z.infer<
  typeof manualConfirmationRecordSchema
>;

/**
 * TASK-P1.2: Evidence Ed25519 签名凭据 Schema。
 * 基于 RFC 8785 规范化序列化与 Node.js 原生 crypto 生成的非对称签名记录。
 */
export const evidenceSignatureSchema = z.object({
  algorithm: z.literal("Ed25519"),
  signature: z.string().min(1),
  canonical_hash: z.string().length(64),
  key_id: z.string().optional(),
  public_key: z.string().optional(),
  signed_at: z.string().min(1),
});
export type EvidenceSignature = z.infer<typeof evidenceSignatureSchema>;

/**
 * TASK-P0.4：测试完整性防护与基线重跑留痕（Test Integrity）。
 * 记录修改/删除的既有测试路径、Worker 新增测试路径、基线隔离重跑结果与合同显式豁免留痕。
 */
export const testIntegrityEvidenceSchema = z.object({
  /** 是否存在测试文件变动（修改、删除或新增） */
  tests_modified: z.boolean(),
  /** 被修改的既有测试文件列表 */
  modified_existing_tests: z.array(z.string()).default([]),
  /** 被删除的既有测试文件列表 */
  deleted_existing_tests: z.array(z.string()).default([]),
  /** Worker 新增的测试文件列表（不参与基线重跑） */
  added_tests: z.array(z.string()).default([]),
  /** 合同显式豁免 allow_baseline_test_mutation 状态 */
  exemption: z.boolean().default(false),
  /** 是否触发了基线隔离重跑 */
  baseline_rerun_triggered: z.boolean().default(false),
  /** 基线重跑是否通过（若无需重跑或重跑成功为 true；测试破坏或环境不可用为 false） */
  baseline_rerun_passed: z.boolean(),
  /** 失败拒绝码（E_TEST_BASELINE_REGRESSION 或 E_TEST_BASELINE_UNAVAILABLE） */
  failure_code: z
    .enum(["E_TEST_BASELINE_REGRESSION", "E_TEST_BASELINE_UNAVAILABLE"])
    .optional(),
  /** 失败或不可用原因说明 */
  failure_reason: z.string().optional(),
  /** 还原参与基线重跑的测试文件列表 */
  restored_paths: z.array(z.string()).default([]),
  /** 检测到被弱化的测试列表（断言减少或增加 skip） */
  weakened_tests: z.array(z.string()).default([]),
});
export type TestIntegrityEvidence = z.infer<typeof testIntegrityEvidenceSchema>;

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
    /**
     * TASK-W.4：运行时复检降级后记录实际控制模式（默认受控）。
     * TASK-W.5c-ii：扩为三值——容器隔离档位 `SANDBOX_ENFORCED` 落地后如实记档
     * （此前二值期间由 `toRuntimeControlMode()` 收窄为 `UNCONTROLLED_EXTERNAL`，
     * 导致「受控派工成功却记不受控证据、产物不可合并」的矛盾，本卡一并解除）。
     */
    worker_control_mode: z
      .enum(["GATEWAY_ENFORCED", "SANDBOX_ENFORCED", "UNCONTROLLED_EXTERNAL"])
      .optional(),
    /**
     * TASK-P0.3a: 沙箱执行见证（向后兼容旧证据；可选字段）。
     * 当 worker_control_mode 为 SANDBOX_ENFORCED 时，必须提供合法有效见证才允许合并。
     */
    sandbox_witness: sandboxWitnessSchema.optional(),
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
     * TASK-P0.4: 测试完整性快照与基线重跑证据。
     * TASK-P0.2a: 当前版本受控 Evidence 必须包含完整 test_integrity 记录（schema 与 merger 双重 fail-closed）。
     */
    test_integrity: testIntegrityEvidenceSchema.optional(),
    /**
     * 【非 §9.2 字段】人工确认留痕记录（G2 守卫条款 / 兜底语义）：
     * 零命令合同在完成人工确认记录（actor / confirmed_at / reason 齐全）后方可放行。
     */
    manual_confirmation: manualConfirmationRecordSchema.optional(),
    /**
     * TASK-P1.2：Evidence Ed25519 签名凭据（防篡改与来源真实性证明）。
     * 记录 RFC 8785 规范化摘要、签名、公钥元数据与时间戳。
     */
    signature: evidenceSignatureSchema.optional(),
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
      if (bundle.worker_control_mode === "SANDBOX_ENFORCED") {
        if (!bundle.sandbox_witness) {
          blocking.push("sandbox_witness.missing");
        } else if (bundle.sandbox_witness.via !== "exit") {
          blocking.push(`sandbox_witness.via(${bundle.sandbox_witness.via})`);
        } else if (
          !bundle.sandbox_witness.host_kind ||
          bundle.sandbox_witness.host_kind === "unknown" ||
          bundle.sandbox_witness.host_kind.toLowerCase().includes("unavailable")
        ) {
          blocking.push(
            `sandbox_witness.host_kind(${bundle.sandbox_witness.host_kind})`,
          );
        } else if (
          bundle.sandbox_witness.mount_mode &&
          !["scoped", "readonly_enforced", "legacy_full_rw"].includes(
            bundle.sandbox_witness.mount_mode,
          )
        ) {
          blocking.push(
            `sandbox_witness.mount_mode(${bundle.sandbox_witness.mount_mode})`,
          );
        } else if (
          bundle.sandbox_witness.mount_count !== undefined &&
          (typeof bundle.sandbox_witness.mount_count !== "number" ||
            !Number.isInteger(bundle.sandbox_witness.mount_count) ||
            bundle.sandbox_witness.mount_count < 0)
        ) {
          blocking.push(
            `sandbox_witness.mount_count(${bundle.sandbox_witness.mount_count})`,
          );
        }
        if (bundle.sandbox_witness) {
          if (
            bundle.sandbox_witness.nonce !== undefined &&
            (typeof bundle.sandbox_witness.nonce !== "string" ||
              bundle.sandbox_witness.nonce.trim() === "")
          ) {
            blocking.push("sandbox_witness.nonce");
          }
          if (
            bundle.sandbox_witness.contract_id !== undefined &&
            bundle.sandbox_witness.contract_id !== bundle.contract_id
          ) {
            blocking.push(
              `sandbox_witness.contract_id_mismatch(${bundle.sandbox_witness.contract_id}!=${bundle.contract_id})`,
            );
          }
          if (
            bundle.sandbox_witness.contract_revision !== undefined &&
            bundle.contract_revision !== undefined &&
            bundle.sandbox_witness.contract_revision !==
              bundle.contract_revision
          ) {
            blocking.push(
              `sandbox_witness.contract_revision_mismatch(${bundle.sandbox_witness.contract_revision}!=${bundle.contract_revision})`,
            );
          }
        }
      }
      // TASK-P0.2a: 当前版本受控 Evidence 必须包含完整 test_integrity 记录，缺失 fail-closed
      if (
        bundle.contract_revision !== undefined &&
        (bundle.worker_control_mode === "GATEWAY_ENFORCED" ||
          bundle.worker_control_mode === "SANDBOX_ENFORCED")
      ) {
        if (!bundle.test_integrity) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["test_integrity"],
            message:
              "受控 Evidence 必须包含完整 test_integrity 记录 (TASK-P0.2a fail-closed)",
          });
        }
      }

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
 * TASK-P0.2a: 当前受控版本 EvidenceBundle Schema。
 * 强制要求 test_integrity 必须存在且完整，用于在受控派工与合流验证中进行强模式约束。
 */
export const controlledEvidenceBundleSchema = evidenceBundleSchema.superRefine(
  (bundle, ctx) => {
    if (!bundle.test_integrity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["test_integrity"],
        message:
          "受控 Evidence 必须包含完整 test_integrity 记录 (TASK-P0.2a fail-closed)",
      });
    }
  },
);
export type ControlledEvidenceBundle = EvidenceBundle & {
  test_integrity: TestIntegrityEvidence;
};

/**
 * 合并门禁的唯一派生函数（§9.2：`can_merge` 必须等于完整合并门禁的派生结果）。
 * 任何写入 Evidence 的路径都必须调用它，不得手写布尔表达式。
 */
/** TASK-P0.1：`deriveCanMerge` 接受的控制模式取值（与 Evidence 三值枚举同源） */
export type WorkerControlModeForMerge = NonNullable<
  EvidenceBundleV11["worker_control_mode"]
>;

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
  /**
   * TASK-P0.1：证据记录的 Worker 控制模式（`worker_control_mode`）。
   * 失败关闭：`UNCONTROLLED_EXTERNAL` 或缺失（undefined）一律 `false`；
   * 只有 `GATEWAY_ENFORCED` / `SANDBOX_ENFORCED` 进入下方正常验收逻辑。
   * 注意：该字符串只是证据记档，**不构成执行受控的真实性证明**；
   * SandboxWitness 深层验证属 P0-3，不在本函数职责内。
   */
  workerControlMode?: WorkerControlModeForMerge | undefined;
  /**
   * TASK-P0.1：证据对应的合同版本（`contract_revision`）。
   * 失败关闭：缺失或非正整数一律 `false`。与当前合同版本的比对由 merger
   * 在合并时独立重做（第二道封锁），本处只拒绝「版本不可确认」。
   */
  contractRevision?: number | undefined;
  /**
   * TASK-P0.3a：沙箱执行见证（`sandbox_witness`）。
   * workerControlMode 为 SANDBOX_ENFORCED 时必填且必须合法有效，否则 fail-closed 返回 false。
   */
  sandboxWitness?: SandboxWitness | undefined | null;
  /** TASK-P0.3a：任务工作树路径（用于校验 sandboxWitness 挂载路径） */
  worktreeRoot?: string | undefined;
  /** TASK-P1.4: 用于校验见证合同绑定一致性 */
  contractId?: string | undefined;
  /** TASK-P1.4: 是否强制要求见证必须携 Nonce */
  requireWitnessNonce?: boolean | undefined;
  /**
   * TASK-P0.4：测试完整性防护（test_integrity）。
   * 若修改或删除了既有测试文件且未获豁免，必须基线隔离重跑通过（baseline_rerun_passed === true）。
   */
  testIntegrity?: TestIntegrityEvidence | undefined | null;
}): boolean {
  // TASK-P0.1 第一道封锁（生成时）：控制模式缺失或不受控 → 不可合并
  if (
    input.workerControlMode !== "GATEWAY_ENFORCED" &&
    input.workerControlMode !== "SANDBOX_ENFORCED"
  ) {
    return false;
  }
  // TASK-P0.1 第一道封锁（生成时）：合同版本缺失或不可确认 → 不可合并
  if (
    typeof input.contractRevision !== "number" ||
    !Number.isInteger(input.contractRevision) ||
    input.contractRevision < 1
  ) {
    return false;
  }

  // TASK-P0.3a 第一道封锁（生成时）：SANDBOX_ENFORCED 必须提供合法有效的 sandbox_witness
  if (input.workerControlMode === "SANDBOX_ENFORCED") {
    const sw = input.sandboxWitness;
    if (!sw || typeof sw !== "object") {
      return false;
    }
    if (sw.via !== "exit") {
      return false;
    }
    const hk = sw.host_kind;
    if (
      !hk ||
      typeof hk !== "string" ||
      hk.trim() === "" ||
      hk === "unknown" ||
      hk.toLowerCase().includes("unavailable")
    ) {
      return false;
    }
    if (
      sw.mount_mode !== undefined &&
      sw.mount_mode !== "scoped" &&
      sw.mount_mode !== "readonly_enforced" &&
      sw.mount_mode !== "legacy_full_rw"
    ) {
      return false;
    }
    if (
      sw.mount_count !== undefined &&
      (typeof sw.mount_count !== "number" ||
        !Number.isInteger(sw.mount_count) ||
        sw.mount_count < 0)
    ) {
      return false;
    }
    if (
      !sw.worktree_root ||
      typeof sw.worktree_root !== "string" ||
      sw.worktree_root.trim() === ""
    ) {
      return false;
    }
    if (input.worktreeRoot !== undefined) {
      const normW = sw.worktree_root.replace(/[\\/]+/g, "/").replace(/\/$/, "");
      const normE = input.worktreeRoot
        .replace(/[\\/]+/g, "/")
        .replace(/\/$/, "");
      if (normW !== normE && normW.toLowerCase() !== normE.toLowerCase()) {
        return false;
      }
    }
    // TASK-P1.4: 见证 Nonce 与上下文绑定
    if (
      sw.nonce !== undefined &&
      (typeof sw.nonce !== "string" || sw.nonce.trim() === "")
    ) {
      return false;
    }
    if (
      sw.contract_id !== undefined &&
      input.contractId !== undefined &&
      sw.contract_id !== input.contractId
    ) {
      return false;
    }
    if (
      sw.contract_revision !== undefined &&
      input.contractRevision !== undefined &&
      sw.contract_revision !== input.contractRevision
    ) {
      return false;
    }
    if (input.requireWitnessNonce === true) {
      if (!sw.nonce || typeof sw.nonce !== "string" || sw.nonce.trim() === "") {
        return false;
      }
    }
  }

  // TASK-P0.4 第一道封锁（生成时）：测试完整性检查
  if (input.testIntegrity) {
    const ti = input.testIntegrity;
    const hasExistingMutation =
      (ti.modified_existing_tests && ti.modified_existing_tests.length > 0) ||
      (ti.deleted_existing_tests && ti.deleted_existing_tests.length > 0);
    if (hasExistingMutation && !ti.exemption) {
      if (!ti.baseline_rerun_passed) {
        return false;
      }
    }
  }

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
