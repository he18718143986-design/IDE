// @vitest-environment jsdom
/**
 * TASK-J.32b：对照面与信任档确认形态（jsdom 辅助，不替代正式试玩）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SchemeQuoteBacklinkBlock,
  reconfirmChecksComplete,
} from "../../src/components/studio/SchemeQuoteBacklinkBlock";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  evaluateSchemeConfirmation,
} from "../../src/lib/journey/scheme-draft";
import {
  formatBudgetPlain,
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import type {
  SchemeBacklinkPreviewView,
  SchemeTrustTier,
} from "../../src/lib/daemon-api";

const HASH_A = "a".repeat(64);

const previewOk: SchemeBacklinkPreviewView = {
  ok: true,
  covered_count: 1,
  uncovered_count: 2,
  quotes: [
    {
      turn_id: "T1",
      seq: 1,
      user_alias_seq: 1,
      text: "首页要有月度汇总",
      turn_text_sha256: HASH_A,
    },
  ],
  items: [
    {
      id: "goal-1",
      source: "user_said",
      covered: true,
      turn_id: "T1",
      user_alias_seq: 1,
      label: "首页要有月度汇总",
    },
    {
      id: "goal-2",
      source: "user_said",
      covered: false,
      reason: "unregistered",
      label: "还要导出报表",
    },
    {
      id: "mod-ai",
      source: "ai_inferred",
      covered: false,
      reason: "ai_inferred",
      label: "推荐加一个日历模块",
    },
  ],
};

const previewMismatch: SchemeBacklinkPreviewView = {
  ok: false,
  reason: "hash_mismatch",
  item_id: "goal-1",
  turn_id: "T1",
  message: "有一句原话和登记记录对不上，不能标已覆盖。没有改任何封存。",
};

function compliantScopePlan(revision = 2): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: revision,
    plan_digest: "",
    areas: [
      {
        id: "area-0",
        label: "进度汇总",
        why: "因为要做进度汇总",
        module_ids: ["mod-0"],
        kind: "change_existing",
        paths: ["src/pages/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [{ label: "密码与钥匙文件", paths: [".env*"] }],
    needs_approval: [],
    verification: {
      commands: [],
      plain: ["页面能打开"],
      manual_only: true,
    },
    budget: {
      limits: {
        max_file_modifications: 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 3,
        max_command_executions: 40,
        max_tool_calls: 200,
      },
      plain: formatBudgetPlain({
        max_file_modifications: 10,
        max_duration_seconds: 1800,
      }),
    },
    grade: { ok: true, rejected: [] },
  };
  const withDigest: ScopePlan = { ...plan, plan_digest: "" };
  withDigest.plan_digest = scopePlanDigest(withDigest);
  return withDigest;
}

function renderBlock(
  trustTier: SchemeTrustTier,
  preview: SchemeBacklinkPreviewView | null = previewOk,
  extra: {
    checkedIds?: ReadonlySet<string>;
    onToggleChecked?: (id: string) => void;
    onTrustTierChange?: (tier: SchemeTrustTier) => void;
    busy?: boolean;
  } = {},
) {
  const onTrustTierChange = extra.onTrustTierChange ?? vi.fn();
  return render(
    <SchemeQuoteBacklinkBlock
      trustTier={trustTier}
      onTrustTierChange={onTrustTierChange}
      preview={preview}
      busy={extra.busy}
      checkedIds={extra.checkedIds}
      onToggleChecked={extra.onToggleChecked}
    />,
  );
}

function renderPaneWithBacklink(
  trustTier: SchemeTrustTier,
  preview: SchemeBacklinkPreviewView | null,
  extra: {
    busy?: boolean;
    checkedIds?: ReadonlySet<string>;
    onConfirmScheme?: () => void;
    onTrustTierChange?: (tier: SchemeTrustTier) => void;
    onToggleChecked?: (id: string) => void;
  } = {},
) {
  const scheme = emptySchemeDraft({
    title: "工程项目进度管控台",
    summary: "按项目维度汇总进度。",
    modules: ["工程进度管控"],
    business_input_rounds: 1,
    scheme_revision: 2,
    acceptance: [
      {
        id: "ac-1",
        text: "页面能打开并看到进度数字",
        check: "playtest",
      },
    ],
  });
  const scopePlan = compliantScopePlan(2);
  const demo = EMPTY_DEMO_GATE;
  return render(
    <SchemeReviewPane
      scheme={scheme}
      demoGate={demo}
      confirmation={evaluateSchemeConfirmation(scheme, demo, scopePlan)}
      scopePlan={scopePlan}
      onConfirmScheme={extra.onConfirmScheme}
      quoteBacklink={{
        trustTier,
        onTrustTierChange: extra.onTrustTierChange ?? vi.fn(),
        preview,
        busy: extra.busy,
        checkedIds: extra.checkedIds,
        onToggleChecked: extra.onToggleChecked,
      }}
    />,
  );
}

beforeEach(() => {
  stubOfflineFetch(["/api/knowledge/modules"]);
});

describe("TASK-J.32b · 信任档确认形态（J32B-P2）", () => {
  it("标准档默认出示对照面，不出现逐项勾选", () => {
    renderBlock("standard");
    const root = screen.getByTestId("scheme-quote-backlink");
    expect(root).toHaveAttribute("data-trust-tier", "standard");
    expect(screen.getByTestId("scheme-quote-backlink-surface")).toBeTruthy();
    expect(
      screen.queryByTestId("scheme-quote-backlink-check-goal-1"),
    ).toBeNull();
    expect(screen.getByTestId("scheme-trust-tier-standard")).toHaveAttribute(
      "data-selected",
      "true",
    );
  });

  it("重确认档在对照之上提供逐项勾选", () => {
    renderBlock("reconfirm");
    expect(screen.getByTestId("scheme-quote-backlink-surface")).toBeTruthy();
    expect(
      screen.getByTestId("scheme-quote-backlink-check-goal-1"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("scheme-quote-backlink-check-goal-2"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("scheme-quote-backlink-check-mod-ai"),
    ).toBeTruthy();
  });

  it("轻确认档不把对照面或逐项勾选作为默认确认步骤，但仍可切换档位", () => {
    const onChange = vi.fn();
    renderBlock("light", previewOk, { onTrustTierChange: onChange });
    expect(screen.queryByTestId("scheme-quote-backlink-surface")).toBeNull();
    expect(
      screen.queryByTestId("scheme-quote-backlink-check-goal-1"),
    ).toBeNull();
    expect(screen.getByTestId("scheme-quote-backlink-light-hint")).toBeTruthy();
    fireEvent.click(screen.getByTestId("scheme-trust-tier-standard"));
    expect(onChange).toHaveBeenCalledWith("standard");
  });
});

describe("TASK-J.32b · 覆盖与缺口展示（J32B-P3）", () => {
  it("已覆盖项回链到已登记原话的 U<seq> 与原文", () => {
    renderBlock("standard");
    const covered = screen.getByTestId("scheme-quote-backlink-item-goal-1");
    expect(covered).toHaveAttribute("data-covered", "true");
    const quote = screen.getByTestId("scheme-quote-backlink-quote-goal-1");
    expect(quote.textContent).toContain("U1");
    expect(quote.textContent).toContain("首页要有月度汇总");
  });

  it("缺登记不得标已覆盖，缺口被明确标出", () => {
    renderBlock("standard");
    const gap = screen.getByTestId("scheme-quote-backlink-item-goal-2");
    expect(gap).toHaveAttribute("data-covered", "false");
    expect(
      screen.getByTestId("scheme-quote-backlink-gap-goal-2").textContent,
    ).toContain("未覆盖");
    expect(
      screen.getByTestId("scheme-quote-backlink-gap-goal-2").textContent,
    ).toContain("还没登记");
  });

  it("ai_inferred 不得冒充 user_said，也不得标已覆盖", () => {
    renderBlock("standard");
    const inferred = screen.getByTestId("scheme-quote-backlink-item-mod-ai");
    expect(inferred).toHaveAttribute("data-covered", "false");
    expect(inferred).toHaveAttribute("data-source", "ai_inferred");
    expect(
      screen.getByTestId("scheme-quote-backlink-gap-mod-ai").textContent,
    ).toContain("不是你亲口说的");
  });

  it("哈希不一致时不展示已覆盖项", () => {
    renderBlock("standard", previewMismatch);
    expect(
      screen.queryByTestId("scheme-quote-backlink-item-goal-1"),
    ).toBeNull();
    expect(
      screen.getByTestId("scheme-quote-backlink-error").textContent,
    ).toContain("对不上");
  });
});

describe("TASK-J.32b · 挂载在确认按钮前，并按档位约束确认", () => {
  it("对照面出现在确认按钮之前，且缺省不改无对照面时的确认可用性", () => {
    const scheme = emptySchemeDraft({
      title: "工程项目进度管控台",
      summary: "按项目维度汇总进度。",
      modules: ["工程进度管控"],
      business_input_rounds: 1,
      scheme_revision: 2,
      acceptance: [
        {
          id: "ac-1",
          text: "页面能打开并看到进度数字",
          check: "playtest",
        },
      ],
    });
    const scopePlan = compliantScopePlan(2);
    const demo = EMPTY_DEMO_GATE;
    const { container } = render(
      <SchemeReviewPane
        scheme={scheme}
        demoGate={demo}
        confirmation={evaluateSchemeConfirmation(scheme, demo, scopePlan)}
        scopePlan={scopePlan}
      />,
    );
    expect(screen.queryByTestId("scheme-quote-backlink")).toBeNull();
    expect(screen.getByTestId("scheme-confirm")).not.toBeDisabled();
    expect(
      container.querySelector("[data-testid='scheme-confirm']"),
    ).toBeTruthy();
  });

  it("标准档在对照面就绪后可确认；对照面在确认按钮之前", () => {
    renderPaneWithBacklink("standard", previewOk);
    const backlink = screen.getByTestId("scheme-quote-backlink");
    const confirm = screen.getByTestId("scheme-confirm");
    expect(
      backlink.compareDocumentPosition(confirm) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(confirm).not.toBeDisabled();
  });

  it("重确认档在未逐项勾选时禁用确认，勾完后才可点", () => {
    const checked = new Set<string>();
    const onToggle = vi.fn((id: string) => checked.add(id));
    const { rerender } = renderPaneWithBacklink("reconfirm", previewOk, {
      checkedIds: checked,
      onToggleChecked: onToggle,
    });
    expect(screen.getByTestId("scheme-confirm")).toBeDisabled();
    expect(reconfirmChecksComplete("reconfirm", previewOk, checked)).toBe(
      false,
    );

    fireEvent.click(screen.getByTestId("scheme-quote-backlink-check-goal-1"));
    fireEvent.click(screen.getByTestId("scheme-quote-backlink-check-goal-2"));
    fireEvent.click(screen.getByTestId("scheme-quote-backlink-check-mod-ai"));
    expect(onToggle).toHaveBeenCalledTimes(3);

    const allChecked = new Set(["goal-1", "goal-2", "mod-ai"]);
    const scheme = emptySchemeDraft({
      title: "工程项目进度管控台",
      summary: "按项目维度汇总进度。",
      modules: ["工程进度管控"],
      business_input_rounds: 1,
      scheme_revision: 2,
      acceptance: [
        {
          id: "ac-1",
          text: "页面能打开并看到进度数字",
          check: "playtest",
        },
      ],
    });
    const scopePlan = compliantScopePlan(2);
    const demo = EMPTY_DEMO_GATE;
    rerender(
      <SchemeReviewPane
        scheme={scheme}
        demoGate={demo}
        confirmation={evaluateSchemeConfirmation(scheme, demo, scopePlan)}
        scopePlan={scopePlan}
        quoteBacklink={{
          trustTier: "reconfirm",
          onTrustTierChange: vi.fn(),
          preview: previewOk,
          checkedIds: allChecked,
        }}
      />,
    );
    expect(reconfirmChecksComplete("reconfirm", previewOk, allChecked)).toBe(
      true,
    );
    expect(screen.getByTestId("scheme-confirm")).not.toBeDisabled();
  });

  it("轻确认不拦截确认按钮；哈希不一致时各档都不可确认", () => {
    renderPaneWithBacklink("light", previewOk);
    expect(screen.getByTestId("scheme-confirm")).not.toBeDisabled();
    expect(screen.queryByTestId("scheme-quote-backlink-surface")).toBeNull();
  });

  it("哈希不一致时确认按钮不可用", () => {
    renderPaneWithBacklink("standard", previewMismatch);
    expect(screen.getByTestId("scheme-confirm")).toBeDisabled();
    expect(screen.getByTestId("scheme-quote-backlink-error")).toBeTruthy();
  });
});
