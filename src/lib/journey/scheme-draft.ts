/**
 * TASK-C.18 / C.22 / J.3：方案草案（中间「方案审阅」单页的数据模型）。
 *
 * C.18：规则/启发式从对话与意图拼出模块图与决策。
 * C.22（SSOT v2.0.1）：
 * - demoReady = 四条硬性布尔底线（§14.10：≥1 个有界面模块、≥1 主流程、无 OPEN 冲突、
 *   ≥1 轮有效业务输入）；completeness 仅展示，不参与门禁
 * - user_pinned 字段级脏检查：随聊合并不覆盖已 pin
 * - canConfirmScheme 是向后兼容别名；真实门禁统一走
 *   evaluateSchemeConfirmation（含 Demo 与 revision 绑定）
 * J.3 / J.5（SSOT §15.5 / D7）：第三参 scopePlan；三条范围拒绝码恒开启。
 */

import {
  plainAreaLabel,
  type ScopePlan,
} from "./scope-plan";

export interface SchemeDecision {
  id: string;
  label: string;
  recommended: string;
  alternatives: string[];
  /** 用户是否已确认（含采纳推荐） */
  confirmed: boolean;
  source: "ai_default" | "user";
  /** 用户手改过该决策 → 随聊不得覆盖 */
  user_pinned?: boolean;
}

export interface SchemeConflict {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  chosenId: string | null;
  user_pinned?: boolean;
}

/** 可 pin 的顶层字段键 */
export type SchemePinnedField =
  | "title"
  | "summary"
  | "modules"
  | "notes"
  | "mermaidArchitecture"
  | "mermaidFlow"
  | "mermaidMindmap";

export interface SchemeDraft {
  /** 本轮方案身份；确认/快照/审计共用，不随标题变化。 */
  scheme_id: string;
  /** 内容修订号；任何用户或 Supervisor 写入都递增。 */
  scheme_revision: number;
  title: string;
  summary: string;
  modules: string[];
  mermaidArchitecture: string;
  mermaidFlow: string;
  mermaidMindmap: string;
  decisions: SchemeDecision[];
  conflicts: SchemeConflict[];
  /** 0–100；只做展示，不参与 demoReady / 确认门禁 */
  completeness: number;
  demoReady: boolean;
  frozen: boolean;
  /** 用户手改备注 */
  notes: string;
  updatedAt: string;
  /** 字段级脏标记：被用户手改过的顶层字段 */
  pinned_fields: SchemePinnedField[];
  /** 有效业务属性输入轮次（非寒暄） */
  business_input_rounds: number;
  /**
   * V2 白话验收条目（可选；TASK-L.3 投影进合同 supervisor_metadata.acceptance_refs）。
   * 未接线前可缺省；有 auto/both 时 withSystemScope 会并入 tests/stagent/**。
   */
  acceptance?: Array<{
    id: string;
    text: string;
    check: "auto" | "playtest" | "both";
  }>;
}

/**
 * Demo 生成/确认状态。
 *
 * 注意：`ready` 只表示“已生成、可试玩”，不表示用户已确认。
 * 是否与当前方案匹配由 `status + scheme_revision + decision_revision` 共同决定。
 */
export type DemoGateStatus =
  "none" | "building" | "ready" | "failed" | "degraded_flowcard";

export interface DemoGate {
  status: DemoGateStatus;
  /** 原型生成时的方案修订号 */
  scheme_revision: number | null;
  /** 用户确认 Demo / 接受降级时的方案修订号 */
  decision_revision: number | null;
  prototype_id?: string | null;
  risk_flags?: string[];
}

export const EMPTY_DEMO_GATE: DemoGate = {
  status: "none",
  scheme_revision: null,
  decision_revision: null,
};

export type SchemeConfirmationCode =
  | "OK"
  | "E_SCHEME_ALREADY_FROZEN"
  | "E_SCHEME_REVISION_MISMATCH"
  | "E_SCHEME_CONFLICTS_OPEN"
  | "E_SCHEME_NOT_REVIEWABLE"
  | "E_DEMO_BUILDING"
  | "E_DEMO_FAILED"
  | "E_DEMO_CONFIRMATION_REQUIRED"
  | "E_DEMO_STALE"
  /** J.3 / SSOT §15.5：尚无与当前修订绑定的 ScopePlan */
  | "E_SCOPE_NOT_READY"
  /** J.3：自动收敛后范围仍不合规 */
  | "E_SCOPE_POLICY"
  /** J.3 / ADR-0014：提交的 ScopePlan 仍有未授权敏感项 */
  | "E_SCOPE_APPROVAL_REQUIRED";

export interface SchemeConfirmationDecision {
  ok: boolean;
  code: SchemeConfirmationCode;
  message: string;
  /** 命中的全部原因，供 UI 一次说清，不只显示第一条。 */
  reasons: string[];
  demo_mode: "none" | "interactive" | "degraded";
}

const MODULE_HINTS: { re: RegExp; label: string }[] = [
  { re: /进度|工期|里程碑|管控/, label: "工程进度管控" },
  { re: /财务|预算|费用|成本|对账|匹配/, label: "财务数据与预算" },
  { re: /预警|告警|提醒/, label: "预警中心" },
  { re: /报表|月度|报告/, label: "月度报表" },
  { re: /登录|账号|权限|用户/, label: "账号与权限" },
  { re: /看板|仪表|dashboard/i, label: "总览看板" },
];

/** 寒暄/无效输入：不算业务轮次 */
const SMALLTALK_RE =
  /^(你好|您好|在吗|嗨|hi|hello|谢谢|感谢|好的|嗯|哦|ok|okay)[\s!！.。?？]*$/i;

/** 含业务属性的实质陈述 */
const BUSINESS_ATTR_RE =
  /进度|财务|预算|预警|报表|模块|流程|用户|权限|数据|假数据|真库|界面|文案|受众|客户|员工|桌面|软件|功能|验收|告警|匹配|管控|看板|登录/;

function newSchemeId(): string {
  return `scheme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySchemeDraft(partial?: Partial<SchemeDraft>): SchemeDraft {
  const now = new Date().toISOString();
  return {
    scheme_id: newSchemeId(),
    scheme_revision: 1,
    title: "",
    summary: "",
    modules: [],
    mermaidArchitecture: "",
    mermaidFlow: "",
    mermaidMindmap: "",
    decisions: [],
    conflicts: [],
    completeness: 0,
    demoReady: false,
    frozen: false,
    notes: "",
    updatedAt: now,
    pinned_fields: [],
    business_input_rounds: 0,
    ...partial,
  };
}

function extractModules(text: string): string[] {
  const found: string[] = [];
  for (const h of MODULE_HINTS) {
    if (h.re.test(text) && !found.includes(h.label)) found.push(h.label);
  }
  if (found.length === 0 && text.trim().length >= 8) {
    found.push("核心业务模块");
  }
  if (found.length > 0 && !found.includes("桌面端壳")) {
    found.push("桌面端壳");
  }
  return found.slice(0, 8);
}

function buildMermaidArchitecture(title: string, modules: string[]): string {
  const safe = (s: string) =>
    s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").slice(0, 24);
  const lines = ["flowchart TB", `  UI["${safe(title || "应用")}"]`];
  modules.forEach((m, i) => {
    lines.push(`  M${i}["${safe(m)}"]`);
    lines.push(`  UI --> M${i}`);
  });
  return lines.join("\n");
}

function buildMermaidFlow(modules: string[]): string {
  const safe = (s: string) =>
    s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").slice(0, 20);
  if (modules.length === 0) {
    return [
      "flowchart LR",
      "  A[说出需求] --> B[方案审阅]",
      "  B --> C[确认方案]",
      "  C --> D[写代码]",
    ].join("\n");
  }
  const lines = ["flowchart LR"];
  modules.forEach((m, i) => {
    lines.push(`  S${i}["${safe(m)}"]`);
    if (i > 0) lines.push(`  S${i - 1} --> S${i}`);
  });
  return lines.join("\n");
}

function buildMermaidMindmap(title: string, modules: string[]): string {
  const safe = (s: string) =>
    s.replace(/[^a-zA-Z0-9\u4e00-\u9fff ]+/g, "").slice(0, 24);
  const lines = ["mindmap", `  root((${safe(title || "方案")}))`];
  for (const m of modules) {
    lines.push(`    ${safe(m)}`);
  }
  return lines.join("\n");
}

function defaultDecisions(modules: string[]): SchemeDecision[] {
  const decisions: SchemeDecision[] = [
    {
      id: "dec_audience",
      label: "主要给谁用",
      recommended: "最终用户（自己点）",
      alternatives: ["后台管理员", "两边都要"],
      confirmed: false,
      source: "ai_default",
    },
    {
      id: "dec_data",
      label: "演示数据",
      recommended: "先用假数据，不碰真实业务库",
      alternatives: ["只读连一点真实数据", "允许写入真实环境"],
      confirmed: false,
      source: "ai_default",
    },
  ];
  if (modules.some((m) => /预警/.test(m))) {
    decisions.push({
      id: "dec_alert",
      label: "预警方式",
      recommended: "页面内醒目提示即可",
      alternatives: ["还要邮件/消息推送", "先不做预警"],
      confirmed: false,
      source: "ai_default",
    });
  }
  return decisions;
}

function detectConflicts(corpus: string, modules: string[]): SchemeConflict[] {
  const conflicts: SchemeConflict[] = [];
  const wantsPolish = /界面|文案|一次到位|好看|精致/.test(corpus);
  const wantsFast = /先跑通|主流程|MVP|尽快|先演示/.test(corpus);
  if (wantsPolish && wantsFast) {
    conflicts.push({
      id: "cf_scope_depth",
      question: "对话里既想「先跑通」又想「界面一次到位」——这一版以哪个为准？",
      options: [
        { id: "fast", label: "先跑通主流程，界面以后再说" },
        { id: "polish", label: "界面和文案也要一次到位" },
      ],
      chosenId: null,
    });
  }
  if (modules.length >= 4 && !/分阶段|先做|第一期|MVP/.test(corpus)) {
    conflicts.push({
      id: "cf_phase",
      question: "模块偏多。第一版是否先做其中一部分？",
      options: [
        { id: "all", label: "这一版尽量都做（假数据演示）" },
        { id: "core", label: "先做进度+预警，财务与报表下一期" },
      ],
      chosenId: null,
    });
  }
  return conflicts;
}

export function scoreCompleteness(draft: SchemeDraft): number {
  let score = 0;
  if (draft.title.trim().length >= 4) score += 15;
  if (draft.summary.trim().length >= 12) score += 15;
  if (draft.modules.length >= 2) score += 20;
  if (draft.modules.length >= 4) score += 10;
  if (draft.decisions.length > 0) score += 10;
  const confirmed = draft.decisions.filter((d) => d.confirmed).length;
  if (confirmed > 0) score += Math.min(15, confirmed * 5);
  const openConflicts = draft.conflicts.filter((c) => !c.chosenId).length;
  if (draft.conflicts.length > 0 && openConflicts === 0) score += 15;
  else if (draft.conflicts.length === 0 && draft.modules.length >= 2)
    score += 10;
  if (draft.notes.trim().length >= 8) score += 5;
  return Math.min(100, score);
}

/** 是否有可表达的主流程（≥1 条） */
export function hasMainFlow(
  draft: Pick<SchemeDraft, "modules" | "mermaidFlow">,
): boolean {
  if (
    draft.modules.length >= 1 &&
    draft.mermaidFlow.trim().includes("flowchart")
  ) {
    return true;
  }
  return /-->/.test(draft.mermaidFlow);
}

/**
 * completeness 只在 UI 展示，绝不参与本函数——否则“辅助分”会变成隐藏硬门禁。
 *
 * SSOT §14.10 / D6：`demoReady = ≥1 个有界面模块 && ≥1 条主流程 && 无未选冲突 && ≥1 轮业务输入`。
 * V1 `modules: string[]` 把每个字符串模块视为有界面（启发式离线路径）；
 * 纯逻辑任务应使用 V2 的 `user_visible: false`（见 {@link computeDemoReadyFromModules}）。
 */
export function computeDemoReady(draft: SchemeDraft): boolean {
  const openConflicts = draft.conflicts.filter(
    (c) => c.chosenId === null,
  ).length;
  return (
    draft.modules.length >= 1 &&
    hasMainFlow(draft) &&
    openConflicts === 0 &&
    draft.business_input_rounds >= 1
  );
}

/** §14.10 显式 user_visible 判定（引擎态 / V2）。 */
export function computeDemoReadyFromModules(input: {
  modules: readonly { user_visible: boolean }[];
  has_main_flow: boolean;
  open_conflicts: number;
  business_input_rounds: number;
}): boolean {
  return (
    input.modules.some((m) => m.user_visible) &&
    input.has_main_flow &&
    input.open_conflicts === 0 &&
    input.business_input_rounds >= 1
  );
}

function isReviewableScheme(draft: SchemeDraft): boolean {
  return (
    draft.title.trim().length >= 2 &&
    (draft.summary.trim().length >= 8 || draft.modules.length >= 1)
  );
}

/** 被拒路径 → 白话区域名（优先 areas.label，否则 plainAreaLabel；绝不回传通配符）。 */
function plainRejectedScopeLabels(plan: ScopePlan): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const rejected of plan.grade.rejected) {
    const area = plan.areas.find((a) => a.paths.includes(rejected.path));
    const label = area?.label?.trim()
      ? area.label.trim()
      : plainAreaLabel(rejected.path);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function scopePolicyMessage(plan: ScopePlan): string {
  const labels = plainRejectedScopeLabels(plan);
  const shown = labels.length > 0 ? labels[0]! : "这部分";
  // SSOT §15.5 表格原文结构；多区域时只点名首个，避免堆砌路径。
  return `『${shown}』范围太大，我没法替你担保不误伤。请告诉我具体要改哪块，或把这部分拆成单独一轮。`;
}

function evaluateScopeGate(
  draft: SchemeDraft,
  scopePlan: ScopePlan | null,
  demoMode: SchemeConfirmationDecision["demo_mode"],
): SchemeConfirmationDecision | null {
  if (scopePlan == null || scopePlan.scheme_revision !== draft.scheme_revision) {
    return {
      ok: false,
      code: "E_SCOPE_NOT_READY",
      message: "正在核对要改哪些地方…",
      reasons: ["改动范围尚未与当前方案对齐"],
      demo_mode: demoMode,
    };
  }
  if (!scopePlan.grade.ok) {
    const message = scopePolicyMessage(scopePlan);
    return {
      ok: false,
      code: "E_SCOPE_POLICY",
      message,
      reasons: [message],
      demo_mode: demoMode,
    };
  }
  // SSOT §15.5 / SA-1：仅「尚未表态」(null) 阻断；approved===false 表示已拒绝并入 never_touch。
  const pending = scopePlan.needs_approval.filter(
    (item) => item.approved === null,
  );
  if (pending.length > 0) {
    const message = `还有 ${pending.length} 处敏感改动会写在确认开工上`;
    return {
      ok: false,
      code: "E_SCOPE_APPROVAL_REQUIRED",
      message,
      reasons: [message],
      demo_mode: demoMode,
    };
  }
  return null;
}

/**
 * 唯一确认门禁（SSOT v2.0.2 §3.5 + v2.1 §15.5）。
 *
 * 允许：
 * - 从未生成 Demo（demo.status=none）；
 * - Demo 对当前 revision 生成且用户对同一 revision 显式确认；
 * - Demo 已失败/不可用，用户对当前 revision 显式接受流程图降级；
 * - 与当前修订绑定、grade.ok、敏感项均已授权的 ScopePlan（J.5 恒校验）。
 *
 * 拒绝：
 * - 生成/确认后方案又改过（revision 不一致）；
 * - 已生成但未确认；
 * - building / failed 尚未处置；
 * - E_SCOPE_NOT_READY / E_SCOPE_POLICY / E_SCOPE_APPROVAL_REQUIRED。
 *
 * 判定顺序：冻结 → 冲突 → 可审 → Demo 四码 → 三条范围码。
 */
export function evaluateSchemeConfirmation(
  draft: SchemeDraft,
  demo: DemoGate = EMPTY_DEMO_GATE,
  scopePlan: ScopePlan | null = null,
): SchemeConfirmationDecision {
  const reasons: string[] = [];

  if (draft.frozen) {
    return {
      ok: false,
      code: "E_SCHEME_ALREADY_FROZEN",
      message: "方案已冻结，不能重复确认",
      reasons: ["方案已冻结"],
      demo_mode: "none",
    };
  }

  const openConflicts = draft.conflicts.filter(
    (c) => c.chosenId === null,
  ).length;
  if (openConflicts > 0) {
    reasons.push(`仍有 ${openConflicts} 条未决冲突`);
  }
  if (!isReviewableScheme(draft)) {
    reasons.push("方案摘要不足，至少需要可读标题与摘要/模块");
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      code:
        openConflicts > 0
          ? "E_SCHEME_CONFLICTS_OPEN"
          : "E_SCHEME_NOT_REVIEWABLE",
      message: reasons.join("；"),
      reasons,
      demo_mode: "none",
    };
  }

  if (demo.status === "building") {
    return {
      ok: false,
      code: "E_DEMO_BUILDING",
      message: "Demo 仍在生成，请等完成或先重试",
      reasons: ["Demo 仍在生成"],
      demo_mode: "none",
    };
  }
  if (demo.status === "failed") {
    return {
      ok: false,
      code: "E_DEMO_FAILED",
      message: "Demo 生成失败，请重试或显式接受流程图降级",
      reasons: ["Demo 生成失败，尚未处置"],
      demo_mode: "none",
    };
  }

  let demoMode: SchemeConfirmationDecision["demo_mode"] = "none";
  let okMessage = "未生成 Demo，按静态方案签署";

  if (demo.status !== "none") {
    demoMode =
      demo.status === "degraded_flowcard" ? "degraded" : "interactive";
    if (demo.scheme_revision !== draft.scheme_revision) {
      return {
        ok: false,
        code: "E_DEMO_STALE",
        message: "方案已修改，Demo 与当前方案不再对应；请重新生成/确认",
        reasons: ["Demo 基于旧版方案"],
        demo_mode: demoMode,
      };
    }
    if (demo.decision_revision !== draft.scheme_revision) {
      return {
        ok: false,
        code: "E_DEMO_CONFIRMATION_REQUIRED",
        message:
          demo.status === "degraded_flowcard"
            ? "请先显式接受流程图降级"
            : "Demo 已生成，请先确认 Demo",
        reasons: ["Demo 未对当前方案确认"],
        demo_mode: demoMode,
      };
    }
    okMessage =
      demo.status === "degraded_flowcard"
        ? "已接受流程图降级，按标风险方案签署"
        : "Demo 已对当前方案确认";
  }

  const scopeDecision = evaluateScopeGate(draft, scopePlan, demoMode);
  if (scopeDecision) return scopeDecision;

  return {
    ok: true,
    code: "OK",
    message: okMessage,
    reasons: [],
    demo_mode: demoMode,
  };
}

/**
 * 向后兼容别名。**新代码禁止使用**——固定传 `scopePlan=null`，
 * 结果恒为不可确认（`E_SCOPE_NOT_READY`），用以暴露遗留调用点。
 * 请改用 `evaluateSchemeConfirmation(draft, demo, scopePlan)`。
 */
export function canConfirmScheme(draft: SchemeDraft): boolean {
  return evaluateSchemeConfirmation(draft, EMPTY_DEMO_GATE, null).ok;
}

export function isEffectiveBusinessInput(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (SMALLTALK_RE.test(t)) return false;
  return BUSINESS_ATTR_RE.test(t) || t.length >= 16;
}

function isPinned(draft: SchemeDraft, field: SchemePinnedField): boolean {
  return draft.pinned_fields.includes(field);
}

/**
 * 用整段对话语料刷新方案（不冻结时）。
 * 保留已确认决策、已抉择冲突、以及 user_pinned 字段。
 */
export function rebuildSchemeFromCorpus(
  previous: SchemeDraft | null,
  corpus: string,
  opts?: { titleHint?: string; incrementBusinessRound?: boolean },
): SchemeDraft {
  const text = corpus.trim();
  if (previous?.frozen === true) {
    return { ...previous, frozen: true };
  }

  const pinned = previous?.pinned_fields ?? [];
  const titleFromHint =
    opts?.titleHint?.trim() ||
    (text.length > 40 ? `${text.slice(0, 40)}…` : text) ||
    "未命名方案";
  const title =
    pinned.includes("title") && previous?.title
      ? previous.title
      : previous?.title && previous.title.length > titleFromHint.length
        ? previous.title
        : titleFromHint || previous?.title || "未命名方案";

  const modules =
    pinned.includes("modules") && previous
      ? previous.modules
      : extractModules(text);

  const baseDecisions = defaultDecisions(modules);
  const prevDec = new Map((previous?.decisions ?? []).map((d) => [d.id, d]));
  /**
   * 只在用户真正动过时沿用旧值：`user_pinned` 是可选项，
   * 直接用 `undefined` 赋值会违反 exactOptionalPropertyTypes，
   * 故用条件展开而不是显式写回 undefined。
   */
  const carry = (old: { user_pinned?: boolean }) =>
    old.user_pinned !== undefined ? { user_pinned: old.user_pinned } : {};
  const decisions = baseDecisions.map((d) => {
    const old = prevDec.get(d.id);
    if (!old) return d;
    const pinnedByUser = old.user_pinned === true || old.source === "user";
    return {
      ...d,
      confirmed: old.confirmed,
      source: old.source,
      recommended: pinnedByUser ? old.recommended : d.recommended,
      ...carry(old),
    };
  });

  const freshConflicts = detectConflicts(text, modules);
  const prevCf = new Map((previous?.conflicts ?? []).map((c) => [c.id, c]));
  const conflicts = freshConflicts.map((c) => {
    const old = prevCf.get(c.id);
    if (old?.user_pinned || old?.chosenId) {
      return { ...c, chosenId: old.chosenId, ...carry(old) };
    }
    return c;
  });

  const summary =
    pinned.includes("summary") && previous?.summary
      ? previous.summary
      : text.length > 280
        ? `${text.slice(0, 280)}…`
        : text;

  const mermaidArchitecture =
    pinned.includes("mermaidArchitecture") && previous
      ? previous.mermaidArchitecture
      : buildMermaidArchitecture(title, modules);
  const mermaidFlow =
    pinned.includes("mermaidFlow") && previous
      ? previous.mermaidFlow
      : buildMermaidFlow(modules);
  const mermaidMindmap =
    pinned.includes("mermaidMindmap") && previous
      ? previous.mermaidMindmap
      : buildMermaidMindmap(title, modules);

  const notes =
    pinned.includes("notes") && previous
      ? previous.notes
      : (previous?.notes ?? "");

  let business_input_rounds = previous?.business_input_rounds ?? 0;
  if (opts?.incrementBusinessRound === true) {
    business_input_rounds += 1;
  } else if (!previous && isEffectiveBusinessInput(text)) {
    business_input_rounds = 1;
  }

  const next = emptySchemeDraft({
    ...(previous?.scheme_id ? { scheme_id: previous.scheme_id } : {}),
    scheme_revision: previous ? previous.scheme_revision + 1 : 1,
    title,
    summary,
    modules,
    mermaidArchitecture,
    mermaidFlow,
    mermaidMindmap,
    decisions,
    conflicts,
    frozen: false,
    notes,
    updatedAt: new Date().toISOString(),
    pinned_fields: [...pinned],
    business_input_rounds,
  });
  const completeness = scoreCompleteness(next);
  const withScore = { ...next, completeness };
  return {
    ...withScore,
    demoReady: computeDemoReady(withScore),
  };
}

function withSchemeMutation(
  draft: SchemeDraft,
  patch: Partial<Omit<SchemeDraft, "scheme_id" | "scheme_revision">>,
): SchemeDraft {
  return {
    ...draft,
    ...patch,
    scheme_revision: draft.scheme_revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function pinSchemeField(
  draft: SchemeDraft,
  field: SchemePinnedField,
): SchemeDraft {
  if (draft.frozen) return draft;
  if (draft.pinned_fields.includes(field)) return draft;
  return withSchemeMutation(draft, {
    pinned_fields: [...draft.pinned_fields, field],
  });
}

export function confirmSchemeDecision(
  draft: SchemeDraft,
  decisionId: string,
  value?: string,
): SchemeDraft {
  if (draft.frozen) return draft;
  const decisions = draft.decisions.map((d) => {
    if (d.id !== decisionId) return d;
    return {
      ...d,
      confirmed: true,
      source: value && value !== d.recommended ? ("user" as const) : d.source,
      recommended: value ?? d.recommended,
      user_pinned: true,
    };
  });
  const next = withSchemeMutation(draft, { decisions });
  const completeness = scoreCompleteness(next);
  const withScore = { ...next, completeness };
  return { ...withScore, demoReady: computeDemoReady(withScore) };
}

export function resolveSchemeConflict(
  draft: SchemeDraft,
  conflictId: string,
  optionId: string,
): SchemeDraft {
  if (draft.frozen) return draft;
  const conflicts = draft.conflicts.map((c) =>
    c.id === conflictId ? { ...c, chosenId: optionId, user_pinned: true } : c,
  );
  const next = withSchemeMutation(draft, { conflicts });
  const completeness = scoreCompleteness(next);
  const withScore = { ...next, completeness };
  return { ...withScore, demoReady: computeDemoReady(withScore) };
}

export function updateSchemeNotes(
  draft: SchemeDraft,
  notes: string,
): SchemeDraft {
  if (draft.frozen) return draft;
  const pinned = draft.pinned_fields.includes("notes")
    ? draft.pinned_fields
    : ([...draft.pinned_fields, "notes"] as SchemePinnedField[]);
  const next = withSchemeMutation(draft, {
    notes,
    pinned_fields: pinned,
  });
  const completeness = scoreCompleteness(next);
  const withScore = { ...next, completeness };
  return { ...withScore, demoReady: computeDemoReady(withScore) };
}

/**
 * 冻结方案。必须幂等：对已冻结的方案再冻结一次，必须原样返回。
 *
 * 原因（与 §5.2.1 事务绑定）：快照 digest 含方案全文，若每次冻结都刷新
 * `updatedAt`，同一 `confirmation_id` 的重试会产生不同 digest，被
 * `writeSchemeSnapshot` 判成“覆盖另一版方案”而冲突——网络抖动下的重试
 * 就永远签不上。
 */
export function freezeScheme(draft: SchemeDraft): SchemeDraft {
  if (draft.frozen) return draft;
  return { ...draft, frozen: true, updatedAt: new Date().toISOString() };
}

/** 拼成提交给旅程/合同的白话意图 */
export function formatSchemeAsIntent(draft: SchemeDraft): string {
  const lines = [
    draft.title,
    draft.summary,
    draft.modules.length ? `模块：${draft.modules.join("、")}` : "",
    ...draft.decisions
      .filter((d) => d.confirmed || d.source === "ai_default")
      .map(
        (d) =>
          `${d.label}=${d.recommended}${d.confirmed ? "" : "（推荐待确认）"}`,
      ),
    ...draft.conflicts
      .filter((c) => c.chosenId)
      .map((c) => {
        const opt = c.options.find((o) => o.id === c.chosenId);
        return `抉择：${c.question} → ${opt?.label ?? c.chosenId}`;
      }),
    draft.notes.trim() ? `手改备注：${draft.notes.trim()}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
