/**
 * TASK-L.17a: 受控只读外网摄取与代登代理类型定义
 * Spec: ADR-0014 §3; scheme.md goal-2, conf-6, dec-13, oq-3; delivery-lifecycle.md M5
 */

export const E_WEB_INGEST_FORBIDDEN_DOMAIN = "E_WEB_INGEST_FORBIDDEN_DOMAIN" as const;
export const E_WEB_INGEST_METHOD_NOT_ALLOWED = "E_WEB_INGEST_METHOD_NOT_ALLOWED" as const;
export const E_WEB_INGEST_PAYLOAD_TOO_LARGE = "E_WEB_INGEST_PAYLOAD_TOO_LARGE" as const;
export const E_WEB_INGEST_RATE_LIMITED = "E_WEB_INGEST_RATE_LIMITED" as const;
export const E_WEB_INGEST_AUTH_FAILED = "E_WEB_INGEST_AUTH_FAILED" as const;
export const E_WEB_INGEST_FETCH_FAILED = "E_WEB_INGEST_FETCH_FAILED" as const;
export const E_WEB_INGEST_INVALID_URL = "E_WEB_INGEST_INVALID_URL" as const;

export type WebIngestFormat = "html" | "text" | "summary";

export interface WebIngestRequest {
  url: string;
  format?: WebIngestFormat | undefined;
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
}

export interface WebIngestSummary {
  title?: string | undefined;
  description?: string | undefined;
  h1?: string[] | undefined;
  snippet?: string | undefined;
}

export interface WebIngestResult {
  url: string;
  status: number;
  format: WebIngestFormat;
  content: string;
  summary?: WebIngestSummary | undefined;
  byteLength: number;
}

export class WebIngestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "WebIngestError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface TargetAuthConfig {
  domain: string;
  credentialName: string;
  loginUrl?: string | undefined;
  loginHandler?: (
    credentials: Record<string, string>,
    fetchFn: typeof fetch,
  ) => Promise<{ cookie: string; expiresAt?: number | undefined }>;
}

export interface StoredSession {
  domain: string;
  cookie: string;
  expiresAt: number;
}
