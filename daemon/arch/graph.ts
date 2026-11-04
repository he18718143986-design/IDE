import fs from "node:fs";
import path from "node:path";
import {
  loadPathAliases,
  parseFile,
  parseSource,
  type ParsedModule,
  type PathAliasConfig,
} from "./parser";

/**
 * 增量依赖图引擎（规范 TASK-B.1）。
 * - 节点粒度：绝对路径规范化字符串
 * - 边：文件 A 引用文件 B（A -> B）
 * - 环检测：非递归 Tarjan SCC 强连通分量算法（O(V+E)，任意深度不爆栈）
 * - 拓扑排序：Kahn 算法（DAG 时稳定输出，含环时跳过环节点）
 * - 增量更新：按 mtime/size 判断是否重新解析，单文件更新复用已有节点
 * - 孤儿/删除节点治理：purgeDeletedModule 清理所有正向边及悬空反向边
 * - 单例复用：按规范化 repoRoot 维护进程内单例 DependencyGraph
 */
export interface GraphStats {
  nodes: number;
  edges: number;
  cycles: number;
}

export interface GraphNode {
  filePath: string;
  exports: string[];
  imports: Array<{
    specifier: string;
    resolved: string | null;
    typeOnly: boolean;
  }>;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphJSON {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class DependencyGraph {
  private nodes = new Set<string>();
  /** 正向边：A -> B（A 依赖 B） */
  private edges = new Map<string, Set<string>>();
  /** 反向边：B <- A（B 被 A 依赖，用于增量重算） */
  private reverse = new Map<string, Set<string>>();
  private modules = new Map<string, ParsedModule>();

  addModule(module: ParsedModule): void {
    const key = path.resolve(module.filePath);
    this.nodes.add(key);
    this.modules.set(key, module);

    // 清理旧出边对应的反向边记录
    const oldOut = this.edges.get(key);
    if (oldOut) {
      for (const target of oldOut) {
        this.reverse.get(target)?.delete(key);
      }
    }

    const currentEdges = new Set<string>();
    this.edges.set(key, currentEdges);

    // .json 文件作为叶子节点：无论其内容如何，不建立任何出边
    if (key.endsWith(".json")) {
      return;
    }

    for (const imp of module.imports) {
      if (imp.resolved) {
        const target = path.resolve(imp.resolved);
        currentEdges.add(target);
        if (!this.reverse.has(target)) {
          this.reverse.set(target, new Set());
        }
        this.reverse.get(target)!.add(key);
      }
    }
  }

  /**
   * 移除模块节点自身及其出边（在更新替换时复用，保留其他模块指向该 key 的反向边）
   */
  removeModule(filePath: string): void {
    const key = path.resolve(filePath);

    // 清理自己的出边在目标 reverse 集合里的记录
    const out = this.edges.get(key);
    if (out) {
      for (const target of out) {
        this.reverse.get(target)?.delete(key);
      }
    }

    this.edges.delete(key);
    this.nodes.delete(key);
    this.modules.delete(key);
  }

  /**
   * 彻底删除模块（物理文件删除时使用）：清理出边，并从所有依赖本模块的调用方正向边中剔除，
   * 同时清理自身反向边，杜绝悬空反向边（dangling reverse edges）
   */
  purgeDeletedModule(filePath: string): void {
    const key = path.resolve(filePath);
    const dependents = this.reverse.get(key);
    if (dependents) {
      for (const source of dependents) {
        this.edges.get(source)?.delete(key);
      }
    }
    this.removeModule(key);
    this.reverse.delete(key);
  }

  hasNode(filePath: string): boolean {
    return this.nodes.has(path.resolve(filePath));
  }

  getNodes(): string[] {
    return Array.from(this.nodes);
  }

  getDependencies(filePath: string): string[] {
    const set = this.edges.get(path.resolve(filePath));
    return set ? Array.from(set) : [];
  }

  getDependents(filePath: string): string[] {
    const set = this.reverse.get(path.resolve(filePath));
    return set ? Array.from(set) : [];
  }

  getModule(filePath: string): ParsedModule | undefined {
    return this.modules.get(path.resolve(filePath));
  }

  /**
   * 非递归 Tarjan 强连通分量（SCC）算法检测有向环。
   * - 栈深度安全：使用显式调用栈模拟迭代，任意深度的复杂依赖环不爆调用栈
   * - 过滤规则：.json 作为叶子节点或单节点平凡环不作为架构环报告
   */
  detectCycles(): string[][] {
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const sccStack: string[] = [];
    let index = 0;
    const cycles: string[][] = [];

    interface Frame {
      node: string;
      neighbors: string[];
      nextNeighborIndex: number;
    }

    for (const startNode of this.nodes) {
      // .json 节点不参与环检测
      if (startNode.endsWith(".json")) continue;
      if (indices.has(startNode)) continue;

      const callStack: Frame[] = [];

      // push startNode
      indices.set(startNode, index);
      lowlink.set(startNode, index);
      index += 1;
      sccStack.push(startNode);
      onStack.add(startNode);

      const rawNeighbors = Array.from(this.edges.get(startNode) ?? []);
      const validNeighbors = rawNeighbors.filter(
        (target) => this.nodes.has(target) && !target.endsWith(".json"),
      );

      callStack.push({
        node: startNode,
        neighbors: validNeighbors,
        nextNeighborIndex: 0,
      });

      while (callStack.length > 0) {
        const frame = callStack[callStack.length - 1]!;
        const { node, neighbors } = frame;

        if (frame.nextNeighborIndex < neighbors.length) {
          const target = neighbors[frame.nextNeighborIndex]!;
          frame.nextNeighborIndex += 1;

          if (!indices.has(target)) {
            // 前进访问未探索节点
            indices.set(target, index);
            lowlink.set(target, index);
            index += 1;
            sccStack.push(target);
            onStack.add(target);

            const tRaw = Array.from(this.edges.get(target) ?? []);
            const tValid = tRaw.filter(
              (n) => this.nodes.has(n) && !n.endsWith(".json"),
            );
            callStack.push({
              node: target,
              neighbors: tValid,
              nextNeighborIndex: 0,
            });
          } else if (onStack.has(target)) {
            // 反向边，更新当前节点的 lowlink
            const currLow = lowlink.get(node)!;
            const targetIdx = indices.get(target)!;
            if (targetIdx < currLow) {
              lowlink.set(node, targetIdx);
            }
          }
        } else {
          // 当前节点邻居探索完毕，回溯
          callStack.pop();

          // 若还有父调用栈，用当前节点的 lowlink 更新父节点的 lowlink
          if (callStack.length > 0) {
            const parentFrame = callStack[callStack.length - 1]!;
            const parentLow = lowlink.get(parentFrame.node)!;
            const childLow = lowlink.get(node)!;
            if (childLow < parentLow) {
              lowlink.set(parentFrame.node, childLow);
            }
          }

          // 根节点触发强连通分量归约
          if (lowlink.get(node) === indices.get(node)) {
            const scc: string[] = [];
            while (true) {
              const top = sccStack.pop()!;
              onStack.delete(top);
              scc.push(top);
              if (top === node) break;
            }

            // 只有节点数 >= 2，或者存在自环的，才构成依赖环
            if (scc.length > 1) {
              cycles.push(scc);
            } else if (scc.length === 1) {
              const single = scc[0]!;
              if (this.edges.get(single)?.has(single)) {
                cycles.push(scc);
              }
            }
          }
        }
      }
    }

    return cycles;
  }

  /**
   * Kahn 拓扑排序算法。
   * 若含环，环内节点不会被包含在排序结果中（Kahn 算法经典行为）。
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    for (const node of this.nodes) {
      inDegree.set(node, 0);
    }

    for (const [, targets] of this.edges) {
      for (const target of targets) {
        if (this.nodes.has(target)) {
          inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [node, deg] of inDegree) {
      if (deg === 0) queue.push(node);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      order.push(u);
      const targets = this.edges.get(u);
      if (targets) {
        for (const v of targets) {
          if (!this.nodes.has(v)) continue;
          const newDeg = (inDegree.get(v) ?? 1) - 1;
          inDegree.set(v, newDeg);
          if (newDeg === 0) queue.push(v);
        }
      }
    }

    return order;
  }

  getStats(): GraphStats {
    let edgeCount = 0;
    for (const [, targets] of this.edges) {
      for (const target of targets) {
        if (this.nodes.has(target)) edgeCount += 1;
      }
    }
    const cycles = this.detectCycles();
    return {
      nodes: this.nodes.size,
      edges: edgeCount,
      cycles: cycles.length,
    };
  }

  /**
   * 序列化为对外契约 JSON 格式（旧契约超集）。
   * 保留 nodes: GraphNode[]（含 exports/imports）以及扁平 edges: Array<{from, to}>。
   */
  toJSON(): GraphJSON {
    const nodes: GraphNode[] = Array.from(this.nodes).map((filePath) => {
      const mod = this.modules.get(filePath);
      return {
        filePath,
        exports: mod?.exports ?? [],
        imports: (mod?.imports ?? []).map((imp) => ({
          specifier: imp.specifier,
          resolved: imp.resolved ? path.resolve(imp.resolved) : null,
          typeOnly: imp.typeOnly,
        })),
      };
    });

    const edges: GraphEdge[] = [];
    for (const [from, targets] of this.edges) {
      for (const to of targets) {
        if (this.nodes.has(to)) {
          edges.push({ from, to });
        }
      }
    }

    return {
      nodes,
      edges,
    };
  }

  /**
   * 内部邻接表视图（Record<string, string[]>），供高性能拓扑与算法分析复用。
   */
  toAdjacencyList(): Record<string, string[]> {
    const adj: Record<string, string[]> = {};
    for (const [source, targets] of this.edges) {
      adj[source] = Array.from(targets).filter((t) => this.nodes.has(t));
    }
    return adj;
  }
}

// -------------------------------------------------------------
// 全局单例与文件系统缓存协同
// -------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number;
  size: number;
  module: ParsedModule;
}

const fileCache = new Map<string, CacheEntry>();
const repoGraphs = new Map<string, DependencyGraph>();
const repoAliases = new Map<string, PathAliasConfig>();

export function clearArchGraphCache(): void {
  fileCache.clear();
  repoGraphs.clear();
  repoAliases.clear();
}

export function archGraphCacheSize(): number {
  return fileCache.size;
}

const SCAN_SUBDIR = "src";
const SOURCE_EXT_SET = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
]);

function walkSourceFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    if (!fs.existsSync(dir)) return result;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...walkSourceFiles(full));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXT_SET.has(ext)) {
          result.push(path.resolve(full));
        }
      }
    }
  } catch {
    // 容错无法读取的目录
  }
  return result;
}

function getOrLoadAliases(repoRoot: string): PathAliasConfig {
  const normalizedRoot = path.resolve(repoRoot);
  let aliases = repoAliases.get(normalizedRoot);
  if (!aliases) {
    aliases = loadPathAliases(normalizedRoot);
    repoAliases.set(normalizedRoot, aliases);
  }
  return aliases;
}

export interface BuildGraphOptions {
  root?: string;
  files?: string[];
}

export interface BuildGraphResult {
  graph: DependencyGraph;
  durationMs: number;
  cacheHitCount: number;
  recompiledCount: number;
}

export function buildDependencyGraph(
  options: BuildGraphOptions = {},
): BuildGraphResult {
  const start = performance.now();
  const repoRoot = path.resolve(options.root ?? process.cwd());
  const aliases = getOrLoadAliases(repoRoot);

  const scanRoot = path.resolve(repoRoot, SCAN_SUBDIR);
  const isUnderScanRoot = (absPath: string) =>
    absPath === scanRoot || absPath.startsWith(scanRoot + path.sep);

  let targetFiles: string[];
  if (options.files) {
    targetFiles = options.files
      .map((f) => path.resolve(f))
      .filter(isUnderScanRoot);
  } else {
    targetFiles = walkSourceFiles(scanRoot);
  }

  const useRepoSingleton = !options.files;
  let graph: DependencyGraph;
  if (useRepoSingleton) {
    let existing = repoGraphs.get(repoRoot);
    if (!existing) {
      existing = new DependencyGraph();
      repoGraphs.set(repoRoot, existing);
    }
    graph = existing;
  } else {
    graph = new DependencyGraph();
  }

  let cacheHitCount = 0;
  let recompiledCount = 0;

  const currentFileSet = new Set(targetFiles);

  if (useRepoSingleton) {
    for (const node of graph.getNodes()) {
      if (isUnderScanRoot(node) && !currentFileSet.has(node)) {
        graph.purgeDeletedModule(node);
        fileCache.delete(node);
      }
    }
  }

  for (const filePath of targetFiles) {
    try {
      const stat = fs.statSync(filePath);
      const cached = fileCache.get(filePath);

      if (
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size
      ) {
        cacheHitCount += 1;
        if (!graph.hasNode(filePath)) {
          graph.addModule(cached.module);
        }
      } else {
        recompiledCount += 1;
        const parsed = parseFile(filePath, aliases);
        fileCache.set(filePath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          module: parsed,
        });
        graph.addModule(parsed);
      }
    } catch {
      if (graph.hasNode(filePath)) {
        graph.purgeDeletedModule(filePath);
      }
      fileCache.delete(filePath);
    }
  }

  const durationMs = performance.now() - start;
  return { graph, durationMs, cacheHitCount, recompiledCount };
}

export function getOrCreateRepoGraph(repoRoot: string): BuildGraphResult {
  return buildDependencyGraph({ root: repoRoot });
}

export function updateRepoGraphFile(
  repoRoot: string,
  filePath: string,
  content?: string,
): { durationMs: number; graph: DependencyGraph } {
  const start = performance.now();
  const normalizedRoot = path.resolve(repoRoot);
  const normalizedFile = path.resolve(filePath);

  let graph = repoGraphs.get(normalizedRoot);
  if (!graph) {
    const res = buildDependencyGraph({ root: normalizedRoot });
    graph = res.graph;
  }

  const aliases = getOrLoadAliases(normalizedRoot);

  if (content !== undefined) {
    const parsed = parseSource(normalizedFile, content, aliases);
    try {
      if (fs.existsSync(normalizedFile)) {
        const stat = fs.statSync(normalizedFile);
        fileCache.set(normalizedFile, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          module: parsed,
        });
      }
    } catch {
      // 容错 stat
    }
    graph.addModule(parsed);
  } else {
    try {
      const stat = fs.statSync(normalizedFile);
      const parsed = parseFile(normalizedFile, aliases);
      fileCache.set(normalizedFile, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        module: parsed,
      });
      graph.addModule(parsed);
    } catch {
      graph.purgeDeletedModule(normalizedFile);
      fileCache.delete(normalizedFile);
    }
  }

  const durationMs = performance.now() - start;
  return { durationMs, graph };
}
