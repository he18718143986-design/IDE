# ADR-0018: 意图→可签执行物唯一真相缝（Intent-to-Executable Seal）

> **状态**: PROPOSED（随本 PR 合入生效；合入 `main` 后升格 ACCEPTED）
> **日期**: 2026-10-31（Asia/Hong_Kong）
> **决策依据**: 通读 `docs/` 后的强制单选结论；方案 A 双保险闭环（本 ADR 为绝对唯一榜首，PAB 顺延 ADR-0019）；上游意图见 [`../scheme.md`](../scheme.md) goal-1、goal-7～goal-10（`q1`、`q17`～`q21`）；审计依据见 [`../reports/delivery-path-audit.md`](../reports/delivery-path-audit.md) §0 / §2「方案条目 → 合同」断链；上位机制见 [`../specs/supervisor.md`](../specs/supervisor.md) §14～§15、[`../specs/delivery-lifecycle.md`](../specs/delivery-lifecycle.md) §3 / §6。
> **相关**: ADR-0005（确定性验证）、ADR-0007 / ADR-0014（分权与两次点击）、ADR-0010（Demo 可选）、ADR-0015（合同为最小交付单元）、ADR-0016（知识库）、ADR-0019（项目架构基线，密封之后）
> **编号说明**: 0018 原 PR 草案曾承载 PAB；方案 A 更正为本 ADR。PAB 迁至 ADR-0019。

---

## 0. 一句话

**用户确认方案 / 开工那一刻，唯一合法进入合同与 Worker 的输入，是冻结后的「双面方案产物」；原始聊天只作证据，不得再被用来临时推断写范围。** 这条缝一旦开着旁路，整套从模糊需求到可交付软件的体系要么瘫痪，要么沦为「证据齐全地交付错软件」的精致玩具——且无法靠普通模型按任务卡施工修补。

流水线自洽（方案 A）：

```text
用户确认方案
  → [ADR-0018 真相缝] 冻结 MachineFace（禁聊天直推 ScopePlan）
  → [ADR-0019 PAB] 全系统管网基线（standard/large）
  → [ADR-0015 ProjectPlan] 拆合同
  → Worker 施工
```

---

## 1. 背景与问题陈述

### 1.1 文档体系已写清、代码仍开着的致命旁路

文档分层（[`../README.md`](../README.md)）把「模糊意图 → 可交付软件」收成 L0→L5。现行规格对意图编译（`SchemeDraftV2` / `SchemePatch` / INV-LEDGER-01～04）与范围预检（`ScopePlan`）写得很深：

| 层 | 权威 | 现状 |
| :--- | :--- | :--- |
| 对话摄取 | delivery-lifecycle S1；sessions 落 `.stagent/sessions/` | 会话有落点；**无 ADR 锁定「确认后必须保留什么」** |
| 方案编译 | supervisor §14；intent-compiler-prompt；scheme-patch-engine | 规格完备；实现仍是 `MODULE_HINTS` 正则启发式 |
| 范围预检 | supervisor §15；J.2～J.6 | 规格要求「确认的范围 = 签进合同的范围」 |
| 合同生成 | runtime-contract；delivery-lifecycle §3 / §6 | **代码事实：`ScopePlan` / `plan_digest` 全库 0 命中；合同范围由 `buildL0Plan` 从聊天文本推出，方案模块不进入合同**（delivery-path-audit §2） |

结果：用户在中栏审阅的「方案」，与 Daemon 真正签进合同、交给 Worker 的「写范围」，可以是两套东西。追踪链在「方案条目 → 合同」处断开。证据轨（ADR-0005）只会诚实地证明「错的东西被正确做成了」。

### 1.2 为什么这是「脑力瓶颈」而不是普通缺口

本仓已有五类高影响缺口（测试义务、项目分解、知识库、发布、真实预览）。其中：

- 分解 / 知识库 / 发布已有 ADR-0015～0017 + L 系列卡，**普通模型可以按卡落地**；
- 项目架构基线（现 ADR-0019）是大中型拆单支柱，**但默认「方案已老实进入分解器」**——旁路不关，PAB 只会给虚假意图做精密施工；
- 测试义务 / 真实预览是确定性门禁与接线，**不是「理解」问题**。

唯有「把散落聊天编译成可签执行物」这一步：

1. **必须用模型做语义理解**（正则启发式注定玩具化，见 scheme.md gap-3）；
2. **理解的结果会变成整条确定性机器的唯一真相**（ScopePlan → 合同 → Worker → Evidence → Merge）；
3. **旁路一旦存在，再完美的下游门禁只会加固错误**；
4. **普通模型按 J.2 / J.10「务实落地」时，最容易保留「聊天直推范围」作兜底**——这正是必须用 ADR 现在钉死的架构罪行。

### 1.3 用户侧真实诉求

非技术用户路径要求：右栏自由聊 → 中栏出现可审阅方案（图表 / 决议 / 可选 Demo）→ 「确认方案/开工」冻结 → Worker 按机器指令施工。确认时需要同时留下：

1. **原始聊天记录**（证据，可溯源）；
2. **给用户看的最终方案面**（白话摘要、图、决议、可选 Demo）；
3. **给专业施工面的结构化绑定**（`scheme_item_ids` / `acceptance_refs` / `ScopePlan` / 其后 DesignNote / PAB 输入）。

过程性编译日志、中间补丁 journal、未采纳的启发式草稿，可以删。现行文档分散写了 sessions、drafts、ScopePlan，**没有一篇 ADR 把「确认瞬间的双面冻结 + 保留清单 + 禁旁路」钉成不可逆决策**。

---

## 2. 决策

### 2.1 唯一真相缝（强制不变量）

记为 **INV-SEAL-01～05**，Daemon 必须可机械执行；违反任一条即视为架构违约，不得以「过渡期兜底」放行。

| ID | 不变量 | 可执行判定 |
| :--- | :--- | :--- |
| **INV-SEAL-01** | **禁聊天直推合同范围** | 带 `confirmation_id` 的合同创建路径，`writable_paths` / `forbidden_paths` / `verification_spec` / `budget` **只能**来自冻结快照内的 `ScopePlan`；**禁止**调用以原始聊天文本为输入的 `buildL0Plan`（或其后继）生成签署范围。违 → `409 E_SCHEME_SNAPSHOT_MISMATCH` 或新建 `E_SEAL_CHAT_SCOPE_BYPASS`（实施期二选一，须入 runtime §2.3 Daemon 专属码）。 |
| **INV-SEAL-02** | **ScopePlan 只由方案结构派生** | `ScopePlan` 的 `areas[].module_ids` / 验收引用必须指向当前 `SchemeDraftV2` 条目；`plan_digest` 绑定 `scheme_revision`；方案一变即作废重算（承接 supervisor §15.3）。启发式离线兜底产出的无 `evidence` 条目**不得**单独支撑可签署的 `ScopePlan`（无溯源入口，见 supervisor §14.7）。多合同场景下，单桩 `ScopePlan` 必须是已冻结 MachineFace / 方案视图对应该桩的确定性投影，不得回退到聊天关键词。 |
| **INV-SEAL-03** | **确认瞬间冻结双面产物** | 「确认方案」或「确认开工」进入可签路径时，`FREEZE_SNAPSHOT` 必须同时落盘：**(A) UserFace** = 冻结 `SchemeDraftV2`（及确定性渲染出的图的输入结构；Demo 按 ADR-0010 可选）+ **(B) MachineFace** = 同修订的完整 `ScopePlan`（含 `plan_digest`）+ 将写入合同的 `scheme_item_ids` / `acceptance_refs` / `stub_id`（若有 ProjectPlan）。缺任一面 → 拒绝签署。`tiny` Fast Path 可一次点击同时完成确认方案与确认开工，但仍须双面齐全。 |
| **INV-SEAL-04** | **确认后保留清单（DEC-01 定型）** | 见 §2.2。不在清单内的过程物允许 GC；清单内对象在合同 `MERGED` 或显式放弃前不得删。 |
| **INV-SEAL-05** | **编译器是唯一允许「发明结构」的模型位** | 右栏搭档不写方案；Worker 不扩需求；DesignNote / PAB 提案不得新增方案级 `goals` / `modules` / `acceptance`（只能在已签合同的 `writable_paths` 与既有 `acceptance_refs` 内细化，或在已密封方案结构上提出架构约束）。新意图只能回到未冻结方案，经编译器补丁进入。 |

### 2.2 确认后保留清单（DEC-01）

| 必须保留 | 落盘位置 | 读者 | 删除条件 |
| :--- | :--- | :--- | :--- |
| 原始用户消息语料（含 `U<seq>` 别名） | `.stagent/sessions/`（及方案 `evidence` 内的 quote / anchor） | 审计、溯源联动、金标集 | 用户显式清除工作区；否则随 journey 保留 |
| UserFace：最终确认版方案 | `.stagent/drafts/schemes/{confirmation_id}.json` 内的 `SchemeDraftV2` | 用户中栏只读回看、试玩归因 | 合同放弃且用户确认清理后可归档 |
| MachineFace：`ScopePlan` + 合同绑定字段 | 同上快照内的 `ScopePlan`；合同 `.stagent/contracts/<id>.json` 的 `supervisor_metadata.scheme_item_ids` / `acceptance_refs` / `stub_id` | Daemon、Worker 指令、追踪链、其后 PAB / ProjectPlan 消费 | 同合同审计包生命周期（ADR-0011） |
| 证据与审计 | `.stagent/evidence/`、`.stagent/records/{contract_id}/` | 验收、合入 Trailer | 只追加；不因「过程清理」删除 |
| 活跃墓地 | 台账 `graveyard`（随迁规则见 supervisor §14.11） | 编译器 / Worker 门禁 | 墓碑不删，只标记 `revived` |

| 允许删除（过程物） | 说明 |
| :--- | :--- |
| 编译 journal / 被整补丁丢弃的 `SchemePatch` | 非冻结权威 |
| 中间 `scheme_revision` 的未冻结草稿（保留最近 N 版供撤销即可，N 默认 20） | 冻结快照已涵盖确认版 |
| Demo 构建缓存 / 失败产物 | Demo 非硬门禁（ADR-0010） |
| 防抖合并前的临时渲染态 | 非落盘权威 |

### 2.3 聊天记录：是否被 Supervisor 读取、保存在哪

- **读取**：是。旁观触发仅针对**用户**消息（`USER_TURN_COMMITTED`）；AI 搭档回复不可作证据（supervisor §14.4、INV-LEDGER-01）。
- **保存位置**：会话正文 → `.stagent/sessions/`；进入方案的逐字摘录 → 方案条目 `evidence[]`（规范化锚定后含 `anchor`）；确认后随冻结快照与 INV-SEAL-04 保留。
- **用户质疑**：仍在右栏说；编译器把新话编译成补丁或冲突卡；施工后「这里不对」走试玩自查归因（playtest-self-check），**不**要求用户换一个对话框找 Supervisor。

### 2.4 与 Demo、图表、专业文档、PAB 的关系

- **图表**：由结构确定性渲染（supervisor §14.1「模型出结构，代码出图」），属于 UserFace，不另存模型画出的 Mermaid 权威文本。
- **Demo**：UserFace 的可选增强（ADR-0010）；未生成 Demo 不得阻断 INV-SEAL-03。
- **专业施工文档**：MachineFace 在确认时至少包含 `ScopePlan` + 方案条目绑定；合同签署后的 DesignNote（ADR-0016 / technical-design-and-knowledge）是**下一环**对 MachineFace 的细化，不得回写未授权的方案目标。
- **PAB（ADR-0019）**：密封之后的下一步。只消费已密封方案结构与仓库事实；**禁止**从聊天旁路发明模块边界。PAB **不是**本 ADR 的替代榜首。

### 2.5 明确非目标

1. 不规定意图编译器必须用某一家模型或 Claude Code 会话（形态仍开放，ADR-0014）。
2. 不在本 ADR 内重写 INV-LEDGER 码表或 SchemePatch 引擎算法（权威仍在 supervisor §14.11 与 scheme-patch-engine）。
3. 不解决测试义务、发布、真实预览（已有或应走既有 L 卡）。
4. 不把传统 `templates/` 五件套升格为确认产物；填好的样板仍是 `scheme.md` 形态。
5. 不引入第二套并行 Contract Schema。
6. 不定型项目级架构基线细节（见 ADR-0019）。

### 2.6 物理封死清单（实施期硬删除 / 硬失败）

1. 生产签署路径上一切 `buildL0Plan(chat)` / 以原始聊天字符串为范围输入的后继函数。
2. 「无 `confirmation_id` / 无冻结 `ScopePlan` 仍可推断范围并签署」的分支。
3. 编译器失败时静默回退到聊天关键词范围的兜底。

---

## 3. 后果

### 3.1 正面

1. **切断「精致地做错」**：证据门禁不再为错误意图背书；用户中栏所见即 Worker 所得。
2. **让 J.9 / J.10 / J.2～J.6 有不可违背的北极星**：卡可以改实现，不能保留聊天直推旁路。
3. **回答保留问题**：原始聊天、UserFace、MachineFace 三者有落盘与 GC 边界，过程物可删。
4. **下游卡可无脑**：PAB、分解、DesignNote、测试义务、发布都消费已封印的 MachineFace，不再现场发明「用户到底要什么」。

### 3.2 代价与迁移

1. **废止路径**：一切「无 `confirmation_id` / 无冻结 `ScopePlan` 仍可从聊天推断范围并签署」的代码路径必须删除或硬失败；含现行 `buildL0Plan(chat)` 签署用法。
2. **离线启发式**：无模型钥匙时，启发式方案可以展示，但 **不得** 单独满足可编译判定（delivery-lifecycle §3）进入签署；中栏须常驻「方案助手未连接」提示（supervisor §14.8）。
3. **施工顺序**：本 ADR 合入后，J.2（ScopePlan 纯函数）与 J.4 / J.5（冻结与签署接线）成为 M2 黄金切片的硬前置；J.10 意图编译器未就绪时，只允许人工/夹具写入合法 `SchemeDraftV2` 跑通密封，不得用聊天旁路冒充。
4. **错误码**：若新增 `E_SEAL_CHAT_SCOPE_BYPASS`，须同步 `runtime-contract-and-safety.md` §2.3 与 `ERROR_CODES`；否则统一映射到已有 `E_SCHEME_SNAPSHOT_MISMATCH`。
5. **与 ADR-0019 的衔接**：standard/large 在密封之后生成 PAB；PAB / ProjectPlan 不得重新打开聊天作为范围或模块边界来源。

### 3.3 被否决的备选

| 备选 | 否决理由 |
| :--- | :--- |
| 保留「聊天直推范围」作编译器失败时的静默兜底 | 正是今天的玩具化根因；静默旁路使中栏审阅失去意义 |
| 只靠提示词要求模型「不要发明」，不在 Daemon 封缝 | 违反「模型只负责理解、结构与引擎负责不能犯错」（intent-compiler §0）；普通模型必钻空子 |
| 确认时只冻方案、范围仍现场重算 | 重算输入若仍是聊天文本，缝仍在；必须冻 `ScopePlan` 并校验 `plan_digest` |
| 把 UserFace / MachineFace 拆成两份可独立编辑的权威 | 双真相源；只允许同一冻结快照的两种投影 |
| 等 Opus / 更强模型再定架构 | 模型更强会让错误意图更快变成「可合并的精致错软件」；缝必须先封 |
| 以 PAB 为唯一榜首、把密封当实现细节 | 第一颗扣子扣错时，PAB 只会给虚假意图做精密管网；榜首必须是密封 |

---

## 4. 与现有 docs 的关系

| 文档 | 关系 |
| :--- | :--- |
| [`supervisor.md`](../specs/supervisor.md) §14～§15、§5.2.1 | 机制正文；本 ADR 将其「确认范围 = 合同范围」「禁从意图文本重推」升格为不可逆决策，并补 DEC-01 保留清单 |
| [`delivery-lifecycle.md`](../specs/delivery-lifecycle.md) §3、§6、§7 | 可编译判定与追踪链；本 ADR 把「方案条目 → 合同」断链接成强制密封 |
| [`intent-compiler-prompt.md`](../specs/intent-compiler-prompt.md) / [`scheme-patch-engine.md`](../specs/scheme-patch-engine.md) | 生成端与零模型引擎；本 ADR 不改码表，要求其产出必须能喂进密封 |
| [`scheme.md`](../scheme.md) gap-3、gap-5 | 落差登记的根因条目；合入后应回写「由 ADR-0018 封印」 |
| [`delivery-path-audit.md`](../reports/delivery-path-audit.md) | 审计已指出断链；本 ADR 是对该断链的架构答复 |
| ADR-0010 | Demo 仍可选；不进入 INV-SEAL-03 的硬面 |
| ADR-0014 | 两次点击与形态开放不变；密封发生在确认方案 / 第一次点击的冻结阶段 |
| ADR-0015 | 消费本密封之后的产物拆合同；不替代本 ADR |
| ADR-0016～0017 | 知识库与发布；建立在正确交付物之上 |
| ADR-0019 | PAB；密封之后的全局技术契约，**禁止再称唯一瓶颈** |
| `templates/` | 非权威；不作为确认产物 |

合入后须改：[`adr/README.md`](./README.md) 索引 0018/0019；交付主干与相关 specs 指向本 ADR；supervisor §15.5 加「ADR-0018」指针一句（不改条款正文）。

---

## 5. 验收标准（合入本 ADR 后、代码落地前即可审计文档；代码落地后必须自动化）

| # | 标准 | 类型 |
| :--- | :--- | :--- |
| A-1 | 全库签署路径不存在「仅凭聊天文本 / 无冻结 `ScopePlan`」生成 `writable_paths` 的生产分支；无 `buildL0Plan(chat)` 签署用法 | 代码静态扫描 + 集成测试 |
| A-2 | 冻结快照 JSON 同时含 `SchemeDraftV2` 与 `ScopePlan`，且 `scopePlan.scheme_revision === scheme.scheme_revision`，`plan_digest` 可重算对齐 | 单测 |
| A-3 | 合同 `supervisor_metadata` 含非空 `scheme_item_ids` 与 `acceptance_refs`（系统桩按 project-decomposition §2.1 例外） | 单测 |
| A-4 | 人为制造「中栏方案模块 ≠ 聊天关键词」夹具：签署后 Worker 收到的范围必须跟方案模块走，不得跟聊天关键词走 | 金标 / 集成 |
| A-5 | 无模型钥匙时：可展示启发式方案，点击确认开工必须失败并白话提示，不得静默签署 | 集成 |
| A-6 | INV-SEAL-04 清单内对象在 `MERGED` 前可被测试断言存在；journal / 丢弃补丁可被 GC 且不影响溯源 | 单测 |
| A-7 | 文档：`adr/README.md` 已索引 0018；PAB 在 0019 且不再自称唯一瓶颈；与 supervisor §15.5 无互斥表述 | 文档检查 |

---

## 6. 强制单选结论（审阅记录）

### 6.1 候选（≤5）

1. **意图→可签执行物唯一真相缝**（本 ADR）——聊天不得直推合同；确认冻结双面产物并保留。
2. **意图编译器语义忠实度本身**（INV-LEDGER / J.9 / J.10）——规格已极深，缺的是「编译结果如何唯一进入签署」的缝，而不是再写一篇提示词。
3. **项目级架构基线（PAB）**——大中型防碎裂支柱；已顺延为 ADR-0019，**不是**唯一榜首；旁路不关则 PAB 给假意图做精密施工。
4. **项目级分解脑**（S3 / ADR-0015）——已定型；错分会痛，但正确密封的意图仍可人工/后续轮次拆方。
5. **测试义务 / 反假绿**（S6）——致命质量缺口，属确定性门禁，不是「理解」瓶颈。

### 6.2 榜首

**候选 1：意图→可签执行物唯一真相缝。**

### 6.3 为什么选它（禁止和稀泥）

因为 Stagent 的全部确定性护栏（沙盒、预算、Evidence、合并、甚至未来的测试义务与 PAB）都假设「已签署的意图是对的」。今天文档写「方案驱动范围」，代码却「聊天驱动范围」——这是设计断层，不是实现延迟。封住这条缝之前，更强的模型只会更快地把错误意图做成可合并的「成功」；封住之后，候选 2～5 与 ADR-0019 才值得按卡推进，并且普通模型也扛得住。Demo、图表、专业文档、聊天存档，全部是这条缝在确认瞬间的双面产物与保留清单，而不是另几个并列的第一瓶颈。
