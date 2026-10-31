/**
 * TASK-L.8：POST /api/project/plan/patch 与 /api/project/plan/decompose 生产主路径。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { safeRmSync } from "../helpers/tmp";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { writePlan, readPlan } from "../../daemon/project/plan-store";
import type { ProjectPlan } from "../../src/lib/project/project-plan";
import { emptyDraft } from "../helpers/scheme-patch-fixtures";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";

function requestJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; raw: string; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: T;
          try {
            body = raw ? (JSON.parse(raw) as T) : ({} as T);
          } catch {
            body = raw as unknown as T;
          }
          resolve({ status: res.statusCode ?? 0, raw, body });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

function meta(id: string) {
  return {
    id,
    source: "user_said" as const,
    evidence: [] as [],
    user_pinned: false,
    updated_in_revision: 1,
  };
}

function sampleScheme(): SchemeDraftV2 {
  return emptyDraft({
    size_hint: "standard",
    goals: [{ ...meta("g-1"), text: "完成登录" }],
    modules: [
      {
        ...meta("m-1"),
        name: "登录页",
        purpose: "用户登录",
        user_visible: true,
        kind: "new",
      },
    ],
    acceptance: [{ ...meta("acc-1"), text: "能登录" }],
  });
}

function samplePlan(): ProjectPlan {
  return {
    schema_version: "1.0.0",
    project_id: "proj-1",
    plan_revision: 1,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "digest-1",
    },
    scheme_id: "S1",
    scheme_revision: 5,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "第一期",
        exit_acceptance_ids: ["acc-1"],
        contract_ids: ["cs-1", "cs-2"],
      },
    ],
    contracts: [
      {
        stub_id: "cs-1",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "登录核心",
        scheme_item_ids: ["g-1"],
        acceptance_ids: ["acc-1"],
        area_hints: ["src/a"],
        depends_on: [],
        size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
        status: "planned",
        contract_id: null,
      },
      {
        stub_id: "cs-2",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "登录页 UI",
        scheme_item_ids: ["m-1"],
        acceptance_ids: ["acc-1"],
        area_hints: ["src/b"],
        depends_on: ["cs-1"],
        size_estimate: { files: 3, diff_lines: 80, minutes: 10 },
        status: "planned",
        contract_id: null,
      },
    ],
    graveyard: [],
  };
}

describe("TASK-L.8 plan patch / decompose HTTP", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l8-"));
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  it("decompose standard → 落盘 1 里程碑 1 桩；随后 reorder 成功", async () => {
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3721,
      endPort: 3730,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken();
    expect(token).toBeTruthy();
    const base = `http://127.0.0.1:${info.port}`;
    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const scheme = sampleScheme();
    const pab = {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "digest-1",
      status: "ready" as const,
      open_decisions: [],
    };

    const dec = await requestJson<{
      ok: boolean;
      plan: ProjectPlan;
      model_calls: number;
    }>(`${base}/api/project/plan/decompose`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        scheme,
        pab,
        repo_facts: {
          has_test_script: true,
          has_modules_yaml: true,
          existing_dirs: ["src"],
        },
        project_id: "proj-1",
      }),
    });
    expect(dec.status).toBe(200);
    expect(dec.body.ok).toBe(true);
    expect(dec.body.model_calls).toBe(0);
    expect(dec.body.plan.milestones).toHaveLength(1);
    expect(dec.body.plan.contracts).toHaveLength(1);
    expect(readPlan(repo)?.plan_revision).toBe(1);

    // 先写入含两桩的计划，测 reorder
    writePlan(repo, samplePlan());
    const patch = await requestJson<{
      ok: boolean;
      plan: ProjectPlan;
    }>(`${base}/api/project/plan/patch`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        patch: {
          base_revision: 1,
          reason: "user_request",
          ops: [
            {
              op: "reorder",
              milestone_id: "ms-1",
              contract_ids: ["cs-2", "cs-1"],
            },
          ],
        },
        scheme,
        repo_facts: {
          has_test_script: true,
          has_modules_yaml: true,
          existing_dirs: ["src"],
        },
      }),
    });
    expect(patch.status).toBe(200);
    expect(patch.body.ok).toBe(true);
    expect(patch.body.plan.milestones[0]!.contract_ids).toEqual([
      "cs-2",
      "cs-1",
    ]);
    expect(patch.body.plan.plan_revision).toBe(2);
  });

  it("用户路径拒绝 edit_stub；无 Token → 401；PAB stale → 422 白话", async () => {
    writePlan(repo, samplePlan());
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3731,
      endPort: 3740,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken();
    const base = `http://127.0.0.1:${info.port}`;
    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const rejected = await requestJson<{ code?: string }>(
      `${base}/api/project/plan/patch`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          patch: {
            base_revision: 1,
            reason: "user_request",
            ops: [
              {
                op: "edit_stub",
                stub_id: "cs-1",
                fields: { title: "x" },
              },
            ],
          },
        }),
      },
    );
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe("E_PLAN_INVALID");

    const unauth = await requestJson(`${base}/api/project/plan/decompose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheme: sampleScheme() }),
    });
    expect(unauth.status).toBe(401);

    const stale = await requestJson<{
      ok: boolean;
      code: string;
      error: string;
    }>(`${base}/api/project/plan/decompose`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        scheme: sampleScheme(),
        pab: {
          baseline_id: "pab-1",
          baseline_revision: 1,
          baseline_digest: "d",
          status: "stale",
        },
      }),
    });
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe("E_PAB_NOT_READY");
    expect(stale.body.error).toBe("这个需求我还没拆好");
  });
});
