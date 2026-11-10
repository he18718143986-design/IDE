// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import type { AdmissionView } from "../../src/lib/daemon-api";

/**
 * TASK-C.2 路由级接线验收：真实 Console 组件 + mock 的 Daemon 客户端。
 *
 * 与 `supervisor-studio-approval.test.tsx`（组件级）互补——
 * 这里走的是真实链路：新建合同 → 拿回 admission → 决定是否出现确认卡 →
 * 点「同意/不同意」才真的发请求。
 */

const pendingContract = softwareContractSchema.parse({
  ...createContractDraft({
    title: "给登录页加记住我",
    description: "只改登录相关组件",
    acceptanceCriteria: ["npm test 通过"],
    writablePaths: ["src/pages/**"],
  }),
  lifecycle_state: "PENDING_APPROVAL",
  approval: { status: "PENDING_REVIEW" },
});

const executingContract = softwareContractSchema.parse({
  ...pendingContract,
  lifecycle_state: "EXECUTING",
  approval: {
    status: "APPROVED",
    approved_by: "stagent-auto",
    approved_at: "2026-10-22T00:00:00.000Z",
    approved_revision: 1,
  },
});

const makeAdmission = (over: Partial<AdmissionView>): AdmissionView => ({
  decision: "NEEDS_APPROVAL",
  contract: pendingContract,
  protectedFiles: [],
  entryNames: [],
  ...over,
});

const createContractWithAdmission = vi.fn();
const admitContract = vi.fn();
const decideProtectionCard = vi.fn();
const abortContract = vi.fn();

vi.mock("@/lib/daemon-api", async (orig) => {
  const real = await orig<typeof import("@/lib/daemon-api")>();
  return {
    ...real,
    fetchHealth: vi.fn(async () => ({
      status: "ok",
      port: 0,
      repoRoot: "/Users/tina/Desktop/1020",
      currentBranch: "main",
    })),
    fetchProtection: vi.fn(async () => ({
      mode: "PROTECTED",
      entries: [{ id: "p1", name: "登录", patterns: ["src/pages/login*"] }],
      corrupt: null,
      round: {
        roundId: "round-c2",
        startedAt: "2026-10-22T00:00:00.000Z",
        pending: [],
        approvedFiles: [],
      },
      checkpoint: null,
    })),
    fetchProtectionRecommendations: vi.fn(async () => []),
    fetchSettings: vi.fn(async () => ({ configured: false })),
    fetchArchGraph: vi.fn(async () => {
      throw new Error("no graph in test");
    }),
    fetchRepoTree: vi.fn(async () => ({ root: "/tmp", files: ["src/a.ts"] })),
    listContracts: vi.fn(async () => []),
    fetchPresentationSnapshot: vi.fn(async () => ({
      version: 1,
      updated_at: null,
      contracts: {},
    })),
    readWorktreeFile: vi.fn(async (_c: unknown, p: string) => ({
      path: p,
      root: "/r",
      content: "",
      writable: true,
    })),
    createContractWithAdmission: (...args: unknown[]) =>
      createContractWithAdmission(...args),
    admitContract: (...args: unknown[]) => admitContract(...args),
    decideProtectionCard: (...args: unknown[]) => decideProtectionCard(...args),
    abortContract: (...args: unknown[]) => abortContract(...args),
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

async function createViaForm() {
  // 顶栏文案已改为「新建需求」（底层对象仍是 SoftwareContract）；
  // 点击会同时打开合同操作台，表单才不会渲染在看不见的标签里。
  // 欢迎区也有同名入口，所以用顶栏的 testid 精确定位。
  fireEvent.click(screen.getByTestId("new-requirement"));
  const title = screen.getByLabelText("标题");
  fireEvent.change(title, { target: { value: "给登录页加记住我" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /提交给 Daemon/ }));
  });
}

beforeEach(() => {
  // TASK-CI.3：本文件发出的未桩接口，以离线失败应答（与哨兵行为一致）
  stubOfflineFetch([
    "/api/supervisor/journey",
    "/api/project/plan",
    "/api/chat/adapters",
    "/api/chat/sessions",
    "/api/graph",
    "/api/baseline",
  ]);
});

describe("TASK-C.2 路由接线：无交集静默流转", () => {
  it("AUTO_APPROVED 后页面没有任何确认弹窗，也不调用 admit", async () => {
    createContractWithAdmission.mockResolvedValue({
      contract: executingContract,
      admission: makeAdmission({
        decision: "AUTO_APPROVED",
        contract: executingContract,
        reason: "合同范围未触碰保护清单，自动批准",
      }),
    });
    render(<Console />);
    await createViaForm();

    await waitFor(() =>
      expect(createContractWithAdmission).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("protection-confirm-card")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText(/同意吗/)).toBeNull();
    // 前端没有额外发审批请求：创建时 Daemon 已经自动批准了
    expect(admitContract).not.toHaveBeenCalled();
    expect(decideProtectionCard).not.toHaveBeenCalled();
  });
});

describe("TASK-C.2 路由接线：有交集仅 1 张卡，点同意才发请求", () => {
  it("NEEDS_APPROVAL 只出现 1 张白话卡，且未点击前不发请求", async () => {
    admitContract.mockResolvedValue(
      makeAdmission({
        decision: "AUTO_APPROVED",
        contract: executingContract,
      }),
    );
    createContractWithAdmission.mockResolvedValue({
      contract: pendingContract,
      admission: makeAdmission({
        protectedFiles: ["src/pages/login.tsx"],
        entryNames: ["登录"],
        cardId: "card-c2",
      }),
    });

    render(<Console />);
    await createViaForm();

    const cards = await screen.findAllByTestId("protection-confirm-card");
    expect(cards).toHaveLength(1);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByTestId("protection-confirm-question")).toHaveTextContent(
      "AI 想修改被保护的【登录】代码，同意吗？",
    );
    // 关键：渲染出来 ≠ 已发请求
    expect(decideProtectionCard).not.toHaveBeenCalled();
    expect(admitContract).not.toHaveBeenCalled();
  });

  it("点「同意」先记本轮放行，再请求准入推进；成功后卡片消失", async () => {
    decideProtectionCard.mockResolvedValue(undefined);
    admitContract.mockResolvedValue(
      makeAdmission({
        decision: "AUTO_APPROVED",
        contract: executingContract,
      }),
    );
    createContractWithAdmission.mockResolvedValue({
      contract: pendingContract,
      admission: makeAdmission({
        protectedFiles: ["src/pages/login.tsx"],
        entryNames: ["登录"],
        cardId: "card-c2",
      }),
    });

    render(<Console />);
    await createViaForm();
    fireEvent.click(await screen.findByTestId("protection-confirm-approve"));

    await waitFor(() =>
      expect(admitContract).toHaveBeenCalledWith(
        expect.anything(),
        pendingContract.contract_id,
      ),
    );
    expect(decideProtectionCard).toHaveBeenCalledWith(
      expect.anything(),
      "card-c2",
      "approve",
    );
    // 推进成功后不再有卡片残留（AUTO_APPROVED 不进状态）
    await waitFor(() =>
      expect(screen.queryByTestId("protection-confirm-card")).toBeNull(),
    );
  });

  it("点「不同意」记拒绝并中止合同（坚决取消）", async () => {
    decideProtectionCard.mockResolvedValue(undefined);
    abortContract.mockResolvedValue({ ...pendingContract });
    createContractWithAdmission.mockResolvedValue({
      contract: pendingContract,
      admission: makeAdmission({
        protectedFiles: ["src/pages/login.tsx"],
        entryNames: ["登录"],
        cardId: "card-c2",
      }),
    });

    render(<Console />);
    await createViaForm();
    fireEvent.click(await screen.findByTestId("protection-confirm-deny"));

    await waitFor(() =>
      expect(abortContract).toHaveBeenCalledWith(
        expect.anything(),
        pendingContract.contract_id,
        "local-user",
        expect.stringContaining("不同意"),
      ),
    );
    expect(decideProtectionCard).toHaveBeenCalledWith(
      expect.anything(),
      "card-c2",
      "deny",
    );
    await waitFor(() =>
      expect(screen.queryByTestId("protection-confirm-card")).toBeNull(),
    );
  });
});
