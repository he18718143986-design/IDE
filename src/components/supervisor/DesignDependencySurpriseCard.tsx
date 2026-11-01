/**
 * TASK-J.19：DN-2 设计步骤「需要新依赖」意外卡。
 * 「可以」→ POST /api/design/:id/dependency-allow（真实调用 resolveDesignDependencyAllow）
 * 「不行」→ POST /api/design/:id/dependency-deny（abort，不插桩）
 * 禁止假闭环：按钮必须走 props 里的真实 handler。
 */

export interface DesignDependencySurpriseView {
  contract_id: string;
  detail: string;
  dependencies: Array<{ name: string; version: string; why: string }>;
}

export interface DesignDependencySurpriseCardProps {
  view: DesignDependencySurpriseView | null | undefined;
  busy?: boolean | undefined;
  onAllow: () => void;
  onDeny: () => void;
  onDismiss?: (() => void) | undefined;
}

export function DesignDependencySurpriseCard(
  props: DesignDependencySurpriseCardProps,
) {
  const { view, busy, onAllow, onDeny, onDismiss } = props;
  if (!view) return null;
  return (
    <div
      data-testid="design-dependency-surprise-card"
      data-contract-id={view.contract_id}
      role="alertdialog"
      aria-label="需要装新依赖"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <section className="w-full max-w-md rounded-lg border border-amber-600/60 bg-background p-4 shadow-lg">
        <h2 className="text-sm font-semibold text-foreground">
          设计步骤想装新库——你说了算
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">{view.detail}</p>
        {view.dependencies.length > 0 ? (
          <ul
            data-testid="design-dependency-list"
            className="mt-2 space-y-1 rounded border border-border bg-muted/30 p-2 font-mono text-[11px]"
          >
            {view.dependencies.map((d) => (
              <li key={`${d.name}@${d.version}`}>
                {d.name}@{d.version}
                {d.why ? (
                  <span className="ml-2 font-sans text-muted-foreground">
                    — {d.why}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">
          点「可以」会中止本合同、在计划里插入依赖桩并等你重签；不会静默改已签合同。点「不行」则中止且不装库。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="design-dependency-allow"
            disabled={busy === true}
            onClick={onAllow}
            className="rounded border border-amber-700 bg-amber-500/20 px-3 py-1.5 text-xs text-amber-950 disabled:opacity-40"
          >
            可以（加依赖）
          </button>
          <button
            type="button"
            data-testid="design-dependency-deny"
            disabled={busy === true}
            onClick={onDeny}
            className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            不行
          </button>
          {onDismiss ? (
            <button
              type="button"
              data-testid="design-dependency-dismiss"
              disabled={busy === true}
              onClick={onDismiss}
              className="ml-auto rounded border border-transparent px-2 py-1.5 text-xs text-muted-foreground"
            >
              稍后处理
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
