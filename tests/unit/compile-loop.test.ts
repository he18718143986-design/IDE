/**
 * TASK-J.10：编译循环 ADV-26～28（STALE 重试 / 耗尽 / ABA）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  COMPILER_DEBOUNCE_MS,
  IntentCompileLoop,
  type IntentCompilerModelClient,
} from "../../daemon/supervisor/intent-compiler/compile-loop";
import { state } from "../helpers/scheme-patch-fixtures";
import type { LedgerState } from "../../src/lib/journey/scheme-patch-types";

function harness(opts: {
  casResults: Array<{ ok: true; revision: number } | { ok: false; reason: "cas_mismatch" | "io" }>;
  /** 每次模型调用时读取的 revision 序列；缺省恒 12 */
  revisions?: number[];
}) {
  const timers: { fn: () => void; ms: number }[] = [];
  let callIdx = 0;
  let casIdx = 0;
  const logs: Record<string, unknown>[] = [];
  let revisionSeq = opts.revisions ? [...opts.revisions] : [];
  let currentRev = revisionSeq.shift() ?? 12;

  const getState = (): LedgerState =>
    state({ scheme_revision: currentRev });

  const client: IntentCompilerModelClient = {
    async generate() {
      callIdx += 1;
      // 合法空补丁（noop）
      return {
        ok: true,
        raw: { quotes: [], ops: [] },
        input_tokens: 1,
        output_tokens: 1,
        model_id: "stub",
      };
    },
  };

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
    getState,
    getTranscript: () => transcript,
    getTranscriptView: () => view,
    modelClient: client,
    casWrite: async () => {
      const r = opts.casResults[casIdx] ?? { ok: true as const, revision: currentRev + 1 };
      casIdx += 1;
      if (r.ok) {
        currentRev = r.revision;
      } else if (revisionSeq.length > 0) {
        // 模拟用户手改推进 revision
        currentRev = revisionSeq.shift() ?? currentRev + 1;
      } else {
        currentRev += 1;
      }
      return r;
    },
    randomNonce: () => "aabbccdd",
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn: fn as () => void, ms });
      return timers.length;
    },
    clearTimeoutFn: () => undefined,
    newId: () => "ITEM-1",
    onLog: (e) => logs.push(e),
  });

  return {
    loop,
    logs,
    get callCount() {
      return callIdx;
    },
    get casCount() {
      return casIdx;
    },
    async flush() {
      const due = timers.splice(0, timers.length).filter((t) => t.ms === COMPILER_DEBOUNCE_MS);
      for (const t of due) t.fn();
      await vi.waitFor(() => {
        expect(loop.getStats().lastStatus).not.toBe("debouncing");
        expect(loop.getStats().lastStatus).not.toBe("running");
      });
    },
  };
}

describe("ADV-26～28 编译循环 STALE", () => {
  it("ADV-26：attempt0 CAS mismatch → 重试一次 → applied；失败计数不增加", async () => {
    const h = harness({
      casResults: [
        { ok: false, reason: "cas_mismatch" },
        { ok: true, revision: 13 },
      ],
      revisions: [12, 13],
    });
    h.loop.notifyUserTurnCommitted("T5");
    await h.flush();
    expect(h.callCount).toBe(2);
    expect(h.loop.getStats().lastStatus).toBe("noop"); // 空 ops → noop
    expect(h.loop.getStats().failureCount).toBe(0);
    expect(h.loop.getStats().batchCursor).toBe("T5");
  });

  it("ADV-27：第二次仍 CAS mismatch → stale；失败计数不增加；游标不推进", async () => {
    const h = harness({
      casResults: [
        { ok: false, reason: "cas_mismatch" },
        { ok: false, reason: "cas_mismatch" },
      ],
      revisions: [12, 13, 14],
    });
    h.loop.notifyUserTurnCommitted("T5");
    await h.flush();
    expect(h.callCount).toBe(2);
    expect(h.loop.getStats().lastStatus).toBe("stale");
    expect(h.loop.getStats().failureCount).toBe(0);
    expect(h.loop.getStats().batchCursor).toBeNull();
  });

  it("ADV-28：迟到补丁（ABA）经 CAS 挡下后可重编译", async () => {
    // 第一次 CAS 失败（内容回到旧修订的表象），第二次成功
    const h = harness({
      casResults: [
        { ok: false, reason: "cas_mismatch" },
        { ok: true, revision: 13 },
      ],
      revisions: [12, 13],
    });
    h.loop.notifyUserTurnCommitted("T5");
    await h.flush();
    expect(h.loop.getStats().lastStatus).toBe("noop");
    expect(h.logs.some((l) => l["kind"] === "compiler_cas_mismatch")).toBe(true);
  });
});
