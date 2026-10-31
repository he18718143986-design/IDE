/**
 * TASK-C.17：P0 调试日志（Local-First JSONL）
 *
 * 落盘根：`<repo>/.stagent/logs/`
 * - daemon.jsonl —— HTTP / 帧 / LLM 元数据（info；简单轮转）
 * - worker-<cid>.jsonl —— WORKER_LOG / TERMINAL_STREAM 有界落盘（与 WS 并行）
 * - journey-<cid|orphan>.jsonl —— 澄清旅程每轮 user/assistant（可刷新还原）
 * - client-events 亦写入 daemon.jsonl（kind=client）
 *
 * 禁密钥：不得写入 Authorization / API Key / Token 明文。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getActiveVault } from "../vault";

export const DEBUG_LOGS_DIR_REL = ".stagent/logs";
export const DAEMON_LOG_FILE = "daemon.jsonl";

/** 单文件轮转阈值：约 8 MiB；保留一份 `.1` 备份 */
export const DEBUG_LOG_ROTATE_BYTES = 8 * 1024 * 1024;
/** worker 单行字符上限（落盘侧；WS 另有截断） */
export const WORKER_LOG_LINE_MAX_CHARS = 4_000;
/** worker 单次批量落盘行数上限 */
export const WORKER_LOG_BATCH_MAX_LINES = 200;
/** journey 单条 text 上限 */
export const JOURNEY_TEXT_MAX_CHARS = 8_000;

export type DebugLogLevel = "info" | "warn" | "error";

export interface DebugLogEvent {
  ts: string;
  level: DebugLogLevel;
  kind: string;
  requestId?: string | undefined;
  contractId?: string | undefined;
  sessionId?: string | undefined;
  route?: string | undefined;
  frame?: string | undefined;
  code?: string | undefined;
  duration_ms?: number | undefined;
  /** 任意附加（已由调用方脱敏）；不得含密钥 */
  detail?: Record<string, unknown> | undefined;
}

export interface JourneyTurnEvent {
  ts: string;
  role: "user" | "assistant" | "system";
  text: string;
  contractId?: string | undefined;
  sessionId?: string | undefined;
  route?: string | undefined;
  code?: string | undefined;
  requestId?: string | undefined;
}

export interface ClientTraceEvent {
  ts?: string | undefined;
  kind: "cta_click" | "viewport_change" | "cta_disabled" | string;
  cta?: string | undefined;
  viewport?: string | undefined;
  disabled_reason?: string | undefined;
  contractId?: string | undefined;
  sessionId?: string | undefined;
  detail?: Record<string, unknown> | undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function logsDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), DEBUG_LOGS_DIR_REL);
}

export function daemonLogPath(repoRoot: string): string {
  return path.join(logsDir(repoRoot), DAEMON_LOG_FILE);
}

export function workerLogPath(repoRoot: string, contractId: string): string {
  const safe = sanitizeId(contractId);
  return path.join(logsDir(repoRoot), `worker-${safe}.jsonl`);
}

export function journeyLogPath(
  repoRoot: string,
  contractId?: string | null,
): string {
  const safe =
    contractId && contractId.trim().length > 0
      ? sanitizeId(contractId.trim())
      : "orphan";
  return path.join(logsDir(repoRoot), `journey-${safe}.jsonl`);
}

/** 合同 / session id 落文件名白名单 */
export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 128);
  return cleaned.length > 0 ? cleaned : "unknown";
}

export function newRequestId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function ensureLogsDir(repoRoot: string): string {
  const dir = logsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore on platforms without chmod */
  }
  return dir;
}

function rotateIfNeeded(filePath: string, maxBytes: number): void {
  try {
    const st = fs.statSync(filePath);
    if (st.size < maxBytes) return;
  } catch {
    return;
  }
  const backup = `${filePath}.1`;
  try {
    fs.rmSync(backup, { force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.renameSync(filePath, backup);
  } catch {
    /* 并发/跨盘失败时跳过本轮轮转 */
  }
}

function appendLine(filePath: string, line: string, maxBytes: number): void {
  rotateIfNeeded(filePath, maxBytes);
  const payload = line.endsWith("\n") ? line : `${line}\n`;
  const fd = fs.openSync(filePath, "a", 0o600);
  try {
    fs.writeSync(fd, payload, undefined, "utf8");
    try {
      fs.fchmodSync(fd, 0o600);
    } catch {
      /* ignore */
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** 剥掉常见密钥形态，避免误写入 */
export function redactSecrets(
  text: string,
  secretValues: string[] = [],
): string {
  const fromVault = getActiveVault()?.currentValues() ?? [];
  const all = [...secretValues, ...fromVault].filter(
    (v) => typeof v === "string" && v.length >= 6,
  );
  let out = text;
  for (const secret of all) {
    if (out.includes(secret)) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"',}]+/gi,
      (m) => m.replace(/([:=]\s*["']?).+$/i, "$1[REDACTED]"),
    )
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/g, "sk-[REDACTED]");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}

export function appendDaemonLog(
  repoRoot: string,
  event: Omit<DebugLogEvent, "ts" | "level"> & {
    ts?: string | undefined;
    level?: DebugLogLevel | undefined;
  },
): void {
  ensureLogsDir(repoRoot);
  const record: DebugLogEvent = {
    ts: event.ts ?? nowIso(),
    level: event.level ?? "info",
    kind: event.kind,
    ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
    ...(event.contractId === undefined ? {} : { contractId: event.contractId }),
    ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
    ...(event.route === undefined ? {} : { route: event.route }),
    ...(event.frame === undefined ? {} : { frame: event.frame }),
    ...(event.code === undefined ? {} : { code: event.code }),
    ...(event.duration_ms === undefined
      ? {}
      : { duration_ms: event.duration_ms }),
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  };
  appendLine(
    daemonLogPath(repoRoot),
    JSON.stringify(record),
    DEBUG_LOG_ROTATE_BYTES,
  );
}

export function appendWorkerTerminalLog(
  repoRoot: string,
  contractId: string,
  entry: {
    source: "WORKER_LOG" | "TERMINAL_STREAM";
    stream?: "stdout" | "stderr" | "worker" | undefined;
    lines: string[];
    requestId?: string | undefined;
  },
): void {
  if (!contractId.trim()) return;
  ensureLogsDir(repoRoot);
  const lines = entry.lines
    .slice(0, WORKER_LOG_BATCH_MAX_LINES)
    .map((l) => truncate(redactSecrets(l), WORKER_LOG_LINE_MAX_CHARS));
  if (lines.length === 0) return;
  const record = {
    ts: nowIso(),
    level: "info" as const,
    kind: "worker",
    frame: entry.source,
    contractId,
    ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
    ...(entry.stream === undefined ? {} : { stream: entry.stream }),
    lines,
  };
  appendLine(
    workerLogPath(repoRoot, contractId),
    JSON.stringify(record),
    DEBUG_LOG_ROTATE_BYTES,
  );
  // 同步一条索引到 daemon.jsonl，便于统一 grep
  appendDaemonLog(repoRoot, {
    kind: "worker",
    frame: entry.source,
    contractId,
    ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
    detail: { lines: lines.length, stream: entry.stream ?? null },
  });
}

export function appendJourneyTurn(
  repoRoot: string,
  turn: Omit<JourneyTurnEvent, "ts"> & { ts?: string | undefined },
): void {
  ensureLogsDir(repoRoot);
  const record: JourneyTurnEvent = {
    ts: turn.ts ?? nowIso(),
    role: turn.role,
    text: truncate(redactSecrets(turn.text), JOURNEY_TEXT_MAX_CHARS),
    ...(turn.contractId === undefined ? {} : { contractId: turn.contractId }),
    ...(turn.sessionId === undefined ? {} : { sessionId: turn.sessionId }),
    ...(turn.route === undefined ? {} : { route: turn.route }),
    ...(turn.code === undefined ? {} : { code: turn.code }),
    ...(turn.requestId === undefined ? {} : { requestId: turn.requestId }),
  };
  appendLine(
    journeyLogPath(repoRoot, turn.contractId),
    JSON.stringify(record),
    DEBUG_LOG_ROTATE_BYTES,
  );
  appendDaemonLog(repoRoot, {
    kind: "journey",
    ...(turn.contractId === undefined ? {} : { contractId: turn.contractId }),
    ...(turn.sessionId === undefined ? {} : { sessionId: turn.sessionId }),
    ...(turn.requestId === undefined ? {} : { requestId: turn.requestId }),
    ...(turn.route === undefined ? {} : { route: turn.route }),
    ...(turn.code === undefined ? {} : { code: turn.code }),
    detail: { role: turn.role, text_len: record.text.length },
  });
}

export function readJourneyTurns(
  repoRoot: string,
  contractId?: string | null,
  options: { limit?: number | undefined } = {},
): JourneyTurnEvent[] {
  const file = journeyLogPath(repoRoot, contractId);
  if (!fs.existsSync(file)) return [];
  const limit = options.limit ?? 200;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: JourneyTurnEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as JourneyTurnEvent;
      if (
        parsed &&
        typeof parsed.ts === "string" &&
        (parsed.role === "user" ||
          parsed.role === "assistant" ||
          parsed.role === "system") &&
        typeof parsed.text === "string"
      ) {
        out.push(parsed);
      }
    } catch {
      /* skip corrupt line */
    }
  }
  return out.length > limit ? out.slice(out.length - limit) : out;
}

export function appendClientTrace(
  repoRoot: string,
  event: ClientTraceEvent,
  meta: { requestId?: string | undefined } = {},
): void {
  appendDaemonLog(repoRoot, {
    kind: "client",
    ...(meta.requestId === undefined ? {} : { requestId: meta.requestId }),
    ...(event.contractId === undefined ? {} : { contractId: event.contractId }),
    ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
    ...(event.viewport === undefined ? {} : { frame: event.viewport }),
    ...(event.disabled_reason === undefined
      ? {}
      : { code: event.disabled_reason }),
    detail: {
      client_kind: event.kind,
      ...(event.cta === undefined ? {} : { cta: event.cta }),
      ...(event.viewport === undefined ? {} : { viewport: event.viewport }),
      ...(event.disabled_reason === undefined
        ? {}
        : { disabled_reason: event.disabled_reason }),
      ...(event.detail === undefined ? {} : event.detail),
    },
    ts: event.ts,
  });
}

export function appendLlmMeta(
  repoRoot: string,
  meta: {
    source: "enrich" | "worker";
    duration_ms: number;
    model?: string | undefined;
    enrichCode?: string | undefined;
    input_tokens?: number | undefined;
    output_tokens?: number | undefined;
    contractId?: string | undefined;
    requestId?: string | undefined;
  },
): void {
  appendDaemonLog(repoRoot, {
    kind: "llm",
    duration_ms: meta.duration_ms,
    ...(meta.contractId === undefined ? {} : { contractId: meta.contractId }),
    ...(meta.requestId === undefined ? {} : { requestId: meta.requestId }),
    ...(meta.enrichCode === undefined ? {} : { code: meta.enrichCode }),
    detail: {
      source: meta.source,
      ...(meta.model === undefined ? {} : { model: meta.model }),
      ...(meta.input_tokens === undefined
        ? {}
        : { input_tokens: meta.input_tokens }),
      ...(meta.output_tokens === undefined
        ? {}
        : { output_tokens: meta.output_tokens }),
    },
  });
}
