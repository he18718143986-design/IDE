/**
 * TASK-J.38d / V-07：由 SchemeDraftV2 确定性生成三图（mermaid 源码）。
 *
 * - 唯一权威输入：SchemeDraftV2（modules→脑图、flows→泳道、entities→概念图）
 * - FineModelLayer 仅在 scheme_id/revision 对齐时作可选提示注释，不替换 SSOT 节点
 * - 无 I/O、无第二套图存储；空集合 → 对应图为空串（空态合法）
 * - 不得读取 / 改写快照内 v1 scheme
 */
import type {
  FineModelLayer,
  SchemeDraftV2,
} from "@/lib/journey/scheme-patch-types";

export type SchemeDiagrams = {
  /** 业务功能脑图（modules） */
  mindmap: string;
  /** 用户旅程泳道（flows） */
  swimlane: string;
  /** 业务概念图（entities） */
  concept: string;
};

export type RenderSchemeDiagramsInput = {
  draft: SchemeDraftV2;
  fine?: FineModelLayer | null;
};

/** 空态：三图皆空串 */
export const EMPTY_SCHEME_DIAGRAMS: SchemeDiagrams = {
  mindmap: "",
  swimlane: "",
  concept: "",
};

function isFineAligned(
  draft: SchemeDraftV2,
  fine: FineModelLayer | null | undefined,
): fine is FineModelLayer {
  return (
    fine != null &&
    fine.source_scheme_id === draft.scheme_id &&
    fine.source_scheme_revision === draft.scheme_revision
  );
}

/** mermaid 节点标签：去控制字符、压缩空白、截断过长 */
function label(raw: string, max = 48): string {
  const cleaned = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["[\]]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (cleaned.length <= max) return cleaned || "（未命名）";
  return `${cleaned.slice(0, max - 1)}…`;
}

/** mermaid 安全 id：字母数字与下划线 */
function nodeId(prefix: string, raw: string, index: number): string {
  const base = raw
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return `${prefix}_${index}_${base || "n"}`;
}

function renderMindmap(
  draft: SchemeDraftV2,
  fineAligned: boolean,
  fine: FineModelLayer | null,
): string {
  const modules = draft.modules.filter((m) => m.name.trim().length > 0);
  if (modules.length === 0) return "";

  const root = label(draft.title || "业务功能");
  const lines: string[] = ["mindmap", `  root((${root}))`];
  for (const [i, m] of modules.entries()) {
    lines.push(`    ${label(m.name)}`);
    if (fineAligned && fine) {
      const hints = fine.use_cases
        .filter((uc) => uc.module_ids.includes(m.id))
        .map((uc) => uc.name.trim())
        .filter(Boolean);
      for (const h of hints.slice(0, 3)) {
        lines.push(`      ${label(`建议·${h}`)}`);
      }
    }
    void i;
  }
  return lines.join("\n");
}

function renderSwimlane(
  draft: SchemeDraftV2,
  fineAligned: boolean,
  fine: FineModelLayer | null,
): string {
  const flows = draft.flows.filter((f) => f.name.trim().length > 0);
  if (flows.length === 0) return "";

  const lines: string[] = ["flowchart TB"];
  for (const [fi, f] of flows.entries()) {
    const flowNode = nodeId("F", f.id || f.name, fi);
    lines.push(`  subgraph ${flowNode}["${label(f.name)}"]`);
    if (f.steps.length === 0) {
      lines.push(`    ${flowNode}_s0["${label("（无步骤）")}"]`);
    } else {
      let prev: string | null = null;
      for (const [si, step] of f.steps.entries()) {
        const sid = `${flowNode}_s${si}`;
        const text = label(
          `${step.actor.trim() || "角色"}：${step.action || "（动作）"}`,
        );
        lines.push(`    ${sid}["${text}"]`);
        if (prev) lines.push(`    ${prev} --> ${sid}`);
        prev = sid;
      }
    }
    lines.push("  end");
  }

  if (fineAligned && fine) {
    for (const [pi, p] of fine.processes.slice(0, 2).entries()) {
      const name = p.name.trim();
      if (!name) continue;
      const hid = nodeId("HINTP", p.id || name, pi);
      lines.push(`  ${hid}[["建议·${label(name)}"]]`);
    }
  }

  return lines.join("\n");
}

function renderConcept(
  draft: SchemeDraftV2,
  fineAligned: boolean,
  fine: FineModelLayer | null,
): string {
  const entities = draft.entities.filter((e) => e.name.trim().length > 0);
  if (entities.length === 0) return "";

  const lines: string[] = ["erDiagram"];
  for (const [i, e] of entities.entries()) {
    const id = nodeId("E", e.id || e.name, i);
    const fields = e.fields_hint
      .map((f) => f.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (fields.length === 0) {
      lines.push(`  ${id} {`);
      lines.push(`    string name "${label(e.name)}"`);
      lines.push("  }");
    } else {
      lines.push(`  ${id} {`);
      lines.push(`    string name "${label(e.name)}"`);
      for (const [fi, field] of fields.entries()) {
        lines.push(`    string f${fi} "${label(field, 32)}"`);
      }
      lines.push("  }");
    }
  }

  // 相邻实体弱关联（确定性：按顺序串起来），便于概念图可读
  for (let i = 0; i < entities.length - 1; i += 1) {
    const a = nodeId("E", entities[i]!.id || entities[i]!.name, i);
    const b = nodeId("E", entities[i + 1]!.id || entities[i + 1]!.name, i + 1);
    lines.push(`  ${a} ||--o{ ${b} : relates`);
  }

  if (fineAligned && fine) {
    for (const rule of fine.rules.slice(0, 2)) {
      const stmt = rule.statement.trim();
      if (!stmt) continue;
      // erDiagram 无注释节点；以虚拟实体承载提示，不覆盖 SSOT 实体
      const rid = nodeId("HINT", rule.id || stmt, 0);
      lines.push(`  ${rid} {`);
      lines.push(`    string hint "${label(`建议·${stmt}`, 40)}"`);
      lines.push("  }");
    }
  }

  return lines.join("\n");
}

/**
 * 由 SchemeDraftV2 确定性生成三图 mermaid 源码。
 * 无对应条目 → 该图为空串；三图皆空即整体空态。
 */
export function renderSchemeDiagrams(
  draft: SchemeDraftV2,
  fine?: FineModelLayer | null,
): SchemeDiagrams {
  const aligned = isFineAligned(draft, fine);
  const fineLayer = aligned ? fine : null;
  return {
    mindmap: renderMindmap(draft, aligned, fineLayer),
    swimlane: renderSwimlane(draft, aligned, fineLayer),
    concept: renderConcept(draft, aligned, fineLayer),
  };
}

export function isSchemeDiagramsEmpty(diagrams: SchemeDiagrams): boolean {
  return (
    diagrams.mindmap.trim() === "" &&
    diagrams.swimlane.trim() === "" &&
    diagrams.concept.trim() === ""
  );
}
