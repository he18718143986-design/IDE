import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VerificationCommand } from "../../src/lib/contract.schema";

const execFileAsync = promisify(execFile);

/**
 * 测试文件防篡改（Test Integrity Guard）。
 *
 * 威胁模型：Worker（LLM）修复失败时的经典作弊路径是修改测试断言、
 * 把 it() 改成 it.skip()，让验证命令退出码归零、Evidence 显示 PASSED。
 * 退出码只证明「命令跑完了」，不证明「测试没被考生自己改过」。
 *
 * 规则：
 * 1. 测试文件的写操作要求 writable_paths 中存在「显式指向测试代码」的模式
 *    （如 tests/**、*.test.ts）；仅被 src/** 这类宽泛模式覆盖不够。
 * 2. 即使合同显式授权了测试文件，Evidence 也必须记录 tests_modified: true，
 *    供核销人在控制台高亮预警中人工复核。
 * 3. TASK-P0.4: 当修改或删除既有测试文件且未获显式豁免时，
 *    在 POST_VERIFICATION 阶段触发基线隔离重跑（仅还原修改/删除的既有测试文件，
 *    Worker 新增测试不参与重跑；删除测试必须还原并跑）；
 *    重跑失败抛 E_TEST_BASELINE_REGRESSION，环境故障抛 E_TEST_BASELINE_UNAVAILABLE。
 */

const TEST_DIR_SEGMENTS = new Set(["tests", "test", "__tests__"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.[^/]+$/;

export function normalizeTestRelPath(relPath: string): string {
  return relPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "");
}

/** 判断相对路径是否为测试文件（tests/、test/、__tests__/ 目录或 *.test.* / *.spec.* 文件） */
export function isTestPath(relPath: string): boolean {
  const normalized = normalizeTestRelPath(relPath);
  if (!normalized) return false;
  const segments = normalized.split("/");
  if (
    segments
      .slice(0, -1)
      .some((segment) => TEST_DIR_SEGMENTS.has(segment.toLowerCase()))
  ) {
    return true;
  }
  const basename = segments[segments.length - 1] ?? "";
  return TEST_FILE_PATTERN.test(basename.toLowerCase());
}

/**
 * writable_paths 中是否存在「显式指向测试代码」的模式。
 * 仅 `src/**` 这类宽泛模式不算显式授权；必须出现 tests/test/__tests__
 * 目录段，或 .test. / .spec. 文件模式。
 */
export function scopeExplicitlyIncludesTests(writablePaths: string[]): boolean {
  return writablePaths.some((raw) => {
    const pattern = normalizeTestRelPath(raw).toLowerCase();
    if (!pattern) return false;
    if (pattern.includes(".test.") || pattern.includes(".spec.")) return true;
    return /(^|\/)(tests?|__tests__)(\/|$)/.test(pattern);
  });
}

/** 语言标签：决定断言与 skip/only 识别规则 */
export type TestIntegrityLang =
  "ts" | "js" | "tsx" | "jsx" | "py" | "go" | "rs";

export interface TestWeakeningResult {
  weakened: boolean;
  reasons: string[];
  base_assertion_count: number;
  candidate_assertion_count: number;
}

const ASSERTION_PATTERNS: Record<string, RegExp[]> = {
  ts: [/\bexpect\s*\(/g, /\bassert\s*\(/g, /\bassert\.\w+\s*\(/g],
  js: [/\bexpect\s*\(/g, /\bassert\s*\(/g, /\bassert\.\w+\s*\(/g],
  tsx: [/\bexpect\s*\(/g, /\bassert\s*\(/g],
  jsx: [/\bexpect\s*\(/g, /\bassert\s*\(/g],
  py: [/\bassert\b/g, /\bself\.assert\w+\s*\(/g, /\bpytest\.raises\s*\(/g],
  go: [/\b(?:assert|require|assertEq)\w*\s*\(/g, /\bt\.(?:Fatal|Error|Fail)/g],
  rs: [/\bassert(?:_eq|_ne|_lt|_gt)?!\s*\(/g],
};

const WEAKEN_INSERT_PATTERNS: RegExp[] = [
  /\bit\.only\s*\(/g,
  /\btest\.only\s*\(/g,
  /\bdescribe\.only\s*\(/g,
  /\bfit\s*\(/g,
  /\bfdescribe\s*\(/g,
  /\bit\.skip\s*\(/g,
  /\btest\.skip\s*\(/g,
  /\bdescribe\.skip\s*\(/g,
  /\bxit\s*\(/g,
  /\bxdescribe\s*\(/g,
  /\bxtest\s*\(/g,
  /@pytest\.mark\.skip(?:if)?\b/g,
  /\bpytest\.skip\s*\(/g,
  /\bt\.Skip\s*\(/g,
];

function countMatches(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    const hits = text.match(re);
    total += hits?.length ?? 0;
  }
  return total;
}

function collectInsertHits(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of WEAKEN_INSERT_PATTERNS) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    const found = text.match(re);
    if (found && found.length > 0) {
      hits.push(...found);
    }
  }
  return hits;
}

/**
 * 比对基线与候选测试源码，判定是否削弱门禁（verification-strategy §5）。
 *
 * - 断言调用数下降 → weakened
 * - 新增 .skip / .only / xit / @pytest.mark.skip 等 → weakened
 * - 只增断言 → 不 weakened
 */
export function detectTestWeakening(
  baseText: string,
  candidateText: string,
  lang: TestIntegrityLang,
): TestWeakeningResult {
  const key = lang in ASSERTION_PATTERNS ? lang : "ts";
  const patterns = ASSERTION_PATTERNS[key] ?? ASSERTION_PATTERNS["ts"]!;
  const baseCount = countMatches(baseText, patterns);
  const candidateCount = countMatches(candidateText, patterns);
  const reasons: string[] = [];

  if (candidateCount < baseCount) {
    reasons.push(`assertion_count_dropped:${baseCount}->${candidateCount}`);
  }

  const baseInserts = collectInsertHits(baseText);
  const candidateInserts = collectInsertHits(candidateText);
  if (candidateInserts.length > baseInserts.length) {
    reasons.push(
      `inserted_skip_or_only:${baseInserts.length}->${candidateInserts.length}`,
    );
  }

  return {
    weakened: reasons.length > 0,
    reasons,
    base_assertion_count: baseCount,
    candidate_assertion_count: candidateCount,
  };
}

// ============================================================================
// TASK-P0.4: 测试分类、基线还原、隔离重跑核心实现
// ============================================================================

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const errorObj = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
      code?: number;
    };
    return {
      stdout: errorObj.stdout ?? "",
      stderr: errorObj.stderr ?? errorObj.message ?? String(err),
      exitCode: typeof errorObj.code === "number" ? errorObj.code : 1,
    };
  }
}

export interface TestPathClassification {
  modifiedExistingTests: string[];
  deletedExistingTests: string[];
  addedTests: string[];
  hasExistingTestMutation: boolean;
  weakenedTests: string[];
}

/**
 * 从工作树及 git 历史准确分类被变动的测试文件：
 * - modifiedExistingTests：基线已存在且被修改的测试文件
 * - deletedExistingTests：基线已存在且在候选工作树中被删除的测试文件
 * - addedTests：Worker 新增的测试文件（基线不存在）
 * - hasExistingTestMutation：是否动了既有测试
 * - weakenedTests：被弱化的既有测试
 */
export async function classifyTouchedTestPaths(options: {
  worktreePath: string;
  baseRef: string;
  candidatePaths?: string[];
}): Promise<TestPathClassification> {
  const { worktreePath, baseRef } = options;
  const pathsSet = new Set<string>();

  // 若传入了 candidatePaths，先过滤
  if (options.candidatePaths) {
    for (const p of options.candidatePaths) {
      if (isTestPath(p)) {
        pathsSet.add(normalizeTestRelPath(p));
      }
    }
  }

  // 1. 从 git status 捕获变更
  const statusRes = await runGit(
    ["status", "--porcelain", "-uall"],
    worktreePath,
  );
  if (statusRes.exitCode === 0) {
    for (const line of statusRes.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const p = line.slice(3).trim();
      if (p.includes("->")) {
        const parts = p.split("->").map((s) => s.trim());
        if (parts[0] && isTestPath(parts[0]))
          pathsSet.add(normalizeTestRelPath(parts[0]));
        if (parts[1] && isTestPath(parts[1]))
          pathsSet.add(normalizeTestRelPath(parts[1]));
      } else if (p && isTestPath(p)) {
        pathsSet.add(normalizeTestRelPath(p));
      }
    }
  }

  // 2. 从 git diff 捕获分支相对于 baseRef 的变更
  let diffRes = await runGit(
    ["diff", "--name-status", "-M", `${baseRef}...HEAD`],
    worktreePath,
  );
  if (diffRes.exitCode !== 0) {
    diffRes = await runGit(
      ["diff", "--name-status", "-M", baseRef, "HEAD"],
      worktreePath,
    );
  }
  if (diffRes.exitCode === 0) {
    for (const line of diffRes.stdout.split("\n")) {
      const parts = line.trim().split(/\t+/);
      if (parts.length >= 2) {
        if (parts[1] && isTestPath(parts[1]))
          pathsSet.add(normalizeTestRelPath(parts[1]));
        if (parts[2] && isTestPath(parts[2]))
          pathsSet.add(normalizeTestRelPath(parts[2]));
      }
    }
  }

  const modifiedExistingTests: string[] = [];
  const deletedExistingTests: string[] = [];
  const addedTests: string[] = [];
  const weakenedTests: string[] = [];

  for (const relPath of pathsSet) {
    // 检查文件在 baseRef 是否存在
    const catRes = await runGit(
      ["cat-file", "-e", `${baseRef}:${relPath}`],
      worktreePath,
    );
    const existedInBase = catRes.exitCode === 0;

    const fullPath = path.join(worktreePath, relPath);
    const existsOnDisk = fs.existsSync(fullPath);

    if (existedInBase) {
      if (!existsOnDisk) {
        deletedExistingTests.push(relPath);
      } else {
        const baseContentRes = await runGit(
          ["show", `${baseRef}:${relPath}`],
          worktreePath,
        );
        const baseContent = baseContentRes.stdout;
        const currentContent = fs.readFileSync(fullPath, "utf-8");

        if (baseContent !== currentContent) {
          modifiedExistingTests.push(relPath);
          const ext = path.extname(relPath).replace(/^\./, "").toLowerCase();
          const lang: TestIntegrityLang =
            ext === "ts" ||
            ext === "tsx" ||
            ext === "js" ||
            ext === "jsx" ||
            ext === "py" ||
            ext === "go" ||
            ext === "rs"
              ? (ext as TestIntegrityLang)
              : "ts";
          const weakening = detectTestWeakening(
            baseContent,
            currentContent,
            lang,
          );
          if (weakening.weakened) {
            weakenedTests.push(relPath);
          }
        }
      }
    } else {
      if (existsOnDisk) {
        addedTests.push(relPath);
      }
    }
  }

  return {
    modifiedExistingTests: modifiedExistingTests.sort(),
    deletedExistingTests: deletedExistingTests.sort(),
    addedTests: addedTests.sort(),
    hasExistingTestMutation:
      modifiedExistingTests.length > 0 || deletedExistingTests.length > 0,
    weakenedTests: weakenedTests.sort(),
  };
}

export interface RestoredBaselineState {
  revert: () => Promise<void>;
  restoredPaths: string[];
}

/**
 * 仅将受影响的被修改/被删除既有测试文件还原至 baseRef 版本。
 * 返回 revert 函数用于在重跑结束后恢复候选状态。
 */
export async function restoreBaselineTestFiles(options: {
  worktreePath: string;
  baseRef: string;
  pathsToRestore: string[];
}): Promise<RestoredBaselineState> {
  const { worktreePath, baseRef, pathsToRestore } = options;
  const originalStates: Array<{
    relPath: string;
    existed: boolean;
    content?: string;
  }> = [];

  for (const relPath of pathsToRestore) {
    const fullPath = path.join(worktreePath, relPath);
    const existed = fs.existsSync(fullPath);
    originalStates.push({
      relPath,
      existed,
      ...(existed ? { content: fs.readFileSync(fullPath, "utf-8") } : {}),
    });

    const showRes = await runGit(
      ["show", `${baseRef}:${relPath}`],
      worktreePath,
    );
    if (showRes.exitCode === 0) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, showRes.stdout, "utf-8");
    }
  }

  const revert = async () => {
    for (const state of originalStates) {
      const fullPath = path.join(worktreePath, state.relPath);
      if (state.existed && state.content !== undefined) {
        fs.writeFileSync(fullPath, state.content, "utf-8");
      } else if (!state.existed && fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }
  };

  return {
    revert,
    restoredPaths: [...pathsToRestore],
  };
}

export interface HiddenAddedTestsState {
  revert: () => Promise<void>;
  hiddenPaths: string[];
}

/**
 * 临时隐藏 Worker 新增的测试文件（重命名为 .stagent-p04-added.bak），
 * 确保通用测试运行器（如 vitest run / pytest）在基线重跑时不执行新增测试。
 */
export async function hideWorkerAddedTests(options: {
  worktreePath: string;
  addedTests: string[];
}): Promise<HiddenAddedTestsState> {
  const { worktreePath, addedTests } = options;
  const hiddenPairs: Array<{ original: string; hidden: string }> = [];

  for (const relPath of addedTests) {
    const fullPath = path.join(worktreePath, relPath);
    if (fs.existsSync(fullPath)) {
      const hiddenPath = `${fullPath}.stagent-p04-added.bak`;
      fs.renameSync(fullPath, hiddenPath);
      hiddenPairs.push({ original: fullPath, hidden: hiddenPath });
    }
  }

  const revert = async () => {
    for (const pair of hiddenPairs) {
      if (fs.existsSync(pair.hidden)) {
        fs.renameSync(pair.hidden, pair.original);
      }
    }
  };

  return {
    revert,
    hiddenPaths: hiddenPairs.map((p) =>
      path.relative(worktreePath, p.original),
    ),
  };
}

export interface BaselineRerunResult {
  triggered: boolean;
  passed: boolean;
  failure_code?: "E_TEST_BASELINE_REGRESSION" | "E_TEST_BASELINE_UNAVAILABLE";
  failure_reason?: string;
  restored_paths: string[];
}

/**
 * 执行基线隔离重跑：
 * 1. 还原被修改与被删除的既有测试文件至 baseRef；
 * 2. 隐藏 Worker 新增测试文件，使其不参与重跑；
 * 3. 运行验证命令；
 * 4. 出现命令执行异常/超时/找不到命令 fail-closed 返回 E_TEST_BASELINE_UNAVAILABLE；
 * 5. 退出码不符合预期 fail-closed 返回 E_TEST_BASELINE_REGRESSION；
 * 6. 最终在 finally 中还原测试文件现场。
 */
export async function executeBaselineRerun(options: {
  worktreePath: string;
  baseRef: string;
  classification: TestPathClassification;
  verificationCommands: VerificationCommand[];
  runCommand?: (cmd: {
    executable: string;
    args: string[];
    timeoutSeconds?: number;
  }) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
  }>;
}): Promise<BaselineRerunResult> {
  const {
    worktreePath,
    baseRef,
    classification,
    verificationCommands,
    runCommand,
  } = options;

  const affectedPaths = [
    ...classification.modifiedExistingTests,
    ...classification.deletedExistingTests,
  ];

  if (affectedPaths.length === 0) {
    return {
      triggered: false,
      passed: true,
      restored_paths: [],
    };
  }

  const restoredState = await restoreBaselineTestFiles({
    worktreePath,
    baseRef,
    pathsToRestore: affectedPaths,
  });

  const hiddenState = await hideWorkerAddedTests({
    worktreePath,
    addedTests: classification.addedTests,
  });

  try {
    let testCommands = verificationCommands.filter((c) => {
      const alias = c.alias.toLowerCase();
      const exec = c.executable.toLowerCase();
      const argsStr = c.args.join(" ").toLowerCase();
      return (
        alias.includes("test") ||
        alias.includes("unit") ||
        alias.includes("spec") ||
        alias.includes("verify") ||
        exec.includes("test") ||
        exec.includes("vitest") ||
        exec.includes("jest") ||
        exec.includes("pytest") ||
        argsStr.includes("test") ||
        argsStr.includes("vitest") ||
        argsStr.includes("jest") ||
        argsStr.includes("pytest") ||
        exec === "node"
      );
    });

    if (testCommands.length === 0) {
      testCommands = [...verificationCommands];
    }

    const defaultRunner = async (cmd: {
      executable: string;
      args: string[];
      timeoutSeconds?: number;
    }) => {
      const timeoutMs = (cmd.timeoutSeconds ?? 30) * 1000;
      try {
        const { stdout, stderr } = await execFileAsync(
          cmd.executable,
          cmd.args,
          {
            cwd: worktreePath,
            encoding: "utf-8",
            timeout: timeoutMs,
            env: { ...process.env },
          },
        );
        return { exitCode: 0, stdout, stderr, timedOut: false };
      } catch (err: unknown) {
        const errorObj = err as {
          killed?: boolean;
          signal?: string;
          code?: number | string;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        const timedOut = Boolean(
          errorObj.killed && errorObj.signal === "SIGTERM",
        );
        const isEnoent = errorObj.code === "ENOENT";
        return {
          exitCode:
            typeof errorObj.code === "number"
              ? errorObj.code
              : timedOut
                ? 124
                : isEnoent
                  ? 127
                  : 1,
          stdout: errorObj.stdout || "",
          stderr: errorObj.stderr || errorObj.message || "",
          timedOut,
        };
      }
    };

    const runner = runCommand ?? defaultRunner;

    for (const cmd of testCommands) {
      const filteredArgs = cmd.args.filter((arg) => {
        const norm = normalizeTestRelPath(arg);
        return !classification.addedTests.includes(norm);
      });

      let outcome;
      try {
        outcome = await runner({
          executable: cmd.executable,
          args: filteredArgs,
          timeoutSeconds: cmd.timeout_seconds ?? 30,
        });
      } catch (execErr: unknown) {
        const msg =
          execErr instanceof Error ? execErr.message : String(execErr);
        return {
          triggered: true,
          passed: false,
          failure_code: "E_TEST_BASELINE_UNAVAILABLE",
          failure_reason: `Baseline rerun execution error: ${msg}`,
          restored_paths: affectedPaths,
        };
      }

      if (outcome.timedOut) {
        return {
          triggered: true,
          passed: false,
          failure_code: "E_TEST_BASELINE_UNAVAILABLE",
          failure_reason: `Baseline test command '${cmd.alias}' timed out after ${cmd.timeout_seconds ?? 30}s`,
          restored_paths: affectedPaths,
        };
      }

      const stderr = (outcome.stderr || "").toLowerCase();
      if (
        outcome.exitCode === 127 ||
        (outcome.exitCode !== 0 &&
          (stderr.includes("cannot find module") ||
            stderr.includes("command not found") ||
            stderr.includes("enoent") ||
            stderr.includes("not found")))
      ) {
        return {
          triggered: true,
          passed: false,
          failure_code: "E_TEST_BASELINE_UNAVAILABLE",
          failure_reason: `Baseline test environment unavailable: ${outcome.stderr}`,
          restored_paths: affectedPaths,
        };
      }

      const expectedCode = cmd.expected_exit_code ?? 0;
      if (outcome.exitCode !== expectedCode) {
        return {
          triggered: true,
          passed: false,
          failure_code: "E_TEST_BASELINE_REGRESSION",
          failure_reason: `Baseline test '${cmd.alias}' regression: exit code ${outcome.exitCode} (expected ${expectedCode}). stderr: ${outcome.stderr}`,
          restored_paths: affectedPaths,
        };
      }
    }

    return {
      triggered: true,
      passed: true,
      restored_paths: affectedPaths,
    };
  } finally {
    await hiddenState.revert();
    await restoredState.revert();
  }
}
