import { describe, expect, it } from "vitest";
import {
  E_MIGRATION_V13_UNSUPPORTED_VERSION,
  LEGACY_APPROVER,
  ABORTED_REJECTER,
  migrateContractToV13,
  needsV13Migration,
} from "../../src/lib/migration";
import {
  MANDATORY_GIT_FORBIDDEN_FLAGS,
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

/**
 * TASK-0.2c / 零静默授权：v1.2.0 → v1.3.0 迁移。
 *
 * 核心红线：DRAFT 与 PENDING_APPROVAL 迁移后**绝不**变成 APPROVED；
 * 仅执行态族白名单可以回填历史审批事实，且必须标明 `user:legacy`。
 */

const CREATED_AT = "2026-01-02T03:04:05.000Z";

/** 构造一份 v1.2.0 形态的原始合同（已剥离 v1.3.0 增量字段） */
function v12Raw(
  lifecycle: string,
  approval: Record<string, unknown>,
): Record<string, unknown> {
  const raw = JSON.parse(
    JSON.stringify(
      createContractDraft({
        title: "TASK-0.2c 迁移",
        description: "v1.2.0 → v1.3.0",
        acceptanceCriteria: ["迁移后通过 v1.3.0 Schema"],
        writablePaths: ["src/lib/contract.schema.ts"],
      }),
    ),
  ) as Record<string, unknown>;

  raw["schema_version"] = "1.2.0";
  raw["created_at"] = CREATED_AT;
  raw["contract_revision"] = 3;

  const authorization = raw["authorization"] as Record<string, unknown>;
  const git = authorization["git"] as Record<string, unknown>;
  delete git["allowed_operations"];
  delete git["forbidden_flags"];
  delete git["enforce_clean_base"];
  delete git["task_worktree_branch"];

  raw["lifecycle_state"] = lifecycle;
  raw["approval"] = approval;
  return raw;
}

const APPROVED_LEGACY = {
  status: "APPROVED",
  approved_by: "tina",
  approved_at: CREATED_AT,
  approved_revision: 3,
};

describe("needsV13Migration", () => {
  it("只识别 1.2.0", () => {
    expect(needsV13Migration({ schema_version: "1.2.0" })).toBe(true);
    expect(needsV13Migration({ schema_version: "1.3.1" })).toBe(false);
    expect(needsV13Migration({ schema_version: "1.3.0" })).toBe(false);
    expect(needsV13Migration({ schema_version: "1.1.3" })).toBe(false);
    expect(needsV13Migration(null)).toBe(false);
  });
});

describe("零静默授权：草案与待审态绝不自动批准", () => {
  it("DRAFT 迁移后仍是 DRAFT，并标记需要重新授权", () => {
    const result = migrateContractToV13(v12Raw("DRAFT", { status: "DRAFT" }));

    expect(result.contract.approval.status).toBe("DRAFT");
    expect(result.contract.approval.status).not.toBe("APPROVED");
    expect(result.contract.approval.approved_by).toBeUndefined();
    expect(result.requiresReapproval).toBe(true);
  });

  it("PENDING_APPROVAL 迁移后仍是 PENDING_REVIEW", () => {
    const result = migrateContractToV13(
      v12Raw("PENDING_APPROVAL", { status: "PENDING_REVIEW" }),
    );

    expect(result.contract.approval.status).toBe("PENDING_REVIEW");
    expect(result.contract.approval.status).not.toBe("APPROVED");
    expect(result.contract.approval.approved_by).toBeUndefined();
    expect(result.requiresReapproval).toBe(true);
  });

  it("即便脏数据把 DRAFT 标成 APPROVED，也会被拉回 DRAFT", () => {
    const result = migrateContractToV13(
      v12Raw("DRAFT", {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: CREATED_AT,
      }),
    );
    expect(result.contract.approval.status).toBe("DRAFT");
    expect(result.requiresReapproval).toBe(true);
  });
});

describe("执行态族白名单：回填历史审批事实", () => {
  const whitelist = [
    "PREPARING",
    "EXECUTING",
    "VERIFYING",
    "PENDING_RESUME",
    "AUDITED",
    "MERGED",
  ] as const;

  it.each(whitelist)("%s 迁移后为 APPROVED 且带 user:legacy 凭证", (state) => {
    const result = migrateContractToV13(v12Raw(state, { status: "APPROVED" }));

    expect(result.contract.approval.status).toBe("APPROVED");
    // 原本没有审批人的脏数据才回填 user:legacy
    expect(result.contract.approval.approved_by).toBe(LEGACY_APPROVER);
    expect(result.contract.approval.approved_at).toBe(CREATED_AT);
    expect(result.contract.approval.approved_revision).toBe(3);
    expect(result.requiresReapproval).toBe(false);
    expect(result.changedFields).toContain("approval.approved_by");
  });

  it("已有真实审批人时保留，不被 user:legacy 覆盖", () => {
    const result = migrateContractToV13(v12Raw("EXECUTING", APPROVED_LEGACY));
    expect(result.contract.approval.approved_by).toBe("tina");
    expect(result.changedFields).not.toContain("approval.approved_by");
  });
});

describe("ABORTED 终止态：保留历史，不伪造驳回", () => {
  it("未批准即终止 → REJECTED + system:aborted，终止原因保留", () => {
    const result = migrateContractToV13(
      v12Raw("ABORTED", {
        status: "REJECTED",
        rejection_reason: "用户放弃本轮修改",
      }),
    );

    expect(result.contract.approval.status).toBe("REJECTED");
    expect(result.contract.approval.rejected_by).toBe(ABORTED_REJECTER);
    expect(result.contract.approval.rejection_reason).toBe("用户放弃本轮修改");
  });

  it("已批准后安全中止 → 保留 APPROVED，不改写成 REJECTED", () => {
    const result = migrateContractToV13(
      v12Raw("ABORTED", { ...APPROVED_LEGACY }),
    );
    expect(result.contract.approval.status).toBe("APPROVED");
    expect(result.contract.approval.rejected_by).toBeUndefined();
  });
});

describe("authorization.git 授权凭证回填", () => {
  it("补齐白名单、强制禁用参数与干净基线检查", () => {
    const result = migrateContractToV13(v12Raw("DRAFT", { status: "DRAFT" }));
    const git = result.contract.authorization.git;

    expect(git.allowed_operations).toEqual([
      "status",
      "diff",
      "add",
      "commit",
      "checkout",
      "branch",
      "merge",
    ]);
    expect(git.forbidden_flags).toEqual([...MANDATORY_GIT_FORBIDDEN_FLAGS]);
    expect(git.enforce_clean_base).toBe(true);
    expect(git.task_worktree_branch).toBe(git.task_branch);
  });

  it("已存在的禁用参数只增不减（缺项被补上，自定义项保留）", () => {
    const raw = v12Raw("DRAFT", { status: "DRAFT" });
    const authorization = raw["authorization"] as Record<string, unknown>;
    const git = authorization["git"] as Record<string, unknown>;
    git["forbidden_flags"] = ["--force", "--mirror"];
    git["enforce_clean_base"] = false;

    const result = migrateContractToV13(raw);
    const migrated = result.contract.authorization.git;

    expect(migrated.forbidden_flags).toContain("--mirror");
    for (const flag of MANDATORY_GIT_FORBIDDEN_FLAGS) {
      expect(migrated.forbidden_flags).toContain(flag);
    }
    // 用户显式设过 false 时不被改写，保留原意
    expect(migrated.enforce_clean_base).toBe(false);
  });
});

describe("版本与失败路径", () => {
  it("迁移后版本为 1.3.0，且能通过 v1.3.0 Schema", () => {
    const result = migrateContractToV13(v12Raw("DRAFT", { status: "DRAFT" }));
    expect(result.from).toBe("1.2.0");
    expect(result.to).toBe(SOFTWARE_CONTRACT_SCHEMA_VERSION);
    expect(result.contract.schema_version).toBe("1.3.2");
    expect(softwareContractSchema.parse(result.contract).schema_version).toBe(
      "1.3.2",
    );
  });

  it("v1.1.3 必须先走 migrateV113Contract，错误信息给出指引", () => {
    expect(() =>
      migrateContractToV13({ schema_version: "1.1.3" }),
    ).toThrowError(E_MIGRATION_V13_UNSUPPORTED_VERSION);
    try {
      migrateContractToV13({ schema_version: "1.1.3" });
    } catch (err) {
      expect((err as Error).message).toContain("migrateV113Contract first");
    }
  });

  it("已是 1.3.0 或非对象一律拒绝", () => {
    expect(() =>
      migrateContractToV13({ schema_version: "1.3.0" }),
    ).toThrowError(E_MIGRATION_V13_UNSUPPORTED_VERSION);
    expect(() => migrateContractToV13(null)).toThrow();
    expect(() => migrateContractToV13([])).toThrow();
  });

  it("未知 lifecycle_state 被拒绝，不猜测映射", () => {
    expect(() =>
      migrateContractToV13(v12Raw("MERGING", { status: "APPROVED" })),
    ).toThrowError(/unknown lifecycle_state/);
  });
});
