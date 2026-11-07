import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { InvalidStateTransitionError } from "../../daemon/core/contract-mutex";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

function pendingContract(options: {
  title: string;
  command: { executable: string; args: string[] };
  maxRetries?: number;
  writablePaths?: string[];
}): SoftwareContract {
  const draft = createContractDraft({
    title: options.title,
    description: "M5 orchestrator test",
    acceptanceCriteria: ["command passes"],
    writablePaths: options.writablePaths ?? ["src/**"],
    commands: [
      {
        alias: "verify",
        executable: options.command.executable,
        args: options.command.args,
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ],
    ...(options.maxRetries === undefined
      ? {}
      : { maxVerificationRetries: options.maxRetries }),
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}

describe("M5 / Daemon 权威合同管线", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m5-"));
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

  it("合同持久化到 .stagent/contracts 并可查询/列表", () => {
    const contract = pendingContract({
      title: "persist",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);

    expect(
      fs.existsSync(
        path.join(
          repo,
          ".stagent",
          "contracts",
          `${contract.contract_id}.json`,
        ),
      ),
    ).toBe(true);
    expect(store.get(contract.contract_id)?.intent.title).toBe("persist");
    expect(store.list()).toHaveLength(1);
  });

  it("审批：PENDING_APPROVAL → PREPARING → EXECUTING 并创建 Worktree", async () => {
    const contract = pendingContract({
      title: "approve",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);

    const approved = await orchestrator.approve(contract.contract_id, "tina");
    expect(approved.lifecycle_state).toBe("EXECUTING");
    expect(approved.approval.status).toBe("APPROVED");
    expect(approved.approval.approved_by).toBe("tina");
    expect(
      fs.existsSync(
        path.join(
          repo,
          ".stagent",
          "worktrees",
          `task-${contract.contract_id}`,
        ),
      ),
    ).toBe(true);
  });

  it("验证通过：生成 PASSED Evidence 并进入 AUDITED", async () => {
    const contract = pendingContract({
      title: "happy",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.verdict.status).toBe("PASSED");
    expect(outcome.evidence.verdict.can_merge).toBe(true);
    expect(outcome.evidence.verification_results).toHaveLength(1);
    expect(outcome.evidence.git_info.task_commit_sha).not.toBe("unknown");
    expect(
      fs.existsSync(
        path.join(
          repo,
          ".stagent",
          "evidence",
          `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
        ),
      ),
    ).toBe(true);
  });

  it("验证失败且达到重试上限：PENDING_RESUME + BLOCKED + VERIFICATION_RETRY_LIMIT", async () => {
    const contract = pendingContract({
      title: "fail",
      command: { executable: "node", args: ["-e", "process.exit(1)"] },
      maxRetries: 1,
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("PENDING_RESUME");
    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.evidence.verdict.reason_code).toBe(
      "VERIFICATION_RETRY_LIMIT",
    );
  });

  it("未审批合同不可执行", async () => {
    const contract = pendingContract({
      title: "guard",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    // 并发/排他改造后，状态前置条件失败统一以结构化错误码表达（HTTP 层映射 409）
    await expect(orchestrator.execute(contract.contract_id)).rejects.toThrow(
      /E_INVALID_STATE_TRANSITION.*expected EXECUTING/,
    );
  });
});

describe("M5 / Test Integrity：Evidence tests_modified 留痕", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m5-integrity-"));
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

  it("验证流程中改动测试文件时，Evidence 记录 tests_modified=true", async () => {
    const contract = pendingContract({
      title: "tamper tests",
      writablePaths: ["src/**", "tests/**"],
      command: {
        executable: "node",
        args: [
          "-e",
          "const fs=require('fs');fs.mkdirSync('tests',{recursive:true});fs.writeFileSync('tests/x.test.ts','// tampered');process.exit(0)",
        ],
      },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.evidence.tests_modified).toBe(true);

    // 磁盘快照同样带留痕（核销与合并以磁盘为准）
    const snapshotPath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    );
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
      tests_modified?: boolean;
    };
    expect(snapshot.tests_modified).toBe(true);
  });

  it("仅改动业务源码时，tests_modified=false", async () => {
    const contract = pendingContract({
      title: "src only",
      command: {
        executable: "node",
        args: [
          "-e",
          "require('fs').writeFileSync('src/new.ts','export const n = 1;');process.exit(0)",
        ],
      },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.evidence.tests_modified).toBe(false);
  });

  it("G1 守卫条款：零命令合同执行不判 PASSED、不进 AUDITED（置为 PENDING_RESUME/BLOCKED 兜底），且不计返工", async () => {
    const draft = createContractDraft({
      title: "零命令人工确认合同",
      description: "无自动化命令",
      acceptanceCriteria: ["人工核对"],
      writablePaths: ["src/**"],
      commands: [],
      manualConfirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at", "reason"],
      },
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.contract.lifecycle_state).toBe("PENDING_RESUME");
    expect(outcome.contract.lifecycle_state).not.toBe("AUDITED");
  });
});

describe("TASK-AUDITED.2 / returnToPending", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-audited2-"));
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

  it("正例：AUDITED+APPROVED → PENDING_APPROVAL+PENDING_REVIEW（USER_RETURN_TO_PENDING）", async () => {
    const contract = pendingContract({
      title: "audited2-happy",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.contract.approval.status).toBe("APPROVED");

    const returned = await orchestrator.returnToPending(
      contract.contract_id,
      "tina",
    );
    expect(returned.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(returned.approval.status).toBe("PENDING_REVIEW");
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe(
      "PENDING_APPROVAL",
    );
    expect(store.get(contract.contract_id)?.approval.status).toBe(
      "PENDING_REVIEW",
    );
  });

  it("负例：PENDING_APPROVAL 拒绝 returnToPending", async () => {
    const contract = pendingContract({
      title: "audited2-pending",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    await expect(
      orchestrator.returnToPending(contract.contract_id),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("负例：MERGED 拒绝 returnToPending", async () => {
    const draft = createContractDraft({
      title: "audited2-merged",
      description: "merged guard",
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
      lifecycle_state: "MERGED",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
      },
    });
    store.save(contract);
    await expect(
      orchestrator.returnToPending(contract.contract_id),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("负例：EXECUTING+APPROVED（非 AUDITED）拒绝 returnToPending", async () => {
    const contract = pendingContract({
      title: "audited2-executing",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const current = store.get(contract.contract_id);
    expect(current?.lifecycle_state).toBe("EXECUTING");
    expect(current?.approval.status).toBe("APPROVED");
    await expect(
      orchestrator.returnToPending(contract.contract_id),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});
