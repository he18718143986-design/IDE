import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  generateTaskBranch,
  validateTaskBranchOperation,
} from "./branch-guard";
import { assertIsolatedGitCwd, isTestRuntime } from "./test-isolation";
import {
  buildDirtyAckGuidance,
  recordAcknowledgedDirtyExclusions,
  type DirtyAckGuidance,
} from "../baseline/dirty-guidance";

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

export interface WorktreeInfo {
  contractId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
  /** 创建过程中的用户提示（例如主工作区存在未提交变更） */
  warnings: string[];
}

/** 主工作区存在未提交变更，需用户显式确认后才能创建 Worktree（规范 A.1 PASS-3 / TASK-H.6） */
export class DirtyWorktreeConfirmationRequiredError extends WorktreeError {
  readonly dirtyFiles: string[];
  readonly guidance: DirtyAckGuidance;
  constructor(dirtyFiles: string[]) {
    const guidance = buildDirtyAckGuidance(dirtyFiles);
    super(guidance.plain_message);
    this.name = "DirtyWorktreeConfirmationRequiredError";
    this.dirtyFiles = dirtyFiles;
    this.guidance = guidance;
  }
}

export interface WorktreeListEntry {
  worktree: string;
  head: string;
  branch?: string;
  bare?: boolean;
}

/** `git config` 的写操作标志位（读取标志优先判定，避免把 `--get` 误判成写入） */
const GIT_CONFIG_WRITE_FLAGS = new Set([
  "--add",
  "--unset",
  "--unset-all",
  "--replace-all",
  "--rename-section",
  "--remove-section",
  "--edit",
  "-e",
]);

const GIT_CONFIG_READ_FLAGS = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--get-urlmatch",
  "--list",
  "-l",
  "--show-origin",
  "--show-scope",
]);

/**
 * 判断是否为 `git config` 的**写入**（而非读取）。
 * 口径：出现写标志位，或除选项外还有 ≥2 个位置参数（`name value`）。
 */
export function isGitConfigWrite(args: string[]): boolean {
  if (args[0] !== "config") return false;
  if (args.some((arg) => GIT_CONFIG_WRITE_FLAGS.has(arg))) return true;
  if (args.some((arg) => GIT_CONFIG_READ_FLAGS.has(arg))) return false;
  // `git config [<file-option>] name [value]`：位置参数 ≥2 即写入
  const positional = args.slice(1).filter((arg) => !arg.startsWith("-"));
  return positional.length >= 2;
}

/** 会改动 git 状态（refs / index / 工作区 / 配置）的子命令 */
const MUTATING_GIT_SUBCOMMANDS = new Set([
  "init",
  "add",
  "commit",
  "rm",
  "mv",
  "reset",
  "checkout",
  "switch",
  "restore",
  "branch",
  "tag",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "apply",
  "am",
  "stash",
  "clean",
  "worktree",
  "gc",
  "prune",
  "submodule",
  "update-ref",
  "notes",
  "replace",
]);

export function isMutatingGitCommand(args: string[]): boolean {
  if (args.length === 0) return false;
  if (isGitConfigWrite(args)) return true;
  return MUTATING_GIT_SUBCOMMANDS.has(args[0] as string);
}

/**
 * 执行前的 cwd 安全检查（fail-closed）。两道：
 *
 * 1. **`git config` 写入：无条件**必须在隔离目录。生产代码里没有任何一处写 config，
 *    所以这条不会伤到 Daemon 的正常流程；一旦有人写，就必须显式落在临时目录。
 * 2. **测试运行时（Vitest / NODE_ENV=test）的任何写操作**都不许指向宿主仓库根。
 *    生产运行时不受此条约束——它本来就是要在真实仓库里建 Worktree、提交、合并。
 */
export function assertSafeGitCwd(
  args: string[],
  cwd: string | undefined,
): void {
  if (isGitConfigWrite(args)) {
    assertIsolatedGitCwd(cwd);
    return;
  }
  if (isTestRuntime() && isMutatingGitCommand(args)) {
    assertIsolatedGitCwd(cwd);
  }
}

/**
 * Execute Git command in target working directory.
 * 默认仅 trimEnd（保留行首空格，porcelain 依赖它）；raw=true 时连尾部换行也不剥。
 *
 * 声明为 `async` 是为了让守卫的同步抛错自动变成 rejected promise，
 * 调用方用 `await expect(...).rejects` 就能断言到。
 */
export function execGitSync(
  args: string[],
  cwd: string,
  options: { raw?: boolean } = {},
): { stdout: string; stderr: string; exitCode: number } {
  assertSafeGitCwd(args, cwd);
  const result = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf-8",
  });
  return {
    stdout: options.raw
      ? (result.stdout ?? "")
      : (result.stdout ?? "").trimEnd(),
    stderr: options.raw
      ? (result.stderr ?? "")
      : (result.stderr ?? "").trimEnd(),
    exitCode: result.status ?? 0,
  };
}

export async function execGit(
  args: string[],
  cwd: string,
  options: { raw?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  assertSafeGitCwd(args, cwd);

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      // porcelain 行首空格是 XY 状态码的一部分（如 ` M styles.css`）。
      // 绝不能 stdout.trim()，否则首行未暂存改动会丢前导空格 → 漏计或切成 tyles.css。
      resolve({
        stdout: options.raw ? stdout : stdout.trimEnd(),
        stderr: options.raw ? stderr : stderr.trimEnd(),
        exitCode: code ?? 0,
      });
    });
  });
}

/**
 * Validate contract ID safety: alphanumeric, hyphen, underscore only.
 * Strictly prevents path traversal attacks like '../' or leading slashes.
 */
export function assertSafeContractId(contractId: string): void {
  if (!contractId || !/^[a-zA-Z0-9_-]+$/.test(contractId)) {
    throw new WorktreeError(
      `Invalid contract ID '${contractId}'. Only alphanumeric characters, dashes, and underscores are permitted.`,
    );
  }
}

/**
 * Get standardized physical path for task worktree.
 * Guarantees that the resulting path is strictly confined within `<repoRoot>/.stagent/worktrees/`.
 */
export function getWorktreePath(repoRoot: string, contractId: string): string {
  assertSafeContractId(contractId);
  // 规范化绝对路径：macOS 上 /var 与 /private/var 为同一物理目录，
  // 必须与 `git worktree list` 输出的 realpath 保持一致（规范 A.1 PASS-1）。
  const resolvedRoot = fs.existsSync(repoRoot)
    ? fs.realpathSync(repoRoot)
    : path.resolve(repoRoot);
  const worktreesDir = path.resolve(resolvedRoot, ".stagent", "worktrees");
  const targetPath = path.resolve(worktreesDir, `task-${contractId}`);

  // Defense-in-depth path traversal verification
  if (!targetPath.startsWith(worktreesDir + path.sep)) {
    throw new WorktreeError(
      `Path traversal detected: worktree path '${targetPath}' escapes root directory.`,
    );
  }

  return targetPath;
}

/**
 * Check if the repository working tree has uncommitted dirty changes.
 */
export async function isRepoClean(repoRoot: string): Promise<boolean> {
  const { stdout, exitCode } = await execGit(
    ["status", "--porcelain"],
    repoRoot,
  );
  if (exitCode !== 0) {
    throw new WorktreeError(
      `Failed to inspect repository status in ${repoRoot}`,
    );
  }
  return stdout.length === 0;
}

/**
 * 检查主工作区未提交变更，返回可展示给用户的明确提示（不修改、不复制、不 reset）。
 */
export async function inspectMainWorktree(
  repoRoot: string,
): Promise<{ clean: boolean; files: string[]; warning?: string }> {
  const { stdout, exitCode } = await execGit(
    ["status", "--porcelain"],
    repoRoot,
  );
  if (exitCode !== 0) {
    throw new WorktreeError(
      `Failed to inspect repository status in ${repoRoot}`,
    );
  }
  const files = stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => {
      // porcelain v1: XY<space>path — 保留行首空格，只剥 3 字符前缀
      if (l.length < 4) return "";
      let p = l.slice(3);
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4);
      return p.replace(/^"|"$/g, "").trimEnd();
    })
    .filter(Boolean);

  if (files.length === 0) return { clean: true, files: [] };
  return {
    clean: false,
    files,
    warning: `主工作区存在 ${files.length} 项未提交变更，这些修改不会包含在任务 Worktree 中；任务将基于合同 base_branch 的 HEAD 独立检出。`,
  };
}

/**
 * Create an isolated Git Worktree for a contract task.
 * 1. Checks host repository dirty status and requires explicit user acknowledgement.
 * 2. Prunes any stale worktree references.
 * 3. Creates worktree at `.stagent/worktrees/task-{contractId}` bound to `task/{contractId}` branch.
 */

/**
 * Ensure .stagent/ is registered in .git/info/exclude so it never dirties
 * the host repository git status, without modifying tracked .gitignore.
 */
export function ensureStagentExcluded(repoRoot: string): void {
  const resolvedRoot = path.resolve(repoRoot);
  const excludePath = path.resolve(resolvedRoot, ".git", "info", "exclude");
  if (fs.existsSync(path.dirname(excludePath))) {
    let content = "";
    if (fs.existsSync(excludePath)) {
      content = fs.readFileSync(excludePath, "utf-8");
    }
    if (!content.includes(".stagent")) {
      fs.appendFileSync(
        excludePath,
        "\n# Stagent runtime\n.stagent/\n",
        "utf-8",
      );
    }
  }
}

export async function createTaskWorktree(options: {
  repoRoot: string;
  contractId: string;
  baseBranch?: string;
  force?: boolean;
  /** 用户已确认「主工作区未提交变更不纳入任务」，才允许在脏工作区上继续 */
  acknowledgeDirty?: boolean;
}): Promise<WorktreeInfo> {
  const {
    repoRoot,
    contractId,
    baseBranch = "HEAD",
    force = false,
    acknowledgeDirty = false,
  } = options;
  const resolvedRoot = path.resolve(repoRoot);
  const worktreePath = getWorktreePath(resolvedRoot, contractId);
  const branch = generateTaskBranch(contractId);

  validateTaskBranchOperation(branch);
  // 先注册 .stagent/ 排除，再做脏检查，避免自建目录被误判为用户未提交变更
  ensureStagentExcluded(resolvedRoot);

  // 规范 A.1 PASS-3：脏工作区必须提示并等待用户确认，绝不静默复制或 reset
  const inspection = await inspectMainWorktree(resolvedRoot);
  if (!inspection.clean && !acknowledgeDirty) {
    throw new DirtyWorktreeConfirmationRequiredError(inspection.files);
  }
  // TASK-H.6：确认后脏路径写入禁写/排除清单
  if (!inspection.clean && acknowledgeDirty && inspection.files.length > 0) {
    recordAcknowledgedDirtyExclusions(resolvedRoot, inspection.files);
  }
  const warnings = inspection.warning ? [inspection.warning] : [];

  const worktreesDir = path.dirname(worktreePath);
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  // Prune any stale worktree references first
  await execGit(["worktree", "prune"], resolvedRoot);

  // If path already exists or is locked
  if (fs.existsSync(worktreePath)) {
    if (!force) {
      throw new WorktreeError(
        `Worktree path already exists at '${worktreePath}'. Use force=true to rebuild.`,
      );
    }
    // Force cleanup existing worktree
    await execGit(
      ["worktree", "remove", "--force", worktreePath],
      resolvedRoot,
    );
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    await execGit(["worktree", "prune"], resolvedRoot);
  }

  // Check if branch already exists
  const branchCheck = await execGit(
    ["rev-parse", "--verify", `refs/heads/${branch}`],
    resolvedRoot,
  );
  const branchExists = branchCheck.exitCode === 0;

  if (branchExists && force) {
    await execGit(["branch", "-D", branch], resolvedRoot);
  }

  const addArgs = ["worktree", "add"];
  if (branchExists && !force) {
    // Check out existing branch
    addArgs.push(worktreePath, branch);
  } else {
    // Create new task branch from baseBranch
    addArgs.push("-b", branch, worktreePath, baseBranch);
  }

  const result = await execGit(addArgs, resolvedRoot);
  if (result.exitCode !== 0) {
    throw new WorktreeError(
      `Failed to create git worktree at '${worktreePath}': ${result.stderr || result.stdout}`,
    );
  }

  return {
    contractId,
    worktreePath,
    branch,
    baseBranch,
    createdAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Remove task worktree and clean up references.
 */
export async function removeTaskWorktree(options: {
  repoRoot: string;
  contractId: string;
  force?: boolean;
  deleteBranch?: boolean;
}): Promise<void> {
  const { repoRoot, contractId, force = true, deleteBranch = false } = options;
  const resolvedRoot = path.resolve(repoRoot);
  const worktreePath = getWorktreePath(resolvedRoot, contractId);
  const branch = generateTaskBranch(contractId);

  const removeArgs = ["worktree", "remove"];
  if (force) {
    removeArgs.push("--force");
  }
  removeArgs.push(worktreePath);

  await execGit(removeArgs, resolvedRoot);

  if (fs.existsSync(worktreePath)) {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Ignore removal errors
    }
  }

  await execGit(["worktree", "prune"], resolvedRoot);

  if (deleteBranch) {
    await execGit(["branch", "-D", branch], resolvedRoot);
  }
}

/**
 * List all active worktrees registered with the repository.
 */
export async function listWorktrees(
  repoRoot: string,
): Promise<WorktreeListEntry[]> {
  const resolvedRoot = path.resolve(repoRoot);
  const { stdout, exitCode, stderr } = await execGit(
    ["worktree", "list", "--porcelain"],
    resolvedRoot,
  );

  if (exitCode !== 0) {
    throw new WorktreeError(`Failed to list worktrees: ${stderr}`);
  }

  const entries: WorktreeListEntry[] = [];
  const blocks = stdout.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    let currentWorktree = "";
    let currentHead = "";
    let currentBranch: string | undefined;
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        currentWorktree = line.substring("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        currentHead = line.substring("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        currentBranch = line.substring("branch ".length).trim();
      } else if (line === "bare") {
        isBare = true;
      }
    }

    if (currentWorktree) {
      const entry: WorktreeListEntry = {
        worktree: currentWorktree,
        head: currentHead,
      };
      if (currentBranch) {
        entry.branch = currentBranch;
      }
      if (isBare) {
        entry.bare = true;
      }
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Resolve a base ref that actually exists (TASK-C.10p).
 *
 * Graph start/verify may run long after approve/merge: the contract's
 * `authorization.git.base_branch` can already be deleted. Prefer the
 * preferred ref when present, else `main` / `master` / `HEAD`.
 */
export async function resolveExistingBaseBranch(
  repoRoot: string,
  preferred?: string | null,
): Promise<string> {
  const resolvedRoot = path.resolve(repoRoot);
  const candidates = [
    ...(typeof preferred === "string" && preferred.trim() !== ""
      ? [preferred.trim()]
      : []),
    "main",
    "master",
    "HEAD",
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const check = await execGit(
      ["rev-parse", "--verify", candidate],
      resolvedRoot,
    );
    if (check.exitCode === 0) return candidate;
  }
  return "HEAD";
}

export interface EnsureTaskWorktreeResult {
  worktreePath: string;
  /** true = 本次新建或 force 重建；false = 路径已存在直接复用 */
  created: boolean;
  baseBranch: string;
  warnings: string[];
}

/**
 * Ensure the task worktree directory exists for graph start/verify (TASK-C.10p).
 *
 * Approve normally creates the worktree; after MERGED / cleanup / crash it may
 * be gone while the task graph still points at the contract. Graph UX must
 * rebuild rather than 409 "Worktree 不存在".
 *
 * - Path already present → reuse (no force).
 * - Missing → `createTaskWorktree` with `acknowledgeDirty: true` (main dirty
 *   files are never copied into the task tree; graph must not block on them).
 * - Create fails because a stale path/lock remains → one `force: true` retry.
 */
export async function ensureTaskWorktree(options: {
  repoRoot: string;
  contractId: string;
  preferredBaseBranch?: string | null;
}): Promise<EnsureTaskWorktreeResult> {
  const { repoRoot, contractId, preferredBaseBranch } = options;
  const worktreePath = getWorktreePath(repoRoot, contractId);
  if (fs.existsSync(worktreePath)) {
    const baseBranch = await resolveExistingBaseBranch(
      repoRoot,
      preferredBaseBranch,
    );
    return {
      worktreePath,
      created: false,
      baseBranch,
      warnings: [],
    };
  }

  const baseBranch = await resolveExistingBaseBranch(
    repoRoot,
    preferredBaseBranch,
  );

  try {
    const info = await createTaskWorktree({
      repoRoot,
      contractId,
      baseBranch,
      acknowledgeDirty: true,
    });
    return {
      worktreePath: info.worktreePath,
      created: true,
      baseBranch: info.baseBranch,
      warnings: info.warnings ?? [],
    };
  } catch (err) {
    // Stale registration / half-removed directory: rebuild once.
    const message = err instanceof Error ? err.message : String(err);
    if (!/already exists|not a working tree|locked/i.test(message)) {
      throw err;
    }
    const info = await createTaskWorktree({
      repoRoot,
      contractId,
      baseBranch,
      force: true,
      acknowledgeDirty: true,
    });
    return {
      worktreePath: info.worktreePath,
      created: true,
      baseBranch: info.baseBranch,
      warnings: info.warnings ?? [],
    };
  }
}

/**
 * Run git worktree prune to discard stale administrative data.
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(repoRoot);
  await execGit(["worktree", "prune"], resolvedRoot);
}
