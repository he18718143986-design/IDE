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

/**
 * 启动时同步快照 root 下已存在的文件路径（跳过忽略目录，不跟随符号链接）。
 * 用于区分“启动前已存在的文件”与真正的新增：chokidar 的初始扫描可能晚于 ready 才上报
 * 既有文件的 add 事件（macOS fs.watch 子目录扫描），这些不是变更。
 * 只依赖路径集合，不依赖 mtime 与时钟精度；路径判定是确定性的。
 */
export function snapshotExistingFiles(root: string): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 不可读目录：不纳入基线（其后的 add 会按变更处理，保守）
    }
    for (const entry of entries) {
      if (IGNORED_SEGMENTS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) out.add(path.resolve(abs));
    }
  }
  return out;
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
  /** start() 时刻的既有文件路径基线：其上的 add 事件是基线，不是变更。 */
  private baseline = new Set<string>();

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
    // 先快照再挂载：挂载后出现的新文件才会进入 add 事件，快照之前已存在的文件属于基线。
    this.baseline = snapshotExistingFiles(this.root);
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

    const enqueue = (filePath: string, kind: "add" | "change" | "unlink") => {
      if (shouldIgnore(filePath, this.root)) return;
      const abs = path.resolve(filePath);
      // 基线内的 add 不是变更；删除后重建会先产生 unlink（已计入），不会因此漏报。
      if (kind === "add" && this.baseline.has(abs)) return;
      this.pending.add(abs);
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
    this.baseline.clear();
    this.readyPromise = null;
    this.readyState = "idle";
    if (this.watcher) {
      const w = this.watcher;
      this.watcher = null;
      await w.close();
    }
  }
}
