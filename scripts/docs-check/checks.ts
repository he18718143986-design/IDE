import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import picomatch from "picomatch";
import {
  COMMITTED_STATUSES,
  CONTRACT_CARD_FENCE_INFO,
  contractCardSchema,
  designContractViewOfCard,
  designNoteFromCard,
  type CardStatus,
  type ContractCard,
} from "../../src/lib/contract-card";
import { validateDesignNote } from "../../src/lib/design/design-note";
import { lexemes } from "../../src/lib/journey/graveyard-match";
import { collectAnchors, collectLinks, fencedBlocks } from "./markdown";

export type Severity = "error" | "warn";

export interface Finding {
  severity: Severity;
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export const CARD_FENCE_INFO = CONTRACT_CARD_FENCE_INFO;

/** docs/ 里的卡用任务卡号当合同号。 */
const TASK_ID = /^TASK-[A-Z0-9]+(\.[0-9a-z-]+)*$/;

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
  card: ContractCard;
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
      const parsed = contractCardSchema.safeParse(raw);
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
      if (!TASK_ID.test(parsed.data.id)) {
        findings.push({
          severity: "error",
          rule: "card-schema",
          file,
          line: block.line,
          message: `id：卡号形如 TASK-C.4 / TASK-W.5c-iii，得到 ${parsed.data.id}`,
        });
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
  /** DN-3 的测试目录（本仓即 vitest include） */
  testPathPatterns: readonly string[];
}

const GLOB_CHARS = /[*?[\]{}]/;

/** 验证命令的 argv 是否会跑到这个测试文件：同名，或是它的上级目录。 */
function commandCovers(args: readonly string[], testPath: string): boolean {
  return args.some((a) => {
    const arg = a.replace(/^\.\//, "").replace(/\/$/, "");
    return arg === testPath || testPath.startsWith(`${arg}/`);
  });
}

export function checkCard(
  ctx: CardCheckContext,
  located: LocatedCard,
  all: Map<string, ContractCard>,
): Finding[] {
  const { repo } = ctx;
  const { card, file, line } = located;
  const { contract, design, governance: gov } = card;
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

  // 卡是状态的第三份副本：必须与矩阵、索引一致
  for (const src of [ctx.matrix.get(card.id), ctx.index.get(card.id)]) {
    if (src && src.status !== card.status) {
      err(
        "card-status",
        `卡状态 ${card.status} ≠ ${src.file}:${src.line} 的 ${src.status ?? "?"}`,
      );
    }
  }
  if (!ctx.matrix.has(card.id)) err("card-status", "不在 §1.1 矩阵里");

  // 合同能导出卡，但入库的任务卡还要满足就绪标准里合同不承载的那几条
  if (gov.spec_refs.length === 0 && contract.scheme_item_ids.length === 0)
    err("card-dor", "R-1：spec_refs 与 contract.scheme_item_ids 至少写一项");
  if (gov.code_facts.length === 0) err("card-dor", "R-4：code_facts 为空");
  if (gov.non_goals.length === 0) err("card-dor", "R-6：non_goals 为空");
  if (gov.fail.length === 0) err("card-dor", "R-8：fail 为空");
  if (gov.estimate === undefined) err("card-dor", "R-11：缺 estimate");
  if (gov.invariants === undefined) err("card-dor", "R-12：缺 invariants");
  if (done && gov.delivered === undefined)
    err("card-dor", "COMPLETED 必须写 governance.delivered（PR 与 commit）");

  for (const ref of gov.spec_refs) {
    const problem = checkDocRef(repo, ref);
    if (problem) err("card-spec-ref", problem);
  }

  for (const dep of gov.depends_on) {
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
    for (const fact of gov.code_facts) {
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

  // DN-1～DN-5：与 Worker 交付时 Daemon 跑的是同一套校验
  const dn = validateDesignNote(
    designNoteFromCard(card),
    designContractViewOfCard(card),
    [],
    { testPathPatterns: ctx.testPathPatterns },
  );
  if (!dn.ok) err("card-design", `${dn.rule}：${dn.message}`);

  if (notStarted) {
    for (const p of contract.scope.readonly_paths) {
      if (!GLOB_CHARS.test(p) && !repo.exists(p))
        err("card-scope", `只读范围里的文件不存在：${p}`);
    }
  }

  for (const t of design.touches) {
    const exists = repo.exists(t.path);
    if (done) {
      if (t.change === "delete" && exists)
        err("card-touches", `声明删除的文件仍存在：${t.path}`);
      if (t.change !== "delete" && !exists)
        err("card-touches", `交付的文件不存在：${t.path}`);
      if (exists && t.change !== "delete") {
        const src = repo.read(t.path) ?? "";
        for (const s of t.symbols) {
          if (!declaresSymbol(src, s))
            err("card-touches", `交付的符号 ${s} 在 ${t.path} 中没有声明`);
        }
      }
    } else if (notStarted) {
      if (t.change !== "create" && !exists)
        err("card-touches", `要改的文件不存在：${t.path}`);
      if (t.change === "create" && exists)
        warn("card-touches", `声明新建的文件已经存在：${t.path}`);
    }
  }

  const commands = contract.verification.commands;
  for (const t of design.test_plan) {
    const label = `${t.acceptance_id}（${t.test_path}）`;
    if (!ctx.isTestFile(t.test_path)) {
      err("card-test", `${label} 不在 vitest include 范围内，CI 永远不会跑它`);
    }
    if (
      t.debt === undefined &&
      !commands.some((c) => commandCovers(c.args, t.test_path))
    ) {
      err("card-verification", `${label} 没有被任何验证命令跑到`);
    }
    if (!done) continue;
    if (t.case === undefined && t.debt === undefined) {
      err("card-test", `${label} 已完成的卡必须写 case，指明兑现它的用例`);
      continue;
    }
    const src = repo.read(t.test_path);
    if (src === null && t.debt === undefined) {
      err("card-test", `${label} 测试文件不存在`);
      continue;
    }
    const hit =
      src === null || t.case === undefined
        ? { found: false, skipped: false }
        : findTestCase(src, t.case);
    if (t.debt !== undefined) {
      if (hit.found && !hit.skipped)
        err("card-test", `${label} 的用例已存在，删掉 debt 字段以销账`);
      else warn("card-test-debt", `${label} 没有测试兑现，挂账：${t.debt}`);
      continue;
    }
    if (!hit.found)
      err("card-test", `${label} 找不到标题含「${t.case}」的用例`);
    else if (hit.skipped)
      err("card-test", `${label} 对应用例被 skip / todo：「${t.case}」`);
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
    for (const dep of graph.get(id)?.card.governance.depends_on ?? []) {
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
    // 与产品引擎同口径（scheme-patch-engine 的 mainTextOf）：目标类取 text，
    // 模块类取 name + purpose，决策类取 question + 选中项。
    const mainText = [
      cells["text"],
      cells["name"],
      cells["purpose"],
      cells["question"],
      cells["recommended"],
    ]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(" ");
    const textLex = new Set(lexemes(plain(mainText)));
    const tethered = cited.some((q) =>
      lexemes(plain(quotes.get(q)!)).some((x) => textLex.has(x)),
    );
    if (!tethered) {
      findings.push({
        severity: "warn",
        rule: "scheme-tether",
        file: SCHEME_FILE,
        line,
        message: `${id} 标为 user_said，但 text 与 ${cited.join("/")} 没有共同词素，应改标 ai_inferred（W_SOURCE_DOWNGRADED_UNTETHERED）`,
      });
    }
  }
  return findings;
}

// ── 命名与死引用（文档治理 2026-11-09）──────────────────────────────────

/** 小写 ASCII、数字；允许 `.`（如 v0.2）与 `-` 分段。 */
const KEBAB_STEM = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
/** 惯例大写文件名，不走 kebab-case。 */
const CONVENTIONAL_NAMES = new Set(["README.md", "CONTRIBUTING.md"]);
/** reports/ 时点快照允许的日期后缀。 */
const REPORT_DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

export function checkFilenames(files: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const base = path.posix.basename(file);
    if (CONVENTIONAL_NAMES.has(base)) continue;
    let stem = path.posix.parse(base).name;
    if (file.startsWith("docs/reports/"))
      stem = stem.replace(REPORT_DATE_SUFFIX, "");
    if (!KEBAB_STEM.test(stem)) {
      findings.push({
        severity: "error",
        rule: "filename-kebab",
        file,
        message: `文件名不是 kebab-case（小写英文、数字与连字符；reports/ 可加 -YYYY-MM-DD）：${base}`,
      });
    }
  }
  return findings;
}

/** 已删除的 docs/archive/：正文里的路径只允许出现在溯源语境中。 */
const ARCHIVE_PATH = /docs\/archive\//;
const ARCHIVE_HISTORICAL =
  /Git 历史|已移除|已随|原文查|git log|原 `docs\/archive\//;

export function checkArchiveRefs(repo: Repo, files: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const content = repo.read(file);
    if (content === null) continue;
    content.split("\n").forEach((line, i) => {
      if (ARCHIVE_PATH.test(line) && !ARCHIVE_HISTORICAL.test(line)) {
        findings.push({
          severity: "warn",
          rule: "archive-ref",
          file,
          line: i + 1,
          message:
            "疑似引用已删除的 docs/archive/，请改为「见 Git 历史」或指向现行文件",
        });
      }
    });
  }
  return findings;
}

// ── 汇总 ───────────────────────────────────────────────────────────────────

export interface RunOptions {
  /** 测试收录范围（本仓为 vitest.globs.ts） */
  testInclude: string[];
  testExclude: string[];
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
    isTestFile: makeTestMatcher(opts.testInclude, opts.testExclude),
    testPathPatterns: opts.testInclude,
  };
  const findings = [
    ...checkLinks(repo, docs),
    ...checkStatusSync(matrix, index),
    ...parseFindings,
    ...cards.flatMap((c) => checkCard(ctx, c, all)),
    ...checkDependencyCycles(cards),
    ...checkScheme(repo),
    ...checkFilenames(docs),
    ...checkArchiveRefs(repo, docs),
  ];
  return { findings, cards };
}
