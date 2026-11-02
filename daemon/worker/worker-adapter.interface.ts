import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { SandboxWitness } from "./sandbox/container-host";

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
 * - `SANDBOX_ENFORCED`：容器隔离受控模式（TASK-W.5c-i 新增档位）。隔离由**运行时
 *   围栏**保证，而非能力声明：派工门禁 `requireControlledDispatch()` 按容器宿主
 *   可用性判定（W.5c-ii），执行面必须经 `runInSandbox()` 进入容器（W.5c-iii），
 *   证据面如实记 `SANDBOX_ENFORCED`。能力声明按**围栏档**校验（见
 *   `validateSandboxFenceTier()`，W.5c-iii ruling A）。
 * - `UNCONTROLLED_EXTERNAL`：用户自管的外部编辑器/助手，**不得**作为执行证据。
 */
export type AdapterControlMode =
  "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL";

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
  /**
   * 沙箱执行见证（TASK-W.5c-iii）。**仅当**本次执行确实经 `runInSandbox()` 进入
   * 容器时出现——适配器不得自行伪造，见 `sandbox/container-host.ts::sandboxWitness()`。
   * `GATEWAY_ENFORCED` 适配器恒不携带该字段。
   */
  sandbox?: SandboxWitness | undefined;
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
 * 围栏档校验（TASK-W.5c-iii · ruling A）。
 *
 * 只校验两条可核查事实：`known_limitations` 非空、平台矩阵非空。**不**要求
 * `GATEWAY_ONLY` / `WHITELIST_ONLY` / `tool_interception_supported === true`——
 * 容器档位的隔离由运行时围栏负责，声明只负责「如实」。
 *
 * 与严格档对齐的两条拒绝码不变：`KNOWN_LIMITATIONS_UNDECLARED` /
 * `PLATFORM_MATRIX_EMPTY`（不新增拒绝码，旧读者不受影响）。
 */
export function validateSandboxFenceTier(
  declaration: AdapterCapabilityDeclaration,
): AdapterCapabilityValidation {
  if (
    !Array.isArray(declaration.known_limitations) ||
    declaration.known_limitations.length === 0
  ) {
    return {
      ok: false,
      code: "KNOWN_LIMITATIONS_UNDECLARED",
      reason:
        "known_limitations must declare at least one limitation (G-10); a SANDBOX_ENFORCED adapter must state its container boundary truthfully",
    };
  }
  if (
    !Array.isArray(declaration.platform_support) ||
    declaration.platform_support.length === 0
  ) {
    return {
      ok: false,
      code: "PLATFORM_MATRIX_EMPTY",
      reason:
        "platform_support must declare at least one platform; an unverified platform matrix cannot back a SANDBOX_ENFORCED registration",
    };
  }
  return { ok: true };
}

/**
 * 记实不记名：证据面记录的控制模式 = 「声明档」经「执行面实况」校正后的结果。
 *
 * TASK-W.5c-iii 的闭环点。此前证据直接记 `contract.worker_spec.control_mode`（声明档），
 * 于是「标了 `SANDBOX_ENFORCED`」本身就能充当受控证据——把隔离写在了纸上。
 * 沙箱档必须有**执行面信号**：本次派工是否真的经 `runInSandbox()` 进入容器，由
 * `SandboxWitness` 作证（见 `sandbox/container-host.ts::sandboxWitness()`）。
 *
 * 规则（P-121 登记的「记实不记名」裁决在此强制执行）：
 * - 声明档不是 `SANDBOX_ENFORCED` → 原样返回（`GATEWAY_ENFORCED` 语义不变）；
 * - 声明档是 `SANDBOX_ENFORCED` 且有见证 → `SANDBOX_ENFORCED`（如实记档）；
 * - 声明档是 `SANDBOX_ENFORCED` 但**无见证** → `UNCONTROLLED_EXTERNAL`
 *   （没入过箱就没有受控证据，宁可降级也不冒认）。
 */
export function resolveEvidenceControlMode(
  declaredControlMode: AdapterControlMode,
  sandboxWitness: SandboxWitness | undefined,
): AdapterControlMode {
  if (declaredControlMode !== "SANDBOX_ENFORCED") return declaredControlMode;
  return sandboxWitness === undefined
    ? "UNCONTROLLED_EXTERNAL"
    : "SANDBOX_ENFORCED";
}

/**
 * 能力声明校验（按档位分三套口径）。
 *
 * **严格档** `GATEWAY_ENFORCED`：文件/命令/工具拦截全部必经 Gateway，故声明不得
 * 宽松。拒绝条件（任一命中即拒绝）：
 * 1. `known_limitations` 未声明或为空——不允许「宣称零限制」的黑盒适配器；
 * 2. `filesystem_permissions !== "GATEWAY_ONLY"`——直连文件系统不可受控；
 * 3. `command_permissions !== "WHITELIST_ONLY"`——无限制 Shell 不可受控；
 * 4. `tool_interception_supported !== true`——无法拦截工具调用即无法审计；
 * 5. 平台矩阵为空——无法证明支持边界。
 *
 * **围栏档** `SANDBOX_ENFORCED`（TASK-W.5c-iii · ruling A）：容器内本来就是「直连
 * 文件系统 + 无限制 Shell + 工具调用不经 Gateway」，把这些如实写进声明是**正确
 * 的事实**，不是风险敞口——真正的隔离来自运行时：宿主可用性门禁
 * （`E_ADAPTER_SANDBOX_LOCKED`）、唯一挂载点＝任务 Worktree 的围栏
 * （`assertMountAllowed` / `validateSandboxInput`）、以及「派工即入沙箱」断言。
 * 因此只校验两条**可核查的事实边界**：`known_limitations` 非空、平台矩阵非空。
 * 若仍套严格档，容器档位将只能靠「声明造假」才注册得进去，反而把诚实适配器
 * 挤出受控面——这正是 ruling A 要修的反向激励。
 *
 * **标识档** `UNCONTROLLED_EXTERNAL`：只做 id / 版本校验。它本就不进入受控执行面，
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
  if (controlMode === "SANDBOX_ENFORCED")
    return validateSandboxFenceTier(declaration);

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
