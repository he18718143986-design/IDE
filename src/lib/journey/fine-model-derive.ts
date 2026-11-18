/**
 * 细模型可选加层：从 SchemeDraftV2 派生 / 回写 SSOT 纯函数（TASK-J.38a）。
 *
 * 纪律（supervisor.md「细模型可选加层」+ 拆分简报 A）：
 * - SchemeDraftV2 是唯一可签执行层 SSOT；加层是内存投影，无落盘、无第二套 store
 * - 派生实体默认 ai_inferred；不得冒充 user_said
 * - 回写只改业务字段；禁止覆写 / 替换 SchemeItemMeta.source / evidence
 * - 二者不一致以 SSOT（draft）为准，并抬 projection_version
 * - 不重开 J.36：v1/V2 双形、acceptance.check/notes、SchemeItemProjectionDto 只引用
 * - 零 node:* / 零时钟 / 零网络
 */
import type {
  EvidenceItem,
  FineAcceptance,
  FineActor,
  FineModelLayer,
  FineProcess,
  FineRule,
  FineScreen,
  FineUseCase,
  ItemSource,
  SchemeDraftV2,
  SchemeItemMeta,
} from "./scheme-patch-types";

const AI: ItemSource = "ai_inferred";

function isSchemeDraftV2(input: unknown): input is SchemeDraftV2 {
  if (!input || typeof input !== "object") return false;
  const d = input as Record<string, unknown>;
  return (
    typeof d["scheme_id"] === "string" &&
    typeof d["scheme_revision"] === "number" &&
    typeof d["frozen"] === "boolean" &&
    Array.isArray(d["goals"]) &&
    Array.isArray(d["modules"]) &&
    Array.isArray(d["flows"]) &&
    Array.isArray(d["entities"]) &&
    Array.isArray(d["decisions"]) &&
    Array.isArray(d["acceptance"])
  );
}

function metaBase(
  id: string,
  revision: number,
  evidence: EvidenceItem[] = [],
): SchemeItemMeta {
  return {
    id,
    source: AI,
    evidence: evidence.map((e) =>
      e.kind === "turn"
        ? { kind: "turn", ref: { ...e.ref } }
        : { kind: "edit", ref: { ...e.ref } },
    ),
    user_pinned: false,
    updated_in_revision: revision,
  };
}

function actorId(name: string): string {
  return `fine-actor:${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * 从 SchemeDraftV2 只读派生细模型加层。
 * 非法 / 非 V2 输入返回空加层（projection_version=0），不抛、不落盘。
 */
export function deriveFineModelFromV2(draft: SchemeDraftV2): FineModelLayer {
  if (!isSchemeDraftV2(draft)) {
    return {
      projection_version: 0,
      source_scheme_id: "",
      source_scheme_revision: 0,
      actors: [],
      use_cases: [],
      processes: [],
      rules: [],
      screens: [],
      acceptance: [],
    };
  }

  const rev = draft.scheme_revision;
  const actorBag = new Map<string, { name: string; refs: string[] }>();
  for (const flow of draft.flows) {
    for (const step of flow.steps) {
      const name = step.actor?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = actorBag.get(key) ?? { name, refs: [] };
      entry.refs.push(`flow:${flow.id}`);
      actorBag.set(key, entry);
    }
  }

  const actors: FineActor[] = [...actorBag.values()].map((entry) => ({
    ...metaBase(actorId(entry.name), rev),
    name: entry.name,
    derived_from: [...new Set(entry.refs)],
  }));

  const moduleIds = draft.modules.map((m) => m.id);
  const use_cases: FineUseCase[] = draft.goals.map((g) => ({
    ...metaBase(`fine-uc:${g.id}`, rev, g.evidence),
    name: g.text,
    summary: g.text,
    goal_ids: [g.id],
    module_ids: [...moduleIds],
  }));

  const processes: FineProcess[] = draft.flows.map((f) => ({
    ...metaBase(`fine-process:${f.id}`, rev, f.evidence),
    name: f.name,
    flow_id: f.id,
    steps: f.steps.map((s) => ({
      actor: s.actor,
      action: s.action,
      ...(s.module_id ? { module_id: s.module_id } : {}),
    })),
  }));

  const rules: FineRule[] = draft.decisions.map((d) => ({
    ...metaBase(`fine-rule:${d.id}`, rev, d.evidence),
    statement: d.recommended || d.question,
    decision_id: d.id,
    risk: d.risk,
  }));

  const screens: FineScreen[] = draft.modules
    .filter((m) => m.user_visible)
    .map((m) => ({
      ...metaBase(`fine-screen:${m.id}`, rev, m.evidence),
      name: m.name,
      purpose: m.purpose,
      module_id: m.id,
    }));

  const acceptance: FineAcceptance[] = draft.acceptance.map((a) => ({
    ...metaBase(`fine-ac:${a.id}`, rev, a.evidence),
    text: a.text,
    acceptance_id: a.id,
    ...(a.check ? { check: a.check } : {}),
  }));

  return {
    projection_version: 1,
    source_scheme_id: draft.scheme_id,
    source_scheme_revision: draft.scheme_revision,
    actors,
    use_cases,
    processes,
    rules,
    screens,
    acceptance,
  };
}

export interface ApplyFineModelResult {
  draft: SchemeDraftV2;
  /** 回写后以 SSOT 为准再派生；若有冲突被丢弃则 projection_version 抬升 */
  layer: FineModelLayer;
  conflicts_resolved_by_ssot: number;
}

function cloneDraft(draft: SchemeDraftV2): SchemeDraftV2 {
  return structuredClone(draft);
}

function sameEvidence(a: EvidenceItem[], b: EvidenceItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 将加层业务字段回写 SSOT。
 * - 仅改业务字段；source / evidence 恒保留 draft 侧
 * - layer 试图改 source/evidence、或与 SSOT 业务字段冲突且无法对齐时：以 draft 为准
 * - 无落盘；返回的 layer 为回写后的内存再派生
 */
export function applyFineModelToV2(
  draft: SchemeDraftV2,
  layer: FineModelLayer,
): ApplyFineModelResult {
  if (!isSchemeDraftV2(draft)) {
    return {
      draft,
      layer: deriveFineModelFromV2(draft),
      conflicts_resolved_by_ssot: 0,
    };
  }

  const next = cloneDraft(draft);
  let conflicts = 0;

  // stale 加层（revision 对不上）：整层不写业务，仅抬版本后以 SSOT 再派生
  if (layer.source_scheme_revision !== draft.scheme_revision) {
    const resynced = deriveFineModelFromV2(next);
    return {
      draft: next,
      layer: {
        ...resynced,
        projection_version: Math.max(layer.projection_version, 1) + 1,
      },
      conflicts_resolved_by_ssot: 1,
    };
  }

  for (const screen of layer.screens) {
    const idx = next.modules.findIndex((m) => m.id === screen.module_id);
    if (idx < 0) {
      conflicts += 1;
      continue;
    }
    const mod = next.modules[idx]!;
    // 加层试图改 source / evidence → 冲突，SSOT 侧字段不动
    if (screen.source !== mod.source) {
      conflicts += 1;
    }
    if (!sameEvidence(screen.evidence, mod.evidence)) {
      conflicts += 1;
    }
    // 只改业务字段；source / evidence 等 Meta 随 ...mod 保留
    next.modules[idx] = {
      ...mod,
      name: screen.name,
      purpose: screen.purpose,
    };
  }

  for (const process of layer.processes) {
    const idx = next.flows.findIndex((f) => f.id === process.flow_id);
    if (idx < 0) {
      conflicts += 1;
      continue;
    }
    const flow = next.flows[idx]!;
    if (process.source !== flow.source) {
      conflicts += 1;
    }
    if (!sameEvidence(process.evidence, flow.evidence)) {
      conflicts += 1;
    }
    next.flows[idx] = {
      ...flow,
      name: process.name,
      steps: process.steps.map((s) => ({
        actor: s.actor,
        action: s.action,
        ...(s.module_id ? { module_id: s.module_id } : {}),
      })),
    };
  }

  for (const rule of layer.rules) {
    if (!rule.decision_id) {
      conflicts += 1;
      continue;
    }
    const idx = next.decisions.findIndex((d) => d.id === rule.decision_id);
    if (idx < 0) {
      conflicts += 1;
      continue;
    }
    const dec = next.decisions[idx]!;
    if (rule.source !== dec.source) {
      conflicts += 1;
    }
    if (!sameEvidence(rule.evidence, dec.evidence)) {
      conflicts += 1;
    }
    next.decisions[idx] = {
      ...dec,
      recommended: rule.statement,
      ...(rule.risk ? { risk: rule.risk } : {}),
    };
  }

  for (const ac of layer.acceptance) {
    const idx = next.acceptance.findIndex((a) => a.id === ac.acceptance_id);
    if (idx < 0) {
      conflicts += 1;
      continue;
    }
    const item = next.acceptance[idx]!;
    if (ac.source !== item.source) {
      conflicts += 1;
    }
    if (!sameEvidence(ac.evidence, item.evidence)) {
      conflicts += 1;
    }
    // text 可回写；check 保持 draft（只引用，不重开契约）
    next.acceptance[idx] = {
      ...item,
      text: ac.text,
    };
  }

  for (const uc of layer.use_cases) {
    for (const gid of uc.goal_ids) {
      const idx = next.goals.findIndex((g) => g.id === gid);
      if (idx < 0) {
        conflicts += 1;
        continue;
      }
      const goal = next.goals[idx]!;
      if (uc.source !== goal.source) {
        conflicts += 1;
      }
      if (!sameEvidence(uc.evidence, goal.evidence)) {
        conflicts += 1;
      }
      next.goals[idx] = {
        ...goal,
        text: uc.name || uc.summary || goal.text,
      };
    }
  }

  // actors 无独立 SSOT 集合：仅投影，不新建平行 store
  for (const actor of layer.actors) {
    if (actor.source !== AI) {
      conflicts += 1;
    }
  }

  const resynced = deriveFineModelFromV2(next);
  const bumped =
    conflicts > 0
      ? Math.max(layer.projection_version, resynced.projection_version) + 1
      : Math.max(layer.projection_version, resynced.projection_version);

  return {
    draft: next,
    layer: { ...resynced, projection_version: bumped },
    conflicts_resolved_by_ssot: conflicts,
  };
}

/** 测试 / 调用方可用来断言：加层模块不提供任何持久化入口 */
export const FINE_MODEL_PERSISTENCE = null;
