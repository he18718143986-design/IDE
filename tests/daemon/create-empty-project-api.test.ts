import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import * as createMod from "../../daemon/desktop/create-empty-project";

function requestJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: T;
          try {
            body = raw ? (JSON.parse(raw) as T) : ({} as T);
          } catch {
            body = raw as unknown as T;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

describe("TASK-DS.2 POST /api/desktop/create-empty-project (DS2-P2 / DS2-P5)", () => {
  let repo: string;
  let home: string;
  let parent: string;
  let daemon: StagentDaemon | null = null;
  let prevHome: string | undefined;
  let createSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ds2-api-repo-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ds2-api-home-"));
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ds2-api-parent-"));
    prevHome = process.env["STAGENT_HOME"];
    process.env["STAGENT_HOME"] = home;
  });

  afterEach(async () => {
    createSpy?.mockRestore();
    createSpy = null;
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    if (prevHome === undefined) delete process.env["STAGENT_HOME"];
    else process.env["STAGENT_HOME"] = prevHome;
    safeRmSync(repo);
    safeRmSync(home);
    safeRmSync(parent);
  });

  async function boot() {
    daemon = createDaemon({
      repoRoot: repo,
      // 端口须与 pick-folder（3656–3675）及 contract-api（3680–3685）/
      // resume-abort（3690–3695）错开。挂到 3700–3719（3696–3770 空档内）。
      startPort: 3700,
      endPort: 3719,
      consolePublicDir: null,
    });
    return daemon.start();
  }

  /** CI 可能非 darwin：强制走真实 mkdir 内核，绕过平台门禁。 */
  function forceDarwinCreate() {
    const original = createMod.createEmptyProject;
    createSpy = vi
      .spyOn(createMod, "createEmptyProject")
      .mockImplementation((opts) => original({ ...opts, platform: "darwin" }));
  }

  it("未鉴权拒绝 create-empty-project（401）", async () => {
    createSpy = vi.spyOn(createMod, "createEmptyProject").mockReturnValue({
      ok: true,
      path: "/tmp/should-not-run",
    });
    const info = await boot();
    const base = `http://127.0.0.1:${info.port}`;
    const res = await requestJson(`${base}/api/desktop/create-empty-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentPath: parent, name: "x" }),
    });
    expect(res.status).toBe(401);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("鉴权后创建成功可走 recent-projects/open；#token=；响应无 Token", async () => {
    forceDarwinCreate();
    const info = await boot();
    const token = daemon!.getSessionToken();
    const base = `http://127.0.0.1:${info.port}`;
    const auth = { authorization: `Bearer ${token}` };

    const created = await requestJson<{ path?: string; code?: string }>(
      `${base}/api/desktop/create-empty-project`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ parentPath: parent, name: "fresh-app" }),
      },
    );
    expect(created.status).toBe(200);
    expect(created.body.path).toBe(path.join(parent, "fresh-app"));
    expect(fs.statSync(created.body.path!).isDirectory()).toBe(true);
    expect(created.body).not.toHaveProperty("token");
    expect(created.body).not.toHaveProperty("launchUrl");
    expect(JSON.stringify(created.body)).not.toContain(token!);

    // 创建后复用既有 open 通道（#token=；不进 query）
    const opened = await requestJson<{
      launchUrl: string;
      path: string;
    }>(`${base}/api/recent-projects/open`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: created.body.path }),
    });
    expect(opened.status).toBe(200);
    expect(opened.body.path).toBe(created.body.path);
    expect(opened.body.launchUrl).toMatch(/#token=/);
    expect(opened.body.launchUrl).not.toMatch(/[?&]token=/);

    const listed = await requestJson<{ items: Array<{ path: string }> }>(
      `${base}/api/recent-projects`,
      { headers: auth },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.items.some((i) => i.path === created.body.path)).toBe(
      true,
    );
  });

  it("目标已存在 → 400 E_EXISTS", async () => {
    forceDarwinCreate();
    const info = await boot();
    const token = daemon!.getSessionToken();
    const existing = path.join(parent, "dup");
    fs.mkdirSync(existing);
    const res = await requestJson<{ code?: string }>(
      `http://127.0.0.1:${info.port}/api/desktop/create-empty-project`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ parentPath: parent, name: "dup" }),
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("E_EXISTS");
  });

  it("非 darwin → 501 E_UNSUPPORTED_PLATFORM", async () => {
    createSpy = vi.spyOn(createMod, "createEmptyProject").mockReturnValue({
      ok: false,
      code: "E_UNSUPPORTED_PLATFORM",
      message: "新建空项目仅支持 macOS（当前平台：linux）",
    });
    const info = await boot();
    const token = daemon!.getSessionToken();
    const res = await requestJson<{ code?: string }>(
      `http://127.0.0.1:${info.port}/api/desktop/create-empty-project`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ parentPath: parent, name: "x" }),
      },
    );
    expect(res.status).toBe(501);
    expect(res.body.code).toBe("E_UNSUPPORTED_PLATFORM");
  });

  it("DS2-P5：不旁路鉴权；create 响应不含 token / launchUrl", async () => {
    forceDarwinCreate();
    const info = await boot();
    const token = daemon!.getSessionToken();
    const res = await requestJson<Record<string, unknown>>(
      `http://127.0.0.1:${info.port}/api/desktop/create-empty-project`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ parentPath: parent, name: "safe-app" }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("token");
    expect(res.body).not.toHaveProperty("launchUrl");
    expect(JSON.stringify(res.body)).not.toContain(token!);
  });
});
