// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { stubOfflineFetch, UNSTUBBED_FETCH_STRICT } from "./setup";

/**
 * TASK-CI.4 / 挂账⑦：判红开关与离线桩回归用例。
 *
 * 保证 UNSTUBBED_FETCH_STRICT 判红开关维持开启态，
 * 以及 stubOfflineFetch 离线桩如约以 reject 应答且不进入未桩登记。
 */
describe("TASK-CI.4 判红开关与离线桩回归", () => {
  it("CI4-P1: 判红开关为显式常量且默认开启", () => {
    // 判红开关必须为显式布尔常量 true：若被置为 false 降级态，本用例变红阻断合入
    expect(UNSTUBBED_FETCH_STRICT).toBe(true);
  });

  it("CI4-P2: 离线桩对声明路径以 reject 应答", async () => {
    const offlinePath = "/api/test-ci4-offline-sentinel";
    stubOfflineFetch([offlinePath]);

    // 1. 声明的路径 fetch 被拒绝，且错误信息包含「离线桩」
    await expect(fetch(offlinePath)).rejects.toThrowError(/离线桩/);
    await expect(fetch(`http://localhost${offlinePath}`)).rejects.toThrowError(
      /离线桩/,
    );

    // 2. 且该请求不进入未桩登记：
    // setup.ts 的 afterEach 会在 unstubbedHits 非空且严格态开启时抛出未桩真实请求异常。
    // 本用例正常结束即代表离线桩路径未被记录进 unstubbedHits。
  });
});
