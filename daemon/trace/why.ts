/**
 * TASK-L.13：追踪链反查——「这段为什么存在」。
 *
 * 链路：git blame → Trailer → 合同 → 方案条目 → 原话。
 * 任一环缺失 → E_TRACE_BROKEN（指出断环）；绝不编造原话。
 *
 * 已知限制：blame/explain 仅对已合入主干、无本地未提交改动的文件准确；
 * worktree / 脏缓冲下的行号可能与 repoRoot HEAD 错位且不报错。
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ContractStore } from "../pipeline/contract-store";
import { readSchemeSnapshot } from "../pipeline/scheme-snapshot-store";
import { readSchemeLedger } from "../supervisor/intent-compiler/scheme-ledger-store";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import type { EvidenceItem } from "../../src/lib/journey/scheme-patch-types";

const execFileAsync = promisify(execFile);

export const E_TRACE_BROKEN = "E_TRACE_BROKEN" as const;

/** 断环标签（与卡 / delivery-lifecycle §6 对齐，供 UI 白话展示） */
export type TraceBrokenRing =
  | "提交无 Stagent Trailer"
  | "合同"
  | "方案条目"
  | "原话";

export class TraceBrokenError extends Error {
  readonly code = E_TRACE_BROKEN;
  readonly ring: TraceBrokenRing;
  readonly detail: string;
  readonly commit?: string;
  readonly contract_id?: string;

  constructor(
    ring: TraceBrokenRing,
    detail: string,
    extra?: { commit?: string; contract_id?: string },
  ) {
    super(`[${E_TRACE_BROKEN}] 断在「${ring}」：${detail}`);
    this.name = "TraceBrokenError";
    this.ring = ring;
    this.detail = detail;
    if (extra?.commit !== undefined) this.commit = extra.commit;
    if (extra?.contract_id !== undefined) this.contract_id = extra.contract_id;
  }
}

export interface TraceQuote {
  qid: string;
  text: string;
}

export interface TraceSchemeItem {
  id: string;
  text: string;
  quotes: TraceQuote[];
}

export interface ExplainLineResult {
  commit: string;
  contract_id: string;
  scheme_items: TraceSchemeItem[];
  /** Trailer 被截断为合同号时为 true；全量 id 来自合同 metadata / changelog */
  scheme_items_trailer_truncated: boolean;
}

export interface ExplainLineInput {
  repoRoot: string;
  path: string;
  line: number;
}

const SCHEME_ITEMS_TRAILER = "Stagent-Scheme-Items";
const CONTRACT_TRAILER = "Stagent-Contract-ID";

function parseTrailers(message: string): Map<string, string> {
  // git log --format=%B 常带末尾空行；跳过后再自底向上识别 trailer 块
  const lines = message.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const map = new Map<string, string>();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") break;
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (!m) break;
    map.set(m[1]!, m[2] ?? "");
  }
  return map;
}

async function git(
  repoRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

/** 从 blame porcelain 取覆盖该行的提交 SHA */
export async function blameCommitSha(
  repoRoot: string,
  filePath: string,
  line: number,
): Promise<string> {
  if (!Number.isInteger(line) || line < 1) {
    throw new TraceBrokenError("提交无 Stagent Trailer", `行号非法：${line}`);
  }
  const rel = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const blame = await git(repoRoot, [
    "blame",
    "--porcelain",
    "-L",
    `${line},${line}`,
    "--",
    rel,
  ]);
  if (blame.exitCode !== 0) {
    throw new TraceBrokenError(
      "提交无 Stagent Trailer",
      `git blame 失败：${blame.stderr || blame.stdout || "unknown"}`,
    );
  }
  const first = blame.stdout.split("\n")[0] ?? "";
  const sha = first.split(" ")[0] ?? "";
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new TraceBrokenError(
      "提交无 Stagent Trailer",
      `无法解析 blame 提交：${first.slice(0, 80)}`,
    );
  }
  return sha;
}

function quotesFromEvidence(evidence: EvidenceItem[] | undefined): TraceQuote[] {
  if (!evidence?.length) return [];
  const out: TraceQuote[] = [];
  for (const item of evidence) {
    if (item.kind !== "turn") continue;
    const quote = item.ref.quote?.trim();
    if (!quote) continue;
    // qid：优先 turn_id；不编造文案，只引用磁盘上的 quote
    out.push({ qid: item.ref.turn_id, text: quote });
  }
  return out;
}

function findItemInDraftV2(
  draft: SchemeDraftV2,
  id: string,
): { text: string; quotes: TraceQuote[] } | null {
  const withText = [
    ...draft.goals,
    ...draft.out_of_scope,
    ...draft.open_questions,
    ...draft.acceptance,
  ];
  for (const row of withText) {
    if (row.id === id) {
      return { text: row.text, quotes: quotesFromEvidence(row.evidence) };
    }
  }
  for (const row of draft.modules) {
    if (row.id === id) {
      return {
        text: row.purpose || row.name,
        quotes: quotesFromEvidence(row.evidence),
      };
    }
  }
  for (const row of draft.flows) {
    if (row.id === id) {
      return { text: row.name, quotes: quotesFromEvidence(row.evidence) };
    }
  }
  for (const row of draft.entities) {
    if (row.id === id) {
      return { text: row.name, quotes: quotesFromEvidence(row.evidence) };
    }
  }
  for (const row of draft.decisions) {
    if (row.id === id) {
      return {
        text: row.question,
        quotes: quotesFromEvidence(row.evidence),
      };
    }
  }
  for (const row of draft.conflicts) {
    if (row.id === id) {
      return {
        text: row.question,
        quotes: quotesFromEvidence(row.evidence),
      };
    }
  }
  return null;
}

function resolveSchemeItemIds(
  trailerValue: string,
  contractId: string,
  metadataIds: readonly string[] | undefined,
  repoRoot: string,
): { ids: string[]; truncated: boolean } {
  const trimmed = trailerValue.trim();
  if (!trimmed) return { ids: [], truncated: false };
  // 截断形态：Trailer 值 == 合同号
  if (trimmed === contractId) {
    if (metadataIds && metadataIds.length > 0) {
      return { ids: [...metadataIds], truncated: true };
    }
    const fromChangelog = readSchemeItemIdsFromChangelog(repoRoot, contractId);
    return { ids: fromChangelog, truncated: true };
  }
  return {
    ids: trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    truncated: false,
  };
}

/** 读 changelog 中 L.13 写入的全量 id（截断时的后备） */
export function readSchemeItemIdsFromChangelog(
  repoRoot: string,
  contractId: string,
): string[] {
  const file = path.join(repoRoot, "docs/system/changelog.md");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const marker = `<!-- stagent-scheme-items:${contractId} -->`;
  const idx = text.indexOf(marker);
  if (idx < 0) return [];
  const lineEnd = text.indexOf("\n", idx);
  const line = text.slice(idx, lineEnd < 0 ? undefined : lineEnd);
  const m = /scheme_item_ids:\s*(.+)\s*$/.exec(line);
  if (!m?.[1]) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 反查一行代码的存在理由。
 * @throws TraceBrokenError
 */
export async function explainLine(
  input: ExplainLineInput,
): Promise<ExplainLineResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const commit = await blameCommitSha(repoRoot, input.path, input.line);

  const log = await git(repoRoot, ["log", "-1", "--format=%B", commit]);
  if (log.exitCode !== 0) {
    throw new TraceBrokenError(
      "提交无 Stagent Trailer",
      `无法读取提交信息：${log.stderr || commit}`,
      { commit },
    );
  }
  const trailers = parseTrailers(log.stdout);
  const contractId = trailers.get(CONTRACT_TRAILER)?.trim();
  if (!contractId) {
    throw new TraceBrokenError(
      "提交无 Stagent Trailer",
      `提交 ${commit.slice(0, 12)} 未携带 ${CONTRACT_TRAILER}`,
      { commit },
    );
  }

  const store = new ContractStore(repoRoot);
  const contract = store.get(contractId);
  if (!contract) {
    throw new TraceBrokenError(
      "合同",
      `找不到合同 ${contractId}（.stagent/contracts）`,
      { commit, contract_id: contractId },
    );
  }

  const schemeTrailer = trailers.get(SCHEME_ITEMS_TRAILER) ?? "";
  const metaIds = contract.supervisor_metadata?.scheme_item_ids;
  const { ids: itemIds, truncated } = resolveSchemeItemIds(
    schemeTrailer,
    contractId,
    metaIds,
    repoRoot,
  );

  // Trailer 缺 Scheme-Items 时仍可用合同 metadata（旧提交兼容）；二者都无则断在方案条目
  const effectiveIds =
    itemIds.length > 0
      ? itemIds
      : metaIds && metaIds.length > 0
        ? [...metaIds]
        : [];

  if (effectiveIds.length === 0) {
    throw new TraceBrokenError(
      "方案条目",
      `合同 ${contractId} 无 scheme_item_ids，Trailer 亦无 ${SCHEME_ITEMS_TRAILER}`,
      { commit, contract_id: contractId },
    );
  }

  const ledger = readSchemeLedger(repoRoot);
  const draftV2 = ledger?.state.draft ?? null;
  const snapshot = contract.scheme_binding
    ? readSchemeSnapshot(repoRoot, contract.scheme_binding.confirmation_id)
    : null;
  const acceptanceRefs = contract.supervisor_metadata?.acceptance_refs ?? [];

  const scheme_items: TraceSchemeItem[] = [];
  for (const id of effectiveIds) {
    let text: string | null = null;
    let quotes: TraceQuote[] = [];

    if (draftV2) {
      const hit = findItemInDraftV2(draftV2, id);
      if (hit) {
        text = hit.text;
        quotes = hit.quotes;
      }
    }

    if (text === null && snapshot?.scheme.acceptance) {
      const acc = snapshot.scheme.acceptance.find((a) => a.id === id);
      if (acc) text = acc.text;
    }

    if (text === null) {
      const ref = acceptanceRefs.find((a) => a.id === id);
      if (ref) text = ref.text;
    }

    if (text === null) {
      throw new TraceBrokenError(
        "方案条目",
        `条目 ${id} 在账本/快照/合同 acceptance_refs 中均不存在`,
        { commit, contract_id: contractId },
      );
    }

    if (quotes.length === 0) {
      throw new TraceBrokenError(
        "原话",
        `条目 ${id} 无 evidence 原话（拒绝用条目正文冒充用户原话）`,
        { commit, contract_id: contractId },
      );
    }

    scheme_items.push({ id, text, quotes });
  }

  return {
    commit,
    contract_id: contractId,
    scheme_items,
    scheme_items_trailer_truncated: truncated,
  };
}
