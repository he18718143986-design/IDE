/**
 * TASK-C.10c / C.16 / C.18：工作台用户可见白话标签。
 *
 * C.18：中间单页「方案审阅」；ActivityBar 单门仍进工作台（列表+方案）。
 * 旧五视口名称不再作为日常入口文案。
 */
export const WORKBENCH_LABEL = {
  supervisor: "项目全景",
  /** 单门主入口：需求列表 + 方案审阅 */
  studio: "方案工作台",
  workbench: "方案工作台",
  terminal: "验证输出",
  explorer: "资源管理器",
  /** 保留键名兼容；文案改为方案审阅 */
  graph: "方案审阅",
  settings: "设置",
  release: "发布",
} as const;

export type WorkbenchLabelKey = keyof typeof WORKBENCH_LABEL;
