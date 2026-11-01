/**
 * TASK-L.17b：对比视图（仅供人眼对照 · dec-12 / REJ-009）。
 *
 * 双栏：左栏参考站抓取成果（HTML 快照 / DOM 摘要 / 截图预览），
 *      右栏 iframe 直连真机 / LIVE 预览端口并保留外链直达。
 *
 * 刻意约束：
 *  - 不引入 studio 层 `RealPlaytestPane` 布局依赖（只复用
 *    `src/lib/ipc/real-preview-origin` 的 iframe 沙箱属性这个纯 lib）；
 *  - 不做像素 / DOM 量化机器比对 —— 只并排呈现供人对照（机器初筛后续另议）。
 */
import { realPlaytestIframeProps } from "../../lib/ipc/real-preview-origin";

export interface ReferenceSnapshotView {
  reference_url: string;
  html_snapshot?: string | null | undefined;
  dom_summary?: string | null | undefined;
  /** 截图预览：data URL 或可访问 URL */
  screenshot_url?: string | null | undefined;
}

export interface CompareViewProps {
  contractId?: string | null | undefined;
  /** 合同 references[] 白名单参考站 */
  references?: readonly string[] | undefined;
  /** L.17a 抓取成果 */
  snapshots?: readonly ReferenceSnapshotView[] | undefined;
  /** 直连真机 / LIVE 预览端口 URL */
  previewUrl?: string | null | undefined;
  previewStatus?: "RUNNING" | "STOPPED" | "ERROR" | null | undefined;
  errorMessage?: string | null | undefined;
}

export function CompareView(props: CompareViewProps) {
  const url = props.previewUrl?.trim() || null;
  const running = props.previewStatus === "RUNNING" && url !== null;
  const refs = props.references ?? [];
  const snaps = props.snapshots ?? [];

  return (
    <div data-testid="compare-view" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-foreground">对照试玩</span>
        <span className="text-[11px] text-muted-foreground">
          仅供人眼对照 · 不做自动比对
        </span>
        {props.contractId ? (
          <span className="text-[11px] text-muted-foreground">
            合同 {props.contractId}
          </span>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
        {/* 左栏：参考站抓取成果 */}
        <div
          data-testid="compare-view-left"
          className="flex min-h-0 flex-col overflow-auto"
        >
          <div className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold text-foreground">
            参考站抓取成果（L.17a）
          </div>
          {snaps.length === 0 ? (
            <div
              data-testid="compare-view-left-empty"
              className="p-3 text-xs text-muted-foreground"
            >
              还没有参考站抓取成果。
              {refs.length > 0
                ? `已登记参考站：${refs.join("、")}`
                : "该合同未登记 references[]。"}
            </div>
          ) : (
            snaps.map((snap, idx) => (
              <div
                key={`${snap.reference_url}-${idx}`}
                data-testid="compare-view-reference"
                className="border-b border-border p-3"
              >
                <a
                  data-testid="compare-view-reference-link"
                  href={snap.reference_url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-xs text-foreground underline"
                >
                  {snap.reference_url}
                </a>
                {snap.screenshot_url ? (
                  <img
                    data-testid="compare-view-screenshot"
                    src={snap.screenshot_url}
                    alt="参考站截图预览"
                    className="mt-2 max-h-64 w-full rounded border border-border object-contain"
                  />
                ) : null}
                {snap.dom_summary ? (
                  <pre
                    data-testid="compare-view-dom-summary"
                    className="mt-2 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] whitespace-pre-wrap"
                  >
                    {snap.dom_summary}
                  </pre>
                ) : null}
                {snap.html_snapshot ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      HTML 快照
                    </summary>
                    <pre
                      data-testid="compare-view-html-snapshot"
                      className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] whitespace-pre-wrap"
                    >
                      {snap.html_snapshot}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))
          )}
        </div>

        {/* 右栏：iframe 直连真机 / LIVE 预览 */}
        <div
          data-testid="compare-view-right"
          className="flex min-h-0 flex-col"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
            <span className="text-[11px] font-semibold text-foreground">
              当前 LIVE / 真机预览
            </span>
            {url ? (
              <a
                data-testid="compare-view-open-external"
                href={url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                在浏览器打开
              </a>
            ) : null}
          </div>
          {props.errorMessage?.trim() ? (
            <div
              data-testid="compare-view-error"
              role="alert"
              className="border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {props.errorMessage}
            </div>
          ) : null}
          {running && url ? (
            <iframe
              data-testid="compare-view-iframe"
              className="min-h-0 flex-1 border-0 bg-background"
              {...realPlaytestIframeProps(url)}
            />
          ) : (
            <div
              data-testid="compare-view-right-empty"
              className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground"
            >
              <p>
                {props.previewStatus === "ERROR"
                  ? "真机预览起不来，请检查 LIVE 预览端口"
                  : "还没有 LIVE / 真机预览，启动后右栏会挂上真实页面供你对照试玩"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
