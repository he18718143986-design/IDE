import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

describe("E2E / happy path：创建 → 审批 → 执行 → 验证 → 人工核销 → Squash-Merge", () => {
  let repo: string;
  let daemon: StagentDaemon;
  let base: string;
  let token: string;

  beforeAll(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-e2e-happy-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "e2e@example.com"]);
    git(repo, ["config", "user.name", "E2E"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      // 端口段：与其余套件不重叠（原 3710–3715 与 repo-tree-api 的 3710–3719 重叠），
      // 登记表见 tests/unit/test-port-map.test.ts
      startPort: 4629,
      endPort: 4638,
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

  it("完整闭环并生成合规 Git Trailer", async () => {
    const draft = createContractDraft({
      title: "e2e happy",
      description: "add b",
      acceptanceCriteria: ["pass"],
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

    // 1. 创建
    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract }),
    });
    expect(created.status).toBe(201);
    // 2. 审批（v1.3.3 §0.2 减负）：合同与保护清单无交集 → 创建即自动批准，
    //    不再需要人工点击；这里只校验自动批准结果，重复审批必须被状态机拒绝。
    const createdBody = (await created.json()) as {
      contract: { lifecycle_state: string; approval: { approved_by?: string } };
    };
    expect(createdBody.contract.lifecycle_state).toBe("EXECUTING");
    expect(createdBody.contract.approval.approved_by).toBe("stagent-auto");

    const reApproved = await fetch(
      `${base}/api/contracts/${contract.contract_id}/approve`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ reviewer: "e2e" }),
      },
    );
    expect(reApproved.status).toBe(409);

    // 3. Worktree 内产生真实改动
    const worktree = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    fs.writeFileSync(
      path.join(worktree, "src", "b.ts"),
      "export const b = 2;\n",
    );

    // 4. 执行验证 → Evidence
    const executed = await fetch(
      `${base}/api/contracts/${contract.contract_id}/execute`,
      {
        method: "POST",
        headers: auth(),
      },
    );
    expect(executed.status).toBe(200);
    const executedBody = (await executed.json()) as {
      contract: { lifecycle_state: string };
      evidence: {
        evidence_id: string;
        verdict: { status: string; can_merge: boolean };
      };
    };
    expect(executedBody.contract.lifecycle_state).toBe("AUDITED");
    expect(executedBody.evidence.verdict).toMatchObject({
      status: "PASSED",
      can_merge: true,
    });

    // 5. 人工核销合并
    const merged = await fetch(
      `${base}/api/contracts/${contract.contract_id}/merge`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          evidence_id: executedBody.evidence.evidence_id,
          reviewer: "e2e",
        }),
      },
    );
    expect(merged.status).toBe(200);
    const mergedBody = (await merged.json()) as {
      result: { commitSha: string; contract: { lifecycle_state: string } };
    };
    expect(mergedBody.result.contract.lifecycle_state).toBe("MERGED");

    // 6. 主分支内容与 Trailer
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(true);
    const log = git(repo, ["log", "-1", "--format=%B"]);
    expect(log).toContain(`Stagent-Contract-ID: ${contract.contract_id}`);
    expect(log).toContain(
      `Stagent-Evidence-ID: ${executedBody.evidence.evidence_id}`,
    );
    expect(log).toContain("Stagent-Verdict: PASSED");
    expect(log).toContain("Reviewed-By: e2e");

    // 7. 现场清理与存证留存
    expect(
      fs.existsSync(
        path.join(
          repo,
          ".stagent",
          "worktrees",
          `task-${contract.contract_id}`,
        ),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          repo,
          ".stagent",
          "evidence",
          `${contract.contract_id}-${executedBody.evidence.evidence_id}.json`,
        ),
      ),
    ).toBe(true);
  });
});
