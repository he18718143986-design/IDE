import { describe, it, expect, vi } from "vitest";
import { createVault } from "../../daemon/vault/vault";
import {
  AuthSessionManager,
  WebIngestProxy,
} from "../../daemon/web-ingest";

describe("TASK-L.17a: Silent Cookie Expiry Relogin (dec-13)", () => {
  it("enforces dec-13 clause 2: silently relogins on 401 upstream and retries fetch with zero exposure to Worker", async () => {
    const vault = await createVault({ repoRoot: "/tmp", backend: "memory" });
    const secretName = "SILENT_RELOGIN_CREDS";
    await vault.setSecret(
      secretName,
      JSON.stringify({ user: "admin", pass: "secret123" }),
    );

    let loginCount = 0;
    const authManager = new AuthSessionManager({ vault });
    authManager.registerAuthConfig({
      domain: "protected.partner.com",
      credentialName: secretName,
      loginHandler: async () => {
        loginCount++;
        return {
          cookie: `session_token=gen_${loginCount}`,
          expiresAt: Date.now() + 3600 * 1000,
        };
      },
    });

    let upstreamAttempts = 0;
    const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
      upstreamAttempts++;
      const cookieHeader = opts.headers["Cookie"];

      // First attempt: simulate that the first session cookie has expired on upstream server
      if (upstreamAttempts === 1) {
        expect(cookieHeader).toBe("session_token=gen_1");
        return new Response("Unauthorized Session", { status: 401 });
      }

      // Second attempt: Daemon has silently refreshed the cookie using Vault credentials
      if (upstreamAttempts === 2) {
        expect(cookieHeader).toBe("session_token=gen_2");
        return new Response("<html><body><h1>Dashboard</h1><p>Secret content</p></body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response("Error", { status: 500 });
    });

    const proxy = new WebIngestProxy({
      allowedDomains: ["https://protected.partner.com"],
      authSessionManager: authManager,
      fetchFn: mockFetch as any,
    });

    // Worker calls fetch. Notice Worker does NOT know about the 401 or the relogin!
    const result = await proxy.fetch({
      url: "https://protected.partner.com/dashboard",
      format: "html",
    });

    // 1. Ingest smoothly completes with 200
    expect(result.status).toBe(200);
    expect(result.content).toContain("<h1>Dashboard</h1>");

    // 2. Both login and upstream fetch happened twice under the hood
    expect(loginCount).toBe(2);
    expect(upstreamAttempts).toBe(2);

    // 3. FAIL clause check: Zero exposure of token, cookie, or relogin state in Worker payload
    expect(result.content).not.toContain("session_token=gen_");
    expect(result.content).not.toContain("secret123");
    expect(result.content).not.toContain("401");
    expect((result as any).error).toBeUndefined();
  });

  it("silently refreshes cookie when in-memory session expires by timestamp", async () => {
    const vault = await createVault({ repoRoot: "/tmp", backend: "memory" });
    const secretName = "EXPIRY_CREDS";
    await vault.setSecret(secretName, "fixed_secret_value");

    let loginCount = 0;
    const authManager = new AuthSessionManager({ vault });
    authManager.registerAuthConfig({
      domain: "expiring.partner.com",
      credentialName: secretName,
      loginHandler: async () => {
        loginCount++;
        return {
          cookie: `sess_${loginCount}`,
          // Expire immediately
          expiresAt: Date.now() - 1000,
        };
      },
    });

    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Response(`OK with ${opts.headers["Cookie"]}`, { status: 200 });
    });

    const proxy = new WebIngestProxy({
      allowedDomains: ["https://expiring.partner.com"],
      authSessionManager: authManager,
      fetchFn: mockFetch as any,
    });

    // First call logs in (sess_1)
    await proxy.fetch({ url: "https://expiring.partner.com/a" });
    expect(loginCount).toBe(1);

    // Second call notices expired session and re-authenticates (sess_2)
    await proxy.fetch({ url: "https://expiring.partner.com/b" });
    expect(loginCount).toBe(2);
  });
});
