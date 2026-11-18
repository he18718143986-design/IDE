/**
 * TASK-J.38b：五字段投影纯函数（丢字段 / 不改 source / 禁密封权威字段）。
 */
import { describe, it, expect } from "vitest";
import type {
  SchemeItemMeta,
  SchemeItemProjectionDto,
} from "../../src/lib/journey/scheme-patch-types";
import {
  assertProjectionDoesNotTouchAuthority,
  projectSchemeItemFiveFields,
} from "../../src/lib/journey/scheme-item-projection";
import { deriveFineModelFromV2 } from "../../src/lib/journey/fine-model-derive";
import { emptySchemeDraftV2 } from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";

function meta(over: Partial<SchemeItemMeta> = {}): SchemeItemMeta {
  return {
    id: "AC-1",
    source: "user_said",
    evidence: [],
    user_pinned: false,
    updated_in_revision: 1,
    ...over,
  };
}

describe("TASK-J.38b · projectSchemeItemFiveFields", () => {
  it("合法五字段原样保留", () => {
    const dto: SchemeItemProjectionDto = {
      status: "proposed",
      scope: "仅中栏展示",
      provenance: "台账投影",
      links: ["G1", " https://ex.ample "],
      confidence: "medium",
    };
    expect(projectSchemeItemFiveFields({ dto })).toEqual({
      status: "proposed",
      scope: "仅中栏展示",
      provenance: "台账投影",
      links: ["G1", "https://ex.ample"],
      confidence: "medium",
    });
  });

  it("非法 status / confidence 丢弃该字段，不改 meta.source", () => {
    const before = meta({ source: "user_said" });
    const after = { ...before, evidence: [...before.evidence] };
    const dirtyDto = {
      status: "bogus",
      confidence: "ultra",
      scope: "ok",
    } as unknown as SchemeItemProjectionDto;
    const projection = projectSchemeItemFiveFields({
      dto: dirtyDto,
      meta: before,
    });
    expect(projection.status).toBe("proposed"); // 从 meta 推导，非非法 dto
    expect(projection.confidence).toBeUndefined();
    expect(projection.scope).toBe("ok");
    expect(before.source).toBe("user_said");
    assertProjectionDoesNotTouchAuthority(before, after, projection);
  });

  it("显式非法 status 且无 meta 时不伪造 confirmed", () => {
    const dirtyDto = { status: "nope" } as unknown as SchemeItemProjectionDto;
    const projection = projectSchemeItemFiveFields({ dto: dirtyDto });
    expect(projection.status).toBeUndefined();
    expect(projection).not.toHaveProperty("source");
    expect(projection).not.toHaveProperty("evidence");
  });

  it("空串 scope/provenance 与非字符串 links 丢弃", () => {
    const projection = projectSchemeItemFiveFields({
      dto: {
        scope: "   ",
        provenance: "",
        links: [123, "", "  "] as unknown as string[],
      },
    });
    expect(projection.scope).toBeUndefined();
    expect(projection.provenance).toBeUndefined();
    expect(projection.links).toBeUndefined();
  });

  it("缺省不伪造 high；冻结方案可推导 confirmed", () => {
    expect(projectSchemeItemFiveFields({}).confidence).toBeUndefined();
    expect(
      projectSchemeItemFiveFields({
        meta: meta({ source: "ai_inferred" }),
        schemeFrozen: true,
      }).status,
    ).toBe("confirmed");
  });

  it("入参 dto/meta 不被就地修改（零写 source/evidence）", () => {
    const dto: SchemeItemProjectionDto = {
      status: "draft",
      links: ["A"],
    };
    const m = meta({
      source: "user_confirmed",
      evidence: [{ kind: "turn", ref: { turn_id: "t1" } }],
    });
    const dtoSnap = JSON.stringify(dto);
    const metaSnap = JSON.stringify(m);
    const projection = projectSchemeItemFiveFields({ dto, meta: m });
    expect(JSON.stringify(dto)).toBe(dtoSnap);
    expect(JSON.stringify(m)).toBe(metaSnap);
    expect(m.source).toBe("user_confirmed");
    assertProjectionDoesNotTouchAuthority(m, m, projection);
  });

  it("可选 FineModelLayer 仅补充 provenance，不渲染六实体字段", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s1",
      scheme_revision: 2,
      title: "t",
      acceptance: [
        {
          id: "AC-1",
          text: "首页显示逾期数",
          source: "ai_inferred",
          evidence: [],
          user_pinned: false,
          updated_in_revision: 2,
        },
      ],
    });
    const layer = deriveFineModelFromV2(draft);
    const projection = projectSchemeItemFiveFields({
      meta: meta({ id: "AC-1", source: "ai_inferred" }),
      fineLayer: layer,
    });
    expect(projection.provenance).toContain("AI 推断");
    expect(projection.provenance).toContain("细模型加层");
    expect(projection).not.toHaveProperty("actors");
    expect(projection).not.toHaveProperty("use_cases");
  });

  it("投影结果不得携带密封权威键", () => {
    const projection = projectSchemeItemFiveFields({
      dto: {
        status: "proposed",
        // 恶意混入（类型外）；运行时仍应被忽略
        ...({ source: "user_said", evidence: [] } as object),
      } as SchemeItemProjectionDto,
      meta: meta(),
    });
    expect(projection).not.toHaveProperty("source");
    expect(projection).not.toHaveProperty("evidence");
  });
});
