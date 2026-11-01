/**
 * TASK-J.20 / OP-1：授权清单写入、跨合同命中、失效再拦截、复活路径不读清单。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  ALLOWLIST_FILE_REL,
  DEFAULT_ALLOWLIST_TTL_MS,
  applyAllowlistToScopePlan,
  clearAllowlist,
  computeExpiresAt,
  emptyAllowlist,
  isPreauthorized,
  revokeAllowlistEntry,
  sensitiveIdFromPaths,
  upsertAllowlistEntries,
} from "../../src/lib/journey/authorization-allowlist";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  evaluateSchemeConfirmation,
} from "../../src/lib/journey/scheme-draft";
import {
  scopePlanDigest,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";
import {
  ALLOWLIST_FILE_REL as STORE_REL,
  FORBIDDEN_ALLOWLIST_METADATA_REL,
  applyRepoAllowlistToScopePlan,
  clearAuthorizations,
  computeProtectionFingerprint,
  readAllowlist,
  recordConfirmAuthorizations,
  revokeAuthorization,
  writeAllowlist,
} from "../../daemon/supervisor/authorization-allowlist-store";
import { saveProtectionList } from "../../daemon/protection/protection-list";

const tmpDirs: string[] = [];

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j20-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    safeRmSync(dir);
  }
});

function basePlan(partial?: Partial<ScopePlan>): ScopePlan {
  const plan: ScopePlan = {
    scheme_revision: 1,
    plan_digest: "",
    areas: [
      {
        id: "area-0",
        label: "业务页",
        why: "要改页面",
        module_ids: ["mod-0"],
        kind: "change_existing",
        paths: ["src/pages/**"],
        excluded_by_user: false,
      },
    ],
    never_touch: [],
    needs_approval: [
      {
        id: "prot-0",
        label: "登录",
        why: "命中保护清单，开工前需要你点头",
        paths: ["src/auth/**"],
        approved: null,
      },
    ],
    verification: { commands: [], plain: ["能打开"], manual_only: false },
    budget: {
      limits: {
        max_file_modifications: 10,
        max_total_diff_lines: 2000,
        max_duration_seconds: 1800,
        max_verification_retries: 3,
        max_command_executions: 40,
        max_tool_calls: 200,
      },
      plain: "预算",
    },
    grade: { ok: true, rejected: [] },
    ...partial,
  };
  plan.plan_digest = scopePlanDigest(plan);
  return plan;
}

describe("TASK-J.20 authorization allowlist", () => {
  it("sensitiveId 规范化路径顺序无关", () => {
    expect(sensitiveIdFromPaths(["b/x", "a/y"])).toBe(
      sensitiveIdFromPaths(["a/y", "b/x"]),
    );
    expect(sensitiveIdFromPaths(["./src/auth/**"])).toBe("src/auth/**");
  });

  it("写入 records 路径；禁止 metadata", () => {
    const root = tmpRepo();
    expect(STORE_REL).toBe(ALLOWLIST_FILE_REL);
    expect(ALLOWLIST_FILE_REL.startsWith(".stagent/records/")).toBe(true);
    expect(FORBIDDEN_ALLOWLIST_METADATA_REL).toContain(".stagent/metadata/");

    const list = upsertAllowlistEntries(emptyAllowlist(), [
      {
        paths: ["src/auth/**"],
        label: "登录",
        quote: "可以改登录",
        protection_fingerprint: "empty",
        source_contract_id: "c-1",
        source_confirmation_id: "conf-1",
        authorized_at: "2026-11-01T00:00:00.000Z",
      },
    ]);
    writeAllowlist(root, list);
    const abs = path.join(root, ALLOWLIST_FILE_REL);
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.existsSync(path.join(root, FORBIDDEN_ALLOWLIST_METADATA_REL))).toBe(
      false,
    );
    const read = readAllowlist(root);
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0]!.source_contract_id).toBe("c-1");
    expect(read.entries[0]!.quote).toBe("可以改登录");
  });

  it("跨合同同项：确认写入后预检自动放行，不再 E_SCOPE_APPROVAL_REQUIRED", () => {
    const root = tmpRepo();
    const plan1 = basePlan({
      needs_approval: [
        {
          id: "prot-0",
          label: "登录",
          why: "用户点名登录",
          paths: ["src/auth/**"],
          approved: true,
        },
      ],
    });
    recordConfirmAuthorizations(root, {
      scopePlan: plan1,
      source_contract_id: "contract-A",
      source_confirmation_id: "conf-A",
      now: "2026-11-01T00:00:00.000Z",
    });

    // 第二份合同：同路径敏感项尚未表态
    const plan2 = basePlan();
    expect(plan2.needs_approval[0]!.approved).toBeNull();
    const gated = evaluateSchemeConfirmation(
      emptySchemeDraft({
        title: "二号合同",
        summary: "继续改登录相关",
        modules: ["登录"],
        business_input_rounds: 1,
      }),
      EMPTY_DEMO_GATE,
      plan2,
    );
    expect(gated.code).toBe("E_SCOPE_APPROVAL_REQUIRED");

    const auto = applyRepoAllowlistToScopePlan(root, plan2, "2026-11-02T00:00:00.000Z");
    expect(auto.needs_approval[0]!.approved).toBe(true);
    const ok = evaluateSchemeConfirmation(
      emptySchemeDraft({
        title: "二号合同",
        summary: "继续改登录相关页面与文案",
        modules: ["登录"],
        business_input_rounds: 1,
      }),
      EMPTY_DEMO_GATE,
      auto,
    );
    expect(ok.ok).toBe(true);
    expect(ok.code).toBe("OK");
  });

  it("撤销后恢复拦截", () => {
    const root = tmpRepo();
    const sid = sensitiveIdFromPaths(["src/auth/**"]);
    writeAllowlist(
      root,
      upsertAllowlistEntries(emptyAllowlist(), [
        {
          paths: ["src/auth/**"],
          label: "登录",
          protection_fingerprint: "empty",
          authorized_at: "2026-11-01T00:00:00.000Z",
        },
      ]),
    );
    expect(
      isPreauthorized(readAllowlist(root), sid, {
        now: "2026-11-02T00:00:00.000Z",
        protectionFingerprint: "empty",
      }),
    ).toBe(true);

    revokeAuthorization(root, sid);
    expect(
      isPreauthorized(readAllowlist(root), sid, {
        now: "2026-11-02T00:00:00.000Z",
        protectionFingerprint: "empty",
      }),
    ).toBe(false);
    const blocked = applyRepoAllowlistToScopePlan(
      root,
      basePlan(),
      "2026-11-02T00:00:00.000Z",
    );
    expect(blocked.needs_approval[0]!.approved).toBeNull();
  });

  it("TTL 到期后恢复拦截（默认 ≤90 天）", () => {
    const authorized_at = "2026-01-01T00:00:00.000Z";
    const list = upsertAllowlistEntries(emptyAllowlist(), [
      {
        paths: ["src/auth/**"],
        label: "登录",
        protection_fingerprint: "empty",
        authorized_at,
        ttlMs: DEFAULT_ALLOWLIST_TTL_MS,
      },
    ]);
    const sid = sensitiveIdFromPaths(["src/auth/**"]);
    const expires = computeExpiresAt(authorized_at, DEFAULT_ALLOWLIST_TTL_MS);
    expect(
      isPreauthorized(list, sid, {
        now: new Date(Date.parse(expires) - 1000).toISOString(),
        protectionFingerprint: "empty",
      }),
    ).toBe(true);
    expect(
      isPreauthorized(list, sid, {
        now: expires,
        protectionFingerprint: "empty",
      }),
    ).toBe(false);
  });

  it("保护清单升级（指纹变）→ 重分类失效", () => {
    const root = tmpRepo();
    const fp1 = computeProtectionFingerprint(root);
    expect(fp1).toBe("empty");
    writeAllowlist(
      root,
      upsertAllowlistEntries(emptyAllowlist(), [
        {
          paths: ["src/auth/**"],
          label: "登录",
          protection_fingerprint: fp1,
          authorized_at: "2026-11-01T00:00:00.000Z",
        },
      ]),
    );
    saveProtectionList(root, {
      version: 1,
      entries: [
        {
          id: "pe-1",
          name: "登录",
          patterns: ["src/auth/**"],
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    const fp2 = computeProtectionFingerprint(root);
    expect(fp2).not.toBe(fp1);
    const plan = applyRepoAllowlistToScopePlan(
      root,
      basePlan(),
      "2026-11-02T00:00:00.000Z",
    );
    expect(plan.needs_approval[0]!.approved).toBeNull();
  });

  it("换仓：另一 repoRoot 不共享清单", () => {
    const a = tmpRepo();
    const b = tmpRepo();
    recordConfirmAuthorizations(a, {
      scopePlan: basePlan({
        needs_approval: [
          {
            id: "prot-0",
            label: "登录",
            why: "点名",
            paths: ["src/auth/**"],
            approved: true,
          },
        ],
      }),
      source_contract_id: "c-a",
      source_confirmation_id: "conf-a",
      now: "2026-11-01T00:00:00.000Z",
    });
    expect(readAllowlist(a).entries).toHaveLength(1);
    expect(readAllowlist(b).entries).toHaveLength(0);
    expect(
      applyRepoAllowlistToScopePlan(b, basePlan(), "2026-11-02T00:00:00.000Z")
        .needs_approval[0]!.approved,
    ).toBeNull();
  });

  it("清空授权动作后整表失效", () => {
    const root = tmpRepo();
    writeAllowlist(
      root,
      upsertAllowlistEntries(emptyAllowlist(), [
        {
          paths: ["src/auth/**"],
          label: "登录",
          protection_fingerprint: "empty",
          authorized_at: "2026-11-01T00:00:00.000Z",
        },
      ]),
    );
    clearAuthorizations(root);
    expect(readAllowlist(root).entries).toHaveLength(0);
    expect(clearAllowlist().entries).toHaveLength(0);
  });

  it("显式 approved===false 不被清单覆盖", () => {
    const list = upsertAllowlistEntries(emptyAllowlist(), [
      {
        paths: ["src/auth/**"],
        label: "登录",
        protection_fingerprint: "empty",
        authorized_at: "2026-11-01T00:00:00.000Z",
      },
    ]);
    const plan = basePlan({
      needs_approval: [
        {
          id: "prot-0",
          label: "登录",
          why: "拒绝",
          paths: ["src/auth/**"],
          approved: false,
        },
      ],
    });
    const next = applyAllowlistToScopePlan(plan, list, {
      now: "2026-11-02T00:00:00.000Z",
      protectionFingerprint: "empty",
    });
    expect(next.needs_approval[0]!.approved).toBe(false);
  });

  it("复活路径仍 ignoreOccurrence，且不读授权清单", () => {
    const revivalSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/journey/graveyard-revival.ts"),
      "utf8",
    );
    const patchSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/journey/scheme-patch-engine.ts"),
      "utf8",
    );
    const storeSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "daemon/supervisor/authorization-allowlist-store.ts",
      ),
      "utf8",
    );
    expect(revivalSrc).toContain("ignoreOccurrence: true");
    expect(revivalSrc).toContain("W_REVIVAL_OCCURRENCE_IGNORED");
    expect(revivalSrc).not.toMatch(/authorization-allowlist/);
    expect(patchSrc).not.toMatch(/authorization-allowlist/);
    // 存储声明禁止 metadata，且落在 records
    expect(storeSrc).toContain(".stagent/records/authorization-allowlist.json");
    expect(storeSrc).toContain(".stagent/metadata/");
    expect(storeSrc).toMatch(/must not write under \.stagent\/metadata/);

    // 纯函数撤销仍可用（确认路径能力）；与复活判定解耦
    const revoked = revokeAllowlistEntry(
      upsertAllowlistEntries(emptyAllowlist(), [
        {
          paths: ["src/auth/**"],
          label: "登录",
          protection_fingerprint: "empty",
        },
      ]),
      sensitiveIdFromPaths(["src/auth/**"]),
    );
    expect(revoked.entries[0]!.revoked_at).toBeTruthy();
  });
});
