import type { SoftwareContract } from "@/lib/contract.schema";

const STATE_LABEL: Record<string, string> = {
  DRAFT: "草案",
  PENDING_APPROVAL: "待审批",
  PREPARING: "准备中",
  EXECUTING: "执行中",
  VERIFYING: "验证中",
  PENDING_RESUME: "待恢复",
  AUDITED: "待核销",
  MERGED: "已交付归档",
  ABORTED: "已中止",
};

export interface ContractCardProps {
  contract: SoftwareContract;
  onApprove?: (contractId: string) => void;
  /** TASK-AUDITED.2：AUDITED+APPROVED 时「退回待批」 */
  onReturnToPending?: (contractId: string) => void;
  busy?: boolean;
  readonly?: boolean;
}

/** C.1 合同概览卡：Scope 摘要 + 预算 + 验证命令 + 审批入口 */
export function ContractCard({
  contract,
  onApprove,
  onReturnToPending,
  busy = false,
  readonly = false,
}: ContractCardProps) {
  const scope = contract.authorization.file_system_scope;
  const budget = contract.authorization.budget_limits;
  const cost = contract.authorization.cost_limits;
  const canApprove =
    !readonly &&
    contract.lifecycle_state === "PENDING_APPROVAL" &&
    contract.approval.status === "PENDING_REVIEW";
  const canReturnToPending =
    !readonly &&
    contract.lifecycle_state === "AUDITED" &&
    contract.approval.status === "APPROVED";

  return (
    <section className="rounded border border-border bg-card p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{contract.intent.title}</h2>
        <span className="rounded border border-border px-2 py-0.5 text-[10px]">
          {STATE_LABEL[contract.lifecycle_state] ?? contract.lifecycle_state}
        </span>
        <span className="text-[10px] text-muted-foreground">
          审批：{contract.approval.status}
        </span>
        <span className="text-[10px] text-muted-foreground">
          风险：{contract.intent.risk_level}
        </span>
      </header>

      <p className="mt-2 text-xs text-muted-foreground">
        {contract.intent.description}
      </p>

      <dl className="mt-3 grid gap-2 text-[11px] md:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">
            可写路径（{scope.writable_paths.length}）
          </dt>
          <dd className="truncate">{scope.writable_paths.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            只读路径（{scope.readonly_paths.length}）
          </dt>
          <dd className="truncate">{scope.readonly_paths.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            严禁路径（{scope.strictly_forbidden_paths.length}）
          </dt>
          <dd className="truncate text-destructive">
            {scope.strictly_forbidden_paths.join(", ") || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">验证命令</dt>
          <dd>
            {contract.verification_spec.commands
              .map((c) => `${c.alias}: ${[c.executable, ...c.args].join(" ")}`)
              .join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">文件/时长预算</dt>
          <dd>
            最多 {budget.max_file_modifications} 文件 ·{" "}
            {budget.max_duration_seconds}s
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">费用上限</dt>
          <dd>
            {cost.max_cost_minor_units} {cost.currency}（{cost.accounting_mode}
            ）
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!canApprove || busy}
          onClick={() => onApprove?.(contract.contract_id)}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
        >
          {busy ? "处理中…" : "批准并开工"}
        </button>
        {canReturnToPending ? (
          <button
            type="button"
            data-testid="contract-return-to-pending"
            disabled={busy}
            onClick={() => onReturnToPending?.(contract.contract_id)}
            className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {busy ? "处理中…" : "退回待批"}
          </button>
        ) : null}
        <span className="text-[10px] text-muted-foreground">
          {canApprove
            ? "批准后合同进入只读锁定态，重新修改需再次审批"
            : canReturnToPending
              ? "退回后可再次「批准并开工」"
              : "当前状态不可审批"}
        </span>
      </div>
    </section>
  );
}
