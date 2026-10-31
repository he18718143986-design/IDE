/**
 * TASK-J.2 / SSOT S2-02、S2-04：ScopePlan 纯函数与预检构建器。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  applyScopeDecisions,
  formatBudgetPlain,
  plainAreaLabel,
  scopePlanDigest,
  scopePlanToContractScope,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import { gradeWritableScope } from "../../src/lib/writable-scope-grade";
import {
  buildScopePlan,
  convergeBareTopGlob,
  verificationFromPackageJson,
  type ScopePlanSchemeInput,
} from "../../daemon/supervisor/scope-plan-builder";
import { isGreenfieldRepo } from "../../daemon/supervisor/rules-l0";

const tmpDirs: string[] = [];

function emptyRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j2-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    safeRmSync(dir);
  }
});

function baseScheme(
  partial?: Partial<ScopePlanSchemeInput>,
): ScopePlanSchemeInput {
  return {
    scheme_revision: 3,
    title: "首页看板",
    summary: "显示本月逾期项目数",
    modules: ["首页看板"],
    notes: "",
    ...partial,
  };
}

function assertNoTechJargon(...texts: string[]): void {
  for (const text of texts) {
    expect(text.toLowerCase()).not.toMatch(/token/);
    expect(text.toLowerCase()).not.toMatch(/tool/);
    expect(text.toLowerCase()).not.toMatch(/glob/);
    expect(text).not.toContain("**");
  }
}

describe("TASK-J.2 ScopePlan 纯函数", () => {
  const samplePlan = (): ScopePlan => {
    const plan: ScopePlan = {
      scheme_revision: 1,
      plan_digest: "",
      areas: [
        {
          id: "area-0",
          label: "首页看板",
          why: "因为要做「首页看板」",
          module_ids: ["mod-0"],
          kind: "change_existing",
          paths: ["src/pages/**"],
          excluded_by_user: false,
        },
      ],
      never_touch: [{ label: "密码与钥匙文件", paths: [".env*"] }],
      needs_approval: [
        {
          id: "prot-0",
          label: "项目依赖清单",
          why: "命中保护清单",
          paths: ["package.json"],
          approved: null,
        },
      ],
      verification: {
        commands: [
          {
            alias: "typecheck",
            executable: "npm",
            args: ["run", "typecheck"],
            expected_exit_code: 0,
            timeout_seconds: 120,
          },
        ],
        plain: ["代码能通过类型检查"],
        manual_only: false,
      },
      budget: {
        limits: {
          max_file_modifications: 10,
          max_total_diff_lines: 2000,
          max_duration_seconds: 1800,
          max_verification_retries: 3,
          max_command_executions: 40,
          max_tool_calls: 200,
        },
        plain: formatBudgetPlain({
          max_file_modifications: 10,
          max_duration_seconds: 1800,
        }),
      },
      grade: { ok: true, rejected: [] },
    };
    plan.plan_digest = scopePlanDigest(plan);
    return plan;
  };

  it("scopePlanDigest 稳定且不含自身；表态后 digest 变化", () => {
    const a = samplePlan();
    const b = samplePlan();
    expect(a.plan_digest).toBe(b.plan_digest);
    expect(a.plan_digest).toMatch(/^[a-f0-9]{64}$/);

    const stamped = {
      ...a,
      plan_digest: "deadbeef",
    };
    // 重算时忽略已有 digest
    expect(scopePlanDigest(stamped)).toBe(a.plan_digest);

    const decided = applyScopeDecisions(a, {
      approvals: { "prot-0": true },
    });
    expect(decided.needs_approval[0]!.approved).toBe(true);
    expect(decided.plan_digest).not.toBe(a.plan_digest);

    const excluded = applyScopeDecisions(a, {
      excluded_area_ids: ["area-0"],
    });
    expect(excluded.areas[0]!.excluded_by_user).toBe(true);
    expect(excluded.plan_digest).not.toBe(a.plan_digest);
  });

  it("scopePlanToContractScope 投影可写/禁写/验收/预算", () => {
    const plan = samplePlan();
    const scope = scopePlanToContractScope(plan);
    expect(scope.writable_paths).toEqual(["src/pages/**"]);
    expect(scope.forbidden_paths).toContain(".env*");
    expect(scope.verification_spec.commands[0]!.alias).toBe("typecheck");
    expect(scope.budget.max_file_modifications).toBe(10);

    const withApproval = applyScopeDecisions(plan, {
      approvals: { "prot-0": true },
    });
    const scope2 = scopePlanToContractScope(withApproval);
    expect(scope2.writable_paths).toContain("package.json");

    const excluded = applyScopeDecisions(plan, {
      excluded_area_ids: ["area-0"],
    });
    expect(scopePlanToContractScope(excluded).writable_paths).toEqual([]);
  });

  it("未获批敏感路径即使重叠 areas 也不得进入 writable_paths", () => {
    const plan = samplePlan();
    // 模拟真实构建器：保护路径同时出现在 areas 与 needs_approval
    plan.areas[0]!.paths = ["src/pages/**", "package.json"];
    plan.needs_approval[0]!.approved = null;
    plan.plan_digest = scopePlanDigest(plan);

    const blocked = scopePlanToContractScope(plan);
    expect(blocked.writable_paths).toEqual(["src/pages/**"]);
    expect(blocked.writable_paths).not.toContain("package.json");

    const denied = applyScopeDecisions(plan, {
      approvals: { "prot-0": false },
    });
    expect(scopePlanToContractScope(denied).writable_paths).not.toContain(
      "package.json",
    );
    // 明确未授权 → 追加 never_touch → 进入 forbidden
    expect(
      denied.never_touch.some((g) => g.paths.includes("package.json")),
    ).toBe(true);
    expect(scopePlanToContractScope(denied).forbidden_paths).toContain(
      "package.json",
    );

    const approved = applyScopeDecisions(plan, {
      approvals: { "prot-0": true },
    });
    expect(scopePlanToContractScope(approved).writable_paths).toContain(
      "package.json",
    );
  });

  it("排除区域路径追加进 never_touch", () => {
    const plan = samplePlan();
    const excluded = applyScopeDecisions(plan, {
      excluded_area_ids: ["area-0"],
    });
    expect(excluded.areas[0]!.excluded_by_user).toBe(true);
    expect(
      excluded.never_touch.some((g) => g.paths.includes("src/pages/**")),
    ).toBe(true);
    expect(scopePlanToContractScope(excluded).forbidden_paths).toContain(
      "src/pages/**",
    );
  });

  it("budget.plain 与 plainAreaLabel 不含技术黑词", () => {
    const plain = formatBudgetPlain({
      max_file_modifications: 10,
      max_duration_seconds: 1800,
    });
    assertNoTechJargon(plain, plainAreaLabel("src/pages/**"), plainAreaLabel("src/**", "首页看板"));
    expect(plain).toMatch(/最多改约 10 个文件/);
    expect(plain).toMatch(/分钟/);
  });
});

describe("TASK-J.2 buildScopePlan 构建器", () => {
  it("单一来源：同输入两次 digest 相同；grade.ok 时合同范围再分级仍 ok", () => {
    const root = emptyRepo();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: { typecheck: "tsc -p .", test: "vitest run" },
      }),
    );
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "pages", "home.tsx"), "export {};\n");

    const scheme = baseScheme({
      // 不写显式路径，走 infer→src/** 再 token 收敛到 src/pages/**
      notes: "pages",
      modules: ["首页看板", "pages"],
    });
    const a = buildScopePlan({ repoRoot: root, scheme });
    const b = buildScopePlan({ repoRoot: root, scheme });
    expect(a.plan_digest).toBe(b.plan_digest);
    expect(a.scheme_revision).toBe(3);
    expect(a.grade.ok).toBe(true);
    expect(a.areas.some((area) => area.paths.includes("src/pages/**"))).toBe(
      true,
    );

    const scope = scopePlanToContractScope(a);
    const regrade = gradeWritableScope({
      writable_paths: scope.writable_paths,
      greenfield: isGreenfieldRepo(root),
    });
    expect(regrade.ok).toBe(true);
  });

  it("绿野（无 package.json）：src/** 种子放行", () => {
    const root = emptyRepo();
    const plan = buildScopePlan({
      repoRoot: root,
      scheme: baseScheme({ title: "新小软件", summary: "从零搭", notes: "" }),
    });
    expect(isGreenfieldRepo(root)).toBe(true);
    expect(plan.grade.ok).toBe(true);
    expect(plan.areas.some((a) => a.paths.includes("src/**"))).toBe(true);
    expect(plan.verification.manual_only).toBe(true);
  });

  it("老项目 + 命中真实子目录 src/pages → 收敛为 src/pages/** 且 grade.ok", () => {
    const root = emptyRepo();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "old", scripts: { test: "vitest" } }),
    );
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });

    const plan = buildScopePlan({
      repoRoot: root,
      scheme: baseScheme({
        title: "改 pages",
        summary: "只要 pages",
        modules: ["pages"],
        notes: "pages",
      }),
    });
    expect(plan.grade.ok).toBe(true);
    expect(plan.grade.rejected.find((r) => r.path === "src/**")).toBeUndefined();
    expect(plan.areas.some((a) => a.paths.includes("src/pages/**"))).toBe(true);
    expect(
      plan.areas.some((a) => a.paths.includes("src/components/**")),
    ).toBe(false);
  });

  it("老项目 + 无可匹配目录 → grade.ok=false 且 rejected 含 src/**（不编造）", () => {
    const root = emptyRepo();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "old" }));
    fs.mkdirSync(path.join(root, "src", "legacy"), { recursive: true });

    const plan = buildScopePlan({
      repoRoot: root,
      scheme: baseScheme({
        title: "随便做点事",
        summary: "没有对应目录的中文描述",
        modules: ["核心业务模块"],
        notes: "",
      }),
    });
    expect(plan.grade.ok).toBe(false);
    expect(plan.grade.rejected.some((r) => r.path === "src/**")).toBe(true);
    // 禁止编造 src/features/<slug>/**
    const allPaths = [
      ...plan.areas.flatMap((a) => a.paths),
      ...plan.grade.rejected.map((r) => r.path),
    ].join("\n");
    expect(allPaths).not.toMatch(/src\/features\//);
  });

  it("非 npm（Python 布局）不因缺 package.json 被误判为绿野", () => {
    const root = emptyRepo();
    fs.writeFileSync(path.join(root, "pyproject.toml"), "[project]\nname='x'\n");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    expect(isGreenfieldRepo(root)).toBe(false);
    const plan = buildScopePlan({
      repoRoot: root,
      scheme: baseScheme({
        title: "python 模块",
        modules: ["核心"],
        notes: "",
      }),
    });
    // 非绿野 + 无收敛 → src/** 应被拒
    expect(plan.grade.ok).toBe(false);
    expect(plan.grade.rejected.some((r) => r.path === "src/**")).toBe(true);
  });

  it("命中保护清单 → needs_approval.approved===null；表态后 digest 变", () => {
    const root = emptyRepo();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "prot",
        scripts: { typecheck: "tsc" },
      }),
    );
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    // 保护清单：锁住首页目录（writable 收敛后会命中）
    fs.mkdirSync(path.join(root, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".stagent", "protection.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "pe-pages",
            name: "首页目录",
            patterns: ["src/pages/**"],
            createdAt: "2026-10-31T00:00:00.000Z",
          },
        ],
      }),
    );

    const plan = buildScopePlan({
      repoRoot: root,
      scheme: baseScheme({
        notes: "pages",
        modules: ["pages"],
      }),
    });

    expect(plan.needs_approval.length).toBeGreaterThan(0);
    const hit = plan.needs_approval[0]!;
    expect(hit.approved).toBeNull();
    const next = applyScopeDecisions(plan, {
      approvals: { [hit.id]: true },
    });
    expect(next.plan_digest).not.toBe(plan.plan_digest);
    expect(next.needs_approval.find((n) => n.id === hit.id)?.approved).toBe(
      true,
    );
  });

  it("无 typecheck/test 脚本 → manual_only===true", () => {
    const root = emptyRepo();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "noscripts", scripts: { lint: "eslint ." } }),
    );
    const v = verificationFromPackageJson(root);
    expect(v.manual_only).toBe(true);
    expect(v.commands).toEqual([]);

    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    const plan = buildScopePlan({
      repoRoot: root,
      scheme: baseScheme({ notes: "pages", modules: ["pages"] }),
    });
    expect(plan.verification.manual_only).toBe(true);
    expect(plan.verification.plain.join("")).toMatch(/没有自动检查/);
  });

  it("budget.plain 与 areas[].label 不含 token/tool/glob/**", () => {
    const root = emptyRepo();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "plain",
        scripts: { typecheck: "tsc", test: "vitest" },
      }),
    );
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    const plan = buildScopePlan({
      repoRoot: root,
      scheme: baseScheme({ notes: "pages", modules: ["首页看板", "pages"] }),
    });
    assertNoTechJargon(plan.budget.plain, ...plan.areas.map((a) => a.label));
  });

  it("convergeBareTopGlob 不编造不存在的目录", () => {
    const root = emptyRepo();
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    const miss = convergeBareTopGlob({
      repoRoot: root,
      rejectedPath: "src/**",
      schemeText: "features finance slug",
      explicitPaths: [],
    });
    expect(miss).toBeNull();

    const hit = convergeBareTopGlob({
      repoRoot: root,
      rejectedPath: "src/**",
      schemeText: "pages home",
      explicitPaths: [],
    });
    expect(hit).toEqual(["src/pages/**"]);
  });

  it("extraSources 可追加（L.3 扩展点）", () => {
    const root = emptyRepo();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x" }));
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    const plan = buildScopePlan(
      {
        repoRoot: root,
        scheme: baseScheme({ notes: "pages", modules: ["pages"] }),
      },
      {
        extraSources: [
          {
            id: "withSystemScope-stub",
            contribute: () => ({
              never_touch: [
                { label: "系统测试夹具", paths: ["tests/stagent/**"] },
              ],
            }),
          },
        ],
      },
    );
    expect(
      plan.never_touch.some((g) => g.paths.includes("tests/stagent/**")),
    ).toBe(true);
  });
});
