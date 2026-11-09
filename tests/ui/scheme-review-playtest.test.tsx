// @vitest-environment jsdom
/**
 * TASK-L.17c：中栏方案审阅页嵌入试玩认可 —— UI 验收。
 *
 * PASS 覆盖：
 *  - DOM 出现既有 compare-view（库内 CompareView，非重建）
 *  - 无原话 / 空白原话不可提交
 *  - 提交只走 submitPlaytestEvidence（body 仅 contract_id + user_verdict）
 *  - 读侧拒绝态反映到按钮/结果区
 *  - 不自动把引导文案填进原话框
 *  - 无多视口 Tab / 右栏入口复活
 *
 * TASK-L.17e 追加：
 *  - 有候选时 DOM 出现 playtest-verbatim-candidates；默认输入框仍空（L17E-P2）
 *  - 点引用后输入框值为候选原文（L17E-P3）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SchemeReviewPane } from "../../src/components/studio/SchemeReviewPane";
import { StudioViewportShell } from "../../src/components/studio/StudioViewportShell";
import {
  rebuildSchemeFromCorpus,
  resolveSchemeConflict,
  confirmSchemeDecision,
} from "../../src/lib/journey/scheme-draft";
import type { DaemonConnection } from "../../src/lib/daemon-api";
import * as playtestEvidence from "../../src/lib/journey/playtest-evidence";
import * as daemonApi from "../../src/lib/daemon-api";

function makeScheme() {
  let scheme = rebuildSchemeFromCorpus(
    null,
    "工程进度管控，财务数据匹配，进度预警，财务预算预警，月度报表。先跑通也要界面一次到位。",
  );
  for (const c of scheme.conflicts) {
    scheme = resolveSchemeConflict(scheme, c.id, c.options[0]!.id);
  }
  for (const d of scheme.decisions) {
    scheme = confirmSchemeDecision(scheme, d.id);
  }
  return scheme;
}

const CONN: DaemonConnection = {
  baseUrl: "http://127.0.0.1:3999",
  token: "test-token",
};

describe("TASK-L.17c 中栏试玩认可", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // SchemeReviewPane 挂载时会一并渲染系统地图（SystemMapPane），后者在 effect 里发起
    // 未桩的真实 daemon 请求 GET /api/knowledge/modules；试玩状态查询在部分用例中也未桩。
    // 这些请求在用例结束后仍未决，会跨过 jsdom 环境销毁，是挂账②（window is not defined）的来源。
    // 本文件只断言试玩认可，故在此统一桩掉两处挂载请求；个别用例仍可用 spyOn 覆盖。
    vi.spyOn(daemonApi, "fetchKnowledgeModules").mockResolvedValue({
      ok: false,
      modules: [],
      edges: [],
      message: "测试桩：本文件不断言系统地图",
    });
    vi.spyOn(playtestEvidence, "fetchPlaytestStatus").mockResolvedValue({
      ok: false,
      status: "UNCONFIRMED",
      code: "PLAYTEST_UNCONFIRMED",
      message: "还没有试玩认可证据",
      contract_id: "ctr-1",
      evidence_release_id: null,
      current_release_id: "rel-1",
      reset_approval: false,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("中栏方案审阅挂载既有 CompareView（data-testid=compare-view）", () => {
    render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{
          contractId: "ctr-1",
          references: ["https://ref.example.com/"],
          conn: CONN,
        }}
      />,
    );
    expect(screen.getByTestId("scheme-review-pane")).toBeTruthy();
    expect(screen.getByTestId("compare-view")).toBeTruthy();
    expect(screen.getByTestId("compare-view-left")).toBeTruthy();
    expect(screen.getByTestId("compare-view-right")).toBeTruthy();
    expect(screen.getByTestId("playtest-accept-block")).toBeTruthy();
    expect(screen.getByTestId("playtest-verbatim-input")).toHaveValue("");
  });

  it("原话框默认空；引导说明不会自动填入", () => {
    render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{ contractId: "ctr-1", conn: CONN }}
      />,
    );
    const input = screen.getByTestId(
      "playtest-verbatim-input",
    ) as HTMLTextAreaElement;
    expect(input.value).toBe("");
    // 说明区存在，但不得等于输入值
    expect(input.value).not.toContain("引导");
    expect(input.value).not.toContain("一模一样");
  });

  it("空原话时「认可完成」不可提交（按钮 disabled）", () => {
    const submitSpy = vi
      .spyOn(playtestEvidence, "submitPlaytestEvidence")
      .mockResolvedValue({
        ok: true,
        evidence: {
          schema_version: "1.0.0",
          contract_id: "ctr-1",
          release_id: "rel-1",
          user_verdict: "x",
          operator: "user",
          timestamp: "2026-11-03T00:00:00.000Z",
        },
      });
    vi.spyOn(playtestEvidence, "fetchPlaytestStatus").mockResolvedValue({
      ok: false,
      status: "UNCONFIRMED",
      code: "PLAYTEST_UNCONFIRMED",
      message: "还没有试玩认可证据",
      contract_id: "ctr-1",
      evidence_release_id: null,
      current_release_id: "rel-1",
      reset_approval: false,
    });

    render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{ contractId: "ctr-1", conn: CONN }}
      />,
    );
    const btn = screen.getByTestId("playtest-accept-submit");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(submitSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("playtest-verbatim-input"), {
      target: { value: "   " },
    });
    expect(screen.getByTestId("playtest-accept-submit")).toBeDisabled();
  });

  it("有效原话提交只走 submitPlaytestEvidence（contract_id + user_verdict）", async () => {
    const verdict = "我对照参考站点了一遍，一模一样，认可完成";
    const submitSpy = vi
      .spyOn(playtestEvidence, "submitPlaytestEvidence")
      .mockResolvedValue({
        ok: true,
        evidence: {
          schema_version: "1.0.0",
          contract_id: "ctr-1",
          release_id: "rel-1",
          user_verdict: verdict,
          operator: "user",
          timestamp: "2026-11-03T00:00:00.000Z",
        },
      });
    vi.spyOn(playtestEvidence, "fetchPlaytestStatus").mockResolvedValue({
      ok: false,
      status: "UNCONFIRMED",
      code: "PLAYTEST_UNCONFIRMED",
      message: "还没有试玩认可证据",
      contract_id: "ctr-1",
      evidence_release_id: null,
      current_release_id: "rel-1",
      reset_approval: false,
    });

    render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{ contractId: "ctr-1", conn: CONN }}
      />,
    );
    fireEvent.change(screen.getByTestId("playtest-verbatim-input"), {
      target: { value: verdict },
    });
    const btn = screen.getByTestId("playtest-accept-submit");
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    expect(submitSpy.mock.calls[0]![0]).toEqual(CONN);
    expect(submitSpy.mock.calls[0]![1]).toEqual({
      contract_id: "ctr-1",
      user_verdict: verdict,
    });
    // 请求体不得夹带服务端装配字段
    const body = submitSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("release_id");
    expect(body).not.toHaveProperty("timestamp");
    expect(body).not.toHaveProperty("operator");

    await waitFor(() =>
      expect(screen.getByTestId("playtest-accept-success")).toBeTruthy(),
    );
  });

  it("读侧 STALE_VERSION / NOT_NORTHSTAR 反映到状态区；后者禁用提交", async () => {
    const fetchSpy = vi
      .spyOn(playtestEvidence, "fetchPlaytestStatus")
      .mockResolvedValue({
        ok: false,
        status: "STALE_VERSION",
        code: "STALE_VERSION",
        message: "LIVE 版本已变更，请重新试玩确认",
        contract_id: "ctr-1",
        evidence_release_id: "rel-old",
        current_release_id: "rel-new",
        reset_approval: true,
      });

    const { rerender } = render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{ contractId: "ctr-1", conn: CONN }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("playtest-guard-status")).toHaveAttribute(
        "data-status",
        "STALE_VERSION",
      ),
    );
    expect(screen.getByTestId("playtest-guard-status").textContent).toContain(
      "STALE_VERSION",
    );
    // STALE 仍允许重新提交（有原话时）
    fireEvent.change(screen.getByTestId("playtest-verbatim-input"), {
      target: { value: "重新认可" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("playtest-accept-submit")).not.toBeDisabled(),
    );

    fetchSpy.mockResolvedValue({
      ok: false,
      status: "NOT_NORTHSTAR_SCENARIO",
      code: "NOT_NORTHSTAR_SCENARIO",
      message: "该合同没有 references[]",
      contract_id: "ctr-1",
      evidence_release_id: null,
      current_release_id: null,
      reset_approval: false,
    });
    rerender(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{ contractId: "ctr-1-b", conn: CONN }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("playtest-guard-status")).toHaveAttribute(
        "data-status",
        "NOT_NORTHSTAR_SCENARIO",
      ),
    );
    expect(screen.getByTestId("playtest-accept-submit")).toBeDisabled();
  });

  it("候选可见且默认空（L17E-P2）", () => {
    const raw = "用户原话：一模一样，可以上线";
    render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{
          contractId: "ctr-1",
          conn: CONN,
          sessionVerbatimCandidates: [raw, "另一句用户原话"],
        }}
      />,
    );
    expect(screen.getByTestId("playtest-verbatim-candidates")).toBeTruthy();
    expect(screen.getAllByTestId("playtest-verbatim-cite")).toHaveLength(2);
    const input = screen.getByTestId(
      "playtest-verbatim-input",
    ) as HTMLTextAreaElement;
    expect(input.value).toBe("");
    expect(input.value).not.toContain(raw);
  });

  it("引用写入原文（L17E-P3）", () => {
    const raw = "用户原话：一模一样，可以上线";
    render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{
          contractId: "ctr-1",
          conn: CONN,
          sessionVerbatimCandidates: [raw],
        }}
      />,
    );
    expect(screen.getByTestId("playtest-verbatim-input")).toHaveValue("");
    fireEvent.click(screen.getByTestId("playtest-verbatim-cite"));
    expect(screen.getByTestId("playtest-verbatim-input")).toHaveValue(raw);
  });

  it("L17D-P3: snapshots 传入后左栏出现 compare-view-reference，不再仅空左栏", () => {
    render(
      <SchemeReviewPane
        scheme={makeScheme()}
        playtest={{
          contractId: "ctr-1",
          references: ["https://ref.example.com/"],
          snapshots: [
            {
              reference_url: "https://ref.example.com/",
              html_snapshot: "<html><title>Ref</title></html>",
              dom_summary: "标题：Ref",
              screenshot_url: null,
            },
          ],
          conn: CONN,
        }}
      />,
    );
    expect(screen.getByTestId("compare-view")).toBeTruthy();
    expect(screen.getByTestId("compare-view-reference")).toBeTruthy();
    expect(screen.getByTestId("compare-view-reference-link")).toHaveAttribute(
      "href",
      "https://ref.example.com/",
    );
    expect(
      screen.getByTestId("compare-view-dom-summary").textContent,
    ).toContain("Ref");
    expect(screen.queryByTestId("compare-view-left-empty")).toBeNull();
  });

  it("静态：Studio 外壳仍无多视口 Tab（W.5a）", () => {
    render(
      <StudioViewportShell
        contractRail={<div>需求</div>}
        scheme={
          <SchemeReviewPane
            scheme={makeScheme()}
            playtest={{ contractId: "ctr-1", conn: CONN }}
          />
        }
      />,
    );
    expect(screen.queryByTestId("studio-viewport-tabs")).toBeNull();
    expect(screen.queryByRole("tab", { name: "真机试玩" })).toBeNull();
    expect(screen.getByTestId("compare-view")).toBeTruthy();
  });
});
