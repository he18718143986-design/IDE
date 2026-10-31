/**
 * 意图编译器状态横幅文案（TASK-J.10 / V-06）。
 * UI 与 compile-loop 共用，避免组件依赖 daemon。
 */

export const OFFLINE_BANNER_TEXT = "方案助手未连接";

export const COMPILING_BANNER_TEXT = "正在整理你刚说的…";

export const BUDGET_EXCEEDED_BANNER_TEXT =
  "方案助手今天的额度用完了，方案暂停自动整理；你仍可以继续聊或手改方案";

export const FAILURE_BANNER_TEXT =
  "方案助手连续整理失败，已暂时停下；你仍可以继续聊或手改方案";

/** @deprecated 与 COMPILING_BANNER_TEXT 同义，保留别名便于旧调用 */
export const STALE_BANNER_TEXT = COMPILING_BANNER_TEXT;
export const COMPILER_BUSY_BANNER_TEXT = COMPILING_BANNER_TEXT;
export const COMPILER_FAILED_BANNER_TEXT = FAILURE_BANNER_TEXT;
