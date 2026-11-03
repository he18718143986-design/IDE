import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { squashMerge } from "../../daemon/pipeline/merger";
import { listWorktrees } from "../../daemon/git/worktree-manager";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

/**
 * Chaos 场景 3：双开并发抢占党（Concurrent Mutation Race）
 * 同一合同的两次「执行」/「核销」在同一毫秒并发发起。
 */

function makeContract(title: string): SoftwareContract {
  const draft = createContractDraft({
    title,
    description: "chaos concurrency",
    acceptanceCriteria: ["verify passes"],
    writablePaths: ["src/**"],
    commands: [
      {
        alias: "verify",
        executable: "node",
        args: ["-e", "process.exit(0)"],
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}

/** 并发发起同一批调用，返回 settled 结果 */
async function raceAll<T>(tasks: Array<() => Promise<T>>) {
  return Promise.allSettled(tasks.map((t) => t()));
}

function errorsOf(results: Array<PromiseSettledResult<unknown>>): string[] {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String((r.reason as Error | undefined)?.message ?? ""));
}

describe("Chaos 3 / 双开并发抢占：状态转移排他性", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chaos3-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  const worktreeFor = (contractId: string) =>
    path.join(repo, ".stagent", "worktrees", `task-${contractId}`);

  const evidenceFiles = (contractId: string) => {
    const dir = path.join(repo, ".stagent", "evidence");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${contractId}-`) && f.endsWith(".json"));
  };

  it("并发两次 approve：只建一个 Worktree / 一条任务分支，第二次 E_INVALID_STATE_TRANSITION", async () => {
    const contract = makeContract("concurrent approve");
    store.save(contract);

    const results = await raceAll([
      () => orchestrator.approve(contract.contract_id, "user-a"),
      () => orchestrator.approve(contract.contract_id, "user-b"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const rejected = errorsOf(results);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("E_INVALID_STATE_TRANSITION");

    // 没有重复创建：目录唯一，任务分支唯一
    const listed = await listWorktrees(repo);
    expect(
      listed.filter(
        (w) => w.branch === `refs/heads/task/${contract.contract_id}`,
      ),
    ).toHaveLength(1);
    expect(fs.existsSync(worktreeFor(contract.contract_id))).toBe(true);
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("EXECUTING");
  });

  it("并发两次 execute：只生成一份 Evidence，第二次 E_INVALID_STATE_TRANSITION", async () => {
    const contract = makeContract("concurrent execute");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    const results = await raceAll([
      () => orchestrator.execute(contract.contract_id),
      () => orchestrator.execute(contract.contract_id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = errorsOf(results);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("E_INVALID_STATE_TRANSITION");

    // 只落盘一份证据（不会因并发产生双份互相矛盾的存证）
    expect(evidenceFiles(contract.contract_id)).toHaveLength(1);
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("AUDITED");
  });

  it("并发两次核销合并：主干只前进一个审计提交，第二次 E_INVALID_STATE_TRANSITION", async () => {
    const contract = makeContract("concurrent merge");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    // 任务分支必须领先 base：否则 squash 无内容可提交
    fs.writeFileSync(
      path.join(worktreeFor(contract.contract_id), "src", "feature.ts"),
      "export const feature = 1;\n",
    );
    const outcome = await orchestrator.execute(contract.contract_id);

    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();
    const commitCountBefore = Number(
      git(repo, ["rev-list", "--count", "HEAD"]).trim(),
    );

    const results = await raceAll([
      () =>
        squashMerge({
          repoRoot: repo,
          contractId: contract.contract_id,
          evidence: outcome.evidence,
          reviewer: "user-a",
        }),
      () =>
        squashMerge({
          repoRoot: repo,
          contractId: contract.contract_id,
          evidence: outcome.evidence,
          reviewer: "user-b",
        }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = errorsOf(results);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("E_INVALID_STATE_TRANSITION");

    // 主干只前进一个提交，且只带一份审计 Trailer
    const headAfter = git(repo, ["rev-parse", "HEAD"]).trim();
    expect(headAfter).not.toBe(headBefore);
    expect(Number(git(repo, ["rev-list", "--count", "HEAD"]).trim())).toBe(
      commitCountBefore + 1,
    );
    const log = git(repo, ["log", "-1", "--format=%B"]);
    expect(log).toContain(`Stagent-Contract-ID: ${contract.contract_id}`);
    expect(log).toContain(
      `Stagent-Evidence-ID: ${outcome.evidence.evidence_id}`,
    );
    expect(log.match(/Stagent-Evidence-ID/g)).toHaveLength(1);
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("MERGED");
  });

  it("并发失败后锁被释放：后续合法操作不被死锁挡住", async () => {
    const contract = makeContract("concurrent lock release");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    // 故意并发触发一次失败
    await raceAll([
      () => orchestrator.execute(contract.contract_id),
      () => orchestrator.execute(contract.contract_id),
    ]);

    // 锁必须已释放：再开一个合同仍能正常走完
    const next = makeContract("after lock release");
    store.save(next);
    await orchestrator.approve(next.contract_id, "tina");
    const outcome = await orchestrator.execute(next.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");

    // 磁盘锁目录不应残留幽灵锁
    const lockDir = path.join(repo, ".stagent", "locks");
    if (fs.existsSync(lockDir)) {
      expect(fs.readdirSync(lockDir)).toHaveLength(0);
    }
  });
});

describe("Chaos 3 / HTTP 层并发语义：409 Conflict", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chaos3-api-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      // 端口段：与其余套件不重叠（原 3770–3775 与 ws-auth-handshake、ws-security 重叠），
      // 登记表见 tests/unit/test-port-map.test.ts
      startPort: 4509,
      endPort: 4518,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  it("同时发起两个 execute 请求：一个 200，一个 409 + E_INVALID_STATE_TRANSITION", async () => {
    const draft = createContractDraft({
      title: "http concurrency",
      description: "chaos3",
      acceptanceCriteria: ["ok"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
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

    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    expect(created.status).toBe(201);
    // TASK-D.2（v1.3.3 §0.2）：无保护清单交集 → 创建即自动批准（零点击），合同已在执行态
    const createdBody = (await created.json()) as {
      contract: { lifecycle_state: string };
    };
    expect(createdBody.contract.lifecycle_state).toBe("EXECUTING");

    const [a, b] = await Promise.all([
      fetch(`${base}/api/contracts/${contract.contract_id}/execute`, {
        method: "POST",
        headers: auth(),
      }),
      fetch(`${base}/api/contracts/${contract.contract_id}/execute`, {
        method: "POST",
        headers: auth(),
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflict = a.status === 409 ? a : b;
    const body = (await conflict.json()) as { code?: string; error?: string };
    expect(body.code).toBe("E_INVALID_STATE_TRANSITION");
  });
});
