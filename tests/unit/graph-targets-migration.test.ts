import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  TargetMigrationError,
  TaskGraphEngine,
} from "../../daemon/graph/graph-engine";
import {
  TASK_GRAPH_RELATIVE_PATH,
  type TaskGraph,
  type TaskNodeState,
} from "../../src/lib/graph/task-graph";
import type { VerificationCommand } from "../../src/lib/contract.schema";

/**
 * TASK-J.61：既有任务图目标迁移。
 *
 * 防的是"旧图目标按 J.60 属非交付物、却因为图持久化而永远点不亮"：
 * 迁移按 J.60 同一判定重新派生 `target_files`，派生为空的节点退役、
 * 下游依赖递归重接；保留节点状态与 commit_sha 原样；一次迁移只 +1 revision。
 * 已点亮节点禁止被删。
 */

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j61-"));
});

afterEach(() => {
  try {
    safeRmSync(repoRoot);
  } catch {
    // ignore: sandbox policy may block recursive deletion
  }
});

/** 九条 baseline：非 npm，不要求 typecheck / test 能力 */
function baselineCommands(): VerificationCommand[] {
  return [
    "baseline-safety-writable-scope",
    "baseline-safety-test-integrity",
    "baseline-safety-secrets",
    "baseline-rollback-auto",
    "baseline-rollback-manual",
    "baseline-rollback-no-live",
    "baseline-path-exit-codes",
    "baseline-path-mainline-regression",
    "baseline-path-knowledge",
  ].map((alias) => ({
    alias,
    executable: "stagent",
    args: ["check", alias],
    expected_exit_code: 0,
    timeout_seconds: 60,
  }));
}

function npmCommand(alias: string, args: string[]): VerificationCommand {
  return {
    alias,
    executable: "npm",
    args,
    expected_exit_code: 0,
    timeout_seconds: 60,
  };
}

const OLD_SHAPE_TARGETS = [
  "src/**",
  "package.json",
  "tsconfig.json",
  "tsconfig.*.json",
  "vitest.config.*",
  "vite.config.*",
  "*.config.ts",
  "*.config.mjs",
  "*.config.js",
  "index.html",
  "tests/**",
  "**/*.test.ts",
];

const OLD_SHAPE_STATES: TaskNodeState[] = [
  "ILLUMINATED",
  "ILLUMINATED",
  "FAILED",
  "BLOCKED",
  "BLOCKED",
  "BLOCKED",
  "BLOCKED",
  "BLOCKED",
  "BLOCKED",
  "BLOCKED",
  "BLOCKED",
  "BLOCKED",
];

/** 直接写权威文件模拟 J.60 之前生成的旧图（引擎只读盘恢复，不做转换）。 */
function writeOldShapeGraph(
  options: {
    states?: TaskNodeState[];
    targets?: string[];
    executedAt?: string | null;
    commitSha?: string | null;
    revision?: number;
  } = {},
): TaskGraph {
  const targets = options.targets ?? OLD_SHAPE_TARGETS;
  const states = options.states ?? OLD_SHAPE_STATES;
  const executedAt = options.executedAt ?? "2026-11-25T14:39:43.878Z";
  const commitSha =
    options.commitSha ?? "ae03e3cd58bcf30008281e3dccabe60a6dd780d7";
  const nodes = targets.map((target, index) => ({
    node_id: `n${index + 1}`,
    title: `落实：${target}`,
    kind: "CODE_MODIFICATION" as const,
    depends_on: index === 0 ? [] : [`n${index}`],
    functional_area: "area-main",
    target_files: [target],
    verification_mode: "COMMAND" as const,
    verification_commands: baselineCommands().map((command) => command.alias),
    state: states[index] ?? "BLOCKED",
    executed_at: states[index] === "ILLUMINATED" ? executedAt : null,
    commit_sha: states[index] === "ILLUMINATED" ? commitSha : null,
  }));
  const graph: TaskGraph = {
    schema_version: "1.0",
    graph_id: "graph_old_shape",
    contract_id: "contract_old",
    generated_at: "2026-11-25T06:32:42.551Z",
    updated_at: "2026-11-25T14:49:02.410Z",
    revision: options.revision ?? 13,
    functional_tree: [
      { id: "area-main", title: "手机号登录", parent_id: null },
    ],
    nodes,
    fingerprints: [
      {
        node_id: "n1",
        path: "src/main.js",
        sha256:
          "2fe9695bdc8017594fb618433b04f2128f87e0350429d7d0c93f09e5ee544d77",
        recorded_at: executedAt,
        commit_sha: commitSha,
      },
    ],
    issues: [],
    progress: { total: 0, illuminated: 0, percent: 0, by_state: {} },
  } as unknown as TaskGraph;
  const filePath = path.join(repoRoot, TASK_GRAPH_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(graph, null, 2));
  return graph;
}

function engine(): TaskGraphEngine {
  return new TaskGraphEngine({
    repoRoot,
    now: () => new Date("2026-11-26T00:00:00.000Z"),
  });
}

function readPersisted(): TaskGraph {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, TASK_GRAPH_RELATIVE_PATH), "utf-8"),
  ) as TaskGraph;
}

describe("TASK-J.61 既有图目标迁移", () => {
  it("旧形态图迁移后节点数 4、存活节点状态与 commit_sha 原样、revision +1", () => {
    const before = writeOldShapeGraph();
    const migrated = engine().migrateTargets({ commands: baselineCommands() });

    expect(migrated.migrated).toBe(true);
    expect(migrated.dry_run).toBe(false);
    expect(migrated.revision_before).toBe(before.revision);
    expect(migrated.revision_after).toBe(before.revision + 1);

    const graph = migrated.graph;
    expect(graph.nodes.map((node) => node.node_id)).toEqual([
      "n1",
      "n2",
      "n10",
      "n11",
    ]);
    expect(graph.nodes.map((node) => node.target_files)).toEqual([
      ["src/**"],
      ["package.json"],
      ["index.html"],
      ["tests/**"],
    ]);

    const n1 = graph.nodes.find((node) => node.node_id === "n1")!;
    const n2 = graph.nodes.find((node) => node.node_id === "n2")!;
    expect(n1.state).toBe("ILLUMINATED");
    expect(n2.state).toBe("ILLUMINATED");
    expect(n1.executed_at).toBe("2026-11-25T14:39:43.878Z");
    expect(n1.commit_sha).toBe("ae03e3cd58bcf30008281e3dccabe60a6dd780d7");
    expect(n2.commit_sha).toBe("ae03e3cd58bcf30008281e3dccabe60a6dd780d7");

    // 退役 8 条：n3 ~ n9 + n12
    expect(migrated.retired.map((item) => item.node_id)).toEqual([
      "n3",
      "n4",
      "n5",
      "n6",
      "n7",
      "n8",
      "n9",
      "n12",
    ]);
    expect(
      graph.issues.filter((issue) => issue.code === "E_TARGET_SUPERSEDED"),
    ).toHaveLength(8);
    // 链路缩短后 n10 由 BLOCKED 放回 PENDING；n11 前置 n10 尚未点亮，仍 BLOCKED
    expect(
      graph.nodes.find((node) => node.node_id === "n10")!.depends_on,
    ).toEqual(["n2"]);
    expect(graph.nodes.find((node) => node.node_id === "n10")!.state).toBe(
      "PENDING",
    );
    expect(graph.nodes.find((node) => node.node_id === "n11")!.state).toBe(
      "BLOCKED",
    );
    // 已退役节点的指纹被清掉，存活节点指纹保留
    expect(graph.fingerprints.map((item) => item.path)).toEqual([
      "src/main.js",
    ]);
    // 落盘与返回值一致
    expect(readPersisted().revision).toBe(before.revision + 1);
  });

  it("迁移幂等，再次调用不递增 revision", () => {
    writeOldShapeGraph();
    const first = engine().migrateTargets({ commands: baselineCommands() });
    expect(first.migrated).toBe(true);

    const second = engine().migrateTargets({ commands: baselineCommands() });
    expect(second.migrated).toBe(false);
    expect(second.retired).toEqual([]);
    expect(second.revision_after).toBe(first.revision_after);
    expect(
      second.graph.issues.filter(
        (issue) => issue.code === "E_TARGET_SUPERSEDED",
      ),
    ).toHaveLength(8);
  });

  it("dry_run 只预览：返回退役候选但不落盘、不递增 revision", () => {
    const before = writeOldShapeGraph();
    const preview = engine().migrateTargets({
      commands: baselineCommands(),
      dryRun: true,
    });

    expect(preview.migrated).toBe(true);
    expect(preview.dry_run).toBe(true);
    expect(preview.retired).toHaveLength(8);
    expect(preview.revision_after).toBe(before.revision);
    expect(readPersisted().revision).toBe(before.revision);
    expect(readPersisted().nodes).toHaveLength(12);
  });

  it("typecheck 保留 tsconfig、npm test 保留 vitest/vite config", () => {
    writeOldShapeGraph();
    const typecheckOnly = engine().migrateTargets({
      commands: [npmCommand("typecheck", ["run", "typecheck"])],
      dryRun: true,
    });
    const typecheckTargets = typecheckOnly.kept.map(
      (item) => item.target_files,
    );
    expect(typecheckTargets).toContainEqual(["tsconfig.json"]);
    expect(typecheckTargets).toContainEqual(["tsconfig.*.json"]);
    expect(typecheckTargets).not.toContainEqual(["vitest.config.*"]);

    writeOldShapeGraph();
    const testOnly = engine().migrateTargets({
      commands: [npmCommand("test", ["run", "test"])],
      dryRun: true,
    });
    const testTargets = testOnly.kept.map((item) => item.target_files);
    expect(testTargets).toContainEqual(["vitest.config.*"]);
    expect(testTargets).toContainEqual(["vite.config.*"]);
    expect(testTargets).toContainEqual(["**/*.test.ts"]);
    expect(testTargets).not.toContainEqual(["tsconfig.json"]);
  });

  it("已点亮节点落入空目标 → 拒绝迁移且图零改动", () => {
    const before = writeOldShapeGraph({
      states: [
        "ILLUMINATED",
        "ILLUMINATED",
        "ILLUMINATED",
        ...OLD_SHAPE_STATES.slice(3),
      ],
    });
    let caught: unknown;
    try {
      engine().migrateTargets({ commands: baselineCommands() });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TargetMigrationError);
    expect((caught as TargetMigrationError).code).toBe(
      "E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE",
    );
    const persisted = readPersisted();
    expect(persisted.revision).toBe(before.revision);
    expect(persisted.nodes).toHaveLength(12);
  });

  it("运行中退役候选 → E_GRAPH_TARGETS_IN_FLIGHT 且图零改动", () => {
    const before = writeOldShapeGraph({
      states: [
        "ILLUMINATED",
        "ILLUMINATED",
        "RUNNING",
        ...OLD_SHAPE_STATES.slice(3),
      ],
    });
    expect(() =>
      engine().migrateTargets({ commands: baselineCommands() }),
    ).toThrowError(
      expect.objectContaining({ code: "E_GRAPH_TARGETS_IN_FLIGHT" }),
    );
    expect(readPersisted().revision).toBe(before.revision);
  });

  it("graph_id 不符 → E_GRAPH_STALE_SNAPSHOT", () => {
    writeOldShapeGraph();
    expect(() =>
      engine().migrateTargets({
        commands: baselineCommands(),
        expectedGraphId: "graph_other",
      }),
    ).toThrowError(expect.objectContaining({ code: "E_GRAPH_STALE_SNAPSHOT" }));
  });

  it("多目标节点只剔除脚手架模式并保留其余目标与状态", () => {
    writeOldShapeGraph({
      targets: ["src/**", "package.json", "tsconfig.json"],
      states: ["ILLUMINATED", "ILLUMINATED", "BLOCKED"],
    });
    const graph = engine().migrateTargets({
      commands: baselineCommands(),
    }).graph;

    const n2 = graph.nodes.find((node) => node.node_id === "n2")!;
    expect(n2.target_files).toEqual(["package.json"]);
    expect(n2.state).toBe("ILLUMINATED");
    // 退役 n3 后 n2 无下游变化，节点总数 2
    expect(graph.nodes.map((node) => node.node_id)).toEqual(["n1", "n2"]);
  });
});
