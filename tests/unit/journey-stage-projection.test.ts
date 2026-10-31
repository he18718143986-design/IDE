import { describe, expect, it } from "vitest";
import {
  JOURNEY_SUBSTATES,
  projectJourneyStage,
  type JourneyStageInput,
  type JourneySubstate,
} from "../../src/lib/state/journey-stage";

/**
 * TASK-J.8 / J-01（SSOT §16.2 / §18）：JourneyStage 投影表驱动测试。
 * 每个映射行至少一条用例；表外组合必须告警且落到「施工 · 等你决定」。
 */

const base = (over: Partial<JourneyStageInput>): JourneyStageInput => ({
  delivery_state: null,
  transient: null,
  lifecycle_state: null,
  presentation_state: null,
  has_contract: false,
  ...over,
});

const CASES: ReadonlyArray<{
  name: string;
  input: JourneyStageInput;
  expect: {
    stage: string;
    substate: JourneySubstate;
    archived?: boolean;
    warning?: string;
  };
}> = [
  {
    name: "方案 · 聊天中（无合同）",
    input: base({
      delivery_state: "PLAN_DRAFTING",
      presentation_state: "EXPLORING",
    }),
    expect: { stage: "scheme", substate: "plan_chatting" },
  },
  {
    name: "方案 · 聊天中（DRAFT 合同，PLAN_READY）",
    input: base({
      delivery_state: "PLAN_READY",
      lifecycle_state: "DRAFT",
      presentation_state: "EXPLORING",
      has_contract: true,
    }),
    expect: { stage: "scheme", substate: "plan_chatting" },
  },
  {
    name: "方案 · Demo 试看",
    input: base({
      delivery_state: "DEMO_READY",
      lifecycle_state: "DRAFT",
      presentation_state: "DEMO_PREVIEW",
      has_contract: true,
    }),
    expect: { stage: "scheme", substate: "plan_demo" },
  },
  {
    name: "方案 · 交接中（瞬态 CONTRACT_SIGNING，PREPARING）",
    input: base({
      transient: "CONTRACT_SIGNING",
      lifecycle_state: "PREPARING",
      presentation_state: "GRAPH_MAPPING",
      has_contract: true,
    }),
    expect: { stage: "scheme", substate: "plan_handoff" },
  },
  {
    name: "方案 · 整理项目地图（PROJECT_MAPPING，无施工合同）",
    input: base({
      delivery_state: "PLAN_CONFIRMED",
      presentation_state: "PROJECT_MAPPING",
    }),
    expect: { stage: "scheme", substate: "plan_project_mapping" },
  },
  {
    name: "方案 · 整理项目地图（PROJECT_MAPPING，PREPARING 桩）",
    input: base({
      delivery_state: "PLAN_CONFIRMED",
      lifecycle_state: "PREPARING",
      presentation_state: "PROJECT_MAPPING",
      has_contract: true,
    }),
    expect: { stage: "scheme", substate: "plan_project_mapping" },
  },
  {
    name: "施工 · 进行中",
    input: base({
      delivery_state: "IMPLEMENTING",
      lifecycle_state: "EXECUTING",
      presentation_state: "EXECUTING",
      has_contract: true,
    }),
    expect: { stage: "construction", substate: "build_running" },
  },
  {
    name: "施工 · 自动检查（VERIFYING）",
    input: base({
      delivery_state: "VERIFYING",
      lifecycle_state: "VERIFYING",
      presentation_state: "VERIFYING",
      has_contract: true,
    }),
    expect: { stage: "construction", substate: "build_checking" },
  },
  {
    name: "施工 · 自动检查未通过（FAILED 亦属自动检查）",
    input: base({
      delivery_state: "VERIFYING",
      lifecycle_state: "VERIFYING",
      presentation_state: "FAILED",
      has_contract: true,
    }),
    expect: { stage: "construction", substate: "build_checking" },
  },
  {
    name: "施工 · 返工（REWORK_REQUIRED）",
    input: base({
      delivery_state: "REWORK_REQUIRED",
      lifecycle_state: "VERIFYING",
      presentation_state: "EXECUTING",
      has_contract: true,
    }),
    expect: { stage: "construction", substate: "build_rework" },
  },
  {
    name: "施工 · 等你决定（PAUSED）",
    input: base({
      delivery_state: "PAUSED",
      lifecycle_state: "PENDING_RESUME",
      presentation_state: "PAUSED",
      has_contract: true,
    }),
    expect: { stage: "construction", substate: "waiting_for_you" },
  },
  {
    name: "施工 · 等你决定（ESCALATED_HUMAN 需授权）",
    input: base({
      delivery_state: "ESCALATED_HUMAN",
      lifecycle_state: "PENDING_APPROVAL",
      presentation_state: "NEEDS_APPROVAL",
      has_contract: true,
    }),
    expect: { stage: "construction", substate: "waiting_for_you" },
  },
  {
    name: "施工 · 正在停止（EXECUTING + STOPPING）",
    input: base({
      delivery_state: "IMPLEMENTING",
      lifecycle_state: "EXECUTING",
      presentation_state: "STOPPING",
      has_contract: true,
    }),
    expect: { stage: "construction", substate: "build_stopping" },
  },
  {
    name: "试玩 · 体验中（READY_TO_MERGE）",
    input: base({
      delivery_state: "CANDIDATE_VERIFIED",
      lifecycle_state: "AUDITED",
      presentation_state: "READY_TO_MERGE",
      has_contract: true,
    }),
    expect: { stage: "playtest", substate: "playtest_live" },
  },
  {
    name: "试玩 · 自查中（DISPUTED_INSPECTING）",
    input: base({
      delivery_state: "CANDIDATE_VERIFIED",
      lifecycle_state: "AUDITED",
      presentation_state: "DISPUTED_INSPECTING",
      has_contract: true,
    }),
    expect: { stage: "playtest", substate: "playtest_inspecting" },
  },
  {
    name: "试玩 · 项目有新改动（CONFLICT）",
    input: base({
      delivery_state: "CANDIDATE_VERIFIED",
      lifecycle_state: "AUDITED",
      presentation_state: "CONFLICT",
      has_contract: true,
    }),
    expect: { stage: "playtest", substate: "playtest_conflict" },
  },
  {
    name: "已合入",
    input: base({
      delivery_state: "MERGED",
      lifecycle_state: "MERGED",
      presentation_state: "MERGED",
      has_contract: true,
    }),
    expect: { stage: "merged", substate: "merged", archived: false },
  },
  {
    name: "已放弃（有合同）",
    input: base({
      delivery_state: "ABORTED",
      lifecycle_state: "ABORTED",
      presentation_state: "ABORTED",
      has_contract: true,
    }),
    expect: { stage: "aborted", substate: "aborted", archived: false },
  },
];

describe("JourneyStage 投影 · SSOT §16.2 表驱动（J-01）", () => {
  it.each(CASES)("$name", ({ input, expect: want }) => {
    const got = projectJourneyStage(input);
    expect(got.stage).toBe(want.stage);
    expect(got.substate).toBe(want.substate);
    expect(got.archived).toBe(want.archived ?? false);
    expect(got.warning).toBeUndefined();
  });

  it("覆盖 §16.2 全部子态：每个子态至少一条用例", () => {
    const covered = new Set(CASES.map((c) => c.expect.substate));
    for (const substate of JOURNEY_SUBSTATES) {
      expect(covered.has(substate), `缺少子态用例：${substate}`).toBe(true);
    }
  });
});

describe("JourneyStage 投影 · 表外组合与 DELIVERED", () => {
  it("MERGED + EXECUTING（表外）→ 施工 · 等你决定 + UNMAPPED_COMBINATION", () => {
    const got = projectJourneyStage(
      base({
        delivery_state: "MERGED",
        lifecycle_state: "EXECUTING",
        presentation_state: "EXECUTING",
        has_contract: true,
      }),
    );
    expect(got).toEqual({
      stage: "construction",
      substate: "waiting_for_you",
      archived: false,
      warning: "UNMAPPED_COMBINATION",
    });
  });

  it("有合同但 lifecycle 缺失（与 has_contract 不一致）→ 表外", () => {
    const got = projectJourneyStage(
      base({ delivery_state: "IMPLEMENTING", has_contract: true }),
    );
    expect(got.warning).toBe("UNMAPPED_COMBINATION");
    expect(got.substate).toBe("waiting_for_you");
  });

  it("已放弃（无合同且展示态缺失）→ 表外：合同列「或无合同」不放宽展示态列（§16.2）", () => {
    const got = projectJourneyStage(base({ delivery_state: "ABORTED" }));
    expect(got).toEqual({
      stage: "construction",
      substate: "waiting_for_you",
      archived: false,
      warning: "UNMAPPED_COMBINATION",
    });
  });

  it("展示态缺失（null）无法命中施工行 → 表外，不猜测", () => {
    const got = projectJourneyStage(
      base({
        delivery_state: "IMPLEMENTING",
        lifecycle_state: "EXECUTING",
        presentation_state: null,
        has_contract: true,
      }),
    );
    expect(got.warning).toBe("UNMAPPED_COMBINATION");
  });

  it("DELIVERED → 已合入并附 archived === true（ADR-0012 呈现收口）", () => {
    const got = projectJourneyStage(
      base({
        delivery_state: "DELIVERED",
        lifecycle_state: "DELIVERED",
        presentation_state: "MERGED",
        has_contract: true,
      }),
    );
    expect(got).toEqual({
      stage: "merged",
      substate: "merged",
      archived: true,
    });
  });

  it("IMPLEMENTING 且 PAUSED 展示态 → 表外（不把暂停当成进行中）", () => {
    const got = projectJourneyStage(
      base({
        delivery_state: "IMPLEMENTING",
        lifecycle_state: "EXECUTING",
        presentation_state: "PAUSED",
        has_contract: true,
      }),
    );
    expect(got.warning).toBe("UNMAPPED_COMBINATION");
  });
});
