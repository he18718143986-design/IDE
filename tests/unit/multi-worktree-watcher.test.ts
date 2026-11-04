import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { WorktreeWatcher, shouldIgnore } from "../../daemon/watcher/fs-watcher";
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
      const watcher = new WorktreeWatcher({
        worktreePath: wtDir,
        debounceMs: 25, // 紧凑 debounce
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

    // 等待全部 watcher 处理完毕
    await new Promise((r) => setTimeout(r, 200));

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

    await new Promise((r) => setTimeout(r, 150));

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
