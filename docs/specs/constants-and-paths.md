# Stagent 常量、路径与降级边界契约

> **状态**：**`[DRAFT / HISTORICAL]`** — 目标规范草案，**不是**现行施工权威
> **声明**：本文件融合了已查证的代码基线与待落地的目标架构设计，未注明的流转规则需在开发期通过测试用例核验并逐步固化。
>
> > **DOC-5 / DOC-7（2026-11-01）**：权威路径与签署边界以 [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) 为准；机器可读实现以代码为准（见下方「代码事实快照」）。本文不得单独当作现行路径 SSOT。升格或并入 runtime 另立卡。

## 0. 代码事实快照（DOC-5 · 2026-11-01 实查）

下列以 `main` 代码为准；与本文 §2「目标规范路径」或 runtime 简写冲突时，**以本表 + 代码为准**，并在 ledger 注明「需立卡」项。

| 资产 | 代码事实 | 权威落点 |
| :--- | :--- | :--- |
| 活跃 Worktree 目录 | `.stagent/worktrees/task-{contractId}/`（`daemon/git/worktree-manager.ts`、`daemon/server.ts`、`daemon/editor/launcher.ts`） | 创建/派工主路径 |
| Worktree seal 目录 | `.stagent/worktrees/{contractId}/`（**无** `task-` 前缀；`daemon/guard/worktree-seal.ts`） | **与创建路径不一致** → ledger / 需立卡对齐，本波**不改代码** |
| Demo（遗留入口） | `.stagent/demo/`（`DEMO_ROOT`，`daemon/supervisor/demo/demo-generator.ts`） | 旧生成器仍写 |
| Demo（隔离预览） | `.stagent/prototypes/{prototype_id}/`（`PROTOTYPES_ROOT`，C.11b；runtime § 签署前后表） | 现行隔离 Demo |
| 合并 Git Trailer | `Stagent-Contract-ID` / `Stagent-Evidence-ID` / `Stagent-Evidence-Hash` / `Stagent-Verdict` / `Stagent-Approval-Status` / 可选 `Stagent-Tests-Modified`、人工确认 trailer（`daemon/pipeline/merger.ts`） | 审计侧车；键名以代码为准 |
| 合同 / Evidence 快照 | 目标路径见 §2；落盘实现以 Daemon 实际导出为准 | runtime + 代码 |

**本波不做**：改 `worktree-seal` 前缀、删 `.stagent/demo`、改 trailer 键名——一律挂「需立卡」。

## 1. 已查验代码事实

以下内容已按当前代码基线查验；它们不是新的架构发明。

| 事实 | 当前代码基线 |
| --- | --- | --- |
| 活跃 Demo 入口 | `.stagent/demo/index.html` |
| 合同关联键 | `contract_id`（小写下划线） |
| 方案确认守卫 | `src/lib/journey/scheme-draft.ts::evaluateSchemeConfirmation` |

已查验枚举：

```ts
export type ApprovalStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED";

export type EvidenceVerdictStatus =
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "STALE";
```

## 2. 设计目标 / 硬性约定（待测试固化）

以下路径、格式和限制是本草案要求后续实现并以测试锁定的目标，不得误标为现有代码已完整实现。

| 资产 | 目标规范路径 | 目标规则 |
| --- | --- | --- |
| 合同快照 | `.stagent/contracts/{contract_id}.json` | 仅 Daemon 可写。 |
| Evidence 快照 | `.stagent/evidence/{contract_id}-{evidence_id}.json` | 仅 Daemon 根据真实执行结果写入。 |
| 任务 Worktree | `.stagent/worktrees/{contract_id}/`（**目标简写**；代码活跃路径为 `task-{contract_id}/`，见 §0） | Worker 的唯一业务代码工作目录。 |
| 审计侧车 | `.stagent/records/{contract_id}/audit-manifest.json` | 先脱敏、后落盘；不是防篡改声明。 |

**废止路径**：`.stagent/prototypes/`、`.stagent/metadata/` 以及任何以 `task-{contract_id}` 表达为规范路径的 Worktree/Demo 路径。历史资产迁移须显式立卡；不得在运行时猜测或双写。

## 3. 跨端字段与 Git Trailer（目标约定）

跨端、持久化、HTTP/IPC 和 Git Trailer 的合同关联键统一为小写下划线 `contract_id`。禁止使用 `Contract-Id`、`Contract-ID`、`Stagent-Contract-ID` 或其他大小写/连字符变体作为规范字段。

```ts
/** 任何可关联合同的跨端载荷都使用本字段名。 */
export interface ContractReference {
  contract_id: string;
}

/** Git 提交审计 Trailer 的规范载荷（固定顺序）。 */
export interface MergeTrailerFields {
  contract_id: string;
  evidence_id: string;
  evidence_hash: string;
  verdict_status: EvidenceVerdictStatus;
  approval_status: ApprovalStatus;
  reviewed_by: string;
}
```

规范 Git Trailer 块固定为如下 `key: value` 行，字段名必须原样使用；不得塞入测试日志、JSON 或任意自由文本。

```text
contract_id: <contract_id>
evidence_id: <evidence_id>
evidence_hash: <sha256>
verdict_status: PASSED
approval_status: APPROVED
reviewed_by: <daemon-or-user-identity>
```

Trailer 单行最多 **512 UTF-8 字节**，整个连续 Trailer 块最多 **4096 UTF-8 字节**；任一越界必须拒绝提交，禁止截断。该字节限制是待通过合并集成测试固化的目标约定。

## 4. 证据与执行失败原因码闭集

```ts
export type ApprovalStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED";

export type EvidenceVerdictStatus =
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "STALE";

export type ReasonCode =
  | "SCOPE_VIOLATION"
  | "BUDGET_EXHAUSTED"
  | "WORKSPACE_LOCKED"
  | "UNAUTHORIZED_COMMAND"
  | "VERIFICATION_RETRY_LIMIT"
  | "UNSAFE_EXECUTION"
  | "EVIDENCE_STALE"
  | "PREPARATION_INTERRUPTED"
  | "WORKTREE_LOST";
```

`ReasonCode` 是**证据与执行失败原因码**闭集，不是全系统、前端提示、HTTP API 或 WebSocket 路由的唯一错误码闭集。不得把 Evidence 状态混入合同 lifecycle；新增 ReasonCode 必须先修改本文件、对应 Schema 和测试，再进入实现。

## 5. 方案确认唯一守卫（已查验代码事实）

方案是否可冻结/签署的唯一前置守卫为：

```ts
evaluateSchemeConfirmation(draft, demo): SchemeConfirmationDecision
```

其实现锚点为 `src/lib/journey/scheme-draft.ts`。UI 可以调用它作提前反馈，但 Daemon 的签署判定必须产生与其相同的结论及拒绝码；前端不得以 completeness、局部 disabled 条件或第二套 if 替代该守卫。

## 6. Worker 执行安全边界与降级（目标约定）

当前 v0.1 Worker 的可证明边界是 **Gateway 逻辑拦截（`GATEWAY_ENFORCED`）**，不是 OS 级强隔离。Worktree 仅隔离文件树和 Git 分支，不构成进程、网络、宿主凭据或 syscall 沙盒。

| 运行条件 | 允许声明 | 必须行为 | 禁止声明 |
| --- | --- | --- | --- |
| Gateway 路径/命令/Token 校验可用 | Gateway-enforced | Worker 仅可使用合同 Scope、白名单 argv 与有效 exec token；越界必须拒绝并进入安全挂起链。 | OS sandbox、断网、只读挂载已证明。 |
| OS 只读与断网探针均有成功反向证据 | Gateway-enforced + 平台证明 | 记录平台、探针、时间与证据；只把已证明能力显示为已证明。 | 将单平台证明泛化为所有平台。 |
| OS 沙盒不可应用、启动失败或探针无输出 | `logical_fallback` | 明确记录“未构成只读/断网证明”；不得依据该结果产生安全绿证据。 | “绝不触碰线上业务”、已断网、已只读。 |

降级不是放行：Gateway、Scope、保护清单、Token、Evidence 和合并门禁在 `logical_fallback` 下仍必须生效；只有 OS 级安全承诺被移除。
