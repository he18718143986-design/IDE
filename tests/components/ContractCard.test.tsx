// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContractCard } from "../../src/components/contract/ContractCard";
import { ScopeList } from "../../src/components/contract/ScopeList";
import { BudgetVisualizer } from "../../src/components/contract/BudgetVisualizer";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

const contract = softwareContractSchema.parse({
  ...createContractDraft({
    title: "审批卡测试",
    description: "验证 Scope 与预算展示",
    acceptanceCriteria: ["npm test 通过"],
    writablePaths: ["src/**"],
    readonlyPaths: ["docs/spec.md"],
    strictlyForbiddenPaths: [".env*", "**/.git/**"],
  }),
  lifecycle_state: "PENDING_APPROVAL",
  approval: { status: "PENDING_REVIEW" },
});

describe("M7 / TASK-C.1 合同审批组件", () => {
  it("展示标题、状态与验证命令", () => {
    render(<ContractCard contract={contract} />);
    expect(screen.getByText("审批卡测试")).toBeInTheDocument();
    expect(screen.getByText("待审批")).toBeInTheDocument();
    expect(screen.getByText(/npm test/)).toBeInTheDocument();
  });

  it("可审批状态点击触发回调", () => {
    const onApprove = vi.fn();
    render(<ContractCard contract={contract} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: "批准并开工" }));
    expect(onApprove).toHaveBeenCalledWith(contract.contract_id);
  });

  it("非待审批状态按钮禁用", () => {
    const executing = softwareContractSchema.parse({
      ...contract,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "t",
        approved_at: new Date().toISOString(),
      },
    });
    render(<ContractCard contract={executing} />);
    expect(screen.getByRole("button", { name: "批准并开工" })).toBeDisabled();
  });

  it("Scope 三分区展示且严禁路径带锁定标识", () => {
    render(<ScopeList scope={contract.authorization.file_system_scope} />);
    expect(screen.getByText(/严禁（锁定）/)).toBeInTheDocument();
    expect(screen.getByText(".env*")).toBeInTheDocument();
    expect(screen.getByText("docs/spec.md")).toBeInTheDocument();
  });

  it("UNAVAILABLE 账单模式给出警示", () => {
    render(
      <BudgetVisualizer
        costLimits={{
          ...contract.authorization.cost_limits,
          accounting_mode: "UNAVAILABLE",
        }}
        budgetLimits={contract.authorization.budget_limits}
      />,
    );
    expect(screen.getByText(/账单模式不可用/)).toBeInTheDocument();
  });
});


describe("TASK-AUDITED.2 / 退回待批按钮", () => {
  const audited = softwareContractSchema.parse({
    ...contract,
    lifecycle_state: "AUDITED",
    approval: {
      status: "APPROVED",
      approved_by: "t",
      approved_at: new Date().toISOString(),
    },
  });

  it("AUDITED+APPROVED 显示「退回待批」并可点击", () => {
    const onReturnToPending = vi.fn();
    render(
      <ContractCard
        contract={audited}
        onReturnToPending={onReturnToPending}
      />,
    );
    const btn = screen.getByTestId("contract-return-to-pending");
    expect(btn).toHaveTextContent("退回待批");
    fireEvent.click(btn);
    expect(onReturnToPending).toHaveBeenCalledWith(audited.contract_id);
  });

  it("PENDING_APPROVAL 不显示「退回待批」", () => {
    render(<ContractCard contract={contract} />);
    expect(screen.queryByTestId("contract-return-to-pending")).toBeNull();
    expect(screen.getByRole("button", { name: "批准并开工" })).toBeEnabled();
  });

  it("AUDITED+APPROVED 时「批准并开工」仍禁用", () => {
    render(<ContractCard contract={audited} />);
    expect(screen.getByRole("button", { name: "批准并开工" })).toBeDisabled();
    expect(screen.getByTestId("contract-return-to-pending")).toBeInTheDocument();
  });
});
