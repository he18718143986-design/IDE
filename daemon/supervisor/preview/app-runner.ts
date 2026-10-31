import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { sanitizeEnvironment } from "../../runner/env-filter";
import { killProcessTree } from "../../runner/process-tree";
import { spawnManaged, type ManagedProcess } from "../../worker/cli-host/process-host";

/**
 * TASK-L.5：在 Worktree 里启动用户应用的真实预览进程。
 *
 * 预览是 Daemon 自有进程（与 Demo 预览服务同类），不进合同
 * `allowed_commands`，其退出码不影响 `can_merge`。
 *
 * 规格：verification-strategy.md §7。
 */

export const PREVIEW_SCRIPT_CANDIDATES = ["dev", "start", "preview"] as const;
export type PreviewScriptName = (typeof PREVIEW_SCRIPT_CANDIDATES)[number];

/** 静态目录回退顺序（无脚本时） */
export const STATIC_PREVIEW_DIR_CANDIDATES = [
  "dist",
  "build",
  "public",
] as const;

export const DEFAULT_WAIT_INTERVAL_MS = 500;
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

export const NO_PREVIEW_PLAIN_MESSAGE = "这个项目没有可预览的页面";

export interface PickedPreviewCommand {
  readonly script: PreviewScriptName;
  readonly command: string;
  readonly args: readonly string[];
}

export interface StartAppPreviewOptions {
  readonly worktreeDir: string;
  readonly port: number;
  /** 覆盖脚本选择；缺省走 pickPreviewCommand */
  readonly command?: PickedPreviewCommand | undefined;
  /** 注入到子进程的额外环境（PORT 始终覆盖） */
  readonly extraEnv?: Record<string, string> | undefined;
}

export interface AppPreviewHandle {
  readonly pid: number;
  readonly port: number;
  readonly url: string;
  readonly worktreeDir: string;
  readonly script: PreviewScriptName;
  /** 最近 stderr 尾部（最多约 16KB，由 spawnManaged 维护） */
  stderr(): string;
  /** @internal 供 stopAppPreview 使用 */
  readonly _managed: ManagedProcess;
}

export interface WaitReadyOptions {
  readonly intervalMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly host?: string | undefined;
  /** 失败时附带 stderr 尾部（测试与失败卡） */
  readonly getStderr?: (() => string) | undefined;
}

export type WaitReadyResult =
  | { readonly ready: true }
  | { readonly ready: false; readonly stderrTail: string };

function npmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function readPackageScripts(
  worktreeDir: string,
): Record<string, string> | null {
  const pkgPath = path.join(worktreeDir, "package.json");
  if (!fs.existsSync(pkgPath) || !fs.statSync(pkgPath).isFile()) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("scripts" in raw) ||
    typeof (raw as { scripts: unknown }).scripts !== "object" ||
    (raw as { scripts: unknown }).scripts === null
  ) {
    return null;
  }
  const scripts = (raw as { scripts: Record<string, unknown> }).scripts;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === "string" && value.trim().length > 0) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 按 `dev` → `start` → `preview` 顺序取 Worktree `package.json` 里存在的第一个脚本。
 * 都没有则返回 `null`（调用方回退静态目录或白话提示）。
 */
export function pickPreviewCommand(
  worktreeDir: string,
): PickedPreviewCommand | null {
  const scripts = readPackageScripts(worktreeDir);
  if (!scripts) return null;
  for (const script of PREVIEW_SCRIPT_CANDIDATES) {
    if (scripts[script]) {
      return {
        script,
        command: npmExecutable(),
        args: ["run", script],
      };
    }
  }
  return null;
}

/**
 * 静态目录回退：`dist/` → `build/` → `public/` 中第一个存在的目录。
 */
export function findStaticPreviewRoot(worktreeDir: string): string | null {
  for (const name of STATIC_PREVIEW_DIR_CANDIDATES) {
    const candidate = path.join(worktreeDir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // 竞态 / 权限：跳过
    }
  }
  return null;
}

/**
 * 启动长驻预览进程。`PORT` 注入；环境走 env-filter 白名单。
 * 不在此等待就绪——调用方应随后调用 `waitReady`。
 */
export async function startAppPreview(
  options: StartAppPreviewOptions,
): Promise<AppPreviewHandle> {
  const worktreeDir = path.resolve(options.worktreeDir);
  if (!fs.existsSync(worktreeDir) || !fs.statSync(worktreeDir).isDirectory()) {
    throw new Error(
      `[E_APP_PREVIEW_NO_WORKTREE] Worktree 不存在: ${worktreeDir}`,
    );
  }

  const picked = options.command ?? pickPreviewCommand(worktreeDir);
  if (!picked) {
    throw new Error(
      `[E_APP_PREVIEW_NO_COMMAND] ${NO_PREVIEW_PLAIN_MESSAGE}`,
    );
  }

  const port = options.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[E_APP_PREVIEW_BAD_PORT] 非法端口: ${port}`);
  }

  const env = sanitizeEnvironment(process.env, {
    extraEnv: {
      NODE_ENV: "development",
      ...(options.extraEnv ?? {}),
      PORT: String(port),
    },
  });

  const managed = spawnManaged({
    command: picked.command,
    args: [...picked.args],
    cwd: worktreeDir,
    env,
    // 预览回收走 process-tree：SIGTERM → 3s → SIGKILL；此处缩短 spawnManaged
    // 自带的 SIGINT 阶，避免与 stopAppPreview 的树杀策略打架。
    sigintGraceMs: 200,
    sigtermGraceMs: 500,
  });

  if (managed.pid === undefined) {
    await managed.stop();
    throw new Error(
      `[E_APP_PREVIEW_SPAWN_FAILED] 无法启动预览进程（无 pid）\n${managed.stderr()}`,
    );
  }

  // 空转消费 stdout，避免管道背压把子进程卡住
  void (async () => {
    try {
      for await (const _line of managed.lines) {
        // discard
      }
    } catch {
      // 进程退出时迭代结束
    }
  })();

  const url = `http://127.0.0.1:${port}/`;
  return {
    pid: managed.pid,
    port,
    url,
    worktreeDir,
    script: picked.script,
    stderr: () => managed.stderr(),
    _managed: managed,
  };
}

function probeOnce(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: "/", timeout: 1_500 },
      (res) => {
        // 任意 HTTP 响应（含 3xx / 4xx）即就绪
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 每 `intervalMs` 对 `http://127.0.0.1:<port>/` 发 GET；
 * 任意 HTTP 响应即就绪。超时返回失败，可附 stderr 尾部。
 */
export async function waitReady(
  port: number,
  options: WaitReadyOptions = {},
): Promise<WaitReadyResult> {
  const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const host = options.host ?? "127.0.0.1";
  const deadline = Date.now() + Math.max(0, timeoutMs);

  for (;;) {
    const ok = await probeOnce(port, host);
    if (ok) return { ready: true };
    if (Date.now() >= deadline) {
      return {
        ready: false,
        stderrTail: options.getStderr?.() ?? "",
      };
    }
    const remaining = deadline - Date.now();
    await new Promise((r) =>
      setTimeout(r, Math.min(intervalMs, Math.max(0, remaining))),
    );
  }
}

/**
 * 回收预览进程组：SIGTERM → 3s → SIGKILL（复用 process-tree）。
 */
export async function stopAppPreview(handle: AppPreviewHandle): Promise<void> {
  try {
    await killProcessTree(handle.pid, { graceMs: 3_000, confirmTimeoutMs: 2_000 });
  } catch {
    // 尽最大努力
  }
  try {
    await handle._managed.stop();
  } catch {
    // 进程可能已被树杀
  }
}

/**
 * 确认端口已释放、可再次绑定（测试用）。
 */
export async function canBindPort(
  port: number,
  host: string = "127.0.0.1",
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ port, host, exclusive: true });
  });
}
