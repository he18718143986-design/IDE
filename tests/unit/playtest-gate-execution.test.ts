/**
 * TASK-L.17f：门禁链 `check playtest` 执行债 —— 单元面。
 *
 * L17F-P1：C.23 位置参数经 resolvePlaytestCheckArgs 后可被 CLI 真执行（非缺 flag 空转）。
 * L17F-P2：无证据 / STALE / UNCONFIRMED → exitCode=1、passed 语义 Fail-Closed。
 * L17F-P3：非北极星合同 verification 不含 playtest（与 C.23 装配一致）。
 *
 * 纪律：零改 playtest-guard / withPlaytestCommand / bin/stagent；不宣称 e2e UI 闭环。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { runCheckCommand } from "../../bin/stagent";
import {
  createContractDraft,
  withPlaytestCommand,
} from "../../src/lib/contract.schema";
import {
  ensurePlaytestStagentView,
  isPlaytestCheckCommand,
  resolvePlaytestCheckArgs,
} from "../../daemon/supervisor/preview/resolve-playtest-check-args";
import { playtestEvidencePath } from "../../daemon/playtest/evidence";

const CONTRACT_ID = "ctr-l17f-unit";
const REL_LIVE = "rel-l17f-live-01";
const REF = "https://ref.example.com/northstar";

function writeContract(repo: string, references: string[]): void {
  const dir = path.join(repo, ".stagent", "contracts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${CONTRACT_ID}.json`),
    JSON.stringify({ contract_id: CONTRACT_ID, references }),
  );
}

function writeRelease(repo: string, releaseId: string, state: string): void {
  const dir = path.join(repo, ".stagent", "releases");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${releaseId}.json`),
    JSON.stringify({
      schema_version: "1.0.0",
      release_id: releaseId,
      target_id: "local",
      commit_sha: "bbbbbbb1",
      contract_ids: [CONTRACT_ID],
      state,
      previous_live_release_id: null,
      steps: [],
      created_at: "2026-11-07T00:00:00.000Z",
      triggered_by: "USER",
    }),
  );
}

function writeEvidence(repo: string, releaseId: string): void {
  const file = playtestEvidencePath(repo, CONTRACT_ID);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      schema_version: "1.0.0",
      contract_id: CONTRACT_ID,
      release_id: releaseId,
      user_verdict: "对照参考站试玩过了，认可完成",
      operator: "user",
      timestamp: "2026-11-07T01:00:00.000Z",
    }),
  );
}

describe("L17F-P1：playtest 非跳过执行（参数旁路）", () => {
  it("C.23 位置参数 → --contract-id + --repo（服务端合同号/仓根）", () => {
    const c23 = ["check", "playtest", "contract_forged"];
    const resolved = resolvePlaytestCheckArgs(c23, {
      contractId: CONTRACT_ID,
      repoRoot: "/tmp/repo-root",
    });
    expect(resolved).toEqual([
      "check",
      "playtest",
      "--contract-id",
      CONTRACT_ID,
      "--repo",
      path.resolve("/tmp/repo-root"),
    ]);
    // 防伪造：不保留调用方位置 contract_id
    expect(resolved).not.toContain("contract_forged");
  });

  it("幂等：已含旗标再解析 → 仍恰好一对 --contract-id / --repo", () => {
    const once = resolvePlaytestCheckArgs(
      ["check", "playtest", "--contract-id", "old", "--repo", "/old"],
      { contractId: CONTRACT_ID, repoRoot: "/new/root" },
    );
    const twice = resolvePlaytestCheckArgs(once, {
      contractId: CONTRACT_ID,
      repoRoot: "/new/root",
    });
    expect(twice.filter((t) => t === "--contract-id")).toHaveLength(1);
    expect(twice.filter((t) => t === "--repo")).toHaveLength(1);
    expect(twice).toEqual([
      "check",
      "playtest",
      "--contract-id",
      CONTRACT_ID,
      "--repo",
      path.resolve("/new/root"),
    ]);
  });

  it("isPlaytestCheckCommand 识别 alias 与 executable+args 双路径", () => {
    expect(
      isPlaytestCheckCommand({
        alias: "playtest",
        executable: "stagent",
        args: ["check", "playtest", "x"],
      }),
    ).toBe(true);
    expect(
      isPlaytestCheckCommand({
        alias: "other",
        executable: "stagent",
        args: ["check", "playtest", "x"],
      }),
    ).toBe(true);
    expect(
      isPlaytestCheckCommand({
        alias: "test",
        executable: "npm",
        args: ["test"],
      }),
    ).toBe(false);
  });

  it("裸位置参数跑 CLI → missing --contract-id；旁路后可真执行（非空转）", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17f-p1-"));
    try {
      writeContract(repo, [REF]);
      writeRelease(repo, REL_LIVE, "LIVE");
      // 无证据 → UNCONFIRMED，但证明「真进了 guard」，不是缺 flag
      const bare = runCheckCommand(["playtest", CONTRACT_ID]);
      expect(bare.exitCode).toBe(1);
      const bareBody = JSON.parse(bare.stdout) as { error?: string };
      expect(bareBody.error).toMatch(/missing --contract-id/);

      const args = resolvePlaytestCheckArgs(
        ["check", "playtest", CONTRACT_ID],
        { contractId: CONTRACT_ID, repoRoot: repo },
      );
      // runCheckCommand 吃的是 check 子命令之后的 argv（不含顶层 "check"）
      const checkArgv = args[0] === "check" ? args.slice(1) : args;
      const res = runCheckCommand(checkArgv);
      expect(res.exitCode).toBe(1);
      const body = JSON.parse(res.stdout) as {
        ok: boolean;
        status: string;
        code: string;
      };
      expect(body.ok).toBe(false);
      expect(body.status).toBe("UNCONFIRMED");
      expect(body.code).toBe("PLAYTEST_UNCONFIRMED");
    } finally {
      safeRmSync(repo);
    }
  });
});

describe("L17F-P1b：worktree 视图挂载（威胁边界内 --repo）", () => {
  it("ensurePlaytestStagentView 把 contracts/evidence/releases 链到仓根", () => {
    const repo = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagent-l17f-view-repo-"),
    );
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17f-view-wt-"));
    try {
      const srcContracts = path.join(repo, ".stagent", "contracts");
      fs.mkdirSync(srcContracts, { recursive: true });
      fs.writeFileSync(
        path.join(srcContracts, `${CONTRACT_ID}.json`),
        JSON.stringify({ contract_id: CONTRACT_ID, references: [REF] }),
      );
      ensurePlaytestStagentView(wt, repo);
      const linked = path.join(
        wt,
        ".stagent",
        "contracts",
        `${CONTRACT_ID}.json`,
      );
      expect(fs.existsSync(linked)).toBe(true);
      expect(
        fs.lstatSync(path.join(wt, ".stagent", "contracts")).isSymbolicLink(),
      ).toBe(true);
      // 经视图 + --repo=worktree 真执行到 guard
      writeRelease(repo, REL_LIVE, "LIVE");
      ensurePlaytestStagentView(wt, repo); // evidence/releases 目录亦挂上
      const args = resolvePlaytestCheckArgs(
        ["check", "playtest", CONTRACT_ID],
        {
          contractId: CONTRACT_ID,
          repoRoot: wt,
        },
      );
      const res = runCheckCommand(args.slice(1));
      expect(res.exitCode).toBe(1);
      const body = JSON.parse(res.stdout) as { status: string };
      expect(body.status).toBe("UNCONFIRMED");
    } finally {
      safeRmSync(repo);
      safeRmSync(wt);
    }
  });
});

describe("L17F-P2：无证据 Fail-Closed", () => {
  let repo = "";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17f-p2-"));
    writeContract(repo, [REF]);
    writeRelease(repo, REL_LIVE, "LIVE");
  });

  afterEach(() => {
    if (repo) safeRmSync(repo);
  });

  function runResolved() {
    const args = resolvePlaytestCheckArgs(["check", "playtest", CONTRACT_ID], {
      contractId: CONTRACT_ID,
      repoRoot: repo,
    });
    return runCheckCommand(args.slice(1));
  }

  it("无证据 → UNCONFIRMED、exitCode=1（不得合并通过）", () => {
    const res = runResolved();
    expect(res.exitCode).toBe(1);
    const body = JSON.parse(res.stdout) as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("UNCONFIRMED");
  });

  it("STALE_VERSION → exitCode=1", () => {
    writeEvidence(repo, "rel-OLD-STALE");
    const res = runResolved();
    expect(res.exitCode).toBe(1);
    const body = JSON.parse(res.stdout) as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("STALE_VERSION");
  });

  it("匹配 LIVE 证据 → exitCode=0 / APPROVED（证明旁路真执行到 guard）", () => {
    writeEvidence(repo, REL_LIVE);
    const res = runResolved();
    expect(res.exitCode).toBe(0);
    const body = JSON.parse(res.stdout) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("APPROVED");
  });
});

describe("L17F-P3：非北极星无 playtest", () => {
  it("createContractDraft 无 references → commands 不含 playtest", () => {
    const c = createContractDraft({
      title: "非北极星",
      description: "无参考站",
      acceptanceCriteria: ["x"],
      writablePaths: ["src/**"],
    });
    expect(
      c.verification_spec.commands.filter((x) => x.alias === "playtest"),
    ).toHaveLength(0);
  });

  it("references: [] → withPlaytestCommand(enabled=false) 剔除 playtest", () => {
    const cmds = withPlaytestCommand(
      [
        {
          alias: "playtest",
          executable: "stagent",
          args: ["check", "playtest", "x"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
        {
          alias: "test",
          executable: "npm",
          args: ["test"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ],
      "ctr-x",
      false,
    );
    expect(cmds.filter((c) => c.alias === "playtest")).toHaveLength(0);
    expect(cmds.map((c) => c.alias)).toEqual(["test"]);
  });

  it("北极星合同 → 恰含 1 条 playtest，且 args 为 C.23 位置形", () => {
    const c = createContractDraft({
      title: "北极星",
      description: "带参考站",
      acceptanceCriteria: ["一模一样"],
      writablePaths: ["src/**"],
      references: [REF],
    });
    const pts = c.verification_spec.commands.filter(
      (x) => x.alias === "playtest",
    );
    expect(pts).toHaveLength(1);
    expect(pts[0]!.args).toEqual(["check", "playtest", c.contract_id]);
  });
});
