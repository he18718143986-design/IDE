/**
 * TASK-J.16 K-16 接线 · `user_dispute` 归因写入（playtest-self-check §5.1 / §5.3）。
 *
 * - `confirmation_id` 由前端透传（用户当时看的那份确认）；服务端只校验，不改用自己查到的值。
 * - 失败关闭：缺失、surface_log 中不存在、或日志损坏 → 不写归因，返回 rejected 原因（调用方留痕）。
 * - 2b 输入为近似（P-190）：`change_on_unmapped_file` = 改动超出合同授权范围；
 *   `change_in_unshown_area` = 有范围内改动且确认清单未展示任何 area。item_ref 暂为空。
 */
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import {
  appendAttributionEntries,
  buildAttributionEntry,
} from "./attribution-ledger";
import { classifyAttribution, snapshotRefsFromDraft } from "./attribution";
import { computeSignals } from "./classification";
import { readSurfaceLog, type SurfaceLogEntry } from "./surface-log";
import type { DisputeReport } from "./types";
import { loadOrInitLedgerState } from "../intent-compiler/scheme-ledger-store";

export type UserDisputeAttributionRejection =
  | "confirmation_id_missing"
  | "confirmation_not_found"
  | "surface_log_unreadable"
  | "invalid_entry"
  | "cas_mismatch"
  | "io";

export type UserDisputeAttributionOutcome =
  | { status: "recorded"; attribution_id: string; category: string }
  | { status: "duplicate"; attribution_id: string }
  | { status: "rejected"; reason: UserDisputeAttributionRejection };

export function recordUserDisputeAttribution(params: {
  repoRoot: string;
  report: DisputeReport;
  contract: SoftwareContract;
  confirmationId: string | null;
}): UserDisputeAttributionOutcome {
  const rejected = (
    reason: UserDisputeAttributionRejection,
  ): UserDisputeAttributionOutcome => ({ status: "rejected", reason });

  if (params.confirmationId === null)
    return rejected("confirmation_id_missing");

  let entries: SurfaceLogEntry[] | null;
  try {
    entries = readSurfaceLog(params.repoRoot, params.confirmationId);
  } catch {
    return rejected("surface_log_unreadable");
  }
  if (entries === null) return rejected("confirmation_not_found");

  const ledger = loadOrInitLedgerState(params.repoRoot);
  const signals = computeSignals(params.report.facts, params.contract);
  const changed = params.report.facts.code.changed_files.length;
  const inScope = signals.changed_files_in_scope;
  const attributionId = `attr_${params.report.report_id}`;

  const built = buildAttributionEntry({
    attribution_id: attributionId,
    trigger: "user_dispute",
    item_ref: null,
    result: classifyAttribution({
      item_ref: null,
      snapshot_refs: snapshotRefsFromDraft(ledger.draft),
      surface_entries: entries,
      change_in_unshown_area:
        inScope > 0 && !entries.some((e) => e.section === "area"),
      change_on_unmapped_file: changed > inScope,
    }),
    created_in_revision: ledger.draft.scheme_revision,
  });
  if (!built.ok) return rejected("invalid_entry");

  const written = appendAttributionEntries(params.repoRoot, [built.value]);
  if (!written.ok) {
    return rejected(
      written.reason === "cas_mismatch" || written.reason === "io"
        ? written.reason
        : "invalid_entry",
    );
  }
  if (written.appended === 0) {
    return { status: "duplicate", attribution_id: attributionId };
  }
  return {
    status: "recorded",
    attribution_id: attributionId,
    category: built.value.category,
  };
}
