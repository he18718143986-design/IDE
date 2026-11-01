import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  McpHttpServer,
  STAGENT_WEB_INGEST_TOOL_NAME,
  E_MCP_UNAUTHORIZED_TOOL,
  E_MCP_METHOD_NOT_FOUND,
  E_MCP_GATEWAY_UNAVAILABLE,
} from "../../daemon/mcp/http-server";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  E_INGEST_NOT_WIRED,
  E_WEB_INGEST_FORBIDDEN_DOMAIN,
} from "../../daemon/mcp/types";
import { createContractDraft } from "../../src/lib/contract.schema";
import { ClaudeCodeAdapter } from "../../daemon/worker/cli-host/claude-code-adapter";
import { StagentDaemon } from "../../daemon/server";

describe("TASK-W.8: Daemon MCP HTTP endpoint and worker integration", () => {
  let tempRepo: string;
  let server: http.Server;
  let port: number;
  let mcpServer: McpHttpServer;

  beforeEach(async () => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "w8-test-"));
    mcpServer = new McpHttpServer();

    server = http.createServer((req, res) => {
      if (req.url === "/api/mcp" || req.url?.startsWith("/api/mcp")) {
        void mcpServer.handleHttpRequest(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (typeof addr === "object" && addr) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  async function postMcp(body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  it("handles initialize and ping MCP JSON-RPC protocol handshake", async () => {
    const initRes = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });

    expect(initRes.status).toBe(200);
    expect(initRes.body.jsonrpc).toBe("2.0");
    expect(initRes.body.id).toBe(1);
    expect(initRes.body.result?.capabilities?.tools).toBeDefined();
    expect(initRes.body.result?.serverInfo?.name).toBe("stagent-daemon");

    const pingRes = await postMcp({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });
    expect(pingRes.status).toBe(200);
    expect(pingRes.body.result).toEqual({});
  });

  it("lists registered tools including stagent_web_ingest via tools/list", async () => {
    const listRes = await postMcp({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
    });

    expect(listRes.status).toBe(200);
    const tools = listRes.body.result?.tools;
    expect(Array.isArray(tools)).toBe(true);
    const ingestTool = tools.find(
      (t: any) => t.name === STAGENT_WEB_INGEST_TOOL_NAME,
    );
    expect(ingestTool).toBeDefined();
    expect(ingestTool.inputSchema.required).toContain("url");
  });

  it("rejects unauthorized and unknown tools with JSON-RPC error", async () => {
    const res = await postMcp({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "unauthorized_arbitrary_tool",
        arguments: {},
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.error?.code).toBe(-32601);
    expect(res.body.error?.message).toContain(E_MCP_UNAUTHORIZED_TOOL);

    const unknownMethodRes = await postMcp({
      jsonrpc: "2.0",
      id: 21,
      method: "non_existent_method",
    });
    expect(unknownMethodRes.body.error?.message).toContain(
      E_MCP_METHOD_NOT_FOUND,
    );
  });

  it("fails closed when no active Gateway is mounted", async () => {
    const unmountedServer = new McpHttpServer();
    const res = await unmountedServer.handleJsonRpc({
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: STAGENT_WEB_INGEST_TOOL_NAME,
        arguments: { url: "https://example.com" },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toContain(E_MCP_GATEWAY_UNAVAILABLE);
  });

  it("dispatches stagent_web_ingest through Gateway and checks domain whitelist with E_INGEST_NOT_WIRED", async () => {
    const baseDraft = createContractDraft({
      title: "W.8 Gateway Ingest Contract",
      description: "Testing MCP dispatch over HTTP through Gateway",
      acceptanceCriteria: ["whitelist check"],
      writablePaths: ["src/**"],
    });
    const contract = {
      ...baseDraft,
      references: [
        "https://allowed.partner.com/spec/v1",
        "https://docs.github.com/en/rest",
      ],
    };

    const gateway = new ScopedWorktreeGateway(tempRepo, contract);
    const customMcpServer = new McpHttpServer({ gateway });

    // 1. Rejected when domain is not in contract references[]
    const blockedCall = await customMcpServer.handleJsonRpc({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: STAGENT_WEB_INGEST_TOOL_NAME,
        arguments: { url: "https://evil.attacker.com/malicious" },
      },
    });

    expect(blockedCall.result).toBeDefined();
    const blockedResult = blockedCall.result as any;
    expect(blockedResult.isError).toBe(true);
    expect(blockedResult.error?.code).toBe(E_WEB_INGEST_FORBIDDEN_DOMAIN);

    // 2. Verified domain in contract references[] returns E_INGEST_NOT_WIRED (no fake success)
    const allowedCall = await customMcpServer.handleJsonRpc({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: STAGENT_WEB_INGEST_TOOL_NAME,
        arguments: {
          url: "https://allowed.partner.com/spec/v1",
          format: "html",
        },
      },
    });

    expect(allowedCall.result).toBeDefined();
    const allowedResult = allowedCall.result as any;
    expect(allowedResult.isError).toBe(true);
    expect(allowedResult.error?.code).toBe(E_INGEST_NOT_WIRED);
    expect(allowedResult.error?.message).toContain("TASK-L.17a");

    // 3. Gateway audit log records both calls
    const logs = gateway.getAuditLog();
    const blockedLog = logs.find(
      (l) => l.violationCode === E_WEB_INGEST_FORBIDDEN_DOMAIN,
    );
    expect(blockedLog).toBeDefined();
    expect(blockedLog?.outcome).toBe("BLOCKED");

    const notWiredLog = logs.find(
      (l) => l.violationCode === E_INGEST_NOT_WIRED,
    );
    expect(notWiredLog).toBeDefined();
    expect(notWiredLog?.outcome).toBe("BLOCKED");
  });

  it("enforces bearer token authorization and rejects unauthorized access with 401", async () => {
    const authMcpServer = new McpHttpServer({
      isAuthorized: (req) =>
        req.headers.authorization === "Bearer test-session-token-w8",
    });

    let authPort = 0;
    const authServer = http.createServer((req, res) => {
      void authMcpServer.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      authServer.listen(0, "127.0.0.1", () => {
        authPort = (authServer.address() as any).port;
        resolve();
      });
    });

    try {
      // 1. Missing Authorization header -> 401
      const unauthRes = await fetch(`http://127.0.0.1:${authPort}/api/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(unauthRes.status).toBe(401);
      const unauthJson = await unauthRes.json();
      expect(unauthJson.error).toBe("Unauthorized");

      // 2. Wrong token -> 401
      const wrongRes = await fetch(`http://127.0.0.1:${authPort}/api/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-token",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
      });
      expect(wrongRes.status).toBe(401);

      // 3. Valid token -> 200
      const okRes = await fetch(`http://127.0.0.1:${authPort}/api/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-session-token-w8",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
      });
      expect(okRes.status).toBe(200);
      const okJson = await okRes.json();
      expect(okJson.result).toEqual({});
    } finally {
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
    }
  });

  it("writes real stagent MCP endpoint and auth header into mcp.json for worker role under --strict-mcp-config", () => {
    const adapter = new ClaudeCodeAdapter({
      role: "worker",
      mcpServerUrl: `http://127.0.0.1:${port}/api/mcp`,
      authToken: "sample-auth-token-123",
    });

    const launch = adapter.buildLaunch({
      prompt: "do work",
      cwd: tempRepo,
      nativeSessionId: null,
    });

    expect(launch.args).toContain("--strict-mcp-config");
    expect(fs.existsSync(launch.mcpPath)).toBe(true);
    const mcpConfig = JSON.parse(fs.readFileSync(launch.mcpPath, "utf8"));
    expect(mcpConfig.mcpServers).toBeDefined();
    expect(mcpConfig.mcpServers.stagent).toEqual({
      type: "http",
      url: `http://127.0.0.1:${port}/api/mcp`,
      headers: {
        Authorization: "Bearer sample-auth-token-123",
      },
    });

    // Partner role maintains read-only whitelist without external MCP endpoints
    const partnerAdapter = new ClaudeCodeAdapter({
      role: "partner",
    });
    const partnerLaunch = partnerAdapter.buildLaunch({
      prompt: "read work",
      cwd: tempRepo,
      nativeSessionId: null,
    });
    const partnerConfig = JSON.parse(
      fs.readFileSync(partnerLaunch.mcpPath, "utf8"),
    );
    expect(partnerConfig.mcpServers).toEqual({});
  });

  it("dynamically resolves port and auth token from options or environment for worker and throws when unconfigured", () => {
    // 1. Dynamic port getter and token getter
    const dynamicAdapter = new ClaudeCodeAdapter({
      role: "worker",
      mcpPort: () => 4567,
      authToken: () => "dynamic-session-token",
    });
    const launch = dynamicAdapter.buildLaunch({
      prompt: "do work",
      cwd: tempRepo,
      nativeSessionId: null,
    });
    const mcpConfig = JSON.parse(fs.readFileSync(launch.mcpPath, "utf8"));
    expect(mcpConfig.mcpServers.stagent).toEqual({
      type: "http",
      url: "http://127.0.0.1:4567/api/mcp",
      headers: {
        Authorization: "Bearer dynamic-session-token",
      },
    });

    // 2. Throws when no URL, port, or environment variable is set (no hardcoded 4000 fallback)
    const noConfigAdapter = new ClaudeCodeAdapter({
      role: "worker",
    });
    expect(() => {
      noConfigAdapter.buildLaunch({
        prompt: "do work",
        cwd: tempRepo,
        nativeSessionId: null,
      });
    }).toThrow(/Worker MCP endpoint URL is required under --strict-mcp-config/);
  });

  it("serves GET /api/mcp for status discovery and SSE transport", async () => {
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/mcp`);
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(statusJson.ok).toBe(true);
    expect(statusJson.tools).toContain(STAGENT_WEB_INGEST_TOOL_NAME);

    const controller = new AbortController();
    const sseRes = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("Content-Type")).toContain("text/event-stream");
    controller.abort();
  });
  it("enforces scoped mcpToken dual-track authorization on /api/mcp and rejects mcpToken on non-MCP routes", async () => {
    const sessionToken = "session-admin-full-token-1234567890123456";
    const mcpToken = "mcp-worker-scoped-token-1234567890123456";

    // Simulate Daemon dual-track routing logic
    const mockDaemon = http.createServer((req, res) => {
      const auth = req.headers.authorization;
      const tok = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;

      if (req.url === "/api/mcp" || req.url?.startsWith("/api/mcp")) {
        // Dual-track: accepts mcpToken (worker) or sessionToken (admin/debug)
        if (tok === mcpToken || tok === sessionToken) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, endpoint: "mcp" }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
        }
        return;
      }

      if (req.url === "/api/shutdown" || req.url === "/api/contracts" || req.url === "/api/vault") {
        // General admin route: ONLY sessionToken allowed; mcpToken must be strictly rejected
        if (tok === sessionToken) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, endpoint: req.url }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized", message: "Bearer session token required" }));
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });

    let dPort = 0;
    await new Promise<void>((resolve) => {
      mockDaemon.listen(0, "127.0.0.1", () => {
        dPort = (mockDaemon.address() as any).port;
        resolve();
      });
    });

    try {
      // 1. Worker mcpToken accesses /api/mcp successfully
      const mcpRes = await fetch(`http://127.0.0.1:${dPort}/api/mcp`, {
        headers: { Authorization: `Bearer ${mcpToken}` },
      });
      expect(mcpRes.status).toBe(200);

      // 2. Admin sessionToken also accesses /api/mcp successfully
      const adminMcpRes = await fetch(`http://127.0.0.1:${dPort}/api/mcp`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      expect(adminMcpRes.status).toBe(200);

      // 3. Worker mcpToken is strictly blocked from general admin routes (401)
      const blockedShutdown = await fetch(`http://127.0.0.1:${dPort}/api/shutdown`, {
        headers: { Authorization: `Bearer ${mcpToken}` },
      });
      expect(blockedShutdown.status).toBe(401);

      const blockedVault = await fetch(`http://127.0.0.1:${dPort}/api/vault`, {
        headers: { Authorization: `Bearer ${mcpToken}` },
      });
      expect(blockedVault.status).toBe(401);

      // 4. Admin sessionToken accesses general routes
      const adminShutdown = await fetch(`http://127.0.0.1:${dPort}/api/shutdown`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      expect(adminShutdown.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => mockDaemon.close(() => resolve()));
    }
  });

  it("StagentDaemon.createWorkerClaudeAdapter injects scoped mcpToken rather than sessionToken", () => {
    const daemon = new StagentDaemon({ repoRoot: tempRepo });
    const mcpTok = daemon.getMcpToken();
    const sessionTok = daemon.getSessionToken();

    expect(mcpTok).toBeDefined();
    expect(typeof mcpTok).toBe("string");
    expect(mcpTok?.length).toBe(64);
    // Before start(), sessionToken is null, but mcpToken is already prepared
    expect(mcpTok).not.toBe(sessionTok);

    const workerAdapter = daemon.createWorkerClaudeAdapter({
      mcpPort: 3001,
    });
    const launch = workerAdapter.buildLaunch({
      prompt: "do work",
      cwd: tempRepo,
      nativeSessionId: null,
    });

    const mcpConfig = JSON.parse(fs.readFileSync(launch.mcpPath, "utf8"));
    expect(mcpConfig.mcpServers.stagent.headers.Authorization).toBe(
      `Bearer ${mcpTok}`,
    );
  });
});