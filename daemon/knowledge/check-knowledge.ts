/**
 * TASK-L.12 / technical-design-and-knowledge.md §4.4：
 * 知识库漂移门禁 KB-1～KB-5（确定性；以 `stagent check knowledge` 子进程出口码给出结论）。
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { load as parseYaml } from "js-yaml";
import type { DesignNote } from "../../src/lib/design/design-note";
import {
  coversPath,
  hasDependsOnCycle,
  safeParseModulesYaml,
  type ModuleEntry,
  type ModulesYaml,
} from "../../src/lib/knowledge/modules-schema";
import { matchesAnyPattern, normalizePath } from "../../src/lib/scope";

export type KnowledgeRule = "KB-1" | "KB-2" | "KB-3" | "KB-4" | "KB-5";

export interface KnowledgeFailure {
  rule: KnowledgeRule;
  target: string;
}

export interface CheckKnowledgeInput {
  worktreeDir: string;
  baseSha: string;
  candidateSha: string;
  contractId: string;
  designNote?: DesignNote | null;
  /**
   * knowledge_bootstrap：对仓库全部源码文件跑 KB-1，而不只 diff。
   * （technical-design §4.5）
   */
  allSourceFiles?: boolean;
}

export interface CheckKnowledgeResult {
  ok: boolean;
  failures: KnowledgeFailure[];
}

const DOCS_SYSTEM_GLOB = "docs/system/**";

const SOURCE_FILE_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs)$/;

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
]);

function gitLines(
  worktreeDir: string,
  args: string[],
): string[] {
  try {
    const out = execFileSync("git", args, {
      cwd: worktreeDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
}

function isDocsSystemPath(filePath: string): boolean {
  return matchesAnyPattern(filePath, [DOCS_SYSTEM_GLOB]).matches;
}

function loadModulesYaml(
  worktreeDir: string,
): { ok: true; data: ModulesYaml } | { ok: false; target: string } {
  const file = path.join(worktreeDir, "docs", "system", "modules.yaml");
  if (!fs.existsSync(file)) {
    return { ok: false, target: "docs/system/modules.yaml (missing)" };
  }
  try {
    const rawText = fs.readFileSync(file, "utf8");
    const raw = parseYaml(rawText);
    const parsed = safeParseModulesYaml(raw);
    if (!parsed.success) {
      return {
        ok: false,
        target: `docs/system/modules.yaml (schema: ${parsed.error.issues[0]?.message ?? "invalid"})`,
      };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    return {
      ok: false,
      target: `docs/system/modules.yaml (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function walkSourceFiles(root: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || IGNORED_TOP.has(entry.name)) continue;
      walkSourceFiles(abs, acc);
      continue;
    }
    if (entry.isFile() && SOURCE_FILE_RE.test(entry.name)) {
      acc.push(abs);
    }
  }
  return acc;
}

function changedFiles(
  worktreeDir: string,
  baseSha: string,
  candidateSha: string,
): string[] {
  return gitLines(worktreeDir, [
    "diff",
    "--name-only",
    `${baseSha}..${candidateSha}`,
  ]).map((p) => normalizePath(p));
}

function addedFilesUnder(
  worktreeDir: string,
  baseSha: string,
  candidateSha: string,
  prefix: string,
): string[] {
  const normPrefix = normalizePath(prefix).replace(/\/?$/, "/");
  return gitLines(worktreeDir, [
    "diff",
    "--diff-filter=A",
    "--name-only",
    `${baseSha}..${candidateSha}`,
  ])
    .map((p) => normalizePath(p))
    .filter((p) => p.startsWith(normPrefix));
}

function readCandidateFile(
  worktreeDir: string,
  candidateSha: string,
  relPath: string,
): string | null {
  try {
    return execFileSync("git", ["show", `${candidateSha}:${relPath}`], {
      cwd: worktreeDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // fall back to worktree working tree (uncommitted / just written)
    const abs = path.join(worktreeDir, relPath);
    try {
      return fs.readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  }
}

/**
 * 确定性知识库检查。失败项只含规则编号与对象，不含修复建议（§4.4）。
 */
export function checkKnowledge(
  input: CheckKnowledgeInput,
): CheckKnowledgeResult {
  const worktreeDir = path.resolve(input.worktreeDir);
  const failures: KnowledgeFailure[] = [];
  const designNote = input.designNote ?? null;

  // —— KB-4：Schema + 无环（先于 KB-1，否则 coversPath 无可靠输入）——
  const loaded = loadModulesYaml(worktreeDir);
  let modules: ModuleEntry[] = [];
  if (!loaded.ok) {
    failures.push({ rule: "KB-4", target: loaded.target });
  } else {
    modules = loaded.data.modules;
    if (hasDependsOnCycle(modules)) {
      failures.push({
        rule: "KB-4",
        target: "docs/system/modules.yaml (depends_on cycle)",
      });
    }
  }

  // —— KB-1：改动（或全部源码）文件须被模块 paths 覆盖 ——
  const filesForKb1: string[] = input.allSourceFiles
    ? walkSourceFiles(worktreeDir)
        .map((abs) => normalizePath(path.relative(worktreeDir, abs)))
        .filter((p) => p.length > 0 && !p.startsWith(".."))
    : changedFiles(worktreeDir, input.baseSha, input.candidateSha);

  for (const file of filesForKb1) {
    if (isDocsSystemPath(file)) continue;
    // 非源码/非业务文件：仍按规格「每个文件」检查；测试与配置也需覆盖或被模块声明。
    // 引导场景 allSourceFiles 已限制为源码扩展名。
    if (modules.length === 0) {
      failures.push({ rule: "KB-1", target: file });
      continue;
    }
    if (!coversPath(modules, file)) {
      failures.push({ rule: "KB-1", target: file });
    }
  }

  // —— KB-2：changelog 本合同条目 ——
  const changelogRel = "docs/system/changelog.md";
  const changelogText = readCandidateFile(
    worktreeDir,
    input.candidateSha,
    changelogRel,
  );
  if (changelogText === null) {
    failures.push({ rule: "KB-2", target: `${changelogRel} (missing)` });
  } else {
    const heading = new RegExp(
      `^##\\s+${escapeRegExp(input.contractId)}\\b`,
      "m",
    );
    if (!heading.test(changelogText)) {
      failures.push({
        rule: "KB-2",
        target: `${changelogRel} (no entry for ${input.contractId})`,
      });
    }
  }

  // —— KB-3：decisions_add → decisions/ 新文件 ——
  const decisionsAdd = designNote?.knowledge_delta.decisions_add ?? [];
  if (decisionsAdd.length > 0) {
    const newDecisionFiles = addedFilesUnder(
      worktreeDir,
      input.baseSha,
      input.candidateSha,
      "docs/system/decisions/",
    );
    for (const decisionId of decisionsAdd) {
      const hit = newDecisionFiles.some((rel) => {
        if (rel.includes(decisionId)) return true;
        const body = readCandidateFile(
          worktreeDir,
          input.candidateSha,
          rel,
        );
        return body !== null && body.includes(decisionId);
      });
      if (!hit) {
        failures.push({
          rule: "KB-3",
          target: `decisions_add:${decisionId}`,
        });
      }
    }
  }

  // —— KB-5：DesignNote interfaces 出现在 interfaces/<module>.md ——
  const ifaces = designNote?.interfaces ?? [];
  if (ifaces.length > 0) {
    for (const iface of ifaces) {
      const owner =
        modules.find((m) => m.interfaces.includes(iface.name))?.id ??
        designNote?.knowledge_delta.modules_upsert.find((m) =>
          m.interfaces.includes(iface.name),
        )?.id ??
        null;
      if (owner === null) {
        failures.push({
          rule: "KB-5",
          target: `${iface.name} (no owning module)`,
        });
        continue;
      }
      const rel = `docs/system/interfaces/${owner}.md`;
      const body = readCandidateFile(
        worktreeDir,
        input.candidateSha,
        rel,
      );
      if (body === null || !body.includes(iface.name)) {
        failures.push({
          rule: "KB-5",
          target: `${iface.name} → ${rel}`,
        });
      }
    }
  }

  // 去重（KB-1 在 modules 为空时可能对同一文件重复——上面已单次 push）
  const seen = new Set<string>();
  const deduped: KnowledgeFailure[] = [];
  for (const f of failures) {
    const key = `${f.rule}\0${f.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  return { ok: deduped.length === 0, failures: deduped };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Worker 指令「你会被这样检查」追加摘要（verification-strategy §8 第 3 项） */
export const KNOWLEDGE_CHECK_RULE_SUMMARIES: readonly string[] = [
  "KB-1：本次改动的每个文件（排除 docs/system/**）须被 modules.yaml 某模块 paths 覆盖",
  "KB-2：docs/system/changelog.md 须有以本合同号开头的条目",
  "KB-3：DesignNote decisions_add 每项须对应 decisions/ 下新文件",
  "KB-4：modules.yaml 通过 Schema 校验且 depends_on 无环",
  "KB-5：DesignNote interfaces 每项须出现在对应 interfaces/<module>.md",
];
