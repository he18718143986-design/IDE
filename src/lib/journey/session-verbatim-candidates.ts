/**
 * TASK-L.17e：会话原话候选 —— 供试玩认可框「引用」按钮使用。
 *
 * - 只收 role=user 且 trim 非空的原文
 * - 去重保序（首次出现保留）
 * - 禁止把 assistant / system / tool 或 playtest-guidance 文案塞进候选
 * - 不自动填入输入框；本模块只产出候选列表
 */
import { buildPlaytestGuidance } from "./playtest-guidance";

/** 候选上限：截断时保留最早的 user 原话；测试写死此常量 */
export const SESSION_VERBATIM_CANDIDATE_LIMIT = 20;

/**
 * 引导文案稳定前缀（含参数化变体，如参考站 URL / 合同标签）。
 * 即便误标为 user，也不得进候选。
 */
export const PLAYTEST_GUIDANCE_DENY_PREFIXES = [
  "开始试玩：左栏是",
  "这一步只供人眼对照",
  "试玩后如果认可「一模一样」",
  "想改哪里就直接说：",
] as const;

export interface SessionMessageLike {
  role: string;
  text: string;
}

function guidanceExactDenySet(): Set<string> {
  const texts = buildPlaytestGuidance().map((m) => m.text.trim());
  return new Set(texts.filter((t) => t.length > 0));
}

function isPlaytestGuidanceText(text: string, exact: Set<string>): boolean {
  if (exact.has(text)) return true;
  return PLAYTEST_GUIDANCE_DENY_PREFIXES.some((p) => text.startsWith(p));
}

/**
 * 从会话消息中筛选可引用的用户原话候选。
 * 输入可为 foldChatEvents / useAgentSession 的 messages。
 */
export function selectSessionVerbatimCandidates(
  messages: readonly SessionMessageLike[],
  options?: {
    /** 额外排除的精确原文（默认已含 playtest-guidance 文案） */
    excludeTexts?: readonly string[];
    limit?: number;
  },
): string[] {
  const limit = options?.limit ?? SESSION_VERBATIM_CANDIDATE_LIMIT;
  const exactDenied = guidanceExactDenySet();
  for (const t of options?.excludeTexts ?? []) {
    const trimmed = t.trim();
    if (trimmed.length > 0) exactDenied.add(trimmed);
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const m of messages) {
    if (m.role !== "user") continue;
    // 原样保留（仅 trim 两端空白做空检与去重键）；写入候选的是 trim 后原文
    const text = typeof m.text === "string" ? m.text.trim() : "";
    if (text.length === 0) continue;
    if (isPlaytestGuidanceText(text, exactDenied)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }

  return out;
}
