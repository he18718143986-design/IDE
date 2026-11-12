/**
 * TASK-J.16 K-14 / K-16 · 质疑归因账本写入（supervisor §14.11 子账本四）。
 *
 * - 写入前逐条校验，全部通过才写（整批全有或全无）：
 *   trigger 为 K-16 闭集三值；category 为闭集四值（含 P-189 的 `no_surface_record`）；
 *   `linked_reason_code` 仅 `acceptance_fail` 可带，且须通过 reasonCodeSchema。
 * - 只追加：经 `appendAttributionsCas` 写入，既有条目不改、重复 attribution_id 跳过。
 * - 不新增错误码：拒绝原因为本模块的 reason 字符串。
 */
import {
  reasonCodeSchema,
  type ReasonCode,
} from "../../../src/lib/evidence.schema";
import {
  ATTRIBUTION_CATEGORIES,
  ATTRIBUTION_TRIGGERS,
  type AttributionEntry,
  type AttributionTrigger,
} from "../../../src/lib/journey/scheme-patch-types";
import {
  appendAttributionsCas,
  type AppendAttributionsResult,
} from "../intent-compiler/scheme-ledger-store";
import type { AttributionResult } from "./attribution";

export type AttributionRejection =
  | "missing_attribution_id"
  | "invalid_shape"
  | "unknown_trigger"
  | "unknown_category"
  | "invalid_linked_reason_code"
  | "linked_reason_code_requires_acceptance_fail";

export type AttributionValidation =
  | { ok: true; value: AttributionEntry }
  | { ok: false; reason: AttributionRejection };

/** 未经校验的输入：只声明已知字段，类型上不允许任意索引 */
type Loose = Partial<Record<keyof AttributionEntry, unknown>>;

/** 校验并规范化一条归因条目：只保留闭集字段，丢弃未知字段。 */
export function validateAttributionEntry(
  value: unknown,
): AttributionValidation {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "invalid_shape" };
  }
  const v = value as Loose;
  if (typeof v.attribution_id !== "string" || v.attribution_id.trim() === "") {
    return { ok: false, reason: "missing_attribution_id" };
  }
  if (!(ATTRIBUTION_TRIGGERS as readonly unknown[]).includes(v.trigger)) {
    return { ok: false, reason: "unknown_trigger" };
  }
  if (!(ATTRIBUTION_CATEGORIES as readonly unknown[]).includes(v.category)) {
    return { ok: false, reason: "unknown_category" };
  }
  if (
    typeof v.resolution_note !== "string" ||
    typeof v.created_in_revision !== "number"
  ) {
    return { ok: false, reason: "invalid_shape" };
  }
  const trigger = v.trigger as AttributionTrigger;
  let linked: ReasonCode | undefined;
  if (v.linked_reason_code !== undefined) {
    if (trigger !== "acceptance_fail") {
      return {
        ok: false,
        reason: "linked_reason_code_requires_acceptance_fail",
      };
    }
    const parsed = reasonCodeSchema.safeParse(v.linked_reason_code);
    if (!parsed.success) {
      return { ok: false, reason: "invalid_linked_reason_code" };
    }
    linked = parsed.data;
  }
  let itemRef: AttributionEntry["item_ref"];
  if (v.item_ref !== undefined) {
    const r = v.item_ref as { section?: unknown; id?: unknown } | null;
    if (
      r === null ||
      typeof r.section !== "string" ||
      typeof r.id !== "string"
    ) {
      return { ok: false, reason: "invalid_shape" };
    }
    itemRef = { section: r.section, id: r.id };
  }
  const entry: AttributionEntry = {
    attribution_id: v.attribution_id,
    trigger,
    category: v.category as AttributionEntry["category"],
    resolution_note: v.resolution_note,
    created_in_revision: v.created_in_revision,
    ...(itemRef === undefined ? {} : { item_ref: itemRef }),
    ...(linked === undefined ? {} : { linked_reason_code: linked }),
  };
  return { ok: true, value: entry };
}

/** 由分类结果构造一条归因条目（分类与 resolution_note 来自 `classifyAttribution`）。 */
export function buildAttributionEntry(params: {
  attribution_id: string;
  trigger: AttributionTrigger;
  item_ref: { section: string; id: string } | null;
  result: AttributionResult;
  created_in_revision: number;
  linked_reason_code?: ReasonCode;
}): AttributionValidation {
  return validateAttributionEntry({
    attribution_id: params.attribution_id,
    trigger: params.trigger,
    category: params.result.category,
    resolution_note: params.result.resolution_note,
    created_in_revision: params.created_in_revision,
    ...(params.item_ref === null ? {} : { item_ref: params.item_ref }),
    ...(params.linked_reason_code === undefined
      ? {}
      : { linked_reason_code: params.linked_reason_code }),
  });
}

export type AppendAttributionRejection =
  AttributionRejection | "cas_mismatch" | "io";

/** 全部校验通过才写入；任一条失败整批不落盘。 */
export function appendAttributionEntries(
  repoRoot: string,
  entries: readonly unknown[],
):
  AppendAttributionsResult | { ok: false; reason: AppendAttributionRejection } {
  const validated: AttributionEntry[] = [];
  for (const e of entries) {
    const r = validateAttributionEntry(e);
    if (!r.ok) return { ok: false, reason: r.reason };
    validated.push(r.value);
  }
  return appendAttributionsCas(repoRoot, validated);
}
