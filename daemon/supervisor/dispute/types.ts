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

/**
 * 左栏原话的封存状态（P-201），取自合同 scheme_binding 指向的确认快照：
 * - SEALED：快照带封存段且完整性校验通过；
 * - NOT_SEALED：快照可用但没有封存段（封存上线前的确认）；
 * - NO_BINDING / SNAPSHOT_MISSING：合同没有绑定快照，或快照读不到；
 * - TAMPERED：快照 digest 与合同不符，或封存段校验不通过。
 */
export type SealStatus =
  "SEALED" | "NOT_SEALED" | "NO_BINDING" | "SNAPSHOT_MISSING" | "TAMPERED";

export interface SealedQuoteFact {
  turn_id: string;
  seq: number;
  text: string;
  turn_text_sha256: string;
  /** 与本次质疑关键词的命中数，只用于排序，不用于过滤 */
  keyword_hits: number;
}

export interface SealFact {
  status: SealStatus;
  confirmation_id: string | null;
  /** 找到合同绑定的确认快照且 digest 相符 */
  bound_snapshot: boolean;
  /** 绑定快照的创建时间，即用户确认方案的时间 */
  confirmed_at: string | null;
  /** 仅 SEALED 时为封存原话总条数，其余为 null */
  frozen_quotes_count: number | null;
  /** 全部封存原话按相关度排序（不滤空），超出展示上限时截断 */
  quotes: SealedQuoteFact[];
}

export interface PromptFact {
  session_id: string | null;
  source: "SESSION" | "CHALLENGE_ONLY";
  /** 会话中最早的原始需求陈述（没有会话时为 null） */
  original_request: string | null;
  /** 用户显式确认/批准过的意图记录 */
  confirmations: PromptFactMessage[];
  /**
   * 与本次质询相关的冻结方案条目所锚定的原话（修 P-2：来自台账 evidence 的 anchor）。
   * 只作归因信号；左栏展示改读 `seal.quotes`（P-201）。
   */
  matched_messages: PromptFactMessage[];
  /** 左栏「你当时说的」：确认时封存的原话（P-201） */
  seal: SealFact;
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
