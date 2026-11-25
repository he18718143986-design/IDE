import fs from "node:fs";
import path from "node:path";
import { matchesAnyPattern } from "../../src/lib/scope";

/**
 * TASK-J.58：target_files 匹配规则只放一处。
 *
 * 两类能力：
 * - 判定侧：纯函数，不读盘。看已采集路径是否满足某个 target_files 模式
 *   （字面路径精确相等；glob 复用合同范围的 matchesAnyPattern / picomatch）。
 * - 采证侧：在隔离施工树根目录磁盘遍历，把 glob 展开成真实文件后再由
 *   采集器算哈希（键用真实相对路径）。不走 git ls-files，因此未跟踪文件
 *   也可被看见；不加「先提交才能被看见」门槛。
 *
 * isGlobPattern / GLOB_SYNTAX 与 daemon/protection/protection-list.ts 同口径，
 * 但该文件不在本卡 writable_paths，故在此复刻极小语法检查，避免越权改保护清单。
 * TREE_IGNORED_DIRS 与 daemon/editor/worktree-files.ts 对齐（镜像，不改该文件）。
 */

/** glob 语法标记；与 protection-list.ts 同口径，避免第三套不相容规则 */
const GLOB_SYNTAX = /[*?[\]{}]/;

/**
 * 与 daemon/editor/worktree-files.ts TREE_IGNORED_DIRS 对齐的忽略目录。
 * 展开时跳过这些目录；不引入 .stagent/demo 探测（那是资源管理器的额外探针）。
 */
const TREE_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".stagent",
  "dist",
  ".output",
  "coverage",
  ".tmp",
  ".next",
  ".vite",
  ".turbo",
  ".cache",
]);

const MAX_WALK_FILES = 5000;

export function isGlobPattern(pattern: string): boolean {
  return GLOB_SYNTAX.test(pattern);
}

export function normalizeTargetPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * 判定侧：已采集的相对路径是否满足一条 target_files 模式。纯函数，不读盘。
 * 字面路径只做精确相等；glob 走 matchesAnyPattern。
 */
export function pathSatisfiesTargetPattern(
  collectedPath: string,
  pattern: string,
): boolean {
  const file = normalizeTargetPath(collectedPath);
  const pat = normalizeTargetPath(pattern);
  if (file === "" || pat === "") return false;
  if (!isGlobPattern(pat)) {
    return file === pat;
  }
  return matchesAnyPattern(file, [pat]).matches;
}

/** 判定侧：已采集路径集合是否已满足该模式（至少一个命中）。纯函数，不读盘。 */
export function patternIsSatisfied(
  collectedPaths: readonly string[],
  pattern: string,
): boolean {
  return collectedPaths.some((candidate) =>
    pathSatisfiesTargetPattern(candidate, pattern),
  );
}

/**
 * 采证侧：在施工树根目录把 target_files 展开为待哈希的真实相对路径。
 * 字面路径原样返回（是否存在由调用方 sha256File 决定，行为与今日相同）；
 * glob 经磁盘遍历展开，只返回真实文件路径，不含字面模式本身。
 */
export function expandTargetFilesOnDisk(
  worktreeRoot: string,
  targetFiles: readonly string[],
): string[] {
  const literals: string[] = [];
  const globs: string[] = [];
  for (const raw of targetFiles) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const relative = normalizeTargetPath(raw);
    if (relative.startsWith("/") || relative.split("/").includes("..")) {
      continue;
    }
    if (isGlobPattern(relative)) globs.push(relative);
    else literals.push(relative);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (rel: string): void => {
    if (!seen.has(rel)) {
      seen.add(rel);
      out.push(rel);
    }
  };

  for (const literal of literals) add(literal);

  if (globs.length > 0) {
    for (const file of listWorktreeFilePaths(worktreeRoot)) {
      if (globs.some((pattern) => pathSatisfiesTargetPattern(file, pattern))) {
        add(file);
      }
    }
  }

  return out;
}

/** 磁盘遍历施工树内普通文件；跳过忽略目录。含未跟踪文件。 */
export function listWorktreeFilePaths(worktreeRoot: string): string[] {
  const rootAbs = path.resolve(worktreeRoot);
  const acc: string[] = [];

  const walk = (dirAbs: string): void => {
    if (acc.length >= MAX_WALK_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (acc.length >= MAX_WALK_FILES) return;
      if (entry.name === "." || entry.name === "..") continue;
      const abs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || TREE_IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) acc.push(rel);
    }
  };

  walk(rootAbs);
  return acc;
}
