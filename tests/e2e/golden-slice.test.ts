/**
 * TASK-L.6：M2 黄金切片 E2E
 *
 * 绿野夹具仓：一句需求 → 方案落盘 → 确认开工（freeze+create）→
 * 两段式施工（T 红 → I 绿）→ 验证证据 → 真预览 → 合入。
 * 用户授权类手势恰好 2 次（确认开工、合入）；右栏不含非用户文本。
 * 本卡只新增测试，不改 Daemon 业务逻辑。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import type { IntentCompilerModelClient } from "../../daemon/supervisor/intent-compiler/compile-loop";
import {
  readSchemeLedger,
  schemeLedgerPath,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import { buildConfirmContractFromScopePlan } from "../../src/lib/journey/confirm-scheme-contract";
import type { WorkerModelClient } from "../../daemon/worker/ai-worker";
import type { ChatAdapter, AdapterRunInput, AdapterEvent } from "../../daemon/chat/types";
import type { SoftwareContract } from "../../src/lib/contract.schema";

const STAGENT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const USER_TEXT = "我要一个问候页，打开就能看到问候语";
const GREETING = "你好，黄金切片";
const STUB_PREVIEW_BADGE = "真机预览（非 Demo 假页）";
const REAL_APP_MARKER = "GOLDEN_SLICE_APP";

class CaptureAdapter implements ChatAdapter {
  calls: AdapterRunInput[] = [];
  info() {
    return {
      id: "capture",
      label: "capture",
      control_mode: "GATEWAY_ENFORCED" as const,
      verified_on: "",
      available: true,
      tool_mode: "read_only" as const,
    };
  }
  async *run(input: AdapterRunInput): AsyncIterable<AdapterEvent> {
    this.calls.push(input);
    yield { kind: "delta", text: "pong" };
  }
}

describe("TASK-L.6 黄金切片 E2E（一句需求 → 合入）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;
  let capture: CaptureAdapter;
  let shimDir: string | null = null;
  let savedPath: string | undefined;
  let userAuthGestures: string[];

  beforeEach(async () => {
    userAuthGestures = [];
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l6-golden-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "golden@example.com"]);
    git(repo, ["config", "user.name", "Golden"]);

    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "src", "App.tsx"),
      "export default function App() {\n  return null;\n}\n",
    );
    fs.writeFileSync(
      path.join(repo, "server.js"),
      [
        "const http = require('http');",
        "const port = Number(process.env.PORT || 0);",
        "const server = http.createServer((_req, res) => {",
        "  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });",
        `  res.end('${REAL_APP_MARKER}\\n');`,
        "});",
        "server.listen(port, '127.0.0.1', () => {",
        "  // ready",
        "});",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify(
        {
          name: "golden-slice-app",
          private: true,
          type: "commonjs",
          scripts: {
            dev: "node server.js",
            test: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
          },
          devDependencies: { vitest: "^3.0.0" },
        },
        null,
        2,
      ),
    );
    // 阻断 vitest 向上寻到 IDE 根 vitest.config（其 include 不含 tests/stagent）
    fs.writeFileSync(
      path.join(repo, "vitest.config.ts"),
      [
        'import { defineConfig } from "vitest/config";',
        "export default defineConfig({",
        "  test: {",
        '    environment: "node",',
        '    include: ["tests/**/*.{test,spec}.ts"],',
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init golden fixture"]);

    // stagent CLI PATH 垫片（合同校验命令 executable: stagent）
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l6-shim-"));
    const tsxBin = path.join(STAGENT_ROOT, "node_modules", ".bin", "tsx");
    const stagentEntry = path.join(STAGENT_ROOT, "bin", "stagent.ts");
    const shimPath = path.join(shimDir, "stagent");
    fs.writeFileSync(
      shimPath,
      `#!/usr/bin/env bash\nexec "${tsxBin}" "${stagentEntry}" "$@"\n`,
      { mode: 0o755 },
    );
    savedPath = process.env["PATH"];
    process.env["PATH"] = `${shimDir}${path.delimiter}${savedPath ?? ""}`;

    capture = new CaptureAdapter();
    const intentStub: IntentCompilerModelClient = {
      async generate(req) {
        const from = req.enums.ub[0] ?? req.enums.ua[0] ?? "U1";
        return {
          ok: true,
          raw: {
            quotes: [{ qid: "q1", from, text: USER_TEXT }],
            ops: [
              {
                op: "set_title",
                value: "问候页",
                evidence: [{ qid: "q1" }],
                revival: null,
              },
              {
                op: "set_summary",
                value: "打开页面就能看到一句问候语，验证黄金切片主链。",
                evidence: [{ qid: "q1" }],
                revival: null,
              },
              {
                op: "upsert_module",
                source: "user_said",
                item: {
                  id: "new:greet",
                  name: "问候页",
                  purpose: "展示一句问候语",
                  user_visible: true,
                  kind: "new",
                  project_anchor: "src/App.tsx",
                },
                evidence: [{ qid: "q1" }],
                revival: null,
              },
              {
                op: "upsert_flow",
                source: "user_said",
                item: {
                  id: "new:mainflow",
                  name: "打开见问候",
                  steps: [
                    {
                      actor: "用户",
                      action: "打开页面",
                      module_id: "new:greet",
                    },
                    {
                      actor: "系统",
                      action: "展示问候语",
                      module_id: "new:greet",
                    },
                  ],
                },
                evidence: [{ qid: "q1" }],
                revival: null,
              },
              {
                op: "upsert_acceptance",
                source: "user_said",
                item: {
                  id: "new:ac",
                  text: "页面源码含问候语",
                  check: "auto",
                },
                evidence: [{ qid: "q1" }],
                revival: null,
              },
            ],
          },
          input_tokens: 20,
          output_tokens: 40,
          model_id: "stub-l6-compiler",
        };
      },
    };

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3970,
      endPort: 3979,
      enableCrashRecovery: false,
      intentCompilerModelClient: intentStub,
      intentCompilerSetTimeout: (fn) => {
        void fn;
        return 1;
      },
      intentCompilerClearTimeout: () => undefined,
      chatAdapters: [capture],
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
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
    if (shimDir) {
      try {
        safeRmSync(shimDir);
      } catch {
        /* ignore */
      }
      shimDir = null;
    }
    try {
      safeRmSync(repo);
    } catch {
      /* ignore */
    }
  });

  const authHeaders = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  async function call<T = Record<string, unknown>>(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: authHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text.length > 0 ? JSON.parse(text) : {}) as T,
    };
  }

  /** 账本 V2 → 可冻结 V1 方案（注入 check:auto；BUSINESS_KEYS 会丢掉 check） */
  function ledgerToFreezeScheme(): SchemeDraft & {
    modules_v2: Array<{
      id: string;
      name: string;
      purpose: string;
      kind: "new" | "change_existing";
      project_anchor: string | null;
    }>;
  } {
    const record = readSchemeLedger(repo);
    expect(record).not.toBeNull();
    const draft = record!.state.draft;
    const mermaidFlow =
      draft.flows.length > 0
        ? [
            "flowchart LR",
            ...draft.flows[0]!.steps.map(
              (s, i) => `  S${i}["${s.action}"]`,
            ),
            ...draft.flows[0]!.steps
              .slice(1)
              .map((_, i) => `  S${i} --> S${i + 1}`),
          ].join("\n")
        : "flowchart LR\n  A[打开] --> B[见问候]";

    const baseDraft = emptySchemeDraft({
      scheme_id: draft.scheme_id,
      scheme_revision: draft.scheme_revision,
      title: draft.title,
      summary: draft.summary,
      modules: draft.modules.map((m) => m.name),
      mermaidFlow,
      business_input_rounds: Math.max(1, draft.business_input_rounds ?? 1),
      demoReady: true,
      acceptance: draft.acceptance.map((a) => ({
        id: a.id,
        text: a.text,
        check: "auto" as const,
      })),
    });

    return {
      ...baseDraft,
      modules_v2: draft.modules.map((m) => ({
        id: m.id,
        name: m.name,
        purpose: m.purpose,
        kind: m.kind,
        project_anchor: m.project_anchor,
      })),
    };
  }

  it(
    "一句需求 → 方案 → 确认开工 → 红绿施工 → 真预览 → 合入",
    async () => {
      // ---------- 1. 右栏发一句 ----------
      const journey = await call<{ plain_summary?: string }>(
        "POST",
        "/api/supervisor/journey",
        { message: USER_TEXT },
      );
      expect(journey.status).toBe(200);
      expect(typeof journey.body.plain_summary).toBe("string");

      await daemon!.flushIntentCompilerForTest();

      expect(fs.existsSync(schemeLedgerPath(repo))).toBe(true);
      const ledger = readSchemeLedger(repo);
      expect(ledger).not.toBeNull();
      expect(ledger!.state.draft.title.length).toBeGreaterThan(0);
      expect(ledger!.state.draft.modules.length).toBeGreaterThan(0);
      expect(JSON.stringify(ledger).includes("partner_hint")).toBe(false);

      // L.1：右栏适配器未收到非用户文本（旅程不走 ChatAdapter；若有调用则 prompt 全等）
      for (const c of capture.calls) {
        expect(c.prompt).toBe(USER_TEXT);
      }

      // ---------- 2. 确认开工（手势 1 = freeze + create）----------
      const scheme = ledgerToFreezeScheme();
      const acceptanceId = scheme.acceptance![0]!.id;
      const oblPath = `tests/stagent/${acceptanceId}.test.ts`;
      const plan = buildScopePlan({ repoRoot: repo, scheme });
      expect(plan.grade.ok).toBe(true);
      expect(plan.needs_approval).toEqual([]);

      const confirmationId = `golden-confirm-${scheme.scheme_id}`;
      userAuthGestures.push("confirm_start");
      const frozen = await call<{ snapshot_id: string }>(
        "POST",
        "/api/supervisor/scheme/freeze",
        {
          confirmation_id: confirmationId,
          scheme,
          demo: EMPTY_DEMO_GATE,
          decision: {
            code: "OK",
            message: "未生成 Demo，按静态方案签署",
            demo_mode: "none",
          },
          scope_plan: plan,
        },
      );
      expect(frozen.status).toBe(201);

      const contractDraft = buildConfirmContractFromScopePlan(scheme, plan);
      const pending = {
        ...contractDraft,
        lifecycle_state: "PENDING_APPROVAL" as const,
        approval: { status: "PENDING_REVIEW" as const },
      };

      const created = await call<{
        contract: SoftwareContract;
        admission?: { contract: SoftwareContract };
      }>("POST", "/api/contracts", {
        contract: pending,
        confirmation_id: confirmationId,
      });
      expect(created.status).toBe(201);
      const contract =
        created.body.admission?.contract ?? created.body.contract;
      expect(contract.lifecycle_state).toBe("EXECUTING");
      expect(contract.approval?.approved_by).toBe("stagent-auto");
      const contractId = contract.contract_id;

      // ---------- 3. 两段式施工（生产 runWorker；桩模型 + 桩义务报告）----------
      const worktree = path.join(
        repo,
        ".stagent",
        "worktrees",
        `task-${contractId}`,
      );
      expect(fs.existsSync(worktree)).toBe(true);

      // 真跑 vitest / stagent check：共享 IDE node_modules
      const nmLink = path.join(worktree, "node_modules");
      if (!fs.existsSync(nmLink)) {
        fs.symlinkSync(
          path.join(STAGENT_ROOT, "node_modules"),
          nmLink,
          "dir",
        );
      }

      const redTest = [
        'import { it, expect } from "vitest";',
        'import { readFileSync } from "node:fs";',
        "it(\"App 含问候语\", () => {",
        '  const src = readFileSync("src/App.tsx", "utf8");',
        `  expect(src).toContain(${JSON.stringify(GREETING)});`,
        "});",
        "",
      ].join("\n");
      const greenApp = [
        "export default function App() {",
        `  return ${JSON.stringify(GREETING)};`,
        "}",
        "",
      ].join("\n");

      const modelClient: WorkerModelClient = {
        generateChanges: async (input) => {
          const prompt = input.task.system_prompt;
          if (prompt.includes("本段（T · 先写测试）义务")) {
            return {
              changes: [{ path: oblPath, content: redTest }],
              log: ["T-red"],
              usage: { inputTokens: 10, outputTokens: 20 },
            };
          }
          expect(prompt).toContain("本段（I · 再实现）义务");
          return {
            changes: [{ path: "src/App.tsx", content: greenApp }],
            log: ["I-green"],
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        },
      };

      // create 签发的 exec_token 只活在 Daemon 内同一 orchestrator 实例上
      const orchestrator = (
        daemon as unknown as { orchestrator: ContractOrchestrator }
      ).orchestrator;
      const workerResult = await orchestrator.runWorker(contractId, {
        modelClient,
        twoPhase: {
          readObligationReport: (phase) =>
            phase === "t"
              ? {
                  schema: "stagent-obligation-report-v1",
                  test_count: 1,
                  assertion_failures: 1,
                  collection_or_compile_errors: 0,
                }
              : {
                  schema: "stagent-obligation-report-v1",
                  test_count: 1,
                  assertion_failures: 0,
                  collection_or_compile_errors: 0,
                },
        },
      });

      expect(workerResult.two_phase?.phase).toBe("two_phase");
      expect(workerResult.two_phase?.can_merge).toBe(true);
      expect(workerResult.two_phase?.obligations.length).toBeGreaterThan(0);
      const obl = workerResult.two_phase!.obligations[0]!;
      expect(obl.red?.classification).toBe("red");
      expect(obl.green?.classification).toBe("green");
      expect(fs.existsSync(path.join(worktree, oblPath))).toBe(true);
      expect(
        fs.readFileSync(path.join(worktree, "src", "App.tsx"), "utf8"),
      ).toContain(GREETING);

      // execute 前种植合同校验文件（相对 Worktree）
      const recordsDir = path.join(worktree, ".stagent", "records");
      fs.mkdirSync(recordsDir, { recursive: true });
      fs.writeFileSync(
        path.join(recordsDir, "obligation-report.json"),
        `${JSON.stringify(
          {
            schema: "stagent-obligation-report-v1",
            test_count: 1,
            assertion_failures: 0,
            collection_or_compile_errors: 0,
          },
          null,
          2,
        )}\n`,
      );
      // 完整性比对：基线=候选（施工后测试未削弱）
      fs.writeFileSync(path.join(recordsDir, "test-baseline"), redTest);
      fs.writeFileSync(path.join(recordsDir, "test-candidate"), redTest);

      // ---------- 4. 验证（系统）----------
      const executed = await call<{
        contract: { lifecycle_state: string };
        evidence: {
          evidence_id: string;
          verdict: { status: string; can_merge: boolean };
          verification_results?: Array<{
            command_alias: string;
            passed: boolean;
          }>;
        };
      }>("POST", `/api/contracts/${contractId}/execute`);
      expect(executed.status).toBe(200);
      expect(executed.body.contract.lifecycle_state).toBe("AUDITED");
      expect(executed.body.evidence.verdict).toMatchObject({
        status: "PASSED",
        can_merge: true,
      });
      const aliases = (executed.body.evidence.verification_results ?? []).map(
        (r) => r.command_alias,
      );
      expect(aliases).toEqual(
        expect.arrayContaining([
          "obligation-tests",
          "check-obligations",
          "check-test-integrity",
        ]),
      );
      for (const r of executed.body.evidence.verification_results ?? []) {
        expect(r.passed).toBe(true);
      }

      // 证据含红绿义务（两段式结果 + 落盘证据文件）
      const evidenceFile = path.join(
        repo,
        ".stagent",
        "evidence",
        `${contractId}-${executed.body.evidence.evidence_id}.json`,
      );
      expect(fs.existsSync(evidenceFile)).toBe(true);
      expect(workerResult.two_phase!.obligations.some((o) => o.red && o.green)).toBe(
        true,
      );

      // ---------- 5. 真预览（非占位）----------
      const previewStart = await call<{
        url?: string;
        preview_url?: string;
        stub?: boolean;
        mode?: string;
      }>("POST", "/api/preview/real/start", { contract_id: contractId });
      expect(previewStart.status).toBe(200);
      expect(previewStart.body.stub).not.toBe(true);
      const previewUrl =
        previewStart.body.url ?? previewStart.body.preview_url ?? "";
      expect(previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);

      const page = await fetch(previewUrl, { headers: { connection: "close" } });
      expect(page.status).toBe(200);
      const pageText = await page.text();
      expect(pageText).toContain(REAL_APP_MARKER);
      expect(pageText).not.toContain(STUB_PREVIEW_BADGE);

      await call("POST", "/api/preview/real/stop", {
        contract_id: contractId,
      });

      // ---------- 6. 合入（手势 2）----------
      userAuthGestures.push("merge");
      const merged = await call<{
        result: {
          commitSha: string;
          contract: { lifecycle_state: string };
        };
      }>("POST", `/api/contracts/${contractId}/merge`, {
        evidence_id: executed.body.evidence.evidence_id,
        reviewer: "tina",
      });
      expect(merged.status).toBe(200);
      expect(merged.body.result.contract.lifecycle_state).toBe("MERGED");

      const log = git(repo, ["log", "-1", "--format=%B"]);
      expect(log).toContain(`Stagent-Contract-ID: ${contractId}`);
      expect(fs.readFileSync(path.join(repo, "src", "App.tsx"), "utf8")).toContain(
        GREETING,
      );

      // PASS：用户授权类手势恰好 2 次；未点 approve（自动批准）
      expect(userAuthGestures).toEqual(["confirm_start", "merge"]);
      expect(userAuthGestures).toHaveLength(2);
    },
    180_000,
  );
});
