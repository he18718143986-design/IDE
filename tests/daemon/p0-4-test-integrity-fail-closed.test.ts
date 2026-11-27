import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  assertEvidenceTestIntegrity,
  MergeGateError,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function safeRmSync(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("TASK-P0.4: 测试基线防篡改、删除与隔离重跑全链路 fail-closed 门禁", () => {
  let repo: string;
  let store: ContractStore;

  const worktreeOf = (contractId: string) =>
    path.join(repo, ".stagent", "worktrees", `task-${contractId}`);

  function makeContract(options: {
    title: string;
    writablePaths?: string[];
    allowBaselineTestMutation?: boolean;
    verificationScript?: string;
  }): SoftwareContract {
    const draft = createContractDraft({
      title: options.title,
      description: "p0.4 test integrity fail-closed test",
      acceptanceCriteria: ["verify baseline test integrity"],
      writablePaths: options.writablePaths ?? ["src/**", "tests/**"],
      allowBaselineTestMutation: options.allowBaselineTestMutation,
      commands: [
        {
          alias: "unit-test",
          executable: "node",
          args: [
            "-e",
            options.verificationScript ?? "require('./tests/unit/a.test.js');",
          ],
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

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p04-repo-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.name", "P04 Tester"]);
    git(repo, ["config", "user.email", "p04@example.com"]);

    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.mkdirSync(path.join(repo, "tests", "unit"), { recursive: true });

    // 主干基线代码：a = 1
    fs.writeFileSync(path.join(repo, "src", "a.js"), "exports.a = 1;\n");
    // 主干基线测试：读取 src/a.js 并断言包含 exports.a = 1
    fs.writeFileSync(
      path.join(repo, "tests", "unit", "a.test.js"),
      `const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.resolve(process.cwd(), 'src/a.js'), 'utf-8');
if (!content.includes('exports.a = 1')) {
  process.exit(1);
}
`,
    );

    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init: base a=1 and baseline test"]);

    store = new ContractStore(repo);
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  it("P04-I1: Worker 修改既有测试掩盖回归 -> 基线还原重跑捕获回归 -> fail-closed E_TEST_BASELINE_REGRESSION", async () => {
    const contract = makeContract({
      title: "tampered-existing-test",
    });
    store.save(contract);

    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
    });

    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    // 修改业务代码为 a = 2，同时篡改测试文件断言 a = 2
    fs.writeFileSync(path.join(wt, "src", "a.js"), "exports.a = 2;\n");
    fs.writeFileSync(
      path.join(wt, "tests", "unit", "a.test.js"),
      `const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.resolve(process.cwd(), 'src/a.js'), 'utf-8');
if (!content.includes('exports.a = 2')) {
  process.exit(1);
}
`,
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.status).toBe("FAILED");
    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.evidence.tests_modified).toBe(true);

    const ti = outcome.evidence.test_integrity;
    expect(ti).toBeDefined();
    expect(ti?.modified_existing_tests).toEqual(["tests/unit/a.test.js"]);
    expect(ti?.baseline_rerun_triggered).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(false);
    expect(ti?.failure_code).toBe("E_TEST_BASELINE_REGRESSION");
  });

  it("P04-I2: Worker 删除既有测试 -> 还原被删除测试参与基线重跑 -> fail-closed 阻断", async () => {
    const contract = makeContract({
      title: "deleted-existing-test",
    });
    store.save(contract);

    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
    });

    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    // 修改业务代码为 a = 99，并删除了既有测试 a.test.js
    fs.writeFileSync(path.join(wt, "src", "a.js"), "exports.a = 99;\n");
    fs.unlinkSync(path.join(wt, "tests", "unit", "a.test.js"));

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.can_merge).toBe(false);
    const ti = outcome.evidence.test_integrity;
    expect(ti?.deleted_existing_tests).toEqual(["tests/unit/a.test.js"]);
    expect(ti?.baseline_rerun_triggered).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(false);
    expect(ti?.failure_code).toBe("E_TEST_BASELINE_REGRESSION");
  });

  it("P04-I3: 基线重跑环境故障（命令超时或缺失） -> fail-closed E_TEST_BASELINE_UNAVAILABLE", async () => {
    const contract = makeContract({
      title: "unavailable-runner-test",
      verificationScript: "setTimeout(() => {}, 10000);",
    });
    contract.verification_spec.commands[0]!.timeout_seconds = 1;
    store.save(contract);

    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
    });

    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    fs.writeFileSync(
      path.join(wt, "tests", "unit", "a.test.js"),
      "// modified",
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.can_merge).toBe(false);
    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    const ti = outcome.evidence.test_integrity;
    expect(ti?.baseline_rerun_triggered).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(false);
    expect(ti?.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
  });

  it("P04-I4: 合同显式声明 allow_baseline_test_mutation -> 豁免基线重跑阻断并留痕", async () => {
    const contract = makeContract({
      title: "exempted-test-mutation",
      allowBaselineTestMutation: true,
    });
    store.save(contract);

    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
    });

    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    fs.writeFileSync(path.join(wt, "src", "a.js"), "exports.a = 2;\n");
    fs.writeFileSync(
      path.join(wt, "tests", "unit", "a.test.js"),
      `const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.resolve(process.cwd(), 'src/a.js'), 'utf-8');
if (!content.includes('exports.a = 2')) {
  process.exit(1);
}
`,
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.status).toBe("PASSED");
    expect(outcome.evidence.verdict.can_merge).toBe(true);
    const ti = outcome.evidence.test_integrity;
    expect(ti?.exemption).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(true);
  });

  it("P04-I5: merger PRE_MERGE 阶段独立核验证据快照与合同豁免", () => {
    const baseContract = makeContract({ title: "merge-gate-contract" });

    // 场景 A: 证据修改了测试但重跑未通过 -> 拒绝
    const fakeEvidenceRegression: EvidenceBundle = {
      evidence_id: "evi_reg",
      contract_id: baseContract.contract_id,
      contract_revision: 1,
      generated_at: new Date().toISOString(),
      worker_control_mode: "GATEWAY_ENFORCED",
      usage: {
        currency: "USD",
        pricing_version: "1.0",
        accounting_mode: "UNAVAILABLE",
        limit_reached: false,
      },
      worktree_snapshot: {
        head_sha: "abc",
        snapshot_fingerprint: "fp",
        captured_at: new Date().toISOString(),
      },
      verdict: {
        status: "PASSED",
        can_merge: true,
        summary: "fake pass",
        verification_retry_count: 0,
      },
      scope_audit: {
        passed: true,
        files_changed: [],
        forbidden_violations: [],
        budget_exhausted: false,
      },
      verification_results: [],
      git_info: {
        base_commit_sha: "base",
        task_commit_sha: "abc",
        diff_stat: "",
        patch_fingerprint: "pf",
      },
      test_integrity: {
        tests_modified: true,
        modified_existing_tests: ["tests/unit/a.test.js"],
        deleted_existing_tests: [],
        added_tests: [],
        exemption: false,
        baseline_rerun_triggered: true,
        baseline_rerun_passed: false,
        failure_code: "E_TEST_BASELINE_REGRESSION",
        restored_paths: ["tests/unit/a.test.js"],
        weakened_tests: [],
      },
    };

    expect(() =>
      assertEvidenceTestIntegrity(fakeEvidenceRegression, baseContract),
    ).toThrowError(MergeGateError);

    // 场景 B: 伪造豁免（证据声称 exemption: true 但合同未声明） -> 拒绝
    const fakeForgedExemption: EvidenceBundle = {
      ...fakeEvidenceRegression,
      test_integrity: {
        ...fakeEvidenceRegression.test_integrity!,
        exemption: true,
      },
    };
    expect(() =>
      assertEvidenceTestIntegrity(fakeForgedExemption, baseContract),
    ).toThrowError(
      "Evidence claims test integrity exemption but contract does not allow baseline test mutation",
    );

    // 场景 C: 合同真实允许豁免 -> 放行
    const contractWithExemption = makeContract({
      title: "exempted-merge-contract",
      allowBaselineTestMutation: true,
    });
    expect(() =>
      assertEvidenceTestIntegrity(fakeForgedExemption, contractWithExemption),
    ).not.toThrow();
  });

  it("P04-I6: Worker 仅新增测试与修改源码，未改动既有测试 -> 零阻断零回归放行", async () => {
    const contract = makeContract({
      title: "pure-addition-test",
    });
    store.save(contract);

    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
    });

    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    // 新增 tests/unit/b.test.js，不动 a.test.js
    fs.writeFileSync(
      path.join(wt, "tests", "unit", "b.test.js"),
      "// new test file\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.status).toBe("PASSED");
    expect(outcome.evidence.verdict.can_merge).toBe(true);
    const ti = outcome.evidence.test_integrity;
    expect(ti?.modified_existing_tests).toEqual([]);
    expect(ti?.deleted_existing_tests).toEqual([]);
    expect(ti?.added_tests).toEqual(["tests/unit/b.test.js"]);
    expect(ti?.baseline_rerun_triggered).toBe(false);
    expect(ti?.baseline_rerun_passed).toBe(true);
  });

  it("P013-I1 (Scope D): 基线重跑执行期间恢复异常 -> orchestrator fail-closed BLOCKED + E_TEST_BASELINE_UNAVAILABLE -> merger 拦截阻断合流", async () => {
    // 验证命令在执行期间破坏新增测试备份，模拟重跑恢复现场故障
    const contract = makeContract({
      title: "recovery-failure-test",
      verificationScript: `
        const fs = require('fs');
        const path = require('path');
        // 破坏备份文件导致现场无法恢复
        const bak = path.resolve(process.cwd(), 'tests/unit/worker-added.test.js.stagent-p04-added.bak');
        if (fs.existsSync(bak)) {
          fs.unlinkSync(bak);
        }
      `,
    });
    store.save(contract);

    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    // 修改既有测试以触发基线重跑，同时新增测试
    fs.writeFileSync(
      path.join(wt, "tests", "unit", "a.test.js"),
      "// tampered test\n",
    );
    fs.writeFileSync(
      path.join(wt, "tests", "unit", "worker-added.test.js"),
      "// added test\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    expect(outcome.evidence.verdict.reason_code).toBe("UNSAFE_EXECUTION");
    expect(outcome.evidence.verdict.can_merge).toBe(false);

    const ti = outcome.evidence.test_integrity;
    expect(ti?.baseline_rerun_triggered).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(false);
    expect(ti?.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
    expect(ti?.failure_reason).toContain("Recovery cleanup failed");

    // merger 独立门禁必须拦截
    expect(() =>
      assertEvidenceTestIntegrity(outcome.evidence, contract),
    ).toThrow(MergeGateError);
    try {
      assertEvidenceTestIntegrity(outcome.evidence, contract);
    } catch (err: unknown) {
      const e = err as MergeGateError;
      expect(e.code).toBe("E_TEST_BASELINE_UNAVAILABLE");
      expect(e.message).toContain("Recovery cleanup failed");
    }
  });

  it("P013-I2 (Scope C): 修改既有测试但无任何可用测试命令 -> orchestrator fail-closed BLOCKED + E_TEST_BASELINE_UNAVAILABLE -> merger 拦截阻断合流", async () => {
    // 构造零测试命令但修改了既有测试的场景
    const draft = createContractDraft({
      title: "zero-commands-mutation-test",
      description: "p0.13 zero commands test",
      acceptanceCriteria: ["verify baseline test integrity"],
      writablePaths: ["src/**", "tests/**"],
      commands: [], // 零命令（配置 manualConfirmation 以通过合同校验）
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

    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    await orchestrator.admit(contract.contract_id);
    const wt = worktreeOf(contract.contract_id);

    fs.writeFileSync(
      path.join(wt, "tests", "unit", "a.test.js"),
      "// tampered test\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.status).toBe("BLOCKED");
    expect(outcome.evidence.verdict.can_merge).toBe(false);

    const ti = outcome.evidence.test_integrity;
    expect(ti?.baseline_rerun_triggered).toBe(true);
    expect(ti?.baseline_rerun_passed).toBe(false);
    expect(ti?.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
    expect(ti?.failure_reason).toContain("No verification commands available");

    expect(() =>
      assertEvidenceTestIntegrity(outcome.evidence, contract),
    ).toThrow(MergeGateError);
    try {
      assertEvidenceTestIntegrity(outcome.evidence, contract);
    } catch (err: unknown) {
      const e = err as MergeGateError;
      expect(e.code).toBe("E_TEST_BASELINE_UNAVAILABLE");
      expect(e.message).toContain("No verification commands available");
    }
  });
  describe("TASK-P0.14: 负向测试覆盖 (配置篡改阻断与门禁拦截)", () => {
    it("P014-I1: 篡改 vitest.config.ts 且未获豁免时 merger fail-closed 拦截", () => {
      const contract = createContractDraft({
        intent: { title: "P0.14 test", description: "test" },
      });
      // 仅允许基线测试修改，但不允许配置篡改
      contract.authorization.execution_permissions = {
        allow_baseline_test_mutation: true,
        allow_test_config_mutation: false,
      };

      const evidence: EvidenceBundle = {
        evidence_id: "evi_p014_config",
        contract_id: contract.contract_id,
        contract_revision: contract.contract_revision,
        worker_control_mode: "GATEWAY_ENFORCED",
        generated_at: new Date().toISOString(),
        usage: { total_input_tokens: 10, total_output_tokens: 10, duration_ms: 100 },
        verdict: { status: "PASSED", reason_code: "ALL_CONDITIONS_MET", note: "ok" },
        test_integrity: {
          tests_modified: true,
          modified_existing_tests: [],
          deleted_existing_tests: [],
          added_tests: [],
          exemption: true,
          baseline_rerun_triggered: false,
          baseline_rerun_passed: false,
          failure_code: "E_TEST_CONFIG_MUTATED",
          failure_reason: "Test configuration mutated without exemption: vitest.config.ts",
          restored_paths: [],
          weakened_tests: [],
          modified_test_configs: ["vitest.config.ts"],
          restored_fixtures_and_helpers: [],
          unregistered_test_assets: [],
          allow_test_config_mutation: false,
        },
      };

      expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
        /E_TEST_CONFIG_MUTATED/,
      );
    });

    it("P014-I2: Evidence 自称配置豁免但合同未授权时抛出 E_CANNOT_MERGE", () => {
      const contract = createContractDraft({
        intent: { title: "P0.14 test", description: "test" },
      });
      contract.authorization.execution_permissions = {
        allow_test_config_mutation: false,
      };

      const evidence: EvidenceBundle = {
        evidence_id: "evi_p014_unauth",
        contract_id: contract.contract_id,
        contract_revision: contract.contract_revision,
        worker_control_mode: "GATEWAY_ENFORCED",
        generated_at: new Date().toISOString(),
        usage: { total_input_tokens: 10, total_output_tokens: 10, duration_ms: 100 },
        verdict: { status: "PASSED", reason_code: "ALL_CONDITIONS_MET", note: "ok" },
        test_integrity: {
          tests_modified: true,
          modified_existing_tests: [],
          deleted_existing_tests: [],
          added_tests: [],
          exemption: false,
          baseline_rerun_triggered: true,
          baseline_rerun_passed: true,
          restored_paths: [],
          weakened_tests: [],
          modified_test_configs: ["vitest.config.ts"],
          restored_fixtures_and_helpers: [],
          unregistered_test_assets: [],
          allow_test_config_mutation: true, // 伪造声明
        },
      };

      expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
        /E_CANNOT_MERGE/,
      );
    });
  });
});
