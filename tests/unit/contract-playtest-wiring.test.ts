/**
 * TASK-C.23：`check playtest` 接入北极星合同验收档（装配接线验收）。
 *
 * 覆盖（卡正文 PASS PW-01～PW-03，逐条双路径）：
 * PW-01：附加——references[] 非空 → commands 含 playtest，args[2] === contract_id。
 * PW-02：不附加——无 references / references: [] → 无 playtest，默认 test 命令不受影响。
 * PW-03：幂等——调用方已含 playtest 或重复装配 → 恰好 1 条、无重复。
 *
 * 双装配点（只改单边即 FAIL，故两条路径各验一遍）：
 * 1. createContractDraft()（合同草案装配）
 * 2. buildConfirmContractFromScopePlan()（scheme 确认覆盖式装配，:108-126 会覆盖
 *    draft 的 verification_spec.commands）
 *
 * 纪律：本卡不改 playtest-guard.ts 判定逻辑，不宣称端到端闭环。
 */
import { describe, expect, it } from "vitest";
import {
  createContractDraft,
  withPlaytestCommand,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { emptySchemeDraft } from "../../src/lib/journey/scheme-draft";
import {
  buildConfirmContractFromScopePlan,
} from "../../src/lib/journey/confirm-scheme-contract";
import {
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";

const REF = "https://partner.example.com/spec";

function playtests(contract: SoftwareContract) {
  return contract.verification_spec.commands.filter(
    (c) => c.alias === "playtest",
  );
}

function makeMinimalPlan(revision = 1): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: revision,
    plan_digest: "",
    areas: [
      {
        id: "area-src",
        label: "源码",
        why: "改源码",
        module_ids: [],
        kind: "change_existing",
        paths: ["src/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [],
    needs_approval: [],
    verification: {
      commands: [
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
      plain: ["按方案验收"],
      manual_only: false,
    },
    budget: {
      limits: {
        max_file_modifications: 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 2,
      },
      plain: "默认预算",
    },
    grade: { ok: true, rejected: [] },
  };
  plan.plan_digest = scopePlanDigest(plan);
  return plan;
}

function draftWithRefs(references?: string[]) {
  return createContractDraft({
    title: "C.23 北极星合同",
    description: "带参考站的合同应自动带 playtest 验收命令",
    acceptanceCriteria: ["与参考站一模一样"],
    writablePaths: ["src/**"],
    ...(references === undefined ? {} : { references }),
  });
}

describe("PW-01：references[] 非空 → 自动附加 playtest（createContractDraft）", () => {
  it("commands 含 playtest 且 args[2] 等于本合同 contract_id", () => {
    const contract = draftWithRefs([REF]);
    const cmds = playtests(contract);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.executable).toBe("stagent");
    expect(cmds[0]!.args).toEqual([
      "check",
      "playtest",
      contract.contract_id,
    ]);
    // args[2] 必须是服务端装配的 contract_id
    expect(cmds[0]!.args[2]).toBe(contract.contract_id);
  });

  it("既有默认 test 命令保留，playtest 追加在后", () => {
    const contract = draftWithRefs([REF]);
    const aliases = contract.verification_spec.commands.map((c) => c.alias);
    expect(aliases).toContain("test");
    expect(aliases[aliases.length - 1]).toBe("playtest");
  });
});

describe("PW-02：非北极星合同不附加（createContractDraft）", () => {
  it("未传 references → 不含 playtest，且默认 test 命令不受影响", () => {
    const contract = draftWithRefs();
    expect(playtests(contract)).toHaveLength(0);
    expect(
      contract.verification_spec.commands.map((c) => c.alias),
    ).toEqual(["test"]);
  });

  it("references: [] → 不含 playtest", () => {
    const contract = draftWithRefs([]);
    expect(playtests(contract)).toHaveLength(0);
  });

  it("非北极星合同即便调用方自带 playtest 也被剔除（不得绕开判据挂命令）", () => {
    const contract = createContractDraft({
      title: "非北极星",
      description: "无参考站却自带 playtest 命令",
      acceptanceCriteria: ["x"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "playtest",
          executable: "stagent",
          args: ["check", "playtest", "contract_forged"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    });
    expect(playtests(contract)).toHaveLength(0);
    // 既有 test 命令不受影响（剔除只针对 playtest）
    expect(
      contract.verification_spec.commands.map((c) => c.alias),
    ).toEqual(["test"]);
  });
});

describe("PW-03：幂等与防伪造（createContractDraft）", () => {
  it("调用方已含 alias:playtest → 恰好 1 条，无重复", () => {
    const contract = createContractDraft({
      title: "幂等",
      description: "调用方自带 playtest",
      acceptanceCriteria: ["x"],
      writablePaths: ["src/**"],
      references: [REF],
      commands: [
        {
          alias: "playtest",
          executable: "stagent",
          args: ["check", "playtest", "contract_forged"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
    });
    const cmds = playtests(contract);
    expect(cmds).toHaveLength(1);
    // 防伪造：args 一律以服务端 contract_id 为准，不接受调用方传入值
    expect(cmds[0]!.args[2]).toBe(contract.contract_id);
    expect(cmds[0]!.args[2]).not.toBe("contract_forged");
  });

  it("对同一合同重复执行装配 → 恰好 1 条", () => {
    const contract = draftWithRefs([REF]);
    const twice = withPlaytestCommand(
      withPlaytestCommand(
        contract.verification_spec.commands,
        contract.contract_id,
        true,
      ),
      contract.contract_id,
      true,
    );
    expect(twice.filter((c) => c.alias === "playtest")).toHaveLength(1);
  });
});

describe("scheme 确认覆盖路径（buildConfirmContractFromScopePlan）同样满足 PW-01～PW-03", () => {
  function schemeContract(references?: string[]) {
    const scheme = emptySchemeDraft({
      title: "C.23 参考站方案",
      summary: "带参考站的方案",
      modules: ["module1"],
      ...(references === undefined ? {} : { references }),
    });
    return buildConfirmContractFromScopePlan(scheme, makeMinimalPlan(scheme.scheme_revision));
  }

  it("PW-01：scheme.references 非空 → 产出合同带 playtest，args[2] === contract_id", () => {
    const contract = schemeContract([REF]);
    const cmds = playtests(contract);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.executable).toBe("stagent");
    expect(cmds[0]!.args[2]).toBe(contract.contract_id);
  });

  it("PW-02：scheme 无 references → 不含 playtest，既有 test 命令保留", () => {
    const contract = schemeContract();
    expect(playtests(contract)).toHaveLength(0);
    expect(
      contract.verification_spec.commands.map((c) => c.alias),
    ).toContain("test");
  });

  it("PW-03：scheme.references 非空且方案已带 playtest → 恰好 1 条", () => {
    const scheme = emptySchemeDraft({
      title: "幂等方案",
      summary: "方案自带 playtest 命令",
      modules: ["module1"],
      references: [REF],
    });
    const plan = makeMinimalPlan(scheme.scheme_revision);
    plan.verification.commands = [
      {
        alias: "playtest",
        executable: "stagent",
        args: ["check", "playtest", "contract_forged"],
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
      {
        alias: "test",
        executable: "npm",
        args: ["test"],
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
    ];
    const contract = buildConfirmContractFromScopePlan(scheme, plan);
    const cmds = playtests(contract);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.args[2]).toBe(contract.contract_id);
  });
});
