/**
 * TASK-J.28：固定底线清单登记与缺项 fail-closed。
 *
 * 把 J.27 清单中的检查登记为必须跑到的真实子进程；检查体留给 TASK-J.29。
 * 本模块只提供登记表、命令注入与写证据前的缺项判定，并用桩命令把机制测绿。
 * can_merge 仍只经 deriveCanMerge 派生，本模块不写、不改其签名。
 */

import type { VerificationCommand } from "../../src/lib/contract.schema";

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
