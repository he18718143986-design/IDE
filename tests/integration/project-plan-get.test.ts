/**
 * TASK-L.10：GET /api/project/plan 返回计划 + 服务端权威下一份。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { safeRmSync } from "../helpers/tmp";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { writePlan } from "../../daemon/project/plan-store";
import { nextStub } from "../../src/lib/project/next-stub";
import type { ProjectPlan } from "../../src/lib/project/project-plan";

function requestJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; body: T }> {
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
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

function samplePlan(): ProjectPlan {
  return {
    schema_version: "1.0.0",
    project_id: "proj-get",
    plan_revision: 2,
    architecture_baseline_ref: {
      baseline_id: "pab-1",
      baseline_revision: 1,
      baseline_digest: "d1",
    },
    scheme_id: "S-get",
    scheme_revision: 1,
    milestones: [
      {
        milestone_id: "ms-1",
        title: "第一程",
        exit_acceptance_ids: ["acc-1"],
        contract_ids: ["cs-a", "cs-b"],
      },
    ],
    contracts: [
      {
        stub_id: "cs-a",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "桩 A",
        scheme_item_ids: ["goal-1"],
        acceptance_ids: ["acc-1"],
        area_hints: ["a"],
        depends_on: [],
        size_estimate: { files: 2, diff_lines: 50, minutes: 10 },
        status: "merged",
        contract_id: "ctr-a",
      },
      {
        stub_id: "cs-b",
        milestone_id: "ms-1",
        kind: "feature",
        origin: "scheme",
        title: "桩 B",
        scheme_item_ids: ["goal-2"],
        acceptance_ids: ["acc-2"],
        area_hints: ["b"],
        depends_on: ["cs-a"],
        size_estimate: { files: 3, diff_lines: 80, minutes: 15 },
        status: "planned",
        contract_id: null,
      },
    ],
    graveyard: [],
  };
}

describe("TASK-L.10 GET /api/project/plan", () => {
  let repoRoot: string;
  let daemon: StagentDaemon;
  let baseUrl: string;
  let token: string;

  beforeEach(async () => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l10-get-"));
    fs.writeFileSync(path.join(repoRoot, "package.json"), "{}\n");
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repoRoot });
    execFileSync("git", ["add", "."], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    daemon = createDaemon({
      repoRoot,
      startPort: 3861,
      endPort: 3880,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    baseUrl = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken()!;
  });

  afterEach(async () => {
    await daemon.stop();
    safeRmSync(repoRoot);
  });

  it("404 when no plan", async () => {
    const res = await requestJson<{ code?: string }>(
      `${baseUrl}/api/project/plan`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("E_PLAN_INVALID");
  });

  it("returns plan + server-authoritative next_stub_id", async () => {
    const plan = samplePlan();
    writePlan(repoRoot, plan);
    const expected = nextStub(plan);
    const res = await requestJson<{
      ok: boolean;
      plan: ProjectPlan;
      next_stub_id: string | null;
      next_stub: { stub_id: string } | null;
    }>(`${baseUrl}/api/project/plan`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.plan.project_id).toBe("proj-get");
    expect(res.body.next_stub_id).toBe(expected?.stub_id ?? null);
    expect(res.body.next_stub?.stub_id).toBe("cs-b");
  });
});
