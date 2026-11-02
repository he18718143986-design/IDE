import { AiWorker } from "./ai-worker";
import { AdapterRegistry } from "./adapter-registry";
import {
  MANAGED_AI_CAPABILITY,
  type AdapterCapabilityDeclaration,
  type AdapterControlMode,
  type CodingWorkerAdapter,
} from "./worker-adapter.interface";
import {
  E_ADAPTER_SANDBOX_LOCKED,
  WorkerDispatchError,
  type WorkerDispatchFactory,
} from "./worker-dispatch";
import {
  OPENHANDS_ADAPTER_ID,
  OPENHANDS_CAPABILITY,
  OPENHANDS_VERIFIED_ON,
  OpenHandsSandboxAdapter,
} from "./cli-host/openhands-adapter";
import { buildWorkerTaskInstruction } from "./session-task-injector";

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
 *   ScopedWorktreeGateway 约束写范围，任何指向它的派工都会被门禁显式拒绝；
 * - OpenHands 容器 worker（W.5c-iii）以 `SANDBOX_ENFORCED` 注册并挂派工工厂，
 *   执行必经 `runInSandbox()` 进入容器（无本地降级）；未实测则降为
 *   `UNCONTROLLED_EXTERNAL` 且不挂工厂。
 */

/** 合同默认 worker_spec.adapter_id（见 contract.schema DEFAULT_WORKER_SPEC） */
export const BUILTIN_AI_SDK_ADAPTER_ID = "stagent.builtin.ai-sdk" as const;
/** 内置能力声明里的 id（见 MANAGED_AI_CAPABILITY） */
export const MANAGED_AI_ADAPTER_ID = MANAGED_AI_CAPABILITY.adapter_id;
/** TASK-W.8：Claude Code worker（role:"worker"）在注册表中的登记 id */
export const CLAUDE_CODE_WORKER_ADAPTER_ID =
  "stagent.claude-code.worker.v0" as const;
/** TASK-W.5c-iii：OpenHands 容器 Worker 的登记 id（与能力声明同源） */
export const OPENHANDS_WORKER_ADAPTER_ID = OPENHANDS_ADAPTER_ID;

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
 * TASK-W.5c-iii：OpenHands 容器 Worker 的**登记载体**（非执行载体）。
 *
 * 能力声明按事实写：容器内直连文件系统、无限制 Shell、工具调用不经 Gateway，
 * 因此**不可能**登记为 `GATEWAY_ENFORCED`；它登记为 `SANDBOX_ENFORCED`，
 * 隔离由运行时围栏（宿主可用性门禁 + `runInSandbox` 唯一挂载点）保证。
 */
function openhandsRegistration(): CodingWorkerAdapter {
  return {
    declaration: OPENHANDS_CAPABILITY,
    kind: "CLI",
    run: async () => {
      throw new Error(
        "capability carrier is not executable; dispatch via registry dispatchFactory",
      );
    },
  };
}

/**
 * 登记档位判定（TASK-W.5c-iii · 卡正文范围第 4 条）：
 * **实测记录存在 → `SANDBOX_ENFORCED`；缺实测记录 → `UNCONTROLLED_EXTERNAL`**。
 * 未实测即标受控是本卡 FAIL 红线，故把判定做成显式函数而不是硬编码。
 *
 * 刻意**不用默认参数**：`undefined` 必须能显式表达「没有实测记录」——
 * 若写成默认值，传 `undefined` 会被悄悄替换成实测常量，降级判定就失效了。
 */
export function openhandsControlMode(
  verifiedOn: { cli_version: string; verified_at: string } | undefined,
): AdapterControlMode {
  return verifiedOn === undefined
    ? "UNCONTROLLED_EXTERNAL"
    : "SANDBOX_ENFORCED";
}

/**
 * TASK-W.5c-iii：OpenHands 沙箱派工工厂——`SANDBOX_ENFORCED` 的**唯一**执行路径。
 *
 * 「派工即入沙箱」在此结构化落实：
 * 1. 缺 `context.containerHost` → 直接 `E_ADAPTER_SANDBOX_LOCKED`（即便门禁被绕过
 *    也跑不起来；**没有任何本地分支**）；
 * 2. 执行只经 `OpenHandsSandboxAdapter.run()` → `runInSandbox()`；
 * 3. 返回值携带 `sandbox` 见证；缺失即视为未入沙箱，不得记为受控证据。
 */
export const openhandsSandboxDispatchFactory: WorkerDispatchFactory = (
  context,
) => ({
  run: async (signal) => {
    const host = context.containerHost;
    if (host === undefined) {
      throw new WorkerDispatchError(
        E_ADAPTER_SANDBOX_LOCKED,
        OPENHANDS_WORKER_ADAPTER_ID,
        "沙箱派工工厂未拿到 ContainerHostPort；拒绝执行（不降级为本地执行）",
      );
    }
    const adapter = new OpenHandsSandboxAdapter({
      host,
      verifiedOn: OPENHANDS_VERIFIED_ON,
      apiKey: () => process.env["LLM_API_KEY"],
    });
    const instruction = buildWorkerTaskInstruction({
      contract: context.contract,
      worktreeRoot: context.worktreeRoot,
      declaration: adapter.declaration,
      ...(context.designNote === undefined
        ? {}
        : { designNote: context.designNote }),
      ...(context.checksExtras === undefined
        ? {}
        : { checksExtras: context.checksExtras }),
    });
    const outcome = await adapter.run(
      {
        contract: context.contract,
        contract_revision: context.contract.contract_revision,
        worktree_root: context.worktreeRoot,
        system_prompt: [
          instruction.system_prompt,
          "",
          "【容器内路径映射】",
          `宿主 Worktree \`${context.worktreeRoot}\` 在容器内挂载为 \`/work\`（唯一挂载点）。`,
          "容器内一切路径以 `/work` 为根；宿主其他路径对你不可见，越界即失败。",
        ].join("\n"),
        exposed_tools: [...instruction.exposed_tools],
      },
      signal,
    );

    const witness = outcome.sandbox;
    return {
      // 容器内进程直接写入挂载的 Worktree；此处据真实终止态判定，不猜
      applied: witness?.via === "exit" && witness.exit_code === 0,
      changes: outcome.changes,
      log: outcome.log,
      usage: outcome.usage,
      blockers: [],
      ...(witness === undefined ? {} : { sandbox: witness }),
    };
  },
});

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

  // TASK-W.5c-iii：登记 OpenHands 容器 Worker。档位按「是否已有实测记录」判定：
  // 有实测 → SANDBOX_ENFORCED 并挂沙箱派工工厂（执行必经 runInSandbox）；
  // 无实测 → UNCONTROLLED_EXTERNAL 且不挂工厂（指向它的派工一律被门禁拒绝）。
  const openhandsMode = openhandsControlMode(OPENHANDS_VERIFIED_ON);
  registry.register(openhandsRegistration(), openhandsMode);
  if (openhandsMode === "SANDBOX_ENFORCED") {
    registry.registerDispatchFactory(
      OPENHANDS_WORKER_ADAPTER_ID,
      openhandsSandboxDispatchFactory,
    );
  }

  return registry;
}
