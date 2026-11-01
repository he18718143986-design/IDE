/**
 * TASK-L.16：E 类分流上下文纯函数。
 */
import { describe, expect, it } from "vitest";
import {
  buildJourneyLiveIncidentContext,
  collectLiveTargetNames,
  hasInProgressConstruction,
  isConstructionLifecycle,
} from "../../src/lib/journey/live-incident-context";
import { classifyJourneyIntent } from "../../src/lib/journey/intent-router";

describe("live-incident-context", () => {
  it("施工中 lifecycle 判定", () => {
    expect(isConstructionLifecycle("EXECUTING")).toBe(true);
    expect(isConstructionLifecycle("PREPARING")).toBe(true);
    expect(isConstructionLifecycle("VERIFYING")).toBe(true);
    expect(isConstructionLifecycle("PENDING_RESUME")).toBe(true);
    expect(isConstructionLifecycle("DRAFT")).toBe(false);
    expect(isConstructionLifecycle("PENDING_APPROVAL")).toBe(false);
    expect(isConstructionLifecycle("AUDITED")).toBe(false);
    expect(isConstructionLifecycle("MERGED")).toBe(false);
    expect(isConstructionLifecycle("ABORTED")).toBe(false);
  });

  it("LIVE 记录收集白话名与 id", () => {
    const names = collectLiveTargetNames([
      {
        state: "LIVE",
        target_id: "local",
        target_label: "本机",
      },
      {
        state: "FAILED",
        target_id: "staging",
        target_label: "预发",
      },
    ]);
    expect(names).toEqual(["local", "本机"]);
  });

  it("未插桩 live_incident 的目标名也收集（崩溃后 FAILED）", () => {
    const names = collectLiveTargetNames([
      {
        state: "FAILED",
        target_id: "local",
        target_label: "本机",
        live_incident: {
          target_id: "local",
          target_label: "本机",
          stub_created: false,
        },
      },
    ]);
    expect(names).toContain("本机");
    expect(names).toContain("local");
  });

  it("已插桩事故不再贡献目标名（除非仍 LIVE）", () => {
    const names = collectLiveTargetNames([
      {
        state: "FAILED",
        target_id: "local",
        live_incident: {
          target_id: "local",
          target_label: "本机",
          stub_created: true,
        },
      },
    ]);
    expect(names).toEqual([]);
  });

  it("store 有 EXECUTING → hasInProgress true", () => {
    expect(
      hasInProgressConstruction({
        contracts: [
          { lifecycle_state: "MERGED" },
          { lifecycle_state: "EXECUTING" },
        ],
      }),
    ).toBe(true);
  });

  it("仅 DRAFT/MERGED → hasInProgress false", () => {
    expect(
      hasInProgressConstruction({
        contracts: [
          { lifecycle_state: "DRAFT" },
          { lifecycle_state: "MERGED" },
        ],
      }),
    ).toBe(false);
  });

  it("所选合同仍在施工 → true（即使 store 其它全终态）", () => {
    expect(
      hasInProgressConstruction({
        contracts: [{ lifecycle_state: "MERGED" }],
        selectedContract: { lifecycle_state: "VERIFYING" },
      }),
    ).toBe(true);
  });

  it("组装上下文 + intent：施工中含「线上」不进 E", () => {
    const ctx = buildJourneyLiveIncidentContext({
      releases: [{ state: "LIVE", target_id: "local", target_label: "本机" }],
      contracts: [{ lifecycle_state: "EXECUTING" }],
    });
    expect(ctx.hasInProgressContract).toBe(true);
    expect(ctx.liveTargetNames).toContain("本机");
    const intent = classifyJourneyIntent("线上标题字号调大一点", ctx);
    expect(intent.kind).not.toBe("LIVE_INCIDENT");
    expect(intent.kind).toBe("FAST_PATH");
  });

  it("组装上下文 + intent：无施工中 + 目标名命中 E", () => {
    const ctx = buildJourneyLiveIncidentContext({
      releases: [{ state: "LIVE", target_id: "local", target_label: "本机" }],
      contracts: [{ lifecycle_state: "MERGED" }],
    });
    expect(ctx.hasInProgressContract).toBe(false);
    const intent = classifyJourneyIntent("本机又挂了", ctx);
    expect(intent.kind).toBe("LIVE_INCIDENT");
  });
});
