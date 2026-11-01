/**
 * TASK-L.15：一次性命令经 command-runner；输出脱敏。
 */
import fs from "node:fs";
import path from "node:path";
import { runCommand, redactSecrets } from "../runner/command-runner";
import type { StepResult } from "./target-adapter";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const LOG_TAIL = 8_000;

/** install/build/deploy 宿主环境白名单：禁止继承 Daemon 全量 process.env（含模型密钥等）。 */
const HOST_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TZ",
  "COLOR",
  "FORCE_COLOR",
  "NO_COLOR",
  "NODE_OPTIONS",
  "npm_config_registry",
  "NPM_CONFIG_REGISTRY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export function hostEnvAllowlist(
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of HOST_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (typeof v === "string" && v.length > 0) base[key] = v;
  }
  return { ...base, ...extra };
}

export async function runReleaseCommand(opts: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  secretValues?: string[];
  timeoutMs?: number;
  /** 发布允许访问包管理器注册表；不强制 DENY 网络 */
  allowNetwork?: boolean;
}): Promise<StepResult> {
  const started_at = new Date().toISOString();
  const executable = opts.argv[0]!;
  const args = opts.argv.slice(1);
  // 白名单 + opts.env；不 `{...process.env}`（L.15 审查三处之三）
  const mergedEnv: Record<string, string> = hostEnvAllowlist(opts.env);
  try {
    const result = await runCommand(executable, {
      cwd: opts.cwd,
      argv: { executable, args },
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputChars: 200_000,
      resolvedEnv: mergedEnv,
      secretValues: opts.secretValues ?? [],
      networkPolicy: opts.allowNetwork === false ? "DENY" : "USER_APPROVED",
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    const { text } = redactSecrets(combined, opts.secretValues ?? []);
    return {
      ok: result.exitCode === 0 && !result.timedOut && !result.aborted,
      exit_code: result.exitCode,
      argv: opts.argv,
      log_tail: text.slice(-LOG_TAIL),
      started_at,
      ended_at: new Date().toISOString(),
    };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const { text } = redactSecrets(msg, opts.secretValues ?? []);
    return {
      ok: false,
      exit_code: 1,
      argv: opts.argv,
      log_tail: text.slice(-LOG_TAIL),
      started_at,
      ended_at: new Date().toISOString(),
    };
  }
}

export async function httpHealthCheck(opts: {
  url: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; body_tail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 5_000,
  );
  try {
    const res = await fetch(opts.url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await res.text().catch(() => "");
    const ok = res.status >= 200 && res.status < 400;
    return { ok, status: res.status, body_tail: body.slice(-2_000) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body_tail: (err as Error).message ?? String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function detectInstallArgv(checkoutDir: string): string[] | null {
  const pkg = path.join(checkoutDir, "package.json");
  if (!fs.existsSync(pkg)) return null;
  if (fs.existsSync(path.join(checkoutDir, "package-lock.json"))) {
    return ["npm", "ci"];
  }
  if (fs.existsSync(path.join(checkoutDir, "pnpm-lock.yaml"))) {
    return ["pnpm", "install", "--frozen-lockfile"];
  }
  if (fs.existsSync(path.join(checkoutDir, "yarn.lock"))) {
    return ["yarn", "install", "--frozen-lockfile"];
  }
  return ["npm", "install"];
}

export function readPackageScripts(
  checkoutDir: string,
): Record<string, string> {
  const pkgPath = path.join(checkoutDir, "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}
