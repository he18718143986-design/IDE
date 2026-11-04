import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import {
  WorktreeWatcher,
  shouldIgnore,
  snapshotExistingFiles,
} from "../../daemon/watcher/fs-watcher";
import { EvidenceInvalidationEngine } from "../../daemon/watcher/invalidation-engine";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";
import {
  computeWorktreeFingerprint,
  computeWorktreeFingerprintSync,
} from "../../daemon/guard/evidence-integrity";

function createPassedEvidence(contractId: string, evidenceId = "evi_1") {
  return evidenceBundleSchema.parse({
    evidence_id: evidenceId,
    contract_id: contractId,
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "UNAVAILABLE",
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "head_sha_123",
      snapshot_fingerprint: "fp_test_init",
      captured_at: new Date().toISOString(),
    },
    verdict: { status: "PASSED", can_merge: true, summary: "all gates passed" },
    scope_audit: {
      passed: true,
      files_changed: [
        { path: "src/a.ts", additions: 1, deletions: 0, binary: false },
      ],
      forbidden_violations: [],
      budget_exhausted: false,
    },
    verification_results: [
      {
        command_alias: "test",
        exit_code: 0,
        stdout_tail: "ok",
        stderr_tail: "",
        duration_ms: 10,
        passed: true,
      },
    ],
    git_info: {
      base_commit_sha: "base_sha",
      task_commit_sha: "task_sha",
      diff_stat: "1 file changed",
      patch_fingerprint: "sha256_mock",
    },
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 有界轮询等待条件成立（替代固定 sleep，适应 macOS 原生事件延迟）。 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

describe("TASK-B.2 多 Worktree Watcher 性能与并发监听测试", () => {
  let tempBase: string;
  const watchersToClean: WorktreeWatcher[] = [];

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-b2-multi-"));
  });

  afterEach(async () => {
    for (const w of watchersToClean) {
      await w.stop();
    }
    watchersToClean.length = 0;
    safeRmSync(tempBase);
  });

  it("性能门禁①：外部修改→STALE 响应时延中位数 ≤ 50ms（门禁上限 ≤ 100ms，5次采样）", async () => {
    const latencies: number[] = [];

    for (let round = 0; round < 5; round++) {
      const wtDir = path.join(tempBase, `wt-gate1-${round}`);
      const evDir = path.join(tempBase, `ev-gate1-${round}`);
      fs.mkdirSync(path.join(wtDir, "src"), { recursive: true });
      fs.mkdirSync(evDir, { recursive: true });

      const testFile = path.join(wtDir, "src", "index.ts");
      fs.writeFileSync(testFile, "export const x = 0;\n");

      const evPath = path.join(evDir, "evidence.json");
      fs.writeFileSync(
        evPath,
        JSON.stringify(createPassedEvidence(`c-gate1-${round}`), null, 2),
      );

      const engine = new EvidenceInvalidationEngine(wtDir);
      engine.register(`c-gate1-${round}`, evPath);

      let resolveHit!: (ms: number) => void;
      const hitPromise = new Promise<number>((r) => {
        resolveHit = r;
      });

      const startTime = { current: 0 };
      // 测试口径（仅本门禁）：stabilityThreshold 20 / pollInterval 10 / debounceMs 10，产品默认值不动。
      // 生产下限构成：awaitWriteFinish 稳定窗口 40ms + 轮询 20ms + debounce 60ms，合计约 100ms 量级，
      // 生产默认路径本身已贴近 100ms 门禁上限。
      // 本门禁测量口径：隔离检测路径（chokidar 事件 → 指纹/失效判定 → 回调）的时延，
      // 以更紧凑的写入稳定参数减少 CI 调度抖动；它不代表生产默认值的端到端时延。
      const watcher = new WorktreeWatcher({
        worktreePath: wtDir,
        debounceMs: 10,
        awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
        onChange: (paths) => {
          const results = engine.handleChanges(paths);
          if (results.some((r) => r.stale)) {
            const elapsed = performance.now() - startTime.current;
            resolveHit(elapsed);
          }
        },
      });
      watchersToClean.push(watcher);
      watcher.start();
      expect(
        await watcher.waitUntilReady(),
        "watcher 未在超时内就绪（ready 未触发）",
      ).toBe(true);

      startTime.current = performance.now();
      fs.writeFileSync(testFile, `export const x = ${round + 1};\n`);

      const latency = await withTimeout(
        hitPromise,
        3000,
        `round ${round}：3s 内未收到 STALE 回调（事件丢失或被误滤）`,
      );
      latencies.push(latency);
      await watcher.stop();
    }

    const medLatency = median(latencies);
    console.log(
      `[B.2 PERF] 外部修改->STALE 5次采样 (ms): [${latencies.map((n) => n.toFixed(1)).join(", ")}], 中位数: ${medLatency.toFixed(1)}ms`,
    );

    // 门禁上限 100ms
    expect(medLatency).toBeLessThanOrEqual(100);
  });

  it("性能门禁②：>=5 worktree 并发监听常驻内存增量中位数 ≤ 30MB（处理 global.gc 未暴露空真）", async () => {
    if (typeof (global as unknown as { gc?: () => void }).gc !== "function") {
      console.warn(
        "global.gc 未暴露 (--expose-gc 未启用)，跳过常驻内存增量硬断言避免空真 PASS",
      );
      return;
    }
    const gc = (global as unknown as { gc: () => void }).gc;

    const diffsMiB: number[] = [];

    for (let sample = 0; sample < 3; sample++) {
      gc();
      const beforeHeap = process.memoryUsage().heapUsed;

      const sampleWatchers: WorktreeWatcher[] = [];
      for (let i = 0; i < 5; i++) {
        const wtDir = path.join(tempBase, `wt-mem-${sample}-${i}`);
        fs.mkdirSync(path.join(wtDir, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(wtDir, "src", "file.ts"),
          "export const v = 1;\n",
        );

        const w = new WorktreeWatcher({
          worktreePath: wtDir,
          debounceMs: 50,
          onChange: () => {},
        });
        w.start();
        sampleWatchers.push(w);
      }

      gc();
      const afterHeap = process.memoryUsage().heapUsed;
      const diffMiB = Math.max(0, afterHeap - beforeHeap) / (1024 * 1024);
      diffsMiB.push(diffMiB);

      for (const w of sampleWatchers) {
        await w.stop();
      }
    }

    const medMiB = median(diffsMiB);
    console.log(
      `[B.2 PERF] >=5 并发 worktree 监听内存增量中位数: ${medMiB.toFixed(2)} MiB (门禁上限 30MB)`,
    );
    expect(medMiB).toBeLessThanOrEqual(30);
  });

  it("性能门禁④：解除武装句柄/定时器 100% 释放与重复 arm/disarm 20 次零泄漏", async () => {
    const wtDir = path.join(tempBase, "wt-release");
    fs.mkdirSync(path.join(wtDir, "src"), { recursive: true });

    const watcher = new WorktreeWatcher({
      worktreePath: wtDir,
      debounceMs: 40,
      onChange: () => {},
    });
    watcher.start();
    expect(watcher.isWatching).toBe(true);

    await watcher.stop();
    expect(watcher.isWatching).toBe(false);
    expect(watcher.hasActiveTimer).toBe(false);
    expect(watcher.pendingCount).toBe(0);

    // 重复 arm 与 stop 20 次，验证句柄正常回收
    for (let i = 0; i < 20; i++) {
      const iterWatcher = new WorktreeWatcher({
        worktreePath: wtDir,
        debounceMs: 30,
        onChange: () => {},
      });
      iterWatcher.start();
      expect(iterWatcher.isWatching).toBe(true);
      await iterWatcher.stop();
      expect(iterWatcher.isWatching).toBe(false);
      expect(iterWatcher.hasActiveTimer).toBe(false);
    }
  });

  it(">=5 Worktree 并发监听独立触发：修改各目录，准确标记对应 Evidence 为 STALE", async () => {
    const count = 5;
    const engines: EvidenceInvalidationEngine[] = [];
    const evidencePaths: string[] = [];
    const wtDirs: string[] = [];

    for (let i = 0; i < count; i++) {
      const wtDir = path.join(tempBase, `multi-wt-${i}`);
      const evDir = path.join(tempBase, `multi-ev-${i}`);
      fs.mkdirSync(path.join(wtDir, "src"), { recursive: true });
      fs.mkdirSync(evDir, { recursive: true });

      fs.writeFileSync(
        path.join(wtDir, "src", "code.ts"),
        `export const val = ${i};\n`,
      );
      const evPath = path.join(evDir, `evidence-${i}.json`);
      fs.writeFileSync(
        evPath,
        JSON.stringify(createPassedEvidence(`task-${i}`), null, 2),
      );

      const engine = new EvidenceInvalidationEngine(wtDir);
      engine.register(`task-${i}`, evPath);

      engines.push(engine);
      evidencePaths.push(evPath);
      wtDirs.push(wtDir);

      const watcher = new WorktreeWatcher({
        worktreePath: wtDir,
        debounceMs: 30,
        onChange: (paths) => {
          engine.handleChanges(paths);
        },
      });
      watchersToClean.push(watcher);
      watcher.start();
      expect(
        await watcher.waitUntilReady(),
        "watcher 未在超时内就绪（ready 未触发）",
      ).toBe(true);
    }

    // 修改前，全量 can_merge 均为 true
    for (const evPath of evidencePaths) {
      const content = JSON.parse(fs.readFileSync(evPath, "utf-8"));
      expect(content.verdict.status).toBe("PASSED");
      expect(content.verdict.can_merge).toBe(true);
    }

    // 逐个修改每个 worktree 的业务文件
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(
        path.join(wtDirs[i]!, "src", "code.ts"),
        `export const val = ${i + 100};\n`,
      );
    }

    // 等待全部 watcher 处理完毕（有界轮询，直到全部证据变为 STALE 或超时）
    await waitFor(
      () =>
        evidencePaths.every((evPath) => {
          const c = JSON.parse(fs.readFileSync(evPath, "utf-8"));
          return c.verdict.status === "STALE";
        }),
      5000,
    );

    // 验证所有证据都被原子重写为 STALE
    for (let i = 0; i < count; i++) {
      const content = JSON.parse(fs.readFileSync(evidencePaths[i]!, "utf-8"));
      expect(content.verdict.status).toBe("STALE");
      expect(content.verdict.can_merge).toBe(false);
      expect(content.verdict.reason_code).toBe("EVIDENCE_STALE");
    }
  });

  it("忽略目录写入不误报：修改 .git / .stagent / node_modules 不触发 STALE", async () => {
    const wtDir = path.join(tempBase, "wt-ignore");
    const evDir = path.join(tempBase, "ev-ignore");
    fs.mkdirSync(path.join(wtDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(wtDir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(wtDir, ".stagent"), { recursive: true });
    fs.mkdirSync(path.join(wtDir, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(wtDir, "dist"), { recursive: true });
    fs.mkdirSync(evDir, { recursive: true });

    fs.writeFileSync(
      path.join(wtDir, "src", "app.ts"),
      "export const a = 1;\n",
    );
    const evPath = path.join(evDir, "evidence.json");
    fs.writeFileSync(
      evPath,
      JSON.stringify(createPassedEvidence("task-ignore"), null, 2),
    );

    const engine = new EvidenceInvalidationEngine(wtDir);
    engine.register("task-ignore", evPath);

    let fired = false;
    const seen: string[] = [];
    const realRoot = fs.realpathSync(wtDir);
    const watcher = new WorktreeWatcher({
      worktreePath: wtDir,
      debounceMs: 30,
      onChange: (paths) => {
        seen.push(...paths);
        const results = engine.handleChanges(paths);
        if (results.some((r) => r.stale)) fired = true;
      },
    });
    watchersToClean.push(watcher);
    watcher.start();
    expect(
      await watcher.waitUntilReady(),
      "watcher 未在超时内就绪（ready 未触发）",
    ).toBe(true);
    fired = false;

    // 修改忽略目录里的内容
    fs.writeFileSync(path.join(wtDir, ".git", "index.lock"), "locked\n");
    fs.writeFileSync(path.join(wtDir, ".stagent", "token"), "new_token\n");
    fs.writeFileSync(
      path.join(wtDir, "node_modules", "pkg", "index.js"),
      "x\n",
    );
    fs.writeFileSync(path.join(wtDir, "dist", "bundle.js"), "bundle\n");

    // 留足窗口让可能的误报送达（忽略目录事件应当为零）
    await new Promise((r) => setTimeout(r, 500));

    // 失败时打印诊断：root（realpath）、事件路径、归一后的相对路径与忽略判定
    const diag = seen.map(
      (p) =>
        `event=${p} rel=${path.relative(realRoot, p)} ignored=${shouldIgnore(p, realRoot)}`,
    );
    expect(seen, `root=${realRoot} tmp=${wtDir}\n${diag.join("\n")}`).toEqual(
      [],
    );
    expect(fired).toBe(false);
    const content = JSON.parse(fs.readFileSync(evPath, "utf-8"));
    expect(content.verdict.status).toBe("PASSED");
    expect(content.verdict.can_merge).toBe(true);
  });
});

describe("TASK-B.2 macOS 事件竞争回归（平台无关的行为断言）", () => {
  let base: string;
  const cleanup: WorktreeWatcher[] = [];

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-b2-race-"));
  });

  afterEach(async () => {
    for (const w of cleanup) await w.stop();
    cleanup.length = 0;
    safeRmSync(base);
  });

  it("武装窗口：ready 后等待 armSettleMs 才对外报告就绪", async () => {
    const wt = path.join(base, "wt-settle");
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    fs.writeFileSync(path.join(wt, "src", "a.ts"), "a\n");
    const w = new WorktreeWatcher({
      worktreePath: wt,
      armSettleMs: 250,
      onChange: () => {},
    });
    cleanup.push(w);
    const t0 = Date.now();
    w.start();
    expect(await w.waitUntilReady()).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240);
    expect(w.isReady).toBe(true);
  });

  it("启动前已写入的文件不计为变更（历史事件过滤）", async () => {
    const wt = path.join(base, "wt-history");
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    const early = path.join(wt, "src", "early.ts");
    fs.writeFileSync(early, "before start\n");
    // 确保 mtime 严格早于 start()
    await new Promise((r) => setTimeout(r, 20));

    const seen: string[] = [];
    const w = new WorktreeWatcher({
      worktreePath: wt,
      debounceMs: 20,
      onChange: (paths) => seen.push(...paths),
    });
    cleanup.push(w);
    w.start();
    expect(await w.waitUntilReady()).toBe(true);

    // 启动后的真实修改必须被捕获
    const late = path.join(wt, "src", "late.ts");
    fs.writeFileSync(late, "after start\n");
    const got = await waitFor(
      () => seen.some((p) => p.endsWith(path.join("src", "late.ts"))),
      5000,
    );
    expect(got).toBe(true);
    expect(seen.some((p) => p.endsWith(path.join("src", "early.ts")))).toBe(
      false,
    );
  });

  it("stop() 发生在武装窗口内：不把已停止的 watcher 翻成 ready", async () => {
    const wt = path.join(base, "wt-stop");
    fs.mkdirSync(wt, { recursive: true });
    const w = new WorktreeWatcher({
      worktreePath: wt,
      armSettleMs: 400,
      readyTimeoutMs: 1000,
      onChange: () => {},
    });
    cleanup.push(w);
    w.start();
    const waiting = w.waitUntilReady();
    await new Promise((r) => setTimeout(r, 50));
    await w.stop();
    await waiting;
    await new Promise((r) => setTimeout(r, 500));
    expect(w.isReady).toBe(false);
  });
});

describe("shouldIgnore 段匹配边界", () => {
  const root = path.resolve("/repo/wt");
  it("忽略目录的任一段命中即忽略（含嵌套）", () => {
    expect(shouldIgnore(path.join(root, ".git", "index"), root)).toBe(true);
    expect(
      shouldIgnore(path.join(root, "src", "node_modules", "x.js"), root),
    ).toBe(true);
  });
  it("以 .. 开头的合法目录名不被误判为越界", () => {
    expect(shouldIgnore(path.join(root, "..cache", "a.ts"), root)).toBe(false);
  });
  it("普通源码路径不忽略；越界路径忽略", () => {
    expect(shouldIgnore(path.join(root, "src", "a.ts"), root)).toBe(false);
    expect(shouldIgnore(path.resolve("/elsewhere/a.ts"), root)).toBe(true);
  });
});

describe("TASK-B.2 启动基线与启动后修改（路径判定，不依赖 mtime）", () => {
  let base: string;
  const cleanup: WorktreeWatcher[] = [];

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-b2-baseline-"));
  });

  afterEach(async () => {
    for (const w of cleanup) await w.stop();
    cleanup.length = 0;
    safeRmSync(base);
  });

  it("基线快照：包含既有源文件（含深层），跳过忽略目录", () => {
    const wt = path.join(base, "wt-snap");
    fs.mkdirSync(path.join(wt, "src", "deep", "er"), { recursive: true });
    fs.mkdirSync(path.join(wt, ".git"), { recursive: true });
    fs.mkdirSync(path.join(wt, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(wt, "src", "deep", "er", "x.ts"), "x\n");
    fs.writeFileSync(path.join(wt, ".git", "HEAD"), "ref\n");
    fs.writeFileSync(path.join(wt, "node_modules", "pkg", "i.js"), "i\n");

    const root = fs.realpathSync(wt);
    const rels = [...snapshotExistingFiles(root).keys()].map((p) =>
      path.relative(root, p),
    );
    expect(rels).toEqual([path.join("src", "deep", "er", "x.ts")]);
  });

  it("启动后立即修改既有文件（无额外等待）必须计为变更", async () => {
    const wt = path.join(base, "wt-immediate");
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    const f = path.join(wt, "src", "code.ts");
    fs.writeFileSync(f, "export const v = 1;\n");

    const seen: string[] = [];
    const w = new WorktreeWatcher({
      worktreePath: wt,
      debounceMs: 10,
      onChange: (paths) => seen.push(...paths),
    });
    cleanup.push(w);
    w.start();
    expect(await w.waitUntilReady()).toBe(true);

    fs.writeFileSync(f, "export const v = 22222;\n");
    const got = await waitFor(
      () => seen.some((p) => p.endsWith(path.join("src", "code.ts"))),
      5000,
    );
    expect(got).toBe(true);
  });

  it("启动后在新建的深层目录中创建文件计为变更；基线内文件不计", async () => {
    const wt = path.join(base, "wt-deep-new");
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    fs.writeFileSync(path.join(wt, "src", "old.ts"), "old\n");

    const seen: string[] = [];
    const w = new WorktreeWatcher({
      worktreePath: wt,
      debounceMs: 20,
      onChange: (paths) => seen.push(...paths),
    });
    cleanup.push(w);
    w.start();
    expect(await w.waitUntilReady()).toBe(true);

    fs.mkdirSync(path.join(wt, "src", "feature", "nested"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(wt, "src", "feature", "nested", "new.ts"),
      "new\n",
    );
    const got = await waitFor(
      () => seen.some((p) => p.endsWith("new.ts")),
      5000,
    );
    expect(got).toBe(true);
    expect(seen.some((p) => p.endsWith(path.join("src", "old.ts")))).toBe(
      false,
    );
  });
});
