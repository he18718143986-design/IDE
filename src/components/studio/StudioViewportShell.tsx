import type { ReactNode } from "react";
import type { PresentationState } from "@/lib/state/presentation-state";

/**
 * Studio 工作台外壳（TASK-C.18：单页方案审阅；TASK-J.23：支持挂载与切入质疑自查）。
 *
 * - 中间主工作页默认挂「方案审阅」
 * - 支持在质疑触发或用户切换时切入「质疑自查」面板（J.23 纯接线挂载）
 * - 左侧「选合同 / 规范与资产」栏（C.16 保留）
 */
export interface StudioViewportShellProps {
  presentationState?: PresentationState | null | undefined;
  presentationMessage?: string | null | undefined;
  /** 活动视口标识（"scheme" | "dispute" 等） */
  activeViewport?: string | undefined;
  onViewportChange?: ((viewport: string) => void) | undefined;
  contractRail?: ReactNode | undefined;
  /**
   * C.18：主方案内容。优先使用；未传时回退拼旧插槽（兼容过渡测试）。
   */
  scheme?: ReactNode | undefined;
  /** TASK-J.23：质疑自查面板 */
  dispute?: ReactNode | undefined;
  /** @deprecated C.18 日常不再展示；仅 fallback */
  demo?: ReactNode | undefined;
  graph?: ReactNode | undefined;
  contract?: ReactNode | undefined;
  playtest?: ReactNode | undefined;
}

export function StudioViewportShell(props: StudioViewportShellProps) {
  const presentationState = props.presentationState ?? null;
  const activeViewport = props.activeViewport ?? "scheme";
  const isDispute = activeViewport === "dispute" && Boolean(props.dispute);

  const mainContent = isDispute
    ? props.dispute
    : (props.scheme ??
      props.contract ??
      props.demo ?? (
        <div className="p-4 text-xs text-muted-foreground">暂无方案内容</div>
      ));

  const main = (
    <div
      data-testid="studio-viewport-shell"
      data-single-pane="true"
      data-active-viewport={isDispute ? "dispute" : "scheme"}
      data-presentation-state={presentationState ?? ""}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div
        data-testid="studio-viewport-header"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5"
      >
        <span className="text-xs font-medium text-foreground">
          {isDispute ? "质疑自查" : "方案审阅"}
        </span>
        {isDispute && props.onViewportChange ? (
          <button
            type="button"
            data-testid="studio-back-to-scheme"
            onClick={() => props.onViewportChange?.("scheme")}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            返回方案审阅
          </button>
        ) : null}
        {props.presentationMessage ? (
          <span
            data-testid="studio-presentation-message"
            className="ml-auto max-w-[60%] truncate text-[11px] text-muted-foreground"
            title={props.presentationMessage}
          >
            {props.presentationMessage}
          </span>
        ) : null}
      </div>

      <div
        data-testid="studio-viewport-content"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        <div
          role="region"
          aria-label={isDispute ? "质疑自查" : "方案审阅"}
          data-testid={
            isDispute
              ? "studio-viewport-panel-dispute"
              : "studio-viewport-panel-scheme"
          }
          data-active="true"
          className="absolute inset-0 flex min-h-0 flex-col overflow-auto"
        >
          {mainContent}
        </div>
      </div>
    </div>
  );

  if (!props.contractRail) {
    return main;
  }

  return (
    <div data-testid="studio-with-rail" className="flex h-full min-h-0 flex-1">
      <aside
        data-testid="studio-contract-rail"
        className="flex w-56 shrink-0 flex-col overflow-auto border-r border-border bg-muted/20"
      >
        {props.contractRail}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
    </div>
  );
}
