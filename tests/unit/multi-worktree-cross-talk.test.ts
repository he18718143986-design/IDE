import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { WorktreeWatcher } from "../../daemon/watcher/fs-watcher";
import { EvidenceInvalidationEngine } from "../../daemon/watcher/invalidation-engine";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";

function createPassedEvidence(contractId: string, evidenceId: string) {
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

describe("TASK-B.2 跨任务 Worktree 串扰负例与独立生命周期测试", () => {
  let tempBase: string;
  const watchersToClean: WorktreeWatcher[] = [];

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-b2-crosstalk-"));
  });

  afterEach(async () => {
    for (const w of watchersToClean) {
      await w.stop();
    }
    watchersToClean.length = 0;
    safeRmSync(tempBase);
  });

  it("跨任务零串扰：修改 task-A 文件只使 task-A 失效，task-B 证据完全保持 PASSED / can_merge=true", async () => {
    const wtA = path.join(tempBase, "wt-task-A");
    const wtB = path.join(tempBase, "wt-task-B");
    const evA = path.join(tempBase, "ev-task-A.json");
    const evB = path.join(tempBase, "ev-task-B.json");

    fs.mkdirSync(path.join(wtA, "src"), { recursive: true });
    fs.mkdirSync(path.join(wtB, "src"), { recursive: true });

    fs.writeFileSync(path.join(wtA, "src", "file.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(wtB, "src", "file.ts"), "export const b = 1;\n");

    fs.writeFileSync(
      evA,
      JSON.stringify(createPassedEvidence("task-A", "evi-A"), null, 2),
    );
    fs.writeFileSync(
      evB,
      JSON.stringify(createPassedEvidence("task-B", "evi-B"), null, 2),
    );

    const engineA = new EvidenceInvalidationEngine(wtA);
    const engineB = new EvidenceInvalidationEngine(wtB);
    engineA.register("task-A", evA);
    engineB.register("task-B", evB);

    const watcherA = new WorktreeWatcher({
      worktreePath: wtA,
      debounceMs: 25,
      onChange: (paths) => engineA.handleChanges(paths),
    });
    const watcherB = new WorktreeWatcher({
      worktreePath: wtB,
      debounceMs: 25,
      onChange: (paths) => engineB.handleChanges(paths),
    });

    watchersToClean.push(watcherA, watcherB);
    watcherA.start();
    watcherB.start();

    await new Promise((r) => setTimeout(r, 100));

    // 仅修改 task-A
    fs.writeFileSync(
      path.join(wtA, "src", "file.ts"),
      "export const a = 2; // modified\n",
    );

    await new Promise((r) => setTimeout(r, 150));

    // 校验 task-A 变为 STALE，can_merge=false
    const contentA = JSON.parse(fs.readFileSync(evA, "utf-8"));
    expect(contentA.verdict.status).toBe("STALE");
    expect(contentA.verdict.can_merge).toBe(false);
    expect(contentA.verdict.reason_code).toBe("EVIDENCE_STALE");

    // 校验 task-B 完全未受影响，依然 PASSED / can_merge=true
    const contentB = JSON.parse(fs.readFileSync(evB, "utf-8"));
    expect(contentB.verdict.status).toBe("PASSED");
    expect(contentB.verdict.can_merge).toBe(true);
  });

  it("多任务并发武装：武装 task-B 不踢掉 task-A 的监听", async () => {
    const wtA = path.join(tempBase, "wt-keep-A");
    const wtB = path.join(tempBase, "wt-keep-B");
    const evA = path.join(tempBase, "ev-keep-A.json");
    const evB = path.join(tempBase, "ev-keep-B.json");

    fs.mkdirSync(path.join(wtA, "src"), { recursive: true });
    fs.mkdirSync(path.join(wtB, "src"), { recursive: true });

    fs.writeFileSync(path.join(wtA, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(wtB, "src", "b.ts"), "export const b = 1;\n");

    fs.writeFileSync(
      evA,
      JSON.stringify(createPassedEvidence("keep-A", "evi-A"), null, 2),
    );
    fs.writeFileSync(
      evB,
      JSON.stringify(createPassedEvidence("keep-B", "evi-B"), null, 2),
    );

    // 模拟服务端 Map 管理结构
    const activeMap = new Map<
      string,
      { watcher: WorktreeWatcher; engine: EvidenceInvalidationEngine }
    >();

    const arm = (contractId: string, wt: string, ev: string) => {
      const engine = new EvidenceInvalidationEngine(wt);
      engine.register(contractId, ev);
      const watcher = new WorktreeWatcher({
        worktreePath: wt,
        debounceMs: 25,
        onChange: (paths) => engine.handleChanges(paths),
      });
      watcher.start();
      activeMap.set(contractId, { watcher, engine });
      watchersToClean.push(watcher);
    };

    // 先武装 A
    arm("keep-A", wtA, evA);
    expect(activeMap.get("keep-A")?.watcher.isWatching).toBe(true);

    // 再武装 B（旧单实例实现会无条件踢掉 A，新 Map 实现保留 A）
    arm("keep-B", wtB, evB);
    expect(activeMap.get("keep-A")?.watcher.isWatching).toBe(true);
    expect(activeMap.get("keep-B")?.watcher.isWatching).toBe(true);

    await new Promise((r) => setTimeout(r, 100));

    // 修改 A，验证 A 的 watcher 依然坚守岗位
    fs.writeFileSync(path.join(wtA, "src", "a.ts"), "export const a = 99;\n");

    await new Promise((r) => setTimeout(r, 150));

    const contentA = JSON.parse(fs.readFileSync(evA, "utf-8"));
    expect(contentA.verdict.status).toBe("STALE");
    expect(contentA.verdict.can_merge).toBe(false);
  });

  it("解除 task-A 不干扰 task-B 的监听", async () => {
    const wtA = path.join(tempBase, "wt-disarm-A");
    const wtB = path.join(tempBase, "wt-disarm-B");
    const evA = path.join(tempBase, "ev-disarm-A.json");
    const evB = path.join(tempBase, "ev-disarm-B.json");

    fs.mkdirSync(path.join(wtA, "src"), { recursive: true });
    fs.mkdirSync(path.join(wtB, "src"), { recursive: true });

    fs.writeFileSync(path.join(wtA, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(wtB, "src", "b.ts"), "export const b = 1;\n");

    fs.writeFileSync(
      evA,
      JSON.stringify(createPassedEvidence("disarm-A", "evi-A"), null, 2),
    );
    fs.writeFileSync(
      evB,
      JSON.stringify(createPassedEvidence("disarm-B", "evi-B"), null, 2),
    );

    const engineA = new EvidenceInvalidationEngine(wtA);
    const engineB = new EvidenceInvalidationEngine(wtB);
    engineA.register("disarm-A", evA);
    engineB.register("disarm-B", evB);

    const watcherA = new WorktreeWatcher({
      worktreePath: wtA,
      debounceMs: 25,
      onChange: (paths) => engineA.handleChanges(paths),
    });
    const watcherB = new WorktreeWatcher({
      worktreePath: wtB,
      debounceMs: 25,
      onChange: (paths) => engineB.handleChanges(paths),
    });

    watchersToClean.push(watcherA, watcherB);
    watcherA.start();
    watcherB.start();

    // 解除 A
    await watcherA.stop();
    expect(watcherA.isWatching).toBe(false);
    expect(watcherB.isWatching).toBe(true);

    await new Promise((r) => setTimeout(r, 100));

    // 修改 B，验证 B 依然生效
    fs.writeFileSync(path.join(wtB, "src", "b.ts"), "export const b = 88;\n");

    await new Promise((r) => setTimeout(r, 150));

    const contentB = JSON.parse(fs.readFileSync(evB, "utf-8"));
    expect(contentB.verdict.status).toBe("STALE");
    expect(contentB.verdict.can_merge).toBe(false);
  });

  it("收紧点 1：同一 contractId 重复武装时旧 watcher 被释放、新 watcher 生效，无同 key 双 watcher 泄漏", async () => {
    const wt = path.join(tempBase, "wt-rearm");
    const ev1 = path.join(tempBase, "ev-rearm-1.json");
    const ev2 = path.join(tempBase, "ev-rearm-2.json");

    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    fs.writeFileSync(path.join(wt, "src", "x.ts"), "export const x = 1;\n");

    fs.writeFileSync(
      ev1,
      JSON.stringify(createPassedEvidence("contract-dup", "evi-1"), null, 2),
    );
    fs.writeFileSync(
      ev2,
      JSON.stringify(createPassedEvidence("contract-dup", "evi-2"), null, 2),
    );

    // 模拟服务端 Map 架构的防泄漏替换语义
    const armedMap = new Map<
      string,
      {
        watcher: WorktreeWatcher;
        engine: EvidenceInvalidationEngine;
        evidenceId: string;
      }
    >();

    const armWatcher = async (
      contractId: string,
      evidenceId: string,
      evidencePath: string,
    ) => {
      if (armedMap.has(contractId)) {
        const oldEntry = armedMap.get(contractId)!;
        await oldEntry.watcher.stop();
        armedMap.delete(contractId);
      }
      const engine = new EvidenceInvalidationEngine(wt);
      engine.register(contractId, evidencePath);
      const watcher = new WorktreeWatcher({
        worktreePath: wt,
        debounceMs: 25,
        onChange: (paths) => engine.handleChanges(paths),
      });
      watcher.start();
      armedMap.set(contractId, { watcher, engine, evidenceId });
      watchersToClean.push(watcher);
    };

    // 首次武装
    await armWatcher("contract-dup", "evi-1", ev1);
    const firstWatcher = armedMap.get("contract-dup")!.watcher;
    expect(firstWatcher.isWatching).toBe(true);

    // 同 contractId 再次武装
    await armWatcher("contract-dup", "evi-2", ev2);
    const secondWatcher = armedMap.get("contract-dup")!.watcher;

    // 旧 watcher 必须已被彻底 stop
    expect(firstWatcher.isWatching).toBe(false);
    // 新 watcher 必须为独立实例且正常 watching
    expect(secondWatcher).not.toBe(firstWatcher);
    expect(secondWatcher.isWatching).toBe(true);
    // Map 内只保留唯一定位项，大小为 1
    expect(armedMap.size).toBe(1);

    await new Promise((r) => setTimeout(r, 100));

    // 修改文件触发 STALE
    fs.writeFileSync(path.join(wt, "src", "x.ts"), "export const x = 2;\n");
    await new Promise((r) => setTimeout(r, 150));

    const content2 = JSON.parse(fs.readFileSync(ev2, "utf-8"));
    expect(content2.verdict.status).toBe("STALE");
    expect(content2.verdict.can_merge).toBe(false);
  });
});
