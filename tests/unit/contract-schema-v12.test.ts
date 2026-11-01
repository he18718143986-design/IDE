import { describe, expect, it } from "vitest";
import {
  SOFTWARE_CONTRACT_SCHEMA_VERSION,
  bumpContractRevision,
  conversationRefSchema,
  createContractDraft,
  creatorSchema,
  maturityAssessmentSchema,
  runtimeKindSchema,
  softwareContractSchema,
  supervisorMetadataSchema,
  workerControlModeSchema,
  workerSpecSchema,
  type SoftwareContractV12,
} from "../../src/lib/contract.schema";

/**
 * TASK-0.2b / Schema v1.2.0 —— 逐字段对齐 A §9.1。
 * 判据：字段集合、必填/可选性、枚举取值、以及 §9.1 的三条 Schema 不变式。
 */

/** A §9.1 顶层必填字段（11 项） */
const REQUIRED_TOP_LEVEL = [
  "contract_id",
  "schema_version",
  "contract_revision",
  "created_at",
  "creator",
  "worker_spec",
  "lifecycle_state",
  "intent",
  "authorization",
  "verification_spec",
  "approval",
] as const;

/** A §9.1 顶层可选字段（2 项） */
const OPTIONAL_TOP_LEVEL = ["conversation_ref", "supervisor_metadata"] as const;

function draft(
  overrides: Partial<Parameters<typeof createContractDraft>[0]> = {},
): SoftwareContractV12 {
  return createContractDraft({
    title: "TASK-0.2b 契约测试",
    description: "用于校验 v1.2.0 Schema 字段完整性",
    acceptanceCriteria: ["npm run typecheck 通过"],
    writablePaths: ["src/lib/example.ts"],
    ...overrides,
  });
}

/** 把合同降级为 plain object 以便删除字段 */
function asRaw(contract: SoftwareContractV12): Record<string, unknown> {
  return JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
}

describe("Schema 版本与字段集合", () => {
  it("签发版本为 1.3.0，存量 1.2.0 仍可解析，拒绝 1.1.3 / 1.2.1", () => {
    // TASK-0.2c 期望变更 1/2：签发版本由 1.2.0 升至 1.3.0（架构 §9.1）。
    // 断言从"锁定单值"改为"签发值 + 兼容白名单"，否则无法同时表达
    // 「新合同一律 1.3.0」与「存量 1.2.0 继续可读」两个要求。
    expect(SOFTWARE_CONTRACT_SCHEMA_VERSION).toBe("1.3.2");
    expect(draft().schema_version).toBe("1.3.2");

    expect(
      softwareContractSchema.safeParse({
        ...asRaw(draft()),
        schema_version: "1.2.0",
      }).success,
      "v1.2.0 存量合同必须继续通过解析",
    ).toBe(true);

    for (const legacy of ["1.1.3", "1.2.1", "1.0.0"]) {
      const raw = { ...asRaw(draft()), schema_version: legacy };
      expect(softwareContractSchema.safeParse(raw).success).toBe(false);
    }
  });

  it("顶层字段集合与 A §9.1 完全一致（11 必填 + 2 可选）", () => {
    const parsed = softwareContractSchema.parse(draft());
    const keys = Object.keys(parsed);

    // 必填字段必须全部产出
    for (const field of REQUIRED_TOP_LEVEL) {
      expect(keys, `missing required field: ${field}`).toContain(field);
    }
    // 不允许出现 A §9.1 之外的顶层字段
    const allowed = new Set<string>([
      ...REQUIRED_TOP_LEVEL,
      ...OPTIONAL_TOP_LEVEL,
    ]);
    const extra = keys.filter((k) => !allowed.has(k));
    expect(extra, `unexpected top-level fields: ${extra.join(", ")}`).toEqual(
      [],
    );
  });

  it("两个可选字段可缺省，也可按 A §9.1 结构提供", () => {
    const minimal = draft();
    expect(minimal.conversation_ref).toBeUndefined();
    expect(minimal.supervisor_metadata).toBeUndefined();

    const rich = draft({
      creator: "supervisor",
      conversationRef: {
        session_id: "sess_1",
        message_ids: ["m1", "m2"],
        context_policy: "USER_SELECTED",
      },
      supervisorMetadata: {
        suggestion_id: "sug_1",
        maturity_assessment: {
          score: 0.82,
          rationale: ["scope 已收敛"],
          unresolved_questions: ["是否需要新增依赖？"],
          model_id: "supervisor-model",
          assessed_at: new Date().toISOString(),
        },
        suggested_scope: {
          writable_paths: ["src/lib/example.ts"],
          readonly_paths: ["README.md"],
          strictly_forbidden_paths: [".env*"],
        },
      },
    });

    expect(rich.creator).toBe("supervisor");
    expect(rich.conversation_ref?.context_policy).toBe("USER_SELECTED");
    expect(rich.supervisor_metadata?.suggested_scope?.readonly_paths).toEqual([
      "README.md",
    ]);
  });
});

describe("contract_revision（v1.2.0 新增）", () => {
  it("必填、整数、从 1 起", () => {
    const base = asRaw(draft());

    expect(softwareContractSchema.safeParse(base).success).toBe(true);

    const { contract_revision: _omit, ...missing } = base;
    expect(missing).not.toHaveProperty("contract_revision");
    expect(softwareContractSchema.safeParse(missing).success).toBe(false);

    expect(
      softwareContractSchema.safeParse({ ...base, contract_revision: 0 })
        .success,
    ).toBe(false);
    expect(
      softwareContractSchema.safeParse({ ...base, contract_revision: 1.5 })
        .success,
    ).toBe(false);
  });

  it("bumpContractRevision 递增版本并强制重新审批", () => {
    const approved: SoftwareContractV12 = {
      ...draft(),
      contract_revision: 3,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
        approved_revision: 3,
      },
    };

    const bumped = bumpContractRevision(approved);
    expect(bumped.contract_revision).toBe(4);
    expect(bumped.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(bumped.approval.status).toBe("PENDING_REVIEW");
    // 旧审批事实必须被清空，不能带进新版本
    expect(bumped.approval.approved_by).toBeUndefined();
    expect(bumped.approval.approved_revision).toBeUndefined();
  });
});

describe("creator 枚举对齐 ADR-007 双 Agent 术语", () => {
  it("允许 user / supervisor / system:fast-path", () => {
    // TASK-0.2c 期望变更 2/2：§9.1 与 §0.2.3.1 要求支持 Fast Path 系统签发，
    // 故枚举增加 system:fast-path；tech_lead 仍属废止项。
    expect(creatorSchema.options).toEqual([
      "user",
      "supervisor",
      "system:fast-path",
    ]);
  });

  it("拒绝已废止的 tech_lead", () => {
    expect(creatorSchema.safeParse("tech_lead").success).toBe(false);
    const raw = { ...asRaw(draft()), creator: "tech_lead" };
    expect(softwareContractSchema.safeParse(raw).success).toBe(false);
  });
});

describe("worker_spec（v1.2.0 新增，必填）", () => {
  it("五个字段与 A §9.1 一致", () => {
    // 断言 Schema 形状（含可选字段），而非某个实例的键集合
    // TASK-W.5c-i：新增 billing_model / verified_on 两可选键（缺省不写），
    // 既有四必需键语义不变。
    expect(Object.keys(workerSpecSchema.shape).sort()).toEqual(
      [
        "adapter_id",
        "adapter_version",
        "control_mode",
        "runtime_kind",
        "model_id",
        "billing_model",
        "verified_on",
      ].sort(),
    );
    // 实例必须含四个必填字段
    const spec = draft().worker_spec;
    expect(Object.keys(spec).sort()).toEqual(
      ["adapter_id", "adapter_version", "control_mode", "runtime_kind"].sort(),
    );
  });

  it("枚举取值严格受限", () => {
    expect(runtimeKindSchema.options).toEqual([
      "MANAGED_TOOL_CALLING",
      "EXTERNAL_CLI",
    ]);
    // TASK-W.5c-i：control_mode 由二值扩为三值（新增 SANDBOX_ENFORCED），
    // 与 daemon/worker/worker-adapter.interface.ts::AdapterControlMode 同步。
    expect(workerControlModeSchema.options).toEqual([
      "GATEWAY_ENFORCED",
      "SANDBOX_ENFORCED",
      "UNCONTROLLED_EXTERNAL",
    ]);
  });

  it("缺失 worker_spec 时整份合同被拒绝（必填）", () => {
    const raw = asRaw(draft());
    delete raw["worker_spec"];
    expect(softwareContractSchema.safeParse(raw).success).toBe(false);
  });

  it("adapter_id / adapter_version 不得为空串", () => {
    const base = draft().worker_spec;
    expect(
      workerSpecSchema.safeParse({ ...base, adapter_id: "" }).success,
    ).toBe(false);
    expect(
      workerSpecSchema.safeParse({ ...base, adapter_version: "" }).success,
    ).toBe(false);
  });

  it("§9.1 不变式：UNCONTROLLED_EXTERNAL 不得进入合同执行状态", () => {
    for (const state of [
      "PREPARING",
      "EXECUTING",
      "VERIFYING",
      "PENDING_RESUME",
      "AUDITED",
      "MERGED",
    ] as const) {
      const raw = {
        ...asRaw(draft()),
        worker_spec: {
          ...draft().worker_spec,
          control_mode: "UNCONTROLLED_EXTERNAL",
        },
        lifecycle_state: state,
        approval: {
          status: "APPROVED",
          approved_by: "tina",
          approved_at: new Date().toISOString(),
        },
      };
      const result = softwareContractSchema.safeParse(raw);
      expect(result.success, `state ${state} must be rejected`).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) =>
            i.message.includes("UNCONTROLLED_EXTERNAL"),
          ),
        ).toBe(true);
      }
    }
  });

  it("UNCONTROLLED_EXTERNAL 停留在 DRAFT 仍然合法", () => {
    const raw = {
      ...asRaw(draft()),
      worker_spec: {
        ...draft().worker_spec,
        control_mode: "UNCONTROLLED_EXTERNAL",
      },
    };
    expect(softwareContractSchema.safeParse(raw).success).toBe(true);
  });
});

describe("conversation_ref / supervisor_metadata 结构", () => {
  it("context_policy 三值枚举", () => {
    for (const policy of [
      "USER_SELECTED",
      "SESSION_SUMMARY",
      "NO_TRANSCRIPT",
    ] as const) {
      expect(
        conversationRefSchema.safeParse({
          session_id: "s",
          message_ids: [],
          context_policy: policy,
        }).success,
      ).toBe(true);
    }
    expect(
      conversationRefSchema.safeParse({
        session_id: "s",
        message_ids: [],
        context_policy: "FULL_TRANSCRIPT",
      }).success,
    ).toBe(false);
  });

  it("suggestion_id 必填", () => {
    expect(
      supervisorMetadataSchema.safeParse({ suggested_scope: undefined })
        .success,
    ).toBe(false);
    expect(
      supervisorMetadataSchema.safeParse({ suggestion_id: "s" }).success,
    ).toBe(true);
  });

  it("maturity_assessment 的 score 为可选，允许缺省", () => {
    const withoutScore = {
      rationale: ["ok"],
      unresolved_questions: [],
      assessed_at: new Date().toISOString(),
    };
    expect(maturityAssessmentSchema.safeParse(withoutScore).success).toBe(true);
    expect(
      maturityAssessmentSchema.safeParse({ ...withoutScore, score: 0 }).success,
    ).toBe(true);
  });
});

describe("§9.1 不变式三：成熟度分数禁止作为授权门禁", () => {
  it("score 高低不影响合同合法性与审批状态", () => {
    const build = (score: number): SoftwareContractV12 =>
      draft({
        supervisorMetadata: {
          suggestion_id: "sug",
          maturity_assessment: {
            score,
            rationale: ["r"],
            unresolved_questions: [],
            assessed_at: new Date().toISOString(),
          },
        },
      });

    const low = build(0);
    const high = build(100);

    expect(low.lifecycle_state).toBe(high.lifecycle_state);
    expect(low.approval.status).toBe(high.approval.status);
    expect(low.contract_revision).toBe(high.contract_revision);
    // 极低分不得导致拒绝；极高分不得导致自动批准
    expect(softwareContractSchema.safeParse(low).success).toBe(true);
    expect(softwareContractSchema.safeParse(high).success).toBe(true);
    expect(high.approval.status).not.toBe("APPROVED");
  });
});

describe("approval.approved_revision（防 TOCTOU）", () => {
  it("可携带，且为可选", () => {
    const withRevision = {
      ...asRaw(draft()),
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
        approved_revision: 1,
      },
    };
    const parsed = softwareContractSchema.parse(withRevision);
    expect(parsed.approval.approved_revision).toBe(1);

    const without = {
      ...asRaw(draft()),
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
      },
    };
    expect(softwareContractSchema.safeParse(without).success).toBe(true);
  });
});

describe("§9.1.1 组合矩阵在 Schema 层生效", () => {
  it("EXECUTING + PENDING_REVIEW 被拒绝", () => {
    const raw = {
      ...asRaw(draft()),
      lifecycle_state: "EXECUTING",
      approval: { status: "PENDING_REVIEW" },
    };
    const result = softwareContractSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "Illegal state combination",
      );
    }
  });

  it("ABORTED + APPROVED 合法；ABORTED + DRAFT 非法", () => {
    const ok = {
      ...asRaw(draft()),
      lifecycle_state: "ABORTED",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
      },
    };
    expect(softwareContractSchema.safeParse(ok).success).toBe(true);

    const bad = {
      ...asRaw(draft()),
      lifecycle_state: "ABORTED",
      approval: { status: "DRAFT" },
    };
    expect(softwareContractSchema.safeParse(bad).success).toBe(false);
  });
});
