# Stagent Supervisor 规范（Supervisor 单一事实源 · SSOT）

> **版本**：**v2.1**（v2.0 正文 + v2.0.2 裁定层物理合流，2026-10-27 新增第三部分闭环规格；版本流转交由 Git Tag 与 commit 历史承载）  
> **日期**：2026-10-26（Asia/Hong_Kong）· 2026-10-27 合流重组  
> **状态**：**现行生效 · 全项目唯一的 Supervisor 单一事实源（SSOT）**  
> **立卡**：`TASK-C.19` / `DOC-SSOT-Supervisor` → **[COMPLETED]**（Tina t906u 授权合流起草）  
> **补丁**：`TASK-C.21` / `DOC-SSOT-Supervisor-Patch` → **[COMPLETED]**（Tina t910u「补丁」；审查冲突与不足钉死）  
> **产品定案锚点**：`TASK-C.18` tip `909198a`（方案工作台单页：自由对话 + 方案审阅 + 确认开工）

### 本文的读法

1. **第一部分（§0～§6）**是 SSOT 正文：角色心智、旁观编译、中栏呈现、门禁隔离、状态与异常。
2. **第二部分（§7～§12）**是裁定与验收：五项决策（D1–D5）、冲突消解记录（R1–R5）、55 条验收矩阵、任务状态判定口径、验证环境。
3. 两部分**原本是两个物理文件**（v2.0 与 v2.0.2），2026-10-27 合流为一篇，**未改写任何条文**，仅消除「点名覆盖」机制在长上下文下必然失效的问题。
4. 第二部分内的交叉引用形如「§N」且不带小数者，均指**第二部分**第 N 章；指向第一部分者一律显式写作「第一部分 §N」。
5. **第三部分（§13～§20，v2.1）**补齐三处断裂：意图编译器、中栏《改动范围与验收方式》、确认后的单页闭环旅程。它的决策 D6–D10 与 §7 同级；与第一部分 §3.2、§5.2.1 第 5 步、§7 D3 右栏锁定、§7 D5 模块数冲突处，以第三部分为准（各处已加改判指针）。

### Changelog

| 版本 | 日期（Asia/Hong_Kong） | 摘要 |
| :--- | :--- | :--- |
| **v2.1 完整诊断修订（UX+密封）** | 2026-10-31 | 钉死：UI 主文案「确认开工」（「确认方案」=内部别名）；D9 胜于 D3 右栏锁定；Canvas=垂直卡片流；JourneyStage 只消费 Daemon 投影；PAB/Plan 等待态「正在整理项目地图」同页嵌地图；编译串行+白话进度+`user_pinned` 优先；冲突卡「按推荐来」/「你看着办」；图过大降级分层摘要；用户面白话先于 E_*；ADR-0001 允许降频/合并/延后卡片；质询台 Supervisor 代判+推荐；§13.2 无人设对齐 ADR-0014；§15.4 对齐 SA-1。纪要见 [`../reports/完整诊断修订纪要-2026-10-31.md`](../reports/完整诊断修订纪要-2026-10-31.md)。 |
| **v2.1 质询台低置信度口径收口（OP-21）** | 2026-10-28 | 质询台规格段低置信度分支改为：先按「拿不准」条向用户提一个业务澄清问题，两按钮保留为用户主动裁决入口并标注「我不确定是谁的问题」，拿到答复后按两条归因路径处理；消除与同节「拿不准」条及取代说明之间的矛盾。高置信度自动归因（D10）与禁用技术术语条目未改动。 |
| **v2.1 低置信度降级口径修正（OP-20）** | 2026-10-28 | 架构文档「低置信度降级」条目由“用户手动点选按缺陷修复 / 按新需求演进”改为“系统向用户提一个业务澄清问题”，与本文 §16.7 一致；上一轮审计漏网，已登记 consistency-audit OP-20。本文 §16.7 语义未改动。 |
| **v2.1 规格一致性裁决落笔（C-3 / C-4 / C-5 / OP-11）** | 2026-10-28 | 四条裁决已拍板（Tina）：①§16.11 新增「免 Worktree 边界」（免 Worktree 仅限非生产产物，生产代码一律 Worktree，VIBE 直改限非生产产物）；②架构 §6.4 D-3 出口改为白话二选（按钮文案已与 §16.7 一致，OP-19 已销项）；③§16.8 与架构 §6.4 D-1 写明三次上限仅计用户手动重试；④代码侧 OP-11 常量对齐（`command-runner.ts`）。仅口径补充，任务状态未改。 |
| **v2.1 试玩自查口径** | 2026-10-28 | 新增实施口径 [`playtest-self-check.md`](./playtest-self-check.md)：§16.7 三方比对责任边界、防自证白话摘要、验收清单点亮、归因状态机与模型单向棘轮、K-14 回填三分类算法；登记 K-16（`attributions.trigger` 收紧为闭集并加 `linked_reason_code`，见 §14.11）。 |
| **v2.1 派工墓地门禁** | 2026-10-28 | §14.11 新增第 5 小节 G-MATCH（墓地匹配单一语义源：自然语言通道 NL-1～5、代码通道 CODE-1～4）；§16.6 增「碰了你否决过的方案」行；新增实施口径 [`worker-graveyard-gate.md`](./worker-graveyard-gate.md)（`TASK-J.18`）。 |
| **v2.1 沉默损耗规格增补** | 2026-10-28 | 三项规格态（⏳，未实现）：①§14.11 第 3 条墓地继承扩充为「冻结快照及其回写记录 + 墓地子账本」，墓碑随 journey 迁移；②§14.11 新增子账本四 `attributions`（质疑归因账本，三分类）与收紧项 K-14，只写台账、不改 `requirements-store.ts` 的 `source` 枚举；③§13.3 增「第一反应速记」前置说明（不新增决定类型、不阻断流程）。§13.4 ③ 幕补呼应标注；`intent-compiler-prompt.md` §2.2 补归因字段的生成端不可写边界；`system-architecture.md` 步骤五加交叉引用。 |
| **v2.1 生成端 reject_item 口径（J.10）** | 2026-10-28 | 生成端 Schema 开放 `reject_item`，只在用户明确否决方案中现有条目时发出（发射条件见 `intent-compiler-prompt.md` §4.5、§6.2「六之二」）；§14.11 登记 K-13：`reject_item` 指向已有效用户墓碑时记 no-op（复用 `W_NOOP_IDENTICAL`）；码表仍为 51 码。 |
| **v2.1 合并引擎增补（J.9a）** | 2026-10-28 | 引擎规格增补 K-10～K-12：墓地命中 (d) 关键词通道、聊天否决 `reject_item`、复活判定忽略 `occurrence`；新增码 `E_REJECT_NOT_NEGATED` / `E_REJECT_TURN_NOT_IN_BATCH` / `E_REJECT_TARGET_MISSING` 与 `W_REVIVAL_OCCURRENCE_IGNORED`；§14.3 `SchemeOp` 同步 `reject_item`。 |
| **v2.1 编译器生成端口径** | 2026-10-27 | 新增实施口径 [`intent-compiler-prompt.md`](./intent-compiler-prompt.md)（`TASK-J.10`）：生成端 × 引擎 47 码责任表（注：47 为 2026-10-27 当时口径，现行引擎码表 51 码，见 `intent-compiler-prompt.md` §2.2，本条不回改）、零转述摘录协议、墓碑注入取舍、搭档与编译器双调用、对抗性金标种子（J.11）。 |
| **v2.1 合并引擎口径** | 2026-10-27 | 新增实施口径 [`scheme-patch-engine.md`](./scheme-patch-engine.md)（`TASK-J.9`）：§14.3 合并规则的判定树与优先级、§14.11 引用锚定算法与墓地复活判定；§14.11 第 4 小节登记收紧项 K-1、K-2、K-3（指向 §14.3 实施口径）、K-4、K-5/K-6、K-7、K-8（§14.2、§14.11 字段）、K-9；`runtime-contract-and-safety.md` §8 L3 行补登 `E_PROPOSAL_PREVIOUSLY_REJECTED` 并修正 `E_BUDGET_EXCEEDED` 码名；§18 增 V-10～V-13。 |
| **v2.1 证据台账契约** | 2026-10-28 | §14 增补 §14.11 证据台账（Evidence Ledger）契约与不可变式（INV-LEDGER-01～04）：条目级 Schema、EditRef 手改证据、原话子串确定性校验、代选择阻断、墓地不可复活与逃生口、Delta 回写与快照继承权威方向、与 docs/templates/ REQ/ADR/EVID 主键映射表。 |
| **v2.1 增补** | 2026-10-27 | 交互温度层增补：点击溯源双向联动、白话合同三层折叠与单向投影不变式、质询台三栏并排规格与双白话按钮、重试非警报呈现与交付仪式卡、低置信度分流保守默认（不变式 C-1）；§18 验收矩阵增补 6 条（V-10, S2-09, J-12～J-15，全部 `⏳`），总计 35 条（`✅ 0 / ⏳ 35`）。 |
| **v2.1** | 2026-10-27 | 新增第三部分（§13～§20）：意图编译器（增量补丁、模型出结构代码出图、只认用户原话）；中栏《改动范围与验收方式》与 `ScopePlan` 单一事实源，确认谓词纳入范围，杜绝确认后 403；确认后单页四幕旅程（`JourneyStage` 映射表、交接、施工对话四类分流、三段式意外卡、对话式验收、单页 Fast Path）；决策 D6–D10；验收矩阵增补 29 条（全部 `⏳`）；实现落差登记 L-01～L-10。 |
| **v2.0.3（草案）** | 2026-10-27 | **未并入本文。** 判别联合数据模型 / 三元哈希绑定 / 终态清理协议等条款代码 0 命中，已抽为独立 RFC：[`../rfc/scheme-snapshot-and-attestation-model.md`](../rfc/scheme-snapshot-and-attestation-model.md)。 |
| **v2.0.2 补丁 2** | 2026-10-27 | 测试基建去抖：34 段 daemon 端口区间迁到两两互斥并加 `tests/unit/test-port-map.test.ts` 守卫；WS 延迟断言改相对测量；`authTimeoutMs` 拆成「成功路径宽预算 / 超时用例短预算」。详见 §11.3 / §11.4。 |
| **v2.0.2 补丁** | 2026-10-27 | R-10 / F-07 补 HTTP 级注入测试（`tests/integration/scheme-confirm-http-injection.test.ts`，7 条）；补 `onContractCreated` 回报使补偿能精确定位已建合同。全量 `npx vitest run` 转绿。 |
| **v2.0.2** | 2026-10-26 | 五项决策钉死（单一确认谓词 / 直接签署状态边 / 事务补偿 / 权威优先级 / `completeness` 语义）+ 55 条验收矩阵（逐条绑测试 ID，`✅ 55 / ⏳ 0`）；通配符分级补「绿野脚手架种子」例外；`freezeScheme` 改为幂等，快照摘要剔除 `updatedAt`。 |
| **v2.0.1** | 2026-10-26 | Tina t909u/t910u 审查补丁：① **Demo 为体验增强项，跳过 Demo 可直接「确认方案」开工**（见 ADR-0010）；② 通配符分级；③ 「确认方案」五步原子时序钉死；④ 手改字段级 `user_pinned`；⑤ Demo 失败双按钮降级与风险标记；⑥ `demoReady` 硬性布尔底线。 |
| v2.0.0 | 2026-10-26 | 初版 SSOT 五大章合流（`TASK-C.19`）；体验对齐 C.18。 |
| **合流重组** | 2026-10-27 | 文档治理：v2.0 正文与 v2.0.2 裁定层物理合并为本文；文件名去版本号；ADR-0001～0013 抽为独立文件（见 [`../adr/`](../adr/)）。 |

---

## 0. 权威声明（先读这一节）

**本文是 Stagent Supervisor 的单一事实源（Single Source of Truth）。**

- 凡「右栏怎么聊、中栏怎么显、何时出 Demo、如何确认开工、施工门禁与异常怎么处置」——**只认本文**。
- 下列合流前碎片若与本文冲突，**一律以本文为准**。Tina t908u「归档」（`TASK-C.20`）后正文曾置于 `docs/archive/supervisor-pre-ssot/`；该目录已于 2026-10-27 文档治理整体移除，原文查 Git 历史（`git log --diff-filter=D -- docs/archive/`）：
  - `right-panel-conversation-design.md`
  - `supervisor-end-to-end-workflow.md`
  - `clarification-and-authorization.md`
  - `interface-contract-checklist.md`
  - `supervisor-mechanism.md`（机制定稿；与 C.18 体验冲突处以本文第 1～3 章为准，第 4～5 章硬防线与之对齐）
- **造 Stagent 本体的施工权威**仍是 [`../specs/system-architecture.md`](../specs/system-architecture.md)（架构宪法）+ [`../specs/development-tasks.md`](../specs/development-tasks.md)（任务卡）+ [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md)（运行时硬契约）。本文不替代这三份，只统合 **Supervisor 产品与监理灵魂**。
- **不可逆决策**另见 [`../adr/`](../adr/)：ADR-0007（分权）、ADR-0010（Demo 可选门禁）、ADR-0011（审计侧车路径）、ADR-0012（`MERGED` 终态）、ADR-0013（Worker 隔离）。
- **CLOSED ≠ 已全实现**：第 4 章「已验证硬防线」标明 v0.1 已验项；其余为目标契约时须注明。
- **历史废弃（体验层）**（勿再当现行 UX）：
  - 日常五视口 Tab（原型试玩 / 任务图谱 / 质疑自查 / 合同审阅 / 真机试玩）作为主入口 → **C.18 起废弃为日常入口**（组件可留档，不作主路径）。
  - 右栏强制 ≤2 轮选择题门控（Top7 §4 / C.11a 体感）→ **C.18 起废弃为日常门控**；安全默认与关键冲突改在中栏决议区确认。
  - 中栏「继续澄清需求 / 继续讨论需求」类按钮 → **禁止出现**；用户不满意直接在右栏继续聊或手改方案。
  - 交付主态用资产 `FROZEN`/`APPROVED` 冒充「已签署可开工」、笼统 `VERIFIED`、无模式单一 `DEMO_READY` → **作废**（见第 5 章状态轨）。
  - **EO-06「未确认 Demo 禁止签署」在新体验主链上的硬卡解读** → **废止/覆盖**（v2.0.1）：Demo 为体验增强项；无 UI 或用户未点「生成 Demo」而直接「确认开工」须放行。若**已生成** Demo，则签署前仍须用户显式确认该 Demo（见 §2.1、§4.6）。

---

## 1. 角色人设与心智模型（双层心智）

### 1.1 一句话

**右栏是自由的业务搭档；幕后 Supervisor 是全景旁观者、意图编译器与底线守门人。用户从不直接跟写码 Worker 谈产品。**

### 1.2 双层分工（现行生效）

| 层 | 名称 | 用户感知 | 职责 | 绝不做什么 |
| :--- | :--- | :--- | :--- | :--- |
| **水面上** | **右栏 AI Partner** | 像跟懂业务的搭档自由聊 | 自由发散、白话交流、无技术枷锁、无机械问卷剧本 | 不自批合同、不写主干、不扩 Scope、不假装「聊完就等于已开工」 |
| **水面下** | **幕后 Supervisor** | 几乎看不见「另一个 Agent」 | 静默旁观对话；评估充分度；编译模块/流程/冲突/默认推荐；刷新中栏方案；在门禁时刻推进 Demo / 冻结 / 派工 / 红队 / 证据提案 | 不抢右栏话筒做连珠炮审讯；不静默放行越界；不自签 Execution Token；不直接写用户项目主干 |

**铁律（提案与裁决分离）**：Supervisor **只提案**；用户拍板；**Daemon** 裁决状态与签发/吊销凭证；**Gateway** 物理拦截越界。

### 1.3 与周边角色的边界

| 角色 | 做什么 | 边界 |
| :--- | :--- | :--- |
| **用户** | 自由聊、审中栏图与决议、生成/试 Demo、点「确认开工」、真机验收 / 紧急暂停 / 回滚 | 不审 Diff、不维护两份大规范、不直接指挥 Worker 扩权 |
| **右栏 AI Partner** | 对话体验与意图采集 | 不拥有写主干权；关键未决交给中栏决议区，而非逼用户答技术填空 |
| **Supervisor** | 编译、旁观触发、红队质询、证据提案、验收引导 | 不自批、不自写主干、不静默扩 Scope |
| **Coding Worker** | 在 Worktree + `writable_paths` 内改码自测 | 不聊产品、不扩 Scope、不合主干、不宣称「我说完成就点亮」 |
| **Daemon / Gateway** | Schema 校验、Token、拦越界、门禁、指纹、合并/Abort | 不做产品决策；不替用户点「确认开工」 |

### 1.4 心智模型（双面镜）

- **对用户（Cognitive Shield）**：自然语言、图表方案、少量关键抉择；Git/沙盒/Hash/锁文件沉在水面下。
- **对 Daemon/Worker（Contract Compiler）**：结构化 Scope、确定性断言、状态机事件、无歧义路径；防脑补。

### 1.5 与 Cursor / Devin 的差异（产品壁垒）

Stagent 的灵魂不是「另一个能写码的聊天框」，而是：**自由对话挖需求 → 中栏可审的全景方案（含图与默认推荐）→ 用户一键确认后才冻结并施工，全程有物理门禁。** Supervisor 正是把模糊愿望编译成可靠交付契约的那一层。

---

## 2. 旁观触发与编译机制（何时动、怎么动）

### 2.1 旁观原则（现行生效）

1. **右栏不停聊、Supervisor 默听**：不因「还没问完两轮选择题」而阻塞对话（**历史废弃**：≤2 轮问卷门控）。
2. **方案可早、Demo 须晚且可选**：中栏方案草稿随聊平静更新；**Demo 不得抢跑**——须 `demoReady` 达标且用户主动点「生成 Demo」（或等价显式动作）。**Demo 是体验增强项，不是开工硬前置**：无 UI 诉求、纯逻辑/脚本任务、或用户觉得静态图表已够清楚而未点「生成 Demo」时，允许直接点「确认开工」，**以审阅后的静态方案为准直接授权开工**，系统**不得**弹「请先确认 Demo」类硬阻断。
3. **已生成 Demo 则须显式确认**：一旦用户点过「生成 Demo」且原型已产出，签署/「确认开工」前须经用户显式确认该 Demo（可与「确认开工」同屏摘要一并确认）；**不得**在用户从未生成 Demo 时，用旧 EO-06 口径卡住开工。
4. **默认推荐须可见可确认**：对话未明说的业务项，Supervisor 可给业界安全默认，但必须出现在中栏「决议区」，默认勾选/推荐态，**用户可改、须知悉**，不得静默写进冻结 Spec 却不展示。
5. **冲突显式化**：对话或模块之间出现互斥假设（例如「要真库」vs「先假数据」、多模块是否分期），进入决议区让用户抉择；**存在 OPEN 未决冲突时禁止**浮现「生成 Demo」与通过「确认开工」。

### 2.2 充分度评估（`sufficiency` / `completeness` / `demoReady`）

**目标**：用**结构化规则**判断方案是否够出 Demo、是否够确认开工。**禁止只靠大模型自报 `completeness` 分**——模型极易「自嗨」刚聊一句就打 80 分，导致「生成 Demo」过早弹出。

**硬性布尔底线（`demoReady` 必要条件，现行契约 · v2.0.1；第 1 条已由第三部分 §14.10 改判，以 §14.10 为准）**——下列全部为真才可置 `demoReady = true`：

1. 识别出 **≥ 2 个业务模块**；
2. 识别出 **≥ 1 条主流程**（流程/时序可表达）；
3. **无 OPEN 未决冲突**（决议区冲突卡均已用户抉择或关闭）；
4. 至少有 **≥ 1 轮有效业务属性输入**（非寒暄；含受众/数据模式/优先级/核心实体等任一业务属性的实质陈述或确认）。

**辅助分（非充分条件）**：

- `completeness` 0–100 **只作 UI 进度条展示**。
  > **v2.0.2 裁废（D5，见 §7）**：`completeness` **不参与任何门禁**、任何分支、任何 `disabled` 推导；`completeness ≥ 60` 阈值语义已废止。上列四条布尔底线是 `demoReady` 的全部内容。
- 实现侧可对启发式分做封顶/校验，**不得**把模型 JSON 里的自报分直接当权威。

> **v2.1 改判（D6，见第三部分 §14）**：下面的「现行实现口径」只是当前代码事实。目标实现是大模型意图编译器；关键词启发式降为离线兜底。

**现行实现口径（C.18 薄切片 + v2.0.1 契约）**：从对话语料抽取业务模块、拼 Mermaid、生成默认决策与冲突卡（`src/lib/journey/scheme-draft.ts`）；工程落地须对齐上列布尔底线（未完全对齐前以规范为准纠偏，不得以「模型觉得够了」放行）。

**确认开工 vs Demo**：`canConfirmScheme`（可点「确认开工」；内部别名确认方案）= 无 OPEN 冲突 + 方案摘要可审；**不要求** `demoReady`，**不要求**已生成/已确认 Demo。`demoReady` 只控制「生成 Demo」按钮浮现。

> **v2.0.2 收口（D1，见 §7）**：`canConfirmScheme` 已降为兼容别名，唯一门禁是 `evaluateSchemeConfirmation(draft, demo)`（含「已生成必须已确认」与「修订必须一致」）。新代码禁止使用 `canConfirmScheme`。

**演进方向**：硬字段清单（核心实体、主流程、验收判据、数据模式、受众）可继续加严布尔求值；**不得**回退到强制问卷打断右栏。

### 2.3 编译产物（从自由对话到机器可执行）

| 编译物 | 给人看 | 给机器用 |
| :--- | :--- | :--- |
| 业务模块列表 | 模块卡片 / 思维导图 | Scope 种子、任务拆分线索 |
| 架构 / 流程 / 时序图 | Mermaid 或等价可视化 | 一致性检查、Demo 骨架 |
| 默认推荐决策 | 决议区「AI 推荐 · 待确认」 | 写入草案 defaults；确认后进冻结快照 |
| 冲突抉择 | 决议区二选一/多选一 | 阻断 `demoReady` / 确认开工直至选完 |
| 白话目标与验收 | 摘要 + 验收要点 | 合同 intent、验证命令提案 |
| 最小可写 Scope（v0.1=保守规则+P.1） | 「会改哪里 / 绝不碰哪里」 | `writable_paths` / `forbidden_paths`；**通配符分级**见 §4.2（老项目禁顶层裸通配；绿野/新模块允许子目录通配并落盘收敛） |

### 2.4 触发节拍（旁观何时「动一下」）

| 时机 | Supervisor 动作 | 用户是否被打断 |
| :--- | :--- | :--- |
| 用户每轮有效发言后 | 增量刷新中栏方案（防抖；Quiet Live Patch；尊重 `user_pinned`，见 §3.3） | 否 |
| 检出新冲突 / 高风险默认 | 决议区高亮待确认项 | 否（中栏提示，非右栏逼问） |
| `demoReady` 首次达成（硬性布尔底线） | 浮现「生成 Demo」 | 否 |
| 用户点「生成 Demo」 | 在 `.stagent/prototypes/` 产隔离原型（失败见 §5.4 双按钮降级） | 仅在失败/降级时要确认 |
| 用户点「确认开工」 | **按 §5.2.1 五步原子事务**执行（验冲突→断右栏→冻结→SIGNED→Worktree/Token→切施工态） | 是（唯一终态确认） |
| 施工越界 / 返工超限 / 紧急暂停 | 见第 5 章 | 是（人话告警卡） |

---

## 3. 中栏方案操作台呈现规范（人看得懂的全景）

### 3.1 布局总览（现行生效 · C.18）

```
┌───────────────┬────────────────────────────┬──────────────────┐
│ 左：需求列表   │ 中：方案工作台（唯一主页）    │ 右：自由对话       │
│ + 规范与资产  │  卡片流 → Demo → 确认开工   │  AI Partner       │
└───────────────┴────────────────────────────┴──────────────────┘
```

- ActivityBar：**单门**进入方案工作台（承 `TASK-C.16`）。
- **日常只有一个中栏页面：「方案工作台」**；旧五视口不作日常入口。
- **Canvas 定型**：中栏是**垂直滚动的卡片流**（摘要 → 图/分层摘要 → 决议 → 改动范围与验收 → Demo → 主按钮），**不是**可自由拖拽连线的无界白板（对齐 ADR-0014）。
- 右栏：**自由输入发送**；无「必须先答完两轮题才能往下」的门闸。

### 3.2 自上而下信息流（必须按此收口）

1. **标题与白话摘要** — 本轮要做的事（随聊更新；可手改备注）。
2. **业务图表流**（至少能表达；现行为启发式 Mermaid）：
   - 架构图（模块挂载关系）
   - 业务模块思维导图
   - 流程 / 时序图（主路径怎么走）
3. **决议区**
   - **关键分歧抉择**（冲突卡：用户必选）
   - **AI 默认推荐确认**（未明说项：展示推荐值 + 确认/改选）
> **v2.1 增补（D7，见第三部分 §15.2）**：决议区之后、「生成 Demo」之前，插入《改动范围与验收方式》区块。

4. **「生成 Demo」按钮**（条件浮现，非常驻）
   - 仅当 `demoReady`（§2.2 硬性布尔底线）为真时出现。
   - 语义：Demo 是方案展示的**增强**部分；上方方案不够完整则**不出现**该按钮。
   - **不出现 ≠ 不能开工**：用户仍可在最底部点「确认开工」。
5. **最底部唯一终态按钮：「确认开工」**（内部别名「确认方案」；UI 一律显示「确认开工」）
   - 点击后严格执行 §5.2.1 原子时序：**冻结 Spec → `CONTRACT_SIGNED` → Worktree/Token → 施工**（或 standard/large 进入 PAB/Plan 等待态，见 §16.3）。
   - **不**以「是否已生成/确认 Demo」为前置（除非本轮**已经**生成了 Demo，则须一并显式确认该 Demo，见 §2.1）。
   - **禁止**并列「继续澄清需求」「继续讨论需求」等按钮。
   - 用户若不满：回到右栏继续聊，或直接手改中栏备注/决议；方案应随聊再更新（尊重 pin）。

### 3.3 手改与随聊共编（字段级脏检查）

- 中栏允许用户手改备注、模块名、决议选择与图表旁注；手改优先于 AI 默认。
- **字段级脏检查（强制）**：凡被用户鼠标/键盘手动编辑过的节点或字段，立即标 `user_pinned: true`（或等价 `source: user` + pin 标志）。
- Supervisor 随聊 **Quiet Live Patch** 时：
  - **只增量合并未 pin 节点**（追加新模块、更新未碰过的推荐默认、刷新未 pin 的图/摘要片段）；
  - **严禁无提示全量重置**方案树或覆盖已 pin 字段（含正在输入的草稿与光标态）；
  - 若 AI 新意图与已 pin 内容冲突：在决议区提出「覆盖建议」，**等用户显式同意**后再解 pin / 覆盖。
  - **与在途编译碰撞**：编译进行中用户手改产生的 `user_pinned` **一律优先**；在途补丁落地时跳过已 pin 字段，不得覆盖、不得撤销 pin（细则见 §14.4）。
- 右栏新对话应合并进方案，但**不得无提示覆盖**用户已确认的抉择。
- 冻结后中栏方案只读；要大改须新一轮微合同（见第 5 章），不得静默解冻改写已签快照。

### 3.4 Demo 在中栏的位置

- Demo 预览/入口挂在图表与决议**之下**、「确认开工」**之上**（「方案够了才**可**生成；生成后仍可再聊再改；**确认开工**才开工——亦可跳过 Demo 直接确认」）。
- Demo 物理落点：`.stagent/prototypes/{id}/`（gitignore，不进主干）；**≠** `.stagent/worktrees/{contract_id}/`。
- 三态能力（交互 Demo / 原生流程卡 / 降级流程卡）见 §4.6 / §5.4；呈现上**不得**把流程卡偷渡成「已可交互试玩」。
- **`can_sign`（v2.0.1 澄清）**：
  - 未生成 Demo → 允许以静态方案签署/确认开工（须无 OPEN 冲突）；
  - 已生成 Demo → 须用户显式确认该 Demo（或显式选择「接受仅用流程图说明开工（标风险）」降级路径）后才可签；
  - **禁止**在用户从未点「生成 Demo」时，因「Demo 未确认」拒签。

---

## 4. 门禁、隔离与工程硬契约（防越界底座）

> 本章收录 **v0.1 已验证或已定案** 的硬防线。实现以任务卡与代码钉桩为准；规范叙述保持诚实口径。

### 4.1 签署分水岭（零无授权写入）

| 阶段 | 允许 | 禁止 |
| :--- | :--- | :--- |
| **确认开工前** | 只读分析；草案写入 `.stagent/drafts/`；Demo 写入 `.stagent/prototypes/` | 写用户项目主干；下发写权限 `exec_token`；跳过用户确认开工 |
| **确认开工 / 签署后** | Worker 仅在 `.stagent/worktrees/{contract_id}/` + 合同 `writable_paths` 内施工 | 改合同本身；挂载/改写 `prototypes/` 或 `records/`；`../` 穿出 worktree；静默扩 Scope |

**不变量**：签署事件落盘前，主干工作区改动必须为 **0 字节**（drafts/prototypes 除外且不得进主干）。

### 4.2 最小可写 Scope 与严禁路径（通配符分级 · v2.0.1）

- **可写**：Impact 目标优先为精确相对路径；**v0.1 可降级**为保守规则/关键词圈选 + **P.1 保护清单**补漏。完整 AST 双向遍历 = **v0.2+**（不可写成已交付）。
- **通配符分级（强制澄清，覆盖旧「已签合同一律禁 `*`/`**`」一刀切）**：
  1. **老项目 / 改已有敏感资产**：严禁顶层裸通配（如 `src/**`、`**/*`、仓库根 `*`）；Daemon 对这类裸通配**拒批**（400/403）。应收敛到精确文件或窄目录。
  2. **新功能 / 从零新建（绿野）**：允许**模块级子目录通配**作为签署时的 Scope 种子（例：`src/features/finance/**`、`src/components/ProgressBoard/**`），以便尚未存在的文件可被创建。
  3. **落盘收敛**：Worker 在施工中每创建/改写文件后，Daemon/Supervisor 须将通配**收敛/替换**为具体文件 manifest（写入合同附属或执行快照）；验收与审计以收敛后的清单为准，不得长期悬挂无界通配。
  4. **敏感区永不被通配覆盖**：即使绿野，`.env*`、`.git/**`、`.stagent/**`、锁文件、认证/支付等 P.1 保护区仍一票否决，不可被任何 `writable_paths` 通配吞入。
  > **v2.0.2 改判（R1 / R1-b，见 §8）**：判据钉死为「**仓库里有没有项目声明**」（`package.json` 缺失即绿野，与 `daemon/supervisor/rules-l0.ts::isGreenfieldRepo` 同一口径）：① 绿野 → `src/**`、`tests/**` 可作为脚手架种子放行；② 有项目声明 → 顶层裸通配拒绝，须收敛到精确文件或模块级子目录；③ 全仓通配（`**`、`**/*`、`*`、`*/**`）**任何形态**都拒绝。
  > **首版判据（「该顶层目录是否已存在」已被实测证伪并留痕）**：仓库内 40+ 处夹具、以及非 npm 工程（Python/Go/纯脚本）都以 `src/**` 为常规写法，按目录存在性判会把它们一律判死。测试 `T-SCOPE-007/007b/007c/014/015`。
- **其他目标约束**：依赖追踪默认 ≤2 hop；单合同 `writable_paths` 宜小，过大拆微合同。
- **严禁 / 保护**：`.env*`、`.git/**`、`.stagent/**`（治理自锁）、锁文件、认证/支付等敏感区（P.1 一票否决）。
- **脏区防误伤（已验）**：未 `acknowledge_dirty` 不得把脏主仓路径卷入可写施工；API 返回 **409** + 白话低恐慌排除建议；确认后排除并入禁写（`TASK-H.6` / C.14d）。

### 4.3 OS 只读分析证明（已验口径）

- 基线/只读扫描须能给出 **OS 级只读证明**（Darwin：`sandbox-exec`；写拒登记为平台等价 EPERM/EROFS；断网证明等）。
- **未证明不得升级硬承诺**（逻辑沙盒 ≠ OS 挂载时须诚实标注）。见 `TASK-C.14e`。

### 4.4 执行凭证与越界熔断（已定案 / 多卡落地）

- **双层 Token**：外部 `session-token` + 内部 `exec_token`（绑定 `contract_id` + worktree）；`PAUSED` **硬吊销**；恢复用一次性 `resume_token`+`jti`（Top5 #1 / EO-07 / C.12a）。
- **越界原子拦截**：阻断当次 IO → `SIGINT` 软停 **3s** 释锁 → 超时 `SIGKILL` → 吊销 `exec_token` → 清锁 → 交付态 **`PAUSED`** 问人；**禁止静默放行**（Top5 #3 / C.12c）。
- Worker **只挂载** `.stagent/worktrees/{contract_id}/`；禁符号链接穿出、禁 `../`（EO-02）。

### 4.5 验收断言与证据

- 合同须带可执行验证命令；绿野/主路径常用 **`npm run typecheck`** 与 **`npm test`**（时限由合同预算约束）。
- **空验证集不得点亮**；Worker「我说完成」不够——须 Evidence 核销后由 Supervisor **提案**点亮，Daemon 裁决。
- 红队质询：查假测试/空断言、既有回归、未跟踪文件是否进 Scope；超时 **不静默放行**（暂停/标黄+审计；扩 Scope 必须新卡重签）。
- 无 Git 时审计侧车：`.stagent/records/{contract_id}/audit-manifest.json`（脱敏后哈希；Top5 #5）。**永久保留 = 脱敏后完整记录**，不是明文原声（EO-04/10）。

### 4.6 Demo / 归档隔离与 `can_sign`（v2.0.1）

- 活跃 Demo：`.stagent/prototypes/`（gitignore，不进主干）。
- 施工：`.stagent/worktrees/{contract_id}/`。
- 归档：`.stagent/records/{contract_id}/`（轻量拷贝 + audit-manifest）；`prototypes ≠ worktrees ≠ records`。
- **Demo 门禁（覆盖旧 EO-06 硬卡在新体验主链上的解读）**：
  - Demo = **体验增强项**，不是所有任务的开工硬前置。
  - **无 UI**、或用户**未点**「生成 Demo」而直接「确认开工」→ **以审阅后的静态图表方案为准直接开工**，Daemon/`can_sign` **不得强阻断**。
  - **已生成** Demo → 签署须经用户**显式确认 Demo**；或走 §5.4「接受仅用流程图说明开工（标风险）」降级并写入风险标记。
  - 合同/证据字段建议：`demo.status = none | building | ready | confirmed | failed | degraded_flowcard`；仅当 `ready` 且用户未确认、又未选降级时，才阻断签署。
  > **v2.0.2 权威优先级（D4，见 §7）**：① 有 `confirmation_id` → 按冻结快照求值，快照缺失即拒签（`409 E_SCHEME_SNAPSHOT_NOT_FOUND`）；② 无 `confirmation_id` → 回退最新确认记录；③ 完全无记录 → 视为从未生成，允许直签。旧实现「仅在已有确认记录时才校验」导致 `confirmed:false` 被整条跳过 —— 「已生成但没点确认」反而比「没生成」更容易签，属缺陷，v2.0.2 起 `confirmed !== true` 一律 `E_DEMO_NOT_CONFIRMED`。
  > **权威边界**：UI 的谓词求值只是**提前告知**；真正放行以 Daemon 求值为准。二者不一致时以 Daemon 为准并记一条告警（视为 D1 违约缺陷）。

---

## 5. 全生命周期状态图与异常处理

### 5.1 三轨解耦（强制）

| 轨 | 管什么 | 权威名 |
| :--- | :--- | :--- |
| **A. 交付主生命周期** | 用户可见本轮进度 | `DeliveryState` / `DeliveryLifecycleState`（EO-01） |
| **B. 文档资产态** | 单份文档/快照 | DocGov `DocumentAssetStatus`：`DRAFT`→`PROPOSED`→`FROZEN`→… |
| **C. 子任务活动态** | 瞬态 | `TaskSubState`（如 `DEMO_BUILDING` / `DEMO_FAILED` / `CONTRACT_SIGNING`） |

**铁律**：资产 `FROZEN` ≠ 已开工；资产 `VERIFIED` ≠ 已 `MERGED`。广播须带 `session_epoch` + `state_seq`，防重连倒流。

### 5.2 用户旅程主链（现行产品叙事 · 对齐 C.18 / v2.0.1）

```text
自由对话（右栏）
    → 方案草稿随聊更新（中栏·资产 DRAFT；尊重 user_pinned）
    → [可选] 决议确认 / 冲突抉择
    → [可选] demoReady → 浮现「生成 Demo」→ 试玩（prototypes）→ 显式确认 Demo
    → 「确认开工」（可不经 Demo）→ §5.2.1 原子事务
    → CONTRACT_SIGNED → IMPLEMENTING（worktree + Worker）
    → VERIFYING → CANDIDATE_VERIFIED → MERGED
    →（脱敏归档成功可标交付完结；失败停 MERGED，禁伪造）
```

**v0.1 运行时终态对外口径**：以 **`MERGED`** 为合并成功主归档点（硬化收官）；旧文单独强调的 `DELIVERED` 若未在运行时独立存在，话术挂在已合并归档上，不得伪标。

### 5.2.1 「确认开工」点击瞬间的原子动作链（钉死 · 防前端抢跑 / Daemon 409）

用户点击「确认开工」（内部别名「确认方案」）后，**同一事务内按序**执行（任一步失败则整链中止并回滚到可重试的审阅态，不得半签半开）：

1. **验未决冲突**：若决议区仍有 OPEN 冲突 → **拒绝跳转**，中栏冲突卡摇红/高亮，保留可编辑；**不**进入签署。
2. **阻断右栏新输入**：输入框禁用；若右栏仍在**流式输出**：
   - **策略（现行钉死）**：**中断**当前流式生成（停止 token 泵送），保留已输出文本为历史气泡；**不等待**其自然结束（避免确认按钮「假死」）。
   - 中断后本轮旁观 Patch **不再**写入方案（避免与冻结快照竞态）；未 pin 的半成品增量丢弃或标为 `aborted`。
3. **冻结快照落盘**：将中栏方案 + 决议 +（若有）Demo 确认/降级结论写入 `.stagent/drafts/`（或合同草案）不可变快照；中栏立即切**灰色只读**（可附轻量「确认开工摘要」只读条，**非**第二道「继续澄清」）。
4. **状态置 `CONTRACT_SIGNED`（经授权链路）**：现行实现可经 `PENDING_APPROVAL` → 用户批准/一键授权，但产品叙事上「确认开工」即用户终态拍板；Daemon 签发后方为机器可执行。
5. **配 Worktree + 发 Token → 中栏切入施工进度**：挂载 `.stagent/worktrees/{contract_id}/`，签发 `exec_token`，中栏无缝切到施工进度/任务图谱（或方案页内嵌施工态）；**禁止**前端在步骤 4 完成前抢跑 Worker。
   > **v2.1 定案（D8/D9，见第三部分 §16.1～§16.3）**：中栏不切换页面，而是同页进入「② 施工」幕；交接成功后右栏解锁进入施工对话。

**禁止**：确认瞬间并行接受新的右栏用户消息写入同一草案；确认后静默解冻改写已签快照。

> **v2.0.2 补充（D3，见 §7）**：上述五步已落为带幂等键与补偿的事务 —— 阶段名 `CLAIM_AND_QUIESCE → VALIDATE_CONFIRMATION → FREEZE_SNAPSHOT → SIGN_AND_PREPARE → COMMIT`，实现见 `src/lib/journey/confirm-scheme-atomic.ts`。
> **幂等契约**：`confirmation_id` 由**前端生成**，同一修订重试必须复用同一 id，换修订才换 id（**裁决 D-1 选定此式**；内容派生式 `sha256(scheme_id + revision + digest)` 作为 v0.2 备选，见 RFC）。同 id + 同内容 → `idempotent: true` 不重复签署；同 id + 不同内容 → `E_CONFIRMATION_ID_REUSED`，绝不覆盖。
> **补偿契约**：第 4 阶段任何失败都必须 `compensate`；补偿失败 → `E_COMPENSATION_FAILED`，**保持锁定**，禁止假装成功、禁止静默解锁。快照落盘路径钉死为 `.stagent/drafts/schemes/{confirmation_id}.json`，摘要剔除 `updatedAt`。

### 5.3 与五阶段监理职责的映射（机制层仍有效）

| 阶段 | 监理职责 | 产品触点 |
| :--- | :--- | :--- |
| 1 意图启发 | 分类、默认推荐、拆微步建议 | 右栏自由聊 + 中栏决议 |
| 2 感官对齐 | 只读探测、隔离 Demo | 「生成 Demo」 |
| 3 影响收敛 | 最小 Scope、白话合同/Spec | 确认开工前的范围说明 |
| 4 实施编排与红队 | 派工、越界挂起、质询回打 | 施工中状态 / 暂停卡 |
| 5 证据与验收 | Evidence、真机引导、合并提案 | 验收 / 合并 / 回滚 |

### 5.4 异常与人话处置

| 异常 | 系统行为 | 对人怎么说 |
| :--- | :--- | :--- |
| **紧急暂停** | 用户触发 Abort/Pause → 吊销 `exec_token` → 保留现场 | 「已暂停，改动还在隔离区，可恢复或放弃」 |
| **越界熔断** | 原子拦截 → `PAUSED` | 「差点改到约定外的文件，已拦住；要扩权还是回滚？」扩权 = **新卡重签**，禁止默许 |
| **Demo 失败** | `DEMO_FAILED`；中栏 Demo 区展示失败原因 + **两个显式动作**（见下） | 禁静默偷换为交互 Demo；禁假装「已可试玩」 |
| **返工超限** | 按 `assertion_id` 计数；超限 `ESCALATED_HUMAN` | 「同一问题来回改太多次了，需要你拍板怎么收束」；返工期禁偷偷追加新断言 |
| **合并后新缺陷** | **禁止** `MERGED → REWORK_REQUIRED` | 开**新微合同**，不解开已合并轮次 |
| **放弃本轮** | 二次确认；非成功终态归档 | 清理临时 worktree；不得标成已交付 |

### 5.4.1 Demo 失败时的中栏呈现（钉死 · v2.0.1）

非技术用户点完「生成 Demo」后若 Vite/沙盒构建失败，**中栏 Demo 区域**必须同时提供且仅提供：

1. **【重试生成】** — 重新走原型构建；状态回到 `DEMO_BUILDING`。
2. **【接受仅用流程图说明开工（标风险）】** — 显式降级：采用中栏已有的 Mermaid/流程说明作为感官对齐替代物；**不是**在 Demo 视口里塞一张伪装成交互 Demo 的静态卡而不告知。

降级接受后的**风险标记写法（合同/证据须落盘）**：

- `demo.status = degraded_flowcard`
- `demo.risk_flags` 至少包含：`NO_INTERACTIVE_DEMO`
- 白话摘要示例：「本轮未提供可点击试玩原型，仅以流程图/架构图说明对齐；真实界面以施工后真机为准。」
- UI：中栏 Demo 区显示黄色风险条；「确认开工」摘要中复述该风险，避免用户误以为已试玩过。

**禁止**：失败后自动把降级流程卡标成「交互 Demo 就绪」；禁止无按钮的静默降级。

### 5.5 微合同（切蛋糕）

大欲望由 Supervisor **建议**拆成半小时级小步；每步：聊清 → 方案 →（可选 Demo）→ 确认开工 → 施工 → 验收。拍板永远在用户。Demo 全程可选（§2.1 / §4.6）。

---

## 6. 附录：权威指针与未吸尽项

### 6.1 已吸收并洗练的来源

| 来源 | 本文落点 |
| :--- | :--- |
| 右栏设计稿 §0 双面镜 / 编译哲学 | §1、§2 |
| C.18 自由对话 + 单页方案审阅 + 确认开工 | §1～§3（**现行体验**） |
| C.21 / Tina t910u 审查补丁（Demo 门禁、通配分级、确认原子时序、pin、降级、demoReady） | §2.1–2.2、§3.3–3.4、§4.2、§4.6、§5.2.1、§5.4.1 |
| C.16 单门工作台 | §3.1 |
| 运转机制定稿四机制/五阶段/红队收紧 | §1、§4.5、§5.3 |
| 澄清授权稿：签署前后权限、不变量、方案早 Demo 晚 | §2.1、§4.1、§4.6 |
| Top7 / API Top5 / EO-01～10 / Spec Freeze 状态轨 | §4、§5.1 |
| DocGov 资产态分轨 | §5.1 |
| C.14d/e、H.6 脏区与 OS 只读 | §4.2、§4.3 |
| C.12a–e Token/越界/Demo/审计 | §4.4～§4.6 |
| 主路径里程碑 / 硬化收官终态口径 | §5.2 |

### 6.1b 架构决策记录（独立 ADR）

本 SSOT 涉及的全部不可逆决策已抽为独立文件，见 [`../adr/`](../adr/)：

| ADR | 与本文的关系 |
| :--- | :--- |
| [ADR-0007](../adr/0007-dual-agent-daemon-authority.md) | §1 提案与裁决分离铁律的来源 |
| [ADR-0010](../adr/0010-demo-optional-not-hard-gate.md) | §2.1 / §3.4 / §4.6 的 Demo 可选门禁（**推翻旧 Demo 硬前置**） |
| [ADR-0011](../adr/0011-audit-sidecar-records-path.md) | §4.5 审计侧车路径（废止 `.stagent/metadata/`） |
| [ADR-0012](../adr/0012-merged-as-terminal-state.md) | §5.2 终态口径（`MERGED`，无独立 `DELIVERED`） |
| [ADR-0013](../adr/0013-cli-isolation-without-bare.md) | Worker 适配器隔离（弃用 `--bare`） |
| [ADR-0008](../adr/0008-demo-isolated-origin.md) | §4.6 Demo 独立 Origin |

### 6.2 已知未吸尽 / 仍分治（不假装本文已吞掉）

1. **Interface Checklist 全量通道矩阵（A–F 非 Top5 行）**：字段级 Pending、UI 排版细则仍以 Checklist 讨论稿为对接看板；本文只收硬门禁与 Top5 定案。
2. **完整 AST Impact / Mode 0–4 / 真脑图 / 云归档 / W.5b·c / D.1e**：继续 **v0.2+ 封印**，本文仅保留诚实降级口径。
3. **右栏 1300+ 行历史补丁与演示脚本（C.11 五步体感）**：产品哲学已折叠进本文；逐条 UI 文案与演示卡不整份搬迁。
4. **方案图 LLM 精画**：现行为启发式薄切片；升级须另立卡，不在本文假装已交付。
5. **《架构规范》《任务规范》正文**：不因本文自动改写；任务回写仅 `TASK-C.19` 薄卡。
6. **Spec Freeze「五正文分治」索引**：Freeze 记录仍是封版锚点；**Supervisor 体验与监理 SSOT 升级为本文**——Freeze 文首应加指针，避免双 SSOT 打架。

### 6.3 给研发的最短上下文用法

写 Supervisor / 工作台相关代码时，优先把 **本文全文** 放入上下文；需要字段 Schema 时再打开 Checklist 附录；需要任务验收句时打开《任务规范》对应 `TASK-*` 卡。

---

*文档结束。冲突以本文为准；实现以任务卡与 git tip 为准。*

---

# 第二部分 · 裁定、冲突消解与验收矩阵

> **来源**：原 `Stagent_Supervisor_Specification_v2.0.2`（裁定与验收矩阵）。2026-10-27 与第一部分物理合流。
> **⚠️ 未接线即未完成**：§9 矩阵中标 `⏳` 的行不得在任何任务卡上标记 `COMPLETED`（判定口径见 §10）。
> **冲突时按此优先级读**：**§7 决策 > 第一部分具体条款 > 第一部分原则性表述 > 已归档旧文档**。

## 7. 五项决策（钉死）

### D1 · 确认门禁只允许一个谓词

**决策**：`evaluateSchemeConfirmation(draft, demo)` 是**唯一**的「能不能点确认开工」判定函数。UI、Daemon、脚本、重试**全部**调用它；任何形式的第二套判断（分数阈值、按钮态 `disabled` 推导、后端独立 if）都视为缺陷。

- **实现锚点**：`src/lib/journey/scheme-draft.ts` → `evaluateSchemeConfirmation`
- **UI 调用点**：`src/routes/index.tsx` → `schemeConfirmation`（`useMemo`）→ `SchemeReviewPane`
- **Daemon 侧等价物**：`daemon/supervisor/demo/signing-gate.ts` → `evaluateSnapshotDemoGate` / `evaluateLatestDemoGate`（同一组拒绝码，不得自造新码）
- **废止**：v2.0.1 遗留的 `completeness >= 40` 前端门槛 —— **删除，不保留**。
- **兼容**：`canConfirmScheme(draft)` 仅是 `evaluateSchemeConfirmation(draft, EMPTY_DEMO_GATE).ok` 的别名，新代码禁止使用。

**拒绝码闭集**（新增码必须同时更新本文与测试）：

> **用户面纪律（2026-10-31）**：中栏/右栏**先出白话**（「咱们先给这事儿起个短名字？」），`E_*` 码只进技术细节折叠区与审计日志，**禁止**把拒码原文当作对用户的第一句回复。

| 码 | 触发条件 | 用户可做什么 |
| :--- | :--- | :--- |
| `E_SCHEME_ALREADY_FROZEN` | 方案已冻结 | 无需操作（已签署） |
| `E_SCHEME_CONFLICTS_OPEN` | 仍有 `chosenId === null` 的冲突 | 在中栏决议区选一个（可点「按推荐来」） |
| `E_SCHEME_NOT_REVIEWABLE` | 标题 < 2 字或（摘要 < 8 字且无模块） | 继续聊或手改（白话引导起名/补一句摘要，不甩拒码） |
| `E_DEMO_BUILDING` | `demo.status === "building"` | 等完成或重试 |
| `E_DEMO_FAILED` | `demo.status === "failed"` | 重试 / 显式接受降级 |
| `E_DEMO_CONFIRMATION_REQUIRED` | 已生成但 `decision_revision !== scheme_revision` | 点「确认 Demo」或「接受降级」 |
| `E_DEMO_STALE` | `demo.scheme_revision !== scheme_revision` | 重新生成 Demo |
| `E_SCOPE_NOT_READY`（v2.1） | 没有与当前修订绑定的 `ScopePlan` | 等预检完成（第三部分 §15.5） |
| `E_SCOPE_POLICY`（v2.1） | 自动收敛后范围仍违反通配符分级 | 说清要改哪块，或排除该区域 |
| `E_SCOPE_APPROVAL_REQUIRED`（v2.1） | 有敏感项未表态 | 在「确认开工」上一次授权，或点「不碰这些，其余照做」（见 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §5 SA-1） |

### D2 · 允许 `PLAN_CONFIRMED → CONTRACT_SIGNED` 直签

**决策**：Demo 是**可选增强项**。状态机必须显式存在 `PLAN_CONFIRMED → CONTRACT_SIGNED` 这条边，且**只由 D1 的谓词守卫**（`demo.status === "none"` 时放行；已生成则必须先确认）。

- **实现锚点**：`src/lib/state/delivery-state.ts` → `DELIVERY_TRANSITIONS.PLAN_CONFIRMED`
- **保留**：`PLAN_CONFIRMED → DEMO_READY → CONTRACT_SIGNED` 老链路继续合法。
- **禁止**：`PLAN_READY → CONTRACT_SIGNED`（跳级）；`MERGED → REWORK_REQUIRED`（开新微合同）。

### D3 · 「确认开工」是带幂等键与补偿的原子事务

**决策**：点击 UI「确认开工」（内部别名「确认方案」）= 五阶段事务，顺序不可调换：

| # | 阶段 | 必须完成的事 | 失败语义 |
| :--- | :--- | :--- | :--- |
| 1 | `CLAIM_AND_QUIESCE` | 中断右栏流式 + 禁用右栏输入 | 失败即中止，**不落任何盘** |
| 2 | `VALIDATE_CONFIRMATION` | 在**已冻结**的同一修订上跑 D1 谓词 | 失败即解锁，可重试 |
| 3 | `FREEZE_SNAPSHOT` | 写不可变快照 `.stagent/drafts/schemes/{confirmation_id}.json` | 失败即解锁，**不进签署** |
| 4 | `SIGN_AND_PREPARE` | 建合同（带 `confirmation_id`）→ 批准 → 建任务图 | 失败必须 `compensate` |
| 5 | `COMMIT` | 记住幂等结果，方案冻结，右栏保持锁定 | — |

**幂等契约**：
- `confirmation_id` 由前端生成，**同一修订重试必须复用同一 id**；换修订才换 id。
- 同 id + 同内容 → 返回原结果（`idempotent: true`），**不重复签署**。
- 同 id + 不同内容 → `E_CONFIRMATION_ID_REUSED`（前端）/ `E_SCHEME_CONFIRMATION_CONFLICT`（快照层），**绝不覆盖**。
- 快照摘要**不含** `updatedAt`（见 §8 R3）；`freezeScheme` 对已冻结方案**幂等返回原对象**。

**补偿契约**：
- 第 4 阶段任何失败都必须调用 `compensate`（终止本次已建合同；token/Worktree 回收由 Daemon 负责）。
- 补偿成功 → 解锁右栏，可重试。
- 补偿失败 → `E_COMPENSATION_FAILED`，**保持锁定**并提示需人工处理。**禁止**假装成功、禁止静默解锁。
- 第 5 阶段成功 → **右栏仅在交接瞬态保持锁定**；交接成功后按 **D9（§16.5）** 解锁。
  > **权威口径（D9 胜于本条旧文）**：旧文「第 5 阶段成功 → 右栏保持锁定；冻结后输入静默丢弃；解锁只在新建需求」**整段作废**。现行：右栏只在交接几秒内锁定；解锁后用户输入**禁止静默丢弃**，必须按 A～D 四类分流，以**中栏卡片**呈现效果，右栏仅给短回执（如「已记到中栏，请看卡片」）。详见 §16.5。

- **实现锚点**：`src/lib/journey/confirm-scheme-atomic.ts` → `runConfirmSchemeAtomic`；`src/routes/index.tsx` → `handleConfirmScheme`；`daemon/pipeline/scheme-snapshot-store.ts`；`daemon/server.ts` → `POST /api/supervisor/scheme/freeze`

### D4 · 权威优先级：Daemon 快照 > 最新记录 > 从未生成

**决策**：签署门禁的输入有明确优先级，**不允许**「没传快照就放行」：

1. **有 `confirmation_id`**：读冻结快照，按快照内 `demo` 事实逐项核对（`evaluateSnapshotDemoGate`）。快照不存在/损坏 → `409 E_SCHEME_SNAPSHOT_NOT_FOUND`，**拒绝签署**。
2. **无 `confirmation_id`（旧路径）**：回退最新 Demo 确认记录（`evaluateLatestDemoGate`）。
3. **完全无记录**：视为「从未生成 Demo」→ 允许直签。

**必须防住的回归**：旧实现「仅在已有确认记录时才校验 `canSign`」，导致 `confirmed: false` 的记录被整条跳过 —— 「已生成但没点确认」反而比「没生成」更容易签。v2.0.2 起，`confirmed !== true` 一律 `E_DEMO_NOT_CONFIRMED`。

**权威边界**：UI 的谓词求值只是**提前告知**；真正放行以 Daemon 求值为准。二者结论不一致时，以 Daemon 为准并记一条告警（视为 D1 违约缺陷）。

- **实现锚点**：`daemon/supervisor/demo/signing-gate.ts`；`daemon/pipeline/orchestrator.ts` → `approve(..., { demoGate })` / `admit(..., { demoGate })`；`daemon/server.ts` → `POST /api/contracts/:id/approve`

### D5 · `completeness` 只是展示分，`demoReady` 恰为四条布尔底线

**决策**：
- `demoReady = modules.length >= 2 && hasMainFlow(draft) && openConflicts === 0 && business_input_rounds >= 1`
  > **v2.1 改判（D6，见第三部分 §14.10）**：模块条件改为「至少 1 个有界面的模块」。
- `completeness`（0–100）**不得**出现在任何门禁、分支、`disabled` 推导里；只用于中栏进度展示。
- `sufficiency` 属 Supervisor 内部信号，与签署门禁无关。

**禁止**：以 `completeness >= N` 作为放行条件（v2.0.1 遗留实现已删除）；以 `completeness` 作为拒绝理由文案。

- **实现锚点**：`src/lib/journey/scheme-draft.ts` → `computeDemoReady` / `scoreCompleteness`

---

## 8. 审查冲突消解（v2.0.1 → v2.0.2）

| # | 原冲突 | v2.0.2 裁定 | 落点 |
| :--- | :--- | :--- | :--- |
| R1 | §4.2 说「老项目禁裸通配」，但绿野脚手架会生成 `src/**`、`tests/**`，字面上同样被禁 | 判据钉死为「**仓库里有没有项目声明**」（`package.json` 缺失即绿野，与 `daemon/supervisor/rules-l0.ts::isGreenfieldRepo` 同一口径）：<br>① 绿野 → `src/**`、`tests/**` 可作为脚手架种子放行；<br>② 有项目声明 → 顶层裸通配拒绝，必须收敛到精确文件或模块级子目录；<br>③ 全仓通配（`**`、`**/*`、`*`、`*/**`）→ **任何形态**都拒绝 | `src/lib/writable-scope-grade.ts` → `gradeWritableScope` |
| R1-b | 首版把判据写成「该顶层目录是否已存在」，实测证伪 | **改判并留痕**：仓库内 40+ 处夹具、以及非 npm 工程（Python/Go/纯脚本）都以 `src/**` 为常规写法；按目录存在性判会把它们一律判死，且与产品既有 `isGreenfieldRepo` 语义分叉。按声明判则精确命中风险面（**已有工程声明却仍要整目录可写**），实测 20 条受影响的既有用例全部恢复 | 同上；`tests/unit/writable-scope-grade.test.ts` T-SCOPE-007b/014/015 |
| R2 | §4.2 只说「落盘后收敛」，没说收敛何时发生、保留什么 | 收敛规则钉死：`exact` 原样保留；glob 被其命中的已写文件替换（去重）；未命中则保留原 glob 种子 | `convergeWritableManifest` |
| R3 | §5.2.1 要求快照幂等，但摘要含 `updatedAt`，重试必然摘要不同 → 被判「另一版方案」 | 摘要**剔除 `updatedAt`**（纯本地时间戳，不承载决策）；其余字段全参与。`freezeScheme` 对已冻结方案幂等返回 | `scheme-snapshot-store.ts::schemeSnapshotDigest`、`scheme-draft.ts::freezeScheme` |
| R4 | §5.2.1 第 4 步写「可经 `PENDING_APPROVAL` → 用户批准」，与「用户点确认即拍板」有歧义 | 产品语义上点击即拍板；机械上仍走 `PENDING_APPROVAL → PREPARING` 授权链，**前端不得在批准完成前拉起 Worker** | `handleConfirmScheme.signAndPrepare` |
| R5 | §2.2 曾以 `completeness >= 60` 作辅助门禁，与 D5 冲突 | 废止阈值语义，只留展示 | 见 D5 |

---

## 9. 验收矩阵（每条绑定测试 ID）

**图例**：`✅` 已实现且有通过测试 · `⏳` 已有实现但缺自动化证据（**不得标 COMPLETED**） · `—` 不适用

测试文件：
- `tests/unit/scheme-confirmation-gate.test.ts` → `T-GATE-*` / `T-STATE-*`
- `tests/unit/confirm-scheme-atomic.test.ts` → `T-ATOM-*`
- `tests/unit/writable-scope-grade.test.ts` → `T-SCOPE-*`
- `tests/unit/scheme-signing-gate.test.ts` → `T-DEMO-*`
- `tests/ui/task-c22-confirm-wiring.test.tsx` → `T-UI-*`

### 9.1 状态前置条件（允许签署的起点）

| ID | 前置状态 | 期望 | 测试 |
| :--- | :--- | :--- | :--- |
| M-01 | `PLAN_CONFIRMED` + `demo.status=none` | 允许直签 | ✅ T-GATE-001 / T-STATE-001 |
| M-02 | `PLAN_CONFIRMED` + Demo `ready` 且同修订已确认 | 允许签署 | ✅ T-GATE-002 |
| M-03 | `PLAN_CONFIRMED` + Demo `degraded_flowcard` 且已显式接受 | 允许签署，标记 `NO_INTERACTIVE_DEMO` | ✅ T-GATE-010 |
| M-04 | `DEMO_READY`（老链路） | 允许签署 | ✅ T-STATE-002 |
| M-05 | `PLAN_READY` | 拒绝（跳级） | ✅ T-STATE-003 |
| M-06 | 方案已冻结 | 拒绝重复确认 | ✅ T-GATE-009 |

### 9.2 拒绝用例（每一条都必须给出可执行的原因）

| ID | 场景 | 期望拒绝码 | 测试 |
| :--- | :--- | :--- | :--- |
| R-01 | Demo `building` | `E_DEMO_BUILDING` | ✅ T-GATE-003 |
| R-02 | Demo `failed` 未处置 | `E_DEMO_FAILED` | ✅ T-GATE-004 |
| R-03 | Demo 已生成未确认 | `E_DEMO_CONFIRMATION_REQUIRED` | ✅ T-GATE-005 |
| R-04 | Demo 基于旧修订 | `E_DEMO_STALE` | ✅ T-GATE-006 |
| R-05 | 有 OPEN 冲突（即使 Demo 就绪） | `E_SCHEME_CONFLICTS_OPEN` | ✅ T-GATE-007 |
| R-06 | 方案不可审阅 | `E_SCHEME_NOT_REVIEWABLE` | ✅ T-GATE-008 |
| R-07 | 降级卡未显式接受 | `E_DEMO_CONFIRMATION_REQUIRED` | ✅ T-GATE-010 |
| R-08 | `completeness` 高但缺主流程 | `demoReady=false`（不因分数放行） | ✅ T-GATE-011 |
| R-09 | Daemon 侧 `confirmed:false` 记录 | `E_DEMO_NOT_CONFIRMED`（**旧实现会跳过**） | ✅ T-DEMO-002 / T-DEMO-010 |
| R-10 | 快照不存在但传了 `confirmation_id` | `409 E_SCHEME_SNAPSHOT_NOT_FOUND` | ✅ T-HTTP-R10-001（创建）/ T-HTTP-R10-002（签署） |
| R-11 | 老项目 `src/**` | `E_WRITABLE_SCOPE_POLICY` 403 | ✅ T-SCOPE-011 |
| R-12 | 全仓通配 `**/*` | 拒绝（任何项目形态） | ✅ T-SCOPE-007c |
| R-13 | 敏感路径 `.env` / `.stagent/` / 锁文件 | `sensitive_forbidden` | ✅ T-SCOPE-005 / T-SCOPE-008 |
| R-14 | 仓库已有 `package.json` 却仍声明 `src/**` | 拒绝（判据是工程声明，不是目录是否存在） | ✅ T-SCOPE-015 |

### 9.3 幂等用例

| ID | 场景 | 期望 | 测试 |
| :--- | :--- | :--- | :--- |
| I-01 | 同 `confirmation_id` + 同修订重放 | `idempotent: true`，签署次数仍为 1 | ✅ T-ATOM-002 |
| I-02 | 同 id + 换修订 | `E_CONFIRMATION_ID_REUSED`，不签署 | ✅ T-ATOM-003 |
| I-03 | 快照同 id + 同内容重放 | 返回原快照，`created_at` 不变 | ✅ T-DEMO-013 |
| I-04 | 重试时重新冻结（`updatedAt` 变化） | 摘要不变，不冲突 | ✅ T-DEMO-013b |
| I-05 | 快照同 id + 内容变化 | `E_SCHEME_CONFIRMATION_CONFLICT`，不覆盖 | ✅ T-DEMO-014 |
| I-06 | 已冻结方案再冻结 | 原样返回（引用相等） | ✅ T-DEMO-013c |
| I-07 | 失败后同 id 重试 | 不被失败的幂等记录污染 | ✅ T-ATOM-011 |
| I-08 | `confirmation_id` 非法（越界/过短） | `E_CONFIRMATION_ID_INVALID`，不触碰右栏 | ✅ T-ATOM-010 / T-DEMO-015 |

### 9.4 故障注入（每一阶段都要能失败得干净）

| ID | 注入点 | 期望副作用 | 测试 |
| :--- | :--- | :--- | :--- |
| F-01 | 右栏静默失败（流式中断超时） | `E_QUIESCE_FAILED`，零写盘、零签署 | ✅ T-ATOM-005 |
| F-02 | 谓词拒绝 | 在 `VALIDATE` 中止，不写快照，解锁 | ✅ T-ATOM-006 |
| F-03 | 快照落盘失败（磁盘只读） | `E_SCHEME_SNAPSHOT_FAILED`，不签署，解锁 | ✅ T-ATOM-007 |
| F-04 | 签署失败 + 补偿成功 | `E_SIGN_AND_PREPARE_FAILED`，解锁可重试 | ✅ T-ATOM-008 |
| F-05 | 签署失败 + 补偿失败 | `E_COMPENSATION_FAILED`，**保持锁定** | ✅ T-ATOM-009 |
| F-06 | 修订号已过期（并发改方案） | `E_SCHEME_REVISION_MISMATCH`，不写快照 | ✅ T-ATOM-004 |
| F-07 | 任务图创建失败 | 归入 `SIGN_AND_PREPARE` 失败 → 补偿终止合同 | ✅ T-HTTP-F07-001（补偿成功）/ T-HTTP-F07-002（补偿失败） |
| F-08 | 快照文件损坏 / 手工篡改 | `readSchemeSnapshot` 返回 `null` → 拒签 | ✅ T-DEMO-015 |

### 9.5 Scope 分级（通配符）

| ID | 输入 | 期望分类/裁决 | 测试 |
| :--- | :--- | :--- | :--- |
| S-01 | `src/features/finance/report.ts` | `exact`，接受 | ✅ T-SCOPE-001 / T-SCOPE-006 |
| S-02 | `src/**`、`tests/**`（老项目） | `bare_top_glob`，拒绝 | ✅ T-SCOPE-002 / T-SCOPE-011 |
| S-03 | `**`、`**/*`、`*` | `bare_top_glob`，拒绝 | ✅ T-SCOPE-003 |
| S-04 | `src/features/finance/**` | `module_subdir_glob`，接受 | ✅ T-SCOPE-004 |
| S-05 | `src/**`（空绿野仓库，无 `package.json`） | 脚手架种子，接受 | ✅ T-SCOPE-007 / T-SCOPE-014 |
| S-06 | `src/**`（仓库已有 `package.json`） | 拒绝，须收敛到模块级 | ✅ T-SCOPE-007b / T-SCOPE-015 |
| S-07 | 收敛：glob 命中已写文件 | 替换为具体文件 | ✅ T-SCOPE-009 |
| S-08 | 收敛：glob 无命中 | 保留原种子 | ✅ T-SCOPE-009 |
| S-09 | 收敛去重 | 同一文件不重复 | ✅ T-SCOPE-010 |

**统计**：§3.1–§3.5 共 **45** 条，其中 `✅ 45` / `⏳ 0`。

> R-10 与 F-07 原先只能靠单测桩验证，现已补 `tests/integration/scheme-confirm-http-injection.test.ts`：起真 Daemon，故障由真实 HTTP 请求注入，断言落在落盘后的权威状态（合同 `lifecycle_state`、快照可回读性、图谱 404）而非内存桩的调用次数。

### 9.6 前端接线（组件必须真的连到谓词与回调）

> 评审反复出现的一类缺陷：函数写好了、`grep` 得到符号，但组件没传 props —— 新分支永远不渲染。以下用例专门守这一层。

| ID | 断言 | 测试 |
| :--- | :--- | :--- |
| U-01 | 未生成 Demo → 确认按钮可用、无阻断条 | ✅ T-UI-001 |
| U-02 | Demo 已生成未确认 → 确认按钮禁用 + 说明原因 | ✅ T-UI-002 |
| U-03 | 有未决冲突 → 即使 Demo 已确认也不放行 | ✅ T-UI-003 |
| U-04 | `completeness` 极低但四条件齐备 → 按钮仍可用 | ✅ T-UI-004 |
| U-05 | 点「确认此 Demo」真的触发 `onConfirmDemo` | ✅ T-UI-005 |
| U-06 | Demo 失败 → 同时给重试与接受降级，两者均可点 | ✅ T-UI-006 |
| U-07 | 已接受降级 → 显示已确认条且可确认 | ✅ T-UI-007 |
| U-08 | Demo 属旧修订 → 确认入口禁用（须先重生成） | ✅ T-UI-008 |
| U-09 | `locked=true` → 锁定条可见且带原因 | ✅ T-UI-009 |
| U-10 | 未锁定 → 无锁定条 | ✅ T-UI-010 |

测试文件：`tests/ui/task-c22-confirm-wiring.test.tsx`。

**合计 55 条**：`✅ 55` / `⏳ 0`。

---

## 10. 任务状态判定口径（防「假 COMPLETED」）

一条任务卡可在规范里标 `COMPLETED`，**当且仅当**：

1. §9 矩阵中属于它的行**全部**为 `✅`（有测试文件 + 测试 ID 可搜到 + 该测试在本地通过）；
2. `npm run typecheck` 相对基线**无新增错误**（本项目基线尚有已知错误，见 §11）；
3. 无「仅前端改了、Daemon 未接」或「仅写了函数、无调用点」的情况 —— 评审时必查调用点（`grep` 关键符号），不接受「代码已存在」当完成。

当前状态（2026-10-26）：

| 能力 | 实现 | 测试 | 可标 COMPLETED |
| :--- | :--- | :--- | :--- |
| 单一确认谓词（D1/D5） | ✅ | ✅ 16 条 | ✅ 是 |
| 直接签署状态边（D2） | ✅ | ✅ 3 条 | ✅ 是 |
| 确认开工原子事务 + 补偿（D3） | ✅ | ✅ 13 条 | ✅ 是 |
| Daemon 签署门禁 + 快照（D4） | ✅ | ✅ 18 条 | ✅ 是 |
| 通配符分级接入合同创建/批准 | ✅ | ✅ 17 条 | ✅ 是 |
| HTTP 级故障注入（R-10、F-07） | ✅ | ✅ 7 条 | ✅ 是 |

---

## 11. 验证环境与已知限制（诚实声明）

### 11.1 已通过的验证（2026-10-27 复跑）

| 项目 | 命令 | 结果 |
| :--- | :--- | :--- |
| 前端构建 | `npx vite build` | ✅ 通过（`✓ built`，预渲染 `/` 成功） |
| 类型检查 | `npx tsc --noEmit` | ✅ 相对基线**无新增**（13 条基线错误不变；另 1 条随旧 `canSign` 调用移除而消失） |
| 本次新增单测 | 4 个文件 | ✅ 64/64 |
| 本次新增 HTTP 注入测 | `scheme-confirm-http-injection` | ✅ 7/7（起真 Daemon，覆盖 R-10 / F-07） |
| 该套件的「有牙」验证 | 临时回退 `compensate` 的 `contract_id` 透传 | ✅ `T-HTTP-F07-001` 如期转红（`E_COMPENSATION_FAILED` ≠ `E_SIGN_AND_PREPARE_FAILED`），恢复后转绿 |
| 确认链回归 | 5 个文件（gate / atom / demo / scope / UI） | ✅ 74/74 |
| 合同与中止回归 | `contract-api` + `resume-abort` | ✅ 14/14 |
| 本次新增 UI 测 | `task-c22-confirm-wiring` | ✅ 10/10（既有 `task-c18` 5 条亦无回归） |
| 进程启动白名单 | `spawn-whitelist` | ✅ 17/17（新模块曾因注释里出现 `.exec(` 被误判，已改 `String#match` 并修正注释） |
| 端口登记表守卫 | `test-port-map` | ✅ 4/4（34 段区间两两互斥；合成重叠必被检出；临时制造真实重叠已验证转红） |
| WS / IPC 套件 | `ws-auth-handshake` + `ipc-stream` + `presentation-state-wiring` + `ws-auth` + `ws-security` | ✅ 33/33；5 文件满并发 60/60 |
| **全量** | `npx vitest run` | ⚠️ **1546 条 / 1533 过 / 7 失败 / 6 跳过**（见 §11.2 归因：7 条均非本卡代码） |

### 11.2 全量结果与归因

**最终读数（2026-10-27 06:06，端口去重 + 相对测量之后）**：`npx vitest run` → **1546 条 / 1533 过 / 7 失败 / 6 跳过**（199 文件：194 过 / 4 失败 / 1 跳过）。比上一版多 5 条（`test-port-map` 4 条 + `ws-auth-handshake` 的超时标尺 1 条）。

**7 条失败逐条归因——没有一条来自本次改动**：

| # | 失败项 | 条数 | 真实原因 |
| :--- | :--- | :--- | :--- |
| 1 | `baseline-c14e` OS 沙箱（写拒绝 / 出网失败 / 聚合 / 归档证据） | 4 | **本机 `sandbox-exec` 事实上不可用**：macOS 26.6.2 上只要 seatbelt 配置含 `deny` 子句（`(deny default)` 或 `(allow default)(deny network*)` 一样），内核就拒收——`sandbox_apply: Operation not permitted`，退出码 71；`(allow default)` 却能正常跑。探针因此拿不到任何「被拒绝」的证据。**并顺带暴露一个产品缺陷**：网络探针用 `code !== "CONNECTED"` 判定，无输出（`code === null`）被算成「断网已证明」，会给归档凭空挂一条假证据（详见 §11.5）。 |
| 2 | `chat-session` 「首字 ≤1s」 | 1 | 绝对延迟断言（实测 1955ms）。该轮 `setup` 累计 **2123s**、整轮 19.6 分钟，机器处于极端降速状态——这条是机器级 SLA，负载下不成立，见 §11.4。 |
| 3 | `deps-reuse` 「零拷贝挂载 < 500ms」 | 1 | 同类绝对延迟断言（实测 1553ms）。 |
| 4 | `task-c17-debug-log` 「daemon.jsonl 轮转」 | 1 | 30s 用例超时，同样是极端负载；上一轮它的 4 条同族用例是撞上沙箱删除阈值（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，count 50/50），本轮只剩这条超时。 |

对照：同一环境下**全部** WS / IPC / 端口相关用例（`ws-auth-handshake`、`ipc-stream`、`presentation-state-wiring`、`ws-auth`、`ws-security`、`test-port-map`、以及 `chaos-concurrency` / `merge-decision-d4` / `task-c15b`）均通过——这正说明 §5.4 的处置有效：原先必红的 3 条 WS 用例已在满并发下稳定通过。

> 读数口径仍然诚实：上一版「0 失败」是权限窗口与负载都正常的时段取得的。**要复现 0 失败，需要在启用沙箱、且机器无其他重负载的时段跑。**

**处置后读数（2026-10-27 06:20）**：`npx vitest run` → **1549 条 / 1532 过 / 7 失败 / 10 跳过**。上表 7 条已全部消除（沙箱 4 条改判 + 判定口径修复，性能 3 条改为「SLA + 3×本机调度抖动」，见 §11.4/§11.5），跳过数从 6 增至 10 是因为 4 条「真跑一次」的沙箱用例在本机不可证明时被显式跳过。

新出现的 7 条属于另一类，均**不是**产品回归：

| 类别 | 条数 | 说明 |
| :--- | :--- | :--- |
| safe-delete 垫片 | 6 | `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（count 50/50，`scope: "turn"`）——执行环境在同一轮累计 50 次删除后拒绝后续删除，`afterEach` 清理临时目录时抛错。仓库内已有先例（`tests/unit/deadlock-call-sites.test.ts` 的 `diskDeleteBlocked()`），按同一口径改造清理逻辑即可。 |
| dom UI 偶红 | 1 | `tests/ui/supervisor-draft-wiring.tsx` 的 `intent-paths` 断言，单跑 5/5 必绿、全量偶红；报错里打印的期望值是 14 条绿野种子，提示存在「预填被后续刷新覆盖」的时序问题。 |

这两项（safe-delete 垫片 6 条、dom UI 偶红 1 条）的**复现步骤、已知事实、假设与验收标准见本节上表**，状态为**未闭环**，交给后续执行。
> **⚠️ 文档事实校正（2026-10-27）**：原文指向 `docs/tasks/TASK-C.21-未闭环收尾-cursor-brief.md`。该目录与文件在当前仓库中**均不存在**（推测为写作时拟建路径，从未落盘）。按 D-7 裁决，此处改为**内联承载**，不再引用不存在的路径。若后续为这两项立卡，请写入 [`../specs/development-tasks.md`](../specs/development-tasks.md)。

此前一轮（提交者终端，03:05）读到 **1540 条 / 1525 过 / 9 失败**，9 条已逐条归因并全部消除：

| # | 失败项 | 条数 | 真实原因 | 处置 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `unit/supervisor-contract-generator` | 4 | 已提交的 `d8ff4e1`（绿野 npm 对齐）在**临时仓库没有 `package.json`** 时把 14 条脚手架种子并入可写范围、把 `max_file_modifications` 抬到 40；而这几条用例要测的是「默认预算」与「显式 scope」，夹具缺 `package.json` 就被判成绿野 | ✅ 夹具补 `package.json`（回归常规项目语义）；另加一条专门用例锁定绿野行为（种子并入 + 预算 40 + 用户路径仍排第一 + 非绿野对照组不变） |
| 2 | `integration/supervisor-draft-api` | 1 | 同上：`context_paths` 优先级用例的临时仓库同为绿野，期望被种子污染 | ✅ 夹具补 `package.json`，12/12 通过 |
| 3 | `unit/git-cwd-isolation` | 3 | **宿主仓库 `.git/config.lock` 残留**（189 字节、写了一半的 `[core]` 段），断言 `lockExists === false` 直接读到它 | ✅ 见下「锁的真实来源」，清理后 23/23 通过 |
| 4 | `daemon/chat-session` | 1 | `POST /api/chat/.../messages` 返回 409 `E_CHECKPOINT_FAILED`——本轮开工前的 git 快照写入被环境拒绝（`ensureCheckpoint`）。同一份代码清理后 7/7 通过 | ✅ 已随权限窗口恢复而转绿 |

**锁的真实来源（已定位，修正早前猜测）**：`.git/config.lock` 与 `.git/worktrees/stagent-base/HEAD.lock` 不是测试套件泄漏，而是**一次被中断的 `git worktree add` 的残骸**——`git worktree list` 里挂着一个 `locked initializing`、HEAD 全零、目录只剩一个坏 `.git` 文件的 `/private/tmp/stagent-base`。处置链条：`worktree unlock` → 删除该目录 → `worktree prune -v`（输出 `gitdir file points to non-existent location`）→ 列表恢复为宿主 + 4 个真实任务 worktree。

跑测期间宿主 `.git` 会出现 50+ 次 `index.lock` 的创建/删除事件，这是 git 读命令刷新索引的正常行为，**跑完为 0**；空闲 10 秒实测零事件，因此不是常驻 daemon 在轮询。

**首轮读数（历史，同日更早）**：1533 条 / 1499 过 / 28 失败 / 6 跳过。其中 18 条是 R1 首版判据过严导致的 403（已按 §8 R1 改判）、1 条是新模块被进程扫描误判（已改 `String#match`），其余 9 条即上表。

### 11.3 验证环境的三个坑（都会伪装成断言失败）

1. **权限窗口会随会话收紧，且不预告**。`scheme-confirm-http-injection` 首次 7/7 通过后，同一会话稍后重跑在 `beforeEach` 就失败——`git init` 报 `fatal: could not set 'core.repositoryformatversion' to '0'`（`.git/config` 写入被拒），7 条全部在 16ms 内失败、**无断言参与**。`vitest.global-setup.ts` 已把 `TMPDIR` 重定向到仓库内 `.tmp/vitest`，该策略连此目录的 git 写入也拒绝。判别方法：失败耗时异常短且集中在 `beforeEach`，就不是断言问题。
2. **残留锁比失败更贵**。被中断的 git 写入会留下 `.git/config.lock` / `.git/index.lock`，前者让 `git-cwd-isolation` 稳定变红，后者让仓库直接不可提交。跑测前先 `find .git -name '*.lock'`，跑完后 `git worktree list` 也顺手看一眼有没有 `locked initializing` 的残骸。
3. **daemon 测试的端口段是硬约束，现在由测试守住**。`createDaemon` 在区间内找空位，两套件共用同一段时，8 路并发下会「连上了但不是这个 daemon」，表现为 `unexpected first frame: ERROR`、`AUTH_OK` 回放拿到 `false` 一类怪错误，而不是干脆的 `EADDRINUSE`——所以它极易被误判成产品缺陷。本卡曾误用 3690–3695（属 `resume-abort` / `presentation-state-wiring` / `task-c15b`）。本轮把全部 34 段区间迁到互斥位置：

   | 文件 | 区间 | 文件 | 区间 |
   | :--- | :--- | :--- | :--- |
   | `scheme-confirm-http-injection`（本卡） | 3800–3809 | `task-c15b-rework-live-path` | 3860–3869 |
   | `ipc-stream` | 3810–3819 | `happy-path`（e2e） | 3870–3879 |
   | `presentation-state-wiring` | 3820–3829 | `circuit-breaker`（e2e） | 3880–3889 |
   | `ws-auth-handshake` | 3830–3839 | `protection-endpoint` | 3890–3899 |
   | `chaos-concurrency` | 3840–3849 | `supervisor-draft-api` | 3900–3909 |
   | `merge-decision-d4` | 3850–3859 | `console-static-d1b` | 3910–3919 |
   | | | `crash-recovery`（daemon） | 3920–3929 |

   并新增 `tests/unit/test-port-map.test.ts` 把这条约定变成可执行断言：扫描 `tests/**` 收集 `startPort`/`endPort`，任意两段重叠即失败（含同文件内），另查「构造 daemon 却没声明区间」的文件——`createDaemon` 的默认段是 3001–3010，不声明就等于所有未声明套件共享同一段。该守卫已用「临时把 `ipc-stream` 改成 3832–3836」验过会转红，报错直接点出 `ws-auth-handshake [3830–3839] ↔ ipc-stream [3832–3836]` 并打印整张登记表。

### 11.4 负载敏感断言：分清「延迟断言」与「等待预算」

8 fork 争 CPU 时，同一批 WS 用例会单跑全绿、并发偶红。本轮把成因拆成两类，处置方式不同：

**A. 延迟断言（断言「多快」）→ 必须相对测量。** `ws-auth-handshake` 原有两条 `expect(elapsed).toBeLessThan(200)`，并发下实测 396 / 561ms——它测的是调度公平性，不是产品行为。改为：

- **同机同刻取标尺**：先测一次「连上不发帧、等满 `authTimeout` 才断」的耗时，断言拒绝路径比它快出大半个预算。负载把两条路径同向推后，相减后只剩行为差。
- **计时起点放在「发起连接」而不是 `open` 回调**：服务端的 `authTimeout` 只在连接建立后才起算，从 `open` 起量会被握手期间的调度延迟吃掉一截——实测吃掉 627ms（1500ms 预算只量到 873ms），足以让标尺缩水、把差值断言打成假失败。
- **另加一条与负载无关的行为判别**：两条路径都发 4401，但 ERROR 帧的 message 不同（`Invalid session token` / `First frame must be AUTH` / `AUTH frame required within auth timeout`）。断言「原因不是超时」，比任何毫秒数都稳。帧在对端先 close 时可能随 socket 拆除一起丢，故 `reason` 允许为 `null`，只断言 `not.toBe(超时文案)`。

**B. 等待预算（断言「最终会到」）→ 必须宽松，失败要说清是「没到」。** `nextFrame` / `connectAndCollect` 的超时属于此类，收紧只会把「帧晚到」误判成「没反应」：

- `nextFrame` 预算 2s → 5s，并在连接先关闭时**立刻**失败并报出 close code——否则只能干等 2s 再报「没等到帧」，把「服务端 4401 了」误诊成「服务端没反应」。
- `connectAndCollect` 预算 1.5s → 5s，但 AUTH_OK 之后给 500ms 宽限即收工（服务端发完 AUTH_OK 紧接着回放），正常路径不让用例白等预算；连接被服务端关掉时立即交回已收帧。

**C. 真正的元凶：成功路径与超时用例共用一个 `authTimeoutMs`。** `ipc-stream` / `ws-auth-handshake` / `ws-auth` 都把 `authTimeoutMs` 设成 400ms 以便快速测超时，但这份配置**同样约束成功路径**：8 fork 抢 CPU 时 AUTH 帧的处理被拖过 400ms，服务端按配置先行 4401，合法 Token 也拿不到 `AUTH_OK`。更麻烦的是 ERROR 帧会随 socket 拆除一起丢，客户端只看到「没反应」——这正是 `unexpected first frame: ERROR` 与 `authOk === false` 的真实来源。处置是**按用例切换预算**（三个套件都加了 `startDaemon(ms)`）：

- `beforeEach` 起**宽预算**（`ipc-stream` / `ws-auth` 8s，`ws-auth-handshake` 10s），成功路径不陪绑；
- **超时用例自行切到短预算**（400ms；`ws-auth-handshake` 的拒绝用例 1s，因为标尺要快才能做差），并断言「等满了才断」（`elapsed ≥ 0.9 × 预算`）。

这**不是**放宽断言：超时用例仍然严格断言等满，只是把「测超时」和「测握手成功」两件事从同一个旋钮上解耦。全量实测：`ipc-stream` 6 条 7.2s、`ws-auth` 8 条 9.8s，与拆分前基本持平。

收敛结果：原先 8 文件满并发 60 条里必红 3 条（`ipc-stream` 握手、`presentation-state-wiring` 回放、`ws-auth-handshake` 合法 Token），现 60/60 通过；五个 WS 套件同跑 33/33；同一批用例在全量 1546 条的环境里也全绿。

**其余三条性能断言：补了余量函数，SLA 仍以原值为基线。**

它们在 06:06 那轮也红了，但性质与 WS 那批不同——是产品级性能门槛，不能简单删掉。处置方式是给余量，不是给豁免：

| 用例 | 原断言 | 现断言 | 极端负载实测 |
| :--- | :--- | :--- | :--- |
| `chat-session` 流式首字 | `首字 < 1000ms` | `< 1000 + 3 × 本机调度抖动` | 1955ms |
| `deps-reuse` 零拷贝挂载 | `< 500ms` | `< 500 + 3 × 本机调度抖动` | 1553ms |
| `task-c17-debug-log` 轮转 | 30s 用例超时 | 120s（等待预算） | 超时 |

「本机调度抖动」由 `tests/helpers/load.ts` 的 `measureSchedulingStallMs()` 现测：跑三次 0ms 定时器取中位数。机器健康时它≈0，断言等价于原始 SLA；机器被拖垮时余量随实测放大——**但仍在断言，不静默放过**，失败信息里会打印抖动值，一眼能分清「产品变慢」还是「机器卡了」。

`deps-reuse` 那条还补了一句注释：零拷贝的**本质证据**是 `lstat().isSymbolicLink()`，500ms 只是「顺手用 symlink 而不是 install」的旁证，别把旁证当主证。

`task-c17` 的超时是真的在写满轮转阈值（每次 64KB + stat），并发下顶到 30s 默认值；它属于「等待预算」，给到 120s 即可，不存在放宽语义的问题。

**F-07 补测顺带修掉一个真实缺陷**：`runConfirmSchemeAtomic` 原先在 `SIGN_AND_PREPARE` 失败时调用 `compensate` **不传** `contract_id`——建图失败发生在合同已落库之后，补偿只能靠前端闭包里的 `staging.contractId` 兜底。现已补 `signAndPrepare({ onContractCreated })`：合同一落库即回报事务，补偿与失败结果都带上该 id，`T-HTTP-F07-001` 断言 `result.contract_id === 已建合同 id` 且 `compensate` 拿到的就是它。

### 11.5 OS 沙箱证明的诚实性缺陷（本轮修复）

追查那 4 条沙箱失败时，发现的不只是环境问题，而是一个**会让证据链造假的缺陷**：

`proveScanNetworkDenied` 用 `denied = code !== "CONNECTED"` 判定。沙箱应用失败时子进程根本没跑起来，stdout 为空 → `code === null` → `null !== "CONNECTED"` 成立 → **`denied: true`**。同一次探测里，写路径用的是 `code !== "WROTE" && code !== null`（正确），两条路径口径不一致，于是出现「写未证明、网已证明」这种自相矛盾的结论。若此时落盘，`runProgressiveBaselineScan` 会把 `os_sandbox.network_denied = true` 写进归档，`osSandboxFullyProven` 也可能据此把「绝不触碰线上业务」升级成已兑现承诺——而实际上什么都没证明。

修复（`daemon/baseline/os-sandbox.ts`）：

| 改动 | 内容 |
| :--- | :--- |
| `probeDeniedFromOutput(stdout, successToken)` | 抽出纯函数，判据只有一条：**必须有输出**。无输出 → 返回 `false`（未证明），两条路径共用同一口径 |
| `isSandboxLaunchFailure(stderr)` | 识别 `sandbox_apply` / `sandbox-exec:` / `Operation not permitted`，用于在 notes 里写明失败原因 |
| `isOsSandboxApplicable()` | 用**实际使用的配置**探测（含 `deny` 子句），而不是宽松配置——实测宽松配置能跑，会给出「可用」的假结论 |
| `proveOsSandbox` 的 notes | 无法应用时写明「本轮不构成只读/断网证明」 |
| `baseline-c14e` 测试 | 本机不可证明时 `skipIf` 跳过 4 条真跑用例（不再报假红），另加 3 条用例：两条纯函数守住判定口径（任何平台都跑），一条断言「无法应用时不得声称已证明」 |

**这条缺陷的价值高于 4 条红**：它是「证据可以凭空生成」这一类问题，比任何一次断言失败都严重。测试改绿只是副产品。

---

## 12. 权威指针

| 主题 | 权威文件 |
| :--- | :--- |
| Supervisor 产品与监理语义 | 本文档（第一部分 + 第二部分） |
| 系统不变量 / 架构宪法 | [`../specs/system-architecture.md`](../specs/system-architecture.md) |
| 任务与验收 | [`../specs/development-tasks.md`](../specs/development-tasks.md) |
| 运行时硬契约（Scope / Token / 审计 / 终态） | [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md) |
| 不可逆技术决策 | [`../adr/`](../adr/)（ADR-0007 / 0010 / 0011 / 0012 / 0013 与本文直接相关） |
| 交付状态机 | `src/lib/state/delivery-state.ts`（代码即权威） |
| 确认事务 | `src/lib/journey/confirm-scheme-atomic.ts`（代码即权威） |
| 签署门禁 | `daemon/supervisor/demo/signing-gate.ts`（代码即权威） |
| 意图编译器 / 改动范围与验收 / 确认后单页旅程 | 本文**第三部分**（§13～§20，v2.1） |
| 意图编译器生成端 Prompt 与 Schema（J.10 实施口径，附属，冲突时以本文为准） | [`../specs/intent-compiler-prompt.md`](../specs/intent-compiler-prompt.md) |
| 方案补丁合并引擎（J.9 实施口径，附属，冲突时以本文为准） | [`../specs/scheme-patch-engine.md`](../specs/scheme-patch-engine.md) |
| Worker 派工墓地门禁（J.18 实施口径，附属，冲突时以本文为准） | [`../specs/worker-graveyard-gate.md`](../specs/worker-graveyard-gate.md) |
| 试玩自查引擎（J.16 实施口径，附属，冲突时以本文为准） | [`../specs/playtest-self-check.md`](../specs/playtest-self-check.md) |

---

# 第三部分 · 闭环规格 v2.1（意图编译器 · 改动范围与验收 · 确认后单页旅程）

> **ADR-0014 修订指针（2026-10-30 加注，不改本部分条文）**：用户已裁决 [ADR-0014](../adr/0014-three-agent-topology-open-supervisor.md)。以下条文以 ADR-0014 与任务卡「ADR-0014 修订」块为准：§13.2 右栏「懂产品的高级架构师」人设作废，右栏无系统提示（DEC-004）；§14.3 `partner_hint` 字段作废（J.10 修订）；§15 开工前审阅后置，只保留「确认开工」与「合入」两次点击，敏感项授权见 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §5（J.3 / J.5 / J.6 修订）；§16.3 / §16.5 / §16.7 中「右栏插入系统消息」「搭档一句话确认」改为中栏画布卡片（DEC-005，J.7 修订）。本部分之后的环节（项目分解、技术方案、测试义务、发布）见 [`delivery-lifecycle.md`](./delivery-lifecycle.md)。

> **状态**：**现行生效的目标规格**（2026-10-27 定稿）。本部分补齐第一、二部分留下的三处断裂：方案从哪里来（§14）、用户到底授权了什么（§15）、点了「确认开工」之后发生什么（§16）。
> **实现口径**：本部分是**目标契约**。§19 逐条登记了当前代码与本规格的落差；§18 矩阵新增行一律为 `⏳`，按 §10 判定口径，**接线并有测试前不得标 COMPLETED**。
> **优先级**：§17 决策 D6–D10 与 §7 决策同级；凡与第一部分 §3.2、§5.2.1 第 5 步、§7 D3「右栏保持锁定」、§7 D5「≥2 个模块」相冲突处，**以本部分为准**（各处已加改判指针）。本部分不改动 Daemon 状态机合法边、Token、Worktree、Evidence 与合并门禁（见 `runtime-contract-and-safety.md`、`state-machine-contract.md`）。
> **交叉引用**：沿用本文读法第 4 条——不带小数的「§N」（如 §7 D3、§8 R2、§10）指第二部分；带小数的「§N.M」（如 §3.3、§4.2）指第一部分；§13～§20 指本部分。
> **本部分的读法**：先读 §13 总纲（一张图看完整个旅程），再按需读 §14～§16。§17 是钉死的决策，§18 是验收矩阵，§19 是实现落差，§20 是给研发的施工顺序。

## 13. 总纲：一个页面，一条旅程，五个决定

### 13.1 产品灵魂（一句话）

**整理文档就是整理产品思路。** 用户只管自由地聊；Supervisor 在背后把零散对话整理成一份可审阅的方案实物；用户拍板后，受控的 Worker 在隔离区扎实施工；用户试玩满意，再合入项目。用户全程不需要搬运文档、不需要懂代码，也不会遇到前后打架的两份文档——因为**只有一份方案，从聊天到合入都是它**。

### 13.2 三个角色的硬分工（重申并补强）

| 角色 | 用户眼里是谁 | 能做什么 | 绝不能做什么 |
| :--- | :--- | :--- | :--- |
| **AI 搭档**（右栏） | 网页版 AI 式的自由脑暴伙伴（**无人设、无系统提示**，对齐 [ADR-0014](../adr/0014-three-agent-topology-open-supervisor.md)） | 发散、追问、解释、回答进度问题；**只读**查看项目 | 写任何文件、跑任何命令、宣称「方案已改」或「已开工」；注入架构师人设或保护前缀 |
| **意图编译器**（Supervisor 幕后） | 看不见；你只看见中栏方案在变 | 把对话编译成方案补丁（§14）；算出改动范围（§15）；把施工中的新消息分流（§16.5） | 直接改冻结快照；把推断写成「已确认」；签发凭证 |
| **Worker**（施工） | 看不见；你只看见步骤一格格完成 | 在隔离 Worktree 与合同范围内改码、自测 | 聊产品、扩范围、合入主干 |

**AI 搭档只读是硬约束**：无论右栏接的是哪个适配器（自研 OpenAI 兼容、Claude Code 或其他），在方案工作台里都必须以「只读工具集」运行——允许读文件、搜索、列目录；禁止写文件、禁止 shell、禁止网络工具。适配器做不到只读时，**不得**作为右栏搭档出现在方案工作台中（见 §19 L-02）。**禁止**写死「高级架构师」人设与暗中拼入消息前缀（ADR-0014 / DEC-004）。

**AI 搭档的三条诚实边界**（承接 §14.5）：不宣称方案已改、已开工或已确认；不替用户确认或签署；不承诺施工结果。这三条不是安全属性，由 §14.5 的中栏为准与 §14.7 的变化来源显示兜底。

### 13.3 用户一生只做五种决定

整个旅程里，系统只请用户做下面五种决定，其余一律由系统兜住：

1. **拍板分歧**：方案里互斥的两种想法选哪个（决议区冲突卡）。
2. **点头范围**：这一轮改哪些地方、敏感处要不要碰（§15）。
3. **确认开工**：点 UI「确认开工」（或小改动的「直接改」，§16.11）。多合同场景下每份合同各点一次。
4. **处理意外**：施工中需要扩范围、超预算、需要人工确认时，在一张白话卡上点一下（§16.6）。
5. **验收合入**：试玩后「合入项目」，或说「这里不对」。

**第一反应速记（前置说明，规格态 ⏳，不新增决定类型、不阻断流程）**：试玩产物呈现后、用户点「合入项目」或「这里不对」之前，系统呈现一个不阻断的时效性输入（第一印象速记：一句白话感受，可跳过）；计时窗口结束后随验收决定一并入账。该输入的回填走 K-14 质疑归因账本 `trigger: "first_impression"`，用于抢在适应偏差钝化感知前记录第一反应，作为后续三分类回溯的触发源。计时窗口长度实现期定。

**禁止**把以下判断推给用户：合同 JSON、glob 写法、Git 哈希、测试退出码、「按缺陷修复 / 按新需求演进」这类技术分类（§16.7）。

### 13.4 一张图看完整个旅程

```text
                 ┌──────────── 中栏「方案工作台」（同一个页面，顶部四步进度条） ────────────┐
                 │  ① 方案            ② 施工             ③ 试玩             ④ 已合入        │
右栏 AI 搭档     │                                                                          │
 方案对话 ──────▶│ 摘要/图/决议        步骤清单逐格完成    真实界面 + 验收清单  变更摘要        │
 （自由聊）      │ 改动范围与验收      当前在做什么        对照原型（若有）     基于此继续      │
                 │ [生成 Demo]可选     [暂停][放弃本轮]    [第一印象速记] [合入项目]           │
                 │ [确认开工] ────交接────▶                                                  │
 施工对话 ──────▶│                    补充/改需求 → 中栏卡片，一键决定                        │
 试玩对话 ──────▶│                                       「这里不对」→ 对话式自查 → 返工     │
                 └──────────────────────────────────────────────────────────────────────────┘
```

**页面纪律**：

- 中栏始终是**同一个**「方案工作台」页面，四步只是同页内的四幕，**不新开 Tab、不自动跳到别的视口**（旧五视口与架构 §7.1 四视口自动切换不再是日常入口）。**项目地图嵌在同页**（确认后的整理态 / 施工幕顶部），**禁止**另开第二套导航。
- 已确认的方案在 ②③④ 幕里始终以「已确认方案（只读）」折叠卡置顶，随时可展开回看——用户永远知道「我当初批的是什么」。
- 右栏**从不永久锁定**。只在点「确认开工」后的交接几秒内禁止输入（§16.3）；之后切换为施工对话（D9）。

---

## 14. 方案意图编译器（Intent Compiler）

### 14.1 定位

意图编译器是 Supervisor 的核心：**把自由对话实时编译成结构化方案**。它取代第一部分 §2.2「现行实现口径」中的关键词启发式（`scheme-draft.ts` 的 `MODULE_HINTS` 正则）。启发式**降级为离线兜底**（§14.8），不再是主路径。

三条设计原则：

1. **模型出结构，代码出图**。大模型只产出结构化的方案补丁（JSON），**不产出 Mermaid 文本**。三张图（架构、思维导图、主流程）由代码从结构确定性渲染。这样图永远与结构一致，模型也无法画出「图里有、方案里没有」的东西。
   - **图降级（2026-10-31）**：模块数或流程边超过可读阈值（建议：模块 ≥ 5 或主流程边 ≥ 8）时，**禁止**再渲染整张挤成一团的 Mermaid；改为**分层摘要**（模块列表 + 主路径三步 +「展开看图」按子图）。**图不是唯一审阅面**——摘要卡、决议卡、范围与验收卡同等重要；用户可不看图也能确认开工。
2. **只发补丁，不重写**。编译器每次输出一组增量操作（`SchemePatch`），由 Daemon 校验后合并进方案。它**永远不能**整份替换方案，因此不可能冲掉用户手改的内容。
3. **用户说过的才算数**。只有用户在对话中说过或明确同意过的内容，才能进入「已确认」；模型自己的推断一律以「AI 推荐 · 待确认」形态出现在决议区。

### 14.2 方案数据结构 `SchemeDraftV2`

```ts
/** 对话中的一条用户消息；所有方案条目都必须能追溯到它 */
type TurnRef = { turn_id: string; quote?: string };

type ItemSource = "user_said" | "user_confirmed" | "ai_inferred" | "user_edited";

interface SchemeItemMeta {
  id: string;                     // 稳定 id，跨补丁不变
  source: ItemSource;
  evidence: TurnRef[];            // ai_inferred 也必须给出它依据的用户原话；台账投影条目级化为 EvidenceItem[]，见 K-1
  user_pinned: boolean;           // 用户手改过即 true（§3.3）
  updated_in_revision: number;
  introduced_after_turn_seq?: number; // K-8，引擎自有：条目首次出现时的用户消息水位；编译器提交的同名字段一律忽略（记 W_COMPILER_ANCHOR_IGNORED）
}

interface SchemeDraftV2 {
  scheme_id: string;
  scheme_revision: number;        // 每次合并补丁 +1
  frozen: boolean;

  title: string;                  // 一句话：这一轮做什么
  summary: string;                // 白话摘要（3～5 句）
  audience: string | null;        // 给谁用
  goals: (SchemeItemMeta & { text: string })[];
  out_of_scope: (SchemeItemMeta & { text: string })[];   // 用户说「这次不要」的事

  modules: (SchemeItemMeta & {
    name: string;                 // 白话模块名
    purpose: string;              // 它干什么
    user_visible: boolean;        // 有没有界面
    kind: "new" | "change_existing";
    project_anchor?: string;      // 若对应项目里已有的模块/目录，写白话名（不是路径）
  })[];

  flows: (SchemeItemMeta & {
    name: string;                 // 主流程名
    steps: { actor: string; action: string; module_id?: string }[];
  })[];

  entities: (SchemeItemMeta & { name: string; fields_hint: string[] })[];

  decisions: (SchemeItemMeta & {  // 未明说的业务项：AI 推荐 · 待确认
    question: string;
    recommended: string;
    alternatives: string[];
    rationale: string;            // 为什么这么推荐（白话一句）
    risk: "low" | "high";         // high 会在确认摘要里复述
    status: "pending" | "accepted" | "changed";
    chosen?: string;
  })[];

  conflicts: (SchemeItemMeta & {  // 对话里互斥的想法：必须选
    question: string;
    options: { id: string; label: string; evidence: TurnRef[] }[];
    chosen_id: string | null;
  })[];

  open_questions: (SchemeItemMeta & { text: string })[];  // 软提醒，不阻断任何门禁

  acceptance: (SchemeItemMeta & {  // 白话验收条目（§15.4）
    text: string;                  // 「能在首页看到本月逾期项目数」
    check: "auto" | "playtest" | "both";
  })[];

  size_hint: "tiny" | "standard" | "large";   // 供 Fast Path（§16.11）与拆分建议使用
  notes: string;                   // 用户备注（只由用户写）
}
```

> 与现有 `SchemeDraft` 的关系：V2 是超集。`mermaidArchitecture` / `mermaidFlow` / `mermaidMindmap` 不再存储，改为由渲染函数 `renderSchemeDiagrams(draft)` 按需生成；快照摘要以 V2 结构为准（剔除 `updated_in_revision` 与时间戳，承接 §8 R3）。

### 14.3 补丁协议 `SchemePatch`

```ts
interface SchemePatch {
  base_revision: number;          // 编译时看到的方案修订号
  compiled_from_turns: string[];  // 本次消化的用户消息 id
  ops: SchemeOp[];
  partner_hint?: string;          // 可选：建议 AI 搭档自然追问的一个问题（§14.5）
}

type SchemeOp =
  | { op: "set_title" | "set_summary" | "set_audience"; value: string; evidence: TurnRef[] }
  | { op: "upsert_module" | "upsert_flow" | "upsert_entity" | "upsert_goal"
        | "upsert_out_of_scope" | "upsert_acceptance"; item: object; evidence: TurnRef[] }
  | { op: "remove_item"; id: string; reason: string; evidence: TurnRef[] }
  | { op: "reject_item"; id: string; reason?: string; evidence: TurnRef[] }   // K-11：用户在聊天中否决，见 scheme-patch-engine.md §2.3.2
  | { op: "propose_decision"; item: object; evidence: TurnRef[] }
  | { op: "raise_conflict"; item: object; evidence: TurnRef[] }
  | { op: "mark_user_confirmed"; id: string; evidence: TurnRef[] }   // 用户在聊天里同意了某推荐
  | { op: "add_open_question"; text: string; evidence: TurnRef[] }
  | { op: "set_size_hint"; value: "tiny" | "standard" | "large"; evidence: TurnRef[] };
```

**Daemon 合并规则（确定性，零模型）**：

| 情形 | 处理 |
| :--- | :--- |
| 补丁不符合 Schema、引用不存在的 id、`evidence` 为空 | 整个补丁丢弃，记一条编译告警；**不**部分应用 |
| `evidence` 里的 `turn_id` 不是用户消息（是 AI 回复） | 该 op 丢弃。AI 自己说过的话不构成事实 |
| op 要改 `user_pinned: true` 的条目 | 转成决议区的「覆盖建议」卡（§3.3），等用户同意 |
| op 要把 `ai_inferred` 写成 `user_said` | 拒绝；只有 `mark_user_confirmed` 且证据是用户原话时才可升级 |
| `remove_item` 指向已确认或已 pin 的条目 | 转成「覆盖建议」卡 |
| `reject_item`（K-11）证据不在本批，或锚定句不含否定词 / 为问句 | 该 op 丢弃；指向已 pin 或已确认条目 → 覆盖建议卡 |
| `base_revision` 落后于当前修订 | 不直接合并；以最新方案为基础**重新编译一次**（最多重试 1 次，仍落后则等下一轮） |
| 方案已冻结 | 补丁一律丢弃（冻结后的新意图走 §16.5 分流） |

每次成功合并 → `scheme_revision + 1` → 触发 §15 的范围预检 → 广播给前端。

> **实施口径**：上表各行的求值顺序、两级原子性（结构错误整补丁丢弃 / 溯源错误单 op 丢弃）、依赖闭包与死锁处置，见 [`scheme-patch-engine.md`](./scheme-patch-engine.md) §2（`TASK-J.9`）。

### 14.4 触发节拍与成本纪律

| 事件 | 编译器行为 |
| :--- | :--- |
| 用户发出一条消息（`USER_TURN_COMMITTED`） | 1.2 秒防抖后编译；防抖期内的多条消息合并成一次 |
| 编译进行中又来新消息 | **严禁并发**；当前结果落盘后立即以合并后的新消息再编译一次（同时最多 1 个在途） |
| AI 搭档回复完毕 | **不触发**（AI 的话不是事实） |
| 空闲计时 / 定时器 | **不触发**（承接 `draft-generator.ts` 的「空闲零调用」结构保证） |
| 用户手改中栏 | 不触发模型；只更新方案并打 pin；**pin 优先于任何在途/后续补丁** |

- **触发分类**：`USER_TURN_COMMITTED` 属于「用户主动请求」类触发（与 `USER_REQUEST` 同级），因此**不违反**「`IDLE_TIMER` / `DEBOUNCE_TIMER` 不得调用模型」的纪律——防抖只是合并用户消息，不会在用户沉默时自行调用。
- **白话进度**：编译在途时，中栏顶部固定轻提示「**正在整理你刚说的…**」，按钮可短暂转圈；**禁止**在编译未完成时让主按钮乱闪或因半成品 `ScopePlan` 反复抛 `E_SCOPE_NOT_READY` 惊吓用户（可灰显并保留上一份可审修订）。
- **节流**：同一会话对编译模型的调用间隔下限实现期定（建议 ≥ 800ms），与 1.2s 防抖叠加，防止连发导致重绘抖动。
- **模型与账本**：编译器使用独立配置的模型（默认取设置里的模型钥匙；可单独配「编译模型」，建议用快而便宜的模型），用量记入 Supervisor 独立账本（`SupervisorBudgetLedger`），不占 Worker 预算。
- **输入裁剪**：每次编译的输入 = 当前方案（完整）+ 自上次编译以来的新用户消息（完整）+ 更早对话的滚动摘要 + 项目画像（§14.6）。不重复发送全量历史。
- **预算用尽**：本轮编译停止，中栏顶部显示「方案助手今天的额度用完了，方案暂停自动整理；你仍可以继续聊或手改方案」。不静默失败。

> **实施口径**：编译器的 System Prompt、生成 Schema、输入渲染与编译循环见 [`intent-compiler-prompt.md`](./intent-compiler-prompt.md)（`TASK-J.10`）。

### 14.5 AI 搭档与编译器怎么配合

- **右栏是自由脑暴搭档**：搭档不注入方案摘要、未选冲突、高风险推荐或编译器提示，不设一次一问的引导节奏，话题与追问由用户主导。方案是否变化的唯一展示位置是中栏（§14.7）。
- **三条诚实边界**：（a）搭档不宣称方案已改、已开工或已确认，可以说「我记下了」，但方案是否真的变了，以中栏为准；（b）不替用户确认或签署；（c）不承诺施工结果。中栏每次变化都显示来源（§14.7），用户不会被搭档的话误导。
- **用户在聊天里同意推荐**：用户说「对，就用假数据」→ 编译器输出 `mark_user_confirmed`，决议区该项自动打勾并标注「你在第 5 条消息里确认了」。用户不需要再去中栏点一遍。
- **「你看着办」= 采纳推荐（2026-10-31）**：用户原话含「你看着办 / 按最通用的来 / 随便你」等委托语时，编译器对**当前决议区已展示的推荐默认**批量发出 `mark_user_confirmed`（证据锚定该条委托原话），并在中栏标注「按你说的，我按推荐办了」。**不是**静默发明新默认；未展示过的项仍须先出现在决议区。
- **冲突卡「按推荐来」**：每张冲突卡除选项外，固定提供一键「按推荐来」（采纳 `recommended_option_id`）。存在 OPEN 冲突时仍禁用「确认开工」，但用户可用一键清空冲突，避免「审讯感」。

### 14.6 项目画像（编译器看得到的项目事实）

编译器需要知道「项目里已经有什么」，才能把「改一下登录页」对到正确的地方。项目画像由 Daemon **只读**生成，限于元数据：

- 顶层目录与二级目录名、主要路由/页面名（从约定目录推断）、`package.json` 的 `name` 与 `scripts` 键名、技术栈识别结果；
- 是否绿野（与 `isGreenfieldRepo` 同口径）；
- 保护清单的**白话类别**（不含具体值）。

**禁止**送入：`.env*` 内容、任何密钥、锁文件全文、`.stagent/` 内部文件、源码全文。需要看具体代码时，由 AI 搭档用只读工具按需查看，且只在搭档自己的会话里。

### 14.7 中栏怎么呈现「方案在变」

- **变化可见、不打扰**：每次合并后，被改动的条目高亮 3 秒；方案顶部出现一行轻提示「刚刚整理：新增 2 个模块 · 1 项待你拍板」，5 秒后淡出。
- **来源可查**：每个条目悬停可见「来自你第 3 条消息：『……』」；`ai_inferred` 条目带「AI 推荐」角标。
- **一键撤销**：轻提示上带「撤销这次整理」，撤销最近一次补丁（方案回到上一修订）。撤销本身也算用户编辑，相关条目打 pin，防止下一轮又被加回来。
- **进度条**：`completeness` 继续只作进度展示（§7 D5 不变）。

#### 点击溯源联动
- **点击定位**：中栏方案条目（模块/决策/冲突/验收）可点击；点击后右栏自动滚动到 `evidence[].turn_id` 对应的用户消息气泡，并高亮其 `quote` 片段 3 秒。
- **反向联动**：悬停右栏用户消息时，中栏由该消息贡献的条目轻描边。
- **锚点规则**：`TurnRef.quote` 用于气泡内定位高亮，不是展示文案；多个 evidence 时主锚点取第一条 `user_said`/`user_confirmed` 消息。
- **真实性底线**：无 `evidence` 的条目（离线兜底启发式产出）不显示溯源入口，禁止假装可溯源。

### 14.8 失败与降级

| 情形 | 行为 |
| :--- | :--- |
| 没配模型钥匙 | 编译器以离线兜底运行（现有关键词启发式），中栏顶部常驻提示「方案助手未连接，方案只能粗略整理；配置模型钥匙后会自动变聪明」 |
| 模型超时 / 返回非法 JSON | 丢弃本次补丁，方案不变；连续 3 次失败才显示「方案助手暂时没跟上，你说的话都记着，稍后会补上」 |
| 编译结果与用户手改冲突 | 全部转覆盖建议卡（§14.3），不覆盖 |

### 14.9 质量验收（防止「编译器胡编」）

- 建立**金标对话集**：至少 20 段覆盖不同领域（管理后台、营销页、脚本工具、改已有页面、纯逻辑任务）的真实对话，每段标注期望的模块、主流程、冲突与验收条目。
- 验收标准：模块召回 ≥ 80%；**凭空捏造**（无用户证据的条目被标为 `user_said`）= 0；冲突漏报 ≤ 1 / 20。
- 每次更换编译模型或编译提示词，必须重跑金标集。

### 14.10 `demoReady` 改判（覆盖 §7 D5 的模块数条件）

`demoReady = 至少 1 个 user_visible 模块 && 至少 1 条主流程 && 无未选冲突 && 至少 1 轮有效业务输入`。

原条件「≥ 2 个业务模块」作废：它让「只做一个功能」的需求永远看不到 Demo 按钮。纯逻辑任务（没有 `user_visible` 模块）不出现「生成 Demo」，这是预期行为——它们本来就不需要原型。

---


### 14.11 证据台账（Evidence Ledger）契约与不可变式

> **定位**：证据台账是 `SchemeDraftV2` 的持久化投影与幕后决策记录，是人类主观气态意图向机器确定性相变的唯一合法中间相。
> **权威方向**：
> 1. **冻结前**：台账为单一事实源（SSOT），所有对话与编辑的增量补丁必须先在台账确权记账；
> 2. **冻结后（`freeze()` 之后）**：以冻结快照（Snapshot）为唯一执行与验收权威源，台账转为只追加（append-only）的只读审计流；
> 3. **后续继承**：§16.8「基于这次继续」以最终通过的冻结快照及其回写记录，以及墓地子账本（`graveyard` 的 `RejectedAlternative` 全量活跃条目）为继承基线，新台账直接基于此快照初始化，不得从空白状态从头脑补。跨 journey 时墓碑随迁：`disallow_revival` 语义与 `evidence` / `rejection_reason` 整体保留，新 journey 的派工上下文注入（INV-LEDGER-03）对随迁条目同样生效；`rejected_id` 与新 journey 冲突时以旧 journey 前缀区分（如 `REJ-{journey}-001`），具体格式实现期定。

#### 1. 数据结构与子账本划分 (Schema)

条目级元数据严格复用 `SchemeItemMeta`（保持单一条目颗粒度，不做字段级过度包装），`ItemSource` 维持既定枚举 `"user_said" | "user_confirmed" | "ai_inferred" | "user_edited"`。AI 兜底默认值统一由 `decisions[]` 条目中 `status: "pending"` 派生，不新增枚举。

为支持用户在 UI 手动修改且不破坏 `INV-LEDGER-01` 的确权约束，新增 `EditRef` 证据类型，与 `TurnRef` 构成判别联合：

```typescript
// 对话原话引用（仅指向用户发言）
export interface TurnRef {
  turn_id: string;          // 必须为用户消息 turn_id（禁止指向 AI 回复）
  quote?: string;           // 用户原话切片（用于高亮溯源与子串核验）
}

// UI 手动编辑事件引用（解决手改场景无 turn_id 锚点的问题）
export interface EditRef {
  edit_event_id: string;    // UI 手动修改事件唯一 ID
  edited_at: number;        // 编辑时间戳
  field_name?: string;      // 改动的字段标识
  previous_value?: string;  // 编辑前旧值快照
}

// 统一证据单元
export type EvidenceItem =
  | { kind: "turn"; ref: TurnRef }
  | { kind: "edit"; ref: EditRef };

// 条目级元数据（台账投影面；字段语义与 §14.2 一致，ItemSource 定义见 §14.2，evidence 按 K-1 由 TurnRef[] 投影为 EvidenceItem[]）
export interface SchemeItemMeta {
  id: string;
  source: ItemSource;
  evidence: EvidenceItem[];
  user_pinned: boolean;            // 与 §14.2 对齐为必填
  updated_in_revision: number;
  introduced_after_turn_seq?: number; // K-8，引擎自有：条目首次出现时的用户消息水位；编译器提交的同名字段一律忽略（记 W_COMPILER_ANCHOR_IGNORED）
}

// 墓地账本条目（记录被枪毙或否决的方案，防止 Agent 金鱼记忆）
export interface RejectedAlternative {
  rejected_id: string;              // 唯一标识（例如 REJ-001）
  proposal: string;                 // 被枪毙的方案或路径描述
  rejected_by: "user" | "security_gate"; // 否决发起方
  rejection_reason: string;         // 否决理由（保住 why 与取舍原由）
  evidence: EvidenceItem[];         // 驳回依据（用户原话切片或门禁拦截日志）
  disallow_revival: boolean;        // 是否禁止 Agent 自行提请复活
  updated_in_revision: number;      // 产生否决时的方案修订号
}

// 证据台账持久化聚合结构
export interface EvidenceLedger {
  // 子账本一：事实与需求台账（Claim Ledger）
  claims: {
    goals: (SchemeItemMeta & { text: string })[];
    boundaries: (SchemeItemMeta & { text: string })[];
    acceptance: (SchemeItemMeta & { text: string })[];
  };
  // 子账本二：决策与代选择台账（Decision Ledger）
  decisions: (SchemeItemMeta & {
    topic: string;
    chosen: string;
    status: "pending" | "confirmed"; // pending 状态即表达 AI 默认推荐
  })[];
  // 子账本三：否决与墓地台账（Graveyard Ledger）
  graveyard: RejectedAlternative[];
  // 子账本四：质疑归因账本（Attribution Ledger，K-14）
  // 每次用户质疑/差异事件（第一反应速记、『这里不对』、验收未过）必须回填三分类归因；
  // 台账只存原料不够，归因是读数——它是感知钝化与沉默损耗的度量出口。
  // 归因只写本台账：不改 requirements-store.ts 的 source 枚举，不在需求快照侧新开字段。
  // 三分类语义：
  //   (a) approved_on_list：在决议清单上但被批准（审查通道问题）；
  //   (b) diff_unsurfaced：在差集里但未被分级上屏（分流规则问题）；
  //   (c) absent_from_diff：差集里根本没有（规格残缺 / 回写断裂 / 意图未结晶）。
  attributions: {
    attribution_id: string;
    trigger: "first_impression" | "user_dispute" | "acceptance_fail"; // 触发源（闭集，K-16：已删除 `| string` 兜底）
    linked_reason_code?: ReasonCode; // K-16：可选，类型为 ReasonCode（运行时由 reasonCodeSchema 校验；不新增码、不建映射）；仅 trigger === "acceptance_fail" 的条目可带
    item_ref?: { section: string; id: string };   // 归因指向的方案/台账条目（可空）
    category: "approved_on_list" | "diff_unsurfaced" | "absent_from_diff"; // 三分类
    resolution_note: string;
    created_in_revision: number;
  }[];
}
```

#### 2. 不变式 (Invariants)

为杜绝模型幻觉与偷跑，以下不变式由 Daemon 确定性规则执行（零模型解释权）：

| 不变式 ID | 名称 | 规则约束 | 违反处置 |
| :--- | :--- | :--- | :--- |
| **INV-LEDGER-01** | 用户原话确权律 | 当条目 `source === "user_said" \| "user_confirmed"` 时，`evidence` 必须非空且必须包含有效 `kind: "turn"`；其 `turn_id` 必须对应用户消息（指向 AI 自身回复直接判定非法）。若携带 `quote`，Daemon 执行**确定性子串比对（substring check）**，严禁模型释义引用。<br>当条目 `source === "user_edited"` 时，`evidence` 必须非空且包含有效 `kind: "edit"`。 | 整个 op 丢弃，记编译告警；严禁部分应用。 |
| **INV-LEDGER-02** | 代选择阻断律 | `source === "ai_inferred"` 的条目升级为 `user_confirmed` 时，仅允许由 `mark_user_confirmed` op 携带用户明确肯定原话的 `TurnRef` 触发；严禁编译器或 Worker 静默升级。<br>所有未获用户明确批准的 AI 默认值，必须作为 `status: "pending"` 的 decision 停留在决议区。 | 阻止无凭据确权，保留 ai_inferred 标记与待决状态。 |
| **INV-LEDGER-03** | 墓地不可复活律与逃生口 | 组装派工上下文（Worker Dispatch Prompt）时，强制自动注入 `graveyard` 活跃条目。<br>1. **机器侧拦截**：Worker 或 Agent 产出物命中 `disallow_revival === true` 的方案时，门禁直接拦截（`E_PROPOSAL_PREVIOUSLY_REJECTED`）；用户面**先**白话「你之前否决过类似做法」，码进技术细节。<br>2. **逃生口（显式重开）**：用户改口必须走**显式重开**：中栏卡「你改主意要加回『…』吗？[加回来] [先不]」；点「加回来」后以新的 `user_said` 入账并标记墓碑 `revived`。模糊暗示只触发这张卡，**禁止**模型自行推测复活。 | 拦截 Agent 自行重提已枪毙方案；保障用户主动撤销与变更权；改口有温度。 |
| **INV-LEDGER-04** | 回写防脱钩律 | 施工完成与体验验收后，系统必须产生 Delta 回写补丁（包含实测证据与验证结果），将 Claim 状态与最终 Diff 固化回快照；下一轮启动时以当前快照为基线继承，禁止绕过账本直接改码导致真相脱钩。 | 阻断会话无痕退出。 |

#### 3. 与 `docs/templates/` 核心主键映射表

证据台账与仓库传统文档模板包（`00-filling-guide.md`）保持严格的语义映射：

| 传统模板主键 | 证据台账映射模块 | 说明与语义区别 |
| :--- | :--- | :--- |
| `REQ-###` | **Claim Ledger** (`claims.goals`, `claims.boundaries`) | 传统模板为静态填空；台账条目为携带原话归属与因果修订号的动态意图契约。 |
| `AC-###` | **Claim Ledger** (`claims.acceptance`) | Given-When-Then 验收断言，逐条绑定 `TurnRef` 证明其来自用户需求。 |
| `ADR-####` | **Decision Ledger** (`decisions`) | 记录架构选型与行为决策；通过 `pending` 状态消除静默代选择。 |
| `EVID-###` | **EvidenceItem** (`TurnRef` / `EditRef`) | 细化到对话原话定位高亮或手动修改事件，提供确定性审计链路。 |
| *(传统模板无对应)* | **Graveyard Ledger** (`graveyard`) | 传统文档中否决分支随会话丢失；台账中永久留存被否决方案与理由，斩断金鱼记忆。 |

#### 4. 实施口径与收紧项（`TASK-J.9`）

`INV-LEDGER-01～03` 的零模型判定算法见 [`scheme-patch-engine.md`](./scheme-patch-engine.md)：引用锚定 §3，墓地复活 §4。该文件 §1.3 登记了对本节的收紧与补全，要点如下：

- **K-1**：编译器 op 只能携带 `TurnRef`；op 里的 `EditRef` 一律判伪造。`EditRef` 只由用户手改产生。
- **K-2**：`mark_user_confirmed`、墓地复活、新条目声明 `user_said` 三种场景 `quote` 必填（后者缺失时降级为 `ai_inferred`）。
- **K-4**：`RejectedAlternative` 追加可选字段 `item_ref`、`fingerprint`、`revival_keys`、`rejected_after_turn_seq`、`status`、`revived`；墓碑只标记复活，不删除。
- **K-5 / K-6**：`rejected_by: "security_gate"` 的墓碑不能经补丁复活；`disallow_revival: false` 命中时转待决推荐卡，不直接写入。
- **K-7**：§14.7「撤销这次整理」产生新修订，修订号永不回退。
- **K-3**：§14.3 的两级原子性——结构类错误整补丁丢弃；溯源类错误单 op 丢弃；幸存 op 作为一个修订整体提交或整体回滚（见 `scheme-patch-engine.md` §2.4）。口径正文见 §14.3 下方的实施口径段落，此处仅作编号登记。
- **K-8**：`SchemeItemMeta` 追加引擎自有的可选字段 `introduced_after_turn_seq`（条目首次出现时的用户消息水位），用于识别「拿用户很久以前的一句『对』确认新条目」的假冒确认（`E_CONFIRM_PREDATES_TARGET`）。编译器提交的同名字段一律忽略（记 `W_COMPILER_ANCHOR_IGNORED`）。
- **K-9**：引擎码表中的 `E_* / W_* / S_*` 码是编译日志码，面向开发者与审计，不进入 `runtime-contract-and-safety.md` §2.3 签署闭集，也不登记入 `src/lib/error-codes.ts` 的 `ERROR_CODES`。例外：`E_PROPOSAL_PREVIOUSLY_REJECTED` 由引擎在编译期以 DROP 裁决输出（含 Z-04 静默 DROP），故同时出现在码表与 `journal.verdicts` 中；其拒绝码归属为门禁层（runtime §8 L3，定义见 INV-LEDGER-03），同样不进入 §2.3 签署闭集。例外的正式登记见 K-15。
- **K-10**：墓地命中判定增第 (d) 条：`revival_keys` 中字素数 ≥ 4 的元素被 `matchNormalize(op 主文本)` 包含即命中，但只进入复活判定，不直接 DROP。
- **K-11**：新增 `reject_item` 操作：用户在聊天中否决某条目；本批用户消息须含否定词且非问句，生效后入墓（`rejected_by: "user"`、`disallow_revival: true`）；受保护目标走覆盖建议卡。
- **K-12**：复活判定路径忽略编译器提供的 `occurrence`，锚点取最后一处，记 `W_REVIVAL_OCCURRENCE_IGNORED`。**显式风险**：确认判定路径（`mark_user_confirmed`）同样接受 `occurrence`，存在同型洗白面（「我同意。算了不同意」+ `occurrence: 0`），修法待定，落地前不得视为无问题。
- **K-13**：生成端开放 `reject_item`：仅在用户对方案中现有条目明确否决时发出，发射条件与金标见 `intent-compiler-prompt.md` §4.5、§8.2 G 组；引擎对已有效用户墓碑的重复否决记 no-op（`W_NOOP_IDENTICAL`，见 `scheme-patch-engine.md` §2.3.2 P4）。否决不用 `remove_item`（它不入墓）。
- **K-14**：质疑归因账本——每次质疑事件强制回填三分类归因（清单上已批准 / 差集未上屏 / 差集没有），只写台账不改 `requirements-store.ts` 的 `source` 枚举；墓碑跨旅程存活由权威方向第 3 条扩充解决，两件事分开裁决。
- **K-15**：`E_PROPOSAL_PREVIOUSLY_REJECTED` 具有双重角色：编译期由引擎输出至 `journal.verdicts`（编译日志码），施工期由派工门禁输出为 L3 运行时码，并登记入 `src/lib/error-codes.ts` 的 `ERROR_CODES`，映射 `SCOPE_VIOLATION`（不新增原因码）。同一码名的两种产出不改变 K-9 对其余编译日志码的约束；K-9 的例外条款以本条为准。该登记随 `TASK-J.18` 施工期实现，本条为规格决定，本 PR 未改代码。
- **K-16**：质疑归因账本 `attributions.trigger` 收紧为闭集 `"first_impression" | "user_dispute" | "acceptance_fail"`（删除 `| string`）；新增可选字段 `linked_reason_code`（类型 `ReasonCode`，即 `reasonCodeSchema` 的推断类型，只读引用，仅 `trigger === "acceptance_fail"` 的条目可带，见 `playtest-self-check.md` §5.2 与 SR-5）。读取旧台账时未知 trigger 映射为 `user_dispute` 并在 `resolution_note` 前缀 `[legacy-trigger:<原值>]`；写入拒绝未知值。不建 reason 映射表，两个码系保持正交。代码随 `TASK-J.16` 实施。

#### 5. 墓地匹配语义（单一语义源 G-MATCH）

墓地匹配在两处执行：编译期的合并引擎（[`scheme-patch-engine.md`](./scheme-patch-engine.md) §4.2）与施工期的 Worker 派工门禁（[`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §2.4）。**匹配语义只在本小节定义一次**；两份实施口径只能按编号引用，不得复述公式或常量值。代码只有一份实现（`src/lib/journey/graveyard-match.ts`），两处各写一个投影函数把各自的输入变成本小节定义的输入。

**G-MATCH-NL（自然语言通道）**：

- **NL-1** `matchNormalize`：`normalizeForAnchor` 之后，ASCII 转小写，删除全部空白与 `\p{P}\p{S}`。
- **NL-2** `lexemes`：汉字连续段取相邻二元组；长度为 1 的汉字段取单字；ASCII 字母数字词（长度 ≥ 2）整体作为一个元素；排序去重。
- **NL-3** `dice(A, B) = 2|A∩B| / (|A| + |B|)`；阈值 `GRAVEYARD_DICE_THRESHOLD = 0.75`，含等号。
- **NL-4** 命中 ⇔ 墓碑 `status === "active"` 且满足其一：(a) 目标 id 等于 `item_ref.id`（只在输入是方案条目时求值）；(b) `matchNormalize(文本) === fingerprint.key`；(c) `dice(lexemes(文本), fingerprint.lexemes) ≥ 阈值`；(d) 存在字素数 ≥ 4 的 `revival_keys` 元素被 `matchNormalize(文本)` 包含。
- **NL-5** 投影：引擎的输入文本是 op 主文本（引擎 §4.2 主文本表）；门禁的输入文本是 Worker 日志、完成摘要、提交信息、新增的文档行与注释行。

**G-MATCH-CODE（代码通道，仅门禁使用）**：

- **CODE-1** `artifact_keys(墓碑)`：从 `fingerprint.lexemes` 与 `revival_keys` 中取长度 ≥ 3 的 ASCII 字母数字词，去掉 `CODE_STOPLIST`，再按版本化的 `ALIAS_LEXICON` 展开，去重排序。
- **CODE-2** `code_tokens(文本)`：按非字母数字切分，驼峰与下划线再切分，转小写，同时保留完整模块说明符的小写原样。
- **CODE-3** 命中：依赖、安装命令、导入单元要求包名（或模块说明符末段、或 `@scope/name` 的 `name`）与某个 key 全等；路径与标识符单元要求某个 key 属于 `code_tokens`。代码通道不使用 Dice。
- **CODE-4** 证据强度：依赖、安装命令、导入为强证据；路径、标识符与全部自然语言单元为弱证据；同一墓碑同批同时被路径与标识符命中，升级为强证据。只有强证据命中 `disallow_revival === true` 的活跃墓碑才触发 INV-LEDGER-03 第 1 款的拦截。

**变更纪律**：改动任一条 → 先改本小节 → 再改共享夹具 `tests/fixtures/graveyard-match/cases.json`（版本号递增）→ 引擎与门禁两侧测试同时变红 → 再改实现。

---

## 15. 中栏《改动范围与验收方式》

### 15.1 为什么必须有这一块

合同是「护照」（`runtime-contract-and-safety.md` §1），必须锁定可写范围、验收命令和预算。旧版中栏从没把这些给用户看，「确认开工」那一刻才由规则临时推出合同；一旦推出的范围违反通配符分级，用户就在点完确认、右栏已锁之后收到 `403 E_WRITABLE_SCOPE_POLICY`。

本节的原则：**用户确认的范围，就是签进合同的范围，一字不差**。确认前就算好、就校验好、就给用户看；确认时只是把它冻结。

### 15.2 在中栏的位置

```text
① 标题与白话摘要
② 业务图表（由结构渲染）
③ 决议区（冲突卡 · AI 推荐待确认）
④《改动范围与验收方式》      ← 本节新增
⑤ 生成 Demo（条件浮现，可选）
⑥ 确认开工（唯一终态按钮）
```

### 15.3 范围预检 `ScopePlan`（确定性，零模型）

每次方案修订号变化后，Daemon 运行**范围预检**，生成与该修订绑定的 `ScopePlan`：

```ts
interface ScopePlan {
  scheme_revision: number;          // 绑定的方案修订；方案一变即作废重算
  plan_digest: string;              // 本对象的规范化摘要，写进冻结快照与合同

  areas: {                          // 会改动的地方（白话）
    id: string;
    label: string;                  // 「首页看板」「新的月度报表页」
    why: string;                    // 「因为要显示逾期项目数」→ 来自哪个模块
    module_ids: string[];
    kind: "change_existing" | "create_new";
    paths: string[];                // 背后的真实路径/模块级通配（默认折叠，不要求用户看懂）
    excluded_by_user: boolean;
  }[];

  never_touch: { label: string; paths: string[] }[];   // 这次不会碰（固定项 + 用户追加）

  needs_approval: {                 // 敏感项：要用户点头
    id: string;
    label: string;                  // 「项目依赖清单（package.json）」
    why: string;                    // 「新报表要用图表库，需要加一个依赖」
    paths: string[];
    approved: boolean | null;       // null = 还没表态
  }[];

  verification: {
    commands: VerificationCommand[];  // 真实命令（来自项目 scripts；无则为空）
    plain: string[];                  // 「代码能通过类型检查」「自动测试全部通过」
    manual_only: boolean;             // 项目没有任何自动检查 → 完成后靠你试玩确认
  };

  budget: {
    limits: BudgetLimits;             // 真实预算
    plain: string;                    // 「最多改动约 10 个文件，预计 20～30 分钟」
  };

  grade: { ok: boolean; rejected: { path: string; kind: string }[] };  // 通配符分级结果
}
```

**单一事实源**：范围预检与合同创建**调用同一个函数**（由 `SchemeDraftV2` 派生 `ScopePlan` + 通配符分级 `gradeWritableScope`）。签署时不再「重新推一遍」，而是**直接使用冻结快照里的 `ScopePlan`**。同样的输入必然得到同样的输出，因此确认后不可能出现与预检不同的 403。**禁止**以原始聊天文本为输入的 `buildL0Plan(chat)` 进入签署路径（[ADR-0018](../adr/0018-intent-to-executable-seal.md) INV-SEAL-01）；旧函数若保留，仅可作离线启发式展示，不得产出可签署 `plan_digest`。

**自动收敛**：预检先尝试把被分级拒绝的路径自动收敛（如把老项目的 `src/**` 收敛到模块级子目录或具体文件）。收敛后仍不合规的，才进入 `grade.rejected`，并在中栏用白话说明（§15.5）。

### 15.4 白话呈现（用户看到什么）

```text
┌ 改动范围与验收方式 ────────────────────────────────────────┐
│ 会改动的地方                                                 │
│  ● 首页看板 —— 要在这里显示本月逾期项目数        [不要改这里] │
│  ● 新建「月度报表」页面 —— 你要的报表放在这里                  │
│    展开看具体文件 ▸                                           │
│                                                              │
│ 这次不会碰                                                   │
│  密码与钥匙文件 · 账号与支付相关 · 数据库结构 · Stagent 自身   │
│  + 你说过的：「先别动登录页」                                  │
│                                                              │
│ 需要你点头（将随「确认开工」一次授权；可改选「不碰这些」）      │
│  ☐ 加一个图表依赖（会改动 package.json）—— 报表要画图          │
│                                                              │
│ 怎么算做完                                                   │
│  ✓ 首页能看到本月逾期项目数          （自动检查 + 你试玩时看） │
│  ✓ 报表页能按月份切换                （你试玩时看）           │
│  ✓ 代码能通过类型检查，自动测试全部通过（系统自动检查）        │
│                                                              │
│ 预计规模：最多改约 10 个文件，20～30 分钟                     │
└──────────────────────────────────────────────────────────────┘
```

- **会改动的地方**：每个区域一行白话 + 理由。路径默认折叠在「展开看具体文件」里，懂技术的用户可以看，但**不要求**任何人看懂。
- **用户能做的操作**：在某个区域上点「不要改这里」（→ `excluded_by_user = true`，相关模块在方案里标黄提示「这部分可能做不完整」）；在聊天里说「别动 X」（→ 编译器写入 `out_of_scope` → 预检把它并入 `never_touch`）。**不提供**手写 glob 的输入框。
- **需要你点头（对齐 SA-1）**：命中保护清单且**用户原话点名**的敏感项，列在本区供展开查看；**默认授权路径**是点主按钮「确认开工」（文案写明「含 N 处敏感改动」），一次授权全部列入项（见 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §5）。旁路「不碰这些，其余照做」把它们移入 `never_touch`。**禁止**把逐项「可以 / 不行」作为开工前的强制审讯主路径（旧 J.3 口径废止为日常入口）。
- **怎么算做完**：上半部分是方案里的白话验收条目（`acceptance`，来自编译器，用户可改），每条标明「自动检查」「你试玩时看」或两者；下半部分是机器检查的白话翻译。项目没有任何验证脚本时，显示「这个项目没有自动检查，完成后需要你试玩确认每一条」，施工步骤按 `MANUAL_REVIEW` 处理（承接架构 §6.4 D-5）。
- **预计规模**：把预算翻译成「文件数 + 时长」。**不出现** Token、tool calls 等技术单位。

#### 三层折叠结构与单向投影不变式
- **三层结构**：
  - 第一层 `intent_plain`（一眼看懂，默认展开）：会改动的地方、这次不会碰、需要你点头、怎么算做完、预计规模。
  - 第二层 `technical`（技术细节，默认折叠）：`paths`、`commands`、`limits` 原始值，默认折叠于「展开看具体文件 ▸」与「技术细节 ▸」，供有经验的用户或审计查验。
  - 第三层 `risk_block`（风险与例外，仅命中时显示）：`needs_approval` 命中项与 `grade.rejected` 白话说明，置顶于第一、二层之间，提供单项授权入口。
- **不变式（白话投影单向性）**：《改动范围与验收方式》的白话文案是 Daemon 投影产物，**不回写** `ScopePlan` 与合同；合同仍存 `paths`/`commands` 原文；白话翻译错误只影响展示，不改变 Gateway 实际拦截边界；投影可无状态重算（同快照输入必得同白话输出，措辞版本化字段 `plain_text_version`）。

### 15.5 门禁对齐：把范围纳入唯一确认谓词（D7）

唯一确认谓词扩展为 `evaluateSchemeConfirmation(draft, demo, scopePlan)`，在原有判断之外增加三个拒绝码：

| 码 | 触发条件 | 中栏怎么说 | 用户可做什么 |
| :--- | :--- | :--- | :--- |
| `E_SCOPE_NOT_READY` | 没有与当前 `scheme_revision` 绑定的 `ScopePlan`（还在算，或方案刚变） | 「正在核对要改哪些地方…」（通常 < 1 秒，按钮短暂转圈） | 等一下 |
| `E_SCOPE_POLICY` | `scopePlan.grade.ok === false`（自动收敛后仍有不合规范围） | 「『整个 src 目录』范围太大，我没法替你担保不误伤。请告诉我具体要改哪块，或把这部分拆成单独一轮。」 | 继续聊、排除该区域 |
| `E_SCOPE_APPROVAL_REQUIRED` | `needs_approval` 中有 `approved === null` 的项 | 「还有 1 处敏感改动会写在确认开工上」并滚动到该项 | 点「确认开工」一次授权，或「不碰这些，其余照做」（[`delivery-lifecycle.md`](./delivery-lifecycle.md) §5 SA-1） |

**签署链对齐（Daemon 侧）**：

1. 「确认开工」事务的 `VALIDATE_CONFIRMATION` 阶段同时校验 `scopePlan.scheme_revision === scheme_revision`，并**在 Daemon 上重跑一次预检**比对 `plan_digest`。不一致（例如用户在别处新建了 `package.json`，绿野判定变了）→ `E_SCOPE_PLAN_DRIFT`（409），事务在冻结前中止、右栏解锁，中栏显示「项目刚刚有变化，我重新核对了改动范围，请再看一眼」并展示新范围。
2. `FREEZE_SNAPSHOT` 把 `ScopePlan` 完整写进 `.stagent/drafts/schemes/{confirmation_id}.json`，快照摘要包含 `plan_digest`。
3. `SIGN_AND_PREPARE` 建合同时，`writable_paths` / `forbidden_paths` / `verification_spec` / `budget` **只能**从快照里的 `ScopePlan` 原样生成；传了 `confirmation_id` 的合同创建请求若与快照不一致 → `409 E_SCHEME_SNAPSHOT_MISMATCH`。Daemon 不再从意图文本重新推断范围。
> **架构定型**：本条「不得从意图文本重推范围」升格为 [ADR-0018](../adr/0018-intent-to-executable-seal.md)（`INV-SEAL-01～05`）；下游 PAB 见 [ADR-0019](../adr/0019-project-architecture-baseline.md)。
4. **不变量**：带 `confirmation_id` 的合同创建与批准，**不得**返回 `E_WRITABLE_SCOPE_POLICY`。若发生，按 D1 违约缺陷处理（以 Daemon 为准、记告警、补测试）。

> 第一部分「L1 与 L2 使用同一组拒绝码」的纪律在此显式化：`E_SCOPE_PLAN_DRIFT`、`E_SCHEME_SNAPSHOT_MISMATCH` 与既有的 `E_DEMO_NOT_CONFIRMED`、`E_SCHEME_SNAPSHOT_NOT_FOUND` 一样，属于**只有 Daemon 才能检出**的情形（前端看不到磁盘与快照），登记在 `runtime-contract-and-safety.md` §2.3「Daemon 专属码」中；其余码两层必须一致。

### 15.6 施工中的范围：收敛与扩权

- **收敛**：沿用 §4.2 / §8 R2，施工中把模块级通配收敛为实际写过的文件清单；试玩幕的「这次改了什么」以收敛后清单为准。
- **扩权**：Worker 需要改范围外的地方时，Gateway 照常拦截并暂停（§4.4）。中栏出现白话卡：

```text
施工需要多改一处
  要改：项目依赖清单（package.json）
  原因：报表需要图表库
  你的代码现在：在隔离区，主项目没有任何变化
  [允许这一处并继续]（推荐）  [不要，按原范围做]  [先停下]
```

  「允许这一处并继续」= 生成合同新修订（只增加这一处）→ 用户这一次点击即为批准 → 恢复施工。这仍是「新修订重签」（§5.4「扩权 = 新卡重签」不变），只是把重签压缩成一张卡上的一次点击。

---

## 16. 确认后的单页闭环旅程

### 16.1 四幕结构

中栏顶部常驻四步进度条：**① 方案 → ② 施工 → ③ 试玩 → ④ 已合入**。当前幕高亮；已过的幕可点开回看（只读）；未到的幕不可点。

| 幕 | 中栏主体 | 置顶 | 主按钮 |
| :--- | :--- | :--- | :--- |
| ① 方案 | 摘要 / 图或分层摘要 / 决议 / 改动范围与验收 / Demo（可选） | — | **确认开工** |
| ② 施工 | 步骤清单 + 「正在做」一句话 + 用时与规模；（多合同）同页项目地图条 | 已确认方案（折叠） | 暂停 · 放弃本轮 |
| ③ 试玩 | 真实界面（或无界面任务的结果说明）+ 验收清单 + 对照原型（若有） | 已确认方案（折叠） | 合入项目 |
| ④ 已合入 | 这次改了什么 + 检查结果 + 风险说明 | 已确认方案（折叠） | 基于这次继续 · 新建需求 |

### 16.2 状态权威：一张映射表管住五套状态

用户可见的只有一个量：`JourneyStage`（四幕 + 幕内子态）。它由 **Daemon 投影计算**，与 `presentation_state` 一起在 `STATE_CHANGED` 帧里广播；前端**只消费**该投影渲染，**禁止**自行用 `DeliveryState` / `lifecycle_state` / 合同字段 / 本地布尔拼出幕次或按钮可点态（违反即视为 L-10 级缺陷）。按钮灰亮、右栏锁态、进度条位置一律以投影为准。

| JourneyStage · 子态 | 交付主态 `DeliveryState` | 合同 `lifecycle_state` | 展示态 `presentation_state` | 右栏模式（§16.5） |
| :--- | :--- | :--- | :--- | :--- |
| 方案 · 聊天中 | `PLAN_DRAFTING` / `PLAN_READY` | 无合同（或 `DRAFT`） | `EXPLORING` | 方案对话 |
| 方案 · Demo 试看 | `PLAN_CONFIRMED` / `DEMO_READY` | 无合同（或 `DRAFT`） | `DEMO_PREVIEW` | 方案对话 |
| 方案 · 交接中 | （瞬态 `CONTRACT_SIGNING`） | `PENDING_APPROVAL` → `PREPARING` | `GRAPH_MAPPING` | 交接锁定（仅此处锁） |
| 施工 · 进行中 | `IMPLEMENTING` | `EXECUTING` | `EXECUTING` | 施工对话 |
| 施工 · 自动检查 | `VERIFYING` | `VERIFYING` | `VERIFYING` / `FAILED` | 施工对话 |
| 施工 · 返工 | `REWORK_REQUIRED` → `IMPLEMENTING` | `VERIFYING` → `EXECUTING` | `EXECUTING` | 施工对话 |
| 施工 · 等你决定 | `PAUSED` / `ESCALATED_HUMAN` | `PENDING_RESUME` / `PENDING_APPROVAL` | `PAUSED` / `NEEDS_APPROVAL` | 施工对话 |
| 施工 · 正在停止 | `IMPLEMENTING` | `EXECUTING`（`stopping_requested`） | `STOPPING` | 施工对话 |
| 试玩 · 体验中 | `CANDIDATE_VERIFIED` | `AUDITED` | `REAL_PLAYTEST` / `READY_TO_MERGE` | 试玩对话 |
| 试玩 · 自查中 | `CANDIDATE_VERIFIED` | `AUDITED` | `DISPUTED_INSPECTING` | 试玩对话 |
| 试玩 · 项目有新改动 | `CANDIDATE_VERIFIED` | `AUDITED` | `CONFLICT` | 试玩对话 |
| 已合入 | `MERGED` | `MERGED` | `MERGED` | 已合入（可继续） |
| 已放弃 | `ABORTED` | `ABORTED`（或无合同） | `ABORTED` | 已放弃（可新建） |

规则：

- 表中未列的组合 = 投影缺陷，Daemon 记告警并按最近的安全子态（「施工 · 等你决定」）呈现，**禁止**前端猜测。
- `DELIVERED` 不出现在本表（ADR-0012）；归档成功只在「已合入」幕显示一个「已归档」小标记。

### 16.3 点击「确认开工」：交接（Handoff）与项目整理等待态

用户点下「确认开工」后，按钮原地变为人话进度，五阶段事务（§7 D3）在背后执行：

```text
正在准备开工
  ✓ 保存你确认的方案          （CLAIM_AND_QUIESCE + VALIDATE + FREEZE_SNAPSHOT · ADR-0018）
  ● 准备隔离的施工区          （tiny / 单合同：SIGN_AND_PREPARE）
  ○ 安排施工步骤              （建任务图）
```

- 这几秒内右栏输入框禁用，并显示「正在交接，几秒后可以继续聊」（这就是 D3 的 `CLAIM_AND_QUIESCE`）。
- **tiny / 已有下一份可签合同桩**：成功则进度条切到「② 施工」，中栏出现交接卡：「开工了。一共 6 步，预计 20～30 分钟。你可以离开，做完或需要你的时候我会提醒你。」右栏给**短回执**（非系统插话剧本），并**解锁**进入施工对话（D9）。
- **standard / large（需 PAB 与/或 ProjectPlan）**：冻结成功后**不制造第二套导航**；中栏同页进入整理等待态，主文案「**正在整理项目地图…**」，可显示白话子步（「在画整仓结构」「在拆成几份可验收的小任务」）。完成后在**同一方案工作台**嵌「项目地图」条（见 [`project-decomposition.md`](./project-decomposition.md) §7）：高亮「下一份」+「确认开工」。用户对每一份合同再点一次「确认开工」、试玩后点一次「合入」。
- **失败**：回到「① 方案」，方案原样保留、右栏解锁，中栏顶部**白话**说明失败原因与下一步（例如：「项目刚刚有变化，我重新核对了改动范围，请再看一眼」）；`E_*` 仅进技术细节。补偿失败（`E_COMPENSATION_FAILED`）是唯一保持锁定的情形，显示「这次准备没清理干净，需要你手动处理」与诊断入口。

### 16.4 施工幕

```text
② 施工 · 第 3 / 6 步 · 已用 9 分钟（预计 20～30 分钟）     [暂停] [放弃本轮]
  正在做：给首页看板加「本月逾期」统计卡
  ✓ 准备数据结构
  ✓ 首页看板：逾期统计
  ● 新建月度报表页面
  ○ 报表按月份切换
  ○ 补自动测试
  ○ 整体自动检查
  技术细节 ▸（改了哪些文件、检查日志——默认折叠）
```

- **步骤用白话**：任务图节点的标题从方案模块与验收条目生成（「新建月度报表页面」），**不**用文件名或技术任务名。
- **节点状态五种白话**：待做 / 进行中 / 已完成 / 需要重做 / 等你确认。点亮规则不变：只认物理证据（写入成功 + 验证退出码 0 + 节点指纹，架构 §3.2.2）。
- **自动推进**：步骤由编排器自动按拓扑序推进。**不要求**用户逐个点「开工 / 核销」；这两个按钮只保留在「技术细节」里，作为故障恢复入口。
- **等你确认**：`MANUAL_REVIEW` 节点以卡片出现：「请你确认：报表页的标题文案是否合适？[合适] [我想改]」。
- **用时与规模**：只显示用时与预计时长；接近预算（80%）时提前一句提醒「快到预计时长了，目前还剩 2 步」，而不是到点直接暂停。
- **机器失败 ≠ 用户警报**：自动重试期内的失败不渲染红色警报——节点显示「这一步遇到问题了，正在换个方法再试（第 N/M 次）」中性样式；仅当重试耗尽（`VERIFICATION_RETRY_EXHAUSTED`）才升级为 §16.6 意外卡；`FAILED` 红色高亮只在「等你决定」语境出现。

### 16.5 施工中右栏怎么交流（核心修复）

**右栏不再在确认后永久锁定**（**D9 胜于** §7 D3 旧「第 5 阶段成功 → 右栏保持锁定 / 静默丢弃」）。冻结的是方案快照，不是对话。解锁后用户输入**禁止静默丢弃**；由 Supervisor 分流成四类，效果以**中栏卡片**呈现并需用户一次点击；右栏只给短回执（「已记到中栏，请看那张卡」），**不**在右栏展开长篇系统剧本。**没有任何一条消息会静默改变施工**：

| 用户说的话属于 | 例子 | Supervisor 怎么处理 | 用户看到 |
| :--- | :--- | :--- | :--- |
| **A. 问进度 / 求解释** | 「现在做到哪了？」「为什么要改 package.json？」 | AI 搭档只读查看任务图、证据与范围后回答 | 右栏直接回答，无卡片 |
| **B. 范围内的补充** | 「报表标题用蓝色」 | 判定：不新增模块、不扩范围、不改验收条目 → 生成「补充说明」 | 中栏卡：「把这条加进本轮施工？ [加入本轮] [下一轮再说]」 |
| **C. 改需求 / 扩范围** | 「再加一个导出 Excel」 | 判定：新增模块、扩范围或改验收 → 默认记到下一轮 | 中栏卡：「这超出了本轮确认的方案。 [记到下一轮]（推荐） [暂停，现在改方案]」 |
| **D. 停下 / 不要了** | 「先停一下」「算了不做了」 | 映射到暂停 / 放弃 | 中栏卡：「要暂停施工吗？[暂停] [继续]」或「放弃本轮？改动会被丢弃 [放弃] [继续施工]」 |

- **加入本轮（B）**：补充说明带 `change_request_id` 追加给 Worker 作为施工指引。Daemon 必须核验它落在原合同范围与命令的**确定性子集**内（同架构 §6.5.3 的子集检查）；不满足则自动改走 C。补充说明列在「已确认方案」折叠卡下方的「施工中补充」小节，冻结快照本身不变。
- **记到下一轮（C 默认）**：写入「下一轮草稿」。合入后点「基于这次继续」时，它们会作为新方案的初始内容出现。
- **暂停，现在改方案（C 可选）**：施工暂停 → 合同生成新修订 → 中栏回到「① 方案」幕，以**差异高亮**显示新旧方案（新增的标绿、删掉的划线）→ 用户再点「确认开工」→ 新修订重签后继续施工（未受影响的已完成步骤保持完成）。
- **分不清时问一句**：分流置信度不够时，AI 搭档用一句话确认，例如「你是想这一轮就改，还是做完这一轮再说？」——问业务问题，不问技术分类。
- **不变式 C-1（低置信度分流保守默认）**：分流置信度不足时，默认按 A 类（纯询问）处理——AI 搭档只回答、不动工——并在该条回复消息下方挂一行轻量入口「如果你是想改方案，点这里」；宁可漏判为聊天，不可误判为变更。此条与既有「分不清时问一句」并存：问业务澄清是优选路径，沉默默认是兜底。
- **试玩幕**同样适用 A～D；另增「这里不对」类（§16.7）。

### 16.6 意外与暂停：三段式白话卡

所有暂停、熔断、失败，中栏统一用一张卡呈现，固定三段 + 最多三个按钮（其中一个标「推荐」）：

```text
【发生了什么】  自动检查连续 3 次没通过：报表页的月份切换测试失败
【你的代码现在】在隔离区，主项目没有任何变化
【你可以】      [让它换个思路再试一次]（推荐）  [告诉它怎么改]  [放弃本轮]
```

| 情形 | 推荐动作的白话 |
| :--- | :--- |
| 接近预算 | 「再给 15 分钟」（默认增量；显示累计用时，若已知价格也显示大约花费） |
| 超出范围 | 见 §15.6 |
| 检查反复失败 | 「换个思路再试一次」；「告诉它怎么改」= 聚焦右栏输入框，用户的话按 B 类处理 |
| 外部改了代码 | 「把你的改动一起带上，重新检查」 |
| Worker 失联 | 「重新接上继续」 |
| 碰了你否决过的方案（`E_PROPOSAL_PREVIOUSLY_REJECTED`） | 「让它换个思路再试一次」；「我改主意了」= 回到方案幕、右栏预填但不自动发送，由你亲口重提后重签；安全门禁否决的不提供该按钮。见 [`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §5 |

**禁止**出现 Token 数、tool calls、退出码、原因码原文（可放进「技术细节」折叠区）。

### 16.7 试玩幕：验收是一次对话，不是一场裁决

施工全部完成且自动检查通过（`AUDITED`）后，Daemon 自动拉起真实预览，进度条切到「③ 试玩」。

```text
③ 试玩                                                    [合入项目]
  ┌ 真实界面（独立 Origin 预览）─────────────────┐  对照原型 ◐
  │                                             │
  └─────────────────────────────────────────────┘
  验收清单
   ☑ 代码通过类型检查，自动测试全部通过（系统已检查）
   ☐ 首页能看到本月逾期项目数            [没问题] [这里不对]
   ☐ 报表页能按月份切换                  [没问题] [这里不对]
  这次改了什么 ▸   风险说明：本轮没有可点击原型，以真实界面为准
```

- **没有界面的任务**：主体换成「结果说明」——这次做了什么、自动检查证明了什么、怎么手动试一下（白话步骤）。
- **对照原型**：若本轮生成过 Demo，可在真实界面与原型之间切换对照。
- **「这里不对」**：在验收条目上点，或在右栏直接说。Supervisor 做三方比对（原话 / 冻结方案 / 实际改动），但**以对话回应，不以判决呈现**：
  - 方案里写了、施工没做到 →「方案里写了『按月份切换』，是施工漏了。我安排返工，不另算。」→ 自动返工，相关步骤回到「需要重做」，进度条回到「② 施工」。
  - 方案里没有 →「这一条方案里没提到。要加进这一轮，还是下一轮再做？」→ 按 §16.5 的 B / C 处理。
  - 拿不准 → 问用户**一个业务问题**澄清（「你说的『不对』是数字不对，还是位置不对？」），拿到答案后再按上两种处理。
  - 这取代架构 §6.5.2「`confidence < 0.7` 时由用户手动点选『按缺陷修复 / 按新需求演进』」：低置信度时系统问业务问题，**不**把技术分类推给用户。置信度与三方事实仍落盘在自查报告里，供审计。
- **质询台呈现规格（少点、有推荐）**：
  - 三方比对以**三栏并排**呈现（非上下堆叠）：左栏「你当时说的」（`evidence` 高亮原文）、中栏「确认的方案里记的」（冻结快照条目）、右栏「代码实际做的」（Daemon 生成的白话 Diff 摘要，不展示原始代码）。
  - **Supervisor 代判 + 推荐**：高置信度时系统自动归因并说明（D10），用户默认零点击；低置信度时先问**一个**业务澄清问题。两按钮【这是 Bug，免费修】 / 【我想要新功能，下一轮做】保留为逃生口，其中一路标「推荐」；按钮上方可注「我不确定是谁的问题」。**禁止**把内部工程归因甩成默认主流程审讯。
  - 明确禁止 UI 出现「按缺陷修复」「按新需求演进」「confidence」「判定 A/B」等技术术语。
- **实施口径**：三方比对的逐字段责任边界、白话 Diff 摘要的确定性管线、验收清单点亮规则、归因状态机（含低置信度保守默认 C-1′）与 K-14 归因回填算法，见 [`playtest-self-check.md`](./playtest-self-check.md)。
- **合入按钮的条件**：客观证据全绿（Gate 2 不变）**且**验收清单中每个「你试玩时看」的条目都已点「没问题」。用户也可以点「其余我不逐条看了，直接合入」——这会在合入摘要里如实记为「部分条目未逐条确认」。

### 16.8 合入与之后

- **合入前摘要**（点「合入项目」后的确认层）：改了哪些地方（白话区域）、检查结果、风险说明（如 `NO_INTERACTIVE_DEMO`、未逐条确认的条目）。按钮「确认合入」。
- **项目有新改动**（目标分支前进，`CONFLICT`）：系统先自动「把项目的新改动合进来再检查一遍」一次；仍冲突才出卡请用户决定（沿用架构 §6.4 D-1 的三次上限；计数口径：仅计用户手动触发的重试，系统首次自动重试不计入（C-5 已拍板））。
- **已合入幕**：显示「已合入」+ 这次改了什么 + 检查结果，两个按钮：
  - **交付仪式卡**：合入成功后中栏展示「已交付」卡——白话改动摘要（来自收敛后清单）、用时、「再来一个需求」入口；这是「工程 MERGED」翻译成「用户拿到东西」的时刻，不得只显示冷冰冰的状态标签。
  - **基于这次继续**：开新一轮。新方案以本轮冻结方案为背景、以「下一轮草稿」（§16.5 C 类）为初始内容；右栏带着对话滚动摘要继续——**上下文不丢**。
  - **新建需求**：全新一轮，从空方案开始。
- **合入后发现问题**：仍然是开新一轮（`MERGED` 是终态，ADR-0012）。「基于这次继续」就是这条路的入口；用户不需要理解「微合同」这个词。

### 16.9 放弃本轮

任何一幕都可以「放弃本轮」。二次确认文案：「放弃后，这一轮在隔离区的改动会被清理，主项目不受影响。」若历史日志显示执行过有外部副作用的命令，按架构 §0.2.4 A6 如实列出。放弃后进度条显示「已放弃」，提供「重新开始这个需求」（以本轮方案为初始内容）与「新建需求」。

### 16.10 用户离开时的提醒

用户把窗口放到后台时，下列事件触发浏览器通知与标签页标题角标；其余事件不打扰：

- 需要你确认（`MANUAL_REVIEW`）、暂停等你决定、需要扩范围；
- 施工完成，可以试玩；
- 本轮失败或被放弃。

### 16.11 小改动：单页里的 Fast Path

小改动不再「从聊天里毫秒级静默开工」（覆盖架构 §0.2.3.1「无需用户手动点击确认开工」）。编译器判定 `size_hint = "tiny"` 且范围预检满足 Fast Path 准则（单文件、视觉/文案白名单、无命令、无依赖、未命中保护清单）时，中栏方案收缩为一张精简卡：

```text
小改动
  把首页标题改成蓝色 · 只改 1 个文件（首页样式）· 做完可一键撤销
  [直接改]   [按完整流程来]
```

- 「直接改」就是这一轮的「确认开工」：同样冻结快照、同样签合同（`approved_by: "system:fast-path"` 改为记录用户这一次点击），跳过 Demo 与多步任务图，施工幕只有一步。
- **PROTECTED 模式下也可用**：仍在 Worktree 中施工，完成后进入试玩幕，合入仍需用户点击。VIBE 模式下仅免 Worktree 类非生产产物可按架构 §5.2.2 的 Checkpoint 直改（见下条）。这样 Fast Path 不再因默认 PROTECTED 而永远走不到。
- **免 Worktree 边界（C-3 裁决，已拍板）**：免 Worktree 仅限**非生产产物**：Demo 展示代码、图标/素材、`.stagent/` 内方案文档。凡会进入可执行工程的**生产代码**（`src/`、`daemon/`、工具链产物）必须走 Worktree，不论 PROTECTED 或 VIBE。本条准则沿用上文的视觉/文案白名单；原文未列路径，以下为最低清单（待实施期细化）：`docs/**`、`*.md`、`demos/**` 下的素材文件、`.stagent/**` 内方案文档。Demo 展示代码的具体路径口径待实施期细化。
- 越界熔断规则不变（架构 §0.2.3.1 第 3 条）：施工中一旦需要第二个文件，按 §15.6 出卡，升级为标准流程。

---

## 17. 决策 D6–D10（钉死）

| # | 决策 | 覆盖 / 关系 |
| :--- | :--- | :--- |
| **D6** | 方案由大模型意图编译器以**增量补丁**产出；模型只出结构、代码出图；只有用户原话能成为「已确认」。关键词启发式降为离线兜底。`demoReady` 的模块条件改为「≥ 1 个有界面的模块」 | 取代第一部分 §2.2「现行实现口径」；修改 §7 D5 的模块数条件，D5 其余条款不变 |
| **D7** | 中栏必须展示《改动范围与验收方式》；唯一确认谓词纳入 `ScopePlan`；合同范围只能从冻结快照里的 `ScopePlan` 原样生成；带 `confirmation_id` 的签署链不得出现 `E_WRITABLE_SCOPE_POLICY` | 扩展 §7 D1、D4；修订第一部分 §3.2 信息流 |
| **D8** | 用户可见状态只有 `JourneyStage`（四幕），由 Daemon 按 §16.2 映射表投影并广播；前端不得自行组合底层状态 | 补全第一部分 §5.1「三轨解耦」缺失的映射；取代架构 §7.1 四视口自动切换 |
| **D9** | 右栏只在交接几秒内锁定；解锁后消息**禁静默丢弃**，按 A～D 四类分流；影响施工的效果必须以中栏卡片呈现并经用户一次点击；右栏仅短回执 | **胜于** §7 D3 旧「第 5 阶段成功 → 右栏保持锁定 / 静默丢弃」 |
| **D10** | 验收以对话进行：「这里不对」由 Supervisor 以对话回应；低置信度时问业务问题，不把「缺陷 / 新需求」分类推给用户。小改动以「直接改」一次点击开工，不得静默开工 | 修订架构 §6.5.2 低置信度出口、§0.2.3.1 自动准入 |

---

## 18. 验收矩阵增补（v2.1 · 全部 `⏳`）

**图例同 §9**。本节各行在接线并有测试前，按 §10 不得标 COMPLETED。测试文件为规划名称，立卡时可调整，但须在本表同步。

| ID | 断言 | 计划测试 | 状态 |
| :--- | :--- | :--- | :--- |
| V-01 | 编译补丁 `evidence` 指向 AI 回复时，该 op 被丢弃 | `tests/unit/scheme-patch-merge.test.ts` | ⏳ |
| V-02 | 补丁要改 `user_pinned` 条目时，转为覆盖建议卡，原值不变 | 同上 | ⏳ |
| V-03 | `base_revision` 落后时不直接合并，触发一次重编译 | 同上 | ⏳ |
| V-04 | 方案冻结后补丁一律丢弃 | 同上 | ⏳ |
| V-05 | 空闲计时与 AI 回复完毕都不触发编译模型调用（调用计数为 0） | `tests/unit/intent-compiler-trigger.test.ts` | ⏳ |
| V-06 | 无模型钥匙时走离线兜底，中栏出现「方案助手未连接」提示 | `tests/ui/intent-compiler-offline.test.tsx` | ⏳ |
| V-07 | 三张图由 `renderSchemeDiagrams` 从结构渲染，与模块/流程一一对应 | `tests/unit/scheme-diagrams.test.ts` | ⏳ |
| V-08 | 金标对话集：模块召回 ≥ 80%，凭空捏造 = 0 | `tests/eval/intent-compiler-golden.test.ts` | ⏳ |
| V-09 | 单个有界面模块 + 主流程 + 无冲突 + 有业务输入 → `demoReady = true` | `tests/unit/scheme-confirmation-gate.test.ts` | ⏳ |
| V-10 | `INV-LEDGER-01`：`quote` 只容忍排版噪声（CRLF、空白、零宽、NFKC），释义、大小写、标点变化一律丢弃该 op；多次出现默认锚定最后一处 | `tests/unit/evidence-anchor.test.ts` + `tests/unit/scheme-patch-merge.test.ts`（`TASK-J.9`） | ⏳ |
| V-11 | `INV-LEDGER-02`：`ai_inferred` 只能经带本批用户原话、晚于条目出现、非否定非问句的 `mark_user_confirmed` 升级 | `tests/unit/scheme-patch-merge.test.ts`（`TASK-J.9`） | ⏳ |
| V-12 | `INV-LEDGER-03`：命中活跃墓碑的 AI op 被拦截；仅本批、晚于否决、含复活关键词、肯定且非问句的用户原话可复活；拿不准转追问卡 | `tests/unit/graveyard-revival.test.ts`（`TASK-J.9`） | ⏳ |
| V-13 | 冻结 → 结构 → 修订号 → 溯源 → 来源 → 墓地 → 钉选的优先级；墓地命中的内容不出覆盖建议卡 | `tests/unit/scheme-patch-precedence.test.ts`（`TASK-J.9`） | ⏳ |
| S2-01 | `ScopePlan` 修订号与方案不一致 → `E_SCOPE_NOT_READY` | `tests/unit/scheme-confirmation-gate.test.ts`（`TASK-J.3`） | ⏳ |
| S2-02 | 分级拒绝的范围先自动收敛；仍不合规 → `E_SCOPE_POLICY` 且有白话说明 | `tests/unit/scope-plan.test.ts`（收敛，`TASK-J.2`）+ `tests/unit/scheme-confirmation-gate.test.ts`（谓词，`TASK-J.3`） | ⏳ |
| S2-03 | 有未表态的敏感项 → `E_SCOPE_APPROVAL_REQUIRED` | `tests/unit/scheme-confirmation-gate.test.ts`（`TASK-J.3`） | ⏳ |
| S2-04 | 预检与合同创建对同一输入产生相同 `plan_digest` | `tests/unit/scope-plan.test.ts`（`TASK-J.2`） | ⏳ |
| S2-05 | 冻结后项目变为非绿野 → `E_SCOPE_PLAN_DRIFT`（409），冻结前中止、右栏解锁 | `tests/integration/scheme-confirm-scope-drift.test.ts` | ⏳ |
| S2-06 | 带 `confirmation_id` 的合同范围与快照不一致 → `409 E_SCHEME_SNAPSHOT_MISMATCH` | 同上 | ⏳ |
| S2-07 | 带 `confirmation_id` 的签署链从不返回 `E_WRITABLE_SCOPE_POLICY`（覆盖老项目、绿野、非 npm 三类夹具） | 同上 | ⏳ |
| S2-08 | 中栏《改动范围与验收方式》渲染区域、不会碰、敏感项、验收、规模五块；无 Token 等技术单位 | `tests/ui/scope-acceptance-block.test.tsx` | ⏳ |
| J-01 | `JourneyStage` 投影覆盖 §16.2 全部行；未列组合记告警并呈现「等你决定」 | `tests/unit/journey-stage-projection.test.ts` | ⏳ |
| J-02 | 交接成功后右栏解锁进入施工对话；仅补偿失败保持锁定 | `tests/ui/journey-handoff.test.tsx` | ⏳ |
| J-03 | 施工中 B 类消息生成「加入本轮」卡；超出确定性子集时自动改走 C 类 | `tests/unit/construction-message-routing.test.ts` | ⏳ |
| J-04 | 施工中任何消息在用户点击前都不改变合同、任务图与 Worker 指引 | 同上 | ⏳ |
| J-05 | 「暂停，现在改方案」→ 回到方案幕并差异高亮 → 重签后已完成步骤保持完成 | `tests/integration/construction-amend-scheme.test.ts` | ⏳ |
| J-06 | 施工步骤自动推进，无需用户逐节点点「开工 / 核销」 | `tests/integration/construction-auto-advance.test.ts` | ⏳ |
| J-07 | 意外卡固定三段、最多三个按钮、恰有一个「推荐」，不含原因码原文 | `tests/ui/journey-incident-card.test.tsx` | ⏳ |
| J-08 | 「这里不对」低置信度时提出业务澄清问题，不出现「按缺陷 / 按新需求」按钮 | `tests/unit/playtest-dispute-dialog.test.ts` | ⏳ |
| J-09 | 合入按钮需证据全绿且试玩条目全部确认（或显式「直接合入」并记入摘要） | `tests/ui/journey-merge-gate.test.tsx` | ⏳ |
| J-10 | 「基于这次继续」新方案带入下一轮草稿与对话摘要 | `tests/ui/journey-continue.test.tsx` | ⏳ |
| J-11 | `size_hint = tiny` 且满足准则时出现「直接改」卡；聊天本身不会静默开工；PROTECTED 下可用 | `tests/integration/fast-path-single-page.test.ts` | ⏳ |
| P-01 | 方案工作台里右栏搭档以只读工具集运行；尝试写文件或 shell 被拒 | `tests/integration/partner-readonly.test.ts` | ⏳ |
| V-14 | 点击中栏条目滚动并高亮对应右栏原话；无 evidence 条目不显示溯源入口 | `tests/ui/scheme-evidence-deep-link.test.tsx` | ⏳ |
| S2-09 | 白话层为单向投影：改白话文案不改变合同范围与 `plan_digest` | `tests/unit/contract-sheet-projection.test.ts` | ⏳ |
| J-12 | 质询台三栏并排渲染 + 双白话按钮；低置信度不替用户裁决且界面无技术分类字样 | `tests/ui/dispute-triad-pane.test.tsx` | ⏳ |
| J-13 | 自动重试期内节点不渲染红色失败态；重试耗尽才出现意外卡 | `tests/ui/construction-retry-presentation.test.tsx` | ⏳ |
| J-14 | MERGED 后展示白话交付卡（改动摘要+用时+继续入口），非仅状态标签 | `tests/ui/delivery-complete-card.test.tsx` | ⏳ |
| J-15 | 低置信度分流默认按 A 类处理，不产生任何施工副作用 | `tests/unit/construction-message-routing.test.ts` | ⏳ |

**统计**：本节 39 条，`✅ 0` / `⏳ 39`。

---

## 19. 实现落差登记（当前代码 vs 本规格）

> 2026-10-27 对照代码核查。每一条都是后续立卡的依据；**不得**因本部分已定稿就把下列能力当作已交付。

| # | 落差 | 当前代码事实 | 本规格要求 |
| :--- | :--- | :--- | :--- |
| L-01 | 方案靠关键词正则 | `src/lib/journey/scheme-draft.ts` 的 `MODULE_HINTS`（6 条正则）、`detectConflicts`（写死的冲突选项） | §14 意图编译器；正则降为兜底 |
| L-02 | 右栏搭档可能有写能力 | `daemon/server.ts::defaultChatAdapters` 首选 `ClaudeCodeAdapter`，未声明只读工具集 | §13.2 只读硬约束；做不到只读的适配器不进方案工作台 |
| L-03 | 合同范围在确认时才临时推断 | `src/routes/index.tsx::handleConfirmScheme` 在事务前用 `formatSchemeAsIntent` → `submitJourneyMessage` 生成合同，范围从未展示给用户 | §15 预检 + 快照绑定 |
| L-04 | 确认谓词不含范围 | `evaluateSchemeConfirmation(draft, demo)` | `evaluateSchemeConfirmation(draft, demo, scopePlan)` |
| L-05 | 右栏确认后永久锁定 | `setSchemeChatLocked(true)`，仅「新建需求」解锁 | §16.5 分流 |
| L-06 | 施工节点需手动开工 / 核销 | `TASK-C.10o` 把 `POST /api/graph/nodes/start` 与 `/api/graph/verify` 接到界面按钮 | §16.4 自动推进 |
| L-07 | `demoReady` 要求 ≥ 2 个模块 | `computeDemoReady` | §14.10 |
| L-08 | `DELIVERED` 仍在交付主态枚举里 | `src/lib/state/delivery-state.ts::DELIVERY_STATES` 含 `DELIVERED` | ADR-0012：不作为状态呈现（§16.2） |
| L-09 | 没有用户主动暂停接口 | 合同路由只有 `resume` / `abort`，无 `pause` | §16.4「暂停」按钮需要 `POST /api/contracts/:id/pause` |
| L-10 | 没有 `JourneyStage` 投影 | 前端在 `index.tsx` 中自行组合合同、图谱与预览状态 | §16.2 由 Daemon 投影广播 |

---

## 20. 给研发的施工顺序

按依赖排序，每一步都能独立交付、独立验收（顺序与 `development-tasks.md` 施工 DAG 对齐）：

1. **右栏只读**（P-01、J-02；`TASK-J.1`，P0 安全缺口）：无前置依赖，可立即开工，先于其余主链。
2. **范围预检与门禁对齐**（S2-01～S2-08；`TASK-J.2` → `J.3 ∥ J.4` → `J.5`）：消灭确认后 403，这是当前最伤信任的缺陷。
3. **中栏范围区块与交接解锁**（`TASK-J.6 ∥ J.7`；J.7 硬依赖 J.1）。
4. **`JourneyStage` 投影与四幕骨架**（J-01；`TASK-J.8`）：任意时刻可与上列并行，后续每一幕都依赖它。
5. **意图编译器**（V-01～V-09）：补丁协议与合并规则先行（可用桩模型测试），再接真模型与金标集。
6. **施工对话分流与意外卡**（J-03～J-07、L-09）。
7. **试玩对话式验收与合入**（J-08～J-10）。
8. **单页 Fast Path**（J-11）。

*第三部分结束。冲突时以 §17 决策为准；实现以任务卡、§18 矩阵与 git tip 为准。*
