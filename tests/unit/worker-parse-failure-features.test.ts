/**
 * TASK-J.56：Worker 解析失败落盘原文特征。
 * 锁死「有特征、无完整原文、无密钥」；不改解析成功路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import {
  E_WORKER_PARSE,
  extractWorkerParseFailureFeatures,
  parseWorkerPatch,
  withParseRetry,
  WORKER_PARSE_FAILURE_SNIPPET_MAX,
  WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH,
  type WorkerParseFailureFeatures,
} from "../../daemon/worker/parse-worker-output";
import { OpenAiWorkerClient } from "../../daemon/worker/openai-client";
import type { WorkerGenerationInput } from "../../daemon/worker/ai-worker";

const h = vi.hoisted(() => ({
  generateObject: vi.fn(),
  createOpenAI: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: h.generateObject,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: h.createOpenAI,
}));

const MID = "UNIQUE_MID_MARKER_J56_DO_NOT_LOG_aa11bb22cc33dd44ee55ff6677889900";
const SK = "sk-abcdefghijkl";
const BEARER = "Bearer tok_j56_test_value_abcdef";
const API_KEY = "api_key=secretj56val";

class FakeNoObjectGeneratedError extends Error {
  text?: string;

  constructor(message: string, text?: string) {
    super(message);
    this.name = "AI_NoObjectGeneratedError";
    if (text !== undefined) this.text = text;
  }
}

function longFencedJson(): string {
  const pad = "PAD_".repeat(20);
  return (
    "```json\n" +
    `{"changes":[{"path":"a.ts","content":"${MID}${pad}"}],"log":["ok"]}\n` +
    "```"
  );
}

function forbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) forbiddenKeys(item, found);
    return found;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "text" || key === "raw" || key === "full") found.push(key);
      forbiddenKeys(child, found);
    }
  }
  return found;
}

function featuresFrom(err: unknown, attempt = 0, modelId = "deepseek-flash") {
  return extractWorkerParseFailureFeatures({ err, attempt, modelId });
}

describe("J56-P1/P3 特征抽取纯函数", () => {
  it("J56-P1: 超长围栏 JSON 含必记特征，中段不出现，无 text/raw/full，≤40 的 head/tail", () => {
    const raw = longFencedJson();
    expect(raw.length).toBeGreaterThan(WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH);
    expect(raw.includes(MID)).toBe(true);
    const midIndex = raw.indexOf(MID);
    expect(midIndex).toBeGreaterThan(WORKER_PARSE_FAILURE_SNIPPET_MAX);
    expect(midIndex + MID.length).toBeLessThan(
      raw.length - WORKER_PARSE_FAILURE_SNIPPET_MAX,
    );

    const features = featuresFrom(
      new FakeNoObjectGeneratedError(
        "No object generated: could not parse the response.",
        raw,
      ),
    );

    expect(features.text_present).toBe(true);
    expect(features.text_length).toBe(raw.length);
    expect(features.starts_with_fence).toBe(true);
    expect(features.ends_with_fence).toBe(true);
    expect(features.starts_with_brace).toBe(false);
    expect(features.ends_with_brace).toBe(false);
    expect(features.reason).toBe("json_parse");
    expect(features.attempt).toBe(0);
    expect(features.model_id).toBe("deepseek-flash");
    expect(features.head).toBe(raw.slice(0, WORKER_PARSE_FAILURE_SNIPPET_MAX));
    expect(features.tail).toBe(raw.slice(-WORKER_PARSE_FAILURE_SNIPPET_MAX));
    expect(features.head?.length).toBe(WORKER_PARSE_FAILURE_SNIPPET_MAX);
    expect(features.tail?.length).toBe(WORKER_PARSE_FAILURE_SNIPPET_MAX);
    expect(JSON.stringify(features)).not.toContain(MID);
    expect(forbiddenKeys(features)).toEqual([]);
    expect(JSON.stringify(features)).not.toContain(raw);
    expect(JSON.stringify(features)).not.toMatch(/"message"\s*:/);
  });

  it("text 缺失时仍记布尔与长度、原因 other，不写 head/tail", () => {
    const features = featuresFrom(
      new FakeNoObjectGeneratedError("unexpected model failure"),
      1,
      "demo-model",
    );
    expect(features.text_present).toBe(false);
    expect(features.text_length).toBe(0);
    expect(features.starts_with_fence).toBe(false);
    expect(features.starts_with_brace).toBe(false);
    expect(features.ends_with_fence).toBe(false);
    expect(features.ends_with_brace).toBe(false);
    expect(features.reason).toBe("other");
    expect(features.attempt).toBe(1);
    expect(features.model_id).toBe("demo-model");
    expect(features.head).toBeUndefined();
    expect(features.tail).toBeUndefined();
    expect(forbiddenKeys(features)).toEqual([]);
  });

  it("schema 原因码：did not match schema", () => {
    const features = featuresFrom(
      new FakeNoObjectGeneratedError(
        "No object generated: response did not match schema.",
        '{"changes":[]}',
      ),
    );
    expect(features.reason).toBe("schema");
    expect(features.starts_with_brace).toBe(true);
    expect(features.ends_with_brace).toBe(true);
    expect(features.starts_with_fence).toBe(false);
  });

  it("J56-P3: 原文长度等于 80 时不写 head/tail；81 才写各最多 40 字符", () => {
    const atLimit = `{${"a".repeat(78)}}`;
    expect(atLimit.length).toBe(WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH);
    const noSnippet = featuresFrom(
      new FakeNoObjectGeneratedError(
        "No object generated: could not parse the response.",
        atLimit,
      ),
    );
    expect(noSnippet.text_present).toBe(true);
    expect(noSnippet.text_length).toBe(80);
    expect(noSnippet.head).toBeUndefined();
    expect(noSnippet.tail).toBeUndefined();
    expect(noSnippet.starts_with_brace).toBe(true);
    expect(noSnippet.ends_with_brace).toBe(true);

    const over = `${atLimit}x`;
    expect(over.length).toBe(81);
    const withSnippet = featuresFrom(
      new FakeNoObjectGeneratedError(
        "No object generated: could not parse the response.",
        over,
      ),
    );
    expect(withSnippet.head).toBe(over.slice(0, 40));
    expect(withSnippet.tail).toBe(over.slice(-40));
    expect(withSnippet.head?.length).toBe(40);
    expect(withSnippet.tail?.length).toBe(40);
  });
});

describe("J56-P4 成功路径与错误包装不回归", () => {
  it("withParseRetry 合法 patch 仍零重试；失败仍包成 E_WORKER_PARSE", async () => {
    const onRetry = vi.fn();
    const ok = await withParseRetry(
      async () => ({
        changes: [{ path: "README.md", content: "hi" }],
        log: ["ok"],
      }),
      (raw, retriesUsed) => parseWorkerPatch(raw, { retriesUsed }),
      { onRetry },
    );
    expect(ok.retriesUsed).toBe(0);
    expect(onRetry).not.toHaveBeenCalled();
    expect(ok.value.changes[0]?.path).toBe("README.md");

    let calls = 0;
    await expect(
      withParseRetry(
        async () => {
          calls += 1;
          throw new FakeNoObjectGeneratedError(
            "No object generated: could not parse the response.",
            "{not-json",
          );
        },
        (raw, retriesUsed) => parseWorkerPatch(raw, { retriesUsed }),
        { onRetry },
      ),
    ).rejects.toMatchObject({
      code: E_WORKER_PARSE,
      name: "WorkerParseError",
    });
    expect(calls).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAiWorkerClient 挂钩：日志有特征、无完整原文、无密钥", () => {
  let repoRoot: string;

  const input = {
    contract: { contract_id: "contract_j56_test" },
    task: {
      contract_revision: 1,
      worktree_root: "/tmp/j56-fake-worktree",
      system_prompt: "sys",
    },
    files: [{ path: "a.ts", content: "export {};" }],
  } as unknown as WorkerGenerationInput;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "j56-features-"));
    h.generateObject.mockReset();
    h.createOpenAI.mockReset();
    h.createOpenAI.mockImplementation(
      (opts: { apiKey: string; baseURL?: string }) => (modelId: string) => ({
        modelId,
        apiKey: opts.apiKey,
        baseURL: opts.baseURL,
      }),
    );
  });

  afterEach(() => {
    safeRmSync(repoRoot);
  });

  function client() {
    return new OpenAiWorkerClient({
      apiKey: "test-key-not-sent",
      modelId: "deepseek-flash",
      baseURL: "https://example.invalid/v1",
      repoRoot,
    });
  }

  function readLog(): string {
    const file = path.join(repoRoot, ".stagent/logs/daemon.jsonl");
    return fs.readFileSync(file, "utf8");
  }

  function failureDetails(): WorkerParseFailureFeatures[] {
    return readLog()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((row) => row["kind"] === "worker_parse_failure")
      .map((row) => {
        expect(row).not.toHaveProperty("message");
        expect(forbiddenKeys(row)).toEqual([]);
        return row["detail"] as WorkerParseFailureFeatures;
      });
  }

  it("J56-P1/P4: 首次与重试各记一条带 attempt；仍抛 E_WORKER_PARSE；中段不落盘", async () => {
    const raw = longFencedJson();
    h.generateObject.mockRejectedValue(
      new FakeNoObjectGeneratedError(
        "No object generated: could not parse the response.",
        raw,
      ),
    );

    await expect(client().generateChanges(input)).rejects.toMatchObject({
      code: E_WORKER_PARSE,
      name: "WorkerParseError",
    });
    expect(h.generateObject).toHaveBeenCalledTimes(2);

    const details = failureDetails();
    expect(details).toHaveLength(2);
    expect(details[0]?.attempt).toBe(0);
    expect(details[1]?.attempt).toBe(1);
    for (const detail of details) {
      expect(detail.text_present).toBe(true);
      expect(detail.text_length).toBe(raw.length);
      expect(detail.starts_with_fence).toBe(true);
      expect(detail.ends_with_fence).toBe(true);
      expect(detail.reason).toBe("json_parse");
      expect(detail.model_id).toBe("deepseek-flash");
      expect(String(detail.head).length).toBeLessThanOrEqual(
        WORKER_PARSE_FAILURE_SNIPPET_MAX,
      );
      expect(String(detail.tail).length).toBeLessThanOrEqual(
        WORKER_PARSE_FAILURE_SNIPPET_MAX,
      );
    }
    const serialized = readLog();
    expect(serialized).not.toContain(MID);
    expect(serialized).not.toContain(raw);
    expect(serialized).not.toMatch(/"text"\s*:/);
    expect(serialized).not.toMatch(/"raw"\s*:/);
    expect(serialized).not.toMatch(/"full"\s*:/);
  });

  it("J56-P2: 片段中的 sk- / Bearer / api_key= 被脱敏", async () => {
    const raw = `${SK}\n${API_KEY}\n` + "M".repeat(40) + `\n${BEARER}`;
    expect(raw.slice(0, 40)).toContain(SK);
    expect(raw.slice(0, 40)).toContain(API_KEY);
    expect(raw.slice(-40)).toContain(BEARER);
    expect(raw.length).toBeGreaterThan(WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH);
    h.generateObject.mockRejectedValue(
      new FakeNoObjectGeneratedError(
        "No object generated: could not parse the response.",
        raw,
      ),
    );

    await expect(client().generateChanges(input)).rejects.toMatchObject({
      code: E_WORKER_PARSE,
    });

    const serialized = readLog();
    expect(serialized).not.toContain(SK);
    expect(serialized).not.toContain("tok_j56_test_value_abcdef");
    expect(serialized).not.toContain("secretj56val");
    expect(serialized).toMatch(/sk-\[REDACTED\]/);
    expect(serialized).toMatch(/Bearer \[REDACTED\]/);
    expect(serialized).toMatch(/api_key=\[REDACTED\]/);
    expect(failureDetails()[0]?.head).toBeDefined();
  });

  it("J56-P4: 成功路径不写失败特征日志，行为不回归", async () => {
    h.generateObject.mockResolvedValue({
      object: {
        changes: [{ path: "a.ts", content: "export {};" }],
        log: ["ok"],
      },
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    const result = await client().generateChanges(input);
    expect(result.changes).toEqual([{ path: "a.ts", content: "export {};" }]);
    expect(result.log).toEqual(["ok"]);
    expect(h.generateObject).toHaveBeenCalledTimes(1);
    const logFile = path.join(repoRoot, ".stagent/logs/daemon.jsonl");
    if (fs.existsSync(logFile)) {
      const rows = fs
        .readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { kind?: string });
      expect(rows.filter((row) => row.kind === "worker_parse_failure")).toEqual(
        [],
      );
    }
  });
});
