import { describe, it, expect } from "vitest";
import { createVault } from "../../daemon/vault/vault";
import { AuthSessionManager } from "../../daemon/web-ingest";

describe("TASK-L.17a: Web Ingest Credential Lifecycle (dec-13)", () => {
  it("enforces dec-13 clause 1: Vault credentials persist across project switch and session resets until manual deletion", async () => {
    const vault = await createVault({ repoRoot: "/tmp", backend: "memory" });
    const secretName = "CRAWLER_CREDENTIAL_KEY";
    const secretVal = JSON.stringify({ token: "permanent_partner_token_999" });

    // User stores credential in Vault
    await vault.setSecret(secretName, secretVal);

    const authManager = new AuthSessionManager({ vault });
    authManager.registerAuthConfig({
      domain: "data.partner.com",
      credentialName: secretName,
      loginHandler: async (creds) => ({
        cookie: `auth=${creds.token}`,
        expiresAt: Date.now() + 1800 * 1000,
      }),
    });

    // 1. Initial auth succeeds and creates in-memory session
    const cookie1 = await authManager.authenticate("data.partner.com");
    expect(cookie1).toBe("auth=permanent_partner_token_999");
    expect(authManager.getSession("data.partner.com")).not.toBeNull();

    // 2. Project switch / session reset occurs
    authManager.onProjectSwitch();

    // 3. In-memory session was purged
    expect(authManager.getSession("data.partner.com")).toBeNull();

    // 4. dec-13: Vault credentials MUST NOT be deleted or expired
    const envAfterSwitch = await vault.resolveEnv([secretName]);
    expect(envAfterSwitch[secretName]).toBe(secretVal);

    // 5. Subsequent request can re-authenticate seamlessly from persistent Vault
    const cookie2 = await authManager.authenticate("data.partner.com");
    expect(cookie2).toBe("auth=permanent_partner_token_999");

    // 6. Only manual deletion by user removes the Vault credential
    await vault.deleteSecret(secretName);
    const names = await vault.listNames();
    expect(names).not.toContain(secretName);

    // 7. After manual deletion, authentication fails
    authManager.clearInMemorySessions();
    await expect(authManager.authenticate("data.partner.com")).rejects.toMatchObject({
      code: "E_WEB_INGEST_AUTH_FAILED",
      status: 401,
    });
  });
});
