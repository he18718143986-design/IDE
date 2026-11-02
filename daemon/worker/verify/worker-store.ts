/**
 * TASK-W.7：Worker 自助注册的持久化层（`.stagent/workers.json`）。
 *
 * 三条纪律：
 * 1. **原子落盘**：复用 `writeJsonAtomic()`（tmp + fsync + rename + 目录 fsync），
 *    不做「先清空再写」——探测报告与档位是同一份文件里的两个字段，半截写盘会
 *    产生「档位升了但报告没了」这种最难排查的状态。
 * 2. **读侧不信任文件**：这里只做结构性归一化（未知档位 / 缺字段一律按非受控处理），
 *    真正的「指纹是否还成立」由 `effectiveControlMode()` 在读时重算，本层不缓存结论。
 * 3. **内建项不落盘**：内建适配器由代码 `register()` 进注册表，本文件只存用户自注册项。
 *    两处都存会产生「同一 id 两个权威」的分叉。
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../../src/lib/state-machine";
import {
  WORKER_STORE_SCHEMA_VERSION,
  WorkerRegistrationError,
  isNonEmptyString,
  type WorkerRecord,
  type WorkerStoreFile,
} from "./worker-registration";

/** `.stagent/workers.json`（与 `.stagent/state.json` 同级，同为运行时状态） */
export function workersFilePath(repoRoot: string): string {
  return path.resolve(repoRoot, ".stagent", "workers.json");
}

const MODES: WorkerRecord["control_mode"][] = [
  "GATEWAY_ENFORCED",
  "SANDBOX_ENFORCED",
  "UNCONTROLLED_EXTERNAL",
];

function normalizeRecord(raw: unknown): WorkerRecord | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const adapterId = obj["adapter_id"];
  if (!isNonEmptyString(adapterId)) return null;

  const modeRaw = obj["control_mode"];
  // 无法识别的档位一律**降**为非受控（读侧永不升格）
  const control_mode = MODES.includes(modeRaw as WorkerRecord["control_mode"])
    ? (modeRaw as WorkerRecord["control_mode"])
    : "UNCONTROLLED_EXTERNAL";

  const launch = obj["launch"];
  const command =
    launch !== null && typeof launch === "object"
      ? (launch as Record<string, unknown>)["command"]
      : undefined;
  const argsRaw =
    launch !== null && typeof launch === "object"
      ? (launch as Record<string, unknown>)["args"]
      : undefined;

  const declaration = obj["declaration"];
  if (declaration === null || typeof declaration !== "object") return null;

  return {
    adapter_id: adapterId.trim(),
    adapter_version: isNonEmptyString(obj["adapter_version"])
      ? obj["adapter_version"].trim()
      : "0.0.0",
    launch: {
      command: isNonEmptyString(command) ? command : "<unknown>",
      args: Array.isArray(argsRaw)
        ? argsRaw.filter((item): item is string => typeof item === "string")
        : [],
    },
    declaration: declaration as WorkerRecord["declaration"],
    control_mode,
    verified_on:
      obj["verified_on"] !== null && typeof obj["verified_on"] === "object"
        ? (obj["verified_on"] as WorkerRecord["verified_on"])
        : undefined,
    last_report:
      obj["last_report"] !== null && typeof obj["last_report"] === "object"
        ? (obj["last_report"] as WorkerRecord["last_report"])
        : undefined,
    builtin: false,
    created_at: isNonEmptyString(obj["created_at"]) ? obj["created_at"] : "",
    updated_at: isNonEmptyString(obj["updated_at"]) ? obj["updated_at"] : "",
  };
}

/** 读取存储（文件不存在 → 空表；内容损坏 → 抛错而不是静默丢弃） */
export function loadWorkerStore(repoRoot: string): WorkerStoreFile {
  const file = workersFilePath(repoRoot);
  if (!fs.existsSync(file)) {
    return { schema_version: WORKER_STORE_SCHEMA_VERSION, workers: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    // 不静默重置：静默重置会让「档位记录」无声消失，用户以为还在受控
    throw new WorkerRegistrationError(
      "E_WORKER_STORE_CORRUPT",
      `无法解析 ${file}：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const workersRaw =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["workers"]
      : undefined;
  const workers = Array.isArray(workersRaw)
    ? workersRaw
        .map((item) => normalizeRecord(item))
        .filter((item): item is WorkerRecord => item !== null)
    : [];
  return { schema_version: WORKER_STORE_SCHEMA_VERSION, workers };
}

/** 原子写盘 */
export function saveWorkerStore(
  repoRoot: string,
  store: WorkerStoreFile,
): void {
  const file = workersFilePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, store);
}

export function findWorker(
  repoRoot: string,
  adapterId: string,
): WorkerRecord | undefined {
  return loadWorkerStore(repoRoot).workers.find(
    (worker) => worker.adapter_id === adapterId,
  );
}

/** 插入或替换单条记录（其余记录原样保留） */
export function upsertWorker(
  repoRoot: string,
  record: WorkerRecord,
): WorkerRecord {
  const store = loadWorkerStore(repoRoot);
  const index = store.workers.findIndex(
    (worker) => worker.adapter_id === record.adapter_id,
  );
  if (index >= 0) store.workers[index] = record;
  else store.workers.push(record);
  saveWorkerStore(repoRoot, store);
  return record;
}
