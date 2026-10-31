/**
 * TASK-L.12 / technical-design-and-knowledge §6：TD-09。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import {
  draftModules,
  listTopLevelSourceDirs,
} from "../../daemon/knowledge/bootstrap-draft";
import { withSystemScope } from "../../daemon/supervisor/scope-plan-builder";
import {
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import { emptySchemeDraft } from "../../src/lib/journey/scheme-draft";
import type { ContractStub } from "../../src/lib/project/project-plan";

function minimalPlan(): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: 1,
    plan_digest: "",
    areas: [
      {
        id: "area-src",
        label: "源码",
        why: "改源码",
        module_ids: [],
        kind: "change_existing",
        paths: ["src/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [],
    needs_approval: [],
    verification: {
      commands: [],
      plain: ["按方案验收"],
      manual_only: true,
    },
    budget: {
      limits: {
        max_file_modifications: 40,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 2,
      },
      plain: "预算占位",
    },
    grade: { ok: true, rejected: [] },
  };
  plan.plan_digest = scopePlanDigest(plan);
  return plan;
}

describe("TASK-L.12 draftModules TD-09", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l12-boot-")),
    );
  });

  afterEach(() => {
    safeRmSync(root);
  });

  it("TD-09：3 个顶层源码目录 → 3 个候选模块；跨目录导入进入 depends_on", () => {
    for (const dir of ["alpha", "beta", "gamma"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.writeFileSync(
      path.join(root, "alpha", "index.ts"),
      'export const a = 1;\n',
    );
    fs.writeFileSync(
      path.join(root, "beta", "index.ts"),
      'import { a } from "../alpha/index";\nexport const b = a;\n',
    );
    fs.writeFileSync(
      path.join(root, "gamma", "index.ts"),
      "export const g = 3;\n",
    );

    expect(listTopLevelSourceDirs(root)).toEqual(["alpha", "beta", "gamma"]);
    const drafts = draftModules(root);
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.id).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    const beta = drafts.find((d) => d.id === "beta");
    expect(beta?.depends_on).toContain("alpha");
    expect(beta?.paths).toEqual(["alpha/**".replace("alpha", "beta")]);
    expect(beta?.paths[0]).toBe("beta/**");
    expect(drafts.every((d) => d.introduced_by === "knowledge_bootstrap")).toBe(
      true,
    );
  });
});

describe("TASK-L.12 withSystemScope 知识库并入", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-l12-scope-")),
    );
  });

  afterEach(() => {
    safeRmSync(root);
  });

  it("已有 modules.yaml 时并入 docs/system/** 与 check-knowledge", () => {
    fs.mkdirSync(path.join(root, "docs", "system"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "system", "modules.yaml"),
      'schema_version: "1.0.0"\nmodules: []\n',
    );
    const base = minimalPlan();
    const next = withSystemScope(base, {
      repoRoot: root,
      scheme: {
        ...emptySchemeDraft(),
        scheme_revision: 1,
        title: "t",
        summary: "s",
        acceptance: [{ id: "p1", text: "试玩", check: "playtest" }],
      },
    });
    expect(next.areas.some((a) => a.paths.includes("docs/system/**"))).toBe(
      true,
    );
    expect(
      next.verification.commands.some((c) => c.alias === "check-knowledge"),
    ).toBe(true);
    expect(next.plan_digest).not.toBe(base.plan_digest);
  });

  it("knowledge_bootstrap 桩即使无 modules.yaml 也并入", () => {
    const stub = {
      id: "stub-kb",
      kind: "knowledge_bootstrap",
      title: "引导知识库",
      acceptance: [],
    } as unknown as ContractStub;
    const base = minimalPlan();
    const next = withSystemScope(base, {
      repoRoot: root,
      scheme: {
        ...emptySchemeDraft(),
        scheme_revision: 1,
        title: "t",
        summary: "s",
        acceptance: [{ id: "p1", text: "试玩", check: "playtest" }],
      },
      stub,
    });
    const cmd = next.verification.commands.find(
      (c) => c.alias === "check-knowledge",
    );
    expect(cmd).toBeTruthy();
    expect(cmd?.args).toContain("--all");
    expect(next.areas.some((a) => a.paths.includes("docs/system/**"))).toBe(
      true,
    );
  });
});
