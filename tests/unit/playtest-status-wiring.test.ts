/**
 * TASK-L.17c：GET /api/playtest/status 薄读侧接线。
 *
 * - 委托 evaluatePlaytestGuard，不改判定逻辑
 * - 缺 contract_id → 400
 * - 各拒绝态原样返回
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { evaluatePlaytestGuard } from "../../daemon/supervisor/preview/playtest-guard";
import { fetchPlaytestStatus } from "../../src/lib/journey/playtest-evidence";
import type { DaemonConnection } from "../../src/lib/daemon-api";

const CONTRACT_ID = "ctr-l17c-status";
const REF = "https://partner.example.com/spec";

function seedContract(
  repo: string,
  id: string,
  references: string[] = [REF],
): void {
  const dir = path.join(repo, ".stagent", "contracts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify(
      {
        schema_version: "1.0.0",
        contract_id: id,
        references,
      },
      null,
      2,
    ),
  );
}

describe("TASK-L.17c playtest status wiring", () => {
  let repo = "";
  let daemon: StagentDaemon | null = null;
  let conn: DaemonConnection | null = null;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17c-status-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "l17c",
        private: true,
        scripts: { test: 'node -e "process.exit(0)"' },
      }),
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    seedContract(repo, CONTRACT_ID);
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4020,
      endPort: 4030,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    conn = {
      baseUrl: `http://127.0.0.1:${info.port}`,
      token: daemon.getSessionToken() ?? "",
    };
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    if (repo) safeRmSync(repo);
    conn = null;
  });

  function authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${conn!.token}`,
      connection: "close",
    };
  }

  it("GET /api/playtest/status 与 evaluatePlaytestGuard 判定一致（UNCONFIRMED）", async () => {
    const direct = evaluatePlaytestGuard({
      repoRoot: repo,
      contractId: CONTRACT_ID,
    });
    expect(direct.status).toBe("UNCONFIRMED");

    const viaHttp = await fetchPlaytestStatus(conn!, CONTRACT_ID);
    expect(viaHttp.status).toBe(direct.status);
    expect(viaHttp.code).toBe(direct.code);
    expect(viaHttp.ok).toBe(direct.ok);
    expect(viaHttp.message).toBe(direct.message);
    expect(viaHttp.contract_id).toBe(CONTRACT_ID);
  });

  it("无 references → NOT_NORTHSTAR_SCENARIO", async () => {
    const id = "ctr-no-ref";
    seedContract(repo, id, []);
    const viaHttp = await fetchPlaytestStatus(conn!, id);
    expect(viaHttp.status).toBe("NOT_NORTHSTAR_SCENARIO");
    expect(viaHttp.ok).toBe(false);
  });

  it("缺 contract_id → 400", async () => {
    const res = await fetch(`${conn!.baseUrl}/api/playtest/status`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("CONTRACT_NOT_FOUND", async () => {
    const viaHttp = await fetchPlaytestStatus(conn!, "missing-ctr");
    expect(viaHttp.status).toBe("CONTRACT_NOT_FOUND");
    expect(viaHttp.ok).toBe(false);
  });
});
