/**
 * TASK-J.16 K-14 · 三分类归因算法（playtest-self-check §5.3；supervisor §14.11 子账本四）。
 *
 * 纯确定性函数：同一输入恒得同一输出，不调用模型、不读写磁盘。
 * 台账写入（`attributions` 追加）不在本模块内，待卡修订后另行接线。
 *
 * 三分类：
 * - approved_on_list：条目在呈现清单上且已获批（审查通道问题）；
 * - diff_unsurfaced：差集里有，但没有分级上屏（分流规则问题）；
 * - absent_from_diff：差集里根本没有（规格残缺 / 回写断裂 / 意图未结晶）。
 *
 * J16-P4：呈现日志缺失或为空时不做 (a)/(b) 判定，category 为 null，resolution_note 标「无呈现记录」。
 */
import type { SchemeDraftV2 } from "../../../src/lib/journey/scheme-patch-types";
import {
  NO_SURFACE_RECORD_NOTE,
  type SurfaceLogEntry,
  type SurfaceSection,
} from "./surface-log";

export const ATTRIBUTION_CATEGORIES = [
  "approved_on_list",
  "diff_unsurfaced",
  "absent_from_diff",
] as const;
export type AttributionCategory = (typeof ATTRIBUTION_CATEGORIES)[number];

/** 冻结快照中可被归因的条目（由 `snapshotRefsFromDraft` 从方案派生） */
export interface SnapshotRef {
  item_ref: string;
  /** 只取确认清单相关的 section（decision / acceptance / approval / high_risk） */
  section: Extract<
    SurfaceSection,
    "decision" | "acceptance" | "approval" | "high_risk"
  >;
  /** 已获批：decision.status ∈ {accepted, changed}；acceptance 在确认时存在即视为获批 */
  approved: boolean;
}

export interface AttributionInput {
  /** 质疑指向的方案条目 id；无法定位时为 null */
  item_ref: string | null;
  snapshot_refs: readonly SnapshotRef[];
  /** `readSurfaceLog` 的结果：null 表示缺日志 */
  surface_entries: readonly SurfaceLogEntry[] | null;
  /** 质疑对应的改动落在未展示的区域（playtest 侧 area 未上屏） */
  change_in_unshown_area: boolean;
  /** 质疑对应的改动落在「另有改动不在原定区域里」的文件上 */
  change_on_unmapped_file: boolean;
}

export interface AttributionResult {
  category: AttributionCategory | null;
  resolution_note: string;
}

/** 确认清单上的 section（§5.3 at_freeze）；playtest 的 area / unmapped_files 不参与 (a) 判定 */
const FREEZE_SECTIONS: readonly SurfaceSection[] = [
  "decision",
  "acceptance",
  "approval",
  "high_risk",
];

/** 从冻结方案派生可归因条目（仅 decision 与 acceptance；needs_approval 不在 SchemeDraftV2 内，暂不派生） */
export function snapshotRefsFromDraft(draft: SchemeDraftV2): SnapshotRef[] {
  const refs: SnapshotRef[] = [];
  for (const d of draft.decisions) {
    refs.push({
      item_ref: d.id,
      section: "decision",
      approved: d.status === "accepted" || d.status === "changed",
    });
  }
  for (const a of draft.acceptance) {
    refs.push({ item_ref: a.id, section: "acceptance", approved: true });
  }
  return refs;
}

/** 按 §5.3 算法（先命中先用）判定三分类。 */
export function classifyAttribution(
  input: AttributionInput,
): AttributionResult {
  const entries = input.surface_entries;
  if (entries === null || entries.length === 0) {
    return { category: null, resolution_note: NO_SURFACE_RECORD_NOTE };
  }

  const freezeShown = new Set(
    entries
      .filter((e) => (FREEZE_SECTIONS as readonly string[]).includes(e.section))
      .map((e) => e.item_ref),
  );
  const unmappedShown = entries.some((e) => e.section === "unmapped_files");

  const ref = input.item_ref;
  const snap =
    ref === null
      ? undefined
      : input.snapshot_refs.find((s) => s.item_ref === ref);
  const locateNote = ref === null ? "未能定位到方案条目；" : "";

  // 1. 清单上有且已获批
  if (snap !== undefined && freezeShown.has(snap.item_ref) && snap.approved) {
    return {
      category: "approved_on_list",
      resolution_note: `${locateNote}条目 ${snap.item_ref} 在确认清单上展示过且已获批（审查通道问题）`,
    };
  }

  // 2. 差集里有但没分级上屏
  if (snap !== undefined && !freezeShown.has(snap.item_ref)) {
    return {
      category: "diff_unsurfaced",
      resolution_note: `条目 ${snap.item_ref} 在快照中，但未出现在确认清单上（分流规则问题）`,
    };
  }
  if (input.change_in_unshown_area) {
    return {
      category: "diff_unsurfaced",
      resolution_note: `${locateNote}质疑对应的改动落在未展示的区域（分流规则问题）`,
    };
  }
  if (input.change_on_unmapped_file && !unmappedShown) {
    return {
      category: "diff_unsurfaced",
      resolution_note: `${locateNote}质疑对应的改动落在未展示的「另有改动」文件上（分流规则问题）`,
    };
  }

  // 3. 差集里根本没有
  return {
    category: "absent_from_diff",
    resolution_note: `${locateNote}差集中没有对应改动（规格残缺 / 回写断裂 / 意图未结晶）`,
  };
}
