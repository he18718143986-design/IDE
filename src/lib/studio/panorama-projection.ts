/**
 * TASK-J.38c：附录 C 投影壳（只读契约，无真渲染）。
 *
 * - 在 C.10q 三占位上挂数据源声明 + 空态；真图归 J.38d
 * - SchemeDraftV2 是唯一 SSOT；FineModelLayer 仅在 scheme_id/revision 对齐时作可选提示
 * - 不落第二套图存储；全景禁止 illumination / 假绿
 */
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
  /** 空态或占位正文（无 mermaid） */
  body: string;
  /** 来自 SSOT 的只读摘要行（名称级；非真图） */
  summary_lines: string[];
  /** 本卡永不交付真渲染 */
  has_diagram: false;
  /** 禁止假绿 / 施工点亮 */
  forbid_illumination: true;
};

export type AppendixCProjectionShell = {
  cards: AppendixCCardProjection[];
  forbid_illumination: true;
  /** 可选加层是否因与 SSOT 对齐而被采纳为提示源 */
  fine_layer_aligned: boolean;
};

export type ProjectAppendixCShellInput = {
  draft?: SchemeDraftV2 | null;
  fineLayer?: FineModelLayer | null;
};

const EMPTY_BODY =
  "暂无投影数据（空态合法）。真图尚未交付；此处不展示施工进度或绿灯。";

function isFineLayerAligned(
  draft: SchemeDraftV2,
  fine: FineModelLayer,
): boolean {
  return (
    fine.source_scheme_id === draft.scheme_id &&
    fine.source_scheme_revision === draft.scheme_revision
  );
}

function buildCard(
  id: AppendixCCardId,
  sourceDeclaration: string,
  summaryLines: string[],
): AppendixCCardProjection {
  const empty = summaryLines.length === 0;
  return {
    id,
    title: APPENDIX_C_CARD_TITLE[id],
    source_declaration: sourceDeclaration,
    empty,
    body: empty
      ? EMPTY_BODY
      : `${summaryLines.join(" · ")}（只读投影摘要；无真图，不点亮施工）`,
    summary_lines: summaryLines,
    has_diagram: false,
    forbid_illumination: true,
  };
}

/**
 * 附录 C 三卡投影壳。无草案 → 三卡空态；有草案 → 以 SSOT 集合为唯一条目源。
 * FineModelLayer 不对齐或缺失时忽略；对齐时仅记 fine_layer_aligned，不替换 SSOT 行。
 */
export function projectAppendixCShell(
  input: ProjectAppendixCShellInput = {},
): AppendixCProjectionShell {
  const draft = input.draft ?? null;
  const fine = input.fineLayer ?? null;

  if (!draft) {
    return {
      cards: [
        buildCard("capability", "ssot:none", []),
        buildCard("journey", "ssot:none", []),
        buildCard("domain", "ssot:none", []),
      ],
      forbid_illumination: true,
      fine_layer_aligned: false,
    };
  }

  const fineAligned = fine != null && isFineLayerAligned(draft, fine);

  // 业务功能脑图 ← modules（SSOT）；加层不得另起功能树
  const capabilityLines = draft.modules
    .map((m) => m.name.trim())
    .filter((n) => n.length > 0);

  // 用户旅程 ← flows（SSOT）
  const journeyLines = draft.flows
    .map((f) => f.name.trim())
    .filter((n) => n.length > 0);

  // 业务概念图 ← entities（SSOT）
  const domainLines = draft.entities
    .map((e) => e.name.trim())
    .filter((n) => n.length > 0);

  const sourceSuffix = fineAligned
    ? "+fineLayer:aligned-hint-only"
    : "+fineLayer:ignored";

  return {
    cards: [
      buildCard(
        "capability",
        `ssot:SchemeDraftV2.modules${sourceSuffix}`,
        capabilityLines,
      ),
      buildCard(
        "journey",
        `ssot:SchemeDraftV2.flows${sourceSuffix}`,
        journeyLines,
      ),
      buildCard(
        "domain",
        `ssot:SchemeDraftV2.entities${sourceSuffix}`,
        domainLines,
      ),
    ],
    forbid_illumination: true,
    fine_layer_aligned: fineAligned,
  };
}

/** 自证：壳面不得声明真图或 illumination */
export function assertAppendixCShellContract(
  shell: AppendixCProjectionShell,
): void {
  if (shell.forbid_illumination !== true) {
    throw new Error("appendix-c shell must forbid illumination");
  }
  for (const card of shell.cards) {
    if (card.has_diagram !== false) {
      throw new Error(`card ${card.id} must not claim a diagram`);
    }
    if (card.forbid_illumination !== true) {
      throw new Error(`card ${card.id} must forbid illumination`);
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
