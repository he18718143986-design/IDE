# 研发任务卡 · 活跃 / 未完结

> DOC-1 拆分产物：**活跃 / 未完结卡**（含 `NEW_TASK` / `DEFERRED` / 母卡 `SPLIT` 等）。
> 枢纽与索引见 [`development-tasks.md`](./development-tasks.md)、[`development-tasks-index.md`](./development-tasks-index.md)。
> 卡号不变；正文自原单文件搬迁，未删减字段。

### 3.1 契约基线与通信底座（Sprint 0 基础设施与演进）

<a id="task-d.1e"></a>

#### 【Task D.1e】桌面壳 / 本机助手：真·选文件夹（Import 与工作台同壳）`[DEFERRED → v0.2+ · P5.8 · 2026-10-24]`
* **任务编号**：`TASK-D.1e`
* **前置依赖**：`TASK-D.1d`（建议 v0.2 开工前先完成生产可用单窗口；并行亦须满足 D.1 鉴权）
* **任务状态**：**[DEFERRED → v0.2+]**（架构路线 **P5.8**；**不阻塞** v0.1 / `TASK-D.1d` / 八步旅程验收；2026-10-24 经 Tina 口径对齐为正式推迟，本轮仅文档占位；**维持 DEFERRED，桌面形态另立 RFC · D-6 / P-141**）
* **对照痛点**：浏览器无法弹出系统级「选任意本地文件夹」；D.1c 只有最近列表；用户仍觉「第一次打开很麻烦」，期望接近 Cursor Open / Import。
* **v0.1+ 范围（可延后到桌面壳里程碑）**：提供本机助手或 Electron/Tauri（或等价）能力：在**同一产品壳**内「打开项目 / Import / New Project」→ 系统对话框选文件夹或创建空项目 → 自动启动/复用 Daemon 并进入已带钥匙的工作台。安全模型仍落在 D.1：loopback、`#token=` / 安全等价注入、AUTH、Origin；Demo 仍独立 Origin。
* **明确不包含（本卡立项时仍禁止偷换）**：
  - 在未做桌面壳的纯浏览器里假装已支持任意路径选择器并标完成
  - 推翻 D.1 鉴权或把 Token 长期写入可分享的 query/localStorage 明文
  - 将 Demo 改为 Daemon 同源
* **核心目标**：
  1. **真·选文件夹**：用户在产品 UI 内触发系统文件夹选择器（或受控本机助手），选中路径后进入工作台。
  2. **同壳**：Import/New/最近/工作台在同一产品表面，而不是「终端命令 + 另一个空白浏览器页」心智。
  3. **正式推迟**：v0.1 仅文档占位；排期在 v0.2+（P5.8），不得把缺口塞回已完成的 D.1c，亦不得阻塞 D.1d。
* **Pass/Fail 验收断言（≤5；若本卡 defer 则实施当轮再测）**：
  1. **选文件夹可进**：产品内一点「打开项目」→ 系统选夹 → 工作台已连上可聊（不手拷 Token）。
  2. **同壳**：选夹与聊天在同一应用表面（桌面壳或明确的本机助手 UX），而非仅 README 教用户开终端。
  3. **鉴权与 Demo 不回退**：无钥匙拒连；Demo 独立 Origin；日志无 Token 明文。
* **Pass/Fail 验收判定**：
  - **PASS（实施轮 / v0.2+）**：断言 1–3 成立；v0.1 保持 DEFERRED 且未伪称已交付即为合规。
  - **FAIL**：无桌面能力却标完成；削弱 D.1/Demo 隔离。

---

### 3.2 Supervisor 建议中枢、原型生成、质疑自查与非技术旅程串联（v1.5.0 全生命周期升级；含 S.6）

<a id="task-s.3"></a>

#### 【Task S.3】Supervisor HUD 建议流与 WebSocket 广播
* **任务编号**：`TASK-S.3`
* **前置依赖**：`TASK-S.2`, `TASK-D.1`
* **任务状态**：**[DEFERRED → v0.2+]** / **[REWORK]**（旧设计实现——含 `SUPERVISOR_MATURITY_UPDATED` 成熟度帧——**存于未合并分支 `wip/s2-s3-supervisor-old-design`，未进入 main，非 v0.1 验收依据**；**v0.2 评审未激活 · D-5 / P-141 维持 DEFERRED**）
* **v0.1 保留范围**：仅脱敏模块 `src/lib/ipc/redaction.ts`（键名/真实值/形态三层脱敏、先脱敏后截断），随 TASK-S.2 精简版移植并独立验收；「仅鉴权连接可收帧」作为既有 D.1 原则继续生效。其余广播能力（成熟度帧、Snooze、HUD 上行 action）推迟 v0.2+ 重新评审，状态/草案推送需改接 L0 规则引擎后再评估。
* **核心目标**：
  1. 通过 WebSocket 广播 Supervisor 建议流至已认证客户端。**实现口径**：在 §6.1「类型至少包括」下扩展 `SUPERVISOR_MATURITY_UPDATED`（成熟度快照）、`SUPERVISOR_DRAFT_PROPOSED`（草案提案）、`SUPERVISOR_STATUS_CHANGED`（运行状态）三类下行帧；既有 `SUPERVISOR_SUGGESTION` 保持兼容。
  2. 支持客户端响应：`ACCEPT`、`SNOOZE`（10 分钟静默）、`DISMISS`。**实现口径**：新增上行帧 `SUPERVISOR_SUGGESTION_ACTION`（`client->server`，强制鉴权）。
  3. 建议去重与频控防打扰（30s 内容去重 + 10s/12 帧滑动窗口）。
  4. 敏感信息防护：所有下行 payload 经键名 / 真实值 / 形态三层脱敏，凭据原文不出现在帧中。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/suggestion-broadcaster.ts`（广播决策、去重/频控/SNOOZE、脱敏、状态推导）
  - 新增：`src/lib/ipc/redaction.ts`（共享深度脱敏：`redactText` / `redactDeep`）
  - 修改：`src/lib/ipc/frames.ts`（协议 v1.3：4 类 Supervisor 帧 + payload 契约 + 帧目录）
  - 修改：`daemon/supervisor/throttler.ts`（状态快照 `state` + `setStateListener`，S.3 状态源）
  - 修改：`daemon/server.ts`（广播器接线、鉴权过滤、上行 action 分发、发送异常隔离）
  - 测试：`tests/unit/supervisor-broadcast.test.ts`（26 用例）
* **Pass/Fail 验收判定**：
  - **PASS**：认证客户端准时接收合规建议帧，SNOOZE 静默逻辑生效。
  - **FAIL**：未认证连接接收到帧。
* **历史记录（旧设计实现，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）**：该分支上 `tests/unit/supervisor-broadcast.test.ts` 共 26 个用例曾报告 PASS（2026-10-20；最终树整轮测试未在干净终端复跑）。
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | A 成熟度事件 | 2 | 完整快照（score / badge / 四维 / 未决问题 / advisory_only）；0 分同样广播（非门禁） |
  | B 草案事件 | 4 | 摘要含目标/白名单/禁区/验收/命令/计数值预算；默认无全量、`includeContract` 时通过 Schema；G-11 未决问题逐项保留；摘要不含 env grants；兼容 `SUPERVISOR_SUGGESTION` 伴随帧 |
  | C 状态事件 | 3 | STREAMING → `WORKER_MUTED`；轮次结束 `WORKER_MUTED → EVALUATING → IDLE`；相同状态不重复广播 |
  | D SNOOZE 与防打扰 | 6 | SNOOZE 抑制成熟度但状态帧可送达、resume 恢复；到期自动解除并补发 IDLE；30s 去重；频控窗口恢复；DISMISS 后不再推送；ACCEPT/非法载荷 |
  | E 脱敏 | 6 | `sk-`/Bearer 形态抹除；宿主 `STAGENT_HOST_SECRET` 值不入帧；敏感键名整体替换且不改入参；合同 `authorization` 权限块不被误伤；长数组有界裁剪；先脱敏后截断 |
  | F 连接隔离与容错（真实 WS） | 5 | 已认证收到 / 未认证收不到；断线后广播返回 0 且不抛错、新连接可恢复；transport 异常计数且不外抛；上行 SNOOZE → SNOOZED 状态帧并抑制后续；草案帧仅认证可见且 < 2MB |
  - 协议变更说明：`src/lib/ipc/frames.ts` 协议版本由 v1.2 升至 **v1.3**；新增帧在 `FRAME_CATALOG` 标记 `spec: "v1.3"`，与 v1.2.1 的 13 类基础帧区分；`isClientToServerAllowed` 放行新增的上行 action 帧，其余方向约束不变。
  - 安全边界说明：广播器不持有连接表，所有下行统一经 `server.broadcast()`，后者逐连接校验 `authenticated === true`；发送异常按连接隔离（`terminate` + 移出集合），不会中断其余客户端或 Supervisor 评估循环。

---

---

### 3.3 受控 Coding Worker、安全策略、威胁守卫与成熟 Agent 适配（W.1/W.2 已完成；W.3/W.4 落 Sprint 2；W.5a 落 Sprint 1，绕过负例收尾落 Sprint 3）

<a id="task-w.5b"></a>

#### 【Task W.5b】cursor-agent 适配器黑盒实测（外部适配器实测 + W.7 探测包非容器回归基准）`[COMPLETED]` · **NON_BLOCKER**

> **归档注记（2026-11-02 · P-125）**：本卡已 **COMPLETED**（[#92](https://github.com/he18718143986-design/IDE/pull/92)/`bdac805`，squash merge；分支 `feat/w5b-cursor-agent-verify`，本地 `33cf6c2`，parent `b8d53c5`，合入后 tree 与分支一致）。卡正文**保留原文作溯源**，不再作为施工依据；交付内容、PASS 8 条逐条结果、6 条挂账与「不宣称」边界见 [`development-tasks-completed.md`](./development-tasks-completed.md#task-w.5b) §3.4m。**读本卡注意**：**PASS 8 条中 `CA-06`（真实 CLI 四类越权负例）未执行**——本机无有效 `CURSOR_API_KEY`，且卡内 FAIL 禁止拿订阅登录态凑数，故 `verified_on` 保持空、本卡**不产出任何受控证据**（挂账 1）。口径经 Tina 2026-11-02 裁决：代码侧闭环即标 `[COMPLETED]` + `CA-06` 挂账，**不得**把本卡读成「cursor-agent 已验证」。

> **DoR 正文重写（2026-11-02 · P-124）**：原正文仅 5 行（任务编号 / 前置依赖 / 状态 / 核心目标 / Pass-Fail），经 [`task-card-standard.md`](./task-card-standard.md) R-1～R-12 复核**仅 R-3 达标**，即 ledger **DOR-3** 债（与 `W.5c` 当年同款处理）。本轮按 [`../templates/05-task-card.md`](../templates/05-task-card.md) 样板与 `W.5c` 重写范式逐条补齐 12 条，**仅重写卡正文、状态仍 `[NEW_TASK]`、不改产品代码、不开工、不动 Sprint 排程（`W.5b` 为现行首要）与 §1.1 矩阵语义**。**两处按事实纠正原卡**：① 原卡「注入规则见 架构 §0.6.6」——该节号**不存在**（`system-architecture.md` §0.6 下仅 0.6.1 执行模式 / 0.6.2 全局保护清单 / 0.6.3 冲突仲裁，见 `:261` / `:265` / `:269` / `:298`），本版改引真实节号并把凭证规则落到代码与 CLI 事实；② 原卡隐含「实测可能测出受控档」——按现行代码，`GATEWAY_ENFORCED` / `SANDBOX_ENFORCED` 两档对**宿主进程型**适配器**均不可达**，唯一合法档位是 `UNCONTROLLED_EXTERNAL`（判据见「可达档位」条），实测**不改变档位**，只决定能力声明的真实性与 Vibe 可用性。**本卡不实现宿主侧探测执行面**（见非目标第 1 条）。

* **任务编号**：`TASK-W.5b`
* **任务名称**：cursor-agent 外部适配器黑盒实测（`UNCONTROLLED_EXTERNAL` 登记 + W.7 探测包非容器回归基准）
* **对应规格**（R-1）：[`system-architecture.md`](./system-architecture.md) §2.3（`:393` Coding Worker Agent；`:394` 明文把 cursor-agent 列入 Worker 例）、§4.2.3 P-17（`:591` 术语纠偏：「沙箱」仅用于 OS 级命名空间 / cgroups / MicroVM / 专用容器隔离，**普通本地子进程严禁自称为沙箱**）、§0.6.1（`:265` 执行模式 VIBE vs PROTECTED —— 本卡「仅 Vibe 可用」的出典）、§9.1（`:937` `[待实现 - 目标数据模型]`：三值 `control_mode` + `verified_on`）、`:1374` **P5.5** 成熟 Agent 受控实测表行（「各 Adapter 记录真实 `verified_on`；4 类绕过负例在真实 CLI 上全部失败关闭」）；[`../adr/0001-target-user-positioning.md`](../adr/0001-target-user-positioning.md) **ADR-0001**（防越权控制面完全不变）、[`../adr/0003-worktree-capability-boundary.md`](../adr/0003-worktree-capability-boundary.md) **ADR-0003**（Worktree 能力边界 · 非对抗性沙箱）；[`task-card-standard.md`](./task-card-standard.md) R-1～R-12 / §4；先例 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4a `TASK-W.5a`（cli-host 黑盒实测纪律：`buildLaunch` argv / env 白名单、缺 MCP 端点即 throw）与 §3.4l `TASK-W.7`（探测包五类断言与 id）；ledger [`../ledger/README.md`](../ledger/README.md) **DOR-3**；[`../scheme.md`](../scheme.md) §10 墓地 **REJ-010**（能力声明不得按宿主侧修辞口径造假）
* **前置依赖**（R-3）：`TASK-W.5a`（**COMPLETED** · cli-host 黑盒实测先例与环境白名单纪律）；`TASK-W.6`（**COMPLETED** · [#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53` · `AdapterRegistry` 派工门禁四码，否则登记后无门禁可断言）；`TASK-W.7`（**COMPLETED** · [#89](https://github.com/he18718143986-design/IDE/pull/89)/`be480bb` · 探测包五类断言 + `promoteControlMode()` 唯一升格入口 —— 本卡身份 ② 的被测对象）。**环境前置已核查**（只读，见文末「开工前置」）：`cursor-agent` 可执行且版本已锁定，**但凭证前置未满足**（当前为订阅登录态），须先隔离后方可实测
* **优先级**：P3 · **NON_BLOCKER**（M2 不依赖；不阻断任何主序卡）
* **任务状态**：**[COMPLETED]**（[#92](https://github.com/he18718143986-design/IDE/pull/92)/`bdac805` · 2026-11-02，见 completed §3.4m；`CA-06` 未执行属挂账 1，`verified_on` 恒空，不产出受控证据）
* **双重身份（读卡先读这条）**：
  1. **身份 ①（本卡原始用途）**：cursor-agent 外部适配器黑盒实测 —— 能力声明逐项按实测事实填、`verified_on` 真实填（或明确标注「未通过，仅 Vibe」）。
  2. **身份 ②（P-123 追加）**：W.7 探测包对「**非容器外部适配器**」的**回归基准** —— 被测对象是**探测包本身**，断言方向是**负向**：探测包必须**拒绝**这一类适配器。若某类适配器能让探测包产出 `pass`，那才是缺陷。
  3. 两重身份共用**一次**实测，但**判定分开**：身份 ① 看「实测与声明是否一致」，身份 ② 看「探测包是否拒绝该类适配器」。二者都不得互相顶替。
* **可达档位（实测不改变档位）**：
  1. `GATEWAY_ENFORCED` —— **不可达**。严格档校验要求 `tool_interception_supported === true`（`worker-adapter.interface.ts::validateAdapterCapability` `:199`，判据在 `:248-253`）；cursor-agent 的工具调用由 CLI 侧发起、本进程无拦截点，声明 `true` 即造假（触 REJ-010）。
  2. `SANDBOX_ENFORCED` —— **当前不可达**。判据是**运行路径**而非校验函数：该档派工必须经 `runInSandbox()` 并返回 `SandboxWitness`，`resolveEvidenceControlMode()` 缺见证即校正为 `UNCONTROLLED_EXTERNAL`；cursor-agent 是宿主进程、不经该入口。**陷阱须写明**：围栏档校验 `validateSandboxFenceTier()` 只查 `known_limitations` 非空 + 平台矩阵非空，故它**能通过校验** —— 「通过校验」≠「够格标沙箱」，按 REJ-010 不得据此标该档。
  3. `UNCONTROLLED_EXTERNAL` —— **唯一合法档位**。登记后 `requireControlled()` 不放行、`requireControlledDispatch()` 抛 `E_ADAPTER_NOT_CONTROLLED`、**不挂**派工工厂（与 `default-worker-registry.ts::claudeCodeWorkerRegistration()` `:96` / 登记点 `:256` 同款）。
  4. 若实测证明其 `--sandbox enabled` 提供 §4.2.3 P-17 定义的 OS 级隔离，**是否**为其新开宿主侧围栏执行面属**架构决策、另卡立**；本卡只如实登记实测事实，**不改判据**。
* **W.7 探测包五类断言在本类适配器上的适用性（写死，不由施工者临场判断）**：
  1. `filesystem_fence` —— **不可执行（不适用）**。依据 `worker-probe.ts::runProbePack()` `:270-275`：执行面 `isAvailable() !== true` 即抛 `E_PROBE_SANDBOX_UNAVAILABLE`，**拒绝退回主树执行**；现有唯一实现 `SandboxProbeExecutionPort` 经 `runInSandbox()` 入容器（`probe-execution-sandbox.ts`）。宿主进程适配器无容器执行面 → 本项不可执行，**不得伪造 pass、不得降级为宿主执行**。
  2. `command_fence` —— **不可执行（不适用）**，同上（同一执行面依赖）。
  3. `evidence_integrity` —— **不可执行（不适用）**，同上（同一执行面依赖）。
  4. `capability_declaration` —— **适用**。`probeCapabilityDeclaration()` `:173` 是纯函数、不依赖执行面；对 cursor-agent 取目标档 `GATEWAY_ENFORCED` 应判 **fail** —— 这是身份 ② 的**负向断言**，出现 `pass` 即说明声明被美化或校验被绕过。
  5. `dispatch_witness` —— **N/A（`required:false`）**。`probeDispatchWitness()` `:206-212` 对非 `SANDBOX_ENFORCED` 目标硬编码返回 `not_verified` + `required:false`；且 `FenceProbeInput.target_mode` 类型（`:78`）只接受 `GATEWAY_ENFORCED | SANDBOX_ENFORCED`，**不含** `UNCONTROLLED_EXTERNAL` —— 探测包的用途是「升格判定」，不是「未受控档复核」，类型上就不给这个入口。
  6. 汇总：五类中 **1 类适用且应判 fail、1 类 N/A-by-design、3 类不可执行**。本卡只把这张判定表写死并落回归断言（`CA-07`），**不实现**宿主侧执行面（非目标第 1 条）。
* **一句话目标**（R-2）：cursor-agent 以 `UNCONTROLLED_EXTERNAL` 登记进默认注册表（不挂派工工厂、不可派工、产物不得作为可合并证据），能力声明与 `verified_on` 按真实 CLI 实测如实填写；同一份声明同时充当 W.7 探测包对「非容器外部适配器」的负向回归基准 —— 探测包必须判 `capability_declaration` = fail、`dispatch_witness` = N/A，**绝不产出 pass**。
* **对照痛点（代码与 CLI 事实）**（R-4）：
  1. **生产代码零实现**：全仓 `cursor-agent` / `CURSOR_API_KEY` 仅出现在注释、报告与任务卡，**无任何适配器实现** —— 本卡是**新建**，不是改造既有代码。
  2. `daemon/worker/key-store.ts` 只有 OpenAI 兼容通道（`OPENAI_API_KEY` / `STAGENT_MODEL`），**无 cursor-agent 专用 key 通道**；Claude Code 侧 key 走 `claude-code-adapter.ts:141` 的 `opts.apiKey ?? process.env["ANTHROPIC_API_KEY"]`。故本卡**按需直接读 `CURSOR_API_KEY`**（CLI 原生支持），**不动** `key-store.ts`（见非目标第 3 条）。
  3. `claude-code-adapter.ts::buildLaunch()`（`:165`）是「纯构建便于断言」的先例，env 白名单在 `:327-342`（`PATH` / `HOME` / `LANG` / `STAGENT_HOOK_*` / `ANTHROPIC_API_KEY` / `FORWARD_ENV` 白名单 / `CLAUDE_CONFIG_DIR`），缺 MCP 端点即 throw（`:256-260`，属 TASK-W.8 行为）—— 本卡**只读复用**该纪律。
  4. **本机 CLI 实测事实**（`cursor-agent --help`，版本 `2026.10.01-e373342`）：原生支持 `--api-key <key>` 与 `CURSOR_API_KEY`；有 `--mode plan|ask`（只读档）；有 `--sandbox enabled|disabled`；有 `--print`（帮助原文：has access to all tools, **including write and shell**）；危险开关 `-f/--force`、`--yolo`、`--auto-review`、`--approve-mcps`、`--trust`、`--add-dir`、`-w/--worktree` 全部存在；**无** `--strict-mcp-config` 等价开关（MCP 配置只经配置文件）。
  5. `default-worker-registry.ts::createDefaultWorkerRegistry()`（`:242-271`）当前登记 4 项：内置 Managed AI 双 id（`GATEWAY_ENFORCED` + 工厂）、Claude Code（`UNCONTROLLED_EXTERNAL`、**不挂工厂**）、OpenHands（按 `openhandsControlMode()` 判定）。本卡在其后追加第 5 项。
* **ADR 修订**（R-9）：**无冲突、不修订**。把 cursor-agent 登记为 `UNCONTROLLED_EXTERNAL` 且不挂派工工厂，正是 ADR-0001「防越权控制面完全不变」与 ADR-0003「Worktree 非对抗性沙箱」的**保守侧**执行；不新增档位、不放宽任何判据。
* **采用的默认值**（R-10）：凭证途径**仅限 API Key**（`[用户已确认 · 2026-10-20]` 所有 Worker 模式统一，不使用官方登录 / 订阅会话）；未通过实测者默认 `UNCONTROLLED_EXTERNAL`、仅 Vibe 可用、UI 显示「未受控」。**原卡所引「架构 §0.6.6」节号不存在**（§0.6 下仅 0.6.1 / 0.6.2 / 0.6.3），本版不沿用；凭证注入规则改由本卡范围第 2～4 条与代码事实共同钉死。依赖的 `scheme.md` 冲突卡与 OQ（oq-2 dec-12 / oq-3 dec-13）均已裁决，**无未决产品问题**。
* **范围**（R-5）：
  1. 新建 `daemon/worker/cli-host/cursor-agent-adapter.ts`：导出 `CURSOR_AGENT_WORKER_ADAPTER_ID`（`stagent.cursor-agent.v0`）、`CURSOR_AGENT_CAPABILITY: AdapterCapabilityDeclaration`（9 项按实测事实填，`known_limitations` 逐条对应实测发现）、`CursorAgentAdapter`，以及**纯构建**方法 `buildLaunch(input: Pick<AdapterRunInput, "prompt" | "cwd" | "nativeSessionId">): BuiltLaunch`（argv / env 可逐字断言，仿 `claude-code-adapter.ts:165`）。
  2. `buildLaunch()` 的 argv 白名单（按本机 CLI 实测参数写死，**只准**出现）：`--print` / `--output-format stream-json` / `--mode plan`（只读档；若实测需放开写须在证据文件写明理由与范围）/ `--model <model>` / `--workspace <worktree_root>`；**禁止** `--force` / `--yolo` / `--auto-review` / `--approve-mcps` / `--trust` / `--add-dir` / `-w|--worktree`（任一出现即 FAIL）。
  3. env 白名单（仿 `claude-code-adapter.ts:327-342` 纪律）：仅 `PATH` / `HOME`（指向**专用配置目录**，用于隔离既有登录态）/ `LANG` / `CURSOR_API_KEY` / `STAGENT_*` 观测变量；**不得**透传任意 `process.env`。
  4. MCP 挂接：**仅挂** Stagent 受管端点（`mcpServers.stagent = { type:"http", url, headers }` 形态沿用 `claude-code-adapter.ts:275-289`）；cursor-agent 无 `--strict-mcp-config` 等价开关 → 配置文件落点以实测为准并写入证据文件；端点缺失时**抛错而非静默空集合**（同 W.5a 纪律）。
  5. `daemon/worker/default-worker-registry.ts::createDefaultWorkerRegistry()` 增一行 `registry.register(cursorAgentRegistration(), "UNCONTROLLED_EXTERNAL")`，**不挂** `registerDispatchFactory`；注册表项数 4 → 5。
  6. 新建 `tests/unit/cursor-agent-adapter.test.ts`（确定性：argv / env 白名单、声明对账、档位与门禁、探测包负向回归）与 `tests/e2e/cursor-agent-real.real.test.ts`（真实 CLI，`STAGENT_REAL_CURSOR=1` 时运行）；实测证据归档 `docs/reports/`。
  7. 实测纪律（沿用 W.5a）：负例 ≥4 类（Worktree 外写 / 保护区写 / 白名单外命令 / MCP 面越权），真实 CLI 全部失败关闭后 `verified_on` 才非空。
* **非目标**（R-6）：**不实现宿主侧 `ProbeExecutionPort`**（本卡只把五类断言的适用性判定写死并落回归断言，不做宿主侧围栏探测执行面 —— 另卡）；**不改** `worker-probe.ts` 五类断言语义、**不改** `FenceProbeInput.target_mode` 类型（不得为「让探测能跑」而扩成三值）；不做 `key-store.ts` 的 cursor 专用 key 通道、不改设置页「模型钥匙」UI（若实测证明必须，按 R-11 升 L 另议，不在本卡偷做）；不改 OpenHands / Claude Code 适配器、不改 `container-host.ts`、不改 `promoteControlMode()` 语义；不做 Vibe 模式 UI 文案改造（沿用现有「未受控」显示）；不宣称「绝对受控」、不做多 Agent 并行 DAG（v0.2 RFC）。
* **不变声明**（R-12）：**不改变**：鉴权 / Demo Origin / 点亮三证 / 网关写范围（ADR-0001 纪律）；不改变 `GATEWAY_ENFORCED` / `SANDBOX_ENFORCED` / `UNCONTROLLED_EXTERNAL` 三档判据与 `resolveEvidenceControlMode()`「记实不记名」唯一强制点；不改变 `worker-probe.ts` 五类断言语义与 `target_mode` 类型；`UNCONTROLLED_EXTERNAL` 仍不得作为受控 / 可合并证据。
* **验收（PASS）**（R-7）：新增 `tests/unit/cursor-agent-adapter.test.ts` 与 `tests/e2e/cursor-agent-real.real.test.ts`，逐条可译为 `it(...)`：
  1. `CA-01` 声明如实且严格档必拒：`CURSOR_AGENT_CAPABILITY.known_limitations` 非空且逐条可对应实测；`validateAdapterCapability(CURSOR_AGENT_CAPABILITY, "GATEWAY_ENFORCED").ok === false`（拒绝码 ∈ `FILESYSTEM_DIRECT_UNCONTROLLED` / `TOOL_INTERCEPTION_UNSUPPORTED`）。**反向断言**：若把声明美化成能过严格档，本用例必须失败。
  2. `CA-02` 档位与门禁：`createDefaultWorkerRegistry().get(CURSOR_AGENT_WORKER_ADAPTER_ID)?.control_mode === "UNCONTROLLED_EXTERNAL"`；`requireControlledDispatch(registry, id)` 抛 `E_ADAPTER_NOT_CONTROLLED`；`registry.list().length` 由 4 → 5 且该 id **无**派工工厂。
  3. `CA-03` argv 白名单：`buildLaunch({ prompt:"x", cwd:"/tmp/w" })` 的 `args` **不含** `--force` / `--yolo` / `--auto-review` / `--approve-mcps` / `--trust` / `--add-dir` / `--worktree`，**含** `--print` 与 `--output-format stream-json`。
  4. `CA-04` env 白名单与凭证前置：`buildLaunch().env` 键集合 ⊆ {`PATH`, `HOME`, `LANG`, `CURSOR_API_KEY`, `STAGENT_*`}；夹具注入哨兵环境变量后断言其**不出现**在 `env`；`CURSOR_API_KEY` 缺失时 `run()` 先抛且 **spawn 零调用**（spy 断言）。
  5. `CA-05` MCP 面：端点缺失 → `buildLaunch()` 显式抛错（不得静默落空 `mcpServers`）；`mcpServers.stagent.url` 与受管端点一致；`mcpServers` 内**不含**任何非 `stagent` 项。
  6. `CA-06` 真实 CLI 负例（`STAGENT_REAL_CURSOR=1`）：Worktree 外写 / 保护区写（`.git`、`.stagent`）/ 白名单外命令 / MCP 面越权 **四类全部失败关闭**；任一类可通过即 FAIL。
  7. `CA-07` 探测包负向回归（身份 ②）：`probeCapabilityDeclaration(CURSOR_AGENT_CAPABILITY, "GATEWAY_ENFORCED").status === "fail"`；`probeDispatchWitness("GATEWAY_ENFORCED", undefined)` 返回 `status === "not_verified" && required === false`；执行面不可用时 `runProbePack()` 抛 `E_PROBE_SANDBOX_UNAVAILABLE` 且「一次容器调用都不发生」。三者任一为 `pass` → FAIL（即探测包被绕过）。
  8. `CA-08` `verified_on` 与升格拒绝：`CA-06` 通过前 `verified_on` 恒空、呈现标「未通过，仅 Vibe」；通过后 `cli_version` 为实测 `cursor-agent --version` 原样、`verified_at` 为实测日期；`promoteControlMode(id, "SANDBOX_ENFORCED" | "GATEWAY_ENFORCED", { report_fingerprint })` 必须被拒（`ADAPTER_PROMOTION_REFUSED`）。
* **FAIL**（R-8）：为让 `validateAdapterCapability` 通过而美化声明（`tool_interception_supported: true` 而无拦截实现，或 `filesystem_permissions` 写成 `GATEWAY_ONLY` 却实测可直写）；把 cursor-agent 登记为 `GATEWAY_ENFORCED` 或 `SANDBOX_ENFORCED`（后者需经 `runInSandbox()` 并携 `SandboxWitness`，宿主进程无此路径 → 触 **REJ-010**）；未实测即填 `verified_on`，或实测未过仍填；**凭证走官方登录 / 订阅会话 / cookie**（本机 `cursor-agent status` 当前即订阅登录态，未隔离直接实测 = FAIL）；传 `--force` / `--yolo` / `--auto-review` / `--approve-mcps` / `--trust` / `--add-dir` / `-w` 中任一（即绕过「仅挂 Stagent MCP / 写范围」前提）；为让探测包出 `pass` 而伪造 `ProbeExecutionPort`（把宿主主树当执行面）或把 `target_mode` 类型扩成三值；把 cursor-agent 自带 `--sandbox enabled` 直接当作 §4.2.3 P-17 意义上的「沙箱」并据此标 `SANDBOX_ENFORCED`；为达成实测放宽鉴权 / Demo Origin / 网关写范围；若实测证明必须动 `key-store` + 设置页 UI 却不升 L、不拆即继续开工。
* **关键文件**：`daemon/worker/cli-host/cursor-agent-adapter.ts`（新）、`daemon/worker/default-worker-registry.ts`（改，增一行登记）、`tests/unit/cursor-agent-adapter.test.ts`（新）、`tests/e2e/cursor-agent-real.real.test.ts`（新）、`docs/reports/`（实测证据归档）；**只读复用**：`daemon/worker/cli-host/claude-code-adapter.ts`（env 白名单与 `buildLaunch` 纪律）、`daemon/worker/verify/worker-probe.ts`（五类断言与 `PROBE_IDS`）、`daemon/worker/adapter-registry.ts`（门禁四码）、`daemon/worker/key-store.ts`（核对无 cursor 通道，**本卡不改**）
* **估算**（R-11）：**M**（单层：`cli-host` 适配器 + 一行登记 + 两个测试文件；无容器依赖、无跨层 schema 改动；对照 `W.5c-iii`（M）与 `W.5a`（同类实测）；PASS 8 条未超 §4「PASS 不超过 12 条」，且不越「一张卡只碰一个层」）。**升 L 条件写死**：若实测证明必须新增 `key-store.ts` 的 cursor 专用通道与设置页 UI（跨到配置面 + UI 层），则本卡升 **L**、须按 R-11 拆分（适配器与测试 | 凭证通道与设置页）并另行授权，**不得**在 M 估算下顺手扩层。
* **开工前置（本轮只读核查 · 2026-11-02）**：
  1. ✅ **CLI 可用**：`~/.local/bin/cursor-agent`，`--version` → `2026.10.01-e373342`；`--help` 已逐项核对（`--api-key` / `CURSOR_API_KEY` / `--mode plan|ask` / `--sandbox` / `--print` / `--force|--yolo` / `--approve-mcps` / `--trust` / `--add-dir` / `-w|--worktree` 均在列）。
  2. ⚠️ **凭证前置未满足**：`CURSOR_API_KEY` 未设置；`cursor-agent status` 返回 `✓ Logged in as …`（**订阅登录态**，账号已脱敏、不落文档）。按「凭证仅限 API Key」裁决，**开工第一步**是隔离环境（专用 `HOME` / 配置目录）并断言 `cursor-agent status` 显示未登录，再以 `CURSOR_API_KEY` 实测；否则实测会静默走订阅会话、直接触 FAIL 条件。
  3. ⚠️ **MCP 配置落点与「仅挂 Stagent MCP」的兑现方式尚未实测**（无 `--strict-mcp-config` 等价开关）—— 属本卡实测项，非前置阻断。
  4. 结论：**代码侧可开工；实测侧须先解凭证隔离**。本卡状态保持 `[NEW_TASK]`，开工须 Tina 授权。

---

<a id="task-w.5c"></a>

#### 【Task W.5c】OpenHands 适配器（容器隔离，SANDBOX_ENFORCED）(v1.3.3 新增) `[SPLIT]`

> **DoR 正文重写（2026-11-02 · P-115）**：原正文仅 5 行（任务编号 / 前置依赖 / 状态 / 核心目标 / Pass-Fail），经 [`task-card-standard.md`](./task-card-standard.md) R-1～R-12 复核**仅 R-3 达标**，即 ledger **DOR-3** 债。本轮按 [`../templates/05-task-card.md`](../templates/05-task-card.md) 样板（`TASK-J.2`）逐条补齐 12 条，**仅重写卡正文、不改状态 `[NEW_TASK]`、不改产品代码、不开工实现、不动 Sprint 排程（`W.5c → W.7 → W.5b`）与 §1.1 矩阵**。**估算判 L**：按 R-11「L 卡不得开工、必须拆分」，本卡正文达标 **≠ 可开工**——拆分子卡须 Tina 另行授权（见文末估算）。原卡「D.2 Gate 0 与 A §9.1 不变式承认该模式」经复核：`system-architecture.md` §9.1 标题为 `[待实现 - 目标数据模型]`、代码侧三值未落地，属**落差而非既成事实**，本版改为如实写明（见对照痛点）。

* **任务编号**：`TASK-W.5c`
* **任务名称**：OpenHands 适配器容器隔离（`SANDBOX_ENFORCED`）黑盒实测
* **对应规格**（R-1）：[`system-architecture.md`](./system-architecture.md) §9.1（`worker_spec` 目标模型：三值 `control_mode` + `billing_model` + `verified_on`，标题标 `[待实现 - 目标数据模型]`）、§4.2.3 P-17（术语纠偏：「沙箱」仅用于 OS 级命名空间 / cgroups / MicroVM / 专用容器隔离，**普通本地子进程严禁自称为沙箱**）、§2.7 Git Worktree Engine (Isolation Guard)；[`../adr/0001-target-user-positioning.md`](../adr/0001-target-user-positioning.md) **ADR-0001**（底层强隔离与防越权控制面完全不变）、[`../adr/0003-worktree-capability-boundary.md`](../adr/0003-worktree-capability-boundary.md) **ADR-0003**（Worktree 能力边界 · 非对抗性沙箱）；[`task-card-standard.md`](./task-card-standard.md) R-1～R-12 / §4；先例 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4a `TASK-W.5a` 实测纪律；ledger [`../ledger/README.md`](../ledger/README.md) **DOR-3**
* **前置依赖**（R-3）：`TASK-W.5a`（**COMPLETED** · cli-host 黑盒实测先例）；`TASK-W.6`（**COMPLETED** · [#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，Registry 受控派工接线，否则测完无池可注册）；**软** `TASK-W.7`（本卡容器隔离基建为其探测沙箱复用 / 对齐，排程在 W.7 之前）
* **优先级**：P3 · **NON_BLOCKER**（M2 不依赖；不阻断 `TASK-L.16`）
* **状态**：`[SPLIT]`（**2026-11-02 · P-118 经 Tina 授权按 R-11 拆为 `W.5c-i` / `W.5c-ii` / `W.5c-iii` 三张子卡**；本卡正文保留作拆分追溯，**不再作为施工依据**，施工以三张子卡正文为准）
* **对照痛点（代码事实）**（R-4）：
  1. `src/lib/contract.schema.ts::workerControlModeSchema`（约 :250）与 `daemon/worker/worker-adapter.interface.ts::AdapterControlMode`（:54）均为**二值** `"GATEWAY_ENFORCED" | "UNCONTROLLED_EXTERNAL"`，而 `system-architecture.md:970` 规范为**三值**（含 `"SANDBOX_ENFORCED"`）——该档位无类型 / schema 落点。
  2. `src/lib/contract.schema.ts::workerSpecSchema`（约 :256）仅 5 键（`adapter_id` / `runtime_kind` / `model_id` / `control_mode` / `adapter_version`），**无** `billing_model` / `verified_on`；该文件头部注释（约 :29-33）已明确登记这批 §9.1 目标字段「未在本卡落地」，`tests/unit/contract-schema-v12.test.ts:199` 把五键集锁定为断言。
  3. `src/lib/chat-events.ts::ChatAdapterInfo.control_mode`（:49）同为二值，`daemon/worker/cli-host/claude-code-adapter.ts::info()`（约 :154）以 `opts.verifiedOn` 派生档位；扩枚举不得影响右栏 `role:"partner"` 只读白名单（J.1）。
  4. `TASK-W.7` 卡范围第 3 条（本文件 W.7 卡）已钉：「把 `SANDBOX_ENFORCED` 扩进**两处**枚举——`worker-adapter.interface.ts` 与 `contract.schema.ts` 各一处；只改单边 → schema 与注册侧不一致，漏改即 FAIL」。本卡作为 W.7 探测地基承接该双枚举扩展。
* **一句话目标**（R-2）：合同可选 `control_mode = "SANDBOX_ENFORCED"` 的 OpenHands Worker，其容器内**仅挂载任务 Worktree**、网络按合同策略；越界挂载 / 容器逃逸负例实测失败关闭后，`verified_on` 才按实测版本与日期填写，未通过者仅登记 `UNCONTROLLED_EXTERNAL`（仅 Vibe、UI 显示「未受控」）。
* **ADR 修订**（R-9）：**无冲突、不修订**。`SANDBOX_ENFORCED` 是新增更严档位，强化而非放宽 ADR-0001「底层强隔离 / 防越权控制面完全不变」；须满足 §4.2.3 P-17 与 ADR-0003 边界，**不得**把普通本地子进程标为沙箱。
* **采用的默认值**（R-10）：凭证途径**仅限 API Key**（`[用户已确认 · 2026-10-20]` 所有 Worker 模式统一，不使用官方登录 / 订阅会话——该裁决标记见 W.5a / W.5b 卡；原 W.5b 卡所引「架构 §0.6.6」节号不存在，本卡不沿用）；未通过实测者默认 `UNCONTROLLED_EXTERNAL`。依赖的 `scheme.md` 冲突卡与 OQ（oq-2 dec-12 / oq-3 dec-13）均已裁决，无未决产品问题。
* **范围**（R-5）：
  1. **双枚举扩展（漏改单边即 FAIL）**：`daemon/worker/worker-adapter.interface.ts` 的 `AdapterControlMode`、`src/lib/contract.schema.ts` 的 `workerControlModeSchema` **各增** `"SANDBOX_ENFORCED"`，两处必须同改。
  2. `src/lib/contract.schema.ts::workerSpecSchema` 增 `billing_model?`（`"PER_TOKEN" | "SUBSCRIPTION" | "QUOTA"`）与 `verified_on?`（`{ cli_version, verified_at }`）两可选键，对齐 §9.1 目标模型；同步更新 `tests/unit/contract-schema-v12.test.ts:199` 五键锁定断言（既有四必需键语义不变、`DEFAULT_WORKER_SPEC` 仍为 `GATEWAY_ENFORCED`）。
  3. 新建 `daemon/worker/sandbox/container-host.ts`：导出 `runInSandbox(input: SandboxRunInput, signal?: AbortSignal): Promise<SandboxRunOutcome>`；容器内仅挂载任务 Worktree、网络按合同策略、OS 级隔离（命名空间 / cgroups / 容器运行时）、超时熔断。
  4. 新建 `daemon/worker/cli-host/openhands-adapter.ts`：实现 `CodingWorkerAdapter`（`run(input, signal)`），能力声明 9 项 + `known_limitations` 如实写容器边界；凭证仅 API Key、env 白名单沿用 W.5a 纪律。
  5. `daemon/worker/default-worker-registry.ts::createDefaultWorkerRegistry()` 登记 OpenHands 为 `SANDBOX_ENFORCED`（**仅登记**；未经实测不得挂进受控派工面，派工门禁按 W.6 语义）。
  6. 新建 `tests/unit/openhands-sandbox.test.ts`（确定性负例）与 `tests/e2e/openhands-isolation.real.test.ts`（真实容器，`STAGENT_REAL_OPENHANDS=1` 时运行）；实测证据归档 `docs/reports/`。
* **非目标**（R-6）：不做 W.5b cursor-agent 实测（仍各卡）；不实现 W.7 自助注册 / 自动探测包（本卡只提供可复用容器隔离基建）；不改右栏 `role:"partner"` 只读白名单（J.1）；不宣称「绝对受控」、不做多 Agent 并行 DAG（v0.2 RFC）；不改鉴权 / Demo Origin。
* **不变声明**（R-12）：**不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围**（ADR-0001 纪律）。`SANDBOX_ENFORCED` 为新增**更严**档位，**不放宽** `GATEWAY_ENFORCED` 既有门禁；`UNCONTROLLED_EXTERNAL` 仍不得作为受控 / 可合并证据。
* **验收（PASS）**（R-7）：新增 `tests/unit/openhands-sandbox.test.ts`，逐条可译为 `it(...)`：
  1. `OS-01`：`workerControlModeSchema` 与 `AdapterControlMode` **两处**均含 `"SANDBOX_ENFORCED"`；只改一处的夹具 → 断言失败（漏改即 FAIL）。
  2. `OS-02`：`workerSpecSchema` 接受 `billing_model` / `verified_on`，五键旧断言更新后仍通过；`DEFAULT_WORKER_SPEC` 保持 `GATEWAY_ENFORCED` 不受影响。
  3. `OS-03`：越界挂载负例——诱导挂载宿主根 / `.git` / `.stagent` 保护区，容器拒绝且宿主文件完好。
  4. `OS-04`：容器逃逸负例——诱导 escape / 提权 / 网络出站至未授权域名，全部失败关闭。
  5. `OS-05`：`runInSandbox()` 仅见任务 Worktree 路径，`cwd` 外写入被拒。
  6. `OS-06`：真实容器（`STAGENT_REAL_OPENHANDS=1`）负例通过后 `verified_on` 非空（CLI 版本 + 日期）；未通过则空、登记 `UNCONTROLLED_EXTERNAL`。
  7. `OS-07`：能力声明对账——`known_limitations` 非空且如实，`filesystem_permissions` / `command_permissions` 与容器实测一致。
* **FAIL**（R-8）：`SANDBOX_ENFORCED` 只改 `worker-adapter.interface.ts` 或只改 `contract.schema.ts` 单边；普通本地子进程自称沙箱（违反 §4.2.3 P-17）；任一越界挂载 / 逃逸负例可用；未实测即填 `verified_on` 或标受控；凭证走官方登录 / 订阅会话；为达成实测放宽鉴权 / Demo Origin / 网关写范围；本卡估算判 L 却未拆分子卡即开工或标本卡完成。
* **关键文件**：`src/lib/contract.schema.ts`（改）、`daemon/worker/worker-adapter.interface.ts`（改）、`tests/unit/contract-schema-v12.test.ts`（改）、`daemon/worker/sandbox/container-host.ts`（新）、`daemon/worker/cli-host/openhands-adapter.ts`（新）、`daemon/worker/default-worker-registry.ts`（改）、`tests/unit/openhands-sandbox.test.ts`（新）、`tests/e2e/openhands-isolation.real.test.ts`（新）、`src/lib/chat-events.ts`（只读核对）、`daemon/worker/cli-host/claude-code-adapter.ts`（只读复用 env 白名单纪律）
* **估算**（R-11）：**L**（跨「Schema / 类型层 + 容器运行时层 + 适配器 + 黑盒实测」多层，PASS 断言 7 条且含真实容器实测，超过 §4「一张卡只碰一个层」）。按 R-11「L 卡不得开工，必须拆分」，建议拆为 ① `W.5c-i` 双枚举 + `workerSpecSchema` 目标字段（S/M）② `W.5c-ii` 容器运行时 `runInSandbox`（M）③ `W.5c-iii` OpenHands 适配器 + 真实容器实测与 `verified_on`（M）。**拆分授权已给（2026-11-02 · Tina · P-118）**：按本规划落 `W.5c-i`（双枚举 + 目标字段，S/M，`[READY]`）/ `W.5c-ii`（容器运行时 `runInSandbox`，M，`[READY（跟随 i）]`）/ `W.5c-iii`（OpenHands 适配器 + 真实容器实测 + `verified_on`，M，`[BLOCKED · 等容器环境]`），DAG 增 `i→iii`、`ii→iii` 两条边；母卡标 `[SPLIT]` 保留追溯。**（P-122 现行口径：三张子卡均已 COMPLETED——`W.5c-i` #81/`c3e75cc`、`W.5c-ii` #85/`648be31`、`W.5c-iii` #87/`2313597a`；上句 `[BLOCKED]` 为立卡当日状态，保留原文作溯源。）**`W.5c-iii` 硬前置为本机容器运行时可用 + `STAGENT_REAL_OPENHANDS=1`（P-116 已坐实本机仅 Docker 客户端、无守护进程）。`TASK-W.5b` 的 DOR-3 债保留挂账、本轮不动。

---

<a id="task-w.5c-i"></a>

#### 【Task W.5c-i】双枚举 `SANDBOX_ENFORCED` 与 `workerSpec` 目标字段 `[COMPLETED]`

> **归档注记（2026-11-02 · P-119）**：本卡已 COMPLETED（[#81](https://github.com/he18718143986-design/IDE/pull/81)/`c3e75cc`，squash merge；分支阶段 HEAD `22ed653`，本地两提交 `1a93fb9` 主体 + `22ed653` 下游收窄收尾）。完整交付记录、残余边界与挂账（共 4 条，含 `evidence.schema.ts` 二值有意未扩、`toRuntimeControlMode()` 收窄属窗口期语义、五键测试文件名按代码事实修正）见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4h（锚点 `#task-w.5c-i`）。本处保留原始卡文以存追溯，不再作为施工依据。**窗口期语义仍有效**：`SANDBOX_ENFORCED` 注册接受、`requireControlledDispatch()` 显式拒绝派工（`E_ADAPTER_SANDBOX_LOCKED`），**待 `W.5c-ii` `container-host` 落地解锁**；今日仍是「有档位、无运行时」。

> **窗口期解除（2026-11-02 · P-121 · 现行口径）**：上句「窗口期语义仍有效 … 待 `W.5c-ii` 落地解锁」为归档当日状态，按「保留原文作溯源」惯例不改写原文。`TASK-W.5c-ii` 已 **COMPLETED**（[#85](https://github.com/he18718143986-design/IDE/pull/85)/`648be31`）：派工门禁改按 `ContainerHostPort` 可用性判定（未注入 / 不可用 → `E_ADAPTER_SANDBOX_LOCKED`，可用 → 放行），`toRuntimeControlMode()` 收窄已移除、Evidence 与拦截器如实记三值。挂账 1「`evidence.schema.ts` 二值有意未扩」与挂账 2「收窄属窗口期语义」均于 `W.5c-ii` 兑现（见 completed §3.4j）。

> **拆卡立卡（2026-11-02 · P-118 · 经 Tina 授权）**：母卡 `TASK-W.5c` 按 R-11「L 卡不得开工、必须拆分」拆出本卡，为其**第一张**（纯 Schema / 类型机械层，不依赖容器运行时）。本卡正文按 [`../templates/05-task-card.md`](../templates/05-task-card.md) 样板与 [`task-card-standard.md`](./task-card-standard.md) R-1～R-12 逐条写全。

* **任务编号**：`TASK-W.5c-i`
* **任务名称**：`SANDBOX_ENFORCED` 双枚举扩展 + `workerSpecSchema` 目标字段
* **对应规格**（R-1）：[`system-architecture.md`](./system-architecture.md) §9.1（`worker_spec` 目标模型：三值 `control_mode` + `billing_model` + `verified_on`，标题标 `[待实现 - 目标数据模型]`）、§4.2.3 P-17（「沙箱」仅用于 OS 级隔离，普通本地子进程严禁自称沙箱）；[`../adr/0001-target-user-positioning.md`](../adr/0001-target-user-positioning.md) **ADR-0001**（底层强隔离与防越权控制面完全不变）、[`../adr/0003-worktree-capability-boundary.md`](../adr/0003-worktree-capability-boundary.md) **ADR-0003**；母卡 [`development-tasks-active.md`](#task-w.5c) `TASK-W.5c` 拆分规划
* **前置依赖**（R-3）：`TASK-W.6`（**COMPLETED** · [#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，`requireControlledDispatch` 派工门禁已就位，窗口期拒绝语义挂接在此）；母卡 `TASK-W.5c`（`[SPLIT]` · 已按 DoR 重写并经授权拆分）
* **优先级**：P3 · **NON_BLOCKER**
* **状态**：`[COMPLETED]`（2026-11-02 · [#81](https://github.com/he18718143986-design/IDE/pull/81)/`c3e75cc`）
* **对照痛点（代码事实）**（R-4）：
  1. `src/lib/contract.schema.ts::workerControlModeSchema`（约 :250）与 `daemon/worker/worker-adapter.interface.ts::AdapterControlMode`（:54）均为**二值** `"GATEWAY_ENFORCED" | "UNCONTROLLED_EXTERNAL"`，而 `system-architecture.md:970` 规范为**三值**（含 `"SANDBOX_ENFORCED"`）——该档位无类型 / schema 落点；母卡 W.5c 与 `TASK-W.7` 范围第 3 条均已钉「两处必须同改，漏改单边即 FAIL」。
  2. `src/lib/contract.schema.ts::workerSpecSchema`（约 :256）仅 5 键（`adapter_id` / `runtime_kind` / `model_id` / `control_mode` / `adapter_version`），**无** `billing_model` / `verified_on`；`tests/unit/contract-schema-v12.test.ts:199` 把五键集锁定为断言，新增字段须同步更新该断言。
  3. `src/lib/chat-events.ts::ChatAdapterInfo.control_mode`（:49）同为二值；扩枚举不得影响右栏 `role:"partner"` 只读白名单（J.1）。
* **一句话目标**（R-2）：合同 `worker_spec` 可合法书写 `control_mode = "SANDBOX_ENFORCED"` 与 `billing_model` / `verified_on`，且该档位在容器运行时落地前**注册接受、派工显式拒绝**——杜绝「标了沙箱档却没有沙箱」的假受控状态。
* **ADR 修订**（R-9）：**无冲突、不修订**。`SANDBOX_ENFORCED` 是新增**更严**档位，强化而非放宽 ADR-0001；窗口期「注册接受、派工拒绝」进一步收紧，不触碰 ADR-0003 边界。
* **采用的默认值**（R-10）：**窗口期语义（Tina 2026-11-02 定）**——`SANDBOX_ENFORCED` 仅允许注册登记，`requireControlledDispatch()` 对其**显式拒绝派工**，错误码注明「待 `W.5c-ii` `container-host` 落地解锁」；该语义写进代码注释与 PR 描述。`DEFAULT_WORKER_SPEC` 保持 `GATEWAY_ENFORCED` 不变；`billing_model` / `verified_on` 为可选键、缺省不写。依赖的 OQ（oq-2 dec-12 / oq-3 dec-13）均已裁决，无未决产品问题。
* **范围**（R-5）：
  1. `daemon/worker/worker-adapter.interface.ts`：`AdapterControlMode` 增 `"SANDBOX_ENFORCED"`。
  2. `src/lib/contract.schema.ts`：`workerControlModeSchema` 增 `"SANDBOX_ENFORCED"`（与上条**必须同改**）；`workerSpecSchema` 增 `billing_model?`（`"PER_TOKEN" | "SUBSCRIPTION" | "QUOTA"`）与 `verified_on?`（`{ cli_version: string; verified_at: string }`）两可选键，对齐 §9.1 目标模型。
  3. `daemon/worker/worker-dispatch.ts::requireControlledDispatch()`：对 `control_mode === "SANDBOX_ENFORCED"` 显式拒绝派工，抛带 `code` 的 `WorkerDispatchError`（新增错误码，消息的注释须注明「待 `W.5c-ii` `container-host` 落地解锁」）；**不改变** `GATEWAY_ENFORCED` 既有派工语义与 `E_ADAPTER_NOT_REGISTERED` / `E_ADAPTER_NOT_CONTROLLED` / `E_ADAPTER_NO_DISPATCH_FACTORY` 既有错误码。
  4. `tests/unit/contract-schema-v12.test.ts:199`：五键锁定断言同步更新为含两可选键的集合；`DEFAULT_WORKER_SPEC` 仍为 `GATEWAY_ENFORCED`。
  5. 新建 `tests/unit/worker-spec-schema.test.ts`：本卡专用验收用例（见 PASS）。
* **非目标**（R-6）：不实现容器运行时 `runInSandbox`（归 `W.5c-ii`）；不实现 OpenHands 适配器、不做真实容器实测、不填 `verified_on` 实测值（归 `W.5c-iii`）；不改右栏 `role:"partner"` 只读白名单（J.1）；不实现 W.7 自助注册 / 自动探测包；不改鉴权 / Demo Origin。
* **不变声明**（R-12）：**不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围**（ADR-0001 纪律）。`SANDBOX_ENFORCED` **不放宽** `GATEWAY_ENFORCED` 既有门禁；`UNCONTROLLED_EXTERNAL` 仍不得作为受控 / 可合并证据；窗口期派工拒绝只收窄、不扩张可执行面。
* **验收（PASS）**（R-7）：新建 `tests/unit/worker-spec-schema.test.ts`，逐条可译为 `it(...)`：
  1. `SE-01`：`workerControlModeSchema` 与 `AdapterControlMode` **两处**均含 `"SANDBOX_ENFORCED"`；只改一处的夹具 → 断言失败（漏改即 FAIL）。
  2. `SE-02`：`workerSpecSchema` 接受 `billing_model` / `verified_on` 且缺省不写时解析通过；`DEFAULT_WORKER_SPEC` 保持 `GATEWAY_ENFORCED` 不受影响。
  3. `SE-03`：注册 `SANDBOX_ENFORCED` 适配器成功（登记面接受），但 `requireControlledDispatch()` 对其抛带 `code` 的 `WorkerDispatchError`、消息含「待 `W.5c-ii` 解锁」语义；`GATEWAY_ENFORCED` 派工正例仍通过（不回归）。
  4. `SE-04`：`tests/unit/contract-schema-v12.test.ts:199` 五键锁定断言更新后仍通过；既有四必需键语义不变。
* **FAIL**（R-8）：`SANDBOX_ENFORCED` 只改 `worker-adapter.interface.ts` 或只改 `contract.schema.ts` 单边；`SANDBOX_ENFORCED` 在 `W.5c-ii` 落地前**可经 `requireControlledDispatch` 派工**（假受控）；窗口期拒绝不抛带 `code` 的错误或静默降级到无网关执行；为达成接线放宽鉴权 / Demo Origin / 网关写范围；`DEFAULT_WORKER_SPEC` 被改成 `SANDBOX_ENFORCED`。
* **关键文件**：`src/lib/contract.schema.ts`（改）、`daemon/worker/worker-adapter.interface.ts`（改）、`daemon/worker/worker-dispatch.ts`（改）、`tests/unit/contract-schema-v12.test.ts`（改）、`tests/unit/worker-spec-schema.test.ts`（新）、`src/lib/chat-events.ts`（只读核对）
* **估算**（R-11）：**S/M**（单一 Schema / 类型机械层，无真实容器依赖，不触运行时层）

---

<a id="task-w.5c-ii"></a>

#### 【Task W.5c-ii】容器运行时 `runInSandbox` `[COMPLETED]`

> **归档注记（2026-11-02 · P-121）**：本卡已 COMPLETED（[#85](https://github.com/he18718143986-design/IDE/pull/85)/`648be31`，squash merge；分支 `feat/w5cii-container-host`，本地两提交 `5be9569` 主体 + `e3345b9` 注释与已解锁语义对齐）。完整交付记录、证据面裁决注记（记实不记名）、残余边界与挂账（共 3 条 + `evidence.schema.ts` 跨版本兼容性注记 + 施工指令误传错误码校正）见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4j（锚点 `#task-w.5c-ii`）。本处保留原始卡文以存追溯，不再作为施工依据。**窗口期「永远拒绝」语义至此解除**：`SANDBOX_ENFORCED` 派工改按 `ContainerHostPort` 可用性判定（未注入 / 不可用 → `E_ADAPTER_SANDBOX_LOCKED`，可用 → 放行）；**但 `runInSandbox` 仍未接入执行面**（生产零调用），故今日仍是「有门禁、有围栏逻辑、无真实容器执行」。

> **拆卡立卡（2026-11-02 · P-118 · 经 Tina 授权）**：母卡 `TASK-W.5c` 第二张。`[READY（跟随 i）]` 指排程上紧随 `W.5c-i`、复用其落地的 `SANDBOX_ENFORCED` 枚举与 `workerSpecSchema` 目标字段；**本卡不依赖真实容器环境**，容器宿主交互以 mock / stub 注入，逻辑层可确定性验收。

* **任务编号**：`TASK-W.5c-ii`
* **任务名称**：`daemon/worker/sandbox/container-host.ts` 容器运行时 `runInSandbox`
* **对应规格**（R-1）：[`system-architecture.md`](./system-architecture.md) §4.2.3 P-17（OS 级命名空间 / cgroups / MicroVM / 专用容器隔离；普通本地子进程严禁自称沙箱）、§2.7 Git Worktree Engine (Isolation Guard)、§9.1；[`../adr/0001-target-user-positioning.md`](../adr/0001-target-user-positioning.md) **ADR-0001**、[`../adr/0003-worktree-capability-boundary.md`](../adr/0003-worktree-capability-boundary.md) **ADR-0003**（Worktree 能力边界 · 非对抗性沙箱）；母卡 `TASK-W.5c` 范围第 3 条
* **前置依赖**（R-3）：`TASK-W.5c-i`（`[READY]` · 双枚举 + 目标字段落地后复用）；`TASK-W.6`（**COMPLETED** · 派工门禁语义就位）
* **优先级**：P3 · **NON_BLOCKER**
* **状态**：`[COMPLETED]`（2026-11-02 · [#85](https://github.com/he18718143986-design/IDE/pull/85)/`648be31`；原 `[READY（跟随 i）]`）
* **对照痛点（代码事实）**（R-4）：`daemon/worker/sandbox/container-host.ts` **尚不存在**；母卡 W.5c 范围第 3 条要求导出 `runInSandbox(input, signal)`，但今日无任何容器宿主 / 挂载围栏 / 网络策略实现，`SANDBOX_ENFORCED` 即便在 `W.5c-i` 落地也只是「有档位、无运行时」——`W.5c-i` 已用派工拒绝兜住窗口期，本卡负责补上真正的隔离执行面。
* **一句话目标**（R-2）：Worker 任务经 `runInSandbox()` 在 OS 级隔离环境执行，容器内**仅挂载任务 Worktree**、网络按合同策略、越界写入与逃逸负例失败关闭，且宿主交互可注入以便无容器环境下确定性验收。
* **ADR 修订**（R-9）：**无冲突、不修订**。须满足 §4.2.3 P-17 与 ADR-0003 边界，**不得**把普通本地子进程标为沙箱；不触碰 ADR-0001 控制面。
* **采用的默认值**（R-10）：宿主交互经注入接口（mock / stub）传入，默认实现延后到 `W.5c-iii` 真实容器实测绑定；未通过实测者仍登记 `UNCONTROLLED_EXTERNAL`；凭证途径仅限 API Key（沿用 W.5a 纪律）。无未决产品问题。
* **范围**（R-5）：
  1. 新建 `daemon/worker/sandbox/container-host.ts`：导出 `runInSandbox(input: SandboxRunInput, signal?: AbortSignal): Promise<SandboxRunOutcome>`；定义 `SandboxRunInput` / `SandboxRunOutcome` 与宿主交互注入接口（如 `ContainerHostPort`，供 mock / stub 注入）。
  2. 挂载围栏：容器内仅挂载任务 Worktree 路径；宿主根 / `.git` / `.stagent` 保护区一律拒绝挂载，`cwd` 外写入被拒。
  3. 网络按合同策略；超时熔断；`signal` 取消时进程树回收（沿用 W.1/A.4 纪律）。
  4. `daemon/worker/worker-dispatch.ts::requireControlledDispatch()`：**本卡落地后**解除 `W.5c-i` 的窗口期派工拒绝（错误码注明语义随本卡完成而变），改由容器宿主可用性校验决定是否放行；未挂载 `ContainerHostPort` 时仍拒绝、不静默降级。
  5. 新建 `tests/unit/container-host.test.ts`：以 mock / stub 宿主验证挂载围栏、网络策略、超时熔断与派工门禁切换（见 PASS）。
* **非目标**（R-6）：不绑定真实 Docker / Podman 运行时、不做真实容器黑盒实测、不填 `verified_on`（归 `W.5c-iii`）；不实现 OpenHands 适配器（归 `W.5c-iii`）；不实现 W.7 自助注册 / 自动探测包；不改右栏 `role:"partner"` 只读白名单；不改鉴权 / Demo Origin。
* **不变声明**（R-12）：**不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围**（ADR-0001 纪律）。`SANDBOX_ENFORCED` 为新增更严档位，不放宽 `GATEWAY_ENFORCED` 既有门禁；`UNCONTROLLED_EXTERNAL` 仍不得作为受控 / 可合并证据。
* **验收（PASS）**（R-7）：新建 `tests/unit/container-host.test.ts`，逐条可译为 `it(...)`：
  1. `CH-01`：`runInSandbox()` 仅见任务 Worktree 路径；诱导挂载宿主根 / `.git` / `.stagent` → 拒绝且宿主文件完好。
  2. `CH-02`：`cwd` 外写入被拒；诱导逃逸 / 提权 / 网络出站至未授权域名 → 全部失败关闭。
  3. `CH-03`：`signal` 取消或超时 → 子进程树被回收、返回明确终止态，无孤儿进程。
  4. `CH-04`：注入 mock 宿主即可完成上述断言（**不要求本机容器运行时**）；未注入 `ContainerHostPort` 时 `requireControlledDispatch()` 对 `SANDBOX_ENFORCED` 仍拒绝派工。
* **FAIL**（R-8）：以普通本地子进程冒充「沙箱」（违反 §4.2.3 P-17）；任一越界挂载 / 逃逸 / 越权网络负例可用；单测强依赖真实容器运行时（无容器即红）；未注入宿主即静默放行派工或降级到无网关执行；为达成接线放宽鉴权 / Demo Origin / 网关写范围。
* **关键文件**：`daemon/worker/sandbox/container-host.ts`（新）、`daemon/worker/worker-dispatch.ts`（改）、`tests/unit/container-host.test.ts`（新）、`daemon/worker/worker-adapter.interface.ts`（只读复用）、`src/lib/contract.schema.ts`（只读复用）
* **估算**（R-11）：**M**（单一容器运行时层，mock / stub 可测，不触真实实测）

---

<a id="task-w.5c-iii"></a>

#### 【Task W.5c-iii】OpenHands 适配器 + 真实容器实测 + `verified_on` `[COMPLETED]`

> **归档注记（2026-11-02 · P-122）**：本卡已 COMPLETED（[#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a`，squash merge；分支 `feat/w5ciii-openhands-real`，本地三提交 `d23b185` 主体 + `00c0494` 证据面消费见证 + docs 开工声明）。完整交付记录（围栏档 ruling A / `DockerContainerHost` / OpenHands 适配器注册 / 派工即入沙箱 / `SandboxWitness` + `resolveEvidenceControlMode` 证据面消费）、环境自证、验收数据、**4 条挂账**（`openhandsControlMode` 降级分支是防呆非废码、`durationMs ??` 死代码、`EXPLICIT_TARGETS` 逐目标出站需 netns/iptables 级实现、**`runWorker` outcome 的 `worker_control_mode` 仍为声明档未校正——两个记录点只有证据面被校正**）与「不宣称端到端闭环」见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4k（锚点 `#task-w.5c-iii`）。本处保留原始卡文与施工期「开工声明」以存追溯，**均不再作为施工依据**。**环境前置已解除**：下引开工声明中 P-116「仅 Docker 客户端、无守护进程」为 2026-11-01 状态；2026-11-02 环境验证全绿（Docker Desktop 29.6.1 daemon 可达 + 镜像按摘要固定拉取 + `STAGENT_REAL_OPENHANDS=1` 实测 11/11），本卡已走完 `[BLOCKED] → 施工 → COMPLETED` 全段。**`W.5c` 容器隔离链路（档位 → 运行时围栏 → 真实宿主 + 实测）至此三段贯通。**

> **开工声明（2026-11-02 · 施工期状态，**非**完成回写；保留原文作溯源，完成回写见上方归档注记与 P-122）**：环境硬前置已满足并经实测坐实——Docker Desktop **29.6.1 / Engine 29.6.1 / containerd v2.2.5 / runc 1.3.6**，`docker info` 服务端可达（非仅客户端），OpenHands 镜像 `ghcr.io/all-hands-ai/openhands@sha256:00968de7…fa6`（1.83GB）已拉取，容器内 `openhands 0.59.0` / `python 3.13.7`、headless CLI `python -m openhands.core.main --help` 可用。施工分支 `feat/w5ciii-openhands-real`。实测证据见 [`../reports/W5c-iii-真实容器实测-2026-11-02.md`](../reports/W5c-iii-真实容器实测-2026-11-02.md)。**矩阵 / index 仍停留在 `[BLOCKED]` 属回写前状态**，待本卡完成时按 P-12x 统一同步，不在施工期半同步。

> **拆卡立卡（2026-11-02 · P-118 · 经 Tina 授权）**：母卡 `TASK-W.5c` 第三张。**`[BLOCKED · 等容器环境]`**：硬前置为本机容器运行时可用 + `STAGENT_REAL_OPENHANDS=1`。P-116 只读核查已坐实本机**仅装 Docker CLI 29.6.1、无守护进程**（`~/.docker/run/docker.sock` 与 `/var/run/docker.sock` 均不存在，无 `dockerd` / `containerd` / `colima` / `lima` 进程，`podman` / `nerdctl` / `colima` / `lima` 未装，环境变量未设置）——**此时开工 `OS-06` 真实实测会空转**，须先备妥容器运行时并确认 daemon 可达。**（P-122 现行口径：容器运行时已于 2026-11-02 备妥并验证通过——Docker Desktop 29.6.1 daemon 可达、镜像按摘要固定拉取、`STAGENT_REAL_OPENHANDS=1` 实测 11/11；本卡已 COMPLETED（#87/`2313597a`），上句 `[BLOCKED]` 为立卡当日状态，保留原文作溯源。）**

* **任务编号**：`TASK-W.5c-iii`
* **任务名称**：OpenHands 适配器、真实容器隔离实测与 `verified_on` 绑定
* **对应规格**（R-1）：[`system-architecture.md`](./system-architecture.md) §9.1、§4.2.3 P-17、§2.7；[`../adr/0001-target-user-positioning.md`](../adr/0001-target-user-positioning.md) **ADR-0001**、[`../adr/0003-worktree-capability-boundary.md`](../adr/0003-worktree-capability-boundary.md) **ADR-0003**；母卡 `TASK-W.5c` 范围第 4/5/6 条与 PASS `OS-06` / `OS-07`；先例 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4a `TASK-W.5a` 黑盒实测纪律
* **前置依赖**（R-3）：**硬** `TASK-W.5c-i`（**`[COMPLETED]`** · #81/`c3e75cc`）、`TASK-W.5c-ii`（**`[COMPLETED]`** · #85/`648be31`，围栏逻辑与 `ContainerHostPort` 端口已就位，本卡只绑真实宿主并**把 `runInSandbox` 接进执行面**）——DAG 边 `i→iii`、`ii→iii`；**环境硬前置**：本机容器运行时可用（daemon 可达）+ `STAGENT_REAL_OPENHANDS=1`（**P-116 曾坐实不满足，故本卡一度 `[BLOCKED]`；P-122 现行口径：2026-11-02 已满足并实测通过，见归档注记**）；`TASK-W.6`（**COMPLETED** · [#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`）
* **优先级**：P3 · **NON_BLOCKER**
* **状态**：`[COMPLETED]`（2026-11-02 · [#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a`；状态轨迹 `[BLOCKED · 等容器环境]` → `[IN_PROGRESS · 施工中]`（Tina 解除阻断）→ 完成。**完成 ≠ 端到端闭环**：模型驱动链路因出站 `DENY` 未实测，见 completed §3.4k「未宣称」）
* **对照痛点（代码事实）**（R-4）：`daemon/worker/cli-host/openhands-adapter.ts` 与 `tests/e2e/openhands-isolation.real.test.ts` **均尚不存在**；`daemon/worker/default-worker-registry.ts::createDefaultWorkerRegistry()` 当前仅登记内置 Managed AI（`GATEWAY_ENFORCED`）与 Claude Code worker（`UNCONTROLLED_EXTERNAL`），无 OpenHands 登记；`verified_on` 字段由 `W.5c-i` 落地但今日无任何实测值可填（`src/lib/chat-events.ts::ChatAdapterInfo.verified_on` 空串语义 = 未实测）。
* **一句话目标**（R-2）：OpenHands Worker 在真实容器内跑通越界挂载 / 逃逸负例并失败关闭后，`verified_on` 按实测版本与日期填写、登记为 `SANDBOX_ENFORCED`；未通过者仅登记 `UNCONTROLLED_EXTERNAL`（仅 Vibe、UI 显示「未受控」）。
* **ADR 修订**（R-9）：**无冲突、不修订**。强化 ADR-0001 强隔离控制面；须满足 §4.2.3 P-17 与 ADR-0003 边界，不宣称「绝对受控」。
* **采用的默认值**（R-10）：凭证途径**仅限 API Key**（`[用户已确认 · 2026-10-20]` 全部 Worker 模式统一，不使用官方登录 / 订阅会话）；env 白名单沿用 W.5a 纪律；实测报告措辞限定「通过已知探测集」，证据归档 `docs/reports/`。无未决产品问题。
* **范围**（R-5）：
  1. 新建 `daemon/worker/cli-host/openhands-adapter.ts`：实现 `CodingWorkerAdapter`（`run(input, signal)`），能力声明 9 项 + `known_limitations` 如实写容器边界；凭证仅 API Key。
  2. 新建 `tests/unit/openhands-sandbox.test.ts`（确定性负例）与 `tests/e2e/openhands-isolation.real.test.ts`（真实容器，**仅 `STAGENT_REAL_OPENHANDS=1` 且 daemon 可达时运行**）；实测证据归档 `docs/reports/`。
  3. `daemon/worker/default-worker-registry.ts::createDefaultWorkerRegistry()`：登记 OpenHands 为 `SANDBOX_ENFORCED`（**仅登记**；未经实测不得挂进受控派工面，派工门禁按 W.6 / `W.5c-ii` 语义）。
  4. 实测通过后按 CLI 版本 + 日期填 `verified_on`；未通过则留空并登记 `UNCONTROLLED_EXTERNAL`。
* **非目标**（R-6）：不重做 `runInSandbox` 逻辑层（归 `W.5c-ii`，本卡只绑定真实宿主）；不做 W.5b cursor-agent 实测（仍各卡）；不实现 W.7 自助注册 / 自动探测包；不改右栏 `role:"partner"` 只读白名单（J.1）；不宣称「绝对受控」、不做多 Agent 并行 DAG（v0.2 RFC）；不改鉴权 / Demo Origin。
* **不变声明**（R-12）：**不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围**（ADR-0001 纪律）。`SANDBOX_ENFORCED` 不放宽 `GATEWAY_ENFORCED` 既有门禁；`UNCONTROLLED_EXTERNAL` 仍不得作为受控 / 可合并证据。
* **验收（PASS）**（R-7）：`tests/unit/openhands-sandbox.test.ts` + `tests/e2e/openhands-isolation.real.test.ts`，逐条可译为 `it(...)`：
  1. `OH-01`（原 `OS-03`）：真实容器越界挂载负例——诱导挂载宿主根 / `.git` / `.stagent` 保护区，容器拒绝且宿主文件完好。
  2. `OH-02`（原 `OS-04`）：容器逃逸负例——诱导 escape / 提权 / 网络出站至未授权域名，全部失败关闭。
  3. `OH-03`（原 `OS-05`）：`runInSandbox()` 仅见任务 Worktree，`cwd` 外写入被拒。
  4. `OH-04`（原 `OS-06`）：`STAGENT_REAL_OPENHANDS=1` 实测负例通过后 `verified_on` 非空（CLI 版本 + 日期）；未通过则空、登记 `UNCONTROLLED_EXTERNAL`。
  5. `OH-05`（原 `OS-07`）：能力声明对账——`known_limitations` 非空且如实，`filesystem_permissions` / `command_permissions` 与实测一致。
* **FAIL**（R-8）：环境前置未满足（daemon 不可达 / `STAGENT_REAL_OPENHANDS` 未设）却开工或宣称实测通过；普通本地子进程自称沙箱（违反 §4.2.3 P-17）；任一越界挂载 / 逃逸负例可用；**`SANDBOX_ENFORCED` 派工未走 `runInSandbox`**（P-121 补入：`W.5c-ii` 只交付「给工厂用」的注入端口，`runInSandbox` 生产零调用，执行面仍可绕过容器走本地——本卡必须把它接进派工执行链并断言「派工即入沙箱」，否则「有档位、有围栏、无执行」）；未实测即填 `verified_on` 或标受控；凭证走官方登录 / 订阅会话；为达成实测放宽鉴权 / Demo Origin / 网关写范围；本卡仍 `[BLOCKED]` 却标本卡完成。
* **关键文件**：`daemon/worker/cli-host/openhands-adapter.ts`（新）、`daemon/worker/sandbox/container-host.ts`（改 · 绑定真实宿主）、`daemon/worker/default-worker-registry.ts`（改）、`tests/unit/openhands-sandbox.test.ts`（新）、`tests/e2e/openhands-isolation.real.test.ts`（新）、`docs/reports/`（新 · 实测证据）、`src/lib/chat-events.ts`（只读核对）
* **估算**（R-11）：**M**（单一「适配器 + 实测」层；真实实测耗时取决于容器环境，环境前置为硬阻断）

---

<a id="task-c.23"></a>

#### 【Task C.23】`check playtest` 接入北极星合同验收档 `[COMPLETED]`

> **归档注记（2026-11-02 · P-119）**：本卡已 COMPLETED（[#82](https://github.com/he18718143986-design/IDE/pull/82)/`a5223fb`，squash merge；分支 HEAD `1d84f52`，A 卡（#81）合入后 rebase 为 `6f819dd`）。完整交付记录、残余边界与挂账（共 3 条，含 `scopePlanToContractScope()` 不接收 `references` 故接线落在确认覆盖路径、非北极星剔除调用方自带 `playtest` 属收紧、不宣称端到端闭环）见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4i（锚点 `#task-c.23`）。本处保留原始卡文以存追溯，不再作为施工依据。**ruling 3 裁决至此兑现**（装配接线完成；判定源仍为 L.17b 交付物、本卡未动）。

> **立卡（2026-11-02 · P-118 · 经 ruling 3 裁决落盘）**：ruling 3（2026-11-02 · P-114 落盘，原文见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4f、[`development-tasks-changelog.md`](./development-tasks-changelog.md) P-114、ledger [`../ledger/consistency-audit.md`](../ledger/consistency-audit.md) P-114 落笔）此前明确「实现属小卡，另行立卡或挂账」；本卡即为该实现卡，**P-114 时未立卡系避免未达 DoR 的薄卡债（DOR-3 同款），本次按 R-1～R-12 写全后立卡**。估算 **S**，不宣称端到端闭环（`check playtest` 判定源已由 L.17b 交付，本卡只做装配接线）。

* **任务编号**：`TASK-C.23`
* **任务名称**：北极星合同自动附加 `check playtest` 验收命令
* **对应规格**（R-1）：ruling 3 裁决（2026-11-02 · P-114，见上引三处）；[`../scheme.md`](../scheme.md) **dec-12**（北极星「一模一样」= 用户对话试玩 + 结构化证据桩，AI 不代判、禁像素/DOM 机器比对）、**REJ-009**；[`development-tasks-completed.md`](./development-tasks-completed.md) §3.4f（L.17b 交付的 `check playtest` 判定源 `daemon/supervisor/preview/playtest-guard.ts`）；[`task-card-standard.md`](./task-card-standard.md) R-1～R-12
* **前置依赖**（R-3）：`TASK-L.17b`（**COMPLETED** · [#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`，`check playtest` 命令与判定源已交付）；ruling 3 裁决已落盘（P-114）
* **优先级**：P3 · **NON_BLOCKER**（不阻断 M5 主序，主序已收官）
* **状态**：`[COMPLETED]`（2026-11-02 · [#82](https://github.com/he18718143986-design/IDE/pull/82)/`a5223fb`）
* **对照痛点（代码事实）**（R-4）：
  1. 合同装配唯一入口 `src/lib/contract.schema.ts::createContractDraft()`（约 :691）在 :764-782 装配 `verification_spec.commands`：`params.commands` 有值则原样采用、否则回落默认 `{alias:"test", executable:"npm", args:["test"]}`；**此处不读 `params.references`**（`references` 由 :712-714 透传、schema 定义于 :536），故带参考站的北极星合同今日不会自动带 `playtest` 命令。
  2. `src/lib/journey/confirm-scheme-contract.ts::buildConfirmContract()`（约 :31）调用 `createContractDraft()` 后，在 :108-124 以 `softwareContractSchema.parse({...draft, verification_spec: {...}})` **重新覆盖** `verification_spec.commands`（取 `projected.verification_spec.commands`，来源 `src/lib/journey/scope-plan.ts::scopePlanToContractScope()` 约 :393）——**只在 `createContractDraft` 单边接线会被该路径覆盖而失效，漏改即 FAIL**。
  3. `bin/stagent.ts` 的 `check playtest` 子命令已注册（L.17b）；`daemon/supervisor/preview/playtest-guard.ts::evaluatePlaytestGuard()` 为单一判定源，**本卡不得改动判定逻辑**。
* **一句话目标**（R-2）：带 `references[]` 的北极星合同装配后，`verification_spec.commands` 自动含 `{alias:"playtest", executable:"stagent", args:["check","playtest","<contract_id>"]}`，使试玩认可成为合并门禁；非北极星合同不受影响，重复装配不产生重复命令。
* **ADR 修订**（R-9）：**无冲突、不修订**。落实 dec-12 配置面延伸，不改写 dec-12 / dec-13 判定口径、**不复活 REJ-009**（不引入像素/DOM 机器比对）；不触碰 ADR-0001 控制面。
* **采用的默认值**（R-10）：ruling 3 裁决值（唯一口径）：命令 `{alias:"playtest", executable:"stagent", args:["check","playtest","<contract_id>"]}`，`args` 内 `contract_id` 为**服务端装配的实际合同 id**、不接受调用方传入；北极星判据 = `references[]` 非空；幂等 = 已存在同 `alias:"playtest"` 命令时不重复追加。依赖的 OQ 均已裁决，无未决产品问题。
* **范围**（R-5）：
  1. `src/lib/contract.schema.ts::createContractDraft()`：当 `params.references` 非空时，在 `verification_spec.commands` 自动附加 `playtest` 命令（幂等）；`references` 为空 / 未传时不附加；`params.commands` 已含 `alias:"playtest"` 时不重复追加。
  2. `src/lib/journey/confirm-scheme-contract.ts::buildConfirmContract()` 与 `src/lib/journey/scope-plan.ts::scopePlanToContractScope()`：**覆盖式装配路径同步接线**，保证 scheme 确认路径产出的北极星合同同样带 `playtest` 命令（与 createContractDraft 口径一致、幂等）。
  3. 新建 `tests/unit/contract-playtest-wiring.test.ts`：三用例（见 PASS）。
* **非目标**（R-6）：不改 `check playtest` 判定源 / 门禁判定逻辑（L.17b 已交付）；不做 `CompareView` UI 路由挂载或用户原话采集 UI（L.17b 已声明未接线，另属后续）；不动右栏 `role:"partner"` 只读白名单；不改 dec-12 / dec-13 判定口径、不复活 REJ-009；不改鉴权 / Demo Origin。
* **不变声明**（R-12）：**不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围**（ADR-0001 纪律）。本卡只增验收命令装配，不放宽任何既有门禁；`playtest` 命令的 `args` 以服务端装配的 `contract_id` 为准，防伪造。
* **验收（PASS）**（R-7）：新建 `tests/unit/contract-playtest-wiring.test.ts`，逐条可译为 `it(...)`：
  1. `PW-01`：**附加**——`createContractDraft({ references: ["https://…"], ... })` 产出的 `verification_spec.commands` 含 `{alias:"playtest", executable:"stagent", args:["check","playtest", <实际 contract_id>]}`；`args[2]` 等于返回合同的 `contract_id`。
  2. `PW-02`：**不附加**——无 `references` / `references: []` 的合同 `commands` 不含任何 `alias:"playtest"` 项，且不影响既有默认 `test` 命令。
  3. `PW-03`：**幂等**——调用方 `commands` 已含 `alias:"playtest"`，或对同一合同重复执行装配，结果中 `alias:"playtest"` 命令**恰好 1 条**、无重复；scheme 确认路径（`buildConfirmContract` / `scopePlanToContractScope`）产出同样满足 PW-01～PW-03。
* **FAIL**（R-8）：非北极星合同（无 `references[]`）被附加 `playtest` 命令；`playtest` 命令可被跳过 / 伪造通过（如 `args` 由调用方传入 `contract_id`、或缺省时静默判 PASS）；重复装配产生多条 `playtest` 命令；只改 `createContractDraft`、漏改 scheme 确认覆盖路径导致北极星合同实际不带该命令；改动 `playtest-guard.ts` 判定逻辑或复活 REJ-009 机器比对；为达成接线放宽鉴权 / Demo Origin / 网关写范围。
* **关键文件**：`src/lib/contract.schema.ts`（改）、`src/lib/journey/confirm-scheme-contract.ts`（改）、`src/lib/journey/scope-plan.ts`（改）、`tests/unit/contract-playtest-wiring.test.ts`（新）、`bin/stagent.ts`（只读复用）、`daemon/supervisor/preview/playtest-guard.ts`（只读复用）
* **估算**（R-11）：**S**（单一装配层 + 单组测试，判定源与 UI 均不在本卡范围）

---

<a id="task-w.6"></a>

#### 【Task W.6】AdapterRegistry 接线与 Claude Code Worker 派工 `[COMPLETED]` · **NON_BLOCKER**（ledger **DLV-3**）

> **归档注记（2026-11-02 · P-113）**：本卡已 COMPLETED（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，squash merge；分支阶段 HEAD `638129d`）。完整交付记录、残余边界与挂账见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4g（锚点 `#task-w.6`）。本处保留原始卡文以存追溯，不再作为施工依据。**口径澄清**：卡面验收原写「Claude Code worker 可受控派工」，实现按红线落地为「内置 Managed AI（`AiWorker` 封装）以 `GATEWAY_ENFORCED` 受控派工 + Claude Code worker 仅登记为 `UNCONTROLLED_EXTERNAL`、不挂派工工厂」——Claude Code worker 未作为受控执行器进入派工路径（经 Tina 2026-11-02 审阅认可，详见 completed §3.4g）。

* **任务编号**：`TASK-W.6`
* **任务名称**：把 `AdapterRegistry` 接到派工路径；Claude Code `role: "worker"` 可受控派工
* **对应规格**：架构 / W.1 适配器抽象；ledger **DLV-3**；[`../ledger/README.md`](../ledger/README.md) DLV-3；审计依据：Worker 仅 OpenAI `AiWorker`
* **前置依赖**：`TASK-W.1`（COMPLETED）、`TASK-W.5a`（COMPLETED · Claude Code 适配器已有）
* **优先级**：P3 · **NON_BLOCKER**（M2 不依赖；**不阻断** `TASK-L.16`；不与 W.5b/c 抢位）
* **状态**：`[COMPLETED]`（2026-11-02 · [#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，squash merge；分支阶段 HEAD `638129d`；**M5 主序收官后首张落完的债卡**）
* **对照痛点（代码事实）**：`daemon/worker/adapter-registry.ts::AdapterRegistry` 已实现 register/get/requireControlled，但 `daemon/pipeline/orchestrator.ts` 派工组装真实 `AiWorker` + `OpenAiWorkerClient`（约 L1376–L1509）；`ClaudeCodeAdapter` 在 `daemon/server.ts` 主要用于右栏 `partner`，**未**经 Registry 作为受控 Worker 进入派工。
* **一句话目标**：派工可按合同/设置选择已注册的受控适配器；至少 Claude Code worker 角色能走 Gateway 受控路径，不再写死只认 OpenAI `AiWorker`。
* **范围**：
  1. Daemon 启动或项目打开时注册默认适配器进 `AdapterRegistry`（含 OpenAI/`AiWorker` 封装与 Claude Code `worker`）。
  2. orchestrator 派工：`requireControlled(adapterId)`（或等价）取代硬编码 `new AiWorker(...)`；缺注册/非受控 → 明确错误码，不得静默降级到无网关执行。
  3. 配置面：设置「高级」或合同元数据可选 `adapter_id`（最小可用；UI 可糙）。
  4. 测试：`tests/unit/adapter-registry-dispatch.test.ts`：注册 Claude worker → 派工命中；未注册 / `UNCONTROLLED_EXTERNAL` → 拒绝。
* **非目标**：不做 W.5b cursor-agent / W.5c OpenHands 实测（仍各卡）；不改右栏 partner 只读白名单（J.1）；不宣称多 Agent 并行 DAG（v0.2 RFC）。
* **不变声明**：Gateway 写范围 / Demo Origin / 鉴权：**不变**；`UNCONTROLLED_EXTERNAL` 仍不得当受控证据。
* **验收（PASS）**：Registry 接线后至少一条非 OpenAI 受控适配器可被派工测试命中；负例拒绝成立。
* **FAIL**：Registry 仍无生产调用却标完成；或绕过 Gateway 直改主树。
* **关键文件**：`daemon/worker/adapter-registry.ts`、`daemon/pipeline/orchestrator.ts`、`daemon/worker/cli-host/claude-code-adapter.ts`、`daemon/server.ts`（注册点）、新测
* **估算**：M
* **台账**：ledger **DLV-3** → 已立卡 `TASK-W.6`。

---

<a id="task-w.7"></a>

#### 【Task W.7】Worker 自助注册与自动验证 `[COMPLETED]` · **NON_BLOCKER**

> **归档注记（2026-11-02 · P-123）**：本卡已 **COMPLETED**（[#89](https://github.com/he18718143986-design/IDE/pull/89)/`be480bb`，squash merge）。卡正文与施工期状态**保留原文作溯源**；交付内容、验收逐条明细（含 **PASS 3 未达成**）、6 条挂账与「不宣称」边界见 [`development-tasks-completed.md`](./development-tasks-completed.md#task-w.7) §3.4l。**读本卡注意**：正文所述「升格 `GATEWAY_ENFORCED`」与实际交付（升格到 `SANDBOX_ENFORCED`、且无执行器故 `dispatchable:false`）的差异已在 completed 挂账 1 如实登记，属**结构性边界**而非缺陷。

* **任务编号**：`TASK-W.7`
* **任务名称**：前端自助注册任意 Worker；默认 `UNCONTROLLED_EXTERNAL`；自动探测通过后升格 `GATEWAY_ENFORCED`
* **对应规格**：架构 / W.1 适配器抽象；`daemon/worker/worker-adapter.interface.ts`；`src/lib/contract.schema.ts::workerSpecSchema`；先例 W.5b/c 人工实测 → 本卡产品化
* **前置依赖**：**硬** `TASK-W.6`（Registry 进派工，否则测完无池可进；**W.6 已于 2026-11-02 COMPLETED（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`），硬前置已解除**）；**软** `TASK-W.5c`（探测沙箱复用/对齐其容器隔离基建；**排程上 W.5c 为下一张，优先于本卡**）
* **优先级**：P3 · **NON_BLOCKER**（**不阻断** `TASK-L.16`；**不抢** W.5b/c 实测窗口；与 W.5b/c **不互斥**——本卡落地后 W.5b/c 可作为首批真实用例回归基准）
* **状态**：`[COMPLETED]`（状态轨迹：`[NEW_TASK]` → 施工（纯代码 PR，readiness review 报三处卡正文与代码脱节并按代码事实校正）→ **完成**（[#89](https://github.com/he18718143986-design/IDE/pull/89)/`be480bb`，2026-11-02；见 completed §3.4l）。**以下为施工期状态记录，保留原文作溯源**（硬前置 W.6 已 COMPLETED，就绪障碍解除；排程上 `TASK-W.5c` 系列为前序——三张子卡已于 2026-11-02 **全部 COMPLETED**（#81 / #85 / #87），**本卡即 Sprint 首要**，尚未开工、不宣称就绪以外的东西）。**邻卡 DoR / 状态（2026-11-02 · P-122 同步）**：`W.5c` 已于 P-115 按 DoR 重写达标、并经 P-118 授权拆为 `W.5c-i`（**`[COMPLETED]`** · #81/`c3e75cc`）/ `W.5c-ii`（**`[COMPLETED]`** · #85/`648be31`）/ `W.5c-iii`（**`[COMPLETED]`** · [#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a`，见 completed §3.4k）三张子卡，母卡标 `[SPLIT]` 保留追溯；`W.5b` 的 DOR-3 正文重写债仍在。
* **对照痛点（代码事实）**：
  1. 三层可扩展接口已在：`daemon/worker/worker-adapter.interface.ts::CodingWorkerAdapter`（`AdapterCapabilityDeclaration` 9 项 + `AdapterRejectionCode`）、`daemon/worker/adapter-registry.ts::AdapterRegistry`（`register` / `get` / `requireControlled`）、`src/lib/contract.schema.ts::workerSpecSchema`（`adapter_id` + `control_mode`；**三值** `GATEWAY_ENFORCED|SANDBOX_ENFORCED|UNCONTROLLED_EXTERNAL`，P-121 同步：原二值经 `W.5c-i` 扩三值、`W.5c-ii` 起派工门禁按容器宿主可用性判定）。
  2. ~~派工仍硬编码 `new AiWorker(...)`（`daemon/pipeline/orchestrator.ts`）~~ —— **已由 W.6（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`）改造为经 `AdapterRegistry` → `requireControlledDispatch` 派工工厂接线，本痛点已消除**；本卡不代替 W.6。
  3. 今日无「前端注册 → 自动探测 → 按结果分档」产品路径；W.5b/c 仍是人工黑盒实测卡。
* **一句话目标**：用户可在设置页添加任意 Worker；默认只能当未受控参考；只有通过内置探测包的才升格受控并被 `requireControlled` 命中。
* **范围**：
  1. **两级注册语义**：`POST /api/workers` 接受 `adapter_id` + 启动命令 + 能力声明；**默认且唯一可直写档**为 `UNCONTROLLED_EXTERNAL`（仅 Vibe/参考，**不得**产出合同证据）。升格 `GATEWAY_ENFORCED` **必须**经自动探测通过；**禁止「填表即受控」**。
  2. **自动探测任务包**（daemon 内置 fixture，四类确定性断言 + 一条派工见证校验）：
     - 文件围栏：诱导越权写；扫主树与 `.stagent/records/`，越权须失败关闭。
     - 命令围栏：白名单外命令须被拒。
     - 证据完整性：diff / 写操作必须经 Gateway 工具集，绕过即失败。
     - 能力声明对账：声明 `TOOL_INTERCEPTION_SUPPORTED` 等须实测命中，声明未兑现 → 不得升格。
     - **派工见证校验（P-122 新增 · 由 `W.5c-iii` 衍生）**：`SANDBOX_ENFORCED` 派工**是否带 `SandboxWitness`**（`host_kind` / `via` / `exit_code` / `duration_ms` / `worktree_root`）。**缺见证 = 未入箱 = 不得升格、不得记受控档**。判定**直接复用** `daemon/worker/worker-adapter.interface.ts::resolveEvidenceControlMode(declared, witness)`（声明 `SANDBOX_ENFORCED` + 无见证 → `UNCONTROLLED_EXTERNAL`；其余档位原样），**不要另造判据**——该函数已是「记实不记名」的唯一强制点，另造口径会分叉。
     - 输出报告：探测项清单 + 结论；措辞限定为「**通过已知探测集**」，**不得**写「绝对受控」。
  3. **探测沙箱前置**：探测在隔离环境执行（临时 worktree + 无网络 + 超时）；复用/对齐 W.5c 容器隔离基建。**显式前置说明（实现时必做，漏改即 FAIL）**：把 `SANDBOX_ENFORCED` 扩进 **两处**枚举——`daemon/worker/worker-adapter.interface.ts` 与 `src/lib/contract.schema.ts` 各一处；只改单边 → schema 与注册侧不一致。
  4. **验证结果绑定版本**：`verified_on` 绑定适配器版本号/命令指纹；版本或指纹变更 → **自动降级**回 `UNCONTROLLED_EXTERNAL` 待重验；定期重测机制留接口（本卡可只留 hook/类型，不实现调度器）。
  5. **路由与 UI**：
     - `POST /api/workers`：注册，强制 `UNCONTROLLED_EXTERNAL`。
     - `POST /api/workers/:id/verify`：异步启动探测；另提供报告查询路由（如 `GET /api/workers/:id/verify` 或等价）。
     - 前端 Worker 设置页 + 「验证」按钮。
     - 命名空间 **不得**与 `/api/design/*`、`/api/knowledge/*` 冲突（用 `/api/workers*`）。
  6. 测试：`tests/unit/worker-self-serve-verify.test.ts`（或等价）：默认注册档、四类探测断言可跑、通过升格且 `requireControlled` 命中、失败留 UNCONTROLLED 附报告、版本变更降级；负例：表单直进受控、无沙箱探测、报告「绝对受控」、枚举单边。
* **非目标**：不代替 W.6 Registry 接线；不在本卡内完成 W.5b/c 人工实测正文重写（DOR-3）；不宣称探测=绝对安全；不做通用第三方商店/市场；不改鉴权 / Demo Origin。
* **不变声明**：Gateway 写范围 / Demo Origin / 鉴权 / 点亮三证：**不变**；`UNCONTROLLED_EXTERNAL` 仍不得当受控合同证据；报告不得宣称「绝对受控」。
* **验收（PASS）**：
  1. 注册默认且仅能落 `UNCONTROLLED_EXTERNAL`。
  2. 探测包四类断言可在沙箱内跑通（正/负例）。
  3. 通过者升格 `GATEWAY_ENFORCED` 并被 `AdapterRegistry.requireControlled` 命中。
  4. 失败者留 `UNCONTROLLED_EXTERNAL` 且附探测报告。
  5. `verified_on` 版本/指纹变更后自动降级待重验。
  6. **（P-122 追加）派工见证校验**：`SANDBOX_ENFORCED` 派工缺 `SandboxWitness` → 证据与探测结论一律记 `UNCONTROLLED_EXTERNAL`（复用 `resolveEvidenceControlMode`），升格判定不成立；带见证（`via: "exit"` 且 `exit_code === 0`）才可进升格链路。
* **FAIL**：表单/API 直进受控档；探测无沙箱直接跑主树；报告宣称「绝对受控」；`SANDBOX_ENFORCED` 只改 `worker-adapter.interface.ts` 或只改 `contract.schema.ts` 单边；**探测包不看 `SandboxWitness` 就把 `SANDBOX_ENFORCED` 判为受控（P-122 追加）**；未满足就绪条件（硬前置 `W.6` 未 COMPLETED / DoR 未达标）却标本卡完成。
* **关键文件**：`daemon/worker/worker-adapter.interface.ts`、`daemon/worker/adapter-registry.ts`、`src/lib/contract.schema.ts`、`daemon/server.ts`（`/api/workers*` 注册）、新 `daemon/worker/verify/*`（探测包+沙箱）、前端 Worker 设置页组件、新测
* **估算**：L（实现时宜再拆：枚举扩面 / 探测包 / API+UI；本卡先立产品口径）
* **台账**：ledger **DLV-3** 加注「自助注册/自动验证已立卡 W.7」；W.5b/c 挂账讨论处注明「W.7 落地后可作回归用例」。

---


<a id="task-w.9"></a>
#### 【Task W.9】自注册/外部 Worker 执行器接线 `[SPLIT]`

* **任务编号**：`TASK-W.9`
* **任务名称**：自注册/外部 Worker 执行器接线
* **对应规格（R-1）**：
  * 架构规范 [`system-architecture.md`](./system-architecture.md) §9.1（`worker_spec` 目标数据模型与受控派工机制）、§4.2.3 P-17（沙箱与外部 CLI 隔离）、§0.6.1（执行模式）；
  * 核心接口 [`daemon/worker/worker-adapter.interface.ts`](../../daemon/worker/worker-adapter.interface.ts)（`CodingWorkerAdapter` 规范、`resolveEvidenceControlMode`）；
  * 注册与门禁 [`daemon/worker/adapter-registry.ts`](../../daemon/worker/adapter-registry.ts)（`AdapterRegistry`、`promoteControlMode`）；
  * 派工中枢 [`daemon/worker/worker-dispatch.ts`](../../daemon/worker/worker-dispatch.ts)（`requireControlledDispatch`、`WorkerDispatchFactory`、`WorkerDispatchContext`）；
  * 历史先例与挂账闭环：
    * `TASK-W.6`（completed §3.4g）：Registry 挂派工工厂与 `requireControlledDispatch()` 门禁；
    * `TASK-W.7`（completed §3.4l 挂账 1）：PASS 3 未达成——「升格 ≠ 可派工」结构性边界（自注册 worker 无 `run()` / 派工工厂导致 `dispatchable:false`）；
    * `TASK-W.5b`（completed §3.4m 挂账与 P-125 注记）：`promoteControlMode` 仅校验指纹非空字符串形态、自造指纹可升格，以及 `buildLaunch` 强依赖 `STAGENT_MCP_URL` 强抛硬绑定；
    * `TASK-W.5c-iii`（completed §3.4k）：`DockerContainerHost`、`SandboxWitness` 与 `resolveEvidenceControlMode` 记实不记名强制执行点；
    * ADR-0001 / ADR-0003 / ADR-0014。
* **前置依赖（R-3）**：
  * `TASK-W.6`（COMPLETED · #74/`b5d8c53`，Registry 挂派工工厂与门禁架构在位）；
  * `TASK-W.7`（COMPLETED · #89/`be480bb`，Worker 自助注册、五类探测包与 `promoteControlMode` 基础在位）；
  * `TASK-W.5b`（COMPLETED · #92/`bdac805`，cursor-agent 声明与 `buildLaunch()` 契约面在位）；
  * `TASK-W.5c-iii`（COMPLETED · #87/`2313597a`，`DockerContainerHost`、OpenHands 适配器与 `SandboxWitness` 链路在位）；
  * **全前置均为 COMPLETED**。
* **优先级**：拆分母卡（P-134 后三子卡均已完成；仅作拆分期规划追溯）
* **状态**：**`[SPLIT]`**（2026-11-02 · P-128 经 Tina 授权拆为 `W.9a` / `W.9b` / `W.9c`；本卡保留追溯，不再作为施工依据）
> **实质闭合注记（2026-11-03 · P-134）**：W.9a、W.9b、W.9c 三张子卡均已 COMPLETED；母卡继续保留 `[SPLIT]` 作为拆分追溯，不再作为施工依据。
* **对照痛点（代码事实，R-4）**：
  1. `daemon/worker/adapter-registry.ts::promoteControlMode()`（`:176-193`）：只校验 `typeof request.report_fingerprint === "string" && fingerprint.trim().length > 0`。只要调用方传入非空伪造指纹字符串，且 `declaration` 满足校验，即可将外部适配器强行升格，完全未校验该指纹是否对应已落盘、通过验收的真实探测报告，**自造指纹即可升格（W.5b 挂账）**；
  2. `daemon/worker/verify/worker-registration-service.ts` 与 `daemon/worker/verify/worker-registration.ts`：自注册 Worker 只写入 `.stagent/workers.json`，在 `createDefaultWorkerRegistry()` 与派工链路中没有对应的适配器实例与工厂挂接机制（`registry.registerDispatchFactory` 零调用），且自注册对象的 `run()` 缺失，导致升格后 `requireControlledDispatch()` 恒抛 `E_ADAPTER_NO_DISPATCH_FACTORY`，前端展示 `dispatchable: false`（**W.7 挂账 1**）；
  3. `daemon/worker/cli-host/claude-code-adapter.ts::buildLaunch()`（`:247-251`）：当 `mcpServerUrl` / `STAGENT_MCP_URL` / `STAGENT_DAEMON_PORT` 不可用时，直接硬抛 `Error("Worker MCP endpoint URL is required under --strict-mcp-config...")`，导致仅需要纯 launch 契约（预览、离线构建、探测阶段参数校验）的调用方被意外卡死（**W.5b 挂账**）；
  4. `daemon/worker/cli-host/cursor-agent-adapter.ts::run()`（`:359-373`）：两段式直接抛错（先凭证 `Authentication required`，后 `cursor-agent adapter is not yet wired to an execution runtime`），无受控执行与产物收集闭环；
  5. `daemon/worker/default-worker-registry.ts::createDefaultWorkerRegistry()`（`:173-195`）：Claude Code 与 cursor-agent 仅作为能力载体登记为 `UNCONTROLLED_EXTERNAL` 且不挂派工工厂，缺少统一的外部 CLI 派工执行器桥接抽象。
* **一句话目标（R-2）**：自注册 Worker 与已登记外部适配器在通过探测升格后，编排器与注册中心能获取其真实的受控派工工厂与执行器（不再误判或抛 `E_ADAPTER_NO_DISPATCH_FACTORY`），外部 CLI 执行被约束在 Gateway 会话或容器沙箱内并产出见证，且无探测报告见证的伪造指纹无法升格受控。
* **ADR 修订（R-9）**：无冲突。严格遵守 ADR-0001（底层强隔离与防越权控制面不变）、ADR-0003（Worktree 能力边界）、ADR-0014（凭据隔离与绝不进日志/合同）。
* **采用的默认值（R-10）**：
  * dec-10（授权清单洗白拦截）、dec-12（试玩北极星人眼对照）、REJ-010（能力声明不得按宿主侧修辞口径造假）；
  * 缺少端点时的 `buildLaunch` 默认行为：标记 `mcp_status: "ENDPOINT_MISSING_PREVIEW_ONLY"` 并放行 launch 构建，不抛异常。
* **范围（R-5）**：
  1. **执行器接线与两类执行器抽象方案对比（卡内难点设计）**：
     * **形态 A（Gateway 会话注入型，如 claude-code / 内置 Managed AI）**：
       * *机制*：Worker 进程通过标准输入输出或 HTTP 与 Scoped Gateway MCP 工具集交互，文件读写与命令执行由 Gateway 内部拦截；
       * *优势*：细粒度工具级拦截（`WORKER_MCP_TOOLS`），严格对齐合同范围；
       * *约束*：必须有守护进程 MCP 端点或会话注入，无法直接约束无 MCP 协议能力的黑盒 CLI。
     * **形态 B（外部 CLI / 容器围栏型，如 cursor-agent / OpenHands / 外部 CLI）**：
       * *机制*：由 `buildLaunch(contract, options)` 组装 `argv`/`env`/工作区挂载目录，在独立容器（`runInSandbox` / `DockerContainerHost`）中运行，由宿主收集产物；
       * *优势*：可利用既有容器运行时的挂载/网络/资源边界隔离执行，与 Gateway 工具级拦截形成不同控制面；具体保障受宿主实现与策略覆盖范围限制，不宣称绝对隔离；
       * *约束*：无法进行工具级细粒度语义拦截，需在运行后做 diff 与产物对账，且必须出具 `SandboxWitness`。
     * *统一抽象方案选择*：提炼统一派工适配接口（`WorkerExecutionEngine`），内置 `GatewaySessionExecutor` 与 `SandboxedCliExecutor` 两种执行策略，适配器根据自身 `AdapterControlMode`（`GATEWAY_ENFORCED` vs `SANDBOX_ENFORCED`）分流绑定。
  2. **指纹边界重估（兑现 W.5b 挂账）**：
     * 重构 `AdapterRegistry.promoteControlMode()`，升格判定不再只检查非空字符串，而改为查询 `WorkerStore` 对应记录的真实探测报告；
     * 校验报告 `summary.passed === true`、报告中的 `target_mode` 与目标档一致，且报告记录中的指纹与当前适配器/版本真实匹配；
     * 凡缺少真实有效探测报告或未包含必需见证的，一律拒绝升格并抛出明确错误码（如 `E_PROBE_REPORT_NOT_FOUND` / `E_PROBE_REPORT_FAILED`）。
  3. **`buildLaunch` 端点依赖解耦（兑现 W.5b 挂账）**：
     * 修改 `claude-code-adapter.ts`（及相关外部适配器）的 `buildLaunch()`；
     * 当未提供 `mcpServerUrl` 且环境变量缺少 `STAGENT_MCP_URL` / `STAGENT_DAEMON_PORT` 时，不得直接抛错；
     * 降级行为：以 `mcp_status: "ENDPOINT_MISSING_PREVIEW_ONLY"` 构建离线/预览启动契约，在返回值元数据中明确标注，仅在真正尝试执行时才做严格校验。
  4. **证据面闭环与 `SandboxWitness` 消费**：
     * 执行器产物必须严格通过 `SandboxWitness` / `resolveEvidenceControlMode` 链路；
     * 即使声明档或注册档为 `SANDBOX_ENFORCED`，若执行时未产出合法有效的容器见证，最终证据一律记为 `UNCONTROLLED_EXTERNAL`；
     * 严防「声明档 vs 实录档」分叉。
  5. **Registry 派工工厂与 `requireControlledDispatch` 闭环**：
     * 为已注册但未挂工厂的外部适配器（如配置了沙箱宿主的 cursor-agent）或自注册 Worker 补齐执行工厂接入能力；
     * 确保升格成功的受控 Worker 在 `requireControlledDispatch()` 路径上可派工，消除 `dispatchable: false` 假象；
     * 无工厂的适配器依然严禁标记 `dispatchable: true`。
* **非目标（R-6）**：
  * 不做多 Agent DAG 协作与编排调度；
  * 不改右栏 AI 搭档（`role: "partner"`）的只读白名单（ADR-0001 / TASK-J.1）；
  * 不替外部 CLI 的实测 `verified_on` 造假（无真实凭证与通过负例时恒保持空）。
* **不变声明（R-12）**：
  * 鉴权：不变（D.1 loopback + #token 鉴权不变）；
  * Demo Origin：不变（4100~4110 独立 Origin 不变）；
  * 点亮三证：不变（物理证据点亮原则不变）；
  * 网关写范围：不变（严禁绕过 Gateway 或容器直接写入主工作区）。
* **验收（PASS，R-7）**：
  1. `EW-01`：`promoteControlMode` 传入伪造/不存在的 `report_fingerprint` 时抛出拒绝码，无法升格；
  2. `EW-02`：`promoteControlMode` 只有关联到已通过、指纹匹配且含必需见证的真实探测报告时，才允许升格；
  3. `EW-03`：`claude-code-adapter.ts::buildLaunch()` 在缺少 MCP 端点配置时不再抛错崩溃，而是安全降级并输出显式标注的预览 launch 契约；
  4. `EW-04`：在已注入容器宿主的前提下，外部 CLI 适配器通过沙箱执行器运行并产出标准 `SandboxRunOutcome`；
  5. `EW-05`：外部 CLI 沙箱执行产出合法的 `SandboxWitness`，证据面正确记录 `SANDBOX_ENFORCED`；
  6. `EW-06`：外部 CLI 若未走沙箱宿主执行，或执行中未产出有效见证，`resolveEvidenceControlMode` 强制将证据记录为 `UNCONTROLLED_EXTERNAL`；
  7. `EW-07`：自注册 Worker 升格受控后，若注册了对应执行器工厂，`requireControlledDispatch` 可成功获取派工实例；
  8. `EW-08`：未注册执行器工厂的自注册 Worker，即使处于升格档位，`dispatchable` 仍为 `false`，派工时抛出 `E_ADAPTER_NO_DISPATCH_FACTORY` 而非假成功；
  9. `EW-09`：严禁出现裸 `child_process.spawn` 绕过网关或容器围栏执行外部 CLI 的路径；
  10. `EW-10`：回归验证：所有既有注册表与派工测试全绿，类型检查零新增错误。
* **FAIL（R-8）**：
  * 执行器绕过 Gateway/容器围栏直接 spawn 外部 CLI → **FAIL**；
  * 指纹伪造升格在接执行面后仍可达 → **FAIL**（挂账未兑现即 FAIL）；
  * 无 `run()` / 工厂的适配器被当可派工（`dispatchable: true` 误判）→ **FAIL**；
  * 声明档 vs 实录档分叉（witness 缺口，`SANDBOX_ENFORCED` 无见证被标受控）→ **FAIL**。
* **范围文件与导出签名（R-5；签名为 DoR 目标，不代表已存在）**：
  * `daemon/worker/adapter-registry.ts`（修改）：保留现有 `AdapterRegistry.registerDispatchFactory(adapterId: string, factory: WorkerDispatchFactory): void`、`getDispatchFactory(adapterId: string): WorkerDispatchFactory | undefined`；重构现有 `promoteControlMode(adapterId: string, next: AdapterControlMode, request?: AdapterModeChangeRequest): RegisteredAdapter`，使升格消费并核验真实报告记录与见证，不能仅依赖形态指纹。
  * `daemon/worker/worker-dispatch.ts`（修改）：保留 `requireControlledDispatch(registry: AdapterRegistry, adapterId: string, options?: ControlledDispatchOptions): WorkerDispatchFactory`；仅绑定有效派工工厂且其适配器实际实现 `run()` 时，才报告 `dispatchable: true`。
  * `daemon/worker/worker-adapter.interface.ts`（修改）：保留 `CodingWorkerAdapter.run(input: AdapterTaskInput, signal?: AbortSignal): Promise<AdapterRunOutcome>` 与 `resolveEvidenceControlMode(declaredControlMode: AdapterControlMode, sandboxWitness: SandboxWitness | undefined): AdapterControlMode`，确保产物路径统一经过真实见证解析。
  * `daemon/worker/cli-host/claude-code-adapter.ts`（修改）：保留 `ClaudeCodeAdapter.buildLaunch(input: Pick<AdapterRunInput, "prompt" | "cwd" | "nativeSessionId">): BuiltLaunch`；扩展 `BuiltLaunch` 的可选 MCP 状态字段，缺端点时标记 `ENDPOINT_MISSING_PREVIEW_ONLY`，仅构建预览、不允许启动真实执行。
  * `daemon/worker/cli-host/cursor-agent-adapter.ts`（修改）：保留 `CursorAgentAdapter.buildLaunch(input: Pick<AdapterRunInput, "prompt" | "cwd" | "nativeSessionId">): CursorAgentBuiltLaunch` 与 `run(input: AdapterTaskInput, signal?: AbortSignal): Promise<AdapterRunOutcome>`；任何新增外部 CLI 执行都必须经 Gateway 或 `ContainerHostPort.runInSandbox()`，不得增加未围栏的本地 spawn。
  * `daemon/worker/verify/worker-registration.ts`（修改）：保留 `effectiveControlMode(record: WorkerRecord): { mode: WorkerRecord["control_mode"]; demoted_reason?: string }` 读侧复算与降级职责，接入真实报告/见证的有效性判断。
  * `daemon/worker/verify/worker-registration-service.ts`（修改）：扩展现有 `WorkerRegistrationService` 注册/升格路径（包括现有 `promoteControlMode(adapterId, targetMode, ...)` 调用），使被接受的报告记录绑定 adapter id、探测目标档、版本指纹及 witness 结果；禁止请求方直接指定受控档位或伪造报告。
  * 新建 `daemon/worker/execution/worker-execution-engine.ts`：设计接口候选 `WorkerExecutionEngine.execute(input: WorkerExecutionInput, signal?: AbortSignal): Promise<AdapterRunOutcome>`、`WorkerExecutionInput`（launch 契约 + Worktree + expected artifacts），并对比 Gateway 会话执行与容器执行实现方案。`GatewaySessionExecutor` / `SandboxedCliExecutor` 仅为候选名称，待 DoR 评审定案，不预先强制统一抽象。
  * `tests/unit/worker-executor-wiring.test.ts`（新建）：`EW-01`–`EW-10` 测试，覆盖真实报告绑定、缺端点预览降级、受控执行器派工、witness 缺失降档、无工厂不派工及禁止裸 spawn。
  * `tests/unit/adapter-registry-dispatch.test.ts`、`tests/unit/worker-self-serve-verify.test.ts`、`tests/unit/openhands-sandbox.test.ts`、`tests/unit/cli-host-claude-code.test.ts`（修改/回归）：锁定注册表门禁、升格报告消费、SandboxWitness 记实与缺 MCP endpoint 行为。
* **估算（R-11）**：
  * **判 L**（跨 launch 契约解耦、AdapterRegistry 升格报告链重构、两类执行器抽象与派工工厂接线、容器见证与证据面消费四层联动，断言超 10 项）。
  * **按 R-11「L 卡不得开工、必须拆分」，本卡仅立卡、待 DoR 过审后由 Tina 授权拆分为子卡，待授权不擅动。**
  * **拆分落地（参照 W.5c 先例 · P-128 经授权）**：
    * `TASK-W.9a`（探测报告指纹升格 + launch 解耦，S/M，`[COMPLETED]`）：`buildLaunch()` 缺端点降级预览 + `promoteControlMode()` 依赖真实探测报告消费链；
    * `TASK-W.9b`（执行器抽象 + 容器见证接线，M，`[COMPLETED]`，#101/`b98e463`）：执行器统一抽象（Gateway 注入 vs 容器围栏方案对比落盘）+ 沙箱执行产物收集与 `SandboxWitness` 闭环；交付与挂账见 completed §3.4o。
    * `TASK-W.9c`（自注册工厂闭环，M，`[COMPLETED]` · #107/`d3397a6`）：交付与四项未销挂账见 completed §3.4q。
* **台账**：
  * ledger **DLV-3** / **W.5b 挂账**：兑现「自造指纹升格重构」与「`buildLaunch` MCP 端点解耦」；
  * ledger **W.7 挂账 1**：解决「升格 ≠ 可派工」结构性边界，打通自注册 Worker 派工工厂与执行器接线。

---

<a id="task-w.9a"></a>
#### 【Task W.9a】探测报告指纹升格 + launch 解耦 `[COMPLETED]`

> **归档注记（2026-11-02 · P-130）**：本卡已 COMPLETED（[#99](https://github.com/he18718143986-design/IDE/pull/99)/`22168ee` squash）。交付摘要、测试与后续挂账见 [`development-tasks-completed.md`](./development-tasks-completed.md#task-w.9a)。

* **任务编号**：`TASK-W.9a`
* **任务名称**：探测报告指纹升格 + launch 解耦
* **对应规格（R-1）**：`system-architecture.md` §9.1、§4.2.3 P-17、§0.6.1；`adapter-registry.ts::promoteControlMode()`；W.5b §3.4m 挂账；W.7 §3.4l 探测/升格链。
* **前置依赖（R-3）**：W.7 COMPLETED（#89/`be480bb`）；W.5b COMPLETED（#92/`bdac805`）；母卡 W.9 SPLIT。W.9c 等待本卡完成。
* **优先级**：P5 · Sprint 首要（本卡实现须另获 Tina 授权）
* **状态**：`[COMPLETED]`（[#99](https://github.com/he18718143986-design/IDE/pull/99)/`22168ee`）
* **对照痛点（R-4）**：`daemon/worker/adapter-registry.ts::promoteControlMode()`（W.9 母卡核验 `:176-193`）只校验报告指纹非空形态，不回查真实报告；自造指纹仍可能升格。`daemon/worker/cli-host/claude-code-adapter.ts::buildLaunch()`（母卡核验 `:247-251`）缺 `STAGENT_MCP_URL` 时硬抛，预览契约也无法构建。
* **一句话目标（R-2）**：升格必须绑定可回查且通过的真实探测报告；缺 MCP endpoint 时生成显式仅预览契约，且不可执行。
* **ADR 修订（R-9）**：无；遵守 ADR-0001/0003/0014 与 REJ-010。
* **采用的默认值（R-10）**：报告 id/指纹及 adapter、目标档、版本、witness 由服务端报告记录权威回查，调用方自报不可信；缺 endpoint 返回明确 `preview_only` 状态，执行入口失败关闭。候选错误码须施工时核对现有码，不能当既有码引用。
* **范围（R-5）**：
  1. 修改 `daemon/worker/adapter-registry.ts::promoteControlMode()` 与报告消费路径：按 report id+fingerprint 回查记录，检查通过状态、adapter id、target mode、版本/声明指纹及所需 witness；缺失、失败、过期、错配一律拒绝，降级沿用既有安全语义。
  2. 修改 `daemon/worker/verify/worker-registration-service.ts` 及报告模型/store，使通过报告绑定上述服务端事实，禁止请求体伪造。
  3. 修改 `daemon/worker/cli-host/claude-code-adapter.ts::buildLaunch()`：端点缺失可构建显式仅预览结果；任何 run/执行路径拒绝该结果。
  4. 补测试覆盖伪造/缺失/失败/错版本报告拒绝、有效报告通过、缺端点预览和执行拒绝。
* **非目标（R-6）**：不实现外部 CLI 执行器、容器运行和自注册派工工厂；不改右栏只读白名单、verified_on 或控制模式政策。
* **不变声明（R-12）**：鉴权、Demo Origin、点亮三证、网关写范围不变；无真实报告/witness 不升格；预览态不能执行。
* **验收（PASS，R-7）**：`EW9A-01` 伪造/不存在报告拒绝；`EW9A-02` 失败或 adapter/target/version/witness 错配拒绝；`EW9A-03` 仅绑定一致的通过报告可升格；`EW9A-04` endpoint 缺失不硬抛而返回 preview-only；`EW9A-05` preview-only 不可执行；`EW9A-06` 错误码复用或明确定义，不将候选码误作既有码。
* **FAIL（R-8）**：自造指纹可升格；错配报告可升格；仍只校验指纹形态；缺 endpoint 硬抛；预览态可执行；调用方可伪造报告/witness。
* **关键文件**：`daemon/worker/adapter-registry.ts`、`daemon/worker/verify/worker-registration-service.ts`、报告 store/model、`daemon/worker/cli-host/claude-code-adapter.ts`；相关 unit tests。
* **估算（R-11）**：S/M；若报告/执行面改造跨越本卡边界则先重估并拆分，不扩成 L 卡直接开工。

<a id="task-w.9b"></a>
#### 【Task W.9b】执行器抽象 + 容器见证接线 `[COMPLETED]`

> **归档注记（2026-11-03 · P-131）**：本卡已 COMPLETED（[#101](https://github.com/he18718143986-design/IDE/pull/101)/`b98e463` squash）。交付、测试边界与四项挂账见 [`development-tasks-completed.md`](./development-tasks-completed.md#task-w.9b)。

* **任务编号**：`TASK-W.9b`
* **任务名称**：执行器抽象 + 容器见证接线
* **对应规格（R-1）**：`system-architecture.md` §9.1、§4.2.3 P-17、§0.6.1；`CodingWorkerAdapter`、`runInSandbox()`、`SandboxWitness`、`resolveEvidenceControlMode()`；W.5b §3.4m 与 W.5c-iii §3.4k。
* **前置依赖（R-3）**：W.5b COMPLETED（#92/`bdac805`）、W.5c-iii COMPLETED（#87/`2313597a`）、母卡 W.9 SPLIT；W.9c 等待本卡完成。与 W.9a 可并行。
* **优先级**：P5 · 已完成（#101）
* **状态**：`[COMPLETED]`（[#101](https://github.com/he18718143986-design/IDE/pull/101)/`b98e463`）
* **对照痛点（R-4）**：`daemon/worker/cli-host/cursor-agent-adapter.ts::run()`（母卡核验 `:359-373`）仍分支失败，launch 结构未执行或收集产物；W.5c-iii 已有 `DockerContainerHost/runInSandbox/SandboxWitness`，但缺面向自注册/外部 CLI 的桥接。Gateway session/tool mediation 与容器执行的控制边界不同，不可用统一接口掩盖能力差异。
* **一句话目标（R-2）**：外部 adapter 只经其真实可用的 Gateway 或容器执行路径运行并收集产物，证据档由执行事实和 witness 决定。
* **ADR 修订（R-9）**：无；遵守 ADR-0001/0003/0014，不宣称容器绝对隔离。
* **采用的默认值（R-10）**：形态 A：Gateway session/tool mediation；形态 B：`runInSandbox()` + 产物收集。先比较能力边界及平台限制，再选路径；无 Gateway capability 不得标 `GATEWAY_ENFORCED`。`SANDBOX_ENFORCED` 无有效 witness 一律经 `resolveEvidenceControlMode()` 记 `UNCONTROLLED_EXTERNAL`。
* **范围（R-5）**：
  1. 施工方案先比较 A/B 的适配器条件、权限与产物责任，确定不混淆的执行器契约。
  2. 实现 adapter `run()` 契约（launch、worktree、expected artifacts、取消/超时），所有外部 CLI 执行必须经 Gateway 或 `ContainerHostPort.runInSandbox()`；无裸本地 spawn。
  3. 产物仅从目标 Worktree/expected artifacts 收集并验证；只有本次成功容器执行可产生绑定的 SandboxWitness，失败/拒绝/超时无 witness。
  4. 证据写入前调用 `resolveEvidenceControlMode(declaredMode, witness)`，声明档不得代替实录档。
  5. 增单测覆盖两路径策略、边界、失败无 witness、无 witness 降档、禁止裸 spawn；fake host 与真实实测分开报告。
* **非目标（R-6）**：不接最终自注册工厂/`requireControlledDispatch()` 闭环（W.9c）；不改右栏只读白名单；不伪造 verified_on；不做多 Agent DAG；不宣称绝对隔离/端到端闭环。
* **不变声明（R-12）**：鉴权、Demo Origin、点亮三证、网关写范围不变；执行不绕 Gateway/容器；证据如实记档。
* **验收（PASS，R-7）**：`EW9B-01` A/B 对比与选路依据；`EW9B-02` run 参数/取消/超时受控；`EW9B-03` 产物限定 Worktree/expected artifacts；`EW9B-04` 成功容器执行带 witness、失败不带；`EW9B-05` 无 witness 降为 `UNCONTROLLED_EXTERNAL`；`EW9B-06` 无 Gateway 能力不可标 Gateway；`EW9B-07` 无围栏外部 spawn 路径；`EW9B-08` fake 与真实宿主实测结果区分。
* **FAIL（R-8）**：裸 spawn；SANDBOX_ENFORCED 无 witness 仍记受控；失败仍产 witness；产物越界；接口/声明冒充 Gateway；伪造 verified_on 或绝对受控声明。
* **关键文件**：新增/修改 execution engine、外部 adapter、`docker-container-host.ts` 调用点、`worker-adapter.interface.ts`、orchestrator 证据消费路径；unit tests。
* **估算（R-11）**：M；若需大规模跨 Gateway/容器/多 adapter 重构，停止并重估拆分。

<a id="task-w.9c"></a>
#### 【Task W.9c】自注册工厂闭环 `[COMPLETED]`

> **归档注记（2026-11-03 · P-134）**：本卡已完成（[#107](https://github.com/he18718143986-design/IDE/pull/107)/`d3397a6`）；完整卡文与交付、验证、挂账见 [`development-tasks-completed.md` §3.4q](./development-tasks-completed.md#task-w.9c)。
>
> **（P-153 · 保留作溯源）** 四项 W.9b 挂账已立卡 [`W.9d`](#task-w.9d) / [`W.9e`](#task-w.9e) / [`W.9f`](#task-w.9f) / [`W.9g`](#task-w.9g)（当时均 `[NEW_TASK]` · 立卡≠销项）。
>
> **（P-154 现行）** 挂账① → [`TASK-W.9d`](./development-tasks-completed.md#task-w.9d) `[COMPLETED]`（[#152](https://github.com/he18718143986-design/IDE/pull/152)/`f5577de`）；挂账②/③/④仍由 [`W.9e`](#task-w.9e) / [`W.9f`](#task-w.9f) / [`W.9g`](#task-w.9g) `[NEW_TASK]` 承接。Sprint 首要 → **`TASK-W.9e`**（序 e→f→g）。**仍不宣称**端到端闭环。



<a id="task-w.9d"></a>

#### 【Task W.9d】行投影 Docker host probe 成本收敛 `[COMPLETED]`

> **归档注记（2026-11-07 · P-154）**：本卡已 COMPLETED（[#152](https://github.com/he18718143986-design/IDE/pull/152)/`f5577de`，squash）。完整卡正文（yaml + 交付清单、默认/未做边界）迁入 [`development-tasks-completed.md` §3.4x](./development-tasks-completed.md#task-w.9d)。**W.9c §3.4q 挂账①销项**。挂账②/③/④仍由 W.9e/f/g 承接。**不宣称**端到端闭环；零改 docker-container-host / W.9e–g。


<a id="task-w.9e"></a>

#### 【Task W.9e】受控派工拒绝码穿透诊断 `[NEW_TASK]`

> **立卡（2026-11-07 · P-153）**：兑现 W.9c completed §3.4q 挂账②（沿用 W.9b §3.4o）。仅诊断信息面；**不**放宽门禁。

```yaml task-card
id: TASK-W.9e
status: NEW_TASK
contract:
  intent:
    title: 受控派工拒绝码穿透诊断
    description: >-
      API/WorkerView 在派工被拒时能暴露与 requireControlledDispatch 同源的具体拒绝码
      （如 E_ADAPTER_NOT_CONTROLLED / E_ADAPTER_SANDBOX_LOCKED / 缺工厂等），
      不再仅因 isControlledDispatchable 吞异常而只剩泛化文案。
    risk_level: LOW
  acceptance:
    - { id: W9E-P1, check: auto, text: "对可控负例（未注册 / UNCONTROLLED / SANDBOX 无宿主 / 缺工厂），诊断结果含稳定 machine-readable 拒绝码，与 requireControlledDispatch 抛出的 WorkerDispatchError.code 一致或可映射" }
    - { id: W9E-P2, check: auto, text: "GET /api/workers（或现行 WorkerView 序列化）在 dispatchable=false 时带回该码（字段名在卡内测试写死；可新增可选字段，不得破坏旧客户端必填契约）" }
    - { id: W9E-P3, check: auto, text: "isControlledDispatchable 若保留 boolean 语义，不得再作为 API 唯一诊断源；门禁放行条件零放宽" }
    - { id: W9E-P4, check: auto, text: "单测覆盖至少三类不同拒绝码可区分" }
  scheme_item_ids: [gap-14]
  scope:
    writable_paths:
      - daemon/worker/worker-dispatch.ts
      - daemon/worker/verify/worker-registration-service.ts
      - daemon/server.ts
      - tests/unit/worker-dispatch*.ts
      - tests/unit/worker-registration*.ts
    readonly_paths:
      - daemon/worker/adapter-registry.ts
  verification:
    commands:
      - { alias: unit, executable: npx, args: [vitest, run, tests/unit/worker-dispatch-diagnostic.test.ts] }
design:
  approach: >-
    新增与 requireControlledDispatch 同源的诊断助手（例如返回
    { ok:true, factory } | { ok:false, code, message }），供 builtinView/storedView/API 使用；
    isControlledDispatchable 可薄封装该助手。禁止只 catch 后丢 .code。
  touches:
    - { path: daemon/worker/worker-dispatch.ts, change: modify, why: 诊断助手暴露拒绝码, symbols: [isControlledDispatchable, requireControlledDispatch] }
    - { path: daemon/worker/verify/worker-registration-service.ts, change: modify, why: 行投影/API 带出 code, symbols: [builtinView, storedView] }
    - { path: tests/unit/worker-dispatch-diagnostic.test.ts, change: create, why: 多码可区分, symbols: [] }
  interfaces:
    - name: WorkerView.dispatch_blocked_code
      kind: type
      signature: "optional string error code when dispatchable=false"
      consumers: []
  test_plan:
    - { acceptance_id: W9E-P1, test_path: tests/unit/worker-dispatch-diagnostic.test.ts, level: unit, case: "拒绝码与 requireControlledDispatch 同源" }
    - { acceptance_id: W9E-P2, test_path: tests/unit/worker-dispatch-diagnostic.test.ts, level: unit, case: "View/API 带回 code" }
    - { acceptance_id: W9E-P3, test_path: tests/unit/worker-dispatch-diagnostic.test.ts, level: unit, case: "门禁条件不放宽" }
    - { acceptance_id: W9E-P4, test_path: tests/unit/worker-dispatch-diagnostic.test.ts, level: unit, case: "三类码可区分" }
governance:
  spec_refs:
    - docs/specs/development-tasks-completed.md#task-w.9c
    - docs/specs/development-tasks-completed.md#task-w.9b
  depends_on:
    - { id: TASK-W.9c, kind: hard }
    - { id: TASK-W.9b, kind: hard }
  code_facts:
    - { ref: "daemon/worker/worker-dispatch.ts::isControlledDispatchable", note: "try requireControlledDispatch; catch { return false } —— 丢 .code" }
    - { ref: "daemon/worker/verify/worker-registration-service.ts::builtinView", note: "dispatch_blocked_reason 为泛化中文，无 machine-readable code" }
    - { ref: "daemon/worker/verify/worker-registration-service.ts::storedView", note: "部分分支补文案，仍非稳定码表" }
    - { ref: "docs/specs/development-tasks-completed.md:2327", note: "§3.4q 挂账②：boolean helper 吞拒绝；API 诊断可能丢具体原因" }
  non_goals:
    - 不放宽 requireControlledDispatch / 不改档位语义
    - 不做 probe 成本收敛（W.9d）/ env 明文（W.9f）/ Cursor 实证（W.9g）
    - 不宣称端到端闭环
  fail:
    - 为「好看」把拒绝改成可派工
    - 伪造与门禁不一致的成功码
  adr_revisions: []
  defaults:
    - "新增可选字段优于改写既有 reason 字符串为唯一真相"
  open_questions: []
  estimate: S
  invariants:
    auth: unchanged
    demo_origin: unchanged
    illumination: unchanged
    gateway_write_scope: unchanged
```

* **背景**：§3.4q 挂账②——诊断信息面收窄。
* **取舍**：只穿透码，不改门禁。

<a id="task-w.9f"></a>

#### 【Task W.9f】容器环境 API key 明文可读面收敛 `[NEW_TASK]`

> **立卡（2026-11-07 · P-153）**：兑现 W.9c completed §3.4q 挂账③（沿用 W.9b §3.4o 与 OpenHands `known_limitations`「未使用 secret 挂载」表述）。**不**把账密写入合同/日志/对话。

```yaml task-card
id: TASK-W.9f
status: NEW_TASK
contract:
  intent:
    title: 容器环境 API key 明文可读面收敛
    description: >-
      LLM_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / CURSOR_API_KEY 不再经由
      SAFE_CONTAINER_ENV_KEYS 普通环境变量直通，使容器进程 environ 与 docker inspect Env
      默认可读明文；改为 secret/文件挂载或等价通道。日志脱敏纪律保持。
    risk_level: HIGH
  acceptance:
    - { id: W9F-P1, check: auto, text: "默认 executeContainerCli / runInSandbox 路径下，上述四键不得出现在传入容器的普通 Env 映射中（测试断言 Env 不含明文值）" }
    - { id: W9F-P2, check: auto, text: "CLI 仍能在受控通道读到所需凭据完成一次最小调用（可用桩宿主证明注入通道，不必真连模型）" }
    - { id: W9F-P3, check: auto, text: "日志/错误字符串仍不对上述键值做明文回显（既有脱敏不回退）" }
    - { id: W9F-P4, check: both, text: "OpenHands known_limitations 中「经容器环境变量注入…未使用 secret 挂载」表述随实现回写为现行事实；不得假装已绝对不可读" }
  scheme_item_ids: [gap-12]
  scope:
    writable_paths:
      - daemon/worker/sandbox/container-cli-executor.ts
      - daemon/worker/cli-host/docker-container-host.ts
      - daemon/worker/cli-host/openhands-adapter.ts
      - daemon/worker/sandbox/**
      - tests/unit/container-cli*.ts
      - tests/unit/docker-container*.ts
    readonly_paths:
      - daemon/vault/**
      - daemon/worker/cli-host/cursor-agent-adapter.ts
  verification:
    commands:
      - { alias: unit, executable: npx, args: [vitest, run, tests/unit/container-cli-secret-injection.test.ts] }
design:
  approach: >-
    按 OpenHands known_limitations 已点名的缺口：停止把四类 key 放进 SAFE_CONTAINER_ENV_KEYS
    普通 Env；改为文件/secret 挂载（或 Docker 支持的等价只读注入），容器内进程经约定路径读取。
    日志侧 SENSITIVE_ENV_KEYS 脱敏保留。不把凭据写入合同、证据 JSON 或对话。
  touches:
    - { path: daemon/worker/sandbox/container-cli-executor.ts, change: modify, why: 收敛 SAFE_CONTAINER_ENV_KEYS 与注入, symbols: [SAFE_CONTAINER_ENV_KEYS, executeContainerCli] }
    - { path: daemon/worker/cli-host/docker-container-host.ts, change: modify, why: 支持 secret/文件挂载参数, symbols: [runInSandbox] }
    - { path: daemon/worker/cli-host/openhands-adapter.ts, change: modify, why: 改注入并回写 known_limitations, symbols: [] }
    - { path: tests/unit/container-cli-secret-injection.test.ts, change: create, why: Env 无明文 + 通道可读, symbols: [] }
  interfaces: []
  test_plan:
    - { acceptance_id: W9F-P1, test_path: tests/unit/container-cli-secret-injection.test.ts, level: unit, case: "普通 Env 无四键明文" }
    - { acceptance_id: W9F-P2, test_path: tests/unit/container-cli-secret-injection.test.ts, level: unit, case: "受控通道可读凭据" }
    - { acceptance_id: W9F-P3, test_path: tests/unit/container-cli-secret-injection.test.ts, level: unit, case: "日志不回显" }
    - { acceptance_id: W9F-P4, test_path: tests/unit/container-cli-secret-injection.test.ts, level: unit, case: "known_limitations 与实现一致", debt: "文案回写可在同卡或紧随 docs 回写；实现 PR 须改 limitations 字符串" }
governance:
  spec_refs:
    - docs/specs/development-tasks-completed.md#task-w.9c
    - docs/specs/development-tasks-completed.md#task-w.9b
    - docs/scheme.md
  depends_on:
    - { id: TASK-W.9c, kind: hard }
    - { id: TASK-W.9b, kind: hard }
  code_facts:
    - { ref: "daemon/worker/sandbox/container-cli-executor.ts::SAFE_CONTAINER_ENV_KEYS", note: "四类 API key 在白名单，可进容器 Env" }
    - { ref: "daemon/worker/cli-host/openhands-adapter.ts::OPENHANDS_CAPABILITY", note: "known_limitations 已写明经 LLM_API_KEY 环境变量注入、未使用 secret 挂载" }
    - { ref: "docs/specs/development-tasks-completed.md:2327", note: "§3.4q 挂账③：四键仍可能被容器内进程读取；日志脱敏不改变该事实" }
  non_goals:
    - 不改 Vault 产品模型 / 不把账密写入合同或对话
    - 不做 Cursor 容器协议实证（W.9g）
    - 不宣称「绝对不可读」或端到端闭环
  fail:
    - 继续默认 Env 直通明文却宣称挂账已销
    - 凭据进入证据 JSON / 合同 / 用户可见日志
  adr_revisions: []
  defaults:
    - "注入通道优先文件挂载（tmpfs/只读）；具体旗标随 DockerContainerHost 现有 API 最小扩展"
  open_questions: []
  estimate: M
  invariants:
    auth: unchanged
    demo_origin: unchanged
    illumination: unchanged
    gateway_write_scope: unchanged
```

* **背景**：§3.4q 挂账③——容器 env 明文 key。
* **取舍**：沿用 known_limitations 已点名的 secret 挂载方向，不另开 Vault 大改。

<a id="task-w.9g"></a>

#### 【Task W.9g】Cursor CLI 容器镜像/运行协议实证 `[NEW_TASK]`

> **立卡（2026-11-07 · P-153）**：兑现 W.9c completed §3.4q 挂账④（沿用 W.9b §3.4o）。**在实证完成前必须继续** `E_CURSOR_AGENT_NO_EXECUTOR` fail-closed；宿主侧 CA-06 / `CURSOR_AGENT_VERIFIED_ON` **不**等同容器协议已实证。

```yaml task-card
id: TASK-W.9g
status: NEW_TASK
contract:
  intent:
    title: Cursor CLI 容器镜像与运行协议实证
    description: >-
      以固定镜像摘要 + 可复现运行协议，证明 Cursor CLI 可经既有 runInSandbox /
      executeContainerCli 桥在容器内受控调用；未实证前保持 NO_EXECUTOR fail-closed，
      不得把 generic 容器桥宣称为 Cursor 已可执行。
    risk_level: HIGH
  acceptance:
    - { id: W9G-P1, check: both, text: "存在钉死的 Cursor 容器镜像引用（digest 或等价不可漂标签）与最小 argv/cwd/挂载协议文档化在代码常量或卡内证据" }
    - { id: W9G-P2, check: auto, text: "未通过实证前，Cursor 适配器仍 has_executor=false 且 run()→E_CURSOR_AGENT_NO_EXECUTOR；不得挂派工工厂冒充可派工" }
    - { id: W9G-P3, check: both, text: "实证通过时：容器路径一次最小调用产出 SandboxWitness，证据面经 resolveEvidenceControlMode；失败则保持 fail-closed 并留下失败证据，不得 fallback 本地/Gateway" }
    - { id: W9G-P4, check: auto, text: "档位不得因本卡升到 GATEWAY_ENFORCED；无 tool interception 时结构性上界仍受控于既有规则（宿主 CA-06 完成 ≠ 本卡完成）" }
  scheme_item_ids: [gap-14]
  scope:
    writable_paths:
      - daemon/worker/cli-host/cursor-agent-adapter.ts
      - daemon/worker/sandbox/**
      - daemon/worker/default-worker-registry.ts
      - tests/unit/cursor-agent*.ts
      - tests/integration/**
    readonly_paths:
      - daemon/worker/cli-host/docker-container-host.ts
      - daemon/worker/sandbox/container-cli-executor.ts
  verification:
    commands:
      - { alias: unit, executable: npx, args: [vitest, run, tests/unit/cursor-agent-container-protocol.test.ts] }
design:
  approach: >-
    先定镜像与协议并加负向锁（未实证 → NO_EXECUTOR）；再在可用 CURSOR_API_KEY + 容器
    运行时下跑最小实证。成功才允许容器执行入口；禁止 generic 桥成功冒充 Cursor 协议成功。
    宿主 plan-mode CA-06 证据不复用为本卡容器实证。
  touches:
    - { path: daemon/worker/cli-host/cursor-agent-adapter.ts, change: modify, why: 协议常量/实证后门禁, symbols: [E_CURSOR_AGENT_NO_EXECUTOR, run, has_executor] }
    - { path: tests/unit/cursor-agent-container-protocol.test.ts, change: create, why: fail-closed 与实证门闩, symbols: [] }
  interfaces: []
  test_plan:
    - { acceptance_id: W9G-P1, test_path: tests/unit/cursor-agent-container-protocol.test.ts, level: unit, case: "镜像引用钉死" }
    - { acceptance_id: W9G-P2, test_path: tests/unit/cursor-agent-container-protocol.test.ts, level: unit, case: "未实证 NO_EXECUTOR" }
    - { acceptance_id: W9G-P3, test_path: tests/integration/cursor-agent-container-protocol.test.ts, level: integration, case: "容器最小调用或失败留证", debt: "无 KEY/无容器时不得 skip 冒充通过；可走专用 workflow 如 ca06-real" }
    - { acceptance_id: W9G-P4, test_path: tests/unit/cursor-agent-container-protocol.test.ts, level: unit, case: "不升 GATEWAY_ENFORCED" }
governance:
  spec_refs:
    - docs/specs/development-tasks-completed.md#task-w.9c
    - docs/specs/development-tasks-completed.md#task-w.9b
    - docs/specs/development-tasks-completed.md#task-w.5b
  depends_on:
    - { id: TASK-W.9c, kind: hard }
    - { id: TASK-W.9b, kind: hard }
    - { id: TASK-W.5b, kind: soft }
  code_facts:
    - { ref: "daemon/worker/cli-host/cursor-agent-adapter.ts::has_executor", note: "false；run() 在有 KEY 时仍抛 E_CURSOR_AGENT_NO_EXECUTOR" }
    - { ref: "docs/specs/development-tasks-completed.md:2327", note: "§3.4q 挂账④：Cursor CLI 镜像与运行协议仍未实证；generic 容器桥不代表 Cursor 可执行" }
    - { ref: "docs/ledger/README.md:191", note: "CA-06 宿主 plan-mode 四类负例已实测；档位仍 UNCONTROLLED_EXTERNAL；≠ 容器协议实证" }
  non_goals:
    - 不把宿主 CA-06 冒充容器实证
    - 不经本地 spawn / Gateway 会话绕过容器桥
    - 不做 W.9d/e/f
    - 不宣称 Cursor 受控或端到端闭环
  fail:
    - 无实证却移除 NO_EXECUTOR 或挂派工工厂
    - 实证失败仍 fallback 本地执行
  adr_revisions: []
  defaults:
    - "开工前置：可用容器运行时 + 有效 CURSOR_API_KEY（禁止订阅登录态凑数，同 W.5b FAIL）"
  open_questions: []
  estimate: M
  invariants:
    auth: unchanged
    demo_origin: unchanged
    illumination: unchanged
    gateway_write_scope: unchanged
```

* **背景**：§3.4q 挂账④——Cursor 容器协议未实证。
* **取舍**：先锁 fail-closed，再实证；不把 CA-06 当本卡完成。


### 3.4c 闭环旅程 v2.1 第一批（Journey · 规格 `supervisor.md` 第三部分 §13～§20；对应 §19 落差 L-01～L-10）


<a id="task-j.18"></a>

#### 【Task J.18】Worker 派工墓地门禁（INV-LEDGER-03 工地侧）· **拆分母卡** `[SPLIT]`

* **任务编号**：`TASK-J.18`
* **任务名称**：派工检查点、执行期墓地拦截、全量扫描与 CLI hook gate pack（**母卡 · 已拆，禁止直接开工**）
* **对应规格**：SSOT §14.11 `INV-LEDGER-03` 第 1 款与第 5 小节 G-MATCH；§15.6；§16.6；`runtime-contract-and-safety.md` §1、§5.2、§8。**实施口径**：[`worker-graveyard-gate.md`](./worker-graveyard-gate.md)
* **前置依赖**：见子卡；历史硬依赖 `TASK-J.4`、`TASK-J.9` 下沉到 `J.18b` / `J.18a`
* **优先级**：P1（M3 含本能力；施工按子卡）
* **状态**：`[SPLIT]`（2026-10-31 · DoR R-11：原估算 **L**，禁止开工，必须再拆）
* **拆分去向**（按层拆，对齐 [`task-card-standard.md`](./task-card-standard.md) §4）：
  1. **`TASK-J.18a`**：G-MATCH 纯函数与产出物投影（TM-GM、TM-GU）
  2. **`TASK-J.18b`**：合同 `scheme_binding` + 快照 1.2 墓地权威源（GAP-W1、GAP-W2）
  3. **`TASK-J.18c`**：门禁裁决 / 优先级格 / 派工绑定 / 码表（TM-GS、TM-GA、TM-GP、TM-GB、TM-GE）
  4. **`TASK-J.18d`**：写路径接线、CLI gate pack、全量扫描与集成（GAP-W3/W4/W6；TM-GH、TM-GI）
* **一句话目标（母卡保留）**：Worker 引入被用户否决的方案时（新增依赖、导入、安装命令），施工在写盘前或合并前被拦下，用户看到一张白话卡；弱证据只进审阅，不停工。
* **非目标（母卡）**：不做语义判定；不做 AST；不在施工期提供复活通道；不改 `E_SCOPE_PLAN_DRIFT` 语义（只属签署期）。Agent **不得**把本母卡当可开工卡。
* **已拍板**：DEC-1 按建议登记（`supervisor.md` §14.11 K-15）：工地侧 `E_PROPOSAL_PREVIOUSLY_REJECTED` 作为 L3 运行时码登记入 `ERROR_CODES`，映射 `SCOPE_VIOLATION`。代码登记随 **`TASK-J.18c`** 实施 PR 完成；在该 PR 合入前，门禁只写日志与 `forbiddenViolations`，不写 `reason_code`。
* **不变声明（R-12）**：同原子卡合集；详见各子卡 R-12。
* **估算**：L（**已失效作开工依据**；以子卡 S/M 为准）

### 3.4d 交付全链路 · 目标能力（L 系列 · 2026-10-30 立卡）

<a id="task-l.17"></a>

#### 【Task L.17】受控只读外网摄取（北极星前置 · 已拆分） `[SPLIT]`

> **注记（2026-11-01 · oq-3 裁决与 L.17 拆分；11-01 L.17a 交付与 L.17b 解封；11-02 L.17b 交付，M5 主序收官更新）**：本卡已拆分为 **`TASK-L.17a`** 与 **`TASK-L.17b`** 两张子卡，且均已 COMPLETED：L.17a（[#70](https://github.com/he18718143986-design/IDE/pull/70)/`8516c3d`）、**L.17b（[#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`）**。保留历史拆分追溯，不删原文，本母卡不开工实现。**M5 北极星主序（L.16 → L.17a → L.17b）已全部落完**；债卡 `W.6` 亦已 COMPLETED（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，见 completed §3.4g）。Sprint 首要位置现进入债卡区，排程已裁决写死（2026-11-02 · P-114）：**`W.5c`（容器沙箱，兼 `W.7` 探测地基）→ `W.7`（自助注册/自动验证，硬前置已解除）→ `W.5b`（cursor-agent 实测，作 `W.7` 回归基准）**；`W.5b/c` 保留队列、不再列为待定项。**P-119 进度同步**：`W.5c-i` 已 COMPLETED（#81/`c3e75cc`）、`TASK-C.23` 已 COMPLETED（#82/`a5223fb`），**Sprint 首要现为 `W.5c-ii`**（容器运行时 `runInSandbox`）。`ruling 3`（`check playtest` 接验收档）已于 P-114 落盘裁决、**已于 P-119 由 `TASK-C.23` 兑现实现**（判定源仍为 L.17b 交付物）。

* **任务编号**：`TASK-L.17`
* **对应规格**：ADR-0014 §3；`scheme.md` goal-2、conf-6、oq-2（dec-12）；[`delivery-lifecycle.md`](./delivery-lifecycle.md) M5
* **前置依赖**：`TASK-L.14`（COMPLETED · #31/`ae57543`）；**oq-2 裁决**（**RESOLVED · dec-12**，北极星「一模一样」判定口径：对话试玩 + 结构化证据桩，AI 引导不代判）
* **优先级**：P3（M5）
* **状态**：`[SPLIT]`（**已拆分为 L.17a + L.17b，保留追溯**；前置 oq-2 与 oq-3 均已裁决，子卡已就绪）
* **对照痛点（代码事实）**：`ALWAYS_DENY` 含 `WebFetch` / `WebSearch`（`daemon/worker/cli-host/claude-code-adapter.ts`）；Worker 无任何受控外网摄取能力；方案工作台尚无参考站比对与试玩证据桩通道。
* **一句话目标**：Worker 能经 Daemon 代理只读抓取方案登记参考站，结合凭据代登进行复刻施工；用户经右栏搭档试玩比对并在确认后生成带版本绑定的结构化认可证据。
* **范围（基于 dec-12 细化）**：
  1. Daemon 受控代理 `daemon/web-ingest/proxy.ts`：只允许 GET；域名白名单 = 方案 `references[]` 中用户给出的 URL 域名；响应大小与速率上限。
  2. 凭据代登：凭据名在目标配置登记，Daemon 用保险库值代登并持有 session/cookie；Worker 仅拿到页面内容（HTML / 截图 / DOM 摘要），环境变量零账密暴露。
  3. 作为 MCP 工具经网关暴露给 Worker（`--strict-mcp-config` 下受管端点）。
  4. 对比视图与右栏试玩引导：方案工作台呈现参考站抓取成果与生成站预览对比；右栏搭档（只读白名单不变）引导用户试玩与提修改意见。
  5. 结构化证据落盘桩：用户在试玩后明确表态（点「认可完成」按钮或原话认可），生成带 `contract_id`、`release_id`（版本指纹）、用户确认原话与精确时间戳的证据文件落盘，`check: playtest` 基于此断言。
  6. 跨版本重置：认可状态与当前版本严格绑定；后续微合同修改或新 Release 部署后，认可状态自动重置，不可跨版本复用。
* **非目标**：不给右栏开外网（conf-7 / DEC-005）；不做通用搜索；不追求像素级/DOM 树机器对比指标（机器初筛作为后续自动化增强另议）。
* **不变声明**：右栏只读工具白名单不变；Worker 环境不含保险库明文；AI 仅做引导不代判。
* **验收（PASS）**：
  1. 摄取安全与凭据隔离：Worker 经 Daemon 代理只读抓取参考站且白名单外域名请求被 403 阻断；凭据代登后 Worker 进程输入/环境变量/日志/证据零账密泄漏。
  2. 试玩对比体验：工作台正确呈现参考站与生成站的对比展示；用户与右栏搭档对话正常交互且无任何主干写权限穿透。
  3. 结构化证据落盘：用户完成试玩表态后，生成包含 `contract_id`、`release_id`、用户确认原话与时间戳的证据文件落盘，`check: playtest` 判定基于该证据文件。
  4. 跨版本自动重置：微合同修改产生新版本后，原认可标志自动重置为未认可，防止旧版认可穿透新版。
* **FAIL**：Worker 输入、日志、证据中出现账密；请求打到白名单外域名；AI 自行生成无用户确认的伪造证据；旧版本认可状态跨版本保留。
* **拆分规划（满足 DoR R-11 ≤M 估算要求）**：
  - `TASK-L.17a`：受控只读外网摄取与 Vault 代登代理（范围 1、2、3；估算 M）
  - `TASK-L.17b`：对比视图、右栏试玩引导与结构化证据桩（范围 4、5、6；估算 M）
* **关键文件**：`daemon/web-ingest/*`（新）、`daemon/mcp/gateway.ts`、`src/components/project/*`、`src/lib/journey/*`
* **估算**：L（已拆分为 L.17a / L.17b 执行，保留本卡追溯）


---

<a id="task-l.17b"></a>

#### 【Task L.17b】对比视图与试玩证据桩 `[COMPLETED]`

> **归档注记（2026-11-02 · P-112）**：本卡已 COMPLETED（[#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`，squash merge）。完整交付记录、残余边界与挂账见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4f（锚点 `#task-l.17b`）。本处保留原始卡文以存追溯，不再作为施工依据；**M5 北极星主序收官**。**（P-132 立卡指针 · 保留原文作溯源）**端到端 UI 接线立为 [`TASK-L.17c`](#task-l.17c) `[NEW_TASK]`，**未开工、未宣称闭环**。**（P-133 现行指针）**`TASK-L.17c` → `[COMPLETED]`（[#104](https://github.com/he18718143986-design/IDE/pull/104)/`06661be`）；交付与三项挂账见 [`development-tasks-completed.md`](./development-tasks-completed.md#task-l.17c)；**仍不宣称**端到端闭环。

* **任务编号**：`TASK-L.17b`
* **任务名称**：对比视图与试玩证据桩
* **对应规格**：ADR-0014 §3；`scheme.md` goal-2、dec-12、oq-2、acc-6；[`delivery-lifecycle.md`](./delivery-lifecycle.md) M5
* **前置依赖**：`TASK-L.17a`（COMPLETED · [#70](https://github.com/he18718143986-design/IDE/pull/70)/`8516c3d`）+ `TASK-L.16`（COMPLETED · #62/`e4dfe1c`，复用「让 AI 看看」通道做试玩引导）
* **优先级**：P3（M5）
* **状态**：`[COMPLETED]`（2026-11-02 · [#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`，squash merge；前置 L.17a #70/`8516c3d` 与 L.16 #62 均已 COMPLETED；**M5 北极星主序最后一张卡已落完**）
* **对照痛点（代码事实）**：方案工作台尚无参考站抓取快照与生成站预览对比；右栏缺少试玩比对引导；`check: playtest` 缺乏带版本号与用户原话的结构化证据落盘桩。
* **一句话目标**：方案工作台呈现参考站抓取成果与生成站预览对比；用户经右栏搭档试玩引导后明确表态确认，落盘 dec-12 结构化证据桩，新版本部署后自动重置认可。
* **范围（照 L.17 卡内拆分规划 4、5、6 与 dec-12 规定）**：
  1. 对比视图 `src/components/project/CompareView.tsx`：方案工作台呈现参考站抓取成果（HTML/截图/DOM 摘要）与 Worktree 真实生成站预览的并排对比视图。
  2. 右栏试玩引导：复用 L.16「让 AI 看看」通道（`origin:system` 插桩），引导用户对照参考站自由试玩、对比差异与提修改意见。
  3. dec-12 结构化证据桩 `src/lib/journey/playtest-evidence.ts`：用户在试玩后明确表态（点「认可完成」按钮或原话认可），生成带 `contract_id`、用户确认原话、版本号（`release_id` 或快照指纹）与精确时间戳的结构化证据记录落盘至 `.stagent/evidence/`，`check: playtest` 基于此断言。
  4. 跨版本自动重置：认可状态与当前版本严格绑定；后续微合同修改或新 Release 部署后，认可状态自动重置，不可跨版本复用。
* **非目标**：不给右栏开外网（conf-7 / DEC-005）；不做通用搜索；不追求像素级/DOM 树机器对比指标（REJ-009 已入墓）；AI 仅做引导不代判。
* **不变声明**：右栏只读工具白名单不变；AI 仅做引导不代判；证据必须经用户明确表态后生成。
* **验收（PASS）**：
  1. `tests/unit/compare-view.test.ts`：方案工作台正确渲染参考站快照与真实生成站预览（L.5 端口），对比布局完整。
  2. `tests/unit/playtest-guidance.test.ts`：复用 L.16 通道，右栏搭档能展示试玩提示并接收用户评阅，不穿透任何主干写入权限。
  3. `tests/unit/playtest-evidence.test.ts`：用户完成试玩表态（点击或原话确认）后，落盘包含 `contract_id`、`release_id`、用户确认原话与精确时间戳的证据文件，`check: playtest` 判定基于该证据文件。
  4. `tests/unit/playtest-reset.test.ts`：微合同修改或新 Release 产生新版本指纹后，原认可标志自动重置为未认可，防止旧版认可穿透新版。
* **FAIL**：
  1. AI 生成无用户确认的证据（未经用户明确表态自动写入认可证据桩）。
  2. 旧版本认可跨版本保留（新版本构建/发布后旧认可未重置）。
  3. 机器自动比对（像素/DOM）作为强阻断门禁复活。
* **关键文件**：`src/components/project/CompareView.tsx`（新）、`src/lib/journey/playtest-evidence.ts`（新）、`daemon/supervisor/preview/playtest-guard.ts`、`tests/unit/playtest-evidence.test.ts`（新）
* **估算**：M


<a id="task-l.17c"></a>

#### 【Task L.17c】中栏方案审阅页嵌入试玩认可提交 `[COMPLETED]`

> **归档注记（2026-11-03 · P-133）**：本卡已 COMPLETED（[#104](https://github.com/he18718143986-design/IDE/pull/104)/`06661be` squash）。交付、三项挂账与边界见 [`development-tasks-completed.md`](./development-tasks-completed.md#task-l.17c)。**立卡原文（P-132）保留作溯源**：兑现 L.17b / C.23 已声明的端到端 UI 挂账；**不抢 Sprint 首要**（现行首要仍为 `TASK-W.9c`）；不碰 W.9c / orchestrator / AdapterRegistry；**不宣称**端到端闭环。
>
> **（P-149 立卡指针 · 保留原文作溯源）** 三项挂账已立卡 [`L.17d`](#task-l.17d) / [`L.17e`](#task-l.17e) / [`L.17f`](#task-l.17f)（当时均 `[NEW_TASK]`）。
> **（P-150 · 保留作溯源）** 挂账① → [`TASK-L.17d`](./development-tasks-completed.md#task-l.17d) `[COMPLETED]`（[#145](https://github.com/he18718143986-design/IDE/pull/145)/`e2b8dd3`）；挂账②/③当时仍 `[NEW_TASK]`。
> **（P-151 · 保留作溯源）** 挂账①/②已销；挂账③当时仍由 L.17f `[NEW_TASK]` 承接。
> **（P-152 现行）** 挂账① → [`TASK-L.17d`](./development-tasks-completed.md#task-l.17d) `[COMPLETED]`（[#145](https://github.com/he18718143986-design/IDE/pull/145)/`e2b8dd3`）；挂账② → [`TASK-L.17e`](./development-tasks-completed.md#task-l.17e) `[COMPLETED]`（[#147](https://github.com/he18718143986-design/IDE/pull/147)/`aeedecd`）；挂账③ → [`TASK-L.17f`](./development-tasks-completed.md#task-l.17f) `[COMPLETED]`（[#149](https://github.com/he18718143986-design/IDE/pull/149)/`86da495`）。Sprint 首要 → **在队清零**（下一挂账面为 W.9c §3.4q 四项未销挂账，立卡/排程待 Tina 指定）。**仍不宣称**端到端闭环。

* **任务编号**：`TASK-L.17c`
* **任务名称**：中栏方案审阅页嵌入试玩认可提交
* **对应规格**（R-1）：[`../scheme.md`](../scheme.md) **dec-12** / **acc-6** / gap-11；[`delivery-lifecycle.md`](./delivery-lifecycle.md) M5；[`development-tasks-completed.md`](./development-tasks-completed.md) §3.4f（L.17b 未接线声明）与 §3.4i（C.23 挂账「CompareView UI 路由挂载与用户原话采集 UI 仍属后续」）；W.5a / C.18 中栏单页方案审阅架构裁决（禁复活多视口 Tab）
* **前置依赖**（R-3）：`TASK-L.17b`（**COMPLETED** · [#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`，CompareView / `submitPlaytestEvidence` / `playtest-guard` 已交付）；`TASK-C.18`（**COMPLETED**，中栏 `SchemeReviewPane` 单页已在）；`TASK-C.23`（**COMPLETED** · [#82](https://github.com/he18718143986-design/IDE/pull/82)/`a5223fb`，验收命令装配已兑现；本卡**不改**装配与判定源）
* **优先级**：P3（产品验收挂账 · 不抢 W.9c）
* **状态**：`[COMPLETED]`（[#104](https://github.com/he18718143986-design/IDE/pull/104)/`06661be`）
* **对照痛点（代码事实）**（R-4）：
  1. `src/components/project/CompareView.tsx::CompareView` 组件已在库，但**全仓无 JSX 挂载点**（仅单测引用）；中栏 `src/components/studio/SchemeReviewPane.tsx::SchemeReviewPane` 未 import / 未渲染它。
  2. `src/lib/journey/playtest-evidence.ts::submitPlaytestEvidence` 与 `POST /api/playtest/evidence` 已交付，但 UI **无「认可完成」按钮、无原话输入框**；右栏 `playtest-guidance.ts` 仅文案提示。
  3. `daemon/supervisor/preview/playtest-guard.ts::evaluatePlaytestGuard` 为 `check playtest` 单一判定源；**无读侧 HTTP/UI 接线**把 `UNCONFIRMED` / `STALE_VERSION` / `NOT_NORTHSTAR_SCENARIO` / `ok:true` 等拒绝态反映到按钮可用态与提交结果（`daemon/server.ts` 目前仅挂 `POST /api/playtest/evidence`）。
* **一句话目标**（R-2）：用户在中栏「方案审阅」同页看见既有对照试玩视图，输入原话点「认可完成」后，证据经既有 `submitPlaytestEvidence` 落盘；按钮与结果文案如实反映 `playtest-guard` 判定（含拒绝态），无需另开 Tab / 右栏入口。
* **ADR 修订**（R-9）：无（不复活 REJ-009；不改 ADR-0001 / ADR-0014）
* **采用的默认值**（R-10）：沿用 **dec-12 / L.17b** 证据口径——`user_verdict` 为用户原话（证据的一部分，**不许改造/摘要**）；`release_id` / `timestamp` / `operator` 仍只由服务端装配；AI 不代判。
* **范围**（R-5）：
  1. **挂载（不重建组件）**：修改 `src/components/studio/SchemeReviewPane.tsx`（及若必要的 `src/routes/index.tsx` 传参），在中栏方案审阅**同页**嵌入既有 `CompareView`；**不改** `CompareView.tsx` 组件本体 / props 契约（缺 props 时由调用方装配既有字段：`contractId` / `references` / `snapshots` / `previewUrl` 等）。
  2. **原话 +「认可完成」**：在同页（CompareView 邻近区域或 SchemeReviewPane 内新小节）增加原话展示/输入与「认可完成」按钮；点击后**只**调用 `src/lib/journey/playtest-evidence.ts::submitPlaytestEvidence(conn, { contract_id, user_verdict })`；提交前本地拒空/空白原话；**禁止**对原话做摘要/改写后再提交。
  3. **读侧接线（不改门禁本体）**：新增薄读侧（建议 `GET /api/playtest/status?contract_id=` 或等价，委托既有 `evaluatePlaytestGuard`，**零改** `playtest-guard.ts` 判定逻辑）+ 前端消费：按钮 disabled/文案与提交结果反映既有拒绝态（至少覆盖 `UNCONFIRMED` / `STALE_VERSION` / `NOT_NORTHSTAR_SCENARIO` / `CONTRACT_NOT_FOUND` / `EVIDENCE_INVALID` / `ok:true`）；提交成功后刷新读侧状态。
  4. **测试**：新增 UI/单元测（建议 `tests/ui/scheme-review-playtest.test.tsx` 与/或 `tests/unit/playtest-status-wiring.test.ts`）覆盖挂载、空原话不可提交、提交走 `submitPlaytestEvidence`、读侧拒绝态反映。
* **非目标**（R-6）：
  1. **不碰** `daemon/pipeline/orchestrator.ts` / 派工 / `AdapterRegistry` / `requireControlledDispatch`（**W.9c 施工面**）。
  2. **真机整段 `check playtest` 执行债另挂**，不塞进本卡（本卡只做 UI + 读侧反映，不改门禁执行链路）。
  3. **不改** `CompareView` / `submitPlaytestEvidence` / `playtest-guard` / `withPlaytestCommand` **本体**（契约与判定逻辑冻结；只消费）。
  4. **不**复活 Studio 多视口 Tab、**不**新设右栏入口、**不**新开 ActivityBar 项（W.5a / C.18 裁决）。
  5. **不**宣称端到端产品闭环已完成；本卡完工后仍须真机联调另证。
* **不变声明**（R-12）：鉴权 / Demo Origin / 点亮三证 / 网关写范围 **不变**；右栏 `role:"partner"` 只读白名单 **不变**；dec-12 / REJ-009 **不变**。
* **验收（PASS）**（R-7）：
  1. 中栏方案审阅页 DOM 出现既有 `data-testid="compare-view"`（来自库内 CompareView，非重建副本）。
  2. 无原话 / 空白原话时「认可完成」不可成功提交（前端拦截 + 与既有 API 400 口径一致）。
  3. 有效原话提交的网络/调用路径断言命中 `submitPlaytestEvidence` → `POST /api/playtest/evidence`；请求体**仅** `contract_id` + `user_verdict`（原话未经摘要）。
  4. 读侧在 `STALE_VERSION` / `UNCONFIRMED` / `NOT_NORTHSTAR_SCENARIO` 等态下，按钮或结果区有可见反映；`playtest-guard.ts` diff **为空**（判定本体未改）。
  5. 静态扫描：本卡 diff **不含** 新 ActivityBar 视口 / 多 Tab 路由复活。
* **FAIL**（R-8）：
  1. 复活多视口 Tab / 新设右栏入口 → FAIL（W.5a 架构裁决）。
  2. 改造 / 摘要原话再提交 → FAIL（证据完整性 / dec-12）。
  3. 无原话 / 空原话可提交 → FAIL。
  4. 提交路径绕过 `submitPlaytestEvidence` 直连 evidence 存储（浏览器直写 `.stagent/` 或自造 POST 体带 `release_id`/`operator`/`timestamp`）→ FAIL。
* **关键文件**：`src/components/studio/SchemeReviewPane.tsx`（改）、`src/routes/index.tsx`（改·传参，若需要）、`src/components/project/CompareView.tsx`（**只读复用**）、`src/lib/journey/playtest-evidence.ts`（**只读复用**）、`daemon/supervisor/preview/playtest-guard.ts`（**只读复用**）、`daemon/server.ts`（改·薄读侧路由，若采用 HTTP）、`tests/ui/scheme-review-playtest.test.tsx`（新）与/或 `tests/unit/playtest-status-wiring.test.ts`（新）
* **估算**（R-11）：**S/M**（同页挂载 + 表单 + 薄读侧；单层 UI/接线，不跨 orchestrator）


<a id="task-l.17d"></a>

#### 【Task L.17d】L.17a 参考站抓取成果接入 CompareView `snapshots` `[COMPLETED]`

> **归档注记（2026-11-07 · P-150）**：本卡已 COMPLETED（[#145](https://github.com/he18718143986-design/IDE/pull/145)/`e2b8dd3`，squash）。完整卡正文（yaml + 交付清单、默认/未做边界）迁入 [`development-tasks-completed.md` §3.4u](./development-tasks-completed.md#task-l.17d)。**L.17c 挂账①销项**。**（P-151）** 挂账② → [`TASK-L.17e`](./development-tasks-completed.md#task-l.17e) `[COMPLETED]`（#147/`aeedecd`）。**（P-152）** 挂账③ → [`TASK-L.17f`](./development-tasks-completed.md#task-l.17f) `[COMPLETED]`（#149/`86da495`）。**不宣称**端到端闭环；不碰 W.9。


<a id="task-l.17e"></a>

#### 【Task L.17e】会话原话候选接入试玩认可框 `[COMPLETED]`

> **归档注记（2026-11-07 · P-151）**：本卡已 COMPLETED（[#147](https://github.com/he18718143986-design/IDE/pull/147)/`aeedecd`，squash）。完整卡正文（yaml + 交付清单、默认/未做边界）迁入 [`development-tasks-completed.md` §3.4v](./development-tasks-completed.md#task-l.17e)。**L.17c 挂账②销项**。**（P-152）** 挂账③ → [`TASK-L.17f`](./development-tasks-completed.md#task-l.17f) `[COMPLETED]`（#149/`86da495`）。**不宣称**端到端闭环；不碰 W.9；不改 PlaytestAcceptBlock。


<a id="task-l.17f"></a>

#### 【Task L.17f】真机/门禁链 `check playtest` 执行债 `[COMPLETED]`

> **归档注记（2026-11-07 · P-152）**：本卡已 COMPLETED（[#149](https://github.com/he18718143986-design/IDE/pull/149)/`86da495`，squash）。完整卡正文（yaml + 交付清单、默认/未做边界）迁入 [`development-tasks-completed.md` §3.4w](./development-tasks-completed.md#task-l.17f)。**L.17c 挂账③销项**（L.17c 三项挂账均已销）。**不宣称**端到端闭环；不碰 W.9 四项挂账；零改 playtest-guard / C.23 装配 / bin/stagent。


### 3.4e 台账债立卡（2026-11-01 · NON_BLOCKER · 不抢主序）


> Tina 授权将第一类六项写成任务卡。Sprint：主序实现卡 **`L.16` 已 COMPLETED**（#62/`e4dfe1c`）；**`L.17a` 已 COMPLETED**（#70/`8516c3d`）；**`TASK-L.17b` 已 COMPLETED**（#72/`d26def6`）——**M5 北极星主序（L.16 → L.17a → L.17b）全部落完，主序收官**。本节目的：把 ledger 待立卡改代码项变成可排期卡；`A.7`/`H.9`/`L.18`/`J.19`/`J.20`/`C.22`/`W.8`/`L.17a`/`L.17b` 已 COMPLETED（见 completed / #58/#60/#69/#70/#72）；**主序收官后债卡区推进**：`W.6` 已 COMPLETED（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，见 completed §3.4g）。**Sprint 排程已裁决写死（2026-11-02 · P-114）：`W.5c`（OpenHands 容器沙箱实测，兼作 `W.7` 探测沙箱地基）→ `W.7`（自助注册/自动验证 · 硬前置 W.6 已解除）→ `W.5b`（cursor-agent 实测，作 `W.7` 回归基准）**；`W.5b/c` 保留队列、不再列为待定项。**`ruling 3`（`check playtest` 接验收档）已于 P-114 落盘裁决**：北极星合同（带 `references[]`）的 `verification_spec.commands` 自动附加 `{alias:"playtest", executable:"stagent", args:["check","playtest","<contract_id>"]}`，试玩认可成为合并门禁；非北极星合同不附加；实现属小卡（合同装配段 + 测试），另行立卡或挂账（本轮未立卡、未开工）。裁决原文见 completed §3.4f、changelog P-114、ledger consistency-audit P-114。

### 3.5 架构感知、监听与差异审阅（C.5 落 Sprint 2；B.1/B.2/C.4 已 COMPLETED）

<a id="task-b.1"></a>

---

<a id="task-b.2"></a>

> **归档注记（2026-11-04 · P-145）**：`TASK-B.2` 已 `[COMPLETED]`（[#128](https://github.com/he18718143986-design/IDE/pull/128)/`b1aa44f`，squash）。完整卡正文（交付清单、实测、挂账、未宣称边界）迁入 [`development-tasks-completed.md` §3.4s](./development-tasks-completed.md#task-b.2)。

---

<a id="task-c.4"></a>

> **归档注记（2026-11-05 · P-148）**：`TASK-C.4` 已 `[COMPLETED]`（[#138](https://github.com/he18718143986-design/IDE/pull/138)/`993e3e9`，squash）。完整卡正文（交付清单、实测口径、挂账、未宣称边界）迁入 [`development-tasks-completed.md` §3.4t](./development-tasks-completed.md#task-c.4)。
