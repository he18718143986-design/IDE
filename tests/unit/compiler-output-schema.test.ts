/**
 * TASK-J.10：生成 Schema / 组装期 S 类码封杀与字段代填。
 * TASK-J.47：DeepSeek 要求 JSON Schema 每个 object 的 required 覆盖全部 properties。
 */
import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import {
  S_CLASS_CODES_KILLED_BY_SCHEMA,
  assembleCompilerOutput,
  buildCompilerOutputSchema,
  type CompilerSchemaEnums,
} from "../../src/lib/journey/compiler-output-schema";

const enums: CompilerSchemaEnums = {
  ua: ["U1", "U5"],
  ub: ["U5"],
  ids: ["M1", "D3"],
  rej: ["REJ-001"],
};

const aliasMap = new Map<string, string>([
  ["U1", "T1"],
  ["U5", "T5"],
]);

const batch = { batchAliases: ["U5"], batchTurnIds: ["T5"] };

const baseRaw = () => ({
  quotes: [{ qid: "q1", from: "U5", text: "我要导出报表" }],
  ops: [
    {
      op: "upsert_module",
      item: {
        id: "new:mod1",
        name: "报表导出",
        purpose: "给管理者看",
        user_visible: true,
        kind: "new" as const,
        project_anchor: null,
      },
      source: "user_said",
      evidence: [{ qid: "q1" }],
      revival: null,
    },
  ],
});

describe("S 类码：组装后不可能合法出现", () => {
  it("导出清单齐全", () => {
    expect(S_CLASS_CODES_KILLED_BY_SCHEMA).toEqual(
      expect.arrayContaining([
        "E_PATCH_BATCH_INVALID",
        "E_PATCH_REVISION_AHEAD",
        "E_EVIDENCE_EDIT_FORGED",
        "E_QUOTE_OCCURRENCE_OUT_OF_RANGE",
        "E_SOURCE_CLAIM_FORBIDDEN",
        "W_COMPILER_ANCHOR_IGNORED",
        "W_PARTNER_HINT_TRUNCATED",
        "W_REVIVAL_OCCURRENCE_IGNORED",
      ]),
    );
  });

  it("partner_hint → assemble.partner_hint_forbidden", () => {
    const r = assembleCompilerOutput(
      { ...baseRaw(), partner_hint: "偷偷回流右栏" },
      aliasMap,
      5,
      batch,
      enums,
    );
    expect(r).toMatchObject({
      ok: false,
      code: "E_PATCH_SCHEMA_INVALID",
      subreason: "assemble.partner_hint_forbidden",
    });
  });

  it("模型输出 base_revision → 拒绝，不被采信", () => {
    const r = assembleCompilerOutput(
      { ...baseRaw(), base_revision: 99 },
      aliasMap,
      5,
      batch,
      enums,
    );
    expect(r).toMatchObject({
      ok: false,
      subreason: "assemble.forbidden_field",
      detail: "base_revision",
    });
  });

  it("模型输出 compiled_from_turns → 拒绝", () => {
    const r = assembleCompilerOutput(
      { ...baseRaw(), compiled_from_turns: ["T99"] },
      aliasMap,
      5,
      batch,
      enums,
    );
    expect(r).toMatchObject({
      ok: false,
      subreason: "assemble.forbidden_field",
      detail: "compiled_from_turns",
    });
  });

  it("evidence 含 occurrence → 拒绝（封杀 E_QUOTE_OCCURRENCE_OUT_OF_RANGE）", () => {
    const raw = baseRaw();
    (raw.ops[0] as { evidence: unknown }).evidence = [
      { qid: "q1", occurrence: 0 },
    ];
    const r = assembleCompilerOutput(raw, aliasMap, 5, batch, enums);
    expect(r.ok).toBe(false);
  });

  it("evidence 含 anchor → 拒绝（封杀 W_COMPILER_ANCHOR_IGNORED）", () => {
    const raw = baseRaw();
    (raw.ops[0] as { evidence: unknown }).evidence = [
      { qid: "q1", anchor: { raw_start: 0, raw_end: 1 } },
    ];
    const r = assembleCompilerOutput(raw, aliasMap, 5, batch, enums);
    expect(r.ok).toBe(false);
  });

  it("source: user_confirmed → schema/组装拒绝（封杀 E_SOURCE_CLAIM_FORBIDDEN）", () => {
    const schema = buildCompilerOutputSchema(enums);
    const parsed = schema.safeParse({
      ...baseRaw(),
      ops: [
        {
          ...baseRaw().ops[0],
          source: "user_confirmed",
        },
      ],
    });
    expect(parsed.success).toBe(false);

    const r = assembleCompilerOutput(
      {
        ...baseRaw(),
        ops: [{ ...baseRaw().ops[0], source: "user_confirmed" }],
      },
      aliasMap,
      5,
      batch,
      enums,
    );
    // zod 路径或组装路径均可；不得产出合法补丁
    expect(r.ok).toBe(false);
  });

  it("edit 形态证据 → 拒绝（封杀 E_EVIDENCE_EDIT_FORGED）", () => {
    const raw = baseRaw();
    (raw.ops[0] as { evidence: unknown }).evidence = [
      { kind: "edit", ref: { edit_event_id: "E1" } },
    ];
    const r = assembleCompilerOutput(raw, aliasMap, 5, batch, enums);
    expect(r.ok).toBe(false);
  });
});

describe("JSON Schema：required 覆盖全部 properties（DeepSeek）", () => {
  it("asSchema(buildCompilerOutputSchema) 每个 object 的 required ≡ properties 键集", async () => {
    const zodSchema = buildCompilerOutputSchema(enums);
    // 与 generateObject 相同转换路径（ai asSchema → jsonSchema）
    const jsonSchema = await asSchema(zodSchema).jsonSchema;

    type JsonSchemaNode = {
      type?: string | string[];
      properties?: Record<string, JsonSchemaNode>;
      required?: string[];
      items?: JsonSchemaNode | JsonSchemaNode[];
      anyOf?: JsonSchemaNode[];
      oneOf?: JsonSchemaNode[];
      allOf?: JsonSchemaNode[];
      $defs?: Record<string, JsonSchemaNode>;
      definitions?: Record<string, JsonSchemaNode>;
    };

    const mismatches: {
      path: string;
      missing: string[];
      extra: string[];
    }[] = [];

    const walk = (node: JsonSchemaNode | undefined, path: string) => {
      if (!node || typeof node !== "object") return;
      const props = node.properties;
      if (props) {
        const propKeys = Object.keys(props).sort();
        const reqKeys = [...(node.required ?? [])].sort();
        const propSet = new Set(propKeys);
        const reqSet = new Set(reqKeys);
        const missing = propKeys.filter((k) => !reqSet.has(k));
        const extra = reqKeys.filter((k) => !propSet.has(k));
        if (missing.length > 0 || extra.length > 0) {
          mismatches.push({ path, missing, extra });
        }
        for (const [k, child] of Object.entries(props)) {
          walk(child, `${path}.${k}`);
        }
      }
      if (node.items) {
        if (Array.isArray(node.items)) {
          node.items.forEach((c, i) => walk(c, `${path}.items[${i}]`));
        } else {
          walk(node.items, `${path}.items`);
        }
      }
      for (const key of ["anyOf", "oneOf", "allOf"] as const) {
        const arr = node[key];
        if (Array.isArray(arr)) {
          arr.forEach((c, i) => walk(c, `${path}.${key}[${i}]`));
        }
      }
      for (const defsKey of ["$defs", "definitions"] as const) {
        const defs = node[defsKey];
        if (defs) {
          for (const [k, child] of Object.entries(defs)) {
            walk(child, `${path}.${defsKey}.${k}`);
          }
        }
      }
    };

    walk(jsonSchema as JsonSchemaNode, "$");
    expect(mismatches).toEqual([]);
  });
});

describe("组装：qid 展开、new: 替换、代填字段", () => {
  it("成功组装：代填 base_revision 与 compiled_from_turns；new: → ITEM-*", () => {
    const r = assembleCompilerOutput(
      baseRaw(),
      aliasMap,
      12,
      batch,
      enums,
      () => "ITEM-42",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.base_revision).toBe(12);
    expect(r.patch.compiled_from_turns).toEqual(["T5"]);
    const op = r.patch.ops[0] as {
      op: string;
      item: { id: string; source: string };
      evidence: { turn_id: string; quote: string }[];
    };
    expect(op.op).toBe("upsert_module");
    expect(op.item.id).toBe("ITEM-42");
    expect(op.item.source).toBe("user_said");
    expect(op.evidence[0]).toMatchObject({
      turn_id: "T5",
      quote: "我要导出报表",
    });
  });

  it("confirm → mark_user_confirmed，且证据必须在本批", () => {
    const raw = {
      quotes: [{ qid: "q1", from: "U5", text: "对，就用假数据" }],
      ops: [
        {
          op: "confirm",
          id: "D3",
          evidence: [{ qid: "q1" }],
        },
      ],
    };
    const r = assembleCompilerOutput(raw, aliasMap, 5, batch, enums);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.ops[0]).toMatchObject({
      op: "mark_user_confirmed",
      id: "D3",
    });
  });

  it("未知 qid → assemble.unknown_qid", () => {
    const raw = baseRaw();
    (raw.ops[0] as { evidence: { qid: string }[] }).evidence = [{ qid: "q9" }];
    const r = assembleCompilerOutput(raw, aliasMap, 5, batch, enums);
    expect(r).toMatchObject({
      ok: false,
      subreason: "assemble.unknown_qid",
    });
  });

  it("reject_item.reason 为 null → 默认「用户在聊天中否决」，不写 null", () => {
    const raw = {
      quotes: [{ qid: "q1", from: "U5", text: "不要这个模块" }],
      ops: [
        {
          op: "reject_item" as const,
          id: "M1",
          reason: null,
          evidence: [{ qid: "q1" }],
        },
      ],
    };
    const r = assembleCompilerOutput(raw, aliasMap, 5, batch, enums);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.ops[0]).toEqual({
      op: "reject_item",
      id: "M1",
      reason: "用户在聊天中否决",
      evidence: [{ turn_id: "T5", quote: "不要这个模块" }],
    });
  });
});
