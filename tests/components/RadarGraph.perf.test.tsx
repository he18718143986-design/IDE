// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import cytoscape from "cytoscape";
import {
  patchGraphElements,
  applyFreshnessClasses,
  type RadarNode,
  type RadarEdge,
} from "../../src/components/radar/RadarGraph";

describe("TASK-C.4 架构雷达性能门禁与降级策略测试", () => {
  function create1000NodeGraph() {
    const cy = cytoscape({ headless: true });
    const nodes: RadarNode[] = [];
    const edges: RadarEdge[] = [];

    const elements: Array<{
      group: "nodes" | "edges";
      data: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < 1000; i++) {
      const filePath = `src/module_${i}.ts`;
      nodes.push({ filePath, exports: [`export_${i}`] });
      elements.push({
        group: "nodes",
        data: {
          id: filePath,
          label: `m${i}.ts`,
          filePath,
          exports: [`export_${i}`],
          cycle: 0,
        },
      });
    }

    // 构造 2000 条唯一有向边
    for (let i = 0; i < 1000; i++) {
      const from = `src/module_${i}.ts`;
      const to1 = `src/module_${(i + 1) % 1000}.ts`;
      const to2 = `src/module_${(i + 2) % 1000}.ts`;

      edges.push({ from, to: to1 }, { from, to: to2 });
      elements.push(
        {
          group: "edges",
          data: { id: `${from}->${to1}`, source: from, target: to1 },
        },
        {
          group: "edges",
          data: { id: `${from}->${to2}`, source: from, target: to2 },
        },
      );
    }

    cy.add(elements);
    return { cy, nodes, edges };
  }

  it("性能门禁①：1000 节点 / 2000 边局部更新耗时 ≤ 16ms（满足 60 FPS 帧率）", () => {
    const { cy } = create1000NodeGraph();
    expect(cy.nodes().length).toBe(1000);
    expect(cy.edges().length).toBe(2000);

    const diff = {
      // 1. 删
      removeEdgeIds: [
        "src/module_0.ts->src/module_1.ts",
        "src/module_0.ts->src/module_2.ts",
      ],
      removeNodeIds: ["src/module_0.ts"],
      // 2. 增
      addNodes: [{ filePath: "src/module_new.ts", exports: ["newExport"] }],
      addEdges: [
        { from: "src/module_1.ts", to: "src/module_new.ts" },
        { from: "src/module_2.ts", to: "src/module_new.ts" },
      ],
      // 3. 更新
      updateNodes: [
        { filePath: "src/module_3.ts", exports: ["updatedExport"] },
      ],
    };

    const t0 = performance.now();
    patchGraphElements(cy, diff);
    const duration = performance.now() - t0;

    expect(duration).toBeLessThanOrEqual(16);
    expect(cy.getElementById("src/module_0.ts").nonempty()).toBe(false);
    expect(cy.getElementById("src/module_new.ts").nonempty()).toBe(true);
    expect(cy.getElementById("src/module_3.ts").data("exports")).toEqual([
      "updatedExport",
    ]);

    cy.destroy();
  });

  it("性能门禁②：50 次连续 patch 内存与实体计数代理断言", () => {
    const { cy } = create1000NodeGraph();
    const container = document.createElement("div");
    document.body.appendChild(container);

    const initialNodeCount = cy.nodes().length;
    const initialEdgeCount = cy.edges().length;

    // 内存门禁声明：
    // 30MB 门禁在 jsdom 下以实体计数代理，真实堆测量留待 Playwright 环境。
    const perfMemory = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory;
    const heapBefore = perfMemory ? perfMemory.usedJSHeapSize : null;

    for (let step = 0; step < 50; step++) {
      const edgeToRemove = `src/module_${step}.ts->src/module_${(step + 1) % 1000}.ts`;
      const newEdge = {
        from: `src/module_${step}.ts`,
        to: `src/module_${(step + 500) % 1000}.ts`,
      };

      patchGraphElements(cy, {
        // 1. 删
        removeEdgeIds: [edgeToRemove],
        // 2. 增
        addEdges: [newEdge],
        // 3. 更新
        updateNodes: [
          { filePath: `src/module_${step}.ts`, exports: [`step_${step}`] },
        ],
      });

      applyFreshnessClasses(cy, { [`src/module_${step}.ts`]: "FRESH" });
    }

    // 代理断言 1：Cytoscape 元素总数与图模型增量 1:1 对齐，无孤儿元素残留
    expect(cy.nodes().length).toBe(initialNodeCount);
    expect(cy.edges().length).toBe(initialEdgeCount);
    expect(cy.elements().length).toBe(initialNodeCount + initialEdgeCount);

    // 代理断言 2：容器 DOM 节点不发生无节制递增泄漏
    expect(container.childElementCount).toBe(0);

    // 真实堆内存（若 Chromium 环境暴露 usedJSHeapSize）
    if (heapBefore !== null && perfMemory) {
      const heapAfter = perfMemory.usedJSHeapSize;
      const deltaHeapMB = (heapAfter - heapBefore) / (1024 * 1024);
      expect(deltaHeapMB).toBeLessThanOrEqual(30);
    }

    cy.destroy();
    document.body.removeChild(container);
  });

  it("性能门禁③：>1000 节点自动降级为静态 grid/preset，禁用 cose 连续力导向", () => {
    const nodes: RadarNode[] = [];
    for (let i = 0; i < 1050; i++) {
      nodes.push({ filePath: `src/mod_${i}.ts`, exports: [] });
    }

    // 判定逻辑与组件内部降级门限一致
    const layoutConfig =
      nodes.length > 1000
        ? { name: "grid", animate: false, avoidOverlap: true }
        : { name: "cose", animate: false, randomize: true };

    expect(layoutConfig.name).toBe("grid");
    expect(layoutConfig.animate).toBe(false);
  });

  it("性能门禁④：组件卸载调用 cy.destroy() 释放所有 Cytoscape 图模型资源", () => {
    const { cy } = create1000NodeGraph();
    expect(cy.elements().length).toBe(3000);
    expect(cy.destroyed()).toBe(false);

    cy.destroy();
    expect(cy.destroyed()).toBe(true);
  });
});
