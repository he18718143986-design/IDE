/**
 * TASK-J.16 J16-P7（挂账⑬ 方案 A）：台账验收条目只读投影的单元测试。
 */
import { describe, it, expect } from "vitest";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import { projectSchemeAcceptance } from "../../daemon/supervisor/intent-compiler/acceptance-projection";
import {
  emptyLedgerState,
  emptySchemeDraftV2,
  type SchemeLedgerRecord,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

type AcceptanceEntry = SchemeDraftV2["acceptance"][number];

function item(id: string, text: string): AcceptanceEntry {
  return {
    id,
    text,
    source: "user_said",
    evidence: [],
    user_pinned: false,
    updated_in_revision: 1,
  };
}

function recordWith(
  acceptance: AcceptanceEntry[],
  over: { scheme_id?: string; scheme_revision?: number } = {},
): SchemeLedgerRecord {
  return {
    schema_version: "1.0",
    updated_at: "2026-11-11T00:00:00.000Z",
    state: emptyLedgerState({
      draft: emptySchemeDraftV2({
        scheme_id: over.scheme_id ?? "scheme-active",
        scheme_revision: over.scheme_revision ?? 3,
        acceptance,
      }),
    }),
    last_journal: null,
    last_model_id: null,
    last_prompt_version: null,
    offline: true,
  };
}

describe("TASK-J.16 J16-P7 · 台账验收条目只读投影", () => {
  it("没有台账时返回空投影，不伪造条目", () => {
    expect(projectSchemeAcceptance(null)).toEqual({
      scheme_id: null,
      scheme_revision: null,
      items: [],
    });
  });

  it("按台账原顺序输出 id 与白话文本，并带回方案 ID 与修订号", () => {
    const projection = projectSchemeAcceptance(
      recordWith(
        [item("ITEM-1", "首页显示逾期数"), item("ITEM-2", "报表可导出 CSV")],
        { scheme_id: "scheme-x", scheme_revision: 7 },
      ),
    );
    expect(projection).toEqual({
      scheme_id: "scheme-x",
      scheme_revision: 7,
      items: [
        { id: "ITEM-1", text: "首页显示逾期数" },
        { id: "ITEM-2", text: "报表可导出 CSV" },
      ],
    });
  });

  it("丢弃 id 或文本为空白的条目；重复 id 只保留首条", () => {
    const projection = projectSchemeAcceptance(
      recordWith([
        item("ITEM-1", "  首页显示逾期数  "),
        item("  ", "无 id 的条目"),
        item("ITEM-2", "   "),
        item("ITEM-1", "重复 id 的后条"),
      ]),
    );
    expect(projection.items).toEqual([
      { id: "ITEM-1", text: "首页显示逾期数" },
    ]);
  });

  it("只读：投影不修改台账记录", () => {
    const record = recordWith([item("ITEM-1", "首页显示逾期数")]);
    const before = JSON.stringify(record);
    projectSchemeAcceptance(record);
    expect(JSON.stringify(record)).toBe(before);
  });
});
