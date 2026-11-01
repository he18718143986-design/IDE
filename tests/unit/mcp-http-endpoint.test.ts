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
} from "../../daemon/mcp/http-server";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { createContractDraft } from "../../src/lib/contract.schema";
import { ClaudeCodeAdapter } from "../../daemon/worker/cli-host/claude-code-adapter";

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

  it("dispatches stagent_web_ingest through Gateway and checks domain whitelist", async () => {
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
    expect(blockedResult.error?.code).toBe("E_WEB_INGEST_FORBIDDEN_DOMAIN");

    // 2. Allowed when domain is in contract references[]
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
    expect(allowedResult.isError).toBe(false);
    expect(allowedResult.data?.host).toBe("allowed.partner.com");

    // 3. Gateway audit log records both calls
    const logs = gateway.getAuditLog();
    const blockedLog = logs.find(
      (l) => l.violationCode === "E_WEB_INGEST_FORBIDDEN_DOMAIN",
    );
    expect(blockedLog).toBeDefined();
    expect(blockedLog?.outcome).toBe("BLOCKED");

    const successLog = logs.find(
      (l) => l.tool === STAGENT_WEB_INGEST_TOOL_NAME && l.outcome === "SUCCESS",
    );
    expect(successLog).toBeDefined();
  });

  it("writes real stagent MCP endpoint into mcp.json for worker role under --strict-mcp-config", () => {
    const adapter = new ClaudeCodeAdapter({
      role: "worker",
      mcpServerUrl: `http://127.0.0.1:${port}/api/mcp`,
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

  it("throws explicitly instead of silently downgrading to empty mcpServers when worker endpoint is missing/empty", () => {
    const invalidAdapter = new ClaudeCodeAdapter({
      role: "worker",
      mcpServerUrl: "   ", // whitespace only / empty
    });

    expect(() => {
      invalidAdapter.buildLaunch({
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
});
