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
  type DemoGate,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import {
  resetConfirmSchemeTransactionsForTest,
  runConfirmSchemeAtomic,
} from "../../src/lib/journey/confirm-scheme-atomic";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import {
  scopePlanToContractScope,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import { git } from "../helpers/git";

/**
 * SSOT v2.0.2 §3.2 R-10 / §3.4 F-07 的 **HTTP 级** 注入测试。
 *
 * 与单测的区别：这里起真 Daemon，故障不是 `vi.fn().mockRejectedValue`，
 * 而是「真的发一个会让 Daemon 拒绝的请求」，断言也落在 Daemon 落盘后的
 * 权威状态上（合同 lifecycle_state、图谱可读性），而不是内存桩的调用次数。
 *
 * 覆盖两条一直标 `⏳` 的验收项：
 * - R-10：快照缺失时不得创建/签署合同 → 409 `E_SCHEME_SNAPSHOT_NOT_FOUND`；
 * - F-07：建任务图失败 → 归入 `SIGN_AND_PREPARE` → 补偿走
 *   `POST /api/contracts/:id/abort`，合同必须真的变 `ABORTED`，
 *   且不留下半张图。
 */

interface ErrBody {
  error?: string;
  code?: string;
  message?: string;
}

describe("T-HTTP R-10 / F-07 确认快照与建图补偿（真 Daemon）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    resetConfirmSchemeTransactionsForTest();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-scheme-http-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      // 3800–3809：本仓库测试的端口段已被大量占用（3600–3631、3646、3660–3670、
      // 3680–3695、3700–3730、3740、3770–3790、4100–4199），其中 3690/3691
      // 属于 resume-abort / presentation-state-wiring / task-c15b。8 路并发下
      // 抢同一段会让两边的 daemon 互相端掉，表现为「连上了但不是这个 daemon」。
      startPort: 3800,
      endPort: 3809,
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
      // 停服失败不该掩盖断言失败
    }
    daemon = null;
    try {
      safeRmSync(repo);
    } catch {
      // 沙箱可能拦截删除；临时目录残留不影响断言
    }
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    // 避免 undici 连接池复用已关闭的 socket
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

  /** 可通过 `evaluateSchemeConfirmation` 的可审阅方案（Demo 未生成）。 */
  function makeScheme(revision = 2): SchemeDraft {
    return emptySchemeDraft({
      title: "工程项目进度管控台",
      summary:
        "按项目维度汇总进度与预算，并对超期节点发出预警，支持月度报表导出。",
      modules: ["工程进度管控", "财务数据与预算"],
      mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
      business_input_rounds: 1,
      scheme_revision: revision,
    });
  }

  function makeContract(
    lifecycle: "DRAFT" | "PENDING_APPROVAL" = "PENDING_APPROVAL",
    plan?: ScopePlan,
  ): SoftwareContract {
    if (plan) {
      const projected = scopePlanToContractScope(plan);
      const writable =
        projected.writable_paths.length > 0
          ? projected.writable_paths
          : ["src/**"];
      const useManual =
        projected.verification_spec.commands.length === 0 ||
        Boolean(projected.verification_spec.manual_confirmation);
      const draft = createContractDraft({
        title: "确认后签署",
        description: "R-10 / F-07 HTTP 级注入",
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
        lifecycle_state: lifecycle,
        ...(lifecycle === "PENDING_APPROVAL"
          ? { approval: { status: "PENDING_REVIEW" } }
          : {}),
      });
    }
    const draft = createContractDraft({
      title: "确认后签署",
      description: "R-10 / F-07 HTTP 级注入",
      acceptanceCriteria: ["verify passes"],
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
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: lifecycle,
      ...(lifecycle === "PENDING_APPROVAL"
        ? { approval: { status: "PENDING_REVIEW" } }
        : {}),
    });
  }

  function freezePayload(
    confirmationId: string,
    scheme: SchemeDraft,
    demo: DemoGate = EMPTY_DEMO_GATE,
    scope_plan?: ScopePlan,
  ) {
    const plan =
      scope_plan ?? buildScopePlan({ repoRoot: repo, scheme });
    return {
      confirmation_id: confirmationId,
      scheme,
      demo,
      decision: {
        code: "OK",
        message: "未生成 Demo，按静态方案签署",
        demo_mode: "none" as const,
      },
      scope_plan: plan,
    };
  }

  const snapshotPath = (confirmationId: string) =>
    path.join(repo, ".stagent", "drafts", "schemes", `${confirmationId}.json`);

  // -------------------------------------------------------------------------
  // R-10：快照缺失 → 拒绝创建 / 拒绝签署
  // -------------------------------------------------------------------------

  it("T-HTTP-R10-001 快照缺失时创建合同返回 409，且不落半份合同", async () => {
    const confirmationId = "scheme-confirm-missing-0001";
    const res = await call("POST", "/api/contracts", {
      contract: makeContract("PENDING_APPROVAL"),
      confirmation_id: confirmationId,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
    // 确认失败原因确实是"文件不存在"，而不是"文件损坏"
    expect(fs.existsSync(snapshotPath(confirmationId))).toBe(false);

    const list = await call<{ contracts: unknown[] }>("GET", "/api/contracts");
    expect(list.body.contracts).toHaveLength(0);
  });

  it("T-HTTP-R10-002 快照缺失时签署路径（approve）同样 409，且合同状态未推进", async () => {
    const contract = makeContract("DRAFT");
    const created = await call("POST", "/api/contracts", { contract });
    expect(created.status).toBe(201);

    const res = await call(
      "POST",
      `/api/contracts/${contract.contract_id}/approve`,
      {
        reviewer: "api-tester",
        confirmation_id: "scheme-confirm-missing-0002",
      },
    );

    expect(res.status).toBe(409);
    // 关键：拒绝码必须是快照缺失，而不是"状态机不允许从 DRAFT 审批"
    expect(res.body.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");

    const list = await call<{
      contracts: Array<{ contract_id: string; lifecycle_state: string }>;
    }>("GET", "/api/contracts");
    const after = list.body.contracts.find(
      (c) => c.contract_id === contract.contract_id,
    );
    expect(after?.lifecycle_state).toBe("DRAFT");
  });

  it("T-HTTP-R10-003 快照存在但 Demo 仍在生成：409 E_DEMO_BUILDING", async () => {
    const confirmationId = "scheme-confirm-building-0001";
    const scheme = makeScheme();
    const plan = buildScopePlan({ repoRoot: repo, scheme });
    const frozen = await call("POST", "/api/supervisor/scheme/freeze", {
      ...freezePayload(
        confirmationId,
        scheme,
        {
          ...EMPTY_DEMO_GATE,
          status: "building",
          scheme_revision: scheme.scheme_revision,
        },
        plan,
      ),
    });
    expect(frozen.status).toBe(201);

    const res = await call("POST", "/api/contracts", {
      contract: makeContract("PENDING_APPROVAL", plan),
      confirmation_id: confirmationId,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("E_DEMO_BUILDING");
  });

  it("T-HTTP-R10-004 先冻结快照再创建合同：201，且快照可原样回读", async () => {
    const confirmationId = "scheme-confirm-ok-0001";
    const scheme = makeScheme();
    const plan = buildScopePlan({ repoRoot: repo, scheme });

    const frozen = await call<{ snapshot_id: string; digest: string }>(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezePayload(confirmationId, scheme, EMPTY_DEMO_GATE, plan),
    );
    expect(frozen.status).toBe(201);
    expect(frozen.body.snapshot_id).toBe(confirmationId);
    expect(frozen.body.digest).toMatch(/^[0-9a-f]{64}$/);

    const created = await call<{ contract: SoftwareContract }>(
      "POST",
      "/api/contracts",
      {
        contract: makeContract("PENDING_APPROVAL", plan),
        confirmation_id: confirmationId,
      },
    );
    expect(created.status).toBe(201);

    const readBack = await call<{
      snapshot: { status: string; scheme_revision: number; digest: string };
    }>(
      "GET",
      `/api/supervisor/scheme/freeze?confirmation_id=${confirmationId}`,
    );
    expect(readBack.status).toBe(200);
    expect(readBack.body.snapshot.status).toBe("FROZEN");
    expect(readBack.body.snapshot.scheme_revision).toBe(scheme.scheme_revision);
    expect(readBack.body.snapshot.digest).toBe(frozen.body.digest);
  });

  it("T-HTTP-R10-005 同 id 同内容重复冻结幂等；换修订则 409 冲突", async () => {
    const confirmationId = "scheme-confirm-idem-0001";
    const payload = freezePayload(confirmationId, makeScheme());

    const first = await call<{ digest: string }>(
      "POST",
      "/api/supervisor/scheme/freeze",
      payload,
    );
    expect(first.status).toBe(201);

    const second = await call<{ digest: string; idempotent: boolean }>(
      "POST",
      "/api/supervisor/scheme/freeze",
      payload,
    );
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.digest).toBe(first.body.digest);

    // 同一 confirmation_id 换了方案修订：不可覆盖不可变快照
    const changed = await call("POST", "/api/supervisor/scheme/freeze", {
      ...freezePayload(confirmationId, makeScheme(3)),
    });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("E_SCHEME_CONFIRMATION_CONFLICT");
  });

  // -------------------------------------------------------------------------
  // F-07：建图失败 → SIGN_AND_PREPARE 失败 → 补偿终止合同
  // -------------------------------------------------------------------------

  it("T-HTTP-F07-001 建图失败归入 SIGN_AND_PREPARE，补偿把已签合同终止为 ABORTED", async () => {
    const confirmationId = "scheme-confirm-f07-0001";
    const scheme = makeScheme();

    let createdContractId: string | null = null;
    let graphRejection = "";
    const compensated: string[] = [];
    let restored = 0;

    const result = await runConfirmSchemeAtomic({
      confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      expectedRevision: scheme.scheme_revision,

      quiesceRightChat: async () => {
        /* 真 UI 里是停流式 + 禁右栏；HTTP 测试无需模拟 */
      },

      // 阶段 3：真打 Daemon 的快照端点
      persistSnapshot: async ({
        confirmation_id,
        scheme: frozen,
        demo,
        decision,
      }) => {
        const res = await call<
          ErrBody & { snapshot_id: string; digest: string }
        >("POST", "/api/supervisor/scheme/freeze", {
          confirmation_id,
          scheme: frozen,
          demo,
          decision: {
            code: decision.code,
            message: decision.message,
            demo_mode: decision.demo_mode,
          },
          scope_plan: buildScopePlan({ repoRoot: repo, scheme: frozen }),
        });
        if (res.status >= 300) {
          throw new Error(`快照落盘失败 ${res.status} ${res.body.code ?? ""}`);
        }
        return {
          snapshot_id: res.body.snapshot_id,
          digest: res.body.digest,
        };
      },

      // 阶段 4：建合同（带 confirmation_id）→ 建任务图（注入失败）
      signAndPrepare: async ({ confirmation_id, onContractCreated }) => {
        const created = await call<ErrBody & { contract: SoftwareContract }>(
          "POST",
          "/api/contracts",
          {
            contract: makeContract(
              "PENDING_APPROVAL",
              buildScopePlan({ repoRoot: repo, scheme }),
            ),
            confirmation_id,
          },
        );
        if (created.status !== 201) {
          throw new Error(
            `建合同失败 ${created.status} ${created.body.code ?? ""}`,
          );
        }
        const contractId = created.body.contract.contract_id;
        createdContractId = contractId;
        onContractCreated?.(contractId);

        // 注入点：请求完全合法，只是提案里没有任何工程节点
        const graph = await call("POST", "/api/graph/proposal", {
          proposal: {
            schema_version: "1.0",
            contract_id: contractId,
            proposal_id: "proposal-f07-empty",
            functional_tree: [],
            nodes: [],
          },
        });
        if (graph.status !== 200) {
          graphRejection = `${graph.status} ${graph.body.code ?? ""}`.trim();
          throw new Error(
            `建图失败 ${graphRejection}（${graph.body.message ?? "提案没有任何工程节点"}）`,
          );
        }
        return { contract_id: contractId };
      },

      compensate: async ({ contract_id }) => {
        if (!contract_id) {
          throw new Error("补偿缺少 contract_id：无法定位半签合同");
        }
        const aborted = await call(
          "POST",
          `/api/contracts/${contract_id}/abort`,
          { reviewer: "local-user", reason: "任务图创建失败，回滚本次确认" },
        );
        if (aborted.status !== 200) {
          throw new Error(`中止合同失败 ${aborted.status}`);
        }
        compensated.push(contract_id);
      },

      restoreRightChat: () => {
        restored += 1;
      },
    });

    // 失败点判定
    expect(graphRejection).toBe("400 E_PROPOSAL_INVALID");
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("SIGN_AND_PREPARE");
    expect(result.code).toBe("E_SIGN_AND_PREPARE_FAILED");
    // 事务必须自己知道要吊销哪一份合同（不靠调用方闭包兜底）
    expect(result.contract_id).toBe(createdContractId);
    expect(compensated).toEqual([createdContractId]);
    // 补偿成功才允许解锁
    expect(restored).toBe(1);

    // Daemon 侧事实：合同真的被终止了
    const list = await call<{
      contracts: Array<{
        contract_id: string;
        lifecycle_state: string;
        approval: { status: string; rejection_reason?: string };
      }>;
    }>("GET", "/api/contracts");
    const saved = list.body.contracts.find(
      (c) => c.contract_id === createdContractId,
    );
    expect(saved?.lifecycle_state).toBe("ABORTED");
    // 补偿的 reason 必须落盘，不能只停在内存日志里
    expect(saved?.approval.rejection_reason).toContain("任务图创建失败");

    // 没有留下半张图
    const graph = await call(
      "GET",
      `/api/graph?contract_id=${createdContractId}`,
    );
    expect(graph.status).toBe(404);
    expect(graph.body.code).toBe("E_GRAPH_NOT_FOUND");
  });

  it("T-HTTP-F07-002 补偿本身失败（合同已被并发终止）：E_COMPENSATION_FAILED 且保持锁定", async () => {
    const confirmationId = "scheme-confirm-f07-0002";
    const scheme = makeScheme();

    const aborts: number[] = [];
    let restored = 0;

    const result = await runConfirmSchemeAtomic({
      confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      expectedRevision: scheme.scheme_revision,
      quiesceRightChat: async () => {},

      persistSnapshot: async ({
        confirmation_id,
        scheme: frozen,
        demo,
        decision,
      }) => {
        const res = await call<{ snapshot_id: string; digest: string }>(
          "POST",
          "/api/supervisor/scheme/freeze",
          {
            confirmation_id,
            scheme: frozen,
            demo,
            decision: {
              code: decision.code,
              message: decision.message,
              demo_mode: decision.demo_mode,
            },
            scope_plan: buildScopePlan({ repoRoot: repo, scheme: frozen }),
          },
        );
        if (res.status >= 300) {
          throw new Error(`快照落盘失败 ${res.status}`);
        }
        return { snapshot_id: res.body.snapshot_id, digest: res.body.digest };
      },

      signAndPrepare: async ({ confirmation_id, onContractCreated }) => {
        const created = await call<{ contract: SoftwareContract }>(
          "POST",
          "/api/contracts",
          {
            contract: makeContract(
              "PENDING_APPROVAL",
              buildScopePlan({ repoRoot: repo, scheme }),
            ),
            confirmation_id,
          },
        );
        if (created.status !== 201) {
          throw new Error(`建合同失败 ${created.status}`);
        }
        const contractId = created.body.contract.contract_id;
        onContractCreated?.(contractId);

        // 模拟"人工/并发流程已经把这份合同停掉"，使后续补偿无路可走
        const concurrentAbort = await call(
          "POST",
          `/api/contracts/${contractId}/abort`,
          { reviewer: "concurrent-user", reason: "并发终止" },
        );
        aborts.push(concurrentAbort.status);

        throw new Error("建图失败：提案没有任何工程节点");
      },

      compensate: async ({ contract_id }) => {
        if (!contract_id) throw new Error("补偿缺少 contract_id");
        const res = await call("POST", `/api/contracts/${contract_id}/abort`, {
          reviewer: "local-user",
          reason: "补偿重试",
        });
        aborts.push(res.status);
        if (res.status !== 200) {
          // ABORTED 是终态：重复中止被状态机拒绝，补偿无法完成
          throw new Error(`补偿失败 ${res.status} ${res.body.code ?? ""}`);
        }
      },

      restoreRightChat: () => {
        restored += 1;
      },
    });

    expect(aborts).toEqual([200, 409]);
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("SIGN_AND_PREPARE");
    expect(result.code).toBe("E_COMPENSATION_FAILED");
    expect(result.reason).toContain("补偿未完成");
    // 补偿没成功就不许解锁，否则用户会以为可以再点一次确认
    expect(restored).toBe(0);
  });
});
