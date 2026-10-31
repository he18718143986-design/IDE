import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { ScopedWorktreeGateway } from "../mcp/gateway";
import type { CostMonitor } from "../guard/cost-monitor";
import {
  buildWorkerTaskInstruction,
  resolveExposedTools,
  type WorkerTaskInstruction,
} from "./session-task-injector";
import { mountWorkerTools, type WorkerToolset } from "./worker-toolset";
import {
  MANAGED_AI_CAPABILITY,
  type AdapterCapabilityDeclaration,
} from "./worker-adapter.interface";
import {
  evaluateGraveyardGate,
  pickPrimaryVerdict,
  type BlockingCode,
  type LineVerdict,
} from "../guard/worker-graveyard-gate";
import { artifactChangesFromProposedWrites } from "../guard/graveyard-wiring";

/**
 * 受控 AI Worker（Daemon 侧，替代已删除的浏览器 Worker）。
 *
 * 安全边界：
 * 1. 任务上下文由 `session-task-injector` 依据**已批准合同**逐字段装配，
 *    模型只能看到合同授权的范围（可写/只读/禁区/验收/预算/工具/已知限制）；
 * 2. 工作目录锁定为隔离 Worktree 根（提供 repoRoot 时强制校验隔离目录），
 *    既不能等于宿主根，也不能是宿主根的祖先；
 * 3. 只读取合同 writable_paths 内的现有文件作为上下文（不读 .env / 严禁路径）；
 * 4. 调用模型前执行费用预检（assertCanConsume）；
 * 5. 模型返回的全部改动先做 Scope + 预算整体校验，任一越权则整批拒绝（不落半成品）；
 * 6. 实际写盘一律经 ScopedWorktreeGateway（并发锁、文件数预算、审计日志）；
 * 7. 模型用量回写 CostMonitor（持久化，重启不重置）。
 *
 * 本模块不引入任何子进程 / 原生 Shell 能力：文件与命令操作只能经网关。
 */

export interface WorkerChange {
  path: string;
  content: string;
}

export interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface WorkerGenerationInput {
  contract: SoftwareContract;
  /** 由注入器装配的完整任务指令（System Prompt 的唯一来源） */
  task: WorkerTaskInstruction;
  files: Array<{ path: string; content: string }>;
  signal?: AbortSignal;
}

export interface WorkerGenerationResult {
  changes: WorkerChange[];
  log: string[];
  usage: WorkerUsage;
}

/** 可注入的模型客户端（测试使用 fake，生产使用 OpenAI） */
export interface WorkerModelClient {
  generateChanges(
    input: WorkerGenerationInput,
  ): Promise<WorkerGenerationResult>;
}

/** 失败上下文：随异常回传控制面，用于 BLOCKED 证据归因与排障 */
export interface WorkerFailureContext {
  contract_id: string;
  contract_revision: number;
  worktree_root: string;
  stage:
    | "CONTEXT_ASSEMBLY"
    | "BUDGET_PRECHECK"
    | "MODEL_CALL"
    | "SCOPE_VALIDATION"
    | "TOOL_WRITE";
}

export interface WorkerRunResult {
  applied: boolean;
  changes: WorkerChange[];
  log: string[];
  usage: WorkerUsage;
  blockers: Array<{ code: string; message: string }>;
}

export class WorkerScopeError extends Error {
  readonly code: string;
  readonly blockers: Array<{ code: string; message: string }>;
  /** 失败发生的合同 / Worktree / 阶段，供控制面生成 BLOCKED 证据 */
  readonly context?: WorkerFailureContext | undefined;

  constructor(
    blockers: Array<{ code: string; message: string }>,
    context?: WorkerFailureContext | undefined,
    primaryCode?: string | undefined,
  ) {
    const code = primaryCode ?? "E_OUT_OF_SCOPE";
    super(
      `[${code}] Worker changes rejected: ${blockers.map((b) => b.message).join("; ")}`,
    );
    this.name = "WorkerScopeError";
    this.code = code;
    this.blockers = blockers;
    this.context = context;
  }
}

/** 模型调用失败：保留 cause 与上下文，由编排器决定是否转 BLOCKED / 重试 */
export class WorkerAdapterError extends Error {
  readonly stage: WorkerFailureContext["stage"];
  readonly context: WorkerFailureContext;

  constructor(
    message: string,
    context: WorkerFailureContext,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WorkerAdapterError";
    this.stage = context.stage;
    this.context = context;
  }
}

/**
 * G-09 资源熔断：工具调用或命令执行次数超限。
 * 不可恢复——当前 Worker 会话必须终止，需提高预算并重新审批后才能继续。
 */
export class WorkerBudgetExceededError extends Error {
  readonly code = "E_BUDGET_EXCEEDED";
  readonly context: WorkerFailureContext;

  constructor(message: string, context: WorkerFailureContext) {
    super(`[E_BUDGET_EXCEEDED] ${message}`);
    this.name = "WorkerBudgetExceededError";
    this.context = context;
  }
}

const MAX_CONTEXT_FILES = 20;
const MAX_CONTEXT_CHARS = 100_000;
/** 粗估：1 token ≈ 4 字符 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export class AiWorker {
  private readonly gateway: ScopedWorktreeGateway;
  private readonly costMonitor: CostMonitor;
  private readonly modelClient: WorkerModelClient;
  private readonly declaration: AdapterCapabilityDeclaration;
  private readonly repoRoot: string | undefined;
  private readonly exposedTools: readonly string[] | undefined;
  /** TASK-L.4：本段义务清单等，注入「你会被这样检查」 */
  private readonly checksExtras: readonly string[] | undefined;
  private readonly toolset: WorkerToolset;

  constructor(options: {
    gateway: ScopedWorktreeGateway;
    costMonitor: CostMonitor;
    modelClient: WorkerModelClient;
    /** 适配器能力声明；缺省使用内置 Managed AI 声明（含 5 条 known_limitations） */
    declaration?: AdapterCapabilityDeclaration | undefined;
    /** 宿主仓库根：提供时强制校验 Worktree 必须位于 <repo>/.stagent/worktrees/ */
    repoRoot?: string | undefined;
    /** 期望暴露的工具子集；缺省按合同授权推导 */
    exposedTools?: readonly string[] | undefined;
    /** TASK-L.4：追加到检查段的本段义务清单 */
    checksExtras?: readonly string[] | undefined;
  }) {
    this.gateway = options.gateway;
    this.costMonitor = options.costMonitor;
    this.modelClient = options.modelClient;
    this.declaration = options.declaration ?? MANAGED_AI_CAPABILITY;
    this.repoRoot = options.repoRoot;
    this.exposedTools = options.exposedTools;
    this.checksExtras = options.checksExtras;

    // 工具在构造期按合同授权一次性挂载：未授权命令执行时 exec 工具根本不实例化
    this.toolset = mountWorkerTools({
      gateway: this.gateway,
      exposedTools: resolveExposedTools(
        this.gateway.getContract(),
        this.exposedTools,
      ),
    });
  }

  /** 已挂载的受控 MCP 工具（W.2 五大工具的子集，由合同授权推导） */
  get tools(): WorkerToolset {
    return this.toolset;
  }

  /** 适配器能力声明（第 9 项 known_limitations 随指令注入模型） */
  get capability(): AdapterCapabilityDeclaration {
    return this.declaration;
  }

  /**
   * 装配任务指令（不调用模型）。
   * 审批前置与 Worktree 边界校验在此完成，失败抛 `WorkerInstructionError` /
   * `WorkerBoundaryError`，调用方无需自行拼装提示词。
   */
  prepare(): WorkerTaskInstruction {
    const gate = this.gateway.getGraveyardGate?.() ?? null;
    return buildWorkerTaskInstruction({
      contract: this.gateway.getContract(),
      worktreeRoot: this.gateway.getWorktreeRoot(),
      ...(this.repoRoot === undefined ? {} : { repoRoot: this.repoRoot }),
      declaration: this.declaration,
      ...(this.exposedTools === undefined
        ? {}
        : { exposedTools: this.exposedTools }),
      ...(this.checksExtras === undefined
        ? {}
        : { checksExtras: this.checksExtras }),
      ...(gate && gate.availability === "snapshot"
        ? { graveyard: gate.graveyard }
        : {}),
    });
  }

  async run(signal?: AbortSignal): Promise<WorkerRunResult> {
    const contract = this.gateway.getContract();
    const task = this.prepare();
    const context = await this.collectContext(task);

    // G-09：上下文读取本身也消耗工具调用配额；熔断后不得再发起模型调用
    if (this.gateway.isBudgetTripped()) {
      throw new WorkerBudgetExceededError(
        `Gateway budget exhausted before model call: ${JSON.stringify(this.gateway.getCallCounters())}`,
        this.failureContext("BUDGET_PRECHECK", task.worktree_root),
      );
    }

    // 费用预检：输入上下文 + 预期输出上限
    const estimatedInput = estimateTokens(
      context.map((f) => f.content).join("\n"),
    );
    this.costMonitor.assertCanConsume(estimatedInput, 4_000);

    let generated: WorkerGenerationResult;
    try {
      generated = await this.modelClient.generateChanges({
        contract,
        task,
        files: context,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (err) {
      // 模型侧失败同样必须带上下文回传控制面，便于生成 BLOCKED 证据
      throw new WorkerAdapterError(
        `Model call failed for contract ${contract.contract_id}: ${(err as Error).message}`,
        this.failureContext("MODEL_CALL", task.worktree_root),
        { cause: err },
      );
    }

    const { blockers, lineVerdicts } = this.validateChanges(
      contract,
      generated.changes,
      generated.log,
    );
    if (blockers.length > 0) {
      const primary = pickPrimaryVerdict(
        lineVerdicts.length > 0
          ? lineVerdicts
          : blockers.map((b) => ({ code: b.code as BlockingCode })),
      );
      throw new WorkerScopeError(
        blockers,
        this.failureContext("SCOPE_VALIDATION", task.worktree_root),
        primary?.code,
      );
    }

    for (const change of generated.changes) {
      const res = await this.toolset.writeFile(change.path, change.content);
      if (res.isError) {
        if (res.error?.code === "E_BUDGET_EXCEEDED") {
          throw new WorkerBudgetExceededError(
            `Gateway budget exhausted while writing '${change.path}': ${res.error.message}`,
            this.failureContext("TOOL_WRITE", task.worktree_root),
          );
        }
        throw new WorkerScopeError(
          [
            {
              code: res.error?.code ?? "WRITE_FAILED",
              message: res.error?.message ?? `Failed to write ${change.path}`,
            },
          ],
          this.failureContext("TOOL_WRITE", task.worktree_root),
        );
      }
    }

    this.costMonitor.recordUsage(
      generated.usage.inputTokens,
      generated.usage.outputTokens,
      undefined,
      { source: "ai-worker", contract_id: contract.contract_id },
    );

    return {
      applied: generated.changes.length > 0,
      changes: generated.changes,
      log: generated.log,
      usage: generated.usage,
      blockers: [],
    };
  }

  private failureContext(
    stage: WorkerFailureContext["stage"],
    worktreeRoot: string,
  ): WorkerFailureContext {
    const contract = this.gateway.getContract();
    return {
      contract_id: contract.contract_id,
      contract_revision: contract.contract_revision,
      worktree_root: worktreeRoot,
      stage,
    };
  }

  /** 仅读取 writable_paths 内已存在的文件，且总量有界 */
  private async collectContext(
    task: WorkerTaskInstruction,
  ): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    let totalChars = 0;

    for (const pattern of task.allowed_paths) {
      // 仅处理具体路径（含通配符的声明无法枚举，交给模型按需新建）
      if (pattern.includes("*")) continue;
      const res = await this.toolset.readFile(pattern);
      if (res.isError) continue;
      const content = res.content[0]?.text ?? "";
      if (totalChars + content.length > MAX_CONTEXT_CHARS) break;
      files.push({ path: pattern, content });
      totalChars += content.length;
      if (files.length >= MAX_CONTEXT_FILES) break;
    }

    return files;
  }

  /** 整批预校验：任一越权 / 墓地强命中 → 全部拒绝，绝不写半成品 */
  private validateChanges(
    contract: SoftwareContract,
    changes: WorkerChange[],
    log: string[] = [],
  ): {
    blockers: Array<{ code: string; message: string }>;
    lineVerdicts: LineVerdict[];
  } {
    const blockers: Array<{ code: string; message: string }> = [];
    const budget = contract.authorization.budget_limits.max_file_modifications;

    if (changes.length > budget) {
      blockers.push({
        code: "E_BUDGET_EXCEEDED",
        message: `Worker proposed ${changes.length} file changes, exceeding budget of ${budget}`,
      });
    }

    const seen = new Set<string>();
    const lineVerdicts: LineVerdict[] = [];
    for (const change of changes) {
      if (seen.has(change.path)) {
        blockers.push({
          code: "DUPLICATE_CHANGE",
          message: `Duplicate change for '${change.path}'`,
        });
        continue;
      }
      seen.add(change.path);
      // TASK-L.4：经网关评估，使 phaseOverlay 收窄在预校验阶段即生效
      const access = this.gateway.assessWriteAccess(change.path);
      if (!access.allowed) {
        const code = access.code ?? "E_OUT_OF_SCOPE";
        blockers.push({
          code,
          message:
            access.message ??
            `Path '${change.path}' is outside authorized writable scope`,
        });
        if (
          code === "E_FORBIDDEN_PATH" ||
          code === "E_OUT_OF_SCOPE" ||
          code === "E_OUT_OF_SCOPE_UNTRACKED"
        ) {
          lineVerdicts.push({ code: code as BlockingCode });
        }
      }
    }

    // TASK-J.18d：墓地门禁（整批）；阻断则与路径越权一并进入 pickPrimaryVerdict
    const gateCtx = this.gateway.getGraveyardGate?.() ?? null;
    if (gateCtx) {
      const artifactChanges = artifactChangesFromProposedWrites(
        this.gateway.getWorktreeRoot(),
        changes,
      );
      const gate = evaluateGraveyardGate({
        graveyard: gateCtx.graveyard,
        changes: artifactChanges,
        commands: [],
        texts: log.map((text) => ({ text, source: "log" as const })),
        availability: gateCtx.availability,
      });
      if (gate.block && gate.primary) {
        blockers.push({
          code: gate.primary.code,
          message:
            `触及用户否决过的方案（${gate.primary.rejected_id}）；整批不写盘`,
        });
        lineVerdicts.push({
          code: gate.primary.code,
          detail: { lock: gate.primary.lock, rejected_id: gate.primary.rejected_id },
        });
      }
      // 弱证据 / unavailable：不阻断；warnings 由编排器在证据侧记录
      void gate.warnings;
    }

    return { blockers, lineVerdicts };
  }
}
