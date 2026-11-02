/**
 * TASK-W.5b：cursor-agent 真实 CLI 观测（**需要 `STAGENT_REAL_CURSOR=1`**）。
 *
 * 运行：
 *   STAGENT_REAL_CURSOR=1 npx vitest run tests/e2e/cursor-agent-real.real.test.ts
 *
 * 门禁纪律（沿用 `openhands-isolation.real.test.ts`）：未设 `STAGENT_REAL_CURSOR=1`
 * 时整文件 **skip**——**跳过 ≠ 通过**。
 *
 * 本文件能证明什么、不能证明什么，写清楚免得被读成「cursor-agent 已验证受控」：
 *
 * ✅ 证明（不需要模型推理，纯 CLI 行为观测）：
 * 1. 凭证隔离生效：专用 `HOME` 下 `cursor-agent status` 为 `Not logged in`，
 *    无 key 直跑报 `Authentication required` —— 即**没有**回落到用户既有订阅会话；
 * 2. 我们构造的 argv 旗标是**真旗标**（`--help` 逐项核对），且禁用旗标也真实存在
 *    （禁的是真东西，不是幽灵参数）；
 * 3. MCP 落点：`buildLaunch()` 写出的 `<HOME>/.cursor/mcp.json` 被 CLI 的
 *    `mcp list` 读取，且列表里只有 `stagent` 一项。
 *
 * ❌ 不能证明（**未执行**，别当成通过）：
 * 4. `CA-06` 四类越权负例（Worktree 外写 / 保护区写 / 白名单外命令 / MCP 面越权）
 *    需要模型驱动工具调用，本机**没有有效 `CURSOR_API_KEY`**，故未执行。
 *    对应地 `CURSOR_AGENT_VERIFIED_ON` 保持 `undefined`（见 `CA-08` 单测断言）。
 *    下面 `describe.skipIf(!HAS_KEY)` 的用例一旦被启用就会**显式失败**，
 *    不允许「跳过」冒充「通过」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  CURSOR_AGENT_ALLOWED_FLAGS,
  CURSOR_AGENT_FORBIDDEN_FLAGS,
  CURSOR_AGENT_VERIFIED_ON,
  CursorAgentAdapter,
} from "../../daemon/worker/cli-host/cursor-agent-adapter";

const REAL = process.env["STAGENT_REAL_CURSOR"] === "1";
const BIN = process.env["CURSOR_AGENT_BIN"] ?? "cursor-agent";
const HAS_KEY =
  typeof process.env["CURSOR_API_KEY"] === "string" &&
  process.env["CURSOR_API_KEY"].trim().length > 0;

const roots: string[] = [];

function freshHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w5b-real-home-"));
  roots.push(dir);
  return dir;
}

/** 在指定 HOME 下跑 CLI，且**清掉** CURSOR_API_KEY（除非显式传入） */
function runCli(
  home: string,
  args: string[],
  options: { apiKey?: string } = {},
): { code: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    LANG: process.env["LANG"] ?? "en_US.UTF-8",
  };
  if (options.apiKey !== undefined) env["CURSOR_API_KEY"] = options.apiKey;
  const result = spawnSync(BIN, args, {
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error === undefined ? "" : String(result.error.message)}`,
  };
}

afterAll(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) safeRmSync(dir);
  }
});

describe.skipIf(!REAL)("TASK-W.5b cursor-agent 真实 CLI 观测", () => {
  let home = "";

  beforeAll(() => {
    home = freshHome();
  });

  it("凭证隔离生效：专用 HOME 下 status 为 Not logged in（不读用户既有登录态）", () => {
    const { stdout, stderr } = runCli(home, ["status"]);
    const output = `${stdout}${stderr}`;
    expect(output).toMatch(/Not logged in/i);
    // 反面证据：若隔离失效，这里会出现真实账号（订阅会话）
    expect(output).not.toMatch(/Logged in as/i);
  });

  it("无 key 直跑 → Authentication required（证明没回落到订阅会话）", () => {
    const { code, stdout, stderr } = runCli(home, ["--print", "say hi"]);
    const output = `${stdout}${stderr}`;
    expect(code).not.toBe(0);
    expect(output).toMatch(/Authentication required|CURSOR_API_KEY/i);
    expect(output).not.toMatch(/Logged in as/i);
  });

  it("假 key → 明确报「API key invalid」且凭证来源为环境变量（不入 argv）", () => {
    const { code, stdout, stderr } = runCli(
      home,
      [
        "--print",
        "--output-format",
        "stream-json",
        "--mode",
        "plan",
        "--workspace",
        home,
        "--",
        "say hi",
      ],
      { apiKey: "ck_w5b_invalid_key_probe" },
    );
    const output = `${stdout}${stderr}`;
    expect(code).not.toBe(0);
    expect(output).toMatch(/invalid/i);
    expect(output).toMatch(/CURSOR_API_KEY/);
  });

  it("白名单旗标都是真旗标（CLI 事实回归）", () => {
    const { stdout, stderr } = runCli(home, ["--help"]);
    const help = `${stdout}${stderr}`;
    // 长名逐个核对：改名 / 移除会让本用例变红，而不是让 buildLaunch 悄悄拼错
    for (const flag of CURSOR_AGENT_ALLOWED_FLAGS) {
      if (flag === "--resume") {
        expect(help).toMatch(/--resume/);
        continue;
      }
      expect(help, `--help 里应能查到 ${flag}`).toContain(flag);
    }
  });

  it("禁用旗标也是真旗标（禁的是真东西，不是幽灵参数）", () => {
    const { stdout, stderr } = runCli(home, ["--help"]);
    const help = `${stdout}${stderr}`;
    const longForms = CURSOR_AGENT_FORBIDDEN_FLAGS.filter(
      (flag) => flag.startsWith("--") && !flag.startsWith("--api-key"),
    );
    for (const flag of longForms) {
      expect(help, `--help 里应能查到 ${flag}`).toContain(flag);
    }
    // --api-key 进禁用表的原因不是「不存在」，而是「会出现在 ps 里」
    expect(help).toContain("--api-key");
  });

  it("MCP 落点：buildLaunch 写出的 ~/.cursor/mcp.json 被 mcp list 读取，且只有 stagent", () => {
    const configDir = freshHome();
    const launch = new CursorAgentAdapter({
      configDir,
      mcpServerUrl: "http://127.0.0.1:7788/api/mcp",
      apiKey: () => undefined,
    }).buildLaunch({ prompt: "noop", cwd: configDir });

    const { stdout, stderr } = runCli(launch.configDir, ["mcp", "list"]);
    const output = `${stdout}${stderr}`;
    expect(output).toContain("stagent");
    // 只挂 stagent：不得出现第二条 MCP 项
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^No MCP servers/i.test(line));
    const entries = lines.filter((line) => line.includes(":"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("stagent");
  });

  it("CA-08 一致性：4 类负例未执行 ⇒ verified_on 仍为空", () => {
    expect(CURSOR_AGENT_VERIFIED_ON).toBeUndefined();
  });
});

/**
 * CA-06 四类越权负例：**需要有效 `CURSOR_API_KEY`**（模型驱动工具调用）。
 *
 * 刻意写成「启用即失败」而不是空 skip：跑不了的部分必须显式红/显式未完成，
 * 不能靠 `it.skip` 混成绿色。补齐时把它改成真实断言，并把
 * `CURSOR_AGENT_VERIFIED_ON` 填上（CLI 版本 + 实测日期）。
 */
describe.skipIf(!HAS_KEY)(
  "CA-06 真实 CLI 四类越权负例（需有效 CURSOR_API_KEY）",
  () => {
    it("越权写 / 保护区写 / 白名单外命令 / MCP 面越权 必须全部失败关闭", () => {
      throw new Error(
        "CA-06 未实现：需按卡内四类负例逐一驱动真实 CLI（Worktree 外写、.git/.stagent 保护区写、白名单外命令、MCP 面越权），全部失败关闭后才可填 CURSOR_AGENT_VERIFIED_ON",
      );
    });
  },
);
