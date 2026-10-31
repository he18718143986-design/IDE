/**
 * 意图编译器输入渲染（TASK-J.10）。
 *
 * 实施口径：intent-compiler-prompt.md §6.3 / §3.2 / §4.2。
 * - 用户正文 N1～N3 预规范化，保留换行（不做 N4）
 * - AI 回复无别名；别名→turn_id 只进 AliasMap
 * - 墓碑只注入 proposal / reason / lock，不含 revival_keys
 * - 同一状态两次渲染（同 nonce）逐字节相同
 */
import type { AliasMap } from "../../../src/lib/journey/compiler-output-schema";
import type {
  GraveyardEntry,
  LedgerState,
  SchemeDraftV2,
  Suggestion,
  TranscriptTurn,
} from "../../../src/lib/journey/scheme-patch-types";

const FORMAT_CHARS = /\u200B|\u200C|\u200D|\u2060|\uFEFF|\u00AD/g;
const SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });

/**
 * N1 换行统一 → N2 删零宽 → N3 按字素 NFKC；保留换行与普通空白（不做 N4）。
 */
export function normalizeForCompilerPrompt(raw: string): string {
  let out = "";
  for (const { segment } of SEGMENTER.segment(raw)) {
    const base = segment === "\r\n" || segment === "\r" ? "\n" : segment;
    const kept = base.replace(FORMAT_CHARS, "");
    if (kept.length === 0) continue;
    out += kept.normalize("NFKC");
  }
  return out;
}

export interface ProjectProfileView {
  /** 顶层/二级目录名 */
  directories?: readonly string[];
  /** 主要路由/页面名 */
  routes?: readonly string[];
  package_name?: string | null;
  script_keys?: readonly string[];
  tech_stack?: readonly string[];
  greenfield?: boolean;
  /** 保护清单白话类别（不含具体值） */
  protection_categories?: readonly string[];
}

export interface CompilerTranscriptMessage {
  turn_id: string;
  role: "user" | "assistant" | "system";
  text: string;
  /** 用户消息的全局别名序号（U<n>）；缺省时按出现顺序分配 */
  user_alias_seq?: number;
}

export interface RenderCompilerInputArgs {
  state: LedgerState;
  /** 全量或窗口候选；渲染时再裁剪 */
  transcript: readonly CompilerTranscriptMessage[];
  /** 本批用户 turn_id（按提交顺序） */
  batchTurnIds: readonly string[];
  profile?: ProjectProfileView | null;
  historySummary?: string | null;
  /** 8 位十六进制 nonce，同时出现在边界标签 */
  nonce: string;
}

export interface RenderCompilerInputResult {
  prompt: string;
  aliasMap: AliasMap;
  /** 窗口内全部 U 别名 */
  ua: string[];
  /** 本批 U 别名 */
  ub: string[];
  /** 现有条目 id */
  ids: string[];
  /** 注入的墓碑 id */
  rej: string[];
}

function escapeXmlText(s: string): string {
  // 规格：用户正文不做转义（伪造标签靠 nonce）。结构化字段做最小转义以免破坏 XML 形态。
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function itemSourceAttr(
  source: string,
): "user_said" | "ai_inferred" | "user_edited" | "user_confirmed" {
  if (
    source === "user_said" ||
    source === "ai_inferred" ||
    source === "user_edited" ||
    source === "user_confirmed"
  ) {
    return source;
  }
  return "ai_inferred";
}

function collectIds(draft: SchemeDraftV2): string[] {
  const ids: string[] = [];
  const push = (arr: { id: string }[]) => {
    for (const it of arr) ids.push(it.id);
  };
  push(draft.goals);
  push(draft.out_of_scope);
  push(draft.modules);
  push(draft.flows);
  push(draft.entities);
  push(draft.decisions);
  push(draft.conflicts);
  push(draft.open_questions);
  push(draft.acceptance);
  return [...new Set(ids)].sort();
}

function renderSchemeState(draft: SchemeDraftV2): string {
  const lines: string[] = [
    `<scheme_state revision="${draft.scheme_revision}">`,
  ];
  for (const m of draft.modules) {
    const pinned = m.user_pinned ? "yes" : "no";
    const src = itemSourceAttr(m.source);
    lines.push(
      `  <item id="${escapeXmlText(m.id)}" kind="module" source="${src}" pinned="${pinned}">${escapeXmlText(m.name)} · ${escapeXmlText(m.purpose)}</item>`,
    );
  }
  for (const d of draft.decisions) {
    const pinned = d.user_pinned ? "yes" : "no";
    const src = itemSourceAttr(d.source);
    const risk = d.risk === "high" ? "high" : "low";
    lines.push(
      `  <item id="${escapeXmlText(d.id)}" kind="decision" source="${src}" status="${d.status}" risk="${risk}" pinned="${pinned}">${escapeXmlText(d.question)} · 推荐：${escapeXmlText(d.recommended)}</item>`,
    );
  }
  for (const f of draft.flows) {
    const pinned = f.user_pinned ? "yes" : "no";
    const src = itemSourceAttr(f.source);
    lines.push(
      `  <item id="${escapeXmlText(f.id)}" kind="flow" source="${src}" pinned="${pinned}">${escapeXmlText(f.name)}</item>`,
    );
  }
  for (const c of draft.conflicts) {
    const pinned = c.user_pinned ? "yes" : "no";
    const src = itemSourceAttr(c.source);
    const chosen = c.chosen_id ?? "none";
    lines.push(
      `  <item id="${escapeXmlText(c.id)}" kind="conflict" source="${src}" chosen="${escapeXmlText(chosen)}" pinned="${pinned}">${escapeXmlText(c.question)}</item>`,
    );
  }
  for (const g of draft.goals) {
    lines.push(
      `  <item id="${escapeXmlText(g.id)}" kind="goal" source="${itemSourceAttr(g.source)}" pinned="${g.user_pinned ? "yes" : "no"}">${escapeXmlText(g.text)}</item>`,
    );
  }
  for (const a of draft.acceptance) {
    lines.push(
      `  <item id="${escapeXmlText(a.id)}" kind="acceptance" source="${itemSourceAttr(a.source)}" pinned="${a.user_pinned ? "yes" : "no"}">${escapeXmlText(a.text)}</item>`,
    );
  }
  lines.push(`</scheme_state>`);
  return lines.join("\n");
}

function suggestionKindToCard(kind: Suggestion["kind"]): string {
  if (kind === "S_OVERRIDE_PINNED" || kind === "S_OVERRIDE_PROTECTED") {
    return "override";
  }
  if (kind === "S_REVIVAL_AMBIGUOUS") return "revive";
  return "soft";
}

function renderPendingCards(suggestions: readonly Suggestion[]): string {
  const pending = suggestions
    .filter((s) => s.status === "pending")
    .slice()
    .sort((a, b) => a.suggestion_id.localeCompare(b.suggestion_id));
  const lines = ["<pending_cards>"];
  for (const s of pending) {
    const target = s.target?.id ?? s.suggestion_id;
    const kind = suggestionKindToCard(s.kind);
    const summary =
      "op" in s && s.op && typeof s.op === "object"
        ? summarizeOp(s.op)
        : s.suggestion_id;
    lines.push(
      `  <card target="${escapeXmlText(target)}" kind="${kind}">${escapeXmlText(summary)}</card>`,
    );
  }
  lines.push("</pending_cards>");
  return lines.join("\n");
}

function summarizeOp(op: Suggestion["op"]): string {
  const o = op as { op: string; id?: string; item?: { name?: string; question?: string; text?: string }; value?: string; text?: string };
  if (o.item?.name) return String(o.item.name);
  if (o.item?.question) return String(o.item.question);
  if (o.item?.text) return String(o.item.text);
  if (o.value) return String(o.value);
  if (o.text) return String(o.text);
  if (o.id) return `${o.op} ${o.id}`;
  return o.op;
}

function tombstoneLock(entry: GraveyardEntry): "security" | "soft" | "user" {
  if (entry.rejected_by === "security_gate" || entry.disallow_revival) {
    return "security";
  }
  return "user";
}

function selectGraveyard(
  graveyard: readonly GraveyardEntry[],
  batchTexts: readonly string[],
): GraveyardEntry[] {
  const active = graveyard
    .filter((g) => g.status === "active")
    .slice()
    .sort((a, b) => a.rejected_id.localeCompare(b.rejected_id));
  if (active.length <= 20) return active;

  const batchLex = new Set<string>();
  for (const t of batchTexts) {
    for (const lex of t.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
      batchLex.add(lex);
    }
  }
  const intersected = active.filter((g) =>
    g.fingerprint.lexemes.some((lex) => batchLex.has(lex.toLowerCase())),
  );
  const recent = active.slice(-10);
  const byId = new Map<string, GraveyardEntry>();
  for (const g of [...intersected, ...recent]) byId.set(g.rejected_id, g);
  return [...byId.values()].sort((a, b) =>
    a.rejected_id.localeCompare(b.rejected_id),
  );
}

function renderGraveyard(entries: readonly GraveyardEntry[]): string {
  const lines = ["<graveyard>"];
  for (const g of entries) {
    const lock = tombstoneLock(g);
    lines.push(`  <tombstone id="${escapeXmlText(g.rejected_id)}" lock="${lock}">`);
    lines.push(`    <proposal>${escapeXmlText(g.proposal)}</proposal>`);
    lines.push(`    <reason>${escapeXmlText(g.rejection_reason)}</reason>`);
    lines.push(`  </tombstone>`);
  }
  lines.push("</graveyard>");
  const joined = lines.join("\n");
  // 验收：不得含 revival_keys
  if (joined.includes("revival_keys")) {
    throw new Error("graveyard render leaked revival_keys");
  }
  return joined;
}

function renderProjectProfile(profile: ProjectProfileView | null | undefined): string {
  const p = profile ?? {};
  const lines = ["<project_profile>"];
  if (p.package_name) {
    lines.push(`  <package_name>${escapeXmlText(p.package_name)}</package_name>`);
  }
  if (p.greenfield !== undefined) {
    lines.push(`  <greenfield>${p.greenfield ? "yes" : "no"}</greenfield>`);
  }
  if (p.directories && p.directories.length > 0) {
    lines.push(
      `  <directories>${escapeXmlText(p.directories.join(", "))}</directories>`,
    );
  }
  if (p.routes && p.routes.length > 0) {
    lines.push(`  <routes>${escapeXmlText(p.routes.join(", "))}</routes>`);
  }
  if (p.script_keys && p.script_keys.length > 0) {
    lines.push(
      `  <scripts>${escapeXmlText(p.script_keys.join(", "))}</scripts>`,
    );
  }
  if (p.tech_stack && p.tech_stack.length > 0) {
    lines.push(
      `  <tech_stack>${escapeXmlText(p.tech_stack.join(", "))}</tech_stack>`,
    );
  }
  if (p.protection_categories && p.protection_categories.length > 0) {
    lines.push(
      `  <protection>${escapeXmlText(p.protection_categories.join("、"))}</protection>`,
    );
  }
  lines.push("</project_profile>");
  return lines.join("\n");
}

function evidenceTurnIds(state: LedgerState): Set<string> {
  const ids = new Set<string>();
  const draft = state.draft;
  const bags = [
    draft.goals,
    draft.out_of_scope,
    draft.modules,
    draft.flows,
    draft.entities,
    draft.decisions,
    draft.conflicts,
    draft.open_questions,
    draft.acceptance,
  ];
  for (const bag of bags) {
    for (const item of bag) {
      for (const ev of item.evidence ?? []) {
        if (ev.kind === "turn") ids.add(ev.ref.turn_id);
      }
    }
  }
  return ids;
}

/**
 * 窗口：本批 U（完整）+ 方案条目证据引用到的 U + 最近 6 条（含 AI）。
 * 枚举只含窗口内的 U 别名。
 */
function selectWindow(
  transcript: readonly CompilerTranscriptMessage[],
  batchTurnIds: readonly string[],
  state: LedgerState,
): CompilerTranscriptMessage[] {
  const byId = new Map(transcript.map((t) => [t.turn_id, t]));
  const selected = new Map<string, CompilerTranscriptMessage>();
  const batchSet = new Set(batchTurnIds);
  for (const id of batchTurnIds) {
    const t = byId.get(id);
    if (t) selected.set(id, t);
  }
  for (const id of evidenceTurnIds(state)) {
    const t = byId.get(id);
    if (t && t.role === "user") selected.set(id, t);
  }
  const recent = transcript.slice(-6);
  for (const t of recent) selected.set(t.turn_id, t);

  // 保持原序
  return transcript.filter((t) => selected.has(t.turn_id));
}

function assignAliases(
  fullTranscript: readonly CompilerTranscriptMessage[],
): Map<string, string> {
  // U<seq>：按全量用户消息出现顺序；若消息自带 user_alias_seq 则尊崇之
  const map = new Map<string, string>();
  let auto = 0;
  for (const t of fullTranscript) {
    if (t.role !== "user") continue;
    let seq: number;
    if (typeof t.user_alias_seq === "number") {
      seq = t.user_alias_seq;
      auto = Math.max(auto, seq);
    } else {
      auto += 1;
      seq = auto;
    }
    map.set(t.turn_id, `U${seq}`);
  }
  return map;
}

/**
 * 渲染编译器用户侧输入（不含 system prompt）。
 */
export function renderCompilerInput(
  args: RenderCompilerInputArgs,
): RenderCompilerInputResult {
  const { state, transcript, batchTurnIds, profile, historySummary, nonce } =
    args;
  if (!/^[0-9a-f]{8}$/i.test(nonce)) {
    throw new Error(`nonce must be 8 hex chars, got ${nonce}`);
  }

  const aliasByTurn = assignAliases(transcript);
  const window = selectWindow(transcript, batchTurnIds, state);

  const aliasMap = new Map<string, string>();
  const ua: string[] = [];
  const ub: string[] = [];
  const batchSet = new Set(batchTurnIds);

  const turnLines: string[] = [];
  for (const t of window) {
    if (t.role === "user") {
      const alias = aliasByTurn.get(t.turn_id);
      if (!alias) continue;
      aliasMap.set(alias, t.turn_id);
      if (!ua.includes(alias)) ua.push(alias);
      const inBatch = batchSet.has(t.turn_id);
      if (inBatch && !ub.includes(alias)) ub.push(alias);
      const norm = normalizeForCompilerPrompt(t.text);
      // 用户正文不做 XML 转义（规格）；换行保留
      const batchAttr = inBatch ? ' batch="yes"' : "";
      turnLines.push(
        `  <turn alias="${alias}" role="user" quotable="yes"${batchAttr}>${norm}</turn>`,
      );
    } else if (t.role === "assistant") {
      const norm = normalizeForCompilerPrompt(t.text);
      turnLines.push(
        `  <turn role="assistant" quotable="no">${norm}</turn>`,
      );
    }
  }

  const batchAliases = batchTurnIds
    .map((id) => aliasByTurn.get(id))
    .filter((a): a is string => typeof a === "string");

  const batchTexts = batchTurnIds
    .map((id) => transcript.find((t) => t.turn_id === id)?.text ?? "")
    .filter(Boolean);
  const graveyard = selectGraveyard(state.graveyard, batchTexts);
  const rej = graveyard.map((g) => g.rejected_id);

  const ids = collectIds(state.draft);

  const summaryBlock = `<history_summary note="AI 写的摘要，不是原话，不可摘录">${escapeXmlText(historySummary ?? "")}</history_summary>`;

  const prompt = [
    renderSchemeState(state.draft),
    renderPendingCards(state.suggestions),
    renderGraveyard(graveyard),
    renderProjectProfile(profile),
    summaryBlock,
    `<transcript_${nonce}>`,
    ...turnLines,
    `</transcript_${nonce}>`,
    `<batch>${batchAliases.join(" ")}</batch>`,
  ].join("\n");

  return {
    prompt,
    aliasMap,
    ua: ua.slice().sort(compareAlias),
    ub: ub.slice().sort(compareAlias),
    ids,
    rej: rej.slice().sort(),
  };
}

function compareAlias(a: string, b: string): number {
  const na = Number(a.replace(/^U/, ""));
  const nb = Number(b.replace(/^U/, ""));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** 从引擎 TranscriptTurn 适配 */
export function turnsFromEngine(
  turns: readonly TranscriptTurn[],
): CompilerTranscriptMessage[] {
  return turns.map((t) => ({
    turn_id: t.turn_id,
    role: t.role,
    text: t.text,
  }));
}
