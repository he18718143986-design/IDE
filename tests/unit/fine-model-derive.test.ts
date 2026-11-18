/**
 * TASK-J.38a：细模型类型 + V2 派生/回写纯函数。
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  FineActor,
  FineModelLayer,
  SchemeDraftV2,
  SchemeItemMeta,
  SchemeItemProjectionDto,
  AcceptanceItem,
} from "../../src/lib/journey/scheme-patch-types";
import {
  applyFineModelToV2,
  deriveFineModelFromV2,
  FINE_MODEL_PERSISTENCE,
} from "../../src/lib/journey/fine-model-derive";
import { emptySchemeDraftV2 } from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

function meta(
  id: string,
  source: SchemeItemMeta["source"] = "user_said",
): SchemeItemMeta {
  return {
    id,
    source,
    evidence: [
      {
        kind: "turn",
        ref: { turn_id: `t-${id}`, quote: "原话" },
      },
    ],
    user_pinned: false,
    updated_in_revision: 1,
  };
}

function sampleDraft(over: Partial<SchemeDraftV2> = {}): SchemeDraftV2 {
  return emptySchemeDraftV2({
    scheme_id: "scheme-fine",
    scheme_revision: 3,
    title: "逾期看板",
    goals: [
      {
        ...meta("G1"),
        text: "看清逾期",
      },
    ],
    modules: [
      {
        ...meta("M1"),
        name: "首页看板",
        purpose: "展示逾期",
        user_visible: true,
        kind: "new",
      },
      {
        ...meta("M2"),
        name: "内部批处理",
        purpose: "夜间汇总",
        user_visible: false,
        kind: "new",
      },
    ],
    flows: [
      {
        ...meta("F1"),
        name: "查看逾期",
        steps: [
          { actor: "老板", action: "打开看板", module_id: "M1" },
          { actor: "系统", action: "列出逾期" },
        ],
      },
    ],
    decisions: [
      {
        ...meta("D1"),
        question: "默认排序？",
        recommended: "按逾期天数降序",
        alternatives: ["按金额"],
        rationale: "先看最久",
        risk: "low",
        status: "pending",
      },
    ],
    acceptance: [
      {
        ...meta("AC1"),
        text: "打开即可看到逾期列表",
        check: "playtest",
      },
    ],
    ...over,
  });
}

describe("TASK-J.38a · 细模型类型可编冒烟", () => {
  it("六实体与 FineModelLayer 类型可构造，且不改 Meta/DTO 形状", () => {
    const actor: FineActor = {
      ...meta("fine-actor:老板", "ai_inferred"),
      name: "老板",
      derived_from: ["flow:F1"],
    };
    const layer: FineModelLayer = {
      projection_version: 1,
      source_scheme_id: "scheme-fine",
      source_scheme_revision: 3,
      actors: [actor],
      use_cases: [],
      processes: [],
      rules: [],
      screens: [],
      acceptance: [],
    };
    expect(layer.actors[0]?.source).toBe("ai_inferred");

    expectTypeOf<SchemeItemMeta>().toHaveProperty("source");
    expectTypeOf<SchemeItemMeta>().toHaveProperty("evidence");
    expectTypeOf<SchemeItemProjectionDto>().toHaveProperty("status");
    expectTypeOf<AcceptanceItem>().toHaveProperty("check");
    // notes 在 V2 顶层，不在 AcceptanceItem
    expectTypeOf<SchemeDraftV2>().toHaveProperty("notes");
  });
});

describe("TASK-J.38a · deriveFineModelFromV2", () => {
  it("派生输入必须是 V2：缺关键字段时返回空加层", () => {
    const bogus = { title: "不是 V2" } as unknown as SchemeDraftV2;
    const layer = deriveFineModelFromV2(bogus);
    expect(layer.projection_version).toBe(0);
    expect(layer.actors).toEqual([]);
    expect(layer.source_scheme_id).toBe("");
  });

  it("从 V2 派生六类实体，默认 ai_inferred", () => {
    const draft = sampleDraft();
    const layer = deriveFineModelFromV2(draft);

    expect(layer.source_scheme_id).toBe("scheme-fine");
    expect(layer.source_scheme_revision).toBe(3);
    expect(layer.projection_version).toBe(1);

    expect(layer.actors.map((a) => a.name).sort()).toEqual(["系统", "老板"]);
    expect(layer.actors.every((a) => a.source === "ai_inferred")).toBe(true);

    expect(layer.use_cases).toHaveLength(1);
    expect(layer.use_cases[0]?.goal_ids).toEqual(["G1"]);
    expect(layer.use_cases[0]?.source).toBe("ai_inferred");

    expect(layer.processes).toHaveLength(1);
    expect(layer.processes[0]?.flow_id).toBe("F1");
    expect(layer.processes[0]?.source).toBe("ai_inferred");

    expect(layer.rules).toHaveLength(1);
    expect(layer.rules[0]?.decision_id).toBe("D1");
    expect(layer.rules[0]?.source).toBe("ai_inferred");

    // 仅 user_visible 模块进 Screen
    expect(layer.screens).toHaveLength(1);
    expect(layer.screens[0]?.module_id).toBe("M1");
    expect(layer.screens[0]?.source).toBe("ai_inferred");

    expect(layer.acceptance).toHaveLength(1);
    expect(layer.acceptance[0]?.acceptance_id).toBe("AC1");
    expect(layer.acceptance[0]?.check).toBe("playtest");
    expect(layer.acceptance[0]?.source).toBe("ai_inferred");
  });

  it("派生不冒充 user_said，即使 SSOT 条目是 user_said", () => {
    const layer = deriveFineModelFromV2(sampleDraft());
    const allSources = [
      ...layer.actors,
      ...layer.use_cases,
      ...layer.processes,
      ...layer.rules,
      ...layer.screens,
      ...layer.acceptance,
    ].map((x) => x.source);
    expect(allSources.every((s) => s === "ai_inferred")).toBe(true);
    expect(sampleDraft().modules[0]?.source).toBe("user_said");
  });
});

describe("TASK-J.38a · applyFineModelToV2", () => {
  it("回写只改业务字段，不触碰 source/evidence", () => {
    const draft = sampleDraft();
    const layer = deriveFineModelFromV2(draft);
    const beforeEvidence = JSON.stringify(draft.modules[0]?.evidence);
    const beforeSource = draft.modules[0]?.source;

    const patched: FineModelLayer = {
      ...layer,
      screens: layer.screens.map((s) => ({
        ...s,
        name: "老板首页",
        purpose: "一眼逾期",
        // 试图覆写 —— 必须被忽略
        source: "user_said",
        evidence: [],
      })),
    };

    const result = applyFineModelToV2(draft, patched);
    const mod = result.draft.modules.find((m) => m.id === "M1");
    expect(mod?.name).toBe("老板首页");
    expect(mod?.purpose).toBe("一眼逾期");
    expect(mod?.source).toBe(beforeSource);
    expect(JSON.stringify(mod?.evidence)).toBe(beforeEvidence);
    expect(result.conflicts_resolved_by_ssot).toBeGreaterThan(0);
  });

  it("不一致以 SSOT 为准并抬 projection_version（stale revision）", () => {
    const draft = sampleDraft();
    const layer = deriveFineModelFromV2(draft);
    const stale: FineModelLayer = {
      ...layer,
      source_scheme_revision: draft.scheme_revision - 1,
      screens: layer.screens.map((s) => ({
        ...s,
        name: "应被丢弃的名字",
      })),
    };

    const result = applyFineModelToV2(draft, stale);
    expect(result.draft.modules.find((m) => m.id === "M1")?.name).toBe(
      "首页看板",
    );
    expect(result.layer.projection_version).toBeGreaterThan(
      layer.projection_version,
    );
    expect(result.conflicts_resolved_by_ssot).toBe(1);
  });

  it("禁双 SSOT：无持久化入口，加层不写入 draft 新集合", () => {
    expect(FINE_MODEL_PERSISTENCE).toBeNull();
    const draft = sampleDraft();
    const layer = deriveFineModelFromV2(draft);
    const result = applyFineModelToV2(draft, layer);

    expect(result.draft).not.toHaveProperty("fine_model");
    expect(result.draft).not.toHaveProperty("actors");
    expect(Object.keys(result.draft).sort()).toEqual(
      [
        "acceptance",
        "audience",
        "conflicts",
        "decisions",
        "entities",
        "flows",
        "frozen",
        "goals",
        "modules",
        "open_questions",
        "out_of_scope",
        "scheme_id",
        "scheme_revision",
        "size_hint",
        "summary",
        "title",
      ].sort(),
    );
  });
});
