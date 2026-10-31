/**
 * Local Daemon ↔ Web Console 消息帧协议（规范 TASK-D.1，协议 v1.2）。
 * 帧字典以《Stagent 系统架构设计规范 v1.2.1》§6.1 为唯一事实源：
 * 13 类规范帧 + 2 类历史扩展帧（WORKER_LOG / SCOPE_ALERT，§6.1 为"至少包括"，
 * 扩展帧只允许保留兼容，不允许再新增而不更新规范与协议版本）。
 *
 * v1.2 变更（TASK-D.1）：
 * - 标准帧结构补齐 `trace_id`（§6.1：trace_id, type, timestamp, payload）
 * - 帧字典补齐 6 类规范帧：CHAT_EVENT / SUPERVISOR_SUGGESTION / WORKER_EVENT /
 *   GATEWAY_VIOLATION / EVIDENCE_STATUS_CHANGED / TERMINAL_STREAM
 * - 新增 FRAME_CATALOG：每类帧的方向、鉴权要求、最大尺寸与语义说明
 * - 单帧上限 MAX_FRAME_BYTES = 2MB（TASK-D.1 G-12）
 *
 * v1.3 变更（TASK-D.3 / 架构 §6.1、§6.3.1 P-20）：
 * - 新增 `STATE_CHANGED` 广播帧：承载 Daemon 独占计算并持久化的
 *   `presentation_state`（15 态展示状态）与白话提示文本，前端零逻辑消费；
 * - `CONTRACT_UPDATE` 增加可选的 `presentation_state`，让尚未迁移到
 *   `STATE_CHANGED` 的客户端也能平滑读取（协议向后兼容）。
 *
 * v1.1 变更：新增 AUTH / AUTH_OK。
 * 浏览器原生 WebSocket API 不支持自定义 HTTP 头（无法发送
 * `Authorization: Bearer`），query 参数携带 Token 又会泄漏进 URL 日志，
 * 因此鉴权统一为「连接建立后的第一帧 AUTH 消息」：服务端校验失败立即以
 * WS_CLOSE_UNAUTHORIZED（4401）断开，超时未鉴权同样断开。
 *
 * v1.4 变更（TASK-C.7 / 架构 §3.3）：
 * - 新增 `TASK_GRAPH_UPDATED` 广播帧：载荷为 Daemon 独占维护的
 *   `TaskGraph` 全量快照 + 变更节点 + 进度百分比。前端不读本地 JSON，
 *   只按此帧做视图映射与点亮动效。
 *
 * v1.5 变更（TASK-S.4 / TASK-S.5 / 架构 §6.1）：
 * - 新增 `DEMO_PREVIEW_STATUS`：Demo 预览服务生命周期广播；
 * - 新增 `DISPUTE_REPORT_READY`：质疑自查报告摘要广播。
 * - 新增 `BASELINE_PROGRESS`（TASK-C.14f）：基线渐进扫阶段推送，替换前端 2s 轮询
 */

import type { PresentationState } from "../state/presentation-state";
import type { TaskGraphUpdatedPayload } from "../graph/task-graph";

export type { TaskGraphUpdatedPayload };

/** 规范 §6.1 帧类型字典（15 类规范帧 + 2 类历史扩展帧） */
export type IpcFrameType =
  // ---- 规范 §6.1 定义的 13 类 ----
  | "AUTH"
  | "AUTH_OK"
  | "PING"
  | "PONG"
  | "ERROR"
  | "CONTRACT_UPDATE"
  | "CHAT_EVENT"
  | "SUPERVISOR_SUGGESTION"
  | "WORKER_EVENT"
  | "GATEWAY_VIOLATION"
  | "EVIDENCE_READY"
  | "EVIDENCE_STATUS_CHANGED"
  | "TERMINAL_STREAM"
  // ---- v1.6.1 §6.1 / §6.3.1 新增的全量状态快照广播（TASK-D.3） ----
  | "STATE_CHANGED"
  // ---- v1.6.1 §3.3 Task Graph 全量快照广播（TASK-C.7） ----
  | "TASK_GRAPH_UPDATED"
  // ---- TASK-C.14f 基线渐进扫进度广播 ----
  | "BASELINE_PROGRESS"
  // ---- v1.6.1 §6.1 Demo 预览生命周期广播（TASK-S.4） ----
  | "DEMO_PREVIEW_STATUS"
  // ---- TASK-S.6b 真机预览生命周期广播 ----
  | "REAL_PLAYTEST_STATUS"
  // ---- v1.6.1 §6.1 质疑自查报告广播（TASK-S.5） ----
  | "DISPUTE_REPORT_READY"
  // ---- 历史扩展帧（v1.1 协议遗留，仅保留兼容，禁止再新增） ----
  | "WORKER_LOG"
  | "SCOPE_ALERT";

/** 鉴权失败 / 未在时限内鉴权的 WebSocket 关闭码（私有区间 4000-4999） */
export const WS_CLOSE_UNAUTHORIZED = 4401;

/** 单帧字节上限（TASK-D.1：限制单连接帧大小 ≤ 2MB，防 DoS） */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** AUTH 帧载荷：客户端连接后第一帧必须携带会话 Token */
export interface AuthPayload {
  token: string;
}

/**
 * 标准帧结构（§6.1）：trace_id, type, timestamp, payload。
 * - `trace_id` 由 createFrame 生成（UUID），贯穿一次广播/请求的全链路日志；
 *   对端解析时容忍缺失（历史客户端），但本实现发出的帧恒携带。
 */
export interface IpcFrame<T = unknown> {
  trace_id: string;
  type: IpcFrameType;
  payload?: T;
  timestamp: string;
}

export interface WorkerLogPayload {
  contract_id: string;
  lines: string[];
  /** 单帧超过传输上限时标记截断（规范 PASS-5） */
  truncated?: boolean;
}

export interface ContractUpdatePayload {
  contract_id: string;
  lifecycle_state: string;
  approval_status?: string;
  /**
   * TASK-D.3：可选携带投影结果，供尚未消费 `STATE_CHANGED` 的客户端平滑读取。
   *
   * 为什么是可选：`CONTRACT_UPDATE` 是 v1.2.1 既有帧，历史 Daemon 不会填这个字段；
   * 把它设成必填会让旧版本广播直接不合法。真正的"必选"约束放在
   * `STATE_CHANGED` 上——那个帧的存在意义就是携带该字段。
   */
  presentation_state?: PresentationState;
}

/**
 * `STATE_CHANGED` 载荷（§6.1 / §6.3.1 P-20）。
 *
 * Daemon 状态机独占计算并写入持久化快照，每次流转全量推送；
 * 前端不解构 lifecycle × approval 自行推导，只消费 `presentation_state`。
 */
export interface StateChangedPayload {
  contract_id: string;
  /** 展示状态，必填：本帧的核心载荷（§6.3.1 + §16.2 PROJECT_MAPPING） */
  presentation_state: PresentationState;
  /** 面向非技术用户的白话提示文本（§6.3.1） */
  message?: string;
  /** 底层状态，仅用于诊断与日志，前端展示不应依赖 */
  lifecycle_state?: string;
  approval_status?: string;
  /** 该快照的生成时刻，便于断线重连后比对新鲜度 */
  persisted_at?: string;
  /** TASK-C.12b / EO-01：会话代际；重连或强制重置时递增 */
  session_epoch?: number;
  /** TASK-C.12b / EO-01：同 epoch 内单调递增序号；客户端丢弃更小 seq */
  state_seq?: number;
  /** 强类型交付主态或轨 C 瞬态；不得与 DocumentAssetStatus 混用 */
  delivery_state?: string;
  /** TASK-J.8 / SSOT §16.2：Daemon 投影的幕次；前端只消费，不得推导 */
  journey_stage?: string;
  /** 幕内子态（JourneySubstate） */
  journey_substate?: string;
  /** 「已合入」幕的「已归档」小标记 */
  journey_archived?: boolean;
}

export interface ScopeAlertPayload {
  contract_id: string;
  code: string;
  message: string;
}

export interface EvidenceReadyPayload {
  contract_id: string;
  evidence_id: string;
  verdict: string;
  can_merge: boolean;
}

/** EVIDENCE_STATUS_CHANGED 载荷（§6.1：证据生命周期流转与外部改动导致的 STALE 失效通知） */
export interface EvidenceStatusChangedPayload {
  contract_id: string;
  evidence_id: string;
  /** 证据新状态，如 "STALE" / "FRESH" */
  status: string;
  reason_code?: string;
  message?: string;
}

export interface TerminalStreamPayload {
  contract_id: string;
  /** 结构化日志行（命令执行实时输出） */
  stream: "stdout" | "stderr";
  line: string;
}

export interface GatewayViolationPayload {
  /** 违规来源（如 "supervisor" / "worker"） */
  source: string;
  /** 被拦截的越权动作（如 "approveContract" / "execCommand"） */
  action: string;
  contract_id?: string;
  message: string;
}

export interface ChatEventPayload {
  session_id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface SupervisorSuggestionPayload {
  suggestion_id: string;
  session_id: string;
  kind: string;
  summary: string;
}

export interface WorkerEventPayload {
  contract_id: string;
  event: string;
  detail?: string;
}

/**
 * Demo 预览服务生命周期（TASK-S.4 / §6.1 `DEMO_PREVIEW_STATUS`）。
 *
 * 只有三态：预览服务要么在跑、要么已停、要么起不来。
 * 不设 `STARTING`：端口是启动时才确定的，提前广播会让前端拿到一个不可用的 URL。
 */
export type DemoPreviewLifecycleStatus = "RUNNING" | "STOPPED" | "ERROR";

/**
 * `DEMO_PREVIEW_STATUS` 载荷。
 *
 * 前端据此渲染"原型试玩中"视口：拿到 `url` 直接塞进
 * `<iframe sandbox="allow-scripts">`，不得自行拼接地址或改写 sandbox。
 */
export interface DemoPreviewStatusPayload {
  /** 独立 Origin 的访问地址，如 http://127.0.0.1:4101/ */
  url: string;
  port: number;
  status: DemoPreviewLifecycleStatus;
  /** 事件产生时刻（ISO），用于前端判断快照新鲜度 */
  updated_at: string;
  /** 失败原因，仅 status=ERROR 时出现 */
  message?: string;
}

/**
 * 真机预览生命周期（TASK-S.6b / §6.3.1 `REAL_PLAYTEST`）。
 * 与 Demo 三态对齐；额外携带 contract_id，便于多合同并列。
 */
export type RealPlaytestLifecycleStatus = "RUNNING" | "STOPPED" | "ERROR";

export interface RealPlaytestStatusPayload {
  contract_id: string;
  /** 中栏 iframe / 外链地址，如 http://127.0.0.1:4201/ */
  url: string;
  port: number;
  status: RealPlaytestLifecycleStatus;
  updated_at: string;
  /** true = Daemon 自建静态服务；false = 外链挂载 */
  owned: boolean;
  message?: string;
}

/** TASK-C.14f：基线渐进扫进度（与 GET /api/baseline 同形，供 WS 覆盖） */
export interface BaselineProgressPayload {
  phase: "stub" | "p0" | "deep" | "done" | "failed" | "accepted";
  scanning: boolean;
  accept_label: string;
  grants_construction: false;
  /** 与 BaselineArchivePayload.archive 同形；前端直接覆盖 */
  archive: Record<string, unknown> | null;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

/**
 * `DISPUTE_REPORT_READY` 载荷（TASK-S.5 / 架构 §6.1）。
 *
 * 只广播结论摘要，不把完整三方事实塞进帧：Diff 可能很大，
 * 完整报告由 `POST /api/supervisor/dispute` 的响应体承载。
 */
export interface DisputeReportReadyPayload {
  contract_id: string;
  report_id: string;
  change_request_id: string;
  classification: "IMPLEMENTATION_BUG" | "REQUIREMENT_DRIFT" | "UNATTRIBUTED";
  confidence: number;
  /** 置信度不足或看门狗超时导致的降级 */
  degraded: boolean;
  summary: string;
  /** 三方证据链摘要（完整报告由 POST 响应体返回，避免帧体过大） */
  facts: {
    prompt: {
      session_id: string | null;
      original_request: string | null;
      matched_messages: number;
      confirmations: number;
    };
    spec: {
      snapshot_id: string;
      version: number;
      matched_entries: string[];
    } | null;
    code: {
      worktree_available: boolean;
      changed_files: string[];
      verification: Array<{ alias: string; exit_code: number }>;
      evidence_id: string | null;
    };
  };
  generated_at: string;
}

export const IPC_FRAME_TYPES: readonly IpcFrameType[] = [
  "AUTH",
  "AUTH_OK",
  "PING",
  "PONG",
  "ERROR",
  "CONTRACT_UPDATE",
  "CHAT_EVENT",
  "SUPERVISOR_SUGGESTION",
  "WORKER_EVENT",
  "GATEWAY_VIOLATION",
  "EVIDENCE_READY",
  "EVIDENCE_STATUS_CHANGED",
  "TERMINAL_STREAM",
  "STATE_CHANGED",
  "TASK_GRAPH_UPDATED",
  "BASELINE_PROGRESS",
  "DEMO_PREVIEW_STATUS",
  "REAL_PLAYTEST_STATUS",
  "DISPUTE_REPORT_READY",
  "WORKER_LOG",
  "SCOPE_ALERT",
] as const;

/** 帧方向：client→server / server→client / 双向 */
export type FrameDirection =
  "client->server" | "server->client" | "bidirectional";

/**
 * 帧目录（§6.1：每类帧定义 Schema、最大尺寸、发送/接收方和权限）。
 * - direction：合法的发送方；服务端收到方向不符的帧应拒绝（FRAME_DIRECTION_FORBIDDEN）
 * - requiresAuth：未通过首帧 AUTH 的连接是否可收发该帧（仅 AUTH/AUTH_OK/ERROR 豁免）
 * - maxPayloadBytes：默认 2MB 上限（TASK-D.1 G-12）
 * - spec：v1.2.1 = 规范 §6.1 原始帧；v1.6.1 = v1.6.1 §6.1 新增广播帧；
 *   v1.6.2 = v1.6.2 开发任务规范新增帧（如 TASK-C.14f 的基线扫描进度）；
 *   extension = 历史扩展帧（仅兼容保留）
 */
export interface FrameCatalogEntry {
  type: IpcFrameType;
  direction: FrameDirection;
  requiresAuth: boolean;
  maxPayloadBytes: number;
  spec: "v1.2.1" | "v1.6.1" | "v1.6.2" | "extension";
  description: string;
}

export const FRAME_CATALOG: readonly FrameCatalogEntry[] = [
  {
    type: "AUTH",
    direction: "client->server",
    requiresAuth: false,
    maxPayloadBytes: MAX_FRAME_BYTES,
    spec: "v1.2.1",
    description: "连接后首帧鉴权，payload 仅允许认证数据 { token }",
  },
  {
    type: "AUTH_OK",
    direction: "server->client",
    requiresAuth: false,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "鉴权通过回执；收到后才允许发送业务帧与心跳",
  },
  {
    type: "PING",
    direction: "client->server",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "客户端 5s 心跳",
  },
  {
    type: "PONG",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "服务端心跳应答",
  },
  {
    type: "ERROR",
    direction: "server->client",
    requiresAuth: false,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "错误通知，payload 含稳定 code 与脱敏 message",
  },
  {
    type: "CONTRACT_UPDATE",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "合同状态机变更推送（可选携带 presentation_state）",
  },
  {
    type: "STATE_CHANGED",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.6.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "全量状态快照广播，必含 15 态 presentation_state 与白话提示（TASK-D.3）",
  },
  {
    type: "DEMO_PREVIEW_STATUS",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.6.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "Demo 预览服务生命周期广播，含独立 Origin 的 url / port / status / updated_at（TASK-S.4）",
  },
  {
    type: "REAL_PLAYTEST_STATUS",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.6.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "真机预览生命周期广播，含 contract_id / url / port / status（TASK-S.6b）",
  },
  {
    type: "DISPUTE_REPORT_READY",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.6.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "质疑自查报告广播，携带归因类别、置信度、降级标记与白话摘要（TASK-S.5 / §6.1）",
  },
  {
    type: "CHAT_EVENT",
    direction: "bidirectional",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "会话消息事件（S.x/C.x 任务落地语义）",
  },
  {
    type: "TASK_GRAPH_UPDATED",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.6.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "Task Graph 全量快照广播：七态节点、变更指纹与进度百分比（TASK-C.7 §3.3）",
  },
  {
    type: "BASELINE_PROGRESS",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.6.2",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "基线渐进扫进度：P0/深度/完成阶段推送（TASK-C.14f；替代前端 2s 轮询）",
  },
  {
    type: "SUPERVISOR_SUGGESTION",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "Supervisor 建议推送（TASK-S.3）",
  },
  {
    type: "WORKER_EVENT",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "Worker 执行事件（TASK-W.x）",
  },
  {
    type: "GATEWAY_VIOLATION",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "越权调用审计事件（TASK-S.1/W.4）",
  },
  {
    type: "EVIDENCE_READY",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "证据生成完成、待核销通知",
  },
  {
    type: "EVIDENCE_STATUS_CHANGED",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "证据生命周期流转与外部文件修改导致的 STALE 失效通知",
  },
  {
    type: "TERMINAL_STREAM",
    direction: "server->client",
    requiresAuth: true,
    spec: "v1.2.1",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "命令执行实时结构化日志流",
  },
  // ---- 历史扩展帧（v1.1 协议遗留） ----
  {
    type: "WORKER_LOG",
    direction: "server->client",
    requiresAuth: true,
    spec: "extension",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description:
      "Worker 日志批量推送（TERMINAL_STREAM 前身；保留兼容，C.x 迁移后下线）",
  },
  {
    type: "SCOPE_ALERT",
    direction: "server->client",
    requiresAuth: true,
    spec: "extension",
    maxPayloadBytes: MAX_FRAME_BYTES,
    description: "Scope/证据失效告警（EVIDENCE_STATUS_CHANGED 前身；保留兼容）",
  },
] as const;

const CATALOG_BY_TYPE: ReadonlyMap<IpcFrameType, FrameCatalogEntry> = new Map(
  FRAME_CATALOG.map((entry) => [entry.type, entry]),
);

export function getFrameSpec(type: IpcFrameType): FrameCatalogEntry {
  const entry = CATALOG_BY_TYPE.get(type);
  if (!entry) throw new Error(`Frame type not in catalog: ${type}`);
  return entry;
}

/** 该帧类型是否允许由客户端发往服务端（鉴权后） */
export function isClientToServerAllowed(type: IpcFrameType): boolean {
  const { direction } = getFrameSpec(type);
  return direction === "client->server" || direction === "bidirectional";
}

export function isIpcFrame(value: unknown): value is IpcFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<IpcFrame>;
  if (
    typeof frame.type !== "string" ||
    !(IPC_FRAME_TYPES as readonly string[]).includes(frame.type)
  ) {
    return false;
  }
  // trace_id 为规范必含字段；解析端容忍历史帧缺失，但若存在必须为字符串
  if (frame.trace_id !== undefined && typeof frame.trace_id !== "string") {
    return false;
  }
  return true;
}

export function createFrame<T>(type: IpcFrameType, payload?: T): IpcFrame<T> {
  return {
    // globalThis.crypto 在 Node ≥19 与浏览器均可用；不能 import node:crypto
    // （本模块同时被打包进浏览器客户端）
    trace_id: globalThis.crypto.randomUUID(),
    type,
    ...(payload === undefined ? {} : { payload }),
    timestamp: new Date().toISOString(),
  };
}

/** 单帧 WORKER_LOG 的字符上限，超出则截断并标记（PASS-5 有界截断） */
export const MAX_LOG_FRAME_CHARS = 8_000;

export function chunkWorkerLog(
  contractId: string,
  lines: string[],
): WorkerLogPayload[] {
  const frames: WorkerLogPayload[] = [];
  let buffer: string[] = [];
  let size = 0;

  const flush = (truncated = false) => {
    if (buffer.length === 0 && !truncated) return;
    frames.push({
      contract_id: contractId,
      lines: buffer,
      ...(truncated ? { truncated: true } : {}),
    });
    buffer = [];
    size = 0;
  };

  for (const line of lines) {
    const bounded =
      line.length > MAX_LOG_FRAME_CHARS
        ? line.slice(0, MAX_LOG_FRAME_CHARS) + " [truncated]"
        : line;
    if (size + bounded.length > MAX_LOG_FRAME_CHARS && buffer.length > 0) {
      flush();
    }
    buffer.push(bounded);
    size += bounded.length;
  }
  flush();
  return frames;
}
