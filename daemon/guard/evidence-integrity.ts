import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execGit, execGitSync } from "../git/worktree-manager";
import { shouldIgnore } from "../watcher/fs-watcher";
import {
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import { writeStateFile } from "./state-store";

/**
 * Evidence 防篡改指纹（Chaos 场景 2 子场景 B：手贱外挂党）。
 *
 * 用户在 Evidence 生成后直接编辑 `.stagent/worktrees/task-{id}` 里的文件，
 * 再用旧的 PASSED 证据强行合并 = 未经验证的代码偷渡进主干。
 *
 * 指纹 = HEAD SHA ⊕ `git status --porcelain -uall` ⊕ 变更文件内容哈希。
 * 覆盖三类篡改：改已跟踪文件、新增未跟踪文件、删除文件。
 * （node_modules / .git / 构建产物按 watcher 的忽略表排除，避免依赖安装造成假失效。）
 */

export const E_EVIDENCE_FINGERPRINT_MISMATCH =
  "E_EVIDENCE_FINGERPRINT_MISMATCH";

export class EvidenceIntegrityError extends Error {
  readonly code = E_EVIDENCE_FINGERPRINT_MISMATCH;
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(
      `[${E_EVIDENCE_FINGERPRINT_MISMATCH}] Worktree changed after verification: ` +
        `evidence fingerprint ${expected.slice(0, 12)}… != current ${actual.slice(0, 12)}…. ` +
        `Evidence已标记 STALE，请重新验证后再核销。`,
    );
    this.name = "EvidenceIntegrityError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * 解析 porcelain 行 → { 原始行, 相对路径 }。
 * 保留原始行的 XY 状态码（区分「内容修改」与「新增/删除/类型变更」），
 * 路径部分处理重命名（`R  old -> new`）与引号包裹。
 */
function parsePorcelainEntries(
  stdout: string,
): Array<{ line: string; rel: string }> {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      let p = line.slice(3);
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4);
      return { line, rel: p.replace(/^"|"$/g, "").replace(/\/$/, "") };
    })
    .filter((entry) => entry.rel !== "");
}

/**
 * 递归收集工作树下所有未被 IGNORED_SEGMENTS 排除的文件相对路径（排序以保证跨平台确定性）
 */
export function listNonIgnoredFiles(worktreePath: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (shouldIgnore(abs, worktreePath)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) files.push(path.relative(worktreePath, abs));
    }
  };
  walk(worktreePath);
  return files.sort();
}

/**
 * 非 Git 目录或 Git 环境异常降级指纹算法（规范 TASK-B.2 单点收敛）
 */
export function computeFallbackFingerprint(worktreePath: string): string {
  const hash = createHash("sha256");
  hash.update("fallback:v1\n");
  for (const rel of listNonIgnoredFiles(worktreePath)) {
    const abs = path.join(worktreePath, rel);
    hash.update(`file:${rel}\n`);
    try {
      const content = fs.readFileSync(abs);
      hash.update(createHash("sha256").update(content).digest("hex"));
    } catch {
      hash.update("<unreadable>");
    }
  }
  return hash.digest("hex");
}

/**
 * Git 工作树输出哈希计算核心（保证异步与同步 100% 同源口径）
 */
function computeGitFingerprintFromOutput(
  worktreePath: string,
  headStdout: string,
  statusStdout: string,
): string {
  const hash = createHash("sha256");
  hash.update(`head:${headStdout.trim()}\n`);

  for (const { line, rel } of parsePorcelainEntries(statusStdout)) {
    const abs = path.join(worktreePath, rel);
    if (shouldIgnore(abs, worktreePath)) continue;
    hash.update(`entry:${line}\n`);
    try {
      const content = fs.readFileSync(abs);
      hash.update(createHash("sha256").update(content).digest("hex"));
    } catch {
      // 已删除 / 不可读
      hash.update("<unreadable>");
    }
  }

  return hash.digest("hex");
}

/**
 * 计算 Worktree 当前指纹（异步）。
 * 优先按 Git HEAD + porcelain 差异及变更内容哈希计算；若非 Git 目录或 Git 命令失败，
 * 走单点收敛的 computeFallbackFingerprint。
 */
/**
 * 快速直读工作树 HEAD SHA（免子进程优化，规范 TASK-B.2 门禁③）。
 * 支持普通仓库（.git 为目录）与 Git Worktree（.git 为文件带 gitdir 指针）。
 * 若遇到 packed-refs、未知 ref 格式或文件不可读，返回 null，由调用方回退至 git rev-parse HEAD 子进程，
 * 绝不直接走 fallback 哈希，保持 100% 降级一致性。
 */
export function tryReadHeadShaDirect(worktreePath: string): string | null {
  try {
    const gitMarker = path.join(worktreePath, ".git");
    if (!fs.existsSync(gitMarker)) return null;

    let gitDir = gitMarker;
    let commonDir = gitMarker;

    const stat = fs.statSync(gitMarker);
    if (stat.isFile()) {
      // Worktree 场景：.git 是文件，内容为 gitdir: <path>
      const content = fs.readFileSync(gitMarker, "utf-8").trim();
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (!match || !match[1]) return null;
      gitDir = path.resolve(worktreePath, match[1]);

      // 查找 commondir 获取主仓库 .git（refs 存储于此）
      const commonDirFile = path.join(gitDir, "commondir");
      if (fs.existsSync(commonDirFile)) {
        const relCommon = fs.readFileSync(commonDirFile, "utf-8").trim();
        commonDir = path.resolve(gitDir, relCommon);
      } else {
        commonDir = path.resolve(gitDir, "..", "..");
      }
    }

    const headFile = path.join(gitDir, "HEAD");
    if (!fs.existsSync(headFile)) return null;
    const headContent = fs.readFileSync(headFile, "utf-8").trim();

    // 游离 HEAD (detached HEAD): 40 字符 hex
    if (/^[0-9a-fA-F]{40}$/.test(headContent)) {
      return headContent.toLowerCase();
    }

    // 分支引用：ref: refs/heads/...
    if (headContent.startsWith("ref:")) {
      const refPath = headContent.slice(4).trim();
      // 优先在本地 gitDir 中寻找引用（例如 task 分支专属 ref）
      const localRefFile = path.join(gitDir, refPath);
      if (fs.existsSync(localRefFile)) {
        const sha = fs.readFileSync(localRefFile, "utf-8").trim();
        if (/^[0-9a-fA-F]{40}$/.test(sha)) return sha.toLowerCase();
      }
      // 再在 commonDir 中寻找主干/共享引用
      const commonRefFile = path.join(commonDir, refPath);
      if (fs.existsSync(commonRefFile)) {
        const sha = fs.readFileSync(commonRefFile, "utf-8").trim();
        if (/^[0-9a-fA-F]{40}$/.test(sha)) return sha.toLowerCase();
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function computeWorktreeFingerprint(
  worktreePath: string,
): Promise<string> {
  if (!fs.existsSync(worktreePath)) {
    throw new Error(`Worktree missing: ${worktreePath}`);
  }

  const gitMarker = path.join(worktreePath, ".git");
  if (!fs.existsSync(gitMarker)) {
    return computeFallbackFingerprint(worktreePath);
  }

  try {
    let headSha = tryReadHeadShaDirect(worktreePath);
    const gitPromises: [
      Promise<{ stdout: string; stderr: string; exitCode: number } | null>,
      Promise<{ stdout: string; stderr: string; exitCode: number }>,
    ] = [
      headSha
        ? Promise.resolve(null)
        : execGit(["rev-parse", "HEAD"], worktreePath),
      execGit(["status", "--porcelain", "-uall"], worktreePath, { raw: true }),
    ];

    const [headRes, statusRes] = await Promise.all(gitPromises);
    if (!headSha) {
      if (!headRes || headRes.exitCode !== 0) {
        return computeFallbackFingerprint(worktreePath);
      }
      headSha = headRes.stdout.trim();
    }

    if (statusRes.exitCode !== 0) {
      return computeFallbackFingerprint(worktreePath);
    }

    return computeGitFingerprintFromOutput(
      worktreePath,
      headSha,
      statusRes.stdout,
    );
  } catch {
    return computeFallbackFingerprint(worktreePath);
  }
}

/**
 * 计算 Worktree 当前指纹（同步）。
 * 与异步版本口径 100% 一致，供 invalidation-engine 及同步登记场景调用。
 */
export function computeWorktreeFingerprintSync(worktreePath: string): string {
  if (!fs.existsSync(worktreePath)) {
    throw new Error(`Worktree missing: ${worktreePath}`);
  }

  const gitMarker = path.join(worktreePath, ".git");
  if (!fs.existsSync(gitMarker)) {
    return computeFallbackFingerprint(worktreePath);
  }

  try {
    let headSha = tryReadHeadShaDirect(worktreePath);
    if (!headSha) {
      const headRes = execGitSync(["rev-parse", "HEAD"], worktreePath);
      if (headRes.exitCode !== 0) {
        return computeFallbackFingerprint(worktreePath);
      }
      headSha = headRes.stdout.trim();
    }

    const statusRes = execGitSync(
      ["status", "--porcelain", "-uall"],
      worktreePath,
      { raw: true },
    );
    if (statusRes.exitCode !== 0) {
      return computeFallbackFingerprint(worktreePath);
    }

    return computeGitFingerprintFromOutput(
      worktreePath,
      headSha,
      statusRes.stdout,
    );
  } catch {
    return computeFallbackFingerprint(worktreePath);
  }
}

/** 把磁盘上的证据快照改写为 STALE（保持 §9.2 Schema 合法） */
export function markEvidenceStale(evidencePath: string): void {
  if (!fs.existsSync(evidencePath)) return;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(evidencePath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return;
  }
  const verdict = (raw["verdict"] ?? {}) as Record<string, unknown>;
  const updated = evidenceBundleSchema.parse({
    ...raw,
    verdict: {
      ...verdict,
      status: "STALE",
      can_merge: false,
      reason_code: "EVIDENCE_STALE",
      summary: `Evidence invalidated: worktree fingerprint mismatch after verification (${new Date().toISOString()})`,
    },
  });
  writeStateFile(evidencePath, updated);
}

/**
 * 合并前置校验：Evidence 记录的指纹必须等于 Worktree 当前指纹。
 * 不符 → 落盘标记 STALE + 抛错阻断（不静默放行，也不修改用户代码）。
 */
export async function assertEvidenceIntegrity(options: {
  worktreePath: string;
  evidencePath: string;
  snapshot: EvidenceBundle;
}): Promise<string> {
  const current = await computeWorktreeFingerprint(options.worktreePath);
  const expected = options.snapshot.worktree_snapshot.snapshot_fingerprint;
  if (current !== expected) {
    markEvidenceStale(options.evidencePath);
    throw new EvidenceIntegrityError(expected, current);
  }
  return current;
}
