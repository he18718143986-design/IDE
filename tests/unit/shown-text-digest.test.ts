/**
 * TASK-J.41b：确认前白话正文 sha256 计入冻结快照 digest。
 * 字段缺省时摘要与旧快照相同；字段存在时改一个字节摘要就变。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  schemeSnapshotDigest,
  verifyFrozenQuotes,
  writeSchemeSnapshot,
} from "../../daemon/pipeline/scheme-snapshot-store";
import { shownPlainTextSha256 } from "../../src/components/studio/SchemeReviewPane";
import { scopeAcceptancePlainText } from "../../src/components/studio/ScopeAcceptanceBlock";
import type { DemoGate, SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";

const shown = "需要你抉择的冲突（0 条未决）\n改动范围与验收方式";

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const scheme = {
  scheme_id: "scheme-shown",
  scheme_revision: 1,
  frozen: false,
  title: "记账",
  summary: "记一笔",
  modules: [],
  conflicts: [],
  decisions: [],
} as unknown as SchemeDraft;

const demo: DemoGate = {
  status: "none",
  scheme_revision: null,
  decision_revision: null,
};

const decision = {
  code: "OK",
  message: "可以确认",
  demo_mode: "none" as const,
};

const plan = {
  plan_digest: "a".repeat(64),
  areas: [],
  never_touch: [],
  needs_approval: [],
  verification: { manual_only: true, plain: [] },
  budget: { plain: "很小" },
} as unknown as ScopePlan;

describe("TASK-J.41b 白话正文哈希", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("浏览器哈希与 node sha256(utf8) 一致", () => {
    expect(shownPlainTextSha256(shown)).toBe(sha256Utf8(shown));
    expect(shownPlainTextSha256("确认前看见的白话")).toBe(
      sha256Utf8("确认前看见的白话"),
    );
  });

  it("范围区白话包含开工前会看见的句子", () => {
    const text = scopeAcceptancePlainText({
      plan,
      mode: "pre_start",
      acceptanceSettled: true,
    });
    expect(text).toContain("改动范围与验收方式");
    expect(text).toContain("无呈现记录");
    expect(text).toContain("这次大概改 0 处、不碰 0 处");
    expect(text).toContain("没有自动检查，完成后需要你试玩确认");
    expect(text).toContain("预计多大：很小");
  });

  it("字段缺省时 digest 与不含该字段的旧算法一致，写入后改哈希则不一致", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "j41b-shown-"));
    dirs.push(repo);
    const hash = sha256Utf8(shown);
    const without = writeSchemeSnapshot(repo, {
      confirmation_id: "scheme-confirm-shown-old",
      scheme,
      demo,
      decision,
      scope_plan: plan,
    });
    expect(without.snapshot.shown_plain_text_sha256).toBeUndefined();
    expect(without.snapshot.digest).toBe(
      schemeSnapshotDigest({
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo,
        scope_plan: plan,
        graveyard: [],
      }),
    );
    expect(verifyFrozenQuotes(without.snapshot)).toMatchObject({
      ok: true,
      sealed: false,
    });

    const withHash = writeSchemeSnapshot(repo, {
      confirmation_id: "scheme-confirm-shown-new",
      scheme,
      demo,
      decision,
      scope_plan: plan,
      shown_plain_text_sha256: hash,
    });
    expect(withHash.snapshot.schema_version).toBe("1.2");
    expect(withHash.snapshot.shown_plain_text_sha256).toBe(hash);
    expect(withHash.snapshot.digest).not.toBe(without.snapshot.digest);
    expect(withHash.snapshot.digest).toBe(
      schemeSnapshotDigest({
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo,
        scope_plan: plan,
        graveyard: [],
        shown_plain_text_sha256: hash,
      }),
    );
    expect(
      schemeSnapshotDigest({
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo,
        scope_plan: plan,
        graveyard: [],
        shown_plain_text_sha256: sha256Utf8("另一段白话"),
      }),
    ).not.toBe(withHash.snapshot.digest);
  });
});
