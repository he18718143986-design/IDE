import { AiWorker } from "./ai-worker";
import { AdapterRegistry } from "./adapter-registry";
import {
  MANAGED_AI_CAPABILITY,
  type AdapterCapabilityDeclaration,
  type CodingWorkerAdapter,
} from "./worker-adapter.interface";
import type { WorkerDispatchFactory } from "./worker-dispatch";

/**
 * TASK-W.6：Daemon 默认适配器注册表。
 *
 * 本模块是**唯一**把具体 `AiWorker` 与 Registry 绑定的地方；编排器只依赖
 * `AdapterRegistry` 抽象与 `worker-dispatch` 契约，不 import 具体适配器类（OCP）。
 *
 * 幂等性：每次调用返回**新的** Registry 实例（每个 Daemon / 编排器一份），
 * 不做全局单例，避免测试间串味。
 *
 * 注册口径（红线：`UNCONTROLLED_EXTERNAL` 不得当受控证据）：
 * - 内置 Managed AI（`AiWorker` 封装）以 `GATEWAY_ENFORCED` 注册并挂派工工厂，可派工；
 * - Claude Code worker（W.8 外部 CLI，经受管 MCP 端点接入）只以
 *   `UNCONTROLLED_EXTERNAL` 登记在案、不挂派工工厂——它不由本进程的
 *   ScopedWorktreeGateway 约束写范围，任何指向它的派工都会被门禁显式拒绝。
 */

/** 合同默认 worker_spec.adapter_id（见 contract.schema DEFAULT_WORKER_SPEC） */
export const BUILTIN_AI_SDK_ADAPTER_ID = "stagent.builtin.ai-sdk" as const;
/** 内置能力声明里的 id（见 MANAGED_AI_CAPABILITY） */
export const MANAGED_AI_ADAPTER_ID = MANAGED_AI_CAPABILITY.adapter_id;
/** TASK-W.8：Claude Code worker（role:"worker"）在注册表中的登记 id */
export const CLAUDE_CODE_WORKER_ADAPTER_ID =
  "stagent.claude-code.worker.v0" as const;

/**
 * 内置 Managed AI 派工工厂：完整复用 `AiWorker` 的 Gateway 写入 / 越界拦截 /
 * 预算熔断 / 证据语义。构造参数与改造前 orchestrator 的 `new AiWorker({...})`
 * 逐项对齐，保证现有派工行为不变。
 */
export const managedAiDispatchFactory: WorkerDispatchFactory = (context) =>
  new AiWorker({
    gateway: context.gateway,
    costMonitor: context.costMonitor,
    modelClient: context.modelClient,
    repoRoot: context.repoRoot,
    ...(context.designNote === undefined
      ? {}
      : { designNote: context.designNote }),
    ...(context.checksExtras === undefined
      ? {}
      : { checksExtras: context.checksExtras }),
  });

/** 能力载体：注册用，不直接执行（执行走 dispatchFactory 产出的受控执行器） */
function capabilityAdapter(
  declaration: AdapterCapabilityDeclaration,
): CodingWorkerAdapter {
  return {
    declaration,
    kind: "MANAGED_AI",
    // 注册用能力载体不可执行：误走 adapter.run 必须显式失败，
    // 而不是返回「成功但什么都没干」的假结果（W.8 同款隐患，见 W.6 审阅意见）
    run: async () => {
      throw new Error(
        "capability carrier is not executable; dispatch via registry dispatchFactory",
      );
    },
  };
}

/**
 * TASK-W.8 Claude Code worker 的**登记占位**（非执行载体）。
 *
 * 它是外部 CLI 进程：工具调用由 CLI 自身发起、经受管 MCP HTTP 端点通信，
 * 不由编排器的 ScopedWorktreeGateway 约束写范围，也无法由本进程逐次拦截审计。
 * 因此能力声明如实标注「外部直连 / 不可拦截」，且只登记为
 * `UNCONTROLLED_EXTERNAL`、不挂派工工厂——满足红线：
 * 外部助手产物不得作为受控执行 / 可合并证据。
 */
function claudeCodeWorkerRegistration(): CodingWorkerAdapter {
  return {
    declaration: {
      adapter_id: CLAUDE_CODE_WORKER_ADAPTER_ID,
      protocol_version: "1.0.0",
      model_metering_source: "PROVIDER",
      tool_interception_supported: false,
      filesystem_permissions: "DIRECT_UNCONTROLLED",
      command_permissions: "UNRESTRICTED_SHELL",
      cancellation_supported: true,
      session_recovery_supported: false,
      network_requirements: "EXPLICIT_ONLY",
      platform_support: [
        "darwin-arm64",
        "darwin-x64",
        "linux-x64",
        "win32-x64",
      ],
      known_limitations: [
        "外部 CLI 进程，文件与命令操作不受编排器 ScopedWorktreeGateway 写范围约束",
        "工具调用由 CLI 侧发起并经 MCP HTTP 端点通信，本进程无法逐次拦截审计",
        "因此只能登记为 UNCONTROLLED_EXTERNAL，产物不得作为受控执行或可合并证据",
      ],
    },
    kind: "CLI",
    // 注册用能力载体不可执行：误走 adapter.run 必须显式失败，
    // 而不是返回「成功但什么都没干」的假结果（W.8 同款隐患，见 W.6 审阅意见）
    run: async () => {
      throw new Error(
        "capability carrier is not executable; dispatch via registry dispatchFactory",
      );
    },
  };
}

/**
 * 构造默认注册表。
 *
 * 两个内置 id 指向同一工厂：
 * - `stagent.builtin.ai-sdk`：合同默认值，必须能解析，否则现有派工全崩；
 * - `stagent.managed-ai.v0`：MANAGED_AI_CAPABILITY 声明 id，保证能力声明口径可查。
 *
 * Claude Code worker 仅登记、不挂工厂，指向它的派工一律被门禁拒绝。
 */
export function createDefaultWorkerRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();

  const ids = [BUILTIN_AI_SDK_ADAPTER_ID, MANAGED_AI_ADAPTER_ID];
  const unique = [...new Set(ids)];
  for (const id of unique) {
    registry.register(
      capabilityAdapter({ ...MANAGED_AI_CAPABILITY, adapter_id: id }),
      "GATEWAY_ENFORCED",
    );
    registry.registerDispatchFactory(id, managedAiDispatchFactory);
  }

  // 登记 Claude Code worker，但明确标为非受控、不挂派工工厂（红线）
  registry.register(claudeCodeWorkerRegistration(), "UNCONTROLLED_EXTERNAL");

  return registry;
}
