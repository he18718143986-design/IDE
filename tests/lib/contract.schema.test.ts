import { describe, expect, it } from "vitest";
import {
  approvalStatusSchema,
  budgetLimitsSchema,
  costLimitsSchema,
  createContractDraft,
  executionPermissionsSchema,
  lifecycleStateSchema,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  reasonCodeSchema,
  usageSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";

/** 构造一份最小合法合同基线 */
function baseContract(
  overrides: Partial<SoftwareContract> = {},
): SoftwareContract {
  const draft = createContractDraft({
    title: "示范任务",
    description: "用于 Schema 校验的示范合同",
    acceptanceCriteria: ["npm test 通过"],
    writablePaths: ["src/math.ts"],
  });
  return { ...draft, ...overrides };
}

function baseEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const evidence: EvidenceBundle = {
    evidence_id: "evi_1",
    contract_id: "contract_1",
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "ESTIMATED",
      estimated_cost_minor_units: 100,
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "abc123",
      snapshot_fingerprint: "fp_abc123",
      captured_at: new Date().toISOString(),
    },
    verdict: {
      status: "PASSED",
      can_merge: true,
      summary: "all gates passed",
    },
    scope_audit: {
      passed: true,
      files_changed: [
        { path: "src/math.ts", additions: 3, deletions: 1, binary: false },
      ],
      forbidden_violations: [],
      budget_exhausted: false,
    },
    verification_results: [
      {
        command_alias: "test",
        exit_code: 0,
        stdout_tail: "ok",
        stderr_tail: "",
        duration_ms: 12,
        passed: true,
      },
    ],
    git_info: {
      base_commit_sha: "base1",
      task_commit_sha: "task1",
      diff_stat: "1 file changed",
      patch_fingerprint: "sha256_x",
    },
  };
  return { ...evidence, ...overrides };
}

describe("TASK-0.2 PASS-1 生命周期 9 态枚举", () => {
  it("包含规范 §9.1 的全部 9 态且无多余状态", () => {
    expect(lifecycleStateSchema.options).toEqual([
      "DRAFT",
      "PENDING_APPROVAL",
      "PREPARING",
      "EXECUTING",
      "VERIFYING",
      "PENDING_RESUME",
      "AUDITED",
      "MERGED",
      "ABORTED",
    ]);
  });

  it("拒绝已废止的 8 态枚举值", () => {
    for (const illegal of [
      "APPROVED",
      "AWAITING_APPROVAL",
      "FAILED",
      "BLOCKED",
    ]) {
      expect(lifecycleStateSchema.safeParse(illegal).success).toBe(false);
    }
  });
});

describe("TASK-0.2 PASS-2 证据结论状态归属 Evidence", () => {
  it("verdict.status 仅允许 PASSED/FAILED/BLOCKED/STALE", () => {
    expect(evidenceBundleSchema.safeParse(baseEvidence()).success).toBe(true);
    for (const status of ["PASSED", "FAILED", "BLOCKED", "STALE"] as const) {
      const ev = baseEvidence({
        verdict: {
          status,
          can_merge: status === "PASSED",
          summary: status,
        },
      });
      expect(evidenceBundleSchema.safeParse(ev).success).toBe(true);
    }
  });
});

describe("TASK-0.2 PASS-3 原因码完整闭环", () => {
  it("包含 §9.2 的 9 个原因码 + L.3 义务四码 + L.12 知识漂移", () => {
    expect(reasonCodeSchema.options).toEqual([
      "SCOPE_VIOLATION",
      "BUDGET_EXHAUSTED",
      "WORKSPACE_LOCKED",
      "UNAUTHORIZED_COMMAND",
      "VERIFICATION_RETRY_LIMIT",
      "UNSAFE_EXECUTION",
      "EVIDENCE_STALE",
      "PREPARATION_INTERRUPTED",
      "WORKTREE_LOST",
      "OBLIGATION_NOT_RED",
      "OBLIGATION_RED_INVALID",
      "OBLIGATION_NOT_GREEN",
      "TEST_WEAKENED",
      "KNOWLEDGE_DRIFT",
    ]);
  });
});

describe("TASK-0.2 PASS-4 双状态机联动 (§9.1.1)", () => {
  it("approval 为 4 态", () => {
    expect(approvalStatusSchema.options).toEqual([
      "DRAFT",
      "PENDING_REVIEW",
      "APPROVED",
      "REJECTED",
    ]);
  });

  it("APPROVED 时 approved_by/approved_at 必填", () => {
    const contract = baseContract({
      lifecycle_state: "PREPARING",
      approval: { status: "APPROVED" },
    });
    expect(softwareContractSchema.safeParse(contract).success).toBe(false);

    const valid = baseContract({
      lifecycle_state: "PREPARING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
      },
    });
    expect(softwareContractSchema.safeParse(valid).success).toBe(true);
  });

  it("拒绝非法生命周期×审批组合", () => {
    const illegal = baseContract({
      lifecycle_state: "EXECUTING",
      approval: { status: "PENDING_REVIEW" },
    });
    const result = softwareContractSchema.safeParse(illegal);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "Illegal state combination",
      );
    }
  });

  it("PENDING_APPROVAL 必须搭配 PENDING_REVIEW", () => {
    const ok = baseContract({
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    expect(softwareContractSchema.safeParse(ok).success).toBe(true);
  });
});

describe("TASK-0.2 PASS-5 结构化命令与双超时", () => {
  it("命令必须为 executable+args 结构，且超时独立定义", () => {
    const contract = baseContract();
    const cmd = contract.verification_spec.commands[0];
    expect(cmd).toMatchObject({
      alias: expect.any(String),
      executable: expect.any(String),
      args: expect.any(Array),
      expected_exit_code: expect.any(Number),
      timeout_seconds: expect.any(Number),
    });
    expect(
      contract.authorization.budget_limits.max_duration_seconds,
    ).toBeGreaterThan(0);
  });

  it("空验证命令被拒绝", () => {
    const contract = baseContract();
    const invalid = {
      ...contract,
      verification_spec: { commands: [] },
    };
    expect(softwareContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("shell 字符串形式（无 args 数组）不被接受", () => {
    const contract = baseContract();
    const invalid = {
      ...contract,
      verification_spec: {
        commands: [{ alias: "test", executable: "npm test" }],
      },
    };
    expect(softwareContractSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("TASK-0.2 PASS-6 execution_permissions 全字段", () => {
  it("支持规范列出的全部字段", () => {
    const parsed = executionPermissionsSchema.safeParse({
      allowed_commands: ["test"],
      allowed_environment_variable_names: ["NODE_ENV"],
      network_policy: "EXPLICIT_TARGETS",
      dependency_changes_allowed: true,
      editor_command_template: "cursor {path}",
      env_file_grants: [
        {
          file: ".env.test",
          command_aliases: ["test"],
          variable_names: ["DATABASE_URL"],
        },
      ],
      port_policy: "DYNAMIC_IF_SUPPORTED",
    });
    expect(parsed.success).toBe(true);
  });

  it("拒绝非法 network_policy", () => {
    expect(
      executionPermissionsSchema.safeParse({
        allowed_commands: [],
        allowed_environment_variable_names: [],
        network_policy: "ALLOW_ALL",
        dependency_changes_allowed: false,
      }).success,
    ).toBe(false);
  });
});

describe("TASK-0.2 PASS-7 多币种与账单模式", () => {
  it("cost_limits 使用最小货币单位与币种，而非单一 USD 浮点", () => {
    const limits = costLimitsSchema.safeParse({
      max_cost_minor_units: 20000,
      currency: "CNY",
      pricing_version: "2026-10",
      accounting_mode: "ESTIMATED",
    });
    expect(limits.success).toBe(true);

    expect(
      costLimitsSchema.safeParse({
        max_cost_usd: 2,
      }).success,
    ).toBe(false);
  });

  it("usage.accounting_mode 支持 UNAVAILABLE", () => {
    expect(
      usageSchema.safeParse({
        currency: "CNY",
        pricing_version: "v1",
        accounting_mode: "UNAVAILABLE",
        limit_reached: false,
      }).success,
    ).toBe(true);
  });

  it("预算金额为负数时抛错", () => {
    expect(
      costLimitsSchema.safeParse({
        max_cost_minor_units: -1,
        currency: "CNY",
        pricing_version: "v1",
        accounting_mode: "ESTIMATED",
      }).success,
    ).toBe(false);
  });
});

describe("TASK-0.2 PASS-8 can_merge 派生不变式", () => {
  it("非 PASSED 状态下 can_merge=true 被拒绝", () => {
    for (const status of ["FAILED", "BLOCKED", "STALE"] as const) {
      const ev = baseEvidence({
        verdict: { status, can_merge: true, summary: status },
      });
      const result = evidenceBundleSchema.safeParse(ev);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("can_merge");
      }
    }
  });

  it("PASSED + can_merge=false 合法（门禁未全通过）", () => {
    const ev = baseEvidence({
      verdict: { status: "PASSED", can_merge: false, summary: "pending" },
    });
    expect(evidenceBundleSchema.safeParse(ev).success).toBe(true);
  });
});

describe("TASK-0.2 PASS-9 反例与路径越界", () => {
  it("拒绝包含 ../ 的越界路径", () => {
    expect(() =>
      createContractDraft({
        title: "越界",
        description: "x",
        acceptanceCriteria: ["y"],
        writablePaths: ["../etc/passwd"],
      }),
    ).toThrow();
  });

  it("拒绝绝对路径", () => {
    expect(() =>
      createContractDraft({
        title: "绝对路径",
        description: "x",
        acceptanceCriteria: ["y"],
        writablePaths: ["/etc/passwd"],
      }),
    ).toThrow();
  });

  it("拒绝空 scope", () => {
    expect(() =>
      createContractDraft({
        title: "空范围",
        description: "x",
        acceptanceCriteria: ["y"],
        writablePaths: [],
      }),
    ).toThrow();
  });

  it("预算字段必须为整数最小货币单位", () => {
    expect(
      budgetLimitsSchema.safeParse({
        max_file_modifications: 1.5,
        max_total_diff_lines: 1,
        max_duration_seconds: 10,
        max_verification_retries: 3,
      }).success,
    ).toBe(false);
  });
});
