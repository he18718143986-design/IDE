import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  MAX_FRAME_BYTES,
  WS_CLOSE_UNAUTHORIZED,
} from "../../src/lib/ipc/frames";
import type { IpcFrame } from "../../src/lib/ipc/frames";

/**
 * TASK-D.1 G-12/G-13 安全边界集成测试（真实 Daemon + 真实 WS）：
 * Origin 拒绝、Host 头校验（DNS Rebinding）、2MB 帧上限、
 * 连接速率限制、URL query Token 禁令、帧方向门禁。
 */

interface RawOpenOptions {
  headers?: Record<string, string>;
  path?: string;
}

function openRaw(
  port: number,
  options: RawOpenOptions = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}${options.path ?? "/ws"}`,
      options.headers ? { headers: options.headers } : undefined,
    );
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
      if (frame.type !== type) return; // 忽略无关全局广播（如 BASELINE_PROGRESS）
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(frame);
    };
    ws.on("message", onMessage);
  });
}

async function openAuthed(port: number, token: string): Promise<WebSocket> {
  const ws = await openRaw(port);
  sendAuth(ws, token);
  const ack = await nextFrame(ws);
  expect(ack.type).toBe("AUTH_OK");
  return ws;
}

describe("TASK-D.1 WebSocket 安全边界", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let token: string;
  let port: number;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ws-sec-"));
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3771,
      endPort: 3780,
      enableCrashRecovery: false,
      authTimeoutMs: 5_000,
    });
    const info = await daemon.start();
    port = info.port;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  it("PASS-2 非法 Origin：Upgrade 阶段直接 403 拒绝", async () => {
    await expect(
      openRaw(port, { headers: { Origin: "http://evil.example.com" } }),
    ).rejects.toThrow("HTTP 403");
    expect(daemon?.getClientCount()).toBe(0);
  });

  it("PASS-2 合法 Origin（127.0.0.1 / localhost 任意端口）：放行", async () => {
    const ws1 = await openRaw(port, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    const ws2 = await openRaw(port, {
      headers: { Origin: "http://localhost:3001" },
    });
    expect(daemon?.getClientCount()).toBe(2);
    ws1.close();
    ws2.close();
  });

  it("Host 头伪造（DNS Rebinding 模拟）：403 拒绝", async () => {
    await expect(
      openRaw(port, { headers: { Host: "evil.example.com" } }),
    ).rejects.toThrow("HTTP 403");
  });

  it("G-12 超大帧（>2MB）：服务端以 1009 关闭连接", async () => {
    const ws = await openAuthed(port, token);
    const oversized = JSON.stringify({
      type: "PING",
      timestamp: new Date().toISOString(),
      payload: { pad: "x".repeat(MAX_FRAME_BYTES) },
    });
    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
      ws.send(oversized);
    });
    expect(code).toBe(1009);
  });

  it("鉴权后伪造 server->client 帧（PONG）：ERROR 拒绝且连接保持", async () => {
    const ws = await openAuthed(port, token);
    try {
      ws.send(
        JSON.stringify({ type: "PONG", timestamp: new Date().toISOString() }),
      );
      const errFrame = await nextFrameOfType(ws, "ERROR");
      expect(errFrame.type).toBe("ERROR");
      expect((errFrame.payload as { code: string }).code).toBe(
        "FRAME_DIRECTION_FORBIDDEN",
      );
      // 连接保持可用：PING 仍得到 PONG
      ws.send(
        JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }),
      );
      const pong = await nextFrameOfType(ws, "PONG");
      expect(pong.type).toBe("PONG");
    } finally {
      ws.close();
    }
  });

  it("HTTP API 不再接受 ?token= query（规范 FAIL 项）", async () => {
    const viaQuery = await fetch(
      `http://127.0.0.1:${port}/api/contracts?token=${encodeURIComponent(token)}`,
    );
    expect(viaQuery.status).toBe(401);

    const viaBearer = await fetch(`http://127.0.0.1:${port}/api/contracts`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaBearer.status).toBe(200);
  });

  it("HTTP API Host 头伪造：403 拒绝", async () => {
    // undici fetch 禁止覆盖 Host（forbidden header），改用原生 http.request
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/status",
          method: "GET",
          headers: { Host: "evil.example.com" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.once("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe("TASK-D.1 连接速率限制（G-12 防 DoS）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let port: number;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ws-rate-"));
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3781,
      endPort: 3790,
      enableCrashRecovery: false,
      authTimeoutMs: 5_000,
      // 测试用小窗口：窗口 60s 内最多 3 个新连接
      maxConnectionsPerWindow: 3,
      connectionWindowMs: 60_000,
    });
    const info = await daemon.start();
    port = info.port;
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  it("窗口内第 4 个连接被 429 拒绝", async () => {
    const opened: WebSocket[] = [];
    try {
      for (let i = 0; i < 3; i += 1) {
        opened.push(await openRaw(port));
      }
      await expect(openRaw(port)).rejects.toThrow("HTTP 429");
    } finally {
      for (const ws of opened) ws.close();
    }
  });
});

describe("TASK-D.1 默认端口范围", () => {
  it("缺省配置在 3001~3010 内分配端口", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ws-port-"));
    const daemon = createDaemon({ repoRoot: repo, enableCrashRecovery: false });
    try {
      const info = await daemon.start();
      expect(info.port).toBeGreaterThanOrEqual(3001);
      expect(info.port).toBeLessThanOrEqual(3010);
    } finally {
      if (daemon.isRunning) await daemon.stop();
      safeRmSync(repo);
    }
  });
});
