// @vitest-environment jsdom
/**
 * TASK-J.6 / SSOT S2-08：中栏《改动范围与验收方式》区块。
 * ADR-0014：开工前仅三行白话 + 敏感「不碰这些」；无路径树/区域按钮/逐项授权。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  authorizePendingSensitiveDecisions,
  declineSensitiveDecisions,
  ScopeAcceptanceBlock,
} from "../../src/components/studio/ScopeAcceptanceBlock";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import {
  EMPTY_DEMO_GATE,
  evaluateSchemeConfirmation,
  rebuildSchemeFromCorpus,
  resolveSchemeConflict,
  confirmSchemeDecision,
} from "../../src/lib/journey/scheme-draft";
import {
  applyScopeDecisions,
  formatBudgetPlain,
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";

function makePlan(partial: Partial<ScopePlan> = {}): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: 1,
    plan_digest: "",
    areas: [
      {
        id: "area-0",
        label: "首页看板",
        why: "要显示逾期项目数",
        module_ids: ["mod-0"],
        kind: "change_existing",
        paths: ["src/pages/**"],
        excluded_by_user: false,
      },
      {
        id: "area-1",
        label: "月度报表页",
        why: "新建报表",
        module_ids: ["mod-1"],
        kind: "create_new",
        paths: ["src/pages/report/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [
      { label: "密码与钥匙文件", paths: [".env*"] },
      { label: "账号与支付相关", paths: ["**/payment/**"] },
    ],
    needs_approval: [],
    verification: {
      commands: [],
      plain: ["首页能看到逾期数", "报表能按月切换"],
      manual_only: false,
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
    ...partial,
  };
  // merge nested carefully when partial overrides verification/budget
  if (partial.verification) {
    plan.verification = {
      commands: [],
      plain: [],
      manual_only: false,
      ...partial.verification,
    };
  }
  if (partial.budget) {
    plan.budget = {
      limits: plan.budget.limits,
      plain: plan.budget.plain,
      ...partial.budget,
    };
  }
  if (partial.areas) plan.areas = partial.areas;
  if (partial.never_touch) plan.never_touch = partial.never_touch;
  if (partial.needs_approval) plan.needs_approval = partial.needs_approval;
  const withDigest: ScopePlan = { ...plan, plan_digest: "" };
  withDigest.plan_digest = scopePlanDigest(withDigest);
  return withDigest;
}

function assertNoTechJargon(root: HTMLElement): void {
  const text = root.textContent ?? "";
  expect(text.toLowerCase()).not.toMatch(/token/);
  expect(text.toLowerCase()).not.toMatch(/tool/);
  expect(text).not.toContain("**");
  expect(text.toLowerCase()).not.toMatch(/glob/);
}

describe("TASK-J.6 ScopeAcceptanceBlock（S2-08）", () => {
  it("开工前渲染三行白话概览；不含路径树与区域级按钮", () => {
    const plan = makePlan();
    render(<ScopeAcceptanceBlock plan={plan} mode="pre_start" />);
    const block = screen.getByTestId("scope-acceptance-block");
    expect(block).toHaveAttribute("data-mode", "pre_start");
    expect(screen.getByTestId("scope-acceptance-overview").textContent).toMatch(
      /这次大概改 2 处、不碰 2 处/,
    );
    expect(
      screen.getByTestId("scope-acceptance-verification").textContent,
    ).toMatch(/怎么算做完/);
    expect(screen.getByTestId("scope-acceptance-budget").textContent).toMatch(
      /预计多大/,
    );
    expect(screen.queryByTestId("scope-acceptance-full-list")).toBeNull();
    expect(screen.queryByRole("button", { name: /不要改这里/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^可以$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^不行$/ })).toBeNull();
    expect(block.textContent).not.toMatch(/src\/pages/);
    assertNoTechJargon(block);
  });

  it("文案不含 token / tool / ** / glob", () => {
    const plan = makePlan({
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "报表要画图",
          paths: ["package.json"],
          approved: null,
        },
      ],
    });
    render(
      <ScopeAcceptanceBlock
        plan={plan}
        mode="pre_start"
        approvalRequired
      />,
    );
    assertNoTechJargon(screen.getByTestId("scope-acceptance-block"));
  });

  it("点「不碰这些，其余照做」→ 以 excluded_area_ids 触发回调", () => {
    const plan = makePlan({
      areas: [
        {
          id: "area-0",
          label: "首页看板",
          why: "要显示逾期项目数",
          module_ids: ["mod-0"],
          kind: "change_existing",
          paths: ["package.json"],
          excluded_by_user: false,
        },
      ],
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "报表要画图",
          paths: ["package.json"],
          approved: null,
        },
      ],
    });
    const onDecline = vi.fn();
    render(
      <ScopeAcceptanceBlock
        plan={plan}
        mode="pre_start"
        onDeclineSensitive={onDecline}
      />,
    );
    expect(
      screen.getByTestId("scope-acceptance-sensitive").textContent,
    ).toMatch(/含 1 处敏感改动/);
    fireEvent.click(screen.getByTestId("scope-acceptance-decline-sensitive"));
    expect(onDecline).toHaveBeenCalledTimes(1);

    const decisions = declineSensitiveDecisions(plan);
    expect(decisions.excluded_area_ids).toEqual(["area-0"]);
    expect(decisions.approvals["prot-0"]).toBe(false);
    const next = applyScopeDecisions(plan, decisions);
    expect(next.needs_approval[0]!.approved).toBe(false);
    expect(
      next.never_touch.some((g) => g.paths.includes("package.json")),
    ).toBe(true);
  });

  it("开工点击路径：一键授权敏感项并产生新 plan_digest", () => {
    const plan = makePlan({
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "报表要画图",
          paths: ["package.json"],
          approved: null,
        },
      ],
    });
    const authorized = applyScopeDecisions(
      plan,
      authorizePendingSensitiveDecisions(plan),
    );
    expect(authorized.needs_approval[0]!.approved).toBe(true);
    expect(authorized.plan_digest).not.toBe(plan.plan_digest);
    expect(authorized.plan_digest.length).toBeGreaterThan(10);
  });

  it("manual_only 夹具显示「没有自动检查」提示", () => {
    const plan = makePlan({
      verification: {
        commands: [],
        plain: [],
        manual_only: true,
      },
    });
    render(<ScopeAcceptanceBlock plan={plan} mode="pre_start" />);
    expect(
      screen.getByTestId("scope-acceptance-manual-only").textContent,
    ).toMatch(/没有自动检查/);
  });

  it("冻结态与验收幕下清单完整且只读", () => {
    const plan = makePlan({
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "报表要画图",
          paths: ["package.json"],
          approved: true,
        },
      ],
    });
    const { rerender } = render(
      <ScopeAcceptanceBlock plan={plan} mode="frozen" frozen />,
    );
    const frozenBlock = screen.getByTestId("scope-acceptance-block");
    expect(frozenBlock).toHaveAttribute("data-readonly", "true");
    expect(screen.getByTestId("scope-acceptance-full-list")).toBeInTheDocument();
    expect(screen.getAllByTestId("scope-acceptance-area-row").length).toBe(2);
    expect(screen.getAllByTestId("scope-acceptance-never-touch").length).toBe(
      2,
    );
    expect(
      screen.queryByTestId("scope-acceptance-decline-sensitive"),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /不要改这里/ })).toBeNull();

    rerender(
      <ScopeAcceptanceBlock plan={plan} mode="acceptance" />,
    );
    const acceptance = screen.getByTestId("scope-acceptance-block");
    expect(acceptance).toHaveAttribute("data-mode", "acceptance");
    expect(acceptance).toHaveAttribute("data-readonly", "true");
    expect(screen.getByTestId("scope-acceptance-full-list")).toBeInTheDocument();
    expect(
      screen.queryByTestId("scope-acceptance-decline-sensitive"),
    ).toBeNull();
    assertNoTechJargon(acceptance);
  });

  it("E_SCOPE_POLICY 时顶部显示白话说明", () => {
    const plan = makePlan({
      grade: {
        ok: false,
        rejected: [{ path: "src/**", kind: "bare_top_glob" }],
      },
    });
    render(
      <ScopeAcceptanceBlock
        plan={plan}
        mode="pre_start"
        policyMessage="『整个 src 目录』范围太大，我没法替你担保不误伤。请告诉我具体要改哪块，或把这部分拆成单独一轮。"
      />,
    );
    expect(screen.getByTestId("scope-acceptance-policy").textContent).toMatch(
      /范围太大/,
    );
  });

  it("接入 SchemeReviewPane：决议区后可见区块；确认钮在敏感未表态时可点", () => {
    let scheme = rebuildSchemeFromCorpus(
      null,
      "工程进度管控，财务数据匹配，进度预警，财务预算预警，月度报表。先跑通也要界面一次到位。",
    );
    for (const c of scheme.conflicts) {
      scheme = resolveSchemeConflict(scheme, c.id, c.options[0]!.id);
    }
    for (const d of scheme.decisions) {
      scheme = confirmSchemeDecision(scheme, d.id);
    }
    const plan = makePlan({
      scheme_revision: scheme.scheme_revision,
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "报表要画图",
          paths: ["package.json"],
          approved: null,
        },
      ],
    });
    const onConfirm = vi.fn();
    const onDecline = vi.fn();
    render(
      <SchemeReviewPane
        scheme={scheme}
        demoGate={EMPTY_DEMO_GATE}
        confirmation={evaluateSchemeConfirmation(
          scheme,
          EMPTY_DEMO_GATE,
          plan,
        )}
        scopePlan={plan}
        onConfirmScheme={onConfirm}
        onDeclineSensitive={onDecline}
      />,
    );
    expect(screen.getByTestId("scope-acceptance-block")).toBeInTheDocument();
    const confirm = screen.getByTestId("scheme-confirm");
    expect(confirm).not.toBeDisabled();
    expect(confirm.textContent).toMatch(/含 1 处敏感改动/);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
