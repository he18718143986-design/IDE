/**
 * TASK-J.46：模型失败日志留下原因原文，并抹掉钥匙。
 * 不打真实网络。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPILER_DEBOUNCE_MS,
  IntentCompileLoop,
} from "../../daemon/supervisor/intent-compiler/compile-loop";
import { clearRuntimeKey, setRuntimeKey } from "../../daemon/worker/key-store";
import { state } from "../helpers/scheme-patch-fixtures";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "STAGENT_MODEL",
  "STAGENT_PROVIDER",
] as const;

describe("J.46 编译器模型失败日志", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) saved[key] = value;
      else delete saved[key];
      delete process.env[key];
    }
    clearRuntimeKey();
  });

  afterEach(() => {
    clearRuntimeKey();
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("原因码仍是 network，client_detail 留下原文且钥匙已抹掉，不写台账", async () => {
    const runtimeKey = "runtime-key-not-sk-998877";
    const skToken = "sk-abcdefghijklmnopqrst";
    setRuntimeKey(runtimeKey);
    const logs: Record<string, unknown>[] = [];
    let casWrites = 0;
    const timers: { fn: () => void; ms: number }[] = [];
    const ledger = state({ scheme_revision: 5 });
    const transcript = [
      { turn_id: "T5", role: "user" as const, text: "我要一个登录页" },
    ];
    const loop = new IntentCompileLoop({
      getState: () => ledger,
      getTranscript: () => transcript,
      getTranscriptView: () => ({
        get: (id: string) =>
          id === "T5"
            ? {
                turn_id: "T5",
                role: "user" as const,
                seq: 5,
                text: "我要一个登录页",
                text_sha256: "0".repeat(64),
              }
            : undefined,
      }),
      hasModelKey: () => true,
      modelClient: {
        async generate() {
          return {
            ok: false as const,
            reason: "network" as const,
            detail: `connect ECONNREFUSED ${runtimeKey} ${skToken}`,
          };
        },
      },
      casWrite: async () => {
        casWrites += 1;
        return { ok: true, revision: 6 };
      },
      onLog: (entry) => {
        logs.push(entry);
      },
      randomNonce: () => "aabbccdd",
      setTimeoutFn: (fn, ms) => {
        timers.push({ fn: fn as () => void, ms });
        return timers.length;
      },
      clearTimeoutFn: () => undefined,
      newId: () => "ITEM-1",
    });

    loop.notifyUserTurnCommitted("T5");
    const due = timers.filter((t) => t.ms === COMPILER_DEBOUNCE_MS);
    timers.length = 0;
    for (const t of due) t.fn();

    await vi.waitFor(() => {
      expect(logs.some((entry) => entry["kind"] === "compiler_failure")).toBe(
        true,
      );
    });

    const failure = logs.find((entry) => entry["kind"] === "compiler_failure");
    expect(failure).toMatchObject({
      stage: "model",
      detail: "network",
    });
    expect(failure?.["client_detail"]).toBe(
      "connect ECONNREFUSED [REDACTED] [REDACTED]",
    );
    expect(String(failure?.["client_detail"])).not.toContain(runtimeKey);
    expect(String(failure?.["client_detail"])).not.toContain(skToken);
    expect(casWrites).toBe(0);
  });
});
