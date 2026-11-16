import { assertContextHasNoVaultSecrets } from "../vault/active";
import type {
  SupervisorBacklinkSummary,
  SupervisorBuiltPrompt,
  SupervisorContextBundle,
  SupervisorMessage,
  SupervisorPromptPolicy,
  SupervisorPromptSection,
  SupervisorSchemeSummary,
  SupervisorSession,
  SupervisorTrustTier,
} from "./types";

/**
 * Supervisor Prompt 组装流水线（TASK-S.1）。
 *
 * 设计要点：
 * - 纯函数、零 I/O：只把「会话 + 授权上下文」编译成提示词，不读磁盘、不调模型；
 * - 权限边界写进系统段（Zero-Tool 声明），模型即使被诱导也无任何可调用工具；
 * - 预算感知：按 `max_input_tokens` 从新到旧裁剪对话窗口，被裁掉的消息 id
 *   显式登记在 `dropped_message_ids`，便于 UI 提示「上下文已截断」；
 * - 未决问题必须原样保留（G-11），本模块只提供承载位，由 S.2 的评估器填充。
 */

export const SUPERVISOR_SYSTEM_PROMPT = [
  "你是 Stagent 的 Supervisor（建议与审阅角色），不是执行者。",
  "",
  "硬性权限边界（不可协商）：",
  "1. 你没有任何工具：不能读写业务文件、不能执行命令、不能访问网络。",
  "2. 你不能批准合同、不能修改 Scope/预算/授权、不能设置 Evidence verdict、",
  "   不能触发合并、不能调用 Worker 工具。",
  "3. 你的全部输出都是「建议」，必须由用户通过合同编辑/批准流程显式采纳。",
  "4. 不确定时必须显式标注不确定项，不得用自然语言宣称测试通过或安全。",
  "",
  "输出要求：",
  "- 只输出 JSON，不要 Markdown 代码块围栏。",
  '- 结构：{ "suggestions": [...], "unresolved_questions": [...] }。',
  "- suggestions[].kind 取 suggestion | risk | acceptance | scope。",
  "- unresolved_questions 必须完整保留用户尚未回答的问题原文。",
].join("\n");

const DEFAULT_MAX_INPUT_TOKENS = 3000;
const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_MESSAGES = 40;

/** 粗略 token 估算：字符数 / chars_per_token（对中英文混排足够保守） */
export function estimateTokens(
  text: string,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  const ratio =
    Number.isFinite(charsPerToken) && charsPerToken > 0
      ? charsPerToken
      : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(text.length / ratio);
}

function bulletList(items: readonly string[], fallback = "- （无）"): string {
  if (items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join("\n");
}

function renderMessage(message: SupervisorMessage): string {
  return `[${message.role} · ${message.created_at}]\n${message.text}`;
}

function renderProjectSection(context: SupervisorContextBundle): string {
  const { project } = context;
  const lines: string[] = [
    `- 仓库根目录：${project.repo_root}`,
    `- 当前分支：${project.branch ?? "（未知）"}`,
    `- 工作区状态：${project.dirty === undefined ? "（未采集）" : project.dirty ? "存在未提交改动" : "干净"}`,
  ];
  if (project.recent_files && project.recent_files.length > 0) {
    lines.push(`- 最近变更文件：\n${bulletList(project.recent_files)}`);
  }
  const contract = project.contract;
  if (contract) {
    lines.push(
      `- 当前合同：${contract.contract_id}`,
      `  - 生命周期：${contract.lifecycle_state} / 审批：${contract.approval_status}（revision ${contract.contract_revision}）`,
      `  - 目标：${contract.objective ?? "（未填写）"}`,
      `  - 预算上限：${contract.cost_limits ? `${contract.cost_limits.max_cost_minor_units} ${contract.cost_limits.currency}（最小货币单位）` : "（未设置）"}`,
    );
    if (contract.scope_paths && contract.scope_paths.length > 0) {
      lines.push(`  - Scope 路径：\n${bulletList(contract.scope_paths)}`);
    }
  } else {
    lines.push("- 当前合同：（探索模式，无绑定合同）");
  }
  return lines.join("\n");
}

function renderArchitectureSection(context: SupervisorContextBundle): string {
  const { architecture } = context;
  const lines: string[] = [bulletList(architecture.constraints)];
  if (
    architecture.forbidden_dependencies &&
    architecture.forbidden_dependencies.length > 0
  ) {
    lines.push(
      "",
      "禁止的依赖方向：",
      bulletList(architecture.forbidden_dependencies),
    );
  }
  return lines.join("\n");
}

interface WindowResult {
  messages: SupervisorMessage[];
  dropped: string[];
  truncated: boolean;
}

/** 窗口裁剪策略（已完成默认值填充，字段均为具体数值） */
interface WindowPolicy {
  chars_per_token: number;
  max_messages: number;
}

/**
 * 从新到旧填充对话窗口，直到预算或条数上限耗尽。
 * 单条消息超预算时按字符截断（仅当窗口为空，保证至少有一条上下文）。
 */
function selectWindow(
  messages: readonly SupervisorMessage[],
  tokenBudget: number,
  policy: WindowPolicy,
): WindowResult {
  const sorted = [...messages].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const candidates = sorted.slice(-policy.max_messages);
  const droppedFromCap = sorted.slice(
    0,
    Math.max(0, sorted.length - candidates.length),
  );

  const included: SupervisorMessage[] = [];
  const dropped: string[] = droppedFromCap.map((m) => m.message_id);
  let used = 0;
  let truncatedText = false;

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const message = candidates[i] as SupervisorMessage;
    const rendered = renderMessage(message);
    const cost = estimateTokens(rendered, policy.chars_per_token);
    if (used + cost <= tokenBudget) {
      included.unshift(message);
      used += cost;
      continue;
    }
    // 窗口为空且单条超预算：按剩余预算截断原文，保留事实来源
    if (included.length === 0 && tokenBudget > 0) {
      const maxChars = Math.max(0, tokenBudget * policy.chars_per_token);
      const clipped =
        message.text.length > maxChars
          ? `${message.text.slice(0, maxChars)}\n…[truncated]`
          : message.text;
      if (clipped !== message.text) truncatedText = true;
      included.unshift({ ...message, text: clipped });
      used += estimateTokens(
        renderMessage({ ...message, text: clipped }),
        policy.chars_per_token,
      );
      // 本条已纳入（截断后），只丢弃更早的消息
      for (let j = i - 1; j >= 0; j -= 1) {
        dropped.push((candidates[j] as SupervisorMessage).message_id);
      }
      break;
    }
    // 本条放不下且无法截断：本条及其之前的消息全部丢弃
    for (let j = i; j >= 0; j -= 1) {
      dropped.push((candidates[j] as SupervisorMessage).message_id);
    }
    break;
  }

  return {
    messages: included,
    dropped,
    truncated: dropped.length > 0 || truncatedText,
  };
}

function renderConversation(
  window: WindowResult,
  totalMessages: number,
): string {
  if (window.messages.length === 0) return "（无对话历史）";
  const header =
    window.dropped.length > 0
      ? `（共 ${totalMessages} 条，已按预算省略 ${window.dropped.length} 条较早消息）\n\n`
      : "";
  return `${header}${window.messages.map(renderMessage).join("\n\n")}`;
}

function renderOutputSection(): string {
  return [
    "请输出单个 JSON 对象，字段如下：",
    '{ "suggestions": [ { "kind": "suggestion|risk|acceptance|scope", ',
    '"summary": "一句话结论", "rationale": "依据", "confidence": 0.0 } ],',
    '"unresolved_questions": [ "用户尚未回答的问题原文" ] }',
    "",
    "约束：suggestions 只表达建议，不得包含任何状态变更指令或工具调用请求。",
  ].join("\n");
}

const TRUST_TIER_LABEL: Record<SupervisorTrustTier, string> = {
  light: "轻确认",
  standard: "标准",
  reconfirm: "重确认",
};

/** 有字段才渲染；全部缺省则返回 null（不插入该段、不伪造）。 */
function renderSchemeSummarySection(
  summary: SupervisorSchemeSummary | undefined,
): string | null {
  if (!summary) return null;
  const lines: string[] = [];
  if (summary.title !== undefined && summary.title !== "") {
    lines.push(`- 标题：${summary.title}`);
  }
  if (summary.summary !== undefined && summary.summary !== "") {
    lines.push(`- 摘要：${summary.summary}`);
  }
  if (summary.scheme_revision !== undefined) {
    lines.push(`- 方案修订号：${summary.scheme_revision}`);
  }
  if (lines.length === 0) return null;
  return lines.join("\n");
}

function renderTrustTierSection(
  trustTier: SupervisorTrustTier | undefined,
): string | null {
  if (trustTier === undefined) return null;
  return `- 信任档：${TRUST_TIER_LABEL[trustTier]}（${trustTier}）`;
}

/**
 * 只消费调用方注入的 J.32a 摘要。
 * 缺登记 / 哈希不一致 / ai_inferred 一律标「未覆盖」并写 reason，不得写成已覆盖。
 */
function renderBacklinkSummarySection(
  summary: SupervisorBacklinkSummary | undefined,
): string | null {
  if (!summary) return null;
  const lines: string[] = [];
  if (summary.evaluation_ok === false) {
    lines.push(
      `- 回链核对失败：${summary.failure_reason ?? "unknown"}（不得将任何项标为已覆盖）`,
    );
  }
  if (summary.items && summary.items.length > 0) {
    for (const item of summary.items) {
      if (item.covered === true && summary.evaluation_ok !== false) {
        const turn =
          item.turn_id !== undefined ? `（turn ${item.turn_id}）` : "";
        lines.push(`- ${item.id}：已覆盖${turn}`);
      } else if (item.covered === true) {
        // 整体核对失败时即使传入 covered 也不宣称已覆盖
        lines.push(`- ${item.id}：未覆盖（evaluation_failed）`);
      } else {
        lines.push(`- ${item.id}：未覆盖（${item.reason}）`);
      }
    }
  }
  if (lines.length === 0) return null;
  return lines.join("\n");
}

/**
 * 组装 Supervisor 提示词。
 * 返回的分段结构同时供 UI 展示「模型看到了什么」（§2.2 上下文采集需可见）。
 */
export function buildSupervisorPrompt(input: {
  session: SupervisorSession;
  context: SupervisorContextBundle;
  policy?: SupervisorPromptPolicy | undefined;
}): SupervisorBuiltPrompt {
  const { session, context } = input;
  const policy = input.policy ?? {};
  const maxInputTokens = policy.max_input_tokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const charsPerToken = policy.chars_per_token ?? DEFAULT_CHARS_PER_TOKEN;
  const maxMessages = policy.max_messages ?? DEFAULT_MAX_MESSAGES;

  const baseSections: SupervisorPromptSection[] = [
    { title: "角色与权限边界", body: SUPERVISOR_SYSTEM_PROMPT },
    { title: "项目现状", body: renderProjectSection(context) },
    { title: "架构约束", body: renderArchitectureSection(context) },
  ];

  if (context.event_digests && context.event_digests.length > 0) {
    baseSections.push({
      title: "最近事件摘要",
      body: bulletList(context.event_digests),
    });
  }

  const baseText = baseSections
    .map((section) => `## ${section.title}\n${section.body}`)
    .join("\n\n");
  const baseTokens = estimateTokens(baseText, charsPerToken);
  const remaining = Math.max(0, maxInputTokens - baseTokens);

  const window = selectWindow(session.messages, remaining, {
    chars_per_token: charsPerToken,
    max_messages: maxMessages,
  });

  // 台账 / 信任档 / 回链：有字段才插入；不改 selectWindow 与预算算法。
  const alignmentSections: SupervisorPromptSection[] = [];
  const schemeBody = renderSchemeSummarySection(context.scheme_summary);
  if (schemeBody !== null) {
    alignmentSections.push({ title: "台账方案摘要", body: schemeBody });
  }
  const trustBody = renderTrustTierSection(context.trust_tier);
  if (trustBody !== null) {
    alignmentSections.push({ title: "信任档", body: trustBody });
  }
  const backlinkBody = renderBacklinkSummarySection(context.backlink_summary);
  if (backlinkBody !== null) {
    alignmentSections.push({ title: "回链核对摘要", body: backlinkBody });
  }

  const sections: SupervisorPromptSection[] = [
    ...baseSections,
    ...alignmentSections,
    {
      title: "对话上下文",
      body: renderConversation(window, session.messages.length),
    },
    { title: "输出格式", body: renderOutputSection() },
  ];

  const text = sections
    .map((section) => `## ${section.title}\n${section.body}`)
    .join("\n\n");

  // 命中即抛；不得脱敏后继续返回（与 vault/active.ts 口径一致）。
  assertContextHasNoVaultSecrets(text);

  return {
    text,
    sections,
    estimated_input_tokens: estimateTokens(text, charsPerToken),
    truncated: window.truncated,
    dropped_message_ids: window.dropped,
  };
}
