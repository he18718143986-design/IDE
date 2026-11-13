/**
 * 模型凭据运行时配置（仅内存，不落盘、不回显）。
 * 规范安全边界：Key 只存在于 Daemon 进程内，浏览器仅在提交时短暂持有。
 * TASK-J.24 缺口 3：支持供应商选择器（DeepSeek、OpenAI、自定义），严格跟随选择，绝不靠猜模型名推断。
 */
export interface ModelSettings {
  configured: boolean;
  model: string;
  source: "runtime" | "environment" | "none";
  provider?: string;
  baseURL?: string;
}

let runtimeKey: string | null = null;
let runtimeModel: string | null = null;
let runtimeProvider: string | null = null;
let runtimeBaseURL: string | null = null;

export const KNOWN_PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  openai: "https://api.openai.com/v1",
};

export function setRuntimeKey(
  apiKey: string,
  model?: string,
  options?: { provider?: string; baseURL?: string },
): void {
  runtimeKey = apiKey.trim();
  if (model && model.trim()) runtimeModel = model.trim();
  if (options?.provider && options.provider.trim()) {
    runtimeProvider = options.provider.trim().toLowerCase();
  }
  if (options?.baseURL && options.baseURL.trim()) {
    runtimeBaseURL = options.baseURL.trim().replace(/\/+$/, "");
  } else if (runtimeProvider && KNOWN_PROVIDER_BASE_URLS[runtimeProvider]) {
    runtimeBaseURL = KNOWN_PROVIDER_BASE_URLS[runtimeProvider] ?? null;
  }
}

export function clearRuntimeKey(): void {
  runtimeKey = null;
  runtimeModel = null;
  runtimeProvider = null;
  runtimeBaseURL = null;
}

export function getRuntimeProvider(): string | null {
  return runtimeProvider ?? process.env["STAGENT_PROVIDER"] ?? null;
}

export function getRuntimeBaseUrl(): string | undefined {
  if (runtimeBaseURL) return runtimeBaseURL;
  if (runtimeProvider) {
    // 已选 provider 后严格跟随，不允许自定义 provider 静默回退到环境端点。
    return KNOWN_PROVIDER_BASE_URLS[runtimeProvider];
  }
  // 环境端点只适用于未设置 runtime provider 的环境配置。
  if (!runtimeKey && process.env["OPENAI_BASE_URL"]) {
    return process.env["OPENAI_BASE_URL"];
  }
  if (!runtimeKey && process.env["OPENAI_API_KEY"]) {
    return KNOWN_PROVIDER_BASE_URLS["openai"];
  }
  return undefined;
}

export function getRuntimeKey(): string | null {
  return runtimeKey ?? process.env["OPENAI_API_KEY"] ?? null;
}

export function getRuntimeModel(): string {
  if (runtimeModel) return runtimeModel;
  if (process.env["STAGENT_MODEL"]) return process.env["STAGENT_MODEL"];
  const prov = getRuntimeProvider();
  if (prov === "deepseek") return "deepseek-chat";
  return "gpt-4o-mini";
}

export function getModelSettings(): ModelSettings {
  const source = runtimeKey
    ? "runtime"
    : process.env["OPENAI_API_KEY"]
      ? "environment"
      : "none";
  const provider =
    getRuntimeProvider() ?? (source === "environment" ? "openai" : undefined);
  const baseURL = getRuntimeBaseUrl();
  return {
    configured: source !== "none",
    model: getRuntimeModel(),
    source,
    ...(provider ? { provider } : {}),
    ...(baseURL ? { baseURL } : {}),
  };
}
