/**
 * TASK-J.22a：台账 → 中栏只读投影。
 * TASK-J.38b：acceptance / goals / modules 挂可选五字段视图（只读；不写盘）。
 * - 纯函数，不写盘、不修改台账、不触发封存；
 * - 无台账或无实质内容时 available=false，由前端标「方案尚未生成」；
 * - mermaid 三图不在此生成（不强交 renderSchemeDiagrams）。
 */
import type {
  SchemeDraftV2,
  SchemeItemMeta,
  SchemeItemProjectionDto,
  WithText,
} from "../../../src/lib/journey/scheme-patch-types";
import { deriveFineModelFromV2 } from "../../../src/lib/journey/fine-model-derive";
import { projectSchemeItemFiveFields } from "../../../src/lib/journey/scheme-item-projection";
import type { SchemeLedgerRecord } from "./scheme-ledger-store";

export interface SchemeMidpaneGoalView {
  id: string;
  text: string;
  status?: SchemeItemProjectionDto["status"];
  scope?: SchemeItemProjectionDto["scope"];
  provenance?: SchemeItemProjectionDto["provenance"];
  links?: SchemeItemProjectionDto["links"];
  confidence?: SchemeItemProjectionDto["confidence"];
}

export interface SchemeMidpaneModuleView {
  id: string;
  name: string;
  status?: SchemeItemProjectionDto["status"];
  scope?: SchemeItemProjectionDto["scope"];
  provenance?: SchemeItemProjectionDto["provenance"];
  links?: SchemeItemProjectionDto["links"];
  confidence?: SchemeItemProjectionDto["confidence"];
}

export interface SchemeMidpaneDecisionView {
  id: string;
  label: string;
  recommended: string;
  alternatives: string[];
  confirmed: boolean;
  source: "ai_default" | "user";
}

export interface SchemeMidpaneConflictView {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  chosenId: string | null;
}

export interface SchemeMidpaneAcceptanceView {
  id: string;
  text: string;
  status?: SchemeItemProjectionDto["status"];
  scope?: SchemeItemProjectionDto["scope"];
  provenance?: SchemeItemProjectionDto["provenance"];
  links?: SchemeItemProjectionDto["links"];
  confidence?: SchemeItemProjectionDto["confidence"];
}

export interface SchemeMidpaneProjection {
  available: boolean;
  scheme_id: string | null;
  scheme_revision: number | null;
  frozen: boolean;
  title: string;
  summary: string;
  goals: SchemeMidpaneGoalView[];
  modules: SchemeMidpaneModuleView[];
  decisions: SchemeMidpaneDecisionView[];
  conflicts: SchemeMidpaneConflictView[];
  acceptance: SchemeMidpaneAcceptanceView[];
}

const EMPTY: SchemeMidpaneProjection = {
  available: false,
  scheme_id: null,
  scheme_revision: null,
  frozen: false,
  title: "",
  summary: "",
  goals: [],
  modules: [],
  decisions: [],
  conflicts: [],
  acceptance: [],
};

function trimId(meta: SchemeItemMeta | { id?: string }): string {
  return typeof meta.id === "string" ? meta.id.trim() : "";
}

function hasMeaningfulContent(draft: SchemeDraftV2): boolean {
  if (draft.title.trim() !== "") return true;
  if (draft.summary.trim() !== "") return true;
  if (draft.goals.some((g) => g.text.trim() !== "")) return true;
  if (draft.modules.some((m) => m.name.trim() !== "")) return true;
  if (draft.acceptance.some((a) => a.text.trim() !== "")) return true;
  if (draft.decisions.length > 0) return true;
  if (draft.conflicts.length > 0) return true;
  return false;
}

function attachFiveFields(
  meta: SchemeItemMeta,
  schemeFrozen: boolean,
  fineLayer: ReturnType<typeof deriveFineModelFromV2> | null,
): SchemeItemProjectionDto {
  return projectSchemeItemFiveFields({
    meta: {
      id: meta.id,
      source: meta.source,
      evidence: meta.evidence,
      user_pinned: meta.user_pinned,
    },
    schemeFrozen,
    fineLayer,
  });
}

function withFiveFields<T extends { id: string }>(
  row: T,
  five: SchemeItemProjectionDto,
): T & SchemeItemProjectionDto {
  return { ...row, ...five };
}

export function projectSchemeMidpane(
  record: SchemeLedgerRecord | null,
): SchemeMidpaneProjection {
  if (!record) return { ...EMPTY };

  const draft = record.state.draft;
  if (!hasMeaningfulContent(draft)) {
    return {
      ...EMPTY,
      scheme_id: draft.scheme_id,
      scheme_revision: draft.scheme_revision,
      frozen: draft.frozen === true,
    };
  }

  const frozen = draft.frozen === true;
  // 可选加层源：只读派生，不落盘、不渲染六实体列表
  const fineLayer = deriveFineModelFromV2(draft);

  const seenGoal = new Set<string>();
  const goals: SchemeMidpaneGoalView[] = [];
  for (const g of draft.goals) {
    const id = trimId(g);
    const text = typeof g.text === "string" ? g.text.trim() : "";
    if (id === "" || text === "" || seenGoal.has(id)) continue;
    seenGoal.add(id);
    goals.push(
      withFiveFields({ id, text }, attachFiveFields(g, frozen, fineLayer)),
    );
  }

  const seenMod = new Set<string>();
  const modules: SchemeMidpaneModuleView[] = [];
  for (const m of draft.modules) {
    const id = trimId(m);
    const name = typeof m.name === "string" ? m.name.trim() : "";
    if (id === "" || name === "" || seenMod.has(id)) continue;
    seenMod.add(id);
    modules.push(
      withFiveFields({ id, name }, attachFiveFields(m, frozen, fineLayer)),
    );
  }

  const decisions: SchemeMidpaneDecisionView[] = draft.decisions.map((d) => {
    const confirmed =
      d.status === "accepted" || d.status === "changed" || Boolean(d.chosen);
    const source: "ai_default" | "user" =
      d.source === "user_said" ||
      d.source === "user_confirmed" ||
      d.source === "user_edited"
        ? "user"
        : "ai_default";
    return {
      id: d.id,
      label: d.question,
      recommended: d.chosen?.trim() || d.recommended,
      alternatives: [...d.alternatives],
      confirmed,
      source,
    };
  });

  const conflicts: SchemeMidpaneConflictView[] = draft.conflicts.map((c) => ({
    id: c.id,
    question: c.question,
    options: c.options.map((o) => ({ id: o.id, label: o.label })),
    chosenId: c.chosen_id,
  }));

  const seenAcc = new Set<string>();
  const acceptance: SchemeMidpaneAcceptanceView[] = [];
  for (const a of draft.acceptance) {
    const id = trimId(a);
    const text = typeof a.text === "string" ? a.text.trim() : "";
    if (id === "" || text === "" || seenAcc.has(id)) continue;
    seenAcc.add(id);
    const row: WithText = a;
    acceptance.push(
      withFiveFields({ id, text }, attachFiveFields(row, frozen, fineLayer)),
    );
  }

  return {
    available: true,
    scheme_id: draft.scheme_id,
    scheme_revision: draft.scheme_revision,
    frozen,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    goals,
    modules,
    decisions,
    conflicts,
    acceptance,
  };
}
