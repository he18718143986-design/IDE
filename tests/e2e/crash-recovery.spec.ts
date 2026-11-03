import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { createTaskWorktree } from "../../daemon/git/worktree-manager";
import { git } from "../helpers/git";

function writeContract(repo: string, id: string, state: string): void {
  const dir = path.join(repo, ".stagent", "contracts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify(
      {
        contract_id: id,
        schema_version: "1.1.3",
        lifecycle_state: state,
        approval: {
          status: "APPROVED",
          approved_by: "e2e",
          approved_at: new Date().toISOString(),
        },
        authorization: {
          git: { base_branch: "main", task_branch: `task/${id}` },
        },
      },
      null,
      2,
    ),
  );
}

describe("E2E / 崩溃恢复：PREPARING 回退与 EXECUTING 恢复", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-e2e-crash-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "e2e@example.com"]);
    git(repo, ["config", "user.name", "E2E"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterAll(() => {
    safeRmSync(repo);
  });

  it("Daemon 启动后自动自愈：PREPARING 回退、EXECUTING 保留 patch 并恢复", async () => {
    // 现场 1：PREPARING 中断，残留半成品 Worktree
    writeContract(repo, "e2e-preparing", "PREPARING");
    const preparingTree = await createTaskWorktree({
      repoRoot: repo,
      contractId: "e2e-preparing",
    });

    // 现场 2：EXECUTING 中断，Worktree 内有未提交改动
    writeContract(repo, "e2e-executing", "EXECUTING");
    const executingTree = await createTaskWorktree({
      repoRoot: repo,
      contractId: "e2e-executing",
    });
    fs.writeFileSync(
      path.join(executingTree.worktreePath, "src", "pending.ts"),
      "export const pending = true;\n",
    );

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4351,
      endPort: 4356,
      enableCrashRecovery: true,
    });
    await daemon.start();

    const report = daemon.getRecoveryReport();
    expect(report).not.toBeNull();
    const preparingRecord = report?.records.find(
      (r) => r.contractId === "e2e-preparing",
    );
    const executingRecord = report?.records.find(
      (r) => r.contractId === "e2e-executing",
    );

    expect(preparingRecord?.outcome).toBe("REVERTED_TO_PENDING_APPROVAL");
    expect(fs.existsSync(preparingTree.worktreePath)).toBe(false);

    expect(executingRecord?.outcome).toBe("RESUMED");
    expect(
      executingRecord?.patchPath && fs.existsSync(executingRecord.patchPath),
    ).toBe(true);
    expect(fs.readFileSync(executingRecord!.patchPath!, "utf8")).toContain(
      "pending",
    );

    const contract = JSON.parse(
      fs.readFileSync(
        path.join(repo, ".stagent", "contracts", "e2e-preparing.json"),
        "utf8",
      ),
    ) as { lifecycle_state: string; approval: { status: string } };
    expect(contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(contract.approval.status).toBe("PENDING_REVIEW");
  });
});
