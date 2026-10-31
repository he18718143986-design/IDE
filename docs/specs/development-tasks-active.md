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

<a id="task-l.11"></a>

#### 【Task L.11】DesignNote 生成、校验与注入 `[NEW_TASK]`

* **任务编号**：`TASK-L.11`
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §2、§3、§6（TD-01～TD-05）；[`project-architecture-baseline.md`](./project-architecture-baseline.md) §6；ADR-0016、ADR-0018、ADR-0019
* **前置依赖**：`TASK-L.4`、`TASK-L.9`（DN-2 插入依赖桩）
* **优先级**：P2（M3）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：Worker 直接从合同开工，没有设计产物；技术决策不被记录。
* **一句话目标**：每份合同开工时先出一份通过校验的设计说明，Worker 按它施工，五类决策才打扰用户。
* **范围**：
  1. 新建 `src/lib/knowledge/modules-schema.ts`：`modules.yaml` 的 zod Schema 与 `ModuleEntry` 类型（L.12 复用）。
  2. 新建 `src/lib/design/design-note.ts`：§2.2 类型；`validateDesignNote(note, contract, modules)`（DN-1～DN-5）；`detectEscalations(note, protectionList, paidSdkList)`（§3 二次判定）。
  3. 新建 `daemon/supervisor/design/design-step.ts`：输入合同 + `docs/system/`（若存在），输出 DesignNote（形态开放；zod Schema 约束）；落盘 `.stagent/records/<id>/design-note.json`。
  4. `orchestrator.ts`：进入 `EXECUTING` 后、T 段之前调用设计步骤；校验失败重试 1 次，仍失败 → `EXECUTING → PENDING_RESUME`；有升级项 → `PENDING_RESUME`。原因（`DESIGN_INVALID` / `DESIGN_ESCALATION` / `DESIGN_NEEDS_DEPENDENCY`）写入 `.stagent/records/<id>/suspension.json`（现行 `PENDING_RESUME` 迁移不带原因字段；这些不是证据原因码，不进 `reasonCodeSchema`）。
  5. **DN-2（需要新依赖但合同不允许）**：设计步骤先重试一次「不引入依赖」；仍需要 → 意外卡「需要装新库 X」：选「可以」→ 本合同安全中止（`ABORTED`），经 L.8 补丁在原桩前插入 `kind: "dependency"` 桩，原桩随后重签；选「不用」→ 本合同按无依赖方案继续或中止，由用户在卡上二选一。**不修改已签合同**。
  6. DesignNote 的 `test_plan` 覆盖 L.3 约定路径（必须落在签署前已进 `ScopePlan` 的 `tests/stagent/**` 内），写入 `.stagent/records/<id>/obligations.json`；`buildWorkerTaskInstruction` 注入「技术方案」段（§2.4）。
  7. `src/lib/design/paid-sdk-list.ts`：付费 SDK 名单（初版：stripe、twilio、@google/maps、openai、@anthropic-ai/sdk、aws-sdk、@aws-sdk/*）。
* **非目标**：不做知识库校验（L.12）。
* **不变声明**：不新增生命周期状态或迁移边。
* **验收（PASS）**：`tests/unit/design-note.test.ts`：TD-01～TD-05；`tests/integration/design-step.test.ts`：桩设计步骤返回合法 DesignNote → Worker 指令含「技术方案」段与 `touches` 路径；返回含 `costs_money` 的决策 → 合同 `PENDING_RESUME` 且 `suspension.json` 原因为 `DESIGN_ESCALATION`；DN-2 选「可以」→ 原合同 `ABORTED`、计划出现 `dependency` 桩、原合同 JSON 字节未变。
* **FAIL**：未校验的 DesignNote 被注入 Worker；二次判定命中却未升级。
* **关键文件**：`src/lib/knowledge/modules-schema.ts`（新）、`src/lib/design/design-note.ts`（新）、`src/lib/design/paid-sdk-list.ts`（新）、`daemon/supervisor/design/design-step.ts`（新）、`daemon/pipeline/orchestrator.ts`、`daemon/worker/session-task-injector.ts`
* **估算**：M

<a id="task-l.12"></a>

#### 【Task L.12】系统知识库：Schema、引导合同与漂移门禁 `[NEW_TASK]`

* **任务编号**：`TASK-L.12`
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §4、§6（TD-06～TD-10）；ADR-0016；`scheme.md` acc-8
* **前置依赖**：`TASK-L.11`
* **优先级**：P2（M3）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：目标项目没有任何系统描述；`daemon/arch/graph.ts::buildDependencyGraph` 结果不落盘。
* **一句话目标**：每份合同合入时，目标仓库的 `docs/system/` 都覆盖本次改动；漂移即判不合格。
* **范围**：
  1. `src/lib/knowledge/modules-schema.ts`（L.11 已建）增加 `coversPath(modules, path)`，glob 匹配复用 `src/lib/scope.ts::matchesAnyPattern`。
  2. 新建 `daemon/knowledge/check-knowledge.ts`：`checkKnowledge({ worktreeDir, baseSha, candidateSha, designNote }) → { ok, failures: { rule: "KB-1"…"KB-5", target }[] }`；由 `bin/stagent.ts` 子命令 `stagent check knowledge` 以真实进程调用（退出码 0 / 1，ADR-0005），作为验证命令排在 V2 之后；失败 → 证据 `FAILED`、原因码 `KNOWLEDGE_DRIFT`。
  3. `withSystemScope`（L.3）扩展：目标仓库已有 `docs/system/modules.yaml`，或本桩为 `knowledge_bootstrap` 时，在签署前把 `docs/system/**` 与 `stagent check knowledge` 并入 `ScopePlan`；`daemon/mcp/gateway.ts` 的文件预算计数（约 L1117）排除 `docs/system/**`。
  4. 新建 `daemon/knowledge/bootstrap-draft.ts`：`draftModules(repoRoot)`：顶层源码目录 → 候选模块，`buildDependencyGraph` → `depends_on`（确定性）。`knowledge_bootstrap` 合同的设计步骤以它为输入。
  5. `reasonCodeSchema`（`src/lib/evidence.schema.ts`）增加 `KNOWLEDGE_DRIFT`。
  6. `renderChecksSection` 追加 KB-1～KB-5 规则摘要（verification-strategy §8 第 3 项）。
* **非目标**：不做「为什么有这段代码」入口（L.13）；不做系统地图 UI（随 L.10 第二页，另卡）。
* **不变声明**：网关写范围判定函数不变，只扩合同范围。
* **验收（PASS）**：`tests/unit/knowledge-check.test.ts`：TD-06～TD-08、TD-10；`tests/unit/knowledge-bootstrap.test.ts`：TD-09。
* **FAIL**：未覆盖的改动文件仍 `can_merge`；`docs/system/**` 写入占用文件预算。
* **关键文件**：`src/lib/knowledge/modules-schema.ts`（新）、`daemon/knowledge/check-knowledge.ts`（新）、`daemon/knowledge/bootstrap-draft.ts`（新）、`bin/stagent.ts`、`daemon/mcp/gateway.ts`、`src/lib/scope.ts`（只读复用）、`daemon/arch/graph.ts`（只读复用）
* **估算**：M

<a id="task-l.13"></a>

#### 【Task L.13】追踪链：Trailer 扩展与「这段为什么存在」反查 `[NEW_TASK]`

* **任务编号**：`TASK-L.13`
* **对应规格**：[`delivery-lifecycle.md`](./delivery-lifecycle.md) §6；[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §5
* **前置依赖**：`TASK-L.9`（合同带 `scheme_item_ids`）、`TASK-L.12`（`changelog.md` 条目保证存在）
* **优先级**：P2（M3）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：`daemon/pipeline/merger.ts` 的 Trailer 只到合同与证据（约 L204）；没有方案条目；没有反查入口。
* **一句话目标**：任意一行合入的代码，都能一键反查到合同、方案条目和用户原话。
* **范围**：
  1. `merger.ts`：新增 Trailer `Stagent-Scheme-Items: goal-3,acc-5`（来自合同 `supervisor_metadata.scheme_item_ids`）；超出 512B 单行上限时截断为合同号，并在 `docs/system/changelog.md` 条目中保留全量（L.12 已保证条目存在）。
  2. 新建 `daemon/trace/why.ts`：`explainLine({ repoRoot, path, line })` → `git blame --porcelain` 取提交 → 解析 Trailer → 读合同、方案快照 → 返回 `{ commit, contract_id, scheme_items: { id, text, quotes: { qid, text }[] }[] }`；任一环缺失返回 `E_TRACE_BROKEN` 并指出断在哪一环。
  3. `GET /api/trace/why?path=&line=`；编辑器右键「这段为什么存在」调用并以白话卡片显示。
  4. 错误码 `E_TRACE_BROKEN` 登记。
* **非目标**：不做影响分析（另卡）。
* **不变声明**：Trailer 既有键不变；512B / 4KB 上限不变。
* **验收（PASS）**：`tests/integration/trace-why.test.ts`：夹具仓库合入一份带 `scheme_item_ids` 的合同 → 对新增行调用 `explainLine` 返回原话；对合入前已存在的行返回 `E_TRACE_BROKEN`（断在「提交无 Stagent Trailer」）；超长条目列表时 Trailer 单行 ≤512B。
* **FAIL**：Trailer 超长导致合并失败；反查返回编造的原话。
* **关键文件**：`daemon/pipeline/merger.ts`、`daemon/trace/why.ts`（新）、`daemon/server.ts`、`src/components/MonacoEditorPane.tsx`
* **估算**：M

<a id="task-l.15"></a>

#### 【Task L.15】发布生命周期与两类部署目标 `[NEW_TASK]`

* **任务编号**：`TASK-L.15`
* **对应规格**：[`release-and-operations.md`](./release-and-operations.md) §1～§3、§6、§7（RO-01～RO-09）；ADR-0017；`scheme.md` acc-9
* **前置依赖**：`TASK-L.14`
* **优先级**：P2（M4）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：deploy / release / health_check 全库 0 命中；合并即终点。
* **一句话目标**：用户点一次「发布」，已合并的提交被构建、部署、探活；失败自动回到上一个能用的版本。
* **范围**：
  1. 新建 `src/lib/release/release.ts`：`ReleaseRecord`、`ReleaseState`、`RELEASE_TRANSITIONS`、`canTransition`（纯函数）；不变式 R-INV-1～3 的校验函数。
  2. 新建 `daemon/release/release-manager.ts`：创建草稿、执行（build → deploy → health → 失败回滚）、持久化 `.stagent/releases/<id>.json`；导出干净目录 `.stagent/releases/<id>/checkout`：用 `git archive <sha> | tar -x`（只读 git，不创建 worktree 元数据，避开 ADR-0002 背景中的并发 `worktree add` 锁问题）；构建前执行检测到的安装命令（`npm ci` 等），复用全局包缓存只读侧（ADR-0002）。
  3. 新建 `daemon/release/target-adapter.ts` 与 `targets/local-process.ts`、`targets/user-command.ts`；目标配置 `.stagent/release-targets.json`。
  4. 一次性命令（install、build、`user_command` 部署、健康命令）经 `command-runner.ts`；`local_process` 长驻进程经 `spawnManaged`（同 L.5）。保险库值只注入 deploy 与 health 步骤（`vault.resolveEnv(target.env_keys)`），不注入 install / build（build 只拿目标配置中的明文 `build_env`）；`log_tail` 经脱敏。
  5. `local_process` 部署顺序：停当前 LIVE 进程 → 启新版本 → 探活；失败 → 停新版本 → 以上一个 LIVE 的导出目录重启 → 探活。手动「回滚」= 以上一个 LIVE 的 `commit_sha` 新建一次发布（不新增状态迁移）。
  6. HTTP：`POST /api/releases`（草稿）、`POST /api/releases/:id/run`（用户点击）、`POST /api/releases/:id/rollback`、`GET /api/releases`。
  7. 画布「发布」页（`src/components/release/ReleasePane.tsx`）：选目标、发布、进度、回滚。
* **非目标**：不做云平台适配器；不做线上问题回流（L.16）。
* **不变声明**：合同状态机与 `MERGED` 终态不变（ADR-0012）。
* **验收（PASS）**：`tests/unit/release-state.test.ts`：转移表与 R-INV-1～3；`tests/integration/release-local-process.test.ts`：RO-01～RO-03；`tests/integration/release-user-command.test.ts`：RO-06、RO-07、RO-09；RO-04、RO-05 在 `release-manager` 单测中覆盖。
* **FAIL**：发布失败改变了任何合同的状态；日志出现密钥明文。
* **关键文件**：`src/lib/release/release.ts`（新）、`daemon/release/*`（新）、`src/components/release/ReleasePane.tsx`（新）、`daemon/server.ts`
* **估算**：M（如超出，拆为「状态机 + 存储」与「目标适配器 + UI」两卡）

<a id="task-l.16"></a>

#### 【Task L.16】线上问题回流 `[NEW_TASK]`

* **任务编号**：`TASK-L.16`
* **对应规格**：[`release-and-operations.md`](./release-and-operations.md) §5、§7（RO-10）
* **前置依赖**：`TASK-L.15`、`TASK-L.9`
* **优先级**：P3（M4）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：无运行监测；合入后的缺陷只能靠用户重新描述。
* **一句话目标**：线上应用出错时，画布出现「线上」卡，用户点一下就生成一份带现场信息的修复合同。
* **范围**：
  1. `release-manager.ts`：`local_process` 进程退出时记录退出码与脱敏 stderr 尾部；LIVE 后每 60 秒探活（目标配置 `watch: false` 可关）。
  2. 新建 `src/components/release/LiveIncidentCard.tsx`：「<目标> 停了，最后的错误是…」+「让 AI 看看」。
  3. 「让 AI 看看」→ 生成 `PlanPatch`：`add_stub` 置顶，`kind: "feature"`，`title` 为白话，`origin: "system"`，`context: { release_id, commit_sha, log_tail }`（L.7 字段），按 project-decomposition §2 放置规则插入。
  4. supervisor §16.5 分流新增 E 类「线上问题」的判定函数（`src/lib/journey/intent-router.ts`）：消息含 LIVE 目标名或「线上 / 上线后 / 生产」且无施工中合同。
* **非目标**：不做告警推送到外部渠道；不做热修。
* **不变声明**：合并后缺陷开新微合同（supervisor §5），不在 `MERGED` 合同上返工。
* **验收（PASS）**：`tests/integration/live-incident.test.ts`：RO-10；`tests/unit/intent-router.test.ts` 新增 E 类判定用例（命中两条、不命中两条）。
* **FAIL**：回流修改了已合并合同；日志尾部含密钥明文。
* **关键文件**：`daemon/release/release-manager.ts`、`src/components/release/LiveIncidentCard.tsx`（新）、`src/lib/journey/intent-router.ts`
* **估算**：M

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

