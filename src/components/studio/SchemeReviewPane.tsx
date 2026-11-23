/**
 * TASK-C.18：中间「方案审阅」单页。
 *
 * - 图表优先（mermaid 源码卡片；浏览器未接渲染器时仍可读）
 * - 冲突抉择 / AI 推荐决策确认
 * - 方案够完整才出现「生成 Demo」
 * - 最底「确认方案，开始规划」（冻结并开始规划，不直接开工）；无「继续澄清」按钮
 * - J.7：开工交接中三步人话进度；COMMIT 后中栏交接卡（不进右栏）
 * - J.50b：规划中显示「正在整理项目地图…」；「正在准备开工」仅用于地图确认开工
 */

import { useEffect, useRef, useState } from "react";
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
  NO_SCHEME_YET_LABEL,
  acceptanceItemsFromSchemeDraft,
  evaluateSchemeConfirmation,
} from "@/lib/journey/scheme-draft";
import type { ScopePlan } from "@/lib/journey/scope-plan";
import type { TestTargetSuggestion } from "@/lib/journey/test-target-suggest";
import {
  ScopeAcceptanceBlock,
  type ScopeAcceptanceItemView,
  type ScopeAcceptanceMode,
  type ScopeAcceptanceSurfaceProps,
} from "@/components/studio/ScopeAcceptanceBlock";
import type { SurfacePresentationReport } from "@/lib/daemon-api";
import { ProjectMapPane } from "@/components/project/ProjectMapPane";
import { SystemMapPane } from "@/components/project/SystemMapPane";
import {
  PlaytestAcceptBlock,
  type PlaytestAcceptBlockProps,
} from "@/components/studio/PlaytestAcceptBlock";
import type { ProjectPlan } from "@/lib/project/project-plan";
import {
  SchemeQuoteBacklinkBlock,
  reconfirmChecksComplete,
  type SchemeQuoteBacklinkBlockProps,
} from "@/components/studio/SchemeQuoteBacklinkBlock";

export interface SchemeReviewPaneProps {
  scheme: SchemeDraft | null;
  /**
   * TASK-J.22a：台账缺失或无实质内容时为 true，空态标注「方案尚未生成」。
   */
  ledgerAbsent?: boolean | undefined;
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
  /** J.16：当前方案修订的确认 ID（与确认按钮使用同一键）；缺省则不上报呈现 */
  /**
   * TASK-J.22b / J.38b / 挂账⑬：台账验收条目（只读投影，可含五字段）。
   * 缺省时回退到 scheme.acceptance（同批 midpane 投影）；空数组表示已结算且无条目。
   */
  acceptanceItems?: readonly ScopeAcceptanceItemView[] | undefined;
  /** J16-P7 / J.22b：取数完成或失败后为 true，空条目时标「无呈现记录」 */
  acceptanceSettled?: boolean | undefined;
  /**
   * TASK-J.38e：测试目标建议（只读；ai_inferred）。
   * 透传 ScopeAcceptanceBlock；不写入台账 / 不进 can_merge。
   */
  testTargetSuggestions?: readonly TestTargetSuggestion[] | undefined;
  surfaceConfirmationId?: string | null | undefined;
  onSurfacePresented?: ScopeAcceptanceSurfaceProps["onReport"] | undefined;
  /** 决议区与范围区当前展示的白话正文。确认时对其做 sha256。 */
  onShownPlainText?: ((text: string) => void) | undefined;
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
   * 仅用于地图「确认开工」签署过程，规划路径不得设置该值。
   */
  handoffStep?: HandoffUiStepId | null | undefined;
  /**
   * TASK-J.50b：规划路径已冻结、正在 decompose / 刷新地图。
   * 有值时中栏显示「正在整理项目地图…」，不得写「正在准备开工」。
   */
  planningMapBusy?: boolean | undefined;
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
  /** TASK-L.10：同页嵌项目地图（有计划才渲染） */
  projectPlan?: ProjectPlan | null | undefined;
  /** 服务端权威下一份；前端不得本地重算 */
  projectNextStubId?: string | null | undefined;
  projectMapBusy?: boolean | undefined;
  onProjectMapConfirmStart?: ((stubId: string) => void) | undefined;
  onProjectMapDefer?: ((stubId: string) => void) | undefined;
  onProjectMapReorderForward?: ((stubId: string) => void) | undefined;
  /** TASK-L.17c：中栏同页对照试玩 + 原话认可（可选；缺省不渲染提交能力） */
  playtest?: PlaytestAcceptBlockProps | null | undefined;
  /**
   * TASK-J.32b：签字前对照面与信任档。缺省不渲染对照面，确认门禁与原来一致。
   */
  quoteBacklink?: SchemeQuoteBacklinkBlockProps | undefined;
}

/** 决议区白话投影的版本号；措辞变化时递增，写入 surface_log 的 plain_text_version。 */
export const SCHEME_DECISIONS_PLAIN_TEXT_VERSION =
  "scheme-decisions-v1" as const;

/**
 * 纯 JS SHA-256，与 Node createHash("sha256") 的小写 hex 对齐。
 * 确认前在浏览器里对已展示白话正文取哈希，不把 node:crypto 打进页面。
 */
export function shownPlainTextSha256(message: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array((bytes.length + 9 + 63) & ~63);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const v1 = w[j - 15]!;
      const v2 = w[j - 2]!;
      const s0 = rotr(v1, 7) ^ rotr(v1, 18) ^ (v1 >>> 3);
      const s1 = rotr(v2, 17) ^ rotr(v2, 19) ^ (v2 >>> 10);
      w[j] = (w[j - 16]! + s0 + w[j - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j]! + w[j]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

/** 决议区当前会画出来的白话。空态与冻结后都不算确认前的展示。 */
export function schemeDecisionPlainText(scheme: SchemeDraft | null): string {
  if (!scheme || scheme.frozen) return "";
  if (!scheme.title && scheme.modules.length === 0) return "";
  const lines: string[] = [];
  if (scheme.conflicts.length > 0) {
    const open = scheme.conflicts.filter((c) => c.chosenId === null).length;
    lines.push(`需要你抉择的冲突（${open} 条未决）`);
    for (const conflict of scheme.conflicts) {
      lines.push(conflict.question);
      for (const option of conflict.options) lines.push(option.label);
    }
  }
  if (scheme.decisions.length > 0) {
    lines.push("AI 推荐决策（对话未明说时的默认，请确认）");
    for (const decision of scheme.decisions) {
      lines.push(
        `${decision.label} ${decision.recommended} ${decision.confirmed ? "已确认" : "采纳推荐"}`,
      );
    }
  }
  return lines.join("\n");
}

export function joinShownPlainText(decision: string, scope: string): string {
  return [decision, scope].filter((part) => part.length > 0).join("\n");
}

/**
 * 确认前决议区确已展示的条目（§5.3 decision 段：冲突抉择与 AI 推荐决策），
 * 与下方渲染分支一一对应：空态不渲染决议区，冻结后的展示不算确认前的呈现。
 */
export function schemeDecisionShownItems(
  scheme: SchemeDraft | null,
): SurfacePresentationReport["shown"] {
  if (!scheme || scheme.frozen) return [];
  if (!scheme.title && scheme.modules.length === 0) return [];
  return [
    ...scheme.conflicts.map((c) => ({
      item_ref: c.id,
      section: "decision" as const,
    })),
    ...scheme.decisions.map((d) => ({
      item_ref: d.id,
      section: "decision" as const,
    })),
  ];
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

  const decisionShownKey = JSON.stringify(schemeDecisionShownItems(scheme));
  const decisionPlain = schemeDecisionPlainText(scheme);
  const [scopePlain, setScopePlain] = useState("");
  const onShownPlainTextRef = useRef(props.onShownPlainText ?? null);
  useEffect(() => {
    onShownPlainTextRef.current = props.onShownPlainText ?? null;
  });
  useEffect(() => {
    onShownPlainTextRef.current?.(
      joinShownPlainText(decisionPlain, scopePlain),
    );
  }, [decisionPlain, scopePlain]);
  const surfaceConfirmationId = props.surfaceConfirmationId ?? null;
  const onSurfacePresentedRef = useRef(props.onSurfacePresented ?? null);
  useEffect(() => {
    onSurfacePresentedRef.current = props.onSurfacePresented ?? null;
  });
  // 渲染提交之后才上报：决议区条目已在 DOM 中，不是渲染前预写；失败只留痕，不挡渲染。
  useEffect(() => {
    const report = onSurfacePresentedRef.current;
    const shown = JSON.parse(
      decisionShownKey,
    ) as SurfacePresentationReport["shown"];
    if (!surfaceConfirmationId || !report || shown.length === 0) return;
    void Promise.resolve()
      .then(() =>
        report({
          confirmation_id: surfaceConfirmationId,
          plain_text_version: SCHEME_DECISIONS_PLAIN_TEXT_VERSION,
          presented_at: new Date().toISOString(),
          phase: "pre_confirm",
          shown,
        }),
      )
      .catch((err: unknown) => {
        console.warn("[surface-log] 决议区呈现记录上报失败，页面照常显示", err);
      });
  }, [surfaceConfirmationId, decisionShownKey]);

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
  const quoteBacklink = props.quoteBacklink;
  const quoteBacklinkBlocksConfirm =
    quoteBacklink !== undefined &&
    (quoteBacklink.busy === true ||
      quoteBacklink.preview == null ||
      quoteBacklink.preview.ok === false ||
      !reconfirmChecksComplete(
        quoteBacklink.trustTier,
        quoteBacklink.preview,
        quoteBacklink.checkedIds,
      ));
  const canConfirm =
    Boolean(scheme) &&
    props.confirmBusy !== true &&
    !frozen &&
    (confirmation.ok || approvalRequired) &&
    !quoteBacklinkBlocksConfirm;
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

  if (
    props.ledgerAbsent === true ||
    !scheme ||
    (!scheme.title && scheme.modules.length === 0)
  ) {
    const emptyLabel =
      props.ledgerAbsent === true
        ? NO_SCHEME_YET_LABEL
        : "在右侧自由聊需求。Supervisor 旁观足够后，这里会陆续出现架构图、流程、模块脑图和待你拍板的决策——不用做选择题剧本。";
    return (
      <div
        data-testid="scheme-review-pane"
        data-empty="true"
        data-ledger-absent={props.ledgerAbsent === true ? "true" : "false"}
        className="flex h-full min-h-0 flex-col overflow-auto p-4 text-sm"
      >
        <h2 className="text-sm font-semibold">方案审阅</h2>
        <p
          data-testid={
            props.ledgerAbsent === true ? "scheme-no-ledger" : "scheme-empty"
          }
          className="mt-3 text-xs leading-relaxed text-muted-foreground"
        >
          {emptyLabel}
        </p>
        {props.playtest ? (
          <div className="mt-4">
            <PlaytestAcceptBlock {...props.playtest} />
          </div>
        ) : null}
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

      {props.projectPlan ? (
        <ProjectMapPane
          plan={props.projectPlan}
          nextStubId={props.projectNextStubId ?? null}
          busy={props.projectMapBusy === true || props.confirmBusy === true}
          onConfirmStart={props.onProjectMapConfirmStart}
          onDefer={props.onProjectMapDefer}
          onReorderForward={props.onProjectMapReorderForward}
        />
      ) : null}

      {/* TASK-L.18：同页嵌系统地图（禁止另开 ActivityBar Tab） */}
      <SystemMapPane />

      {/* TASK-L.17c：同页嵌对照试玩 + 原话「认可完成」（不另开 Tab / 右栏） */}
      {props.playtest ? <PlaytestAcceptBlock {...props.playtest} /> : null}

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
        {scheme.goals && scheme.goals.length > 0 ? (
          <ul
            data-testid="scheme-goals"
            className="mt-2 list-disc space-y-1 pl-4 text-xs text-foreground"
          >
            {scheme.goals.map((g) => (
              <li key={g.id} data-goal-id={g.id}>
                {g.text}
              </li>
            ))}
          </ul>
        ) : null}
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
        mode={props.scopeAcceptanceMode ?? (frozen ? "frozen" : "pre_start")}
        frozen={frozen}
        policyMessage={
          confirmation.code === "E_SCOPE_POLICY" ? confirmation.message : null
        }
        approvalRequired={approvalRequired}
        forceExpandSensitive={props.forceExpandSensitive}
        busy={props.confirmBusy}
        onDeclineSensitive={props.onDeclineSensitive}
        acceptanceItems={
          props.acceptanceItems !== undefined
            ? props.acceptanceItems
            : acceptanceItemsFromSchemeDraft(scheme)
        }
        acceptanceSettled={props.acceptanceSettled}
        testTargetSuggestions={props.testTargetSuggestions}
        onShownPlainText={setScopePlain}
        surface={
          props.surfaceConfirmationId && props.onSurfacePresented
            ? {
                confirmationId: props.surfaceConfirmationId,
                onReport: props.onSurfacePresented,
              }
            : undefined
        }
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

      {/* TASK-J.32b：对照面挂在最底确认区之前，不另开整页 */}
      {!frozen && quoteBacklink ? (
        <SchemeQuoteBacklinkBlock {...quoteBacklink} />
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
                const mark = idx < current ? "✓" : idx === current ? "●" : "○";
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
        ) : props.planningMapBusy ? (
          <div
            data-testid="scheme-planning-map-progress"
            className="rounded border border-border bg-card p-3"
          >
            <p className="text-xs font-semibold text-foreground">
              正在整理项目地图…
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
              ? "开始规划中…"
              : frozen
                ? "方案已确认"
                : pendingSensitiveCount > 0
                  ? `确认方案，开始规划（含 ${pendingSensitiveCount} 处敏感改动）`
                  : "确认方案，开始规划"}
          </button>
        )}
        {!props.handoffStep && !props.planningMapBusy ? (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            确认方案，开始规划。Demo
            是可选增强项；已生成则须先确认或显式接受降级。
          </p>
        ) : null}
      </div>
    </div>
  );
}
