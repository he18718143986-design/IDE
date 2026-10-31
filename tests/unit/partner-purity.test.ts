import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import { BaselineChatAdapter } from "../../daemon/chat/baseline-adapter";
import { ChatSessionManager } from "../../daemon/chat/session-manager";
import type {
  AdapterEvent,
  AdapterRunInput,
  ChatAdapter,
} from "../../daemon/chat/types";
import { addProtectionEntry } from "../../daemon/protection/protection-list";
import { ClaudeCodeAdapter } from "../../daemon/worker/cli-host/claude-code-adapter";
import type { ChatEvent } from "../../src/lib/chat-events";

/**
 * TASK-L.1 / ADR-0014 §1：右栏纯净化。
 * - BaselineChatAdapter 调用 streamText 时不含 system
 * - 保护清单非空时，session-manager 交给适配器的 prompt === 用户输入
 * - ClaudeCodeAdapter.buildLaunch 的 args 不含系统提示参数
 */

const h = vi.hoisted(() => ({
  captured: [] as Record<string, unknown>[],
}));

vi.mock("ai", () => ({
  streamText: (opts: Record<string, unknown>) => {
    h.captured.push(opts);
    return {
      textStream: (async function* () {
        yield "ok";
      })(),
    };
  },
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (model: string) => ({ modelId: model }),
}));

async function drain(it: AsyncIterable<AdapterEvent>) {
  for await (const _ of it) {
    /* drain */
  }
}

class CaptureAdapter implements ChatAdapter {
  calls: AdapterRunInput[] = [];
  info() {
    return {
      id: "capture",
      label: "capture",
      control_mode: "GATEWAY_ENFORCED" as const,
      verified_on: "",
      available: true,
      tool_mode: "read_only" as const,
    };
  }
  async *run(input: AdapterRunInput): AsyncIterable<AdapterEvent> {
    this.calls.push(input);
    yield { kind: "delta", text: "pong" };
  }
}

describe("TASK-L.1 右栏纯净化（partner purity）", () => {
  let tmp: string;
  const KEY_OPENAI = "sk-openai-l1-purity";
  const KEY_ANTHROPIC = "sk-ant-l1-purity-0123456789";

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l1-")));
    h.captured.length = 0;
  });
  afterEach(() => safeRmSync(tmp));

  it("BaselineChatAdapter.run 调用 streamText 时入参不含 system", async () => {
    const saved = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = KEY_OPENAI;
    try {
      await drain(
        new BaselineChatAdapter().run({
          prompt: "用户原话",
          cwd: tmp,
          nativeSessionId: null,
          history: [{ role: "user", text: "上一轮" }],
          signal: new AbortController().signal,
        }),
      );
      expect(h.captured).toHaveLength(1);
      const opts = h.captured[0]!;
      expect(opts).not.toHaveProperty("system");
      expect(Object.keys(opts).sort()).toEqual(
        ["abortSignal", "messages", "model"].sort(),
      );
      expect(opts["messages"]).toEqual([
        { role: "user", content: "上一轮" },
        { role: "user", content: "用户原话" },
      ]);
    } finally {
      if (saved === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = saved;
    }
  });

  it("保护清单非空时，session-manager 交给适配器的 prompt 与用户输入全等", async () => {
    addProtectionEntry(tmp, "登录", ["src/auth/**"]);
    const adapter = new CaptureAdapter();
    const events: ChatEvent[] = [];
    const manager = new ChatSessionManager({
      repoRoot: tmp,
      adapters: [adapter],
      publish: (e) => events.push(e),
    });
    const session = manager.createSession("capture");
    const userText = "帮我看看登录页怎么改";
    manager.send(session.id, userText);
    await manager.idle(session.id);
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]!.prompt).toBe(userText);
    // 注入前缀曾含「保护清单」与 patterns；纯净化后不得出现
    expect(adapter.calls[0]!.prompt).not.toMatch(/【Stagent 保护清单】/);
    expect(adapter.calls[0]!.prompt).not.toContain("src/auth/**");
    expect(adapter.calls[0]!.prompt).not.toContain("---");
  });

  it("ClaudeCodeAdapter.buildLaunch 的 args 不含 --system-prompt / --append-system-prompt", () => {
    const launch = new ClaudeCodeAdapter({
      apiKey: () => KEY_ANTHROPIC,
      tmpRoot: tmp,
    }).buildLaunch({
      prompt: "纯用户输入",
      cwd: tmp,
      nativeSessionId: null,
    });
    expect(launch.args).not.toContain("--system-prompt");
    expect(launch.args).not.toContain("--append-system-prompt");
    const joined = launch.args.join("\0");
    expect(joined).not.toMatch(/--system-prompt|--append-system-prompt/);
  });
});
