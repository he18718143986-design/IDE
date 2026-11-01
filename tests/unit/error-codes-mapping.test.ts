import { describe, expect, it } from "vitest";
import { reasonCodeSchema } from "../../src/lib/evidence.schema";
import {
  ERROR_CODES,
  ERROR_CODE_CATALOG,
  REASON_CODES,
  StagentRuntimeError,
  errorCodesForReasonCode,
  isKnownErrorCode,
  mapErrorToReasonCode,
  mapErrorsToReasonCodes,
  normalizeErrorCode,
  type ErrorCode,
} from "../../src/lib/error-codes";

/**
 * TASK-0.2b / ErrorCode Catalog 完备性（G-15）。
 *
 * 判据：A §9.3 的 13 个基础 error_code + W.3 增补 E_PORT_CONFLICT
 * + W.2b 增补 E_OUT_OF_SCOPE_UNTRACKED
 * + S.4 增补 E_DEMO_PAYLOAD_TOO_LARGE
 * + S.5 增补 E_DISPUTE_TIMEOUT
 * + L.7 增补 E_PLAN_* ×5
 * + J.18c 增补 E_PROPOSAL_PREVIOUSLY_REJECTED / E_GATE_SCAN_FAILED
 * + L.14 增补 E_VAULT_* ×3 + L.9 增补 E_CONTRACT_IN_FLIGHT
 * + L.13 增补 E_TRACE_BROKEN = 29 个 → 9 个 reason_code，正反向均可闭环。
 */

/** A §9.3 表格的逐行期望值（手工登记，不以实现反推） */
const EXPECTED_MAPPING: Record<ErrorCode, string> = {
  E_UNSAFE_EXECUTION: "UNSAFE_EXECUTION",
  E_OUT_OF_SCOPE: "SCOPE_VIOLATION",
  E_OUT_OF_SCOPE_UNTRACKED: "SCOPE_VIOLATION",
  PATH_TRAVERSAL_DETECTED: "SCOPE_VIOLATION",
  E_FORBIDDEN_PATH: "SCOPE_VIOLATION",
  E_BUDGET_EXCEEDED: "BUDGET_EXHAUSTED",
  E_COMMAND_TIMEOUT: "BUDGET_EXHAUSTED",
  E_TASK_TIMEOUT: "BUDGET_EXHAUSTED",
  E_UNAUTHORIZED_COMMAND: "UNAUTHORIZED_COMMAND",
  E_RETRY_LIMIT_EXCEEDED: "VERIFICATION_RETRY_LIMIT",
  E_WORKSPACE_LOCKED: "WORKSPACE_LOCKED",
  E_EVIDENCE_STALE: "EVIDENCE_STALE",
  E_PREPARATION_FAILED: "PREPARATION_INTERRUPTED",
  E_WORKTREE_LOST: "WORKTREE_LOST",
  E_PORT_CONFLICT: "UNSAFE_EXECUTION",
  // TASK-S.4：Demo 单文件 2MB 上限，归入资源耗尽类
  E_DEMO_PAYLOAD_TOO_LARGE: "BUDGET_EXHAUSTED",
  // TASK-S.5：60s 质疑自查看门狗超时，归入时间预算耗尽
  E_DISPUTE_TIMEOUT: "BUDGET_EXHAUSTED",
  // TASK-L.7：项目计划校验 / 落盘错误码
  E_PLAN_INVALID: "PREPARATION_INTERRUPTED",
  E_PLAN_STALE: "EVIDENCE_STALE",
  E_PLAN_STUB_LOCKED: "WORKSPACE_LOCKED",
  E_PLAN_STUB_TOO_LARGE: "BUDGET_EXHAUSTED",
  E_PLAN_STUB_REVIVED: "PREPARATION_INTERRUPTED",
  // TASK-J.18c：墓地门禁 / 全量扫描失败
  E_PROPOSAL_PREVIOUSLY_REJECTED: "SCOPE_VIOLATION",
  E_GATE_SCAN_FAILED: "PREPARATION_INTERRUPTED",
  // TASK-L.14：凭据保险库
  E_VAULT_VALUE_TOO_SHORT: "PREPARATION_INTERRUPTED",
  E_VAULT_NAME_INVALID: "PREPARATION_INTERRUPTED",
  E_VAULT_NOT_FOUND: "PREPARATION_INTERRUPTED",
  // TASK-L.9：合同级互斥
  E_CONTRACT_IN_FLIGHT: "WORKSPACE_LOCKED",
  // TASK-L.13：追踪链断环
  E_TRACE_BROKEN: "PREPARATION_INTERRUPTED",
};

describe("目录基数：29 个 error_code → 9 个 reason_code", () => {
  it("恰好 29 个错误码且无重复", () => {
    expect(ERROR_CODES).toHaveLength(29);
    expect(new Set(ERROR_CODES).size).toBe(29);
  });

  it("恰好 9 个运行时原因码；均为 evidence.schema reasonCodeSchema 子集（L.3 义务码仅用于证据载荷）", () => {
    expect(REASON_CODES).toHaveLength(9);
    expect(new Set(REASON_CODES).size).toBe(9);
    const evidenceReasons = new Set(reasonCodeSchema.options);
    for (const r of REASON_CODES) {
      expect(evidenceReasons.has(r), `missing in evidence.schema: ${r}`).toBe(
        true,
      );
    }
    // 目录表不得引用 REASON_CODES 之外的原因码
    for (const spec of Object.values(ERROR_CODE_CATALOG)) {
      expect(REASON_CODES).toContain(spec.reason_code);
    }
  });

  it("目录表逐项登记，且 code / reason_code 与 A §9.3 完全一致", () => {
    for (const [code, reason] of Object.entries(EXPECTED_MAPPING)) {
      const spec = ERROR_CODE_CATALOG[code as ErrorCode];
      expect(spec, `missing catalog entry: ${code}`).toBeDefined();
      expect(spec.code).toBe(code);
      expect(spec.reason_code).toBe(reason);
      expect(spec.component.length).toBeGreaterThan(0);
      expect(spec.task).toMatch(/^TASK-/);
      expect(spec.condition.length).toBeGreaterThan(0);
    }
    expect(Object.keys(ERROR_CODE_CATALOG).sort()).toEqual(
      [...ERROR_CODES].sort(),
    );
  });
});

describe("正向映射：error_code → reason_code", () => {
  it.each(ERROR_CODES)("%s 映射到唯一 reason_code", (code) => {
    expect(mapErrorToReasonCode(code)).toBe(EXPECTED_MAPPING[code]);
  });

  it("多对一归并正确：SCOPE_VIOLATION 由 5 个错误码共同产出", () => {
    expect(errorCodesForReasonCode("SCOPE_VIOLATION").sort()).toEqual([
      "E_FORBIDDEN_PATH",
      "E_OUT_OF_SCOPE",
      "E_OUT_OF_SCOPE_UNTRACKED",
      "E_PROPOSAL_PREVIOUSLY_REJECTED",
      "PATH_TRAVERSAL_DETECTED",
    ]);
  });

  it("多对一归并正确：BUDGET_EXHAUSTED 由 6 个错误码共同产出", () => {
    // TASK-S.4 增补 E_DEMO_PAYLOAD_TOO_LARGE：单文件 2MB 上限同属"资源上限"家族
    // TASK-S.5 增补 E_DISPUTE_TIMEOUT：60s 看门狗同属"时间预算耗尽"
    expect(errorCodesForReasonCode("BUDGET_EXHAUSTED").sort()).toEqual([
      "E_BUDGET_EXCEEDED",
      "E_COMMAND_TIMEOUT",
      "E_DEMO_PAYLOAD_TOO_LARGE",
      "E_DISPUTE_TIMEOUT",
      "E_PLAN_STUB_TOO_LARGE",
      "E_TASK_TIMEOUT",
    ]);
  });

  it("批量映射去重且保持目录顺序稳定", () => {
    const reasons = mapErrorsToReasonCodes([
      "E_OUT_OF_SCOPE",
      "PATH_TRAVERSAL_DETECTED",
      "E_BUDGET_EXCEEDED",
    ]);
    expect(reasons).toEqual(["SCOPE_VIOLATION", "BUDGET_EXHAUSTED"]);
  });
});

describe("反向映射：reason_code → error_code[]（一对多）", () => {
  it("每个 reason_code 至少有一个可产出它的 error_code（无孤儿原因码）", () => {
    for (const reason of REASON_CODES) {
      const codes = errorCodesForReasonCode(reason);
      expect(codes.length, `orphan reason_code: ${reason}`).toBeGreaterThan(0);
    }
  });

  it("反向映射覆盖全部 28 个错误码，无遗漏", () => {
    const covered = new Set(
      REASON_CODES.flatMap((reason) => errorCodesForReasonCode(reason)),
    );
    expect(covered.size).toBe(29);
    for (const code of ERROR_CODES) {
      expect(covered.has(code), `uncovered error_code: ${code}`).toBe(true);
    }
  });

  it("反向结果与正向映射自洽（双向往返一致）", () => {
    for (const reason of REASON_CODES) {
      for (const code of errorCodesForReasonCode(reason)) {
        expect(mapErrorToReasonCode(code)).toBe(reason);
      }
    }
  });

  it("仍保持单射的原因码反向只有唯一错误码", () => {
    const singleValued = [
      "UNAUTHORIZED_COMMAND",
      "VERIFICATION_RETRY_LIMIT",
      "WORKTREE_LOST",
    ] as const;
    for (const reason of singleValued) {
      expect(errorCodesForReasonCode(reason)).toHaveLength(1);
    }
  });

  it("TASK-L.7 计划码并入既有原因码家族", () => {
    expect(errorCodesForReasonCode("WORKSPACE_LOCKED").sort()).toEqual([
      "E_CONTRACT_IN_FLIGHT",
      "E_PLAN_STUB_LOCKED",
      "E_WORKSPACE_LOCKED",
    ]);
    expect(errorCodesForReasonCode("EVIDENCE_STALE").sort()).toEqual([
      "E_EVIDENCE_STALE",
      "E_PLAN_STALE",
    ]);
    expect(errorCodesForReasonCode("PREPARATION_INTERRUPTED").sort()).toEqual([
      "E_GATE_SCAN_FAILED",
      "E_PLAN_INVALID",
      "E_PLAN_STUB_REVIVED",
      "E_PREPARATION_FAILED",
      "E_TRACE_BROKEN",
      "E_VAULT_NAME_INVALID",
      "E_VAULT_NOT_FOUND",
      "E_VAULT_VALUE_TOO_SHORT",
    ]);
  });

  it("TASK-J.18c 墓地门禁码并入 SCOPE_VIOLATION / PREPARATION_INTERRUPTED", () => {
    expect(errorCodesForReasonCode("SCOPE_VIOLATION")).toContain(
      "E_PROPOSAL_PREVIOUSLY_REJECTED",
    );
    expect(errorCodesForReasonCode("PREPARATION_INTERRUPTED")).toContain(
      "E_GATE_SCAN_FAILED",
    );
  });
});

describe("未知错误码不静默丢弃", () => {
  it("isKnownErrorCode 精确判定", () => {
    expect(isKnownErrorCode("E_OUT_OF_SCOPE")).toBe(true);
    expect(isKnownErrorCode("E_NOT_IN_CATALOG")).toBe(false);
    expect(isKnownErrorCode("toString")).toBe(false);
  });

  it("normalizeErrorCode 对未知码返回 known=false 并给出兜底归因", () => {
    const unknown = normalizeErrorCode("E_LEGACY_TOKEN");
    expect(unknown.known).toBe(false);
    expect(unknown.code).toBeNull();
    expect(REASON_CODES).toContain(unknown.reasonCode);
  });

  it("normalizeErrorCode 对已知码返回目录归因", () => {
    const known = normalizeErrorCode("E_WORKSPACE_LOCKED");
    expect(known.known).toBe(true);
    expect(known.code).toBe("E_WORKSPACE_LOCKED");
    expect(known.reasonCode).toBe("WORKSPACE_LOCKED");
  });
});

describe("StagentRuntimeError 同时携带两级码", () => {
  it("构造时自动解析 reason_code", () => {
    const err = new StagentRuntimeError(
      "E_PREPARATION_FAILED",
      "worktree creation interrupted",
    );
    expect(err.code).toBe("E_PREPARATION_FAILED");
    expect(err.reasonCode).toBe("PREPARATION_INTERRUPTED");
    expect(err.name).toBe("StagentRuntimeError");
    expect(err.message).toContain("interrupted");
  });

  it("保留 cause 链", () => {
    const root = new Error("disk full");
    const err = new StagentRuntimeError("E_PREPARATION_FAILED", "wrap", {
      cause: root,
    });
    expect(err.cause).toBe(root);
  });
});
