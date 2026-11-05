import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ContractStore,
  IllegalContractTransitionError,
} from "../../daemon/pipeline/contract-store";
import { squashMerge, MergeGateError } from "../../daemon/pipeline/merger";
import {
  applyContractScopeChange,
  createContractDraft,
  ScopeChangeForbiddenError,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import type { EvidenceBundle } from "../../src/lib/evidence.schema";

let repoRoot: string;
let store: ContractStore;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "c4-scope-"));
  store = new ContractStore(repoRoot);
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function persist(
  lifecycle: SoftwareContract["lifecycle_state"],
  approval: SoftwareContract["approval"],
  revision = 1,
) {
  const draft = createContractDraft({
    title: "C.4 持久化",
    description: "Scope 派生经 transition 落盘",
    acceptanceCriteria: ["测试通过"],
    writablePaths: ["src/a.ts"],
  });
  const approvalFull: SoftwareContract["approval"] =
    approval.status === "APPROVED"
      ? {
          approved_by: "boss@test.com",
          approved_at: new Date().toISOString(),
          ...approval,
        }
      : approval;
  return store.save({
    ...draft,
    lifecycle_state: lifecycle,
    contract_revision: revision,
    approval: approvalFull,
  });
}

describe("TASK-C.4 Scope 派生经 transition 落盘 + 合并前审批绑定", () => {
  it("合法派生：PREPARING 已批准 → 经 transition 落盘为 PENDING_APPROVAL/PENDING_REVIEW，旧审批字段清空", () => {
    const current = persist("PREPARING", {
      status: "APPROVED",
      approved_by: "boss@test.com",
      approved_at: new Date().toISOString(),
      approved_revision: 1,
    });
    const result = applyContractScopeChange(current, ["src/a.ts", "src/b.ts"]);
    const saved = store.transition({
      contractId: current.contract_id,
      lifecycleState: "PENDING_APPROVAL",
      approvalStatus: "PENDING_REVIEW",
      nextContract: result.contract,
    });

    expect(saved.contract_revision).toBe(2);
    expect(saved.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(saved.approval.status).toBe("PENDING_REVIEW");
    expect(saved.approval).not.toHaveProperty("approved_revision");
    expect(saved.approval).not.toHaveProperty("approved_by");
    expect(store.get(current.contract_id)?.contract_revision).toBe(2);
  });

  it("非法派生不落盘：AUDITED 已批准的 Scope 变更被拒绝，磁盘合同保持原样", () => {
    const current = persist("AUDITED", {
      status: "APPROVED",
      approved_revision: 1,
    });
    const before = JSON.stringify(store.get(current.contract_id));

    expect(() => applyContractScopeChange(current, ["src/z.ts"])).toThrow(
      ScopeChangeForbiddenError,
    );
    expect(JSON.stringify(store.get(current.contract_id))).toBe(before);
  });

  it("transition 直接提交非法边（AUDITED → PENDING_APPROVAL）：validateTransition 拒绝且不落盘", () => {
    const current = persist("AUDITED", {
      status: "APPROVED",
      approved_revision: 1,
    });
    const before = JSON.stringify(store.get(current.contract_id));
    const forged = {
      ...current,
      contract_revision: 2,
      lifecycle_state: "PENDING_APPROVAL" as const,
      approval: { status: "PENDING_REVIEW" as const },
    };

    expect(() =>
      store.transition({
        contractId: current.contract_id,
        lifecycleState: "PENDING_APPROVAL",
        approvalStatus: "PENDING_REVIEW",
        nextContract: forged,
      }),
    ).toThrow(IllegalContractTransitionError);
    expect(JSON.stringify(store.get(current.contract_id))).toBe(before);
  });

  it("合并生产门禁：旧 revision 审批（approved_revision=1 对 contract_revision=2）被拒绝 APPROVAL_REVISION_STALE", async () => {
    const stale = persist(
      "AUDITED",
      { status: "APPROVED", approved_revision: 1 },
      2,
    );
    const err = await squashMerge({
      repoRoot,
      contractId: stale.contract_id,
      evidence: {} as unknown as EvidenceBundle,
      reviewer: "boss@test.com",
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(MergeGateError);
    expect((err as MergeGateError).code).toBe("APPROVAL_REVISION_STALE");
  });
});
