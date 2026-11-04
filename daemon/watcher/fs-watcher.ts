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
  /** 等待 ready 事件的超时兜底（默认 5000ms），超时后降级继续，不挂死。 */
  readyTimeoutMs?: number;
  /** ready 之后的武装窗口（默认：macOS 300ms，其他平台 0）。 */
  armSettleMs?: number;
}

type ReadyState = "idle" | "pending" | "ready" | "timeout";

/**
 * macOS 上 chokidar 5 经 fs.watch（libuv FSEvents）监听，原生流是异步启动的：
 * chokidar 在 fs.watch 调用返回后就立即 emit ready，此时 FSEvents 流未必已武装，
 * ready 之后紧接着的写入会被静默丢失（B.2 门禁①、5 worktree 并发用例的 STALE 漏报根因）。
 * 因此 macOS 上 ready 后额外等待一段武装窗口再对外报告就绪。其他平台为 0，行为不变。
 */
const ARM_SETTLE_MS = process.platform === "darwin" ? 300 : 0;

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

/**
 * 判断事件路径是否应被忽略。
 * - 双方都经 path.resolve 归一（去尾部分隔符、消除 . 与 ..）。
 * - 越界路径（不在 root 之下）直接忽略；仅以 ".." 段开头判定，
 *   避免把合法目录名 "..cache" 之类误判为越界。
 * - 其余按相对路径的 segments 做精确匹配，不做前缀比较，对符号链接/口径差异免疫。
 */
export function shouldIgnore(absolutePath: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(absolutePath));
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return true;
  }
  return rel
    .split(path.sep)
    .filter(Boolean)
    .some((segment) => IGNORED_SEGMENTS.has(segment));
}

export class WorktreeWatcher {
  private readonly root: string;
  private readonly debounceMs: number;
  private readonly readyTimeoutMs: number;
  private readonly armSettleMs: number;
  private readonly onChange: (paths: string[]) => void;
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyState: ReadyState = "idle";
  /** start() 调用时刻（小数毫秒，与文件 mtime 同为墙钟口径）；早于它的修改属于基线。 */
  private startedAtMs = 0;

  constructor(options: WorktreeWatcherOptions) {
    // 规范收紧点 2：在构造函数中一次性执行 fs.realpathSync 归一化工作树根路径（例如 macOS /var 与 /private/var）
    // 避免在 shouldIgnore 高频事件热路径上重复触发系统调用
    this.root = fs.existsSync(options.worktreePath)
      ? fs.realpathSync(options.worktreePath)
      : path.resolve(options.worktreePath);
    this.debounceMs = options.debounceMs ?? 60;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 5000;
    this.armSettleMs = options.armSettleMs ?? ARM_SETTLE_MS;
    this.onChange = options.onChange;
  }

  start(): void {
    if (this.watcher) return;
    this.startedAtMs = performance.timeOrigin + performance.now();
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      ignored: (p: string) => shouldIgnore(p, this.root),
      awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 20 },
    });

    this.readyState = "pending";
    const watcher = this.watcher;
    this.readyPromise = new Promise<void>((resolve) => {
      watcher.once("ready", () => {
        const finish = () => {
          if (this.watcher !== watcher) return; // 已 stop，不再翻转状态
          if (this.readyState !== "timeout") this.readyState = "ready";
          resolve();
        };
        if (this.armSettleMs > 0) setTimeout(finish, this.armSettleMs);
        else finish();
      });
    });

    /** 启动前已写入的文件（macOS FSEvents 可能延迟投递其事件）不计为变更。 */
    const predatesStart = (filePath: string): boolean => {
      try {
        const { mtimeMs } = fs.statSync(filePath);
        // 只有亚秒精度的 mtime 才能可靠地与启动时刻比较；整秒 mtime（如 HFS+）无法判定，
        // 保守视为变更。误报只会让证据偏保守，漏报才危险。
        const hasSubSecond = mtimeMs % 1 !== 0;
        return hasSubSecond && mtimeMs < this.startedAtMs;
      } catch {
        return false; // 已删除或不可读：保守视为变更
      }
    };

    const enqueue = (filePath: string, kind: "add" | "change" | "unlink") => {
      if (shouldIgnore(filePath, this.root)) return;
      if (kind !== "unlink" && predatesStart(filePath)) return;
      this.pending.add(path.resolve(filePath));
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const batch = [...this.pending];
        this.pending.clear();
        this.timer = null;
        if (batch.length > 0) this.onChange(batch);
      }, this.debounceMs);
    };

    this.watcher.on("add", (p: string) => enqueue(p, "add"));
    this.watcher.on("change", (p: string) => enqueue(p, "change"));
    this.watcher.on("unlink", (p: string) => enqueue(p, "unlink"));
  }

  get isWatching(): boolean {
    return this.watcher !== null;
  }

  get isReady(): boolean {
    return this.readyState === "ready";
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get hasActiveTimer(): boolean {
    return this.timer !== null;
  }

  /**
   * 等待底层 Watcher 完成初始扫描并就绪（ready 事件），最多等 readyTimeoutMs。
   * 返回 true 表示已就绪；返回 false 表示未就绪（未启动或超时），调用方据此降级，
   * 超时只记 warn 日志、不抛错、不阻断武装，宁可降级不可挂死。
   */
  async waitUntilReady(): Promise<boolean> {
    if (!this.readyPromise) return false;
    if (this.readyState === "ready") return true;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        if (this.readyState === "pending") {
          this.readyState = "timeout";
          console.warn(
            `[watcher] ready 超时 ${this.readyTimeoutMs}ms，root=${this.root}，降级继续（合并前兜底仍在）`,
          );
        }
        resolve(false);
      }, this.readyTimeoutMs);
    });
    const ready = this.readyPromise.then(() => true as const);
    try {
      return await Promise.race([ready, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.readyPromise = null;
    this.readyState = "idle";
    if (this.watcher) {
      const w = this.watcher;
      this.watcher = null;
      await w.close();
    }
  }
}
