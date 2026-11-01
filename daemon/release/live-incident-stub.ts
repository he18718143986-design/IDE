/**
 * TASK-L.16：线上问题 → 系统合同桩（origin:system）。
 * 按 project-decomposition §2.1 放置：插到 nextStub 所在里程碑最前，
 * 该里程碑内原 planned 桩补 depends_on。
 * 禁止改 MERGED / 锁定桩（edit_stub 对锁定桩会丢弃）。
 */
import fs from "node:fs";
import path from "node:path";
import { applyPlanPatch } from "../../src/lib/project/plan-patch";
import { nextStub } from "../../src/lib/project/next-stub";
import type {
  ContractStub,
  ProjectPlan,
  ProjectPlanScheme,
  RepoFacts,
} from "../../src/lib/project/project-plan";
import type { LiveIncidentPayload } from "../../src/lib/release/release";
import { readPlan, writePlan } from "../project/plan-store";
import { readSchemeLedger } from "../supervisor/intent-compiler/scheme-ledger-store";
import { synthesizeSchemeFromPlan } from "../supervisor/design/scheme-from-plan";

export interface InsertLiveIncidentStubInput {
  repoRoot: string;
  incident: LiveIncidentPayload;
  /** 白话标题；缺省由目标名生成 */
  title?: string;
  scheme?: ProjectPlanScheme;
  repoFacts?: RepoFacts;
}

export type InsertLiveIncidentStubResult =
  | {
      ok: true;
      plan: ProjectPlan;
      stub: ContractStub;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

function schemeForPlan(
  repoRoot: string,
  plan: ProjectPlan,
): ProjectPlanScheme {
  const ledger = readSchemeLedger(repoRoot);
  if (ledger?.state.draft) {
    const d = ledger.state.draft;
    return {
      scheme_id: d.scheme_id,
      scheme_revision: d.scheme_revision,
      size_hint: d.size_hint,
      goals: d.goals,
      out_of_scope: d.out_of_scope,
      modules: d.modules,
      entities: d.entities,
      acceptance: d.acceptance,
    };
  }
  return synthesizeSchemeFromPlan(plan);
}

function detectRepoFacts(repoRoot: string): RepoFacts {
  const existing_dirs: string[] = [];
  for (const d of ["src", "tests", "docs", "daemon"]) {
    if (fs.existsSync(path.join(repoRoot, d))) existing_dirs.push(d);
  }
  let has_test_script = false;
  try {
    const pkgPath = path.join(repoRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      has_test_script = Boolean(pkg.scripts?.test);
    }
  } catch {
    has_test_script = false;
  }
  const has_modules_yaml = fs.existsSync(
    path.join(repoRoot, "docs", "system", "modules.yaml"),
  );
  return {
    has_test_script,
    has_modules_yaml,
    existing_dirs: existing_dirs.length > 0 ? existing_dirs : ["src"],
  };
}

function pickMilestone(plan: ProjectPlan): {
  milestone_id: string;
  planned: ContractStub[];
} | null {
  const ns = nextStub(plan);
  if (ns) {
    const planned = plan.contracts.filter(
      (c) => c.milestone_id === ns.milestone_id && c.status === "planned",
    );
    return { milestone_id: ns.milestone_id, planned };
  }
  const ms = plan.milestones[0];
  if (!ms) return null;
  const planned = plan.contracts.filter(
    (c) => c.milestone_id === ms.milestone_id && c.status === "planned",
  );
  return { milestone_id: ms.milestone_id, planned };
}

/**
 * 将线上事故写成系统 feature 桩并写入计划。
 */
export function insertLiveIncidentStub(
  input: InsertLiveIncidentStubInput,
): InsertLiveIncidentStubResult {
  const plan = readPlan(input.repoRoot);
  if (!plan) {
    return {
      ok: false,
      code: "E_PLAN_NOT_FOUND",
      message: "还没有项目计划，没法生成修复合同桩。",
    };
  }

  const slot = pickMilestone(plan);
  if (!slot) {
    return {
      ok: false,
      code: "E_PLAN_NO_MILESTONE",
      message: "计划里还没有里程碑，没法插入修复合同。",
    };
  }

  const stubId = `cs-incident-${input.incident.release_id}`;
  const existing = plan.contracts.find((c) => c.stub_id === stubId);
  if (existing) {
    return { ok: true, plan, stub: existing };
  }

  const title =
    input.title ??
    `修复线上「${input.incident.target_label}」停摆（${input.incident.release_id}）`;

  const stubBody: Omit<ContractStub, "status" | "contract_id"> = {
    stub_id: stubId,
    milestone_id: slot.milestone_id,
    kind: "feature",
    origin: "system",
    context: {
      release_id: input.incident.release_id,
      commit_sha: input.incident.commit_sha,
      log_tail: input.incident.log_tail.slice(0, 4_000),
    },
    title,
    scheme_item_ids: [],
    acceptance_ids: ["sys-acc-incident"],
    area_hints: ["src"],
    depends_on: [],
    size_estimate: { files: 5, diff_lines: 200, minutes: 20 },
  };

  const ms = plan.milestones.find((m) => m.milestone_id === slot.milestone_id)!;
  const reorderIds = [
    stubId,
    ...ms.contract_ids.filter((id) => id !== stubId),
  ];

  const editOps = slot.planned
    .filter((c) => c.stub_id !== stubId)
    .map((c) => ({
      op: "edit_stub" as const,
      stub_id: c.stub_id,
      fields: {
        depends_on: Array.from(new Set([stubId, ...c.depends_on])),
      },
    }));

  const scheme = input.scheme ?? schemeForPlan(input.repoRoot, plan);
  const repoFacts = input.repoFacts ?? detectRepoFacts(input.repoRoot);

  const result = applyPlanPatch(
    plan,
    {
      base_revision: plan.plan_revision,
      reason: "user_request",
      ops: [
        { op: "add_stub", stub: stubBody },
        {
          op: "reorder",
          milestone_id: slot.milestone_id,
          contract_ids: reorderIds,
        },
        ...editOps,
      ],
    },
    scheme,
    repoFacts,
  );

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.plain_message ?? result.code,
    };
  }

  writePlan(input.repoRoot, result.plan);
  const stub = result.plan.contracts.find((c) => c.stub_id === stubId);
  if (!stub) {
    return {
      ok: false,
      code: "E_PLAN_STUB_MISSING",
      message: "插桩后找不到新合同桩",
    };
  }
  return { ok: true, plan: result.plan, stub };
}
