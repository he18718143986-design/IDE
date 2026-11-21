/**
 * 生产用意图编译器模型客户端（TASK-J.45）。
 *
 * 与 OpenAiWorkerClient 分开：那边输出文件补丁，这里输出编译器结构化方案。
 * 对象可在没有钥匙时构造。钥匙在每次 generate 里重读，启动后写入的钥匙不用重启。
 * 不重试、不加第二套超时；循环自己的中止信号原样传下去。
 */
import { buildCompilerOutputSchema } from "../../../src/lib/journey/compiler-output-schema";
import {
  getRuntimeBaseUrl,
  getRuntimeKey,
  getRuntimeModel,
} from "../../worker/key-store";
import type {
  IntentCompilerModelClient,
  IntentCompilerModelRequest,
  IntentCompilerModelResult,
} from "./compile-loop";

export function createOpenAiCompilerClient(): IntentCompilerModelClient {
  return {
    async generate(
      req: IntentCompilerModelRequest,
    ): Promise<IntentCompilerModelResult> {
      const apiKey = getRuntimeKey();
      if (apiKey == null) {
        return { ok: false, reason: "invalid", detail: "no_key" };
      }
      if (req.signal?.aborted) {
        return { ok: false, reason: "canceled", detail: "aborted" };
      }

      const modelId = getRuntimeModel();
      const baseURL = getRuntimeBaseUrl();
      try {
        const [{ generateObject }, { createOpenAI }] = await Promise.all([
          import("ai"),
          import("@ai-sdk/openai"),
        ]);
        const provider = createOpenAI({
          apiKey,
          ...(baseURL === undefined ? {} : { baseURL }),
        });
        const result = await generateObject({
          model: provider(modelId),
          schema: buildCompilerOutputSchema(req.enums),
          system: req.system,
          prompt: req.prompt,
          temperature: req.temperature,
          maxRetries: 0,
          ...(req.signal === undefined ? {} : { abortSignal: req.signal }),
        });
        const usage = result.usage as
          { inputTokens?: number; outputTokens?: number } | undefined;
        return {
          ok: true,
          raw: result.object,
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
          model_id: modelId,
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (isAbortError(err, req.signal)) {
          return { ok: false, reason: "canceled", detail };
        }
        return { ok: false, reason: "network", detail };
      }
    },
  };
}

function isAbortError(err: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (typeof err === "object" && err !== null && "name" in err) {
    if ((err as { name?: unknown }).name === "AbortError") return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /abort/i.test(message);
}
