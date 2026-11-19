/**
 * TASK-J.38c + TASK-J.38d：附录 C 投影壳（可挂真图）。
 *
 * - SchemeDraftV2 是唯一 SSOT；FineModelLayer 仅在 scheme_id/revision 对齐时作可选提示
 * - 真图由 renderSchemeDiagrams 确定性生成；无第二套图存储
 * - 全景禁止 illumination / 假绿；空态合法
 */
import {
  renderSchemeDiagrams,
  type SchemeDiagrams,
} from "@/lib/journey/render-scheme-diagrams";
import type {
  FineModelLayer,
  SchemeDraftV2,
} from "@/lib/journey/scheme-patch-types";

export const APPENDIX_C_CARD_IDS = ["capability", "journey", "domain"] as const;

export type AppendixCCardId = (typeof APPENDIX_C_CARD_IDS)[number];

export const APPENDIX_C_CARD_TITLE: Readonly<Record<AppendixCCardId, string>> =
  {
    capability: "业务功能脑图",
    journey: "用户旅程",
    domain: "业务概念图",
  };

/** 全景壳硬约束：不得携带施工点亮 / illumination */
export const PANORAMA_SHELL_FORBIDS_ILLUMINATION = true as const;

export type AppendixCCardProjection = {
  id: AppendixCCardId;
  title: string;
  /** 数据源声明（只读；不构成第二套存储） */
  source_declaration: string;
  /** 无 SSOT 条目时为空态合法 */
  empty: boolean;
  /** 空态或占位正文 */
  body: string;
  /** 来自 SSOT 的只读摘要行（名称级） */
  summary_lines: string[];
  /** 是否有可展示 mermaid 真图 */
  has_diagram: boolean;
  /** mermaid 源码；无图时为 null */
  diagram: string | null;
  /** 禁止假绿 / 施工点亮 */
  forbid_illumination: true;
};

export type AppendixCProjectionShell = {
  cards: AppendixCCardProjection[];
  forbid_illumination: true;
  /** 可选加层是否因与 SSOT 对齐而被采纳为提示源 */
  fine_layer_aligned: boolean;
  /** 任一一卡有真图 */
  has_any_diagram: boolean;
};

export type ProjectAppendixCShellInput = {
  draft?: SchemeDraftV2 | null;
  fineLayer?: FineModelLayer | null;
};

const EMPTY_BODY =
  "暂无投影数据（空态合法）。真图尚未生成；此处不展示施工进度或绿灯。";

function isFineLayerAligned(
  draft: SchemeDraftV2,
  fine: FineModelLayer,
): boolean {
  return (
    fine.source_scheme_id === draft.scheme_id &&
    fine.source_scheme_revision === draft.scheme_revision
  );
}

function diagramForCard(
  id: AppendixCCardId,
  diagrams: SchemeDiagrams,
): string | null {
  const raw =
    id === "capability"
      ? diagrams.mindmap
      : id === "journey"
        ? diagrams.swimlane
        : diagrams.concept;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildCard(
  id: AppendixCCardId,
  sourceDeclaration: string,
  summaryLines: string[],
  diagram: string | null,
): AppendixCCardProjection {
  const empty = summaryLines.length === 0 && diagram == null;
  const hasDiagram = diagram != null;
  let body: string;
  if (empty) {
    body = EMPTY_BODY;
  } else if (hasDiagram) {
    body = `${summaryLines.join(" · ") || "已生成真图"}（确定性投影；不点亮施工）`;
  } else {
    body = `${summaryLines.join(" · ")}（只读投影摘要；无真图，不点亮施工）`;
  }
  return {
    id,
    title: APPENDIX_C_CARD_TITLE[id],
    source_declaration: sourceDeclaration,
    empty,
    body,
    summary_lines: summaryLines,
    has_diagram: hasDiagram,
    diagram,
    forbid_illumination: true,
  };
}

/**
 * 附录 C 三卡投影壳。无草案 → 三卡空态；有草案 → SSOT 摘要 + 确定性真图。
 * FineModelLayer 不对齐或缺失时忽略；对齐时仅记 fine_layer_aligned，条目仍只来自 SSOT。
 */
export function projectAppendixCShell(
  input: ProjectAppendixCShellInput = {},
): AppendixCProjectionShell {
  const draft = input.draft ?? null;
  const fine = input.fineLayer ?? null;

  if (!draft) {
    const cards = [
      buildCard("capability", "ssot:none", [], null),
      buildCard("journey", "ssot:none", [], null),
      buildCard("domain", "ssot:none", [], null),
    ];
    return {
      cards,
      forbid_illumination: true,
      fine_layer_aligned: false,
      has_any_diagram: false,
    };
  }

  const fineAligned = fine != null && isFineLayerAligned(draft, fine);
  const diagrams = renderSchemeDiagrams(draft, fineAligned ? fine : null);

  const capabilityLines = draft.modules
    .map((m) => m.name.trim())
    .filter((n) => n.length > 0);

  const journeyLines = draft.flows
    .map((f) => f.name.trim())
    .filter((n) => n.length > 0);

  const domainLines = draft.entities
    .map((e) => e.name.trim())
    .filter((n) => n.length > 0);

  const sourceSuffix = fineAligned
    ? "+fineLayer:aligned-hint-only"
    : "+fineLayer:ignored";

  const cards = [
    buildCard(
      "capability",
      `ssot:SchemeDraftV2.modules${sourceSuffix}`,
      capabilityLines,
      diagramForCard("capability", diagrams),
    ),
    buildCard(
      "journey",
      `ssot:SchemeDraftV2.flows${sourceSuffix}`,
      journeyLines,
      diagramForCard("journey", diagrams),
    ),
    buildCard(
      "domain",
      `ssot:SchemeDraftV2.entities${sourceSuffix}`,
      domainLines,
      diagramForCard("domain", diagrams),
    ),
  ];

  return {
    cards,
    forbid_illumination: true,
    fine_layer_aligned: fineAligned,
    has_any_diagram: cards.some((c) => c.has_diagram),
  };
}

/** 自证：壳面不得声明 illumination；有图时 diagram 非空 */
export function assertAppendixCShellContract(
  shell: AppendixCProjectionShell,
): void {
  if (shell.forbid_illumination !== true) {
    throw new Error("appendix-c shell must forbid illumination");
  }
  for (const card of shell.cards) {
    if (card.forbid_illumination !== true) {
      throw new Error(`card ${card.id} must forbid illumination`);
    }
    if (
      card.has_diagram &&
      (card.diagram == null || card.diagram.trim() === "")
    ) {
      throw new Error(`card ${card.id} claims diagram but diagram is empty`);
    }
    if (!card.has_diagram && card.diagram != null) {
      throw new Error(
        `card ${card.id} must not carry diagram when has_diagram=false`,
      );
    }
    if (
      "illumination" in (card as object) ||
      "progress" in (card as object) ||
      "lit" in (card as object)
    ) {
      throw new Error(`card ${card.id} must not carry illumination fields`);
    }
  }
}
