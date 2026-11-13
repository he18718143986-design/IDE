// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsTab } from "../../src/components/settings/SettingsTab";
import type { DaemonConnection } from "../../src/lib/daemon-api";
import { ModelKeyPanel } from "../../src/routes/index";

/**
 * 设置页验收。
 *
 * 这一页存在的理由是把「控制项」从顶栏挪走，所以这里重点验证两件事：
 * 1. 搬运后**语义没丢**——原来顶栏的受控徽标三态（受控/非受控/断线未知）
 *    在这里一模一样，断线不再假装受控；
 * 2. 连接表单真的能改并回传（不是只画了两个输入框）。
 */

const conn: DaemonConnection = {
  baseUrl: "http://127.0.0.1:3001",
  token: "t-0",
};

function renderSettings(over: Partial<Parameters<typeof SettingsTab>[0]> = {}) {
  const onConnChange = vi.fn();
  render(
    <SettingsTab
      conn={conn}
      onConnChange={onConnChange}
      connected
      daemonPort={3001}
      repoPath="/Users/tina/Desktop/1018"
      baseBranch="main"
      runMode="VIBE"
      protectedCount={0}
      workerControl="GATEWAY_ENFORCED"
      streamStatus="connected"
      {...over}
    />,
  );
  return { onConnChange };
}

beforeEach(() => {
  // TASK-CI.3：本文件发出的未桩接口，以离线失败应答（与哨兵行为一致）
  stubOfflineFetch(["/api/vault", "/api/workers"]);
});

describe("设置页：受控状态搬运后语义不变", () => {
  it("GATEWAY_ENFORCED 显示受控且为绿色", () => {
    renderSettings();
    const b = screen.getByTestId("worker-control");
    expect(b).toHaveTextContent("GATEWAY_ENFORCED");
    expect(b.className).toMatch(/green/);
  });

  it("UNCONTROLLED_EXTERNAL 变黄，不说成受控", () => {
    renderSettings({ workerControl: "UNCONTROLLED_EXTERNAL" });
    const b = screen.getByTestId("worker-control");
    expect(b).toHaveTextContent("UNCONTROLLED_EXTERNAL");
    expect(b.className).toMatch(/yellow/);
  });

  it("断开后台时受控状态标为未知并变暗（P.1 顺手修）", () => {
    renderSettings({ connected: false, daemonPort: null });
    const b = screen.getByTestId("worker-control");
    expect(b).toHaveTextContent("未连上后台");
    expect(b).toHaveAttribute("data-control", "OFFLINE");
    expect(b.className).toMatch(/opacity-60/);
    expect(screen.getByTestId("daemon-connection-state")).toHaveTextContent(
      "未连接",
    );
  });

  it("实时流诊断三种状态读得出", () => {
    const { rerender } = render(
      <SettingsTab
        conn={conn}
        onConnChange={() => {}}
        connected
        daemonPort={3001}
        repoPath="/r"
        baseBranch="main"
        runMode="VIBE"
        protectedCount={0}
        workerControl="GATEWAY_ENFORCED"
        streamStatus="reconnecting"
      />,
    );
    expect(screen.getByTestId("stream-status")).toHaveTextContent("重连中");
    rerender(
      <SettingsTab
        conn={conn}
        onConnChange={() => {}}
        connected
        daemonPort={3001}
        repoPath="/r"
        baseBranch="main"
        runMode="VIBE"
        protectedCount={0}
        workerControl="GATEWAY_ENFORCED"
        streamStatus="closed"
      />,
    );
    expect(screen.getByTestId("stream-status")).toHaveTextContent("未开");
  });
});

describe("设置页：连接与工作区", () => {
  it("改完地址后「应用」才可点，并把草稿回传", () => {
    const { onConnChange } = renderSettings();
    const apply = screen.getByTestId("apply-connection");
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByTestId("daemon-url"), {
      target: { value: "http://127.0.0.1:3999" },
    });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onConnChange).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:3999",
      token: "t-0",
    });
  });

  it("Worktree 绝对路径只在有合同时显示（顶栏已不展示）", () => {
    renderSettings({
      worktreePath: "/Users/tina/Desktop/1018/.stagent/worktrees/task-c-1",
      executionStatus: "执行中",
    });
    expect(screen.getByTestId("contract-info")).toHaveTextContent(
      "/Users/tina/Desktop/1018/.stagent/worktrees/task-c-1",
    );
    expect(screen.getByTestId("contract-info")).toHaveTextContent("执行中");
  });

  it("没有本轮快照就不给「撤销本轮」（不画点了没反应的按钮）", () => {
    renderSettings({ checkpoint: null });
    expect(screen.queryByTestId("undo-round")).toBeNull();
  });

  it("有快照才出现「撤销本轮」，点击走真实回调", () => {
    const onUndoRound = vi.fn();
    renderSettings({ checkpoint: "round-1", onUndoRound });
    fireEvent.click(screen.getByTestId("undo-round"));
    expect(onUndoRound).toHaveBeenCalledTimes(1);
  });
});

describe("设置页：Token 粘贴的脏字符防线", () => {
  it("粘进来的换行/零宽字符在输入框里就被洗掉，回传的是干净 Token", () => {
    const { onConnChange } = renderSettings();
    fireEvent.change(screen.getByTestId("session-token"), {
      target: { value: "\n deadbeef\u200B\n" },
    });
    expect(screen.getByTestId("session-token")).toHaveValue("deadbeef");
    fireEvent.click(screen.getByTestId("apply-connection"));
    expect(onConnChange).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:3001",
      token: "deadbeef",
    });
  });

  it("含中文时当场红字告警（而不是等 fetch 抛 non ISO-8859-1）", () => {
    renderSettings();
    expect(screen.queryByTestId("token-non-ascii-warning")).toBeNull();
    fireEvent.change(screen.getByTestId("session-token"), {
      target: { value: "deadbeef 中文说明" },
    });
    expect(screen.getByTestId("token-non-ascii-warning")).toHaveTextContent(
      "浏览器不允许写进请求头",
    );
  });

  it("全角字符按 NFKC 归一半角后不触发告警（粘贴全角字母也能用）", () => {
    renderSettings();
    fireEvent.change(screen.getByTestId("session-token"), {
      target: { value: "ａｂｃ１２３" },
    });
    expect(screen.getByTestId("session-token")).toHaveValue("abc123");
    expect(screen.queryByTestId("token-non-ascii-warning")).toBeNull();
  });
});

describe("设置页 C.10b：老板主路径", () => {
  it("模型钥匙在高级之前；高级默认折叠", () => {
    renderSettings({
      modelKeySlot: <div data-testid="settings-model-key-slot">key</div>,
    });
    const tab = screen.getByTestId("settings-tab");
    const model = screen.getByTestId("settings-model-key");
    const advanced = screen.getByTestId("settings-advanced");
    expect(
      tab.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_CONTAINED_BY,
    ).toBeTruthy();
    // model precedes advanced
    expect(
      model.compareDocumentPosition(advanced) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(advanced).not.toHaveAttribute("open");
    expect(screen.getByTestId("settings-advanced-summary")).toHaveTextContent(
      "高级",
    );
  });

  it("Daemon / Session Token 控件在高级内，不在主视线顶栏文案里", () => {
    renderSettings();
    const advanced = screen.getByTestId("settings-advanced");
    expect(advanced.querySelector('[data-testid="daemon-url"]')).not.toBeNull();
    expect(
      advanced.querySelector('[data-testid="session-token"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("settings-tab").textContent).toMatch(/模型钥匙/);
    expect(screen.getByTestId("settings-tab").textContent).toMatch(
      /先配好模型钥匙/,
    );
    // 主头不再用 Daemon 作标题词
    const header = screen.getByTestId("settings-tab").querySelector("header");
    expect(header?.textContent ?? "").not.toMatch(
      /Daemon|Session Token|GATEWAY/,
    );
  });

  it("配完了返回对话仍可用（C.9d 保留）", () => {
    const onReturnToChat = vi.fn();
    renderSettings({ onReturnToChat });
    fireEvent.click(screen.getByTestId("settings-return-to-chat"));
    expect(onReturnToChat).toHaveBeenCalledTimes(1);
  });

  it("展开高级后仍能改连接并应用", () => {
    const { onConnChange } = renderSettings();
    fireEvent.click(screen.getByTestId("settings-advanced-summary"));
    fireEvent.change(screen.getByTestId("daemon-url"), {
      target: { value: "http://127.0.0.1:4001" },
    });
    fireEvent.click(screen.getByTestId("apply-connection"));
    expect(onConnChange).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4001",
      token: "t-0",
    });
  });
});

describe("设置页 C.10l：高级里可选会话/适配器", () => {
  const chatSession = {
    adapters: [
      {
        id: "claude-code",
        label: "Claude Code",
        available: true,
        control_mode: "GATEWAY_ENFORCED" as const,
        verified_on: "2026-10-01",
        tool_mode: "read_only" as const,
      },
      {
        id: "demo",
        label: "练习沙箱",
        available: true,
        control_mode: "GATEWAY_ENFORCED" as const,
        verified_on: "",
        tool_mode: "read_only" as const,
      },
    ],
    sessions: [
      {
        id: "s1",
        title: "会话一",
        adapter_id: "claude-code",
        created_at: "2026-10-24T00:00:00.000Z",
        updated_at: "2026-10-24T00:00:00.000Z",
        native_session_id: null,
        busy: false,
      },
    ],
    sessionId: "s1" as string | null,
    newSession: vi.fn(async () => {}),
    selectSession: vi.fn(async () => {}),
  };

  it("高级默认折叠；对话助手仅在高级内，不在模型钥匙主视线", () => {
    renderSettings({ chatSession });
    const advanced = screen.getByTestId("settings-advanced");
    expect(advanced).not.toHaveAttribute("open");
    // details 折叠时节点仍在 DOM，但必须挂在高级内
    expect(
      advanced.querySelector('[data-testid="settings-chat-session"]'),
    ).not.toBeNull();
    expect(
      screen
        .getByTestId("settings-model-key")
        .querySelector('[data-testid="settings-chat-session"]'),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("settings-advanced-summary"));
    expect(screen.getByTestId("settings-chat-adapter")).toBeTruthy();
    expect(screen.getByTestId("settings-chat-new-session")).toHaveTextContent(
      "新会话",
    );
    expect(screen.getByLabelText("历史会话")).toBeTruthy();
    expect(screen.getByTestId("settings-advanced-summary")).toHaveTextContent(
      "对话助手",
    );
  });

  it("TASK-J.1：read_write 适配器在设置页被灰置，并显示白话原因", () => {
    renderSettings({
      chatSession: {
        ...chatSession,
        adapters: [
          ...chatSession.adapters,
          {
            id: "claude-code-worker",
            label: "Claude Code（施工）",
            available: true,
            control_mode: "GATEWAY_ENFORCED" as const,
            verified_on: "",
            tool_mode: "read_write" as const,
          },
        ],
      },
    });
    fireEvent.click(screen.getByTestId("settings-advanced-summary"));
    const blocked = screen.getByRole("option", {
      name: /会直接改你的文件/,
    });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveTextContent(
      "会直接改你的文件，右栏只允许只看不改的助手",
    );
    // 右栏默认仍落在只读助手上，不会滑向 read_write
    expect(screen.getByTestId("settings-chat-adapter")).toHaveValue(
      "claude-code",
    );
  });

  it("点新会话会调用注入的 newSession", () => {
    renderSettings({ chatSession });
    fireEvent.click(screen.getByTestId("settings-advanced-summary"));
    fireEvent.click(screen.getByTestId("settings-chat-new-session"));
    expect(chatSession.newSession).toHaveBeenCalled();
  });

  it("未注入 chatSession 时高级内不出现对话助手区", () => {
    renderSettings();
    fireEvent.click(screen.getByTestId("settings-advanced-summary"));
    expect(screen.queryByTestId("settings-chat-session")).toBeNull();
  });
});

describe("TASK-J.24 缺口 3：供应商选择器与模型钥匙保存", () => {
  it("T-J24-UI-001 生产模型钥匙面板允许选择供应商并透传 Base URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({
          api_key: "sk-custom-key-123456",
          model: "local-model",
          provider: "custom",
          base_url: "http://127.0.0.1:11434/v1",
        });
        return new Response(
          JSON.stringify({
            settings: {
              configured: true,
              model: "local-model",
              source: "runtime",
              provider: "custom",
              baseURL: "http://127.0.0.1:11434/v1",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
    const onSaved = vi.fn();
    render(<ModelKeyPanel conn={conn} settings={null} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("供应商"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://127.0.0.1:11434/v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("粘贴你的钥匙…"), {
      target: { value: "sk-custom-key-123456" },
    });
    fireEvent.change(screen.getByTestId("model-name"), {
      target: { value: "local-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/已就绪/);
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom",
        baseURL: "http://127.0.0.1:11434/v1",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it("T-J24-UI-002 自定义供应商未填写 Base URL 时不能保存", () => {
    render(<ModelKeyPanel conn={conn} settings={null} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText("供应商"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByPlaceholderText("粘贴你的钥匙…"), {
      target: { value: "sk-custom-key-123456" },
    });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
