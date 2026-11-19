/**
 * TASK-J.38d / V-07：renderSchemeDiagrams 确定性三图。
 */
import { describe, expect, it } from "vitest";
import { emptySchemeDraftV2 } from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { deriveFineModelFromV2 } from "../../src/lib/journey/fine-model-derive";
import {
  EMPTY_SCHEME_DIAGRAMS,
  isSchemeDiagramsEmpty,
  renderSchemeDiagrams,
} from "../../src/lib/journey/render-scheme-diagrams";
import type {
  FineModelLayer,
  SchemeItemMeta,
} from "../../src/lib/journey/scheme-patch-types";

function meta(id: string): SchemeItemMeta {
  return {
    id,
    source: "user_said",
    evidence: [],
    user_pinned: false,
    updated_in_revision: 1,
  };
}

describe("TASK-J.38d · renderSchemeDiagrams", () => {
  it("空草案 → 三图空串（空态合法）", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "empty",
      scheme_revision: 0,
    });
    const diagrams = renderSchemeDiagrams(draft);
    expect(diagrams).toEqual(EMPTY_SCHEME_DIAGRAMS);
    expect(isSchemeDiagramsEmpty(diagrams)).toBe(true);
  });

  it("modules/flows/entities → 三图确定性 mermaid，不含 v1 字段", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s1",
      scheme_revision: 2,
      title: "演示方案",
      modules: [
        {
          ...meta("M1"),
          name: "登录",
          purpose: "进门",
          user_visible: true,
          kind: "new",
        },
        {
          ...meta("M2"),
          name: "合同台",
          purpose: "审阅",
          user_visible: true,
          kind: "change_existing",
        },
      ],
      flows: [
        {
          ...meta("F1"),
          name: "业主开项目",
          steps: [
            { actor: "业主", action: "打开" },
            { actor: "系统", action: "列最近", module_id: "M1" },
          ],
        },
      ],
      entities: [
        { ...meta("E1"), name: "合同", fields_hint: ["id", "title"] },
        { ...meta("E2"), name: "验收项", fields_hint: [] },
      ],
    });

    const a = renderSchemeDiagrams(draft);
    const b = renderSchemeDiagrams(draft);
    expect(a).toEqual(b);
    expect(isSchemeDiagramsEmpty(a)).toBe(false);

    expect(a.mindmap).toMatch(/^mindmap\n/);
    expect(a.mindmap).toContain("登录");
    expect(a.mindmap).toContain("合同台");
    expect(a.mindmap).not.toMatch(/mermaidArchitecture|SchemeDraft[^V]|v1/i);

    expect(a.swimlane).toMatch(/^flowchart TB\n/);
    expect(a.swimlane).toContain("业主开项目");
    expect(a.swimlane).toContain("业主");
    expect(a.swimlane).toContain("打开");

    expect(a.concept).toMatch(/^erDiagram\n/);
    expect(a.concept).toContain("合同");
    expect(a.concept).toContain("验收项");
    expect(a.concept).toContain("relates");
  });

  it("不对齐 FineModelLayer 不注入建议节点", () => {
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
          summary: "不应出现",
          goal_ids: [],
          module_ids: ["M1"],
        },
      ],
    };
    const diagrams = renderSchemeDiagrams(draft, misaligned);
    expect(diagrams.mindmap).toContain("SSOT模块");
    expect(diagrams.mindmap).not.toContain("加层伪造功能");
    expect(diagrams.mindmap).not.toContain("建议·");
  });

  it("对齐 FineModelLayer 仅追加建议提示，不替换 SSOT 模块名", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "s-ok",
      scheme_revision: 3,
      modules: [
        {
          ...meta("M1"),
          name: "核心模块",
          purpose: "p",
          user_visible: true,
          kind: "new",
        },
      ],
      flows: [
        {
          ...meta("F1"),
          name: "主旅程",
          steps: [{ actor: "用户", action: "走一遍" }],
        },
      ],
    });
    const fine = deriveFineModelFromV2(draft);
    fine.use_cases.push({
      ...meta("UC-hint"),
      name: "加层用例",
      summary: "hint",
      goal_ids: [],
      module_ids: ["M1"],
    });
    const diagrams = renderSchemeDiagrams(draft, fine);
    expect(diagrams.mindmap).toContain("核心模块");
    expect(diagrams.mindmap).toContain("建议·加层用例");
    expect(diagrams.swimlane).toContain("主旅程");
  });

  it("无独立图存储：输出仅为字符串，重复调用同输入同输出", () => {
    const draft = emptySchemeDraftV2({
      scheme_id: "det",
      scheme_revision: 1,
      entities: [{ ...meta("E1"), name: "实体甲", fields_hint: ["a"] }],
    });
    const first = renderSchemeDiagrams(draft);
    const second = renderSchemeDiagrams(draft);
    expect(first).toEqual(second);
    expect(typeof first.mindmap).toBe("string");
    expect(typeof first.swimlane).toBe("string");
    expect(typeof first.concept).toBe("string");
    expect(Object.keys(first).sort()).toEqual([
      "concept",
      "mindmap",
      "swimlane",
    ]);
  });
});
