import fs from "node:fs";
import path from "node:path";
import type { VerificationCommand } from "../../src/lib/contract.schema";
import {
  classifyTestAssetKind,
  isTestAsset,
  normalizeAssetRelPath,
  type TestAssetKind,
} from "../../src/lib/test-asset-manifest";

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
// TASK-P0.4: 测试分类、基线还原、隔离重跑核心实现（纯函数 / 依赖注入）
// ============================================================================

export type GitRunner = (
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface NarrowCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type BaselineCommandRunner = (cmd: {
  executable: string;
  args: string[];
  timeoutSeconds?: number;
}) => Promise<NarrowCommandResult>;

export interface TestPathClassification {
  modifiedExistingTests: string[];
  deletedExistingTests: string[];
  addedTests: string[];
  hasExistingTestMutation: boolean;
  weakenedTests: string[];
  /** TASK-P0.14: 被修改或删除的测试配置文件列表 */
  modifiedTestConfigs: string[];
  /** TASK-P0.14: 被修改或删除的测试夹具与辅助库列表 */
  modifiedFixturesAndHelpers: string[];
  /** TASK-P0.14: 未在基线清单中登记的新增测试资产 */
  unregisteredAssets: string[];
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
  gitRunner: GitRunner;
}): Promise<TestPathClassification> {
  const { worktreePath, baseRef, gitRunner } = options;
  const pathsSet = new Set<string>();

  // 若传入了 candidatePaths，先过滤
  if (options.candidatePaths) {
    for (const p of options.candidatePaths) {
      if (isTestAsset(p) || isTestPath(p)) {
        pathsSet.add(normalizeAssetRelPath(p));
      }
    }
  }

  // 1. 从 git status 捕获变更
  const statusRes = await gitRunner(
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
        if (parts[0] && (isTestAsset(parts[0]) || isTestPath(parts[0])))
          pathsSet.add(normalizeAssetRelPath(parts[0]));
        if (parts[1] && (isTestAsset(parts[1]) || isTestPath(parts[1])))
          pathsSet.add(normalizeAssetRelPath(parts[1]));
      } else if (p && (isTestAsset(p) || isTestPath(p))) {
        pathsSet.add(normalizeAssetRelPath(p));
      }
    }
  }

  // 2. 从 git diff 捕获分支相对于 baseRef 的变更
  let diffRes = await gitRunner(
    ["diff", "--name-status", "-M", `${baseRef}...HEAD`],
    worktreePath,
  );
  if (diffRes.exitCode !== 0) {
    diffRes = await gitRunner(
      ["diff", "--name-status", "-M", baseRef, "HEAD"],
      worktreePath,
    );
  }
  if (diffRes.exitCode === 0) {
    for (const line of diffRes.stdout.split("\n")) {
      const parts = line.trim().split(/\t+/);
      if (parts.length >= 2) {
        if (parts[1] && (isTestAsset(parts[1]) || isTestPath(parts[1])))
          pathsSet.add(normalizeAssetRelPath(parts[1]));
        if (parts[2] && (isTestAsset(parts[2]) || isTestPath(parts[2])))
          pathsSet.add(normalizeAssetRelPath(parts[2]));
      }
    }
  }

  const modifiedExistingTests: string[] = [];
  const deletedExistingTests: string[] = [];
  const addedTests: string[] = [];
  const weakenedTests: string[] = [];
  const modifiedTestConfigs: string[] = [];
  const modifiedFixturesAndHelpers: string[] = [];
  const unregisteredAssets: string[] = [];

  for (const relPath of pathsSet) {
    const assetKind = classifyTestAssetKind(relPath);

    // 检查文件在 baseRef 是否存在
    const catRes = await gitRunner(
      ["cat-file", "-e", `${baseRef}:${relPath}`],
      worktreePath,
    );
    const existedInBase = catRes.exitCode === 0;

    const fullPath = path.join(worktreePath, relPath);
    const existsOnDisk = fs.existsSync(fullPath);

    if (assetKind === "config") {
      if (existedInBase) {
        if (!existsOnDisk) {
          modifiedTestConfigs.push(relPath);
        } else {
          const baseContentRes = await gitRunner(
            ["show", `${baseRef}:${relPath}`],
            worktreePath,
          );
          const currentContent = fs.readFileSync(fullPath, "utf-8");
          if (baseContentRes.stdout !== currentContent) {
            modifiedTestConfigs.push(relPath);
          }
        }
      } else if (existsOnDisk) {
        modifiedTestConfigs.push(relPath);
        unregisteredAssets.push(relPath);
      }
      continue;
    }

    if (assetKind === "fixture" || assetKind === "helper") {
      if (existedInBase) {
        if (!existsOnDisk) {
          modifiedFixturesAndHelpers.push(relPath);
        } else {
          const baseContentRes = await gitRunner(
            ["show", `${baseRef}:${relPath}`],
            worktreePath,
          );
          const currentContent = fs.readFileSync(fullPath, "utf-8");
          if (baseContentRes.stdout !== currentContent) {
            modifiedFixturesAndHelpers.push(relPath);
          }
        }
      } else if (existsOnDisk) {
        unregisteredAssets.push(relPath);
      }
      continue;
    }

    // 测试套件（test_suite）与通用测试文件
    if (existedInBase) {
      if (!existsOnDisk) {
        deletedExistingTests.push(relPath);
      } else {
        const baseContentRes = await gitRunner(
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
      modifiedExistingTests.length > 0 ||
      deletedExistingTests.length > 0 ||
      modifiedFixturesAndHelpers.length > 0,
    weakenedTests: weakenedTests.sort(),
    modifiedTestConfigs: modifiedTestConfigs.sort(),
    modifiedFixturesAndHelpers: modifiedFixturesAndHelpers.sort(),
    unregisteredAssets: unregisteredAssets.sort(),
  };
}

export interface RecoveryOperationFailure {
  operation: "restore" | "revert" | "hide";
  relPath: string;
  reason: string;
  error?: unknown;
}

/**
 * TASK-P0.13 (Scope D): 基线测试恢复操作明确错误异常。
 * 保留单个或部分文件恢复失败的明细诊断上下文，避免静默吞掉异常。
 */
export class TestBaselineRecoveryError extends Error {
  readonly failures: RecoveryOperationFailure[];
  constructor(message: string, failures: RecoveryOperationFailure[]) {
    super(message);
    this.name = "TestBaselineRecoveryError";
    this.failures = failures;
  }
}

export interface RestoredBaselineState {
  revert: () => Promise<void>;
  restoredPaths: string[];
}

/**
 * 仅将受影响的被修改/被删除既有测试文件还原至 baseRef 版本。
 * TASK-P0.13 (Scope D): 显式检查每个恢复与重命名操作结果；单个失败不静默吞；
 * 部分失败保留可诊断记录；任一文件恢复失败均 fail-closed 阻断。
 * 返回 revert 函数用于在重跑结束后恢复候选状态。
 */
export async function restoreBaselineTestFiles(options: {
  worktreePath: string;
  baseRef: string;
  pathsToRestore: string[];
  gitRunner: GitRunner;
}): Promise<RestoredBaselineState> {
  const { worktreePath, baseRef, pathsToRestore, gitRunner } = options;
  const originalStates: Array<{
    relPath: string;
    existed: boolean;
    content?: string;
  }> = [];
  const restoreFailures: RecoveryOperationFailure[] = [];

  for (const relPath of pathsToRestore) {
    const fullPath = path.join(worktreePath, relPath);
    try {
      const existed = fs.existsSync(fullPath);
      originalStates.push({
        relPath,
        existed,
        ...(existed ? { content: fs.readFileSync(fullPath, "utf-8") } : {}),
      });

      const showRes = await gitRunner(
        ["show", `${baseRef}:${relPath}`],
        worktreePath,
      );
      if (showRes.exitCode === 0) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, showRes.stdout, "utf-8");
      } else {
        restoreFailures.push({
          operation: "restore",
          relPath,
          reason: `git show ${baseRef}:${relPath} exited with code ${showRes.exitCode}: ${showRes.stderr || "unknown error"}`,
        });
      }
    } catch (err: unknown) {
      restoreFailures.push({
        operation: "restore",
        relPath,
        reason: err instanceof Error ? err.message : String(err),
        error: err,
      });
    }
  }

  // TASK-P0.13: 准备阶段任一文件还原失败，尽力回退已写文件并抛出明确异常
  if (restoreFailures.length > 0) {
    for (const state of originalStates) {
      try {
        const fullPath = path.join(worktreePath, state.relPath);
        if (state.existed && state.content !== undefined) {
          fs.writeFileSync(fullPath, state.content, "utf-8");
        } else if (!state.existed && fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // ignore best-effort rollback
      }
    }
    const details = restoreFailures
      .map((f) => `${f.relPath} (${f.reason})`)
      .join("; ");
    throw new TestBaselineRecoveryError(
      `Failed to restore baseline test files: ${details}`,
      restoreFailures,
    );
  }

  const revert = async () => {
    const revertFailures: RecoveryOperationFailure[] = [];
    for (const state of originalStates) {
      try {
        const fullPath = path.join(worktreePath, state.relPath);
        if (state.existed && state.content !== undefined) {
          fs.writeFileSync(fullPath, state.content, "utf-8");
        } else if (!state.existed && fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (err: unknown) {
        revertFailures.push({
          operation: "revert",
          relPath: state.relPath,
          reason: err instanceof Error ? err.message : String(err),
          error: err,
        });
      }
    }

    if (revertFailures.length > 0) {
      const details = revertFailures
        .map((f) => `${f.relPath} (${f.reason})`)
        .join("; ");
      throw new TestBaselineRecoveryError(
        `Failed to revert baseline test files: ${details}`,
        revertFailures,
      );
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
 * TASK-P0.13 (Scope D): 显式检查隐藏与还原重命名结果，捕获部分失败与可诊断记录。
 */
export async function hideWorkerAddedTests(options: {
  worktreePath: string;
  addedTests: string[];
}): Promise<HiddenAddedTestsState> {
  const { worktreePath, addedTests } = options;
  const hiddenPairs: Array<{ original: string; hidden: string }> = [];
  const hideFailures: RecoveryOperationFailure[] = [];

  for (const relPath of addedTests) {
    const fullPath = path.join(worktreePath, relPath);
    try {
      if (fs.existsSync(fullPath)) {
        const hiddenPath = `${fullPath}.stagent-p04-added.bak`;
        fs.renameSync(fullPath, hiddenPath);
        hiddenPairs.push({ original: fullPath, hidden: hiddenPath });
      }
    } catch (err: unknown) {
      hideFailures.push({
        operation: "hide",
        relPath,
        reason: err instanceof Error ? err.message : String(err),
        error: err,
      });
    }
  }

  if (hideFailures.length > 0) {
    // 隐藏过程出现部分失败：回滚已重命名文件并抛出明确错误
    for (const pair of hiddenPairs) {
      try {
        if (fs.existsSync(pair.hidden)) {
          fs.renameSync(pair.hidden, pair.original);
        }
      } catch {
        // ignore best-effort rollback
      }
    }
    const details = hideFailures
      .map((f) => `${f.relPath} (${f.reason})`)
      .join("; ");
    throw new TestBaselineRecoveryError(
      `Failed to hide worker added tests: ${details}`,
      hideFailures,
    );
  }

  const revert = async () => {
    const revertFailures: RecoveryOperationFailure[] = [];
    for (const pair of hiddenPairs) {
      const relPath = path.relative(worktreePath, pair.original);
      try {
        if (fs.existsSync(pair.hidden)) {
          fs.renameSync(pair.hidden, pair.original);
        } else if (!fs.existsSync(pair.original)) {
          revertFailures.push({
            operation: "revert",
            relPath,
            reason: `Neither backup file (${path.basename(pair.hidden)}) nor original file exists`,
          });
        }
      } catch (err: unknown) {
        revertFailures.push({
          operation: "revert",
          relPath,
          reason: err instanceof Error ? err.message : String(err),
          error: err,
        });
      }
    }

    if (revertFailures.length > 0) {
      const details = revertFailures
        .map((f) => `${f.relPath} (${f.reason})`)
        .join("; ");
      throw new TestBaselineRecoveryError(
        `Failed to revert hidden worker tests: ${details}`,
        revertFailures,
      );
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
  failure_code?:
    | "E_TEST_BASELINE_REGRESSION"
    | "E_TEST_BASELINE_UNAVAILABLE"
    | "E_TEST_CONFIG_MUTATED";
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
 * 6. 最终显式还原测试文件现场，恢复失败 fail-closed 置为不可用且阻断合并。
 */
export async function executeBaselineRerun(options: {
  worktreePath: string;
  baseRef: string;
  classification: TestPathClassification;
  verificationCommands: VerificationCommand[];
  gitRunner: GitRunner;
  runCommand: BaselineCommandRunner;
  allowTestConfigMutation?: boolean;
}): Promise<BaselineRerunResult> {
  const {
    worktreePath,
    baseRef,
    classification,
    verificationCommands,
    gitRunner,
    runCommand,
  } = options;

  // TASK-P0.14: 若存在未获豁免的测试配置文件篡改，确定性 fail-closed 抛异常/阻断
  if (
    classification.modifiedTestConfigs &&
    classification.modifiedTestConfigs.length > 0 &&
    !options.allowTestConfigMutation
  ) {
    return {
      triggered: false,
      passed: false,
      failure_code: "E_TEST_CONFIG_MUTATED",
      failure_reason: `Test configuration mutated without exemption: ${classification.modifiedTestConfigs.join(", ")}`,
      restored_paths: [],
    };
  }

  // TASK-P0.14: 还原路径集自动纳入被改动/删除的测试夹具与 helper
  const affectedPaths = Array.from(
    new Set([
      ...classification.modifiedExistingTests,
      ...classification.deletedExistingTests,
      ...(classification.modifiedFixturesAndHelpers || []),
    ]),
  ).sort();

  if (affectedPaths.length === 0) {
    return {
      triggered: false,
      passed: true,
      restored_paths: [],
    };
  }

  let restoredState: RestoredBaselineState | undefined;
  try {
    restoredState = await restoreBaselineTestFiles({
      worktreePath,
      baseRef,
      pathsToRestore: affectedPaths,
      gitRunner,
    });
  } catch (restoreErr: unknown) {
    const msg =
      restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
    return {
      triggered: true,
      passed: false,
      failure_code: "E_TEST_BASELINE_UNAVAILABLE",
      failure_reason: `Baseline test workspace restore failed: ${msg}`,
      restored_paths: affectedPaths,
    };
  }

  let hiddenState: HiddenAddedTestsState | undefined;
  try {
    hiddenState = await hideWorkerAddedTests({
      worktreePath,
      addedTests: classification.addedTests,
    });
  } catch (hideErr: unknown) {
    if (restoredState) {
      try {
        await restoredState.revert();
      } catch {
        // ignore best-effort rollback
      }
    }
    const msg = hideErr instanceof Error ? hideErr.message : String(hideErr);
    return {
      triggered: true,
      passed: false,
      failure_code: "E_TEST_BASELINE_UNAVAILABLE",
      failure_reason: `Baseline test workspace isolation failed: ${msg}`,
      restored_paths: affectedPaths,
    };
  }

  let runResult: BaselineRerunResult;

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

    // TASK-P0.13 (Scope C 最小修证): 若动了既有测试但无任何可用验证命令，绝不假绿放行，fail-closed 阻断
    if (testCommands.length === 0) {
      runResult = {
        triggered: true,
        passed: false,
        failure_code: "E_TEST_BASELINE_UNAVAILABLE",
        failure_reason:
          "No verification commands available to execute baseline test rerun",
        restored_paths: affectedPaths,
      };
    } else {
      let commandPassed = true;
      let failureCode:
        | "E_TEST_BASELINE_REGRESSION"
        | "E_TEST_BASELINE_UNAVAILABLE"
        | undefined;
      let failureReason: string | undefined;

      for (const cmd of testCommands) {
        const filteredArgs = cmd.args.filter((arg) => {
          const norm = normalizeTestRelPath(arg);
          return !classification.addedTests.includes(norm);
        });

        let outcome;
        try {
          outcome = await runCommand({
            executable: cmd.executable,
            args: filteredArgs,
            timeoutSeconds: cmd.timeout_seconds ?? 30,
          });
        } catch (execErr: unknown) {
          const msg =
            execErr instanceof Error ? execErr.message : String(execErr);
          commandPassed = false;
          failureCode = "E_TEST_BASELINE_UNAVAILABLE";
          failureReason = `Baseline rerun execution error: ${msg}`;
          break;
        }

        if (outcome.timedOut) {
          commandPassed = false;
          failureCode = "E_TEST_BASELINE_UNAVAILABLE";
          failureReason = `Baseline test command '${cmd.alias}' timed out after ${cmd.timeout_seconds ?? 30}s`;
          break;
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
          commandPassed = false;
          failureCode = "E_TEST_BASELINE_UNAVAILABLE";
          failureReason = `Baseline test environment unavailable: ${outcome.stderr}`;
          break;
        }

        const expectedCode = cmd.expected_exit_code ?? 0;
        if (outcome.exitCode !== expectedCode) {
          commandPassed = false;
          failureCode = "E_TEST_BASELINE_REGRESSION";
          failureReason = `Baseline test '${cmd.alias}' regression: exit code ${outcome.exitCode} (expected ${expectedCode}). stderr: ${outcome.stderr}`;
          break;
        }
      }

      if (commandPassed) {
        runResult = {
          triggered: true,
          passed: true,
          restored_paths: affectedPaths,
        };
      } else {
        runResult = {
          triggered: true,
          passed: false,
          failure_code: failureCode ?? "E_TEST_BASELINE_REGRESSION",
          failure_reason: failureReason ?? "Baseline test command failed",
          restored_paths: affectedPaths,
        };
      }
    }
  } finally {
    // TASK-P0.13 (Scope D): 显式检查并收集现场恢复错误，单个或部分恢复失败绝不静默吞
    const cleanupErrors: string[] = [];
    if (hiddenState) {
      try {
        await hiddenState.revert();
      } catch (err: unknown) {
        cleanupErrors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (restoredState) {
      try {
        await restoredState.revert();
      } catch (err: unknown) {
        cleanupErrors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (cleanupErrors.length > 0) {
      const cleanupMsg = `Recovery cleanup failed: ${cleanupErrors.join("; ")}`;
      if (runResult!.passed) {
        runResult = {
          triggered: true,
          passed: false,
          failure_code: "E_TEST_BASELINE_UNAVAILABLE",
          failure_reason: cleanupMsg,
          restored_paths: affectedPaths,
        };
      } else {
        runResult = {
          ...runResult!,
          failure_reason: `${runResult!.failure_reason}; additionally ${cleanupMsg}`,
        };
      }
    }
  }

  return runResult;
}
