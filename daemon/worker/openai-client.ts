import { z } from "zod";
import { getRuntimeBaseUrl, getRuntimeKey, getRuntimeModel } from "./key-store";
import { appendLlmMeta } from "../core/debug-log";
import type {
  WorkerGenerationInput,
  WorkerGenerationResult,
  WorkerModelClient,
} from "./ai-worker";
import {
  parseWorkerPatch,
  withParseRetry,
  type ParseRetryHooks,
} from "./parse-worker-output";

const workerOutputSchema = z.object({
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .describe("需要在授权范围内创建或覆盖的文件完整内容"),
  log: z.array(z.string()).describe("按步骤描述的中文改动说明"),
});

/**
 * OpenAI 兼容模型客户端（Daemon 侧）。
 * 密钥仅从 Daemon 进程环境读取，绝不下发给浏览器或写入合同。
 * TASK-H.1：格式校验失败时 ≤1 次本地重试，仍失败则抛可识别错误（不挂起）。
 */
export class OpenAiWorkerClient implements WorkerModelClient {
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly baseURL?: string | undefined;
  private readonly parseHooks: ParseRetryHooks;

  private readonly repoRoot?: string | undefined;

  constructor(
    options: {
      apiKey?: string | undefined;
      modelId?: string | undefined;
      baseURL?: string | undefined;
      /** 测试可注入重试钩子 */
      parseHooks?: ParseRetryHooks | undefined;
      /** TASK-C.17：LLM 元数据落盘根 */
      repoRoot?: string | undefined;
    } = {},
  ) {
    const key = options.apiKey ?? getRuntimeKey();
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not configured; set it via the console settings or the Daemon environment.",
      );
    }
    this.apiKey = key;
    this.modelId = options.modelId ?? getRuntimeModel();
    this.baseURL = options.baseURL ?? getRuntimeBaseUrl();
    if (!this.baseURL) {
      throw new Error(
        "Worker provider is not configured; choose a provider in Settings or set OPENAI_BASE_URL.",
      );
    }
    this.parseHooks = options.parseHooks ?? {};
    this.repoRoot = options.repoRoot;
  }

  async generateChanges(
    input: WorkerGenerationInput,
  ): Promise<WorkerGenerationResult> {
    const startedAt = Date.now();
    const [{ generateObject }, { createOpenAI }] = await Promise.all([
      import("ai"),
      import("@ai-sdk/openai"),
    ]);

    const provider = createOpenAI({
      apiKey: this.apiKey,
      ...(this.baseURL === undefined ? {} : { baseURL: this.baseURL }),
    });

    const contract = input.contract;
    const task = input.task;
    const system = task.system_prompt;

    const basePrompt = [
      `合同：${contract.contract_id}（revision ${task.contract_revision}）`,
      `工作目录：${task.worktree_root}`,
      `现有文件：\n${input.files
        .map((f) => `=== ${f.path} ===\n${f.content}`)
        .join("\n\n")}`,
      "请按输出契约返回 changes 数组（完整文件内容）；若无需改动返回空数组。",
    ].join("\n\n");

    const strictSuffix =
      "\n\n【重试】上次输出格式无效。请只返回合法 JSON 对象，字段必须含 changes:[{path,content}] 与 log:string[]，不要 markdown 围栏。";

    const { value } = await withParseRetry(
      async (attempt) => {
        const prompt = attempt === 0 ? basePrompt : basePrompt + strictSuffix;
        const result = await generateObject({
          model: provider(this.modelId),
          schema: workerOutputSchema,
          system,
          prompt,
          ...(input.signal === undefined ? {} : { abortSignal: input.signal }),
        });
        const usage = result.usage as
          { inputTokens?: number; outputTokens?: number } | undefined;
        return {
          object: result.object,
          usage: {
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
          },
        };
      },
      (raw, retriesUsed) => {
        const envelope = raw as {
          object: unknown;
          usage: { inputTokens: number; outputTokens: number };
        };
        const patch = parseWorkerPatch(envelope.object, { retriesUsed });
        return {
          changes: patch.changes,
          log: patch.log,
          usage: envelope.usage,
        } satisfies WorkerGenerationResult;
      },
      this.parseHooks,
    );

    if (this.repoRoot) {
      try {
        appendLlmMeta(this.repoRoot, {
          source: "worker",
          duration_ms: Date.now() - startedAt,
          model: this.modelId,
          enrichCode: "OK",
          input_tokens: value.usage.inputTokens,
          output_tokens: value.usage.outputTokens,
          contractId: input.contract.contract_id,
        });
      } catch {
        /* ignore */
      }
    }
    return value;
  }
}
