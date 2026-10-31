# Stagent 合同状态机硬契约

> **状态**：**`[DRAFT / HISTORICAL]`** — 目标规范草案，**不是**现行施工权威
> **声明**：本文件融合了已查证的代码基线与待落地的目标架构设计，未注明的流转规则需在开发期通过测试用例核验并逐步固化。
>
> > **DOC-6 / DOC-7（2026-11-01）**：生命周期迁移的机器可读权威是 [`src/lib/state-machine.ts`](../../src/lib/state-machine.ts)；对外运行时终态口径见 [ADR-0012](../adr/0012-merged-as-terminal-state.md) 与 [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md)。交付投影轨见 [`src/lib/state/delivery-state.ts`](../../src/lib/state/delivery-state.ts) + [`terminal-delivery-closure.ts`](../../src/lib/state/terminal-delivery-closure.ts)（H.2）。**本文不得单独当作现行状态机 SSOT**。升格或并入 runtime 另立卡。

## 0. 两轨关系（DOC-6 · 代码事实）

系统实际有两套相关但不相同的状态面：

| 轨 | 类型 / 模块 | 是否含 `DELIVERED` | 对外终态 |
| :--- | :--- | :--- | :--- |
| **生命周期轨**（合同 lifecycle × approval） | `LifecycleState` + `ApprovalStatus`；校验 [`src/lib/state-machine.ts`](../../src/lib/state-machine.ts) | **否**（9 态止于 `MERGED` / `ABORTED`） | 成功公开终态 = **`MERGED`**（ADR-0012） |
| **交付投影轨**（EO-01 / UI / 归档事务） | `DeliveryState`；[`src/lib/state/delivery-state.ts`](../../src/lib/state/delivery-state.ts) | **是**：`DELIVERED` 仅表示 **MERGED 后归档事务成功** 的内部/投影标记 | 对外文案收敛为 `MERGED`（[`terminal-delivery-closure.ts`](../../src/lib/state/terminal-delivery-closure.ts)；禁止悬空承诺独立 `DELIVERED` 运行时名） |

**关系**：lifecycle 进入 `MERGED` 后，归档流水线（如 `daemon/pipeline/sign-gc.ts`）可尝试 `MERGED → DELIVERED` 投影；**任一步失败则停在 `MERGED`，绝不回退 lifecycle**。这与 ADR-0012「不为 `DELIVERED` 建独立运行时 lifecycle 枚举」一致：`DeliveryState.DELIVERED` ≠ `LifecycleState`。

**注**：`state-machine.ts` **已实现**本文迁移表的核心组合/跃迁校验；本文仍标 DRAFT，是因为全文「目标/待测试固化」叙事未整体升格——以代码 + ADR-0012 + runtime 为准，勿把本文件当第二真相。

## 1. 目标状态空间与终态

```ts
export type LifecycleState =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "PREPARING"
  | "EXECUTING"
  | "VERIFYING"
  | "PENDING_RESUME"
  | "AUDITED"
  | "MERGED"
  | "ABORTED";
```

上述 9 态是**目标生命周期模型**。`DELIVERED` **不是 `LifecycleState`**（亦非 Approval / EvidenceVerdict / Presentation 枚举）；在 **lifecycle 轨**中不设该态（ADR-0012）。归档成功在 **交付投影轨** 可作为 `DeliveryState.DELIVERED` 内部标记（见 §0），**不得**对外冒充第三运行时终态；归档失败也不得把已合并合同回退为其他 lifecycle。

| LifecycleState | 唯一合法 ApprovalStatus | 语义 |
| --- | --- | --- |
| `DRAFT` | `DRAFT` | 方案草案，尚未获得施工审批。草案被丢弃不等同于合同被拒。 |
| `PENDING_APPROVAL` | `PENDING_REVIEW` | 等待用户审批或新版合同重批。 |
| `PREPARING` | `APPROVED` | Daemon 创建/恢复 Worktree 与受控执行环境。 |
| `EXECUTING` | `APPROVED` | Worker 受有效 exec token 约束施工。 |
| `VERIFYING` | `APPROVED` | Daemon 运行验证、Scope 与指纹核验。 |
| `PENDING_RESUME` | `APPROVED` | 安全挂起，等待合法恢复或终止。 |
| `AUDITED` | `APPROVED` | Evidence 已核验，等待合并裁决。 |
| `MERGED` | `APPROVED` | 唯一成功运行时终态。 |
| `ABORTED` | `REJECTED` 或 `APPROVED` | 被拒绝或已获批后安全终止的终态。 |

Evidence 与合同分轨，不得直接替代 lifecycle：

| EvidenceVerdictStatus | 对 lifecycle 的确定性影响 |
| --- | --- |
| `PASSED` | 仅当 Scope/预算/指纹门禁亦通过时，`VERIFYING → AUDITED` 可发生。 |
| `FAILED` | 留在 `VERIFYING` 返工，或按预算/重试规则转 `PENDING_RESUME`。 |
| `BLOCKED` | 必须停止当前施工并转 `PENDING_RESUME` 或 `ABORTED`；不得进入 `AUDITED`。 |
| `STALE` | 已在 `AUDITED` 时必须 `AUDITED → VERIFYING`；合并必须拒绝。 |

## 2. 允许迁移矩阵（目标，待集成测试固化）

未列出的边一律禁止。迁移前后都必须满足第 1 节的 lifecycle × approval 配对。

| From | To | 触发谓词 / 必须动作 |
| --- | --- | --- |
| `DRAFT` | `PENDING_APPROVAL` | 标准方案冻结并提交待审批合同。 |
| `DRAFT` | `PREPARING` | **仅 Fast Path**：`approved_by === "system:fast-path"` 且风险为 `LOW`；必须先建执行环境，不可直进执行。 |
| `DRAFT` | `ABORTED` | 仅当已经创建正式合同后发生终止；若尚未提交合同，记录为草案废弃 `DISCARDED` / `DROPPED`，不改变 ApprovalStatus，也不得伪造 `REJECTED`。 |
| `PENDING_APPROVAL` | `PREPARING` | 用户批准当前 `contract_revision`；Approval 原子置 `APPROVED`。 |
| `PENDING_APPROVAL` | `ABORTED` | 用户拒绝；Approval 原子置 `REJECTED`。 |
| `PREPARING` | `EXECUTING` | Worktree、Gateway、exec token 和锁均已建立。 |
| `PREPARING` | `PENDING_APPROVAL` | 准备失败或授权需重审；Approval 原子回置 `PENDING_REVIEW`。 |
| `PREPARING` | `ABORTED` | Worktree 丢失或不可恢复准备失败；记录 `PREPARATION_INTERRUPTED` 或 `WORKTREE_LOST`。 |
| `EXECUTING` | `VERIFYING` | Worker 停止写入，Daemon 开始真实验证。 |
| `EXECUTING` | `PENDING_RESUME` | 预算、重试、越界、锁或安全熔断；必须吊销 exec token。 |
| `EXECUTING` | `ABORTED` | 用户终止或不可恢复执行故障；清理进程与锁。 |
| `VERIFYING` | `AUDITED` | Evidence 为 `PASSED`，`can_merge === true`，Scope/预算/指纹均通过。 |
| `VERIFYING` | `EXECUTING` | 验证失败但仍有合法返工预算。 |
| `VERIFYING` | `PENDING_RESUME` | 重试/预算耗尽或 Evidence `BLOCKED`。 |
| `VERIFYING` | `ABORTED` | 用户放弃或不可恢复验证故障。 |
| `PENDING_RESUME` | `EXECUTING` | 用户合法恢复，且有效的一次性恢复凭证已换发新的 exec token。 |
| `PENDING_RESUME` | `PREPARING` | 仅 Worktree 缺失但任务分支完好时，自愈重建。 |
| `PENDING_RESUME` | `ABORTED` | 用户放弃或 Worktree/任务分支均丢失。 |
| `AUDITED` | `MERGED` | Daemon 复核 `PASSED` Evidence、非 `STALE`、目标分支未漂移、主树干净后完成 squash merge。 |
| `AUDITED` | `VERIFYING` | Evidence 变 `STALE` 或检测到外部修改；原 Evidence 必须失效。 |
| `AUDITED` | `EXECUTING` | 合法返工被批准且仍处于原合同 Scope/命令子集。 |
| `AUDITED` | `ABORTED` | 用户放弃候选成果。 |

## 3. 标准成功流（目标）

```text
(DRAFT, DRAFT)
  → (PENDING_APPROVAL, PENDING_REVIEW)
  → (PREPARING, APPROVED)
  → (EXECUTING, APPROVED)
  → (VERIFYING, APPROVED)
  → [Evidence PASSED + all merge gates]
  → (AUDITED, APPROVED)
  → [Daemon squash merge]
  → (MERGED, APPROVED)
```

Fast Path 仅可替换首段为：

```text
(DRAFT, DRAFT) → (PREPARING, APPROVED) → (EXECUTING, APPROVED)
```

它绝不授权 `DRAFT → EXECUTING`。

## 4. 回滚与安全中断（Negative Tests 验收目标）

| 条件 | 必须回退/中断动作 |
| --- | --- |
| 准备失败 | `PREPARING → PENDING_APPROVAL` 并把审批重置为 `PENDING_REVIEW`；不得保留旧批准继续施工。 |
| Scope/命令越界 | 阻断本次 I/O → 停 Worker → 吊销 exec token → 清理锁 → `PENDING_RESUME`；ReasonCode 使用 `SCOPE_VIOLATION` 或 `UNAUTHORIZED_COMMAND`。 |
| 预算或验证重试用尽 | 持久化计数并 `→ PENDING_RESUME`；ReasonCode 使用 `BUDGET_EXHAUSTED` 或 `VERIFICATION_RETRY_LIMIT`。 |
| Evidence 失效 | 将 Evidence 置 `STALE`，并从 `AUDITED → VERIFYING`；绝不复用旧 `PASSED` Evidence 合并。 |
| 任务 Worktree 丢失 | 分支仍在则 `PENDING_RESUME → PREPARING` 自愈；分支亦丢失则 `→ ABORTED`，ReasonCode 为 `WORKTREE_LOST`。 |
| 合并后归档失败 | 保持 `MERGED`，记录归档失败；禁止制造 `DELIVERED` 或回退合并。 |

## 5. Forbidden Transitions（Negative Tests 验收目标）

下列非法跃迁是必须由集成测试（Negative Tests）守护的目标不变量。实现完成前不得把它们误宣称为既有代码事实；完成后每一条必须 fail-closed，返回状态迁移拒绝而非静默修正：

1. 任意状态 `→ DRAFT`，包括 `ABORTED → DRAFT`。
2. 任意状态 `→ PENDING_APPROVAL`，除 `DRAFT → PENDING_APPROVAL` 与 `PREPARING → PENDING_APPROVAL`。
3. `DRAFT → EXECUTING`、`DRAFT → VERIFYING`、`DRAFT → AUDITED`、`DRAFT → MERGED`。
4. `PENDING_APPROVAL → EXECUTING`、`→ VERIFYING`、`→ AUDITED`、`→ MERGED`。
5. `PREPARING → VERIFYING`、`→ AUDITED`、`→ MERGED`。
6. `EXECUTING → AUDITED`、`→ MERGED`；执行必须先经过 `VERIFYING`。
7. `VERIFYING → MERGED`；验证通过必须先产生 `AUDITED`。
8. `PENDING_RESUME → VERIFYING`、`→ AUDITED`、`→ MERGED`；恢复必须先回到 `EXECUTING` 或受限的 `PREPARING`。
9. `AUDITED → PENDING_APPROVAL`；扩 Scope、命令或预算必须生成更高 revision 的新合同，而非倒改已审计合同。
10. `MERGED → *` 与 `ABORTED → *`；两者均为终态。合并后缺陷只能开新微合同。
11. 任意 `(lifecycle_state, approval.status)` 不在第 1 节配对表中的组合。
12. 任意 `EvidenceVerdictStatus !== "PASSED"` 却将 `can_merge` 设为 `true`，或用 Worker 自报结果替代 Daemon 生成的 Evidence。

`evaluateSchemeConfirmation` 仅决定方案是否可进入签署/审批链；它不绕过本文件任何合同迁移、Token、Worktree、Evidence 或合并门禁。
