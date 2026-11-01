
/**
 * TASK-L.15：local_process RO-01～RO-03（适配器可注入，走真实 git archive 导出）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { ReleaseManager } from "../../daemon/release/release-manager";
import type {
  ReleaseContext,
  ReleaseTargetAdapter,
  StepResult,
} from "../../daemon/release/target-adapter";
import type { ReleaseRecord } from "../../src/lib/release/release";

function stamp(argv: string[], okFlag: boolean, log = "ok"): StepResult {
  const t = new Date().toISOString();
  return {
    ok: okFlag,
    exit_code: okFlag ? 0 : 1,
    argv,
    log_tail: log,
    started_at: t,
    ended_at: t,
  };
}

type HealthMode = "pass" | "fail";

function makeLocalAdapter(opts: {
  health: HealthMode | (() => HealthMode);
  onDeploy?: (ctx: ReleaseContext) => void;
}): ReleaseTargetAdapter & { deploys: string[]; healthCalls: number } {
  const state = { deploys: [] as string[], healthCalls: 0 };
  const adapter: ReleaseTargetAdapter & {
    deploys: string[];
    healthCalls: number;
  } = {
    kind: "local_process",
    deploys: state.deploys,
    healthCalls: 0,
    build: async () => stamp(["npm", "run", "build"], true),
    deploy: async (ctx) => {
      state.deploys.push(ctx.release.release_id);
      opts.onDeploy?.(ctx);
      return stamp(["npm", "run", "start"], true, `started ${ctx.release.release_id}`);
    },
    health: async () => {
      state.healthCalls += 1;
      adapter.healthCalls = state.healthCalls;
      const mode =
        typeof opts.health === "function" ? opts.health() : opts.health;
      return stamp(
        ["GET", "http://127.0.0.1:4300/"],
        mode === "pass",
        mode === "pass" ? "HTTP 200" : "HTTP 500",
      );
    },
    stop: async (ctx) =>
      stamp(["spawnManaged.stop"], true, `stopped ${ctx.release.release_id}`),
  };
  return adapter;
}

function writeTargets(repo: string): void {
  fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".stagent/release-targets.json"),
    JSON.stringify({
      targets: [
        {
          target_id: "local",
          kind: "local_process",
          port: 4300,
          health_path: "/",
        },
      ],
    }) + "\n",
  );
}

function initRepo(): { repo: string; sha: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l15-lp-"));
  git(repo, ["init"]);
  git(repo, ["checkout", "-b", "main"]);
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({
      name: "demo",
      scripts: { build: "echo build", start: "echo start" },
    }) + "\n",
  );
  git(repo, ["add", "."]);
  git(repo, [
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-m",
    "init\n\nStagent-Contract-ID: ctr-demo-1",
  ]);
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  writeTargets(repo);
  return { repo, sha };
}

describe("TASK-L.15 release-local-process RO-01～03", () => {
  let repo = "";
  let sha = "";

  beforeEach(() => {
    ({ repo, sha } = initRepo());
  });

  afterEach(() => {
    if (repo) safeRmSync(repo);
  });

  it("RO-01：build/deploy/health 全成功 → LIVE，三步退出码 0", async () => {
    const adapter = makeLocalAdapter({ health: "pass" });
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: adapter },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 1,
      healthIntervalMs: 1,
    });
    const draft = await mgr.createDraft({
      target_id: "local",
      commit_sha: sha,
    });
    expect(draft.contract_ids).toContain("ctr-demo-1");
    const live = await mgr.run(draft.release_id);
    expect(live.state).toBe("LIVE");
    const names = live.steps.map((s) => s.step);
    expect(names).toEqual(["build", "deploy", "health"]);
    expect(live.steps.every((s) => s.exit_code === 0)).toBe(true);
    // git archive 导出目录存在且无 .git
    const checkout = path.join(
      repo,
      ".stagent/releases",
      live.release_id,
      "checkout",
    );
    expect(fs.existsSync(path.join(checkout, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(checkout, ".git"))).toBe(false);
  });

  it("RO-02：探活失败且有上一 LIVE → ROLLED_BACK；上一 LIVE 仍 LIVE 并被重新部署", async () => {
    let healthPhase: HealthMode = "pass";
    const adapter = makeLocalAdapter({
      health: () => healthPhase,
    });
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: adapter },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 3,
      healthIntervalMs: 1,
    });
    const d1 = await mgr.createDraft({ target_id: "local", commit_sha: sha });
    const first = await mgr.run(d1.release_id);
    expect(first.state).toBe("LIVE");

    // 第二个提交
    fs.writeFileSync(path.join(repo, "README.md"), "v2\n");
    git(repo, ["add", "."]);
    git(repo, [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-m",
      "v2",
    ]);
    const sha2 = git(repo, ["rev-parse", "HEAD"]).trim();

    healthPhase = "fail";
    // 回滚探活：前几次是对新版本的失败；rollback 阶段仍走同一 health 钩子。
    // 用调用计数：第一次 run 的 health 已 pass；第二次 run 的健康检查 3 次 fail，
    // 之后 rollback health 需要 pass —— 用计数切换。
    let calls = 0;
    const adapter2 = makeLocalAdapter({
      health: () => {
        calls += 1;
        // run#2：3 次失败；随后 rollback health 成功
        return calls <= 3 ? "fail" : "pass";
      },
    });
    const mgr2 = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: adapter2 },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 3,
      healthIntervalMs: 1,
    });
    const d2 = await mgr2.createDraft({ target_id: "local", commit_sha: sha2 });
    expect(d2.previous_live_release_id).toBe(first.release_id);
    const second = await mgr2.run(d2.release_id);
    expect(second.state).toBe("ROLLED_BACK");
    const prev = mgr2.get(first.release_id) as ReleaseRecord;
    expect(prev.state).toBe("LIVE");
    // 回滚阶段至少部署过旧版本一次
    expect(adapter2.deploys).toContain(first.release_id);
  });

  it("RO-03：探活失败且无上一 LIVE → FAILED", async () => {
    const adapter = makeLocalAdapter({ health: "fail" });
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: adapter },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 3,
      healthIntervalMs: 1,
    });
    const draft = await mgr.createDraft({
      target_id: "local",
      commit_sha: sha,
    });
    const failed = await mgr.run(draft.release_id);
    expect(failed.state).toBe("FAILED");
    expect(failed.previous_live_release_id).toBeNull();
  });
});
