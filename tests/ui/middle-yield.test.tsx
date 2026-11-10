/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubOfflineFetch } from "../../src/tests/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";
import { SettingsTab } from "../../src/components/settings/SettingsTab";
import { resolveCommandSurface } from "../../src/lib/command-surface";

const base = {
  repoName: "1020",
  repoPath: "/Users/tina/Desktop/1020",
  baseBranch: "main",
  runMode: "VIBE" as const,
  files: [] as { name: string; path: string }[],
};

beforeEach(() => {
  // TASK-CI.3：本文件发出的未桩接口，以离线失败应答（与哨兵行为一致）
  stubOfflineFetch(["/api/vault", "/api/workers"]);
});

describe("TASK-C.9d 中栏让路 / 设置回跳", () => {
  it("C.10a：纯 journey-active 无三步台时不渲染空让路壳（回欢迎/主路径）", () => {
    const surface = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: true,
      inProgressCta: "journey-active",
    });
    render(<WorkspaceLayout {...base} commandSurface={surface} />);
    expect(screen.queryByTestId("middle-yield")).toBeNull();
    // 欢迎区可能是 welcome-pane 或 welcome-surface
    expect(
      screen.queryByTestId("welcome-pane") ??
        screen.getByTestId("welcome-surface"),
    ).toBeTruthy();
  });

  it("三步台 CTA：自动打开 Studio", async () => {
    const surface = resolveCommandSurface({
      hasSession: true,
      keyReady: true,
      inProgress: true,
      inProgressCta: "boss-fastpath-confirm",
    });
    render(<WorkspaceLayout {...base} commandSurface={surface} />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "方案工作台" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getByTestId("studio-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("welcome-pane")).toBeNull();
  });

  it("PROTECTED 可见聊改分离白话", () => {
    render(<WorkspaceLayout {...base} runMode="PROTECTED" />);
    expect(screen.getByTestId("chat-vs-edit-plain")).toHaveTextContent("聊");
    expect(screen.getByTestId("chat-vs-edit-plain").textContent).not.toMatch(
      /PROTECTED/,
    );
  });

  it("设置深链回跳：返回对话按钮可点", () => {
    const onReturn = vi.fn();
    render(
      <SettingsTab
        conn={{ baseUrl: "http://127.0.0.1:3001", token: "t" }}
        onConnChange={() => {}}
        connected
        daemonPort={3001}
        repoPath="/r"
        baseBranch="main"
        runMode="VIBE"
        protectedCount={0}
        workerControl="GATEWAY_ENFORCED"
        streamStatus="connected"
        focusSection="model-key"
        onReturnToChat={onReturn}
        modelKeySlot={<div data-testid="settings-model-key-slot">key</div>}
      />,
    );
    expect(screen.getByTestId("settings-model-key")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-return-to-chat"));
    expect(onReturn).toHaveBeenCalled();
  });

  it("closeSettingsRequest 关闭设置并露出右栏", async () => {
    const { rerender } = render(
      <WorkspaceLayout
        {...base}
        openSettingsRequest={1}
        settingsContent={<div data-testid="fake-settings">S</div>}
        rightPanel={<div data-testid="fake-chat">C</div>}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("settings-pane")).toBeInTheDocument();
    });
    rerender(
      <WorkspaceLayout
        {...base}
        openSettingsRequest={1}
        closeSettingsRequest={1}
        settingsContent={<div data-testid="fake-settings">S</div>}
        rightPanel={<div data-testid="fake-chat">C</div>}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("settings-pane")).toBeNull();
    });
    expect(screen.getByTestId("fake-chat")).toBeInTheDocument();
  });
});
