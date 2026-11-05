import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import picomatch from "picomatch";
import {
  COMMITTED_STATUSES,
  cardHeaderSchema,
  type CardHeader,
  type CardStatus,
} from "./card-header.schema";
import { collectAnchors, collectLinks, fencedBlocks } from "./markdown";

export type Severity = "error" | "warn";

export interface Finding {
  severity: Severity;
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export const CARD_FENCE_INFO = "yaml task-card";

/** 读仓库文件的唯一入口；测试里换成临时目录。 */
export class Repo {
  private readonly cache = new Map<string, string | null>();
  constructor(readonly root: string) {}

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  exists(rel: string): boolean {
    return fs.existsSync(this.abs(rel));
  }

  read(rel: string): string | null {
    if (!this.cache.has(rel)) {
      const p = this.abs(rel);
      this.cache.set(
        rel,
        fs.existsSync(p) && fs.statSync(p).isFile()
          ? fs.readFileSync(p, "utf8")
          : null,
      );
    }
    return this.cache.get(rel) ?? null;
  }

  listMarkdown(dir: string): string[] {
    const out: string[] = [];
    const walk = (rel: string) => {
      const p = this.abs(rel);
      if (!fs.existsSync(p)) return;
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const child = path.posix.join(rel, e.name);
        if (e.isDirectory()) walk(child);
        else if (e.name.endsWith(".md")) out.push(child);
      }
    };
    walk(dir);
    return out.sort();
  }
}

// ── 链接与锚点 ─────────────────────────────────────────────────────────────

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function checkLinks(repo: Repo, files: string[]): Finding[] {
  const findings: Finding[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = (rel: string) => {
    let a = anchorCache.get(rel);
    if (!a) {
      a = collectAnchors(repo.read(rel) ?? "");
      anchorCache.set(rel, a);
    }
    return a;
  };

  for (const file of files) {
    const content = repo.read(file);
    if (content === null) continue;
    for (const link of collectLinks(content)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.target)) continue;
      const [rawPath = "", rawAnchor] = link.target.split("#", 2);
      const targetRel = rawPath
        ? path.posix.normalize(
            path.posix.join(path.posix.dirname(file), safeDecode(rawPath)),
          )
        : file;
      if (targetRel.startsWith("..")) {
        findings.push({
          severity: "error",
          rule: "link-target",
          file,
          line: link.line,
          message: `链接指向仓库之外：${link.target}`,
        });
        continue;
      }
      if (!repo.exists(targetRel)) {
        findings.push({
          severity: "error",
          rule: "link-target",
          file,
          line: link.line,
          message: `链接目标不存在：${link.target}`,
        });
        continue;
      }
      if (rawAnchor && targetRel.endsWith(".md")) {
        const anchor = safeDecode(rawAnchor);
        if (!anchorsOf(targetRel).has(anchor)) {
          findings.push({
            severity: "error",
            rule: "link-anchor",
            file,
            line: link.line,
            message: `锚点不存在：${link.target}`,
          });
        }
      }
    }
  }
  return findings;
}

// ── 状态来源：§1.1 矩阵与卡号索引 ─────────────────────────────────────────

export const MATRIX_FILE = "docs/specs/development-tasks.md";
export const INDEX_FILE = "docs/specs/development-tasks-index.md";

export function normalizeStatus(cell: string): CardStatus | null {
  const m =
    /\b(NEW_TASK|READY|IN_PROGRESS|BLOCKED|COMPLETED|DEFERRED|SPLIT|PASS)\b/.exec(
      cell,
    );
  if (!m) return null;
  return m[1] === "PASS" ? "COMPLETED" : (m[1] as CardStatus);
}

export interface StatusSource {
  file: string;
  line: number;
  status: CardStatus | null;
}

export function readMatrix(repo: Repo): Map<string, StatusSource> {
  const out = new Map<string, StatusSource>();
  (repo.read(MATRIX_FILE) ?? "").split(/\r?\n/).forEach((line, i) => {
    const m = /^\|\s*\*\*(TASK-[^*\s]+)\*\*\s*\|[^|]*\|[^|]*\|([^|]*)\|/.exec(
      line,
    );
    if (m && !out.has(m[1]!)) {
      out.set(m[1]!, {
        file: MATRIX_FILE,
        line: i + 1,
        status: normalizeStatus(m[2]!),
      });
    }
  });
  return out;
}

export function readIndex(repo: Repo): Map<string, StatusSource> {
  const out = new Map<string, StatusSource>();
  (repo.read(INDEX_FILE) ?? "").split(/\r?\n/).forEach((line, i) => {
    const m = /^\|\s*`(TASK-[^`]+)`\s*\|\s*`([^`]+)`/.exec(line);
    if (m && !out.has(m[1]!)) {
      out.set(m[1]!, {
        file: INDEX_FILE,
        line: i + 1,
        status: normalizeStatus(m[2]!),
      });
    }
  });
  return out;
}

export function checkStatusSync(
  matrix: Map<string, StatusSource>,
  index: Map<string, StatusSource>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [id, row] of index) {
    const m = matrix.get(id);
    if (!m) {
      findings.push({
        severity: "error",
        rule: "status-sync",
        file: row.file,
        line: row.line,
        message: `${id} 在索引里有、在 §1.1 矩阵里没有`,
      });
    } else if (m.status !== row.status) {
      findings.push({
        severity: "error",
        rule: "status-sync",
        file: row.file,
        line: row.line,
        message: `${id} 索引状态 ${row.status ?? "?"} ≠ 矩阵状态 ${m.status ?? "?"}（${m.file}:${m.line}）`,
      });
    }
  }
  for (const [id, m] of matrix) {
    if (!index.has(id)) {
      findings.push({
        severity: "error",
        rule: "status-sync",
        file: m.file,
        line: m.line,
        message: `${id} 在 §1.1 矩阵里有、在索引里没有`,
      });
    }
  }
  return findings;
}

// ── 卡头 ───────────────────────────────────────────────────────────────────

export interface LocatedCard {
  card: CardHeader;
  file: string;
  line: number;
}

export function parseCardHeaders(
  repo: Repo,
  files: string[],
): { cards: LocatedCard[]; findings: Finding[] } {
  const cards: LocatedCard[] = [];
  const findings: Finding[] = [];
  for (const file of files) {
    const content = repo.read(file);
    if (content === null) continue;
    for (const block of fencedBlocks(content)) {
      if (block.info !== CARD_FENCE_INFO) continue;
      let raw: unknown;
      try {
        raw = yaml.load(block.body);
      } catch (err) {
        findings.push({
          severity: "error",
          rule: "card-schema",
          file,
          line: block.line,
          message: `卡头 YAML 解析失败：${(err as Error).message.split("\n")[0]}`,
        });
        continue;
      }
      const parsed = cardHeaderSchema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          findings.push({
            severity: "error",
            rule: "card-schema",
            file,
            line: block.line,
            message: `${issue.path.join(".") || "(root)"}：${issue.message}`,
          });
        }
        continue;
      }
      cards.push({ card: parsed.data, file, line: block.line });
    }
  }
  const seen = new Map<string, LocatedCard>();
  for (const c of cards) {
    const prev = seen.get(c.card.id);
    if (prev) {
      findings.push({
        severity: "error",
        rule: "card-schema",
        file: c.file,
        line: c.line,
        message: `${c.card.id} 卡头重复（另一处在 ${prev.file}:${prev.line}）`,
      });
    }
    seen.set(c.card.id, c);
  }
  return { cards, findings };
}

/** 只认声明位置，不认引用：函数 / 类 / 类型 / 变量声明、对象或接口成员、具名导出。 */
export function declaresSymbol(source: string, symbol: string): boolean {
  const s = symbol.replace(/\$/g, "\\$");
  const patterns = [
    new RegExp(
      `\\b(?:function\\*?|class|interface|type|enum|const|let|var|namespace)\\s+${s}\\b`,
    ),
    new RegExp(`^\\s*(?:readonly\\s+)?${s}\\??\\s*(?::|=(?!=))`, "m"),
    new RegExp(
      `^\\s*(?:(?:public|private|protected|static|async|override)\\s+)*${s}\\??\\s*\\([^)]*\\)\\s*(?:\\{|:[^{;]*[{;])`,
      "m",
    ),
    new RegExp(`export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`),
  ];
  return patterns.some((p) => p.test(source));
}

export type TestGlobMatcher = (rel: string) => boolean;

export function makeTestMatcher(
  include: string[],
  exclude: string[],
): TestGlobMatcher {
  const inc = picomatch(include);
  const exc = picomatch(exclude);
  return (rel) => inc(rel) && !exc(rel);
}

const TEST_TITLE =
  /\b(?:it|test)(?:\.(\w+))?\s*\(\s*(["'`])((?:\\.|(?!\2).)*)\2/g;

export function findTestCase(
  source: string,
  needle: string,
): { found: boolean; skipped: boolean } {
  for (const m of source.matchAll(TEST_TITLE)) {
    if (m[3]!.includes(needle)) {
      return { found: true, skipped: m[1] === "skip" || m[1] === "todo" };
    }
  }
  return { found: false, skipped: false };
}

function checkDocRef(repo: Repo, ref: string): string | null {
  const [file = "", anchor] = ref.split("#", 2);
  if (!repo.exists(file)) return `文件不存在：${file}`;
  if (
    anchor &&
    !collectAnchors(repo.read(file) ?? "").has(safeDecode(anchor))
  ) {
    return `锚点不存在：${ref}`;
  }
  return null;
}

export interface CardCheckContext {
  repo: Repo;
  matrix: Map<string, StatusSource>;
  index: Map<string, StatusSource>;
  isTestFile: TestGlobMatcher;
}

export function checkCard(
  ctx: CardCheckContext,
  located: LocatedCard,
  all: Map<string, CardHeader>,
): Finding[] {
  const { repo } = ctx;
  const { card, file, line } = located;
  const findings: Finding[] = [];
  const err = (rule: string, message: string) =>
    findings.push({
      severity: "error",
      rule,
      file,
      line,
      message: `${card.id} ${message}`,
    });
  const warn = (rule: string, message: string) =>
    findings.push({
      severity: "warn",
      rule,
      file,
      line,
      message: `${card.id} ${message}`,
    });

  const done = card.status === "COMPLETED";
  const notStarted =
    card.status === "NEW_TASK" ||
    card.status === "READY" ||
    card.status === "BLOCKED";

  // 卡头是状态的第三份副本：必须与矩阵、索引一致
  for (const src of [ctx.matrix.get(card.id), ctx.index.get(card.id)]) {
    if (src && src.status !== card.status) {
      err(
        "card-status",
        `卡头状态 ${card.status} ≠ ${src.file}:${src.line} 的 ${src.status ?? "?"}`,
      );
    }
  }
  if (!ctx.matrix.has(card.id)) err("card-status", "不在 §1.1 矩阵里");

  for (const ref of card.spec_refs) {
    const problem = checkDocRef(repo, ref);
    if (problem) err("card-spec-ref", problem);
  }

  for (const dep of card.depends_on) {
    const depStatus =
      all.get(dep.id)?.status ??
      ctx.index.get(dep.id)?.status ??
      ctx.matrix.get(dep.id)?.status;
    if (depStatus === undefined) {
      err("card-deps", `依赖 ${dep.id} 不存在`);
    } else if (
      dep.kind === "hard" &&
      COMMITTED_STATUSES.includes(card.status) &&
      depStatus !== "COMPLETED"
    ) {
      err(
        "card-deps",
        `硬依赖 ${dep.id} 状态为 ${depStatus ?? "?"}，本卡不得处于 ${card.status}（R-3）`,
      );
    }
  }

  // 代码事实描述的是开工前的代码；卡完成后它本该过期，所以只在开工前核验
  if (!done) {
    for (const fact of card.code_facts) {
      const sym = /^(.*?)::(.+)$/.exec(fact.ref);
      const lines = /^(.*?):(\d+)(?:-(\d+))?$/.exec(fact.ref);
      const target = sym?.[1] ?? lines?.[1] ?? fact.ref;
      const src = repo.read(target);
      if (src === null) {
        err("card-code-fact", `代码事实指向的文件不存在：${fact.ref}`);
      } else if (
        sym &&
        !new RegExp(
          `\\b${sym[2]!.split(".").pop()!.replace(/\$/g, "\\$")}\\b`,
        ).test(src)
      ) {
        err("card-code-fact", `代码事实里的符号找不到：${fact.ref}`);
      } else if (lines) {
        const total = src.split(/\r?\n/).length;
        const end = Number(lines[3] ?? lines[2]);
        if (end > total)
          err(
            "card-code-fact",
            `代码事实行号越界（文件共 ${total} 行）：${fact.ref}`,
          );
      }
    }
  }

  for (const t of card.touches) {
    const exists = repo.exists(t.path);
    if (done) {
      if (t.action === "delete" && exists)
        err("card-touches", `声明删除的文件仍存在：${t.path}`);
      if (t.action !== "delete" && !exists)
        err("card-touches", `交付的文件不存在：${t.path}`);
      if (exists && t.action !== "delete") {
        const src = repo.read(t.path) ?? "";
        for (const s of t.symbols) {
          if (!declaresSymbol(src, s))
            err("card-touches", `交付的符号 ${s} 在 ${t.path} 中没有声明`);
        }
      }
    } else if (notStarted) {
      if (t.action !== "create" && !exists)
        err(
          "card-touches",
          `要${t.action === "read" ? "读" : "改"}的文件不存在：${t.path}`,
        );
      if (t.action === "create" && exists)
        warn("card-touches", `声明新建的文件已经存在：${t.path}`);
    }
  }

  for (const p of card.pass) {
    if (!ctx.isTestFile(p.test)) {
      err(
        "card-pass",
        `${p.id} 的测试文件不在 vitest include 范围内，CI 永远不会跑它：${p.test}`,
      );
    }
    if (!done) continue;
    const src = repo.read(p.test);
    if (src === null && p.debt === undefined) {
      err("card-pass", `${p.id} 的测试文件不存在：${p.test}`);
      continue;
    }
    const hit =
      src === null
        ? { found: false, skipped: false }
        : findTestCase(src, p.case);
    if (p.debt !== undefined) {
      if (hit.found && !hit.skipped)
        err("card-pass", `${p.id} 的用例已存在，删掉 debt 字段以销账`);
      else warn("card-pass-debt", `${p.id} 没有测试兑现，挂账：${p.debt}`);
      continue;
    }
    if (!hit.found)
      err(
        "card-pass",
        `${p.id} 在 ${p.test} 中找不到标题含「${p.case}」的用例`,
      );
    else if (hit.skipped)
      err("card-pass", `${p.id} 对应用例被 skip / todo：「${p.case}」`);
  }

  return findings;
}

export function checkDependencyCycles(cards: LocatedCard[]): Finding[] {
  const graph = new Map(cards.map((c) => [c.card.id, c]));
  const state = new Map<string, "visiting" | "done">();
  const findings: Finding[] = [];
  const visit = (id: string, stack: string[]) => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      const at = graph.get(id)!;
      findings.push({
        severity: "error",
        rule: "card-deps",
        file: at.file,
        line: at.line,
        message: `依赖成环：${cycle.join(" → ")}`,
      });
      return;
    }
    state.set(id, "visiting");
    for (const dep of graph.get(id)?.card.depends_on ?? []) {
      if (graph.has(dep.id)) visit(dep.id, [...stack, id]);
    }
    state.set(id, "done");
  };
  for (const id of graph.keys()) visit(id, []);
  return findings;
}

// ── scheme.md：user_said 必须追到原话 ─────────────────────────────────────

export const SCHEME_FILE = "docs/scheme.md";

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function plain(md: string): string {
  return md
    .replace(/\*\*|`|~~/g, "")
    .replace(/[。.]$/, "")
    .trim();
}

export function checkScheme(repo: Repo): Finding[] {
  const content = repo.read(SCHEME_FILE);
  if (content === null) return [];
  const lines = content.split(/\r?\n/);
  const quotes = new Map<string, string>();
  const findings: Finding[] = [];

  let header: string[] | null = null;
  const rows: { cells: Record<string, string>; line: number }[] = [];
  lines.forEach((line, i) => {
    if (!line.trim().startsWith("|")) {
      header = null;
      return;
    }
    const cells = splitRow(line);
    if (header === null) {
      header = cells;
      return;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) return;
    const record: Record<string, string> = {};
    header.forEach((h, k) => (record[h] = cells[k] ?? ""));
    if (header[0] === "qid" && /^q\d+$/.test(record["qid"] ?? "")) {
      quotes.set(record["qid"]!, record["text"] ?? "");
    }
    rows.push({ cells: record, line: i + 1 });
  });

  for (const { cells, line } of rows) {
    if (!/user_said/.test(cells["source"] ?? "")) continue;
    const id = cells["id"] ?? "?";
    const cited = [...(cells["evidence"] ?? "").matchAll(/\bq\d+\b/g)].map(
      (m) => m[0],
    );
    if (cited.length === 0) {
      findings.push({
        severity: "error",
        rule: "scheme-quote",
        file: SCHEME_FILE,
        line,
        message: `${id} 标为 user_said，但 evidence 没有引用任何原话 qid`,
      });
      continue;
    }
    const missing = cited.filter((q) => !quotes.has(q));
    if (missing.length > 0) {
      findings.push({
        severity: "error",
        rule: "scheme-quote",
        file: SCHEME_FILE,
        line,
        message: `${id} 引用的原话不存在：${missing.join("、")}`,
      });
      continue;
    }
    const text = plain(cells["text"] ?? "");
    if (!cited.some((q) => plain(quotes.get(q)!).includes(text))) {
      findings.push({
        severity: "warn",
        rule: "scheme-verbatim",
        file: SCHEME_FILE,
        line,
        message: `${id} 标为 user_said，但 text 不是 ${cited.join("/")} 的逐字子串（acc-4 / INV-LEDGER-01）`,
      });
    }
  }
  return findings;
}

// ── 汇总 ───────────────────────────────────────────────────────────────────

export interface RunOptions {
  isTestFile: TestGlobMatcher;
}

export function runAllChecks(
  repo: Repo,
  opts: RunOptions,
): { findings: Finding[]; cards: LocatedCard[] } {
  const docs = repo.listMarkdown("docs");
  const matrix = readMatrix(repo);
  const index = readIndex(repo);
  const { cards, findings: parseFindings } = parseCardHeaders(repo, docs);
  const all = new Map(cards.map((c) => [c.card.id, c.card]));
  const ctx: CardCheckContext = {
    repo,
    matrix,
    index,
    isTestFile: opts.isTestFile,
  };
  const findings = [
    ...checkLinks(repo, docs),
    ...checkStatusSync(matrix, index),
    ...parseFindings,
    ...cards.flatMap((c) => checkCard(ctx, c, all)),
    ...checkDependencyCycles(cards),
    ...checkScheme(repo),
  ];
  return { findings, cards };
}
