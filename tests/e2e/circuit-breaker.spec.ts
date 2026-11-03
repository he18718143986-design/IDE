import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { AiWorker, WorkerScopeError } from "../../daemon/worker/ai-worker";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

describe("E2E / 差异化拦截：可恢复熔断 vs 安全中止", () => {
  let repo: string;
  let daemon: StagentDaemon;
  let base: string;
  let token: string;

  beforeAll(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-e2e-breaker-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "e2e@example.com"]);
    git(repo, ["config", "user.name", "E2E"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      // 端口段：与其余套件不重叠（原 3720–3725 与 repo-delete-api 的 3720–3729 重叠），
      // 登记表见 tests/unit/test-port-map.test.ts
      startPort: 4649,
      endPort: 4658,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterAll(async () => {
    await daemon?.stop();
    safeRmSync(repo);
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  it("连续验证失败达上限：PENDING_RESUME + BLOCKED + VERIFICATION_RETRY_LIMIT", async () => {
    const draft = createContractDraft({
      title: "retry breaker",
      description: "fails",
      acceptanceCriteria: ["never"],
      writablePaths: ["src/**"],
      maxVerificationRetries: 1,
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(1)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    new ContractStore(repo).save(contract);
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    await orchestrator.approve(contract.contract_id, "e2e");

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("PENDING_RESUME");
    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    expect(outcome.evidence.verdict.reason_code).toBe(
      "VERIFICATION_RETRY_LIMIT",
    );
    expect(outcome.evidence.verdict.can_merge).toBe(false);

    // 熔断后不可合并
    const merged = await fetch(
      `${base}/api/contracts/${contract.contract_id}/merge`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          evidence_id: outcome.evidence.evidence_id,
          reviewer: "e2e",
        }),
      },
    );
    expect(merged.status).toBe(400);
  });

  it("Worker 越权改动：整批拒绝，不产生任何文件（安全中止语义）", async () => {
    const contract = createContractDraft({
      title: "scope violation",
      description: "out of scope",
      acceptanceCriteria: ["x"],
      writablePaths: ["src/**"],
    });
    const executing = softwareContractSchema.parse({
      ...contract,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "e2e",
        approved_at: new Date().toISOString(),
      },
    });
    const worktree = path.join(os.tmpdir(), `stagent-scope-${Date.now()}`);
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );

    try {
      const costMonitor = new CostMonitor();
      const gateway = new ScopedWorktreeGateway(worktree, executing, {
        costMonitor,
      });
      const worker = new AiWorker({
        gateway,
        costMonitor,
        modelClient: {
          generateChanges: async () => ({
            changes: [
              { path: "src/ok.ts", content: "ok" },
              { path: "../../etc/passwd", content: "pwn" },
            ],
            log: ["试图越权"],
            usage: { inputTokens: 10, outputTokens: 10 },
          }),
        },
      });

      await expect(worker.run()).rejects.toBeInstanceOf(WorkerScopeError);
      expect(fs.existsSync(path.join(worktree, "src", "ok.ts"))).toBe(false);
    } finally {
      safeRmSync(worktree);
    }
  });
});
