// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DisputeConsolePane,
  type DisputeReportView,
  type DisputeSealView,
} from "../../src/components/studio/DisputeConsolePane";

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const QUOTE = "记住我要勾上";

const SEALED: DisputeSealView = {
  status: "SEALED",
  bound_snapshot: true,
  confirmed_at: "2026-11-13T05:10:58.197Z",
  frozen_quotes_count: 1,
  quotes: [{ turn_id: "T1", text: QUOTE, turn_text_sha256: sha256Utf8(QUOTE) }],
};

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
  it("有封存原话时逐句展示整句，每句带封存哈希，不展示聊天计数", () => {
    render(<DisputeConsolePane report={reportFixture({ seal: SEALED })} />);
    const left = screen.getByTestId("dispute-fact-prompt");
    expect(left).toHaveTextContent(`你当时说：「${QUOTE}」`);
    expect(left).not.toHaveTextContent("相关消息");
    expect(left).not.toHaveTextContent(/确认 \d+ 次/);

    const rows = screen.getAllByTestId("dispute-sealed-quote");
    expect(rows).toHaveLength(1);
    const text =
      screen.getByTestId("dispute-sealed-quote-text").textContent ?? "";
    expect(text).toBe(QUOTE);
    expect(sha256Utf8(text)).toBe(
      rows[0]?.getAttribute("data-turn-text-sha256"),
    );
    expect(screen.getByTestId("dispute-report-card")).toHaveAttribute(
      "data-seal-status",
      "SEALED",
    );
  });

  it("状态行取自快照：确认时间与封存原话条数", () => {
    render(<DisputeConsolePane report={reportFixture({ seal: SEALED })} />);
    expect(screen.getByTestId("dispute-confirmation-fact")).toHaveTextContent(
      /你在 \d+月\d+日 \d{2}:\d{2} 确认了这份方案，系统封存了你当时说的 1 句话/,
    );
  });

  it("左栏不再放「原始需求」这一行（它不是锚定证据）", () => {
    render(<DisputeConsolePane report={reportFixture({ seal: SEALED })} />);
    expect(screen.getByTestId("dispute-fact-prompt")).not.toHaveTextContent(
      "原始需求",
    );
    expect(screen.getByTestId("dispute-fact-prompt")).toHaveTextContent(
      "你当时说的",
    );
  });

  it("无封存段：写明系统没有封存且不显示已降级", () => {
    render(
      <DisputeConsolePane
        report={reportFixture({
          seal: {
            status: "NOT_SEALED",
            bound_snapshot: true,
            confirmed_at: "2026-11-13T05:10:58.197Z",
            frozen_quotes_count: null,
            quotes: [],
          },
          // 旧字段即使有值也不再渲染
          matched_quotes: ["不该出现的旧锚点"],
          confirmations: 0,
        })}
      />,
    );
    const left = screen.getByTestId("dispute-fact-prompt");
    expect(left).toHaveTextContent("系统没有封存你确认方案时的原话");
    expect(left).toHaveTextContent("这是系统记录缺失，不代表你没说过");
    expect(left).not.toHaveTextContent("不该出现的旧锚点");
    expect(left).not.toHaveTextContent(/确认 \d+ 次/);
    expect(screen.getByTestId("dispute-confirmation-fact")).toHaveTextContent(
      "但系统没有封存你当时说的话",
    );
    expect(screen.queryByTestId("dispute-degraded-badge")).toBeNull();
    expect(screen.getByTestId("dispute-seal-badge")).toHaveTextContent(
      "系统没有封存原话",
    );
    // 仍保留二选一出口，用户不会被卡住
    expect(screen.getByTestId("dispute-choose-bugfix")).toBeInTheDocument();
  });

  it("报告缺封存事实（旧 Daemon）按未封存处理，不抛错", () => {
    render(<DisputeConsolePane report={reportFixture()} />);
    expect(screen.getByTestId("dispute-report-card")).toHaveAttribute(
      "data-seal-status",
      "NOT_SEALED",
    );
    expect(screen.getByTestId("dispute-confirmation-fact")).toHaveTextContent(
      "没有找到这份合同绑定的确认记录",
    );
    expect(screen.queryByTestId("dispute-degraded-badge")).toBeNull();
  });

  it("封存段校验不通过：不展示任何原话", () => {
    render(
      <DisputeConsolePane
        report={reportFixture({
          seal: {
            status: "TAMPERED",
            bound_snapshot: false,
            confirmed_at: null,
            frozen_quotes_count: null,
            quotes: [],
          },
        })}
      />,
    );
    expect(screen.queryAllByTestId("dispute-sealed-quote")).toHaveLength(0);
    expect(screen.getByTestId("dispute-seal-missing")).toHaveTextContent(
      "确认记录校验没有通过，系统不展示原话",
    );
    expect(screen.getByTestId("dispute-seal-badge")).toHaveTextContent(
      "确认记录校验没有通过",
    );
  });

  it("原话已封存而归因拿不准时，才显示「已降级呈递事实」", () => {
    render(<DisputeConsolePane report={reportFixture({ seal: SEALED })} />);
    expect(screen.getByTestId("dispute-degraded-badge")).toHaveTextContent(
      "已降级呈递事实",
    );
    expect(screen.queryByTestId("dispute-seal-badge")).toBeNull();
  });

  it("分类与建议用白话句式，不出现内部分类词", () => {
    render(
      <DisputeConsolePane
        report={{
          ...reportFixture({ seal: SEALED }),
          classification: "IMPLEMENTATION_BUG",
          degraded: false,
          next_action: { kind: "REWORK" },
        }}
      />,
    );
    expect(screen.getByTestId("dispute-classification")).toHaveTextContent(
      "方案里写了这一条，是施工漏了",
    );
    expect(screen.getByTestId("dispute-next-action")).toHaveTextContent(
      "我安排在原范围内返工，不另算。",
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
    expect(container.textContent).not.toContain("实现缺陷");
    expect(container.textContent).not.toContain("需求有偏差");
    expect(container.textContent).not.toContain("建议开新需求");
    expect(container.textContent).not.toContain("confidence");
  });
});
