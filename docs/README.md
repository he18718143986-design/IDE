# Stagent 文档地图

Stagent 是一个本地优先的软件开发工作台：用户用日常语言提出需求，系统把需求整理成方案、拆成可执行的任务卡，再由 Agent 在隔离环境里施工，并用可检查的证据判断能不能合入。文档按这条链分层，从用户原话一直追到规格、任务卡和证据。

本仓库的文档既是 Stagent 自己的施工依据，也是「Supervisor 读完模糊意图后应当交出什么」的样板。下面的地图说明先读哪一份、哪一层说了算。

> **更新**：2026-11-14（TASK-J.26）：删去原 §3 / §8 / §9「已迁走」空壳，文首补项目简介，阅读顺序与决策节去掉硬编码篇数；§3 此前已迁至 [`specs/README.md`](./specs/README.md)，怎么改文档见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)，已删除或已移动的路径见 [`ledger/removed-and-moved.md`](./ledger/removed-and-moved.md)。命名、死引用与硬编码计数由 `check:docs` 校验。
> **上次内容更新**：2026-10-30（Asia/Hong_Kong）· 第三轮：补全交付全链路（项目分解、技术方案、测试义务、发布运维、卡就绪标准）。第二轮（2026-10-29）按 Supervisor 产物的形态重排。
> **一句话**：这套文档就是 Stagent 的 Supervisor 读完用户模糊意图后**应该交出的东西**。从用户原话出发，逐层推到决策、规格、给 Worker 的[任务卡](./glossary.md#任务卡)、证据和台账。每层都能往上追到原话，往下追到代码。
> **命名约定**：文件名英文 kebab-case（小写 ASCII、数字与连字符；`v0.2` 这类版本号可用 `.`）；`reports/` 下的时点快照允许 `-YYYY-MM-DD` 日期后缀；`README.md`、`CONTRIBUTING.md` 为惯例大写名；版本流转交给 Git Tag 与 commit 历史；规格文件头标注定稿基线。

---

## 0. 三条铁律

1. **意图看 [`scheme.md`](./scheme.md)，施工看 `specs/` + 任务卡。** 方案说「要什么」；只有 `specs/` 四份现行规范与任务卡能当写代码的依据。
2. **用户说过的才算数。** 任何文档里，Agent 的推断都要标成推断；分歧摆出选项，不替用户选；被否决的方案进[墓地](./glossary.md#墓地)，不得悄悄复活。
3. **台账、提案、模板都不是权威。** `ledger/` 是欠账，`rfc/` 是未批准提案，`templates/` 是空白格式。三者与 `specs/`、`adr/` 冲突时，一律以后者为准。

---

## 1. 分层总览：文档 = Supervisor 的产物

用户只管说需求（右栏），Supervisor 旁观并整理成方案（中栏画布），确认后 Worker 在 Worktree 里施工，Daemon 出证据。文档体系照这条链分层：

| 层 | 回答什么 | Supervisor 产物 | 本仓落点 | 谁能改 |
| :--- | :--- | :--- | :--- | :--- |
| **L0 意图** | 用户要什么、为什么；哪些还没定 | 原话摘录 + `SchemeDraftV2` | [`scheme.md`](./scheme.md) | 原话只能追加；`ai_inferred` 条目经用户确认才升格 |
| 用户旅程 | 非技术用户会看到什么、要做什么、不必做什么 | — | [`user-journey.md`](./user-journey.md) | 走任务卡修订；不改三条铁律；不宣称未交付能力已交付 |
| 术语表 | 一句话白话定义，并链到现行规格或 ADR | — | [`glossary.md`](./glossary.md) | 定义必须带权威出处链接，不另造定义层 |
| 操作规程 | 业主确认密封与试玩的分步怎么做 | — | [`runbooks/owner-confirm-and-playtest.md`](./runbooks/owner-confirm-and-playtest.md) | 走任务卡修订；不改产品代码；规格仍以 supervisor / playtest-self-check 为准 |
| **L1 决策** | 已拍板、难逆转的技术选择 | `decisions[]`（已确认） | [`adr/`](./adr/README.md) | 只能 SUPERSEDE，不能删改原文 |
| **L2 规格** | 系统必须怎样表现（契约） | 冻结快照 + `ScopePlan` | `specs/`（见 [`specs/README.md`](./specs/README.md)） | 走规格修订任务卡 |
| **L3 任务卡** | 交给 Worker 的机器指令 | [合同](./glossary.md#合同) + 任务图节点 | [`specs/development-tasks.md`](./specs/development-tasks.md)（就绪标准 [`specs/task-card-standard.md`](./specs/task-card-standard.md)） | 按卡施工；开工前过就绪标准；按 supervisor §10 判定口径回写状态 |
| **L4 证据** | 做到了没有，凭什么说做到了 | [`EvidenceBundle`](./glossary.md#evidencebundle) | [`reports/`](./reports/README.md)、[`specs/evidence-and-acceptance-criteria.md`](./specs/evidence-and-acceptance-criteria.md)（现行规格） | 只追加；证据绑定 head SHA |
| **L5 台账** | 还欠什么、谁来定 | `conflicts` / `open_questions` / [挂账](./glossary.md#挂账) | [`ledger/`](./ledger/README.md) | 只追加；销项要注明 PR |
| **L6 系统知识** | 系统由哪些模块组成、每次改动动了谁 | `KnowledgeDelta` | [`system/`](./system/overview.md)（ADR-0016） | 随合同同步；`changelog.md` 由本次合同追加 |
| 旁支 | 未批准的远期提案 | — | `rfc/`（见 §5） | 立项后才进 L1 / L2 |
| 旁支 | 空白格式 | — | `templates/`（见 §6） | — |

**往上追**：任何规格条款或任务卡，都应能回答「对应 `scheme.md` 哪一条目标或模块」。答不出来的，要么补依据，要么是范围蔓延。
**往下追**：原 `scheme.md` §11 落差登记（已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)）把每条目标映射到任务卡；任务卡再绑定测试与证据。

---

## 2. 阅读顺序

**第一次来（人或新会话）**：

1. [`user-journey.md`](./user-journey.md) — 非技术用户会看到什么、要做什么、不必做什么（按七环）
2. [`glossary.md`](./glossary.md) — 术语一句话白话定义与权威出处
3. [`runbooks/owner-confirm-and-playtest.md`](./runbooks/owner-confirm-and-playtest.md) — 业主确认密封与试玩分步（对照面 / 信任档 / 判分与证据表）
4. [`scheme.md`](./scheme.md) — 用户原话、三 Agent 设想、目标能力、待你拍板的分歧（约 15 分钟）
5. [`specs/delivery-lifecycle.md`](./specs/delivery-lifecycle.md) — **总装图**：从一句话到上线的七环、用户触点、追踪链、里程碑 M1～M5
6. [`specs/supervisor.md`](./specs/supervisor.md) 第三部分 §13 — 一个页面、一条旅程、五个决定
7. [`specs/runtime-contract-and-safety.md`](./specs/runtime-contract-and-safety.md) — **写代码前必读**的运行时硬契约
8. [`adr/README.md`](./adr/README.md) — 已拍板决策的索引（篇数以该索引为准，此处不维护数字）
9. [`specs/development-tasks.md`](./specs/development-tasks.md) §3.4c（J 系列，含 ADR-0014 修订块）与 §3.4d（L 系列）— 当前要做的卡

**要施工的 Worker**：只读第 5、7、9 项加卡内引用的规格节；开工前用 [`specs/task-card-standard.md`](./specs/task-card-standard.md) 核对卡是否就绪，未就绪不开工；有疑问先查 [`ledger/`](./ledger/README.md) 是否已挂账，不要自行补全。

**要审阅的用户**：先看 [`user-journey.md`](./user-journey.md)、[`glossary.md`](./glossary.md) 与 [`runbooks/owner-confirm-and-playtest.md`](./runbooks/owner-confirm-and-playtest.md)，再看 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（原 `scheme.md` §6～§8：决定、分歧、待澄清）。其余是 Agent 的活。

---

## 3. L1 决策（`adr/`）

索引见 [`adr/README.md`](./adr/README.md)。0001～0009 抽自架构规范 §8；0010～0013 为 2026-10-27 补录；0014 为三 Agent 拓扑（用户裁决）；0015～0019 **均已 ACCEPTED**（0015～0017：用户原话 q22；0018：合入 `main` @ `931b188` 并经完整诊断加固；0019：随 PR #1 合入并经完整诊断增等待态 UX）。状态以各 ADR 文件头 `> **状态**:` 为准，本段与 [`adr/README.md`](./adr/README.md) 须同步。
方案里 `status: pending` 的决定（见 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)，原 `scheme.md` §6）经用户拍板后，在此新增 ADR（下一个未使用编号，以 [`adr/README.md`](./adr/README.md) 为准）。

---

## 4. L4 证据与历史签收（`reports/`）

> **`reports/` 不作现行施工依据**——只保留签收凭据与时点审计快照；施工认 `specs/` + `adr/`。完整分组索引见 [`reports/README.md`](./reports/README.md)。


- [`reports/spec-freeze-record.md`](./reports/spec-freeze-record.md) — Spec Freeze 封版索引
- [`reports/v0.1-mainline-milestone.md`](./reports/v0.1-mainline-milestone.md) — v0.1 主路径 Sign-off
- [`reports/v0.1-hardening-closure.md`](./reports/v0.1-hardening-closure.md) — v0.1 硬化收官（Tag `v0.1.0`）
- [`reports/j1-partner-cli-verification-2026-10-28.md`](./reports/j1-partner-cli-verification-2026-10-28.md) — `TASK-J.1` 右栏只读的真实 CLI 验证（替身模型端点）
- [`reports/delivery-path-audit.md`](./reports/delivery-path-audit.md) — 交付全链路审计（2026-10-30）：七环逐环核查、「Agent 能否无脑开发」结论与补全清单
- [`reports/full-diagnosis-revision-notes-2026-10-31.md`](./reports/full-diagnosis-revision-notes-2026-10-31.md) — 完整诊断十四定型（确认开工/D9/Canvas/JourneyStage/等待态；仅文档）
- [`reports/dor-readiness-audit-2026-10-31.md`](./reports/dor-readiness-audit-2026-10-31.md) — DoR 全量审计（**时点快照**，基线 `a2fa7df`；不代表当前排期）

---

## 5. 提案（`rfc/`）· 未批准

| 文件 | 主题 | 状态 |
| :--- | :--- | :--- |
| [`rfc/v0.2-multi-agent-pipeline.md`](./rfc/v0.2-multi-agent-pipeline.md) | v0.2 多 Agent 编译流水线、并行 Worktree、三级信任模型 + 附录 A/B/C | **DEFERRED**（RFC-2026-002）；阶段 0「右栏可写」已进墓地 REJ-001 |
| [`rfc/scheme-snapshot-and-attestation-model.md`](./rfc/scheme-snapshot-and-attestation-model.md) | Scheme 快照 AST、三元哈希绑定、终态清理 | **PROPOSED**（RFC-2026-003）；代码 0 命中 |

---

## 6. 模板（`templates/`）

空白的传统五件套（填写说明、PRD、系统设计、验收矩阵、追溯矩阵），加 [`05-task-card.md`](./templates/05-task-card.md)（任务卡模板，**施工时要用**）。它们与 Supervisor 产物的字段对应关系见 supervisor §14.11 小节 3；**本仓自己的「填好的样板」是 [`scheme.md`](./scheme.md)**，不是这里的空表。写代码、写卡、写验收都不要引用本目录。

---

**反虚构提醒**：仓库中不存在《产品体验与技术底座设计规范 v1.1》，任何文档或代码注释都不得引用它。
