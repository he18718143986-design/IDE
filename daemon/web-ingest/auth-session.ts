/**
 * TASK-L.17a: 凭据代登与会话持有管理器
 *
 * Spec: ADR-0014 §3; scheme.md dec-13, oq-3, conf-6; delivery-lifecycle.md M5
 *
 * dec-13 必须写死条款：
 * 1. 凭据生命周期 = 用户手动删除为止（凭据存入 Vault 直至用户手动删除，不设自动过期，不按项目联动清理）。
 * 2. cookie 过期静默重登的实现归属 = Daemon（代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密）。
 */

import { type Vault, getActiveVault } from "../vault";
import {
  type TargetAuthConfig,
  type StoredSession,
  E_WEB_INGEST_AUTH_FAILED,
  WebIngestError,
} from "./types";

export class AuthSessionManager {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly authConfigs = new Map<string, TargetAuthConfig>();
  private vault: Vault | null;

  constructor(options: { vault?: Vault | null } = {}) {
    this.vault = options.vault ?? null;
  }

  setVault(vault: Vault | null): void {
    this.vault = vault;
  }

  getVault(): Vault | null {
    return this.vault ?? getActiveVault();
  }

  registerAuthConfig(config: TargetAuthConfig): void {
    const norm = this.normalizeDomain(config.domain);
    this.authConfigs.set(norm, { ...config, domain: norm });
  }

  getAuthConfig(domain: string): TargetAuthConfig | undefined {
    return this.authConfigs.get(this.normalizeDomain(domain));
  }

  hasAuthConfig(domain: string): boolean {
    return this.authConfigs.has(this.normalizeDomain(domain));
  }

  getSession(domain: string): StoredSession | null {
    const norm = this.normalizeDomain(domain);
    const session = this.sessions.get(norm);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(norm);
      return null;
    }
    return session;
  }

  /**
   * dec-13 条款 1：凭据生命周期 = 用户手动删除为止。
   * 项目切换、会话结束或 Daemon 内存重启仅重置易失的内存 Session，
   * 绝对不得自动过期或联动删除 Vault 中的账密凭据。
   */
  clearInMemorySessions(): void {
    this.sessions.clear();
  }

  onProjectSwitch(): void {
    // 仅清理内存会话，Vault 凭据保留直至用户手动在 Vault 页面删除
    this.clearInMemorySessions();
  }

  /**
   * 读取 Vault 凭据完成目标站代登，持有 session/cookie。
   * Worker 全程不见账密，仅消费只读页面内容。
   */
  async authenticate(
    domain: string,
    options: {
      forceRelogin?: boolean;
      fetchFn?: typeof fetch;
    } = {},
  ): Promise<string | null> {
    const norm = this.normalizeDomain(domain);
    const config = this.authConfigs.get(norm);
    if (!config) {
      return null;
    }

    if (!options.forceRelogin) {
      const active = this.getSession(norm);
      if (active) return active.cookie;
    }

    const vault = this.getVault();
    if (!vault) {
      throw new WebIngestError(
        E_WEB_INGEST_AUTH_FAILED,
        `Cannot authenticate for domain '${norm}': Vault is unavailable`,
        500,
      );
    }

    let envMap: Record<string, string>;
    try {
      envMap = await vault.resolveEnv([config.credentialName]);
    } catch (err: unknown) {
      throw new WebIngestError(
        E_WEB_INGEST_AUTH_FAILED,
        `Credential '${config.credentialName}' not found in Vault: ${(err as Error).message}`,
        401,
      );
    }

    const rawSecret = envMap[config.credentialName];
    if (!rawSecret) {
      throw new WebIngestError(
        E_WEB_INGEST_AUTH_FAILED,
        `Vault credential '${config.credentialName}' is empty`,
        401,
      );
    }

    let creds: Record<string, string>;
    try {
      creds = JSON.parse(rawSecret);
      if (typeof creds !== "object" || creds === null) {
        creds = { password: rawSecret };
      }
    } catch {
      creds = { password: rawSecret, token: rawSecret };
    }

    const fetchFn = options.fetchFn ?? globalThis.fetch;
    let cookie = "";
    let expiresAt = Date.now() + 3600 * 1000; // 默认 1 小时

    if (config.loginHandler) {
      const res = await config.loginHandler(creds, fetchFn);
      cookie = res.cookie;
      if (res.expiresAt) expiresAt = res.expiresAt;
    } else if (config.loginUrl) {
      const res = await fetchFn(config.loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        cookie = setCookie;
      } else {
        cookie = `session_token=${encodeURIComponent(rawSecret.slice(0, 32))}`;
      }
    } else {
      cookie = `auth_token=${encodeURIComponent(rawSecret)}`;
    }

    this.sessions.set(norm, {
      domain: norm,
      cookie,
      expiresAt,
    });

    return cookie;
  }

  /**
   * dec-13 条款 2：cookie 过期静默重登。
   * 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、零账密。
   */
  async handleSessionExpired(
    domain: string,
    fetchFn?: typeof fetch,
  ): Promise<string | null> {
    const norm = this.normalizeDomain(domain);
    this.sessions.delete(norm);
    return this.authenticate(norm, { forceRelogin: true, fetchFn });
  }

  /**
   * 向 Worker 暴露结果前的脱敏防线：
   * 确保 Worker 收到的 MCP 结果、进程环境及日志中零账密明文、零内部 cookie。
   */
  sanitizeForWorker(text: string): string {
    if (!text) return text;
    let sanitized = text;

    // 1. 脱敏 Vault 中的全部活跃秘密值（含 JSON 字段内的具体账密）
    const vault = this.getVault();
    if (vault) {
      const secrets = vault.currentValues();
      for (const secret of secrets) {
        if (!secret) continue;
        if (secret.length >= 6) {
          sanitized = sanitized.replaceAll(secret, "[REDACTED_SECRET]");
        }
        try {
          const parsed = JSON.parse(secret);
          if (typeof parsed === "object" && parsed !== null) {
            for (const val of Object.values(parsed)) {
              if (typeof val === "string" && val.length >= 4) {
                sanitized = sanitized.replaceAll(val, "[REDACTED_SECRET]");
              }
            }
          }
        } catch {
          // 非 JSON，直接匹配整串
        }
      }
    }

    // 2. 脱敏当前持有的活跃 Session Cookie
    for (const session of this.sessions.values()) {
      if (session.cookie && session.cookie.length >= 6) {
        sanitized = sanitized.replaceAll(session.cookie, "[REDACTED_COOKIE]");
      }
    }

    // 3. 擦除 Set-Cookie / Cookie 字符串
    sanitized = sanitized.replace(/Set-Cookie:[^\r\n]+/gi, "Set-Cookie: [REDACTED_COOKIE]");
    sanitized = sanitized.replace(/Cookie:[^\r\n]+/gi, "Cookie: [REDACTED_COOKIE]");

    return sanitized;
  }

  private normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}
