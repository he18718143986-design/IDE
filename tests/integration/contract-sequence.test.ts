
/**
 * TASK-L.9：合同序列生产主路径——互斥、下一份 ScopePlan、中止重分解。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { safeRmSync } from "../helpers/tmp";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { writePlan, readPlan } from "../../daemon/project/plan-store";
import {
  setRedecomposeHook,
  type RedecomposeRequest,
} from "../../daemon/project/contract-sequence";
import { nextStub } from "../../src/lib/project/next-stub";
import { schemeViewForStub } from "../../src/lib/project/stub-view";
import { preflightScopePlan } from "../../daemon/supervisor/scope-preflight";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import type { ProjectPlan } from "../../src/lib/project/project-plan";
import { buildConfirmContractFromScopePlan } from "../../src/lib/journey/confirm-scheme-contract";
import type { SchemeDraft } from "../../src/lib/journey/scheme-draft";

function requestJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; raw: string; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: T;
          try {
            body = raw ? (JSON.parse(raw) as T) : ({} as T);
          } catch {
            body = raw as unknown as T;
          }
          resolve({ status: res.statusCode ?? 0, raw, body });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

function twoStubPlan(): ProjectPlan {
  return {
    schema_version: "1.0.0",
    project_id: "proj-seq",
    plan_revision: 1,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "d1",
    },
    scheme_id: "S-seq",
    scheme_revision: 2,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "一期",
        exit_acceptance_ids: ["acc-1", "acc-2"],
        contract_ids: ["cs-1", "cs-2"],
      },
    ],
    contracts: [
      {
        stub_id: "cs-1",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "登录",
        scheme_item_ids: ["g-1", "acc-1"],
        acceptance_ids: ["acc-1"],
        area_hints: ["src/auth"],
        depends_on: [],
        size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
        status: "planned",
        contract_id: null,
      },
      {
        stub_id: "cs-2",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "支付",
        scheme_item_ids: ["g-2", "acc-2"],
        acceptance_ids: ["acc-2"],
        area_hints: ["src/pay"],
        depends_on: ["cs-1"],
        size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
        status: "planned",
        contract_id: null,
      },
    ],
    graveyard: [],
  };
}

function schemeForSeq(): SchemeDraft {
  return {
    scheme_id: "S-seq",
    scheme_revision: 2,
    title: "登录与支付",
    summary: "两份合同",
    modules: ["登录", "支付"],
    mermaidArchitecture: "",
    mermaidFlow: "",
    mermaidMindmap: "",
    decisions: [],
    conflicts: [],
    completeness: 80,
    demoReady: true,
    frozen: false,
    notes: "",
    updatedAt: "1970-01-01T00:00:00.000Z",
    pinned_fields: [],
    business_input_rounds: 1,
    acceptance: [
      { id: "acc-1", text: "登录成功", check: "both" },
      { id: "acc-2", text: "支付成功", check: "both" },
    ],
    goals: [
      { id: "g-1", text: "用户能登录" },
      { id: "g-2", text: "用户能支付" },
    ],
  } as SchemeDraft;
}

function contractForStub(
  repoRoot: string,
  stubId: string,
  plan: ProjectPlan,
  lifecycle: SoftwareContract["lifecycle_state"] = "DRAFT",
): SoftwareContract {
  const stub = plan.contracts.find((c) => c.stub_id === stubId)!;
  const scheme = schemeForSeq();
  const scope = preflightScopePlan({
    repoRoot,
    scheme,
    stub,
  });
  const built = buildConfirmContractFromScopePlan(scheme, scope, { stub });
  let approvalStatus: "DRAFT" | "PENDING_REVIEW" | "APPROVED" = "DRAFT";
  if (lifecycle === "PENDING_APPROVAL") approvalStatus = "PENDING_REVIEW";
  else if (lifecycle !== "DRAFT") approvalStatus = "APPROVED";
  return softwareContractSchema.parse({
    ...built,
    lifecycle_state: lifecycle,
    approval: {
      ...built.approval,
      status: approvalStatus,
      ...(approvalStatus === "APPROVED"
        ? {
            approved_by: "test",
            approved_at: "1970-01-01T00:00:00.000Z",
            approved_revision: built.contract_revision,
          }
        : {}),
    },
  });
}

describe("TASK-L.9 contract sequence", () => {
  let repo: string;
  let daemon: StagentDaemon;
  let baseUrl: string;
  let token: string;
  let redecomposeCalls: RedecomposeRequest[];

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l9-"));
    fs.mkdirSync(path.join(repo, "src", "auth"), { recursive: true });
    fs.mkdirSync(path.join(repo, "src", "pay"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "auth", "a.ts"), "export {};\n");
    fs.writeFileSync(path.join(repo, "src", "pay", "p.ts"), "export {};\n");
    // minimal git repo so daemon starts
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    writePlan(repo, twoStubPlan());
    redecomposeCalls = [];
    setRedecomposeHook((req) => {
      redecomposeCalls.push(req);
    });

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3841,
      endPort: 3860,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    baseUrl = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken()!;
  });

  afterEach(async () => {
    setRedecomposeHook(null);
    await daemon.stop();
    safeRmSync(repo);
  });

  it("合入第一份后 nextStub 为第二份，其 ScopePlan 只含第二份区域", () => {
    const plan0 = readPlan(repo)!;
    expect(nextStub(plan0)?.stub_id).toBe("cs-1");

    // 模拟合入第一份
    const afterMerge: ProjectPlan = {
      ...plan0,
      plan_revision: plan0.plan_revision + 1,
      contracts: plan0.contracts.map((c) =>
        c.stub_id === "cs-1"
          ? { ...c, status: "merged" as const, contract_id: "CTR-1" }
          : c,
      ),
    };
    writePlan(repo, afterMerge);
    const n = nextStub(afterMerge)!;
    expect(n.stub_id).toBe("cs-2");

    const scheme = schemeForSeq();
    const view = schemeViewForStub(scheme, n);
    expect(view.summary).toContain("支付");
    expect(view.notes).toContain("src/pay");
    expect(view.summary).not.toContain("登录");

    const scope = preflightScopePlan({
      repoRoot: repo,
      scheme,
      stub: n,
    });
    const areaPaths = scope.areas.flatMap((a) => a.paths).join(" ");
    expect(areaPaths).toMatch(/pay|支付/);
    expect(areaPaths).not.toMatch(/auth/);
  });

  it("第一份 ABORTED 时依赖它的第二份不可选，并触发重新分解调用", async () => {
    const plan0 = twoStubPlan();
    const draft = contractForStub(repo, "cs-1", plan0, "DRAFT");
    // 写入 stub metadata 后经 HTTP 创建，再 abort
    // 先把合同直接落到 PREPARING 态再 abort：用 store 路径
    // 简化：HTTP 创建 DRAFT → 再手动 transition 太重；直接测 sync + hook via abort API
    // 创建合同时写入 stub_id
    const create = await requestJson<{
      contract: SoftwareContract;
    }>(`${baseUrl}/api/contracts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contract: draft }),
    });
    expect(create.status).toBe(201);
    const id = create.body.contract.contract_id;
    expect(create.body.contract.supervisor_metadata?.stub_id).toBe("cs-1");
    expect(readPlan(repo)?.contracts.find((c) => c.stub_id === "cs-1")?.status).toBe(
      "signed",
    );

    // 把合同推到可 abort 的态：orchestrator.abort 接受多数态
    // DRAFT 可 abort
    const abort = await requestJson<{
      contract: SoftwareContract;
      redecompose_requested: boolean;
    }>(`${baseUrl}/api/contracts/${encodeURIComponent(id)}/abort`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "user_cancel" }),
    });
    expect(abort.status).toBe(200);
    expect(abort.body.contract.lifecycle_state).toBe("ABORTED");
    expect(abort.body.redecompose_requested).toBe(true);
    expect(redecomposeCalls.length).toBe(1);
    expect(redecomposeCalls[0]?.reason).toBe("contract_aborted");

    const after = readPlan(repo)!;
    expect(after.contracts.find((c) => c.stub_id === "cs-1")?.status).toBe(
      "aborted",
    );
    expect(nextStub(after)).toBeNull(); // cs-2 依赖 cs-1
  });

  it("第一份处于 EXECUTING 时签第二份 → E_CONTRACT_IN_FLIGHT", async () => {
    const plan0 = twoStubPlan();
    // 先落一份 EXECUTING 合同（带 stub cs-1）
    const first = contractForStub(repo, "cs-1", plan0, "EXECUTING");
    // EXECUTING 合同不能经「创建」直接设态——POST 会存 DRAFT。
    // 直接写进 contract store 目录。
    const storeDir = path.join(repo, ".stagent", "contracts");
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(
      path.join(storeDir, `${first.contract_id}.json`),
      JSON.stringify(first, null, 2),
    );

    const second = contractForStub(repo, "cs-2", plan0, "DRAFT");
    const res = await requestJson<{
      code?: string;
      error?: string;
    }>(`${baseUrl}/api/contracts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contract: second }),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("E_CONTRACT_IN_FLIGHT");
  });

  it("test_foundation 桩的 ScopePlan 含安装命令与 EXPLICIT_TARGETS", () => {
    const tfPlan: ProjectPlan = {
      ...twoStubPlan(),
      contracts: [
        {
          stub_id: "cs-tf",
          milestone_id: "ms-1",
          kind: "test_foundation",
          origin: "system",
          title: "测试基建",
          scheme_item_ids: [],
          acceptance_ids: ["sys-acc-test-foundation"],
          area_hints: ["tests"],
          depends_on: [],
          size_estimate: { files: 5, diff_lines: 100, minutes: 15 },
          status: "planned",
          contract_id: null,
        },
      ],
      milestones: [
        {
          milestone_id: "ms-1",
          title: "基建",
          exit_acceptance_ids: ["sys-acc-test-foundation"],
          contract_ids: ["cs-tf"],
        },
      ],
    };
    writePlan(repo, tfPlan);
    const stub = nextStub(tfPlan)!;
    const scope = preflightScopePlan({
      repoRoot: repo,
      scheme: schemeForSeq(),
      stub,
    });
    expect(scope.dependency_changes_allowed).toBe(true);
    expect(scope.network_policy).toBe("EXPLICIT_TARGETS");
    expect(
      scope.allowed_commands?.some(
        (c) => c.includes("vitest") || c.includes("npm install"),
      ),
    ).toBe(true);
  });
});
