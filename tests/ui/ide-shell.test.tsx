// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayout } from "../../src/components/WorkspaceLayout";

/**
 * 本轮（Cursor 式 IDE 骨架）新增交互的验收集。
 *
 * 覆盖的是"用户能不能真的操作"，不是外观：
 * - 左栏折叠 / 右栏折叠与复原；
 * - 左右面板拖拽调宽（含 min/max 夹取）；
 * - 左下角 Supervisor 图标 → 中央可关闭 Tab → 关掉再点能重新打开；
 * - 底栏 SmartTerminal 默认收起、可展开。
 *
 * jsdom 不跑真实排版与鼠标命中，因此这里**不能**替代浏览器里的视觉验收。
 */

const base = {
  repoName: "1018",
  repoPath: "/Users/tina/Desktop/1018",
  baseBranch: "main",
  runMode: "VIBE" as const,
  workerControl: "GATEWAY_ENFORCED" as const,
  files: [{ name: "src", path: "src" }],
};

/**
 * jsdom 没有 PointerEvent 构造器，`fireEvent.pointerDown(el, { clientX })` 落到
 * 普通 Event 上，clientX 会丢成 undefined（拖拽永远算出 0 位移，测试会假通过或假失败）。
 * 这里用 MouseEvent 冒充 pointer 事件，保证 clientX 真实带进监听器。
 */
function pointer(
  target: Element | Window,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX?: number,
) {
  fireEvent(
    target,
    new MouseEvent(type, {
      clientX: clientX ?? 0,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("Cursor 式 IDE 骨架：面板折叠与拖拽", () => {
  it("Activity Bar 常驻，且只放真实入口（无搜索/源码管理/扩展假图标）", () => {
    render(<WorkspaceLayout {...base} />);
    const bar = screen.getByTestId("activity-bar");
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId("activity-explorer")).toBeInTheDocument();
    expect(screen.getByTestId("activity-workbench")).toBeInTheDocument();
    expect(screen.getByTestId("activity-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-search")).toBeNull();
    expect(screen.queryByTestId("activity-scm")).toBeNull();
  });

  it("左栏可折叠再展开，文件树随之消失与回归", () => {
    render(<WorkspaceLayout {...base} />);
    expect(screen.getByTestId("left-column")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("activity-explorer"));
    expect(screen.queryByTestId("left-column")).toBeNull();
    expect(screen.queryByTestId("resizer-left")).toBeNull();
    fireEvent.click(screen.getByTestId("activity-explorer"));
    expect(screen.getByTestId("left-column")).toBeInTheDocument();
  });

  it("右栏 AI 对话可收起，收起后留竖向入口，点开复原", () => {
    render(<WorkspaceLayout {...base} rightPanel={<div>AI 内容</div>} />);
    expect(screen.getByTestId("right-column")).toBeInTheDocument();
    expect(screen.getByText("AI 内容")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("collapse-right"));
    expect(screen.queryByTestId("right-column")).toBeNull();
    fireEvent.click(screen.getByTestId("expand-right"));
    expect(screen.getByTestId("right-column")).toBeInTheDocument();
    expect(screen.getByText("AI 内容")).toBeInTheDocument();
  });

  it("拖左分隔条调宽，并把宽度夹在 min/max 区间内", () => {
    render(<WorkspaceLayout {...base} />);
    const resizer = screen.getByTestId("resizer-left");
    expect(screen.getByTestId("left-column")).toHaveStyle({ width: "260px" });
    expect(resizer).toHaveAttribute("role", "separator");
    expect(resizer).toHaveAttribute("aria-valuenow", "260");

    pointer(resizer, "pointerdown", 100);
    pointer(window, "pointermove", 180);
    pointer(window, "pointerup");
    expect(screen.getByTestId("left-column")).toHaveStyle({ width: "340px" });

    // 拖着不放一直往右 → 撞 max 560，不再增长
    pointer(resizer, "pointerdown", 100);
    pointer(window, "pointermove", 2000);
    pointer(window, "pointerup");
    expect(screen.getByTestId("left-column")).toHaveStyle({ width: "560px" });

    // 往左拖到越界 → 停在 min 180，不会压成 0 宽
    pointer(resizer, "pointerdown", 500);
    pointer(window, "pointermove", -500);
    pointer(window, "pointerup");
    expect(screen.getByTestId("left-column")).toHaveStyle({ width: "180px" });
  });

  it("拖右分隔条方向相反：向左拖变宽", () => {
    render(<WorkspaceLayout {...base} />);
    const resizer = screen.getByTestId("resizer-right");
    expect(screen.getByTestId("right-column")).toHaveStyle({ width: "340px" });
    pointer(resizer, "pointerdown", 400);
    pointer(window, "pointermove", 320);
    pointer(window, "pointerup");
    expect(screen.getByTestId("right-column")).toHaveStyle({ width: "420px" });
  });
});

describe("C.16：ActivityBar 单门合同操作台", () => {
  it("点工作台图标打开合同操作台并渲染注入内容", () => {
    render(
      <WorkspaceLayout
        {...base}
        studioContent={<div data-testid="studio-content">合同操作台</div>}
      />,
    );
    expect(screen.queryByTestId("studio-content")).toBeNull();
    fireEvent.click(screen.getByTestId("activity-workbench"));
    const tab = screen.getByRole("tab", { name: "方案工作台" });
    expect(tab).toHaveAttribute("data-system", "true");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("studio-pane")).toBeInTheDocument();
    expect(screen.getByTestId("studio-content")).toBeInTheDocument();
  });

  it("Tab 可关闭，关掉后再点图标能重新打开", () => {
    render(
      <WorkspaceLayout
        {...base}
        studioContent={<div data-testid="studio-content">合同操作台</div>}
      />,
    );
    fireEvent.click(screen.getByTestId("activity-workbench"));
    fireEvent.click(screen.getByTestId("close-tab-system:supervisor-studio"));
    expect(screen.queryByRole("tab", { name: "方案工作台" })).toBeNull();
    expect(screen.queryByTestId("studio-content")).toBeNull();
    fireEvent.click(screen.getByTestId("activity-workbench"));
    expect(screen.getByRole("tab", { name: "方案工作台" })).toBeInTheDocument();
    expect(screen.getByTestId("studio-content")).toBeInTheDocument();
  });

  it("项目全景仅经 openSupervisorRequest 打开，不占 ActivityBar 日常图标", () => {
    const { rerender } = render(
      <WorkspaceLayout
        {...base}
        defaultOpenStudio
        studioContent={<div data-testid="studio-content">合同操作台</div>}
        supervisorContent={<div data-testid="supervisor-content">全景页</div>}
      />,
    );
    expect(screen.getByTestId("studio-content")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-supervisor")).toBeNull();
    expect(screen.queryByTestId("activity-graph")).toBeNull();
    rerender(
      <WorkspaceLayout
        {...base}
        defaultOpenStudio
        openSupervisorRequest={1}
        studioContent={<div data-testid="studio-content">合同操作台</div>}
        supervisorContent={<div data-testid="supervisor-content">全景页</div>}
      />,
    );
    expect(screen.getByTestId("supervisor-content")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "项目全景" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("页内 openStudioRequest 能把中央切到合同操作台", () => {
    const { rerender } = render(
      <WorkspaceLayout
        {...base}
        studioContent={<div data-testid="studio-content">合同操作台</div>}
      />,
    );
    expect(screen.queryByTestId("studio-content")).toBeNull();
    rerender(
      <WorkspaceLayout
        {...base}
        openStudioRequest={1}
        studioContent={<div data-testid="studio-content">合同操作台</div>}
      />,
    );
    expect(screen.getByTestId("studio-content")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "方案工作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("设置入口：Activity Bar 齿轮", () => {
  it("齿轮在底部、紧挨 Supervisor，点开中央设置 Tab 且可关闭", () => {
    render(
      <WorkspaceLayout
        {...base}
        settingsContent={<div data-testid="settings-content">设置内容</div>}
      />,
    );
    const bar = screen.getByTestId("activity-bar");
    const labels = Array.from(
      bar.querySelectorAll("[data-testid^='activity-']"),
    ).map((el) => el.getAttribute("data-testid"));
    // C.16：资源管理器 + 单门合同操作台；发布入口在操作台之后；设置与验证输出在底部
    expect(labels).toEqual([
      "activity-explorer",
      "activity-workbench",
      "activity-release",
      "activity-settings",
      "activity-terminal",
    ]);

    fireEvent.click(screen.getByTestId("activity-settings"));
    expect(screen.getByTestId("settings-content")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "设置" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByTestId("close-tab-system:settings"));
    expect(screen.queryByTestId("settings-content")).toBeNull();
  });
});

describe("验证输出：底栏抽屉", () => {
  it("默认收起，展开后才占高度并渲染命令输出", () => {
    render(<WorkspaceLayout {...base} terminalPanel={<div>exit 0</div>} />);
    const drawer = screen.getByTestId("terminal-drawer");
    expect(drawer).toHaveAttribute("data-state", "closed");
    expect(screen.queryByTestId("terminal-drawer-body")).toBeNull();
    fireEvent.click(screen.getByTestId("terminal-drawer-toggle"));
    expect(drawer).toHaveAttribute("data-state", "open");
    expect(screen.getByTestId("terminal-drawer-body")).toHaveTextContent(
      "exit 0",
    );
  });

  it("Activity Bar 的终端图标与抽屉开关是同一个状态", () => {
    render(<WorkspaceLayout {...base} />);
    const icon = screen.getByTestId("activity-terminal");
    expect(icon).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(icon);
    expect(icon).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("terminal-drawer")).toHaveAttribute(
      "data-state",
      "open",
    );
  });
});

describe("TASK-C.10c / C.16：白话命名与单门", () => {
  it("ActivityBar / Tab / 底栏用白话名，不含 Supervisor Studio / SmartTerminal", () => {
    render(
      <WorkspaceLayout
        {...base}
        defaultOpenStudio
        studioContent={<div data-testid="studio-content">台</div>}
        terminalPanel={<div>exit 0</div>}
      />,
    );
    expect(screen.getByRole("tab", { name: "方案工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Supervisor Studio" })).toBeNull();
    expect(screen.getByTestId("activity-workbench")).toHaveAttribute(
      "aria-label",
      "方案工作台",
    );
    expect(screen.queryByTestId("activity-supervisor")).toBeNull();
    expect(screen.queryByTestId("activity-graph")).toBeNull();
    expect(screen.getByTestId("activity-terminal")).toHaveAttribute(
      "aria-label",
      "验证输出",
    );
    expect(screen.getByTestId("terminal-drawer")).toHaveTextContent("验证输出");
  });

  it("单门打开方案工作台，不新建独立任务图谱 Tab", () => {
    render(
      <WorkspaceLayout
        {...base}
        studioContent={<div data-testid="studio-content">台</div>}
        graphContent={<div data-testid="graph-legacy">旧图谱页</div>}
      />,
    );
    fireEvent.click(screen.getByTestId("activity-workbench"));
    expect(screen.getByRole("tab", { name: "方案工作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("tab", { name: "任务图谱" })).toBeNull();
    expect(screen.queryByTestId("graph-legacy")).toBeNull();
    expect(screen.getByTestId("studio-content")).toBeInTheDocument();
    expect(screen.getByTestId("activity-workbench")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
