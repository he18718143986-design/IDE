import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_CARD_FENCE_INFO,
  cardStatusOf,
  contractCardSchema,
  designContractViewOfCard,
  designNoteFromCard,
  joinContract,
  renderContractCard,
  splitContract,
  type ContractRuntime,
} from "../../src/lib/contract-card";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  validateDesignNote,
  type DesignNote,
} from "../../src/lib/design/design-note";
import { NODE_INCLUDE, DOM_INCLUDE } from "../../vitest.globs";

function contract(
  over: Partial<Parameters<typeof createContractDraft>[0]> = {},
): SoftwareContract {
  return createContractDraft({
    title: "雷达增量 patch",
    description: "1000 节点局部更新不重建",
    acceptanceCriteria: ["patch ≤16ms", "卸载时释放"],
    writablePaths: ["src/radar/**", "tests/stagent/**"],
    readonlyPaths: ["daemon/arch/**"],
    commands: [
      {
        alias: "unit",
        executable: "npx",
        args: ["vitest", "run", "tests/stagent/radar.test.ts"],
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
    ],
    supervisorMetadata: {
      suggestion_id: "sg-1",
      acceptance_refs: [
        { id: "ac-1", text: "patch ≤16ms", check: "auto" },
        { id: "ac-2", text: "卸载时释放", check: "both" },
      ],
      scheme_item_ids: ["goal-9"],
    },
    ...over,
  });
}

function note(contractId: string): DesignNote {
  return {
    schema_version: "1.0.0",
    contract_id: contractId,
    approach: "持久实例 + cy.batch()",
    touches: [{ path: "src/radar/graph.ts", change: "modify", why: "增量" }],
    interfaces: [],
    data_changes: [],
    dependencies: [],
    decisions: [],
    test_plan: [
      {
        acceptance_id: "ac-1",
        test_path: "tests/stagent/radar.test.ts",
        level: "unit",
      },
      {
        acceptance_id: "ac-2",
        test_path: "tests/stagent/radar.test.ts",
        level: "unit",
      },
    ],
    knowledge_delta: {
      modules_upsert: [],
      decisions_add: [],
      overview_changed: false,
    },
  };
}

describe("合同 ⇄ 卡 互逆", () => {
  it("带 acceptance_refs 的合同：拆成卡与运行时，再拼回完全相等", () => {
    const c = contract();
    const { card, runtime } = splitContract(c, note(c.contract_id));
    expect(card.contract.intent["acceptance_criteria"]).toBeUndefined();
    expect(card.contract.acceptance.map((a) => a.id)).toEqual(["ac-1", "ac-2"]);
    expect(card.contract.scheme_item_ids).toEqual(["goal-9"]);
    expect(joinContract(card, runtime)).toEqual(c);
    expect(designNoteFromCard(card)).toEqual(note(c.contract_id));
  });

  it("没有 supervisor_metadata 的旧合同：验收按 AC-n 合成，拼回时不凭空多出元数据", () => {
    const c = contract({ supervisorMetadata: undefined });
    const n = note(c.contract_id);
    n.test_plan = [
      {
        acceptance_id: "AC-1",
        test_path: "tests/stagent/radar.test.ts",
        level: "unit",
      },
    ];
    const { card, runtime } = splitContract(c, n);
    expect(card.contract.acceptance.map((a) => a.id)).toEqual(["AC-1", "AC-2"]);
    const back = joinContract(card, runtime);
    expect(back).toEqual(c);
    expect(back.supervisor_metadata).toBeUndefined();
  });

  it("acceptance_criteria 与验收条目文字不同：卡保留原文，往返不丢", () => {
    const c = contract({ acceptanceCriteria: ["整体验收口径"] });
    const { card, runtime } = splitContract(c, note(c.contract_id));
    expect(card.contract.intent["acceptance_criteria"]).toEqual([
      "整体验收口径",
    ]);
    expect(joinContract(card, runtime)).toEqual(c);
  });

  it("卡扩展字段（symbols / case / debt）不回写合同与 DesignNote", () => {
    const c = contract();
    const n = note(c.contract_id);
    const { card } = splitContract(
      c,
      n,
      {},
      {
        symbols: { "src/radar/graph.ts": ["patchGraphElements"] },
        cases: { "ac-1": { case: "门禁①" }, "ac-2": { debt: "未测" } },
      },
    );
    expect(card.design.touches[0]!.symbols).toEqual(["patchGraphElements"]);
    expect(card.design.test_plan.map((t) => [t.case, t.debt])).toEqual([
      ["门禁①", undefined],
      [undefined, "未测"],
    ]);
    expect(designNoteFromCard(card)).toEqual(n);
  });

  it("渲染出的代码块解析回来与卡相等", () => {
    const c = contract();
    const { card } = splitContract(c, note(c.contract_id), {
      non_goals: ["不换图库"],
    });
    const md = renderContractCard(card);
    expect(md.startsWith("```" + CONTRACT_CARD_FENCE_INFO + "\n")).toBe(true);
    const body = md.slice(md.indexOf("\n") + 1, md.lastIndexOf("```"));
    expect(contractCardSchema.parse(yaml.load(body))).toEqual(card);
  });

  it("DesignNote 与合同号不一致时拒绝导出", () => {
    const c = contract();
    expect(() => splitContract(c, note("other"))).toThrow(/不一致/);
  });
});

describe("卡状态", () => {
  it("由合同双状态机推出", () => {
    expect(cardStatusOf("DRAFT", "DRAFT")).toBe("NEW_TASK");
    expect(cardStatusOf("PREPARING", "APPROVED")).toBe("READY");
    expect(cardStatusOf("VERIFYING", "APPROVED")).toBe("IN_PROGRESS");
    expect(cardStatusOf("MERGED", "APPROVED")).toBe("COMPLETED");
    expect(cardStatusOf("ABORTED", "REJECTED")).toBe("ABORTED");
  });
});

describe("卡 Schema 自身的不变式", () => {
  function baseCard() {
    const c = contract();
    return splitContract(c, note(c.contract_id)).card;
  }

  it("test_plan 指向不存在的验收、没有验证命令也没有人工确认都被拒", () => {
    const card = baseCard();
    const badPlan = structuredClone(card);
    badPlan.design.test_plan[0]!.acceptance_id = "ac-9";
    expect(contractCardSchema.safeParse(badPlan).success).toBe(false);

    const noCmd = structuredClone(card);
    noCmd.contract.verification.commands = [];
    expect(contractCardSchema.safeParse(noCmd).success).toBe(false);
  });

  it("READY 卡不得是 L、不得有未决问题", () => {
    const card = { ...baseCard(), status: "READY" as const };
    expect(
      contractCardSchema.safeParse({ ...card, governance: { estimate: "L" } })
        .success,
    ).toBe(false);
    expect(
      contractCardSchema.safeParse({
        ...card,
        governance: { open_questions: ["?"] },
      }).success,
    ).toBe(false);
    expect(
      contractCardSchema.safeParse({ ...card, governance: { estimate: "M" } })
        .success,
    ).toBe(true);
  });
});

describe("仓库里的 TASK-C.4 卡就是一份合同", () => {
  const md = fs.readFileSync(
    path.join(__dirname, "../../docs/specs/development-tasks-completed.md"),
    "utf8",
  );
  const start = md.indexOf("```" + CONTRACT_CARD_FENCE_INFO + "\nid: TASK-C.4");
  const body = md.slice(
    md.indexOf("\n", start) + 1,
    md.indexOf("\n```", start),
  );
  const card = contractCardSchema.parse(yaml.load(body));

  it("配上运行时即通过 softwareContractSchema，并能原样拆回同一张卡", () => {
    const template = contract();
    const { runtime: templateRuntime } = splitContract(
      template,
      note(template.contract_id),
    );
    const runtime: ContractRuntime = {
      ...templateRuntime,
      carried: { acceptance_refs: true, scheme_item_ids: true },
      lifecycle_state: "MERGED",
      approval: {
        status: "APPROVED",
        approved_by: "user",
        approved_at: "2026-11-05T00:00:00.000Z",
        approved_revision: 1,
      },
    };
    const joined = joinContract(card, runtime);
    expect(softwareContractSchema.safeParse(joined).success).toBe(true);
    expect(joined.contract_id).toBe("TASK-C.4");

    const governance = card.governance;
    const symbols = Object.fromEntries(
      card.design.touches.map((t) => [t.path, t.symbols]),
    );
    const cases = Object.fromEntries(
      card.design.test_plan.map((t) => [
        t.acceptance_id,
        { case: t.case, debt: t.debt },
      ]),
    );
    const again = splitContract(joined, designNoteFromCard(card), governance, {
      symbols,
      cases,
    }).card;
    expect(again).toEqual(card);
  });

  it("DesignNote 通过 DN-1～DN-5（测试目录按本仓 vitest 收录）", () => {
    const result = validateDesignNote(
      designNoteFromCard(card),
      designContractViewOfCard(card),
      [],
      {
        testPathPatterns: [...NODE_INCLUDE, ...DOM_INCLUDE],
      },
    );
    expect(result).toEqual({ ok: true });
  });
});
