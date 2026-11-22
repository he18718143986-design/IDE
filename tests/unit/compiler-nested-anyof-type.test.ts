/**
 * TASK-J.48：ids 非空时 module_id 不得再变成「anyOf 套 anyOf 且内层无 type」。
 * 与 generateObject 同一条转换路径：ai asSchema → jsonSchema。
 */
import fs from "node:fs";
import path from "node:path";
import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildCompilerOutputSchema,
  type CompilerSchemaEnums,
} from "../../src/lib/journey/compiler-output-schema";

const enumsWithItem: CompilerSchemaEnums = {
  ua: ["U4"],
  ub: ["U4"],
  ids: ["ITEM-1"],
  rej: [],
};

type JsonNode = {
  type?: string | string[];
  anyOf?: JsonNode[];
  oneOf?: JsonNode[];
  properties?: Record<string, JsonNode>;
  items?: JsonNode | JsonNode[];
  $defs?: Record<string, JsonNode>;
  definitions?: Record<string, JsonNode>;
};

/** 成员本身又是没有 type 的 anyOf/oneOf。一层 anyOf 且每个成员自带 type，不算失败。 */
function nakedUnionMembers(
  node: JsonNode | undefined,
  at: string,
  hits: string[],
) {
  if (!node || typeof node !== "object") return;
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = node[key];
    if (!Array.isArray(branches)) continue;
    branches.forEach((branch, i) => {
      if (!branch || typeof branch !== "object") return;
      const nested = Array.isArray(branch.anyOf) || Array.isArray(branch.oneOf);
      if (nested && branch.type === undefined) {
        hits.push(`${at}.${key}[${i}]`);
      }
      nakedUnionMembers(branch, `${at}.${key}[${i}]`, hits);
    });
  }
  if (node.properties) {
    for (const [k, child] of Object.entries(node.properties)) {
      nakedUnionMembers(child, `${at}.${k}`, hits);
    }
  }
  if (Array.isArray(node.items)) {
    node.items.forEach((child, i) =>
      nakedUnionMembers(child, `${at}.items[${i}]`, hits),
    );
  } else if (node.items) {
    nakedUnionMembers(node.items, `${at}.items`, hits);
  }
  for (const bag of [node.$defs, node.definitions]) {
    if (!bag) continue;
    for (const [k, child] of Object.entries(bag)) {
      nakedUnionMembers(child, `${at}.${k}`, hits);
    }
  }
}

function flowRaw(moduleId: string | null) {
  return {
    quotes: [{ qid: "q1", from: "U4", text: "我要一个登录页" }],
    ops: [
      {
        op: "upsert_flow" as const,
        source: "user_said" as const,
        item: {
          id: "new:login-flow",
          name: "登录",
          steps: [{ actor: "用户", action: "提交", module_id: moduleId }],
        },
        evidence: [{ qid: "q1" }],
        revival: null,
      },
    ],
  };
}

describe("J.48 第二轮 schema 嵌套 anyOf", () => {
  it("ids 含 ITEM-1 无 nested missing type", async () => {
    const json = (await asSchema(buildCompilerOutputSchema(enumsWithItem))
      .jsonSchema) as JsonNode;
    const hits: string[] = [];
    nakedUnionMembers(json, "$", hits);
    expect(hits).toEqual([]);
  });

  it("module_id 接受 id/new/null", () => {
    const schema = buildCompilerOutputSchema(enumsWithItem);
    for (const moduleId of ["ITEM-1", "new:mod", null] as const) {
      const parsed = schema.safeParse(flowRaw(moduleId));
      expect(parsed.success, JSON.stringify(moduleId)).toBe(true);
    }
    expect(schema.safeParse(flowRaw("登录页")).success).toBe(false);
  });

  it("组装签名与门禁/标题兜底未改", () => {
    const schemaSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/journey/compiler-output-schema.ts"),
      "utf8",
    );
    const sig = schemaSrc.slice(
      schemaSrc.indexOf("export function assembleCompilerOutput("),
      schemaSrc.indexOf("): AssembleResult"),
    );
    expect(sig).toContain("raw: unknown");
    expect(sig).toContain("aliasMap: AliasMap");
    expect(sig).toContain("baseRevision: number");
    expect(sig).toContain("batch: AssembleBatch");
    expect(sig).toContain("enums: CompilerSchemaEnums");
    expect(sig).toContain('newId: (prefix: "ITEM") => string');
    const paramLines = sig
      .split("\n")
      .filter((line) => /^ {2}[A-Za-z]/.test(line));
    expect(paramLines).toHaveLength(6);

    const titleGate = schemaSrc.indexOf(
      'if (!ops.some((op) => op.op === "set_title"))',
    );
    const byName = schemaSrc.indexOf(
      'const name = String(titled.item["name"])',
    );
    const byQuote = schemaSrc.indexOf(
      "for (const q of data.quotes)",
      titleGate,
    );
    expect(titleGate).toBeGreaterThan(0);
    expect(byName).toBeGreaterThan(titleGate);
    expect(byQuote).toBeGreaterThan(byName);

    expect(schemaSrc).toContain(
      `function enumOrNever(values: readonly string[]): z.ZodType<string> {
  if (values.length === 0) {
    // 空枚举：任何字符串都失败（仍允许 schema 构造）
    return z.string().refine(() => false, { message: "empty enum" });
  }
  return z.enum(values as [string, ...string[]]);
}`,
    );

    const gateSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/journey/scheme-draft.ts"),
      "utf8",
    );
    expect(gateSrc).toContain("draft.title.trim().length >= 2");
    expect(gateSrc).toContain("draft.summary.trim().length >= 8");
    expect(gateSrc).toContain("方案摘要不足，至少需要可读标题与摘要/模块");
  });
});
