/**
 * TASK-L.17b：右栏试玩引导 —— 引导生成 + 只读限制 + 回流微合同修正闭环。
 * 复用 L.16「让 AI 看看」通道（origin:system / intent-router 分流）。
 */
import { describe, expect, it } from "vitest";
import {
  PLAYTEST_GUIDANCE_CHANNEL,
  PLAYTEST_GUIDANCE_ORIGIN,
  assertGuidanceReadOnly,
  buildPlaytestGuidance,
  routePlaytestFeedback,
} from "../../src/lib/journey/playtest-guidance";
import { classifyJourneyIntent } from "../../src/lib/journey/intent-router";

describe("引导生成（origin:system + L.16 ask-ai-look 通道）", () => {
  it("生成 system 源、同通道消息，覆盖参考站对照 / 试玩 / 认可 / 回流", () => {
    const msgs = buildPlaytestGuidance({
      contractLabel: "登录页 v2",
      referenceUrls: ["https://ref.example.com"],
    });
    expect(msgs.length).toBeGreaterThanOrEqual(4);
    expect(msgs.every((m) => m.origin === PLAYTEST_GUIDANCE_ORIGIN)).toBe(true);
    expect(msgs.every((m) => m.origin === "system")).toBe(true);
    expect(msgs.every((m) => m.channel === PLAYTEST_GUIDANCE_CHANNEL)).toBe(
      true,
    );
    const text = msgs.map((m) => m.text).join(" ");
    expect(text).toContain("https://ref.example.com");
    expect(text).toContain("登录页 v2");
    expect(text).toContain("人眼");
    expect(text).toContain("认可");
    expect(text).toContain("微合同");
  });

  it("无参考站时白话兜底，不抛错", () => {
    const msgs = buildPlaytestGuidance();
    expect(msgs[0]!.text).toContain("参考站抓取成果");
  });
});

describe("只读限制：引导只是提示，不带可执行权限", () => {
  it("所有引导消息恒为只读 / 不可执行 / 零权限", () => {
    const msgs = buildPlaytestGuidance({
      referenceUrls: ["https://a.example.com"],
    });
    expect(assertGuidanceReadOnly(msgs)).toBe(true);
    for (const m of msgs) {
      expect(m.read_only).toBe(true);
      expect(m.executable).toBe(false);
      expect(m.permissions).toHaveLength(0);
    }
  });

  it("回流路由结论只含判定字段，不含任何写入 / 命令 / 派工动作", () => {
    const route = routePlaytestFeedback("标题字号调大一点");
    expect(route).not.toHaveProperty("write");
    expect(route).not.toHaveProperty("command");
    expect(route).not.toHaveProperty("dispatch");
    expect(route).not.toHaveProperty("ops");
    expect(Object.keys(route).sort()).toEqual(
      ["intent", "invalidatesCurrentApproval", "loop", "plain_summary"].sort(),
    );
  });
});

describe("修改意见回流微合同修正闭环（intent-router 分流）", () => {
  it("小事 FAST_PATH → MICRO_CONTRACT_REVISION，预告旧认可失效", () => {
    const route = routePlaytestFeedback("帮我把间距调大一点");
    expect(route.intent.kind).toBe("FAST_PATH");
    expect(route.loop).toBe("MICRO_CONTRACT_REVISION");
    expect(route.invalidatesCurrentApproval).toBe(true);
  });

  it("大事 MAJOR_DRAFT → 同样回流微合同", () => {
    const route = routePlaytestFeedback("我要新增一个导出报表功能");
    expect(route.intent.kind).toBe("MAJOR_DRAFT");
    expect(route.loop).toBe("MICRO_CONTRACT_REVISION");
    expect(route.invalidatesCurrentApproval).toBe(true);
  });

  it("质疑 → 自查，不回流版本重置", () => {
    const route = routePlaytestFeedback("这里做错了，帮我查一下");
    expect(route.loop).toBe("DISPUTE_SELF_CHECK");
    expect(route.invalidatesCurrentApproval).toBe(false);
  });

  it("真机继续 → STAY_IN_PLAYTEST", () => {
    const route = routePlaytestFeedback("打开真机预览");
    expect(route.loop).toBe("STAY_IN_PLAYTEST");
    expect(route.invalidatesCurrentApproval).toBe(false);
  });

  it("与 L.16 intent-router 同一口径（同句恒得同一结论）", () => {
    for (const raw of [
      "帮我把间距调大",
      "打开真机预览",
      "这里有问题",
      "你好",
    ]) {
      expect(routePlaytestFeedback(raw).intent.kind).toBe(
        classifyJourneyIntent(raw).kind,
      );
    }
  });
});
