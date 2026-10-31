/**
 * TASK-L.4：两段式施工编排（先红后绿）。
 *
 * 与 PipelineOrchestrator 解耦：集成测可注入桩 Worker / 桩报告；
 * 生产路径由 orchestrator.runTwoPhase 装配网关与状态迁移。
 */

import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  classifyRun,
  deriveObligations,
  detectRunner,
  repoFactsFromPackageJson,
  type ObligationRunClass,
  type TestObligation,
} from "../../src/lib/verification/obligations";
import type { ScopedWorktreeGateway } from "../mcp/gateway";
import type { PhaseOverlay } from "../mcp/gateway";
import {
  buildIPhaseOverlay,
  buildTPhaseOverlay,
  evaluatePhaseCheck,
  nextIGreenFailAction,
  obligationChecksExtras,
  shouldRunTwoPhase,
  tPhaseLockedPaths,
  waiverPlainMessages,
  writeSuspension,
  type IGreenFailState,
} from "./two-phase";

export interface TwoPhaseHost {
  contract: SoftwareContract;
  repoRoot: string;
  /** 按 overlay 构造网关（每次 T/I 尝试可新建） */
  buildGateway: (overlay: PhaseOverlay | undefined) => ScopedWorktreeGateway;
  /** 可选：状态机挂起 */
  transitionPendingResume?: (reason: string, detail: string) => void;
  /** 可选：T 段结束后记 red_sha（默认 unknown） */
  commitRedSha?: (gateway: ScopedWorktreeGateway) => Promise<string>;
}

export interface TwoPhaseHooks {
  /** T 段 Worker：网关已设 T overlay；应只写义务测试 */
  runT: (gateway: ScopedWorktreeGateway, extras: string[]) => Promise<void>;
  /** I 段 Worker：网关已设 I overlay */
  runI: (gateway: ScopedWorktreeGateway, extras: string[]) => Promise<void>;
  /**
   * 读义务运行报告（JSON）。缺省时尝试读
   * `.stagent/records/<id>/obligation-report.json`。
   */
  readObligationReport?: (phase: "t" | "i") => unknown;
  /** 覆盖派生义务（集成测） */
  obligations?: TestObligation[];
  waived?: Array<{ acceptance_id: string; reason: "no_runner" }>;
  /**
   * I 段后是否视为验证通过（can_merge）。
   * 缺省：phase i 义务判绿即为 true。
   */
  afterIVerify?: (gateway: ScopedWorktreeGateway) => Promise<{
    can_merge: boolean;
    evidence?: Record<string, unknown>;
  }>;
  /**
   * 网关建好后、Worker 跑前的钩子（集成测可在此证明 I 段拒改测试）。
   * 生产路径不传。
   */
  afterGatewayBuilt?: (
    phase: "t" | "i" | "single",
    gateway: ScopedWorktreeGateway,
  ) => void | Promise<void>;
}

export interface TwoPhaseResult {
  phase: "single" | "two_phase";
  can_merge: boolean;
  red_sha?: string;
  plain_waivers?: string[];
  returned_to_t?: boolean;
  suspended?: boolean;
  suspension_path?: string;
  t_attempts: number;
  i_attempts: number;
  obligations: Array<{
    acceptance_id: string;
    test_path: string;
    red?: { classification: ObligationRunClass };
    green?: { exit_code: number; classification: ObligationRunClass };
  }>;
  reason_codes: string[];
}

function deriveFromRepo(
  contract: SoftwareContract,
  repoRoot: string,
): {
  obligations: TestObligation[];
  waived: Array<{ acceptance_id: string; reason: "no_runner" }>;
} {
  let facts: ReturnType<typeof repoFactsFromPackageJson> = {};
  try {
    const pkgPath = path.join(repoRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      facts = repoFactsFromPackageJson(raw);
    }
  } catch {
    facts = {};
  }
  const runner = detectRunner(facts);
  return deriveObligations(contract, runner);
}

function defaultReportPath(
  repoRoot: string,
  contractId: string,
  phase: "t" | "i",
): string {
  return path.join(
    repoRoot,
    ".stagent",
    "records",
    contractId,
    `obligation-report-${phase}.json`,
  );
}

function readReport(
  host: TwoPhaseHost,
  hooks: TwoPhaseHooks,
  phase: "t" | "i",
): unknown {
  if (hooks.readObligationReport) {
    return hooks.readObligationReport(phase);
  }
  const p = defaultReportPath(host.repoRoot, host.contract.contract_id, phase);
  if (!fs.existsSync(p)) {
    throw new Error(`obligation report missing: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * 两段式主循环。
 *
 * 重试预算：T 段 red_invalid / not_red 计入 max_verification_retries；
 * I 段判绿失败连续 2 次 → 回 T 一次；再连续 2 次失败 → PENDING_RESUME。
 */
export async function runTwoPhaseConstruction(
  host: TwoPhaseHost,
  hooks: TwoPhaseHooks,
): Promise<TwoPhaseResult> {
  const contract = host.contract;
  const maxRetries =
    contract.authorization.budget_limits.max_verification_retries;

  const derived =
    hooks.obligations !== undefined
      ? {
          obligations: hooks.obligations,
          waived: hooks.waived ?? [],
        }
      : deriveFromRepo(contract, host.repoRoot);

  const plain_waivers = waiverPlainMessages(derived.waived);
  const reason_codes: string[] = [];

  if (!shouldRunTwoPhase(derived.obligations)) {
    const gateway = host.buildGateway(undefined);
    await hooks.afterGatewayBuilt?.("single", gateway);
    await hooks.runI(gateway, []);
    const verify = hooks.afterIVerify
      ? await hooks.afterIVerify(gateway)
      : { can_merge: true };
    return {
      phase: "single",
      can_merge: verify.can_merge,
      ...(plain_waivers.length > 0 ? { plain_waivers } : {}),
      t_attempts: 0,
      i_attempts: 1,
      obligations: [],
      reason_codes,
    };
  }

  const obligationPaths = derived.obligations.map((o) => o.test_path);
  const writable = contract.authorization.file_system_scope.writable_paths;
  const obligationEvidence: TwoPhaseResult["obligations"] =
    derived.obligations.map((o) => ({
      acceptance_id: o.acceptance_id,
      test_path: o.test_path,
    }));

  let returnedToT = false;
  let iFailState: IGreenFailState = {
    consecutiveFailures: 0,
    returnedToT: false,
  };
  let redSha: string | undefined;
  let tWritten: string[] = [];
  let tAttempts = 0;
  let iAttempts = 0;
  let verificationRetries = 0;

  // 外层：可能回 T 一次（cycle 0 初次；cycle 1 回 T 后再走一遍）
  for (let cycle = 0; cycle < 2; cycle += 1) {
    // ----- T 段：直到判红或耗尽重试 -----
    let tPassed = false;
    while (!tPassed) {
      tAttempts += 1;
      const tOverlay = buildTPhaseOverlay(obligationPaths, writable);
      const gateway = host.buildGateway(tOverlay);
      await hooks.afterGatewayBuilt?.("t", gateway);
      const extras = obligationChecksExtras("t", derived.obligations);
      await hooks.runT(gateway, extras);
      tWritten = tPhaseLockedPaths([...gateway.getModifiedFiles()]);

      if (host.commitRedSha) {
        redSha = await host.commitRedSha(gateway);
      } else {
        redSha = "unknown";
      }

      const report = readReport(host, hooks, "t");
      const classification = classifyRun(report);
      const verdict = evaluatePhaseCheck("t", classification);

      for (const ev of obligationEvidence) {
        ev.red = { classification };
      }

      if (verdict.ok) {
        tPassed = true;
        break;
      }

      reason_codes.push(verdict.reason_code);
      verificationRetries += 1;
      if (verificationRetries > maxRetries) {
        const suspension_path = writeSuspension(
          host.repoRoot,
          contract.contract_id,
          {
            reason: verdict.reason_code,
            phase: "t",
            detail: `T-phase failed after ${verificationRetries} verification retries`,
            i_green_failures: iFailState.consecutiveFailures,
            returned_to_t: returnedToT,
          },
        );
        host.transitionPendingResume?.(
          verdict.reason_code,
          `T-phase exhausted retries`,
        );
        return {
          phase: "two_phase",
          can_merge: false,
          ...(redSha === undefined ? {} : { red_sha: redSha }),
          ...(plain_waivers.length > 0 ? { plain_waivers } : {}),
          returned_to_t: returnedToT,
          suspended: true,
          suspension_path,
          t_attempts: tAttempts,
          i_attempts: iAttempts,
          obligations: obligationEvidence,
          reason_codes,
        };
      }
    }

    // ----- I 段 -----
    // 重置本轮 I 连续失败（回 T 后重新计）
    iFailState = {
      consecutiveFailures: 0,
      returnedToT: returnedToT,
    };

    let iDone = false;
    while (!iDone) {
      iAttempts += 1;
      const iOverlay = buildIPhaseOverlay(tWritten);
      const gateway = host.buildGateway(iOverlay);
      // 若网关支持热切换：
      if (typeof gateway.setPhaseOverlay === "function") {
        gateway.setPhaseOverlay(iOverlay);
      }
      await hooks.afterGatewayBuilt?.("i", gateway);
      const extras = obligationChecksExtras("i", derived.obligations);
      await hooks.runI(gateway, extras);

      const report = readReport(host, hooks, "i");
      const classification = classifyRun(report);
      const verdict = evaluatePhaseCheck("i", classification);

      for (const ev of obligationEvidence) {
        ev.green = {
          classification,
          exit_code: classification === "green" ? 0 : 1,
        };
      }

      if (verdict.ok) {
        const verify = hooks.afterIVerify
          ? await hooks.afterIVerify(gateway)
          : { can_merge: true };
        return {
          phase: "two_phase",
          can_merge: verify.can_merge,
          ...(redSha === undefined ? {} : { red_sha: redSha }),
          ...(plain_waivers.length > 0 ? { plain_waivers } : {}),
          returned_to_t: returnedToT,
          t_attempts: tAttempts,
          i_attempts: iAttempts,
          obligations: obligationEvidence,
          reason_codes,
        };
      }

      reason_codes.push(verdict.reason_code);
      iFailState.consecutiveFailures += 1;
      verificationRetries += 1;

      const action = nextIGreenFailAction(iFailState);
      if (action === "return_to_t") {
        returnedToT = true;
        iFailState.returnedToT = true;
        // 跳出 I，外层 cycle+1 再跑 T
        iDone = true;
        break;
      }
      if (action === "suspend") {
        const suspension_path = writeSuspension(host.repoRoot, contract.contract_id, {
          reason: "OBLIGATION_NOT_GREEN",
          phase: "two_phase",
          detail:
            "I-phase green check failed twice after returning to T once",
          i_green_failures: iFailState.consecutiveFailures,
          returned_to_t: true,
        });
        host.transitionPendingResume?.(
          "OBLIGATION_NOT_GREEN",
          "exhausted return-to-T",
        );
        return {
          phase: "two_phase",
          can_merge: false,
          ...(redSha === undefined ? {} : { red_sha: redSha }),
          ...(plain_waivers.length > 0 ? { plain_waivers } : {}),
          returned_to_t: true,
          suspended: true,
          suspension_path,
          t_attempts: tAttempts,
          i_attempts: iAttempts,
          obligations: obligationEvidence,
          reason_codes,
        };
      }

      // continue_i：仍在 I 段返工
      if (verificationRetries > maxRetries) {
        const suspension_path = writeSuspension(host.repoRoot, contract.contract_id, {
          reason: verdict.reason_code,
          phase: "i",
          detail: `I-phase failed after ${verificationRetries} verification retries`,
          i_green_failures: iFailState.consecutiveFailures,
          returned_to_t: returnedToT,
        });
        host.transitionPendingResume?.(
          verdict.reason_code,
          "I-phase exhausted retries",
        );
        return {
          phase: "two_phase",
          can_merge: false,
          ...(redSha === undefined ? {} : { red_sha: redSha }),
          ...(plain_waivers.length > 0 ? { plain_waivers } : {}),
          returned_to_t: returnedToT,
          suspended: true,
          suspension_path,
          t_attempts: tAttempts,
          i_attempts: iAttempts,
          obligations: obligationEvidence,
          reason_codes,
        };
      }
    }

    // 若 I 因 return_to_t 结束，继续外层；否则不应到此
    if (!returnedToT || cycle >= 1) {
      break;
    }
  }

  const suspension_path = writeSuspension(host.repoRoot, contract.contract_id, {
    reason: "OBLIGATION_NOT_GREEN",
    phase: "two_phase",
    detail: "two-phase loop exited without merge",
    returned_to_t: returnedToT,
  });
  return {
    phase: "two_phase",
    can_merge: false,
    ...(redSha === undefined ? {} : { red_sha: redSha }),
    ...(plain_waivers.length > 0 ? { plain_waivers } : {}),
    returned_to_t: returnedToT,
    suspended: true,
    suspension_path,
    t_attempts: tAttempts,
    i_attempts: iAttempts,
    obligations: obligationEvidence,
    reason_codes,
  };
}
