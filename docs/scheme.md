# Stagent 方案（Scheme）· 本项目自身的意图层

> **这份文档是什么**：Stagent 的 Supervisor 读完用户的模糊意图后，要在中栏交出一份「方案」（`SchemeDraftV2` + 证据台账，见 [`specs/supervisor.md`](./specs/supervisor.md) §14.2 / §14.11）。本文就是**用 Stagent 自己的方案格式写成的 Stagent 方案**——既是本项目的意图层，也是 Supervisor 产物的**形态样板**。
> **J.26 分家（2026-11-14）**：本文只保留 L0 意图（§0 原话、§1 目标、§3 模块）。物理指针快照见 [`reports/scheme-physical-pointers.md`](./reports/scheme-physical-pointers.md)；已落盘裁决与其余非 L0 正文见 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)。迁出各节在原位只留指针，不保留重复正文。
> **权威位置**：本文在文档分层里是最上游（L0 意图层，见 [`README.md`](./README.md)）。它回答「用户要什么、为什么」；「怎么做」以 `specs/` 为准，「做到哪了」以任务卡与证据为准。
> **怎么读**：§0 是用户原话，一字不改；§1 目标与 §3 模块每一条都带 `来源` 与 `证据`，能追到 §0 的某句原话（`q*`）。标 `ai_inferred` 的条目是 Agent 的推断，**等用户拍板前不算数**。已落盘裁决与其余非 L0 正文见 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)；物理指针快照见 [`reports/scheme-physical-pointers.md`](./reports/scheme-physical-pointers.md)。

| 字段 | 值 |
| :--- | :--- |
| `scheme_id` | `stagent-self` |
| `scheme_revision` | 3（2026-10-30 目标能力补全：交付全链路） |
| `frozen` | `false`——方案仍在演进；冻结点由用户点「确认方案，开始规划」或（tiny）「确认开工」决定（「确认方案」=密封内部别名） |
| `title` | 只说需求与偏好，其余交给 Agent 的本地编程工作台 |
| `audience` | 能说清「想要什么」、但不想做技术决策的人（含非技术业务用户） |
| `size_hint` | `large` |
| `notes` | （只由用户填写，Agent 不写） |

**`summary`**：用户只描述需求与主观偏好。右栏是不带系统提示的成熟 Agent（Claude Code 等），陪用户只读地自由脑暴；中栏 Supervisor 旁观这段对话，把它整理成**垂直卡片流方案工作台**（画布≠拖拽白板）；用户点「开始规划」或「确认开工」完成密封后，冻结范围即 Worker 唯一写范围（ADR-0018）；需规划时先整理项目地图，再对每份合同「确认开工」；Daemon 用真实命令出证据，用户试玩满意再合入。

---

## 0. 原话摘录区（`quotes[]`）

> 协议：[`specs/intent-compiler-prompt.md`](./specs/intent-compiler-prompt.md) §3——只剪用户消息，一个字都不改；剪最短完整小句；剪不出来就不写。来源轮次 `U1` = 2026-10-29 用户在任务 TINA16-3 中的原始需求。

| qid | from | text |
| :--- | :--- | :--- |
| q1 | U1 | 我认为用户只需要提出项目需求和主观偏好，其他部分能交给Agent的都交给它 |
| q2 | U1 | 最极端的情况是，我只需要输入一个原网站的网址和账号登陆信息，在这个过程中，我没有参与任何技术决策，就可以复刻出一个一模一样的网站。 |
| q3 | U1 | 我希望在https://github.com/tina163apple/IDE 中的stagent中复刻这种能力。 |
| q4 | U1 | 其中右栏需求对话Agent的是 Claude Code（也可以是其他成熟的Agent引擎，比如openhands） |
| q5 | U1 | 它的作用和网页版AI差不多，如果仓库不空，还可以读取仓库的文件，然后和我进行自由对话，不设置系统prompt，目的是让用户和AI进行头脑风暴。 |
| q6 | U1 | 还有一个中栏Agent也是 Claude Code，是supervisor，它会旁观我和右栏需求对话Agent的对话情况，和用户交互的是类似于一个画布canvas。 |
| q7 | U1 | 第三类Agent，是supervisor生成了机器指令直接执行的施工Agent（worktree 里的 施工 Worker）。 |
| q8 | U1 | 我认为本项目就是利用Stagent本身的思想来实现的第一个作品，同理，文档治理其实就是仿照Stagent的supervisor的需求总结步骤。 |
| q9 | U1 | 目前我就是按照docs来进行开发的。 |
| q10 | U1 | 整治后的文档本身，就是 Stagent 的 supervisor 读取用户模糊意图后需要生成的文档的形态样板 |
| q11 | U1 | 过程中不要向我提问，按你的判断做。 |
| q12 | U2 | conf-1：中栏为"意图编译组件"，实现形态开放，不锁死 Claude Code |
| q13 | U2 | conf-5：审阅内容后置到验收幕，保留"确认开工"与"合入"两次授权点击，保护清单等安全门禁不放宽 |
| q14 | U2 | conf-6：为 Worker 开受控只读网络通道，必须绑定凭据保险库（Vault）一起实施，账密禁止进入对话上下文 |
| q15 | U2 | 右栏恢复完全自由对话体验，剥离写死的架构师人设与暗中拼入的消息前缀 |
| q16 | U2 | 选 A——我先在 GitHub 合入 PR #1，之后按白话拍板推进第 2 步。 |
| q17 | U3 | 真正把一个项目做好，不只是把代码写出来，还需要把需求理解、技术方案、功能实现、测试和部署这些环节串起来。 |
| q18 | U3 | 把一个无法掌握的大型 AI 软件项目，变成一组你能够理解、能够验收、能够追踪、能够维护的可控任务。 |
| q19 | U3 | 让"一个人 + AI"的开发团队，在复杂度超过个人脑容量之后，仍然能够掌握整个系统 |
| q20 | U3 | 让一个人也能驾驭 AI 构建的复杂软件。 |
| q21 | U3 | Agent 现在是否能直接照任务无脑开发？ |
| q22 | U4 | 直接对这两个 PR 执行变更，认同三篇 ADR 和两个推荐项 |
| q23 | U5 | 确认路径上 occurrence 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同中同一敏感项再次出现自动放行 |
| q24 | U5 | 第一印象速记窗口不设等待时长、非阻塞、可跳过；用户跳过则直接进入验收决定；用户异议随时经右栏走 user_dispute trigger |
| q25 | U6 | acc-6 判定 = 用户与 AI 对话确认 + 「认可完成」动作落成结构化证据（用户原话 + 版本号 + 时间戳）；AI 只做引导，不做判定；无机器自动对比（不追求像素/DOM 指标）。 |
| q26 | U7 | oq-3 凭据保管口径：① 凭据存 Vault 至用户手动删除（不设自动过期、不按项目联动清理）；② 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密。 |

> `U3` = 2026-10-30 用户提出的目标能力与审计要求（任务 TINA16-3 第三轮）。审计结论见 [`reports/delivery-path-audit.md`](./reports/delivery-path-audit.md)。
> `U4` = 2026-10-30 用户对三篇 ADR（ADR-0015～0017）及两项推荐（SA-1 与凭据钥匙串 OQ-REL-1）的正式授权拍板（原话见 q22）。
> `U5` = 2026-11-01 用户拍板 OP-1「洗白」、OP-13「第一印象窗口不阻塞」、DOC-7 草案升格与 DOC-8/9 RFC 正文清理（原话见 q23、q24）。
> `U6` = 2026-11-01 用户拍板 oq-2 北极星「一模一样」判据：对话试玩 + 结构化证据桩（原话见 q25）。
> `U7` = 2026-11-01 用户拍板 oq-3 凭据保管口径与代登静默重登（原话见 q26）。

**已落盘的用户裁决**（不是本轮原话，但属于 `user_confirmed`，可作证据）：

| 引用名 | 内容 | 落点 |
| :--- | :--- | :--- |
| R-OP28 | 右栏只读白名单 + 自由脑暴定位 | [`ledger/consistency-audit.md`](./ledger/consistency-audit.md) OP-28；[`specs/supervisor.md`](./specs/supervisor.md) §14.5 |
| R-D1…D10 | Supervisor 十项钉死决策 | [`specs/supervisor.md`](./specs/supervisor.md) §7、§17 |
| R-ADR | ADR-0001～0013（均 ACCEPTED） | [`adr/README.md`](./adr/README.md) |
| R-OP1 | 确认路径 occurrence → 洗白 / 授权清单（SA-1 语义） | 本文 §6 dec-10；[`ledger/consistency-audit.md`](./ledger/consistency-audit.md) OP-1；supervisor §14.11 K-12；**实施卡 `TASK-J.20`**（不回写 COMPLETED J.9） |
| R-OP13 | 第一印象速记：不设等待、非阻塞、可跳过 | 本文 §6 dec-11；[`ledger/consistency-audit.md`](./ledger/consistency-audit.md) OP-13；supervisor §13.3 |
| R-OQ2 | 北极星「一模一样」：用户对话试玩 + 结构化证据桩（绑定版本/原话/时间戳） | 本文 §6 dec-12；§8 oq-2；§9 acc-6；[`specs/delivery-lifecycle.md`](./specs/delivery-lifecycle.md) M5 |
| R-OQ3 | oq-3 凭据保管：Vault 存至手动删，cookie 过期 Daemon 静默重登 | 本文 §6 dec-13；§8 oq-3；[`specs/development-tasks-active.md`](./specs/development-tasks-active.md) TASK-L.17a |

---

## 1. 目标（`goals[]`）

| id | text | source | evidence | 现状 |
| :--- | :--- | :--- | :--- | :--- |
| goal-1 | 用户只提出需求和主观偏好；其余能交给 Agent 的都交给 Agent。 | `user_said` | q1 | 方向一致：Supervisor §13.3 把用户决定收窄到五种，且禁止把技术分类推给用户。 |
| goal-2 | **北极星场景**：只给原网站网址与登录信息，用户不参与任何技术决策，就能复刻出一模一样的网站。 | `user_said` | q2 | **当前做不到**，见 conf-5、conf-6、gap-11、gap-12。 |
| goal-3 | 这种能力落在本仓库的 Stagent 里。 | `user_said` | q3 | — |
| goal-4 | Stagent 用自己的思想造自己：本项目是第一个作品。 | `user_said` | q8 | 本文即实践。 |
| goal-5 | 文档就是 Supervisor 产物的样板：文档治理 = Supervisor 的需求总结步骤。 | `user_said` | q8、q10 | 本文 + [`README.md`](./README.md) 分层。 |
| goal-6 | 开发以 `docs/` 为准，所以文档必须可直接当施工依据。 | `user_said` | q9 | 由 README「权威分层」保证。 |
| goal-7 | **目标能力**：把需求理解、技术方案、功能实现、测试、部署串成一条链，交付的是能用的软件而不只是代码。 | `user_said` | q17 | 主干见 [`specs/delivery-lifecycle.md`](./specs/delivery-lifecycle.md)；S3、S4、S7 与测试义务此前空白，本轮补规格与 L 系列卡 |
| goal-8 | 大型项目被拆成一组能理解、能验收、能追踪、能维护的可控任务。 | `user_said` | q18 | [`specs/project-decomposition.md`](./specs/project-decomposition.md)、[ADR-0015](./adr/0015-contract-as-unit-of-delivery.md) |
| goal-9 | 复杂度超过个人脑容量后，一个人仍能掌握整个系统。 | `user_said` | q19、q20 | [`specs/technical-design-and-knowledge.md`](./specs/technical-design-and-knowledge.md)、[ADR-0016](./adr/0016-system-knowledge-base-in-repo.md) |
| goal-10 | 任务卡能被 Agent 直接执行，不需要现场发明。 | `user_said` | q21 | [`specs/task-card-standard.md`](./specs/task-card-standard.md) |

## 2. 不做（`out_of_scope[]`）

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#2-不做out_of_scope](./ledger/scheme-settled-decisions.md#2-不做out_of_scope)）。原位不保留重复正文。

## 3. 模块（`modules[]`）——三个 Agent 加一个裁判

| id | name | purpose | user_visible | source | evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| mod-1 | **右栏 · 需求对话 Agent（AI 搭档）** | 成熟 Agent 引擎（Claude Code，可换 OpenHands 等）。作用像网页版 AI：仓库不空时只读地看文件，和用户自由脑暴。**不设置系统 prompt**，话题由用户主导。 | 是 | `user_said` | q4、q5；R-OP28 |
| mod-2 | **中栏 · Supervisor + 方案画布** | 意图编译组件（形态开放，ADR-0014）。旁观用户与右栏的对话，把它编译成方案；**只通过垂直卡片流画布与用户交互**（非拖拽白板），不在右栏插话。 | 是 | `user_said` | q6；Canvas 定型 2026-10-31 |
| mod-3 | **施工 Worker** | 在 Worktree 里直接执行 Supervisor 生成的机器指令；不聊产品、不扩范围、不合主干。 | 否（用户只看到步骤点亮） | `user_said` | q7；[ADR-0007](./adr/0007-dual-agent-daemon-authority.md) |
| mod-4 | **Daemon（裁判，不是 Agent）** | 确定性宿主程序：状态机、写盘、凭证、真实命令验证、合并放行。三个 Agent 都无权自批、自判、自合。 | 否 | `ai_inferred` | [ADR-0007](./adr/0007-dual-agent-daemon-authority.md)、[ADR-0005](./adr/0005-deterministic-verification-gate.md)；用户原话未提，补上是因为没有它三 Agent 的分权不成立 |
| mod-6 | **项目计划（ProjectPlan）** | 把方案拆成里程碑与合同序列；画布上显示「项目地图」：每份合同在哪一幕、还剩几份。 | 是 | `ai_inferred` | q18；[`specs/project-decomposition.md`](./specs/project-decomposition.md) |
| mod-7 | **系统知识库** | 随代码入库的系统描述：模块地图、技术决策、接口、变更日志。每份合同合入时同步更新，Daemon 校验不漂移。 | 是 | `ai_inferred` | q19；[`specs/technical-design-and-knowledge.md`](./specs/technical-design-and-knowledge.md) |
| mod-8 | **发布（Release）** | 合并之后的独立生命周期：构建、注入配置、部署到用户自有目标、健康检查、回滚。 | 是 | `ai_inferred` | q17「部署」；[`specs/release-and-operations.md`](./specs/release-and-operations.md) |
| mod-5 | **文档体系** | 让 `docs/` 本身就是一份方案：原话 → 目标 → 决策 → 规格 → 任务卡 → 证据 → 台账。 | 是（对开发者） | `user_said` | q8、q10 |

## 4. 流程（`flows[]`）

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#4-流程flows](./ledger/scheme-settled-decisions.md#4-流程flows)）。原位不保留重复正文。

## 5. 实体（`entities[]`）

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#5-实体entities](./ledger/scheme-settled-decisions.md#5-实体entities)）。原位不保留重复正文。

## 6. 决定（`decisions[]`）——Agent 的推荐，等用户拍板

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#6-决定decisionsagent-的推荐等用户拍板](./ledger/scheme-settled-decisions.md#6-决定decisionsagent-的推荐等用户拍板)）。原位不保留重复正文。

## 7. 分歧（`conflicts[]`）——原话与现行规格打架的地方

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#7-分歧conflicts原话与现行规格打架的地方](./ledger/scheme-settled-decisions.md#7-分歧conflicts原话与现行规格打架的地方)）。原位不保留重复正文。

## 8. 待澄清（`open_questions[]`，软提醒，不阻断）

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#8-待澄清open_questions软提醒不阻断](./ledger/scheme-settled-decisions.md#8-待澄清open_questions软提醒不阻断)）。原位不保留重复正文。

## 9. 验收（`acceptance[]`）

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#9-验收acceptance](./ledger/scheme-settled-decisions.md#9-验收acceptance)）。原位不保留重复正文。

## 10. 墓地（`graveyard`）——被否决的方案，不得悄悄复活

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#10-墓地graveyard被否决的方案不得悄悄复活](./ledger/scheme-settled-decisions.md#10-墓地graveyard被否决的方案不得悄悄复活)）。原位不保留重复正文。

## 11. 落差登记——方案 vs 当前代码

> 正文已迁至 [`ledger/scheme-settled-decisions.md`](./ledger/scheme-settled-decisions.md)（[#11-落差登记方案-vs-当前代码](./ledger/scheme-settled-decisions.md#11-落差登记方案-vs-当前代码)）。原位不保留重复正文。

## 12. 本次文档治理的改动范围与验收（`ScopePlan` 示范）

> 正文已迁至 [`reports/scheme-physical-pointers.md`](./reports/scheme-physical-pointers.md)（[#12-本次文档治理的改动范围与验收scopeplan-示范](./reports/scheme-physical-pointers.md#12-本次文档治理的改动范围与验收scopeplan-示范)）。原位不保留重复正文。

## 13. 复用本样板

> 正文已迁至 [`reports/scheme-physical-pointers.md`](./reports/scheme-physical-pointers.md)（[#13-复用本样板](./reports/scheme-physical-pointers.md#13-复用本样板)）。原位不保留重复正文。

