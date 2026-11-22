/**
 * TASK-J.47：组装在没有 set_title 时补一条，不改确认门禁阈值。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assembleCompilerOutput } from "../../src/lib/journey/compiler-output-schema";
import type { CompilerSchemaEnums } from "../../src/lib/journey/compiler-output-schema";

const enums: CompilerSchemaEnums = {
  ua: ["U5"],
  ub: ["U5"],
  ids: ["M1"],
  rej: [],
};

const aliasMap = new Map<string, string>([["U5", "T5"]]);
const batch = { batchAliases: ["U5"], batchTurnIds: ["T5"] };

function moduleOp(name: string) {
  return {
    op: "upsert_module" as const,
    source: "user_said" as const,
    item: {
      id: "new:login",
      name,
      purpose: "用户登录入口",
      user_visible: true,
      kind: "new" as const,
      project_anchor: null,
    },
    evidence: [{ qid: "q1" }],
    revival: null,
  };
}

describe("J.47 组装补标题", () => {
  it("无 set_title 时注入模块名，证据非空", () => {
    const r = assembleCompilerOutput(
      {
        quotes: [{ qid: "q1", from: "U5", text: "我要一个登录页" }],
        ops: [moduleOp("登录页")],
      },
      aliasMap,
      1,
      batch,
      enums,
      () => "ITEM-1",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.patch.ops.filter((op) => op.op === "set_title");
    expect(titles).toHaveLength(1);
    const title = titles[0];
    expect(title?.op).toBe("set_title");
    if (title?.op !== "set_title") return;
    expect(title.value).toBe("登录页");
    expect(title.value.length).toBeGreaterThanOrEqual(2);
    expect(title.evidence.length).toBeGreaterThan(0);
    expect(title.evidence[0]).toMatchObject({
      turn_id: "T5",
      quote: "我要一个登录页",
    });
  });

  it("已有 set_title 不重复", () => {
    const r = assembleCompilerOutput(
      {
        quotes: [{ qid: "q1", from: "U5", text: "我要一个登录页" }],
        ops: [
          {
            op: "set_title" as const,
            value: "已有标题",
            evidence: [{ qid: "q1" }],
            revival: null,
          },
          moduleOp("登录页"),
        ],
      },
      aliasMap,
      1,
      batch,
      enums,
      () => "ITEM-1",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.patch.ops.filter((op) => op.op === "set_title");
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({ value: "已有标题" });
  });

  it("模块名不够时只用 quotes 里已有的文字", () => {
    const r = assembleCompilerOutput(
      {
        quotes: [{ qid: "q1", from: "U5", text: "我要一个登录页" }],
        ops: [moduleOp("页")],
      },
      aliasMap,
      1,
      batch,
      enums,
      () => "ITEM-1",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.patch.ops.filter((op) => op.op === "set_title");
    expect(titles).toEqual([
      expect.objectContaining({
        op: "set_title",
        value: "我要一个登录页",
      }),
    ]);
  });

  it("门禁阈值未改", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/journey/scheme-draft.ts"),
      "utf8",
    );
    expect(src).toContain("draft.title.trim().length >= 2");
    expect(src).toContain("draft.summary.trim().length >= 8");
    expect(src).toContain("方案摘要不足，至少需要可读标题与摘要/模块");
  });
});
