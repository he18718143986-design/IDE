import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  LifecycleState,
  SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  deriveCanMerge,
  type ManualConfirmationRecord,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import { ContractStore } from "./contract-store";
import { ScopedWorktreeGateway } from "../mcp/gateway";
import {
  getExecTokenStore,
  tokenFingerprint,
  type ExecTokenStore,
} from "../core/exec-token";
import { runBoundaryStop } from "../guard/boundary-stop";
import {
  graveyardBlockMessage,
  graveyardViolationTags,
  prepareDispatchGate,
  scanWorktreeGraveyard,
  type GraveyardGateContext,
} from "../guard/graveyard-wiring";
import { WorkerScopeError } from "../worker/ai-worker";
import { loadBaselineDirtyExclusions } from "../baseline/scope-defaults";
import {
  evaluateLatestDemoGate,
  type DemoSignGateDecision,
} from "../supervisor/demo/signing-gate";
import {
  projectDeliveryState,
  type DeliveryState,
} from "../../src/lib/state/delivery-state";
import {
  loadReworkCounter,
  saveReworkCounter,
  seedReworkCounterFromAcceptance,
  recordVerificationRoundFailure,
  splitAssertionRequest,
  type SplitFlowResult,
} from "../guard/rework-store";
import {
  ReworkCounter,
  type ReworkCounterSnapshot,
} from "../guard/assertion-identity";
import { CostMonitor } from "../guard/cost-monitor";
import { LoopGuard } from "../guard/loop-guard";
import { isTestPath } from "../guard/test-integrity";
import { computeWorktreeFingerprint } from "../guard/evidence-integrity";
import {
  contractLockPath,
  withContractLock,
  InvalidStateTransitionError,
} from "../core/contract-mutex";
import { killProcessTree } from "../runner/process-tree";
import type { DeadlockResilience } from "../state/deadlock-resilience";
import { writeStateFile } from "../guard/state-store";
import {
  loadCurrentGatewayViolation,
  saveGatewayViolation,
} from "../guard/gateway-violation-store";
import {
  type WorkerChange,
  type WorkerModelClient,
  type WorkerRunResult,
} from "../worker/ai-worker";
// TASK-W.6：编排器只依赖 Registry 抽象与派工契约，不 import 具体适配器类（OCP）。
// 内置 Managed AI 工厂由 default-worker-registry 模块持有，经 Registry 注入。
import type { AdapterRegistry } from "../worker/adapter-registry";
import {
  requireControlledDispatch,
  type WorkerDispatchContext,
} from "../worker/worker-dispatch";
import { createDefaultWorkerRegistry } from "../worker/default-worker-registry";
import type { ContainerHostPort } from "../worker/sandbox/container-host";
import {
  RuntimeInterceptor,
  type GatewayViolation,
} from "../worker/runtime-interceptor";
import { assessCommandThreat, isRepoTrusted } from "../worker/threat-guard";
import { OpenAiWorkerClient } from "../worker/openai-client";
import { planDependencyStrategy, runIsolatedInstall } from "../deps/strategy";
import { mountDependencySymlink } from "../deps/resolver";
import {
  createTaskWorktree,
  DirtyWorktreeConfirmationRequiredError,
  execGit,
  getWorktreePath,
  removeTaskWorktree,
  type WorktreeInfo,
} from "../git/worktree-manager";
import type { PhaseOverlay } from "../mcp/gateway";
import {
  runTwoPhaseConstruction,
  type TwoPhaseHooks,
  type TwoPhaseResult,
} from "./two-phase-runner";
import { shouldRunTwoPhase } from "./two-phase";
import {
  runDesignStep,
  applyDesignDependencyAllow,
  designNotePath,
  type DesignNoteGenerator,
  type DesignSuspensionReason,
} from "../supervisor/design/design-step";
import type { DesignNote, DetectedEscalation } from "../../src/lib/design/design-note";
import type {
  ProjectPlan,
  ProjectPlanScheme,
  RepoFacts,
} from "../../src/lib/project/project-plan";

import {
  deriveObligations,
  detectRunner,
  obligationCommand,
  repoFactsFromPackageJson,
  type TestObligation,
} from "../../src/lib/verification/obligations";
import {
  E_OUT_OF_SCOPE_UNTRACKED,
  UntrackedScopeViolationError,
  describeUntrackedViolations,
  enforceUntrackedScope,
  type UntrackedScopePhase,
  type UntrackedScopeReport,
} from "./untracked-scope-guard";
import {
  appendSilentContractRecord,
  intersectWithProtection,
  loadRoundState,
  protectionMode,
  requestApproval,
} from "../protection/protection-list";

/**
 * 服务端合同编排器（规范 §1 / §5.2 / §6）：
 * 审批 → PREPARING（真实 Worktree）→ EXECUTING → VERIFYING（真实命令）
 * → Evidence 生成 → AUDITED（可合并）或 PENDING_RESUME（熔断）。
 */
export interface OrchestratorOptions {
  repoRoot: string;
  /** 主工作区脏时是否已获用户确认 */
  acknowledgeDirty?: boolean;
  /** TASK-C.5：验证命令输出的逐行实时回放（内容已脱敏） */
  onTerminalLine?:
    | ((contractId: string, stream: "stdout" | "stderr", line: string) => void)
    | undefined;
  /** TASK-W.4：Gateway 运行时违规广播出口 */
  onGatewayViolation?: ((violation: GatewayViolation) => void) | undefined;
  /** TASK-L.11：可注入设计步骤生成器（测试桩 / 专用 Agent） */
  designNoteGenerator?: DesignNoteGenerator | undefined;
  /**
   * TASK-W.6：受控 Worker 适配器注册表。
   * 未注入时构造默认注册表（内置 Managed AI，GATEWAY_ENFORCED），
   * 保证既有派工路径不变；测试可注入含 Fake 适配器的自定义 registry。
   */
  registry?: AdapterRegistry | undefined;
  /**
   * TASK-W.5c-ii：容器宿主端口（`SANDBOX_ENFORCED` 派工与执行用）。
   * 未注入时 `SANDBOX_ENFORCED` 一律拒绝派工（不静默降级）；真实宿主绑定归
   * `W.5c-iii`，本卡以 mock / stub 注入即可验收。
   */
  containerHost?: ContainerHostPort | undefined;
}

export interface ExecutionOutcome {
  contract: SoftwareContract;
  evidence: EvidenceBundle;
  worktree: WorktreeInfo;
  /** TASK-C.15b：本轮验证后的返工计数快照（若有） */
  rework?: ReworkCounterSnapshot;
  /** TASK-C.15b：投影交付态（REWORK_REQUIRED / ESCALATED_HUMAN …） */
  delivery_state?: DeliveryState;
}

/**
 * TASK-D.3 / D-4：重演时与最新基线冲突。
 *
 * 用独立错误类而不是裸 `Error`，是为了让 HTTP 层能透出机器可读的 `code`：
 * 前端据此仍可给用户"放弃候选成果"这条路，而不是只看到一段中文。
 */
export class ReplayConflictError extends Error {
  readonly code = "E_REPLAY_CONFLICT";
  constructor(detail: string) {
    super(
      `[E_REPLAY_CONFLICT] 目标分支与任务分支存在冲突，无法自动重演：${detail}。` +
        `请选择放弃候选成果，或人工解决冲突后重新验证`,
    );
    this.name = "ReplayConflictError";
  }
}

/** 单条验证命令的执行事实（写入 Evidence 前的中间形态，TASK-W.2b 复用） */
interface VerificationResultInput {
  alias: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

/** TASK-D.2：审批前的准入裁决（合同 Scope × 保护清单） */
export type AdmissionDecision =
  "AUTO_APPROVED" | "AUTO_APPROVAL_FAILED" | "NEEDS_APPROVAL" | "SKIPPED";

export interface AdmissionResult {
  decision: AdmissionDecision;
  contract: SoftwareContract;
  /** 白话原因：用于卡片提示与日志，不暴露错误码 */
  reason?: string | undefined;
  /** 命中的受保护条目（无交集时为空） */
  protectedFiles: string[];
  entryNames: string[];
  /** NEEDS_APPROVAL 时的待审批卡 id */
  cardId?: string | undefined;
}

export interface DesignRunInfo {
  status: "ok" | "suspended";
  reason?: DesignSuspensionReason;
  detail?: string;
  note?: DesignNote | null;
  escalation_missed?: DetectedEscalation[];
}


/** TASK-L.12：把 check-knowledge 占位 SHA / 合同号换成真实值，并挂上 design-note 路径。 */
function resolveKnowledgeCheckArgs(
  args: readonly string[],
  ctx: {
    baseSha: string;
    candidateSha: string;
    contractId: string;
    worktreePath: string;
    designNoteFile: string | null;
  },
): string[] {
  const next = [...args];
  const setFlag = (name: string, value: string): void => {
    const idx = next.indexOf(name);
    if (idx >= 0 && idx + 1 < next.length) {
      next[idx + 1] = value;
    } else {
      next.push(name, value);
    }
  };
  setFlag("--base", ctx.baseSha);
  setFlag("--candidate", ctx.candidateSha);
  setFlag("--contract-id", ctx.contractId);
  setFlag("--worktree", ctx.worktreePath);
  if (ctx.designNoteFile) {
    setFlag("--design-note", ctx.designNoteFile);
  }
  // 清掉未替换的占位符（防御）
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] === "__STAGENT_BASE_SHA__") next[i] = ctx.baseSha;
    if (next[i] === "__STAGENT_CANDIDATE_SHA__") next[i] = ctx.candidateSha;
    if (next[i] === "__STAGENT_CONTRACT_ID__") next[i] = ctx.contractId;
  }
  return next;
}

export class ContractOrchestrator {
  private readonly repoRoot: string;
  private readonly store: ContractStore;
  private readonly acknowledgeDirty: boolean;
  private readonly onTerminalLine?:
    | ((contractId: string, stream: "stdout" | "stderr", line: string) => void)
    | undefined;
  private readonly onGatewayViolation?:
    ((violation: GatewayViolation) => void) | undefined;
  /** TASK-L.11 */
  private readonly designNoteGenerator: DesignNoteGenerator | undefined;
  /** 在途执行（execute/runWorker）的中止控制器：abort 端点凭此强杀子进程树 */
  private readonly abortControllers = new Map<string, AbortController>();
  /** 已请求中止但执行尚未开始的合同：注册控制器时立即进入已中止态 */
  private readonly abortRequested = new Set<string>();
  /**
   * TASK-D.3 / D-5：命令超时看门狗。
   * 由 Daemon 注入（单一租约/看门狗表），orchestrator 不自建第二套。
   */
  private deadlock: DeadlockResilience | null = null;
  /** TASK-C.12a：合同 → 当前有效 exec_token 明文（仅进程内；日志用指纹） */
  private readonly activeExecTokens = new Map<string, string>();
  private readonly execTokenStore: ExecTokenStore = getExecTokenStore();
  /** TASK-J.18d：合同 → 派工墓地上下文（resume / buildRuntime 复用） */
  private readonly graveyardGates = new Map<string, GraveyardGateContext>();
  /** TASK-W.6：受控适配器注册表（默认内置 Managed AI） */
  private readonly workerRegistry: AdapterRegistry;
  /** TASK-W.5c-ii：容器宿主端口（未注入 → SANDBOX_ENFORCED 拒绝派工） */
  private readonly containerHost: ContainerHostPort | undefined;

  constructor(options: OrchestratorOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.store = new ContractStore(this.repoRoot);
    this.acknowledgeDirty = options.acknowledgeDirty ?? false;
    this.onTerminalLine = options.onTerminalLine;
    this.onGatewayViolation = options.onGatewayViolation;
    this.designNoteGenerator = options.designNoteGenerator;
    this.workerRegistry =
      options.registry ?? createDefaultWorkerRegistry();
    this.containerHost = options.containerHost;
  }

  /** TASK-W.6：诊断 / 设置面可读取当前已注册适配器 id 列表 */
  listRegisteredAdapters(): ReturnType<AdapterRegistry["list"]> {
    return this.workerRegistry.list();
  }

  /** 测试/诊断：当前合同是否持有有效 exec_token */
  hasActiveExecToken(contractId: string): boolean {
    const t = this.activeExecTokens.get(contractId);
    return Boolean(t && this.execTokenStore.hasActiveToken(t));
  }

  getActiveExecTokenFingerprint(contractId: string): string | null {
    const t = this.activeExecTokens.get(contractId);
    return t ? tokenFingerprint(t) : null;
  }

  /** PAUSED / 越界：吊销施工写权 */
  revokeExecTokenFor(contractId: string): boolean {
    this.activeExecTokens.delete(contractId);
    return this.execTokenStore.revokeExecToken(contractId);
  }

  private issueExecForContract(
    contract: SoftwareContract,
    worktreePath: string,
  ): string {
    const writable =
      contract.authorization.file_system_scope.writable_paths ?? [];
    const issued = this.execTokenStore.issueExecToken({
      contract_id: contract.contract_id,
      worktree: path.resolve(worktreePath),
      writable_paths: writable,
    });
    this.activeExecTokens.set(contract.contract_id, issued.token);
    return issued.token;
  }

  /** TASK-W.8：活动 Gateway 实例（供 Daemon MCP HTTP 端点动态调用与审计） */
  private activeGateway: ScopedWorktreeGateway | null = null;
  private readonly activeGateways = new Map<string, ScopedWorktreeGateway>();

  public getActiveGateway(contractId?: string): ScopedWorktreeGateway | null {
    if (contractId) {
      return this.activeGateways.get(contractId) ?? null;
    }
    return this.activeGateway;
  }

  public setActiveGateway(
    contractId: string,
    gateway: ScopedWorktreeGateway | null,
  ): void {
    if (gateway) {
      this.activeGateway = gateway;
      this.activeGateways.set(contractId, gateway);
    } else {
      this.activeGateways.delete(contractId);
      if (this.activeGateway === gateway || this.activeGateways.size === 0) {
        this.activeGateway = null;
      }
    }
  }

  /** TASK-D.3：由 Daemon 注入看门狗实例（同一张表，避免各层各自判死） */
  setDeadlock(resilience: DeadlockResilience | null): void {
    this.deadlock = resilience;
  }

  getStore(): ContractStore {
    return this.store;
  }

  /** TASK-C.15b：只读返工快照（Worker/LLM 只读） */
  getReworkSnapshot(contractId: string): ReworkCounterSnapshot | null {
    const c = loadReworkCounter(this.repoRoot, contractId);
    return c ? c.snapshot() : null;
  }

  /**
   * TASK-C.15b：Daemon 权威记一次断言失败。
   * 超限 → phase escalated；调用方应吊销 token / 暂停。
   */
  recordAssertionFailure(
    contractId: string,
    assertionId: string,
  ): ReworkCounterSnapshot {
    let counter = loadReworkCounter(this.repoRoot, contractId);
    if (!counter) {
      const contract = this.store.get(contractId);
      if (!contract) throw new Error(`Contract not found: ${contractId}`);
      counter = new ReworkCounter(contractId);
      if (counter.currentPhase === "normal") {
        counter.registerAssertions(contract.intent.acceptance_criteria);
      }
    }
    const snap = counter.recordFailure(assertionId);
    saveReworkCounter(this.repoRoot, counter);
    if (counter.isEscalated) {
      this.revokeExecTokenFor(contractId);
      const cur = this.store.get(contractId);
      if (
        cur &&
        (cur.lifecycle_state === "EXECUTING" ||
          cur.lifecycle_state === "VERIFYING")
      ) {
        this.store.transition({
          contractId,
          lifecycleState: "PENDING_RESUME",
        });
      }
    }
    return snap;
  }

  /** TASK-C.15b：尝试追加断言；返工期必拒 */
  tryAddAssertion(contractId: string, text: string): string {
    let counter = loadReworkCounter(this.repoRoot, contractId);
    if (!counter) {
      counter = new ReworkCounter(contractId);
    }
    const id = counter.tryAddAssertion(text);
    saveReworkCounter(this.repoRoot, counter);
    return id;
  }

  /** TASK-C.15b：拆流钩子（老断言返工 vs 新需求 Out-of-Scope） */
  splitAssertion(contractId: string, assertionText: string): SplitFlowResult {
    const result = splitAssertionRequest(
      this.repoRoot,
      contractId,
      assertionText,
    );
    if (
      result.kind === "rework_existing" &&
      result.snapshot.phase === "escalated"
    ) {
      this.revokeExecTokenFor(contractId);
      const cur = this.store.get(contractId);
      if (
        cur &&
        (cur.lifecycle_state === "EXECUTING" ||
          cur.lifecycle_state === "VERIFYING")
      ) {
        this.store.transition({
          contractId,
          lifecycleState: "PENDING_RESUME",
        });
      }
    }
    return result;
  }

  /** 签署后冻结验收断言 */
  private seedReworkOnApprove(
    contract: SoftwareContract,
  ): ReworkCounterSnapshot {
    return seedReworkCounterFromAcceptance(
      this.repoRoot,
      contract.contract_id,
      contract.intent.acceptance_criteria,
    );
  }

  /**
   * 用户审批：PENDING_APPROVAL/PENDING_REVIEW → APPROVED → PREPARING → EXECUTING。
   * 全程持有合同排他锁：并发的第二次审批会在锁内读到已推进的状态，
   * 抛 E_INVALID_STATE_TRANSITION，杜绝重复建 Worktree / 重复分支。
   */
  async approve(
    contractId: string,
    reviewer: string,
    options?: {
      acknowledgeDirty?: boolean;
      /** 新主路径由 Daemon HTTP 层按冻结快照求值后传入；旧路径回退最新记录。 */
      demoGate?: DemoSignGateDecision;
    },
  ): Promise<SoftwareContract> {
    return withContractLock(
      contractLockPath(this.repoRoot, contractId),
      async () => {
        const current = this.store.get(contractId);
        if (!current) throw new Error(`Contract not found: ${contractId}`);
        if (current.lifecycle_state !== "PENDING_APPROVAL") {
          throw new InvalidStateTransitionError(
            current.lifecycle_state,
            ["PENDING_APPROVAL"],
            "approve",
          );
        }

        // TASK-C.22 / SSOT v2.0.2：Demo 门禁对“已生成未确认”也必须拒绝。
        // 新主路径传入快照求值结果；旧路径回退最新 Demo 记录。
        {
          const demoGate =
            options?.demoGate ?? evaluateLatestDemoGate(this.repoRoot);
          if (!demoGate.ok) {
            const err = new Error(
              `[${demoGate.code}] ${demoGate.message}`,
            ) as Error & { code?: string };
            err.code = demoGate.code;
            throw err;
          }
        }

        const approvedAt = new Date().toISOString();
        // 先落审批事实，再进入准备阶段（§9.1.1：避免只更新其中一个字段）
        // approved_revision 绑定被批准的合同版本：任何后续 Scope/预算变更都会
        // 递增 contract_revision，从而让本次审批失效（防 TOCTOU，§9.1）
        this.store.transition({
          contractId,
          lifecycleState: "PREPARING",
          approvalStatus: "APPROVED",
          approvedBy: reviewer,
          approvedAt,
          approvedRevision: current.contract_revision,
        });

        const acknowledgeDirty =
          options?.acknowledgeDirty === true || this.acknowledgeDirty;

        try {
          await createTaskWorktree({
            repoRoot: this.repoRoot,
            contractId,
            baseBranch: current.authorization.git.base_branch,
            acknowledgeDirty,
          });
          // 依赖复用/隔离决策（ADR-002）
          await this.prepareDependencies(contractId);
          const executing = this.store.transition({
            contractId,
            lifecycleState: "EXECUTING",
          });
          // TASK-J.18d：派工前绑定校验 + gate pack；失败不签发
          const wt = getWorktreePath(this.repoRoot, contractId);
          const gatePrep = await prepareDispatchGate(this.repoRoot, executing);
          if (!gatePrep.ok) {
            await this.writeEvidence(executing, {
              status: "BLOCKED",
              reasonCode: "PREPARATION_INTERRUPTED",
              summary: `[${gatePrep.code}] ${gatePrep.message}`,
              verificationResults: [],
              scopePassed: false,
              forbiddenViolations: [],
              modifiedFiles: [],
            });
            // 回退待批：快照对不上需重新确认
            return this.store.transition({
              contractId,
              lifecycleState: "PENDING_APPROVAL",
              approvalStatus: "PENDING_REVIEW",
            });
          }
          this.graveyardGates.set(contractId, gatePrep.context);
          // TASK-C.12a：签署开工后签发 exec_token
          this.issueExecForContract(executing, wt);
          // TASK-C.15b：签署开工时冻结 assertion_id 集合
          this.seedReworkOnApprove(executing);
          return executing;
        } catch (err) {
          // 脏主仓未确认：回退待批并抛给 API，由前端带 acknowledge_dirty 重试
          if (err instanceof DirtyWorktreeConfirmationRequiredError) {
            this.store.transition({
              contractId,
              lifecycleState: "PENDING_APPROVAL",
              approvalStatus: "PENDING_REVIEW",
            });
            throw err;
          }
          // 准备中断：回退等待重新审批，并留存原因
          await this.writeEvidence(current, {
            status: "BLOCKED",
            reasonCode: "PREPARATION_INTERRUPTED",
            summary: `Preparation failed: ${(err as Error).message}`,
            verificationResults: [],
            scopePassed: false,
            forbiddenViolations: [],
            modifiedFiles: [],
          });
          return this.store.transition({
            contractId,
            lifecycleState: "PENDING_APPROVAL",
            approvalStatus: "PENDING_REVIEW",
          });
        }
      },
    );
  }

  /**
   * TASK-D.2 核心目标 1：审批准入裁决（合同 Scope × 全局保护清单）。
   *
   * - **无交集**：写 `.stagent/silent-contracts.jsonl` 备案后直接自动批准并推进到
   *   `PREPARING → EXECUTING`，前端零弹窗、用户零点击；
   * - **有交集**：停在 `PENDING_APPROVAL`，登记一张白话待审批卡，等待用户显式决策；
   * - **失败关闭**：清单读取/规则比对异常一律按「有冲突」阻断，绝不静默放行；
   * - **幂等**：合同不处于待审批态时返回 `SKIPPED`，重复调用不会重建 Worktree。
   */
  async admit(
    contractId: string,
    options?: { demoGate?: DemoSignGateDecision },
  ): Promise<AdmissionResult> {
    const current = this.store.get(contractId);
    if (!current) throw new Error(`Contract not found: ${contractId}`);

    if (
      current.lifecycle_state !== "PENDING_APPROVAL" ||
      current.approval.status !== "PENDING_REVIEW"
    ) {
      return {
        decision: "SKIPPED",
        contract: current,
        reason: `合同不处于待审批态（${current.lifecycle_state} / ${current.approval.status}）`,
        protectedFiles: [],
        entryNames: [],
      };
    }

    const scope = current.authorization.file_system_scope.writable_paths;
    const verdict = intersectWithProtection(this.repoRoot, scope);

    // 失败关闭：判定过程出错 → 一律视为有冲突，直接阻断（不自动批准、不建 Worktree）
    if (verdict.error) {
      appendSilentContractRecord(this.repoRoot, {
        kind: "contract_admission_fail_closed",
        contract_id: contractId,
        error: verdict.error,
        scope,
      });
      return {
        decision: "NEEDS_APPROVAL",
        contract: current,
        reason: `保护清单判定失败，已按「有冲突」阻断：${verdict.error}`,
        protectedFiles: verdict.files.length > 0 ? verdict.files : scope,
        entryNames: verdict.entryNames,
      };
    }

    const state = loadRoundState(this.repoRoot);
    const approvedThisRound = verdict.files.filter((f) =>
      state.approvedFiles.includes(f),
    );
    const deniedThisRound = verdict.files.filter((f) =>
      state.deniedFiles.includes(f),
    );
    const outstanding = verdict.files.filter(
      (f) => !state.approvedFiles.includes(f) && !state.deniedFiles.includes(f),
    );
    // 只有「每一个交集文件都已在本轮被同意」才允许自动批准；
    // 任一被拒绝即阻断（拒绝优先于同意，绝不被 approvedFiles 掩盖）。
    const allApproved =
      verdict.files.length > 0 &&
      approvedThisRound.length === verdict.files.length;

    // 无交集，或交集文件已全部在本轮被用户明确同意 → 自动批准
    if (
      verdict.files.length === 0 ||
      (allApproved && deniedThisRound.length === 0)
    ) {
      appendSilentContractRecord(this.repoRoot, {
        kind: "contract_auto_approved",
        contract_id: contractId,
        mode: verdict.hit
          ? "PROTECTED_AUTHORIZED"
          : protectionMode(this.repoRoot),
        scope,
        protected_files: verdict.files,
        approved_this_round: approvedThisRound,
      });
      try {
        const approved = await this.approve(contractId, "stagent-auto", {
          ...(options?.demoGate ? { demoGate: options.demoGate } : {}),
        });
        return {
          decision: "AUTO_APPROVED",
          contract: approved,
          reason: verdict.hit
            ? "合同范围已在本轮获得授权，自动批准"
            : "合同范围未触碰保护清单，自动批准",
          protectedFiles: verdict.files,
          entryNames: verdict.entryNames,
        };
      } catch (err) {
        // 并发下第二次调用会撞上状态机（已推进到 PREPARING/EXECUTING）：
        // 这不是失败，按 SKIPPED 处理，避免把正常并发报成错误。
        if (err instanceof InvalidStateTransitionError) {
          return {
            decision: "SKIPPED",
            contract: this.store.get(contractId) ?? current,
            reason: "合同已被另一次准入推进，跳过重复批准",
            protectedFiles: verdict.files,
            entryNames: verdict.entryNames,
          };
        }
        return {
          decision: "AUTO_APPROVAL_FAILED",
          contract: this.store.get(contractId) ?? current,
          reason: `自动批准未完成：${(err as Error).message}`,
          protectedFiles: verdict.files,
          entryNames: verdict.entryNames,
        };
      }
    }

    // 本轮已拒绝过同一受保护文件：直接阻断，不重复弹卡
    if (deniedThisRound.length > 0) {
      return {
        decision: "NEEDS_APPROVAL",
        contract: current,
        reason: `你本轮已拒绝修改受保护文件：${deniedThisRound.join("、")}`,
        protectedFiles: verdict.files,
        entryNames: verdict.entryNames,
      };
    }

    // 有交集且未授权：登记一张白话卡片（列出本轮全部受保护文件），等待用户显式决策
    const { card } = requestApproval(
      this.repoRoot,
      outstanding,
      verdict.entryNames,
    );
    appendSilentContractRecord(this.repoRoot, {
      kind: "contract_pending_user",
      contract_id: contractId,
      card_id: card.id,
      protected_files: outstanding,
      entry_names: verdict.entryNames,
    });
    return {
      decision: "NEEDS_APPROVAL",
      contract: current,
      reason: "合同范围触碰保护清单，需要你确认后才会开工",
      protectedFiles: outstanding,
      entryNames: verdict.entryNames,
      cardId: card.id,
    };
  }

  /**
   * 断点续跑（Chaos 场景 1）：崩溃恢复把 EXECUTING/VERIFYING 挂起到 PENDING_RESUME 后，
   * 必须由用户显式确认才能回到 EXECUTING；Worktree 已丢失则拒绝续跑。
   * 没有这个出口，PENDING_RESUME 就是事实上的永久卡死态。
   */
  async resume(contractId: string): Promise<SoftwareContract> {
    return withContractLock(
      contractLockPath(this.repoRoot, contractId),
      async () => {
        const current = this.store.get(contractId);
        if (!current) throw new Error(`Contract not found: ${contractId}`);
        if (current.lifecycle_state !== "PENDING_RESUME") {
          throw new InvalidStateTransitionError(
            current.lifecycle_state,
            ["PENDING_RESUME"],
            "resume",
          );
        }

        const worktreePath = getWorktreePath(this.repoRoot, contractId);
        if (!fs.existsSync(worktreePath)) {
          throw new Error(
            `Cannot resume ${contractId}: worktree lost at ${worktreePath}`,
          );
        }
        // Worktree 必须仍然是健康的 Git 工作区（崩溃可能留下 index.lock / 断头）
        const head = await execGit(["rev-parse", "HEAD"], worktreePath);
        if (head.exitCode !== 0) {
          throw new Error(
            `Cannot resume ${contractId}: worktree is not a healthy git workspace (${head.stderr || head.stdout})`,
          );
        }

        // TASK-C.12a：一次性 resume_token(jti) → 新 exec_token
        this.revokeExecTokenFor(contractId);
        const worktreeResolved = path.resolve(worktreePath);
        const resume = this.execTokenStore.issueResumeToken({
          contract_id: contractId,
        });
        const writable =
          current.authorization.file_system_scope.writable_paths ?? [];
        const issued = this.execTokenStore.consumeResumeToken(resume.token, {
          worktree: worktreeResolved,
          writable_paths: writable,
        });
        this.activeExecTokens.set(contractId, issued.token);

        return this.store.transition({
          contractId,
          lifecycleState: "EXECUTING",
        });
      },
    );
  }

  /**
   * 用户主动中止/驳回（终态 ABORTED）：
   * 1. 不持锁先触发 AbortSignal —— 在途验证命令整树 SIGTERM→3s→SIGKILL 强杀，
   *    后续命令被网关 E_TASK_ABORTED 拒绝，execute 循环立即收尾并释放合同锁；
   * 2. 持锁后合规流转：待审批态走驳回语义（REJECTED），已批准任务保留 APPROVED
   *    （§9.1.1 允许 ABORTED × REJECTED/APPROVED 两种组合）；
   * 3. 清理 Worktree 与任务分支，终态不留现场。
   */
  async abort(
    contractId: string,
    options: { reviewer?: string; reason?: string } = {},
  ): Promise<SoftwareContract> {
    const reviewer = options.reviewer ?? "local-user";
    this.abortRequested.add(contractId);
    this.abortControllers.get(contractId)?.abort();
    try {
      return await withContractLock(
        contractLockPath(this.repoRoot, contractId),
        async () => {
          const current = this.store.get(contractId);
          if (!current) throw new Error(`Contract not found: ${contractId}`);
          const abortable: LifecycleState[] = [
            "DRAFT",
            "PENDING_APPROVAL",
            "PREPARING",
            "EXECUTING",
            "VERIFYING",
            "PENDING_RESUME",
            "AUDITED",
          ];
          if (!abortable.includes(current.lifecycle_state)) {
            throw new InvalidStateTransitionError(
              current.lifecycle_state,
              abortable,
              "abort",
            );
          }

          const worktreePath = getWorktreePath(this.repoRoot, contractId);
          if (fs.existsSync(worktreePath)) {
            await removeTaskWorktree({
              repoRoot: this.repoRoot,
              contractId,
              force: true,
              deleteBranch: true,
            });
          }

          const rejected = current.approval.status !== "APPROVED";
          return this.store.transition({
            contractId,
            lifecycleState: "ABORTED",
            ...(rejected ? { approvalStatus: "REJECTED" as const } : {}),
            rejectionReason: options.reason ?? `Aborted by ${reviewer}`,
          });
        },
      );
    } finally {
      this.abortRequested.delete(contractId);
    }
  }

  /**
   * TASK-L.11 DN-2：用户在意外卡选「可以」装新库。
   * 快照合同文件字节 → 仅写计划插入 dependency 桩 → 再 abort。
   * 不改已签合同的授权字段（dependency_changes_allowed 等）。
   */
  async resolveDesignDependencyAllow(
    contractId: string,
    input: {
      plan: ProjectPlan;
      scheme: ProjectPlanScheme;
      repoFacts: RepoFacts;
      originalStubId: string;
      dependencies: Array<{ name: string; version: string; why: string }>;
      reason?: string;
    },
  ): Promise<{
    aborted: SoftwareContract;
    plan: ProjectPlan;
    dependencyStubId: string;
    contractBytesBeforeAllow: string;
    contractBytesAfterAllow: string;
  }> {
    const contractPath = this.store.filePath(contractId);
    const contractBytesBeforeAllow = fs.readFileSync(contractPath, "utf8");
    const applied = applyDesignDependencyAllow({
      repoRoot: this.repoRoot,
      contractFileBytes: contractBytesBeforeAllow,
      plan: input.plan,
      scheme: input.scheme,
      repoFacts: input.repoFacts,
      originalStubId: input.originalStubId,
      dependencies: input.dependencies,
    });
    if (!applied.ok) {
      throw new Error(`[${applied.code}] ${applied.message}`);
    }
    const contractBytesAfterAllow = fs.readFileSync(contractPath, "utf8");
    const aborted = await this.abort(contractId, {
      reviewer: "local-user",
      reason:
        input.reason ??
        "DN-2: user allowed new dependency; aborting for re-sign after dependency stub",
    });
    return {
      aborted,
      plan: applied.plan,
      dependencyStubId: applied.dependencyStubId,
      contractBytesBeforeAllow,
      contractBytesAfterAllow,
    };
  }

  /** 注册本次执行的中止控制器；若 abort 已先行到达则直接以中止态注册 */
  private beginAbortable(contractId: string): AbortSignal {
    const controller = new AbortController();
    if (this.abortRequested.has(contractId)) controller.abort();
    this.abortControllers.set(contractId, controller);
    return controller.signal;
  }

  private endAbortable(contractId: string): void {
    this.abortControllers.delete(contractId);
  }

  /**
   * 执行合同验证命令并生成 Evidence。
   * 合同排他锁 + 锁内重读状态：并发的第二次 execute 会看到 VERIFYING/AUDITED，
   * 抛 E_INVALID_STATE_TRANSITION，不会产生两份 Evidence 或重复提交。
   */
  async execute(contractId: string): Promise<ExecutionOutcome> {
    return withContractLock(contractLockPath(this.repoRoot, contractId), () =>
      this.executeInternal(contractId),
    );
  }

  private async executeInternal(contractId: string): Promise<ExecutionOutcome> {
    const signal = this.beginAbortable(contractId);
    try {
      return await this.executeWithSignal(contractId, signal);
    } finally {
      this.endAbortable(contractId);
    }
  }

  private async executeWithSignal(
    contractId: string,
    signal: AbortSignal,
  ): Promise<ExecutionOutcome> {
    const current = this.store.get(contractId);
    if (!current) throw new Error(`Contract not found: ${contractId}`);
    if (current.lifecycle_state !== "EXECUTING") {
      throw new InvalidStateTransitionError(
        current.lifecycle_state,
        ["EXECUTING"],
        "execute",
      );
    }

    const { gateway, costMonitor, loopGuard, worktreePath, interceptor } =
      this.buildRuntime(current, signal);

    this.store.transition({ contractId, lifecycleState: "VERIFYING" });

    // 测试完整性留痕：提交前捕获 Worktree 改动（覆盖外部编辑器等旁路写入）
    // -uall：未跟踪目录不折叠，否则 tests/ 会被折叠成 "tests" 而识别不出测试文件
    const preCommitStatus = await execGit(
      ["status", "--porcelain", "-uall"],
      worktreePath,
    );

    // TASK-W.2b：执行前未跟踪文件守卫。
    // 必须早于 commitWorktree——`git add -A` 一旦把越界文件做进提交，
    // 它们就变成已跟踪文件，`git diff --name-only` 再也区分不出来。
    await this.assertUntrackedScope({
      contract: current,
      worktreePath,
      phase: "PRE_EXECUTION",
      costMonitor,
    });

    // 规范 §5.2：Evidence 必须对应真实任务提交；合并前将 Worktree 改动固化到任务分支
    await this.commitWorktree(worktreePath, contractId);

    const verificationResults: VerificationResultInput[] = [];
    const portConflictAliases: string[] = [];
    const threatBlockedAliases: string[] = [];
    // W.4：执行前信任校验；真实 Worktree 带 .git 文件，视为已信任仓库
    const repoTrusted = isRepoTrusted(worktreePath);

    for (const command of current.verification_spec.commands) {
      // W.4：运行时复检降级后，内部验证调用不再豁免，直接跳过且不产生子进程
      if (interceptor.isStopped() || !interceptor.canProduceEvidence()) {
        threatBlockedAliases.push(command.alias);
        verificationResults.push({
          alias: command.alias,
          exitCode: 1,
          stdout: "",
          stderr: "运行时复检已降级为 UNCONTROLLED_EXTERNAL，受控执行停止",
          durationMs: 0,
          passed: false,
        });
        continue;
      }

      // TASK-L.12：check-knowledge 占位符 → 真实 base/candidate/合同号
      let commandArgs = [...command.args];
      if (
        command.alias === "check-knowledge" ||
        (command.executable === "stagent" &&
          command.args[0] === "check" &&
          command.args[1] === "knowledge")
      ) {
        const candidateSha =
          this.syncGit(worktreePath, ["rev-parse", "HEAD"]) ?? "HEAD";
        const baseSha =
          this.syncGit(this.repoRoot, [
            "rev-parse",
            current.authorization.git.base_branch,
          ]) ?? candidateSha;
        const dnFile = designNotePath(
          this.repoRoot,
          current.contract_id,
        );
        commandArgs = resolveKnowledgeCheckArgs(commandArgs, {
          baseSha,
          candidateSha,
          contractId: current.contract_id,
          worktreePath,
          designNoteFile: fs.existsSync(dnFile) ? dnFile : null,
        });
      }

      // W.4：威胁守卫必须在创建子进程之前；拒绝即跳过 gateway，不产生任何进程
      const threat = assessCommandThreat({
        executable: command.executable,
        args: commandArgs,
        worktreeRoot: worktreePath,
        repoTrusted,
      });
      if (!threat.allowed) {
        threatBlockedAliases.push(command.alias);
        verificationResults.push({
          alias: command.alias,
          exitCode: 1,
          stdout: "",
          stderr: threat.reason,
          durationMs: 0,
          passed: false,
        });
        continue;
      }

      const res = await gateway.callTool(
        "stagent_exec_command",
        {
          executable: command.executable,
          args: commandArgs,
        },
        { internal: true },
      );
      const data = (res.data ?? {}) as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        durationMs?: number;
      };
      if (res.error?.code === "E_PORT_CONFLICT") {
        portConflictAliases.push(command.alias);
      }
      verificationResults.push({
        alias: command.alias,
        exitCode: data.exitCode ?? 1,
        stdout: data.stdout ?? "",
        stderr: data.stderr ?? (res.error?.message || ""),
        durationMs: data.durationMs ?? 0,
        passed: !res.isError,
      });
    }

    // 验证命令也可能在 Worktree 内写文件（commit 之后），再次捕获并取并集
    const postVerifyStatus = await execGit(
      ["status", "--porcelain", "-uall"],
      worktreePath,
    );

    // TASK-W.2b：验收前再查一次未跟踪文件。
    // 验证命令（测试脚本、构建脚本）会绕过网关直接落盘，这是网关拦不到的
    // 第二条通道；命中越界同样阻断，绝不产出 PASSED 证据。
    const postVerifyScope = await this.assertUntrackedScope({
      contract: current,
      worktreePath,
      phase: "POST_VERIFICATION",
      costMonitor,
      verificationResults,
    });

    // TASK-J.18d：POST_VERIFICATION 墓地全量扫描
    await this.assertGraveyardScan({
      contract: current,
      worktreePath,
      phase: "POST_VERIFICATION",
      costMonitor,
      verificationResults,
    });

    const worktreeChanged = [
      ...parsePorcelainPaths(preCommitStatus.stdout),
      ...parsePorcelainPaths(postVerifyStatus.stdout),
    ];

    const modifiedFiles = [...gateway.getModifiedFiles()];
    const testsModified =
      gateway.wasTestsModified() || worktreeChanged.some(isTestPath);
    const zeroCommands = verificationResults.length === 0;
    // G1 守卫条款：verificationResults 为空时不能取 every 的空真值 true（防假绿）
    const allPassed =
      !zeroCommands && verificationResults.every((r) => r.passed);
    const tripped = loopGuard.isTripped() || costMonitor.isTripped();
    // 只有「除端口冲突外没有别的失败」时，才把整轮归因为端口冲突；
    // 若同时存在断言失败，仍按 FAILED/UNSAFE_EXECUTION 处理。
    const failedNonPort = verificationResults.some(
      (r) => !r.passed && !portConflictAliases.includes(r.alias),
    );
    const portConflict = portConflictAliases.length > 0 && !failedNonPort;
    const threatBlocked = threatBlockedAliases.length > 0;
    const interceptorBlocked =
      interceptor.isStopped() ||
      !interceptor.canProduceEvidence() ||
      loadCurrentGatewayViolation(
        this.repoRoot,
        current.contract_id,
        current.contract_revision,
      ) !== null;

    // 零命令合同（兜底语义）：不得判 PASSED，置为非 PASSED 的兜底阻断状态，
    // 直到补齐人工确认记录（对齐 N-⑩ 与 G1 守卫条款）。
    const zeroCommandsBlocked = zeroCommands;

    // 端口冲突属于环境问题，不按断言失败处理：BLOCKED + E_PORT_CONFLICT，
    // 由用户清理端口后重跑，而不是让 Worker 误以为用例写错去改代码。
    const status = interceptorBlocked
      ? "BLOCKED"
      : threatBlocked
        ? "BLOCKED"
        : portConflict
          ? "BLOCKED"
          : zeroCommandsBlocked
            ? "BLOCKED"
            : allPassed
              ? "PASSED"
              : tripped
                ? "BLOCKED"
                : "FAILED";
    const knowledgeFailed = verificationResults.some(
      (r) => !r.passed && r.alias === "check-knowledge",
    );
    const reasonCode = interceptorBlocked
      ? ("UNSAFE_EXECUTION" as const)
      : threatBlocked
        ? ("UNSAFE_EXECUTION" as const)
        : portConflict
          ? ("UNSAFE_EXECUTION" as const)
          : zeroCommandsBlocked
            ? undefined
            : allPassed
              ? undefined
              : costMonitor.isTripped()
                ? ("BUDGET_EXHAUSTED" as const)
                : loopGuard.isTripped()
                  ? ("VERIFICATION_RETRY_LIMIT" as const)
                  : knowledgeFailed
                    ? ("KNOWLEDGE_DRIFT" as const)
                    : ("UNSAFE_EXECUTION" as const);

    const evidence = await this.writeEvidence(
      current,
      {
        status,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        // TASK-W.5c-ii：档位如实记三值（SANDBOX_ENFORCED 是受控档位，不再收窄为
        // UNCONTROLLED_EXTERNAL——收窄会让「受控派工成功」产出「不可合并证据」）。
        workerControlMode: interceptorBlocked
          ? "UNCONTROLLED_EXTERNAL"
          : current.worker_spec.control_mode,
        summary: interceptorBlocked
          ? "运行时复检发现 Adapter 能力漂移或越权通道，已降级为 UNCONTROLLED_EXTERNAL 并停止受控执行"
          : threatBlocked
            ? `验证被威胁守卫阻断（${threatBlockedAliases.join(", ")}）：命令可能在受控边界之外，已拒绝执行且未产生子进程`
            : portConflict
              ? `验证被端口占用阻断（${portConflictAliases.join(", ")}）：这是环境冲突，不是断言失败。请停止占用端口的进程后重试`
              : zeroCommandsBlocked
                ? "零命令合同处于兜底等待人工确认状态，未执行自动化验证"
                : allPassed
                  ? `All ${verificationResults.length} verification command(s) passed`
                  : `Verification failed (${verificationResults.filter((r) => !r.passed).length} command(s))`,
        verificationResults,
        // 由 TASK-W.2b 的未跟踪文件审计派生，不再写死 true
        scopePassed: postVerifyScope.passed,
        forbiddenViolations: [],
        modifiedFiles,
        testsModified,
        ...(this.graveyardGates.has(contractId)
          ? {
              graveyardCheck: this.graveyardGates.get(contractId)!.availability,
            }
          : {}),
      },
      costMonitor,
      worktreePath,
    );

    // TASK-C.15b：断言未过（非端口/威胁/拦截）→ 返工计数；超限升 ESCALATED。
    // 注意：第 N 次失败可能同时触达 LoopGuard → status=BLOCKED；仍须计返工，
    // 否则默认 max_verification_retries=3 时永远到不了 count>MAX(2) 的升格。
    let reworkSnap: ReworkCounterSnapshot | undefined;
    let escalated = false;
    let reworkRequired = false;
    // TASK-C.15b：断言未过（非端口/威胁/拦截/零命令兜底）→ 返工计数；超限升 ESCALATED。
    // 注意：零命令合同不对其计返工（G1 守卫条款与 N-⑩ 裁决）。
    const assertionFailed =
      !allPassed &&
      !portConflict &&
      !threatBlocked &&
      !interceptorBlocked &&
      !zeroCommandsBlocked;
    if (assertionFailed) {
      reworkSnap = recordVerificationRoundFailure(
        this.repoRoot,
        contractId,
        current.intent.acceptance_criteria,
      );
      reworkRequired = true;
      escalated = reworkSnap.phase === "escalated";
    } else if (status === "PASSED") {
      const existing = loadReworkCounter(this.repoRoot, contractId);
      if (existing) reworkSnap = existing.snapshot();
    }

    // G1 守卫条款：零命令合同 nextState 绝不能进入 AUDITED
    const nextState = allPassed
      ? "AUDITED"
      : tripped || escalated
        ? "PENDING_RESUME"
        : zeroCommandsBlocked
          ? "PENDING_RESUME"
          : "EXECUTING";

    if (nextState === "PENDING_RESUME") {
      this.revokeExecTokenFor(contractId);
    }

    const contract = this.store.transition({
      contractId,
      lifecycleState: nextState,
    });
    const worktree = await this.readWorktreeInfo(contractId, worktreePath);

    const delivery_state = projectDeliveryState({
      lifecycle_state: contract.lifecycle_state,
      verifying: false,
      rework_required: reworkRequired && !escalated,
      escalated,
    });

    return {
      contract,
      evidence,
      worktree,
      ...(reworkSnap ? { rework: reworkSnap } : {}),
      delivery_state,
    };
  }

  /**
   * 运行受控 AI Worker：生成代码改动并经网关写入 Worktree。
   * TASK-L.4：存在未豁免义务时走两段式（先红后绿）；全部豁免则保持单段。
   * 失败（越权/预算）时整批拒绝；预算耗尽进入 PENDING_RESUME。
   */
  async runWorker(
    contractId: string,
    options: {
      modelClient?: WorkerModelClient;
      /**
       * TASK-L.4：测试可注入两段式 hooks 片段（如 readObligationReport）。
       * 生产 HTTP 路径不传；未覆盖的 runT/runI 由本方法经 Registry 派工工厂组装受控执行器。
       */
      twoPhase?: Partial<TwoPhaseHooks>;
      /** TASK-L.11：覆盖构造器上的设计生成器 */
      designNoteGenerator?: DesignNoteGenerator;
      /** TASK-L.11：测试可跳过设计步骤（仅旧卡回归）；生产不得跳过 */
      skipDesignStep?: boolean;
      /**
       * TASK-W.6：单次派工覆盖适配器注册表（测试注入 Fake 适配器用）。
       * 未传则用构造器上的默认 / 注入 registry；生产 HTTP 路径不传。
       */
      registry?: AdapterRegistry;
      /**
       * TASK-W.5c-ii：单次派工覆盖容器宿主（测试注入 mock / stub 用）。
       * 未传则用构造器上的 `containerHost`；`SANDBOX_ENFORCED` 未注入宿主即拒绝派工。
       */
      containerHost?: ContainerHostPort;
    } = {},
  ): Promise<
    WorkerRunResult & { two_phase?: TwoPhaseResult; design?: DesignRunInfo }
  > {
    return withContractLock(contractLockPath(this.repoRoot, contractId), () =>
      this.runWorkerInternal(contractId, options),
    );
  }

  private deriveContractObligations(contract: SoftwareContract): {
    obligations: TestObligation[];
    waived: Array<{ acceptance_id: string; reason: "no_runner" }>;
  } {
    let facts: ReturnType<typeof repoFactsFromPackageJson> = {};
    try {
      const pkgPath = path.join(this.repoRoot, "package.json");
      if (fs.existsSync(pkgPath)) {
        const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          scripts?: Record<string, string>;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        facts = repoFactsFromPackageJson(raw);
      }
    } catch {
      facts = {};
    }
    return deriveObligations(contract, detectRunner(facts));
  }

  /**
   * 跑完一阶段 Worker 后，执行义务命令并写入
   * `.stagent/records/<id>/obligation-report-{t|i}.json`。
   * 集成测若注入了 readObligationReport 则跳过本方法。
   */
  private async materializeObligationReport(
    contract: SoftwareContract,
    gateway: ScopedWorktreeGateway,
    phase: "t" | "i",
    obligations: readonly TestObligation[],
  ): Promise<void> {
    const dir = path.join(
      this.repoRoot,
      ".stagent",
      "records",
      contract.contract_id,
    );
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, `obligation-report-${phase}.json`);

    let facts: ReturnType<typeof repoFactsFromPackageJson> = {};
    try {
      const wtPkg = path.join(gateway.getWorktreeRoot(), "package.json");
      const rootPkg = path.join(this.repoRoot, "package.json");
      const pkgPath = fs.existsSync(wtPkg) ? wtPkg : rootPkg;
      if (fs.existsSync(pkgPath)) {
        const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          scripts?: Record<string, string>;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        facts = repoFactsFromPackageJson(raw);
      }
    } catch {
      facts = {};
    }
    const runner = detectRunner(facts);
    const cmd = obligationCommand(
      runner,
      obligations.map((o) => o.test_path),
    );

    let report: unknown = {
      schema: "stagent-obligation-report-v1",
      test_count: 0,
      assertion_failures: 0,
      collection_or_compile_errors: 1,
    };

    if (cmd) {
      try {
        const res = await gateway.callTool(
          "stagent_exec_command",
          {
            executable: cmd.executable,
            args: cmd.args,
          },
          { internal: true },
        );
        const data = (res.data ?? {}) as {
          exitCode?: number;
          stdout?: string;
          stderr?: string;
        };
        const stdout = (data.stdout ?? "").trim();
        // vitest/jest JSON 可能夹在其它日志里：取最后一个 {...} 块
        let parsed: unknown = null;
        if (stdout.startsWith("{")) {
          try {
            parsed = JSON.parse(stdout);
          } catch {
            parsed = null;
          }
        }
        if (parsed === null) {
          const start = stdout.lastIndexOf("{");
          const end = stdout.lastIndexOf("}");
          if (start >= 0 && end > start) {
            try {
              parsed = JSON.parse(stdout.slice(start, end + 1));
            } catch {
              parsed = null;
            }
          }
        }
        if (parsed !== null) {
          report = parsed;
        } else {
          const exit = data.exitCode ?? (res.isError ? 1 : 0);
          report = {
            schema: "stagent-obligation-report-v1",
            test_count: 1,
            assertion_failures: exit === 0 ? 0 : 1,
            collection_or_compile_errors: 0,
          };
        }
      } catch {
        report = {
          schema: "stagent-obligation-report-v1",
          test_count: 0,
          assertion_failures: 0,
          collection_or_compile_errors: 1,
        };
      }
    }

    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  private async runWorkerInternal(
    contractId: string,
    options: {
      modelClient?: WorkerModelClient;
      twoPhase?: Partial<TwoPhaseHooks>;
      designNoteGenerator?: DesignNoteGenerator;
      skipDesignStep?: boolean;
      registry?: AdapterRegistry;
      /**
       * TASK-W.5c-ii：容器宿主端口（`SANDBOX_ENFORCED` 派工按宿主可用性判定）。
       * 未传则用构造器上的 `containerHost`；未注入宿主即拒绝派工。
       */
      containerHost?: ContainerHostPort;
    } = {},
  ): Promise<
    WorkerRunResult & { two_phase?: TwoPhaseResult; design?: DesignRunInfo }
  > {
    const signal = this.beginAbortable(contractId);
    try {
      const current = this.store.get(contractId);
      if (!current) throw new Error(`Contract not found: ${contractId}`);
      if (current.lifecycle_state !== "EXECUTING") {
        throw new InvalidStateTransitionError(
          current.lifecycle_state,
          ["EXECUTING"],
          "run-worker",
        );
      }

      // TASK-L.11：EXECUTING 内、T 段之前先跑设计步骤
      let activeDesignNote: DesignNote | undefined;
      let designInfo: DesignRunInfo | undefined;
      if (options.skipDesignStep !== true) {
        const designResult = await runDesignStep({
          repoRoot: this.repoRoot,
          contract: current,
          generator:
            options.designNoteGenerator ?? this.designNoteGenerator,
        });
        if (designResult.status === "suspended") {
          this.revokeExecTokenFor(contractId);
          this.store.transition({
            contractId,
            lifecycleState: "PENDING_RESUME",
          });
          designInfo = {
            status: "suspended",
            reason: designResult.reason,
            detail: designResult.detail,
            note: designResult.note,
            ...(designResult.escalation_missed
              ? { escalation_missed: designResult.escalation_missed }
              : {}),
          };
          return {
            applied: false,
            changes: [],
            log: [`design:${designResult.reason}`],
            usage: { inputTokens: 0, outputTokens: 0 },
            blockers: [
              { code: designResult.reason, message: designResult.detail },
            ],
            design: designInfo,
          };
        }
        activeDesignNote = designResult.note;
        designInfo = {
          status: "ok",
          note: designResult.note,
          escalation_missed: designResult.escalation_missed,
        };
      }

      const modelClient =
        options.modelClient ??
        new OpenAiWorkerClient({ repoRoot: this.repoRoot });
      const userHooks = options.twoPhase ?? {};

      // TASK-W.6：派工门禁——按合同 worker_spec.adapter_id 经 Registry 解析受控派工工厂。
      // 缺注册 / UNCONTROLLED_EXTERNAL / 未挂工厂均抛带 code 的 WorkerDispatchError，
      // 绝不静默降级到「无网关执行」或写死 AiWorker。
      const registry = options.registry ?? this.workerRegistry;
      // TASK-W.5c-ii：容器宿主经编排器注入（`SANDBOX_ENFORCED` 门禁按宿主可用性
      // 判定放行；未注入即拒绝，不静默降级）。真实宿主绑定归 W.5c-iii。
      const dispatchFactory = requireControlledDispatch(
        registry,
        current.worker_spec.adapter_id,
        { containerHost: options.containerHost ?? this.containerHost },
      );

      const derived =
        userHooks.obligations !== undefined
          ? {
              obligations: userHooks.obligations,
              waived: userHooks.waived ?? [],
            }
          : this.deriveContractObligations(current);

      // ----- 全部豁免 / 无义务：保持旧单段路径 -----
      if (!shouldRunTwoPhase(derived.obligations)) {
        const { gateway, costMonitor } = this.buildRuntime(current, signal);
        const context: WorkerDispatchContext = {
          contract: current,
          gateway,
          costMonitor,
          modelClient,
          repoRoot: this.repoRoot,
          ...(activeDesignNote
            ? { designNote: activeDesignNote }
            : {}),
        };
        // TASK-W.6：执行器由 Registry 解析出的工厂产出，编排器不 new 具体适配器
        const worker = dispatchFactory(context);

        try {
          const result = await worker.run(signal);
          return {
            ...result,
            two_phase: {
              phase: "single",
              can_merge: true,
              t_attempts: 0,
              i_attempts: 1,
              obligations: [],
              reason_codes: [],
            },
            ...(designInfo ? { design: designInfo } : {}),
          };
        } catch (err) {
          if (err instanceof WorkerScopeError) {
            const gyTags = err.blockers
              .filter((b) => b.code === "E_PROPOSAL_PREVIOUSLY_REJECTED")
              .map((b) => {
                const m = /（([^），]+)）/.exec(b.message);
                return m ? `graveyard:${m[1]}` : "graveyard:unknown";
              });
            // Prefer explicit rejected_id from message; fallback tag
            const violations =
              gyTags.length > 0
                ? gyTags
                : err.code === "E_PROPOSAL_PREVIOUSLY_REJECTED"
                  ? ["graveyard:blocked"]
                  : [];
            if (
              err.code === "E_PROPOSAL_PREVIOUSLY_REJECTED" ||
              violations.length > 0
            ) {
              this.revokeExecTokenFor(contractId);
              this.store.transition({
                contractId,
                lifecycleState: "PENDING_RESUME",
              });
              const gateCtx = this.graveyardGates.get(contractId);
              await this.writeEvidence(
                current,
                {
                  status: "BLOCKED",
                  reasonCode: "SCOPE_VIOLATION",
                  summary: err.message,
                  verificationResults: [],
                  scopePassed: false,
                  forbiddenViolations: violations,
                  modifiedFiles: [...gateway.getModifiedFiles()],
                  testsModified: gateway.wasTestsModified(),
                  ...(gateCtx
                    ? { graveyardCheck: gateCtx.availability }
                    : {}),
                },
                costMonitor,
                gateway.getWorktreeRoot(),
              );
            }
            throw err;
          }
          if (costMonitor.isTripped()) {
            this.revokeExecTokenFor(contractId);
            this.store.transition({
              contractId,
              lifecycleState: "PENDING_RESUME",
            });
            await this.writeEvidence(
              current,
              {
                status: "BLOCKED",
                reasonCode: "BUDGET_EXHAUSTED",
                summary: `Worker aborted: ${(err as Error).message}`,
                verificationResults: [],
                scopePassed: false,
                forbiddenViolations: [],
                modifiedFiles: [...gateway.getModifiedFiles()],
                testsModified: gateway.wasTestsModified(),
              },
              costMonitor,
              gateway.getWorktreeRoot(),
            );
          }
          throw err;
        }
      }

      // ----- 有未豁免义务：组装真实 runT/runI，走两段式 -----
      const bag: {
        changes: WorkerChange[];
        log: string[];
        usage: { inputTokens: number; outputTokens: number };
        applied: boolean;
      } = {
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        applied: false,
      };

      const runPhaseWorker = async (
        gateway: ScopedWorktreeGateway,
        extras: string[],
      ): Promise<void> => {
        const costMonitor = gateway.getCostMonitor();
        if (!costMonitor) {
          throw new Error(
            "ScopedWorktreeGateway missing costMonitor in two-phase run",
          );
        }
        const context: WorkerDispatchContext = {
          contract: current,
          gateway,
          costMonitor,
          modelClient,
          repoRoot: this.repoRoot,
          checksExtras: extras,
          ...(activeDesignNote
            ? { designNote: activeDesignNote }
            : {}),
        };
        // TASK-W.6：两段式 T/I 段同样经 Registry 解析出的工厂派工
        const worker = dispatchFactory(context);
        const result = await worker.run(signal);
        bag.changes.push(...result.changes);
        bag.log.push(...result.log);
        bag.usage.inputTokens += result.usage.inputTokens;
        bag.usage.outputTokens += result.usage.outputTokens;
        bag.applied = bag.applied || result.applied;
      };

      const hooks: TwoPhaseHooks = {
        obligations: derived.obligations,
        waived: derived.waived,
        runT:
          userHooks.runT ??
          (async (gateway, extras) => {
            await runPhaseWorker(gateway, extras);
            if (userHooks.readObligationReport === undefined) {
              await this.materializeObligationReport(
                current,
                gateway,
                "t",
                derived.obligations,
              );
            }
          }),
        runI:
          userHooks.runI ??
          (async (gateway, extras) => {
            await runPhaseWorker(gateway, extras);
            if (userHooks.readObligationReport === undefined) {
              await this.materializeObligationReport(
                current,
                gateway,
                "i",
                derived.obligations,
              );
            }
          }),
        ...(userHooks.readObligationReport === undefined
          ? {}
          : { readObligationReport: userHooks.readObligationReport }),
        ...(userHooks.afterIVerify === undefined
          ? {}
          : { afterIVerify: userHooks.afterIVerify }),
        ...(userHooks.afterGatewayBuilt === undefined
          ? {}
          : { afterGatewayBuilt: userHooks.afterGatewayBuilt }),
      };

      const twoPhase = await this.runTwoPhase(contractId, hooks, signal);

      return {
        applied: bag.applied,
        changes: bag.changes,
        log: bag.log,
        usage: bag.usage,
        blockers: [],
        two_phase: twoPhase,
        ...(designInfo ? { design: designInfo } : {}),
      };
    } finally {
      this.endAbortable(contractId);
    }
  }

  /** 将 Worktree 内全部改动提交到任务分支（无改动时静默跳过） */
  private async commitWorktree(
    worktreePath: string,
    contractId: string,
  ): Promise<void> {
    const status = await execGit(["status", "--porcelain"], worktreePath);
    if (status.exitCode !== 0 || status.stdout.trim().length === 0) return;

    await execGit(["add", "-A"], worktreePath);
    const commit = await execGit(
      ["commit", "-m", `chore(stagent): contract ${contractId} changes`],
      worktreePath,
    );
    if (commit.exitCode !== 0) {
      throw new Error(
        `Failed to commit worktree changes: ${commit.stderr || commit.stdout}`,
      );
    }
  }

  /**
   * 依赖准备（ADR-002）：
   * - 锁文件一致 + 写保护可证明 → 建立只读共享 symlink 视图
   * - 锁文件不一致（需变更依赖）→ 等待用户授权，不自动安装
   * - 写保护不可证明 → 在 Worktree 内隔离安装（不污染主工程）
   */
  private async prepareDependencies(contractId: string): Promise<void> {
    const worktreePath = getWorktreePath(this.repoRoot, contractId);
    const plan = await planDependencyStrategy({
      repoRoot: this.repoRoot,
      worktreePath,
    });

    if (plan.strategy === "SHARED_SYMLINK") {
      await mountDependencySymlink({
        repoRoot: this.repoRoot,
        worktreePath,
      });
      return;
    }

    // 需要变更依赖时必须由用户显式授权，先不安装
    if (plan.requiresAuthorization || !plan.lockfile.name) return;

    await runIsolatedInstall({
      worktreePath,
      runner: (command, args, cwd) =>
        new Promise((resolve) => {
          // 独立进程组：包管理器的后代进程（postinstall、node-gyp 等）
          // 必须整树回收，否则会残留占用 Worktree 文件锁
          const child = spawn(command, args, {
            cwd,
            stdio: "ignore",
            env: { ...process.env, CI: "true" },
            detached: true,
          });
          const timer = setTimeout(() => {
            void killProcessTree(child.pid ?? 0, { graceMs: 1_000 }).finally(
              () => resolve({ code: 124 }),
            );
          }, 300_000);
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? 1 });
          });
          child.on("error", () => {
            clearTimeout(timer);
            resolve({ code: 1 });
          });
        }),
    });
  }

  private buildRuntime(
    contract: SoftwareContract,
    signal?: AbortSignal,
    phaseOverlay?: PhaseOverlay,
  ): {
    gateway: ScopedWorktreeGateway;
    costMonitor: CostMonitor;
    loopGuard: LoopGuard;
    worktreePath: string;
    interceptor: RuntimeInterceptor;
  } {
    const worktreePath = getWorktreePath(this.repoRoot, contract.contract_id);
    const guardDir = path.join(this.repoRoot, ".stagent", "guard");
    const costMonitor = new CostMonitor({
      maxCostMinorUnits:
        contract.authorization.cost_limits.max_cost_minor_units,
      currency: contract.authorization.cost_limits.currency,
      ...(contract.authorization.cost_limits.max_input_tokens === undefined
        ? {}
        : {
            maxTotalTokens: contract.authorization.cost_limits.max_input_tokens,
          }),
      statePath: path.join(guardDir, "cost.json"),
    });
    const loopGuard = new LoopGuard({
      maxRetries: contract.authorization.budget_limits.max_verification_retries,
      statePath: path.join(guardDir, "loop.json"),
    });
    const interceptor = new RuntimeInterceptor({
      snapshot: {
        adapter_id: contract.worker_spec.adapter_id,
        // TASK-W.5c-ii：同上，如实传三值（SANDBOX_ENFORCED 属受控档位）。
        control_mode: contract.worker_spec.control_mode,
        tool_interception_supported: true,
        filesystem_permissions: "GATEWAY_ONLY",
        command_permissions: "WHITELIST_ONLY",
        config_fingerprint: `${contract.schema_version}:${contract.contract_revision}:${contract.worker_spec.adapter_id}`,
      },
      worktreeRoot: worktreePath,
      allowedAliases: contract.verification_spec.commands.map((c) => c.alias),
      onDowngrade: (violation) => {
        // 按合同隔离落盘；revision 变化后旧记录自动失效
        saveGatewayViolation(
          this.repoRoot,
          contract.contract_id,
          contract.contract_revision,
          violation,
        );
        this.onGatewayViolation?.(violation);
      },
    });
    // TASK-C.14d：基线脏区排除 → Gateway 升格 E_OUT_OF_SCOPE_UNTRACKED
    const dirtyExclusions = loadBaselineDirtyExclusions(this.repoRoot);
    const gateway = new ScopedWorktreeGateway(worktreePath, contract, {
      costMonitor,
      loopGuard,
      runtimeInterceptor: interceptor,
      requireRepoTrust: true,
      dirtyExclusions,
      ...(phaseOverlay === undefined ? {} : { phaseOverlay }),
      ...(this.graveyardGates.has(contract.contract_id)
        ? { graveyardGate: this.graveyardGates.get(contract.contract_id) }
        : {}),
      ...(this.deadlock === null ? {} : { deadlock: this.deadlock }),
      ...(signal === undefined ? {} : { signal }),
      ...(this.onTerminalLine === undefined
        ? {}
        : {
            onTerminalLine: (stream, line) =>
              this.onTerminalLine?.(contract.contract_id, stream, line),
          }),
      // TASK-C.12a：施工写必须持有 exec_token
      execToken: {
        store: this.execTokenStore,
        getToken: () => this.activeExecTokens.get(contract.contract_id) ?? null,
      },
      // TASK-C.12c / C.14d：越界（含脏区）→ 原子拦截序列
      onScopeBlocked: (_info) => {
        // TASK-C.12c：阻断当次 IO 后跑软停序列；吊销 token 并进入 PENDING_RESUME
        void runBoundaryStop({
          contract_id: contract.contract_id,
          repoRoot: this.repoRoot,
          worktreePath,
          tokenStore: this.execTokenStore,
          workerPid: null,
        }).then(() => {
          this.activeExecTokens.delete(contract.contract_id);
          try {
            const cur = this.store.get(contract.contract_id);
            if (
              cur &&
              (cur.lifecycle_state === "EXECUTING" ||
                cur.lifecycle_state === "VERIFYING" ||
                cur.lifecycle_state === "PREPARING")
            ) {
              this.store.transition({
                contractId: contract.contract_id,
                lifecycleState: "PENDING_RESUME",
              });
            }
          } catch {
            // 状态机拒绝时不吞写阻断本身
          }
        });
      },
    });
    this.activeGateway = gateway;
    this.activeGateways.set(contract.contract_id, gateway);
    return { gateway, costMonitor, loopGuard, worktreePath, interceptor };
  }

  private async readWorktreeInfo(
    contractId: string,
    worktreePath: string,
  ): Promise<WorktreeInfo> {
    return {
      contractId,
      worktreePath,
      branch: `task/${contractId}`,
      baseBranch: "main",
      createdAt: new Date().toISOString(),
      warnings: [],
    };
  }

  /**
   * TASK-W.2b：未跟踪文件 Scope 守卫。
   *
   * 命中越界时的处置顺序（三者缺一不可）：
   * 1. 先写 BLOCKED 证据——留下可追溯的 `scope_audit` 与违规清单，
   *    否则「阻断」只是一次异常，事后无法解释为什么没合入；
   * 2. 合同回退 `EXECUTING`——保留 Worktree 现场供用户清理或升版重批，
   *    不把合同钉死在 `VERIFYING`（那是死锁，见 §6.4 自愈目录）；
   * 3. 抛 `E_OUT_OF_SCOPE_UNTRACKED`——调用方据此终止本轮，不再产出 PASSED。
   *
   * 未抛错即代表本轮未跟踪文件全部落在合同授权内。
   */

  /**
   * TASK-J.18d：POST_VERIFICATION / 执行末墓地全量扫描。
   * 扫描失败 → E_GATE_SCAN_FAILED；强命中 → SCOPE_VIOLATION + graveyard:ID。
   */
  private async assertGraveyardScan(options: {
    contract: SoftwareContract;
    worktreePath: string;
    phase: string;
    costMonitor?: CostMonitor | undefined;
    verificationResults?: VerificationResultInput[] | undefined;
  }): Promise<void> {
    let gateCtx = this.graveyardGates.get(options.contract.contract_id);
    if (!gateCtx) {
      // resume 后 Map 可能空：按合同即时绑定（legacy → unavailable）
      const prep = await prepareDispatchGate(this.repoRoot, options.contract);
      if (!prep.ok) {
        await this.writeEvidence(
          options.contract,
          {
            status: "BLOCKED",
            reasonCode: "PREPARATION_INTERRUPTED",
            summary: `[${prep.code}] ${prep.message}`,
            verificationResults: options.verificationResults ?? [],
            scopePassed: false,
            forbiddenViolations: [],
            modifiedFiles: [],
          },
          options.costMonitor,
          options.worktreePath,
        );
        this.store.transition({
          contractId: options.contract.contract_id,
          lifecycleState: "PENDING_RESUME",
        });
        throw new Error(`[${prep.code}] ${prep.message}`);
      }
      gateCtx = prep.context;
      this.graveyardGates.set(options.contract.contract_id, gateCtx);
    }

    const baseBranch = options.contract.authorization.git.base_branch;
    const scan = await scanWorktreeGraveyard({
      worktreePath: options.worktreePath,
      baseBranch,
      context: gateCtx,
    });

    if (!scan.ok) {
      await this.writeEvidence(
        options.contract,
        {
          status: "BLOCKED",
          reasonCode: "PREPARATION_INTERRUPTED",
          summary: `[E_GATE_SCAN_FAILED] ${scan.reason}`,
          verificationResults: options.verificationResults ?? [],
          scopePassed: false,
          forbiddenViolations: [],
          modifiedFiles: [],
          graveyardCheck: gateCtx.availability,
        },
        options.costMonitor,
        options.worktreePath,
      );
      this.store.transition({
        contractId: options.contract.contract_id,
        lifecycleState: "PENDING_RESUME",
      });
      throw new Error(`[E_GATE_SCAN_FAILED] ${scan.reason}`);
    }

    if (scan.gate.block) {
      const violations = graveyardViolationTags(scan.gate);
      await this.writeEvidence(
        options.contract,
        {
          status: "BLOCKED",
          reasonCode: "SCOPE_VIOLATION",
          summary: graveyardBlockMessage(scan.gate),
          verificationResults: options.verificationResults ?? [],
          scopePassed: false,
          forbiddenViolations: violations,
          modifiedFiles: [],
          graveyardCheck: gateCtx.availability,
        },
        options.costMonitor,
        options.worktreePath,
      );
      this.revokeExecTokenFor(options.contract.contract_id);
      this.store.transition({
        contractId: options.contract.contract_id,
        lifecycleState: "PENDING_RESUME",
      });
      throw new Error(graveyardBlockMessage(scan.gate));
    }

    // legacy unavailable：在后续 PASSED 证据里带 graveyard_check（由调用方合并时写入）
    // 这里把上下文挂回 Map 即可
    void options.phase;
    void scan.warnings;
  }

  private async assertUntrackedScope(options: {
    contract: SoftwareContract;
    worktreePath: string;
    phase: UntrackedScopePhase;
    costMonitor?: CostMonitor | undefined;
    verificationResults?: VerificationResultInput[] | undefined;
  }): Promise<UntrackedScopeReport> {
    const report = await enforceUntrackedScope({
      worktreePath: options.worktreePath,
      scope: options.contract.authorization.file_system_scope,
      phase: options.phase,
    });
    if (report.passed) return report;

    // 复用 forbidden_violations 通道承载违规清单：它是证据包里唯一
    // 既能让 deriveCanMerge 归零、又能逐条追溯的字符串数组。
    const violations = report.violations.map((v) => `untracked:${v.path}`);
    await this.writeEvidence(
      options.contract,
      {
        status: "BLOCKED",
        reasonCode: "SCOPE_VIOLATION",
        summary: `[${E_OUT_OF_SCOPE_UNTRACKED}] ${describeUntrackedViolations(report)}`,
        verificationResults: options.verificationResults ?? [],
        scopePassed: false,
        forbiddenViolations: violations,
        modifiedFiles: report.violations.map((v) => v.path),
      },
      options.costMonitor,
      options.worktreePath,
    );

    this.store.transition({
      contractId: options.contract.contract_id,
      lifecycleState: "EXECUTING",
    });

    throw new UntrackedScopeViolationError(report);
  }

  /**
   * TASK-D.3 / D-3：恢复期发现工作树物理丢失后的自愈重建。
   *
   * `PENDING_RESUME → PREPARING` 是一条带 Guard 的受控边，必须显式携带
   * `WORKTREE_MISSING_HEAL`；否则状态机会按 Fail-Closed 拒绝——这正是设计意图，
   * 避免普通续跑悄悄走成"重建"。
   */
  async healResume(contractId: string): Promise<SoftwareContract> {
    const current = this.store.get(contractId);
    if (!current) throw new Error(`Contract not found: ${contractId}`);
    if (current.lifecycle_state !== "PENDING_RESUME") return current;

    const preparing = this.store.transition({
      contractId,
      lifecycleState: "PREPARING",
      transitionContext: { reason: "WORKTREE_MISSING_HEAL" },
    });

    await createTaskWorktree({
      repoRoot: this.repoRoot,
      contractId,
      baseBranch: current.authorization.git.base_branch,
      force: true,
      acknowledgeDirty: true,
    });

    return preparing;
  }

  /**
   * TASK-D.3 / D-4：以当前分支为基线重演。
   *
   * 做两件事，缺一不可：
   * 1. 把最新目标分支合进任务分支——**用 merge 而不是硬重置**，否则 Worker
   *    的改动会被直接抹掉，用户点"重演"反而丢代码；
   * 2. 推回 EXECUTING 走既有 execute 管道重跑验证。不复用旧证据：旧证据
   *    对应的是旧基线，指纹与合并基线都已失效。
   *
   * 冲突时不做任何自动取舍（既不 ours 也不 theirs），直接 abort merge 并抛错，
   * 把决策权交还用户——这正是 D-4"禁止前端死锁"的另一面：给得出选项，也停得住。
   */
  async replayOnCurrentBaseline(contractId: string): Promise<ExecutionOutcome> {
    const current = this.store.get(contractId);
    if (!current) throw new Error(`Contract not found: ${contractId}`);
    if (current.lifecycle_state !== "AUDITED") {
      throw new InvalidStateTransitionError(
        current.lifecycle_state,
        ["AUDITED"],
        "replay",
      );
    }

    const worktreePath = getWorktreePath(this.repoRoot, contractId);
    if (!fs.existsSync(worktreePath)) {
      throw new Error(`[E_WORKTREE_LOST] Worktree missing: ${worktreePath}`);
    }

    const baseBranch = current.authorization.git.base_branch;
    const merge = await execGit(
      ["merge", "--no-edit", baseBranch],
      worktreePath,
    );
    if (merge.exitCode !== 0) {
      await execGit(["merge", "--abort"], worktreePath);
      throw new ReplayConflictError(
        (merge.stderr || merge.stdout).trim().slice(0, 400) || "git merge 失败",
      );
    }

    this.store.transition({ contractId, lifecycleState: "EXECUTING" });
    return this.execute(contractId);
  }

  /**
   * TASK-D.3 / D-5：命令超时后写入一条证据。
   *
   * 说明：Evidence 的 verdict 枚举只有 PASSED / FAILED / BLOCKED / STALE，
   * 没有 `TIMEOUT`。因此这里用 `BLOCKED + BUDGET_EXHAUSTED` 表达"资源上限导致的
   * 强制回收"，并在 summary 打上 `TIMEOUT:` 前缀——不为一张任务卡去改合同级 Schema。
   */
  async recordCommandTimeout(
    contractId: string,
    info: { command: string; tier: string; timeout_ms: number },
  ): Promise<EvidenceBundle> {
    const contract = this.store.get(contractId);
    if (!contract) throw new Error(`Contract not found: ${contractId}`);

    const worktreePath = getWorktreePath(this.repoRoot, contractId);
    const hasWorktree = fs.existsSync(worktreePath);

    return this.writeEvidence(
      contract,
      {
        status: "BLOCKED",
        reasonCode: "BUDGET_EXHAUSTED",
        summary:
          `TIMEOUT: 命令「${info.command}」超过 ${info.tier} 层 ` +
          `${info.timeout_ms}ms 上限，已由看门狗强制回收（TASK-D.3 / D-5）`,
        verificationResults: [],
        scopePassed: false,
        forbiddenViolations: [],
        modifiedFiles: [],
      },
      undefined,
      hasWorktree ? worktreePath : undefined,
    );
  }

  private async writeEvidence(
    contract: SoftwareContract,
    input: {
      status: EvidenceBundle["verdict"]["status"];
      reasonCode?: EvidenceBundle["verdict"]["reason_code"];
      summary: string;
      verificationResults: VerificationResultInput[];
      scopePassed: boolean;
      forbiddenViolations: string[];
      modifiedFiles: string[];
      /** 本任务是否修改过测试文件（写入 Evidence 供核销人预警复核） */
      testsModified?: boolean;
      manualConfirmationRecord?: ManualConfirmationRecord;
      /**
       * TASK-W.4：运行时降级后 Evidence 记录实际控制模式。
       * TASK-W.5c-ii：扩三值（`SANDBOX_ENFORCED` 属受控档位，如实记档）。
       */
      workerControlMode?:
        | "GATEWAY_ENFORCED"
        | "SANDBOX_ENFORCED"
        | "UNCONTROLLED_EXTERNAL";
      /** TASK-J.18d：墓地检查可用性 */
      graveyardCheck?: "snapshot" | "unavailable";
    },
    costMonitor?: CostMonitor,
    worktreePath?: string,
  ): Promise<EvidenceBundle> {
    const evidenceId = `evi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const totals = costMonitor?.getTotals();
    const headSha = worktreePath
      ? this.syncGit(worktreePath, ["rev-parse", "HEAD"]) || "unknown"
      : "unknown";
    // 防篡改指纹：HEAD + porcelain 状态 + 变更文件内容哈希。
    // 合并前会重算比对；用户在 Evidence 生成后偷改 Worktree 必然导致指纹不符。
    const fingerprint = worktreePath
      ? await computeWorktreeFingerprint(worktreePath)
      : createHash("sha256").update("no-worktree").digest("hex");
    const patch = worktreePath
      ? this.syncGit(worktreePath, ["diff", "HEAD"]) || ""
      : "";
    const diffStat = worktreePath
      ? this.syncGit(worktreePath, ["diff", "--stat", "HEAD"]) || ""
      : "";

    const bundle: EvidenceBundle = {
      evidence_id: evidenceId,
      contract_id: contract.contract_id,
      generated_at: new Date().toISOString(),
      // TASK-W.5c-ii：同上，如实记三值档位。
      worker_control_mode:
        input.workerControlMode ?? contract.worker_spec.control_mode,
      usage:
        totals && totals.totalTokens > 0
          ? {
              input_tokens: totals.inputTokens,
              output_tokens: totals.outputTokens,
              currency: totals.currency,
              pricing_version:
                contract.authorization.cost_limits.pricing_version,
              accounting_mode: "ESTIMATED",
              estimated_cost_minor_units: totals.totalCostMinorUnits,
              limit_reached: totals.tripped,
              cumulative_cost_minor_units: totals.totalCostMinorUnits,
            }
          : {
              currency: contract.authorization.cost_limits.currency,
              pricing_version:
                contract.authorization.cost_limits.pricing_version,
              accounting_mode: "UNAVAILABLE",
              limit_reached: costMonitor?.isTripped() ?? false,
            },
      worktree_snapshot: {
        head_sha: headSha,
        snapshot_fingerprint: fingerprint,
        captured_at: new Date().toISOString(),
      },
      verdict: {
        status: input.status,
        // §9.2：can_merge 必须等于完整合并门禁的派生结果，统一走 deriveCanMerge
        can_merge: deriveCanMerge({
          status: input.status,
          scopePassed: input.scopePassed,
          budgetExhausted: costMonitor?.isTripped() ?? false,
          forbiddenViolationCount: input.forbiddenViolations.length,
          manualConfirmationDeclared:
            contract.verification_spec.manual_confirmation !== undefined,
          manualConfirmationRecord: input.manualConfirmationRecord,
        }),
        summary: input.summary,
        ...(input.reasonCode === undefined
          ? {}
          : { reason_code: input.reasonCode }),
        verification_retry_count: input.verificationResults.filter(
          (r) => !r.passed,
        ).length,
      },
      scope_audit: {
        passed: input.scopePassed,
        files_changed: input.modifiedFiles.map((p) => ({
          path: p,
          additions: 0,
          deletions: 0,
          binary: false,
        })),
        forbidden_violations: input.forbiddenViolations,
        budget_exhausted: costMonitor?.isTripped() ?? false,
        ...(input.graveyardCheck === undefined
          ? {}
          : { graveyard_check: input.graveyardCheck }),
      },
      verification_results: input.verificationResults
        .slice(-MAX_EVIDENCE_VERIFICATION_RESULTS)
        .map((r) => ({
          command_alias: r.alias,
          exit_code: r.exitCode,
          stdout_tail: r.stdout.slice(-MAX_EVIDENCE_TAIL_CHARS),
          stderr_tail: r.stderr.slice(-MAX_EVIDENCE_TAIL_CHARS),
          duration_ms: r.durationMs,
          passed: r.passed,
        })),
      tests_modified: input.testsModified ?? false,
      ...(input.manualConfirmationRecord === undefined
        ? {}
        : { manual_confirmation: input.manualConfirmationRecord }),
      git_info: {
        base_commit_sha:
          this.syncGit(this.repoRoot, [
            "rev-parse",
            contract.authorization.git.base_branch,
          ]) || "unknown",
        task_commit_sha: headSha,
        diff_stat: diffStat,
        patch_fingerprint: createHash("sha256").update(patch).digest("hex"),
      },
    };

    const validated = evidenceBundleSchema.parse(clampEvidenceSize(bundle));
    const evidenceDir = path.join(this.repoRoot, ".stagent", "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    writeStateFile(
      path.join(
        evidenceDir,
        `${contract.contract_id}-${validated.evidence_id}.json`,
      ),
      validated,
    );
    return validated;
  }

  private syncGit(cwd: string, args: string[]): string | null {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
    } catch {
      return null;
    }
  }
  /** TASK-L.4：带运行期收窄的网关（供两段式 / 集成测） */
  buildRuntimeWithOverlay(
    contract: SoftwareContract,
    phaseOverlay?: PhaseOverlay,
    signal?: AbortSignal,
  ): {
    gateway: ScopedWorktreeGateway;
    costMonitor: CostMonitor;
    loopGuard: LoopGuard;
    worktreePath: string;
    interceptor: RuntimeInterceptor;
  } {
    return this.buildRuntime(contract, signal, phaseOverlay);
  }

  /**
   * TASK-L.4：两段式施工（先红后绿）。无未豁免义务时退化为单段。
   * 编排细节见 daemon/pipeline/two-phase-runner.ts。
   * 生产入口：`runWorker` 在存在未豁免义务时调用本方法并经 Registry 派工工厂组装 hooks。
   */
  async runTwoPhase(
    contractId: string,
    hooks: TwoPhaseHooks,
    signal?: AbortSignal,
  ): Promise<TwoPhaseResult> {
    const current = this.store.get(contractId);
    if (!current) throw new Error(`Contract not found: ${contractId}`);
    return runTwoPhaseConstruction(
      {
        contract: current,
        repoRoot: this.repoRoot,
        buildGateway: (overlay) => {
          const { gateway } = this.buildRuntime(current, signal, overlay);
          return gateway;
        },
        commitRedSha: async (gateway) => {
          const wt = gateway.getWorktreeRoot();
          await this.commitWorktree(wt, contractId);
          return this.syncGit(wt, ["rev-parse", "HEAD"]) ?? "unknown";
        },
        transitionPendingResume: (reason, detail) => {
          try {
            this.store.transition({
              contractId,
              lifecycleState: "PENDING_RESUME",
            });
          } catch (err) {
            // 状态机若拒绝直接跳转，仍写入 suspension.json（runner 已写）
            void err;
            void reason;
            void detail;
          }
        },
      },
      hooks,
    );
  }

}

/** 单条验证命令在 Evidence 中保留的日志尾巴字符数 */
export const MAX_EVIDENCE_TAIL_CHARS = 2_000;
/** Evidence 最多保留的验证命令条数（防止狂暴命令把日志灌进存证） */
export const MAX_EVIDENCE_VERIFICATION_RESULTS = 20;
/** Evidence JSON 硬上限：超过则逐级收缩日志尾巴，绝不把几十兆文本塞进存证 */
export const MAX_EVIDENCE_JSON_BYTES = 512 * 1024;

/** 收缩 Evidence 体积直至低于硬上限（保底 200 字符尾巴） */
function clampEvidenceSize(bundle: EvidenceBundle): EvidenceBundle {
  const sizeOf = (b: EvidenceBundle): number =>
    Buffer.byteLength(JSON.stringify(b), "utf-8");

  let tail = MAX_EVIDENCE_TAIL_CHARS;
  let current = bundle;
  while (sizeOf(current) > MAX_EVIDENCE_JSON_BYTES && tail > 200) {
    tail = Math.max(200, Math.floor(tail / 2));
    current = {
      ...current,
      verification_results: current.verification_results.map((r) => ({
        ...r,
        stdout_tail: r.stdout_tail.slice(-tail),
        stderr_tail: r.stderr_tail.slice(-tail),
      })),
    };
  }
  return current;
}

/** 解析 git status --porcelain 输出为相对路径列表（含重命名目标路径） */
function parsePorcelainPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      // 保留行首空格：` M styles.css` 的 slice(3) 才是 styles.css，而非 tyles.css
      if (line.length < 4) return "";
      let p = line.slice(3);
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4);
      return p.replace(/^"|"$/g, "").replace(/\/$/, "");
    })
    .filter((p) => p !== "");
}
