import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import { BaselineChatAdapter } from "../../daemon/chat/baseline-adapter";
import { DemoChatAdapter } from "../../daemon/chat/demo-adapter";
import { ClaudeCodeAdapter } from "../../daemon/worker/cli-host/claude-code-adapter";
import { isRightPaneAdapter } from "../../src/lib/pick-chat-adapter";
import type { AdapterEvent, ChatAdapter } from "../../daemon/chat/types";

/**
 * TASK-J.1 补充：右栏每个适配器的**实际**工具能力核对（不是只看 tool_mode 标签）。
 *
 * 右栏候选来自 daemon/server.ts::defaultChatAdapters，共三个：
 *  1. ClaudeCodeAdapter（partner）——外部 CLI，靠 --tools/--disallowedTools/permissions 收窄；
 *  2. BaselineChatAdapter —— 即「自研 OpenAI 兼容适配器」，走 AI SDK 纯文本补全；
 *  3. DemoChatAdapter —— 本地回声，不触盘。
 *
 * 这里逐条验证「它根本拿不到写文件 / 跑命令的能力」，而不是相信一个字段。
 */

const h = vi.hoisted(() => ({
  captured: [] as Record<string, unknown>[],
  text: "你好，我是右栏搭档。",
}));

vi.mock("ai", () => ({
  streamText: (opts: Record<string, unknown>) => {
    h.captured.push(opts);
    return {
      textStream: (async function* () {
        yield h.text;
      })(),
    };
  },
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (model: string) => ({ modelId: model }),
}));

const KEY_ANTHROPIC = "sk-ant-readonly-audit-0123456789";
const KEY_OPENAI = "sk-openai-readonly-audit";

async function collect(it: AsyncIterable<AdapterEvent>) {
  const out: AdapterEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const input = (cwd: string) => ({
  prompt: "帮我看看这个仓库",
  cwd,
  nativeSessionId: null,
  history: [],
  signal: new AbortController().signal,
});

const sourceOf = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8");

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ro-")));
  h.captured.length = 0;
});
afterEach(() => safeRmSync(tmp));

describe("右栏适配器只读核对：注册集合", () => {
  it("defaultChatAdapters 的三个适配器都自称只读，且都能被右栏选中", () => {
    const saved = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = KEY_OPENAI;
    try {
      const adapters: ChatAdapter[] = [
        new ClaudeCodeAdapter({ apiKey: () => KEY_ANTHROPIC }),
        new BaselineChatAdapter(),
        new DemoChatAdapter(),
      ];
      for (const adapter of adapters) {
        const info = adapter.info();
        expect(info.tool_mode, `${info.id} 应声明 read_only`).toBe("read_only");
        expect(isRightPaneAdapter(info), `${info.id} 应可被右栏选中`).toBe(
          true,
        );
      }
    } finally {
      if (saved === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = saved;
    }
  });
});

describe("BaselineChatAdapter（自研 OpenAI 兼容适配器）没有工具通道", () => {
  it("调用模型时不传 tools / toolChoice，事件流只有文本增量", async () => {
    const saved = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = KEY_OPENAI;
    try {
      const events = await collect(new BaselineChatAdapter().run(input(tmp)));
      expect(h.captured).toHaveLength(1);
      const opts = h.captured[0]!;
      // 能力事实：SDK 没拿到任何工具定义，模型无法发起工具调用
      expect(opts).not.toHaveProperty("tools");
      expect(opts).not.toHaveProperty("toolChoice");
      expect(opts).not.toHaveProperty("maxSteps");
      expect(opts).not.toHaveProperty("maxToolRoundtrips");
      expect(Object.keys(opts).sort()).toEqual(
        ["abortSignal", "messages", "model"].sort(),
      );
      expect(opts).not.toHaveProperty("system");
      // 行为事实：只吐文本，不产生 tool_call / tool_result
      expect(events.every((e) => e.kind === "delta")).toBe(true);
    } finally {
      if (saved === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = saved;
    }
  });

  it("源码层不引入 fs / child_process（无本地副作用通道）", () => {
    const src = sourceOf("daemon/chat/baseline-adapter.ts");
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["'](node:)?child_process["']/);
    expect(src).not.toMatch(/\bwriteFileSync\b|\bexecSync\b|\bspawnSync\b/);
  });
});

describe("DemoChatAdapter 只回放固定事件，不碰盘", () => {
  it("跑一轮后工作目录逐字节不变；合成的工具事件只有 Read", async () => {
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(path.join(tmp, "src", "a.ts"), "export const a = 1;\n");
    const before = fs.readdirSync(tmp, { recursive: true }).sort();
    const beforeContent = fs.readFileSync(
      path.join(tmp, "src", "a.ts"),
      "utf8",
    );

    const events = await collect(new DemoChatAdapter(0).run(input(tmp)));

    const tools = events.filter(
      (e): e is Extract<AdapterEvent, { kind: "tool_call" }> =>
        e.kind === "tool_call",
    );
    expect(tools.length).toBeGreaterThan(0);
    for (const call of tools) {
      expect(call.name, "演示适配器不得合成写类工具").toBe("Read");
    }
    expect(fs.readdirSync(tmp, { recursive: true }).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(tmp, "src", "a.ts"), "utf8")).toBe(
      beforeContent,
    );
  });

  it("源码层不引入 fs / child_process", () => {
    const src = sourceOf("daemon/chat/demo-adapter.ts");
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["'](node:)?child_process["']/);
  });
});

describe("ClaudeCodeAdapter（partner）只读由 CLI 参数层保证", () => {
  it("工具集恰为 Read/Glob/Grep，没有任何写类或联网工具", () => {
    const launch = new ClaudeCodeAdapter({
      apiKey: () => KEY_ANTHROPIC,
      tmpRoot: tmp,
    }).buildLaunch({ prompt: "x", cwd: tmp, nativeSessionId: null });
    const tools = (launch.args[launch.args.indexOf("--tools") + 1] ?? "").split(
      ",",
    );
    expect(tools).toEqual(["Read", "Glob", "Grep"]);
    for (const forbidden of [
      "Edit",
      "Write",
      "MultiEdit",
      "NotebookEdit",
      "Bash",
      "TodoWrite",
      "WebFetch",
      "WebSearch",
      "Task",
    ]) {
      expect(tools, `${forbidden} 不应出现在右栏工具集`).not.toContain(
        forbidden,
      );
    }
  });
});
