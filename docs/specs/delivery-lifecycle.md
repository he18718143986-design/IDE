# 交付全链路主干规格（Delivery Lifecycle）

> **地位**：现行规范的**总装图**。它不重写任何已有条款，只把七个环节串成一条链：每一环写清输入、输出、负责方、门禁和用户触点，并指向权威正文。条款冲突时以所指正文为准；本文与正文都没写的，以本文为准。
> **上游意图**：[`../scheme.md`](../scheme.md) goal-7～goal-10（`q17`～`q21`）。
> **审计依据**：[`../reports/delivery-path-audit.md`](../reports/delivery-path-audit.md)。
> **新增决策**：[ADR-0018](../adr/0018-intent-to-executable-seal.md)（意图→可签执行物唯一真相缝，绝对榜首）、[ADR-0019](../adr/0019-project-architecture-baseline.md)（项目架构基线先于分解）、[ADR-0015](../adr/0015-contract-as-unit-of-delivery.md)（四级分解）、[ADR-0016](../adr/0016-system-knowledge-base-in-repo.md)（知识库入库）、[ADR-0017](../adr/0017-release-lifecycle-after-merge.md)（发布独立生命周期）。

---

## 0. 一句话

用户说需求，Agent 交付**能用的软件**。中间七环，每一环都有落盘产物、确定性门禁和可追溯 ID；用户只在三类地方出手：说、拍板分歧、点击（开始规划（若需）/ 开工 / 合入 / 发布）。

---

## 1. 四级模型

```text
Project ── 一个项目一份 ProjectPlan（.stagent/project/plan.json）
  └─ Milestone ── 一组合同 + 一条退出标准（绑定方案 acceptance）
       └─ Contract ── 最小可验收交付单元：一次开工、一次验证、一次合入（.stagent/contracts/<id>.json）
            └─ TaskNode ── 合同内的施工步骤，点亮规则见 ADR-0009（.stagent/specs/task_graph.json）

Release ── 引用一个已合并提交，可覆盖多份合同（.stagent/releases/<release_id>.json，ADR-0017）
```

| 层级 | 谁产出 | 谁授权 | 权威正文 |
| :--- | :--- | :--- | :--- |
| Project / Milestone | Supervisor 分解（计划补丁） | 不授权；只是计划 | [`project-decomposition.md`](./project-decomposition.md) |
| Contract | Daemon 从冻结快照 + `ScopePlan` 确定性生成 | 用户「确认开工」 | [`supervisor.md`](./supervisor.md) §15；[`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) |
| TaskNode | 合同内任务图 | 随合同 | ADR-0009；`daemon/graph/graph-engine.ts` |
| Release | Daemon | 用户「发布」 | [`release-and-operations.md`](./release-and-operations.md) |

---

## 2. 七环主干

| 环 | 输入 | 输出（落盘） | 负责方 | 确定性门禁 | 用户触点 | 权威正文 | 现状 → 卡 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **S1 需求摄取** | 用户消息、参考资料 | 会话记录（`.stagent/sessions/`）；用户消息带 `U<seq>` 别名 | 右栏 Agent（只读、无系统提示） | 右栏工具白名单 `Read,Glob,Grep`；无任何前缀注入 | 自由聊 | ADR-0014 §1；supervisor §13.2、§14.5 | 只读已实现；纯净化 → **L.1** |
| **S2 方案编译** | 用户消息 | `SchemeDraftV2` + 证据台账（冻结后 `.stagent/drafts/schemes/{confirmation_id}.json`） | 中栏意图编译组件 | `SchemePatch` 引擎零模型合并；INV-LEDGER-01～04 | 拍板分歧（冲突卡） | supervisor §14；[`scheme-patch-engine.md`](./scheme-patch-engine.md)；[`intent-compiler-prompt.md`](./intent-compiler-prompt.md) | **J.9 COMPLETED**（#12）；**J.10 COMPLETED**（#17）；**L.6 COMPLETED**（#21 / `93589bf`）；**L.8 COMPLETED**（#33 / `fb27504`）；**L.9 COMPLETED**（#35 / `e1cf1bb`）；**L.10 COMPLETED**（#38 / `e4351b0`）；**L.11 COMPLETED**（#43 / `78ec236`）；**L.12 COMPLETED**（#47 / `39f426a`）；L 系下一张 → **L.13** |
| **S2→Seal 意图密封** | 可编译方案 | 冻结快照 UserFace+MachineFace | Daemon | INV-SEAL-01～05；禁 buildL0Plan(chat) | **需规划**：**「确认方案，开始规划」**（可短写「开始规划」；内部别名「确认方案」=密封事务）；**tiny/单合同**：**「确认开工」** 一次密封并授权 | ADR-0018；supervisor §3.2 / §5.2.1 | **J.2～J.5 COMPLETED**（#4～#7）；编译生成端 **J.10 COMPLETED**（#17）；Seal 消费链齐 |
| **S3 项目架构基线** | 已密封方案 + 仓库/知识库事实 | PAB（版本化项目级架构约束） | Supervisor 提案、Daemon 确定性校验 | 覆盖、边界、来源、验证映射与 freshness | 同页 `PROJECT_MAPPING` 等待态「正在整理项目地图…」（**非**施工授权；右栏可聊） | [`project-architecture-baseline.md`](./project-architecture-baseline.md)；ADR-0019；supervisor §16.2 | 待施工；先于 L.7/L.8 |
| **S3 项目分解** | 已密封方案 + ready PAB（standard/large） | `ProjectPlan`：里程碑、合同桩、依赖 DAG（引用 PAB digest） | Supervisor（分解器） | 计划补丁校验 + PAB 引用一致性 | 同页嵌「项目地图」（非第二套导航）；下一份旁 **「确认开工」** | [`project-decomposition.md`](./project-decomposition.md) | **L.7 COMPLETED**（#23 / `607d742`：类型/校验/落盘）；**L.8 COMPLETED**（#33 / `fb27504`：PlanPatch/分解器/API）；**L.9 COMPLETED**（#35 / `e1cf1bb`：nextStub/桩视图/互斥/回填）；**L.10 COMPLETED**（#38 / `e4351b0`：同页嵌地图 + GET plan 权威下一份） |
| **S3→合同** | 计划中的下一份合同桩 + 已密封 MachineFace | `ScopePlan` → 合同（`.stagent/contracts/<id>.json`） | Daemon | 唯一确认谓词 `evaluateSchemeConfirmation`；§3 可编译判定；ADR-0018 密封门禁 | **「确认开工」**（**该份合同**施工授权；含 SA-1） | supervisor §15、§16.3、§17 D7；runtime §2；ADR-0018 | **J.2～J.6 COMPLETED**（#4～#7、#11）；**J.10 COMPLETED**（#17）；**L.7 COMPLETED**（#23）；**L.8 COMPLETED**（#33 / `fb27504`）；**L.9 COMPLETED**（#35 / `e1cf1bb`：合同序列/下一份交接）；**L.10 COMPLETED**（#38 / `e4351b0`：画布同页嵌入口）；**L.11 COMPLETED**（#43 / `78ec236`）；**L.12 COMPLETED**（#47 / `39f426a`：知识库门禁）；横切追踪 → **L.13** |
| **S4 技术方案** | 已签合同 + ready PAB + 系统知识库 | `DesignNote`（`.stagent/records/<id>/design-note.json`）+ 知识库增量计划 | 设计步骤（中栏组件或专用 Agent，形态开放） | DesignNote Schema 与 PAB 一致性校验；五类决策升级规则 | 仅在五类决策时弹意外卡 | [`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) | **L.11 COMPLETED**（#43 / `78ec236`：DesignNote 生成/校验/注入；DN-2 领域方法已测，HTTP/卡入口 → DLV-6）；**L.12 COMPLETED**（#47 / `39f426a`：`docs/system/` + KB 门禁 + bootstrap）；系统地图 UI → **L.18** |
| **S5 施工** | 合同 + DesignNote + 测试义务 | Worktree 内的改动（`.stagent/worktrees/task-<id>`，分支 `task/<id>`） | Worker | 网关写范围；预算三维熔断；墓地门禁 | 无（看步骤点亮） | runtime §1～§5；ADR-0003、0013；[`worker-graveyard-gate.md`](./worker-graveyard-gate.md) | 单合同已实现；验证命令进指令 → **L.2**；墓地：**J.18a～J.18d COMPLETED**（#24/#22/#26/#27 / tip `a2fa7df`；母卡 J.18 仍 `[SPLIT]`） |
| **S6 验证与验收** | 候选提交 | `EvidenceBundle`（`.stagent/evidence/<contractId>-<evidenceId>.json`）；试玩记录；合并提交 + Trailer | Daemon（判卷）+ 用户（试玩） | `can_merge` 只由退出码派生；测试义务红→绿；知识库漂移检查 | 试玩；**「合入」**（第 2 次点击） | ADR-0005；[`verification-strategy.md`](./verification-strategy.md)；[`evidence-and-acceptance-criteria.md`](./evidence-and-acceptance-criteria.md)；[`playtest-self-check.md`](./playtest-self-check.md) | 测试义务 **L.3 COMPLETED**（#15）；两段式 **L.4 COMPLETED**（#18）；真实预览 **L.5 COMPLETED**（#14）；M2 黄金切片 **L.6 COMPLETED**（#21 / `93589bf`）；知识库检查 **L.12 COMPLETED**（#47 / `39f426a`）；Trailer/反查 → **L.13** |
| **S7 发布与运维** | 已合并提交 | `ReleaseRecord`（`.stagent/releases/<id>.json`）；健康检查证据 | Daemon | 构建与健康检查退出码；失败自动回滚 | **「发布」**（独立点击）；回滚 | [`release-and-operations.md`](./release-and-operations.md) | 保险库 **L.14 COMPLETED**（#31 / `ae57543`）；发布/回流余量 → **L.15～L.16** |

**横切**：追踪链 → **L.13**；北极星外网摄取 → **L.17**（依赖已合入的 L.14）。

---

## 3. 可编译判定（S2 → 合同的入口条件）

一份合同桩只有同时满足以下四条，Daemon 才允许生成合同。四条全部映射到**已有字段**，不新增并行 Schema。

| 条件 | 含义 | 判定（确定性） | 不满足时 |
| :--- | :--- | :--- | :--- |
| **可观察** | 改动会产生用户或程序能看见的结果 | 合同桩绑定的方案 `acceptance[]` 至少 1 条 | 画布显示「这一份还说不清做完是什么样」，编译器补问 |
| **有边界** | 改哪里、花多少有上限 | `ScopePlan.grade.ok === true`，且 `budget_limits` 为合同默认值或更小 | `E_SCOPE_POLICY`（白话区域名） |
| **可冻结** | 影响施工的分歧已拍板 | 方案 `conflicts[]` 中 `chosen_id === null` 的条数为 0 | `E_SCHEME_CONFLICTS_OPEN` |
| **可验证** | 有机器能跑的判据，或明确只能试玩 | `verification_spec.commands.length > 0`，或 `manual_confirmation` 已声明（`src/lib/contract.schema.ts` 既有规则） | 方案为 `large` 时，计划在前面插入「测试底座」合同（project-decomposition D-8）；其余情况按 `manual_confirmation` 走试玩验收，并在合入卡上白话提示 |

---

## 4. 用户触点总表

用户一生只做下面这些事。其余一律由系统兜住（承接 supervisor §13.3 与 ADR-0014 §2）。

| 触点 | 何时 | 一次点击的含义 | 不允许出现的内容 |
| :--- | :--- | :--- | :--- |
| 聊 | 任何时候，在右栏 | — | 右栏里不出现 Supervisor 的系统消息（DEC-005） |
| 拍板分歧 | 方案出现互斥选项时 | 选一个选项 | 技术分类、glob、哈希 |
| **确认方案，开始规划** | 需 PAB/Plan 时，方案幕**一次**（可短写「开始规划」） | 冻结整体方案（双面密封）+ **启动**规划；**不是**授权施工 | 在实际未开工路径上显示「确认开工」；把规划当成开工 |
| **确认开工** | 每份合同一次（tiny/无需规划时可在方案幕一次到位） | 授权**这份合同**施工：目标、验收、预算、敏感项（§5）；**中栏确认的范围 = Worker 拿到的范围**（ADR-0018） | 路径树、命令明细（后置到验收幕）；聊天直推范围；用「确认开工」冒充「仅开始规划」 |
| 处理意外 | 扩范围、超预算、五类技术决策、外部服务 | 在白话卡上点一下（可降频/合并/延后，ADR-0001） | 原始错误栈；把 E_* 当第一句 |
| 试玩 | 合同验证通过后 | — | — |
| **合入** | 每份合同一次 | 接受这份合同进主分支 | — |
| **发布** | 用户想上线时 | 把指定提交部署到指定目标 | 密钥明文 |
| 回滚 | 发布失败或不满意时 | 回到上一个 LIVE | — |

---

### 4.1 多合同与等待态（2026-10-31 完整诊断 · 审阅修补）

- **首次「确认方案，开始规划」**（需 PAB/Plan）：全局只一次；批准对象=冻结+启动规划，**未**授权 Worker。
- **每份合同**各需一次「确认开工」+ 一次「合入」；不得用单次点击冒充多份授权，也不得在规划等待态显示「确认开工」。
- 规划进行中：JourneyStage = **「方案 · 整理项目地图」** / `presentation_state: PROJECT_MAPPING`（supervisor §16.2）；中栏同页「正在整理项目地图…」，完成后嵌地图；**右栏可聊、不锁**；**不**新开旅程或第二套导航。与「方案 · 交接中」/`GRAPH_MAPPING`（合同开工瞬态锁右栏）严格区分。
- `tiny` / 无需规划：跳过 `PROJECT_MAPPING`；方案幕直接「确认开工」或「直接改」。
- `JourneyStage` 只由 Daemon 投影；前端禁止自拼。

## 5. ADR-0014 下的敏感项授权（SA-1，用户正式拍板生效，dec-8 / q22）

ADR-0014 §2 要求「只保留两次点击」，同时要求「保护清单不动」。J.3 / J.6 原设计的逐项「可以 / 不行」与前者冲突。本文给出经用户正式授权的执行标准（`scheme.md` dec-8，`user_confirmed`）：

1. `ScopePlan` 照常计算 `needs_approval`。命中保护清单的路径**默认不进写范围**，即归入 `never_touch`。
2. **只有用户自己的话点名了**某个敏感路径或保护项时，它才进入 `needs_approval`。判定是确定性的：对用户消息做 INV-LEDGER-01 同款规范化子串匹配，命中路径名或保护项白话名才算点名。系统需要的敏感项也属此类，例如测试底座合同的锁文件（project-decomposition §5.1）。这条规则不把「是否确实需要」交给模型判断。
3. 有 `needs_approval` 时，画布在**合同级**「确认开工」按钮上写明「含 N 处敏感改动：<白话名>」，并可展开查看（「开始规划」不承载敏感项施工授权）。
4. **授权存在 `ScopePlan` 里，不存在合同 `approval` 里**（`approvalSchema` 没有逐项字段）。点击时，前端先用共享纯函数 `applyScopeDecisions(plan, { approvals: 全部 true })` 生成新计划与新 `plan_digest`，再随确认请求提交。Daemon 冻结时用快照 + 同一组表态重算（J.4），摘要一致，不会触发 `E_SCOPE_PLAN_DRIFT`。仍有未授权项时返回 `E_SCOPE_APPROVAL_REQUIRED`，安全门禁不变。
5. 用户不想授权敏感项时，点按钮旁的「不碰这些，其余照做」。该操作以 `excluded_area_ids` 重算 `ScopePlan`，把敏感项移入 `never_touch`。

J.3、J.5、J.6 的「ADR-0014 修订」块按此解读改写。[`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) §2 与 supervisor §15.5 中「点『可以』或『不行』」的旧文案，已加指针指向本节。用户改判时，只需改这一节和这三块。

---

## 6. 追踪链

每一环产生的 ID 必须能串成一条链。缺任何一环都算断链（`E_TRACE_BROKEN`，TASK-L.13）。

```text
q<n>（原话） → scheme item id（goal-* / mod-* / acc-*） → milestone_id → contract_id → node_id
   → commit（Trailer: Stagent-Contract-ID / Stagent-Scheme-Items / Stagent-Evidence-ID）
   → evidence_id → release_id
```

| 链接 | 记录在哪里 | 现状 |
| :--- | :--- | :--- |
| 原话 → 方案条目 | 方案条目 `evidence[]`（supervisor §14.2） | 规格已定，引擎未实现 |
| 方案条目 → 合同 | 合同 `supervisor_metadata.scheme_item_ids` / `acceptance_refs` / `stub_id`（新增可选字段，TASK-L.3 定义并在按快照建合同时填写；`stub_id` 由 L.9 写入） | 断开：今天范围从聊天文本推断（由 ADR-0018 封印禁旁路） |
| 合同 → 提交 | Trailer `Stagent-Contract-ID`（`daemon/pipeline/merger.ts`） | 已实现 |
| 提交 → 方案条目 | Trailer `Stagent-Scheme-Items`（新增，L.13；受 512B 单行上限约束，超出时写 `changelog.md` 并只留合同号） | 未实现 |
| 合同 → 证据 | Trailer `Stagent-Evidence-ID` | 已实现 |
| 提交 → 发布 | `ReleaseRecord.commit_sha` | 未实现（L.15） |

反查入口：「这段代码为什么存在」= `git blame` → Trailer → 合同 → 方案条目 → 原话（L.13）。

### 6.1 两条贯穿约束

1. **签署后不改合同。** 系统需要的写范围（`tests/stagent/**`、`docs/system/**`）、检查命令、依赖安装权限，一律在签署前并入 `ScopePlan`，进入 `plan_digest`（supervisor §15.5 D7）。施工期只允许**收窄**网关输入，见 verification-strategy §3.2 `phaseOverlay`。确需扩大时，走意外卡，结果是中止并重签，不是改合同。
2. **一切结论来自真实进程退出码。** 新增的义务、测试完整性、知识库检查都以 `stagent check <kind>` 子进程运行（ADR-0005 决策 1）。

---

## 7. 产物存储总表

| 产物 | 位置 | 入库？ | 来源 |
| :--- | :--- | :--- | :--- |
| 合同 | `.stagent/contracts/<id>.json` | 否 | 现有 |
| 证据 | `.stagent/evidence/<contractId>-<evidenceId>.json` | 否 | 现有 |
| 方案快照 | `.stagent/drafts/schemes/{confirmation_id}.json` | 否 | 现有 |
| 审计包 | `.stagent/records/<contract_id>/` | 否 | 现有（ADR-0011） |
| 架构基线 | `.stagent/project/architecture-baseline.json` + `revisions/` | 否 | 新增（ADR-0019，L.7 前置） |
| 项目计划 | `.stagent/project/plan.json` + `plan.revisions/` | 否 | 新增（L.7） |
| 设计说明 | `.stagent/records/<contract_id>/design-note.json` | 否 | 新增（L.11） |
| 系统知识库 | 目标仓库 `docs/system/` | **是** | 新增（ADR-0016，L.12） |
| 发布记录 | `.stagent/releases/<release_id>.json` | 否 | 新增（L.15） |
| 凭据 | 保险库（后端见 OQ-REL-1；Keychain / 加密文件回退） | 否，且不落明文 | **L.14 COMPLETED**（#31 / `ae57543`） |

> `.stagent/` 整体被写进 `.git/info/exclude`。需要跨机器保留、需要随代码评审的东西，只有系统知识库，所以只有它入库。

---

## 8. 里程碑（建造 Stagent 自身的路线）

| 里程碑 | 一句话 | 包含的卡 | 退出标准（全部满足才算过） |
| :--- | :--- | :--- | :--- |
| **M1 · v0.1** | 单合同受控施工可签收 | 已完成（Tag `v0.1.0`） | 见 [`../reports/v0.1-hardening-closure.md`](../reports/v0.1-hardening-closure.md) |
| **M2 · 黄金切片** | 一句话需求 → 一次开工 → 真实预览 → 一次合入，全程无技术决策 | L.1、J.2、J.3′、J.4、J.5′、J.6′、J.7′、J.8、J.9、J.10′、L.2、L.3、L.4、L.5、L.6 | L.6 端到端测试通过：替身模型下，从右栏一条消息到 `MERGED`；用户只点 2 次；候选含至少 1 条红→绿测试；预览加载的是 Worktree 里运行的真实应用 |
| **M3 · 大项目可控** | 一个需求被拆成多份合同，逐份交付，系统始终可理解 | L.7、L.8、L.9、L.10、L.11、L.12、L.13、J.18a～J.18d | 夹具项目：一段多模块需求被分解为 ≥3 份合同、≥2 个里程碑；逐份合入后 `docs/system/modules.yaml` 覆盖全部改动文件；任意一行新代码能反查到原话 |
| **M4 · 可发布** | 合并的提交能一键上线并能回滚 | L.14、L.15、L.16 | `local_process` 与 `user_command` 两类目标各有 1 条端到端测试：发布 → 健康检查 → LIVE；人为让健康检查失败 → 自动回到上一个 LIVE；日志与证据中搜不到任何保险库明文 |
| **M5 · 北极星** | 给网址 + 登录信息，复刻网站 | L.17 + oq-2 裁决 | 待 oq-2（「一模一样」的判据）裁决后写入 |

**排期规则**：M2 之前不开 M3 的卡；同一里程碑内按 [`development-tasks.md`](./development-tasks.md) §2.1 的 DAG 边串行；每张卡开工前必须满足 [`task-card-standard.md`](./task-card-standard.md) 的就绪定义。

---

## 9. 本文不覆盖

- 多 Worktree 并行（RFC v0.2 §5，v0.3+）。
- 云平台部署适配器（v0.3+，release-and-operations §8）。
- 多人协作与权限（不在 v0.x 范围）。
