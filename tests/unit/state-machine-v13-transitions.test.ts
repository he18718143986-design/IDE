import { describe, expect, it } from "vitest";
import type { LifecycleState } from "../../src/lib/contract.schema";
import {
  ALL_LIFECYCLE_STATES,
  FAST_PATH_APPROVER,
  LIFECYCLE_TRANSITIONS,
  TERMINAL_STATES,
  canTransition,
  validateTransition,
  type ContractStatePair,
} from "../../src/lib/state-machine";

/**
 * TASK-0.2c / 架构 §9.1.1.1：v1.3.0 跃迁边矩阵**逐条登记**。
 *
 * 这张表是"不许偷偷放宽矩阵"的守门员：任何新增/删除边都会让本测试失败，
 * 必须先在规范里找到依据、再改这张表并写明出处。
 */
const EXPECTED_EDGES: Record<LifecycleState, readonly LifecycleState[]> = {
  // 标准路径走向审批；Fast Path 自动准入进 PREPARING（§0.2.3.1 C-02）
  DRAFT: ["PENDING_APPROVAL", "PREPARING", "ABORTED"],
  PENDING_APPROVAL: ["PREPARING", "ABORTED"],
  PREPARING: ["EXECUTING", "PENDING_APPROVAL", "ABORTED"],
  EXECUTING: ["VERIFYING", "PENDING_RESUME", "ABORTED"],
  VERIFYING: ["AUDITED", "EXECUTING", "PENDING_RESUME", "ABORTED"],
  // §9.1.1.1 C-07：Worktree 丢失自愈回 PREPARING
  PENDING_RESUME: ["EXECUTING", "PREPARING", "ABORTED"],
  // §9.1.1.1 C-08：外部改码级联降级回 VERIFYING
  // TASK-AUDITED.1：用户显式退回待批（带 Guard：PENDING_REVIEW + USER_RETURN_TO_PENDING）
  AUDITED: ["MERGED", "EXECUTING", "VERIFYING", "PENDING_APPROVAL", "ABORTED"],
  MERGED: [],
  ABORTED: [],
};

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("9 态枚举与跃迁表逐条登记", () => {
  it("生命周期恰好 9 态，且不含 MERGING（合并由 MERGED 终态表达）", () => {
    expect(ALL_LIFECYCLE_STATES).toHaveLength(9);
    expect([...ALL_LIFECYCLE_STATES]).not.toContain("MERGING");
    expect(sorted(ALL_LIFECYCLE_STATES)).toEqual(
      sorted([
        "DRAFT",
        "PENDING_APPROVAL",
        "PREPARING",
        "EXECUTING",
        "VERIFYING",
        "PENDING_RESUME",
        "AUDITED",
        "MERGED",
        "ABORTED",
      ]),
    );
  });

  it("跃迁表与规范登记表完全一致（任何增删都会在此失败）", () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(
        sorted(LIFECYCLE_TRANSITIONS[state]),
        `${state} 的出边与规范不一致`,
      ).toEqual(sorted(EXPECTED_EDGES[state]));
    }
  });

  it("终态仍为 MERGED / ABORTED，出边为空", () => {
    expect(sorted(TERMINAL_STATES)).toEqual(["ABORTED", "MERGED"]);
    for (const terminal of TERMINAL_STATES) {
      expect(LIFECYCLE_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("新增边没有被误做成无条件直通（canTransition 只表达结构存在）", () => {
    // 结构性存在 ≠ 业务放行：真正的裁决在 validateTransition 的 Guard 里
    expect(canTransition("DRAFT", "PREPARING")).toBe(true);
    expect(
      validateTransition(
        { lifecycle_state: "DRAFT", approval_status: "DRAFT" },
        { lifecycle_state: "PREPARING", approval_status: "APPROVED" },
      ).ok,
    ).toBe(false);
  });
});

describe("C-02 Fast Path：DRAFT → PREPARING 的 Guard", () => {
  const from: ContractStatePair = {
    lifecycle_state: "DRAFT",
    approval_status: "DRAFT",
  };
  const to: ContractStatePair = {
    lifecycle_state: "PREPARING",
    approval_status: "APPROVED",
  };

  it("正例：系统凭证 + LOW 风险", () => {
    expect(
      validateTransition(from, to, {
        approval: { approved_by: FAST_PATH_APPROVER },
        intent: { risk_level: "LOW" },
        reason: "FAST_PATH_ADMISSION",
      }).ok,
    ).toBe(true);
  });

  it("负例：MEDIUM / HIGH 风险一律拒绝", () => {
    for (const risk of ["MEDIUM", "HIGH"] as const) {
      const result = validateTransition(from, to, {
        approval: { approved_by: FAST_PATH_APPROVER },
        intent: { risk_level: risk },
      });
      expect(result.ok, `${risk} 必须被拒绝`).toBe(false);
    }
  });

  it("负例：人工审批凭证不得走 Fast Path 专用边", () => {
    for (const approver of ["tina", "user", "system:fast-path-spoof"]) {
      const result = validateTransition(from, to, {
        approval: { approved_by: approver },
        intent: { risk_level: "LOW" },
      });
      expect(result.ok, `${approver} 必须被拒绝`).toBe(false);
    }
  });

  it("负例：完全不给上下文时 Fail-Closed", () => {
    const result = validateTransition(from, to);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
      expect(result.message).toContain("Fast Path");
    }
  });
});

describe("C-07 自愈边与 C-08 降级边的触发原因", () => {
  const resume: ContractStatePair = {
    lifecycle_state: "PENDING_RESUME",
    approval_status: "APPROVED",
  };
  const preparing: ContractStatePair = {
    lifecycle_state: "PREPARING",
    approval_status: "APPROVED",
  };
  const audited: ContractStatePair = {
    lifecycle_state: "AUDITED",
    approval_status: "APPROVED",
  };
  const verifying: ContractStatePair = {
    lifecycle_state: "VERIFYING",
    approval_status: "APPROVED",
  };

  it("自愈边只接受 WORKTREE_MISSING_HEAL", () => {
    expect(
      validateTransition(resume, preparing, {
        reason: "WORKTREE_MISSING_HEAL",
      }).ok,
    ).toBe(true);
    for (const reason of [
      "EXTERNAL_MUTATION",
      "FAST_PATH_ADMISSION",
      "USER_RETURN_TO_PENDING",
      undefined,
    ] as const) {
      const result =
        reason === undefined
          ? validateTransition(resume, preparing)
          : validateTransition(resume, preparing, { reason });
      expect(result.ok, `reason=${String(reason)} 必须被拒绝`).toBe(false);
    }
  });

  it("降级边只接受 EXTERNAL_MUTATION", () => {
    expect(
      validateTransition(audited, verifying, {
        reason: "EXTERNAL_MUTATION",
      }).ok,
    ).toBe(true);
    for (const reason of [
      "WORKTREE_MISSING_HEAL",
      "USER_RETURN_TO_PENDING",
      undefined,
    ] as const) {
      const result =
        reason === undefined
          ? validateTransition(audited, verifying)
          : validateTransition(audited, verifying, { reason });
      expect(result.ok, `reason=${String(reason)} 必须被拒绝`).toBe(false);
    }
  });

  it("降级边落点必须是 VERIFYING；AUDITED → PREPARING 不在表内", () => {
    const result = validateTransition(audited, preparing, {
      reason: "EXTERNAL_MUTATION",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
    }
  });
});

describe("TASK-AUDITED.1：AUDITED → PENDING_APPROVAL 退回待批", () => {
  const audited: ContractStatePair = {
    lifecycle_state: "AUDITED",
    approval_status: "APPROVED",
  };
  const pending: ContractStatePair = {
    lifecycle_state: "PENDING_APPROVAL",
    approval_status: "PENDING_REVIEW",
  };

  it("结构边存在：canTransition(AUDITED, PENDING_APPROVAL) === true", () => {
    expect(canTransition("AUDITED", "PENDING_APPROVAL")).toBe(true);
  });

  it("正例：落点 PENDING_REVIEW + reason=USER_RETURN_TO_PENDING", () => {
    expect(
      validateTransition(audited, pending, {
        reason: "USER_RETURN_TO_PENDING",
      }).ok,
    ).toBe(true);
  });

  it("负例：落点仍 APPROVED / 缺 reason / 错 reason 拒绝", () => {
    const stillApproved = validateTransition(
      audited,
      {
        lifecycle_state: "PENDING_APPROVAL",
        approval_status: "APPROVED",
      },
      { reason: "USER_RETURN_TO_PENDING" },
    );
    expect(stillApproved.ok).toBe(false);
    if (!stillApproved.ok) {
      expect(stillApproved.code).toBe("ILLEGAL_TRANSITION");
      expect(stillApproved.message).toContain("PENDING_REVIEW");
    }

    expect(validateTransition(audited, pending).ok).toBe(false);
    expect(
      validateTransition(audited, pending, { reason: "EXTERNAL_MUTATION" }).ok,
    ).toBe(false);
  });

  it("负例：AUDITED → PREPARING 仍不在表内", () => {
    expect(canTransition("AUDITED", "PREPARING")).toBe(false);
  });
});

describe("熔断保护：挂起态不得跳回审批态", () => {
  it("PENDING_RESUME → PENDING_APPROVAL 被拒绝（只能续跑 / 自愈 / 放弃）", () => {
    expect(canTransition("PENDING_RESUME", "PENDING_APPROVAL")).toBe(false);
    const result = validateTransition(
      { lifecycle_state: "PENDING_RESUME", approval_status: "APPROVED" },
      {
        lifecycle_state: "PENDING_APPROVAL",
        approval_status: "PENDING_REVIEW",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("熔断进入 PENDING_RESUME 的两条来源边保持合法", () => {
    for (const from of ["EXECUTING", "VERIFYING"] as const) {
      const result = validateTransition(
        { lifecycle_state: from, approval_status: "APPROVED" },
        { lifecycle_state: "PENDING_RESUME", approval_status: "APPROVED" },
      );
      expect(result.ok, `${from} -> PENDING_RESUME 应合法`).toBe(true);
    }
  });
});
