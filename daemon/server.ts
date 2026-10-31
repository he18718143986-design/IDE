import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { findAvailablePort, PortFinderOptions } from "./core/port-finder";
import {
  acquirePidLock,
  releasePidLock,
  readPidLock,
  PidLockInfo,
  PidLockError,
} from "./core/pid-lock";
import {
  createFrame,
  chunkWorkerLog,
  isClientToServerAllowed,
  isIpcFrame,
  MAX_FRAME_BYTES,
  WS_CLOSE_UNAUTHORIZED,
  type AuthPayload,
  type DemoPreviewStatusPayload,
  type RealPlaytestStatusPayload,
  type IpcFrame,
  type IpcFrameType,
} from "../src/lib/ipc/frames";
import {
  DEMO_ORIGIN_FORBIDDEN,
  isDemoPreviewOrigin,
} from "../src/lib/ipc/demo-origin";
import {
  isRealPreviewOrigin,
  REAL_ORIGIN_FORBIDDEN,
} from "../src/lib/ipc/real-preview-origin";
import {
  resolveConsolePublicDir,
  tryServeConsoleStatic,
} from "./console/static-host";

import {
  createDemoPreviewServer,
  type DemoPreviewServer,
  type DemoPreviewServerOptions,
} from "./supervisor/demo/preview-server";
import {
  assertDemoConfirmedForWrite,
  buildMinimalPrototypeDemo,
  confirmDemoPrototype,
  readDemoConfirm,
  writePrototype,
} from "./supervisor/demo/prototypes";
import {
  evaluateLatestDemoGate,
  evaluateSnapshotDemoGate,
  type DemoSignGateDecision,
} from "./supervisor/demo/signing-gate";
import {
  readSchemeSnapshot,
  writeSchemeSnapshot,
  schemeBindingFromSnapshot,
  SchemeSnapshotConflictError,
} from "./pipeline/scheme-snapshot-store";
import { loadOrInitLedgerState } from "./supervisor/intent-compiler/scheme-ledger-store";
import {
  assertContractScopeAllowed,
  WritableScopePolicyError,
} from "./supervisor/scope-gate";
import {
  assertScopePlanFreshForFreeze,
  assertSignedContractMatchesSnapshot,
  preflightScopePlan,
  SchemeSnapshotMismatchError,
  ScopeInvariantBrokenError,
  ScopePlanDriftError,
} from "./supervisor/scope-preflight";
import type { ScopePlan } from "../src/lib/journey/scope-plan";
import {
  createRealPreviewServer,
  writeRealPlaytestStub,
  type RealPreviewServer,
} from "./supervisor/preview/real-preview-server";
import {
  findStaticPreviewRoot,
  NO_PREVIEW_PLAIN_MESSAGE,
  pickPreviewCommand,
  startAppPreview,
  stopAppPreview,
  waitReady,
  type AppPreviewHandle,
} from "./supervisor/preview/app-runner";
import { REAL_PREVIEW_PORT_RANGE } from "./supervisor/preview/types";
import {
  createSessionToken,
  clearSessionToken,
  verifySessionToken,
  isLocalOrigin,
  isLocalHostAuthority,
} from "./core/session-token";
import {
  isRecentProjectPath,
  readRecentProjects,
  recordRecentProject,
} from "./core/recent-projects";
import {
  buildWorkspaceLaunchUrl,
  ensureWorkspaceSession,
} from "./core/open-workspace";
import {
  appendClientTrace,
  appendDaemonLog,
  appendJourneyTurn,
  appendWorkerTerminalLog,
  newRequestId,
  readJourneyTurns,
} from "./core/debug-log";
import { SupervisorSessionManager } from "./supervisor/session-manager";
import { SUPERVISOR_SESSION_SCHEMA_VERSION } from "./supervisor/types";

import {
  createIntentCompilerHost,
  IntentCompilerHost,
  type IntentCompilerModelClient,
  type CompilerLoopStats,
} from "./supervisor/intent-compiler/host";

import {
  recoverDaemonState,
  type RecoveryReport,
} from "./recovery/crash-recovery";
import {
  clearGatewayViolation,
  loadCurrentGatewayViolation,
} from "./guard/gateway-violation-store";
import { projectDeliveryState } from "../src/lib/state/delivery-state";
import { ContractOrchestrator } from "./pipeline/orchestrator";
import { TaskGraphEngine } from "./graph/graph-engine";
import { collectWorktreeEvidence } from "./graph/evidence-collector";
import type { IlluminationInput } from "./graph/illumination-verifier";
import type { SupervisorProposalV1 } from "../src/lib/graph/task-graph";
import { RequirementsStore } from "./supervisor/specs/requirements-store";
import { orchestrateJourney } from "./supervisor/journey/orchestrate";
import {
  exportRedactedRecordsZip,
  cleanupProjectRecords,
} from "./pipeline/records-export-cleanup";
import {
  buildTimeoutFallbackReport,
  runDisputeSelfCheck,
} from "./supervisor/dispute";
import {
  DisputeTimeoutError,
  DISPUTE_TIMEOUT_MS,
  E_DISPUTE_TIMEOUT,
  type DisputeReport,
} from "./supervisor/dispute/types";
import {
  extractKeywords,
  SpecFactSourceImpl,
} from "./supervisor/dispute/evidence-triad";
import {
  loadEvidenceSnapshot,
  loadLatestEvidenceSnapshot,
  squashMerge,
  TargetBranchAdvancedError,
} from "./pipeline/merger";
import {
  isContractLockResource,
  setContractLockLeaseObserver,
} from "./core/contract-mutex";
import { killProcessTree } from "./runner/process-tree";
import { runCommand, E_UNAUTHORIZED_COMMAND } from "./runner/command-runner";
import {
  addProtectionEntry,
  closeRound,
  decideApproval,
  drainProtectionRequests,
  ensureRoundStarted,
  loadProtectionList,
  loadRoundState,
  protectionMode,
  recommendProtections,
  removeProtectionEntry,
} from "./protection/protection-list";
import {
  clearCheckpoint,
  ensureCheckpoint,
  getCheckpoint,
  undoLatestCheckpoint,
} from "./protection/auto-checkpoint";
import { softwareContractSchema } from "../src/lib/contract.schema";
import { DeadlockResilience } from "./state/deadlock-resilience";
import {
  loadPresentationSnapshot,
  persistPresentation,
} from "./state/presentation-store";
import {
  projectContract,
  readLatestEvidenceSignal,
  toStateChangedPayload,
  type DaemonRuntimeSignals,
} from "./state/presentation-projector";
import { SessionSeqTracker } from "./state/session-seq";
import type { SoftwareContract } from "../src/lib/contract.schema";
import type { EvidenceBundle } from "../src/lib/evidence.schema";
import { WorktreeWatcher } from "./watcher/fs-watcher";
import { EvidenceInvalidationEngine } from "./watcher/invalidation-engine";
import { buildDependencyGraph } from "./arch/graph";
import { readDiffFiles } from "./diff/diff-files";
import { launchEditor } from "./editor/launcher";
import { getModelSettings, setRuntimeKey } from "./worker/key-store";
import {
  createVault,
  getActiveVault,
  setActiveVault,
  VaultError,
  type Vault,
} from "./vault";
import { readPlan, writePlan } from "./project/plan-store";
import {
  applyContractStubTerminal,
  findInFlightContract,
  stubIdFromContract,
  triggerRedecomposeIfNeeded,
} from "./project/contract-sequence";
import { nextStub } from "../src/lib/project/next-stub";

import {
  applyPlanPatch,
  type PlanPatch,
} from "../src/lib/project/plan-patch";
import type { RepoFacts } from "../src/lib/project/project-plan";
import {
  decompose,
  type ReadyPabView,
} from "./supervisor/decomposer";
import { httpStatusForErrorCode } from "../src/lib/error-codes";
import { ChatSessionManager } from "./chat/session-manager";
import {
  decideWrite,
  listRepoTreePaths,
  readFileFor,
  recordViolation,
  type FileAccessContext,
} from "./editor/worktree-files";
import { deleteRepoPath } from "./editor/repo-delete";
import {
  createRepoPath,
  renameRepoPath,
  revealRepoPath,
} from "./editor/repo-fs-ops";
import {
  assertSafeContractId,
  getWorktreePath,
  execGit,
  ensureTaskWorktree,
  DirtyWorktreeConfirmationRequiredError,
  WorktreeError,
} from "./git/worktree-manager";
import { ensureGitInit, inspectGitRepo } from "./git/ensure-git-repo";
import type { ChatAdapter } from "./chat/types";
import { BaselineChatAdapter } from "./chat/baseline-adapter";
import { DemoChatAdapter } from "./chat/demo-adapter";
import {
  CLAUDE_CODE_VERIFIED_ON,
  ClaudeCodeAdapter,
} from "./worker/cli-host/claude-code-adapter";
import {
  generateContractDraft,
  type DraftEnrichment,
} from "./supervisor/draft-generator";
import {
  SupervisorBudgetLedger,
  SUPERVISOR_BUDGET_ERROR_CODE,
} from "./supervisor/budget";
import { EnrichError } from "./supervisor/enrich-openai";
import type { SupervisorMessage } from "./supervisor/types";
import {
  acceptBaselineAsReference,
  getLatestBaseline,
  runProgressiveBaselineScan,
  writeBaselineArchive,
  newBaselineScanId,
  SCAN_PROGRESS_COPY,
  type BaselineArchive,
} from "./baseline";

export interface DaemonServerOptions extends PortFinderOptions {
  repoRoot: string;
  version?: string;
  autoShutdownSignals?: boolean;
  /** 启动取得 PID 锁后自动执行崩溃自愈扫描（TASK-A.6），默认开启 */
  enableCrashRecovery?: boolean;
  /** WebSocket 客户端首帧 AUTH 的超时毫秒数，超时未鉴权以 4401 断开（默认 5000） */
  authTimeoutMs?: number;
  /** 连接速率限制（TASK-D.1 G-12 防 DoS）：单 IP 在窗口内允许的新建连接数（默认 30） */
  maxConnectionsPerWindow?: number;
  /** 连接速率限制窗口毫秒数（默认 10_000） */
  connectionWindowMs?: number;
  /** 同时在线的最大 WS 客户端数（默认 64） */
  maxClients?: number;
  /** 右栏会话适配器（TASK-C.6）；缺省为 保底 + 演示 */
  chatAdapters?: ChatAdapter[];
  /**
   * 草案的 L1 白话补全器（可选）。
   * 不注入时 `/api/supervisor/draft` 走**纯 L0**：零模型调用、零费用，
   * 仍会产出白话理由（规则推导出的范围说明）。
   */
  supervisorEnrich?:
    | ((prompt: string) => Promise<DraftEnrichment> | DraftEnrichment)
    | undefined;
  /**
   * TASK-D.1b：覆盖控制台静态根目录（默认 resolveConsolePublicDir()）。
   * 传 `null` 显式关闭同源托管（测试用）。
   */
  consolePublicDir?: string | null;
  /**
   * TASK-J.10：意图编译器模型客户端（可替换）。
   * 缺省 / null → 离线兜底（V-06），不调用模型、不回流右栏。
   */
  intentCompilerModelClient?: IntentCompilerModelClient | null;
  /** TASK-J.10 测试注入：覆盖编译循环 setTimeout（跳过 1.2s 防抖） */
  intentCompilerSetTimeout?: (fn: () => void, ms: number) => unknown;
  intentCompilerClearTimeout?: (handle: unknown) => void;
}

export interface DaemonStatusResponse {
  status: "ok" | "stopping";
  version: string;
  pid: number;
  port: number;
  repoRoot: string;
  /** 主工作区真实检出的分支（P.1 顺手修：顶栏显示实际分支，不再硬编码 main） */
  currentBranch: string | null;
  uptime: number;
  activeContracts: string[];
}

export class StagentDaemon {
  readonly repoRoot: string;
  /** TASK-L.14：进程级保险库（启动时 hydrate） */
  private vault: Vault | null = null;
  readonly host: string;
  readonly version: string;
  readonly startPort: number;
  readonly endPort: number;
  readonly autoShutdownSignals: boolean;
  readonly enableCrashRecovery: boolean;
  readonly authTimeoutMs: number;
  readonly maxConnectionsPerWindow: number;
  readonly connectionWindowMs: number;
  readonly maxClients: number;

  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private sessionToken: string | null = null;
  /** TASK-D.1b：安装包 dist/public（同源控制台）；缺失则为 null，不托管 */
  private readonly consolePublicDir: string | null;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  /** 单 IP 新建连接的时间戳滑窗（速率限制） */
  private connectionWindows: Map<string, number[]> = new Map();
  private currentPort: number | null = null;
  private running: boolean = false;
  private stopping: boolean = false;
  private activeContracts: string[] = [];
  private signalCleanupFn: (() => void) | null = null;
  private lastRecoveryReport: RecoveryReport | null = null;
  private readonly orchestrator: ContractOrchestrator;
  /** TASK-C.7：Task Graph 权威引擎（Daemon 独占，唯一写手） */
  private readonly graphEngine: TaskGraphEngine;
  /** TASK-S.5：需求规范快照（懒加载，避免无关启动路径创建 specs 目录） */
  private requirementsStoreInstance: RequirementsStore | null = null;
  readonly chat: ChatSessionManager;
  private readonly supervisorEnrich:
    | ((prompt: string) => Promise<DraftEnrichment> | DraftEnrichment)
    | undefined;
  private worktreeWatcher: WorktreeWatcher | null = null;
  private invalidationEngine: EvidenceInvalidationEngine | null = null;
  /** 当前武装监听的合同（用于 abort 时精确解除，避免误停其他任务的监听） */
  private armedContractId: string | null = null;
  /** TASK-D.3：五类死锁自愈看门狗（D-1~D-5） */
  private readonly deadlock: DeadlockResilience;
  /** TASK-C.12b：STATE_CHANGED 的 session_epoch + state_seq */
  private readonly stateSeq = new SessionSeqTracker();
  /** 已发起停止、尚在回收中的合同（投影层据此呈现 STOPPING） */
  private readonly stoppingContracts: Set<string> = new Set();
  /**
   * TASK-D.3 / D-4：合并时检测到目标分支已前进的合同。
   * 投影层据此填 `target_branch_ahead`，前端呈现 CONFLICT 与二选一。
   * 在用户做出 merge-decision 之前一直保留；做出后清除。
   */
  private readonly targetAdvancedContracts: Set<string> = new Set();
  /** TASK-S.6b：合同 → 真机预览服务（自建或外链挂载） */
  private readonly realPreviews = new Map<string, RealPreviewServer>();
  /** TASK-L.5：合同 → Worktree 应用预览进程（与 realPreviews 配对回收） */
  private readonly appPreviews = new Map<string, AppPreviewHandle>();
  /** TASK-C.11b：当前隔离 Demo 预览（prototypes） */
  private demoPreviewServer: DemoPreviewServer | null = null;
  private activePrototypeId: string | null = null;
  private stopSweepFn: (() => void) | null = null;
  /** TASK-C.14：打开即扫的渐进基线（进行中 Promise，防重复扫） */
  private baselineScanInFlight: Promise<BaselineArchive> | null = null;
  /** TASK-J.10：意图编译器宿主（用户消息 → 方案补丁 CAS） */
  private intentCompilerHost: IntentCompilerHost | null = null;
  private readonly intentCompilerModelClient: IntentCompilerModelClient | null;
  private readonly intentCompilerSetTimeout:
    | ((fn: () => void, ms: number) => unknown)
    | undefined;
  private readonly intentCompilerClearTimeout:
    | ((handle: unknown) => void)
    | undefined;

  constructor(options: DaemonServerOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.consolePublicDir =
      options.consolePublicDir !== undefined
        ? options.consolePublicDir
        : resolveConsolePublicDir();
    this.host = options.host ?? "127.0.0.1";
    this.version = options.version ?? "0.1.0";
    // 规范 TASK-D.1：动态端口探测范围 3001~3010
    this.startPort = options.startPort ?? 3001;
    this.endPort = options.endPort ?? 3010;
    this.autoShutdownSignals = options.autoShutdownSignals ?? false;
    this.enableCrashRecovery = options.enableCrashRecovery ?? true;
    this.authTimeoutMs = options.authTimeoutMs ?? 5_000;
    this.maxConnectionsPerWindow = options.maxConnectionsPerWindow ?? 30;
    this.connectionWindowMs = options.connectionWindowMs ?? 10_000;
    this.maxClients = options.maxClients ?? 64;
    // §3.3：图状态由 Daemon 独占维护；每次变更都以全量快照广播给前端。
    // 订阅放在构造期而不是首个请求，保证"第一个连接建立前发生的变更"
    // 也能在后续连接拿到磁盘上的最新状态（getGraph 会读盘恢复）。
    this.graphEngine = new TaskGraphEngine({ repoRoot: this.repoRoot });
    this.graphEngine.subscribe((payload) => {
      this.broadcast("TASK_GRAPH_UPDATED", payload);
    });
    this.orchestrator = new ContractOrchestrator({
      repoRoot: this.repoRoot,
      // TASK-C.5：验证命令的逐行输出实时推给页面（脱敏在 runner 内完成）
      onTerminalLine: (contractId, stream, line) => {
        this.broadcast("TERMINAL_STREAM", {
          contract_id: contractId,
          stream,
          line,
        });
        try {
          appendWorkerTerminalLog(this.repoRoot, contractId, {
            source: "TERMINAL_STREAM",
            stream,
            lines: [line],
          });
        } catch {
          /* 日志失败不影响施工 */
        }
      },
      // TASK-W.4：运行时违规广播（能力漂移 / 未知通道 / 越界路径）
      onGatewayViolation: (violation) => {
        this.broadcast("GATEWAY_VIOLATION", violation);
      },
    });
    this.chat = new ChatSessionManager({
      repoRoot: this.repoRoot,
      adapters: options.chatAdapters ?? defaultChatAdapters(this.repoRoot),
      publish: (event) => {
        this.broadcast("CHAT_EVENT", event);
      },
    });
    this.supervisorEnrich = options.supervisorEnrich;
    this.intentCompilerModelClient =
      options.intentCompilerModelClient === undefined
        ? null
        : options.intentCompilerModelClient;
    this.intentCompilerSetTimeout = options.intentCompilerSetTimeout;
    this.intentCompilerClearTimeout = options.intentCompilerClearTimeout;

    // TASK-D.3：看门狗只做"判定 + 调用钩子"，真实动作仍由编排层执行。
    // 这样五类死锁的处置路径与既有控制面保持同一条事实源，不产生第二套状态机。
    this.deadlock = new DeadlockResilience({
      abortContract: async (contractId, reason) => {
        const aborted = await this.orchestrator.abort(contractId, {
          reviewer: "system:deadlock-watchdog",
          reason,
        });
        this.emitContractUpdate(aborted);
      },
      isWorktreeAlive: (contractId) =>
        fs.existsSync(getWorktreePath(this.repoRoot, contractId)),
      healResume: async (contractId) => {
        const healed = await this.orchestrator.healResume(contractId);
        this.emitContractUpdate(healed);
      },
      writeTimeoutEvidence: async (contractId, info) => {
        await this.orchestrator.recordCommandTimeout(contractId, info);
      },
      // D-1 / D-5 共用同一条进程树回收路径（SIGTERM → 宽限 → SIGKILL）
      killProcessTree: async (_contractId, pid) => {
        if (pid === null) return;
        await killProcessTree(pid, { graceMs: 3_000 });
      },
      // D-2 回收只删锁文件本身：绝不触碰合同、证据或工作树。
      // 白名单式的路径判定（必须在 <repoRoot>/.stagent/locks/ 下且以 .lock 结尾），
      // 避免看门狗被任何一条异常记录"带偏"去删业务文件。
      releaseResource: (resource) => {
        if (!isContractLockResource(this.repoRoot, resource)) return;
        try {
          fs.rmSync(path.resolve(resource), { force: true });
        } catch {
          // 锁文件可能已被持有者释放
        }
      },
      onEvent: (event) => {
        // 死锁处置属安全事件：复用既有告警帧，控制台无需新增订阅
        this.broadcast("GATEWAY_VIOLATION", {
          source: "deadlock-watchdog",
          action: event.code,
          ...(event.contract_id === undefined
            ? {}
            : { contract_id: event.contract_id }),
          message: event.detail,
        });
      },
    });

    // D-2：把同一张租约表交给互斥锁层（全局注册，避免每个调用点各自持表）
    setContractLockLeaseObserver(this.deadlock);
    // D-5：命令执行在 Gateway 内，需由编排层把看门狗透传进去
    this.orchestrator.setDeadlock(this.deadlock);
  }

  /** 最近一次启动时的崩溃自愈报告（便于状态端点与测试观测） */
  getRecoveryReport(): RecoveryReport | null {
    return this.lastRecoveryReport;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get port(): number | null {
    return this.currentPort;
  }

  get pid(): number {
    return process.pid;
  }

  /**
   * Start the Stagent Daemon:
   * 1. Dynamically finds an available port in the specified range (3001..3010)
   * 2. Acquires single-instance repository PID lock
   * 3. Starts HTTP listener with health check and graceful shutdown endpoints
   */
  async start(): Promise<{ port: number; pid: number }> {
    if (this.running) {
      throw new Error(
        `Stagent daemon is already running on port ${this.currentPort}`,
      );
    }

    const port = await findAvailablePort({
      startPort: this.startPort,
      endPort: this.endPort,
      host: this.host,
    });

    await acquirePidLock(this.repoRoot, port, {
      version: this.version,
    });

    // 规范 TASK-A.6 PASS-1：取得 PID 锁后自动扫描并自愈悬空合同
    if (this.enableCrashRecovery) {
      try {
        this.lastRecoveryReport = await recoverDaemonState({
          repoRoot: this.repoRoot,
        });
      } catch (err) {
        // 自愈失败不得阻止 Daemon 启动；错误在报告中留痕
        this.lastRecoveryReport = {
          scannedContracts: 0,
          scannedEvidence: 0,
          records: [],
          orphanWorktrees: [],
          pruned: false,
          errors: [(err as Error).message],
          cleanedLocks: [],
          retainedLocks: [],
        };
      }
    }

    // 规范 TASK-D.1 PASS-2：单次随机会话 Token，独立于 PID 文件
    this.sessionToken = createSessionToken(this.repoRoot);

    // TASK-L.14：启动时挂载凭据保险库（钥匙串优先，否则加密文件；测可设 STAGENT_VAULT_BACKEND）
    try {
      this.vault = await createVault({ repoRoot: this.repoRoot });
      setActiveVault(this.vault);
    } catch (err) {
      // 保险库失败不挡 Daemon 启动；HTTP 写接口会报错
      this.vault = null;
      setActiveVault(null);
      try {
        appendDaemonLog(this.repoRoot, {
          level: "warn",
          kind: "vault_init_failed",
          detail: { message: (err as Error).message },
        });
      } catch {
        /* ignore */
      }
    }

    // 规范 TASK-D.1 G-12：单连接帧大小硬上限 2MB（ws 超限自动以 1009 关闭）
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_FRAME_BYTES,
    });
    this.wss.on("connection", (ws) => {
      this.handleConnection(ws);
    });

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // Upgrade 阶段仅校验 Origin；Token 校验移至连接后第一帧 AUTH
    // （浏览器 WebSocket API 无法设置 Authorization 头，query 传 Token 会泄漏进日志）
    this.server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket as import("node:net").Socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error("Server instance missing"));
        return;
      }

      this.server.once("error", (err) => {
        reject(err);
      });

      this.server.listen(
        {
          port,
          host: this.host,
        },
        () => {
          resolve();
        },
      );
    });

    this.currentPort = port;
    this.running = true;
    this.stopping = false;
    // TASK-D.3：1s 粒度的死锁扫描；判据最小为 15s，无需更高精度
    this.stopSweepFn = this.deadlock.startAutoSweep(1_000);
    // TASK-C.14b：打开即自动扫（零弹窗；失败不挡启动）
    void this.ensureBaselineScan().catch(() => undefined);

    // 服务端心跳守护：超过 30s 无任何帧的客户端强制断开
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        const lastSeen = (client as WebSocket & { lastSeen?: number }).lastSeen;
        if (lastSeen && Date.now() - lastSeen > 30_000) {
          client.terminate();
        }
      }
    }, 15_000);
    this.heartbeatTimer.unref?.();

    if (this.autoShutdownSignals) {
      this.installSignalHandlers();
    }

    return { port, pid: process.pid };
  }

  /**
   * Gracefully stop the daemon:
   * 1. Closes HTTP server
   * 2. Releases PID lock
   * 3. Cleans up OS signal handlers
   */
  async stop(): Promise<void> {
    // TASK-L.14：卸下进程级保险库
    this.vault = null;
    setActiveVault(null);
    if (!this.running || this.stopping) {
      return;
    }
    this.stopping = true;
    // TASK-D.3：停机时先撤掉扫描，避免看门狗在关闭过程中触发新的流转
    this.stopSweepFn?.();
    this.stopSweepFn = null;

    // TASK-L.5 / S.6b：回收应用预览进程组 + 真机预览服务
    for (const [id, app] of [...this.appPreviews.entries()]) {
      try {
        await stopAppPreview(app);
      } catch {
        // 停机路径尽最大努力
      }
      this.appPreviews.delete(id);
    }
    for (const [id, srv] of [...this.realPreviews.entries()]) {
      try {
        await srv.stop();
      } catch {
        // 停机路径尽最大努力
      }
      this.realPreviews.delete(id);
    }

    if (this.signalCleanupFn) {
      this.signalCleanupFn();
      this.signalCleanupFn = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await this.stopEvidenceWatcher();
    if (this.intentCompilerHost) {
      this.intentCompilerHost.dispose();
      this.intentCompilerHost = null;
    }
    await this.chat.shutdown();

    for (const client of this.clients) {
      try {
        client.close(1001, "daemon stopping");
      } catch {
        client.terminate();
      }
    }
    this.clients.clear();
    this.connectionWindows.clear();
    this.wss?.close();
    this.wss = null;
    clearSessionToken(this.repoRoot);
    this.sessionToken = null;

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          resolve();
        });
      });
      this.server = null;
    }

    await releasePidLock(this.repoRoot);

    this.running = false;
    this.stopping = false;
    this.currentPort = null;
  }

  /** 供 CLI / 测试读取本次会话 Token（服务端内存值） */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * TASK-J.10：懒创建意图编译宿主。
   * 生产路径由 {@link handleSupervisorJourney} 在用户消息落盘后调用
   * {@link IntentCompilerHost.commitUserTurn}。
   */
  private ensureIntentCompilerHost(): IntentCompilerHost {
    if (this.intentCompilerHost) return this.intentCompilerHost;
    this.intentCompilerHost = createIntentCompilerHost({
      repoRoot: this.repoRoot,
      modelClient: this.intentCompilerModelClient,
      ...(this.intentCompilerSetTimeout === undefined
        ? {}
        : { setTimeoutFn: this.intentCompilerSetTimeout }),
      ...(this.intentCompilerClearTimeout === undefined
        ? {}
        : { clearTimeoutFn: this.intentCompilerClearTimeout }),
      onLog: (entry) => {
        try {
          appendDaemonLog(this.repoRoot, {
            kind: "intent_compiler",
            detail: entry,
          });
        } catch {
          /* 日志失败不影响编译 */
        }
      },
    });
    return this.intentCompilerHost;
  }

  /** @internal 测试：冲洗防抖并等待编译循环空闲 */
  async flushIntentCompilerForTest(): Promise<void> {
    if (!this.intentCompilerHost) return;
    await this.intentCompilerHost.flushForTest();
  }

  /** @internal 测试：读取编译循环统计 */
  getIntentCompilerStatsForTest(): CompilerLoopStats | null {
    return this.intentCompilerHost?.getStats() ?? null;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  /** 广播任意协议帧（仅已鉴权客户端），返回成功发送的客户端数 */
  broadcast<T>(type: IpcFrameType, payload?: T): number {
    if (!this.wss) return 0;
    const frame = createFrame(type, payload);
    const serialized = JSON.stringify(frame);
    let sent = 0;
    for (const client of this.clients) {
      const tracked = client as WebSocket & { authenticated?: boolean };
      if (tracked.authenticated !== true) continue;
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
        sent += 1;
      }
    }
    return sent;
  }

  /** 日志流式推送（分片 + 有界截断，PASS-5）；TASK-C.17 同步有界落盘 */
  emitWorkerLog(contractId: string, lines: string[]): number {
    try {
      appendWorkerTerminalLog(this.repoRoot, contractId, {
        source: "WORKER_LOG",
        stream: "worker",
        lines,
      });
    } catch {
      /* 日志失败不影响施工 */
    }
    let sent = 0;
    for (const chunk of chunkWorkerLog(contractId, lines)) {
      sent += this.broadcast("WORKER_LOG", chunk);
    }
    return sent;
  }

  /**
   * 合同状态变更广播（Track C）。
   * 客户端据此立即刷新，无需等待下一轮轮询 —— 状态机是推的，不是拉的。
   */
  emitContractUpdate(contract: SoftwareContract): number {
    const sent = this.broadcast("CONTRACT_UPDATE", {
      contract_id: contract.contract_id,
      lifecycle_state: contract.lifecycle_state,
      approval_status: contract.approval?.status,
    });
    // CONTRACT_UPDATE 是既有帧；STATE_CHANGED 才是"前端零逻辑"的权威帧
    this.publishPresentationState(contract);
    return sent;
  }

  /**
   * TASK-D.3：投影 → 落盘 → 广播。
   *
   * 顺序不可颠倒：先落盘再广播，保证"前端收到状态"与"重连能读回"是同一份事实。
   * 若当前信息不足以给出确定性展示态（projectContract 返回 null），
   * 不广播也不落盘——宁可让界面停在上一帧，也不给用户一个错误的进度。
   */
  private publishPresentationState(
    contract: SoftwareContract,
    signals?: DaemonRuntimeSignals,
  ): number {
    const contractId = contract.contract_id;

    if (contract.lifecycle_state === "PENDING_RESUME") {
      this.deadlock.watchResume(contractId);
    } else {
      this.deadlock.unwatchResume(contractId);
    }

    const record = projectContract(
      contract,
      signals ?? {
        stopping_requested: this.stoppingContracts.has(contractId),
        evidence: readLatestEvidenceSignal(this.repoRoot, contractId),
        target_branch_ahead: this.targetAdvancedContracts.has(contractId),
        real_preview_running: this.isRealPreviewRunning(contractId),
      },
    );
    if (!record) return 0;

    persistPresentation(this.repoRoot, record);
    const seq = this.stateSeq.next();
    const demo = readDemoConfirm(this.repoRoot);
    return this.broadcast(
      "STATE_CHANGED",
      toStateChangedPayload(record, {
        seq,
        demo_confirmed: demo?.confirmed === true,
        demo_mode: demo?.demo_mode ?? null,
        // TASK-J.8：表外组合写 daemon.jsonl 告警（沿用 C.17 日志），不进前端载荷
        on_journey_warning: (warning, input) =>
          appendDaemonLog(this.repoRoot, {
            level: "warn",
            kind: "journey_stage",
            contractId,
            code: warning,
            detail: {
              delivery_state: input.delivery_state,
              transient: input.transient,
              lifecycle_state: input.lifecycle_state,
              presentation_state: input.presentation_state,
            },
          }),
      }),
    );
  }

  /** 断线重连/重启后，从 `.stagent/state.json` 还原全部展示态 */
  replayPresentationState(ws: WebSocket): number {
    const snapshot = loadPresentationSnapshot(this.repoRoot);
    let sent = 0;
    for (const record of Object.values(snapshot.contracts)) {
      if (ws.readyState !== WebSocket.OPEN) break;
      {
        const seq = this.stateSeq.next();
        const demo = readDemoConfirm(this.repoRoot);
        ws.send(
          JSON.stringify(
            createFrame(
              "STATE_CHANGED",
              toStateChangedPayload(record, {
                seq,
                demo_confirmed: demo?.confirmed === true,
                demo_mode: demo?.demo_mode ?? null,
              }),
            ),
          ),
        );
      }
      sent += 1;
    }
    return sent;
  }

  /** 供 `GET /api/state` 读取（也便于测试断言落盘结果） */
  getPresentationSnapshot(): ReturnType<typeof loadPresentationSnapshot> {
    return loadPresentationSnapshot(this.repoRoot);
  }

  /** 供测试/诊断：看门狗当前积压的条目 */
  getDeadlockPending(): ReturnType<DeadlockResilience["pendingCounts"]> {
    return this.deadlock.pendingCounts();
  }

  /**
   * Demo 预览生命周期广播（TASK-S.4 / §6.1）。
   * 预览服务只负责报告事件，由这里决定广播给已鉴权客户端。
   */
  emitDemoPreviewStatus(payload: DemoPreviewStatusPayload): number {
    return this.broadcast("DEMO_PREVIEW_STATUS", payload);
  }

  /**
   * 创建与 Daemon 广播绑定的 Demo 预览服务。
   *
   * 生命周期事件自动转成 `DEMO_PREVIEW_STATUS` 帧，前端不必轮询端口；
   * 调用方仍可挂自己的回调（例如写日志），不会被覆盖。
   */
  createDemoPreview(
    rootDir: string,
    options: Omit<DemoPreviewServerOptions, "rootDir" | "onStatusChange"> & {
      onStatusChange?: (payload: DemoPreviewStatusPayload) => void;
    } = {},
  ): DemoPreviewServer {
    return createDemoPreviewServer({
      ...options,
      rootDir,
      onStatusChange: (payload) => {
        this.emitDemoPreviewStatus(payload);
        options.onStatusChange?.(payload);
      },
    });
  }

  emitRealPlaytestStatus(payload: RealPlaytestStatusPayload): number {
    return this.broadcast("REAL_PLAYTEST_STATUS", payload);
  }

  isRealPreviewRunning(contractId: string): boolean {
    const srv = this.realPreviews.get(contractId);
    return srv?.handle !== null && srv?.handle !== undefined;
  }

  /**
   * TASK-S.6b / L.5：启动或挂载真机预览。
   * 优先在 Worktree 里跑用户应用（dev→start→preview）；否则静态目录；
   * 再没有则返回白话失败，不再默写占位桩（显式 stub:true 除外）。
   */
  async startRealPlaytest(input: {
    contractId: string;
    attachUrl?: string | undefined;
    rootDir?: string | undefined;
    worktreeDir?: string | undefined;
    /** 无业务产物时写一页白话桩（产品壳走通） */
    stub?: boolean | undefined;
    title?: string | undefined;
  }): Promise<RealPlaytestStatusPayload> {
    const contractId = input.contractId.trim();
    if (!contractId) {
      throw new Error("[E_REAL_PREVIEW_NO_CONTRACT] contract_id 不能为空");
    }
    await this.stopRealPlaytest(contractId);

    // 1) 显式外链挂载
    if (input.attachUrl) {
      return this.mountRealPreviewServer(contractId, {
        attachUrl: input.attachUrl,
      });
    }

    // 2) 显式静态根
    if (input.rootDir) {
      return this.mountRealPreviewServer(contractId, {
        rootDir: input.rootDir,
      });
    }

    // 3) 显式桩页
    if (input.stub === true) {
      const rootDir = path.join(
        this.repoRoot,
        ".stagent",
        "real-preview",
        contractId,
      );
      writeRealPlaytestStub(rootDir, input.title ?? "真机试玩");
      return this.mountRealPreviewServer(contractId, { rootDir });
    }

    // 4) TASK-L.5：Worktree 真实应用 / 静态回退
    const worktreeDir =
      input.worktreeDir ??
      (() => {
        try {
          return getWorktreePath(this.repoRoot, contractId);
        } catch {
          return null;
        }
      })();

    if (worktreeDir && fs.existsSync(worktreeDir)) {
      const picked = pickPreviewCommand(worktreeDir);
      if (picked) {
        let port: number;
        try {
          port = await findAvailablePort({
            host: "127.0.0.1",
            startPort: REAL_PREVIEW_PORT_RANGE.start,
            endPort: REAL_PREVIEW_PORT_RANGE.end,
          });
        } catch (err) {
          const message = `[E_REAL_PREVIEW_UNAVAILABLE] ${
            err instanceof Error ? err.message : "no port"
          }`;
          const payload: RealPlaytestStatusPayload = {
            contract_id: contractId,
            url: "",
            port: 0,
            status: "ERROR",
            owned: false,
            message,
            updated_at: new Date().toISOString(),
          };
          this.emitRealPlaytestStatus(payload);
          return payload;
        }

        const app = await startAppPreview({ worktreeDir, port });
        const ready = await waitReady(port, {
          getStderr: () => app.stderr(),
        });
        if (!ready.ready) {
          await stopAppPreview(app);
          const stderrTail = ready.stderrTail.trim();
          const message = stderrTail
            ? `预览没能在时限内就绪。\n${stderrTail}`
            : "预览没能在时限内就绪。";
          const payload: RealPlaytestStatusPayload = {
            contract_id: contractId,
            url: "",
            port,
            status: "ERROR",
            owned: false,
            message,
            updated_at: new Date().toISOString(),
          };
          this.emitRealPlaytestStatus(payload);
          return payload;
        }

        this.appPreviews.set(contractId, app);
        return this.mountRealPreviewServer(contractId, {
          attachUrl: app.url,
        });
      }

      const staticRoot = findStaticPreviewRoot(worktreeDir);
      if (staticRoot) {
        return this.mountRealPreviewServer(contractId, {
          rootDir: staticRoot,
        });
      }

      const payload: RealPlaytestStatusPayload = {
        contract_id: contractId,
        url: "",
        port: 0,
        status: "ERROR",
        owned: false,
        message: NO_PREVIEW_PLAIN_MESSAGE,
        updated_at: new Date().toISOString(),
      };
      this.emitRealPlaytestStatus(payload);
      return payload;
    }

    // 5) 无 Worktree：保留产品壳桩页（兼容 S.6b 无业务仓库走通）
    const rootDir = path.join(
      this.repoRoot,
      ".stagent",
      "real-preview",
      contractId,
    );
    writeRealPlaytestStub(rootDir, input.title ?? "真机试玩");
    return this.mountRealPreviewServer(contractId, { rootDir });
  }

  private async mountRealPreviewServer(
    contractId: string,
    options: { rootDir?: string; attachUrl?: string },
  ): Promise<RealPlaytestStatusPayload> {
    const server = createRealPreviewServer({
      contractId,
      ...(options.rootDir === undefined ? {} : { rootDir: options.rootDir }),
      ...(options.attachUrl === undefined
        ? {}
        : { attachUrl: options.attachUrl }),
      onStatusChange: (payload) => {
        this.emitRealPlaytestStatus(payload);
      },
    });
    const handle = await server.start();
    this.realPreviews.set(contractId, server);

    const contract = this.orchestrator.getStore().get(contractId);
    if (
      contract &&
      contract.lifecycle_state === "AUDITED" &&
      contract.approval.status === "APPROVED"
    ) {
      this.publishPresentationState(contract, {
        stopping_requested: this.stoppingContracts.has(contractId),
        evidence: readLatestEvidenceSignal(this.repoRoot, contractId),
        target_branch_ahead: this.targetAdvancedContracts.has(contractId),
        real_preview_running: true,
      });
    }

    return {
      contract_id: contractId,
      url: handle.url,
      port: handle.port,
      status: "RUNNING",
      owned: handle.owned,
      updated_at: new Date().toISOString(),
    };
  }

  async stopRealPlaytest(
    contractId: string,
  ): Promise<RealPlaytestStatusPayload> {
    const id = contractId.trim();
    const app = this.appPreviews.get(id);
    if (app) {
      try {
        await stopAppPreview(app);
      } catch {
        // 回收尽最大努力
      }
      this.appPreviews.delete(id);
    }
    const server = this.realPreviews.get(id);
    const prev = server?.handle;
    if (server) {
      await server.stop();
      this.realPreviews.delete(id);
    }
    const contract = this.orchestrator.getStore().get(id);
    if (contract) {
      this.publishPresentationState(contract, {
        stopping_requested: this.stoppingContracts.has(id),
        evidence: readLatestEvidenceSignal(this.repoRoot, id),
        target_branch_ahead: this.targetAdvancedContracts.has(id),
        real_preview_running: false,
      });
    }
    return {
      contract_id: id,
      url: prev?.url ?? "",
      port: prev?.port ?? 0,
      status: "STOPPED",
      owned: prev?.owned ?? false,
      updated_at: new Date().toISOString(),
    };
  }

  /** Evidence 生成广播：携带结论，供控制台决定是否点亮「核销」 */
  emitEvidenceReady(contractId: string, evidence: EvidenceBundle): number {
    return this.broadcast("EVIDENCE_READY", {
      contract_id: contractId,
      evidence_id: evidence.evidence_id,
      verdict: evidence.verdict.status,
      can_merge: evidence.verdict.can_merge,
    });
  }

  private rejectUpgrade(
    socket: import("node:net").Socket,
    status: number,
    message: string,
  ): void {
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  }

  private handleUpgrade(
    req: http.IncomingMessage,
    socket: import("node:net").Socket,
    head: Buffer,
  ): void {
    // Host 头必须是回环地址（DNS Rebinding 防线：重绑定后请求不带 Origin，
    // 唯一可靠的判别是 Host 头）
    if (!isLocalHostAuthority(req.headers.host)) {
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    // Origin 校验仍在 Upgrade 阶段硬阻断（防跨站 WS 劫持）
    const origin = req.headers.origin;
    // Demo 预览来源额外拦截：sandbox iframe 的 "null" 源与 4100~4110 端口
    if (isDemoPreviewOrigin(origin) || isRealPreviewOrigin(origin)) {
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (!isLocalOrigin(origin)) {
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    // 连接速率限制（G-12 防 DoS）：单 IP 滑窗计数，超限拒绝
    const remote = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const windowStart = now - this.connectionWindowMs;
    const recent = (this.connectionWindows.get(remote) ?? []).filter(
      (t) => t >= windowStart,
    );
    if (recent.length >= this.maxConnectionsPerWindow) {
      this.connectionWindows.set(remote, recent);
      this.rejectUpgrade(socket, 429, "Too Many Requests");
      return;
    }
    recent.push(now);
    this.connectionWindows.set(remote, recent);

    // 并发客户端总数上限
    if (this.clients.size >= this.maxClients) {
      this.rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    // 注意：此处不再读取 Authorization 头或 ?token= query。
    // 浏览器原生 WebSocket 无法携带自定义头；query 中的 Token 会进入
    // 访问日志与历史记录。鉴权统一在连接建立后的第一帧 AUTH 完成，
    // 失败 / 超时均以 4401（WS_CLOSE_UNAUTHORIZED）断开。
    if (!this.wss) {
      this.rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss?.emit("connection", ws, req);
    });
  }

  private handleConnection(ws: WebSocket): void {
    type TrackedSocket = WebSocket & {
      lastSeen?: number;
      authenticated?: boolean;
    };
    const tracked = ws as TrackedSocket;
    this.clients.add(ws);
    tracked.lastSeen = Date.now();
    tracked.authenticated = false;

    const sendError = (code: string, message: string): void => {
      ws.send(JSON.stringify(createFrame("ERROR", { code, message })));
    };
    const rejectUnauthorized = (reason: string): void => {
      sendError("E_UNAUTHORIZED", reason);
      ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
    };

    // 首帧 AUTH 超时：未在时限内完成鉴权即断开
    const authTimer = setTimeout(() => {
      if (!tracked.authenticated) {
        rejectUnauthorized("AUTH frame required within auth timeout");
      }
    }, this.authTimeoutMs);
    authTimer.unref?.();

    ws.on("message", (raw) => {
      tracked.lastSeen = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sendError("INVALID_FRAME", "Frame must be valid JSON");
        if (!tracked.authenticated) {
          ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
        }
        return;
      }

      if (!isIpcFrame(parsed)) {
        sendError("UNKNOWN_FRAME_TYPE", "Unsupported frame type");
        if (!tracked.authenticated) {
          ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
        }
        return;
      }

      // 未鉴权连接：唯一合法帧是 AUTH，其余一律以 4401 断开
      if (!tracked.authenticated) {
        if (parsed.type !== "AUTH") {
          rejectUnauthorized("First frame must be AUTH");
          return;
        }
        const payload = parsed.payload as Partial<AuthPayload> | undefined;
        const token = typeof payload?.token === "string" ? payload.token : null;
        if (!verifySessionToken(token, this.sessionToken)) {
          rejectUnauthorized("Invalid session token");
          return;
        }
        tracked.authenticated = true;
        clearTimeout(authTimer);
        ws.send(JSON.stringify(createFrame("AUTH_OK")));
        // TASK-D.3：鉴权通过即回放持久化展示态，前端无需再拉一次接口
        this.replayPresentationState(ws);
        return;
      }

      // 已鉴权连接：帧方向门禁（§6.1 帧字典的收发方约束）。
      // 客户端只允许发送 direction 含 client->server 的帧（PING、CHAT_EVENT），
      // 伪造 server->client 帧（如 PONG / CONTRACT_UPDATE）拒绝并保持连接。
      if (!isClientToServerAllowed(parsed.type)) {
        sendError(
          "FRAME_DIRECTION_FORBIDDEN",
          `Frame type ${parsed.type} is server->client only`,
        );
        return;
      }

      // 规范 PASS-4：客户端每 5s 发送 PING，服务端立即回 PONG
      if (parsed.type === "PING") {
        ws.send(JSON.stringify(createFrame("PONG")));
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      this.clients.delete(ws);
    });
    ws.on("error", () => {
      clearTimeout(authTimer);
      this.clients.delete(ws);
    });
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    // HTTP API 仅接受 Authorization: Bearer（非浏览器客户端可用）。
    // 绝不接受 ?token= query（规范 TASK-D.1 FAIL：query 会进入访问日志与浏览器历史）
    const authHeader = req.headers.authorization;
    const headerToken =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : null;
    return verifySessionToken(headerToken, this.sessionToken);
  }

  private readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let raw = "";
      const limit = 1024 * 1024;
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf-8");
        if (raw.length > limit) {
          reject(new Error("Request body exceeds 1 MiB limit"));
          req.destroy();
        }
      });
      req.on("end", () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    body: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  /**
   * 合同动作错误统一出口：并发/状态冲突映射 409（Conflict），
   * 其余仍为 400。错误码随响应回传，便于控制台区分「前置条件不足」与「手慢了」。
   */
  private sendActionError(res: http.ServerResponse, err: unknown): void {
    const error = err as Error & { code?: string };
    const conflict =
      error?.code === "E_INVALID_STATE_TRANSITION" ||
      error?.code === "E_CONCURRENT_OPERATION" ||
      error?.code === "E_ILLEGAL_NODE_TRANSITION" ||
      error?.code === "E_UPSTREAM_NOT_ILLUMINATED" ||
      error?.code === "E_REPLAY_CONFLICT";
    this.sendJson(res, conflict ? 409 : 400, {
      error: error?.message ?? String(err),
      ...(error?.code === undefined ? {} : { code: error.code }),
    });
  }

  /**
   * 验证通过后启动活跃 Worktree 监听：外部改动 → Evidence STALE（TASK-B.2）。
   */
  private async armEvidenceWatcher(
    contractId: string,
    evidenceId: string,
  ): Promise<void> {
    await this.stopEvidenceWatcher();
    const worktreePath = path.join(
      this.repoRoot,
      ".stagent",
      "worktrees",
      `task-${contractId}`,
    );
    const evidencePath = path.join(
      this.repoRoot,
      ".stagent",
      "evidence",
      `${contractId}-${evidenceId}.json`,
    );
    if (!fs.existsSync(evidencePath)) return;

    const engine = new EvidenceInvalidationEngine(worktreePath);
    engine.register(contractId, evidencePath);
    this.invalidationEngine = engine;

    const watcher = new WorktreeWatcher({
      worktreePath,
      onChange: (changed) => {
        const results = engine.handleChanges(changed);
        // TASK-C.7 §3.4：外部改码不只让 Evidence 失效，也要把相关节点
        // 由绿变灰（STALE_REVERIFY）；这是 Node 级与 Evidence 级的同源降级。
        this.graphEngine.markStale(changed);
        for (const hit of results) {
          if (!hit.stale) continue;
          // 规范 §6.1 帧：证据失效的权威通知通道
          this.broadcast("EVIDENCE_STATUS_CHANGED", {
            contract_id: hit.contractId,
            evidence_id: evidenceId,
            status: "STALE",
            reason_code: "EVIDENCE_STALE",
            message:
              "Worktree changed after verification; evidence marked STALE and merge disabled",
          });
          // 历史扩展帧：保留至 C.x 完成迁移（协议"至少包括"允许扩展帧并存）
          this.broadcast("SCOPE_ALERT", {
            contract_id: hit.contractId,
            code: "E_EVIDENCE_STALE",
            message:
              "Worktree changed after verification; evidence marked STALE and merge disabled",
          });
        }
      },
    });
    watcher.start();
    this.worktreeWatcher = watcher;
    this.armedContractId = contractId;
  }

  private async stopEvidenceWatcher(): Promise<void> {
    await this.worktreeWatcher?.stop();
    this.worktreeWatcher = null;
    this.invalidationEngine = null;
    this.armedContractId = null;
  }

  private fileContext(
    contractId: string | null | undefined,
  ): FileAccessContext {
    if (!contractId) {
      return { repoRoot: this.repoRoot, contract: null, worktreePath: null };
    }
    const contract = this.orchestrator.getStore().get(contractId);
    if (!contract) throw new Error(`contract not found: ${contractId}`);
    const worktreePath = getWorktreePath(this.repoRoot, contractId);
    if (!fs.existsSync(worktreePath)) throw new Error("合同 Worktree 不存在");
    return { repoRoot: this.repoRoot, contract, worktreePath };
  }

  /**
   * Zero-Tool 只读守卫：取一次**已跟踪文件**的工作区状态指纹。
   *
   * 只看已跟踪文件（`--untracked-files=no`）是有意为之：
   * - Supervisor 账本目录 `.stagent/` 是未跟踪的运行时状态，不应因此误判；
   * - 真正要防的是"草案生成顺手改了业务代码"。
   * 非 git 目录 / git 不可用时返回 null（诊断失败不阻断主流程）。
   */
  private repoStatusFingerprint(): string | null {
    try {
      return execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        {
          cwd: this.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      return null;
    }
  }

  /**
   * `POST /api/supervisor/draft` —— 按需生成合同草案（L0 规则 / 可选 L1 补全）。
   *
   * 三条硬约束（本函数的存在理由）：
   * 1. **零落盘**：草案只回给前端，**不写** `.stagent/contracts`、不建 Worktree、
   *    不碰 git。用 `git status` 的前后指纹做运行时守卫，真被写脏就 500 并拒发草案。
   * 2. **独立账本**：费用只记 `SupervisorBudgetLedger.independent()`
   *    （`.stagent/supervisor-budget.json`），绝不碰 Worker 的合同账本；
   *    账本已熔断时返回 402 `BUDGET_EXHAUSTED`。
   * 3. **Zero-Tool**：不调用任何特权动作（批准 / 合并 / 执行命令）——
   *    这里连 orchestrator 都不 import 使用。
   */
  /**
   * TASK-C.22 / SSOT v2.0.2 §5.2.1：确认方案不可变快照。
   * POST /api/supervisor/scheme/freeze
   * GET  /api/supervisor/scheme/freeze?confirmation_id=...
   */
  private async handleSchemeSnapshot(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    parsedUrl: URL,
  ): Promise<void> {
    if (method === "GET") {
      const confirmationId =
        parsedUrl.searchParams.get("confirmation_id") ?? "";
      const snapshot = readSchemeSnapshot(this.repoRoot, confirmationId);
      if (!snapshot) {
        this.sendJson(res, 404, {
          error: "scheme_snapshot_not_found",
          code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
        });
        return;
      }
      this.sendJson(res, 200, { snapshot });
      return;
    }
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    let body: {
      confirmation_id?: unknown;
      scheme?: unknown;
      demo?: unknown;
      decision?: unknown;
      scope_plan?: unknown;
    };
    try {
      body = (await this.readJsonBody(req)) as typeof body;
    } catch (err) {
      this.sendJson(res, 400, {
        error: "invalid_json",
        message: (err as Error).message,
      });
      return;
    }

    const confirmationId =
      typeof body.confirmation_id === "string" ? body.confirmation_id : "";
    const scheme = body.scheme as Record<string, unknown> | undefined;
    const demo = body.demo as Record<string, unknown> | undefined;
    const decision = body.decision as Record<string, unknown> | undefined;
    const validDemoStatuses = new Set([
      "none",
      "building",
      "ready",
      "failed",
      "degraded_flowcard",
    ]);
    if (
      !scheme ||
      typeof scheme["scheme_id"] !== "string" ||
      typeof scheme["scheme_revision"] !== "number" ||
      !Number.isInteger(scheme["scheme_revision"]) ||
      scheme["scheme_revision"] < 1 ||
      !demo ||
      typeof demo["status"] !== "string" ||
      !validDemoStatuses.has(demo["status"]) ||
      !decision ||
      typeof decision["code"] !== "string" ||
      typeof decision["message"] !== "string" ||
      !["none", "interactive", "degraded"].includes(
        String(decision["demo_mode"]),
      )
    ) {
      this.sendJson(res, 400, {
        error: "invalid_scheme_snapshot",
        code: "E_SCHEME_SNAPSHOT_INVALID",
        message: "scheme / demo / decision 字段不完整",
      });
      return;
    }

    const scopePlanRaw = body.scope_plan;
    if (
      !scopePlanRaw ||
      typeof scopePlanRaw !== "object" ||
      typeof (scopePlanRaw as { plan_digest?: unknown }).plan_digest !==
        "string" ||
      !(scopePlanRaw as { plan_digest: string }).plan_digest
    ) {
      this.sendJson(res, 400, {
        error: "invalid_scheme_snapshot",
        code: "E_SCHEME_SNAPSHOT_INVALID",
        message: "scope_plan 必填（含 plan_digest）",
      });
      return;
    }
    const submittedPlan = scopePlanRaw as ScopePlan;

    try {
      const schemeDraft =
        scheme as unknown as import("../src/lib/journey/scheme-draft").SchemeDraft;
      const freshPlan = assertScopePlanFreshForFreeze({
        repoRoot: this.repoRoot,
        scheme: schemeDraft,
        submitted: submittedPlan,
      });
      // TASK-J.18b / GAP-W2：冻结时从账本拷贝完整墓地（含 revived）进快照 1.2
      const ledgerGraveyard = loadOrInitLedgerState(this.repoRoot).graveyard;
      const written = writeSchemeSnapshot(this.repoRoot, {
        confirmation_id: confirmationId,
        scheme: schemeDraft,
        demo: demo as unknown as import("../src/lib/journey/scheme-draft").DemoGate,
        decision: {
          code: decision["code"] as string,
          message: decision["message"] as string,
          demo_mode: decision["demo_mode"] as
            "none" | "interactive" | "degraded",
        },
        scope_plan: freshPlan,
        graveyard: ledgerGraveyard,
      });
      this.sendJson(res, written.idempotent ? 200 : 201, {
        snapshot_id: written.snapshot.snapshot_id,
        digest: written.snapshot.digest,
        idempotent: written.idempotent,
      });
    } catch (err) {
      if (err instanceof ScopePlanDriftError) {
        this.sendJson(res, 409, {
          error: "scope_plan_drift",
          code: err.code,
          message: err.message,
          scope_plan: err.scope_plan,
        });
        return;
      }
      if (err instanceof SchemeSnapshotConflictError) {
        this.sendJson(res, 409, {
          error: "scheme_confirmation_conflict",
          code: err.code,
          message: err.message,
        });
        return;
      }
      this.sendActionError(res, err);
    }
  }

  /**
   * TASK-J.4：范围预检。只读、零模型、零落盘；鉴权同 /api/supervisor/draft。
   */
  private async handleScopePreflight(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
  ): Promise<void> {
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    let body: { scheme?: unknown; decisions?: unknown; stub_id?: unknown };
    try {
      body = (await this.readJsonBody(req)) as typeof body;
    } catch (err) {
      this.sendJson(res, 400, {
        error: "invalid_json",
        message: (err as Error).message,
      });
      return;
    }
    const scheme = body.scheme as Record<string, unknown> | undefined;
    if (
      !scheme ||
      typeof scheme["scheme_revision"] !== "number" ||
      !Number.isInteger(scheme["scheme_revision"]) ||
      scheme["scheme_revision"] < 1
    ) {
      this.sendJson(res, 400, {
        error: "invalid_scheme",
        message: "scheme.scheme_revision 必填且为正整数",
      });
      return;
    }
    try {
      // TASK-L.9：可选 stub_id → 桩视图预检；缺省时若有计划则用 nextStub
      let stub: import("../src/lib/project/project-plan").ContractStub | null =
        null;
      const plan = readPlan(this.repoRoot);
      if (typeof body.stub_id === "string" && body.stub_id && plan) {
        stub = plan.contracts.find((c) => c.stub_id === body.stub_id) ?? null;
      } else if (plan) {
        stub = nextStub(plan);
      }
      const scope_plan = preflightScopePlan({
        repoRoot: this.repoRoot,
        scheme:
          scheme as unknown as import("../src/lib/journey/scheme-draft").SchemeDraft,
        ...(body.decisions && typeof body.decisions === "object"
          ? {
              decisions:
                body.decisions as import("../src/lib/journey/scope-plan").ScopePlanDecisions,
            }
          : {}),
        ...(stub ? { stub } : {}),
      });
      this.sendJson(res, 200, {
        scope_plan,
        ...(stub
          ? {
              stub_id: stub.stub_id,
              next_stub_id: stub.stub_id,
            }
          : {}),
      });
    } catch (err) {
      this.sendActionError(res, err);
    }
  }

  private async handleSupervisorDraft(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
  ): Promise<void> {
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    let body: {
      intent?: unknown;
      context_paths?: unknown;
      enrich?: unknown;
    };
    try {
      body = (await this.readJsonBody(req)) as typeof body;
    } catch (err) {
      this.sendJson(res, 400, {
        error: "invalid_json",
        message: (err as Error).message,
      });
      return;
    }

    const intent = typeof body.intent === "string" ? body.intent.trim() : "";
    if (intent.length === 0) {
      this.sendJson(res, 400, {
        error: "intent_required",
        message: "intent 不能为空：请用一句自然语言说明要改什么",
      });
      return;
    }
    if (intent.length > 4000) {
      this.sendJson(res, 400, {
        error: "intent_too_long",
        message: `intent 长度 ${intent.length} 超过 4000 字符上限`,
      });
      return;
    }

    const contextPaths = Array.isArray(body.context_paths)
      ? body.context_paths
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, 50)
      : [];

    // 独立账本：与 Worker/合同账本分文件、分累计值
    const ledger = SupervisorBudgetLedger.independent({
      repoRoot: this.repoRoot,
    });
    if (ledger.isBlocked()) {
      this.sendJson(res, 402, {
        error: "BUDGET_EXHAUSTED",
        code: SUPERVISOR_BUDGET_ERROR_CODE,
        message:
          "Supervisor 独立日预算已用尽；这不会影响 Worker 的合同预算，但也无法继续生成草案。",
        budget: ledger.snapshot(),
      });
      return;
    }

    // enrich 语义：
    // - true  → 必须 L1；未配置则 409（不静默降级）
    // - false → 强制纯 L0
    // - 省略 → 有注入则 L1，否则 L0（「有配置则 enrich，无则 L0」）
    const wantEnrich =
      body.enrich === true
        ? true
        : body.enrich === false
          ? false
          : this.supervisorEnrich !== undefined;
    if (body.enrich === true && this.supervisorEnrich === undefined) {
      this.sendJson(res, 409, {
        error: "ENRICH_NOT_CONFIGURED",
        message:
          "L1 白话补全未配置模型；去掉 enrich 可用纯 L0（零模型调用，仍产出规则理由）。",
      });
      return;
    }

    const now = new Date();
    const message: SupervisorMessage = {
      message_id: `msg_http_${randomUUID()}`,
      role: "user",
      text: intent,
      created_at: now.toISOString(),
      source: "ui",
    };

    const before = this.repoStatusFingerprint();
    try {
      const outcome = await generateContractDraft({
        repoRoot: this.repoRoot,
        messages: [message],
        // 圈选路径优先于文本推断：用户在架构图里点过的文件就是意图本身
        ...(contextPaths.length > 0
          ? { scope: { writablePaths: contextPaths } }
          : {}),
        trigger: "USER_REQUEST",
        now: () => now,
        ...(wantEnrich && this.supervisorEnrich !== undefined
          ? { enrich: this.supervisorEnrich, budgetLedger: ledger }
          : {}),
      });

      if (!outcome.generated) {
        this.sendJson(res, 409, { error: "DRAFT_NOT_GENERATED" });
        return;
      }

      const after = this.repoStatusFingerprint();
      if (before !== null && after !== null && before !== after) {
        this.sendJson(res, 500, {
          error: "ZERO_TOOL_VIOLATION",
          message:
            "草案生成期间仓库工作区被改动；已拒绝返回草案（Zero-Tool 只读契约被破坏）。",
        });
        return;
      }

      this.sendJson(res, 200, {
        draft: {
          // 未落盘的合同草案：lifecycle=DRAFT/DRAFT，可直接由前端继续编辑后提交
          contract: outcome.contract,
          plan: {
            writable_paths: outcome.plan.writable_paths,
            readonly_paths: outcome.plan.readonly_paths,
            strictly_forbidden_paths: outcome.plan.strictly_forbidden_paths,
            commands: outcome.plan.commands,
            budget: outcome.plan.budget,
            protected_files: outcome.plan.protected_files,
            protected_entry_names: outcome.plan.protected_entry_names,
            needs_protection_approval: outcome.plan.needs_protection_approval,
          },
          rationale: outcome.rationale,
          unresolved_questions: outcome.unresolved_questions,
          model_calls: outcome.model_calls,
          usage: outcome.usage ?? null,
        },
        budget: ledger.snapshot(),
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === SUPERVISOR_BUDGET_ERROR_CODE) {
        this.sendJson(res, 402, {
          error: "BUDGET_EXHAUSTED",
          code: SUPERVISOR_BUDGET_ERROR_CODE,
          message: (err as Error).message,
          budget: ledger.snapshot(),
        });
        return;
      }
      if (err instanceof EnrichError) {
        // 502：上游模型/网络问题，便于前端区分「没配」与「配了但挂了」
        this.sendJson(res, 502, {
          error: err.enrichCode,
          message: err.message,
          budget: ledger.snapshot(),
        });
        return;
      }
      this.sendJson(res, 400, {
        error: "draft_generation_failed",
        message: (err as Error).message,
      });
    }
  }

  /** TASK-C.3 编辑器读写：保存必须经此端点，越权 403 + GATEWAY_VIOLATION */
  private async handleWorktreeFiles(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    url: URL,
  ): Promise<void> {
    try {
      if (method === "GET") {
        const ctx = this.fileContext(url.searchParams.get("contract_id"));
        this.sendJson(
          res,
          200,
          readFileFor(ctx, url.searchParams.get("path") ?? ""),
        );
        return;
      }
      if (method === "POST") {
        const body = (await this.readJsonBody(req)) as {
          path?: string;
          content?: string;
          contract_id?: string;
        };
        if (typeof body.content !== "string") {
          this.sendJson(res, 400, { error: "content is required" });
          return;
        }
        const ctx = this.fileContext(body.contract_id);
        const d = decideWrite(ctx, String(body.path ?? ""));
        if (!d.allowed || !d.absolutePath) {
          const violation = {
            at: new Date().toISOString(),
            source: "editor" as const,
            contract_id: body.contract_id ?? null,
            path: String(body.path ?? ""),
            reason: d.reason,
          };
          recordViolation(this.repoRoot, violation);
          this.broadcast("GATEWAY_VIOLATION", violation);
          this.sendJson(res, 403, {
            error: "GATEWAY_VIOLATION",
            reason: d.reason,
          });
          return;
        }
        fs.mkdirSync(path.dirname(d.absolutePath), { recursive: true });
        fs.writeFileSync(d.absolutePath, body.content);
        this.sendJson(res, 200, { path: d.relativePath, saved: true });
        return;
      }
      this.sendJson(res, 405, { error: "Method Not Allowed" });
    } catch (err) {
      this.sendJson(res, 400, { error: (err as Error).message });
    }
  }

  /**
   * 合同 ID 白名单 + worktrees 目录包含性校验（C.5 安全修复）。
   * 路由正则只挡 `/`，`..%2F..` 解码后仍可穿越；这里双重校验：
   * 1) ID 只允许 [A-Za-z0-9_-]；
   * 2) path.resolve 结果必须落在 <repo>/.stagent/worktrees 内。
   * 不满足一律抛错，由调用方返回 400，绝不返回任何目录内容。
   */
  private resolveWorktreePath(contractId: string): string {
    assertSafeContractId(contractId);
    const root = path.resolve(this.repoRoot, ".stagent", "worktrees");
    const resolved = path.resolve(root, `task-${contractId}`);
    const rel = path.relative(root, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `worktree path escapes .stagent/worktrees: ${contractId}`,
      );
    }
    return resolved;
  }

  /**
   * TASK-P.1 保护清单与本轮授权的控制面 API。
   * 清单修改只走这里（UI 开关/推荐卡），AI 的任何写通道都被门卫挡住；
   * hook 通道投递的拦截请求在每次访问时并入待审批卡（文件队列，不新增 WS 帧）。
   */
  private async handleProtection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
  ): Promise<void> {
    try {
      drainProtectionRequests(this.repoRoot);

      if (method === "GET" && pathname === "/api/protection") {
        let entries: unknown[] = [];
        let corrupt: string | null = null;
        try {
          entries = loadProtectionList(this.repoRoot).entries;
        } catch (err) {
          corrupt = (err as Error).message;
        }
        const state = loadRoundState(this.repoRoot);
        const cp = getCheckpoint(this.repoRoot);
        this.sendJson(res, 200, {
          // 清单损坏时门卫按全拦截运行，不能显示成自由模式 VIBE
          mode: corrupt ? "CORRUPT" : entries.length > 0 ? "PROTECTED" : "VIBE",
          entries,
          corrupt,
          round: {
            roundId: state.roundId,
            startedAt: state.startedAt,
            pending: state.pending,
            approvedFiles: state.approvedFiles,
          },
          checkpoint: cp ? { roundId: cp.roundId, at: cp.at } : null,
        });
        return;
      }

      if (method === "GET" && pathname === "/api/protection/recommendations") {
        this.sendJson(res, 200, {
          recommendations: recommendProtections(this.repoRoot),
        });
        return;
      }

      if (
        method === "POST" &&
        pathname === "/api/protection/recommendations/apply"
      ) {
        const body = (await this.readJsonBody(req)) as { names?: string[] };
        const wanted = new Set(body.names ?? []);
        const recs = recommendProtections(this.repoRoot);
        const added = recs
          .filter((r) => wanted.has(r.name))
          .map((r) => addProtectionEntry(this.repoRoot, r.name, r.patterns));
        this.sendJson(res, 200, {
          added,
          entries: loadProtectionList(this.repoRoot).entries,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/entries") {
        const body = (await this.readJsonBody(req)) as {
          name?: string;
          patterns?: string[];
        };
        const name = (body.name ?? "").trim();
        const patterns = (body.patterns ?? []).filter(
          (p) => typeof p === "string" && p.trim().length > 0,
        );
        if (!name || patterns.length === 0) {
          this.sendJson(res, 400, { error: "name 与 patterns 均必填" });
          return;
        }
        const entry = addProtectionEntry(this.repoRoot, name, patterns);
        this.sendJson(res, 201, {
          entry,
          entries: loadProtectionList(this.repoRoot).entries,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/entries/remove") {
        const body = (await this.readJsonBody(req)) as { id?: string };
        if (!body.id || !removeProtectionEntry(this.repoRoot, body.id)) {
          this.sendJson(res, 404, { error: "entry not found" });
          return;
        }
        this.sendJson(res, 200, {
          entries: loadProtectionList(this.repoRoot).entries,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/decisions") {
        const body = (await this.readJsonBody(req)) as {
          cardId?: string;
          decision?: string;
        };
        if (
          !body.cardId ||
          (body.decision !== "approve" && body.decision !== "deny")
        ) {
          this.sendJson(res, 400, { error: "cardId 与 decision 必填" });
          return;
        }
        const card = decideApproval(this.repoRoot, body.cardId, body.decision);
        if (!card) {
          this.sendJson(res, 404, { error: "card not found" });
          return;
        }
        const state = loadRoundState(this.repoRoot);
        this.sendJson(res, 200, {
          card,
          pending: state.pending,
          approvedFiles: state.approvedFiles,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/protection/round/start") {
        try {
          const state = ensureRoundStarted(this.repoRoot, "manual");
          const cp = await ensureCheckpoint(this.repoRoot);
          this.sendJson(res, 200, {
            roundId: state.roundId,
            checkpointAt: cp.at,
          });
        } catch (err) {
          this.sendJson(res, 409, {
            error: "E_CHECKPOINT_FAILED",
            message: `快照失败，本轮不开工：${(err as Error).message}`,
          });
        }
        return;
      }

      if (method === "POST" && pathname === "/api/protection/undo") {
        try {
          const result = await undoLatestCheckpoint(this.repoRoot);
          this.sendJson(res, result.undone ? 200 : 404, result);
        } catch (err) {
          this.sendJson(res, 409, {
            error: "E_UNDO_FAILED",
            message: (err as Error).message,
          });
        }
        return;
      }

      if (method === "GET" && pathname === "/api/protection/pending") {
        const state = loadRoundState(this.repoRoot);
        this.sendJson(res, 200, {
          roundId: state.roundId,
          pending: state.pending,
          approvedFiles: state.approvedFiles,
        });
        return;
      }

      this.sendJson(res, 404, { error: "Not Found", path: pathname });
    } catch (err) {
      this.sendJson(res, 400, { error: (err as Error).message });
    }
  }

  /** TASK-C.6 右栏会话 REST；流式事件经 WS CHAT_EVENT 推送 */
  private async handleChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
  ): Promise<void> {
    try {
      if (method === "GET" && pathname === "/api/chat/adapters") {
        this.sendJson(res, 200, { adapters: this.chat.listAdapters() });
        return;
      }
      if (method === "GET" && pathname === "/api/chat/sessions") {
        this.sendJson(res, 200, { sessions: this.chat.listSessions() });
        return;
      }
      if (method === "POST" && pathname === "/api/chat/sessions") {
        const body = (await this.readJsonBody(req)) as { adapter_id?: string };
        const session = this.chat.createSession(body.adapter_id);
        this.sendJson(res, 201, { session });
        return;
      }
      const m = pathname.match(
        /^\/api\/chat\/sessions\/([A-Za-z0-9_-]+)(?:\/(messages|interrupt))?$/,
      );
      if (m) {
        const id = m[1] ?? "";
        const action = m[2];
        if (method === "GET" && !action) {
          const session = this.chat.getSession(id);
          if (!session) this.sendJson(res, 404, { error: "session not found" });
          else this.sendJson(res, 200, { session });
          return;
        }
        if (method === "POST" && action === "messages") {
          // P.1：本轮开工前必须有快照（快照失败则本轮不开工）
          try {
            ensureRoundStarted(this.repoRoot, "chat");
            await ensureCheckpoint(this.repoRoot);
          } catch (err) {
            this.sendJson(res, 409, {
              error: "E_CHECKPOINT_FAILED",
              message: `快照失败，本轮不开工：${(err as Error).message}`,
            });
            return;
          }
          const body = (await this.readJsonBody(req)) as { text?: string };
          const result = this.chat.send(id, String(body.text ?? ""));
          this.sendJson(res, 202, { result });
          return;
        }
        if (method === "POST" && action === "interrupt") {
          this.sendJson(res, 200, { interrupted: this.chat.interrupt(id) });
          return;
        }
      }
      this.sendJson(res, 404, { error: "Not Found", path: pathname });
    } catch (err) {
      this.sendJson(res, 400, { error: (err as Error).message });
    }
  }

  /**
   * C.10p：图谱开工/核销前确保合同任务 Worktree 物理存在。
   *
   * 批准时会建树；MERGED / 清理 / 崩溃后图仍可能挂着合同。这里自愈重建，
   * 基线优先合同 base_branch，缺失则回退 main/master/HEAD。
   */
  private async ensureGraphTaskWorktree(contractIdHint?: string): Promise<
    | { ok: true; worktreePath: string; created: boolean }
    | {
        ok: false;
        status: number;
        body: Record<string, unknown>;
      }
  > {
    const snapshot = this.graphEngine.getGraph();
    if (!snapshot) {
      return {
        ok: false,
        status: 404,
        body: {
          error: "TASK_GRAPH_NOT_FOUND",
          code: "E_GRAPH_NOT_FOUND",
          message: "尚未生成任务图谱",
        },
      };
    }
    const contractId = contractIdHint ?? snapshot.contract_id;
    if (contractIdHint && contractIdHint !== snapshot.contract_id) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "contract_mismatch",
          code: "E_GRAPH_NOT_FOUND",
          message: `图谱所属合同为 ${snapshot.contract_id}，与请求不一致`,
        },
      };
    }
    const contract = this.orchestrator.getStore().get(contractId);
    if (!contract) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "contract_not_found",
          code: "E_GRAPH_NOT_FOUND",
          message: `图谱所属合同 ${contractId} 不存在`,
        },
      };
    }
    try {
      const ensured = await ensureTaskWorktree({
        repoRoot: this.repoRoot,
        contractId,
        preferredBaseBranch: contract.authorization.git.base_branch,
      });
      return {
        ok: true,
        worktreePath: ensured.worktreePath,
        created: ensured.created,
      };
    } catch (err) {
      if (err instanceof DirtyWorktreeConfirmationRequiredError) {
        return {
          ok: false,
          status: 409,
          body: {
            error: "worktree_dirty_confirmation_required",
            code: "E_WORKTREE_DIRTY",
            message: err.message,
            dirty_count: err.dirtyFiles.length,
            dirty_files: err.dirtyFiles,
            plain_message: err.guidance.plain_message,
            exclusion_suggestions: err.guidance.exclusion_suggestions,
            dirty_exclusions: err.guidance.dirty_exclusions,
          },
        };
      }
      const message =
        err instanceof WorktreeError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        ok: false,
        status: 409,
        body: {
          error: "worktree_ensure_failed",
          code: "E_WORKTREE_UNAVAILABLE",
          message: `无法准备任务 Worktree：${message}`,
        },
      };
    }
  }

  /**
   * Task Graph 控制面（架构 §3.3 / §3.4，TASK-C.7）。
   *
   * 四个端点都只碰 `TaskGraphEngine`，没有任何一处直接写
   * `.stagent/specs/task_graph.json`——"Daemon 独占权威状态"靠这一点保证。
   *
   * - `GET  /api/graph`               读取当前权威快照
   * - `POST /api/graph/proposal`      从 Supervisor 提案建图（全 PENDING）
   * - `POST /api/graph/nodes/start`   按拓扑序开工
   * - `POST /api/graph/verify`        提交物理证据并判定是否点亮
   * - `POST /api/graph/stale`         外部改码 → 节点降级 + 合同降级
   */
  private async handleTaskGraph(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    url: URL,
  ): Promise<void> {
    try {
      if (method === "GET" && url.pathname === "/api/graph") {
        const contractId = url.searchParams.get("contract_id") ?? undefined;
        const graph = this.graphEngine.getGraph(contractId);
        if (!graph) {
          this.sendJson(res, 404, {
            error: "TASK_GRAPH_NOT_FOUND",
            code: "E_GRAPH_NOT_FOUND",
            message: this.graphEngine.lastLoadError ?? "尚未生成任务图谱",
          });
          return;
        }
        this.sendJson(res, 200, { graph });
        return;
      }

      if (method === "POST" && url.pathname === "/api/graph/proposal") {
        const body = (await this.readJsonBody(req)) as {
          proposal?: unknown;
        };
        if (!body.proposal) {
          this.sendJson(res, 400, {
            error: "proposal_required",
            code: "E_PROPOSAL_INVALID",
            message: "proposal 不能为空",
          });
          return;
        }
        const graph = this.graphEngine.createFromProposal(
          body.proposal as SupervisorProposalV1,
        );
        this.sendJson(res, 200, { graph });
        return;
      }

      if (method === "POST" && url.pathname === "/api/graph/nodes/start") {
        const body = (await this.readJsonBody(req)) as { node_id?: unknown };
        if (typeof body.node_id !== "string" || body.node_id === "") {
          this.sendJson(res, 400, {
            error: "node_id_required",
            code: "E_GRAPH_UNKNOWN_NODE",
            message: "node_id 不能为空",
          });
          return;
        }
        // C.10p：开工前确保任务 Worktree 存在（合入后清理 / 历史图仍可施工）
        const ensured = await this.ensureGraphTaskWorktree();
        if (!ensured.ok) {
          this.sendJson(res, ensured.status, ensured.body);
          return;
        }
        const graph = this.graphEngine.startNode(body.node_id);
        this.sendJson(res, 200, { graph });
        return;
      }

      if (method === "POST" && url.pathname === "/api/graph/verify") {
        const body = (await this.readJsonBody(req)) as Record<string, unknown>;
        const nodeId =
          typeof body["node_id"] === "string" ? body["node_id"] : "";
        if (nodeId === "") {
          this.sendJson(res, 400, {
            error: "node_id_required",
            code: "E_GRAPH_UNKNOWN_NODE",
            message: "node_id 不能为空",
          });
          return;
        }

        // OP-32-A：命令退出码由 Daemon 在 Worktree 内实采，禁止前端伪造。
        // 入参若包含 command_results 或 execution_exit_code，直接拒绝；
        // MANUAL 节点的 manual_approved / manual_approved_source 放行路径除外。
        const hasForbiddenFields =
          body["command_results"] !== undefined ||
          body["execution_exit_code"] !== undefined;
        if (hasForbiddenFields) {
          this.sendJson(res, 400, {
            error: "forged_verification_fields_forbidden",
            code: E_UNAUTHORIZED_COMMAND,
            message:
              "客户端不得伪造 command_results 或 execution_exit_code；退出码必须由 Daemon 在 Worktree 内实采",
          });
          return;
        }

        const snapshot = this.graphEngine.getGraph();
        if (!snapshot) {
          this.sendJson(res, 404, {
            error: "TASK_GRAPH_NOT_FOUND",
            code: "E_GRAPH_NOT_FOUND",
            message: "尚未生成任务图谱",
          });
          return;
        }
        const node = snapshot.nodes.find((item) => item.node_id === nodeId);
        if (!node) {
          this.sendJson(res, 400, {
            error: "unknown_node",
            code: "E_GRAPH_UNKNOWN_NODE",
            message: `图中不存在节点 ${nodeId}`,
          });
          return;
        }
        const contract = this.orchestrator.getStore().get(snapshot.contract_id);
        if (!contract) {
          this.sendJson(res, 409, {
            error: "contract_not_found",
            code: "E_GRAPH_NOT_FOUND",
            message: `图谱所属合同 ${snapshot.contract_id} 不存在`,
          });
          return;
        }

        // C.10p：核销采证前若 Worktree 缺失则重建（避免合入清理后 409）
        const ensured = await this.ensureGraphTaskWorktree(
          snapshot.contract_id,
        );
        if (!ensured.ok) {
          this.sendJson(res, ensured.status, ensured.body);
          return;
        }

        const worktreePath = getWorktreePath(
          this.repoRoot,
          snapshot.contract_id,
        );

        // OP-32-A：安全边界与白名单匹配
        // 合同白名单：verification_spec.commands
        const contractCommands = contract.verification_spec.commands ?? [];
        const allowedCommands = contractCommands.map((spec) =>
          [spec.executable, ...spec.args].join(" ").trim(),
        );

        // 如果请求携带了可选命令别名 command_alias，查表并校验
        const requestedAlias =
          typeof body["command_alias"] === "string" &&
          body["command_alias"].trim() !== ""
            ? body["command_alias"].trim()
            : undefined;

        if (requestedAlias !== undefined) {
          const aliasInContract = contractCommands.some(
            (c) => c.alias === requestedAlias,
          );
          if (!aliasInContract) {
            this.sendJson(res, 400, {
              error: "unauthorized_command_alias",
              code: E_UNAUTHORIZED_COMMAND,
              message: `命令别名 ${requestedAlias} 不在合同白名单中`,
            });
            return;
          }
        }

        // 实采命令退出码：对 COMMAND 模式节点运行其声明命令（或指定别名命令）
        const collectedCommandResults: Array<{
          alias: string;
          exit_code: number;
        }> = [];

        if (node.verification_mode === "COMMAND") {
          const targetAliases = requestedAlias
            ? [requestedAlias]
            : node.verification_commands;

          for (const alias of targetAliases) {
            const spec = contractCommands.find((c) => c.alias === alias);
            if (!spec) {
              this.sendJson(res, 400, {
                error: "unauthorized_command_alias",
                code: E_UNAUTHORIZED_COMMAND,
                message: `节点所需命令别名 ${alias} 不在合同白名单中`,
              });
              return;
            }

            const commandStr = [spec.executable, ...spec.args].join(" ").trim();
            const cmdCwd = spec.working_directory
              ? path.resolve(worktreePath, spec.working_directory)
              : worktreePath;

            try {
              const runRes = await runCommand(commandStr, {
                cwd: cmdCwd,
                argv: {
                  executable: spec.executable,
                  args: spec.args,
                },
                allowedCommands,
                timeoutMs: 30_000,
                maxOutputChars: 20_000,
                networkPolicy:
                  contract.authorization.execution_permissions.network_policy,
              });
              collectedCommandResults.push({
                alias,
                exit_code: runRes.exitCode,
              });
            } catch (err: unknown) {
              const exitCode =
                typeof (err as { exitCode?: number })?.exitCode === "number"
                  ? (err as { exitCode: number }).exitCode
                  : (err as { code?: string })?.code === "E_COMMAND_TIMEOUT"
                    ? 124
                    : (err as { code?: string })?.code ===
                        E_UNAUTHORIZED_COMMAND
                      ? 126
                      : 1;
              collectedCommandResults.push({
                alias,
                exit_code: exitCode,
              });
            }
          }
        }

        const collected = await collectWorktreeEvidence({
          repoRoot: this.repoRoot,
          contractId: snapshot.contract_id,
          targetFiles: node.target_files,
          scope: contract.authorization.file_system_scope,
        });
        if (!collected.worktree_available) {
          this.sendJson(res, 409, {
            error: "worktree_unavailable",
            code: "E_WORKTREE_UNAVAILABLE",
            message: `任务 Worktree 不存在：${collected.worktree_path}`,
          });
          return;
        }

        const sideEffects = Array.isArray(body["side_effects"])
          ? body["side_effects"]
              .filter(
                (item): item is Record<string, unknown> =>
                  typeof item === "object" && item !== null,
              )
              .map((item) => ({
                path: typeof item["path"] === "string" ? item["path"] : "",
                before_sha256:
                  typeof item["before_sha256"] === "string"
                    ? item["before_sha256"]
                    : null,
                after_sha256:
                  typeof item["after_sha256"] === "string"
                    ? item["after_sha256"]
                    : null,
              }))
              .filter((item) => item.path !== "")
          : [];

        const evidence: Omit<IlluminationInput, "node" | "now"> = {
          files_written: collected.files_written,
          file_hashes: collected.file_hashes,
          scope_valid: collected.scope_valid,
          commit_sha: collected.commit_sha,
          command_results: collectedCommandResults,
          ...(typeof body["expected_exit_code"] === "number"
            ? { expected_exit_code: body["expected_exit_code"] }
            : {}),
          ...(typeof body["manual_approved"] === "boolean"
            ? { manual_approved: body["manual_approved"] }
            : {}),
          ...(body["manual_approved_source"] === "ui_click"
            ? { manual_approved_source: "ui_click" as const }
            : {}),
          ...(typeof body["syntax_check_exit_code"] === "number"
            ? { syntax_check_exit_code: body["syntax_check_exit_code"] }
            : {}),
          ...(sideEffects.length > 0 ? { side_effects: sideEffects } : {}),
        };

        const { result, graph } = this.graphEngine.verifyNode(nodeId, evidence);
        this.sendJson(res, 200, {
          illuminated: result.illuminated,
          ...(result.illuminated
            ? {}
            : { code: result.code, message: result.message }),
          ...(collected.scope_violations.length > 0
            ? { scope_violations: collected.scope_violations }
            : {}),
          graph,
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/graph/stale") {
        const body = (await this.readJsonBody(req)) as {
          contract_id?: unknown;
          paths?: unknown;
        };
        const paths = Array.isArray(body.paths)
          ? body.paths.filter(
              (item): item is string => typeof item === "string",
            )
          : [];
        if (paths.length === 0) {
          this.sendJson(res, 400, {
            error: "paths_required",
            message: "paths 至少需要一个变更路径",
          });
          return;
        }

        const staleIds = this.graphEngine.markStale(paths);
        const graph = this.graphEngine.getGraph();
        const contractId =
          typeof body.contract_id === "string"
            ? body.contract_id
            : (graph?.contract_id ?? null);

        // §3.4 级联降级：任一 STALE_REVERIFY 出现，AUDITED 合同原子退回 VERIFYING。
        // 图已过期但合同不存在/不是 AUDITED 时不报错——降级是安全动作，不是前置条件。
        let demoted = false;
        if (staleIds.length > 0 && contractId !== null) {
          const contract = this.orchestrator.getStore().get(contractId);
          if (contract?.lifecycle_state === "AUDITED") {
            const next = this.orchestrator.getStore().transition({
              contractId,
              lifecycleState: "VERIFYING",
            });
            this.emitContractUpdate(next);
            demoted = true;
          }
          this.broadcast("SCOPE_ALERT", {
            contract_id: contractId,
            code: "E_EVIDENCE_STALE",
            message:
              "外部文件改动使节点证据过期；相关节点已降级为 STALE_REVERIFY，等待重新验证",
          });
        }

        this.sendJson(res, 200, {
          node_ids: staleIds,
          contract_demoted: demoted,
          graph,
        });
        return;
      }

      this.sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      this.sendActionError(res, err);
    }
  }

  /**
   * TASK-S.6b：真机预览启动 / 停止 / 查询。
   * POST /api/preview/real/start|stop ；GET /api/preview/real/status?contract_id=
   */
  private async handleRealPlaytest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
    parsedUrl: URL,
  ): Promise<void> {
    try {
      if (pathname === "/api/preview/real/status") {
        if (method !== "GET") {
          this.sendJson(res, 405, { error: "Method not allowed" });
          return;
        }
        const contractId = (
          parsedUrl.searchParams.get("contract_id") ?? ""
        ).trim();
        if (!contractId) {
          this.sendJson(res, 400, {
            error: "contract_id_required",
            message: "需要 contract_id",
          });
          return;
        }
        const handle = this.realPreviews.get(contractId)?.handle ?? null;
        this.sendJson(res, 200, {
          contract_id: contractId,
          url: handle?.url ?? null,
          port: handle?.port ?? null,
          status: handle ? "RUNNING" : "STOPPED",
          owned: handle?.owned ?? false,
          updated_at: new Date().toISOString(),
        });
        return;
      }

      if (method !== "POST") {
        this.sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      let body: {
        contract_id?: unknown;
        attach_url?: unknown;
        root_dir?: unknown;
        stub?: unknown;
        title?: unknown;
      };
      try {
        body = (await this.readJsonBody(req)) as typeof body;
      } catch (err) {
        this.sendJson(res, 400, {
          error: "invalid_json",
          message: (err as Error).message,
        });
        return;
      }

      const contractId =
        typeof body.contract_id === "string" ? body.contract_id.trim() : "";
      if (!contractId) {
        this.sendJson(res, 400, {
          error: "contract_id_required",
          message: "contract_id 不能为空",
        });
        return;
      }

      if (pathname === "/api/preview/real/stop") {
        const payload = await this.stopRealPlaytest(contractId);
        this.sendJson(res, 200, payload);
        return;
      }

      // start
      const loaded = this.orchestrator.getStore().getWithMigration(contractId);
      const title =
        typeof body.title === "string"
          ? body.title
          : loaded?.contract.intent?.title;
      const attachUrl =
        typeof body.attach_url === "string"
          ? body.attach_url.trim()
          : undefined;
      const rootDir =
        typeof body.root_dir === "string" ? body.root_dir.trim() : undefined;
      const worktreeDir =
        typeof (body as { worktree_dir?: unknown }).worktree_dir === "string"
          ? String((body as { worktree_dir?: unknown }).worktree_dir).trim()
          : undefined;
      // TASK-L.5：有 Worktree 时走应用/静态探测，不再默写占位桩；
      // 仅显式 stub:true 或无 Worktree 时才落桩页。
      let worktreeExists = false;
      if (worktreeDir) {
        worktreeExists = fs.existsSync(worktreeDir);
      } else {
        try {
          worktreeExists = fs.existsSync(
            getWorktreePath(this.repoRoot, contractId),
          );
        } catch {
          worktreeExists = false;
        }
      }
      const stubExplicit = body.stub === true;
      const stubFallback =
        !stubExplicit &&
        attachUrl === undefined &&
        (rootDir === undefined || rootDir === "") &&
        !worktreeExists;
      const stub = stubExplicit || stubFallback;

      const payload = await this.startRealPlaytest({
        contractId,
        stub,
        ...(attachUrl ? { attachUrl } : {}),
        ...(rootDir ? { rootDir } : {}),
        ...(worktreeDir ? { worktreeDir } : {}),
        ...(title ? { title } : {}),
      });
      const plain =
        payload.status === "ERROR"
          ? (payload.message ?? NO_PREVIEW_PLAIN_MESSAGE)
          : stub
            ? "真机预览已启动（试玩桩）。可在中栏试玩，或点「在浏览器打开」。"
            : "真机预览已挂载。可在中栏试玩，或点「在浏览器打开」。";
      this.sendJson(res, payload.status === "ERROR" ? 200 : 200, {
        ...payload,
        plain_summary: plain,
        suggest_viewport: "playtest",
      });
    } catch (err) {
      this.sendActionError(res, err);
    }
  }

  /**
   * TASK-C.8c：无钥匙冷开自救。
   * POST /api/session/relaunch —— 不要求 Bearer（调用方恰恰没有钥匙）。
   * 仅返回「当前」Daemon 工作区的带 #token= launchUrl；不开放任意路径；
   * 不打印 Token；Daemon 本就只听 127.0.0.1。
   */
  private handleSessionRelaunch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
  ): void {
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const token = this.getSessionToken();
    if (!token || this.currentPort === null) {
      this.sendJson(res, 503, {
        error: "当前工作台尚未就绪，请稍后再试。",
        code: "E_SESSION_NOT_READY",
      });
      return;
    }
    const launch = buildWorkspaceLaunchUrl(
      { port: this.currentPort, token },
      {
        forceUiUrl: process.env["STAGENT_UI_URL"] !== undefined,
        ...(process.env["STAGENT_UI_URL"]
          ? { uiUrl: process.env["STAGENT_UI_URL"] }
          : {}),
      },
    );
    try {
      recordRecentProject(this.repoRoot);
    } catch {
      // ignore
    }
    // 响应含 launchUrl（fragment 带 token）；仅本机回环可达；实现不得把 token 打进日志
    this.sendJson(res, 200, {
      path: this.repoRoot,
      port: this.currentPort,
      reused: true,
      sameOrigin: launch.sameOrigin,
      uiUrl: launch.uiUrl,
      launchUrl: launch.launchUrl,
    });
  }

  /**
   * TASK-D.1c / C.8c：最近项目列表与打开。
   * - GET  /api/recent-projects
   * - POST /api/recent-projects/open  { path }
   *   · 当前工作区 / 最近列表：一点重开（D.1c）
   *   · 其它已存在的绝对目录：粘贴路径打开（C.8c；仍需 AUTH + 回环）
   *   · 明确不含系统文件夹选择器（D.1e）
   */
  private async handleRecentProjects(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
  ): Promise<void> {
    if (method === "GET" && pathname === "/api/recent-projects") {
      // 确保当前工作区也出现在列表（用户首次从本 Daemon 进来时）
      try {
        recordRecentProject(this.repoRoot);
      } catch {
        // ignore
      }
      const items = readRecentProjects();
      this.sendJson(res, 200, { items });
      return;
    }

    if (method === "POST" && pathname === "/api/recent-projects/open") {
      let body: { path?: string };
      try {
        body = (await this.readJsonBody(req)) as { path?: string };
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
        return;
      }
      const rawPath = typeof body.path === "string" ? body.path.trim() : "";
      if (!rawPath) {
        this.sendJson(res, 400, { error: "path is required" });
        return;
      }
      const resolved = path.resolve(rawPath);
      // 当前工作区 / 最近列表：D.1c 一点重开；其它路径：C.8c 粘贴打开（须存在且为目录）
      const isCurrent = resolved === this.repoRoot;
      if (!isCurrent && !isRecentProjectPath(resolved)) {
        try {
          if (
            !fs.existsSync(resolved) ||
            !fs.statSync(resolved).isDirectory()
          ) {
            this.sendJson(res, 400, {
              error: `找不到这个文件夹：${resolved}`,
              code: "E_PATH_NOT_FOUND",
            });
            return;
          }
        } catch {
          this.sendJson(res, 400, {
            error: `打不开这个路径：${resolved}`,
            code: "E_PATH_NOT_FOUND",
          });
          return;
        }
      }

      try {
        let port: number;
        let token: string;
        let reused: boolean;
        if (isCurrent) {
          const t = this.getSessionToken();
          if (!t || this.currentPort === null) {
            this.sendJson(res, 503, {
              error: "当前工作台尚未就绪，请稍后再试。",
            });
            return;
          }
          port = this.currentPort;
          token = t;
          reused = true;
        } else {
          const session = await ensureWorkspaceSession(resolved);
          port = session.port;
          token = session.token;
          reused = session.reused;
        }
        const launch = buildWorkspaceLaunchUrl(
          { port, token },
          {
            forceUiUrl: process.env["STAGENT_UI_URL"] !== undefined,
            ...(process.env["STAGENT_UI_URL"]
              ? { uiUrl: process.env["STAGENT_UI_URL"] }
              : {}),
          },
        );
        try {
          recordRecentProject(resolved);
        } catch {
          // ignore
        }
        // 响应含 launchUrl（fragment 带 token）；仅经已鉴权的本机通道返回，日志不打印 token
        this.sendJson(res, 200, {
          path: resolved,
          port,
          reused,
          sameOrigin: launch.sameOrigin,
          uiUrl: launch.uiUrl,
          launchUrl: launch.launchUrl,
        });
      } catch (err) {
        if (err instanceof PidLockError) {
          this.sendJson(res, 409, {
            error: err.message,
            code: err.code,
          });
          return;
        }
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    this.sendJson(res, 404, { error: "Not found" });
  }

  /**
   * `POST /api/supervisor/journey` —— 非技术旅程右侧唯一入口分流（TASK-S.6）。
   *
   * 根据白话意图静默路由：质疑 → dispute；大事 → 草案；小事 → Fast Path（免强制 Demo）。
   * 底座复用 S.2 / S.5 / requirements-store，不重砌引擎。
   */

  /**
   * TASK-C.11b：创建 / 确认 `.stagent/prototypes/<id>/` Demo，并启动隔离预览。
   * GET：查询确认态；POST action=create|confirm。
   */
  private async handleSupervisorPrototype(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    url: URL,
  ): Promise<void> {
    if (method === "GET") {
      const id = url.searchParams.get("prototype_id") ?? undefined;
      const rec = readDemoConfirm(this.repoRoot, id);
      if (!rec) {
        this.sendJson(res, 200, null);
        return;
      }
      this.sendJson(res, 200, {
        prototype_id: rec.prototype_id,
        relative_root: rec.relative_root,
        confirmed: rec.confirmed,
        confirmed_at: rec.confirmed_at,
        preview_url: null,
        preview_status: null,
      });
      return;
    }
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    let body: {
      action?: unknown;
      title?: unknown;
      prototype_id?: unknown;
      /** confirm 分支：期望的 Demo 呈现形态（非法值回落 INTERACTIVE_DEMO） */
      demo_mode?: unknown;
      /** confirm 分支：是否接受降级形态 */
      accept_degraded?: unknown;
    };
    try {
      body = (await this.readJsonBody(req)) as typeof body;
    } catch (err) {
      this.sendJson(res, 400, {
        error: "invalid_json",
        message: (err as Error).message,
      });
      return;
    }
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "create") {
      const title =
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : "隔离 Demo";
      const prototypeId =
        typeof body.prototype_id === "string" && body.prototype_id.trim()
          ? body.prototype_id.trim()
          : `proto-${Date.now().toString(36)}`;
      const demo = buildMinimalPrototypeDemo(title);
      const written = writePrototype(this.repoRoot, prototypeId, demo);
      const absRoot = path.join(this.repoRoot, written.relative_root);
      try {
        if (this.demoPreviewServer) {
          await this.demoPreviewServer.stop().catch(() => undefined);
          this.demoPreviewServer = null;
        }
      } catch {
        /* ignore */
      }
      const server = this.createDemoPreview(absRoot);
      this.demoPreviewServer = server;
      this.activePrototypeId = written.prototype_id;
      let previewUrl: string | null = null;
      let previewStatus: "RUNNING" | "STOPPED" | "ERROR" = "STOPPED";
      let message: string | undefined;
      try {
        const handle = await server.start();
        previewUrl = handle.url;
        previewStatus = "RUNNING";
      } catch (err) {
        previewStatus = "ERROR";
        message = err instanceof Error ? err.message : "Demo 预览启动失败";
      }
      const rec = readDemoConfirm(this.repoRoot, written.prototype_id);
      this.sendJson(res, 200, {
        prototype_id: written.prototype_id,
        relative_root: written.relative_root,
        confirmed: rec?.confirmed ?? false,
        confirmed_at: rec?.confirmed_at ?? null,
        preview_url: previewUrl,
        preview_status: previewStatus,
        ...(message ? { message } : {}),
      });
      return;
    }
    if (action === "confirm") {
      const prototypeId =
        typeof body.prototype_id === "string" ? body.prototype_id.trim() : "";
      if (!prototypeId) {
        this.sendJson(res, 400, {
          error: "prototype_id_required",
          message: "确认 Demo 需要 prototype_id",
        });
        return;
      }
      const demoModeRaw =
        typeof body.demo_mode === "string" ? body.demo_mode.trim() : "";
      const demo_mode =
        demoModeRaw === "NATIVE_FLOW_CARD" ||
        demoModeRaw === "DEGRADED_FLOW_CARD" ||
        demoModeRaw === "INTERACTIVE_DEMO"
          ? demoModeRaw
          : "INTERACTIVE_DEMO";
      const accept_degraded = body.accept_degraded === true;
      const rec = confirmDemoPrototype(this.repoRoot, prototypeId, {
        demo_mode,
        ...(accept_degraded ? { accept_degraded: true } : {}),
      });
      this.sendJson(res, 200, {
        prototype_id: rec.prototype_id,
        relative_root: rec.relative_root,
        confirmed: rec.confirmed,
        confirmed_at: rec.confirmed_at,
        demo_mode: rec.demo_mode ?? "INTERACTIVE_DEMO",
        accept_degraded: rec.accept_degraded === true,
        preview_url: null,
        preview_status: null,
        message: "Demo 已确认，可以签署白话合同后开工",
      });
      return;
    }
    this.sendJson(res, 400, {
      error: "unknown_action",
      message: "action 须为 create 或 confirm",
    });
  }

  /** TASK-C.17：POST /api/client-events —— CTA / viewport / disabled 原因 */
  private async handleClientEvents(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
  ): Promise<void> {
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    let body: {
      events?: unknown;
      event?: unknown;
    };
    try {
      body = (await this.readJsonBody(req)) as typeof body;
    } catch (err) {
      this.sendJson(res, 400, {
        error: "invalid_json",
        message: (err as Error).message,
      });
      return;
    }
    const rawList: unknown[] = Array.isArray(body.events)
      ? body.events
      : body.event !== undefined
        ? [body.event]
        : [];
    if (rawList.length === 0) {
      this.sendJson(res, 400, {
        error: "events_required",
        message: "需要 events[] 或 event",
      });
      return;
    }
    const requestId = (
      req as http.IncomingMessage & { stagentRequestId?: string }
    ).stagentRequestId;
    let accepted = 0;
    for (const raw of rawList.slice(0, 50)) {
      if (!raw || typeof raw !== "object") continue;
      const ev = raw as Record<string, unknown>;
      const kind = typeof ev["kind"] === "string" ? ev["kind"] : "";
      if (!kind) continue;
      try {
        appendClientTrace(
          this.repoRoot,
          {
            kind,
            ...(typeof ev["ts"] === "string" ? { ts: ev["ts"] } : {}),
            ...(typeof ev["cta"] === "string" ? { cta: ev["cta"] } : {}),
            ...(typeof ev["viewport"] === "string"
              ? { viewport: ev["viewport"] }
              : {}),
            ...(typeof ev["disabled_reason"] === "string"
              ? { disabled_reason: ev["disabled_reason"] }
              : {}),
            ...(typeof ev["contractId"] === "string"
              ? { contractId: ev["contractId"] }
              : typeof ev["contract_id"] === "string"
                ? { contractId: ev["contract_id"] }
                : {}),
            ...(typeof ev["sessionId"] === "string"
              ? { sessionId: ev["sessionId"] }
              : typeof ev["session_id"] === "string"
                ? { sessionId: ev["session_id"] }
                : {}),
            ...(ev["detail"] && typeof ev["detail"] === "object"
              ? { detail: ev["detail"] as Record<string, unknown> }
              : {}),
          },
          ...(requestId === undefined ? [] : [{ requestId }]),
        );
        accepted += 1;
      } catch {
        /* skip bad event */
      }
    }
    this.sendJson(res, 200, { accepted });
  }

  private async handleSupervisorJourney(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    url?: URL,
  ): Promise<void> {
    // TASK-C.17：GET 读回旅程（刷新还原）
    if (method === "GET") {
      const cid = url?.searchParams.get("contract_id") ?? undefined;
      const turns = readJourneyTurns(this.repoRoot, cid);
      this.sendJson(res, 200, {
        contract_id: cid ?? null,
        turns,
      });
      return;
    }
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      let body: {
        message?: unknown;
        contract_id?: unknown;
        session_id?: unknown;
      };
      try {
        body = (await this.readJsonBody(req)) as typeof body;
      } catch (err) {
        this.sendJson(res, 400, {
          error: "invalid_json",
          message: (err as Error).message,
        });
        return;
      }

      const message =
        typeof body.message === "string" ? body.message.trim() : "";
      if (message.length === 0) {
        this.sendJson(res, 400, {
          error: "message_required",
          message: "message 不能为空",
        });
        return;
      }
      if (message.length > 4000) {
        this.sendJson(res, 400, {
          error: "message_too_long",
          message: `message 长度 ${message.length} 超过 4000 字符上限`,
        });
        return;
      }

      const contractId =
        typeof body.contract_id === "string" ? body.contract_id.trim() : "";
      const sessionId =
        typeof body.session_id === "string" ? body.session_id : undefined;

      let contract = undefined as
        import("../src/lib/contract.schema").SoftwareContract | undefined;
      if (contractId !== "") {
        const loaded = this.orchestrator
          .getStore()
          .getWithMigration(contractId);
        if (!loaded) {
          this.sendJson(res, 404, {
            error: "contract_not_found",
            message: `合同不存在或不可解析: ${contractId}`,
          });
          return;
        }
        contract = loaded.contract;
      }

      const ledger = SupervisorBudgetLedger.independent({
        repoRoot: this.repoRoot,
      });

      const result = await orchestrateJourney({
        message,
        repoRoot: this.repoRoot,
        ...(contract === undefined ? {} : { contract }),
        ...(sessionId === undefined ? {} : { sessionId }),
        requirementsStore: this.requirementsStore,
        budgetLedger: ledger,
        contractStore: this.orchestrator.getStore(),
        ...(this.supervisorEnrich === undefined
          ? {}
          : { enrich: this.supervisorEnrich }),
      });

      // TASK-C.17：澄清旅程落盘（journey-<cid>.jsonl + 可选 SupervisorSession）
      const journeyContractId =
        result.contract_id ?? (contractId !== "" ? contractId : undefined);
      const requestId = (
        req as http.IncomingMessage & { stagentRequestId?: string }
      ).stagentRequestId;
      try {
        appendJourneyTurn(this.repoRoot, {
          role: "user",
          text: message,
          ...(journeyContractId === undefined
            ? {}
            : { contractId: journeyContractId }),
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(requestId === undefined ? {} : { requestId }),
        });
        // TASK-J.10：USER_TURN_COMMITTED → 意图编译循环（防抖后组装/merge/CAS）
        // 失败不挡旅程主路径；编译器输出严禁回流右栏（ADR-0014）。
        try {
          const host = this.ensureIntentCompilerHost();
          host.commitUserTurn({ text: message });
        } catch {
          /* 编译宿主异常不挡主路径 */
        }
        appendJourneyTurn(this.repoRoot, {
          role: "assistant",
          text: result.plain_summary,
          ...(journeyContractId === undefined
            ? {}
            : { contractId: journeyContractId }),
          ...(sessionId === undefined ? {} : { sessionId }),
          route: result.route,
          ...(result.code === undefined ? {} : { code: result.code }),
          ...(requestId === undefined ? {} : { requestId }),
        });
        try {
          this.intentCompilerHost?.recordAssistantTurn(result.plain_summary);
        } catch {
          /* ignore */
        }
        if (
          sessionId !== undefined &&
          /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(sessionId)
        ) {
          const sessions = new SupervisorSessionManager(this.repoRoot);
          let ses = sessions.load(sessionId);
          if (!ses) {
            const now = new Date().toISOString();
            ses = sessions.save({
              schema_version: SUPERVISOR_SESSION_SCHEMA_VERSION,
              session_id: sessionId,
              created_at: now,
              updated_at: now,
              messages: [],
              observation: "ACTIVE",
              ...(journeyContractId === undefined
                ? {}
                : { contract_id: journeyContractId }),
            });
          }
          sessions.appendMessage(sessionId, {
            role: "user",
            text: message,
            source: "ui",
          });
          sessions.appendMessage(sessionId, {
            role: "supervisor",
            text: result.plain_summary,
            source: "model",
          });
        }
      } catch {
        /* 旅程日志失败不挡主路径 */
      }

      if (result.dispute_report) {
        this.broadcastDisputeReport(result.dispute_report);
      }

      const draftPayload =
        result.draft === undefined
          ? null
          : {
              contract: result.draft.contract,
              plan: {
                writable_paths: result.draft.plan.writable_paths,
                readonly_paths: result.draft.plan.readonly_paths,
                strictly_forbidden_paths:
                  result.draft.plan.strictly_forbidden_paths,
                commands: result.draft.plan.commands,
                budget: result.draft.plan.budget,
                protected_files: result.draft.plan.protected_files,
                protected_entry_names: result.draft.plan.protected_entry_names,
                needs_protection_approval:
                  result.draft.plan.needs_protection_approval,
              },
              rationale: result.draft.rationale,
              unresolved_questions: result.draft.unresolved_questions,
              model_calls: result.draft.model_calls,
              usage: result.draft.usage ?? null,
            };

      this.sendJson(res, 200, {
        intent: result.intent,
        route: result.route,
        plain_summary: result.plain_summary,
        skip_demo: result.skip_demo === true,
        requirements_updated: result.requirements_updated === true,
        requirements_hint: result.requirements_hint ?? null,
        suggest_viewport: result.suggest_viewport ?? null,
        code: result.code ?? null,
        // TASK-H.5：顶层 contract_id（与落盘一致；草案失败路径为 null）
        contract_id: result.contract_id ?? null,
        draft: draftPayload,
        dispute_report: result.dispute_report ?? null,
        budget: ledger.snapshot(),
      });
    } catch (err) {
      this.sendActionError(res, err);
    }
  }

  /**
   * `POST /api/supervisor/dispute` —— 质疑自查（TASK-S.5 / 架构 §5.7）。
   *
   * 只读合同与会话、只读 Worktree；产出返工提案或新合同草案（均为未落盘对象），
   * 不执行任何写操作。60s 看门狗超时时不挂死调用方，按 D-3 降级呈递事实。
   */
  private async handleSupervisorDispute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
  ): Promise<void> {
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      let body: {
        contract_id?: unknown;
        challenge?: unknown;
        session_id?: unknown;
        user_choice?: unknown;
      };
      try {
        body = (await this.readJsonBody(req)) as typeof body;
      } catch (err) {
        this.sendJson(res, 400, {
          error: "invalid_json",
          message: (err as Error).message,
        });
        return;
      }

      const contractId =
        typeof body.contract_id === "string" ? body.contract_id.trim() : "";
      const challenge =
        typeof body.challenge === "string" ? body.challenge.trim() : "";
      if (contractId === "") {
        this.sendJson(res, 400, {
          error: "contract_id_required",
          message: "contract_id 不能为空",
        });
        return;
      }
      if (challenge.length < 4 || challenge.length > 2000) {
        this.sendJson(res, 400, {
          error: "challenge_invalid",
          message: `challenge 长度必须在 4–2000 字符之间（当前 ${challenge.length}）`,
        });
        return;
      }

      const sessionId =
        typeof body.session_id === "string" ? body.session_id : undefined;
      if (
        sessionId !== undefined &&
        !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(sessionId)
      ) {
        this.sendJson(res, 400, {
          error: "invalid_session_id",
          message: "session_id 含非法字符或长度不合规",
        });
        return;
      }

      const rawChoice =
        typeof body.user_choice === "string" ? body.user_choice.trim() : "";
      let userChoice: "BUG_FIX" | "REQUIREMENT_CHANGE" | undefined;
      if (rawChoice === "BUG_FIX" || rawChoice === "REQUIREMENT_CHANGE") {
        userChoice = rawChoice;
      } else if (rawChoice !== "") {
        this.sendJson(res, 400, {
          error: "user_choice_invalid",
          message: "user_choice 只能是 BUG_FIX 或 REQUIREMENT_CHANGE",
        });
        return;
      }

      const loaded = this.orchestrator.getStore().getWithMigration(contractId);
      if (!loaded) {
        this.sendJson(res, 404, {
          error: "contract_not_found",
          message: `合同不存在或不可解析: ${contractId}`,
        });
        return;
      }
      const contract = loaded.contract;

      // 第 0 步：确保需求基准已冻结（不存在则从 contract.intent 初始化）
      this.requirementsStore.ensureBaseline(contract);

      try {
        const report = await runDisputeSelfCheck({
          contract,
          challenge,
          repoRoot: this.repoRoot,
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(userChoice === undefined ? {} : { userChoice }),
        });
        this.broadcastDisputeReport(report);
        this.sendJson(res, 200, { report });
      } catch (err) {
        if (err instanceof DisputeTimeoutError) {
          // D-3：超时不空转，降级呈递已抓到的规范事实
          const spec = new SpecFactSourceImpl(this.repoRoot).collect({
            contract,
            keywords: extractKeywords(challenge),
          });
          const report = buildTimeoutFallbackReport({
            contract,
            challenge,
            timeoutMs: DISPUTE_TIMEOUT_MS,
            spec,
          });
          this.broadcastDisputeReport(report);
          this.sendJson(res, 200, {
            report,
            degraded: true,
            code: E_DISPUTE_TIMEOUT,
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (typeof code === "string" && code.startsWith("E_SPEC_SNAPSHOT_")) {
        this.sendJson(res, 409, {
          error: (err as Error).message,
          code,
        });
        return;
      }

      this.sendActionError(res, err);
    }
  }

  private broadcastDisputeReport(report: DisputeReport): number {
    return this.broadcast("DISPUTE_REPORT_READY", {
      contract_id: report.contract_id,
      report_id: report.report_id,
      change_request_id: report.change_request_id,
      classification: report.classification,
      confidence: report.confidence,
      degraded: report.degraded,
      summary: report.plain_summary,
      facts: {
        prompt: {
          session_id: report.facts.prompt.session_id,
          original_request: report.facts.prompt.original_request,
          matched_messages: report.facts.prompt.matched_messages.length,
          confirmations: report.facts.prompt.confirmations.length,
        },
        spec: report.facts.spec
          ? {
              snapshot_id: report.facts.spec.snapshot_id,
              version: report.facts.spec.version,
              matched_entries: report.facts.spec.matched_entries,
            }
          : null,
        code: {
          worktree_available: report.facts.code.available,
          changed_files: [...report.facts.code.changed_files],
          verification: report.facts.code.verification_results.map(
            (result) => ({
              alias: result.alias,
              exit_code: result.exit_code,
            }),
          ),
          evidence_id: report.facts.code.evidence_id,
        },
      },
      generated_at: report.generated_at,
    });
  }

  private get requirementsStore(): RequirementsStore {
    if (this.requirementsStoreInstance === null) {
      this.requirementsStoreInstance = new RequirementsStore(this.repoRoot);
    }
    return this.requirementsStoreInstance;
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // Host 头必须是回环地址（DNS Rebinding 防线，与 WS Upgrade 同理）
    if (!isLocalHostAuthority(req.headers.host)) {
      this.sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    // TASK-S.4 / §4.4 P-16：Demo 预览来源一律 403，必须放在 CORS 放行之前。
    // 原因：isLocalOrigin 只校验主机名，会把 http://127.0.0.1:4100 当成本地合法来源，
    // 一旦先走 CORS 分支，Demo iframe 就拿到了跨源读响应的通行证。
    if (isDemoPreviewOrigin(req.headers.origin)) {
      this.sendJson(res, 403, {
        error: "Forbidden",
        code: DEMO_ORIGIN_FORBIDDEN,
      });
      return;
    }
    if (isRealPreviewOrigin(req.headers.origin)) {
      this.sendJson(res, 403, {
        error: "Forbidden",
        code: REAL_ORIGIN_FORBIDDEN,
      });
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${this.host}`);
    const pathname = parsedUrl.pathname;
    const method = req.method ?? "GET";

    // TASK-C.17：API 请求默认 JSONL（静态资源跳过）
    const requestId = newRequestId();
    (
      req as http.IncomingMessage & { stagentRequestId?: string }
    ).stagentRequestId = requestId;
    const startedAt = Date.now();
    const shouldLogHttp =
      pathname.startsWith("/api/") ||
      pathname === "/health" ||
      pathname === "/api/status";
    if (shouldLogHttp) {
      res.on("finish", () => {
        try {
          appendDaemonLog(this.repoRoot, {
            kind: "http",
            requestId,
            route: `${method} ${pathname}`,
            code: String(res.statusCode),
            duration_ms: Date.now() - startedAt,
          });
        } catch {
          /* ignore */
        }
      });
    }

    // 本地控制台跨端口访问（Vite dev server）所需的 CORS；仅放行回环来源
    const origin = req.headers.origin;
    if (origin && isLocalOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization,content-type",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (
      method === "GET" &&
      (pathname === "/health" || pathname === "/api/status")
    ) {
      const branchRes = await execGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        this.repoRoot,
      ).catch(() => null);
      const payload: DaemonStatusResponse = {
        status: this.stopping ? "stopping" : "ok",
        version: this.version,
        pid: process.pid,
        port: this.currentPort ?? 0,
        repoRoot: this.repoRoot,
        currentBranch:
          branchRes?.exitCode === 0 ? branchRes.stdout || null : null,
        uptime: process.uptime(),
        activeContracts: [...this.activeContracts],
      };
      this.sendJson(res, 200, payload);
      return;
    }

    // TASK-C.8c：无钥匙一键重开（故意不要求 AUTH）
    if (pathname === "/api/session/relaunch") {
      this.handleSessionRelaunch(req, res, method);
      return;
    }

    if (method === "GET" && pathname === "/api/state") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      // 返回持久化快照本身，前端据此在首帧前也能还原界面
      this.sendJson(res, 200, this.getPresentationSnapshot());
      return;
    }

    // C.10f 热修：轻量文件树（无 AST），供资源管理器纯树展示
    if (method === "GET" && pathname === "/api/repo/tree") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const contractId = parsedUrl.searchParams.get("contract_id");
        const ctx = this.fileContext(contractId);
        const root =
          ctx.contract && ctx.worktreePath ? ctx.worktreePath : ctx.repoRoot;
        const files = listRepoTreePaths(root);
        this.sendJson(res, 200, { root, files });
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    // C.10h：资源管理器右键删除（鉴权 + P.1 保护清单；尽量废纸篓）
    if (method === "POST" && pathname === "/api/repo/delete") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          path?: string;
          contract_id?: string;
        };
        const ctx = this.fileContext(body.contract_id ?? null);
        const fileRoot =
          ctx.contract && ctx.worktreePath ? ctx.worktreePath : ctx.repoRoot;
        const outcome = deleteRepoPath({
          protectionRoot: ctx.repoRoot,
          fileRoot,
          relPath: String(body.path ?? ""),
        });
        if (!outcome.ok) {
          this.sendJson(res, outcome.httpStatus, {
            error: outcome.message,
            code: outcome.code,
            message: outcome.message,
          });
          return;
        }
        this.sendJson(res, 200, {
          deleted: true,
          path: outcome.path,
          method: outcome.method,
          message: outcome.message,
        });
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    // C.10i：新建文件 / 文件夹（鉴权 + P.1）
    if (method === "POST" && pathname === "/api/repo/create") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          parent?: string;
          name?: string;
          kind?: "file" | "dir";
          contract_id?: string;
        };
        const kind = body.kind === "dir" ? "dir" : "file";
        const ctx = this.fileContext(body.contract_id ?? null);
        const fileRoot =
          ctx.contract && ctx.worktreePath ? ctx.worktreePath : ctx.repoRoot;
        const outcome = createRepoPath({
          protectionRoot: ctx.repoRoot,
          fileRoot,
          parentRel: String(body.parent ?? ""),
          name: String(body.name ?? ""),
          kind,
        });
        if (!outcome.ok) {
          this.sendJson(res, outcome.httpStatus, {
            error: outcome.message,
            code: outcome.code,
            message: outcome.message,
          });
          return;
        }
        this.sendJson(res, 200, {
          created: true,
          path: outcome.path,
          kind: outcome.kind,
          message: outcome.message,
        });
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    // C.10i：重命名（鉴权 + P.1）
    if (method === "POST" && pathname === "/api/repo/rename") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          from?: string;
          to?: string;
          contract_id?: string;
        };
        const ctx = this.fileContext(body.contract_id ?? null);
        const fileRoot =
          ctx.contract && ctx.worktreePath ? ctx.worktreePath : ctx.repoRoot;
        const outcome = renameRepoPath({
          protectionRoot: ctx.repoRoot,
          fileRoot,
          fromRel: String(body.from ?? ""),
          toRel: String(body.to ?? ""),
        });
        if (!outcome.ok) {
          this.sendJson(res, outcome.httpStatus, {
            error: outcome.message,
            code: outcome.code,
            message: outcome.message,
          });
          return;
        }
        this.sendJson(res, 200, {
          renamed: true,
          from: outcome.from,
          to: outcome.to,
          message: outcome.message,
        });
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    // TASK-H.4：空目录 / 无 .git 单键 git init（已有仓幂等跳过）
    if (method === "POST" && pathname === "/api/repo/git-init") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      let body: { confirm?: boolean } = {};
      try {
        body = (await this.readJsonBody(req)) as { confirm?: boolean };
      } catch {
        body = {};
      }
      const info = inspectGitRepo(this.repoRoot);
      // 单键：前端点确认后传 confirm:true；已有 .git 时幂等跳过
      const result = ensureGitInit(this.repoRoot, {
        confirm: body.confirm === true,
      });
      void info;
      if (!result.ok) {
        this.sendJson(
          res,
          result.code === "E_GIT_INIT_UNCONFIRMED" ? 409 : 500,
          {
            error: result.message,
            code: result.code ?? "E_GIT_INIT_FAILED",
            ...result,
          },
        );
        return;
      }
      this.sendJson(res, 200, result);
      return;
    }

    // C.10i：在 Finder / 文件管理器中显示（鉴权；只读）
    if (method === "POST" && pathname === "/api/repo/reveal") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          path?: string;
          contract_id?: string;
        };
        const ctx = this.fileContext(body.contract_id ?? null);
        const fileRoot =
          ctx.contract && ctx.worktreePath ? ctx.worktreePath : ctx.repoRoot;
        const outcome = revealRepoPath({
          fileRoot,
          relPath: String(body.path ?? ""),
        });
        if (!outcome.ok) {
          this.sendJson(res, outcome.httpStatus, {
            error: outcome.message,
            code: outcome.code,
            message: outcome.message,
          });
          return;
        }
        this.sendJson(res, 200, {
          revealed: true,
          path: outcome.path,
          message: outcome.message,
        });
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/arch/graph") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const { graph, durationMs } = buildDependencyGraph({
          root: this.repoRoot,
        });
        this.sendJson(res, 200, {
          durationMs,
          stats: graph.getStats(),
          cycles: graph.detectCycles(),
          graph: graph.toJSON(),
        });
      } catch (err) {
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/settings") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      this.sendJson(res, 200, { settings: getModelSettings() });
      return;
    }

    if (method === "POST" && pathname === "/api/settings/openai-key") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          api_key?: string;
          model?: string;
        };
        if (!body.api_key || body.api_key.trim().length < 8) {
          this.sendJson(res, 400, { error: "api_key is required" });
          return;
        }
        setRuntimeKey(body.api_key, body.model);
        // 绝不回显 Key
        this.sendJson(res, 200, { settings: getModelSettings() });
      } catch (err) {
        this.sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    // TASK-L.10：读项目计划（含服务端权威下一份）
    if (method === "GET" && pathname === "/api/project/plan") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const plan = readPlan(this.repoRoot);
        if (!plan) {
          this.sendJson(res, 404, {
            error: "project plan not found",
            code: "E_PLAN_INVALID",
          });
          return;
        }
        const next = nextStub(plan);
        this.sendJson(res, 200, {
          ok: true,
          plan,
          next_stub_id: next?.stub_id ?? null,
          next_stub: next,
        });
      } catch (err) {
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // TASK-L.8：计划补丁合并与分解器
    if (method === "POST" && pathname === "/api/project/plan/patch") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          patch?: PlanPatch;
          removed_by?: "user" | "replan";
          scheme?: unknown;
          repo_facts?: RepoFacts;
        };
        const patch = body.patch;
        if (!patch || !Array.isArray(patch.ops)) {
          this.sendJson(res, 400, { error: "patch.ops required" });
          return;
        }
        // 用户 HTTP 路径只接受 remove_stub / reorder（供 L.10）
        for (const op of patch.ops) {
          if (op.op !== "remove_stub" && op.op !== "reorder") {
            this.sendJson(res, 422, {
              error: "only remove_stub and reorder are allowed",
              code: "E_PLAN_INVALID",
              rejected_op: op.op,
            });
            return;
          }
        }
        const plan = readPlan(this.repoRoot);
        if (!plan) {
          this.sendJson(res, 404, {
            error: "project plan not found",
            code: "E_PLAN_INVALID",
          });
          return;
        }
        // scheme / repo_facts：调用方传入；缺省用计划上的 scheme_id 占位最小视图
        const scheme = (body.scheme ?? {
          scheme_id: plan.scheme_id,
          scheme_revision: plan.scheme_revision,
          size_hint: "standard",
          goals: [],
          out_of_scope: [],
          modules: [],
          entities: [],
          acceptance: [],
        }) as Parameters<typeof applyPlanPatch>[2];
        const repoFacts: RepoFacts = body.repo_facts ?? {
          has_test_script: true,
          has_modules_yaml: true,
          existing_dirs: ["src"],
        };
        const removedBy =
          body.removed_by ??
          (patch.ops.some((o) => o.op === "remove_stub") ? "user" : "replan");
        const result = applyPlanPatch(plan, patch, scheme, repoFacts, {
          removed_by: removedBy,
        });
        if (!result.ok) {
          const status = httpStatusForErrorCode(result.code) ?? 409;
          this.sendJson(res, status, {
            ok: false,
            code: result.code,
            error: result.plain_message ?? result.code,
            violations: result.violations,
            discarded: result.discarded,
          });
          return;
        }
        // 仅锁定丢弃、其余成功：仍写入（PD-08）
        writePlan(this.repoRoot, result.plan);
        this.sendJson(res, 200, {
          ok: true,
          plan: result.plan,
          discarded: result.discarded,
        });
      } catch (err) {
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/project/plan/decompose") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await this.readJsonBody(req)) as {
          scheme?: Parameters<typeof decompose>[0]["scheme"];
          repo_facts?: RepoFacts;
          pab?: ReadyPabView | null;
          project_id?: string;
        };
        if (!body.scheme || typeof body.scheme !== "object") {
          this.sendJson(res, 400, { error: "scheme required" });
          return;
        }
        const repoFacts: RepoFacts = body.repo_facts ?? {
          has_test_script: true,
          has_modules_yaml: true,
          existing_dirs: ["src"],
        };
        const existing = readPlan(this.repoRoot);
        const result = await decompose({
          scheme: body.scheme,
          repoFacts,
          pab: body.pab ?? null,
          existingPlan: existing,
          project_id: body.project_id,
        });
        if (!result.ok) {
          this.sendJson(res, 422, {
            ok: false,
            code: result.code,
            error: result.plain_message,
            violations: result.violations ?? [],
            model_calls: result.model_calls,
          });
          return;
        }
        writePlan(this.repoRoot, result.plan);
        this.sendJson(res, 200, {
          ok: true,
          plan: result.plan,
          patch: result.patch,
          model_calls: result.model_calls,
        });
      } catch (err) {
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // TASK-L.14：凭据保险库 HTTP（永不返回明文值）
    if (method === "GET" && pathname === "/api/vault") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const vault = this.vault ?? getActiveVault();
        const names = vault ? await vault.listNames() : [];
        this.sendJson(res, 200, {
          names,
          backend: vault?.backendKind ?? null,
        });
      } catch (err) {
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (method === "PUT" && pathname.startsWith("/api/vault/")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      const name = decodeURIComponent(pathname.slice("/api/vault/".length));
      try {
        const body = (await this.readJsonBody(req)) as { value?: string };
        if (typeof body.value !== "string") {
          this.sendJson(res, 400, { error: "value is required", code: "E_VAULT_NAME_INVALID" });
          return;
        }
        let vault = this.vault ?? getActiveVault();
        if (!vault) {
          vault = await createVault({ repoRoot: this.repoRoot });
          this.vault = vault;
          setActiveVault(vault);
        }
        await vault.setSecret(name, body.value);
        this.sendJson(res, 200, { ok: true, name });
      } catch (err) {
        if (err instanceof VaultError) {
          const status =
            err.code === "E_VAULT_VALUE_TOO_SHORT" ||
            err.code === "E_VAULT_NAME_INVALID"
              ? 400
              : 404;
          this.sendJson(res, status, { error: err.message, code: err.code });
          return;
        }
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (method === "DELETE" && pathname.startsWith("/api/vault/")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      const name = decodeURIComponent(pathname.slice("/api/vault/".length));
      try {
        const vault = this.vault ?? getActiveVault();
        if (vault) await vault.deleteSecret(name);
        this.sendJson(res, 200, { ok: true, name });
      } catch (err) {
        if (err instanceof VaultError) {
          this.sendJson(res, 400, { error: err.message, code: err.code });
          return;
        }
        this.sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // TASK-C.14：项目现状基线档案
    if (pathname.startsWith("/api/records")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleRecords(req, res, method, pathname);
      return;
    }

    if (pathname.startsWith("/api/baseline")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleBaseline(req, res, method, pathname);
      return;
    }

    if (pathname.startsWith("/api/graph")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleTaskGraph(req, res, method, parsedUrl);
      return;
    }

    if (pathname === "/api/supervisor/dispute") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleSupervisorDispute(req, res, method);
      return;
    }

    if (
      pathname === "/api/preview/real/start" ||
      pathname === "/api/preview/real/stop" ||
      pathname === "/api/preview/real/status"
    ) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleRealPlaytest(req, res, method, pathname, parsedUrl);
      return;
    }

    if (pathname.startsWith("/api/recent-projects")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleRecentProjects(req, res, method, pathname);
      return;
    }

    if (pathname === "/api/supervisor/prototype") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleSupervisorPrototype(req, res, method, parsedUrl);
      return;
    }

    if (pathname === "/api/supervisor/journey") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleSupervisorJourney(req, res, method, parsedUrl);
      return;
    }

    // TASK-C.17：前端轻量 UI trace → 同日志体系
    if (pathname === "/api/client-events") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleClientEvents(req, res, method);
      return;
    }

    if (pathname === "/api/supervisor/scheme/freeze") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleSchemeSnapshot(req, res, method, parsedUrl);
      return;
    }

    if (pathname === "/api/supervisor/scope/preflight") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleScopePreflight(req, res, method);
      return;
    }

    if (pathname === "/api/supervisor/draft") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleSupervisorDraft(req, res, method);
      return;
    }

    if (pathname === "/api/worktree/files") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleWorktreeFiles(req, res, method, parsedUrl);
      return;
    }

    if (pathname.startsWith("/api/protection")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleProtection(req, res, method, pathname);
      return;
    }

    if (pathname.startsWith("/api/chat")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      await this.handleChat(req, res, method, pathname);
      return;
    }

    if (pathname.startsWith("/api/contracts")) {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, {
          error: "Unauthorized",
          message: "Bearer session token required",
        });
        return;
      }

      const store = this.orchestrator.getStore();

      if (method === "GET" && pathname === "/api/contracts") {
        this.sendJson(res, 200, { contracts: store.list() });
        return;
      }

      if (method === "POST" && pathname === "/api/contracts") {
        try {
          const body = (await this.readJsonBody(req)) as {
            contract?: unknown;
            confirmation_id?: string;
          };
          if (!body.contract) {
            this.sendJson(res, 400, { error: "contract is required" });
            return;
          }
          let contract = softwareContractSchema.parse(body.contract);
          // TASK-L.9：合同级互斥——已有 PREPARING～AUDITED 则拒绝签署下一份
          const inFlight = findInFlightContract(store.list());
          if (inFlight) {
            this.sendJson(res, 409, {
              error: "contract_in_flight",
              code: "E_CONTRACT_IN_FLIGHT",
              message: "上一份还没做完，做完我再开下一份。",
              in_flight_contract_id: inFlight.contract_id,
              in_flight_lifecycle_state: inFlight.lifecycle_state,
            });
            return;
          }
          let snapshotDemoGate: DemoSignGateDecision | undefined;
          if (body.confirmation_id) {
            const snapshot = readSchemeSnapshot(
              this.repoRoot,
              body.confirmation_id,
            );
            if (!snapshot) {
              this.sendJson(res, 409, {
                error: "scheme_snapshot_not_found",
                code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
                message: "确认快照不存在或已损坏，拒绝创建可签署合同",
              });
              return;
            }
            try {
              assertSignedContractMatchesSnapshot({
                repoRoot: this.repoRoot,
                contract,
                snapshot,
              });
            } catch (scopeErr) {
              const code = (scopeErr as { code?: string }).code;
              if (code === "E_SCHEME_SNAPSHOT_NOT_FOUND") {
                this.sendJson(res, 409, {
                  error: "scheme_snapshot_not_found",
                  code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
                  message: (scopeErr as Error).message,
                });
                return;
              }
              if (scopeErr instanceof SchemeSnapshotMismatchError) {
                this.sendJson(res, 409, {
                  error: "scheme_snapshot_mismatch",
                  code: scopeErr.code,
                  message: scopeErr.message,
                });
                return;
              }
              if (scopeErr instanceof ScopeInvariantBrokenError) {
                this.sendJson(res, 500, {
                  error: "scope_invariant_broken",
                  code: scopeErr.code,
                  message: scopeErr.message,
                });
                return;
              }
              throw scopeErr;
            }
            // 与快照一致：跳过 assertContractScopeAllowed（预检已保证合规）
            snapshotDemoGate = evaluateSnapshotDemoGate(
              snapshot,
              (prototypeId) => readDemoConfirm(this.repoRoot, prototypeId),
            );
            if (!snapshotDemoGate.ok) {
              this.sendJson(res, 409, {
                error: snapshotDemoGate.message,
                code: snapshotDemoGate.code,
              });
              return;
            }
            // TASK-J.18b / GAP-W1：校验通过后永久写入 scheme_binding（旧直签不走此支）
            contract = softwareContractSchema.parse({
              ...contract,
              scheme_binding: schemeBindingFromSnapshot(
                body.confirmation_id,
                snapshot,
              ),
            });
          } else {
            assertContractScopeAllowed(
              this.repoRoot,
              contract.authorization.file_system_scope.writable_paths,
            );
          }
          const saved = store.save(contract);
          this.emitContractUpdate(saved);
          // TASK-D.2 核心目标 1：创建即准入裁决——无交集自动批准（零点击），有交集登记白话卡
          let admission: Awaited<
            ReturnType<typeof this.orchestrator.admit>
          > | null = null;
          if (saved.lifecycle_state === "PENDING_APPROVAL") {
            admission = await this.orchestrator.admit(saved.contract_id, {
              ...(snapshotDemoGate ? { demoGate: snapshotDemoGate } : {}),
            });
            if (admission.contract.lifecycle_state !== saved.lifecycle_state) {
              this.emitContractUpdate(admission.contract);
            }
          }
          const created = admission?.contract ?? saved;
          // TASK-L.9：合同生成回填桩 status=signed + contract_id
          const createdStubId = stubIdFromContract(created);
          if (createdStubId) {
            applyContractStubTerminal(
              this.repoRoot,
              createdStubId,
              "signed",
              created.contract_id,
            );
            if (!this.activeContracts.includes(created.contract_id)) {
              this.activeContracts.push(created.contract_id);
            }
          }
          this.sendJson(res, 201, {
            contract: created,
            admission,
          });
        } catch (err) {
          if (err instanceof WritableScopePolicyError) {
            this.sendJson(res, 403, {
              error: err.message,
              code: err.code,
              rejected: err.rejected,
            });
            return;
          }
          this.sendJson(res, 400, { error: (err as Error).message });
        }
        return;
      }

      const violationMatch = pathname.match(
        /^\/api\/contracts\/([^/]+)\/gateway-violation$/,
      );
      if (violationMatch) {
        let contractId: string;
        try {
          contractId = decodeURIComponent(violationMatch[1] as string);
        } catch {
          this.sendJson(res, 400, { error: "Invalid URL encoding" });
          return;
        }
        const contract = store.get(contractId);
        if (!contract) {
          this.sendJson(res, 404, { error: "Contract not found" });
          return;
        }
        if (method === "GET") {
          const violation = loadCurrentGatewayViolation(
            this.repoRoot,
            contractId,
            contract.contract_revision,
          );
          this.sendJson(res, 200, { violation });
          return;
        }
        // 只允许用户显式清除；Worker 没有 API token，也不暴露 MCP 工具
        if (method === "DELETE") {
          const cleared = clearGatewayViolation(this.repoRoot, contractId);
          this.sendJson(res, 200, { cleared });
          return;
        }
        this.sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      // TASK-C.15b / EO-08：返工计数只读 + Daemon 权威写
      const reworkMatch = pathname.match(
        /^\/api\/contracts\/([^/]+)\/rework(?:\/(failure|assertions|split))?$/,
      );
      if (reworkMatch) {
        let contractId: string;
        try {
          contractId = decodeURIComponent(reworkMatch[1] as string);
        } catch {
          this.sendJson(res, 400, { error: "Invalid URL encoding" });
          return;
        }
        const sub = reworkMatch[2];
        const contract = store.get(contractId);
        if (!contract) {
          this.sendJson(res, 404, { error: "Contract not found" });
          return;
        }
        if (method === "GET" && !sub) {
          const rework = this.orchestrator.getReworkSnapshot(contractId);
          const delivery_state = projectDeliveryState({
            lifecycle_state: contract.lifecycle_state,
            rework_required: rework?.phase === "rework",
            escalated: rework?.phase === "escalated",
          });
          this.sendJson(res, 200, { rework, delivery_state });
          return;
        }
        if (method === "POST" && sub === "failure") {
          try {
            const body = (await this.readJsonBody(req)) as {
              assertion_id?: string;
            };
            if (!body.assertion_id) {
              this.sendJson(res, 400, { error: "assertion_id is required" });
              return;
            }
            const rework = this.orchestrator.recordAssertionFailure(
              contractId,
              body.assertion_id,
            );
            const after = store.get(contractId) ?? contract;
            this.emitContractUpdate(after);
            this.sendJson(res, 200, {
              rework,
              delivery_state: projectDeliveryState({
                lifecycle_state: after.lifecycle_state,
                rework_required: rework.phase === "rework",
                escalated: rework.phase === "escalated",
              }),
              contract: after,
            });
          } catch (err) {
            const code = (err as Error & { code?: string }).code;
            if (code === "E_ASSERTION_ID_UNKNOWN") {
              this.sendJson(res, 400, {
                error: (err as Error).message,
                code,
              });
              return;
            }
            this.sendActionError(res, err);
          }
          return;
        }
        if (method === "POST" && sub === "assertions") {
          try {
            const body = (await this.readJsonBody(req)) as { text?: string };
            if (!body.text) {
              this.sendJson(res, 400, { error: "text is required" });
              return;
            }
            const assertion_id = this.orchestrator.tryAddAssertion(
              contractId,
              body.text,
            );
            this.sendJson(res, 200, {
              assertion_id,
              rework: this.orchestrator.getReworkSnapshot(contractId),
            });
          } catch (err) {
            const code = (err as Error & { code?: string }).code;
            if (code === "E_ASSERTION_ADD_FORBIDDEN") {
              this.sendJson(res, 409, {
                error: (err as Error).message,
                code,
              });
              return;
            }
            this.sendActionError(res, err);
          }
          return;
        }
        if (method === "POST" && sub === "split") {
          try {
            const body = (await this.readJsonBody(req)) as { text?: string };
            if (!body.text) {
              this.sendJson(res, 400, { error: "text is required" });
              return;
            }
            const result = this.orchestrator.splitAssertion(
              contractId,
              body.text,
            );
            if (result.kind === "out_of_scope") {
              this.sendJson(res, 409, {
                error: result.reason,
                code: result.code,
                kind: result.kind,
              });
              return;
            }
            const after = store.get(contractId) ?? contract;
            if (result.snapshot.phase === "escalated") {
              this.emitContractUpdate(after);
            }
            this.sendJson(res, 200, { result, contract: after });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }
        this.sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const match = pathname.match(
        /^\/api\/contracts\/([^/]+)(?:\/(admit|approve|execute|run-worker|open-editor|diff-files|diff|merge-decision|merge|evidence|resume|abort)(?:\/([^/]+))?)?$/,
      );
      if (match) {
        // W.3：非法百分号编码（如 %E0%A4%A）会让 decodeURIComponent 抛 URIError，
        // 统一返回 400，避免落到外层变成 500 或泄露堆栈。
        let contractId: string;
        let subId: string | undefined;
        try {
          contractId = decodeURIComponent(match[1] as string);
          subId =
            match[3] === undefined
              ? undefined
              : decodeURIComponent(match[3] as string);
        } catch {
          this.sendJson(res, 400, { error: "Invalid URL encoding" });
          return;
        }
        const action = match[2];

        if (method === "GET" && !action) {
          const contract = store.get(contractId);
          if (!contract) {
            this.sendJson(res, 404, { error: "Contract not found" });
            return;
          }
          this.sendJson(res, 200, { contract });
          return;
        }

        // Track C：EVIDENCE_READY 推送后，控制台据此拉取完整证据包，不必等用户点执行
        if (method === "GET" && action === "evidence") {
          const snapshot = subId
            ? loadEvidenceSnapshot(this.repoRoot, contractId, subId)
            : loadLatestEvidenceSnapshot(this.repoRoot, contractId);
          if (!snapshot) {
            this.sendJson(res, 404, { error: "Evidence not found" });
            return;
          }
          this.sendJson(res, 200, { evidence: snapshot });
          return;
        }

        // TASK-D.2：显式准入裁决（供 UI 在用户点「同意」后重跑；创建时已自动执行一次）
        if (method === "POST" && action === "admit") {
          try {
            const admission = await this.orchestrator.admit(contractId);
            this.emitContractUpdate(admission.contract);
            this.sendJson(
              res,
              admission.decision === "NEEDS_APPROVAL" ? 202 : 200,
              { contract: admission.contract, admission },
            );
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "approve") {
          try {
            const body = (await this.readJsonBody(req)) as {
              reviewer?: string;
              acknowledge_dirty?: boolean;
              confirmation_id?: string;
            };
            const current = store.get(contractId);
            if (!current) {
              this.sendJson(res, 404, { error: "Contract not found" });
              return;
            }
            let demoGate: DemoSignGateDecision;
            if (body.confirmation_id) {
              const snapshot = readSchemeSnapshot(
                this.repoRoot,
                body.confirmation_id,
              );
              if (!snapshot) {
                this.sendJson(res, 409, {
                  error: "scheme_snapshot_not_found",
                  code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
                  message: "确认快照不存在或已损坏，拒绝签署",
                });
                return;
              }
              try {
                assertSignedContractMatchesSnapshot({
                  repoRoot: this.repoRoot,
                  contract: current,
                  snapshot,
                });
              } catch (scopeErr) {
                const code = (scopeErr as { code?: string }).code;
                if (code === "E_SCHEME_SNAPSHOT_NOT_FOUND") {
                  this.sendJson(res, 409, {
                    error: "scheme_snapshot_not_found",
                    code: "E_SCHEME_SNAPSHOT_NOT_FOUND",
                    message: (scopeErr as Error).message,
                  });
                  return;
                }
                if (scopeErr instanceof SchemeSnapshotMismatchError) {
                  this.sendJson(res, 409, {
                    error: "scheme_snapshot_mismatch",
                    code: scopeErr.code,
                    message: scopeErr.message,
                  });
                  return;
                }
                if (scopeErr instanceof ScopeInvariantBrokenError) {
                  this.sendJson(res, 500, {
                    error: "scope_invariant_broken",
                    code: scopeErr.code,
                    message: scopeErr.message,
                  });
                  return;
                }
                throw scopeErr;
              }
              // 与快照一致：跳过 assertContractScopeAllowed
              demoGate = evaluateSnapshotDemoGate(snapshot, (prototypeId) =>
                readDemoConfirm(this.repoRoot, prototypeId),
              );
            } else {
              assertContractScopeAllowed(
                this.repoRoot,
                current.authorization.file_system_scope.writable_paths,
              );
              // 旧路径没有快照：保守回退最新 Demo 记录；从未生成才允许。
              demoGate = evaluateLatestDemoGate(this.repoRoot);
            }
            if (!demoGate.ok) {
              this.sendJson(res, 409, {
                error: demoGate.message,
                code: demoGate.code,
                ...(demoGate.prototype_id
                  ? { prototype_id: demoGate.prototype_id }
                  : {}),
              });
              return;
            }

            const contract = await this.orchestrator.approve(
              contractId,
              body.reviewer ?? "local-user",
              {
                acknowledgeDirty: body.acknowledge_dirty === true,
                demoGate,
              },
            );
            this.emitContractUpdate(contract);
            this.sendJson(res, 200, { contract });
          } catch (err) {
            if (err instanceof WritableScopePolicyError) {
              this.sendJson(res, 403, {
                error: err.message,
                code: err.code,
                rejected: err.rejected,
              });
              return;
            }
            if (err instanceof DirtyWorktreeConfirmationRequiredError) {
              this.sendJson(res, 409, {
                error: "worktree_dirty_confirmation_required",
                code: "E_WORKTREE_DIRTY",
                message: err.message,
                dirty_count: err.dirtyFiles.length,
                dirty_files: err.dirtyFiles,
                plain_message: err.guidance.plain_message,
                exclusion_suggestions: err.guidance.exclusion_suggestions,
                dirty_exclusions: err.guidance.dirty_exclusions,
              });
              return;
            }
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "run-worker") {
          try {
            // TASK-C.11b/c：未确认 Demo 禁止写真码（Fast Path 由 skip_demo / 无 prototype 策略另判）
            try {
              assertDemoConfirmedForWrite(
                this.repoRoot,
                this.activePrototypeId ?? undefined,
                {
                  // 本轮未挂载 prototype（Fast Path / 旧路径）则跳过；挂载了就必须已确认
                  skip_demo: this.activePrototypeId == null,
                },
              );
            } catch (gateErr) {
              const code = (gateErr as Error & { code?: string }).code;
              if (code === "E_DEMO_NOT_CONFIRMED") {
                this.sendJson(res, 409, {
                  error: "Demo not confirmed",
                  code: "E_DEMO_NOT_CONFIRMED",
                  message: (gateErr as Error).message,
                });
                return;
              }
              throw gateErr;
            }
            const result = await this.orchestrator.runWorker(contractId);
            this.emitWorkerLog(contractId, result.log);
            // Worker 可能把状态推到 PENDING_RESUME（预算/循环熔断）
            const afterWorker = store.get(contractId);
            if (afterWorker) this.emitContractUpdate(afterWorker);
            this.sendJson(res, 200, { result });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "merge") {
          try {
            const body = (await this.readJsonBody(req)) as {
              reviewer?: string;
              evidence_id?: string;
            };
            if (!body.evidence_id) {
              this.sendJson(res, 400, { error: "evidence_id is required" });
              return;
            }
            const snapshot = loadEvidenceSnapshot(
              this.repoRoot,
              contractId,
              body.evidence_id,
            );
            if (!snapshot) {
              this.sendJson(res, 404, { error: "Evidence not found" });
              return;
            }
            await this.stopEvidenceWatcher();
            const result = await squashMerge({
              repoRoot: this.repoRoot,
              contractId,
              evidence: snapshot,
              reviewer: body.reviewer ?? "local-user",
            });
            // P.1：真正产生提交才关轮（授权作废、快照不再可撤）；
            // AI 改动全部被用户版本覆盖时没有提交，保留本轮与 Worktree 供 AI 重做。
            if (!result.nothingToMerge) {
              // TASK-L.5：合入后回收预览进程组，释放 4200～4210 端口
              await this.stopRealPlaytest(contractId);
              closeRound(this.repoRoot, "MERGED");
              clearCheckpoint(this.repoRoot);
              this.targetAdvancedContracts.delete(contractId);
              this.emitContractUpdate(result.contract);
              // TASK-L.9：合入回填桩 merged；从 activeContracts 移除
              const mergedStubId = stubIdFromContract(result.contract);
              if (mergedStubId) {
                applyContractStubTerminal(
                  this.repoRoot,
                  mergedStubId,
                  "merged",
                  result.contract.contract_id,
                );
              }
              this.activeContracts = this.activeContracts.filter(
                (id) => id !== contractId,
              );
            }
            const planAfterMerge = readPlan(this.repoRoot);
            const next = planAfterMerge ? nextStub(planAfterMerge) : null;
            this.sendJson(res, 200, {
              result,
              ...(next
                ? { next_stub_id: next.stub_id, next_stub: next }
                : { next_stub_id: null }),
            });
          } catch (err) {
            // D-4：目标分支已前进 → 409 + 二选一，绝不静默 rebase 或强行合并
            if (err instanceof TargetBranchAdvancedError) {
              this.targetAdvancedContracts.add(contractId);
              const contract = store.get(contractId);
              if (contract) this.emitContractUpdate(contract);
              this.sendJson(res, 409, {
                error: "Target branch has advanced",
                code: err.code,
                options: [...err.options],
                target_head: err.targetHead,
                base_head: err.baseHead,
                message:
                  "目标分支在施工期间有新的改动，请选择重演本轮改动或放弃候选成果。",
              });
              return;
            }
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "merge-decision") {
          try {
            const body = (await this.readJsonBody(req)) as {
              decision?: string;
              reviewer?: string;
            };
            const decision = body.decision;
            if (
              decision !== "REPLAY_ON_CURRENT_BASELINE" &&
              decision !== "ABANDON_CANDIDATE"
            ) {
              this.sendJson(res, 400, {
                error:
                  "decision must be REPLAY_ON_CURRENT_BASELINE or ABANDON_CANDIDATE",
              });
              return;
            }

            if (decision === "ABANDON_CANDIDATE") {
              const contract = await this.orchestrator.abort(contractId, {
                reviewer: body.reviewer ?? "local-user",
                reason: "TARGET_BRANCH_ADVANCED_ABANDON",
              });
              // TASK-L.5：放弃候选时回收预览
              await this.stopRealPlaytest(contractId);
              this.targetAdvancedContracts.delete(contractId);
              this.emitContractUpdate(contract);
              this.sendJson(res, 200, { decision, contract });
              return;
            }

            // REPLAY：合入最新基线 → 走既有验证管道 → 产出新证据
            const outcome =
              await this.orchestrator.replayOnCurrentBaseline(contractId);
            this.targetAdvancedContracts.delete(contractId);
            this.emitContractUpdate(outcome.contract);
            this.sendJson(res, 200, { decision, outcome });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "GET" && action === "diff-files") {
          // TASK-C.5 双栏 Diff：逐文件返回基线/当前两段真实内容
          let worktreePath: string;
          try {
            worktreePath = this.resolveWorktreePath(contractId);
          } catch (err) {
            this.sendJson(res, 400, {
              error: `invalid contract id: ${(err as Error).message}`,
            });
            return;
          }
          if (!fs.existsSync(worktreePath)) {
            this.sendJson(res, 404, { error: "Worktree not found" });
            return;
          }
          try {
            const baseBranch =
              store.get(contractId)?.authorization.git.base_branch ?? "main";
            const result = await readDiffFiles(worktreePath, baseBranch);
            this.sendJson(res, 200, result);
          } catch (err) {
            this.sendJson(res, 500, { error: (err as Error).message });
          }
          return;
        }

        if (method === "GET" && action === "diff") {
          let worktreePath: string;
          try {
            worktreePath = this.resolveWorktreePath(contractId);
          } catch (err) {
            this.sendJson(res, 400, {
              error: `invalid contract id: ${(err as Error).message}`,
            });
            return;
          }
          if (!fs.existsSync(worktreePath)) {
            this.sendJson(res, 404, { error: "Worktree not found" });
            return;
          }
          try {
            // 验证阶段会把 Worktree 改动 commit 到任务分支，`diff HEAD` 因此恒为空。
            // 以基线分支为参照：既包含已提交的任务改动，也包含尚未提交的现场改动。
            const baseBranch =
              store.get(contractId)?.authorization.git.base_branch ?? "main";
            const patch = execFileSync("git", ["diff", baseBranch], {
              cwd: worktreePath,
              encoding: "utf-8",
            });
            const stat = execFileSync("git", ["diff", "--stat", baseBranch], {
              cwd: worktreePath,
              encoding: "utf-8",
            });
            this.sendJson(res, 200, { patch, stat });
          } catch (err) {
            this.sendJson(res, 500, { error: (err as Error).message });
          }
          return;
        }

        if (method === "POST" && action === "open-editor") {
          try {
            const contract = store.get(contractId);
            const result = await launchEditor({
              repoRoot: this.repoRoot,
              contractId,
              template:
                contract?.authorization.execution_permissions
                  .editor_command_template,
            });
            this.sendJson(res, 200, { result });
          } catch (err) {
            this.sendJson(res, 400, { error: (err as Error).message });
          }
          return;
        }

        if (method === "POST" && action === "resume") {
          try {
            const contract = await this.orchestrator.resume(contractId);
            this.emitContractUpdate(contract);
            this.sendJson(res, 200, { contract });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }

        if (method === "POST" && action === "abort") {
          // TASK-D.3 / D-1：登记停止看门狗。回收在 15s 内未完成即强杀并转 ABORTED，
          // 避免进程树/锁悬挂把整个合同永久卡在"正在停止"。
          this.stoppingContracts.add(contractId);
          this.deadlock.beginStop(contractId);
          try {
            const body = (await this.readJsonBody(req)) as {
              reviewer?: string;
              reason?: string;
            };
            const contract = await this.orchestrator.abort(contractId, {
              ...(body.reviewer === undefined
                ? {}
                : { reviewer: body.reviewer }),
              ...(body.reason === undefined ? {} : { reason: body.reason }),
            });
            // TASK-L.5：ABORTED 时回收预览进程组
            await this.stopRealPlaytest(contractId);
            // 中止的合同若正被证据监听武装，立即解除（其 Worktree 已清理）
            if (this.armedContractId === contractId) {
              await this.stopEvidenceWatcher();
            }
            this.targetAdvancedContracts.delete(contractId);
            this.emitContractUpdate(contract);
            // TASK-L.9：ABORTED → 桩 aborted；必要时触发重新分解
            let redecompose_requested = false;
            const abortedStubId = stubIdFromContract(contract);
            if (abortedStubId) {
              const sync = applyContractStubTerminal(
                this.repoRoot,
                abortedStubId,
                "aborted",
                contract.contract_id,
              );
              if (sync?.redecompose && sync.plan) {
                const req = triggerRedecomposeIfNeeded(
                  this.repoRoot,
                  sync.plan,
                  abortedStubId,
                  contract.contract_id,
                );
                redecompose_requested = Boolean(req);
              }
            }
            this.activeContracts = this.activeContracts.filter(
              (id) => id !== contractId,
            );
            this.sendJson(res, 200, {
              contract,
              redecompose_requested,
            });
          } catch (err) {
            this.sendActionError(res, err);
          } finally {
            this.deadlock.completeStop(contractId);
            this.stoppingContracts.delete(contractId);
          }
          return;
        }

        if (method === "POST" && action === "execute") {
          try {
            const outcome = await this.orchestrator.execute(contractId);
            if (outcome.evidence.verdict.status === "PASSED") {
              await this.armEvidenceWatcher(
                contractId,
                outcome.evidence.evidence_id,
              );
            }
            this.emitContractUpdate(outcome.contract);
            this.emitEvidenceReady(contractId, outcome.evidence);
            this.sendJson(res, 200, {
              contract: outcome.contract,
              evidence: outcome.evidence,
              ...(outcome.rework ? { rework: outcome.rework } : {}),
              ...(outcome.delivery_state
                ? { delivery_state: outcome.delivery_state }
                : {}),
            });
          } catch (err) {
            this.sendActionError(res, err);
          }
          return;
        }
      }

      this.sendJson(res, 404, { error: "Not Found", path: pathname });
      return;
    }

    if (method === "POST" && pathname === "/api/shutdown") {
      if (!this.isAuthorized(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      this.sendJson(res, 200, { status: "shutting_down" });
      // Asynchronously initiate graceful shutdown without blocking response
      setImmediate(() => {
        this.stop().catch((err) => {
          console.error("[Stagent Daemon] Error during shutdown:", err);
        });
      });
      return;
    }

    // TASK-D.1b：API 未命中时尝试同源托管控制台静态资源（dist/public）
    const staticResult = tryServeConsoleStatic(req, res, this.consolePublicDir);
    if (staticResult.served) {
      return;
    }

    this.sendJson(res, 404, {
      error: "Not Found",
      path: pathname,
    });
  }

  /** TASK-C.14f：推送基线进度（与 GET /api/baseline 同形） */
  private broadcastBaselineProgress(
    archive: BaselineArchive | null,
    phase: "stub" | "p0" | "deep" | "done" | "failed" | "accepted",
  ): void {
    const scanning =
      phase === "stub" ||
      phase === "p0" ||
      phase === "deep" ||
      this.baselineScanInFlight !== null;
    this.broadcast("BASELINE_PROGRESS", {
      phase,
      scanning:
        scanning &&
        phase !== "done" &&
        phase !== "failed" &&
        phase !== "accepted",
      accept_label: "认可此基线作为后续参考",
      grants_construction: false as const,
      archive,
    });
  }

  /**
   * TASK-C.14：确保基线渐进扫在跑（打开即扫；已有进行中则复用）。
   */
  ensureBaselineScan(force = false): Promise<BaselineArchive> {
    if (!force && this.baselineScanInFlight) {
      return this.baselineScanInFlight;
    }
    const existing = getLatestBaseline(this.repoRoot);
    if (
      !force &&
      existing &&
      (existing.phase === "done" || existing.phase === "failed") &&
      existing.p0
    ) {
      return Promise.resolve(existing);
    }
    // 同步落一张「正在整理现状」桩，保证首个 GET 立刻有进度文案
    if (!existing || force) {
      const stub: BaselineArchive = {
        schema_version: "1.0.0",
        kind: "project_baseline_archive",
        scan_id: newBaselineScanId(),
        scanned_at: new Date().toISOString(),
        tool_version: this.version,
        review_status: "pending_review",
        accepted_at: null,
        grants_construction: false,
        phase: "p0",
        progress_copy: SCAN_PROGRESS_COPY.scanning,
        p0: null,
        deep: null,
        dirty: {
          clean: true,
          uncommitted: [],
          untracked: [],
          steward_message: null,
          protect_paths: [],
          dirty_exclusions: [],
        },
        os_sandbox: null,
        ignore_rules: ["node_modules/", ".git/", ".stagent/"],
        incomplete: false,
        notes: ["打开即自动扫；确认≠授权"],
      };
      writeBaselineArchive(this.repoRoot, stub);
      this.broadcastBaselineProgress(stub, "stub");
    }
    const run = runProgressiveBaselineScan({
      repoRoot: this.repoRoot,
      toolVersion: this.version,
      callbacks: {
        onP0: (archive) => {
          this.broadcastBaselineProgress(archive, "p0");
        },
        onDeep: (archive) => {
          this.broadcastBaselineProgress(archive, "deep");
        },
        onDone: (archive) => {
          const phase = archive.phase === "failed" ? "failed" : "done";
          this.broadcastBaselineProgress(archive, phase);
        },
      },
    }).finally(() => {
      if (this.baselineScanInFlight === run) {
        this.baselineScanInFlight = null;
      }
    });
    this.baselineScanInFlight = run;
    return run;
  }

  /**
   * GET  /api/baseline           —— 读最新档案；若无则触发打开即扫
   * POST /api/baseline/scan      —— 强制重扫
   * POST /api/baseline/accept    —— 「认可此基线作为后续参考」（≠授权施工）
   */

  /**
   * TASK-H.8：records 脱敏导出 / 单项目清理（本地权威，不上云）。
   * POST /api/records/export   —— 脱敏 zip
   * POST /api/records/cleanup  —— 幂等清除 .stagent/records/
   */
  private async handleRecords(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
  ): Promise<void> {
    if (method !== "POST") {
      this.sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (pathname === "/api/records/export") {
      let outPath: string | undefined;
      try {
        const body = (await this.readJsonBody(req).catch(() => ({}))) as {
          out_path?: unknown;
        };
        if (typeof body.out_path === "string" && body.out_path.trim()) {
          outPath = body.out_path.trim();
        }
      } catch {
        /* empty body ok */
      }
      const result = exportRedactedRecordsZip({
        repoRoot: this.repoRoot,
        ...(outPath ? { outPath } : {}),
      });
      this.sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    if (pathname === "/api/records/cleanup") {
      const result = cleanupProjectRecords(this.repoRoot);
      this.sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    this.sendJson(res, 404, { error: "Not found" });
  }

  private async handleBaseline(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    pathname: string,
  ): Promise<void> {
    try {
      if (method === "GET" && pathname === "/api/baseline") {
        let archive = getLatestBaseline(this.repoRoot);
        if (!archive || archive.phase === "idle") {
          void this.ensureBaselineScan();
          archive = getLatestBaseline(this.repoRoot);
        } else if (
          archive.phase === "p0" ||
          archive.phase === "p1" ||
          archive.phase === "p2"
        ) {
          void this.ensureBaselineScan();
        }
        this.sendJson(res, 200, {
          archive,
          scanning: this.baselineScanInFlight !== null,
          accept_label: "认可此基线作为后续参考",
          grants_construction: false,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/baseline/scan") {
        const archive = await this.ensureBaselineScan(true);
        this.sendJson(res, 200, {
          archive,
          scanning: false,
          accept_label: "认可此基线作为后续参考",
          grants_construction: false,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/baseline/accept") {
        let body: { scan_id?: string } = {};
        try {
          body = (await this.readJsonBody(req)) as { scan_id?: string };
        } catch {
          body = {};
        }
        const archive = acceptBaselineAsReference(
          this.repoRoot,
          typeof body.scan_id === "string" ? body.scan_id : undefined,
        );
        this.broadcastBaselineProgress(archive, "accepted");
        this.sendJson(res, 200, {
          archive,
          accepted: true,
          grants_construction: false,
          note: "已认可为后续参考；未授予施工写权，未签发 exec_token",
        });
        return;
      }

      this.sendJson(res, 404, { error: "Not Found", path: pathname });
    } catch (err) {
      this.sendJson(res, 400, { error: (err as Error).message });
    }
  }

  private installSignalHandlers(): void {
    const handleSignal = () => {
      this.stop().finally(() => {
        process.exit(0);
      });
    };

    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);

    this.signalCleanupFn = () => {
      process.removeListener("SIGINT", handleSignal);
      process.removeListener("SIGTERM", handleSignal);
    };
  }
}

function defaultChatAdapters(repoRoot: string): ChatAdapter[] {
  return [
    // TASK-J.1：右栏是方案搭档，不是施工工人——显式声明 partner（只读工具集）。
    // 不依赖 ClaudeCodeAdapter 的默认值：这一行就是「右栏绝不写主干」的唯一定义处。
    new ClaudeCodeAdapter({
      role: "partner",
      configDir: path.join(repoRoot, ".stagent", "claude-config"),
      verifiedOn: CLAUDE_CODE_VERIFIED_ON,
    }),
    new BaselineChatAdapter(),
    new DemoChatAdapter(),
  ];
}

export function createDaemon(options: DaemonServerOptions): StagentDaemon {
  return new StagentDaemon(options);
}
