import chokidar, { type FSWatcher } from "chokidar";
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

  constructor(options: WorktreeWatcherOptions) {
    this.root = path.resolve(options.worktreePath);
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

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    if (this.watcher) {
      const w = this.watcher;
      this.watcher = null;
      await w.close();
    }
  }
}
