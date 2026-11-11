/**
 * TASK-J.16 / 挂账⑬ 方案 A：台账验收条目的只读投影（§15.4 中栏上半部分）。
 * - 纯函数，不写盘、不修改台账；
 * - 只输出 id 与白话文本非空、且 id 未重复的条目（保留台账原顺序，重复取首条）；
 * - 台账缺失或不可读时返回空投影，由前端标「无呈现记录」，不伪造条目。
 */
import type { SchemeLedgerRecord } from "./scheme-ledger-store";

export interface SchemeAcceptanceItemView {
  id: string;
  text: string;
}

export interface SchemeAcceptanceProjection {
  scheme_id: string | null;
  scheme_revision: number | null;
  items: SchemeAcceptanceItemView[];
}

export function projectSchemeAcceptance(
  record: SchemeLedgerRecord | null,
): SchemeAcceptanceProjection {
  if (!record) {
    return { scheme_id: null, scheme_revision: null, items: [] };
  }
  const draft = record.state.draft;
  const seen = new Set<string>();
  const items: SchemeAcceptanceItemView[] = [];
  for (const entry of draft.acceptance) {
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (id === "" || text === "" || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, text });
  }
  return {
    scheme_id: draft.scheme_id,
    scheme_revision: draft.scheme_revision,
    items,
  };
}
