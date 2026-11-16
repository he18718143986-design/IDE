/**
 * Supervisor 领域类型（TASK-S.1）。
 *
 * 设计约束（规范 A §2.2 / B TASK-S.1）：
 * - Supervisor 只持有「会话 + 授权上下文」数据，不持有任何执行能力；
 * - 会话文件是 Local-First 的唯一权威副本，跨端共享的结构在此统一定义，
 *   由 `daemon/supervisor/session-manager.ts` 负责原子落盘；
 * - 权限边界相关的类型（特权动作名）放在 `permissions.ts`，避免本文件
 *   被误当作可扩展的执行面。
 */

/** 会话文件格式版本：升级结构时必须递增，并配套迁移（禁止静默读取旧结构） */
export const SUPERVISOR_SESSION_SCHEMA_VERSION = "1.0.0" as const;
export type SupervisorSessionSchemaVersion =
  typeof SUPERVISOR_SESSION_SCHEMA_VERSION;

/** 会话消息角色：Supervisor 本身永远不产生 `tool` 角色消息（Zero-Tool） */
export type SupervisorMessageRole = "user" | "supervisor" | "system";

/** 消息来源：用户 UI 输入 / Daemon 授权事件 / 模型输出 */
export type SupervisorMessageSource = "ui" | "daemon_event" | "model";

export interface SupervisorMessage {
  message_id: string;
  role: SupervisorMessageRole;
  text: string;
  /** ISO 8601 时间戳 */
  created_at: string;
  source: SupervisorMessageSource;
  /** 授权上下文引用（§2.2：上下文引用需记录来源与访问策略） */
  refs?: string[] | undefined;
}

/** 用户对观察行为的显式控制（§2.2：可停止观察 / 清除本地会话） */
export type SupervisorObservationState = "ACTIVE" | "PAUSED";

/**
 * Supervisor 用量快照：只读镜像，权威账本是**独立**的 Supervisor 预算账本
 * （`daemon/supervisor/budget.ts` → `.stagent/supervisor-budget.json`，v1.3.3 分账）。
 * 快照仅用于 UI 展示与会话恢复时的对照，不得用于放行判断。
 */
export interface SupervisorUsageSnapshot {
  input_tokens: number;
  output_tokens: number;
  /** 最小货币单位（分），与合同 `cost_limits.max_cost_minor_units` 同尺度 */
  cost_minor_units: number;
  currency: string;
  updated_at: string;
}

export interface SupervisorSession {
  schema_version: SupervisorSessionSchemaVersion;
  session_id: string;
  /** 绑定的合同；无合同时为「探索模式」会话 */
  contract_id?: string | undefined;
  created_at: string;
  updated_at: string;
  messages: SupervisorMessage[];
  observation?: SupervisorObservationState | undefined;
  usage?: SupervisorUsageSnapshot | undefined;
}

export interface SupervisorSessionSummary {
  session_id: string;
  contract_id?: string | undefined;
  created_at: string;
  updated_at: string;
  message_count: number;
  observation: SupervisorObservationState;
  /** 文件路径，便于 UI 定位与排障 */
  file_path: string;
}

export interface SupervisorQuarantineRecord {
  file: string;
  reason: string;
  quarantined_as: string;
}

/** `recover()` 的返回值：健康会话 + 被隔离的损坏文件 + 清理的孤儿临时文件 */
export interface SupervisorRecoveryReport {
  sessions: SupervisorSession[];
  quarantined: SupervisorQuarantineRecord[];
  removed_temp_files: string[];
}

// --- Prompt 组装所需的授权上下文（只读快照） ---

export type ContractLifecycleSnapshot =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "PREPARING"
  | "EXECUTING"
  | "VERIFYING"
  | "PENDING_RESUME"
  | "AUDITED"
  | "MERGED"
  | "ABORTED";

export interface SupervisorContractSnapshot {
  contract_id: string;
  lifecycle_state: ContractLifecycleSnapshot | string;
  approval_status: string;
  contract_revision: number;
  objective?: string | undefined;
  /** 合同 Scope：允许 Supervisor 感知的路径集合 */
  scope_paths?: string[] | undefined;
  cost_limits?:
    | {
        max_cost_minor_units: number;
        currency: string;
      }
    | undefined;
}

export interface SupervisorProjectSnapshot {
  repo_root: string;
  branch?: string | undefined;
  dirty?: boolean | undefined;
  recent_files?: string[] | undefined;
  contract?: SupervisorContractSnapshot | undefined;
}

export interface SupervisorArchitectureContext {
  /** 架构分层约束（来自规范/索引，纯文本项目符号） */
  constraints: string[];
  /** 禁止依赖方向（如 "ui -> daemon 内部模块"） */
  forbidden_dependencies?: string[] | undefined;
}

/**
 * 台账方案摘要（调用方注入；builder 零 I/O）。
 * 字段均可选：有什么渲染什么，缺省不伪造。
 */
export interface SupervisorSchemeSummary {
  title?: string | undefined;
  summary?: string | undefined;
  scheme_revision?: number | undefined;
}

/** 与 J.32a TrustTier 对齐的字面量（不在此文件 import pipeline，避免类型层耦合） */
export type SupervisorTrustTier = "light" | "standard" | "reconfirm";

/**
 * 单条回链核对摘要（只消费 J.32a 已算好的 verdict；不得在 builder 内重算）。
 * covered:false 时必须带 reason；组装文案不得把该项写成「已覆盖」。
 */
export type SupervisorBacklinkItemSummary =
  | { id: string; covered: true; turn_id?: string | undefined }
  | {
      id: string;
      covered: false;
      reason: "ai_inferred" | "no_turn_evidence" | "unregistered" | "hash_mismatch" | string;
    };

/**
 * 回链核对摘要。evaluation_ok===false（如整体 hash_mismatch）时不得宣称任何项已覆盖。
 */
export interface SupervisorBacklinkSummary {
  evaluation_ok?: boolean | undefined;
  failure_reason?: string | undefined;
  items?: readonly SupervisorBacklinkItemSummary[] | undefined;
}

export interface SupervisorContextBundle {
  project: SupervisorProjectSnapshot;
  architecture: SupervisorArchitectureContext;
  /** 最近 Daemon 事件摘要（脱敏后） */
  event_digests?: string[] | undefined;
  /** 编译器台账方案摘要（可选；缺省不渲染该段） */
  scheme_summary?: SupervisorSchemeSummary | undefined;
  /** 信任档（可选；缺省不渲染该段） */
  trust_tier?: SupervisorTrustTier | undefined;
  /** 原话回链核对摘要（可选；缺省不渲染该段；只消费 J.32a 结果） */
  backlink_summary?: SupervisorBacklinkSummary | undefined;
}

export interface SupervisorPromptPolicy {
  /** 输入预算（token 估算上限），默认 3000 */
  max_input_tokens?: number | undefined;
  /** 粗略估算：多少字符折算 1 token，默认 4 */
  chars_per_token?: number | undefined;
  /** 最多保留的对话消息条数（窗口上限），默认 40 */
  max_messages?: number | undefined;
}

export interface SupervisorPromptSection {
  title: string;
  body: string;
}

export interface SupervisorBuiltPrompt {
  text: string;
  sections: SupervisorPromptSection[];
  estimated_input_tokens: number;
  /** 是否因预算裁剪过消息 */
  truncated: boolean;
  dropped_message_ids: string[];
}
