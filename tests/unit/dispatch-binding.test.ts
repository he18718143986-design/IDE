/**
 * TM-GB：派工绑定（TASK-J.18c）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import { buildTombstone } from "../../src/lib/journey/graveyard-revival";
import {
  scopePlanToContractScope,
} from "../../src/lib/journey/scope-plan";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import {
  SCHEME_SNAPSHOT_SCHEMA_VERSION_V11,
  schemeBindingFromSnapshot,
  schemeSnapshotDigest,
  writeSchemeSnapshot,
} from "../../daemon/pipeline/scheme-snapshot-store";
import {
  GATE_PACK_DENY_READ_RULE,
  GATE_PACK_RELATIVE_PATH,
  verifyDispatchBinding,
} from "../../daemon/guard/dispatch-binding";
import { buildGatePack } from "../../daemon/guard/worker-graveyard-gate";

const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j18c-gb-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      safeRmSync(dir);
    } catch {
      /* ignore */
    }
  }
});

function makeScheme(partial: Partial<SchemeDraft> = {}): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary: "按项目维度汇总进度与预算。",
    modules: ["工程进度管控"],
    mermaidFlow: "flowchart LR\n  A --> B",
    business_input_rounds: 1,
    scheme_revision: 3,
    ...partial,
  });
}

function draftContract(
  over: Partial<SoftwareContract> = {},
  writablePaths = ["src/**"],
): SoftwareContract {
  const draft = createContractDraft({
    title: "j18c",
    description: "dispatch binding",
    acceptanceCriteria: ["ok"],
    writablePaths,
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
    ...over,
  });
}


function alignContract(
  binding: NonNullable<SoftwareContract["scheme_binding"]>,
  projected: ReturnType<typeof scopePlanToContractScope>,
  over: Partial<SoftwareContract> = {},
): SoftwareContract {
  const base = draftContract({ scheme_binding: binding }, projected.writable_paths);
  return softwareContractSchema.parse({
    ...base,
    authorization: {
      ...base.authorization,
      file_system_scope: {
        ...base.authorization.file_system_scope,
        writable_paths: projected.writable_paths,
        strictly_forbidden_paths: projected.forbidden_paths,
      },
      budget_limits: { ...projected.budget },
    },
    verification_spec: {
      commands: projected.verification_spec.commands,
      ...(projected.verification_spec.manual_confirmation
        ? {
            manual_confirmation:
              projected.verification_spec.manual_confirmation,
          }
        : {}),
    },
    scheme_binding: binding,
    ...over,
  });
}

function softTomb() {
  return buildTombstone({
    rejected_id: "REJ-SOFT",
    proposal: "用 graphql",
    rejected_by: "user",
    rejection_reason: "先不引入",
    evidence: [],
    disallow_revival: false,
    updated_in_revision: 2,
    rejected_after_turn_seq: 4,
    quotes: ["graphql"],
  });
}

function hardTomb() {
  return buildTombstone({
    rejected_id: "REJ-MONGO",
    proposal: "用 MongoDB",
    rejected_by: "user",
    rejection_reason: "不要文档库",
    evidence: [],
    disallow_revival: true,
    updated_in_revision: 2,
    rejected_after_turn_seq: 5,
    quotes: ["MongoDB"],
  });
}

describe("TM-GB 派工绑定", () => {
  it("TM-GB-01 合同无 scheme_binding → legacy", async () => {
    const repo = makeRepo();
    const r = await verifyDispatchBinding(repo, draftContract());
    expect(r).toEqual({ ok: true, mode: "legacy" });
  });

  it("TM-GB-02 快照文件缺失 → E_SCHEME_SNAPSHOT_NOT_FOUND", async () => {
    const repo = makeRepo();
    const c = draftContract({
      scheme_binding: {
        confirmation_id: "scheme-confirm-missing-0001",
        snapshot_digest: "a".repeat(64),
        plan_digest: "b".repeat(64),
      },
    });
    const r = await verifyDispatchBinding(repo, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
  });

  it("TM-GB-03 快照哈希被篡改 → E_SCHEME_SNAPSHOT_MISMATCH", async () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const confirmationId = "scheme-confirm-j18c-mismatch";
    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "ok", demo_mode: "none" },
      scope_plan,
      graveyard: [],
    });
    const binding = schemeBindingFromSnapshot(confirmationId, snapshot);
    const projected = scopePlanToContractScope(scope_plan);
    const aligned = alignContract(
      { ...binding, snapshot_digest: "0".repeat(64) },
      projected,
    );
    const r = await verifyDispatchBinding(repo, aligned);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_SCHEME_SNAPSHOT_MISMATCH");
  });

  it("TM-GB-04 合同 writable_paths 比投影多一条 → MISMATCH", async () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const confirmationId = "scheme-confirm-j18c-scope";
    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "ok", demo_mode: "none" },
      scope_plan,
      graveyard: [],
    });
    const binding = schemeBindingFromSnapshot(confirmationId, snapshot);
    const projected = scopePlanToContractScope(scope_plan);
    const base = alignContract(binding, projected);
    const extraPaths = [...projected.writable_paths, "extra-hack/**"];
    const c = softwareContractSchema.parse({
      ...base,
      authorization: {
        ...base.authorization,
        file_system_scope: {
          ...base.authorization.file_system_scope,
          writable_paths: extraPaths,
        },
      },
    });
    const r = await verifyDispatchBinding(repo, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_SCHEME_SNAPSHOT_MISMATCH");
  });

  it("TM-GB-05 快照 1.1（无墓地）→ NOT_FOUND 版本过旧", async () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const confirmationId = "scheme-confirm-j18c-v11";
    const digest = schemeSnapshotDigest({
      scheme_revision: scheme.scheme_revision,
      scheme,
      demo: EMPTY_DEMO_GATE,
      scope_plan,
    });
    const dir = path.join(repo, ".stagent/drafts/schemes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${confirmationId}.json`),
      JSON.stringify({
        schema_version: SCHEME_SNAPSHOT_SCHEMA_VERSION_V11,
        snapshot_id: confirmationId,
        confirmation_id: confirmationId,
        status: "FROZEN",
        created_at: new Date().toISOString(),
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo: EMPTY_DEMO_GATE,
        decision: { code: "OK", message: "v11", demo_mode: "none" },
        digest,
        scope_plan,
      }),
    );
    const projected = scopePlanToContractScope(scope_plan);
    const c = alignContract(
      {
        confirmation_id: confirmationId,
        snapshot_digest: digest,
        plan_digest: scope_plan.plan_digest,
      },
      projected,
    );
    const r = await verifyDispatchBinding(repo, c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
      expect(r.message).toMatch(/过旧/);
    }
  });

  it("TM-GB-06 一切一致 → bound；pack 只含阻断类墓碑", async () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const confirmationId = "scheme-confirm-j18c-bound01";
    const graveyard = [hardTomb(), softTomb()];
    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "ok", demo_mode: "none" },
      scope_plan,
      graveyard,
    });
    const binding = schemeBindingFromSnapshot(confirmationId, snapshot);
    const projected = scopePlanToContractScope(scope_plan);
    const c = alignContract(binding, projected);
    const r = await verifyDispatchBinding(repo, c);
    expect(r.ok).toBe(true);
    if (r.ok && r.mode === "bound") {
      expect(r.graveyard.map((g) => g.rejected_id).sort()).toEqual([
        "REJ-MONGO",
        "REJ-SOFT",
      ]);
      expect(r.pack).toEqual(buildGatePack(graveyard));
      expect(r.pack.tombstones.map((t) => t.rejected_id)).toEqual([
        "REJ-MONGO",
      ]);
      expect(r.pack.tombstones[0]?.lock).toBe("user");
    } else {
      expect.fail("expected bound");
    }
  });

  it("TM-GB-07 gate pack 路径落在 claude-config，且命中既有 Read deny 规则", () => {
    expect(GATE_PACK_RELATIVE_PATH).toBe(
      ".stagent/claude-config/graveyard-pack.json",
    );
    expect(GATE_PACK_DENY_READ_RULE).toBe(
      "Read(./.stagent/claude-config/**)",
    );
    // 与 CLI adapter 生成的 deny 列表同形：Read(./.stagent/claude-config/**)
    const packAbsHint = path.posix.join(
      ".stagent",
      "claude-config",
      "graveyard-pack.json",
    );
    expect(GATE_PACK_RELATIVE_PATH.replace(/\\/g, "/")).toBe(packAbsHint);
  });
});
