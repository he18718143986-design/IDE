/**
 * TASK-J.45：生产意图编译器客户端。
 * 不打真实网络。钥匙在 generate 内重读；Daemon 缺省挂上常驻客户端。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { clearRuntimeKey, setRuntimeKey } from "../../daemon/worker/key-store";
import { createOpenAiCompilerClient } from "../../daemon/supervisor/intent-compiler/openai-compiler-client";
import type { IntentCompilerModelRequest } from "../../daemon/supervisor/intent-compiler/compile-loop";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  readSchemeLedger,
  schemeLedgerPath,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { projectSchemeMidpane } from "../../daemon/supervisor/intent-compiler/scheme-midpane-projection";
import { schemeDraftFromMidpane } from "../../src/lib/journey/scheme-draft";

const h = vi.hoisted(() => ({
  generateObject: vi.fn(),
  createOpenAI: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: h.generateObject,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: h.createOpenAI,
}));

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "STAGENT_MODEL",
  "STAGENT_PROVIDER",
] as const;

const request = (
  extra: Partial<IntentCompilerModelRequest> = {},
): IntentCompilerModelRequest => ({
  system: "sys",
  prompt: "我要一个登录页",
  enums: { ua: ["U1"], ub: ["U1"], ids: [], rej: [] },
  temperature: 0,
  ...extra,
});

describe("J.45 生产意图编译器客户端", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) saved[key] = value;
      else delete saved[key];
      delete process.env[key];
    }
    clearRuntimeKey();
    h.generateObject.mockReset();
    h.createOpenAI.mockReset();
    h.createOpenAI.mockImplementation(
      (opts: { apiKey: string; baseURL?: string }) => (modelId: string) => ({
        modelId,
        apiKey: opts.apiKey,
        baseURL: opts.baseURL,
      }),
    );
  });

  afterEach(() => {
    clearRuntimeKey();
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("无钥匙不发请求；写入钥匙后同一客户端读到新钥匙", async () => {
    const client = createOpenAiCompilerClient();
    const blocked = await client.generate(request());
    expect(blocked).toEqual({ ok: false, reason: "invalid", detail: "no_key" });
    expect(h.generateObject).not.toHaveBeenCalled();
    expect(h.createOpenAI).not.toHaveBeenCalled();

    setRuntimeKey("sk-after-start", "model-after-start", {
      provider: "openai",
    });
    h.generateObject.mockResolvedValue({
      object: { marker: "scheme" },
      usage: { inputTokens: 3, outputTokens: 4 },
    });

    const produced = await client.generate(request());
    expect(produced).toEqual({
      ok: true,
      raw: { marker: "scheme" },
      input_tokens: 3,
      output_tokens: 4,
      model_id: "model-after-start",
    });
    expect(h.createOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-after-start",
      baseURL: "https://api.openai.com/v1",
    });
    const call = h.generateObject.mock.calls[0]?.[0] as {
      temperature: number;
      maxRetries: number;
      system: string;
      prompt: string;
      schema: unknown;
    };
    expect(call.temperature).toBe(0);
    expect(call.maxRetries).toBe(0);
    expect(call.system).toBe("sys");
    expect(call.prompt).toBe("我要一个登录页");
    expect(call.schema).toBeTruthy();

    clearRuntimeKey();
    h.generateObject.mockClear();
    h.createOpenAI.mockClear();
    const again = await client.generate(request());
    expect(again).toEqual({ ok: false, reason: "invalid", detail: "no_key" });
    expect(h.generateObject).not.toHaveBeenCalled();
  });

  it("已中止的信号不发请求", async () => {
    setRuntimeKey("sk-abort", "model-abort", { provider: "openai" });
    const controller = new AbortController();
    controller.abort();
    const client = createOpenAiCompilerClient();
    const result = await client.generate(
      request({ signal: controller.signal }),
    );
    expect(result).toEqual({
      ok: false,
      reason: "canceled",
      detail: "aborted",
    });
    expect(h.generateObject).not.toHaveBeenCalled();
  });

  it("模型调用失败记为 network，只打一次", async () => {
    setRuntimeKey("sk-net", "model-net", { provider: "openai" });
    h.generateObject.mockRejectedValue(new Error("socket hang up"));
    const client = createOpenAiCompilerClient();
    const result = await client.generate(request());
    expect(result).toEqual({
      ok: false,
      reason: "network",
      detail: "socket hang up",
    });
    expect(h.generateObject).toHaveBeenCalledTimes(1);
  });

  it("启动后写入钥匙，同一进程写出可审阅方案；此前无钥匙不写台账", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j45-"));
    let daemon: StagentDaemon | null = null;
    try {
      git(repo, ["init", "-q", "-b", "main"]);
      git(repo, ["config", "user.email", "t@example.com"]);
      git(repo, ["config", "user.name", "T"]);
      fs.mkdirSync(path.join(repo, "src"), { recursive: true });
      fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", "init"]);

      daemon = createDaemon({
        repoRoot: repo,
        startPort: 4915,
        endPort: 4924,
        enableCrashRecovery: false,
        intentCompilerSetTimeout: () => 1,
        intentCompilerClearTimeout: () => undefined,
      });
      const info = await daemon.start();
      const base = `http://127.0.0.1:${info.port}`;
      const token = daemon.getSessionToken() ?? "";
      const auth = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        connection: "close",
      };

      const offline = await fetch(`${base}/api/supervisor/journey`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ message: "先随便说一句" }),
      });
      expect(offline.status).toBe(200);
      await daemon.flushIntentCompilerForTest();
      expect(daemon.getIntentCompilerStatsForTest()?.lastStatus).toBe(
        "offline",
      );
      expect(daemon.getIntentCompilerStatsForTest()?.modelCalls).toBe(0);
      expect(h.generateObject).not.toHaveBeenCalled();
      expect(fs.existsSync(schemeLedgerPath(repo))).toBe(false);
      expect(projectSchemeMidpane(readSchemeLedger(repo)).available).toBe(
        false,
      );

      setRuntimeKey("sk-resident", "model-resident", { provider: "openai" });
      h.generateObject.mockImplementation(
        (opts: { prompt?: string; abortSignal?: AbortSignal }) => {
          const prompt = String(opts.prompt ?? "");
          const batch = prompt.match(
            /alias="(U\d+)" role="user" quotable="yes" batch="yes">([\s\S]*?)<\/turn>/,
          );
          const from = batch?.[1] ?? "U1";
          const text = batch?.[2] ?? "我要一个登录页";
          return Promise.resolve({
            object: {
              quotes: [{ qid: "q1", from, text }],
              ops: [
                {
                  op: "upsert_module",
                  source: "user_said",
                  item: {
                    id: "new:login",
                    name: "登录页",
                    purpose: "用户登录入口",
                    user_visible: true,
                    kind: "new",
                    project_anchor: null,
                  },
                  evidence: [{ qid: "q1" }],
                  revival: null,
                },
              ],
            },
            usage: { inputTokens: 11, outputTokens: 22 },
          });
        },
      );

      const live = await fetch(`${base}/api/supervisor/journey`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ message: "我要一个登录页" }),
      });
      expect(live.status).toBe(200);
      await daemon.flushIntentCompilerForTest();

      expect(h.generateObject).toHaveBeenCalledTimes(1);
      expect(h.createOpenAI).toHaveBeenCalledWith({
        apiKey: "sk-resident",
        baseURL: "https://api.openai.com/v1",
      });
      const record = readSchemeLedger(repo);
      expect(record).not.toBeNull();
      expect(record!.offline).toBe(false);
      expect(record!.last_model_id).toBe("model-resident");
      const login = record!.state.draft.modules.find(
        (m) => m.name === "登录页",
      );
      expect(login?.source).toBe("user_said");
      expect(login?.evidence.length).toBeGreaterThan(0);
      expect(JSON.stringify(record).includes("partner_hint")).toBe(false);

      const view = projectSchemeMidpane(record);
      expect(view.available).toBe(true);
      expect(view.modules.some((m) => m.name === "登录页")).toBe(true);
      const draft = schemeDraftFromMidpane(view, null);
      expect(draft).not.toBeNull();
      expect(draft!.modules.length).toBeGreaterThan(0);
    } finally {
      if (daemon?.isRunning) await daemon.stop();
      safeRmSync(repo);
    }
  });
});
