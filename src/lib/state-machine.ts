import fs from "node:fs";
import path from "node:path";
import type { ApprovalStatus, LifecycleState } from "./contract.schema";

/**
 * 合同双状态机校验器 —— 《Stagent 系统架构设计规范 v1.2.1》§9.1.1 的机器可读实现。
 *
 * 设计要点（回应第一轮审查中「二元入参无法表达二维组合矩阵」的问题）：
 * - 组合校验 `validateStatePair` 的入参是 `{ lifecycle_state, approval_status }` **成对**结构，
 *   而不是两个独立标量，因此可以直接表驱动 §9.1.1 的每一行。
 * - 跃迁校验 `validateTransition` 的入参与返回值同样是**成对**结构（4 维：from.ls × from.as
 *   → to.ls × to.as），既能拒绝非法跃迁边，也能拒绝「边合法但落点组合非法」的情形。
 *
 * 本模块只做纯判定与原子落盘，不依赖 zod 运行时，避免与 contract.schema.ts 形成循环依赖
 * （contract.schema.ts 运行期引用本模块，本模块仅以 `import type` 引用其类型，编译期擦除）。
 */

// --- 1. 成对状态结构 ---

export interface ContractStatePair {
  lifecycle_state: LifecycleState;
  approval_status: ApprovalStatus;
}

export type ValidationFailureCode =
  | "ILLEGAL_STATE_PAIR"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "APPROVAL_REVISION_STALE";

export type ValidationResult =
  { ok: true } | { ok: false; code: ValidationFailureCode; message: string };

const OK: ValidationResult = { ok: true };

// --- 2. §9.1.1 组合矩阵（表驱动，逐行对应规范表格） ---

export interface StateMatrixRow {
  /** 该行允许的 lifecycle_state 集合 */
  readonly lifecycle: readonly LifecycleState[];
  /** 该行允许的 approval.status 集合 */
  readonly approval: readonly ApprovalStatus[];
  /** 规范表格中的含义，用于报错信息与文档追溯 */
  readonly meaning: string;
}

const EXECUTION_STATES = [
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
  "PENDING_RESUME",
  "AUDITED",
  "MERGED",
] as const satisfies readonly LifecycleState[];

export const STATE_MATRIX: readonly StateMatrixRow[] = [
  {
    lifecycle: ["DRAFT"],
    approval: ["DRAFT"],
    meaning: "草案编辑",
  },
  {
    lifecycle: ["PENDING_APPROVAL"],
    approval: ["PENDING_REVIEW"],
    meaning: "等待审批",
  },
  {
    lifecycle: EXECUTION_STATES,
    approval: ["APPROVED"],
    meaning: "已批准合同的准备、执行、恢复、审计与合并阶段",
  },
  {
    lifecycle: ["ABORTED"],
    approval: ["REJECTED", "APPROVED"],
    meaning: "用户拒绝或已批准后安全中止，保留历史审批事实",
  },
];

/** 全部 lifecycle_state 取值（用于穷举校验矩阵完备性） */
export const ALL_LIFECYCLE_STATES = [
  "DRAFT",
  "PENDING_APPROVAL",
  ...EXECUTION_STATES,
  "ABORTED",
] as const satisfies readonly LifecycleState[];

/** 全部 approval.status 取值 */
export const ALL_APPROVAL_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
] as const satisfies readonly ApprovalStatus[];

/** 是否为 §9.1.1 矩阵允许的 (lifecycle_state, approval.status) 组合 */
export function isLegalStatePair(pair: ContractStatePair): boolean {
  return STATE_MATRIX.some(
    (row) =>
      row.lifecycle.includes(pair.lifecycle_state) &&
      row.approval.includes(pair.approval_status),
  );
}

/**
 * 校验 (lifecycle_state, approval.status) 组合是否违反 §9.1.1。
 * Schema 层与 ContractStore 均以本函数为准，保证「唯一事实源」。
 */
export function validateStatePair(pair: ContractStatePair): ValidationResult {
  if (isLegalStatePair(pair)) return OK;
  return {
    ok: false,
    code: "ILLEGAL_STATE_PAIR",
    message:
      `Illegal state combination: lifecycle_state=${pair.lifecycle_state} ` +
      `with approval.status=${pair.approval_status} violates §9.1.1`,
  };
}

// --- 3. 跃迁表 ---

/**
 * §0.2.3.1：Fast Path 系统审批标识。
 *
 * 放在本模块而非 contract.schema.ts，是为了避免运行期循环依赖
 * （contract.schema 运行期依赖本模块；本模块只以 `import type` 引用其类型）。
 */
export const FAST_PATH_APPROVER = "system:fast-path" as const;

/**
 * 受控跃迁的触发原因（§9.1.1.1 C-02 / C-07 / C-08 / TASK-AUDITED.1）。
 * 这些边不是通用回边：缺少对应原因时必须 Fail-Closed，避免被当成捷径。
 */
export type TransitionReason =
  | "FAST_PATH_ADMISSION"
  | "WORKTREE_MISSING_HEAL"
  | "EXTERNAL_MUTATION"
  | "USER_RETURN_TO_PENDING";

/**
 * 受控跃迁的上下文事实。
 *
 * 为什么需要它：`DRAFT -> PREPARING` 是否合法取决于审批凭证与风险等级，
 * 而这两项不在 `ContractStatePair`（只有 lifecycle × approval 两个标量）里。
 * 不传上下文一律视为「无法证明条件成立」，按拒绝处理。
 */
export interface TransitionContext {
  approval?: { approved_by?: string | undefined } | undefined;
  intent?: { risk_level?: "LOW" | "MEDIUM" | "HIGH" | undefined } | undefined;
  reason?: TransitionReason | undefined;
}

/** 终态：不可再迁出 */
export const TERMINAL_STATES = [
  "MERGED",
  "ABORTED",
] as const satisfies readonly LifecycleState[];

export function isTerminalState(state: LifecycleState): boolean {
  return (TERMINAL_STATES as readonly LifecycleState[]).includes(state);
}

/**
 * 允许的 lifecycle_state 跃迁边。
 * 来源：§9.1.1 表格 + 仓内既有编排流程（orchestrator / crash-recovery / merger）。
 * 每条边的语义注释即规范依据，新增边必须先改规范再改此表。
 */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<LifecycleState, readonly LifecycleState[]>
> = {
  // 用户提交审批；Fast Path 自动准入直接进入 PREPARING（§0.2.3.1 C-02，带 Guard）
  // 注意：这里没有、也不允许出现 DRAFT -> EXECUTING —— 物理环境初始化不可跳过。
  DRAFT: ["PENDING_APPROVAL", "PREPARING", "ABORTED"],
  // 通过 → PREPARING；拒绝 → ABORTED
  PENDING_APPROVAL: ["PREPARING", "ABORTED"],
  // 准备成功 → EXECUTING；初始化中断清理后回退等待重新审批；安全中止
  PREPARING: ["EXECUTING", "PENDING_APPROVAL", "ABORTED"],
  // 开始验证；预算/循环熔断或崩溃 → PENDING_RESUME
  EXECUTING: ["VERIFYING", "PENDING_RESUME", "ABORTED"],
  // 门禁通过 → AUDITED；非安全失败重试 → EXECUTING；挂起 → PENDING_RESUME
  VERIFYING: ["AUDITED", "EXECUTING", "PENDING_RESUME", "ABORTED"],
  // 用户显式续跑；或 Worktree 丢失时自愈重建（§9.1.1.1 C-07，带 Guard）；或放弃
  PENDING_RESUME: ["EXECUTING", "PREPARING", "ABORTED"],
  // 用户核销合并；Evidence 失效需重新验证；外部改码级联降级（§9.1.1.1 C-08，带 Guard）；
  // 用户显式退回待批（§9.1.1.1 / TASK-AUDITED.1，带 Guard）；或放弃
  AUDITED: ["MERGED", "EXECUTING", "VERIFYING", "PENDING_APPROVAL", "ABORTED"],
  // 终态
  MERGED: [],
  ABORTED: [],
};

export function canTransition(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * 逐边附加约束：某些跃迁除了「边存在」还要求落点组合满足额外条件。
 *
 * 四类：
 * 1. PREPARING → PENDING_APPROVAL：§9.1.1 要求同时把 approval.status 回置为
 *    PENDING_REVIEW，只有用户再次确认才能重建 Worktree；
 * 2. DRAFT → PREPARING：Fast Path 专用（§9.1.1.1 C-02），必须持有
 *    `system:fast-path` 审批凭证且风险等级为 LOW；
 * 3. PENDING_RESUME → PREPARING 与 AUDITED → VERIFYING：自愈/降级专用
 *    （§9.1.1.1 C-07 / C-08），必须携带对应触发原因；
 * 4. AUDITED → PENDING_APPROVAL：用户显式退回待批（TASK-AUDITED.1），必须
 *    落点 approval.status=PENDING_REVIEW，且 reason=USER_RETURN_TO_PENDING。
 *
 * Guard 一律 Fail-Closed：上下文缺省即视为条件不成立。
 */
type EdgeGuard = (
  to: ContractStatePair,
  context: TransitionContext,
) => ValidationResult | null;

const EDGE_GUARDS: Partial<
  Record<`${LifecycleState}->${LifecycleState}`, EdgeGuard>
> = {
  "PREPARING->PENDING_APPROVAL": (to) =>
    to.approval_status === "PENDING_REVIEW"
      ? null
      : {
          ok: false,
          code: "ILLEGAL_TRANSITION",
          message:
            "PREPARING -> PENDING_APPROVAL must reset approval.status to " +
            `PENDING_REVIEW (§9.1.1), got ${to.approval_status}`,
        },

  "DRAFT->PREPARING": (_to, context) => {
    const approvedBy = context.approval?.approved_by;
    const riskLevel = context.intent?.risk_level;
    if (approvedBy !== FAST_PATH_APPROVER || riskLevel !== "LOW") {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message:
          `DRAFT -> PREPARING is reserved for Fast Path admission (§9.1.1.1 C-02): ` +
          `requires approval.approved_by="${FAST_PATH_APPROVER}" and ` +
          `intent.risk_level="LOW", got ` +
          `approved_by=${approvedBy ?? "unset"}, risk_level=${riskLevel ?? "unset"}. ` +
          `Standard flow must go DRAFT -> PENDING_APPROVAL -> PREPARING; ` +
          `DRAFT -> EXECUTING is never allowed.`,
      };
    }
    return null;
  },

  "PENDING_RESUME->PREPARING": (_to, context) =>
    context.reason === "WORKTREE_MISSING_HEAL"
      ? null
      : {
          ok: false,
          code: "ILLEGAL_TRANSITION",
          message:
            `PENDING_RESUME -> PREPARING requires reason="WORKTREE_MISSING_HEAL" ` +
            `(§9.1.1.1 C-07), got ${context.reason ?? "unset"}`,
        },

  "AUDITED->VERIFYING": (_to, context) =>
    context.reason === "EXTERNAL_MUTATION"
      ? null
      : {
          ok: false,
          code: "ILLEGAL_TRANSITION",
          message:
            `AUDITED -> VERIFYING requires reason="EXTERNAL_MUTATION" ` +
            `(§9.1.1.1 C-08), got ${context.reason ?? "unset"}. ` +
            `Evidence must be marked STALE in the same atomic step.`,
        },

  "AUDITED->PENDING_APPROVAL": (to, context) => {
    if (to.approval_status !== "PENDING_REVIEW") {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message:
          "AUDITED -> PENDING_APPROVAL must reset approval.status to " +
          `PENDING_REVIEW (§9.1.1 / TASK-AUDITED.1), got ${to.approval_status}`,
      };
    }
    if (context.reason !== "USER_RETURN_TO_PENDING") {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message:
          `AUDITED -> PENDING_APPROVAL requires reason="USER_RETURN_TO_PENDING" ` +
          `(§9.1.1.1 / TASK-AUDITED.1), got ${context.reason ?? "unset"}`,
      };
    }
    return null;
  },
};

/**
 * 校验一次状态跃迁（4 维：from 组合 → to 组合，外加受控边所需的上下文）。
 *
 * 依次检查：
 * 1. 源状态为终态 → TERMINAL_STATE（ABORTED / MERGED 不可再迁出，含 resume 跃迁）；
 * 2. 跃迁边不存在 → ILLEGAL_TRANSITION（自环同样视为非法，避免空转洗状态）；
 * 3. 边附加约束不满足 → ILLEGAL_TRANSITION；
 * 4. 落点组合违反 §9.1.1 → ILLEGAL_STATE_PAIR。
 *
 * `context` 只对四条受控边（DRAFT→PREPARING、PENDING_RESUME→PREPARING、
 * AUDITED→VERIFYING、AUDITED→PENDING_APPROVAL）有影响；其余边忽略。
 */
export function validateTransition(
  from: ContractStatePair,
  to: ContractStatePair,
  context: TransitionContext = {},
): ValidationResult {
  if (isTerminalState(from.lifecycle_state)) {
    return {
      ok: false,
      code: "TERMINAL_STATE",
      message: `lifecycle_state=${from.lifecycle_state} is terminal and cannot transition to ${to.lifecycle_state} (§9.1.1)`,
    };
  }

  if (!canTransition(from.lifecycle_state, to.lifecycle_state)) {
    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: `Illegal transition: ${from.lifecycle_state} -> ${to.lifecycle_state}`,
    };
  }

  const guard =
    EDGE_GUARDS[`${from.lifecycle_state}->${to.lifecycle_state}` as const];
  if (guard) {
    const failure = guard(to, context);
    if (failure) return failure;
  }

  return validateStatePair(to);
}

// --- 4. 审批版本绑定（防 TOCTOU） ---

/**
 * 审批是否仍然绑定当前合同版本。
 *
 * §9.1 不变式：任何 Scope / 命令 / 预算 / 网络 / 环境 / Worker / 验证命令变更
 * 都递增 `contract_revision` 并要求重新批准。因此当
 * `approval.status === "APPROVED"` 且 `approved_revision !== contract_revision`
 * 时，审批已失效，不得继续推进执行或合并。
 *
 * `approved_revision` 缺省时按「未绑定」处理：历史 v1.1.3 迁移合同尚未记录该字段，
 * 迁移工具会强制标记需重新审批（见 migration.ts），此处不放行任何新版本推进。
 */
export function isApprovalCurrent(contract: {
  contract_revision: number;
  approval: { status: ApprovalStatus; approved_revision?: number | undefined };
}): boolean {
  if (contract.approval.status !== "APPROVED") return false;
  return contract.approval.approved_revision === contract.contract_revision;
}

/** `isApprovalCurrent` 的断言版本，失败时抛出带 code 的异常 */
export function assertApprovalBinding(contract: {
  contract_revision: number;
  approval: { status: ApprovalStatus; approved_revision?: number | undefined };
}): ValidationResult {
  if (isApprovalCurrent(contract)) return OK;
  return {
    ok: false,
    code: "APPROVAL_REVISION_STALE",
    message:
      `approval is not bound to the current contract revision ` +
      `(approved_revision=${contract.approval.approved_revision ?? "unset"}, ` +
      `contract_revision=${contract.contract_revision}); re-approval required (§9.1)`,
  };
}

// --- 5. 原子落盘（writeTemp + fsync + rename） ---

/**
 * 原子写入 JSON 状态文件。§9.1.1 要求合同状态变更必须原子写入，避免崩溃时
 * 只更新 lifecycle_state 而漏掉 approval.status（或反之）。
 *
 * 顺序：写临时文件 → fsync 刷盘 → rename 覆盖 → fsync 目录项（POSIX 上
 * rename 本身原子，但目录项落盘需额外 fsync 才能在掉电后保证可见）。
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );

  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw err;
  }

  // 目录项 fsync：让 rename 在掉电后仍然可见（部分平台不支持，忽略即可）
  try {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Windows 等平台不支持目录 fd，退化为「尽力而为」
  }
}
