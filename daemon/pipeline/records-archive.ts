/**
 * TASK-C.12d / TASK-P0.16：MERGED 后向 `.stagent/records/{contract_id}/` 轻量无依赖拷贝。
 * 失败不得标 DELIVERED（由调用方根据 ok=false 阻断）。
 * P0.16 增加幂等补偿与显式重试机制（compensateContractRecordsArchive）。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  RECORDS_ROOT,
  recordsDir,
  writeAuditManifest,
  readAuditManifest,
  type AuditManifest,
} from "../guard/audit-manifest";
import {
  prototypeRelativeRoot,
  readDemoConfirm,
} from "../supervisor/demo/prototypes";

export interface RecordsArchiveResult {
  ok: boolean;
  records_dir: string;
  copied: string[];
  skipped?: string[] | undefined;
  repaired?: string[] | undefined;
  error?: string | undefined;
  manifest?: AuditManifest | undefined;
}

export interface RecordsArchiveCompensationInput {
  repoRoot: string;
  contract_id: string;
  prototype_id?: string | null | undefined;
  snapshot?: unknown;
  assertion_ids?: readonly string[] | undefined;
  commit_sha?: string | null | undefined;
  events?: unknown[] | undefined;
  forceOverwrite?: boolean | undefined;
}

export interface RecordsArchiveCompensationResult extends RecordsArchiveResult {
  compensated: boolean;
  skipped: string[];
  repaired: string[];
}

/** 计算文件 SHA-256，文件不存在或读取失败返回 null */
function fileSha256(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/** 比较本地 JSON 文件与内存对象是否一致 */
function jsonFileEquals(filePath: string, expected: unknown): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return JSON.stringify(current) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

/** 原子写入字符串/Buffer：写入同目录临时文件后重命名，防止半写 */
function writeAtomic(dest: string, content: string | Buffer): void {
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.tmp-${path.basename(dest)}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, dest);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore unlink cleanup error
    }
    throw err;
  }
}

/** 原子拷贝文件 */
function copyFileAtomic(src: string, dest: string): boolean {
  const dir = path.dirname(dest);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(
      dir,
      `.tmp-${path.basename(dest)}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    try {
      fs.copyFileSync(src, tmpPath);
      fs.renameSync(tmpPath, dest);
      return true;
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      return false;
    }
  } catch {
    return false;
  }
}

function copyFileSafe(src: string, dest: string): boolean {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

/**
 * 轻量拷贝：Demo 快照（若有）+ 简易元数据；并写 audit-manifest。
 * 不依赖 Git remote。
 */
export function archiveContractRecords(input: {
  repoRoot: string;
  contract_id: string;
  prototype_id?: string | null;
  snapshot?: unknown;
  assertion_ids?: readonly string[];
  commit_sha?: string | null;
  events?: unknown[];
}): RecordsArchiveResult {
  const dir = recordsDir(input.repoRoot, input.contract_id);
  const copied: string[] = [];

  try {
    fs.mkdirSync(dir, { recursive: true });

    // Demo 确认元数据
    const confirm = readDemoConfirm(
      input.repoRoot,
      input.prototype_id ?? undefined,
    );
    if (confirm) {
      const dest = path.join(dir, "demo-confirm.json");
      writeAtomic(dest, JSON.stringify(confirm, null, 2));
      copied.push("demo-confirm.json");
    }

    // prototypes 入口快照（若存在）
    const protoId = input.prototype_id ?? confirm?.prototype_id;
    if (protoId) {
      const rel = prototypeRelativeRoot(protoId);
      const srcHtml = path.join(input.repoRoot, rel, "index.html");
      const srcMeta = path.join(input.repoRoot, rel, "meta.json");
      if (fs.existsSync(srcHtml)) {
        if (copyFileSafe(srcHtml, path.join(dir, "demo-index.html"))) {
          copied.push("demo-index.html");
        }
      }
      if (fs.existsSync(srcMeta)) {
        if (copyFileSafe(srcMeta, path.join(dir, "demo-meta.json"))) {
          copied.push("demo-meta.json");
        }
      }
    }

    // 合同侧车摘要
    const summaryPath = path.join(dir, "delivery-summary.json");
    writeAtomic(
      summaryPath,
      JSON.stringify(
        {
          contract_id: input.contract_id,
          archived_at: new Date().toISOString(),
          records_root: RECORDS_ROOT,
          commit_sha: input.commit_sha ?? null,
        },
        null,
        2,
      ),
    );
    copied.push("delivery-summary.json");

    const manifest = writeAuditManifest(input.repoRoot, {
      contract_id: input.contract_id,
      snapshot: input.snapshot ?? {
        contract_id: input.contract_id,
        copied,
      },
      events: input.events ?? [{ type: "RECORDS_ARCHIVED", copied }],
      // exactOptionalPropertyTypes：这两个可选字段省略而非传 undefined
      ...(input.assertion_ids !== undefined
        ? { assertion_ids: input.assertion_ids }
        : {}),
      ...(input.commit_sha !== undefined
        ? { commit_sha: input.commit_sha }
        : {}),
    });
    copied.push("audit-manifest.json");

    return { ok: true, records_dir: dir, copied, manifest };
  } catch (err) {
    return {
      ok: false,
      records_dir: dir,
      copied,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * TASK-P0.16：幂等补偿修证 records 归档。
 * 针对 Git 合并落地后辅助性拷贝失败场景提供安全的幂等重试与断点续拷能力：
 * 1. contract_id 作为幂等键定位归档目录；
 * 2. 检查已存在文件的完整性与指纹比对，完整且匹配的文件自动跳过（skip）；
 * 3. 缺失或损坏的文件进行断点续拷或原子覆写（repair / copy）；
 * 4. 原子覆写 audit-manifest.json 并返回结构化补偿审计结果；
 * 5. 重复触发具有强幂等性，不产生重复或脏数据。
 */
export function compensateContractRecordsArchive(
  input: RecordsArchiveCompensationInput,
): RecordsArchiveCompensationResult {
  const dir = recordsDir(input.repoRoot, input.contract_id);
  const copied: string[] = [];
  const skipped: string[] = [];
  const repaired: string[] = [];

  try {
    fs.mkdirSync(dir, { recursive: true });

    // 1. Demo 确认元数据 (demo-confirm.json)
    const confirm = readDemoConfirm(
      input.repoRoot,
      input.prototype_id ?? undefined,
    );
    if (confirm) {
      const dest = path.join(dir, "demo-confirm.json");
      if (fs.existsSync(dest)) {
        if (!input.forceOverwrite && jsonFileEquals(dest, confirm)) {
          skipped.push("demo-confirm.json");
        } else {
          writeAtomic(dest, JSON.stringify(confirm, null, 2));
          repaired.push("demo-confirm.json");
        }
      } else {
        writeAtomic(dest, JSON.stringify(confirm, null, 2));
        copied.push("demo-confirm.json");
      }
    }

    // 2. prototypes 入口快照 (demo-index.html / demo-meta.json)
    const protoId = input.prototype_id ?? confirm?.prototype_id;
    if (protoId) {
      const rel = prototypeRelativeRoot(protoId);
      const srcHtml = path.join(input.repoRoot, rel, "index.html");
      const srcMeta = path.join(input.repoRoot, rel, "meta.json");

      if (fs.existsSync(srcHtml)) {
        const destHtml = path.join(dir, "demo-index.html");
        if (fs.existsSync(destHtml)) {
          const srcHash = fileSha256(srcHtml);
          const destHash = fileSha256(destHtml);
          if (
            !input.forceOverwrite &&
            srcHash &&
            destHash &&
            srcHash === destHash
          ) {
            skipped.push("demo-index.html");
          } else {
            if (copyFileAtomic(srcHtml, destHtml)) {
              repaired.push("demo-index.html");
            }
          }
        } else {
          if (copyFileAtomic(srcHtml, destHtml)) {
            copied.push("demo-index.html");
          }
        }
      }

      if (fs.existsSync(srcMeta)) {
        const destMeta = path.join(dir, "demo-meta.json");
        if (fs.existsSync(destMeta)) {
          const srcHash = fileSha256(srcMeta);
          const destHash = fileSha256(destMeta);
          if (
            !input.forceOverwrite &&
            srcHash &&
            destHash &&
            srcHash === destHash
          ) {
            skipped.push("demo-meta.json");
          } else {
            if (copyFileAtomic(srcMeta, destMeta)) {
              repaired.push("demo-meta.json");
            }
          }
        } else {
          if (copyFileAtomic(srcMeta, destMeta)) {
            copied.push("demo-meta.json");
          }
        }
      }
    }

    // 3. 合同侧车摘要 (delivery-summary.json)
    const summaryPath = path.join(dir, "delivery-summary.json");
    const summaryExpected = {
      contract_id: input.contract_id,
      records_root: RECORDS_ROOT,
      commit_sha: input.commit_sha ?? null,
    };

    if (fs.existsSync(summaryPath)) {
      let isIntact = false;
      try {
        const currentSummary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
        if (
          currentSummary &&
          currentSummary.contract_id === summaryExpected.contract_id &&
          currentSummary.commit_sha === summaryExpected.commit_sha &&
          currentSummary.records_root === summaryExpected.records_root
        ) {
          isIntact = true;
        }
      } catch {
        isIntact = false;
      }

      if (!input.forceOverwrite && isIntact) {
        skipped.push("delivery-summary.json");
      } else {
        writeAtomic(
          summaryPath,
          JSON.stringify(
            {
              ...summaryExpected,
              archived_at: new Date().toISOString(),
              compensated: true,
            },
            null,
            2,
          ),
        );
        repaired.push("delivery-summary.json");
      }
    } else {
      writeAtomic(
        summaryPath,
        JSON.stringify(
          {
            ...summaryExpected,
            archived_at: new Date().toISOString(),
            compensated: true,
          },
          null,
          2,
        ),
      );
      copied.push("delivery-summary.json");
    }

    // 4. 审计侧车清单 (audit-manifest.json)
    const existingManifest = readAuditManifest(
      input.repoRoot,
      input.contract_id,
    );
    const allFilesReady = [...copied, ...skipped, ...repaired];

    if (
      !input.forceOverwrite &&
      existingManifest &&
      existingManifest.contract_id === input.contract_id &&
      existingManifest.commit_sha === (input.commit_sha ?? null)
    ) {
      skipped.push("audit-manifest.json");
    } else {
      const manifest = writeAuditManifest(input.repoRoot, {
        contract_id: input.contract_id,
        snapshot: input.snapshot ?? {
          contract_id: input.contract_id,
          files: allFilesReady,
          compensated: true,
        },
        events: input.events ?? [
          {
            type: "RECORDS_ARCHIVED_COMPENSATED",
            files: allFilesReady,
            timestamp: new Date().toISOString(),
          },
        ],
        ...(input.assertion_ids !== undefined
          ? { assertion_ids: input.assertion_ids }
          : {}),
        ...(input.commit_sha !== undefined
          ? { commit_sha: input.commit_sha }
          : {}),
      });

      if (existingManifest) {
        repaired.push("audit-manifest.json");
      } else {
        copied.push("audit-manifest.json");
      }
    }

    const finalManifest =
      readAuditManifest(input.repoRoot, input.contract_id) ?? undefined;

    return {
      ok: true,
      records_dir: dir,
      copied,
      skipped,
      repaired,
      compensated: true,
      ...(finalManifest ? { manifest: finalManifest } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      records_dir: dir,
      copied,
      skipped,
      repaired,
      compensated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * DELIVERED 门禁：records 归档失败则不得标 DELIVERED。
 */
export function assertRecordsReadyForDelivered(
  repoRoot: string,
  contractId: string,
): void {
  const dir = recordsDir(repoRoot, contractId);
  const manifest = path.join(dir, "audit-manifest.json");
  if (!fs.existsSync(manifest)) {
    const err = new Error(
      `records 归档未完成（缺少 audit-manifest），禁止标 DELIVERED`,
    ) as Error & { code: string };
    err.code = "E_RECORDS_ARCHIVE_REQUIRED";
    throw err;
  }
}
