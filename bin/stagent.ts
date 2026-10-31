#!/usr/bin/env -S npx tsx
/**
 * Stagent CLI 入口（规范 TASK-D.1 / TASK-D.1b）
 *
 * 用法:
 *   stagent open  [路径] [--port <n>] [--ui-url <url>] [--no-browser]
 *   stagent start [--repo <path>] [--port <n>] [--ui-url <url>] [--no-browser]
 *   stagent status [--repo <path>]
 *   stagent check obligations --report <path> [--phase t|i]
 *   stagent check test-integrity --base <path> --candidate <path> [--lang <lang>]
 *   stagent check knowledge --base <sha> --candidate <sha> --contract-id <id> [--all]
 *
 * 安全约定（A §6.1 / B TASK-D.1 / D.1b）：
 * - Daemon 仅绑定 127.0.0.1，动态端口 3001~3010；
 * - Token 落盘 <repo>/.stagent/session-token（0600），绝不打印明文；
 * - 唤起浏览器时 Token 仅通过 URL fragment（#token=）传递 —— fragment 不随
 *   HTTP 请求发送、不进服务端日志；严禁使用 ?token= query（规范 FAIL 项）。
 * - URL 安全守卫：--ui-url / STAGENT_UI_URL 仅允许 http://localhost:* 或
 *   http://127.0.0.1:*；外网地址一律报错拒绝启动。
 * - TASK-D.1b：`open` 在有 dist/public 时同源托管控制台，单窗口即可聊；
 *   无构建产物时回退 Vite，并把真实 Daemon 地址写入 fragment `base=`，
 *   避免前端死认 3001。
 */
import path from "node:path";
import { formatVersion, readCliVersion } from "./version";
import fs from "node:fs";
import {
  classifyRun,
  type ObligationRunClass,
} from "../src/lib/verification/obligations";
import {
  detectTestWeakening,
  type TestIntegrityLang,
} from "../daemon/guard/test-integrity";
import { checkKnowledge } from "../daemon/knowledge/check-knowledge";
import type { DesignNote } from "../src/lib/design/design-note";

import process from "node:process";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createDaemon } from "../daemon/server";
import { injectLocalModelEnv } from "../daemon/core/local-env";
import {
  createSupervisorEnrich,
  isSupervisorEnrichConfigured,
} from "../daemon/supervisor/enrich-openai";
import { readPidLock, PidLockError } from "../daemon/core/pid-lock";
import { sessionTokenPath } from "../daemon/core/session-token";
import { recordRecentProject } from "../daemon/core/recent-projects";
import {
  assertLoopbackUiUrl,
  buildUiLaunchUrl,
  resolveConsoleUiTarget,
  tryReuseRunningDaemon,
} from "../daemon/core/open-workspace";
import { ensureGitInit, inspectGitRepo } from "../daemon/git/ensure-git-repo";

// 兼容 D.1b 单测：仍从本模块 re-export
export {
  assertLoopbackUiUrl,
  buildUiLaunchUrl,
  resolveConsoleUiTarget,
  tryReuseRunningDaemon,
};

export type CliCommand = "open" | "start" | "status" | "help" | "version" | "check";

export interface CliOptions {
  command: CliCommand;
  repo: string;
  port?: number;
  /** Web UI 地址（默认 http://localhost:5173，可用 STAGENT_UI_URL 覆盖） */
  uiUrl: string;
  /** 启动后不唤起浏览器（或 STAGENT_NO_BROWSER=1） */
  noBrowser: boolean;
  /** `stagent check ...` 时，"check" 之后的剩余 argv */
  checkArgv?: string[];
}

export const DEFAULT_UI_URL = "http://localhost:5173";

export function parseArgs(argv: string[]): CliOptions {
  const rawCommand = argv[0];
  let command: CliCommand;
  let cursor = 0;
  if (
    rawCommand === "open" ||
    rawCommand === "start" ||
    rawCommand === "status" ||
    rawCommand === "help" ||
    rawCommand === "version" ||
    rawCommand === "check"
  ) {
    command = rawCommand;
    cursor = 1;
  } else if (rawCommand === undefined) {
    command = "help";
    cursor = 0;
  } else if (rawCommand.startsWith("-")) {
    // 无子命令时的旗标：回退 help（保持 D.1 行为）
    command = "help";
    cursor = 0;
  } else {
    command = "help";
    cursor = 0;
  }

  if (command === "check") {
    const base: Omit<CliOptions, "command"> = {
      repo: process.cwd(),
      uiUrl: process.env["STAGENT_UI_URL"] ?? DEFAULT_UI_URL,
      noBrowser: process.env["STAGENT_NO_BROWSER"] === "1",
      checkArgv: argv.slice(1),
    };
    return { command, ...base };
  }

  let repo = process.cwd();
  let port: number | undefined;
  let uiUrl = process.env["STAGENT_UI_URL"] ?? DEFAULT_UI_URL;
  let noBrowser = process.env["STAGENT_NO_BROWSER"] === "1";
  let positionalRepo: string | undefined;

  for (let i = cursor; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo" && argv[i + 1]) {
      repo = path.resolve(argv[i + 1] as string);
      i += 1;
    } else if (arg === "--port" && argv[i + 1]) {
      port = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--ui-url" && argv[i + 1]) {
      uiUrl = argv[i + 1] as string;
      i += 1;
    } else if (arg === "--no-browser") {
      noBrowser = true;
    } else if (arg && !arg.startsWith("-") && positionalRepo === undefined) {
      // `stagent open <路径>` 位置参数
      positionalRepo = path.resolve(arg);
    }
  }

  if (positionalRepo !== undefined) {
    repo = positionalRepo;
  }

  const base: Omit<CliOptions, "command"> = {
    repo,
    uiUrl,
    noBrowser,
    ...(port === undefined ? {} : { port }),
  };
  return { command, ...base };
}

/**
 * 各平台的浏览器唤起命令（结构化 argv，绝无 shell 拼接）。
 */
export function resolveBrowserOpener(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") {
    return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  }
  return ["xdg-open", [url]];
}

/** 唤起浏览器（fire-and-forget；失败不阻断 Daemon，仅提示手动打开） */
export function openBrowser(url: string): Promise<boolean> {
  const [cmd, args] = resolveBrowserOpener(url);
  return new Promise((resolve) => {
    const child = execFile(cmd, args, (err) => {
      resolve(!err);
    });
    child.on("error", () => resolve(false));
  });
}

function printHelp(): void {
  console.log(`${formatVersion(readCliVersion())} — 本地任务副驾与验收控制台

用法:
  stagent open  [路径] [--port <n>] [--ui-url <url>] [--no-browser]
                                   一键打开项目：启动/复用 Daemon，自动打开已连上的工作台
  stagent start [--repo <path>] [--port <n>] [--ui-url <url>] [--no-browser]
                                   启动本地 Daemon（仅绑定 127.0.0.1，端口 3001~3010）
  stagent status [--repo <path>]   查看当前仓库 Daemon 状态
  stagent check obligations --report <path> [--phase t|i]
                                   读运行报告分类；无 --phase 时 0=green；
                                   --phase t 期望 red；--phase i 期望 green
  stagent check test-integrity --base <path> --candidate <path> [--lang ts|js|py|go|rs]
  stagent check knowledge --base <sha> --candidate <sha> --contract-id <id>
                          [--worktree <path>] [--design-note <path>] [--all]
                                   比对基线与候选测试，检测削弱（退出码 0=未削弱）
  stagent version                  显示版本号
  stagent help                     显示帮助

安全说明:
  - 服务仅监听回环地址；WebSocket 连接建立后首帧 AUTH 鉴权，失败以 4401 断开
  - Token 位于 <repo>/.stagent/session-token（权限 0600），日志不打印明文
  - 唤起浏览器时 Token 经 URL fragment 传递，绝不使用 ?token= query
  - --ui-url / STAGENT_UI_URL 仅允许 http://localhost:* 或 http://127.0.0.1:*，
    外网地址一律拒绝启动（防止 #token= 外泄）
  - 有 dist/public 时 open 同源托管控制台（单窗口）；Demo 仍独立 Origin（4100~4110）
`);
}

function formatLockConflict(err: unknown): string {
  if (err instanceof PidLockError) {
    return err.message;
  }
  return (err as Error).message;
}

async function launchConsole(options: {
  uiUrl: string;
  token: string;
  daemonBaseUrl: string;
  sameOrigin: boolean;
  noBrowser: boolean;
}): Promise<void> {
  if (options.noBrowser || !options.token) {
    console.log(
      `  控制台: ${options.uiUrl}（未自动唤起；请手动打开并按页面提示连接）`,
    );
    return;
  }
  const launchUrl = buildUiLaunchUrl(options.uiUrl, options.token, {
    ...(options.sameOrigin ? {} : { daemonBaseUrl: options.daemonBaseUrl }),
  });
  const opened = await openBrowser(launchUrl);
  const mode = options.sameOrigin ? "同源托管" : "跨端口（已写入 base=）";
  console.log(
    opened
      ? `  控制台: ${options.uiUrl}（已在浏览器打开，Token 经 #fragment 注入，${mode}）`
      : `  控制台: ${options.uiUrl}（浏览器唤起失败，请手动打开带 #token= 的地址）`,
  );
}

async function runOpenOrStart(
  options: CliOptions,
  mode: "open" | "start",
): Promise<void> {
  // open：优先复用已有健康 Daemon（无需第二终端、无需手拷 Token）
  if (mode === "open") {
    const reused = await tryReuseRunningDaemon(options.repo);
    if (reused) {
      console.log(`Stagent Daemon 已在运行，复用中`);
      console.log(`  地址:  http://127.0.0.1:${reused.port}`);
      console.log(`  Token: ${sessionTokenPath(options.repo)} (0600)`);
      const target = resolveConsoleUiTarget({
        daemonPort: reused.port,
        uiUrl: options.uiUrl,
        forceUiUrl: process.env["STAGENT_UI_URL"] !== undefined,
      });
      if (!target.sameOrigin) {
        console.log(
          `  提示: 未找到 dist/public，回退 ${target.uiUrl}（可先 npm run build 启用单窗口同源）`,
        );
      }
      await launchConsole({
        uiUrl: target.uiUrl,
        token: reused.token,
        daemonBaseUrl: target.daemonBaseUrl,
        sameOrigin: target.sameOrigin,
        noBrowser: options.noBrowser,
      });
      // TASK-D.1c：成功打开后写入本机最近项目（非业务仓）
      try {
        recordRecentProject(options.repo);
      } catch {
        // 最近列表写入失败不阻断打开
      }
      // 复用场景：CLI 打开浏览器后退出，Daemon 由原进程托管
      return;
    }
  }

  // URL 安全守卫：在任何副作用之前校验（仅当会用到外部 uiUrl 时）
  try {
    assertLoopbackUiUrl(options.uiUrl);
  } catch (err) {
    console.error(`[stagent] ${(err as Error).message}`);
    process.exit(1);
  }

  const envInject = injectLocalModelEnv(options.repo);
  if (envInject.envFile.loaded) {
    console.log(
      `  环境: 已加载 ${envInject.envFile.injectedKeys.length} 项本机变量` +
        (envInject.mappedKeys.length > 0
          ? `（并映射 ${envInject.mappedKeys.length} 项 OpenAI 兼容键）`
          : ""),
    );
  } else {
    console.log(
      `  环境: 未找到 ${envInject.envFile.path}（L1 补全将不可用，草案仍可走纯 L0）`,
    );
  }

  const supervisorEnrich = isSupervisorEnrichConfigured()
    ? createSupervisorEnrich({ repoRoot: options.repo })
    : undefined;
  if (supervisorEnrich) {
    console.log(`  L1 补全: 已启用（DeepSeek / OpenAI 兼容口）`);
  } else {
    console.log(`  L1 补全: 未配置密钥（出草案默认纯 L0）`);
  }

  // TASK-H.4：无 .git 时友好自动 init（已有仓幂等跳过，绝不破坏历史）
  const gitInfo = inspectGitRepo(options.repo);
  if (!gitInfo.hasGit) {
    const initResult = ensureGitInit(options.repo, { confirm: true });
    if (!initResult.ok) {
      console.error(`[stagent] ${initResult.message}`);
      if (initResult.error) console.error(`  详情: ${initResult.error}`);
      process.exit(1);
    }
    console.log(`  Git: ${initResult.message}`);
  }

  let daemon;
  try {
    daemon = createDaemon({
      repoRoot: options.repo,
      ...(options.port === undefined
        ? {}
        : { startPort: options.port, endPort: options.port }),
      autoShutdownSignals: true,
      ...(supervisorEnrich === undefined ? {} : { supervisorEnrich }),
    });
  } catch (err) {
    console.error(`[stagent] ${formatLockConflict(err)}`);
    process.exit(1);
  }

  let info: { port: number; pid: number };
  try {
    info = await daemon.start();
  } catch (err) {
    console.error(`[stagent] ${formatLockConflict(err)}`);
    process.exit(1);
  }

  console.log(`Stagent Daemon 已启动`);
  console.log(`  地址:  http://127.0.0.1:${info.port}`);
  console.log(`  PID:   ${info.pid}`);
  console.log(`  Token: ${sessionTokenPath(options.repo)} (0600)`);

  const token = daemon.getSessionToken() ?? "";
  const target = resolveConsoleUiTarget({
    daemonPort: info.port,
    uiUrl: options.uiUrl,
    forceUiUrl: mode === "start" || process.env["STAGENT_UI_URL"] !== undefined,
  });
  // start 保持旧行为：默认走 --ui-url / Vite；open 优先同源
  const effective =
    mode === "open"
      ? target
      : {
          uiUrl: options.uiUrl,
          sameOrigin: false,
          daemonBaseUrl: `http://127.0.0.1:${info.port}`,
        };

  if (mode === "open" && !effective.sameOrigin) {
    console.log(
      `  提示: 未找到 dist/public，回退 ${effective.uiUrl}（可先 npm run build 启用单窗口同源）`,
    );
  }

  await launchConsole({
    uiUrl: effective.uiUrl,
    token,
    daemonBaseUrl: effective.daemonBaseUrl,
    sameOrigin: effective.sameOrigin,
    noBrowser: options.noBrowser,
  });

  // TASK-D.1c：open/start 成功后写入本机最近项目
  try {
    recordRecentProject(options.repo);
  } catch {
    // ignore
  }

  console.log(`按下 Ctrl+C 停止`);

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const CHECK_LANGS = new Set([
  "ts",
  "js",
  "tsx",
  "jsx",
  "py",
  "go",
  "rs",
]);

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function parseCheckFlag(
  argv: readonly string[],
  name: string,
): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) return undefined;
  const value = argv[idx + 1];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * TASK-L.3：`stagent check` 子命令（纯本地，不启 Daemon）。
 * 返回进程退出码；JSON 结果写入 stdout（测试可捕获）。
 */
export function runCheckCommand(checkArgv: readonly string[]): {
  exitCode: number;
  stdout: string;
} {
  const sub = checkArgv[0];
  if (sub === "obligations") {
    const reportPath = parseCheckFlag(checkArgv, "--report");
    const phaseRaw = parseCheckFlag(checkArgv, "--phase");
    if (!reportPath) {
      const stdout = JSON.stringify({
        ok: false,
        error: "missing --report <path>",
      });
      return { exitCode: 1, stdout };
    }
    if (
      phaseRaw !== undefined &&
      phaseRaw !== "t" &&
      phaseRaw !== "i"
    ) {
      const stdout = JSON.stringify({
        ok: false,
        error: 'invalid --phase; use "t" or "i"',
      });
      return { exitCode: 1, stdout };
    }
    try {
      const report = readJsonFile(path.resolve(reportPath));
      const classification: ObligationRunClass = classifyRun(report);
      // 无 --phase：保持 L.3 行为（green → 0）
      if (phaseRaw === undefined) {
        const ok = classification === "green";
        const stdout = JSON.stringify({
          ok,
          classification,
          report: path.resolve(reportPath),
        });
        return { exitCode: ok ? 0 : 1, stdout };
      }
      // TASK-L.4：分段期望
      let ok = false;
      let reason_code:
        | "OBLIGATION_NOT_RED"
        | "OBLIGATION_RED_INVALID"
        | "OBLIGATION_NOT_GREEN"
        | undefined;
      if (phaseRaw === "t") {
        if (classification === "red") {
          ok = true;
        } else if (classification === "red_invalid") {
          reason_code = "OBLIGATION_RED_INVALID";
        } else {
          reason_code = "OBLIGATION_NOT_RED";
        }
      } else {
        // phase i
        if (classification === "green") {
          ok = true;
        } else {
          reason_code = "OBLIGATION_NOT_GREEN";
        }
      }
      const stdout = JSON.stringify({
        ok,
        classification,
        phase: phaseRaw,
        ...(reason_code === undefined ? {} : { reason_code }),
        report: path.resolve(reportPath),
      });
      return { exitCode: ok ? 0 : 1, stdout };
    } catch (err) {
      const stdout = JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return { exitCode: 1, stdout };
    }
  }

  if (sub === "test-integrity") {
    const basePath = parseCheckFlag(checkArgv, "--base");
    const candidatePath = parseCheckFlag(checkArgv, "--candidate");
    const langRaw = parseCheckFlag(checkArgv, "--lang") ?? "ts";
    if (!basePath || !candidatePath) {
      const stdout = JSON.stringify({
        ok: false,
        error: "missing --base <path> and/or --candidate <path>",
      });
      return { exitCode: 1, stdout };
    }
    if (!CHECK_LANGS.has(langRaw)) {
      const stdout = JSON.stringify({
        ok: false,
        error: `unsupported --lang ${langRaw}`,
      });
      return { exitCode: 1, stdout };
    }
    try {
      const baseText = fs.readFileSync(path.resolve(basePath), "utf8");
      const candidateText = fs.readFileSync(
        path.resolve(candidatePath),
        "utf8",
      );
      const result = detectTestWeakening(
        baseText,
        candidateText,
        langRaw as TestIntegrityLang,
      );
      const stdout = JSON.stringify({
        ok: !result.weakened,
        weakened: result.weakened,
        reasons: result.reasons,
        base_assertion_count: result.base_assertion_count,
        candidate_assertion_count: result.candidate_assertion_count,
      });
      return { exitCode: result.weakened ? 1 : 0, stdout };
    } catch (err) {
      const stdout = JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return { exitCode: 1, stdout };
    }
  }

  if (sub === "knowledge") {
    const baseSha = parseCheckFlag(checkArgv, "--base");
    const candidateSha = parseCheckFlag(checkArgv, "--candidate");
    const contractId = parseCheckFlag(checkArgv, "--contract-id");
    const worktreeFlag = parseCheckFlag(checkArgv, "--worktree");
    const designNoteFlag = parseCheckFlag(checkArgv, "--design-note");
    const allSourceFiles = checkArgv.includes("--all");
    if (!baseSha || !candidateSha || !contractId) {
      const stdout = JSON.stringify({
        ok: false,
        error:
          "missing --base <sha> and/or --candidate <sha> and/or --contract-id <id>",
      });
      return { exitCode: 1, stdout };
    }
    const worktreeDir = path.resolve(worktreeFlag ?? process.cwd());
    let designNote: DesignNote | null = null;
    const designNotePath =
      designNoteFlag !== undefined
        ? path.resolve(designNoteFlag)
        : path.join(
            worktreeDir,
            ".stagent",
            "records",
            contractId,
            "design-note.json",
          );
    try {
      if (fs.existsSync(designNotePath)) {
        designNote = JSON.parse(
          fs.readFileSync(designNotePath, "utf8"),
        ) as DesignNote;
      }
    } catch {
      designNote = null;
    }
    try {
      const result = checkKnowledge({
        worktreeDir,
        baseSha,
        candidateSha,
        contractId,
        designNote,
        allSourceFiles,
      });
      const stdout = JSON.stringify({
        ok: result.ok,
        ...(result.ok
          ? {}
          : { reason_code: "KNOWLEDGE_DRIFT" as const }),
        failures: result.failures,
      });
      return { exitCode: result.ok ? 0 : 1, stdout };
    } catch (err) {
      const stdout = JSON.stringify({
        ok: false,
        reason_code: "KNOWLEDGE_DRIFT",
        error: err instanceof Error ? err.message : String(err),
        failures: [],
      });
      return { exitCode: 1, stdout };
    }
  }

  const stdout = JSON.stringify({
    ok: false,
    error:
      'unknown check subcommand; use "obligations", "test-integrity", or "knowledge"',
  });
  return { exitCode: 1, stdout };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "help") {
    printHelp();
    return;
  }

  if (options.command === "check") {
    const result = runCheckCommand(options.checkArgv ?? []);
    console.log(result.stdout);
    process.exitCode = result.exitCode;
    return;
  }

  if (options.command === "version") {
    console.log(formatVersion(readCliVersion()));
    return;
  }

  if (options.command === "status") {
    const lock = readPidLock(options.repo);
    if (!lock) {
      console.log(`Stagent Daemon 未运行（repo: ${options.repo}）`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Stagent Daemon 运行中: pid=${lock.pid} port=${lock.port} started_at=${lock.startedAt}`,
    );
    return;
  }

  if (options.command === "open" || options.command === "start") {
    await runOpenOrStart(options, options.command);
    return;
  }
}

// 入口守卫：仅当作为主程序执行时运行，允许测试 import 纯函数
const invokedAsMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsMain) {
  void main().catch((err) => {
    console.error("[stagent] 启动失败:", formatLockConflict(err));
    process.exit(1);
  });
}
