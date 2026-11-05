#!/usr/bin/env tsx
/**
 * 文档门禁：链接与锚点、§1.1 矩阵与索引状态同步、任务卡头（Schema / 依赖 DAG /
 * 交付文件与符号 / PASS 用例）、scheme.md 的 user_said 溯源。
 *
 *   npm run check:docs            # 有 error 时退出码 1
 *   npm run check:docs -- --json  # 机器可读输出
 *   npm run check:docs -- --rule card-  # 只看某类规则（前缀匹配）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOM_INCLUDE, NODE_INCLUDE, PIPELINE_EXCLUDE } from "../vitest.globs";
import {
  makeTestMatcher,
  Repo,
  runAllChecks,
  type Finding,
} from "./docs-check/checks";

function main(argv: string[]): number {
  const json = argv.includes("--json");
  const ruleIdx = argv.indexOf("--rule");
  const rulePrefix = ruleIdx >= 0 ? argv[ruleIdx + 1] : undefined;

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { findings: all, cards } = runAllChecks(new Repo(root), {
    isTestFile: makeTestMatcher(
      [...NODE_INCLUDE, ...DOM_INCLUDE],
      PIPELINE_EXCLUDE,
    ),
  });
  const findings = rulePrefix
    ? all.filter((f) => f.rule.startsWith(rulePrefix))
    : all;
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");

  if (json) {
    console.log(
      JSON.stringify({ cards: cards.map((c) => c.card.id), findings }, null, 2),
    );
    return errors.length > 0 ? 1 : 0;
  }

  const byRule = new Map<string, Finding[]>();
  for (const f of findings)
    byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  for (const [rule, list] of [...byRule].sort()) {
    console.log(`\n[${rule}] ${list.length}`);
    for (const f of list) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      console.log(
        `  ${f.severity === "error" ? "✗" : "!"} ${loc}  ${f.message}`,
      );
    }
  }
  console.log(
    `\n卡头 ${cards.length} 张（${cards.map((c) => c.card.id).join("、") || "无"}）· error ${errors.length} · warn ${warns.length}`,
  );
  return errors.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
