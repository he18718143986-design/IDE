import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

/**
 * TASK-D.3 / D-4 的 **HTTP 生产接线**验收。
 *
 * 单元测试已证明 `assertTargetBranchNotAdvanced` 会抛门禁错；这里证明的是
 * 「真实的 HTTP 入口真的走到了它、并把决策权交回给用户」：
 * 1. 未决策 → 合并被阻断（409 + 两个可执行选项），主树与合同都不动；
 * 2. ABANDON_CANDIDATE → 合同安全中止；
 * 3. REPLAY_ON_CURRENT_BASELINE → 合入最新基线后重跑验证，产出新证据，
 *    且新证据能真正合并成功（不是空壳分支）。
 */
describe("D-4：目标分支前进的合并门禁与二选一决策（HTTP 接线）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d4-merge-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      // 端口段：与其余套件不重叠（原 3790–3795 与 ws-security 的 3781–3790 重叠），
      // 登记表见 tests/unit/test-port-map.test.ts
      startPort: 4559,
      endPort: 4568,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    try {
      safeRmSync(repo);
    } catch {
      /* 受限环境可能拦截删除 */
    }
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  const postJson = (url: string, body: unknown) =>
    fetch(url, { method: "POST", headers: auth(), body: JSON.stringify(body) });

  /** 创建 → 自动批准 → 执行，返回合同与证据 id（Worker 会真实落一份改动） */
  async function executedContract(
    workerFiles: Array<{ path: string; content: string }> = [
      { path: "src/b.ts", content: "export const b = 2;\n" },
    ],
  ): Promise<{
    contractId: string;
    evidenceId: string;
  }> {
    const draft = createContractDraft({
      title: "D-4 门禁",
      description: "目标分支前进后的合并决策",
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
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });

    const created = await postJson(`${base}/api/contracts`, { contract });
    expect(created.status).toBe(201);

    // Worker 的真实改动：落在任务 Worktree 里，由 execute 提交
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    for (const file of workerFiles) {
      fs.writeFileSync(path.join(worktree, file.path), file.content);
    }

    const executed = await postJson(
      `${base}/api/contracts/${contract.contract_id}/execute`,
      {},
    );
    expect(executed.status).toBe(200);
    const executedBody = (await executed.json()) as {
      contract: { lifecycle_state: string };
      evidence: { evidence_id: string };
    };
    expect(executedBody.contract.lifecycle_state).toBe("AUDITED");
    return {
      contractId: contract.contract_id,
      evidenceId: executedBody.evidence.evidence_id,
    };
  }

  /** 用户在施工期间往主分支推新改动 */
  function advanceMain(marker: number): string {
    fs.writeFileSync(
      path.join(repo, "src", "a.ts"),
      `export const a = ${marker}; // user\n`,
    );
    git(repo, ["commit", "-q", "-am", "user change"]);
    return git(repo, ["rev-parse", "HEAD"]).trim();
  }

  async function stateOf(contractId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}/api/state`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contracts: Record<string, Record<string, unknown>>;
    };
    return body.contracts[contractId] ?? {};
  }

  it("未决策不能合并：409 带二选一选项，主树与合同都不动", async () => {
    const { contractId, evidenceId } = await executedContract();
    const baselineBefore = git(repo, ["rev-parse", "HEAD"]).trim();
    const advancedHead = advanceMain(9);

    const merge = await postJson(`${base}/api/contracts/${contractId}/merge`, {
      evidence_id: evidenceId,
      reviewer: "tina",
    });
    expect(merge.status).toBe(409);
    const body = (await merge.json()) as {
      code: string;
      options: string[];
      target_head: string;
      base_head: string;
      message: string;
    };
    expect(body.code).toBe("E_TARGET_BRANCH_ADVANCED");
    expect(body.options).toEqual([
      "REPLAY_ON_CURRENT_BASELINE",
      "ABANDON_CANDIDATE",
    ]);
    expect(body.base_head).toBe(baselineBefore);
    expect(body.target_head).toBe(advancedHead);
    expect(body.message).toContain("重演");

    // 主树没有被悄悄合并，也没有留下冲突标记
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(advancedHead);
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toBe(
      "export const a = 9; // user\n",
    );
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(false);

    // 展示态切到 CONFLICT：证明 target_branch_ahead 真的喂进了投影层
    expect(await stateOf(contractId)).toMatchObject({
      presentation_state: "CONFLICT",
      lifecycle_state: "AUDITED",
    });

    // 没做决定就再点一次合并：仍然被阻断，不存在「第二次放行」
    const again = await postJson(`${base}/api/contracts/${contractId}/merge`, {
      evidence_id: evidenceId,
      reviewer: "tina",
    });
    expect(again.status).toBe(409);
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(false);
  });

  it("ABANDON_CANDIDATE：合同安全中止，不再以冲突为由挂起", async () => {
    const { contractId, evidenceId } = await executedContract();
    advanceMain(9);

    const blocked = await postJson(
      `${base}/api/contracts/${contractId}/merge`,
      { evidence_id: evidenceId, reviewer: "tina" },
    );
    expect(blocked.status).toBe(409);

    const decided = await postJson(
      `${base}/api/contracts/${contractId}/merge-decision`,
      { decision: "ABANDON_CANDIDATE", reviewer: "tina" },
    );
    expect(decided.status).toBe(200);
    const body = (await decided.json()) as {
      decision: string;
      contract: { lifecycle_state: string };
    };
    expect(body.decision).toBe("ABANDON_CANDIDATE");
    expect(body.contract.lifecycle_state).toBe("ABORTED");

    // 决策已落地：冲突挂起标记被清除，展示态回到 ABORTED
    expect(await stateOf(contractId)).toMatchObject({
      presentation_state: "ABORTED",
      lifecycle_state: "ABORTED",
    });
  });

  it("REPLAY_ON_CURRENT_BASELINE：合入最新基线重跑验证，新证据可正常合并", async () => {
    const { contractId, evidenceId } = await executedContract();
    const advancedHead = advanceMain(9);

    const blocked = await postJson(
      `${base}/api/contracts/${contractId}/merge`,
      { evidence_id: evidenceId, reviewer: "tina" },
    );
    expect(blocked.status).toBe(409);

    const decided = await postJson(
      `${base}/api/contracts/${contractId}/merge-decision`,
      { decision: "REPLAY_ON_CURRENT_BASELINE" },
    );
    expect(decided.status).toBe(200);
    const body = (await decided.json()) as {
      decision: string;
      outcome: {
        contract: { lifecycle_state: string };
        evidence: {
          evidence_id: string;
          git_info: { base_commit_sha: string };
        };
      };
    };
    expect(body.decision).toBe("REPLAY_ON_CURRENT_BASELINE");
    expect(body.outcome.contract.lifecycle_state).toBe("AUDITED");
    // 新证据描述的是**新基线**，而不是拿旧证据蒙混过关
    expect(body.outcome.evidence.git_info.base_commit_sha).toBe(advancedHead);
    expect(body.outcome.evidence.evidence_id).not.toBe(evidenceId);

    // 重演后合并：新基线上真的合进去了
    const merged = await postJson(`${base}/api/contracts/${contractId}/merge`, {
      evidence_id: body.outcome.evidence.evidence_id,
      reviewer: "tina",
    });
    expect(merged.status).toBe(200);
    const mergedBody = (await merged.json()) as {
      result: { commitSha: string; nothingToMerge: boolean };
    };
    expect(mergedBody.result.nothingToMerge).toBe(false);
    expect(mergedBody.result.commitSha).toMatch(/^[a-f0-9]{40}$/);

    // 用户的最新代码与 Worker 的改动都在
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toContain(
      "// user",
    );
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(true);
  });

  it("REPLAY 撞上真实冲突：返回 E_REPLAY_CONFLICT，把决策权还给用户", async () => {
    // Worker 与用户改同一行：重演无法自动完成
    const { contractId, evidenceId } = await executedContract([
      { path: "src/a.ts", content: "export const a = 2; // worker\n" },
    ]);
    advanceMain(9);

    const blocked = await postJson(
      `${base}/api/contracts/${contractId}/merge`,
      { evidence_id: evidenceId, reviewer: "tina" },
    );
    expect(blocked.status).toBe(409);

    const replayed = await postJson(
      `${base}/api/contracts/${contractId}/merge-decision`,
      { decision: "REPLAY_ON_CURRENT_BASELINE" },
    );
    expect(replayed.status).toBe(409);
    const body = (await replayed.json()) as { code?: string; error: string };
    expect(body.code).toBe("E_REPLAY_CONFLICT");

    // 不自动取舍：合同留在 AUDITED，Worktree 里没有冲突标记（merge 已 abort）
    expect(await stateOf(contractId)).toMatchObject({
      lifecycle_state: "AUDITED",
    });
    const worktreeFile = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contractId}`,
      "src",
      "a.ts",
    );
    const content = fs.readFileSync(worktreeFile, "utf8");
    expect(content).not.toContain("<<<<<<<");
    expect(content).toContain("// worker");

    // 用户此时仍可走放弃路径收尾
    const abandoned = await postJson(
      `${base}/api/contracts/${contractId}/merge-decision`,
      { decision: "ABANDON_CANDIDATE" },
    );
    expect(abandoned.status).toBe(200);
  });

  it("非法 decision 返回 400，且不给任何默认决策", async () => {
    const { contractId } = await executedContract();

    const bad = await postJson(
      `${base}/api/contracts/${contractId}/merge-decision`,
      { decision: "JUST_MERGE_IT" },
    );
    expect(bad.status).toBe(400);

    const missing = await postJson(
      `${base}/api/contracts/${contractId}/merge-decision`,
      {},
    );
    expect(missing.status).toBe(400);

    // 没有默认决策兜底：合同仍在 AUDITED
    expect(await stateOf(contractId)).toMatchObject({
      lifecycle_state: "AUDITED",
    });
  });

  it("merge-decision 与 merge 一样受 Bearer 保护", async () => {
    const { contractId } = await executedContract();
    const unauth = await fetch(
      `${base}/api/contracts/${contractId}/merge-decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        body: JSON.stringify({ decision: "ABANDON_CANDIDATE" }),
      },
    );
    expect(unauth.status).toBe(401);
  });
});
