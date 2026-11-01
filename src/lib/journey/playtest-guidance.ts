/**
 * TASK-L.17b：右栏试玩引导（复用 L.16「让 AI 看看」通道 · TASK-L.16 / dec-12）。
 *
 * - origin:system 插桩：引导消息带 `origin: "system"`，与 L.16
 *   `insertLiveIncidentStub` 生成的修复桩同源（系统提示，不是用户/AI 承诺）；
 * - intent-router 分流：修改意见经 `classifyJourneyIntent` 回流「微合同修正闭环」；
 * - 右栏搭档仍只读白名单：所有引导消息 `read_only: true` / `executable: false` /
 *   空 `permissions`，引导只是提示，不带任何可执行权限（conf-7 / DEC-005 不变）。
 *
 * 本模块为纯函数，不落盘、不派工、不执行命令、不碰 canvas 模块。
 */
import {
  classifyJourneyIntent,
  type JourneyIntentKind,
  type JourneyIntentResult,
} from "./intent-router";

/** 复用 L.16「让 AI 看看」通道标记 */
export const PLAYTEST_GUIDANCE_CHANNEL = "ask-ai-look" as const;
/** 与 L.16 origin:system 插桩同源 */
export const PLAYTEST_GUIDANCE_ORIGIN = "system" as const;

export interface PlaytestGuidanceMessage {
  origin: typeof PLAYTEST_GUIDANCE_ORIGIN;
  channel: typeof PLAYTEST_GUIDANCE_CHANNEL;
  text: string;
  /** 只读白名单：引导只是提示，不带可执行权限 */
  read_only: true;
  executable: false;
  /** 空权限集：绝不携带写入 / 命令 / 派工能力 */
  permissions: readonly [];
}

export interface PlaytestGuidanceInput {
  contractLabel?: string | undefined;
  referenceUrls?: readonly string[] | undefined;
}

/** 生成试玩引导消息（系统插桩式提示，不含可执行权限） */
export function buildPlaytestGuidance(
  input: PlaytestGuidanceInput = {},
): PlaytestGuidanceMessage[] {
  const refs =
    input.referenceUrls?.filter((u) => u.trim().length > 0) ?? [];
  const label = input.contractLabel?.trim() || "当前版本";
  const refLine =
    refs.length > 0
      ? `参考站：${refs.slice(0, 3).join("、")}`
      : "参考站抓取成果（左栏）";
  const msg = (text: string): PlaytestGuidanceMessage => ({
    origin: PLAYTEST_GUIDANCE_ORIGIN,
    channel: PLAYTEST_GUIDANCE_CHANNEL,
    text,
    read_only: true,
    executable: false,
    permissions: [],
  });
  return [
    msg(
      `开始试玩：左栏是${refLine}，右栏是当前 LIVE 版本「${label}」的真实预览。请对照两边自己点点用用，人眼比对差异。`,
    ),
    msg(
      "这一步只供人眼对照，不做像素 / DOM 机器比对（REJ-009）。差异和修改意见请你用白话说出来。",
    ),
    msg(
      "试玩后如果认可「一模一样」，请明确表态（点「认可完成」或写一句认可原话），才会生成带版本号的认可证据。",
    ),
    msg(
      "想改哪里就直接说：小事走快速通道、大事出草案，修改意见会回流成微合同修正；新版本上线后旧认可自动失效，需重新试玩确认。",
    ),
  ];
}

export type PlaytestFeedbackLoop =
  | "MICRO_CONTRACT_REVISION"
  | "DISPUTE_SELF_CHECK"
  | "STAY_IN_PLAYTEST"
  | "CHAT";

export interface PlaytestFeedbackRoute {
  intent: JourneyIntentResult;
  loop: PlaytestFeedbackLoop;
  /** 修改意见回流微合同 → 新版本 → 旧认可失效（版本指纹重置预告） */
  invalidatesCurrentApproval: boolean;
  plain_summary: string;
}

/**
 * 修改意见回流分流：复用 L.16 的 intent-router（同一句话恒得同一结论）。
 * 只读：本函数只返回路由结论，不执行任何写入 / 派工 / 命令。
 */
export function routePlaytestFeedback(raw: string): PlaytestFeedbackRoute {
  const intent = classifyJourneyIntent(raw);
  const kind: JourneyIntentKind = intent.kind;
  switch (kind) {
    case "FAST_PATH":
    case "MAJOR_DRAFT":
      return {
        intent,
        loop: "MICRO_CONTRACT_REVISION",
        invalidatesCurrentApproval: true,
        plain_summary:
          "已把你这句修改意见分流到微合同修正闭环：出 / 更新草案 → 新版本部署后旧认可自动失效，请重新试玩确认。",
      };
    case "DISPUTE":
      return {
        intent,
        loop: "DISPUTE_SELF_CHECK",
        invalidatesCurrentApproval: false,
        plain_summary:
          "已分流到质疑自查：对照需求与代码，用白话判断是施工漏了还是新需求。",
      };
    case "REAL_PLAYTEST":
      return {
        intent,
        loop: "STAY_IN_PLAYTEST",
        invalidatesCurrentApproval: false,
        plain_summary: "继续对照参考站试玩，右栏真实预览保持不变。",
      };
    default:
      return {
        intent,
        loop: "CHAT",
        invalidatesCurrentApproval: false,
        plain_summary:
          "先记下你的话，交给右栏搭档继续聊（只读，不产生任何写入）。",
      };
  }
}

/** 只读白名单自检：所有引导消息恒为 system 源、只读、不可执行、零权限 */
export function assertGuidanceReadOnly(
  messages: readonly PlaytestGuidanceMessage[],
): boolean {
  return messages.every(
    (m) =>
      m.origin === PLAYTEST_GUIDANCE_ORIGIN &&
      m.channel === PLAYTEST_GUIDANCE_CHANNEL &&
      m.read_only === true &&
      m.executable === false &&
      m.permissions.length === 0,
  );
}
