import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskGraphEngine } from "../../daemon/graph/graph-engine";
import {
  collectWorktreeEvidence,
  parsePorcelainPath,
} from "../../daemon/graph/evidence-collector";
import {
  E_EMPTY_VERIFICATION_BLOCKED,
  evaluateIllumination,
  type IlluminationInput,
} from "../../daemon/graph/illumination-verifier";
import {
  TASK_GRAPH_RELATIVE_PATH,
  TASK_NODE_STATES,
  type SupervisorProposalNode,
  type SupervisorProposalV1,
  type TaskGraph,
  type TaskNode,
} from "../../src/lib/graph/task-graph";
import {
  applyTaskGraphFrame,
  newlyIlluminatedNodeIds,
} from "../../src/components/graph/graph-view-model";

/**
 * TASK-C.7 门禁：Task Graph 不变式。
 *
 * 覆盖的是"错了就会骗用户"的几条：
 * - 提案在类型层与运行期都不得夹带运行态；
 * - 权威状态必须原子落盘、可恢复；
 * - 七态流转只走合法边，前置没亮不许开工；
 * - 点亮必须三证齐备，空验证集永远不能变绿；
 * - 外部改码必须让绿节点降级，且指纹同步撤销。
 */

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-graph-"));
});

afterEach(() => {
  // 宿主的批量删除保护会拦截递归删除临时目录；这里只做尽力清理，
  // 拦截不影响用例结论（目录落在系统临时区，由系统回收）。
  try {
    safeRmSync(repoRoot);
  } catch {
    // ignore: sandbox policy may block recursive deletion
  }
});

function baseProposal(): SupervisorProposalV1 {
  return {
    schema_version: "1.0",
    proposal_id: "proposal_1",
    contract_id: "contract_1",
    functional_tree: [
      { id: "auth", title: "用户登录", parent_id: null },
      { id: "profile", title: "个人资料", parent_id: "auth" },
    ],
    nodes: [
      {
        node_id: "n1",
        title: "生成数据表迁移",
        kind: "CODE_MODIFICATION",
        depends_on: [],
        functional_area: "auth",
        target_files: ["src/auth/migration.ts"],
        verification_mode: "COMMAND",
        verification_commands: ["test"],
      },
      {
        node_id: "n2",
        title: "编写后端认证接口",
        kind: "CODE_MODIFICATION",
        depends_on: ["n1"],
        functional_area: "auth",
        target_files: ["src/auth/login.ts"],
        verification_mode: "COMMAND",
        verification_commands: ["test"],
      },
      {
        node_id: "n3",
        title: "资料页面",
        kind: "CODE_MODIFICATION",
        depends_on: ["n2"],
        functional_area: "profile",
        target_files: ["src/profile/page.tsx"],
        verification_mode: "COMMAND",
        verification_commands: ["test"],
      },
    ],
  };
}

function nodeOf(graph: TaskGraph, nodeId: string): TaskNode {
  const node = graph.nodes.find((item) => item.node_id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  return node;
}

function passingEvidence(
  files: string[],
  overrides: Partial<Omit<IlluminationInput, "node" | "now">> = {},
): Omit<IlluminationInput, "node" | "now"> {
  return {
    files_written: files,
    file_hashes: Object.fromEntries(
      files.map((file) => [file, `sha256-${file}`]),
    ),
    scope_valid: true,
    command_results: [{ alias: "test", exit_code: 0 }],
    commit_sha: "c0ffee1234567890",
    ...overrides,
  };
}

describe("SupervisorProposalV1：类型层与运行期双重剥离运行态", () => {
  it("提案节点类型上不存在 state / executed_at / commit_sha", () => {
    const base: SupervisorProposalNode = {
      node_id: "n9",
      title: "示例",
      kind: "CODE_MODIFICATION",
      depends_on: [],
      functional_area: "auth",
      target_files: ["src/a.ts"],
      verification_mode: "COMMAND",
      verification_commands: ["test"],
    };
    expect(Object.keys(base)).not.toContain("state");

    // @ts-expect-error 运行态字段在类型层不可表达（Omit 的真正意义）
    const illegal: SupervisorProposalNode = { ...base, state: "ILLUMINATED" };
    expect(illegal).toBeDefined();
  });

  it("运行期夹带运行态字段的提案被直接拒绝，而不是静默丢弃", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    const proposal = baseProposal();
    const smuggled = {
      ...proposal.nodes[0],
      state: "ILLUMINATED",
      executed_at: "2026-10-23T00:00:00.000Z",
      commit_sha: "deadbeef",
    };
    proposal.nodes[0] = smuggled as unknown as SupervisorProposalNode;

    expect(() => engine.createFromProposal(proposal)).toThrowError(
      /运行态由 Daemon 独占/,
    );
    expect(fs.existsSync(path.join(repoRoot, TASK_GRAPH_RELATIVE_PATH))).toBe(
      false,
    );
  });

  it("建图后所有节点一律 PENDING，运行态为空", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    const graph = engine.createFromProposal(baseProposal());

    expect(graph.nodes).toHaveLength(3);
    for (const node of graph.nodes) {
      expect(node.state).toBe("PENDING");
      expect(node.executed_at).toBeNull();
      expect(node.commit_sha).toBeNull();
    }
    expect(TASK_NODE_STATES).toHaveLength(7);
    expect(graph.progress).toMatchObject({
      total: 3,
      illuminated: 0,
      percent: 0,
    });
  });
});

describe("Daemon 独占持久化（§3.3）", () => {
  it("原子落盘至 .stagent/specs/task_graph.json，并能被新实例恢复", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    const created = engine.createFromProposal(baseProposal());

    const file = path.join(repoRoot, TASK_GRAPH_RELATIVE_PATH);
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf-8")) as TaskGraph;
    expect(onDisk.nodes).toHaveLength(3);
    expect(onDisk.graph_id).toBe(created.graph_id);

    const reopened = new TaskGraphEngine({ repoRoot });
    const restored = reopened.load();
    expect(restored).not.toBeNull();
    expect(restored?.contract_id).toBe("contract_1");
    expect(restored?.nodes.map((node) => node.state)).toEqual([
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
  });

  it("getGraph 返回快照，外部改返回值不会污染权威状态", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());

    const snapshot = engine.getGraph("contract_1");
    expect(snapshot).not.toBeNull();
    if (snapshot) snapshot.nodes[0]!.state = "ILLUMINATED";

    expect(nodeOf(engine.getGraph("contract_1") as TaskGraph, "n1").state).toBe(
      "PENDING",
    );
  });

  it("磁盘文件被改坏时 load 返回 null 并留下可读原因，不抛异常", () => {
    const file = path.join(repoRoot, TASK_GRAPH_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ schema_version: "1.0", nodes: "bad" }),
    );

    const engine = new TaskGraphEngine({ repoRoot });
    expect(engine.load()).toBeNull();
    expect(engine.lastLoadError).toContain("graph_id");
  });
});

describe("拓扑不变式", () => {
  it("重复节点 id / 悬空依赖 / 环一律拒绝建图", () => {
    const engine = new TaskGraphEngine({ repoRoot });

    const duplicated = baseProposal();
    duplicated.nodes.push({ ...duplicated.nodes[0]! });
    expect(() => engine.createFromProposal(duplicated)).toThrowError(
      /重复的节点 id/,
    );

    const dangling = baseProposal();
    dangling.nodes[0] = { ...dangling.nodes[0]!, depends_on: ["ghost"] };
    expect(() => engine.createFromProposal(dangling)).toThrowError(
      /依赖不存在的节点/,
    );

    const cyclic = baseProposal();
    cyclic.nodes[0] = { ...cyclic.nodes[0]!, depends_on: ["n3"] };
    expect(() => engine.createFromProposal(cyclic)).toThrowError(/存在环/);
  });

  it("前置未点亮时禁止开工（v0.1 严格串行）", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());

    expect(() => engine.startNode("n2")).toThrowError(/尚未点亮/);
    const graph = engine.startNode("n1");
    expect(nodeOf(graph, "n1").state).toBe("RUNNING");
  });

  it("七态流转只走合法边：RUNNING 之前不能直接点亮，绿色只能经 STALE 降级", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    const created = engine.createFromProposal(baseProposal());

    const pending = nodeOf(created, "n1");
    const input = evaluateIllumination({
      node: pending,
      ...passingEvidence(["src/auth/migration.ts"]),
      now: "2026-10-23T00:00:00.000Z",
    });
    expect(input.illuminated).toBe(true);
    // verifier 本身只判证据；状态机由引擎把关
    expect(() =>
      engine.verifyNode("n1", passingEvidence(["src/auth/migration.ts"])),
    ).toThrowError(/只有 RUNNING \/ REPAIRING \/ STALE_REVERIFY/);
  });
});

describe("点亮充要条件（§3.2.2）", () => {
  it("三证齐备才点亮：写入 + 退出码 0 + Commit SHA + 指纹", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");

    const { result, graph } = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], {
        commit_sha: "abc123def456",
      }),
    );

    expect(result.illuminated).toBe(true);
    const node = nodeOf(graph, "n1");
    expect(node.state).toBe("ILLUMINATED");
    expect(node.commit_sha).toBe("abc123def456");
    expect(node.executed_at).not.toBeNull();
    expect(graph.fingerprints).toEqual([
      expect.objectContaining({
        node_id: "n1",
        path: "src/auth/migration.ts",
        sha256: "sha256-src/auth/migration.ts",
        commit_sha: "abc123def456",
      }),
    ]);
    expect(graph.progress).toMatchObject({ illuminated: 1, percent: 33 });

    // 指纹必须真的落盘，而不只是活在内存里
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(repoRoot, TASK_GRAPH_RELATIVE_PATH), "utf-8"),
    ) as TaskGraph;
    expect(onDisk.fingerprints).toHaveLength(1);
  });

  it("缺 Commit SHA 不得点亮", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");

    const { result, graph } = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], { commit_sha: null }),
    );
    expect(result.illuminated).toBe(false);
    if (!result.illuminated) {
      expect(result.code).toBe("E_COMMIT_SHA_MISSING");
    }
    expect(nodeOf(graph, "n1").state).toBe("FAILED");
    expect(graph.fingerprints).toHaveLength(0);
  });

  it("目标文件未写入 / Scope 越界均不得点亮", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");

    const notWritten = engine.verifyNode(
      "n1",
      passingEvidence(["src/other.ts"]),
    );
    expect(notWritten.result.illuminated).toBe(false);
    if (!notWritten.result.illuminated) {
      expect(notWritten.result.code).toBe("E_FILES_NOT_WRITTEN");
    }

    engine.startNode("n1"); // FAILED -> RUNNING（允许重试）
    const outOfScope = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], { scope_valid: false }),
    );
    expect(outOfScope.result.illuminated).toBe(false);
    if (!outOfScope.result.illuminated) {
      expect(outOfScope.result.code).toBe("E_SCOPE_VIOLATION");
    }
  });

  it("验证命令退出码非 0 不得点亮", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");

    const { result } = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], {
        command_results: [{ alias: "test", exit_code: 1 }],
      }),
    );
    expect(result.illuminated).toBe(false);
    if (!result.illuminated) expect(result.code).toBe("E_COMMAND_FAILED");
  });

  it("C-04：COMMAND 节点命令集为空时，即使文件与 SHA 齐备也绝不点亮", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    const proposal = baseProposal();
    proposal.nodes[0] = {
      ...proposal.nodes[0]!,
      verification_commands: [],
    };
    engine.createFromProposal(proposal);
    engine.startNode("n1");

    const { result, graph } = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], { command_results: [] }),
    );

    expect(result.illuminated).toBe(false);
    if (!result.illuminated) {
      expect(result.code).toBe(E_EMPTY_VERIFICATION_BLOCKED);
      expect(result.invalid_spec).toBe(true);
      expect(result.severity).toBe("WARNING");
    }
    expect(nodeOf(graph, "n1").state).toBe("FAILED");
    expect(graph.progress.illuminated).toBe(0);
    expect(graph.issues).toEqual([
      expect.objectContaining({
        node_id: "n1",
        code: E_EMPTY_VERIFICATION_BLOCKED,
        severity: "WARNING",
      }),
    ]);
  });

  it("C-04：命令集非空但结果集为空 / 缺项同样拦截", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");

    const empty = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], { command_results: [] }),
    );
    expect(empty.result.illuminated).toBe(false);
    if (!empty.result.illuminated) {
      expect(empty.result.code).toBe(E_EMPTY_VERIFICATION_BLOCKED);
    }

    engine.startNode("n1");
    const partial = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], {
        command_results: [{ alias: "typecheck", exit_code: 0 }],
      }),
    );
    expect(partial.result.illuminated).toBe(false);
    if (!partial.result.illuminated) {
      expect(partial.result.code).toBe(E_EMPTY_VERIFICATION_BLOCKED);
      expect(partial.result.message).toContain("不完整");
    }
  });
});

describe("隐式副作用 / 人工复核 / Fast Path 模式", () => {
  it("MANUAL 节点未显式确认时 verify 不点亮", () => {
    const proposal = baseProposal();
    proposal.nodes = [
      {
        node_id: "manual",
        title: "人工复核",
        kind: "MANUAL_REVIEW",
        depends_on: [],
        functional_area: "auth",
        target_files: ["src/auth/migration.ts"],
        verification_mode: "MANUAL",
        verification_commands: [],
      },
    ];
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(proposal);
    engine.startNode("manual");

    const result = engine.verifyNode(
      "manual",
      passingEvidence(["src/auth/migration.ts"], { manual_approved: false }),
    );
    expect(result.result.illuminated).toBe(false);
    if (!result.result.illuminated) {
      expect(result.result.code).toBe("E_MANUAL_APPROVAL_MISSING");
    }
    expect(nodeOf(result.graph, "manual").state).not.toBe("ILLUMINATED");
  });

  it("COMMAND_EXECUTION 隐式模式：无后验命令时必须有副作用变化", () => {
    const proposal = baseProposal();
    proposal.nodes = [
      {
        node_id: "env",
        title: "安装依赖",
        kind: "COMMAND_EXECUTION",
        depends_on: [],
        functional_area: "auth",
        target_files: [],
        verification_mode: "IMPLICIT_SIDE_EFFECT",
        verification_commands: [],
      },
    ];
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(proposal);
    engine.startNode("env");

    const noEffect = engine.verifyNode("env", {
      files_written: [],
      file_hashes: {},
      scope_valid: true,
      command_results: [],
      execution_exit_code: 0,
      commit_sha: "abc",
    });
    expect(noEffect.result.illuminated).toBe(false);
    if (!noEffect.result.illuminated) {
      expect(noEffect.result.code).toBe(E_EMPTY_VERIFICATION_BLOCKED);
    }

    engine.startNode("env");
    const withEffect = engine.verifyNode("env", {
      files_written: [],
      file_hashes: {},
      scope_valid: true,
      command_results: [],
      execution_exit_code: 0,
      commit_sha: "abc",
      side_effects: [
        {
          path: "package-lock.json",
          before_sha256: "old",
          after_sha256: "new",
        },
      ],
    });
    expect(withEffect.result.illuminated).toBe(true);
  });

  it("FAST_PATH 必须走语法检查，检查非 0 不得点亮", () => {
    const proposal = baseProposal();
    proposal.nodes = [
      {
        node_id: "fast",
        title: "单文件语法修正",
        kind: "FAST_PATH",
        depends_on: [],
        functional_area: "auth",
        target_files: ["src/auth/migration.ts"],
        verification_mode: "SYNTAX_CHECK",
        verification_commands: [],
      },
    ];
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(proposal);
    engine.startNode("fast");

    const failed = engine.verifyNode("fast", {
      ...passingEvidence(["src/auth/migration.ts"]),
      syntax_check_exit_code: 2,
    });
    expect(failed.result.illuminated).toBe(false);
    if (!failed.result.illuminated) {
      expect(failed.result.code).toBe("E_SYNTAX_CHECK_FAILED");
    }

    engine.startNode("fast");
    const ok = engine.verifyNode("fast", {
      ...passingEvidence(["src/auth/migration.ts"]),
      syntax_check_exit_code: 0,
    });
    expect(ok.result.illuminated).toBe(true);
  });
});

describe("级联阻断与恢复", () => {
  it("上游失败级联 BLOCKED；重验通过后下游回到 PENDING", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");

    const failed = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], {
        command_results: [{ alias: "test", exit_code: 1 }],
      }),
    );
    expect(nodeOf(failed.graph, "n2").state).toBe("BLOCKED");
    expect(nodeOf(failed.graph, "n3").state).toBe("BLOCKED");

    engine.startNode("n1");
    const recovered = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"]),
    );
    expect(recovered.result.illuminated).toBe(true);
    expect(nodeOf(recovered.graph, "n2").state).toBe("PENDING");
    expect(nodeOf(recovered.graph, "n3").state).toBe("BLOCKED");
  });
});

describe("外部改码降级（§3.4）", () => {
  it("命中目标文件的改动让绿节点变 STALE_REVERIFY，并撤销指纹", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");
    engine.verifyNode("n1", passingEvidence(["src/auth/migration.ts"]));

    const stale = engine.markStale(["src/auth/migration.ts"]);
    expect(stale).toEqual(["n1"]);

    const graph = engine.getGraph("contract_1") as TaskGraph;
    const node = nodeOf(graph, "n1");
    expect(node.state).toBe("STALE_REVERIFY");
    // 审计事实保留，证据指纹撤销
    expect(node.commit_sha).toBe("c0ffee1234567890");
    expect(graph.fingerprints).toHaveLength(0);
    expect(graph.issues.at(-1)).toMatchObject({
      node_id: "n1",
      code: "E_EVIDENCE_STALE",
      severity: "WARNING",
    });
    expect(graph.progress.illuminated).toBe(0);
  });

  it("无关路径不触发降级；STALE 节点重验通过可重新点亮", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(baseProposal());
    engine.startNode("n1");
    engine.verifyNode("n1", passingEvidence(["src/auth/migration.ts"]));

    expect(engine.markStale(["README.md"])).toEqual([]);

    engine.markStale(["src/auth/migration.ts"]);
    const reverified = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth/migration.ts"], {
        commit_sha: "newsha999",
      }),
    );
    expect(reverified.result.illuminated).toBe(true);
    expect(nodeOf(reverified.graph, "n1").commit_sha).toBe("newsha999");
    expect(reverified.graph.issues.filter((i) => i.node_id === "n1")).toEqual(
      [],
    );
  });
});

describe("证据采集：路径解析与 Worktree 缺失", () => {
  it("解析 git status porcelain v1：修改、重命名与带引号路径", () => {
    expect(parsePorcelainPath(" M src/auth/migration.ts")).toBe(
      "src/auth/migration.ts",
    );
    expect(parsePorcelainPath("?? src/new file.ts")).toBe("src/new file.ts");
    expect(parsePorcelainPath("R  src/old.ts -> src/new.ts")).toBe(
      "src/new.ts",
    );
    // git 对非 ASCII 路径按八进制转义并加引号
    expect(parsePorcelainPath('?? "\\346\\226\\207.ts"')).toBe("文.ts");
    // 越界路径一律拒绝，不能靠 ../ 逃出 Worktree
    expect(parsePorcelainPath(" M ../outside.ts")).toBeNull();
    expect(parsePorcelainPath("")).toBeNull();
  });

  it("Worktree 不存在时显式标记不可用，而不是伪造空证据为有效", async () => {
    const evidence = await collectWorktreeEvidence({
      repoRoot,
      contractId: "missing",
      targetFiles: ["src/a.ts"],
      scope: { writable_paths: ["src/**"] },
    });
    expect(evidence.worktree_available).toBe(false);
    expect(evidence.commit_sha).toBeNull();
    expect(evidence.scope_valid).toBe(false);
  });
});

describe("TASK-J.58：target_files glob 展开后的点亮与指纹", () => {
  function globProposal(): SupervisorProposalV1 {
    const proposal = baseProposal();
    proposal.nodes[0] = {
      ...proposal.nodes[0]!,
      target_files: ["src/**"],
    };
    return proposal;
  }

  it("J58-P4: 范围越界仍走现有 scope_valid / E_SCOPE_VIOLATION，不按节点目标展开集合改判", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(globProposal());
    engine.startNode("n1");

    const outOfScope = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth.js"], { scope_valid: false }),
    );
    expect(outOfScope.result.illuminated).toBe(false);
    if (!outOfScope.result.illuminated) {
      expect(outOfScope.result.code).toBe("E_SCOPE_VIOLATION");
    }
  });

  it("J58-P5: glob 点亮时 fingerprints 按真实文件路径记录", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    engine.createFromProposal(globProposal());
    engine.startNode("n1");

    const { result, graph } = engine.verifyNode(
      "n1",
      passingEvidence(["src/auth.js"]),
    );
    expect(result.illuminated).toBe(true);
    expect(graph.fingerprints).toEqual([
      expect.objectContaining({
        node_id: "n1",
        path: "src/auth.js",
        sha256: "sha256-src/auth.js",
      }),
    ]);
    expect(graph.fingerprints.some((fp) => fp.path === "src/**")).toBe(false);
  });
});

describe("TASK_GRAPH_UPDATED 帧", () => {
  it("每次变更递增 revision 并携带变更节点与进度", () => {
    const frames: Array<{
      revision: number;
      changed: string[];
      percent: number;
    }> = [];
    const engine = new TaskGraphEngine({ repoRoot });
    engine.subscribe((payload) => {
      frames.push({
        revision: payload.revision,
        changed: payload.changed_node_ids,
        percent: payload.progress_percent,
      });
    });

    engine.createFromProposal(baseProposal());
    engine.startNode("n1");
    engine.verifyNode("n1", passingEvidence(["src/auth/migration.ts"]));

    expect(frames.map((frame) => frame.revision)).toEqual([1, 2, 3]);
    expect(frames[0]?.changed).toEqual(["n1", "n2", "n3"]);
    expect(frames[2]).toMatchObject({ changed: ["n1"], percent: 33 });
  });

  it("乱序旧帧不覆盖新快照", () => {
    const engine = new TaskGraphEngine({ repoRoot });
    const first = engine.createFromProposal(baseProposal());
    engine.startNode("n1");
    const second = engine.getGraph("contract_1") as TaskGraph;

    const stalePayload = {
      contract_id: first.contract_id,
      graph: first,
      changed_node_ids: [],
      progress_percent: 0,
      revision: first.revision,
      updated_at: first.updated_at,
    };

    expect(applyTaskGraphFrame(second, stalePayload).revision).toBe(
      second.revision,
    );
    expect(newlyIlluminatedNodeIds(first, second)).toEqual([]);
  });
});
