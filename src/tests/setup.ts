/**
 * 全局测试 setup。
 *
 * 本仓库默认测试环境为 `node`（daemon / lib / integration / e2e 共 33 个文件），
 * 仅组件与 hook 测试通过文件头 `// @vitest-environment jsdom` 显式声明 DOM 环境。
 *
 * 原因：jsdom 环境在本机每个 worker 的启动开销约 15~17s（实测 environment 累计
 * 32~34s / 2 workers），全量 38 文件并发时会把 worker 握手拖过 vitest 默认超时，
 * 表现为 `Timeout waiting for worker to respond`。因此 setup 必须对无 DOM 环境安全。
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

const hasDom = typeof window !== "undefined";

/**
 * 未桩请求判红开关（TASK-CI.3）。
 *
 * - `true`（默认，严格态）：测试中出现未桩的真实请求，所在测试的 afterEach 判红并列出 URL。
 * - `false`（降级态）：仅 warn 不判红。仅用于临时定位存量问题，不得作为交付状态提交。
 */
export const UNSTUBBED_FETCH_STRICT = true;

/** 未桩请求日志统一前缀，便于 CI 日志机器统计（区别于应用层 `[L.10]` 日志）。 */
export const UNSTUBBED_FETCH_PREFIX = "[unstubbed-fetch]";

const unstubbedHits: string[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** 全局兜底：任何未桩请求立即 reject（不挂起、不泄漏到 jsdom 销毁之后），并登记 URL。 */
function unstubbedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = requestUrl(input);
  unstubbedHits.push(url);
  console.warn(`${UNSTUBBED_FETCH_PREFIX} 未桩的真实请求：${url}`);
  return Promise.reject(new TypeError(`未桩的真实请求：${url}`));
}

/**
 * 文件级离线桩（TASK-CI.3）。
 *
 * 仅对列出的 pathname 以离线失败应答（行为与哨兵一致），其余请求仍交给哨兵登记。
 * 补桩只允许「离线失败」或与真实 schema 一致的最小夹具，禁止为求绿伪造成功数据。
 * 在文件顶层 `beforeEach` 中调用；测试自己的 `vi.stubGlobal("fetch", …)` 优先生效。
 */
export function stubOfflineFetch(pathnames: readonly string[]): void {
  vi.stubGlobal("fetch", ((input: RequestInfo | URL) => {
    const pathname = new URL(requestUrl(input), "http://localhost").pathname;
    if (pathnames.includes(pathname)) {
      return Promise.reject(new TypeError(`离线桩：${pathname}`));
    }
    return unstubbedFetch(input);
  }) as typeof fetch);
}

if (hasDom) {
  /**
   * 全局 fetch 哨兵（挂账② 治本，TASK-CI.3 判红）。
   *
   * 挂载时会发真实请求的组件，只要测试没桩全，未决请求就会活过 jsdom 销毁，
   * 表现为偶发的 `window is not defined`。哨兵让未桩请求立即 reject 并登记；
   * 严格态下所在测试判红，使缺桩在测试内被直接指认。
   */
  globalThis.fetch = ((input: RequestInfo | URL) =>
    unstubbedFetch(input)) as typeof fetch;

  afterEach(() => {
    const hits = unstubbedHits.splice(0);
    if (hits.length === 0 || !UNSTUBBED_FETCH_STRICT) return;
    throw new Error(
      `${UNSTUBBED_FETCH_PREFIX} 本测试出现未桩的真实请求，请在所在文件补离线桩：\n` +
        [...new Set(hits)].join("\n"),
    );
  });

  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: () => {},
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
