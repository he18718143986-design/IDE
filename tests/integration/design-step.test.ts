/**
 * TASK-L.11：设计步骤接入 EXECUTING 生产路径。
 * - 合法 DesignNote → Worker 指令含「技术方案」与 touches
 * - costs_money → PENDING_RESUME + DESIGN_ESCALATION
 * - DN-2「可以」→ ABORTED + dependency 桩 + 允许路径不改合同字节
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import type { DesignNoteGenerator } from "../../daemon/supervisor/design/design-step";
import type { DesignNote } from "../../src/lib/design/design-note";
import { writePlan, readPlan } from "../../daemon/project/plan-store";
import type {
  ContractStub,
  ProjectPlan,
  ProjectPlanScheme,
  RepoFacts,
} from "../../src/lib/project/project-plan";
import { emptyDraft } from "../helpers/scheme-patch-fixtures";
import type { WorkerModelClient } from "../../daemon/worker/ai-worker";

const FACTS: RepoFacts = {
  has_test_script: true,
  has_modules_yaml: true,
  existing_dirs: ["src", "tests"],
};

function scheme(): ProjectPlanScheme {
  return emptyDraft({
    size_hint: "standard",
    goals: [
      {
        id: "g-1",
        text: "完成功能",
        source: "user_said",
        evidence: [],
        user_pinned: false,
        updated_in_revision: 1,
      },
    ],
    modules: [
      {
        id: "m-1",
        name: "核心",
        purpose: "业务",
        user_visible: true,
        kind: "new",
        source: "user_said",
        evidence: [],
        user_pinned: false,
        updated_in_revision: 1,
      },
    ],
    acceptance: [
      {
        id: "ac-1",
        text: "能用",
        source: "user_said",
        evidence: [],
        user_pinned: false,
        updated_in_revision: 1,
      },
    ],
    entities: [],
  });
}

function makeNote(
  contract: SoftwareContract,
  over: Partial<DesignNote> = {},
): DesignNote {
  const refs = contract.supervisor_metadata?.acceptance_refs ?? [];
  const auto = refs.filter((r) => r.check === "auto" || r.check === "both");
  return {
    schema_version: "1.0.0",
    contract_id: contract.contract_id,
    approach: "按合同做 src/feature.ts 改动。",
    touches: [
      {
        path: "src/feature.ts",
        change: "create",
        why: "新功能入口",
      },
    ],
    interfaces: [],
    data_changes: [],
    dependencies: [],
    decisions: [],
    test_plan: auto.map((r) => ({
      acceptance_id: r.id,
      test_path: `tests/stagent/${r.id}.test.ts`,
      level: "unit" as const,
    })),
    knowledge_delta: {
      modules_upsert: [],
      decisions_add: [],
      overview_changed: false,
    },
    ...over,
  };
}

describe("TASK-L.11 design-step 生产路径", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l11-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.mkdirSync(path.join(repo, "tests", "stagent"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "l11",
        private: true,
        scripts: { test: "node -e \"process.exit(0)\"" },
      }),
      "utf8",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  function seed(opts: {
    dependencyChangesAllowed?: boolean;
    stubId?: string | null;
  } = {}) {
    const draft = createContractDraft({
      title: "L.11 design",
      description: "design step wiring",
      acceptanceCriteria: ["能用"],
      writablePaths: ["src/**", "tests/**"],
      maxVerificationRetries: 3,
      supervisorMetadata: {
        suggestion_id: "scheme:l11",
        acceptance_refs: [{ id: "ac-1", text: "能用", check: "auto" }],
        scheme_item_ids: ["ac-1", "g-1"],
        stub_id: opts.stubId ?? null,
      },
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    let contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    if (opts.dependencyChangesAllowed !== undefined) {
      contract = {
        ...contract,
        authorization: {
          ...contract.authorization,
          execution_permissions: {
            ...contract.authorization.execution_permissions,
            dependency_changes_allowed: opts.dependencyChangesAllowed,
          },
        },
      };
    }
    new ContractStore(repo).save(contract);
    return contract;
  }

  it("合法 DesignNote → Worker 指令含「技术方案」与 touches", async () => {
    const seeded = seed();
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    await orchestrator.approve(seeded.contract_id, "tina");
    const live = new ContractStore(repo).get(seeded.contract_id)!;

    const generator: DesignNoteGenerator = () => ({
      note: makeNote(live),
    });

    let capturedPrompt = "";
    const modelClient: WorkerModelClient = {
      generateChanges: async (input) => {
        capturedPrompt = input.task.system_prompt;
        return {
          changes: [
            {
              path: "src/feature.ts",
              content: "export const feature = true;\n",
            },
          ],
          log: ["ok"],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };

    const result = await orchestrator.runWorker(seeded.contract_id, {
      modelClient,
      designNoteGenerator: generator,
      twoPhase: {
        // 无义务两段：用 playtest-only 会走单段；这里仍可能因 auto 义务走两段
        // 桩报告：避免真跑测试
        obligations: [],
        waived: [],
        readObligationReport: () => ({
          schema: "stagent-obligation-report-v1",
          test_count: 0,
          assertion_failures: 0,
          collection_or_compile_errors: 0,
        }),
      },
    });

    expect(result.design?.status).toBe("ok");
    expect(capturedPrompt).toContain("## 技术方案");
    expect(capturedPrompt).toContain("src/feature.ts");
    expect(capturedPrompt).toContain("新功能入口");

    const dnPath = path.join(
      repo,
      ".stagent",
      "records",
      seeded.contract_id,
      "design-note.json",
    );
    expect(fs.existsSync(dnPath)).toBe(true);
    const oblPath = path.join(
      repo,
      ".stagent",
      "records",
      seeded.contract_id,
      "obligations.json",
    );
    expect(fs.existsSync(oblPath)).toBe(true);
  });

  it("costs_money 决策 → PENDING_RESUME + DESIGN_ESCALATION", async () => {
    const seeded = seed({ dependencyChangesAllowed: true });
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    await orchestrator.approve(seeded.contract_id, "tina");
    const live = new ContractStore(repo).get(seeded.contract_id)!;

    const generator: DesignNoteGenerator = () => ({
      note: makeNote(live, {
        dependencies: [
          { name: "stripe", version: "14.0.0", why: "收款" },
        ],
        // 故意不标注 costs_money；二次判定应补上
        decisions: [],
      }),
    });

    let modelCalled = false;
    const result = await orchestrator.runWorker(seeded.contract_id, {
      designNoteGenerator: generator,
      modelClient: {
        generateChanges: async () => {
          modelCalled = true;
          return {
            changes: [],
            log: [],
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
      },
    });

    expect(modelCalled).toBe(false);
    expect(result.design?.status).toBe("suspended");
    expect(result.design?.reason).toBe("DESIGN_ESCALATION");
    expect(result.applied).toBe(false);

    const after = new ContractStore(repo).get(seeded.contract_id)!;
    expect(after.lifecycle_state).toBe("PENDING_RESUME");

    const suspension = JSON.parse(
      fs.readFileSync(
        path.join(
          repo,
          ".stagent",
          "records",
          seeded.contract_id,
          "suspension.json",
        ),
        "utf8",
      ),
    ) as { reason: string; phase: string };
    expect(suspension.reason).toBe("DESIGN_ESCALATION");
    expect(suspension.phase).toBe("design");
  });

  it("DN-2 选「可以」→ ABORTED + dependency 桩 + 允许路径合同字节未变", async () => {
    const stubId = "cs-feature-1";
    const seeded = seed({
      dependencyChangesAllowed: false,
      stubId,
    });
    const store = new ContractStore(repo);
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    await orchestrator.approve(seeded.contract_id, "tina");
    const live = store.get(seeded.contract_id)!;

    const featureStub: ContractStub = {
      stub_id: stubId,
      milestone_id: "ms-1",
      kind: "feature",
      origin: "scheme",
      title: "做功能",
      scheme_item_ids: ["g-1", "m-1"],
      acceptance_ids: ["ac-1"],
      area_hints: ["src"],
      depends_on: [],
      size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
      status: "signed",
      contract_id: live.contract_id,
    };
    const sch = scheme();
    const plan: ProjectPlan = {
      schema_version: "1.0.0",
      project_id: "proj-l11",
      plan_revision: 1,
      architecture_baseline_ref: {
        baseline_id: "pab-1",
        baseline_revision: 1,
        baseline_digest: "digest-1",
      },
      scheme_id: sch.scheme_id,
      scheme_revision: sch.scheme_revision,
      milestones: [
        {
          milestone_id: "ms-1",
          title: "第一期",
          exit_acceptance_ids: ["ac-1"],
          contract_ids: [stubId],
        },
      ],
      contracts: [featureStub],
      graveyard: [],
    };
    writePlan(repo, plan);

    const deps = [
      { name: "left-pad", version: "1.3.0", why: "必须用" },
    ];
    const generator: DesignNoteGenerator = (input) => {
      if (input.forbidDependencies) {
        return {
          note: makeNote(live, { dependencies: [] }),
          stillNeedsDependencies: true,
          neededDependencies: deps,
        };
      }
      return {
        note: makeNote(live, { dependencies: deps }),
      };
    };

    const run = await orchestrator.runWorker(seeded.contract_id, {
      designNoteGenerator: generator,
      modelClient: {
        generateChanges: async () => ({
          changes: [],
          log: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      },
    });
    expect(run.design?.status).toBe("suspended");
    expect(run.design?.reason).toBe("DESIGN_NEEDS_DEPENDENCY");
    expect(store.get(seeded.contract_id)!.lifecycle_state).toBe(
      "PENDING_RESUME",
    );

    const resolved = await orchestrator.resolveDesignDependencyAllow(
      seeded.contract_id,
      {
        plan: readPlan(repo)!,
        scheme: sch,
        repoFacts: FACTS,
        originalStubId: stubId,
        dependencies: deps,
      },
    );

    expect(resolved.contractBytesAfterAllow).toBe(
      resolved.contractBytesBeforeAllow,
    );
    expect(resolved.aborted.lifecycle_state).toBe("ABORTED");
    expect(
      resolved.aborted.authorization.execution_permissions
        .dependency_changes_allowed,
    ).toBe(false);

    const afterPlan = readPlan(repo)!;
    const depStub = afterPlan.contracts.find((c) => c.kind === "dependency");
    expect(depStub).toBeTruthy();
    expect(depStub?.context?.dependency?.name).toBe("left-pad");
    expect(resolved.dependencyStubId).toBe(depStub!.stub_id);

    const ms = afterPlan.milestones.find((m) => m.milestone_id === "ms-1")!;
    const depIdx = ms.contract_ids.indexOf(depStub!.stub_id);
    const origIdx = ms.contract_ids.indexOf(stubId);
    expect(depIdx).toBeGreaterThanOrEqual(0);
    expect(depIdx).toBeLessThan(origIdx);
  });
});
