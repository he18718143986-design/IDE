/**
 * TASK-J.55：创建/批准合同在按开工编号读不到文件时，
 * 改按 scheme_id + 修订号定位已冻结规划快照。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  SCHEME_SNAPSHOT_DIR,
  writeSchemeSnapshot,
} from "../../daemon/pipeline/scheme-snapshot-store";
import {
  casWriteSchemeLedger,
  emptyLedgerState,
  readSchemeLedger,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { emptySchemeDraft, type DemoGate } from "../../src/lib/journey/scheme-draft";
import { scopePlanToContractScope } from "../../src/lib/journey/scope-plan";
import { emptyDraft } from "../helpers/scheme-patch-fixtures";
import { git } from "../helpers/git";
import { safeRmSync } from "../helpers/tmp";

const SCHEME_ID = "scheme-j55-start";
const REVISION = 3;
const PLAN_ID = "scheme-plan-j55lookup1";
const START_ID = "scheme-start-j55lookup1";

const demo: DemoGate = {
  status: "none",
  scheme_revision: null,
  decision_revision: null,
};
const decision = {
  code: "OK" as const,
  message: "未生成 Demo，按静态方案签署",
  demo_mode: "none" as const,
};

function planScheme() {
  return emptySchemeDraft({
    scheme_id: SCHEME_ID,
    scheme_revision: REVISION,
    title: "J.55 开工查找",
    frozen: true,
    modules: ["核心业务模块"],
    notes: "验收通过。写 src/a.ts",
  });
}

function seedLedger(repoRoot: string) {
  const current = readSchemeLedger(repoRoot);
  const expectedPrevRevision = current?.state.draft.scheme_revision ?? 0;
  const written = casWriteSchemeLedger(repoRoot, {
    expectedPrevRevision,
    next: emptyLedgerState({
      draft: emptyDraft({
        scheme_id: SCHEME_ID,
        scheme_revision: REVISION,
        title: "J.55 开工查找",
        frozen: true,
      }),
    }),
    journal: null,
    modelId: "j55-test",
    promptVersion: "j55-test",
    offline: false,
  });
  if (!written.ok) {
    throw new Error(`casWriteSchemeLedger failed: ${written.reason}`);
  }
}

function seedPlanSnapshot(repoRoot: string) {
  const scheme = planScheme();
  const scopePlan = buildScopePlan({ repoRoot, scheme });
  const snapshot = writeSchemeSnapshot(repoRoot, {
    confirmation_id: PLAN_ID,
    scheme,
    demo,
    decision,
    scope_plan: scopePlan,
  }).snapshot;
  return { scheme, scopePlan, snapshot };
}

function makeContract(scopePlan: ReturnType<typeof buildScopePlan>): SoftwareContract {
  const projected = scopePlanToContractScope(scopePlan);
  const writable =
    projected.writable_paths.length > 0
      ? projected.writable_paths
      : ["src/**"];
  const useManual =
    projected.verification_spec.commands.length === 0 ||
    Boolean(projected.verification_spec.manual_confirmation);
  const draft = createContractDraft({
    title: "J.55 开工合同",
    description: "按开工编号查找规划快照",
    acceptanceCriteria: ["验证命令通过"],
    writablePaths: writable,
    ...(useManual
      ? {
          commands: projected.verification_spec.commands,
          manualConfirmation: projected.verification_spec
            .manual_confirmation ?? {
            reason_required: true as const,
            capture_evidence: ["actor", "confirmed_at", "reason"] as Array<
              "actor" | "confirmed_at" | "reason"
            >,
          },
        }
      : { commands: projected.verification_spec.commands }),
    strictlyForbiddenPaths: projected.forbidden_paths,
    maxFileModifications: projected.budget.max_file_modifications,
    maxDurationSeconds: projected.budget.max_duration_seconds,
    maxVerificationRetries: projected.budget.max_verification_retries,
  });
  return softwareContractSchema.parse({
    ...draft,
    authorization: {
      ...draft.authorization,
      budget_limits: { ...projected.budget },
      file_system_scope: {
        ...draft.authorization.file_system_scope,
        writable_paths: writable,
        strictly_forbidden_paths: projected.forbidden_paths,
      },
    },
    verification_spec: {
      commands: projected.verification_spec.commands,
      ...(projected.verification_spec.manual_confirmation
        ? {
            manual_confirmation:
              projected.verification_spec.manual_confirmation,
          }
        : useManual
          ? {
              manual_confirmation: {
                reason_required: true,
                capture_evidence: ["actor", "confirmed_at", "reason"],
              },
            }
          : {}),
    },
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}

function writeProtection(repoRoot: string, patterns: string[]) {
  fs.mkdirSync(path.join(repoRoot, ".stagent"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, ".stagent", "protection.json"),
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: "pe-j55",
          name: "源码",
          patterns,
          createdAt: new Date().toISOString(),
        },
      ],
    }),
    "utf8",
  );
}

describe("TASK-J.55 开工确认按 scheme_id+修订号定位冻结快照", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j55-lookup-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 5010,
      endPort: 5019,
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

  it("J55-P1: 规划编号下先写合格冻结快照、开工编号创建合同 → 找到并创建成功，scheme_binding 指向规划编号与该快照 digest", async () => {
    seedLedger(repo);
    const { snapshot, scopePlan } = seedPlanSnapshot(repo);
    const contract = makeContract(scopePlan);
    const res = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        contract,
        confirmation_id: START_ID,
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      code?: string;
      message?: string;
      contract?: {
        scheme_binding?: {
          confirmation_id: string;
          snapshot_digest: string;
          scheme_revision: number;
        };
      };
    };
    expect(res.status).toBe(201);
    expect(body.contract?.scheme_binding?.confirmation_id).toBe(PLAN_ID);
    expect(body.contract?.scheme_binding?.snapshot_digest).toBe(snapshot.digest);
    expect(body.contract?.scheme_binding?.confirmation_id).not.toBe(START_ID);
  });

  it("J55-P2: 找不到匹配冻结快照时创建合同仍 409，白话「确认快照不存在或已损坏，拒绝创建可签署合同」", async () => {
    seedLedger(repo);
    const scheme = planScheme();
    const scopePlan = buildScopePlan({ repoRoot: repo, scheme });
    const contract = makeContract(scopePlan);
    const res = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        contract,
        confirmation_id: START_ID,
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      code?: string;
      message?: string;
    };
    expect(res.status).toBe(409);
    expect(body.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
    expect(body.message).toBe(
      "确认快照不存在或已损坏，拒绝创建可签署合同",
    );
  });

  it("J55-P3: 批准路径同键：按开工编号读不到时改按 scheme_id+修订号定位，找到可继续，找不到 409「确认快照不存在或已损坏，拒绝签署」", async () => {
    seedLedger(repo);
    const { snapshot, scopePlan } = seedPlanSnapshot(repo);
    writeProtection(repo, ["src/**"]);
    const contract = makeContract(scopePlan);
    const created = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        contract,
        confirmation_id: START_ID,
      }),
    });
    const createdBody = (await created.json()) as {
      contract: {
        contract_id: string;
        lifecycle_state: string;
        scheme_binding?: { confirmation_id: string; snapshot_digest: string };
      };
      admission?: { decision: string };
    };
    expect(created.status).toBe(201);
    expect(createdBody.admission?.decision).toBe("NEEDS_APPROVAL");
    expect(createdBody.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(createdBody.contract.scheme_binding?.confirmation_id).toBe(PLAN_ID);
    expect(createdBody.contract.scheme_binding?.snapshot_digest).toBe(
      snapshot.digest,
    );

    const approved = await fetch(
      `${base}/api/contracts/${createdBody.contract.contract_id}/approve`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          reviewer: "j55-tester",
          confirmation_id: START_ID,
        }),
      },
    );
    const approvedBody = (await approved.json()) as {
      contract?: {
        lifecycle_state: string;
        scheme_binding?: { confirmation_id: string; snapshot_digest: string };
      };
      message?: string;
      code?: string;
    };
    expect(approved.status).toBe(200);
    expect(approvedBody.contract?.scheme_binding?.confirmation_id).toBe(PLAN_ID);
    expect(approvedBody.contract?.scheme_binding?.snapshot_digest).toBe(
      snapshot.digest,
    );

    const aborted = await fetch(
      `${base}/api/contracts/${createdBody.contract.contract_id}/abort`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          reviewer: "j55-tester",
          reason: "J55-P3 让出在途合同以便测找不到快照的批准路径",
        }),
      },
    );
    expect(aborted.status).toBe(200);

    const dir = path.join(repo, SCHEME_SNAPSHOT_DIR);
    for (const name of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, name));
    }
    const second = makeContract(scopePlan);
    const created2 = await fetch(`${base}/api/contracts`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contract: second }),
    });
    const created2Body = (await created2.json()) as {
      contract: { contract_id: string; lifecycle_state: string };
      admission?: { decision: string };
      code?: string;
      message?: string;
    };
    expect(created2.status).toBe(201);
    expect(created2Body.admission?.decision).toBe("NEEDS_APPROVAL");

    const rejected = await fetch(
      `${base}/api/contracts/${created2Body.contract.contract_id}/approve`,
      {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          reviewer: "j55-tester",
          confirmation_id: START_ID,
        }),
      },
    );
    const rejectedBody = (await rejected.json()) as {
      code?: string;
      message?: string;
    };
    expect(rejected.status).toBe(409);
    expect(rejectedBody.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
    expect(rejectedBody.message).toBe(
      "确认快照不存在或已损坏，拒绝签署",
    );
  });
});
