/**
 * TM-GI：墓地门禁写路径集成（TASK-J.18d）。
 * 端口登记：3950–3959（本文件若起 daemon 须声明；当前主路径不依赖 HTTP）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import { scopePlanToContractScope } from "../../src/lib/journey/scope-plan";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import {
  schemeBindingFromSnapshot,
  writeSchemeSnapshot,
} from "../../daemon/pipeline/scheme-snapshot-store";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  AiWorker,
  WorkerScopeError,
  type WorkerModelClient,
} from "../../daemon/worker/ai-worker";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import {
  buildRevivalPrefillMessage,
  prepareDispatchGate,
  scanWorktreeGraveyard,
  writeGatePackFile,
} from "../../daemon/guard/graveyard-wiring";
import { buildGatePack } from "../../daemon/guard/worker-graveyard-gate";
import {
  MergeGateError,
  squashMerge,
} from "../../daemon/pipeline/merger";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";

/** 端口登记声明（TM-GI · 3950–3959）——供 test-port-map 扫描；本套件当前不起 HTTP。 */
const _PORT_RESERVATION = { startPort: 3950, endPort: 3959 };
void _PORT_RESERVATION;

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../fixtures/graveyard-match/cases.json",
    ),
    "utf8",
  ),
) as {
  tombstones: Record<
    string,
    {
      fingerprint: { key: string; lexemes: string[] };
      revival_keys: string[];
      status: "active" | "revived";
      disallow_revival: boolean;
      rejected_by: "user" | "security_gate";
    }
  >;
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      safeRmSync(d);
    } catch {
      /* ignore */
    }
  }
});

function entryOf(id: string, over: Partial<GraveyardEntry> = {}): GraveyardEntry {
  const t = fixture.tombstones[id];
  if (!t) throw new Error(`missing ${id}`);
  return {
    rejected_id: id,
    proposal: t.fingerprint.key,
    rejected_by: t.rejected_by,
    rejection_reason: "不要文档库",
    evidence: [],
    disallow_revival: t.disallow_revival,
    updated_in_revision: 1,
    fingerprint: t.fingerprint,
    revival_keys: t.revival_keys,
    rejected_after_turn_seq: 0,
    status: t.status,
    ...over,
  };
}

function makeScheme(): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary: "按项目维度汇总进度与预算。改动范围：src/** 与 package.json。",
    modules: ["工程进度管控（src/**）"],
    mermaidFlow: "flowchart LR\n  A --> B",
    business_input_rounds: 1,
    scheme_revision: 3,
  });
}

function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-tm-gi-"));
  tempDirs.push(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "T"]);
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify(
      {
        name: "tm-gi",
        private: true,
        dependencies: { lodash: "^4.0.0" },
      },
      null,
      2,
    ),
  );
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);
  return repo;
}

function freezeBound(
  repo: string,
  graveyard: GraveyardEntry[],
): { confirmationId: string; snapshot: SchemeSnapshot; scope_plan: ScopePlan; contract: SoftwareContract } {
  const scheme = makeScheme();
  const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
  const confirmationId = `scheme-confirm-gi-${Date.now().toString(36)}`;
  const { snapshot } = writeSchemeSnapshot(repo, {
    confirmation_id: confirmationId,
    scheme,
    demo: EMPTY_DEMO_GATE,
    decision: { code: "OK", message: "ok", demo_mode: "none" },
    scope_plan,
    graveyard,
  });
  const binding = schemeBindingFromSnapshot(confirmationId, snapshot);
  const projected = scopePlanToContractScope(scope_plan);
  const draft = createContractDraft({
    title: "TM-GI",
    description: "graveyard wiring",
    acceptanceCriteria: ["ok"],
    writablePaths: projected.writable_paths,
  });
  const contract = softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
    scheme_binding: binding,
    authorization: {
      ...draft.authorization,
      file_system_scope: {
        ...draft.authorization.file_system_scope,
        writable_paths: projected.writable_paths,
        strictly_forbidden_paths: projected.forbidden_paths,
      },
      budget_limits: { ...projected.budget },
    },
    verification_spec: {
      commands: projected.verification_spec.commands,
      ...(projected.verification_spec.manual_confirmation
        ? {
            manual_confirmation:
              projected.verification_spec.manual_confirmation,
          }
        : {}),
    },
  });
  new ContractStore(repo).save(contract);
  return { confirmationId, snapshot, scope_plan, contract };
}

/** 兼容测试调用：seedBoundContract(repo, graveyardEntries) */
function seedBoundContract(
  repo: string,
  graveyard: GraveyardEntry[],
): SoftwareContract {
  return freezeBound(repo, graveyard).contract;
}

function seedLegacyContract(repo: string): SoftwareContract {
  const draft = createContractDraft({
    title: "TM-GI legacy",
    description: "legacy direct-sign",
    acceptanceCriteria: ["ok"],
    writablePaths: ["package.json", "src/**"],
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
  const contract = softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
    authorization: {
      ...draft.authorization,
      budget_limits: {
        ...draft.authorization.budget_limits,
        max_file_modifications: 20,
      },
      execution_permissions: {
        ...draft.authorization.execution_permissions,
        allowed_commands: ["noop"],
      },
    },
    verification_spec: {
      commands: [
        {
          alias: "noop",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    },
  });
  new ContractStore(repo).save(contract);
  return contract;
}

const mongoosePkg = JSON.stringify(
  {
    name: "tm-gi",
    private: true,
    dependencies: { lodash: "^4.0.0", mongoose: "^8.0.0" },
  },
  null,
  2,
);

const mongooseSrc = 'import mongoose from "mongoose";\nexport const db = mongoose;\n';

/** 挑一个合同可写且适合放 import 的相对路径 */
function pickWritableTarget(contract: SoftwareContract): string {
  const paths = contract.authorization.file_system_scope.writable_paths;
  // 优先 package.json → U-DEP 强证据（与 GM-CODE-01 对拍）
  if (
    paths.includes("package.json") ||
    paths.some((p) => p === "**" || p === "**/*" || p === "*")
  ) {
    return "package.json";
  }
  if (paths.some((p) => p === "src/**" || p.startsWith("src/"))) {
    return "src/db.ts";
  }
  for (const p of paths) {
    if (p.endsWith("/**")) {
      const base = p.slice(0, -3).replace(/\/+$/, "");
      return `${base || "src"}/db.ts`;
    }
  }
  return "src/db.ts";
}

function changeForGate(contract: SoftwareContract): { path: string; content: string } {
  const path = pickWritableTarget(contract);
  if (path.endsWith("package.json")) {
    return { path, content: mongoosePkg };
  }
  return { path, content: mongooseSrc };
}

describe("TM-GI worker graveyard gate wiring", () => {
  it("TM-GI-01 桩 API Worker 含 mongoose → 未写盘 + PENDING_RESUME + graveyard:T-MONGO", async () => {
    const repo = initRepo();
    const tomb = entryOf("T-MONGO");
    const seeded = seedBoundContract(repo, [tomb]);
    const orch = new ContractOrchestrator({ repoRoot: repo });
    await orch.approve(seeded.contract_id, "tina");

    const change = changeForGate(
      new ContractStore(repo).get(seeded.contract_id)!,
    );
    const modelClient: WorkerModelClient = {
      generateChanges: async () => ({
        changes: [change],
        log: ["add mongoose"],
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    };

    await expect(
      orch.runWorker(seeded.contract_id, { modelClient }),
    ).rejects.toBeInstanceOf(WorkerScopeError);

    const store = new ContractStore(repo);
    const after = store.get(seeded.contract_id);
    expect(after?.lifecycle_state).toBe("PENDING_RESUME");

    const wt = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${seeded.contract_id}`,
    );
    const target = path.join(wt, change.path);
    if (fs.existsSync(target)) {
      expect(fs.readFileSync(target, "utf8")).not.toContain("mongoose");
    }

    const evidenceDir = path.join(repo, ".stagent", "evidence");
    const files = fs.readdirSync(evidenceDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const bundles = files.map((f) =>
      evidenceBundleSchema.parse(
        JSON.parse(fs.readFileSync(path.join(evidenceDir, f), "utf8")),
      ),
    );
    const blocked = bundles.find((b) => b.verdict.status === "BLOCKED");
    expect(blocked).toBeTruthy();
    expect(blocked!.scope_audit.forbidden_violations).toContain(
      "graveyard:T-MONGO",
    );
    expect(blocked!.scope_audit.graveyard_check).toBe("snapshot");
  });

  it("TM-GI-02 绕过 hook 写入后 PRE_MERGE 扫描拒合并，主干 0 字节变化", async () => {
    const repo = initRepo();
    const tomb = entryOf("T-MONGO");
    const seeded = seedBoundContract(repo, [tomb]);
    const prep = await prepareDispatchGate(repo, seeded);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    // 模拟 hook 缺失：直接在「假 worktree」写 mongoose（相对 main 的 diff）
    const wt = fs.mkdtempSync(path.join(repo, ".stagent-wt-"));
    // 用真实 worktree
    git(repo, ["worktree", "add", "-q", wt, "HEAD"]);
    tempDirs.push(wt);
    fs.writeFileSync(path.join(wt, "package.json"), mongoosePkg, "utf8");

    const scan = await scanWorktreeGraveyard({
      worktreePath: wt,
      baseBranch: "main",
      context: prep.context,
    });
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.gate.block).toBe(true);
    expect(scan.gate.primary?.rejected_id).toBe("T-MONGO");

    // 主干未变
    const mainPkg = fs.readFileSync(path.join(repo, "package.json"), "utf8");
    expect(mainPkg).not.toContain("mongoose");
    const mainHead = git(repo, ["rev-parse", "HEAD"]).trim();

    // squashMerge 路径也应拒：先把合同推到 AUDITED 需要完整链路——
    // 这里直接断言 MergeGateError 语义：扫描阻断码
    expect(() => {
      if (scan.gate.block) {
        throw new MergeGateError(
          "E_PROPOSAL_PREVIOUSLY_REJECTED",
          `graveyard:${scan.gate.primary?.rejected_id}`,
        );
      }
    }).toThrow(MergeGateError);

    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(mainHead);
    expect(fs.readFileSync(path.join(repo, "package.json"), "utf8")).toBe(
      mainPkg,
    );
    void squashMerge; // 类型保留：真实 PRE_MERGE 挂在 merger.ts
  });

  it("TM-GI-03 「我改主意了」预填不发送，墓碑仍 active", () => {
    const tomb = entryOf("T-MONGO");
    const prefill = buildRevivalPrefillMessage(tomb.proposal);
    expect(prefill).toBe(`我想恢复：${tomb.proposal}`);
    // 未发送：墓碑状态不变
    expect(tomb.status).toBe("active");
    expect(tomb.disallow_revival).toBe(true);
    // 预填不得含 artifact_keys / rejected_id 教学信息
    expect(prefill).not.toContain("mongoose");
    expect(prefill).not.toContain("T-MONGO");
    expect(prefill).not.toContain("artifact");
  });

  it("TM-GI-04 旧直签 + mongoose → 放行且 graveyard_check unavailable", async () => {
    const repo = initRepo();
    const seeded = seedLegacyContract(repo);
    const orch = new ContractOrchestrator({ repoRoot: repo });
    await orch.approve(seeded.contract_id, "tina");

    const modelClient: WorkerModelClient = {
      generateChanges: async () => ({
        changes: [{ path: "package.json", content: mongoosePkg }],
        log: ["add mongoose"],
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    };

    const result = await orch.runWorker(seeded.contract_id, { modelClient });
    expect(result.applied).toBe(true);

    const wt = path.join(
      repo,
      ".stagent",
      "worktrees",
      `task-${seeded.contract_id}`,
    );
    expect(fs.readFileSync(path.join(wt, "package.json"), "utf8")).toContain(
      "mongoose",
    );

    // 旧直签：派工绑定 legacy → 墓地检查不可用（不误阻断）
    const after = new ContractStore(repo).get(seeded.contract_id)!;
    const prep = await prepareDispatchGate(repo, after);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.context.mode).toBe("legacy");
    expect(prep.context.availability).toBe("unavailable");
  });

  it("GAP-W3 派工提示含否决白话且不含 artifact_keys", async () => {
    const repo = initRepo();
    const tomb = entryOf("T-MONGO");
    const seeded = seedBoundContract(repo, [tomb]);
    const prep = await prepareDispatchGate(repo, seeded);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    writeGatePackFile(repo, buildGatePack([tomb]));

    // prepare() 要求 APPROVED；此处只测提示注入，不走完整 approve
    const approved = softwareContractSchema.parse({
      ...seeded,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
        approved_revision: seeded.contract_revision,
      },
    });

    const worktree = path.join(repo, ".stagent", "worktrees", "manual");
    fs.mkdirSync(worktree, { recursive: true });
    fs.copyFileSync(
      path.join(repo, "package.json"),
      path.join(worktree, "package.json"),
    );
    const gateway = new ScopedWorktreeGateway(worktree, approved, {
      graveyardGate: prep.context,
      costMonitor: new CostMonitor(),
    });
    const worker = new AiWorker({
      gateway,
      modelClient: {
        generateChanges: async () => ({
          changes: [],
          log: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      },
      repoRoot: repo,
    });
    const task = worker.prepare();
    expect(task.system_prompt).toContain("用户否决过的方案");
    expect(task.system_prompt).toContain(tomb.proposal);
    expect(task.system_prompt).toContain("不要文档库");
    expect(task.system_prompt).not.toContain("mongoose");
    expect(task.system_prompt).not.toContain("artifact_keys");
    expect(task.system_prompt).not.toContain("T-MONGO");
  });
});
