import { describe, expect, it } from "vitest";
import { ALL_LIFECYCLE_STATES } from "../../src/lib/state-machine";
import {
  AUDITED_BRANCH_PRIORITY,
  PRESENTATION_STATE_MATRIX,
  PRESENTATION_STATES,
  PresentationStateProjectionError,
  getPresentationState,
  tryGetPresentationState,
  type PresentationRuntimeContext,
  type PresentationState,
  type PresentationStateInput,
} from "../../src/lib/state/presentation-state";
import {
  IPC_FRAME_TYPES,
  createFrame,
  getFrameSpec,
  isIpcFrame,
  type StateChangedPayload,
} from "../../src/lib/ipc/frames";

/**
 * TASK-D.3 / 架构 §6.3.1、§9.6：15 展示状态确定性投影。
 *
 * 判据分三层：
 * 1. 词汇表唯一（不多不少，且禁止旧版别名混入）；
 * 2. 全部展示态逐个可达，且映射由 (lifecycle_state, approval_status) + 运行时判据唯一决定；
 * 3. 四分支短路顺序、ABORTED 边界、非法输入失败行为。
 */

const SS = PRESENTATION_STATES;

function project(
  lifecycle_state: PresentationStateInput["lifecycle_state"],
  approval_status: PresentationStateInput["approval_status"],
  runtime?: PresentationRuntimeContext,
): PresentationState {
  return getPresentationState({ lifecycle_state, approval_status, runtime });
}

describe("词汇表：唯一展示态，无重复无别名", () => {
  it("恰好 16 个取值且无重复（§6.3.1 原 15 + §16.2 PROJECT_MAPPING）", () => {
    expect(SS).toHaveLength(16);
    expect(new Set(SS).size).toBe(16);
  });

  it("与 §9.6 定义的集合完全一致", () => {
    expect([...SS].sort()).toEqual(
      [
        "ABORTED",
        "CONFLICT",
        "DEMO_PREVIEW",
        "DISPUTED_INSPECTING",
        "EXECUTING",
        "EXPLORING",
        "FAILED",
        "GRAPH_MAPPING",
        "MERGED",
        "NEEDS_APPROVAL",
        "PAUSED",
        "PROJECT_MAPPING",
        "READY_TO_MERGE",
        "REAL_PLAYTEST",
        "STOPPING",
        "VERIFYING",
      ].sort(),
    );
  });

  it("禁止旧版/自造展示态别名混入词汇表", () => {
    const forbidden = [
      "INITIAL_EMPTY",
      "CONTRACT_REVIEW",
      "GRAPH_ORCHESTRATING",
      "PREPARING",
      "ADMITTED_PREPARING",
      "STOPPING_RECOVERING",
      "AUDITED_INSPECTING",
    ];
    for (const name of forbidden) {
      expect(SS as readonly string[]).not.toContain(name);
    }
  });
});

describe("§6.3.1 CI 不变式：矩阵中所有 lifecycle 必须存在于状态机枚举", () => {
  it("矩阵逐行可对照，且 lifecycle 全部合法", () => {
    expect(PRESENTATION_STATE_MATRIX).toHaveLength(16);
    for (const row of PRESENTATION_STATE_MATRIX) {
      expect(
        ALL_LIFECYCLE_STATES as readonly string[],
        `${row.presentation_state} 使用了不存在的 lifecycle ${row.lifecycle_state}`,
      ).toContain(row.lifecycle_state);
    }
  });

  it("矩阵覆盖全部展示态，无遗漏无重复", () => {
    const covered = PRESENTATION_STATE_MATRIX.map((r) => r.presentation_state);
    expect([...covered].sort()).toEqual([...SS].sort());
  });
});

describe("全部展示状态逐个可达", () => {
  it("EXPLORING：草案且 Demo 未运行", () => {
    expect(project("DRAFT", "DRAFT")).toBe("EXPLORING");
    expect(
      project("DRAFT", "DRAFT", { demo_service: { status: "IDLE" } }),
    ).toBe("EXPLORING");
  });

  it("DEMO_PREVIEW：草案且 Demo 运行中", () => {
    expect(
      project("DRAFT", "DRAFT", { demo_service: { status: "RUNNING" } }),
    ).toBe("DEMO_PREVIEW");
  });

  it("GRAPH_MAPPING：已批准的 PREPARING（任务拆解中）", () => {
    expect(project("PREPARING", "APPROVED")).toBe("GRAPH_MAPPING");
  });

  it("PROJECT_MAPPING：PREPARING 且 project_mapping（§16.2 整理项目地图）", () => {
    expect(
      project("PREPARING", "APPROVED", { project_mapping: true }),
    ).toBe("PROJECT_MAPPING");
  });


  it("NEEDS_APPROVAL：待审等待授权", () => {
    expect(project("PENDING_APPROVAL", "PENDING_REVIEW")).toBe(
      "NEEDS_APPROVAL",
    );
  });

  it("EXECUTING：施工中且未请求停止", () => {
    expect(project("EXECUTING", "APPROVED")).toBe("EXECUTING");
    expect(
      project("EXECUTING", "APPROVED", { stopping_requested: false }),
    ).toBe("EXECUTING");
  });

  it("STOPPING：施工中且已请求停止", () => {
    expect(project("EXECUTING", "APPROVED", { stopping_requested: true })).toBe(
      "STOPPING",
    );
  });

  it("PAUSED：挂起等待用户决定", () => {
    expect(project("PENDING_RESUME", "APPROVED")).toBe("PAUSED");
    expect(
      project("PENDING_RESUME", "APPROVED", {
        suspend_reason: "BUDGET_EXCEEDED",
      }),
    ).toBe("PAUSED");
  });

  it("VERIFYING / FAILED：按验证结果与重试预算区分", () => {
    // 未判定失败 → 正在检查
    expect(project("VERIFYING", "APPROVED")).toBe("VERIFYING");
    expect(
      project("VERIFYING", "APPROVED", {
        verification: { passed: true, retry_count: 0, max_retries: 3 },
      }),
    ).toBe("VERIFYING");
    // 失败且预算未耗尽 → 检查未通过
    expect(
      project("VERIFYING", "APPROVED", {
        verification: { passed: false, retry_count: 1, max_retries: 3 },
      }),
    ).toBe("FAILED");
  });

  it("FAILED 的边界：重试预算耗尽或无法判定时不误报失败", () => {
    // 预算耗尽 → 状态机应已转 PENDING_RESUME；仍停在 VERIFYING 时保守显示"正在检查"
    expect(
      project("VERIFYING", "APPROVED", {
        verification: { passed: false, retry_count: 3, max_retries: 3 },
      }),
    ).toBe("VERIFYING");
    // 缺 retry_count / max_retries 时无法证明"预算未耗尽"，同样不报 FAILED
    expect(
      project("VERIFYING", "APPROVED", { verification: { passed: false } }),
    ).toBe("VERIFYING");
    expect(
      project("VERIFYING", "APPROVED", {
        verification: { passed: false, retry_count: 1 },
      }),
    ).toBe("VERIFYING");
  });

  it("REAL_PLAYTEST / DISPUTED_INSPECTING / READY_TO_MERGE / CONFLICT：AUDITED 四分支", () => {
    expect(
      project("AUDITED", "APPROVED", { real_preview: { status: "RUNNING" } }),
    ).toBe("REAL_PLAYTEST");
    expect(
      project("AUDITED", "APPROVED", {
        dispute_session: { status: "OPEN" },
      }),
    ).toBe("DISPUTED_INSPECTING");
    expect(
      project("AUDITED", "APPROVED", { evidence: { can_merge: true } }),
    ).toBe("READY_TO_MERGE");
    expect(project("AUDITED", "APPROVED", { target_branch_ahead: true })).toBe(
      "CONFLICT",
    );
  });

  it("MERGED：已合入主干", () => {
    expect(project("MERGED", "APPROVED")).toBe("MERGED");
  });

  it("ABORTED：两种历史审批事实都归一到同一展示态", () => {
    expect(project("ABORTED", "APPROVED")).toBe("ABORTED");
    expect(project("ABORTED", "REJECTED")).toBe("ABORTED");
  });
});

describe("(AUDITED, APPROVED) 四分支：严格按规范优先级短路", () => {
  const ALL_TRUE: PresentationRuntimeContext = {
    target_branch_ahead: true,
    dispute_session: { status: "OPEN" },
    real_preview: { status: "RUNNING" },
    evidence: { can_merge: true },
  };

  it("优先级常量与规范一致", () => {
    expect([...AUDITED_BRANCH_PRIORITY]).toEqual([
      "CONFLICT",
      "DISPUTED_INSPECTING",
      "REAL_PLAYTEST",
      "READY_TO_MERGE",
    ]);
  });

  it("四判据同真 → CONFLICT（安全优先）", () => {
    expect(project("AUDITED", "APPROVED", ALL_TRUE)).toBe("CONFLICT");
  });

  it("去掉 CONFLICT 后 → DISPUTED_INSPECTING（用户诉求优先于体验）", () => {
    expect(
      project("AUDITED", "APPROVED", {
        target_branch_ahead: false,
        dispute_session: { status: "OPEN" },
        real_preview: { status: "RUNNING" },
        evidence: { can_merge: true },
      }),
    ).toBe("DISPUTED_INSPECTING");
  });

  it("再去掉质疑 → REAL_PLAYTEST（体验优先于交付）", () => {
    expect(
      project("AUDITED", "APPROVED", {
        dispute_session: { status: "CLOSED" },
        real_preview: { status: "RUNNING" },
        evidence: { can_merge: true },
      }),
    ).toBe("REAL_PLAYTEST");
  });

  it("只剩可合并 → READY_TO_MERGE", () => {
    expect(
      project("AUDITED", "APPROVED", {
        dispute_session: { status: "CLOSED" },
        real_preview: { status: "STOPPED" },
        evidence: { can_merge: true },
      }),
    ).toBe("READY_TO_MERGE");
  });

  it("判据为假值（false / 缺失）不得触发短路", () => {
    expect(
      project("AUDITED", "APPROVED", {
        target_branch_ahead: false,
        dispute_session: { status: "CLOSED" },
        real_preview: { status: "IDLE" },
        evidence: { can_merge: true },
      }),
    ).toBe("READY_TO_MERGE");
  });

  it("四分支全不成立 → 抛 UNDEFINED_PROJECTION，不猜状态", () => {
    const run = () => project("AUDITED", "APPROVED", {});
    expect(run).toThrowError(PresentationStateProjectionError);
    try {
      run();
    } catch (err) {
      expect((err as PresentationStateProjectionError).code).toBe(
        "UNDEFINED_PROJECTION",
      );
    }
  });
});

describe("输入域校验与确定性", () => {
  it("非法二元组抛 ILLEGAL_STATE_PAIR（与状态机同一事实源）", () => {
    const illegal: Array<
      [
        PresentationStateInput["lifecycle_state"],
        PresentationStateInput["approval_status"],
      ]
    > = [
      ["EXECUTING", "PENDING_REVIEW"],
      ["DRAFT", "APPROVED"],
      ["PENDING_APPROVAL", "APPROVED"],
      ["ABORTED", "DRAFT"],
      ["MERGED", "REJECTED"],
    ];

    for (const [lifecycle, approval] of illegal) {
      const run = () =>
        getPresentationState({
          lifecycle_state: lifecycle,
          approval_status: approval,
        });
      expect(run, `${lifecycle} × ${approval} 必须被拒绝`).toThrowError(
        PresentationStateProjectionError,
      );
      try {
        run();
      } catch (err) {
        expect((err as PresentationStateProjectionError).code).toBe(
          "ILLEGAL_STATE_PAIR",
        );
      }
    }
  });

  it("相同输入恒得相同输出（重复 100 次）", () => {
    const input: PresentationStateInput = {
      lifecycle_state: "EXECUTING",
      approval_status: "APPROVED",
      runtime: { stopping_requested: false },
    };
    const first = getPresentationState(input);
    for (let i = 0; i < 100; i++) {
      expect(getPresentationState(input)).toBe(first);
    }
  });

  it("结果不依赖对象键书写顺序", () => {
    const a = getPresentationState({
      lifecycle_state: "DRAFT",
      approval_status: "DRAFT",
      runtime: {
        demo_service: { status: "RUNNING" },
        stopping_requested: false,
      },
    });
    const b = getPresentationState({
      runtime: {
        stopping_requested: false,
        demo_service: { status: "RUNNING" },
      },
      approval_status: "DRAFT",
      lifecycle_state: "DRAFT",
    });
    expect(a).toBe(b);
    expect(a).toBe("DEMO_PREVIEW");
  });

  it("tryGetPresentationState：成功返回状态，失败返回稳定错误码而不抛", () => {
    expect(
      tryGetPresentationState({
        lifecycle_state: "MERGED",
        approval_status: "APPROVED",
      }),
    ).toEqual({ ok: true, presentation_state: "MERGED" });

    const failed = tryGetPresentationState({
      lifecycle_state: "EXECUTING",
      approval_status: "PENDING_REVIEW",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe("ILLEGAL_STATE_PAIR");
      expect(failed.message).toContain("Illegal state combination");
    }
  });
});

describe("IPC 帧：STATE_CHANGED 携带 presentation_state", () => {
  /** 取出帧载荷；空载荷直接失败，避免用非空断言掩盖协议问题 */
  function payloadOf<T>(frame: { payload?: T | undefined }): T {
    if (frame.payload === undefined) {
      throw new Error("expected frame payload, got undefined");
    }
    return frame.payload;
  }

  it("帧类型与目录已登记", () => {
    expect(IPC_FRAME_TYPES).toContain("STATE_CHANGED");
    const spec = getFrameSpec("STATE_CHANGED");
    expect(spec.direction).toBe("server->client");
    expect(spec.requiresAuth).toBe(true);
    expect(spec.spec).toBe("v1.6.1");
  });

  it("createFrame 产出合法帧，前端可直接解构 presentation_state", () => {
    const payload: StateChangedPayload = {
      contract_id: "contract_1",
      presentation_state: "NEEDS_APPROVAL",
      message: "需要你确认授权",
      lifecycle_state: "PENDING_APPROVAL",
      approval_status: "PENDING_REVIEW",
      persisted_at: "2026-10-23T04:00:00.000Z",
    };
    const frame = createFrame("STATE_CHANGED", payload);

    expect(isIpcFrame(frame)).toBe(true);
    expect(frame.type).toBe("STATE_CHANGED");
    const { presentation_state } = payloadOf(frame);
    expect(presentation_state).toBe("NEEDS_APPROVAL");
  });

  it("投影结果可直接作为帧载荷传递（端到端一致）", () => {
    const presentation_state = getPresentationState({
      lifecycle_state: "AUDITED",
      approval_status: "APPROVED",
      runtime: { evidence: { can_merge: true } },
    });
    const frame = createFrame("STATE_CHANGED", {
      contract_id: "c",
      presentation_state,
    } satisfies StateChangedPayload);
    expect(frame.payload?.presentation_state).toBe("READY_TO_MERGE");
  });
});
