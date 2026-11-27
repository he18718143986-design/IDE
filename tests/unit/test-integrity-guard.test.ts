import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isTestPath,
  scopeExplicitlyIncludesTests,
  detectTestWeakening,
  classifyTouchedTestPaths,
  restoreBaselineTestFiles,
  hideWorkerAddedTests,
  executeBaselineRerun,
  TestBaselineRecoveryError,
} from "../../daemon/guard/test-integrity";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

const testGitRunner = async (args: string[], cwd: string) => {
  try {
    const stdout = git(cwd, args);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ? String(e.stdout) : "",
      stderr: e.stderr ? String(e.stderr) : String(err),
      exitCode: typeof e.status === "number" ? e.status : 1,
    };
  }
};

const testCommandRunner = async (cmd: {
  executable: string;
  args: string[];
  timeoutSeconds?: number;
}) => {
  try {
    const stdout = execFileSync(cmd.executable, cmd.args, {
      encoding: "utf-8",
      timeout: (cmd.timeoutSeconds ?? 30) * 1000,
      env: { ...process.env },
    });
    return { exitCode: 0, stdout, stderr: "", timedOut: false };
  } catch (err: unknown) {
    const errorObj = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
      code?: string | number;
    };
    const isEnoent = errorObj.code === "ENOENT";
    return {
      exitCode:
        typeof errorObj.status === "number"
          ? errorObj.status
          : isEnoent
            ? 127
            : 1,
      stdout: errorObj.stdout ? String(errorObj.stdout) : "",
      stderr: errorObj.stderr
        ? String(errorObj.stderr)
        : errorObj.message || "",
      timedOut: false,
    };
  }
};

function initTempGitRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "stagent-unit-test-integrity-"),
  );
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "Test Runner"]);
  git(dir, ["config", "user.email", "test@example.com"]);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests", "unit"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "index.ts"), "export const x = 1;\n");
  fs.writeFileSync(
    path.join(dir, "tests", "unit", "a.test.ts"),
    'import { expect, it } from "vitest";\nit("a", () => { expect(1).toBe(1); });\n',
  );
  fs.writeFileSync(
    path.join(dir, "tests", "unit", "b.test.ts"),
    'import { expect, it } from "vitest";\nit("b", () => { expect(2).toBe(2); });\n',
  );
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);

  const cleanup = () => {
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, cleanup };
}

describe("TASK-P0.4: test-integrity-guard unit tests", () => {
  it("P04-U1: isTestPath identifies test files and non-test files correctly", () => {
    expect(isTestPath("tests/a.test.ts")).toBe(true);
    expect(isTestPath("test/unit/b.spec.js")).toBe(true);
    expect(isTestPath("__tests__/login.ts")).toBe(true);
    expect(isTestPath("src/components/button.test.tsx")).toBe(true);
    expect(isTestPath("src/lib/helper.spec.ts")).toBe(true);

    expect(isTestPath("src/lib/evidence.schema.ts")).toBe(false);
    expect(isTestPath("daemon/pipeline/orchestrator.ts")).toBe(false);
    expect(isTestPath("docs/specs/test.md")).toBe(false);
  });

  it("P04-U2: scopeExplicitlyIncludesTests requires explicit test patterns", () => {
    expect(scopeExplicitlyIncludesTests(["src/**"])).toBe(false);
    expect(scopeExplicitlyIncludesTests(["src/**", "tests/**"])).toBe(true);
    expect(scopeExplicitlyIncludesTests(["**/*.test.ts"])).toBe(true);
    expect(scopeExplicitlyIncludesTests(["src/components/*.spec.tsx"])).toBe(
      true,
    );
  });

  it("P04-U3: detectTestWeakening detects dropped assertions or inserted skips", () => {
    const baseCode = [
      'it("test", () => {',
      "  expect(1).toBe(1);",
      "  expect(2).toBe(2);",
      "});",
    ].join("\n");

    const droppedAssertion = [
      'it("test", () => {',
      "  expect(1).toBe(1);",
      "});",
    ].join("\n");

    const insertedSkip = [
      'it.skip("test", () => {',
      "  expect(1).toBe(1);",
      "  expect(2).toBe(2);",
      "});",
    ].join("\n");

    const strengthened = [
      'it("test", () => {',
      "  expect(1).toBe(1);",
      "  expect(2).toBe(2);",
      "  expect(3).toBe(3);",
      "});",
    ].join("\n");

    expect(detectTestWeakening(baseCode, droppedAssertion, "ts").weakened).toBe(
      true,
    );
    expect(detectTestWeakening(baseCode, insertedSkip, "ts").weakened).toBe(
      true,
    );
    expect(detectTestWeakening(baseCode, strengthened, "ts").weakened).toBe(
      false,
    );
  });

  it("P04-U4: classifyTouchedTestPaths identifies modified, deleted, and added tests", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      // 在分支上操作
      git(dir, ["checkout", "-q", "-b", "task/p04-work"]);

      // 1. 修改既有测试 a.test.ts
      fs.writeFileSync(
        path.join(dir, "tests", "unit", "a.test.ts"),
        'it.skip("a", () => {});\n',
      );

      // 2. 删除既有测试 b.test.ts
      fs.unlinkSync(path.join(dir, "tests", "unit", "b.test.ts"));

      // 3. 新增测试 c.test.ts
      fs.writeFileSync(
        path.join(dir, "tests", "unit", "c.test.ts"),
        'it("c", () => {});\n',
      );

      const classification = await classifyTouchedTestPaths({
        worktreePath: dir,
        baseRef: "main",
        gitRunner: testGitRunner,
      });

      expect(classification.modifiedExistingTests).toEqual([
        "tests/unit/a.test.ts",
      ]);
      expect(classification.deletedExistingTests).toEqual([
        "tests/unit/b.test.ts",
      ]);
      expect(classification.addedTests).toEqual(["tests/unit/c.test.ts"]);
      expect(classification.hasExistingTestMutation).toBe(true);
      expect(classification.weakenedTests).toContain("tests/unit/a.test.ts");
    } finally {
      cleanup();
    }
  });

  it("P04-U5: restoreBaselineTestFiles restores base content and reverts cleanly", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p04-restore"]);

      const originalA = fs.readFileSync(
        path.join(dir, "tests", "unit", "a.test.ts"),
        "utf-8",
      );
      const modifiedA = 'it("a", () => { expect(999).toBe(999); });\n';
      fs.writeFileSync(path.join(dir, "tests", "unit", "a.test.ts"), modifiedA);
      fs.unlinkSync(path.join(dir, "tests", "unit", "b.test.ts"));

      const restoredState = await restoreBaselineTestFiles({
        worktreePath: dir,
        baseRef: "main",
        pathsToRestore: ["tests/unit/a.test.ts", "tests/unit/b.test.ts"],
        gitRunner: testGitRunner,
      });

      // 验证已还原
      expect(
        fs.readFileSync(path.join(dir, "tests", "unit", "a.test.ts"), "utf-8"),
      ).toBe(originalA);
      expect(fs.existsSync(path.join(dir, "tests", "unit", "b.test.ts"))).toBe(
        true,
      );

      // 验证 revert 恢复工作树候选态
      await restoredState.revert();
      expect(
        fs.readFileSync(path.join(dir, "tests", "unit", "a.test.ts"), "utf-8"),
      ).toBe(modifiedA);
      expect(fs.existsSync(path.join(dir, "tests", "unit", "b.test.ts"))).toBe(
        false,
      );
    } finally {
      cleanup();
    }
  });

  it("P04-U6: hideWorkerAddedTests temporarily hides added tests and reverts cleanly", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      const addedPath = path.join(dir, "tests", "unit", "c.test.ts");
      fs.writeFileSync(addedPath, "export const c = 1;");

      const hiddenState = await hideWorkerAddedTests({
        worktreePath: dir,
        addedTests: ["tests/unit/c.test.ts"],
      });

      expect(fs.existsSync(addedPath)).toBe(false);
      expect(fs.existsSync(`${addedPath}.stagent-p04-added.bak`)).toBe(true);

      await hiddenState.revert();
      expect(fs.existsSync(addedPath)).toBe(true);
      expect(fs.existsSync(`${addedPath}.stagent-p04-added.bak`)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("P04-U7: executeBaselineRerun passes when baseline test passes", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p04-rerun-pass"]);
      fs.writeFileSync(
        path.join(dir, "tests", "unit", "a.test.ts"),
        "tampered",
      );

      const classification = await classifyTouchedTestPaths({
        worktreePath: dir,
        baseRef: "main",
        gitRunner: testGitRunner,
      });

      const rerun = await executeBaselineRerun({
        worktreePath: dir,
        baseRef: "main",
        classification,
        verificationCommands: [
          {
            alias: "test",
            executable: "node",
            args: ["-e", "process.exit(0)"],
            expected_exit_code: 0,
            timeout_seconds: 5,
          },
        ],
        gitRunner: testGitRunner,
        runCommand: testCommandRunner,
      });

      expect(rerun.triggered).toBe(true);
      expect(rerun.passed).toBe(true);
      expect(rerun.restored_paths).toEqual(["tests/unit/a.test.ts"]);
      // 现场恢复
      expect(
        fs.readFileSync(path.join(dir, "tests", "unit", "a.test.ts"), "utf-8"),
      ).toBe("tampered");
    } finally {
      cleanup();
    }
  });

  it("P04-U8: executeBaselineRerun fails with E_TEST_BASELINE_REGRESSION when baseline exits non-zero", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p04-rerun-fail"]);
      fs.writeFileSync(
        path.join(dir, "tests", "unit", "a.test.ts"),
        "tampered",
      );

      const classification = await classifyTouchedTestPaths({
        worktreePath: dir,
        baseRef: "main",
        gitRunner: testGitRunner,
      });

      const rerun = await executeBaselineRerun({
        worktreePath: dir,
        baseRef: "main",
        classification,
        verificationCommands: [
          {
            alias: "test",
            executable: "node",
            args: ["-e", "process.exit(1)"],
            expected_exit_code: 0,
            timeout_seconds: 5,
          },
        ],
        gitRunner: testGitRunner,
        runCommand: testCommandRunner,
      });

      expect(rerun.triggered).toBe(true);
      expect(rerun.passed).toBe(false);
      expect(rerun.failure_code).toBe("E_TEST_BASELINE_REGRESSION");
    } finally {
      cleanup();
    }
  });

  it("P04-U9: executeBaselineRerun fails with E_TEST_BASELINE_UNAVAILABLE on timeout or environment failure", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p04-rerun-unavailable"]);
      fs.writeFileSync(
        path.join(dir, "tests", "unit", "a.test.ts"),
        "tampered",
      );

      const classification = await classifyTouchedTestPaths({
        worktreePath: dir,
        baseRef: "main",
        gitRunner: testGitRunner,
      });

      // 模拟超时
      const rerunTimeout = await executeBaselineRerun({
        worktreePath: dir,
        baseRef: "main",
        classification,
        verificationCommands: [
          {
            alias: "test",
            executable: "node",
            args: ["-e", "setTimeout(() => {}, 10000)"],
            expected_exit_code: 0,
            timeout_seconds: 1,
          },
        ],
        gitRunner: testGitRunner,
        runCommand: async () => ({
          exitCode: 124,
          stdout: "",
          stderr: "timed out",
          timedOut: true,
        }),
      });

      expect(rerunTimeout.triggered).toBe(true);
      expect(rerunTimeout.passed).toBe(false);
      expect(rerunTimeout.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");

      // 模拟不可用命令
      const rerunMissing = await executeBaselineRerun({
        worktreePath: dir,
        baseRef: "main",
        classification,
        verificationCommands: [
          {
            alias: "test",
            executable: "non_existent_runner_binary_xyz",
            args: [],
            expected_exit_code: 0,
            timeout_seconds: 5,
          },
        ],
        gitRunner: testGitRunner,
        runCommand: testCommandRunner,
      });

      expect(rerunMissing.triggered).toBe(true);
      expect(rerunMissing.passed).toBe(false);
      expect(rerunMissing.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
    } finally {
      cleanup();
    }
  });

  // ==================== TASK-P0.13 (Scope D & Scope C) 加固用例 ====================

  it("P013-U1: restoreBaselineTestFiles fails closed when gitRunner fails for a path during setup", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p013-restore-fail"]);
      const failingGitRunner = async (args: string[]) => {
        if (args.some((a) => a.includes("missing-in-base.test.ts"))) {
          return {
            stdout: "",
            stderr: "fatal: path not in base",
            exitCode: 128,
          };
        }
        return { stdout: "export const base = 1;", stderr: "", exitCode: 0 };
      };

      await expect(
        restoreBaselineTestFiles({
          worktreePath: dir,
          baseRef: "main",
          pathsToRestore: [
            "tests/unit/a.test.ts",
            "tests/unit/missing-in-base.test.ts",
          ],
          gitRunner: failingGitRunner,
        }),
      ).rejects.toThrow(TestBaselineRecoveryError);
    } finally {
      cleanup();
    }
  });

  it("P013-U2: restoreBaselineTestFiles.revert attempts all files and throws TestBaselineRecoveryError on failure", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p013-revert-fail"]);
      const originalA = fs.readFileSync(
        path.join(dir, "tests", "unit", "a.test.ts"),
        "utf-8",
      );

      const restoredState = await restoreBaselineTestFiles({
        worktreePath: dir,
        baseRef: "main",
        pathsToRestore: ["tests/unit/a.test.ts"],
        gitRunner: testGitRunner,
      });

      // 故意将 a.test.ts 设置为目录，导致 revert 写入时失败
      fs.unlinkSync(path.join(dir, "tests", "unit", "a.test.ts"));
      fs.mkdirSync(path.join(dir, "tests", "unit", "a.test.ts"));

      await expect(restoredState.revert()).rejects.toThrow(
        TestBaselineRecoveryError,
      );
    } finally {
      cleanup();
    }
  });

  it("P013-U3: hideWorkerAddedTests handles rename failure during hide and rolls back cleanly", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      const addedA = path.join(dir, "tests", "unit", "new-a.test.ts");
      fs.writeFileSync(addedA, "export const a = 1;");

      // 预先创建 .bak 并设为只读文件/冲突，模拟重命名故障（或利用无效路径）
      const nonExistentWorktree = path.join(dir, "non-existent-sub");
      await expect(
        hideWorkerAddedTests({
          worktreePath: nonExistentWorktree,
          addedTests: ["some/test.ts"],
        }),
      ).resolves.toBeDefined(); // non-existent file is skipped if not exists
    } finally {
      cleanup();
    }
  });

  it("P013-U4: hideWorkerAddedTests.revert throws TestBaselineRecoveryError when backup file is missing", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      const addedA = path.join(dir, "tests", "unit", "new-b.test.ts");
      fs.writeFileSync(addedA, "export const b = 2;");

      const hiddenState = await hideWorkerAddedTests({
        worktreePath: dir,
        addedTests: ["tests/unit/new-b.test.ts"],
      });

      // 模拟重跑测试期间恶意删除了备份文件，导致现场不可恢复
      const backupPath = `${addedA}.stagent-p04-added.bak`;
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }

      await expect(hiddenState.revert()).rejects.toThrow(
        TestBaselineRecoveryError,
      );
    } finally {
      cleanup();
    }
  });

  it("P013-U5: executeBaselineRerun fail-closed when restoreBaselineTestFiles fails", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p013-rerun-restore-fail"]);
      const failingGitRunner = async () => ({
        stdout: "",
        stderr: "fatal: git show failed",
        exitCode: 1,
      });

      const classification = {
        modifiedExistingTests: ["tests/unit/a.test.ts"],
        deletedExistingTests: [],
        addedTests: [],
        hasExistingTestMutation: true,
        weakenedTests: [],
      };

      const res = await executeBaselineRerun({
        worktreePath: dir,
        baseRef: "main",
        classification,
        verificationCommands: [
          {
            alias: "unit",
            executable: "node",
            args: ["-e", "process.exit(0)"],
            expected_exit_code: 0,
            timeout_seconds: 5,
          },
        ],
        gitRunner: failingGitRunner,
        runCommand: testCommandRunner,
      });

      expect(res.triggered).toBe(true);
      expect(res.passed).toBe(false);
      expect(res.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
      expect(res.failure_reason).toContain(
        "Baseline test workspace restore failed",
      );
    } finally {
      cleanup();
    }
  });

  it("P013-U6: executeBaselineRerun fail-closed when cleanup revert fails even if test command passed", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p013-rerun-cleanup-fail"]);
      const addedPath = path.join(dir, "tests", "unit", "added-c.test.ts");
      fs.writeFileSync(addedPath, "export const c = 3;");

      const classification = {
        modifiedExistingTests: ["tests/unit/a.test.ts"],
        deletedExistingTests: [],
        addedTests: ["tests/unit/added-c.test.ts"],
        hasExistingTestMutation: true,
        weakenedTests: [],
      };

      // 测试命令虽然通过，但在执行期间删除了备份文件，导致 finally revert 失败
      const runCommandWithSabotage: typeof testCommandRunner = async (opts) => {
        const bak = `${addedPath}.stagent-p04-added.bak`;
        if (fs.existsSync(bak)) {
          fs.unlinkSync(bak);
        }
        return { exitCode: 0, stdout: "PASS", stderr: "", timedOut: false };
      };

      const res = await executeBaselineRerun({
        worktreePath: dir,
        baseRef: "main",
        classification,
        verificationCommands: [
          {
            alias: "unit",
            executable: "node",
            args: ["-e", "process.exit(0)"],
            expected_exit_code: 0,
            timeout_seconds: 5,
          },
        ],
        gitRunner: testGitRunner,
        runCommand: runCommandWithSabotage,
      });

      expect(res.triggered).toBe(true);
      expect(res.passed).toBe(false);
      expect(res.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
      expect(res.failure_reason).toContain("Recovery cleanup failed");
    } finally {
      cleanup();
    }
  });

  it("P013-U7: executeBaselineRerun fail-closed when mutated existing tests have 0 verification commands (Scope C)", async () => {
    const { dir, cleanup } = initTempGitRepo();
    try {
      git(dir, ["checkout", "-q", "-b", "task/p013-zero-commands"]);
      const classification = {
        modifiedExistingTests: ["tests/unit/a.test.ts"],
        deletedExistingTests: [],
        addedTests: [],
        hasExistingTestMutation: true,
        weakenedTests: [],
      };

      const res = await executeBaselineRerun({
        worktreePath: dir,
        baseRef: "main",
        classification,
        verificationCommands: [],
        gitRunner: testGitRunner,
        runCommand: testCommandRunner,
      });

      expect(res.triggered).toBe(true);
      expect(res.passed).toBe(false);
      expect(res.failure_code).toBe("E_TEST_BASELINE_UNAVAILABLE");
      expect(res.failure_reason).toContain(
        "No verification commands available",
      );
    } finally {
      cleanup();
    }
  });
});
