import { describe, expect, it } from "vitest";
import {
  deriveCanMerge,
  evidenceBundleSchema,
  reasonCodeSchema,
  usageSchema,
  type EvidenceBundleV11,
} from "../../src/lib/evidence.schema";

/**
 * TASK-0.2b / EvidenceBundleV11 —— 逐字段对齐 A §9.2，并锁定 can_merge 派生不变式。
 */

/** A §9.2 顶层必填字段（11 项） */
const REQUIRED_TOP_LEVEL = [
  "evidence_id",
  "contract_id",
  "generated_at",
  "usage",
  "worktree_snapshot",
  "verdict",
  "scope_audit",
  "verification_results",
  "git_info",
] as const;

/** A §9.2 顶层可选字段（3 项，均为 v1.2.0 新增） */
const OPTIONAL_TOP_LEVEL = [
  "contract_revision",
  "worker_session_id",
  "supervisor_suggestion_ids",
] as const;

/** 非 §9.2 字段：已登记的规格外扩展（Test Integrity Guard） */
const REGISTERED_EXTENSIONS = [
  "tests_modified",
  "manual_confirmation",
] as const;

function evidence(
  overrides: Partial<EvidenceBundleV11> = {},
): EvidenceBundleV11 {
  const base: EvidenceBundleV11 = {
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
  return { ...base, ...overrides };
}

function asRaw(bundle: EvidenceBundleV11): Record<string, unknown> {
  return JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>;
}

describe("字段集合对齐 A §9.2", () => {
  it("顶层字段存在且不越界（9 必填 + 3 可选 + 1 已登记扩展）", () => {
    const parsed = evidenceBundleSchema.parse(evidence());
    const keys = Object.keys(parsed);
    const allowed = new Set<string>([
      ...REQUIRED_TOP_LEVEL,
      ...OPTIONAL_TOP_LEVEL,
      ...REGISTERED_EXTENSIONS,
    ]);

    for (const field of REQUIRED_TOP_LEVEL) {
      expect(keys, `missing required field: ${field}`).toContain(field);
    }
    expect(keys.filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("三个 v1.2.0 新增字段均可缺省，也可提供", () => {
    const minimal = evidenceBundleSchema.parse(evidence());
    expect(minimal.contract_revision).toBeUndefined();
    expect(minimal.worker_session_id).toBeUndefined();
    expect(minimal.supervisor_suggestion_ids).toBeUndefined();

    const rich = evidenceBundleSchema.parse(
      evidence({
        contract_revision: 4,
        worker_session_id: "sess_worker_1",
        supervisor_suggestion_ids: ["sug_1", "sug_2"],
      }),
    );
    expect(rich.contract_revision).toBe(4);
    expect(rich.worker_session_id).toBe("sess_worker_1");
    expect(rich.supervisor_suggestion_ids).toEqual(["sug_1", "sug_2"]);
  });

  it("usage 九个字段齐全（含 reserved / cumulative / UNAVAILABLE）", () => {
    const usage = usageSchema.parse({
      input_tokens: 10,
      output_tokens: 20,
      estimated_cost_minor_units: 5,
      reported_cost_minor_units: 5,
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "UNAVAILABLE",
      limit_reached: false,
      reserved_cost_minor_units: 100,
      cumulative_cost_minor_units: 50,
    });
    expect(Object.keys(usage).sort()).toEqual(
      [
        "accounting_mode",
        "cumulative_cost_minor_units",
        "currency",
        "estimated_cost_minor_units",
        "input_tokens",
        "limit_reached",
        "output_tokens",
        "pricing_version",
        "reported_cost_minor_units",
        "reserved_cost_minor_units",
      ].sort(),
    );
  });

  it("git_info.patch_fingerprint 必填", () => {
    const raw = asRaw(evidence());
    const gitInfo = raw["git_info"] as Record<string, unknown>;
    const { patch_fingerprint: _drop, ...withoutFingerprint } = gitInfo;
    expect(withoutFingerprint).not.toHaveProperty("patch_fingerprint");
    expect(
      evidenceBundleSchema.safeParse({ ...raw, git_info: withoutFingerprint })
        .success,
    ).toBe(false);
  });
});

describe("can_merge 派生不变式（§9.2）", () => {
  it("status 非 PASSED 时 can_merge=true 全部被拒", () => {
    for (const status of ["FAILED", "BLOCKED", "STALE"] as const) {
      const result = evidenceBundleSchema.safeParse(
        evidence({ verdict: { status, can_merge: true, summary: status } }),
      );
      expect(
        result.success,
        `status ${status} must reject can_merge=true`,
      ).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.message.includes("can_merge")),
        ).toBe(true);
      }
    }
  });

  it("Scope 审计未通过时 can_merge 必须为 false", () => {
    const result = evidenceBundleSchema.safeParse(
      evidence({
        verdict: { status: "PASSED", can_merge: true, summary: "passed" },
        scope_audit: {
          passed: false,
          files_changed: [],
          forbidden_violations: [],
          budget_exhausted: false,
        },
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("scope_audit.passed"),
        ),
      ).toBe(true);
    }
  });

  it("预算熔断时 can_merge 必须为 false", () => {
    const result = evidenceBundleSchema.safeParse(
      evidence({
        scope_audit: {
          passed: true,
          files_changed: [],
          forbidden_violations: [],
          budget_exhausted: true,
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("存在强禁区违规时 can_merge 必须为 false", () => {
    const result = evidenceBundleSchema.safeParse(
      evidence({
        scope_audit: {
          passed: true,
          files_changed: [],
          forbidden_violations: [".env"],
          budget_exhausted: false,
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("PASSED + 门禁全过 + can_merge=false 合法（保守不放行）", () => {
    expect(
      evidenceBundleSchema.safeParse(
        evidence({
          verdict: { status: "PASSED", can_merge: false, summary: "hold" },
        }),
      ).success,
    ).toBe(true);
  });

  it("deriveCanMerge 与 Schema 判定完全一致", () => {
    const cases: Array<{
      input: Parameters<typeof deriveCanMerge>[0];
      expected: boolean;
    }> = [
      {
        input: {
          status: "PASSED",
          scopePassed: true,
          budgetExhausted: false,
          forbiddenViolationCount: 0,
        },
        expected: true,
      },
      {
        input: {
          status: "PASSED",
          scopePassed: true,
          budgetExhausted: false,
          forbiddenViolationCount: 1,
        },
        expected: false,
      },
      {
        input: {
          status: "PASSED",
          scopePassed: false,
          budgetExhausted: false,
          forbiddenViolationCount: 0,
        },
        expected: false,
      },
      {
        input: {
          status: "PASSED",
          scopePassed: true,
          budgetExhausted: true,
          forbiddenViolationCount: 0,
        },
        expected: false,
      },
      {
        input: {
          status: "PASSED",
          scopePassed: true,
          budgetExhausted: false,
          forbiddenViolationCount: 0,
          manualConfirmationDeclared: true,
          manualConfirmationRecord: undefined,
        },
        expected: false,
      },
      {
        input: {
          status: "PASSED",
          scopePassed: true,
          budgetExhausted: false,
          forbiddenViolationCount: 0,
          manualConfirmationDeclared: true,
          manualConfirmationRecord: {
            actor: "alice",
            confirmed_at: "2026-10-28T00:00:00Z",
            reason: "", // 空理由
          },
        },
        expected: false,
      },
      {
        input: {
          status: "PASSED",
          scopePassed: true,
          budgetExhausted: false,
          forbiddenViolationCount: 0,
          manualConfirmationDeclared: true,
          manualConfirmationRecord: {
            actor: "alice",
            confirmed_at: "2026-10-28T00:00:00Z",
            reason: "人工核实无误",
          },
        },
        expected: true,
      },
      {
        input: {
          status: "STALE",
          scopePassed: true,
          budgetExhausted: false,
          forbiddenViolationCount: 0,
        },
        expected: false,
      },
    ];

    for (const { input, expected } of cases) {
      expect(deriveCanMerge(input)).toBe(expected);
    }
  });
});

describe("reason_code 与崩溃恢复两码", () => {
  it("13 个原因码完整（含 L.3 义务/削弱四码）", () => {
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
    ]);
  });

  it("BLOCKED 证据可携带 PREPARATION_INTERRUPTED / WORKTREE_LOST", () => {
    for (const reason of [
      "PREPARATION_INTERRUPTED",
      "WORKTREE_LOST",
    ] as const) {
      expect(
        evidenceBundleSchema.safeParse(
          evidence({
            verdict: {
              status: "BLOCKED",
              can_merge: false,
              summary: reason,
              reason_code: reason,
            },
          }),
        ).success,
      ).toBe(true);
    }
  });

  it("拒绝未登记的 reason_code", () => {
    const raw = asRaw(evidence());
    const verdict = raw["verdict"] as Record<string, unknown>;
    verdict["reason_code"] = "SOMETHING_ELSE";
    expect(evidenceBundleSchema.safeParse(raw).success).toBe(false);
  });
});
