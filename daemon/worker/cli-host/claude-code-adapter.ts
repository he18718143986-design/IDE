import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatAdapterInfo } from "../../../src/lib/chat-events";
import type {
  AdapterEvent,
  AdapterRunInput,
  ChatAdapter,
} from "../../chat/types";
import { spawnManaged, type ManagedProcess } from "./process-host";

/**
 * TASK-W.5a Claude Code 适配器（headless + stream-json）。
 *
 * 用户决定（2026-10-20）：一律使用 ANTHROPIC_API_KEY 按量计费。
 * 隔离方式（Tina 已于 2026-10-20 批准，权威决策见 docs/adr/0013-cli-isolation-without-bare.md；
 * 原实测档案 docs/archive/claude-code-isolation-design.md 已于 2026-10-27 移除，原文查 Git 历史）：以
 * `--setting-sources ""` + `--tools` 启动（规范写的是 --bare，但实测 2.1.296 的 --bare 会连
 * --settings 里的 hooks 一起跳过）—— 不加载仓库里的 .claude/settings.json hooks 与 .mcp.json（否则是绕过口），
 * 只加载 Stagent 生成的 `--settings` 与 `--mcp-config`（配合 --strict-mcp-config）。
 *
 * 硬限制不只靠 hook（hook 崩溃 / 超时 / exit 1 会放行）：同时用 --disallowedTools 与
 * permissions.deny 收窄；永不使用 bypassPermissions；续接只用 `--resume <session_id>`。
 *
 * TASK-J.1（P0 安全）：角色分档。`partner`（默认）= 方案工作台右栏搭档，工具集恒为
 * Read/Glob/Grep（列目录经 Glob；LS 不由 CLI 2.1.296 提供），permission-mode 恒为 default（绝不用 acceptEdits），写类工具进
 * --disallowedTools 与 permissions.deny；`worker` = 施工路径，保持既有可写行为。
 * 右栏永远由 `defaultChatAdapters` 显式以 partner 构造，不依赖调用方记得传参。
 *
 * control_mode 在 4 类绕过负例于真实 CLI 版本实测通过前恒为 UNCONTROLLED_EXTERNAL，
 * verified_on 为空。
 */
/** 角色：`partner` = 右栏只读搭档（默认）；`worker` = 施工工人（可写，仅 Worker 路径） */
export type ClaudeCodeRole = "partner" | "worker";

export interface ClaudeCodeAdapterOptions {
  /** CLI 可执行文件，默认 "claude"（命名可配置） */
  command?: string;
  /** API Key 来源，默认读取 Daemon 进程的 ANTHROPIC_API_KEY；只注入子进程环境 */
  apiKey?: () => string | undefined;
  /**
   * 角色，默认 "partner"（失败关闭：忘记传参时按右栏只读处理）。
   * worker 仅供合同执行路径使用，不得进右栏。
   */
  role?: ClaudeCodeRole;
  /** 允许 Bash（默认否）；partner 角色下恒被忽略 */
  allowBash?: boolean;
  /** 实测通过记录（CLI 版本 + 日期），未实测保持空 */
  verifiedOn?: string;
  /** 测试可替换 spawn */
  spawn?: typeof spawnManaged;
  /** 临时配置目录 */
  tmpRoot?: string;
  /**
   * Claude Code 专用配置目录（CLAUDE_CONFIG_DIR），默认不设置。
   * Daemon 传入 `<repo>/.stagent/claude-config`：会话记录、自动记忆、.claude.json 都写在这里，
   * 不写用户个人的 ~/.claude；目录固定（不是临时目录），否则 --resume 跨重启找不到会话。
   */
  configDir?: string;
  /** TASK-W.8：受管 MCP HTTP 端点 URL 或解析器（Worker 角色写入 mcp.json） */
  mcpServerUrl?: string | (() => string | undefined);
  /** TASK-W.8：Daemon 端口号或解析器（用于动态合成 http://127.0.0.1:<port>/api/mcp） */
  mcpPort?: number | (() => number | undefined);
  /** TASK-W.8：MCP 认证 Token 或解析器（注入 mcpServers.stagent.headers.Authorization） */
  authToken?: string | (() => string | undefined);
}

/**
 * 实测记录：2026-10-20 首次实测（Tina 批准），2026-10-21 步骤 D 以
 * `deepseek-chat` @ `https://api.deepseek.com/anthropic` 复跑真实 CLI 负例 4/4 全绿后回填。
 * 证据见 docs/adr/0013-cli-isolation-without-bare.md（原实测档案 docs/archive/claude-code-isolation-design.md §4 已移除，查 Git 历史）
 * （原独立验证报告 docs/reports/W5a-真实CLI验证报告-2026-10-21.md 已于 2026-10-25 目录精简时删除，
 * 结论已并入上述两处，**切勿再引用该路径**）。
 * 官方 Anthropic 原装模型复测为后续回归项，不阻塞。
 */
export const CLAUDE_CODE_VERIFIED_ON =
  "Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21";

/** 准备专用配置目录：不存在则创建，权限恒为 0700 */
export function ensureConfigDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

export const HOOK_SCRIPT = fileURLToPath(
  new URL("./pretool-hook.mjs", import.meta.url),
);

/**
 * hook 命令里使用的脚本路径：统一为正斜杠。
 * Windows 上反斜杠交给 shell 时会被当作转义符（JSON.stringify 会把它再转义成双反斜杠），
 * 正斜杠不会被 shell 当作转义符，且 Node 在 Windows 上接受正斜杠路径。
 */
export const HOOK_COMMAND_PATH = HOOK_SCRIPT.replace(/\\/g, "/");

/** 右栏搭档的全部可用工具：只读、可搜、可列目录 */
export const PARTNER_TOOLS = ["Read", "Glob", "Grep"] as const;

/** partner 角色在三个层面（--tools / --disallowedTools / permissions.deny）一并封禁的工具 */
export const PARTNER_DENIED_TOOLS = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "TodoWrite",
] as const;

/** worker 角色的可写工具集（既有行为，仅供合同执行路径） */
const BASE_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "MultiEdit",
  "TodoWrite",
];
const ALWAYS_DENY = ["WebFetch", "WebSearch", "NotebookEdit", "Task"];

export function redactSecret(text: string, secret: string | undefined): string {
  let out = secret ? text.split(secret).join("[REDACTED]") : text;
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
  return out;
}

export interface BuiltLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  settingsPath: string;
  mcpPath: string;
}

export class ClaudeCodeAdapter implements ChatAdapter {
  constructor(private readonly opts: ClaudeCodeAdapterOptions = {}) {}

  private key(): string | undefined {
    return (this.opts.apiKey ?? (() => process.env["ANTHROPIC_API_KEY"]))();
  }

  /** 默认 partner：没显式声明就是右栏只读搭档 */
  private role(): ClaudeCodeRole {
    return this.opts.role ?? "partner";
  }

  info(): ChatAdapterInfo {
    const hasKey = !!this.key();
    return {
      id: "claude-code",
      label: "Claude Code",
      control_mode: this.opts.verifiedOn
        ? "GATEWAY_ENFORCED"
        : "UNCONTROLLED_EXTERNAL",
      verified_on: this.opts.verifiedOn ?? "",
      available: hasKey,
      tool_mode: this.role() === "partner" ? "read_only" : "read_write",
      ...(hasKey ? {} : { unavailable_reason: "还差一步：去设置里配模型钥匙" }),
    };
  }

  /** 生成 argv / env / 配置文件（纯构建，便于测试断言） */
  buildLaunch(
    input: Pick<AdapterRunInput, "prompt" | "cwd" | "nativeSessionId">,
  ): BuiltLaunch {
    const dir = fs.mkdtempSync(
      path.join(this.opts.tmpRoot ?? os.tmpdir(), "stagent-claude-"),
    );
    const role = this.role();
    const partner = role === "partner";
    // partner 硬约束：allowBash 一律忽略（右栏不允许 shell），不靠调用方自觉
    const allowBash = !partner && this.opts.allowBash === true;
    // partner 永不接受编辑：默认模式下未授权工具直接拒绝，而不是 acceptEdits 放行
    const permissionMode = partner ? "default" : "acceptEdits";
    // 工具名层面的封禁：ALWAYS_DENY ∪ 无 Bash 授权时的 Bash ∪ partner 全部写类工具。
    // 去重是为了让 argv / settings 可逐字断言（NotebookEdit 会同时出现在两处）。
    const deniedToolNames = [
      ...new Set([
        ...ALWAYS_DENY,
        ...(allowBash ? [] : ["Bash"]),
        ...(partner ? PARTNER_DENIED_TOOLS : []),
      ]),
    ];
    const deny = [
      ...deniedToolNames,
      "Edit(./.git/**)",
      "Edit(./.stagent/**)",
      "Edit(./.claude/**)",
      "Write(./.git/**)",
      "Write(./.stagent/**)",
      "Write(./.claude/**)",
      // 专用配置目录（含会话记录）：不许读，也不许写（写已被 .stagent/** 覆盖）
      "Read(./.stagent/claude-config/**)",
      "Read(./.stagent/session-token)",
    ];
    const settings = {
      permissions: { deny, defaultMode: permissionMode },
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `node "${HOOK_COMMAND_PATH}"`,
                timeout: 10,
                onFailure: "block",
              },
            ],
          },
        ],
      },
    };
    const settingsPath = path.join(dir, "settings.json");
    const mcpPath = path.join(dir, "mcp.json");
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    // TASK-W.8：Stagent Gateway 的受管 MCP HTTP 端点在 W.8 落地；Worker 经 --strict-mcp-config 挂接真实端点，严禁静默降级为空集合
    // （注：此前注释误指 W.4，W.4 实为 threat-guard，已在 W.8 纠正）
    let mcpServers: Record<string, unknown> = {};
    if (partner) {
      // partner 恒为右栏只读搭档，只读白名单保持不变，不挂外部 MCP 端点
      mcpServers = {};
    } else {
      // worker 施工工人路径：必须挂接真实 Stagent MCP 端点；若端点不可用/未配置则明确报错，严禁静默降级为空集合
      let resolvedUrl: string | undefined = undefined;

      if (typeof this.opts.mcpServerUrl === "function") {
        resolvedUrl = this.opts.mcpServerUrl();
      } else if (typeof this.opts.mcpServerUrl === "string") {
        resolvedUrl = this.opts.mcpServerUrl;
      }

      if (!resolvedUrl) {
        resolvedUrl = process.env["STAGENT_MCP_URL"];
      }

      if (!resolvedUrl) {
        let port: number | undefined = undefined;
        if (typeof this.opts.mcpPort === "function") {
          port = this.opts.mcpPort();
        } else if (typeof this.opts.mcpPort === "number") {
          port = this.opts.mcpPort;
        } else if (process.env["STAGENT_DAEMON_PORT"]) {
          const parsed = Number.parseInt(process.env["STAGENT_DAEMON_PORT"], 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            port = parsed;
          }
        }
        if (port && port > 0) {
          resolvedUrl = `http://127.0.0.1:${port}/api/mcp`;
        }
      }

      if (!resolvedUrl || typeof resolvedUrl !== "string" || resolvedUrl.trim().length === 0) {
        throw new Error(
          "Worker MCP endpoint URL is required under --strict-mcp-config; silent fallback to empty mcpServers is prohibited (TASK-W.8)",
        );
      }

      const mcpUrl = resolvedUrl.trim();

      let token: string | undefined = undefined;
      if (typeof this.opts.authToken === "function") {
        token = this.opts.authToken();
      } else if (typeof this.opts.authToken === "string") {
        token = this.opts.authToken;
      } else if (process.env["STAGENT_MCP_TOKEN"]) {
        token = process.env["STAGENT_MCP_TOKEN"];
      } else if (process.env["STAGENT_SESSION_TOKEN"]) {
        token = process.env["STAGENT_SESSION_TOKEN"];
      }

      const stagentConfig: Record<string, unknown> = {
        type: "http",
        url: mcpUrl,
      };

      if (token && token.trim().length > 0) {
        stagentConfig["headers"] = {
          Authorization: `Bearer ${token.trim()}`,
        };
      }

      mcpServers = {
        stagent: stagentConfig,
      };
    }
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers }, null, 2));

    // 不用 --bare：实测 Claude Code 2.1.x 的 --bare 会跳过 --settings 里的 hooks，
    // 并把工具集缩成 Bash/Edit/Read，PreToolUse 兜底会静默失效。
    // 改为 --setting-sources "" 忽略用户/项目/本地配置，只加载 Stagent 生成的 settings，
    // 并用 --tools 显式限定可用工具集。
    // TASK-J.1：partner 的 --tools 是**精确白名单**（不是「默认集减去禁止项」），
    // 因此即便 CLI 未来新增写类工具，右栏也拿不到。
    const tools = partner
      ? [...PARTNER_TOOLS]
      : [...BASE_TOOLS, ...(allowBash ? ["Bash"] : [])];
    const args = [
      "--setting-sources",
      "",
      "--tools",
      tools.join(","),
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--settings",
      settingsPath,
      "--mcp-config",
      mcpPath,
      "--strict-mcp-config",
      "--permission-mode",
      permissionMode,
      "--allowedTools",
      tools.join(","),
      "--disallowedTools",
      deniedToolNames.join(","),
    ];
    if (input.nativeSessionId) args.push("--resume", input.nativeSessionId);

    const key = this.key();
    const env: NodeJS.ProcessEnv = {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      LANG: process.env["LANG"] ?? "en_US.UTF-8",
      STAGENT_HOOK_ROOT: input.cwd,
      STAGENT_HOOK_LOG: path.join(dir, "hook.log"),
      // TASK-J.1：hook 按角色二次判定（partner 只放行读类工具），与 CLI 参数互为双保险
      STAGENT_HOOK_ROLE: role,
      ...(allowBash ? { STAGENT_HOOK_ALLOW_BASH: "1" } : {}),
      ...(key ? { ANTHROPIC_API_KEY: key } : {}),
      // 兼容端点（如 DeepSeek 的 Anthropic 兼容接口）：只转发这几个白名单变量
      ...pickEnv(FORWARD_ENV),
      ...(this.opts.configDir
        ? { CLAUDE_CONFIG_DIR: ensureConfigDir(this.opts.configDir) }
        : {}),
    };
    return {
      command: this.opts.command ?? "claude",
      args,
      env,
      settingsPath,
      mcpPath,
    };
  }

  async *run(input: AdapterRunInput): AsyncIterable<AdapterEvent> {
    const key = this.key();
    if (!key) throw new Error("还差一步：请到设置 → 模型钥匙里配置后再试");
    const launch = this.buildLaunch(input);
    const proc: ManagedProcess = (this.opts.spawn ?? spawnManaged)({
      command: launch.command,
      args: launch.args,
      cwd: input.cwd,
      env: launch.env,
      signal: input.signal,
    });
    let sawPartialText = false;
    let resultError: string | null = null;
    try {
      for await (const line of proc.lines) {
        if (input.signal.aborted) break;
        const parsed = parseLine(line);
        if (!parsed) continue;
        for (const ev of translate(parsed, sawPartialText)) {
          if (ev.kind === "delta") sawPartialText = true;
          if (ev.kind === "error") resultError = ev.message;
          else yield ev;
        }
        if (parsed["type"] === "result") sawPartialText = false;
      }
      const { code } = await proc.exited;
      if (input.signal.aborted) return;
      if (resultError) throw new Error(redactSecret(resultError, key));
      if (code !== 0) {
        throw new Error(
          redactSecret(
            `Claude Code 退出码 ${code}：${proc.stderr().slice(-600) || "无输出"}`,
            key,
          ),
        );
      }
    } finally {
      if (input.signal.aborted) await proc.stop();
      fs.rmSync(path.dirname(launch.settingsPath), {
        recursive: true,
        force: true,
      });
    }
  }
}

type Json = Record<string, unknown>;

function parseLine(line: string): Json | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t) as Json;
  } catch {
    return null;
  }
}

/** stream-json 行 → 适配器事件（导出供测试） */
export function translate(msg: Json, sawPartialText: boolean): AdapterEvent[] {
  const out: AdapterEvent[] = [];
  const type = msg["type"];
  if ((type === "system" && msg["subtype"] === "init") || type === "result") {
    const sid = msg["session_id"];
    if (typeof sid === "string")
      out.push({ kind: "session", native_session_id: sid });
    if (type === "result" && msg["is_error"] === true) {
      out.push({
        kind: "error",
        message: String(msg["result"] ?? msg["subtype"] ?? "error"),
      });
    }
    return out;
  }
  if (type === "stream_event") {
    const ev = msg["event"] as Json | undefined;
    const delta = ev?.["delta"] as Json | undefined;
    if (
      ev?.["type"] === "content_block_delta" &&
      delta?.["type"] === "text_delta"
    ) {
      out.push({ kind: "delta", text: String(delta["text"] ?? "") });
    }
    return out;
  }
  const content = ((msg["message"] as Json | undefined)?.["content"] ??
    []) as Json[];
  if (type === "assistant" && Array.isArray(content)) {
    for (const block of content) {
      if (block["type"] === "text" && !sawPartialText) {
        out.push({ kind: "delta", text: String(block["text"] ?? "") });
      } else if (block["type"] === "tool_use") {
        out.push({
          kind: "tool_call",
          tool_id: String(block["id"]),
          name: String(block["name"]),
          input: block["input"],
        });
      }
    }
  }
  if (type === "user" && Array.isArray(content)) {
    for (const block of content) {
      if (block["type"] === "tool_result") {
        const c = block["content"];
        out.push({
          kind: "tool_result",
          tool_id: String(block["tool_use_id"]),
          output:
            typeof c === "string"
              ? c
              : Array.isArray(c)
                ? c.map((x) => String((x as Json)["text"] ?? "")).join("")
                : "",
          is_error: block["is_error"] === true,
        });
      }
    }
  }
  return out;
}

/** 允许从 Daemon 环境转发给 Claude Code 子进程的模型/端点变量（不含其他密钥） */
export const FORWARD_ENV = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
] as const;

function pickEnv(names: readonly string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const n of names) {
    const v = process.env[n];
    if (v) out[n] = v;
  }
  return out;
}
