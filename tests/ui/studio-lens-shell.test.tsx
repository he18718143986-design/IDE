// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanoramaPane } from "../../src/components/studio/PanoramaPane";
import { StudioLensShell } from "../../src/components/studio/StudioLensShell";
import { TaskGraphPane } from "../../src/components/studio/TaskGraphPane";
import {
  computeProgress,
  type TaskGraph,
  type TaskNode,
} from "../../src/lib/graph/task-graph";

function makeGraph(): TaskGraph {
  const nodes: TaskNode[] = [
    {
      node_id: "n1",
      title: "落实示例",
      kind: "CODE_MODIFICATION",
      depends_on: [],
      functional_area: "area",
      target_files: ["src/a.ts"],
      verification_mode: "COMMAND",
      verification_commands: ["test"],
      state: "PENDING",
      executed_at: null,
      commit_sha: null,
    },
  ];
  return {
    schema_version: "1.0.0",
    graph_id: "g1",
    contract_id: "c1",
    revision: 1,
    functional_tree: [{ id: "area", title: "示例功能", parent_id: null }],
    nodes,
    fingerprints: {},
    progress: computeProgress(nodes),
    issues: [],
    generated_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z",
  };
}

describe("StudioLensShell / PanoramaPane (TASK-C.10q)", () => {
  it("无图默认全景；可手动切到施工", () => {
    render(
      <StudioLensShell
        hasGraph={false}
        panorama={<div data-testid="pano-slot">全景内容</div>}
        construction={<div data-testid="build-slot">施工内容</div>}
      />,
    );
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "panorama",
    );
    expect(
      screen.getByTestId("studio-lens-panel-panorama"),
    ).not.toHaveAttribute("hidden");
    fireEvent.click(screen.getByTestId("studio-lens-tab-construction"));
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "construction",
    );
  });

  it("有图默认施工", () => {
    render(
      <StudioLensShell
        hasGraph
        panorama={<div>全景</div>}
        construction={<div data-testid="build-slot">施工</div>}
      />,
    );
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "construction",
    );
  });

  it("全景摘要可读合同；三张附录 C 投影壳空态；无施工绿灯节点", () => {
    render(
      <PanoramaPane
        summary={{
          contractTitle: "自举 CLI 版本",
          contractDescription: "统一读 package.json",
          acceptanceCriteria: ["version 子命令", "帮助抬头一致"],
          requirementsHint: "已写入 requirements",
          riskLevel: "low",
        }}
      />,
    );
    expect(screen.getByTestId("panorama-contract-title")).toHaveTextContent(
      "自举 CLI 版本",
    );
    expect(
      screen.getByTestId("panorama-acceptance-list").children,
    ).toHaveLength(2);
    const section = screen.getByTestId("panorama-v02-placeholders");
    expect(section).toHaveAttribute("data-forbid-illumination", "true");
    expect(section).toHaveAttribute("data-has-diagram", "false");
    for (const id of ["capability", "journey", "domain"] as const) {
      const card = screen.getByTestId(`panorama-card-${id}`);
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute("data-empty", "true");
      expect(card).toHaveAttribute("data-forbid-illumination", "true");
      expect(card).toHaveAttribute("data-has-diagram", "false");
      expect(card).toHaveAttribute("data-source", "ssot:none");
      expect(card).toHaveTextContent(/暂无投影数据（空态合法）/);
    }
    expect(screen.queryByTestId("functional-tree")).toBeNull();
    expect(screen.queryByTestId("execution-dag")).toBeNull();
    expect(screen.getByText(/不会出现施工绿灯/)).toBeInTheDocument();
  });

  it("有 SchemeDraftV2 时三卡挂确定性真图；空态/禁假绿仍成立", () => {
    render(
      <PanoramaPane
        schemeDraft={{
          scheme_id: "demo",
          scheme_revision: 1,
          frozen: false,
          title: "演示",
          summary: "",
          audience: null,
          size_hint: "tiny",
          goals: [],
          out_of_scope: [],
          modules: [
            {
              id: "M1",
              source: "user_said",
              evidence: [],
              user_pinned: false,
              updated_in_revision: 1,
              name: "能力甲",
              purpose: "演示",
              user_visible: true,
              kind: "new",
            },
          ],
          flows: [
            {
              id: "F1",
              source: "user_said",
              evidence: [],
              user_pinned: false,
              updated_in_revision: 1,
              name: "旅程甲",
              steps: [{ actor: "用户", action: "走" }],
            },
          ],
          entities: [
            {
              id: "E1",
              source: "user_said",
              evidence: [],
              user_pinned: false,
              updated_in_revision: 1,
              name: "概念甲",
              fields_hint: [],
            },
          ],
          decisions: [],
          conflicts: [],
          open_questions: [],
          acceptance: [],
        }}
      />,
    );
    expect(screen.getByTestId("panorama-card-capability")).toHaveAttribute(
      "data-empty",
      "false",
    );
    expect(screen.getByTestId("panorama-card-capability")).toHaveAttribute(
      "data-has-diagram",
      "true",
    );
    expect(screen.getByTestId("panorama-card-capability")).toHaveTextContent(
      "能力甲",
    );
    expect(
      screen.getByTestId("panorama-card-capability-diagram"),
    ).toHaveTextContent(/mindmap/);
    expect(
      screen.getByTestId("panorama-card-journey-diagram"),
    ).toHaveTextContent(/flowchart TB/);
    expect(
      screen.getByTestId("panorama-card-domain-diagram"),
    ).toHaveTextContent(/erDiagram/);
    expect(screen.getByTestId("panorama-card-journey")).toHaveTextContent(
      "旅程甲",
    );
    expect(screen.getByTestId("panorama-card-domain")).toHaveTextContent(
      "概念甲",
    );
    expect(
      screen.getByTestId("panorama-card-capability-source"),
    ).toHaveTextContent(/ssot:SchemeDraftV2\.modules/);
    const section = screen.getByTestId("panorama-v02-placeholders");
    expect(section).toHaveAttribute("data-forbid-illumination", "true");
    expect(section).toHaveAttribute("data-has-diagram", "true");
    for (const id of ["capability", "journey", "domain"] as const) {
      expect(screen.getByTestId(`panorama-card-${id}`)).toHaveAttribute(
        "data-forbid-illumination",
        "true",
      );
    }
  });

  it("TaskGraphPane：无图进全景；施工侧改名为本轮施工·功能汇总", () => {
    const { rerender } = render(
      <TaskGraphPane
        graph={null}
        panoramaSummary={{ contractTitle: "演示合同" }}
      />,
    );
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "panorama",
    );
    expect(screen.getByTestId("panorama-contract-title")).toHaveTextContent(
      "演示合同",
    );

    rerender(<TaskGraphPane graph={makeGraph()} />);
    expect(screen.getByTestId("studio-lens-shell")).toHaveAttribute(
      "data-active-lens",
      "construction",
    );
    expect(screen.getByTestId("graph-view-functional")).toHaveTextContent(
      "本轮施工·功能汇总",
    );
  });
});
