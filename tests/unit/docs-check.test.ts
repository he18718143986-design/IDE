import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardHeaderSchema } from "../../scripts/docs-check/card-header.schema";
import {
  CARD_FENCE_INFO,
  INDEX_FILE,
  MATRIX_FILE,
  Repo,
  SCHEME_FILE,
  checkLinks,
  checkScheme,
  declaresSymbol,
  findTestCase,
  makeTestMatcher,
  runAllChecks,
  type Finding,
} from "../../scripts/docs-check/checks";
import {
  collectAnchors,
  collectLinks,
  githubSlug,
} from "../../scripts/docs-check/markdown";

const isTestFile = makeTestMatcher(["tests/unit/**/*.test.ts"], []);

let root: string;

function write(rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function baseCard(overrides: Record<string, unknown> = {}) {
  return {
    id: "TASK-X.1",
    title: "示例卡",
    status: "COMPLETED",
    spec_refs: ["docs/specs/spec.md#目标"],
    goal: "用户能看见示例",
    depends_on: [],
    code_facts: [{ ref: "src/a.ts::foo", note: "旧实现" }],
    touches: [{ path: "src/a.ts", action: "modify", symbols: ["foo"] }],
    non_goals: ["不做别的"],
    pass: [
      {
        id: "P1",
        test: "tests/unit/a.test.ts",
        case: "foo 返回 1",
        assert: "foo() === 1",
      },
    ],
    fail: ["foo 抛错"],
    estimate: "S",
    invariants: {
      auth: "unchanged",
      demo_origin: "unchanged",
      illumination: "unchanged",
      gateway_write_scope: "unchanged",
    },
    delivered: { pr: 1, commit: "abcdef0" },
    ...overrides,
  };
}

function cardDoc(...cards: Record<string, unknown>[]): string {
  return cards
    .map(
      (c) =>
        `#### 【Task】\n\n\`\`\`${CARD_FENCE_INFO}\n${yaml.dump(c)}\`\`\`\n`,
    )
    .join("\n");
}

function statusTables(rows: [string, string][]) {
  write(
    MATRIX_FILE,
    rows
      .map(([id, s]) => `| **${id}** | 名 | 层 | **[${s}]** | 路线 | 说明 |`)
      .join("\n") + "\n",
  );
  write(
    INDEX_FILE,
    rows.map(([id, s]) => `| \`${id}\` | \`${s}\` | 说明 | 链接 |`).join("\n") +
      "\n",
  );
}

function run(): Finding[] {
  return runAllChecks(new Repo(root), { isTestFile }).findings;
}

function messages(findings: Finding[], rule?: string): string[] {
  return findings
    .filter((f) => !rule || f.rule === rule)
    .map((f) => `${f.severity}:${f.message}`);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"));
  write("docs/specs/spec.md", "# 目标\n");
  write("src/a.ts", "export function foo() {\n  return 1;\n}\n");
  write("tests/unit/a.test.ts", 'it("foo 返回 1", () => {});\n');
  statusTables([["TASK-X.1", "COMPLETED"]]);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("markdown 工具", () => {
  it("中文标题按 GitHub 规则生成锚点，重复标题追加序号", () => {
    expect(githubSlug("4.3 TASK-C.4 · 架构雷达 + Scope（建议）")).toBe(
      "43-task-c4--架构雷达--scope建议",
    );
    const anchors = collectAnchors(
      '# 概述\n## 概述\n<a id="task-c.4"></a>\n```\n# 不是标题\n```\n',
    );
    expect([...anchors]).toEqual(["概述", "概述-1", "task-c.4"]);
  });

  it("链接收集跳过围栏代码与行内代码", () => {
    const links = collectLinks(
      "[a](x.md)\n`[b](y.md)`\n```\n[c](z.md)\n```\n[d](w.md#k)",
    );
    expect(links.map((l) => l.target)).toEqual(["x.md", "w.md#k"]);
  });
});

describe("链接与锚点", () => {
  it("目标文件缺失与锚点缺失各报一条，外链忽略", () => {
    write(
      "docs/a.md",
      "[ok](./specs/spec.md#目标)\n[bad](./missing.md)\n[anchor](./specs/spec.md#不存在)\n[web](https://x.y)\n",
    );
    const msgs = checkLinks(new Repo(root), ["docs/a.md"]).map((f) => f.rule);
    expect(msgs).toEqual(["link-target", "link-anchor"]);
  });
});

describe("卡头 Schema", () => {
  it("合法卡头通过", () => {
    expect(cardHeaderSchema.safeParse(baseCard()).success).toBe(true);
  });

  it("COMPLETED 缺 delivered、READY 估算为 L、PASS 超过 12 条都被拒", () => {
    const { delivered: _d, ...noDelivered } = baseCard();
    expect(cardHeaderSchema.safeParse(noDelivered).success).toBe(false);
    expect(
      cardHeaderSchema.safeParse(baseCard({ status: "READY", estimate: "L" }))
        .success,
    ).toBe(false);
    const pass = Array.from({ length: 13 }, (_, i) => ({
      id: `P${i}`,
      test: "t.ts",
      case: "c",
      assert: "a",
    }));
    expect(cardHeaderSchema.safeParse(baseCard({ pass })).success).toBe(false);
  });

  it("READY 卡仍有未决问题被拒", () => {
    expect(
      cardHeaderSchema.safeParse(
        baseCard({ status: "READY", open_questions: ["谁来定"] }),
      ).success,
    ).toBe(false);
  });
});

describe("卡头对照代码", () => {
  it("合规的已完成卡零发现", () => {
    write("docs/specs/cards.md", cardDoc(baseCard()));
    expect(run()).toEqual([]);
  });

  it("交付符号未声明、用例标题找不到、测试不在 vitest 收录范围内都报 error", () => {
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          touches: [
            { path: "src/a.ts", action: "modify", symbols: ["foo", "bar"] },
          ],
          pass: [
            {
              id: "P1",
              test: "tests/unit/a.test.ts",
              case: "不存在的标题",
              assert: "x",
            },
            {
              id: "P2",
              test: "tests/elsewhere/a.test.ts",
              case: "foo 返回 1",
              assert: "x",
            },
          ],
        }),
      ),
    );
    write("tests/elsewhere/a.test.ts", 'it("foo 返回 1", () => {});\n');
    const msgs = messages(run());
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("交付的符号 bar"),
        expect.stringContaining("找不到标题含「不存在的标题」"),
        expect.stringContaining("不在 vitest include 范围内"),
      ]),
    );
  });

  it("被 skip 的用例不算兑现", () => {
    write("tests/unit/a.test.ts", 'it.skip("foo 返回 1", () => {});\n');
    write("docs/specs/cards.md", cardDoc(baseCard()));
    expect(messages(run())).toEqual([
      expect.stringContaining("被 skip / todo"),
    ]);
  });

  it("debt：没有用例时降为 warn；用例补上后要求删掉 debt", () => {
    const debtPass = [
      {
        id: "P1",
        test: "tests/unit/a.test.ts",
        case: "着色",
        assert: "x",
        debt: "未测",
      },
    ];
    write("docs/specs/cards.md", cardDoc(baseCard({ pass: debtPass })));
    expect(messages(run())).toEqual([
      expect.stringMatching(/^warn:.*挂账：未测/),
    ]);

    write("tests/unit/a.test.ts", 'it("着色正确", () => {});\n');
    expect(messages(run())).toEqual([
      expect.stringMatching(/^error:.*删掉 debt/),
    ]);
  });

  it("卡头状态与矩阵不一致、硬依赖未完成却已 READY 都报 error", () => {
    statusTables([
      ["TASK-X.1", "NEW_TASK"],
      ["TASK-X.2", "NEW_TASK"],
    ]);
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          id: "TASK-X.2",
          status: "READY",
          delivered: undefined,
          depends_on: [{ id: "TASK-X.1", kind: "hard" }],
        }),
      ),
    );
    const msgs = messages(run());
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("卡头状态 READY ≠"),
        expect.stringContaining("硬依赖 TASK-X.1 状态为 NEW_TASK"),
      ]),
    );
  });

  it("未开工卡：代码事实的符号与行号要对得上今天的代码", () => {
    statusTables([["TASK-X.1", "NEW_TASK"]]);
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          status: "NEW_TASK",
          delivered: undefined,
          code_facts: [
            { ref: "src/a.ts::gone", note: "x" },
            { ref: "src/a.ts:2-99", note: "x" },
          ],
        }),
      ),
    );
    expect(messages(run(), "card-code-fact")).toEqual([
      expect.stringContaining("符号找不到：src/a.ts::gone"),
      expect.stringContaining("行号越界"),
    ]);
  });

  it("依赖成环", () => {
    statusTables([
      ["TASK-X.1", "NEW_TASK"],
      ["TASK-X.2", "NEW_TASK"],
    ]);
    const common = { status: "NEW_TASK", delivered: undefined };
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          ...common,
          id: "TASK-X.1",
          depends_on: [{ id: "TASK-X.2" }],
        }),
        baseCard({
          ...common,
          id: "TASK-X.2",
          depends_on: [{ id: "TASK-X.1" }],
        }),
      ),
    );
    expect(messages(run(), "card-deps")).toEqual([
      expect.stringContaining("依赖成环：TASK-X.1 → TASK-X.2 → TASK-X.1"),
    ]);
  });

  it("矩阵与索引状态不同步", () => {
    write(
      INDEX_FILE,
      "| `TASK-X.1` | `NEW_TASK` | 说明 | 链接 |\n| `TASK-X.9` | `COMPLETED` | 说明 | 链接 |\n",
    );
    expect(messages(run(), "status-sync")).toEqual([
      expect.stringContaining(
        "TASK-X.1 索引状态 NEW_TASK ≠ 矩阵状态 COMPLETED",
      ),
      expect.stringContaining("TASK-X.9 在索引里有、在 §1.1 矩阵里没有"),
    ]);
  });
});

describe("声明识别", () => {
  it("只认声明，不认引用", () => {
    const src =
      "interface P {\n  onApply?: (x: string) => void;\n}\nexport { baz as qux };\nfoo();\nasync function run() {}\n";
    expect(declaresSymbol(src, "onApply")).toBe(true);
    expect(declaresSymbol(src, "baz")).toBe(true);
    expect(declaresSymbol(src, "run")).toBe(true);
    expect(declaresSymbol(src, "foo")).toBe(false);
  });

  it("用例标题支持三种引号与 test()", () => {
    expect(findTestCase("test(`甲 ${1}`, () => {})", "甲").found).toBe(true);
    expect(findTestCase("it('乙', () => {})", "乙").found).toBe(true);
    expect(findTestCase("describe('丙', () => {})", "丙").found).toBe(false);
  });
});

describe("scheme.md 溯源", () => {
  it("缺 qid 报 error，转述报 warn，逐字摘录无发现", () => {
    write(
      SCHEME_FILE,
      [
        "| qid | from | text |",
        "| :--- | :--- | :--- |",
        "| q1 | U1 | 我希望用户只提需求 |",
        "",
        "| id | text | source | evidence |",
        "| :--- | :--- | :--- | :--- |",
        "| goal-1 | 用户只提需求 | `user_said` | q1 |",
        "| goal-2 | 用户只说需求。 | `user_said` | q1 |",
        "| goal-3 | 没有出处 | `user_said` | — |",
        "| goal-4 | 引用不存在 | `user_said` | q9 |",
        "| goal-5 | 推断 | `ai_inferred` | — |",
      ].join("\n"),
    );
    expect(
      checkScheme(new Repo(root)).map(
        (f) => `${f.severity}:${f.message.split("，")[0]}`,
      ),
    ).toEqual([
      "warn:goal-2 标为 user_said",
      "error:goal-3 标为 user_said",
      "error:goal-4 引用的原话不存在：q9",
    ]);
  });
});
