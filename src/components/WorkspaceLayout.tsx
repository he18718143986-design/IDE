import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { FileTree } from "./FileTree";
import { SplitPaneContainer } from "./SplitPaneContainer";
import { CollapsibleSection } from "./layout/CollapsibleSection";
import { ActivityBar } from "./layout/ActivityBar";
import { ProjectWelcomePage } from "./layout/ProjectWelcomePage";
import { useResizablePanel } from "./layout/useResizablePanel";
import {
  EXECUTION_STATUS_LABEL,
  type ActiveContract,
  type FileNode,
  type RunMode,
} from "./workspace-types";
import type { CommandSurface } from "../lib/command-surface";
import {
  CHAT_VS_EDIT_PLAIN,
  shouldAutoOpenStudioForProgress,
  type SettingsDeepFocus,
} from "../lib/middle-yield";
import { shouldRenderMiddleYieldShell } from "../lib/in-progress-lifecycle";
import type { InProgressCta } from "../lib/command-surface";
import { WORKBENCH_LABEL } from "../lib/workbench-labels";
import {
  resolveLeftShowsOpenProject,
  resolveLeftShowsSpecs,
} from "../lib/left-panel-boss";

export const STUDIO_TAB_ID = "system:supervisor-studio";
/** Supervisor 审阅 Tab（左下角图标入口打开；中央阅读区，可关闭） */
export const SUPERVISOR_TAB_ID = "system:supervisor";
/** 设置 Tab（⚙️ 图标入口；连接/诊断/开关全在这一页） */
export const SETTINGS_TAB_ID = "system:settings";
export const RELEASE_TAB_ID = "system:release";
/** @deprecated C.10c：独立图谱 Tab 不再作为日常主路径；保留 id 仅兼容旧会话/测试。日常入口改开合同操作台内视口。 */
export const GRAPH_TAB_ID = "system:task-graph";

interface Tab {
  id: string;
  title: string;
  system?: boolean;
  closable?: boolean;
}

/** 普通文件标签：默认可关闭（系统 Tab 须显式 closable） */
function fileTab(path: string): Tab {
  return {
    id: path,
    title: path.split("/").pop() ?? path,
    closable: true,
  };
}

export interface WorkspaceLayoutProps {
  repoName: string;
  repoPath: string;
  baseBranch: string;
  runMode: RunMode;
  contract?: ActiveContract | null | undefined;
  files: FileNode[];
  /** C.10f 热修：文件树加载中 */
  filesLoading?: boolean | undefined;
  /** C.10h：文件树确认后删除（父级调 API + 刷新树） */
  onDeletePath?: ((path: string) => void | Promise<void>) | undefined;
  /** C.10i：新建文件/文件夹 */
  onCreatePath?:
    | ((args: {
        parent: string;
        name: string;
        kind: "file" | "dir";
      }) => void | Promise<string | void>)
    | undefined;
  /** C.10i：重命名 */
  onRenamePath?:
    ((args: { from: string; to: string }) => void | Promise<void>) | undefined;
  /** C.10i：在 Finder / 文件管理器显示 */
  onRevealPath?: ((path: string) => void | Promise<void>) | undefined;
  /** 以下为接入主页面用的插槽，均可选 */
  banner?: ReactNode;
  /**
   * @deprecated C.10f 漏接线修复：勿再往左栏塞合同列表等。
   * 需求列表请挂 SupervisorTab.requirementList；布局不再渲染此插槽。
   */
  leftExtra?: ReactNode;
  studioContent?: ReactNode;
  /** Supervisor Tab 内容（由主页面注入，数据全部来自合同/保护清单） */
  supervisorContent?: ReactNode;
  /** 设置 Tab 内容（由主页面注入，连接与模型 Key 面板在那里） */
  settingsContent?: ReactNode;
  releaseContent?: ReactNode;
  /** @deprecated C.10c 独立图谱 Tab；日常请用 studio 内图谱视口 */
  graphContent?: ReactNode;
  /**
   * C.10c：左栏图谱入口 → 打开合同操作台并切到图谱视口（由主页面设 viewport）。
   */
  onOpenStudioGraph?: (() => void) | undefined;
  /** C.10c：合同操作台当前是否停在图谱视口（点亮 ActivityBar 图谱图标） */
  studioGraphActive?: boolean | undefined;
  /**
   * @deprecated C.10f：规范与资产已迁入合同操作台左侧栏（C.16）；布局左栏不再渲染此插槽。
   * 保留 prop 仅兼容旧调用方；请改传到 SupervisorTab.specsSection。
   */
  specsSection?: ReactNode;
  /** 右栏：AI 对话（主要需求沟通入口） */
  rightPanel?: ReactNode;
  /** 底栏验证输出抽屉内容（原 SmartTerminal） */
  terminalPanel?: ReactNode;
  footer?: ReactNode;
  /** 首屏欢迎区；不传则用内置极简版（仍然只有真实入口） */
  welcome?: ReactNode;
  /** 顶栏右侧唯一操作点：新建需求 */
  onNewRequirement?: (() => void) | undefined;
  /** 渲染某个文件的编辑器（C.3）；缺省为占位 */
  renderFile?: (path: string, boundToWorktree: boolean) => ReactNode;
  /** 外部请求打开文件（例如 Agent 刚改了它）；nonce 变化即触发 */
  openRequest?: { path: string; nonce: number } | null;
  /**
   * 外部请求切到合同操作台标签；nonce 变化即触发。
   * 供 Supervisor Tab 里的「打开合同操作台」使用——Tab 由布局自己持有，
   * 页面无法直接 setActiveTab，所以用信号替代共享状态。
   */
  openStudioRequest?: number;
  /**
   * C.16：操作台左侧栏「项目全景」——打开原 Supervisor 深页（架构/准入），
   * 不再挂 ActivityBar 日常图标。nonce 变化即触发。
   */
  openSupervisorRequest?: number;
  /**
   * 外部请求切到设置 Tab（TASK-C.8a：右栏「去配置模型钥匙」）；
   * nonce 变化即触发，与 openStudioRequest 同模式。
   */
  openSettingsRequest?: number;
  /**
   * C.9d：从 Key 向导打开设置时深链到模型钥匙区。
   * 与 openSettingsRequest 同次递增时生效。
   */
  settingsDeepFocus?: SettingsDeepFocus | null | undefined;
  /**
   * C.9d：外部请求关闭设置 Tab（配完钥匙一键回跳）。
   */
  closeSettingsRequest?: number | undefined;
  /** 中栏顶部横幅（Evidence STALE 等） */
  middleBanner?: ReactNode;
  /**
   * 中栏顶部的白话确认卡插槽（C.2）。
   * 放在 Tab 栏之上、不遮挡代码：切换文件时确认卡仍可见，不会"关掉标签就丢了问题"。
   */
  confirmSlot?: ReactNode;
  /** 顶栏「已锁 N 处」（C.2） */
  protectedCount?: number | undefined;
  /**
   * 首次打开即显示合同操作台。
   * **页面已不再传它**：首屏必须是空编辑区/欢迎页，Studio 由用户点合同或点模式徽标才开。
   * 保留这个 prop 只为显式 opt-in 的测试与并行对照场景。
   */
  defaultOpenStudio?: boolean;
  /**
   * TASK-C.9a：首屏单一指挥面。不传则按 idle（右侧说需求）降噪呈现。
   */
  commandSurface?: CommandSurface | undefined;
}

/**
 * Cursor / VS Code 式 IDE 骨架：
 *
 *   顶栏（项目 / 分支 / 模式 + 一个「新建需求」）
 *   ├ Activity Bar │ 文件树（可折叠 / 可拖宽） │ 代码标签页（中） │ AI 对话（可折叠 / 可拖宽）
 *   └ 底栏：抽屉式验证输出（可收起）
 *
 * 四条边界（本轮）：
 * 1. 对话在**右侧**，是主要需求沟通入口；不搬去左栏；
 * 2. 顶栏只留状态胶囊，连接/Token/流诊断/网关受控全部下沉到 ⚙️ 设置 Tab；
 * 3. 首屏是**空编辑区**，Supervisor / 设置只在用户主动点击时开成可关闭 Tab；
 * 4. D4：无中心 Hub、无顶部 HUD、无成熟度气泡（本文件零相关实现）；
 * 5. C.9a：同一时刻只留一个主指挥信号（commandSurface），欢迎/打开面板/模式徽标降噪；
 * 6. C.10e：打开/切换项目在欢迎页（Cursor 式），不在 IDE 左栏；顶栏可「切换项目」回欢迎页。
 * 7. C.10f：资源管理器只展示纯文件树；规范与资产不进文件树。
 * 10. C.16：ActivityBar 单门「合同操作台」；项目全景为操作台内次入口。
 * 8. C.10h：文件树右键删除（确认 + P.1 门禁；尽量废纸篓）。
 * 9. C.10f 热修：去掉资源管理器顶栏冗余「文件」标题，只留路径根 + 树。
 */
export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const { contract } = props;
  const bound = !!contract?.approved;
  // 用户手动切回主工作树的标记（仅在有已批准合同时有意义）
  const [onMainTree, setOnMainTree] = useState(false);
  const useWorktree = bound && !onMainTree;
  const root = useWorktree ? contract!.worktreePath : props.repoPath;

  const [tabs, setTabs] = useState<Tab[]>(() =>
    props.defaultOpenStudio
      ? [
          {
            id: STUDIO_TAB_ID,
            title: WORKBENCH_LABEL.studio,
            system: true,
            closable: true,
          },
        ]
      : [],
  );
  const [activeTab, setActiveTab] = useState<string | null>(() =>
    props.defaultOpenStudio ? STUDIO_TAB_ID : null,
  );
  const [split, setSplit] = useState(false);
  // 面板折叠状态（默认：左开、右开、终端收起）
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  /** C.10e：顶栏「切换项目」强制回到欢迎页（开项目主阵地） */
  const [forceProjectWelcome, setForceProjectWelcome] = useState(false);
  const left = useResizablePanel({ initial: 260, side: "left" });
  const right = useResizablePanel({ initial: 340, side: "right", min: 280 });

  const openTab = (tab: Tab) => {
    setForceProjectWelcome(false);
    setTabs((t) => (t.some((x) => x.id === tab.id) ? t : [...t, tab]));
    setActiveTab(tab.id);
  };
  const closeTab = (id: string) => {
    setTabs((t) => {
      const next = t.filter((x) => x.id !== id);
      setActiveTab((cur) => (cur === id ? (next.at(-1)?.id ?? null) : cur));
      return next;
    });
  };

  const req = props.openRequest;
  useEffect(() => {
    if (!req) return;
    const p = req.path;
    setTabs((t) => (t.some((x) => x.id === p) ? t : [...t, fileTab(p)]));
    setForceProjectWelcome(false);
    setActiveTab(p);
  }, [req?.path, req?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const openStudio = () =>
    openTab({
      id: STUDIO_TAB_ID,
      title: WORKBENCH_LABEL.studio,
      system: true,
      closable: true,
    });

  const studioReq = props.openStudioRequest;
  useEffect(() => {
    if (!studioReq) return;
    openStudio();
    // openStudio 每次渲染都是新函数，只在外部信号变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioReq]);

  /** 左下角 Supervisor 图标：未打开则打开，已打开则聚焦（不做 toggle 关闭，避免误触丢状态） */
  const focusSupervisor = () => {
    setForceProjectWelcome(false);
    setTabs((t) =>
      t.some((x) => x.id === SUPERVISOR_TAB_ID)
        ? t
        : [
            ...t,
            {
              id: SUPERVISOR_TAB_ID,
              title: WORKBENCH_LABEL.supervisor,
              system: true,
              closable: true,
            },
          ],
    );
    setActiveTab(SUPERVISOR_TAB_ID);
  };

  const supervisorReq = props.openSupervisorRequest;
  useEffect(() => {
    if (!supervisorReq) return;
    focusSupervisor();
  }, [supervisorReq]);
  /**
   * C.10c/C.16：图谱入口已并入合同操作台单门；ActivityBar 不再单独挂图谱图标。
   * `onOpenStudioGraph` / `studioGraphActive` 保留给程序化切视口（测试/深链），日常 UI 不走。
   */
  void props.onOpenStudioGraph;
  void props.studioGraphActive;
  /** 左下角齿轮：打开设置 Tab（同样不做 toggle，避免误触关掉正在填的表单） */
  const openSettings = () => {
    setForceProjectWelcome(false);
    setTabs((t) =>
      t.some((x) => x.id === SETTINGS_TAB_ID)
        ? t
        : [
            ...t,
            {
              id: SETTINGS_TAB_ID,
              title: "设置",
              system: true,
              closable: true,
            },
          ],
    );
    setActiveTab(SETTINGS_TAB_ID);
  };

  const openRelease = () => {
    setTabs((t) =>
      t.some((x) => x.id === RELEASE_TAB_ID)
        ? t
        : [
            ...t,
            {
              id: RELEASE_TAB_ID,
              title: "发布",
              system: true,
            },
          ],
    );
    setActiveTab(RELEASE_TAB_ID);
  };

  const settingsReq = props.openSettingsRequest;
  useEffect(() => {
    if (!settingsReq) return;
    openSettings();
  }, [settingsReq]);

  const closeSettingsReq = props.closeSettingsRequest;
  useEffect(() => {
    if (!closeSettingsReq) return;
    setTabs((t) => {
      const next = t.filter((x) => x.id !== SETTINGS_TAB_ID);
      setActiveTab((cur) =>
        cur === SETTINGS_TAB_ID ? (next.at(-1)?.id ?? null) : cur,
      );
      return next;
    });
    setRightOpen(true);
  }, [closeSettingsReq]);

  // C.9d + C.10a：三步台/保护确认进行中 → 保持 Studio 打开（关了也会再开，避免空让路壳）
  const progressCta = props.commandSurface?.primaryCtaTestId;
  const progressPhase = props.commandSurface?.phase;
  const progressCtaTyped: InProgressCta | undefined =
    progressCta === "boss-fastpath-confirm" ||
    progressCta === "protection-confirm-approve" ||
    progressCta === "journey-active"
      ? progressCta
      : undefined;
  useEffect(() => {
    if (progressPhase !== "in_progress") return;
    if (!shouldAutoOpenStudioForProgress(progressCtaTyped)) return;
    openStudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 相位/CTA/关台后仍要接到三步台
  }, [progressPhase, progressCtaTyped, activeTab]);

  const studio = (
    <div
      data-testid="studio-pane"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-sm"
    >
      {props.studioContent ?? (
        <div className="p-3">
          {WORKBENCH_LABEL.studio}（方案审阅区，TASK-C.18）
        </div>
      )}
    </div>
  );
  const supervisor = (
    <div
      data-testid="supervisor-pane"
      className="h-full min-h-0 flex-1 overflow-auto"
    >
      {props.supervisorContent ?? (
        <div className="p-3 text-sm opacity-60">
          {WORKBENCH_LABEL.supervisor}需要主页面注入合同与保护清单数据。
        </div>
      )}
    </div>
  );
  const settings = (
    <div
      data-testid="settings-pane"
      data-deep-focus={props.settingsDeepFocus ?? undefined}
      className="h-full min-h-0 flex-1 overflow-auto"
    >
      {props.settingsContent ?? (
        <div className="p-3 text-sm opacity-60">
          设置页需要主页面注入连接与模型 Key 面板。
        </div>
      )}
    </div>
  );

  const release = (
    <div
      data-testid="release-pane-host"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      {props.releaseContent ?? (
        <div className="p-4 text-sm text-muted-foreground">
          发布页未接线。
        </div>
      )}
    </div>
  );
  const graphPane = (
    <div
      data-testid="graph-pane"
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      {props.graphContent ?? (
        <div className="p-3 text-sm opacity-60">
          任务图谱需要主页面注入权威快照（TASK-C.7）。
        </div>
      )}
    </div>
  );
  const surface = props.commandSurface;
  const welcomeVariant = surface?.welcomeVariant ?? "speak_right";
  const switchToProjectWelcome = () => {
    setForceProjectWelcome(true);
    setActiveTab(null);
    setSplit(false);
  };
  const welcome = (
    <div data-testid="welcome-surface" className="h-full overflow-auto">
      {props.welcome ?? (
        <ProjectWelcomePage
          repoName={props.repoName}
          repoPath={props.repoPath}
          baseBranch={props.baseBranch}
          commandPhase={surface?.phase}
          welcomeVariant={welcomeVariant}
          onNewRequirement={
            welcomeVariant === "speak_right"
              ? props.onNewRequirement
              : undefined
          }
          onOpenSupervisor={focusSupervisor}
        />
      )}
    </div>
  );
  const editorFor = (id: string | null) =>
    id &&
    id !== STUDIO_TAB_ID &&
    id !== SUPERVISOR_TAB_ID &&
    id !== SETTINGS_TAB_ID &&
    id !== RELEASE_TAB_ID &&
    id !== GRAPH_TAB_ID ? (
      props.renderFile ? (
        props.renderFile(id, useWorktree)
      ) : (
        <div data-testid="editor-placeholder" className="p-3 text-sm">
          {id}（代码编辑器占位，TASK-C.3 接入 Monaco）
        </div>
      )
    ) : (
      <div className="p-3 text-sm opacity-60">从左侧打开文件</div>
    );

  const isStudio = activeTab === STUDIO_TAB_ID;
  const isSupervisor = activeTab === SUPERVISOR_TAB_ID;
  const isSettings = activeTab === SETTINGS_TAB_ID;
  const isRelease = activeTab === RELEASE_TAB_ID;
  const isGraph = activeTab === GRAPH_TAB_ID;
  /** 没有打开任何标签，或顶栏强制切回欢迎页（C.10e） */
  const showWelcome =
    forceProjectWelcome || tabs.length === 0 || activeTab === null;
  const lastFile = [...tabs].reverse().find((t) => !t.system)?.id ?? null;

  return (
    <div
      data-testid="workspace-layout"
      data-command-phase={surface?.phase ?? "idle"}
      data-primary-cta={surface?.primaryCtaTestId ?? "journey-entry-hint"}
      className="flex h-screen flex-col"
    >
      <div
        data-testid="command-surface"
        data-phase={surface?.phase ?? "idle"}
        data-primary-cta={surface?.primaryCtaTestId ?? "journey-entry-hint"}
        hidden
      />
      <WorkspaceHeader
        repoName={props.repoName}
        baseBranch={props.baseBranch}
        runMode={props.runMode}
        protectedCount={props.protectedCount ?? 0}
        onOpenStudio={openStudio}
        onNewRequirement={
          surface?.phase === "in_progress" ? undefined : props.onNewRequirement
        }
        onSwitchProject={switchToProjectWelcome}
        quietBadge={surface?.quietHeaderBadge ?? true}
      />
      {props.banner}
      {bound && onMainTree && (
        <div
          data-testid="main-tree-warning"
          role="alert"
          className="bg-yellow-50 px-3 py-1 text-sm text-yellow-900"
        >
          你正在查看主工作树，合同 {contract!.contractId} 的改动在 Worktree 里（
          {EXECUTION_STATUS_LABEL[contract!.status]}）。
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setOnMainTree(false)}
          >
            回到 Worktree
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          explorerOpen={leftOpen}
          onToggleExplorer={() => setLeftOpen((v) => !v)}
          workbenchOpen={isStudio}
          onOpenWorkbench={openStudio}
          settingsOpen={isSettings}
          onOpenSettings={openSettings}
          releaseOpen={activeTab === RELEASE_TAB_ID}
          onOpenRelease={openRelease}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
        />

        {leftOpen ? (
          <>
            <aside
              data-testid="left-column"
              style={{ width: left.width }}
              className="flex shrink-0 flex-col border-r"
            >
              {bound && !onMainTree && (
                <button
                  type="button"
                  data-testid="switch-main-tree"
                  className="m-2 self-start text-xs underline"
                  onClick={() => setOnMainTree(true)}
                >
                  切换到主工作树
                </button>
              )}
              <div
                data-testid="workspace-binding"
                data-bound={useWorktree ? "worktree" : "main"}
                hidden
              />
              {/* C.10e：开项目不在左栏；C.10f：规范不在左栏，只留纯文件树 */}
              {resolveLeftShowsOpenProject() ? null : null}
              {resolveLeftShowsSpecs() && props.specsSection
                ? props.specsSection
                : null}
              <div
                data-testid="left-explorer"
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="min-h-0 flex-1 overflow-auto">
                  <FileTree
                    nodes={props.files}
                    rootLabel={root}
                    loading={props.filesLoading}
                    onOpen={(p) => openTab(fileTab(p))}
                    onDelete={
                      props.onDeletePath
                        ? async (p) => {
                            await props.onDeletePath!(p);
                            closeTab(p);
                          }
                        : undefined
                    }
                    onCreate={props.onCreatePath}
                    onRename={
                      props.onRenamePath
                        ? async ({ from, to }) => {
                            await props.onRenamePath!({ from, to });
                            closeTab(from);
                            openTab(fileTab(to));
                          }
                        : undefined
                    }
                    onReveal={props.onRevealPath}
                  />
                  {/* C.10f：leftExtra 不再渲染——合同/需求列表已迁合同操作台左侧栏 */}
                </div>
              </div>
            </aside>
            <div
              data-testid="resizer-left"
              {...left.resizerProps}
              className={`w-1 shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 ${
                left.dragging ? "bg-primary/60" : ""
              }`}
            />
          </>
        ) : null}

        <main
          data-testid="middle-column"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {props.middleBanner}
          {props.confirmSlot}
          {props.runMode === "PROTECTED" ? (
            <p
              data-testid="chat-vs-edit-plain"
              className="border-b border-border/60 bg-muted/20 px-3 py-1 text-[11px] leading-relaxed text-muted-foreground"
            >
              {CHAT_VS_EDIT_PLAIN}
            </p>
          ) : null}
          <div role="tablist" className="flex gap-1 border-b px-2 text-sm">
            {tabs.map((t) => (
              <span key={t.id} className="flex items-center">
                <button
                  role="tab"
                  aria-selected={t.id === activeTab}
                  data-system={t.system ? "true" : undefined}
                  onClick={() => setActiveTab(t.id)}
                  className={t.id === activeTab ? "font-medium" : "opacity-70"}
                >
                  {t.title}
                </button>
                {(t.closable ?? !t.system) ? (
                  <button
                    type="button"
                    data-testid={`close-tab-${t.id}`}
                    aria-label={`关闭 ${t.title}`}
                    title={`关闭 ${t.title}`}
                    onClick={() => closeTab(t.id)}
                    className="ml-1 rounded px-1 text-xs opacity-50 hover:bg-accent hover:opacity-100"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            <button
              type="button"
              data-testid="toggle-split"
              className="ml-auto"
              onClick={() => {
                setSplit((s) => !s);
                openStudio();
                if (lastFile) setActiveTab(lastFile);
              }}
            >
              {split ? "取消分屏" : "分屏对照"}
            </button>
          </div>
          <div
            data-testid="middle-content"
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {showWelcome ? (
              shouldRenderMiddleYieldShell({
                phase: surface?.phase,
                cta: progressCtaTyped,
              }) ? (
                <div
                  data-testid="middle-yield"
                  data-command-phase="in_progress"
                  className="mx-auto flex h-full max-w-xl flex-col justify-center gap-3 p-8 text-sm leading-relaxed"
                >
                  <p className="font-medium">进行中：中栏已让路</p>
                  <p className="text-xs opacity-80">
                    请看上方确认卡、中间三步台，或右侧对话。欢迎页不再占主视线。
                  </p>
                </div>
              ) : (
                welcome
              )
            ) : split ? (
              <SplitPaneContainer left={editorFor(lastFile)} right={studio} />
            ) : isStudio ? (
              studio
            ) : isSupervisor ? (
              supervisor
            ) : isSettings ? (
              settings
            ) : isRelease ? (
              release
            ) : isGraph ? (
              graphPane
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                {editorFor(activeTab)}
              </div>
            )}
          </div>
        </main>

        {rightOpen ? (
          <>
            <div
              data-testid="resizer-right"
              {...right.resizerProps}
              className={`w-1 shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 ${
                right.dragging ? "bg-primary/60" : ""
              }`}
            />
            <aside
              data-testid="right-column"
              style={{ width: right.width }}
              className="flex shrink-0 flex-col border-l"
            >
              <header className="flex items-center gap-2 border-b px-2 py-1 text-xs">
                <span className="font-semibold">AI 对话</span>
                <button
                  type="button"
                  data-testid="collapse-right"
                  aria-label="收起 AI 对话"
                  onClick={() => setRightOpen(false)}
                  className="ml-auto rounded border px-1.5 py-0.5 hover:bg-accent"
                >
                  收起
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto">
                {props.rightPanel ?? "Coding Agent 对话（TASK-C.6 实装）"}
              </div>
            </aside>
          </>
        ) : (
          <button
            type="button"
            data-testid="expand-right"
            aria-label="展开 AI 对话"
            title="展开 AI 对话"
            onClick={() => setRightOpen(true)}
            className="w-8 shrink-0 border-l text-xs text-muted-foreground hover:bg-accent"
          >
            AI
          </button>
        )}
      </div>

      {/* 底栏：验证输出抽屉，默认收起，只有要看退出码时才占高度 */}
      <CollapsibleSection
        testId="terminal-drawer"
        title={WORKBENCH_LABEL.terminal}
        open={terminalOpen}
        onToggle={() => setTerminalOpen((v) => !v)}
        summary="验证命令原始输出（点开看退出码）"
        toggleLabel={{ open: "收起输出", closed: "展开输出" }}
        className="max-h-64 shrink-0 border-t"
      >
        <div data-testid="terminal-drawer-body" className="h-56 overflow-auto">
          {props.terminalPanel ?? (
            <p className="p-3 text-xs leading-relaxed opacity-60">
              这里回放本轮验证命令的原始输出（先脱敏后截断）。失败时先看退出码，
              再看证据。
            </p>
          )}
        </div>
      </CollapsibleSection>
      {props.footer}
    </div>
  );
}
