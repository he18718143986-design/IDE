import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import {
  canOfferMacFolderPicker,
  fetchRecentProjects,
  loadConnection,
  openWorkspaceByPath,
  pickFolderViaDaemon,
  relaunchCurrentSession,
  type RecentProjectItem,
} from "../../lib/daemon-api";
import { resolveOpenProjectEntryPresentation } from "../../lib/open-project-panel";

/**
 * 「打开/切换项目」入口（TASK-D.1c + C.8c + C.9c + DS.1）：
 * - 最近列表一点带钥匙重开；成功即关面板
 * - 无钥匙：一键重开当前会话；成功即关
 * - 粘贴绝对路径打开（C.8c）
 * - macOS：系统选夹（DS.1 本机助手；≠ D.1e 全量桌面壳）→ 再走 openWorkspaceByPath
 * - 已连接降级为「切换项目」；默认收起（C.9a/C.9c）
 */
export interface OpenProjectEntryProps {
  repoPath: string;
  repoName: string;
  /** C.9a：指挥面相位；打开面板始终是次要入口 */
  commandPhase?: "no_key" | "idle" | "in_progress" | undefined;
  /** C.9a：默认不展开（纪律）；生命周期细则归 C.9c；page 变体忽略（始终展开） */
  defaultExpanded?: boolean | undefined;
  /**
   * C.10e：呈现变体。
   * - sidebar：可折叠次要入口（遗留；IDE 左栏不再使用）
   * - page：欢迎页整页展开（最近项目 + 粘贴路径；不抢 D.1e）
   */
  variant?: "sidebar" | "page" | undefined;
}

export function OpenProjectEntry({
  repoPath,
  repoName,
  commandPhase = "idle",
  defaultExpanded = false,
  variant = "sidebar",
}: OpenProjectEntryProps) {
  const pageMode = variant === "page";
  const [open, setOpen] = useState(pageMode || defaultExpanded);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [items, setItems] = useState<RecentProjectItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [pastePath, setPastePath] = useState("");
  const [pickingFolder, setPickingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offerFolderPicker = canOfferMacFolderPicker();
  const [hasToken, setHasToken] = useState(() =>
    Boolean(loadConnection().token),
  );
  const command = `npx tsx bin/stagent.ts open <新项目路径>`;

  const refreshTokenFlag = useCallback(() => {
    setHasToken(Boolean(loadConnection().token));
  }, []);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    setError(null);
    refreshTokenFlag();
    try {
      const conn = loadConnection();
      if (!conn.token) {
        setItems([]);
        return;
      }
      const list = await fetchRecentProjects(conn);
      setItems(list);
    } catch (err) {
      setItems([]);
      setError((err as Error).message || "读最近项目失败");
    } finally {
      setLoading(false);
    }
  }, [refreshTokenFlag]);

  useEffect(() => {
    refreshTokenFlag();
  }, [refreshTokenFlag]);

  useEffect(() => {
    if (open || pageMode) {
      void loadRecent();
    }
  }, [open, pageMode, loadRecent]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const navigateLaunch = (launchUrl: string) => {
    // Token 只在 fragment；整页跳转后由 loadConnection 注入，勿打印
    window.location.assign(launchUrl);
  };

  const reopen = async (targetPath: string) => {
    setOpeningPath(targetPath);
    setError(null);
    try {
      const conn = loadConnection();
      if (!conn.token) {
        setError("还没连上。请先点「一键重开（带钥匙）」。");
        setOpeningPath(null);
        return;
      }
      const result = await openWorkspaceByPath(conn, targetPath);
      setOpen(false);
      setOpeningPath(null);
      navigateLaunch(result.launchUrl);
    } catch (err) {
      setError((err as Error).message || "打开失败");
      setOpeningPath(null);
    }
  };

  const relaunch = async () => {
    setOpeningPath("__relaunch__");
    setError(null);
    try {
      const result = await relaunchCurrentSession();
      setOpen(false);
      setOpeningPath(null);
      navigateLaunch(result.launchUrl);
    } catch (err) {
      setError(
        (err as Error).message ||
          "一键重开失败。若工作台没在跑，请展开下方「高级」用终端打开。",
      );
      setOpeningPath(null);
    }
  };

  const openPasted = async () => {
    const trimmed = pastePath.trim();
    if (!trimmed) {
      setError("请先粘贴本机文件夹的绝对路径。");
      return;
    }
    await reopen(trimmed);
  };

  const pickFolder = async () => {
    setPickingFolder(true);
    setError(null);
    try {
      const conn = loadConnection();
      if (!conn.token) {
        setError("还没连上。请先点「一键重开（带钥匙）」。");
        return;
      }
      const picked = await pickFolderViaDaemon(conn);
      if ("cancelled" in picked && picked.cancelled) {
        return;
      }
      if ("path" in picked) {
        await reopen(picked.path);
      }
    } catch (err) {
      setError((err as Error).message || "选择文件夹失败");
    } finally {
      setPickingFolder(false);
    }
  };

  const busy = openingPath !== null || pickingFolder;
  const presentation = resolveOpenProjectEntryPresentation({
    hasSession: hasToken,
  });

  const panelOpen = pageMode || open;

  return (
    <div
      className={
        pageMode
          ? "w-full max-w-xl space-y-3 text-sm"
          : "border-b px-2 py-2 text-xs"
      }
      data-open-variant={variant}
    >
      {pageMode ? (
        <div
          data-testid="open-project"
          data-command-role="secondary"
          data-command-phase={commandPhase}
          data-entry-mode={presentation.mode}
          data-variant="page"
          className="flex items-center gap-2"
        >
          <FolderOpen className="h-5 w-5 shrink-0 text-sky-800" />
          <div className="min-w-0">
            <p className="font-semibold">{presentation.label}</p>
            <p className="truncate text-xs text-muted-foreground">{repoName}</p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="open-project"
          data-command-role="secondary"
          data-command-phase={commandPhase}
          data-entry-mode={presentation.mode}
          data-variant="sidebar"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 rounded border border-border px-2 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="truncate">{presentation.label}</span>
          <span className="ml-auto truncate opacity-60">{repoName}</span>
        </button>
      )}

      {panelOpen ? (
        <div
          data-testid="open-project-panel"
          className={
            pageMode
              ? "space-y-3 rounded-lg border border-border bg-card p-4 leading-relaxed"
              : "mt-1 space-y-2 rounded border border-dashed p-2 leading-relaxed"
          }
        >
          <p className="opacity-80">
            当前：
            <code className="ml-1 break-all rounded bg-muted px-1">
              {repoPath}
            </code>
          </p>

          {!hasToken ? (
            <div
              data-testid="open-project-relaunch"
              data-command-role="secondary"
              className="space-y-1.5 rounded border border-border/70 bg-muted/30 p-2"
            >
              <p className="font-medium">还没带上访问钥匙。</p>
              <p className="opacity-70">
                主路径在右侧「一键重开」。这里只是备用入口。
              </p>
              <button
                type="button"
                data-testid="relaunch-with-token"
                data-command-role="secondary"
                disabled={busy}
                onClick={() => void relaunch()}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
              >
                {openingPath === "__relaunch__"
                  ? "正在重开…"
                  : "备用：一键重开（带钥匙）"}
              </button>
            </div>
          ) : null}

          <div data-testid="recent-projects">
            <p className="mb-1 font-medium opacity-90">最近项目</p>
            {loading ? (
              <p className="opacity-60" data-testid="recent-projects-loading">
                加载中…
              </p>
            ) : null}
            {!loading && !hasToken ? (
              <p className="opacity-70" data-testid="recent-projects-locked">
                连上之后这里会列出最近打开过的文件夹。
              </p>
            ) : null}
            {!loading && hasToken && items && items.length === 0 ? (
              <p className="opacity-70" data-testid="recent-projects-empty">
                还没有最近项目。可用「选择文件夹」或粘贴路径打开；成功后会出现在这里。
              </p>
            ) : null}
            {!loading && hasToken && items && items.length > 0 ? (
              <ul className="space-y-1" data-testid="recent-projects-list">
                {items.map((item) => {
                  const isCurrent = item.path === repoPath;
                  const itemBusy = openingPath === item.path;
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        data-testid="recent-project-item"
                        data-path={item.path}
                        data-current={isCurrent ? "true" : "false"}
                        disabled={busy}
                        onClick={() => void reopen(item.path)}
                        className="flex w-full flex-col rounded border border-border px-2 py-1 text-left hover:bg-accent disabled:opacity-50"
                      >
                        <span className="truncate font-medium">
                          {item.name}
                          {isCurrent ? (
                            <span className="ml-1 opacity-50">（当前）</span>
                          ) : null}
                        </span>
                        <span className="truncate opacity-60">{item.path}</span>
                        <span className="opacity-50">
                          {itemBusy ? "正在打开…" : "一点重开（自动带钥匙）"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {offerFolderPicker ? (
            <div data-testid="pick-folder-open" className="space-y-1">
              <p className="font-medium opacity-90">选择文件夹</p>
              <p className="opacity-70">
                用 macOS 系统对话框选本机文件夹，选中后与最近列表、粘贴路径一样带钥匙打开（DS.1
                本机助手切片；≠ 完整桌面壳）。
              </p>
              <button
                type="button"
                data-testid="pick-folder-button"
                disabled={!hasToken || busy}
                onClick={() => void pickFolder()}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
              >
                {pickingFolder
                  ? "正在选择…"
                  : hasToken
                    ? "选择文件夹…"
                    : "先一键重开后再选择文件夹"}
              </button>
            </div>
          ) : null}

          <div data-testid="paste-path-open" className="space-y-1">
            <p className="font-medium opacity-90">打开其他文件夹</p>
            <p className="opacity-70">
              粘贴本机绝对路径（例如{" "}
              <code className="rounded bg-muted px-1">
                /Users/你/Desktop/某项目
              </code>
              ），一点即可打开
              {offerFolderPicker ? "；也可使用上方「选择文件夹」" : ""}。
            </p>
            <div className="flex items-center gap-1">
              <input
                type="text"
                data-testid="paste-path-input"
                value={pastePath}
                disabled={!hasToken || busy}
                placeholder={
                  hasToken ? "粘贴文件夹绝对路径" : "先一键重开后再粘贴路径"
                }
                onChange={(e) => setPastePath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void openPasted();
                  }
                }}
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 disabled:opacity-50"
              />
              <button
                type="button"
                data-testid="paste-path-submit"
                disabled={!hasToken || busy}
                onClick={() => void openPasted()}
                className="shrink-0 rounded border px-2 py-1 hover:bg-accent disabled:opacity-50"
              >
                {openingPath &&
                openingPath !== "__relaunch__" &&
                openingPath === pastePath.trim()
                  ? "打开中…"
                  : "打开"}
              </button>
            </div>
            {/* 明确不含任意路径系统选择器：无 file input / webkitdirectory */}
          </div>

          {error ? (
            <p
              role="alert"
              data-testid="recent-projects-error"
              className="text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div data-testid="open-project-advanced">
            <button
              type="button"
              data-testid="open-project-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-left opacity-70 underline-offset-2 hover:underline"
            >
              {advancedOpen ? "收起高级" : "高级：仍失败时用终端"}
            </button>
            {advancedOpen ? (
              <div className="mt-1 space-y-1 rounded border border-dashed p-2 opacity-80">
                <p>
                  主路径请用上面的「一键重开」或「粘贴路径」。只有工作台完全没在跑、按钮也失败时，再到终端执行：
                </p>
                <div className="flex items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-1 py-0.5">
                    {command}
                  </code>
                  <button
                    type="button"
                    data-testid="copy-open-project-command"
                    onClick={() => void copy()}
                    className="shrink-0 rounded border px-1.5 py-0.5 hover:bg-accent"
                  >
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
