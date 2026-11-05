import { describe, expect, it } from "vitest";
import {
  applyContractScopeChange,
  createContractDraft,
  evaluateScopeChange,
  ScopeChangeForbiddenError,
  E_SCOPE_CHANGE_FORBIDDEN,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  assertApprovalBinding,
  isApprovalCurrent,
} from "../../src/lib/state-machine";

function makeDraft(writablePaths: string[]): SoftwareContract {
  return createContractDraft({
    title: "Scope 治理",
    description: "C.4 Scope 派生",
    acceptanceCriteria: ["测试通过"],
    writablePaths,
  });
}

function withState(
  base: SoftwareContract,
  lifecycle: SoftwareContract["lifecycle_state"],
  approval: SoftwareContract["approval"],
  revision = 1,
): SoftwareContract {
  return {
    ...base,
    lifecycle_state: lifecycle,
    contract_revision: revision,
    approval,
  };
}

describe("TASK-C.4 Scope 变更与合同版本派生治理规范", () => {
  it("未批准草案（DRAFT）：原地更新可写范围，不自增 revision", () => {
    const draft = makeDraft(["src/a.ts"]);
    expect(draft.contract_revision).toBe(1);
    expect(draft.lifecycle_state).toBe("DRAFT");

    const result = applyContractScopeChange(draft, ["src/a.ts", "src/b.ts"]);

    expect(result.mode).toBe("draft");
    expect(result.newRevision).toBe(1);
    expect(result.contract.contract_revision).toBe(1);
    expect(result.contract.lifecycle_state).toBe("DRAFT");
    expect(
      result.contract.authorization.file_system_scope.writable_paths,
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("已批准且处于 PREPARING：派生新 Revision 并清空旧审批（经 §9.1.1 合法边 PREPARING → PENDING_APPROVAL）", () => {
    const approved = withState(makeDraft(["src/a.ts"]), "PREPARING", {
      status: "APPROVED",
      approved_by: "boss@test.com",
      approved_at: new Date().toISOString(),
      approved_revision: 1,
    });

    const result = applyContractScopeChange(approved, [
      "src/a.ts",
      "src/feature.ts",
    ]);

    expect(result.mode).toBe("derive_revision");
    expect(result.previousRevision).toBe(1);
    expect(result.newRevision).toBe(2);
    expect(result.contract.contract_id).toBe(approved.contract_id);
    expect(result.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(result.contract.approval.status).toBe("PENDING_REVIEW");
    expect(result.contract.approval).not.toHaveProperty("approved_by");
    expect(result.contract.approval).not.toHaveProperty("approved_at");
    expect(result.contract.approval).not.toHaveProperty("approved_revision");
    expect(
      result.contract.authorization.file_system_scope.writable_paths,
    ).toEqual(["src/a.ts", "src/feature.ts"]);
  });

  it("已批准合同：AUDITED → PENDING_APPROVAL 非法，Scope 变更被拒绝（Fail-Closed，不产生输出）", () => {
    const audited = withState(
      makeDraft(["src/a.ts"]),
      "AUDITED",
      { status: "APPROVED", approved_revision: 3 },
      3,
    );

    const decision = evaluateScopeChange(audited);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe(E_SCOPE_CHANGE_FORBIDDEN);
    }

    expect(() => applyContractScopeChange(audited, ["src/c.ts"])).toThrow(
      ScopeChangeForbiddenError,
    );
  });

  it("终态与执行中合同：MERGED / ABORTED / EXECUTING / VERIFYING 一律拒绝 Scope 变更", () => {
    const base = makeDraft(["src/a.ts"]);
    const approval = { status: "APPROVED" as const, approved_revision: 1 };
    for (const lifecycle of [
      "MERGED",
      "ABORTED",
      "EXECUTING",
      "VERIFYING",
      "PENDING_RESUME",
    ] as const) {
      const contract = withState(base, lifecycle, approval);
      const decision = evaluateScopeChange(contract);
      expect(decision.ok, lifecycle).toBe(false);
      expect(
        () => applyContractScopeChange(contract, ["src/x.ts"]),
        lifecycle,
      ).toThrow(ScopeChangeForbiddenError);
    }
  });

  it("未批准且已离开草稿/待批阶段：不允许原地修改 Scope", () => {
    const preparing = withState(makeDraft(["src/a.ts"]), "PREPARING", {
      status: "PENDING_REVIEW",
    });
    expect(evaluateScopeChange(preparing).ok).toBe(false);
  });

  it("旧 Revision 审批失效：isApprovalCurrent / assertApprovalBinding 判定为 STALE（生产合并门禁复用）", () => {
    const stale = {
      contract_revision: 2,
      approval: { status: "APPROVED" as const, approved_revision: 1 },
    };
    expect(isApprovalCurrent(stale)).toBe(false);
    const stalePrecheck = assertApprovalBinding(stale);
    expect(stalePrecheck.ok).toBe(false);
    if (!stalePrecheck.ok) {
      expect(stalePrecheck.code).toBe("APPROVAL_REVISION_STALE");
    }

    const fresh = {
      contract_revision: 2,
      approval: { status: "APPROVED" as const, approved_revision: 2 },
    };
    expect(assertApprovalBinding(fresh).ok).toBe(true);
  });

  it("同 contract_id + Revision 派生：新修订版保持同一 contract_id", () => {
    const approved = withState(makeDraft(["src/core.ts"]), "PREPARING", {
      status: "APPROVED",
      approved_by: "lead@test.com",
      approved_at: new Date().toISOString(),
      approved_revision: 1,
    });

    const res = applyContractScopeChange(approved, [
      "src/core.ts",
      "src/extra.ts",
    ]);
    expect(res.contract.contract_id).toBe(approved.contract_id);
    expect(res.contract.contract_revision).toBe(2);
  });
});
