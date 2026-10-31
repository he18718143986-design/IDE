/**
 * 意图编译器生产宿主（TASK-J.10）。
 *
 * 唯一合法触发：用户消息提交 → {@link IntentCompilerHost.commitUserTurn}
 * → {@link IntentCompileLoop.notifyUserTurnCommitted} → 组装/merge/CAS 落盘。
 *
 * ADR-0014 / DEC-004：不产生 partner_hint，不回流右栏聊天。
 */
import { createHash } from "node:crypto";
import type { TranscriptTurn, TranscriptView } from "../../../src/lib/journey/scheme-patch-types";
import type { LedgerState } from "../../../src/lib/journey/scheme-patch-types";
import {
  IntentCompileLoop,
  type CompilerLoopStats,
  type IntentCompilerModelClient,
} from "./compile-loop";

export type { CompilerLoopStats, IntentCompilerModelClient };
import type { CompilerTranscriptMessage } from "./render-input";
import {
  casWriteSchemeLedger,
  loadOrInitLedgerState,
  readSchemeLedger,
  type SchemeLedgerRecord,
} from "./scheme-ledger-store";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface IntentCompilerHostOptions {
  repoRoot: string;
  /** 可替换模型客户端；null / 缺省 → 离线兜底（V-06） */
  modelClient?: IntentCompilerModelClient | null;
  hasModelKey?: () => boolean;
  /** 测试注入时钟 / 定时器（便于跳过 1.2s 防抖） */
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  randomNonce?: () => string;
  newId?: (prefix: "ITEM") => string;
  onBanner?: (text: string | null) => void;
  /** CAS 成功后回调（宿主可广播；禁止把编译器输出塞进右栏） */
  onLedgerApplied?: (state: LedgerState) => void;
  /** 离线启发式 corpus（中栏兜底；无证据） */
  onOfflineFallback?: (corpus: string) => void;
  onLog?: (entry: Record<string, unknown>) => void;
}

export interface CommitUserTurnInput {
  text: string;
  /** 显式 turn_id；缺省 `T${seq}` */
  turnId?: string;
}

export interface CommitUserTurnResult {
  turn_id: string;
  seq: number;
}

/**
 * 持有 transcript + 账本 + 编译循环的生产宿主。
 * Daemon 在 `POST /api/supervisor/journey` 用户消息落盘后调用 {@link commitUserTurn}。
 */
export class IntentCompilerHost {
  readonly repoRoot: string;
  private readonly loop: IntentCompileLoop;
  private state: LedgerState;
  private readonly turns: CompilerTranscriptMessage[] = [];
  private readonly turnIndex = new Map<string, TranscriptTurn>();
  private seq = 0;
  private userAliasSeq = 0;
  private disposed = false;
  private readonly pendingTimers: Array<() => void> = [];
  private readonly usingTestTimers: boolean;

  constructor(options: IntentCompilerHostOptions) {
    this.repoRoot = options.repoRoot;
    this.state = loadOrInitLedgerState(options.repoRoot);
    this.usingTestTimers = options.setTimeoutFn !== undefined;

    const setTimeoutFn =
      options.setTimeoutFn ??
      ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearTimeoutFn =
      options.clearTimeoutFn ??
      ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));

    // 测试模式：记录 debounce 回调以便 flushForTest
    const trackedSetTimeout = (fn: () => void, ms: number) => {
      if (this.usingTestTimers) {
        const wrapped = () => {
          const idx = this.pendingTimers.indexOf(wrapped);
          if (idx >= 0) this.pendingTimers.splice(idx, 1);
          fn();
        };
        this.pendingTimers.push(wrapped);
        return setTimeoutFn(wrapped, ms);
      }
      return setTimeoutFn(fn, ms);
    };

    this.loop = new IntentCompileLoop({
      getState: () => this.state,
      getTranscript: () => this.turns,
      getTranscriptView: () => this.transcriptView(),
      isFrozen: () => this.state.draft.frozen,
      modelClient: options.modelClient ?? null,
      casWrite: async (input) => {
        const result = casWriteSchemeLedger(this.repoRoot, input);
        if (result.ok) {
          this.state = input.next;
          options.onLedgerApplied?.(input.next);
        } else {
          // CAS 失败时从磁盘重载，保证下次重试看到最新 revision
          this.state = loadOrInitLedgerState(this.repoRoot);
        }
        return result;
      },
      setTimeoutFn: trackedSetTimeout,
      clearTimeoutFn: (handle) => {
        clearTimeoutFn(handle);
      },
      onOfflineFallback: (corpus) => {
        options.onOfflineFallback?.(corpus);
      },
      ...(options.hasModelKey === undefined
        ? {}
        : { hasModelKey: options.hasModelKey }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.randomNonce === undefined
        ? {}
        : { randomNonce: options.randomNonce }),
      ...(options.newId === undefined ? {} : { newId: options.newId }),
      ...(options.onBanner === undefined ? {} : { onBanner: options.onBanner }),
      ...(options.onLog === undefined ? {} : { onLog: options.onLog }),
    });
  }

  /** 当前内存账本（与磁盘在成功 CAS 后一致） */
  getLedger(): LedgerState {
    return this.state;
  }

  /** 磁盘权威账本 */
  readPersistedLedger(): SchemeLedgerRecord | null {
    return readSchemeLedger(this.repoRoot);
  }

  getStats(): CompilerLoopStats {
    return this.loop.getStats();
  }

  /**
   * 生产入口：用户消息已提交（USER_TURN_COMMITTED）。
   * 追加 transcript 后通知编译循环（1.2s 防抖 → 组装/merge/CAS）。
   */
  commitUserTurn(input: CommitUserTurnInput): CommitUserTurnResult {
    if (this.disposed) {
      throw new Error("IntentCompilerHost disposed");
    }
    const text = input.text.trim();
    if (text.length === 0) {
      throw new Error("empty user turn");
    }
    this.seq += 1;
    this.userAliasSeq += 1;
    const turn_id = input.turnId ?? `T${this.seq}`;
    const seq = this.seq;
    const turn: TranscriptTurn = {
      turn_id,
      role: "user",
      seq,
      text,
      text_sha256: sha256(text),
    };
    this.turnIndex.set(turn_id, turn);
    this.turns.push({
      turn_id,
      role: "user",
      text,
      user_alias_seq: this.userAliasSeq,
    });
    this.loop.notifyUserTurnCommitted(turn_id);
    return { turn_id, seq };
  }

  /**
   * 记录 AI/Supervisor 回复到 transcript（不触发编译，V-05）。
   */
  recordAssistantTurn(text: string): void {
    if (this.disposed) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.seq += 1;
    const turn_id = `T${this.seq}`;
    this.turnIndex.set(turn_id, {
      turn_id,
      role: "assistant",
      seq: this.seq,
      text: trimmed,
      text_sha256: sha256(trimmed),
    });
    this.turns.push({ turn_id, role: "assistant", text: trimmed });
    this.loop.notifyNonTrigger("AI_REPLY_FINISHED");
  }

  /**
   * 测试辅助：触发所有已登记的防抖回调，并等到循环空闲。
   * 生产路径勿调用。
   */
  async flushForTest(): Promise<void> {
    const due = this.pendingTimers.splice(0, this.pendingTimers.length);
    for (const fn of due) fn();
    // 等 in-flight 结束
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const s = this.loop.getStats().lastStatus;
      if (s !== "debouncing" && s !== "running") return;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pendingTimers.length = 0;
    this.loop.dispose();
  }

  private transcriptView(): TranscriptView {
    return {
      get: (id: string) => this.turnIndex.get(id),
    };
  }
}

export function createIntentCompilerHost(
  options: IntentCompilerHostOptions,
): IntentCompilerHost {
  return new IntentCompilerHost(options);
}
