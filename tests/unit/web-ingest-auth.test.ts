import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Vault, createVault } from "../../daemon/vault/vault";
import {
  AuthSessionManager,
  WebIngestProxy,
} from "../../daemon/web-ingest";

describe("TASK-L.17a: Web Ingest Vault Auth and Worker Redaction", () => {
  let vault: Vault;
  let authManager: AuthSessionManager;

  const mockSecretName = "PARTNER_PORTAL_AUTH";
  const mockSecretValue = JSON.stringify({
    username: "stagent_crawler",
    password: "SuperSecretPassword123!",
  });

  beforeEach(async () => {
    vault = await createVault({ repoRoot: "/tmp", backend: "memory" });
    await vault.setSecret(mockSecretName, mockSecretValue);
    authManager = new AuthSessionManager({ vault });
  });

  it("authenticates using Vault credentials and holds session cookie", async () => {
    let loginCalled = false;
    authManager.registerAuthConfig({
      domain: "secure.partner.com",
      credentialName: mockSecretName,
      loginHandler: async (creds, _fetchFn) => {
        loginCalled = true;
        expect(creds.username).toBe("stagent_crawler");
        expect(creds.password).toBe("SuperSecretPassword123!");
        return {
          cookie: "auth_session=abcdef123456789; Path=/",
          expiresAt: Date.now() + 3600 * 1000,
        };
      },
    });

    // 1. Initial authenticate call performs login
    const cookie = await authManager.authenticate("secure.partner.com");
    expect(loginCalled).toBe(true);
    expect(cookie).toBe("auth_session=abcdef123456789; Path=/");

    // 2. Second authenticate call reuses held session without calling login again
    loginCalled = false;
    const cachedCookie = await authManager.authenticate("secure.partner.com");
    expect(loginCalled).toBe(false);
    expect(cachedCookie).toBe("auth_session=abcdef123456789; Path=/");
  });

  it("ensures zero plaintext credentials, cookies, or secrets leak into Worker output or logs", async () => {
    authManager.registerAuthConfig({
      domain: "secure.partner.com",
      credentialName: mockSecretName,
      loginHandler: async () => ({
        cookie: "session_token_xyz987654321",
        expiresAt: Date.now() + 3600 * 1000,
      }),
    });

    // Upstream returns a body that mistakenly or maliciously includes the session cookie and password
    const leakingHtml = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>Debug info: Cookie is session_token_xyz987654321</p>
          <p>Password was: SuperSecretPassword123!</p>
        </body>
      </html>
    `;

    const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
      // Verify request header had the cookie injected by Daemon
      expect(opts.headers["Cookie"]).toBe("session_token_xyz987654321");
      return new Response(leakingHtml, { status: 200 });
    });

    const proxy = new WebIngestProxy({
      allowedDomains: ["https://secure.partner.com"],
      authSessionManager: authManager,
      fetchFn: mockFetch as any,
    });

    const result = await proxy.fetch({
      url: "https://secure.partner.com/dashboard",
      format: "html",
    });

    // Worker gets response content, which MUST have secrets redacted
    expect(result.content).not.toContain("SuperSecretPassword123!");
    expect(result.content).not.toContain("session_token_xyz987654321");
    expect(result.content).toContain("[REDACTED_SECRET]");
    expect(result.content).toContain("[REDACTED_COOKIE]");

    // Verify sanitizeForWorker also strips Set-Cookie and Cookie lines
    const sanitizedHeaders = authManager.sanitizeForWorker("Set-Cookie: token=123456\r\nCookie: session=abcdef");
    expect(sanitizedHeaders).toContain("Set-Cookie: [REDACTED_COOKIE]");
    expect(sanitizedHeaders).toContain("Cookie: [REDACTED_COOKIE]");
  });

  it("fails securely when required Vault credential is missing", async () => {
    authManager.registerAuthConfig({
      domain: "secure.partner.com",
      credentialName: "NON_EXISTENT_SECRET",
    });

    await expect(
      authManager.authenticate("secure.partner.com"),
    ).rejects.toMatchObject({
      code: "E_WEB_INGEST_AUTH_FAILED",
      status: 401,
    });
  });

  it("fails honestly with E_WEB_INGEST_AUTH_FAILED when loginUrl returns no Set-Cookie or non-2xx status", async () => {
    // 1. Case: loginUrl returns 200 but no Set-Cookie header
    authManager.registerAuthConfig({
      domain: "login-nocookie.partner.com",
      credentialName: mockSecretName,
      loginUrl: "https://login-nocookie.partner.com/api/login",
    });

    const mockFetchNoCookie = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      authManager.authenticate("login-nocookie.partner.com", { fetchFn: mockFetchNoCookie as any }),
    ).rejects.toMatchObject({
      code: "E_WEB_INGEST_AUTH_FAILED",
      status: 401,
    });

    // 2. Case: loginUrl returns 401 Unauthorized
    authManager.registerAuthConfig({
      domain: "login-fail.partner.com",
      credentialName: mockSecretName,
      loginUrl: "https://login-fail.partner.com/api/login",
    });

    const mockFetchFail = vi.fn().mockResolvedValue(
      new Response("Invalid credentials", { status: 401 }),
    );

    await expect(
      authManager.authenticate("login-fail.partner.com", { fetchFn: mockFetchFail as any }),
    ).rejects.toMatchObject({
      code: "E_WEB_INGEST_AUTH_FAILED",
      status: 401,
    });

    // 3. Case: neither loginUrl nor loginHandler configured
    authManager.registerAuthConfig({
      domain: "no-handler.partner.com",
      credentialName: mockSecretName,
    });

    await expect(
      authManager.authenticate("no-handler.partner.com"),
    ).rejects.toMatchObject({
      code: "E_WEB_INGEST_AUTH_FAILED",
      status: 401,
    });
  });
});
