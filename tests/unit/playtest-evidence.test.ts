/**
 * TASK-L.17b：结构化证据桩 —— 原话确认生成证据 / 无原话·伪造请求被服务端拒绝 / 原子写盘。
 *
 * dec-12 红线：AI/Worker 伪造用户认可 → FAIL。防线 = 服务端装配
 *（release_id/timestamp/operator）+ 原话必填；请求体携带装配字段即视为伪造并拒绝。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  E_EVIDENCE_FORGED_FIELD,
  E_EVIDENCE_VERDICT_REQUIRED,
  E_NO_ACTIVE_RELEASE,
  assembleAndStorePlaytestEvidence,
  evidenceDir,
  handlePlaytestEvidenceRequest,
  playtestEvidencePath,
  validatePlaytestEvidenceRequest,
} from "../../daemon/playtest/evidence";
import { playtestEvidenceSchema } from "../../src/lib/journey/playtest-evidence";
import { submitPlaytestEvidence } from "../../src/lib/journey/playtest-evidence";

const CONTRACT_ID = "ctr-playtest-1";
const LIVE_RELEASE_ID = "rel-20261102-01";
const LIVE_CREATED_AT = "2026-11-02T00:00:00.000Z";

function seedLiveRelease(repo: string): void {
  const dir = path.join(repo, ".stagent", "releases");
  fs.mkdirSync(dir, { recursive: true });
  const rec = {
    schema_version: "1.0.0",
    release_id: LIVE_RELEASE_ID,
    target_id: "local",
    commit_sha: "aaaaaaa1",
    contract_ids: [CONTRACT_ID],
    state: "LIVE",
    previous_live_release_id: null,
    steps: [],
    created_at: LIVE_CREATED_AT,
    triggered_by: "USER",
  };
  fs.writeFileSync(
    path.join(dir, `${LIVE_RELEASE_ID}.json`),
    JSON.stringify(rec, null, 2),
  );
}

describe("TASK-L.17b playtest-evidence", () => {
  let repo = "";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17b-ev-"));
    seedLiveRelease(repo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (repo) safeRmSync(repo);
  });

  it("原话确认 → 服务端装配生成结构化证据（release_id 来自当前 LIVE，非前端传值）", () => {
    const verdict = "我照着参考站点了一遍，一模一样，认可完成";
    const result = handlePlaytestEvidenceRequest(repo, {
      contract_id: CONTRACT_ID,
      user_verdict: verdict,
    });
    expect(result.status).toBe(201);
    const body = result.body as {
      ok: boolean;
      evidence: ReturnType<typeof playtestEvidenceSchema.parse>;
    };
    expect(body.ok).toBe(true);
    const ev = body.evidence;
    expect(ev.contract_id).toBe(CONTRACT_ID);
    expect(ev.user_verdict).toBe(verdict);
    expect(ev.operator).toBe("user");
    // release_id 由服务端从 Release Store 当前 LIVE 填入
    expect(ev.release_id).toBe(LIVE_RELEASE_ID);
    // 精确 ISO 时间戳
    expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // 落盘内容与 schema 自洽
    const onDisk = JSON.parse(
      fs.readFileSync(playtestEvidencePath(repo, CONTRACT_ID), "utf-8"),
    );
    expect(playtestEvidenceSchema.parse(onDisk)).toEqual(ev);
  });

  it("服务端装配字段不接受前端传值：伪造 release_id / timestamp / operator 被拒绝", () => {
    for (const field of ["release_id", "timestamp", "operator"] as const) {
      const result = handlePlaytestEvidenceRequest(repo, {
        contract_id: CONTRACT_ID,
        user_verdict: "认可完成",
        [field]: "FORGED-VALUE",
      });
      expect(result.status).toBe(400);
      expect((result.body as { code: string }).code).toBe(
        E_EVIDENCE_FORGED_FIELD,
      );
    }
    // 证据未被写入（拒绝在装配之前）
    expect(fs.existsSync(playtestEvidencePath(repo, CONTRACT_ID))).toBe(false);
  });

  it("无 user_verdict / 空原话被服务端拒绝（原话必填）", () => {
    const missing = handlePlaytestEvidenceRequest(repo, {
      contract_id: CONTRACT_ID,
    });
    expect(missing.status).toBe(400);
    expect((missing.body as { code: string }).code).toBe(
      E_EVIDENCE_VERDICT_REQUIRED,
    );

    const blank = handlePlaytestEvidenceRequest(repo, {
      contract_id: CONTRACT_ID,
      user_verdict: "   ",
    });
    expect(blank.status).toBe(400);
    expect((blank.body as { code: string }).code).toBe(
      E_EVIDENCE_VERDICT_REQUIRED,
    );

    // 纯校验函数也直接拒绝
    expect(() =>
      validatePlaytestEvidenceRequest({ contract_id: CONTRACT_ID }),
    ).toThrow();
  });

  it("无活跃 LIVE 版本 → 409，不得静默 PASS 或伪造 release_id", () => {
    // 移除 LIVE：把唯一发布标记为 SUPERSEDED
    const file = path.join(
      repo,
      ".stagent",
      "releases",
      `${LIVE_RELEASE_ID}.json`,
    );
    const rec = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
      string,
      unknown
    >;
    rec["state"] = "SUPERSEDED";
    fs.writeFileSync(file, JSON.stringify(rec));

    expect(() =>
      assembleAndStorePlaytestEvidence({
        repoRoot: repo,
        contract_id: CONTRACT_ID,
        user_verdict: "认可完成",
      }),
    ).toThrow();
    const result = handlePlaytestEvidenceRequest(repo, {
      contract_id: CONTRACT_ID,
      user_verdict: "认可完成",
    });
    expect(result.status).toBe(409);
    expect((result.body as { code: string }).code).toBe(E_NO_ACTIVE_RELEASE);
    expect(fs.existsSync(playtestEvidencePath(repo, CONTRACT_ID))).toBe(false);
  });

  it("原子落盘：临时文件 + rename，禁裸 writeFileSync(finalPath)", () => {
    const renameSpy = vi.spyOn(fs, "renameSync");
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    const result = handlePlaytestEvidenceRequest(repo, {
      contract_id: CONTRACT_ID,
      user_verdict: "点过了，认可完成",
    });
    expect(result.status).toBe(201);

    const finalPath = playtestEvidencePath(repo, CONTRACT_ID);
    // 命中 rename 覆盖最终证据路径
    expect(
      renameSpy.mock.calls.some(([, dest]) => String(dest) === finalPath),
    ).toBe(true);
    // 从未以「最终路径字符串」裸写（writeJsonAtomic 用 fd 写临时文件）
    expect(
      writeSpy.mock.calls.some(
        ([dest]) => typeof dest === "string" && dest === finalPath,
      ),
    ).toBe(false);
    // 目录内不留临时文件残留
    const leftovers = fs
      .readdirSync(evidenceDir(repo))
      .filter((n) => n.includes(".tmp"));
    expect(leftovers).toHaveLength(0);
    // 最终文件是完整合法证据
    expect(
      playtestEvidenceSchema.parse(
        JSON.parse(fs.readFileSync(finalPath, "utf-8")),
      ).operator,
    ).toBe("user");
  });

  it("客户端 submitPlaytestEvidence 只发 contract_id + user_verdict", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              ok: true,
              evidence: {
                schema_version: "1.0.0",
                contract_id: CONTRACT_ID,
                release_id: LIVE_RELEASE_ID,
                user_verdict: "认可完成",
                operator: "user",
                timestamp: LIVE_CREATED_AT,
              },
            }),
        };
      },
    );
    await submitPlaytestEvidence(
      { baseUrl: "http://127.0.0.1:3001", token: "abc123" },
      { contract_id: CONTRACT_ID, user_verdict: "认可完成" },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/playtest/evidence");
    const sent = JSON.parse(String(calls[0]!.init.body)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(sent).sort()).toEqual(["contract_id", "user_verdict"]);
    expect(sent).not.toHaveProperty("release_id");
    expect(sent).not.toHaveProperty("timestamp");
    expect(sent).not.toHaveProperty("operator");
  });

  it("客户端空原话在发请求前即拦下", async () => {
    await expect(
      submitPlaytestEvidence(
        { baseUrl: "http://127.0.0.1:3001", token: "abc123" },
        { contract_id: CONTRACT_ID, user_verdict: "   " },
      ),
    ).rejects.toThrow(/原话/);
  });
});

/** HTTP 层接线：证明路由真挂载、鉴权生效、服务端装配 / 拒绝在真实通道上成立 */
describe("TASK-L.17b POST /api/playtest/evidence HTTP 接线", () => {
  let repo = "";
  let daemon: StagentDaemon | null = null;
  let base = "";
  let token = "";

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l17b-http-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "l17b",
        private: true,
        scripts: { test: 'node -e "process.exit(0)"' },
      }),
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    seedLiveRelease(repo);
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4000,
      endPort: 4010,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    if (repo) safeRmSync(repo);
  });

  function authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      connection: "close",
    };
  }

  it("未鉴权 → 401；伪造字段 → 400（服务端拒绝）；有效原话 → 201 且 release_id 服务端装配", async () => {
    // 1) 无钥匙
    const noAuth = await fetch(`${base}/api/playtest/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contract_id: CONTRACT_ID,
        user_verdict: "认可完成",
      }),
    });
    expect(noAuth.status).toBe(401);

    // 2) 伪造服务端装配字段 → 显式拒绝，不落盘
    const forged = await fetch(`${base}/api/playtest/evidence`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        contract_id: CONTRACT_ID,
        user_verdict: "认可完成",
        release_id: "rel-FAKED-BY-CLIENT",
      }),
    });
    expect(forged.status).toBe(400);
    expect(
      ((await forged.json()) as { code: string }).code,
    ).toBe(E_EVIDENCE_FORGED_FIELD);
    expect(fs.existsSync(playtestEvidencePath(repo, CONTRACT_ID))).toBe(false);

    // 3) 空原话 → 拒绝
    const blank = await fetch(`${base}/api/playtest/evidence`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ contract_id: CONTRACT_ID, user_verdict: "  " }),
    });
    expect(blank.status).toBe(400);

    // 4) 有效原话 → 落盘，release_id 由服务端从 LIVE 填入
    const ok = await fetch(`${base}/api/playtest/evidence`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        contract_id: CONTRACT_ID,
        user_verdict: "我点过了，一模一样，认可完成",
      }),
    });
    expect(ok.status).toBe(201);
    const okBody = (await ok.json()) as {
      evidence: { release_id: string; operator: string };
    };
    expect(okBody.evidence.release_id).toBe(LIVE_RELEASE_ID);
    expect(okBody.evidence.operator).toBe("user");
    expect(fs.existsSync(playtestEvidencePath(repo, CONTRACT_ID))).toBe(true);
  });
});
