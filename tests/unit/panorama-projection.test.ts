/**
 * TASK-J.38c / J.38d：附录 C 投影壳（空态 / SSOT 优先 / 真图挂接 / 禁假绿）。
 */
import { describe, expect, it } from "vitest";
import { emptySchemeDraftV2 } from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { deriveFineModelFromV2 } from "../../src/lib/journey/fine-model-derive";
import type {
  FineModelLayer,
  SchemeItemMeta,
} from "../../src/lib/journey/scheme-patch-types";
import {
  assertAppendixCShellContract,
  projectAppendixCShell,
} from "../../src/lib/studio/panorama-projection";
import {
  assertPanoramaLensContract,
  PANORAMA_LENS_FORBIDS_ILLUMINATION,
  STUDIO_LENS_IDS,
} from "../../src/lib/studio/lens-routing";

function meta(id: string): SchemeItemMeta {
  return {
    id,
    source: "user_said",
    evidence: [],
    user_pinned: false,
    updated_in_revision: 1,
  };
}

describe("TASK-J.38c · projectAppendixCShell", () => {
  it("无草案 → 三卡空态合法，禁真图与 illumination", () => {
    const shell = projectAppendixCShell({});
    expect(shell.forbid_illumination).toBe(true);
    expect(shell.fine_layer_aligned).toBe(false);
    expect(shell.has_any_diagram).toBe(false);
    expect(shell.cards).toHaveLength(3);
    for (const card of shell.cards) {
      expect(card.empty).toBe(true);
      expect(card.has_diagram).toBe(false);
      expect(card.diagram).toBeNull();
      expect(card.forbid_illumination).toBe(true);
      expect(card.source_declaration).toBe("ssot:none");
      expect(card.body).toMatch(/暂无投影数据（空态合法）/);
      expect(card.body).toMatch(/不展示施工进度或绿灯/);
      expect(card).not.toHaveProperty("illumination");
      expect(card).not.toHaveProperty("progress");
    }
    assertAppendixCShellContract(shell);
  });

  it("有 SSOT 条目 → 摘要来自 modules/flows/entities，并挂确定性真图", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s1",
      scheme_revision: 2,
      modules: [
        {
          ...meta("M1"),
          name: "登录",
          purpose: "进门",
          user_visible: true,
          kind: "new",
        },
      ],
      flows: [
        {
          ...meta("F1"),
          name: "业主开项目",
          steps: [{ actor: "业主", action: "打开" }],
        },
      ],
      entities: [{ ...meta("E1"), name: "合同", fields_hint: ["id"] }],
    });
    const shell = projectAppendixCShell({ draft });
    expect(shell.cards[0]?.summary_lines).toEqual(["登录"]);
    expect(shell.cards[1]?.summary_lines).toEqual(["业主开项目"]);
    expect(shell.cards[2]?.summary_lines).toEqual(["合同"]);
    expect(shell.cards.every((c) => c.empty === false)).toBe(true);
    expect(shell.has_any_diagram).toBe(true);
    expect(shell.cards[0]?.has_diagram).toBe(true);
    expect(shell.cards[0]?.diagram).toMatch(/^mindmap\n/);
    expect(shell.cards[0]?.diagram).toContain("登录");
    expect(shell.cards[1]?.diagram).toMatch(/^flowchart TB\n/);
    expect(shell.cards[2]?.diagram).toMatch(/^erDiagram\n/);
    expect(shell.cards.every((c) => c.forbid_illumination === true)).toBe(true);
    assertAppendixCShellContract(shell);
  });

  it("SSOT 优先：不对齐的 FineModelLayer 被忽略，不替换条目", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s-ssot",
      scheme_revision: 1,
      modules: [
        {
          ...meta("M1"),
          name: "SSOT模块",
          purpose: "p",
          user_visible: true,
          kind: "new",
        },
      ],
    });
    const misaligned: FineModelLayer = {
      ...deriveFineModelFromV2(draft),
      source_scheme_id: "other",
      source_scheme_revision: 99,
      use_cases: [
        {
          ...meta("UC-fake"),
          name: "加层伪造功能",
          summary: "不应出现在投影摘要",
          goal_ids: [],
          module_ids: [],
        },
      ],
    };
    const shell = projectAppendixCShell({ draft, fineLayer: misaligned });
    expect(shell.fine_layer_aligned).toBe(false);
    expect(shell.cards[0]?.summary_lines).toEqual(["SSOT模块"]);
    expect(shell.cards[0]?.summary_lines).not.toContain("加层伪造功能");
    expect(shell.cards[0]?.source_declaration).toContain("fineLayer:ignored");
  });

  it("对齐的 FineModelLayer 仅作提示标记，条目仍只来自 SSOT", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s-ok",
      scheme_revision: 3,
      flows: [
        {
          ...meta("F1"),
          name: "主旅程",
          steps: [{ actor: "用户", action: "走一遍" }],
        },
      ],
    });
    const fine = deriveFineModelFromV2(draft);
    const shell = projectAppendixCShell({ draft, fineLayer: fine });
    expect(shell.fine_layer_aligned).toBe(true);
    expect(shell.cards[1]?.summary_lines).toEqual(["主旅程"]);
    expect(shell.cards[1]?.source_declaration).toContain(
      "fineLayer:aligned-hint-only",
    );
  });

  it("空集合草案仍空态；lens 守卫保持双视角且禁 illumination", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "empty",
      scheme_revision: 0,
    });
    const shell = projectAppendixCShell({ draft });
    expect(shell.cards.every((c) => c.empty)).toBe(true);
    expect(PANORAMA_LENS_FORBIDS_ILLUMINATION).toBe(true);
    expect([...STUDIO_LENS_IDS]).toEqual(["panorama", "construction"]);
    assertPanoramaLensContract();
    expect(() =>
      assertPanoramaLensContract({ illumination: { lit: true } }),
    ).toThrow(/illumination/);
  });
});
