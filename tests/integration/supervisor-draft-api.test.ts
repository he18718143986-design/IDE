import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import { git } from "../helpers/git";

/**
 * `POST /api/supervisor/draft` 控制面验收。
 *
 * 这张卡的核心不是"能返回一段 JSON"，而是三个**约束真的成立**：
 * 1. 鉴权与入参校验（401 / 400）；
 * 2. Zero-Tool + 零落盘：草案只回给前端，仓库不产生任何已跟踪文件改动，
 *    `.stagent/contracts` 里也不多一份合同；
 * 3. 预算独立：费用只落 `.stagent/supervisor-budget.json`，
 *    Worker 的合同账本文件不被创建；账本熔断时返回 402 而不是硬跑。
 */

const BUDGET_FILE = ".stagent/supervisor-budget.json";
const WORKER_COST_FILE = ".stagent/guard/cost.json";

describe("POST /api/supervisor/draft（Supervisor 草案控制面）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  const startDaemon = async (
    enrich?: Parameters<typeof createDaemon>[0]["supervisorEnrich"],
  ) => {
    daemon = createDaemon({
      repoRoot: repo,
      // 端口段：与其余套件不重叠，登记表见 tests/unit/test-port-map.test.ts
      startPort: 4729,
      endPort: 4738,
      enableCrashRecovery: false,
      ...(enrich === undefined ? {} : { supervisorEnrich: enrich }),
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  };

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-sup-draft-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(repo, "src", "auth"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "src", "components", "login.tsx"),
      "export const Login = 1;\n",
    );
    fs.writeFileSync(
      path.join(repo, "src", "auth", "login.ts"),
      "export const auth = 1;\n",
    );
    // 常规项目夹具：**有** package.json。缺了它 `isGreenfieldRepo()` 会把本仓库
    // 判成绿野，`alignWritableWithNpmVerification` 就会往可写范围里补 14 条
    // 脚手架种子，`context_paths` 优先级那条断言就测不到真实意图了。
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "sup-draft-fixture", private: true }),
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    daemon = null;
    safeRmSync(repo);
  });

  const post = (body: unknown, withAuth = true) =>
    fetch(`${base}/api/supervisor/draft`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withAuth
          ? { authorization: `Bearer ${token}`, connection: "close" }
          : {}),
      },
      body: JSON.stringify(body),
    });

  const readBudget = () =>
    JSON.parse(fs.readFileSync(path.join(repo, BUDGET_FILE), "utf8")) as {
      totalInputTokens: number;
      totalOutputTokens: number;
      tripped: boolean;
    };

  /** 列出仓库内某个相对目录的直接子项（目录不存在时视为空） */
  const dirEntries = (rel: string): string[] => {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs).sort();
  };

  it("无 Token 返回 401，且不生成任何东西", async () => {
    await startDaemon();
    const res = await post({ intent: "改登录按钮样式" }, false);
    expect(res.status).toBe(401);
    expect(fs.existsSync(path.join(repo, BUDGET_FILE))).toBe(false);
  });

  it("空 intent 返回 400，纯空白也算空", async () => {
    await startDaemon();
    const empty = await post({ intent: "" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: "intent_required" });

    const blank = await post({ intent: "   \n  " });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ error: "intent_required" });
  });

  it("自然语言意图 → 200，草案带完整的 supervisor_metadata", async () => {
    await startDaemon();
    const res = await post({ intent: "修改登录按钮样式，只动组件层" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: {
        contract: Record<string, unknown> & {
          lifecycle_state: string;
          intent: { title: string };
          supervisor_metadata: {
            suggestion_id: string;
            maturity_assessment: {
              rationale: string[];
              unresolved_questions: string[];
              assessed_at: string;
            };
            suggested_scope: {
              writable_paths: string[];
              strictly_forbidden_paths: string[];
            };
          };
          authorization: { file_system_scope: { writable_paths: string[] } };
        };
        plan: { writable_paths: string[] };
        rationale: string[];
        unresolved_questions: string[];
        model_calls: number;
      };
      budget: { total_tokens: number; tripped: boolean };
    };

    // 草案停留在 DRAFT/DRAFT，等用户编辑后再提交，不会自己进待审
    expect(body.draft.contract.lifecycle_state).toBe("DRAFT");

    const meta = body.draft.contract.supervisor_metadata;
    expect(meta.suggestion_id).toMatch(/^sug_/);
    expect(meta.maturity_assessment.assessed_at).toBeTruthy();
    // 白话理由不再是"（无）"：L0 至少给出范围/只读/命令/预算四条
    expect(meta.maturity_assessment.rationale.length).toBeGreaterThanOrEqual(4);
    expect(meta.maturity_assessment.rationale.join("\n")).toContain(
      "可写范围按会话中提到/推断出的路径圈定",
    );
    expect(Array.isArray(meta.maturity_assessment.unresolved_questions)).toBe(
      true,
    );
    // 「涉及范围」来自 L0 规则推导，且与合同 Scope、suggested_scope 三处一致
    expect(meta.suggested_scope.writable_paths).toContain("src/components/**");
    expect(body.draft.plan.writable_paths).toEqual(
      meta.suggested_scope.writable_paths,
    );
    expect(
      body.draft.contract.authorization.file_system_scope.writable_paths,
    ).toEqual(meta.suggested_scope.writable_paths);
    // 纯 L0：零模型调用
    expect(body.draft.model_calls).toBe(0);
    expect(body.budget.tripped).toBe(false);
  });

  it("context_paths 优先于文本推断（架构图圈选即意图）", async () => {
    await startDaemon();
    const res = await post({
      intent: "改点东西",
      context_paths: ["src/auth/login.ts"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: { plan: { writable_paths: string[] } };
    };
    expect(body.draft.plan.writable_paths).toEqual(["src/auth/login.ts"]);
  });

  it("Zero-Tool：不落合同、不动已跟踪文件、不建 Worktree", async () => {
    await startDaemon();
    const before = git(repo, ["status", "--porcelain"]);
    const res = await post({ intent: "修改登录按钮样式" });
    expect(res.status).toBe(200);
    const after = git(repo, ["status", "--porcelain"]);

    expect(after).toBe(before);
    // 草案没有被持久化：合同列表仍为空
    const list = await fetch(`${base}/api/contracts`, {
      headers: { authorization: `Bearer ${token}`, connection: "close" },
    });
    expect((await list.json()) as { contracts: unknown[] }).toEqual({
      contracts: [],
    });
    // 目录可能由 Daemon 启动时就建好了，关键是里面没有多出合同 / Worktree
    expect(dirEntries(".stagent/contracts")).toEqual([]);
    expect(dirEntries(".stagent/worktrees")).toEqual([]);
  });

  it("命中保护清单时把问题写进 unresolved_questions，并标记需人工确认", async () => {
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".stagent", "protection.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "p-auth",
            name: "登录",
            patterns: ["src/auth/**"],
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
    );
    await startDaemon();
    const res = await post({ intent: "调整 src/auth/login.ts 的校验逻辑" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: {
        plan: { needs_protection_approval: boolean; protected_files: string[] };
        unresolved_questions: string[];
        rationale: string[];
      };
    };
    expect(body.draft.plan.needs_protection_approval).toBe(true);
    expect(body.draft.plan.protected_files).toContain("src/auth/login.ts");
    expect(body.draft.unresolved_questions.join("\n")).toContain(
      "是否允许修改受保护的",
    );
    expect(body.draft.rationale.join("\n")).toContain("命中受保护内容");
  });

  it("账本独立：L1 用量只记 supervisor-budget.json，Worker 账本不受影响", async () => {
    await startDaemon(async () => ({
      rationale: ["这条理由来自 L1 强模型补全。"],
      unresolved_questions: ["登录失败要不要提示剩余次数？"],
      model_id: "gpt-test",
      input_tokens: 120,
      output_tokens: 60,
      cost_usd: 0.002,
    }));

    const res = await post({ intent: "修改登录按钮样式", enrich: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: {
        model_calls: number;
        rationale: string[];
        unresolved_questions: string[];
      };
      budget: { total_tokens: number };
    };
    expect(body.draft.model_calls).toBe(1);
    expect(body.draft.rationale.join("\n")).toContain("L1 强模型补全");
    expect(body.draft.unresolved_questions).toContain(
      "登录失败要不要提示剩余次数？",
    );

    // 独立账本有扣减记录
    const budget = readBudget();
    expect(budget.totalInputTokens).toBe(120);
    expect(budget.totalOutputTokens).toBe(60);
    expect(body.budget.total_tokens).toBe(180);
    // 合同账本（Worker）完全没被创建
    expect(fs.existsSync(path.join(repo, WORKER_COST_FILE))).toBe(false);
  });

  it("账本已熔断 → 402 BUDGET_EXHAUSTED，且不调用模型", async () => {
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, BUDGET_FILE),
      JSON.stringify({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        records: [],
        tripped: true,
      }),
    );
    let enriched = 0;
    await startDaemon(() => {
      enriched += 1;
      return {
        rationale: [],
        unresolved_questions: [],
        model_id: "gpt-test",
        input_tokens: 1,
        output_tokens: 1,
      };
    });

    const res = await post({ intent: "改登录按钮样式", enrich: true });
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: string;
      budget: { tripped: boolean };
    };
    expect(body.error).toBe("BUDGET_EXHAUSTED");
    expect(body.budget.tripped).toBe(true);
    expect(enriched).toBe(0);
  });

  it("未配置模型却要求 enrich → 409，不静默降级", async () => {
    await startDaemon();
    const res = await post({ intent: "改登录按钮样式", enrich: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ENRICH_NOT_CONFIGURED" });
  });

  it("省略 enrich 且已注入补全器 → 默认走 L1", async () => {
    let calls = 0;
    await startDaemon(async () => {
      calls += 1;
      return {
        rationale: ["自动 L1"],
        unresolved_questions: [],
        model_id: "gpt-test",
        input_tokens: 3,
        output_tokens: 4,
      };
    });
    const res = await post({ intent: "改登录按钮样式" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { model_calls: number } };
    expect(body.draft.model_calls).toBe(1);
    expect(calls).toBe(1);
  });

  it("enrich:false 即使已注入也强制纯 L0", async () => {
    let calls = 0;
    await startDaemon(async () => {
      calls += 1;
      return {
        rationale: ["不应出现"],
        unresolved_questions: [],
        model_id: "gpt-test",
        input_tokens: 1,
        output_tokens: 1,
      };
    });
    const res = await post({ intent: "改登录按钮样式", enrich: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { model_calls: number } };
    expect(body.draft.model_calls).toBe(0);
    expect(calls).toBe(0);
  });

  it("非 POST 返回 405", async () => {
    await startDaemon();
    const res = await fetch(`${base}/api/supervisor/draft`, {
      headers: { authorization: `Bearer ${token}`, connection: "close" },
    });
    expect(res.status).toBe(405);
  });
});
