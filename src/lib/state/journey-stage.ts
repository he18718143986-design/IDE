/**
 * TASK-J.8 / SSOT supervisor.md §16.2 / §18 J-01 / §19 L-08、L-10：
 * JourneyStage 投影（纯函数，零副作用）。
 *
 * 用户可见的「当前在哪一幕、幕内什么子态」只由本模块算出，Daemon 随
 * STATE_CHANGED 下发；前端只消费，不得自行组合底层状态推导。
 *
 * 表外组合 → 「施工 · 等你决定」+ UNMAPPED_COMBINATION 告警，禁止猜测。
 * DELIVERED 不出现在 §16.2 表中（ADR-0012），投影为「已合入」并附 archived。
 * 本卡不删除 DeliveryState 的 DELIVERED 枚举。
 */
import type { ActivityTransient, DeliveryState } from "./delivery-state";
import type { PresentationState } from "./presentation-state";

/** 四幕 + 已合入 / 已放弃 */
export const JOURNEY_STAGES = [
  "scheme",
  "construction",
  "playtest",
  "merged",
  "aborted",
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** 幕内子态：与 §16.2 表的每一行一一对应（「施工 · 等你决定」合并 PAUSED / ESCALATED） */
export const JOURNEY_SUBSTATES = [
  "plan_chatting",
  "plan_demo",
  "plan_handoff",
  "plan_project_mapping",
  "build_running",
  "build_checking",
  "build_rework",
  "waiting_for_you",
  "build_stopping",
  "playtest_live",
  "playtest_inspecting",
  "playtest_conflict",
  "merged",
  "aborted",
] as const;
export type JourneySubstate = (typeof JOURNEY_SUBSTATES)[number];

export const JOURNEY_WARNINGS = ["UNMAPPED_COMBINATION"] as const;
export type JourneyWarning = (typeof JOURNEY_WARNINGS)[number];

export interface JourneyStageInput {
  /** 不含瞬态的交付主态（projectDeliveryState 无瞬态重载的结果） */
  readonly delivery_state: DeliveryState | null;
  /** 轨 C 瞬态（仅 CONTRACT_SIGNING 参与映射） */
  readonly transient: ActivityTransient | null;
  /** 底层合同 lifecycle_state；无合同为 null */
  readonly lifecycle_state: string | null;
  /** 展示态；无法给出时为 null */
  readonly presentation_state: PresentationState | null;
  readonly has_contract: boolean;
}

export interface JourneyStageProjection {
  readonly stage: JourneyStage;
  readonly substate: JourneySubstate;
  /** 「已合入」幕的「已归档」小标记 */
  readonly archived: boolean;
  readonly warning?: JourneyWarning;
}

/**
 * 映射表行。字段省略含义：
 * - delivery / lifecycle / presentation 省略 = 不约束；
 * - transient 省略 = 必须为 null（只有交接行显式声明 CONTRACT_SIGNING）。
 */
interface JourneyRow {
  readonly substate: JourneySubstate;
  readonly delivery?: readonly DeliveryState[];
  readonly transient?: readonly (ActivityTransient | null)[];
  readonly lifecycle?: readonly (string | null)[];
  readonly presentation?: readonly (PresentationState | null)[];
}

/** 与 SSOT §16.2 表逐行对应（行序即匹配序，各行互斥） */
export const JOURNEY_ROWS: readonly JourneyRow[] = [
  {
    substate: "plan_chatting",
    delivery: ["PLAN_DRAFTING", "PLAN_READY"],
    transient: [null],
    lifecycle: [null, "DRAFT"],
    presentation: ["EXPLORING"],
  },
  {
    substate: "plan_demo",
    delivery: ["PLAN_CONFIRMED", "DEMO_READY"],
    transient: [null],
    lifecycle: [null, "DRAFT"],
    presentation: ["DEMO_PREVIEW"],
  },
  {
    substate: "plan_handoff",
    transient: ["CONTRACT_SIGNING"],
    lifecycle: ["PENDING_APPROVAL", "PREPARING"],
    presentation: ["GRAPH_MAPPING"],
  },
  {
    // 方案 · 整理项目地图（supervisor §16.2 / J-01）：与交接中 GRAPH_MAPPING 互斥；右栏可聊
    substate: "plan_project_mapping",
    transient: [null],
    lifecycle: [null, "PREPARING"],
    presentation: ["PROJECT_MAPPING"],
  },
  {
    substate: "build_running",
    delivery: ["IMPLEMENTING"],
    lifecycle: ["EXECUTING"],
    presentation: ["EXECUTING"],
  },
  {
    substate: "build_checking",
    delivery: ["VERIFYING"],
    lifecycle: ["VERIFYING"],
    presentation: ["VERIFYING", "FAILED"],
  },
  {
    // 返工在状态快照上只能观察到 REWORK_REQUIRED；回到 IMPLEMENTING 后与「进行中」无法区分
    substate: "build_rework",
    delivery: ["REWORK_REQUIRED"],
    lifecycle: ["VERIFYING", "EXECUTING"],
    presentation: ["EXECUTING"],
  },
  {
    substate: "waiting_for_you",
    delivery: ["PAUSED", "ESCALATED_HUMAN"],
    lifecycle: ["PENDING_RESUME", "PENDING_APPROVAL"],
    presentation: ["PAUSED", "NEEDS_APPROVAL"],
  },
  {
    substate: "build_stopping",
    delivery: ["IMPLEMENTING"],
    lifecycle: ["EXECUTING"],
    presentation: ["STOPPING"],
  },
  {
    substate: "playtest_live",
    delivery: ["CANDIDATE_VERIFIED"],
    lifecycle: ["AUDITED"],
    presentation: ["REAL_PLAYTEST", "READY_TO_MERGE"],
  },
  {
    substate: "playtest_inspecting",
    delivery: ["CANDIDATE_VERIFIED"],
    lifecycle: ["AUDITED"],
    presentation: ["DISPUTED_INSPECTING"],
  },
  {
    substate: "playtest_conflict",
    delivery: ["CANDIDATE_VERIFIED"],
    lifecycle: ["AUDITED"],
    presentation: ["CONFLICT"],
  },
  {
    substate: "merged",
    delivery: ["MERGED"],
    lifecycle: ["MERGED"],
    presentation: ["MERGED"],
  },
  {
    substate: "aborted",
    delivery: ["ABORTED"],
    lifecycle: ["ABORTED", null],
    presentation: ["ABORTED"],
  },
];

const STAGE_OF: Readonly<Record<JourneySubstate, JourneyStage>> = {
  plan_chatting: "scheme",
  plan_demo: "scheme",
  plan_handoff: "scheme",
  plan_project_mapping: "scheme",
  build_running: "construction",
  build_checking: "construction",
  build_rework: "construction",
  waiting_for_you: "construction",
  build_stopping: "construction",
  playtest_live: "playtest",
  playtest_inspecting: "playtest",
  playtest_conflict: "playtest",
  merged: "merged",
  aborted: "aborted",
};

function inSet<T>(allowed: readonly T[] | undefined, value: T): boolean {
  return allowed === undefined || allowed.includes(value);
}

function rowMatches(row: JourneyRow, input: JourneyStageInput): boolean {
  const transientAllowed = row.transient ?? [null];
  return (
    (input.delivery_state === null
      ? row.delivery === undefined
      : inSet(row.delivery, input.delivery_state)) &&
    inSet(transientAllowed, input.transient) &&
    inSet(row.lifecycle, input.lifecycle_state) &&
    inSet(row.presentation, input.presentation_state)
  );
}

/** 「施工 · 等你决定」：表外组合的安全子态（§16.2 规则） */
const UNMAPPED: JourneyStageProjection = {
  stage: "construction",
  substate: "waiting_for_you",
  archived: false,
  warning: "UNMAPPED_COMBINATION",
};

/**
 * 投影幕次与子态。
 * 1. 有无合同必须与 lifecycle_state 一致，否则视为表外组合；
 * 2. DELIVERED 投影为「已合入」并附 archived；
 * 3. 其余按 §16.2 表逐行匹配，无命中即表外组合。
 */
export function projectJourneyStage(
  input: JourneyStageInput,
): JourneyStageProjection {
  if (input.has_contract !== (input.lifecycle_state !== null)) {
    return UNMAPPED;
  }
  if (input.delivery_state === "DELIVERED") {
    return { stage: "merged", substate: "merged", archived: true };
  }
  const row = JOURNEY_ROWS.find((candidate) => rowMatches(candidate, input));
  if (!row) return UNMAPPED;
  return {
    stage: STAGE_OF[row.substate],
    substate: row.substate,
    archived: false,
  };
}
