import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { safeRmSync } from "../helpers/tmp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_CODE_VERIFIED_ON,
  ClaudeCodeAdapter,
  FORWARD_ENV,
  HOOK_SCRIPT,
  redactSecret,
  translate,
  type ClaudeCodeAdapterOptions,
} from "../../daemon/worker/cli-host/claude-code-adapter";
import { spawnManaged } from "../../daemon/worker/cli-host/process-host";
import type { AdapterEvent } from "../../daemon/chat/types";

const KEY = "sk-ant-test-0123456789abcdef";
let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w5a-")));
});
afterEach(() => safeRmSync(tmp));

/** 假 claude：忽略参数，按 stream-json 吐行；FAKE_IGNORE_SIGINT=1 时不理 SIGINT */
function fakeCli(script: string): string {
  const f = path.join(tmp, "fake-claude.mjs");
  fs.writeFileSync(f, `#!${process.execPath}\n${script}`);
  fs.chmodSync(f, 0o755);
  return f;
}
const STREAMING = `
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (process.env.FAKE_IGNORE_SIGINT) process.on("SIGINT", () => {});
out({ type: "system", subtype: "init", session_id: "sess-abc" });
out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "a.ts" } }] } });
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] } });
let i = 0;
const n = Number(process.env.FAKE_TOKENS || 3);
const t = setInterval(() => {
  if (i >= n) { clearInterval(t); out({ type: "result", subtype: "success", session_id: "sess-abc", is_error: false }); return; }
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "t" + i++ } } });
}, 20);
`;

async function collect(it: AsyncIterable<AdapterEvent>) {
  const out: AdapterEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("TASK-W.5a 启动参数（配置隔离 / 续接）", () => {
  // 这些用例测的是 Worker 路径的既有行为（可写 + 隔离），显式声明 worker：
  // TASK-J.1 起默认角色已改为只读 partner，右栏不再继承可写工具集。
  const adapter = new ClaudeCodeAdapter({
    apiKey: () => KEY,
    tmpRoot: os.tmpdir(),
    role: "worker",
  });
  const launch = adapter.buildLaunch({
    prompt: "hi",
    cwd: "/repo",
    nativeSessionId: "sid-1",
  });
  const settings = JSON.parse(fs.readFileSync(launch.settingsPath, "utf8"));
  afterEach(() => undefined);

  it("不用 --bare（会跳过 hooks）；--setting-sources 为空，只加载 Stagent 生成的 settings 与 mcp-config（strict）", () => {
    expect(launch.args).not.toContain("--bare");
    expect(launch.args.slice(0, 2)).toEqual(["--setting-sources", ""]);
    const tools = launch.args[launch.args.indexOf("--tools") + 1] ?? "";
    expect(tools.split(",")).toEqual(
      expect.arrayContaining(["Read", "Edit", "Write"]),
    );
    expect(tools.split(",")).not.toContain("Bash");
    expect(tools.split(",")).not.toContain("LS");
    expect(launch.args).toContain("--strict-mcp-config");
    expect(launch.args[launch.args.indexOf("--settings") + 1]).toBe(
      launch.settingsPath,
    );
    expect(launch.args[launch.args.indexOf("--mcp-config") + 1]).toBe(
      launch.mcpPath,
    );
    expect(launch.args).toEqual(
      expect.arrayContaining([
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
      ]),
    );
  });
  it("永不 bypassPermissions，永不 --continue；续接用 --resume <id>", () => {
    const joined = launch.args.join(" ") + JSON.stringify(settings);
    expect(joined).not.toMatch(/bypassPermissions|dangerously/);
    expect(launch.args).not.toContain("--continue");
    expect(launch.args[launch.args.indexOf("--resume") + 1]).toBe("sid-1");
    const fresh = adapter.buildLaunch({
      prompt: "x",
      cwd: "/repo",
      nativeSessionId: null,
    });
    expect(fresh.args).not.toContain("--resume");
  });
  it("硬限制不只靠 hook：permissions.deny + --disallowedTools 拒绝 Bash/WebFetch；hook onFailure=block", () => {
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["Bash", "WebFetch"]),
    );
    expect(launch.args[launch.args.indexOf("--disallowedTools") + 1]).toMatch(
      /Bash/,
    );
    expect(settings.hooks.PreToolUse[0].hooks[0].onFailure).toBe("block");
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain(
      "pretool-hook.mjs",
    );
  });
  it("API Key 只进子进程 env，且最小化 env（不继承 Daemon 其他变量）", () => {
    expect(launch.env["ANTHROPIC_API_KEY"]).toBe(KEY);
    expect(launch.args.join(" ")).not.toContain(KEY);
    expect(fs.readFileSync(launch.settingsPath, "utf8")).not.toContain(KEY);
    // Daemon 环境里若设置了兼容端点变量（FORWARD_ENV），它们会被有意转发，不计入「其他变量」
    const forwarded = new Set<string>(FORWARD_ENV);
    expect(
      Object.keys(launch.env)
        .filter((k) => !forwarded.has(k))
        .sort(),
    ).toEqual(
      [
        "ANTHROPIC_API_KEY",
        "HOME",
        "LANG",
        "PATH",
        "STAGENT_HOOK_LOG",
        "STAGENT_HOOK_ROLE",
        "STAGENT_HOOK_ROOT",
      ].sort(),
    );
    expect(redactSecret(`boom ${KEY} x`, KEY)).toBe("boom [REDACTED] x");
  });
  it("未实测：control_mode=UNCONTROLLED_EXTERNAL，verified_on 为空；无 Key 时不可用", () => {
    expect(adapter.info()).toMatchObject({
      control_mode: "UNCONTROLLED_EXTERNAL",
      verified_on: "",
      available: true,
    });
    expect(
      new ClaudeCodeAdapter({ apiKey: () => undefined }).info().available,
    ).toBe(false);
  });
});

/**
 * TASK-J.1（P0 安全）：方案工作台右栏以 partner 角色运行。
 * 三层同时收窄（--tools 精确白名单 / --disallowedTools + permissions.deny / hook 角色），
 * 且默认值即 partner——忘记传参不会退化成可写。
 */
describe("TASK-J.1 partner 角色：右栏只读工具集", () => {
  const build = (opts: ClaudeCodeAdapterOptions = {}) =>
    new ClaudeCodeAdapter({
      apiKey: () => KEY,
      tmpRoot: os.tmpdir(),
      ...opts,
    }).buildLaunch({ prompt: "hi", cwd: "/repo", nativeSessionId: null });
  const argOf = (args: string[], flag: string) =>
    args[args.indexOf(flag) + 1] ?? "";
  const settingsOf = (launch: { settingsPath: string }) =>
    JSON.parse(fs.readFileSync(launch.settingsPath, "utf8"));

  it("默认角色即 partner（失败关闭）：--tools 与 --allowedTools 恰为 Read,Glob,Grep", () => {
    const launch = build();
    expect(argOf(launch.args, "--tools")).toBe("Read,Glob,Grep");
    expect(argOf(launch.args, "--allowedTools")).toBe("Read,Glob,Grep");
  });

  it("--disallowedTools 追加写类 / Shell / Todo 工具；--permission-mode 不是 acceptEdits", () => {
    const launch = build();
    const disallowed = argOf(launch.args, "--disallowedTools").split(",");
    for (const tool of [
      "Edit",
      "Write",
      "MultiEdit",
      "NotebookEdit",
      "Bash",
      "TodoWrite",
    ]) {
      expect(disallowed, `应封禁 ${tool}`).toContain(tool);
    }
    expect(argOf(launch.args, "--permission-mode")).toBe("default");
    expect(launch.args.join(" ")).not.toContain("acceptEdits");
  });

  it("联网工具 WebFetch / WebSearch 在 partner 下不可用（工具集与禁止清单双向确认）", () => {
    const launch = build();
    const tools = argOf(launch.args, "--tools").split(",");
    const allowed = argOf(launch.args, "--allowedTools").split(",");
    const disallowed = argOf(launch.args, "--disallowedTools").split(",");
    const denied = settingsOf(launch).permissions.deny as string[];
    for (const netTool of ["WebFetch", "WebSearch"]) {
      expect(tools, `${netTool} 不应在工具集里`).not.toContain(netTool);
      expect(allowed, `${netTool} 不应在 allowedTools 里`).not.toContain(
        netTool,
      );
      expect(disallowed, `${netTool} 应进 --disallowedTools`).toContain(
        netTool,
      );
      expect(denied, `${netTool} 应进 permissions.deny`).toContain(netTool);
    }
  });

  it("settings 的 permissions.deny 同步封禁写类工具，defaultMode 为 default", () => {
    const settings = settingsOf(build());
    expect(settings.permissions.defaultMode).toBe("default");
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        "Edit",
        "Write",
        "MultiEdit",
        "NotebookEdit",
        "Bash",
        "TodoWrite",
      ]),
    );
    // 既有保护不变：元数据与配置目录仍不许碰
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["Edit(./.stagent/**)", "Write(./.git/**)"]),
    );
  });

  it("MCP：只挂 Stagent 生成的空集合 + strict，用户配置的 MCP 服务器一律不加载", () => {
    const launch = build();
    // --strict-mcp-config 是 Claude Code 2.1.296 的实际参数（见 claude --help）
    expect(launch.args).toContain("--strict-mcp-config");
    expect(argOf(launch.args, "--mcp-config")).toBe(launch.mcpPath);
    expect(argOf(launch.args, "--setting-sources")).toBe("");
    expect(JSON.parse(fs.readFileSync(launch.mcpPath, "utf8"))).toEqual({
      mcpServers: {},
    });
    // 只允许这一个 mcp-config，不额外把用户/项目配置塞进来
    expect(
      launch.args.filter((a) => a === "--mcp-config"),
      "只能有一个 --mcp-config",
    ).toHaveLength(1);
  });

  it("partner 忽略 allowBash，并把只读角色交给 hook 做第二重保险", () => {
    const launch = build({ allowBash: true });
    expect(argOf(launch.args, "--tools")).toBe("Read,Glob,Grep");
    expect(argOf(launch.args, "--allowedTools")).not.toContain("Bash");
    expect(launch.env["STAGENT_HOOK_ROLE"]).toBe("partner");
    expect(launch.env["STAGENT_HOOK_ALLOW_BASH"]).toBeUndefined();
  });

  it("info().tool_mode：partner=read_only，worker=read_write", () => {
    expect(new ClaudeCodeAdapter({ apiKey: () => KEY }).info().tool_mode).toBe(
      "read_only",
    );
    expect(
      new ClaudeCodeAdapter({ apiKey: () => KEY, role: "partner" }).info()
        .tool_mode,
    ).toBe("read_only");
    expect(
      new ClaudeCodeAdapter({ apiKey: () => KEY, role: "worker" }).info()
        .tool_mode,
    ).toBe("read_write");
  });

  it("worker 角色保持既有可写行为（仅施工路径，不进右栏）", () => {
    const launch = build({ role: "worker" });
    expect(argOf(launch.args, "--tools").split(",")).toEqual(
      expect.arrayContaining(["Read", "Edit", "Write", "MultiEdit"]),
    );
    expect(argOf(launch.args, "--permission-mode")).toBe("acceptEdits");
    expect(launch.env["STAGENT_HOOK_ROLE"]).toBe("worker");
  });
});

describe("TASK-W.5a stream-json 解析", () => {
  it("init/result → session；text_delta → delta；tool_use/tool_result → 卡片；非 partial 时才用整段 text", () => {
    expect(
      translate({ type: "system", subtype: "init", session_id: "s" }, false),
    ).toEqual([{ kind: "session", native_session_id: "s" }]);
    expect(
      translate(
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "a" },
          },
        },
        false,
      ),
    ).toEqual([{ kind: "delta", text: "a" }]);
    const asst = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "全文" },
          { type: "tool_use", id: "1", name: "Write", input: {} },
        ],
      },
    };
    expect(translate(asst, true).map((e) => e.kind)).toEqual(["tool_call"]);
    expect(translate(asst, false).map((e) => e.kind)).toEqual([
      "delta",
      "tool_call",
    ]);
    expect(
      translate(
        { type: "result", is_error: true, result: "quota", session_id: "s" },
        false,
      ).map((e) => e.kind),
    ).toEqual(["session", "error"]);
  });
});

describe("TASK-W.5a PreToolUse hook：4 类绕过在 hook 层失败关闭（确定性，不调模型）", () => {
  const runHook = (payload: unknown, extraEnv: Record<string, string> = {}) =>
    spawnSync(process.execPath, [HOOK_SCRIPT], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      env: {
        PATH: process.env["PATH"] ?? "",
        STAGENT_HOOK_ROOT: tmp,
        ...extraEnv,
      },
      encoding: "utf8",
    });
  it("绕过 1：写 Worktree 外路径 → exit 2 + deny", () => {
    const r = runHook({
      tool_name: "Write",
      tool_input: { file_path: "/etc/evil.txt", content: "x" },
    });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe(
      "deny",
    );
  });
  it("专用配置目录与会话令牌：读、写都拒绝", () => {
    for (const [tool, file] of [
      ["Read", ".stagent/claude-config/projects/x.jsonl"],
      ["Write", ".stagent/claude-config/settings.json"],
      ["Read", ".stagent/session-token"],
    ] as const) {
      const r = runHook({ tool_name: tool, tool_input: { file_path: file } });
      expect(r.status).toBe(2);
    }
  });
  it("绕过 2：未授权 Shell → 拒绝", () => {
    expect(
      runHook({ tool_name: "Bash", tool_input: { command: "ls" } }).status,
    ).toBe(2);
  });
  it("绕过 3：经 ../ 或 symlink 访问主工作树 → 拒绝", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-main-"));
    fs.symlinkSync(outside, path.join(tmp, "link"));
    expect(
      runHook({ tool_name: "Edit", tool_input: { file_path: "../main/a.ts" } })
        .status,
    ).toBe(2);
    expect(
      runHook({ tool_name: "Write", tool_input: { file_path: "link/a.ts" } })
        .status,
    ).toBe(2);
    expect(
      runHook({
        tool_name: "Read",
        tool_input: { file_path: path.join(outside, "x") },
      }).status,
    ).toBe(2);
    fs.rmSync(outside, { recursive: true, force: true });
  });
  it("绕过 4：非白名单原生/MCP 工具、写 .git/.claude → 拒绝；hook 输入异常 → 拒绝", () => {
    expect(
      runHook({ tool_name: "mcp__other__write", tool_input: {} }).status,
    ).toBe(2);
    expect(
      runHook({ tool_name: "Write", tool_input: { file_path: ".git/config" } })
        .status,
    ).toBe(2);
    expect(
      runHook({
        tool_name: "Edit",
        tool_input: { file_path: ".claude/settings.json" },
      }).status,
    ).toBe(2);
    expect(runHook("not json").status).toBe(2);
    expect(
      runHook(
        { tool_name: "Write", tool_input: { file_path: "a.ts" } },
        { STAGENT_HOOK_ROOT: "" },
      ).status,
    ).toBe(2);
  });
  it("正常写入 Worktree 内文件 → 放行", () => {
    expect(
      runHook({
        tool_name: "Write",
        tool_input: { file_path: path.join(tmp, "src", "a.ts") },
      }).status,
    ).toBe(0); // 父目录尚不存在（新建子目录）仍在根内 → 放行
    fs.mkdirSync(path.join(tmp, "src"));
    expect(
      runHook({ tool_name: "Write", tool_input: { file_path: "src/a.ts" } })
        .status,
    ).toBe(0);
    expect(
      runHook({ tool_name: "Read", tool_input: { file_path: "src/a.ts" } })
        .status,
    ).toBe(0);
  });

  /**
   * G-3 加固（2026-10-21）：允许 Bash 之后，Shell 是绕过 Write/Edit 路径判定的通道。
   * 两道门禁必须成立，且不能把日常开发命令一起打掉。
   */
  it("allowBash 加固：元数据路径与越界目标一律拒绝，常规开发命令零误伤", () => {
    const bash = (command: string) =>
      runHook(
        { tool_name: "Bash", tool_input: { command } },
        { STAGENT_HOOK_ALLOW_BASH: "1" },
      );
    // 合法开发命令：必须全部放行（否则加固会毁掉正常流程）
    for (const cmd of [
      "ls",
      "git status",
      "git log --oneline -3",
      "npm run typecheck",
      "npm test",
      "npx vitest run tests/unit/a.test.ts",
      "npx vitest run tests/**/*.test.ts",
      "echo ok > note.txt",
      "npm test > /dev/null",
      "rm -rf node_modules/.cache",
      "cat .gitignore",
      "cat .github/workflows/ci.yml",
    ]) {
      expect(bash(cmd).status, `应放行：${cmd}`).toBe(0);
    }
    // 保留区元数据：一律拒绝
    for (const cmd of [
      "rm -rf .stagent",
      "cat .stagent/protection.json",
      "cat .env",
      "cat .env.local",
      "git --git-dir=.git log",
      "rm -rf .claude",
      "ls .cursor/rules",
    ]) {
      expect(bash(cmd).status, `应拒绝：${cmd}`).toBe(2);
    }
    // 越界：目录穿越与工作目录外的绝对路径一律拒绝
    for (const cmd of [
      "echo pwn > ../outside.txt",
      "mv a.txt ../outside/a.txt",
      "cp data /tmp/leak",
      "cat /etc/passwd",
      "echo x > $HOME/x",
      "cd ..",
    ]) {
      expect(bash(cmd).status, `应拒绝：${cmd}`).toBe(2);
    }
    // 拒绝理由可区分（便于用户看懂是哪条门禁拦的）
    const metaReason = bash("rm -rf .stagent");
    expect(metaReason.stdout).toContain("系统保护元数据");
    const escapeReason = bash("echo pwn > ../outside.txt");
    expect(escapeReason.stdout).toContain("路径越界");
  });
});

describe("TASK-J.1 hook：partner 角色只放行读类工具（第二重保险）", () => {
  const runPartnerHook = (
    tool: string,
    toolInput: Record<string, unknown>,
    extraEnv: Record<string, string> = {},
  ) =>
    spawnSync(process.execPath, [HOOK_SCRIPT], {
      input: JSON.stringify({ tool_name: tool, tool_input: toolInput }),
      env: {
        PATH: process.env["PATH"] ?? "",
        STAGENT_HOOK_ROOT: tmp,
        STAGENT_HOOK_ROLE: "partner",
        ...extraEnv,
      },
      encoding: "utf8",
    });

  it("写类 / Shell / Todo / 未知工具 → exit 2 + deny，且理由说清「右栏只读」", () => {
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "a.ts"), "export const a = 1;\n");
    for (const [tool, input] of [
      ["Write", { file_path: "src/a.ts", content: "pwn" }],
      ["Edit", { file_path: "src/a.ts", old_string: "a", new_string: "b" }],
      ["MultiEdit", { file_path: "src/a.ts", edits: [] }],
      ["NotebookEdit", { notebook_path: "src/a.ipynb" }],
      ["Bash", { command: "echo hi" }],
      ["TodoWrite", { todos: [] }],
      ["WebFetch", { url: "https://example.invalid" }],
      ["WebSearch", { query: "secret" }],
      ["mcp__other__write", {}],
    ] as const) {
      const r = runPartnerHook(tool, input as Record<string, unknown>);
      expect(r.status, `应拦截 ${tool}`).toBe(2);
      expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe(
        "deny",
      );
      expect(r.stdout).toContain("只读");
    }
    // 写类工具即使落在仓库内、平时会被放行，partner 下也一律不落地
    expect(fs.readFileSync(path.join(tmp, "src", "a.ts"), "utf8")).toBe(
      "export const a = 1;\n",
    );
  });

  it("读类工具照常放行（右栏仍能读、搜，并用 Glob 模式列目录）", () => {
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "a.ts"), "export const a = 1;\n");
    for (const [tool, input] of [
      ["Read", { file_path: "src/a.ts" }],
      ["Glob", { pattern: "src/**/*.ts" }],
      ["Grep", { pattern: "export" }],
      ["Glob", { pattern: "src/*" }],
    ] as const) {
      expect(
        runPartnerHook(tool, input as Record<string, unknown>).status,
        `应放行 ${tool}`,
      ).toBe(0);
    }
  });

  it("LS 不在 partner 白名单（CLI 2.1.296 不提供，列目录改由 Glob 承担）", () => {
    expect(runPartnerHook("LS", { path: "src" }).status, "应拦截 LS").toBe(2);
  });

  it("partner 下即便注入 STAGENT_HOOK_ALLOW_BASH=1 也拦 Shell（角色优先）", () => {
    const r = runPartnerHook(
      "Bash",
      { command: "rm -rf src" },
      { STAGENT_HOOK_ALLOW_BASH: "1" },
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("只读");
  });

  it("未收到角色声明时保持既有行为：仓库内写文件仍放行（worker/存量进程兼容）", () => {
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    const r = spawnSync(process.execPath, [HOOK_SCRIPT], {
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "src/b.ts", content: "ok" },
      }),
      env: { PATH: process.env["PATH"] ?? "", STAGENT_HOOK_ROOT: tmp },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});

describe("TASK-W.5a cli-host 进程托管与打断 ≤2s（假 CLI）", () => {
  it("适配器跑通假 CLI：session / tool_call / tool_result / delta", async () => {
    const cmd = fakeCli(STREAMING);
    const a = new ClaudeCodeAdapter({ apiKey: () => KEY, command: cmd });
    const ev = await collect(
      a.run({
        prompt: "p",
        cwd: tmp,
        nativeSessionId: null,
        history: [],
        signal: new AbortController().signal,
      }),
    );
    expect(ev.map((e) => e.kind)).toEqual([
      "session",
      "tool_call",
      "tool_result",
      "delta",
      "delta",
      "delta",
      "session",
    ]);
  });
  it("打断：听 SIGINT 的 CLI 在 SIGINT 阶段停", async () => {
    const p = spawnManaged({
      command: fakeCli(STREAMING),
      args: [],
      cwd: tmp,
      env: { ...process.env, FAKE_TOKENS: "10000" },
    });
    await new Promise((r) => setTimeout(r, 150));
    const r = await p.stop();
    expect(r.via).toBe("SIGINT");
    expect(r.ms).toBeLessThan(2000);
  });
  it("打断：不理 SIGINT 的 CLI 被升级到 SIGTERM，总耗时 <2s", async () => {
    const p = spawnManaged({
      command: fakeCli(STREAMING),
      args: [],
      cwd: tmp,
      env: { ...process.env, FAKE_TOKENS: "10000", FAKE_IGNORE_SIGINT: "1" },
    });
    // 等假 CLI 吐出第一行（此时它已装好忽略 SIGINT 的处理器），避免固定等待在慢机器上偶发失败
    const it0 = p.lines[Symbol.asyncIterator]();
    await it0.next();
    const r = await p.stop();
    expect(["SIGTERM", "SIGKILL"]).toContain(r.via);
    expect(r.ms).toBeLessThan(2000);
  });
  it("通过 AbortSignal 打断适配器：2s 内迭代结束", async () => {
    const ac = new AbortController();
    const a = new ClaudeCodeAdapter({
      apiKey: () => KEY,
      command: fakeCli(STREAMING),
    });
    process.env["FAKE_TOKENS"] = "10000"; // 适配器最小化 env，此值不会传入 → 用 3 token 版也可
    const run = collect(
      a.run({
        prompt: "p",
        cwd: tmp,
        nativeSessionId: null,
        history: [],
        signal: ac.signal,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    const t = Date.now();
    ac.abort();
    await run;
    expect(Date.now() - t).toBeLessThan(2000);
    delete process.env["FAKE_TOKENS"];
  });
  it("CLI 失败时错误信息里的 Key 被抹掉", async () => {
    const cmd = fakeCli(
      `process.stderr.write("auth failed for " + process.env.ANTHROPIC_API_KEY); process.exit(1);`,
    );
    const a = new ClaudeCodeAdapter({ apiKey: () => KEY, command: cmd });
    await expect(
      collect(
        a.run({
          prompt: "p",
          cwd: tmp,
          nativeSessionId: null,
          history: [],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow(/\[REDACTED\]/);
    await expect(
      collect(
        a.run({
          prompt: "p",
          cwd: tmp,
          nativeSessionId: null,
          history: [],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.not.toThrow(KEY);
  });
});

describe("TASK-W.9a worker MCP preview-only contract", () => {
  it("missing endpoint returns explicit preview status and run refuses before spawning", async () => {
    const previousUrl = process.env["STAGENT_MCP_URL"];
    const previousPort = process.env["STAGENT_DAEMON_PORT"];
    delete process.env["STAGENT_MCP_URL"];
    delete process.env["STAGENT_DAEMON_PORT"];
    const spawn = vi.fn();
    try {
      const noEndpoint = new ClaudeCodeAdapter({
        role: "worker",
        apiKey: () => KEY,
        spawn: spawn as never,
      });
      const launch = noEndpoint.buildLaunch({
        prompt: "preview",
        cwd: tmp,
        nativeSessionId: null,
      });
      expect(launch.mcp_status).toBe("ENDPOINT_MISSING_PREVIEW_ONLY");
      expect(launch.degraded_reason).toContain("preview-only");
      await expect(
        collect(
          noEndpoint.run({
            prompt: "execute",
            cwd: tmp,
            nativeSessionId: null,
            history: [],
            signal: new AbortController().signal,
          }),
        ),
      ).rejects.toThrow("E_MCP_PREVIEW_ONLY");
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      if (previousUrl !== undefined)
        process.env["STAGENT_MCP_URL"] = previousUrl;
      else delete process.env["STAGENT_MCP_URL"];
      if (previousPort !== undefined)
        process.env["STAGENT_DAEMON_PORT"] = previousPort;
      else delete process.env["STAGENT_DAEMON_PORT"];
    }
  });
});

describe("TASK-W.5a spawn 静态禁令", () => {
  it("新代码中只有 cli-host 允许 import child_process（其余为既有模块白名单）", () => {
    const LEGACY = new Set([
      "daemon/pipeline/orchestrator.ts",
      "daemon/runner/command-runner.ts",
      "daemon/runner/process-tree.ts",
      "daemon/server.ts",
      "daemon/editor/launcher.ts",
      // TASK-C.10h：废纸篓 trash/osascript
      "daemon/editor/repo-delete.ts",
      "daemon/editor/repo-fs-ops.ts",
      "daemon/git/worktree-manager.ts",
      // TASK-D.1c：最近项目一点重开，仅 spawn 本仓 stagent start
      "daemon/core/open-workspace.ts",
      // TASK-C.14e：OS 只读/断网证明
      "daemon/baseline/os-sandbox.ts",
      // TASK-H.4：确认后 git init
      "daemon/git/ensure-git-repo.ts",
      // Existing historical child_process users outside this task's scope.
      "daemon/knowledge/check-knowledge.ts",
      "daemon/release/release-manager.ts",
      "daemon/trace/why.ts",
      "daemon/vault/keychain-backend.ts",
      // TASK-H.8：records zip 导出
      "daemon/pipeline/records-export-cleanup.ts",
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, n.name);
        if (n.isDirectory()) walk(p);
        else if (
          /\.(ts|tsx|mjs)$/.test(n.name) &&
          /from\s+["'](node:)?child_process["']|require\(["'](node:)?child_process/.test(
            fs.readFileSync(p, "utf8"),
          )
        )
          hits.push(path.relative(process.cwd(), p));
      }
    };
    walk(path.join(process.cwd(), "daemon"));
    walk(path.join(process.cwd(), "src"));
    const unexpected = hits.filter(
      (h) => !LEGACY.has(h) && !h.startsWith("daemon/worker/cli-host/"),
    );
    expect(unexpected).toEqual([]);
  });
});

describe("TASK-W.5a 兼容端点环境转发", () => {
  it("只转发 ANTHROPIC_BASE_URL/MODEL 等白名单变量，不泄漏其它环境", () => {
    const saved = { ...process.env };
    process.env["ANTHROPIC_BASE_URL"] = "https://example.invalid/anthropic";
    process.env["ANTHROPIC_MODEL"] = "m-1";
    process.env["SOME_OTHER_SECRET"] = "nope";
    try {
      const a = new ClaudeCodeAdapter({
        apiKey: () => "k",
        tmpRoot: os.tmpdir(),
      });
      const l = a.buildLaunch({
        prompt: "x",
        cwd: "/repo",
        nativeSessionId: null,
      });
      expect(l.env["ANTHROPIC_BASE_URL"]).toBe(
        "https://example.invalid/anthropic",
      );
      expect(l.env["ANTHROPIC_MODEL"]).toBe("m-1");
      expect(l.env["SOME_OTHER_SECRET"]).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});

describe("TASK-W.5a 专用 CLAUDE_CONFIG_DIR 与实测记录", () => {
  it("配置目录：注入 CLAUDE_CONFIG_DIR，目录自动创建且权限 0700；deny 禁读该目录", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-cfg-"));
    const dir = path.join(root, ".stagent", "claude-config");
    const a = new ClaudeCodeAdapter({
      apiKey: () => "k",
      tmpRoot: root,
      configDir: dir,
    });
    const l = a.buildLaunch({ prompt: "x", cwd: root, nativeSessionId: null });
    expect(l.env["CLAUDE_CONFIG_DIR"]).toBe(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    // 已存在但权限过宽的目录会被收紧
    fs.chmodSync(dir, 0o755);
    a.buildLaunch({ prompt: "x", cwd: root, nativeSessionId: null });
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    const settings = JSON.parse(fs.readFileSync(l.settingsPath, "utf8"));
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        "Read(./.stagent/claude-config/**)",
        "Edit(./.stagent/**)",
        "Write(./.stagent/**)",
      ]),
    );
  });
  it("未传 configDir 时不设置 CLAUDE_CONFIG_DIR", () => {
    const a = new ClaudeCodeAdapter({
      apiKey: () => "k",
      tmpRoot: os.tmpdir(),
    });
    const l = a.buildLaunch({
      prompt: "x",
      cwd: "/repo",
      nativeSessionId: null,
    });
    expect(l.env["CLAUDE_CONFIG_DIR"]).toBeUndefined();
  });
  it("verified_on 填写实测记录后 control_mode 为 GATEWAY_ENFORCED", () => {
    const info = new ClaudeCodeAdapter({
      apiKey: () => "k",
      verifiedOn: CLAUDE_CODE_VERIFIED_ON,
    }).info();
    expect(info.verified_on).toBe(
      "Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21",
    );
    expect(info.control_mode).toBe("GATEWAY_ENFORCED");
  });
});
