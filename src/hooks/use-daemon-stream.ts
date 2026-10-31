import { useCallback, useEffect, useRef, useState } from "react";
import { StagentIpcClient, type IpcClientStatus } from "@/lib/ipc/client";
import type {
  ContractUpdatePayload,
  DemoPreviewStatusPayload,
  RealPlaytestStatusPayload,
  DisputeReportReadyPayload,
  ErrorPayload,
  EvidenceStatusChangedPayload,
  EvidenceReadyPayload,
  IpcFrame,
  ScopeAlertPayload,
  GatewayViolationPayload,
  StateChangedPayload,
  TerminalStreamPayload,
  WorkerLogPayload,
  TaskGraphUpdatedPayload,
  BaselineProgressPayload,
} from "@/lib/ipc/frames";
import type { ChatEvent } from "@/lib/chat-events";

/**
 * Daemon WebSocket 实时流（Track C）。
 *
 * 控制台此前只以 15s 轮询拉取状态，Worker 日志要等 HTTP 响应结束才可见，
 * 证据失效告警更是完全看不到。这里把已实现但一直未接线的 StagentIpcClient
 * 接入 React：状态变更 / 日志 / 告警全部由 Daemon 推送，轮询退化为兜底。
 *
 * 鉴权沿用协议 v1.1：连接建立后第一帧 AUTH，失败以 4401 断开且不重连。
 */

export interface StreamLogLine {
  contractId: string;
  line: string;
  at: string;
}

export interface StreamAlert {
  id: string;
  contractId: string;
  code: string;
  message: string;
  at: string;
  path?: string | undefined;
}

/** TASK-C.5 终端回放行（内容已由 Daemon 脱敏） */
export interface StreamTerminalLine {
  contractId: string;
  stream: "stdout" | "stderr";
  line: string;
  at: string;
}

/** 内存有界：Worker 可以无限刷日志，浏览器不能无限接 */
const MAX_LOG_LINES = 500;
const MAX_ALERTS = 20;
const MAX_TERMINAL_LINES = 2000;

export interface UseDaemonStreamOptions {
  /** Daemon HTTP/WebSocket 端口；null 表示尚未探测到 */
  port: number | null;
  token: string;
  host?: string;
  /** 完整 Daemon Base URL；提供时用于推导 WS scheme/host（跨域代理场景） */
  baseUrl?: string;
  enabled?: boolean;
  onContractUpdate?: (payload: ContractUpdatePayload) => void;
  onEvidenceReady?: (payload: EvidenceReadyPayload) => void;
  onStreamError?: (message: string) => void;
  onChatEvent?: (event: ChatEvent) => void;
  onEvidenceStatus?: (payload: EvidenceStatusChangedPayload) => void;
  /**
   * TASK-C.7 §3.3：Task Graph 全量快照推送。
   * Daemon 是唯一权威，前端只按帧覆盖本地视图，不自行推导节点状态。
   */
  onTaskGraphUpdate?: (payload: TaskGraphUpdatedPayload) => void;
  /** TASK-D.3 / C.2 / J.8：展示状态权威帧（含可选 journey_*） */
  onStateChanged?: (payload: StateChangedPayload) => void;
  /** TASK-S.4 / C.2：Demo 预览生命周期 */
  onDemoPreviewStatus?: (payload: DemoPreviewStatusPayload) => void;
  /** TASK-S.6b：真机预览生命周期 */
  onRealPlaytestStatus?: (payload: RealPlaytestStatusPayload) => void;
  /** TASK-S.5 / C.2：质疑报告摘要就绪（完整报告仍走 HTTP 响应） */
  onDisputeReportReady?: (payload: DisputeReportReadyPayload) => void;
  /** TASK-C.14f：基线渐进扫进度（替代 2s 轮询） */
  onBaselineProgress?: (payload: BaselineProgressPayload) => void;
}

export interface DaemonStreamState {
  status: IpcClientStatus;
  logs: StreamLogLine[];
  alerts: StreamAlert[];
  /** TASK-C.5：命令输出的逐行回放（按合同区分） */
  terminal: StreamTerminalLine[];
  clearLogs: () => void;
  clearTerminal: () => void;
  dismissAlert: (id: string) => void;
}

function asPayload<T>(frame: IpcFrame): T | null {
  return (frame.payload as T | undefined) ?? null;
}

export function useDaemonStream(
  options: UseDaemonStreamOptions,
): DaemonStreamState {
  const { port, token, host = "127.0.0.1", baseUrl, enabled = true } = options;

  const [status, setStatus] = useState<IpcClientStatus>("closed");
  const [logs, setLogs] = useState<StreamLogLine[]>([]);
  const [alerts, setAlerts] = useState<StreamAlert[]>([]);
  const [terminal, setTerminal] = useState<StreamTerminalLine[]>([]);

  // 回调放进 ref：避免父组件每次渲染都重建 WebSocket 连接
  const handlersRef = useRef(options);
  useEffect(() => {
    handlersRef.current = options;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !enabled || !port || !token) {
      setStatus("closed");
      return;
    }

    const client = new StagentIpcClient({
      port,
      token,
      host,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      onStatusChange: setStatus,
    });

    const off = client.onFrame((frame: IpcFrame) => {
      const at = frame.timestamp;
      switch (frame.type) {
        case "WORKER_LOG": {
          const payload = asPayload<WorkerLogPayload>(frame);
          if (!payload?.lines?.length) return;
          const incoming = payload.lines.map((line) => ({
            contractId: payload.contract_id,
            line,
            at,
          }));
          setLogs((prev) => [...prev, ...incoming].slice(-MAX_LOG_LINES));
          return;
        }

        case "GATEWAY_VIOLATION": {
          const payload = asPayload<GatewayViolationPayload>(frame);
          if (!payload) return;
          const code =
            (payload as { reason?: string; code?: string }).reason ??
            (payload as { code?: string }).code ??
            "E_OUT_OF_SCOPE";
          setAlerts((prev) =>
            [
              {
                id: `${at}-gateway-${prev.length}`,
                contractId: payload.contract_id ?? "unknown",
                code: String(code),
                message: payload.message || "写入被 Gateway 拦截",
                at,
                path: (payload as { path?: string }).path,
              },
              ...prev,
            ].slice(0, MAX_ALERTS),
          );
          return;
        }
        case "SCOPE_ALERT": {
          const payload = asPayload<ScopeAlertPayload>(frame);
          if (!payload) return;
          setAlerts((prev) =>
            [
              {
                id: `${at}-${payload.code}-${prev.length}`,
                contractId: payload.contract_id,
                code: payload.code,
                message: payload.message,
                at,
              },
              ...prev,
            ].slice(0, MAX_ALERTS),
          );
          return;
        }
        case "TERMINAL_STREAM": {
          const payload = asPayload<TerminalStreamPayload>(frame);
          if (!payload?.line) return;
          setTerminal((prev) =>
            [
              ...prev,
              {
                contractId: payload.contract_id,
                stream: payload.stream,
                line: payload.line,
                at,
              },
            ].slice(-MAX_TERMINAL_LINES),
          );
          return;
        }
        case "CONTRACT_UPDATE": {
          const payload = asPayload<ContractUpdatePayload>(frame);
          if (payload) handlersRef.current.onContractUpdate?.(payload);
          return;
        }
        case "EVIDENCE_READY": {
          const payload = asPayload<EvidenceReadyPayload>(frame);
          if (payload) handlersRef.current.onEvidenceReady?.(payload);
          return;
        }
        case "EVIDENCE_STATUS_CHANGED": {
          const payload = asPayload<EvidenceStatusChangedPayload>(frame);
          if (payload) handlersRef.current.onEvidenceStatus?.(payload);
          return;
        }
        case "CHAT_EVENT": {
          const payload = asPayload<ChatEvent>(frame);
          if (payload) handlersRef.current.onChatEvent?.(payload);
          return;
        }
        case "TASK_GRAPH_UPDATED": {
          const payload = asPayload<TaskGraphUpdatedPayload>(frame);
          // 乱序保护由消费方按 revision 判断；这里只做形状守卫
          if (payload?.graph) {
            handlersRef.current.onTaskGraphUpdate?.(payload);
          }
          return;
        }
        case "STATE_CHANGED": {
          const payload = asPayload<StateChangedPayload>(frame);
          if (payload?.presentation_state) {
            handlersRef.current.onStateChanged?.(payload);
          }
          return;
        }
        case "DEMO_PREVIEW_STATUS": {
          const payload = asPayload<DemoPreviewStatusPayload>(frame);
          if (payload?.status) {
            handlersRef.current.onDemoPreviewStatus?.(payload);
          }
          return;
        }
        case "REAL_PLAYTEST_STATUS": {
          const payload = asPayload<RealPlaytestStatusPayload>(frame);
          if (payload?.status) {
            handlersRef.current.onRealPlaytestStatus?.(payload);
          }
          return;
        }
        case "DISPUTE_REPORT_READY": {
          const payload = asPayload<DisputeReportReadyPayload>(frame);
          if (payload?.report_id) {
            handlersRef.current.onDisputeReportReady?.(payload);
          }
          return;
        }
        case "BASELINE_PROGRESS": {
          const payload = asPayload<BaselineProgressPayload>(frame);
          if (payload) {
            handlersRef.current.onBaselineProgress?.(payload);
          }
          return;
        }
        case "ERROR": {
          const payload = asPayload<ErrorPayload>(frame);
          if (payload) handlersRef.current.onStreamError?.(payload.message);
          return;
        }
        default:
          return;
      }
    });

    client.connect();
    return () => {
      off();
      client.close();
    };
  }, [port, token, host, baseUrl, enabled]);

  const clearLogs = useCallback(() => setLogs([]), []);
  const clearTerminal = useCallback(() => setTerminal([]), []);
  const dismissAlert = useCallback(
    (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  return {
    status,
    logs,
    alerts,
    terminal,
    clearLogs,
    clearTerminal,
    dismissAlert,
  };
}
