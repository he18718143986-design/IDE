import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import * as picker from "../../daemon/desktop/macos-folder-picker";

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

describe("TASK-DS.1 POST /api/desktop/pick-folder (DS1-P2 / DS1-P5)", () => {
  let repo: string;
  let home: string;
  let daemon: StagentDaemon | null = null;
  let prevHome: string | undefined;
  let pickSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ds1-api-repo-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ds1-api-home-"));
    prevHome = process.env["STAGENT_HOME"];
    process.env["STAGENT_HOME"] = home;
  });

  afterEach(async () => {
    pickSpy?.mockRestore();
    pickSpy = null;
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    if (prevHome === undefined) delete process.env["STAGENT_HOME"];
    else process.env["STAGENT_HOME"] = prevHome;
    safeRmSync(repo);
    safeRmSync(home);
  });

  async function boot() {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3651,
      endPort: 3670,
      consolePublicDir: null,
    });
    return daemon.start();
  }

  it("未鉴权拒绝 pick-folder（401）", async () => {
    pickSpy = vi.spyOn(picker, "pickFolderMacOS").mockReturnValue({
      ok: true,
      path: "/tmp/should-not-run",
    });
    const info = await boot();
    const base = `http://127.0.0.1:${info.port}`;
    const res = await requestJson(`${base}/api/desktop/pick-folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(pickSpy).not.toHaveBeenCalled();
  });

  it("鉴权后选中路径可走 recent-projects/open；recent/list 与粘贴回归", async () => {
    // 选夹返回「当前工作区」路径，避免本测再 spawn 第二 Daemon
    const pickedPath = path.resolve(repo);
    pickSpy = vi.spyOn(picker, "pickFolderMacOS").mockReturnValue({
      ok: true,
      path: pickedPath,
    });
    const info = await boot();
    const token = daemon!.getSessionToken();
    const base = `http://127.0.0.1:${info.port}`;
    const auth = { authorization: `Bearer ${token}` };

    const picked = await requestJson<{ path?: string; cancelled?: boolean }>(
      `${base}/api/desktop/pick-folder`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(picked.status).toBe(200);
    expect(picked.body.path).toBe(pickedPath);
    expect(pickSpy).toHaveBeenCalled();

    // 选中后复用既有 open 通道（#token=；不进 query）
    const opened = await requestJson<{
      launchUrl: string;
      path: string;
      reused: boolean;
    }>(`${base}/api/recent-projects/open`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path: pickedPath }),
    });
    expect(opened.status).toBe(200);
    expect(opened.body.path).toBe(pickedPath);
    expect(opened.body.reused).toBe(true);
    expect(opened.body.launchUrl).toMatch(/#token=/);
    expect(opened.body.launchUrl).not.toMatch(/[?&]token=/);

    const listed = await requestJson<{ items: Array<{ path: string }> }>(
      `${base}/api/recent-projects`,
      { headers: auth },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.items.some((i) => i.path === pickedPath)).toBe(true);

    // 粘贴路径回归：再 open 当前路径仍成功（C.8c 通道未回退）
    const paste = await requestJson<{ path: string }>(
      `${base}/api/recent-projects/open`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ path: repo }),
      },
    );
    expect(paste.status).toBe(200);
    expect(paste.body.path).toBe(pickedPath);
  });

  it("取消 → 200 { cancelled: true }", async () => {
    pickSpy = vi.spyOn(picker, "pickFolderMacOS").mockReturnValue({
      ok: false,
      code: "CANCELLED",
    });
    const info = await boot();
    const token = daemon!.getSessionToken();
    const res = await requestJson<{ cancelled?: boolean }>(
      `http://127.0.0.1:${info.port}/api/desktop/pick-folder`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });

  it("非 darwin → 501 E_UNSUPPORTED_PLATFORM", async () => {
    pickSpy = vi.spyOn(picker, "pickFolderMacOS").mockReturnValue({
      ok: false,
      code: "E_UNSUPPORTED_PLATFORM",
      message: "系统选夹仅支持 macOS（当前平台：linux）",
    });
    const info = await boot();
    const token = daemon!.getSessionToken();
    const res = await requestJson<{ code?: string }>(
      `http://127.0.0.1:${info.port}/api/desktop/pick-folder`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(501);
    expect(res.body.code).toBe("E_UNSUPPORTED_PLATFORM");
  });

  it("DS1-P5：不旁路鉴权；pick-folder 响应不含 token / launchUrl", async () => {
    pickSpy = vi.spyOn(picker, "pickFolderMacOS").mockReturnValue({
      ok: true,
      path: path.resolve(repo),
    });
    const info = await boot();
    const token = daemon!.getSessionToken();
    const res = await requestJson<Record<string, unknown>>(
      `http://127.0.0.1:${info.port}/api/desktop/pick-folder`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("token");
    expect(res.body).not.toHaveProperty("launchUrl");
    expect(JSON.stringify(res.body)).not.toContain(token!);
  });
});
