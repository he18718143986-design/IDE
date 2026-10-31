import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
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
import {
  scopePlanToContractScope,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import {
  SCHEME_SNAPSHOT_DIR,
  SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY,
  schemeSnapshotDigest,
} from "../../daemon/pipeline/scheme-snapshot-store";
import { git } from "../helpers/git";

/**
 * TASK-J.4 / SSOT §18 S2-05～S2-07：范围预检、冻结漂移与签署链快照绑定。
 * 端口段 3930–3939（development-tasks §3.4c）。
 */

interface ErrBody {
  error?: string;
  code?: string;
  message?: string;
  scope_plan?: ScopePlan;
}

describe("T-HTTP S205–S207 范围预检与快照漂移（真 Daemon）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-scope-drift-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3930,
      endPort: 3939,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    try {
      if (daemon?.isRunning) await daemon.stop();
    } catch {
      /* ignore */
    }
    daemon = null;
    try {
      safeRmSync(repo);
    } catch {
      /* ignore */
    }
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  async function call<T = ErrBody>(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: auth(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text.length > 0 ? JSON.parse(text) : {}) as T,
    };
  }

  /** 夹具方案：notes/modules 含 pages，便于老项目/Python 收敛到 src/pages/** */
  function makeScheme(revision = 2): SchemeDraft {
    return emptySchemeDraft({
      title: "改 pages 看板",
      summary: "只要 pages 这一块",
      modules: ["pages", "首页看板"],
      notes: "pages",
      mermaidFlow: "flowchart LR\n  A[录入] --> B[汇总]",
      business_input_rounds: 1,
      scheme_revision: revision,
    });
  }

  async function preflight(scheme: SchemeDraft): Promise<ScopePlan> {
    const res = await call<{ scope_plan: ScopePlan }>(
      "POST",
      "/api/supervisor/scope/preflight",
      { scheme },
    );
    expect(res.status).toBe(200);
    expect(res.body.scope_plan.plan_digest).toMatch(/^[0-9a-f]{64}$/);
    return res.body.scope_plan;
  }

  function freezeBody(
    confirmationId: string,
    scheme: SchemeDraft,
    scope_plan: ScopePlan,
  ) {
    return {
      confirmation_id: confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: {
        code: "OK",
        message: "未生成 Demo，按静态方案签署",
        demo_mode: "none" as const,
      },
      scope_plan,
    };
  }

  function contractFromPlan(
    scheme: SchemeDraft,
    plan: ScopePlan,
    lifecycle: "DRAFT" | "PENDING_APPROVAL" = "PENDING_APPROVAL",
    tweak?: (c: SoftwareContract) => SoftwareContract,
  ): SoftwareContract {
    const projected = scopePlanToContractScope(plan);
    const writable =
      projected.writable_paths.length > 0
        ? projected.writable_paths
        : ["src/**"];
    const useManual =
      projected.verification_spec.commands.length === 0 ||
      Boolean(projected.verification_spec.manual_confirmation);
    const draft = createContractDraft({
      title: scheme.title || "范围签署",
      description: scheme.summary || "J.4",
      acceptanceCriteria: ["verify passes"],
      writablePaths: writable,
      ...(useManual
        ? {
            commands: projected.verification_spec.commands,
            manualConfirmation: projected.verification_spec
              .manual_confirmation ?? {
              reason_required: true as const,
              capture_evidence: [
                "actor",
                "confirmed_at",
                "reason",
              ] as Array<"actor" | "confirmed_at" | "reason">,
            },
          }
        : { commands: projected.verification_spec.commands }),
      strictlyForbiddenPaths: projected.forbidden_paths,
      maxFileModifications: projected.budget.max_file_modifications,
      maxDurationSeconds: projected.budget.max_duration_seconds,
      maxVerificationRetries: projected.budget.max_verification_retries,
    });
    let parsed = softwareContractSchema.parse({
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
      lifecycle_state: lifecycle,
      ...(lifecycle === "PENDING_APPROVAL"
        ? { approval: { status: "PENDING_REVIEW" } }
        : {}),
    });
    if (tweak) parsed = tweak(parsed);
    return parsed;
  }

  const snapshotPath = (id: string) =>
    path.join(repo, SCHEME_SNAPSHOT_DIR, `${id}.json`);

  it("T-HTTP-S205 冻结前加入 package.json → 409 E_SCOPE_PLAN_DRIFT，快照不落盘", async () => {
    const scheme = makeScheme();
    const confirmationId = "scope-drift-s205-0001";
    const plan = await preflight(scheme);

    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "drifted", private: true }),
    );

    const frozen = await call<ErrBody>(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezeBody(confirmationId, scheme, plan),
    );
    expect(frozen.status).toBe(409);
    expect(frozen.body.code).toBe("E_SCOPE_PLAN_DRIFT");
    expect(frozen.body.scope_plan?.plan_digest).toBeTruthy();
    expect(frozen.body.scope_plan?.plan_digest).not.toBe(plan.plan_digest);
    expect(fs.existsSync(snapshotPath(confirmationId))).toBe(false);
  });

  it("T-HTTP-S206 带 confirmation_id 创建合同范围比快照多一条 → 409 MISMATCH", async () => {
    const scheme = makeScheme();
    const confirmationId = "scope-drift-s206-0001";
    const plan = await preflight(scheme);
    const frozen = await call(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezeBody(confirmationId, scheme, plan),
    );
    expect(frozen.status).toBe(201);

    const contract = contractFromPlan(scheme, plan, "PENDING_APPROVAL", (c) =>
      softwareContractSchema.parse({
        ...c,
        authorization: {
          ...c.authorization,
          file_system_scope: {
            ...c.authorization.file_system_scope,
            writable_paths: [
              ...c.authorization.file_system_scope.writable_paths,
              "extra-never-in-plan/**",
            ],
          },
        },
      }),
    );

    const created = await call("POST", "/api/contracts", {
      contract,
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe("E_SCHEME_SNAPSHOT_MISMATCH");

    const list = await call<{ contracts: unknown[] }>("GET", "/api/contracts");
    expect(list.body.contracts).toHaveLength(0);
  });

  async function happyPath(label: string, prepare: () => void): Promise<void> {
    prepare();
    const scheme = makeScheme();
    const confirmationId = `scope-ok-${label}-0001`;
    const plan = await preflight(scheme);
    expect(plan.grade.ok, `${label}: grade.ok`).toBe(true);
    const projected = scopePlanToContractScope(plan);
    expect(
      projected.writable_paths.length,
      `${label}: 预检应给出可写路径`,
    ).toBeGreaterThan(0);

    const frozen = await call(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezeBody(confirmationId, scheme, plan),
    );
    expect(frozen.status).toBe(201);

    const contract = contractFromPlan(scheme, plan, "PENDING_APPROVAL");
    const created = await call<{
      contract: SoftwareContract;
      code?: string;
    }>("POST", "/api/contracts", {
      contract,
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(201);
    expect(created.body.code).not.toBe("E_WRITABLE_SCOPE_POLICY");

    let lifecycle = created.body.contract.lifecycle_state;
    if (
      lifecycle === "PENDING_APPROVAL" ||
      created.body.contract.approval.status === "PENDING_REVIEW"
    ) {
      const approved = await call<{
        contract: SoftwareContract;
        code?: string;
        error?: string;
        message?: string;
      }>("POST", `/api/contracts/${created.body.contract.contract_id}/approve`, {
        reviewer: "j4-tester",
        confirmation_id: confirmationId,
        // 夹具故意留下未提交文件；与范围绑定无关，显式确认脏区
        acknowledge_dirty: true,
      });
      expect(
        approved.status,
        `${label}: approve → ${approved.body.code ?? approved.body.error}: ${approved.body.message ?? ""}`,
      ).toBe(200);
      expect(approved.body.code).not.toBe("E_WRITABLE_SCOPE_POLICY");
      lifecycle = approved.body.contract.lifecycle_state;
      expect(approved.body.contract.approval.status).toBe("APPROVED");
    } else {
      expect(created.body.contract.approval.status).toBe("APPROVED");
    }
    expect(["PENDING_APPROVAL", "DRAFT"]).not.toContain(lifecycle);
  }

  it("T-HTTP-S207a 老项目夹具：preflight→freeze→create→approve 无 E_WRITABLE_SCOPE_POLICY", async () => {
    await happyPath("legacy", () => {
      fs.writeFileSync(
        path.join(repo, "package.json"),
        JSON.stringify({
          name: "legacy",
          private: true,
          scripts: { test: "node -e \"process.exit(0)\"" },
        }),
      );
      fs.mkdirSync(path.join(repo, "src", "pages"), { recursive: true });
      fs.writeFileSync(
        path.join(repo, "src", "pages", "index.ts"),
        "export {};\n",
      );
    });
  });

  it("T-HTTP-S207b 绿野夹具：全程无 E_WRITABLE_SCOPE_POLICY", async () => {
    await happyPath("greenfield", () => {
      /* beforeEach 已是绿野 */
    });
  });

  it("T-HTTP-S207c 非 npm（Python）夹具：全程无 E_WRITABLE_SCOPE_POLICY", async () => {
    await happyPath("python", () => {
      fs.writeFileSync(
        path.join(repo, "pyproject.toml"),
        '[project]\nname = "demo"\nversion = "0.1.0"\n',
      );
      fs.mkdirSync(path.join(repo, "src", "pages"), { recursive: true });
      fs.writeFileSync(
        path.join(repo, "src", "pages", "view.py"),
        "# view\n",
      );
    });
  });

  it("T-HTTP-S207d 1.0 旧快照 + confirmation_id → 409 E_SCHEME_SNAPSHOT_NOT_FOUND", async () => {
    const scheme = makeScheme();
    const confirmationId = "scope-legacy10-0001";
    const digest = schemeSnapshotDigest({
      scheme_revision: scheme.scheme_revision,
      scheme,
      demo: EMPTY_DEMO_GATE,
    });
    const dir = path.join(repo, SCHEME_SNAPSHOT_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${confirmationId}.json`),
      JSON.stringify({
        schema_version: SCHEME_SNAPSHOT_SCHEMA_VERSION_LEGACY,
        snapshot_id: confirmationId,
        confirmation_id: confirmationId,
        status: "FROZEN",
        created_at: new Date().toISOString(),
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo: EMPTY_DEMO_GATE,
        decision: {
          code: "OK",
          message: "legacy",
          demo_mode: "none",
        },
        digest,
      }),
    );

    const contract = softwareContractSchema.parse({
      ...createContractDraft({
        title: "legacy",
        description: "1.0 snapshot",
        acceptanceCriteria: ["ok"],
        writablePaths: ["src/**"],
        commands: [
          {
            alias: "verify",
            executable: "node",
            args: ["-e", "process.exit(0)"],
            expected_exit_code: 0,
            timeout_seconds: 30,
          },
        ],
      }),
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });

    const created = await call("POST", "/api/contracts", {
      contract,
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
    expect(String(created.body.message ?? "")).toMatch(/过旧|scope_plan/);
  });
});
