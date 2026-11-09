#!/usr/bin/env tsx
/**
 * 性能阈值挂卡门禁（确定性、零模型，TASK-CI.2 配套）。
 *
 * 规则：PR diff 若触及「性能阈值断言行」——perf 测试文件中新增或删除的
 * `.toBeLessThan(` / `.toBeLessThanOrEqual(` 行（改数字也算，表现为一删一增）——
 * 则 PR 描述，或 docs 新增行，必须引用至少一张真实存在的任务卡号（如 `TASK-CI.2`）。
 * 否则退出码 1。
 *
 * 门禁只保证「球门挪动有卡可查」，不判断阈值改得对不对；卡的内容是否对应本次改动仍需人审。
 * 失败关闭：git diff 失败、卡片文档读不到，都视为失败，不放行。
 *
 *   CI（pull_request 事件）：npx tsx scripts/perf-threshold-gate.ts   （读 GITHUB_EVENT_PATH）
 *   本地：npx tsx scripts/perf-threshold-gate.ts --base <sha> --head <sha> [--body-file <path>]
 *   其它事件（push、workflow_dispatch）：直接放行。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const THRESHOLD_ASSERT_RE = /\.toBeLessThan(?:OrEqual)?\(/;
const TEST_FILE_RE = /^tests\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CARD_ID_RE = /\bTASK-[A-Z]{1,4}\.\d+[a-z]?\b/g;
/** 卡号的权威来源：矩阵、进行中卡、已完成卡。changelog 里的提及不算立卡。 */
export const CARD_DOCS = [
  "docs/specs/development-tasks.md",
  "docs/specs/development-tasks-active.md",
  "docs/specs/development-tasks-completed.md",
];

/** perf 测试文件：tests/perf/ 下的测试，或文件名含 perf，或已知的两条性能类断言文件。 */
export function isPerfTestFile(file: string): boolean {
  if (!TEST_FILE_RE.test(file)) return false;
  if (file.startsWith("tests/perf/")) return true;
  const base = path.posix.basename(file);
  return (
    /perf/i.test(base) ||
    base.startsWith("arch-graph-cache.") ||
    base.startsWith("pre-merge-fingerprint")
  );
}

export interface Touch {
  file: string;
  side: "+" | "-";
  line: string;
}

export interface DiffScan {
  touches: Touch[];
  addedDocLines: string[];
}

function stripDiffPrefix(p: string): string | null {
  if (p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

/** 解析 `git diff -U0` 文本。hunk 内以 +/- 开头的行一律按内容处理（含 `-- x` 这类被删行）。 */
export function scanDiff(diff: string): DiffScan {
  const touches: Touch[] = [];
  const addedDocLines: string[] = [];
  let newFile: string | null = null;
  let oldFile: string | null = null;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      newFile = null;
      oldFile = null;
      inHunk = false;
      continue;
    }
    if (raw.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith("--- ")) oldFile = stripDiffPrefix(raw.slice(4));
      else if (raw.startsWith("+++ ")) newFile = stripDiffPrefix(raw.slice(4));
      continue;
    }
    const sign = raw[0];
    if (sign !== "+" && sign !== "-") continue;
    const text = raw.slice(1);
    if (sign === "+") {
      if (newFile?.startsWith("docs/")) addedDocLines.push(text);
      if (
        newFile &&
        isPerfTestFile(newFile) &&
        THRESHOLD_ASSERT_RE.test(text)
      ) {
        touches.push({ file: newFile, side: "+", line: text.trim() });
      }
    } else if (
      oldFile &&
      isPerfTestFile(oldFile) &&
      THRESHOLD_ASSERT_RE.test(text)
    ) {
      touches.push({ file: oldFile, side: "-", line: text.trim() });
    }
  }
  return { touches, addedDocLines };
}

export function extractCardIds(text: string): string[] {
  return [...new Set(text.match(CARD_ID_RE) ?? [])];
}

export interface GateInput {
  touches: Touch[];
  prBody: string;
  addedDocLines: string[];
  knownCards: Set<string>;
}

export interface GateVerdict {
  ok: boolean;
  message: string;
}

export function evaluateGate(input: GateInput): GateVerdict {
  if (input.touches.length === 0) {
    return { ok: true, message: "未触及性能阈值断言行，放行。" };
  }
  const refs = [
    ...new Set([
      ...extractCardIds(input.prBody),
      ...extractCardIds(input.addedDocLines.join("\n")),
    ]),
  ];
  const head = `触及 ${input.touches.length} 处性能阈值断言行`;
  if (refs.length === 0) {
    return {
      ok: false,
      message: `${head}，但 PR 描述与 docs 新增行都没有引用任务卡号（如 TASK-CI.2）。阈值改动须先挂卡留痕。`,
    };
  }
  const valid = refs.filter((r) => input.knownCards.has(r));
  if (valid.length === 0) {
    return {
      ok: false,
      message: `${head}，引用的 ${refs.join("、")} 在任务矩阵 / 进行中卡 / 已完成卡中均不存在。`,
    };
  }
  return {
    ok: true,
    message: `${head}，已引用真实存在的任务卡：${valid.join("、")}，放行。`,
  };
}

interface GateArgs {
  base?: string;
  head?: string;
  bodyFile?: string;
}

function parseArgs(argv: string[]): GateArgs {
  const out: GateArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (next === undefined) break;
    if (argv[i] === "--base") {
      out.base = next;
      i++;
    } else if (argv[i] === "--head") {
      out.head = next;
      i++;
    } else if (argv[i] === "--body-file") {
      out.bodyFile = next;
      i++;
    }
  }
  return out;
}

function fail(message: string): number {
  console.error(`::error::${message}`);
  console.error(`✖ 性能阈值挂卡门禁失败：${message}`);
  return 1;
}

interface PrRange {
  base: string;
  head: string;
  body: string;
}

function main(argv: string[]): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseArgs(argv);
  const eventName = process.env["GITHUB_EVENT_NAME"];
  const eventPath = process.env["GITHUB_EVENT_PATH"];

  let range: PrRange;
  if (args.base !== undefined && args.head !== undefined) {
    const bodyFile = args.bodyFile;
    const body =
      bodyFile !== undefined && existsSync(bodyFile)
        ? readFileSync(bodyFile, "utf8")
        : "";
    range = { base: args.base, head: args.head, body };
  } else if (eventName !== undefined && eventName !== "pull_request") {
    console.log(`非 pull_request 事件（${eventName}），门禁不适用，放行。`);
    return 0;
  } else if (
    eventName === "pull_request" &&
    eventPath !== undefined &&
    existsSync(eventPath)
  ) {
    const pr = JSON.parse(readFileSync(eventPath, "utf8")).pull_request;
    range = {
      base: String(pr.base.sha),
      head: String(pr.head.sha),
      body: String(pr.body ?? ""),
    };
  } else {
    console.error(
      "用法：--base <sha> --head <sha> [--body-file <path>]（CI 中由 pull_request 事件自动读取）",
    );
    return 2;
  }

  let diff: string;
  try {
    diff = execFileSync(
      "git",
      ["diff", "-U0", "--no-color", `${range.base}...${range.head}`],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return fail(
      `无法读取 ${range.base}...${range.head} 的 diff（失败关闭）：${reason}`,
    );
  }

  const scan = scanDiff(diff);
  for (const t of scan.touches) {
    console.log(`  · [${t.side}] ${t.file}: ${t.line}`);
  }

  const knownCards = new Set<string>();
  if (scan.touches.length > 0) {
    for (const rel of CARD_DOCS) {
      const abs = path.join(root, rel);
      if (!existsSync(abs)) return fail(`任务卡文档缺失：${rel}（失败关闭）`);
      for (const id of extractCardIds(readFileSync(abs, "utf8"))) {
        knownCards.add(id);
      }
    }
  }

  const verdict = evaluateGate({
    touches: scan.touches,
    prBody: range.body,
    addedDocLines: scan.addedDocLines,
    knownCards,
  });
  if (!verdict.ok) return fail(verdict.message);
  console.log(`✔ 性能阈值挂卡门禁：${verdict.message}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = main(process.argv.slice(2));
}
