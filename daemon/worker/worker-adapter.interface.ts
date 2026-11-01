import type { SoftwareContract } from "../../src/lib/contract.schema";

/**
 * Coding Worker 适配器能力契约（TASK-W.1 / 规范 A §2.7 / B G-10）。
 *
 * 规范要求每个 Adapter 必须显式声明 9 项能力（输入输出协议、计量来源、工具拦截、
 * 文件系统权限、命令权限、取消语义、会话恢复、网络需求、平台矩阵）以及
 * **第 9 项已知限制 `known_limitations`**。缺项、或声明「直连文件系统 /
 * 无限制 Shell」的适配器一律不得注册为 `GATEWAY_ENFORCED` 受控模式。
 *
 * 本文件只描述契约与校验，不持有任何执行能力，也不引入 I/O。
 */

/** 声明对象的能力维度数量（9 项；与 B TASK-W.1 G-10 对齐） */
export const ADAPTER_CAPABILITY_ITEM_COUNT = 9 as const;

export type AdapterMeteringSource = "PROVIDER" | "LOCAL_ESTIMATE";

export type AdapterFilesystemPermission =
  "GATEWAY_ONLY" | "DIRECT_UNCONTROLLED";

export type AdapterCommandPermission = "WHITELIST_ONLY" | "UNRESTRICTED_SHELL";

export type AdapterNetworkRequirement =
  "NONE" | "EXPLICIT_ONLY" | "DIRECT_INTERNET";

export type AdapterPlatform =
  "darwin-arm64" | "darwin-x64" | "linux-x64" | "win32-x64";

/** 适配器能力声明（B TASK-W.1 接口定义逐字段对齐） */
export interface AdapterCapabilityDeclaration {
  adapter_id: string;
  protocol_version: string;
  model_metering_source: AdapterMeteringSource;
  tool_interception_supported: boolean;
  filesystem_permissions: AdapterFilesystemPermission;
  command_permissions: AdapterCommandPermission;
  cancellation_supported: boolean;
  session_recovery_supported: boolean;
  network_requirements: AdapterNetworkRequirement;
  platform_support: AdapterPlatform[];
  /** 第 9 项：已知限制（必填，G-10） */
  known_limitations: string[];
}

/** 适配器类型：内置托管模型 / 外部 CLI */
export type WorkerAdapterKind = "MANAGED_AI" | "CLI";

/**
 * 注册模式：
 * - `GATEWAY_ENFORCED`：受控模式，全部文件/命令操作经受管 Gateway；
 * - `SANDBOX_ENFORCED`：容器隔离受控模式（TASK-W.5c-i 新增档位）。能力声明按
 *   受控严格模式校验（与 `GATEWAY_ENFORCED` 同），**登记面接受注册**；但容器
 *   运行时 `container-host` 尚未落地（TASK-W.5c-ii），**窗口期内不得派工**——
 *   派工门禁 `requireControlledDispatch()` 对其显式拒绝，避免「标了沙箱档却没有
 *   沙箱」的假受控状态。解锁条件：`W.5c-ii` `container-host` 落地。
 * - `UNCONTROLLED_EXTERNAL`：用户自管的外部编辑器/助手，**不得**作为执行证据。
 */
export type AdapterControlMode =
  | "GATEWAY_ENFORCED"
  | "SANDBOX_ENFORCED"
  | "UNCONTROLLED_EXTERNAL";

export type AdapterRejectionCode =
  | "ADAPTER_ID_INVALID"
  | "PROTOCOL_VERSION_INVALID"
  | "KNOWN_LIMITATIONS_UNDECLARED"
  | "FILESYSTEM_DIRECT_UNCONTROLLED"
  | "COMMAND_UNRESTRICTED_SHELL"
  | "TOOL_INTERCEPTION_UNSUPPORTED"
  | "PLATFORM_MATRIX_EMPTY";

export type AdapterCapabilityValidation =
  { ok: true } | { ok: false; code: AdapterRejectionCode; reason: string };

/**
 * 适配器执行输入：只含「合同 + 已装配的指令」，不含任何执行句柄。
 * `system_prompt` 由 `session-task-injector` 依据合同逐字段装配。
 */
export interface AdapterTaskInput {
  contract: SoftwareContract;
  contract_revision: number;
  worktree_root: string;
  system_prompt: string;
  exposed_tools: string[];
}

/** 适配器执行产物（结构上与 `WorkerGenerationResult` 兼容） */
export interface AdapterRunOutcome {
  changes: Array<{ path: string; content: string }>;
  log: string[];
  usage: { inputTokens: number; outputTokens: number };
}

/** 统一适配器接口：Managed AI 与 CLI 均实现该契约 */
export interface CodingWorkerAdapter {
  readonly declaration: AdapterCapabilityDeclaration;
  readonly kind: WorkerAdapterKind;
  run(
    input: AdapterTaskInput,
    signal?: AbortSignal,
  ): Promise<AdapterRunOutcome>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 能力声明校验（受控模式为严格模式）。
 *
 * 严格模式适用于 `GATEWAY_ENFORCED` 与 `SANDBOX_ENFORCED`（TASK-W.5c-i）：后者是
 * **更严**的容器隔离档位，能力声明不得比 `GATEWAY_ENFORCED` 宽松，故同走严格校验。
 *
 * 严格模式的拒绝条件（任一命中即拒绝）：
 * 1. `known_limitations` 未声明或为空——不允许「宣称零限制」的黑盒适配器；
 * 2. `filesystem_permissions !== "GATEWAY_ONLY"`——直连文件系统不可受控；
 * 3. `command_permissions !== "WHITELIST_ONLY"`——无限制 Shell 不可受控；
 * 4. `tool_interception_supported !== true`——无法拦截工具调用即无法审计；
 * 5. 平台矩阵为空——无法证明支持边界。
 *
 * `UNCONTROLLED_EXTERNAL` 只做标识校验：它本就不进入受控执行面，
 * 允许用户以非受控方式接入，但不得作为合并证据。
 */
export function validateAdapterCapability(
  declaration: AdapterCapabilityDeclaration,
  controlMode: AdapterControlMode = "GATEWAY_ENFORCED",
): AdapterCapabilityValidation {
  if (!isNonEmptyString(declaration.adapter_id)) {
    return {
      ok: false,
      code: "ADAPTER_ID_INVALID",
      reason: "adapter_id must be a non-empty string",
    };
  }
  if (!isNonEmptyString(declaration.protocol_version)) {
    return {
      ok: false,
      code: "PROTOCOL_VERSION_INVALID",
      reason: "protocol_version must be a non-empty string",
    };
  }
  if (controlMode === "UNCONTROLLED_EXTERNAL") return { ok: true };

  if (
    !Array.isArray(declaration.known_limitations) ||
    declaration.known_limitations.length === 0
  ) {
    return {
      ok: false,
      code: "KNOWN_LIMITATIONS_UNDECLARED",
      reason:
        "known_limitations must declare at least one limitation (G-10); a black-box adapter cannot be GATEWAY_ENFORCED",
    };
  }
  if (declaration.filesystem_permissions !== "GATEWAY_ONLY") {
    return {
      ok: false,
      code: "FILESYSTEM_DIRECT_UNCONTROLLED",
      reason:
        "filesystem_permissions must be GATEWAY_ONLY for controlled execution",
    };
  }
  if (declaration.command_permissions !== "WHITELIST_ONLY") {
    return {
      ok: false,
      code: "COMMAND_UNRESTRICTED_SHELL",
      reason:
        "command_permissions must be WHITELIST_ONLY for controlled execution",
    };
  }
  if (declaration.tool_interception_supported !== true) {
    return {
      ok: false,
      code: "TOOL_INTERCEPTION_UNSUPPORTED",
      reason:
        "tool_interception_supported must be true; unverifiable tool calls cannot be audited",
    };
  }
  if (
    !Array.isArray(declaration.platform_support) ||
    declaration.platform_support.length === 0
  ) {
    return {
      ok: false,
      code: "PLATFORM_MATRIX_EMPTY",
      reason: "platform_support must declare at least one platform",
    };
  }
  return { ok: true };
}

/**
 * 内置 Managed AI Worker（Daemon 侧 OpenAI 兼容客户端）的能力声明。
 *
 * `known_limitations` 是**事实陈述**，不是免责模板：每一条都对应实现里的
 * 真实边界（整文件覆盖、无原生 Shell、上下文有界、依赖/网络未授权即不可用）。
 */
export const MANAGED_AI_CAPABILITY: AdapterCapabilityDeclaration = {
  adapter_id: "stagent.managed-ai.v0",
  protocol_version: "1.0.0",
  model_metering_source: "PROVIDER",
  tool_interception_supported: true,
  filesystem_permissions: "GATEWAY_ONLY",
  command_permissions: "WHITELIST_ONLY",
  cancellation_supported: true,
  session_recovery_supported: false,
  network_requirements: "EXPLICIT_ONLY",
  platform_support: ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"],
  known_limitations: [
    "模型以整文件内容覆盖写入，不保证最小 diff；未改动的文件不会被重写",
    "仅能调用 stagent_* 受管工具，无原生 Shell 与直接文件系统访问能力",
    "上下文仅包含 writable_paths 内已存在文件（上限 20 个文件 / 100,000 字符）",
    "依赖安装与网络访问默认不可用，需合同显式授权后方可执行",
    "会话级恢复未实现：中断后需由编排器以新会话重跑，不复用模型侧会话状态",
  ],
};
