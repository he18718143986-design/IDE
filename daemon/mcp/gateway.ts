import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  checkReadAccess,
  checkWriteAccess,
  matchesAnyPattern,
} from "../../src/lib/scope";
import {
  StagentReadFileSchema,
  StagentWriteFileSchema,
  StagentExecCommandSchema,
  StagentListDirSchema,
  StagentDeleteFileSchema,
  StagentDeclareCompleteSchema,
  type AuditLogEntry,
  type MCPToolCallResult,
  type MCPToolDefinition,
  type DeclareCompleteBlocker,
  type DeclareCompleteResult,
} from "./types";
import { createHash } from "node:crypto";
import {
  resolveSafeWorktreePath,
  PathTraversalError,
  E_PATH_TRAVERSAL,
} from "./path-resolver";
import {
  runCommand,
  CommandSecurityError,
  E_UNAUTHORIZED_COMMAND,
} from "../runner/command-runner";
import {
  assertAliasExtraArgsAllowed,
  CommandPolicyError,
} from "../runner/command-policy";
import { type EnvSanitizerOptions } from "../runner/env-filter";
import { buildCommandEnvironment } from "../worker/policy-guard";
import type { RuntimeInterceptor } from "../worker/runtime-interceptor";
import { assessCommandThreat, isRepoTrusted } from "../worker/threat-guard";
import {
  CostMonitor,
  E_COST_CAP_EXCEEDED,
  E_BUDGET_EXCEEDED,
} from "../guard/cost-monitor";
import { LoopGuard, E_LOOP_CIRCUIT_TRIPPED } from "../guard/loop-guard";
import {
  evaluateGraveyardGate,
  pickPrimaryVerdict,
  type LineVerdict,
} from "../guard/worker-graveyard-gate";
import {
  artifactChangeForWrite,
  graveyardBlockMessage,
  type GraveyardGateContext,
} from "../guard/graveyard-wiring";
import {
  isTestPath,
  scopeExplicitlyIncludesTests,
} from "../guard/test-integrity";
import { guardAgentFileOperation } from "../protection/protection-list";
import { ExecTokenError, type ExecTokenStore } from "../core/exec-token";
import { getActiveVault } from "../vault";

/**
 * TASK-D.3 / D-5：命令超时分层。
 *
 * 60s / 300s / 600s 三档来自架构 §6.4；档位只决定"看门狗何时兜底"，
 * 不改变命令本身的白名单与授权判定。
 */
export type CommandTimeoutTier = "SHORT" | "MEDIUM" | "LONG";

export function resolveCommandTimeoutTier(
  timeoutSeconds: number,
): CommandTimeoutTier {
  if (timeoutSeconds <= 60) return "SHORT";
  if (timeoutSeconds <= 300) return "MEDIUM";
  return "LONG";
}

/**
 * 取该命令在合同 `verification_spec` 中声明的 timeout_seconds。
 * 先精确匹配 executable+args，再退化为按 executable 匹配；都匹配不到按 60s。
 */
export function resolveCommandTimeoutSeconds(
  command: string,
  commands: readonly {
    executable: string;
    args: string[];
    timeout_seconds: number;
  }[],
): number {
  const exact = commands.find(
    (item) => [item.executable, ...item.args].join(" ") === command,
  );
  if (exact) return exact.timeout_seconds;

  const executable = command.trim().split(/\s+/)[0] ?? "";
  const byExecutable = commands.find((item) => item.executable === executable);
  return byExecutable?.timeout_seconds ?? 60;
}

/** 看门狗只需这三个能力；用窄接口避免 gateway 依赖整个引擎实现 */
export interface CommandTimeoutTracker {
  trackCommand(input: {
    contractId: string;
    command: string;
    tier: CommandTimeoutTier;
    pid?: number | null;
    timeoutMs?: number;
  }): { id: string };
  updateCommandPid(id: string, pid: number): void;
  settleCommand(id: string): void;
}

/**
 * 端口冲突判定（W.4 收紧）：
 * 1. 同一行必须同时出现「EADDRINUSE / address already in use」与 listen/bind 语义；
 * 2. 输出里不能出现断言失败标记（AssertionError / Tests failed / FAIL 等）；
 * 仅「提到这句话」不足以归因，避免把真正的断言失败误判成环境问题。
 */
const PORT_CONFLICT_LINE = /EADDRINUSE|address already in use/i;
const PORT_LISTEN_BIND_LINE = /\b(listen|listening|bind|binding)\b/i;
const ASSERTION_FAILURE = /AssertionError|\bTests?\s+failed\b|\bFAIL\b|[✕✗]/i;

export function isPortConflictOutput(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`;
  if (ASSERTION_FAILURE.test(text)) return false;
  return text
    .split("\n")
    .some(
      (line) =>
        PORT_CONFLICT_LINE.test(line) && PORT_LISTEN_BIND_LINE.test(line),
    );
}

/** 从 Worktree 路径反推主仓库根（保护清单/快照始终归属主仓库） */
function mainRepoRootOf(worktreeRoot: string): string {
  const marker = `${path.sep}.stagent${path.sep}worktrees${path.sep}`;
  const idx = worktreeRoot.indexOf(marker);
  return idx > 0 ? worktreeRoot.slice(0, idx) : worktreeRoot;
}

/** 单文件读取上限（规范 TASK-A.2 PASS-2） */
export const MAX_READ_BYTES = 1024 * 1024;

/** 测试文件写入被拦截（合同未显式授权测试模式） */
export const E_TEST_FILE_WRITE_BLOCKED = "E_TEST_FILE_WRITE_BLOCKED";

/** 乐观锁冲突（TASK-W.2 G-03 / §9.3：归因 SCOPE_VIOLATION） */
export const E_CONFLICT = "E_CONFLICT";

/** 任务已被用户主动中止（AbortSignal 已触发） */
export const E_TASK_ABORTED = "E_TASK_ABORTED";

/**
 * Shell 元字符：仅用于 Worker 面 `command_alias + args` 的参数校验。
 *
 * 即便执行器始终 `shell: false`（argv 直传、不解析），仍在网关层拒绝这些
 * 字符，形成「不依赖执行器实现」的第二道防线，并给出可审计的
 * `E_UNAUTHORIZED_COMMAND`，避免 Worker 误以为拼接式命令被接受。
 */
const SHELL_METACHARACTERS = /[;&|`$<>\n\r]/;

/** 递归列目录的条目上限，避免超大仓库把输出撑爆 */
const MAX_LIST_ENTRIES = 500;

/**
 * Scope 判定结果 → §9.3 运行时错误码。
 *
 * `checkWriteAccess()` 返回的是内部原因（`FORBIDDEN_PATH` / `NOT_WRITABLE`），
 * 直接当错误码回传会造成「实现码 ≠ 目录码」的契约漂移；此处统一映射：
 * 脏区排除 → `E_OUT_OF_SCOPE_UNTRACKED`（TASK-C.14d）；
 * 禁区 → `E_FORBIDDEN_PATH`；越界/只读 → `E_OUT_OF_SCOPE`。
 */
function scopeErrorCode(
  reason: string | undefined,
  opts?: { dirtyExclusionHit?: boolean },
): string {
  if (opts?.dirtyExclusionHit) return "E_OUT_OF_SCOPE_UNTRACKED";
  return reason === "FORBIDDEN_PATH" ? "E_FORBIDDEN_PATH" : "E_OUT_OF_SCOPE";
}

/** 二进制探测：前 8 KiB 出现 NUL 字节即判定为二进制 */
function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

export interface ScopedGatewayOptions {
  costMonitor?: CostMonitor | undefined;
  loopGuard?: LoopGuard | undefined;
  /** 用户主动中止信号：在途命令整树强杀，后续命令一律拒绝执行 */
  signal?: AbortSignal | undefined;
  /** TASK-C.5：命令输出的逐行实时回放（行内容已脱敏） */
  onTerminalLine?:
    ((stream: "stdout" | "stderr", line: string) => void) | undefined;
  /** TASK-W.4：运行时复检（能力漂移 / 未知通道 / 越界路径） */
  runtimeInterceptor?: RuntimeInterceptor | undefined;
  /** TASK-W.4：是否强制仓库信任标记（orchestrator 置 true；单测默认关闭） */
  requireRepoTrust?: boolean | undefined;
  /** TASK-D.3 / D-5：命令超时看门狗（缺省时不登记，行为退化为仅靠 runner 超时） */
  deadlock?: CommandTimeoutTracker | undefined;
  /**
   * TASK-C.12a：签署后施工写权。缺省不强制（兼容旧单测）；
   * orchestrator / 新测传入后，写/删必须持有未吊销 exec_token。
   */
  execToken?:
    | {
        store: ExecTokenStore;
        /** 当前施工令牌明文；PAUSED 后应为 null */
        getToken: () => string | null | undefined;
      }
    | undefined;
  /** TASK-C.12c：写/删越界被阻断后回调（调用方可跑 SIGINT→…→PAUSED） */
  onScopeBlocked?:
    | ((info: {
        tool: string;
        path: string;
        code: string;
        message: string;
      }) => void)
    | undefined;
  /**
   * TASK-C.14d：基线脏区排除清单。命中时错误码升为 E_OUT_OF_SCOPE_UNTRACKED，
   * 并仍触发 onScopeBlocked → C.12c 软停链。
   */
  dirtyExclusions?: readonly string[] | undefined;
  /**
   * TASK-J.18d：墓地门禁上下文（派工绑定结果）。
   * 缺省跳过墓地检查（兼容旧单测）；orchestrator 派工后必传。
   */
  graveyardGate?: GraveyardGateContext | undefined;
  /**
   * TASK-L.4：运行期收窄（verification-strategy §3.2 / §3.3）。
   * 只比合同更窄，不持久化、不改合同。可通过 setPhaseOverlay 在 T/I 段切换。
   */
  phaseOverlay?: PhaseOverlay | undefined;
}

/** TASK-L.4：运行期写范围收窄（只收窄不放宽） */
export interface PhaseOverlay {
  /** 存在时：测试文件只有列表内路径可写 */
  testWriteAllowlist?: string[] | undefined;
  /** 并入 strictly_forbidden（禁止优先于可写） */
  extraForbidden?: string[] | undefined;
}

/** G-09 分列记账快照（工具调用 / 命令执行互不折算） */
export interface GatewayCallCounters {
  tool_calls: number;
  command_executions: number;
  max_tool_calls?: number | undefined;
  max_command_executions?: number | undefined;
  tripped: boolean;
  trip_detail?: string | undefined;
}

/**
 * Scoped MCP Tool Gateway executing within a real Git Worktree environment.
 * Enforces SoftwareContract boundaries, path sandbox constraints, command whitelists,
 * and cost/loop circuit breakers.
 */
export class ScopedWorktreeGateway {
  private readonly worktreeRoot: string;
  private readonly contract: SoftwareContract;
  private readonly costMonitor?: CostMonitor | undefined;
  private readonly loopGuard?: LoopGuard | undefined;
  private readonly signal?: AbortSignal | undefined;
  private readonly onTerminalLine?:
    ((stream: "stdout" | "stderr", line: string) => void) | undefined;
  private readonly runtimeInterceptor?: RuntimeInterceptor | undefined;
  private readonly requireRepoTrust: boolean;
  private readonly deadlock?: CommandTimeoutTracker | undefined;
  private readonly execToken?: ScopedGatewayOptions["execToken"];
  private readonly onScopeBlocked?: ScopedGatewayOptions["onScopeBlocked"];
  private readonly dirtyExclusions: readonly string[];
  private graveyardGate: GraveyardGateContext | undefined;
  /** TASK-L.4：可变运行期收窄；不写回合同 */
  private phaseOverlay: PhaseOverlay | undefined;

  private auditLog: AuditLogEntry[] = [];
  private modifiedFiles: Set<string> = new Set();
  /** 本次任务实际写入过的测试文件（用于 Evidence tests_modified 留痕） */
  private modifiedTestFiles: Set<string> = new Set();
  /** 任务级累计运行时长（规范 §9.1：与单命令 timeout_seconds 独立） */
  private cumulativeDurationMs = 0;

  // --- G-09：工具调用与命令执行分列记账（互不折算） ---
  private toolCallCount = 0;
  private commandExecutionCount = 0;
  /** 任一计数超限即熔断；熔断后本实例不再执行任何工具调用（不可恢复） */
  private budgetTripped = false;
  private budgetTripDetail: string | null = null;

  constructor(
    worktreeRoot: string,
    contract: SoftwareContract,
    options: ScopedGatewayOptions = {},
  ) {
    this.worktreeRoot = path.resolve(worktreeRoot);
    this.contract = contract;
    this.costMonitor = options.costMonitor;
    this.loopGuard = options.loopGuard;
    this.signal = options.signal;
    this.onTerminalLine = options.onTerminalLine;
    this.runtimeInterceptor = options.runtimeInterceptor;
    this.requireRepoTrust = options.requireRepoTrust ?? false;
    this.deadlock = options.deadlock;
    this.execToken = options.execToken;
    this.onScopeBlocked = options.onScopeBlocked;
    this.dirtyExclusions = options.dirtyExclusions ?? [];
    this.graveyardGate = options.graveyardGate;
    this.phaseOverlay = options.phaseOverlay;
  }

  /** TASK-J.18d：派工后可热更新（resume / 重派） */
  setGraveyardGate(ctx: GraveyardGateContext | undefined): void {
    this.graveyardGate = ctx;
  }

  getGraveyardGate(): GraveyardGateContext | undefined {
    return this.graveyardGate;
  }

  /** TASK-L.4：切换运行期收窄（T/I 段）；传 undefined 清除 */
  setPhaseOverlay(overlay: PhaseOverlay | undefined): void {
    this.phaseOverlay = overlay;
  }

  getPhaseOverlay(): PhaseOverlay | undefined {
    return this.phaseOverlay;
  }

  /**
   * TASK-L.4：公开写评估（含 phaseOverlay 收窄），供 AiWorker 预校验。
   * 与真实 write/delete 使用同一套 effectiveWriteScope + testAllowlist。
   */
  public assessWriteAccess(relPath: string): {
    allowed: boolean;
    code?: string;
    message?: string;
  } {
    const deny = this.testAllowlistDenial(relPath);
    if (deny) {
      return {
        allowed: false,
        code: "E_TEST_NOT_IN_ALLOWLIST",
        message: deny,
      };
    }
    const access = checkWriteAccess(relPath, this.effectiveWriteScope());
    if (!access.allowed) {
      return {
        allowed: false,
        code: this.scopeBlockCode(access.reason, relPath),
        message:
          access.reason === "FORBIDDEN_PATH"
            ? `Path '${relPath}' is strictly forbidden (or phase extraForbidden)`
            : `Path '${relPath}' is outside authorized writable scope`,
      };
    }
    return { allowed: true };
  }

  /**
   * 合并 extraForbidden 后的写 Scope（禁止优先，复用 checkWriteAccess 顺序）。
   * 不修改合同对象。
   */
  private effectiveWriteScope(): {
    writable_paths: string[];
    readonly_paths?: string[];
    strictly_forbidden_paths?: string[];
  } {
    const base = this.contract.authorization.file_system_scope;
    const extra = this.phaseOverlay?.extraForbidden ?? [];
    if (extra.length === 0) return base;
    return {
      writable_paths: base.writable_paths,
      readonly_paths: base.readonly_paths,
      strictly_forbidden_paths: [
        ...(base.strictly_forbidden_paths ?? []),
        ...extra,
      ],
    };
  }

  /**
   * testWriteAllowlist 存在时：测试文件必须命中清单，否则阻断。
   * 返回拒绝文案；null 表示放行（或非测试 / 未启用 allowlist）。
   */
  private testAllowlistDenial(relPath: string): string | null {
    const allow = this.phaseOverlay?.testWriteAllowlist;
    if (allow === undefined) return null;
    if (!isTestPath(relPath)) return null;
    const hit = matchesAnyPattern(relPath, allow);
    if (hit.matches) return null;
    return (
      `Write rejected: '${relPath}' is a test file outside ` +
      `phaseOverlay.testWriteAllowlist (TASK-L.4 runtime narrowing)`
    );
  }

  /** TASK-C.14d：是否命中脏区排除（施工禁止覆盖） */
  private isDirtyExclusion(relPath: string): boolean {
    if (this.dirtyExclusions.length === 0) return false;
    return matchesAnyPattern(relPath, [...this.dirtyExclusions]).matches;
  }

  /** Scope 拒绝时的错误码：脏区优先升格为 E_OUT_OF_SCOPE_UNTRACKED */
  private scopeBlockCode(reason: string | undefined, relPath: string): string {
    return scopeErrorCode(reason, {
      dirtyExclusionHit: this.isDirtyExclusion(relPath),
    });
  }

  /** TASK-C.12a：写路径 exec_token 校验；未配置 execToken 时跳过（兼容旧测） */
  private assertExecTokenOrDeny(tool: string): MCPToolCallResult | null {
    if (!this.execToken) return null;
    try {
      this.execToken.store.assertExecTokenForWrite({
        token: this.execToken.getToken(),
        contract_id: this.contract.contract_id,
        worktree: this.worktreeRoot,
      });
      return null;
    } catch (err) {
      const code =
        err instanceof ExecTokenError ? err.code : "E_EXEC_TOKEN_MISSING";
      const message = err instanceof Error ? err.message : String(err);
      this.logAudit({
        tool,
        input: {},
        outcome: "BLOCKED",
        violationCode: code,
        details: message,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[${code}] ${message}` }],
        error: { code, message },
      };
    }
  }

  public getWorktreeRoot(): string {
    return this.worktreeRoot;
  }

  public getContract(): SoftwareContract {
    return this.contract;
  }

  public getAuditLog(): readonly AuditLogEntry[] {
    return this.auditLog;
  }

  public getModifiedFiles(): readonly string[] {
    return Array.from(this.modifiedFiles);
  }

  /** TASK-L.12：docs/system/** 不计入 max_file_modifications */
  private static readonly FILE_BUDGET_EXCLUSIONS = ["docs/system/**"] as const;

  private countsTowardFileBudget(relPath: string): boolean {
    return !matchesAnyPattern(relPath, [
      ...ScopedWorktreeGateway.FILE_BUDGET_EXCLUSIONS,
    ]).matches;
  }

  /** 计入文件修改预算的路径数（排除知识库目录） */
  private fileBudgetUsed(): number {
    let n = 0;
    for (const f of this.modifiedFiles) {
      if (this.countsTowardFileBudget(f)) n += 1;
    }
    return n;
  }


  public getModifiedTestFiles(): readonly string[] {
    return Array.from(this.modifiedTestFiles);
  }

  /** 本任务是否修改过测试文件（验证结论可信度预警） */
  public wasTestsModified(): boolean {
    return this.modifiedTestFiles.size > 0;
  }

  public getCostMonitor(): CostMonitor | undefined {
    return this.costMonitor;
  }

  public getLoopGuard(): LoopGuard | undefined {
    return this.loopGuard;
  }

  /**
   * G-09 分列记账快照：工具调用次数与命令执行次数各自独立累计，
   * 任一超限即 `tripped=true`，此后所有工具调用被硬阻断（不可恢复）。
   */
  public getCallCounters(): GatewayCallCounters {
    const budget = this.contract.authorization.budget_limits;
    return {
      tool_calls: this.toolCallCount,
      command_executions: this.commandExecutionCount,
      ...(budget.max_tool_calls === undefined
        ? {}
        : { max_tool_calls: budget.max_tool_calls }),
      ...(budget.max_command_executions === undefined
        ? {}
        : { max_command_executions: budget.max_command_executions }),
      tripped: this.budgetTripped,
      ...(this.budgetTripDetail === null
        ? {}
        : { trip_detail: this.budgetTripDetail }),
    };
  }

  /** 熔断后本实例拒绝一切工具调用（Worker 当前会话应终止） */
  public isBudgetTripped(): boolean {
    return this.budgetTripped;
  }

  /**
   * 工具调用记账：进入即计数，超过 `max_tool_calls` 时熔断。
   * 未配置上限时不限制。
   */
  private consumeToolCallBudget(tool: string): MCPToolCallResult | null {
    if (this.budgetTripped) {
      return this.budgetDenied(tool, "budget already tripped in this session");
    }

    const limit = this.contract.authorization.budget_limits.max_tool_calls;
    this.toolCallCount += 1;
    if (limit !== undefined && this.toolCallCount > limit) {
      this.budgetTripDetail = `max_tool_calls=${limit} exceeded (attempt ${this.toolCallCount})`;
      this.budgetTripped = true;
      return this.budgetDenied(tool, this.budgetTripDetail);
    }
    return null;
  }

  /** 命令执行记账：与工具调用分列，超过 `max_command_executions` 时熔断 */
  private consumeCommandExecutionBudget(): MCPToolCallResult | null {
    if (this.budgetTripped) {
      return this.budgetDenied(
        "stagent_exec_command",
        "budget already tripped",
      );
    }

    const limit =
      this.contract.authorization.budget_limits.max_command_executions;
    this.commandExecutionCount += 1;
    if (limit !== undefined && this.commandExecutionCount > limit) {
      this.budgetTripDetail = `max_command_executions=${limit} exceeded (attempt ${this.commandExecutionCount})`;
      this.budgetTripped = true;
      return this.budgetDenied("stagent_exec_command", this.budgetTripDetail);
    }
    return null;
  }

  private budgetDenied(tool: string, detail: string): MCPToolCallResult {
    const message =
      `Execution budget exhausted: ${detail}. ` +
      `Tool calls and command executions are metered separately; this session cannot continue`;
    this.logAudit({
      tool,
      input: {},
      outcome: "BLOCKED",
      violationCode: E_BUDGET_EXCEEDED,
      details: message,
    });
    return {
      isError: true,
      content: [{ type: "text", text: `[${E_BUDGET_EXCEEDED}] ${message}` }],
      error: {
        code: E_BUDGET_EXCEEDED,
        message,
        details: this.getCallCounters(),
      },
    };
  }

  /**
   * 构建子进程环境（TASK-W.3 目标 2）：
   * - 基础白名单由 `sanitizeEnvironment` 兜底；
   * - 合同 `allowed_environment_variable_names` 允许透传同名宿主变量；
   * - `env_file_grants` 仅在 alias 命中 `command_aliases` 时读取，
   *   且只取 `variable_names` 声明的键；值登记为秘密值供输出脱敏。
   */
  private buildCommandEnv(alias: string | undefined): {
    envOptions: EnvSanitizerOptions;
    secretValues: string[];
    env: Record<string, string>;
  } {
    // W.3：环境白名单 / env_file_grants / 网络策略统一由 policy-guard 组装
    const base = buildCommandEnvironment({
      permissions: this.contract.authorization.execution_permissions,
      worktreeRoot: this.worktreeRoot,
      alias,
    });
    // TASK-L.14：保险库值并入脱敏清单；**不**注入子进程环境（仅 L.15/L.17 注入）
    const vaultValues = getActiveVault()?.currentValues() ?? [];
    const secretValues = [...base.secretValues, ...vaultValues];
    return { ...base, secretValues };
  }

  private logAudit(entry: {
    tool: string;
    input: unknown;
    outcome: "SUCCESS" | "BLOCKED" | "FAILED";
    violationCode?: string | undefined;
    details?: string | undefined;
  }): void {
    const record: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      input: entry.input,
      outcome: entry.outcome,
    };
    if (entry.violationCode !== undefined) {
      record.violationCode = entry.violationCode;
    }
    if (entry.details !== undefined) {
      record.details = entry.details;
    }
    this.auditLog.push(record);
  }

  public getToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        name: "stagent_read_file",
        description:
          "Read file contents within authorized contract scope. Paths outside readable/writable scope or matching forbidden patterns are strictly rejected.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Project-relative file path" },
          },
          required: ["path"],
        },
      },
      {
        name: "stagent_write_file",
        description:
          "Write or modify file contents strictly within authorized writable_paths. Strictly forbidden paths and budget limits are enforced. Pass expected_hash for optimistic concurrency control; a mismatch is rejected with E_CONFLICT.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Target file path" },
            content: { type: "string", description: "Full content to write" },
            expected_hash: {
              type: "string",
              description:
                "Optional SHA-256 of the current file content; mismatch raises E_CONFLICT",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "stagent_exec_command",
        description:
          "Execute an authorized command alias from the contract (structured argv, shell:false). Shell metacharacters are rejected with E_UNAUTHORIZED_COMMAND.",
        inputSchema: {
          type: "object",
          properties: {
            command_alias: {
              type: "string",
              description:
                "Contract verification command alias (preferred for workers)",
            },
            args: {
              type: "array",
              items: { type: "string" },
              description:
                "Literal extra argv entries; shell metacharacters are rejected",
            },
          },
          required: ["command_alias"],
        },
      },
      {
        name: "stagent_list_directory",
        description:
          "List files and directories inside the worktree sandbox (规范命名；与 stagent_list_dir 等价).",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative directory path (defaults to root .)",
            },
            recursive: {
              type: "boolean",
              description: "Recursively list children (max 500 entries)",
            },
          },
        },
      },
      {
        name: "stagent_delete_file",
        description:
          "Delete a single regular file within authorized writable_paths. Directories, forbidden paths and unauthorized test files are rejected.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to delete" },
          },
          required: ["path"],
        },
      },
      {
        name: "stagent_declare_complete",
        description:
          "Declare the coding task complete. The server verifies actual scope, budget and verification results, then returns { ready_for_audit, blockers }.",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Optional change summary" },
            touched_paths: {
              type: "array",
              items: { type: "string" },
              description: "Paths the worker claims to have touched",
            },
          },
        },
      },
    ];
  }

  /**
   * Main dispatch entry point for MCP tool invocations.
   */
  public async callTool(
    name: string,
    rawInput: unknown,
    options: { internal?: boolean } = {},
  ): Promise<MCPToolCallResult> {
    // G-09：任何工具调用先记账；熔断后一律拒绝（含未知工具名）
    const budgetDenial = this.consumeToolCallBudget(name);
    if (budgetDenial) return budgetDenial;

    // W.4：每个工具调用前复检通道与路径；内部验证调用仅在未降级时豁免
    if (
      this.runtimeInterceptor &&
      (options.internal !== true || this.runtimeInterceptor.isStopped())
    ) {
      const guard = this.runtimeInterceptor.checkToolCall(name, rawInput);
      if (!guard.allowed) {
        const violation = guard.violation;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `[E_UNSAFE_EXECUTION] ${violation?.reason ?? "运行时复检失败"}`,
            },
          ],
          error: {
            code: "E_UNSAFE_EXECUTION",
            message: violation?.reason ?? "运行时复检失败",
            details: { violation: violation?.code },
          },
        };
      }
    }

    switch (name) {
      case "stagent_read_file":
        return this.handleReadFile(rawInput);
      case "stagent_write_file":
        return this.handleWriteFile(rawInput);
      case "stagent_exec_command":
        return this.handleExecCommand(rawInput, options.internal === true);
      case "stagent_list_dir":
      case "stagent_list_directory":
        return this.handleListDir(rawInput);
      case "stagent_delete_file":
        return this.handleDeleteFile(rawInput);
      case "stagent_declare_complete":
        return this.handleDeclareComplete(rawInput);
      default:
        this.logAudit({
          tool: name,
          input: rawInput,
          outcome: "FAILED",
          violationCode: "UNKNOWN_TOOL",
          details: `Unrecognized MCP tool name: '${name}'`,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: '${name}'` }],
          error: {
            code: "UNKNOWN_TOOL",
            message: `Tool '${name}' not supported`,
          },
        };
    }
  }

  private async handleReadFile(rawInput: unknown): Promise<MCPToolCallResult> {
    const parsed = StagentReadFileSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: "text", text: "Invalid read_file input: path is required." },
        ],
        error: { code: "INVALID_INPUT", message: "Path cannot be empty" },
      };
    }

    const { path: rawPath } = parsed.data;

    // 1. Path safety resolution
    let safe;
    try {
      safe = resolveSafeWorktreePath(this.worktreeRoot, rawPath);
    } catch (err) {
      const code =
        err instanceof PathTraversalError ? err.code : E_PATH_TRAVERSAL;
      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "BLOCKED",
        violationCode: code,
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }

    // 2. Scope verification
    const access = checkReadAccess(
      safe.relativePath,
      this.contract.authorization.file_system_scope,
    );
    if (!access.allowed) {
      const code = scopeErrorCode(access.reason);
      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "BLOCKED",
        violationCode: code,
        details: access.message ?? undefined,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: access.message || "Read permission denied" },
        ],
        error: {
          code,
          message: access.message || "Read permission denied",
          details: { path: safe.relativePath, pattern: access.pattern },
        },
      };
    }

    // 3. Read from disk
    try {
      if (!fs.existsSync(safe.absolutePath)) {
        return {
          isError: true,
          content: [
            { type: "text", text: `File not found: '${safe.relativePath}'` },
          ],
          error: {
            code: "ENOENT",
            message: `File not found: '${safe.relativePath}'`,
          },
        };
      }

      const stat = await fs.promises.stat(safe.absolutePath);
      if (!stat.isFile()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Not a regular file: '${safe.relativePath}'`,
            },
          ],
          error: { code: "EISDIR", message: "Target is not a regular file" },
        };
      }

      // 规范 PASS-2：默认上限 1 MiB，超出截断并标记 truncated
      const sizeBytes = stat.size;
      const readBytes = Math.min(sizeBytes, MAX_READ_BYTES);
      const buffer = Buffer.alloc(readBytes);
      const handle = await fs.promises.open(safe.absolutePath, "r");
      try {
        await handle.read(buffer, 0, readBytes, 0);
      } finally {
        await handle.close();
      }

      const truncated = sizeBytes > MAX_READ_BYTES;
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const binary = isBinaryBuffer(buffer);

      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "SUCCESS",
        ...(truncated
          ? { details: `truncated at ${MAX_READ_BYTES} of ${sizeBytes} bytes` }
          : {}),
      });

      if (binary) {
        // 二进制文件仅返回元数据与哈希，禁止文本解码
        const meta = {
          path: safe.relativePath,
          binary: true,
          truncated: false,
          size_bytes: sizeBytes,
          sha256,
        };
        return {
          isError: false,
          content: [{ type: "text", text: JSON.stringify(meta) }],
          data: meta,
        };
      }

      const content = buffer.toString("utf-8");
      const meta = {
        path: safe.relativePath,
        binary: false,
        truncated,
        size_bytes: sizeBytes,
        sha256,
      };
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: truncated
              ? `${content}\n[... truncated at ${MAX_READ_BYTES} of ${sizeBytes} bytes ...]`
              : content,
          },
        ],
        data: meta,
      };
    } catch (err) {
      this.logAudit({
        tool: "stagent_read_file",
        input: rawInput,
        outcome: "FAILED",
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to read file: ${(err as Error).message}`,
          },
        ],
        error: { code: "EIO", message: (err as Error).message },
      };
    }
  }

  /**
   * 第 5 个工具：服务端依据真实 Scope、预算与验证结果判定是否可进入审计。
   * 规范 TASK-A.2 PASS-4：返回 { ready_for_audit, blockers }。
   */
  private async handleDeclareComplete(
    rawInput: unknown,
  ): Promise<MCPToolCallResult> {
    const parsed = StagentDeclareCompleteSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid declare_complete input." }],
        error: { code: "INVALID_INPUT", message: parsed.error.message },
      };
    }

    const blockers: DeclareCompleteBlocker[] = [];
    const scope = this.effectiveWriteScope();
    const touched = parsed.data.touched_paths ?? [];

    // 1. Scope 校验：实际修改文件 + 声明的 touched_paths 均须在 writable 内
    for (const file of new Set([...this.modifiedFiles, ...touched])) {
      const access = checkWriteAccess(file, scope);
      if (!access.allowed) {
        blockers.push({
          code: this.scopeBlockCode(access.reason, file),
          message:
            `Path '${file}' is outside authorized writable scope: ${access.message ?? ""}`.trim(),
        });
      }
    }

    // 2. 文件数预算（TASK-L.12：docs/system/** 不计）
    const maxFiles =
      this.contract.authorization.budget_limits.max_file_modifications;
    const budgetUsed = this.fileBudgetUsed();
    if (budgetUsed > maxFiles) {
      blockers.push({
        code: "E_BUDGET_EXCEEDED",
        message: `Modified ${budgetUsed} files, exceeding budget of ${maxFiles}`,
      });
    }

    // 3. 费用 / Token 熔断
    if (this.costMonitor?.isTripped()) {
      blockers.push({
        code: "E_BUDGET_EXCEEDED",
        message:
          "Cost/token budget exhausted; resume requires a new approval round",
      });
    }

    // 4. 验证重试熔断
    if (this.loopGuard?.isTripped()) {
      blockers.push({
        code: "E_RETRY_LIMIT_EXCEEDED",
        message: `Verification retry limit reached (${this.loopGuard.getConsecutiveFailures()} consecutive failures)`,
      });
    }

    // 5. 验证结果：必须至少有一次通过的验证记录
    const history = this.loopGuard?.getHistory() ?? [];
    if (this.contract.verification_spec.commands.length > 0) {
      const last = history[history.length - 1];
      if (!last) {
        blockers.push({
          code: "VERIFICATION_NOT_RUN",
          message:
            "No verification command has been executed; run the contract verification suite first",
        });
      } else if (!last.passed) {
        blockers.push({
          code: "VERIFICATION_FAILED",
          message: `Latest verification failed (exit code ${last.exitCode ?? "unknown"})`,
        });
      }
    }

    const result: DeclareCompleteResult = {
      ready_for_audit: blockers.length === 0,
      blockers,
    };

    this.logAudit({
      tool: "stagent_declare_complete",
      input: parsed.data,
      outcome: blockers.length === 0 ? "SUCCESS" : "BLOCKED",
      ...(blockers[0] ? { violationCode: blockers[0].code } : {}),
      details: blockers.map((b) => b.message).join("; "),
    });

    return {
      isError: false,
      content: [{ type: "text", text: JSON.stringify(result) }],
      data: result,
    };
  }

  /**
   * P.1 保护门卫（C.5 验收要求）：所有写入/删除/改名之前必须先过这里。
   * - 命中保护区 → 登记待审批卡并拒绝（先拦后写）；
   * - 清单读不出/路径解析失败 → 一律拒绝（失败关闭）；
   * - 本方法不建快照：Vibe 的 Auto-Checkpoint 由聊天轮次开始时创建（server 层），
   *   合同 Worktree 由隔离目录与 Evidence 兜底，避免每次工具调用都触发 git 操作。
   */
  private async protectionDenied(
    tool: "stagent_write_file" | "stagent_delete_file",
    relPath: string,
  ): Promise<MCPToolCallResult | null> {
    const protectionRoot = mainRepoRootOf(this.worktreeRoot);
    let gate: {
      allowed: boolean;
      reason: string;
      cardId?: string | undefined;
    };
    try {
      gate = guardAgentFileOperation(protectionRoot, relPath);
    } catch (err) {
      gate = {
        allowed: false,
        reason: `保护门卫不可用，按拒绝处理：${(err as Error).message}`,
      };
    }
    if (gate.allowed) return null;
    this.logAudit({
      tool,
      input: { path: relPath },
      outcome: "BLOCKED",
      violationCode: "PROTECTED_PATH",
      details: gate.reason,
    });
    return {
      isError: true,
      content: [{ type: "text", text: gate.reason }],
      error: {
        code: "PROTECTED_PATH",
        message: gate.reason,
        details: { path: relPath, cardId: gate.cardId },
      },
    };
  }


  /**
   * TASK-J.18d：单次写的墓地门禁。强命中 → onScopeBlocked + 阻断；
   * 弱命中 / unavailable / 未配置 → 不阻断。
   */
  private evaluateWriteGraveyard(
    tool: string,
    relativePath: string,
    content: string,
  ): MCPToolCallResult | null {
    if (!this.graveyardGate) return null;
    const change = artifactChangeForWrite(
      this.worktreeRoot,
      relativePath,
      content,
    );
    const gate = evaluateGraveyardGate({
      graveyard: this.graveyardGate.graveyard,
      changes: [change],
      commands: [],
      texts: [],
      availability: this.graveyardGate.availability,
    });
    if (!gate.block || !gate.primary) return null;

    const code = gate.primary.code;
    const msg = graveyardBlockMessage(gate);
    this.logAudit({
      tool,
      input: { path: relativePath },
      outcome: "BLOCKED",
      violationCode: code,
      details: msg,
    });
    this.onScopeBlocked?.({
      tool,
      path: relativePath,
      code,
      message: msg,
    });
    return {
      isError: true,
      content: [{ type: "text", text: msg }],
      error: {
        code,
        message: msg,
        details: {
          path: relativePath,
          rejected_id: gate.primary.rejected_id,
          lock: gate.primary.lock,
        },
      },
    };
  }

  private async handleWriteFile(rawInput: unknown): Promise<MCPToolCallResult> {
    const parsed = StagentWriteFileSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Invalid write_file input: path and content are required.",
          },
        ],
        error: {
          code: "INVALID_INPUT",
          message: "Path and content are required",
        },
      };
    }

    const { path: rawPath, content } = parsed.data;

    // 0. TASK-C.12a：exec_token（签署后写权）
    {
      const denied = this.assertExecTokenOrDeny("stagent_write_file");
      if (denied) return denied;
    }

    // 1. Cost cap check
    if (this.costMonitor?.isTripped()) {
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: E_COST_CAP_EXCEEDED,
        details: "Cost cap has been reached for this contract run",
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `[${E_COST_CAP_EXCEEDED}] Cost cap has been reached`,
          },
        ],
        error: { code: E_COST_CAP_EXCEEDED, message: "Cost cap reached" },
      };
    }

    // 2. Path safety resolution
    let safe;
    try {
      safe = resolveSafeWorktreePath(this.worktreeRoot, rawPath);
    } catch (err) {
      const code =
        err instanceof PathTraversalError ? err.code : E_PATH_TRAVERSAL;
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: code,
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }

    // 3. Scope verification (Write access)
    const access = checkWriteAccess(
      safe.relativePath,
      this.effectiveWriteScope(),
    );
    if (!access.allowed) {
      const code = this.scopeBlockCode(access.reason, safe.relativePath);
      const dirtyHit = this.isDirtyExclusion(safe.relativePath);
      const msg = dirtyHit
        ? `[E_OUT_OF_SCOPE_UNTRACKED] 拒绝覆盖本地脏区「${safe.relativePath}」（基线排除，施工绝不触碰）`
        : access.message || "Write permission denied";
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: code,
        details: access.message ?? undefined,
      });
      this.onScopeBlocked?.({
        tool: "stagent_write_file",
        path: rawPath,
        code,
        message: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: msg }],
        error: {
          code,
          message: access.message || "Write permission denied",
          details: { path: safe.relativePath, pattern: access.pattern },
        },
      };
    }

    // 3.4 P.1 保护门禁：写入落盘前先拦（含后续新增的 delete_file）
    const protectedWrite = await this.protectionDenied(
      "stagent_write_file",
      safe.relativePath,
    );
    if (protectedWrite) return protectedWrite;

    // 3.45 TASK-J.18d：保护清单之后做墓地内容门禁
    {
      const denied = this.evaluateWriteGraveyard(
        "stagent_write_file",
        safe.relativePath,
        content,
      );
      if (denied) return denied;
    }

    // 3.5 测试完整性门禁：测试文件写入要求 writable_paths 中存在显式测试
    // 模式（tests/**、**/*.test.ts 等）。仅被 src/** 这类宽泛模式覆盖时坚决
    // 阻断——否则 Agent 可修改断言伪造验证通过（Test Integrity Guard）。
    if (isTestPath(safe.relativePath)) {
      const writable =
        this.contract.authorization.file_system_scope.writable_paths;
      if (!scopeExplicitlyIncludesTests(writable)) {
        const msg =
          `Write rejected: '${safe.relativePath}' is a test file, but writable_paths ` +
          `does not explicitly include test patterns (e.g. 'tests/**' or '**/*.test.ts'); ` +
          `modifying tests to fake a passing verdict is not allowed`;
        this.logAudit({
          tool: "stagent_write_file",
          input: { path: rawPath },
          outcome: "BLOCKED",
          violationCode: E_TEST_FILE_WRITE_BLOCKED,
          details: msg,
        });
        return {
          isError: true,
          content: [
            { type: "text", text: `[${E_TEST_FILE_WRITE_BLOCKED}] ${msg}` },
          ],
          error: { code: E_TEST_FILE_WRITE_BLOCKED, message: msg },
        };
      }
    }

    // TASK-L.4：phaseOverlay.testWriteAllowlist 运行期收窄
    {
      const deny = this.testAllowlistDenial(safe.relativePath);
      if (deny !== null) {
        this.logAudit({
          tool: "stagent_write_file",
          input: { path: rawPath },
          outcome: "BLOCKED",
          violationCode: E_TEST_FILE_WRITE_BLOCKED,
          details: deny,
        });
        this.onScopeBlocked?.({
          tool: "stagent_write_file",
          path: rawPath,
          code: E_TEST_FILE_WRITE_BLOCKED,
          message: deny,
        });
        return {
          isError: true,
          content: [
            { type: "text", text: `[${E_TEST_FILE_WRITE_BLOCKED}] ${deny}` },
          ],
          error: { code: E_TEST_FILE_WRITE_BLOCKED, message: deny },
        };
      }
    }

    // 4. Budget limits verification (Max file modifications；L.12 排除 docs/system/**)
    const maxFiles =
      this.contract.authorization.budget_limits.max_file_modifications;
    const countsTowardBudget = this.countsTowardFileBudget(safe.relativePath);
    const isNewFileMod =
      countsTowardBudget && !this.modifiedFiles.has(safe.relativePath);
    if (isNewFileMod && this.fileBudgetUsed() >= maxFiles) {
      const msg = `Budget exceeded: modification limit of ${maxFiles} files reached`;
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: "BUDGET_EXCEEDED",
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[BUDGET_EXCEEDED] ${msg}` }],
        error: { code: "BUDGET_EXCEEDED", message: msg },
      };
    }

    // 4.5 乐观并发锁（G-03）：传入 expected_hash 时必须与磁盘现状一致。
    // 文件不存在也视为冲突——调用方声明「我知道它现在是什么」，而它并不存在，
    // 静默当作新建会掩盖并发删除。
    if (parsed.data.expected_hash !== undefined) {
      const expected = parsed.data.expected_hash.toLowerCase();
      let currentHash: string | null = null;
      try {
        const currentBuffer = await fs.promises.readFile(safe.absolutePath);
        currentHash = createHash("sha256").update(currentBuffer).digest("hex");
      } catch {
        currentHash = null;
      }

      if (currentHash === null || currentHash !== expected) {
        const msg =
          currentHash === null
            ? `Optimistic lock failed: '${safe.relativePath}' does not exist, but expected_hash was provided`
            : `Optimistic lock failed: '${safe.relativePath}' was modified externally (expected ${expected}, actual ${currentHash})`;
        this.logAudit({
          tool: "stagent_write_file",
          input: { path: safe.relativePath, expected_hash: expected },
          outcome: "BLOCKED",
          violationCode: E_CONFLICT,
          details: msg,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `[${E_CONFLICT}] ${msg}` }],
          error: {
            code: E_CONFLICT,
            message: msg,
            details: {
              path: safe.relativePath,
              expected_hash: expected,
              current_hash: currentHash,
            },
          },
        };
      }
    }

    // 5. Write to disk
    try {
      const parentDir = path.dirname(safe.absolutePath);
      if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
      }

      await fs.promises.writeFile(safe.absolutePath, content, "utf-8");
      this.modifiedFiles.add(safe.relativePath);
      if (isTestPath(safe.relativePath)) {
        this.modifiedTestFiles.add(safe.relativePath);
      }

      this.logAudit({
        tool: "stagent_write_file",
        input: {
          path: safe.relativePath,
          bytesWritten: Buffer.byteLength(content, "utf-8"),
        },
        outcome: "SUCCESS",
      });

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `File '${safe.relativePath}' written successfully.`,
          },
        ],
      };
    } catch (err) {
      this.logAudit({
        tool: "stagent_write_file",
        input: { path: safe.relativePath },
        outcome: "FAILED",
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to write file: ${(err as Error).message}`,
          },
        ],
        error: { code: "EIO", message: (err as Error).message },
      };
    }
  }

  private async handleExecCommand(
    rawInput: unknown,
    internal: boolean,
  ): Promise<MCPToolCallResult> {
    const parsed = StagentExecCommandSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Invalid exec_command input: command is required.",
          },
        ],
        error: { code: "INVALID_INPUT", message: "Command cannot be empty" },
      };
    }

    // W.3：旧 command / executable 入口只允许 orchestrator 内部验证调用。
    // 对外工具定义已删除这两个字段，Worker 只能走 command_alias。
    if (
      !internal &&
      (parsed.data.command !== undefined ||
        parsed.data.executable !== undefined)
    ) {
      const msg =
        "Worker must use command_alias; free-form command/executable is internal-only";
      this.logAudit({
        tool: "stagent_exec_command",
        input: {
          has_command: parsed.data.command !== undefined,
          has_executable: parsed.data.executable !== undefined,
        },
        outcome: "BLOCKED",
        violationCode: E_UNAUTHORIZED_COMMAND,
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[${E_UNAUTHORIZED_COMMAND}] ${msg}` }],
        error: { code: E_UNAUTHORIZED_COMMAND, message: msg },
      };
    }

    // 结构化 argv 优先（§9.1）；字符串形式仅用于兼容既有调用。
    // Worker 面走 `command_alias`：别名必须存在于合同验证命令中，额外参数
    // 仅接受字面量，含 shell 元字符一律 E_UNAUTHORIZED_COMMAND。
    let structured: { executable: string; args: string[] } | undefined;
    /** 别名 + 已校验追加参数后的完整命令：只用于让 runner 做精确白名单匹配 */
    let authorizedAliasCommand: string | undefined;
    if (parsed.data.command_alias !== undefined) {
      const alias = parsed.data.command_alias;
      const spec = this.contract.verification_spec.commands.find(
        (candidate) => candidate.alias === alias,
      );
      if (!spec) {
        const msg = `Command alias '${alias}' is not authorized by the contract`;
        this.logAudit({
          tool: "stagent_exec_command",
          input: { command_alias: alias },
          outcome: "BLOCKED",
          violationCode: E_UNAUTHORIZED_COMMAND,
          details: msg,
        });
        return {
          isError: true,
          content: [
            { type: "text", text: `[${E_UNAUTHORIZED_COMMAND}] ${msg}` },
          ],
          error: {
            code: E_UNAUTHORIZED_COMMAND,
            message: msg,
            details: {
              command_alias: alias,
              allowed_aliases: this.contract.verification_spec.commands.map(
                (candidate) => candidate.alias,
              ),
            },
          },
        };
      }

      const extraArgs = parsed.data.args ?? [];
      // W.3 参数策略：解释器禁止动态求值参数，追加参数只允许位置参数
      try {
        assertAliasExtraArgsAllowed({
          executable: spec.executable,
          templateArgs: spec.args,
          extraArgs,
        });
      } catch (err) {
        const violation =
          err instanceof CommandPolicyError
            ? err.violation
            : "OPTION_INJECTION";
        const msg = (err as Error).message;
        this.logAudit({
          tool: "stagent_exec_command",
          input: { command_alias: alias, args: extraArgs },
          outcome: "BLOCKED",
          violationCode: E_UNAUTHORIZED_COMMAND,
          details: msg,
        });
        return {
          isError: true,
          content: [{ type: "text", text: msg }],
          error: {
            code: E_UNAUTHORIZED_COMMAND,
            message: msg,
            details: {
              command_alias: alias,
              violation,
              executable: spec.executable,
            },
          },
        };
      }

      const offending = extraArgs.find((arg) => SHELL_METACHARACTERS.test(arg));
      if (offending !== undefined) {
        const msg =
          `Argument contains shell metacharacters and is refused: ${JSON.stringify(offending)}. ` +
          `Commands are executed as a literal argv array with shell:false; ` +
          `pipes, chaining and substitutions are never interpreted`;
        this.logAudit({
          tool: "stagent_exec_command",
          input: { command_alias: alias, args: extraArgs },
          outcome: "BLOCKED",
          violationCode: E_UNAUTHORIZED_COMMAND,
          details: msg,
        });
        return {
          isError: true,
          content: [
            { type: "text", text: `[${E_UNAUTHORIZED_COMMAND}] ${msg}` },
          ],
          error: {
            code: E_UNAUTHORIZED_COMMAND,
            message: msg,
            details: { command_alias: alias, offending_argument: offending },
          },
        };
      }

      structured = {
        executable: spec.executable,
        args: [...spec.args, ...extraArgs],
      };
      authorizedAliasCommand =
        `${structured.executable} ${structured.args.join(" ")}`.trim();
    } else if (parsed.data.executable !== undefined) {
      structured = {
        executable: parsed.data.executable,
        args: parsed.data.args ?? [],
      };
    }
    const command = structured
      ? [structured.executable, ...structured.args].join(" ")
      : (parsed.data.command ?? "");

    // W.4：Worker 的 command_alias 路径同样过威胁守卫（含追加参数）
    if (!internal && structured !== undefined) {
      const assessment = assessCommandThreat({
        executable: structured.executable,
        args: structured.args,
        worktreeRoot: this.worktreeRoot,
        repoTrusted: this.requireRepoTrust
          ? isRepoTrusted(this.worktreeRoot)
          : true,
      });
      if (!assessment.allowed) {
        this.logAudit({
          tool: "stagent_exec_command",
          input: { command_alias: parsed.data.command_alias },
          outcome: "BLOCKED",
          violationCode: "E_UNSAFE_EXECUTION",
          details: assessment.reason,
        });
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `[E_UNSAFE_EXECUTION] ${assessment.reason}`,
            },
          ],
          error: {
            code: "E_UNSAFE_EXECUTION",
            message: assessment.reason,
            details: { category: assessment.category },
          },
        };
      }
    }

    // 0. 主动中止检查：abort 之后在途命令已被整树强杀，后续命令一律拒绝，
    //    保证 execute 的命令循环立刻收尾而不是继续跑剩余验证
    if (this.signal?.aborted) {
      const msg = "Task aborted by user; command execution refused";
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: E_TASK_ABORTED,
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[${E_TASK_ABORTED}] ${msg}` }],
        error: { code: E_TASK_ABORTED, message: msg },
      };
    }

    // 1. Loop guard check
    if (this.loopGuard?.isTripped()) {
      const msg =
        "Verification loop circuit breaker tripped: max consecutive retries reached";
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: E_LOOP_CIRCUIT_TRIPPED,
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[${E_LOOP_CIRCUIT_TRIPPED}] ${msg}` }],
        error: { code: E_LOOP_CIRCUIT_TRIPPED, message: msg },
      };
    }

    // 2. Whitelist compilation from contract (§9.1 structured commands)
    // 精确匹配：不再接受「前缀 + 空格」的松散放行；别名追加参数只有在
    // assertAliasExtraArgsAllowed 校验通过后，才把完整命令加入本轮白名单。
    const vSpec = this.contract.verification_spec;
    const allowedCommands: string[] = vSpec.commands.map((c) =>
      [c.executable, ...c.args].join(" "),
    );
    if (
      authorizedAliasCommand !== undefined &&
      !allowedCommands.includes(authorizedAliasCommand)
    ) {
      allowedCommands.push(authorizedAliasCommand);
    }

    // 3. Execution
    const taskBudgetMs =
      (this.contract.authorization.budget_limits.max_duration_seconds ?? 1800) *
      1000;

    // 任务级总时长熔断（§6.3 异常 3 / §9.3 E_TASK_TIMEOUT）
    if (this.cumulativeDurationMs >= taskBudgetMs) {
      const msg = `Task total duration budget exhausted: ${this.cumulativeDurationMs}ms >= ${taskBudgetMs}ms`;
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: "E_TASK_TIMEOUT",
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[E_TASK_TIMEOUT] ${msg}` }],
        error: { code: "E_TASK_TIMEOUT", message: msg },
      };
    }

    // 3.5 G-09：命令执行次数独立记账（与工具调用分列，超限即熔断）
    const commandBudgetDenial = this.consumeCommandExecutionBudget();
    if (commandBudgetDenial) return commandBudgetDenial;

    // 3.6 环境白名单 + 合同 env-file 授权（按 alias 生效）
    const commandEnv = this.buildCommandEnv(parsed.data.command_alias);

    try {
      // TASK-D.3 / D-5：按该命令在合同里声明的 timeout_seconds 分层登记看门狗。
      // 正常结束（含抛错）都要撤销，否则会被误判为超时并写假证据。
      const commandTimeoutSeconds = resolveCommandTimeoutSeconds(
        command,
        vSpec.commands,
      );
      const trackedCommand = this.deadlock?.trackCommand({
        contractId: this.contract.contract_id,
        command,
        tier: resolveCommandTimeoutTier(commandTimeoutSeconds),
        timeoutMs: commandTimeoutSeconds * 1000,
      });

      let result: Awaited<ReturnType<typeof runCommand>>;
      try {
        result = await runCommand(command, {
          cwd: this.worktreeRoot,
          allowedCommands,
          // 取"任务剩余预算"与"命令自身上限"的更严者：两者都不许突破
          timeoutMs: Math.min(
            Math.max(1, taskBudgetMs - this.cumulativeDurationMs),
            commandTimeoutSeconds * 1000,
          ),
          networkPolicy:
            this.contract.authorization.execution_permissions.network_policy,
          envOptions: commandEnv.envOptions,
          resolvedEnv: commandEnv.env,
          ...(commandEnv.secretValues.length === 0
            ? {}
            : { secretValues: commandEnv.secretValues }),
          ...(structured === undefined ? {} : { argv: structured }),
          ...(this.signal === undefined ? {} : { signal: this.signal }),
          ...(this.onTerminalLine === undefined
            ? {}
            : { onLine: this.onTerminalLine }),
          ...(trackedCommand === undefined
            ? {}
            : {
                onSpawn: (pid: number) =>
                  this.deadlock?.updateCommandPid(trackedCommand.id, pid),
              }),
        });
      } finally {
        if (trackedCommand) this.deadlock?.settleCommand(trackedCommand.id);
      }

      // 端口冲突诊断：验证脚本启动服务时常见，属于环境问题而非断言失败。
      // 识别后返回 E_PORT_CONFLICT + 白话说明，且不计入连续失败熔断。
      const portConflict =
        result.exitCode !== 0 &&
        isPortConflictOutput(result.stdout, result.stderr);

      // Update loop guard if this matches a verification test command
      const isTestCommand = allowedCommands.some(
        (tc) => command === tc || command.startsWith(tc + " "),
      );
      // 用户主动中止（exit 130）与端口冲突都不算验证失败，避免误触熔断
      if (this.loopGuard && isTestCommand && !result.aborted && !portConflict) {
        this.loopGuard.recordAttempt({
          passed: result.exitCode === 0,
          exitCode: result.exitCode,
          summary: result.exitCode === 0 ? "Test passed" : "Test failed",
        });
      }

      this.cumulativeDurationMs += result.durationMs;
      const taskBudgetExhausted = this.cumulativeDurationMs >= taskBudgetMs;

      const errorCode = taskBudgetExhausted
        ? "E_TASK_TIMEOUT"
        : portConflict
          ? "E_PORT_CONFLICT"
          : result.timedOut
            ? "E_COMMAND_TIMEOUT"
            : result.exitCode === 0
              ? undefined
              : "E_VERIFICATION_FAILED";

      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: result.exitCode === 0 ? "SUCCESS" : "FAILED",
        ...(errorCode ? { violationCode: errorCode } : {}),
        details: `Exit code ${result.exitCode}, duration ${result.durationMs}ms, truncated=${result.truncated}, redacted=${result.secretRedacted}`,
      });

      return {
        isError: result.exitCode !== 0,
        content: [
          {
            type: "text",
            text: `Command executed with exit code ${result.exitCode}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`,
          },
        ],
        data: result,
        ...(errorCode
          ? {
              error: {
                code: errorCode,
                message: taskBudgetExhausted
                  ? "Task total duration budget exhausted (max_duration_seconds)"
                  : portConflict
                    ? "端口被占用，验证未完成。这属于环境冲突，不是测试断言失败；请先停止占用该端口的进程（macOS/Linux 可用 lsof -i :<端口> 查看），再重试。"
                    : result.timedOut
                      ? "Command exceeded timeout_seconds and was terminated (124)"
                      : "Verification command returned a non-zero exit code",
              },
            }
          : {}),
      };
    } catch (err) {
      // 命令安全校验（注入符号 / 空命令 / 非法 argv）统一归到目录码
      // E_UNAUTHORIZED_COMMAND（§9.3），避免回传内部实现码 E_COMMAND_REJECTED
      const code =
        err instanceof CommandSecurityError
          ? E_UNAUTHORIZED_COMMAND
          : "EXEC_ERROR";
      this.logAudit({
        tool: "stagent_exec_command",
        input: { command },
        outcome: "BLOCKED",
        violationCode: code,
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }
  }

  /**
   * 删除普通文件（TASK-W.2 五大工具之一）。
   *
   * 语义与写入同级：删除属于「修改工作区」，必须满足可写 Scope、测试完整性
   * 与文件数预算；目录、符号链接一律拒绝（避免一次调用删掉整棵子树）。
   */
  private async handleDeleteFile(
    rawInput: unknown,
  ): Promise<MCPToolCallResult> {
    const parsed = StagentDeleteFileSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Invalid delete_file input: path is required.",
          },
        ],
        error: { code: "INVALID_INPUT", message: "Path cannot be empty" },
      };
    }

    const rawPath = parsed.data.path;

    // 0. TASK-C.12a：exec_token
    {
      const denied = this.assertExecTokenOrDeny("stagent_delete_file");
      if (denied) return denied;
    }

    // 1. 路径安全解析（拒绝绝对路径、.. 与越界符号链接）
    let safe;
    try {
      safe = resolveSafeWorktreePath(this.worktreeRoot, rawPath);
    } catch (err) {
      const code =
        err instanceof PathTraversalError ? err.code : E_PATH_TRAVERSAL;
      this.logAudit({
        tool: "stagent_delete_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: code,
        details: (err as Error).message,
      });
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }

    // 2. 可写 Scope（删除等同写入；含 TASK-L.4 extraForbidden）
    const access = checkWriteAccess(
      safe.relativePath,
      this.effectiveWriteScope(),
    );
    if (!access.allowed) {
      const code = this.scopeBlockCode(access.reason, safe.relativePath);
      const dirtyHit = this.isDirtyExclusion(safe.relativePath);
      const msg = dirtyHit
        ? `[E_OUT_OF_SCOPE_UNTRACKED] 拒绝删除本地脏区「${safe.relativePath}」（基线排除，施工绝不触碰）`
        : access.message || "Delete permission denied";
      this.logAudit({
        tool: "stagent_delete_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: code,
        details: access.message ?? undefined,
      });
      this.onScopeBlocked?.({
        tool: "stagent_delete_file",
        path: rawPath,
        code,
        message: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: msg }],
        error: {
          code,
          message: msg,
          details: { path: safe.relativePath, pattern: access.pattern },
        },
      };
    }

    // 2.5 P.1 保护门禁：删除前先拦（delete_file 与写入同权）
    const protectedDelete = await this.protectionDenied(
      "stagent_delete_file",
      safe.relativePath,
    );
    if (protectedDelete) return protectedDelete;

    // 3. 测试完整性：删除测试文件同样视为规避验证
    if (isTestPath(safe.relativePath)) {
      const writable =
        this.contract.authorization.file_system_scope.writable_paths;
      if (!scopeExplicitlyIncludesTests(writable)) {
        const msg =
          `Delete rejected: '${safe.relativePath}' is a test file, but writable_paths ` +
          `does not explicitly include test patterns; removing tests to fake a passing verdict is not allowed`;
        this.logAudit({
          tool: "stagent_delete_file",
          input: { path: rawPath },
          outcome: "BLOCKED",
          violationCode: E_TEST_FILE_WRITE_BLOCKED,
          details: msg,
        });
        return {
          isError: true,
          content: [
            { type: "text", text: `[${E_TEST_FILE_WRITE_BLOCKED}] ${msg}` },
          ],
          error: { code: E_TEST_FILE_WRITE_BLOCKED, message: msg },
        };
      }
    }

    // TASK-L.4：phaseOverlay.testWriteAllowlist 运行期收窄（删除同写）
    {
      const deny = this.testAllowlistDenial(safe.relativePath);
      if (deny !== null) {
        const msg = deny.replace(/^Write /, "Delete ");
        this.logAudit({
          tool: "stagent_delete_file",
          input: { path: rawPath },
          outcome: "BLOCKED",
          violationCode: E_TEST_FILE_WRITE_BLOCKED,
          details: msg,
        });
        this.onScopeBlocked?.({
          tool: "stagent_delete_file",
          path: rawPath,
          code: E_TEST_FILE_WRITE_BLOCKED,
          message: msg,
        });
        return {
          isError: true,
          content: [
            { type: "text", text: `[${E_TEST_FILE_WRITE_BLOCKED}] ${msg}` },
          ],
          error: { code: E_TEST_FILE_WRITE_BLOCKED, message: msg },
        };
      }
    }

    // 4. 文件数预算：删除一个未登记文件同样占用一次修改配额（L.12 排除 docs/system/**）
    const maxFiles =
      this.contract.authorization.budget_limits.max_file_modifications;
    const countsTowardBudget = this.countsTowardFileBudget(safe.relativePath);
    const isNewFileMod =
      countsTowardBudget && !this.modifiedFiles.has(safe.relativePath);
    if (isNewFileMod && this.fileBudgetUsed() >= maxFiles) {
      const msg = `Budget exceeded: modification limit of ${maxFiles} files reached`;
      this.logAudit({
        tool: "stagent_delete_file",
        input: { path: rawPath },
        outcome: "BLOCKED",
        violationCode: "BUDGET_EXCEEDED",
        details: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `[BUDGET_EXCEEDED] ${msg}` }],
        error: { code: "BUDGET_EXCEEDED", message: msg },
      };
    }

    // 5. 只删普通文件（lstat：符号链接不算普通文件）
    try {
      const stat = await fs.promises.lstat(safe.absolutePath);
      if (!stat.isFile()) {
        const msg = `Refusing to delete non-regular file: '${safe.relativePath}'`;
        this.logAudit({
          tool: "stagent_delete_file",
          input: { path: rawPath },
          outcome: "BLOCKED",
          violationCode: "E_NOT_A_FILE",
          details: msg,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `[E_NOT_A_FILE] ${msg}` }],
          error: { code: "E_NOT_A_FILE", message: msg },
        };
      }

      await fs.promises.unlink(safe.absolutePath);
      this.modifiedFiles.add(safe.relativePath);
      if (isTestPath(safe.relativePath)) {
        this.modifiedTestFiles.add(safe.relativePath);
      }

      this.logAudit({
        tool: "stagent_delete_file",
        input: { path: safe.relativePath },
        outcome: "SUCCESS",
        details: `deleted ${stat.size} bytes`,
      });

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `File '${safe.relativePath}' deleted successfully.`,
          },
        ],
        data: { deleted: true, path: safe.relativePath },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "EIO";
      const message =
        code === "ENOENT"
          ? `File not found: '${safe.relativePath}'`
          : `Failed to delete file: ${(err as Error).message}`;
      this.logAudit({
        tool: "stagent_delete_file",
        input: { path: safe.relativePath },
        outcome: "FAILED",
        violationCode: code,
        details: message,
      });
      return {
        isError: true,
        content: [{ type: "text", text: message }],
        error: { code: code === "ENOENT" ? "ENOENT" : "EIO", message },
      };
    }
  }

  private async handleListDir(rawInput: unknown): Promise<MCPToolCallResult> {
    const parsed = StagentListDirSchema.safeParse(rawInput ?? {});
    const targetRel = parsed.success ? parsed.data.path : ".";
    const recursive = parsed.success ? parsed.data.recursive === true : false;

    let safe;
    try {
      safe = resolveSafeWorktreePath(this.worktreeRoot, targetRel);
    } catch (err) {
      const code =
        err instanceof PathTraversalError ? err.code : E_PATH_TRAVERSAL;
      return {
        isError: true,
        content: [
          { type: "text", text: `[${code}] ${(err as Error).message}` },
        ],
        error: { code, message: (err as Error).message },
      };
    }

    try {
      if (!fs.existsSync(safe.absolutePath)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Directory not found: '${safe.relativePath}'`,
            },
          ],
          error: { code: "ENOENT", message: "Directory not found" },
        };
      }

      const forbidden =
        this.contract.authorization.file_system_scope.strictly_forbidden_paths;
      interface ListedEntry {
        name: string;
        path: string;
        isDirectory: boolean;
        isFile: boolean;
      }
      const collected: ListedEntry[] = [];

      const walk = async (
        dirAbs: string,
        dirRel: string,
        depth: number,
      ): Promise<void> => {
        const entries = await fs.promises.readdir(dirAbs, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (collected.length >= MAX_LIST_ENTRIES) return;
          if (entry.name === ".git" || entry.name === ".stagent") continue;
          const entryRel =
            dirRel === "." ? entry.name : `${dirRel}/${entry.name}`;
          if (matchesAnyPattern(entryRel, forbidden).matches) continue;
          collected.push({
            name: entry.name,
            path: entryRel,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
          });
          // 深度上限 8 层：防御异常嵌套导致的遍历爆炸
          if (
            recursive &&
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            depth < 8
          ) {
            await walk(path.join(dirAbs, entry.name), entryRel, depth + 1);
          }
        }
      };

      await walk(safe.absolutePath, safe.relativePath, 0);

      this.logAudit({
        tool: "stagent_list_directory",
        input: { path: safe.relativePath, recursive },
        outcome: "SUCCESS",
        details: `${collected.length} entries`,
      });

      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(collected, null, 2) }],
        data: collected,
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to list directory: ${(err as Error).message}`,
          },
        ],
        error: { code: "EIO", message: (err as Error).message },
      };
    }
  }
}
