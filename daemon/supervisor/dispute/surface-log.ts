/**
 * TASK-J.16 第一刀 · GAP-P8 呈现日志 `surface_log`（playtest-self-check §5.3；supervisor §15.4）。
 *
 * 记录「确认当时/试玩时用户实际看到了哪些条目」。K-14 三分类的 (a)/(b) 区分只以它为唯一呈现依据。
 *
 * - 只追加：每次呈现写一行 JSON，永不改写旧行；
 * - 只记录确已呈现的条目：未出现在 `shown` 中的条目不产生记录；
 * - 不由模型或 Worker 写，由 Daemon 在 §15.4 白话投影时调用；
 * - 缺记录（文件不存在或该确认无条目）时不得伪造分类，统一标「无呈现记录」（J16-P4）。
 */
import fs from "node:fs";
import path from "node:path";

/** 呈现日志根目录（相对仓库根），与 `.stagent/records/baseline/` 同级约定 */
export const SURFACE_LOG_ROOT = ".stagent/records/surface-log" as const;

/** 缺呈现记录时 `resolution_note` 的固定文案（J16-P4） */
export const NO_SURFACE_RECORD_NOTE = "无呈现记录" as const;

/** 与 §5.3 SurfaceLog 的四个「shown」列表及试玩区域一一对应 */
export const SURFACE_SECTIONS = [
  "decision",
  "acceptance",
  "approval",
  "high_risk",
  "area",
  "unmapped_files",
] as const;
export type SurfaceSection = (typeof SURFACE_SECTIONS)[number];

export interface SurfaceLogEntry {
  confirmation_id: string;
  item_ref: string;
  section: SurfaceSection;
  presented_at: string;
  plain_text_version: string;
}

export interface SurfaceShownItem {
  item_ref: string;
  section: SurfaceSection;
}

export interface SurfacePresentationInput {
  confirmation_id: string;
  plain_text_version: string;
  presented_at: string;
  shown: readonly SurfaceShownItem[];
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`surface_log: 非法 confirmation_id（${id}）`);
  }
}

function isSection(value: unknown): value is SurfaceSection {
  return (
    typeof value === "string" &&
    (SURFACE_SECTIONS as readonly string[]).includes(value)
  );
}

/** 把一次呈现事件转成日志条目：只收确已展示的条目，去空、去重。 */
export function buildSurfaceLogEntries(
  input: SurfacePresentationInput,
): SurfaceLogEntry[] {
  assertSafeId(input.confirmation_id);
  if (Number.isNaN(Date.parse(input.presented_at))) {
    throw new Error(
      `surface_log: presented_at 不是合法时间（${input.presented_at}）`,
    );
  }
  const seen = new Set<string>();
  const out: SurfaceLogEntry[] = [];
  for (const item of input.shown) {
    const ref = item.item_ref.trim();
    if (ref === "" || !isSection(item.section)) continue;
    const key = `${item.section}\u0000${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      confirmation_id: input.confirmation_id,
      item_ref: ref,
      section: item.section,
      presented_at: input.presented_at,
      plain_text_version: input.plain_text_version,
    });
  }
  return out;
}

export function surfaceLogPath(
  repoRoot: string,
  confirmationId: string,
): string {
  assertSafeId(confirmationId);
  return path.join(repoRoot, SURFACE_LOG_ROOT, `${confirmationId}.jsonl`);
}

/** 追加写入。`entries` 为空时不创建任何文件。 */
export function appendSurfaceLog(
  repoRoot: string,
  entries: readonly SurfaceLogEntry[],
): void {
  if (entries.length === 0) return;
  const byId = new Map<string, SurfaceLogEntry[]>();
  for (const e of entries) {
    const list = byId.get(e.confirmation_id) ?? [];
    list.push(e);
    byId.set(e.confirmation_id, list);
  }
  for (const [id, list] of byId) {
    const file = surfaceLogPath(repoRoot, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = list.map((e) => `${JSON.stringify(e)}\n`).join("");
    fs.appendFileSync(file, body, "utf-8");
  }
}

function isEntry(
  value: unknown,
  confirmationId: string,
): value is SurfaceLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Record<keyof SurfaceLogEntry, unknown>>;
  return (
    v.confirmation_id === confirmationId &&
    typeof v.item_ref === "string" &&
    v.item_ref.length > 0 &&
    isSection(v.section) &&
    typeof v.presented_at === "string" &&
    typeof v.plain_text_version === "string"
  );
}

/**
 * 读取某次确认的呈现日志。文件不存在返回 `null`（即「缺 surface_log」）。
 * 任一行损坏即抛错：宁可报错也不把残缺日志当作完整证据。
 */
export function readSurfaceLog(
  repoRoot: string,
  confirmationId: string,
): SurfaceLogEntry[] | null {
  const file = surfaceLogPath(repoRoot, confirmationId);
  if (!fs.existsSync(file)) return null;
  const lines = fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "");
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(
        `surface_log 第 ${index + 1} 行不是合法 JSON（${confirmationId}）`,
      );
    }
    if (!isEntry(parsed, confirmationId)) {
      throw new Error(
        `surface_log 第 ${index + 1} 行字段不完整或归属不符（${confirmationId}）`,
      );
    }
    return parsed;
  });
}

/**
 * 退化判定：缺日志或该确认下没有任何呈现条目时，返回「无呈现记录」；否则返回 `null`。
 * K-14 在 `resolution_note` 中写入该文案，且不得据此伪造 (a)/(b) 分类。
 */
export function surfaceLogResolutionNote(
  entries: readonly SurfaceLogEntry[] | null,
): string | null {
  if (entries === null || entries.length === 0) return NO_SURFACE_RECORD_NOTE;
  return null;
}
