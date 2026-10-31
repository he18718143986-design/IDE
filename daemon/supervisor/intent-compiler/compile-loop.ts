/**
 * 意图编译器 Daemon 编译循环（TASK-J.10）。
 *
 * 实施口径：intent-compiler-prompt.md §7；supervisor.md §14.4 / §14.8。
 * - 只由 USER_TURN_COMMITTED 触发（L-1 / V-05）
 * - 1.2s 防抖；同时最多 1 个在途（L-2）
 * - 只有 STALE 重试一次（L-3）；op 级丢弃不重试
 * - 模型依赖经 {@link IntentCompilerModelClient} 注入（ADR-0014 开放形态）
 * - 无钥匙 → 离线兜底信号（L-7 / V-06）；不把编译器输出回流右栏
 */
import {
  assembleCompilerOutput,
  type AssembleBatch,
  type CompilerSchemaEnums,
} from "../../../src/lib/journey/compiler-output-schema";
import { mergeSchemePatch } from "../../../src/lib/journey/scheme-patch-engine";
import type {
  LedgerState,
  MergeJournal,
  MergeResult,
  SchemePatch,
  TranscriptView,
} from "../../../src/lib/journey/scheme-patch-types";
import {
  rebuildSchemeFromCorpus,
  type SchemeDraft,
} from "../../../src/lib/journey/scheme-draft";
import type { SupervisorBudgetLedger } from "../budget";
import {
  COMPILER_PROMPT_VERSION,
  renderCompilerSystemPrompt,
} from "./system-prompt";
import {
  renderCompilerInput,
  type CompilerTranscriptMessage,
  type ProjectProfileView,
  type RenderCompilerInputResult,
} from "./render-input";

export const COMPILER_DEBOUNCE_MS = 1_200;
export const COMPILER_MODEL_TIMEOUT_MS = 30_000;
export const COMPILER_FAILURE_PROMPT_THRESHOLD = 3;

import {
  OFFLINE_BANNER_TEXT,
  COMPILING_BANNER_TEXT,
  BUDGET_EXCEEDED_BANNER_TEXT,
  FAILURE_BANNER_TEXT,
} from "../../../src/lib/journey/compiler-banners";

export {
  OFFLINE_BANNER_TEXT,
  COMPILING_BANNER_TEXT,
  BUDGET_EXCEEDED_BANNER_TEXT,
  FAILURE_BANNER_TEXT,
};

export type CompilerTrigger =
  | "USER_TURN_COMMITTED"
  | "AI_REPLY_FINISHED"
  | "IDLE_TIMER"
  | "USER_MANUAL_EDIT";

export interface IntentCompilerModelRequest {
  system: string;
  prompt: string;
  /** zod schema 由调用方按 enums 构造后传入；此处只传 enums 以便桩模型忽略 */
  enums: CompilerSchemaEnums;
  signal?: AbortSignal;
  temperature: 0;
}

export interface IntentCompilerModelSuccess {
  ok: true;
  raw: unknown;
  input_tokens: number;
  output_tokens: number;
  model_id: string;
}

export interface IntentCompilerModelFailure {
  ok: false;
  reason: "timeout" | "invalid" | "network" | "canceled";
  detail?: string;
}

export type IntentCompilerModelResult =
  | IntentCompilerModelSuccess
  | IntentCompilerModelFailure;

/** 可替换模型客户端（测试用桩；生产注入 generateObject） */
export interface IntentCompilerModelClient {
  generate(req: IntentCompilerModelRequest): Promise<IntentCompilerModelResult>;
}

export interface CompilerCasWriteInput {
  expectedPrevRevision: number;
  next: LedgerState;
  journal: MergeJournal;
  patch: SchemePatch;
  promptVersion: string;
  modelId: string | null;
  offline: boolean;
}

export type CompilerCasWriteResult =
  | { ok: true; revision: number }
  | { ok: false; reason: "cas_mismatch" | "io" };

export interface CompilerLoopDeps {
  /** 读取当前账本 */
  getState: () => LedgerState;
  /** 全量/可见 transcript */
  getTranscript: () => readonly CompilerTranscriptMessage[];
  getTranscriptView: () => TranscriptView;
  getProfile?: () => ProjectProfileView | null;
  getHistorySummary?: () => string | null;
  /** 方案是否已冻结（冻结则不编译） */
  isFrozen?: () => boolean;
  /** 是否有模型钥匙；缺省时看 modelClient !== null */
  hasModelKey?: () => boolean;
  modelClient: IntentCompilerModelClient | null;
  budget?: SupervisorBudgetLedger | null;
  /** CAS 落盘 */
  casWrite: (input: CompilerCasWriteInput) => Promise<CompilerCasWriteResult>;
  /** 确定性 new id */
  newId?: (prefix: "ITEM") => string;
  /** 8 位 hex；测试可注入 */
  randomNonce?: () => string;
  /** 时钟 */
  now?: () => number;
  /** 定时器注入 */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** 状态横幅 */
  onBanner?: (text: string | null) => void;
  /** 离线兜底后回调（宿主可把启发式 SchemeDraft 刷进中栏） */
  onOfflineFallback?: (corpus: string) => void;
  /** 结构化日志（禁用户原文） */
  onLog?: (entry: Record<string, unknown>) => void;
}

export interface CompilerLoopStats {
  modelCalls: number;
  failureCount: number;
  /** 已推进的批次游标（已消费的最后一条 turn_id） */
  batchCursor: string | null;
  lastStatus:
    | "idle"
    | "debouncing"
    | "running"
    | "applied"
    | "noop"
    | "stale"
    | "rejected"
    | "offline"
    | "budget"
    | "frozen"
    | null;
}

function defaultNonce(): string {
  const bytes = new Uint8Array(4);
  // 非加密随机即可；Node / 浏览器
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 编译循环控制器。宿主在用户消息落盘后调用 {@link notifyUserTurnCommitted}。
 */
export class IntentCompileLoop {
  private readonly deps: CompilerLoopDeps;
  private pendingTurnIds: string[] = [];
  private debounceHandle: unknown = null;
  private inFlight = false;
  private rerunAfter = false;
  private failureCount = 0;
  private batchCursor: string | null = null;
  private modelCalls = 0;
  private lastStatus: CompilerLoopStats["lastStatus"] = null;
  private disposed = false;
  private seqCounter = 0;

  constructor(deps: CompilerLoopDeps) {
    this.deps = deps;
  }

  getStats(): CompilerLoopStats {
    return {
      modelCalls: this.modelCalls,
      failureCount: this.failureCount,
      batchCursor: this.batchCursor,
      lastStatus: this.lastStatus,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.clearDebounce();
  }

  /**
   * 唯一合法触发入口（L-1）。其它事件走 {@link notifyNonTrigger} 并保证 modelCalls 不增加。
   */
  notifyUserTurnCommitted(turnId: string): void {
    if (this.disposed) return;
    this.pendingTurnIds.push(turnId);
    this.lastStatus = "debouncing";
    this.armDebounce();
  }

  /** AI 回复完毕 / 空闲计时 / 用户手改：明确不触发（V-05） */
  notifyNonTrigger(trigger: Exclude<CompilerTrigger, "USER_TURN_COMMITTED">): void {
    void trigger;
    // 故意空实现：结构性保证 modelCalls 不变
  }

  private armDebounce(): void {
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = this.deps.clearTimeoutFn ?? clearTimeout;
    if (this.debounceHandle !== null) {
      clearTimeoutFn(this.debounceHandle as NodeJS.Timeout);
    }
    this.debounceHandle = setTimeoutFn(() => {
      this.debounceHandle = null;
      void this.kick();
    }, COMPILER_DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this.debounceHandle === null) return;
    const clearTimeoutFn = this.deps.clearTimeoutFn ?? clearTimeout;
    clearTimeoutFn(this.debounceHandle as NodeJS.Timeout);
    this.debounceHandle = null;
  }

  private async kick(): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) {
      this.rerunAfter = true;
      return;
    }
    if (this.pendingTurnIds.length === 0) return;

    this.inFlight = true;
    try {
      await this.runOnce(0);
    } finally {
      this.inFlight = false;
      if (this.rerunAfter) {
        this.rerunAfter = false;
        if (this.pendingTurnIds.length > 0) {
          void this.kick();
        }
      }
    }
  }

  private batchSinceCursor(): string[] {
    const pending = this.pendingTurnIds.slice();
    if (this.batchCursor === null) return pending;
    const idx = pending.indexOf(this.batchCursor);
    // pending 里可能已不含 cursor；取 cursor 之后新到的
    if (idx >= 0) return pending.slice(idx + 1);
    return pending;
  }

  private async runOnce(attempt: 0 | 1): Promise<void> {
    const batch = this.batchSinceCursor();
    if (batch.length === 0) return;

    if (this.deps.isFrozen?.() === true || this.deps.getState().draft.frozen) {
      this.lastStatus = "frozen";
      this.deps.onBanner?.(null);
      return;
    }

    const hasKey =
      this.deps.hasModelKey?.() ?? this.deps.modelClient !== null;
    if (!hasKey || this.deps.modelClient === null) {
      await this.runOffline(batch);
      return;
    }

    if (this.deps.budget?.isBlocked()) {
      this.lastStatus = "budget";
      this.deps.onBanner?.(BUDGET_EXCEEDED_BANNER_TEXT);
      return;
    }

    this.deps.onBanner?.(COMPILING_BANNER_TEXT);
    this.lastStatus = "running";

    const state = this.deps.getState();
    const nonce = (this.deps.randomNonce ?? defaultNonce)();
    const rendered = renderCompilerInput({
      state,
      transcript: this.deps.getTranscript(),
      batchTurnIds: batch,
      profile: this.deps.getProfile?.() ?? null,
      historySummary: this.deps.getHistorySummary?.() ?? null,
      nonce,
    });

    const system = renderCompilerSystemPrompt(nonce);
    const enums: CompilerSchemaEnums = {
      ua: rendered.ua,
      ub: rendered.ub,
      ids: rendered.ids,
      rej: rendered.rej,
    };

    let modelResult: IntentCompilerModelResult;
    const started = (this.deps.now ?? Date.now)();
    try {
      if (this.deps.budget) {
        const outcome = await this.deps.budget.runModelCall<IntentCompilerModelResult>({
          call: async () => {
            const r = await this.callModel(system, rendered, enums);
            this.modelCalls += 1;
            if (!r.ok) {
              return {
                result: r,
                input_tokens: 0,
                output_tokens: 0,
              };
            }
            return {
              result: r,
              input_tokens: r.input_tokens,
              output_tokens: r.output_tokens,
            };
          },
        });
        modelResult = outcome.result;
      } else {
        modelResult = await this.callModel(system, rendered, enums);
        this.modelCalls += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/E_BUDGET_EXCEEDED|BUDGET/i.test(msg)) {
        this.lastStatus = "budget";
        this.deps.onBanner?.(BUDGET_EXCEEDED_BANNER_TEXT);
        return;
      }
      modelResult = { ok: false, reason: "network", detail: msg };
    }

    const elapsed = (this.deps.now ?? Date.now)() - started;
    if (!modelResult.ok) {
      this.noteFailure("model", modelResult.reason, elapsed, rendered);
      return;
    }

    const assembleBatch: AssembleBatch = {
      batchAliases: rendered.ub,
      batchTurnIds: batch,
    };
    const assembled = assembleCompilerOutput(
      modelResult.raw,
      rendered.aliasMap,
      state.draft.scheme_revision,
      assembleBatch,
      enums,
      this.deps.newId,
    );
    if (!assembled.ok) {
      this.noteFailure("assemble", assembled.subreason, elapsed, rendered, {
        model_id: modelResult.model_id,
      });
      return;
    }

    const merge = mergeSchemePatch({
      state,
      patch: assembled.patch,
      transcript: this.deps.getTranscriptView(),
      ctx: {
        attempt,
        newId: (p) => {
          if (p === "ITEM" && this.deps.newId) return this.deps.newId(p);
          this.seqCounter += 1;
          return `${p}-${this.seqCounter}`;
        },
      },
    });

    await this.handleMerge(
      merge,
      assembled.patch,
      attempt,
      modelResult.model_id,
      elapsed,
      rendered,
    );
  }

  private async callModel(
    system: string,
    rendered: RenderCompilerInputResult,
    enums: CompilerSchemaEnums,
  ): Promise<IntentCompilerModelResult> {
    const client = this.deps.modelClient;
    if (!client) return { ok: false, reason: "invalid", detail: "no_client" };

    const controller = new AbortController();
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = this.deps.clearTimeoutFn ?? clearTimeout;
    const timer = setTimeoutFn(() => {
      controller.abort();
    }, COMPILER_MODEL_TIMEOUT_MS);

    try {
      const result = await client.generate({
        system,
        prompt: rendered.prompt,
        enums,
        signal: controller.signal,
        temperature: 0,
      });
      if (!result.ok && result.reason === "canceled") {
        return { ok: false, reason: "timeout", detail: "aborted" };
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) return { ok: false, reason: "timeout", detail: msg };
      return { ok: false, reason: "network", detail: msg };
    } finally {
      clearTimeoutFn(timer as NodeJS.Timeout);
    }
  }

  private async handleMerge(
    merge: MergeResult,
    patch: SchemePatch,
    attempt: 0 | 1,
    modelId: string,
    elapsed: number,
    rendered: RenderCompilerInputResult,
  ): Promise<void> {
    if (merge.status === "applied" || merge.status === "noop") {
      const cas = await this.deps.casWrite({
        expectedPrevRevision: merge.expected_prev_revision,
        next: merge.next,
        journal: merge.journal,
        patch,
        promptVersion: COMPILER_PROMPT_VERSION,
        modelId,
        offline: false,
      });
      if (!cas.ok) {
        // CAS 失败视为 STALE
        if (attempt === 0) {
          this.deps.onLog?.({
            kind: "compiler_cas_mismatch",
            attempt,
            prompt_version: COMPILER_PROMPT_VERSION,
          });
          await this.runOnce(1);
          return;
        }
        this.lastStatus = "stale";
        // retry=false：不计入失败
        this.deps.onBanner?.(null);
        this.deps.onLog?.({
          kind: "compiler_stale_exhausted_cas",
          prompt_version: COMPILER_PROMPT_VERSION,
        });
        return;
      }
      // 推进游标：消费本批全部 pending（到当前 pending 末尾）
      const batch = this.batchSinceCursor();
      if (batch.length > 0) {
        this.batchCursor = batch[batch.length - 1] ?? this.batchCursor;
        // 从 pending 里丢掉已消费前缀
        const keepFrom = this.pendingTurnIds.findIndex(
          (id) => id === this.batchCursor,
        );
        if (keepFrom >= 0) {
          this.pendingTurnIds = this.pendingTurnIds.slice(keepFrom + 1);
        } else {
          this.pendingTurnIds = [];
        }
      }
      this.failureCount = 0;
      this.lastStatus = merge.status;
      this.deps.onBanner?.(null);
      this.deps.onLog?.({
        kind: "compiler_applied",
        status: merge.status,
        prompt_version: COMPILER_PROMPT_VERSION,
        model_id: modelId,
        elapsed_ms: elapsed,
        ua: rendered.ua.length,
        ub: rendered.ub.length,
        ops: patch.ops.length,
        // 不写用户原文
      });
      return;
    }

    if (merge.status === "stale") {
      this.lastStatus = "stale";
      if (merge.retry && attempt === 0) {
        this.deps.onLog?.({
          kind: "compiler_stale_retry",
          code: merge.code,
          prompt_version: COMPILER_PROMPT_VERSION,
        });
        await this.runOnce(1);
        return;
      }
      // retry=false / 已重试：不推进、不计入失败
      this.deps.onBanner?.(null);
      this.deps.onLog?.({
        kind: "compiler_stale_exhausted",
        code: merge.code,
        prompt_version: COMPILER_PROMPT_VERSION,
      });
      return;
    }

    if (merge.status === "frozen") {
      this.lastStatus = "frozen";
      this.deps.onBanner?.(null);
      return;
    }

    // rejected
    this.noteFailure("rejected", merge.code, elapsed, rendered, {
      model_id: modelId,
    });
  }

  private noteFailure(
    stage: string,
    detail: string,
    elapsed: number,
    rendered: RenderCompilerInputResult,
    extra: Record<string, unknown> = {},
  ): void {
    this.failureCount += 1;
    this.lastStatus = "rejected";
    this.deps.onLog?.({
      kind: "compiler_failure",
      stage,
      detail,
      failure_count: this.failureCount,
      prompt_version: COMPILER_PROMPT_VERSION,
      elapsed_ms: elapsed,
      ua: rendered.ua.length,
      ub: rendered.ub.length,
      ...extra,
    });
    if (this.failureCount >= COMPILER_FAILURE_PROMPT_THRESHOLD) {
      this.deps.onBanner?.(FAILURE_BANNER_TEXT);
    } else {
      this.deps.onBanner?.(null);
    }
  }

  private async runOffline(batch: string[]): Promise<void> {
    this.lastStatus = "offline";
    this.deps.onBanner?.(OFFLINE_BANNER_TEXT);
    const transcript = this.deps.getTranscript();
    const texts = batch
      .map((id) => transcript.find((t) => t.turn_id === id)?.text ?? "")
      .filter((t) => t.length > 0);
    const corpus = texts.join("\n");
    // 启发式只作中栏兜底；无证据、不可溯源（L-7）
    this.deps.onOfflineFallback?.(corpus);
    this.deps.onLog?.({
      kind: "compiler_offline",
      prompt_version: COMPILER_PROMPT_VERSION,
      batch_len: batch.length,
      corpus_len: corpus.length,
    });
    // 离线也推进游标，避免反复提示
    if (batch.length > 0) {
      this.batchCursor = batch[batch.length - 1] ?? this.batchCursor;
      const keepFrom = this.pendingTurnIds.findIndex(
        (id) => id === this.batchCursor,
      );
      if (keepFrom >= 0) {
        this.pendingTurnIds = this.pendingTurnIds.slice(keepFrom + 1);
      } else {
        this.pendingTurnIds = [];
      }
    }
  }
}

/** 离线兜底：现行 scheme-draft 启发式（无证据、不可溯源）。 */
export function buildOfflineSchemeDraft(
  corpus: string,
  previous: SchemeDraft | null = null,
): SchemeDraft {
  return rebuildSchemeFromCorpus(previous, corpus);
}
