import { Files, Rocket, Settings, Sparkles, TerminalSquare } from "lucide-react";
import { WORKBENCH_LABEL } from "../../lib/workbench-labels";

/**
 * Activity Bar（Cursor / VS Code 式左窄条）。
 *
 * TASK-C.10c：title / aria-label 只用白话。
 * TASK-C.16：日常只挂**一个**工作台入口「方案工作台」（列表+操作台），
 * 不再并列「项目审阅」与「任务图谱」两套门；图谱是操作台内视口。
 */
export interface ActivityBarProps {
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  /** C.16：单门——打开/聚焦方案工作台 */
  workbenchOpen: boolean;
  onOpenWorkbench: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  releaseOpen?: boolean;
  onOpenRelease?: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}

function BarButton({
  label,
  testId,
  active,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function ActivityBar({
  explorerOpen,
  onToggleExplorer,
  workbenchOpen,
  onOpenWorkbench,
  settingsOpen,
  onOpenSettings,
  releaseOpen = false,
  onOpenRelease,
  terminalOpen,
  onToggleTerminal,
}: ActivityBarProps) {
  return (
    <nav
      data-testid="activity-bar"
      aria-label="活动栏"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted/30 py-2"
    >
      <BarButton
        label={WORKBENCH_LABEL.explorer}
        testId="activity-explorer"
        active={explorerOpen}
        onClick={onToggleExplorer}
      >
        <Files className="h-5 w-5" />
      </BarButton>
      <BarButton
        label={WORKBENCH_LABEL.workbench}
        testId="activity-workbench"
        active={workbenchOpen}
        onClick={onOpenWorkbench}
      >
        <Sparkles className="h-5 w-5" />
      </BarButton>
      <div className="mt-auto flex flex-col items-center gap-1">
        {onOpenRelease ? (
          <BarButton
            label={WORKBENCH_LABEL.release}
            testId="activity-release"
            active={releaseOpen}
            onClick={onOpenRelease}
          >
            <Rocket className="h-5 w-5" />
          </BarButton>
        ) : null}
        <BarButton
          label={WORKBENCH_LABEL.settings}
          testId="activity-settings"
          active={settingsOpen}
          onClick={onOpenSettings}
        >
          <Settings className="h-5 w-5" />
        </BarButton>
        <BarButton
          label={WORKBENCH_LABEL.terminal}
          testId="activity-terminal"
          active={terminalOpen}
          onClick={onToggleTerminal}
        >
          <TerminalSquare className="h-5 w-5" />
        </BarButton>
      </div>
    </nav>
  );
}
