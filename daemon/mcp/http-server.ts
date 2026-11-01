import type http from "node:http";
import {
  StagentWebIngestSchema,
  type MCPToolCallResult,
  type MCPToolDefinition,
} from "./types";
import type { ScopedWorktreeGateway } from "./gateway";

/**
 * TASK-W.8: Daemon MCP HTTP Endpoint and Dispatcher
 *
 * Exposes managed MCP tools over HTTP/SSE for Workers running under --strict-mcp-config.
 * Reuses ScopedWorktreeGateway authority, input validation, and budget/audit enforcement.
 * Default registration strictly limited to `stagent_web_ingest` (L.17a ingest tool).
 */

export const E_MCP_UNAUTHORIZED_TOOL = "E_MCP_UNAUTHORIZED_TOOL";
export const E_MCP_METHOD_NOT_FOUND = "E_MCP_METHOD_NOT_FOUND";
export const E_MCP_INVALID_REQUEST = "E_MCP_INVALID_REQUEST";
export const E_MCP_GATEWAY_UNAVAILABLE = "E_MCP_GATEWAY_UNAVAILABLE";

export const STAGENT_WEB_INGEST_TOOL_NAME = "stagent_web_ingest";

export const STAGENT_WEB_INGEST_DEFINITION: MCPToolDefinition = {
  name: STAGENT_WEB_INGEST_TOOL_NAME,
  description:
    "Fetch read-only content (HTML/DOM/summary) from an allowed reference URL through Stagent Daemon proxy. Target domain must match references[] in contract/scheme whitelist.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Target HTTP/HTTPS URL to ingest; domain must be in references whitelist",
      },
      format: {
        type: "string",
        enum: ["html", "text", "summary"],
        description: "Format of content to return (default: html)",
      },
    },
    required: ["url"],
  },
};

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpHttpServerOptions {
  gateway?: ScopedWorktreeGateway | (() => ScopedWorktreeGateway | undefined);
  allowedTools?: string[];
  isAuthorized?: ((req: http.IncomingMessage) => boolean) | undefined;
}

export class McpHttpServer {
  private getGateway: () => ScopedWorktreeGateway | undefined;
  private readonly allowedTools: Set<string>;
  private readonly isAuthorized?: ((req: http.IncomingMessage) => boolean) | undefined;

  constructor(options: McpHttpServerOptions = {}) {
    if (typeof options.gateway === "function") {
      this.getGateway = options.gateway;
    } else {
      const gw = options.gateway;
      this.getGateway = () => gw;
    }
    this.allowedTools = new Set(
      options.allowedTools ?? [STAGENT_WEB_INGEST_TOOL_NAME],
    );
    this.isAuthorized = options.isAuthorized;
  }

  public setGateway(
    gateway:
      | ScopedWorktreeGateway
      | (() => ScopedWorktreeGateway | undefined)
      | undefined,
  ): void {
    if (typeof gateway === "function") {
      this.getGateway = gateway;
    } else {
      this.getGateway = () => gateway;
    }
  }

  public getRegisteredTools(): MCPToolDefinition[] {
    const list: MCPToolDefinition[] = [];
    if (this.allowedTools.has(STAGENT_WEB_INGEST_TOOL_NAME)) {
      list.push(STAGENT_WEB_INGEST_DEFINITION);
    }
    return list;
  }

  public async handleJsonRpc(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = request.id ?? null;

    if (!request.method || typeof request.method !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32600,
          message: "Invalid Request: method is required",
        },
      };
    }

    switch (request.method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "stagent-daemon",
              version: "1.0.0",
            },
          },
        };
      }

      case "notifications/initialized":
      case "initialized": {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }

      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }

      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: this.getRegisteredTools(),
          },
        };
      }

      case "tools/call": {
        const params = (request.params ?? {}) as {
          name?: string;
          arguments?: unknown;
        };
        const toolName = params.name;

        if (!toolName || typeof toolName !== "string") {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Invalid params: name is required",
            },
          };
        }

        // TASK-W.8: strict tool registration boundary
        if (!this.allowedTools.has(toolName)) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `[${E_MCP_UNAUTHORIZED_TOOL}] Tool '${toolName}' is not registered or unauthorized`,
            },
          };
        }

        // Dispatch through Gateway (must fail-closed if no active gateway is mounted)
        const gateway = this.getGateway();
        if (!gateway) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32603,
              message: `[${E_MCP_GATEWAY_UNAVAILABLE}] No active Worktree Gateway mounted to execute tool '${toolName}'`,
            },
          };
        }

        const callResult: MCPToolCallResult = await gateway.callTool(
          toolName,
          params.arguments ?? {},
        );
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: callResult.content,
            isError: callResult.isError ?? false,
            data: callResult.data,
            error: callResult.error,
          },
        };
      }

      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `[${E_MCP_METHOD_NOT_FOUND}] Method '${request.method}' not found`,
          },
        };
      }
    }
  }

  public async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin ?? "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    if (this.isAuthorized && !this.isAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Unauthorized",
          message: "Bearer session token required",
        }),
      );
      return;
    }

    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (req.headers.origin) {
      corsHeaders["Access-Control-Allow-Origin"] = req.headers.origin;
      corsHeaders["Vary"] = "Origin";
    }

    if (method === "GET") {
      const accept = req.headers.accept ?? "";
      if (accept.includes("text/event-stream")) {
        // SSE transport
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...corsHeaders,
        });
        res.write(`event: endpoint\ndata: /api/mcp\n\n`);
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        ...corsHeaders,
      });
      res.end(
        JSON.stringify({
          ok: true,
          server: "stagent-daemon",
          endpoint: "/api/mcp",
          tools: Array.from(this.allowedTools),
        }),
      );
      return;
    }

    if (method === "POST") {
      let body = "";
      const limit = 2 * 1024 * 1024; // 2 MiB limit
      let exceeded = false;
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf-8");
        if (body.length > limit) {
          exceeded = true;
          res.writeHead(413, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32600,
                message: "Payload Too Large: request body exceeds 2 MiB limit",
              },
            }),
          );
          req.destroy();
        }
      });
      req.on("end", async () => {
        if (exceeded) return;
        try {
          const json = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[];
          if (Array.isArray(json)) {
            const results = await Promise.all(
              json.map((item) => this.handleJsonRpc(item)),
            );
            res.writeHead(200, {
              "Content-Type": "application/json",
              ...corsHeaders,
            });
            res.end(JSON.stringify(results));
            return;
          }

          const response = await this.handleJsonRpc(json);
          res.writeHead(200, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(JSON.stringify(response));
        } catch (err) {
          res.writeHead(400, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32700,
                message: `Parse error: ${(err as Error).message}`,
              },
            }),
          );
        }
      });
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }
}
