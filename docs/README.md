# Stagent 文档地图

> **更新**：2026-10-30（Asia/Hong_Kong）· 第三轮：补全交付全链路（项目分解、技术方案、测试义务、发布运维、卡就绪标准）。第二轮（2026-10-29）按 Supervisor 产物的形态重排。
> **一句话**：这套文档就是 Stagent 的 Supervisor 读完用户模糊意图后**应该交出的东西**。从用户原话出发，逐层推到决策、规格、给 Worker 的任务卡、证据和台账。每层都能往上追到原话，往下追到代码。
> **命名约定**（沿用）：文件名英文 kebab-case，不含版本号与日期；版本流转交给 Git Tag 与 commit 历史；规格文件头标注定稿基线。

---

## 0. 三条铁律

1. **意图看 [`scheme.md`](./scheme.md)，施工看 `specs/` + 任务卡。** 方案说「要什么」；只有 `specs/` 四份现行规范与任务卡能当写代码的依据。
2. **用户说过的才算数。** 任何文档里，Agent 的推断都要标成推断；分歧摆出选项，不替用户选；被否决的方案进墓地，不得悄悄复活。
3. **台账、提案、模板都不是权威。** `ledger/` 是欠账，`rfc/` 是未批准提案，`templates/` 是空白格式。三者与 `specs/`、`adr/` 冲突时，一律以后者为准。

---

## 1. 分层总览：文档 = Supervisor 的产物

用户只管说需求（右栏），Supervisor 旁观并整理成方案（中栏画布），确认后 Worker 在 Worktree 里施工，Daemon 出证据。文档体系照这条链分层：

| 层 | 回答什么 | Supervisor 产物 | 本仓落点 | 谁能改 |
| :--- | :--- | :--- | :--- | :--- |
| **L0 意图** | 用户要什么、为什么；哪些还没定 | 原话摘录 + `SchemeDraftV2` | [`scheme.md`](./scheme.md) | 原话只能追加；`ai_inferred` 条目经用户确认才升格 |
| **L1 决策** | 已拍板、难逆转的技术选择 | `decisions[]`（已确认） | [`adr/`](./adr/README.md) | 只能 SUPERSEDE，不能删改原文 |
| **L2 规格** | 系统必须怎样表现（契约） | 冻结快照 + `ScopePlan` | `specs/`（见 §3） | 走规格修订任务卡 |
| **L3 任务卡** | 交给 Worker 的机器指令 | 合同 + 任务图节点 | [`specs/development-tasks.md`](./specs/development-tasks.md)（就绪标准 [`specs/task-card-standard.md`](./specs/task-card-standard.md)） | 按卡施工；开工前过就绪标准；按 supervisor §10 判定口径回写状态 |
| **L4 证据** | 做到了没有，凭什么说做到了 | `EvidenceBundle` | [`reports/`](./reports/README.md)、[`specs/evidence-and-acceptance-criteria.md`](./specs/evidence-and-acceptance-criteria.md)（现行规格） | 只追加；证据绑定 head SHA |
| **L5 台账** | 还欠什么、谁来定 | `conflicts` / `open_questions` / 挂账 | [`ledger/`](./ledger/README.md) | 只追加；销项要注明 PR |
| 旁支 | 未批准的远期提案 | — | `rfc/`（见 §6） | 立项后才进 L1 / L2 |
| 旁支 | 空白格式 | — | `templates/`（见 §7） | — |

**往上追**：任何规格条款或任务卡，都应能回答「对应 `scheme.md` 哪一条目标或模块」。答不出来的，要么补依据，要么是范围蔓延。
**往下追**：`scheme.md` §11 落差登记把每条目标映射到任务卡；任务卡再绑定测试与证据。

---

## 2. 阅读顺序

**第一次来（人或新会话）**：

1. [`scheme.md`](./scheme.md) — 用户原话、三 Agent 设想、目标能力、待你拍板的分歧（约 15 分钟）
2. [`specs/delivery-lifecycle.md`](./specs/delivery-lifecycle.md) — **总装图**：从一句话到上线的七环、用户触点、追踪链、里程碑 M1～M5
3. [`specs/supervisor.md`](./specs/supervisor.md) 第三部分 §13 — 一个页面、一条旅程、五个决定
4. [`specs/runtime-contract-and-safety.md`](./specs/runtime-contract-and-safety.md) — **写代码前必读**的运行时硬契约
5. [`adr/README.md`](./adr/README.md) — 17 条已拍板决策的索引
6. [`specs/development-tasks.md`](./specs/development-tasks.md) §3.4c（J 系列，含 ADR-0014 修订块）与 §3.4d（L 系列）— 当前要做的卡

**要施工的 Worker**：只读第 2、4、6 项加卡内引用的规格节；开工前用 [`specs/task-card-standard.md`](./specs/task-card-standard.md) 核对卡是否就绪，未就绪不开工；有疑问先查 [`ledger/`](./ledger/README.md) 是否已挂账，不要自行补全。

**要审阅的用户**：只看 [`scheme.md`](./scheme.md) §6～§8（决定、分歧、待澄清）。其余是 Agent 的活。

---

## 3. L2 规格（`specs/`）· 施工权威

### 3.1 权威分层

| 层级 | 管什么 | 文件 | 冲突时 |
| :--- | :--- | :--- | :--- |
| **核心规范（四份）** | 产品与契约 | [`system-architecture.md`](./specs/system-architecture.md)（架构宪法，v1.6.1；§0.2、§7.1 已由 supervisor 取代）· [`supervisor.md`](./specs/supervisor.md)（Supervisor SSOT，第三部分 v2.1 现行）· [`runtime-contract-and-safety.md`](./specs/runtime-contract-and-safety.md)（运行时硬契约）· [`development-tasks.md`](./specs/development-tasks.md)（任务卡与 DAG，v1.6.2） | 上位优先；supervisor §17 与 §7 同级 |
| **交付全链路（2026-10-30）** | 方案之后的环节 | [`delivery-lifecycle.md`](./specs/delivery-lifecycle.md)（总装图）· [`ADR-0018 真相缝`](./adr/0018-intent-to-executable-seal.md) · [`project-architecture-baseline.md`](./specs/project-architecture-baseline.md)（密封后 S3 前置，ADR-0019）· [`project-decomposition.md`](./specs/project-decomposition.md)（S3，ADR-0015；依赖 PAB）· [`technical-design-and-knowledge.md`](./specs/technical-design-and-knowledge.md)（S4，ADR-0016）· [`verification-strategy.md`](./specs/verification-strategy.md)（S6）· [`release-and-operations.md`](./specs/release-and-operations.md)（S7，ADR-0017）· [`task-card-standard.md`](./specs/task-card-standard.md)（卡就绪） | 与四份现行规范同级；冲突时以对应 ADR 为准 |
| **实施口径（附属）** | 某条现行规范的实施细节 | [`scheme-patch-engine.md`](./specs/scheme-patch-engine.md)（supervisor §14.2/14.3/14.11，`TASK-J.9`）· [`intent-compiler-prompt.md`](./specs/intent-compiler-prompt.md)（§14.4～14.9，`TASK-J.10`/J.11）· [`worker-graveyard-gate.md`](./specs/worker-graveyard-gate.md)（§14.11 INV-LEDGER-03，`TASK-J.18`）· [`playtest-self-check.md`](./specs/playtest-self-check.md)（§16.7，`TASK-J.16`） | 以所指上位规格为准 |
| **代码即权威** | 运行时事实 | `src/lib/state/delivery-state.ts`、`src/lib/journey/confirm-scheme-atomic.ts`、`daemon/supervisor/demo/signing-gate.ts`、`daemon/guard/audit-manifest.ts`、`daemon/supervisor/rules-l0.ts`、`src/lib/error-codes.ts` | 代码现状 ≠ 目标规格；差距登记在 supervisor §19 与 [`scheme.md`](./scheme.md) §11 |
| **实施口径（附属）· 证据判定** | 验收材料三态与必填字段 | [`evidence-and-acceptance-criteria.md`](./specs/evidence-and-acceptance-criteria.md) | 从属 ADR-0005 / verification-strategy；〔待补〕项不得假完成 |
| **草案（非依据）** | 待核验 | [`constants-and-paths.md`](./specs/constants-and-paths.md)、[`state-machine-contract.md`](./specs/state-machine-contract.md) | 不得当现行规范引用 |

> 交付全链路实施口径处于「设计定稿 · 待施工」；能力状态以任务卡和验证证据为准。

### 3.2 三个 Agent 在规格里的位置

| 角色 | 用户设想（[`scheme.md`](./scheme.md) mod-1～3） | 现行权威条文 | 已知分歧 |
| :--- | :--- | :--- | :--- |
| 右栏 · 需求对话 Agent | Claude Code 等成熟引擎，只读，不设系统 prompt，自由脑暴 | supervisor §13.2、§14.5；`TASK-J.1` | conf-2（`partner_hint`）、conf-4（人设） |
| 中栏 · Supervisor + 画布 | 也是 Claude Code，旁观对话，只经画布与用户交互 | supervisor §13～§16；ADR-0007 | conf-1（实现方式）、conf-3（借右栏说话） |
| 施工 Worker | Worktree 内执行 Supervisor 生成的机器指令 | runtime §1～§5；ADR-0003、0007、0013 | dec-1（「机器指令」= 合同 + 任务图） |
| Daemon（裁判） | 原话未提，Agent 补上 | ADR-0005、0007 | — |

> `system-architecture.md` §0～§2 与任务卡 C.1 / W.1 / W.5a / C.6 / P.1 / E.1 里「右栏 = Supervisor」或「右栏 = 编码 Worker」的旧叙述，已在文件头加取代说明，原文保留。

---

## 4. L1 决策（`adr/`）· 19 篇

索引见 [`adr/README.md`](./adr/README.md)。0001～0009 抽自架构规范 §8；0010～0013 为 2026-10-27 补录；0014 为三 Agent 拓扑（用户裁决）；0015～0017 为交付全链路（随 2026-10-30 PR 合入生效）；0018 为意图→可签执行物唯一真相缝（绝对榜首，PROPOSED，随本 PR 合入生效）；0019 为项目架构基线（密封之后，PROPOSED，随本 PR 合入生效）。
方案里 `status: pending` 的决定（[`scheme.md`](./scheme.md) §6）经用户拍板后，在此新增 ADR（下一个未使用编号）。

---

## 5. L4 证据与历史签收（`reports/`）

- [`reports/spec-freeze-record.md`](./reports/spec-freeze-record.md) — Spec Freeze 封版索引
- [`reports/v0.1-mainline-milestone.md`](./reports/v0.1-mainline-milestone.md) — v0.1 主路径 Sign-off
- [`reports/v0.1-hardening-closure.md`](./reports/v0.1-hardening-closure.md) — v0.1 硬化收官（Tag `v0.1.0`）
- [`reports/J1-partner-cli-verification-2026-10-28.md`](./reports/J1-partner-cli-verification-2026-10-28.md) — `TASK-J.1` 右栏只读的真实 CLI 验证（替身模型端点）
- [`reports/delivery-path-audit.md`](./reports/delivery-path-audit.md) — 交付全链路审计（2026-10-30）：七环逐环核查、「Agent 能否无脑开发」结论与补全清单
- [`reports/完整诊断修订纪要-2026-10-31.md`](./reports/完整诊断修订纪要-2026-10-31.md) — 完整诊断十四定型（确认开工/D9/Canvas/JourneyStage/等待态；仅文档）

---

## 6. 提案（`rfc/`）· 未批准

| 文件 | 主题 | 状态 |
| :--- | :--- | :--- |
| [`rfc/v0.2-multi-agent-pipeline.md`](./rfc/v0.2-multi-agent-pipeline.md) | v0.2 多 Agent 编译流水线、并行 Worktree、三级信任模型 + 附录 A/B/C | **DEFERRED**（RFC-2026-002）；阶段 0「右栏可写」已进墓地 REJ-001 |
| [`rfc/scheme-snapshot-and-attestation-model.md`](./rfc/scheme-snapshot-and-attestation-model.md) | Scheme 快照 AST、三元哈希绑定、终态清理 | **PROPOSED**（RFC-2026-003）；代码 0 命中 |

---

## 7. 模板（`templates/`）

空白的传统五件套（填写说明、PRD、系统设计、验收矩阵、追溯矩阵），加 [`05-task-card.md`](./templates/05-task-card.md)（任务卡模板，**施工时要用**）。它们与 Supervisor 产物的字段对应关系见 supervisor §14.11 小节 3；**本仓自己的「填好的样板」是 [`scheme.md`](./scheme.md)**，不是这里的空表。写代码、写卡、写验收都不要引用本目录。

---

## 8. 怎么改文档（像 Supervisor 一样改）

| 你要做的事 | 改哪里 | 规则 |
| :--- | :--- | :--- |
| 用户说了新需求或新偏好 | `scheme.md` §0 追加原话，§1～§9 打补丁 | 只增不改原话；新条目标 `user_said` 并引 qid |
| Agent 发现原话与规格打架 | `scheme.md` §7 加冲突卡 | `chosen_id` 留空，等用户选 |
| 用户拍板了一个决定 | 新增 `adr/00NN-*.md`；`scheme.md` 把对应条目改为 `accepted` 并指向 ADR | 被取代的 ADR 标 `SUPERSEDED by`，不删 |
| 用户否决了一个方案 | `scheme.md` §10 墓地加一行 | 写清谁否决、为什么 |
| 规格条款要变 | 先立规格修订任务卡，再改 `specs/` | 实施口径不得反向改上位规格 |
| 卡做完了 | 任务卡状态回写 + `reports/` 或 PR 附证据 | 按 supervisor §10 与 [`evidence-and-acceptance-criteria.md`](./specs/evidence-and-acceptance-criteria.md) 判定，不得假 COMPLETED |
| 发现解决不了的问题 | `ledger/` 加一行 | 必须写清谁来定、判据是什么 |

---

## 9. 已删除或已移动（勿再引用旧路径）

**2026-10-29 移动**：

- `specs/consistency-audit.md` → [`ledger/consistency-audit.md`](./ledger/consistency-audit.md)（台账不是规格）
- `backlog/` → [`ledger/`](./ledger/README.md)（含 `w3-known-gaps.md`）

**更早删除**（原文查 `git log --diff-filter=D -- docs/`）：

- `docs/archive/` 整个目录（含 `supervisor-pre-ssot/`、`claude-code-isolation-design.md` 等过程稿），2026-10-27 移除
- `docs/reports/v0.1-dogfooding-report.md`、`phase-checklist-M1.md` … `M8.md`、`工作台交互走查-2026-10-24.md`、`W5a-真实CLI验证报告-2026-10-21.md`、`stagent-task-flow-and-comparison.md`、5 份 Supervisor stub 短桩，2026-10-25～27 删除
- `docs/tasks/TASK-C.21-未闭环收尾-cursor-brief.md`（一次性执行指令）

**反虚构提醒**：仓库中不存在《产品体验与技术底座设计规范 v1.1》，任何文档或代码注释都不得引用它。
