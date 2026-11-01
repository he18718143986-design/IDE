/**
 * TASK-L.16 / RO-10：LIVE 崩溃 → 线上卡路径；「让 AI 看看」插 origin:system 桩。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { ReleaseManager } from "../../daemon/release/release-manager";
import { writePlan, readPlan } from "../../daemon/project/plan-store";
import { nextStub } from "../../src/lib/project/next-stub";
import type { ContractStub, ProjectPlan } from "../../src/lib/project/project-plan";
import type {
  ReleaseTargetAdapter,
  StepResult,
} from "../../daemon/release/target-adapter";
import {
  setLiveProcess,
  resetLiveProcessRegistry,
  getLiveProcess,
} from "../../daemon/release/process-registry";
import type { ManagedProcess } from "../../daemon/worker/cli-host/process-host";
import { createVault } from "../../daemon/vault";

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

function mockAdapter(): ReleaseTargetAdapter {
  return {
    kind: "local_process",
    build: async () => stamp(["build"], true),
    deploy: async () => stamp(["deploy"], true, "started"),
    health: async () => stamp(["health"], true, "HTTP 200"),
    stop: async () => stamp(["stop"], true),
  };
}

function seedPlan(repo: string): ProjectPlan {
  const feature: ContractStub = {
    stub_id: "cs-1",
    milestone_id: "ms-1",
    kind: "feature",
    origin: "scheme",
    title: "做功能",
    scheme_item_ids: ["g-1", "m-1"],
    acceptance_ids: ["ac-1"],
    area_hints: ["src/app"],
    depends_on: [],
    size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
    status: "planned",
    contract_id: null,
  };
  const plan: ProjectPlan = {
    schema_version: "1.0.0",
    project_id: "proj-l16",
    plan_revision: 1,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "digest-1",
    },
    scheme_id: "S-l16",
    scheme_revision: 1,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "第一期",
        exit_acceptance_ids: ["ac-1"],
        contract_ids: ["cs-1"],
      },
    ],
    contracts: [feature],
    graveyard: [],
  };
  writePlan(repo, plan);
  return plan;
}

describe("TASK-L.16 live incident RO-10", () => {
  let repo = "";
  let sha = "";
  let daemon: StagentDaemon | null = null;

  beforeEach(() => {
    resetLiveProcessRegistry();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l16-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "l16",
        private: true,
        scripts: { test: "node -e \"process.exit(0)\"" },
      }),
      "utf8",
    );
    fs.mkdirSync(path.join(repo, "docs", "system"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "docs", "system", "modules.yaml"),
      "modules: []\n",
      "utf8",
    );
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".stagent/release-targets.json"),
      JSON.stringify({
        targets: [
          {
            target_id: "local",
            label: "本机",
            kind: "local_process",
            port: 4300,
            health_path: "/",
          },
        ],
      }) + "\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    sha = git(repo, ["rev-parse", "HEAD"]).trim();
    seedPlan(repo);
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    resetLiveProcessRegistry();
    if (repo) safeRmSync(repo);
  });

  it("RO-10：LIVE 崩溃 → live_incident；让 AI 看看 → nextStub 里程碑最前 system 桩", async () => {
    const vault = await createVault({ repoRoot: repo, backend: "memory" });
    await vault.setSecret("api_token", "super-secret-token-xyz");
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: mockAdapter() },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 1,
      watchIntervalMs: 60_000,
      vault,
    });

    const draft = await mgr.createDraft({ target_id: "local", commit_sha: sha });
    const live = await mgr.run(draft.release_id);
    expect(live.state).toBe("LIVE");

    // 模拟进程崩溃（脱敏：密钥不得明文出现在 log_tail）
    const secret = "super-secret-token-xyz";
    const crashed = await mgr.recordLiveIncident({
      release_id: live.release_id,
      reason: "process_exit",
      log_tail: `Error: boom\nAuthorization: Bearer ${secret}\nstack`,
      exit_code: 1,
      transitionToFailed: true,
    });

    expect(crashed.state).toBe("FAILED");
    expect(crashed.live_incident).toBeTruthy();
    expect(crashed.live_incident!.target_label).toBe("本机");
    expect(crashed.live_incident!.release_id).toBe(live.release_id);
    expect(crashed.live_incident!.log_tail).not.toContain(secret);
    expect(crashed.live_incident!.log_tail).toMatch(/REDACTED|boom/);
    expect(mgr.listOpenIncidents().map((r) => r.release_id)).toEqual([
      live.release_id,
    ]);

    const beforeNext = nextStub(readPlan(repo)!)!;
    expect(beforeNext.stub_id).toBe("cs-1");

    const asked = await mgr.askAiForIncident(live.release_id);
    expect(asked.stub_id).toBe(`cs-incident-${live.release_id}`);
    expect(asked.release.live_incident?.stub_created).toBe(true);

    const plan = readPlan(repo)!;
    const ms = plan.milestones.find((m) => m.milestone_id === "ms-1")!;
    expect(ms.contract_ids[0]).toBe(asked.stub_id);

    const stub = plan.contracts.find((c) => c.stub_id === asked.stub_id)!;
    expect(stub.origin).toBe("system");
    expect(stub.kind).toBe("feature");
    expect(stub.context?.release_id).toBe(live.release_id);
    expect(stub.context?.commit_sha).toBe(sha);
    expect(stub.acceptance_ids).toEqual(["sys-acc-incident"]);

    const afterNext = nextStub(plan)!;
    expect(afterNext.stub_id).toBe(asked.stub_id);

    const cs1 = plan.contracts.find((c) => c.stub_id === "cs-1")!;
    expect(cs1.depends_on).toContain(asked.stub_id);
    // 未改 MERGED（本夹具无 merged 桩；status 仍 planned）
    expect(cs1.status).toBe("planned");
    expect(mgr.listOpenIncidents()).toHaveLength(0);

    mgr.stopAllWatches();
  });

  it("RO-10 HTTP：ask-ai 接线；进程退出监听命中 stopping=false", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3730,
      endPort: 3740,
      enableCrashRecovery: false,
    });
    // 注入 manager 之前先用公开 API：先本机 ReleaseManager 写好 LIVE+incident
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: { local_process: mockAdapter() },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 1,
    });
    const draft = await mgr.createDraft({ target_id: "local", commit_sha: sha });
    const live = await mgr.run(draft.release_id);
    await mgr.recordLiveIncident({
      release_id: live.release_id,
      reason: "process_exit",
      log_tail: "segfault",
      exit_code: 139,
      transitionToFailed: true,
    });
    mgr.stopAllWatches();

    const info = await daemon.start();
    const base = `http://127.0.0.1:${info.port}`;
    const token = daemon.getSessionToken() ?? "";
    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      connection: "close",
    };

    const listRes = await fetch(`${base}/api/releases/incidents`, {
      headers: auth,
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      releases: Array<{ release_id: string }>;
    };
    expect(listJson.releases.map((r) => r.release_id)).toContain(
      live.release_id,
    );

    const askRes = await fetch(
      `${base}/api/releases/${encodeURIComponent(live.release_id)}/ask-ai`,
      { method: "POST", headers: auth, body: "{}" },
    );
    expect(askRes.status).toBe(200);
    const askJson = (await askRes.json()) as {
      stub_id: string;
      plan: ProjectPlan;
    };
    expect(askJson.stub_id).toBe(`cs-incident-${live.release_id}`);
    const stub = askJson.plan.contracts.find((c) => c.stub_id === askJson.stub_id)!;
    expect(stub.origin).toBe("system");
    expect(stub.context?.release_id).toBe(live.release_id);
  });

  it("进程退出监听：非 stopping 时写入 live_incident", async () => {
    let resolveExit!: (v: { code: number | null; signal: null }) => void;
    const exited = new Promise<{ code: number | null; signal: null }>((r) => {
      resolveExit = r;
    });
    const fakeProc: ManagedProcess = {
      pid: 4242,
      lines: (async function* () {})(),
      exited,
      stderr: () => "fatal: SECRET_VALUE_123456 crashed",
      stop: async () => ({ via: "exit", ms: 0 }),
    };

    const vault = await createVault({ repoRoot: repo, backend: "memory" });
    await vault.setSecret("crash_token", "SECRET_VALUE_123456");
    const mgr = new ReleaseManager({
      repoRoot: repo,
      adapters: {
        local_process: {
          ...mockAdapter(),
          deploy: async (ctx) => {
            setLiveProcess({
              release_id: ctx.release.release_id,
              target_id: ctx.target.target_id,
              checkout_dir: ctx.checkoutDir,
              process: fakeProc,
              port: 4300,
            });
            return stamp(["npm", "run", "start"], true, "started");
          },
        },
      },
      isCommitOnProtectedBranch: () => true,
      healthAttempts: 1,
      // 关闭周期探活干扰
      watchIntervalMs: 60_000 * 60,
      vault,
    });

    const draft = await mgr.createDraft({ target_id: "local", commit_sha: sha });
    const live = await mgr.run(draft.release_id);
    expect(live.state).toBe("LIVE");
    expect(getLiveProcess("local")?.process).toBe(fakeProc);

    resolveExit({ code: 1, signal: null });
    // 等退出监听落盘
    await new Promise((r) => setTimeout(r, 80));
    const after = mgr.get(live.release_id)!;
    expect(after.live_incident).toBeTruthy();
    expect(after.live_incident!.reason).toBe("process_exit");
    expect(after.live_incident!.log_tail).not.toContain("SECRET_VALUE_123456");
    expect(after.state).toBe("FAILED");
    mgr.stopAllWatches();
  });
});
