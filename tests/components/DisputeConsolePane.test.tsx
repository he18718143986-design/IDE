// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DisputeConsolePane,
  type DisputeReportView,
} from "../../src/components/studio/DisputeConsolePane";

function reportFixture(
  overrides: Partial<DisputeReportView["facts"]["prompt"]> = {},
  classification: DisputeReportView["classification"] = "UNATTRIBUTED",
): DisputeReportView {
  return {
    report_id: "r1",
    contract_id: "c1",
    challenge: "按钮不对",
    classification,
    confidence: 0.4,
    degraded: true,
    plain_summary: "我还不能确定是哪一边的问题。",
    facts: {
      prompt: {
        original_request: "做一个登录页",
        matched_quotes: [],
        confirmations: 1,
        ...overrides,
      },
      spec: { matched_entries: ["登录页需要记住我"] },
      code: {
        worktree_available: true,
        changed_files: ["src/login.tsx"],
        evidence_id: null,
      },
    },
    next_action: { kind: "MANUAL_ARBITRATION" },
  };
}

describe("TASK-J.16 · 左栏「你当时说的」与 §16.7 文案", () => {
  it("有锚定原话时逐条展示原话，不展示计数", () => {
    render(
      <DisputeConsolePane
        report={reportFixture({ matched_quotes: ["记住我要勾上"] })}
      />,
    );
    const left = screen.getByTestId("dispute-fact-prompt");
    expect(left).toHaveTextContent("你当时说：「记住我要勾上」");
    expect(left).not.toHaveTextContent("相关消息");
  });

  it("没有对应原话时给一句白话说明，而不是空白", () => {
    render(<DisputeConsolePane report={reportFixture()} />);
    expect(screen.getByTestId("dispute-fact-prompt")).toHaveTextContent(
      "没有找到与这次确认的方案对应的你的原话记录",
    );
  });

  it("裁决按钮使用 §16.7 文案，且不出现技术分类词或把握度", () => {
    const { container } = render(
      <DisputeConsolePane report={reportFixture()} />,
    );
    expect(screen.getByTestId("dispute-choose-bugfix")).toHaveTextContent(
      "这是 Bug，免费修",
    );
    expect(screen.getByTestId("dispute-choose-requirement")).toHaveTextContent(
      "我想要新功能，下一轮做",
    );
    expect(container.textContent).not.toContain("按缺陷修复");
    expect(container.textContent).not.toContain("按新需求演进");
    expect(container.textContent).not.toContain("把握");
  });
});
