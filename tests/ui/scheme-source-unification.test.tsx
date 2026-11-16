/**
 * TASK-J.22a：中栏来源统一为编译器台账 + 无台账降级标注。
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import { render, screen } from "@testing-library/react";
import { SchemeReviewPane } from "@/components/studio/SchemeReviewPane";
import {
  NO_SCHEME_YET_LABEL,
  schemeDraftFromMidpane,
  type SchemeMidpaneView,
  type SchemeDraft,
} from "@/lib/journey/scheme-draft";
import * as schemeDraftMod from "@/lib/journey/scheme-draft";

beforeEach(() => {
  // SchemeReviewPane 挂载 SystemMapPane，会请求 knowledge/modules
  stubOfflineFetch(["/api/knowledge/modules"]);
});

function midpane(over: Partial<SchemeMidpaneView> = {}): SchemeMidpaneView {
  return {
    available: true,
    scheme_id: "scheme-u",
    scheme_revision: 3,
    frozen: false,
    title: "逾期看板",
    summary: "老板看逾期",
    goals: [{ id: "G1", text: "看清逾期" }],
    modules: [{ id: "M1", name: "首页看板" }],
    decisions: [],
    conflicts: [],
    acceptance: [{ id: "AC-1", text: "首页显示逾期数" }],
    ...over,
  };
}

describe("TASK-J.22a · 来源统一与无台账降级", () => {
  it("J22A-P2：无台账时标注「方案尚未生成」，不渲染启发式条目", () => {
    render(<SchemeReviewPane scheme={null} ledgerAbsent />);
    expect(screen.getByTestId("scheme-no-ledger")).toHaveTextContent(
      NO_SCHEME_YET_LABEL,
    );
    expect(screen.queryByTestId("scheme-title")).toBeNull();
    expect(screen.queryByTestId("scheme-modules")).toBeNull();
  });

  it("J22A-P1：中栏内容来自台账投影（标题、目标、验收），mermaid 留空", () => {
    const draft = schemeDraftFromMidpane(midpane(), null);
    expect(draft).not.toBeNull();
    expect(draft!.title).toBe("逾期看板");
    expect(draft!.goals).toEqual([{ id: "G1", text: "看清逾期" }]);
    expect(draft!.modules).toEqual(["首页看板"]);
    expect(draft!.acceptance).toEqual([
      { id: "AC-1", text: "首页显示逾期数", check: "playtest" },
    ]);
    expect(draft!.mermaidArchitecture).toBe("");
    expect(draft!.mermaidFlow).toBe("");
    expect(draft!.mermaidMindmap).toBe("");

    render(<SchemeReviewPane scheme={draft} ledgerAbsent={false} />);
    expect(screen.getByTestId("scheme-title")).toHaveTextContent("逾期看板");
    expect(screen.getByTestId("scheme-goals")).toHaveTextContent("看清逾期");
    expect(screen.getByTestId("scheme-modules")).toHaveTextContent("首页看板");
  });

  it("rebuildSchemeFromCorpus 不得作为默认映射入口（本卡映射走 schemeDraftFromMidpane）", () => {
    const spy = vi.spyOn(schemeDraftMod, "rebuildSchemeFromCorpus");
    const draft = schemeDraftFromMidpane(midpane(), null);
    expect(draft).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("available=false 时映射为 null", () => {
    const draft = schemeDraftFromMidpane(
      midpane({ available: false, title: "", goals: [], modules: [], acceptance: [] }),
      null,
    );
    expect(draft).toBeNull();
  });

  it("已冻结 previous 不被投影覆盖", () => {
    const frozen: SchemeDraft = {
      ...(schemeDraftFromMidpane(midpane(), null) as SchemeDraft),
      frozen: true,
      title: "已冻结标题",
    };
    const next = schemeDraftFromMidpane(
      midpane({ title: "新台账标题", scheme_revision: 9 }),
      frozen,
    );
    expect(next?.title).toBe("已冻结标题");
    expect(next?.frozen).toBe(true);
  });
});
