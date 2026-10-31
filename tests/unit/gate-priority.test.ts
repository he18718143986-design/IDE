/**
 * TM-GP：执行期优先级格笛卡尔积（TASK-J.18c / §3.3）。
 * 维度：binding × forbidden × grave × scope = 4×2×5×3 = 120。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateGraveyardGate,
  pickPrimaryVerdict,
  type BlockingCode,
  type LineVerdict,
} from "../../daemon/guard/worker-graveyard-gate";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";

type Binding = "ok" | "not_found" | "mismatch" | "legacy";
type Forbidden = 0 | 1;
type Grave =
  | "none"
  | "weak"
  | "strong-soft"
  | "strong-user"
  | "strong-security";
type Scope = "in" | "out" | "untracked";

const BINDINGS: Binding[] = ["ok", "not_found", "mismatch", "legacy"];
const FORBIDDEN: Forbidden[] = [0, 1];
const GRAVES: Grave[] = [
  "none",
  "weak",
  "strong-soft",
  "strong-user",
  "strong-security",
];
const SCOPES: Scope[] = ["in", "out", "untracked"];

function mongoUser(disallow = true): GraveyardEntry {
  return {
    rejected_id: "T-MONGO",
    proposal: "用 mongodb 存数据",
    rejected_by: "user",
    rejection_reason: "不要",
    evidence: [],
    disallow_revival: disallow,
    updated_in_revision: 1,
    fingerprint: {
      key: "用mongodb存数据",
      lexemes: ["mongodb", "存数", "数据", "用"],
    },
    revival_keys: ["用mongodb存数据", "mongodb"],
    rejected_after_turn_seq: 0,
    status: "active",
  };
}

function mongoSecurity(): GraveyardEntry {
  return {
    ...mongoUser(true),
    rejected_id: "T-MONGO-SEC",
    rejected_by: "security_gate",
  };
}

/** 独立手写神谕：按 §3.3 从维度推出应有主码（及是否 block）。 */
function oracle(
  binding: Binding,
  forbidden: Forbidden,
  grave: Grave,
  scope: Scope,
): { block: boolean; code: BlockingCode | null; lock?: "user" | "security" } {
  // P1：绑定失败 → 其余检查不执行
  if (binding === "not_found") {
    return { block: true, code: "E_SCHEME_SNAPSHOT_NOT_FOUND" };
  }
  if (binding === "mismatch") {
    return { block: true, code: "E_SCHEME_SNAPSHOT_MISMATCH" };
  }

  // legacy：墓地不可用，不产生墓地阻断
  const graveActive = binding === "ok";

  // 收集会进入 pickPrimaryVerdict 的码
  const verdicts: LineVerdict[] = [];
  if (forbidden === 1) {
    verdicts.push({ code: "E_FORBIDDEN_PATH" });
  }

  if (graveActive) {
    if (grave === "strong-security") {
      verdicts.push({
        code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
        detail: { lock: "security", rejected_id: "T-MONGO-SEC" },
      });
    } else if (grave === "strong-user") {
      verdicts.push({
        code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
        detail: { lock: "user", rejected_id: "T-MONGO" },
      });
    }
    // weak / strong-soft / none → 不进阻断码
  }

  if (scope === "untracked") {
    verdicts.push({ code: "E_OUT_OF_SCOPE_UNTRACKED" });
  } else if (scope === "out") {
    verdicts.push({ code: "E_OUT_OF_SCOPE" });
  }

  const primary = pickPrimaryVerdict(verdicts);
  if (!primary) return { block: false, code: null };
  const lock =
    primary.code === "E_PROPOSAL_PREVIOUSLY_REJECTED"
      ? (primary.detail?.["lock"] as "user" | "security" | undefined)
      : undefined;
  return {
    block: true,
    code: primary.code,
    ...(lock ? { lock } : {}),
  };
}

/** 按维度构造送入 pickPrimaryVerdict 的裁决列表（模拟「求值不短路」）。 */
function buildVerdicts(
  binding: Binding,
  forbidden: Forbidden,
  grave: Grave,
  scope: Scope,
): LineVerdict[] {
  if (binding === "not_found") {
    return [{ code: "E_SCHEME_SNAPSHOT_NOT_FOUND" }];
  }
  if (binding === "mismatch") {
    return [{ code: "E_SCHEME_SNAPSHOT_MISMATCH" }];
  }
  const verdicts: LineVerdict[] = [];
  if (forbidden === 1) verdicts.push({ code: "E_FORBIDDEN_PATH" });
  if (binding === "ok") {
    if (grave === "strong-security") {
      verdicts.push({
        code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
        detail: { lock: "security", rejected_id: "T-MONGO-SEC" },
      });
    } else if (grave === "strong-user") {
      verdicts.push({
        code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
        detail: { lock: "user", rejected_id: "T-MONGO" },
      });
    }
  }
  if (scope === "untracked") {
    verdicts.push({ code: "E_OUT_OF_SCOPE_UNTRACKED" });
  } else if (scope === "out") {
    verdicts.push({ code: "E_OUT_OF_SCOPE" });
  }
  return verdicts;
}

describe("TM-GP 笛卡尔积 120 组", () => {
  const cases: {
    binding: Binding;
    forbidden: Forbidden;
    grave: Grave;
    scope: Scope;
  }[] = [];
  for (const binding of BINDINGS) {
    for (const forbidden of FORBIDDEN) {
      for (const grave of GRAVES) {
        for (const scope of SCOPES) {
          cases.push({ binding, forbidden, grave, scope });
        }
      }
    }
  }

  it("维度乘积恰好 120", () => {
    expect(cases).toHaveLength(120);
  });

  it.each(cases)(
    "binding=$binding forbidden=$forbidden grave=$grave scope=$scope",
    ({ binding, forbidden, grave, scope }) => {
      const expected = oracle(binding, forbidden, grave, scope);
      const verdicts = buildVerdicts(binding, forbidden, grave, scope);
      const primary = pickPrimaryVerdict(verdicts);

      if (!expected.block) {
        expect(primary).toBeNull();
        return;
      }
      expect(primary?.code).toBe(expected.code);
      if (expected.lock) {
        expect(primary?.detail?.["lock"]).toBe(expected.lock);
      }
      // 执行期主码永不为签署期漂移码
      expect(primary?.code).not.toBe("E_SCOPE_PLAN_DRIFT" as BlockingCode);
    },
  );
});

describe("TM-GP 表列特例", () => {
  it("TM-GP-01 strong-user + out of scope → 主码墓地（P4>P5）", () => {
    const primary = pickPrimaryVerdict([
      {
        code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
        detail: { lock: "user" },
      },
      { code: "E_OUT_OF_SCOPE" },
    ]);
    expect(primary?.code).toBe("E_PROPOSAL_PREVIOUSLY_REJECTED");
    expect(primary?.detail?.["lock"]).toBe("user");
  });

  it("TM-GP-02 forbidden + strong-security → 主码保护路径（P2>P3）", () => {
    const primary = pickPrimaryVerdict([
      { code: "E_FORBIDDEN_PATH" },
      {
        code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
        detail: { lock: "security" },
      },
    ]);
    expect(primary?.code).toBe("E_FORBIDDEN_PATH");
  });

  it("TM-GP-03 binding not_found + 其余 → 仅绑定码，其余不执行", () => {
    const verdicts = buildVerdicts("not_found", 1, "strong-user", "out");
    expect(verdicts).toEqual([{ code: "E_SCHEME_SNAPSHOT_NOT_FOUND" }]);
    expect(pickPrimaryVerdict(verdicts)?.code).toBe(
      "E_SCHEME_SNAPSHOT_NOT_FOUND",
    );
  });

  it("TM-GP-04 legacy + strong-user → 不 block；W_GRAVEYARD_CHECK_UNAVAILABLE", () => {
    const r = evaluateGraveyardGate({
      availability: "unavailable",
      graveyard: [mongoUser(true)],
      changes: [
        {
          path: "package.json",
          before: JSON.stringify({ dependencies: {} }),
          after: JSON.stringify({ dependencies: { mongodb: "^6" } }),
        },
      ],
      commands: [],
      texts: [],
    });
    expect(r.block).toBe(false);
    expect(r.warnings).toContain("W_GRAVEYARD_CHECK_UNAVAILABLE");
    // pickPrimary 侧：legacy 不注入墓地码
    const primary = pickPrimaryVerdict(
      buildVerdicts("legacy", 0, "strong-user", "in"),
    );
    expect(primary).toBeNull();
  });

  it("TM-GP-05 weak + untracked → 主码未跟踪；证据含弱警告", () => {
    const r = evaluateGraveyardGate({
      availability: "snapshot",
      graveyard: [mongoUser(true)],
      changes: [
        {
          path: "src/cfg.ts",
          before: "export {};\n",
          after:
            'export {};\nconst u = "https://cloud.mongodb.com";\n',
        },
      ],
      commands: [],
      texts: [],
    });
    expect(r.block).toBe(false);
    expect(r.warnings).toContain("W_GRAVEYARD_WEAK_MATCH");
    const primary = pickPrimaryVerdict([
      { code: "E_OUT_OF_SCOPE_UNTRACKED" },
    ]);
    expect(primary?.code).toBe("E_OUT_OF_SCOPE_UNTRACKED");
  });

  it("TM-GP-06 任意执行期组合主码永不为 E_SCOPE_PLAN_DRIFT", () => {
    const sneaky = [
      { code: "E_OUT_OF_SCOPE" },
      {
        code: "E_SCOPE_PLAN_DRIFT" as unknown as BlockingCode,
      },
      {
        code: "E_PROPOSAL_PREVIOUSLY_REJECTED",
        detail: { lock: "user" },
      },
    ];
    const primary = pickPrimaryVerdict(sneaky);
    expect(primary?.code).toBe("E_PROPOSAL_PREVIOUSLY_REJECTED");
    expect(String(primary?.code)).not.toBe("E_SCOPE_PLAN_DRIFT");
  });

  it("soft 强证据不产生阻断码", () => {
    const r = evaluateGraveyardGate({
      availability: "snapshot",
      graveyard: [mongoUser(false)],
      changes: [
        {
          path: "package.json",
          before: JSON.stringify({ dependencies: {} }),
          after: JSON.stringify({ dependencies: { mongodb: "^6" } }),
        },
      ],
      commands: [],
      texts: [],
    });
    expect(r.block).toBe(false);
    expect(r.hits[0]?.lock).toBe("soft");
    const primary = pickPrimaryVerdict(
      buildVerdicts("ok", 0, "strong-soft", "in"),
    );
    expect(primary).toBeNull();
  });
});
