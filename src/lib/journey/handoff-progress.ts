/**
 * TASK-J.7 / SSOT §16.3：确认开工交接的三步人话进度。
 *
 * 五阶段事务（CLAIM…COMMIT）投影为三步用户可见进度；
 * 纯函数，零副作用。
 */

import type { ConfirmSchemeStepId } from "./confirm-scheme-atomic";

export const HANDOFF_UI_STEPS = [
  {
    id: "save_scheme",
    label: "保存你确认的方案",
  },
  {
    id: "prepare_workspace",
    label: "准备隔离的施工区",
  },
  {
    id: "arrange_steps",
    label: "安排施工步骤",
  },
] as const;

export type HandoffUiStepId = (typeof HANDOFF_UI_STEPS)[number]["id"];

/** 事务阶段 → 人话进度步；建任务图由调用方在 SIGN 内显式推到 arrange_steps。 */
export function confirmStepToHandoffUi(
  step: ConfirmSchemeStepId,
): HandoffUiStepId {
  switch (step) {
    case "CLAIM_AND_QUIESCE":
    case "VALIDATE_CONFIRMATION":
    case "FREEZE_SNAPSHOT":
      return "save_scheme";
    case "SIGN_AND_PREPARE":
      return "prepare_workspace";
    case "COMMIT":
      return "arrange_steps";
  }
}

export function handoffStepIndex(id: HandoffUiStepId): number {
  return HANDOFF_UI_STEPS.findIndex((s) => s.id === id);
}

/** COMMIT 成功后中栏画布卡片文案（DEC-005：不进右栏）。 */
export function formatHandoffStartedCard(input: {
  nodeCount: number;
  budgetPlain: string;
}): string {
  const n = Math.max(0, input.nodeCount);
  const budget = input.budgetPlain.trim() || "预计几分钟";
  return `开工了。一共 ${n} 步，${budget}。你可以离开，做完或需要你的时候我会提醒你。`;
}

export const HANDOFF_LOCK_HINT = "正在交接，几秒后可以继续聊";

export const HANDOFF_COMPENSATION_FAILED_MESSAGE =
  "这次准备没清理干净，需要你手动处理";

/** 冻结后的右栏消息不得回写方案（D9 / J-02）。 */
export function partnerMessageMayRebuildScheme(
  scheme: { frozen?: boolean } | null | undefined,
): boolean {
  return scheme?.frozen !== true;
}
