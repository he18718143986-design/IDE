import type { PresentationState } from "@/lib/state/presentation-state";

/**
 * Studio 视口（TASK-C.18：收敛为单页「方案审阅」；TASK-J.23：支持切入「质疑自查」）。
 *
 * 旧五 id 仍导出，供历史测试/旅程 suggest_viewport 映射；
 * 日常工作台主页为 scheme，质疑自查触发或切换时切入 dispute。
 */
export const STUDIO_VIEWPORT_IDS = ["scheme"] as const;

export type StudioViewportId =
  (typeof STUDIO_VIEWPORT_IDS)[number] | LegacyStudioViewportId;

/** @deprecated C.18 起 UI 不再渲染多 Tab；仅兼容旧调用与 J.23 质疑面板切入 */
export type LegacyStudioViewportId =
  "demo" | "graph" | "dispute" | "contract" | "playtest";

export const STUDIO_VIEWPORT_LABEL: Readonly<Record<string, string>> = {
  scheme: "方案审阅",
  demo: "原型试玩",
  graph: "任务图谱",
  dispute: "质疑自查",
  contract: "合同审阅",
  playtest: "真机试玩",
};

/** C.18：任意展示态默认都落方案审阅单页 */
export function resolveDefaultViewport(
  _presentationState?: PresentationState | null | undefined,
): "scheme" {
  return "scheme";
}

export function resolveActiveViewport(input: {
  presentationState: PresentationState | null | undefined;
  previousPresentationState: PresentationState | null | undefined;
  manualViewport: StudioViewportId | null;
}): { viewport: "scheme" | "dispute"; clearManual: boolean } {
  if (input.manualViewport === "dispute") {
    return { viewport: "dispute", clearManual: false };
  }
  if (input.presentationState === "DISPUTED_INSPECTING") {
    return { viewport: "dispute", clearManual: true };
  }
  return {
    viewport: "scheme",
    clearManual: input.manualViewport !== null,
  };
}

/** 旧 suggest_viewport → 映射：dispute 保留，其余一律 scheme */
export function mapLegacyViewportToScheme(
  legacy?: string | null,
): "scheme" | "dispute" {
  if (legacy === "dispute") return "dispute";
  return "scheme";
}
