/**
 * TASK-J.50a-2：资格判定、minimal ready PAB 完整落盘、digest 可复算、
 * 从落盘投影 ReadyPabView、decompose 回退读取，且不误用 /api/baseline。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { emptyDraft } from "../helpers/scheme-patch-fixtures";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  architectureBaselinePath,
  architectureBaselineRevisionPath,
  isProjectArchitectureBaseline,
  type ProjectArchitectureBaseline,
  readCurrentArchitectureBaseline,
  readCurrentArchitectureBaselineDocument,
  readArchitectureBaselineRevisionDocument,
  writeCurrentArchitectureBaseline,
} from "../../daemon/project/architecture-baseline-store";
import {
  assessMinimalReadyPabEligibility,
  computeArchitectureBaselineDigest,
  ensureMinimalReadyPab,
  verifyPersistedArchitectureBaselineDigest,
} from "../../daemon/supervisor/pab/minimal-ready-pab";
import { decompose } from "../../daemon/supervisor/decomposer";
import type { ReadyPabView } from "../../daemon/supervisor/decomposer/decompose";
import type { SchemeDraftV2 } from "../../src/lib/journey/scheme-patch-types";
import type { ProjectPlan } from "../../src/lib/project/project-plan";

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

function eligibleScheme(overrides: Partial<SchemeDraftV2> = {}): SchemeDraftV2 {
  return emptyDraft({
    frozen: true,
    size_hint: "standard",
    title: "登录页",
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
    ...overrides,
  });
}

function initGitRepo(root: string): string {
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Stagent Test"]);
  git(root, ["config", "user.email", "test@stagent.local"]);
  fs.writeFileSync(
    path.join(root, "README.md"),
    "stagent j50a2 fixture\n",
    "utf8",
  );
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "chore: init"]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

const repoFacts = {
  has_test_script: true,
  has_modules_yaml: true,
  existing_dirs: ["src"],
};

describe("TASK-J.50a-2 plan decompose PAB fallback", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j50a2-"));
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  it("J50a2-P1: 具备资格则零模型生成 minimal ready PAB", () => {
    const head = initGitRepo(repo);
    const scheme = eligibleScheme();
    const result = ensureMinimalReadyPab({ projectRoot: repo, scheme });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.pab.status).toBe("ready");
    expect(result.pab.baseline_id).toBe("pab-S1");
    expect(result.pab.baseline_revision).toBe(1);
    expect(result.pab.open_decisions ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ blocking: true })]),
    );

    const stored = readCurrentArchitectureBaselineDocument(repo);
    expect(stored).not.toBeNull();
    expect(isProjectArchitectureBaseline(stored!)).toBe(true);
    if (!stored || !isProjectArchitectureBaseline(stored)) return;
    expect(stored.mode).toBe("minimal");
    expect(stored.status).toBe("ready");
    expect(stored.scheme_ref).toEqual({
      scheme_id: "S1",
      scheme_revision: 5,
    });
    expect(stored.repository_ref.base_sha).toBe(head.toLowerCase());
    expect(stored.repository_ref.knowledge_digest).toBeNull();
    expect(stored.components).toHaveLength(1);
    expect(stored.components[0]?.name).toBe("登录页");
    expect(stored.components[0]?.source).toBe("user_said");
    expect(stored.goals_map.map((item) => item.scheme_item_id).sort()).toEqual(
      ["g-1", "m-1"].sort(),
    );
    expect(stored.open_decisions.every((item) => item.blocking === false)).toBe(
      true,
    );

    const again = ensureMinimalReadyPab({ projectRoot: repo, scheme });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.created).toBe(false);
    expect(again.pab).toEqual(result.pab);
  });

  it("J50a2-P2: ReadyPabView 只能来自落盘结果", () => {
    initGitRepo(repo);
    const result = ensureMinimalReadyPab({
      projectRoot: repo,
      scheme: eligibleScheme(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fromStore = readCurrentArchitectureBaseline(repo);
    expect(fromStore).not.toBeNull();
    expect(fromStore).toEqual(result.pab);

    const raw = JSON.parse(
      fs.readFileSync(architectureBaselinePath(repo), "utf8"),
    ) as ProjectArchitectureBaseline;
    expect(fromStore?.baseline_id).toBe(raw.baseline_id);
    expect(fromStore?.baseline_revision).toBe(raw.baseline_revision);
    expect(fromStore?.baseline_digest).toBe(raw.baseline_digest);
    expect(fromStore?.status).toBe(raw.status);
    expect(raw.status).toBe("ready");

    const handBuilt: ReadyPabView = {
      baseline_id: "pab-S1",
      baseline_revision: 1,
      baseline_digest: "temporary-not-from-disk",
      status: "ready",
    };
    expect(fromStore?.baseline_digest).not.toBe(handBuilt.baseline_digest);
    expect(fromStore).toEqual(readCurrentArchitectureBaseline(repo));
  });

  it("J50a2-P3: decompose HTTP 未传 pab 时能用上这份 ReadyPabView", async () => {
    initGitRepo(repo);
    const scheme = eligibleScheme();
    const ensured = ensureMinimalReadyPab({ projectRoot: repo, scheme });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) return;
    const view = readCurrentArchitectureBaseline(repo);
    expect(view).toEqual(ensured.pab);

    const direct = await decompose({
      scheme,
      repoFacts,
      pab: view,
      project_id: "proj-1",
    });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(direct.plan.architecture_baseline_ref).toEqual({
      baseline_id: view!.baseline_id,
      baseline_revision: view!.baseline_revision,
      baseline_digest: view!.baseline_digest,
    });

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4840,
      endPort: 4849,
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
    const dec = await requestJson<{
      ok: boolean;
      plan: ProjectPlan;
      model_calls: number;
    }>(`${base}/api/project/plan/decompose`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        scheme,
        repo_facts: repoFacts,
        project_id: "proj-http",
      }),
    });
    expect(dec.status).toBe(200);
    expect(dec.body.ok).toBe(true);
    expect(dec.body.model_calls).toBe(0);
    expect(dec.body.plan.milestones).toHaveLength(1);
    expect(dec.body.plan.contracts).toHaveLength(1);
    expect(dec.body.plan.architecture_baseline_ref.baseline_digest).toBe(
      view!.baseline_digest,
    );
  });

  it("J50a2-P3: decompose 未传 pab 且仓库为空时，具备资格则先生产再分解", async () => {
    initGitRepo(repo);
    const scheme = eligibleScheme();
    expect(readCurrentArchitectureBaseline(repo)).toBeNull();

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4850,
      endPort: 4859,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken();
    const base = `http://127.0.0.1:${info.port}`;
    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const dec = await requestJson<{
      ok: boolean;
      plan: ProjectPlan;
      code?: string;
    }>(`${base}/api/project/plan/decompose`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        scheme,
        repo_facts: repoFacts,
        project_id: "proj-auto",
      }),
    });
    expect(dec.status).toBe(200);
    expect(dec.body.ok).toBe(true);
    const stored = readCurrentArchitectureBaseline(repo);
    expect(stored?.status).toBe("ready");
    expect(dec.body.plan.architecture_baseline_ref.baseline_digest).toBe(
      stored?.baseline_digest,
    );
  });

  it("J50a2-P4: 现有 /api/baseline 仍是参考基线，不得充当 ReadyPabView", async () => {
    initGitRepo(repo);
    const scheme = eligibleScheme();
    const ensured = ensureMinimalReadyPab({ projectRoot: repo, scheme });
    expect(ensured.ok).toBe(true);

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4860,
      endPort: 4869,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken();
    const base = `http://127.0.0.1:${info.port}`;
    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const got = await requestJson<{
      archive: {
        kind?: string;
        grants_construction?: boolean;
        baseline_id?: unknown;
      };
      accept_label: string;
      grants_construction: boolean;
      baseline_id?: unknown;
      status?: unknown;
    }>(`${base}/api/baseline`, { headers: auth });
    expect(got.status).toBe(200);
    expect(got.body.grants_construction).toBe(false);
    expect(got.body.accept_label).toBe("认可此基线作为后续参考");
    expect(got.body.archive.grants_construction).toBe(false);
    expect(got.body.archive.kind).toBe("project_baseline_archive");
    expect(got.body.baseline_id).toBeUndefined();
    expect(got.body.archive.baseline_id).toBeUndefined();
    expect(got.body.status).toBeUndefined();

    const scanned = await requestJson<{
      archive: { grants_construction?: boolean; kind?: string };
      grants_construction?: boolean;
      accept_label: string;
    }>(`${base}/api/baseline/scan`, {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    expect(scanned.status).toBe(200);
    expect(scanned.body.accept_label).toBe("认可此基线作为后续参考");
    expect(scanned.body.archive.grants_construction).toBe(false);
    expect(scanned.body.archive.kind).toBe("project_baseline_archive");

    const pabPath = architectureBaselinePath(repo);
    const pabRaw = JSON.parse(fs.readFileSync(pabPath, "utf8")) as {
      mode: string;
      baseline_digest: string;
    };
    expect(pabRaw.mode).toBe("minimal");
    expect(got.body.archive).not.toEqual(
      expect.objectContaining({ baseline_digest: pabRaw.baseline_digest }),
    );
  });

  it("J50a2-P5: 不具备资格则失败关闭、不写盘", () => {
    initGitRepo(repo);
    const pabPath = architectureBaselinePath(repo);

    const large = assessMinimalReadyPabEligibility(
      eligibleScheme({ size_hint: "large" }),
    );
    expect(large.ok).toBe(false);
    if (!large.ok) {
      expect(large.code).toBe("E_PAB_NOT_READY");
      expect(large.plain_message).toMatch(/规模较大|完整架构/);
    }
    expect(
      ensureMinimalReadyPab({
        projectRoot: repo,
        scheme: eligibleScheme({ size_hint: "large" }),
      }).ok,
    ).toBe(false);
    expect(fs.existsSync(pabPath)).toBe(false);

    const tiny = ensureMinimalReadyPab({
      projectRoot: repo,
      scheme: eligibleScheme({ size_hint: "tiny", title: "登录页" }),
    });
    expect(tiny.ok).toBe(false);
    if (!tiny.ok) {
      expect(tiny.plain_message).toMatch(/不能按精简档跳过|标准档/);
    }
    expect(fs.existsSync(pabPath)).toBe(false);

    const crossModule = ensureMinimalReadyPab({
      projectRoot: repo,
      scheme: eligibleScheme({
        modules: [
          {
            ...meta("m-1"),
            name: "登录页",
            purpose: "用户登录",
            user_visible: true,
            kind: "new",
          },
          {
            ...meta("m-2"),
            name: "账户服务",
            purpose: "账户",
            user_visible: false,
            kind: "new",
          },
        ],
      }),
    });
    expect(crossModule.ok).toBe(false);
    if (!crossModule.ok) {
      expect(crossModule.plain_message).toMatch(/多个模块/);
    }
    expect(fs.existsSync(pabPath)).toBe(false);

    const foreignFlow = ensureMinimalReadyPab({
      projectRoot: repo,
      scheme: eligibleScheme({
        flows: [
          {
            ...meta("f-1"),
            name: "登录并记账",
            steps: [
              { actor: "用户", action: "登录", module_id: "m-1" },
              { actor: "系统", action: "记账", module_id: "m-other" },
            ],
          },
        ],
      }),
    });
    expect(foreignFlow.ok).toBe(false);
    if (!foreignFlow.ok) {
      expect(foreignFlow.plain_message).toMatch(/跨模块/);
    }
    expect(fs.existsSync(pabPath)).toBe(false);

    const changeExisting = ensureMinimalReadyPab({
      projectRoot: repo,
      scheme: eligibleScheme({
        modules: [
          {
            ...meta("m-1"),
            name: "登录页",
            purpose: "用户登录",
            user_visible: true,
            kind: "change_existing",
          },
        ],
      }),
    });
    expect(changeExisting.ok).toBe(false);
    if (!changeExisting.ok) {
      expect(changeExisting.plain_message).toMatch(/数据边界/);
    }
    expect(fs.existsSync(pabPath)).toBe(false);

    const unsealed = ensureMinimalReadyPab({
      projectRoot: repo,
      scheme: eligibleScheme({ frozen: false }),
    });
    expect(unsealed.ok).toBe(false);
    expect(fs.existsSync(pabPath)).toBe(false);
  });

  it("J50a2-P6: 落盘文件含完整 PAB 文档字段且 digest 可对落盘内容复算", () => {
    initGitRepo(repo);
    const result = ensureMinimalReadyPab({
      projectRoot: repo,
      scheme: eligibleScheme(),
    });
    expect(result.ok).toBe(true);

    const rawText = fs.readFileSync(architectureBaselinePath(repo), "utf8");
    const parsed = JSON.parse(rawText) as ProjectArchitectureBaseline;
    expect(parsed.mode).toBe("minimal");
    expect(parsed.scheme_ref).toEqual({
      scheme_id: "S1",
      scheme_revision: 5,
    });
    expect(parsed.repository_ref).toEqual(
      expect.objectContaining({
        base_sha: expect.stringMatching(/^[0-9a-f]{40,64}$/),
        knowledge_digest: null,
      }),
    );
    expect(Array.isArray(parsed.goals_map)).toBe(true);
    expect((parsed.goals_map as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.components)).toBe(true);
    const components = parsed.components as Array<{ source?: string }>;
    expect(components[0]?.source).toBe("user_said");
    expect(parsed.baseline_id).toBe("pab-S1");
    expect(parsed.baseline_revision).toBe(1);
    expect(parsed.status).toBe("ready");
    expect(typeof parsed.baseline_digest).toBe("string");

    const keys = Object.keys(parsed);
    expect(keys).toEqual(
      expect.arrayContaining([
        "schema_version",
        "mode",
        "scheme_ref",
        "repository_ref",
        "goals_map",
        "components",
        "baseline_id",
        "baseline_revision",
        "baseline_digest",
        "status",
      ]),
    );
    // digest 与完整文档一同落盘，而不是只留 ReadyPabView 五个字段
    expect(keys.length).toBeGreaterThan(5);

    const verified = verifyPersistedArchitectureBaselineDigest(parsed);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(parsed.baseline_digest).toBe(verified.digest);
    }
    expect(computeArchitectureBaselineDigest(parsed)).toBe(
      parsed.baseline_digest,
    );

    // 归档必须复制完整文档，而不能只留下视图五个字段
    const next = {
      ...(readCurrentArchitectureBaselineDocument(repo) as object),
      baseline_revision: 2,
      baseline_digest: "placeholder",
    };
    const canonicalNext = {
      ...next,
    };
    const nextDigest = computeArchitectureBaselineDigest({
      ...canonicalNext,
      baseline_digest: undefined,
    });
    writeCurrentArchitectureBaseline(repo, {
      ...(readCurrentArchitectureBaselineDocument(repo) as object),
      baseline_revision: 2,
      baseline_digest: nextDigest,
    } as Parameters<typeof writeCurrentArchitectureBaseline>[1]);
    const archived = readArchitectureBaselineRevisionDocument(repo, 1);
    expect(archived).not.toBeNull();
    expect(isProjectArchitectureBaseline(archived!)).toBe(true);
    if (archived && isProjectArchitectureBaseline(archived)) {
      expect(archived.mode).toBe("minimal");
      expect(archived.scheme_ref.scheme_id).toBe("S1");
      expect(archived.repository_ref.knowledge_digest).toBeNull();
      expect(verifyPersistedArchitectureBaselineDigest(archived).ok).toBe(true);
    }
    expect(fs.existsSync(architectureBaselineRevisionPath(repo, 1))).toBe(true);
  });

  it("新入口 POST /api/project/architecture-baseline/ensure-minimal 需鉴权", async () => {
    initGitRepo(repo);
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 4870,
      endPort: 4879,
      consolePublicDir: null,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken();
    const base = `http://127.0.0.1:${info.port}`;
    const url = `${base}/api/project/architecture-baseline/ensure-minimal`;
    const scheme = eligibleScheme();

    const unauth = await requestJson<{ error?: string }>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheme }),
    });
    expect(unauth.status).toBe(401);
    expect(unauth.body.error).toBe("Unauthorized");
    expect(fs.existsSync(architectureBaselinePath(repo))).toBe(false);

    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const created = await requestJson<{
      ok: boolean;
      pab: ReadyPabView;
      created: boolean;
    }>(url, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ scheme }),
    });
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    expect(created.body.created).toBe(true);
    expect(created.body.pab).toEqual(readCurrentArchitectureBaseline(repo));

    const ineligible = await requestJson<{
      ok: boolean;
      code?: string;
      error?: string;
    }>(url, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ scheme: eligibleScheme({ size_hint: "large" }) }),
    });
    expect(ineligible.status).toBe(422);
    expect(ineligible.body.ok).toBe(false);
    expect(ineligible.body.code).toBe("E_PAB_NOT_READY");
    expect(ineligible.body.error).toMatch(/规模较大|完整架构/);
  });
});
