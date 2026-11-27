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
