/**
 * TASK-J.28 / TASK-J.29：固定底线清单登记、缺项 fail-closed，以及八项既有检查体。
 *
 * J.28 提供登记表、命令注入与写证据前的缺项判定。
 * J.29 把除 baseline-safety-secrets 外的八项从桩换成对既有函数的薄适配：
 * 用固定样本做机制自检（干净样本须通过、违规样本须失败），默认同时跑双向才退出 0。
 * baseline-safety-secrets 仍为桩，检查体留给 TASK-J.30。
 * can_merge 仍只经 deriveCanMerge 派生，本模块不写、不改其签名。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerificationCommand } from "../../src/lib/contract.schema";
import { detectTestWeakening } from "./test-integrity";
import { checkWriteAccess, type FileSystemScope } from "../../src/lib/scope";
import { deriveCanMerge } from "../../src/lib/evidence.schema";
import {
  canTransition,
  type ReleaseState,
} from "../../src/lib/release/release";
import {
  MAINLINE_NODES,
  REGRESSION_FINGERPRINT,
} from "../pipeline/mainline-regression";
import {
  coversPath,
  hasDependsOnCycle,
  type ModuleEntry,
} from "../../src/lib/knowledge/modules-schema";

export type BaselineGateCategory = "safety" | "rollback" | "critical_path";

export interface BaselineGate {
  readonly alias: string;
  readonly category: BaselineGateCategory;
  readonly title: string;
  readonly item: string;
}

/** J.27 §2.1 三类细项的登记表（别名为施工选定，检查体仍为桩）。 */
export const REQUIRED_BASELINE_GATES: readonly BaselineGate[] = [
  {
    alias: "baseline-safety-writable-scope",
    category: "safety",
    title: "写范围",
    item: "只允许改已被授权的路径（ScopePlan / writable_paths / 网关拦截）",
  },
  {
    alias: "baseline-safety-test-integrity",
    category: "safety",
    title: "测试完整性",
    item: "未经授权不得改测试来制造假绿",
  },
  {
    alias: "baseline-safety-secrets",
    category: "safety",
    title: "凭据与秘密",
    item: "凭据与秘密不得进入对话",
  },
  {
    alias: "baseline-rollback-auto",
    category: "rollback",
    title: "自动回滚",
    item: "发布探活失败且存在上一个 LIVE 时，自动回滚到上一个 LIVE",
  },
  {
    alias: "baseline-rollback-manual",
    category: "rollback",
    title: "手动回滚",
    item: "手动回滚 = 以上一个 LIVE 的 commit_sha 新建一次发布",
  },
  {
    alias: "baseline-rollback-no-live",
    category: "rollback",
    title: "无 LIVE 不得假装成功",
    item: "没有上一个 LIVE 时必须失败并告知，不得假装回滚成功",
  },
  {
    alias: "baseline-path-exit-codes",
    category: "critical_path",
    title: "退出码进入 can_merge",
    item: "V0～V3 必须以真实子进程退出码进入 deriveCanMerge",
  },
  {
    alias: "baseline-path-mainline-regression",
    category: "critical_path",
    title: "主线回归",
    item: "主线回归必须跑到",
  },
  {
    alias: "baseline-path-knowledge",
    category: "critical_path",
    title: "知识库漂移",
    item: "知识库漂移检查必须跑到",
  },
];

export const BASELINE_GATE_PLAIN =
  "固定底线清单检查必须全部跑到，缺项、未跑或退出码非 0 则不得 can_merge";

export function isBaselineGateAlias(alias: string): boolean {
  return REQUIRED_BASELINE_GATES.some((gate) => gate.alias === alias);
}

export function baselineGateCommand(alias: string): VerificationCommand {
  return {
    alias,
    executable: "stagent",
    args: ["check", "baseline-gate", "--id", alias],
    expected_exit_code: 0,
    timeout_seconds: 60,
  };
}

export function injectBaselineGateCommands(
  commands: readonly VerificationCommand[],
): VerificationCommand[] {
  const next: VerificationCommand[] = commands.map((command) => ({
    ...command,
    args: [...command.args],
  }));
  const seen = new Set(next.map((command) => command.alias));
  for (const gate of REQUIRED_BASELINE_GATES) {
    if (seen.has(gate.alias)) continue;
    next.push(baselineGateCommand(gate.alias));
    seen.add(gate.alias);
  }
  return next;
}

export type BaselineGateResultInput = {
  alias: string;
  exitCode: number;
  passed?: boolean;
};

export type BaselineGateEvaluation =
  { ok: true } | { ok: false; reason: "missing" | "nonzero"; alias: string };

/**
 * 写证据前的 fail-closed 判定：清单每一项都必须出现在 verification_results，
 * 且退出码为 0。缺项 / 未跑（结果中无该别名）或退出码非 0 / passed===false
 * 均不得视为通过。不接受 LLM 或人工评语作为输入。
 */
export function evaluateBaselineGateResults(
  results: readonly BaselineGateResultInput[],
): BaselineGateEvaluation {
  const byAlias = new Map(results.map((result) => [result.alias, result]));
  for (const gate of REQUIRED_BASELINE_GATES) {
    const result = byAlias.get(gate.alias);
    if (!result) {
      return { ok: false, reason: "missing", alias: gate.alias };
    }
    if (result.exitCode !== 0 || result.passed === false) {
      return { ok: false, reason: "nonzero", alias: gate.alias };
    }
  }
  return { ok: true };
}

export const BASELINE_SECRETS_ALIAS = "baseline-safety-secrets";

export const DESTUBBED_BASELINE_GATE_ALIASES: readonly string[] =
  REQUIRED_BASELINE_GATES.filter(
    (gate) => gate.alias !== BASELINE_SECRETS_ALIAS,
  ).map((gate) => gate.alias);

export type BaselineGateSample = "clean" | "violating" | "self-check";

export type BaselineGateBodyResult = {
  ok: boolean;
  exitCode: number;
  stub: boolean;
  body: "TASK-J.29" | "TASK-J.30";
  id: string;
  mode: BaselineGateSample | "forced";
  reason?: string;
};

const CLEAN_SCOPE: FileSystemScope = { writable_paths: ["src/**"] };
const CLEAN_WRITE_PATH = "src/app.ts";
const VIOLATING_WRITE_PATH = "daemon/secret.ts";

const CLEAN_TEST_SOURCE = `import { expect, it } from "vitest";
it("holds", () => {
  expect(1).toBe(1);
  expect(2).toBe(2);
});
`;
const WEAKENED_TEST_SOURCE = `import { expect, it } from "vitest";
it.skip("holds", () => {
  expect(1).toBe(1);
});
`;

const SAMPLE_MODULE: ModuleEntry = {
  id: "app",
  name: "App",
  purpose: "J.29 knowledge fixture",
  paths: ["src/**"],
  depends_on: [],
  interfaces: [],
  introduced_by: "TASK-J.29",
  updated_by: [],
};

function bodyResult(
  alias: string,
  ok: boolean,
  mode: BaselineGateBodyResult["mode"],
  reason?: string,
): BaselineGateBodyResult {
  return {
    ok,
    exitCode: ok ? 0 : 1,
    stub: false,
    body: "TASK-J.29",
    id: alias,
    mode,
    ...(reason === undefined ? {} : { reason }),
  };
}

function pickSample(
  alias: string,
  mode: BaselineGateSample,
  clean: { ok: boolean; reason?: string },
  violating: { ok: boolean; reason?: string },
): BaselineGateBodyResult {
  if (mode === "clean") {
    return bodyResult(alias, clean.ok, mode, clean.reason);
  }
  if (mode === "violating") {
    return bodyResult(alias, violating.ok, mode, violating.reason);
  }
  if (!clean.ok) {
    return bodyResult(
      alias,
      false,
      "self-check",
      clean.reason ?? "clean_sample_failed",
    );
  }
  if (violating.ok) {
    return bodyResult(
      alias,
      false,
      "self-check",
      "violating_sample_did_not_fail",
    );
  }
  return bodyResult(alias, true, "self-check");
}

function evaluateWritableScope(filePath: string, scope: FileSystemScope) {
  const access = checkWriteAccess(filePath, scope);
  return access.allowed
    ? { ok: true }
    : { ok: false, reason: access.reason ?? "NOT_WRITABLE" };
}

function evaluateTestIntegrity(baseText: string, candidateText: string) {
  const weakening = detectTestWeakening(baseText, candidateText, "ts");
  return weakening.weakened
    ? { ok: false, reason: weakening.reasons[0] ?? "weakened" }
    : { ok: true };
}

function evaluateRollbackAuto(input: {
  healthFailed: boolean;
  previousLiveReleaseId: string | null;
  rollbackSupported: boolean;
}): { ok: boolean; reason?: string } {
  if (!input.healthFailed) {
    return { ok: false, reason: "health_not_failed" };
  }
  if (!input.previousLiveReleaseId || !input.rollbackSupported) {
    return { ok: false, reason: "E_RELEASE_NO_PREVIOUS_OR_UNSUPPORTED" };
  }
  if (!canTransition("ROLLING_BACK", "ROLLED_BACK")) {
    return { ok: false, reason: "missing_ROLLING_BACK_to_ROLLED_BACK" };
  }
  return { ok: true };
}

function evaluateRollbackManual(input: {
  state: ReleaseState;
  currentCommitSha: string;
  previousLiveReleaseId: string | null;
  previousLiveCommitSha: string | null;
}): { ok: boolean; reason?: string; commit_sha?: string } {
  if (input.state !== "LIVE" && input.state !== "FAILED") {
    return { ok: false, reason: "E_RELEASE_ROLLBACK_STATE" };
  }
  if (!input.previousLiveReleaseId || !input.previousLiveCommitSha) {
    return { ok: false, reason: "E_RELEASE_NO_PREVIOUS" };
  }
  return { ok: true, commit_sha: input.previousLiveCommitSha };
}

function evaluateRollbackNoLive(previousLiveReleaseId: string | null): {
  ok: boolean;
  reason?: string;
} {
  if (!previousLiveReleaseId) {
    return { ok: false, reason: "E_RELEASE_NO_PREVIOUS" };
  }
  return { ok: true };
}

function evaluateExitCodesCanMerge(allZero: boolean): boolean {
  const results = REQUIRED_BASELINE_GATES.map((gate, index) => ({
    alias: gate.alias,
    exitCode: !allZero && index === 0 ? 1 : 0,
    passed: allZero || index !== 0,
  }));
  const evaluated = evaluateBaselineGateResults(results);
  const status = evaluated.ok ? "PASSED" : "FAILED";
  return deriveCanMerge({
    status,
    scopePassed: true,
    budgetExhausted: false,
    forbiddenViolationCount: 0,
  });
}

function stagentPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function evaluateMainlineRegression(root: string): {
  ok: boolean;
  reason?: string;
} {
  if (
    !MAINLINE_NODES.includes("merged") ||
    !MAINLINE_NODES.includes("verify")
  ) {
    return { ok: false, reason: "missing_MAINLINE_NODES" };
  }
  for (const rel of REGRESSION_FINGERPRINT) {
    if (!fs.existsSync(path.join(root, rel))) {
      return { ok: false, reason: `missing_fingerprint:${rel}` };
    }
  }
  return { ok: true };
}

function evaluateKnowledge(
  modules: readonly ModuleEntry[],
  filePath: string,
): { ok: boolean; reason?: string } {
  if (hasDependsOnCycle(modules)) {
    return { ok: false, reason: "KB-4-cycle" };
  }
  if (!coversPath(modules, filePath)) {
    return { ok: false, reason: "KB-1-uncovered" };
  }
  return { ok: true };
}

/**
 * 八项检查体：调用既有函数，用固定样本给出 0 / 非 0。
 * `baseline-safety-secrets` 仍返回桩（body: TASK-J.30）。
 */
export function runBaselineGateBody(
  alias: string,
  options?: { sample?: BaselineGateSample },
): BaselineGateBodyResult {
  const mode: BaselineGateSample = options?.sample ?? "self-check";

  if (alias === BASELINE_SECRETS_ALIAS) {
    return {
      ok: true,
      exitCode: 0,
      stub: true,
      body: "TASK-J.30",
      id: alias,
      mode,
    };
  }

  switch (alias) {
    case "baseline-safety-writable-scope":
      return pickSample(
        alias,
        mode,
        evaluateWritableScope(CLEAN_WRITE_PATH, CLEAN_SCOPE),
        evaluateWritableScope(VIOLATING_WRITE_PATH, CLEAN_SCOPE),
      );
    case "baseline-safety-test-integrity":
      return pickSample(
        alias,
        mode,
        evaluateTestIntegrity(CLEAN_TEST_SOURCE, CLEAN_TEST_SOURCE),
        evaluateTestIntegrity(CLEAN_TEST_SOURCE, WEAKENED_TEST_SOURCE),
      );
    case "baseline-rollback-auto":
      return pickSample(
        alias,
        mode,
        evaluateRollbackAuto({
          healthFailed: true,
          previousLiveReleaseId: "rel-prev",
          rollbackSupported: true,
        }),
        evaluateRollbackAuto({
          healthFailed: true,
          previousLiveReleaseId: null,
          rollbackSupported: true,
        }),
      );
    case "baseline-rollback-manual":
      return pickSample(
        alias,
        mode,
        evaluateRollbackManual({
          state: "FAILED",
          currentCommitSha: "sha-new",
          previousLiveReleaseId: "rel-prev",
          previousLiveCommitSha: "sha-prev",
        }),
        evaluateRollbackManual({
          state: "FAILED",
          currentCommitSha: "sha-new",
          previousLiveReleaseId: null,
          previousLiveCommitSha: null,
        }),
      );
    case "baseline-rollback-no-live": {
      const denied = evaluateRollbackNoLive(null);
      const clean =
        !denied.ok && denied.reason === "E_RELEASE_NO_PREVIOUS"
          ? { ok: true }
          : {
              ok: false,
              reason:
                denied.reason ?? "pretended_success_without_previous_live",
            };
      return pickSample(alias, mode, clean, denied);
    }
    case "baseline-path-exit-codes":
      return pickSample(
        alias,
        mode,
        evaluateExitCodesCanMerge(true)
          ? { ok: true }
          : { ok: false, reason: "all_zero_did_not_derive_can_merge" },
        {
          ok: evaluateExitCodesCanMerge(false),
          reason: "nonzero_exit_blocks_can_merge",
        },
      );
    case "baseline-path-mainline-regression":
      return pickSample(
        alias,
        mode,
        evaluateMainlineRegression(stagentPackageRoot()),
        evaluateMainlineRegression(
          path.join(stagentPackageRoot(), ".stagent-j29-missing-fingerprints"),
        ),
      );
    case "baseline-path-knowledge":
      return pickSample(
        alias,
        mode,
        evaluateKnowledge([SAMPLE_MODULE], "src/app.ts"),
        evaluateKnowledge(
          [
            { ...SAMPLE_MODULE, id: "app", depends_on: ["lib"] },
            {
              ...SAMPLE_MODULE,
              id: "lib",
              name: "Lib",
              paths: ["lib/**"],
              depends_on: ["app"],
            },
          ],
          "src/app.ts",
        ),
      );
    default:
      return {
        ok: false,
        exitCode: 1,
        stub: false,
        body: "TASK-J.29",
        id: alias,
        mode,
        reason: "unknown_alias",
      };
  }
}
