/**
 * TASK-J.22a：中栏只读投影单元测试。
 */
import { describe, it, expect } from "vitest";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import { projectSchemeMidpane } from "../../daemon/supervisor/intent-compiler/scheme-midpane-projection";
import {
  emptyLedgerState,
  emptySchemeDraftV2,
  type SchemeLedgerRecord,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

function recordWith(over: Partial<SchemeDraftV2> = {}): SchemeLedgerRecord {
  return {
    schema_version: "1.0",
    updated_at: "2026-11-16T00:00:00.000Z",
    state: emptyLedgerState({
      draft: emptySchemeDraftV2({
        scheme_id: "scheme-mid",
        scheme_revision: 4,
        ...over,
      }),
    }),
    last_journal: null,
    last_model_id: null,
    last_prompt_version: null,
    offline: true,
  };
}

describe("TASK-J.22a · 中栏只读投影", () => {
  it("没有台账时 available=false，不伪造条目", () => {
    expect(projectSchemeMidpane(null)).toMatchObject({
      available: false,
      scheme_id: null,
      title: "",
      goals: [],
      modules: [],
      acceptance: [],
    });
  });

  it("空壳台账（无实质内容）available=false", () => {
    const projection = projectSchemeMidpane(recordWith());
    expect(projection.available).toBe(false);
    expect(projection.scheme_id).toBe("scheme-mid");
    expect(projection.scheme_revision).toBe(4);
  });

  it("有实质内容时投影标题、目标、模块、验收条目", () => {
    const projection = projectSchemeMidpane(
      recordWith({
        title: "逾期看板",
        summary: "老板看本月逾期",
        goals: [
          {
            id: "G1",
            text: "看清逾期",
            source: "user_said",
            evidence: [],
            user_pinned: false,
            updated_in_revision: 1,
          },
        ],
        modules: [
          {
            id: "M1",
            name: "首页看板",
            purpose: "展示逾期",
            user_visible: true,
            kind: "new",
            source: "user_said",
            evidence: [],
            user_pinned: false,
            updated_in_revision: 1,
          },
        ],
        acceptance: [
          {
            id: "AC-1",
            text: "首页显示逾期数",
            source: "user_said",
            evidence: [],
            user_pinned: false,
            updated_in_revision: 1,
          },
        ],
      }),
    );
    expect(projection.available).toBe(true);
    expect(projection.title).toBe("逾期看板");
    expect(projection.summary).toBe("老板看本月逾期");
    expect(projection.goals).toEqual([
      expect.objectContaining({
        id: "G1",
        text: "看清逾期",
        status: "proposed",
        provenance: "业主原话",
      }),
    ]);
    expect(projection.modules).toEqual([
      expect.objectContaining({
        id: "M1",
        name: "首页看板",
        status: "proposed",
        provenance: "业主原话",
      }),
    ]);
    expect(projection.acceptance).toEqual([
      expect.objectContaining({
        id: "AC-1",
        text: "首页显示逾期数",
        status: "proposed",
        provenance: expect.stringContaining("业主原话"),
      }),
    ]);
    expect(projection.acceptance[0]).not.toHaveProperty("source");
    expect(projection.acceptance[0]).not.toHaveProperty("evidence");
  });

  it("TASK-J.38b：验收五字段只读；不改台账 source/evidence", () => {
    const record = recordWith({
      title: "逾期看板",
      frozen: true,
      acceptance: [
        {
          id: "AC-1",
          text: "首页显示逾期数",
          source: "ai_inferred",
          evidence: [{ kind: "turn", ref: { turn_id: "t-a" } }],
          user_pinned: false,
          updated_in_revision: 1,
        },
      ],
    });
    const beforeSource = record.state.draft.acceptance[0]?.source;
    const beforeEvidence = JSON.stringify(
      record.state.draft.acceptance[0]?.evidence,
    );
    const projection = projectSchemeMidpane(record);
    expect(projection.acceptance[0]?.status).toBe("confirmed");
    expect(projection.acceptance[0]?.provenance).toContain("AI 推断");
    expect(record.state.draft.acceptance[0]?.source).toBe(beforeSource);
    expect(JSON.stringify(record.state.draft.acceptance[0]?.evidence)).toBe(
      beforeEvidence,
    );
  });

  it("只读：投影不修改台账记录", () => {
    const record = recordWith({
      title: "逾期看板",
      acceptance: [
        {
          id: "AC-1",
          text: "首页显示逾期数",
          source: "user_said",
          evidence: [],
          user_pinned: false,
          updated_in_revision: 1,
        },
      ],
    });
    const before = JSON.stringify(record);
    projectSchemeMidpane(record);
    expect(JSON.stringify(record)).toBe(before);
  });
});
