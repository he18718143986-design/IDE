# scheme.md 迁出的已落盘裁决与非 L0 正文

> **迁出**：2026-11-14（TASK-J.26）。正文从 [`../scheme.md`](../scheme.md) 迁入，原位只留指针、不保留重复正文。
> **权威**：本文件不是施工依据。L0 意图仍以 [`../scheme.md`](../scheme.md) §0 / §1 / §3 为准；已拍板技术选择以 [`../adr/`](../adr/README.md) 为准。
> **范围**：原 §6 已落盘裁决，以及原 §2 / §4 / §5 / §7～§11 非 L0 正文。原 §12 / §13 与物理指针见 [`../reports/scheme-physical-pointers.md`](../reports/scheme-physical-pointers.md)。

---

## 6. 决定（`decisions[]`）——Agent 的推荐，等用户拍板

> `status: pending` = Agent 推荐、用户未表态；拍板后升格为 ADR（见 [`README.md`](../README.md)「怎么改文档」）。

| id | question | recommended | alternatives | rationale | risk | status | evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| dec-1 | 「Supervisor 生成的机器指令」具体是什么？ | 签署后的**合同 + 任务图节点**：Supervisor 起草，用户在画布确认，Daemon 派发给 Worker。 | Supervisor 直接给 Worker 发自由文本 prompt | 后者让「提建议的人」同时指挥执行，ADR-0007 分权失效。前者与 q7「直接执行」不冲突：用户确认后无需再介入。 | low | `user_confirmed` | q7、q13；ADR-0007 |
| dec-2 | 用户的「主观偏好」放在方案哪里？ | 作为 `goals` / `acceptance` 中 `check: playtest` 的条目，由用户试玩判定。 | 单独建偏好字段 | 偏好只能由人判，正好对应试玩验收；不必扩 Schema。 | low | `user_confirmed` | q1、q13 |
| dec-3 | 三 Agent 拓扑要不要写成 ADR？ | 本方案确认后写 ADR-0014「三 Agent 拓扑与意图编译组件化：中栏形态开放 / 右栏无系统提示脑暴 / Worktree Worker 隔离施工」。 | 只留在本文 | ADR 才能单独 supersede ADR-0007 中「需求 AI 与 Supervisor 允许共用会话」一句。 | high | `user_confirmed` | q4～q7、q12；ADR-0014 |
| dec-5 | 大需求怎么拆？ | 项目 → 里程碑 → 合同 → 任务节点四级；合同是最小可验收交付单元，一轮一份，串行执行。 | 一份大合同并行多 Worker（RFC v0.2 §5） | 单工作区互斥（ADR-0002）仍成立；合同小才能逐份验收与回滚。 | high | `user_confirmed` | q18、q22；[ADR-0015](../adr/0015-contract-as-unit-of-delivery.md) |
| dec-6 | 技术决策记在哪里，用户才能在复杂度上升后仍掌握系统？ | 目标项目仓库内的 `docs/system/`：模块地图 + 决策记录 + 接口 + 变更日志，随每份合同更新，Daemon 校验覆盖。 | 记在 `.stagent/`（本地、不入库） | `.stagent/` 被 `.git/info/exclude` 排除，换机即丢，且不随代码评审。 | high | `user_confirmed` | q19、q22；[ADR-0016](../adr/0016-system-knowledge-base-in-repo.md) |
| dec-7 | 部署放在合同状态机里，还是单独一条生命周期？ | 单独的 Release 生命周期，引用已合并的提交；`MERGED` 仍是合同唯一终态。 | 在合同状态机 `MERGED` 之后加 `DEPLOYED` | 不破坏 ADR-0012；一次发布可包含多份合同，失败回滚不应解开已合并的合同。 | high | `user_confirmed` | q17、q22；[ADR-0017](../adr/0017-release-lifecycle-after-merge.md) |
| dec-8 | ADR-0014「只保留两次点击」下，涉及保护清单的改动怎么授权？（SA-1） | 敏感项默认排除出范围；只有用户原话点名时才进审批，开工按钮一次点击一并授权并带入 plan_digest。 | 保留逐项「可以/不行」 | 守住两次点击，也不放宽保护清单：物理门禁绝不放行未获授权的敏感写入。 | high | `user_confirmed` | q13、q22；[`specs/delivery-lifecycle.md`](../specs/delivery-lifecycle.md) §5 |
| dec-9 | 凭据保险库（Vault）选择哪种存储后端？（OQ-REL-1） | 系统钥匙串（OS Keychain）：本地开发最安全、防明文泄露能力最强，Worker 运行时只受控注入环境变量。 | 加密 JSON 文件；第三方托管服务 | 系统钥匙串避免明文或对称秘钥落盘在目标仓库或 .stagent/，符合零凭据落盘原则。 | low | `user_confirmed` | q14、q22；[`specs/release-and-operations.md`](../specs/release-and-operations.md) §4.1 |
| dec-4 | `development-tasks.md`（约 460KB）要不要拆？ | 拆成「卡号索引 + 活跃卡 + 已完成卡 + 修订流水」，卡号不变。 | 维持单文件 | 约 65% 是已完成卡的历史，仍要执行的 J 系列只占约 15%；但拆分会与正在进行的 PR 冲突，需择时。 | low | `user_confirmed` | q9；[`ledger/README.md`](./README.md) DOC-1 |
| dec-10 | 确认路径上 `occurrence` 是否保留（OP-1「洗白面」）？ | **洗白**：确认路径 `occurrence` 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同中同一敏感项再次出现自动放行（对齐 supervisor §14.11 K-12「显式风险」与 SA-1 授权清单语义）。落地细节（白名单存储位置、scope 粒度、失效条件）由实施卡 **`TASK-J.20`** 确定（J.9 已 COMPLETED，不回写）；本裁决只定方向。 | 取消确认路径 `occurrence`；或另建独立白名单字段、与 quote 锚点脱钩 | 与 dec-8 / SA-1「原话点名 → 开工一并授权」同向；复活路径仍按 K-12 忽略 `occurrence`（取最后一处）。 | high | `user_confirmed` | **用户拍板 2026-11-01**；原话 q23：「确认路径上 occurrence 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同中同一敏感项再次出现自动放行」。**实施卡：`TASK-J.20`**（存储/scope/失效；跨合同≠永久免检；**不**重开本裁决、**不**回写 J.9） |
| dec-11 | 第一印象速记窗口要不要计时阻塞（OP-13）？ | **不阻塞**：不设等待时长；可选速记提示；可跳过；跳过则直接进入验收决定；异议随时经右栏走 `user_dispute` trigger。 | 设固定计时窗口后再入账 | 不新增决定类型、不挡「合入 / 这里不对」；与 §13.3「五种决定」纪律一致。 | low | `user_confirmed` | **用户拍板 2026-11-01**；原话 q24：「第一印象速记窗口不设等待时长、非阻塞、可跳过；用户跳过则直接进入验收决定；用户异议随时经右栏走 user_dispute trigger」 |
| dec-12 | 北极星场景里的「一模一样」用什么判定（oq-2）？ | **用户对话试玩 + 结构化证据桩**：用户在右栏对着 AI 自由评阅，最终判定由用户明确表态（点「认可完成」按钮或原话认可）并落成带 `contract_id`、用户确认原话、版本号（`release_id` 或快照）与时间戳的结构化证据记录；AI 在对话中只做对比引导与修改建议（对接现场问题/微合同机制），不做机器自动代判；无机器自动对比（不追求像素/DOM 指标）。认可状态严格与版本绑定，版本变更时认可重置。机器对比初筛作为后续可能增强另议。 | 像素精确比对；机器 DOM 树匹配 | 「像不像」为主观判断，像素与 DOM 自动化比对脆弱易裂、阻碍真正意图表达且无法捕捉交互体验；AI 仅作引导员不能当代判员，乙方不可自验其活；必须由用户终审且落盘结构化证据闭环。 | high | `user_confirmed` | **用户拍板 2026-11-01**；原话 q25：「acc-6 判定 = 用户与 AI 对话确认 + 「认可完成」动作落成结构化证据（用户原话 + 版本号 + 时间戳）；AI 只做引导，不做判定；无机器自动对比（不追求像素/DOM 指标）」 |
| dec-13 | 登录信息属于用户秘密：保存多久、谁能读、是否允许进入 Worker 环境（oq-3）？ | **凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登**：① 凭据存入 Vault（OS Keychain）直至用户手动删除，不设自动过期，不按项目联动清理；② 代登获得的 session/cookie 过期后，由 Daemon 读取 Vault 账密静默重登换取新 cookie，Worker 全程无感、全程不见账密。**不变量重申**：账密与 cookie 绝不进合同、绝不进日志、绝不进 Worker 环境——维持 ADR-0014 §3 与 conf-6 原口径。 | 设定期自动清理或随项目删除联动销毁；cookie 过期向 Worker 暴露或报错打断 | 凭据属于用户资产，自动过期或项目联动清理易造成二次配置摩擦与破坏非预期行为；Daemon 封装代登状态与重登闭环，Worker 仅消费只读内容，实现最小权限与零接触隔离。 | high | `user_confirmed` | **用户拍板 2026-11-01**；原话 q26：「oq-3 凭据保管口径 = ① 凭据存 Vault 至用户手动删除（不设自动过期、不按项目联动清理）；② 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密」。出处记 conf-6「受控+Vault」裁决的延伸。**实施卡：`TASK-L.17a`** |

## 2. 不做（`out_of_scope[]`）

| id | text | source | evidence |
| :--- | :--- | :--- | :--- |
| oos-1 | v0.1 不做多 Worktree 并行施工；单工作区互斥。 | `user_confirmed` | [ADR-0002](../adr/0002-single-workspace-mutex.md) |
| oos-2 | 不宣称 OS 级安全容器；Worktree 只是文件与分支隔离。 | `user_confirmed` | [ADR-0003](../adr/0003-worktree-capability-boundary.md) |
| oos-3 | 不上云：代码与意图不出本机；本地 JSON 不承诺防篡改。 | `user_confirmed` | [ADR-0006](../adr/0006-local-first-no-tamper-proof.md) |
| oos-4 | 不为了「少打扰用户」而放宽底层门禁；允许降频/合并/延后卡片。 | `user_confirmed` | [ADR-0001](../adr/0001-target-user-positioning.md)「单向约束」+体验层弹性 |

## 4. 流程（`flows[]`）

**flow-1 · 从一句话到合入**（四幕以 [`specs/supervisor.md`](../specs/supervisor.md) §13.4 / §16 为准）

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
| ent-1 | 方案 `SchemeDraftV2` | goals / out_of_scope / modules / flows / entities / decisions / conflicts / open_questions / acceptance | [`specs/supervisor.md`](../specs/supervisor.md) §14.2 |
| ent-2 | 方案补丁 `SchemePatch` | base_revision / ops[] / evidence | 同上 §14.3；[`specs/scheme-patch-engine.md`](../specs/scheme-patch-engine.md) |
| ent-3 | 证据台账 `EvidenceLedger` | claims / decisions / graveyard / attributions | 同上 §14.11 |
| ent-4 | 改动范围 `ScopePlan` | areas / never_touch / needs_approval / verification / budget | 同上 §15 |
| ent-5 | 合同（= 给 Worker 的机器指令） | scope / commands / authorization | [`specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md) §1 |
| ent-6 | Evidence | verdict.status: PASSED / FAILED / BLOCKED / STALE | [ADR-0005](../adr/0005-deterministic-verification-gate.md) |

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
| ~~oq-2~~ | ~~北极星场景里的「一模一样」用什么判定：像素对比、DOM 结构、还是用户试玩？~~ | **已销项（dec-12）**：非机器对比；用户与 AI 对话确认 + 「认可完成」结构化证据桩（用户原话 + 版本号 + 时间戳），AI 仅引导不代判。 | q2、q25；`scheme.md` dec-12 |
| ~~oq-3~~ | ~~登录信息属于用户秘密：保存多久、谁能读、是否允许进入 Worker 环境？~~ | **已销项（dec-13）**：凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登（Worker 全程无感、零账密） → dec-13（凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登）。 | q2、q26；`scheme.md` dec-13 |
| oq-4 | 中栏 Supervisor 若改为 Claude Code，三维预算熔断（ADR-0004）如何对它计账？ | NON_BLOCKER | q6；ADR-0004 |

## 9. 验收（`acceptance[]`）

### 9.1 验收线（产品整体交付标准）

**验收口径（路线 B：受控施工台）**：

给定符合 DoR（Definition of Ready）的任务卡，Stagent 在**无人工干预**的情况下完成全链路：

1. **派生合同**：Supervisor 基于任务卡生成合同（`ScopePlan` → 合同 JSON）
2. **Agent 施工**：Worker 在 Worktree 隔离环境中按合同执行（写码/测试/文档）
3. **产出 Evidence**：Daemon 运行真实验证命令，产出结构化证据（`verification_spec.commands` 执行结果）
4. **通过合并前校验**：Evidence 状态为 `PASSED`，越权/漂移被门禁拦下
5. **交付可审查 PR**：产出 Git 分支 + Commit，用户可在 GitHub 审阅后合并

**通过判据**：

- **N 个真实任务卡**全程无人工介入完成（N = **3**，**待 Tina 拍板**）
- **越权/漂移被失败关闭拦下**：尝试写保护路径 / 超出范围的合同被 `FAILED` / `ABORTED` 拦截，不得产出可合并分支

**明确排除项（不在验收线范围内）**：

- **不要求替代 Cursor** 的编辑/补全/调试能力：`STAGENT_EDITOR="cursor {path}"` 的并用设计维持（路线 B 定位）
- **不要求北极星「网址复刻」**：goal-2 仍标记「当前做不到」（见 gap-11、gap-12、conf-6）

**前置条件（agent 施工档位）**：

- 依赖 **P0b 拍板**：写码档开不开 / 控制档 / 越权防线归谁
- 拍板前验收线**不生效**（Supervisor 只读档可测，Worker 写码档需授权）

**现状缺口登记**：

1. **Agent 写码档未开启**：当前仅 `plan` 只读档，CA-06 实测证明拦截靠 CLI `plan mode` 上游行为（Worker 自身无写能力）
2. **端到端串联未验证**：`golden-slice` 用替身 Worker，真 Agent 全链路（Supervisor → 合同 → Worker → Evidence → PR）未跑过

---

### 9.2 单项验收条目

| id | text | check | 绑定 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| acc-1 | 右栏 Agent 无法写文件、跑 shell、联网。 | `auto` | `tests/integration/partner-readonly.test.ts`；[`reports/j1-partner-cli-verification-2026-10-28.md`](../reports/j1-partner-cli-verification-2026-10-28.md) | PASS（替身模型）；真 Key 补验挂账 OP-28 |
| acc-2 | 右栏 Agent 启动参数中没有任何系统提示注入。 | `auto` | 待写：断言 `buildLaunch` 的 argv 不含 `--system-prompt` / `--append-system-prompt` | ⏳ |
| acc-3 | Supervisor 的一切输出只出现在中栏画布。 | `playtest` | supervisor §18 J 系列 | ⏳ |
| acc-4 | 方案里每条 `user_said` 条目都能在原话中找到逐字子串。 | `auto` | INV-LEDGER-01；本文 §0 可用同一规则自检 | 本文已人工核对 |
| acc-5 | Worker 只在 Worktree 与合同范围内写盘。 | `auto` | Gateway / P.1 现有测试 | PASS |
| acc-7 | 每份合同的验收条目（`check: auto`）都有至少一条测试，且该测试在基线上失败、在候选上通过。 | `auto` | [`specs/verification-strategy.md`](../specs/verification-strategy.md) §3；TASK-L.3、L.4 | ⏳ |
| acc-8 | 合入后知识库覆盖本次改动的全部文件。 | `auto` | [`specs/technical-design-and-knowledge.md`](../specs/technical-design-and-knowledge.md) §4.4；TASK-L.12（[#47](https://github.com/he18718143986-design/IDE/pull/47)/`39f426a`；KB-1 全量文件） | 机制已落地（单测 TD-06～08/10）；端到端产品验收仍 ⏳ |
| acc-9 | 一次发布失败后自动回到上一个 LIVE 版本。 | `auto` | [`specs/release-and-operations.md`](../specs/release-and-operations.md) §1、§3.3；TASK-L.15 | **机制已落地**（#52/`9829385`；失败回滚路径+LIVE→FAILED）；端到端产品验收（真 npm start）仍 ⏳ |
| acc-6 | 北极星：给网址 + 登录信息，用户只回答偏好问题，产出站点经试玩认可。 | `playtest` | 用户与 AI 对话确认 + 结构化证据桩（用户原话 + release_id + 时间戳），版本变更新建重置（dec-12）；凭据 Vault 存至手动删、cookie 过期 Daemon 静默重登（dec-13）。依赖 conf-6、L.14（COMPLETED）、L.17a（COMPLETED）、**L.17b（COMPLETED · #72/`d26def6`）**：对比视图仅供人眼对照、`check playtest` 以 `release_id` 单一事实源判 `STALE_VERSION`、证据桩服务端装配；**L.17c（COMPLETED · #104/`06661be`）**：中栏同页挂载 CompareView + 原话「认可完成」+ 读侧 status；**L.17d（COMPLETED · #145/`e2b8dd3`）**：`reference-snapshots` 经 WebIngestProxy 灌 CompareView 左栏；**L.17e（COMPLETED · #147/`aeedecd`）**：会话 user 原话候选接入试玩认可框；**L.17f（COMPLETED · #149/`86da495`）**：verification 真跑 playtest 且 Fail-Closed | 机制已落地（#72）；UI 接线已合入（#104 · 见 completed §3.4p）；snapshots 拉数已合入（#145 · 见 completed §3.4u）；会话原话候选已合入（#147 · 见 completed §3.4v）；门禁执行旁路已合入（#149 · 见 completed §3.4w）。**历史（P-132/P-149/P-150/P-151）**保留作溯源。端到端产品验收仍 ⏳（挂账①/②/③已销 P-150/P-151/P-152；**仍不宣称闭环**） |

---

## 10. 墓地（`graveyard`）——被否决的方案，不得悄悄复活

> 规则：INV-LEDGER-03。要复活必须走逃生口，由用户显式重开。

| rejected_id | proposal | rejected_by | rejection_reason | evidence |
| :--- | :--- | :--- | :--- | :--- |
| REJ-001 | 右栏 Agent 可直接改主干（Vibe 模式，自动快照兜底） | user | 违反签署分水岭；右栏定位是只读脑暴 | R-OP28；J.1（PR #29 / #30）；RFC v0.2 §3.1 阶段 0 仍保留旧写法 |
| REJ-002 | 右栏就是 Supervisor 本体 | user | Supervisor 在幕后旁观，只经中栏呈现 | q6；supervisor §13.2；architecture §0.2 步骤一旧写法 |
| REJ-003 | 用 `--bare` 启动 Claude Code | user | `--bare` 会跳过 hooks，越界写失去防护 | [ADR-0013](../adr/0013-cli-isolation-without-bare.md) |
| REJ-004 | Demo 作为开工硬前置 | user | Demo 是体验增强项 | [ADR-0010](../adr/0010-demo-optional-not-hard-gate.md) |
| REJ-005 | 独立的 `DELIVERED` 终态 | user | `MERGED` 是唯一运行时终态 | [ADR-0012](../adr/0012-merged-as-terminal-state.md) |
| REJ-006 | 每个任务图节点一个 Git commit 作为点亮依据 | user | 改为三证 + 变更指纹 | [ADR-0009](../adr/0009-serial-graph-fingerprint.md) |
| REJ-007 | 审计侧车放 `.stagent/metadata/` | user | 统一到 `.stagent/records/{contract_id}/` | [ADR-0011](../adr/0011-audit-sidecar-records-path.md) |
| REJ-008 | 「≤2 轮问卷」门控与 Studio 五视口日常入口 | user | 单页方案工作台取代 | supervisor §0、TASK-C.18 |
| REJ-009 | 北极星「一模一样」以像素对比或 DOM 树自动化比对为验收判据 | user | 自动化比对脆弱易裂且无法捕捉主观交互意图；AI 必须由用户终审，不能机器代判 | q25；`scheme.md` dec-12；oq-2 裁决 |
| REJ-010 | 「能力声明不得按宿主侧修辞口径造假」——即：为通过受控档校验而把能力声明往宿主侧希望的措辞上写（把 `DIRECT_UNCONTROLLED` 写成 `GATEWAY_ONLY`、把 `tool_interception_supported=false` 写成 `true`、把「只兑现 `DENY`」写成「`EXPLICIT_TARGETS` 已兑现」） | user | ① 能力声明**必须按事实写**，声明是证据不是修辞；② `SANDBOX_ENFORCED` 的隔离语义是**容器围栏**（唯一挂载点 + 能力裁剪 + 网络拒绝），**不是网关语义**——要求它声明 `GATEWAY_ONLY` / `tool_interception=true` 等于逼它造假；③ 档位差异应由**校验档**（围栏档）与**运行时门禁**（宿主可用性 + 唯一挂载点 + `runInSandbox` 唯一路径 + `SandboxWitness` 见证）承载，**不得由声明文字承载** | `TASK-W.5c-iii`（[#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a`）；`daemon/worker/worker-adapter.interface.ts::validateSandboxFenceTier()`；`daemon/worker/cli-host/openhands-adapter.ts::OPENHANDS_CAPABILITY`（11 条 `known_limitations` 为「按事实写」范本）；`container-host.ts::sandboxWitness()` |

---

## 11. 落差登记——方案 vs 当前代码

> 这是给 Worker 的「还差什么」。卡号以 [`specs/development-tasks.md`](../specs/development-tasks.md) 为准；supervisor §19 的 L-01～L-10 不在此重复。
>
> **2026-11-01 回写**：下表已按 L.16 证据 tip `e4dfe1c` / 物理 tip `e4dfe1c`（含 J.2～J.10、J.18a～d、L.1～L.16、**L.14**/L.15/L.18、J.19/J.20、A.7/H.9 合入；另含 #28～#62 文档/实现）回写「当前代码事实」；管道口径对齐 [ADR-0018](../adr/0018-intent-to-executable-seal.md)（确认 → Seal MachineFace → PAB → ProjectPlan → Worker；禁确认路径 `buildL0Plan(chat)`）。未合实现卡（如 L.17～，oq-2 未裁决）不得标关闭；主序实现卡已尽；Sprint **不开工 L.17**。
> **（本段为 2026-11-01 历史快照，保留原文作溯源；更新指针 2026-11-02 · P-112 / P-113 / P-114 / P-115 / P-116 / P-117 / P-118 / P-119 / P-120 / P-121 / P-122 / P-123 / P-124 / P-125 / P-126 / P-127 / P-128 / P-129）**：oq-2 已由 dec-12 裁决、oq-3 已由 dec-13 裁决；`TASK-L.17` 拆为 L.17a（COMPLETED · #70）与 L.17b（COMPLETED · #72/`d26def6`），**M5 北极星主序全部落完**。上句「未裁决 / 不开工 L.17」仅为当日状态，现行代码事实见本表 gap-11 / gap-12 与 `development-tasks-completed.md` §3.4f；**主序收官后债卡 `TASK-W.6`（AdapterRegistry 受控派工接线）已 COMPLETED（#74/`b5d8c53`，见 completed §3.4g）——本卡属编码内核台账债 DLV-3，不改动 dec-12 / dec-13 北极星判定口径，亦不复活 REJ-009**。**ruling 3（2026-11-02 · P-114 已裁决落盘）**：北极星合同（带 `references[]`）的 `verification_spec.commands` 自动附加 `check playtest` 验收命令、试玩认可成为合并门禁；非北极星合同不附加。属 dec-12 延伸的**配置面**裁决，**不改写 dec-12 / dec-13 判定口径、不复活 REJ-009**；实现已于 `TASK-C.23`（**COMPLETED** · #82/`a5223fb`）兑现：带 `references[]` 的北极星合同装配 `verification_spec.commands` 时自动附加 `{alias:"playtest", executable:"stagent", args:["check","playtest","<contract_id>"]}`（非北极星不附加、幂等、防伪造），原文见 completed §3.4f / §3.4i。物理 tip 现为 `332828f4`（#97 为 P-128 拆分回写，父提交 #96 `c999253` 为 W.9 立卡；P-128 现行口径为 W.9 母卡 `[SPLIT]`、W.9a/b `[READY]`、W.9c `[BLOCKED · 待 a+b]`，Sprint 首要 W.9a、W.9b 可并行；不代表开工获授权。其下 #95 `e280b88` / #94 `81a79a9` 为 P-126 tip 同步；#93 `1a50cb15` 为 P-125 docs 回写、`TASK-W.5b` 由 `[NEW_TASK]` → `[COMPLETED]` 与在队实现卡清零；#92 `bdac805` 为 `TASK-W.5b` 代码 squash：cursor-agent 适配器（`UNCONTROLLED_EXTERNAL`、不挂派工工厂）+ W.7 探测包非容器负向回归基准 + 真实 CLI 观测；#91 `b8d53c5` 为 P-124 docs 回写、W.5b 卡正文按 DoR 重写；#90 `1527b2c` 为 P-123 docs 回写、`TASK-W.7` COMPLETED 与 Sprint 首要转 `TASK-W.5b`；其下 #89 `be480bb` 为 W.7 代码 squash：Worker 自助注册 + 五类断言探测包 + `promoteControlMode` 唯一升格入口，**升格到 `SANDBOX_ENFORCED` 但无执行器 → `dispatchable:false`（结构性边界，非缺陷）**；其下 #88 `5dccebd` 为 P-122 docs 回写、#87 `2313597a` 为 W.5c-iii 代码 squash：OpenHands 适配器 + `DockerContainerHost` 真实容器实测 + `SandboxWitness` 证据面消费，**`W.5c` 三张子卡全部 COMPLETED**；其下 #86 `8ffcde2` 为 P-121 docs 回写、#85 `648be31` 为 W.5c-ii 代码 squash：容器运行时 `runInSandbox` + 派工门禁按宿主可用性解锁、`evidence.schema.ts::worker_control_mode` 扩三值，#84 `cc55037` 为 P-120 docs 回写、#83 `64b737f` 为 P-119 docs 回写、W.5c-i 与 C.23 双卡 COMPLETED、#82 `a5223fb` 为 C.23 代码 squash、#81 `c3e75cc` 为 W.5c-i 代码 squash、#80 `cda4e13` 为 P-118 docs 回写、#79 `b0fa8a0` 为 P-117 tip 同步、#78 `b5d0ef5` 为 P-116、#77 `1c00db7` 为 P-115、#76 `ec871c4` 为 P-114、#75 `61eb003` 为 P-113）。**W.5c-i 窗口期语义已解除（P-121）**：`SANDBOX_ENFORCED` 派工改按 `ContainerHostPort` 可用性判定；`runInSandbox` 当时尚未接入执行面（生产零调用），容器隔离执行归 `W.5c-iii`。**P-123 现行口径**：`TASK-W.7` 已 COMPLETED（[#89](https://github.com/he18718143986-design/IDE/pull/89)/`be480bb`）——注册结果档位恒为 `UNCONTROLLED_EXTERNAL`（「填表即受控」被机制性拒绝），升格**只经** `AdapterRegistry.promoteControlMode()`（须附报告指纹并**重跑**能力校验，降级恒允许）；探测包五类断言（文件围栏 / 命令围栏 / 证据完整性 / 能力声明对账 / 派工见证），P5 复用 `resolveEvidenceControlMode` 不另造判据，**无沙箱执行面即拒绝探测**；指纹变更在**读侧**重算降级（手改 `.stagent/workers.json` 亦绕不过）。**但不宣称端到端闭环**：探测只在桩宿主上做确定性断言（无 `STAGENT_REAL_OPENHANDS=1` 级实测），且**升格到 `SANDBOX_ENFORCED` 后仍不可派工**（自注册 worker 无 `run()` / 派工工厂，`requireControlled` 只放行 `GATEWAY_ENFORCED` → `dispatchable:false`），接通执行器属另卡。**P-122 现行口径**：`W.5c-iii` 已 COMPLETED（#87/`2313597a`）——`runInSandbox` 已接进派工执行链（适配器 `run()` 唯一路径、`host` 必填无本地兜底），真实 `DockerContainerHost` 绑定、`SandboxWitness` 由证据面消费（声明 `SANDBOX_ENFORCED` + 无见证 → 记 `UNCONTROLLED_EXTERNAL`）；**但不宣称端到端闭环**（模型驱动链路因出站 `DENY` 未实测、`EXPLICIT_TARGETS` 逐目标出站未兑现、diff / 范围校验仍由后续网关侧采集），**不宣称「绝对受控」**（见证为结构性约束、实测措辞限定「通过已知探测集」、平台仅 `darwin-arm64`）。**P-124 现行口径**：`TASK-W.5b` 卡正文已按 `task-card-standard.md` R-1～R-12 重写达 DoR（**DOR-3 重写债已偿**），状态仍 `[NEW_TASK]`、开工须授权；卡内写死两件原先没写的事——① **唯一合法档位 `UNCONTROLLED_EXTERNAL`**（`GATEWAY_ENFORCED` 要求 `tool_interception_supported === true`、`SANDBOX_ENFORCED` 要求派工经 `runInSandbox()` 并携 `SandboxWitness`，对宿主进程型适配器**均不可达**；实测不改变档位，只决定声明真实性与 Vibe 可用性）；② **W.7 探测包五类断言在非容器外部适配器上的适用性**（`capability_declaration` 适用且应判 `fail`、`dispatch_witness` N/A-by-design、其余三类不可执行）——该卡因此同时充当探测包对该类适配器的**负向回归基准**，探测包出 `pass` 才是缺陷。原卡所引「架构 §0.6.6」节号不存在，已改引 §2.3 / §4.2.3 P-17 / §0.6.1 / §9.1 / `:1374` P5.5。**开工前置未满足**：本机 `cursor-agent`（`2026.10.01-e373342`）处于订阅登录态、`CURSOR_API_KEY` 未设置，须先隔离环境再实测。**P-125 现行口径**：`TASK-W.5b` 已 **COMPLETED**（[#92](https://github.com/he18718143986-design/IDE/pull/92)/`bdac805`）——cursor-agent 以 `UNCONTROLLED_EXTERNAL` 登记、不挂派工工厂（`requireControlledDispatch()` 抛 `E_ADAPTER_NOT_CONTROLLED`），档位是结构性上界而非待测项；`CA-01`～`CA-05` / `CA-07` / `CA-08` 达成，**`CA-06` 四类越权负例未执行**（无有效 `CURSOR_API_KEY`、禁止用订阅登录态凑数）故 `verified_on` 恒空、**不产出受控证据**；该卡同时充当 W.7 探测包对非容器适配器的**负向回归基准**（`capability_declaration` 应判 `fail`、`dispatch_witness` N/A-by-design、其余三项不可执行）。**矩阵内已无 `[NEW_TASK]` 实现卡（在队清零），下一张卡待 Tina 指定。** **P-126 现行口径**：本轮仅 tip 同步——`bdac805` → `1a50cb15`（[#93](https://github.com/he18718143986-design/IDE/pull/93)/`1a50cb15` 为 P-125 docs 回写 squash），**现行代码事实零变化**：`TASK-W.5b` 仍 `[COMPLETED]`（`CA-06` 挂账、`verified_on` 恒空、**不产出受控证据**）、矩阵仍无 `[NEW_TASK]` 实现卡、下一张卡待 Tina 指定；主序收官与容器隔离链路（档位 → 运行时围栏 → 真实宿主 + 实测）三段贯通的口径同 P-122 / P-125，**不因 tip 推进升格任何适配器档位**。 **P-129 现行物理 tip**：main@`332828f4`（#97，父 #96 `c999253`）；W.9 拆分状态沿用 P-128。

| id | 方案要求 | 当前代码事实 | 对应卡 / 台账 |
| :--- | :--- | :--- | :--- |
| gap-1 | 右栏只读 | 已实现：`ClaudeCodeAdapter` `role: "partner"`，工具白名单 `Read,Glob,Grep` | **已关闭代码落差**：`TASK-J.1` **COMPLETED**（[#29](https://github.com/he18718143986-design/IDE/pull/29) / `4144a20`）；真 Key 补验仍挂账 OP-28 |
| gap-2 | 右栏无系统提示 | **代码已收口（L.1）**：去掉保护清单消息前缀与右栏系统提示注入；`buildProtectionPromptNotice` 已不在热路径。acc-2 自动化断言仍待补 | `TASK-L.1` **COMPLETED**（[#9](https://github.com/he18718143986-design/IDE/pull/9) / `8eb6896`）；见 conf-2、conf-4 |
| gap-3 | 中栏 Supervisor 是 Claude Code | **代码已收口（J.10）**：意图编译器生成端 + Daemon 编译循环已合入（journey → `notifyUserTurnCommitted`）；规则 L0 仅作离线兜底。形态仍开放（conf-1 / ADR-0014） | `TASK-J.10` **COMPLETED**（[#17](https://github.com/he18718143986-design/IDE/pull/17) / `97bb0db`）；conf-1；**由 [ADR-0018](../adr/0018-intent-to-executable-seal.md) 封印（编译结果须经密封进入签署）** |
| gap-4 | Supervisor 只经画布交互 | `JourneyStage` 已由 Daemon 投影并随 `STATE_CHANGED` 下发（J.8）；J.7 交接改为中栏画布卡片、右栏 0 系统消息。规格 §16 旧「右栏插话」叙述仍待正文扫尾 | `TASK-J.8`/`J.7` **COMPLETED**（[#10](https://github.com/he18718143986-design/IDE/pull/10)/[#13](https://github.com/he18718143986-design/IDE/pull/13)）；conf-3 |
| gap-5 | 机器指令 = 合同 + 任务图；确认冻 MachineFace | **主链已落地**：`ScopePlan` 纯函数→预检→确认谓词→快照绑定→确认接线→中栏白话区块（J.2～J.6）；意图编译器生成端已合入（J.10）。签署路径禁止聊天直推写范围（[ADR-0018](../adr/0018-intent-to-executable-seal.md) INV-SEAL-01～03：禁 `buildL0Plan(chat)`；用户确认方案 → Seal 冻 UserFace+MachineFace → 其后 PAB / ProjectPlan / Worker） | `TASK-J.2`～`J.6` **COMPLETED**（[#4](https://github.com/he18718143986-design/IDE/pull/4)～[#7](https://github.com/he18718143986-design/IDE/pull/7)、[#11](https://github.com/he18718143986-design/IDE/pull/11)）；`TASK-J.10` **COMPLETED**（[#17](https://github.com/he18718143986-design/IDE/pull/17) / `97bb0db`） |
| gap-6 | 墓地拦截 Worker 复活被否决方案 | **已收口**：G-MATCH / 产出物投影（J.18a）；合同 `scheme_binding` + 快照 1.2 墓地权威源（J.18b，GAP-W1/W2）；门禁裁决 / 优先级格 / 派工绑定（J.18c）；写路径接线 / CLI pack / 全量扫描（J.18d，GAP-W3/W4/W6）。母卡 `TASK-J.18` 仍 `[SPLIT]`。 | `TASK-J.18a`～`J.18d` **COMPLETED**（[#24](https://github.com/he18718143986-design/IDE/pull/24)/`20c2d46`；[#22](https://github.com/he18718143986-design/IDE/pull/22)/`ca9ed8f`；[#26](https://github.com/he18718143986-design/IDE/pull/26)/`b6922ac`；[#27](https://github.com/he18718143986-design/IDE/pull/27)/`a2fa7df`） |
| gap-7 | 试玩「这里不对」自查 | 旧 `dispute` 实现有 7 处缺陷；J16-P5 正式试玩已在 `main`@`707028b` 上通过（P-202，确认级整句原话；条目级高亮另记，本次未覆盖）；J16-P6 无封存段分支已在 `main`@`c22ef7f` 上通过（P-203；旧合同走查，未重走确认冻结）；J16-P7 官方中栏走查已在 `main`@`8e98538` 上通过（P-204；空台账标「无呈现记录」，有台账列出对应条目）；`TASK-J.16` 已 `[COMPLETED]`（P-205 就事论事收口，estimate 仍为 L，记一次性例外；条目级高亮另记，不在本卡） | TASK-J.16（已完成，P-205）；[`specs/playtest-self-check.md`](../specs/playtest-self-check.md) |
| gap-8 | `SchemePatch` 零模型合并 | 引擎已合入：`src/lib/journey/scheme-patch-engine.ts`（§6 矩阵）；生成端循环已合入（J.10） | `TASK-J.9` **COMPLETED**（[#12](https://github.com/he18718143986-design/IDE/pull/12) / `1ad6eab`）；`TASK-J.10` **COMPLETED**（[#17](https://github.com/he18718143986-design/IDE/pull/17) / `97bb0db`） |
| gap-9 | 早期卡把右栏写成「编码 Worker 对话窗口」 | C.1、W.1、W.5a、C.6、P.1、E.1、Sprint 1 门禁的旧叙述 | 已在任务卡文件头加取代说明；原文不改 |
| gap-10 | 用户不做技术决策 | 现行有 `needs_approval` 逐项表态等审批点 | conf-5 |
| gap-11 | 复刻网站需读参考站 | 全部 Agent 禁 `WebFetch` / `WebSearch`；判据由 dec-12 裁决、凭据保管由 dec-13 裁决；L.17a 落地受控只读代理与代登（#70/`8516c3d`）；**L.17b 落地对比视图与证据桩（#72/`d26def6`）**——对比双栏仅供人眼对照（REJ-009 不复活）、结构化证据桩服务端装配 `release_id`/`timestamp`/`operator`、`check playtest` 跨版本重置。**代码落差已关闭**；**L.17c UI 接线已合入（#104/`06661be`）**——中栏同页挂载 CompareView + 原话「认可完成」。**L.17d snapshots 拉数已合入（#145/`e2b8dd3`）**——经 WebIngestProxy 灌左栏。**L.17e 会话原话候选已合入（#147/`aeedecd`）**——默认空框、手点引用。**L.17f 门禁执行旁路已合入（#149/`86da495`）**——verification 真跑 playtest 且 Fail-Closed。**历史（P-132/P-149/P-150/P-151）**保留作溯源。L.17c 三项挂账均已销；端到端产品验收仍 ⏳；**不宣称闭环** | conf-6、dec-12、dec-13；`TASK-L.17a`（COMPLETED）、`TASK-L.17b`（**COMPLETED** · #72）、`TASK-L.17c`（**COMPLETED** · #104）、`TASK-L.17d`（**COMPLETED** · #145）、`TASK-L.17e`（**COMPLETED** · #147）、`TASK-L.17f`（**COMPLETED** · #149） |
| gap-12 | 登录凭据受控使用 | **代码已收口（L.14+L.17a）**：`daemon/vault/` + `/api/vault` + Settings「密钥」区；日志/命令输出精确脱敏；HTTP 不回明文。发布注入已随 L.15 落地；oq-3 凭据代登与静默重登已随 L.17a（#70/`8516c3d`）落地 | oq-3（已裁 dec-13）；`TASK-L.14` **COMPLETED**（[#31](https://github.com/he18718143986-design/IDE/pull/31)/`ae57543`）；`TASK-L.17a` **COMPLETED**（[#70](https://github.com/he18718143986-design/IDE/pull/70)/`8516c3d`） |
| gap-13 | 大需求拆成合同序列 | **代码已收口（L.7+L.8+L.9+L.10）**：`ProjectPlan` 类型/校验/落盘（L.7）；`PlanPatch`/分解器/API（L.8）；合同序列/`nextStub`/桩视图预检/互斥/`E_CONTRACT_IN_FLIGHT`/桩状态回填（L.9）；画布同页嵌「项目地图」+ `GET /api/project/plan` 权威下一份（L.10，tip `e4351b0` / #38）已合入。任务图一份合同一张的旧路径仍在。 | `TASK-L.7` **COMPLETED**（[#23](https://github.com/he18718143986-design/IDE/pull/23)/`607d742`）；`TASK-L.8` **COMPLETED**（[#33](https://github.com/he18718143986-design/IDE/pull/33)/`fb27504`）；`TASK-L.9` **COMPLETED**（[#35](https://github.com/he18718143986-design/IDE/pull/35)/`e1cf1bb`）；`TASK-L.10` **COMPLETED**（[#38](https://github.com/he18718143986-design/IDE/pull/38)/`e4351b0`） |
| gap-14 | 新功能带测试 | Worker 指令已补「你会被这样检查」（L.2）；合同元数据 / `withSystemScope` / `stagent check` 义务与削弱检测已合入（L.3）；**两段式先红后绿编排已合入（L.4）**（`runWorker`→`runTwoPhase`）；**M2 黄金切片 E2E 已合入（L.6）** | `L.2`/`L.3`/`L.4`/`L.6` **COMPLETED**（[#8](https://github.com/he18718143986-design/IDE/pull/8)/[#15](https://github.com/he18718143986-design/IDE/pull/15)/[#18](https://github.com/he18718143986-design/IDE/pull/18)/[#21](https://github.com/he18718143986-design/IDE/pull/21) / `93589bf`） |
| gap-15 | 试玩看到真实应用 | Worktree 真实应用预览已合入（`daemon/supervisor/preview/app-runner.ts`；端口段 4200～4210，与 Demo 段隔离） | `TASK-L.5` **COMPLETED**（[#14](https://github.com/he18718143986-design/IDE/pull/14) / `0b6bc7f`） |
| gap-16 | 技术方案与系统知识 | **收口（L.11+L.12+L.13+L.18+J.19）**：`DesignNote`/DN-1～5/`design-note.json` 已合入（#43/`78ec236`）。**DN-2 HTTP/画布入口已合入（J.19）**：`/api/design/*` allow/deny + surprise 侧车 + 画布卡（#55/`4bae423`）；DLV-6 **RESOLVED**。**系统知识库与漂移门禁已合入（L.12）**（#47/`39f426a`）。**追踪链已合入（L.13）**（#51/`51ea872`；行号限制见 completed）。**系统地图 UI + impactClosure 已合入（L.18）**（#54/`c8e6a81`）；interfaces consumers 行依赖见挂账。`daemon/arch/*` 仍只做按需展示 | `TASK-L.11`/`L.12`/`L.13`/`L.18`/`J.19` **COMPLETED**；DLV-5/DLV-6 **RESOLVED** |
| gap-17 | 合并后可发布 | **收口（L.15+L.16）**：`daemon/release/*` + `ReleaseRecord` + `local_process`/`user_command`；失败回滚；保险库仅注入 deploy/health；白名单 host env。**线上回流已合入（L.16）**：LIVE 退出/探活 → `live_incident` 落盘 → 发布页「线上」卡 → ask-ai 插 `origin:system` 桩；E 类分流只指引（#62/`e4dfe1c`）。已知挂账：L.15 process-registry 仅内存、`/run` 同步阻塞、替身适配器未跑真 npm start；L.16 卡未进中栏、探活夹具偏 process_exit、重启不重挂 watch 等见 completed | `TASK-L.15` **COMPLETED**（[#52](https://github.com/he18718143986-design/IDE/pull/52)/`9829385`）；`TASK-L.16` **COMPLETED**（[#62](https://github.com/he18718143986-design/IDE/pull/62)/`e4dfe1c`） |

---

