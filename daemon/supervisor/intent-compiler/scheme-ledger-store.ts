/**
 * 方案账本 CAS 落盘（TASK-J.10 生产接线）。
 *
 * 路径：`.stagent/drafts/scheme-ledger/active.json`
 * 调用方必须以 `expectedPrevRevision === 当前 draft.scheme_revision` 做 CAS；
 * 失败返回 cas_mismatch，由编译循环按 STALE 重试。
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../../src/lib/state-machine";
import type {
  LedgerState,
  MergeJournal,
  SchemeDraftV2,
} from "../../../src/lib/journey/scheme-patch-types";
import type {
  CompilerCasWriteInput,
  CompilerCasWriteResult,
} from "./compile-loop";

export const SCHEME_LEDGER_DIR = ".stagent/drafts/scheme-ledger" as const;
export const SCHEME_LEDGER_FILE = "active.json" as const;
export const SCHEME_LEDGER_SCHEMA_VERSION = "1.0" as const;

export interface SchemeLedgerRecord {
  schema_version: typeof SCHEME_LEDGER_SCHEMA_VERSION;
  updated_at: string;
  state: LedgerState;
  last_journal: MergeJournal | null;
  last_model_id: string | null;
  last_prompt_version: string | null;
  offline: boolean;
}

export function schemeLedgerPath(repoRoot: string): string {
  return path.join(repoRoot, SCHEME_LEDGER_DIR, SCHEME_LEDGER_FILE);
}

export function emptySchemeDraftV2(
  over: Partial<SchemeDraftV2> = {},
): SchemeDraftV2 {
  return {
    scheme_id: over.scheme_id ?? "scheme-active",
    scheme_revision: over.scheme_revision ?? 0,
    frozen: over.frozen ?? false,
    title: over.title ?? "",
    summary: over.summary ?? "",
    audience: over.audience ?? null,
    size_hint: over.size_hint ?? "standard",
    goals: over.goals ?? [],
    out_of_scope: over.out_of_scope ?? [],
    modules: over.modules ?? [],
    flows: over.flows ?? [],
    entities: over.entities ?? [],
    decisions: over.decisions ?? [],
    conflicts: over.conflicts ?? [],
    open_questions: over.open_questions ?? [],
    acceptance: over.acceptance ?? [],
  };
}

export function emptyLedgerState(
  over: Partial<LedgerState> = {},
): LedgerState {
  return {
    draft: emptySchemeDraftV2(over.draft),
    graveyard: over.graveyard ?? [],
    suggestions: over.suggestions ?? [],
  };
}

export function readSchemeLedger(repoRoot: string): SchemeLedgerRecord | null {
  const file = schemeLedgerPath(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as SchemeLedgerRecord;
    if (
      !raw ||
      raw.schema_version !== SCHEME_LEDGER_SCHEMA_VERSION ||
      !raw.state ||
      !raw.state.draft
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function loadOrInitLedgerState(repoRoot: string): LedgerState {
  return readSchemeLedger(repoRoot)?.state ?? emptyLedgerState();
}

/**
 * CAS：仅当磁盘上（或不存在时视为 revision 0）的 scheme_revision
 * 等于 expectedPrevRevision 时写入 next。
 */
export function casWriteSchemeLedger(
  repoRoot: string,
  input: CompilerCasWriteInput,
): CompilerCasWriteResult {
  const file = schemeLedgerPath(repoRoot);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const current = readSchemeLedger(repoRoot);
  const currentRev = current?.state.draft.scheme_revision ?? 0;
  if (currentRev !== input.expectedPrevRevision) {
    return { ok: false, reason: "cas_mismatch" };
  }

  // 防御：next.revision 必须 = expected + 1（noop 时引擎也可能 +0？检查引擎）
  const nextRev = input.next.draft.scheme_revision;
  if (nextRev < input.expectedPrevRevision) {
    return { ok: false, reason: "cas_mismatch" };
  }

  const record: SchemeLedgerRecord = {
    schema_version: SCHEME_LEDGER_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    state: input.next,
    last_journal: input.journal,
    last_model_id: input.modelId,
    last_prompt_version: input.promptVersion,
    offline: input.offline,
  };

  try {
    writeJsonAtomic(file, record);
  } catch {
    return { ok: false, reason: "io" };
  }
  return { ok: true, revision: nextRev };
}
