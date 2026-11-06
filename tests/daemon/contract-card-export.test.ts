import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportContractCard } from "../../daemon/pipeline/contract-card-export";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { designNotePath } from "../../daemon/supervisor/design/design-step";
import { runExportCardCommand } from "../../bin/stagent";
import {
  contractCardSchema,
  designNoteFromCard,
} from "../../src/lib/contract-card";
import { createContractDraft } from "../../src/lib/contract.schema";
import type { DesignNote } from "../../src/lib/design/design-note";

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "card-export-"));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function seed(withNote: boolean) {
  const contract = createContractDraft({
    title: "导出样例",
    description: "合同导出为任务卡",
    acceptanceCriteria: ["能导出"],
    writablePaths: ["src/**", "tests/stagent/**"],
    commands: [
      {
        alias: "unit",
        executable: "npx",
        args: ["vitest", "run", "tests/stagent"],
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
    ],
  });
  new ContractStore(repo).save(contract);
  const note: DesignNote = {
    schema_version: "1.0.0",
    contract_id: contract.contract_id,
    approach: "直接导出",
    touches: [{ path: "src/a.ts", change: "modify", why: "x" }],
    interfaces: [],
    data_changes: [],
    dependencies: [],
    decisions: [],
    test_plan: [
      {
        acceptance_id: "AC-1",
        test_path: "tests/stagent/a.test.ts",
        level: "unit",
      },
    ],
    knowledge_delta: {
      modules_upsert: [],
      decisions_add: [],
      overview_changed: false,
    },
  };
  if (withNote) {
    const p = designNotePath(repo, contract.contract_id);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(note));
  }
  return { contract, note };
}

describe("stagent export-card", () => {
  it("合同 + design-note.json 导出为可解析的任务卡代码块，且不改动合同文件", () => {
    const { contract, note } = seed(true);
    const file = new ContractStore(repo).filePath(contract.contract_id);
    const before = fs.readFileSync(file, "utf8");

    const r = exportContractCard(repo, contract.contract_id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = r.markdown.slice(
      r.markdown.indexOf("\n") + 1,
      r.markdown.lastIndexOf("```"),
    );
    const card = contractCardSchema.parse(yaml.load(body));
    expect(card.id).toBe(contract.contract_id);
    expect(card.status).toBe("NEW_TASK");
    expect(designNoteFromCard(card)).toEqual(note);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("没有 DesignNote 时拒绝导出并说明原因", () => {
    const { contract } = seed(false);
    const r = exportContractCard(repo, contract.contract_id);
    expect(r).toMatchObject({ ok: false, reason: "DESIGN_NOTE_MISSING" });
  });

  it("CLI：缺参数退出码 2，合同不存在退出码 1，成功输出代码块", () => {
    expect(runExportCardCommand([]).exitCode).toBe(2);
    expect(
      runExportCardCommand(["--contract-id", "nope", "--repo", repo]),
    ).toMatchObject({
      exitCode: 1,
      stdout: expect.stringContaining("CONTRACT_NOT_FOUND"),
    });
    const { contract } = seed(true);
    const ok = runExportCardCommand([
      "--contract-id",
      contract.contract_id,
      "--repo",
      repo,
    ]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("```yaml task-card");
  });
});
