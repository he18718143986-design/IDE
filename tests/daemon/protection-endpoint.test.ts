import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createDaemon, type StagentDaemon } from "../../daemon/server";

/**
 * P.1 显示修复回归：GET /api/protection 的三态。
 * - 无清单 → VIBE
 * - 有清单 → PROTECTED
 * - 清单损坏 → CORRUPT（门卫按全拦截运行，页面据此显示白话警告，绝不显示自由模式）
 */

function getJson<T>(
  url: string,
  token: string,
): Promise<{ statusCode: number; body: T }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      { headers: { authorization: `Bearer ${token}` } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: JSON.parse(raw) as T,
          });
        });
      },
    );
    req.on("error", reject);
  });
}

describe("P.1 GET /api/protection 模式三态", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-protection-api-"));
    // 端口段：与其余套件不重叠（原 3540–3550 与 server.test 的 3535–3540 撞边界），
    // 登记表见 tests/unit/test-port-map.test.ts
    daemon = createDaemon({ repoRoot: repo, startPort: 4669, endPort: 4678 });
    const info = await daemon.start();
    baseUrl = `http://127.0.0.1:${info.port}`;
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    try {
      safeRmSync(repo);
    } catch {
      // 临时目录清理尽力而为
    }
  });

  it("无清单 = VIBE；有清单 = PROTECTED；损坏 = CORRUPT", async () => {
    const token = daemon!.getSessionToken() ?? "";

    const empty = await getJson<{ mode: string }>(
      `${baseUrl}/api/protection`,
      token,
    );
    expect(empty.statusCode).toBe(200);
    expect(empty.body.mode).toBe("VIBE");

    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".stagent", "protection.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "pe-1",
            name: "登录",
            patterns: ["src/auth/**"],
            createdAt: "",
          },
        ],
      }),
    );
    const protectedRes = await getJson<{ mode: string }>(
      `${baseUrl}/api/protection`,
      token,
    );
    expect(protectedRes.body.mode).toBe("PROTECTED");

    fs.writeFileSync(path.join(repo, ".stagent", "protection.json"), "{broken");
    const corrupt = await getJson<{ mode: string; corrupt: string | null }>(
      `${baseUrl}/api/protection`,
      token,
    );
    expect(corrupt.body.mode).toBe("CORRUPT");
    expect(corrupt.body.corrupt).toBeTruthy();
  });
});
