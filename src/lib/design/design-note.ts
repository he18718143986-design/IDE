/**
 * TASK-L.11 / technical-design-and-knowledge.md §2–§3：
 * DesignNote 类型、DN-1～DN-5 确定性校验、§3 二次升级判定。
 */

import { z } from "zod";
import { matchesAnyPattern } from "../scope";
import type { SoftwareContract } from "../contract.schema";
import type { ModuleEntry } from "../knowledge/modules-schema";
import { moduleEntrySchema } from "../knowledge/modules-schema";
import { isPaidSdk } from "./paid-sdk-list";

export type EscalationClass =
  | "irreversible"
  | "costs_money"
  | "security"
  | "external_service"
  | "data_deletion";

export const escalationClassSchema = z.enum([
  "irreversible",
  "costs_money",
  "security",
  "external_service",
  "data_deletion",
]);

export interface DesignDecision {
  decision_id: string;
  question: string;
  chosen: string;
  alternatives: string[];
  rationale: string;
  escalation: EscalationClass | null;
}

export interface DesignNote {
  schema_version: "1.0.0";
  contract_id: string;
  approach: string;
  touches: Array<{
    path: string;
    change: "create" | "modify" | "delete";
    why: string;
  }>;
  interfaces: Array<{
    name: string;
    kind: "http" | "type" | "event" | "cli" | "file_format" | "db_schema";
    signature: string;
    consumers: string[];
  }>;
  data_changes: Array<{
    kind: "migration" | "seed" | "destructive";
    description: string;
    reversible: boolean;
  }>;
  dependencies: Array<{ name: string; version: string; why: string }>;
  decisions: DesignDecision[];
  test_plan: Array<{
    acceptance_id: string;
    test_path: string;
    level: "unit" | "integration" | "e2e";
  }>;
  knowledge_delta: {
    modules_upsert: ModuleEntry[];
    decisions_add: string[];
    overview_changed: boolean;
  };
}

export const designDecisionSchema = z.object({
  decision_id: z.string().min(1),
  question: z.string().min(1),
  chosen: z.string().min(1),
  alternatives: z.array(z.string()),
  rationale: z.string().min(1),
  escalation: escalationClassSchema.nullable(),
});

export const designNoteSchema = z.object({
  schema_version: z.literal("1.0.0"),
  contract_id: z.string().min(1),
  approach: z.string().min(1),
  touches: z.array(
    z.object({
      path: z.string().min(1),
      change: z.enum(["create", "modify", "delete"]),
      why: z.string().min(1),
    }),
  ),
  interfaces: z.array(
    z.object({
      name: z.string().min(1),
      kind: z.enum([
        "http",
        "type",
        "event",
        "cli",
        "file_format",
        "db_schema",
      ]),
      signature: z.string().min(1),
      consumers: z.array(z.string().min(1)),
    }),
  ),
  data_changes: z.array(
    z.object({
      kind: z.enum(["migration", "seed", "destructive"]),
      description: z.string().min(1),
      reversible: z.boolean(),
    }),
  ),
  dependencies: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      why: z.string().min(1),
    }),
  ),
  decisions: z.array(designDecisionSchema),
  test_plan: z.array(
    z.object({
      acceptance_id: z.string().min(1),
      test_path: z.string().min(1),
      level: z.enum(["unit", "integration", "e2e"]),
    }),
  ),
  knowledge_delta: z.object({
    modules_upsert: z.array(moduleEntrySchema),
    decisions_add: z.array(z.string().min(1)),
    overview_changed: z.boolean(),
  }),
});

export type DnRule = "DN-1" | "DN-2" | "DN-3" | "DN-4" | "DN-5" | "DN-SCHEMA";

export type ValidateDesignNoteResult =
  | { ok: true }
  | {
      ok: false;
      code: "DESIGN_INVALID";
      rule: DnRule;
      message: string;
    };

const STAGENT_TEST_PATTERNS = ["tests/stagent/**", "tests/stagent/*"];

function isUnderStagentTests(testPath: string): boolean {
  return matchesAnyPattern(testPath, STAGENT_TEST_PATTERNS).matches;
}

/**
 * DN-1～DN-5 确定性校验。
 * DN-2 失败时仍返回 DESIGN_INVALID（由设计步骤重试 / 升级为 DESIGN_NEEDS_DEPENDENCY）。
 */
export function validateDesignNote(
  note: DesignNote,
  contract: SoftwareContract,
  modules: readonly ModuleEntry[],
): ValidateDesignNoteResult {
  const parsed = designNoteSchema.safeParse(note);
  if (!parsed.success) {
    return {
      ok: false,
      code: "DESIGN_INVALID",
      rule: "DN-SCHEMA",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  if (note.contract_id !== contract.contract_id) {
    return {
      ok: false,
      code: "DESIGN_INVALID",
      rule: "DN-SCHEMA",
      message: `contract_id mismatch: note=${note.contract_id} contract=${contract.contract_id}`,
    };
  }

  // DN-1：touches 全部落在 writable_paths
  const writable = contract.authorization.file_system_scope.writable_paths ?? [];
  for (const touch of note.touches) {
    const check = matchesAnyPattern(touch.path, writable);
    if (!check.matches) {
      return {
        ok: false,
        code: "DESIGN_INVALID",
        rule: "DN-1",
        message: `touches path out of writable_paths: ${touch.path}`,
      };
    }
  }

  // DN-2：有依赖时必须允许 dependency_changes_allowed
  if (note.dependencies.length > 0) {
    const allowed =
      contract.authorization.execution_permissions.dependency_changes_allowed ===
      true;
    if (!allowed) {
      return {
        ok: false,
        code: "DESIGN_INVALID",
        rule: "DN-2",
        message: `dependencies require dependency_changes_allowed; got ${note.dependencies
          .map((d) => d.name)
          .join(", ")}`,
      };
    }
  }

  // DN-3：auto/both 验收至少各出现一次；test_path ∈ tests/stagent/**
  const refs = contract.supervisor_metadata?.acceptance_refs ?? [];
  const autoRefs = refs.filter((r) => r.check === "auto" || r.check === "both");
  for (const ref of autoRefs) {
    const hit = note.test_plan.some((t) => t.acceptance_id === ref.id);
    if (!hit) {
      return {
        ok: false,
        code: "DESIGN_INVALID",
        rule: "DN-3",
        message: `acceptance_ref ${ref.id} (check=${ref.check}) missing from test_plan`,
      };
    }
  }
  for (const t of note.test_plan) {
    if (!isUnderStagentTests(t.test_path)) {
      return {
        ok: false,
        code: "DESIGN_INVALID",
        rule: "DN-3",
        message: `test_path must be under tests/stagent/**: ${t.test_path}`,
      };
    }
  }

  // DN-4：destructive / irreversible data_changes 必须有对应 escalation 决策
  const needsDataEscalation = note.data_changes.some(
    (d) => d.kind === "destructive" || d.reversible === false,
  );
  if (needsDataEscalation) {
    const has = note.decisions.some(
      (d) =>
        d.escalation === "data_deletion" || d.escalation === "irreversible",
    );
    if (!has) {
      return {
        ok: false,
        code: "DESIGN_INVALID",
        rule: "DN-4",
        message:
          "destructive/irreversible data_changes require escalation data_deletion or irreversible",
      };
    }
  }

  // DN-5：interfaces.consumers ⊆ modules ∪ modules_upsert
  const known = new Set<string>([
    ...modules.map((m) => m.id),
    ...note.knowledge_delta.modules_upsert.map((m) => m.id),
  ]);
  for (const iface of note.interfaces) {
    for (const consumer of iface.consumers) {
      if (!known.has(consumer)) {
        return {
          ok: false,
          code: "DESIGN_INVALID",
          rule: "DN-5",
          message: `interface ${iface.name} consumer unknown: ${consumer}`,
        };
      }
    }
  }

  return { ok: true };
}

export interface DetectedEscalation {
  class: EscalationClass;
  source: "decision" | "second_pass";
  detail: string;
  decision_id?: string;
}

export interface DetectEscalationsResult {
  /** 需要用户点头的升级项（含设计步骤已标注 + 二次判定补上的） */
  escalations: DetectedEscalation[];
  /** 二次判定为真但设计步骤未标注 */
  escalation_missed: DetectedEscalation[];
}

function decisionHasClass(
  note: DesignNote,
  cls: EscalationClass,
): boolean {
  return note.decisions.some((d) => d.escalation === cls);
}

/**
 * §3 二次判定：不靠设计步骤自觉。
 * - dependencies 命中付费 SDK → costs_money
 * - data_changes.kind === destructive → data_deletion
 * - touches 命中保护清单 → security
 * - interfaces.kind === db_schema 且存在 reversible === false 的 data_change → irreversible
 */
export function detectEscalations(
  note: DesignNote,
  protectionList: readonly string[],
  paidSdkList: readonly string[] = [],
): DetectEscalationsResult {
  const escalations: DetectedEscalation[] = [];
  const escalation_missed: DetectedEscalation[] = [];

  // 设计步骤已标注的
  for (const d of note.decisions) {
    if (d.escalation !== null) {
      escalations.push({
        class: d.escalation,
        source: "decision",
        detail: d.question,
        decision_id: d.decision_id,
      });
    }
  }

  const paidHit = note.dependencies.filter((dep) => {
    if (isPaidSdk(dep.name)) return true;
    return paidSdkList.some((p) => {
      if (p.endsWith("/*")) {
        const prefix = p.slice(0, -1); // "@aws-sdk/"
        return dep.name.startsWith(prefix) || dep.name === p.slice(0, -2);
      }
      return dep.name === p;
    });
  });
  if (paidHit.length > 0) {
    const detail = `paid sdk: ${paidHit.map((d) => d.name).join(", ")}`;
    if (!decisionHasClass(note, "costs_money")) {
      const missed: DetectedEscalation = {
        class: "costs_money",
        source: "second_pass",
        detail,
      };
      escalation_missed.push(missed);
      escalations.push(missed);
    }
  }

  const destructive = note.data_changes.filter((d) => d.kind === "destructive");
  if (destructive.length > 0) {
    const detail = destructive.map((d) => d.description).join("; ");
    if (!decisionHasClass(note, "data_deletion")) {
      const missed: DetectedEscalation = {
        class: "data_deletion",
        source: "second_pass",
        detail,
      };
      escalation_missed.push(missed);
      escalations.push(missed);
    }
  }

  if (protectionList.length > 0) {
    for (const touch of note.touches) {
      const hit = matchesAnyPattern(touch.path, [...protectionList]);
      if (hit.matches) {
        const detail = `protected touch: ${touch.path} (~${hit.matchedPattern})`;
        if (!decisionHasClass(note, "security")) {
          const missed: DetectedEscalation = {
            class: "security",
            source: "second_pass",
            detail,
          };
          escalation_missed.push(missed);
          escalations.push(missed);
        }
        break;
      }
    }
  }

  const hasDbSchema = note.interfaces.some((i) => i.kind === "db_schema");
  const hasIrreversibleData = note.data_changes.some(
    (d) => d.reversible === false,
  );
  if (hasDbSchema && hasIrreversibleData) {
    const detail = "db_schema interface with irreversible data_change";
    if (!decisionHasClass(note, "irreversible")) {
      const missed: DetectedEscalation = {
        class: "irreversible",
        source: "second_pass",
        detail,
      };
      escalation_missed.push(missed);
      escalations.push(missed);
    }
  }

  return { escalations, escalation_missed };
}

/** 默认保护路径（二次判定 security）；调用方可覆盖。 */
export const DEFAULT_DESIGN_PROTECTION_LIST: readonly string[] = [
  "**/.env*",
  "**/auth/**",
  "**/oauth/**",
  "**/crypto/**",
  "**/credentials/**",
  "**/secrets/**",
  "**/*secret*",
  "**/middleware/auth*",
];

/**
 * 把 DesignNote.test_plan 写成义务清单形态（供 obligations.json / L.4）。
 */
export function obligationsFromTestPlan(
  testPlan: DesignNote["test_plan"],
): Array<{
  acceptance_id: string;
  test_path: string;
  level: "unit" | "integration" | "e2e";
}> {
  return testPlan.map((t) => ({
    acceptance_id: t.acceptance_id,
    test_path: t.test_path,
    level: t.level,
  }));
}
