import { randomUUID } from "node:crypto";
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import {
  buildRequirementChangeProposal,
  buildReworkProposal,
  classifyDispute,
  computeSignals,
} from "./classification";
import { collectTriadFacts, type DisputeFactDeps } from "./evidence-triad";
import {
  DISPUTE_TIMEOUT_MS,
  DisputeTimeoutError,
  E_DISPUTE_TIMEOUT,
  type DisputeNextAction,
  type DisputeReport,
  type DisputeUserChoice,
  type SealFact,
  type SpecFact,
  type TriadFacts,
} from "./types";

/**
 * 质疑自查引擎（TASK-S.5）。
 *
 * 流程固定为四步，任何一步都不允许"模型先下结论再补证据"：
 * 1. 抓三方事实（会话 / 需求快照 / 真实 Diff+退出码）；
 * 2. 规则归因 + 置信度；
 * 3. 按结论生成受限动作（返工提案 / 新合同草案 / 人工裁决）；
 * 4. 输出白话报告。
 *
 * 看门狗只包住"抓事实"阶段：归因是纯同步计算，不会挂死。
 */

export interface DisputeSelfCheckInput {
  contract: SoftwareContract;
  challenge: string;
  repoRoot: string;
  sessionId?: string | undefined;
  timeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
  /** 用户在降级场景点选后强制归因，跳过自动置信度门槛 */
  userChoice?: DisputeUserChoice | undefined;
}

/**
 * 60 秒硬超时兜底。
 *
 * 注意：超时只能拒绝调用方，无法强杀底层 I/O（Node 无协程取消）。
 * 因此这里保证的是"调用方 60s 内一定拿到结果或错误"，而不是"底层立刻停止"。
 */
export async function withDisputeWatchdog<T>(
  work: Promise<T>,
  timeoutMs: number = DISPUTE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new DisputeTimeoutError(timeoutMs));
        }, timeoutMs);
        // 不因看门狗定时器把进程吊住（CLI/测试退出时尤其重要）
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function changeRequestId(now: Date): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `cr_${day}_${randomUUID().slice(0, 8)}`;
}

/**
 * 用户可见文案（supervisor §16.7）：只用「这是 Bug，免费修」「我想要新功能，下一轮做」，
 * 不出现技术分类词、置信度或错误码。
 */
function plainSummary(
  classification: DisputeReport["classification"],
  next: DisputeNextAction,
): string {
  switch (classification) {
    case "IMPLEMENTATION_BUG":
      return (
        "这是 Bug，免费修：方案里写了这一条，这次施工没有做到。" +
        "我安排返工，只改授权范围内的文件" +
        (next.rework && next.rework.target_files.length > 0
          ? `（${next.rework.target_files.slice(0, 3).join("、")}）`
          : "") +
        "，不另算。"
      );
    case "REQUIREMENT_DRIFT":
      return (
        "我想要新功能，下一轮做：这一条方案里没有提到。" +
        "我整理成下一轮的需求草稿，需要你确认后才会动工，不会直接改代码。"
      );
    default:
      return (
        "我还不能确定是哪一边的问题。你可以选：" +
        "「这是 Bug，免费修」或「我想要新功能，下一轮做」。"
      );
  }
}

/** 用户白话裁决：强制分类并生成对应 next_action（不经置信度门槛） */
export function outcomeFromUserChoice(
  choice: DisputeUserChoice,
  facts: TriadFacts,
  contract: SoftwareContract,
): ReturnType<typeof classifyDispute> {
  const signals = computeSignals(facts, contract);
  if (choice === "BUG_FIX") {
    return {
      classification: "IMPLEMENTATION_BUG",
      suggested: "IMPLEMENTATION_BUG",
      confidence: 1,
      signals,
      rationale: ["您已选择：这是 Bug，免费修（人工裁决）"],
    };
  }
  return {
    classification: "REQUIREMENT_DRIFT",
    suggested: "REQUIREMENT_DRIFT",
    confidence: 1,
    signals,
    rationale: ["您已选择：我想要新功能，下一轮做（人工裁决）"],
  };
}

/** 执行一次完整的质疑自查（不含 HTTP/广播） */
export async function runDisputeSelfCheck(
  input: DisputeSelfCheckInput,
  deps: DisputeFactDeps = {},
): Promise<DisputeReport> {
  const now = input.now ?? (() => new Date());
  const timeoutMs = input.timeoutMs ?? DISPUTE_TIMEOUT_MS;
  const at = now();

  const facts = await withDisputeWatchdog(
    collectTriadFacts(
      {
        contract: input.contract,
        challenge: input.challenge,
        repoRoot: input.repoRoot,
        ...(input.sessionId === undefined
          ? {}
          : { sessionId: input.sessionId }),
      },
      deps,
    ),
    timeoutMs,
  );

  const outcome = input.userChoice
    ? outcomeFromUserChoice(input.userChoice, facts, input.contract)
    : classifyDispute(facts, input.contract);
  const crId = changeRequestId(at);

  let nextAction: DisputeNextAction;
  if (outcome.classification === "IMPLEMENTATION_BUG") {
    nextAction = {
      kind: "REWORK",
      rework: buildReworkProposal(input.contract, facts, crId),
    };
  } else if (outcome.classification === "REQUIREMENT_DRIFT") {
    nextAction = {
      kind: "REQUIREMENT_CHANGE",
      change_request: buildRequirementChangeProposal(
        input.contract,
        facts,
        crId,
        at,
      ),
    };
  } else {
    nextAction = {
      kind: "MANUAL_ARBITRATION",
      message:
        "我还不能确定是哪一边的问题，请在下面二选一：「这是 Bug，免费修」或「我想要新功能，下一轮做」。",
    };
  }

  return {
    report_id: `dispute_${randomUUID().slice(0, 8)}`,
    contract_id: input.contract.contract_id,
    change_request_id: crId,
    challenge: input.challenge,
    classification: outcome.classification,
    ...(outcome.suggested !== outcome.classification
      ? { suggested_classification: outcome.suggested }
      : {}),
    confidence: outcome.confidence,
    degraded: outcome.classification === "UNATTRIBUTED",
    rationale: outcome.rationale,
    plain_summary: plainSummary(outcome.classification, nextAction),
    facts,
    next_action: nextAction,
    generated_at: at.toISOString(),
  };
}

/**
 * 超时降级报告（架构 D-3）：60s 内没算完时，不让用户干等，
 * 把已抓到的规范与质询原样呈递，明确标注 `E_DISPUTE_TIMEOUT`。
 */
export function buildTimeoutFallbackReport(params: {
  contract: SoftwareContract;
  challenge: string;
  timeoutMs?: number | undefined;
  spec?: SpecFact | null | undefined;
  /** 超时也要呈递封存原话：它只读快照，不受看门狗中止的抓取影响 */
  seal: SealFact;
  now?: (() => Date) | undefined;
}): DisputeReport {
  const now = params.now ?? (() => new Date());
  const at = now();
  const crId = changeRequestId(at);
  const timeoutMs = params.timeoutMs ?? DISPUTE_TIMEOUT_MS;

  const facts: TriadFacts = {
    challenge: params.challenge,
    keywords: [],
    prompt: {
      session_id: null,
      source: "CHALLENGE_ONLY",
      original_request: null,
      confirmations: [],
      matched_messages: [],
      seal: params.seal,
    },
    spec: params.spec ?? null,
    code: {
      worktree_path: "",
      available: false,
      changed_files: [],
      diff_stat: "",
      diff_excerpt: "",
      commit_sha: null,
      terminal_lines: [],
      verification_results: [],
      evidence_id: null,
      tests_modified: false,
    },
  };

  return {
    report_id: `dispute_${randomUUID().slice(0, 8)}`,
    contract_id: params.contract.contract_id,
    change_request_id: crId,
    challenge: params.challenge,
    classification: "UNATTRIBUTED",
    confidence: 0,
    degraded: true,
    error_code: E_DISPUTE_TIMEOUT,
    rationale: [`质疑自查在 ${timeoutMs}ms 内未完成，已按 D-3 降级为人工裁决`],
    plain_summary:
      "这次比对花的时间比预期长，我先把已经找到的三方事实列给你看。" +
      "你可以选：「这是 Bug，免费修」或「我想要新功能，下一轮做」。",
    facts,
    next_action: {
      kind: "MANUAL_ARBITRATION",
      message: "比对超时，请直接二选一，或稍后重试。",
    },
    generated_at: at.toISOString(),
  };
}
