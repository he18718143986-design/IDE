/**
 * TASK-L.11 / technical-design TD-01～TD-05：DesignNote 校验与二次升级判定。
 */
import { describe, expect, it } from "vitest";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  detectEscalations,
  validateDesignNote,
  type DesignNote,
} from "../../src/lib/design/design-note";
import { PAID_SDK_LIST } from "../../src/lib/design/paid-sdk-list";
import type { ModuleEntry } from "../../src/lib/knowledge/modules-schema";

function makeContract(over: {
  writablePaths?: string[];
  dependencyChangesAllowed?: boolean;
  acceptanceRefs?: Array<{
    id: string;
    text: string;
    check: "auto" | "playtest" | "both";
  }>;
} = {}): SoftwareContract {
  const refs = over.acceptanceRefs ?? [
    { id: "ac-1", text: "能跑通", check: "auto" as const },
  ];
  const draft = createContractDraft({
    title: "L.11 unit",
    description: "design note validation",
    acceptanceCriteria: refs.map((r) => r.text),
    writablePaths: over.writablePaths ?? ["src/**", "tests/stagent/**"],
    supervisorMetadata: {
      suggestion_id: "scheme:l11",
      acceptance_refs: refs,
      scheme_item_ids: refs.map((r) => r.id),
      stub_id: null,
    },
  });
  const parsed = softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });
  if (over.dependencyChangesAllowed !== undefined) {
    return {
      ...parsed,
      authorization: {
        ...parsed.authorization,
        execution_permissions: {
          ...parsed.authorization.execution_permissions,
          dependency_changes_allowed: over.dependencyChangesAllowed,
        },
      },
    };
  }
  return parsed;
}

function baseNote(
  contract: SoftwareContract,
  over: Partial<DesignNote> = {},
): DesignNote {
  const refs = contract.supervisor_metadata?.acceptance_refs ?? [];
  const autoRefs = refs.filter((r) => r.check === "auto" || r.check === "both");
  return {
    schema_version: "1.0.0",
    contract_id: contract.contract_id,
    approach: "按合同做最小改动。",
    touches: [{ path: "src/a.ts", change: "modify", why: "实现" }],
    interfaces: [],
    data_changes: [],
    dependencies: [],
    decisions: [],
    test_plan: autoRefs.map((r) => ({
      acceptance_id: r.id,
      test_path: `tests/stagent/${r.id}.test.ts`,
      level: "unit" as const,
    })),
    knowledge_delta: {
      modules_upsert: [],
      decisions_add: [],
      overview_changed: false,
    },
    ...over,
  };
}

const modules: ModuleEntry[] = [
  {
    id: "auth",
    name: "Auth",
    purpose: "登录",
    paths: ["src/auth/**"],
    depends_on: [],
    interfaces: [],
    introduced_by: "c-bootstrap",
    updated_by: [],
  },
];

describe("TASK-L.11 DesignNote TD-01～TD-05", () => {
  it("TD-01: touches 含合同范围外路径 → DESIGN_INVALID（DN-1）", () => {
    const contract = makeContract({ writablePaths: ["src/**"] });
    const note = baseNote(contract, {
      touches: [
        { path: "secrets/token.json", change: "modify", why: "越权" },
      ],
    });
    const r = validateDesignNote(note, contract, modules);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("DESIGN_INVALID");
      expect(r.rule).toBe("DN-1");
    }
  });

  it("TD-02: 新增依赖但合同不允许 → DESIGN_INVALID（DN-2）", () => {
    const contract = makeContract({ dependencyChangesAllowed: false });
    const note = baseNote(contract, {
      dependencies: [{ name: "lodash", version: "4.17.21", why: "工具" }],
    });
    const r = validateDesignNote(note, contract, modules);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("DESIGN_INVALID");
      expect(r.rule).toBe("DN-2");
    }
  });

  it("TD-03: check:auto 验收未进 test_plan → DESIGN_INVALID（DN-3）", () => {
    const contract = makeContract({
      acceptanceRefs: [
        { id: "ac-login", text: "登录", check: "auto" },
        { id: "ac-play", text: "手测", check: "playtest" },
      ],
    });
    const note = baseNote(contract, {
      test_plan: [], // 故意漏掉 ac-login
    });
    const r = validateDesignNote(note, contract, modules);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rule).toBe("DN-3");
      expect(r.message).toContain("ac-login");
    }
  });

  it("TD-04: destructive 数据变更但无 escalation → DESIGN_INVALID（DN-4）", () => {
    const contract = makeContract();
    const note = baseNote(contract, {
      data_changes: [
        {
          kind: "destructive",
          description: "清空旧表",
          reversible: false,
        },
      ],
      decisions: [],
    });
    const r = validateDesignNote(note, contract, modules);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rule).toBe("DN-4");
    }
  });

  it("TD-05: 未标注但依赖命中付费 SDK → costs_money + escalation_missed", () => {
    const contract = makeContract({ dependencyChangesAllowed: true });
    const note = baseNote(contract, {
      dependencies: [
        { name: "stripe", version: "14.0.0", why: "收款" },
      ],
      decisions: [],
    });
    const v = validateDesignNote(note, contract, modules);
    expect(v.ok).toBe(true);
    const detected = detectEscalations(note, [], PAID_SDK_LIST);
    expect(detected.escalations.some((e) => e.class === "costs_money")).toBe(
      true,
    );
    expect(
      detected.escalation_missed.some(
        (e) => e.class === "costs_money" && e.source === "second_pass",
      ),
    ).toBe(true);
  });
});
