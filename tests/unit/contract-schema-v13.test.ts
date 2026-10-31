import { describe, expect, it } from "vitest";
import {
  FAST_PATH_CREATOR,
  LEGACY_CONTRACT_SCHEMA_VERSION_V12,
  MANDATORY_GIT_FORBIDDEN_FLAGS,
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
  SUPPORTED_CONTRACT_SCHEMA_VERSIONS,
  createContractDraft,
  gitOperationSchema,
  softwareContractSchema,
  type SoftwareContractV13,
} from "../../src/lib/contract.schema";

/**
 * TASK-0.2c / 架构 §9.1：合同 Schema v1.3.0 增量字段与不变式。
 *
 * 三类判据：
 * 1. 增量字段必填性（只对 1.3.0 合同生效）；
 * 2. 向后兼容（1.2.0 存量合同无新字段也必须可解析）；
 * 3. 非法输入拦截（枚举越界、缺强制参数、伪自动准入）。
 */

function draft(): SoftwareContractV13 {
  return createContractDraft({
    title: "TASK-0.2c Schema v1.3.0",
    description: "校验 approval 与 authorization.git 增量字段",
    acceptanceCriteria: ["schema 校验通过"],
    writablePaths: ["src/lib/contract.schema.ts"],
  });
}

function asRaw(contract: SoftwareContractV13): Record<string, unknown> {
  return JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
}

/** 取出可自由变形的 authorization.git 副本 */
function gitOf(raw: Record<string, unknown>): Record<string, unknown> {
  const authorization = raw["authorization"] as Record<string, unknown>;
  return { ...(authorization["git"] as Record<string, unknown>) };
}

function withGit(
  raw: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const authorization = raw["authorization"] as Record<string, unknown>;
  return {
    ...raw,
    authorization: {
      ...authorization,
      git: { ...(authorization["git"] as Record<string, unknown>), ...patch },
    },
  };
}

/**
 * 整体替换 git 对象（而非合并）。
 * 删除字段必须走这里：`{...base, ...patch}` 只会覆盖已有键，
 * patch 里"少一个键"并不会把 base 里的同名键删掉。
 */
function replaceGit(
  raw: Record<string, unknown>,
  git: Record<string, unknown>,
): Record<string, unknown> {
  const authorization = raw["authorization"] as Record<string, unknown>;
  return { ...raw, authorization: { ...authorization, git } };
}

/** 构造一份合法的、处于指定生命周期的 v1.3.0 合同 */
function rawAtState(
  lifecycle: "DRAFT" | "EXECUTING",
  approval: Record<string, unknown>,
): Record<string, unknown> {
  return { ...asRaw(draft()), lifecycle_state: lifecycle, approval };
}

describe("版本白名单与签发值", () => {
  it("签发 1.3.0，兼容白名单为 1.2.0 + 1.3.0", () => {
    expect(SOFTWARE_CONTRACT_SCHEMA_VERSION).toBe("1.3.2");
    expect(LEGACY_CONTRACT_SCHEMA_VERSION_V12).toBe("1.2.0");
    expect([...SUPPORTED_CONTRACT_SCHEMA_VERSIONS]).toEqual([
      "1.2.0",
      "1.3.0",
      "1.3.1",
      "1.3.2",
    ]);
    expect(draft().schema_version).toBe("1.3.2");
  });

  it("未列入白名单的版本一律拒绝（含 v1.2.1 / v1.1.3）", () => {
    for (const version of ["1.2.1", "1.1.3", "2.0.0", "1.3"]) {
      const raw = { ...asRaw(draft()), schema_version: version };
      expect(
        softwareContractSchema.safeParse(raw).success,
        `${version} 必须被拒绝`,
      ).toBe(false);
    }
  });
});

describe("authorization.git 显式授权凭证（v1.3.0 必填）", () => {
  it("新合同默认携带完整凭证", () => {
    const git = draft().authorization.git;
    expect(git.allowed_operations).toEqual([...gitOperationSchema.options]);
    expect(git.forbidden_flags).toEqual([...MANDATORY_GIT_FORBIDDEN_FLAGS]);
    expect(git.enforce_clean_base).toBe(true);
    expect(git.task_worktree_branch).toBe(git.task_branch);
  });

  it("缺少 allowed_operations / forbidden_flags / enforce_clean_base 均被拒绝", () => {
    for (const field of [
      "allowed_operations",
      "forbidden_flags",
      "enforce_clean_base",
    ]) {
      const git = gitOf(asRaw(draft()));
      delete git[field];
      const raw = replaceGit(asRaw(draft()), git);
      const result = softwareContractSchema.safeParse(raw);
      expect(result.success, `缺少 ${field} 必须被拒绝`).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) =>
            issue.message.includes(`authorization.git.${field}`),
          ),
        ).toBe(true);
      }
    }
  });

  it("禁止参数缺任何一个强制项都被拒绝（不可覆盖）", () => {
    const git = gitOf(asRaw(draft()));
    git["forbidden_flags"] = ["--force", "--hard"]; // 缺 -f / --amend / --no-verify
    const result = softwareContractSchema.safeParse(
      withGit(asRaw(draft()), git),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("missing mandatory flags"),
        ),
      ).toBe(true);
    }
  });

  it("允许在强制项之外追加自定义禁用参数", () => {
    const git = gitOf(asRaw(draft()));
    git["forbidden_flags"] = [...MANDATORY_GIT_FORBIDDEN_FLAGS, "--mirror"];
    expect(
      softwareContractSchema.safeParse(withGit(asRaw(draft()), git)).success,
    ).toBe(true);
  });

  it("allowed_operations 越界取值被拒绝", () => {
    const git = gitOf(asRaw(draft()));
    git["allowed_operations"] = ["status", "push"]; // push 不在白名单枚举内
    const result = softwareContractSchema.safeParse(
      withGit(asRaw(draft()), git),
    );
    expect(result.success).toBe(false);
  });

  it("task_worktree_branch 必须使用 task/ 前缀", () => {
    const raw = withGit(asRaw(draft()), {
      task_worktree_branch: "feature/no-prefix",
    });
    expect(softwareContractSchema.safeParse(raw).success).toBe(false);
  });
});

describe("approval 审批凭证字段", () => {
  it("APPROVED 必须同时给出 approved_by 与 approved_at", () => {
    const raw = rawAtState("EXECUTING", { status: "APPROVED" });
    const result = softwareContractSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("approved_by/approved_at"),
        ),
      ).toBe(true);
    }
  });

  it("可携带签名摘要、准入决策与决策说明", () => {
    const raw = rawAtState("EXECUTING", {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: "2026-10-23T00:00:00.000Z",
      approval_signature: "sha256:abc123",
      admitted_policy_decision: "ADMITTED_EXPLICIT_APPROVAL",
      decision_notes: "用户逐项勾选授权",
    });
    const parsed = softwareContractSchema.parse(raw);
    expect(parsed.approval.approval_signature).toBe("sha256:abc123");
    expect(parsed.approval.admitted_policy_decision).toBe(
      "ADMITTED_EXPLICIT_APPROVAL",
    );
    expect(parsed.approval.decision_notes).toContain("勾选");
  });

  it("伪自动准入被拒绝：ADMITTED_AUTOMATIC 只能由 system:fast-path 签发", () => {
    const fake = rawAtState("EXECUTING", {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: "2026-10-23T00:00:00.000Z",
      admitted_policy_decision: "ADMITTED_AUTOMATIC",
    });
    const result = softwareContractSchema.safeParse(fake);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("ADMITTED_AUTOMATIC"),
        ),
      ).toBe(true);
    }

    const legitimate = rawAtState("EXECUTING", {
      status: "APPROVED",
      approved_by: FAST_PATH_CREATOR,
      approved_at: "2026-10-23T00:00:00.000Z",
      admitted_policy_decision: "ADMITTED_AUTOMATIC",
      decision_notes: "Fast Path: 单文件低风险微调",
    });
    expect(softwareContractSchema.safeParse(legitimate).success).toBe(true);
  });

  it("非法审批枚举被拒绝（SUPERSEDED / PENDING 不属于本版本契约）", () => {
    for (const status of ["SUPERSEDED", "PENDING"]) {
      const raw = rawAtState("DRAFT", { status });
      expect(
        softwareContractSchema.safeParse(raw).success,
        `${status} 必须被拒绝`,
      ).toBe(false);
    }
  });
});

describe("向后兼容：v1.2.0 合同不带新字段仍可解析", () => {
  it("剥离全部 v1.3.0 增量字段后，1.2.0 合同通过解析且不报必填错误", () => {
    const raw = asRaw(draft());
    raw["schema_version"] = LEGACY_CONTRACT_SCHEMA_VERSION_V12;

    const git = gitOf(raw);
    delete git["allowed_operations"];
    delete git["forbidden_flags"];
    delete git["enforce_clean_base"];
    delete git["task_worktree_branch"];
    const legacy = replaceGit(raw, git);

    const result = softwareContractSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe("1.2.0");
      expect(result.data.authorization.git.allowed_operations).toBeUndefined();
    }
  });

  it("v1.2.0 合同即便缺少禁用参数也不会被追溯判定为非法", () => {
    const raw = asRaw(draft());
    raw["schema_version"] = LEGACY_CONTRACT_SCHEMA_VERSION_V12;
    const git = gitOf(raw);
    delete git["forbidden_flags"];
    delete git["allowed_operations"];
    delete git["enforce_clean_base"];
    expect(softwareContractSchema.safeParse(replaceGit(raw, git)).success).toBe(
      true,
    );
  });
});

describe("既有不变式在 v1.3.0 下继续成立", () => {
  it("UNCONTROLLED_EXTERNAL 仍不得进入执行态", () => {
    const raw = {
      ...rawAtState("EXECUTING", {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: "2026-10-23T00:00:00.000Z",
      }),
      worker_spec: {
        ...draft().worker_spec,
        control_mode: "UNCONTROLLED_EXTERNAL",
      },
    };
    expect(softwareContractSchema.safeParse(raw).success).toBe(false);
  });

  it("§9.1.1 组合矩阵：EXECUTING + PENDING_REVIEW 仍被拒绝", () => {
    const raw = rawAtState("EXECUTING", { status: "PENDING_REVIEW" });
    expect(softwareContractSchema.safeParse(raw).success).toBe(false);
  });
});

describe("v1.3.1 manual_confirmation 兜底人工确认不变式", () => {
  it("commands 为空但提供合法 manual_confirmation 时通过 Schema 解析", () => {
    const raw = asRaw(draft());
    raw["verification_spec"] = {
      commands: [],
      manual_confirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at", "reason"],
      },
    };
    const parsed = softwareContractSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("commands 为空且缺少 manual_confirmation 时被 Schema 拒绝", () => {
    const raw = asRaw(draft());
    raw["verification_spec"] = {
      commands: [],
    };
    const parsed = softwareContractSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain(
        "At least one verification command is required unless manual_confirmation is declared",
      );
    }
  });

  it("1.3.0 存量合同若携带 manual_confirmation 则被拒绝（仅限 1.3.1）", () => {
    const raw = asRaw(draft());
    raw["schema_version"] = "1.3.0";
    raw["verification_spec"] = {
      commands: [
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
      manual_confirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at", "reason"],
      },
    };
    const parsed = softwareContractSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain(
        "manual_confirmation is only allowed on schema_version 1.3.1 or 1.3.2",
      );
    }
  });

  it("capture_evidence 字段缺漏或多出均被拒绝", () => {
    const raw = asRaw(draft());
    raw["verification_spec"] = {
      commands: [],
      manual_confirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at"],
      },
    };
    expect(softwareContractSchema.safeParse(raw).success).toBe(false);

    raw["verification_spec"] = {
      commands: [],
      manual_confirmation: {
        reason_required: true,
        capture_evidence: ["actor", "confirmed_at", "reason", "extra"],
      },
    };
    expect(softwareContractSchema.safeParse(raw).success).toBe(false);
  });

  it("1.3.0 存量合同仍要求 Git 显式授权凭证", () => {
    const raw = asRaw(draft());
    raw["schema_version"] = "1.3.0";
    delete (raw["authorization"] as Record<string, Record<string, unknown>>)[
      "git"
    ]!["allowed_operations"];
    const parsed = softwareContractSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain(
        "authorization.git.allowed_operations is required for schema_version 1.3.0",
      );
    }
  });
});
