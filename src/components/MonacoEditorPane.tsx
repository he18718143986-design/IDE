import { useEffect, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useWorktreeFile, type WorktreeFileIO } from "@/hooks/useWorktreeFile";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import {
  defaultMarkdownViewMode,
  isMarkdownPath,
  type MarkdownViewMode,
} from "@/lib/markdown-file";
import {
  DaemonApiError,
  fetchKnowledgeImpact,
  fetchTraceWhy,
  loadConnection,
  type KnowledgeImpactResult,
  type TraceWhyResult,
} from "@/lib/daemon-api";

export interface MonacoEditorPaneProps {
  path: string;
  io: WorktreeFileIO | null;
  reloadKey?: number;
}

const LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  css: "css",
  html: "html",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
};

type TraceCardState =
  | { status: "idle" }
  | { status: "loading"; line: number }
  | { status: "ok"; line: number; result: TraceWhyResult }
  | { status: "broken"; line: number; message: string; ring?: string };

type ImpactCardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; result: KnowledgeImpactResult }
  | { status: "error"; message: string };

/** TASK-C.3 中栏 Monaco；TASK-C.10j：.md 默认好看预览；TASK-L.13：右键「这段为什么存在」；TASK-L.18：右键「改这里会影响什么」 */
export function MonacoEditorPane({
  path,
  io,
  reloadKey = 0,
}: MonacoEditorPaneProps) {
  const f = useWorktreeFile(io, path, reloadKey);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const markdown = isMarkdownPath(path);
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(() =>
    defaultMarkdownViewMode(path),
  );
  const [traceCard, setTraceCard] = useState<TraceCardState>({ status: "idle" });
  const [impactCard, setImpactCard] = useState<ImpactCardState>({ status: "idle" });

  useEffect(() => {
    setViewMode(defaultMarkdownViewMode(path));
    setTraceCard({ status: "idle" });
    setImpactCard({ status: "idle" });
  }, [path]);

  const showPreview = markdown && viewMode === "preview";

  const onMount: OnMount = (editor, monaco) => {
    editor.addAction({
      id: "stagent.trace.why",
      label: "这段为什么存在",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.5,
      run: async (ed) => {
        const position = ed.getPosition();
        if (!position) return;
        const line = position.lineNumber;
        setTraceCard({ status: "loading", line });
        try {
          const conn = loadConnection();
          const result = await fetchTraceWhy(conn, path, line);
          setTraceCard({ status: "ok", line, result });
        } catch (err) {
          const message =
            err instanceof DaemonApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          const ring =
            err instanceof DaemonApiError &&
            err.body &&
            typeof err.body === "object" &&
            typeof (err.body as { ring?: unknown }).ring === "string"
              ? ((err.body as { ring: string }).ring)
              : undefined;
          setTraceCard({ status: "broken", line, message, ring });
        }
      },
    });
    editor.addAction({
      id: "stagent.knowledge.impact",
      label: "改这里会影响什么",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.6,
      run: async () => {
        setImpactCard({ status: "loading" });
        try {
          const conn = loadConnection();
          const result = await fetchKnowledgeImpact(conn, path);
          setImpactCard({ status: "ok", result });
        } catch (err) {
          const message =
            err instanceof DaemonApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          setImpactCard({ status: "error", message });
        }
      },
    });
    // 保留 monaco 引用以免未使用告警（主题等后续可扩展）
    void monaco;
  };

  return (
    <div
      data-testid="monaco-pane"
      data-markdown={markdown ? "true" : "false"}
      data-view-mode={markdown ? viewMode : "source"}
      className="flex h-full min-h-[360px] flex-col"
    >
      <div className="flex items-center gap-2 border-b px-2 py-1 text-xs">
        <span className="font-mono truncate" title={path}>
          {path}
        </span>
        <span
          data-testid="file-access"
          data-writable={f.writable ? "true" : "false"}
          className={
            f.writable
              ? "rounded bg-green-100 px-1 text-green-800"
              : "rounded bg-zinc-200 px-1 text-zinc-700"
          }
        >
          {f.writable ? "可写" : "只读"}
        </span>
        {f.dirty && <span className="text-amber-600">● 未保存</span>}
        {markdown ? (
          <div
            data-testid="markdown-view-toggle"
            className="ml-2 inline-flex overflow-hidden rounded border"
            role="group"
            aria-label="Markdown 阅读模式"
          >
            <button
              type="button"
              data-testid="markdown-view-preview"
              aria-pressed={viewMode === "preview"}
              className={
                viewMode === "preview"
                  ? "bg-primary px-2 py-0.5 text-primary-foreground"
                  : "bg-background px-2 py-0.5 text-muted-foreground hover:bg-muted"
              }
              onClick={() => setViewMode("preview")}
            >
              预览
            </button>
            <button
              type="button"
              data-testid="markdown-view-source"
              aria-pressed={viewMode === "source"}
              className={
                viewMode === "source"
                  ? "bg-primary px-2 py-0.5 text-primary-foreground"
                  : "bg-background px-2 py-0.5 text-muted-foreground hover:bg-muted"
              }
              onClick={() => setViewMode("source")}
            >
              源码
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="ml-auto rounded border px-2 disabled:opacity-40"
          disabled={!f.writable || !f.dirty || showPreview}
          onClick={() => void f.save()}
        >
          保存
        </button>
      </div>
      {f.error && (
        <div
          role="alert"
          className="bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          {f.error}
        </div>
      )}
      {traceCard.status !== "idle" ? (
        <div
          data-testid="trace-why-card"
          role="dialog"
          aria-label="这段为什么存在"
          className="border-b bg-amber-50 px-3 py-2 text-xs text-zinc-800"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <strong>这段为什么存在 · 第 {traceCard.line} 行</strong>
            <button
              type="button"
              className="rounded border px-1.5"
              onClick={() => setTraceCard({ status: "idle" })}
            >
              关闭
            </button>
          </div>
          {traceCard.status === "loading" ? (
            <p>正在沿着提交 → 合同 → 方案 → 原话查找…</p>
          ) : null}

      {impactCard.status !== "idle" ? (
        <div
          data-testid="knowledge-impact-card"
          role="dialog"
          aria-label="改这里会影响什么"
          className="border-b bg-sky-50 px-3 py-2 text-xs text-zinc-800"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <strong>改这里会影响什么 · {path}</strong>
            <button
              type="button"
              className="rounded border px-1.5"
              onClick={() => setImpactCard({ status: "idle" })}
            >
              关闭
            </button>
          </div>
          {impactCard.status === "loading" ? (
            <p>正在按 modules.yaml 计算影响闭包…</p>
          ) : null}
          {impactCard.status === "error" ? (
            <p className="text-destructive">{impactCard.message}</p>
          ) : null}
          {impactCard.status === "ok" ? (
            <div className="space-y-1">
              {impactCard.result.empty_reason === "no_modules" ? (
                <p>还没有系统模块地图（缺少 modules.yaml）。</p>
              ) : null}
              {impactCard.result.empty_reason === "no_owner" ? (
                <p>当前文件未被任何模块的 paths 覆盖。</p>
              ) : null}
              {impactCard.result.empty_reason === "ok" ? (
                <>
                  <p>
                    归属：
                    {impactCard.result.owners
                      .map((o) => `${o.name}（${o.id}）`)
                      .join("、")}
                  </p>
                  {impactCard.result.affected.length === 0 ? (
                    <p>没有其它模块会受影响。</p>
                  ) : (
                    <ul className="list-disc pl-4">
                      {impactCard.result.affected.map((a) => (
                        <li key={a.id}>
                          {a.name}（{a.id}）· 经由 {a.via.join("+")}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
          {traceCard.status === "broken" ? (
            <p className="text-destructive">
              链断了
              {traceCard.ring ? `（断在「${traceCard.ring}」）` : ""}：
              {traceCard.message}
            </p>
          ) : null}
          {traceCard.status === "ok" ? (
            <div className="space-y-2">
              <p>
                合同 <code>{traceCard.result.contract_id}</code> · 提交{" "}
                <code>{traceCard.result.commit.slice(0, 12)}</code>
                {traceCard.result.scheme_items_trailer_truncated
                  ? " · 方案条目清单在 changelog（Trailer 已截断）"
                  : null}
              </p>
              {traceCard.result.scheme_items.map((item) => (
                <div key={item.id} className="rounded border bg-white p-2">
                  <div className="font-medium">
                    {item.id}：{item.text}
                  </div>
                  <ul className="mt-1 list-disc pl-4 text-zinc-700">
                    {item.quotes.map((q) => (
                      <li key={`${item.id}:${q.qid}`}>
                        用户原话（{q.qid}）：「{q.text}」
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className={`relative min-h-[300px] flex-1 ${f.writable && !showPreview ? "" : "bg-zinc-50"}`}
      >
        {!f.loading && showPreview ? (
          <MarkdownPreview content={f.content} path={path} />
        ) : null}
        {!f.loading && !showPreview ? (
          <div data-testid="monaco-host" className="absolute inset-0">
            <Editor
              height="100%"
              theme="vs-dark"
              path={path}
              language={LANG[ext] ?? "plaintext"}
              value={f.content}
              onChange={(v) => f.setContent(v ?? "")}
              onMount={onMount}
              options={{
                readOnly: !f.writable,
                minimap: { enabled: false },
                fontSize: 12,
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
