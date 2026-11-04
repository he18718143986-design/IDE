import fs from "node:fs";
import path from "node:path";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";
import { writeStateFile } from "../guard/state-store";
import { shouldIgnore } from "./fs-watcher";
import { computeWorktreeFingerprintSync } from "../guard/evidence-integrity";

/**
 * Evidence 失效引擎（规范 TASK-B.2 PASS-2/3 与 R-5 增量比对优化）。
 * Evidence 生成时记录 Worktree 指纹；外部文件新增/修改/删除时仅对变更路径进行增量判定；
 * 只要发生未被忽略的文件改动，立即原子改写磁盘证据为 STALE、can_merge=false、reason_code=EVIDENCE_STALE。
 */
export interface RegisteredEvidence {
  contractId: string;
  evidencePath: string;
  fingerprint: string;
}

export interface InvalidationResult {
  contractId: string;
  evidencePath: string;
  stale: boolean;
}

export class EvidenceInvalidationEngine {
  private readonly worktreePath: string;
  private readonly records = new Map<string, RegisteredEvidence>();

  constructor(worktreePath: string) {
    this.worktreePath = path.resolve(worktreePath);
  }

  /**
   * 生成当前 Worktree 全量指纹（规范 TASK-B.2 收敛至 evidence-integrity 单点实现）。
   * 仅在 register / 快照对齐两处使用，严禁在 debounce 变更处理中循环扫盘。
   */
  computeFingerprint(): string {
    return computeWorktreeFingerprintSync(this.worktreePath);
  }

  register(contractId: string, evidencePath: string): RegisteredEvidence {
    const resolvedPath = path.resolve(evidencePath);
    let fp: string;
    try {
      if (fs.existsSync(resolvedPath)) {
        const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as {
          worktree_snapshot?: { snapshot_fingerprint?: string };
        };
        fp =
          raw?.worktree_snapshot?.snapshot_fingerprint ||
          this.computeFingerprint();
      } else {
        fp = this.computeFingerprint();
      }
    } catch {
      fp = this.computeFingerprint();
    }

    const record: RegisteredEvidence = {
      contractId,
      evidencePath: resolvedPath,
      fingerprint: fp,
    };
    this.records.set(contractId, record);
    return record;
  }

  /** 未注册时按需登记（便于从磁盘证据恢复） */
  ensureRegistered(
    contractId: string,
    evidencePath: string,
  ): RegisteredEvidence {
    return (
      this.records.get(contractId) ?? this.register(contractId, evidencePath)
    );
  }

  /**
   * 变更路径增量判定（规范 TASK-B.2 R-5 / PASS-1）：
   * 仅针对 chokidar 捕获的具体 changedPaths 进行 IGNORED_SEGMENTS 过滤与判定；
   * 严禁在 debounce 事件中对整树做递归扫盘。
   */
  handleIncrementalChanges(changedPaths: string[]): InvalidationResult[] {
    if (changedPaths.length === 0 || this.records.size === 0) return [];

    // 过滤出工作树内且未被忽略的文件路径
    const relevantPaths = changedPaths.filter(
      (p) => !shouldIgnore(p, this.worktreePath),
    );
    if (relevantPaths.length === 0) return [];

    const results: InvalidationResult[] = [];
    for (const record of this.records.values()) {
      this.markStale(record);
      results.push({
        contractId: record.contractId,
        evidencePath: record.evidencePath,
        stale: true,
      });
    }
    return results;
  }

  /** 别名兼容现有调用方 */
  handleChanges(changedPaths: string[]): InvalidationResult[] {
    return this.handleIncrementalChanges(changedPaths);
  }

  /** 将证据文件原子改写为 STALE（保持 §9.2 Schema 合法） */
  markStale(record: RegisteredEvidence): void {
    if (!fs.existsSync(record.evidencePath)) return;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(record.evidencePath, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      return;
    }
    const verdict = (raw["verdict"] ?? {}) as Record<string, unknown>;

    const updated = evidenceBundleSchema.parse({
      ...raw,
      verdict: {
        ...verdict,
        status: "STALE",
        can_merge: false,
        reason_code: "EVIDENCE_STALE",
        summary: `Evidence invalidated: worktree changed after verification (${new Date().toISOString()})`,
      },
    });

    writeStateFile(record.evidencePath, updated);
  }
}
