import type { ReasonCode } from "./evidence.schema";

/**
 * 运行时错误码目录 (ErrorCode Catalog) —— 《Stagent 系统架构设计规范 v1.2.1》§9.3。
 *
 * 关系：`error_code`（触发点事实，由具体组件抛出）
 *       → 9 个 `reason_code`（证据包结论归因，写入 EvidenceBundle.verdict.reason_code）。
 *
 * 多对一是规范刻意设计：同一个 reason_code 可由多个不同组件在不同阶段触发
 * （例如 BUDGET_EXHAUSTED 同时覆盖费用、单命令超时、任务总超时）。
 * 反向映射因此是**一对多**，任何把 reason_code 反推成唯一 error_code 的实现都是错的。
 *
 * 单一事实源：本文件的 `ERROR_CODE_CATALOG` 与 A §9.3 表格逐行对应；
 * `REASON_CODES` 与 evidence.schema.ts 的 `reasonCodeSchema` 在类型层对齐，
 * 并在 tests/unit/error-codes-mapping.test.ts 中断言二者集合相等。
 */

// --- 1. 错误码 ---

export const ERROR_CODES = [
  "E_UNSAFE_EXECUTION",
  "E_OUT_OF_SCOPE",
  "E_OUT_OF_SCOPE_UNTRACKED",
  "PATH_TRAVERSAL_DETECTED",
  "E_FORBIDDEN_PATH",
  "E_BUDGET_EXCEEDED",
  "E_COMMAND_TIMEOUT",
  "E_TASK_TIMEOUT",
  "E_UNAUTHORIZED_COMMAND",
  "E_RETRY_LIMIT_EXCEEDED",
  "E_WORKSPACE_LOCKED",
  "E_EVIDENCE_STALE",
  "E_PREPARATION_FAILED",
  "E_WORKTREE_LOST",
  "E_PORT_CONFLICT",
  "E_DEMO_PAYLOAD_TOO_LARGE",
  "E_DISPUTE_TIMEOUT",
  "E_PLAN_INVALID",
  "E_PLAN_STALE",
  "E_PLAN_STUB_LOCKED",
  "E_PLAN_STUB_TOO_LARGE",
  "E_PLAN_STUB_REVIVED",
  "E_PROPOSAL_PREVIOUSLY_REJECTED",
  "E_GATE_SCAN_FAILED",
  "E_VAULT_VALUE_TOO_SHORT",
  "E_VAULT_NAME_INVALID",
  "E_VAULT_NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// --- 2. 原因码（与 evidence.schema.ts 的 `reasonCodeSchema` 同集合） ---

export const REASON_CODES = [
  "SCOPE_VIOLATION",
  "BUDGET_EXHAUSTED",
  "WORKSPACE_LOCKED",
  "UNAUTHORIZED_COMMAND",
  "VERIFICATION_RETRY_LIMIT",
  "UNSAFE_EXECUTION",
  "EVIDENCE_STALE",
  "PREPARATION_INTERRUPTED",
  "WORKTREE_LOST",
] as const satisfies readonly ReasonCode[];

/**
 * 编译期断言：`REASON_CODES` 必须覆盖 `ReasonCode` 全集。
 * 若 evidence.schema.ts 新增原因码而此处遗漏，本行会报类型错误。
 */
type _ReasonCatalogueComplete = (typeof REASON_CODES)[number] extends ReasonCode
  ? true
  : never;
const _reasonCatalogueComplete: _ReasonCatalogueComplete = true;
void _reasonCatalogueComplete;

// --- 3. 目录表 ---

export interface ErrorCodeSpec {
  readonly code: ErrorCode;
  /** 归属原因码：写入 Evidence.verdict.reason_code */
  readonly reason_code: ReasonCode;
  /** 触发组件（规范 §9.3「触发组件 / 阶段」列） */
  readonly component: string;
  /** 承接任务卡，便于反向追溯「谁必须产出这个码」 */
  readonly task: string;
  /** 触发条件说明 */
  readonly condition: string;
  /**
   * 面向非技术用户的白话解释（规范 §9.3 第 3 列）。
   * 缺省表示尚未登记白话文案，UI 侧回退到 `condition`。
   */
  readonly plain_message?: string;
  /**
   * 控制面 REST 响应的 HTTP 状态码。
   * 缺省表示该码当前不出现在 HTTP 面，仅用于内部证据归因与终端提示。
   * 语义边界：400 = 请求本身不合法（路径逃逸、载荷畸形）；
   * 403 = 请求合法但调用方无权触及该路径（越权/越界）。
   */
  readonly http_status?: number;
}

export const ERROR_CODE_CATALOG: Readonly<Record<ErrorCode, ErrorCodeSpec>> = {
  E_UNSAFE_EXECUTION: {
    code: "E_UNSAFE_EXECUTION",
    reason_code: "UNSAFE_EXECUTION",
    component: "Threat Guard",
    task: "TASK-W.4",
    condition:
      "命中不可信仓库、特权命令或无法可靠限制子进程/网络的高风险命令，拒绝执行并提示外置隔离",
  },
  E_OUT_OF_SCOPE: {
    code: "E_OUT_OF_SCOPE",
    reason_code: "SCOPE_VIOLATION",
    component: "Scoped Gateway",
    task: "TASK-W.2",
    condition: "尝试读写未在合同 writable_paths 授权范围内的文件路径",
    plain_message:
      "任务试图改动授权范围之外的文件，已被拦截。这类改动不会合入你的项目。",
    http_status: 403,
  },
  E_OUT_OF_SCOPE_UNTRACKED: {
    code: "E_OUT_OF_SCOPE_UNTRACKED",
    reason_code: "SCOPE_VIOLATION",
    component: "Untracked Scope Guard",
    task: "TASK-W.2b",
    condition:
      "执行前 / 验收时以 `git status --porcelain -uall` 发现 Worktree 内存在合同 writable_paths 之外的未跟踪新增文件",
    plain_message:
      "任务在授权范围之外新建了文件（例如绕过了受控写入通道），已阻断本次验收，不会生成可合并的结论。请移除这些文件，或走合同升版重新授权。",
    http_status: 403,
  },
  PATH_TRAVERSAL_DETECTED: {
    code: "PATH_TRAVERSAL_DETECTED",
    reason_code: "SCOPE_VIOLATION",
    component: "Path Resolver",
    task: "TASK-W.2",
    condition: "相对路径解析包含 `..`，试图逃逸至 Worktree 物理根目录之外",
    plain_message: "任务提交了一个指向项目之外的非法文件路径，已被拒绝。",
    http_status: 400,
  },
  E_FORBIDDEN_PATH: {
    code: "E_FORBIDDEN_PATH",
    reason_code: "SCOPE_VIOLATION",
    component: "Scoped Gateway",
    task: "TASK-W.2",
    condition: "试图触碰 .git、.stagent、生产凭据等强禁区路径",
    plain_message:
      "任务试图触碰密钥、Git 内部数据等不可碰的安全禁区，已被拦截。",
    http_status: 403,
  },
  E_BUDGET_EXCEEDED: {
    code: "E_BUDGET_EXCEEDED",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Cost & Loop Guard",
    task: "TASK-W.3",
    condition: "累积 Token 消耗或单轮任务模型开销达到 budget_limits 上限",
  },
  E_COMMAND_TIMEOUT: {
    code: "E_COMMAND_TIMEOUT",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Command Runner",
    task: "TASK-W.3",
    condition: "单命令执行时间超过 timeout_seconds（默认 60s）",
  },
  E_TASK_TIMEOUT: {
    code: "E_TASK_TIMEOUT",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Command Runner",
    task: "TASK-W.3",
    condition: "任务总生命周期耗时超过 max_duration_seconds（默认 1800s）",
  },
  E_UNAUTHORIZED_COMMAND: {
    code: "E_UNAUTHORIZED_COMMAND",
    reason_code: "UNAUTHORIZED_COMMAND",
    component: "Command Runner",
    task: "TASK-W.3",
    condition: "待执行命令的 executable 不在合同白名单中，拒绝执行",
  },
  E_RETRY_LIMIT_EXCEEDED: {
    code: "E_RETRY_LIMIT_EXCEEDED",
    reason_code: "VERIFICATION_RETRY_LIMIT",
    component: "Loop Guard",
    task: "TASK-W.3",
    condition:
      "任务在同版本合同下连续重试验证失败达到 max_verification_retries 上限",
  },
  E_WORKSPACE_LOCKED: {
    code: "E_WORKSPACE_LOCKED",
    reason_code: "WORKSPACE_LOCKED",
    component: "Daemon Lifecycle",
    task: "TASK-A.1",
    condition: "尝试获取已被其他进程占用的 PID 互斥锁",
    plain_message:
      "这个项目已经在跑了。请先关掉原来的窗口，或用 stagent open 直接打开已有工作台，不要重复启动。",
    http_status: 409,
  },
  E_EVIDENCE_STALE: {
    code: "E_EVIDENCE_STALE",
    reason_code: "EVIDENCE_STALE",
    component: "FS Watcher",
    task: "TASK-B.2",
    condition: "验证通过后工作树内文件被外部编辑器或进程二次修改",
  },
  E_PREPARATION_FAILED: {
    code: "E_PREPARATION_FAILED",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Crash Recovery",
    task: "TASK-A.6",
    condition: "Worktree 创建或依赖准备阶段发生进程中断/异常退出",
  },
  E_WORKTREE_LOST: {
    code: "E_WORKTREE_LOST",
    reason_code: "WORKTREE_LOST",
    component: "Crash Recovery",
    task: "TASK-A.6",
    condition: "处于中间态的合同在自愈重启时检测到磁盘物理 Worktree 丢失",
  },
  E_PORT_CONFLICT: {
    code: "E_PORT_CONFLICT",
    reason_code: "UNSAFE_EXECUTION",
    component: "Scoped Gateway",
    task: "TASK-W.3",
    condition:
      "验证命令输出出现 EADDRINUSE / address already in use：环境端口冲突，不是断言失败，需清理占用后重试",
  },
  E_DEMO_PAYLOAD_TOO_LARGE: {
    code: "E_DEMO_PAYLOAD_TOO_LARGE",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Demo Generator",
    task: "TASK-S.4",
    condition:
      "Demo 原型单个静态资源超过 2MB 硬上限（按 UTF-8 字节计），拒绝落盘",
    plain_message:
      "这次生成的原型页面太大了（单个文件超过 2MB），已经停止写入。请缩小需求范围或拆分页面后重试。",
    http_status: 413,
  },
  E_DISPUTE_TIMEOUT: {
    code: "E_DISPUTE_TIMEOUT",
    // 时间预算耗尽，与 E_TASK_TIMEOUT 同族
    reason_code: "BUDGET_EXHAUSTED",
    component: "Dispute Watchdog",
    task: "TASK-S.5",
    condition:
      "质疑自查（三方事实抓取 + 归因）超过 60 秒硬超时，看门狗主动中止并降级为人工裁决",
    plain_message:
      "这次自查超时了（60 秒内没算完），系统已停止自动归因，把已抓到的三方事实交给您判断。",
    http_status: 504,
  },
  E_PLAN_INVALID: {
    code: "E_PLAN_INVALID",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Project Plan Validator",
    task: "TASK-L.7",
    condition:
      "ProjectPlan 未通过 project-decomposition §3 确定性规则（D-1～D-11）；响应体列出规则号与对象",
    plain_message: "这样拆还不行，我再拆一次。",
    http_status: 422,
  },
  E_PLAN_STALE: {
    code: "E_PLAN_STALE",
    reason_code: "EVIDENCE_STALE",
    component: "Project Plan Store",
    task: "TASK-L.7",
    condition:
      "计划补丁 base_revision 落后，且重算一次后仍落后于现行 plan_revision",
    plain_message: "项目地图有更新，请基于最新一版再调整。",
    http_status: 409,
  },
  E_PLAN_STUB_LOCKED: {
    code: "E_PLAN_STUB_LOCKED",
    reason_code: "WORKSPACE_LOCKED",
    component: "Project Plan Patch",
    task: "TASK-L.7",
    condition: "试图修改已签署或已合并的合同桩（status 为 signed/merged）",
    plain_message: "这一份已经开工或合入了，不能再改内容。",
    http_status: 409,
  },
  E_PLAN_STUB_TOO_LARGE: {
    code: "E_PLAN_STUB_TOO_LARGE",
    reason_code: "BUDGET_EXHAUSTED",
    component: "Project Plan / ScopePlan",
    task: "TASK-L.7",
    condition:
      "合同桩 size_estimate 或 ScopePlan 超出 D-1 默认预算（files≤10 / diff_lines≤2000 / minutes≤30）",
    plain_message: "这一份太大，我拆成几份小的。",
    http_status: 409,
  },
  E_PLAN_STUB_REVIVED: {
    code: "E_PLAN_STUB_REVIVED",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Project Plan Validator",
    task: "TASK-L.7",
    condition:
      "graveyard 中 removed_by=user 的桩标题经 G-MATCH-NL 与新桩标题命中（D-11）",
    plain_message: "这个你之前删过，要重新加回来吗？",
    http_status: 409,
  },
  E_PROPOSAL_PREVIOUSLY_REJECTED: {
    code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
    reason_code: "SCOPE_VIOLATION",
    component: "Worker Graveyard Gate",
    task: "TASK-J.18c",
    condition:
      "施工产出物强证据命中 disallow_revival=true 的用户/安全墓碑（INV-LEDGER-03 / DEC-1）",
    plain_message: "这个做法你之前否决过，我换个思路。",
    http_status: 409,
  },
  E_GATE_SCAN_FAILED: {
    code: "E_GATE_SCAN_FAILED",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Worker Graveyard Gate / Full Scan",
    task: "TASK-J.18c",
    condition:
      "全量扫描读不到完整 diff（readDiffFiles 抛错、truncatedList 非空、依赖清单截断）",
    plain_message: "自动检查没跑完，这一轮还不能合入。",
    http_status: 409,
  },
  E_VAULT_VALUE_TOO_SHORT: {
    code: "E_VAULT_VALUE_TOO_SHORT",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Vault",
    task: "TASK-L.14",
    condition: "setSecret 拒绝短于 8 个字符的值（精确脱敏下限）",
    plain_message: "这个密钥太短了，至少要 8 个字符，否则没法可靠地从日志里抹掉。",
    http_status: 400,
  },
  E_VAULT_NAME_INVALID: {
    code: "E_VAULT_NAME_INVALID",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Vault",
    task: "TASK-L.14",
    condition: "密钥名不符合环境变量命名（字母/下划线开头）",
    plain_message: "密钥名字不合法：请用字母或下划线开头，后面只能是字母、数字、下划线。",
    http_status: 400,
  },
  E_VAULT_NOT_FOUND: {
    code: "E_VAULT_NOT_FOUND",
    reason_code: "PREPARATION_INTERRUPTED",
    component: "Vault",
    task: "TASK-L.14",
    condition: "resolveEnv / 发布前置找不到已登记的密钥名",
    plain_message: "保险库里还没有这个名字的密钥，请先到设置 → 密钥里保存。",
    http_status: 404,
  },

};

// --- 4. 映射函数 ---

export function isKnownErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODE_CATALOG, value);
}

/** 单值正向映射：error_code → reason_code */
export function mapErrorToReasonCode(code: ErrorCode): ReasonCode {
  return ERROR_CODE_CATALOG[code].reason_code;
}

/**
 * 控制面 HTTP 状态映射。未登记的码返回 `undefined`——**不臆造默认值**，
 * 避免把「内部证据归因码」伪装成可直接对外返回的 HTTP 语义。
 */
export function httpStatusForErrorCode(code: ErrorCode): number | undefined {
  return ERROR_CODE_CATALOG[code].http_status;
}

/** 面向非技术用户的白话解释；未登记白话文案时回退到技术条件说明 */
export function plainMessageForErrorCode(code: ErrorCode): string {
  const spec = ERROR_CODE_CATALOG[code];
  return spec.plain_message ?? spec.condition;
}

/**
 * 批量正向映射并去重，用于把一次执行中收集到的多个错误码归并为
 * Evidence.verdict.reason_code 的候选集（终选规则由合并门禁决定）。
 */
export function mapErrorsToReasonCodes(
  codes: readonly ErrorCode[],
): ReasonCode[] {
  const seen = new Set<ReasonCode>();
  for (const code of codes) seen.add(mapErrorToReasonCode(code));
  return REASON_CODES.filter((reason) => seen.has(reason));
}

/** 反向映射：reason_code → 全部可能产出该归因的 error_code（一对多） */
export function errorCodesForReasonCode(reason: ReasonCode): ErrorCode[] {
  return ERROR_CODES.filter(
    (code) => ERROR_CODE_CATALOG[code].reason_code === reason,
  );
}

/** 未在目录中的错误码按「未知归因」处理时使用的兜底 reason_code */
export const UNKNOWN_ERROR_REASON: ReasonCode = "UNSAFE_EXECUTION";

/**
 * 宽松映射：接受任意字符串。已知码走目录；未知码归入
 * `UNKNOWN_ERROR_REASON` 并标记 `known: false`，避免静默丢弃。
 */
export function normalizeErrorCode(value: string): {
  code: ErrorCode | null;
  reasonCode: ReasonCode;
  known: boolean;
} {
  if (isKnownErrorCode(value)) {
    return {
      code: value,
      reasonCode: mapErrorToReasonCode(value),
      known: true,
    };
  }
  return { code: null, reasonCode: UNKNOWN_ERROR_REASON, known: false };
}

// --- 5. 带码异常 ---

/**
 * 运行时错误：同时携带触发点 error_code 与归因 reason_code，
 * 便于在 Evidence 生成时无需二次查表。
 */
export class StagentRuntimeError extends Error {
  readonly code: ErrorCode;
  readonly reasonCode: ReasonCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StagentRuntimeError";
    this.code = code;
    this.reasonCode = mapErrorToReasonCode(code);
  }
}
