
/**
 * TASK-L.9 / PD-10：nextStub 确定性选出「下一份」。
 */
import { describe, expect, it } from "vitest";
import {
  nextStub,
  shouldRedecomposeAfterAbort,
} from "../../src/lib/project/next-stub";
import { schemeViewForStub } from "../../src/lib/project/stub-view";
import { applyStubKindScopeRules } from "../../src/lib/project/stub-scope-rules";
import { syncStubStatus } from "../../src/lib/project/plan-stub-sync";
import type {
  ContractStub,
  ProjectPlan,
} from "../../src/lib/project/project-plan";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";
import { scopePlanDigest } from "../../src/lib/journey/scope-plan";

function stub(
  partial: Partial<ContractStub> & Pick<ContractStub, "stub_id" | "title">,
): ContractStub {
  return {
    milestone_id: "ms-1",
    kind: "feature",
    origin: "scheme",
    scheme_item_ids: ["g-1"],
    acceptance_ids: ["acc-1"],
    area_hints: ["src/a"],
    depends_on: [],
    size_estimate: { files: 2, diff_lines: 40, minutes: 5 },
    status: "planned",
    contract_id: null,
    ...partial,
  };
}

function plan(contracts: ContractStub[], milestoneIds?: string[]): ProjectPlan {
  const ids = milestoneIds ?? contracts.map((c) => c.stub_id);
  return {
    schema_version: "1.0.0",
    project_id: "proj-pd10",
    plan_revision: 1,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "d1",
    },
    scheme_id: "S1",
    scheme_revision: 1,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "一期",
        exit_acceptance_ids: ["acc-1"],
        contract_ids: ids,
      },
    ],
    contracts,
    graveyard: [],
  };
}

describe("PD-10 nextStub", () => {
  it("cs-2 依赖 cs-1(merged)，cs-3 依赖 cs-4(aborted) → 返回 cs-2", () => {
    const p = plan([
      stub({
        stub_id: "cs-1",
        title: "一",
        status: "merged",
        contract_id: "CTR-1",
      }),
      stub({
        stub_id: "cs-2",
        title: "二",
        depends_on: ["cs-1"],
        area_hints: ["src/b"],
        scheme_item_ids: ["g-2"],
      }),
      stub({
        stub_id: "cs-3",
        title: "三",
        depends_on: ["cs-4"],
        area_hints: ["src/c"],
        scheme_item_ids: ["g-3"],
      }),
      stub({
        stub_id: "cs-4",
        title: "四",
        status: "aborted",
        contract_id: "CTR-4",
      }),
    ]);
    expect(nextStub(p)?.stub_id).toBe("cs-2");
  });

  it("cs-2 合入后无可选且仍有 planned → null 并应重新分解", () => {
    const p = plan([
      stub({
        stub_id: "cs-1",
        title: "一",
        status: "merged",
        contract_id: "CTR-1",
      }),
      stub({
        stub_id: "cs-2",
        title: "二",
        depends_on: ["cs-1"],
        status: "merged",
        contract_id: "CTR-2",
      }),
      stub({
        stub_id: "cs-3",
        title: "三",
        depends_on: ["cs-4"],
        status: "planned",
      }),
      stub({
        stub_id: "cs-4",
        title: "四",
        status: "aborted",
        contract_id: "CTR-4",
      }),
    ]);
    expect(nextStub(p)).toBeNull();
    expect(shouldRedecomposeAfterAbort(p)).toBe(true);
  });

  it("里程碑序号优先：ms-1 的 planned 先于 ms-2", () => {
    const p: ProjectPlan = {
      ...plan([]),
      milestones: [
        {
          milestone_id: "ms-1",
          title: "一期",
          exit_acceptance_ids: [],
          contract_ids: ["cs-late"],
        },
        {
          milestone_id: "ms-0",
          title: "更早？但数组序以 milestones 为准",
          exit_acceptance_ids: [],
          contract_ids: ["cs-early"],
        },
      ],
      contracts: [
        stub({
          stub_id: "cs-late",
          milestone_id: "ms-1",
          title: "晚",
        }),
        stub({
          stub_id: "cs-early",
          milestone_id: "ms-0",
          title: "早但排第二里程碑",
        }),
      ],
    };
    // milestones[0] 是 ms-1 → cs-late 先
    expect(nextStub(p)?.stub_id).toBe("cs-late");
  });
});

describe("schemeViewForStub + §5.1", () => {
  it("桩视图只含本桩 scheme_item_ids / area_hints", () => {
    const view = schemeViewForStub(
      {
        scheme_revision: 1,
        title: "整案",
        summary: "全部",
        modules: ["登录", "支付"],
        goals: [
          { id: "g-1", text: "登录" },
          { id: "g-2", text: "支付" },
        ],
        acceptance: [
          { id: "acc-1", text: "能登录", check: "both" },
          { id: "acc-2", text: "能支付", check: "both" },
        ],
      },
      stub({
        stub_id: "cs-pay",
        title: "支付桩",
        scheme_item_ids: ["g-2", "acc-2"],
        area_hints: ["src/pay"],
      }),
    );
    expect(view.summary).toContain("支付");
    expect(view.summary).not.toContain("登录");
    expect(view.notes).toContain("src/pay");
  });

  it("test_foundation 叠加安装命令与 EXPLICIT_TARGETS", () => {
    const base: ScopePlan = {
      scheme_revision: 1,
      plan_digest: "",
      areas: [
        {
          id: "a1",
          label: "测试",
          why: "基建",
          module_ids: [],
          kind: "new",
          paths: ["tests/**"],
          excluded_by_user: false,
        },
      ],
      never_touch: [],
      needs_approval: [],
      verification: {
        plain: ["测试通过"],
        commands: [],
        manual_only: false,
      },
      budget: {
        plain: "小改",
        limits: {
          max_file_modifications: 10,
          max_diff_lines: 500,
          max_duration_seconds: 600,
          max_verification_retries: 2,
        },
      },
    };
    base.plan_digest = scopePlanDigest(base);
    const next = applyStubKindScopeRules(
      base,
      stub({
        stub_id: "cs-tf",
        title: "测试基建",
        kind: "test_foundation",
        origin: "system",
        scheme_item_ids: [],
        acceptance_ids: ["sys-acc-test-foundation"],
        area_hints: ["tests"],
      }),
    );
    expect(next.dependency_changes_allowed).toBe(true);
    expect(next.network_policy).toBe("EXPLICIT_TARGETS");
    expect(next.allowed_commands?.some((c) => c.includes("vitest"))).toBe(
      true,
    );
    expect(next.needs_approval.some((n) => n.id === "lockfiles")).toBe(true);
  });
});

describe("syncStubStatus", () => {
  it("ABORTED 且依赖断裂 → redecompose", () => {
    const p = plan([
      stub({ stub_id: "cs-1", title: "一", status: "planned" }),
      stub({
        stub_id: "cs-2",
        title: "二",
        depends_on: ["cs-1"],
        status: "planned",
      }),
    ]);
    const after = syncStubStatus(p, "cs-1", "aborted", "CTR-1");
    expect(after.stub?.status).toBe("aborted");
    expect(after.redecompose).toBe(true);
    expect(nextStub(after.plan)).toBeNull();
  });
});
