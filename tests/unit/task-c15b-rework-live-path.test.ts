/**
 * TASK-C.15b / EO-08：ReworkCounter 接入 Daemon 活路径
 * - approve 签署时 seed
 * - execute 断言失败计返工；超限 → escalated + PENDING_RESUME
 * - HTTP GET/POST /rework*
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { assertionIdFromText } from "../../daemon/guard/assertion-identity";
import {
  loadReworkCounter,
  reworkCounterPath,
} from "../../daemon/guard/rework-store";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { git } from "../helpers/git";

function pendingContract(options: {
  title: string;
  acceptance?: string[];
  command: { executable: string; args: string[] };
  maxRetries?: number;
}): SoftwareContract {
  const draft = createContractDraft({
    title: options.title,
    description: "C.15b live path",
    acceptanceCriteria: options.acceptance ?? ["按钮可点"],
    writablePaths: ["src/**"],
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

describe("TASK-C.15b live path / orchestrator", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c15b-orch-"));
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

  it("approve 签署后落盘 rework-counter 并冻结 assertion_id", async () => {
    const contract = pendingContract({
      title: "seed",
      acceptance: ["用户能登录", "报表可导出"],
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    expect(fs.existsSync(reworkCounterPath(repo, contract.contract_id))).toBe(
      true,
    );
    const snap = orchestrator.getReworkSnapshot(contract.contract_id);
    expect(snap?.phase).toBe("normal");
    const id1 = assertionIdFromText("用户能登录");
    const id2 = assertionIdFromText("报表可导出");
    expect(snap?.counts[id1]).toBe(0);
    expect(snap?.counts[id2]).toBe(0);
  });

  it("断言失败 3 轮 → escalated + PENDING_RESUME + delivery ESCALATED_HUMAN", async () => {
    const contract = pendingContract({
      title: "escalate",
      acceptance: ["按钮可点"],
      // 默认 3；第 3 次会同时触达 LoopGuard，仍须计返工并升格
      maxRetries: 3,
      command: { executable: "node", args: ["-e", "process.exit(1)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const id = assertionIdFromText("按钮可点");

    const r1 = await orchestrator.execute(contract.contract_id);
    expect(r1.rework?.counts[id]).toBe(1);
    expect(r1.rework?.phase).toBe("rework");
    expect(r1.delivery_state).toBe("REWORK_REQUIRED");
    expect(r1.contract.lifecycle_state).toBe("EXECUTING");

    const r2 = await orchestrator.execute(contract.contract_id);
    expect(r2.rework?.counts[id]).toBe(2);
    expect(r2.rework?.phase).toBe("rework");
    expect(r2.delivery_state).toBe("REWORK_REQUIRED");
    expect(r2.contract.lifecycle_state).toBe("EXECUTING");

    const r3 = await orchestrator.execute(contract.contract_id);
    expect(r3.rework?.counts[id]).toBe(3);
    expect(r3.rework?.phase).toBe("escalated");
    expect(r3.delivery_state).toBe("ESCALATED_HUMAN");
    expect(r3.contract.lifecycle_state).toBe("PENDING_RESUME");

    const disk = loadReworkCounter(repo, contract.contract_id)?.snapshot();
    expect(disk?.phase).toBe("escalated");
    expect(disk?.counts[id]).toBe(3);
  });

  it("返工期 tryAddAssertion 拒绝；split 新文本 Out-of-Scope", async () => {
    const contract = pendingContract({
      title: "forbid-add",
      acceptance: ["旧断言"],
      maxRetries: 5,
      command: { executable: "node", args: ["-e", "process.exit(1)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    await orchestrator.execute(contract.contract_id); // → rework

    expect(() =>
      orchestrator.tryAddAssertion(contract.contract_id, "新需求断言"),
    ).toThrow(/返工期严禁追加/);

    const split = orchestrator.splitAssertion(
      contract.contract_id,
      "全新验收诉求",
    );
    expect(split.kind).toBe("out_of_scope");
  });
});

describe("TASK-C.15b live path / HTTP API", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-c15b-api-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      // 端口段：与其余套件不重叠（原 3690–3695 与 resume-abort 完全相同），
      // 登记表见 tests/unit/test-port-map.test.ts
      startPort: 4579,
      endPort: 4588,
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

  it("GET rework + POST failure 超限升格；返工期 POST assertions 409", async () => {
    const draft = createContractDraft({
      title: "api rework",
      description: "C.15b http",
      acceptanceCriteria: ["按钮可点"],
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
      maxVerificationRetries: 5,
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
    const createdBody = (await created.json()) as {
      contract: { contract_id: string; lifecycle_state: string };
    };
    // 无保护清单 → 自动批准，应已 seed
    expect(createdBody.contract.lifecycle_state).toBe("EXECUTING");
    const cid = createdBody.contract.contract_id;
    const id = assertionIdFromText("按钮可点");

    const get1 = await fetch(`${base}/api/contracts/${cid}/rework`, {
      headers: auth(),
    });
    expect(get1.status).toBe(200);
    const body1 = (await get1.json()) as {
      rework: { phase: string; counts: Record<string, number> };
      delivery_state: string;
    };
    expect(body1.rework.phase).toBe("normal");
    expect(body1.rework.counts[id]).toBe(0);

    // 两次失败 → rework；第三次 → escalated
    for (let i = 1; i <= 2; i++) {
      const fail = await fetch(`${base}/api/contracts/${cid}/rework/failure`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ assertion_id: id }),
      });
      expect(fail.status).toBe(200);
      const fb = (await fail.json()) as {
        rework: { phase: string; counts: Record<string, number> };
        delivery_state: string;
      };
      expect(fb.rework.counts[id]).toBe(i);
      expect(fb.rework.phase).toBe("rework");
      expect(fb.delivery_state).toBe("REWORK_REQUIRED");
    }

    const forbid = await fetch(
      `${base}/api/contracts/${cid}/rework/assertions`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ text: "新需求" }),
      },
    );
    expect(forbid.status).toBe(409);
    const forbidBody = (await forbid.json()) as { code?: string };
    expect(forbidBody.code).toBe("E_ASSERTION_ADD_FORBIDDEN");

    const fail3 = await fetch(`${base}/api/contracts/${cid}/rework/failure`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ assertion_id: id }),
    });
    expect(fail3.status).toBe(200);
    const fb3 = (await fail3.json()) as {
      rework: { phase: string };
      delivery_state: string;
      contract: { lifecycle_state: string };
    };
    expect(fb3.rework.phase).toBe("escalated");
    expect(fb3.delivery_state).toBe("ESCALATED_HUMAN");
    expect(fb3.contract.lifecycle_state).toBe("PENDING_RESUME");

    const split = await fetch(`${base}/api/contracts/${cid}/rework/split`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ text: "全新验收诉求" }),
    });
    expect(split.status).toBe(409);
    const splitBody = (await split.json()) as { code?: string; kind?: string };
    expect(splitBody.code).toBe("E_ASSERTION_OUT_OF_SCOPE");
    expect(splitBody.kind).toBe("out_of_scope");
  });
});
