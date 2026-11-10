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
import { fetchProtection } from "../../src/lib/daemon-api";

const contract = softwareContractSchema.parse({
  ...createContractDraft({
    title: "主页面接线测试",
    description: "验证旧功能仍在",
    acceptanceCriteria: ["npm test 通过"],
    writablePaths: ["src/**"],
  }),
  lifecycle_state: "EXECUTING",
  approval: {
    status: "APPROVED",
    approved_by: "local-user",
    approved_at: "2026-10-20T00:00:00.000Z",
    approved_revision: 1,
  },
});

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
    listContracts: vi.fn(async () => [contract]),
    fetchPresentationSnapshot: vi.fn(async () => ({
      version: 1,
      updated_at: null,
      contracts: {},
    })),
    fetchArchGraph: vi.fn(async () => {
      throw new Error("no graph in test");
    }),
    fetchRepoTree: vi.fn(async () => ({
      root: "/Users/tina/Desktop/1020",
      files: ["README.md", "src/routes/index.tsx", "package.json"],
    })),
    fetchSettings: vi.fn(async () => ({ configured: false })),
    readWorktreeFile: vi.fn(async (_c: unknown, p: string) => ({
      path: p,
      root: "/r",
      content: `内容 of ${p}`,
      writable: true,
    })),
  };
});
let streamOpts: Record<string, (p: unknown) => void> = {};
vi.mock("@monaco-editor/react", () => ({
  default: (p: { value: string }) => (
    <textarea data-testid="monaco" value={p.value} readOnly />
  ),
}));
vi.mock("@/hooks/use-daemon-stream", () => ({
  useDaemonStream: (o: Record<string, (p: unknown) => void>) => {
    streamOpts = o;
    return {
      status: "closed",
      logs: [],
      alerts: [],
      terminal: [],
      dismissAlert: () => {},
      clearLogs: () => {},
      clearTerminal: () => {},
    };
  },
}));

const { Route } = await import("../../src/routes/index");
const Console = Route.options.component as React.ComponentType;

/** C.16：需求列表在合同操作台左侧栏；测试先开单门再点需求。 */
async function openRequirement(title: string) {
  fireEvent.click(screen.getByTestId("activity-workbench"));
  const item = await screen.findByRole("button", { name: new RegExp(title) });
  fireEvent.click(item);
}

beforeEach(() => {
  // TASK-CI.3：本文件发出的未桩接口，以离线失败应答（与哨兵行为一致）
  stubOfflineFetch([
    "/api/supervisor/journey",
    "/api/project/plan",
    "/api/chat/adapters",
    "/api/chat/sessions",
    "/api/graph",
    "/api/preview/real/status",
    "/api/playtest/reference-snapshots",
    "/api/baseline",
    "/api/playtest/status",
  ]);
});

describe("TASK-C.1 主页面接入三栏工作台", () => {
  it("首屏是空编辑区：不自动打开 Studio，顶栏只留状态胶囊", async () => {
    render(<Console />);
    expect(screen.getByTestId("workspace-layout")).toBeInTheDocument();
    expect(screen.getByTestId("run-mode")).toHaveAttribute("data-mode", "VIBE");
    // 新交互：首屏不再默认打开 Supervisor Studio，中央是欢迎/空编辑区
    expect(screen.queryByRole("tab", { name: "方案工作台" })).toBeNull();
    expect(screen.getByTestId("welcome-pane")).toBeInTheDocument();
    // 顶栏收口：右侧只有一个最小操作点（欢迎区另有自己的入口，故用 testid 定位）
    expect(screen.getByTestId("new-requirement")).toHaveTextContent("新建需求");
    // 原来挤在顶栏的运维读数，现在都不在顶栏里
    const header = screen.getByTestId("workspace-header");
    expect(header).not.toHaveTextContent("GATEWAY_ENFORCED");
    expect(header).not.toHaveTextContent("实时流");
    expect(screen.queryByTestId("worker-control")).toBeNull();
    expect(screen.queryByTestId("stream-status")).toBeNull();
    // 真实数据：仓库名来自 Daemon health
    await waitFor(() =>
      expect(screen.getByTestId("repo-name")).toHaveTextContent("1020"),
    );
  });

  it("连接与诊断收进设置页：齿轮打开设置 Tab，模型钥匙 / 实时流都在里面", async () => {
    render(<Console />);
    fireEvent.click(screen.getByTestId("activity-settings"));
    expect(
      screen.getByRole("tab", { name: "设置" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByTestId("settings-tab")).toBeInTheDocument();
    // 原顶栏上的三样东西现在都在设置页
    expect(screen.getByTestId("settings-model-key")).toBeInTheDocument();
    expect(screen.getByTestId("model-key-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("stream-status")).toBeInTheDocument();
    expect(screen.getByTestId("worker-control")).toBeInTheDocument();
    // 连接配置可编辑
    expect(screen.getByTestId("daemon-url")).toBeInTheDocument();
    expect(screen.getByTestId("session-token")).toBeInTheDocument();
  });

  it("点需求才打开方案工作台单页（C.18 无五视口/旧合同卡按钮）", async () => {
    render(<Console />);
    await openRequirement("主页面接线测试");
    expect(screen.getByRole("tab", { name: "方案工作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // C.18：中间仅方案审阅；旧「运行 Worker / 执行验证 / 查看 Diff」不在日常单页
    expect(
      screen.getByTestId("studio-viewport-panel-scheme"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("studio-viewport-tabs")).toBeNull();
    expect(screen.getByTestId("scheme-review-pane")).toBeInTheDocument();
    // P.1 顺手修：顶栏分支改为显示主工作区真实分支（不再按合同拼 task/xxx）；
    // 合同与 Worktree 绑定仍由 workspace-binding 体现
    expect(screen.getByTestId("current-branch")).toHaveTextContent("main");
    expect(screen.getByTestId("workspace-binding")).toHaveAttribute(
      "data-bound",
      "worktree",
    );
  });

  it("架构雷达移出左栏：经操作台「项目全景」打开", async () => {
    render(<Console />);
    // 左栏纯文件树；架构雷达在项目全景深页
    expect(screen.queryByText("架构雷达", { exact: false })).toBeNull();
    expect(screen.getByTestId("left-column").textContent).not.toMatch(
      /需求（合同/,
    );
    fireEvent.click(screen.getByTestId("activity-workbench"));
    fireEvent.click(screen.getByTestId("studio-open-panorama"));
    expect(screen.getByTestId("supervisor-architecture")).toBeInTheDocument();
    expect(screen.getByTestId("load-arch-graph")).toBeInTheDocument();
  });
  it("保护清单损坏：显示白话警告，顶栏不再假装自由模式", async () => {
    vi.mocked(fetchProtection).mockResolvedValueOnce({
      mode: "CORRUPT",
      entries: [],
      corrupt: "保护清单已损坏（结构不合法）",
      round: {
        roundId: "round-corrupt",
        startedAt: "2026-10-21T00:00:00.000Z",
        pending: [],
        approvedFiles: [],
      },
      checkpoint: null,
    });
    render(<Console />);

    expect(
      await screen.findByTestId("protection-corrupt-banner"),
    ).toHaveTextContent("保护清单损坏，AI 所有改动暂时被拦");
    await waitFor(() =>
      expect(screen.getByTestId("run-mode")).toHaveAttribute(
        "data-mode",
        "PROTECTED",
      ),
    );
  });

  it("Sprint 1 门禁（假数据）：Agent 改文件 → 中栏自动打开 Monaco；Evidence STALE → 横幅", async () => {
    render(<Console />);
    await openRequirement("主页面接线测试");
    const base = { session_id: "s", turn_id: "t", at: "" };
    act(() => {
      streamOpts.onChatEvent?.({
        ...base,
        seq: 1,
        kind: "tool_call",
        tool_id: "e1",
        name: "Edit",
        input: { file_path: "/Users/tina/Desktop/1020/src/a.ts" },
      });
      streamOpts.onChatEvent?.({
        ...base,
        seq: 2,
        kind: "tool_result",
        tool_id: "e1",
        output: "ok",
        is_error: false,
      });
    });
    expect(await screen.findByRole("tab", { name: "a.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(screen.getByTestId("monaco")).toHaveValue("内容 of src/a.ts"),
    );
    expect(screen.queryByTestId("evidence-stale-banner")).toBeNull();
    act(() => {
      streamOpts.onEvidenceStatus?.({
        contract_id: contract.contract_id,
        evidence_id: "ev",
        status: "STALE",
      });
    });
    expect(screen.getByTestId("evidence-stale-banner")).toHaveTextContent(
      "STALE",
    );
  });
});
