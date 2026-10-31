import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { resolveEnvironment } from "../worker/policy-guard";
import { type EnvSanitizerOptions } from "./env-filter";
import { killProcessTree, type ProcessTreeKillResult } from "./process-tree";
import { getActiveVault } from "../vault";

export const E_COMMAND_REJECTED = "E_COMMAND_REJECTED";
export const E_COMMAND_TIMEOUT = "E_COMMAND_TIMEOUT";
export const E_TASK_TIMEOUT = "E_TASK_TIMEOUT";
export const E_UNAUTHORIZED_COMMAND = "E_UNAUTHORIZED_COMMAND";

/** 规范 §6.3 异常 3：SIGTERM 后宽限 3s 再 SIGKILL */
export const KILL_GRACE_MS = 3_000;

/**
 * 狂暴输出防护（Chaos 场景 4）。
 * 采集采用「头窗口 + 尾窗口」双缓冲：内存占用恒为 O(maxOutputChars)，
 * 与子进程实际产量无关 —— 50MB 级狂暴输出不会撑爆 Daemon。
 */
/** 截断时保留的头部比例（其余给尾部，保证真实报错不被丢掉） */
export const OUTPUT_HEAD_RATIO = 0.6;

export class CommandSecurityError extends Error {
  readonly code: string;
  readonly command: string;

  constructor(
    message: string,
    command: string,
    code: string = E_COMMAND_REJECTED,
  ) {
    super(`[${code}] ${message} (command: '${command}')`);
    this.name = "CommandSecurityError";
    this.code = code;
    this.command = command;
  }
}

export interface CommandRunnerOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  allowedCommands?: string[];
  envOptions?: EnvSanitizerOptions;
  /** 结构化 argv（规范 §9.1）：提供后跳过 shell 字符串解析与注入字符校验 */
  argv?: { executable: string; args: string[] } | undefined;
  /** 网络策略：DENY 时注入离线约束（规范 §9.1 execution_permissions.network_policy） */
  networkPolicy?: "DENY" | "EXPLICIT_TARGETS" | "USER_APPROVED";
  /** 额外需要遮蔽的秘密值（例如 env_file_grants 注入的变量值） */
  secretValues?: string[];
  /** 用户手动中止信号：触发后同样执行全进程树回收（超时路径一致） */
  signal?: AbortSignal | undefined;
  /** 逐行实时回调（TASK-C.5 结构化终端回放）。 */
  onLine?: (stream: "stdout" | "stderr", line: string) => void;
  /**
   * 子进程 spawn 后回调 pid（TASK-D.3 / D-5）。
   * 看门狗需要精确回收这棵进程树，而 pid 只有 spawn 之后才存在。
   */
  onSpawn?: (pid: number) => void;
  /** W.3：由 policy-guard 组装好的最终环境（提供后跳过内部白名单/网络注入） */
  resolvedEnv?: Record<string, string>;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  /** 是否由用户/调用方主动 abort（AbortSignal）终止 */
  aborted: boolean;
  sanitizedEnvKeys: string[];
  /** 输出是否因超过 maxOutputChars 被截断 */
  truncated: boolean;
  /** 原始 stdout/stderr 字节数（截断后仍反映真实产量，用于诊断与审计） */
  stdoutBytes: number;
  stderrBytes: number;
  /** 输出中是否检测并遮蔽了秘密值 */
  secretRedacted: boolean;
  /** 发生回收时的进程树终结报告（未触发回收时为 undefined） */
  treeKill?: ProcessTreeKillResult | undefined;
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic 风格
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub token
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack token
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, // Bearer token
  /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*\S+/g, // KEY=value
  // JSON 形式（含小写键）："api_key": "…" / "token": "…"
  /(["']?(?:api[_-]?key|access[_-]?token|token|secret|password)["']?\s*:\s*)"[^"]*"/gi,
  // PEM 私钥块：必须整块遮蔽，单行规则看不到中间的 base64
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
];

/** 先脱敏、后有界截断（规范 TASK-A.4 PASS-5） */
export function redactSecrets(
  text: string,
  secretValues: string[] = [],
): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text;

  // TASK-L.14：保险库当前值并入精确遮蔽清单
  const fromVault = getActiveVault()?.currentValues() ?? [];
  const allSecrets = [...secretValues, ...fromVault];

  for (const secret of allSecrets) {
    if (secret && secret.length >= 6 && out.includes(secret)) {
      out = out.split(secret).join("[REDACTED]");
      redacted = true;
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      redacted = true;
      if (match.startsWith("-----BEGIN")) return "[REDACTED PRIVATE KEY BLOCK]";
      // KEY=value：保留 KEY=
      const eq = match.indexOf("=");
      if (eq > 0) return `${match.slice(0, eq + 1)}[REDACTED]`;
      // JSON：保留 "key": 前缀，值换成 "[REDACTED]"，保持 JSON 合法
      const colon = match.indexOf(":");
      if (colon > 0) return `${match.slice(0, colon + 1)}"[REDACTED]"`;
      return "[REDACTED]";
    });
  }

  return { text: out, redacted };
}

/**
 * 流式输出采集器：头窗口保留开头、尾窗口滚动保留末尾。
 * 只保留头部的旧实现会让 stdout_tail 变成「头部截断后的尾巴」——
 * 真正的报错（在输出末尾）永远看不到，是假证据。
 */
interface StreamCapture {
  decoder: StringDecoder;
  head: string;
  tail: string;
  headLimit: number;
  tailLimit: number;
  bytes: number;
  chars: number;
}

function createCapture(limit: number): StreamCapture {
  const headLimit = Math.max(1, Math.floor(limit * OUTPUT_HEAD_RATIO));
  const tailLimit = Math.max(1, limit - headLimit);
  return {
    decoder: new StringDecoder("utf-8"),
    head: "",
    tail: "",
    headLimit,
    tailLimit,
    bytes: 0,
    chars: 0,
  };
}

function pushString(capture: StreamCapture, str: string): void {
  if (!str) return;
  capture.chars += str.length;

  if (capture.head.length < capture.headLimit) {
    const need = capture.headLimit - capture.head.length;
    if (str.length <= need) {
      capture.head += str;
      return;
    }
    capture.head += str.slice(0, need);
    pushTail(capture, str.slice(need));
    return;
  }
  pushTail(capture, str);
}

function pushTail(capture: StreamCapture, str: string): void {
  if (!str) return;
  const merged = capture.tail + str;
  capture.tail =
    merged.length > capture.tailLimit
      ? merged.slice(merged.length - capture.tailLimit)
      : merged;
}

/** 采集一个原始 chunk（StringDecoder 处理跨 chunk 的多字节字符截断） */
function pushChunk(capture: StreamCapture, chunk: Buffer): void {
  capture.bytes += chunk.length;
  pushString(capture, capture.decoder.write(chunk));
}

// ---------------------------------------------------------------------------
// TASK-C.5 逐行实时回放：脱敏先行，再限单行长度
// ---------------------------------------------------------------------------

/** 单行上限（防止一行几 MB 的构建输出撑爆前端） */
export const MAX_STREAM_LINE_CHARS = 4000;

interface LineStream {
  decoder: StringDecoder;
  pending: string;
  /** 正在 PEM 私钥块内：块内所有行一律丢弃，直到 END 标记 */
  inPrivateKeyBlock: boolean;
}

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

function createLineStream(): LineStream {
  return {
    decoder: new StringDecoder("utf-8"),
    pending: "",
    inPrivateKeyBlock: false,
  };
}

/**
 * 多行私钥块遮蔽（逐行状态机）：
 * - BEGIN 行替换为占位符，块内（含 END）全部丢弃；
 * - 直到 END 才恢复输出；缺少 END 时后续全部丢弃（失败关闭）。
 */
function maskPrivateKeyBlock(ls: LineStream, line: string): string | null {
  if (ls.inPrivateKeyBlock) {
    if (PRIVATE_KEY_END.test(line)) ls.inPrivateKeyBlock = false;
    return null;
  }
  if (PRIVATE_KEY_BEGIN.test(line)) {
    ls.inPrivateKeyBlock = true;
    return "[REDACTED PRIVATE KEY BLOCK]";
  }
  return line;
}

function emitLine(
  stream: "stdout" | "stderr",
  raw: string,
  options: CommandRunnerOptions,
): void {
  // 顺序必须是「先脱敏、后截断」：截断边界不得把敏感值切成两半后漏出
  const { text } = redactSecrets(raw.replace(/\r$/, ""), options.secretValues);
  const bounded =
    text.length > MAX_STREAM_LINE_CHARS
      ? `${text.slice(0, MAX_STREAM_LINE_CHARS)} …[本行已截断]`
      : text;
  options.onLine?.(stream, bounded);
}

function pushLines(
  ls: LineStream,
  chunk: Buffer,
  stream: "stdout" | "stderr",
  options: CommandRunnerOptions,
): void {
  ls.pending += ls.decoder.write(chunk);
  const parts = ls.pending.split("\n");
  ls.pending = parts.pop() ?? "";
  for (const line of parts) {
    const masked = maskPrivateKeyBlock(ls, line);
    if (masked !== null) emitLine(stream, masked, options);
  }
}

function flushLineStream(
  ls: LineStream,
  stream: "stdout" | "stderr",
  options: CommandRunnerOptions,
): void {
  ls.pending += ls.decoder.end();
  if (ls.pending.length > 0) {
    const masked = maskPrivateKeyBlock(ls, ls.pending);
    if (masked !== null) emitLine(stream, masked, options);
    ls.pending = "";
  }
}

/** 收尾：冲刷解码器、脱敏、组装头尾截断结果 */
function finalizeCapture(
  capture: StreamCapture,
  stream: string,
  secretValues: string[] | undefined,
): { text: string; truncated: boolean; bytes: number; redacted: boolean } {
  pushString(capture, capture.decoder.end());

  const head = redactSecrets(capture.head, secretValues);
  const tail = redactSecrets(capture.tail, secretValues);
  const omitted = capture.chars - capture.head.length - capture.tail.length;

  if (omitted <= 0) {
    return {
      text: head.text + tail.text,
      truncated: false,
      bytes: capture.bytes,
      redacted: head.redacted || tail.redacted,
    };
  }

  return {
    text:
      head.text +
      `\n[... ${stream} TRUNCATED by Stagent output limit: ${capture.bytes} bytes / ` +
      `${capture.chars} chars received, ${omitted} chars omitted, showing first ` +
      `${capture.head.length} + last ${capture.tail.length} ...]\n` +
      tail.text,
    truncated: true,
    bytes: capture.bytes,
    redacted: head.redacted || tail.redacted,
  };
}

/**
 * 头尾双保留截断：保留前 60% + 后 40%，中间插入 [TRUNCATED] 标记。
 * 只留头部会把真正的失败原因（通常在输出末尾）丢掉。
 */
export function truncateOutput(
  text: string,
  limit: number,
  stream: string,
  bytes: number,
): string {
  if (text.length <= limit) return text;
  const headLen = Math.max(1, Math.floor(limit * OUTPUT_HEAD_RATIO));
  const tailLen = Math.max(1, limit - headLen);
  const omitted = text.length - headLen - tailLen;
  return (
    text.slice(0, headLen) +
    `\n[... ${stream} TRUNCATED by Stagent output limit: ${bytes} bytes / ${text.length} chars received, ` +
    `${omitted} chars omitted, showing first ${headLen} + last ${tailLen} ...]\n` +
    text.slice(-tailLen)
  );
}

/** DENY 策略下的离线环境约束（非对抗性沙箱，见 ADR-003） */
function stripQuotedStrings(str: string): string {
  return str
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * Checks whether a command string contains potentially dangerous shell chaining/injection operators.
 */
export function validateCommandSafety(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new CommandSecurityError("Command cannot be empty", command);
  }

  // Detect unquoted shell injection / chaining patterns
  const unquoted = stripQuotedStrings(trimmed);

  const dangerousPatterns = [
    { regex: /[\r\n]/, desc: "newline injection" },
    { regex: /;\s*/, desc: "command chaining with semicolon ';'" },
    { regex: /\|\|/, desc: "conditional execution '||'" },
    { regex: /(?<!\\)\|/, desc: "pipe '|'" },
    { regex: /&&/, desc: "conditional execution '&&'" },
    { regex: /`/, desc: "backtick evaluation '`'" },
    { regex: /\$\(/, desc: "command substitution '$()'" },
    { regex: /(?:^|\s)(?:>>|>|<)(?:\s|$)/, desc: "stream redirection" },
  ];

  for (const { regex, desc } of dangerousPatterns) {
    if (regex.test(unquoted)) {
      throw new CommandSecurityError(
        `Command contains forbidden shell operator: ${desc}`,
        command,
      );
    }
  }
}

/**
 * Runs a sanitized, whitelisted command inside a designated worktree.
 */
export async function runCommand(
  command: string,
  options: CommandRunnerOptions,
): Promise<CommandResult> {
  const structured = options.argv;
  const trimmedCmd = structured
    ? [structured.executable, ...structured.args].join(" ")
    : command.trim();
  // 结构化 argv 不经 shell，无需（也不应）对其参数内容做 shell 操作符校验
  if (!structured) validateCommandSafety(trimmedCmd);

  // Whitelist verification if configured.
  // 只接受精确匹配：旧实现允许「授权命令 + 空格 + 任意追加」，等于把追加参数
  // 交给 shell 语义解释；W.3 起追加参数必须先在网关层通过参数策略校验。
  if (options.allowedCommands && options.allowedCommands.length > 0) {
    const isWhitelisted = options.allowedCommands.some(
      (allowed) => trimmedCmd === allowed.trim(),
    );

    if (!isWhitelisted) {
      throw new CommandSecurityError(
        `Command '${trimmedCmd}' is not in authorized verification commands whitelist`,
        trimmedCmd,
        E_UNAUTHORIZED_COMMAND,
      );
    }
  }

  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputChars = options.maxOutputChars ?? 100_000;
  const env =
    options.resolvedEnv ??
    resolveEnvironment(process.env, options.envOptions, options.networkPolicy);

  const startTime = Date.now();
  let timedOut = false;
  let aborted = false;
  // 头/尾双窗口采集：内存恒为 O(maxOutputChars)，与子进程产量无关
  const stdoutCapture = createCapture(maxOutputChars);
  const stderrCapture = createCapture(maxOutputChars);
  // TASK-C.5：逐行实时回放（仅当调用方订阅时创建）
  const stdoutLines = options.onLine ? createLineStream() : null;
  const stderrLines = options.onLine ? createLineStream() : null;

  // Split command line into executable and arguments safely
  // Note: we run without shell: true to prevent subshell vulnerabilities
  const parts = structured
    ? []
    : trimmedCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (!structured && parts.length === 0) {
    throw new CommandSecurityError(
      "Failed to parse command arguments",
      trimmedCmd,
    );
  }

  const executable = structured ? structured.executable : parts[0];
  if (!executable) {
    throw new CommandSecurityError("Executable missing in command", trimmedCmd);
  }
  const args = structured
    ? structured.args
    : parts.slice(1).map((arg) => {
        if (
          (arg.startsWith('"') && arg.endsWith('"')) ||
          (arg.startsWith("'") && arg.endsWith("'"))
        ) {
          return arg.slice(1, -1);
        }
        return arg;
      });

  return new Promise<CommandResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // 独立进程组：pgid === child.pid，使负 pid 信号能覆盖所有后代进程
        // （detached 后代被托孤后 pgid 不变，仍可被组信号终结）
        detached: true,
      });
    } catch (err) {
      return reject(err);
    }

    // TASK-D.3 / D-5：把 pid 交给看门狗，超时兜底时才能精确回收这棵进程树
    if (child.pid !== undefined) options.onSpawn?.(child.pid);

    let settled = false;
    let killReport: ProcessTreeKillResult | undefined;
    let killPromise: Promise<ProcessTreeKillResult> | null = null;

    /**
     * 全树回收：SIGTERM → 宽限 → SIGKILL → 确认进程组消失。
     * 超时与 abort 共用同一条路径，杜绝后代孤儿残留。
     */
    const terminateTree = (): void => {
      if (killPromise || !child.pid) return;
      killPromise = killProcessTree(child.pid, { graceMs: KILL_GRACE_MS }).then(
        (report) => {
          killReport = report;
          return report;
        },
      );
    };

    let timeoutTimer: NodeJS.Timeout | null = null;
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateTree();
      }, timeoutMs);
    }

    const abortHandler = (): void => {
      if (settled) return;
      aborted = true;
      terminateTree();
    };
    if (options.signal) {
      if (options.signal.aborted) abortHandler();
      else
        options.signal.addEventListener("abort", abortHandler, { once: true });
    }

    const finish = async (exitCode: number | null): Promise<void> => {
      if (settled) return;
      // 触发过回收时必须等确认整棵树退出，避免后代进程残留
      if (killPromise) {
        try {
          await killPromise;
        } catch {
          // 回收失败不阻断结果返回，但 confirmed=false 会体现在报告中
        }
      }
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener("abort", abortHandler);

      // 先把行缓冲里最后一段（无换行结尾）冲出去，再收尾
      if (stdoutLines) flushLineStream(stdoutLines, "stdout", options);
      if (stderrLines) flushLineStream(stderrLines, "stderr", options);

      const durationMs = Date.now() - startTime;

      // 规范 TASK-A.4 PASS-5：先脱敏，再组装截断结果
      const out = finalizeCapture(
        stdoutCapture,
        "stdout",
        options.secretValues,
      );
      const err = finalizeCapture(
        stderrCapture,
        "stderr",
        options.secretValues,
      );
      const truncated = out.truncated || err.truncated;

      resolve({
        command: trimmedCmd,
        exitCode: timedOut ? 124 : aborted ? 130 : (exitCode ?? 1),
        stdout: out.text,
        stderr: err.text,
        durationMs,
        timedOut,
        aborted,
        stdoutBytes: out.bytes,
        stderrBytes: err.bytes,
        sanitizedEnvKeys: Object.keys(env).sort(),
        truncated,
        secretRedacted: out.redacted || err.redacted,
        ...(killReport === undefined ? {} : { treeKill: killReport }),
      });
    };

    // 流式采集：头窗口 + 尾窗口，内存不随产量增长
    child.stdout?.on("data", (chunk: Buffer) => {
      pushChunk(stdoutCapture, chunk);
      if (stdoutLines) pushLines(stdoutLines, chunk, "stdout", options);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      pushChunk(stderrCapture, chunk);
      if (stderrLines) pushLines(stderrLines, chunk, "stderr", options);
    });

    child.on("error", (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener("abort", abortHandler);
      if (settled) return;
      settled = true;
      // spawn 失败（ENOENT 等）也可能留下部分后代，兜底回收
      if (child.pid) void killProcessTree(child.pid, { graceMs: 0 });
      reject(err);
    });

    child.on("close", (exitCode) => {
      void finish(exitCode);
    });
  });
}
