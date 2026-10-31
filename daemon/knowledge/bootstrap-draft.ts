/**
 * TASK-L.12 / technical-design-and-knowledge.md §4.5：
 * knowledge_bootstrap 引导草稿——顶层源码目录 → 候选模块；
 * depends_on 取自导入关系（确定性，不用模型）。
 *
 * 说明：`buildDependencyGraph` 固定只扫 `src/`（daemon/arch/graph.ts SCAN_SUBDIR），
 * 多顶层目录场景无法覆盖。本模块只读复用同文件导出的 `DependencyGraph` 与
 * `parser.parseFile` / `loadPathAliases`，不改扫描根，避免与 B.1 缓存语义打架。
 */

import fs from "node:fs";
import path from "node:path";
import { DependencyGraph } from "../arch/graph";
import { loadPathAliases, parseFile } from "../arch/parser";
import type { ModuleEntry } from "../../src/lib/knowledge/modules-schema";
import { normalizePath } from "../../src/lib/scope";

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const IGNORED_TOP = new Set([
  "node_modules",
  ".git",
  ".stagent",
  "dist",
  ".output",
  "coverage",
  ".next",
  "build",
  "out",
  "vendor",
  "target",
  ".turbo",
  ".cache",
  "docs",
  "tests",
  "test",
  "__tests__",
  "fixtures",
  "examples",
  "scripts",
  "public",
  "assets",
  "static",
  "migrations",
]);

function isSourceFile(name: string): boolean {
  return SOURCE_EXT.test(name);
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || IGNORED_TOP.has(entry.name)) continue;
      walkFiles(abs, acc);
      continue;
    }
    if (entry.isFile() && isSourceFile(entry.name)) {
      acc.push(abs);
    }
  }
  return acc;
}

function dirHasSourceFile(dir: string): boolean {
  return walkFiles(dir).length > 0;
}

/**
 * 列出仓库根下「顶层源码目录」：直接子目录且其下存在源码文件。
 * 排序稳定，保证草稿确定性。
 */
export function listTopLevelSourceDirs(repoRoot: string): string[] {
  const root = path.resolve(repoRoot);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || IGNORED_TOP.has(entry.name)) continue;
    const abs = path.join(root, entry.name);
    if (dirHasSourceFile(abs)) {
      dirs.push(entry.name);
    }
  }
  dirs.sort((a, b) => a.localeCompare(b));
  return dirs;
}

function toKebabModuleId(dirName: string): string {
  const raw = dirName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return raw.length > 0 ? raw : "module";
}

/**
 * 生成候选 `ModuleEntry[]`（尚未经设计步骤起白话名 / purpose）。
 * `introduced_by` 占位为 `knowledge_bootstrap`；设计步骤可改写。
 */
export function draftModules(repoRoot: string): ModuleEntry[] {
  const root = path.resolve(repoRoot);
  const topDirs = listTopLevelSourceDirs(root);
  if (topDirs.length === 0) return [];

  const aliases = loadPathAliases(root);
  const graph = new DependencyGraph();
  const fileToModule = new Map<string, string>();

  const modulesMeta: Array<{
    id: string;
    dir: string;
    files: string[];
  }> = [];

  const usedIds = new Set<string>();
  for (const dir of topDirs) {
    let id = toKebabModuleId(dir);
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    usedIds.add(id);
    const absDir = path.join(root, dir);
    const files = walkFiles(absDir);
    for (const file of files) {
      fileToModule.set(path.resolve(file), id);
      try {
        const parsed = parseFile(file, aliases);
        graph.addModule(parsed);
      } catch {
        // 单文件解析失败不阻断草稿
      }
    }
    modulesMeta.push({ id, dir, files });
  }

  const result: ModuleEntry[] = [];
  for (const meta of modulesMeta) {
    const depSet = new Set<string>();
    for (const file of meta.files) {
      const deps = graph.getDependencies(file);
      for (const depAbs of deps) {
        const other = fileToModule.get(path.resolve(depAbs));
        if (other && other !== meta.id) {
          depSet.add(other);
        }
      }
    }
    const depends_on = [...depSet].sort((a, b) => a.localeCompare(b));
    result.push({
      id: meta.id,
      name: meta.dir,
      purpose: `（草稿）顶层目录 ${meta.dir}`,
      paths: [`${normalizePath(meta.dir)}/**`],
      depends_on,
      interfaces: [],
      introduced_by: "knowledge_bootstrap",
      updated_by: [],
    });
  }

  // 按 id 排序，保证序列化稳定
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
