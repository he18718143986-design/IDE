import type { ApprovalStatus, LifecycleState } from "../contract.schema";
import { validateStatePair } from "../state-machine";

/**
 * 面向非技术用户的 15 展示状态确定性投影
 * —— 《Stagent 系统架构设计规范 v1.6.1》§6.3.1 / §9.6，TASK-D.3。
 *
 * 设计红线（三条，缺一不可）：
 * 1. **词汇表唯一**：只有本文件导出的取值（§6.3.1 原 15 态 + supervisor §16.2
 *    增补的 `PROJECT_MAPPING`）。禁止旧版 `CONTRACT_REVIEW` /
 *    `GRAPH_ORCHESTRATING` / `PREPARING` 之类别名混入展示态。
 * 2. **投影必须确定性**：相同输入恒得相同输出，不依赖判据的书写顺序、
 *    对象键序、时间或随机数。`(AUDITED, APPROVED)` 的四分支按规范给定的
 *    优先级短路，消除"多个判据同时为真"时的实现自由裁量。
 * 3. **输入域外一律失败**：非法 `(lifecycle_state, approval_status)` 组合、
 *    或 AUDITED 四分支全不成立，都不猜一个"看起来合理"的状态，而是抛
 *    `PresentationStateProjectionError`。猜错状态会直接误导非技术用户。
 *
 * 与状态机的关系：组合合法性以 `state-machine.ts` 的 `validateStatePair` 为
 * 唯一事实源，本模块不重复定义矩阵，避免两份清单漂移。
 */

/** §9.6 + supervisor §16.2：唯一展示态词汇表（顺序便于逐行比对） */
export const PRESENTATION_STATES = [
  "EXPLORING",
  "DEMO_PREVIEW",
  "GRAPH_MAPPING",
  "PROJECT_MAPPING",
  "NEEDS_APPROVAL",
  "EXECUTING",
  "STOPPING",
  "PAUSED",
  "VERIFYING",
  "FAILED",
  "REAL_PLAYTEST",
  "DISPUTED_INSPECTING",
  "READY_TO_MERGE",
  "CONFLICT",
  "MERGED",
  "ABORTED",
] as const;

export type PresentationState = (typeof PRESENTATION_STATES)[number];

/**
 * 投影所需的运行时判据（§6.3.1 第三列）。
 * 全部可选：缺省即"该判据不成立"，由确定性兜底分支接管。
 */
export interface PresentationRuntimeContext {
  /** Demo 原型服务状态；`RUNNING` 时进入 DEMO_PREVIEW */
  demo_service?: { status?: string | undefined } | undefined;
  /** Task Graph 拓扑生成是否进行中（PREPARING 的补充说明，不改变映射结果） */
  dag_generation?: { in_progress?: boolean | undefined } | undefined;
  /** supervisor §16.2：规划密封后整理项目地图（与 GRAPH_MAPPING 交接瞬态区分） */
  project_mapping?: boolean | undefined;
  /** 用户已发起停止；EXECUTING 下为 true 时展示 STOPPING */
  stopping_requested?: boolean | undefined;
  /** 挂起原因（§6.3.2），PAUSED 时用于提示文案，不改变映射结果 */
  suspend_reason?: string | null | undefined;
  /** 验证结果与重试预算 */
  verification?:
    | {
        passed?: boolean | undefined;
        retry_count?: number | undefined;
        max_retries?: number | undefined;
      }
    | undefined;
  /** 真实环境预览服务状态；`RUNNING` 时进入 REAL_PLAYTEST */
  real_preview?: { status?: string | undefined } | undefined;
  /** 质疑自查会话；`OPEN` 时进入 DISPUTED_INSPECTING */
  dispute_session?: { status?: string | undefined } | undefined;
  /** 证据可合并性；`can_merge === true` 才可能进入 READY_TO_MERGE */
  evidence?: { can_merge?: boolean | undefined } | undefined;
  /** 合并前检测到目标分支已前进（§6.3.1 CONFLICT） */
  target_branch_ahead?: boolean | undefined;
}

/**
 * 投影输入。
 *
 * 两个字段都用具名键，刻意不做位置参数——规范反复强调
 * `(approval.status, lifecycle_state)` 与 `(lifecycle_state, approval.status)`
 * 不可对调，具名传参让对调在编译期就不可表达。
 */
export interface PresentationStateInput {
  lifecycle_state: LifecycleState;
  approval_status: ApprovalStatus;
  runtime?: PresentationRuntimeContext | undefined;
}

export type PresentationProjectionErrorCode =
  "ILLEGAL_STATE_PAIR" | "UNDEFINED_PROJECTION";

export class PresentationStateProjectionError extends Error {
  readonly code: PresentationProjectionErrorCode;

  constructor(code: PresentationProjectionErrorCode, message: string) {
    super(message);
    this.name = "PresentationStateProjectionError";
    this.code = code;
  }
}

/** 展示态矩阵的机器可读登记（供 CI 不变式与测试逐行比对） */
export interface PresentationStateRow {
  readonly presentation_state: PresentationState;
  readonly lifecycle_state: LifecycleState;
  readonly approval_status: readonly ApprovalStatus[];
  /** 规范表格中的附加运行时判据，仅用于文档追溯 */
  readonly runtime_criteria: string;
}

export const PRESENTATION_STATE_MATRIX: readonly PresentationStateRow[] = [
  {
    presentation_state: "EXPLORING",
    lifecycle_state: "DRAFT",
    approval_status: ["DRAFT"],
    runtime_criteria: "demo_service.status !== RUNNING",
  },
  {
    presentation_state: "DEMO_PREVIEW",
    lifecycle_state: "DRAFT",
    approval_status: ["DRAFT"],
    runtime_criteria: "demo_service.status === RUNNING",
  },
  {
    presentation_state: "GRAPH_MAPPING",
    lifecycle_state: "PREPARING",
    approval_status: ["APPROVED"],
    runtime_criteria: "合同级确认开工交接瞬态（非 project_mapping）",
  },
  {
    presentation_state: "PROJECT_MAPPING",
    lifecycle_state: "PREPARING",
    approval_status: ["APPROVED"],
    runtime_criteria: "规划密封后整理项目地图（project_mapping === true）",
  },
  {
    presentation_state: "NEEDS_APPROVAL",
    lifecycle_state: "PENDING_APPROVAL",
    approval_status: ["PENDING_REVIEW"],
    runtime_criteria: "命中高风险或保护清单",
  },
  {
    presentation_state: "EXECUTING",
    lifecycle_state: "EXECUTING",
    approval_status: ["APPROVED"],
    runtime_criteria: "stopping_requested === false",
  },
  {
    presentation_state: "STOPPING",
    lifecycle_state: "EXECUTING",
    approval_status: ["APPROVED"],
    runtime_criteria: "stopping_requested === true",
  },
  {
    presentation_state: "PAUSED",
    lifecycle_state: "PENDING_RESUME",
    approval_status: ["APPROVED"],
    runtime_criteria: "预算耗尽或重试达上限熔断",
  },
  {
    presentation_state: "VERIFYING",
    lifecycle_state: "VERIFYING",
    approval_status: ["APPROVED"],
    runtime_criteria: "未判定失败；或失败但重试预算已耗尽",
  },
  {
    presentation_state: "FAILED",
    lifecycle_state: "VERIFYING",
    approval_status: ["APPROVED"],
    runtime_criteria:
      "verification_passed === false && retry_count < max_retries",
  },
  {
    presentation_state: "REAL_PLAYTEST",
    lifecycle_state: "AUDITED",
    approval_status: ["APPROVED"],
    runtime_criteria: "real_preview.status === RUNNING 且无未决质疑",
  },
  {
    presentation_state: "DISPUTED_INSPECTING",
    lifecycle_state: "AUDITED",
    approval_status: ["APPROVED"],
    runtime_criteria: "dispute_session.status === OPEN",
  },
  {
    presentation_state: "READY_TO_MERGE",
    lifecycle_state: "AUDITED",
    approval_status: ["APPROVED"],
    runtime_criteria: "evidence.can_merge === true 且无冲突",
  },
  {
    presentation_state: "CONFLICT",
    lifecycle_state: "AUDITED",
    approval_status: ["APPROVED"],
    runtime_criteria: "合并前检测到目标分支推进",
  },
  {
    presentation_state: "MERGED",
    lifecycle_state: "MERGED",
    approval_status: ["APPROVED"],
    runtime_criteria: "代码已原子 Squash 合入主干",
  },
  {
    presentation_state: "ABORTED",
    lifecycle_state: "ABORTED",
    approval_status: ["REJECTED", "APPROVED"],
    runtime_criteria: "终止、熔断或手动放弃（保留历史审批事实）",
  },
] as const;

/**
 * `(AUDITED, APPROVED)` 的四分支优先级（§6.3.1 v1.6.1 澄清）。
 * 安全与用户诉求优先：目标分支漂移 > 未决质疑 > 真机试玩 > 待交付。
 */
export const AUDITED_BRANCH_PRIORITY = [
  "CONFLICT",
  "DISPUTED_INSPECTING",
  "REAL_PLAYTEST",
  "READY_TO_MERGE",
] as const;

function projectAuditedBranch(
  runtime: PresentationRuntimeContext,
): PresentationState {
  // 严格按 AUDITED_BRANCH_PRIORITY 顺序短路，禁止改成 if-else 重排或查表求和
  if (runtime.target_branch_ahead === true) return "CONFLICT";
  if (runtime.dispute_session?.status === "OPEN") return "DISPUTED_INSPECTING";
  if (runtime.real_preview?.status === "RUNNING") return "REAL_PLAYTEST";
  if (runtime.evidence?.can_merge === true) return "READY_TO_MERGE";

  // 规范未定义"已审计但证据不可合并、且无任何其它判据"的展示态。
  // 此处不猜：宁可让调用方显式处理，也不给用户一个会误导操作的状态。
  throw new PresentationStateProjectionError(
    "UNDEFINED_PROJECTION",
    "AUDITED + APPROVED 未命中四分支中的任何一支 " +
      "(需 target_branch_ahead / dispute_session.OPEN / " +
      "real_preview.RUNNING / evidence.can_merge 之一)；" +
      "规范 §6.3.1 未定义该组合的展示态",
  );
}

/**
 * 把合同二元组 + 运行时判据投影为唯一展示状态。
 *
 * 顺序（不可交换）：
 * 1. 先校验 `(lifecycle_state, approval_status)` 是否 §9.1.1 合法配对；
 * 2. `ABORTED` 最高优先级短路——无论历史审批是 `APPROVED` 还是 `REJECTED`，
 *    终止就是终止，不因"曾经批过"而显示成别的状态；
 * 3. 其余按 lifecycle 分派，`AUDITED` 走四分支短路。
 */
export function getPresentationState(
  input: PresentationStateInput,
): PresentationState {
  const { lifecycle_state, approval_status } = input;
  const runtime = input.runtime ?? {};

  const pair = validateStatePair({ lifecycle_state, approval_status });
  if (!pair.ok) {
    throw new PresentationStateProjectionError(
      "ILLEGAL_STATE_PAIR",
      pair.message,
    );
  }

  if (lifecycle_state === "ABORTED") return "ABORTED";

  switch (lifecycle_state) {
    case "DRAFT":
      return runtime.demo_service?.status === "RUNNING"
        ? "DEMO_PREVIEW"
        : "EXPLORING";

    case "PENDING_APPROVAL":
      return "NEEDS_APPROVAL";

    case "PREPARING":
      // supervisor §16.2：PROJECT_MAPPING（整理项目地图）与 GRAPH_MAPPING（交接中）互斥
      return runtime.project_mapping === true ? "PROJECT_MAPPING" : "GRAPH_MAPPING";

    case "EXECUTING":
      return runtime.stopping_requested === true ? "STOPPING" : "EXECUTING";

    case "PENDING_RESUME":
      return "PAUSED";

    case "VERIFYING": {
      const verification = runtime.verification;
      const failed = verification?.passed === false;
      const retryCount = verification?.retry_count;
      const maxRetries = verification?.max_retries;
      // 只有"确实失败"且"重试预算尚未耗尽"才叫 FAILED；
      // 预算耗尽后状态机应把合同转入 PENDING_RESUME（PAUSED），
      // 若仍停在 VERIFYING，展示层保守呈现"正在检查成果"。
      if (
        failed &&
        typeof retryCount === "number" &&
        typeof maxRetries === "number" &&
        retryCount < maxRetries
      ) {
        return "FAILED";
      }
      return "VERIFYING";
    }

    case "AUDITED":
      return projectAuditedBranch(runtime);

    case "MERGED":
      return "MERGED";

    default: {
      // 穷尽性保护：新增 lifecycle 时此处编译期报错
      const exhaustive: never = lifecycle_state;
      throw new PresentationStateProjectionError(
        "UNDEFINED_PROJECTION",
        `未覆盖的 lifecycle_state: ${String(exhaustive)}`,
      );
    }
  }
}

/**
 * 不抛异常的投影变体，供广播/持久化等不能因脏数据中断的链路使用。
 * 失败时返回稳定错误码，调用方可决定降级或告警。
 */
export function tryGetPresentationState(
  input: PresentationStateInput,
):
  | { ok: true; presentation_state: PresentationState }
  | { ok: false; code: PresentationProjectionErrorCode; message: string } {
  try {
    return { ok: true, presentation_state: getPresentationState(input) };
  } catch (err) {
    if (err instanceof PresentationStateProjectionError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}
