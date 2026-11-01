/**
 * TASK-L.17b：跨版本重置 —— 核心用例：同 contract_id 不同 release_id → STALE。
 *
 * 强调「不只是文件不存在 → 未认可」：证据文件真实存在、内容完整，
 * 但 release_id 与当前 LIVE 不匹配时，必须判 STALE_VERSION 并重置认可，
 * 不得跨版本穿透。另覆盖 CLI `check playtest` 门禁委托。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { evaluatePlaytestGuard } from "../../daemon/supervisor/preview/playtest-guard";
import {
  handlePlaytestEvidenceRequest,
  playtestEvidencePath,
} from "../../daemon/playtest/evidence";
import { runCheckCommand } from "../../bin/stagent";

const CONTRACT_ID = "ctr-playtest-1";
const REL_A = "rel-20261101-01";
const REL_B = "rel-20261102-01";

function writeContract(repo: string, references: string[]): void {
  const dir = path.join(repo, ".stagent", "contracts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${CONTRACT_ID}.json`),
    JSON.stringify({ contract_id: CONTRACT_ID, references }),
  );
}

function writeRelease(
  repo: string,
  releaseId: string,
  state: string,
  createdAt: string,
  contractIds: string[] = [CONTRACT_ID],
): void {
  const dir = path.join(repo, ".stagent", "releases");
  fs.mkdirSync(dir, { recursive: true });
  const rec = {
    schema_version: "1.0.0",
    release_id: releaseId,
    target_id: "local",
    commit_sha: "aaaaaaa1",
    contract_ids: contractIds,
    state,
    previous_live_release_id: null,
    steps: [],
    created_at: createdAt,
    triggered_by: "USER",
  };
  fs.writeFileSync(
    path.join(dir, `${releaseId}.json`),
    JSON.stringify(rec, null, 2),
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
      user_verdict: "我对照参考站点过了，认可完成",
      operator: "user",
      timestamp: "2026-11-02T01:00:00.000Z",
    }),
  );
}

describe("TASK-L.17b playtest-reset 跨版本重置", () => {
  let repo = "";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17b-rst-"));
    writeContract(repo, ["https://ref.example.com"]);
    writeRelease(repo, REL_A, "LIVE", "2026-11-01T00:00:00.000Z");
  });

  afterEach(() => {
    if (repo) safeRmSync(repo);
  });

  it("文件不存在 → 未认可（UNCONFIRMED），不是 PASS", () => {
    const v = evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID });
    expect(v.ok).toBe(false);
    expect(v.status).toBe("UNCONFIRMED");
  });

  it("核心：同 contract_id 不同 release_id → STALE_VERSION 并重置认可", () => {
    // 证据文件真实存在、完整，但绑的是旧/外部版本，与当前 LIVE(REL_A) 不同
    writeEvidence(repo, "rel-FOREIGN-OLD");
    const v = evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID });
    expect(v.ok).toBe(false);
    expect(v.status).toBe("STALE_VERSION");
    expect(v.code).toBe("STALE_VERSION");
    expect(v.reset_approval).toBe(true);
    expect(v.evidence_release_id).toBe("rel-FOREIGN-OLD");
    expect(v.current_release_id).toBe(REL_A);
  });

  it("版本匹配 → 认可有效（APPROVED / PASS）", () => {
    writeEvidence(repo, REL_A);
    const v = evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID });
    expect(v.ok).toBe(true);
    expect(v.status).toBe("APPROVED");
    expect(v.reset_approval).toBe(false);
  });

  it("微合同 / 新部署导致 LIVE 变更 → 旧认可即刻失效，不跨版本穿透", () => {
    // 先对 REL_A 提交认可（服务端装配 release_id = REL_A）
    const submit = handlePlaytestEvidenceRequest(repo, {
      contract_id: CONTRACT_ID,
      user_verdict: "认可完成",
    });
    expect(submit.status).toBe(201);
    expect(
      evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID }).status,
    ).toBe("APPROVED");

    // 新部署：REL_A → SUPERSEDED，REL_B → LIVE（版本指纹变更）
    writeRelease(repo, REL_A, "SUPERSEDED", "2026-11-01T00:00:00.000Z");
    writeRelease(repo, REL_B, "LIVE", "2026-11-02T00:00:00.000Z");

    const v = evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID });
    expect(v.ok).toBe(false);
    expect(v.status).toBe("STALE_VERSION");
    expect(v.evidence_release_id).toBe(REL_A);
    expect(v.current_release_id).toBe(REL_B);
    expect(v.reset_approval).toBe(true);
  });

  it("合同无 references[] / 非北极星场景 → 明确错误码，绝不静默 PASS", () => {
    // 覆盖为无 references 的合同
    writeContract(repo, []);
    const v = evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID });
    expect(v.ok).toBe(false);
    expect(v.status).toBe("NOT_NORTHSTAR_SCENARIO");
    expect(v.code).toBe("NOT_NORTHSTAR_SCENARIO");
  });

  it("合同不存在 → 明确错误码 CONTRACT_NOT_FOUND", () => {
    const v = evaluatePlaytestGuard({
      repoRoot: repo,
      contractId: "ctr-does-not-exist",
    });
    expect(v.ok).toBe(false);
    expect(v.status).toBe("CONTRACT_NOT_FOUND");
  });

  it("证据不完整 / 格式非法 → EVIDENCE_INVALID", () => {
    const file = playtestEvidencePath(repo, CONTRACT_ID);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ contract_id: CONTRACT_ID }));
    const v = evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID });
    expect(v.ok).toBe(false);
    expect(v.status).toBe("EVIDENCE_INVALID");
  });

  it("证据 contract_id 串用 → 完整性校验失败 EVIDENCE_INVALID", () => {
    const file = playtestEvidencePath(repo, CONTRACT_ID);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        schema_version: "1.0.0",
        contract_id: "ctr-other",
        release_id: REL_A,
        user_verdict: "认可完成",
        operator: "user",
        timestamp: "2026-11-02T01:00:00.000Z",
      }),
    );
    const v = evaluatePlaytestGuard({ repoRoot: repo, contractId: CONTRACT_ID });
    expect(v.ok).toBe(false);
    expect(v.status).toBe("EVIDENCE_INVALID");
  });
});

describe("TASK-L.17b check playtest CLI 门禁委托", () => {
  let repo = "";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17b-cli-"));
    writeContract(repo, ["https://ref.example.com"]);
    writeRelease(repo, REL_A, "LIVE", "2026-11-01T00:00:00.000Z");
  });

  afterEach(() => {
    if (repo) safeRmSync(repo);
  });

  it("STALE 场景 → 退出码 1 + code STALE_VERSION", () => {
    writeEvidence(repo, "rel-FOREIGN-OLD");
    const res = runCheckCommand([
      "playtest",
      "--contract-id",
      CONTRACT_ID,
      "--repo",
      repo,
    ]);
    const out = JSON.parse(res.stdout) as {
      ok: boolean;
      code: string;
      reset_approval: boolean;
    };
    expect(res.exitCode).toBe(1);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("STALE_VERSION");
    expect(out.reset_approval).toBe(true);
  });

  it("APPROVED 场景 → 退出码 0 + code PLAYTEST_APPROVED", () => {
    writeEvidence(repo, REL_A);
    const res = runCheckCommand([
      "playtest",
      "--contract-id",
      CONTRACT_ID,
      "--repo",
      repo,
    ]);
    const out = JSON.parse(res.stdout) as { ok: boolean; code: string };
    expect(res.exitCode).toBe(0);
    expect(out.ok).toBe(true);
    expect(out.code).toBe("PLAYTEST_APPROVED");
  });

  it("缺 --contract-id → 明确报错，不静默", () => {
    const res = runCheckCommand(["playtest", "--repo", repo]);
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout) as { error: string }).toHaveProperty(
      "error",
    );
  });
});
