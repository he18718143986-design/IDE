import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  canBindPort,
  findStaticPreviewRoot,
  NO_PREVIEW_PLAIN_MESSAGE,
  pickPreviewCommand,
  startAppPreview,
  stopAppPreview,
  waitReady,
  type AppPreviewHandle,
} from "../../daemon/supervisor/preview/app-runner";
import { findAvailablePort } from "../../daemon/core/port-finder";
import { REAL_PREVIEW_PORT_RANGE } from "../../daemon/supervisor/preview/types";

/**
 * TASK-L.5：真实预览 runner 单测。
 * 夹具用最小 Node HTTP 服务，不依赖 Vite / 框架。
 */

const tmpRoots: string[] = [];
const running: AppPreviewHandle[] = [];

function newRepo(): string {
  const base = path.join(process.cwd(), ".tmp", "unit-app-preview");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "case-"));
  tmpRoots.push(dir);
  return dir;
}

function writePkg(
  dir: string,
  scripts: Record<string, string>,
  serverSource?: string,
): void {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "preview-fixture", private: true, scripts }, null, 2),
    "utf8",
  );
  if (serverSource) {
    fs.writeFileSync(path.join(dir, "server.cjs"), serverSource, "utf8");
  }
}

/** 读 PORT 并监听；任意 GET 回 200 */
const LISTENING_SERVER = `
const http = require("node:http");
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error("PORT missing");
  process.exit(2);
}
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("preview-ok");
});
server.listen(port, "127.0.0.1", () => {
  console.error("listening on " + port);
});
`;

/** 不监听端口，只往 stderr 打日志并挂起 */
const HANGING_SERVER = `
console.error("fixture-stderr-tail: not listening on purpose");
setInterval(() => {}, 60_000);
`;

afterEach(async () => {
  while (running.length > 0) {
    const h = running.pop();
    if (h) {
      try {
        await stopAppPreview(h);
      } catch {
        // ignore
      }
    }
  }
  for (const dir of tmpRoots.splice(0)) {
    safeRmSync(dir);
  }
});

describe("app-preview-runner（TASK-L.5）", () => {
  describe("pickPreviewCommand", () => {
    it("有 dev 时取 dev", () => {
      const dir = newRepo();
      writePkg(dir, { dev: "node server.cjs", start: "node server.cjs" });
      const picked = pickPreviewCommand(dir);
      expect(picked?.script).toBe("dev");
      expect(picked?.args).toEqual(["run", "dev"]);
    });

    it("只有 start 时取 start", () => {
      const dir = newRepo();
      writePkg(dir, { start: "node server.cjs", test: "echo hi" });
      const picked = pickPreviewCommand(dir);
      expect(picked?.script).toBe("start");
    });

    it("只有 preview 时取 preview", () => {
      const dir = newRepo();
      writePkg(dir, { preview: "node server.cjs" });
      expect(pickPreviewCommand(dir)?.script).toBe("preview");
    });

    it("都没有返回 null", () => {
      const dir = newRepo();
      writePkg(dir, { test: "echo hi", build: "echo build" });
      expect(pickPreviewCommand(dir)).toBeNull();
    });

    it("无 package.json 返回 null", () => {
      const dir = newRepo();
      expect(pickPreviewCommand(dir)).toBeNull();
    });
  });

  describe("findStaticPreviewRoot", () => {
    it("按 dist → build → public 取第一个存在的目录", () => {
      const dir = newRepo();
      fs.mkdirSync(path.join(dir, "build"));
      fs.mkdirSync(path.join(dir, "public"));
      expect(findStaticPreviewRoot(dir)).toBe(path.join(dir, "build"));
    });

    it("都没有返回 null", () => {
      const dir = newRepo();
      expect(findStaticPreviewRoot(dir)).toBeNull();
    });
  });

  describe("start / waitReady / stop", () => {
    it("启动后 waitReady 成功，GET 得到 200；端口落在 4200～4210", async () => {
      const dir = newRepo();
      writePkg(dir, { dev: "node server.cjs" }, LISTENING_SERVER);
      const port = await findAvailablePort({
        host: "127.0.0.1",
        startPort: REAL_PREVIEW_PORT_RANGE.start,
        endPort: REAL_PREVIEW_PORT_RANGE.end,
      });
      expect(port).toBeGreaterThanOrEqual(4200);
      expect(port).toBeLessThanOrEqual(4210);

      const handle = await startAppPreview({ worktreeDir: dir, port });
      running.push(handle);

      const ready = await waitReady(port, {
        timeoutMs: 30_000,
        getStderr: () => handle.stderr(),
      });
      expect(ready).toEqual({ ready: true });

      const body = await new Promise<string>((resolve, reject) => {
        http
          .get(handle.url, (res) => {
            expect(res.statusCode).toBe(200);
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve(Buffer.concat(chunks).toString("utf8")),
            );
          })
          .on("error", reject);
      });
      expect(body).toBe("preview-ok");
      expect(handle.port).toBe(port);
      expect(handle.url).toBe(`http://127.0.0.1:${port}/`);
    }, 40_000);

    it("不监听端口时 timeoutMs:3000 失败且含 stderr 尾部", async () => {
      const dir = newRepo();
      writePkg(dir, { start: "node server.cjs" }, HANGING_SERVER);
      const port = await findAvailablePort({
        host: "127.0.0.1",
        startPort: REAL_PREVIEW_PORT_RANGE.start,
        endPort: REAL_PREVIEW_PORT_RANGE.end,
      });

      const handle = await startAppPreview({ worktreeDir: dir, port });
      running.push(handle);

      const ready = await waitReady(port, {
        intervalMs: 200,
        timeoutMs: 3_000,
        getStderr: () => handle.stderr(),
      });
      expect(ready.ready).toBe(false);
      if (ready.ready) throw new Error("unreachable");
      expect(ready.stderrTail).toContain("fixture-stderr-tail");
    }, 20_000);

    it("stopAppPreview 后端口可再次绑定", async () => {
      const dir = newRepo();
      writePkg(dir, { preview: "node server.cjs" }, LISTENING_SERVER);
      const port = await findAvailablePort({
        host: "127.0.0.1",
        startPort: REAL_PREVIEW_PORT_RANGE.start,
        endPort: REAL_PREVIEW_PORT_RANGE.end,
      });

      const handle = await startAppPreview({ worktreeDir: dir, port });
      const ready = await waitReady(port, {
        timeoutMs: 30_000,
        getStderr: () => handle.stderr(),
      });
      expect(ready.ready).toBe(true);

      await stopAppPreview(handle);
      // 已从 running 摘掉，避免 afterEach 二次 stop
      const idx = running.indexOf(handle);
      if (idx >= 0) running.splice(idx, 1);

      // 给内核一点时间释放
      const deadline = Date.now() + 5_000;
      let free = false;
      while (Date.now() < deadline) {
        free = await canBindPort(port);
        if (free) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(free).toBe(true);

      // 真正再 listen 一次确认
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.close(() => resolve());
        });
      });
    }, 40_000);

    it("无脚本时 startAppPreview 抛出白话错误", async () => {
      const dir = newRepo();
      writePkg(dir, { test: "echo x" });
      await expect(
        startAppPreview({ worktreeDir: dir, port: 4200 }),
      ).rejects.toThrow(NO_PREVIEW_PLAIN_MESSAGE);
    });
  });
});
