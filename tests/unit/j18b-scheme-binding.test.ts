import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  createContractDraft,
  schemeBindingSchema,
  softwareContractSchema,
  type SchemeBinding,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import { buildTombstone } from "../../src/lib/journey/graveyard-revival";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import {
  ContractStore,
  SchemeBindingImmutableError,
} from "../../daemon/pipeline/contract-store";
import {
  SCHEME_SNAPSHOT_SCHEMA_VERSION,
  SCHEME_SNAPSHOT_SCHEMA_VERSION_V11,
  graveyardDigest,
  readSchemeSnapshot,
  schemeBindingFromSnapshot,
  schemeSnapshotDigest,
  writeSchemeSnapshot,
} from "../../daemon/pipeline/scheme-snapshot-store";

/**
 * TASK-J.18b：scheme_binding + 快照 1.2 墓地权威源。
 * 覆盖：Schema 往返、建合同写入 binding、1.2 读写、digest 敏感、签署后改写拒绝。
 */

const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j18b-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      safeRmSync(dir);
    } catch {
      /* ignore cleanup failures in restricted envs */
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

function makeBinding(over: Partial<SchemeBinding> = {}): SchemeBinding {
  return schemeBindingSchema.parse({
    confirmation_id: "scheme-confirm-j18b-0001",
    snapshot_digest: "a".repeat(64),
    plan_digest: "b".repeat(64),
    ...over,
  });
}

function draftPending(over: Partial<SoftwareContract> = {}): SoftwareContract {
  const draft = createContractDraft({
    title: "j18b",
    description: "scheme binding test",
    acceptanceCriteria: ["ok"],
    writablePaths: ["src/**"],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
    ...over,
  });
}

describe("J.18b scheme_binding Schema 往返", () => {
  it("可选字段缺省时仍可解析（旧直签）", () => {
    const c = draftPending();
    expect(c.scheme_binding).toBeUndefined();
    const again = softwareContractSchema.parse(JSON.parse(JSON.stringify(c)));
    expect(again.scheme_binding).toBeUndefined();
  });

  it("带 scheme_binding 三字段往返保持一致", () => {
    const binding = makeBinding();
    const c = draftPending({ scheme_binding: binding });
    expect(c.scheme_binding).toEqual(binding);
    const again = softwareContractSchema.parse(JSON.parse(JSON.stringify(c)));
    expect(again.scheme_binding).toEqual(binding);
  });

  it("confirmation_id 格式非法 → Schema 拒绝", () => {
    expect(() =>
      schemeBindingSchema.parse({
        confirmation_id: "short",
        snapshot_digest: "x",
        plan_digest: "y",
      }),
    ).toThrow();
  });
});

describe("J.18b 建合同写入 scheme_binding", () => {
  it("schemeBindingFromSnapshot 与快照 digest / plan_digest 一致", () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const confirmationId = "scheme-confirm-j18b-bind01";
    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: confirmationId,
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "ok", demo_mode: "none" },
      scope_plan,
      graveyard: [],
    });

    const binding = schemeBindingFromSnapshot(confirmationId, snapshot);
    expect(binding.confirmation_id).toBe(confirmationId);
    expect(binding.snapshot_digest).toBe(snapshot.digest);
    expect(binding.plan_digest).toBe(scope_plan.plan_digest);

    const store = new ContractStore(repo);
    const saved = store.save(
      draftPending({
        scheme_binding: binding,
      }),
    );
    expect(saved.scheme_binding).toEqual(binding);
    const loaded = store.get(saved.contract_id);
    expect(loaded?.scheme_binding).toEqual(binding);
  });

  it("旧直签合同（无 confirmation 路径）不得发明 scheme_binding 于二次 save", () => {
    const repo = makeRepo();
    const store = new ContractStore(repo);
    const saved = store.save(draftPending());
    expect(saved.scheme_binding).toBeUndefined();
    expect(() =>
      store.save({
        ...saved,
        scheme_binding: makeBinding(),
      }),
    ).toThrow(SchemeBindingImmutableError);
  });
});

describe("J.18b 快照 1.2 读写与 digest", () => {
  it("新冻结写入 version=1.2 且含 graveyard / graveyard_digest", () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const tomb = buildTombstone({
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
    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: "scheme-confirm-j18b-snap01",
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "ok", demo_mode: "none" },
      scope_plan,
      graveyard: [tomb],
    });
    expect(snapshot.schema_version).toBe(SCHEME_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.schema_version).toBe("1.2");
    expect(snapshot.graveyard).toHaveLength(1);
    expect(snapshot.graveyard?.[0]?.rejected_id).toBe("REJ-MONGO");
    expect(snapshot.graveyard_digest).toBe(graveyardDigest([tomb]));

    const read = readSchemeSnapshot(repo, "scheme-confirm-j18b-snap01");
    expect(read?.schema_version).toBe("1.2");
    expect(read?.graveyard).toEqual(snapshot.graveyard);
    expect(read?.graveyard_digest).toBe(snapshot.graveyard_digest);
  });

  it("1.1 旧快照仍可读，且不采信文件中的 graveyard", () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const confirmationId = "scheme-confirm-j18b-v11";
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
        // 故意塞入——读侧必须丢弃
        graveyard: [
          {
            rejected_id: "SHOULD-DROP",
            proposal: "x",
          },
        ],
        graveyard_digest: "should-drop",
      }),
    );
    const read = readSchemeSnapshot(repo, confirmationId);
    expect(read).not.toBeNull();
    expect(read?.schema_version).toBe("1.1");
    expect(read?.scope_plan?.plan_digest).toBe(scope_plan.plan_digest);
    expect(read?.graveyard).toBeUndefined();
    expect(read?.graveyard_digest).toBeUndefined();
  });

  it("墓地内容变化 → digest / graveyard_digest 均变化", () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const scope_plan = buildScopePlan({ repoRoot: repo, scheme });
    const a = buildTombstone({
      rejected_id: "REJ-A",
      proposal: "方案 A",
      rejected_by: "user",
      rejection_reason: "不要",
      evidence: [],
      disallow_revival: true,
      updated_in_revision: 1,
      rejected_after_turn_seq: 1,
      quotes: ["方案 A"],
    });
    const b = buildTombstone({
      rejected_id: "REJ-B",
      proposal: "方案 B",
      rejected_by: "security_gate",
      rejection_reason: "不安全",
      evidence: [],
      disallow_revival: true,
      updated_in_revision: 1,
      rejected_after_turn_seq: 2,
      quotes: ["方案 B"],
    });
    const d1 = schemeSnapshotDigest({
      scheme_revision: scheme.scheme_revision,
      scheme,
      demo: EMPTY_DEMO_GATE,
      scope_plan,
      graveyard: [a],
    });
    const d2 = schemeSnapshotDigest({
      scheme_revision: scheme.scheme_revision,
      scheme,
      demo: EMPTY_DEMO_GATE,
      scope_plan,
      graveyard: [a, b],
    });
    expect(d1).not.toBe(d2);
    expect(graveyardDigest([a])).not.toBe(graveyardDigest([a, b]));

    const { snapshot } = writeSchemeSnapshot(repo, {
      confirmation_id: "scheme-confirm-j18b-dig01",
      scheme,
      demo: EMPTY_DEMO_GATE,
      decision: { code: "OK", message: "ok", demo_mode: "none" },
      scope_plan,
      graveyard: [a],
    });
    expect(snapshot.digest).toBe(d1);
    // 同 id 换墓地 → 冲突
    expect(() =>
      writeSchemeSnapshot(repo, {
        confirmation_id: "scheme-confirm-j18b-dig01",
        scheme,
        demo: EMPTY_DEMO_GATE,
        decision: { code: "OK", message: "ok", demo_mode: "none" },
        scope_plan,
        graveyard: [a, b],
      }),
    ).toThrow(/已冻结另一版方案/);
  });
});

describe("J.18b 签署后改写 scheme_binding 被拒绝", () => {
  it("已落盘 binding 改 digest → SchemeBindingImmutableError", () => {
    const repo = makeRepo();
    const store = new ContractStore(repo);
    const binding = makeBinding();
    const saved = store.save(draftPending({ scheme_binding: binding }));
    // 模拟签署后状态
    const approved = softwareContractSchema.parse({
      ...saved,
      lifecycle_state: "PREPARING",
      approval: {
        status: "APPROVED",
        approved_by: "local-user",
        approved_at: new Date().toISOString(),
        approved_revision: saved.contract_revision,
      },
      scheme_binding: binding,
    });
    store.save(approved);

    expect(() =>
      store.save({
        ...approved,
        scheme_binding: {
          ...binding,
          snapshot_digest: "c".repeat(64),
        },
      }),
    ).toThrow(SchemeBindingImmutableError);

    expect(() =>
      store.save({
        ...approved,
        scheme_binding: undefined,
      }),
    ).toThrow(SchemeBindingImmutableError);
  });
});
