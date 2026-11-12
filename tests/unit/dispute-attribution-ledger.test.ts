/**
 * TASK-J.16 · K-14 台账写入（只追加）与 J16-P4「无呈现记录」写入路径。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyAttribution,
  type AttributionInput,
} from "../../daemon/supervisor/dispute/attribution";
import {
  appendAttributionEntries,
  buildAttributionEntry,
} from "../../daemon/supervisor/dispute/attribution-ledger";
import { NO_SURFACE_RECORD_NOTE } from "../../daemon/supervisor/dispute/surface-log";
import {
  casWriteSchemeLedger,
  emptyLedgerState,
  emptySchemeDraftV2,
  loadOrInitLedgerState,
  readSchemeLedger,
  schemeLedgerPath,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "k14-ledger-"));
  casWriteSchemeLedger(repo, {
    expectedPrevRevision: 0,
    next: emptyLedgerState({
      draft: emptySchemeDraftV2({ scheme_revision: 0, title: "报表工具" }),
    }),
    journal: null,
    modelId: "model-x",
    promptVersion: "prompt-v1",
    offline: false,
  });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const noRecord: AttributionInput = {
  item_ref: "D-1",
  snapshot_refs: [],
  surface_entries: null,
  change_in_unshown_area: true,
  change_on_unmapped_file: false,
};

function mustBuild(
  id: string,
  item_ref: { section: string; id: string } | null,
) {
  const built = buildAttributionEntry({
    attribution_id: id,
    trigger: "user_dispute",
    item_ref,
    result: classifyAttribution(noRecord),
    created_in_revision: 0,
  });
  if (!built.ok) throw new Error(built.reason);
  return built.value;
}

describe("K-14 台账写入", () => {
  it("旧台账缺 attributions 字段时读取缺省为空数组，schema_version 不变", () => {
    const file = schemeLedgerPath(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        schema_version: "1.0",
        updated_at: "2026-11-01T00:00:00.000Z",
        state: {
          draft: emptySchemeDraftV2({ scheme_revision: 3 }),
          graveyard: [],
          suggestions: [],
        },
        last_journal: null,
        last_model_id: null,
        last_prompt_version: null,
        offline: false,
      }),
    );
    expect(loadOrInitLedgerState(repo).attributions).toEqual([]);
    expect(readSchemeLedger(repo)?.schema_version).toBe("1.0");
  });

  it("追加后方案 draft 与 scheme_revision 不变，模型与 journal 字段原样保留", () => {
    const written = appendAttributionEntries(repo, [
      mustBuild("attr-1", { section: "decision", id: "D-1" }),
    ]);
    expect(written).toMatchObject({
      ok: true,
      appended: 1,
      skipped_duplicates: 0,
    });
    const record = readSchemeLedger(repo);
    expect(record?.state.draft.scheme_revision).toBe(0);
    expect(record?.state.draft.title).toBe("报表工具");
    expect(record?.state.attributions).toHaveLength(1);
    expect(record?.last_model_id).toBe("model-x");
    expect(record?.last_prompt_version).toBe("prompt-v1");
  });

  it("只追加：重复 attribution_id 跳过，既有条目逐字不变", () => {
    const first = mustBuild("attr-1", null);
    appendAttributionEntries(repo, [first]);
    const before = readSchemeLedger(repo)?.state.attributions;

    const again = { ...first, resolution_note: "被篡改的备注" };
    const written = appendAttributionEntries(repo, [
      again,
      mustBuild("attr-2", null),
    ]);
    expect(written).toMatchObject({
      ok: true,
      appended: 1,
      skipped_duplicates: 1,
    });
    const after = readSchemeLedger(repo)?.state.attributions ?? [];
    expect(after.slice(0, 1)).toEqual(before);
    expect(after.map((a) => a.attribution_id)).toEqual(["attr-1", "attr-2"]);
  });

  it("J16-P4 写入路径：缺呈现日志时持久化 no_surface_record 与「无呈现记录」", () => {
    appendAttributionEntries(repo, [
      mustBuild("attr-degraded", { section: "decision", id: "D-1" }),
    ]);
    const saved = readSchemeLedger(repo)?.state.attributions[0];
    expect(saved?.category).toBe("no_surface_record");
    expect(saved?.resolution_note).toContain(NO_SURFACE_RECORD_NOTE);
    expect(saved?.item_ref).toEqual({ section: "decision", id: "D-1" });
  });

  it("编译回合用旧快照写回时不丢失期间追加的归因", () => {
    const stale = loadOrInitLedgerState(repo);
    appendAttributionEntries(repo, [mustBuild("attr-late", null)]);
    const r = casWriteSchemeLedger(repo, {
      expectedPrevRevision: 0,
      next: {
        ...stale,
        draft: { ...stale.draft, title: "新标题" },
        attributions: [],
      },
      journal: null,
      modelId: "model-x",
      offline: false,
    });
    expect(r.ok).toBe(true);
    const after = readSchemeLedger(repo);
    expect(after?.state.draft.title).toBe("新标题");
    expect(after?.state.attributions.map((a) => a.attribution_id)).toEqual([
      "attr-late",
    ]);
  });

  it("空列表不写盘：updated_at 不变", () => {
    const before = readSchemeLedger(repo)?.updated_at;
    const r = appendAttributionEntries(repo, []);
    expect(r).toMatchObject({ ok: true, appended: 0 });
    expect(readSchemeLedger(repo)?.updated_at).toBe(before);
  });
});
