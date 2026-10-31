/**
 * TASK-C.18：中间「方案审阅」单页。
 *
 * - 图表优先（mermaid 源码卡片；浏览器未接渲染器时仍可读）
 * - 冲突抉择 / AI 推荐决策确认
 * - 方案够完整才出现「生成 Demo」
 * - 最底只有「确认方案」（冻结 Spec → 开工）；无「继续澄清」按钮
 * - J.7：确认中三步人话进度；COMMIT 后中栏交接卡（不进右栏）
 */

import {
  HANDOFF_COMPENSATION_FAILED_MESSAGE,
  HANDOFF_LOCK_HINT,
  HANDOFF_UI_STEPS,
  handoffStepIndex,
  type HandoffUiStepId,
} from "@/lib/journey/handoff-progress";
import type {
  DemoGate,
  SchemeConfirmationDecision,
  SchemeDraft,
} from "@/lib/journey/scheme-draft";
import {
  EMPTY_DEMO_GATE,
  evaluateSchemeConfirmation,
} from "@/lib/journey/scheme-draft";
import type { ScopePlan } from "@/lib/journey/scope-plan";
import {
  ScopeAcceptanceBlock,
  type ScopeAcceptanceMode,
} from "@/components/studio/ScopeAcceptanceBlock";

export interface SchemeReviewPaneProps {
  scheme: SchemeDraft | null;
  demoUrl?: string | null | undefined;
  demoStatus?: string | null | undefined;
  demoGate?: DemoGate | undefined;
  demoBusy?: boolean | undefined;
  confirmBusy?: boolean | undefined;
  errorMessage?: string | null | undefined;
  confirmation?: SchemeConfirmationDecision | undefined;
  /** TASK-J.6：与当前修订绑定的范围预检 */
  scopePlan?: ScopePlan | null | undefined;
  scopeAcceptanceMode?: ScopeAcceptanceMode | undefined;
  forceExpandSensitive?: boolean | undefined;
  onDeclineSensitive?: (() => void) | undefined;
  onConfirmDecision?: ((decisionId: string) => void) | undefined;
  onResolveConflict?:
    ((conflictId: string, optionId: string) => void) | undefined;
  onNotesChange?: ((notes: string) => void) | undefined;
  onGenerateDemo?: (() => void) | undefined;
  onConfirmDemo?: (() => void) | undefined;
  onRetryDemo?: (() => void) | undefined;
  onAcceptDegradedDemo?: (() => void) | undefined;
  onConfirmScheme?: (() => void) | undefined;
  /**
   * J.7：交接进行中的当前人话步骤；有值时按钮区改为三步进度。
   */
  handoffStep?: HandoffUiStepId | null | undefined;
  /**
   * J.7：COMMIT 成功后的中栏交接卡文案（含节点数）；不进右栏。
   */
  handoffCardText?: string | null | undefined;
  /**
   * J.7：补偿失败时中栏诊断卡；右栏保持锁定。
   */
  handoffCompensationFailed?: boolean | undefined;
  /** 打开运行诊断（补偿失败入口） */
  onOpenHandoffDiagnose?: (() => void) | undefined;
}

function MermaidCard(props: { title: string; source: string; testId: string }) {
  if (!props.source.trim()) return null;
  return (
    <section
      data-testid={props.testId}
      className="rounded border border-border bg-card p-3"
    >
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        {props.title}
      </h3>
      <pre className="overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground">
        {props.source}
      </pre>
      <p className="mt-1 text-[10px] text-muted-foreground">
        （v0.1 先展示图表源码；后续可接 Mermaid 渲染）
      </p>
    </section>
  );
}

export function SchemeReviewPane(props: SchemeReviewPaneProps) {
  const scheme = props.scheme;
  const frozen = scheme?.frozen === true;
  const openConflicts =
    scheme?.conflicts.filter((c) => c.chosenId === null).length ?? 0;
  const demoGate = props.demoGate ?? EMPTY_DEMO_GATE;
  const confirmation =
    props.confirmation ??
    (scheme
      ? evaluateSchemeConfirmation(scheme, demoGate)
      : {
          ok: false,
          code: "E_SCHEME_NOT_REVIEWABLE" as const,
          message: "方案尚未生成",
          reasons: ["方案尚未生成"],
          demo_mode: "none" as const,
        });
  // SA-1：E_SCOPE_APPROVAL_REQUIRED 仍可点确认——点击时一键授权并提交。
  const approvalRequired = confirmation.code === "E_SCOPE_APPROVAL_REQUIRED";
  const canConfirm =
    Boolean(scheme) &&
    props.confirmBusy !== true &&
    !frozen &&
    (confirmation.ok || approvalRequired);
  const pendingSensitiveCount =
    props.scopePlan?.needs_approval.filter((i) => i.approved === null).length ??
    0;
  const demoConfirmed =
    scheme != null &&
    (demoGate.status === "ready" || demoGate.status === "degraded_flowcard") &&
    demoGate.scheme_revision === scheme.scheme_revision &&
    demoGate.decision_revision === scheme.scheme_revision;
  /**
   * 「过期」只表示 **冻结修订不一致**：Demo 是上一版方案生成的。
   * 不能把「刚生成但还没点确认」也算进来——那会让确认按钮直接禁用，
   * 用户永远点不到「确认此 Demo」。
   */
  const demoStale =
    scheme != null &&
    (demoGate.status === "ready" || demoGate.status === "degraded_flowcard") &&
    demoGate.scheme_revision !== scheme.scheme_revision;

  if (!scheme || (!scheme.title && scheme.modules.length === 0)) {
    return (
      <div
        data-testid="scheme-review-pane"
        data-empty="true"
        className="flex h-full min-h-0 flex-col overflow-auto p-4 text-sm"
      >
        <h2 className="text-sm font-semibold">方案审阅</h2>
        <p
          data-testid="scheme-empty"
          className="mt-3 text-xs leading-relaxed text-muted-foreground"
        >
          在右侧自由聊需求。Supervisor
          旁观足够后，这里会陆续出现架构图、流程、模块脑图和待你拍板的决策——不用做选择题剧本。
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="scheme-review-pane"
      data-frozen={frozen ? "true" : "false"}
      data-completeness={scheme.completeness}
      data-demo-ready={scheme.demoReady ? "true" : "false"}
      className="flex h-full min-h-0 flex-col overflow-auto p-4 text-sm"
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">方案审阅</h2>
        <span
          data-testid="scheme-completeness"
          className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          完整度 {scheme.completeness}%
        </span>
        {frozen ? (
          <span className="rounded bg-emerald-600/15 px-2 py-0.5 text-[10px] text-emerald-800">
            已确认 · Spec 已冻结
          </span>
        ) : null}
      </header>

      <section className="mb-3 rounded border border-border p-3">
        <h3
          data-testid="scheme-title"
          className="text-sm font-semibold text-foreground"
        >
          {scheme.title}
        </h3>
        <p
          data-testid="scheme-summary"
          className="mt-1 text-xs leading-relaxed text-muted-foreground"
        >
          {scheme.summary}
        </p>
        {scheme.modules.length > 0 ? (
          <ul
            data-testid="scheme-modules"
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {scheme.modules.map((m) => (
              <li
                key={m}
                className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
              >
                {m}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <MermaidCard
          title="架构示意"
          source={scheme.mermaidArchitecture}
          testId="scheme-mermaid-architecture"
        />
        <MermaidCard
          title="主流程"
          source={scheme.mermaidFlow}
          testId="scheme-mermaid-flow"
        />
      </div>
      <div className="mb-3">
        <MermaidCard
          title="功能业务模块脑图"
          source={scheme.mermaidMindmap}
          testId="scheme-mermaid-mindmap"
        />
      </div>

      {scheme.conflicts.length > 0 ? (
        <section
          data-testid="scheme-conflicts"
          className="mb-3 rounded border border-amber-700/40 bg-amber-500/10 p-3"
        >
          <h3 className="mb-2 text-xs font-semibold text-amber-950">
            需要你抉择的冲突（{openConflicts} 条未决）
          </h3>
          <ul className="space-y-3">
            {scheme.conflicts.map((c) => (
              <li key={c.id} data-testid="scheme-conflict-item">
                <p className="text-xs">{c.question}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.options.map((o) => {
                    const selected = c.chosenId === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        data-testid="scheme-conflict-option"
                        disabled={frozen}
                        data-selected={selected ? "true" : "false"}
                        onClick={() => props.onResolveConflict?.(c.id, o.id)}
                        className={`rounded border px-2 py-1 text-[11px] disabled:opacity-40 ${
                          selected
                            ? "border-amber-800 bg-amber-600/20 font-medium"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {scheme.decisions.length > 0 ? (
        <section
          data-testid="scheme-decisions"
          className="mb-3 rounded border border-border p-3"
        >
          <h3 className="mb-2 text-xs font-semibold">
            AI 推荐决策（对话未明说时的默认，请确认）
          </h3>
          <ul className="space-y-2">
            {scheme.decisions.map((d) => (
              <li
                key={d.id}
                data-testid="scheme-decision-item"
                data-confirmed={d.confirmed ? "true" : "false"}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="text-muted-foreground">{d.label}</span>
                <span className="font-medium">{d.recommended}</span>
                {d.confirmed ? (
                  <span className="text-[10px] text-emerald-700">已确认</span>
                ) : (
                  <button
                    type="button"
                    data-testid="scheme-decision-confirm"
                    disabled={frozen}
                    onClick={() => props.onConfirmDecision?.(d.id)}
                    className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-40"
                  >
                    采纳推荐
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ScopeAcceptanceBlock
        plan={props.scopePlan ?? null}
        mode={
          props.scopeAcceptanceMode ??
          (frozen ? "frozen" : "pre_start")
        }
        frozen={frozen}
        policyMessage={
          confirmation.code === "E_SCOPE_POLICY" ? confirmation.message : null
        }
        approvalRequired={approvalRequired}
        forceExpandSensitive={props.forceExpandSensitive}
        busy={props.confirmBusy}
        onDeclineSensitive={props.onDeclineSensitive}
      />

      <section className="mb-3 rounded border border-border p-3">
        <h3 className="mb-1.5 text-xs font-semibold">手改备注（可选）</h3>
        <textarea
          data-testid="scheme-notes"
          value={scheme.notes}
          disabled={frozen}
          onChange={(e) => props.onNotesChange?.(e.target.value)}
          rows={3}
          placeholder="可直接改方案细节；改完中间区会跟着更新。"
          className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs outline-none disabled:opacity-50"
        />
      </section>

      {props.errorMessage ? (
        <p data-testid="scheme-error" className="mb-2 text-xs text-destructive">
          {props.errorMessage}
        </p>
      ) : null}

      {props.demoUrl ? (
        <section
          data-testid="scheme-demo-embed"
          className="mb-3 overflow-hidden rounded border border-border"
        >
          <div className="border-b border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
            Demo 预览 · {props.demoStatus ?? "READY"} · {props.demoUrl}
          </div>
          <iframe
            title="方案 Demo"
            src={props.demoUrl}
            className="h-56 w-full bg-background"
            sandbox="allow-scripts"
          />
        </section>
      ) : null}

      {/* Demo 是可选增强项；失败只能重试或显式降级，不静默偷换。 */}
      {!frozen && demoGate.status === "failed" ? (
        <section
          data-testid="scheme-demo-failed"
          className="mb-3 rounded border border-rose-700/40 bg-rose-500/10 p-2 text-[11px]"
        >
          <p className="font-medium text-rose-900">Demo 生成失败。</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="scheme-demo-retry"
              disabled={props.demoBusy === true}
              onClick={() =>
                props.onRetryDemo
                  ? props.onRetryDemo()
                  : props.onGenerateDemo?.()
              }
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              重试生成
            </button>
            <button
              type="button"
              data-testid="scheme-demo-accept-degraded"
              disabled={props.demoBusy === true}
              onClick={() => props.onAcceptDegradedDemo?.()}
              className="rounded border border-amber-700/50 bg-amber-500/10 px-2 py-1 disabled:opacity-40"
            >
              接受仅用流程图说明开工（标风险）
            </button>
          </div>
        </section>
      ) : null}

      {!frozen &&
      props.demoUrl &&
      demoGate.status === "ready" &&
      !demoConfirmed ? (
        <div className="mb-3 rounded border border-sky-600/40 bg-sky-500/10 p-2 text-[11px]">
          <p>
            {demoStale
              ? "方案已改过，这个 Demo 与当前版本不对应。请重新生成后再确认。"
              : "请先试玩，并显式确认用于当前方案。"}
          </p>
          <button
            type="button"
            data-testid="scheme-demo-confirm"
            disabled={props.demoBusy === true || demoStale}
            onClick={() => props.onConfirmDemo?.()}
            className="mt-1.5 rounded border border-sky-700/50 px-2 py-1 disabled:opacity-40"
          >
            确认此 Demo
          </button>
        </div>
      ) : null}

      {!frozen && demoConfirmed ? (
        <p
          data-testid="scheme-demo-confirmed"
          className="mb-3 rounded border border-emerald-700/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-900"
        >
          {demoGate.status === "degraded_flowcard"
            ? "已接受流程图降级，确认方案时会复述风险。"
            : "Demo 已对当前方案确认。"}
        </p>
      ) : null}

      {/* 方案达到 demoReady 才出现生成入口；这不是开工前置。 */}
      {scheme.demoReady && !frozen ? (
        <div className="mb-3">
          <button
            type="button"
            data-testid="scheme-generate-demo"
            disabled={props.demoBusy === true}
            onClick={() => props.onGenerateDemo?.()}
            className="rounded border border-sky-700/50 bg-sky-600/90 px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >
            {props.demoBusy
              ? "生成中…"
              : props.demoUrl
                ? "重新生成 Demo"
                : "生成 Demo"}
          </button>
        </div>
      ) : null}

      {/* J.7：交接成功卡 / 补偿失败诊断 — 中栏画布，不进右栏 */}
      {props.handoffCardText ? (
        <section
          data-testid="handoff-started-card"
          className="mt-3 rounded border border-emerald-700/40 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-950"
        >
          {props.handoffCardText}
        </section>
      ) : null}
      {props.handoffCompensationFailed ? (
        <section
          data-testid="handoff-compensation-failed"
          className="mt-3 rounded border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed"
        >
          <p>{HANDOFF_COMPENSATION_FAILED_MESSAGE}</p>
          <button
            type="button"
            data-testid="handoff-compensation-diagnose"
            onClick={() => props.onOpenHandoffDiagnose?.()}
            className="mt-2 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-accent"
          >
            打开运行诊断
          </button>
        </section>
      ) : null}

      {/* 最底只有确认方案；无「继续澄清」 */}
      <div className="mt-auto border-t border-border pt-3">
        {!confirmation.ok && !frozen && !props.handoffStep ? (
          <p
            data-testid="scheme-confirm-blocked"
            className="mb-2 text-[11px] text-amber-800"
          >
            {confirmation.message}
          </p>
        ) : null}
{props.handoffStep ? (
          <div
            data-testid="handoff-progress"
            className="rounded border border-border bg-card p-3"
          >
            <p className="mb-2 text-xs font-semibold text-foreground">
              正在准备开工
            </p>
            <ol className="space-y-1.5 text-[11px] leading-relaxed">
              {HANDOFF_UI_STEPS.map((step) => {
                const current = handoffStepIndex(props.handoffStep!);
                const idx = handoffStepIndex(step.id);
                const mark =
                  idx < current ? "✓" : idx === current ? "●" : "○";
                return (
                  <li
                    key={step.id}
                    data-testid={`handoff-step-${step.id}`}
                    data-handoff-state={
                      idx < current
                        ? "done"
                        : idx === current
                          ? "active"
                          : "pending"
                    }
                    className={
                      idx === current
                        ? "font-medium text-foreground"
                        : idx < current
                          ? "text-emerald-800"
                          : "text-muted-foreground"
                    }
                  >
                    <span className="mr-1.5 inline-block w-3 text-center">
                      {mark}
                    </span>
                    {step.label}
                  </li>
                );
              })}
            </ol>
            <p
              data-testid="handoff-progress-hint"
              className="mt-2 text-[10px] text-muted-foreground"
            >
              {HANDOFF_LOCK_HINT}
            </p>
          </div>
        ) : (
          <button
            type="button"
            data-testid="scheme-confirm"
            disabled={!canConfirm}
            onClick={() => props.onConfirmScheme?.()}
            className="w-full rounded border border-emerald-800 bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {props.confirmBusy
              ? "冻结并开工中…"
              : frozen
                ? "方案已确认"
                : pendingSensitiveCount > 0
                  ? `确认方案（含 ${pendingSensitiveCount} 处敏感改动）`
                  : "确认方案"}
          </button>
        )}
        {!props.handoffStep ? (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            确认后冻结 Spec 并直接开工写代码。Demo
            是可选增强项；已生成则须先确认或显式接受降级。
          </p>
        ) : null}
      </div>
    </div>
  );
}
