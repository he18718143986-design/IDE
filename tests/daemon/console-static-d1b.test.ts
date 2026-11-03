import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import path from "node:path";
import os from "node:os";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { acquirePidLock, PidLockError } from "../../daemon/core/pid-lock";

/**
 * TASK-D.1b：Daemon 同源托管控制台 + 无钥匙仍连不上。
 */
describe("Daemon console static host (TASK-D.1b)", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let publicDir: string;
  let packageRoot: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-repo-"));
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-d1b-pkg-"));
    publicDir = path.join(packageRoot, "dist", "public");
    const assets = path.join(publicDir, "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, "index-d1b.js"), "export {};");
    fs.writeFileSync(path.join(assets, "styles-d1b.css"), "body{}");
    // D.1d：同源托管要求可 hydrate 的 SPA 壳（含 $_TSR）
    fs.writeFileSync(
      path.join(publicDir, "index.html"),
      `<!DOCTYPE html><html lang="zh"><head>
<title>Stagent</title>
<link rel="modulepreload" href="/assets/index-d1b.js"/>
</head><body>
<script>self.$_TSR={h(){},e(){},c(){},p(){},buffer:[]};$_TSR.e();</script>
<script type="module" async src="/assets/index-d1b.js"></script>
</body></html>`,
    );
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
      daemon = null;
    }
    safeRmSync(repo);
    safeRmSync(packageRoot);
  });

  it("同源托管 / 与 assets；无 Authorization 的 /api/state 仍 401", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      // 端口段：与其余套件不重叠，登记表见 tests/unit/test-port-map.test.ts
      startPort: 4749,
      endPort: 4758,
      enableCrashRecovery: false,
      autoShutdownSignals: false,
      consolePublicDir: publicDir,
    });
    const info = await daemon.start();
    const base = `http://127.0.0.1:${info.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    const html = await index.text();
    expect(html).toContain("/assets/index-d1b.js");
    expect(html).not.toMatch(/token=/i);

    const asset = await fetch(`${base}/assets/index-d1b.js`);
    expect(asset.status).toBe(200);

    // 未知路径仍 404（不做全站 SPA 吞没）
    const missing = await fetch(`${base}/unknown-path`);
    expect(missing.status).toBe(404);

    const unauthorized = await fetch(`${base}/api/state`);
    expect(unauthorized.status).toBe(401);

    const token = daemon.getSessionToken();
    expect(token).toBeTruthy();
    expect(html).not.toContain(token!);

    const ok = await fetch(`${base}/api/state`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);
  });

  it("异进程存活锁抛出带 E_WORKSPACE_LOCKED 的白话 PidLockError", async () => {
    const foreignPid = process.ppid > 1 ? process.ppid : 1;
    const lockPath = path.join(repo, ".stagent");
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(
      path.join(lockPath, "stagent.pid"),
      JSON.stringify({
        pid: foreignPid,
        port: 3008,
        repoRoot: path.resolve(repo),
        startedAt: new Date().toISOString(),
        version: "0.1.0",
      }),
    );

    await expect(acquirePidLock(repo, 3009)).rejects.toBeInstanceOf(
      PidLockError,
    );
    await expect(acquirePidLock(repo, 3009)).rejects.toMatchObject({
      code: "E_WORKSPACE_LOCKED",
    });
    await expect(acquirePidLock(repo, 3009)).rejects.toThrow(
      /E_WORKSPACE_LOCKED|已经在跑/,
    );
  });
});
