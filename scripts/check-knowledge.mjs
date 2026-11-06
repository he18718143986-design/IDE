#!/usr/bin/env node
/**
 * 仓库级知识库自检（ADR-0016 决策 4）：用 `stagent check knowledge --all`
 * 核对 docs/system/modules.yaml 是否覆盖本仓全部源码，并校验 Schema 与无环。
 *
 * 与合同口径的区别：
 * - 合同流程按 `base..candidate` 的 diff 检查「本次改动的文件」；
 * - 本仓不用合同开发自己，因此按 `--all` 检查全部源码，合同号用固定的
 *   `repo-knowledge-baseline`（docs/system/changelog.md 里有对应条目）。
 *
 * base / candidate 仍要传：KB-2 用 candidate 读 changelog，KB-3/KB-5 用 diff
 * 核对决策与接口登记。HEAD^ 不存在（浅克隆或首个提交）时退化为 candidate 自身。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const candidate = git("rev-parse", "HEAD");
let base = candidate;
try {
  base = git("rev-parse", "HEAD^");
} catch {
  // 浅克隆：退回 candidate，--all 已覆盖 KB-1，其余规则不依赖 diff
}

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const cli = path.join(root, "bin", "stagent.ts");

execFileSync(
  process.execPath,
  [
    tsx,
    cli,
    "check",
    "knowledge",
    "--all",
    "--base",
    base,
    "--candidate",
    candidate,
    "--contract-id",
    "repo-knowledge-baseline",
  ],
  { cwd: root, stdio: "inherit" },
);
