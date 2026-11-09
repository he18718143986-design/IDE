# specs/ · 规格层索引（L2 · 施工权威）

> **更新**：2026-11-09 文档治理：自 `docs/README.md` §3 迁入（权威分层与三个 Agent 位置）。总地图仍是 [`../README.md`](../README.md)。
> **历史指针**：`constants-and-paths.md` 与 `state-machine-contract.md` 两份 `[HISTORICAL]` 指针桩已于 2026-11-09 删除。路径与常量以 [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) §10 为准，状态机以 §11 与代码为准。删除记录见 [`../ledger/removed-and-moved.md`](../ledger/removed-and-moved.md)。

---

## 权威分层

| 层级 | 管什么 | 文件 | 冲突时 |
| :--- | :--- | :--- | :--- |
| **核心规范（四份）** | 产品与契约 | [`system-architecture.md`](./system-architecture.md)（架构宪法，v1.6.1；§0.2、§7.1 已由 supervisor 取代）· [`supervisor.md`](./supervisor.md)（Supervisor SSOT，第三部分 v2.1 现行）· [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md)（运行时硬契约；含 §10 路径/常量、§11 状态机 · DOC-7）· [`development-tasks.md`](./development-tasks.md)（任务卡与 DAG，v1.6.2） | 上位优先；supervisor §17 与 §7 同级 |
| **交付全链路（2026-10-30）** | 方案之后的环节 | [`delivery-lifecycle.md`](./delivery-lifecycle.md)（总装图）· [`ADR-0018 真相缝`](../adr/0018-intent-to-executable-seal.md) · [`project-architecture-baseline.md`](./project-architecture-baseline.md)（密封后 S3 前置，ADR-0019）· [`project-decomposition.md`](./project-decomposition.md)（S3，ADR-0015；依赖 PAB）· [`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md)（S4，ADR-0016）· [`verification-strategy.md`](./verification-strategy.md)（S6）· [`release-and-operations.md`](./release-and-operations.md)（S7，ADR-0017）· [`task-card-standard.md`](./task-card-standard.md)（卡就绪） | 与四份现行规范同级；冲突时以对应 ADR 为准 |
| **实施口径（附属）** | 某条现行规范的实施细节 | [`scheme-patch-engine.md`](./scheme-patch-engine.md)（supervisor §14.2/14.3/14.11，`TASK-J.9`）· [`intent-compiler-prompt.md`](./intent-compiler-prompt.md)（§14.4～14.9，`TASK-J.10`/J.11）· [`worker-graveyard-gate.md`](./worker-graveyard-gate.md)（§14.11 INV-LEDGER-03，`TASK-J.18`）· [`playtest-self-check.md`](./playtest-self-check.md)（§16.7，`TASK-J.16`） | 以所指上位规格为准 |
| **代码即权威** | 运行时事实 | `src/lib/state/delivery-state.ts`、`src/lib/journey/confirm-scheme-atomic.ts`、`daemon/supervisor/demo/signing-gate.ts`、`daemon/guard/audit-manifest.ts`、`daemon/supervisor/rules-l0.ts`、`src/lib/error-codes.ts` | 代码现状 ≠ 目标规格；差距登记在 supervisor §19 与 [`scheme.md`](../scheme.md) §11 |
| **实施口径（附属）· 证据判定** | 验收材料三态与必填字段 | [`evidence-and-acceptance-criteria.md`](./evidence-and-acceptance-criteria.md) | 从属 ADR-0005 / verification-strategy；〔待补〕项不得假完成 |

> 交付全链路实施口径处于「设计定稿 · 待施工」；能力状态以任务卡和验证证据为准。

## 三个 Agent 在规格里的位置

| 角色 | 用户设想（[`scheme.md`](../scheme.md) mod-1～3） | 现行权威条文 | 已知分歧 |
| :--- | :--- | :--- | :--- |
| 右栏 · 需求对话 Agent | Claude Code 等成熟引擎，只读，不设系统 prompt，自由脑暴 | supervisor §13.2、§14.5；`TASK-J.1` | conf-2（`partner_hint`）、conf-4（人设） |
| 中栏 · Supervisor + 画布 | 也是 Claude Code，旁观对话，只经画布与用户交互 | supervisor §13～§16；ADR-0007 | conf-1（实现方式）、conf-3（借右栏说话） |
| 施工 Worker | Worktree 内执行 Supervisor 生成的机器指令 | runtime §1～§5；ADR-0003、0007、0013 | dec-1（「机器指令」= 合同 + 任务图） |
| Daemon（裁判） | 原话未提，Agent 补上 | ADR-0005、0007 | — |

> `system-architecture.md` §0～§2 与任务卡 C.1 / W.1 / W.5a / C.6 / P.1 / E.1 里「右栏 = Supervisor」或「右栏 = 编码 Worker」的旧叙述，已在文件头加取代说明，原文保留。

---
