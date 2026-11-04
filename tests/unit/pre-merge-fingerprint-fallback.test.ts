import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { safeRmSync } from "../helpers/tmp";
import {
  computeWorktreeFingerprint,
  computeWorktreeFingerprintSync,
  assertEvidenceIntegrity,
  EvidenceIntegrityError,
  E_EVIDENCE_FINGERPRINT_MISMATCH,
} from "../../daemon/guard/evidence-integrity";
import { EvidenceInvalidationEngine } from "../../daemon/watcher/invalidation-engine";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";

function createPassedEvidence(contractId: string, fingerprint: string) {
  return evidenceBundleSchema.parse({
    evidence_id: `evi_${contractId}`,
    contract_id: contractId,
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "UNAVAILABLE",
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "head_sha_fallback",
      snapshot_fingerprint: fingerprint,
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

describe("TASK-B.2 合并前快照指纹复核兜底与算法收敛测试", () => {
  let tempBase: string;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-b2-fallback-"));
  });

  afterEach(() => {
    safeRmSync(tempBase);
  });

  it("性能门禁③：合并前全量指纹复核耗时中位数 ≤ 50ms（5次采样取中位数）", async () => {
    const gitRepo = path.join(tempBase, "perf-repo");
    fs.mkdirSync(path.join(gitRepo, "src"), { recursive: true });

    // 初始化 Git 环境并提交 50 个典型源文件
    execSync("git init", { cwd: gitRepo, stdio: "ignore" });
    execSync(
      "git config user.name test && git config user.email test@test.com",
      {
        cwd: gitRepo,
        stdio: "ignore",
      },
    );

    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(
        path.join(gitRepo, "src", `module_${i}.ts`),
        `export const val_${i} = ${i};\n`,
      );
    }
    execSync("git add . && git commit -m initial", {
      cwd: gitRepo,
      stdio: "ignore",
    });

    const durations: number[] = [];
    for (let round = 0; round < 5; round++) {
      const t0 = performance.now();
      const fp = await computeWorktreeFingerprint(gitRepo);
      const elapsed = performance.now() - t0;
      durations.push(elapsed);
      expect(typeof fp).toBe("string");
      expect(fp.length).toBe(64);
    }

    const medDuration = median(durations);
    console.log(
      `[B.2 PERF] 合并前指纹复核耗时 5次采样 (ms): [${durations.map((d) => d.toFixed(2)).join(", ")}], 中位数: ${medDuration.toFixed(2)}ms (门禁要求 <= 50ms)`,
    );

    expect(medDuration).toBeLessThanOrEqual(50);
  });

  it("PASS-8 / 红线 5：Watcher 全挂/未武装时，外部修改在合并前复核兜底强制拦截并转 STALE", async () => {
    const gitRepo = path.join(tempBase, "fallback-repo");
    fs.mkdirSync(path.join(gitRepo, "src"), { recursive: true });

    execSync("git init", { cwd: gitRepo, stdio: "ignore" });
    execSync(
      "git config user.name test && git config user.email test@test.com",
      {
        cwd: gitRepo,
        stdio: "ignore",
      },
    );
    fs.writeFileSync(
      path.join(gitRepo, "src", "index.ts"),
      "export const app = 1;\n",
    );
    execSync("git add . && git commit -m initial", {
      cwd: gitRepo,
      stdio: "ignore",
    });

    // 1. 验证通过时生成证据快照并记录指纹
    const baselineFingerprint = await computeWorktreeFingerprint(gitRepo);
    const evDir = path.join(tempBase, "evidence");
    fs.mkdirSync(evDir, { recursive: true });
    const evPath = path.join(evDir, "task-fallback-evi.json");

    const snapshot = createPassedEvidence("task-fallback", baselineFingerprint);
    fs.writeFileSync(evPath, JSON.stringify(snapshot, null, 2));

    // 此时指纹一致，若直接合并则通过
    await expect(
      assertEvidenceIntegrity({
        worktreePath: gitRepo,
        evidencePath: evPath,
        snapshot,
      }),
    ).resolves.toBe(baselineFingerprint);

    // 2. 模拟 Watcher 从未武装、进程崩溃或事件丢包：没有任何 watcher 在监听！
    // 外部恶意改码（偷渡后门代码）
    fs.writeFileSync(
      path.join(gitRepo, "src", "index.ts"),
      "export const app = 1;\nexport const backdoor = evil;\n",
    );

    // 3. 执行合并前快照指纹复核（assertEvidenceIntegrity）：必须 100% 拦截并抛出 E_EVIDENCE_FINGERPRINT_MISMATCH
    let caughtErr: unknown = null;
    try {
      await assertEvidenceIntegrity({
        worktreePath: gitRepo,
        evidencePath: evPath,
        snapshot,
      });
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr).toBeInstanceOf(EvidenceIntegrityError);
    expect((caughtErr as EvidenceIntegrityError).code).toBe(
      E_EVIDENCE_FINGERPRINT_MISMATCH,
    );

    // 4. 磁盘证据快照必须已被原子改写为 STALE，can_merge=false
    const diskEvidence = JSON.parse(fs.readFileSync(evPath, "utf-8"));
    expect(diskEvidence.verdict.status).toBe("STALE");
    expect(diskEvidence.verdict.can_merge).toBe(false);
    expect(diskEvidence.verdict.reason_code).toBe("EVIDENCE_STALE");
  });

  it("收紧点 2：指纹计算降级路径单点收敛，异步与同步口径在同一目录产生完全一致的指纹", async () => {
    // 场景 A：非 Git 目录（降级路径测试）
    const nonGitDir = path.join(tempBase, "nongit");
    fs.mkdirSync(path.join(nonGitDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(nonGitDir, "src", "a.ts"),
      "export const hello = world;\n",
    );
    fs.writeFileSync(
      path.join(nonGitDir, "src", "b.ts"),
      "export const num = 42;\n",
    );

    const fpAsyncNonGit = await computeWorktreeFingerprint(nonGitDir);
    const fpSyncNonGit = computeWorktreeFingerprintSync(nonGitDir);

    expect(fpAsyncNonGit).toBe(fpSyncNonGit);
    expect(typeof fpAsyncNonGit).toBe("string");
    expect(fpAsyncNonGit.length).toBe(64);

    // 验证 invalidation-engine 在该目录下计算的指纹亦完全相同
    const engineNonGit = new EvidenceInvalidationEngine(nonGitDir);
    expect(engineNonGit.computeFingerprint()).toBe(fpAsyncNonGit);

    // 场景 B：Git 工作树目录（标准 Git 口径测试）
    const gitDir = path.join(tempBase, "gitdir");
    fs.mkdirSync(path.join(gitDir, "src"), { recursive: true });
    execSync("git init", { cwd: gitDir, stdio: "ignore" });
    execSync(
      "git config user.name test && git config user.email test@test.com",
      {
        cwd: gitDir,
        stdio: "ignore",
      },
    );
    fs.writeFileSync(path.join(gitDir, "src", "a.ts"), "const g = 1;\n");
    execSync("git add . && git commit -m init", {
      cwd: gitDir,
      stdio: "ignore",
    });

    const fpAsyncGit = await computeWorktreeFingerprint(gitDir);
    const fpSyncGit = computeWorktreeFingerprintSync(gitDir);

    expect(fpAsyncGit).toBe(fpSyncGit);
    expect(fpAsyncGit.length).toBe(64);

    const engineGit = new EvidenceInvalidationEngine(gitDir);
    expect(engineGit.computeFingerprint()).toBe(fpAsyncGit);
  });
});
