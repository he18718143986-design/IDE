/**
 * TASK-L.7：ProjectPlan 校验矩阵 PD-01～PD-07、PD-12、PD-13。
 */
import { describe, expect, it } from "vitest";
import {
  SYSTEM_ACCEPTANCE,
  SYSTEM_ACCEPTANCE_IDS,
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
import { ERROR_CODE_CATALOG, isKnownErrorCode } from "../../src/lib/error-codes";

const BASE_FACTS: RepoFacts = {
  has_test_script: true,
  has_modules_yaml: true,
  existing_dirs: ["src", "src/api", "docs"],
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

describe("SYSTEM_ACCEPTANCE", () => {
  it("含 §2.1 五条系统验收 id", () => {
    expect(SYSTEM_ACCEPTANCE).toHaveLength(5);
    expect(SYSTEM_ACCEPTANCE_IDS.has("sys-acc-test-foundation")).toBe(true);
    expect(SYSTEM_ACCEPTANCE_IDS.has("sys-acc-knowledge")).toBe(true);
    expect(SYSTEM_ACCEPTANCE_IDS.has("sys-acc-dependency")).toBe(true);
    expect(SYSTEM_ACCEPTANCE_IDS.has("sys-acc-flaky")).toBe(true);
    expect(SYSTEM_ACCEPTANCE_IDS.has("sys-acc-incident")).toBe(true);
  });
});

describe("TASK-L.7 error codes", () => {
  it.each([
    "E_PLAN_INVALID",
    "E_PLAN_STALE",
    "E_PLAN_STUB_LOCKED",
    "E_PLAN_STUB_TOO_LARGE",
    "E_PLAN_STUB_REVIVED",
  ] as const)("%s 已登记", (code) => {
    expect(isKnownErrorCode(code)).toBe(true);
    expect(ERROR_CODE_CATALOG[code].task).toBe("TASK-L.7");
  });
});

describe("PD-01～PD-07 / PD-12 / PD-13", () => {
  it("合法基线计划通过", () => {
    const r = validateProjectPlan(basePlan(), baseScheme(), BASE_FACTS);
    expect(r).toEqual({ ok: true, violations: [] });
  });

  it("PD-01: size_estimate.files = 11 → D-1", () => {
    const plan = basePlan({
      contracts: [
        stub({
          stub_id: "cs-1",
          size_estimate: { files: 11, diff_lines: 100, minutes: 10 },
        }),
      ],
    });
    const r = validateProjectPlan(plan, baseScheme(), BASE_FACTS);
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ rule: "D-1", target: "cs-1" });
  });

  it("PD-02: user_visible 模块无覆盖 → D-4", () => {
    const scheme = baseScheme({
      modules: [
        moduleOf("m-1", "登录页", "用户登录"),
        moduleOf("m-orphan", "报表", "无人覆盖"),
      ],
    });
    const r = validateProjectPlan(basePlan(), scheme, BASE_FACTS);
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ rule: "D-4", target: "m-orphan" });
  });

  it("PD-03: 依赖成环 → D-5", () => {
    const contracts = [
      stub({
        stub_id: "cs-1",
        depends_on: ["cs-2"],
        scheme_item_ids: ["g-1"],
        area_hints: ["src/a"],
      }),
      stub({
        stub_id: "cs-2",
        depends_on: ["cs-1"],
        scheme_item_ids: ["m-1"],
        area_hints: ["src/b"],
      }),
    ];
    const plan = basePlan({
      contracts,
      milestones: [
        {
          milestone_id: "ms-1",
          title: "第一期",
          exit_acceptance_ids: ["acc-1"],
          contract_ids: ["cs-1", "cs-2"],
        },
      ],
    });
    const r = validateProjectPlan(plan, baseScheme(), BASE_FACTS);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.rule === "D-5")).toBe(true);
  });

  it("PD-04: area_hints 相交无依赖 → D-6", () => {
    const contracts = [
      stub({
        stub_id: "cs-1",
        scheme_item_ids: ["g-1"],
        area_hints: ["src/api"],
      }),
      stub({
        stub_id: "cs-2",
        scheme_item_ids: ["m-1"],
        area_hints: ["src/api"],
      }),
    ];
    const plan = basePlan({
      contracts,
      milestones: [
        {
          milestone_id: "ms-1",
          title: "第一期",
          exit_acceptance_ids: ["acc-1"],
          contract_ids: ["cs-1", "cs-2"],
        },
      ],
    });
    const r = validateProjectPlan(plan, baseScheme(), BASE_FACTS);
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({
      rule: "D-6",
      target: "cs-1|cs-2",
    });
  });

  it("PD-05: 三桩共享 entity 无 interface_first → D-7", () => {
    const scheme = baseScheme({
      entities: [entity("ent-user", "User")],
      modules: [
        moduleOf("m-1", "登录页", "用户登录"),
        moduleOf("m-2", "资料页", "资料"),
        moduleOf("m-3", "设置页", "设置"),
      ],
    });
    const contracts = [
      stub({
        stub_id: "cs-1",
        scheme_item_ids: ["g-1", "m-1", "ent-user"],
        area_hints: ["src/a"],
      }),
      stub({
        stub_id: "cs-2",
        scheme_item_ids: ["m-2", "ent-user"],
        area_hints: ["src/b"],
      }),
      stub({
        stub_id: "cs-3",
        scheme_item_ids: ["m-3", "ent-user"],
        area_hints: ["src/c"],
      }),
    ];
    const plan = basePlan({
      contracts,
      milestones: [
        {
          milestone_id: "ms-1",
          title: "第一期",
          exit_acceptance_ids: ["acc-1"],
          contract_ids: ["cs-1", "cs-2", "cs-3"],
        },
      ],
    });
    const r = validateProjectPlan(plan, scheme, BASE_FACTS);
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ rule: "D-7", target: "ent-user" });
  });

  it("PD-06: manual_only + large 且首桩非 test_foundation → D-8", () => {
    const scheme = baseScheme({ size_hint: "large" });
    const plan = basePlan();
    const r = validateProjectPlan(plan, scheme, {
      ...BASE_FACTS,
      has_test_script: false,
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ rule: "D-8", target: "cs-1" });
  });

  it("PD-07: 无 modules.yaml 且前两桩都不是 knowledge_bootstrap → D-9", () => {
    const plan = basePlan();
    const r = validateProjectPlan(plan, baseScheme(), {
      ...BASE_FACTS,
      has_modules_yaml: false,
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ rule: "D-9", target: "cs-1" });
  });

  it("PD-12: 合法计划 revision 递增后仍通过，且校验幂等", () => {
    const plan = basePlan({ plan_revision: 1 });
    const scheme = baseScheme();
    const r1 = validateProjectPlan(plan, scheme, BASE_FACTS);
    const bumped: ProjectPlan = { ...plan, plan_revision: 2 };
    const r2 = validateProjectPlan(bumped, scheme, BASE_FACTS);
    const r3 = validateProjectPlan(bumped, scheme, BASE_FACTS);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2).toEqual(r3);
    expect(bumped.plan_revision).toBe(plan.plan_revision + 1);
  });

  it("PD-13: system test_foundation 空 scheme_item_ids + sys-acc → 过 D-2/D-3", () => {
    const scheme = baseScheme({ size_hint: "large" });
    const contracts = [
      stub({
        stub_id: "cs-tf",
        kind: "test_foundation",
        origin: "system",
        title: "先搭测试地基",
        scheme_item_ids: [],
        acceptance_ids: ["sys-acc-test-foundation"],
        area_hints: ["tests"],
      }),
      stub({
        stub_id: "cs-kb",
        kind: "knowledge_bootstrap",
        origin: "system",
        title: "先写系统知识库",
        scheme_item_ids: [],
        acceptance_ids: ["sys-acc-knowledge"],
        area_hints: ["docs/system"],
        depends_on: ["cs-tf"],
      }),
      stub({
        stub_id: "cs-1",
        scheme_item_ids: ["g-1", "m-1"],
        area_hints: ["src"],
        depends_on: ["cs-kb"],
        acceptance_ids: ["acc-1"],
      }),
    ];
    const plan = basePlan({
      contracts,
      milestones: [
        {
          milestone_id: "ms-1",
          title: "第一期",
          exit_acceptance_ids: [
            "acc-1",
            "sys-acc-test-foundation",
            "sys-acc-knowledge",
          ],
          contract_ids: ["cs-tf", "cs-kb", "cs-1"],
        },
      ],
    });
    const r = validateProjectPlan(plan, scheme, {
      has_test_script: false,
      has_modules_yaml: false,
      existing_dirs: ["src", "tests", "docs/system"],
    });
    expect(
      r.violations.filter((v) => v.rule === "D-2" || v.rule === "D-3"),
    ).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("FAIL: 同一输入两次校验结果相同（确定性）", () => {
    const plan = basePlan({
      contracts: [
        stub({
          stub_id: "cs-1",
          size_estimate: { files: 11, diff_lines: 100, minutes: 10 },
        }),
      ],
    });
    const a = validateProjectPlan(plan, baseScheme(), BASE_FACTS);
    const b = validateProjectPlan(plan, baseScheme(), BASE_FACTS);
    expect(a).toEqual(b);
  });
});
