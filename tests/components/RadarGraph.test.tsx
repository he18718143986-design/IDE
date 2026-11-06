// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const animate = vi.fn();
const destroy = vi.fn();
const selectNode = vi.fn();
const unselectAll = vi.fn();
const on = vi.fn();
const off = vi.fn();
const batch = vi.fn((fn: () => void) => fn());
const layout = vi.fn(() => ({ run: vi.fn() }));
const add = vi.fn();
const remove = vi.fn();
const addClass = vi.fn();
const removeClass = vi.fn();

vi.mock("cytoscape", () => ({
  default: vi.fn(() => ({
    on,
    off,
    animate,
    destroy,
    batch,
    layout,
    add,
    remove,
    nodes: () => ({
      unselect: unselectAll,
      forEach: (
        fn: (n: {
          id: () => string;
          selected: () => boolean;
          select: () => void;
          unselect: () => void;
          data: () => void;
          removeClass: () => void;
          addClass: () => void;
        }) => void,
      ) => {
        fn({
          id: () => "src/a.ts",
          selected: () => false,
          select: selectNode,
          unselect: unselectAll,
          data: vi.fn(),
          removeClass,
          addClass,
        });
      },
    }),
    $: () => ({
      map: (fn: (n: { id: () => string }) => unknown) => [
        fn({ id: () => "a" }),
      ],
    }),
    getElementById: (id: string) => ({
      nonempty: () => id === "src/a.ts",
      select: selectNode,
      data: vi.fn(),
    }),
  })),
}));

const { RadarGraph } = await import("../../src/components/radar/RadarGraph");
const { FilterToolbar } =
  await import("../../src/components/radar/FilterToolbar");
const { ScopeSelector } =
  await import("../../src/components/radar/ScopeSelector");

const nodes = [
  { filePath: "src/a.ts", exports: ["a"] },
  { filePath: "src/b.ts", exports: ["b"] },
];
const edges = [{ from: "src/a.ts", to: "src/b.ts" }];

describe("M7 / TASK-C.2 架构雷达组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("挂载 Cytoscape 容器", () => {
    render(
      <RadarGraph
        nodes={nodes}
        edges={edges}
        cycles={[]}
        selected={[]}
        onSelectionChange={() => {}}
        focusPath="src/a.ts"
      />,
    );
    expect(screen.getByTestId("radar-graph")).toBeInTheDocument();
    expect(animate).toHaveBeenCalled();
  });

  it("选中态同步到画布", () => {
    render(
      <RadarGraph
        nodes={nodes}
        edges={edges}
        cycles={[]}
        selected={["src/a.ts"]}
        onSelectionChange={() => {}}
      />,
    );
    expect(batch).toHaveBeenCalled();
  });

  it("局部状态更新不调用 cy.destroy()，仅在卸载时调用一次", () => {
    const { rerender, unmount } = render(
      <RadarGraph
        nodes={nodes}
        edges={edges}
        cycles={[]}
        selected={[]}
        onSelectionChange={() => {}}
      />,
    );

    expect(destroy).toHaveBeenCalledTimes(0);

    // 局部状态更新：更新节点与边
    rerender(
      <RadarGraph
        nodes={[...nodes, { filePath: "src/c.ts", exports: ["c"] }]}
        edges={edges}
        cycles={[]}
        selected={[]}
        onSelectionChange={() => {}}
      />,
    );

    // FAIL 红线验证：局部状态更新绝不调用 destroy
    expect(destroy).toHaveBeenCalledTimes(0);

    // 卸载组件：仅在此时调用唯一一次 destroy
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("过滤器展示统计并触发搜索与环路开关", () => {
    const onQueryChange = vi.fn();
    const onToggleCycles = vi.fn();
    render(
      <FilterToolbar
        query=""
        onQueryChange={onQueryChange}
        showCycles={false}
        onToggleCycles={onToggleCycles}
        nodeCount={1000}
        edgeCount={2000}
        selectedCount={3}
        matches={0}
      />,
    );
    expect(screen.getByText("1000 节点 / 2000 边")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索文件"), {
      target: { value: "graph" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("graph");

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleCycles).toHaveBeenCalledWith(true);
  });

  it("ScopeSelector 导出选中路径", () => {
    const onApply = vi.fn();
    const onClear = vi.fn();
    render(
      <ScopeSelector
        selected={["src/a.ts", "src/b.ts"]}
        onApply={onApply}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "设为可写范围" }));
    expect(onApply).toHaveBeenCalledWith(["src/a.ts", "src/b.ts"]);
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(onClear).toHaveBeenCalled();
  });

  // C4-P6：新鲜度着色必须真的落到节点 class 上，而不只是「被调用过」
  it("新鲜度着色：STALE / CHANGED 落到节点 class，切回后清掉旧类", () => {
    const { rerender } = render(
      <RadarGraph
        nodes={nodes}
        edges={edges}
        cycles={[]}
        selected={[]}
        onSelectionChange={() => {}}
        freshnessMap={{ "src/a.ts": "STALE" }}
      />,
    );
    expect(removeClass).toHaveBeenCalledWith("fresh stale changed");
    expect(addClass).toHaveBeenCalledWith("stale");
    expect(addClass).not.toHaveBeenCalledWith("fresh");

    addClass.mockClear();
    rerender(
      <RadarGraph
        nodes={nodes}
        edges={edges}
        cycles={[]}
        selected={[]}
        onSelectionChange={() => {}}
        freshnessMap={{ "src/a.ts": "CHANGED" }}
      />,
    );
    expect(addClass).toHaveBeenCalledWith("changed");
    expect(addClass).not.toHaveBeenCalledWith("stale");
  });

  // C4-P7：圈选抽屉按合同状态分流——草稿原地更新，已批准强制派生新 Revision
  it("圈选抽屉：已批准合同强制派生 Revision 并重新审批", () => {
    const onApplyScope = vi.fn();
    const contract = {
      id: "c1",
      title: "示例",
      description: "",
      state: "APPROVED",
      approval: "APPROVED",
      acceptance: [],
      writable: [],
      forbidden: [],
      commands: [],
      rationale: [],
      unresolved: [],
      revision: 2,
    };
    render(
      <ScopeSelector
        selected={["src/a.ts"]}
        onApply={() => {}}
        onClear={() => {}}
        contract={contract}
        edges={edges}
        onApplyScope={onApplyScope}
        drawerOpen
      />,
    );
    expect(screen.getByTestId("scope-governance-alert")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "派生新 Revision 并重新审批" }),
    );
    expect(onApplyScope).toHaveBeenCalledWith(["src/a.ts"], "derive_revision");
  });

  it("圈选抽屉：草稿合同原地更新 Scope", () => {
    const onApplyScope = vi.fn();
    const contract = {
      id: "c2",
      title: "草稿",
      description: "",
      state: "DRAFT",
      approval: "PENDING",
      acceptance: [],
      writable: [],
      forbidden: [],
      commands: [],
      rationale: [],
      unresolved: [],
      revision: 1,
    };
    render(
      <ScopeSelector
        selected={["src/a.ts"]}
        onApply={() => {}}
        onClear={() => {}}
        contract={contract}
        onApplyScope={onApplyScope}
        drawerOpen
      />,
    );
    expect(screen.getByTestId("scope-governance-info")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认应用 Scope" }));
    expect(onApplyScope).toHaveBeenCalledWith(["src/a.ts"], "draft");
  });
});
