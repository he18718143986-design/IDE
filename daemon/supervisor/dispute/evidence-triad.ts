import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import type { EvidenceBundle } from "../../../src/lib/evidence.schema";
import {
  lexemes,
  matchNormalize,
} from "../../../src/lib/journey/graveyard-match";
import type {
  SchemeDraftV2,
  SchemeItemMeta,
  TurnRef,
} from "../../../src/lib/journey/scheme-patch-types";
import { execGit } from "../../git/worktree-manager";
import { loadLatestEvidenceSnapshot } from "../../pipeline/merger";
import {
  readSchemeSnapshot,
  type SchemeSnapshot,
} from "../../pipeline/scheme-snapshot-store";
import { unquoteGitPath } from "../../pipeline/untracked-scope-guard";
import { readSchemeLedger } from "../intent-compiler/scheme-ledger-store";
import {
  readTranscript,
  type PersistedTranscriptTurn,
  type TranscriptRecord,
} from "../intent-compiler/transcript-store";
import { SupervisorSessionManager } from "../session-manager";
import type { SupervisorMessage, SupervisorSession } from "../types";
import { addedCodeLines } from "./added-code";
import type {
  DiffFact,
  PromptFact,
  PromptFactMessage,
  SpecFact,
  TriadFacts,
} from "./types";

/**
 * 三方事实抓取管道（TASK-S.5 / 架构 §5.7；口径见 playtest-self-check §2）。
 *
 * 三路事实全部来自已冻结或已提交的物理载体，任何一路缺失都显式标注：
 * - 左栏「你当时说的」：冻结方案条目的 `evidence` 锚定原话（修 P-2）；
 * - 中栏「确认的方案里记的」：确认快照 `.stagent/drafts/schemes/*.json`（修 P-1）；
 * - 右栏「代码实际做的」：证据包 `git_info` 的 `base..task` 区间 diff（修 P-3）。
 *
 * 本模块只抓事实，不做归因判断；归因在 `classification.ts`。
 * 所有外部依赖均可注入，测试不需要真实会话目录。
 */

const MAX_DIFF_CHARS = 20_000;
const MAX_TERMINAL_LINES = 200;
const MAX_SPEC_ENTRIES = 20;
const MAX_QUOTES = 20;

/**
 * 中文质询没有分词器可用：先剥离停用短语，再用 G-MATCH 的 `lexemes`
 * 取二元组（单一语义源，修 P-6）。
 * "订单页面没有满减折扣功能" → 订单 / 满减 / 减折 / 折扣。
 */
const STOP_PHRASES: readonly string[] = [
  "为什么",
  "怎么",
  "没有",
  "不是",
  "不能",
  "无法",
  "帮我",
  "请",
  "一下",
  "这个",
  "那个",
  "功能",
  "页面",
  "应该",
  "需要",
  "还是",
  "已经",
  "但是",
  "而且",
  "以及",
  "如果",
  "可以",
  "有没有",
  "问题",
  "缺少",
  "缺了",
  "少了",
  "没看到",
  "看不到",
  "明明",
];

/** 从白话质询中提取用于三方比对的关键词（确定性、无模型，复用 G-MATCH 词素） */
export function extractKeywords(text: string): string[] {
  let cleaned = text.normalize("NFKC").toLowerCase();
  for (const stop of STOP_PHRASES) {
    cleaned = cleaned.split(stop).join(" ");
  }
  return lexemes(cleaned)
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 40);
}

/**
 * 关键词命中：与 G-MATCH 同一规范化（NFKC、去空白与标点、ASCII 小写），
 * 任一关键词命中即可。
 */
export function matchesKeywords(
  text: string,
  keywords: readonly string[],
): boolean {
  const haystack = matchNormalize(text);
  return keywords.some((keyword) => {
    const needle = matchNormalize(keyword);
    return needle.length > 0 && haystack.includes(needle);
  });
}

/** 解析 `git status --porcelain -uall` 的变更路径（含重命名与引号转义） */
export function parseChangedPaths(porcelain: string): string[] {
  const paths = new Set<string>();
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    let raw = line.slice(3).trim();
    if (raw === "") continue;
    if (raw.includes(" -> ")) {
      raw = raw.split(" -> ").at(-1) ?? raw;
    }
    if (raw.startsWith('"')) {
      raw = unquoteGitPath(raw);
    }
    if (raw !== "") paths.add(raw);
  }
  return [...paths].sort();
}

type ContractBinding = SoftwareContract["scheme_binding"];

export interface SessionFactInput {
  contractId: string;
  challenge?: string | undefined;
  sessionId?: string | undefined;
  keywords: readonly string[];
  schemeBinding?: ContractBinding | undefined;
}

export interface SpecFactInput {
  contract: Pick<
    SoftwareContract,
    "contract_id" | "contract_revision" | "intent" | "scheme_binding"
  >;
  keywords: readonly string[];
}

export interface CodeFactInput {
  contract: SoftwareContract;
  keywords: readonly string[];
}

export interface SessionFactSource {
  collect(input: SessionFactInput): PromptFact;
}

export interface SpecFactSource {
  collect(input: SpecFactInput): SpecFact | null;
}

export interface CodeFactSource {
  collect(input: CodeFactInput): Promise<DiffFact>;
}

/** Worktree 约定路径（与 worktree-manager.ts 保持一致） */
export function worktreePathFor(repoRoot: string, contractId: string): string {
  return path.join(
    path.resolve(repoRoot),
    ".stagent",
    "worktrees",
    `task-${contractId}`,
  );
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 读取与合同绑定一致的确认快照（修 P-1 的前提）。
 * 快照缺失或 digest 与 `scheme_binding.snapshot_digest` 不符 → null（失败关闭）。
 */
export function loadBoundSnapshot(
  repoRoot: string,
  binding: ContractBinding,
): SchemeSnapshot | null {
  if (!binding) return null;
  const snapshot = readSchemeSnapshot(repoRoot, binding.confirmation_id);
  if (!snapshot || snapshot.digest !== binding.snapshot_digest) return null;
  return snapshot;
}

/**
 * 中栏事实：确认快照里的方案条目（模块与验收），不读 `requirements.md`（修 P-1）。
 */
export function specFactFromSnapshot(
  snapshot: SchemeSnapshot,
  keywords: readonly string[],
): SpecFact {
  const scheme = snapshot.scheme;
  const lines: string[] = [];
  for (const moduleName of scheme.modules) {
    lines.push(`模块：${moduleName}`);
  }
  for (const item of scheme.acceptance ?? []) {
    lines.push(`验收 ${item.id}：${item.text}`);
  }
  return {
    snapshot_id: snapshot.snapshot_id,
    version: scheme.scheme_revision,
    sha256: snapshot.digest,
    content: lines.join("\n"),
    matched_entries: lines
      .filter((line) => matchesKeywords(line, keywords))
      .slice(0, MAX_SPEC_ENTRIES),
  };
}

const ANCHORED_COLLECTIONS = [
  "goals",
  "out_of_scope",
  "modules",
  "flows",
  "entities",
  "decisions",
  "conflicts",
  "open_questions",
  "acceptance",
] as const;

function itemLabel(item: Record<string, unknown>): string {
  for (const key of ["text", "name", "question", "summary"]) {
    const value = item[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/**
 * 左栏事实：与质询相关的方案条目所锚定的原话（修 P-2）。
 *
 * - 只采信 `turn` 证据且带 `anchor`；
 * - 锚点的 `turn_text_sha256` 必须与会话里该轮原文一致，否则丢弃（失败关闭）；
 * - 高亮区间 `raw_start/raw_end` 直接切原文，不做模型改写。
 */
export interface AnchoredQuotesOptions {
  repoRoot?: string | null | undefined;
  transcript?:
    TranscriptRecord | readonly PersistedTranscriptTurn[] | null | undefined;
}

export function anchoredQuotesFromDraft(
  draft: SchemeDraftV2,
  messages: readonly SupervisorMessage[],
  keywords: readonly string[],
  transcriptOrRepoRoot?:
    | string
    | TranscriptRecord
    | readonly PersistedTranscriptTurn[]
    | AnchoredQuotesOptions
    | null,
): PromptFactMessage[] {
  let transcriptTurns: Map<string, PersistedTranscriptTurn> | null = null;
  let transcriptUpdatedAt = "";

  if (typeof transcriptOrRepoRoot === "string") {
    try {
      const record = readTranscript(transcriptOrRepoRoot);
      if (record?.turns) {
        transcriptTurns = new Map(record.turns.map((t) => [t.turn_id, t]));
        transcriptUpdatedAt = record.updated_at ?? "";
      }
    } catch {
      transcriptTurns = null;
    }
  } else if (Array.isArray(transcriptOrRepoRoot)) {
    transcriptTurns = new Map(transcriptOrRepoRoot.map((t) => [t.turn_id, t]));
  } else if (transcriptOrRepoRoot && typeof transcriptOrRepoRoot === "object") {
    if (
      "turns" in transcriptOrRepoRoot &&
      Array.isArray(transcriptOrRepoRoot.turns)
    ) {
      transcriptTurns = new Map(
        transcriptOrRepoRoot.turns.map((t) => [t.turn_id, t]),
      );
      transcriptUpdatedAt = transcriptOrRepoRoot.updated_at ?? "";
    } else if (
      "transcript" in transcriptOrRepoRoot ||
      "repoRoot" in transcriptOrRepoRoot
    ) {
      const opts = transcriptOrRepoRoot as AnchoredQuotesOptions;
      if (opts.transcript) {
        const transcriptVal = opts.transcript;
        if ("turns" in transcriptVal) {
          transcriptTurns = new Map(
            transcriptVal.turns.map((t) => [t.turn_id, t]),
          );
          if (transcriptVal.updated_at) {
            transcriptUpdatedAt = transcriptVal.updated_at;
          }
        } else {
          transcriptTurns = new Map(transcriptVal.map((t) => [t.turn_id, t]));
        }
      } else if (opts.repoRoot) {
        try {
          const record = readTranscript(opts.repoRoot);
          if (record?.turns) {
            transcriptTurns = new Map(record.turns.map((t) => [t.turn_id, t]));
            transcriptUpdatedAt = record.updated_at ?? "";
          }
        } catch {
          transcriptTurns = null;
        }
      }
    }
  }

  const byId = new Map(
    messages.map((message) => [message.message_id, message]),
  );
  const out: PromptFactMessage[] = [];
  for (const collection of ANCHORED_COLLECTIONS) {
    const items = (draft[collection] ?? []) as unknown as Array<
      SchemeItemMeta & Record<string, unknown>
    >;
    for (const item of items) {
      if (!matchesKeywords(itemLabel(item), keywords)) continue;
      for (const evidence of item.evidence ?? []) {
        if (evidence.kind !== "turn") continue;
        const ref: TurnRef = evidence.ref;
        const anchor = ref.anchor;
        if (!anchor) continue;

        // 1. 优先按 ref.turn_id 反查 readTranscript(repoRoot)
        if (transcriptTurns) {
          const turn = transcriptTurns.get(ref.turn_id);
          if (turn) {
            const computedSha = sha256Hex(turn.text);
            const recordedSha = turn.turn_text_sha256 ?? turn.text_sha256;
            const hashMatches =
              computedSha === anchor.turn_text_sha256 ||
              recordedSha === anchor.turn_text_sha256;
            if (!hashMatches) {
              // 哈希不一致 → 失败关闭，不兜底、不伪造
              continue;
            }
            if (
              anchor.raw_start < 0 ||
              anchor.raw_end <= anchor.raw_start ||
              anchor.raw_end > turn.text.length
            ) {
              // 越界 → 失败关闭
              continue;
            }
            const quote = turn.text.slice(anchor.raw_start, anchor.raw_end);
            if (quote === "") continue;

            const role =
              turn.role === "assistant"
                ? "supervisor"
                : turn.role === "system"
                  ? "system"
                  : "user";
            out.push({
              message_id: turn.turn_id,
              role,
              text: quote,
              created_at: transcriptUpdatedAt,
              raw_start: anchor.raw_start,
              raw_end: anchor.raw_end,
            });
            continue;
          }
        }

        // 2. transcript 缺失或 turn_id 未命中时，严格按 message_id/turn_id 兜底 session.messages
        const message = byId.get(ref.turn_id);
        if (!message) continue;
        if (sha256Hex(message.text) !== anchor.turn_text_sha256) continue;
        if (
          anchor.raw_start < 0 ||
          anchor.raw_end <= anchor.raw_start ||
          anchor.raw_end > message.text.length
        ) {
          continue;
        }
        const quote = message.text.slice(anchor.raw_start, anchor.raw_end);
        if (quote === "") continue;
        out.push({
          message_id: message.message_id,
          role: message.role,
          text: quote,
          created_at: message.created_at,
          raw_start: anchor.raw_start,
          raw_end: anchor.raw_end,
        });
      }
    }
  }
  return out.slice(-MAX_QUOTES);
}

export function ledgerDraftForSnapshot(
  repoRoot: string,
  snapshot: SchemeSnapshot | null,
): SchemeDraftV2 | null {
  if (!snapshot) return null;
  const record = readSchemeLedger(repoRoot);
  if (!record) return null;
  const draft = record.state.draft;
  if (
    draft.scheme_id !== snapshot.scheme.scheme_id ||
    draft.scheme_revision !== snapshot.scheme.scheme_revision
  ) {
    return null;
  }
  return draft;
}

export class SessionFactSourceImpl implements SessionFactSource {
  private readonly manager: SupervisorSessionManager;
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.manager = new SupervisorSessionManager(repoRoot);
  }

  private pickSession(input: SessionFactInput): SupervisorSession | null {
    if (input.sessionId !== undefined) {
      return this.manager.load(input.sessionId);
    }
    const latest = this.manager
      .list()
      .find((summary) => summary.contract_id === input.contractId);
    return latest ? this.manager.load(latest.session_id) : null;
  }

  collect(input: SessionFactInput): PromptFact {
    const session = this.pickSession(input);
    if (!session) {
      return {
        session_id: null,
        source: "CHALLENGE_ONLY",
        original_request: null,
        confirmations: [],
        matched_messages: [],
      };
    }

    const messages = session.messages.map(toPromptMessage);
    const userMessages = messages.filter((message) => message.role === "user");
    const original = userMessages[0]?.text.trim() ?? null;
    const confirmations = userMessages.filter((message) =>
      /确认|同意|批准|就按|按这个|没问题|可以，?就/.test(message.text),
    );

    const snapshot = input.schemeBinding
      ? loadBoundSnapshot(this.repoRoot, input.schemeBinding)
      : null;
    const draft = ledgerDraftForSnapshot(this.repoRoot, snapshot);
    const matched = draft
      ? anchoredQuotesFromDraft(
          draft,
          session.messages,
          input.keywords,
          this.repoRoot,
        )
      : [];

    return {
      session_id: session.session_id,
      source: "SESSION",
      original_request: original,
      confirmations,
      matched_messages: matched,
    };
  }
}

export class SpecFactSourceImpl implements SpecFactSource {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  collect(input: SpecFactInput): SpecFact | null {
    const snapshot = loadBoundSnapshot(
      this.repoRoot,
      input.contract.scheme_binding,
    );
    if (!snapshot) return null;
    return specFactFromSnapshot(snapshot, input.keywords);
  }
}

function evidenceTerminalLines(evidence: EvidenceBundle | null): string[] {
  if (!evidence) return [];
  const lines: string[] = [];
  for (const result of evidence.verification_results) {
    for (const tail of [result.stdout_tail, result.stderr_tail]) {
      for (const line of tail.split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (trimmed !== "") lines.push(`[${result.command_alias}] ${trimmed}`);
      }
    }
  }
  return lines.slice(-MAX_TERMINAL_LINES);
}

const SHA_PATTERN = /^[0-9a-f]{7,64}$/;

export interface GitRangeFacts {
  changed_files: string[];
  diff_stat: string;
  patch: string;
}

/**
 * 施工提交区间的真实改动（修 P-3）。
 *
 * `commitWorktree` 已 `git commit`，worktree 的 status/diff 为空，
 * 所以右栏必须看 `base..task` 区间。两端必须是十六进制 SHA，
 * 防止被当作 git 选项注入。
 */
export async function collectGitRangeFacts(
  repoRoot: string,
  baseSha: string,
  taskSha: string,
): Promise<GitRangeFacts | null> {
  if (!SHA_PATTERN.test(baseSha) || !SHA_PATTERN.test(taskSha)) return null;
  const range = `${baseSha}..${taskSha}`;
  const names = await execGit(["diff", "--name-only", "-z", range], repoRoot, {
    raw: true,
  }).catch(() => null);
  const stat = await execGit(["diff", "--numstat", range], repoRoot).catch(
    () => null,
  );
  const patch = await execGit(
    ["diff", "--no-color", "--no-ext-diff", range],
    repoRoot,
    { raw: true },
  ).catch(() => null);
  if (!names || names.exitCode !== 0 || !patch || patch.exitCode !== 0) {
    return null;
  }
  const changed = [
    ...new Set(names.stdout.split("\0").filter((file) => file !== "")),
  ].sort();
  return {
    changed_files: changed,
    diff_stat: stat?.exitCode === 0 ? stat.stdout.trim() : "",
    patch: patch.stdout,
  };
}

export class CodeFactSourceImpl implements CodeFactSource {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
  }

  async collect(input: CodeFactInput): Promise<DiffFact> {
    const worktreePath = worktreePathFor(
      this.repoRoot,
      input.contract.contract_id,
    );
    const evidence = loadLatestEvidenceSnapshot(
      this.repoRoot,
      input.contract.contract_id,
    );
    const verification =
      evidence?.verification_results.map((result) => ({
        alias: result.command_alias,
        exit_code: result.exit_code,
        passed: result.passed,
      })) ?? [];
    const base = {
      worktree_path: worktreePath,
      terminal_lines: evidenceTerminalLines(evidence),
      verification_results: verification,
      evidence_id: evidence?.evidence_id ?? null,
      tests_modified: evidence?.tests_modified === true,
    };

    const git = evidence?.git_info;
    const range = git
      ? await collectGitRangeFacts(
          this.repoRoot,
          git.base_commit_sha,
          git.task_commit_sha,
        )
      : null;
    if (!git || !range) {
      return {
        ...base,
        available: false,
        changed_files: [],
        diff_stat: "",
        diff_excerpt: "",
        commit_sha: null,
      };
    }

    return {
      ...base,
      available: true,
      changed_files: range.changed_files,
      diff_stat: range.diff_stat,
      diff_excerpt: range.patch.slice(0, MAX_DIFF_CHARS),
      added_code_lines: addedCodeLines(range.patch),
      commit_sha: git.task_commit_sha,
    };
  }
}

function toPromptMessage(message: SupervisorMessage): {
  message_id: string;
  role: SupervisorMessage["role"];
  text: string;
  created_at: string;
} {
  return {
    message_id: message.message_id,
    role: message.role,
    text: message.text,
    created_at: message.created_at,
  };
}

export interface CollectTriadInput {
  contract: SoftwareContract;
  challenge: string;
  repoRoot: string;
  sessionId?: string | undefined;
}

export interface DisputeFactDeps {
  sessions?: SessionFactSource;
  spec?: SpecFactSource;
  code?: CodeFactSource;
}

/** 抓取三方事实；任一路由调用方注入以便测试 */
export async function collectTriadFacts(
  input: CollectTriadInput,
  deps: DisputeFactDeps = {},
): Promise<TriadFacts> {
  const keywords = extractKeywords(input.challenge);
  const sessions = deps.sessions ?? new SessionFactSourceImpl(input.repoRoot);
  const spec = deps.spec ?? new SpecFactSourceImpl(input.repoRoot);
  const code = deps.code ?? new CodeFactSourceImpl(input.repoRoot);

  const prompt = sessions.collect({
    contractId: input.contract.contract_id,
    keywords,
    schemeBinding: input.contract.scheme_binding,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    challenge: input.challenge,
  });
  const specFact = spec.collect({ contract: input.contract, keywords });
  const codeFact = await code.collect({ contract: input.contract, keywords });

  return {
    challenge: input.challenge,
    keywords,
    prompt,
    spec: specFact,
    code: codeFact,
  };
}
