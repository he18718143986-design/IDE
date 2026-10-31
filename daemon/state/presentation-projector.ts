import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { StateChangedPayload } from "../../src/lib/ipc/frames";
import {
  tryGetPresentationState,
  type PresentationRuntimeContext,
  type PresentationState,
} from "../../src/lib/state/presentation-state";
import type { PersistedPresentationRecord } from "./presentation-store";
import type { SeqStamp } from "./session-seq";
import {
  projectDeliveryState,
  type ActivityTransient,
  type DemoMode,
} from "../../src/lib/state/delivery-state";
import {
  projectJourneyStage,
  type JourneyStageInput,
  type JourneyWarning,
} from "../../src/lib/state/journey-stage";

/**
 * TASK-D.3（续）：把合同 + 运行时判据投影成可持久化/可广播的记录。
 *
 * 本模块**不重复实现映射规则**——唯一事实源仍是
 * `src/lib/state/presentation-state.ts` 的 `getPresentationState`。
 * 这里只做三件外围工作：收集 daemon 现有信号、给出白话文案、组装载荷。
 */

/** daemon 当前能拿到的运行时判据（拿不到的一律留空，不猜） */
export interface DaemonRuntimeSignals {
  /** 用户已请求停止（§6.3.1 EXECUTING → STOPPING 的判据） */
  readonly stopping_requested?: boolean;
  readonly verification?:
    | {
        readonly passed?: boolean;
        readonly retry_count?: number;
        readonly max_retries?: number;
      }
    | undefined;
  /** 最新证据的可合并性（AUDITED 四分支之一） */
  readonly evidence?: { readonly can_merge?: boolean } | undefined;
  /** 目标分支是否已前进（AUDITED → CONFLICT） */
  readonly target_branch_ahead?: boolean | undefined;
  /** Demo 预览是否在跑（DRAFT → DEMO_PREVIEW） */
  readonly demo_running?: boolean | undefined;
  /** 是否存在未决质疑（AUDITED → DISPUTED_INSPECTING） */
  readonly dispute_open?: boolean | undefined;
  /** 真实环境预览是否在跑（AUDITED → REAL_PLAYTEST） */
  readonly real_preview_running?: boolean | undefined;
  /** supervisor §16.2：规划密封后整理项目地图（PREPARING → PROJECT_MAPPING） */
  readonly project_mapping?: boolean | undefined;
}

/** §6.3.1 的白话文案：前端不做任何状态到文案的映射 */
export const PRESENTATION_MESSAGES: Readonly<
  Record<PresentationState, string>
> = {
  EXPLORING: "正在和你确认需求",
  DEMO_PREVIEW: "原型已经可以试玩",
  GRAPH_MAPPING: "正在把需求拆成可执行的任务",
  PROJECT_MAPPING: "正在整理项目地图",
  NEEDS_APPROVAL: "需要你确认授权后才能继续",
  EXECUTING: "正在按计划施工",
  STOPPING: "正在停止并回收资源",
  PAUSED: "已暂停，等你决定下一步",
  VERIFYING: "正在检查这次的成果",
  FAILED: "检查没有通过，正在等待修复",
  REAL_PLAYTEST: "真实环境试玩中",
  DISPUTED_INSPECTING: "正在做质疑自查",
  READY_TO_MERGE: "验收完成，可以合入了",
  CONFLICT: "检测到目标分支有新的改动，需要你选择处理方式",
  MERGED: "已交付归档",
  ABORTED: "任务已终止，工作区已清理",
};

/** 给某一展示态配一句白话（可选带上合同标题，便于多任务并列时区分） */
export function humanMessageFor(
  state: PresentationState,
  contract?: { intent?: { title?: string } },
): string {
  const title = contract?.intent?.title?.trim();
  const base = PRESENTATION_MESSAGES[state];
  return title ? `${title}：${base}` : base;
}

function toRuntimeContext(
  signals: DaemonRuntimeSignals,
): PresentationRuntimeContext {
  return {
    ...(signals.demo_running === undefined
      ? {}
      : {
          demo_service: { status: signals.demo_running ? "RUNNING" : "IDLE" },
        }),
    ...(signals.stopping_requested === undefined
      ? {}
      : { stopping_requested: signals.stopping_requested }),
    ...(signals.verification === undefined
      ? {}
      : { verification: signals.verification }),
    ...(signals.real_preview_running === undefined
      ? {}
      : {
          real_preview: {
            status: signals.real_preview_running ? "RUNNING" : "STOPPED",
          },
        }),
    ...(signals.dispute_open === undefined
      ? {}
      : {
          dispute_session: { status: signals.dispute_open ? "OPEN" : "CLOSED" },
        }),
    ...(signals.evidence === undefined ? {} : { evidence: signals.evidence }),
    ...(signals.target_branch_ahead === undefined
      ? {}
      : { target_branch_ahead: signals.target_branch_ahead }),
    ...(signals.project_mapping === undefined
      ? {}
      : { project_mapping: signals.project_mapping }),
  };
}

/**
 * 投影一份合同。
 *
 * 返回 `null` 表示「当前信息不足以给出确定性展示态」（例如 AUDITED 但证据不可
 * 合并、且无其它判据）。此时调用方应**跳过广播而不是编一个状态**——
 * 前端宁可停在上一帧，也不该看到错误的白话提示。
 */
export function projectContract(
  contract: SoftwareContract,
  signals: DaemonRuntimeSignals = {},
  now: () => Date = () => new Date(),
): PersistedPresentationRecord | null {
  const result = tryGetPresentationState({
    lifecycle_state: contract.lifecycle_state,
    approval_status: contract.approval.status,
    runtime: toRuntimeContext(signals),
  });

  if (!result.ok) return null;

  return {
    contract_id: contract.contract_id,
    presentation_state: result.presentation_state,
    lifecycle_state: contract.lifecycle_state,
    approval_status: contract.approval.status,
    message: humanMessageFor(result.presentation_state, contract),
    updated_at: now().toISOString(),
  };
}

/** 把持久化记录转成 `STATE_CHANGED` 载荷（字段一一对应，避免两处漂移） */
export function toStateChangedPayload(
  record: PersistedPresentationRecord,
  extras?: {
    seq?: SeqStamp;
    activity_transient?: ActivityTransient | null;
    demo_confirmed?: boolean;
    demo_mode?: DemoMode | null;
    /** TASK-J.8：投影表外组合时回调（由 Daemon 写 daemon.jsonl，载荷不带告警） */
    on_journey_warning?: (
      warning: JourneyWarning,
      input: JourneyStageInput,
    ) => void;
  },
): StateChangedPayload {
  const delivery_state = projectDeliveryState({
    lifecycle_state: record.lifecycle_state,
    activity_transient: extras?.activity_transient ?? null,
    // exactOptionalPropertyTypes：这两个字段可能没传，省略键而不是显式传 undefined
    ...(extras?.demo_confirmed !== undefined
      ? { demo_confirmed: extras.demo_confirmed }
      : {}),
    ...(extras?.demo_mode !== undefined ? { demo_mode: extras.demo_mode } : {}),
  });
  // TASK-J.8：幕次投影只消费不含瞬态的主态；瞬态单独作为输入
  const base_delivery = projectDeliveryState({
    lifecycle_state: record.lifecycle_state,
    ...(extras?.demo_confirmed !== undefined
      ? { demo_confirmed: extras.demo_confirmed }
      : {}),
    ...(extras?.demo_mode !== undefined ? { demo_mode: extras.demo_mode } : {}),
  });
  const journey_input: JourneyStageInput = {
    delivery_state: base_delivery,
    transient: extras?.activity_transient ?? null,
    lifecycle_state: record.lifecycle_state,
    presentation_state: record.presentation_state,
    has_contract: true,
  };
  const journey = projectJourneyStage(journey_input);
  if (journey.warning) {
    extras?.on_journey_warning?.(journey.warning, journey_input);
  }
  return {
    contract_id: record.contract_id,
    presentation_state: record.presentation_state,
    message: record.message,
    lifecycle_state: record.lifecycle_state,
    approval_status: record.approval_status,
    persisted_at: record.updated_at,
    ...(extras?.seq
      ? {
          session_epoch: extras.seq.session_epoch,
          state_seq: extras.seq.state_seq,
        }
      : {}),
    delivery_state,
    journey_stage: journey.stage,
    journey_substate: journey.substate,
    journey_archived: journey.archived,
  };
}

/**
 * 读取某合同最新一份证据的 `can_merge`。
 *
 * 为什么直接读目录而不复用 merger：merger 的加载函数未导出，且投影只需要
 * 一个布尔量。文件名形如 `<contract_id>-<evidence_id>.json`，evidence_id
 * 内含 `Date.now()`，按文件名倒序即最新。
 */
export function readLatestEvidenceSignal(
  repoRoot: string,
  contractId: string,
): { can_merge: boolean } | undefined {
  const dir = path.join(repoRoot, ".stagent", "evidence");
  if (!fs.existsSync(dir)) return undefined;

  const prefix = `${contractId}-`;
  let candidates: string[];
  try {
    candidates = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    return undefined;
  }

  for (const name of candidates) {
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8"),
      );
      if (typeof parsed !== "object" || parsed === null) continue;
      const verdict = (parsed as { verdict?: unknown }).verdict;
      if (typeof verdict !== "object" || verdict === null) continue;
      const canMerge = (verdict as { can_merge?: unknown }).can_merge;
      if (typeof canMerge === "boolean") return { can_merge: canMerge };
    } catch {
      // 损坏的证据跳过，继续找上一份
    }
  }
  return undefined;
}
