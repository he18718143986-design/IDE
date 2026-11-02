import type { NetworkPolicy } from "../../../src/lib/contract.schema";
import {
  runInSandbox,
  sandboxWitness,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
} from "../sandbox/container-host";
import type {
  AdapterCapabilityDeclaration,
  AdapterRunOutcome,
  AdapterTaskInput,
  CodingWorkerAdapter,
} from "../worker-adapter.interface";

/**
 * TASK-W.5c-iii：OpenHands 容器 Worker 适配器。
 *
 * 定位：OpenHands headless CLI（`python -m openhands.core.main`）**只**在容器内运行。
 * 本适配器**没有任何本地执行路径**——`host` 是构造必填项，缺宿主直接失败，不做
 * 「本地照常跑」的降级（§4.2.3 P-17：普通本地子进程严禁自称沙箱）。
 *
 * 能力声明按**事实**写，不按愿望写：
 * - `filesystem_permissions: "DIRECT_UNCONTROLLED"` —— 容器内文件读写不经过
 *   `ScopedWorktreeGateway`；边界是**容器挂载**（只有任务 Worktree 挂进 `/work`）。
 * - `command_permissions: "UNRESTRICTED_SHELL"` —— 容器内可跑任意命令；
 *   边界是容器本身（`--cap-drop ALL` / `no-new-privileges` / 无宿主挂载）。
 * - `tool_interception_supported: false` —— 容器内工具调用不经 Gateway，本进程
 *   无法逐次拦截审计，因此**不能**记为 `GATEWAY_ENFORCED`。
 *
 * 这三条若硬写成 `GATEWAY_ONLY` / `WHITELIST_ONLY` / `true`，才是真正的风险：
 * 声明与实现脱节。隔离由运行时围栏负责（见 `sandbox/container-host.ts` 与
 * `worker-dispatch.ts::requireControlledDispatch`），见 W.5c-iii ruling A。
 */

export const OPENHANDS_ADAPTER_ID = "stagent.openhands.sandbox.v0" as const;

/** 实测镜像（摘要固定，避免 `:latest` 漂移导致「实测过的东西」变成未知） */
export const OPENHANDS_IMAGE =
  "ghcr.io/all-hands-ai/openhands@sha256:00968de77a7b36546413e1f3b5c6b4e2c387d19ade54de7926e10f5b3d265fa6";

/** 同上的可读标签（`docker pull` 用；登记/证据用上面的摘要式引用） */
export const OPENHANDS_IMAGE_TAG = "ghcr.io/all-hands-ai/openhands:latest";

/**
 * 实测记录（2026-11-02 · 本机 Docker Desktop 29.6.1 / linux-arm64）。
 *
 * 值来自真实容器内探测，**不是占位**：
 * `docker run --rm --network none --cap-drop ALL --cap-add DAC_OVERRIDE --entrypoint python <image> -c "import openhands; print(openhands.__version__)"`
 * → `openhands 0.59.0`；`sys.version` → `3.13.7`；
 * `python -m openhands.core.main --help` 正常输出（`-t/-d/-c/-i/-b/-l` 等参数可用）。
 *
 * **覆盖范围（不虚报）**：容器内 CLI 可启动 + 隔离负例（越界挂载 / 逃逸 / 提权 /
 * 出站）全部失败关闭。「模型驱动的端到端改动」**未**实测——容器 DENY 出站，
 * 模型 API 不可达，故本记录不声称端到端闭环。
 */
export const OPENHANDS_VERIFIED_ON = {
  cli_version: "OpenHands 0.59.0 (python 3.13.7, headless CLI)",
  verified_at: "2026-11-02",
} as const;

/**
 * 计费模型：OpenHands headless 通过 LiteLLM 直连模型 API，按 token 计量（非订阅、
 * 非配额）。与 W.5a 的「仅 API Key」纪律一致。
 */
export const OPENHANDS_BILLING_MODEL = "PER_TOKEN" as const;

/** 实测平台矩阵：只写**真跑过**的平台。未实测的平台不写（宁缺不虚报）。 */
export const OPENHANDS_PLATFORM_SUPPORT = ["darwin-arm64"] as const;

export const OPENHANDS_CAPABILITY: AdapterCapabilityDeclaration = {
  adapter_id: OPENHANDS_ADAPTER_ID,
  protocol_version: "1.0.0",
  // 容器内 headless CLI 不回传 provider 计量；usage 由字符数粗估（见下）
  model_metering_source: "LOCAL_ESTIMATE",
  tool_interception_supported: false,
  filesystem_permissions: "DIRECT_UNCONTROLLED",
  command_permissions: "UNRESTRICTED_SHELL",
  cancellation_supported: true,
  session_recovery_supported: false,
  network_requirements: "EXPLICIT_ONLY",
  platform_support: [...OPENHANDS_PLATFORM_SUPPORT],
  known_limitations: [
    "容器内文件读写不经过 ScopedWorktreeGateway，隔离边界是容器挂载：只有任务 Worktree 挂进 /work，宿主根 / .git / .stagent 均不挂载",
    "容器内工具调用不经 Gateway，本进程无法逐次拦截审计，故不得记为 GATEWAY_ENFORCED",
    "仅兑现网络策略 DENY（--network none）；EXPLICIT_TARGETS / USER_APPROVED 无法在 docker run 层逐目标限制出站，一律拒绝而非降级放行",
    "因出站被 DENY，容器内无法调用模型 API：本适配器可启动 headless CLI 并完成隔离负例，但「模型驱动的端到端改动」未实测，verified_on 不覆盖该场景",
    "变更由容器内进程直接写入挂载的 Worktree，适配器不回传逐文件内容，diff 与范围校验由后续网关侧采集",
    "usage 按字符数粗估（LOCAL_ESTIMATE），非 provider 回传计量，不能用于账单对账",
    "模型 API Key 经容器环境变量注入（LLM_API_KEY），容器内进程与宿主侧 docker inspect 均可读，未使用 secret 挂载",
    "镜像 /app 属 uid 42420 且 entrypoint.sh 为 0770，全量 cap-drop 会让容器起不来；故保留 DAC_OVERRIDE 一项（容器内 CapEff=0x2），NET_ADMIN / SYS_ADMIN / SYS_PTRACE 等仍全无",
    "任务 Worktree 的 .git 随根目录挂载进入容器（git worktree 指针文件内含宿主主仓路径字符串）；容器内该路径不可达，但路径信息可读",
    "仅在 darwin-arm64 + Docker Desktop 实测；其他平台未实测，不写入平台矩阵",
    "会话级恢复未实现：中断后需以新任务重跑，不复用容器内会话状态",
  ],
};

/** 沙箱执行失败（非零退出 / 被围栏拒绝 / 超时）。附原始 outcome 便于归因。 */
export class OpenHandsSandboxError extends Error {
  readonly outcome: SandboxRunOutcome;
  constructor(message: string, outcome: SandboxRunOutcome) {
    super(`[${outcome.rejection ?? outcome.via}] ${message}`);
    this.name = "OpenHandsSandboxError";
    this.outcome = outcome;
  }
}

export interface OpenHandsAdapterOptions {
  /**
   * 容器宿主。**必填**：没有宿主就没有执行路径。设为可选会让误配置退化成
   * 「静默本地执行」，这正是 W.5c-iii 要封的绕过口。
   */
  host: ContainerHostPort;
  /** 容器内 Worktree 工作目录，须与宿主的 `containerWorkRoot` 一致（默认 /work） */
  containerWorkDir?: string;
  /** 单次执行超时毫秒，默认 900_000（15 分钟：Agent 循环较慢，避免假超时） */
  timeoutMs?: number;
  /** 网络策略，默认 DENY */
  networkPolicy?: NetworkPolicy;
  /** `EXPLICIT_TARGETS` 时的允许目标（当前 DOCKER 宿主不兑现，会拒绝） */
  allowedTargets?: string[];
  /** 模型 API Key 解析器；只注入容器环境，不写日志 */
  apiKey?: () => string | undefined;
  /** 额外注入容器的环境变量（已白名单；不得含宿主凭据） */
  env?: Record<string, string>;
  /** headless CLI 参数：`-i/--max-iterations` */
  maxIterations?: number;
  /** headless CLI 参数：`-b/--max-budget-per-task`（美元） */
  maxBudgetPerTask?: number;
  /** 实测记录；缺省不填（未实测不得假装实测） */
  verifiedOn?: { cli_version: string; verified_at: string } | undefined;
  /** 测试可替换 runInSandbox（默认真实围栏 + 宿主） */
  runSandbox?: typeof runInSandbox;
}

/** 允许从 Daemon 环境透传进容器的模型侧变量（不含其他密钥） */
const FORWARD_ENV = ["LLM_MODEL", "LLM_BASE_URL"] as const;

function redact(text: string, secret: string | undefined): string {
  return secret === undefined || secret.length === 0
    ? text
    : text.split(secret).join("[REDACTED]");
}

/** 粗估 token（1 token ≈ 4 字符），与 `ai-worker` 同口径 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export class OpenHandsSandboxAdapter implements CodingWorkerAdapter {
  readonly declaration = OPENHANDS_CAPABILITY;
  readonly kind = "CLI" as const;

  constructor(private readonly opts: OpenHandsAdapterOptions) {
    if (opts.host === undefined || opts.host === null) {
      throw new Error(
        "OpenHandsSandboxAdapter requires a ContainerHostPort; there is no local fallback (TASK-W.5c-iii)",
      );
    }
  }

  /** 实测记录（未实测返回 undefined，调用方据此决定是否登记为受控档） */
  verifiedOn(): { cli_version: string; verified_at: string } | undefined {
    return this.opts.verifiedOn;
  }

  /** 构造 headless CLI argv（纯构建，便于逐字断言） */
  buildArgv(input: AdapterTaskInput): string[] {
    const workdir = this.opts.containerWorkDir ?? "/work";
    const argv = [
      "python",
      "-m",
      "openhands.core.main",
      "-t",
      input.system_prompt,
      "-d",
      workdir,
    ];
    if (this.opts.maxIterations !== undefined) {
      argv.push("-i", String(this.opts.maxIterations));
    }
    if (this.opts.maxBudgetPerTask !== undefined) {
      argv.push("-b", String(this.opts.maxBudgetPerTask));
    }
    return argv;
  }

  /** 容器内环境：只注入模型侧白名单变量 */
  containerEnv(): Record<string, string> {
    const env: Record<string, string> = { ...(this.opts.env ?? {}) };
    for (const name of FORWARD_ENV) {
      const value = process.env[name];
      if (value !== undefined && value.length > 0) env[name] = value;
    }
    const key = this.opts.apiKey?.();
    if (key !== undefined && key.length > 0) env["LLM_API_KEY"] = key;
    return env;
  }

  async run(
    input: AdapterTaskInput,
    signal?: AbortSignal,
  ): Promise<AdapterRunOutcome> {
    const key = this.opts.apiKey?.();
    const argv = this.buildArgv(input);
    const runSandbox = this.opts.runSandbox ?? runInSandbox;
    const sandboxInput: SandboxRunInput = {
      worktreeRoot: input.worktree_root,
      argv,
      networkPolicy: this.opts.networkPolicy ?? "DENY",
      ...(this.opts.allowedTargets === undefined
        ? {}
        : { allowedTargets: this.opts.allowedTargets }),
      ...(this.opts.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.opts.timeoutMs }),
      env: this.containerEnv(),
    };

    // 唯一执行路径：进入容器围栏。此处没有 if/else 的本地分支。
    const outcome = await runSandbox(this.opts.host, sandboxInput, signal);

    const log = [
      `openhands: adapter=${OPENHANDS_ADAPTER_ID} kind=${this.kind}`,
      `sandbox: host=${this.opts.host.kind ?? "unknown"} via=${outcome.via} exit=${String(outcome.exitCode)} duration_ms=${outcome.durationMs}`,
      ...outcome.stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(-40)
        .map((line) => `stdout: ${redact(line, key)}`),
      ...(outcome.stderr.trim().length === 0
        ? []
        : [`stderr: ${redact(outcome.stderr.slice(-2000), key)}`]),
    ];

    if (outcome.via === "rejected") {
      throw new OpenHandsSandboxError(
        `sandbox rejected execution (${outcome.rejection ?? "UNKNOWN"}); nothing was run`,
        outcome,
      );
    }
    if (outcome.via !== "exit" || outcome.exitCode !== 0) {
      throw new OpenHandsSandboxError(
        `openhands terminated abnormally (via=${outcome.via}, exit=${String(outcome.exitCode)})`,
        outcome,
      );
    }

    return {
      // 变更由容器内进程直接写入挂载的 Worktree；本适配器不回传逐文件内容
      changes: [],
      log,
      usage: {
        inputTokens: estimateTokens(input.system_prompt),
        outputTokens: estimateTokens(outcome.stdout),
      },
      // 见证只能由「宿主实际返回的 outcome」产出：未真正入容器则无此字段
      sandbox: sandboxWitness(this.opts.host, sandboxInput, outcome),
    };
  }
}
