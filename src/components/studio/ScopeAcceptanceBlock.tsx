/**
 * TASK-J.6 / SSOT §15.2·§15.4（ADR-0014 / SA-1 审阅后置）：
 * 开工前只展示三行白话概览 + 敏感项「不碰这些」；
 * 无路径树、无区域按钮、无逐项授权；
 * 冻结后 / 验收幕：完整清单只读。
 * TASK-J.38e：可选只读挂测试目标建议块（ai_inferred · 非验收）。
 */

import { useEffect, useRef, useState } from "react";
import type { ScopePlan } from "@/lib/journey/scope-plan";
import type {
  SurfacePresentationReport,
  SurfacePresentationSection,
  SchemeAcceptanceItem,
} from "@/lib/daemon-api";
import type { SchemeItemProjectionDto } from "@/lib/journey/scheme-patch-types";
import { projectSchemeItemFiveFields } from "@/lib/journey/scheme-item-projection";
import type { TestTargetSuggestion } from "@/lib/journey/test-target-suggest";

export type ScopeAcceptanceMode = "pre_start" | "frozen" | "acceptance";

/**
 * TASK-J.38b：验收行视图 = J.22b id+文案 + 可选五字段投影（只读）。
 * 不改 daemon-api 同形类型；以交叉类型承接 midpane 多余字段，禁止 any/断言。
 */
export type ScopeAcceptanceItemView = SchemeAcceptanceItem &
  SchemeItemProjectionDto;

/** §15.4 白话投影的版本号；文案措辞变化时递增，写入 surface_log 的 plain_text_version。 */
export const SCOPE_ACCEPTANCE_PLAIN_TEXT_VERSION =
  "scope-acceptance-v1" as const;

/** J16-P7：台账为空或读取失败、且取数已完成后的中栏标记。 */
export const NO_ACCEPTANCE_SURFACE_RECORD_LABEL = "无呈现记录" as const;

/**
 * TASK-J.22b / J.38b：把台账验收条目收成可呈现列表。
 * - 只保留非空 id + 非空文案；重复 id 只留首条；
 * - 不伪造条目、不补默认文案；
 * - 可选五字段经 projectSchemeItemFiveFields 清洗后保留（非法丢弃）。
 */
export function presentableAcceptanceItems(
  items: readonly ScopeAcceptanceItemView[] = [],
): ScopeAcceptanceItemView[] {
  const seen = new Set<string>();
  const out: ScopeAcceptanceItemView[] = [];
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (id === "" || text === "" || seen.has(id)) continue;
    seen.add(id);
    const dto: SchemeItemProjectionDto = {
      ...(item.status !== undefined ? { status: item.status } : {}),
      ...(item.scope !== undefined ? { scope: item.scope } : {}),
      ...(item.provenance !== undefined ? { provenance: item.provenance } : {}),
      ...(item.links !== undefined ? { links: item.links } : {}),
      ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
    };
    const five = projectSchemeItemFiveFields({ dto });
    out.push({ id, text, ...five });
  }
  return out;
}

/**
 * 呈现上报（J.16 / GAP-P8）。`confirmationId` 由父级在方案修订期间铸造并保持稳定；
 * `onReport` 失败不阻塞渲染，只留痕（console.warn + data-surface-log="failed"）。
 */
export interface ScopeAcceptanceSurfaceProps {
  confirmationId: string;
  onReport: (report: SurfacePresentationReport) => Promise<unknown>;
}

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
  /** 挂账⑬ / J.38b：台账验收条目（只读投影，可含五字段）；渲染即展示，展示后按 acceptance 段上报 */
  acceptanceItems?: readonly ScopeAcceptanceItemView[] | undefined;
  /**
   * J16-P7：取数完成或失败后为 true。仅在此时且条目为空时标「无呈现记录」；
   * 取数完成前或尚无方案时不得提前标，避免加载中闪现该文案。
   */
  acceptanceSettled?: boolean | undefined;
  /** J.16：存在时，在区块真正展示之后上报实际呈现的条目 */
  surface?: ScopeAcceptanceSurfaceProps | undefined;
  /**
   * TASK-J.38e：测试目标建议（只读；一律 ai_inferred）。
   * 不写入台账 / 不进 can_merge；空或未传则不渲染建议块。
   */
  testTargetSuggestions?: readonly TestTargetSuggestion[] | undefined;
}

/**
 * 当前模式下**确已展示**的可引用条目（与下方渲染分支一一对应，不预写）：
 * - 只读态：展示的会改动区域（FullReadonlyList 逐条列出）；
 * - 开工前：敏感项的标签在「含 N 处敏感改动」按钮里可见，即展示过。
 * 验收条目 `verification.plain` 没有稳定 id，本切片不上报（不伪造 item_ref）。
 */
export function scopeAcceptanceShownItems(
  plan: ScopePlan | null,
  mode: ScopeAcceptanceMode,
  acceptanceItems: readonly ScopeAcceptanceItemView[] = [],
): { item_ref: string; section: SurfacePresentationSection }[] {
  const acceptanceShown = presentableAcceptanceItems(acceptanceItems).map(
    (item) => ({
      item_ref: item.id,
      section: "acceptance" as const,
    }),
  );
  return [...acceptanceShown, ...planShownItems(plan, mode)];
}

function planShownItems(
  plan: ScopePlan | null,
  mode: ScopeAcceptanceMode,
): { item_ref: string; section: SurfacePresentationSection }[] {
  if (!plan) return [];
  if (mode === "frozen" || mode === "acceptance") {
    return plan.areas
      .filter((a) => !a.excluded_by_user)
      .map((a) => ({ item_ref: a.id, section: "area" as const }));
  }
  return plan.needs_approval
    .filter((item) => item.approved !== false)
    .map((item) => ({ item_ref: item.id, section: "approval" as const }));
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
          <p
            data-testid="scope-acceptance-manual-only"
            className="text-muted-foreground"
          >
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
      <p
        data-testid="scope-acceptance-budget"
        className="text-muted-foreground"
      >
        预计规模：{plan.budget.plain}
      </p>
    </div>
  );
}

export function ScopeAcceptanceBlock(props: ScopeAcceptanceBlockProps) {
  const mode: ScopeAcceptanceMode =
    props.mode ?? (props.frozen ? "frozen" : "pre_start");
  const readOnly = mode === "frozen" || mode === "acceptance";
  const plan = props.plan;

  const pending = plan ? pendingSensitive(plan) : [];
  const showSensitive = pending.length > 0;
  const [expanded, setExpanded] = useState(
    Boolean(props.approvalRequired || props.forceExpandSensitive),
  );
  const suggestions = props.testTargetSuggestions ?? [];
  const [suggestOpen, setSuggestOpen] = useState(false);

  const shown = scopeAcceptanceShownItems(
    plan,
    mode,
    props.acceptanceItems ?? [],
  );
  const shownKey = JSON.stringify(shown);
  const surfacePhase = mode === "pre_start" ? "pre_confirm" : "post_confirm";
  const surfaceConfirmationId = props.surface?.confirmationId ?? null;
  const [surfaceStatus, setSurfaceStatus] = useState<
    "idle" | "reported" | "failed"
  >("idle");
  const onReportRef = useRef(props.surface?.onReport ?? null);
  useEffect(() => {
    onReportRef.current = props.surface?.onReport ?? null;
  });

  // 渲染提交之后才上报：条目已在 DOM 中，不是渲染前预写。
  useEffect(() => {
    const report = onReportRef.current;
    const items = JSON.parse(shownKey) as SurfacePresentationReport["shown"];
    if (!surfaceConfirmationId || !report || items.length === 0) return;
    let cancelled = false;
    const payload: SurfacePresentationReport = {
      confirmation_id: surfaceConfirmationId,
      plain_text_version: SCOPE_ACCEPTANCE_PLAIN_TEXT_VERSION,
      presented_at: new Date().toISOString(),
      phase: surfacePhase,
      shown: items,
    };
    Promise.resolve()
      .then(() => report(payload))
      .then(
        () => {
          if (!cancelled) setSurfaceStatus("reported");
        },
        (err: unknown) => {
          console.warn("[surface-log] 呈现记录上报失败，页面照常显示", err);
          if (!cancelled) setSurfaceStatus("failed");
        },
      );
    return () => {
      cancelled = true;
    };
  }, [surfaceConfirmationId, shownKey, surfacePhase]);

  useEffect(() => {
    if (props.approvalRequired || props.forceExpandSensitive) {
      setExpanded(true);
    }
  }, [props.approvalRequired, props.forceExpandSensitive]);

  // TASK-J.22b：逐条 id+文案；空台账不伪造；空态口径明确（「无呈现记录」）。
  const acceptanceRows = presentableAcceptanceItems(
    props.acceptanceItems ?? [],
  );

  return (
    <section
      data-testid="scope-acceptance-block"
      data-mode={mode}
      data-readonly={readOnly ? "true" : "false"}
      data-surface-log={surfaceStatus}
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

      {acceptanceRows.length > 0 ? (
        <div
          data-testid="scope-acceptance-criteria"
          className="mb-2 space-y-1 text-xs"
        >
          <h4 className="font-medium text-foreground">验收条目</h4>
          <ul className="space-y-0.5 text-muted-foreground">
            {acceptanceRows.map((item) => (
              <li
                key={item.id}
                data-testid="scope-acceptance-criterion-row"
                data-item-ref={item.id}
                data-projection-status={item.status}
                data-projection-confidence={item.confidence}
                className="flex flex-col gap-0.5 leading-relaxed"
              >
                <div className="flex gap-1.5">
                  <span
                    data-testid="scope-acceptance-criterion-id"
                    className="shrink-0 font-mono text-[11px] text-foreground"
                  >
                    {item.id}
                  </span>
                  <span
                    data-testid="scope-acceptance-criterion-text"
                    className="min-w-0"
                  >
                    {item.text}
                  </span>
                </div>
                {item.status ||
                item.scope ||
                item.provenance ||
                (item.links && item.links.length > 0) ||
                item.confidence ? (
                  <dl
                    data-testid="scope-acceptance-criterion-projection"
                    className="ml-4 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
                  >
                    {item.status ? (
                      <>
                        <dt>状态</dt>
                        <dd data-testid="scope-acceptance-projection-status">
                          {item.status}
                        </dd>
                      </>
                    ) : null}
                    {item.scope ? (
                      <>
                        <dt>范围</dt>
                        <dd data-testid="scope-acceptance-projection-scope">
                          {item.scope}
                        </dd>
                      </>
                    ) : null}
                    {item.provenance ? (
                      <>
                        <dt>来源</dt>
                        <dd data-testid="scope-acceptance-projection-provenance">
                          {item.provenance}
                        </dd>
                      </>
                    ) : null}
                    {item.links && item.links.length > 0 ? (
                      <>
                        <dt>关联</dt>
                        <dd data-testid="scope-acceptance-projection-links">
                          {item.links.join(" · ")}
                        </dd>
                      </>
                    ) : null}
                    {item.confidence ? (
                      <>
                        <dt>置信</dt>
                        <dd data-testid="scope-acceptance-projection-confidence">
                          {item.confidence}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : props.acceptanceSettled === true ? (
        <p
          data-testid="scope-acceptance-no-surface-record"
          className="mb-2 text-xs text-muted-foreground"
        >
          {NO_ACCEPTANCE_SURFACE_RECORD_LABEL}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <div
          data-testid="scope-acceptance-test-target-suggest"
          data-suggest-count={String(suggestions.length)}
          className="mb-2 rounded border border-dashed border-border/80 bg-muted/20 px-2 py-1.5 text-xs"
        >
          <button
            type="button"
            data-testid="scope-acceptance-test-target-suggest-toggle"
            aria-expanded={suggestOpen}
            onClick={() => setSuggestOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-medium text-foreground"
          >
            <span>
              AI 建议·非验收
              <span className="ml-1 font-normal text-muted-foreground">
                （{suggestions.length} 条，不进合并门禁）
              </span>
            </span>
            <span className="text-muted-foreground">
              {suggestOpen ? "收起" : "展开"}
            </span>
          </button>
          {suggestOpen ? (
            <ul
              data-testid="scope-acceptance-test-target-suggest-list"
              className="mt-1.5 space-y-1 text-[11px] text-muted-foreground"
            >
              {suggestions.map((s) => (
                <li
                  key={s.suggestion_id}
                  data-testid="scope-acceptance-test-target-suggest-row"
                  data-source={s.source}
                  data-derived-from={s.derived_from.join(",")}
                >
                  <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    AI 建议·非验收
                  </span>
                  {s.text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
                    <li
                      key={item.id}
                      data-testid="scope-acceptance-sensitive-item"
                    >
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
