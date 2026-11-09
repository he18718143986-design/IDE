import type { SoftwareContract } from "../../../src/lib/contract.schema";
import type { ReasonCode } from "../../../src/lib/evidence.schema";

/**
 * 质疑自查领域类型（TASK-S.5 / 架构 §5.7、§6.5）。
 *
 * 三方事实 = Prompt（会话）/ Spec（需求快照）/ Diff（真实代码）。
 * 归因结论只有三类；置信度 < 0.7 一律降级为 UNATTRIBUTED，由用户白话裁决。
 */

/** 60 秒硬超时（架构 D-3：60s 质询看门狗） */
export const DISPUTE_TIMEOUT_MS = 60_000;

/** 置信度门槛（架构 §5.7：confidence < 0.7 自动降级呈递事实） */
export const DISPUTE_CONFIDENCE_THRESHOLD = 0.7;

export const E_DISPUTE_TIMEOUT = "E_DISPUTE_TIMEOUT";

export type DisputeClassification =
  "IMPLEMENTATION_BUG" | "REQUIREMENT_DRIFT" | "UNATTRIBUTED";

export type DisputeActionKind =
  "REWORK" | "REQUIREMENT_CHANGE" | "MANUAL_ARBITRATION";

/** 降级后用户白话裁决（架构 D-3 / §5.7） */
export type DisputeUserChoice = "BUG_FIX" | "REQUIREMENT_CHANGE";

export interface PromptFactMessage {
  message_id: string;
  role: "user" | "supervisor" | "system";
  text: string;
  created_at: string;
  raw_start?: number | undefined;
  raw_end?: number | undefined;
}

export interface PromptFact {
  session_id: string | null;
  source: "SESSION" | "CHALLENGE_ONLY";
  /** 会话中最早的原始需求陈述（没有会话时为 null） */
  original_request: string | null;
  /** 用户显式确认/批准过的意图记录 */
  confirmations: PromptFactMessage[];
  /**
   * 左栏「你当时说的」：与本次质询相关的冻结方案条目所锚定的原话高亮
   * （修 P-2：来自台账 evidence 的 anchor，不再是会话消息的关键词命中）。
   * `text` 为锚定片段；`raw_start`/`raw_end` 指向原话中的高亮区间。
   */
  matched_messages: PromptFactMessage[];
}

export interface SpecFact {
  snapshot_id: string;
  version: number;
  sha256: string;
  content: string;
  /** 命中质询关键词的规范条目（不含标题与空行） */
  matched_entries: string[];
}

export interface DiffFact {
  worktree_path: string;
  available: boolean;
  changed_files: string[];
  diff_stat: string;
  diff_excerpt: string;
  commit_sha: string | null;
  /**
   * 新增的非注释、非字符串代码行（修 P-4）。由 `git diff base..task` 全文计算，
   * 不受 `diff_excerpt` 截断影响；缺省时由 `diff_excerpt` 现算。
   */
  added_code_lines?: string[] | undefined;
  /** 真实终端输出（来自 Evidence 的 stdout/stderr tail） */
  terminal_lines: string[];
  verification_results: Array<{
    alias: string;
    exit_code: number;
    passed: boolean;
  }>;
  evidence_id: string | null;
  /** 测试文件是否被改动：影响归因可信度 */
  tests_modified: boolean;
}

export interface TriadFacts {
  challenge: string;
  keywords: string[];
  prompt: PromptFact;
  spec: SpecFact | null;
  code: DiffFact;
}

export interface ReworkProposal {
  proposal_id: string;
  contract_id: string;
  change_request_id: string;
  /** 返工目标：严格等于「已变更文件 ∩ 合同 writable_paths」 */
  target_files: string[];
  /** 被拒绝的越界候选（只记录，绝不扩权） */
  rejected_paths: string[];
  /** 存在越界候选时为 true：必须先走合同升版审批，不能自动返工 */
  requires_scope_expansion: boolean;
  scope_subset_valid: true;
  instructions: string;
}

export interface RequirementChangeProposal {
  proposal_id: string;
  contract_id: string;
  change_request_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  source_snapshot_id: string;
  /** 未落盘的新合同草案，必须重新走审批 */
  draft_contract: SoftwareContract;
}

export interface DisputeNextAction {
  kind: DisputeActionKind;
  rework?: ReworkProposal | undefined;
  change_request?: RequirementChangeProposal | undefined;
  message?: string | undefined;
}

export interface DisputeReport {
  report_id: string;
  contract_id: string;
  change_request_id: string;
  challenge: string;
  classification: DisputeClassification;
  /** 降级前的算法建议（仅 UNATTRIBUTED 且有建议时出现） */
  suggested_classification?: DisputeClassification | undefined;
  confidence: number;
  degraded: boolean;
  /** 对齐 `reasonCodeSchema` 枚举（修 P-5）；质疑自查本身不写入 */
  reason_code?: ReasonCode | undefined;
  /** 技术错误码独立字段（修 P-5）：超时降级时为 `E_DISPUTE_TIMEOUT` */
  error_code?: typeof E_DISPUTE_TIMEOUT | undefined;
  rationale: string[];
  plain_summary: string;
  facts: TriadFacts;
  next_action: DisputeNextAction;
  generated_at: string;
}

export class DisputeTimeoutError extends Error {
  readonly code = E_DISPUTE_TIMEOUT;

  constructor(timeoutMs: number) {
    super(
      `[${E_DISPUTE_TIMEOUT}] 质疑自查在 ${timeoutMs}ms 内未完成，已安全中止`,
    );
    this.name = "DisputeTimeoutError";
  }
}
