/**
 * TASK-J.6 / SSOT §15.2·§15.4（ADR-0014 / SA-1 审阅后置）：
 * 开工前只展示三行白话概览 + 敏感项「不碰这些」；
 * 无路径树、无区域按钮、无逐项授权；
 * 冻结后 / 验收幕：完整清单只读。
 */

import { useEffect, useState } from "react";
import type { ScopePlan } from "@/lib/journey/scope-plan";

export type ScopeAcceptanceMode = "pre_start" | "frozen" | "acceptance";

export interface ScopeAcceptanceBlockProps {
  plan: ScopePlan | null;
  /** 缺省：frozen/acceptance 由 mode 决定；未传 mode 时按 frozen 推断 */
  mode?: ScopeAcceptanceMode | undefined;
  frozen?: boolean | undefined;
  /** E_SCOPE_POLICY 时的白话说明，置顶 */
  policyMessage?: string | null | undefined;
  /** E_SCOPE_APPROVAL_REQUIRED：自动展开敏感区 */
  approvalRequired?: boolean | undefined;
  /** 强制展开敏感项（确认点击时由父级置 true） */
  forceExpandSensitive?: boolean | undefined;
  busy?: boolean | undefined;
  onDeclineSensitive?: (() => void) | undefined;
}

function activeAreaCount(plan: ScopePlan): number {
  return plan.areas.filter((a) => !a.excluded_by_user).length;
}

function neverTouchCount(plan: ScopePlan): number {
  return plan.never_touch.length;
}

function pendingSensitive(plan: ScopePlan) {
  return plan.needs_approval.filter((item) => item.approved !== false);
}

function FullReadonlyList(props: { plan: ScopePlan }) {
  const { plan } = props;
  const areas = plan.areas.filter((a) => !a.excluded_by_user);
  return (
    <div className="space-y-3 text-xs" data-testid="scope-acceptance-full-list">
      <div>
        <h4 className="mb-1 font-medium text-foreground">会改动的地方</h4>
        {areas.length === 0 ? (
          <p className="text-muted-foreground">这一轮没有要改的地方</p>
        ) : (
          <ul className="space-y-1">
            {areas.map((a) => (
              <li key={a.id} data-testid="scope-acceptance-area-row">
                <span className="font-medium">{a.label}</span>
                {a.why ? (
                  <span className="text-muted-foreground"> —— {a.why}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-1 font-medium text-foreground">这次不会碰</h4>
        {plan.never_touch.length === 0 ? (
          <p className="text-muted-foreground">没有额外排除项</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {plan.never_touch.map((g, i) => (
              <li
                key={`${g.label}-${i}`}
                data-testid="scope-acceptance-never-touch"
                className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
              >
                {g.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-1 font-medium text-foreground">怎么算做完</h4>
        {plan.verification.manual_only ? (
          <p data-testid="scope-acceptance-manual-only" className="text-muted-foreground">
            没有自动检查，完成后需要你试玩确认
          </p>
        ) : null}
        {plan.verification.plain.length > 0 ? (
          <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
            {plan.verification.plain.map((line) => (
              <li key={line} data-testid="scope-acceptance-verify-line">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p data-testid="scope-acceptance-budget" className="text-muted-foreground">
        预计规模：{plan.budget.plain}
      </p>
    </div>
  );
}

export function ScopeAcceptanceBlock(props: ScopeAcceptanceBlockProps) {
  const mode: ScopeAcceptanceMode =
    props.mode ??
    (props.frozen ? "frozen" : "pre_start");
  const readOnly = mode === "frozen" || mode === "acceptance";
  const plan = props.plan;

  const pending = plan ? pendingSensitive(plan) : [];
  const showSensitive = pending.length > 0;
  const [expanded, setExpanded] = useState(
    Boolean(props.approvalRequired || props.forceExpandSensitive),
  );

  useEffect(() => {
    if (props.approvalRequired || props.forceExpandSensitive) {
      setExpanded(true);
    }
  }, [props.approvalRequired, props.forceExpandSensitive]);

  return (
    <section
      data-testid="scope-acceptance-block"
      data-mode={mode}
      data-readonly={readOnly ? "true" : "false"}
      className="mb-3 rounded border border-border p-3"
    >
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        改动范围与验收方式
      </h3>

      {props.policyMessage ? (
        <p
          data-testid="scope-acceptance-policy"
          className="mb-2 rounded border border-amber-700/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-950"
        >
          {props.policyMessage}
        </p>
      ) : null}

      {!plan ? (
        <p
          data-testid="scope-acceptance-loading"
          className="text-[11px] text-muted-foreground"
        >
          正在核对要改哪些地方…
        </p>
      ) : readOnly ? (
        <FullReadonlyList plan={plan} />
      ) : (
        <div className="space-y-2 text-xs">
          <p data-testid="scope-acceptance-overview">
            这次大概改 {activeAreaCount(plan)} 处、不碰 {neverTouchCount(plan)}{" "}
            处
          </p>
          <div data-testid="scope-acceptance-verification">
            <span className="text-muted-foreground">怎么算做完：</span>
            {plan.verification.manual_only ? (
              <span data-testid="scope-acceptance-manual-only">
                没有自动检查，完成后需要你试玩确认
              </span>
            ) : plan.verification.plain.length > 0 ? (
              <span>{plan.verification.plain.join("；")}</span>
            ) : (
              <span className="text-muted-foreground">按方案试玩确认</span>
            )}
          </div>
          <p data-testid="scope-acceptance-budget">
            预计多大：{plan.budget.plain}
          </p>

          {showSensitive ? (
            <div
              data-testid="scope-acceptance-sensitive"
              className="rounded border border-amber-700/30 bg-amber-500/5 p-2"
            >
              <button
                type="button"
                data-testid="scope-acceptance-sensitive-toggle"
                className="text-left text-[11px] font-medium text-amber-950"
                onClick={() => setExpanded((v) => !v)}
              >
                含 {pending.length} 处敏感改动
                {expanded ? " ▾" : " ▸"}
                {pending.length > 0
                  ? `：${pending.map((i) => i.label).join("、")}`
                  : ""}
              </button>
              {expanded ? (
                <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                  {pending.map((item) => (
                    <li key={item.id} data-testid="scope-acceptance-sensitive-item">
                      {item.label}
                      {item.why ? ` —— ${item.why}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {!readOnly ? (
                <button
                  type="button"
                  data-testid="scope-acceptance-decline-sensitive"
                  disabled={props.busy === true}
                  onClick={() => props.onDeclineSensitive?.()}
                  className="mt-2 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
                >
                  不碰这些，其余照做
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** 点「不碰这些」时的表态：排除与敏感路径重合的区域，并拒绝全部敏感项。 */
export function declineSensitiveDecisions(plan: ScopePlan): {
  excluded_area_ids: string[];
  approvals: Record<string, boolean>;
} {
  const sensitivePaths = new Set(
    plan.needs_approval.flatMap((item) => item.paths),
  );
  const excluded_area_ids = plan.areas
    .filter((area) => area.paths.some((p) => sensitivePaths.has(p)))
    .map((area) => area.id);
  const approvals: Record<string, boolean> = {};
  for (const item of plan.needs_approval) {
    approvals[item.id] = false;
  }
  return { excluded_area_ids, approvals };
}

/** 确认开工时一键授权尚未拒绝的敏感项。 */
export function authorizePendingSensitiveDecisions(plan: ScopePlan): {
  approvals: Record<string, boolean>;
} {
  const approvals: Record<string, boolean> = {};
  for (const item of plan.needs_approval) {
    if (item.approved === false) continue;
    approvals[item.id] = true;
  }
  return { approvals };
}
