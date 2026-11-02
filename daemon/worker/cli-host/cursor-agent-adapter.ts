import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AdapterCapabilityDeclaration,
  AdapterRunOutcome,
  AdapterTaskInput,
  CodingWorkerAdapter,
} from "../worker-adapter.interface";

/**
 * TASK-W.5b：cursor-agent 外部适配器（`UNCONTROLLED_EXTERNAL`，**无执行入口**）。
 *
 * 本文件的定位必须读清楚，否则会被误读成「cursor-agent 接上了」：
 *
 * 1. **它不是执行器**。`run()` 只抛错（先凭证、后执行器），派工门禁也恒拒
 *    （`UNCONTROLLED_EXTERNAL` 不挂派工工厂 → `E_ADAPTER_NOT_CONTROLLED`）。
 *    真正的执行入口要另卡接（届时才谈流式解析契约）。
 * 2. **`buildLaunch()` 是本卡唯一的契约面**：argv / env / MCP 落点全部纯构建、可逐字断言。
 *    之所以先钉它：外部 CLI 的注入面（额外工作区、额外插件、自动批准 MCP、强制放行）
 *    全在 argv 与环境变量上，先把这个面钉死，后续执行器卡才不必重新论证。
 * 3. **档位结构性上界**（P-124 卡「可达档位」条）：`GATEWAY_ENFORCED` 要求
 *    `tool_interception_supported === true`（本进程没有拦截点），`SANDBOX_ENFORCED`
 *    要求派工经 `runInSandbox()` 并携 `SandboxWitness`（宿主进程不经该入口），
 *    故唯一合法档位是 `UNCONTROLLED_EXTERNAL`。**实测不改变档位**。
 *
 * 实测事实（2026-11-02，本机 `cursor-agent --version` = `2026.10.01-e373342`）：
 * - 凭证：`--api-key <key>` 或 `CURSOR_API_KEY`；实测「The API key was loaded from
 *   the CURSOR_API_KEY environment variable」→ 确认环境变量路径可用。
 * - `--print` 帮助原文：has access to all tools, **including write and shell**。
 * - `--workspace <path-or-name>` / `-w, --worktree [name]` / `--add-dir <path>` /
 *   `--plugin-dir <path>` 均为**真实存在**的旗标（卡内假设成立，无需纠正）。
 * - 项目级 `.cursor/mcp.json` 在 `mcp list` 里显示 `not loaded (needs approval)`；
 *   `$HOME/.cursor/mcp.json` 直接加载 → MCP 只写专用 HOME，不写项目级。
 * - 无 `--strict-mcp-config` 等价开关：MCP 只能靠配置文件，不能靠旗标强约束。
 * - 登录态隔离：`HOME=<专用目录>` 下 `cursor-agent status` 输出 `Not logged in`，
 *   且无 key 直跑报 `Error: Authentication required...` → **不会**回落到订阅会话。
 * - prompt 会被当参数解析：`--print --yolo` 解析成功（说明 `--yolo` 被认成旗标），
 *   故 argv 在 prompt 前插入 `--` 终止符，否则「模型提示词」可变成「启动参数」。
 */

/** 注册表中的登记 id（也是能力声明的 `adapter_id`，单一事实源） */
export const CURSOR_AGENT_WORKER_ADAPTER_ID =
  "stagent.cursor-agent.v0" as const;

/** 本机实测的 CLI 版本（仅作记录与显示；**不**用于填 `verified_on`） */
export const CURSOR_AGENT_MEASURED_CLI_VERSION = "2026.10.01-e373342" as const;

/**
 * 实测环境记录：证明「做过哪些实测」，**不是** `verified_on`。
 *
 * `verified_on` 的语义是「4 类绕过负例在真实 CLI 上全部失败关闭」，本机没有有效
 * `CURSOR_API_KEY`，那 4 类负例需要模型驱动工具调用，**未执行**——故
 * `negative_cases_executed: false`，`verified_on` 保持 undefined。
 */
export const CURSOR_AGENT_MEASUREMENT = {
  cli_version: CURSOR_AGENT_MEASURED_CLI_VERSION,
  platform: "darwin-arm64",
  measured_at: "2026-11-02",
  /** 真跑过的部分（不需要模型推理即可观测） */
  observed: [
    "凭证来源：CURSOR_API_KEY 环境变量被 CLI 读取（假 key → 'The provided API key is invalid.'，exit 1）",
    "未登录基线：专用 HOME 下 status = 'Not logged in'；无 key 直跑 = 'Error: Authentication required...'（不回落到订阅会话）",
    "旗标合法性：--print/--output-format stream-json/--mode plan/--workspace 组合被接受（失败点是鉴权而非 unknown option）",
    "MCP 落点：$HOME/.cursor/mcp.json 被 mcp list 加载；项目级 .cursor/mcp.json 为 'not loaded (needs approval)'",
    "prompt 注入面：不带 `--` 终止符时 `--print --yolo` 里的 --yolo 被当作真旗标解析（同样只失败于鉴权）→ argv 已在 prompt 前插入 `--`",
  ],
  negative_cases_executed: false,
  negative_cases_reason:
    "无有效 CURSOR_API_KEY：越权写 / 保护区写 / 白名单外命令 / MCP 面越权 四类负例需要模型驱动工具调用，本机未执行",
} as const;

/**
 * `verified_on` 的唯一填值入口。
 *
 * **恒为 undefined 直到 4 类绕过负例在真实 CLI 上跑通**（与 `OPENHANDS_VERIFIED_ON` /
 * `CLAUDE_CODE_VERIFIED_ON` 同一纪律）。填值前必须同时给出 CLI 版本与实测日期；
 * 未实测就填 = 卡内 FAIL。
 */
export const CURSOR_AGENT_VERIFIED_ON:
  { cli_version: string; verified_at: string } | undefined = undefined;

/**
 * 允许传给 cursor-agent 的旗标（白名单）。只准出现这些；其余一律视为注入面。
 *
 * 与下面 `CURSOR_AGENT_FORBIDDEN_FLAGS` 成对：前者是「必须能拼出这条命令」，
 * 后者是「拼出来也不许带这些」——两者都在 `buildLaunch()` 里机制性拦截。
 */
export const CURSOR_AGENT_ALLOWED_FLAGS = [
  "--print",
  "--output-format",
  "--mode",
  "--workspace",
  "--resume",
] as const;

/**
 * 禁止出现在 argv 里的旗标（任一出现即视为注入面被打开，`buildLaunch()` 直接抛错）。
 *
 * 逐条对应一个真实绕过路径（均已于 `--help` 核对为真旗标）：
 * - `-f` / `--force` / `--yolo`：强制放行命令（Run Everything）；
 * - `--auto-review`：服务端分类器自动执行「安全」工具调用；
 * - `--approve-mcps`：自动批准全部 MCP 服务器（项目级 mcp.json 不再需要审批）；
 * - `--trust`：不提示就信任当前工作区；
 * - `--add-dir`：追加额外工作区根（越过 Worktree 边界）；
 * - `-w` / `--worktree`：让 CLI 自己在 `~/.cursor/worktrees` 建 worktree（绕过网关）；
 * - `--plugin-dir`：加载本地插件目录（注入代码）；
 * - `--api-key`：key 走环境变量（argv 会出现在 `ps` 里）。
 *
 * `--worktree-base` / `--skip-worktree-setup` 只在 `-w|--worktree` 下才生效，
 * 而 `-w` 已被禁，故不再单列。
 */
export const CURSOR_AGENT_FORBIDDEN_FLAGS = [
  "-f",
  "--force",
  "--yolo",
  "--auto-review",
  "--approve-mcps",
  "--trust",
  "--add-dir",
  "-w",
  "--worktree",
  "--worktree-base",
  "--skip-worktree-setup",
  "--plugin-dir",
  "--api-key",
] as const;

/**
 * cursor-agent 能力声明（9 项 + `known_limitations`）。
 *
 * **按最坏事实写**，不按「我们只以只读档启动」写：卡内写明「只读档（`--mode plan|ask`）
 * 是否真能拒写**尚未实测**」，故 `filesystem_permissions` 仍是 `DIRECT_UNCONTROLLED`、
 * `command_permissions` 仍是 `UNRESTRICTED_SHELL`。把未验证的缓解写成事实，就是
 * 按宿主修辞口径造假（REJ-010）。
 */
export const CURSOR_AGENT_CAPABILITY: AdapterCapabilityDeclaration = {
  adapter_id: CURSOR_AGENT_WORKER_ADAPTER_ID,
  protocol_version: "1.0.0",
  model_metering_source: "PROVIDER",
  // 本进程对 CLI 侧的工具调用没有任何拦截点，声明 true 即造假
  tool_interception_supported: false,
  filesystem_permissions: "DIRECT_UNCONTROLLED",
  command_permissions: "UNRESTRICTED_SHELL",
  // 无执行入口 ⇒ 取消语义未实现（不是「CLI 不支持 SIGTERM」，是本适配器还不接执行）
  cancellation_supported: false,
  // --resume 存在，但跨重启可用性与适配器侧实现均未实测
  session_recovery_supported: false,
  network_requirements: "EXPLICIT_ONLY",
  platform_support: ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"],
  known_limitations: [
    "外部 CLI 进程：文件与命令操作发生在本进程之外，不受编排器 ScopedWorktreeGateway 写范围约束",
    "工具调用由 CLI 侧发起与审批，本进程无拦截点（tool_interception_supported=false），无法逐次拦截审计",
    "`--print` 模式按 CLI 帮助原文可访问全部工具（含写文件与 shell）；本适配器仅以 `--mode plan|ask` 只读档构造 argv，但只读档能否真正拒写尚未实测（无有效 API Key）",
    "因此只能登记为 UNCONTROLLED_EXTERNAL：其产物不得作为受控执行或可合并证据",
    "MCP 面仅挂 Stagent 受管端点（写入专用 HOME 的 `~/.cursor/mcp.json`）；无 `--strict-mcp-config` 等价开关，项目级 `.cursor/mcp.json` 需人工批准才会加载",
    "`--resume` 会话恢复与取消语义均未接执行入口，未实测",
  ],
};

/** 只读执行档：两个档位都声明为只读（plan = 规划、ask = 问答） */
export type CursorAgentMode = "plan" | "ask";

export interface CursorAgentAdapterOptions {
  /** CLI 可执行文件，默认 `cursor-agent` */
  command?: string;
  /** API Key 来源；默认读 `process.env.CURSOR_API_KEY`。只注入子进程环境，不进 argv */
  apiKey?: () => string | undefined;
  /** 只读档，默认 `plan`（`ask` 亦为只读档） */
  mode?: CursorAgentMode;
  /**
   * 专用配置目录（`HOME` 指向它）。默认在 `tmpRoot` 下新建临时目录。
   *
   * 为什么用 HOME 而不是专用变量：cursor-agent **没有** `CURSOR_CONFIG_DIR`
   * 等价开关（`--help` 已核），登录态、`cli-config.json`、`mcp.json` 全挂在 `$HOME/.cursor`；
   * 不隔离 HOME 就会读到用户既有订阅登录态（本机实测即有）。
   */
  configDir?: string;
  /** 临时根目录（测试注入） */
  tmpRoot?: string;
  /** Stagent 受管 MCP 端点 URL 或其解析器 */
  mcpServerUrl?: string | (() => string | undefined);
  /** MCP 认证 token（写入 `mcpServers.stagent.headers.Authorization`） */
  authToken?: string | (() => string | undefined);
}

export interface CursorAgentBuiltLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** 专用配置目录（env.HOME 指向它） */
  configDir: string;
  /** MCP 配置落点（实测：`$HOME/.cursor/mcp.json` 会被 CLI 加载） */
  mcpPath: string;
}

/** 本适配器特有的失败码（便于测试与排障，不复用 WorkerDispatchError 的码空间） */
export const E_CURSOR_AGENT_NO_API_KEY = "E_CURSOR_AGENT_NO_API_KEY" as const;
export const E_CURSOR_AGENT_FORBIDDEN_FLAG =
  "E_CURSOR_AGENT_FORBIDDEN_FLAG" as const;
export const E_CURSOR_AGENT_MCP_ENDPOINT_MISSING =
  "E_CURSOR_AGENT_MCP_ENDPOINT_MISSING" as const;
export const E_CURSOR_AGENT_NO_EXECUTOR = "E_CURSOR_AGENT_NO_EXECUTOR" as const;

export class CursorAgentAdapterError extends Error {
  readonly code:
    | typeof E_CURSOR_AGENT_NO_API_KEY
    | typeof E_CURSOR_AGENT_FORBIDDEN_FLAG
    | typeof E_CURSOR_AGENT_MCP_ENDPOINT_MISSING
    | typeof E_CURSOR_AGENT_NO_EXECUTOR;
  constructor(code: CursorAgentAdapterError["code"], message: string) {
    super(message);
    this.name = "CursorAgentAdapterError";
    this.code = code;
  }
}

/** 专用配置目录：不存在则创建，权限恒为 0700（与 `claude-code-adapter::ensureConfigDir` 同纪律） */
function ensureConfigDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

function resolveStringOrFn(
  value: string | (() => string | undefined) | undefined,
): string | undefined {
  if (typeof value === "function") return value();
  return value;
}

/**
 * 拦截禁用旗标。
 *
 * 做成独立函数而不是内联判断：这样「谁能拼出 argv」和「argv 是否合规」是同一个
 * 强制点，将来多个入口（执行器 / 探测 / 手工 CLI 预览）都复用它，不会各写一份。
 *
 * **只检查 `--` 终止符之前的旗标位**：prompt 是位置参数，它自己可能以 `-` 开头
 * （例如用户让模型「看看 --force 是什么意思」），那不是旗标，不该被当作注入。
 * 反过来，`buildLaunch()` 必须在 prompt 前插入 `--`，否则 prompt 里的 `--yolo`
 * 会被 CLI 当成真旗标——这一条已实测（不带 `--` 时 `--yolo` 被接受为旗标）。
 */
export function assertNoForbiddenFlags(args: readonly string[]): void {
  const terminator = args.indexOf("--");
  const flagSection = terminator === -1 ? args : args.slice(0, terminator);
  for (const arg of flagSection) {
    // 只比较旗标本体（`--mode=plan` 形态也覆盖）
    const flag = arg.split("=", 1)[0] ?? arg;
    if ((CURSOR_AGENT_FORBIDDEN_FLAGS as readonly string[]).includes(flag)) {
      throw new CursorAgentAdapterError(
        E_CURSOR_AGENT_FORBIDDEN_FLAG,
        `argv 含禁用旗标 ${flag}：该旗标会打开注入面（额外工作区 / 插件 / 自动批准 / 强制放行 / argv 泄漏凭证）`,
      );
    }
  }
}

/**
 * cursor-agent 适配器：**能力载体**（声明 + 纯构建参数），不是执行器。
 *
 * 与 `claudeCodeWorkerRegistration()` / `openhandsRegistration()` 同款结构：
 * `run()` 必须显式失败，而不是「返回成功但什么都没干」——后者会把「没跑」伪装成「跑过」。
 */
export class CursorAgentAdapter implements CodingWorkerAdapter {
  readonly kind = "CLI" as const;
  readonly declaration = CURSOR_AGENT_CAPABILITY;

  constructor(private readonly opts: CursorAgentAdapterOptions = {}) {}

  private key(): string | undefined {
    return (this.opts.apiKey ?? (() => process.env["CURSOR_API_KEY"]))();
  }

  private mode(): CursorAgentMode {
    return this.opts.mode ?? "plan";
  }

  /** 受管 MCP 端点：显式注入 > `STAGENT_MCP_URL`；缺失即抛错（不静默空集合） */
  private mcpUrl(): string {
    const explicit = resolveStringOrFn(this.opts.mcpServerUrl);
    const url = explicit ?? process.env["STAGENT_MCP_URL"];
    if (url === undefined || url.trim().length === 0) {
      throw new CursorAgentAdapterError(
        E_CURSOR_AGENT_MCP_ENDPOINT_MISSING,
        "cursor-agent 必须挂接 Stagent 受管 MCP 端点：未提供 mcpServerUrl 且 STAGENT_MCP_URL 为空；不静默降级为无 MCP（否则「仅挂 Stagent MCP」不成立）",
      );
    }
    return url.trim();
  }

  /**
   * 纯构建：argv / env / 配置文件。**不做任何 IO 之外的副作用**（写 mcp.json 是构建的一部分，
   * 因为 CLI 只认配置文件——无法用旗标表达）。
   *
   * 与 `claude-code-adapter::buildLaunch()` 的差异（必须写清，免得被当成复制粘贴）：
   * 1. 没有 `--setting-sources` / `--tools` / `--disallowedTools` 对应物：cursor-agent
   *    的工具面不做细粒度白名单，只有 `--mode`（只读档）与一堆「放行/强制」开关；
   * 2. 没有 `--strict-mcp-config` 等价开关：MCP 靠 `$HOME/.cursor/mcp.json` 配置文件；
   * 3. 隔离靠 `HOME` 指向专用配置目录（无 `CURSOR_CONFIG_DIR`），因此 env 白名单里
   *    `HOME` 不是「透传」而是「改写」。
   */
  buildLaunch(input: {
    prompt: string;
    cwd: string;
    nativeSessionId?: string | null;
  }): CursorAgentBuiltLaunch {
    const configDir = ensureConfigDir(
      this.opts.configDir ??
        fs.mkdtempSync(
          path.join(this.opts.tmpRoot ?? os.tmpdir(), "stagent-cursor-"),
        ),
    );

    // 「仅挂 Stagent MCP」：只写一个 stagent 条目，不合并任何既有条目
    const mcpUrl = this.mcpUrl();
    const token = resolveStringOrFn(this.opts.authToken)?.trim();
    const stagentConfig: Record<string, unknown> = {
      type: "http",
      url: mcpUrl,
    };
    if (token !== undefined && token.length > 0) {
      stagentConfig["headers"] = { Authorization: `Bearer ${token}` };
    }
    const mcpPath = path.join(configDir, ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      mcpPath,
      `${JSON.stringify({ mcpServers: { stagent: stagentConfig } }, null, 2)}\n`,
      { mode: 0o600 },
    );

    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--mode",
      this.mode(),
      // Worktree 根：用 CLI 自己的 --workspace 定位，而不是让它自己建 worktree
      "--workspace",
      input.cwd,
    ];
    if (input.nativeSessionId) args.push("--resume", input.nativeSessionId);
    // `--` 终止旗标解析，prompt 从这之后才算位置参数。
    // 不加这一条，prompt 里的 `--yolo` 会被 CLI 当成真旗标（已实测：不带 `--` 时
    // `cursor-agent --print --yolo` 解析成功），等于把「模型提示词」变成「启动参数」。
    args.push("--");
    args.push(input.prompt);

    assertNoForbiddenFlags(args);

    const key = this.key();
    const env: NodeJS.ProcessEnv = {
      PATH: process.env["PATH"] ?? "",
      // 改写而非透传：把 $HOME/.cursor 挪到专用目录，隔离既有登录态
      HOME: configDir,
      LANG: process.env["LANG"] ?? "en_US.UTF-8",
      ...(key === undefined ? {} : { CURSOR_API_KEY: key }),
    };

    return {
      command: this.opts.command ?? "cursor-agent",
      args,
      // 白名单之外一律不透传：不做 `...process.env` 展开
      env,
      configDir,
      mcpPath,
    };
  }

  /**
   * **不执行**。两道检查按顺序给出，测试据此断言「凭证检查先于执行器检查」：
   * 1. 缺 API Key → `E_CURSOR_AGENT_NO_API_KEY`（且不进 argv，见 `CURSOR_AGENT_FORBIDDEN_FLAGS`）；
   * 2. 有 Key 但本卡未接执行器 → `E_CURSOR_AGENT_NO_EXECUTOR`。
   *
   * 为什么不顺手起个子进程：`--print` 的输出协议（stream-json 的字段 schema）**尚未实测**，
   * 猜一个解析器等于伪造「能跑」；卡内 FAIL 也写明「未实测即宣称」不行。
   */
  async run(
    _input: AdapterTaskInput,
    _signal?: AbortSignal,
  ): Promise<AdapterRunOutcome> {
    if (this.key() === undefined) {
      throw new CursorAgentAdapterError(
        E_CURSOR_AGENT_NO_API_KEY,
        "cursor-agent 适配器只支持 API Key：请设置 CURSOR_API_KEY（不使用官方登录 / 订阅会话）",
      );
    }
    throw new CursorAgentAdapterError(
      E_CURSOR_AGENT_NO_EXECUTOR,
      "capability carrier is not executable (cursor-agent): 4 类绕过负例尚未在真实 CLI 上实测（无有效 API Key），本卡不提供执行入口",
    );
  }
}
