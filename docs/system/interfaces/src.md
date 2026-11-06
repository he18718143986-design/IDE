# src 模块接口

## ContractCard

- **类型**：type
- **签名**：`ContractCard`（`src/lib/contract-card.ts`）= `contract` + `design` + `governance` 三段，`splitContract` / `joinContract` 与合同互逆
- **提供方**：`src` / [`../../../src/lib/contract-card.ts`](../../../src/lib/contract-card.ts)
- **消费方**：`scripts/docs-check/checks.ts`（文档门禁按合同卡校验）
- **引入合同**：`repo-knowledge-baseline`

## ScopePlan

- **类型**：type
- **签名**：`ScopePlan`（`src/lib/journey/scope-plan.ts`）描述本次合同的写范围与派生规则
- **提供方**：`src` / `src/lib/journey/scope-plan.ts`
- **消费方**：`daemon` 的合同签署与 Worktree 创建
- **引入合同**：`repo-knowledge-baseline`

## patchGraphElements

- **类型**：function
- **签名**：`patchGraphElements(cy: Core, diff: GraphElementsDiff): void`，单次 `cy.batch()` 内按「删 → 增 → 更新」执行
- **提供方**：`src` / `src/components/radar/RadarGraph.tsx`
- **消费方**：架构雷达的增量刷新
- **引入合同**：`repo-knowledge-baseline`
