/**
 * TASK-J.10 生产接线集成测：
 * 用户消息提交（journey POST）→ notifyUserTurnCommitted → 组装/merge → CAS 落盘。
 *
 * 覆盖正常用户流程，不只是 compile-loop 单测模块。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import type { IntentCompilerModelClient } from "../../daemon/supervisor/intent-compiler/compile-loop";
import {
  readSchemeLedger,
  schemeLedgerPath,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

describe("J.10 用户消息 → 方案补丁落盘（生产接线）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;
  let modelCalls = 0;

  const USER_TEXT = "我要一个登录页";

  beforeEach(async () => {
    modelCalls = 0;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j10-wire-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const stub: IntentCompilerModelClient = {
      async generate(req) {
        modelCalls += 1;
        const from = req.enums.ub[0] ?? req.enums.ua[0] ?? "U1";
        return {
          ok: true,
          raw: {
            quotes: [{ qid: "q1", from, text: USER_TEXT }],
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
          input_tokens: 10,
          output_tokens: 20,
          model_id: "stub-j10",
        };
      },
    };

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3810,
      endPort: 3819,
      enableCrashRecovery: false,
      intentCompilerModelClient: stub,
      // 只登记回调，由 flushIntentCompilerForTest 触发（跳过 1.2s 墙钟）
      intentCompilerSetTimeout: (fn) => {
        (fn as () => void);
        // 由 Host.pendingTimers 跟踪；此处返回句柄即可
        return 1;
      },
      intentCompilerClearTimeout: () => undefined,
    });

    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    try {
      if (daemon?.isRunning) await daemon.stop();
    } catch {
      /* ignore */
    }
    daemon = null;
    try {
      safeRmSync(repo);
    } catch {
      /* ignore */
    }
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  it("POST /api/supervisor/journey 后编译循环 CAS 写入 scheme-ledger", async () => {
    const res = await fetch(`${base}/api/supervisor/journey`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ message: USER_TEXT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plain_summary?: string };
    expect(typeof body.plain_summary).toBe("string");

    await daemon!.flushIntentCompilerForTest();

    expect(modelCalls).toBeGreaterThanOrEqual(1);

    const ledgerFile = schemeLedgerPath(repo);
    expect(fs.existsSync(ledgerFile)).toBe(true);

    const record = readSchemeLedger(repo);
    expect(record).not.toBeNull();
    expect(record!.last_model_id).toBe("stub-j10");
    expect(record!.offline).toBe(false);
    expect(record!.state.draft.scheme_revision).toBeGreaterThan(0);

    const login = record!.state.draft.modules.find((m) => m.name === "登录页");
    expect(login).toBeDefined();
    expect(login!.purpose).toContain("登录");
    expect(login!.source).toBe("user_said");
    expect(login!.evidence.length).toBeGreaterThan(0);
    expect(JSON.stringify(record).includes("partner_hint")).toBe(false);
  });

  it("无模型钥匙时走离线兜底，不调用模型", async () => {
    await daemon!.stop();
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3820,
      endPort: 3829,
      enableCrashRecovery: false,
      intentCompilerModelClient: null,
      intentCompilerSetTimeout: (fn) => {
        // Host 会登记到 pendingTimers；此处 no-op 调度
        void fn;
        return 1;
      },
      intentCompilerClearTimeout: () => undefined,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";

    const res = await fetch(`${base}/api/supervisor/journey`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ message: "随便说一句" }),
    });
    expect(res.status).toBe(200);
    await daemon.flushIntentCompilerForTest();

    const stats = daemon.getIntentCompilerStatsForTest();
    expect(stats?.lastStatus).toBe("offline");
    expect(stats?.modelCalls).toBe(0);
  });
});
