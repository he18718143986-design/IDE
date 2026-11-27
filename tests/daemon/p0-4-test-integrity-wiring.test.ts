import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  evidenceBundleSchema,
  controlledEvidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import {
  executeBaselineRerun,
  type GitRunner,
  type BaselineCommandRunner,
} from "../../daemon/guard/test-integrity";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertEvidenceTestIntegrity,
  assertEvidenceControlAndRevision,
  MergeGateError,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  bumpContractRevision,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

function createValidBaseEvidence(
  overrides: Partial<EvidenceBundle> = {},
): EvidenceBundle {
  const base: EvidenceBundle = {
    evidence_id: "evi_1",
    contract_id: "contract_1",
    contract_revision: 1,
    worker_control_mode: "GATEWAY_ENFORCED",
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "ESTIMATED",
      estimated_cost_minor_units: 100,
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "abc123",
      snapshot_fingerprint: "fp_abc123",
      captured_at: new Date().toISOString(),
    },
    verdict: {
      status: "PASSED",
      can_merge: true,
      summary: "all gates passed",
    },
    scope_audit: {
      passed: true,
      files_changed: [
        { path: "src/math.ts", additions: 3, deletions: 1, binary: false },
      ],
      forbidden_violations: [],
      budget_exhausted: false,
    },
    verification_results: [
      {
        command_alias: "test",
        exit_code: 0,
        stdout_tail: "ok",
        stderr_tail: "",
        duration_ms: 12,
        passed: true,
      },
    ],
    git_info: {
      base_commit_sha: "abc1234",
      task_commit_sha: "def5678",
      diff_stat: "1 file changed",
      patch_fingerprint: "fp_patch_123",
    },
    test_integrity: {
      tests_modified: false,
      modified_existing_tests: [],
      deleted_existing_tests: [],
      added_tests: [],
      exemption: false,
      baseline_rerun_triggered: false,
      baseline_rerun_passed: true,
      restored_paths: [],
      weakened_tests: [],
    },
  };
  return { ...base, ...overrides };
}

describe("TASK-P0.2a (P02A-P1): Schema 校验与完整性记录合法放行", () => {
  it("受控 Evidence 包含合法 test_integrity 时 schema 解析成功", () => {
    const valid = createValidBaseEvidence();
    expect(() => evidenceBundleSchema.parse(valid)).not.toThrow();
    expect(() => controlledEvidenceBundleSchema.parse(valid)).not.toThrow();
  });

  it("受控 Evidence (GATEWAY_ENFORCED) 缺失 test_integrity 时 superRefine 拦截报错", () => {
    const invalid: Record<string, unknown> = { ...createValidBaseEvidence() };
    delete invalid["test_integrity"];
    const res = evidenceBundleSchema.safeParse(invalid);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) =>
        i.path.includes("test_integrity"),
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain(
        "受控 Evidence 必须包含完整 test_integrity 记录",
      );
    }
  });

  it("受控 Evidence (SANDBOX_ENFORCED) 缺失 test_integrity 时拦截报错", () => {
    const invalid: Record<string, unknown> = {
      ...createValidBaseEvidence({
        worker_control_mode: "SANDBOX_ENFORCED",
        sandbox_witness: {
          host_kind: "docker/29.6.1",
          via: "exit",
          exit_code: 0,
          duration_ms: 50,
          worktree_root: "/tmp/worktree",
        },
      }),
    };
    delete invalid["test_integrity"];
    const res = evidenceBundleSchema.safeParse(invalid);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) =>
        i.path.includes("test_integrity"),
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain(
        "受控 Evidence 必须包含完整 test_integrity 记录",
      );
    }
  });

  it("controlledEvidenceBundleSchema 对缺失 test_integrity 严厉拦截", () => {
    const invalid: Record<string, unknown> = { ...createValidBaseEvidence() };
    delete invalid["test_integrity"];
    const res = controlledEvidenceBundleSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });
});

describe("TASK-P0.2a (P02A-P2): 测试基线与合同版本绑定证明审计与不可恢复 fail-closed 验证", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p02a-test-integrity-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("当验证测试环境命令不可用或抛出非零时，fail-closed 返回对应错误", async () => {
    const successfulGitRunner: GitRunner = async (args) => {
      if (args[0] === "show") {
        return {
          stdout: "export const baselineTest = true;",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const failingCmdRunner: BaselineCommandRunner = async () => {
      return { exitCode: 1, stdout: "FAIL", stderr: "Assertion failed" };
    };

    const dummyCmd = {
      alias: "unit-test",
      executable: "node",
      args: ["-e", "process.exit(1)"],
      expected_exit_code: 0,
      timeout_seconds: 30,
    };

    const classification = {
      modifiedExistingTests: ["src/tests/a.test.ts"],
      deletedExistingTests: [],
      addedTests: [],
      hasExistingTestMutation: true,
      weakenedTests: [],
    };

    const rerunRes = await executeBaselineRerun({
      worktreePath: tmpDir,
      baseRef: "main",
      classification,
      verificationCommands: [dummyCmd],
      gitRunner: successfulGitRunner,
      runCommand: failingCmdRunner,
    });

    expect(rerunRes.triggered).toBe(true);
    expect(rerunRes.passed).toBe(false);
    expect(rerunRes.failure_code).toBe("E_TEST_BASELINE_REGRESSION");
    expect(rerunRes.failure_reason).toContain("exit code 1");
  });

  it("当环境命令执行超时或报 spawn 异常时，fail-closed 返回 E_TEST_BASELINE_UNAVAILABLE", async () => {
    const successfulGitRunner: GitRunner = async () => {
      return { stdout: "baseline content", stderr: "", exitCode: 0 };
    };

    const timeoutCmdRunner: BaselineCommandRunner = async () => {
      return {
        exitCode: 124,
        stdout: "",
        stderr: "command timed out",
        timedOut: true,
      };
    };

    const dummyCmd = {
      alias: "unit-test",
      executable: "node",
      args: ["-e", "hang()"],
      expected_exit_code: 0,
      timeout_seconds: 30,
    };

    const classification = {
      modifiedExistingTests: ["src/tests/a.test.ts"],
      deletedExistingTests: [],
      addedTests: [],
      hasExistingTestMutation: true,
      weakenedTests: [],
    };

    const rerunRes = await executeBaselineRerun({
      worktreePath: tmpDir,
      baseRef: "main",
      classification,
      verificationCommands: [dummyCmd],
      gitRunner: successfulGitRunner,
      runCommand: timeoutCmdRunner,
    });

    expect(rerunRes.triggered).toBe(true);
    expect(rerunRes.passed).toBe(false);
    expect(rerunRes.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
    expect(rerunRes.failure_reason).toContain("timed out");
  });

  it("当测试命令不存在 (exitCode 127) 时，fail-closed 返回 E_TEST_BASELINE_UNAVAILABLE", async () => {
    const successfulGitRunner: GitRunner = async () => {
      return { stdout: "baseline content", stderr: "", exitCode: 0 };
    };

    const notFoundCmdRunner: BaselineCommandRunner = async () => {
      return {
        exitCode: 127,
        stdout: "",
        stderr: "command not found: missing-tool",
      };
    };

    const dummyCmd = {
      alias: "unit-test",
      executable: "missing-tool",
      args: [],
      expected_exit_code: 0,
      timeout_seconds: 30,
    };

    const classification = {
      modifiedExistingTests: ["src/tests/a.test.ts"],
      deletedExistingTests: [],
      addedTests: [],
      hasExistingTestMutation: true,
      weakenedTests: [],
    };

    const rerunRes = await executeBaselineRerun({
      worktreePath: tmpDir,
      baseRef: "main",
      classification,
      verificationCommands: [dummyCmd],
      gitRunner: successfulGitRunner,
      runCommand: notFoundCmdRunner,
    });

    expect(rerunRes.triggered).toBe(true);
    expect(rerunRes.passed).toBe(false);
    expect(rerunRes.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
    expect(rerunRes.failure_reason).toContain("missing-tool");
  });

  it("当未变动既有测试时，基线重跑不被触发并安全放行", async () => {
    const classification = {
      modifiedExistingTests: [],
      deletedExistingTests: [],
      addedTests: ["src/tests/new.test.ts"],
      hasExistingTestMutation: false,
      weakenedTests: [],
    };

    const rerunRes = await executeBaselineRerun({
      worktreePath: tmpDir,
      baseRef: "main",
      classification,
      verificationCommands: [],
      gitRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });

    expect(rerunRes.triggered).toBe(false);
    expect(rerunRes.passed).toBe(true);
  });
});

describe("TASK-P0.13: 基线验收独立性与恢复加固 (Scope A, Scope C & Scope D wiring)", () => {
  function createSampleContract(
    overrides: Partial<SoftwareContract> = {},
  ): SoftwareContract {
    const draft = createContractDraft({
      title: "Sample Contract",
      description: "Test Contract",
      writablePaths: ["src/**"],
      acceptanceCriteria: ["AC-1: tests must pass"],
      commands: [
        {
          alias: "unit",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    return {
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "reviewer_1",
        approved_at: new Date().toISOString(),
        approved_revision: draft.contract_revision,
      },
      ...overrides,
    };
  }

  it("P013-W1 (Scope D): merger 拒绝 baseline_rerun_passed 为 true 但携带 failure_code 的自相矛盾伪造证据", () => {
    const contract = createSampleContract();
    const evidence = createValidBaseEvidence({
      test_integrity: {
        tests_modified: true,
        modified_existing_tests: ["tests/a.test.ts"],
        deleted_existing_tests: [],
        added_tests: [],
        exemption: false,
        baseline_rerun_triggered: true,
        baseline_rerun_passed: true,
        failure_code: "E_TEST_BASELINE_REGRESSION",
        restored_paths: ["tests/a.test.ts"],
        weakened_tests: [],
      },
    });

    expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
      MergeGateError,
    );
    expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
      /inconsistent/,
    );
  });

  it("P013-W2 (Scope D): merger 拒绝修改了既有测试且未获豁免但未触发基线重跑的证据", () => {
    const contract = createSampleContract();
    const evidence = createValidBaseEvidence({
      test_integrity: {
        tests_modified: true,
        modified_existing_tests: ["tests/a.test.ts"],
        deleted_existing_tests: [],
        added_tests: [],
        exemption: false,
        baseline_rerun_triggered: false,
        baseline_rerun_passed: true,
        restored_paths: [],
        weakened_tests: [],
      },
    });

    expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
      MergeGateError,
    );
    expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
      /Baseline rerun was not triggered/,
    );
  });

  it("P013-W3 (Scope D): merger 拦截因恢复失败导致的 E_TEST_BASELINE_UNAVAILABLE", () => {
    const contract = createSampleContract();
    const evidence = createValidBaseEvidence({
      test_integrity: {
        tests_modified: true,
        modified_existing_tests: ["tests/a.test.ts"],
        deleted_existing_tests: [],
        added_tests: [],
        exemption: false,
        baseline_rerun_triggered: true,
        baseline_rerun_passed: false,
        failure_code: "E_TEST_BASELINE_UNAVAILABLE",
        failure_reason: "Recovery cleanup failed: tests/a.test.ts (EPERM)",
        restored_paths: ["tests/a.test.ts"],
        weakened_tests: [],
      },
    });

    expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
      MergeGateError,
    );
    try {
      assertEvidenceTestIntegrity(evidence, contract);
    } catch (err: unknown) {
      const e = err as MergeGateError;
      expect(e.code).toBe("E_TEST_BASELINE_UNAVAILABLE");
      expect(e.message).toContain("Recovery cleanup failed");
    }
  });

  it("P013-W4 (Scope A): verification_spec 与 revision 变更强制使旧审批失效，并在合并前由 revision 门禁拦截", () => {
    const contract = createSampleContract();
    expect(contract.contract_revision).toBe(1);
    expect(contract.approval.approved_revision).toBe(1);

    // 当合同规范发生变更导致版本递增时
    const bumped = bumpContractRevision(contract);
    expect(bumped.contract_revision).toBe(2);
    // 旧审批状态必须重置，不可直接使用
    expect(bumped.approval.status).toBe("PENDING_REVIEW");
    expect(bumped.approval.approved_revision).toBeUndefined();

    // 针对旧 revision 签发的 Evidence 在新 revision 合同时无法通过合并独立核验
    const oldEvidence = createValidBaseEvidence({
      contract_revision: 1,
    });

    expect(() =>
      assertEvidenceControlAndRevision(oldEvidence, bumped.contract_revision),
    ).toThrow(/E_EVIDENCE_REVISION_MISMATCH/);
  });
  describe("TASK-P0.14: 契约与 Evidence 扩展及 merger 门禁校验", () => {
    it("P014-W1: evidenceBundleSchema 校验 test_integrity 新字段", () => {
      const evidence = createValidBaseEvidence({
        test_integrity: {
          tests_modified: true,
          modified_existing_tests: [],
          deleted_existing_tests: [],
          added_tests: [],
          exemption: false,
          baseline_rerun_triggered: true,
          baseline_rerun_passed: true,
          restored_paths: ["tests/fixtures/data.json"],
          weakened_tests: [],
          test_asset_manifest_digest: "a".repeat(64),
          modified_test_configs: ["vitest.config.ts"],
          restored_fixtures_and_helpers: ["tests/fixtures/data.json"],
          unregistered_test_assets: ["tsconfig.temp.json"],
          allow_test_config_mutation: false,
        },
      });

      const parsed = evidenceBundleSchema.parse(evidence);
      expect(parsed.test_integrity?.test_asset_manifest_digest).toBe(
        "a".repeat(64),
      );
      expect(parsed.test_integrity?.modified_test_configs).toContain(
        "vitest.config.ts",
      );
      expect(parsed.test_integrity?.restored_fixtures_and_helpers).toContain(
        "tests/fixtures/data.json",
      );
    });

    it("P014-W2: assertEvidenceTestIntegrity 拦截未豁免配置篡改抛出 E_TEST_CONFIG_MUTATED", () => {
      const contract = createContractDraft({
        title: "test",
        description: "test",
        writablePaths: ["src/**"],
        acceptanceCriteria: ["AC-1"],
        commands: [
          {
            alias: "unit",
            executable: "npx",
            args: ["vitest"],
            timeoutSeconds: 30,
          },
        ],
      });
      contract.authorization.execution_permissions = {
        allow_baseline_test_mutation: true,
        allow_test_config_mutation: false, // 未豁免配置篡改
      };

      const evidence = createValidBaseEvidence({
        test_integrity: {
          tests_modified: true,
          modified_existing_tests: [],
          deleted_existing_tests: [],
          added_tests: [],
          exemption: true,
          baseline_rerun_triggered: false,
          baseline_rerun_passed: true,
          restored_paths: [],
          weakened_tests: [],
          modified_test_configs: ["vitest.config.ts"],
          restored_fixtures_and_helpers: [],
          unregistered_test_assets: [],
          allow_test_config_mutation: false,
        },
      });

      expect(() => assertEvidenceTestIntegrity(evidence, contract)).toThrow(
        /E_TEST_CONFIG_MUTATED/,
      );
    });

    it("P014-W3: 合同显式豁免配置篡改时允许通过", () => {
      const contract = createContractDraft({
        title: "test",
        description: "test",
        writablePaths: ["src/**"],
        acceptanceCriteria: ["AC-1"],
        commands: [
          {
            alias: "unit",
            executable: "npx",
            args: ["vitest"],
            timeoutSeconds: 30,
          },
        ],
      });
      contract.authorization.execution_permissions = {
        allow_baseline_test_mutation: true,
        allow_test_config_mutation: true, // 显式豁免
      };

      const evidence = createValidBaseEvidence({
        test_integrity: {
          tests_modified: true,
          modified_existing_tests: [],
          deleted_existing_tests: [],
          added_tests: [],
          exemption: true,
          baseline_rerun_triggered: false,
          baseline_rerun_passed: true,
          restored_paths: [],
          weakened_tests: [],
          modified_test_configs: ["vitest.config.ts"],
          restored_fixtures_and_helpers: [],
          unregistered_test_assets: [],
          allow_test_config_mutation: true,
        },
      });

      expect(() =>
        assertEvidenceTestIntegrity(evidence, contract),
      ).not.toThrow();
    });
  });
});
