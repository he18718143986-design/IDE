/**
 * TASK-J.38e：测试目标建议层（只读，一律 ai_inferred）。
 *
 * - 缺省 / 无验收线索 → []（不生成）
 * - 不写回 SchemeDraftV2.acceptance；不触碰 Evidence / can_merge
 * - FineModelLayer 仅在 scheme_id/revision 对齐时作可选线索，以 SSOT 文案为准
 */
import type {
  FineModelLayer,
  SchemeDraftV2,
} from "./scheme-patch-types";

/** 建议层唯一允许的来源字面量 */
export type TestTargetSuggestionSource = "ai_inferred";

export type TestTargetSuggestion = {
  /** 稳定建议 id（非 SSOT 条目 id） */
  suggestion_id: string;
  /** 建议验证文案（人读；非验收权威） */
  text: string;
  /** 固定 ai_inferred；类型上禁止 user_said / user_confirmed */
  source: TestTargetSuggestionSource;
  /** 派生自哪些 SSOT 验收条目 id */
  derived_from: string[];
};

export type SuggestTestTargetsInput = {
  draft?: SchemeDraftV2 | null;
  fineLayer?: FineModelLayer | null;
  /**
   * 显式关闭建议层。缺省 true（有线索才生成）；false → 恒 []。
   */
  enabled?: boolean;
};

function isFineLayerAligned(
  draft: SchemeDraftV2,
  fine: FineModelLayer,
): boolean {
  return (
    fine.source_scheme_id === draft.scheme_id &&
    fine.source_scheme_revision === draft.scheme_revision
  );
}

/**
 * 由 SSOT 验收条目建议测试目标。无草案 / 空 acceptance / enabled=false → []。
 */
export function suggestTestTargets(
  input: SuggestTestTargetsInput = {},
): TestTargetSuggestion[] {
  if (input.enabled === false) return [];
  const draft = input.draft ?? null;
  if (!draft) return [];

  const fine = input.fineLayer ?? null;
  const fineAligned = fine != null && isFineLayerAligned(draft, fine);
  const fineByAcceptanceId = new Map<string, string>();
  if (fineAligned && fine) {
    for (const fa of fine.acceptance) {
      const aid = fa.acceptance_id?.trim() ?? "";
      const t = typeof fa.text === "string" ? fa.text.trim() : "";
      if (aid !== "" && t !== "") fineByAcceptanceId.set(aid, t);
    }
  }

  const out: TestTargetSuggestion[] = [];
  const seen = new Set<string>();

  for (const item of draft.acceptance) {
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (id === "" || text === "" || seen.has(id)) continue;
    seen.add(id);

    // SSOT 文案优先；对齐加层不得替换文案，仅可存在于 derived 线索
    const checkHint =
      item.check === "auto"
        ? "（建议可自动检查）"
        : item.check === "playtest"
          ? "（建议试玩确认）"
          : item.check === "both"
            ? "（建议自动检查 + 试玩）"
            : "";

    // 若加层同 id 文案不一致，仍以 SSOT 为准（忽略 fine 文案）
    if (fineAligned) {
      const fineText = fineByAcceptanceId.get(id);
      if (fineText !== undefined && fineText !== text) {
        // intentional: keep SSOT text; fine conflict discarded
      }
    }

    out.push({
      suggestion_id: `tts:${id}`,
      text: `建议验证：${text}${checkHint}`,
      source: "ai_inferred",
      derived_from: [id],
    });
  }

  return out;
}

/** 自证：建议对象不得携带 can_merge / Evidence 权威字段，且 source 恒为 ai_inferred */
export function assertSuggestionDoesNotTouchGates(
  suggestions: readonly TestTargetSuggestion[],
): void {
  for (const s of suggestions) {
    if (s.source !== "ai_inferred") {
      throw new Error(`suggestion ${s.suggestion_id} must be ai_inferred`);
    }
    const bag = s as object;
    if (
      "can_merge" in bag ||
      "evidence" in bag ||
      "verdict" in bag ||
      "user_said" in bag ||
      "user_confirmed" in bag
    ) {
      throw new Error(
        `suggestion ${s.suggestion_id} must not carry gate/authority fields`,
      );
    }
  }
}
