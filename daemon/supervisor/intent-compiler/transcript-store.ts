/**
 * 意图编译器转录历史（transcript）原子持久化与版本化存储（TASK-J.21）。
 *
 * 路径：`.stagent/drafts/scheme-ledger/transcript.json`
 * 失败关闭规则：
 *  - 文件缺失：视为空基线（返回 null）；
 *  - schema_version 缺失或不识别：抛出 E_TRANSCRIPT_SCHEMA_VERSION；
 *  - JSON 损坏或关键字段缺失/类型不符：抛出 E_TRANSCRIPT_CORRUPT。
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../../src/lib/state-machine";
import { SCHEME_LEDGER_DIR } from "./scheme-ledger-store";

export const TRANSCRIPT_FILE = "transcript.json" as const;
export const TRANSCRIPT_SCHEMA_VERSION = "1.0" as const;

export class TranscriptStoreError extends Error {
  readonly code: "E_TRANSCRIPT_SCHEMA_VERSION" | "E_TRANSCRIPT_CORRUPT";

  constructor(
    code: "E_TRANSCRIPT_SCHEMA_VERSION" | "E_TRANSCRIPT_CORRUPT",
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = "TranscriptStoreError";
    this.code = code;
  }
}

export interface PersistedTranscriptTurn {
  turn_id: string;
  role: "user" | "assistant" | "system";
  seq: number;
  text: string;
  text_sha256: string;
  user_alias_seq?: number;
}

export interface TranscriptRecord {
  schema_version: typeof TRANSCRIPT_SCHEMA_VERSION;
  updated_at: string;
  seq: number;
  user_alias_seq: number;
  turns: PersistedTranscriptTurn[];
}

interface RawTranscriptRecord {
  schema_version?: unknown;
  updated_at?: unknown;
  seq?: unknown;
  user_alias_seq?: unknown;
  turns?: unknown;
}

interface RawTurnItem {
  turn_id?: unknown;
  role?: unknown;
  seq?: unknown;
  text?: unknown;
  text_sha256?: unknown;
  user_alias_seq?: unknown;
}

export function transcriptPath(repoRoot: string): string {
  return path.join(repoRoot, SCHEME_LEDGER_DIR, TRANSCRIPT_FILE);
}

/**
 * 从磁盘读取 transcript.json。
 * 失败关闭：文件缺失返回 null（空基线）；损坏或版本错误抛出 TranscriptStoreError。
 */
export function readTranscript(repoRoot: string): TranscriptRecord | null {
  const file = transcriptPath(repoRoot);
  if (!fs.existsSync(file)) return null;

  let rawText: string;
  try {
    rawText = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new TranscriptStoreError(
      "E_TRANSCRIPT_CORRUPT",
      `Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    throw new TranscriptStoreError(
      "E_TRANSCRIPT_CORRUPT",
      `Failed to parse ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TranscriptStoreError(
      "E_TRANSCRIPT_CORRUPT",
      `${file} root must be a non-null object`,
    );
  }

  const record = raw as RawTranscriptRecord;

  // schema_version 校验
  if (
    record.schema_version === undefined ||
    record.schema_version === null ||
    typeof record.schema_version !== "string" ||
    record.schema_version.trim() === ""
  ) {
    throw new TranscriptStoreError(
      "E_TRANSCRIPT_SCHEMA_VERSION",
      `Missing schema_version in ${file}`,
    );
  }

  if (record.schema_version !== TRANSCRIPT_SCHEMA_VERSION) {
    throw new TranscriptStoreError(
      "E_TRANSCRIPT_SCHEMA_VERSION",
      `Unrecognized schema_version "${record.schema_version}" in ${file} (expected "${TRANSCRIPT_SCHEMA_VERSION}")`,
    );
  }

  // 关键字段校验
  if (
    typeof record.seq !== "number" ||
    !Number.isFinite(record.seq) ||
    typeof record.user_alias_seq !== "number" ||
    !Number.isFinite(record.user_alias_seq) ||
    typeof record.updated_at !== "string" ||
    !Array.isArray(record.turns)
  ) {
    throw new TranscriptStoreError(
      "E_TRANSCRIPT_CORRUPT",
      `Missing or invalid required root fields in ${file}`,
    );
  }

  const rawTurns = record.turns;
  const turns: PersistedTranscriptTurn[] = [];
  for (let i = 0; i < rawTurns.length; i++) {
    const t = rawTurns[i];
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      throw new TranscriptStoreError(
        "E_TRANSCRIPT_CORRUPT",
        `Invalid turn record at index ${i} in ${file}`,
      );
    }
    const item = t as RawTurnItem;
    if (
      typeof item.turn_id !== "string" ||
      !item.turn_id.trim() ||
      (item.role !== "user" &&
        item.role !== "assistant" &&
        item.role !== "system") ||
      typeof item.seq !== "number" ||
      !Number.isFinite(item.seq) ||
      typeof item.text !== "string" ||
      typeof item.text_sha256 !== "string" ||
      !item.text_sha256.trim()
    ) {
      throw new TranscriptStoreError(
        "E_TRANSCRIPT_CORRUPT",
        `Missing or invalid fields in turn record at index ${i} in ${file}`,
      );
    }

    if (
      item.user_alias_seq !== undefined &&
      (typeof item.user_alias_seq !== "number" ||
        !Number.isFinite(item.user_alias_seq))
    ) {
      throw new TranscriptStoreError(
        "E_TRANSCRIPT_CORRUPT",
        `Invalid user_alias_seq in turn record at index ${i} in ${file}`,
      );
    }

    turns.push({
      turn_id: item.turn_id,
      role: item.role,
      seq: item.seq,
      text: item.text,
      text_sha256: item.text_sha256,
      ...(item.user_alias_seq !== undefined
        ? { user_alias_seq: item.user_alias_seq }
        : {}),
    });
  }

  return {
    schema_version: TRANSCRIPT_SCHEMA_VERSION,
    updated_at: record.updated_at,
    seq: record.seq,
    user_alias_seq: record.user_alias_seq,
    turns,
  };
}

/**
 * 原子落盘 transcript.json。
 */
export function writeTranscript(
  repoRoot: string,
  record: {
    seq: number;
    user_alias_seq: number;
    turns: readonly PersistedTranscriptTurn[];
    updated_at?: string;
  },
): void {
  const file = transcriptPath(repoRoot);
  const data: TranscriptRecord = {
    schema_version: TRANSCRIPT_SCHEMA_VERSION,
    updated_at: record.updated_at ?? new Date().toISOString(),
    seq: record.seq,
    user_alias_seq: record.user_alias_seq,
    turns: record.turns.slice(),
  };
  writeJsonAtomic(file, data);
}
