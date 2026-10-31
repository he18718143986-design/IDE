/**
 * TASK-L.4 / verification-strategy §3.2：两段式施工（先红后绿）纯辅助。
 *
 * - 构造运行期收窄 overlay（只收窄不放宽，不持久化进合同）
 * - 渲染 T/I 段义务清单（交给 renderChecksSection extras）
 * - 解释 `stagent check obligations --phase t|i` 的分类结果
 * - 写 PENDING_RESUME 挂起原因（suspension.json）
 *
 * 编排状态机仍在 orchestrator.ts；本文件无 IO 副作用（除 writeSuspension）。
 */

import fs from "node:fs";
import path from "node:path";
import { isTestPath } from "../guard/test-integrity";
import type { PhaseOverlay } from "../mcp/gateway";
import type { TestObligation } from "../../src/lib/verification/obligations";
import type { ObligationRunClass } from "../../src/lib/verification/obligations";

export type ConstructionPhase = "t" | "i";

/** 判断合同 writable 模式是否指向测试（用于 T 段把「非测试写范围」放进 extraForbidden） */
export function isTestScopePattern(pattern: string): boolean {
  const p = pattern
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "")
    .toLowerCase();
  if (!p) return false;
  if (p.includes(".test.") || p.includes(".spec.")) return true;
  return /(^|\/)(tests?|__tests__)(\/|$)/.test(p);
}

/**
 * T 段 overlay：只允许写义务测试路径；非测试写范围全部禁止。
 */
export function buildTPhaseOverlay(
  obligationPaths: readonly string[],
  writablePaths: readonly string[],
): PhaseOverlay {
  const extraForbidden = writablePaths.filter((p) => !isTestScopePattern(p));
  return {
    testWriteAllowlist: [...obligationPaths],
    extraForbidden,
  };
}

/**
 * I 段 overlay：T 段写过的文件只读；同时禁止一切测试写入
 * （verification-strategy §3.3：两段中测试文件只有义务清单内可写；
 * I 段义务已落盘，清单应为空 → 既有/义务测试皆只读）。
 */
export function buildIPhaseOverlay(
  tPhaseWrittenFiles: readonly string[],
): PhaseOverlay {
  return {
    testWriteAllowlist: [],
    extraForbidden: [...tPhaseWrittenFiles],
  };
}

/** 交给 renderChecksSection 的本段义务白话清单 */
export function obligationChecksExtras(
  phase: ConstructionPhase,
  obligations: readonly TestObligation[],
): string[] {
  if (obligations.length === 0) return [];
  const header =
    phase === "t"
      ? "本段（T · 先写测试）义务："
      : "本段（I · 再实现）义务：";
  return [
    header,
    ...obligations.map(
      (o) => `- ${o.acceptance_id} → ${o.test_path}（${o.level}）`,
    ),
  ];
}

/** 合入卡豁免白话（verification-strategy §3.5） */
export function waiverPlainMessages(
  waived: readonly { acceptance_id: string; reason: string }[],
): string[] {
  if (waived.length === 0) return [];
  return waived.map(
    (w) =>
      `验收「${w.acceptance_id}」没有自动测试（${w.reason}），靠你试玩确认`,
  );
}

export type PhaseCheckVerdict =
  | { ok: true; classification: ObligationRunClass; reason_code?: undefined }
  | {
      ok: false;
      classification: ObligationRunClass;
      reason_code:
        | "OBLIGATION_NOT_RED"
        | "OBLIGATION_RED_INVALID"
        | "OBLIGATION_NOT_GREEN";
    };

/** 解释 phase t/i 对 classifyRun 结果的期望 */
export function evaluatePhaseCheck(
  phase: ConstructionPhase,
  classification: ObligationRunClass,
): PhaseCheckVerdict {
  if (phase === "t") {
    if (classification === "red") {
      return { ok: true, classification };
    }
    if (classification === "red_invalid") {
      return {
        ok: false,
        classification,
        reason_code: "OBLIGATION_RED_INVALID",
      };
    }
    return {
      ok: false,
      classification,
      reason_code: "OBLIGATION_NOT_RED",
    };
  }
  // phase i → 必须 green
  if (classification === "green") {
    return { ok: true, classification };
  }
  return {
    ok: false,
    classification,
    reason_code: "OBLIGATION_NOT_GREEN",
  };
}

export interface SuspensionRecord {
  contract_id: string;
  reason: string;
  phase: "t" | "i" | "two_phase";
  detail?: string;
  created_at: string;
  i_green_failures?: number;
  returned_to_t?: boolean;
}

/** 挂起原因写入 `.stagent/records/<id>/suspension.json` */
export function writeSuspension(
  repoRoot: string,
  contractId: string,
  record: Omit<SuspensionRecord, "contract_id" | "created_at"> & {
    created_at?: string;
  },
): string {
  const dir = path.join(repoRoot, ".stagent", "records", contractId);
  fs.mkdirSync(dir, { recursive: true });
  const full: SuspensionRecord = {
    contract_id: contractId,
    reason: record.reason,
    phase: record.phase,
    created_at: record.created_at ?? new Date().toISOString(),
    ...(record.detail === undefined ? {} : { detail: record.detail }),
    ...(record.i_green_failures === undefined
      ? {}
      : { i_green_failures: record.i_green_failures }),
    ...(record.returned_to_t === undefined
      ? {}
      : { returned_to_t: record.returned_to_t }),
  };
  const file = path.join(dir, "suspension.json");
  fs.writeFileSync(file, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  return file;
}

/**
 * 从 T 段 modifiedFiles 中筛出应在 I 段只读的路径。
 * 默认：全部 T 段写过的文件（含测试）；调用方可再过滤。
 */
export function tPhaseLockedPaths(
  modifiedFiles: readonly string[],
): string[] {
  return [...modifiedFiles];
}

/** 是否应走两段式（存在未豁免义务） */
export function shouldRunTwoPhase(
  obligations: readonly TestObligation[],
): boolean {
  return obligations.length > 0;
}

/**
 * I 段判绿连续失败计数器：满 2 次且尚未回过 T → 允许回 T 一次；
 * 已回过 T 再满 2 次 → 应挂起。
 */
export interface IGreenFailState {
  consecutiveFailures: number;
  returnedToT: boolean;
}

export type IGreenFailAction = "continue_i" | "return_to_t" | "suspend";

export function nextIGreenFailAction(
  state: IGreenFailState,
): IGreenFailAction {
  if (state.consecutiveFailures < 2) return "continue_i";
  if (!state.returnedToT) return "return_to_t";
  return "suspend";
}

/** 工具：路径是否被 allowlist（精确或 glob）覆盖——复用网关同款语义时由网关内部完成；此处供测试断言 */
export { isTestPath };
