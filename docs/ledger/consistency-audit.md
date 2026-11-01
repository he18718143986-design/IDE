# 规格一致性审计收尾记录（2026-10-28）

> **位置（2026-10-29 文档治理）**：本文原在 `docs/specs/`，现移入 [`docs/ledger/`](./README.md)。它是台账（OP 挂账、待裁决、销项），不是规格；放在 `specs/` 会让人误当施工依据。条目与编号不变。

> **性质**：审计收尾记录，只登记、不改任务状态。任务卡（`development-tasks.md`）状态未改动。
> **2026-10-28 裁决落笔**：C-3、C-4、C-5 已拍板并移入「一之二」；OP-11 已销项（见「五」第 10 项）；新增 OP-19（C-4 按钮文案统一）。本次修改不改任务状态。
> **2026-11-01 裁决落笔（Tina）**：OP-1 → 洗白；OP-13 → 第一印象窗口不阻塞。
> **2026-11-01 立卡（Tina）**：台账债六项 → `TASK-A.7` / `H.9` / `W.6` / `L.18` / `J.19` / `J.20`（OP-1 实施）。裁决 OP-1/OP-13 仍销项；Sprint 首要仍 L.12。
见「一之二」增补与「三」划线销项；落点 `scheme.md` dec-10/dec-11、supervisor §13.3 / §14.11 K-12、playtest-self-check §5.1。
> **2026-11-01 裁决落笔（Tina · oq-2）**：北极星「一模一样」判据 → 用户对话试玩 + 结构化证据桩（绑定版本/原话/时间戳）；AI 引导不代判；无机器自动对比。见「一之二」增补；落点 `scheme.md` dec-12、oq-2（已销项）、acc-6，解除 `TASK-L.17` 产品阻塞。
> **2026-11-01 裁决落笔（Tina · oq-3）**：凭据存 Vault 至用户手动删除（不设自动过期、不按项目联动清理）；代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、零账密。见「一之二」增补；落点 `scheme.md` dec-13、oq-3（已销项），解除 `TASK-L.17a` 前置依赖。
> **2026-11-01 L.17a 交付与 L.17b 解封**：L.17a #70（`8516c3d`）已合入 main，标记为 `[COMPLETED]`；`TASK-L.17b`（对比视图与试玩证据桩）正式解除阻塞恢复 `[READY]`。当前 main tip 为 `8516c3d`。
> **基线**：`main` @ `e610016`。**PR #9 仍为 open、未合入**。本记录的机械修复与 PR #9 不重叠：PR #9 改动 supervisor §12 与 §20、dev-tasks 的 S.5 / J.10 / J.16 与状态回写 39→83、runtime §8 L3 行、README 附属段；本记录不触及这些位置。两者合并顺序互不影响。**本记录完成后更新**：PR #9（`e430193`）与本记录所在 PR #10（`99cfe51`）已先后合入 main；上文「open、未合入」为撰写时的历史状态。
> **行号**：本文「行号」指 `e610016` 快照中的物理行，仅供审计定位；规格正文不引用行号。
> **编号**：`C-` 待裁决矛盾；`M-` 本 PR 机械修复；`OP-` 挂账项。`C-1` 本轮无前次记录，留空位。

## 一、待裁决矛盾（未修，等裁决）

| 编号 | 矛盾 | 双方位置 | 建议（待裁决，未采纳） | 裁决人 |
| :--- | :--- | :--- | :--- | :--- |
| C-1 | 留空：本轮未找到前次审计的 C-1 记录 | — | 若前次 C-1 存在，请告知后合并编号 | Tina |

**C-2 已修**（见 M-7、M-8）：`demoReady` 的「≥2 个业务模块」与 supervisor 第三部分 §14.10 的「≥1 个 `user_visible` 模块」冲突。已按 §14.10 裁决，相关位置改为指针，不再复述谓词。

## 一之二、已拍板裁决（2026-10-28，Tina）

| 编号 | 原矛盾 | 裁决 | 裁决依据 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| C-3 | Fast Path 的施工载体（Worktree / VIBE 直改）口径不一致 | 免 Worktree **仅限非生产产物**（Demo 展示代码、图标/素材、`.stagent/` 内方案文档）；会进入可执行工程的生产代码（`src/`、`daemon/`、工具链产物）**一律走 Worktree**。VIBE 直改仅适用于上述非生产产物。 | Tina 裁决（2026-10-28）。非生产产物无交付风险；生产代码须可审计、可撤销，故走 Worktree。 | supervisor §16.11「免 Worktree 边界」；架构 §0.2.3.1 加例外指针 |
| C-4 | 超时卡（D-3）仍请用户选「按 Bug 修复 / 按新需求演进」 | 出口改为白话二选【这是 Bug，免费修】/【我想要新功能，下一轮做】；分类由系统内部归，接 attributions 路由，不向用户暴露技术分类。**按钮文案已统一为 supervisor §16.7 文案，OP-19 已销项。** | Tina 裁决（2026-10-28）。 | 架构 §6.4 D-3 单元格 |
| C-5 | 「三次上限」是否包含自动重试 | 三次上限**仅计用户手动触发的重试**；系统首次自动重试不计入，计数器只在用户手动重试时递增。 | Tina 裁决（2026-10-28）。原审计所指的冲突自动重试位于 supervisor 第三部分 §16.8。 | 架构 §6.4 D-1 单元格；supervisor §16.8 |
| J9-1 | 墓地 A-04 与被拒建议（墓碑 `item_ref` 指向仍存活条目，(a) 按 id 命中导致自我违反不变量） | 保留豁免，不改墓碑结构：A-04 跳过 `item_ref` 指向且仍存活的那一条（用户选择保留的版本）；后续补丁仍由 P3 的 (a) 拦截。`item_ref` 是 K-4 回溯链，去掉会削弱 (a) 闸门 | K-4 回溯链；(a) 是后续同 id 复活的最强闸门 | `scheme-patch-engine.md` §5.5 A-04 行豁免条款；代码注释改指向该条款 |
| J9-2 | 锚定判例 Q-16、Q-19 与 §3.3 步骤 5「先过滤后选取」冲突 | 以步骤 5 为准，判例改写：Q-16 取过滤后第 1 处，Q-19 判 `E_QUOTE_TOO_SHORT_UNBOUNDED`。规格勘误：判例与算法冲突时以算法为准，但判例必须同步修改，不得保留旧期望 | 步骤 5 是规范算法，`anchorQuote` 实现与之一致 | `scheme-patch-engine.md` §3.3 步骤 5 澄清、§3.4 勘误说明与 Q-16/Q-19 行；测试已按新口径 |
| J9-3 | TM-Z-11 门禁墓碑的期望码（包装码 `E_PROPOSAL_PREVIOUSLY_REJECTED` 或 op 级码） | op 级码 `E_REVIVAL_SECURITY_LOCKED`。门禁墓碑永不复活，与用户否决墓碑的可复活路径是两类语义，包装码会模糊区分 | K-5 | `scheme-patch-engine.md` §5.3 码表注释；Z-11/Z-12 测试断言 |
| J9-4 | 旧墓碑缺 `rejected_after_turn_seq` 时的迁移默认值 | 默认 0，登记为行为性默认值（偏宽放，不偏紧收）；复活仍须过 R1–R9 闸门 | 旧数据无法确知否决水位 | `scheme-patch-engine.md` §1.3 K-13 |
| OP-1 | 确认路径 `occurrence` 洗白（`mark_user_confirmed`） | **洗白**：确认路径 `occurrence` 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同同一敏感项再次出现自动放行（对齐 K-12「显式风险」与 SA-1）。落地细节（白名单存储位置、scope 粒度、失效条件）由实施卡 **`TASK-J.20`** 确定（**不**回写已 COMPLETED 的 J.9）；本条只销裁决。 | **用户拍板 2026-11-01**；原话：「确认路径上 occurrence 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同中同一敏感项再次出现自动放行」 | `scheme.md` dec-10；supervisor §14.11 K-12；SA-1 / delivery-lifecycle §5 |
| OP-13 | 第一印象窗口长度 | **不阻塞**：不设等待时长；可选速记提示；可跳过；跳过直接进入验收决定；异议随时经右栏 `user_dispute`。 | **用户拍板 2026-11-01**；原话：「第一印象速记窗口不设等待时长、非阻塞、可跳过；用户跳过则直接进入验收决定；用户异议随时经右栏走 user_dispute trigger」 | supervisor §13.3；playtest-self-check §5.1；`scheme.md` dec-11 |
| oq-2 | 北极星「一模一样」的判定方式（像素对比 / DOM 结构 / 用户试玩） | **用户对话试玩 + 结构化证据桩**：用户在右栏对着 AI 自由评阅，最终判定由用户明确表态（点「认可完成」或原话确认）并写入带 `contract_id`、用户原话、版本号（`release_id` 或快照）与时间戳的结构化证据记录；AI 在对话中只做引导和修改建议，不做机器代判；无机器自动对比。认可状态绑定具体版本，新版本重置。 | **用户拍板 2026-11-01**；原话：「acc-6 判定 = 用户与 AI 对话确认 + 「认可完成」动作落成结构化证据（用户原话 + 版本号 + 时间戳）；AI 只做引导，不做判定；无机器自动对比（不追求像素/DOM 指标）」 | `scheme.md` dec-12、oq-2、acc-6；`TASK-L.17` 验收栏；delivery-lifecycle M5 |
| oq-3 | 登录信息属于用户秘密：保存多久、谁能读、是否允许进入 Worker 环境？ | **凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登**：① 凭据存 Vault 直至用户手动删除，不设自动过期、不按项目联动清理；② 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密。**不变量重申**：账密与 cookie 绝不进合同、绝不进日志、绝不进 Worker 环境（维持 ADR-0014 §3 原口径）。 | **用户拍板 2026-11-01**；原话：「oq-3 凭据保管口径 = ① 凭据存 Vault 至用户手动删除（不设自动过期、不按项目联动清理）；② 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密」。出处记 conf-6「受控+Vault」裁决的延伸。 | `scheme.md` dec-13、oq-3（已销项）；`TASK-L.17a` 条款；conf-6 |


## 二、机械修复清单（本 PR）

| 编号 | 文件 | 位置（`e610016` 行） | 修改 | 依据 |
| :--- | :--- | :--- | :--- | :--- |
| M-1 | `docs/specs/supervisor.md` | §18 表，行 1604 | 第二个 `V-10`（点击中栏条目滚动并高亮）改为 **`V-14`** | 与行 1580 的 `V-10`（INV-LEDGER-01）撞号。未采用「改为 V-11」：行 1581 的 V-11（INV-LEDGER-02）已占用，改 V-11 会产生新撞号。V-14 全库无 §18 占用（intent-compiler 的 ADV-14 属另一命名空间）。 |
| M-2 | `docs/specs/supervisor.md` | §18 统计行，行 1611 | 「本节 35 条，`⏳ 35`」→「本节 39 条，`⏳ 39`」 | 表内实际 39 行：V-01～V-13 共 13、S2-01～S2-09 共 9、J-01～J-15 共 15、P-01 共 1、UI 的 V 行 1。 |
| M-3 | `docs/specs/supervisor.md` | §14.11 `attributions` 块，行 1155 | `trigger` 删除 `\| string` 兜底；新增可选 `linked_reason_code?: reasonCodeSchema`（只读引用，仅 `acceptance_fail` 可带） | K-16 原文；`playtest-self-check.md` §5.2、SR-5、TM-PK-11/12 与之一致。intent-compiler-prompt §2.2 的「非码类写入边界」无需改。 |
| M-4 | `docs/specs/playtest-self-check.md` | §5.2，行 274 | 「现行 SSOT」→「K-16 前 SSOT 口径（已由 K-16 收紧为闭集）」 | 避免把已收紧前的类型写成现行。 |
| M-5 | `docs/specs/supervisor.md` | 版本记录，行 27 | 「47 码责任表」后补注现行 51 码 | 历史条目不回改，只补注。`scheme-patch-engine.md` 与 `intent-compiler-prompt.md` §2.1/§2.2 无 47 命中，已核。 |
| M-6 | `docs/specs/development-tasks.md` | TASK-J.10 正文，行 2856 | 「（21/47）」后补注：47 为定稿口径，现行 51 码，待重算（OP-15） | 全库「21/47」仅此一处。 |
| M-7 | `docs/specs/runtime-contract-and-safety.md` | §3，行 133 | 「demoReady 的四条布尔底线」整行改为指针：「`demoReady` 判定以 `supervisor.md` §14.10（v2.1 改判：`≥ 1` 个 `user_visible` 模块）为准，本节不复述谓词。」 | C-2。 |
| M-8 | `docs/specs/supervisor.md` | §2.2 标题行，行 115（第 1 条在行 117） | 标题加改判指针：第 1 条已由第三部分 §14.10 改判 | C-2。§7 D5 段（行 822）已声称「各处已加改判指针」，本处此前缺失，属新发现。 |
| M-9 | `src/lib/error-codes.ts`（代码注释，可选项） | 文件头，行 6 | 「14 个 `error_code`」→「17 个 `error_code`」 | `ERROR_CODES` 数组实为 17 项。仅改注释，不改码表。若认为代码注释不应进文档 PR，撤回本条并转 OP-16。 |
| M-10 | 核对，无需改 | `development-tasks.md` TASK-J.9 卡（行 219、2823）与第二批预告（行 2905）的「V-10～V-13」 | 不改 | 指向 §18 行 1580–1583（INV-LEDGER-01～03 与 V-13），与 M-1 无关。 |

## 三、挂账项（本 PR 不改）

| 编号 | 挂账项 | owner | 触发条件 | 依据 |
| :--- | :--- | :--- | :--- | :--- |
| ~~OP-1~~ | ~~确认路径 `occurrence` 洗白（`mark_user_confirmed`）~~ | — | **已销项（2026-11-01）**：裁决「洗白」——确认路径 `occurrence` 生效，点名敏感项进授权清单、后续合同同项自动放行（K-12 / SA-1）。见「一之二」OP-1；实施卡 **`TASK-J.20`**（2026-11-01 立卡） | supervisor §14.11 K-12；`scheme.md` dec-10 |
| OP-2 | `remove_item` 去留（可绕过入墓） | J.10 实施 | J.10 实施期；若保留，先做组装期否定词检查 | PR #5 审核挂账 |
| OP-3 | `surface_log`（GAP-P8）呈现日志 | J.16 实施 | J.16 实施时写入 §15.4 投影 | playtest-self-check 行 61、305。非错误码，是数据字段；代码 0 命中。 |
| OP-4 | 门禁码无成表闭集 | J.18 实施 PR | 建立 runtime §8.1 闭集并同步 ERROR_CODES 映射时 | runtime §8 L3 行脚注；K-15 |
| OP-5 | `E_GATE_SCAN_FAILED` 仅存在于规格 | J.18 | J.18 实施时 | worker-graveyard-gate 行 338、439；`src/` 与 `daemon/` 0 命中 |
| OP-6 | `E_TEST_FILE_WRITE_BLOCKED` 有代码、未登记 | 门禁闭集 owner（J.18） | 闭集建立时登记入 §8.1 与 ERROR_CODES（需定映射） | `daemon/mcp/gateway.ts` 行 137 及多处抛出；不在 ERROR_CODES，runtime §8 L3 亦未列 |
| OP-7 | `E_PROPOSAL_PREVIOUSLY_REJECTED` 代码未实现 | J.18 | J.18 实施 PR（K-15） | 规格已登记；`src/` 与 `daemon/` 0 命中 |
| OP-8 | `E_CHECKPOINT_FAILED` 以字符串直接返回 409，未入码表 | J.18 闭集 | 同 OP-4 | `daemon/server.ts` 行 1767、1844；runtime §8 L3 脚注已注明 |
| OP-9 | `E_WRITABLE_SCOPE_POLICY` 为类上的码，未入码表 | 签署链（J.3/J.5）；裁定 | 闭集建立时 | `daemon/supervisor/scope-gate.ts` 行 15；runtime §2.3 已注明与 `E_SCOPE_POLICY` 不同 |
| OP-10 | `E_PREPARATION_FAILED` 孤儿码：表内有，`src/` 与 `daemon/` 无抛出点 | 码表维护（待指定） | 下次 error-codes 修订，二选一：删除，或补抛出点 | `src/lib/error-codes.ts` 行 33、194；仅测试手工构造 |
| OP-11 | ~~`E_COMMAND_TIMEOUT` 值分歧~~ | — | **已销项**（见「五」第 10 项） | 原依据见「五」第 10 项 |
| OP-12 | S.5 已知 7 处局限 | J.16 实施 | J.16 实施时 | dev-tasks S.5 行注（PR #9） |
| ~~OP-13~~ | ~~第一印象窗口长度~~ | — | **已销项（2026-11-01）**：裁决「不阻塞」——不设等待时长、可跳过；跳过直接验收决定；异议走 `user_dispute`。见「一之二」OP-13 | supervisor §13.3；playtest-self-check §5.1；`scheme.md` dec-11 |
| OP-14 | `attributions` 回填方 | J.16 | J.16 实施前 | playtest-self-check §5 与 §7.10 |
| OP-15 | 「21/47」按 51 码重算 | J.10 | J.10 实施前 | M-6 |
| OP-16 | M-9 代码注释是否进文档 PR | Tina | 本 PR 审核时 | M-9 为可选项 |
| OP-17 | PR #9 合入 | Tina | 审核后 | PR #9 open，clean |
| OP-18 | 审计未覆盖范围：架构 §1–§4、§9；state-machine-contract 其余章节；constants-and-paths | 下一轮审计 | 下一轮 | 本轮只核 §0.2.3.1、§5.2.2、§6.4、§6.5、§7.1 与 state-machine §4 |
| ~~OP-19~~ | ~~按钮文案统一~~ | — | **已销项**：以 supervisor §16.7 与 §18 行为规范层文案为准，架构 §6.4 D-3 已同步为「这是 Bug，免费修 / 我想要新功能，下一轮做」（Tina 裁决，2026-10-28） | C-4 裁决落笔时发现 |
| ~~OP-20~~ | 上一轮审计漏网：架构「低置信度降级」条目仍写用户点选「按缺陷修复 / 按新需求演进」，未随 OP-19 同步 | — | **已销项**（本 PR）：该条改为系统向用户提业务澄清问题，口径指向 supervisor §16.7；架构底部改判说明与 supervisor §16.7 的取代说明、禁止项保留 | 逐处核对 OP-19 相关 grep 命中时发现 |
| ~~OP-21~~ | supervisor §16.7 内部口径冲突：低置信度时既写「系统问一个业务问题、不把技术分类推给用户」，又写「底部仍显示两按钮，上方加一行『我不确定是谁的问题，你定』」 | — | **已销项**（本 PR）：裁决为「以 supervisor §16.7 澄清问题口径为准，质询台规格段已同步，按钮保留为用户主动裁决入口」；底部按钮段改为低置信度先问业务澄清问题、按钮标注「我不确定是谁的问题」 | 本 PR 修架构时发现；后续提交已同步 supervisor 质询台规格段 |
| OP-22 | J.8「施工·返工」行歧义：§16.2 第 1404 行用「→」把过程压成一行（`REWORK_REQUIRED → IMPLEMENTING`、`VERIFYING → EXECUTING`），返工回到 IMPLEMENTING 后快照上与首次施工同构，无法区分 | Tina 裁决；J.8 后续 | 裁决：代码按现状保留（返工仅在 REWORK_REQUIRED 瞬态可见，之后归「进行中」）；建议补充可观测标记（如快照字段 `rework_in_progress`），否则返工子态只能覆盖 REWORK_REQUIRED 瞬态 | PR #4（J.8）审核，`src/lib/state/journey-stage.ts` 的 `build_rework` 行注释；supervisor §16.2 第 1404 行 |
| OP-23 | J.9 TM-G / TM-Z 的 oracle 为单人编写，未满足规格 §6.1 的独立编写要求 | 第三方复核人（待指定；非实现者、非 J.9 实施上下文） | 已销项-TM-G/TM-Z 独立复核完成，证据见 PR #5 评论 | `scheme-patch-engine.md` §6.1、§8 第 5 条；PR #5（草稿）；缺口 3 项与 TM-Y/TM-P 抽查并入 PR #5 转正评审清单 |
| OP-24 | J.8 瞬态行整组生产不可达：`JOURNEY_ROWS` 中依赖 `transient` 的行（交接 `plan_handoff`、Demo 构建、合并中）在生产路径永不命中，因为 `daemon/server.ts` 调用 `toStateChangedPayload` 时从未传入 `activity_transient`；J.8 实际只覆盖 lifecycle×presentation 的静态子集，§16.2 文档声称映射交接，口径与实现分叉 | 待指定（候选：J.5 签署链或 J.2 ScopePlan，负责产生瞬态事件） | 补 `activity_transient` 生产来源前，文档须把交接、Demo 构建、合并中的映射标为「待接线」；回放路径（`replayPresentationState`）不传 `on_journey_warning` 为有意取舍，表外告警防线在实时广播路径 | 核对 PR #3 时全量检索 main：`activity_transient` 仅出现于 delivery-state、journey-stage、projector 与测试；PR #4 评审时未发现 |
| OP-25 | N-11 DAG 装载期缺少授权子集校验 | 待指定 | 已实现（PR #24） | J.5 前置依赖 |
| OP-26 | N-5 C.8～C.16 任务卡均未声明三项不变 | 待指定 | 已实现（PR #23） | ADR-0001 纪律执行 |
| OP-27 | N-1 任务图核销退出码由前端常量代填 | 待指定 | 已立卡待排期 | J.5 manual_confirmation 硬前置 |
| OP-28 | N-2 右栏 ClaudeCodeAdapter 可写主干 | 待指定 | 已实现（PR #29 右栏 partner 只读化 + PR #30 LS 残留清理）；真 Key 行为验证与 Glob 目录模式真机补验挂账中 | J.1 右栏只读化；右栏自由脑暴裁决同批回写；实机证据（J.1）为前置关键路径；失败分支=停用非静默回退 |
| OP-29 | J.1 上下文注入判别位未生效致 CLI 判别位误判的判例（事件：曾以"机器人身份致 CLI 不注入"解释，复核确认为判别位未注入；产出：verify-env --check-context） | — | 已裁决-入标准 | docs/specs/evidence-and-acceptance-criteria.md §3.2 |
| OP-30 | J.1 "无 tool_use 不算通过"裁决先例（事件：声称在真实 Claude CLI 执行的验证，无 tool_use 记录不予通过） | — | 已裁决-入标准 | docs/specs/evidence-and-acceptance-criteria.md §3.2 |
| OP-31 | J.1 沙箱 root 全绿不具真机外推效力的判例（事件：沙箱 root 权限可绕过权限类测试，须真实用户环境验证；关联 PR #3 分支真机 Glob 条款） | — | 已裁决-入标准 | docs/specs/evidence-and-acceptance-criteria.md §3.2 |
| OP-32 | 验证证据升级为实测/可信证据（exit_code 实采 + API 级确认防伪造） | 待指定 | 已裁决-A 已实现(PR #19)/B 缓议 | 关联 OP-27；设计先决：执行环境/超时/白名单边界；SYNTAX_CHECK/IMPLICIT_SIDE_EFFECT 实采通道待补 |
| OP-33 | Windows 单测既有红（main 基线 45 项/20 文件；每次都失败的稳定层 26 项：spawn/信号、符号链接、合并、迁移、worktree 等；WS/auth/Origin/端口类为抖动层） | 待指定 | 已登记-挂账 | 关联 PR #19 合并；基线 run 40821117113；PR 重跑 run 40838762021 |
| OP-34 | macOS CI runner 不稳定（多次出现 job 排队后零步骤取消，PR #28/#29/#30 均发生，判定为 GitHub 平台侧问题非测试失败；main 同 job 在 95c6698/4144a201 为绿） | 待指定 | 已登记-挂账 | 与 OP-33 Windows 债并列独立；关联 PR #28/#29/#30 判定声明 |
| OP-35 | 跨平台测试偶发抖动（① ipc-stream.test.ts 期望 ERROR 帧先收到 BASELINE_PROGRESS 帧的 WS 竞态，Ubuntu 与 macOS 均有发生，重跑即转绿；② scheme-confirm-scope-drift.test.ts 的 git index.lock 并发竞态，全量跑 2 条失败、单文件复跑 4/4 通过） | 待指定 | 已登记-挂账 | 与 OP-33/OP-34 分开登记；见 PR #28/#29/#30 CI 记录与 e7f57b4 本地实机基线验证 |

## 四、三层皮权威表

| 层 | 管什么 | 文件 | 冲突时 |
| :--- | :--- | :--- | :--- |
| **规格 SSOT** | 产品与契约 | 架构 `system-architecture.md`（宪法；§0.2 与 §7.1 等已有改判横幅）；`supervisor.md` 第三部分（v2.1，现行生效）；`runtime-contract-and-safety.md`（硬契约）；`development-tasks.md`（任务卡与施工 DAG） | 上位规格优先；第三部分 §17 决策与第一部分 §7 同级 |
| **实施口径（附属）** | 某条 SSOT 的实施细节 | `scheme-patch-engine.md`（§14.2/§14.3/§14.11）；`intent-compiler-prompt.md`（§14.4–§14.9，引擎码表以引擎为准）；`worker-graveyard-gate.md`（§14.11 INV-LEDGER-03）；`playtest-self-check.md`（§16.7） | 以所指上位规格为准 |
| **代码即权威** | 运行时事实 | `src/lib/state/delivery-state.ts`；`src/lib/journey/confirm-scheme-atomic.ts`；`daemon/supervisor/demo/signing-gate.ts`；`daemon/guard/audit-manifest.ts`；`daemon/supervisor/rules-l0.ts`；`src/lib/error-codes.ts`（码表目录） | 代码现状不等于目标规格，差距登记在 supervisor §19 |
| **历史指针（非依据）** | 已并入 runtime 的 HISTORICAL 指针 | `constants-and-paths.md`、`state-machine-contract.md`（DOC-7 升格后仅指针）；`rfc/`、`templates/` | 路径/状态机以 `runtime-contract-and-safety.md` §10 / §11 与代码为准 |

## 五、已验证销项清单（本轮）

| 项 | 结论 | 证据 |
| :--- | :--- | :--- |
| 1. 架构 §0.2.3.1、§5.2.2、§6.4、§6.5、§7.1 的外部引用逐条核对 | 编号与所指内容一致：§0.2.3.1 第 3 条（越界熔断）、§5.2.2（Checkpoint）、§6.5.2（0.7 门槛）、§6.5.3（子集检查）、§6.5.4、§7.1（被 D8 取代）。有三处语义问题，见 C-3、C-4、C-5 | supervisor 行 873、1457、1507、1518、1548、1559；架构行 141、703、807、813、815、822、855 |
| 2. state-machine-contract §4 的 `ReasonCode` | 代表码引用，非全量枚举，**不触发 F-6**。未被引用的 4 码（`UNSAFE_EXECUTION`、`EVIDENCE_STALE`、`PREPARATION_INTERRUPTED`、`WORKSPACE_LOCKED`）不构成缺口 | state-machine 行 100–103 |
| 3. `ERROR_CODES` 孤儿码反向检查 | 17 码（头注释「14 个」为旧值，M-9）。除 `E_PREPARATION_FAILED`（OP-10）外，16 码在 `daemon/` 均有抛出或返回点。`E_COMMAND_TIMEOUT` 值分歧见 OP-11。检查范围为 `src/` 与 `daemon/`（抛出点在 `daemon/`，只查 `src/` 会误报） | 非注释、非测试命中计数，见 OP-10、OP-11 |
| 4. 门禁码补登归属清点 | `E_GATE_SCAN_FAILED`（仅规格）、`E_TEST_FILE_WRITE_BLOCKED`（有代码、未登记）、`E_PROPOSAL_PREVIOUSLY_REJECTED`（仅规格）、`surface_log`（数据字段，代码 0 命中）。已归入 OP-3、OP-5 至 OP-7 | 见 OP-3 至 OP-9 |
| 5. 「≥2 模块」残留 | 除 M-7、M-8 外，supervisor 行 1627（L-07 落差登记，记录当前代码事实）无需改；§7 D5 段（行 822）已指向 §14.10 | — |
| 6. 51 码计数 | intent-compiler-prompt 行 11 与 §2.2 已为 51；47 残留两处（M-5、M-6） | — |
| 7. `attributions` 的三处引用 | playtest、intent-compiler-prompt、supervisor 对 `trigger` 的描述一致，除 M-3（类型）与 M-4（措辞）外无需改 | TM-PK-11、TM-PK-12、SR-5 已按闭集写 |
| 8. §18 撞号与统计 | 修复前 `V-10` 重复、统计 35（应为 39），已修为 M-1、M-2；修复后 V-01～V-14 无重复 | — |
| 9. J.9 卡的 V-10～V-13 指针 | 核对正确，无需改（M-10） | — |
| 10. OP-11 `E_COMMAND_TIMEOUT` / `E_COMMAND_REJECTED` 常量值对齐 | 销项。`daemon/runner/command-runner.ts` 两常量值改为 `E_` 前缀，与 gateway 实际产出一致。**纠正原记录**：`E_COMMAND_REJECTED` 并非无引用，它是 `CommandSecurityError` 的默认码（gateway 对该类统一映射为 `E_UNAUTHORIZED_COMMAND`，对外输出不变；内部 `.code` 与错误消息前缀随之变化）。`E_COMMAND_TIMEOUT` 确无引用。 | 仓库全文检索（克隆后 grep）；`tests/` 无字面量 `COMMAND_REJECTED` / `COMMAND_TIMEOUT` |
| 11. C-3 | 销项（裁决已落笔） | 见「一之二」 |
| 12. C-4 | 销项（口径已落笔；文案统一见 OP-19，已销项） | 见「一之二」 |
| 13. C-5 | 销项（计数口径已写死） | 见「一之二」 |
| 14. OP-1 | 销项（洗白裁决已落笔） | 见「一之二」OP-1；`scheme.md` dec-10 |
| 15. OP-13 | 销项（第一印象不阻塞） | 见「一之二」OP-13；supervisor §13.3 |
| 16. oq-2 | 销项（对话试玩+证据桩裁决已落笔） | 见「一之二」oq-2；`scheme.md` dec-12；L.17 oq-2 阻断解除 |
| 17. oq-3 | 销项（凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登已落笔） | 见「一之二」oq-3；`scheme.md` dec-13；L.17a 前置解除 |


### DLV-6（2026-11-01 · L.11 合入挂账，非 OP）

- **项**：DN-2「可以」HTTP / 画布意外卡入口缺口。
- **事实**：`PipelineOrchestrator.resolveDesignDependencyAllow` + `applyDesignDependencyAllow` 已合入；集成测直接调用；生产路径无 HTTP action / 卡片路由可达。
- **处理**：挂 [`README.md`](./README.md) **DLV-6**（NON_BLOCKER）。**2026-11-01 已立卡 `TASK-J.19`**（参照 J.7 UX；不抢 L.12）；本波 docs 回写时未补端点。
- **依据**：Tina 合前确认「若本是后续卡职责则挂账即可」；PR #43 正文审查确认。

**未覆盖**：本轮未逐字核对的范围见 OP-18；`src/` 与 `daemon/` 的检查基于 `e610016` 快照的文本检索，未运行测试。
