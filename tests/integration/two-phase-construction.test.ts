/**
 * TASK-L.4 / verification-strategy §3.2：先红后绿两段式施工集成测（桩 Worker）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import {
  ScopedWorktreeGateway,
  type PhaseOverlay,
} from "../../daemon/mcp/gateway";
import {
  buildIPhaseOverlay,
  buildTPhaseOverlay,
  evaluatePhaseCheck,
  nextIGreenFailAction,
  obligationChecksExtras,
  shouldRunTwoPhase,
  waiverPlainMessages,
  writeSuspension,
  type IGreenFailState,
} from "../../daemon/pipeline/two-phase";
import { runTwoPhaseConstruction } from "../../daemon/pipeline/two-phase-runner";
import { runCheckCommand } from "../../bin/stagent";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import type { TestObligation } from "../../src/lib/verification/obligations";
import { renderChecksSection } from "../../daemon/worker/session-task-injector";

function makeContract(opts: {
  writablePaths?: string[];
  acceptanceRefs?: Array<{
    id: string;
    text: string;
    check: "auto" | "playtest" | "both";
  }>;
  maxVerificationRetries?: number;
} = {}) {
  const refs = opts.acceptanceRefs ?? [
    { id: "ac-login", text: "登录成功", check: "auto" as const },
  ];
  const draft = createContractDraft({
    title: "L.4 两段式",
    description: "先红后绿",
    acceptanceCriteria: ["义务测试先红后绿"],
    writablePaths: opts.writablePaths ?? ["src/**", "tests/**"],
    readonlyPaths: ["docs/**"],
    strictlyForbiddenPaths: [".env*"],
    maxVerificationRetries: opts.maxVerificationRetries ?? 5,
    supervisorMetadata: {
      suggestion_id: "scheme:l4-test",
      acceptance_refs: refs,
      scheme_item_ids: refs.map((r) => r.id),
      stub_id: null,
    },
  });

  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });
}

function report(kind: "red" | "green" | "red_invalid"): unknown {
  if (kind === "red") {
    return {
      schema: "stagent-obligation-report-v1",
      test_count: 1,
      assertion_failures: 1,
      collection_or_compile_errors: 0,
    };
  }
  if (kind === "green") {
    return {
      schema: "stagent-obligation-report-v1",
      test_count: 1,
      assertion_failures: 0,
      collection_or_compile_errors: 0,
    };
  }
  return {
    schema: "stagent-obligation-report-v1",
    test_count: 0,
    assertion_failures: 0,
    collection_or_compile_errors: 1,
  };
}

async function writeViaGateway(
  gw: ScopedWorktreeGateway,
  rel: string,
  content: string,
) {
  return gw.callTool("stagent_write_file", { path: rel, content });
}

describe("TASK-L.4 两段式施工", () => {
  let repoRoot: string;
  let worktree: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l4-repo-"));
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l4-wt-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.mkdirSync(path.join(worktree, "tests", "stagent"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".git"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".stagent"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, ".stagent", "records"), {
      recursive: true,
    });
    // 既有未列义务的测试文件
    fs.writeFileSync(
      path.join(worktree, "tests", "legacy.test.ts"),
      "export {};\n",
      "utf8",
    );
  });

  afterEach(() => {
    safeRmSync(repoRoot);
    safeRmSync(worktree);
  });

  const obligation: TestObligation = {
    acceptance_id: "ac-login",
    test_path: "tests/stagent/ac-login.test.ts",
    level: "unit",
  };

  it("T 段写基线失败测试 → 进 I；T 段写实现文件被拒", async () => {
    const contract = makeContract();
    const tOverlay = buildTPhaseOverlay(
      [obligation.test_path],
      contract.authorization.file_system_scope.writable_paths,
    );
    const gw = new ScopedWorktreeGateway(worktree, contract, {
      phaseOverlay: tOverlay,
    });

    const testWrite = await writeViaGateway(
      gw,
      obligation.test_path,
      "import { expect, it } from 'vitest';\nit('red', () => expect(1).toBe(2));\n",
    );
    expect(testWrite.isError).toBeFalsy();

    const implWrite = await writeViaGateway(
      gw,
      "src/login.ts",
      "export const ok = true;\n",
    );
    expect(implWrite.isError).toBe(true);

    // 桩报告为红 → 进入 I
    const result = await runTwoPhaseConstruction(
      {
        contract,
        repoRoot,
        buildGateway: (overlay) =>
          new ScopedWorktreeGateway(worktree, contract, {
            ...(overlay === undefined ? {} : { phaseOverlay: overlay }),
          }),
      },
      {
        obligations: [obligation],
        runT: async (gateway) => {
          await writeViaGateway(
            gateway,
            obligation.test_path,
            "it('x', () => expect(false).toBe(true));\n",
          );
        },
        runI: async (gateway) => {
          await writeViaGateway(
            gateway,
            "src/login.ts",
            "export const ok = true;\n",
          );
        },
        readObligationReport: (phase) =>
          phase === "t" ? report("red") : report("green"),
      },
    );
    expect(result.phase).toBe("two_phase");
    expect(result.can_merge).toBe(true);
    expect(result.obligations[0]?.green?.exit_code).toBe(0);
  });

  it("T 段语法错误 → OBLIGATION_RED_INVALID，返工计数 +1", async () => {
    const contract = makeContract({ maxVerificationRetries: 5 });
    let tCalls = 0;
    const result = await runTwoPhaseConstruction(
      {
        contract,
        repoRoot,
        buildGateway: (overlay) =>
          new ScopedWorktreeGateway(worktree, contract, {
            ...(overlay === undefined ? {} : { phaseOverlay: overlay }),
          }),
      },
      {
        obligations: [obligation],
        runT: async () => {
          tCalls += 1;
        },
        runI: async () => {},
        readObligationReport: (phase) => {
          if (phase === "t") {
            // 第一次 invalid，第二次 red
            return tCalls <= 1 ? report("red_invalid") : report("red");
          }
          return report("green");
        },
      },
    );
    expect(tCalls).toBeGreaterThanOrEqual(2);
    expect(result.reason_codes).toContain("OBLIGATION_RED_INVALID");
    expect(result.can_merge).toBe(true);
  });

  it("T 段测试在基线上通过 → OBLIGATION_NOT_RED", async () => {
    const contract = makeContract({ maxVerificationRetries: 0 });
    const result = await runTwoPhaseConstruction(
      {
        contract,
        repoRoot,
        buildGateway: (overlay) =>
          new ScopedWorktreeGateway(worktree, contract, {
            ...(overlay === undefined ? {} : { phaseOverlay: overlay }),
          }),
      },
      {
        obligations: [obligation],
        runT: async () => {},
        runI: async () => {},
        readObligationReport: () => report("green"), // T 期望红却绿
      },
    );
    expect(result.suspended).toBe(true);
    expect(result.reason_codes).toContain("OBLIGATION_NOT_RED");
    expect(result.can_merge).toBe(false);
  });

  it("I 段写 T 段测试或未列既有测试 → 网关拒绝", async () => {
    const contract = makeContract();
    // 模拟 T 已写义务测试
    fs.writeFileSync(
      path.join(worktree, obligation.test_path),
      "export {};\n",
      "utf8",
    );
    const iOverlay = buildIPhaseOverlay([obligation.test_path]);
    const gw = new ScopedWorktreeGateway(worktree, contract, {
      phaseOverlay: iOverlay,
    });

    const touchObligation = await writeViaGateway(
      gw,
      obligation.test_path,
      "export const weakened = true;\n",
    );
    expect(touchObligation.isError).toBe(true);

    const touchLegacy = await writeViaGateway(
      gw,
      "tests/legacy.test.ts",
      "export const skip = true;\n",
    );
    expect(touchLegacy.isError).toBe(true);

    // 实现文件仍可写
    const impl = await writeViaGateway(
      gw,
      "src/login.ts",
      "export const ok = 1;\n",
    );
    expect(impl.isError).toBeFalsy();
  });

  it("I 段实现后判绿 → green.exit_code===0 且 can_merge", async () => {
    const contract = makeContract();
    const result = await runTwoPhaseConstruction(
      {
        contract,
        repoRoot,
        buildGateway: (overlay) =>
          new ScopedWorktreeGateway(worktree, contract, {
            ...(overlay === undefined ? {} : { phaseOverlay: overlay }),
          }),
      },
      {
        obligations: [obligation],
        runT: async (gateway) => {
          await writeViaGateway(
            gateway,
            obligation.test_path,
            "it('fails', () => { throw new Error('red'); });\n",
          );
        },
        runI: async (gateway) => {
          await writeViaGateway(
            gateway,
            "src/app.ts",
            "export function app() { return true; }\n",
          );
        },
        readObligationReport: (phase) =>
          phase === "t" ? report("red") : report("green"),
        afterIVerify: async () => ({ can_merge: true }),
      },
    );
    expect(result.obligations[0]?.green?.exit_code).toBe(0);
    expect(result.can_merge).toBe(true);
  });

  it("I 段连续 2 次判绿失败 → 回到 T 段一次", async () => {
    const contract = makeContract({ maxVerificationRetries: 10 });
    let tCalls = 0;
    let iCalls = 0;
    const result = await runTwoPhaseConstruction(
      {
        contract,
        repoRoot,
        buildGateway: (overlay) =>
          new ScopedWorktreeGateway(worktree, contract, {
            ...(overlay === undefined ? {} : { phaseOverlay: overlay }),
          }),
      },
      {
        obligations: [obligation],
        runT: async () => {
          tCalls += 1;
        },
        runI: async () => {
          iCalls += 1;
        },
        readObligationReport: (phase) => {
          if (phase === "t") return report("red");
          // 前两次 I 失败，第三次（回 T 后）成功
          if (iCalls <= 2) return report("red"); // not green
          return report("green");
        },
      },
    );
    expect(tCalls).toBe(2); // 初次 + 回 T
    expect(iCalls).toBeGreaterThanOrEqual(3);
    expect(result.returned_to_t).toBe(true);
    expect(result.can_merge).toBe(true);
  });

  it("全部豁免 → 只运行一段，与 happy-path 一致", async () => {
    const contract = makeContract({
      acceptanceRefs: [
        { id: "ac-manual", text: "靠试玩", check: "playtest" },
      ],
    });
    let tCalls = 0;
    let iCalls = 0;
    const result = await runTwoPhaseConstruction(
      {
        contract,
        repoRoot,
        buildGateway: (overlay) =>
          new ScopedWorktreeGateway(worktree, contract, {
            ...(overlay === undefined ? {} : { phaseOverlay: overlay }),
          }),
      },
      {
        obligations: [], // 全部豁免 / 无 auto
        waived: [{ acceptance_id: "ac-manual", reason: "no_runner" }],
        runT: async () => {
          tCalls += 1;
        },
        runI: async () => {
          iCalls += 1;
        },
        readObligationReport: () => report("green"),
      },
    );
    expect(result.phase).toBe("single");
    expect(tCalls).toBe(0);
    expect(iCalls).toBe(1);
    expect(result.can_merge).toBe(true);
    expect(result.plain_waivers?.length).toBeGreaterThan(0);
  });

  it("收窄不持久化进合同；CLI --phase t|i 期望正确", () => {
    const contract = makeContract();
    const before = JSON.stringify(contract.authorization.file_system_scope);
    const overlay: PhaseOverlay = {
      testWriteAllowlist: [obligation.test_path],
      extraForbidden: ["src/**"],
    };
    const gw = new ScopedWorktreeGateway(worktree, contract, {
      phaseOverlay: overlay,
    });
    gw.setPhaseOverlay(buildIPhaseOverlay([obligation.test_path]));
    const after = JSON.stringify(contract.authorization.file_system_scope);
    expect(after).toBe(before);

    const tmp = path.join(repoRoot, "rep.json");
    fs.writeFileSync(tmp, JSON.stringify(report("red")), "utf8");
    const t = runCheckCommand([
      "obligations",
      "--report",
      tmp,
      "--phase",
      "t",
    ]);
    expect(t.exitCode).toBe(0);
    expect(JSON.parse(t.stdout).classification).toBe("red");

    fs.writeFileSync(tmp, JSON.stringify(report("green")), "utf8");
    const iOk = runCheckCommand([
      "obligations",
      "--report",
      tmp,
      "--phase",
      "i",
    ]);
    expect(iOk.exitCode).toBe(0);

    fs.writeFileSync(tmp, JSON.stringify(report("red")), "utf8");
    const iFail = runCheckCommand([
      "obligations",
      "--report",
      tmp,
      "--phase",
      "i",
    ]);
    expect(iFail.exitCode).toBe(1);
    expect(JSON.parse(iFail.stdout).reason_code).toBe("OBLIGATION_NOT_GREEN");
  });

  it("renderChecksSection extras 追加本段义务清单", () => {
    const contract = makeContract();
    const extras = obligationChecksExtras("t", [obligation]);
    const section = renderChecksSection(contract, extras);
    expect(section.body).toContain("本段（T · 先写测试）义务");
    expect(section.body).toContain("ac-login");
  });

  it("helpers：shouldRunTwoPhase / nextIGreenFailAction / evaluatePhaseCheck", () => {
    expect(shouldRunTwoPhase([])).toBe(false);
    expect(shouldRunTwoPhase([obligation])).toBe(true);

    const state: IGreenFailState = {
      consecutiveFailures: 2,
      returnedToT: false,
    };
    expect(nextIGreenFailAction(state)).toBe("return_to_t");
    expect(
      nextIGreenFailAction({ consecutiveFailures: 2, returnedToT: true }),
    ).toBe("suspend");

    expect(evaluatePhaseCheck("t", "red").ok).toBe(true);
    expect(evaluatePhaseCheck("t", "green").ok).toBe(false);
    expect(evaluatePhaseCheck("i", "green").ok).toBe(true);

    const msgs = waiverPlainMessages([
      { acceptance_id: "ac-x", reason: "no_runner" },
    ]);
    expect(msgs[0]).toContain("ac-x");

    const sus = writeSuspension(repoRoot, "c-1", {
      reason: "OBLIGATION_NOT_GREEN",
      phase: "i",
    });
    expect(fs.existsSync(sus)).toBe(true);
  });
});
