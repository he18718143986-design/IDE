/**
 * TASK-J.19：DN-2「可以/不行」HTTP 入口。
 * - GET surprise / POST allow → resolveDesignDependencyAllow
 * - POST deny → abort 不插桩
 * - resume 仍不路由到 allow（不插依赖桩）
 * - 无 Bearer → 401
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { writePlan, readPlan } from "../../daemon/project/plan-store";
import type { ContractStub, ProjectPlan } from "../../src/lib/project/project-plan";
import { writeDesignDependencySurprise } from "../../daemon/supervisor/design/design-dependency-surprise";
import { createTaskWorktree } from "../../daemon/git/worktree-manager";
import { emptyDraft } from "../helpers/scheme-patch-fixtures";

describe("TASK-J.19 DN-2 design dependency HTTP", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j19-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "j19",
        private: true,
        scripts: { test: "node -e \"process.exit(0)\"" },
      }),
      "utf8",
    );
    fs.mkdirSync(path.join(repo, "docs", "system"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "docs", "system", "modules.yaml"),
      "modules: []\n",
      "utf8",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3710,
      endPort: 3720,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  function seedPendingDn2(stubId = "cs-feature-1"): {
    contract: SoftwareContract;
    deps: Array<{ name: string; version: string; why: string }>;
  } {
    const draft = createContractDraft({
      title: "J.19 DN-2",
      description: "design dependency http",
      acceptanceCriteria: ["能用"],
      writablePaths: ["src/**", "tests/**"],
      supervisorMetadata: {
        suggestion_id: "scheme:j19",
        acceptance_refs: [{ id: "ac-1", text: "能用", check: "auto" }],
        scheme_item_ids: ["ac-1", "g-1"],
        stub_id: stubId,
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
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_RESUME",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
      },
      authorization: {
        ...draft.authorization,
        execution_permissions: {
          ...draft.authorization.execution_permissions,
          dependency_changes_allowed: false,
        },
      },
    });
    new ContractStore(repo).save(contract);

    const sch = emptyDraft({
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
      contract_id: contract.contract_id,
    };
    const plan: ProjectPlan = {
      schema_version: "1.0.0",
      project_id: "proj-j19",
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

    const deps = [{ name: "left-pad", version: "1.3.0", why: "必须用" }];
    const recordsDir = path.join(
      repo,
      ".stagent",
      "records",
      contract.contract_id,
    );
    fs.mkdirSync(recordsDir, { recursive: true });
    fs.writeFileSync(
      path.join(recordsDir, "suspension.json"),
      `${JSON.stringify(
        {
          reason: "DESIGN_NEEDS_DEPENDENCY",
          phase: "design",
          detail: "需要 left-pad",
          at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeDesignDependencySurprise(repo, {
      contract_id: contract.contract_id,
      reason: "DESIGN_NEEDS_DEPENDENCY",
      original_stub_id: stubId,
      dependencies: deps,
      detail: "合同不许装依赖，但设计认为必须用 left-pad",
    });
    return { contract, deps };
  }

  it("无 Bearer → 401", async () => {
    const { contract } = seedPendingDn2();
    const res = await fetch(
      `${base}/api/design/${encodeURIComponent(contract.contract_id)}/dependency-allow`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(res.status).toBe(401);
  });

  it("GET surprise 返回侧车；allow 命中 resolveDesignDependencyAllow", async () => {
    const { contract, deps } = seedPendingDn2();

    const getRes = await fetch(
      `${base}/api/design/${encodeURIComponent(contract.contract_id)}/dependency-surprise`,
      { headers: auth() },
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      ok: boolean;
      surprise: { dependencies: typeof deps; reason: string };
    };
    expect(getBody.ok).toBe(true);
    expect(getBody.surprise.reason).toBe("DESIGN_NEEDS_DEPENDENCY");
    expect(getBody.surprise.dependencies[0]?.name).toBe("left-pad");

    const allowRes = await fetch(
      `${base}/api/design/${encodeURIComponent(contract.contract_id)}/dependency-allow`,
      { method: "POST", headers: auth(), body: "{}" },
    );
    expect(allowRes.status).toBe(200);
    const allowBody = (await allowRes.json()) as {
      ok: boolean;
      choice: string;
      dependency_stub_id: string;
      contract: SoftwareContract;
      contract_bytes_unchanged: boolean;
    };
    expect(allowBody.ok).toBe(true);
    expect(allowBody.choice).toBe("allow");
    expect(allowBody.contract.lifecycle_state).toBe("ABORTED");
    expect(allowBody.contract_bytes_unchanged).toBe(true);
    expect(allowBody.dependency_stub_id).toBeTruthy();

    const afterPlan = readPlan(repo)!;
    const depStub = afterPlan.contracts.find((c) => c.kind === "dependency");
    expect(depStub).toBeTruthy();
    expect(depStub?.stub_id).toBe(allowBody.dependency_stub_id);
    expect(depStub?.context?.dependency?.name).toBe("left-pad");

    const surprisePath = path.join(
      repo,
      ".stagent",
      "records",
      contract.contract_id,
      "design-dependency-surprise.json",
    );
    expect(fs.existsSync(surprisePath)).toBe(false);
  });

  it("deny → ABORTED 且计划无 dependency 桩", async () => {
    const { contract } = seedPendingDn2("cs-feature-deny");
    const before = readPlan(repo)!;
    const beforeDepCount = before.contracts.filter((c) => c.kind === "dependency").length;

    const denyRes = await fetch(
      `${base}/api/design/${encodeURIComponent(contract.contract_id)}/dependency-deny`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ reviewer: "tina", reason: "不要这个库" }),
      },
    );
    expect(denyRes.status).toBe(200);
    const body = (await denyRes.json()) as {
      ok: boolean;
      choice: string;
      contract: SoftwareContract;
    };
    expect(body.choice).toBe("deny");
    expect(body.contract.lifecycle_state).toBe("ABORTED");

    const after = readPlan(repo)!;
    const afterDepCount = after.contracts.filter((c) => c.kind === "dependency").length;
    expect(afterDepCount).toBe(beforeDepCount);
  });

  it("resume 不插依赖桩（不误路由到 allow）", async () => {
    const { contract } = seedPendingDn2("cs-feature-resume");
    await createTaskWorktree({
      repoRoot: repo,
      contractId: contract.contract_id,
    });

    const before = readPlan(repo)!;
    const beforeDep = before.contracts.filter((c) => c.kind === "dependency").length;

    const resumeRes = await fetch(
      `${base}/api/contracts/${encodeURIComponent(contract.contract_id)}/resume`,
      { method: "POST", headers: auth(), body: "{}" },
    );
    expect(resumeRes.status).toBe(200);
    const body = (await resumeRes.json()) as { contract: SoftwareContract };
    expect(body.contract.lifecycle_state).toBe("EXECUTING");

    const after = readPlan(repo)!;
    const afterDep = after.contracts.filter((c) => c.kind === "dependency").length;
    expect(afterDep).toBe(beforeDep);

    // surprise 仍在：resume 不消费 DN-2 意外卡
    expect(
      fs.existsSync(
        path.join(
          repo,
          ".stagent",
          "records",
          contract.contract_id,
          "design-dependency-surprise.json",
        ),
      ),
    ).toBe(true);
  });
});
