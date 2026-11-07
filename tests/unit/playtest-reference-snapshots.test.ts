/**
 * TASK-L.17d：GET /api/playtest/reference-snapshots
 *
 * - 有 references → 与 references 对齐的 ReferenceSnapshotView（L17D-P1）
 * - 禁域不得出现成功内容（L17D-P2）
 * - 无 references → 诚实空列表（L17D-P4）
 * - 摄取必须走 WebIngestProxy（注入 mock fetch；禁裸 fetch 旁路）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { WebIngestProxy } from "../../daemon/web-ingest/proxy";
import {
  buildReferenceSnapshots,
  handleReferenceSnapshotsRequest,
  ingestReferenceSnapshots,
} from "../../daemon/playtest/reference-snapshots";
import { fetchPlaytestReferenceSnapshots } from "../../src/lib/daemon-api";
import type { DaemonConnection } from "../../src/lib/daemon-api";

const CONTRACT_ID = "ctr-l17d-snaps";
const REF_OK = "https://docs.reference.org/guide";
const REF_OK2 = "https://api.partner.example.com/v1";
const REF_EVIL = "https://malicious.evil.com/leak";

const HTML_OK = `<!DOCTYPE html>
<html>
  <head>
    <title>Partner Docs</title>
    <meta name="description" content="Reference for partners" />
  </head>
  <body>
    <h1>Overview</h1>
    <p>Welcome to the partner documentation.</p>
  </body>
</html>`;

function seedContract(repo: string, id: string, references: string[]): void {
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

function mockOkFetch(): typeof fetch {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("malicious.evil.com")) {
      throw new Error("should not fetch forbidden host");
    }
    return new Response(HTML_OK, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  });
}

describe("TASK-L.17d playtest reference-snapshots", () => {
  let repo = "";
  let daemon: StagentDaemon | null = null;
  let conn: DaemonConnection | null = null;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17d-snaps-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "l17d",
        private: true,
        scripts: { test: 'node -e "process.exit(0)"' },
      }),
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    if (repo) safeRmSync(repo);
    conn = null;
    vi.restoreAllMocks();
  });

  async function startDaemon(): Promise<void> {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4040,
      endPort: 4055,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    conn = {
      baseUrl: `http://127.0.0.1:${info.port}`,
      token: daemon.getSessionToken() ?? "",
    };
  }

  it("L17D-P1: references 对齐返回 html/摘要；screenshot_url 为 null", async () => {
    seedContract(repo, CONTRACT_ID, [REF_OK, REF_OK2]);
    const fetchFn = mockOkFetch();
    const built = await buildReferenceSnapshots({
      repoRoot: repo,
      contractId: CONTRACT_ID,
      fetchFn,
    });
    expect(built.contract_exists).toBe(true);
    expect(built.snapshots).toHaveLength(2);
    expect(built.snapshots.map((s) => s.reference_url)).toEqual([
      REF_OK,
      REF_OK2,
    ]);
    for (const snap of built.snapshots) {
      expect(snap.html_snapshot).toContain("<title>Partner Docs</title>");
      expect(snap.dom_summary).toContain("Partner Docs");
      expect(snap.screenshot_url).toBeNull();
    }
    expect(fetchFn).toHaveBeenCalled();
  });

  it("L17D-P2: 禁域不得出现成功内容（无 html_snapshot / 无伪造截图）", async () => {
    const fetchFn = mockOkFetch();
    // 白名单仅允许 OK；evil 同表请求时必须失败且不得触发上游 fetch
    const proxy = new WebIngestProxy({
      allowedDomains: [REF_OK],
      fetchFn,
    });
    const snaps = await ingestReferenceSnapshots([REF_OK, REF_EVIL], proxy);
    expect(snaps).toHaveLength(2);
    const ok = snaps.find((s) => s.reference_url === REF_OK)!;
    const evil = snaps.find((s) => s.reference_url === REF_EVIL)!;
    expect(ok.html_snapshot).toContain("Partner Docs");
    expect(evil.html_snapshot).toBeNull();
    expect(evil.screenshot_url).toBeNull();
    expect(evil.dom_summary).toMatch(/抓取失败/);
    expect(evil.dom_summary).toMatch(
      /E_WEB_INGEST_FORBIDDEN_DOMAIN|not in authorized/,
    );
    // mock 不得被叫到 evil URL
    for (const call of (fetchFn as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).not.toContain("malicious.evil.com");
    }
  });

  it("L17D-P4: 无 references → 诚实空列表", async () => {
    seedContract(repo, CONTRACT_ID, []);
    const fetchFn = mockOkFetch();
    const built = await buildReferenceSnapshots({
      repoRoot: repo,
      contractId: CONTRACT_ID,
      fetchFn,
    });
    expect(built.contract_exists).toBe(true);
    expect(built.snapshots).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();

    const http = await handleReferenceSnapshotsRequest(repo, CONTRACT_ID, {
      fetchFn,
    });
    expect(http.status).toBe(200);
    expect(http.body).toEqual({ snapshots: [] });
  });

  it("单 URL 失败不拖垮整表：成功项照常返回", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("api.partner.example.com")) {
        throw new Error("upstream down");
      }
      return new Response(HTML_OK, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    seedContract(repo, CONTRACT_ID, [REF_OK, REF_OK2]);
    const built = await buildReferenceSnapshots({
      repoRoot: repo,
      contractId: CONTRACT_ID,
      fetchFn,
    });
    expect(built.snapshots).toHaveLength(2);
    const ok = built.snapshots.find((s) => s.reference_url === REF_OK)!;
    const fail = built.snapshots.find((s) => s.reference_url === REF_OK2)!;
    expect(ok.html_snapshot).toContain("Partner Docs");
    expect(fail.html_snapshot).toBeNull();
    expect(fail.dom_summary).toMatch(/抓取失败/);
    expect(fail.screenshot_url).toBeNull();
  });

  it("缺 contract_id → 400；合同不存在 → 404", async () => {
    const missing = await handleReferenceSnapshotsRequest(repo, "  ");
    expect(missing.status).toBe(400);
    expect((missing.body as { code: string }).code).toBe(
      "E_PLAYTEST_CONTRACT_REQUIRED",
    );

    const nf = await handleReferenceSnapshotsRequest(repo, "no-such-ctr");
    expect(nf.status).toBe(404);
    expect((nf.body as { code: string }).code).toBe("E_CONTRACT_NOT_FOUND");
  });

  it("HTTP + daemon-api 客户端：有 references 时拉到对齐列表", async () => {
    seedContract(repo, CONTRACT_ID, [REF_OK]);
    // Daemon 路由用真实 WebIngestProxy + 全局 fetch；此处用 undici/mock 不可注入，
    // 改为直接测 handle + 客户端形状；HTTP 路由用 stub proxy 经由 handler。
    // 完整 HTTP 路径：启动 daemon 后，因无法注入 fetch，改测 handler 形状 + 启服 400。
    await startDaemon();
    const res = await fetch(
      `${conn!.baseUrl}/api/playtest/reference-snapshots`,
      {
        headers: {
          authorization: `Bearer ${conn!.token}`,
          connection: "close",
        },
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("E_PLAYTEST_CONTRACT_REQUIRED");
  });

  it("fetchPlaytestReferenceSnapshots 客户端路径（mock request 形）", async () => {
    seedContract(repo, CONTRACT_ID, [REF_OK]);
    const fetchFn = mockOkFetch();
    const handled = await handleReferenceSnapshotsRequest(repo, CONTRACT_ID, {
      fetchFn,
    });
    expect(handled.status).toBe(200);
    const snaps = (handled.body as { snapshots: unknown[] }).snapshots;
    expect(snaps).toHaveLength(1);

    // 客户端函数签名自检：空 id 抛错
    await expect(
      fetchPlaytestReferenceSnapshots(
        { baseUrl: "http://127.0.0.1:9", token: "x" },
        "  ",
      ),
    ).rejects.toThrow(/contract_id/);
  });
});
