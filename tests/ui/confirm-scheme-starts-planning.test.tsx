// @vitest-environment jsdom
/**
 * TASK-J.50b：确认方案只冻结并开始规划，地图确认开工才签署并 runWorker。
 * 覆盖生产用户路径，而不是只证明模块存在。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { DaemonApiError } from "../../src/lib/daemon-api";
import {
  formatBudgetPlain,
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import type { ProjectPlan } from "../../src/lib/project/project-plan";
import { resetConfirmSchemeTransactionsForTest } from "../../src/lib/journey/confirm-scheme-atomic";

const seedContract = softwareContractSchema.parse({
  ...createContractDraft({
    title: "登录页改版",
    description: "把登录页的按钮换成圆角，并补空状态提示。",
    acceptanceCriteria: ["登录页能打开"],
    writablePaths: ["src/**"],
  }),
  lifecycle_state: "EXECUTING",
  approval: {
    status: "APPROVED",
    approved_by: "local-user",
    approved_at: "2026-10-21T00:00:00.000Z",
    approved_revision: 1,
  },
});

function compliantScopePlan(revision: number): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: revision,
    plan_digest: "",
    areas: [
      {
        id: "area-0",
        label: "登录页",
        why: "因为要改登录页按钮和空状态",
        module_ids: ["mod-0"],
        kind: "change_existing",
        paths: ["src/pages/login/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [{ label: "密码与钥匙文件", paths: [".env*"] }],
    needs_approval: [],
    verification: {
      commands: [],
      plain: ["登录页能打开且按钮是圆角"],
      manual_only: true,
    },
    budget: {
      limits: {
        max_file_modifications: 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 3,
        max_command_executions: 40,
        max_tool_calls: 200,
      },
      plain: formatBudgetPlain({
        max_file_modifications: 10,
        max_duration_seconds: 1800,
      }),
    },
    grade: { ok: true, rejected: [] },
  };
  const withDigest: ScopePlan = { ...plan, plan_digest: "" };
  withDigest.plan_digest = scopePlanDigest(withDigest);
  return withDigest;
}

function makeProjectPlan(): ProjectPlan {
  return {
    schema_version: "1.0.0",
    project_id: "proj-login",
    plan_revision: 1,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "digest-pab-1",
    },
    scheme_id: "scheme-login",
    scheme_revision: 1,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "先改登录页",
        exit_acceptance_ids: ["acc-1"],
        contract_ids: ["cs-login"],
      },
    ],
    contracts: [
      {
        stub_id: "cs-login",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "登录页按钮与空状态",
        scheme_item_ids: ["g1"],
        acceptance_ids: ["acc-1"],
        area_hints: ["auth"],
        depends_on: [],
        size_estimate: { files: 4, diff_lines: 120, minutes: 30 },
        status: "planned",
        contract_id: null,
      },
    ],
    graveyard: [],
  };
}

const midpane = {
  available: true,
  scheme_id: "scheme-login",
  scheme_revision: 1,
  frozen: false,
  title: "登录页",
  summary: "把登录页的按钮换成圆角，并补一个空状态提示。",
  goals: [{ id: "g1", text: "登录页按钮圆角并有空状态" }],
  modules: [{ id: "m1", name: "登录页" }],
  decisions: [],
  conflicts: [],
  acceptance: [{ id: "a1", text: "登录页能打开且按钮是圆角" }],
};

const api = vi.hoisted(() => {
  const contracts: unknown[] = [];
  return {
    contracts,
    planReady: false,
    decomposeError: null as Error | null,
    freezeSchemeSnapshot: vi.fn(
      async (
        _conn: unknown,
        input: { confirmation_id: string },
      ): Promise<{
        snapshot_id: string;
        digest: string;
        idempotent: boolean;
      }> => ({
        snapshot_id: `snap-${input.confirmation_id}`,
        digest: "digest-frozen",
        idempotent: false,
      }),
    ),
    decomposeProjectPlan: vi.fn(),
    preflightScope: vi.fn(),
    createContractWithAdmission: vi.fn(),
    approveContract: vi.fn(),
    createTaskGraph: vi.fn(),
    runWorker: vi.fn(),
    listContracts: vi.fn(async () => contracts.slice()),
    getProjectPlan: vi.fn(),
  };
});

vi.mock("@/lib/daemon-api", async (orig) => {
  const real = await orig<typeof import("@/lib/daemon-api")>();
  api.preflightScope.mockImplementation(
    async (_conn: unknown, input: { stub_id?: string }) => ({
      scope_plan: compliantScopePlan(1),
      stub_id: input.stub_id ?? null,
    }),
  );
  api.decomposeProjectPlan.mockImplementation(
    async (_conn: unknown, input: { pab: unknown }) => {
      if (api.decomposeError) throw api.decomposeError;
      api.planReady = true;
      return { ok: true, plan: makeProjectPlan(), pab: input.pab };
    },
  );
  api.getProjectPlan.mockImplementation(async () => {
    if (!api.planReady) {
      throw new real.DaemonApiError(404, "计划尚未生成");
    }
    const plan = makeProjectPlan();
    return {
      ok: true,
      plan,
      next_stub_id: "cs-login",
      next_stub: plan.contracts[0],
    };
  });
  api.createContractWithAdmission.mockImplementation(
    async (_conn: unknown, contract: typeof seedContract) => {
      const saved = {
        ...contract,
        contract_id: contract.contract_id || "ctr-started",
      };
      api.contracts = [
        ...api.contracts.filter((c) => c.contract_id !== saved.contract_id),
        saved,
      ];
      return { contract: saved, admission: null };
    },
  );
  api.approveContract.mockResolvedValue(undefined);
  api.createTaskGraph.mockResolvedValue({
    schema_version: "1.0",
    graph_id: "g1",
    contract_id: "ctr-started",
    generated_at: "2026-11-24T00:00:00.000Z",
    updated_at: "2026-11-24T00:00:00.000Z",
    revision: 1,
    functional_tree: [],
    nodes: [{ node_id: "n1" }],
    fingerprints: [],
    issues: [],
    progress: { total: 1, illuminated: 0, percent: 0, by_state: {} },
  });
  api.runWorker.mockResolvedValue({
    applied: true,
    changes: [],
    log: ["worker-ok"],
    usage: { inputTokens: 0, outputTokens: 0 },
    blockers: [],
  });

  return {
    ...real,
    fetchHealth: vi.fn(async () => ({
      status: "ok",
      port: 0,
      repoRoot: "/tmp/j50b-login",
      currentBranch: "main",
    })),
    fetchProtection: vi.fn(async () => ({
      mode: "VIBE",
      entries: [],
      corrupt: null,
      round: {
        roundId: "round-test",
        startedAt: "2026-10-21T00:00:00.000Z",
        pending: [],
        approvedFiles: [],
      },
      checkpoint: null,
    })),
    fetchProtectionRecommendations: vi.fn(async () => []),
    listContracts: (...args: unknown[]) => api.listContracts(...args),
    fetchPresentationSnapshot: vi.fn(async () => ({
      version: 1,
      updated_at: null,
      contracts: {},
    })),
    fetchArchGraph: vi.fn(async () => {
      throw new Error("no graph in test");
    }),
    fetchRepoTree: vi.fn(async () => ({
      root: "/tmp/j50b-login",
      files: ["src/pages/login.tsx", "package.json"],
    })),
    fetchSettings: vi.fn(async () => ({ configured: false })),
    fetchSchemeMidpane: vi.fn(async () => midpane),
    previewSchemeItemBacklinks: vi.fn(async () => ({
      ok: true,
      items: [],
      quotes: [],
      covered_count: 0,
      uncovered_count: 0,
    })),
    preflightScope: (...args: unknown[]) => api.preflightScope(...args),
    freezeSchemeSnapshot: (...args: unknown[]) =>
      api.freezeSchemeSnapshot(...args),
    decomposeProjectPlan: (...args: unknown[]) =>
      api.decomposeProjectPlan(...args),
    getProjectPlan: (...args: unknown[]) => api.getProjectPlan(...args),
    createContractWithAdmission: (...args: unknown[]) =>
      api.createContractWithAdmission(...args),
    approveContract: (...args: unknown[]) => api.approveContract(...args),
    createTaskGraph: (...args: unknown[]) => api.createTaskGraph(...args),
    runWorker: (...args: unknown[]) => api.runWorker(...args),
    listChatAdapters: vi.fn(async () => []),
    listChatSessions: vi.fn(async () => []),
  };
});

vi.mock("@monaco-editor/react", () => ({
  default: (p: { value: string }) => (
    <textarea data-testid="monaco" value={p.value} readOnly />
  ),
}));

vi.mock("@/hooks/use-daemon-stream", () => ({
  useDaemonStream: () => ({
    status: "closed",
    logs: [],
    alerts: [],
    terminal: [],
    dismissAlert: () => {},
    clearLogs: () => {},
    clearTerminal: () => {},
  }),
}));

const { Route } = await import("../../src/routes/index");
const Console = Route.options.component as React.ComponentType;

async function openStudio() {
  fireEvent.click(screen.getByTestId("activity-workbench"));
  const item = await screen.findByRole("button", { name: /登录页改版/ });
  fireEvent.click(item);
  expect(await screen.findByTestId("scheme-review-pane")).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByTestId("scheme-confirm")).not.toBeDisabled();
  });
}

async function confirmSchemeStartsPlanning() {
  fireEvent.click(screen.getByTestId("scheme-confirm"));
  await waitFor(() => {
    expect(screen.getByTestId("project-map-pane")).toBeInTheDocument();
  });
}

beforeEach(() => {
  resetConfirmSchemeTransactionsForTest();
  api.planReady = false;
  api.decomposeError = null;
  api.contracts.splice(0, api.contracts.length, seedContract);
  api.freezeSchemeSnapshot.mockClear();
  api.decomposeProjectPlan.mockClear();
  api.preflightScope.mockClear();
  api.createContractWithAdmission.mockClear();
  api.approveContract.mockClear();
  api.createTaskGraph.mockClear();
  api.runWorker.mockClear();
  stubOfflineFetch([
    "/api/supervisor/journey",
    "/api/supervisor/scheme-midpane",
    "/api/project/plan",
    "/api/chat/adapters",
    "/api/chat/sessions",
    "/api/graph",
    "/api/preview/real/status",
    "/api/playtest/reference-snapshots",
    "/api/baseline",
    "/api/playtest/status",
    "/api/knowledge/modules",
    "/api/supervisor/surface-log",
  ]);
});

describe("TASK-J.50b 确认方案开始规划", () => {
  it("J50b-P1 确认方案只冻结并开始规划", async () => {
    render(<Console />);
    await openStudio();
    expect(screen.getByTestId("scheme-confirm")).toHaveTextContent(
      "确认方案，开始规划",
    );
    await confirmSchemeStartsPlanning();

    expect(api.decomposeProjectPlan).toHaveBeenCalledTimes(1);
    const decomposeInput = api.decomposeProjectPlan.mock.calls[0]![1] as {
      pab: unknown;
      scheme: unknown;
    };
    expect(decomposeInput.pab).toBeNull();
    expect(api.freezeSchemeSnapshot).toHaveBeenCalledTimes(1);
    const freezeInput = api.freezeSchemeSnapshot.mock.calls[0]![1] as {
      confirmation_id: string;
    };
    expect(freezeInput.confirmation_id.startsWith("scheme-plan-")).toBe(true);
    expect(api.createContractWithAdmission).not.toHaveBeenCalled();
    expect(api.approveContract).not.toHaveBeenCalled();
    expect(api.runWorker).not.toHaveBeenCalled();
    expect(screen.queryByTestId("handoff-started-card")).toBeNull();
    expect(screen.queryByText("正在准备开工")).toBeNull();
    expect(screen.getByTestId("project-map-pane")).toHaveTextContent("登录页");
  });

  it("J50b-P2 地图确认开工仍按合同桩签署并开工", async () => {
    render(<Console />);
    await openStudio();
    await confirmSchemeStartsPlanning();
    expect(api.runWorker).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("project-map-confirm-start"));
    await waitFor(() => {
      expect(api.runWorker).toHaveBeenCalledTimes(1);
    });

    expect(api.preflightScope).toHaveBeenCalled();
    const preflightCalls = api.preflightScope.mock.calls;
    const startPreflight = preflightCalls.find(
      (call) => (call[1] as { stub_id?: string }).stub_id === "cs-login",
    );
    expect(startPreflight).toBeTruthy();
    expect(api.createContractWithAdmission).toHaveBeenCalledTimes(1);
    const createdArgs = api.createContractWithAdmission.mock.calls[0] as [
      unknown,
      unknown,
      { confirmationId: string },
    ];
    expect(createdArgs[2].confirmationId.startsWith("scheme-start-")).toBe(
      true,
    );
    expect(createdArgs[2].confirmationId).not.toBe(
      (
        api.freezeSchemeSnapshot.mock.calls[0]![1] as {
          confirmation_id: string;
        }
      ).confirmation_id,
    );
    expect(api.approveContract).toHaveBeenCalledTimes(1);
    expect(api.runWorker).toHaveBeenCalledTimes(1);
  });

  it("J50b-P4 生产用户路径集成测试", async () => {
    render(<Console />);
    await openStudio();
    expect(screen.queryByTestId("project-map-pane")).toBeNull();
    await confirmSchemeStartsPlanning();
    expect(screen.getByTestId("project-map-pane")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-confirm-start")).toHaveTextContent(
      "确认开工",
    );
    expect(api.createContractWithAdmission).not.toHaveBeenCalled();
    expect(api.runWorker).not.toHaveBeenCalled();
    expect(screen.queryByTestId("handoff-started-card")).toBeNull();
  });

  it("J50b-P5 不把当前登录页按 tiny 绕过", async () => {
    render(<Console />);
    await openStudio();
    expect(screen.getByTestId("scheme-review-pane")).toHaveTextContent(
      "登录页",
    );
    await confirmSchemeStartsPlanning();
    const decomposeInput = api.decomposeProjectPlan.mock.calls[0]![1] as {
      pab: unknown;
      size_hint?: unknown;
    };
    expect(decomposeInput.pab).toBeNull();
    expect(decomposeInput.size_hint).not.toBe("tiny");
    expect(api.runWorker).not.toHaveBeenCalled();
    expect(api.createContractWithAdmission).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-map-pane")).toBeInTheDocument();
  });

  it("不具备资格时 scheme-error 出现白话原因且不 runWorker", async () => {
    const plain = "还没有准备好项目架构说明，不能开始规划。";
    api.decomposeError = new DaemonApiError(422, plain, {
      code: "E_PAB_NOT_READY",
      body: { error: plain, code: "E_PAB_NOT_READY" },
    });
    render(<Console />);
    await openStudio();
    fireEvent.click(screen.getByTestId("scheme-confirm"));
    const error = await screen.findByTestId("scheme-error");
    expect(error).toHaveTextContent(plain);
    expect(api.runWorker).not.toHaveBeenCalled();
    expect(api.createContractWithAdmission).not.toHaveBeenCalled();
    expect(screen.queryByTestId("project-map-pane")).toBeNull();
    expect(screen.getByTestId("scheme-confirm")).toHaveTextContent(
      "方案已确认",
    );
  });
});
