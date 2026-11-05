import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";

export interface RadarNode {
  filePath: string;
  exports: string[];
}

export interface RadarEdge {
  from: string;
  to: string;
}

export type FreshnessStatus = "FRESH" | "STALE" | "CHANGED";

export interface GraphElementsDiff {
  removeNodeIds?: string[];
  removeEdgeIds?: string[];
  addNodes?: RadarNode[];
  addEdges?: RadarEdge[];
  updateNodes?: Array<{ filePath: string; exports?: string[] }>;
}

export interface RadarGraphProps {
  nodes: RadarNode[];
  edges: RadarEdge[];
  cycles: string[][];
  selected: string[];
  onSelectionChange: (paths: string[]) => void;
  focusPath?: string | undefined;
  showCycles?: boolean;
  freshnessMap?:
    Map<string, FreshnessStatus> | Record<string, FreshnessStatus> | undefined;
  className?: string;
  /** 支持无头渲染（门禁基准与测试使用） */
  headless?: boolean;
}

const cycleNodeIds = (cycles: string[][], showCycles: boolean): Set<string> => {
  if (!showCycles) return new Set();
  const ids = new Set<string>();
  for (const cycle of cycles) for (const id of cycle) ids.add(id);
  return ids;
};

/**
 * 局部增量 Patch 核心函数（严格按 删→增→更新 顺序在单次 cy.batch() 内执行）。
 * 杜绝全量重建，保证局部更新 ≤16ms。
 */
export function patchGraphElements(cy: Core, diff: GraphElementsDiff): void {
  cy.batch(() => {
    // 1. 删 (先删边，再删节点)
    if (diff.removeEdgeIds && diff.removeEdgeIds.length > 0) {
      for (const id of diff.removeEdgeIds) {
        const ele = cy.getElementById(id);
        if (ele.nonempty()) {
          cy.remove(ele);
        }
      }
    }
    if (diff.removeNodeIds && diff.removeNodeIds.length > 0) {
      for (const id of diff.removeNodeIds) {
        const ele = cy.getElementById(id);
        if (ele.nonempty()) {
          cy.remove(ele);
        }
      }
    }

    // 2. 增 (先增节点，再增边)
    if (diff.addNodes && diff.addNodes.length > 0) {
      const nodeElements = diff.addNodes.map((node) => ({
        group: "nodes" as const,
        data: {
          id: node.filePath,
          label: node.filePath.split("/").pop() ?? node.filePath,
          filePath: node.filePath,
          exports: node.exports ?? [],
          cycle: 0,
        },
      }));
      cy.add(nodeElements);
    }
    if (diff.addEdges && diff.addEdges.length > 0) {
      const edgeElements = diff.addEdges
        .filter(
          (edge) =>
            cy.getElementById(edge.from).nonempty() &&
            cy.getElementById(edge.to).nonempty(),
        )
        .map((edge) => ({
          group: "edges" as const,
          data: {
            id: `${edge.from}->${edge.to}`,
            source: edge.from,
            target: edge.to,
          },
        }));
      cy.add(edgeElements);
    }

    // 3. 更新 (更新节点属性/数据)
    if (diff.updateNodes && diff.updateNodes.length > 0) {
      for (const update of diff.updateNodes) {
        const ele = cy.getElementById(update.filePath);
        if (ele.nonempty()) {
          if (update.exports !== undefined) {
            ele.data("exports", update.exports);
          }
        }
      }
    }
  });
}

/**
 * 局部批量应用新鲜度着色类名（在单次 cy.batch() 内执行）
 */
export function applyFreshnessClasses(
  cy: Core,
  freshnessMap:
    Map<string, FreshnessStatus> | Record<string, FreshnessStatus> | undefined,
): void {
  if (!freshnessMap) return;

  const getStatus = (id: string): FreshnessStatus | undefined => {
    if (freshnessMap instanceof Map) return freshnessMap.get(id);
    return freshnessMap[id];
  };

  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const status = getStatus(node.id());
      node.removeClass("fresh stale changed");
      if (status === "FRESH") {
        node.addClass("fresh");
      } else if (status === "STALE") {
        node.addClass("stale");
      } else if (status === "CHANGED") {
        node.addClass("changed");
      }
    });
  });
}

/**
 * 局部批量更新环路高亮标记（在单次 cy.batch() 内执行）
 */
export function updateCycleHighlight(
  cy: Core,
  cycles: string[][],
  showCycles: boolean,
): void {
  const highlighted = cycleNodeIds(cycles, showCycles);
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const isCycle = highlighted.has(node.id());
      node.data("cycle", isCycle ? 1 : 0);
    });
  });
}

/**
 * TASK-C.4 架构雷达画布组件：
 * - 持久 Cytoscape 实例，仅在 unmount 时调用 cy.destroy()；
 * - 拓扑变化/新鲜度/环路/选中态均走 cy.batch() 增量 patch；
 * - 超过 1000 节点自动降级为静态 grid/preset，禁用动态 cose 力导向动效。
 */
export function RadarGraph({
  nodes,
  edges,
  cycles,
  selected,
  onSelectionChange,
  focusPath,
  showCycles = false,
  freshnessMap,
  className,
  headless = false,
}: RadarGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const prevNodesRef = useRef<Map<string, RadarNode>>(new Map());
  const prevEdgesRef = useRef<Set<string>>(new Set());

  // 1. 初始化持久 Cytoscape 实例（仅在挂载时运行一次；仅在卸载时 destroy）
  useEffect(() => {
    if (!containerRef.current && !headless) return;

    const highlighted = cycleNodeIds(cycles, showCycles);
    const initialElements = [
      ...nodes.map((node) => ({
        group: "nodes" as const,
        data: {
          id: node.filePath,
          label: node.filePath.split("/").pop() ?? node.filePath,
          filePath: node.filePath,
          exports: node.exports ?? [],
          cycle: highlighted.has(node.filePath) ? 1 : 0,
        },
      })),
      ...edges
        .filter(
          (edge) =>
            nodes.some((n) => n.filePath === edge.from) &&
            nodes.some((n) => n.filePath === edge.to),
        )
        .map((edge) => ({
          group: "edges" as const,
          data: {
            id: `${edge.from}->${edge.to}`,
            source: edge.from,
            target: edge.to,
          },
        })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      headless: Boolean(headless),
      elements: initialElements,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-size": 8,
            color: "#94a3b8",
            "background-color": "#475569",
            width: 14,
            height: 14,
          },
        },
        {
          selector: "node[cycle = 1]",
          style: { "background-color": "#ef4444", color: "#fecaca" },
        },
        {
          selector: "node:selected",
          style: { "background-color": "#22c55e", color: "#dcfce7" },
        },
        {
          selector: "node.stale",
          style: { "background-color": "#64748b", color: "#94a3b8" },
        },
        {
          selector: "node.fresh",
          style: { "background-color": "#16a34a", color: "#bbf7d0" },
        },
        {
          selector: "node.changed",
          style: { "background-color": "#f59e0b", color: "#fef3c7" },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#334155",
            "target-arrow-color": "#334155",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "arrow-scale": 0.6,
          },
        },
      ],
      layout:
        nodes.length > 1000
          ? { name: "grid", animate: false, avoidOverlap: true }
          : nodes.length > 600
            ? { name: "grid", animate: false, avoidOverlap: true }
            : { name: "cose", animate: false, randomize: true },
    });

    const handleSelectChange = () => {
      onSelectionChangeRef.current(
        cy.$("node:selected").map((n) => n.id() as string),
      );
    };

    cy.on("select unselect", "node", handleSelectChange);
    cyRef.current = cy;
    prevNodesRef.current = new Map(nodes.map((n) => [n.filePath, n]));
    prevEdgesRef.current = new Set(edges.map((e) => `${e.from}->${e.to}`));

    if (freshnessMap) {
      applyFreshnessClasses(cy, freshnessMap);
    }

    return () => {
      // 性能门禁④：仅在此唯一卸载点调用 cy.destroy()
      cy.off("select unselect", "node", handleSelectChange);
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. 拓扑局部 Patch：元素级 diff，按 删→增→更新 顺序在 cy.batch() 内执行
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const prevNodes = prevNodesRef.current;
    const prevEdges = prevEdgesRef.current;

    const currNodeMap = new Map(nodes.map((n) => [n.filePath, n]));
    const currEdgeSet = new Set(edges.map((e) => `${e.from}->${e.to}`));

    const removeNodeIds: string[] = [];
    const addNodes: RadarNode[] = [];
    const updateNodes: Array<{ filePath: string; exports?: string[] }> = [];

    for (const [id, prevNode] of prevNodes.entries()) {
      const curr = currNodeMap.get(id);
      if (!curr) {
        removeNodeIds.push(id);
      } else if (
        curr.exports.length !== prevNode.exports.length ||
        curr.exports.some((exp, idx) => exp !== prevNode.exports[idx])
      ) {
        updateNodes.push({ filePath: curr.filePath, exports: curr.exports });
      }
    }

    for (const [id, currNode] of currNodeMap.entries()) {
      if (!prevNodes.has(id)) {
        addNodes.push(currNode);
      }
    }

    const removeEdgeIds: string[] = [];
    const addEdges: RadarEdge[] = [];

    for (const edgeId of prevEdges) {
      if (!currEdgeSet.has(edgeId)) {
        removeEdgeIds.push(edgeId);
      }
    }

    for (const edge of edges) {
      const edgeId = `${edge.from}->${edge.to}`;
      if (!prevEdges.has(edgeId)) {
        addEdges.push(edge);
      }
    }

    if (
      removeNodeIds.length > 0 ||
      removeEdgeIds.length > 0 ||
      addNodes.length > 0 ||
      addEdges.length > 0 ||
      updateNodes.length > 0
    ) {
      patchGraphElements(cy, {
        removeNodeIds,
        removeEdgeIds,
        addNodes,
        addEdges,
        updateNodes,
      });

      // 降级布局判断：新增节点若超过 1000 切静态布局
      if (addNodes.length > 0) {
        if (nodes.length > 1000) {
          cy.layout({ name: "grid", animate: false, avoidOverlap: true }).run();
        } else if (nodes.length > 600) {
          cy.layout({ name: "grid", animate: false, avoidOverlap: true }).run();
        }
      }
    }

    prevNodesRef.current = currNodeMap;
    prevEdgesRef.current = currEdgeSet;
  }, [nodes, edges]);

  // 3. 环路高亮局部更新
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    updateCycleHighlight(cy, cycles, showCycles);
  }, [cycles, showCycles]);

  // 4. 新鲜度着色局部更新
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !freshnessMap) return;
    applyFreshnessClasses(cy, freshnessMap);
  }, [freshnessMap]);

  // 5. 选中态同步（使用 cy.batch() 局部更新）
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const selectedSet = new Set(selected);
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const id = node.id();
        const shouldSelect = selectedSet.has(id);
        if (node.selected() !== shouldSelect) {
          if (shouldSelect) node.select();
          else node.unselect();
        }
      });
    });
  }, [selected]);

  // 6. 搜索定位动画
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !focusPath) return;
    const node = cy.getElementById(focusPath);
    if (node.nonempty()) {
      cy.animate({ center: { eles: node }, zoom: 1.4 }, { duration: 200 });
    }
  }, [focusPath]);

  return (
    <div
      ref={containerRef}
      data-testid="radar-graph"
      className={className ?? "h-full w-full"}
      aria-label="架构依赖图"
    />
  );
}
