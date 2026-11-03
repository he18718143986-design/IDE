import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import { recoverDaemonState } from "../../daemon/recovery/crash-recovery";
import { createDaemon } from "../../daemon/server";
import {
  createTaskWorktree,
  listWorktrees,
} from "../../daemon/git/worktree-manager";
import { git } from "../helpers/git";

describe("M3 / TASK-A.6 Daemon 崩溃恢复与工作区自愈", () => {
  let repo: string;
  let stagentDir: string;

  const writeContract = (id: string, state: string) => {
    const dir = path.join(stagentDir, "contracts");
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
            approved_by: "tester",
            approved_at: new Date().toISOString(),
          },
          authorization: {
            git: {
              base_branch: "main",
              task_branch: `task/${id}`,
            },
          },
        },
        null,
        2,
      ),
    );
  };

  const readContract = (id: string) =>
    JSON.parse(
      fs.readFileSync(path.join(stagentDir, "contracts", `${id}.json`), "utf8"),
    ) as { lifecycle_state: string; approval: { status: string } };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m3-"));
    stagentDir = path.join(repo, ".stagent");
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  it("扫描 contracts 与 evidence 目录并统计", async () => {
    writeContract("c-scan", "PENDING_APPROVAL");
    const evidenceDir = path.join(stagentDir, "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, "old.json"), "{}");

    const report = await recoverDaemonState({ repoRoot: repo });
    expect(report.scannedContracts).toBe(1);
    expect(report.scannedEvidence).toBe(1);
    expect(report.records).toHaveLength(0);
  });

  it("PREPARING 中断：清理半成品 Worktree 并回退 PENDING_APPROVAL/PENDING_REVIEW", async () => {
    const id = "c-preparing";
    writeContract(id, "PREPARING");
    const info = await createTaskWorktree({ repoRoot: repo, contractId: id });
    expect(fs.existsSync(info.worktreePath)).toBe(true);

    const report = await recoverDaemonState({ repoRoot: repo });
    const record = report.records.find((r) => r.contractId === id);

    expect(record?.outcome).toBe("REVERTED_TO_PENDING_APPROVAL");
    expect(record?.reasonCode).toBe("PREPARATION_INTERRUPTED");
    expect(record?.worktreeExisted).toBe(true);

    const contract = readContract(id);
    expect(contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(contract.approval.status).toBe("PENDING_REVIEW");
    expect(fs.existsSync(info.worktreePath)).toBe(false);
  });

  it("EXECUTING：Worktree 存在 → PENDING_RESUME 并留存 patch/快照", async () => {
    const id = "c-executing";
    writeContract(id, "EXECUTING");
    const info = await createTaskWorktree({ repoRoot: repo, contractId: id });
    fs.writeFileSync(
      path.join(info.worktreePath, "a.txt"),
      "changed-content",
      "utf8",
    );

    const report = await recoverDaemonState({ repoRoot: repo });
    const record = report.records.find((r) => r.contractId === id);

    expect(record?.outcome).toBe("RESUMED");
    expect(readContract(id).lifecycle_state).toBe("PENDING_RESUME");
    expect(record?.patchPath && fs.existsSync(record.patchPath)).toBe(true);
    expect(fs.readFileSync(record!.patchPath!, "utf8")).toContain(
      "changed-content",
    );
    expect(record?.evidencePath && fs.existsSync(record.evidencePath)).toBe(
      true,
    );
  });

  it("VERIFYING 且 Worktree 丢失 → ABORTED + WORKTREE_LOST 证据", async () => {
    const id = "c-lost";
    writeContract(id, "VERIFYING");

    const report = await recoverDaemonState({ repoRoot: repo });
    const record = report.records.find((r) => r.contractId === id);

    expect(record?.outcome).toBe("ABORTED");
    expect(record?.reasonCode).toBe("WORKTREE_LOST");
    expect(readContract(id).lifecycle_state).toBe("ABORTED");

    const evidence = JSON.parse(
      fs.readFileSync(record!.evidencePath!, "utf8"),
    ) as {
      verdict: { status: string; can_merge: boolean; reason_code: string };
    };
    expect(evidence.verdict).toMatchObject({
      status: "BLOCKED",
      can_merge: false,
      reason_code: "WORKTREE_LOST",
    });
  });

  it("孤儿 Worktree：无对应合同 → 清理并 prune", async () => {
    const id = "c-orphan";
    const info = await createTaskWorktree({ repoRoot: repo, contractId: id });
    expect(fs.existsSync(info.worktreePath)).toBe(true);

    const report = await recoverDaemonState({ repoRoot: repo });

    expect(report.orphanWorktrees.length).toBe(1);
    expect(fs.existsSync(info.worktreePath)).toBe(false);
    const remaining = await listWorktrees(repo);
    expect(remaining.some((w) => w.worktree.includes(`task-${id}`))).toBe(
      false,
    );
    expect(report.pruned).toBe(true);
  });

  it("幂等：已恢复的合同再次扫描不产生新记录", async () => {
    const id = "c-idempotent";
    writeContract(id, "PREPARING");
    await createTaskWorktree({ repoRoot: repo, contractId: id });

    await recoverDaemonState({ repoRoot: repo });
    const second = await recoverDaemonState({ repoRoot: repo });
    expect(second.records).toHaveLength(0);
  });

  it("Daemon 取得 PID 锁后自动执行自愈扫描（TASK-A.6 PASS-1）", async () => {
    const id = "c-autostart";
    writeContract(id, "PREPARING");
    const info = await createTaskWorktree({ repoRoot: repo, contractId: id });

    // 端口段：与其余套件不重叠，登记表见 tests/unit/test-port-map.test.ts
    const daemon = createDaemon({
      repoRoot: repo,
      startPort: 4769,
      endPort: 4778,
    });
    try {
      await daemon.start();
      const report = daemon.getRecoveryReport();
      expect(report).not.toBeNull();
      expect(report?.scannedContracts).toBe(1);
      expect(
        report?.records.some(
          (r) =>
            r.contractId === id && r.outcome === "REVERTED_TO_PENDING_APPROVAL",
        ),
      ).toBe(true);
      expect(fs.existsSync(info.worktreePath)).toBe(false);
    } finally {
      await daemon.stop();
    }
  });
});
