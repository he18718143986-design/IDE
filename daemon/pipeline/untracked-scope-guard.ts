import { execGit } from "../git/worktree-manager";
import type { ErrorCode } from "../../src/lib/error-codes";
import {
  type FileSystemScope,
  type ScopeViolationReason,
} from "../../src/lib/scope";
import {
  auditCandidateScope,
  type CandidateChangeEntry,
  unquoteGitPath,
} from "./candidate-scope-audit";

/**
 * TASK-W.2b / TASK-P0.2：未跟踪文件（untracked）Scope 守卫。
 *
 * 既有接口保持完全向后兼容，内部比对逻辑收敛至 candidate-scope-audit。
 */

export { unquoteGitPath };

/** 未跟踪文件越界错误码（编译期保证已登记进 §9.3 目录） */
export const E_OUT_OF_SCOPE_UNTRACKED =
  "E_OUT_OF_SCOPE_UNTRACKED" satisfies ErrorCode;

/**
 * 检测点：
 * - `PRE_EXECUTION`：执行前（提交前捕获，TASK-W.2b）
 * - `POST_VERIFICATION`：验收后（验证命令副作用，TASK-W.2b）
 * - `PRE_MERGE`：合并核销前（TASK-D.2b，覆盖证据生成后新增的文件）
 */
export type UntrackedScopePhase =
  "PRE_EXECUTION" | "POST_VERIFICATION" | "PRE_MERGE";

export interface UntrackedViolation {
  /** Worktree 相对路径 */
  path: string;
  /** 复用 scope.ts 的拒绝原因，避免两套语义 */
  reason: ScopeViolationReason;
  message: string;
}

export interface UntrackedScopeReport {
  phase: UntrackedScopePhase;
  /** 实际参与 Scope 校验的路径（已排序、去重） */
  inspected: string[];
  /** Daemon 自身挂载的受控副产物，不计入 Worker 越权 */
  skipped: string[];
  violations: UntrackedViolation[];
  passed: boolean;
}

/**
 * 解析 `git status --porcelain -uall` 输出中的未跟踪文件路径。
 *
 * porcelain v1 的未跟踪行固定为 `?? <path>`；路径含空格时**不加引号**，
 * 因此必须整段取 `slice(3)`，绝不能按空白切分。
 */
export function parseUntrackedPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("?? ")) continue;
    const decoded = unquoteGitPath(line.slice(3)).replace(/\/+$/, "");
    if (decoded) paths.push(decoded);
  }
  return [...new Set(paths)];
}

/** 采集 Worktree 内全部未跟踪文件（目录不折叠） */
export async function captureUntrackedPaths(
  worktreePath: string,
): Promise<string[]> {
  const res = await execGit(["status", "--porcelain", "-uall"], worktreePath);
  if (res.exitCode !== 0) {
    throw new Error(
      `git status --porcelain -uall failed in '${worktreePath}': ${
        res.stderr.trim() || res.stdout.trim() || `exit ${res.exitCode}`
      }`,
    );
  }
  return parseUntrackedPaths(res.stdout);
}

/** 纯函数校验：把未跟踪路径逐个比对合同文件系统授权（复用 candidate-scope-audit） */
export function auditUntrackedScope(
  paths: readonly string[],
  scope: FileSystemScope,
  phase: UntrackedScopePhase,
): UntrackedScopeReport {
  const entries: CandidateChangeEntry[] = paths.map((p) => ({
    path: p,
    changeType: "UNTRACKED",
    rawStatus: "??",
    source: "WORKTREE",
  }));
  const report = auditCandidateScope(entries, scope, phase);

  return {
    phase,
    inspected: report.inspected,
    skipped: report.skipped,
    violations: report.violations.map((v) => ({
      path: v.path,
      reason: v.reason,
      message: v.message,
    })),
    passed: report.passed,
  };
}

/** 采集 + 校验：执行侧的唯一入口 */
export async function enforceUntrackedScope(options: {
  worktreePath: string;
  scope: FileSystemScope;
  phase: UntrackedScopePhase;
}): Promise<UntrackedScopeReport> {
  const paths = await captureUntrackedPaths(options.worktreePath);
  return auditUntrackedScope(paths, options.scope, options.phase);
}

/** 面向非技术用户的白话摘要（写入 Evidence.verdict.summary / 合并门禁报错） */
export function describeUntrackedViolations(
  report: UntrackedScopeReport,
): string {
  const head =
    report.phase === "PRE_EXECUTION"
      ? "执行前检查"
      : report.phase === "PRE_MERGE"
        ? "合并前检查"
        : "验收前检查";
  const list = report.violations
    .slice(0, 5)
    .map((v) => v.path)
    .join("、");
  const more =
    report.violations.length > 5 ? ` 等 ${report.violations.length} 处` : "";
  return (
    `${head}发现 ${report.violations.length} 个未授权的新建文件：${list}${more}。` +
    "这些文件不在本次合同允许写入的范围内，可能绕过了受控写入通道；" +
    "已阻断本次验收结论，不会合入你的项目。请移除这些文件，或走合同升版重新授权。"
  );
}

/**
 * 未跟踪文件越界：不可恢复的执行侧阻断。
 * 携带完整清单，供控制面生成可追溯的 BLOCKED 证据。
 */
export class UntrackedScopeViolationError extends Error {
  readonly code: ErrorCode = E_OUT_OF_SCOPE_UNTRACKED;
  readonly phase: UntrackedScopePhase;
  readonly violations: UntrackedViolation[];

  constructor(report: UntrackedScopeReport) {
    super(
      `[${E_OUT_OF_SCOPE_UNTRACKED}] ${describeUntrackedViolations(report)}`,
    );
    this.name = "UntrackedScopeViolationError";
    this.phase = report.phase;
    this.violations = report.violations;
  }
}
