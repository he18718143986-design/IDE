/**
 * TASK-L.10：画布「项目地图」——同页嵌于方案工作台，非独立 Tab。
 * 「下一份」只用服务端下发的 next_stub_id，前端不得本地重算 nextStub。
 */
import { useMemo, useState } from "react";
import type {
  ContractStub,
  Milestone,
  ProjectPlan,
} from "@/lib/project/project-plan";

export type StubStatusLabel = "待做" | "进行中" | "已合入" | "已放弃";

export function stubStatusLabel(
  status: ContractStub["status"],
): StubStatusLabel {
  switch (status) {
    case "planned":
      return "待做";
    case "signed":
      return "进行中";
    case "merged":
      return "已合入";
    case "aborted":
    case "superseded":
      return "已放弃";
    default:
      return "待做";
  }
}

export interface ProjectMapPaneProps {
  plan: ProjectPlan;
  /** 服务端权威下一份；前端不得本地重算 */
  nextStubId: string | null;
  busy?: boolean | undefined;
  onConfirmStart?: ((stubId: string) => void) | undefined;
  onDefer?: ((stubId: string) => void) | undefined;
  onReorderForward?: ((stubId: string) => void) | undefined;
}

function milestoneProgress(
  ms: Milestone,
  stubsById: Map<string, ContractStub>,
): { merged: number; total: number } {
  let merged = 0;
  for (const id of ms.contract_ids) {
    const s = stubsById.get(id);
    if (s?.status === "merged") merged += 1;
  }
  return { merged, total: ms.contract_ids.length };
}

export function ProjectMapPane(props: ProjectMapPaneProps) {
  const { plan, nextStubId, busy = false } = props;
  const [collapsed, setCollapsed] = useState(false);

  const stubsById = useMemo(() => {
    const m = new Map<string, ContractStub>();
    for (const s of plan.contracts) m.set(s.stub_id, s);
    return m;
  }, [plan.contracts]);

  return (
    <section
      data-testid="project-map-pane"
      className="mb-3 rounded border border-border bg-card"
    >
      <button
        type="button"
        data-testid="project-map-toggle"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted/30"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span>项目地图</span>
        <span className="text-[10px] font-normal text-muted-foreground">
          {collapsed ? "展开" : "收起"}
        </span>
      </button>

      {!collapsed ? (
        <div className="space-y-3 border-t border-border px-3 py-2">
          {plan.milestones.map((ms) => {
            const prog = milestoneProgress(ms, stubsById);
            return (
              <div
                key={ms.milestone_id}
                data-testid="project-map-milestone"
                data-milestone-id={ms.milestone_id}
                className="rounded border border-border/70 bg-muted/20 p-2"
              >
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                  <h3 className="text-xs font-semibold text-foreground">
                    {ms.title}
                  </h3>
                  <span
                    data-testid="project-map-milestone-progress"
                    className="text-[10px] text-muted-foreground"
                  >
                    {prog.merged} / {prog.total} 已合入
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {ms.contract_ids.map((stubId) => {
                    const stub = stubsById.get(stubId);
                    if (!stub) return null;
                    const isNext = nextStubId !== null && stub.stub_id === nextStubId;
                    const label = stubStatusLabel(stub.status);
                    const canAct = stub.status === "planned" && !busy;
                    return (
                      <li
                        key={stub.stub_id}
                        data-testid="project-map-stub"
                        data-stub-id={stub.stub_id}
                        data-next={isNext ? "true" : "false"}
                        className={`rounded border px-2 py-1.5 text-xs ${
                          isNext
                            ? "border-emerald-600/50 bg-emerald-500/10 ring-1 ring-emerald-600/30"
                            : "border-border bg-background"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {stub.title}
                          </span>
                          <span
                            data-testid="project-map-stub-status"
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {label}
                          </span>
                          {isNext ? (
                            <span
                              data-testid="project-map-next-badge"
                              className="rounded bg-emerald-700/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900"
                            >
                              下一份
                            </span>
                          ) : null}
                        </div>
                        {stub.depends_on.length > 0 ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            依赖：
                            {stub.depends_on
                              .map((id) => stubsById.get(id)?.title ?? id)
                              .join("、")}
                          </p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {isNext ? (
                            <button
                              type="button"
                              data-testid="project-map-confirm-start"
                              disabled={busy}
                              className="rounded border border-emerald-700/40 bg-emerald-600/15 px-2 py-0.5 text-[11px] text-emerald-950 hover:bg-emerald-600/25 disabled:opacity-40"
                              onClick={() => props.onConfirmStart?.(stub.stub_id)}
                            >
                              确认开工
                            </button>
                          ) : null}
                          {canAct ? (
                            <>
                              <button
                                type="button"
                                data-testid="project-map-defer"
                                disabled={busy}
                                className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-40"
                                onClick={() => props.onDefer?.(stub.stub_id)}
                              >
                                先不做这个
                              </button>
                              <button
                                type="button"
                                data-testid="project-map-reorder-forward"
                                disabled={busy}
                                className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-40"
                                onClick={() =>
                                  props.onReorderForward?.(stub.stub_id)
                                }
                              >
                                这个往前排
                              </button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
