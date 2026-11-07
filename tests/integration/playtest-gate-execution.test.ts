/**
 * TASK-L.17f：真 Daemon/验证链 `check playtest` 执行出口（集成面 · L17F-P4）。
 *
 * 夹具：临时 git 仓 + PATH 垫片（executable: stagent）+ LIVE/证据文件。
 * 证明 orchestrator 验证循环对北极星合同**真执行** playtest（非 skip），
 * 无证据 Fail-Closed；有匹配证据时可过该门禁项。
 *
 * 不宣称产品/UI e2e 闭环；不改 playtest-guard / C.23 装配 / CLI。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { playtestEvidencePath } from "../../daemon/playtest/evidence";

const STAGENT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REF = "https://ref.example.com/l17f-northstar";
const REL_LIVE = "rel-l17f-int-01";

function seedLiveRelease(repo: string, contractId: string): void {
  const dir = path.join(repo, ".stagent", "releases");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${REL_LIVE}.json`),
    JSON.stringify({
      schema_version: "1.0.0",
      release_id: REL_LIVE,
      target_id: "local",
      commit_sha: "cccccccc1",
      contract_ids: [contractId],
      state: "LIVE",
      previous_live_release_id: null,
      steps: [],
      created_at: "2026-11-07T00:00:00.000Z",
      triggered_by: "USER",
    }),
  );
}

function seedEvidence(repo: string, contractId: string): void {
  const file = playtestEvidencePath(repo, contractId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      schema_version: "1.0.0",
      contract_id: contractId,
      release_id: REL_LIVE,
      user_verdict: "集成测：对照参考站认可完成",
      operator: "user",
      timestamp: "2026-11-07T02:00:00.000Z",
    }),
  );
}

function northstarContract(): SoftwareContract {
  const draft = createContractDraft({
    title: "L.17f 北极星门禁执行",
    description: "验证链真跑 check playtest",
    acceptanceCriteria: ["与参考站一模一样"],
    writablePaths: ["src/**"],
    references: [REF],
    // 显式给一条必过命令；playtest 由 C.23 withPlaytestCommand 追加
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

describe("L17F-P4：可复现执行出口（orchestrator 验证链）", () => {
  let repo = "";
  let shimDir = "";
  let savedPath: string | undefined;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17f-int-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "l17f@example.com"]);
    git(repo, ["config", "user.name", "L17F"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    // PATH 垫片：合同 executable: stagent → 本仓 bin/stagent.ts
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17f-shim-"));
    const tsxBin = path.join(STAGENT_ROOT, "node_modules", ".bin", "tsx");
    const stagentEntry = path.join(STAGENT_ROOT, "bin", "stagent.ts");
    fs.writeFileSync(
      path.join(shimDir, "stagent"),
      `#!/usr/bin/env bash\nexec "${tsxBin}" "${stagentEntry}" "$@"\n`,
      { mode: 0o755 },
    );
    savedPath = process.env["PATH"];
    process.env["PATH"] = `${shimDir}${path.delimiter}${savedPath ?? ""}`;

    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
    if (shimDir) safeRmSync(shimDir);
    if (repo) safeRmSync(repo);
  });

  it("北极星无证据：verification 含 alias=playtest 真执行且 passed=false（Fail-Closed）", async () => {
    const contract = northstarContract();
    expect(
      contract.verification_spec.commands.some((c) => c.alias === "playtest"),
    ).toBe(true);
    store.save(contract);
    seedLiveRelease(repo, contract.contract_id);
    // 故意不写证据

    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);

    const playtest = outcome.evidence.verification_results.find(
      (r) => r.command_alias === "playtest",
    );
    expect(playtest).toBeDefined();
    expect(playtest!.passed).toBe(false);
    expect(playtest!.exit_code).toBe(1);
    // 真执行痕迹：stdout 含 guard JSON，不是缺 --contract-id 空转
    expect(playtest!.stdout_tail).toMatch(/UNCONFIRMED|PLAYTEST_UNCONFIRMED/);
    expect(playtest!.stdout_tail).not.toMatch(/missing --contract-id/);
    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.evidence.verdict.status).not.toBe("PASSED");
  });

  it("北极星有匹配证据：playtest passed=true，整轮可 PASSED", async () => {
    const contract = northstarContract();
    store.save(contract);
    seedLiveRelease(repo, contract.contract_id);
    seedEvidence(repo, contract.contract_id);

    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);

    const playtest = outcome.evidence.verification_results.find(
      (r) => r.command_alias === "playtest",
    );
    expect(playtest).toBeDefined();
    expect(playtest!.passed).toBe(true);
    expect(playtest!.exit_code).toBe(0);
    expect(playtest!.stdout_tail).toMatch(/APPROVED|PLAYTEST_APPROVED/);
    expect(outcome.evidence.verdict.status).toBe("PASSED");
    expect(outcome.evidence.verdict.can_merge).toBe(true);
  });

  it("非北极星合同：verification 结果不含 playtest", async () => {
    const draft = createContractDraft({
      title: "非北极星",
      description: "无参考站",
      acceptanceCriteria: ["x"],
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
    expect(
      contract.verification_spec.commands.some((c) => c.alias === "playtest"),
    ).toBe(false);
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(
      outcome.evidence.verification_results.some((r) => r.command_alias === "playtest"),
    ).toBe(false);
    expect(outcome.evidence.verdict.status).toBe("PASSED");
  });
});
