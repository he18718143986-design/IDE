/**
 * TASK-J.16 · J16-P5（P-201）：确认快照封存原话。
 * 原文逐字取自 transcript，计入快照 digest；删段或改字都必须校验不通过。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SCHEME_SNAPSHOT_SCHEMA_VERSION,
  frozenQuotesDigest,
  parseSourceTurnRefs,
  readSchemeSnapshot,
  schemeSnapshotDigest,
  schemeSnapshotPath,
  sealFrozenQuotes,
  verifyFrozenQuotes,
  writeSchemeSnapshot,
  type FrozenQuotes,
} from "../../daemon/pipeline/scheme-snapshot-store";
import type { TranscriptRecord } from "../../daemon/supervisor/intent-compiler/transcript-store";
import type { DemoGate, SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const REQUIREMENT = "做一个抖音风格的 AES 加密小工具，界面要简洁";
const FOLLOW_UP = "密钥要能一键复制";

function transcript(): TranscriptRecord {
  return {
    schema_version: "1.0",
    updated_at: "2026-11-13T05:10:20.000Z",
    seq: 3,
    user_alias_seq: 2,
    turns: [
      {
        turn_id: "T1",
        role: "user",
        seq: 1,
        text: REQUIREMENT,
        text_sha256: sha256Utf8(REQUIREMENT),
        user_alias_seq: 1,
      },
      {
        turn_id: "T2",
        role: "assistant",
        seq: 2,
        text: "好的",
        text_sha256: sha256Utf8("好的"),
      },
      {
        turn_id: "T3",
        role: "user",
        seq: 3,
        text: FOLLOW_UP,
        text_sha256: sha256Utf8(FOLLOW_UP),
        user_alias_seq: 2,
      },
    ],
  };
}

const scheme = {
  scheme_id: "scheme-seal",
  scheme_revision: 2,
  frozen: true,
  summary: REQUIREMENT,
} as unknown as SchemeDraft;
const demo: DemoGate = {
  status: "none",
  scheme_revision: null,
  decision_revision: null,
};
const plan = { plan_digest: "p".repeat(64) } as unknown as ScopePlan;
const decision = {
  code: "OK",
  message: "ok",
  demo_mode: "none" as const,
};

function sealed(): FrozenQuotes {
  const result = sealFrozenQuotes(transcript(), [
    { turn_id: "T3", turn_text_sha256: sha256Utf8(FOLLOW_UP) },
    { turn_id: "T1", turn_text_sha256: sha256Utf8(REQUIREMENT) },
  ]);
  if (!result.ok) throw new Error(`seal failed: ${result.reason}`);
  return result.value;
}

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "j16-frozen-quotes-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

interface RawSnapshot {
  frozen_quotes?: FrozenQuotes;
  quotes_digest?: string;
}

function rewrite(confirmationId: string, mutate: (raw: RawSnapshot) => void) {
  const file = schemeSnapshotPath(repo, confirmationId);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RawSnapshot;
  mutate(raw);
  fs.writeFileSync(file, JSON.stringify(raw));
}

describe("parseSourceTurnRefs：原话清单只收已登记的 id 与哈希", () => {
  it("缺失、空、格式错、重复、超量都整体拒绝", () => {
    const ok = { turn_id: "T1", turn_text_sha256: sha256Utf8(REQUIREMENT) };
    expect(parseSourceTurnRefs(undefined)).toEqual({
      ok: false,
      reason: "quotes_missing",
    });
    expect(parseSourceTurnRefs("T1")).toEqual({
      ok: false,
      reason: "quotes_malformed",
    });
    expect(parseSourceTurnRefs([])).toEqual({
      ok: false,
      reason: "quotes_empty",
    });
    expect(
      parseSourceTurnRefs([{ turn_id: "T1", turn_text_sha256: "XYZ" }]),
    ).toEqual({
      ok: false,
      reason: "quotes_malformed",
    });
    expect(parseSourceTurnRefs([ok, ok])).toEqual({
      ok: false,
      reason: "quotes_duplicate",
    });
    const many = Array.from({ length: 201 }, (_, i) => ({
      turn_id: `T${i + 1}`,
      turn_text_sha256: "a".repeat(64),
    }));
    expect(parseSourceTurnRefs(many)).toEqual({
      ok: false,
      reason: "quotes_too_many",
    });
    expect(parseSourceTurnRefs([ok])).toEqual({ ok: true, value: [ok] });
  });
});

describe("sealFrozenQuotes：逐字取原文，对不上整体失败", () => {
  it("按 seq 排序、保留 U 别名、哈希为 sha256(utf8)", () => {
    const frozen = sealed();
    expect(frozen.source).toBe("intent-compiler-transcript");
    expect(frozen.sealed_through_seq).toBe(3);
    expect(frozen.quotes).toEqual([
      {
        turn_id: "T1",
        seq: 1,
        user_alias_seq: 1,
        text: REQUIREMENT,
        turn_text_sha256: sha256Utf8(REQUIREMENT),
      },
      {
        turn_id: "T3",
        seq: 3,
        user_alias_seq: 2,
        text: FOLLOW_UP,
        turn_text_sha256: sha256Utf8(FOLLOW_UP),
      },
    ]);
  });

  it("找不到、不是用户发言、哈希不符都不封存", () => {
    expect(
      sealFrozenQuotes(transcript(), [
        { turn_id: "T9", turn_text_sha256: "a".repeat(64) },
      ]),
    ).toMatchObject({ ok: false, reason: "turn_not_found", turn_id: "T9" });
    expect(
      sealFrozenQuotes(transcript(), [
        { turn_id: "T2", turn_text_sha256: sha256Utf8("好的") },
      ]),
    ).toMatchObject({ ok: false, reason: "turn_not_user" });
    expect(
      sealFrozenQuotes(transcript(), [
        { turn_id: "T1", turn_text_sha256: sha256Utf8("被改过的需求") },
      ]),
    ).toMatchObject({ ok: false, reason: "turn_hash_mismatch" });
    expect(
      sealFrozenQuotes(null, [
        { turn_id: "T1", turn_text_sha256: sha256Utf8(REQUIREMENT) },
      ]),
    ).toMatchObject({ ok: false, reason: "turn_not_found" });
  });
});

describe("快照封存段", () => {
  it("frozen_quotes 计入 digest：删段或改字后重算不一致", () => {
    const frozen = sealed();
    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: "scheme-confirm-seal-1",
      scheme,
      demo,
      decision,
      scope_plan: plan,
      frozen_quotes: frozen,
    });
    expect(snapshot.schema_version).toBe(SCHEME_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.schema_version).toBe("1.2");
    const withoutQuotes = schemeSnapshotDigest({
      scheme_revision: scheme.scheme_revision,
      scheme,
      demo,
      scope_plan: plan,
      graveyard: [],
    });
    expect(snapshot.digest).not.toBe(withoutQuotes);
    expect(
      schemeSnapshotDigest({
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo,
        scope_plan: plan,
        graveyard: [],
        frozen_quotes: frozen,
      }),
    ).toBe(snapshot.digest);

    const intact = readSchemeSnapshot(repo, "scheme-confirm-seal-1");
    expect(intact && verifyFrozenQuotes(intact)).toMatchObject({
      ok: true,
      sealed: true,
    });

    // 改字：原文变了，逐句哈希对不上
    rewrite("scheme-confirm-seal-1", (raw) => {
      raw.frozen_quotes!.quotes[0]!.text = "做一个普通的加密工具";
    });
    let read = readSchemeSnapshot(repo, "scheme-confirm-seal-1");
    expect(read && verifyFrozenQuotes(read)).toEqual({
      ok: false,
      reason: "quote_hash_mismatch",
    });

    // 连哈希一起改：封存段摘要对不上
    rewrite("scheme-confirm-seal-1", (raw) => {
      raw.frozen_quotes!.quotes[0]!.turn_text_sha256 =
        sha256Utf8("做一个普通的加密工具");
    });
    read = readSchemeSnapshot(repo, "scheme-confirm-seal-1");
    expect(read && verifyFrozenQuotes(read)).toEqual({
      ok: false,
      reason: "quotes_digest_mismatch",
    });

    // 连封存段摘要一起改：按内容重算的快照 digest 对不上
    rewrite("scheme-confirm-seal-1", (raw) => {
      raw.quotes_digest = frozenQuotesDigest(raw.frozen_quotes!);
    });
    read = readSchemeSnapshot(repo, "scheme-confirm-seal-1");
    expect(read && verifyFrozenQuotes(read)).toEqual({
      ok: false,
      reason: "digest_mismatch",
    });

    // 删段只留摘要：结构不完整
    rewrite("scheme-confirm-seal-1", (raw) => {
      delete raw.frozen_quotes;
    });
    read = readSchemeSnapshot(repo, "scheme-confirm-seal-1");
    expect(read && verifyFrozenQuotes(read)).toEqual({
      ok: false,
      reason: "quotes_malformed",
    });

    // 段与摘要一起删：看起来像未封存，但按内容重算的 digest 与原 digest 不一致
    rewrite("scheme-confirm-seal-1", (raw) => {
      delete raw.quotes_digest;
    });
    read = readSchemeSnapshot(repo, "scheme-confirm-seal-1");
    expect(read && verifyFrozenQuotes(read)).toEqual({
      ok: true,
      sealed: false,
    });
    expect(read?.digest).toBe(snapshot.digest);
    expect(read?.digest).not.toBe(withoutQuotes);
  });

  it("未带原话的写入保持旧口径：无封存段，digest 与封存前一致", () => {
    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: "scheme-confirm-legacy-1",
      scheme,
      demo,
      decision,
      scope_plan: plan,
    });
    expect(snapshot.frozen_quotes).toBeUndefined();
    expect(snapshot.quotes_digest).toBeUndefined();
    expect(snapshot.digest).toBe(
      schemeSnapshotDigest({
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo,
        scope_plan: plan,
        graveyard: [],
      }),
    );
    expect(verifyFrozenQuotes(snapshot)).toEqual({ ok: true, sealed: false });
  });

  it("同 id 同原话幂等，原话不同拒绝覆盖", () => {
    const input = {
      confirmation_id: "scheme-confirm-idem-1",
      scheme,
      demo,
      decision,
      scope_plan: plan,
      frozen_quotes: sealed(),
    };
    expect(writeSchemeSnapshot(repo, input).idempotent).toBe(false);
    expect(writeSchemeSnapshot(repo, input).idempotent).toBe(true);
    const onlyFirst = sealFrozenQuotes(transcript(), [
      { turn_id: "T1", turn_text_sha256: sha256Utf8(REQUIREMENT) },
    ]);
    if (!onlyFirst.ok) throw new Error("seal failed");
    expect(() =>
      writeSchemeSnapshot(repo, { ...input, frozen_quotes: onlyFirst.value }),
    ).toThrow(/拒绝覆盖/);
  });

  it("sealed_through_seq 只由原话清单决定：两次冻结之间 transcript 多出轮次，同一确认仍幂等", () => {
    const refs = [
      { turn_id: "T1", turn_text_sha256: sha256Utf8(REQUIREMENT) },
      { turn_id: "T3", turn_text_sha256: sha256Utf8(FOLLOW_UP) },
    ];
    const grown = transcript();
    grown.turns.push(
      {
        turn_id: "T4",
        role: "user",
        seq: 4,
        text: "这里不对",
        text_sha256: sha256Utf8("这里不对"),
        user_alias_seq: 3,
      },
      {
        turn_id: "T5",
        role: "assistant",
        seq: 5,
        text: "收到",
        text_sha256: sha256Utf8("收到"),
      },
    );
    grown.seq = 5;
    grown.user_alias_seq = 3;
    const first = sealFrozenQuotes(transcript(), refs);
    const retry = sealFrozenQuotes(grown, refs);
    if (!first.ok || !retry.ok) throw new Error("seal failed");
    expect(retry.value.sealed_through_seq).toBe(3);
    expect(retry.value).toEqual(first.value);

    const input = {
      confirmation_id: "scheme-confirm-retry-1",
      scheme,
      demo,
      decision,
      scope_plan: plan,
    };
    expect(
      writeSchemeSnapshot(repo, { ...input, frozen_quotes: first.value })
        .idempotent,
    ).toBe(false);
    expect(
      writeSchemeSnapshot(repo, { ...input, frozen_quotes: retry.value })
        .idempotent,
    ).toBe(true);
  });

  it("1.1 旧快照里的封存段不采信", () => {
    const file = schemeSnapshotPath(repo, "scheme-confirm-old-11");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        schema_version: "1.1",
        snapshot_id: "scheme-confirm-old-11",
        confirmation_id: "scheme-confirm-old-11",
        status: "FROZEN",
        created_at: "2026-11-01T00:00:00.000Z",
        scheme_revision: 2,
        scheme,
        demo,
        decision,
        digest: "d".repeat(64),
        scope_plan: plan,
        frozen_quotes: sealed(),
        quotes_digest: "q".repeat(64),
      }),
    );
    const read = readSchemeSnapshot(repo, "scheme-confirm-old-11");
    expect(read?.frozen_quotes).toBeUndefined();
    expect(read?.quotes_digest).toBeUndefined();
  });
});
