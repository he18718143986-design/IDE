/**
 * TASK-L.12 / technical-design-and-knowledge §6：TD-06～TD-08、TD-10。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { checkKnowledge } from "../../daemon/knowledge/check-knowledge";
import {
  coversPath,
  hasDependsOnCycle,
  type ModuleEntry,
} from "../../src/lib/knowledge/modules-schema";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { runCheckCommand } from "../../bin/stagent";
import type { DesignNote } from "../../src/lib/design/design-note";

function writeModulesYaml(
  root: string,
  modules: ModuleEntry[],
): void {
  const dir = path.join(root, "docs", "system");
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    "schema_version: \"1.0.0\"",
    "modules:",
  ];
  for (const m of modules) {
    body.push(`  - id: ${m.id}`);
    body.push(`    name: ${JSON.stringify(m.name)}`);
    body.push(`    purpose: ${JSON.stringify(m.purpose)}`);
    body.push(`    paths:`);
    for (const p of m.paths) body.push(`      - ${JSON.stringify(p)}`);
    body.push(`    depends_on: [${m.depends_on.map((d) => JSON.stringify(d)).join(", ")}]`);
    body.push(`    interfaces: [${m.interfaces.map((i) => JSON.stringify(i)).join(", ")}]`);
    body.push(`    introduced_by: ${JSON.stringify(m.introduced_by)}`);
    body.push(`    updated_by: []`);
  }
  fs.writeFileSync(path.join(dir, "modules.yaml"), body.join("\n") + "\n");
}

function initRepo(): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l12-kb-")),
  );
  git(root, ["init"]);
  git(root, ["config", "user.email", "l12@test.local"]);
  git(root, ["config", "user.name", "L12 Test"]);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

const baseModule = (over: Partial<ModuleEntry> = {}): ModuleEntry => ({
  id: "core",
  name: "核心",
  purpose: "核心代码",
  paths: ["src/**"],
  depends_on: [],
  interfaces: [],
  introduced_by: "bootstrap",
  updated_by: [],
  ...over,
});

describe("TASK-L.12 coversPath / hasDependsOnCycle", () => {
  it("coversPath 复用 glob 口径", () => {
    expect(coversPath([baseModule()], "src/a.ts")).toBe(true);
    expect(coversPath([baseModule()], "lib/a.ts")).toBe(false);
  });

  it("hasDependsOnCycle 检测环", () => {
    expect(
      hasDependsOnCycle([
        baseModule({ id: "a", depends_on: ["b"] }),
        baseModule({ id: "b", depends_on: ["a"], paths: ["b/**"] }),
      ]),
    ).toBe(true);
    expect(
      hasDependsOnCycle([
        baseModule({ id: "a", depends_on: ["b"] }),
        baseModule({ id: "b", depends_on: [], paths: ["b/**"] }),
      ]),
    ).toBe(false);
  });
});

describe("TASK-L.12 checkKnowledge TD-06～TD-08", () => {
  let root: string;
  let baseSha: string;

  beforeEach(() => {
    root = initRepo();
    baseSha = git(root, ["rev-parse", "HEAD"]).trim();
  });

  afterEach(() => {
    safeRmSync(root);
  });

  it("TD-06：改动文件不被覆盖 → KB-1", () => {
    writeModulesYaml(root, [
      baseModule({ paths: ["src/legacy/**"] }),
    ]);
    fs.mkdirSync(path.join(root, "docs", "system"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "system", "changelog.md"),
      "## c-td06\n- ok\n",
    );
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "modules"]);
    const afterModules = git(root, ["rev-parse", "HEAD"]).trim();

    fs.mkdirSync(path.join(root, "src", "new"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "new", "x.ts"), "export const x = 1;\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "add uncovered"]);
    const candidate = git(root, ["rev-parse", "HEAD"]).trim();

    const result = checkKnowledge({
      worktreeDir: root,
      baseSha: afterModules,
      candidateSha: candidate,
      contractId: "c-td06",
    });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.rule === "KB-1")).toBe(true);
    expect(
      result.failures.some(
        (f) => f.rule === "KB-1" && f.target.includes("src/new/x.ts"),
      ),
    ).toBe(true);
  });

  it("TD-07：缺 changelog 本合同条目 → KB-2", () => {
    writeModulesYaml(root, [baseModule()]);
    fs.writeFileSync(
      path.join(root, "docs", "system", "changelog.md"),
      "## other-contract\n- unrelated\n",
    );
    fs.writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2;\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "change"]);
    const candidate = git(root, ["rev-parse", "HEAD"]).trim();

    const result = checkKnowledge({
      worktreeDir: root,
      baseSha,
      candidateSha: candidate,
      contractId: "c-td07",
    });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.rule === "KB-2")).toBe(true);
  });

  it("TD-08：modules.yaml 依赖成环 → KB-4", () => {
    writeModulesYaml(root, [
      baseModule({ id: "a", depends_on: ["b"], paths: ["src/**"] }),
      baseModule({ id: "b", depends_on: ["a"], paths: ["lib/**"] }),
    ]);
    fs.writeFileSync(
      path.join(root, "docs", "system", "changelog.md"),
      "## c-td08\n- cycle\n",
    );
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "cycle"]);
    const candidate = git(root, ["rev-parse", "HEAD"]).trim();

    const result = checkKnowledge({
      worktreeDir: root,
      baseSha,
      candidateSha: candidate,
      contractId: "c-td08",
    });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.rule === "KB-4")).toBe(true);
  });

  it("CLI stagent check knowledge 失败出口码 1 且 reason_code=KNOWLEDGE_DRIFT", () => {
    writeModulesYaml(root, [
      baseModule({ paths: ["src/legacy/**"] }),
    ]);
    fs.writeFileSync(
      path.join(root, "docs", "system", "changelog.md"),
      "## c-cli\n- x\n",
    );
    fs.mkdirSync(path.join(root, "src", "new"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "new", "x.ts"), "export const x = 1;\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "uncovered"]);
    const candidate = git(root, ["rev-parse", "HEAD"]).trim();

    const prev = process.cwd();
    process.chdir(root);
    try {
      const out = runCheckCommand([
        "knowledge",
        "--base",
        baseSha,
        "--candidate",
        candidate,
        "--contract-id",
        "c-cli",
        "--worktree",
        root,
      ]);
      expect(out.exitCode).toBe(1);
      const parsed = JSON.parse(out.stdout) as {
        ok: boolean;
        reason_code?: string;
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.reason_code).toBe("KNOWLEDGE_DRIFT");
    } finally {
      process.chdir(prev);
    }
  });

  it("KB-3 / KB-5：decisions_add 与 interfaces 落盘校验", () => {
    writeModulesYaml(root, [
      baseModule({ interfaces: ["FooAPI"] }),
    ]);
    fs.writeFileSync(
      path.join(root, "docs", "system", "changelog.md"),
      "## c-kb35\n- ok\n",
    );
    // 故意不写 decisions / interfaces 文件
    fs.writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2;\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "change"]);
    const candidate = git(root, ["rev-parse", "HEAD"]).trim();

    const note: DesignNote = {
      schema_version: "1.0.0",
      contract_id: "c-kb35",
      approach: "test",
      touches: [],
      interfaces: [
        {
          name: "FooAPI",
          kind: "http",
          signature: "POST /foo",
          consumers: ["core"],
        },
      ],
      data_changes: [],
      dependencies: [],
      decisions: [],
      test_plan: [],
      knowledge_delta: {
        modules_upsert: [],
        decisions_add: ["DEC-L12-1"],
        overview_changed: false,
      },
    };

    const result = checkKnowledge({
      worktreeDir: root,
      baseSha,
      candidateSha: candidate,
      contractId: "c-kb35",
      designNote: note,
    });
    expect(result.failures.some((f) => f.rule === "KB-3")).toBe(true);
    expect(result.failures.some((f) => f.rule === "KB-5")).toBe(true);
  });
});

describe("TASK-L.12 TD-10：docs/system/** 不计入文件预算", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l12-budget-")),
    );
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs", "system"), { recursive: true });
  });

  afterEach(() => {
    safeRmSync(root);
  });

  it("写入 docs/system 不触发 max_file_modifications=1 熔断；写入 src 会", async () => {
    const draft = createContractDraft({
      title: "L.12 budget",
      description: "docs/system 不计预算",
      acceptanceCriteria: ["预算排除知识库"],
      writablePaths: ["src/**", "docs/system/**"],
      maxFileModifications: 1,
      commands: [
        {
          alias: "noop",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    const contract = softwareContractSchema.parse(draft);
    const gateway = new ScopedWorktreeGateway(root, contract);

    const docsWrite = await gateway.callTool("stagent_write_file", {
      path: "docs/system/modules.yaml",
      content: "schema_version: \"1.0.0\"\nmodules: []\n",
    });
    expect(docsWrite.isError).toBeFalsy();

    const docsWrite2 = await gateway.callTool("stagent_write_file", {
      path: "docs/system/changelog.md",
      content: "## c\n",
    });
    expect(docsWrite2.isError).toBeFalsy();

    const srcWrite = await gateway.callTool("stagent_write_file", {
      path: "src/only.ts",
      content: "export {};\n",
    });
    expect(srcWrite.isError).toBeFalsy();

    const srcWrite2 = await gateway.callTool("stagent_write_file", {
      path: "src/two.ts",
      content: "export {};\n",
    });
    expect(srcWrite2.isError).toBeTruthy();
    expect(srcWrite2.error?.code).toBe("BUDGET_EXCEEDED");
  });
});
