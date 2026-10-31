import { describe, expect, it } from "vitest";
import {
  EMPTY_DEMO_GATE,
  canConfirmScheme,
  computeDemoReady,
  emptySchemeDraft,
  evaluateSchemeConfirmation,
  freezeScheme,
  type DemoGate,
  type SchemeConflict,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import {
  formatBudgetPlain,
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import { canTransitionDelivery } from "../../src/lib/state/delivery-state";

/**
 * SSOT v2.0.2 §3.5 / §2.2 验收：单一确认谓词与直接签署状态边。
 * TASK-J.3 / J.5 / SSOT §15.5：范围纳入唯一确认谓词（T-GATE-012～018；门禁恒开启）。
 *
 * 本文件是「允许/拒绝矩阵」的唯一实现证据。规范里每条决策都指向
 * 这里的测试 ID（T-GATE-xxx / T-STATE-xxx），改谓词必须先改这里。
 *
 * 注：原 C.22 的 T-GATE-012（demoReady）/ T-GATE-013（canConfirm）已改编号为
 * T-GATE-011b / T-GATE-011c，把 012～016 留给 J.3 范围用例（与卡面 ID 对齐）。
 */

function makeDraft(partial: Partial<SchemeDraft> = {}): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary:
      "按项目维度汇总进度与预算，并对超期节点发出预警，支持月度报表导出。",
    modules: ["工程进度管控", "财务数据与预算"],
    mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
    business_input_rounds: 1,
    ...partial,
  });
}

function makeDemo(partial: Partial<DemoGate> = {}): DemoGate {
  return { ...EMPTY_DEMO_GATE, ...partial };
}

function openConflict(): SchemeConflict {
  return {
    id: "c1",
    question: "预算口径按合同额还是实际付款？",
    options: [
      { id: "contract", label: "合同额" },
      { id: "paid", label: "实际付款" },
    ],
    chosenId: null,
  };
}

/** 合规 ScopePlan：与 makeDraft 默认 revision=1 对齐；敏感项默认已清空/已授权。 */
function compliantScopePlan(partial: Partial<ScopePlan> = {}): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: 1,
    plan_digest: "",
    areas: [
      {
        id: "area-0",
        label: "工程进度管控",
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
      plain: ["页面能打开并看到进度数字"],
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
    ...partial,
  };
  const withDigest: ScopePlan = { ...plan, plan_digest: "" };
  withDigest.plan_digest = scopePlanDigest(withDigest);
  return withDigest;
}

describe("T-GATE 单一确认谓词 evaluateSchemeConfirmation", () => {
  it("T-GATE-001 从未生成 Demo：允许按静态方案签署，demo_mode=none", () => {
    // J.5：门禁恒开启，须传与修订对齐的合规 plan
    const decision = evaluateSchemeConfirmation(
      makeDraft(),
      EMPTY_DEMO_GATE,
      compliantScopePlan(),
    );
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("OK");
    expect(decision.demo_mode).toBe("none");
    expect(decision.reasons).toEqual([]);
  });

  it("T-GATE-002 Demo 已就绪且对同一修订确认：允许签署", () => {
    const draft = makeDraft({ scheme_revision: 3 });
    const decision = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "ready",
        scheme_revision: 3,
        decision_revision: 3,
        prototype_id: "proto-a",
      }),
      compliantScopePlan({ scheme_revision: 3 }),
    );
    expect(decision.ok).toBe(true);
    expect(decision.demo_mode).toBe("interactive");
  });

  it("T-GATE-003 Demo 仍在生成：拒绝 E_DEMO_BUILDING", () => {
    const draft = makeDraft({ scheme_revision: 2 });
    const decision = evaluateSchemeConfirmation(
      draft,
      makeDemo({ status: "building", scheme_revision: 2 }),
      compliantScopePlan({ scheme_revision: 2 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_BUILDING");
    expect(decision.reasons).toContain("Demo 仍在生成");
  });

  it("T-GATE-004 Demo 生成失败且未处置：拒绝 E_DEMO_FAILED", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ scheme_revision: 2 }),
      makeDemo({ status: "failed", scheme_revision: 2 }),
      compliantScopePlan({ scheme_revision: 2 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_FAILED");
  });

  it("T-GATE-005 已生成但未确认（decision_revision=null）：拒绝 E_DEMO_CONFIRMATION_REQUIRED", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ scheme_revision: 4 }),
      makeDemo({
        status: "ready",
        scheme_revision: 4,
        decision_revision: null,
        prototype_id: "proto-b",
      }),
      compliantScopePlan({ scheme_revision: 4 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_CONFIRMATION_REQUIRED");
  });

  it("T-GATE-006 Demo 基于旧修订：拒绝 E_DEMO_STALE（改过方案必须重生成）", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ scheme_revision: 5 }),
      makeDemo({
        status: "ready",
        scheme_revision: 4,
        decision_revision: 4,
        prototype_id: "proto-c",
      }),
      compliantScopePlan({ scheme_revision: 5 }),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_DEMO_STALE");
  });

  it("T-GATE-007 仍有未决冲突：拒绝 E_SCHEME_CONFLICTS_OPEN，且不因 Demo 就绪而放行", () => {
    const draft = makeDraft({
      scheme_revision: 1,
      conflicts: [openConflict()],
    });
    const decision = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "ready",
        scheme_revision: 1,
        decision_revision: 1,
        prototype_id: "proto-d",
      }),
      compliantScopePlan(),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_CONFLICTS_OPEN");
    expect(decision.reasons).toContain("仍有 1 条未决冲突");
  });

  it("T-GATE-008 方案不可审阅（标题/摘要不足）：拒绝 E_SCHEME_NOT_REVIEWABLE", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ title: "", summary: "", modules: [] }),
      EMPTY_DEMO_GATE,
      compliantScopePlan(),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_NOT_REVIEWABLE");
  });

  it("T-GATE-009 已冻结方案：拒绝 E_SCHEME_ALREADY_FROZEN（不重复签署）", () => {
    const decision = evaluateSchemeConfirmation(
      freezeScheme(makeDraft()),
      EMPTY_DEMO_GATE,
      compliantScopePlan(),
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_ALREADY_FROZEN");
  });

  it("T-GATE-010 降级流程卡：未显式接受拒绝；已接受则允许且 demo_mode=degraded", () => {
    const draft = makeDraft({ scheme_revision: 2 });
    const plan = compliantScopePlan({ scheme_revision: 2 });
    const notAccepted = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "degraded_flowcard",
        scheme_revision: 2,
        decision_revision: null,
      }),
      plan,
    );
    expect(notAccepted.ok).toBe(false);
    expect(notAccepted.code).toBe("E_DEMO_CONFIRMATION_REQUIRED");
    expect(notAccepted.message).toContain("降级");

    const accepted = evaluateSchemeConfirmation(
      draft,
      makeDemo({
        status: "degraded_flowcard",
        scheme_revision: 2,
        decision_revision: 2,
        risk_flags: ["NO_INTERACTIVE_DEMO"],
      }),
      plan,
    );
    expect(accepted.ok).toBe(true);
    expect(accepted.demo_mode).toBe("degraded");
  });

  it("T-GATE-011 completeness 只是展示分：不参与 demoReady，也不参与确认判定", () => {
    const noFlow = makeDraft({
      completeness: 100,
      mermaidFlow: "",
      modules: ["工程进度管控", "财务数据与预算"],
    });
    expect(computeDemoReady(noFlow)).toBe(false);

    const lowScore = makeDraft({ completeness: 0 });
    expect(computeDemoReady(lowScore)).toBe(true);

    expect(
      evaluateSchemeConfirmation(
        { ...lowScore, completeness: 0 },
        EMPTY_DEMO_GATE,
        compliantScopePlan(),
      ).ok,
    ).toBe(true);
  });

  it("T-GATE-011b demoReady 四条件逐条落地：任一缺失即 false", () => {
    expect(computeDemoReady(makeDraft())).toBe(true);
    expect(computeDemoReady(makeDraft({ modules: ["仅一个模块"] }))).toBe(
      false,
    );
    expect(computeDemoReady(makeDraft({ mermaidFlow: "" }))).toBe(false);
    expect(computeDemoReady(makeDraft({ conflicts: [openConflict()] }))).toBe(
      false,
    );
    expect(computeDemoReady(makeDraft({ business_input_rounds: 0 }))).toBe(
      false,
    );
  });

  it("T-GATE-011c canConfirmScheme 兼容别名：固定 null plan → 恒不可确认", () => {
    expect(canConfirmScheme(makeDraft())).toBe(false);
    expect(
      evaluateSchemeConfirmation(makeDraft(), EMPTY_DEMO_GATE, null).ok,
    ).toBe(false);
    expect(
      evaluateSchemeConfirmation(makeDraft(), EMPTY_DEMO_GATE, null).code,
    ).toBe("E_SCOPE_NOT_READY");
  });
});

describe("T-GATE J.3/J.5 范围纳入唯一确认谓词（恒开启）", () => {
  it("T-GATE-012 修订号不一致 → E_SCOPE_NOT_READY", () => {
    const draft = makeDraft({ scheme_revision: 3 });
    const plan = compliantScopePlan({ scheme_revision: 2 });
    const decision = evaluateSchemeConfirmation(draft, EMPTY_DEMO_GATE, plan);
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCOPE_NOT_READY");
    expect(decision.message).toBe("正在核对要改哪些地方…");
  });

  it("T-GATE-013 scopePlan=null → E_SCOPE_NOT_READY", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft(),
      EMPTY_DEMO_GATE,
      null,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCOPE_NOT_READY");
    expect(decision.message).toContain("正在核对要改哪些地方");
  });

  it("T-GATE-014 grade.ok=false → E_SCOPE_POLICY，文案含白话区域名、不含 **", () => {
    const plan = compliantScopePlan({
      areas: [
        {
          id: "area-src",
          label: "整个 src 目录",
          why: "范围过大",
          module_ids: [],
          kind: "change_existing",
          paths: ["src/**"],
          excluded_by_user: false,
        },
      ],
      grade: {
        ok: false,
        rejected: [{ path: "src/**", kind: "bare_top_glob" }],
      },
    });
    const decision = evaluateSchemeConfirmation(
      makeDraft(),
      EMPTY_DEMO_GATE,
      plan,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCOPE_POLICY");
    expect(decision.message).toContain("整个 src 目录");
    expect(decision.message).toContain("范围太大");
    expect(decision.message).not.toContain("**");
    expect(decision.message.toLowerCase()).not.toMatch(/glob/);
  });

  it("T-GATE-015 未授权敏感项（approved !== true）→ E_SCOPE_APPROVAL_REQUIRED", () => {
    const plan = compliantScopePlan({
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "命中保护清单",
          paths: ["package.json"],
          approved: null,
        },
      ],
    });
    const decision = evaluateSchemeConfirmation(
      makeDraft(),
      EMPTY_DEMO_GATE,
      plan,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCOPE_APPROVAL_REQUIRED");
    expect(decision.message).toBe("还有 1 处敏感改动会写在确认开工上");
  });

  it("T-GATE-016 全部满足 → ok", () => {
    const plan = compliantScopePlan({
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "命中保护清单",
          paths: ["package.json"],
          approved: true,
        },
      ],
    });
    const decision = evaluateSchemeConfirmation(
      makeDraft(),
      EMPTY_DEMO_GATE,
      plan,
    );
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("OK");
  });

  it("T-GATE-017 冲突优先于范围未就绪：OPEN 冲突时返回 E_SCHEME_CONFLICTS_OPEN", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft({ conflicts: [openConflict()] }),
      EMPTY_DEMO_GATE,
      null,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("E_SCHEME_CONFLICTS_OPEN");
  });

  it("T-GATE-018 canConfirmScheme 恒不可确认（逼出遗留调用）", () => {
    expect(canConfirmScheme(makeDraft())).toBe(false);
    expect(
      evaluateSchemeConfirmation(makeDraft(), EMPTY_DEMO_GATE, null).code,
    ).toBe("E_SCOPE_NOT_READY");
  });

  it("旧用例在合规 scopePlan 下不回归（无 Demo 可签）", () => {
    const decision = evaluateSchemeConfirmation(
      makeDraft(),
      EMPTY_DEMO_GATE,
      compliantScopePlan(),
    );
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("OK");
    expect(decision.demo_mode).toBe("none");
  });
});

describe("T-STATE 直接签署状态边 PLAN_CONFIRMED → CONTRACT_SIGNED", () => {
  it("T-STATE-001 允许从 PLAN_CONFIRMED 直接签署（不再强制经过 DEMO_READY）", () => {
    expect(canTransitionDelivery("PLAN_CONFIRMED", "CONTRACT_SIGNED")).toBe(
      true,
    );
  });

  it("T-STATE-002 Demo 先行的老链路仍然合法：PLAN_CONFIRMED → DEMO_READY → CONTRACT_SIGNED", () => {
    expect(canTransitionDelivery("PLAN_CONFIRMED", "DEMO_READY")).toBe(true);
    expect(canTransitionDelivery("DEMO_READY", "CONTRACT_SIGNED")).toBe(true);
  });

  it("T-STATE-003 不允许跳级：PLAN_READY 直接到 CONTRACT_SIGNED 仍被拒", () => {
    expect(canTransitionDelivery("PLAN_READY", "CONTRACT_SIGNED")).toBe(false);
  });
});
