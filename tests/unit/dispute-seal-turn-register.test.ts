/**
 * TASK-J.16 · J16-P5（P-201）：说话时登记原话，冻结时只认已登记的原话。
 * - POST /api/supervisor/turns：Daemon 生成 turn_id，按 sha256(utf8) 落盘 transcript；
 * - POST /api/supervisor/scheme/freeze：原话清单校验失败 409，不写快照；
 * - POST /api/supervisor/journey：带已登记 turn 时核对一致才复用，不重复登记。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { readTranscript } from "../../daemon/supervisor/intent-compiler/transcript-store";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import { git } from "../helpers/git";
import { safeRmSync } from "../helpers/tmp";

interface Body {
  error?: string;
  code?: string;
  reason?: string;
  message?: string;
  turn_id?: string;
  seq?: number;
  turn_text_sha256?: string;
  frozen_quotes_count?: number;
  trust_tier?: string;
  item_quote_backlink_covered_count?: number;
  item_quote_backlink_uncovered_count?: number;
}

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("P-201 原话登记与冻结校验（真 Daemon）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-seal-register-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    daemon = createDaemon({
      repoRoot: repo,
      // 端口段登记：与其余套件不重叠（见 tests/unit/test-port-map.test.ts）
      startPort: 4850,
      endPort: 4859,
      enableCrashRecovery: false,
      // 编译循环只登记不触发，避免停服后定时器还在跑
      intentCompilerSetTimeout: () => 0,
      intentCompilerClearTimeout: () => undefined,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    try {
      if (daemon?.isRunning) await daemon.stop();
    } catch {
      /* 停服失败不掩盖断言失败 */
    }
    daemon = null;
    try {
      safeRmSync(repo);
    } catch {
      /* 临时目录残留不影响断言 */
    }
  });

  async function call(
    method: string,
    pathname: string,
    body?: unknown,
    auth = true,
  ): Promise<{ status: number; body: Body }> {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        "content-type": "application/json",
        connection: "close",
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text.length > 0 ? JSON.parse(text) : {}) as Body,
    };
  }

  function makeScheme(): SchemeDraft {
    return emptySchemeDraft({
      title: "工程项目进度管控台",
      summary: "按项目维度汇总进度与预算",
      modules: ["工程进度管控"],
      mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
      business_input_rounds: 1,
      scheme_revision: 2,
      acceptance: [
        {
          id: "ac-1",
          text: "页面能打开并看到进度数字",
          check: "playtest",
        },
      ],
    });
  }

  function freezeBody(confirmationId: string, sourceTurns?: unknown) {
    const scheme = makeScheme();
    return {
      confirmation_id: confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "按静态方案签署", demo_mode: "none" },
      scope_plan: buildScopePlan({ repoRoot: repo, scheme }),
      ...(sourceTurns === undefined ? {} : { source_turns: sourceTurns }),
    };
  }

  const snapshotFile = (confirmationId: string) =>
    path.join(repo, ".stagent", "drafts", "schemes", `${confirmationId}.json`);

  it("登记返回 turn_id 与 sha256(utf8)", async () => {
    const res = await call("POST", "/api/supervisor/turns", {
      text: "  首页要显示本月逾期项目数  ",
    });
    expect(res.status).toBe(201);
    const text = "首页要显示本月逾期项目数";
    expect(res.body).toEqual({
      turn_id: "T1",
      seq: 1,
      turn_text_sha256: sha256Utf8(text),
    });
    const turn = readTranscript(repo)?.turns.find((t) => t.turn_id === "T1");
    expect(turn).toMatchObject({ role: "user", text });
    expect(turn?.text_sha256).toBe(sha256Utf8(text));

    expect(
      (await call("POST", "/api/supervisor/turns", { text: "   " })).body.error,
    ).toBe("turn_text_required");
    const tooLong = await call("POST", "/api/supervisor/turns", {
      text: "长".repeat(4001),
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe("turn_text_too_long");
    expect(
      (await call("POST", "/api/supervisor/turns", { text: "x" }, false))
        .status,
    ).toBe(401);
    expect((await call("GET", "/api/supervisor/turns")).status).toBe(405);
  });

  it("冻结原话清单校验失败 409 且不写快照", async () => {
    const registered = await call("POST", "/api/supervisor/turns", {
      text: "按项目维度汇总进度与预算",
    });
    const turnId = registered.body.turn_id!;
    const sha = registered.body.turn_text_sha256!;

    const cases: Array<{ id: string; turns: unknown; reason: string }> = [
      {
        id: "scheme-confirm-seal-missing",
        turns: undefined,
        reason: "quotes_missing",
      },
      { id: "scheme-confirm-seal-empty", turns: [], reason: "quotes_empty" },
      {
        id: "scheme-confirm-seal-forged",
        turns: [
          { turn_id: turnId, turn_text_sha256: sha256Utf8("被改过的需求") },
        ],
        reason: "turn_hash_mismatch",
      },
      {
        id: "scheme-confirm-seal-unknown",
        turns: [{ turn_id: "T99", turn_text_sha256: sha }],
        reason: "turn_not_found",
      },
    ];
    for (const c of cases) {
      const res = await call(
        "POST",
        "/api/supervisor/scheme/freeze",
        freezeBody(c.id, c.turns),
      );
      expect(res.status, c.id).toBe(409);
      expect(res.body.code).toBe("E_SCHEME_SNAPSHOT_MISMATCH");
      expect(res.body.reason).toBe(c.reason);
      expect(res.body.message).toMatch(/没有冻结|不能冻结/);
      expect(fs.existsSync(snapshotFile(c.id))).toBe(false);
    }

    const ok = await call(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezeBody("scheme-confirm-seal-ok", [
        { turn_id: turnId, turn_text_sha256: sha },
      ]),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.frozen_quotes_count).toBe(1);
    expect(ok.body.trust_tier).toBe("standard");
    expect(ok.body.item_quote_backlink_covered_count).toBe(0);
    expect(ok.body.item_quote_backlink_uncovered_count).toBe(0);
    const snapshot = JSON.parse(
      fs.readFileSync(snapshotFile("scheme-confirm-seal-ok"), "utf8"),
    ) as {
      trust_tier?: string;
      frozen_quotes: {
        quotes: Array<{ text: string; turn_text_sha256: string }>;
      };
    };
    expect(snapshot.trust_tier).toBe("standard");
    expect(snapshot.frozen_quotes.quotes).toEqual([
      expect.objectContaining({
        turn_id: turnId,
        text: "按项目维度汇总进度与预算",
        turn_text_sha256: sha,
      }),
    ]);
  });

  function plantLedgerGoals(
    goals: Array<{
      id: string;
      text: string;
      source: "user_said" | "user_confirmed" | "ai_inferred" | "user_edited";
      turn_id: string;
      turn_text_sha256?: string;
    }>,
  ): void {
    const dir = path.join(repo, ".stagent", "drafts", "scheme-ledger");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "active.json"),
      JSON.stringify({
        schema_version: "1.0",
        updated_at: "2026-11-15T15:00:00.000Z",
        state: {
          draft: {
            scheme_id: "scheme-active",
            scheme_revision: 2,
            frozen: false,
            title: "工程项目进度管控台",
            summary: "按项目维度汇总进度与预算",
            audience: null,
            size_hint: "standard",
            goals: goals.map((g) => ({
              id: g.id,
              text: g.text,
              source: g.source,
              user_pinned: false,
              updated_in_revision: 2,
              evidence: [
                {
                  kind: "turn",
                  ref: {
                    turn_id: g.turn_id,
                    ...(g.turn_text_sha256 === undefined
                      ? {}
                      : { turn_text_sha256: g.turn_text_sha256 }),
                  },
                },
              ],
            })),
            out_of_scope: [],
            modules: [],
            flows: [],
            entities: [],
            decisions: [],
            conflicts: [],
            open_questions: [],
            acceptance: [],
          },
          graveyard: [],
          suggestions: [],
          attributions: [],
        },
        last_journal: null,
        last_model_id: null,
        last_prompt_version: null,
        offline: false,
      }),
    );
  }

  it("条目回链：缺登记未覆盖、哈希不一致 409、ai_inferred 不得冒充、轻确认不降级", async () => {
    const registered = await call("POST", "/api/supervisor/turns", {
      text: "按项目维度汇总进度与预算",
    });
    const turnId = registered.body.turn_id!;
    const sha = registered.body.turn_text_sha256!;
    const sourceTurns = [{ turn_id: turnId, turn_text_sha256: sha }];

    plantLedgerGoals([
      {
        id: "G-missing",
        text: "未登记的依据",
        source: "user_said",
        turn_id: "T99",
        turn_text_sha256: sha,
      },
    ]);
    const gap = await call(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezeBody("scheme-confirm-backlink-gap", sourceTurns),
    );
    expect(gap.status).toBe(201);
    expect(gap.body.trust_tier).toBe("standard");
    expect(gap.body.item_quote_backlink_covered_count).toBe(0);
    expect(gap.body.item_quote_backlink_uncovered_count).toBe(1);

    plantLedgerGoals([
      {
        id: "G-forged",
        text: "哈希被改",
        source: "user_said",
        turn_id: turnId,
        turn_text_sha256: sha256Utf8("被改过的需求"),
      },
    ]);
    const forged = await call(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezeBody("scheme-confirm-backlink-forged", sourceTurns),
    );
    expect(forged.status).toBe(409);
    expect(forged.body.code).toBe("E_SCHEME_SNAPSHOT_MISMATCH");
    expect(forged.body.reason).toBe("turn_hash_mismatch");
    expect(fs.existsSync(snapshotFile("scheme-confirm-backlink-forged"))).toBe(
      false,
    );

    plantLedgerGoals([
      {
        id: "G-ai",
        text: "模型推断",
        source: "ai_inferred",
        turn_id: turnId,
        turn_text_sha256: sha,
      },
    ]);
    const inferred = await call("POST", "/api/supervisor/scheme/freeze", {
      ...freezeBody("scheme-confirm-backlink-ai", sourceTurns),
      trust_tier: "light",
    });
    expect(inferred.status).toBe(201);
    expect(inferred.body.trust_tier).toBe("light");
    expect(inferred.body.item_quote_backlink_covered_count).toBe(0);
    expect(inferred.body.item_quote_backlink_uncovered_count).toBe(1);

    plantLedgerGoals([
      {
        id: "G-forged-light",
        text: "轻确认仍核验",
        source: "user_said",
        turn_id: turnId,
        turn_text_sha256: sha256Utf8("被改过的需求"),
      },
    ]);
    const lightForged = await call("POST", "/api/supervisor/scheme/freeze", {
      ...freezeBody("scheme-confirm-backlink-light-forged", sourceTurns),
      trust_tier: "轻确认",
    });
    expect(lightForged.status).toBe(409);
    expect(lightForged.body.reason).toBe("turn_hash_mismatch");
    expect(
      fs.existsSync(snapshotFile("scheme-confirm-backlink-light-forged")),
    ).toBe(false);

    plantLedgerGoals([
      {
        id: "G-said",
        text: "按项目维度汇总进度与预算",
        source: "user_said",
        turn_id: turnId,
        turn_text_sha256: sha,
      },
    ]);
    const covered = await call(
      "POST",
      "/api/supervisor/scheme/freeze",
      freezeBody("scheme-confirm-backlink-ok", sourceTurns),
    );
    expect(covered.status).toBe(201);
    expect(covered.body.trust_tier).toBe("standard");
    expect(covered.body.item_quote_backlink_covered_count).toBe(1);
    expect(covered.body.item_quote_backlink_uncovered_count).toBe(0);
  });

  it("journey 带已登记 turn 不重复登记", async () => {
    const text = "你好，先随便聊聊";
    const registered = await call("POST", "/api/supervisor/turns", { text });
    const ref = {
      turn_id: registered.body.turn_id!,
      turn_text_sha256: registered.body.turn_text_sha256!,
    };

    const res = await call("POST", "/api/supervisor/journey", {
      message: text,
      ...ref,
    });
    expect(res.status).toBe(200);
    const userTurns = (readTranscript(repo)?.turns ?? []).filter(
      (t) => t.role === "user",
    );
    expect(userTurns.map((t) => t.text)).toEqual([text]);

    const before = readTranscript(repo)?.turns.length;
    const forged = await call("POST", "/api/supervisor/journey", {
      message: "这里不对",
      ...ref,
    });
    expect(forged.status).toBe(409);
    expect(forged.body.error).toBe("turn_mismatch");
    expect(readTranscript(repo)?.turns.length).toBe(before);

    const half = await call("POST", "/api/supervisor/journey", {
      message: text,
      turn_id: ref.turn_id,
    });
    expect(half.status).toBe(400);
    expect(half.body.error).toBe("turn_ref_incomplete");
  });
});
