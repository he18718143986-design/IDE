/**
 * TASK-J.50a-1：PAB 落盘与读取（`.stagent/project/architecture-baseline.json`）。
 * 旧修订归档到 `architecture-baseline.revisions/<revision>.json`；已归档文件不可改写。
 * 格式锚定现有 ReadyPabView（decompose.ts）；digest 由调用方写入，本卡原样落盘与读出。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../src/lib/state-machine";
import type { ReadyPabView } from "../supervisor/decomposer/decompose";

export const PROJECT_DIR = ".stagent/project" as const;
export const ARCHITECTURE_BASELINE_FILENAME =
  "architecture-baseline.json" as const;
export const ARCHITECTURE_BASELINE_REVISIONS_DIR =
  "architecture-baseline.revisions" as const;

export type ArchitectureBaselineStoreErrorCode =
  | "E_PAB_INVALID"
  | "E_PAB_REVISION_EXISTS"
  | "E_PAB_UNREADABLE";

export class ArchitectureBaselineStoreError extends Error {
  readonly code: ArchitectureBaselineStoreErrorCode;

  constructor(code: ArchitectureBaselineStoreErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ArchitectureBaselineStoreError";
    this.code = code;
  }
}

export function architectureBaselinePath(projectRoot: string): string {
  return path.resolve(
    projectRoot,
    PROJECT_DIR,
    ARCHITECTURE_BASELINE_FILENAME,
  );
}

export function architectureBaselineRevisionPath(
  projectRoot: string,
  revision: number,
): string {
  return path.resolve(
    projectRoot,
    PROJECT_DIR,
    ARCHITECTURE_BASELINE_REVISIONS_DIR,
    `${revision}.json`,
  );
}

/**
 * 读取当前 PAB。文件不存在时返回 null（明确的 not-found）。
 * 文件存在但无法解析或字段不合 ReadyPabView 时失败关闭。
 */
export function readCurrentArchitectureBaseline(
  projectRoot: string,
): ReadyPabView | null {
  return readPabFile(architectureBaselinePath(projectRoot));
}

/**
 * 读取已归档修订。文件不存在时返回 null；损坏或字段非法时失败关闭。
 */
export function readArchitectureBaselineRevision(
  projectRoot: string,
  revision: number,
): ReadyPabView | null {
  return readPabFile(architectureBaselineRevisionPath(projectRoot, revision));
}

/**
 * 写入当前 PAB。若已有当前文件，先归档到
 * `architecture-baseline.revisions/<旧 baseline_revision>.json`，再写新文件。
 * 已存在的归档目标不得覆盖；不得把已归档修订再次写成当前。
 * digest 原样落盘，不重新计算。
 */
export function writeCurrentArchitectureBaseline(
  projectRoot: string,
  pab: ReadyPabView,
): void {
  const next = normalizeReadyPabView(pab, "write");
  const currentPath = architectureBaselinePath(projectRoot);
  const nextArchive = architectureBaselineRevisionPath(
    projectRoot,
    next.baseline_revision,
  );
  if (fs.existsSync(nextArchive)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_REVISION_EXISTS",
      `修订 ${next.baseline_revision} 已归档，不得改写：${nextArchive}`,
    );
  }

  const previous = readCurrentArchitectureBaseline(projectRoot);
  if (previous) {
    if (previous.baseline_revision === next.baseline_revision) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_REVISION_EXISTS",
        `修订 ${next.baseline_revision} 已作为当前 PAB 落盘，不得直接改写`,
      );
    }
    const archivePath = architectureBaselineRevisionPath(
      projectRoot,
      previous.baseline_revision,
    );
    if (fs.existsSync(archivePath)) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_REVISION_EXISTS",
        `修订 ${previous.baseline_revision} 已归档，不得改写：${archivePath}`,
      );
    }
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    writeJsonAtomic(archivePath, previous);
  }

  fs.mkdirSync(path.dirname(currentPath), { recursive: true });
  writeJsonAtomic(currentPath, next);
}

function readPabFile(target: string): ReadyPabView | null {
  if (!fs.existsSync(target)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ArchitectureBaselineStoreError(
      "E_PAB_UNREADABLE",
      `PAB 文件无法解析：${target}（${detail}）`,
    );
  }
  return normalizeReadyPabView(raw, target);
}

function normalizeReadyPabView(value: unknown, source: string): ReadyPabView {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `PAB 必须是对象（来源：${source}）`,
    );
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.baseline_id !== "string" || rec.baseline_id.length === 0) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 baseline_id（来源：${source}）`,
    );
  }
  if (
    typeof rec.baseline_revision !== "number" ||
    !Number.isInteger(rec.baseline_revision)
  ) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 baseline_revision（来源：${source}）`,
    );
  }
  if (
    typeof rec.baseline_digest !== "string" ||
    rec.baseline_digest.length === 0
  ) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 baseline_digest（来源：${source}）`,
    );
  }
  if (!isPabStatus(rec.status)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `缺少或非法的 status（来源：${source}）`,
    );
  }

  const view: ReadyPabView = {
    baseline_id: rec.baseline_id,
    baseline_revision: rec.baseline_revision,
    baseline_digest: rec.baseline_digest,
    status: rec.status,
  };
  if (rec.open_decisions !== undefined) {
    view.open_decisions = normalizeOpenDecisions(rec.open_decisions, source);
  }
  return view;
}

function isPabStatus(
  value: unknown,
): value is ReadyPabView["status"] {
  return value === "draft" || value === "ready" || value === "stale";
}

function normalizeOpenDecisions(
  value: unknown,
  source: string,
): NonNullable<ReadyPabView["open_decisions"]> {
  if (!Array.isArray(value)) {
    throw new ArchitectureBaselineStoreError(
      "E_PAB_INVALID",
      `open_decisions 必须是数组（来源：${source}）`,
    );
  }
  return value.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `open_decisions[${index}] 必须是对象（来源：${source}）`,
      );
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.blocking !== "boolean") {
      throw new ArchitectureBaselineStoreError(
        "E_PAB_INVALID",
        `open_decisions[${index}].blocking 必须是 boolean（来源：${source}）`,
      );
    }
    return rec as { blocking: boolean };
  });
}
