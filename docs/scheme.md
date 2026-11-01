# Stagent 方案（Scheme）· 本项目自身的意图层

> **这份文档是什么**：Stagent 的 Supervisor 读完用户的模糊意图后，要在中栏交出一份「方案」（`SchemeDraftV2` + 证据台账，见 [`specs/supervisor.md`](./specs/supervisor.md) §14.2 / §14.11）。本文就是**用 Stagent 自己的方案格式写成的 Stagent 方案**——既是本项目的意图层，也是 Supervisor 产物的**形态样板**。
> **权威位置**：本文在文档分层里是最上游（L0 意图层，见 [`README.md`](./README.md)）。它回答「用户要什么、为什么」；「怎么做」以 `specs/` 为准，「做到哪了」以任务卡与证据为准。
> **怎么读**：§0 是用户原话，一字不改；§1～§9 每一条都带 `来源` 与 `证据`，能追到 §0 的某句原话（`q*`）或某份已落盘的裁决。标 `ai_inferred` 的条目是 Agent 的推断，**等用户拍板前不算数**。

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

> `U3` = 2026-10-30 用户提出的目标能力与审计要求（任务 TINA16-3 第三轮）。审计结论见 [`reports/delivery-path-audit.md`](./reports/delivery-path-audit.md)。
> `U4` = 2026-10-30 用户对三篇 ADR（ADR-0015～0017）及两项推荐（SA-1 与凭据钥匙串 OQ-REL-1）的正式授权拍板（原话见 q22）。
> `U5` = 2026-11-01 用户拍板 OP-1「洗白」、OP-13「第一印象窗口不阻塞」、DOC-7 草案升格与 DOC-8/9 RFC 正文清理（原话见 q23、q24）。

**已落盘的用户裁决**（不是本轮原话，但属于 `user_confirmed`，可作证据）：

| 引用名 | 内容 | 落点 |
| :--- | :--- | :--- |
| R-OP28 | 右栏只读白名单 + 自由脑暴定位 | [`ledger/consistency-audit.md`](./ledger/consistency-audit.md) OP-28；[`specs/supervisor.md`](./specs/supervisor.md) §14.5 |
| R-D1…D10 | Supervisor 十项钉死决策 | [`specs/supervisor.md`](./specs/supervisor.md) §7、§17 |
| R-ADR | ADR-0001～0013（均 ACCEPTED） | [`adr/README.md`](./adr/README.md) |
| R-OP1 | 确认路径 occurrence → 洗白 / 授权清单（SA-1 语义） | 本文 §6 dec-10；[`ledger/consistency-audit.md`](./ledger/consistency-audit.md) OP-1；supervisor §14.11 K-12；**实施卡 `TASK-J.20`**（不回写 COMPLETED J.9） |
| R-OP13 | 第一印象速记：不设等待、非阻塞、可跳过 | 本文 §6 dec-11；[`ledger/consistency-audit.md`](./ledger/consistency-audit.md) OP-13；supervisor §13.3 |

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

| id | text | source | evidence |
| :--- | :--- | :--- | :--- |
| oos-1 | v0.1 不做多 Worktree 并行施工；单工作区互斥。 | `user_confirmed` | [ADR-0002](./adr/0002-single-workspace-mutex.md) |
| oos-2 | 不宣称 OS 级安全容器；Worktree 只是文件与分支隔离。 | `user_confirmed` | [ADR-0003](./adr/0003-worktree-capability-boundary.md) |
| oos-3 | 不上云：代码与意图不出本机；本地 JSON 不承诺防篡改。 | `user_confirmed` | [ADR-0006](./adr/0006-local-first-no-tamper-proof.md) |
| oos-4 | 不为了「少打扰用户」而放宽底层门禁；允许降频/合并/延后卡片。 | `user_confirmed` | [ADR-0001](./adr/0001-target-user-positioning.md)「单向约束」+体验层弹性 |

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

**flow-1 · 从一句话到合入**（四幕以 [`specs/supervisor.md`](./specs/supervisor.md) §13.4 / §16 为准）

| # | actor | action | module |
| :--- | :--- | :--- | :--- |
| 1 | 用户 | 在右栏随便聊需求与偏好（可给网址、参考、截图） | mod-1 |
| 2 | 右栏 Agent | 只读地看仓库，发散、追问、解释；不宣称方案已改 | mod-1 |
| 3 | Supervisor | 旁观每一条**用户**消息，增量编译方案补丁（`SchemePatch`） | mod-2 |
| 4 | Supervisor | 在画布上呈现：摘要、图、决议区、改动范围与验收方式、Demo | mod-2 |
| 5 | 用户 | 在画布上拍板分歧、点头范围、点「开始规划」（若需）与「确认开工」 | mod-2 |
| 6 | Daemon | 冻结快照，从 `ScopePlan` 确定性生成合同，签发执行凭证 | mod-4 |
| 7 | Worker | 在 Worktree 内按机器指令施工、自测 | mod-3 |
| 8 | Daemon | 跑真实验证命令，产出 Evidence，点亮任务图 | mod-4 |
| 9 | 用户 | 试玩；说「这里不对」或「合入项目」 | mod-2 |
| 10 | Daemon | 合并，终态 `MERGED` | mod-4 |

**flow-2 · 文档治理（本文的产生方式）**：用户一句模糊意图（U1）→ Agent 通读 `docs/` → 剪原话（§0）→ 写目标与模块（§1～§3）→ 把与现行规格的冲突摆进决议区（§6、§7）→ 把落差映射到任务卡（§9）→ 用户审阅 PR（= 「确认开工」语义）。

## 5. 实体（`entities[]`）

| id | name | fields_hint | 权威定义 |
| :--- | :--- | :--- | :--- |
| ent-1 | 方案 `SchemeDraftV2` | goals / out_of_scope / modules / flows / entities / decisions / conflicts / open_questions / acceptance | [`specs/supervisor.md`](./specs/supervisor.md) §14.2 |
| ent-2 | 方案补丁 `SchemePatch` | base_revision / ops[] / evidence | 同上 §14.3；[`specs/scheme-patch-engine.md`](./specs/scheme-patch-engine.md) |
| ent-3 | 证据台账 `EvidenceLedger` | claims / decisions / graveyard / attributions | 同上 §14.11 |
| ent-4 | 改动范围 `ScopePlan` | areas / never_touch / needs_approval / verification / budget | 同上 §15 |
| ent-5 | 合同（= 给 Worker 的机器指令） | scope / commands / authorization | [`specs/runtime-contract-and-safety.md`](./specs/runtime-contract-and-safety.md) §1 |
| ent-6 | Evidence | verdict.status: PASSED / FAILED / BLOCKED / STALE | [ADR-0005](./adr/0005-deterministic-verification-gate.md) |

## 6. 决定（`decisions[]`）——Agent 的推荐，等用户拍板

> `status: pending` = Agent 推荐、用户未表态；拍板后升格为 ADR（见 [`README.md`](./README.md)「怎么改文档」）。

| id | question | recommended | alternatives | rationale | risk | status | evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| dec-1 | 「Supervisor 生成的机器指令」具体是什么？ | 签署后的**合同 + 任务图节点**：Supervisor 起草，用户在画布确认，Daemon 派发给 Worker。 | Supervisor 直接给 Worker 发自由文本 prompt | 后者让「提建议的人」同时指挥执行，ADR-0007 分权失效。前者与 q7「直接执行」不冲突：用户确认后无需再介入。 | low | `user_confirmed` | q7、q13；ADR-0007 |
| dec-2 | 用户的「主观偏好」放在方案哪里？ | 作为 `goals` / `acceptance` 中 `check: playtest` 的条目，由用户试玩判定。 | 单独建偏好字段 | 偏好只能由人判，正好对应试玩验收；不必扩 Schema。 | low | `user_confirmed` | q1、q13 |
| dec-3 | 三 Agent 拓扑要不要写成 ADR？ | 本方案确认后写 ADR-0014「三 Agent 拓扑与意图编译组件化：中栏形态开放 / 右栏无系统提示脑暴 / Worktree Worker 隔离施工」。 | 只留在本文 | ADR 才能单独 supersede ADR-0007 中「需求 AI 与 Supervisor 允许共用会话」一句。 | high | `user_confirmed` | q4～q7、q12；ADR-0014 |
| dec-5 | 大需求怎么拆？ | 项目 → 里程碑 → 合同 → 任务节点四级；合同是最小可验收交付单元，一轮一份，串行执行。 | 一份大合同并行多 Worker（RFC v0.2 §5） | 单工作区互斥（ADR-0002）仍成立；合同小才能逐份验收与回滚。 | high | `user_confirmed` | q18、q22；[ADR-0015](./adr/0015-contract-as-unit-of-delivery.md) |
| dec-6 | 技术决策记在哪里，用户才能在复杂度上升后仍掌握系统？ | 目标项目仓库内的 `docs/system/`：模块地图 + 决策记录 + 接口 + 变更日志，随每份合同更新，Daemon 校验覆盖。 | 记在 `.stagent/`（本地、不入库） | `.stagent/` 被 `.git/info/exclude` 排除，换机即丢，且不随代码评审。 | high | `user_confirmed` | q19、q22；[ADR-0016](./adr/0016-system-knowledge-base-in-repo.md) |
| dec-7 | 部署放在合同状态机里，还是单独一条生命周期？ | 单独的 Release 生命周期，引用已合并的提交；`MERGED` 仍是合同唯一终态。 | 在合同状态机 `MERGED` 之后加 `DEPLOYED` | 不破坏 ADR-0012；一次发布可包含多份合同，失败回滚不应解开已合并的合同。 | high | `user_confirmed` | q17、q22；[ADR-0017](./adr/0017-release-lifecycle-after-merge.md) |
| dec-8 | ADR-0014「只保留两次点击」下，涉及保护清单的改动怎么授权？（SA-1） | 敏感项默认排除出范围；只有用户原话点名时才进审批，开工按钮一次点击一并授权并带入 plan_digest。 | 保留逐项「可以/不行」 | 守住两次点击，也不放宽保护清单：物理门禁绝不放行未获授权的敏感写入。 | high | `user_confirmed` | q13、q22；[`specs/delivery-lifecycle.md`](./specs/delivery-lifecycle.md) §5 |
| dec-9 | 凭据保险库（Vault）选择哪种存储后端？（OQ-REL-1） | 系统钥匙串（OS Keychain）：本地开发最安全、防明文泄露能力最强，Worker 运行时只受控注入环境变量。 | 加密 JSON 文件；第三方托管服务 | 系统钥匙串避免明文或对称秘钥落盘在目标仓库或 .stagent/，符合零凭据落盘原则。 | low | `user_confirmed` | q14、q22；[`specs/release-and-operations.md`](./specs/release-and-operations.md) §4.1 |
| dec-4 | `development-tasks.md`（约 460KB）要不要拆？ | 拆成「卡号索引 + 活跃卡 + 已完成卡 + 修订流水」，卡号不变。 | 维持单文件 | 约 65% 是已完成卡的历史，仍要执行的 J 系列只占约 15%；但拆分会与正在进行的 PR 冲突，需择时。 | low | `user_confirmed` | q9；[`ledger/README.md`](./ledger/README.md) DOC-1 |
| dec-10 | 确认路径上 `occurrence` 是否保留（OP-1「洗白面」）？ | **洗白**：确认路径 `occurrence` 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同中同一敏感项再次出现自动放行（对齐 supervisor §14.11 K-12「显式风险」与 SA-1 授权清单语义）。落地细节（白名单存储位置、scope 粒度、失效条件）由实施卡 **`TASK-J.20`** 确定（J.9 已 COMPLETED，不回写）；本裁决只定方向。 | 取消确认路径 `occurrence`；或另建独立白名单字段、与 quote 锚点脱钩 | 与 dec-8 / SA-1「原话点名 → 开工一并授权」同向；复活路径仍按 K-12 忽略 `occurrence`（取最后一处）。 | high | `user_confirmed` | **用户拍板 2026-11-01**；原话 q23：「确认路径上 occurrence 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同中同一敏感项再次出现自动放行」。**实施卡：`TASK-J.20`**（存储/scope/失效；跨合同≠永久免检；**不**重开本裁决、**不**回写 J.9） |
| dec-11 | 第一印象速记窗口要不要计时阻塞（OP-13）？ | **不阻塞**：不设等待时长；可选速记提示；可跳过；跳过则直接进入验收决定；异议随时经右栏走 `user_dispute` trigger。 | 设固定计时窗口后再入账 | 不新增决定类型、不挡「合入 / 这里不对」；与 §13.3「五种决定」纪律一致。 | low | `user_confirmed` | **用户拍板 2026-11-01**；原话 q24：「第一印象速记窗口不设等待时长、非阻塞、可跳过；用户跳过则直接进入验收决定；用户异议随时经右栏走 user_dispute trigger」 |

## 7. 分歧（`conflicts[]`）——原话与现行规格打架的地方

> 冲突卡只摆事实与选项，`chosen_id` 一律为空：**Agent 不替用户选**（INV-LEDGER-02 代选择阻断）。

| id | question | 选项 A | 选项 B | chosen_id | evidence / 用户裁决依据 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| conf-1 | 中栏 Supervisor 用什么实现？ | **Claude Code 只读会话**做编译器，输出仍限定为 `SchemePatch` JSON，经 Daemon 确定性合并（q6） | 维持现状：规则 L0（`daemon/supervisor/rules-l0.ts`）+ 单次模型增强（`enrich-openai.ts`），模块受零工具 AST lint 约束 | **裁决：形态开放** | q12 用户拍板：中栏为"意图编译组件"，实现形态开放，不锁死 Claude Code，只要能产出结构化施工指令即可，立项 ADR-0014 |
| conf-2 | 右栏「不设置系统 prompt」与 `partner_hint` 通道 | 删掉 `partner_hint`：右栏不注入方案摘要、冲突或编译器提示（与 supervisor §14.5 一致） | 保留 `partner_hint` 作为可选的窄通道（intent-compiler §5.2、supervisor §14.3） | **选项 A** | q5、q15 用户拍板：剥离暗中拼入的消息与前缀，右栏保持纯粹只读自由对话 |
| conf-3 | Supervisor 只经画布说话，还是也借右栏说话？ | 只经画布：§16.3 / §16.5 / §16.7 里「右栏插入系统消息」「搭档一句话确认」改为画布卡片 | 允许少量右栏系统消息 | **选项 A** | q6 用户原话：中栏 Supervisor 只通过画布（canvas）交互，不在右栏插话 |
| conf-4 | 右栏 Agent 的人设 | 无人设：按原样使用引擎（q5 原话「不设置系统prompt」） | 保留「懂产品的高级架构师」定位（supervisor §13.2） | **选项 A** | q5、q15 用户拍板：剥离高级架构师写死人设，按原样使用成熟 Agent 引擎自由脑暴 |
| conf-5 | 「不参与任何技术决策」与现行审批点 | 技术选择一律由 Supervisor 给推荐并默认采纳；用户只在**不可逆或越权**处点头（敏感路径、扩范围、超预算） | 维持现行：`needs_approval` 逐项表态、D-1 冲突二选一、PAUSED 菜单 | **裁决：分级委托** | q13 用户拍板：审阅内容（路径树、技术细节）后置到验收幕；合同级"确认开工"与"合入"保留；需规划时方案幕另用"开始规划"（密封≠开工）；底层物理保护清单与写白名单不放宽 |
| conf-6 | 复刻网站需要联网与登录凭据，现行工具集全部禁网 | 为「读参考站」单独设计受控能力：只读抓取、凭据走 Daemon 托管、不进合同与日志 | 维持禁网：北极星场景暂不支持 | **裁决：受控+Vault** | q14 用户拍板：为 Worker 开受控只读网络通道，必须强绑定凭据保险库（Vault）一起实施，账密严禁进入对话上下文 |
| conf-7 | 右栏能否只读执行命令（如 `git log`）辅助脑暴？ | 不能：维持 J.1 的 `Read,Glob,Grep` 精确白名单 | 能：增加只读命令白名单 | **选项 A** | q5、R-OP28：右栏严格只读防穿透，维持精确文件读取白名单 |

## 8. 待澄清（`open_questions[]`，软提醒，不阻断）

| id | text | 阻断级别 | evidence |
| :--- | :--- | :--- | :--- |
| oq-1 | 右栏是否允许用户切换为 OpenHands 等其他引擎？若允许，「只读」由谁保证？（现行：做不到只读的适配器不得作右栏） | NON_BLOCKER | q4；supervisor §13.2 |
| oq-2 | 北极星场景里的「一模一样」用什么判定：像素对比、DOM 结构、还是用户试玩？ | BLOCKER（对 goal-2） | q2 |
| oq-3 | 登录信息属于用户秘密：保存多久、谁能读、是否允许进入 Worker 环境？ | BLOCKER（对 goal-2） | q2；README「凭据」边界 |
| oq-4 | 中栏 Supervisor 若改为 Claude Code，三维预算熔断（ADR-0004）如何对它计账？ | NON_BLOCKER | q6；ADR-0004 |

## 9. 验收（`acceptance[]`）

| id | text | check | 绑定 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| acc-1 | 右栏 Agent 无法写文件、跑 shell、联网。 | `auto` | `tests/integration/partner-readonly.test.ts`；[`reports/J1-partner-cli-verification-2026-10-28.md`](./reports/J1-partner-cli-verification-2026-10-28.md) | PASS（替身模型）；真 Key 补验挂账 OP-28 |
| acc-2 | 右栏 Agent 启动参数中没有任何系统提示注入。 | `auto` | 待写：断言 `buildLaunch` 的 argv 不含 `--system-prompt` / `--append-system-prompt` | ⏳ |
| acc-3 | Supervisor 的一切输出只出现在中栏画布。 | `playtest` | supervisor §18 J 系列 | ⏳ |
| acc-4 | 方案里每条 `user_said` 条目都能在原话中找到逐字子串。 | `auto` | INV-LEDGER-01；本文 §0 可用同一规则自检 | 本文已人工核对 |
| acc-5 | Worker 只在 Worktree 与合同范围内写盘。 | `auto` | Gateway / P.1 现有测试 | PASS |
| acc-7 | 每份合同的验收条目（`check: auto`）都有至少一条测试，且该测试在基线上失败、在候选上通过。 | `auto` | [`specs/verification-strategy.md`](./specs/verification-strategy.md) §3；TASK-L.3、L.4 | ⏳ |
| acc-8 | 合入后知识库覆盖本次改动的全部文件。 | `auto` | [`specs/technical-design-and-knowledge.md`](./specs/technical-design-and-knowledge.md) §4.4；TASK-L.12（[#47](https://github.com/he18718143986-design/IDE/pull/47)/`39f426a`；KB-1 全量文件） | 机制已落地（单测 TD-06～08/10）；端到端产品验收仍 ⏳ |
| acc-9 | 一次发布失败后自动回到上一个 LIVE 版本。 | `auto` | [`specs/release-and-operations.md`](./specs/release-and-operations.md) §1、§3.3；TASK-L.15 | ⏳ |
| acc-6 | 北极星：给网址 + 登录信息，用户只回答偏好问题，产出站点经试玩认可。 | `playtest` | 无（依赖 conf-6、oq-2、oq-3） | ⏳ |

---

## 10. 墓地（`graveyard`）——被否决的方案，不得悄悄复活

> 规则：INV-LEDGER-03。要复活必须走逃生口，由用户显式重开。

| rejected_id | proposal | rejected_by | rejection_reason | evidence |
| :--- | :--- | :--- | :--- | :--- |
| REJ-001 | 右栏 Agent 可直接改主干（Vibe 模式，自动快照兜底） | user | 违反签署分水岭；右栏定位是只读脑暴 | R-OP28；J.1（PR #29 / #30）；RFC v0.2 §3.1 阶段 0 仍保留旧写法 |
| REJ-002 | 右栏就是 Supervisor 本体 | user | Supervisor 在幕后旁观，只经中栏呈现 | q6；supervisor §13.2；architecture §0.2 步骤一旧写法 |
| REJ-003 | 用 `--bare` 启动 Claude Code | user | `--bare` 会跳过 hooks，越界写失去防护 | [ADR-0013](./adr/0013-cli-isolation-without-bare.md) |
| REJ-004 | Demo 作为开工硬前置 | user | Demo 是体验增强项 | [ADR-0010](./adr/0010-demo-optional-not-hard-gate.md) |
| REJ-005 | 独立的 `DELIVERED` 终态 | user | `MERGED` 是唯一运行时终态 | [ADR-0012](./adr/0012-merged-as-terminal-state.md) |
| REJ-006 | 每个任务图节点一个 Git commit 作为点亮依据 | user | 改为三证 + 变更指纹 | [ADR-0009](./adr/0009-serial-graph-fingerprint.md) |
| REJ-007 | 审计侧车放 `.stagent/metadata/` | user | 统一到 `.stagent/records/{contract_id}/` | [ADR-0011](./adr/0011-audit-sidecar-records-path.md) |
| REJ-008 | 「≤2 轮问卷」门控与 Studio 五视口日常入口 | user | 单页方案工作台取代 | supervisor §0、TASK-C.18 |

---

## 11. 落差登记——方案 vs 当前代码

> 这是给 Worker 的「还差什么」。卡号以 [`specs/development-tasks.md`](./specs/development-tasks.md) 为准；supervisor §19 的 L-01～L-10 不在此重复。
>
> **2026-11-01 回写**：下表已按 main tip `39f426a`（含 J.2～J.10、J.18a～d、L.1～L.12、**L.14** 合入；另含 #28～#47 文档/实现）回写「当前代码事实」；管道口径对齐 [ADR-0018](./adr/0018-intent-to-executable-seal.md)（确认 → Seal MachineFace → PAB → ProjectPlan → Worker；禁确认路径 `buildL0Plan(chat)`）。未合实现卡（如 L.13～）不得标关闭；Sprint 指向 **L.13**。

| id | 方案要求 | 当前代码事实 | 对应卡 / 台账 |
| :--- | :--- | :--- | :--- |
| gap-1 | 右栏只读 | 已实现：`ClaudeCodeAdapter` `role: "partner"`，工具白名单 `Read,Glob,Grep` | **已关闭代码落差**：`TASK-J.1` **COMPLETED**（[#29](https://github.com/he18718143986-design/IDE/pull/29) / `4144a20`）；真 Key 补验仍挂账 OP-28 |
| gap-2 | 右栏无系统提示 | **代码已收口（L.1）**：去掉保护清单消息前缀与右栏系统提示注入；`buildProtectionPromptNotice` 已不在热路径。acc-2 自动化断言仍待补 | `TASK-L.1` **COMPLETED**（[#9](https://github.com/he18718143986-design/IDE/pull/9) / `8eb6896`）；见 conf-2、conf-4 |
| gap-3 | 中栏 Supervisor 是 Claude Code | **代码已收口（J.10）**：意图编译器生成端 + Daemon 编译循环已合入（journey → `notifyUserTurnCommitted`）；规则 L0 仅作离线兜底。形态仍开放（conf-1 / ADR-0014） | `TASK-J.10` **COMPLETED**（[#17](https://github.com/he18718143986-design/IDE/pull/17) / `97bb0db`）；conf-1；**由 [ADR-0018](./adr/0018-intent-to-executable-seal.md) 封印（编译结果须经密封进入签署）** |
| gap-4 | Supervisor 只经画布交互 | `JourneyStage` 已由 Daemon 投影并随 `STATE_CHANGED` 下发（J.8）；J.7 交接改为中栏画布卡片、右栏 0 系统消息。规格 §16 旧「右栏插话」叙述仍待正文扫尾 | `TASK-J.8`/`J.7` **COMPLETED**（[#10](https://github.com/he18718143986-design/IDE/pull/10)/[#13](https://github.com/he18718143986-design/IDE/pull/13)）；conf-3 |
| gap-5 | 机器指令 = 合同 + 任务图；确认冻 MachineFace | **主链已落地**：`ScopePlan` 纯函数→预检→确认谓词→快照绑定→确认接线→中栏白话区块（J.2～J.6）；意图编译器生成端已合入（J.10）。签署路径禁止聊天直推写范围（[ADR-0018](./adr/0018-intent-to-executable-seal.md) INV-SEAL-01～03：禁 `buildL0Plan(chat)`；用户确认方案 → Seal 冻 UserFace+MachineFace → 其后 PAB / ProjectPlan / Worker） | `TASK-J.2`～`J.6` **COMPLETED**（[#4](https://github.com/he18718143986-design/IDE/pull/4)～[#7](https://github.com/he18718143986-design/IDE/pull/7)、[#11](https://github.com/he18718143986-design/IDE/pull/11)）；`TASK-J.10` **COMPLETED**（[#17](https://github.com/he18718143986-design/IDE/pull/17) / `97bb0db`） |
| gap-6 | 墓地拦截 Worker 复活被否决方案 | **已收口**：G-MATCH / 产出物投影（J.18a）；合同 `scheme_binding` + 快照 1.2 墓地权威源（J.18b，GAP-W1/W2）；门禁裁决 / 优先级格 / 派工绑定（J.18c）；写路径接线 / CLI pack / 全量扫描（J.18d，GAP-W3/W4/W6）。母卡 `TASK-J.18` 仍 `[SPLIT]`。 | `TASK-J.18a`～`J.18d` **COMPLETED**（[#24](https://github.com/he18718143986-design/IDE/pull/24)/`20c2d46`；[#22](https://github.com/he18718143986-design/IDE/pull/22)/`ca9ed8f`；[#26](https://github.com/he18718143986-design/IDE/pull/26)/`b6922ac`；[#27](https://github.com/he18718143986-design/IDE/pull/27)/`a2fa7df`） |
| gap-7 | 试玩「这里不对」自查 | 旧 `dispute` 实现有 7 处缺陷 | TASK-J.16（预告）；[`specs/playtest-self-check.md`](./specs/playtest-self-check.md) |
| gap-8 | `SchemePatch` 零模型合并 | 引擎已合入：`src/lib/journey/scheme-patch-engine.ts`（§6 矩阵）；生成端循环已合入（J.10） | `TASK-J.9` **COMPLETED**（[#12](https://github.com/he18718143986-design/IDE/pull/12) / `1ad6eab`）；`TASK-J.10` **COMPLETED**（[#17](https://github.com/he18718143986-design/IDE/pull/17) / `97bb0db`） |
| gap-9 | 早期卡把右栏写成「编码 Worker 对话窗口」 | C.1、W.1、W.5a、C.6、P.1、E.1、Sprint 1 门禁的旧叙述 | 已在任务卡文件头加取代说明；原文不改 |
| gap-10 | 用户不做技术决策 | 现行有 `needs_approval` 逐项表态等审批点 | conf-5 |
| gap-11 | 复刻网站需读参考站 | 全部 Agent 禁 `WebFetch` / `WebSearch` | conf-6；无卡 |
| gap-12 | 登录凭据受控使用 | **代码已收口（L.14）**：`daemon/vault/` + `/api/vault` + Settings「密钥」区；日志/命令输出精确脱敏；HTTP 不回明文。发布/摄取注入仍待 L.15/L.17 | oq-3；`TASK-L.14` **COMPLETED**（[#31](https://github.com/he18718143986-design/IDE/pull/31)/`ae57543`） |
| gap-13 | 大需求拆成合同序列 | **代码已收口（L.7+L.8+L.9+L.10）**：`ProjectPlan` 类型/校验/落盘（L.7）；`PlanPatch`/分解器/API（L.8）；合同序列/`nextStub`/桩视图预检/互斥/`E_CONTRACT_IN_FLIGHT`/桩状态回填（L.9）；画布同页嵌「项目地图」+ `GET /api/project/plan` 权威下一份（L.10，tip `e4351b0` / #38）已合入。任务图一份合同一张的旧路径仍在。 | `TASK-L.7` **COMPLETED**（[#23](https://github.com/he18718143986-design/IDE/pull/23)/`607d742`）；`TASK-L.8` **COMPLETED**（[#33](https://github.com/he18718143986-design/IDE/pull/33)/`fb27504`）；`TASK-L.9` **COMPLETED**（[#35](https://github.com/he18718143986-design/IDE/pull/35)/`e1cf1bb`）；`TASK-L.10` **COMPLETED**（[#38](https://github.com/he18718143986-design/IDE/pull/38)/`e4351b0`） |
| gap-14 | 新功能带测试 | Worker 指令已补「你会被这样检查」（L.2）；合同元数据 / `withSystemScope` / `stagent check` 义务与削弱检测已合入（L.3）；**两段式先红后绿编排已合入（L.4）**（`runWorker`→`runTwoPhase`）；**M2 黄金切片 E2E 已合入（L.6）** | `L.2`/`L.3`/`L.4`/`L.6` **COMPLETED**（[#8](https://github.com/he18718143986-design/IDE/pull/8)/[#15](https://github.com/he18718143986-design/IDE/pull/15)/[#18](https://github.com/he18718143986-design/IDE/pull/18)/[#21](https://github.com/he18718143986-design/IDE/pull/21) / `93589bf`） |
| gap-15 | 试玩看到真实应用 | Worktree 真实应用预览已合入（`daemon/supervisor/preview/app-runner.ts`；端口段 4200～4210，与 Demo 段隔离） | `TASK-L.5` **COMPLETED**（[#14](https://github.com/he18718143986-design/IDE/pull/14) / `0b6bc7f`） |
| gap-16 | 技术方案与系统知识 | **部分收口（L.11+L.12）**：`DesignNote` 生成/DN-1～5 校验/升级挂起/`design-note.json`+`obligations.json`/Worker「技术方案」注入已合入（tip `78ec236` / #43）；DN-2「可以」领域方法已测，**HTTP/意外卡入口**挂 DLV-6。**系统知识库与漂移门禁已合入（L.12）**：`checkKnowledge` KB-1～5、`stagent check knowledge`、`withSystemScope` 并入、`KNOWLEDGE_DRIFT`、bootstrap 草稿（`contract_type` 触发）；Tina 拍板 KB-1=全量改动文件、启发式只认 `contract_type`（tip `39f426a` / #47）。追踪链仍待 **L.13**；系统地图 UI 仍待 **L.18**；`daemon/arch/*` 仍只做按需展示 | `TASK-L.11` **COMPLETED**（[#43](https://github.com/he18718143986-design/IDE/pull/43)/`78ec236`）；`TASK-L.12` **COMPLETED**（[#47](https://github.com/he18718143986-design/IDE/pull/47)/`39f426a`）；余量 `TASK-L.13`/`L.18`；DLV-6 |
| gap-17 | 合并后可发布 | deploy / release / health_check 全库 0 命中 | TASK-L.15、L.16 |

---

## 12. 本次文档治理的改动范围与验收（`ScopePlan` 示范）

> 用 §15 的白话五块，示范 Supervisor 在「确认开工」前要给用户看的东西。对象是本次文档治理本身。

- **会改动的地方**：`docs/` 下的索引、本文、`ledger/` 目录；`specs/` 与 `rfc/` 只加取代说明与修正失效链接，不改条款；一处代码注释的失效链接。
- **这次不会碰**：任何产品代码行为；任务卡状态；ADR 条款；`specs/` 正文条款。
- **需要你点头**：§6 的四项推荐、§7 的七张冲突卡、§8 的四个待澄清问题。审阅本 PR 即是一次「确认开工」语义；合入不等于这些项已拍板。
- **怎么算做完**：`docs/` 内所有相对链接可解析（脚本校验）；§0 每句原话都是用户消息的逐字子串（脚本校验）；`npm run lint` 与 `npm run typecheck` 不因本次改动变红。
- **预计规模**：新增 2 份文档，移动 3 份文件，约 20 份文档加注或修链接。

**第三轮（2026-10-30，交付全链路）的改动范围与验收**：

- **会改动的地方**：新增审计报告 1 份、规格 6 份（总装图、项目分解、技术方案与知识库、验证策略、发布与运维、卡就绪标准）、ADR 3 篇（0015～0017）、任务卡模板 1 份；任务卡文件新增 §3.4d（L.1～L.17）、矩阵行、DAG 边，并给 J.3 / J.5 / J.6 / J.7 / J.10 加「ADR-0014 修订」块；supervisor 与 intent-compiler 加修订指针；本文追加 q17～q21 与相关条目。
- **这次不会碰**：任何产品代码；任何既有任务卡的状态；ADR-0001～0014 正文。
- **需要你点头**：ADR-0015～0017（合入即生效）；dec-8（SA-1 敏感项授权方式）；OQ-REL-1（保险库后端；**L.14 已按推荐值 A/B 落地**，改判只换后端）。
- **怎么算做完**：链接检查 0 断链；原话逐字核对；DAG 无环；新文档引用的现有代码路径全部存在；`npm run lint` / `npm run typecheck` 不变红。
- **预计规模**：新增 11 份文件，修改约 8 份文件。

---

## 13. 复用本样板

给任何项目写方案时，按本文的节序填：原话 → 目标 → 不做 → 模块 → 流程 → 实体 → 决定 → 分歧 → 待澄清 → 验收 → 墓地 → 落差 → 改动范围。三条纪律：

1. **只有用户说过的才写 `user_said`**，并附逐字原话；Agent 的推断一律 `ai_inferred`，等用户确认。
2. **分歧不替用户选**：`chosen_id` 留空，把选项与证据摆出来。
3. **否决的进墓地**：写清谁否决、为什么，防止下一轮悄悄复活。

传统模板的对应关系见 [`templates/00-filling-guide.md`](./templates/00-filling-guide.md) 与 [`specs/supervisor.md`](./specs/supervisor.md) §14.11 小节 3（`goals` ↔ REQ，`acceptance` ↔ AC，`decisions` ↔ ADR，证据 ↔ EVID）。
