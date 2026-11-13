/**
 * TASK-J.16 · J16-P5（P-201）：左栏「你当时说的」只读合同绑定快照里封存的原话。
 * 关键词只排序不滤空；快照与合同不符或封存段被改时整段作废；不依赖 Supervisor 会话。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  schemeSnapshotPath,
  writeSchemeSnapshot,
  type FrozenQuotes,
  type SchemeSnapshot,
} from "../../daemon/pipeline/scheme-snapshot-store";
import {
  SessionFactSourceImpl,
  collectSealFact,
  extractKeywords,
} from "../../daemon/supervisor/dispute/evidence-triad";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { DemoGate, SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";

type Binding = NonNullable<SoftwareContract["scheme_binding"]>;

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const QUOTES = [
  "做一个抖音风格的 AES 加密小工具，界面要简洁",
  "密钥要能一键复制",
  "解密失败时要提示原因",
];

function frozenQuotes(): FrozenQuotes {
  return {
    source: "intent-compiler-transcript",
    sealed_through_seq: 5,
    quotes: QUOTES.map((text, i) => ({
      turn_id: `T${i * 2 + 1}`,
      seq: i * 2 + 1,
      text,
      turn_text_sha256: sha256Utf8(text),
    })),
  };
}

const scheme = {
  scheme_id: "scheme-seal-read",
  scheme_revision: 3,
  frozen: true,
} as unknown as SchemeDraft;
const demo: DemoGate = {
  status: "none",
  scheme_revision: null,
  decision_revision: null,
};
const plan = { plan_digest: "p".repeat(64) } as unknown as ScopePlan;

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "j16-seal-read-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function freeze(
  confirmationId: string,
  quotes: FrozenQuotes | null,
): { snapshot: SchemeSnapshot; binding: Binding } {
  const { snapshot } = writeSchemeSnapshot(repo, {
    confirmation_id: confirmationId,
    scheme,
    demo,
    decision: { code: "OK", message: "ok", demo_mode: "none" },
    scope_plan: plan,
    ...(quotes ? { frozen_quotes: quotes } : {}),
    now: () => new Date("2026-11-13T05:10:58.197Z"),
  });
  return {
    snapshot,
    binding: {
      confirmation_id: confirmationId,
      snapshot_digest: snapshot.digest,
      plan_digest: plan.plan_digest,
    },
  };
}

describe("collectSealFact", () => {
  it("未封存快照：左栏为空且状态为未封存", () => {
    const { binding } = freeze("scheme-confirm-unsealed", null);
    const seal = collectSealFact(repo, binding, extractKeywords("这里不对"));
    expect(seal).toEqual({
      status: "NOT_SEALED",
      confirmation_id: "scheme-confirm-unsealed",
      bound_snapshot: true,
      confirmed_at: "2026-11-13T05:10:58.197Z",
      frozen_quotes_count: null,
      quotes: [],
    });
  });

  it("「这里不对」不滤空：封存原话全部按相关度排序", () => {
    const { binding } = freeze("scheme-confirm-sealed", frozenQuotes());

    // 「这里不对」提不出有效词：一句不丢，按说话先后
    const vague = collectSealFact(repo, binding, extractKeywords("这里不对"));
    expect(vague.status).toBe("SEALED");
    expect(vague.frozen_quotes_count).toBe(3);
    expect(vague.quotes.map((q) => q.text)).toEqual(QUOTES);
    for (const quote of vague.quotes) {
      expect(sha256Utf8(quote.text)).toBe(quote.turn_text_sha256);
    }

    // 有命中时只改先后，不丢零命中的句子
    const specific = collectSealFact(
      repo,
      binding,
      extractKeywords("密钥复制按钮不见了"),
    );
    expect(specific.quotes).toHaveLength(3);
    expect(specific.quotes[0]?.text).toBe("密钥要能一键复制");
    expect(specific.quotes[0]?.keyword_hits).toBeGreaterThan(0);
    expect(specific.quotes.slice(1).map((q) => q.text)).toEqual([
      QUOTES[0],
      QUOTES[2],
    ]);
  });

  it("封存段被改：整段作废", () => {
    const { binding } = freeze("scheme-confirm-tampered", frozenQuotes());
    const file = schemeSnapshotPath(repo, "scheme-confirm-tampered");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      frozen_quotes: FrozenQuotes;
    };
    raw.frozen_quotes.quotes[1]!.text = "密钥不用复制";
    fs.writeFileSync(file, JSON.stringify(raw));

    const seal = collectSealFact(repo, binding, []);
    expect(seal.status).toBe("TAMPERED");
    expect(seal.bound_snapshot).toBe(false);
    expect(seal.quotes).toEqual([]);
    expect(seal.frozen_quotes_count).toBeNull();
  });

  it("快照 digest 与合同不符也判篡改，不展示任何原话", () => {
    const { binding } = freeze("scheme-confirm-mismatch", frozenQuotes());
    const seal = collectSealFact(
      repo,
      { ...binding, snapshot_digest: "0".repeat(64) },
      [],
    );
    expect(seal.status).toBe("TAMPERED");
    expect(seal.quotes).toEqual([]);
  });

  it("合同没有绑定快照或快照读不到时，状态各自如实标注", () => {
    expect(collectSealFact(repo, undefined, []).status).toBe("NO_BINDING");
    expect(
      collectSealFact(
        repo,
        {
          confirmation_id: "scheme-confirm-absent",
          snapshot_digest: "d".repeat(64),
          plan_digest: plan.plan_digest,
        },
        [],
      ).status,
    ).toBe("SNAPSHOT_MISSING");
  });
});

describe("SessionFactSourceImpl", () => {
  it("无 Supervisor 会话仍能读出封存原话", () => {
    const { binding } = freeze("scheme-confirm-nosession", frozenQuotes());
    const fact = new SessionFactSourceImpl(repo).collect({
      contractId: "contract-without-session",
      keywords: extractKeywords("这里不对"),
      schemeBinding: binding,
    });
    expect(fact.source).toBe("CHALLENGE_ONLY");
    expect(fact.session_id).toBeNull();
    // 归因信号仍按原规则（无会话即空），左栏展示改读封存段
    expect(fact.matched_messages).toEqual([]);
    expect(fact.seal.status).toBe("SEALED");
    expect(fact.seal.quotes.map((q) => q.text)).toEqual(QUOTES);
  });
});
