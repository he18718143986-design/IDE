import { z } from "zod";
import { FAST_PATH_APPROVER, validateStatePair } from "./state-machine";

/**
 * 软件合同 Schema (v1.3.2)
 * 严格对齐《Stagent 系统架构设计规范 v1.6.1》§9.1 与 §9.1.1。
 * 本文件是全工程唯一合同契约（红线一：Schema 即宪法）。
 *
 * v1.2.0 相对 v1.1.3 的增量：
 *  - 新增 `contract_revision`：任何 Scope/命令/预算/网络/环境/Worker/验证命令变更均递增
 *  - 新增 `worker_spec`（必填）：声明 adapter 与执行控制模式，承载 GATEWAY_ENFORCED 不变式
 *  - 新增 `conversation_ref?` / `supervisor_metadata?`：建议溯源与成熟度评估
 *  - `creator` 由 `"tech_lead"` 改为 `"supervisor"`（ADR-007 双 Agent 术语归一）
 *  - `approval.approved_revision?`：记录被批准时的合同版本，用于防 TOCTOU
 *  - 状态组合校验下沉到 state-machine.ts，避免内联逻辑与独立校验器漂移
 *
 * v1.3.0 相对 v1.2.0 的增量（TASK-0.2c / 架构 §9.1、§0.2.3.1）：
 *  - `schema_version` 放宽为 1.2.0 | 1.3.0 双版本：存量合同继续可解析，新合同签发 1.3.0
 *  - `creator` 增加 `"system:fast-path"`：Fast Path 自动准入需要系统签发留痕
 *  - `authorization.git` 补齐显式受控字段：允许的 Git 操作白名单、强制禁用参数、
 *    干净基线检查；禁用参数必须包含规范规定的五个强制项，任何配置都不可覆盖
 *  - `approval` 补齐审批凭证字段：签名摘要、准入决策、决策说明、驳回者
 *  - 新增不变式：`ADMITTED_AUTOMATIC` 只能由 `system:fast-path` 签发
 *
 * 未在本卡落地的 §9.1 目标字段（已记录于交付说明，避免误读为"已实现"）：
 *  - 顶层 `scope` / `change_request_id` / `presentation_state`（分别牵动 daemon 全链路
 *    与 TASK-D.3 的 15 态投影，另行推进）
 *  - `worker_spec` 的 `SANDBOX_ENFORCED` / `billing_model` / `verified_on`
 *  - `EvidenceBundleV12`（架构 §9.2，单独演进）
 */

/** 当前签发版本：新建合同一律使用此版本（TASK-L.3 → 1.3.2） */
export const SOFTWARE_CONTRACT_SCHEMA_VERSION = "1.3.2" as const;
/** 存量兼容版本：v1.3.1 合同继续可解析（含 manual_confirmation） */
export const LEGACY_CONTRACT_SCHEMA_VERSION_V131 = "1.3.1" as const;
/** 存量兼容版本：v1.3.0 合同继续可解析 */
export const LEGACY_CONTRACT_SCHEMA_VERSION_V130 = "1.3.0" as const;
/** 存量兼容版本：v1.2.0 合同继续可解析、可迁移 */
export const LEGACY_CONTRACT_SCHEMA_VERSION_V12 = "1.2.0" as const;

/**
 * 允许 `verification_spec.manual_confirmation` 的版本集合。
 * 1.3.0 及更早不得携带该字段；1.3.1 / 1.3.2 行为保持一致。
 */
export const MANUAL_CONFIRMATION_SCHEMA_VERSIONS = [
  LEGACY_CONTRACT_SCHEMA_VERSION_V131,
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
] as const;

/**
 * 要求 `authorization.git` 显式凭证（allowed_operations / forbidden_flags /
 * enforce_clean_base）的版本集合。1.2.0 存量不做追溯。
 */
export const GIT_EXPLICIT_AUTH_SCHEMA_VERSIONS = [
  LEGACY_CONTRACT_SCHEMA_VERSION_V130,
  LEGACY_CONTRACT_SCHEMA_VERSION_V131,
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
] as const;

/** 允许解析的合同 Schema 版本（白名单，未列出的版本一律拒绝） */
export const SUPPORTED_CONTRACT_SCHEMA_VERSIONS = [
  LEGACY_CONTRACT_SCHEMA_VERSION_V12,
  LEGACY_CONTRACT_SCHEMA_VERSION_V130,
  LEGACY_CONTRACT_SCHEMA_VERSION_V131,
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
] as const;

export const contractSchemaVersionSchema = z.enum(
  SUPPORTED_CONTRACT_SCHEMA_VERSIONS,
);

// --- 1. 生命周期与状态模型 (§9.1 9 态枚举) ---

export const lifecycleStateSchema = z.enum([
  "DRAFT", // 草案生成中
  "PENDING_APPROVAL", // 等待用户审批
  "PREPARING", // 创建 Worktree、配置 Scoped MCP
  "EXECUTING", // Worker 编码执行中
  "VERIFYING", // 门禁测试与 Scope 校验中
  "PENDING_RESUME", // 异常断电/重启等待用户恢复断点
  "AUDITED", // 门禁通过，生成 Evidence Bundle 等待核销
  "MERGED", // 用户核销入主干，清理现场完成
  "ABORTED", // 用户驳回或安全熔断终止（终态）
]);
export type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export const approvalStatusSchema = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/**
 * §9.1 / §0.2.3.1：`creator` 为 user / supervisor / system:fast-path
 * （v1.1.3 的 tech_lead 已废止）。`system:fast-path` 只用于 Fast Path 自动准入签发，
 * 必须与 `approval.approved_by === "system:fast-path"` 成对出现。
 */
export const creatorSchema = z.enum(["user", "supervisor", "system:fast-path"]);
export type Creator = z.infer<typeof creatorSchema>;

/** Fast Path 系统签发标识（唯一事实源在 state-machine.ts，此处仅做语义别名） */
export const FAST_PATH_CREATOR = FAST_PATH_APPROVER;

// --- 2. 预算与成本硬上限 (§9.1) ---

// 安全路径校验：禁止路径逃逸 (../) 或绝对路径开头 (/)
export const safePathString = z
  .string()
  .min(1)
  .refine(
    (p) => !p.startsWith("/") && !p.includes("../") && !p.includes("..\\"),
    {
      message:
        "Path traversal detected: paths must be relative and cannot contain '..'",
    },
  );

export const budgetLimitsSchema = z.object({
  max_file_modifications: z.number().int().positive().default(10),
  max_total_diff_lines: z.number().int().positive().default(2000),
  max_duration_seconds: z.number().int().positive().default(1800), // 任务级总时长，默认 1800s
  max_agent_turns: z.number().int().positive().optional(),
  max_verification_retries: z.number().int().nonnegative().default(3), // 默认 3
  /** A §9.1 v1.3.2：最大命令执行次数上限（可选，超限触发 E_BUDGET_EXCEEDED 熔断） */
  max_command_executions: z.number().int().positive().optional(),
  /** A §9.1 v1.3.2：最大工具调用次数上限（可选，超限触发 E_BUDGET_EXCEEDED 熔断） */
  max_tool_calls: z.number().int().positive().optional(),
});
export type BudgetLimits = z.infer<typeof budgetLimitsSchema>;

export const contractAccountingModeSchema = z.enum([
  "PROVIDER_REPORTED",
  "ESTIMATED",
]);
export type ContractAccountingMode = z.infer<
  typeof contractAccountingModeSchema
>;

export const costLimitsSchema = z.object({
  max_input_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  max_cost_minor_units: z.number().int().nonnegative(), // 最小货币单位（如分），整数
  currency: z.string().min(1), // ISO 4217，如 "CNY" | "USD"
  pricing_version: z.string().min(1),
  accounting_mode: contractAccountingModeSchema,
});
export type CostLimits = z.infer<typeof costLimitsSchema>;

// --- 3. 执行权限 (§9.1 execution_permissions) ---

export const networkPolicySchema = z.enum([
  "DENY",
  "EXPLICIT_TARGETS",
  "USER_APPROVED",
]);
export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

export const portPolicySchema = z.enum([
  "NONE",
  "DYNAMIC_IF_SUPPORTED",
  "EXPLICIT",
]);
export type PortPolicy = z.infer<typeof portPolicySchema>;

export const envFileGrantSchema = z.object({
  file: safePathString, // 受控 env 文件，例如 .env.test
  command_aliases: z.array(z.string().min(1)),
  variable_names: z.array(z.string().min(1)),
});
export type EnvFileGrant = z.infer<typeof envFileGrantSchema>;

export const executionPermissionsSchema = z.object({
  allowed_commands: z.array(z.string().min(1)).default([]),
  allowed_environment_variable_names: z.array(z.string().min(1)).default([]),
  network_policy: networkPolicySchema.default("DENY"),
  dependency_changes_allowed: z.boolean().default(false),
  editor_command_template: z.string().optional(), // 参数化模板，禁止 shell 拼接
  env_file_grants: z.array(envFileGrantSchema).optional(),
  port_policy: portPolicySchema.optional(),
});
export type ExecutionPermissions = z.infer<typeof executionPermissionsSchema>;

// --- 4. 结构化验证命令 (§9.1 verification_spec，杜绝 shell 注入歧义) ---

export const manualConfirmationEvidenceFieldSchema = z.enum([
  "actor",
  "confirmed_at",
  "reason",
]);
export type ManualConfirmationEvidenceField = z.infer<
  typeof manualConfirmationEvidenceFieldSchema
>;

export const manualConfirmationSpecSchema = z.object({
  reason_required: z.literal(true),
  capture_evidence: z
    .array(manualConfirmationEvidenceFieldSchema)
    .superRefine((items, ctx) => {
      const unique = new Set(items);
      if (
        items.length !== 3 ||
        unique.size !== 3 ||
        !unique.has("actor") ||
        !unique.has("confirmed_at") ||
        !unique.has("reason")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'capture_evidence must contain exactly ["actor", "confirmed_at", "reason"] in any order without omission or extra fields',
        });
      }
    }),
});
export type ManualConfirmationSpec = z.infer<
  typeof manualConfirmationSpecSchema
>;

export const verificationCommandSchema = z.object({
  alias: z.string().min(1),
  executable: z.string().min(1),
  args: z.array(z.string()), // 已分离 argv；禁止 shell 字符串解析/拼接
  expected_exit_code: z.number().int().default(0),
  timeout_seconds: z.number().int().positive().default(60), // 单命令上限，默认 60s
  working_directory: safePathString.optional(),
});
export type VerificationCommand = z.infer<typeof verificationCommandSchema>;

// --- 5. Worker 声明 (§9.1 worker_spec) ---

export const runtimeKindSchema = z.enum([
  "MANAGED_TOOL_CALLING",
  "EXTERNAL_CLI",
]);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

/**
 * §9.1 Schema 不变式：`UNCONTROLLED_EXTERNAL` 的 Worker 不得进入合同执行状态，
 * 不得生成可合并 Evidence。`GATEWAY_ENFORCED` 必须绑定经测试的 Adapter 能力。
 */
export const workerControlModeSchema = z.enum([
  "GATEWAY_ENFORCED",
  "UNCONTROLLED_EXTERNAL",
]);
export type WorkerControlMode = z.infer<typeof workerControlModeSchema>;

export const workerSpecSchema = z.object({
  adapter_id: z.string().min(1),
  runtime_kind: runtimeKindSchema,
  model_id: z.string().min(1).optional(),
  control_mode: workerControlModeSchema,
  adapter_version: z.string().min(1),
});
export type WorkerSpec = z.infer<typeof workerSpecSchema>;

// --- 6. 建议溯源与成熟度评估 (§9.1 conversation_ref / supervisor_metadata) ---

export const contextPolicySchema = z.enum([
  "USER_SELECTED",
  "SESSION_SUMMARY",
  "NO_TRANSCRIPT",
]);
export type ContextPolicy = z.infer<typeof contextPolicySchema>;

export const conversationRefSchema = z.object({
  session_id: z.string().min(1),
  message_ids: z.array(z.string().min(1)),
  context_policy: contextPolicySchema,
});
export type ConversationRef = z.infer<typeof conversationRefSchema>;

/**
 * 成熟度评估。
 *
 * ⚠️ `score` 是**纯建议性信号**：禁止作为授权门禁，禁止参与
 * `approval.status` 或 `lifecycle_state` 的任何计算（§9.1 / ADR-007）。
 * 本 Schema 不对 score 施加任何数值门槛，也不在任何 refine 中引用它。
 */
export const maturityAssessmentSchema = z.object({
  score: z.number().optional(), // 仅建议性信号，禁止作为授权或状态门禁
  rationale: z.array(z.string()),
  unresolved_questions: z.array(z.string()),
  model_id: z.string().min(1).optional(),
  assessed_at: z.string(),
});
export type MaturityAssessment = z.infer<typeof maturityAssessmentSchema>;

export const suggestedScopeSchema = z.object({
  writable_paths: z.array(safePathString),
  readonly_paths: z.array(safePathString),
  strictly_forbidden_paths: z.array(z.string()),
});
export type SuggestedScope = z.infer<typeof suggestedScopeSchema>;

/** 方案验收条目引用（TASK-L.3 / delivery-lifecycle §6） */
export const acceptanceRefSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  check: z.enum(["auto", "playtest", "both"]),
});
export type AcceptanceRef = z.infer<typeof acceptanceRefSchema>;

export const supervisorMetadataSchema = z.object({
  suggestion_id: z.string().min(1),
  maturity_assessment: maturityAssessmentSchema.optional(),
  suggested_scope: suggestedScopeSchema.optional(),
  /** 方案 acceptance[] 投影；签署后不改合同正文 */
  acceptance_refs: z.array(acceptanceRefSchema).optional(),
  /** 方案条目 id 追踪链（goals/modules/acceptance 等） */
  scheme_item_ids: z.array(z.string().min(1)).optional(),
  /** 合同桩 id；由 L.9 写入，L.3 预留可为 null */
  stub_id: z.string().min(1).nullable().optional(),
});
export type SupervisorMetadata = z.infer<typeof supervisorMetadataSchema>;

// --- 7. Git 授权凭证 (§9.1 authorization.git，v1.3.0 补齐) ---

/**
 * 强制禁用参数（§9.1 不变式 3）：任何用户配置都不可覆盖。
 * 列表顺序即规范列出的顺序，便于审计比对。
 */
export const MANDATORY_GIT_FORBIDDEN_FLAGS = [
  "--force",
  "-f",
  "--hard",
  "--amend",
  "--no-verify",
] as const;

/** 允许显式授权的 Git 操作白名单（未列出的一律视为未授权） */
export const gitOperationSchema = z.enum([
  "status",
  "diff",
  "add",
  "commit",
  "checkout",
  "branch",
  "merge",
]);
export type GitOperation = z.infer<typeof gitOperationSchema>;

/** 默认安全白名单：只覆盖本地可逆操作，不含 push / reset / clean */
export const DEFAULT_ALLOWED_GIT_OPERATIONS: GitOperation[] = [
  "status",
  "diff",
  "add",
  "commit",
  "checkout",
  "branch",
  "merge",
];

/**
 * v1.3.0 的 Git 授权凭证。
 *
 * 向后兼容策略：v1.2.0 的 `base_branch` / `task_branch` / `use_worktree` 保留为可选，
 * 使存量合同（以及依赖这些字段的 Worktree 创建逻辑）继续可解析；
 * 而 `allowed_operations` / `forbidden_flags` / `enforce_clean_base` 三项
 * 对 `schema_version === "1.3.0"` 的合同为必填（见文件底部 superRefine）。
 */
export const gitAuthorizationSchema = z.object({
  // —— v1.2.0 兼容字段（存量合同依赖，新合同继续写入） ——
  base_branch: z.string().min(1).default("main"),
  /**
   * 任务分支：既是 v1.2.0 的必填字段，也是 Worktree 创建逻辑实际使用的分支名。
   * v1.3.0 的 `task_worktree_branch` 是同一事实的规范别名，两者由 createContractDraft
   * 与迁移函数同时写入；此处保持必填，避免下游拿到 undefined 后静默退化。
   */
  task_branch: z
    .string()
    .regex(/^task\//, "task_branch must use 'task/' prefix"),
  target_branch: z.string().min(1).default("main"),
  /** v0.1 强制 Worktree 物理隔离；v1.3.0 由 execution 侧语义承接 */
  use_worktree: z.literal(true).optional(),

  // —— v1.3.0 显式受控字段 ——
  /** 任务 Worktree 分支名（替代 v1.2.0 的 task_branch） */
  task_worktree_branch: z
    .string()
    .regex(/^task\//, "task_worktree_branch must use 'task/' prefix")
    .optional(),
  /** 允许的 Git 操作白名单 */
  allowed_operations: z.array(gitOperationSchema).optional(),
  /** 禁止的 Git 参数；必须完整包含 MANDATORY_GIT_FORBIDDEN_FLAGS */
  forbidden_flags: z.array(z.string().min(1)).optional(),
  /** 是否要求基于干净基线开工（脏工作区需显式确认） */
  enforce_clean_base: z.boolean().optional(),
});
export type GitAuthorization = z.infer<typeof gitAuthorizationSchema>;

// --- 8. 软件合同模式 (§9.1 SoftwareContractV13) ---

/**
 * 准入决策：区分「系统自动准入」与「用户显式批准」。
 * §0.2.3.1 要求 Fast Path 必须留下 `ADMITTED_AUTOMATIC` 痕迹，不得与人工审批混同。
 */
export const admissionDecisionSchema = z.enum([
  "ADMITTED_AUTOMATIC",
  "ADMITTED_EXPLICIT_APPROVAL",
]);
export type AdmissionDecision = z.infer<typeof admissionDecisionSchema>;

const approvalSchema = z
  .object({
    status: approvalStatusSchema,
    approved_by: z.string().min(1).optional(),
    approved_at: z.string().optional(),
    /** 被批准时的 contract_revision；与当前 revision 不一致即审批失效 */
    approved_revision: z.number().int().nonnegative().optional(),
    /** v1.3.0：审批凭证摘要（签名或哈希），用于事后核验审批事实未被篡改 */
    approval_signature: z.string().min(1).optional(),
    /** v1.3.0：准入决策来源（自动 / 显式） */
    admitted_policy_decision: admissionDecisionSchema.optional(),
    /** v1.3.0：决策说明，面向用户的白话理由 */
    decision_notes: z.string().optional(),
    /** v1.3.0：驳回者（ABORTED 历史合同迁移时回填 `system:aborted`） */
    rejected_by: z.string().min(1).optional(),
    rejection_reason: z.string().optional(),
  })
  .superRefine((approval, ctx) => {
    // §9.1.1：当且仅当 APPROVED 时 approved_by / approved_at 必填
    if (approval.status === "APPROVED") {
      if (!approval.approved_by || !approval.approved_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "approval.status is APPROVED but approved_by/approved_at are missing",
        });
      }
    }

    // §0.2.3.1 / 零静默授权：自动准入只能由 Fast Path 系统凭证签发。
    // 否则任何调用方都能把 ADMITTED_AUTOMATIC 贴到人工合同上，掩盖审批事实。
    if (
      approval.admitted_policy_decision === "ADMITTED_AUTOMATIC" &&
      approval.approved_by !== FAST_PATH_CREATOR
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `approval.admitted_policy_decision=ADMITTED_AUTOMATIC requires ` +
          `approved_by="${FAST_PATH_CREATOR}" (§0.2.3.1), got ` +
          `${approval.approved_by ?? "unset"}`,
      });
    }
  });

/** 允许执行合同的 lifecycle_state（UNCONTROLLED_EXTERNAL 不得进入） */
const EXECUTION_CAPABLE_STATES: readonly LifecycleState[] = [
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
  "PENDING_RESUME",
  "AUDITED",
  "MERGED",
];

export const softwareContractSchema = z
  .object({
    contract_id: z.string().min(1),
    /** 双版本白名单：存量 1.2.0 继续可解析，新合同签发 1.3.0 */
    schema_version: contractSchemaVersionSchema,
    contract_revision: z.number().int().min(1),
    created_at: z.string(),
    creator: creatorSchema,
    conversation_ref: conversationRefSchema.optional(),
    supervisor_metadata: supervisorMetadataSchema.optional(),
    worker_spec: workerSpecSchema,

    lifecycle_state: lifecycleStateSchema,
    intent: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000),
      acceptance_criteria: z.array(z.string().min(1)).min(1),
      risk_level: riskLevelSchema,
    }),
    authorization: z.object({
      git: gitAuthorizationSchema,
      file_system_scope: z.object({
        writable_paths: z.array(safePathString).min(1, "empty scope rejected"),
        readonly_paths: z.array(safePathString).default([]),
        strictly_forbidden_paths: z.array(z.string()).default([]),
      }),
      budget_limits: budgetLimitsSchema.default({}),
      cost_limits: costLimitsSchema,
      execution_permissions: executionPermissionsSchema.default({}),
    }),
    verification_spec: z.object({
      commands: z.array(verificationCommandSchema),
      manual_confirmation: manualConfirmationSpecSchema.optional(),
    }),
    approval: approvalSchema,
  })
  .superRefine((contract, ctx) => {
    // §9.1.1 双状态机联动规则：拒绝非法的 lifecycle × approval 组合
    // （校验逻辑唯一事实源在 state-machine.ts，此处只做 Schema 层兜底）
    const pair = validateStatePair({
      lifecycle_state: contract.lifecycle_state,
      approval_status: contract.approval.status,
    });
    if (!pair.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: pair.message,
      });
    }

    // §9.1 Schema 不变式：UNCONTROLLED_EXTERNAL 不得进入合同执行状态
    if (
      contract.worker_spec.control_mode === "UNCONTROLLED_EXTERNAL" &&
      EXECUTION_CAPABLE_STATES.includes(contract.lifecycle_state)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `worker_spec.control_mode=UNCONTROLLED_EXTERNAL cannot reach ` +
          `lifecycle_state=${contract.lifecycle_state} (§9.1 invariant: ` +
          `uncontrolled workers must not execute contracts or produce mergeable evidence)`,
      });
    }

    // §9.1 不变式 3：禁用参数不可为空，且必须覆盖规范规定的五个强制项。
    // 只对"提供了该字段"的合同校验，v1.2.0 存量合同不受追溯影响。
    const forbiddenFlags = contract.authorization.git.forbidden_flags;
    if (forbiddenFlags !== undefined) {
      const missing = MANDATORY_GIT_FORBIDDEN_FLAGS.filter(
        (flag) => !forbiddenFlags.includes(flag),
      );
      if (missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `authorization.git.forbidden_flags is missing mandatory flags: ` +
            `${missing.join(", ")} (§9.1 invariant 3: these can never be overridden)`,
        });
      }
    }

    // §1.1：commands.length === 0 时必须提供 manual_confirmation
    if (
      contract.verification_spec.commands.length === 0 &&
      !contract.verification_spec.manual_confirmation
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "At least one verification command is required unless manual_confirmation is declared",
      });
    }

    // §1.3：manual_confirmation 只允许出现在 1.3.1 / 1.3.2 合同上（版本集合判断）。
    // 1.3.0 合同带有该字段时拒绝；升版后既有 1.3.1 行为保持不变。
    if (
      contract.verification_spec.manual_confirmation !== undefined &&
      !(MANUAL_CONFIRMATION_SCHEMA_VERSIONS as readonly string[]).includes(
        contract.schema_version,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `manual_confirmation is only allowed on schema_version 1.3.1 or 1.3.2, got ${contract.schema_version}`,
      });
    }

    // v1.3.0 / v1.3.1 / v1.3.2 必填字段：新合同必须显式声明 Git 授权凭证，
    // 不允许靠缺省值"看起来合规"。存量 1.2.0 合同不做追溯要求。
    if (
      (GIT_EXPLICIT_AUTH_SCHEMA_VERSIONS as readonly string[]).includes(
        contract.schema_version,
      )
    ) {
      const git = contract.authorization.git;
      const requiredGitFields: Array<[string, unknown]> = [
        ["allowed_operations", git.allowed_operations],
        ["forbidden_flags", git.forbidden_flags],
        ["enforce_clean_base", git.enforce_clean_base],
      ];
      for (const [field, value] of requiredGitFields) {
        if (value === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `authorization.git.${field} is required for schema_version ` +
              `${contract.schema_version} (§9.1)`,
          });
        }
      }
    }
  });

export type SoftwareContractV13 = z.infer<typeof softwareContractSchema>;
/**
 * @deprecated 使用 `SoftwareContractV13`。保留别名只为避免全仓批量改导入；
 * 两者指向同一个解析结果类型（Schema 已同时接受 1.2.0 与 1.3.0）。
 */
export type SoftwareContractV12 = SoftwareContractV13;
/** 兼容别名：全仓既有代码使用 `SoftwareContract` */
export type SoftwareContract = SoftwareContractV13;

// 兼容导出：Evidence 定义已迁至 evidence.schema.ts（红线五：单一事实源）
export {
  evidenceVerdictStatusSchema,
  type EvidenceVerdictStatus,
  evidenceBundleSchema,
  reasonCodeSchema,
  type ReasonCode,
  type EvidenceBundle,
  type EvidenceBundleV11,
} from "./evidence.schema";

/** 默认 Worker 声明：内置受管工具调用，强制经 Scoped Gateway 执行 */
export const DEFAULT_WORKER_SPEC: WorkerSpec = {
  adapter_id: "stagent.builtin.ai-sdk",
  runtime_kind: "MANAGED_TOOL_CALLING",
  control_mode: "GATEWAY_ENFORCED",
  adapter_version: "0.1.0",
};

// Helper to create a new Contract Draft adhering to v1.2.0
export function createContractDraft(params: {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  riskLevel?: RiskLevel | undefined;
  writablePaths: string[];
  readonlyPaths?: string[] | undefined;
  strictlyForbiddenPaths?: string[] | undefined;
  baseBranch?: string | undefined;
  targetBranch?: string | undefined;
  commands?: VerificationCommand[] | undefined;
  manualConfirmation?: ManualConfirmationSpec | undefined;
  maxFileModifications?: number | undefined;
  maxVerificationRetries?: number | undefined;
  maxDurationSeconds?: number | undefined;
  maxCostMinorUnits?: number | undefined;
  currency?: string | undefined;
  pricingVersion?: string | undefined;
  accountingMode?: ContractAccountingMode | undefined;
  creator?: Creator | undefined;
  workerSpec?: Partial<WorkerSpec> | undefined;
  conversationRef?: ConversationRef | undefined;
  supervisorMetadata?: SupervisorMetadata | undefined;
}): SoftwareContractV12 {
  const contractId = `contract_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const baseBranch = params.baseBranch ?? "main";
  const taskBranch = `task/${contractId}`;

  const raw = {
    contract_id: contractId,
    schema_version: SOFTWARE_CONTRACT_SCHEMA_VERSION,
    contract_revision: 1,
    created_at: new Date().toISOString(),
    creator: params.creator ?? ("user" as const),
    ...(params.conversationRef === undefined
      ? {}
      : { conversation_ref: params.conversationRef }),
    ...(params.supervisorMetadata === undefined
      ? {}
      : { supervisor_metadata: params.supervisorMetadata }),
    worker_spec: { ...DEFAULT_WORKER_SPEC, ...(params.workerSpec ?? {}) },
    lifecycle_state: "DRAFT" as const,
    intent: {
      title: params.title,
      description: params.description,
      acceptance_criteria: params.acceptanceCriteria,
      risk_level: params.riskLevel ?? ("MEDIUM" as const),
    },
    authorization: {
      git: {
        base_branch: baseBranch,
        task_branch: taskBranch,
        task_worktree_branch: taskBranch,
        target_branch: params.targetBranch ?? baseBranch,
        use_worktree: true as const,
        // v1.3.0：显式授权凭证。默认只放可逆的本地操作，
        // 禁用参数强制内嵌规范五项，调用方无法通过参数收窄。
        allowed_operations: [...DEFAULT_ALLOWED_GIT_OPERATIONS],
        forbidden_flags: [...MANDATORY_GIT_FORBIDDEN_FLAGS],
        enforce_clean_base: true,
      },
      file_system_scope: {
        writable_paths: params.writablePaths,
        readonly_paths: params.readonlyPaths ?? [],
        strictly_forbidden_paths: params.strictlyForbiddenPaths ?? [
          ".env*",
          "**/.git/**",
          "package-lock.json",
          "pnpm-lock.yaml",
        ],
      },
      budget_limits: {
        max_file_modifications: params.maxFileModifications ?? 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: params.maxDurationSeconds ?? 1800,
        max_verification_retries: params.maxVerificationRetries ?? 3,
      },
      cost_limits: {
        max_cost_minor_units: params.maxCostMinorUnits ?? 200_00, // 默认 200.00（最小货币单位）
        currency: params.currency ?? "CNY",
        pricing_version: params.pricingVersion ?? "unpriced-v0",
        accounting_mode: params.accountingMode ?? ("ESTIMATED" as const),
      },
      execution_permissions: {
        allowed_commands: ["test", "lint", "typecheck"],
        allowed_environment_variable_names: [],
        network_policy: "DENY" as const,
        dependency_changes_allowed: false,
      },
    },
    verification_spec: {
      commands:
        params.commands !== undefined
          ? params.commands
          : params.manualConfirmation !== undefined
            ? []
            : [
                {
                  alias: "test",
                  executable: "npm",
                  args: ["test"],
                  expected_exit_code: 0,
                  timeout_seconds: 60,
                },
              ],
      ...(params.manualConfirmation === undefined
        ? {}
        : { manual_confirmation: params.manualConfirmation }),
    },
    approval: {
      status: "DRAFT" as const,
    },
  };

  return softwareContractSchema.parse(raw);
}

/**
 * 递增合同版本（§9.1：任何 Scope/命令/预算/网络/环境/Worker/验证命令变更
 * 均递增 contract_revision 并要求重新批准）。
 *
 * 返回新合同，`approval` 一律回置为 `PENDING_REVIEW`——重新批准是不可绕过的。
 */
export function bumpContractRevision(
  contract: SoftwareContractV12,
): SoftwareContractV12 {
  return softwareContractSchema.parse({
    ...contract,
    contract_revision: contract.contract_revision + 1,
    lifecycle_state: "PENDING_APPROVAL",
    approval: {
      status: "PENDING_REVIEW",
      ...(contract.approval.rejection_reason === undefined
        ? {}
        : { rejection_reason: contract.approval.rejection_reason }),
    },
  });
}
