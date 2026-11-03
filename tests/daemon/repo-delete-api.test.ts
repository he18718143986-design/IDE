import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  addProtectionEntry,
  saveProtectionList,
} from "../../daemon/protection/protection-list";

describe("POST /api/repo/delete (C.10h)", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    safeRmSync(repo);
  });

  async function boot() {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-del-api-")),
    );
    fs.mkdirSync(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, "bye.txt"), "x\n");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "secret.ts"), "export {};\n");
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4311,
      endPort: 4320,
      enableCrashRecovery: false,
    });
    const { port } = await daemon.start();
    return port;
  }

  it("requires auth", async () => {
    const port = await boot();
    const res = await fetch(`http://127.0.0.1:${port}/api/repo/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "bye.txt" }),
    });
    expect(res.status).toBe(401);
    expect(fs.existsSync(path.join(repo, "bye.txt"))).toBe(true);
  });

  it("deletes with auth and refreshes tree contents", async () => {
    const port = await boot();
    const token = daemon!.getSessionToken();
    const res = await fetch(`http://127.0.0.1:${port}/api/repo/delete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: "bye.txt" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deleted: boolean;
      method: string;
      message: string;
      path: string;
    };
    expect(body.deleted).toBe(true);
    expect(body.path).toBe("bye.txt");
    expect(fs.existsSync(path.join(repo, "bye.txt"))).toBe(false);
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("protection list blocks with plain Chinese message", async () => {
    const port = await boot();
    saveProtectionList(repo, { version: 1, entries: [] });
    addProtectionEntry(repo, "登录", ["src/**"]);
    const token = daemon!.getSessionToken();
    const res = await fetch(`http://127.0.0.1:${port}/api/repo/delete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: "src/secret.ts" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("PROTECTED_PATH");
    expect(body.error).toMatch(/保护清单|登录/);
    expect(fs.existsSync(path.join(repo, "src", "secret.ts"))).toBe(true);
  });
});
