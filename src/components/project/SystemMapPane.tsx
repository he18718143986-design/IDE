/**
 * TASK-L.18：中栏「系统地图」——同页嵌于方案工作台，非独立 ActivityBar Tab。
 * 模块卡 + depends_on 边由代码渲染；无 modules.yaml 时诚实空态。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DaemonApiError,
  fetchKnowledgeImpact,
  fetchKnowledgeModules,
  loadConnection,
  type KnowledgeImpactResult,
  type KnowledgeModulesResult,
} from "@/lib/daemon-api";

export interface SystemMapPaneProps {
  /** 测试注入；生产默认走 daemon API */
  modulesLoader?: () => Promise<KnowledgeModulesResult>;
  impactLoader?: (filePath: string) => Promise<KnowledgeImpactResult>;
}

type LoadState =
  | { status: "loading" }
  | { status: "empty"; message: string }
  | { status: "error"; message: string }
  | { status: "ok"; data: KnowledgeModulesResult };

export function SystemMapPane(props: SystemMapPaneProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [impactPath, setImpactPath] = useState("");
  const [impactBusy, setImpactBusy] = useState(false);
  const [impact, setImpact] = useState<KnowledgeImpactResult | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);

  const loadModules = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const loader =
        props.modulesLoader ??
        (() => fetchKnowledgeModules(loadConnection()));
      const data = await loader();
      if (!data.ok || data.modules.length === 0) {
        setState({
          status: "empty",
          message:
            data.message ??
            "还没有系统模块地图。等知识库引导合同写好 docs/system/modules.yaml 后，这里会显示模块卡和依赖。",
        });
        return;
      }
      setState({ status: "ok", data });
    } catch (err) {
      const message =
        err instanceof DaemonApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setState({ status: "error", message });
    }
  }, [props.modulesLoader]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const edgeLabels = useMemo(() => {
    if (state.status !== "ok") return [] as string[];
    const names = new Map(state.data.modules.map((m) => [m.id, m.name]));
    return state.data.edges.map((e) => {
      const from = names.get(e.from) ?? e.from;
      const to = names.get(e.to) ?? e.to;
      return `${from} → ${to}`;
    });
  }, [state]);

  const runImpact = async () => {
    const p = impactPath.trim().replace(/\\/g, "/");
    if (!p) return;
    setImpactBusy(true);
    setImpactError(null);
    setImpact(null);
    try {
      const loader =
        props.impactLoader ??
        ((filePath: string) =>
          fetchKnowledgeImpact(loadConnection(), filePath));
      const result = await loader(p);
      setImpact(result);
    } catch (err) {
      setImpactError(
        err instanceof DaemonApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setImpactBusy(false);
    }
  };

  return (
    <section
      data-testid="system-map-pane"
      className="mb-3 rounded border border-border bg-card"
    >
      <button
        type="button"
        data-testid="system-map-toggle"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted/30"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span>系统地图</span>
        <span className="text-[10px] font-normal text-muted-foreground">
          {collapsed ? "展开" : "收起"}
        </span>
      </button>

      {!collapsed ? (
        <div className="space-y-3 border-t border-border px-3 py-2">
          {state.status === "loading" ? (
            <p
              data-testid="system-map-loading"
              className="text-[11px] text-muted-foreground"
            >
              正在读取 modules.yaml…
            </p>
          ) : null}

          {state.status === "empty" ? (
            <p
              data-testid="system-map-empty"
              className="text-[11px] leading-relaxed text-muted-foreground"
            >
              {state.message}
            </p>
          ) : null}

          {state.status === "error" ? (
            <p
              data-testid="system-map-error"
              className="text-[11px] text-destructive"
            >
              {state.message}
            </p>
          ) : null}

          {state.status === "ok" ? (
            <>
              <ul
                data-testid="system-map-modules"
                className="grid gap-2 sm:grid-cols-2"
              >
                {state.data.modules.map((m) => (
                  <li
                    key={m.id}
                    data-testid="system-map-module-card"
                    data-module-id={m.id}
                    className="rounded border border-border/70 bg-muted/20 p-2"
                  >
                    <div className="text-xs font-semibold text-foreground">
                      {m.name}
                      <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                        {m.id}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {m.purpose}
                    </p>
                    {m.depends_on.length > 0 ? (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        依赖：{m.depends_on.join("、")}
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        无上游依赖
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <div data-testid="system-map-edges" className="space-y-1">
                <h4 className="text-[10px] font-semibold text-muted-foreground">
                  依赖边（代码渲染，非模型画图）
                </h4>
                {edgeLabels.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">暂无依赖边</p>
                ) : (
                  <ul className="flex flex-wrap gap-1">
                    {edgeLabels.map((label) => (
                      <li
                        key={label}
                        data-testid="system-map-edge"
                        className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px]"
                      >
                        {label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}

          <div
            data-testid="system-map-impact"
            className="rounded border border-dashed border-border/80 bg-background p-2"
          >
            <h4 className="mb-1 text-[10px] font-semibold text-foreground">
              改这里会影响什么
            </h4>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                data-testid="system-map-impact-path"
                type="text"
                value={impactPath}
                onChange={(e) => setImpactPath(e.target.value)}
                placeholder="仓库相对路径，如 src/orders/create.ts"
                className="min-w-[12rem] flex-1 rounded border border-border bg-card px-2 py-1 font-mono text-[11px]"
              />
              <button
                type="button"
                data-testid="system-map-impact-run"
                disabled={impactBusy || !impactPath.trim()}
                className="rounded border border-border px-2 py-1 text-[11px] disabled:opacity-40"
                onClick={() => void runImpact()}
              >
                {impactBusy ? "查询中…" : "查询"}
              </button>
            </div>
            {impactError ? (
              <p
                data-testid="system-map-impact-error"
                className="mt-1 text-[11px] text-destructive"
              >
                {impactError}
              </p>
            ) : null}
            {impact ? (
              <div
                data-testid="system-map-impact-result"
                className="mt-2 space-y-1 text-[11px]"
              >
                {impact.empty_reason === "no_modules" ? (
                  <p>还没有 modules.yaml，无法计算影响。</p>
                ) : null}
                {impact.empty_reason === "no_owner" ? (
                  <p>
                    路径 <code>{impact.path}</code>{" "}
                    未被任何模块的 paths 覆盖。
                  </p>
                ) : null}
                {impact.empty_reason === "ok" ? (
                  <>
                    <p>
                      归属模块：
                      {impact.owners
                        .map((o) => `${o.name}（${o.id}）`)
                        .join("、")}
                    </p>
                    {impact.affected.length === 0 ? (
                      <p data-testid="system-map-impact-none">
                        没有其它模块依赖这里（含接口消费者）。
                      </p>
                    ) : (
                      <ul data-testid="system-map-impact-list" className="list-disc pl-4">
                        {impact.affected.map((a) => (
                          <li key={a.id} data-module-id={a.id}>
                            <strong>{a.name}</strong>（{a.id}）· {a.purpose}
                            <span className="text-muted-foreground">
                              {" "}
                              · 经由 {a.via.join("+")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
