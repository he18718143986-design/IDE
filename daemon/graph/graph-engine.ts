import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  computeProgress,
  topologicalOrder,
  GraphInvariantError,
  validateTaskGraph,
  TASK_GRAPH_RELATIVE_PATH,
  TASK_NODE_TRANSITIONS,
  TASK_NODE_STATES,
  type FunctionalTreeNode,
  type SupervisorProposalNode,
  type SupervisorProposalV1,
  type TaskGraph,
  type TaskGraphIssue,
  type TaskGraphUpdatedPayload,
  type TaskNode,
  type TaskNodeState,
  type VerificationMode,
} from "../../src/lib/graph/task-graph";
import { writeJsonAtomic } from "../../src/lib/state-machine";
import type { VerificationCommand } from "../../src/lib/contract.schema";
import {
  isDeliverableTarget,
  verificationCapabilities,
} from "../../src/lib/journey/proposal-from-contract";
import {
  evaluateIllumination,
  nodeTouchesPaths,
  E_EMPTY_VERIFICATION_BLOCKED,
  type IlluminationInput,
  type IlluminationResult,
} from "./illumination-verifier";

/**
 * Task Graph 权威引擎（架构规范 §3.3，TASK-C.7）。
 *
 * "Daemon 独占"不是一句口号，落成三条工程约束：
 * 1. **唯一写入口**：只有本类可以写 `.stagent/specs/task_graph.json`；
 *    服务端路由、Worker、Supervisor 一律通过这里的方法改状态。
 * 2. **原子落盘**：复用 `writeJsonAtomic`（临时文件 + fsync + rename），
 *    进程被杀不会留下半截 JSON 让下一次启动读到"半张图"。
 * 3. **对外只给快照**：`getGraph()` 返回深拷贝，调用方改返回值不会
 *    意外改掉权威状态；所有变更必须走显式方法并递增 `revision`。
 *
 * 与 15 态展示投影的关系：两者是**独立类型系统**（§3.2.1 类型隔离声明）。
 * 本模块不 import `PresentationState`，节点七态也不得赋给合同生命周期。
 */

export interface TaskGraphEngineOptions {
  repoRoot: string;
  /** 注入时钟：测试可固定时间，生产默认系统时间 */
  now?: () => Date;
}

/** `migrateTargets` 的入参：能力来源由图所属合同的验收命令决定。 */
export interface MigrateTargetsInput {
  /** 合同 `verification_spec.commands`；与 J.60 提案构建同一判定来源 */
  commands: readonly VerificationCommand[];
  /** 只预览不落盘（不递增 revision） */
  dryRun?: boolean;
  /** 乐观并发：与当前图不一致则拒绝 */
  expectedGraphId?: string;
}

export interface TargetMigrationRetiredNode {
  node_id: string;
  target_files: string[];
  title: string;
  previous_state: TaskNodeState;
}

export interface TargetMigrationKeptNode {
  node_id: string;
  state: TaskNodeState;
  target_files: string[];
}

export interface TargetMigrationResult {
  /** 是否有任何节点/目标发生变化并已落盘（dry_run 时表示"将会变化"） */
  migrated: boolean;
  dry_run: boolean;
  retired: TargetMigrationRetiredNode[];
  kept: TargetMigrationKeptNode[];
  revision_before: number;
  revision_after: number;
  graph: TaskGraph;
}

/**
 * 迁移专用错误码。
 *
 * 刻意不进 `GraphInvariantCode`：那个联合类型在 `src/lib/graph/task-graph.ts`
 * （本卡 readonly），加码就要改只读文件。迁移是新增动作，错误码收在引擎侧。
 */
export type TargetMigrationErrorCode =
  | "E_GRAPH_STALE_SNAPSHOT"
  | "E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE"
  | "E_GRAPH_TARGETS_IN_FLIGHT";

export class TargetMigrationError extends Error {
  readonly code: TargetMigrationErrorCode;

  constructor(code: TargetMigrationErrorCode, message: string) {
    super(message);
    this.name = "TargetMigrationError";
    this.code = code;
  }
}

/**
 * 提案节点的运行期白名单。
 *
 * 类型层的 `Omit` 只能挡住本仓库的 TypeScript 调用方；HTTP body 是
 * `unknown -> SupervisorProposalV1` 的断言，外部完全可以在 JSON 里塞
 * `state: "ILLUMINATED"`。这里逐字段拷贝，夹带的运行态字段会被丢弃。
 */
const PROPOSAL_NODE_KEYS = [
  "node_id",
  "title",
  "kind",
  "depends_on",
  "functional_area",
  "target_files",
  "verification_mode",
  "verification_commands",
] as const;

const KIND_MODE_MATRIX: Record<TaskNode["kind"], readonly VerificationMode[]> =
  {
    CODE_MODIFICATION: ["COMMAND"],
    COMMAND_EXECUTION: ["COMMAND", "IMPLICIT_SIDE_EFFECT"],
    MANUAL_REVIEW: ["MANUAL"],
    FAST_PATH: ["SYNTAX_CHECK"],
  };

function cloneGraph(graph: TaskGraph): TaskGraph {
  return JSON.parse(JSON.stringify(graph)) as TaskGraph;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GraphInvariantError(
      "E_PROPOSAL_INVALID",
      `提案字段 ${field} 必须是非空字符串`,
    );
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new GraphInvariantError(
      "E_PROPOSAL_INVALID",
      `提案字段 ${field} 必须是字符串数组`,
    );
  }
  return [...(value as string[])];
}

function sanitizeProposalNode(raw: unknown): SupervisorProposalNode {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new GraphInvariantError("E_PROPOSAL_INVALID", "提案节点必须是对象");
  }
  const record = raw as Record<string, unknown>;

  // 先确认没有未知字段被静默忽略：只允许静态规格键。
  // 运行态字段（state / executed_at / commit_sha）出现在提案里是**上游 bug**，
  // 这里直接报错而不是悄悄丢掉——悄悄丢掉会让"提案夹带运行态"一直存在。
  for (const key of Object.keys(record)) {
    if (!(PROPOSAL_NODE_KEYS as readonly string[]).includes(key)) {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `提案节点 ${String(record["node_id"])} 含非法字段 "${key}"：` +
          "SupervisorProposalV1 只允许静态规格，运行态由 Daemon 独占",
      );
    }
  }

  const kind = requireNonEmptyString(
    record["kind"],
    "kind",
  ) as TaskNode["kind"];
  if (!Object.prototype.hasOwnProperty.call(KIND_MODE_MATRIX, kind)) {
    throw new GraphInvariantError("E_PROPOSAL_INVALID", `未知节点类型 ${kind}`);
  }
  const verificationMode = requireNonEmptyString(
    record["verification_mode"],
    "verification_mode",
  ) as VerificationMode;
  if (!KIND_MODE_MATRIX[kind].includes(verificationMode)) {
    throw new GraphInvariantError(
      "E_PROPOSAL_INVALID",
      `节点 ${String(record["node_id"])} 的类型 ${kind} 不允许验证模式 ${verificationMode}`,
    );
  }

  return {
    node_id: requireNonEmptyString(record["node_id"], "node_id"),
    title: requireNonEmptyString(record["title"], "title"),
    kind,
    depends_on: requireStringArray(record["depends_on"], "depends_on"),
    functional_area: requireNonEmptyString(
      record["functional_area"],
      "functional_area",
    ),
    target_files: requireStringArray(record["target_files"], "target_files"),
    verification_mode: verificationMode,
    verification_commands: requireStringArray(
      record["verification_commands"],
      "verification_commands",
    ),
  };
}

/** 功能树校验：id 唯一、父节点存在、无环 */
function validateFunctionalTree(raw: unknown): FunctionalTreeNode[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new GraphInvariantError(
      "E_PROPOSAL_INVALID",
      "functional_tree 至少需要一个业务功能节点",
    );
  }
  const tree: FunctionalTreeNode[] = raw.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `functional_tree[${index}] 不是对象`,
      );
    }
    const record = item as Record<string, unknown>;
    const id = requireNonEmptyString(
      record["id"],
      `functional_tree[${index}].id`,
    );
    const title = requireNonEmptyString(
      record["title"],
      `functional_tree[${index}].title`,
    );
    const parent = record["parent_id"];
    if (!(parent === null || typeof parent === "string")) {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `functional_tree[${index}].parent_id 必须是字符串或 null`,
      );
    }
    const description = record["description"];
    if (description !== undefined && typeof description !== "string") {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `functional_tree[${index}].description 必须是字符串`,
      );
    }
    return {
      id,
      title,
      parent_id: parent,
      ...(description === undefined ? {} : { description }),
    };
  });

  const ids = new Set<string>();
  for (const node of tree) {
    if (ids.has(node.id)) {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `功能树存在重复 id: ${node.id}`,
      );
    }
    ids.add(node.id);
  }
  for (const node of tree) {
    if (node.parent_id !== null && !ids.has(node.parent_id)) {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `功能节点 ${node.id} 的父节点 ${node.parent_id} 不存在`,
      );
    }
    // 沿父链回溯，超过节点总数即说明有环
    let cursor = node.parent_id;
    let steps = 0;
    while (cursor !== null && steps <= tree.length) {
      const parent = tree.find((item) => item.id === cursor);
      cursor = parent?.parent_id ?? null;
      steps += 1;
    }
    if (steps > tree.length) {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `功能树存在环，起点 ${node.id}`,
      );
    }
  }
  return tree;
}

export class TaskGraphEngine {
  private readonly repoRoot: string;
  private readonly filePath: string;
  private readonly now: () => Date;
  private active: TaskGraph | null = null;
  private loadError: string | null = null;
  private readonly listeners = new Set<
    (payload: TaskGraphUpdatedPayload) => void
  >();

  constructor(options: TaskGraphEngineOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.filePath = path.join(this.repoRoot, TASK_GRAPH_RELATIVE_PATH);
    this.now = options.now ?? (() => new Date());
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  /** 规范 §3.3 指定的权威文件路径（测试与诊断用） */
  get storagePath(): string {
    return this.filePath;
  }

  get lastLoadError(): string | null {
    return this.loadError;
  }

  subscribe(listener: (payload: TaskGraphUpdatedPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 从磁盘恢复权威状态。
   *
   * 文件不存在返回 null（首次启动）；文件损坏也返回 null，但把原因留在
   * `lastLoadError`。这里刻意不抛：一份被外部改坏的 JSON 不该让 Daemon 起不来。
   */
  load(): TaskGraph | null {
    if (this.active) return this.active;
    if (!fs.existsSync(this.filePath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      const parsed = validateTaskGraph(raw);
      if (!parsed.ok) {
        this.loadError = `${TASK_GRAPH_RELATIVE_PATH}: ${parsed.message}`;
        return null;
      }
      const graph = parsed.graph;
      // 落盘的 progress 可能来自旧版本；内存以节点事实重新计算，避免
      // "文件写 80%、节点只亮了 2 个"这种自相矛盾的快照被广播出去。
      graph.progress = computeProgress(graph.nodes);
      this.active = graph;
      this.loadError = null;
      return graph;
    } catch (err) {
      this.loadError = `${TASK_GRAPH_RELATIVE_PATH}: ${(err as Error).message}`;
      return null;
    }
  }

  getGraph(contractId?: string): TaskGraph | null {
    const graph = this.load();
    if (!graph) return null;
    if (contractId !== undefined && graph.contract_id !== contractId) {
      return null;
    }
    return cloneGraph(graph);
  }

  /**
   * 从 Supervisor 提案建立图。所有节点一律 `PENDING`——提案不携带、
   * 也不被允许携带任何运行态。
   */
  createFromProposal(proposal: SupervisorProposalV1): TaskGraph {
    if (proposal.schema_version !== "1.0") {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        `不支持的提案版本: ${String(proposal.schema_version)}`,
      );
    }
    const contractId = requireNonEmptyString(
      proposal.contract_id,
      "contract_id",
    );
    const proposalId = requireNonEmptyString(
      proposal.proposal_id,
      "proposal_id",
    );
    const tree = validateFunctionalTree(proposal.functional_tree);
    const areaIds = new Set(tree.map((node) => node.id));

    if (!Array.isArray(proposal.nodes) || proposal.nodes.length === 0) {
      throw new GraphInvariantError(
        "E_PROPOSAL_INVALID",
        "提案没有任何工程节点",
      );
    }

    const staticNodes = proposal.nodes.map((node) =>
      sanitizeProposalNode(node),
    );
    for (const node of staticNodes) {
      if (!areaIds.has(node.functional_area)) {
        throw new GraphInvariantError(
          "E_PROPOSAL_INVALID",
          `节点 ${node.node_id} 指向不存在的功能区域 ${node.functional_area}`,
        );
      }
    }
    // 拓扑校验（重复 id / 悬空依赖 / 环）在建立图之前完成
    topologicalOrder(staticNodes);

    const timestamp = this.now().toISOString();
    const nodes: TaskNode[] = staticNodes.map((node) => ({
      ...node,
      state: "PENDING",
      executed_at: null,
      commit_sha: null,
    }));

    const graph: TaskGraph = {
      schema_version: "1.0",
      graph_id: `graph_${Date.now()}_${randomUUID().slice(0, 8)}`,
      contract_id: contractId,
      generated_at:
        typeof proposal.generated_at === "string"
          ? proposal.generated_at
          : timestamp,
      updated_at: timestamp,
      revision: 1,
      functional_tree: tree,
      nodes,
      fingerprints: [],
      issues: [],
      progress: computeProgress(nodes),
    };

    // 先落盘再对外可见：写失败时内存里不会留下一张"磁盘上不存在"的图
    writeJsonAtomic(this.filePath, graph);
    this.active = graph;
    this.loadError = null;
    this.publish(nodes.map((node) => node.node_id));
    return cloneGraph(graph);
  }

  /**
   * 把节点置为 `RUNNING`。前置依赖未全部点亮时拒绝——v0.1 严格串行，
   * "跳过上游先跑下游"会直接破坏证据链。
   */
  startNode(nodeId: string): TaskGraph {
    const graph = this.requireGraph();
    const node = this.requireNode(graph, nodeId);
    for (const dependencyId of node.depends_on) {
      const dependency = this.requireNode(graph, dependencyId);
      if (dependency.state !== "ILLUMINATED") {
        throw new GraphInvariantError(
          "E_UPSTREAM_NOT_ILLUMINATED",
          `节点 ${nodeId} 的前置 ${dependencyId} 尚未点亮（当前 ${dependency.state}）`,
        );
      }
    }
    this.transition(node, "RUNNING");
    return this.commit([nodeId]);
  }

  /**
   * 提交一次验证证据并尝试点亮。
   *
   * 返回判定结果与最新图快照：调用方（HTTP 路由）需要把 `code` 原样回给
   * 前端，让用户看到"为什么没亮"，而不是一个笼统的 500。
   */
  applyVerification(input: IlluminationInput): {
    result: IlluminationResult;
    graph: TaskGraph;
  } {
    const graph = this.requireGraph();
    const node = this.requireNode(graph, input.node.node_id);

    if (
      node.state !== "RUNNING" &&
      node.state !== "REPAIRING" &&
      node.state !== "STALE_REVERIFY"
    ) {
      throw new GraphInvariantError(
        "E_ILLEGAL_NODE_TRANSITION",
        `节点 ${node.node_id} 当前为 ${node.state}，只有 RUNNING / REPAIRING / ` +
          "STALE_REVERIFY 可以提交验证证据",
      );
    }

    // 以权威节点为准，忽略调用方传入的任何运行态副本
    const result = evaluateIllumination({ ...input, node });
    const changed: string[] = [node.node_id];

    if (result.illuminated) {
      this.transition(node, "ILLUMINATED");
      node.executed_at = result.executed_at;
      node.commit_sha = result.commit_sha;
      graph.fingerprints = [
        ...graph.fingerprints.filter((item) => item.node_id !== node.node_id),
        ...result.fingerprints,
      ];
      // 点亮后清除该节点的历史问题（保留其它节点的）
      graph.issues = graph.issues.filter(
        (issue) => issue.node_id !== node.node_id,
      );
      changed.push(...this.releaseDownstream(graph, node.node_id));
    } else {
      this.transition(node, "FAILED");
      this.recordIssue(
        graph,
        node.node_id,
        result.code,
        result.message,
        result.severity,
      );
      changed.push(...this.blockDownstream(graph, node.node_id));
    }

    return { result, graph: this.commit(changed) };
  }

  /**
   * 以权威节点为准提交证据（HTTP 路由使用）。
   *
   * 调用方只提供"证据"，不提供节点副本：即使请求体里夹带一份伪造的
   * `target_files`，也会被图里的真实节点覆盖。
   */
  verifyNode(
    nodeId: string,
    evidence: Omit<IlluminationInput, "node" | "now">,
  ): { result: IlluminationResult; graph: TaskGraph } {
    const graph = this.requireGraph();
    const node = this.requireNode(graph, nodeId);
    return this.applyVerification({
      ...evidence,
      node,
      now: this.now().toISOString(),
    });
  }

  /**
   * 外部改码 / 后续任务改写导致证据过期（§3.4）。
   *
   * 只有已点亮且目标文件被命中的节点会降级；降级同时撤销该节点指纹，
   * 但保留 `executed_at` / `commit_sha` 作为审计事实。
   */
  markStale(changedPaths: readonly string[]): string[] {
    const graph = this.load();
    if (!graph || changedPaths.length === 0) return [];

    const affected = graph.nodes.filter(
      (node) =>
        node.state === "ILLUMINATED" && nodeTouchesPaths(node, changedPaths),
    );
    if (affected.length === 0) return [];

    for (const node of affected) {
      this.transition(node, "STALE_REVERIFY");
      graph.fingerprints = graph.fingerprints.filter(
        (item) => item.node_id !== node.node_id,
      );
      this.recordIssue(
        graph,
        node.node_id,
        "E_EVIDENCE_STALE",
        `检测到外部文件改动（${changedPaths.slice(0, 3).join(", ")}）：证据已过期，等待重新验证`,
        "WARNING",
      );
    }
    this.commit(affected.map((node) => node.node_id));
    return affected.map((node) => node.node_id);
  }

  /**
   * TASK-J.61：把 J.60 之前生成的既有图目标迁移到新规则。
   *
   * 规则（Tina P-317 拍板，逐条对应卡面验收）：
   * 1. 按 J.60 同一判定（`isDeliverableTarget`）逐个过滤节点 `target_files`；
   * 2. 过滤后为空的节点退役，下游 `depends_on` 递归跳过它指向其上游；
   * 3. 保留节点维持 `node_id` / `state` / `executed_at` / `commit_sha`；
   * 4. 一次迁移只 `commit()` 一次 → `revision` 恰好 +1；`dry_run` 不落盘；
   * 5. 退役候选为 `ILLUMINATED` → 拒绝迁移（已点亮节点不得擅自删除）；
   *    `RUNNING` / `REPAIRING` → 拒绝迁移（有节点在飞）。
   */
  migrateTargets(input: MigrateTargetsInput): TargetMigrationResult {
    const graph = this.requireGraph();
    if (
      input.expectedGraphId !== undefined &&
      graph.graph_id !== input.expectedGraphId
    ) {
      throw new TargetMigrationError(
        "E_GRAPH_STALE_SNAPSHOT",
        `图快照已变化（当前 ${graph.graph_id}，请求 ${input.expectedGraphId}），请刷新后重试`,
      );
    }

    const capabilities = verificationCapabilities(input.commands);
    const revisionBefore = graph.revision;

    const retired: TargetMigrationRetiredNode[] = [];
    const retiredIds = new Set<string>();
    const nextTargets = new Map<string, string[]>();
    const changedIds: string[] = [];

    for (const node of graph.nodes) {
      const filtered = node.target_files.filter((pattern) =>
        isDeliverableTarget(pattern, capabilities),
      );
      nextTargets.set(node.node_id, filtered);
      if (filtered.length === 0 && node.target_files.length > 0) {
        retiredIds.add(node.node_id);
        retired.push({
          node_id: node.node_id,
          target_files: [...node.target_files],
          title: node.title,
          previous_state: node.state,
        });
        continue;
      }
      if (filtered.length !== node.target_files.length) {
        changedIds.push(node.node_id);
      }
    }

    const illuminatedRetired = retired.filter(
      (item) => item.previous_state === "ILLUMINATED",
    );
    if (illuminatedRetired.length > 0) {
      throw new TargetMigrationError(
        "E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE",
        `节点 ${illuminatedRetired
          .map((item) => item.node_id)
          .join(", ")} 已点亮但目标按 J.60 属非交付物：拒绝迁移，需人工另议`,
      );
    }
    const inFlightRetired = retired.filter(
      (item) =>
        item.previous_state === "RUNNING" ||
        item.previous_state === "REPAIRING",
    );
    if (inFlightRetired.length > 0) {
      throw new TargetMigrationError(
        "E_GRAPH_TARGETS_IN_FLIGHT",
        `节点 ${inFlightRetired
          .map((item) => `${item.node_id}（${item.previous_state}）`)
          .join(", ")} 正在执行中，拒绝迁移`,
      );
    }

    const migrated = retired.length > 0 || changedIds.length > 0;
    const dryRun = input.dryRun === true;
    const buildKept = (nodes: readonly TaskNode[]): TargetMigrationKeptNode[] =>
      nodes
        .filter((node) => !retiredIds.has(node.node_id))
        .map((node) => ({
          node_id: node.node_id,
          state: node.state,
          target_files: [...node.target_files],
        }));

    if (!migrated || dryRun) {
      return {
        migrated,
        dry_run: dryRun,
        retired,
        kept: buildKept(graph.nodes),
        revision_before: revisionBefore,
        revision_after: revisionBefore,
        graph: cloneGraph(graph),
      };
    }

    const retiredById = new Map(
      graph.nodes
        .filter((node) => retiredIds.has(node.node_id))
        .map((node) => [node.node_id, node]),
    );
    /** 依赖若指向已退役节点，跳过它继续找上游；环形保护避免无限递归。 */
    const resolveUpstream = (
      dependencyId: string,
      seen: Set<string> = new Set(),
    ): string[] => {
      const retiredNode = retiredById.get(dependencyId);
      if (!retiredNode) return [dependencyId];
      if (seen.has(dependencyId)) return [];
      seen.add(dependencyId);
      return retiredNode.depends_on.flatMap((upstream) =>
        resolveUpstream(upstream, seen),
      );
    };

    const nodes: TaskNode[] = [];
    for (const node of graph.nodes) {
      if (retiredIds.has(node.node_id)) continue;
      const dependsOn: string[] = [];
      for (const dependencyId of node.depends_on) {
        for (const resolved of resolveUpstream(dependencyId)) {
          if (!retiredIds.has(resolved) && !dependsOn.includes(resolved)) {
            dependsOn.push(resolved);
          }
        }
      }
      nodes.push({
        ...node,
        target_files: nextTargets.get(node.node_id) ?? [...node.target_files],
        depends_on: dependsOn,
      });
    }

    // 退役会把链路缩短：前置已全部点亮的 BLOCKED 节点应放回 PENDING
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const node of nodes) {
        if (node.state !== "BLOCKED") continue;
        const ready = node.depends_on.every(
          (dependencyId) =>
            nodes.find((item) => item.node_id === dependencyId)?.state ===
            "ILLUMINATED",
        );
        if (!ready) continue;
        this.transition(node, "PENDING");
        changedIds.push(node.node_id);
        progressed = true;
      }
    }

    const timestamp = this.now().toISOString();
    const retiredIssues: TaskGraphIssue[] = retired.map((item) => ({
      node_id: item.node_id,
      code: "E_TARGET_SUPERSEDED",
      message:
        `节点 ${item.node_id} 的目标 ${item.target_files.join(", ")} ` +
        `按 J.60 判定属非交付物，已退役（原状态 ${item.previous_state}）；` +
        `下游依赖已重接`,
      severity: "WARNING",
      recorded_at: timestamp,
    }));

    graph.nodes = nodes;
    graph.issues = [...graph.issues, ...retiredIssues];
    graph.fingerprints = graph.fingerprints.filter(
      (fingerprint) => !retiredIds.has(fingerprint.node_id),
    );

    const committed = this.commit([...new Set([...retiredIds, ...changedIds])]);
    return {
      migrated: true,
      dry_run: false,
      retired,
      kept: buildKept(committed.nodes),
      revision_before: revisionBefore,
      revision_after: committed.revision,
      graph: committed,
    };
  }

  /** 供崩溃恢复 / 诊断使用：清空内存态并重新读盘（不删文件） */
  reload(): TaskGraph | null {
    this.active = null;
    this.loadError = null;
    return this.load();
  }

  // ---- 内部 ----

  private requireGraph(): TaskGraph {
    const graph = this.load();
    if (!graph) {
      throw new GraphInvariantError(
        "E_GRAPH_NOT_FOUND",
        this.loadError ??
          `尚未建立任务图谱（${TASK_GRAPH_RELATIVE_PATH} 不存在或被判定损坏）`,
      );
    }
    return graph;
  }

  private requireNode(graph: TaskGraph, nodeId: string): TaskNode {
    const node = graph.nodes.find((item) => item.node_id === nodeId);
    if (!node) {
      throw new GraphInvariantError(
        "E_GRAPH_UNKNOWN_NODE",
        `图中不存在节点 ${nodeId}`,
      );
    }
    return node;
  }

  private transition(node: TaskNode, next: TaskNodeState): void {
    if (node.state === next) return;
    if (!TASK_NODE_TRANSITIONS[node.state].includes(next)) {
      throw new GraphInvariantError(
        "E_ILLEGAL_NODE_TRANSITION",
        `节点 ${node.node_id} 不允许从 ${node.state} 流转到 ${next}（允许: ${TASK_NODE_TRANSITIONS[
          node.state
        ].join(", ")}）`,
      );
    }
    node.state = next;
  }

  private recordIssue(
    graph: TaskGraph,
    nodeId: string,
    code: string,
    message: string,
    severity: TaskGraphIssue["severity"],
  ): void {
    // 同一节点同一问题码只保留最新一条：重试 3 次不该在审计里留下 3 条
    // 一模一样的"验证集为空"，那会让用户以为出了三种不同的问题。
    graph.issues = graph.issues.filter(
      (issue) => !(issue.node_id === nodeId && issue.code === code),
    );
    graph.issues.push({
      node_id: nodeId,
      code,
      message,
      severity,
      recorded_at: this.now().toISOString(),
    });
  }

  /** 上游失败 → 下游 PENDING 节点级联 BLOCKED（§3.2.1） */
  private blockDownstream(graph: TaskGraph, nodeId: string): string[] {
    const blocked: string[] = [];
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const node of graph.nodes) {
        if (!node.depends_on.includes(current)) continue;
        if (node.state === "PENDING") {
          this.transition(node, "BLOCKED");
          blocked.push(node.node_id);
          queue.push(node.node_id);
        } else if (node.state === "BLOCKED") {
          // 已经在阻断态：继续向更下游传播，但不重复计入变更集
          queue.push(node.node_id);
        }
      }
    }
    return blocked;
  }

  /** 上游恢复点亮 → 把该节点下游、且全部前置已点亮的 BLOCKED 放回 PENDING */
  private releaseDownstream(graph: TaskGraph, nodeId: string): string[] {
    // 只处理 nodeId 的后代，避免"点亮 A 顺手放开了无关分支 B"
    const reachable = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const node of graph.nodes) {
        if (node.depends_on.includes(current) && !reachable.has(node.node_id)) {
          reachable.add(node.node_id);
          queue.push(node.node_id);
        }
      }
    }

    const released: string[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const node of graph.nodes) {
        if (node.state !== "BLOCKED" || !reachable.has(node.node_id)) continue;
        const ready = node.depends_on.every((dependencyId) => {
          const dependency = graph.nodes.find(
            (item) => item.node_id === dependencyId,
          );
          return dependency?.state === "ILLUMINATED";
        });
        if (!ready) continue;
        this.transition(node, "PENDING");
        released.push(node.node_id);
        progressed = true;
      }
    }
    return released;
  }

  private commit(changedNodeIds: string[]): TaskGraph {
    const graph = this.requireGraph();
    graph.updated_at = this.now().toISOString();
    graph.revision += 1;
    graph.progress = computeProgress(graph.nodes);
    try {
      writeJsonAtomic(this.filePath, graph);
    } catch (err) {
      // 落盘失败时内存不能"假装成功"：丢弃未持久化的内存态，
      // 下一次读取回到磁盘上的最后一份好快照。
      this.active = null;
      this.loadError = `${TASK_GRAPH_RELATIVE_PATH}: 写入失败 ${(err as Error).message}`;
      throw err;
    }
    this.publish(changedNodeIds);
    return cloneGraph(graph);
  }

  private publish(changedNodeIds: string[]): void {
    const graph = this.active;
    if (!graph) return;
    const payload: TaskGraphUpdatedPayload = {
      contract_id: graph.contract_id,
      graph: cloneGraph(graph),
      changed_node_ids: [...changedNodeIds],
      progress_percent: graph.progress.percent,
      revision: graph.revision,
      updated_at: graph.updated_at,
    };
    for (const listener of this.listeners) listener(payload);
  }
}

/** 空验证集错误码的再导出：路由与测试不必分别 import 两个模块 */
export { E_EMPTY_VERIFICATION_BLOCKED };
export { TASK_NODE_STATES };
