/**
 * TASK-L.3 验收：合同元数据 1.3.2、义务派生、withSystemScope、削弱检测、stagent check。
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  classifyRun,
  deriveObligations,
  detectRunner,
  type DetectedRunner,
} from "../../src/lib/verification/obligations";
import {
  scopePlanDigest,
  scopePlanToContractScope,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import {
  withSystemScope,
  type ScopePlanSchemeInput,
} from "../../daemon/supervisor/scope-plan-builder";
import { detectTestWeakening } from "../../daemon/guard/test-integrity";
import { runCheckCommand } from "../../bin/stagent";
import { emptySchemeDraft } from "../../src/lib/journey/scheme-draft";
import { buildConfirmContractFromScopePlan } from "../../src/lib/journey/confirm-scheme-contract";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, "../fixtures/obligation-reports");

function minimalPlan(overrides?: Partial<ScopePlan>): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: 1,
    plan_digest: "",
    areas: [
      {
        id: "area-pages",
        label: "页面",
        why: "改页面",
        module_ids: [],
        kind: "change_existing",
        paths: ["src/pages/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [],
    needs_approval: [],
    verification: {
      commands: [],
      plain: ["按方案验收"],
      manual_only: true,
    },
    budget: {
      limits: {
        max_file_modifications: 40,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 2,
      },
      plain: "预算占位",
    },
    grade: { ok: true, rejected: [] },
    ...overrides,
  };
  plan.plan_digest = scopePlanDigest(plan);
  return plan;
}

function schemeWithAcceptance(
  acceptance: NonNullable<ScopePlanSchemeInput["acceptance"]>,
): ScopePlanSchemeInput {
  return {
    scheme_revision: 1,
    title: "义务测试方案",
    summary: "验证 L.3",
    modules: ["核心"],
    notes: "",
    acceptance,
  };
}

function contractWithRefs(
  refs: NonNullable<
    SoftwareContract["supervisor_metadata"]
  >["acceptance_refs"],
): SoftwareContract {
  const draft = createContractDraft({
    title: "t",
    description: "d",
    acceptanceCriteria: ["c"],
    writablePaths: ["src/pages/**"],
    supervisorMetadata: {
      suggestion_id: "scheme:test",
      acceptance_refs: refs,
      scheme_item_ids: (refs ?? []).map((r) => r.id),
      stub_id: null,
    },
  });
  return softwareContractSchema.parse(draft);
}

describe("TASK-L.3 合同 Schema 1.3.2 元数据", () => {
  it("当前版本为 1.3.2；新建合同带新元数据解析后保留", () => {
    expect(SOFTWARE_CONTRACT_SCHEMA_VERSION).toBe("1.3.2");
    const c = contractWithRefs([
      { id: "acc-1", text: "首页能看到逾期数", check: "auto" },
      { id: "acc-2", text: "试玩通过", check: "playtest" },
    ]);
    expect(c.schema_version).toBe("1.3.2");
    expect(c.supervisor_metadata?.acceptance_refs).toEqual([
      { id: "acc-1", text: "首页能看到逾期数", check: "auto" },
      { id: "acc-2", text: "试玩通过", check: "playtest" },
    ]);
    expect(c.supervisor_metadata?.scheme_item_ids).toEqual(["acc-1", "acc-2"]);
    expect(c.supervisor_metadata?.stub_id).toBeNull();
  });

  it("1.3.1 合同（含 manual_confirmation）照常可读", () => {
    const draft = createContractDraft({
      title: "legacy",
      description: "d",
      acceptanceCriteria: ["人工确认"],
      writablePaths: ["src/x.ts"],
      commands: [],
      manualConfirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at", "reason"],
      },
    });
    const legacy = softwareContractSchema.parse({
      ...draft,
      schema_version: "1.3.1",
    });
    expect(legacy.schema_version).toBe("1.3.1");
    expect(legacy.verification_spec.manual_confirmation?.reason_required).toBe(
      true,
    );
  });

  it("buildConfirmContractFromScopePlan 从方案 acceptance 填充元数据", () => {
    const scheme = emptySchemeDraft({
      scheme_id: "sch_l3",
      title: "确认",
      summary: "摘要",
      modules: ["m"],
      acceptance: [
        { id: "acc-a", text: "自动过", check: "auto" },
        { id: "acc-p", text: "试玩", check: "playtest" },
      ],
    });
    const plan = minimalPlan();
    const contract = buildConfirmContractFromScopePlan(scheme, plan);
    expect(contract.schema_version).toBe("1.3.2");
    expect(contract.supervisor_metadata?.suggestion_id).toBe("scheme:sch_l3");
    expect(contract.supervisor_metadata?.stub_id).toBeNull();
    expect(contract.supervisor_metadata?.acceptance_refs).toEqual([
      { id: "acc-a", text: "自动过", check: "auto" },
      { id: "acc-p", text: "试玩", check: "playtest" },
    ]);
    expect(contract.supervisor_metadata?.scheme_item_ids).toEqual([
      "acc-a",
      "acc-p",
    ]);
  });
});

describe("TASK-L.3 deriveObligations / detectRunner / classifyRun", () => {
  it("两条 auto 验收 → 两条义务", () => {
    const runner: DetectedRunner = {
      kind: "vitest",
      reportArgs: ["--reporter=json"],
    };
    const contract = contractWithRefs([
      { id: "acc-1", text: "a", check: "auto" },
      { id: "acc-2", text: "b", check: "both" },
      { id: "acc-3", text: "c", check: "playtest" },
    ]);
    const result = deriveObligations(contract, runner);
    expect(result.waived).toEqual([]);
    expect(result.obligations).toEqual([
      {
        acceptance_id: "acc-1",
        test_path: "tests/stagent/acc-1.test.ts",
        level: "unit",
      },
      {
        acceptance_id: "acc-2",
        test_path: "tests/stagent/acc-2.test.ts",
        level: "unit",
      },
    ]);
  });

  it("detectRunner 为空 → 两条均在 waived", () => {
    const runner = detectRunner({});
    expect(runner.kind).toBeNull();
    const contract = contractWithRefs([
      { id: "acc-1", text: "a", check: "auto" },
      { id: "acc-2", text: "b", check: "auto" },
    ]);
    const result = deriveObligations(contract, runner);
    expect(result.obligations).toEqual([]);
    expect(result.waived).toEqual([
      { acceptance_id: "acc-1", reason: "no_runner" },
      { acceptance_id: "acc-2", reason: "no_runner" },
    ]);
  });

  it("classifyRun：1 失败 → red；收集错误 → red_invalid；全过 → green；0 用例 → red_invalid", () => {
    expect(
      classifyRun({
        schema: "stagent-obligation-report-v1",
        test_count: 2,
        assertion_failures: 1,
        collection_or_compile_errors: 0,
      }),
    ).toBe("red");
    expect(
      classifyRun({
        schema: "stagent-obligation-report-v1",
        test_count: 0,
        assertion_failures: 0,
        collection_or_compile_errors: 1,
      }),
    ).toBe("red_invalid");
    expect(
      classifyRun({
        schema: "stagent-obligation-report-v1",
        test_count: 3,
        assertion_failures: 0,
        collection_or_compile_errors: 0,
      }),
    ).toBe("green");
    expect(
      classifyRun({
        schema: "stagent-obligation-report-v1",
        test_count: 0,
        assertion_failures: 0,
        collection_or_compile_errors: 0,
      }),
    ).toBe("red_invalid");
  });
});

describe("TASK-L.3 withSystemScope", () => {
  it("有 auto 条目时 writable_paths 含 tests/stagent/**，plan_digest 随之变化", () => {
    const base = minimalPlan();
    const before = base.plan_digest;
    const next = withSystemScope(base, {
      repoRoot: process.cwd(),
      scheme: schemeWithAcceptance([
        { id: "acc-1", text: "自动", check: "auto" },
      ]),
      runner: { kind: "vitest", reportArgs: ["--reporter=json"] },
    });
    const projected = scopePlanToContractScope(next);
    expect(projected.writable_paths).toContain("tests/stagent/**");
    expect(next.plan_digest).not.toBe(before);
    expect(next.plan_digest).toBe(scopePlanDigest(next));
    const aliases = next.verification.commands.map((c) => c.alias);
    expect(aliases).toContain("obligation-tests");
    expect(aliases).toContain("check-obligations");
    expect(aliases).toContain("check-test-integrity");
  });

  it("无 auto 条目时不变", () => {
    const base = minimalPlan();
    const before = base.plan_digest;
    const next = withSystemScope(base, {
      repoRoot: process.cwd(),
      scheme: schemeWithAcceptance([
        { id: "acc-p", text: "试玩", check: "playtest" },
      ]),
      runner: { kind: "vitest", reportArgs: ["--reporter=json"] },
    });
    expect(next).toBe(base);
    expect(next.plan_digest).toBe(before);
    expect(scopePlanToContractScope(next).writable_paths).not.toContain(
      "tests/stagent/**",
    );
  });
});

describe("TASK-L.3 detectTestWeakening", () => {
  it("删一条 expect( → weakened", () => {
    const base = `it("a", () => { expect(1).toBe(1); expect(2).toBe(2); });`;
    const cand = `it("a", () => { expect(1).toBe(1); });`;
    const r = detectTestWeakening(base, cand, "ts");
    expect(r.weakened).toBe(true);
    expect(r.base_assertion_count).toBe(2);
    expect(r.candidate_assertion_count).toBe(1);
  });

  it("新增 it.only / .skip / @pytest.mark.skip → weakened", () => {
    const baseTs = `it("a", () => { expect(1).toBe(1); });`;
    const only = `it.only("a", () => { expect(1).toBe(1); });`;
    expect(detectTestWeakening(baseTs, only, "ts").weakened).toBe(true);

    const skip = `it.skip("a", () => { expect(1).toBe(1); });`;
    expect(detectTestWeakening(baseTs, skip, "ts").weakened).toBe(true);

    const basePy = `def test_a():\n    assert 1 == 1\n`;
    const skipPy = `import pytest\n@pytest.mark.skip\ndef test_a():\n    assert 1 == 1\n`;
    expect(detectTestWeakening(basePy, skipPy, "py").weakened).toBe(true);
  });

  it("只增断言 → 不 weakened", () => {
    const base = `it("a", () => { expect(1).toBe(1); });`;
    const cand = `it("a", () => { expect(1).toBe(1); expect(2).toBe(2); });`;
    const r = detectTestWeakening(base, cand, "ts");
    expect(r.weakened).toBe(false);
    expect(r.candidate_assertion_count).toBeGreaterThan(r.base_assertion_count);
  });
});

describe("TASK-L.3 stagent check obligations 退出码", () => {
  it("对夹具报告分别以 0 / 1 退出", () => {
    const green = runCheckCommand([
      "obligations",
      "--report",
      path.join(FIXTURES, "green.json"),
    ]);
    expect(green.exitCode).toBe(0);
    expect(JSON.parse(green.stdout).classification).toBe("green");

    const red = runCheckCommand([
      "obligations",
      "--report",
      path.join(FIXTURES, "red.json"),
    ]);
    expect(red.exitCode).toBe(1);
    expect(JSON.parse(red.stdout).classification).toBe("red");

    const invalid = runCheckCommand([
      "obligations",
      "--report",
      path.join(FIXTURES, "red-invalid-collect.json"),
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout).classification).toBe("red_invalid");
  });
});
