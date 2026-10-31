/**
 * TASK-C.22 / SSOT v2.0.2 §5.2.1：「确认方案」事务编排。
 *
 * 关键约束：
 * - 先冻结输入（阻断右栏 + 中断流式），再做最终谓词求值，关闭 TOCTOU；
 * - `confirmation_id` 是幂等键；同一 id + 同一 revision 的重放不重复签署；
 * - 快照成功后签署失败，必须调用 compensate（吊销/清理/回退），不得半签半开；
 * - 只有成功签署并完成施工准备后才 COMMIT；失败一律回到可重试审阅态。
 */

import type {
  DemoGate,
  SchemeConfirmationDecision,
  SchemeDraft,
} from "./scheme-draft";
import { evaluateSchemeConfirmation, freezeScheme } from "./scheme-draft";
import type { ScopePlan } from "./scope-plan";

export type ConfirmSchemeStepId =
  | "CLAIM_AND_QUIESCE"
  | "VALIDATE_CONFIRMATION"
  | "FREEZE_SNAPSHOT"
  | "SIGN_AND_PREPARE"
  | "COMMIT";

export const CONFIRM_SCHEME_STEPS: readonly ConfirmSchemeStepId[] = [
  "CLAIM_AND_QUIESCE",
  "VALIDATE_CONFIRMATION",
  "FREEZE_SNAPSHOT",
  "SIGN_AND_PREPARE",
  "COMMIT",
] as const;

export interface ConfirmSchemeStepResult {
  step: ConfirmSchemeStepId;
  ok: boolean;
  reason?: string;
}

export interface PersistedSchemeSnapshot {
  snapshot_id: string;
  digest: string;
  idempotent?: boolean;
}

export interface ConfirmSchemeAtomicInput {
  confirmationId: string;
  scheme: SchemeDraft;
  demo: DemoGate;
  /** 调用方看到的修订号；与 scheme.scheme_revision 不一致即拒绝。 */
  expectedRevision: number;
  /** J.5：与当前修订绑定的 ScopePlan；VALIDATE 与 Daemon 共用。 */
  scopePlan: ScopePlan | null;
  /** 先停流式，再禁用右栏输入；两者都完成才允许继续。 */
  quiesceRightChat: () => void | Promise<void>;
  /** 写入不可变快照；同 id + 同内容必须幂等返回原快照。 */
  persistSnapshot: (input: {
    confirmation_id: string;
    scheme: SchemeDraft;
    demo: DemoGate;
    decision: SchemeConfirmationDecision;
  }) => Promise<PersistedSchemeSnapshot>;
  /** Daemon 签署 + Worktree/Token 准备。 */
  signAndPrepare: (input: {
    confirmation_id: string;
    frozen: SchemeDraft;
    demo: DemoGate;
    snapshot: PersistedSchemeSnapshot;
    /**
     * 合同一旦落库就立即回报。
     *
     * 签署与施工准备是两步（建合同 → 建任务图）：建图失败时合同已经存在，
     * 补偿必须知道要吊销哪一份，否则只能靠调用方闭包兜底——一旦
     * `signAndPrepare` 的实现换了作用域，补偿就会静默失效。
     */
    onContractCreated?: (contractId: string) => void;
  }) => Promise<{ contract_id: string }>;
  /** 失败补偿：吊销 token、清理 Worktree、终止已建合同。 */
  compensate?: (input: {
    confirmation_id: string;
    failed_at: ConfirmSchemeStepId;
    contract_id?: string;
    snapshot?: PersistedSchemeSnapshot;
    cause: string;
  }) => Promise<void>;
  /** 补偿成功后恢复右栏；补偿失败必须保持锁定。 */
  restoreRightChat?: () => void;
  /**
   * J.7：每阶段开始前回调，驱动中栏三步人话进度。
   * 失败路径也会在已进入的阶段上报；调用方不得据此旁路事务。
   */
  onStage?: (stage: ConfirmSchemeStepId) => void;
}

export interface ConfirmSchemeAtomicResult {
  ok: boolean;
  idempotent: boolean;
  steps: ConfirmSchemeStepResult[];
  frozen: SchemeDraft | null;
  confirmation_id: string;
  contract_id?: string;
  snapshot?: PersistedSchemeSnapshot;
  failedAt?: ConfirmSchemeStepId;
  code?: string;
  reason?: string;
  /** FREEZE 漂移时附带 Daemon 重算的新 plan，供调用方刷新。 */
  scope_plan?: ScopePlan;
}

interface CompletedConfirmation {
  confirmation_id: string;
  scheme_id: string;
  scheme_revision: number;
  result: ConfirmSchemeAtomicResult;
}

const completedConfirmations = new Map<string, CompletedConfirmation>();

/** 测试隔离用；持久幂等由快照 store 兜底。 */
export function resetConfirmSchemeTransactionsForTest(): void {
  completedConfirmations.clear();
}

function failed(
  confirmationId: string,
  failedAt: ConfirmSchemeStepId,
  code: string,
  reason: string,
  steps: ConfirmSchemeStepResult[],
  frozen: SchemeDraft | null = null,
  extra?: Partial<ConfirmSchemeAtomicResult>,
): ConfirmSchemeAtomicResult {
  return {
    ok: false,
    idempotent: false,
    steps,
    frozen,
    confirmation_id: confirmationId,
    failedAt,
    code,
    reason,
    ...extra,
  };
}

function validConfirmationId(value: string): boolean {
  return /^[A-Za-z0-9._-]{8,96}$/.test(value);
}

export function newSchemeConfirmationId(): string {
  return `scheme-confirm-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * 按五阶段执行。任何失败都返回结构化失败点，调用方只负责展示，
 * 不得再自行补签署步骤——否则会绕开幂等与补偿。
 */

function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function readDriftScopePlan(err: unknown): ScopePlan | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const plan = (err as { scope_plan?: unknown }).scope_plan;
  if (plan && typeof plan === "object" && "plan_digest" in (plan as object)) {
    return plan as ScopePlan;
  }
  return undefined;
}

export async function runConfirmSchemeAtomic(
  input: ConfirmSchemeAtomicInput,
): Promise<ConfirmSchemeAtomicResult> {
  const steps: ConfirmSchemeStepResult[] = [];

  if (!validConfirmationId(input.confirmationId)) {
    return failed(
      input.confirmationId,
      "CLAIM_AND_QUIESCE",
      "E_CONFIRMATION_ID_INVALID",
      "confirmation_id 必须为 8–96 位字母、数字、点、下划线或短横线",
      steps,
    );
  }

  const prior = completedConfirmations.get(input.confirmationId);
  if (prior) {
    if (
      prior.scheme_id === input.scheme.scheme_id &&
      prior.scheme_revision === input.expectedRevision
    ) {
      return { ...prior.result, idempotent: true };
    }
    return failed(
      input.confirmationId,
      "CLAIM_AND_QUIESCE",
      "E_CONFIRMATION_ID_REUSED",
      "confirmation_id 已用于另一版方案；请生成新的确认 id",
      steps,
    );
  }

  // 1. 先冻结输入：停流式 + 禁右栏，之后不再接受 Supervisor Patch。
  try {
    input.onStage?.("CLAIM_AND_QUIESCE");
    await input.quiesceRightChat();
    steps.push({ step: "CLAIM_AND_QUIESCE", ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "阻断右栏失败";
    steps.push({ step: "CLAIM_AND_QUIESCE", ok: false, reason });
    return failed(
      input.confirmationId,
      "CLAIM_AND_QUIESCE",
      "E_QUIESCE_FAILED",
      reason,
      steps,
    );
  }

  // 2. 在冻结后的同一修订上做最终求值（单谓词，UI 与 Daemon 共用）。
  input.onStage?.("VALIDATE_CONFIRMATION");
  if (input.expectedRevision !== input.scheme.scheme_revision) {
    input.restoreRightChat?.();
    steps.push({
      step: "VALIDATE_CONFIRMATION",
      ok: false,
      reason: "方案修订号已变化",
    });
    return failed(
      input.confirmationId,
      "VALIDATE_CONFIRMATION",
      "E_SCHEME_REVISION_MISMATCH",
      `期望修订 ${input.expectedRevision}，实际 ${input.scheme.scheme_revision}`,
      steps,
    );
  }

  const decision = evaluateSchemeConfirmation(
    input.scheme,
    input.demo,
    input.scopePlan,
  );
  if (!decision.ok) {
    input.restoreRightChat?.();
    steps.push({
      step: "VALIDATE_CONFIRMATION",
      ok: false,
      reason: decision.message,
    });
    return failed(
      input.confirmationId,
      "VALIDATE_CONFIRMATION",
      decision.code,
      decision.message,
      steps,
    );
  }
  steps.push({ step: "VALIDATE_CONFIRMATION", ok: true });

  const frozen = freezeScheme(input.scheme);

  // 3. 不可变快照。失败未签署，直接恢复右栏。
  let snapshot: PersistedSchemeSnapshot;
  try {
    input.onStage?.("FREEZE_SNAPSHOT");
    snapshot = await input.persistSnapshot({
      confirmation_id: input.confirmationId,
      scheme: frozen,
      demo: input.demo,
      decision,
    });
    steps.push({ step: "FREEZE_SNAPSHOT", ok: true });
  } catch (err) {
    input.restoreRightChat?.();
    const reason = err instanceof Error ? err.message : "快照落盘失败";
    const drift = readErrorCode(err) === "E_SCOPE_PLAN_DRIFT";
    const code = drift ? "E_SCOPE_PLAN_DRIFT" : "E_SCHEME_SNAPSHOT_FAILED";
    const freshPlan = drift ? readDriftScopePlan(err) : undefined;
    steps.push({ step: "FREEZE_SNAPSHOT", ok: false, reason });
    return failed(
      input.confirmationId,
      "FREEZE_SNAPSHOT",
      code,
      reason,
      steps,
      frozen,
      freshPlan ? { scope_plan: freshPlan } : undefined,
    );
  }

  // 4. 签署 + 施工准备。失败必须走补偿，补偿未成功则保持右栏锁定。
  let contractId: string;
  /**
   * 半签现场：合同已落库但施工准备未完成。补偿据此精确吊销，
   * 失败结果也回传该 id，便于调用方定位需要人工处理的合同。
   *
   * 用对象承载而不是裸 `let`：赋值发生在回调里，TS 无法跨闭包收窄，
   * 直接读 `let` 会被判成 `undefined`（甚至 `never`）。
   */
  const staging: { contractId: string | undefined } = { contractId: undefined };
  try {
    input.onStage?.("SIGN_AND_PREPARE");
    const signed = await input.signAndPrepare({
      confirmation_id: input.confirmationId,
      frozen,
      demo: input.demo,
      snapshot,
      onContractCreated: (id) => {
        staging.contractId = id;
      },
    });
    contractId = signed.contract_id;
    steps.push({ step: "SIGN_AND_PREPARE", ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "签署或施工准备失败";
    const staged = staging.contractId;
    let compensated = false;
    try {
      await input.compensate?.({
        confirmation_id: input.confirmationId,
        failed_at: "SIGN_AND_PREPARE",
        ...(staged === undefined ? {} : { contract_id: staged }),
        snapshot,
        cause: reason,
      });
      compensated = true;
    } catch {
      compensated = false;
    }
    if (compensated) input.restoreRightChat?.();
    steps.push({ step: "SIGN_AND_PREPARE", ok: false, reason });
    return failed(
      input.confirmationId,
      "SIGN_AND_PREPARE",
      compensated ? "E_SIGN_AND_PREPARE_FAILED" : "E_COMPENSATION_FAILED",
      compensated ? reason : `${reason}；补偿未完成，已保持锁定并需人工处理`,
      steps,
      frozen,
      {
        snapshot,
        ...(staged === undefined ? {} : { contract_id: staged }),
      },
    );
  }

  // 5. 提交事务并记住幂等结果。
  // J.7 / D9：右栏解锁由调用方在 COMMIT 成功后执行；本函数不再假定永久锁定。
  input.onStage?.("COMMIT");
  steps.push({ step: "COMMIT", ok: true });
  const result: ConfirmSchemeAtomicResult = {
    ok: true,
    idempotent: false,
    steps,
    frozen,
    confirmation_id: input.confirmationId,
    contract_id: contractId,
    snapshot,
  };
  completedConfirmations.set(input.confirmationId, {
    confirmation_id: input.confirmationId,
    scheme_id: input.scheme.scheme_id,
    scheme_revision: input.expectedRevision,
    result,
  });
  return result;
}
