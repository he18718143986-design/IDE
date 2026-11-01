
/**
 * TASK-L.15：user_command RO-06 / RO-07 / RO-09。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { ReleaseManager } from "../../daemon/release/release-manager";
import {
  createVault,
  MemoryVaultBackend,
} from "../../daemon/vault";
import type {
  ReleaseTargetAdapter,
  StepResult,
} from "../../daemon/release/target-adapter";

function stamp(argv: string[], okFlag: boolean, log: string): StepResult {
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

function initRepo(targets: unknown): { repo: string; sha: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l15-uc-"));
  git(repo, ["init"]);
  git(repo, ["checkout", "-b", "main"]);
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({
      name: "demo",
      scripts: { build: "echo build", deploy: "echo deploy" },
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
    "init",
  ]);
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".stagent/release-targets.json"),
    JSON.stringify({ targets }) + "\n",
  );
  return { repo, sha };
}

describe("TASK-L.15 release-user-command RO-06/07/09", () => {
  let repo = "";

  afterEach(() => {
    if (repo) safeRmSync(repo);
  });

  it("RO-06：env_keys 缺值 → 前置失败，白话列出缺失项，保持 DRAFT", async () => {
    ({ repo } = initRepo([
      {
        target_id: "prod",
        kind: "user_command",
        deploy_script: "deploy",
        health_argv: ["true"],
        env_keys: ["API_TOKEN", "DB_PASS"],
      },
    ]));
    const sha = git(repo, ["rev-parse", "HEAD"]).trim();
    const vault = await createVault({
      repoRoot: repo,
      backend: new MemoryVaultBackend(),
    });
    // 只设一个
    await vault.setSecret("API_TOKEN", "token-value-ok");

    const mgr = new ReleaseManager({
      repoRoot: repo,
      vault,
      adapters: {
        user_command: {
          kind: "user_command",
          build: async () => stamp(["build"], true, "ok"),
          deploy: async () => stamp(["deploy"], true, "ok"),
          health: async () => stamp(["health"], true, "ok"),
        },
      },
      isCommitOnProtectedBranch: () => true,
    });
    const draft = await mgr.createDraft({
      target_id: "prod",
      commit_sha: sha,
    });
    await expect(mgr.run(draft.release_id)).rejects.toMatchObject({
      code: "E_RELEASE_MISSING_SECRETS",
    });
    const still = mgr.get(draft.release_id)!;
    expect(still.state).toBe("RELEASE_DRAFT");
    await expect(mgr.run(draft.release_id)).rejects.toThrow(/DB_PASS/);
  });

  it("RO-07：部署日志打印保险库值 → log_tail 遮蔽为 [REDACTED]", async () => {
    ({ repo } = initRepo([
      {
        target_id: "prod",
        kind: "user_command",
        deploy_script: "deploy",
        health_argv: ["true"],
        env_keys: ["API_TOKEN"],
      },
    ]));
    const sha = git(repo, ["rev-parse", "HEAD"]).trim();
    const secret = "super-secret-token-xyz";
    const vault = await createVault({
      repoRoot: repo,
      backend: new MemoryVaultBackend(),
    });
    await vault.setSecret("API_TOKEN", secret);

    const adapter: ReleaseTargetAdapter = {
      kind: "user_command",
      build: async () => stamp(["build"], true, "build ok"),
      deploy: async (ctx) =>
        stamp(
          ["npm", "run", "deploy"],
          true,
          `deploying with ${ctx.env.API_TOKEN ?? secret}`,
        ),
      health: async () => stamp(["true"], true, "ok"),
    };
    const mgr = new ReleaseManager({
      repoRoot: repo,
      vault,
      adapters: { user_command: adapter },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 1,
      healthIntervalMs: 1,
    });
    const draft = await mgr.createDraft({
      target_id: "prod",
      commit_sha: sha,
    });
    const live = await mgr.run(draft.release_id);
    expect(live.state).toBe("LIVE");
    const deployStep = live.steps.find((s) => s.step === "deploy")!;
    expect(deployStep.log_tail).toContain("[REDACTED]");
    expect(deployStep.log_tail).not.toContain(secret);
  });

  it("RO-09：rollback_supported:false 且探活失败 → FAILED + 意外说明，不回滚", async () => {
    ({ repo } = initRepo([
      {
        target_id: "prod",
        kind: "user_command",
        deploy_script: "deploy",
        health_url: "http://127.0.0.1:9/",
        rollback_supported: false,
      },
    ]));
    const sha = git(repo, ["rev-parse", "HEAD"]).trim();

    // 先造一个 LIVE（同目标），再发失败的第二版
    const passAdapter: ReleaseTargetAdapter = {
      kind: "user_command",
      build: async () => stamp(["build"], true, "ok"),
      deploy: async () => stamp(["deploy"], true, "ok"),
      health: async () => stamp(["health"], true, "ok"),
    };
    const mgr1 = new ReleaseManager({
      repoRoot: repo,
      adapters: { user_command: passAdapter },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 1,
      healthIntervalMs: 1,
    });
    const d1 = await mgr1.createDraft({ target_id: "prod", commit_sha: sha });
    const first = await mgr1.run(d1.release_id);
    expect(first.state).toBe("LIVE");

    fs.writeFileSync(path.join(repo, "x.txt"), "2\n");
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

    let deployCount = 0;
    const failAdapter: ReleaseTargetAdapter = {
      kind: "user_command",
      build: async () => stamp(["build"], true, "ok"),
      deploy: async () => {
        deployCount += 1;
        return stamp(["deploy"], true, "ok");
      },
      health: async () => stamp(["health"], false, "HTTP 500"),
    };
    const mgr2 = new ReleaseManager({
      repoRoot: repo,
      adapters: { user_command: failAdapter },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 3,
      healthIntervalMs: 1,
    });
    const d2 = await mgr2.createDraft({ target_id: "prod", commit_sha: sha2 });
    const failed = await mgr2.run(d2.release_id);
    expect(failed.state).toBe("FAILED");
    expect(failed.incident ?? "").toMatch(/rollback_supported/);
    // 不应进入 ROLLING_BACK，也不应二次部署旧版
    expect(failed.steps.some((s) => s.step === "rollback")).toBe(false);
    expect(deployCount).toBe(1);
    expect(mgr2.get(first.release_id)!.state).toBe("LIVE");
  });
});
