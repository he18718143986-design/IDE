import fs from "node:fs";
import path from "node:path";
import { execGit } from "../git/worktree-manager";
import type { ErrorCode } from "../../src/lib/error-codes";
import {
  checkWriteAccess,
  type FileSystemScope,
  type ScopeViolationReason,
} from "../../src/lib/scope";

/**
 * TASK-P0.2：全量候选变更（Candidate Changes）Scope 审计守卫。
 *
 * 背景与职责：
 * 既有守卫（TASK-W.2b）仅针对 `git status --porcelain` 的 `??` 未跟踪文件。
 * 本模块将审计对象扩展为合同 Base SHA 起的全量候选变更：
 * 覆盖已跟踪文件的修改（M）、新增（A）、删除（D）、重命名（R）、复制（C）、
 * 类型变更（T）、未合并冲突（U）以及未跟踪文件（??）。
 *
 * 关键规则与口径（审批方 2026-11-26 拍板 · 选 A 新旧路径均审）：
 * 1. 统一审计函数：三检测点（PRE_EXECUTION / POST_VERIFICATION / PRE_MERGE）
 *    共用同一审计函数与判定规则；
 * 2. 重命名新旧路径均审：源路径与目标路径均必须在 writable_paths 范围内，任一侧越界即拒；
 *    防范 Worker 通过 rename 将 Scope 外受保护文件移入 Scope 内并借机删除/篡改原文件；
 * 3. Delete 审原路径；
 * 4. 特殊条目单独标记：symlink、submodule、mode-only 等纳入审计；
 * 5. PRE_MERGE 必须保留分支 diff 复核（git diff --name-status base...HEAD），
 *    覆盖已提交进任务分支的越权改动；
 * 6. 白名单保持不变：node_modules/、.stagent/ 不计入越界；
 * 7. 审计失败不能继续 Merge（负向测试证明）；
 * 8. 既有 ?? 守卫行为零回归。
 */

export const E_OUT_OF_SCOPE: ErrorCode = "E_OUT_OF_SCOPE";
export const E_OUT_OF_SCOPE_UNTRACKED: ErrorCode = "E_OUT_OF_SCOPE_UNTRACKED";

export type CandidateAuditPhase =
  "PRE_EXECUTION" | "POST_VERIFICATION" | "PRE_MERGE";

export type CandidateChangeType =
  | "MODIFIED"
  | "ADDED"
  | "DELETED"
  | "RENAMED"
  | "COPIED"
  | "TYPE_CHANGED"
  | "UNMERGED"
  | "UNTRACKED";

export type SpecialKind = "symlink" | "submodule" | "mode-only";

export interface CandidateChangeEntry {
  /** 规范化路径（对于 rename/copy 为目标路径） */
  path: string;
  /** 重命名或复制时的源路径（若无则为 undefined） */
  oldPath?: string | undefined;
  /** 变更类型 */
  changeType: CandidateChangeType;
  /** 特殊条目标记（symlink / submodule / mode-only） */
  specialKind?: SpecialKind | undefined;
  /** 原始 git 状态码（如 "MM", "R ", "??", "M", "D" 等） */
  rawStatus: string;
  /** 变更来源 */
  source: "WORKTREE" | "BRANCH_DIFF";
}

export interface CandidateViolation {
  /** 发生越权的路径（若为源路径越界则为源路径，目标越界为目标路径） */
  path: string;
  /** 重命名或复制时的另一侧路径（若有） */
  oldPath?: string | undefined;
  /** 变更类型 */
  changeType: CandidateChangeType;
  /** 特殊条目标记 */
  specialKind?: SpecialKind | undefined;
  /** 拒绝原因 */
  reason: ScopeViolationReason;
  /** 详细错误信息 */
  message: string;
  /** 来源 */
  source: "WORKTREE" | "BRANCH_DIFF";
}

export interface CandidateScopeReport {
  phase: CandidateAuditPhase;
  /** 发现的全部候选变更条目 */
  entries: CandidateChangeEntry[];
  /** 实际参与 Scope 判定的路径 */
  inspected: string[];
  /** Daemon 自行管理的受控副产物（白名单放行） */
  skipped: string[];
  /** 越权违规列表 */
  violations: CandidateViolation[];
  /** 是否全量通过 */
  passed: boolean;
}

const DAEMON_MANAGED_PREFIXES: readonly string[] = [
  "node_modules/",
  ".stagent/",
];

export function isDaemonManaged(relativePath: string): boolean {
  const probe = relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
  return DAEMON_MANAGED_PREFIXES.some(
    (prefix) => probe === prefix || probe.startsWith(prefix),
  );
}

/** git 在 core.quotePath 下的 C 风格转义表 */
const C_ESCAPES: Readonly<Record<string, string>> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  '"': '"',
  "\\": "\\",
};

/**
 * 还原 `git status` 或 `git diff` 中带引号的路径。
 */

/**
 * 从 git diff --raw 输出解析特殊文件类型（mode-only, symlink, submodule）。
 */
export function parseRawDiffSpecialKinds(
  rawDiff: string,
  worktreePath?: string | undefined,
): Map<string, SpecialKind> {
  const map = new Map<string, SpecialKind>();
  for (const line of rawDiff.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(":")) continue;
    const tabIdx = trimmed.indexOf("\t");
    if (tabIdx === -1) continue;
    const meta = trimmed.slice(1, tabIdx).trim().split(/\s+/);
    const pathPart = trimmed.slice(tabIdx + 1);
    if (meta.length < 5) continue;
    const oldMode = meta[0];
    const newMode = meta[1];
    const oldSha = meta[2];
    const newSha = meta[3];
    const status = meta[4];

    let targetPath = pathPart;
    if (pathPart.includes("\t")) {
      const parts = pathPart.split("\t");
      targetPath = parts[parts.length - 1] ?? pathPart;
    }
    targetPath = unquoteGitPath(targetPath).replace(/\/+$/, "");

    if (
      oldMode === "120000" ||
      newMode === "120000" ||
      (status && status.startsWith("T"))
    ) {
      map.set(targetPath, "symlink");
    } else if (oldMode === "160000" || newMode === "160000") {
      map.set(targetPath, "submodule");
    } else if (oldMode !== newMode) {
      if (
        oldSha === newSha &&
        oldSha &&
        oldSha !== "0000000000000000000000000000000000000000"
      ) {
        map.set(targetPath, "mode-only");
      } else if (
        oldMode &&
        newMode &&
        oldMode.startsWith("100") &&
        newMode.startsWith("100")
      ) {
        map.set(targetPath, "mode-only");
      }
    }
  }
  return map;
}

export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  let sawOctal = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      bytes.push(ch.charCodeAt(0) & 0xff);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      bytes.push(0x5c);
      break;
    }
    const mapped = C_ESCAPES[next];
    if (mapped !== undefined) {
      for (const byte of Buffer.from(mapped, "utf8")) bytes.push(byte);
      i += 1;
      continue;
    }
    const octal = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      sawOctal = true;
      i += 3;
      continue;
    }
    for (const byte of Buffer.from(next, "utf8")) bytes.push(byte);
    i += 1;
  }

  if (!sawOctal) {
    return body.replace(/\\(.)/g, (_all, ch: string) => C_ESCAPES[ch] ?? ch);
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * 探测文件是否属于特殊类型（symlink / submodule / mode-only）。
 */
export function detectSpecialKind(
  worktreePath?: string | undefined,
  relativePath?: string | undefined,
  changeType?: CandidateChangeType | undefined,
  rawStatus?: string | undefined,
): SpecialKind | undefined {
  if (changeType === "TYPE_CHANGED" || (rawStatus && rawStatus.includes("T"))) {
    return "symlink";
  }
  if (!worktreePath || !relativePath) {
    return undefined;
  }
  const full = path.join(worktreePath, relativePath);
  try {
    const lstat = fs.lstatSync(full);
    if (lstat.isSymbolicLink()) {
      return "symlink";
    }
    if (lstat.isDirectory()) {
      if (
        fs.existsSync(path.join(full, ".git")) ||
        fs.existsSync(path.join(worktreePath, ".gitmodules"))
      ) {
        return "submodule";
      }
    }
  } catch {
    // 文件可能已被删除或重命名，忽略 fs 错误
  }
  return undefined;
}

/**
 * 解析 `git status --porcelain -uall` 的完整输出。
 *
 * 严格按照 porcelain v1 规范逐行解析，禁止按普通空格 split 路径：
 * - 0-1 字节为 index 与 worktree 状态码；
 * - 2 字节为分隔空格；
 * - 3 字节起为路径部分。若为重命名/复制，含 ` -> ` 箭头；
 * - 文件名通过 `unquoteGitPath` 还原（正确支持带空格、引号及 UTF-8 八进制转义）。
 */
export function parsePorcelainStatus(
  porcelain: string,
  options?: { worktreePath?: string | undefined } | undefined,
): CandidateChangeEntry[] {
  const entries: CandidateChangeEntry[] = [];
  const lines = porcelain.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length < 3) continue;

    const x = line[0];
    const y = line[1];
    const rawStatus = line.slice(0, 2);
    const rest = line.slice(3);

    let changeType: CandidateChangeType = "MODIFIED";
    if (x === "?" && y === "?") {
      changeType = "UNTRACKED";
    } else if (x === "R" || y === "R") {
      changeType = "RENAMED";
    } else if (x === "C" || y === "C") {
      changeType = "COPIED";
    } else if (x === "A" || y === "A") {
      changeType = "ADDED";
    } else if (x === "D" || y === "D") {
      changeType = "DELETED";
    } else if (x === "T" || y === "T") {
      changeType = "TYPE_CHANGED";
    } else if (
      x === "U" ||
      y === "U" ||
      (x === "A" && y === "A") ||
      (x === "D" && y === "D")
    ) {
      changeType = "UNMERGED";
    } else if (x === "M" || y === "M") {
      changeType = "MODIFIED";
    }

    let oldPath: string | undefined;
    let targetPath: string;

    const arrowIdx = rest.indexOf(" -> ");
    if (arrowIdx !== -1) {
      oldPath = unquoteGitPath(rest.slice(0, arrowIdx)).replace(/\/+$/, "");
      targetPath = unquoteGitPath(rest.slice(arrowIdx + 4)).replace(/\/+$/, "");
    } else {
      targetPath = unquoteGitPath(rest).replace(/\/+$/, "");
    }

    if (!targetPath) continue;

    const specialKind = detectSpecialKind(
      options?.worktreePath,
      targetPath,
      changeType,
      rawStatus,
    );

    entries.push({
      path: targetPath,
      oldPath,
      changeType,
      specialKind,
      rawStatus,
      source: "WORKTREE",
    });
  }

  return entries;
}

/**
 * 解析 `git diff --name-status -M` 输出。
 *
 * 字段以制表符 `\t` 分隔：
 * - 变更类型及相似度评分（如 `M`, `A`, `D`, `R100`, `C100`, `T` 等）；
 * - 普通状态下一列为路径；重命名/复制状态下两列分别为源路径与目标路径。
 */
export function parseDiffNameStatus(
  diffOutput: string,
  options?: { worktreePath?: string | undefined } | undefined,
): CandidateChangeEntry[] {
  const entries: CandidateChangeEntry[] = [];
  const lines = diffOutput.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;

    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const rawStatus = parts[0] as string;
    const code = rawStatus[0];

    let changeType: CandidateChangeType = "MODIFIED";
    let oldPath: string | undefined;
    let targetPath: string;

    if (code === "R" || code === "C") {
      changeType = code === "R" ? "RENAMED" : "COPIED";
      oldPath = unquoteGitPath(parts[1] as string).replace(/\/+$/, "");
      targetPath = unquoteGitPath(parts[2] ?? "").replace(/\/+$/, "");
    } else if (code === "A") {
      changeType = "ADDED";
      targetPath = unquoteGitPath(parts[1] as string).replace(/\/+$/, "");
    } else if (code === "D") {
      changeType = "DELETED";
      targetPath = unquoteGitPath(parts[1] as string).replace(/\/+$/, "");
    } else if (code === "T") {
      changeType = "TYPE_CHANGED";
      targetPath = unquoteGitPath(parts[1] as string).replace(/\/+$/, "");
    } else if (code === "U") {
      changeType = "UNMERGED";
      targetPath = unquoteGitPath(parts[1] as string).replace(/\/+$/, "");
    } else {
      changeType = "MODIFIED";
      targetPath = unquoteGitPath(parts[1] as string).replace(/\/+$/, "");
    }

    if (!targetPath) continue;

    const specialKind = detectSpecialKind(
      options?.worktreePath,
      targetPath,
      changeType,
      rawStatus,
    );

    entries.push({
      path: targetPath,
      oldPath,
      changeType,
      specialKind,
      rawStatus,
      source: "BRANCH_DIFF",
    });
  }

  return entries;
}

/**
 * 核心纯函数审计：比对候选变更条目与合同 FileSystemScope 授权。
 *
 * 覆盖规则：
 * 1. 白名单放行：node_modules/ 与 .stagent/ 路径纳入 skipped，不判违规；
 * 2. 重命名判定（选 A 裁决）：源路径与目标路径均必须在 writable_paths 内，任一越界即判违规；
 * 3. 删除操作：原路径必须在 writable_paths 内，超出即判违规；
 * 4. 修改/新增/类型变更/未跟踪：目标路径必须在 writable_paths 内；
 * 5. 强禁区保护：strictly_forbidden_paths 优先判定为 FORBIDDEN_PATH。
 */
export function auditCandidateScope(
  entries: readonly CandidateChangeEntry[],
  scope: FileSystemScope,
  phase: CandidateAuditPhase,
): CandidateScopeReport {
  const inspectedSet = new Set<string>();
  const skippedSet = new Set<string>();
  const violations: CandidateViolation[] = [];

  // 按路径排序保证输出确定性
  const sortedEntries = [...entries].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  for (const entry of sortedEntries) {
    // 白名单过滤
    const isTargetManaged = isDaemonManaged(entry.path);
    const isSourceManaged = entry.oldPath
      ? isDaemonManaged(entry.oldPath)
      : false;

    if (isTargetManaged && (!entry.oldPath || isSourceManaged)) {
      skippedSet.add(entry.path);
      if (entry.oldPath) skippedSet.add(entry.oldPath);
      continue;
    }

    inspectedSet.add(entry.path);
    if (entry.oldPath) inspectedSet.add(entry.oldPath);

    if (entry.changeType === "RENAMED") {
      // 裁决选 A：新旧路径均审
      const targetAccess = checkWriteAccess(entry.path, scope);
      const sourceAccess = entry.oldPath
        ? checkWriteAccess(entry.oldPath, scope)
        : { allowed: true };

      if (!targetAccess.allowed) {
        violations.push({
          path: entry.path,
          oldPath: entry.oldPath,
          changeType: entry.changeType,
          specialKind: entry.specialKind,
          reason: targetAccess.reason ?? "NOT_WRITABLE",
          message:
            targetAccess.message ??
            `Rename target '${entry.path}' is outside writable_paths`,
          source: entry.source,
        });
      }

      if (entry.oldPath && !sourceAccess.allowed) {
        violations.push({
          path: entry.oldPath,
          oldPath: entry.oldPath,
          changeType: entry.changeType,
          specialKind: entry.specialKind,
          reason: sourceAccess.reason ?? "NOT_WRITABLE",
          message:
            sourceAccess.message ??
            `Rename source '${entry.oldPath}' is outside writable_paths`,
          source: entry.source,
        });
      }
      continue;
    }

    // 非 rename 操作：Delete 审原路径（即 entry.path），修改/新增/未跟踪审 entry.path
    const access = checkWriteAccess(entry.path, scope);
    if (!access.allowed) {
      const operationDesc =
        entry.changeType === "DELETED"
          ? "Deleted path"
          : entry.changeType === "MODIFIED"
            ? "Modified path"
            : entry.changeType === "UNTRACKED"
              ? "Untracked path"
              : "Candidate path";
      violations.push({
        path: entry.path,
        oldPath: entry.oldPath,
        changeType: entry.changeType,
        specialKind: entry.specialKind,
        reason: access.reason ?? "NOT_WRITABLE",
        message:
          access.message ??
          `${operationDesc} '${entry.path}' is outside writable_paths`,
        source: entry.source,
      });
    }
  }

  return {
    phase,
    entries: sortedEntries,
    inspected: [...inspectedSet].sort(),
    skipped: [...skippedSet].sort(),
    violations,
    passed: violations.length === 0,
  };
}

/** 采集 Worktree 候选变更状态 */
export async function captureWorktreeCandidateChanges(
  worktreePath: string,
): Promise<CandidateChangeEntry[]> {
  const res = await execGit(["status", "--porcelain", "-uall"], worktreePath);
  if (res.exitCode !== 0) {
    throw new Error(
      `git status --porcelain -uall failed in '${worktreePath}': ${
        res.stderr.trim() || res.stdout.trim() || `exit ${res.exitCode}`
      }`,
    );
  }
  return parsePorcelainStatus(res.stdout, { worktreePath });
}

export interface CaptureBranchDiffOptions {
  worktreePath: string;
  baseBranch?: string | undefined;
  baseCommitSha?: string | undefined;
}

/** 采集分支 diff 候选变更（任务分支 vs base） */
export async function captureBranchDiffCandidateChanges(
  options: CaptureBranchDiffOptions,
): Promise<CandidateChangeEntry[]> {
  const baseRef = options.baseCommitSha || options.baseBranch;
  if (!baseRef) {
    return [];
  }

  let res = await execGit(
    ["diff", "--name-status", "-M", `${baseRef}...HEAD`],
    options.worktreePath,
  );

  if (res.exitCode !== 0) {
    res = await execGit(
      ["diff", "--name-status", "-M", `${baseRef}..HEAD`],
      options.worktreePath,
    );
  }

  if (res.exitCode !== 0) {
    res = await execGit(
      ["diff", "--name-status", "-M", baseRef, "HEAD"],
      options.worktreePath,
    );
  }

  if (res.exitCode !== 0) {
    throw new Error(
      `git diff --name-status -M for base '${baseRef}' failed in '${options.worktreePath}': ${
        res.stderr.trim() || res.stdout.trim() || `exit ${res.exitCode}`
      }`,
    );
  }

  return parseDiffNameStatus(res.stdout, {
    worktreePath: options.worktreePath,
  });
}

export interface EnforceCandidateScopeOptions {
  worktreePath: string;
  scope: FileSystemScope;
  phase: CandidateAuditPhase;
  baseBranch?: string | undefined;
  baseCommitSha?: string | undefined;
  repoRoot?: string | undefined;
  branch?: string | undefined;
}

/**
 * 全量候选变更执行侧与合并前唯一入口函数。
 *
 * - PRE_EXECUTION / POST_VERIFICATION：审计当前工作区内全量状态；
 * - PRE_MERGE：同时审计工作区状态与「任务分支 diff vs base」，防止已 commit 越权绕过。
 */
export async function enforceCandidateScope(
  options: EnforceCandidateScopeOptions,
): Promise<CandidateScopeReport> {
  const worktreeEntries = await captureWorktreeCandidateChanges(
    options.worktreePath,
  );

  let combinedEntries = [...worktreeEntries];

  if (options.phase === "PRE_MERGE") {
    // PRE_MERGE 必须附加分支 diff 复核（当提供了 baseBranch 或 baseCommitSha 时）
    if (options.baseBranch || options.baseCommitSha) {
      const branchDiffEntries = await captureBranchDiffCandidateChanges({
        worktreePath: options.worktreePath,
        baseBranch: options.baseBranch,
        baseCommitSha: options.baseCommitSha,
      });

      // 合并并去重（同路径优先保留 BRANCH_DIFF 或合并记录）
      const entryMap = new Map<string, CandidateChangeEntry>();
      for (const e of branchDiffEntries) {
        entryMap.set(`${e.changeType}:${e.path}`, e);
      }
      for (const e of worktreeEntries) {
        entryMap.set(`${e.changeType}:${e.path}`, e);
      }
      combinedEntries = Array.from(entryMap.values());
    }
  }

  return auditCandidateScope(combinedEntries, options.scope, options.phase);
}

/** 面向非技术用户的白话描述 */
export function describeCandidateViolations(
  report: CandidateScopeReport,
): string {
  const head =
    report.phase === "PRE_EXECUTION"
      ? "执行前检查"
      : report.phase === "PRE_MERGE"
        ? "合并前检查"
        : "验收前检查";

  const list = report.violations
    .slice(0, 5)
    .map((v) => {
      const typeDesc =
        v.changeType === "UNTRACKED"
          ? "未跟踪"
          : v.changeType === "RENAMED"
            ? "重命名"
            : v.changeType === "DELETED"
              ? "删除"
              : v.changeType === "ADDED"
                ? "新增"
                : "修改";
      const special = v.specialKind ? `[${v.specialKind}] ` : "";
      return `${special}${v.path}（${typeDesc}）`;
    })
    .join("、");

  const more =
    report.violations.length > 5 ? ` 等 ${report.violations.length} 处` : "";

  return (
    `${head}发现 ${report.violations.length} 个未授权的改动：${list}${more}。` +
    "这些改动超出本次合同允许写入的范围（writable_paths），可能绕过了受控通道；" +
    "已阻断本次验收结论，不会合入你的项目。请撤销这些变更，或走合同升版重新授权。"
  );
}

/**
 * 全量候选变更越界错误。
 */
export class CandidateScopeViolationError extends Error {
  readonly code: ErrorCode;
  readonly phase: CandidateAuditPhase;
  readonly violations: CandidateViolation[];
  readonly report: CandidateScopeReport;

  constructor(report: CandidateScopeReport) {
    const isOnlyUntracked =
      report.violations.length > 0 &&
      report.violations.every((v) => v.changeType === "UNTRACKED");
    const code = isOnlyUntracked ? E_OUT_OF_SCOPE_UNTRACKED : E_OUT_OF_SCOPE;

    super(`[${code}] ${describeCandidateViolations(report)}`);
    this.name = "CandidateScopeViolationError";
    this.code = code;
    this.phase = report.phase;
    this.violations = report.violations;
    this.report = report;
  }
}
