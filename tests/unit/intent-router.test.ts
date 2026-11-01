/**
 * TASK-L.16：intent-router E 类「线上问题」判定。
 */
import { describe, expect, it } from "vitest";
import { classifyJourneyIntent } from "../../src/lib/journey/intent-router";

describe("TASK-L.16 intent-router E 类 LIVE_INCIDENT", () => {
  it("命中：含「线上」且无施工中合同", () => {
    const r = classifyJourneyIntent("线上这里不对，帮忙看看");
    expect(r.kind).toBe("LIVE_INCIDENT");
    expect(r.skip_demo).toBe(true);
    expect(r.reasons.some((x) => /线上|回流/.test(x))).toBe(true);
  });

  it("命中：消息含 LIVE 目标名", () => {
    const r = classifyJourneyIntent("本机又挂了", {
      liveTargetNames: ["本机", "正式站"],
    });
    expect(r.kind).toBe("LIVE_INCIDENT");
  });

  it("不命中：短闲聊", () => {
    expect(classifyJourneyIntent("你好").kind).toBe("CHAT");
  });

  it("不命中：有施工中合同时即使说「线上」", () => {
    const r = classifyJourneyIntent("线上标题字号调大一点", {
      hasInProgressContract: true,
    });
    expect(r.kind).not.toBe("LIVE_INCIDENT");
    expect(r.kind).toBe("FAST_PATH");
  });
});
