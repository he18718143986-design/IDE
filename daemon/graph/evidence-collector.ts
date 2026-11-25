import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execGit } from "../git/worktree-manager";
import { checkWriteAccess, type FileSystemScope } from "../../src/lib/scope";
import { unquoteGitPath } from "../pipeline/untracked-scope-guard";
import { expandTargetFilesOnDisk } from "./target-file-match";

/**
 * 点亮证据采集器（架构 §3.2.2，TASK-C.7）。
 *
 * 这里解决的是一条红线：**证据必须来自真实文件与真实命令，前端不得自造**。
 *
 * 因此以下三项一律由 Daemon 在 Worktree 上现算，HTTP 调用方无法声明：
 * - `files_written` / `file_hashes`：对 target_files 展开（字面路径直接读、glob 磁盘展开成真实相对路径）后真实读取并算 SHA-256；
 * - `commit_sha`：`git rev-parse HEAD` 的真实结果；
 * - `scope_valid`：`git status --porcelain -uall` 联合比对合同 Scope。
 *
 * 仍由调用方提交的只有"命令执行结果"（`command_results`）与"执行退出码"：
 * 它们由 Daemon 自己的执行器（orchestrator / CLI）产生，属于控制面内部数据，
 * 不是浏览器可伪造的字段。
 */

export interface WorktreeEvidence {
  worktree_path: string;
  worktree_available: boolean;
  /** 实际存在且已读取的目标文件（Worktree 相对路径） */
  files_written: string[];
  /** 路径 -> SHA-256 */
  file_hashes: Record<string, string>;
  /** Worktree HEAD；不可用时为 null */
  commit_sha: string | null;
  /** 变更是否全部落在合同 Scope 内 */
  scope_valid: boolean;
  /** 越界路径（最多保留前 20 条，避免响应体膨胀） */
  scope_violations: string[];
  /** Daemon 自身受控副产物，Scope 校验时跳过 */
  skipped: string[];
}

/** Worktree 约定路径（与 daemon/git/worktree-manager.ts 保持一致） */
export function worktreePathFor(repoRoot: string, contractId: string): string {
  return path.join(
    path.resolve(repoRoot),
    ".stagent",
    "worktrees",
    `task-${contractId}`,
  );
}

/** Daemon 自己挂载的副产物：不算 Worker 越权 */
const DAEMON_MANAGED_PREFIXES = [".stagent/", "node_modules/"] as const;

function isDaemonManaged(relativePath: string): boolean {
  return DAEMON_MANAGED_PREFIXES.some((prefix) =>
    relativePath.startsWith(prefix),
  );
}

function normalizeRelative(input: string): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    return null;
  }
  return normalized;
}

function sha256File(absolutePath: string): string | null {
  try {
    const hash = createHash("sha256");
    hash.update(fs.readFileSync(absolutePath));
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/**
 * 解析 `git status --porcelain -uall` 的一行，返回变更后的相对路径。
 * 重命名行形如 `R  old -> new`，删除的行路径已不存在但仍在 Scope 判定内。
 */
export function parsePorcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  let raw = line.slice(3).trim();
  if (raw === "") return null;
  if (raw.includes(" -> ")) {
    raw = raw.split(" -> ").at(-1) ?? raw;
  }
  if (raw.startsWith('"')) {
    raw = unquoteGitPath(raw);
  }
  return normalizeRelative(raw);
}

export async function collectWorktreeEvidence(params: {
  repoRoot: string;
  contractId: string;
  targetFiles: readonly string[];
  scope: FileSystemScope;
}): Promise<WorktreeEvidence> {
  const worktreePath = worktreePathFor(params.repoRoot, params.contractId);
  const empty: WorktreeEvidence = {
    worktree_path: worktreePath,
    worktree_available: false,
    files_written: [],
    file_hashes: {},
    commit_sha: null,
    scope_valid: false,
    scope_violations: [],
    skipped: [],
  };
  if (!fs.existsSync(worktreePath)) return empty;

  const filesWritten: string[] = [];
  const fileHashes: Record<string, string> = {};
  // 字面路径仍按相对路径直接读盘哈希；glob 先在施工树磁盘展开成真实文件。
  for (const relative of expandTargetFilesOnDisk(
    worktreePath,
    params.targetFiles,
  )) {
    const digest = sha256File(path.join(worktreePath, relative));
    if (digest === null) continue;
    filesWritten.push(relative);
    fileHashes[relative] = digest;
  }

  const head = await execGit(["rev-parse", "HEAD"], worktreePath).catch(
    () => null,
  );
  const commitSha =
    head !== null && head.exitCode === 0 && head.stdout !== ""
      ? head.stdout
      : null;

  const status = await execGit(
    ["status", "--porcelain", "-uall"],
    worktreePath,
  ).catch(() => null);

  let scopeValid = false;
  const violations: string[] = [];
  const skipped: string[] = [];
  if (status !== null && status.exitCode === 0) {
    scopeValid = true;
    for (const line of status.stdout.split("\n")) {
      const relative = parsePorcelainPath(line);
      if (relative === null) continue;
      if (isDaemonManaged(relative)) {
        skipped.push(relative);
        continue;
      }
      const check = checkWriteAccess(relative, params.scope);
      if (!check.allowed) {
        scopeValid = false;
        if (violations.length < 20) violations.push(relative);
      }
    }
  }

  return {
    worktree_path: worktreePath,
    worktree_available: true,
    files_written: filesWritten,
    file_hashes: fileHashes,
    commit_sha: commitSha,
    scope_valid: scopeValid,
    scope_violations: violations,
    skipped,
  };
}
