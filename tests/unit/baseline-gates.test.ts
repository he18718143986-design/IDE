/**
 * TASK-J.28 / TASK-J.29 / TASK-J.30：固定底线硬门禁接线，八项既有检查体，
 * 以及 baseline-safety-secrets 去桩后的固定样本退出码。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCheckCommand } from "../../bin/stagent";
import {
  BASELINE_GATE_PLAIN,
  BASELINE_SECRETS_ALIAS,
  DESTUBBED_BASELINE_GATE_ALIASES,
  REQUIRED_BASELINE_GATES,
  evaluateBaselineGateResults,
  injectBaselineGateCommands,
  isBaselineGateAlias,
  runBaselineGateBody,
} from "../../daemon/guard/baseline-gates";
import { withSystemScope } from "../../daemon/supervisor/scope-plan-builder";
import { deriveCanMerge } from "../../src/lib/evidence.schema";
import {
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";

function minimalPlan(): ScopePlan {
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
  };
  plan.plan_digest = scopePlanDigest(plan);
  return plan;
}

function passingResults() {
  return REQUIRED_BASELINE_GATES.map((gate) => ({
    alias: gate.alias,
    exitCode: 0,
    passed: true,
  }));
}

describe("TASK-J.28 固定底线登记表", () => {
  it("覆盖安全、回滚、关键路径三类，且别名互不重复", () => {
    const categories = new Set(REQUIRED_BASELINE_GATES.map((g) => g.category));
    expect(categories).toEqual(
      new Set(["safety", "rollback", "critical_path"]),
    );
    expect(
      REQUIRED_BASELINE_GATES.filter((g) => g.category === "safety"),
    ).toHaveLength(3);
    expect(
      REQUIRED_BASELINE_GATES.filter((g) => g.category === "rollback"),
    ).toHaveLength(3);
    expect(
      REQUIRED_BASELINE_GATES.filter((g) => g.category === "critical_path"),
    ).toHaveLength(3);
    const aliases = REQUIRED_BASELINE_GATES.map((g) => g.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases.every((alias) => isBaselineGateAlias(alias))).toBe(true);
    expect(isBaselineGateAlias("check-knowledge")).toBe(false);
  });
});

describe("TASK-J.28 命令注入", () => {
  it("空清单会补齐全部底线命令，且不覆盖已有同名别名", () => {
    const injected = injectBaselineGateCommands([]);
    expect(injected.map((c) => c.alias)).toEqual(
      REQUIRED_BASELINE_GATES.map((g) => g.alias),
    );
    expect(
      injected.every(
        (c) =>
          c.executable === "stagent" &&
          c.args[0] === "check" &&
          c.args[1] === "baseline-gate" &&
          c.args.includes("--id") &&
          c.expected_exit_code === 0,
      ),
    ).toBe(true);

    const existing = {
      alias: "baseline-safety-writable-scope",
      executable: "stagent",
      args: [
        "check",
        "baseline-gate",
        "--id",
        "baseline-safety-writable-scope",
      ],
      expected_exit_code: 0,
      timeout_seconds: 30,
    };
    const again = injectBaselineGateCommands([existing]);
    const match = again.filter(
      (c) => c.alias === "baseline-safety-writable-scope",
    );
    expect(match).toHaveLength(1);
    expect(match[0]?.timeout_seconds).toBe(30);
  });
});

describe("TASK-J.28 stagent check baseline-gate 命令", () => {
  it("baseline-safety-secrets 已去桩：默认自检 0，干净样本 0，夹带固定样本非 0", () => {
    const result = runCheckCommand([
      "baseline-gate",
      "--id",
      BASELINE_SECRETS_ALIAS,
    ]);
    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout) as {
      ok: boolean;
      stub: boolean;
      body: string;
      id: string;
    };
    expect(body.ok).toBe(true);
    expect(body.stub).toBe(false);
    expect(body.body).toBe("TASK-J.30");
    expect(body.id).toBe(BASELINE_SECRETS_ALIAS);

    const clean = runCheckCommand([
      "baseline-gate",
      "--id",
      BASELINE_SECRETS_ALIAS,
      "--sample",
      "clean",
    ]);
    expect(clean.exitCode).toBe(0);
    expect(JSON.parse(clean.stdout).stub).toBe(false);

    const violating = runCheckCommand([
      "baseline-gate",
      "--id",
      BASELINE_SECRETS_ALIAS,
      "--sample",
      "violating",
    ]);
    expect(violating.exitCode).not.toBe(0);
    const violatingBody = JSON.parse(violating.stdout) as {
      ok: boolean;
      stub: boolean;
      body: string;
      reason?: string;
    };
    expect(violatingBody.ok).toBe(false);
    expect(violatingBody.stub).toBe(false);
    expect(violatingBody.body).toBe("TASK-J.30");
    expect(violatingBody.reason).toBe("E_VAULT_SECRET_IN_CONTEXT");
  });

  it("可用 --exit 强制非 0，用于测 fail-closed；未知 id 或缺 id 也非 0", () => {
    const alias = REQUIRED_BASELINE_GATES[0]!.alias;
    const forced = runCheckCommand([
      "baseline-gate",
      "--id",
      alias,
      "--exit",
      "1",
    ]);
    expect(forced.exitCode).toBe(1);
    expect(JSON.parse(forced.stdout).ok).toBe(false);

    const unknown = runCheckCommand(["baseline-gate", "--id", "not-a-gate"]);
    expect(unknown.exitCode).toBe(1);
    const missing = runCheckCommand(["baseline-gate"]);
    expect(missing.exitCode).toBe(1);
  });
});

describe("TASK-J.28 evaluateBaselineGateResults fail-closed", () => {
  it("全部退出码 0 才通过；缺项、未跑或非 0 即失败，且不接受 LLM 输入", () => {
    expect(evaluateBaselineGateResults(passingResults()).ok).toBe(true);

    const missingOne = passingResults().slice(1);
    const missing = evaluateBaselineGateResults(missingOne);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("missing");
      expect(missing.alias).toBe(REQUIRED_BASELINE_GATES[0]!.alias);
    }

    const nonzero = passingResults();
    nonzero[2] = { ...nonzero[2]!, exitCode: 1, passed: false };
    const failed = evaluateBaselineGateResults(nonzero);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.reason).toBe("nonzero");
      expect(failed.alias).toBe(REQUIRED_BASELINE_GATES[2]!.alias);
    }

    const passedLie = passingResults();
    passedLie[1] = { ...passedLie[1]!, exitCode: 0, passed: false };
    const lie = evaluateBaselineGateResults(passedLie);
    expect(lie.ok).toBe(false);

    expect(evaluateBaselineGateResults).toHaveLength(1);
  });

  it("底线未通过时 deriveCanMerge 在 status 非 PASSED 下为 false，且函数签名未改", () => {
    const blocked = evaluateBaselineGateResults([]);
    expect(blocked.ok).toBe(false);
    const status = blocked.ok ? "PASSED" : "FAILED";
    expect(
      deriveCanMerge({
        status,
        scopePassed: true,
        budgetExhausted: false,
        forbiddenViolationCount: 0,
      }),
    ).toBe(false);
    expect(deriveCanMerge.length).toBe(1);
  });
});

describe("TASK-J.28 withSystemScope 始终注入底线命令", () => {
  it("无 auto 条目且无知识库时仍注入全部别名，并关闭 manual_only", () => {
    const base = minimalPlan();
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "j28-none-"));
    try {
      const next = withSystemScope(base, {
        repoRoot: emptyRoot,
        scheme: {
          scheme_revision: 1,
          title: "试玩",
          summary: "无自动验收",
          modules: [],
          notes: "",
          acceptance: [{ id: "acc-p", text: "试玩", check: "playtest" }],
        },
      });
      expect(next).not.toBe(base);
      expect(next.plan_digest).not.toBe(base.plan_digest);
      expect(next.plan_digest).toBe(scopePlanDigest(next));
      const aliases = next.verification.commands.map((c) => c.alias);
      expect(aliases).toEqual(REQUIRED_BASELINE_GATES.map((g) => g.alias));
      expect(next.verification.manual_only).toBe(false);
      expect(next.verification.plain).toContain(BASELINE_GATE_PLAIN);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe("TASK-J.29 八项检查体", () => {
  it("J29-P1：写范围与测试完整性是真实检查体，干净样本 0、违规样本非 0", () => {
    for (const id of [
      "baseline-safety-writable-scope",
      "baseline-safety-test-integrity",
    ]) {
      const def = runCheckCommand(["baseline-gate", "--id", id]);
      expect(def.exitCode, id).toBe(0);
      const defBody = JSON.parse(def.stdout) as { stub: boolean; body: string };
      expect(defBody.stub).toBe(false);
      expect(defBody.body).toBe("TASK-J.29");

      const clean = runCheckCommand([
        "baseline-gate",
        "--id",
        id,
        "--sample",
        "clean",
      ]);
      expect(clean.exitCode, `${id} clean`).toBe(0);

      const violating = runCheckCommand([
        "baseline-gate",
        "--id",
        id,
        "--sample",
        "violating",
      ]);
      expect(violating.exitCode, `${id} violating`).not.toBe(0);
    }
  });

  it("J29-P2：三类回滚检查可执行，无上一个 LIVE 不得假装成功", () => {
    for (const id of [
      "baseline-rollback-auto",
      "baseline-rollback-manual",
      "baseline-rollback-no-live",
    ]) {
      const def = runCheckCommand(["baseline-gate", "--id", id]);
      expect(def.exitCode, id).toBe(0);
      expect(JSON.parse(def.stdout).stub).toBe(false);

      const clean = runCheckCommand([
        "baseline-gate",
        "--id",
        id,
        "--sample",
        "clean",
      ]);
      expect(clean.exitCode, `${id} clean`).toBe(0);

      const violating = runCheckCommand([
        "baseline-gate",
        "--id",
        id,
        "--sample",
        "violating",
      ]);
      expect(violating.exitCode, `${id} violating`).not.toBe(0);
    }

    const noLive = runBaselineGateBody("baseline-rollback-no-live", {
      sample: "violating",
    });
    expect(noLive.ok).toBe(false);
    expect(noLive.reason).toBe("E_RELEASE_NO_PREVIOUS");
  });

  it("J29-P3：退出码路径、主线回归与知识库漂移复用既有检查", () => {
    for (const id of [
      "baseline-path-exit-codes",
      "baseline-path-mainline-regression",
      "baseline-path-knowledge",
    ]) {
      const def = runCheckCommand(["baseline-gate", "--id", id]);
      expect(def.exitCode, id).toBe(0);
      expect(JSON.parse(def.stdout).stub).toBe(false);

      const clean = runCheckCommand([
        "baseline-gate",
        "--id",
        id,
        "--sample",
        "clean",
      ]);
      expect(clean.exitCode, `${id} clean`).toBe(0);

      const violating = runCheckCommand([
        "baseline-gate",
        "--id",
        id,
        "--sample",
        "violating",
      ]);
      expect(violating.exitCode, `${id} violating`).not.toBe(0);
    }
  });

  it("J29-P4：九项全 0 且其它门禁通过时才可能 can_merge=true；secrets 已去桩；LLM 不能单独置真", () => {
    expect(DESTUBBED_BASELINE_GATE_ALIASES).toHaveLength(9);
    for (const id of DESTUBBED_BASELINE_GATE_ALIASES) {
      expect(runCheckCommand(["baseline-gate", "--id", id]).exitCode, id).toBe(
        0,
      );
    }
    const secrets = runCheckCommand([
      "baseline-gate",
      "--id",
      BASELINE_SECRETS_ALIAS,
    ]);
    expect(secrets.exitCode).toBe(0);
    expect(JSON.parse(secrets.stdout).stub).toBe(false);
    expect(JSON.parse(secrets.stdout).body).toBe("TASK-J.30");

    const allPassing = evaluateBaselineGateResults(
      REQUIRED_BASELINE_GATES.map((gate) => ({
        alias: gate.alias,
        exitCode: 0,
        passed: true,
      })),
    );
    expect(allPassing.ok).toBe(true);
    expect(
      deriveCanMerge({
        status: "PASSED",
        scopePassed: true,
        budgetExhausted: false,
        forbiddenViolationCount: 0,
      }),
    ).toBe(true);

    const oneFailed = REQUIRED_BASELINE_GATES.map((gate) => ({
      alias: gate.alias,
      exitCode: gate.alias === "baseline-safety-writable-scope" ? 1 : 0,
      passed: gate.alias !== "baseline-safety-writable-scope",
    }));
    const blocked = evaluateBaselineGateResults(oneFailed);
    expect(blocked.ok).toBe(false);
    expect(
      deriveCanMerge({
        status: blocked.ok ? "PASSED" : "FAILED",
        scopePassed: true,
        budgetExhausted: false,
        forbiddenViolationCount: 0,
      }),
    ).toBe(false);
    expect(deriveCanMerge.length).toBe(1);
  });

  it("J29-P5：没有第二套 deriveCanMerge，九项均非新子系统桩", () => {
    expect(DESTUBBED_BASELINE_GATE_ALIASES).toEqual([
      "baseline-safety-writable-scope",
      "baseline-safety-test-integrity",
      "baseline-safety-secrets",
      "baseline-rollback-auto",
      "baseline-rollback-manual",
      "baseline-rollback-no-live",
      "baseline-path-exit-codes",
      "baseline-path-mainline-regression",
      "baseline-path-knowledge",
    ]);
    for (const id of DESTUBBED_BASELINE_GATE_ALIASES) {
      const body = runBaselineGateBody(id);
      expect(body.stub, id).toBe(false);
      expect(body.body, id).toBe(
        id === BASELINE_SECRETS_ALIAS ? "TASK-J.30" : "TASK-J.29",
      );
      expect(body.ok, id).toBe(true);
    }
    expect(deriveCanMerge.length).toBe(1);
  });
});
