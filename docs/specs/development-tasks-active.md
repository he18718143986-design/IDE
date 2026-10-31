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
* **优先级**：P3 · **NON_BLOCKER**（M2 不依赖；**不阻断** `TASK-L.12`；不与 W.5b/c 抢位）
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
* **非目标**：不做「为什么有这段代码」入口（L.13）；不做系统地图 UI（**`TASK-L.18`** / DLV-5；本卡之后排期，不抢本卡）。
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


<a id="task-l.18"></a>

#### 【Task L.18】系统地图 UI 与「改这里会影响什么」`[NEW_TASK]` · **NON_BLOCKER**（ledger **DLV-5**）

* **任务编号**：`TASK-L.18`
* **任务名称**：中栏系统地图（知识库第二页）+ 影响闭包入口
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §5；supervisor 中栏/地图嵌入；ledger **DLV-5**；对照 `TASK-L.10`（项目地图已 COMPLETED）
* **前置依赖**：`TASK-L.10`（COMPLETED）、`TASK-L.12`（系统知识库 · 提供 `modules.yaml`；**本卡不抢 L.12 开工权**）
* **优先级**：P3 · **NON_BLOCKER**（相对 Sprint「当前首要」**仍为 L.12**；本卡排在 L.12 之后）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：L.10 已同页嵌「项目地图」（计划/合同桩）；技术规格 §5 要求的「系统地图」（`modules.yaml` 白话卡片 + 依赖图）与「改这里会影响什么」（`depends_on` 反向闭包 + `interfaces/` 消费者）**尚未立卡实现**。
* **一句话目标**：用户能在中栏看到系统模块地图，并在编辑器/右栏只读问答里问「改这里会影响什么」得到确定性闭包，而不是空话。
* **范围**：
  1. 中栏方案工作台内嵌「系统地图」页（**同页嵌**，禁止另开 ActivityBar「项目」Tab——沿用 L.10 入口纪律）：读目标仓 `docs/system/modules.yaml`，代码渲染依赖图（不由模型画图）。
  2. `daemon` 或 `src/lib`：`impactClosure({ modules, path })` → 受影响模块列表（反向 `depends_on` + interfaces 消费者）；`GET /api/knowledge/impact?path=`。
  3. 编辑器右键 / 右栏只读问答入口调用上述 API，白话展示。
  4. 测试：`tests/unit/knowledge-impact.test.ts` + UI 烟测（地图空态 / 有 modules 渲染）。
* **非目标**：不做 L.13「这段为什么存在」（Trailer 反查）；不重做 L.10 项目计划地图；不引入 Cytoscape 架构雷达（C.4 仍 DEFERRED）。
* **不变声明**：右栏只读（J.1）；网关写范围不变。
* **验收（PASS）**：有 `modules.yaml` 时地图可见模块卡；对已知边 `impactClosure` 与夹具一致；无 modules 时诚实空态。
* **FAIL**：另开独立 ActivityBar Tab；或用模型生成依赖图当权威。
* **关键文件**：`src/components/` 地图页（新）、impact 纯函数/API（新）、L.10 同页嵌入口（改）、测试
* **估算**：M
* **台账**：ledger **DLV-5** → 已立卡 `TASK-L.18`；L.12 非目标「系统地图另卡」→ 本卡。

---

### 3.4e 台账债立卡（2026-11-01 · NON_BLOCKER · 不抢 L.12）

> Tina 授权将第一类六项写成任务卡。Sprint「当前首要」仍为 **`TASK-L.12`**。本节目的：把 ledger 待立卡改代码项变成可排期卡。


<a id="task-a.7"></a>

#### 【Task A.7】Worktree seal 路径前缀对齐 `[NEW_TASK]` · **NON_BLOCKER**

* **任务编号**：`TASK-A.7`
* **任务名称**：seal / manifest 目录与 `worktree-manager` 统一为 `task-{id}`
* **对应规格**：[`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) §10.5 D1；ledger DOC-5 / 「第 1 波遗留 · Worktree seal 路径前缀」；[`../ledger/README.md`](../ledger/README.md)
* **前置依赖**：`TASK-A.1`（COMPLETED）、`TASK-C.15d`（COMPLETED）
* **优先级**：P3 · **NON_BLOCKER**（**不阻断** `TASK-L.12` 主序；不抢 Sprint「当前首要」）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：`daemon/guard/worktree-seal.ts::worktreeDir` 拼 `.stagent/worktrees/{contractId}/`（**无** `task-` 前缀）；`daemon/git/worktree-manager.ts` 创建路径为 `.stagent/worktrees/task-{contractId}`（约 L217）；`daemon/editor/launcher.ts` / Evidence 文案亦按 `task-{id}`。seal 与真实 Worktree 目录错位。
* **一句话目标**：封存 / 清单读写命中与创建 Worktree **同一**物理目录 `task-{id}`，不再写到无前缀的孤儿路径。
* **范围**：
  1. 修改 `daemon/guard/worktree-seal.ts::worktreeDir`：目录名改为 `` `task-${sanitizedId}` ``，与 `worktree-manager` 一致。
  2. 迁移/兼容：若旧无前缀目录仅含 seal manifest、且对应 `task-{id}` 已存在，测试约定只读新路径；不要求本卡做批量磁盘迁仓工具。
  3. 单测：`tests/unit/worktree-seal-path.test.ts`（或扩既有 C.15d seal 测）断言 manifest 路径含 `/task-` 前缀且与 manager 解析一致。
* **非目标**：不改 Worktree 分支名约定；不重做 EO-09 语义；不改 A.1 生命周期 API 面；不做 DLV-4 metadata。
* **不变声明**：鉴权 / Demo Origin / 点亮三证 / 网关写范围：**不变**。
* **验收（PASS）**：
  - seal 写入路径 === manager 创建路径（同 `repoRoot`+`contractId`）。
  - 既有 seal 单测全绿；新增前缀断言绿。
* **FAIL**：仍写入 `.stagent/worktrees/{id}/`（无 `task-`）；或 seal 与 manager 路径不一致却标完成。
* **关键文件**：`daemon/guard/worktree-seal.ts`（改）、`daemon/git/worktree-manager.ts`（只读对照）、相关 seal 测试（新/改）
* **估算**：S
* **台账**：关闭 ledger「Worktree seal 路径前缀」待立卡 → 本卡；DOC-5 代码侧收口归属本卡。

---

<a id="task-h.9"></a>

#### 【Task H.9】废止 `.stagent/metadata/` 写入（对齐 ADR-0011）`[NEW_TASK]` · **NON_BLOCKER**（ledger **DLV-4**）

* **任务编号**：`TASK-H.9`
* **任务名称**：清除代码对 `.stagent/metadata/` 的写入，统一到 `.stagent/records/`
* **对应规格**：[ADR-0011](../adr/0011-audit-sidecar-records-path.md)；ledger **DLV-4**；scheme REJ-007
* **前置依赖**：`TASK-C.12e` / `TASK-C.15c`（COMPLETED · records 侧车已落地）
* **优先级**：P3 · **NON_BLOCKER**（**不阻断** `TASK-L.12`）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：`daemon/supervisor/demo/prototypes.ts` 仍常量 `".stagent/metadata/demo-confirm.json"`；与 ADR-0011「`.stagent/metadata/` 自本 ADR 起废止，任何新代码不得写入」冲突。
* **一句话目标**：仓库内无生产路径再创建或写入 `.stagent/metadata/**`；Demo 确认类侧车迁到 `.stagent/records/`（或既有 prototypes 约定目录）并测过。
* **范围**：
  1. 全文检索 `metadata/` 写入点；将 `demo-confirm`（及同类）迁到 ADR-0011 允许路径（优先 `.stagent/records/...` 或现行 `.stagent/prototypes/` 约定，卡内 PR 说明选型）。
  2. 读路径兼容：若旧文件存在可只读迁移一次，禁止继续写入旧路径。
  3. 测试：断言写入路径不含 `.stagent/metadata/`；旧路径写入失败或不再调用。
* **非目标**：不重做 audit-manifest（C.12e 已完成）；不改用户项目历史目录（仅 Stagent 自身写入约定）。
* **不变声明**：鉴权 / Demo Origin 隔离：**不变**。
* **验收（PASS）**：`rg '\.stagent/metadata' daemon src` 无写入字面量（测试夹具除外且须注明）；相关 Demo 确认测绿。
* **FAIL**：仍 mkdir/write `.stagent/metadata/` 却标完成。
* **关键文件**：`daemon/supervisor/demo/prototypes.ts`（改）、相关测试
* **估算**：S
* **台账**：ledger **DLV-4** → 已立卡 `TASK-H.9`。

---

<a id="task-j.19"></a>

#### 【Task J.19】DN-2「可以」HTTP / 画布入口接线 `[NEW_TASK]` · **NON_BLOCKER**（ledger **DLV-6**）

* **任务编号**：`TASK-J.19`
* **任务名称**：把已测的 `resolveDesignDependencyAllow` 接到用户可达入口
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) DN-2；L.11 合入挂账；ledger **DLV-6**；可参照 `TASK-J.7` 交接/意外卡 UX 模式
* **前置依赖**：`TASK-L.11`（COMPLETED）、`TASK-J.7`（COMPLETED · 交接三步/右栏解锁模式可复用）
* **优先级**：P3 · **NON_BLOCKER**（不阻断 L.11 领域验收；**不阻断** `TASK-L.12`）
* **状态**：`[NEW_TASK]`
* **对照痛点（代码事实）**：`daemon/pipeline/orchestrator.ts::resolveDesignDependencyAllow` 已合入且集成测覆盖；`POST .../resume` **不**路由至此；画布无「可以」装新库入口 → 用户不可达（DLV-6）。
* **一句话目标**：设计步骤因 DN-2 挂起时，用户在意外卡点「可以」能走到领域方法并触发重签/依赖桩流程；「不行」走既有拒绝路径。
* **范围**：
  1. HTTP：例如 `POST /api/contracts/:id/design/dependency-allow`（名称以实装为准）鉴权后调用 `resolveDesignDependencyAllow`；对称的 deny/拒绝若缺则补。
  2. 画布意外卡：「可以 / 不行」按钮接线；文案白话；禁止假闭环（须真实调用领域方法）。
  3. 测试：API 级 + UI/集成各至少一条命中 `resolveDesignDependencyAllow`；`resume` 仍不误路由。
* **非目标**：不重做 DN-1～DN-5 校验；不改 DesignNote schema；不把入口做成静默自动装依赖。
* **不变声明**：鉴权不变；未获「可以」不得放行新依赖进施工。
* **验收（PASS）**：用户路径可达；领域方法被调用；重签/abort 语义与 L.11 卡内「已知挂账」描述一致且不再挂「无入口」。
* **FAIL**：仅 UI 按钮无 handler；或宣称端到端闭环但未调 `resolveDesignDependencyAllow`。
* **关键文件**：`daemon/server.ts`（路由）、编排调用、画布意外卡组件、测试
* **估算**：S
* **台账**：ledger **DLV-6** → 已立卡 `TASK-J.19`。

---

<a id="task-j.20"></a>

#### 【Task J.20】OP-1 授权清单落地（dec-10 实施约束）`[NEW_TASK]` · **NON_BLOCKER**

* **任务编号**：`TASK-J.20`
* **任务名称**：确认路径敏感项授权清单的存储、scope 与失效条件
* **对应规格**：[`../scheme.md`](../scheme.md) dec-10 / q23 / R-OP1；supervisor §14.11 **K-12**（确认路径 occurrence 洗白）；[`delivery-lifecycle.md`](./delivery-lifecycle.md) §5 **SA-1**；consistency-audit OP-1（裁决已销项，**实施**归本卡）
* **前置依赖**：`TASK-J.3` / `TASK-J.5` / `TASK-J.9`（均 **COMPLETED**）；**不**重开 `TASK-J.9`
* **优先级**：P2 · **NON_BLOCKER** 相对 L.12 主序（**不抢** Sprint「当前首要」）；实施敏感授权面，须单卡审
* **状态**：`[NEW_TASK]`
* **为何不改 J.9**：`TASK-J.9` 已 **COMPLETED**（SchemePatch 零模型合并引擎，[#12](https://github.com/he18718143986-design/IDE/pull/12)）。裁决原文曾写「落地细节由实施卡确定 / 留待 J.9」——**J.9 当时已合入**，属过时指针。证据纪律禁止把未完成实施塞回 COMPLETED 卡。本卡为 **新实施卡**，只补约束与代码，**不重开裁决**、不改 dec-10 方向。
* **对照痛点（代码事实）**：K-12 / dec-10 已定「确认开工点名敏感项 → 授权清单 → 后续合同同项自动放行」；今日无独立授权清单存储与 scope/失效规则，SA-1 仍以单次合同 `needs_approval` 为主。
* **一句话目标**：跨合同自动放行**可审计、可失效**；「批一次」≠「永久免检」。
* **采用的默认值（实施约束 · 本卡写死，勿再开产品冲突卡）**：
  1. **存储位置**：项目级侧车（建议 `.stagent/records/authorization-allowlist.json` 或 SchemeSnapshot 附属字段；PR 内二选一并测；**禁止**写入已废止的 `.stagent/metadata/`）。
  2. **scope 粒度**：默认 **按仓库（repoRoot）** 生效；条目键 = 规范化敏感路径或保护项 id（与 SA-1 点名规则同款）；**跨合同**复用同一清单。
  3. **失效条件**（满足任一即不得自动放行，须重新点名/确认开工）：清单项被用户显式撤销；保护清单/P.1 规则升级导致项重新分类；仓库更换；条目 TTL（若实装则默认 ≤ 90 天，可配置）；契约 `plan_digest` 基线被用户「清空授权」动作清除。
  4. **不对称**：复活路径仍忽略 `occurrence`（K-12）；本清单**只**服务确认路径自动放行。
* **范围**：
  1. 类型 + 读写：`readAllowlist` / `writeAllowlist` / `isPreauthorized(sensitiveId)`。
  2. 「确认开工」成功路径：将本次点名敏感项写入清单（带 `authorized_at`、`source_contract_id`、`quote` 溯源）。
  3. `evaluateSchemeConfirmation` / Scope 预检：同项已授权且未失效 → 不再阻塞 `E_SCOPE_APPROVAL_REQUIRED`；证据可审计。
  4. 测试：跨合同同项自动放行；撤销/TTL/换仓后恢复拦截；复活路径行为不变。
* **非目标**：不重开 OP-1 裁决；不改 J.9 合并引擎公式；不放宽 P.1 物理门禁（未授权敏感写入仍拒）。
* **不变声明**：物理保护清单与网关写范围：**不放宽**；鉴权 / Demo Origin：**不变**。
* **验收（PASS）**：`tests/unit/authorization-allowlist.test.ts`（名可调）覆盖写入、跨合同命中、失效再拦截、复活路径不读清单。
* **FAIL**：无失效条件的「永久免检」；或把清单写进 `.stagent/metadata/`。
* **关键文件**：新 allowlist 模块、确认/预检接线、supervisor/delivery 短注（若行为入规格）、测试
* **估算**：M
* **台账**：OP-1 裁决仍销项；consistency-audit / scheme R-OP1 补「实施卡 = TASK-J.20」。

---

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

