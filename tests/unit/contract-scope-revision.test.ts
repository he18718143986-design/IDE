import { describe, expect, it } from "vitest";
import {
  applyContractScopeChange,
  createContractDraft,
  validateApprovalRevision,
  E_APPROVAL_REVISION_MISMATCH,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

describe("TASK-C.4 Scope 变更与合同版本派生治理规范", () => {
  it("未批准草案（DRAFT）：原地更新可写范围，不自增 revision，不产生版本碎片", () => {
    const draft = createContractDraft({
      title: "草稿任务",
      description: "待审批",
      acceptanceCriteria: ["测试通过"],
      writablePaths: ["src/a.ts"],
    });

    expect(draft.contract_revision).toBe(1);
    expect(draft.lifecycle_state).toBe("DRAFT");
    expect(draft.approval.status).toBe("DRAFT");

    const result = applyContractScopeChange(draft, ["src/a.ts", "src/b.ts"]);

    expect(result.mode).toBe("draft");
    expect(result.previousRevision).toBe(1);
    expect(result.newRevision).toBe(1);
    expect(result.contract.contract_revision).toBe(1);
    expect(
      result.contract.authorization.file_system_scope.writable_paths,
    ).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.contract.lifecycle_state).toBe("DRAFT");
  });

  it("已批准合同（APPROVED）：修改 Scope 强制派生新 Revision 并清空旧审批", () => {
    const draft = createContractDraft({
      title: "已审批任务",
      description: "即将执行",
      acceptanceCriteria: ["测试通过"],
      writablePaths: ["src/a.ts"],
    });

    const approvedContract: SoftwareContract = {
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      contract_revision: 1,
      approval: {
        status: "APPROVED",
        approved_by: "boss@test.com",
        approved_at: new Date().toISOString(),
        approved_revision: 1,
      },
    };

    const result = applyContractScopeChange(approvedContract, [
      "src/a.ts",
      "src/feature.ts",
    ]);

    expect(result.mode).toBe("derive_revision");
    expect(result.previousRevision).toBe(1);
    expect(result.newRevision).toBe(2);
    expect(result.contract.contract_revision).toBe(2);
    expect(result.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(result.contract.approval.status).toBe("PENDING_REVIEW");
    expect(
      "approved_revision" in result.contract.approval
        ? result.contract.approval.approved_revision
        : undefined,
    ).toBeUndefined();
    expect(
      "approved_by" in result.contract.approval
        ? result.contract.approval.approved_by
        : undefined,
    ).toBeUndefined();
    expect(
      result.contract.authorization.file_system_scope.writable_paths,
    ).toEqual(["src/a.ts", "src/feature.ts"]);
  });

  it("同 contract_id + Revision 派生：新修订版保持同一 contract_id 且历史可审计", () => {
    const original = createContractDraft({
      title: "核心模块重构",
      description: "范围变更需保持 ID",
      acceptanceCriteria: ["测试通过"],
      writablePaths: ["src/core.ts"],
    });

    const approved: SoftwareContract = {
      ...original,
      lifecycle_state: "PENDING_APPROVAL",
      contract_revision: 1,
      approval: {
        status: "APPROVED",
        approved_by: "lead@test.com",
        approved_at: new Date().toISOString(),
        approved_revision: 1,
      },
    };

    const res = applyContractScopeChange(approved, [
      "src/core.ts",
      "src/extra.ts",
    ]);
    expect(res.contract.contract_id).toBe(original.contract_id);
    expect(res.contract.contract_revision).toBe(2);
    expect(res.contract.authorization.file_system_scope.writable_paths).toEqual(
      ["src/core.ts", "src/extra.ts"],
    );
  });

  it("旧 Revision 审批失效被拒：旧审批签名在当前 Revision 提交合并时被拒绝 (E_APPROVAL_REVISION_MISMATCH)", () => {
    const contract = { contract_revision: 2 };
    const oldApproval = {
      status: "APPROVED",
      approved_revision: 1,
      approved_by: "boss@test.com",
    };

    const check = validateApprovalRevision(contract, oldApproval);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe(E_APPROVAL_REVISION_MISMATCH);
      expect(check.message).toContain(
        "does not match current contract revision 2",
      );
    }
  });

  it("新 Revision 重新审批通过后：校验成功", () => {
    const contract = { contract_revision: 2 };
    const newApproval = {
      status: "APPROVED",
      approved_revision: 2,
      approved_by: "boss@test.com",
    };

    const check = validateApprovalRevision(contract, newApproval);
    expect(check.ok).toBe(true);
  });

  it("已审批且进入审核状态：变更 Scope 同样强制递增 revision 并要求重审", () => {
    const draft = createContractDraft({
      title: "已交付任务",
      description: "交付完毕后追加范围",
      acceptanceCriteria: ["测试通过"],
      writablePaths: ["src/a.ts"],
    });

    const deliveredContract: SoftwareContract = {
      ...draft,
      lifecycle_state: "AUDITED",
      contract_revision: 3,
      approval: {
        status: "APPROVED",
        approved_revision: 3,
      },
    };

    const result = applyContractScopeChange(deliveredContract, ["src/c.ts"]);
    expect(result.mode).toBe("derive_revision");
    expect(result.previousRevision).toBe(3);
    expect(result.newRevision).toBe(4);
    expect(result.contract.contract_revision).toBe(4);
    expect(result.contract.lifecycle_state).toBe("PENDING_APPROVAL");
    expect(result.contract.approval.status).toBe("PENDING_REVIEW");
  });
});
