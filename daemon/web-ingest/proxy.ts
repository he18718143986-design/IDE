/**
 * TASK-L.17a: Daemon 受控只读外网代理
 *
 * Spec: ADR-0014 §3; scheme.md goal-2, conf-6, dec-13, oq-3; delivery-lifecycle.md M5
 *
 * 核心职责：
 * 1. 严格只读：仅允许 GET 请求，非 GET 返回 405；
 * 2. 域名白名单：严格比对合同 references[]，白名单外域名返回 403；
 * 3. 响应大小与速率限制：超限返回 413，高频洪水返回 429；
 * 4. 凭据代登与静默重登（dec-13）：读取 Vault 凭据代登并持有 cookie，过期静默重登，Worker 全程无感零账密。
 */

import { AuthSessionManager } from "./auth-session";
import {
  type WebIngestFormat,
  type WebIngestRequest,
  type WebIngestResult,
  type WebIngestSummary,
  E_WEB_INGEST_FORBIDDEN_DOMAIN,
  E_WEB_INGEST_METHOD_NOT_ALLOWED,
  E_WEB_INGEST_PAYLOAD_TOO_LARGE,
  E_WEB_INGEST_RATE_LIMITED,
  E_WEB_INGEST_INVALID_URL,
  E_WEB_INGEST_FETCH_FAILED,
  WebIngestError,
} from "./types";

export interface WebIngestProxyOptions {
  allowedDomains?: string[] | (() => string[]) | undefined;
  maxSizeBytes?: number | undefined; // 缺省 5MB
  rateLimitPerMinute?: number | undefined; // 缺省 60 次/分
  rateBurstLimit?: number | undefined; // 缺省 10 次/秒
  authSessionManager?: AuthSessionManager | undefined;
  fetchFn?: typeof fetch | undefined;
}

export class WebIngestProxy {
  private readonly allowedDomains: string[] | (() => string[]);
  private readonly maxSizeBytes: number;
  private readonly rateLimitPerMinute: number;
  private readonly rateBurstLimit: number;
  private readonly authSessionManager: AuthSessionManager;
  private readonly fetchFn: typeof fetch;

  // 频率计数器：记录各域名请求时间戳
  private readonly requestTimestamps = new Map<string, number[]>();

  constructor(options: WebIngestProxyOptions = {}) {
    this.allowedDomains = options.allowedDomains ?? [];
    this.maxSizeBytes = options.maxSizeBytes ?? 5 * 1024 * 1024; // 5MB
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 60;
    this.rateBurstLimit = options.rateBurstLimit ?? 10;
    this.authSessionManager = options.authSessionManager ?? new AuthSessionManager();
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  getAuthSessionManager(): AuthSessionManager {
    return this.authSessionManager;
  }

  getAllowedDomains(): Set<string> {
    const raw = typeof this.allowedDomains === "function" ? this.allowedDomains() : this.allowedDomains;
    const hosts = new Set<string>();
    for (const item of raw) {
      if (!item) continue;
      try {
        const u = new URL(item.startsWith("http") ? item : `https://${item}`);
        hosts.add(u.hostname.toLowerCase());
      } catch {
        hosts.add(item.toLowerCase().trim());
      }
    }
    return hosts;
  }

  async fetch(request: WebIngestRequest): Promise<WebIngestResult> {
    // 1. 只读限制：仅允许 GET 请求
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new WebIngestError(
        E_WEB_INGEST_METHOD_NOT_ALLOWED,
        `Method '${method}' is not allowed. Only read-only GET requests are permitted by Stagent proxy (ADR-0014 §3).`,
        405,
      );
    }

    // 2. 解析并校验 URL
    let targetUrl: URL;
    try {
      targetUrl = new URL(request.url);
    } catch {
      throw new WebIngestError(
        E_WEB_INGEST_INVALID_URL,
        `Invalid URL format: '${request.url}'`,
        400,
      );
    }

    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      throw new WebIngestError(
        E_WEB_INGEST_INVALID_URL,
        `Protocol '${targetUrl.protocol}' not supported. Only http and https are permitted.`,
        400,
      );
    }

    const allowed = this.getAllowedDomains();
    const maxRedirectHops = 3;
    let currentUrl = targetUrl;
    let res: Response;

    // 重定向与抓取循环：redirect: "manual" 强制逐跳检查白名单，防止 302 旁路绕过
    for (let hop = 0; ; hop++) {
      const host = currentUrl.hostname.toLowerCase();
      if (!allowed.has(host)) {
        throw new WebIngestError(
          E_WEB_INGEST_FORBIDDEN_DOMAIN,
          `Host '${host}' is not in authorized references[] whitelist`,
          403,
          { host, allowedHosts: Array.from(allowed) },
        );
      }

      // 3. 速率限制检查
      this.checkRateLimit(host);

      // 4. 安全过滤外部传入的 headers，禁止 Worker 伪造/注入 Cookie 与 Authorization
      const safeCustomHeaders: Record<string, string> = {};
      if (request.headers) {
        for (const [k, v] of Object.entries(request.headers)) {
          const lower = k.toLowerCase();
          if (lower === "cookie" || lower === "authorization" || lower === "set-cookie") {
            continue;
          }
          safeCustomHeaders[k] = v;
        }
      }

      const headers: Record<string, string> = {
        "User-Agent": "Stagent-Daemon-WebIngest/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...safeCustomHeaders,
      };

      // 5. 携带代登 Session Cookie（Daemon 凭据覆盖，Worker 无法覆盖）
      let cookie = await this.authSessionManager.authenticate(host, {
        fetchFn: this.fetchFn,
      });
      if (cookie) {
        headers["Cookie"] = cookie;
      }

      // 6. 向上游发起抓取请求（redirect: "manual" 禁止底层自动跳转）
      try {
        res = await this.fetchFn(currentUrl.toString(), {
          method: "GET",
          headers,
          redirect: "manual",
        });
      } catch (err: unknown) {
        throw new WebIngestError(
          E_WEB_INGEST_FETCH_FAILED,
          `Failed to reach upstream host '${host}': ${(err as Error).message}`,
          502,
        );
      }

      // 7. dec-13 条款 2：Cookie 过期静默重登
      // 若收到 401/403 且配置了代登凭据，由 Daemon 用 Vault 账密静默重登换取新 Cookie 并重试一次，Worker 全程无感
      if ((res.status === 401 || res.status === 403) && this.authSessionManager.hasAuthConfig(host)) {
        try {
          cookie = await this.authSessionManager.handleSessionExpired(host, this.fetchFn);
          if (cookie) {
            headers["Cookie"] = cookie;
            res = await this.fetchFn(currentUrl.toString(), {
              method: "GET",
              headers,
              redirect: "manual",
            });
          }
        } catch {
          // 重登尝试失败不向 Worker 暴露账密或重登内部细节，按常规上游响应处理
        }
      }

      // 8. 检查 3xx 重定向防线（白名单防旁路）
      if (res.status >= 300 && res.status < 400) {
        const locationHeader = res.headers.get("location");
        if (locationHeader) {
          if (hop >= maxRedirectHops) {
            throw new WebIngestError(
              E_WEB_INGEST_FETCH_FAILED,
              `Too many redirects (exceeded limit of ${maxRedirectHops} hops) from '${host}'`,
              502,
            );
          }
          let redirectTarget: URL;
          try {
            redirectTarget = new URL(locationHeader, currentUrl);
          } catch {
            throw new WebIngestError(
              E_WEB_INGEST_INVALID_URL,
              `Invalid redirect location header '${locationHeader}' from '${host}'`,
              400,
            );
          }

          if (redirectTarget.protocol !== "http:" && redirectTarget.protocol !== "https:") {
            throw new WebIngestError(
              E_WEB_INGEST_INVALID_URL,
              `Redirect protocol '${redirectTarget.protocol}' not supported`,
              400,
            );
          }

          const redirectHost = redirectTarget.hostname.toLowerCase();
          if (!allowed.has(redirectHost)) {
            throw new WebIngestError(
              E_WEB_INGEST_FORBIDDEN_DOMAIN,
              `Redirect target host '${redirectHost}' is not in authorized references[] whitelist`,
              403,
              { host: redirectHost, allowedHosts: Array.from(allowed) },
            );
          }

          currentUrl = redirectTarget;
          continue;
        }
      }

      break;
    }

    // 7. 检查响应大小上限（通过 Content-Length 预检）
    const clHeader = res.headers.get("content-length");
    if (clHeader) {
      const declaredBytes = parseInt(clHeader, 10);
      if (!Number.isNaN(declaredBytes) && declaredBytes > this.maxSizeBytes) {
        throw new WebIngestError(
          E_WEB_INGEST_PAYLOAD_TOO_LARGE,
          `Response payload size (${declaredBytes} bytes) exceeds limit of ${this.maxSizeBytes} bytes`,
          413,
          { size: declaredBytes, limit: this.maxSizeBytes },
        );
      }
    }

    // 读取响应正文
    let rawText: string;
    try {
      rawText = await res.text();
    } catch (err: unknown) {
      throw new WebIngestError(
        E_WEB_INGEST_FETCH_FAILED,
        `Failed to read response body from '${host}': ${(err as Error).message}`,
        502,
      );
    }

    const actualBytes = Buffer.byteLength(rawText, "utf8");
    if (actualBytes > this.maxSizeBytes) {
      throw new WebIngestError(
        E_WEB_INGEST_PAYLOAD_TOO_LARGE,
        `Response payload size (${actualBytes} bytes) exceeds limit of ${this.maxSizeBytes} bytes`,
        413,
        { size: actualBytes, limit: this.maxSizeBytes },
      );
    }

    // 8. 脱敏与格式处理
    const sanitizedHtml = this.authSessionManager.sanitizeForWorker(rawText);
    const format: WebIngestFormat = request.format ?? "html";

    let content: string;
    let summary: WebIngestSummary | undefined;

    if (format === "text") {
      content = stripHtmlTags(sanitizedHtml);
    } else if (format === "summary") {
      summary = extractHtmlSummary(sanitizedHtml);
      content = JSON.stringify(summary, null, 2);
    } else {
      content = sanitizedHtml;
    }

    return {
      url: currentUrl.toString(),
      status: res.status,
      format,
      content,
      summary,
      byteLength: Buffer.byteLength(content, "utf8"),
    };
  }

  private checkRateLimit(host: string): void {
    const now = Date.now();
    let timestamps = this.requestTimestamps.get(host);
    if (!timestamps) {
      timestamps = [];
      this.requestTimestamps.set(host, timestamps);
    }

    // 过滤出过去 60 秒内的请求
    const oneMinuteAgo = now - 60 * 1000;
    timestamps = timestamps.filter((t) => t > oneMinuteAgo);
    this.requestTimestamps.set(host, timestamps);

    // 突发速率检查（过去 1 秒内）
    const oneSecondAgo = now - 1000;
    const burstCount = timestamps.filter((t) => t > oneSecondAgo).length;
    if (burstCount >= this.rateBurstLimit) {
      throw new WebIngestError(
        E_WEB_INGEST_RATE_LIMITED,
        `Burst rate limit exceeded for host '${host}' (${burstCount} requests in 1s; limit ${this.rateBurstLimit}). Back off required.`,
        429,
        { host, burstCount, limit: this.rateBurstLimit },
      );
    }

    // 分钟速率检查
    if (timestamps.length >= this.rateLimitPerMinute) {
      throw new WebIngestError(
        E_WEB_INGEST_RATE_LIMITED,
        `Rate limit exceeded for host '${host}' (${timestamps.length} requests in 60s; limit ${this.rateLimitPerMinute}). Back off required.`,
        429,
        { host, count: timestamps.length, limit: this.rateLimitPerMinute },
      );
    }

    timestamps.push(now);
  }
}

export function extractHtmlSummary(html: string): WebIngestSummary {
  // Title
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripHtmlTags(titleMatch[1]).trim() : undefined;

  // Description
  const metaMatch =
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ||
    /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html);
  const description = metaMatch ? metaMatch[1].trim() : undefined;

  // H1s
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  const h1: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = h1Regex.exec(html)) !== null) {
    const text = stripHtmlTags(match[1]).trim();
    if (text) h1.push(text);
  }

  // Snippet
  const plainText = stripHtmlTags(html).replace(/\s+/g, " ").trim();
  const snippet = plainText.length > 500 ? `${plainText.slice(0, 500)}...` : plainText;

  return {
    title: title || undefined,
    description: description || undefined,
    h1: h1.length > 0 ? h1 : undefined,
    snippet: snippet || undefined,
  };
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
