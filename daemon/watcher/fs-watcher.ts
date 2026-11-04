import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import path from "node:path";

/**
 * 活跃 Worktree 文件监听（规范 TASK-B.2 PASS-1）。
 * 精确排除 .git / .stagent / node_modules / 构建产物，避免自身写入死循环。
 */
export interface WorktreeWatcherOptions {
  worktreePath: string;
  onChange: (absolutePaths: string[]) => void;
  debounceMs?: number;
}

const IGNORED_SEGMENTS = new Set([
  ".git",
  ".stagent",
  "node_modules",
  "dist",
  ".output",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
]);

export function shouldIgnore(absolutePath: string, root: string): boolean {
  const rel = path.relative(root, absolutePath);
  if (rel.startsWith("..")) return true;
  return rel
    .split(path.sep)
    .filter(Boolean)
    .some((segment) => IGNORED_SEGMENTS.has(segment));
}

export class WorktreeWatcher {
  private readonly root: string;
  private readonly debounceMs: number;
  private readonly onChange: (paths: string[]) => void;
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(options: WorktreeWatcherOptions) {
    // 规范收紧点 2：在构造函数中一次性执行 fs.realpathSync 归一化工作树根路径（例如 macOS /var 与 /private/var）
    // 避免在 shouldIgnore 高频事件热路径上重复触发系统调用
    this.root = fs.existsSync(options.worktreePath)
      ? fs.realpathSync(options.worktreePath)
      : path.resolve(options.worktreePath);
    this.debounceMs = options.debounceMs ?? 60;
    this.onChange = options.onChange;
  }

  start(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      ignored: (p: string) => shouldIgnore(p, this.root),
      awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 20 },
    });

    this.readyPromise = new Promise<void>((resolve) => {
      this.watcher?.once("ready", () => resolve());
    });

    const enqueue = (filePath: string) => {
      if (shouldIgnore(filePath, this.root)) return;
      this.pending.add(path.resolve(filePath));
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const batch = [...this.pending];
        this.pending.clear();
        this.timer = null;
        if (batch.length > 0) this.onChange(batch);
      }, this.debounceMs);
    };

    this.watcher.on("add", enqueue);
    this.watcher.on("change", enqueue);
    this.watcher.on("unlink", enqueue);
  }

  get isWatching(): boolean {
    return this.watcher !== null;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get hasActiveTimer(): boolean {
    return this.timer !== null;
  }

  /**
   * 等待底层 Watcher 完成初始扫描并就绪（ready 事件）。
   * 生产路径（armEvidenceWatcher）与测试均统一调用，杜绝武装即写入时的就绪窗口漏事件盲区。
   */
  async waitUntilReady(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.readyPromise = null;
    if (this.watcher) {
      const w = this.watcher;
      this.watcher = null;
      await w.close();
    }
  }
}
