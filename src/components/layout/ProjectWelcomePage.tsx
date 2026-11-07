import { OpenProjectEntry } from "./OpenProjectEntry";
import { WelcomePane } from "./WelcomePane";
import type { CommandWelcomeVariant } from "../../lib/command-surface";

/**
 * TASK-C.10e：Cursor 式欢迎页——打开/切换项目的主阵地。
 *
 * 最近项目一键重开 + 粘贴路径（保留 C.8c）；macOS 系统选夹（DS.1）与新建空项目
 * （DS.2）由 OpenProjectEntry 承接。本页完成 ≠ TASK-D.1e 全量桌面壳。
 * 指挥话术仍走 WelcomePane（C.9a），开项目区为整页展开，不再塞 IDE 左栏。
 */
export interface ProjectWelcomePageProps {
  repoName: string;
  repoPath: string;
  baseBranch: string;
  commandPhase?: "no_key" | "idle" | "in_progress" | undefined;
  welcomeVariant?: CommandWelcomeVariant | undefined;
  onNewRequirement?: (() => void) | undefined;
  onOpenSupervisor: () => void;
}

export function ProjectWelcomePage({
  repoName,
  repoPath,
  baseBranch,
  commandPhase = "idle",
  welcomeVariant = "speak_right",
  onNewRequirement,
  onOpenSupervisor,
}: ProjectWelcomePageProps) {
  return (
    <div
      data-testid="project-welcome-page"
      className="mx-auto flex h-full max-w-xl flex-col justify-center gap-6 p-8"
    >
      <WelcomePane
        repoName={repoName}
        baseBranch={baseBranch}
        onNewRequirement={
          welcomeVariant === "speak_right" ? onNewRequirement : undefined
        }
        onOpenSupervisor={onOpenSupervisor}
        welcomeVariant={welcomeVariant}
      />
      <OpenProjectEntry
        repoName={repoName}
        repoPath={repoPath}
        commandPhase={commandPhase}
        variant="page"
        defaultExpanded
      />
    </div>
  );
}
