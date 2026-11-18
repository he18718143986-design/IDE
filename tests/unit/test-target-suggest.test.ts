/**
 * TASK-J.38e：测试目标建议层（缺省空 / ai_inferred / 不进门禁）。
 */
// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import { emptySchemeDraftV2 } from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { deriveFineModelFromV2 } from "../../src/lib/journey/fine-model-derive";
import type {
  FineModelLayer,
  SchemeItemMeta,
} from "../../src/lib/journey/scheme-patch-types";
import {
  assertSuggestionDoesNotTouchGates,
  suggestTestTargets,
} from "../../src/lib/journey/test-target-suggest";
import { ScopeAcceptanceBlock } from "../../src/components/studio/ScopeAcceptanceBlock";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import { emptySchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";

function meta(id: string): SchemeItemMeta {
  return {
    id,
    source: "user_said",
    evidence: [],
    user_pinned: false,
    updated_in_revision: 1,
  };
}

function emptyPlan(): ScopePlan {
  return {
    scheme_revision: 0,
    plan_digest: "digest-test",
    areas: [],
    never_touch: [],
    needs_approval: [],
    verification: { commands: [], plain: [], manual_only: true },
    budget: {
      limits: {} as ScopePlan["budget"]["limits"],
      plain: "小",
    },
    grade: { ok: true, rejected: [] },
  } as ScopePlan;
}

describe("TASK-J.38e · suggestTestTargets", () => {
  it("无草案 / 空 acceptance / enabled=false → 缺省不生成", () => {
    expect(suggestTestTargets({})).toEqual([]);
    expect(suggestTestTargets({ draft: null })).toEqual([]);
    expect(
      suggestTestTargets({ draft: emptySchemeDraftV2({ acceptance: [] }) }),
    ).toEqual([]);
    expect(
      suggestTestTargets({
        draft: emptySchemeDraftV2({
          acceptance: [{ ...meta("AC-1"), text: "能打开项目" }],
        }),
        enabled: false,
      }),
    ).toEqual([]);
  });

  it("有 SSOT 验收线索 → 建议一律 ai_inferred，derived_from 记条目 id", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s1",
      scheme_revision: 2,
      acceptance: [
        { ...meta("AC-1"), text: "能打开项目", check: "playtest" },
        { ...meta("AC-2"), text: "  ", check: "auto" },
        { ...meta("AC-3"), text: "版本号可读", check: "auto" },
      ],
    });
    const suggestions = suggestTestTargets({ draft });
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((s) => s.source === "ai_inferred")).toBe(true);
    expect(suggestions[0]).toMatchObject({
      suggestion_id: "tts:AC-1",
      derived_from: ["AC-1"],
      source: "ai_inferred",
    });
    expect(suggestions[0]?.text).toMatch(/建议验证：能打开项目/);
    expect(suggestions[0]?.text).toMatch(/试玩确认/);
    expect(suggestions[1]?.derived_from).toEqual(["AC-3"]);
    assertSuggestionDoesNotTouchGates(suggestions);
    for (const s of suggestions) {
      expect(s).not.toHaveProperty("can_merge");
      expect(s).not.toHaveProperty("evidence");
      expect(s).not.toHaveProperty("verdict");
    }
  });

  it("SSOT 优先：不对齐 FineModelLayer 忽略；对齐时仍用 SSOT 文案", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s-ok",
      scheme_revision: 1,
      acceptance: [{ ...meta("AC-1"), text: "SSOT验收" }],
    });
    const misaligned: FineModelLayer = {
      ...deriveFineModelFromV2(draft),
      source_scheme_id: "other",
      source_scheme_revision: 9,
      acceptance: [
        {
          ...meta("fine-ac:AC-1"),
          text: "加层伪造",
          acceptance_id: "AC-1",
        },
      ],
    };
    const ignored = suggestTestTargets({ draft, fineLayer: misaligned });
    expect(ignored[0]?.text).toMatch(/SSOT验收/);
    expect(ignored[0]?.text).not.toMatch(/加层伪造/);

    const aligned = deriveFineModelFromV2(draft);
    aligned.acceptance = [
      {
        ...meta("fine-ac:AC-1"),
        text: "加层不同文案",
        acceptance_id: "AC-1",
      },
    ];
    const ssotWins = suggestTestTargets({ draft, fineLayer: aligned });
    expect(ssotWins[0]?.text).toMatch(/SSOT验收/);
    expect(ssotWins[0]?.text).not.toMatch(/加层不同文案/);
    expect(ssotWins[0]?.source).toBe("ai_inferred");
  });

  it("不写回 draft.acceptance；不调用 can_merge 字段", () => {
    const draft = emptySchemeDraftV2({
      acceptance: [{ ...meta("AC-9"), text: "保持原样" }],
    });
    const before = structuredClone(draft.acceptance);
    const suggestions = suggestTestTargets({ draft });
    expect(draft.acceptance).toEqual(before);
    expect(JSON.stringify(suggestions)).not.toMatch(/can_merge/);
    assertSuggestionDoesNotTouchGates(suggestions);
  });
});

describe("TASK-J.38e · 可选 UI 接线", () => {
  beforeEach(() => {
    stubOfflineFetch(["/api/knowledge/modules"]);
  });

  it("ScopeAcceptanceBlock 可折叠展示 AI 建议·非验收，空建议不渲染块", () => {
    const suggestions = suggestTestTargets({
      draft: emptySchemeDraftV2({
        acceptance: [{ ...meta("AC-1"), text: "打开项目" }],
      }),
    });
    const { rerender } = render(
      createElement(ScopeAcceptanceBlock, {
        plan: emptyPlan(),
        mode: "pre_start",
      }),
    );
    expect(
      screen.queryByTestId("scope-acceptance-test-target-suggest"),
    ).toBeNull();

    rerender(
      createElement(ScopeAcceptanceBlock, {
        plan: emptyPlan(),
        mode: "pre_start",
        testTargetSuggestions: suggestions,
      }),
    );
    expect(
      screen.getByTestId("scope-acceptance-test-target-suggest"),
    ).toHaveAttribute("data-suggest-count", "1");
    expect(
      screen.queryByTestId("scope-acceptance-test-target-suggest-list"),
    ).toBeNull();
    fireEvent.click(
      screen.getByTestId("scope-acceptance-test-target-suggest-toggle"),
    );
    expect(
      screen.getByTestId("scope-acceptance-test-target-suggest-list"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("scope-acceptance-test-target-suggest-row"),
    ).toHaveAttribute("data-source", "ai_inferred");
    expect(screen.getAllByText(/AI 建议·非验收/).length).toBeGreaterThan(0);
  });

  it("SchemeReviewPane 透传 testTargetSuggestions", () => {
    const suggestions = suggestTestTargets({
      draft: emptySchemeDraftV2({
        acceptance: [{ ...meta("AC-2"), text: "可读版本" }],
      }),
    });
    render(
      createElement(SchemeReviewPane, {
        scheme: emptySchemeDraft({
          title: "演示",
          summary: "演示摘要足够长以便渲染审阅区",
          acceptance: [{ id: "AC-2", text: "可读版本", check: "auto" }],
        }),
        testTargetSuggestions: suggestions,
      }),
    );
    expect(
      screen.getByTestId("scope-acceptance-test-target-suggest"),
    ).toBeInTheDocument();
  });
});
