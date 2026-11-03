import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDaemon, type StagentDaemon } from "../../daemon/server";

describe("GET /api/repo/tree (C.10f)", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    safeRmSync(repo);
  });

  it("requires auth and returns relative file paths", async () => {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-repo-tree-")),
    );
    fs.mkdirSync(path.join(repo, ".git"));
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "package.json"), "{}\n");
    fs.writeFileSync(path.join(repo, "src", "main.ts"), "export {};\n");
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4250,
      endPort: 4259,
      enableCrashRecovery: false,
    });
    const { port } = await daemon.start();
    const url = `http://127.0.0.1:${port}/api/repo/tree`;
    expect((await fetch(url)).status).toBe(401);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${daemon.getSessionToken()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { root: string; files: string[] };
    expect(body.root).toBe(repo);
    expect(body.files).toContain("package.json");
    expect(body.files).toContain("src/main.ts");
  });
});
