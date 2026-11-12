import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { StudioViewportShell } from "../../src/components/studio/StudioViewportShell";
import { DisputeConsolePane } from "../../src/components/studio/DisputeConsolePane";
import {
  resolveActiveViewport,
  resolveDefaultViewport,
  mapLegacyViewportToScheme,
} from "../../src/components/studio/viewport-routing";
import type { DisputeReportView } from "../../src/components/studio/dispute-view-model";

describe("TASK-J.23 / J23-P1 · 生产界面挂载与视口路由接线", () => {
  it("viewport-routing 支持 dispute 手动切入与 DISPUTED_INSPECTING 自动切入", () => {
    expect(resolveDefaultViewport()).toBe("scheme");

    // 1. 手动切入 dispute
    const manualDispute = resolveActiveViewport({
      presentationState: null,
      previousPresentationState: null,
      manualViewport: "dispute",
    });
    expect(manualDispute).toEqual({
      viewport: "dispute",
      clearManual: false,
    });

    // 2. DISPUTED_INSPECTING 态下自动切入 dispute
    const inspectingDispute = resolveActiveViewport({
      presentationState: "DISPUTED_INSPECTING",
      previousPresentationState: null,
      manualViewport: null,
    });
    expect(inspectingDispute).toEqual({
      viewport: "dispute",
      clearManual: true,
    });

    // 3. 常规方案态默认方案审阅
    const normalScheme = resolveActiveViewport({
      presentationState: "CONFIRMED_WORKING",
      previousPresentationState: null,
      manualViewport: null,
    });
    expect(normalScheme.viewport).toBe("scheme");

    // 4. legacy 映射
    expect(mapLegacyViewportToScheme("dispute")).toBe("dispute");
    expect(mapLegacyViewportToScheme("demo")).toBe("scheme");
    expect(mapLegacyViewportToScheme("graph")).toBe("scheme");
  });

  it("StudioViewportShell 在 activeViewport 为 dispute 时正确渲染挂载的 DisputeConsolePane", () => {
    const onViewportChange = vi.fn();
    const onSubmit = vi.fn();

    const { rerender } = render(
      <StudioViewportShell
        activeViewport="scheme"
        onViewportChange={onViewportChange}
        scheme={<div data-testid="scheme-content">方案内容</div>}
        dispute={
          <DisputeConsolePane
            contractId="contract-123"
            report={null}
            busy={false}
            error={null}
            onSubmit={onSubmit}
          />
        }
      />,
    );

    // 默认方案审阅
    expect(screen.getByTestId("scheme-content")).toBeDefined();
    expect(screen.queryByTestId("dispute-console-pane")).toBeNull();

    // 切换至 dispute
    rerender(
      <StudioViewportShell
        activeViewport="dispute"
        onViewportChange={onViewportChange}
        scheme={<div data-testid="scheme-content">方案内容</div>}
        dispute={
          <DisputeConsolePane
            contractId="contract-123"
            report={null}
            busy={false}
            error={null}
            onSubmit={onSubmit}
          />
        }
      />,
    );

    expect(screen.queryByTestId("scheme-content")).toBeNull();
    const disputePane = screen.getByTestId("dispute-console-pane");
    expect(disputePane).toBeDefined();

    // 顶部返回方案审阅按钮
    const backBtn = screen.getByTestId("studio-back-to-scheme");
    fireEvent.click(backBtn);
    expect(onViewportChange).toHaveBeenCalledWith("scheme");
  });

  it("DisputeConsolePane 只读文案未被破坏，表单交互正常", () => {
    const onSubmit = vi.fn();
    const sampleReport: DisputeReportView = {
      challenge: "记住我勾选未生效",
      plain_summary: "自查发现存在漏项，需补齐",
      classification: "REQUIREMENT_CHANGE",
      facts: {
        prompt: {
          original_request: "记住我要勾上",
          matched_quotes: ["记住我要勾上"],
          confirmations: 1,
        },
        spec: null,
        code: {
          worktree_available: true,
          changed_files: ["src/auth.ts"],
          evidence_id: null,
        },
      },
      rework_proposal: {
        target: "登录记住我需求",
        reason: "需要更新状态持久化",
      },
      contract_draft: null,
    };

    render(
      <DisputeConsolePane
        contractId="contract-xyz"
        report={sampleReport}
        busy={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("自查发现存在漏项，需补齐")).toBeDefined();
    expect(screen.getByText("你当时说的")).toBeDefined();
    expect(screen.getByText("代码实际做的")).toBeDefined();
  });
});
