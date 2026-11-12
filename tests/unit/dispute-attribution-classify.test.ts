/**
 * TASK-J.16 · K-14 三分类归因算法（playtest-self-check §5.3）。
 * 覆盖 J16-P2（同一输入可复现）与 J16-P4（缺 surface_log 时退化、不伪造 (a)/(b)）。
 */
import { describe, expect, it } from "vitest";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import {
  classifyAttribution,
  snapshotRefsFromDraft,
  type AttributionInput,
  type SnapshotRef,
} from "../../daemon/supervisor/dispute/attribution";
import {
  NO_SURFACE_RECORD_NOTE,
  type SurfaceLogEntry,
} from "../../daemon/supervisor/dispute/surface-log";

function entry(
  item_ref: string,
  section: SurfaceLogEntry["section"],
): SurfaceLogEntry {
  return {
    confirmation_id: "conf_1",
    item_ref,
    section,
    presented_at: "2026-11-12T00:00:00.000Z",
    plain_text_version: "v1",
  };
}

const snapshot: SnapshotRef[] = [
  { item_ref: "D-1", section: "decision", approved: true },
  { item_ref: "D-2", section: "decision", approved: false },
  { item_ref: "ITEM-1", section: "acceptance", approved: true },
];

function base(over: Partial<AttributionInput> = {}): AttributionInput {
  return {
    item_ref: null,
    snapshot_refs: snapshot,
    surface_entries: [],
    change_in_unshown_area: false,
    change_on_unmapped_file: false,
    ...over,
  };
}

describe("K-14 classifyAttribution", () => {
  it("清单上展示过且已获批 → approved_on_list", () => {
    const r = classifyAttribution(
      base({
        item_ref: "D-1",
        surface_entries: [entry("D-1", "decision")],
      }),
    );
    expect(r.category).toBe("approved_on_list");
  });

  it("在快照中但未出现在确认清单上 → diff_unsurfaced（2a）", () => {
    const r = classifyAttribution(
      base({
        item_ref: "ITEM-1",
        surface_entries: [entry("D-1", "decision")],
      }),
    );
    expect(r.category).toBe("diff_unsurfaced");
  });

  it("展示过但未获批（待定决定）不算 approved_on_list", () => {
    const r = classifyAttribution(
      base({
        item_ref: "D-2",
        surface_entries: [entry("D-2", "decision")],
      }),
    );
    expect(r.category).not.toBe("approved_on_list");
  });

  it("item_ref 为空、改动落在未展示区域 → diff_unsurfaced 且注明未定位", () => {
    const r = classifyAttribution(
      base({
        item_ref: null,
        surface_entries: [entry("area-a", "area")],
        change_in_unshown_area: true,
      }),
    );
    expect(r.category).toBe("diff_unsurfaced");
    expect(r.resolution_note).toContain("未能定位到方案条目");
  });

  it("越界文件未展示过 → diff_unsurfaced；已展示过 → absent_from_diff", () => {
    const hidden = classifyAttribution(
      base({
        surface_entries: [entry("area-a", "area")],
        change_on_unmapped_file: true,
      }),
    );
    expect(hidden.category).toBe("diff_unsurfaced");

    const shown = classifyAttribution(
      base({
        surface_entries: [entry("area-a", "area"), entry("", "unmapped_files")],
        change_on_unmapped_file: true,
      }),
    );
    expect(shown.category).toBe("absent_from_diff");
  });

  it("差集中没有对应改动 → absent_from_diff", () => {
    const r = classifyAttribution(
      base({
        item_ref: null,
        surface_entries: [entry("area-a", "area")],
      }),
    );
    expect(r.category).toBe("absent_from_diff");
  });

  it("J16-P4：缺日志或日志为空时退化为无呈现记录，不伪造 (a)/(b)", () => {
    for (const surface_entries of [null, []] as const) {
      const r = classifyAttribution(
        base({
          item_ref: "D-1",
          surface_entries,
          change_in_unshown_area: true,
        }),
      );
      expect(r.category).toBe("no_surface_record");
      expect(r.resolution_note).toBe(NO_SURFACE_RECORD_NOTE);
    }
  });

  it("J16-P2：同一输入两次分类结果完全相同", () => {
    const input = base({
      item_ref: "D-1",
      surface_entries: [entry("D-1", "decision"), entry("area-a", "area")],
      change_on_unmapped_file: true,
    });
    expect(classifyAttribution(input)).toEqual(classifyAttribution(input));
  });
});

describe("K-14 snapshotRefsFromDraft", () => {
  it("decision 仅 accepted/changed 视为获批；acceptance 视为获批", () => {
    const draft = {
      decisions: [
        { id: "D-1", status: "accepted" },
        { id: "D-2", status: "changed" },
        { id: "D-3", status: "pending" },
      ],
      acceptance: [{ id: "ITEM-1", text: "x" }],
    } as unknown as SchemeDraftV2;
    const refs = snapshotRefsFromDraft(draft);
    expect(refs).toEqual([
      { item_ref: "D-1", section: "decision", approved: true },
      { item_ref: "D-2", section: "decision", approved: true },
      { item_ref: "D-3", section: "decision", approved: false },
      { item_ref: "ITEM-1", section: "acceptance", approved: true },
    ]);
  });
});
