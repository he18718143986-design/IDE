import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ApprovalStatus,
  LifecycleState,
} from "../../src/lib/contract.schema";
import {
  ALL_APPROVAL_STATUSES,
  ALL_LIFECYCLE_STATES,
  FAST_PATH_APPROVER,
  LIFECYCLE_TRANSITIONS,
  STATE_MATRIX,
  TERMINAL_STATES,
  canTransition,
  isApprovalCurrent,
  isLegalStatePair,
  isTerminalState,
  validateStatePair,
  validateTransition,
  writeJsonAtomic,
  type ContractStatePair,
} from "../../src/lib/state-machine";
import { PRESENTATION_STATE_MATRIX } from "../../src/lib/state/presentation-state";

/**
 * TASK-0.2b / §9.1.1 双状态机组合矩阵。
 *
 * 判据来源：《Stagent 系统架构设计规范 v1.2.1》§9.1.1 表格四行。
 */

const LS = ALL_LIFECYCLE_STATES;
const AS = ALL_APPROVAL_STATUSES;

/**
 * 期望矩阵：以「规范表格」为唯一事实源手工登记，用于反向校验实现，
 * 而不是从实现里反推期望值（否则测试永远为真）。
 */
const EXPECTED_LEGAL: Record<LifecycleState, readonly ApprovalStatus[]> = {
  DRAFT: ["DRAFT"],
  PENDING_APPROVAL: ["PENDING_REVIEW"],
  PREPARING: ["APPROVED"],
  EXECUTING: ["APPROVED"],
  VERIFYING: ["APPROVED"],
  PENDING_RESUME: ["APPROVED"],
  AUDITED: ["APPROVED"],
  MERGED: ["APPROVED"],
  ABORTED: ["REJECTED", "APPROVED"],
};

describe("§9.1.1 组合矩阵：9 × 4 = 36 种组合全量遍历", () => {
  it("期望矩阵本身覆盖 9 态 × 4 审批态，无遗漏", () => {
    expect(Object.keys(EXPECTED_LEGAL).sort()).toEqual([...LS].sort());
    for (const state of LS) {
      for (const approval of EXPECTED_LEGAL[state]) {
        expect(AS).toContain(approval);
      }
    }
  });

  it.each(
    LS.flatMap((lifecycle) =>
      AS.map((approval) => ({
        lifecycle,
        approval,
        legal: EXPECTED_LEGAL[lifecycle].includes(approval),
      })),
    ),
  )("$lifecycle × $approval → $legal", ({ lifecycle, approval, legal }) => {
    const pair: ContractStatePair = {
      lifecycle_state: lifecycle,
      approval_status: approval,
    };
    expect(isLegalStatePair(pair)).toBe(legal);

    const result = validateStatePair(pair);
    expect(result.ok).toBe(legal);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_STATE_PAIR");
      expect(result.message).toContain("Illegal state combination");
      expect(result.message).toContain(lifecycle);
      expect(result.message).toContain(approval);
    }
  });

  it("矩阵行数/内容与 STATE_MATRIX 表驱动结构一致（防两份清单漂移）", () => {
    for (const state of LS) {
      for (const approval of AS) {
        const inTable = STATE_MATRIX.some(
          (row) =>
            row.lifecycle.includes(state) && row.approval.includes(approval),
        );
        expect(inTable, `${state} × ${approval}`).toBe(
          EXPECTED_LEGAL[state].includes(approval),
        );
      }
    }
  });
});

describe("G-17 三条关键分支断言", () => {
  it("【正例】ABORTED + APPROVED：已批准后安全中止，保留历史审批事实", () => {
    const result = validateStatePair({
      lifecycle_state: "ABORTED",
      approval_status: "APPROVED",
    });
    expect(result.ok).toBe(true);
  });

  it("【负例】被拒绝（ABORTED + REJECTED）后不得原地回到 DRAFT", () => {
    const from: ContractStatePair = {
      lifecycle_state: "ABORTED",
      approval_status: "REJECTED",
    };
    const to: ContractStatePair = {
      lifecycle_state: "DRAFT",
      approval_status: "DRAFT",
    };

    const result = validateTransition(from, to);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TERMINAL_STATE");
    }
  });

  it("【负例】ABORTED 为终态，resume 不得跃迁至 EXECUTING", () => {
    const result = validateTransition(
      { lifecycle_state: "ABORTED", approval_status: "APPROVED" },
      { lifecycle_state: "EXECUTING", approval_status: "APPROVED" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TERMINAL_STATE");
      expect(result.message).toContain("terminal");
    }
  });

  it("MERGED 同样是终态，不得跃迁至任何状态", () => {
    for (const target of LS) {
      const result = validateTransition(
        { lifecycle_state: "MERGED", approval_status: "APPROVED" },
        { lifecycle_state: target, approval_status: "APPROVED" },
      );
      expect(result.ok, `MERGED -> ${target} must fail`).toBe(false);
    }
  });
});

describe("跃迁表：合法边与非法边", () => {
  const APPROVED_PAIR = (state: LifecycleState): ContractStatePair => ({
    lifecycle_state: state,
    approval_status: "APPROVED",
  });

  it("终态集合精确为 MERGED / ABORTED", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["ABORTED", "MERGED"]);
    for (const state of LS) {
      expect(isTerminalState(state)).toBe(
        state === "MERGED" || state === "ABORTED",
      );
      expect(LIFECYCLE_TRANSITIONS[state]).toEqual(
        state === "MERGED" || state === "ABORTED" ? [] : expect.any(Array),
      );
    }
  });

  it("happy path 全链路可通过：DRAFT → … → MERGED", () => {
    const chain: Array<[ContractStatePair, ContractStatePair]> = [
      [
        { lifecycle_state: "DRAFT", approval_status: "DRAFT" },
        {
          lifecycle_state: "PENDING_APPROVAL",
          approval_status: "PENDING_REVIEW",
        },
      ],
      [
        {
          lifecycle_state: "PENDING_APPROVAL",
          approval_status: "PENDING_REVIEW",
        },
        APPROVED_PAIR("PREPARING"),
      ],
      [APPROVED_PAIR("PREPARING"), APPROVED_PAIR("EXECUTING")],
      [APPROVED_PAIR("EXECUTING"), APPROVED_PAIR("VERIFYING")],
      [APPROVED_PAIR("VERIFYING"), APPROVED_PAIR("AUDITED")],
      [APPROVED_PAIR("AUDITED"), APPROVED_PAIR("MERGED")],
    ];

    for (const [from, to] of chain) {
      const result = validateTransition(from, to);
      expect(
        result.ok,
        `${from.lifecycle_state} -> ${to.lifecycle_state} should be legal`,
      ).toBe(true);
    }
  });

  it("中断/熔断/重试/失效四类回边均合法", () => {
    const backEdges: Array<[LifecycleState, LifecycleState]> = [
      ["PREPARING", "PENDING_APPROVAL"], // 初始化中断清理后回退
      ["EXECUTING", "PENDING_RESUME"], // 预算熔断
      ["VERIFYING", "PENDING_RESUME"], // 验证挂起
      ["VERIFYING", "EXECUTING"], // 非安全失败重试
      ["AUDITED", "EXECUTING"], // Evidence 失效重新验证
      ["PENDING_RESUME", "EXECUTING"], // 用户显式续跑
    ];

    for (const [from, to] of backEdges) {
      const target: ContractStatePair =
        to === "PENDING_APPROVAL"
          ? { lifecycle_state: to, approval_status: "PENDING_REVIEW" }
          : APPROVED_PAIR(to);
      const result = validateTransition(APPROVED_PAIR(from), target);
      // PREPARING 的源组合是 APPROVED，回退目标是 PENDING_REVIEW
      expect(result.ok, `${from} -> ${to} should be legal`).toBe(true);
    }
  });

  it("跨越式跃迁被拒绝（DRAFT → EXECUTING / EXECUTING → MERGED）", () => {
    const illegal: Array<[LifecycleState, LifecycleState]> = [
      ["DRAFT", "EXECUTING"],
      ["DRAFT", "MERGED"],
      ["EXECUTING", "MERGED"],
      ["EXECUTING", "AUDITED"],
      ["PENDING_APPROVAL", "EXECUTING"],
      ["VERIFYING", "MERGED"],
      ["PENDING_RESUME", "AUDITED"],
    ];

    for (const [from, to] of illegal) {
      const result = validateTransition(APPROVED_PAIR(from), APPROVED_PAIR(to));
      expect(result.ok, `${from} -> ${to} must be rejected`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ILLEGAL_TRANSITION");
      }
    }
  });

  it("自环被拒绝（不允许空转洗状态）", () => {
    for (const state of LS) {
      const pair = APPROVED_PAIR(state);
      expect(canTransition(state, state)).toBe(false);
      const result = validateTransition(pair, pair);
      expect(result.ok, `${state} -> ${state} must be rejected`).toBe(false);
    }
  });

  it("PREPARING → PENDING_APPROVAL 必须同时把 approval 回置为 PENDING_REVIEW", () => {
    const bad = validateTransition(APPROVED_PAIR("PREPARING"), {
      lifecycle_state: "PENDING_APPROVAL",
      approval_status: "APPROVED",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.code).toBe("ILLEGAL_TRANSITION");
      expect(bad.message).toContain("PENDING_REVIEW");
    }

    const good = validateTransition(APPROVED_PAIR("PREPARING"), {
      lifecycle_state: "PENDING_APPROVAL",
      approval_status: "PENDING_REVIEW",
    });
    expect(good.ok).toBe(true);
  });

  it("边合法但落点组合非法时被拒绝（4 维校验的必要性）", () => {
    // EXECUTING → VERIFYING 是合法边，但 VERIFYING 必须配 APPROVED
    const result = validateTransition(APPROVED_PAIR("EXECUTING"), {
      lifecycle_state: "VERIFYING",
      approval_status: "PENDING_REVIEW",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_STATE_PAIR");
    }
  });
});

describe("§9.1.1.1 v1.3.0 受控边（TASK-0.2c）", () => {
  const DRAFT_PAIR: ContractStatePair = {
    lifecycle_state: "DRAFT",
    approval_status: "DRAFT",
  };
  const PREPARING_PAIR: ContractStatePair = {
    lifecycle_state: "PREPARING",
    approval_status: "APPROVED",
  };
  const AUDITED_PAIR: ContractStatePair = {
    lifecycle_state: "AUDITED",
    approval_status: "APPROVED",
  };
  const VERIFYING_PAIR: ContractStatePair = {
    lifecycle_state: "VERIFYING",
    approval_status: "APPROVED",
  };
  const RESUME_PAIR: ContractStatePair = {
    lifecycle_state: "PENDING_RESUME",
    approval_status: "APPROVED",
  };
  const FAST_PATH_CONTEXT = {
    approval: { approved_by: FAST_PATH_APPROVER },
    intent: { risk_level: "LOW" as const },
  };

  it("Fast Path 正例：system:fast-path + LOW 风险时 DRAFT → PREPARING 合法", () => {
    const result = validateTransition(
      DRAFT_PAIR,
      PREPARING_PAIR,
      FAST_PATH_CONTEXT,
    );
    expect(result.ok).toBe(true);
  });

  it("Fast Path 负例：缺上下文 / 非系统凭证 / 非 LOW 风险一律拒绝", () => {
    const cases: Array<
      [string, Parameters<typeof validateTransition>[2] | undefined]
    > = [
      ["缺上下文", undefined],
      [
        "人工审批",
        { approval: { approved_by: "tina" }, intent: { risk_level: "LOW" } },
      ],
      [
        "中风险",
        {
          approval: { approved_by: FAST_PATH_APPROVER },
          intent: { risk_level: "MEDIUM" },
        },
      ],
      ["仅凭证无风险等级", { approval: { approved_by: FAST_PATH_APPROVER } }],
    ];

    for (const [label, context] of cases) {
      const result =
        context === undefined
          ? validateTransition(DRAFT_PAIR, PREPARING_PAIR)
          : validateTransition(DRAFT_PAIR, PREPARING_PAIR, context);
      expect(result.ok, `${label} 必须被拒绝`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ILLEGAL_TRANSITION");
      }
    }
  });

  it("Fast Path 铁律：DRAFT → EXECUTING 在任何上下文下都非法（不得跳过 PREPARING）", () => {
    const executing: ContractStatePair = {
      lifecycle_state: "EXECUTING",
      approval_status: "APPROVED",
    };
    const result = validateTransition(DRAFT_PAIR, executing, FAST_PATH_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
      expect(result.message).toContain("DRAFT -> EXECUTING");
    }
  });

  it("外部改码降级：AUDITED → VERIFYING 必须携带 EXTERNAL_MUTATION", () => {
    expect(
      validateTransition(AUDITED_PAIR, VERIFYING_PAIR, {
        reason: "EXTERNAL_MUTATION",
      }).ok,
    ).toBe(true);

    const missing = validateTransition(AUDITED_PAIR, VERIFYING_PAIR);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("ILLEGAL_TRANSITION");
      expect(missing.message).toContain("EXTERNAL_MUTATION");
    }

    const wrongReason = validateTransition(AUDITED_PAIR, VERIFYING_PAIR, {
      reason: "WORKTREE_MISSING_HEAL",
    });
    expect(wrongReason.ok).toBe(false);
  });

  it("恢复自愈：PENDING_RESUME → PREPARING 必须携带 WORKTREE_MISSING_HEAL", () => {
    expect(
      validateTransition(RESUME_PAIR, PREPARING_PAIR, {
        reason: "WORKTREE_MISSING_HEAL",
      }).ok,
    ).toBe(true);

    const missing = validateTransition(RESUME_PAIR, PREPARING_PAIR);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("ILLEGAL_TRANSITION");
      expect(missing.message).toContain("WORKTREE_MISSING_HEAL");
    }
  });

  it("熔断挂起后严禁跳回 PENDING_APPROVAL（只能续跑、自愈或放弃）", () => {
    expect(canTransition("PENDING_RESUME", "PENDING_APPROVAL")).toBe(false);
    const result = validateTransition(RESUME_PAIR, {
      lifecycle_state: "PENDING_APPROVAL",
      approval_status: "PENDING_REVIEW",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("新增边不拓宽其它跨越式跃迁（AUDITED → PREPARING 仍非法）", () => {
    const result = validateTransition(AUDITED_PAIR, PREPARING_PAIR, {
      reason: "EXTERNAL_MUTATION",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
    }
  });
});

describe("§9.1.1.1 TASK-AUDITED.1：AUDITED → PENDING_APPROVAL 退回待批", () => {
  const AUDITED_PAIR: ContractStatePair = {
    lifecycle_state: "AUDITED",
    approval_status: "APPROVED",
  };
  const PENDING_PAIR: ContractStatePair = {
    lifecycle_state: "PENDING_APPROVAL",
    approval_status: "PENDING_REVIEW",
  };
  const PREPARING_PAIR: ContractStatePair = {
    lifecycle_state: "PREPARING",
    approval_status: "APPROVED",
  };

  it("正例：AUDITED+APPROVED → PENDING_APPROVAL+PENDING_REVIEW + USER_RETURN_TO_PENDING 合法", () => {
    const result = validateTransition(AUDITED_PAIR, PENDING_PAIR, {
      reason: "USER_RETURN_TO_PENDING",
    });
    expect(result.ok).toBe(true);
  });

  it("负例：落点仍 APPROVED 被拒绝（Fail-Closed，不得静默授权）", () => {
    const result = validateTransition(
      AUDITED_PAIR,
      {
        lifecycle_state: "PENDING_APPROVAL",
        approval_status: "APPROVED",
      },
      { reason: "USER_RETURN_TO_PENDING" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
      expect(result.message).toContain("PENDING_REVIEW");
    }
  });

  it("负例：缺 reason / 错 reason 一律拒绝", () => {
    const missing = validateTransition(AUDITED_PAIR, PENDING_PAIR);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("ILLEGAL_TRANSITION");
      expect(missing.message).toContain("USER_RETURN_TO_PENDING");
    }

    for (const reason of [
      "EXTERNAL_MUTATION",
      "WORKTREE_MISSING_HEAL",
      "FAST_PATH_ADMISSION",
    ] as const) {
      const wrong = validateTransition(AUDITED_PAIR, PENDING_PAIR, { reason });
      expect(wrong.ok, `reason=${reason} 必须被拒绝`).toBe(false);
      if (!wrong.ok) {
        expect(wrong.code).toBe("ILLEGAL_TRANSITION");
      }
    }
  });

  it("负例：AUDITED → PREPARING 仍非法（退回待批不得拓宽为跳回 PREPARING）", () => {
    const result = validateTransition(AUDITED_PAIR, PREPARING_PAIR, {
      reason: "USER_RETURN_TO_PENDING",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("配对矩阵：退回待批后 PENDING_APPROVAL↔PENDING_REVIEW 成立", () => {
    const result = validateTransition(AUDITED_PAIR, PENDING_PAIR, {
      reason: "USER_RETURN_TO_PENDING",
    });
    expect(result.ok).toBe(true);
    // 落点本身必须是合法组合（validateTransition 末步已走 validateStatePair）
    expect(PENDING_PAIR.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(PENDING_PAIR.approval_status).toBe("PENDING_REVIEW");
  });
});

describe("§6.3.1 展示状态矩阵的 lifecycle 必须存在于状态机枚举", () => {
  it("15 展示态表格使用的每个 lifecycle 都是合法枚举值", () => {
    // 规范 §6.3.1「CI 不变式门禁」：防止展示层悄悄引用底层已废弃的状态名
    for (const row of PRESENTATION_STATE_MATRIX) {
      expect(
        ALL_LIFECYCLE_STATES as readonly string[],
        `${row.presentation_state} -> ${row.lifecycle_state}`,
      ).toContain(row.lifecycle_state);
    }
  });
});

describe("审批版本绑定（防 TOCTOU）", () => {
  it("approved_revision 与 contract_revision 相等才算当前", () => {
    expect(
      isApprovalCurrent({
        contract_revision: 3,
        approval: { status: "APPROVED", approved_revision: 3 },
      }),
    ).toBe(true);

    expect(
      isApprovalCurrent({
        contract_revision: 4,
        approval: { status: "APPROVED", approved_revision: 3 },
      }),
    ).toBe(false);
  });

  it("未记录的 approved_revision 视为未绑定，不放行", () => {
    expect(
      isApprovalCurrent({
        contract_revision: 1,
        approval: { status: "APPROVED" },
      }),
    ).toBe(false);
  });

  it("非 APPROVED 状态一律不是当前审批", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "REJECTED"] as const) {
      expect(
        isApprovalCurrent({
          contract_revision: 1,
          approval: { status, approved_revision: 1 },
        }),
      ).toBe(false);
    }
  });
});

describe("原子落盘 writeJsonAtomic", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      // 清理失败不得影响断言结论（沙箱可能拦截 TMPDIR 的 unlink）
      try {
        safeRmSync(dir);
      } catch {
        // ignore
      }
    }
  });

  function newDir(): string {
    const root = path.join(process.cwd(), ".tmp", "unit-atomic");
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, "case-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("写入内容可完整读回，且不残留临时文件", () => {
    const dir = newDir();
    const file = path.join(dir, "nested", "state.json");
    const value = { a: 1, nested: { b: [1, 2, 3] } };

    writeJsonAtomic(file, value);

    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual(value);
    const leftovers = fs
      .readdirSync(path.dirname(file))
      .filter((f) => f !== "state.json");
    expect(leftovers, `leftover temp files: ${leftovers.join(",")}`).toEqual(
      [],
    );
  });

  it("覆盖写不会留下半截 JSON（旧内容被整体替换）", () => {
    const dir = newDir();
    const file = path.join(dir, "state.json");

    writeJsonAtomic(file, { revision: 1, big: "x".repeat(1000) });
    writeJsonAtomic(file, { revision: 2 });

    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      revision: number;
      big?: string;
    };
    expect(parsed).toEqual({ revision: 2 });
  });

  it("目标目录不存在时自动创建", () => {
    const dir = newDir();
    const file = path.join(dir, "a", "b", "c.json");
    expect(() => writeJsonAtomic(file, { ok: true })).not.toThrow();
    expect(fs.existsSync(file)).toBe(true);
  });
});
