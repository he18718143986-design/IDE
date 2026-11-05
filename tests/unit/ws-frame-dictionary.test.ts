import { describe, it, expect } from "vitest";
import {
  createFrame,
  FRAME_CATALOG,
  getFrameSpec,
  IPC_FRAME_TYPES,
  isClientToServerAllowed,
  isIpcFrame,
  MAX_FRAME_BYTES,
  type IpcFrameType,
  type EvidenceStatusChangedPayload,
} from "../../src/lib/ipc/frames";

/**
 * TASK-D.1 / 规范 §6.1 帧字典契约测试。
 * §6.1 强制 13 类规范帧；WORKER_LOG / SCOPE_ALERT 为 v1.1 历史扩展帧
 * （规范措辞"至少包括"，允许保留但禁止再新增而不更新规范）。
 */

const SPEC_V121_TYPES: readonly IpcFrameType[] = [
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
];

describe("WS 帧字典（§6.1 十三类规范帧）", () => {
  it("规范要求的 13 类帧全部存在", () => {
    for (const type of SPEC_V121_TYPES) {
      expect(IPC_FRAME_TYPES).toContain(type);
    }
  });

  it("FRAME_CATALOG 覆盖帧字典中的每一类，无遗漏、无冗余", () => {
    const catalogTypes = FRAME_CATALOG.map((e) => e.type);
    expect([...catalogTypes].sort()).toEqual([...IPC_FRAME_TYPES].sort());
  });

  it("每类帧均定义方向、鉴权要求、最大尺寸与语义说明", () => {
    for (const entry of FRAME_CATALOG) {
      expect(entry.direction).toMatch(
        /^(client->server|server->client|bidirectional)$/,
      );
      expect(typeof entry.requiresAuth).toBe("boolean");
      expect(entry.maxPayloadBytes).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("单帧上限为 2MB（TASK-D.1 G-12）", () => {
    expect(MAX_FRAME_BYTES).toBe(2 * 1024 * 1024);
  });

  it("鉴权豁免帧仅 AUTH / AUTH_OK / ERROR，业务帧全部要求鉴权", () => {
    for (const entry of FRAME_CATALOG) {
      const exempt = ["AUTH", "AUTH_OK", "ERROR"].includes(entry.type);
      expect(entry.requiresAuth).toBe(!exempt);
    }
  });

  it("方向约束：客户端仅可发 AUTH / PING / CHAT_EVENT", () => {
    const allowed = IPC_FRAME_TYPES.filter((t) => isClientToServerAllowed(t));
    expect([...allowed].sort()).toEqual(["AUTH", "CHAT_EVENT", "PING"].sort());
  });

  it("createFrame 生成 trace_id（UUID）与 ISO timestamp", () => {
    const frame = createFrame("PING");
    expect(frame.trace_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(Number.isNaN(Date.parse(frame.timestamp))).toBe(false);
    expect(frame.type).toBe("PING");
  });

  it("isIpcFrame：未知类型拒绝；trace_id 非字符串拒绝；历史无 trace_id 帧容忍", () => {
    expect(isIpcFrame({ type: "NOPE", timestamp: "t" })).toBe(false);
    expect(isIpcFrame({ type: "PING", timestamp: "t", trace_id: 42 })).toBe(
      false,
    );
    expect(isIpcFrame({ type: "PING", timestamp: "t" })).toBe(true);
    expect(isIpcFrame(null)).toBe(false);
  });

  it("getFrameSpec 对字典内类型返回元数据", () => {
    expect(getFrameSpec("TERMINAL_STREAM").direction).toBe("server->client");
    expect(getFrameSpec("EVIDENCE_STATUS_CHANGED").spec).toBe("v1.2.1");
    expect(getFrameSpec("WORKER_LOG").spec).toBe("extension");
  });

  it("EVIDENCE_STATUS_CHANGED 载荷扩展（C.4 超集向后兼容）：支持工作树与变更文件相对路径列表", () => {
    // 兼容历史旧帧契约（不含扩展字段）
    const legacyPayload: EvidenceStatusChangedPayload = {
      contract_id: "c-1",
      evidence_id: "evi-1",
      status: "STALE",
      reason_code: "EVIDENCE_STALE",
      message: "stale notification",
    };
    expect(legacyPayload.contract_id).toBe("c-1");
    expect(legacyPayload.worktree_path).toBeUndefined();
    expect(legacyPayload.changed_paths).toBeUndefined();

    // 扩展新帧契约（包含 worktree_path 与 changed_paths 列表）
    const extendedPayload: EvidenceStatusChangedPayload = {
      ...legacyPayload,
      worktree_path: "/tmp/repo/worktree-1",
      changed_paths: ["src/a.ts", "src/components/radar/RadarGraph.tsx"],
    };
    expect(extendedPayload.worktree_path).toBe("/tmp/repo/worktree-1");
    expect(extendedPayload.changed_paths).toHaveLength(2);
    expect(extendedPayload.changed_paths?.[0]).toBe("src/a.ts");
  });
});
