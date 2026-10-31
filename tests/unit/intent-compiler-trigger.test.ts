/**
 * TASK-J.10 / V-05：只有 USER_TURN_COMMITTED 触发模型；其它事件 modelCalls=0。
 */
import { describe, expect, it, vi } from "vitest";
import {
  COMPILER_DEBOUNCE_MS,
  IntentCompileLoop,
  type IntentCompilerModelClient,
} from "../../daemon/supervisor/intent-compiler/compile-loop";
import { state } from "../helpers/scheme-patch-fixtures";
import type { LedgerState } from "../../src/lib/journey/scheme-patch-types";

function makeLoop(opts: {
  model?: IntentCompilerModelClient | null;
  getState?: () => LedgerState;
}) {
  const timers: { fn: () => void; ms: number }[] = [];
  const modelCalls: unknown[] = [];
  const client: IntentCompilerModelClient | null =
    opts.model === undefined
      ? {
          async generate(req) {
            modelCalls.push(req);
            return {
              ok: true,
              raw: { quotes: [], ops: [] },
              input_tokens: 1,
              output_tokens: 1,
              model_id: "stub",
            };
          },
        }
      : opts.model;

  let ledger = opts.getState?.() ?? state({ scheme_revision: 5 });
  const transcript = [
    { turn_id: "T5", role: "user" as const, text: "我要导出报表" },
  ];
  const view = {
    get: (id: string) =>
      id === "T5"
        ? {
            turn_id: "T5",
            role: "user" as const,
            seq: 5,
            text: "我要导出报表",
            text_sha256: "0".repeat(64),
          }
        : undefined,
  };

  const loop = new IntentCompileLoop({
    getState: () => ledger,
    getTranscript: () => transcript,
    getTranscriptView: () => view,
    modelClient: client,
    hasModelKey: () => client !== null,
    casWrite: async () => {
      ledger = {
        ...ledger,
        draft: {
          ...ledger.draft,
          scheme_revision: ledger.draft.scheme_revision + 1,
        },
      };
      return { ok: true, revision: ledger.draft.scheme_revision };
    },
    randomNonce: () => "aabbccdd",
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn: fn as () => void, ms });
      return timers.length;
    },
    clearTimeoutFn: () => undefined,
    newId: () => "ITEM-1",
  });

  return {
    loop,
    timers,
    modelCalls,
    flushDebounce() {
      const due = timers.filter((t) => t.ms === COMPILER_DEBOUNCE_MS);
      timers.length = 0;
      for (const t of due) t.fn();
    },
  };
}

describe("V-05 触发纪律", () => {
  it("AI_REPLY_FINISHED / IDLE_TIMER / USER_MANUAL_EDIT 不增加 modelCalls", async () => {
    const { loop, modelCalls, flushDebounce } = makeLoop({});
    loop.notifyNonTrigger("AI_REPLY_FINISHED");
    loop.notifyNonTrigger("IDLE_TIMER");
    loop.notifyNonTrigger("USER_MANUAL_EDIT");
    flushDebounce();
    await Promise.resolve();
    expect(loop.getStats().modelCalls).toBe(0);
    expect(modelCalls).toHaveLength(0);
  });

  it("USER_TURN_COMMITTED 经防抖后触发一次模型调用", async () => {
    const { loop, modelCalls, flushDebounce } = makeLoop({});
    loop.notifyUserTurnCommitted("T5");
    expect(loop.getStats().modelCalls).toBe(0);
    flushDebounce();
    // 等待 async kick
    await vi.waitFor(() => {
      expect(loop.getStats().modelCalls).toBe(1);
    });
    expect(modelCalls).toHaveLength(1);
  });
});
