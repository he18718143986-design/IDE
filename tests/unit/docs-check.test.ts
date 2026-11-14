import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  runAllChecks,
  type Finding,
} from "../../scripts/docs-check/checks";
import {
  collectAnchors,
  collectLinks,
  githubSlug,
} from "../../scripts/docs-check/markdown";

let root: string;

function write(rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

interface CardOverrides {
  id?: string;
  status?: string;
  touches?: Record<string, unknown>[];
  test_plan?: Record<string, unknown>[];
  commands?: Record<string, unknown>[];
  writable_paths?: string[];
  governance?: Record<string, unknown>;
}

function baseCard(o: CardOverrides = {}) {
  const status = o.status ?? "COMPLETED";
  return {
    id: o.id ?? "TASK-X.1",
    status,
    contract: {
      intent: {
        title: "示例卡",
        description: "用户能看见示例",
        risk_level: "LOW",
      },
      acceptance: [{ id: "P1", text: "foo() === 1", check: "auto" }],
      scope: { writable_paths: o.writable_paths ?? ["src/**", "tests/**"] },
      verification: {
        commands: o.commands ?? [
          {
            alias: "unit",
            executable: "npx",
            args: ["vitest", "run", "tests/unit"],
          },
        ],
      },
    },
    design: {
      approach: "改 foo",
      touches: o.touches ?? [
        { path: "src/a.ts", change: "modify", why: "x", symbols: ["foo"] },
      ],
      test_plan: o.test_plan ?? [
        {
          acceptance_id: "P1",
          test_path: "tests/unit/a.test.ts",
          level: "unit",
          case: "foo 返回 1",
        },
      ],
    },
    governance: {
      spec_refs: ["docs/specs/spec.md#目标"],
      code_facts: [{ ref: "src/a.ts::foo", note: "旧实现" }],
      non_goals: ["不做别的"],
      fail: ["foo 抛错"],
      estimate: "S",
      invariants: {
        auth: "unchanged",
        demo_origin: "unchanged",
        illumination: "unchanged",
        gateway_write_scope: "unchanged",
      },
      ...(status === "COMPLETED"
        ? { delivered: { pr: 1, commit: "abcdef0" } }
        : {}),
      ...o.governance,
    },
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
  return runAllChecks(new Repo(root), {
    testInclude: ["tests/unit/**/*.test.ts"],
    testExclude: [],
  }).findings;
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

describe("卡的就绪字段与 Schema", () => {
  it("缺就绪字段、id 不是任务卡号都报 error", () => {
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          governance: {
            non_goals: [],
            fail: [],
            estimate: undefined,
            delivered: undefined,
          },
        }),
        { ...baseCard(), id: "contract_123" },
      ),
    );
    const msgs = messages(run());
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("R-6：non_goals 为空"),
        expect.stringContaining("R-8：fail 为空"),
        expect.stringContaining("R-11：缺 estimate"),
        expect.stringContaining("COMPLETED 必须写 governance.delivered"),
        expect.stringContaining("卡号形如 TASK-C.4"),
      ]),
    );
  });

  it("READY 估算为 L 被 Schema 拒绝", () => {
    statusTables([["TASK-X.1", "READY"]]);
    write(
      "docs/specs/cards.md",
      cardDoc(baseCard({ status: "READY", governance: { estimate: "L" } })),
    );
    expect(messages(run(), "card-schema")).toEqual([
      expect.stringContaining("估算 L"),
    ]);
  });

  it("IN_PROGRESS 估算为 L 被 Schema 拒绝", () => {
    statusTables([["TASK-X.1", "IN_PROGRESS"]]);
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({ status: "IN_PROGRESS", governance: { estimate: "L" } }),
      ),
    );
    expect(messages(run(), "card-schema")).toEqual([
      expect.stringContaining("估算 L"),
    ]);
  });

  it("COMPLETED 估算为 L 且已写 delivered 被 Schema 接受", () => {
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({ status: "COMPLETED", governance: { estimate: "L" } }),
      ),
    );
    expect(messages(run(), "card-schema")).toEqual([]);
  });

  it("COMPLETED 估算为 L 但缺少 delivered 仍被拒绝", () => {
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          status: "COMPLETED",
          governance: { estimate: "L", delivered: undefined },
        }),
      ),
    );
    expect(messages(run(), "card-dor")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("COMPLETED 必须写 governance.delivered"),
      ]),
    );
  });
});

describe("卡对照代码", () => {
  it("合规的已完成卡零发现", () => {
    write("docs/specs/cards.md", cardDoc(baseCard()));
    expect(run()).toEqual([]);
  });

  it("交付符号未声明、用例标题找不到、测试不在收录范围内都报 error", () => {
    write("tests/elsewhere/a.test.ts", 'it("foo 返回 1", () => {});\n');
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          touches: [
            {
              path: "src/a.ts",
              change: "modify",
              why: "x",
              symbols: ["foo", "bar"],
            },
          ],
          commands: [
            { alias: "t", executable: "npx", args: ["vitest", "run", "tests"] },
          ],
          test_plan: [
            {
              acceptance_id: "P1",
              test_path: "tests/unit/a.test.ts",
              level: "unit",
              case: "不存在的标题",
            },
            {
              acceptance_id: "P1",
              test_path: "tests/elsewhere/a.test.ts",
              level: "unit",
              case: "foo 返回 1",
            },
          ],
        }),
      ),
    );
    expect(messages(run())).toEqual(
      expect.arrayContaining([
        expect.stringContaining("交付的符号 bar"),
        expect.stringContaining("找不到标题含「不存在的标题」"),
        expect.stringContaining("不在 vitest include 范围内"),
      ]),
    );
  });

  it("DN-1：改动落在写范围之外；测试没被任何验证命令跑到", () => {
    write(
      "docs/specs/cards.md",
      cardDoc(baseCard({ writable_paths: ["lib/**", "tests/**"] })),
    );
    expect(messages(run(), "card-design")).toEqual([
      expect.stringContaining(
        "DN-1：touches path out of writable_paths: src/a.ts",
      ),
    ]);

    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          commands: [
            { alias: "lint", executable: "npm", args: ["run", "lint"] },
          ],
        }),
      ),
    );
    expect(messages(run(), "card-verification")).toEqual([
      expect.stringContaining("没有被任何验证命令跑到"),
    ]);
  });

  it("被 skip 的用例不算兑现", () => {
    write("tests/unit/a.test.ts", 'it.skip("foo 返回 1", () => {});\n');
    write("docs/specs/cards.md", cardDoc(baseCard()));
    expect(messages(run())).toEqual([
      expect.stringContaining("被 skip / todo"),
    ]);
  });

  it("debt：没有用例时降为 warn；用例补上后要求删掉 debt", () => {
    const test_plan = [
      {
        acceptance_id: "P1",
        test_path: "tests/unit/a.test.ts",
        level: "unit",
        case: "着色",
        debt: "未测",
      },
    ];
    write("docs/specs/cards.md", cardDoc(baseCard({ test_plan })));
    expect(messages(run())).toEqual([
      expect.stringMatching(/^warn:.*挂账：未测/),
    ]);

    write("tests/unit/a.test.ts", 'it("着色正确", () => {});\n');
    expect(messages(run())).toEqual([
      expect.stringMatching(/^error:.*删掉 debt/),
    ]);
  });

  it("卡状态与矩阵不一致、硬依赖未完成却已 READY 都报 error", () => {
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
          governance: { depends_on: [{ id: "TASK-X.1", kind: "hard" }] },
        }),
      ),
    );
    expect(messages(run())).toEqual(
      expect.arrayContaining([
        expect.stringContaining("卡状态 READY ≠"),
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
          governance: {
            code_facts: [
              { ref: "src/a.ts::gone", note: "x" },
              { ref: "src/a.ts:2-99", note: "x" },
            ],
          },
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
    write(
      "docs/specs/cards.md",
      cardDoc(
        baseCard({
          status: "NEW_TASK",
          id: "TASK-X.1",
          governance: { depends_on: [{ id: "TASK-X.2" }] },
        }),
        baseCard({
          status: "NEW_TASK",
          id: "TASK-X.2",
          governance: { depends_on: [{ id: "TASK-X.1" }] },
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
  it("缺 qid / 引用不存在报 error，与原话无共同词素报 warn，栓住即无发现", () => {
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
        "| goal-2 | 完全无关的表述 | `user_said` | q1 |",
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

describe("命名与死引用（文档治理）", () => {
  it("kebab-case 文件名通过；大写或中文文件名报 error；reports/ 日期后缀与约定大写名豁免", () => {
    write("docs/rfc/v0.2-scope.md", "# ok\n");
    write("docs/reports/full-audit-2026-10-31.md", "# ok\n");
    write("docs/CONTRIBUTING.md", "# ok\n");
    write("docs/Bad_Name.md", "# bad\n");
    write("docs/reports/完整纪要-2026-10-31.md", "# bad\n");
    const found = messages(run(), "filename-kebab");
    expect(found).toHaveLength(2);
    expect(found.some((m) => m.includes("Bad_Name.md"))).toBe(true);
    expect(found.some((m) => m.includes("完整纪要-2026-10-31.md"))).toBe(true);
  });

  it("正文里的 docs/archive/ 溯源语境放行，活引用报 warn", () => {
    write("docs/a.md", "旧稿见 Git 历史（原 `docs/archive/x.md`）\n");
    write("docs/b.md", "参考 docs/archive/y.md 的设计\n");
    const found = run().filter((f) => f.rule === "archive-ref");
    expect(found.map((f) => f.file)).toEqual(["docs/b.md"]);
    expect(found[0]!.severity).toBe("warn");
  });
});
