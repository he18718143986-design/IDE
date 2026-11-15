import { randomUUID } from "node:crypto";
import {
  createContractDraft,
  softwareContractSchema,
  type BudgetLimits,
  type SoftwareContractV12,
} from "../../src/lib/contract.schema";
import type { CostRecord } from "../guard/cost-monitor";
import type { SupervisorBudgetLedger } from "./budget";
import { formatDirtyExclusionsPlain } from "../baseline/scope-defaults";
import { buildL0Plan, type L0DraftInput, type L0DraftPlan } from "./rules-l0";
import type { SupervisorMessage } from "./types";
import { assertContextHasNoVaultSecrets } from "../vault/active";

/**
 * 按需合同草案生成器（TASK-S.2 精简版 / v1.3.3）。
 *
 * 两层结构：
 * - **L0 规则（`rules-l0.ts`）**：确定性装配可写/只读/禁区路径、默认验证命令与
 *   默认预算，并匹配保护清单。零模型调用、零费用。
 * - **L1 强模型（可选）**：仅在调用方显式传入 `enrich` 时才调用，补白话理由
 *   （`rationale`）与未决问题（`unresolved_questions`）；用量经
 *   `SupervisorBudgetLedger` 记入**独立账本**，不碰 Worker 的合同账本。
 *
 * v1.3.3 明令禁止项（本文件刻意不实现）：
 * - 不做成熟度评分（无 `score`、无 4 维评估器）；
 * - 不产生 HUD 徽章、风险气泡；
 * - 不用分数做任何授权分支（§9.1 / ADR-007）。
 *
 * 触发纪律：`IDLE_TIMER` / `DEBOUNCE_TIMER` 直接返回「未生成」，
 * **一次模型调用都不会发生**——这是 VIBE 下"30 分钟聊天零调用"的结构保证。
 */

/** 触发来源：只有前两种属于"按需"，后两种在本模块被硬拒绝 */
export type DraftTriggerKind =
  "USER_REQUEST" | "CONTROL_PLANE_EVENT" | "IDLE_TIMER" | "DEBOUNCE_TIMER";

const ON_DEMAND_TRIGGERS: readonly DraftTriggerKind[] = [
  "USER_REQUEST",
  "CONTROL_PLANE_EVENT",
];

/** L1 强模型需要回填的内容；用量字段用于费用分账 */
export interface DraftEnrichment {
  rationale: string[];
  unresolved_questions: string[];
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number | undefined;
}

export interface ContractDraftGeneratorInput extends L0DraftInput {
  /** 必填：说明本次生成为什么是被"按需"触发的 */
  trigger: DraftTriggerKind;
  /** 控制面事件名（`GATEWAY_VIOLATION` / `BUDGET_ALERT` / `TEST_FAILURE` …），仅作审计 */
  event?: string | undefined;
  sessionId?: string | undefined;
  suggestionId?: string | undefined;
  /** 注入时钟，便于测试断言 `assessed_at` */
  now?: (() => Date) | undefined;
  /** L1 补全（可选）；不传即纯 L0，零模型调用 */
  enrich?:
    | ((prompt: string) => Promise<DraftEnrichment> | DraftEnrichment)
    | undefined;
  /** 费用分账：传了 `enrich` 就必须传（否则拒绝生成，避免"免费调用"） */
  budgetLedger?: SupervisorBudgetLedger | undefined;
}

export interface ContractDraftSkipped {
  generated: false;
  reason: "NOT_REQUESTED";
  trigger: DraftTriggerKind;
  model_calls: 0;
}

export interface ContractDraftGenerated {
  generated: true;
  contract: SoftwareContractV12;
  plan: L0DraftPlan;
  rationale: string[];
  /** 与草案元数据中保存的未决问题完全一致（G-11） */
  unresolved_questions: string[];
  model_calls: number;
  usage?: CostRecord | undefined;
}

export type ContractDraftOutcome =
  ContractDraftGenerated | ContractDraftSkipped;

export class ContractDraftError extends Error {
  readonly reason:
    | "MISSING_BUDGET_LEDGER"
    | "NO_VERIFICATION_COMMAND"
    | "ILLEGAL_SUBMIT_STATE";

  constructor(
    reason:
      | "MISSING_BUDGET_LEDGER"
      | "NO_VERIFICATION_COMMAND"
      | "ILLEGAL_SUBMIT_STATE",
    message: string,
  ) {
    super(message);
    this.name = "ContractDraftError";
    this.reason = reason;
  }
}

/** L0 的白话理由：解释"凭什么这么圈范围、凭什么用这些命令" */
function l0Rationale(plan: L0DraftPlan): string[] {
  const lines = [
    `可写范围按会话中提到/推断出的路径圈定为：${plan.writable_paths.join("、")}。`,
    `只读范围默认为：${plan.readonly_paths.join("、") || "（无）"}。`,
    `验证命令采用 ${plan.commands
      .map((command) => `\`${command.executable} ${command.args.join(" ")}\``)
      .join("、")}。`,
    `安全预算默认 ${plan.budget.max_file_modifications} 个文件 / ` +
      `${plan.budget.max_total_diff_lines} 行变更 / ` +
      `${plan.budget.max_command_executions ?? "不限"} 次命令。`,
  ];
  if (plan.protected_files.length > 0) {
    lines.push(
      `注意：可写范围命中受保护内容（${plan.protected_entry_names.join("、")}），` +
        `需要你确认一次。`,
    );
  }
  // TASK-C.14d：白话显式列出脏区「绝不触碰」
  const dirtyPlain = formatDirtyExclusionsPlain(plan.dirty_exclusions ?? []);
  if (dirtyPlain) {
    lines.push(dirtyPlain);
  }
  return lines;
}

/** 交给 L1 的提示词：只给结构化事实，不做任何诱导性打分 */
export function buildEnrichmentPrompt(
  plan: L0DraftPlan,
  messages: readonly SupervisorMessage[],
): string {
  const conversation = messages
    .filter((message) => message.role === "user")
    .map((message) => `- ${message.text}`)
    .join("\n");
  return [
    "你在为一次编码任务起草「软件合同」草案。请只输出两段纯文本：",
    "1) 为什么这样圈定范围（3 条以内，中文白话）；",
    "2) 还有哪些必须先问清楚的问题（没有就给空）。",
    "不要评分、不要给成熟度、不要给建议优先级。",
    "",
    `【用户原话】\n${conversation || "（空）"}`,
    "",
    `【L0 已确定的可写范围】${plan.writable_paths.join("、")}`,
    `【只读范围】${plan.readonly_paths.join("、") || "（无）"}`,
    `【验证命令】${plan.commands
      .map((command) => `${command.executable} ${command.args.join(" ")}`)
      .join("；")}`,
    plan.protected_files.length > 0
      ? `【命中的受保护内容】${plan.protected_entry_names.join("、")}：${plan.protected_files.join("、")}`
      : "【命中的受保护内容】（无）",
  ].join("\n");
}

/**
 * 生成草案。`enrich` 存在时才会调用模型；否则纯 L0，`model_calls === 0`。
 */
export async function generateContractDraft(
  input: ContractDraftGeneratorInput,
): Promise<ContractDraftOutcome> {
  if (!ON_DEMAND_TRIGGERS.includes(input.trigger)) {
    // 定时/防抖触发一律不生成：这是"零轮询"的结构性保证，而非配置项
    return {
      generated: false,
      reason: "NOT_REQUESTED",
      trigger: input.trigger,
      model_calls: 0,
    };
  }

  const plan = buildL0Plan(input);
  if (plan.commands.length === 0) {
    throw new ContractDraftError(
      "NO_VERIFICATION_COMMAND",
      "contract draft requires at least one verification command",
    );
  }

  const rationale = l0Rationale(plan);
  // G-11：L0 与 L1 的未决问题按序拼接、**不做去重**——去重会静默吞掉条目，
  // 而规范要求"逐项保留无遗漏"。重复项由前端展示时合并，数据层不丢。
  const unresolved = [...plan.unresolved_questions];
  let modelCalls = 0;
  let usage: CostRecord | undefined;
  let modelId: string | undefined;

  if (input.enrich !== undefined) {
    if (input.budgetLedger === undefined) {
      throw new ContractDraftError(
        "MISSING_BUDGET_LEDGER",
        "L1 enrichment requires a Supervisor budget ledger (费用必须分账记账)",
      );
    }
    const prompt = buildEnrichmentPrompt(plan, input.messages);
    assertContextHasNoVaultSecrets(prompt);
    const outcome = await input.budgetLedger.runModelCall({
      call: async () => {
        const enrichment = await input.enrich!(prompt);
        return {
          result: enrichment,
          input_tokens: enrichment.input_tokens,
          output_tokens: enrichment.output_tokens,
          ...(enrichment.cost_usd === undefined
            ? {}
            : { cost_usd: enrichment.cost_usd }),
        };
      },
    });
    modelCalls = 1;
    usage = outcome.usage;
    modelId = outcome.result.model_id;
    rationale.push(
      ...outcome.result.rationale.filter((line) => line.length > 0),
    );
    unresolved.push(...outcome.result.unresolved_questions);
  }

  const now = input.now?.() ?? new Date();
  const assessedAt = now.toISOString();
  const suggestionId = input.suggestionId ?? `sug_${randomUUID()}`;

  const draft = createContractDraft({
    title: plan.title,
    description: plan.description,
    acceptanceCriteria: plan.acceptance_criteria,
    writablePaths: plan.writable_paths,
    readonlyPaths: plan.readonly_paths,
    strictlyForbiddenPaths: plan.strictly_forbidden_paths,
    commands: plan.commands,
    supervisorMetadata: {
      suggestion_id: suggestionId,
      // v1.3.3：不写 score，只保留白话理由与未决问题（G-11）
      maturity_assessment: {
        rationale,
        unresolved_questions: unresolved,
        ...(modelId === undefined ? {} : { model_id: modelId }),
        assessed_at: assessedAt,
      },
      suggested_scope: {
        writable_paths: plan.writable_paths,
        readonly_paths: plan.readonly_paths,
        strictly_forbidden_paths: plan.strictly_forbidden_paths,
      },
    },
    ...(input.sessionId === undefined
      ? {}
      : {
          conversationRef: {
            session_id: input.sessionId,
            message_ids: input.messages.map((message) => message.message_id),
            context_policy: "USER_SELECTED" as const,
          },
        }),
  });

  // 预算（含可选计数值上限）在草案创建后覆盖，确保可选字段也落入 Schema
  const withBudget: SoftwareContractV12 = {
    ...draft,
    authorization: {
      ...draft.authorization,
      budget_limits: {
        ...draft.authorization.budget_limits,
        ...(plan.budget as BudgetLimits),
      },
    },
    // 初始态：DRAFT / DRAFT（§9.1.1 合法组合，用户可继续编辑）
    lifecycle_state: "DRAFT",
    approval: { status: "DRAFT" },
  };

  const contract = softwareContractSchema.parse(withBudget);

  return {
    generated: true,
    contract,
    plan,
    rationale,
    unresolved_questions: unresolved,
    model_calls: modelCalls,
    ...(usage === undefined ? {} : { usage }),
  };
}

/**
 * 用户显式提交审阅：`DRAFT / DRAFT → PENDING_APPROVAL / PENDING_REVIEW`。
 * 只允许从 DRAFT 发起，避免绕过编辑阶段直接进入待审。
 */
export function submitDraftForApproval(
  contract: SoftwareContractV12,
): SoftwareContractV12 {
  if (contract.lifecycle_state !== "DRAFT") {
    throw new ContractDraftError(
      "ILLEGAL_SUBMIT_STATE",
      `submitDraftForApproval requires lifecycle_state=DRAFT, got ${contract.lifecycle_state}`,
    );
  }
  return softwareContractSchema.parse({
    ...contract,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}
