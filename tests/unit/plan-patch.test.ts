/**
 * TASK-L.8：计划补丁 PD-08 / PD-09 / PD-11 + standard 零模型 + D-7 重试。
 */
import { describe, expect, it } from "vitest";
import {
  applyPlanPatch,
  emptyProjectPlan,
  planStableStringify,
  type PlanPatch,
} from "../../src/lib/project/plan-patch";
import {
  validateProjectPlan,
  type ContractStub,
  type Milestone,
  type ProjectPlan,
  type RepoFacts,
} from "../../src/lib/project/project-plan";
import type {
  SchemeDraftV2,
  SchemeItemMeta,
  WithText,
} from "../../src/lib/journey/scheme-patch-types";
import { emptyDraft } from "../helpers/scheme-patch-fixtures";
import {
  buildStandardPlanPatch,
  decompose,
  type ReadyPabView,
} from "../../daemon/supervisor/decomposer";

const BASE_FACTS: RepoFacts = {
  has_test_script: true,
  has_modules_yaml: true,
  existing_dirs: ["src", "src/api", "docs"],
};

const READY_PAB: ReadyPabView = {
  baseline_id: "pab-1",
  baseline_revision: 1,
  baseline_digest: "digest-1",
  status: "ready",
  open_decisions: [],
};

function meta(id: string): SchemeItemMeta {
  return {
    id,
    source: "user_said",
    evidence: [],
    user_pinned: false,
    updated_in_revision: 1,
  };
}

function goal(id: string, text: string): WithText {
  return { ...meta(id), text };
}

function acceptance(id: string, text: string): WithText {
  return { ...meta(id), text };
}

function moduleOf(
  id: string,
  name: string,
  purpose: string,
  user_visible = true,
): SchemeDraftV2["modules"][number] {
  return {
    ...meta(id),
    name,
    purpose,
    user_visible,
    kind: "new",
  };
}

function entity(
  id: string,
  name: string,
): SchemeDraftV2["entities"][number] {
  return { ...meta(id), name, fields_hint: ["id"] };
}

function stub(
  over: Partial<ContractStub> & Pick<ContractStub, "stub_id">,
): ContractStub {
  return {
    milestone_id: "ms-1",
    kind: "feature",
    origin: "scheme",
    title: over.title ?? `桩 ${over.stub_id}`,
    scheme_item_ids: over.scheme_item_ids ?? ["g-1", "m-1"],
    acceptance_ids: over.acceptance_ids ?? ["acc-1"],
    area_hints: over.area_hints ?? ["src"],
    depends_on: over.depends_on ?? [],
    size_estimate: over.size_estimate ?? {
      files: 3,
      diff_lines: 100,
      minutes: 10,
    },
    status: over.status ?? "planned",
    contract_id: over.contract_id ?? null,
    ...over,
  };
}

function baseScheme(over: Partial<SchemeDraftV2> = {}): SchemeDraftV2 {
  return emptyDraft({
    size_hint: "standard",
    goals: [goal("g-1", "完成登录")],
    modules: [moduleOf("m-1", "登录页", "用户登录")],
    acceptance: [acceptance("acc-1", "能登录")],
    entities: [],
    ...over,
  });
}

function basePlan(over: Partial<ProjectPlan> = {}): ProjectPlan {
  const contracts = over.contracts ?? [
    stub({ stub_id: "cs-1", scheme_item_ids: ["g-1", "m-1"] }),
  ];
  const milestones: Milestone[] = over.milestones ?? [
    {
      milestone_id: "ms-1",
      title: "第一期",
      exit_acceptance_ids: ["acc-1"],
      contract_ids: contracts.map((c) => c.stub_id),
    },
  ];
  return {
    schema_version: "1.0.0",
    project_id: "proj-1",
    plan_revision: 1,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "digest-1",
    },
    scheme_id: "S1",
    scheme_revision: 5,
    milestones,
    contracts,
    graveyard: [],
    ...over,
  };
}

describe("PD-08 / PD-09 / PD-11", () => {
  it("PD-08: 对 merged 桩 edit_stub → 丢弃 + E_PLAN_STUB_LOCKED，其余 op 照常", () => {
    const plan = basePlan({
      contracts: [
        stub({
          stub_id: "cs-merged",
          status: "merged",
          contract_id: "C-1",
          scheme_item_ids: ["g-1"],
          area_hints: ["src/a"],
          title: "已合入",
        }),
        stub({
          stub_id: "cs-planned",
          scheme_item_ids: ["m-1"],
          area_hints: ["src/b"],
          title: "待做",
        }),
      ],
      milestones: [
        {
          milestone_id: "ms-1",
          title: "第一期",
          exit_acceptance_ids: ["acc-1"],
          contract_ids: ["cs-merged", "cs-planned"],
        },
      ],
    });
    const patch: PlanPatch = {
      base_revision: 1,
      reason: "user_request",
      ops: [
        {
          op: "edit_stub",
          stub_id: "cs-merged",
          fields: { title: "不该改" },
        },
        {
          op: "edit_stub",
          stub_id: "cs-planned",
          fields: { title: "已改标题" },
        },
      ],
    };
    const r = applyPlanPatch(plan, patch, baseScheme(), BASE_FACTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.discarded).toHaveLength(1);
    expect(r.discarded[0]!.code).toBe("E_PLAN_STUB_LOCKED");
    expect(r.discarded[0]!.stub_id).toBe("cs-merged");
    const merged = r.plan.contracts.find((c) => c.stub_id === "cs-merged")!;
    expect(merged.title).toBe("已合入");
    const planned = r.plan.contracts.find((c) => c.stub_id === "cs-planned")!;
    expect(planned.title).toBe("已改标题");
    expect(r.plan.plan_revision).toBe(2);
  });

  it("PD-09: 用户删除的桩以同义标题重新加入 → E_PLAN_STUB_REVIVED", () => {
    const plan = basePlan({
      contracts: [
        stub({
          stub_id: "cs-keep",
          title: "保留桩",
          scheme_item_ids: ["g-1", "m-1"],
        }),
      ],
      graveyard: [
        {
          stub_id: "cs-old",
          title: "用户登录功能",
          removed_by: "user",
          reason: "先不做",
          removed_in_revision: 1,
        },
      ],
    });
    const patch: PlanPatch = {
      base_revision: 1,
      reason: "user_request",
      ops: [
        {
          op: "add_stub",
          stub: {
            stub_id: "cs-new",
            milestone_id: "ms-1",
            kind: "feature",
            origin: "scheme",
            title: "用户登录功能",
            scheme_item_ids: ["g-1"],
            acceptance_ids: ["acc-1"],
            area_hints: ["src/x"],
            depends_on: [],
            size_estimate: { files: 2, diff_lines: 50, minutes: 8 },
          },
        },
      ],
    };
    const r = applyPlanPatch(plan, patch, baseScheme(), BASE_FACTS, {
      removed_by: "user",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("E_PLAN_STUB_REVIVED");
    expect(r.violations.some((v) => v.rule === "D-11")).toBe(true);
  });

  it("PD-11: 同一计划 + 同一补丁两次合并 → 结果字节相同", () => {
    const plan = basePlan({
      contracts: [
        stub({ stub_id: "cs-1", area_hints: ["src/a"] }),
        stub({
          stub_id: "cs-2",
          scheme_item_ids: ["m-1"],
          area_hints: ["src/b"],
          depends_on: ["cs-1"],
        }),
      ],
      milestones: [
        {
          milestone_id: "ms-1",
          title: "第一期",
          exit_acceptance_ids: ["acc-1"],
          contract_ids: ["cs-1", "cs-2"],
        },
      ],
    });
    const patch: PlanPatch = {
      base_revision: 1,
      reason: "user_request",
      ops: [
        {
          op: "reorder",
          milestone_id: "ms-1",
          contract_ids: ["cs-2", "cs-1"],
        },
        {
          op: "edit_stub",
          stub_id: "cs-2",
          fields: { title: "调整后的标题" },
        },
      ],
    };
    const a = applyPlanPatch(plan, patch, baseScheme(), BASE_FACTS);
    const b = applyPlanPatch(plan, patch, baseScheme(), BASE_FACTS);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(planStableStringify(a.plan)).toBe(planStableStringify(b.plan));
  });

  it("FAIL: 对 merged 的修改不被采纳", () => {
    const plan = basePlan({
      contracts: [
        stub({
          stub_id: "cs-1",
          status: "merged",
          contract_id: "C-1",
          title: "原标题",
        }),
      ],
    });
    const r = applyPlanPatch(
      plan,
      {
        base_revision: 1,
        reason: "user_request",
        ops: [
          {
            op: "edit_stub",
            stub_id: "cs-1",
            fields: { title: "篡改" },
          },
        ],
      },
      baseScheme(),
      BASE_FACTS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.contracts[0]!.title).toBe("原标题");
    expect(r.discarded[0]!.code).toBe("E_PLAN_STUB_LOCKED");
  });

  it("base_revision 落后 → E_PLAN_STALE", () => {
    const r = applyPlanPatch(
      basePlan({ plan_revision: 3 }),
      { base_revision: 1, reason: "user_request", ops: [] },
      baseScheme(),
      BASE_FACTS,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("E_PLAN_STALE");
  });
});

describe("decomposer", () => {
  it("standard 方案零模型调用得到 1 里程碑 1 桩", async () => {
    const scheme = baseScheme({ size_hint: "standard" });
    const r = await decompose({
      scheme,
      repoFacts: BASE_FACTS,
      pab: READY_PAB,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model_calls).toBe(0);
    expect(r.plan.milestones).toHaveLength(1);
    expect(r.plan.contracts).toHaveLength(1);
    expect(r.plan.plan_revision).toBe(1);
    const v = validateProjectPlan(r.plan, scheme, BASE_FACTS);
    expect(v.ok).toBe(true);
    // 确认 buildStandardPlanPatch 本身也不调模型
    const patch = buildStandardPlanPatch(scheme);
    expect(patch.ops.filter((o) => o.op === "add_milestone")).toHaveLength(1);
    expect(patch.ops.filter((o) => o.op === "add_stub")).toHaveLength(1);
  });

  it("PAB stale / 阻断决策 → 不得生成可签署桩", async () => {
    const scheme = baseScheme({ size_hint: "standard" });
    const stale = await decompose({
      scheme,
      repoFacts: BASE_FACTS,
      pab: { ...READY_PAB, status: "stale" },
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe("E_PAB_NOT_READY");
    expect(stale.plain_message).toBe("这个需求我还没拆好");

    const blocked = await decompose({
      scheme,
      repoFacts: BASE_FACTS,
      pab: {
        ...READY_PAB,
        open_decisions: [{ blocking: true }],
      },
    });
    expect(blocked.ok).toBe(false);
  });

  it("桩模型返回违反 D-7 的补丁 → 重试 1 次 → 第二次合法则合并成功", async () => {
    const scheme = baseScheme({
      size_hint: "large",
      entities: [entity("e-user", "User")],
      goals: [goal("g-1", "完成登录"), goal("g-2", "完成资料")],
      modules: [
        moduleOf("m-1", "登录页", "用户登录"),
        moduleOf("m-2", "资料页", "用户资料"),
      ],
      acceptance: [
        acceptance("acc-1", "能登录"),
        acceptance("acc-2", "能改资料"),
      ],
    });

    let calls = 0;
    const r = await decompose({
      scheme,
      repoFacts: BASE_FACTS,
      pab: READY_PAB,
      model: async ({ priorViolations }) => {
        calls += 1;
        if (calls === 1) {
          // 两桩共享 entity，无 interface_first → D-7
          expect(priorViolations).toBeUndefined();
          return {
            ops: [
              {
                op: "add_milestone",
                milestone: {
                  milestone_id: "ms-1",
                  title: "第一期",
                  exit_acceptance_ids: ["acc-1", "acc-2"],
                  contract_ids: ["cs-1", "cs-2"],
                },
              },
              {
                op: "add_stub",
                stub: {
                  stub_id: "cs-1",
                  milestone_id: "ms-1",
                  kind: "feature",
                  origin: "scheme",
                  title: "登录",
                  scheme_item_ids: ["g-1", "m-1", "e-user"],
                  acceptance_ids: ["acc-1"],
                  area_hints: ["src/login"],
                  depends_on: [],
                  size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
                },
              },
              {
                op: "add_stub",
                stub: {
                  stub_id: "cs-2",
                  milestone_id: "ms-1",
                  kind: "feature",
                  origin: "scheme",
                  title: "资料",
                  scheme_item_ids: ["g-2", "m-2", "e-user"],
                  acceptance_ids: ["acc-2"],
                  area_hints: ["src/profile"],
                  depends_on: [],
                  size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
                },
              },
            ],
          };
        }
        // 第二次：补 interface_first，两桩依赖它
        expect(priorViolations!.some((v) => v.rule === "D-7")).toBe(true);
        return {
          ops: [
            {
              op: "add_milestone",
              milestone: {
                milestone_id: "ms-1",
                title: "第一期",
                exit_acceptance_ids: ["acc-1", "acc-2"],
                contract_ids: ["cs-iface", "cs-1", "cs-2"],
              },
            },
            {
              op: "add_stub",
              stub: {
                stub_id: "cs-iface",
                milestone_id: "ms-1",
                kind: "interface_first",
                origin: "scheme",
                title: "先定 User 接口",
                scheme_item_ids: ["e-user"],
                acceptance_ids: ["acc-1"],
                area_hints: ["src/types"],
                depends_on: [],
                size_estimate: { files: 2, diff_lines: 40, minutes: 8 },
              },
            },
            {
              op: "add_stub",
              stub: {
                stub_id: "cs-1",
                milestone_id: "ms-1",
                kind: "feature",
                origin: "scheme",
                title: "登录",
                scheme_item_ids: ["g-1", "m-1", "e-user"],
                acceptance_ids: ["acc-1"],
                area_hints: ["src/login"],
                depends_on: ["cs-iface"],
                size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
              },
            },
            {
              op: "add_stub",
              stub: {
                stub_id: "cs-2",
                milestone_id: "ms-1",
                kind: "feature",
                origin: "scheme",
                title: "资料",
                scheme_item_ids: ["g-2", "m-2", "e-user"],
                acceptance_ids: ["acc-2"],
                area_hints: ["src/profile"],
                depends_on: ["cs-iface"],
                size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
              },
            },
          ],
        };
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model_calls).toBe(2);
    expect(r.plan.contracts.some((c) => c.kind === "interface_first")).toBe(
      true,
    );
  });

  it("emptyProjectPlan 工厂 revision 为 0", () => {
    const p = emptyProjectPlan({
      project_id: "p",
      scheme_id: "S",
      scheme_revision: 1,
      architecture_baseline_ref: {
        baseline_id: "b",
        baseline_revision: 1,
        baseline_digest: "d",
      },
    });
    expect(p.plan_revision).toBe(0);
    expect(p.contracts).toEqual([]);
  });
});
