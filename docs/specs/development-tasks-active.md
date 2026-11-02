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
* **估算**（R-11）：**L**（跨「Schema / 类型层 + 容器运行时层 + 适配器 + 黑盒实测」多层，PASS 断言 7 条且含真实容器实测，超过 §4「一张卡只碰一个层」）。按 R-11「L 卡不得开工，必须拆分」，建议拆为 ① `W.5c-i` 双枚举 + `workerSpecSchema` 目标字段（S/M）② `W.5c-ii` 容器运行时 `runInSandbox`（M）③ `W.5c-iii` OpenHands 适配器 + 真实容器实测与 `verified_on`（M）。**拆分授权已给（2026-11-02 · Tina · P-118）**：按本规划落 `W.5c-i`（双枚举 + 目标字段，S/M，`[READY]`）/ `W.5c-ii`（容器运行时 `runInSandbox`，M，`[READY（跟随 i）]`）/ `W.5c-iii`（OpenHands 适配器 + 真实容器实测 + `verified_on`，M，`[BLOCKED · 等容器环境]`），DAG 增 `i→iii`、`ii→iii` 两条边；母卡标 `[SPLIT]` 保留追溯。`W.5c-iii` 硬前置为本机容器运行时可用 + `STAGENT_REAL_OPENHANDS=1`（P-116 已坐实本机仅 Docker 客户端、无守护进程）。`TASK-W.5b` 的 DOR-3 债保留挂账、本轮不动。

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

#### 【Task W.5c-iii】OpenHands 适配器 + 真实容器实测 + `verified_on` `[IN_PROGRESS · 施工中]`

> **开工声明（2026-11-02 · 施工中，**非**完成回写；回写另见 P-122）**：环境硬前置已满足并经实测坐实——Docker Desktop **29.6.1 / Engine 29.6.1 / containerd v2.2.5 / runc 1.3.6**，`docker info` 服务端可达（非仅客户端），OpenHands 镜像 `ghcr.io/all-hands-ai/openhands@sha256:00968de7…fa6`（1.83GB）已拉取，容器内 `openhands 0.59.0` / `python 3.13.7`、headless CLI `python -m openhands.core.main --help` 可用。施工分支 `feat/w5ciii-openhands-real`。实测证据见 [`../reports/W5c-iii-真实容器实测-2026-11-02.md`](../reports/W5c-iii-真实容器实测-2026-11-02.md)。**矩阵 / index 仍停留在 `[BLOCKED]` 属回写前状态**，待本卡完成时按 P-12x 统一同步，不在施工期半同步。

> **拆卡立卡（2026-11-02 · P-118 · 经 Tina 授权）**：母卡 `TASK-W.5c` 第三张。**`[BLOCKED · 等容器环境]`**：硬前置为本机容器运行时可用 + `STAGENT_REAL_OPENHANDS=1`。P-116 只读核查已坐实本机**仅装 Docker CLI 29.6.1、无守护进程**（`~/.docker/run/docker.sock` 与 `/var/run/docker.sock` 均不存在，无 `dockerd` / `containerd` / `colima` / `lima` 进程，`podman` / `nerdctl` / `colima` / `lima` 未装，环境变量未设置）——**此时开工 `OS-06` 真实实测会空转**，须先备妥容器运行时并确认 daemon 可达。

* **任务编号**：`TASK-W.5c-iii`
* **任务名称**：OpenHands 适配器、真实容器隔离实测与 `verified_on` 绑定
* **对应规格**（R-1）：[`system-architecture.md`](./system-architecture.md) §9.1、§4.2.3 P-17、§2.7；[`../adr/0001-target-user-positioning.md`](../adr/0001-target-user-positioning.md) **ADR-0001**、[`../adr/0003-worktree-capability-boundary.md`](../adr/0003-worktree-capability-boundary.md) **ADR-0003**；母卡 `TASK-W.5c` 范围第 4/5/6 条与 PASS `OS-06` / `OS-07`；先例 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4a `TASK-W.5a` 黑盒实测纪律
* **前置依赖**（R-3）：**硬** `TASK-W.5c-i`（**`[COMPLETED]`** · #81/`c3e75cc`）、`TASK-W.5c-ii`（**`[COMPLETED]`** · #85/`648be31`，围栏逻辑与 `ContainerHostPort` 端口已就位，本卡只绑真实宿主并**把 `runInSandbox` 接进执行面**）——DAG 边 `i→iii`、`ii→iii`；**环境硬前置**：本机容器运行时可用（daemon 可达）+ `STAGENT_REAL_OPENHANDS=1`（**P-116 已坐实当前不满足，故本卡 `[BLOCKED]`**）；`TASK-W.6`（**COMPLETED**）
* **优先级**：P3 · **NON_BLOCKER**
* **状态**：`[IN_PROGRESS · 施工中]`（2026-11-02 开工：环境前置已满足，Tina 已解除阻断；施工分支 `feat/w5ciii-openhands-real`。**未完成、未宣称端到端闭环**，完成回写见 P-122）
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

#### 【Task W.7】Worker 自助注册与自动验证 `[NEW_TASK]` · **NON_BLOCKER**

* **任务编号**：`TASK-W.7`
* **任务名称**：前端自助注册任意 Worker；默认 `UNCONTROLLED_EXTERNAL`；自动探测通过后升格 `GATEWAY_ENFORCED`
* **对应规格**：架构 / W.1 适配器抽象；`daemon/worker/worker-adapter.interface.ts`；`src/lib/contract.schema.ts::workerSpecSchema`；先例 W.5b/c 人工实测 → 本卡产品化
* **前置依赖**：**硬** `TASK-W.6`（Registry 进派工，否则测完无池可进；**W.6 已于 2026-11-02 COMPLETED（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`），硬前置已解除**）；**软** `TASK-W.5c`（探测沙箱复用/对齐其容器隔离基建；**排程上 W.5c 为下一张，优先于本卡**）
* **优先级**：P3 · **NON_BLOCKER**（**不阻断** `TASK-L.16`；**不抢** W.5b/c 实测窗口；与 W.5b/c **不互斥**——本卡落地后 W.5b/c 可作为首批真实用例回归基准）
* **状态**：`[NEW_TASK]`（硬前置 W.6 已 COMPLETED，就绪障碍解除；但排程上 `TASK-W.5c` 系列为下一张，本卡不抢位、尚未开工）。**邻卡 DoR 正文状态**（2026-11-02 · P-119 同步）：`W.5c` 已于 P-115 按 DoR 重写达标、并经 P-118 授权拆为 `W.5c-i`（**`[COMPLETED]`** · #81/`c3e75cc`）/ `W.5c-ii`（**`[COMPLETED]`** · #85/`648be31`，P-121 同步）/ `W.5c-iii`（`[BLOCKED · 等容器环境]`，**Sprint 首要（阻断中）**）三张子卡，母卡标 `[SPLIT]` 保留追溯；`W.5b` 的 DOR-3 正文重写债仍在。
* **对照痛点（代码事实）**：
  1. 三层可扩展接口已在：`daemon/worker/worker-adapter.interface.ts::CodingWorkerAdapter`（`AdapterCapabilityDeclaration` 9 项 + `AdapterRejectionCode`）、`daemon/worker/adapter-registry.ts::AdapterRegistry`（`register` / `get` / `requireControlled`）、`src/lib/contract.schema.ts::workerSpecSchema`（`adapter_id` + `control_mode`；**三值** `GATEWAY_ENFORCED|SANDBOX_ENFORCED|UNCONTROLLED_EXTERNAL`，P-121 同步：原二值经 `W.5c-i` 扩三值、`W.5c-ii` 起派工门禁按容器宿主可用性判定）。
  2. ~~派工仍硬编码 `new AiWorker(...)`（`daemon/pipeline/orchestrator.ts`）~~ —— **已由 W.6（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`）改造为经 `AdapterRegistry` → `requireControlledDispatch` 派工工厂接线，本痛点已消除**；本卡不代替 W.6。
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
* **FAIL**：表单/API 直进受控档；探测无沙箱直接跑主树；报告宣称「绝对受控」；`SANDBOX_ENFORCED` 只改 `worker-adapter.interface.ts` 或只改 `contract.schema.ts` 单边；未满足就绪条件（硬前置 `W.6` 未 COMPLETED / DoR 未达标）却标本卡完成。
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

> **归档注记（2026-11-02 · P-112）**：本卡已 COMPLETED（[#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`，squash merge）。完整交付记录、残余边界与挂账见 [`development-tasks-completed.md`](./development-tasks-completed.md) §3.4f（锚点 `#task-l.17b`）。本处保留原始卡文以存追溯，不再作为施工依据；**M5 北极星主序收官**。

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

### 3.4e 台账债立卡（2026-11-01 · NON_BLOCKER · 不抢主序）


> Tina 授权将第一类六项写成任务卡。Sprint：主序实现卡 **`L.16` 已 COMPLETED**（#62/`e4dfe1c`）；**`L.17a` 已 COMPLETED**（#70/`8516c3d`）；**`TASK-L.17b` 已 COMPLETED**（#72/`d26def6`）——**M5 北极星主序（L.16 → L.17a → L.17b）全部落完，主序收官**。本节目的：把 ledger 待立卡改代码项变成可排期卡；`A.7`/`H.9`/`L.18`/`J.19`/`J.20`/`C.22`/`W.8`/`L.17a`/`L.17b` 已 COMPLETED（见 completed / #58/#60/#69/#70/#72）；**主序收官后债卡区推进**：`W.6` 已 COMPLETED（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，见 completed §3.4g）。**Sprint 排程已裁决写死（2026-11-02 · P-114）：`W.5c`（OpenHands 容器沙箱实测，兼作 `W.7` 探测沙箱地基）→ `W.7`（自助注册/自动验证 · 硬前置 W.6 已解除）→ `W.5b`（cursor-agent 实测，作 `W.7` 回归基准）**；`W.5b/c` 保留队列、不再列为待定项。**`ruling 3`（`check playtest` 接验收档）已于 P-114 落盘裁决**：北极星合同（带 `references[]`）的 `verification_spec.commands` 自动附加 `{alias:"playtest", executable:"stagent", args:["check","playtest","<contract_id>"]}`，试玩认可成为合并门禁；非北极星合同不附加；实现属小卡（合同装配段 + 测试），另行立卡或挂账（本轮未立卡、未开工）。裁决原文见 completed §3.4f、changelog P-114、ledger consistency-audit P-114。

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

