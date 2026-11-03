import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { WS_CLOSE_UNAUTHORIZED } from "../../src/lib/ipc/frames";
import type { IpcFrame } from "../../src/lib/ipc/frames";
import { StagentIpcClient } from "../../src/lib/ipc/client";

/**
 * WebSocket 鉴权专项（协议 v1.1：连接后第一帧 AUTH）。
 * 背景：浏览器原生 WebSocket 无法设置 Authorization 头，query 传 Token
 * 会泄漏进日志；统一为第一帧 AUTH + 失败 4401 断开。
 */

/**
 * 鉴权预算是两回事，不能共用一个值：
 * - 成功路径只要求「别误伤」——8 fork 抢 CPU 时 400ms 会把 AUTH 帧的处理拖过
 *   预算，服务端按配置先行 4401，合法 Token 也拿不到 AUTH_OK；
 * - 超时用例要「等满」，预算长了就把单文件拖成十几秒。
 * 所以 beforeEach 起宽预算的 daemon，超时用例自行切到短预算。
 */
const AUTH_TIMEOUT_MS = 8_000;
const TIMEOUT_CASE_MS = 400;

function openRaw(
  port: number,
  url = `ws://127.0.0.1:${port}/ws`,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => {
      reject(new Error(`HTTP ${res.statusCode}`));
    });
  });
}

function sendAuth(ws: WebSocket, token: string): void {
  ws.send(
    JSON.stringify({
      type: "AUTH",
      payload: { token },
      timestamp: new Date().toISOString(),
    }),
  );
}

function nextFrame(ws: WebSocket, timeoutMs = 2_000): Promise<IpcFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("timeout waiting for frame"));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(JSON.parse(raw.toString()) as IpcFrame);
    };
    ws.on("message", onMessage);
  });
}

/**
 * 等某一**类**帧，忽略期间到达的无关帧。
 *
 * 连上来的客户端会同时收到全局广播（`BASELINE_PROGRESS` / `TASK_GRAPH_UPDATED`
 * 等），它们跟 PING/PONG 毫无关系，却完全可能插在两帧之间。
 * 「我发的下一个请求，下一帧就必须是它的响应」是把调度顺序当协议契约——
 * 在更慢或更忙的机器（CI 的 macOS runner）上必然偶发。
 */
function nextFrameOfType(
  ws: WebSocket,
  type: IpcFrame["type"],
  timeoutMs = 2_000,
): Promise<IpcFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timeout waiting for frame ${type}`));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as IpcFrame;
      if (frame.type !== type) return; // 无关广播：跳过，继续等
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(frame);
    };
    ws.on("message", onMessage);
  });
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code) => resolve(code));
  });
}

describe("WebSocket 第一帧 AUTH 鉴权（协议 v1.1）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let token: string;
  let port: number;

  const PORT_RANGE = { startPort: 4408, endPort: 4418 } as const;

  /**
   * 起（或重起）daemon。超时预算按用例需要切换：
   * 成功路径用宽预算（它只要求「别误伤」），超时用例用短预算（它要等满）。
   * 两者共用一个值就会互相拆台——短了成功路径被 4401，长了超时用例要等很久。
   */
  async function startDaemon(authTimeoutMs: number): Promise<void> {
    if (daemon?.isRunning) await daemon.stop();
    daemon = createDaemon({
      repoRoot: repo,
      ...PORT_RANGE,
      enableCrashRecovery: false,
      authTimeoutMs,
    });
    const info = await daemon.start();
    port = info.port;
    token = daemon.getSessionToken() ?? "";
  }

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ws-auth-"));
    await startDaemon(AUTH_TIMEOUT_MS);
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  it("合法 Token 的首帧 AUTH：收到 AUTH_OK，随后 PING/PONG 正常", async () => {
    const ws = await openRaw(port);
    try {
      sendAuth(ws, token);
      const ack = await nextFrame(ws);
      expect(ack.type).toBe("AUTH_OK");

      ws.send(
        JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
      );
      // 不要求 PONG 是紧邻的下一帧：期间可能夹着服务端广播
      const pong = await nextFrameOfType(ws, "PONG");
      expect(pong.type).toBe("PONG");
      expect(daemon?.getClientCount()).toBe(1);
    } finally {
      ws.close();
    }
  });

  it("非法 Token：收到 E_UNAUTHORIZED 错误帧并以 4401 断开", async () => {
    const ws = await openRaw(port);
    sendAuth(ws, "0".repeat(64));
    const frame = await nextFrame(ws);
    expect(frame.type).toBe("ERROR");
    expect((frame.payload as { code: string }).code).toBe("E_UNAUTHORIZED");
    const code = await waitClose(ws);
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("首帧不是 AUTH（直接 PING）：立即以 4401 断开", async () => {
    const ws = await openRaw(port);
    ws.send(
      JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
    );
    const code = await waitClose(ws);
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("完全不发帧：AUTH 超时后以 4401 断开", async () => {
    await startDaemon(TIMEOUT_CASE_MS);
    // 计时起点在发起连接之前：服务端的 authTimeout 只在连接建立后起算，
    // 这个下界不受握手/调度延迟影响（延迟只会让它更长）。
    const startedAt = performance.now();
    const ws = await openRaw(port);
    const code = await waitClose(ws);
    const elapsed = performance.now() - startedAt;
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_CASE_MS * 0.9);
  });

  it("URL query 携带正确 Token 但不做 AUTH：不再豁免，超时 4401", async () => {
    await startDaemon(TIMEOUT_CASE_MS);
    const ws = await openRaw(
      port,
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`,
    );
    const code = await waitClose(ws);
    expect(code).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it("未鉴权连接收不到广播帧", async () => {
    const ws = await openRaw(port);
    try {
      await new Promise((r) => setTimeout(r, 50));
      const sent = daemon?.broadcast("CONTRACT_UPDATE", {
        contract_id: "c1",
        lifecycle_state: "EXECUTING",
      });
      expect(sent).toBe(0);
    } finally {
      ws.close();
    }
  });

  it("StagentIpcClient 合法 Token 完整握手并收发 PING/PONG", async () => {
    const statuses: string[] = [];
    const client = new StagentIpcClient({
      port,
      token,
      websocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      onStatusChange: (s) => statuses.push(s),
    });
    client.connect();
    await new Promise<void>((resolve, reject) => {
      // 等待预算而非延迟断言：8 fork 并发下客户端进程会被整段饿死，
      // 2s 会把「连得晚」误判成「连不上」。
      const timer = setTimeout(
        () => reject(new Error("connect timeout")),
        8_000,
      );
      client.onStatusChange((s) => {
        if (s === "connected") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(statuses).toContain("connected");
    expect(client.send("PING")).toBe(true);
    client.close();
    expect(client.currentStatus).toBe("closed");
  });

  it("StagentIpcClient 非法 Token：收到 4401 后进入 closed 且不再重连", async () => {
    const client = new StagentIpcClient({
      port,
      token: "f".repeat(64),
      websocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    client.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("expected closed status")),
        8_000,
      );
      client.onStatusChange((s) => {
        if (s === "closed") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(client.currentStatus).toBe("closed");
    // 4401 不应触发指数退避重连：等待 2 个退避周期确认无新连接
    await new Promise((r) => setTimeout(r, 300));
    expect(daemon?.getClientCount()).toBe(0);
  });
});
