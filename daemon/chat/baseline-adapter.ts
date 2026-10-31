import type { ChatAdapterInfo } from "../../src/lib/chat-events";
import { getRuntimeKey, getRuntimeModel } from "../worker/key-store";
import type { AdapterEvent, AdapterRunInput, ChatAdapter } from "./types";

/**
 * 自研保底 Agent（对话版）：与 ai-worker.ts 共用同一套 OpenAI 兼容 Key，
 * 只做文字问答、不改文件；改文件仍走合同 + ai-worker。
 */
export class BaselineChatAdapter implements ChatAdapter {
  info(): ChatAdapterInfo {
    const key = getRuntimeKey();
    return {
      id: "baseline",
      label: "自研保底 Agent（OpenAI 兼容，只聊天）",
      control_mode: "GATEWAY_ENFORCED",
      verified_on: "",
      available: !!key,
      // 只聊天、不改文件（TASK-J.1）：右栏允许选中
      tool_mode: "read_only",
      ...(key ? {} : { unavailable_reason: "还差一步：去设置里配模型钥匙" }),
    };
  }

  async *run(input: AdapterRunInput): AsyncIterable<AdapterEvent> {
    const apiKey = getRuntimeKey();
    if (!apiKey)
      throw new Error("还差一步：请到设置 → 模型钥匙里配置后再开新会话");
    const [{ streamText }, { createOpenAI }] = await Promise.all([
      import("ai"),
      import("@ai-sdk/openai"),
    ]);
    const baseURL = process.env["OPENAI_BASE_URL"];
    const provider = createOpenAI({
      apiKey,
      ...(baseURL === undefined ? {} : { baseURL }),
    });
    // TASK-L.1 / ADR-0014 §1：右栏无系统提示；messages 仅历史与本条用户消息
    const result = streamText({
      model: provider(getRuntimeModel()),
      messages: [
        ...input.history.map((h) => ({ role: h.role, content: h.text })),
        { role: "user" as const, content: input.prompt },
      ],
      abortSignal: input.signal,
    });
    for await (const text of result.textStream) {
      if (input.signal.aborted) return;
      yield { kind: "delta", text };
    }
  }
}
