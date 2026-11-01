
/**
 * TASK-L.15：ReleaseManager R-INV-3 / R-INV-2（RO-04、RO-05）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import {
  ReleaseManager,
  listReleaseRecords,
} from "../../daemon/release/release-manager";
import { ReleaseInvariantError } from "../../src/lib/release/release";
import type {
  ReleaseTargetAdapter,
  StepResult,
} from "../../daemon/release/target-adapter";

function ok(argv: string[] = ["ok"]): StepResult {
  const t = new Date().toISOString();
  return {
    ok: true,
    exit_code: 0,
    argv,
    log_tail: "ok",
    started_at: t,
    ended_at: t,
  };
}

function mockAdapter(): ReleaseTargetAdapter {
  return {
    kind: "local_process",
    build: async () => ok(["build"]),
    deploy: async () => ok(["deploy"]),
    health: async () => ok(["health"]),
    stop: async () => ok(["stop"]),
  };
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

describe("TASK-L.15 release-manager RO-04/RO-05", () => {
  let repo = "";
  let sha = "";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l15-mgr-"));
    git(repo, ["init"]);
    git(repo, ["checkout", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "README.md"), "hi\n");
    git(repo, ["add", "."]);
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);
    sha = git(repo, ["rev-parse", "HEAD"]).trim();
    writeTargets(repo);
  });

  afterEach(() => {
    if (repo) safeRmSync(repo);
  });

  it("RO-04：非保护分支提交拒绝创建草稿（R-INV-3）", async () => {
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: mockAdapter() },
      isCommitOnProtectedBranch: () => false,
    });
    await expect(
      mgr.createDraft({ target_id: "local", commit_sha: sha }),
    ).rejects.toMatchObject({ code: "E_RELEASE_INV3" });
  });

  it("RO-05：同目标已有 DEPLOYING 时再发拒绝（R-INV-2）", async () => {
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: mockAdapter() },
      isCommitOnProtectedBranch: () => true,
      healthIntervalMs: 1,
      healthAttempts: 1,
    });
    const draft = await mgr.createDraft({
      target_id: "local",
      commit_sha: sha,
    });
    // 把草稿推进到 DEPLOYING，模拟进行中
    const stuck = { ...draft, state: "DEPLOYING" as const };
    fs.writeFileSync(
      path.join(repo, `.stagent/releases/${draft.release_id}.json`),
      JSON.stringify(stuck, null, 2),
    );
    await expect(
      mgr.createDraft({ target_id: "local", commit_sha: sha }),
    ).rejects.toMatchObject({ code: "E_RELEASE_INV2" });
    expect(listReleaseRecords(repo).some((r) => r.state === "DEPLOYING")).toBe(
      true,
    );
  });

  it("LIVE 存在时仍可开新草稿（R-INV-2 不含 LIVE）", async () => {
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: mockAdapter() },
      isCommitOnProtectedBranch: () => true,
      healthIntervalMs: 1,
      healthAttempts: 1,
    });
    const d1 = await mgr.createDraft({ target_id: "local", commit_sha: sha });
    const live = await mgr.run(d1.release_id);
    expect(live.state).toBe("LIVE");
    const d2 = await mgr.createDraft({ target_id: "local", commit_sha: sha });
    expect(d2.state).toBe("RELEASE_DRAFT");
    expect(d2.previous_live_release_id).toBe(live.release_id);
  });

  it("非法 SHA 抛 E_RELEASE_BAD_SHA", async () => {
    const mgr = new ReleaseManager({
      repoRoot: repo,
      isCommitOnProtectedBranch: () => true,
    });
    await expect(
      mgr.createDraft({ target_id: "local", commit_sha: "not-a-sha" }),
    ).rejects.toBeInstanceOf(ReleaseInvariantError);
  });
});
