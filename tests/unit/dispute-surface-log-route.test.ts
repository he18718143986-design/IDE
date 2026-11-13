/**
 * TASK-J.16 / GAP-P8（接线的服务端部分）：
 * - `parseSurfacePresentationRequest` 拒绝非法请求体（路径穿越、未知 section、超量条目）；
 * - `POST /api/supervisor/surface-log` 沿既有 Bearer 鉴权，只追加到 `.stagent/records/surface-log/`；
 * - 空的 shown 不建文件；日志能被 `readSurfaceLog` 原样读回。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import {
  emptyLedgerState,
  emptySchemeDraftV2,
  schemeLedgerPath,
} from "../../daemon/supervisor/intent-compiler/scheme-ledger-store";
import {
  parseSurfacePresentationRequest,
  readSurfaceLog,
  surfaceLogPath,
  SURFACE_PRESENTATION_MAX_ITEMS,
} from "../../daemon/supervisor/dispute/surface-log";
import { writeSchemeSnapshot } from "../../daemon/pipeline/scheme-snapshot-store";
import type { DemoGate, SchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ScopePlan } from "../../src/lib/journey/scope-plan";

const VALID = {
  confirmation_id: "scheme-confirm-route1",
  plain_text_version: "scope-acceptance-v1",
  presented_at: "2026-11-11T04:00:00.000Z",
  phase: "pre_confirm",
  shown: [
    { item_ref: "prot-0", section: "approval" },
    { item_ref: "area-0", section: "area" },
  ],
};

/**
 * 端口就绪等待：用原始 TCP 探测（不走 fetch，避免 undici 连接池复用上一个 daemon 的旧 socket）。
 * 只在需要的用例里调用，不改其它用例的时序。
 */
function waitForPort(port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not ready`));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

describe("parseSurfacePresentationRequest", () => {
  it("接受合法请求体", () => {
    const r = parseSurfacePresentationRequest(VALID);
    expect(r.ok).toBe(true);
  });

  it("拒绝路径穿越式的 confirmation_id", () => {
    const r = parseSurfacePresentationRequest({
      ...VALID,
      confirmation_id: "../../etc/passwd",
    });
    expect(r.ok).toBe(false);
  });

  it("拒绝闭集外的 section 与非法时间", () => {
    expect(
      parseSurfacePresentationRequest({
        ...VALID,
        shown: [{ item_ref: "x", section: "model_guess" }],
      }).ok,
    ).toBe(false);
    expect(
      parseSurfacePresentationRequest({ ...VALID, presented_at: "not-a-time" })
        .ok,
    ).toBe(false);
  });

  it("拒绝超量条目与非对象体", () => {
    const many = Array.from(
      { length: SURFACE_PRESENTATION_MAX_ITEMS + 1 },
      (_, i) => ({
        item_ref: `r-${i}`,
        section: "area",
      }),
    );
    expect(parseSurfacePresentationRequest({ ...VALID, shown: many }).ok).toBe(
      false,
    );
    expect(parseSurfacePresentationRequest("text").ok).toBe(false);
  });

  it("P-201：phase 必填且只接受 pre_confirm / post_confirm", () => {
    const { phase: _omit, ...withoutPhase } = VALID;
    expect(parseSurfacePresentationRequest(withoutPhase).ok).toBe(false);
    expect(
      parseSurfacePresentationRequest({ ...VALID, phase: "at_freeze" }).ok,
    ).toBe(false);
    const post = parseSurfacePresentationRequest({
      ...VALID,
      phase: "post_confirm",
    });
    expect(post.ok && post.value.phase).toBe("post_confirm");
  });
});

describe("POST /api/supervisor/surface-log", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-surface-log-"));
    daemon = createDaemon({
      repoRoot: repo,
      // 端口段登记：与其余套件不重叠（见 tests/unit/test-port-map.test.ts）
      startPort: 4790,
      endPort: 4799,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    // Windows 上 daemon 刚停止时句柄可能未释放：走仓库统一的瞬时错误重试
    safeRmSync(repo);
  });

  const post = (body: unknown, auth: string | null = `Bearer ${token}`) =>
    fetch(`${base}/api/supervisor/surface-log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
      },
      body: JSON.stringify(body),
    });

  it("无 Bearer 鉴权返回 401，且不写任何文件", async () => {
    const res = await post(VALID, null);
    expect(res.status).toBe(401);
    expect(fs.existsSync(surfaceLogPath(repo, VALID.confirmation_id))).toBe(
      false,
    );
  });

  it("非法请求体返回 400，且不写任何文件", async () => {
    const res = await post({ ...VALID, confirmation_id: "../x" });
    expect(res.status).toBe(400);
    // daemon 启动时会建 .stagent 目录；这里断言的是日志子目录未被创建
    expect(
      fs.existsSync(path.join(repo, ".stagent", "records", "surface-log")),
    ).toBe(false);
  });

  it("合法请求只追加真实呈现的条目，并可被 readSurfaceLog 读回", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      written: 2,
      confirmation_id: VALID.confirmation_id,
    });
    const entries = readSurfaceLog(repo, VALID.confirmation_id);
    expect(entries?.map((e) => e.item_ref)).toEqual(["prot-0", "area-0"]);
    expect(entries?.every((e) => e.presented_at === VALID.presented_at)).toBe(
      true,
    );

    // 追加语义：第二次上报不覆盖第一次
    await post({ ...VALID, shown: [{ item_ref: "area-0", section: "area" }] });
    expect(readSurfaceLog(repo, VALID.confirmation_id)?.length).toBe(3);
  });

  it("shown 为空时返回 0 条且不建日志文件", async () => {
    await waitForPort(Number(new URL(base).port));
    const res = await post({ ...VALID, shown: [] });
    expect(res.status).toBe(200);
    expect((await res.json()).written).toBe(0);
    expect(fs.existsSync(surfaceLogPath(repo, VALID.confirmation_id))).toBe(
      false,
    );
  });

  it("GET 返回 405", async () => {
    const res = await fetch(`${base}/api/supervisor/surface-log`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(405);
  });

  it("phase：确认后上报带 post_confirm，冒充 pre_confirm 被拒", async () => {
    const confirmedAt = "2026-11-11T05:00:00.000Z";
    writeSchemeSnapshot(repo, {
      confirmation_id: VALID.confirmation_id,
      scheme: {
        scheme_id: "scheme-route",
        scheme_revision: 1,
        frozen: true,
      } as unknown as SchemeDraft,
      demo: {
        status: "none",
        scheme_revision: null,
        decision_revision: null,
      } as DemoGate,
      decision: { code: "OK", message: "ok", demo_mode: "none" },
      scope_plan: { plan_digest: "p".repeat(64) } as unknown as ScopePlan,
      now: () => new Date(confirmedAt),
    });
    const after = "2026-11-11T05:00:00.096Z";

    const fake = await post({
      ...VALID,
      presented_at: after,
      phase: "pre_confirm",
    });
    expect(fake.status).toBe(409);
    expect((await fake.json()).error).toBe("surface_log_phase_mismatch");
    expect(fs.existsSync(surfaceLogPath(repo, VALID.confirmation_id))).toBe(
      false,
    );

    const before = await post({
      ...VALID,
      presented_at: "2026-11-11T04:59:59.000Z",
      phase: "pre_confirm",
    });
    expect(before.status).toBe(200);

    const real = await post({
      ...VALID,
      presented_at: after,
      phase: "post_confirm",
      shown: [{ item_ref: "area-0", section: "area" }],
    });
    expect(real.status).toBe(200);
    const entries = readSurfaceLog(repo, VALID.confirmation_id) ?? [];
    expect(entries.map((e) => e.phase)).toEqual([
      "pre_confirm",
      "pre_confirm",
      "post_confirm",
    ]);

    const unconfirmed = await post({
      ...VALID,
      confirmation_id: "scheme-confirm-route2",
      phase: "post_confirm",
    });
    expect(unconfirmed.status).toBe(409);
  });
  it("GET /api/supervisor/scheme-acceptance：沿 Bearer 鉴权；无台账返回空投影；有台账只读投影且不写盘", async () => {
    const url = `${base}/api/supervisor/scheme-acceptance`;
    const auth = { authorization: `Bearer ${token}` };
    const empty = await fetch(url, { headers: auth });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      scheme_id: null,
      scheme_revision: null,
      items: [],
    });

    const file = schemeLedgerPath(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const acceptance: SchemeDraftV2["acceptance"] = [
      {
        id: "ITEM-1",
        text: "首页显示逾期数",
        source: "user_said",
        evidence: [],
        user_pinned: false,
        updated_in_revision: 1,
      },
    ];
    fs.writeFileSync(
      file,
      JSON.stringify({
        schema_version: "1.0",
        updated_at: "2026-11-11T00:00:00.000Z",
        state: emptyLedgerState({
          draft: emptySchemeDraftV2({
            scheme_id: "scheme-r",
            scheme_revision: 2,
            acceptance,
          }),
        }),
        last_journal: null,
        last_model_id: null,
        last_prompt_version: null,
        offline: true,
      }),
    );
    const before = fs.readFileSync(file, "utf8");
    const res = await fetch(url, { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scheme_id: "scheme-r",
      scheme_revision: 2,
      items: [{ id: "ITEM-1", text: "首页显示逾期数" }],
    });
    expect(fs.readFileSync(file, "utf8")).toBe(before);

    const unauth = await fetch(url);
    expect(unauth.status).toBe(401);
  });
});
