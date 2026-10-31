import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { RealPlaytestStatusPayload } from "../../../src/lib/ipc/frames";
import { findAvailablePort } from "../../core/port-finder";
import {
  MAX_REAL_PREVIEW_FILE_BYTES,
  REAL_PREVIEW_ENTRY,
  REAL_PREVIEW_PORT_RANGE,
  type RealPreviewHandle,
} from "./types";

/**
 * TASK-S.6b / L.5：真机预览服务（静态根目录或外链挂载）。
 *
 * - 自建模式：在 127.0.0.1:4200–4210 起只读静态服务（常用于桩页面 / dist）；
 * - 外链模式：不启进程，只登记已有回环 URL。TASK-L.5 的 `app-runner` 在
 *   Worktree 里拉起 `dev`/`start`/`preview` 并探活成功后，即以本模式登记 URL，
 *   `RealPlaytestPane` 协议不变。
 *
 * 与 Demo 的差异：CSP 允许 connect-src 'self'（真机页面常需打自己的 API）；
 * 仍只绑回环、禁路径逃逸、禁非 GET/HEAD。
 */

export const REAL_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export interface RealPreviewServerOptions {
  readonly contractId: string;
  /** 静态根；缺省且未给 url 时，由调用方先写好桩目录再传入 */
  readonly rootDir?: string | undefined;
  /** 外链挂载（必须是回环 http(s)） */
  readonly attachUrl?: string | undefined;
  readonly host?: string | undefined;
  readonly startPort?: number | undefined;
  readonly endPort?: number | undefined;
  readonly onStatusChange?:
    ((payload: RealPlaytestStatusPayload) => void) | undefined;
}

export interface RealPreviewServer {
  start(): Promise<RealPreviewHandle>;
  stop(): Promise<void>;
  readonly handle: RealPreviewHandle | null;
}

function contentTypeFor(filePath: string): string {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

function applySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader("Content-Security-Policy", REAL_PREVIEW_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function resolveRequestPath(
  rootDir: string,
  requestUrl: string,
): { ok: true; filePath: string } | { ok: false; status: number } {
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(requestUrl, "http://127.0.0.1").pathname,
    );
  } catch {
    return { ok: false, status: 400 };
  }
  if (pathname.includes("\0")) return { ok: false, status: 400 };
  const rel =
    pathname === "/" ? REAL_PREVIEW_ENTRY : pathname.replace(/^\//, "");
  const abs = path.resolve(rootDir, rel);
  const rootResolved = path.resolve(rootDir);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, filePath: abs };
}

function assertLoopbackHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[E_REAL_PREVIEW_BAD_URL] 非法 URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`[E_REAL_PREVIEW_BAD_URL] 仅支持 http(s): ${raw}`);
  }
  const host = url.hostname;
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "::1" &&
    host !== "[::1]"
  ) {
    throw new Error(
      `[E_REAL_PREVIEW_BAD_URL] 真机预览只允许回环地址，收到 ${host}`,
    );
  }
  return url;
}

function emit(
  options: RealPreviewServerOptions,
  partial: Omit<RealPlaytestStatusPayload, "updated_at">,
): void {
  options.onStatusChange?.({
    ...partial,
    updated_at: new Date().toISOString(),
  });
}

/**
 * 写入非技术用户可见的真机试玩桩页（无业务仓库时的产品壳）。
 */
export function writeRealPlaytestStub(rootDir: string, title: string): void {
  fs.mkdirSync(rootDir, { recursive: true });
  const safeTitle = title.trim() || "真机试玩";
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} · 真机预览</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    main { max-width: 40rem; margin: 3rem auto; padding: 1.5rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
    p { line-height: 1.6; color: #94a3b8; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px;
      background: #065f46; color: #a7f3d0; font-size: 0.75rem; margin-bottom: 1rem; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; border-radius: 0.5rem;
      border: 1px solid #34d399; background: #064e3b; color: #a7f3d0; cursor: pointer; }
    button:active { transform: scale(0.98); }
    #out { margin-top: 1rem; color: #6ee7b7; min-height: 1.5rem; }
  </style>
</head>
<body>
  <main>
    <div class="badge">真机预览（非 Demo 假页）</div>
    <h1>${safeTitle}</h1>
    <p>这是真实预览端口上的页面。你可以点击下方按钮确认交互可用；满意后再去合入。</p>
    <button type="button" id="ping">点我试一下</button>
    <div id="out" aria-live="polite"></div>
  </main>
  <script>
    document.getElementById('ping').addEventListener('click', function () {
      document.getElementById('out').textContent = '交互正常 · ' + new Date().toLocaleTimeString();
    });
  </script>
</body>
</html>
`;
  fs.writeFileSync(path.join(rootDir, REAL_PREVIEW_ENTRY), html, "utf8");
}

export function createRealPreviewServer(
  options: RealPreviewServerOptions,
): RealPreviewServer {
  const host = options.host ?? "127.0.0.1";
  const startPort = options.startPort ?? REAL_PREVIEW_PORT_RANGE.start;
  const endPort = options.endPort ?? REAL_PREVIEW_PORT_RANGE.end;
  let server: http.Server | null = null;
  let handle: RealPreviewHandle | null = null;

  return {
    get handle() {
      return handle;
    },
    async start(): Promise<RealPreviewHandle> {
      if (handle) return handle;

      if (options.attachUrl) {
        const url = assertLoopbackHttpUrl(options.attachUrl);
        const port =
          url.port === ""
            ? url.protocol === "https:"
              ? 443
              : 80
            : Number(url.port);
        handle = {
          url: url.toString(),
          port,
          contract_id: options.contractId,
          owned: false,
        };
        emit(options, {
          contract_id: options.contractId,
          url: handle.url,
          port: handle.port,
          status: "RUNNING",
          owned: false,
        });
        return handle;
      }

      const rootDir = options.rootDir;
      if (!rootDir) {
        throw new Error(
          "[E_REAL_PREVIEW_NO_ROOT] 自建真机预览需要 rootDir 或 attachUrl",
        );
      }
      if (!fs.existsSync(rootDir)) {
        throw new Error(`[E_REAL_PREVIEW_NO_ROOT] 目录不存在: ${rootDir}`);
      }

      let port: number;
      try {
        port = await findAvailablePort({ host, startPort, endPort });
      } catch (err) {
        const message = `[E_REAL_PREVIEW_UNAVAILABLE] no available port in ${startPort}-${endPort}: ${
          err instanceof Error ? err.message : "range exhausted"
        }`;
        emit(options, {
          contract_id: options.contractId,
          url: "",
          port: 0,
          status: "ERROR",
          owned: true,
          message,
        });
        throw new Error(message);
      }

      server = http.createServer((req, res) => {
        applySecurityHeaders(res);
        const method = req.method ?? "GET";
        if (method !== "GET" && method !== "HEAD") {
          res.writeHead(405);
          res.end();
          return;
        }
        const resolved = resolveRequestPath(rootDir, req.url ?? "/");
        if (!resolved.ok) {
          res.writeHead(resolved.status);
          res.end();
          return;
        }
        let filePath = resolved.filePath;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, REAL_PREVIEW_ENTRY);
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_REAL_PREVIEW_FILE_BYTES) {
          res.writeHead(413);
          res.end("Payload Too Large");
          return;
        }
        res.setHeader("Content-Type", contentTypeFor(filePath));
        if (method === "HEAD") {
          res.writeHead(200);
          res.end();
          return;
        }
        fs.createReadStream(filePath).pipe(res);
      });

      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(port, host, () => resolve());
      });

      const url = `http://${host}:${port}/`;
      handle = {
        url,
        port,
        contract_id: options.contractId,
        owned: true,
      };
      emit(options, {
        contract_id: options.contractId,
        url,
        port,
        status: "RUNNING",
        owned: true,
      });
      return handle;
    },
    async stop(): Promise<void> {
      const previous = handle;
      handle = null;
      const closing = server;
      server = null;
      if (closing) {
        await new Promise<void>((resolve) => {
          closing.close(() => resolve());
        });
      }
      if (previous) {
        emit(options, {
          contract_id: options.contractId,
          url: previous.url,
          port: previous.port,
          status: "STOPPED",
          owned: previous.owned,
        });
      }
    },
  };
}
