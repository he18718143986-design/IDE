/**
 * TASK-J.53：few-shot 例 1 补写验收，以及编译循环空验收窄兜底。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { maybeFillEmptyAcceptance } from "../../daemon/supervisor/intent-compiler/compile-loop";
import { INTENT_COMPILER_SYSTEM_PROMPT } from "../../daemon/supervisor/intent-compiler/system-prompt";
import {
  emptyDraft,
  makeTranscript,
  turnEv,
  userModule,
} from "../helpers/scheme-patch-fixtures";
import type {
  SchemeDraftV2,
  SchemePatch,
} from "../../src/lib/journey/scheme-patch-types";

const PROMPT_MD = readFileSync(
  resolve(__dirname, "../../docs/specs/intent-compiler-prompt.md"),
  "utf8",
);

function emptyPatch(): SchemePatch {
  return {
    base_revision: 5,
    compiled_from_turns: ["T1"],
    ops: [],
  };
}

function example1Block(src: string): string {
  const start = src.indexOf("U3：那个嗯 就搞个登陆页吧，手机号就行");
  const end = src.indexOf("例 2", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

function parseAcceptanceItems(block: string): Array<{
  id: string;
  text: string;
  check: string;
}> {
  const items: Array<{ id: string; text: string; check: string }> = [];
  const opRe =
    /"op"\s*:\s*"upsert_acceptance"[\s\S]*?"item"\s*:\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = opRe.exec(block)) !== null) {
    const body = m[1] ?? "";
    const id = body.match(/"id"\s*:\s*"([^"]*)"/)?.[1] ?? "";
    const text = body.match(/"text"\s*:\s*"([^"]*)"/)?.[1] ?? "";
    const check = body.match(/"check"\s*:\s*"([^"]*)"/)?.[1] ?? "";
    items.push({ id, text, check });
  }
  return items;
}

describe("J.53 生成器补写验收", () => {
  it("J53-P1: 官方 few-shot 例 1 在 upsert_module 同时写出至少一条 id 与 text 非空的可检查 upsert_acceptance，且 intent-compiler-prompt.md 对应示例同步", () => {
    const fromPrompt = example1Block(INTENT_COMPILER_SYSTEM_PROMPT);
    const fromSpec = example1Block(PROMPT_MD);

    for (const block of [fromPrompt, fromSpec]) {
      expect(block).toContain("就搞个登陆页吧");
      expect(block).toContain("登陆页");
      expect(block).toContain('"op":"upsert_module"');
      expect(block).toContain('"op":"upsert_acceptance"');
      const acceptances = parseAcceptanceItems(block);
      expect(acceptances.length).toBeGreaterThanOrEqual(1);
      for (const item of acceptances) {
        expect(item.id.trim().length).toBeGreaterThan(0);
        expect(item.text.trim().length).toBeGreaterThan(0);
        expect(item.check.trim().length).toBeGreaterThan(0);
      }
    }

    expect(parseAcceptanceItems(fromPrompt)).toEqual(
      parseAcceptanceItems(fromSpec),
    );
  });

  it("J53-P2: 未冻草案已有可见模块但 acceptance 为空时注入 source=ai_inferred 的 upsert_acceptance；已有合格验收或无模块无目标时不补", () => {
    const tr = makeTranscript([{ role: "user", text: "我要一个登录页" }]);
    const login = userModule(
      tr,
      "ITEM-1",
      "登录页",
      "用手机号登录",
      "T1",
      "我要一个登录页",
    );

    const injectedInto = maybeFillEmptyAcceptance(
      {
        ...emptyPatch(),
        ops: [{ op: "set_title", value: "登录页", evidence: [] }],
      },
      emptyDraft({ title: "登录页", modules: [login] }),
    );
    const added = injectedInto.ops.filter(
      (op) => op.op === "upsert_acceptance",
    );
    expect(added).toHaveLength(1);
    const acc = added[0];
    expect(acc?.op).toBe("upsert_acceptance");
    if (acc?.op !== "upsert_acceptance") return;
    expect(acc.item.source).toBe("ai_inferred");
    expect(String(acc.item.id).startsWith("new:")).toBe(true);
    expect(String(acc.item.id).trim().length).toBeGreaterThan(4);
    expect(String(acc.item["text"] ?? "").trim().length).toBeGreaterThan(0);
    expect(String(acc.item["text"] ?? "")).toContain("登录页");
    expect(acc.item["check"]).toBe("playtest");
    expect(acc.evidence).toEqual(
      login.evidence.filter((e) => e.kind === "turn").map((e) => e.ref),
    );
    expect(acc.evidence.length).toBeGreaterThan(0);
    // 不要求本批 ops 为空：原有 set_title 仍在
    expect(injectedInto.ops[0]?.op).toBe("set_title");

    const alreadyQualified = maybeFillEmptyAcceptance(
      emptyPatch(),
      emptyDraft({
        modules: [login],
        acceptance: [
          {
            id: "ITEM-9",
            text: "打开登录页后可以用手机号登录",
            check: "playtest",
            source: "user_said",
            evidence: login.evidence,
            user_pinned: false,
            updated_in_revision: 2,
            introduced_after_turn_seq: 0,
          },
        ],
      }),
    );
    expect(alreadyQualified.ops).toEqual([]);

    const noModuleNoGoal = maybeFillEmptyAcceptance(
      emptyPatch(),
      emptyDraft({ title: "还没有模块" }),
    );
    expect(noModuleNoGoal.ops).toEqual([]);

    const goalOnly = maybeFillEmptyAcceptance(
      emptyPatch(),
      emptyDraft({
        goals: [
          {
            id: "ITEM-2",
            text: "用户可以用手机号登录",
            source: "user_said",
            evidence: [turnEv(tr, "T1", "我要一个登录页")],
            user_pinned: false,
            updated_in_revision: 1,
            introduced_after_turn_seq: 0,
          },
        ],
      }),
    );
    const fromGoal = goalOnly.ops.filter((op) => op.op === "upsert_acceptance");
    expect(fromGoal).toHaveLength(1);
    if (fromGoal[0]?.op !== "upsert_acceptance") return;
    expect(fromGoal[0].item.source).toBe("ai_inferred");
    expect(String(fromGoal[0].item["text"] ?? "")).toContain(
      "用户可以用手机号登录",
    );
  });

  it("J53-P3: 草案已冻结时不注入验收兜底，也不改写已密封快照", () => {
    const tr = makeTranscript([{ role: "user", text: "我要一个登录页" }]);
    const login = userModule(
      tr,
      "ITEM-1",
      "登录页",
      "用手机号登录",
      "T1",
      "我要一个登录页",
    );
    const patch = emptyPatch();
    const draft: SchemeDraftV2 = emptyDraft({
      frozen: true,
      title: "登录页",
      modules: [login],
    });
    const frozenDraft = structuredClone(draft);
    const frozenPatch = structuredClone(patch);
    const next = maybeFillEmptyAcceptance(patch, draft);
    expect(next).toBe(patch);
    expect(next.ops).toEqual([]);
    expect(draft).toEqual(frozenDraft);
    expect(patch).toEqual(frozenPatch);
  });
});
