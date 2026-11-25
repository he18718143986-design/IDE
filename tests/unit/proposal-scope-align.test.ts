import { describe, expect, it } from "vitest";
import {
  createContractDraft,
  type VerificationCommand,
} from "../../src/lib/contract.schema";
import { buildProposalFromContract } from "../../src/lib/journey/proposal-from-contract";

/**
 * TASK-J.60 方案 A：`writable_paths` 是写入权限上界，不等于必须产物。
 * 纯脚手架/配置类路径只有在验收命令要求相应能力时才成为核销节点。
 */

/** 与 daemon/supervisor/rules-l0.ts 的 GREENFIELD_NPM_WRITABLE_DEFAULTS 同序同值 */
const GREENFIELD_WRITABLE = [
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
  "**/*.test.tsx",
  "**/*.spec.ts",
];

const SCAFFOLDING = [
  "tsconfig.json",
  "tsconfig.*.json",
  "vitest.config.*",
  "vite.config.*",
  "*.config.ts",
  "*.config.mjs",
  "*.config.js",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
];

/** 九条 baseline 核销命令：executable 不是 npm，不要求 typecheck / test 能力 */
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

function targetsOf(contract: Parameters<typeof buildProposalFromContract>[0]) {
  const proposal = buildProposalFromContract(contract);
  return proposal.nodes.map((node) => node.target_files);
}

describe("TASK-J.60 计划节点目标与 Worker 实际产出对齐", () => {
  it("J60-P1：baseline 验收命令下不产出脚手架节点，真实产物节点全部保留", () => {
    const contract = createContractDraft({
      title: "手机号登录",
      description: "打开登录页后可以用手机号登录",
      acceptanceCriteria: ["可以登录", "错误提示可见"],
      writablePaths: [...GREENFIELD_WRITABLE],
      commands: baselineCommands(),
    });

    const proposal = buildProposalFromContract(contract);
    const flattened = proposal.nodes.flatMap((node) => node.target_files);

    // 真实产物仍各成节点
    expect(flattened).toEqual([
      "src/**",
      "package.json",
      "index.html",
      "tests/**",
    ]);
    // 纯脚手架/配置类不再作为核销目标
    for (const pattern of SCAFFOLDING) {
      expect(flattened).not.toContain(pattern);
    }
    // 验收命令别名仍挂在每个节点上（不因过滤改变命令口径）
    expect(proposal.nodes.every((n) => n.kind === "CODE_MODIFICATION")).toBe(
      true,
    );
    expect(proposal.nodes[0]!.verification_commands).toEqual(
      baselineCommands().map((c) => c.alias),
    );
    // 依赖仍成链
    expect(proposal.nodes[0]!.depends_on).toEqual([]);
    expect(proposal.nodes[1]!.depends_on).toEqual(["n1"]);
    expect(proposal.nodes[3]!.depends_on).toEqual(["n3"]);
  });

  it("J60-P2：npm run typecheck 要求 TS 配置，tsconfig* 仍成节点；test 能力不受影响", () => {
    const contract = createContractDraft({
      title: "带类型检查的交付",
      description: "需要 typecheck",
      acceptanceCriteria: ["类型通过"],
      writablePaths: [...GREENFIELD_WRITABLE],
      commands: [npmCommand("typecheck", ["run", "typecheck"])],
    });

    const flattened = targetsOf(contract).flat();
    expect(flattened).toContain("tsconfig.json");
    expect(flattened).toContain("tsconfig.*.json");
    // 没有 npm test → 测试/打包配置与测试 glob 仍被剔除
    expect(flattened).not.toContain("vitest.config.*");
    expect(flattened).not.toContain("vite.config.*");
    expect(flattened).not.toContain("**/*.test.ts");
  });

  it("J60-P2：npm test 要求测试能力，vitest/vite 配置仍成节点", () => {
    const contract = createContractDraft({
      title: "带测试的交付",
      description: "需要 npm test",
      acceptanceCriteria: ["测试通过"],
      writablePaths: [...GREENFIELD_WRITABLE],
      commands: [npmCommand("test", ["run", "test"])],
    });

    const flattened = targetsOf(contract).flat();
    expect(flattened).toContain("vitest.config.*");
    expect(flattened).toContain("vite.config.*");
    expect(flattened).toContain("**/*.test.ts");
    expect(flattened).toContain("**/*.spec.ts");
    // 没有 typecheck → tsconfig* 被剔除
    expect(flattened).not.toContain("tsconfig.json");
    expect(flattened).not.toContain("tsconfig.*.json");
  });

  it("J60-P2：npm test 简写（args 含 test）同样保留测试能力", () => {
    const contract = createContractDraft({
      title: "简写命令",
      description: "npm test",
      acceptanceCriteria: ["测试通过"],
      writablePaths: [...GREENFIELD_WRITABLE],
      commands: [npmCommand("test", ["test"])],
    });
    const flattened = targetsOf(contract).flat();
    expect(flattened).toContain("vitest.config.*");
  });

  it("J60-P1：可写范围全是脚手架时回退原列表，不产出零节点图", () => {
    const contract = createContractDraft({
      title: "只有配置",
      description: "边界样本",
      acceptanceCriteria: ["可运行"],
      writablePaths: ["tsconfig.json", "vite.config.*"],
      commands: baselineCommands(),
    });

    const proposal = buildProposalFromContract(contract);
    expect(proposal.nodes.map((n) => n.target_files)).toEqual([
      ["tsconfig.json"],
      ["vite.config.*"],
    ]);
  });
});
