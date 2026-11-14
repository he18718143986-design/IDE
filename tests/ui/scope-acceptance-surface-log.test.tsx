// @vitest-environment jsdom
/**
 * TASK-J.16 / GAP-P8（J16-P1 接线部分）：§15.4 区块只上报「确已展示」的条目。
 * - 渲染提交之后才上报（上报时 DOM 已含对应条目，不是渲染前预写）；
 * - 上报失败不阻塞渲染，只留痕（console.warn + data-surface-log="failed"）；
 * - 同一确认 ID 与同一展示集合不重复上报。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  ScopeAcceptanceBlock,
  SCOPE_ACCEPTANCE_PLAIN_TEXT_VERSION,
  NO_ACCEPTANCE_SURFACE_RECORD_LABEL,
  scopeAcceptanceShownItems,
} from "../../src/components/studio/ScopeAcceptanceBlock";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";
import type { SurfacePresentationReport } from "../../src/lib/daemon-api";
import {
  SCHEME_DECISIONS_PLAIN_TEXT_VERSION,
  SchemeReviewPane,
  schemeDecisionShownItems,
} from "../../src/components/studio/SchemeReviewPane";
import {
  freezeScheme,
  rebuildSchemeFromCorpus,
} from "../../src/lib/journey/scheme-draft";

function makePlan(partial: Partial<ScopePlan> = {}): ScopePlan {
  return {
    scheme_revision: 1,
    plan_digest: "digest-1",
    areas: [
      {
        id: "area-0",
        label: "首页看板",
        why: "显示逾期数",
        module_ids: [],
        kind: "change_existing",
        paths: ["src/home.tsx"],
        excluded_by_user: false,
      },
      {
        id: "area-1",
        label: "报表页",
        why: "新页面",
        module_ids: [],
        kind: "create_new",
        paths: ["src/report.tsx"],
        excluded_by_user: true,
      },
    ],
    never_touch: [],
    needs_approval: [
      {
        id: "prot-0",
        label: "加一个图表依赖",
        why: "报表要画图",
        paths: ["package.json"],
        approved: null,
      },
    ],
    verification: {
      commands: [],
      plain: ["首页能看到数字"],
      manual_only: false,
    },
    budget: {
      limits: {} as ScopePlan["budget"]["limits"],
      plain: "约 3 个文件",
    },
    grade: { ok: true, rejected: [] },
    ...partial,
  } as unknown as ScopePlan;
}

describe("TASK-J.16 · 区块呈现上报（surface_log 接线）", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stubOfflineFetch();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("只读态按展示的区域上报，排除掉的区域不计入", () => {
    expect(scopeAcceptanceShownItems(makePlan(), "frozen")).toEqual([
      { item_ref: "area-0", section: "area" },
    ]);
  });

  it("开工前上报敏感项（标签在按钮中已可见），不上报区域（只展示计数）", () => {
    expect(scopeAcceptanceShownItems(makePlan(), "pre_start")).toEqual([
      { item_ref: "prot-0", section: "approval" },
    ]);
  });

  it("没有 surface 参数时不上报，区块照常渲染", () => {
    render(<ScopeAcceptanceBlock plan={makePlan()} mode="pre_start" />);
    expect(screen.getByTestId("scope-acceptance-block")).toHaveAttribute(
      "data-surface-log",
      "idle",
    );
  });

  it("展示后上报：调用时 DOM 已含该条目，且报文带确认 ID 与版本号", async () => {
    const onReport = vi.fn((_r: SurfacePresentationReport) => {
      // 上报发生时，敏感项按钮已经在 DOM 中
      expect(
        document.querySelector(
          '[data-testid="scope-acceptance-sensitive-toggle"]',
        ),
      ).not.toBeNull();
      return Promise.resolve({
        written: 1,
        confirmation_id: "scheme-confirm-abc",
      });
    });
    render(
      <ScopeAcceptanceBlock
        plan={makePlan()}
        mode="pre_start"
        surface={{ confirmationId: "scheme-confirm-abc", onReport }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("scope-acceptance-block")).toHaveAttribute(
        "data-surface-log",
        "reported",
      ),
    );
    expect(onReport).toHaveBeenCalledTimes(1);
    const payload = onReport.mock.calls[0]![0];
    expect(payload.confirmation_id).toBe("scheme-confirm-abc");
    expect(payload.plain_text_version).toBe(
      SCOPE_ACCEPTANCE_PLAIN_TEXT_VERSION,
    );
    expect(payload.shown).toEqual([
      { item_ref: "prot-0", section: "approval" },
    ]);
    expect(Number.isNaN(Date.parse(payload.presented_at))).toBe(false);
    // P-201：开工前的展示记为确认前
    expect(payload.phase).toBe("pre_confirm");
  });

  it("上报失败：页面照常显示，记 console.warn 并标记 failed", async () => {
    const onReport = vi.fn(() => Promise.reject(new Error("daemon down")));
    render(
      <ScopeAcceptanceBlock
        plan={makePlan({ needs_approval: [] })}
        mode="frozen"
        surface={{ confirmationId: "scheme-confirm-x", onReport }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("scope-acceptance-block")).toHaveAttribute(
        "data-surface-log",
        "failed",
      ),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[surface-log]"),
      expect.any(Error),
    );
    expect(
      screen.getByTestId("scope-acceptance-full-list"),
    ).toBeInTheDocument();
  });

  it("没有可展示条目时不上报", () => {
    const onReport = vi.fn(() => Promise.resolve({}));
    render(
      <ScopeAcceptanceBlock
        plan={makePlan({ needs_approval: [] })}
        mode="pre_start"
        surface={{ confirmationId: "scheme-confirm-y", onReport }}
      />,
    );
    expect(onReport).not.toHaveBeenCalled();
  });

  it("同一确认 ID 与同一展示集合重渲染时不重复上报", async () => {
    const onReport = vi.fn(() => Promise.resolve({}));
    const plan = makePlan();
    const { rerender } = render(
      <ScopeAcceptanceBlock
        plan={plan}
        mode="pre_start"
        surface={{ confirmationId: "scheme-confirm-z", onReport }}
      />,
    );
    await act(async () => {
      rerender(
        <ScopeAcceptanceBlock
          plan={plan}
          mode="pre_start"
          surface={{
            confirmationId: "scheme-confirm-z",
            onReport: (r) => onReport(r),
          }}
        />,
      );
    });
    expect(onReport).toHaveBeenCalledTimes(1);
  });
});

describe("TASK-J.16 J16-P7 · 台账验收条目渲染与 acceptance 段上报", () => {
  it("渲染台账条目原文，并在展示后按 acceptance 段上报台账 id", async () => {
    const onReport = vi.fn(() =>
      Promise.resolve({ written: 2, confirmation_id: "c-acc" }),
    );
    render(
      <ScopeAcceptanceBlock
        plan={makePlan()}
        mode="frozen"
        acceptanceItems={[
          { id: "ITEM-1", text: "首页显示逾期数" },
          { id: "ITEM-2", text: "报表可导出 CSV" },
        ]}
        surface={{ confirmationId: "c-acc", onReport }}
      />,
    );
    expect(screen.getByTestId("scope-acceptance-criteria")).toBeTruthy();
    expect(
      screen.queryByTestId("scope-acceptance-no-surface-record"),
    ).toBeNull();
    const rows = screen.getAllByTestId("scope-acceptance-criterion-row");
    expect(rows.map((r) => r.getAttribute("data-item-ref"))).toEqual([
      "ITEM-1",
      "ITEM-2",
    ]);
    expect(rows[0]?.textContent).toBe("首页显示逾期数");
    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(1));
    const payload = onReport.mock.calls[0]?.[0] as SurfacePresentationReport;
    expect(payload.shown.filter((s) => s.section === "acceptance")).toEqual([
      { item_ref: "ITEM-1", section: "acceptance" },
      { item_ref: "ITEM-2", section: "acceptance" },
    ]);
    // P-201：冻结后的只读展示记为确认后，不冒充确认当时
    expect(payload.phase).toBe("post_confirm");
  });

  it("没有台账条目时不渲染验收条目区块，也不上报 acceptance 段", () => {
    render(
      <ScopeAcceptanceBlock
        plan={makePlan()}
        mode="frozen"
        acceptanceItems={[]}
      />,
    );
    expect(screen.queryByTestId("scope-acceptance-criteria")).toBeNull();
    expect(
      scopeAcceptanceShownItems(makePlan(), "frozen", []).some(
        (s) => s.section === "acceptance",
      ),
    ).toBe(false);
  });

  it("取数完成前或尚无方案时，即使条目为空也不提前标「无呈现记录」", () => {
    const { rerender } = render(
      <ScopeAcceptanceBlock
        plan={makePlan()}
        mode="frozen"
        acceptanceItems={[]}
      />,
    );
    expect(
      screen.queryByTestId("scope-acceptance-no-surface-record"),
    ).toBeNull();
    rerender(
      <ScopeAcceptanceBlock
        plan={makePlan()}
        mode="frozen"
        acceptanceItems={[]}
        acceptanceSettled={false}
      />,
    );
    expect(
      screen.queryByTestId("scope-acceptance-no-surface-record"),
    ).toBeNull();
    expect(screen.queryByTestId("scope-acceptance-criteria")).toBeNull();
  });

  it("取数完成或失败且条目为空时标「无呈现记录」，不渲染假条目，也不上报 acceptance 段", async () => {
    const onReport = vi.fn(() => Promise.resolve({}));
    render(
      <ScopeAcceptanceBlock
        plan={makePlan()}
        mode="frozen"
        acceptanceItems={[]}
        acceptanceSettled
        surface={{ confirmationId: "c-empty", onReport }}
      />,
    );
    expect(
      screen.getByTestId("scope-acceptance-no-surface-record").textContent,
    ).toBe(NO_ACCEPTANCE_SURFACE_RECORD_LABEL);
    expect(NO_ACCEPTANCE_SURFACE_RECORD_LABEL).toBe("无呈现记录");
    expect(screen.queryByTestId("scope-acceptance-criteria")).toBeNull();
    expect(screen.queryByTestId("scope-acceptance-criterion-row")).toBeNull();
    expect(
      scopeAcceptanceShownItems(makePlan(), "frozen", []).some(
        (s) => s.section === "acceptance",
      ),
    ).toBe(false);
    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(1));
    const payload = onReport.mock.calls[0]?.[0] as SurfacePresentationReport;
    expect(payload.shown.filter((s) => s.section === "acceptance")).toEqual([]);
  });

  it("取数已完成且有条目时不标「无呈现记录」", () => {
    render(
      <ScopeAcceptanceBlock
        plan={makePlan()}
        mode="frozen"
        acceptanceItems={[{ id: "ITEM-1", text: "首页显示逾期数" }]}
        acceptanceSettled
      />,
    );
    expect(
      screen
        .getByTestId("scope-acceptance-criterion-row")
        .getAttribute("data-item-ref"),
    ).toBe("ITEM-1");
    expect(
      screen.queryByTestId("scope-acceptance-no-surface-record"),
    ).toBeNull();
  });

  it("SchemeReviewPane 把 acceptanceSettled 传给中栏区块：空条目仅在取数完成后标「无呈现记录」", () => {
    stubOfflineFetch(["/api/knowledge/modules"]);
    const scheme = rebuildSchemeFromCorpus(
      null,
      "做一个工程进度管控台，按项目汇总进度与预算，超期要预警。只做进度，财务下一期",
    );
    const { rerender } = render(
      <SchemeReviewPane
        scheme={scheme}
        acceptanceItems={[]}
        acceptanceSettled={false}
      />,
    );
    expect(
      screen.queryByTestId("scope-acceptance-no-surface-record"),
    ).toBeNull();
    rerender(
      <SchemeReviewPane
        scheme={scheme}
        acceptanceItems={[]}
        acceptanceSettled
      />,
    );
    expect(
      screen.getByTestId("scope-acceptance-no-surface-record").textContent,
    ).toBe("无呈现记录");
    expect(screen.queryByTestId("scope-acceptance-criteria")).toBeNull();
  });
});

describe("P-201 · 方案审阅：确认前上报实际展示的决议区条目", () => {
  const scheme = rebuildSchemeFromCorpus(
    null,
    "做一个工程进度管控台，按项目汇总进度与预算，超期要预警。只做进度，财务下一期",
  );

  beforeEach(() => {
    stubOfflineFetch(["/api/knowledge/modules"]);
  });

  it("确认前上报实际展示的决议区条目：section=decision，phase=pre_confirm", async () => {
    const expected = [
      ...scheme.conflicts.map((c) => ({ item_ref: c.id, section: "decision" })),
      ...scheme.decisions.map((d) => ({ item_ref: d.id, section: "decision" })),
    ];
    expect(expected.length).toBeGreaterThan(0);
    expect(schemeDecisionShownItems(scheme)).toEqual(expected);

    const onReport = vi.fn((_r: SurfacePresentationReport) => {
      // 上报发生时，决议区条目已经在 DOM 中
      expect(
        document.querySelectorAll('[data-testid="scheme-decision-item"]')
          .length,
      ).toBe(scheme.decisions.length);
      return Promise.resolve({
        written: expected.length,
        confirmation_id: "c-dec",
      });
    });
    render(
      <SchemeReviewPane
        scheme={scheme}
        surfaceConfirmationId="c-dec"
        onSurfacePresented={onReport}
      />,
    );
    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(1));
    const payload = onReport.mock.calls[0]![0];
    expect(payload.confirmation_id).toBe("c-dec");
    expect(payload.phase).toBe("pre_confirm");
    expect(payload.plain_text_version).toBe(
      SCHEME_DECISIONS_PLAIN_TEXT_VERSION,
    );
    expect(payload.shown).toEqual(expected);
  });

  it("冻结后的方案不再按确认前上报决议区", () => {
    const onReport = vi.fn(() => Promise.resolve({}));
    const frozen = freezeScheme(scheme);
    expect(schemeDecisionShownItems(frozen)).toEqual([]);
    render(
      <SchemeReviewPane
        scheme={frozen}
        surfaceConfirmationId="c-dec-frozen"
        onSurfacePresented={onReport}
      />,
    );
    expect(onReport).not.toHaveBeenCalled();
  });
});
