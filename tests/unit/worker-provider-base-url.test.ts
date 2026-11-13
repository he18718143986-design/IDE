import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRuntimeKey,
  getModelSettings,
  getRuntimeBaseUrl,
  getRuntimeKey,
  getRuntimeModel,
  getRuntimeProvider,
  setRuntimeKey,
} from "../../daemon/worker/key-store";
import { OpenAiWorkerClient } from "../../daemon/worker/openai-client";

describe("TASK-J.24 缺口 3：Worker 供应商选择器与 base URL", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    clearRuntimeKey();
    delete process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["STAGENT_PROVIDER"];
    delete process.env["STAGENT_MODEL"];
  });

  afterEach(() => {
    clearRuntimeKey();
    process.env = { ...origEnv };
  });

  it("T-J24-WORKER-001 显式选择 DeepSeek 供应商时，base URL 严格为 deepseek 端点", () => {
    setRuntimeKey("sk-deepseek-12345678", "deepseek-chat", {
      provider: "deepseek",
    });

    expect(getRuntimeKey()).toBe("sk-deepseek-12345678");
    expect(getRuntimeProvider()).toBe("deepseek");
    expect(getRuntimeBaseUrl()).toBe("https://api.deepseek.com/v1");

    expect(() => new OpenAiWorkerClient()).not.toThrow();
  });

  it("T-J24-WORKER-002 显式选择 OpenAI 供应商时，base URL 严格为 openai 端点", () => {
    setRuntimeKey("sk-openai-12345678", "gpt-4o-mini", {
      provider: "openai",
    });

    expect(getRuntimeProvider()).toBe("openai");
    expect(getRuntimeBaseUrl()).toBe("https://api.openai.com/v1");

    expect(() => new OpenAiWorkerClient()).not.toThrow();
  });

  it("T-J24-WORKER-003 选择自定义供应商时，base URL 严格跟随配置的地址", () => {
    setRuntimeKey("sk-custom-12345678", "my-local-model", {
      provider: "custom",
      baseURL: "http://127.0.0.1:11434/v1",
    });

    expect(getRuntimeProvider()).toBe("custom");
    expect(getRuntimeBaseUrl()).toBe("http://127.0.0.1:11434/v1");

    expect(() => new OpenAiWorkerClient()).not.toThrow();
  });

  it("T-J24-WORKER-004 仅有 runtime key、未设 OPENAI_BASE_URL 时，绝不默认打到 api.openai.com", () => {
    // 模拟控制台直接配了非 OpenAI 兼容钥匙但未配置环境变量
    setRuntimeKey("sk-non-openai-key-8888");

    const url = getRuntimeBaseUrl();
    expect(url).not.toBe("https://api.openai.com/v1");
    expect(url).toBeUndefined();
    expect(() => new OpenAiWorkerClient()).toThrow(
      /provider is not configured/i,
    );
  });

  it("T-J24-WORKER-004b 自定义 provider 缺少 URL 时不回退到环境端点", () => {
    process.env["OPENAI_BASE_URL"] = "https://api.openai.com/v1";
    setRuntimeKey("sk-custom-key-12345678", "my-model", { provider: "custom" });
    expect(getRuntimeBaseUrl()).toBeUndefined();
    expect(() => new OpenAiWorkerClient()).toThrow(
      /provider is not configured/i,
    );
  });

  it("T-J24-WORKER-005 严禁靠猜模型名推断供应商（严格跟随显式选择）", () => {
    // 即使模型名字叫 gpt-4o，若选定 provider 为 deepseek，依然打到 deepseek 地址，绝不猜成 openai
    setRuntimeKey("sk-key-12345678", "gpt-4o", {
      provider: "deepseek",
    });
    expect(getRuntimeBaseUrl()).toBe("https://api.deepseek.com/v1");

    // 反之，即使模型名字叫 deepseek-chat，若选定 provider 为 openai，依然打到 openai 地址
    setRuntimeKey("sk-key-12345678", "deepseek-chat", {
      provider: "openai",
    });
    expect(getRuntimeBaseUrl()).toBe("https://api.openai.com/v1");
  });

  it("T-J24-WORKER-006 getModelSettings 正确返回已配状态与供应商元信息（不暴露明文 Key）", () => {
    setRuntimeKey("sk-test-12345678", "deepseek-chat", {
      provider: "deepseek",
    });
    const s = getModelSettings();
    expect(s.configured).toBe(true);
    expect(s.source).toBe("runtime");
    expect(s.provider).toBe("deepseek");
    expect(s.baseURL).toBe("https://api.deepseek.com/v1");
    expect(s.model).toBe("deepseek-chat");
  });
});
