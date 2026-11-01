# 研发任务卡 · 活跃 / 未完结

> DOC-1 拆分产物：**活跃 / 未完结卡**（含 `NEW_TASK` / `DEFERRED` / 母卡 `SPLIT` 等）。
> 枢纽与索引见 [`development-tasks.md`](./development-tasks.md)、[`development-tasks-index.md`](./development-tasks-index.md)。
> 卡号不变；正文自原单文件搬迁，未删减字段。

### 3.1 契约基线与通信底座（Sprint 0 基础设施与演进）

<a id="task-d.1e"></a>

#### 【Task D.1e】桌面壳 / 本机助手：真·选文件夹（Import 与工作台同壳）`[DEFERRED → v0.2+ · P5.8 · 2026-10-24]`
* **任务编号**：`TASK-D.1e`
* **前置依赖**：`TASK-D.1d`（建议 v0.2 开工前先完成生产可用单窗口；并行亦须满足 D.1 鉴权）
* **任务状态**：**[DEFERRED → v0.2+]**（架构路线 **P5.8**；**不阻塞** v0.1 / `TASK-D.1d` / 八步旅程验收；2026-10-24 经 Tina 口径对齐为正式推迟，本轮仅文档占位）
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
* **任务状态**：**[DEFERRED → v0.2+]** / **[REWORK]**（旧设计实现——含 `SUPERVISOR_MATURITY_UPDATED` 成熟度帧——**存于未合并分支 `wip/s2-s3-supervisor-old-design`，未进入 main，非 v0.1 验收依据**）
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

#### 【Task W.5b】cursor-agent 适配器黑盒实测 (v1.3.3 新增)
* **任务编号**：`TASK-W.5b`
* **前置依赖**：`TASK-W.5a`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：实测 cursor-agent 权限配置能否完全 deny shell/写文件并仅挂 Stagent MCP；凭证途径**仅限 API Key**（`[用户已确认 · 2026-10-20]` 所有 Worker 模式统一，不使用官方登录/订阅会话），注入规则见 架构 §0.6.6。**不能完全关闭原生写能力者只能登记为 `UNCONTROLLED_EXTERNAL`，仅 Vibe 模式可用，UI 显示"未受控"**。
* **Pass/Fail 验收判定**：同 W.5a 的实测纪律；`verified_on` 按实测结果填写或明确标注"未通过，仅 Vibe"。

---

<a id="task-w.5c"></a>

#### 【Task W.5c】OpenHands 适配器（容器隔离，SANDBOX_ENFORCED）(v1.3.3 新增)
* **任务编号**：`TASK-W.5c`
* **前置依赖**：`TASK-W.5a`
* **任务状态**：**[NEW_TASK]**
* **核心目标**：容器内仅挂载任务 Worktree，网络按合同策略；对应 `control_mode = "SANDBOX_ENFORCED"`，D.2 Gate 0 与 A §9.1 不变式承认该模式。
* **Pass/Fail 验收判定**：容器逃逸/越界挂载负例实测失败关闭；`verified_on` 填写实测版本与日期。

---

<a id="task-w.6"></a>

#### 【Task W.6】AdapterRegistry 接线与 Claude Code Worker 派工 `[NEW_TASK]` · **NON_BLOCKER**（ledger **DLV-3**）

* **任务编号**：`TASK-W.6`
* **任务名称**：把 `AdapterRegistry` 接到派工路径；Claude Code `role: "worker"` 可受控派工
* **对应规格**：架构 / W.1 适配器抽象；ledger **DLV-3**；[`../ledger/README.md`](../ledger/README.md) DLV-3；审计依据：Worker 仅 OpenAI `AiWorker`
* **前置依赖**：`TASK-W.1`（COMPLETED）、`TASK-W.5a`（COMPLETED · Claude Code 适配器已有）
* **优先级**：P3 · **NON_BLOCKER**（M2 不依赖；**不阻断** `TASK-L.16`；不与 W.5b/c 抢位）
* **状态**：`[NEW_TASK]`
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

#### 【Task W.7】Worker 自助注册与自动验证 `[NEW_TASK]` · **NON_BLOCKER**

* **任务编号**：`TASK-W.7`
* **任务名称**：前端自助注册任意 Worker；默认 `UNCONTROLLED_EXTERNAL`；自动探测通过后升格 `GATEWAY_ENFORCED`
* **对应规格**：架构 / W.1 适配器抽象；`daemon/worker/worker-adapter.interface.ts`；`src/lib/contract.schema.ts::workerSpecSchema`；先例 W.5b/c 人工实测 → 本卡产品化
* **前置依赖**：**硬** `TASK-W.6`（Registry 进派工，否则测完无池可进；**W.6 仍为 `[NEW_TASK]`，本卡未就绪至 W.6 COMPLETED**）；**软** `TASK-W.5c`（探测沙箱复用/对齐其容器隔离基建）
* **优先级**：P3 · **NON_BLOCKER**（**不阻断** `TASK-L.16`；**不抢** W.5b/c 实测窗口；与 W.5b/c **不互斥**——本卡落地后 W.5b/c 可作为首批真实用例回归基准）
* **状态**：`[NEW_TASK]`（**未就绪**：硬前置 W.6 未 COMPLETED）
* **对照痛点（代码事实）**：
  1. 三层可扩展接口已在：`daemon/worker/worker-adapter.interface.ts::CodingWorkerAdapter`（`AdapterCapabilityDeclaration` 9 项 + `AdapterRejectionCode`）、`daemon/worker/adapter-registry.ts::AdapterRegistry`（`register` / `get` / `requireControlled`）、`src/lib/contract.schema.ts::workerSpecSchema`（`adapter_id` + `control_mode` 二值 `GATEWAY_ENFORCED|UNCONTROLLED_EXTERNAL`）。
  2. 派工仍硬编码 `new AiWorker(...)`（`daemon/pipeline/orchestrator.ts`）——由 **W.6** 接线；本卡不代替 W.6。
  3. 今日无「前端注册 → 自动探测 → 按结果分档」产品路径；W.5b/c 仍是人工黑盒实测卡。
* **一句话目标**：用户可在设置页添加任意 Worker；默认只能当未受控参考；只有通过内置探测包的才升格受控并被 `requireControlled` 命中。
* **范围**：
  1. **两级注册语义**：`POST /api/workers` 接受 `adapter_id` + 启动命令 + 能力声明；**默认且唯一可直写档**为 `UNCONTROLLED_EXTERNAL`（仅 Vibe/参考，**不得**产出合同证据）。升格 `GATEWAY_ENFORCED` **必须**经自动探测通过；**禁止「填表即受控」**。
  2. **自动探测任务包**（daemon 内置 fixture，四类确定性断言）：
     - 文件围栏：诱导越权写；扫主树与 `.stagent/records/`，越权须失败关闭。
     - 命令围栏：白名单外命令须被拒。
     - 证据完整性：diff / 写操作必须经 Gateway 工具集，绕过即失败。
     - 能力声明对账：声明 `TOOL_INTERCEPTION_SUPPORTED` 等须实测命中，声明未兑现 → 不得升格。
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
* **FAIL**：表单/API 直进受控档；探测无沙箱直接跑主树；报告宣称「绝对受控」；`SANDBOX_ENFORCED` 只改 `worker-adapter.interface.ts` 或只改 `contract.schema.ts` 单边；未就绪（W.6 未合）却标本卡完成。
* **关键文件**：`daemon/worker/worker-adapter.interface.ts`、`daemon/worker/adapter-registry.ts`、`src/lib/contract.schema.ts`、`daemon/server.ts`（`/api/workers*` 注册）、新 `daemon/worker/verify/*`（探测包+沙箱）、前端 Worker 设置页组件、新测
* **估算**：L（实现时宜再拆：枚举扩面 / 探测包 / API+UI；本卡先立产品口径）
* **台账**：ledger **DLV-3** 加注「自助注册/自动验证已立卡 W.7」；W.5b/c 挂账讨论处注明「W.7 落地后可作回归用例」。

---

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

#### 【Task L.17】受控只读外网摄取（北极星前置） `[NEW_TASK]`

* **任务编号**：`TASK-L.17`
* **对应规格**：ADR-0014 §3；`scheme.md` goal-2、conf-6、oq-2
* **前置依赖**：`TASK-L.14`（硬，ADR-0014 §3 要求与保险库同步落地）；**oq-2 裁决**（「一模一样」的判据）
* **优先级**：P3（M5）
* **状态**：`[NEW_TASK]`（**未就绪**：oq-2 未裁决，按 task-card-standard R-10 不得开工）
* **对照痛点（代码事实）**：`ALWAYS_DENY` 含 `WebFetch` / `WebSearch`（`daemon/worker/cli-host/claude-code-adapter.ts`）；Worker 无任何外网能力。
* **一句话目标**：Worker 能经 Daemon 代理只读抓取方案里登记的参考站点；需要登录的站点由 Daemon 用保险库凭据代为登录，Worker 看不到账密。
* **范围（草案，oq-2 裁决后细化）**：
  1. Daemon 代理 `daemon/web-ingest/proxy.ts`：只允许 GET；域名白名单 = 方案 `references[]` 中用户给出的 URL 的域名；响应大小与速率上限。
  2. 登录：凭据名在目标配置中登记，Daemon 用保险库值完成登录并持有 cookie；Worker 只拿到页面内容（HTML / 截图 / DOM 摘要）。
  3. 作为 MCP 工具经网关暴露给 Worker（`--strict-mcp-config` 下的 Stagent 网关端点）。
* **非目标**：不给右栏开外网（conf-7 / DEC-005）；不做通用搜索。
* **不变声明**：右栏工具白名单不变；Worker 环境不含保险库值。
* **验收（PASS）**：oq-2 裁决后补写。
* **FAIL**：Worker 输入、日志、证据中出现账密；请求打到白名单外域名。
* **关键文件**：`daemon/web-ingest/*`（新）、`daemon/mcp/gateway.ts`
* **估算**：L（裁决后拆分）

### 3.4e 台账债立卡（2026-11-01 · NON_BLOCKER · 不抢主序）

> Tina 授权将第一类六项写成任务卡。Sprint：主序实现卡 **`L.16` 已 COMPLETED**（#62/`e4dfe1c`）；**`L.17` 仍卡 oq-2 未裁决，主序实现卡已尽**（**不开工** L.17）。本节目的：把 ledger 待立卡改代码项变成可排期卡；`A.7`/`H.9`/`L.18`/`J.19`/`J.20` 已 COMPLETED（见 completed / #58/#60）；余下 **`W.6`** 仍为 NON_BLOCKER（可开；**不与** W.5b/c 同窗）。另立 **`TASK-W.7`**（自助注册/自动验证 · 硬前置 W.6 · **不抢** W.5b/c 实测窗口）。

### 3.5 架构感知、监听与差异审阅（C.5 落 Sprint 2；B.1/B.2/C.4 推迟至 v0.2+）

<a id="task-b.1"></a>

#### 【Task B.1】本地 AST 增量依赖图分析引擎
* **任务编号**：`TASK-B.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]`（2026-10-21 状态校正：与 §1.1 总表对齐，本卡不作 v0.1 验收项）
* **核心目标**：
  1. **统一路径前缀 (G-16)**：解析 `src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`，构建文件级依赖拓扑。
  2. 达成性能门槛：1000 节点冷启动 ≤ 1.5s，单文件增量修补 ≤ 20ms。
* **涉及核心文件**：
  - 新增：`daemon/arch/ast-parser.ts`
  - 新增：`daemon/arch/dependency-graph.ts`
  - 测试：`tests/unit/ast-dependency-graph.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：冷启动 ≤1500ms，增量 ≤20ms，支持 JSON/MJS/CJS。
  - **FAIL**：解析内存泄漏或循环依赖死锁。

---

---

<a id="task-b.2"></a>

#### 【Task B.2】多活跃 Worktree 监听与 Evidence 状态联动
* **任务编号**：`TASK-B.2`
* **前置依赖**：`TASK-B.1`, `TASK-A.1` (COMPLETED), `TASK-A.6` (COMPLETED)
* **任务状态**：**[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]`（2026-10-21 状态校正：原标 `[INCREMENTAL_UPGRADE]` 与总表 DEFERRED 冲突，按 D4 决议统一为推迟；本卡不作 v0.1 验收项）
* **核心目标**：
  1. 监听多个活跃 Worktree，排除 `.git/`, `.stagent/`, `node_modules/`, `dist/`, `build/`, `coverage/`。
  2. **工作树外部变更检测与失效联动**：外部文件修改后，在配置的 watcher debounce 窗口内（性能目标 ≤50ms）触发 Evidence `STALE`（携带错误码 `E_EVIDENCE_STALE`），置 `can_merge = false`，广播 `EVIDENCE_STATUS_CHANGED`；即使监听事件因系统负载丢包，合并前指纹复核兜底机制亦强制撤销 `can_merge`。
* **涉及核心文件**：
  - 修改：`daemon/watcher/fs-watcher.ts`
  - 修改：`daemon/watcher/invalidation-engine.ts`
  - 测试：`tests/unit/multi-worktree-watcher-stale.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：外部改动在 watcher debounce 窗口内（性能目标 ≤50ms）将 Evidence 标为 STALE（携带 `E_EVIDENCE_STALE`）且 `can_merge` 为 false，广播 `EVIDENCE_STATUS_CHANGED`；合并前指纹复核兜底有效；忽略目录写入不误报。
  - **FAIL**：外部改动后 Evidence 仍为 PASSED，或合并前绕过快照复核。

---

---

<a id="task-c.4"></a>

#### 【Task C.4】架构雷达视图与 Scope 圈选抽屉
* **任务编号**：`TASK-C.4`
* **前置依赖**：`TASK-C.3`, `TASK-B.1`
* **任务状态**：**[DEFERRED → v0.2+]** `[用户已确认 D4 · 2026-10-20]`（2026-10-21 状态校正：与 §1.1 总表对齐，本卡不作 v0.1 验收项）
* **核心目标**：
  1. Cytoscape 渲染架构雷达，1000 节点局部 patch ≤ 16ms (60 FPS)，内存 ≤ 30MB。
  2. 交互圈选 Scope；已批准合同圈选强制派生新版本并重新审批，禁止原地扩权。
* **涉及核心文件**：
  - 新增：`src/components/ArchitectureRadar.tsx`
  - 新增：`src/components/ScopeSelectorDrawer.tsx`
  - 测试：`tests/ui/architecture-radar.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：大图流畅；已批准合同修改 Scope 强制触发 Revision 递增与重新审批。
  - **FAIL**：允许在原合同上原地修改 Scope。

---

---

