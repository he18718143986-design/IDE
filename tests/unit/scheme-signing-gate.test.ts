import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  freezeScheme,
  type DemoGate,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import {
  SCHEME_SNAPSHOT_DIR,
  SchemeSnapshotConflictError,
  readSchemeSnapshot,
  schemeSnapshotPath,
  writeSchemeSnapshot,
} from "../../daemon/pipeline/scheme-snapshot-store";
import { buildScopePlan } from "../../daemon/supervisor/scope-plan-builder";
import {
  evaluateLatestDemoGate,
  evaluateSnapshotDemoGate,
} from "../../daemon/supervisor/demo/signing-gate";
import {
  upsertDemoConfirm,
  type DemoConfirmRecord,
} from "../../daemon/supervisor/demo/prototypes";

/**
 * SSOT v2.0.2 §4.6 验收：Daemon 权威签署门禁 + 不可变快照。
 *
 * 必须防住的回归：旧实现「只在已有确认记录时才校验」，导致
 * `writePrototype` 写入的 `confirmed:false` 记录被整条跳过 ——
 * 于是「Demo 已生成但用户没点确认」反而比「没生成 Demo」更容易签署。
 */

const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-gate-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      safeRmSync(dir);
    } catch {
      // 受限执行环境可能禁止删除临时目录；清理失败不应把断言判成失败。
    }
  }
});

function makeScheme(partial: Partial<SchemeDraft> = {}): SchemeDraft {
  return emptySchemeDraft({
    title: "工程项目进度管控台",
    summary: "按项目维度汇总进度与预算，并对超期节点发出预警。",
    modules: ["工程进度管控", "财务数据与预算"],
    mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
    business_input_rounds: 1,
    scheme_revision: 2,
    ...partial,
  });
}

function makeDemo(partial: Partial<DemoGate> = {}): DemoGate {
  return { ...EMPTY_DEMO_GATE, ...partial };
}

function writeConfirmRecord(
  repoRoot: string,
  record: Partial<DemoConfirmRecord> & { prototype_id: string },
): void {
  upsertDemoConfirm(repoRoot, {
    confirmed: false,
    confirmed_at: null,
    relative_root: `.stagent/prototypes/${record.prototype_id}`,
    ...record,
  });
}

function writeSnapshot(
  repoRoot: string,
  demo: DemoGate,
  scheme: SchemeDraft = makeScheme(),
  confirmationId = "scheme-confirm-gate-0001",
) {
  const scope_plan = buildScopePlan({ repoRoot, scheme });
  return writeSchemeSnapshot(repoRoot, {
    confirmation_id: confirmationId,
    scheme,
    demo,
    decision: {
      code: "OK",
      message: "ok",
      demo_mode: demo.status === "degraded_flowcard" ? "degraded" : "none",
    },
    scope_plan,
  });
}

describe("T-DEMO 旧路径兜底 evaluateLatestDemoGate", () => {
  it("T-DEMO-001 从未生成 Demo：允许签署（source=never_generated）", () => {
    const repo = makeRepo();
    const gate = evaluateLatestDemoGate(repo);
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.mode).toBe("none");
      expect(gate.source).toBe("never_generated");
    }
  });

  it("T-DEMO-002 已生成但未确认（confirmed:false）：必须拒绝，不得跳过", () => {
    const repo = makeRepo();
    writeConfirmRecord(repo, {
      prototype_id: "proto-unconfirmed",
      confirmed: false,
      demo_mode: "INTERACTIVE_DEMO",
    });

    const gate = evaluateLatestDemoGate(repo);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe("E_DEMO_NOT_CONFIRMED");
      expect(gate.prototype_id).toBe("proto-unconfirmed");
      expect(gate.message).toContain("尚未确认");
    }
  });

  it("T-DEMO-003 已确认的可交互 Demo：允许签署且带 prototype_id", () => {
    const repo = makeRepo();
    writeConfirmRecord(repo, {
      prototype_id: "proto-ok",
      confirmed: true,
      confirmed_at: new Date().toISOString(),
      demo_mode: "INTERACTIVE_DEMO",
    });

    const gate = evaluateLatestDemoGate(repo);
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.mode).toBe("INTERACTIVE_DEMO");
      expect(gate.prototype_id).toBe("proto-ok");
      expect(gate.source).toBe("latest");
    }
  });

  it("T-DEMO-004 降级卡但未显式接受：拒绝（禁止冒充可交互 Demo 偷渡）", () => {
    const repo = makeRepo();
    writeConfirmRecord(repo, {
      prototype_id: "proto-degraded",
      confirmed: true,
      confirmed_at: new Date().toISOString(),
      demo_mode: "DEGRADED_FLOW_CARD",
    });

    const gate = evaluateLatestDemoGate(repo);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("E_CAN_SIGN_DENIED");
  });

  it("T-DEMO-005 降级卡 + 显式接受降级：允许", () => {
    const repo = makeRepo();
    writeConfirmRecord(repo, {
      prototype_id: "proto-degraded-ok",
      confirmed: true,
      confirmed_at: new Date().toISOString(),
      demo_mode: "DEGRADED_FLOW_CARD",
      accept_degraded: true,
    });

    const gate = evaluateLatestDemoGate(repo);
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.mode).toBe("DEGRADED_FLOW_CARD");
  });
});

describe("T-DEMO 快照主路径 evaluateSnapshotDemoGate", () => {
  it("T-DEMO-006 快照声明从未生成 Demo：允许，不需要任何确认记录", () => {
    const gate = evaluateSnapshotDemoGate({
      ...writeSnapshot(makeRepo(), EMPTY_DEMO_GATE).snapshot,
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.source).toBe("snapshot");
  });

  it("T-DEMO-007 快照 building / failed：分别拒绝", () => {
    const repo = makeRepo();
    const building = writeSnapshot(
      repo,
      makeDemo({ status: "building", scheme_revision: 2 }),
    ).snapshot;
    const failed = writeSnapshot(
      repo,
      makeDemo({ status: "failed", scheme_revision: 2 }),
      makeScheme(),
      "scheme-confirm-gate-0002",
    ).snapshot;

    const buildingGate = evaluateSnapshotDemoGate(building);
    expect(buildingGate.ok).toBe(false);
    if (!buildingGate.ok) expect(buildingGate.code).toBe("E_DEMO_BUILDING");

    const failedGate = evaluateSnapshotDemoGate(failed);
    expect(failedGate.ok).toBe(false);
    if (!failedGate.ok) expect(failedGate.code).toBe("E_DEMO_FAILED");
  });

  it("T-DEMO-008 快照的 Demo 修订与方案不一致：拒绝 E_DEMO_STALE", () => {
    const repo = makeRepo();
    const snapshot = writeSnapshot(
      repo,
      makeDemo({
        status: "ready",
        scheme_revision: 1,
        decision_revision: 1,
        prototype_id: "proto-stale",
      }),
    ).snapshot;

    const gate = evaluateSnapshotDemoGate(snapshot);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("E_DEMO_STALE");
  });

  it("T-DEMO-009 快照 degraded_flowcard（已接受）：允许 DEGRADED_FLOW_CARD", () => {
    const repo = makeRepo();
    const snapshot = writeSnapshot(
      repo,
      makeDemo({
        status: "degraded_flowcard",
        scheme_revision: 2,
        decision_revision: 2,
        risk_flags: ["NO_INTERACTIVE_DEMO"],
      }),
    ).snapshot;

    const gate = evaluateSnapshotDemoGate(snapshot);
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.mode).toBe("DEGRADED_FLOW_CARD");
  });

  it("T-DEMO-010 快照称 ready 但确认记录是 confirmed:false：拒绝", () => {
    const repo = makeRepo();
    const snapshot = writeSnapshot(
      repo,
      makeDemo({
        status: "ready",
        scheme_revision: 2,
        decision_revision: 2,
        prototype_id: "proto-lying",
      }),
    ).snapshot;

    const gate = evaluateSnapshotDemoGate(snapshot, () => ({
      prototype_id: "proto-lying",
      confirmed: false,
      confirmed_at: null,
      relative_root: ".stagent/prototypes/proto-lying",
      demo_mode: "INTERACTIVE_DEMO",
    }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("E_DEMO_NOT_CONFIRMED");
  });

  it("T-DEMO-011 快照称 ready 但查不到确认记录：拒绝", () => {
    const repo = makeRepo();
    const snapshot = writeSnapshot(
      repo,
      makeDemo({
        status: "ready",
        scheme_revision: 2,
        decision_revision: 2,
        prototype_id: "proto-missing",
      }),
    ).snapshot;

    const gate = evaluateSnapshotDemoGate(snapshot, () => null);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("E_DEMO_NOT_CONFIRMED");
  });
});

describe("T-DEMO 不可变快照存储", () => {
  it("T-DEMO-012 首次写入 status=FROZEN 且带 digest", () => {
    const repo = makeRepo();
    const { snapshot, idempotent } = writeSnapshot(repo, EMPTY_DEMO_GATE);

    expect(idempotent).toBe(false);
    expect(snapshot.status).toBe("FROZEN");
    expect(snapshot.digest).toHaveLength(64);
    expect(
      fs.existsSync(
        path.join(
          repo,
          SCHEME_SNAPSHOT_DIR,
          `${snapshot.confirmation_id}.json`,
        ),
      ),
    ).toBe(true);
  });

  it("T-DEMO-013 同 id + 同内容重放：幂等返回原快照，不覆盖 created_at", () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const first = writeSnapshot(repo, EMPTY_DEMO_GATE, scheme);
    const second = writeSnapshot(repo, EMPTY_DEMO_GATE, scheme);

    expect(second.idempotent).toBe(true);
    expect(second.snapshot.digest).toBe(first.snapshot.digest);
    expect(second.snapshot.created_at).toBe(first.snapshot.created_at);
  });

  it("T-DEMO-013b 重试时重新冻结不改变 digest（updatedAt 不参与摘要）", () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const first = writeSnapshot(repo, EMPTY_DEMO_GATE, freezeScheme(scheme));

    // 模拟网络抖动后的重试：前端拿到的仍是未冻结草案，再次冻结一次
    const retried = freezeScheme({
      ...scheme,
      updatedAt: new Date(0).toISOString(),
    });
    expect(() => writeSnapshot(repo, EMPTY_DEMO_GATE, retried)).not.toThrow();
    const second = writeSnapshot(repo, EMPTY_DEMO_GATE, retried);
    expect(second.idempotent).toBe(true);
    expect(second.snapshot.digest).toBe(first.snapshot.digest);
  });

  it("T-DEMO-013c 冻结不可二次改写：已冻结方案再冻结原样返回", () => {
    const frozen = freezeScheme(makeScheme());
    expect(freezeScheme(frozen)).toBe(frozen);
  });

  it("T-DEMO-014 同 id 但内容变了：抛冲突，绝不覆盖不可变快照", () => {
    const repo = makeRepo();
    writeSnapshot(repo, EMPTY_DEMO_GATE);

    expect(() =>
      writeSnapshot(
        repo,
        EMPTY_DEMO_GATE,
        makeScheme({ title: "另一个方案", summary: "完全不同的方案内容描述" }),
      ),
    ).toThrow(SchemeSnapshotConflictError);

    try {
      writeSnapshot(repo, EMPTY_DEMO_GATE, makeScheme({ title: "第三个方案" }));
    } catch (err) {
      expect((err as SchemeSnapshotConflictError).code).toBe(
        "E_SCHEME_CONFIRMATION_CONFLICT",
      );
    }
  });

  it("T-DEMO-015 损坏/缺失/格式非法的 snapshot_id：读取一律返回 null", () => {
    const repo = makeRepo();
    const { snapshot } = writeSnapshot(repo, EMPTY_DEMO_GATE);

    expect(readSchemeSnapshot(repo, "scheme-confirm-never-written")).toBeNull();

    fs.writeFileSync(
      path.join(repo, SCHEME_SNAPSHOT_DIR, `${snapshot.confirmation_id}.json`),
      "{ not json",
      "utf8",
    );
    expect(readSchemeSnapshot(repo, snapshot.confirmation_id)).toBeNull();

    expect(() => schemeSnapshotPath(repo, "../escape")).toThrow();
  });

  it("T-DEMO-016 快照内容含冻结方案全文与 Demo 事实，可被 Daemon 独立复核", () => {
    const repo = makeRepo();
    const scheme = makeScheme();
    const { snapshot } = writeSnapshot(repo, EMPTY_DEMO_GATE, scheme);
    const loaded = readSchemeSnapshot(repo, snapshot.confirmation_id);

    expect(loaded).not.toBeNull();
    expect(loaded?.scheme.scheme_revision).toBe(scheme.scheme_revision);
    expect(loaded?.scheme.title).toBe(scheme.title);
    expect(loaded?.decision.code).toBe("OK");
    expect(loaded?.status).toBe("FROZEN");
  });
});
