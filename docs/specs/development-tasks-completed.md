# 研发任务卡 · 已完成

> DOC-1 拆分产物：**已完成卡**（`COMPLETED`；含矩阵标 `PASS` 的 W.5a）。
> 枢纽与索引见 [`development-tasks.md`](./development-tasks.md)、[`development-tasks-index.md`](./development-tasks-index.md)。

### 3.1 契约基线与通信底座（Sprint 0 基础设施与演进）

<a id="task-0.2b"></a>

#### 【Task 0.2b】Schema v1.2.0 增量演进、双状态机联动与存量迁移
* **任务编号**：`TASK-0.2b`
* **前置依赖**：`TASK-0.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-20 交付，提交 `52c807c` 锁定基线；v1.3.1/v1.3.2 增补第 4 条 PREPARING 回退断言与 G-09 分列记账规范映射——G-15 错误码映射测试为 v1.3.0 已交付内容，非本次新增。**v1.3.3 口径更正**：该卡交付当日的用例数为历史快照，当前有效基线以最新一次 CI 实际运行结果 + 提交哈希为准；增量断言验证记录随下一次回归运行一并存档，不再单列"待补录"状态）
* **字段事实说明**：`max_command_executions` 与 `max_tool_calls` 已属于本卡交付字段；本卡不包含 v1.3.0 之后的新增合同迁移要求。
* **核心目标**：
  1. 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整定义，逐字段 100% 对齐 A §9.1/§9.2（含 `budget_limits` 可选 `max_command_executions` 与 `max_tool_calls`）。
  2. 落实 `can_merge` 派生不变式：`superRefine` 校验 `status === "PASSED"` 且无违规无超额；外部写入类型 `Omit<Verdict, "can_merge">`。
  3. 重构状态机校验器：实现 `validateStatePair` 与 `validateTransition`，落盘采用原子写入 (`writeTemp + fsync + rename`)。
  4. **补齐状态机 4 条关键分支断言 (G-17)**：
     - 正例：`ABORTED + APPROVED`（已批准后发生故障安全中止，保留历史审批记录）；
     - 负例：合同被拒绝 (`ABORTED + REJECTED`) 后不得原地回到 `DRAFT`；
     - 负例：`ABORTED` 为终态，不得经 `resume` 跃迁至 `EXECUTING`；
     - 异常回退联动：`PREPARING` 初始化异常中断时，lifecycle 回退 `PENDING_APPROVAL` 同步原子回置 `approval.status = "PENDING_REVIEW"`（杜绝以历史批准态静默重建 Worktree）。
  5. **补齐用量账本 3 项断言 (G-09)**：
     - 用量跨 Daemon 重启持久化重载一致；
     - 切换模型供应商后累计开销不清零；
     - 模型费用上限与命令/工具调用上限分列记账，独立触发熔断。
  6. **补齐 ErrorCode Catalog 完备性测试 (G-15)**：新建 `tests/unit/error-codes-mapping.test.ts`，表驱动测试 15 个 `error_code` 到 10 个 `reason_code` 的双向映射（新增 `E_UNSAFE_EXECUTION ➔ UNSAFE_EXECUTION`、`FRAME_DIRECTION_FORBIDDEN ➔ PROTOCOL_VIOLATION` 等）。
  7. 存量 v1.1.3 合同迁移工具：备份至 `.stagent/migrations/`，禁止静默执行，标记需显式重批。
* **涉及核心文件**：
  - 修改：`src/lib/contract.schema.ts`
  - 修改：`src/lib/evidence.schema.ts`
  - 新增：`src/lib/state-machine.ts`
  - 新增：`src/lib/error-codes.ts`
  - 新增：`src/lib/migration.ts`
  - 测试：`tests/unit/contract-schema-v12.test.ts`
  - 测试：`tests/unit/evidence-schema-v11.test.ts`
  - 测试：`tests/unit/state-machine-matrix.test.ts`
  - 新增测试：`tests/unit/error-codes-mapping.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - Schema 校验通过，`can_merge` 派生反向用例全部阻断成功。
    - `tests/unit/state-machine-matrix.test.ts` 完整通过 A §9.1.1 组合矩阵与 4 条新分支断言（含 PREPARING 初始化异常中断时，lifecycle 回退 `PENDING_APPROVAL` 同步原子回置 `approval.status = "PENDING_REVIEW"`，杜绝静默授权重建 Worktree）。
    - `tests/unit/error-codes-mapping.test.ts` 15 ➔ 10 双向映射 100% 通过。
    - 账本持久化与分列记账断言通过。
  - **FAIL**：缺少任一字段校验；状态机允许非法跃迁。

---


---

<a id="task-0.2c"></a>

#### 【Task 0.2c】Schema v1.3.0 增量演进、Fast Path 与自愈迁移边实现 `[认领架构 P0.2c / C-01]`
* **任务编号**：`TASK-0.2c`
* **前置依赖**：`TASK-0.2b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-23 交付：分支 `feat/task-0.2c-contract-v1.3-statemachine` 提交 `fb2cc67`，经 `cd7e7e0` 合入 main。落地内容：Schema 1.2.0/1.3.0 双版本白名单（新合同签发 1.3.0）、`creator` 增 `system:fast-path`、`authorization.git` 的 `allowed_operations`/`forbidden_flags`/`enforce_clean_base`（禁用参数强制内嵌五项、不可覆盖）、`approval` 增签名/准入决策/决策说明/驳回者并约束 `ADMITTED_AUTOMATIC` 仅限 `system:fast-path`；状态机增三条受控边——Fast Path `DRAFT→PREPARING`（Guard：系统凭证 + LOW 风险，`DRAFT→EXECUTING` 恒非法）、自愈 `PENDING_RESUME→PREPARING`（`WORKTREE_MISSING_HEAL`）、降级 `AUDITED→VERIFYING`（`EXTERNAL_MUTATION`）；`migrateContractToV13` 执行态族白名单回填 `user:legacy`，草案/待审保持原态并清除残留审批戳记，`ABORTED` 保留「批准后中止」历史。门禁：`tsc --noEmit` 0 错、eslint 0 错、全量 903 例（896 通过 / 6 跳过 / 1 例为 daemon 夹具 `git init` 被沙箱拦截的环境性失败，非断言失败）。偏差：审批枚举沿用架构 §9.1 的 `DRAFT/PENDING_REVIEW/APPROVED/REJECTED`（非任务书正文的 `PENDING/SUPERSEDED`）；lifecycle 保持 `VERIFYING`（规范无 `MERGING`）；`approved_at` 保持 ISO 字符串。未纳入本卡：`worker_spec` 的 `SANDBOX_ENFORCED`/`billing_model`/`verified_on`、顶层 `scope`、`EvidenceBundleV12`、未跟踪文件检查（由 TASK-W.2b 承担））
* **v0.1 范围**：数据模型从 v1.2.0 升级至 v1.3.0，实现审批与 Git 授权完整字段校验，增补 Fast Path、恢复自愈与外部改码降级三条关键状态转移边，升级存量合同无静默授权迁移。
* **核心目标**：
  1. **数据模型升级与 Zod 校验 (`src/lib/contract.schema.ts`)**：
     - 升级 `SoftwareContractV13` 与 `EvidenceBundleV12` 定义，严格对齐架构规范 §9.1；
     - 新增必填字段 `authorization.git`：包含 `allowed_operations: string[]`（白名单操作）、`forbidden_flags: string[]`（禁止参数，如 `--force`, `-f`, `--hard`, `--amend`, `--no-verify`）与 `enforce_clean_base: boolean`；
     - 新增必填字段 `approval`：包含 `status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED"`、`approved_by: string`、`approved_at: number`（可空）；
     - Zod 校验不变式：在 `SoftwareContractSchemaV13` 中使用 `superRefine` 校验当且仅当合同处于执行态族时 `approval.status` 必须为 `"APPROVED"` 且 `approved_by` 与 `approved_at` 非空。
  2. **状态机迁移路径闭环 (`src/lib/state-machine.ts`)**：
     - **Fast Path 直通流转边**：严格实现 `DRAFT -> PREPARING -> EXECUTING`，在 `validateTransition` 中坚决禁止任何跳过 `PREPARING` 的直跳边（违规抛出 `ILLEGAL_TRANSITION`）；
     - **外部改码级联降级边**：增设 `AUDITED -> VERIFYING`（触发原因：`EXTERNAL_MUTATION`），当外部文件修改导致 Evidence 降级为 `STALE` 时，原子将合同态从 `AUDITED` 拉回 `VERIFYING`，强制触发复检；
     - **恢复探测自愈边**：增设 `PENDING_RESUME -> PREPARING`（触发原因：`WORKTREE_MISSING_HEAL`），在 Daemon 恢复合同时若探测到工作树目录丢失，自愈回退至 `PREPARING` 重新物理检出；
     - 校验 9 种 lifecycle 状态迁移边矩阵，并验证 15 种展示状态投影；不得把展示态数量当作 lifecycle 状态数量。
  3. **存量合同向后兼容无静默授权迁移 (`src/lib/migration.ts`)**：
     - 实现 `migrateContractToV13(v12Contract)`：
       - 执行态族白名单回填：仅对处于 `{PREPARING, EXECUTING, VERIFYING, PENDING_RESUME, AUDITED, MERGED}` 的历史合同回填 `status: "APPROVED", approved_by: "user:legacy"`；
       - 待审与草案态安全保持：历史合同若处于 `DRAFT` 则回填 `status: "DRAFT"`；若处于 `PENDING_APPROVAL` 则回填 `status: "PENDING_REVIEW"`，**绝对严禁静默回填为 APPROVED**；
       - 中止态闭环分支：历史合同处于 `ABORTED` 则回填 `status: "REJECTED", rejected_by: "system:aborted"`；
       - `authorization.git` 默认安全填充：注入默认白名单与禁用参数。
* **涉及核心文件**：
  - 修改：`src/lib/contract.schema.ts`
  - 修改：`src/lib/state-machine.ts`
  - 修改：`src/lib/migration.ts`
  - 测试：`tests/unit/contract-schema-v13.test.ts`
  - 测试：`tests/unit/state-machine-v13-transitions.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：`contract-schema-v13.test.ts` 全绿；9 态 lifecycle 迁移边矩阵与 15 展示态投影测试通过；Fast Path (`DRAFT->PREPARING->EXECUTING`)、自愈 (`PENDING_RESUME->PREPARING`)、降级 (`AUDITED->VERIFYING`) 全部通过；迁移函数零静默授权（对 DRAFT 和 PENDING_APPROVAL 绝不输出 APPROVED）。
  - **既有基线守护**：开工前归档 `main`@`6d7fa59` 的实测结果（86 文件 / 785 通过 / 6 跳过）；完成后要求既有用例零非预期回归。重点运行 `tests/unit/state-machine-matrix.test.ts`、`tests/unit/migration-v113.test.ts`、`tests/unit/contract-schema-v12.test.ts`、`tests/unit/contract-auto-approve.test.ts`、`tests/e2e/happy-path.spec.ts`。矩阵测试任何既有期望的改动均须逐条记录原因及其对应的新合法边，不得为通过新测试而整体放宽矩阵。
  - **FAIL**：出现 `DRAFT -> EXECUTING` 直跳；迁移函数将未审批历史合同静默标记为 APPROVED；或既有测试失败而未说明并修复。

---

<a id="task-d.1"></a>

#### 【Task D.1】CLI 引导入口与安全 WebSocket 通信桥
* **任务编号**：`TASK-D.1`
* **前置依赖**：`TASK-0.2b`
* **任务状态**：**[COMPLETED]**（2026-10-20 交付；验证：`npm test` 全量 48 文件 / 377 用例绿、`tsc --noEmit` 0 错误、eslint 0 违规、verify-env 通过；变更明细与偏差记录见本节末尾「D.1 交付附注」）
* **核心目标**：
  1. CLI 工具 (`stagent start`)：动态端口 (3001~3010) 探测、PID 锁获取（若已被存活进程占用抛出 `E_WORKSPACE_LOCKED` 拒绝重复启动）、Token 写入 (`.stagent/session-token`，权限 `0600`) 并唤起浏览器。
  2. **首帧 AUTH 鉴权闭环**：首帧必须为 `{ type: "AUTH", payload: { token } }`，校验失败立即以关闭码 `4401` 断开连接，不产生无限重连；服务端日志严禁打印 Token 明文。
  3. **规范 WS 帧字典 (G-02)**：
     - 同时保留 `EVIDENCE_READY`（证据生成完成待核销）与 `EVIDENCE_STATUS_CHANGED`（状态流转与外部变动失效）以及 `TERMINAL_STREAM`（命令执行流式日志）。
  4. **补齐 Origin、速率与心跳防护 (G-12/G-13)**：
     - 校验 `Origin`，仅放行本地合法来源 (`http://127.0.0.1:*` / `http://localhost:*`)，拒绝非法来源；
     - 限制单连接帧大小 ≤ 2MB，限制连接频率防 DoS；
     - 客户端 5s 心跳 PING，连续 3 次未收到 PONG（15s）在前端呈现重连遮罩；
     - Daemon 获取 PID 锁后强制轮换 Token，崩溃残留旧 Token 自动失效。
* **涉及核心文件**（已按仓库实际布局修正，见文末「路径映射约定」）：
  - 修改：`bin/stagent.ts`（CLI 入口：参数解析、动态端口探测、PID 锁检查与浏览器唤起）
  - 修改：`daemon/server.ts`（WS 服务端：首帧握手鉴权、Origin/Host 校验、帧大小与速率限制）
  - 修改：`src/lib/ipc/frames.ts`（帧字典与 FRAME_CATALOG：Daemon 与 UI 共享双向通信协议规范）
  - 修改：`src/lib/ipc/client.ts`（前端 WS 客户端：心跳探测与 15s 失联判定）
  - 修改：`src/lib/daemon-api.ts`（Token 仅经 `#fragment` 引导传递，删除 `?token=` query 通道）
  - 修改：`src/hooks/use-daemon-stream.ts`（前端 React Hook：连接管理、心跳状态与帧分发）
  - 测试：`tests/unit/ws-auth-handshake.test.ts`（首帧握手 / 50ms 切断 / Token 轮换 / 日志无明文）
  - 测试：`tests/unit/ws-frame-dictionary.test.ts`（13 类规范帧 + 目录完备性）
  - 测试：`tests/unit/cli-entry.test.ts`（参数解析 / fragment 构造 / 平台 opener）
  - 测试：`tests/daemon/ws-security.test.ts`（Origin / Host / 2MB / 速率 429 / query 禁令 / 方向门禁 / 默认端口）
  - 测试：`src/hooks/use-daemon-stream.test.tsx`（3 次心跳失联 → reconnecting）、`src/tests/daemon-api-token.test.tsx`（query 忽略 / fragment 抹除）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 工作区检测到已有存活 PID 锁时，启动失败并返回/抛出 `E_WORKSPACE_LOCKED`，拒绝重复占用工作区。
    - 首帧非 AUTH 或 Token 错误在 50ms 内被 4401 切断。
    - 非法 Origin 连接被直接拒绝。
    - 模拟 3 次心跳丢失触发 UI 重连遮罩。
    - Token 轮换断言：新实例启动后，旧 Token 发送 AUTH 必然返回 4401。
  - **FAIL**：允许 URL Query 传 Token；未鉴权连接可接收广播帧。
* **D.1 交付附注**（2026-10-20）：
  - 心跳判定修正为「AUTH_OK 立即 PING，第 3 次失联落在 15s」（原实现为 20s，off-by-one）；UI 遮罩由 `status === "reconnecting"` 驱动，遮罩组件本体属 TASK-C.1。
  - 增强项（不超出规范）：Host 头回环校验（DNS Rebinding 防线，A §6.1"校验 Origin 与会话权限"的补足，因重绑定后 GET 不带 Origin）；WS `maxPayload = 2MB`（超限以 1009 关闭）；连接速率限制默认 30 次/10s/IP 可配置；帧方向门禁（客户端伪造 `server->client` 帧返回 `FRAME_DIRECTION_FORBIDDEN` 错误帧，不断连）。
  - 规范设计与符合项说明：① Origin 白名单放行 `::1` 属于 loopback 本地回路的标准符合项；② 浏览器唤起时 Token 经 URL **fragment**（`#token=`）传递 —— A §6.1 未指定页面凭证透传通道，fragment 不随 HTTP 请求发送且读取后立即 `history.replaceState` 抹除，完全满足"日志不得记录 token"的要求；③ `WORKER_LOG`/`SCOPE_ALERT` 两个 v1.1 历史扩展帧按 A §6.1"至少包括"措辞保留，证据失效现已同时广播规范帧 `EVIDENCE_STATUS_CHANGED`。
  - 端口默认值由 41792~41802 修正为本卡片的 3001~3010（`daemon/server.ts`、`src/lib/daemon-api.ts`）。

---


---

<a id="task-d.1b"></a>

#### 【Task D.1b】一键打开项目（Daemon 托管控制台 + open CLI）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-D.1b`
* **前置依赖**：`TASK-D.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `d5b35e0`；分支 `feat/task-d1b-one-click-open` 功能 `946e9fc`。门禁：合后四件套全绿（1188 passed / 6 skipped）；tsc 0 错、eslint 0 errors、build 通过。落地清单：`bin/stagent.ts`（`open` 子命令：复用健康 Daemon / 新启、同源或 Vite+#base=、自动唤起浏览器）、`daemon/console/static-host.ts` + `daemon/server.ts`（同源托管 SPA 仅 `/`/`/index.html`+资产）、`daemon/core/pid-lock.ts` + `src/lib/error-codes.ts`（`E_WORKSPACE_LOCKED` 白话）、`src/lib/daemon-api.ts`（`#token=&base=` 解析与同端口段推断）、`OpenProjectEntry` / README、`scripts/package-dist.mjs` 写入 `dist/public/index.html`。**口径说明**：① 控制台同源托管不改变 D.1 AUTH/fragment/Origin；② Demo 仍 4100~4110 独立 Origin；③ 无 `dist/public` 时回退 Vite 5173 并在 fragment 注入 `base=`。**残余口径差**：最近项目列表已交 `TASK-D.1c`（COMPLETED）；**同源托管空白页**已交 `TASK-D.1d` 并合入 main tip `b11d15b`（COMPLETED）；不含 Electron/Tauri/系统协议）
* **对照痛点**：当前启动常需第二终端 + 手拷 Token；目标体验接近 Cursor「打开项目」——一条命令、单浏览器窗口即可聊。
* **v0.1 范围**：`stagent open <路径>` → Daemon 托管 `dist/public` 同源控制台 + 自动唤起浏览器 `#token=` fragment → 工作台已连上；可选最近项目列表；Demo 仍独立 Origin（4100~4110），不与控制台同源。底座复用 D.1（端口/PID 锁/Token/AUTH/Origin），只补 DX 粘合、不重砌鉴权。
* **明确不包含**：
  - Electron / Tauri 桌面壳
  - 系统自定义协议（可后续）
  - 推翻 D.1 鉴权模型（仍须 AUTH / fragment Token / Origin 校验；日志不得打印 Token 明文）
  - 修改《系统架构设计规范》或另开 ADR
* **核心目标**：
  1. **一条命令打开**：`stagent open <工作区路径>`（或无参走最近项目）启动/复用本工作区 Daemon，托管控制台静态资源（与 Daemon 同源），自动 `open` 浏览器至带 `#token=` 的控制台 URL；用户无需第二终端、无需手拷 Token。
  2. **鉴权不变**：无钥匙（无 fragment / 未 AUTH）地址连不上工作台；Token 仍经 fragment 传递并立即抹除；服务端日志严禁打印 Token 明文（继承 D.1）。
  3. **换项目 / 锁冲突白话**：对另一路径再 `open` 打开新项目；若目标工作区已有存活 PID 锁，抛出/展示白话 `E_WORKSPACE_LOCKED`（或等价提示），不静默抢占。
  4. **Demo 仍独立 Origin**：S.4 Demo 预览继续 4100~4110 独立 Origin + 严 CSP；控制台同源托管不得让 Demo iframe 获得 Daemon 同源权限。
* **涉及核心文件（实施时以实际接线为准，本卡仅定范围）**：
  - CLI：`bin/stagent.ts`（或等价）新增 `open` 子命令；可选最近项目落盘
  - Daemon：托管 `dist/public` 静态控制台（同源）；复用 D.1 端口/PID 锁/Token/AUTH
  - 前端：无钥匙入口拒绝；fragment Token 读取与抹除（既有 D.1）
  - 测试：open CLI、无 Token 拒绝、锁冲突白话、Demo Origin 隔离回归
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **一条命令单窗口可聊**：在空目录或已有项目上执行 `stagent open <路径>`，只出现一个浏览器窗口，工作台已连上并可与右侧聊天（无需第二终端、无需手拷 Token）。
  2. **无钥匙连不上**：打开不带有效 `#token=` / 未 AUTH 的控制台地址，工作台连不上（不得旁路 D.1 鉴权）。
  3. **换路径 / 锁冲突白话**：对另一路径 `open` 打开新项目；若工作区已锁，用户看到白话锁冲突提示（如 `E_WORKSPACE_LOCKED`），不静默抢占。
* **Pass/Fail 验收判定**：
  - **PASS**：上述断言 1–3 均可在本地手测复现；Demo 仍独立 Origin；日志无 Token 明文；不引入 Electron/系统协议。
  - **FAIL**：仍要求用户拷 Token 或开第二终端；无钥匙可进工作台；Demo 与控制台同源导致 iframe 可打 Daemon；打印 Token 明文；把缺口塞回已完成的 D.1 而不立本卡。

---

<a id="task-d.1c"></a>

#### 【Task D.1c】最近项目一键重开（控制台「打开项目」）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-D.1c`
* **前置依赖**：`TASK-D.1b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `f3e371e`；分支 `feat/task-d1c-recent-projects` 快进合入。门禁：合后四件套全绿（1204 passed / 6 skipped）；tsc 0 错、eslint 0 errors、build 通过。落地清单：`daemon/core/recent-projects.ts`（用户级 `~/.stagent/recent-projects.json` 0600，非业务仓保护区）、`daemon/core/open-workspace.ts`（复用健康 Daemon / spawn 本仓 `stagent start`）、`daemon/server.ts`（`GET/POST /api/recent-projects`）、`bin/stagent.ts`（open 成功写入最近）、`OpenProjectEntry` + `daemon-api`（列表渲染 / 一点重开带 `#token=`）、spawn 白名单登记。**口径说明**：① 不含任意路径文件夹选择器；新路径首次仍走 `stagent open`；② 不推翻 D.1/D.1b AUTH/fragment/Origin；③ 锁冲突白话 `E_WORKSPACE_LOCKED`。**残余口径差**：真·任意路径选择器留给 `TASK-D.1e`（可 defer：本机助手/Electron）；同源空白已由 `TASK-D.1d` 合入 `b11d15b` 收口）
* **对照痛点**：D.1b 后仍常要在终端敲 `stagent open <路径>`；用户期望在已打开的控制台里点「打开项目」看到最近列表，一点即进带钥匙会话（接近 Cursor「最近打开」）。
* **v0.1 范围**：控制台「打开项目」入口展示最近工作区列表；点击某一项 → 复用健康 Daemon 或按 D.1b 路径唤起 → 打开/切换到带 `#token=`（及必要 `#base=`）的同源控制台会话，无需再敲 `stagent open`。最近列表由本机受控落盘（如用户级或 `.stagent` 旁的最近路径记录），在 `open` / 成功连接时更新。**明确不含**浏览器真·任意路径文件夹选择器（留给后续本机小助手 / Electron）。
* **明确不包含**：
  - 真·任意路径文件夹选择器（`<input type="file" webkitdirectory>` 或系统对话框选任意本地路径）
  - Electron / Tauri 桌面壳、系统自定义协议
  - 推翻 D.1 / D.1b 鉴权（仍须 AUTH / fragment Token / Origin；日志不得打印 Token 明文）
  - 修改《系统架构设计规范》或另开 ADR
* **核心目标**：
  1. **最近列表看得见**：已连上的控制台里，「打开项目」展示最近工作区路径列表（空列表时白话提示：可用 `stagent open <路径>` 首次打开后出现在此）。
  2. **一点即重开带钥匙**：点击列表中某一项，复用/唤起该工作区 Daemon 并进入已带 `#token=` 的会话（同源或既有 D.1b `#base=` 回退），用户无需再敲 `stagent open`、无需手拷 Token。
  3. **不含任意路径选择器**：本卡不提供「浏览磁盘选任意文件夹」；新路径首次仍走 D.1b CLI（或后续本机助手/Electron 卡）。锁冲突时白话 `E_WORKSPACE_LOCKED`（或等价），不静默抢占。
* **涉及核心文件（实施时以实际接线为准，本卡仅定范围）**：
  - 前端：控制台「打开项目」/最近列表 UI（可扩展既有 `OpenProjectEntry`）
  - 最近记录：本机受控落盘读写（路径规范化、上限条数、去重）；`open` / 成功连接时更新
  - Daemon / CLI：复用 D.1b 复用健康 Daemon、同源托管、`#token=&base=` 唤起；可选轻量 API 供控制台请求「打开某最近路径」
  - 测试：最近列表渲染、一点重开带 token、无钥匙拒连回归、锁冲突白话；负例：本卡不出现任意路径系统选择器
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **最近列表看得见**：在控制台点「打开项目」，能看到最近打开过的工作区列表（至少含曾用 `stagent open` 成功打开的路径）。
  2. **一点即带钥匙可聊**：点击列表中某一项后，进入/切换到该项目工作台且已连上（带有效钥匙），无需再敲 `stagent open`、无需手拷 Token。
  3. **不含任意路径选择器**：本卡交付界面没有「浏览磁盘选任意文件夹」；新项目首次仍用 D.1b CLI；无钥匙地址仍连不上；锁冲突白话提示。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–3 均可在本地手测复现；不引入 Electron/任意路径选择器；日志无 Token 明文；不推翻 D.1/D.1b。
  - **FAIL**：仍只能靠终端 `stagent open` 重开最近项目；一点后仍要手拷 Token；夹带真·任意路径选择器却标本卡完成；把缺口塞回已完成的 D.1b 而不立本卡。

---

<a id="task-d.1d"></a>

#### 【Task D.1d】修复同源控制台空白（生产可用单窗口）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-D.1d`
* **前置依赖**：`TASK-D.1b` (COMPLETED), `TASK-C.2` (COMPLETED)；建议亦具备 `TASK-D.1c` (COMPLETED) 以便最近重开联调，**不以 D.1c 为硬阻断**
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `b11d15b`；分支 `feat/task-d1d-same-origin-console` 快进合入。门禁：合后四件套全绿（**1208 passed / 6 skipped**）；tsc 0 错、eslint 0 errors、build 通过。落地清单：启用 `tanstackStart.spa`；`scripts/package-dist.mjs` 将预渲染 `_shell.html` 提升为 `dist/public/index.html`；`daemon/console/static-host.ts` 仅托管含 `$_TSR` + `index-*.js` 的可 hydrate 壳；新增/扩展 `console-dist-spa-shell` 等 dist 静态可用性回归。**口径说明**：① 根因=空白 `index.html` + `hydrateRoot(document)` 不匹配，且 static-host 曾忽略 SPA `_shell.html`；② 不推翻 D.1 loopback+#token/AUTH/Origin；③ Demo 仍 4100~4110 独立 Origin；④ Vite+#base 可保留为开发态可选绕路，不再是生产必经。对照：见 Git 历史（原 `docs/archive/open-project-vision-and-status.md`）。**本轮文档回写不改**架构规范（已有注记 8））
* **对照痛点 / 已修复缺陷（合入前）**：D.1b 宣称「同源单窗口」；合入前 `scripts/package-dist.mjs` 写入的 `dist/public/index.html` 为极简静态壳（仅挂 `assets/index-*.js`），TanStack Start 无法完成客户端启动 → `http://127.0.0.1:30xx/#token=…` 常见空白页。临时绕路曾为 Vite + `#token=` / `#base=`。**合入 `b11d15b` 后**：生产路径以可 hydrate SPA 壳为准，不再把残缺空白壳标为已验收。
* **v0.1 范围**：使 Daemon 同源托管的控制台在 `stagent open` 后**生产可用**——单浏览器窗口展示完整三栏工作台并完成 AUTH 连接，可与右侧聊天；不再依赖「必须再开 Vite」才能用。允许保留 Vite+#base 作为开发态可选绕路，但不得再把空白壳标成已验收的单窗口体验。
* **明确不包含**：
  - 推翻 D.1 鉴权（仍须 `127.0.0.1` + `#token=` fragment + WS AUTH + Origin；日志不得打印 Token 明文）
  - 将 Demo 预览改为与 Daemon/控制台同源（Demo 仍 4100~4110 独立 Origin + 禁 `allow-same-origin`）
  - Electron / Tauri / 系统文件夹选择器（归 `TASK-D.1e`）
  - 重开 S.6 八步旅程或 W.5b/c 施工适配
* **核心目标**：
  1. **同源页不再空白**：`npm run build` 后 `stagent open <路径>` 打开的 Daemon 端口页面须渲染完整工作台（非白屏），`#token=` 完成连接。
  2. **单窗口可聊**：无需第二终端手拷 Token、无需必须再起 Vite，即可右侧聊天（开发态 Vite+#base 可保留为可选）。
  3. **安全与隔离不回退**：无钥匙仍连不上；Demo 独立 Origin 回归仍绿；锁冲突白话。
* **涉及核心文件（实施时以调查为准，本卡不锁死改法）**：
  - 构建装配：`scripts/package-dist.mjs`（当前 `writeConsoleIndexHtml`）、`dist/public/**`
  - 托管：`daemon/console/static-host.ts`、`daemon/server.ts`
  - 前端启动：TanStack Start / Vite 客户端入口与路由水合所需资源（可能需 client-only 构建或正确 SSR 静态导出——**由实现卡调查后选定，文档不预设唯一根因处方**）
  - 测试：同源 open 冒烟（非空白 + 已连接）、无 Token 拒连、Demo Origin 隔离回归；可选 Playwright/组件级「根节点可见」
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **同源不再空白**：`npm run build` 后执行 `stagent open <临时目录或样例仓>`，打开的 Daemon 同源 URL（含 `#token=`）在合理时间内出现工作台主壳（左/中/右结构可见），**不是**持续空白 HTML。
  2. **单窗口可聊**：同一窗口内完成连接后，右侧输入框可用（发一条非破坏性消息或至少出现已连接会话态）；无需用户再开 Vite 或手拷 Token。
  3. **无钥匙仍拒连**：去掉或篡改 `#token=` 后工作台连不上（不旁路 D.1）。
  4. **Demo 仍独立 Origin**：S.4 Demo 预览仍在独立端口 Origin；控制台同源不得使 Demo iframe 获得 Daemon 同源权限（禁 `allow-same-origin` 等既有负例仍过）。
  5. **门禁**：四件套全绿（`npm test` / `typecheck` / `lint` 0 errors / `build`）；新增或扩展 **`dist` 静态打包产物可用性回归**（build 后同源入口可挂载，禁止再把残缺空白壳标为 PASS）。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 本地可复现；日志无 Token 明文；不引入桌面壳冒充本卡完成。
  - **FAIL**：同源仍空白却标完成；只能靠 Vite 才算「能用」却声称 D.1d 完成；无 dist 静态可用性回归却标完成；Demo 与控制台同源可打 Daemon；打印 Token 明文。

---

<a id="task-d.3"></a>

#### 【Task D.3】15 状态确定性投影持久化与防死锁自愈引擎
 `[认领架构 P3.7]`
* **任务编号**：`TASK-D.3`
* **前置依赖**：`TASK-0.2c`, `TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-23 合入 main，merge `9a19f4d`；分支 `feat/task-d3-deadlock-persistence`：`c2fcb8a`（持久化 / 投影广播 / D-1~D-5 引擎）+ `83ec516`（D-2/D-4/D-5 生产接线）；首段投影词汇表仍为 `f548aeb` / `cd7e7e0`。门禁：合后四件套全绿（1084 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过。落地清单：`src/lib/state/presentation-state.ts`（15 态词汇表，daemon/前端共用）、`daemon/state/presentation-store.ts` / `presentation-projector.ts`（`.stagent/state.json` 落盘，不写回合同）、`daemon/state/deadlock-resilience.ts`（可注入时钟 + `sweep`；D-1~D-5）、`daemon/core/contract-mutex.ts`（D-2 租约观察者 + 锁文件白名单回收）、`daemon/pipeline/merger.ts`（D-4 `assertTargetBranchNotAdvanced` + `TargetBranchAdvancedError`）、`daemon/pipeline/orchestrator.ts`（`replayOnCurrentBaseline` / `healResume` / 超时证据）、`daemon/mcp/gateway.ts` + `daemon/runner/command-runner.ts`（D-5 分层登记与 pid 回填）、`daemon/server.ts`（回收钩子、`POST .../merge` 409 options、`POST .../merge-decision`）。**口径说明**：① 展示态变化不写进合同，避免误触发 `contract_revision` 重新审批；② 看门狗不用裸 `setTimeout`，由心跳驱动 `sweep`，挂起恢复后一次补齐过期项；③ D-1 强杀经 `orchestrator.abort` → runner 进程树 SIGTERM→SIGKILL（Daemon 无独立 worker pid 登记表）；④ D-5 超时证据借用 `BLOCKED + BUDGET_EXHAUSTED` + `TIMEOUT:` 前缀（Evidence verdict 无独立 `TIMEOUT` 枚举）。**残余口径差（不阻塞验收，需登记）**：① D-4 仅比证据 `base_commit_sha` 与当前 main tip，不校验工作树真实 merge-base；② 沙箱 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 配额耗尽时 D-2 盘上锁文件断言可跳过（租约事件断言仍严格）；③ 信息不足时投影返回 `null`，界面停在上一帧而不猜状态）
* **v0.1 范围**：15 种展示状态确定性映射引擎、`presentation_state` 持久化落盘与 WebSocket 广播、五类死锁自愈机制 (D-1~D-5)。
* **核心目标**：
  1. **确定性状态投影引擎 (`daemon/state/presentation-state.ts`)**：
     - 严格实现架构规范 §6.3.1 的唯一 15 态词汇表，输入 `(approval.status, lifecycle_state)` 及运行时上下文；以下每一对均明确按该顺序书写，不能把 lifecycle 与 approval 对调：
       - `(DRAFT, DRAFT) + demo_service.status !== "RUNNING" ➔ EXPLORING`
       - `(DRAFT, DRAFT) + demo_service.status === "RUNNING" ➔ DEMO_PREVIEW`
       - `(APPROVED, PREPARING) + DAG 生成中 ➔ GRAPH_MAPPING`
       - `(PENDING_REVIEW, PENDING_APPROVAL) + 等待用户授权 ➔ NEEDS_APPROVAL`
       - `(APPROVED, EXECUTING) + stopping_requested === false ➔ EXECUTING`
       - `(APPROVED, EXECUTING) + stopping_requested === true ➔ STOPPING`
       - `(APPROVED, PENDING_RESUME) + suspend_reason 已设置 ➔ PAUSED`
       - `(APPROVED, VERIFYING) + verification_passed !== false ➔ VERIFYING`
       - `(APPROVED, VERIFYING) + verification_passed === false 且 retry_count < max_retries ➔ FAILED`
       - `(APPROVED, AUDITED) + real_preview.status === "RUNNING" 且无质疑 ➔ REAL_PLAYTEST`
       - `(APPROVED, AUDITED) + dispute_session.status === "OPEN" ➔ DISPUTED_INSPECTING`
       - `(APPROVED, AUDITED) + evidence.can_merge === true 且无冲突 ➔ READY_TO_MERGE`
       - `(APPROVED, AUDITED) + 检测到目标分支推进 ➔ CONFLICT`
       - `(APPROVED, MERGED) ➔ MERGED`
       - `(REJECTED 或 APPROVED, ABORTED) ➔ ABORTED`（保留历史审批事实，对齐架构 §9.1.1 配对矩阵）
       - **`(APPROVED, AUDITED)` 四分支判定优先级（必须按序短路求值，安全优先）**：`CONFLICT` > `DISPUTED_INSPECTING` > `REAL_PLAYTEST` > `READY_TO_MERGE`；即目标分支已推进时即使存在 OPEN 质疑也先呈现 `CONFLICT`，存在 OPEN 质疑时即使真机预览在跑也先呈现 `DISPUTED_INSPECTING`，禁止四者同真时的实现自由裁量。
       - 上述为架构 §6.3.1 的全部 15 种用户可见状态；禁止引入旧版 `CONTRACT_REVIEW`、`GRAPH_ORCHESTRATING`、`PREPARING` 等额外展示态。底层非执行态中间转换不得伪装为第 16 个 UI 状态。
     - 将派生出的 `presentation_state` 持久化写入 `.stagent/state.json`；
     - 通过 WebSocket 向 UI 实时广播状态变更帧，断线重连能够瞬间无损还原界面视图。
  2. **五类死锁自愈看门狗 (`daemon/state/deadlock-resilience.ts`)**：
     - **D-1 停止超时看门狗**：`STOPPING` 态超过 15 秒触发强杀看门狗，发送 SIGKILL 回收子进程，强制释放工作区互斥锁，原子转入 `ABORTED`；
     - **D-2 孤儿锁与租约心跳**：互斥锁租约设为 60 秒，Daemon 心跳周期 15 秒续租；超过 90 秒无心跳自动判定为崩溃死锁，由看门狗安全回收释放；
     - **D-3 恢复自愈探测**：`PENDING_RESUME` 时探测任务工作树物理存在性，若已被外部意外删除，自动触发 `PENDING_RESUME -> PREPARING` 重建自愈；
     - **D-4 目标分支前进二选一**：合并前检测目标分支向前推进，提示【以当前分支为基线重演】或【放弃候选成果】，禁止前端死锁；
     - **D-5 分层超时机制**：命令执行按 60s/300s/600s 分层看门狗兜底，超限安全回收并生成 TIMEOUT 证据。
* **涉及核心文件（以实际落地为准）**：
  - 共享词汇表：`src/lib/state/presentation-state.ts`（首段 `f548aeb`；daemon/前端共用）
  - 新增：`daemon/state/presentation-store.ts`、`daemon/state/presentation-projector.ts`
  - 新增：`daemon/state/deadlock-resilience.ts`
  - 修改：`daemon/core/contract-mutex.ts`、`daemon/mcp/gateway.ts`、`daemon/pipeline/merger.ts`、`daemon/pipeline/orchestrator.ts`、`daemon/pipeline/contract-store.ts`、`daemon/runner/command-runner.ts`、`daemon/server.ts`
  - 测试：`tests/unit/presentation-state.test.ts`、`tests/unit/presentation-persistence.test.ts`、`tests/unit/deadlock-resilience.test.ts`、`tests/unit/deadlock-call-sites.test.ts`、`tests/integration/merge-decision-d4.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：架构 §6.3.1 的 15 种展示状态均由明确的 `(approval.status, lifecycle_state)` 二元组及运行时判据确定性派生；D-1~D-5 故障注入测试 100% 成功解除死锁，断网断线重连无数据丢失。
  - **FAIL**：前端展示态脱离底层物理状态伪造；子进程卡死超过 15 秒未强制回收导致锁悬挂。

---

### 3.2 Supervisor 建议中枢、原型生成、质疑自查与非技术旅程串联（v1.5.0 全生命周期升级；含 S.6）

<a id="task-s.1"></a>

#### 【Task S.1】Supervisor 建议会话与持久化存储管理
* **任务编号**：`TASK-S.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `a9066dd`；分支 `feat/task-s1-throttler` 提交 `a7d7292`。门禁：合后四件套全绿（1122 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过（dist 33 文件 / 3.35 MB）。落地清单：既有会话/Prompt/权限/独立预算分账 + `daemon/supervisor/throttler.ts`（`SupervisorWakeupThrottler`，`idleDebounceEnabled` 默认 `false`）+ `tests/unit/supervisor-debounce-trigger.test.ts`（**23 例**：默认关闭 5 + 历史开启态 18）。规则优先 L0/L1 仍记在 TASK-S.2。**口径说明**：①「对话停顿 3s」默认关闭，显式点击/控制面阻断/回合结束仍立即唤醒；② Worker `STREAMING`/`TOOL_RUNNING` 硬静默；③ `SNOOZE` 默认 10 分钟；④ `mapWakeTriggerToDraftTrigger` 对齐 draft-generator 枚举（`IDLE_DEBOUNCE`→`DEBOUNCE_TIMER` 双保险）。**残余口径差（不阻塞验收，需登记）**：① Daemon 聊天/会话路由侧尚未挂载节流器实例（模块已从 `daemon/supervisor/index.ts` 导出，合入后接聊天即可）；② 旧版「完成记录」中 2026-10-22 归档校正注仍保留为历史，勿与本轮交付混读）
* **核心目标**：
  1. Local-First 会话管理，落盘至 `.stagent/sessions/{session_id}.json`，文件模式 `0600`。
  2. 依赖层 AST 扫描禁令：禁止引入 Gateway/Merger/Verifier/ProcessRunner/child_process。
  3. **落实运行时越权调用拦截正例断言 (G-11b)**：
     - 若 Supervisor 上下文尝试调用 `approveContract`、`mergeContract`、`setVerdict`、`execCommand`，底层控制面坚决抛出权限拒绝异常，产生 `GATEWAY_VIOLATION` 审计事件。
  4. **预算分账（v1.3.3 修订）**：Supervisor 拥有独立日预算（`.stagent/supervisor-budget.json`），**不再计入当前合同账本**；Supervisor 预算耗尽不影响 Worker 执行；Worker 合同账本不得含 Supervisor 用量。
  5. **唤醒节流器（v1.3.3 修订：规则优先 L0/L1）**：严禁伴随 Worker 逐 Token 轮询。唤醒时机修订为：① 用户显式请求；② Gateway 违规/熔断事件；③ Worker 回合结束且 diff 触及保护区。**「对话停顿 3s 即评估」默认关闭**（throttler 代码保留，配置开关控制）；VIBE 下 30 分钟连续聊天 Supervisor 模型调用应为 0（除非用户点击）。三类时机（修订前存档）：
     - ① 对话流静默 3s（输入停顿 Debounce 窗口）——**v1.3.3 默认关闭，仅保留代码与可配置开关**；
     - ② 用户在 UI 显式点击建议卡/请求分析（实测启用）；
     - ③ 捕获到 Daemon 抛出的 `BLOCKED`、连续测试失败或预算报警事件（实测启用）。
     - **断言（v1.3.3 口径）**：Worker 流式生成过程中 Supervisor 模型请求触发次数为 0；时机 ②③ 触发率 100%；时机 ① 在开关关闭时触发次数必须为 0。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`daemon/supervisor/session-manager.ts`
  - 新增：`daemon/supervisor/prompt-builder.ts`
  - 新增：`daemon/supervisor/types.ts`
  - 新增：`daemon/supervisor/throttler.ts`（唤醒节流器：3s 防抖 + 三类唤醒时机 + Worker 流式静默 + SNOOZE）
  - 测试：`tests/unit/supervisor-session.test.ts`
  - 测试：`tests/unit/supervisor-zero-tool-lint.test.ts`
  - 测试：`tests/unit/supervisor-runtime-permission.test.ts`
  - 测试：`tests/unit/supervisor-debounce-trigger.test.ts`（Worker 流式生成期间零模型调用断言、3s 停顿与事件唤醒测试）
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 会话文件原子落盘与恢复成功。
    - 静态依赖 AST 扫描零违规。
    - 运行时越权调用测试：调用审批/合并/写入 verdict/执行命令 100% 抛错被拒并记录告警。
    - 唤醒节流器测试：在 Worker 流式生成期间 Supervisor 模型调用次数严格为 0；UI 显式请求与控制面异常事件 100% 正确触发；3s 防抖开关关闭时零触发、开启时按既有 18 用例通过。
    - Supervisor 独立预算耗尽时模型调用被阻断，且**不影响 Worker 继续执行**（v1.3.3）。
  - **FAIL**：Supervisor 能绕过控制面直接执行命令或修改工作区，或在 Worker 流式生成过程中伴随发起模型轮询。
* **完成记录（历史记录 · 旧版 S.1，2026-10-20；当时 3s 防抖默认开启，非 v1.3.3 口径）**：
  - ⚠️ **2026-10-22 归档校正**：以下 `throttler.ts` 与 18 例**不在 main**，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`（`2319459`）；main 上 `1a75616` 只含 `session-manager.ts` / `prompt-builder.ts` / `permissions.ts` / `budget.ts` 四文件。本段整体保留为历史记录，**不得作为 v0.1 验收依据**。
  - 交付物：`daemon/supervisor/throttler.ts`（`SupervisorWakeupThrottler`）+ `daemon/supervisor/index.ts` 导出。
  - 测试：`tests/unit/supervisor-debounce-trigger.test.ts`，共 **18 个用例**全部 PASS，分组如下：
    | 分组 | 用例数 | 覆盖断言 |
    |---|---|---|
    | 防抖窗口 | 3 | 3s 内 5 次输入仅 1 次评估（`coalesced_inputs=5`）；2999ms 不触发 / 3000ms 触发；持续输入重置窗口 |
    | 显式唤醒 | 2 | 显式点击立即触发并取消待触发窗口；连续显式请求各自触发 |
    | Worker 静默 | 3 | STREAMING / TOOL_RUNNING 期间 `model_calls` 严格为 0；静默开始时取消已排队窗口 |
    | 静默解除 | 4 | Turn End 解除静默并触发；积压阻断合并为 `WORKER_BLOCKED`；解除后防抖恢复；Turn End 合并待触发输入不重复评估 |
    | 控制面阻断 | 1 | 空闲态阻断事件立即唤醒 |
    | SNOOZE | 2 | 10 分钟静默期内全部拒绝；到期自动恢复 |
    | 生命周期/可观测性 | 3 | `dispose()` 清窗；评估异常被捕获不阻断后续；统计口径仅放行递增 `model_calls` |

---


---

<a id="task-s.2"></a>

#### 【Task S.2】按需合同草案生成引擎（L0 规则 / L1 强模型；v1.3.3 拆分精简）
* **任务编号**：`TASK-S.2`
* **前置依赖**：`TASK-S.1`
* **任务状态**：**[COMPLETED]**（v0.1 精简版于 **2026-10-22** 在 `feat/s1-s2-supervisor-draft-pipeline` 落地：按需触发 + L0 规则 + L1 按需补全 + G-11 未决问题零丢失 + 独立预算记账 + `redaction.ts` 移植，三套新单测 45 例全绿；成熟度评分器/徽章/气泡按 v1.3.3 明令**未引入**。旧设计的 4 维评估器 + 草案编译器仍存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）
* **v1.3.3 范围拆分**：
  - **v0.1（本卡）**：按需合同草案生成——仅在用户显式请求或控制面事件触发时生成；L0 规则（保护清单匹配、路径提取、默认命令/预算）优先，L1 强模型按需补全；白话文案；计入 Supervisor 独立预算。
  - **v0.2+（推迟，`[用户已确认 D4]`）**：需求成熟度评分（4 维评估器、`maturity_assessment` 打分、HUD 徽章）。
* **核心目标**：
  1. 按需生成草案：输出 `rationale`、`unresolved_questions`、`assessed_at`、`model_id`（不再要求成熟度打分）。
  1b. **分级自适应准入评估器 (Adaptive Admission Risk Evaluator, v1.4.0 新增)**：
     - **Fast Path（轻量快速通道）**：分析修改意图与路径，若为单文件非核心展示层修改（如 CSS / 文案 / 单组件），无 Shell 执行且不触碰保护清单，自动打标 `auto_admitted: true`，生成静默合同由 Daemon 自动放行，免去用户弹窗审批；
     - **Standard / Strict Path**：多文件逻辑重构或涉及敏感配置时，进入标准或强门禁合同草案生成。
  2. 草案授权遵循架构规范 §0.2：Scope 与保护清单无交集自动批准，有交集仅一次白话是/否；不存在任何基于分数的门禁。
  3. **未决问题 100% 保留至草案元数据 (G-11)**：提取生成符合 `SoftwareContractV12` 的草案，状态初始为 `DRAFT`，自动注入必填的 `worker_spec`；若存在 `unresolved_questions`，必须完整保存在草案中供用户核对。
* **涉及核心文件**（v0.1，✅ 均已落地；文件名按实际交付校正）：
  - 新增：`daemon/supervisor/draft-generator.ts`（原计划名 `contract-draft-generator.ts`，草案编译 + `submitDraftForApproval()`）
  - 新增：`daemon/supervisor/rules-l0.ts`（L0 规则草案装配：路径提取 / 保护清单匹配 / 默认命令与预算）
  - 移植：`src/lib/ipc/redaction.ts`（共享深度脱敏，自旧 S.3 保留）
  - 修改：`daemon/supervisor/index.ts`（公开出口）
  - 修改：`daemon/supervisor/budget.ts`（改为独立账本 `independent()`）、`daemon/supervisor/types.ts`（快照注释口径同步）
  - 测试：`tests/unit/supervisor-contract-generator.test.ts`、`tests/unit/ipc-redaction.test.ts`、`tests/unit/supervisor-budget.test.ts`
  - v0.2+（推迟）：`daemon/supervisor/maturity-evaluator.ts`、`tests/unit/supervisor-maturity-evaluator.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 草案 100% 通过 `SoftwareContractV12Schema.parse()`。
    - 断言：当 `unresolved_questions.length > 0` 时，草案元数据中的 `unresolved_questions` 逐项保留无遗漏。
    - 断言：草案必须包含合规的 `worker_spec`；未请求时 Supervisor 模型调用 = 0。
  - **FAIL**：草案遗漏未决问题；草案缺失 `worker_spec` 导致校验失败。
* **历史记录（旧设计实现，仅存于未合并分支 `wip/s2-s3-supervisor-old-design`，非 v0.1 验收依据）**：该分支上两个专用套件共 32 个用例曾报告 PASS（2026-10-20）。
  | 套件 / 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | 评估器 A 分数收敛 | 4 | 模糊意图 <50 且 `NEEDS_CLARIFICATION`、未决问题非空；明确意图 ≥80 且四维均 ≥80；明确比模糊高 ≥40 分；部分信息只拉高对应维度 |
  | 评估器 B 结构 | 3 | 四维齐备、权重合计 1；分数均在 0–100 且理由非空；总分可按维度加权复算 |
  | 评估器 C 建议性守卫 | 3 | 空对话不抛错、0 分 + 4 条未决问题；0 分与满分 `advisory_only` 均为 true；未决问题数量等于弱维度数 |
  | 评估器 D 输出契约 | 2 | `toAssessment()` 通过 `maturityAssessmentSchema`；`assessed_at` 来自注入时钟、`model_id` 可覆盖 |
  | 生成器 A 合规与状态 | 5 | 草案 100% 通过 Schema；初始 `DRAFT/DRAFT`；`DRAFT+PENDING_REVIEW` 被拒；提交后 `PENDING_APPROVAL/PENDING_REVIEW`；非 DRAFT 不可重复提交 |
  | 生成器 B worker_spec / 非门禁 | 3 | `GATEWAY_ENFORCED` + `MANAGED_TOOL_CALLING`；`score=0` 仍生成且元数据 score 为 0；无评分同样生成 |
  | 生成器 C G-11 | 2 | 未决问题逐项无遗漏无改写；评估报告转存后 score/rationale/model_id/assessed_at 完全一致 |
  | 生成器 D 装配 | 8 | 对话提取可写路径与禁区；显式 scope 覆盖；空对话安全兜底；默认两条验证命令；命令可覆盖；默认预算含计数值上限；预算可覆盖且合规；默认命令常量防漂移 |
  | 生成器 E 溯源 | 2 | `suggestion_id` + `suggested_scope` 落元数据；`conversation_ref` 保留全部消息 id |
  - 规范说明：A §9.1.1 状态矩阵只允许 `DRAFT↔DRAFT`、`PENDING_APPROVAL↔PENDING_REVIEW`，故草案初始态为 `DRAFT/DRAFT`；`submitDraftForApproval()` 原子推进至 `PENDING_APPROVAL/PENDING_REVIEW`。`DRAFT+PENDING_REVIEW` 被显式断言拒绝，已固化为可回归事实。
* **完成记录（v0.1 精简版 · 2026-10-22 落地，Sprint 4）**：
  - 交付物：`daemon/supervisor/rules-l0.ts`（L0 规则引擎，零模型调用）、`daemon/supervisor/draft-generator.ts`（按需生成 + L1 补全 + G-11 + 费用分账）、`src/lib/ipc/redaction.ts`（三层脱敏）、`daemon/supervisor/budget.ts`（改独立账本）。
  - 关键实现口径：
    - **按需触发是结构性的，不是配置项**：`DraftTriggerKind` 中 `IDLE_TIMER` / `DEBOUNCE_TIMER` 一律返回 `{ generated: false, reason: "NOT_REQUESTED", model_calls: 0 }`，函数体在装配之前即返回，模型调用不存在发生路径。这是「VIBE 下 30 分钟连续聊天 Supervisor 调用 = 0」的结构保证。
    - **L0 只匹配不削减**：命中保护清单的路径**仍保留在 `writable_paths`**，另外回报 `protected_files` / `protected_entry_names` / `needs_protection_approval` / `protection_error`，交由 §0.2「有交集 ≤2 次交互」处理，规则引擎不代替用户做决定。
    - **L1 必须带账本**：`enrich` 与 `budgetLedger` 同时存在才允许调用模型，否则抛 `MISSING_BUDGET_LEDGER`，杜绝"免费调用"绕过费用分账。
    - **G-11 不去重**：L0 与 L1 的 `unresolved_questions` 按序拼接、刻意不去重（去重会静默吞条），完整写入 `supervisor_metadata.maturity_assessment`。
    - **剔除项**：`maturity_assessment` 只写 `rationale` / `unresolved_questions` / `model_id` / `assessed_at`，**不写 `score`**；无评估器、无徽章、无风险气泡（Schema 中 `score` 仍为可选字段以兼容旧数据，但不参与任何 refine 或授权分支）。
  - 测试（45 例全绿，`npm test` 全量 722 passed / 6 skipped 无回归）：
    | 套件 | 用例数 | 覆盖断言 |
    |---|---|---|
    | `tests/unit/ipc-redaction.test.ts` | 21 | 键名脱敏（大小写/下划线/连字符变体）、真实凭据值指纹脱敏（≥6 字符）、形态脱敏（sk-/ghp_/AKIA/xoxb-/Bearer/PEM/`KEY=`）、先脱敏后截断、嵌套对象/数组、计数按出现次数、循环引用不爆栈 |
    | `tests/unit/supervisor-budget.test.ts` | 7 | 独立落盘 `.stagent/supervisor-budget.json`、重启后累计值恢复、超额在 `call` 之前抛 `E_BUDGET_EXCEEDED`、**Worker 合同账本零污染**、快照剩余额度口径 |
    | `tests/unit/supervisor-contract-generator.test.ts` | 17 | 定时/防抖触发零生成零调用、L0 路径提取与默认命令、保护清单命中仍保留可写路径并置 `needs_protection_approval`、草案 100% `parse()` 通过、初始 `DRAFT/DRAFT`、`submitDraftForApproval` 状态跃迁与非法态拒绝、G-11 未决问题零丢失、L1 无账本抛错、L1 用量只记独立账本、`maturity_assessment` 不含 `score` |
  - 如实保留的残余（不阻塞验收）：
    - **L1 尚无生产模型适配器**：`enrich` 是注入函数，当前仅测试与未来编排层可调用；未接线前生产路径恒为纯 L0（零费用），不会误触发。
    - **草案生成器尚未接入 UI / 控制面**：属 `TASK-C.2`（Studio 精简版）与 `TASK-S.3`（推迟 v0.2+）范围。
    - ~~`throttler.ts` 仍缺失~~ → **已于 2026-10-24 合入**（merge `a9066dd` / `a7d7292`），`TASK-S.1` 升为 `[COMPLETED]`；见 S.1 交付说明。

---


---

<a id="task-s.4"></a>

#### 【Task S.4】Demo 静态原型生成器与 Mock 预览服务 `[v1.6.1 升级]`
* **任务编号**：`TASK-S.4`
* **前置依赖**：`TASK-S.2`
* **任务状态**：**[COMPLETED]**（2026-10-23 交付：分支 `feat/task-s4-demo-service`，提交 `95ea2a3`、`07af0f2`，经 `d5ee448` 合入 main。落地内容：需求摘要 → 纯静态原型生成（`.stagent/demo/`，产出 `index.html`/`styles.css`/`app.js`）、单文件 2MB UTF-8 字节闸门（`E_DEMO_PAYLOAD_TOO_LARGE`，HTTP 413，先全量校验再统一落盘）、独立 Origin 预览服务（仅绑 127.0.0.1:4100~4110，`findAvailablePort` + `listen` 双重端口回退）、CSP `default-src 'none'; connect-src 'none'` 与路径逃逸/隐藏文件防护、版本快照与按 ID 回退（含残留资源清理）、`DEMO_PREVIEW_STATUS` 生命周期广播（`RUNNING`/`STOPPED`/`ERROR`）、Daemon HTTP 与 WS 入口对 Demo 来源 403（**置于 CORS 放行之前**，并覆盖 sandbox iframe 的 `Origin: null`）。门禁：tsc 0 错、eslint 0 错、19 项定向单测全绿。偏离说明：采用三资源而非单文件——严格 CSP 下 `script-src 'self'` 不允许内联脚本，维持单文件需放开 `'unsafe-inline'`，安全性优先；2MB 仍按单文件独立判定。范围外（经需求方裁决）：`createDemoPreview` 的上层调用归 TASK-C.2/旅程编排层，热重载归右栏会话打补丁时对接）
* **v0.1 范围**：受控单页静态 HTML/React 原型生成 + 虚拟 Mock 数据构造 + 独立端口与跨源沙箱隔离预览服务。
* **核心目标**：
  1. **原型受控构建器 (`daemon/supervisor/demo/demo-generator.ts`)**：
     - 在需求澄清告一段落后，根据已收敛的 `.stagent/specs/requirements.md`，提取页面布局、核心功能分支与表单字段；
     - 自动组装纯静态前端页面（包含 Tailwind/CSS 样式与内嵌虚拟 Mock 数据），落地于 `.stagent/demo/` 临时工作区；
     - **单文件落盘上限 ≤ 2MB**：落盘前检查生成资产尺寸，单文件超过 2MB 立即拒绝写入并抛出 `E_DEMO_PAYLOAD_TOO_LARGE`；
     - 严禁赋予任何真实数据库或外部网络权限（纯静态前端 Mock）。
  2. **跨源沙箱预览服务与 CSP 隔离 (`daemon/supervisor/demo/preview-server.ts`)**：
     - 在本地分配独立随机未占用端口（如 4100~4110），启动基于 Node 的静态 Web 预览服务（独立 Origin）；
     - 前端 Studio 视口必须通过 `<iframe sandbox="allow-scripts">` 嵌入，**严格严禁添加 `allow-same-origin`**；
     - 注入严格 Content-Security-Policy (CSP)：禁止 Demo 页面发起向 Daemon 端口或外部非白名单域名的网络请求；
     - Daemon 端 RPC/API 网关增加 Origin 校验，来自 Demo iframe 的跨源请求一律以 403 阻断；
     - 通过 WebSocket 向 UI 广播 `DEMO_PREVIEW_STATUS`（包含独立预览 URL 与更新时间戳）；
     - 支持热重载更新：当用户在右侧对话中打补丁时，增量重写 Demo 文件并触发页面无刷新重载。
  3. **增量原型演进与历史快照回退 (`daemon/supervisor/demo/demo-evolution.ts`)**：
     - 每次需求变更生成新的 Demo patch，并将历史版本保存于 `.stagent/demo/snapshots/`；
     - 支持用户在 Studio 中一键回退到任一历史 Demo 试玩快照。
* **涉及核心文件**：
  - 新增：`daemon/supervisor/demo/demo-generator.ts`
  - 新增：`daemon/supervisor/demo/preview-server.ts`
  - 新增：`daemon/supervisor/demo/demo-evolution.ts`
  - 新增：`daemon/supervisor/demo/types.ts`
  - 测试：`tests/unit/supervisor-demo-generator.test.ts`
  - 测试：`tests/unit/supervisor-demo-server.test.ts`
  - 测试：`tests/e2e/demo-iframe-isolation.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：输入 Markdown 需求文档可稳定产出包含 Mock 数据的静态页面；本地预览服务在独立端口启动且在 2 秒内响应；Demo 嵌入 iframe 无法读取主应用 Cookie/LocalStorage，CSP 成功阻断向 Daemon 端口的 RPC 访问；单文件 > 2MB 被坚决拦截。
  - **FAIL**：iframe 配置了 `allow-same-origin`；Demo 页面能够调用 Daemon API；端口冲突未能自动回退。

---

<a id="task-s.5"></a>

#### 【Task S.5】Supervisor 质疑自查与根因分流归因引擎 `[v1.6.1 升级]`
* **任务编号**：`TASK-S.5`
* **前置依赖**：`TASK-S.1`, `TASK-S.2`, `TASK-D.2b`
* **任务状态**：**[COMPLETED]**（2026-10-23 交付于 `feat/task-s5-dispute-engine`：`a1469b7` 主体 + `a83f18a` 口径修正，经 `2bb1313`、`5748ad0` 合入 main。门禁：`npm run typecheck` 0 错；`tests/unit/requirements-store.test.ts` 7 通过、`tests/unit/dispute-triad.test.ts` 12 通过；main 上 4 个定向文件 60 例、集成 30 例全绿。落地清单：`daemon/supervisor/specs/requirements-store.ts`（`requirements.md` 读写、合同意图初始化、`specs/revisions/req-v*.md` 版本冻结、执行期锁定与 SHA-256 完整性校验）、`daemon/supervisor/dispute/evidence-triad.ts`（会话/规范/Worktree 三方抓取，终端与退出码取自最新 Evidence）、`classification.ts`（确定性归因 + 置信度 + 返工/变更提案）、`index.ts`（60s 看门狗与报告装配）、`types.ts`、`daemon/server.ts` 的 `POST /api/supervisor/dispute` 与 `DISPUTE_REPORT_READY` 广播。**口径说明**：① 文件命名按实际落地为 `classification.ts` / `index.ts` / `types.ts`（卡内设计期 `root-cause-analyzer.ts` / `rework-dispatcher.ts` / `dispute-types.ts` 未沿用）；② 需求快照按架构 §5.1 落在 `.stagent/specs/revisions/req-v<N>-<sha8>.md`，索引 `.stagent/specs/requirements.snapshots.json`；③ 归因是确定性规则而非模型打分，置信度由证据信号计算，`< 0.7` 强制降级；④ 越界返工以 `rejected_paths` + `requires_scope_expansion` 阻断并提示升版，未新增 `EXPANDED_SCOPE_REQUIRED` 错误码，避免扩充错误码目录。**残余口径差（不阻塞验收，需登记）**：① 路由级 401/404/超时降级未加集成用例（按交付指令仅两个单测文件）；② 终端日志取自最新 Evidence 的 stdout/stderr tail，无 Evidence 时为空且置信度下调；③ 返工提案与变更草案均为未落盘对象，执行/审批沿用既有链路）
* **v0.1 范围**：自然语言质疑入口 + 三方事实交叉核验管道 + 看门狗超时控制 + 置信度治理 + 严格 Scope 子集自动返工。
* **质疑入口路由**：右栏会话在真实试玩/验收阶段识别质疑意图时，提供转入 Studio 质疑自查的明确入口；该路由由本卡与 TASK-C.2 集成实现，不属于已完成 TASK-C.6 的交付内容。
* **核心目标**：
  1. **三方事实核验管道 (`daemon/supervisor/dispute/evidence-triad.ts`)**：
     - 响应用户的自然语言质疑（例如：“订单页面没有满减折扣功能”）；
     - 自动抓取三方物理事实：① 会话历史中用户原始提问与意图确认记录；② `.stagent/specs/requirements.md` 中的已批准规范条目；③ 当前 Worktree 实际代码 Diff、终端日志与测试退出码；
     - **自查对照源**：质疑分析时，必须对照触发本轮施工的**不可变需求快照**（`.stagent/specs/revisions/req-v*.md`），而非仅读取可能已被后续对话修改的 `requirements.md` 最新态；
     - 引入 60 秒自查看门狗：自查计算超过 60 秒触发超时兜底，安全降级。
  2. **确定性分流归因与置信度治理 (`daemon/supervisor/dispute/root-cause-analyzer.ts`)**：
     - 模型对归因结论输出评估置信度 `confidence`：
       - 当且仅当 `confidence >= 0.7` 时，输出确定性裁决：
         - **分支 A (实现偏差 Bug)**：需求文档已明文记载但代码实现缺失或抛错，裁决为 `IMPLEMENTATION_DEVIATION`，输出“系统实现偏差，本轮免费修复”，生成 `DefectFixTask`；
         - **分支 B (需求变更 Drift)**：代码完全符合已批准需求与 Demo，系用户提出新业务规则，裁决为 `REQUIREMENT_DRIFT`，输出“识别到新需求，开始增量演变”，引导用户进入需求文档增删与 Demo 迭代；
       - 当 `confidence < 0.7` 时，**坚决严禁模型武断下结论**，自动降级为 `UNCERTAIN`，仅并排呈现用户原话、规范条目与代码改动事实，由用户人工勾选确认是 Bug 还是新需求。
  3. **自动返工 Scope 严格子集检查 (`daemon/supervisor/dispute/rework-dispatcher.ts`)**：
     - 实现偏差派发的 `DefectFixTask`，其可修改文件范围必须严格限制在原已批准合同 `writable_paths` 的**真子集或全集**之内；
     - 若自查修复方案需要新增文件或引入新依赖，必须抛出 `EXPANDED_SCOPE_REQUIRED`，立即阻断自动返工并转入需求变更增量合同审批流程；
     - 资产关联贯通：在会话、草案与 Evidence 中贯穿统一关联键 `change_request_id`，实现全链路可审计溯源。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`daemon/supervisor/specs/requirements-store.ts`
  - 新增：`daemon/supervisor/dispute/evidence-triad.ts`
  - 新增：`daemon/supervisor/dispute/classification.ts`
  - 新增：`daemon/supervisor/dispute/index.ts`
  - 新增：`daemon/supervisor/dispute/types.ts`
  - 修改：`daemon/server.ts`（`POST /api/supervisor/dispute` 与 `DISPUTE_REPORT_READY`）、`src/lib/ipc/frames.ts`、`src/lib/error-codes.ts`
  - 测试：`tests/unit/requirements-store.test.ts`（7 用例）
  - 测试：`tests/unit/dispute-triad.test.ts`（12 用例）
* **Pass/Fail 验收判定**：
  - **PASS**：对于需求已写但代码写漏的典型 Case，置信度高且 100% 裁决为实现偏差；低置信度案例自动降级为事实陈述并由用户裁决；自动返工超出原合同 Scope 时被坚决拦截并提示升版审批；60 秒内必出结果或安全超时。
  - **FAIL**：低置信度时向用户强加主观判定；自动返工越界修改了原合同未授权的文件。

<a id="task-s.6"></a>

#### 【Task S.6】非技术旅程串联（右侧唯一入口分流 + 确认原型开工）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-S.6`
* **前置依赖**：`TASK-S.4` (COMPLETED), `TASK-C.7` (COMPLETED), `TASK-S.5` (COMPLETED), `TASK-C.2` (COMPLETED), `TASK-S.2` (COMPLETED), `TASK-W.5a` (PASS)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `6415fbd`；分支 `feat/task-s6-journey-orchestration` 功能提交 `bbab79e`。门禁：合后四件套全绿（1155 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过。落地：`classifyJourneyIntent` / `orchestrateJourney` / `POST /api/supervisor/journey`；右侧 `onBeforeSend` 分流卡；`buildProposalFromContract` + `createTaskGraph` 真接线【确认原型】；需求 hint 刷新；Studio 视口建议切换；单测 `journey-intent-router` / `journey-orchestrate` / `journey-proposal-from-contract`。**S.6b 已收口 [COMPLETED]**：merge `024d2b8` / 功能 `613ff51`（分支 `feat/task-s6b-real-playtest`）；合后四件套 1165 passed / 6 skipped；真机预览服务 4200–4210、`RealPlaytestPane` iframe+外链、旅程 `REAL_PLAYTEST`→`START_REAL_PLAYTEST`、Origin 防线。不改架构规范；未做 W.5b/c / S.3 HUD / C.2 重做。）
* **对照白话验收**：见 Git 历史（原 `docs/archive/non-technical-journey-acceptance.md`）（八步 + Fast Path + 右侧唯一入口）
* **v0.1 范围**：右侧唯一入口的白话分流路由器 +「确认原型 → 建全灰 TaskGraph → 进入可审批/开工链」主链粘合；聊完一段落后左侧需求说明可感知刷新；审批/开工后中栏图随真实 Evidence 点亮（复用既有 illumination verify）。底座（S.4 Demo、C.7 Graph、S.5 dispute、C.2 四视口、S.2 草案、W.5a Worker）只接线、不重砌。
* **明确不包含**：
  - `TASK-W.5b` / `TASK-W.5c`（第二/第三个 Agent）
  - UI 抛光与视觉重设计
  - `TASK-S.3` HUD / 成熟度徽章 / Snooze（仍 DEFERRED→v0.2+）
  - 重做 `TASK-C.2` 四视口壳（只补编排接线）
  - 修改《系统架构设计规范》或另开 ADR
* **核心目标**：
  1. **右侧白话分流（唯一入口）**：用户只跟右侧聊天；系统按意图静默路由——质疑纠错 → 调 `POST /api/supervisor/dispute` 并出白话摘要卡（可切质疑视口）；大事/提需求 → 出或更新草案与左侧需求说明；小事（字号/文案等）→ Fast Path 静默合同，**免强制整套 Demo**。
  2. **确认原型 → 建图开工主链**：中栏 Demo（S.4 独立端口）可试玩；用户点【确认原型并实施真实工程】后，必须真实创建初始**全灰** TaskGraph（C.7）并进入可审批/开工链；**禁止**只改预览 nonce / 假状态切换冒充开工。
  3. **Evidence 驱动点亮**：审批/开工后，中栏图随 Worker 真实写入产生的 Evidence，经既有 `illumination-verifier` / `POST /api/graph/verify` 逐节点点亮；不自报假绿。
  4. **可选 / S.6b（本卡可降级登记）**：当展示态进入代码事实态 `REAL_PLAYTEST`（勿写作 `PREVIEW_READY`）时，将真预览 URL 挂到中栏或外链；若本卡工期超范围，明确登记为后续子卡，不阻塞主链验收。
* **涉及核心文件（实施时以实际接线为准，本卡仅定范围）**：
  - 编排/分流：`daemon/supervisor/` 下会话意图路由与 Fast Path / dispute / 草案触发粘合（复用 S.1/S.2/S.5，不另起炉灶重写引擎）
  - 前端粘合：右侧会话 → 分流结果卡片；`DemoPreviewPane`【确认原型】→ Graph 建图 API；左侧规范资产区需求刷新；质疑卡与视口切换（复用 C.2 `StudioViewportShell`）
  - 既有复用：S.4 Demo 预览服务、C.7 `graph-engine` / verify、S.5 dispute API、C.2 四视口、W.5a 执行通道
* **Pass/Fail 验收断言（≤5，可测、白话）**：
  1. **右侧一句话分流**：质疑 → 调 dispute 并出白话卡（可切质疑视口）；大事 → 出/更新草案；小事 → Fast Path（免强制 Demo）。
  2. **聊到一段落**：左侧需求说明出现或更新（用户可感知刷新，不必手写技术规格）。
  3. **确认原型开工**：Demo 可进中栏试玩；点【确认原型并实施真实工程】→ 建全灰 TaskGraph 并进入可审批/开工链（**禁止只改 nonce**）。
  4. **点亮**：审批/开工后，中栏图可随真实 Evidence 点亮（复用现有 verify；空验证集仍不得假绿）。
  5. **可选/S.6b**：`REAL_PLAYTEST` 真预览 URL 挂中栏或外链；本项已由 S.6b 合入收口（merge `024d2b8`）。
* **Pass/Fail 验收判定**：
  - **PASS**：上述断言 1–4 均可在本地 main 上手测复现；断言 5 要么交付要么在卡内显式降级登记；无产品代码范围外改动混入本卡。
  - **FAIL**：确认原型只改 nonce/假态；分流把质疑当闲聊或把小事逼进全套 Demo；点亮不经 Evidence；把缺口塞回已完成的 C.2/S.3/S.5 卡而不立本卡。

---

### 3.3 受控 Coding Worker、安全策略、威胁守卫与成熟 Agent 适配（W.1/W.2 已完成；W.3/W.4 落 Sprint 2；W.5a 落 Sprint 1，绕过负例收尾落 Sprint 3）

<a id="task-w.1"></a>

#### 【Task W.1】Coding Worker 适配器抽象与任务指令装配
* **任务编号**：`TASK-W.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-20 收尾：能力声明第 9 项 `known_limitations`、合同上下文装配、Worktree 边界校验与工具暴露收窄全部落地；专用用例 **34 个**全通过；用例总数以最新 CI 为准）
* **v1.3.3 定位调整**：自研 API Worker 由主线转为**保底运行基线与单元测试替身**；成熟 Agent 接入由 TASK-W.5a/b/c 承载。`AdapterCapabilityDeclaration` 增补字段：`billing_model`、`streaming_protocol`、`resume_mechanism`、`interrupt_supported`、`native_tools_disabled: string[]`、`verified_on`（实测 CLI 版本号与日期，空即「待实机验证」）。
* **核心目标**：
  1. 定义 `CodingWorkerAdapter` 接口，支持 Managed AI 与 CLI。
  2. **合同生效后的任务指令下发与装配 (Task Instruction Injection)**：
     - 当收到合同批准事件时，Session Router 组装标准任务指令卡片并推入**右侧 Worker 对话窗口**；
     - 注入最高优先级任务上下文（目标意图、文件白名单、禁止触碰目录、验收要求）；
     - 将 Worker 执行的工作目录强行锁定为生成的 Worktree 物理路径。
  3. **`AdapterCapabilityDeclaration` 补齐第 9 项 `known_limitations` (G-10)**：声明对象完整包含 9 项能力规范与平台矩阵。
  4. 注册中心默认拒绝未经能力证明的外部适配器进入 `GATEWAY_ENFORCED` 受控模式。
* **涉及核心文件**：
  - 新增：`daemon/worker/worker-adapter.interface.ts`
  - 新增：`daemon/worker/session-task-injector.ts`
  - 新增：`daemon/worker/adapter-registry.ts`
  - 修改：`daemon/worker/ai-worker.ts`（`prepare()` 装配 + 失败上下文回传）
  - 修改：`daemon/worker/openai-client.ts`（System Prompt 单一事实源）
  - 修改：`daemon/pipeline/orchestrator.ts`（传入宿主根强制 Worktree 隔离校验）
  - 测试：`tests/unit/worker-adapter.test.ts`
* **接口定义**：
  ```typescript
  export interface AdapterCapabilityDeclaration {
    adapter_id: string;
    protocol_version: string;
    model_metering_source: "PROVIDER" | "LOCAL_ESTIMATE";
    tool_interception_supported: boolean;
    filesystem_permissions: "GATEWAY_ONLY" | "DIRECT_UNCONTROLLED";
    command_permissions: "WHITELIST_ONLY" | "UNRESTRICTED_SHELL";
    cancellation_supported: boolean;
    session_recovery_supported: boolean;
    network_requirements: "NONE" | "EXPLICIT_ONLY" | "DIRECT_INTERNET";
    platform_support: ("darwin-arm64" | "darwin-x64" | "linux-x64" | "win32-x64")[];
    known_limitations: string[]; // 第 9 项必填已知限制 (G-10)
  }
  ```
* **Pass/Fail 验收判定**：
  - **PASS**：未声明 `known_limitations` 或声明直连 FS 的适配器，无法被注册为受控模式。
  - **FAIL**：未知黑盒适配器被登记为受控。
* **完成记录（2026-10-20）**：`tests/unit/worker-adapter.test.ts` 共 **34 个用例**全 PASS：
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | A 合同上下文装配 | 8 | 目标/白名单/只读/禁区/验收/预算逐字段注入；Worktree 根与段落结构；known_limitations 默认注入与未声明告警；未批准合同拒绝装配 |
  | B 工具暴露 | 4 | 无命令授权时 exec 不暴露；有授权恢复；只能收窄子集；未授权显式请求被拒 |
  | C Worktree 边界 | 8 | 等于宿主根 / 祖先 / 非隔离目录 / 完全外部 / 相对路径 / 符号链接穿透 全部拒绝 |
  | D 能力声明与注册中心 | 8 | 空限制、直连 FS、无限制 Shell、无法拦截工具、空平台矩阵逐项拒绝；重复 ID 拒绝；黑盒仅可非受控登记 |
  | E AiWorker 集成 | 5 | Prompt 单一事实源；网关落盘；模型异常 `MODEL_CALL` 上下文；工具失败 `TOOL_WRITE` 上下文；越权 `SCOPE_VALIDATION` 零落盘 |
  | F 静态边界 | 1 | `daemon/worker/**` 零 `child_process` / 零原生执行 API（**v1.3.3 收窄**：唯一例外为 `daemon/worker/cli-host/` 专用子进程隔离模块，该模块允许 spawn 但强制结构化 argv + `shell:false` + 进程树托管回收；静态测试改为断言"cli-host 之外零 spawn"） |

---


---

<a id="task-w.2"></a>

#### 【Task W.2】Scoped Gateway 强制工具注入与执行拦截
* **任务编号**：`TASK-W.2`
* **前置依赖**：`TASK-W.1`, `TASK-A.2` (COMPLETED), `TASK-A.4` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-20 收尾：5 大工具注入、`expected_hash` 乐观锁、`delete_file`、别名 argv 执行与路径/命令拦截全部落地；专用用例 **29 个**全通过，全仓 55 文件 / 522 用例）
* **核心目标**：
  1. 注入 `stagent_*` 5 大标准工具。
  2. **`stagent_write_file` 的 `expected_hash?` 调整为可选 (G-03)**：
     - 若传入 `expected_hash`，执行严格乐观锁比对，哈希不符抛 `E_CONFLICT`；
     - 若未传入 `expected_hash`，视为新建文件，仅在合同 `writable_paths` 范围内放行。
  3. **强制结构化 argv 且 `shell:false` 调用 (G-04)**：
     - 命令执行必须以 `spawn(executable, args, { shell: false })` 执行；
     - 严密检查参数，包含未转义连接符（`;`, `&&`, `|`, `$()`）的参数作为字面量抛出 `E_UNAUTHORIZED_COMMAND`。
  4. 越界访问抛 `E_OUT_OF_SCOPE`，禁区抛 `E_FORBIDDEN_PATH`，违规后合同与证据标 `BLOCKED`。
  5. **网关物理先阻断与合同 v2 升版联动 (v1.4.0 新增)**：
     - Gateway 检测到未授权读写或非白名单命令时，必须物理拒绝执行，不可依赖 LLM 自觉停手；
     - 单次常规越界向 Worker 返回错误码由其自愈；若属于业务需求扩大导致的范围突破，触发生成 `Contract v2` 差异补丁，旧执行凭证立即停用，等待用户重新审批；
     - 代码发生新提交后，旧候选版本的测试与 Diff 证据自动标记为失效（STALE），禁止冒充通过。
* **涉及核心文件**：
  - 修改：`daemon/mcp/types.ts`（`expected_hash` / `command_alias` / `list_directory` / `delete_file` Schema）
  - 修改：`daemon/mcp/gateway.ts`（五工具分发、乐观锁、删除、别名 argv、Scope 码映射）
  - 新增：`daemon/worker/worker-toolset.ts`（按授权挂载的工具实例层）
  - 修改：`daemon/worker/session-task-injector.ts`（`WORKER_MCP_TOOLS` 五席位与 exec 暴露判定）
  - 修改：`daemon/worker/ai-worker.ts`（经 toolset 读写）
  - 测试：`tests/unit/worker-mcp-tools.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 未传 `expected_hash` 时新文件正常创建；传入错误 `expected_hash` 时被拒绝。
    - 包含注入符号（`;`, `&&`）的命令参数被字面量拦截，测试断言未进入系统 shell 执行。
    - 越界写入被阻断，合同与证据被标为 `BLOCKED`。
  - **FAIL**：使用 `shell: true` 执行命令；新文件因强制要求前值哈希而无法创建。
* **完成记录（2026-10-20）**：`tests/unit/worker-mcp-tools.test.ts` 共 **29 个用例**全 PASS：
  | 分组 | 用例数 | 覆盖断言 |
  |---|---|---|
  | 五工具基本功能 | 9 | 读回内容+SHA-256；写入落盘；列举隐藏禁区/`.git`/`.stagent`；递归路径；历史别名等价；删除与 `ENOENT`；拒删目录 `E_NOT_A_FILE`；别名执行 exit 0；未知别名 `E_UNAUTHORIZED_COMMAND` |
  | 乐观锁 `expected_hash` | 4 | 命中写入；外部改动后 `E_CONFLICT` 且零覆盖；缺失文件传 hash 判冲突；非法 hash `INVALID_INPUT` |
  | 命令防注入 | 6 | `&&`/`\|`/`;`/`$()` 四类参数逐一拒绝且无副作用；旧式字符串拼接被拦；argv 字面量透传 |
  | 路径边界 | 6 | 穿越/绝对路径 `PATH_TRAVERSAL_DETECTED`；禁区 `E_FORBIDDEN_PATH`；越界 `E_OUT_OF_SCOPE`（写/删各一） |
  | 授权挂载 | 4 | 未授权 commands 时 exec 不挂载；授权后五工具全挂；收窄后未挂载即拒绝；AiWorker 经 toolset 落盘 |

---


---

<a id="task-w.2b"></a>

#### 【Task W.2b】未跟踪文件 Scope 联合检查与越界阻断
* **任务编号**：`TASK-W.2b`
* **前置依赖**：`TASK-0.2c`, `TASK-W.2`
* **任务状态**：**[COMPLETED]**（2026-10-23 核验回写：提交 `87f909c`，经 `05f090f` 合入 main。落地 `daemon/pipeline/untracked-scope-guard.ts`，错误码 `E_OUT_OF_SCOPE_UNTRACKED` 已登记于 `src/lib/error-codes.ts`；执行后联合检查 tracked Diff 与 untracked，合同外未跟踪文件阻断并留 BLOCKED 证据。合并门禁由 TASK-D.2b 承接，不在本卡范围）
* **范围**：在执行后 Scope 校验中联合检查已跟踪 Diff 与未跟踪文件，新增统一错误码 `E_OUT_OF_SCOPE_UNTRACKED`；本卡只负责执行侧检测与阻断，不负责合并门禁。
* **涉及核心文件**：新增 `daemon/pipeline/untracked-scope-guard.ts`；修改 `daemon/pipeline/orchestrator.ts`、`src/lib/error-codes.ts`；配套执行侧越界测试。
* **Pass/Fail**：PASS：`git status --porcelain -uall` 覆盖未跟踪文件；合同内新文件可继续，合同外文件在执行后检查被阻断并留下可追溯 BLOCKED 证据；FAIL：仅检查 `git diff --name-only` 或错误码不一致。

<a id="task-w.3"></a>

#### 【Task W.3】测试环境、秘密脱敏与网络/端口策略守卫
* **任务编号**：`TASK-W.3`
* **前置依赖**：`TASK-W.2`
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：`daemon/worker/policy-guard.ts` 提供环境白名单 / `CI=true` / `env_file_grants` / 网络策略，接入 `daemon/mcp/gateway.ts`（`buildCommandEnvironment`）与 `daemon/runner/command-runner.ts`（`resolveEnvironment`）；秘密遮蔽由 `redactSecrets` 在双窗口截断**之前**执行；`GatewayCallCounters` 对工具调用与命令执行分列记账并独立熔断；专用用例 `tests/unit/policy-guard-env-network.test.ts` 5 个 + `tests/unit/w3-command-policy.test.ts` 9 个全绿）
* **核心目标**：
  1. 环境变量过滤：默认注入 `CI=true`，严禁继承宿主全部环境变量，仅放行合同 `allowed_environment_variable_names`。
  2. `env_file_grants` 授权：按命令 alias 注入对应的测试环境配置文件。
  3. **秘密遮蔽严密在截断之前执行**：对注入的秘密值做掩码替换，遮蔽必须早于输出双窗口截断，防止截断边界泄露。
  4. 网络与端口策略：`network_policy = "DENY"` 时拦截外部网络；动态端口冲突时给出可诊断错误，不误报为断言失败。
  5. **工具与命令预算分列记账断言 (闭环 G-09 第 3 子项)**：
     - 在命令执行器与 MCP 工具代理层实现独立记账；
     - `budget_limits` 中命令执行次数与工具调用次数分列记录并实时累加至账本；
     - 任何单项超限立即触发 `E_BUDGET_EXCEEDED` 熔断，断言不因模型 Token 未超标而放行违规工具调用。
* **涉及核心文件**：
  - 新增：`daemon/worker/policy-guard.ts`
  - 修改：`daemon/runner/command-runner.ts`
  - 测试：`tests/unit/policy-guard-env-network.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：宿主非白名单变量完全隔离；秘密遮蔽在截断前执行完毕；网络阻断生效；工具与命令分列记账超限时 100% 触发 E_BUDGET_EXCEEDED 熔断。
  - **FAIL**：环境变量泄露；秘密在截断边缘明文泄露。

---


---

<a id="task-w.4"></a>

#### 【Task W.4】高风险执行威胁守卫与运行时能力复检 (闭环 G-01 & G-20)
* **任务编号**：`TASK-W.4`
* **前置依赖**：`TASK-W.3`
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：`daemon/worker/threat-guard.ts`（argv 拆段/包装命令展开/特权命令/主机路径/仓库信任）与 `daemon/worker/runtime-interceptor.ts`（配置漂移降级 + 未知通道检测）已接入 `daemon/mcp/gateway.ts` 与 `daemon/pipeline/orchestrator.ts`；`tests/unit/threat-guard-runtime-check.test.ts` 26 个用例全绿，其中「4 类绕过负例全部阻断」为显式用例。**口径说明**：本卡证明为注入层 + Gateway 层；真实 CLI 版本的同口径负例归 `TASK-W.5a`）
* **核心目标 (闭环 A §4.2.3, §6.4.7, §7.3)**：
  1. **高风险执行威胁守卫 (产出 `E_UNSAFE_EXECUTION`)**：
     - 在命令启动前校验 argv 与仓库信任标记；
     - 命中不可信仓库、特权操作（`sudo`, `chown`, `insmod`）、访问任意主机路径或无法可靠限制子进程的高风险命令时，坚决拒绝执行；
     - 抛出 `E_UNSAFE_EXECUTION`，将 Evidence 置为 `status: "BLOCKED"` 且 `reason_code: "UNSAFE_EXECUTION"`，并在 UI 提示外置隔离。
  2. **运行时强制能力复检与降级**：
     - 在 Worker 会话期间，周期性或在每步工具调用前复检 Adapter 强制能力；
     - 若探测到启动配置被篡改、原生 FS/Shell 工具未被拦截或出现未知通道，立即将当前会话降级为 `UNCONTROLLED_EXTERNAL`，停止受控执行，阻断 Evidence 通过，并广播 `GATEWAY_VIOLATION`。
  3. **落实 4 类绕过路径不可用负例断言**：
     - 绕过 1：直接向 Worktree 外路径写入 ➔ 必然失败；
     - 绕过 2：执行未授权 Shell ➔ 必然失败；
     - 绕过 3：跨 Worktree 直接访问主工作树 ➔ 必然失败；
     - 绕过 4：跳过 Gateway 直接调用原生工具 ➔ 必然失败。
* **涉及核心文件**：
  - 新增：`daemon/worker/threat-guard.ts`
  - 新增：`daemon/worker/runtime-interceptor.ts`
  - 测试：`tests/unit/threat-guard-runtime-check.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 特权命令（如 `sudo ls`）被 Threat Guard 拦截，抛出 `E_UNSAFE_EXECUTION`，未产生子进程，Evidence 被标记为 `BLOCKED` + `UNSAFE_EXECUTION`。
    - 运行时注入未知工具通道后，Adapter 立即被降级为非受控状态，当前合同禁止生成通过证据。
    - 4 类绕过负例测试 100% 触发阻断。
  - **FAIL**：特权命令进入执行；绕过 Gateway 能够读写文件。

---


---

<a id="task-w.5a"></a>

#### 【Task W.5a】Claude Code 适配器与 cli-host 黑盒实测 (v1.3.3 新增)
* **任务编号**：`TASK-W.5a`
* **前置依赖**：`TASK-W.2`, `TASK-C.6`（右栏会话通道）
* **任务状态**：**[PASS · verified_on: `Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21`]**（分支 `feat/w5a-claude-code`。cli-host 唯一 spawn（shell:false、进程组、SIGINT→SIGTERM→整树 SIGKILL）；一律 API Key；隔离启动见核心目标 2；真实 CLI 上流式输出、工具卡片、打断（约 0.5s）、跨 Daemon 重启 `--resume` 续接、4 类绕过负例均实测通过，证据见 见 Git 历史（原 `docs/archive/claude-code-isolation-design.md`）。**2026-10-21 步骤 D 实测收口**：以 `deepseek-chat` @ `https://api.deepseek.com/anthropic` 复跑真实 CLI 负例 **6/6 全绿**（48.58s），首次落盘 `PreToolUse hook` 的 `deny` 日志原文（含 symlink 逃逸判定）；并补测 `allowBash=true` 分支——Shell 命令触碰保护清单路径时，`shellProtectionVerdict` 按字面量拒绝并投递白话确认卡（`rm`/`mv` 均被拦，目标文件完好），证据归档 `docs/reports/W5a-真实CLI验证报告-2026-10-21.md` §4.4。**后续回归项（不阻塞）**：用官方 Anthropic 原装模型 + 官方 CLI 重跑负例；每次升级 CLI 重跑 `STAGENT_REAL_CLAUDE=1` 真实测试；Gateway MCP HTTP 端点由 W.8 实现；W.4 是 threat-guard。**同轮发现并已加固（2026-10-22）**：`allowBash=true` 原先只做保护清单字面量匹配，缺「命令是否指向工作目录之外」的通用检查，`../` 越界写与 `rm -rf .stagent` 实测可绕；现 Bash 分支已串接 `reservedMetadataHit()`（`.stagent/.git/.claude/.cursor/.env` 按路径段拒绝）与 `shellEscapeVerdict()`（重定向目标与全部词元的越界判定，含 symlink 真实路径），同一攻击复测被拒且 `outside/` 为空；`/dev/null`、通配符前缀等常规用法保留，21 条命令矩阵零误伤；证据见报告 §4.5。）
* **核心目标**：
  1. 在 `daemon/worker/cli-host/` 专用子进程隔离模块中以 spawn 挂载 Claude Code CLI（结构化 argv、`shell:false`、进程树托管回收）；**全仓其余位置维持零 `child_process` 静态禁令**。
  2. **收敛策略（已实测，verified_on: `Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21`）**：优先保留 Claude Code 原生工具，通过官方 **Pre-tool hook** 配合 Stagent 网关拦截；辅以工具白名单/黑名单收窄内置 Edit/Write/Bash/WebFetch；避免粗暴剥离原生工具导致模型死循环。工作目录锁定 Worktree。**隔离启动（`[用户已确认 · 2026-10-20]`，替代 `--bare`——实测 2.1.296 的 `--bare` 会跳过 `--settings` 中的 hooks）**：
     - argv：`claude --setting-sources "" --tools Read,Glob,Grep,Edit,Write,MultiEdit,TodoWrite -p <prompt> --output-format stream-json --verbose --include-partial-messages --settings <Stagent 生成> --mcp-config <Stagent 生成> --strict-mcp-config --permission-mode acceptEdits --allowedTools <同 --tools> --disallowedTools WebFetch,WebSearch,NotebookEdit,Task,Bash [--resume <session_id>]`（允许 Bash 时 `--tools`/`--allowedTools` 加 Bash、`--disallowedTools` 去掉 Bash）；永不 `--bare`、永不 bypassPermissions、永不 `--continue`。
     - `permissions.deny`：`WebFetch, WebSearch, NotebookEdit, Task, Bash, Edit/Write(./.git/**), Edit/Write(./.stagent/**), Edit/Write(./.claude/**), Read(./.stagent/claude-config/**), Read(./.stagent/session-token)`；PreToolUse hook `matcher:"*"`、`onFailure:"block"`。
     - 子进程 env 白名单：`PATH, HOME, LANG, STAGENT_HOOK_ROOT, STAGENT_HOOK_LOG, [STAGENT_HOOK_ALLOW_BASH], ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR`，另仅转发 `ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, ANTHROPIC_SMALL_FAST_MODEL, ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`。
     - 专用配置目录：`CLAUDE_CONFIG_DIR=<repo>/.stagent/claude-config`（0700、gitignored、Agent 不可读写），会话记录不写用户 `~/.claude`。
     - 备选：`--restricted`（实测不跳过 hook，但不收窄工具、默认 auto 模式），仅在 `--setting-sources ""` 行为变化时启用。
  3. 接入其 Headless 模式与结构化输出（流式 JSON）对接右栏会话（TASK-C.6）；接入其会话续接能力实现 resume。
  4. 在 cli-host 中对**真实 CLI 版本**执行 W.4 的 4 类绕过负例实测，全部失败关闭后填写 `verified_on`（CLI 版本号 + 日期），方标记 `GATEWAY_ENFORCED`。
* **涉及核心文件**：
  - 新增：`daemon/worker/cli-host/claude-code-adapter.ts`
  - 新增：`daemon/worker/cli-host/process-host.ts`（spawn 托管与进程树回收）
  - 新增：`daemon/worker/cli-host/pretool-hook.mjs`（PreToolUse 门卫：越界/保留区/保护清单判定，含 2026-10-22 Shell 加固）
  - 测试：`tests/unit/cli-host-claude-code.test.ts`（确定性，含 hook 层 4 类绕过负例）；`tests/e2e/claude-code-isolation.real.test.ts`（真实 CLI，`STAGENT_REAL_CLAUDE=1` 时运行：配置注入负例、4 类绕过、专用配置目录续接）
* **Pass/Fail 验收判定**：
  - **PASS**：4 类绕过负例在真实 CLI 版本上 100% 失败关闭（2026-10-21/22 复测 **6/6 全绿**：4 类绕过 + `allowBash` 的保护清单字面量拦截 + `allowBash` 的越界/元数据加固；MCP 工具与 Read 越界读负例仍为空集合下的未测项，见 见 Git 历史（原 `docs/archive/claude-code-isolation-design.md`））；`verified_on` 非空；流式输出与打断/续接实测达标。
  - **FAIL**：任一绕过路径可用；未实测即标记受控。


---

### 3.4 Cursor 式三栏 IDE 工作台与多维 Studio 视口（C.1/C.3 落 Sprint 1；C.2 落 Sprint 4 多维视口；C.8a/b/c 走查 Top3 已合；C.9a–C.9d 第二轮指挥权已合；C.10a–q 第三/四轮体验打磨已合；**C.11a–e Supervisor 五步体感链 COMPLETED**；**C.12a–e Spec Freeze Top5 Delta COMPLETED**；**C.14a–c 基线档案 COMPLETED**；**C.14d/e 安全闭环加固 NEW**；C.4 推迟）

<a id="task-c.1"></a>

#### 【Task C.1】Cursor 式三栏 IDE 响应式工作台骨架与 Studio 视口
* **任务编号**：`TASK-C.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（分支 `feat/c1-three-column-layout` 提交 `e48f614`，**2026-10-21 核验：已合入 main**；当时门禁：tsc 0 错、eslint 0 错、npm test 53 文件 / 435 用例全过，其中 tests/ui/workspace-layout.test.tsx 7 用例；当前该套件 8 用例）
* **核心目标**：
  1. 构建左栏（文件树/雷达）、中栏（Monaco/Diff/Supervisor Studio 多标签与分屏）、右栏（Coding Agent 对话）的三栏 IDE 布局。
  2. **中栏多标签与分屏架构**：
     - 支持中栏多标签页切换，支持系统级 `SupervisorStudio` 标签页；
     - 支持 Split Pane（分屏）：左侧打开代码/Diff，右侧打开 Supervisor Studio，实现并排对照。
  3. **Header 补齐 5 项展示要素与 HUD 胶囊 (G-06)**：
     - 仓库名称；
     - **当前分支**（活动合同执行期展示 `task/{contract_id}`，平时展示 Base 分支）；
     - **运行模式**（v1.3.3：清晰展示 `VIBE` 自由模式（默认）vs `PROTECTED` 保护模式；是否有合同正在执行由合同信息与执行状态单独展示）；
     - 当前合同 ID 与绑定的 Worktree 物理绝对路径；
     - **Worker 受控状态徽标**（`GATEWAY_ENFORCED` 绿色受控 vs `UNCONTROLLED_EXTERNAL` 黄色非受控）；
     - **Supervisor 入口**（v0.1：一键打开 Studio 快捷入口；成熟度打分徽章、未决风险气泡推迟 v0.2+）。
  4. **工作区默认绑定与切换提示 (G-18)**：合同批准后编辑区默认绑定 Worktree；切回主工作树时给出显式切换提示与执行状态指示。
* **涉及核心文件**：
  - 新增：`src/components/WorkspaceLayout.tsx`
  - 新增：`src/components/FileTree.tsx`
  - 新增：`src/components/WorkspaceHeader.tsx`
  - 新增：`src/components/SplitPaneContainer.tsx`
  - 测试：`tests/ui/workspace-layout.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：Header 完整包含模式指示、受控徽标、Studio 入口；中栏支持 Supervisor 专属标签页与分屏布局；审批后工作区自动切换绑定 Worktree。
  - **FAIL**：缺少受控徽标或模式指示；中栏无法渲染分屏或系统标签页。

---


---

<a id="task-c.2"></a>

#### 【Task C.2】中栏 Supervisor Studio 多维视口（Demo / Graph / 质询 / 合同）`[v1.5.0 升级]`
* **任务编号**：`TASK-C.2`
* **前置依赖**：`TASK-C.1`, `TASK-S.2`, `TASK-S.4`, `TASK-C.7`, `TASK-S.5`
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，merge `51039aa`；分支 `feat/task-c2-four-viewports` 提交 `c1ad3be`。门禁：合后四件套全绿（1099 passed / 6 skipped）；tsc 0 错、eslint 0 错、build 通过（dist 33 文件 / 3.35 MB）。落地清单：`StudioViewportShell`（四视口 `hidden` 保活）、`DemoPreviewPane` / `TaskGraphPane` / `DisputeConsolePane`、`viewport-routing.ts`（展示态→默认视口）、`use-daemon-stream`/`daemon-api` 消费 `presentation_state`、`demo-origin.ts`、`tests/ui/studio-viewport-switching.test.tsx`（15）。**口径说明**：① 默认视口只跟 Daemon 展示态，手动 Tab 覆盖，展示态一变清覆盖；② Demo iframe 沙箱仅 `allow-scripts`，严禁 `allow-same-origin`；③ Graph 复用 C.7 `TaskGraphPanel`，质疑复用 S.5 API。**残余口径差（不阻塞验收，需登记）**：①【修改原型】/【确认原型并实施真实工程】按钮 UI 在位，旅程编排层仍为弱接线——**已转交 `TASK-S.6` 吸收**；② 矩阵旧注「水表」非本卡 Pass 项，未纳入本次交付）
* **核心目标**：
  1. **Studio 四重视口集成切换**：
     - **视口 1: Demo 原型试玩视口 (`DemoPreviewPane.tsx`)**：以 iframe/Webview 嵌入 TASK-S.4 启动的本地轻量预览服务，顶部配备【修改原型】与【确认原型并实施真实工程】大操作栏；
     - **视口 2: Task Graph 拓扑看板 (`TaskGraphPane.tsx`)**：挂载 TASK-C.7 的业务功能思维导图与任务执行 DAG，展现由灰变绿渐进点亮；
     - **视口 3: 质疑自查质询台 (`DisputeConsolePane.tsx`)**：呈现用户质疑输入框与 TASK-S.5 产出的三方比对自查报告卡片；
     - **视口 4: 合同与 Diff 审阅视口 (`SupervisorStudioPane.tsx`)**：保留结构化合同审阅、全局保护清单白话是/否卡片与 Monaco 代码编辑。
  2. **视口智能路由**：根据当前生命周期状态自动激活对应视口（如处于 `DEMO_PREVIEW` 自动切至 Demo 视口；处于 `EXECUTING` 自动切至 Task Graph 视口；处于 `DISPUTED_INSPECTING` 自动切至质询台）。
  3. **模式指示与保护清单兜底**：保留 Header 模式指示（自由模式 / 保护模式）与全局保护清单单项白话卡片。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`src/components/studio/StudioViewportShell.tsx`、`DemoPreviewPane.tsx`、`TaskGraphPane.tsx`、`DisputeConsolePane.tsx`、`viewport-routing.ts`
  - 新增：`src/lib/ipc/demo-origin.ts`
  - 修改：`src/components/SupervisorStudioPane.tsx`、`src/routes/index.tsx`、`src/hooks/use-daemon-stream.ts`、`src/lib/daemon-api.ts`
  - 测试：`tests/ui/studio-viewport-switching.test.tsx`（+既有 route/admission/draft wiring 适配）
* **Pass/Fail 验收判定**：
  - **PASS**：用户可在 Demo 试玩、Task Graph 看板、质询自查台与合同代码之间平滑切换；状态流转自动切换主视口；保护清单命中白话卡片维持零弹窗/单卡标准。
  - **FAIL**：视口切换丢失已填表单或点亮状态；iframe 无法内嵌加载本地 Demo。

---

<a id="task-c.8a"></a>

#### 【Task C.8a】老板模式文案与默认助手（消演示恐吓 / Key 向导）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.8a`
* **前置依赖**：`TASK-D.1d` (COMPLETED，main tip `b11d15b`；文档基线含 `fea44e2`)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `15ef8e6`，分支 `feat/task-c8a-boss-copy` 快进；合后四件套 **1213 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：练习沙箱可折叠、默认真助手、右栏 Key 三步向导 + 设置白话闭环；涉及 `AgentChatPane` / `pick-chat-adapter` / `WorkspaceLayout` / `SettingsTab` / `routes/index` 等。**不推翻**鉴权 / Demo Origin）
* **对照痛点（走查）**：默认「演示 Agent」+ 大黄字「不调用模型、不读文件」与右栏「说需求」打架；真助手显示未配 Key 却无一条龙向导——老板会以为「不能干活」。
* **v0.1 范围**：把工作台默认话术与助手选择收成**老板模式**：① 默认呈现不恐吓、与「可以提需求」一致；② 未配模型 Key 时给白话一步步向导（去哪配、配完怎么知道好了）；③ 演示/沙箱能力若仍保留，须降级为可折叠的次要说明，不得用整页黄条阻断心智。
* **明确不包含**：
  - 推翻 D.1 鉴权 / loopback / `#token=` / AUTH / Origin
  - 改变 Demo 独立 Origin 隔离（ADR-008）
  - 实现系统文件夹选择器或桌面壳（归 `TASK-D.1e`）
  - 改 Fast Path 准入规则或状态机边（归 `TASK-C.8b` 只做呈现）
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **消恐吓**：首屏/右栏不再用「不调用模型、不读文件」大黄条否定「右侧说需求」；演示态若存在，须明确是可选沙箱且可一键切到真助手路径。
  2. **默认助手可预期**：默认选中的助手与文案一致（能干活或明确「还差一步」）；禁止「默认演示」与「请说需求」并存无解释。
  3. **Key 向导一条龙**：真助手未配 Key 时，UI 给出配置入口/粘贴位置提示与「配完如何验证」的短路径，不甩终端堆栈或工程师后台术语墙。
* **涉及核心文件（实施时以调查为准）**：右栏 Agent 选择器 / 欢迎或空态文案、Header 或会话横幅、Key/凭证配置入口相关组件与文案常量；测试以 UI 走查断言 + 组件快照/文案单测为主。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **不再恐吓**：冷开工作台后，主路径 10 秒内看不到「不调用模型 / 不读文件」级整页恐吓与「请说需求」并排打架；若演示态存在，须可折叠或明确次要。
  2. **默认一致**：默认助手名称/状态与右栏可操作提示一致（能提需求，或明确「差 Key」并给出按钮）。
  3. **Key 向导**：未配 Key 时，用户可不查 README，只靠 UI 完成「打开配置入口 → 填 Key（本卡不测真实云调用）→ 看见已就绪/可重试」白话闭环。
  4. **安全不回退**：日志/UI 不打印 Token 或 API Key 明文；鉴权与 Demo Origin 回归仍绿。
  5. **门禁**：四件套全绿；新增或扩展至少 1 条文案/空态 UI 回归（禁止恐吓文案与主 CTA 冲突）。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 本地可复现；老板模式只改呈现与向导，不弱化鉴权。
  - **FAIL**：仍默认演示恐吓却标完成；未配 Key 仍只有工程师报错无向导；打印密钥明文；夹带 D.1e 桌面壳冒充本卡。

---

<a id="task-c.8b"></a>

#### 【Task C.8b】Fast Path 老板三步台（藏工程师合同细节）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.8b`
* **前置依赖**：`TASK-D.1d` (COMPLETED), `TASK-S.6` (COMPLETED)
* **任务状态**：**[COMPLETED]**（合入 main tip `6d16939`，分支 `feat/task-c8b-boss-fastpath` 快进；合后四件套 **1224 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`BossFastPathDesk` 默认三步；高级详情折叠 Scope/npm/Daemon；保护命中需勾选；大事仍完整合同台；**不改**准入规则/状态机边）
* **对照痛点（走查）**：右侧说一件小事后，中栏仍甩出合同台（`src/**`、npm、Daemon、保护解锁），像审批工单，不像「改哪里 → 确认开改」。
* **v0.1 范围**：在**不改变** Fast Path 准入规则与状态机边的前提下，把小事确认台改成老板三步默认视图：「① 改哪里（白话文件/位置）② 要不要动保护（是/否白话）③ 确认开改」。工程师细节（Scope glob、npm、Daemon、解锁暗号等）默认折叠，需要时再展开。
* **明确不包含**：
  - 放宽/收紧 Fast Path 准入条件或改 Contract Schema / lifecycle 边
  - 取消保护清单拦截或静默跳过保护区
  - 重做整套 Studio 四视口（C.2 已 COMPLETED）
  - 系统文件夹选择器（D.1e）
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **三步默认**：小事 Fast Path 中栏默认只见三步白话卡，一眼能点「确认开改」。
  2. **细节可展开**：原合同工程字段仍可「高级/详情」展开，不得物理删除审计所需信息。
  3. **大事不变**：非 Fast Path / 大事草案仍可走既有合同/Graph 路径（S.6），本卡不把大事也强行三步化。
* **涉及核心文件（实施时以调查为准）**：Fast Path / 合同审阅中栏组件、S.6 journey 接线的确认台、文案与折叠控件；测试：UI 走查 + 组件测「默认三步可见 / 细节默认隐藏」。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **三步可见**：对一条合格小事（走查脚本固定文案），中栏默认出现「改哪里 / 要不要动保护 / 确认开改」三步，无需滚动才能找到主按钮。
  2. **细节默认藏**：`src/**`、npm、Daemon、保护解锁等工程字段默认不占主视线（折叠或次级区）；展开后仍可读。
  3. **保护不哑火**：若小事命中保护清单，第二步必须白话问清楚，不得因折叠而跳过确认。
  4. **大事不误伤**：非 Fast Path 路径仍可进入既有合同/Graph 体验（至少一条对照走查不过度三步化）。
  5. **门禁**：四件套全绿；至少 1 条 UI 回归锁定「默认三步 / 细节折叠」。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；准入规则与保护拦截行为与改前一致（仅呈现变化）。
  - **FAIL**：仍默认甩满工程师合同台却标完成；折叠导致保护区未确认即开改；借本卡改状态机却不另立卡。

---

<a id="task-c.8c"></a>

#### 【Task C.8c】连接与打开死路自救（无钥匙一键重开 + 粘贴路径打开）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.8c`
* **前置依赖**：`TASK-D.1b` (COMPLETED), `TASK-D.1c` (COMPLETED), `TASK-D.1d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（合入 main tip `950e53e`，分支 `feat/task-c8c-open-rescue` 快进；合后四件套 **1217 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`POST /api/session/relaunch` 无钥匙一键重开；粘贴绝对路径 `/api/recent-projects/open`；主路径少催终端/#token=；**不抢** D.1e）
* **对照痛点（走查）**：无 token 冷开锁死对话；开新文件夹仍大段催 `npx stagent open`（D.1e 已 DEFERRED，本卡**只做**文案 + 粘贴路径 / 一键重开，**不**实现系统选择器）。
* **v0.1 范围**：给「连不上 / 要开新夹」两条死路自救：① 无钥匙或 Unauthorized 时，一键唤起/重开带 `#token=` 的合法会话（复用 D.1b/D.1c 能力），不死锁在空对话；② 「打开项目」支持粘贴本机绝对路径并一键 open/重开，文案少催终端说明书。**明确不抢** `TASK-D.1e`。
* **明确不包含**：
  - 系统级文件夹选择器 / Electron / Tauri / 本机助手选夹（**整段归 `TASK-D.1e`，本卡 FAIL 若夹带并标完成**）
  - 取消 `#token=` / AUTH；把 Token 写入可分享 query 或长期明文 localStorage
  - 将 Demo 改为与控制台同源
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **无钥匙可自救**：冷开无 token / 鉴权失败时，主按钮是「一键重开（带钥匙）」或等价，而不是只显示 Unauthorized 说明书。
  2. **粘贴路径可开**：打开项目面板可粘贴绝对路径 → 一点即走 open/唤起（成功则进已连接工作台）；失败给白话原因（如锁冲突）。
  3. **少催终端**：主路径文案不再把「去终端敲 `npx tsx bin/stagent.ts open …`」当唯一出路；终端命令可留在「高级/仍失败时」。
* **涉及核心文件（实施时以调查为准）**：`OpenProjectEntry`、无 AUTH/空态页、`daemon-api` 打开/最近项目接线、相关文案；测试：无 token 自救 UI、粘贴路径 open 冒烟（可用临时目录）、不打印 Token。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **无钥匙自救**：去掉 `#token=` 冷开后，可见一键重开/带钥匙入口；点后进入可聊会话（或明确正在唤起），不是永久锁死空输入框。
  2. **粘贴路径**：在「打开项目」粘贴合法绝对路径并确认，能复用/启动会话进入工作台（与 `stagent open` 同权结果）；无需先手拷 Token。
  3. **文案**：主路径不再把终端 `stagent open` 当唯一 CTA；终端说明可降级到高级区。
  4. **不抢 D.1e / 不回退安全**：无系统选夹冒充完成；无钥匙仍不能旁路 AUTH；日志无 Token 明文；Demo Origin 不回退。
  5. **门禁**：四件套全绿；至少 1 条打开/鉴权空态回归。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；D.1e 仍保持 DEFERRED 且本卡未伪称已交付系统选夹。
  - **FAIL**：无钥匙仍锁死无按钮；开新夹仍只催终端却标完成；夹带系统选择器却标本卡（应开 D.1e）；打印 Token 明文。

---

<a id="task-c.9a"></a>

#### 【Task C.9a】首屏单一主路径（三态只留一个指挥信号）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9a`
* **前置依赖**：`TASK-C.8a` (COMPLETED), `TASK-C.8b` (COMPLETED), `TASK-C.8c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `ef0e1a7`，分支 `feat/task-c9a-single-command-surface` 快进；合后四件套 **1231 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`resolveCommandSurface` 三态单一主 CTA；欢迎区/打开面板/顶栏徽标降级；涉及 `command-surface.ts` / `WorkspaceLayout` / `WelcomePane` / `AgentChatPane` / `OpenProjectEntry` 等。**不推翻**鉴权 / Demo Origin）
* **对照痛点（第二轮走查）**：冷开首屏同时出现——中栏欢迎教打开文件、右栏要你说话/配钥匙、顶栏 PROTECTED、左栏「打开项目」面板——4～5 个声音抢指挥，老板不知道先听谁。
* **v0.1 范围**：把工作台首屏收成**单一主路径**：按连接与会话态只保留一个主指挥信号——① **无钥匙**：只指挥「一键重开/配钥匙」；② **有钥匙空闲**：只指挥「右侧说需求」；③ **进行中**：只指挥当前对话/三步台/确认动作。其它面板与横幅降级为次要或默认收起，不得并排抢注意力。
* **明确不包含**：
  - 推翻 D.1 鉴权 / loopback / `#token=` / AUTH / Origin
  - 改变 Demo 独立 Origin（ADR-008）
  - 实现系统文件夹选择器或桌面壳（`TASK-D.1e`）
  - 重做助手模式互斥细则（归 `TASK-C.9b`）、打开面板生命周期细则（归 `TASK-C.9c`）、进行中中栏让路细则（归 `TASK-C.9d`）——本卡只定「同一时刻谁当指挥官」的呈现纪律
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **三态互斥指挥**：无钥匙 / 有钥匙空闲 / 进行中，同一时刻主 CTA 与主说明只来自一个指挥源。
  2. **次要降噪**：打开项目面板、IDE 欢迎页、PROTECTED 工程师暗号、练习沙箱说明等不得与主 CTA 同级并排恐吓或抢焦点。
  3. **可走查**：给定三态脚本，10 秒内能指出「现在该点哪一个主按钮」，无需读多段互相打架的说明书。
* **涉及核心文件（实施时以调查为准）**：`WorkspaceLayout` / 首屏空态 / Header 横幅 / 右栏欢迎与向导入口 / 打开项目入口的默认可见性；测试以 UI 三态走查断言为主。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **无钥匙态**：主视线只有「一键重开/配钥匙」类单一指挥；中栏欢迎「打开文件」与「请说需求」不得同级并排争夺。
  2. **有钥匙空闲态**：主指挥是「右侧说需求」；打开项目面板默认不展开盖住左栏；恐吓级黄条不再与主 CTA 打架。
  3. **进行中态**：主指挥交给当前对话或三步台/确认；欢迎页/空页签堆叠不得继续当指挥官（细则落实可与 C.9d 联验）。
  4. **安全不回退**：不打印 Token/Key 明文；鉴权与 Demo Origin 回归仍绿。
  5. **门禁**：四件套全绿；至少 1 条「三态单一主 CTA」UI 回归。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；首屏指挥权清晰，不弱化鉴权。
  - **FAIL**：仍 4～5 个同级声音抢指挥却标完成；借本卡改鉴权或夹带 D.1e。

---

<a id="task-c.9b"></a>

#### 【Task C.9b】助手模式互斥（练习 vs 真助手 vs 向导）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9b`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.8a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `c4818fa`，分支 `feat/task-c9b-assistant-mode-mutex` 快进；合后四件套 **1239 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`resolveAssistantMode` wizard/practice/real；向导发送禁用+去配置；练习横幅；中栏随模式；`src/lib/assistant-mode.ts` + `AgentChatPane` / `routes/index`；单元+UI 回归。**不推翻**鉴权 / 真实云调用门禁）
* **对照痛点（第二轮走查）**：一边提示「还差钥匙 / 练习沙箱」，一边发送键仍可点、中栏仍像在干活——信号互斥失败，老板以为系统在装忙或装坏。
* **v0.1 范围**：把右栏助手收成三态**互斥机**：① **练习沙箱**（明确不可当真干活）；② **真助手就绪**；③ **Key 向导**（未配钥匙）。发送键可用性、占位文案、中栏提示必须随模式切换，禁止「缺钥匙还能发消息假装干活」。
* **明确不包含**：
  - 放宽/绕过真实模型鉴权或把 API Key 写入可分享通道
  - 取消练习沙箱能力（可保留，但必须互斥且标明）
  - 重做首屏三态指挥纪律（归 C.9a）或设置深链回跳（归 C.9d，本卡只要求向导态有唯一「去配置」出口）
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **三态互斥**：同一时刻只处于练习 / 真助手 / 向导之一；切换有可见反馈。
  2. **发送键随模式**：向导态与「不可当真」的练习态不得呈现「已在干活」的发送反馈；真助手就绪才是正常发送主路径。
  3. **中栏随模式**：模式切换时中栏提示与右栏一致（缺钥匙不装忙；练习不装生产）。
* **涉及核心文件（实施时以调查为准）**：`AgentChatPane` / `pick-chat-adapter` / Key 向导入口 / 发送按钮禁用逻辑；测试：三态互斥 UI + 发送键断言。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **互斥**：无法同时显示「请配钥匙」主向导与「真助手正在处理」级发送成功反馈。
  2. **向导态**：未配 Key 时发送键禁用或点击只导向配置，不得假装流式干活。
  3. **练习态**：若进入练习沙箱，文案明确「练习/不可当真」；切回真助手路径一键可达。
  4. **真助手态**：Key 就绪后主路径可发送；与 C.8a 向导闭环不回退。
  5. **门禁**：四件套全绿；至少 1 条模式互斥/发送键回归；不打印 Key 明文。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；三态信号一致。
  - **FAIL**：缺钥匙仍可装忙发送却标完成；练习与真助手文案并存无解释。

---

<a id="task-c.9c"></a>

#### 【Task C.9c】打开项目面板生命周期（默认收 / 成功即关 / 已连接降级为切换）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9c`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.8c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `2f5d653`，分支 `feat/task-c9c-open-panel-lifecycle` 快进；合后四件套 **1246 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：默认收；成功即关；已连接「切换项目」；`src/lib/open-project-panel.ts` + `OpenProjectEntry`；单元+UI 回归。**不抢** D.1e；**不回退** C.8c）
* **对照痛点（第二轮走查）**：「打开项目」面板粘住不收，盖住左栏；选完/连上也不关；已连接时仍像冷开首屏再盖一层。
* **v0.1 范围**：规范打开项目面板生命周期——① 默认收起；② 打开或切换成功后自动关闭；③ 已连接会话中入口文案/行为降级为「切换项目」，不再以冷开全屏指挥官姿态盖住主路径。**不抢** `TASK-D.1e`（不做系统选夹）。
* **明确不包含**：
  - 系统级文件夹选择器 / Electron / Tauri（`TASK-D.1e`）
  - 取消 C.8c 的无钥匙一键重开与粘贴路径能力
  - 推翻 D.1/D.1b 鉴权与 `#token=`
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **默认收**：有钥匙空闲/进行中冷开后，打开项目面板不默认展开挡左栏。
  2. **成功即关**：最近项目一点重开、粘贴路径打开、一键重开成功后，面板关闭并回到主路径。
  3. **已连接降级**：已鉴权连接下，入口是「切换项目」次要动作，不是再盖一层首屏指挥官。
* **涉及核心文件（实施时以调查为准）**：`OpenProjectEntry` / 左栏打开按钮状态 / 成功回调关面板；测试：默认收、成功关、已连接文案降级。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **默认收**：有钥匙空闲首屏，打开项目面板不默认展开盖住左栏主树。
  2. **成功即关**：完成一次打开/切换/重开成功后，面板关闭，主指挥回到 C.9a 对应态。
  3. **已连接降级**：已连接时入口不再以「你还没打开项目」级首屏指挥官姿态出现。
  4. **不抢 D.1e / 不回退 C.8c**：无系统选夹冒充；粘贴路径与一键重开仍可用；无 Token 明文。
  5. **门禁**：四件套全绿；至少 1 条面板生命周期 UI 回归。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立。
  - **FAIL**：面板仍粘住不关却标完成；夹带系统选夹冒充本卡。

---

<a id="task-c.9d"></a>

#### 【Task C.9d】进行中中栏让路（收欢迎页 / 设置深链回跳）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.9d`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.9b` (COMPLETED), `TASK-C.8b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `edc28ce`，分支 `feat/task-c9d-middle-yield-settings-return` 快进；合后四件套 **1254 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`middle-yield` 收欢迎页；三步台/保护确认自动开 Studio；设置深链模型钥匙 + 返回对话；PROTECTED 聊≠改白话；`src/lib/middle-yield.ts` + `WorkspaceLayout` / `SettingsTab` / `routes/index`；单元+UI 回归。**不含**重做 Studio 四视口路由）
* **对照痛点（第二轮走查）**：右侧已开聊或小事已走 Fast Path，中栏仍停在 IDE 欢迎页/空页签堆叠，C.8b 三步台接不上主视线；进设置配钥匙时其它面板叠罗汉，配完不知道回哪。另：锁着（PROTECTED）仍可聊时，须白话说清「先聊方案，动文件才要你点头」——与中栏让路同一「进行中指挥」闭环。
* **v0.1 范围**：① 对话进行中或小事三步台出现时，中栏收起 IDE 欢迎页与无意义空页签堆叠，让路给对话上下文或 `BossFastPathDesk`；② 从 Key 向导进入设置须深链到模型钥匙区，配完提供一键回跳右栏/主路径，避免设置叠罗汉；③ 进行中若仍可聊，一句白话说明「聊不等于改文件」。
* **明确不包含**：
  - 重做 Studio 四视口路由算法本体（C.2）或改 Fast Path 准入/状态机边（C.8b 已定呈现）
  - 取消 PROTECTED / 保护清单
  - 系统选夹（D.1e）
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **让路**：进行中中栏主视线是对话结果或三步台，不是欢迎页。
  2. **深链回跳**：向导 → 设置（钥匙区）→ 配完回跳，不丢上下文、不叠多层面板。
  3. **聊改分离白话**：可聊但未批准改文件时，一句说清，不靠 PROTECTED 暗号。
* **涉及核心文件（实施时以调查为准）**：中栏 Tab/欢迎空态、`BossFastPathDesk` 挂载条件、Settings 深链与返回栈、Header/右栏进行中提示；测试：进行中让路、设置回跳、白话提示。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **让路**：发送一条小事进入 Fast Path 后，中栏默认可见三步台（或明确进行中主视图），IDE 欢迎页不再占主视线。
  2. **深链**：从 Key 向导一键进设置后落在模型钥匙相关区，而非无关总览叠罗汉。
  3. **回跳**：配钥匙流程结束后，一键回到右栏主路径（或等价），无需手动关多层面板。
  4. **聊改分离**：进行中可聊未批准改文件时，可见一句白话说明（不依赖工程师 PROTECTED 暗号）。
  5. **门禁**：四件套全绿；至少 1 条让路/回跳 UI 回归；不打印 Token/Key。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立；C.8b 三步台真正接到主路径。
  - **FAIL**：聊起来中栏仍欢迎页却标完成；设置叠罗汉无回跳；借本卡改状态机不另立卡。

---

<a id="task-c.10a"></a>

#### 【Task C.10a】进行中生命周期收口（退出 in_progress / 无空让路壳）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10a`
* **前置依赖**：`TASK-C.9a` (COMPLETED), `TASK-C.9d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `5207df2`，分支 `feat/task-c10a-in-progress-lifecycle` 快进；合后四件套 **1261 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`src/lib/in-progress-lifecycle.ts`（`resolveActiveInProgress` / `resolveInProgressCta` / `shouldRenderMiddleYieldShell`）；`routes/index` 不再用 `journeyCards.length` 粘住进行中；`WorkspaceLayout` 无空让路壳 + 三步台保持 Studio；单元+UI 回归。**不含**重做 Studio 四视口；改鉴权）
* **对照痛点（第三轮走查）**：说过一件事后「进行中」容易一直挂着；关掉中间台后中栏只剩「中栏已让路」空壳，不知道还要干什么。根因倾向：`journeyCards` 只增不减 → `inProgress` 粘住；C.9d 做了让路，没收进行中退出与空态。
* **v0.1 范围**：① 旅程卡 / 保护确认 / Fast Path 三步台结束后，退出 `in_progress`，主指挥回到 C.9a 的 idle（或 no_key）；② 中栏在无确认卡、无三步台、无其它进行中主视图时，**不要**渲染空的 `middle-yield` 让路壳；③ 与 C.9a 单一指挥信号、C.9d 让路纪律一致——有东西才让路，没事回到空闲主路径。
* **明确不包含**：
  - 重做 Studio 四视口路由本体（C.2）
  - 改鉴权 / Demo Origin / 状态机边 / Fast Path 准入规则
  - 系统选夹（D.1e）；界面暗号清扫（归 C.10c / 统一抛光）
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **可退出**：进行中可结束；结束后不再假「进行中」。
  2. **无空壳**：让路只在有确认/三步台/进行中主视图时发生；关掉后不剩空 middle-yield。
  3. **指挥一致**：结束后主 CTA 回到 C.9a idle/no_key，不与设置/打开面板抢戏。
* **涉及核心文件（实施时以调查为准）**：`resolveCommandSurface` / `inProgress` 判定、`journeyCards` 生命周期、`middle-yield` / `WorkspaceLayout`、旅程/确认/BossFastPathDesk 结束钩子；测试：进行中退出、空让路壳不渲染、至少 1 条 UI 回归。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **退出**：旅程或 Fast Path/确认流程结束后，指挥面不再停留在 `in_progress`（回到 idle 或 no_key）。
  2. **无空壳**：中栏无确认卡且无三步台时，不出现仅含「中栏已让路」类空壳主视图。
  3. **有料才让路**：进行中且有三步台/确认时，仍遵守 C.9d 让路（欢迎页不抢主视线）。
  4. **不回退 C.9a**：结束后单一主 CTA 纪律仍成立（不突然恢复多指挥官堆叠）。
  5. **门禁**：四件套全绿；至少 1 条进行中退出 / 空壳 UI 回归；不打印 Token/Key。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立。
  - **FAIL**：结束后仍永久「进行中」却标完成；关台后空让路壳仍占中栏；借本卡改鉴权/Studio 路由不另立卡。

---

<a id="task-c.10b"></a>

#### 【Task C.10b】设置页老板主路径（钥匙主视线 / 工程师项进高级）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10b`
* **前置依赖**：`TASK-C.9d` (COMPLETED), `TASK-C.8a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `be33a26`，分支 `feat/task-c10b-settings-boss-path` 快进；合后四件套 **1265 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`SettingsTab` 模型钥匙置顶；`settings-advanced` 默认折叠收纳后台连接/诊断/工作区；C.9d 深链与返回对话保留；UI 回归 4 条。**不含**改鉴权语义；取消 token 能力）
* **对照痛点（第三轮走查）**：去配钥匙时，设置最上仍是 Daemon / Session Token / GATEWAY_ENFORCED 等后台词；虽能滚到钥匙区并回跳，仍像误入机房。C.9d 深链+回跳已有，未做老板可读化。
* **v0.1 范围**：① 设置页主视线是**模型钥匙**（老板能看懂的配钥匙主路径）；② Daemon / Session Token / GATEWAY 等工程师项收进可折叠「高级」；③ **保留** C.9d：从向导深链到钥匙区 +「配完了，返回对话」；④ 不改鉴权语义、不取消 token 能力——只调整文案与信息层级。
* **明确不包含**：
  - 改鉴权语义（loopback / `#token=` / AUTH）或取消 Session Token 能力
  - 重做整个设置信息架构以外的 Studio / 打开项目
  - 界面暗号清扫全集（归 C.10c）；系统选夹（D.1e）
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **核心目标**：
  1. **钥匙优先**：打开设置（含深链）第一眼是配模型钥匙，不是机房仪表盘。
  2. **高级折叠**：Daemon/Token/网关等默认不抢主视线，需要时再展开。
  3. **回跳仍在**：C.9d 深链与「配完了，返回对话」行为不回退。
* **涉及核心文件（实施时以调查为准）**：`SettingsTab` 区块顺序与折叠、深链滚动锚点、返回对话 CTA；测试：主视线钥匙、高级折叠、深链/回跳回归。
* **Pass/Fail 验收断言（≤5，可测/可走查）**：
  1. **主视线**：设置默认可见区以模型钥匙/老板配钥匙路径为主，不先堆 Daemon/Token 标题。
  2. **高级**：Daemon / Session Token / GATEWAY 类项在「高级」（或等价折叠）内，默认不抢首屏。
  3. **深链保留**：从 Key 向导进设置仍落到钥匙相关区（C.9d 不回退）。
  4. **回跳保留**：「配完了，返回对话」（或等价）仍可用。
  5. **门禁**：四件套全绿；至少 1 条设置主路径 UI 回归；不打印 Token/Key；鉴权行为不变。
* **Pass/Fail 验收判定**：
  - **PASS**：断言 1–5 成立。
  - **FAIL**：首屏仍是机房词却标完成；借本卡取消 token/改 AUTH；深链或回跳回退。

---

<a id="task-c.10c"></a>

#### 【Task C.10c】界面暗号/命名清扫（白话标签 + 图谱单入口）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10c`
* **前置依赖**：`TASK-C.10a` (COMPLETED), `TASK-C.10b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `6811f44`，分支 `feat/task-c10c-cipher-cleanup` 快进；合后四件套 **1267 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`workbench-labels.ts`；Tab/ActivityBar/底栏白话名；左栏图谱→`onOpenStudioGraph` 开合同操作台内视口；页脚「本机服务 / 有证据才合入」；欢迎新建需求弱链；UI 回归 2 条。**不含**改鉴权、指挥纪律、D.1e）
* **对照痛点**：中栏「Supervisor / Supervisor Studio / 任务图谱」像三套产品；Studio Tab 与 ActivityBar / 底栏仍甩英文暗号；任务图谱左栏独立 Tab 与合同操作台内视口**双入口**；空闲「说需求 / 新建需求」像两条路；页脚 Daemon / Evidence-gated。
* **v0.1 范围（施工合同）**：
  1. **单壳多标签**：不拆多路由；不把打开项目升成独立欢迎站；不做「简洁 IDE」新产品模式。
  2. **白话改名**（与既有 C.8b「合同操作台」一致，不另造「干活台」）：
     - Supervisor → **项目审阅**
     - Supervisor Studio → **合同操作台**
     - SmartTerminal / 底栏工程师词 → **验证输出**
     - ActivityBar `title`/`aria-label` 去掉英文暗号（保留图标 + 白话）
  3. **任务图谱双入口收口**：日常只留合同操作台内「任务图谱」视口一扇门；左栏图谱入口改为打开/聚焦合同操作台并切到图谱视口（或等价弱化），不再新建独立中栏「任务图谱」系统 Tab 作为主路径。
  4. **可选轻量**：空闲「说需求 / 新建需求」文案弱化合并（次要入口措辞降噪，不改 C.9a 单一指挥纪律）。
* **明确不包含**：不重做 C.9 / C.10a / C.10b 指挥纪律与生命周期；不改鉴权 / Demo Origin；不抢 D.1e；不打印 token；不重做 Studio 四视口路由本体（只改命名与入口）。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/WorkspaceLayout.tsx`、`layout/ActivityBar.tsx`、`SupervisorStudioPane.tsx`、`layout/WelcomePane.tsx`
  - `src/routes/index.tsx`（页脚 / 可选双 CTA / 图谱→Studio 视口信号）
  - 相关 UI 回归：`tests/ui/ide-shell.test.tsx` 等
* **Pass/Fail 验收判定**（≤5）：
  1. **命名**：中栏系统 Tab / ActivityBar / 底栏抽屉对用户可见文案不再出现 `Supervisor Studio`、`SmartTerminal` 作主标签（测试用 `getByRole`/`aria-label` 可断言新白话名）。
  2. **项目审阅**：原 Supervisor 入口对用户显示为「项目审阅」（或等价白话），功能仍为审阅/确认，不改合同准入。
  3. **图谱单入口**：点击左栏图谱入口后，打开的是合同操作台内图谱视口（或等价单门），**不再**以独立「任务图谱」系统 Tab 作为日常主路径双开。
  4. **不回退指挥纪律**：C.9a 单一主 CTA、C.10a 进行中收口、C.10b 设置钥匙主路径行为不回退（抽测既有回归仍绿）。
  5. **四件套**：`npm test` / `typecheck` / `lint`（0 errors）/ `build` 全绿；至少 1 条命名/入口 UI 回归；不打印 token。
* **FAIL**：仍双开图谱 Tab+视口当日常主路径；Tab 名与 C.8b「合同操作台」打架；回退鉴权或指挥纪律。

---


<a id="task-c.10d"></a>

#### 【Task C.10d】左栏老板主路径（换项目主视线 / 文件与资产进折叠）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10d`
* **前置依赖**：`TASK-C.10c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `51ae8ae`，分支 `feat/task-c10d-left-boss-path` 快进；合后四件套 **1273 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`left-panel-boss.ts`；`left-project-files` 默认折叠含规范与资产+文件树；空闲 `left-chat-hint`；`specsOpen` 默认 false；单元+UI 回归。**不含**改鉴权、D.1e、指挥纪律）
* **对照痛点**：左栏把打开/切换项目、规范与资产、完整源码树一次性铺开，主视线吵；老板日常只需要换项目 + 跟右侧说话。
* **v0.1 范围（施工合同）**：
  1. **默认主视线**：打开/切换项目（沿用 C.9c 简洁面板）保持可见；必要时加一句「跟右侧说话」提示（不新增第二指挥官，不改 C.9a）。
  2. **默认收进折叠**：规范与资产、完整文件树收入默认折叠的「项目文件」（或等价「高级」）；展开后能力与今日一致。
  3. **不取消能力**：文件仍可点开编辑；规范资产仍可查看；仅改默认层级与文案。
  4. **纪律对齐**：与 C.9a 单一指挥、C.10c 白话/单入口一致；不拆多路由；不做「简洁 IDE」新产品模式。
* **明确不包含**：不改鉴权 / Demo Origin；不抢 D.1e 系统选夹；不重做指挥纪律/生命周期；不删除 FileTree / Specs 能力。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/WorkspaceLayout.tsx`（左栏组装层级）
  - `src/components/FileTreeSpecsSection.tsx` / `src/routes/index.tsx`（规范区默认折叠）
  - 可选：`src/lib/left-panel-boss.ts` 呈现辅助
  - UI 回归：`tests/ui/workspace-layout.test.tsx` 或新增 `left-boss-path.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. **默认主视线**：资源管理器展开后，首屏可见打开/切换项目区；完整文件树与规范与资产**默认不铺开**（在折叠「项目文件」内）。
  2. **能力保留**：展开「项目文件」后仍可浏览文件树、打开文件、查看规范与资产（行为与合入前一致）。
  3. **提示不抢戏**：若有「跟右侧说话」文案，仅为次要说明，不新增与 C.9a 并列的主 CTA。
  4. **不回退**：C.9a/C.9c/C.10c 既有回归仍绿；不改鉴权、不抢 D.1e。
  5. **四件套**：`npm test` / `typecheck` / `lint`（0 errors）/ `build` 全绿；至少 1 条左栏默认层级 UI 回归；不打印 token。
* **FAIL**：默认仍同时铺开三块；取消文件树/资产能力；回退鉴权或指挥纪律；抢做 D.1e。

---

<a id="task-c.10e"></a>

#### 【Task C.10e】Cursor 式欢迎页承载打开/切换项目 `[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10e`
* **前置依赖**：`TASK-C.10d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `592f825`，分支 `feat/task-c10e-f-welcome-explorer` 快进；合后四件套 **1274 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。交付：`ProjectWelcomePage`；`OpenProjectEntry` page 变体；顶栏「切换项目」；左栏不再渲染开项目；保留 C.8c；**不含** D.1e）
* **对照痛点**：打开/切换项目塞在 IDE 左栏，和文件树抢戏；老板期望类似 Cursor 欢迎页单独管「开哪个项目」。
* **v0.1 范围（施工合同）**：
  1. **欢迎页主阵地**：`ProjectWelcomePage`（或等价）承载打开/切换项目；`OpenProjectEntry` `variant="page"` 整页展开。
  2. **保留 C.8c**：最近项目一键重开 + 粘贴路径 + 无钥匙 relaunch；**不含** D.1e 系统选夹。
  3. **IDE 左栏不再渲染** OpenProjectEntry；顶栏提供「切换项目」回欢迎页。
  4. **纪律**：开项目仍是次要指挥角色（`data-command-role=secondary`）；不拆多路由成独立网站。
* **明确不包含**：不改鉴权 / Demo Origin；不抢 D.1e；不重做指挥生命周期。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/layout/ProjectWelcomePage.tsx`（新增）
  - `src/components/layout/OpenProjectEntry.tsx`（page 变体）
  - `src/components/WorkspaceLayout.tsx` / `WorkspaceHeader.tsx`
  - `src/lib/left-panel-boss.ts`
  - UI：`tests/ui/left-boss-path.test.tsx` / `open-project-panel-lifecycle.test.tsx` / `command-surface.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. 首屏欢迎可见打开/切换项目面板（page）；左栏**无** `open-project` 入口。
  2. 最近一键重开 + 粘贴路径仍可用；无系统选夹控件。
  3. 顶栏「切换项目」可从文件编辑态回到欢迎开项目面。
  4. C.8c/C.9c 相关回归仍绿；不改鉴权。
  5. 四件套全绿；不打印 token。
* **FAIL**：开项目仍塞左栏；丢掉 C.8c 能力；抢做 D.1e；回退鉴权。

<a id="task-c.10f"></a>

#### 【Task C.10f】资源管理器纯文件树 + 规范与资产进项目审阅 `[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10f`
* **前置依赖**：`TASK-C.10e`（同 tip 合入）
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `592f825`，与 C.10e 同提交；合后四件套 **1274 passed / 6 skipped**。交付：`left-explorer` 纯文件树；`SupervisorTab.specsSection`；路由插槽迁移；规范区默认在审阅页展开。**不含**改鉴权。**热修（同日）**：① 停渲染 `leftExtra` 合同列表，迁 `SupervisorTab.requirementList`（1275）；② 空文件树——`files` 改绑 `GET /api/repo/tree` 建连加载（1277））
* **对照痛点**：规范与资产是 Supervisor 产物，不应和 `src`/`node_modules` 混在资源管理器里吓老板。
* **v0.1 范围（施工合同）**：
  1. **资源管理器**：左栏只展示纯文件树（「文件」标题）；去掉规范与资产与「项目文件」大折叠壳。
  2. **项目审阅**：`SupervisorTab` 增加「本轮依据（规范与资产）」；路由把 `FileTreeSpecsSection` 注入审阅页。
  3. **能力保留**：点开规范文件仍可在中栏编辑/预览；不取消 Specs 组件。
  4. **纪律**：与 C.10c 白话「项目审阅」、C.10e 欢迎开项目一致。
* **明确不包含**：不改鉴权；不拆多路由；不新造第二套资产系统。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/supervisor/SupervisorTab.tsx`（`specsSection`）
  - `src/components/WorkspaceLayout.tsx`（左栏纯树）
  - `src/routes/index.tsx`（插槽迁移）
  - `src/components/FileTreeSpecsSection.tsx`（注释/呈现位）
  - UI：`tests/ui/left-boss-path.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. 左栏无 `file-tree-specs`；有 `left-explorer` + `file-tree`。
  2. 打开项目审阅可见 `supervisor-specs` / `file-tree-specs`。
  3. 点文件仍可打开编辑 Tab。
  4. 不回退 C.10e/C.10c/C.9a；不改鉴权。
  5. 四件套全绿。
* **FAIL**：资产仍在左栏主路径；审阅页无资产；取消文件树能力。


<a id="task-c.10g"></a>

#### 【Task C.10g】文件树展开/折叠（默认只展开第一层）`[COMPLETED · 2026-10-24]`
* **任务编号**：`TASK-C.10g`
* **前置依赖**：`TASK-C.10f` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main，tip `a3fa7c7`；合后四件套 **1281 passed / 6 skipped**。交付：`src/lib/file-tree-expand.ts`；`FileTree` 点目录展开/折叠；默认根下第一层展开、更深收起；点文件仍 `onOpen`）
* **对照痛点**：资源管理器文件树整棵摊开、文件夹无法折叠，老板看不清结构。
* **v0.1 范围（施工合同）**：
  1. **交互**：点文件夹展开/折叠（`aria-expanded`）；有可见展开指示。
  2. **默认**：只展开根下第一层目录；更深目录默认收起。
  3. **保留**：点文件仍打开中栏编辑；换项目/重拉树时按默认重置展开态。
  4. **纪律**：与 C.10f 纯文件树一致；不改鉴权；不抢 D.1e。
* **明确不包含**：虚拟滚动/懒加载远端；Git 状态着色；搜索面板；改鉴权。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/FileTree.tsx`
  - `src/lib/file-tree-expand.ts`
  - 单元：`tests/lib/file-tree-expand.test.ts`
  - UI：`tests/ui/file-tree-expand.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. 默认可见根下第一层内容；更深文件默认不可见。
  2. 点文件夹可展开再折叠。
  3. 点文件仍触发打开。
  4. 不回退 C.10f/C.10e；不改鉴权。
  5. 四件套全绿；不打印 token。
* **FAIL**：仍整棵摊开无法折叠；默认展开全部深层；文件打不开。


<a id="task-c.10h"></a>

#### 【Task C.10h】文件树右键删除（确认 / P.1 / 尽量废纸篓）`[COMPLETED]`
* **任务编号**：`TASK-C.10h`
* **前置依赖**：`TASK-C.10g` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `008fd3a`；热修 tip `be4968b` 确认框可点；分支 `feat/task-c10h-file-tree-delete` 快进；四件套 1292 passed / 6 skipped；Tina 授权 t657u）
* **对照痛点**：资源管理器只能看/开文件，不能像 Cursor 一样右键删除；老板需要确认后安全删除。
* **v0.1 范围（施工合同）**：
  1. **交互**：文件/文件夹右键菜单「移到废纸篓… / 删除…」→ 确认对话框 → 再执行。
  2. **门禁**：`POST /api/repo/delete` **必须鉴权**；路径安全；P.1 保护清单命中 → 拒绝 + 白话（不绕过）。
  3. **删除方式**：macOS 尽量废纸篓（`/usr/bin/trash` / Finder）；做不到则仅普通文件永久删除并诚实文案；目录在无废纸篓时拒绝。
  4. **刷新**：删除成功后刷新资源管理器树；已打开的同路径标签关闭。
  5. **纪律**：不改鉴权语义；不抢 D.1e；不绕过 P.1；不打印 token。
* **明确不包含**：批量多选删除；Git 撤销面板；改保护清单规则本身；D.1e 系统选夹。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `daemon/editor/repo-delete.ts` + `daemon/server.ts`（`POST /api/repo/delete`）
  - `src/lib/daemon-api.ts` / `src/lib/file-tree-delete.ts`
  - `src/components/FileTree.tsx` / `WorkspaceLayout.tsx` / `src/routes/index.tsx`
  - 单元：`tests/unit/repo-delete.test.ts`；daemon：`tests/daemon/repo-delete-api.test.ts`；UI：`tests/ui/file-tree-delete.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. 右键可见删除项；未确认不删；确认框「确认删除」可点（菜单关闭后延后打开）。
  2. 无 token → 401；保护清单命中 → 403 白话且文件仍在。
  3. 成功删除后树刷新；文案诚实区分废纸篓 / 永久删除。
  4. 不回退 C.10g/f/e；不改鉴权。
  5. 四件套全绿；不打印 token。
* **FAIL**：无确认直接删；绕过鉴权或保护清单；把目录静默永久删掉且不说明。



---

<a id="task-c.10i"></a>

#### 【Task C.10i】文件树第一批（折叠整树 / 新建 / Finder·复制·重命名·删除）`[COMPLETED]`
* **任务编号**：`TASK-C.10i`
* **前置依赖**：`TASK-C.10h` (COMPLETED)
* **任务状态**：**[COMPLETED]**（tip `5388f9c`；四件套绿 · **1305 passed / 6 skipped**）
* **目标**：资源管理器达到老板够用的 Cursor 式第一批文件操作，不一次复刻整张右键菜单。
* **范围**：
  1. **顶栏**：点击项目路径折叠整棵文件树；右侧提供新建文件 / 新建文件夹。
  2. **右键（本批）**：在 Finder 中显示、复制路径、重命名、删除（沿用 C.10h）。
  3. **后端**：`POST /api/repo/create`、`/api/repo/rename`、`/api/repo/reveal`（鉴权）；写操作过 P.1 保护清单白话拒绝。
  4. **明确不包含（v0.2+ 锚定）**：加进 Chat、在集成终端中打开、选择以进行比较、打开时间线、在浏览器中打开、将文件夹添加到工作区等——见 `v0.2-multi-agent-pipeline.md` 附录锚点；**不实施**、不推翻现架构。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **主要改动**：
  - `daemon/editor/repo-fs-ops.ts` + `daemon/server.ts` 路由
  - `src/components/FileTree.tsx` / `WorkspaceLayout.tsx` / `src/routes/index.tsx`
  - `src/lib/file-tree-ops.ts` / `file-tree-expand.ts`（collapseAll）
* **验收**：
  1. 点顶栏路径后子节点收起；新建/重命名/删除后树刷新。
  2. 保护清单命中白话拒绝；系统路径（.git/.stagent）不可改。
  3. 四件套绿；不回退 C.10h/g/f/e；不改鉴权。


<a id="task-c.10j"></a>

#### 【Task C.10j】中栏 Markdown 预览阅读（默认预览 / 可切源码）`[COMPLETED]`
* **任务编号**：`TASK-C.10j`
* **前置依赖**：`TASK-C.10i` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `836ad6e`；Tina 授权 t666u；四件套 **1311 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）
* **对照痛点**：打开 `.md` 只见 Monaco 源码，缺少 Cursor 式好看阅读（标题/引用/代码高亮）。
* **v0.1 范围（施工合同）**：
  1. **默认**：打开 `.md` / `.markdown` / `.mdx` 进入好看预览（标题层级、引用、GFM 表格/列表、围栏代码高亮）。
  2. **切换**：顶栏「预览 | 源码」；源码仍走 Monaco，保存门禁不变（C.3 / P.1）。
  3. **非 Markdown**：行为与 C.3 一致，不出现切换控件。
  4. **纪律**：对齐 Cursor 阅读感；**不做**完整 VS Code（分栏预览、完整面包屑、插件生态等）；不改鉴权；不抢 D.1e；不打印 token。
* **明确不包含**：Markdown 分栏同步预览；完整路径面包屑导航条；WYSIWYG 所见即所得编辑；扩展语言包/主题市场。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/lib/markdown-file.ts`
  - `src/components/editor/MarkdownPreview.tsx`
  - `src/components/MonacoEditorPane.tsx` / `src/styles.css`
  - 单元：`tests/unit/markdown-file.test.ts`；UI：`tests/ui/markdown-preview-pane.test.tsx`（并回归 `monaco-editor-pane.test.tsx`）
* **Pass/Fail 验收判定**（≤5）：
  1. `.md` 默认可见预览标题/引用；无 Monaco。
  2. 点「源码」出现 Monaco；再点「预览」回到阅读。
  3. 非 `.md` 无切换控件。
  4. 不回退 C.10i/h；不改鉴权与保存门禁。
  5. 四件套全绿；不打印 token。
* **FAIL**：`.md` 仍只能看源码；预览无标题/引用样式；切换破坏保存门禁。



<a id="task-c.10k"></a>

#### 【Task C.10k】右栏只留双方对话（去工程师噪声；Cursor 右栏进 v0.2）`[COMPLETED]`
* **任务编号**：`TASK-C.10k`
* **前置依赖**：`TASK-C.10j` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `0da870c`；Tina 授权 t669u；四件套 **1313 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）
* **对照痛点**：右栏堆适配器/历史会话/元信息/说明书/工具 JSON，不像「跟助手说话」；Cursor 右栏整页复刻会抢戏。
* **v0.1 范围（施工合同）**：
  1. **主视线**：只保留用户 ↔ 助手对话记录（含旅程系统卡）；输入框 + 发送/停止。
  2. **删除/隐藏**：AI 助手适配器下拉、新会话/历史会话、`chat-session-meta`、当前对话使用行、空闲说明书条、工具调用 JSON 卡片。
  3. **保留门禁提示**：缺钥匙向导、练习沙箱短提示、进行中短状态、未连接一键重开（不打印 token）。
  4. **自动会话**：无工程师「新会话」时，用首选助手自动开会话。
  5. **v0.2 锚定**：Cursor 右侧对话对齐能力写入 `v0.2-multi-agent-pipeline.md` 附录 B（**不实施整页复刻**）。
  6. **纪律**：不改鉴权；不抢 D.1e；不推翻一个指挥官。
* **明确不包含**：@ 上下文、/ skills、多模型切换 UI、语音、Review Keep/Undo 条、聊天内嵌浏览器/终端等（见附录 B）。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/AgentChatPane.tsx`
  - UI：`tests/ui/agent-chat-pane.test.tsx`（并回归 `assistant-mode.test.tsx`）
  - 文档：任务卡 / 见 Git 历史（原走查报告 §6.20） / v0.2 RFC 附录 B
* **Pass/Fail 验收判定**（≤5）：
  1. 连接后右栏不可见「AI 助手：」/「选择 Agent」/「历史会话」/会话元信息。
  2. 用户与助手消息可见；工具 JSON 卡片不可见。
  3. `journey-entry-hint` 主 CTA 锚点仍在（可 sr-only）；向导/练习门禁仍可用。
  4. Cursor 右栏项仅在 v0.2 附录 B，无整页复刻代码。
  5. 四件套全绿；不打印 token。
* **FAIL**：右栏仍堆工程师控件；或借机整页复刻 Cursor；或破坏鉴权/指挥面。



<a id="task-c.10l"></a>

#### 【Task C.10l】设置「高级」可选会话/适配器（不回潮右栏）`[COMPLETED]`
* **任务编号**：`TASK-C.10l`
* **前置依赖**：`TASK-C.10k` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `d407b5c`；Tina 授权 t671u；四件套 **1316 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）
* **对照痛点**：C.10k 从右栏去掉适配器/新会话/历史后，工程师偶发仍需换助手或切历史；不宜塞回右栏主视线，也不宜塞进老板设置主路径。
* **v0.1 范围（施工合同）**：
  1. **位置**：设置页「高级」（`settings-advanced`）内新增「对话助手」区（`settings-chat-session`）。
  2. **控件**：助手（适配器）下拉、新会话、历史会话下拉——语义对齐 C.10k 移除前右栏能力。
  3. **共享状态**：Console 上提 `useAgentSession`，注入右栏与设置，保证换会话两边一致。
  4. **右栏纪律**：保持 C.10k——主视线只留双方对话；不回潮工程师控件。
  5. **仍不展示**：会话元信息（adapter id / 原生会话 / 首字耗时）、工具调用 JSON——不进设置、不进右栏。
  6. **纪律**：不改鉴权；不抢 D.1e；不打印 token。
* **明确不包含**：把说明书条/工具 JSON/会话元信息塞进设置；右栏恢复适配器条；整页复刻 Cursor 右栏。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/settings/SettingsTab.tsx`
  - `src/components/AgentChatPane.tsx`（可选 `session` 注入）
  - `src/routes/index.tsx`（上提共享会话）
  - UI：`tests/ui/settings-tab.test.tsx`（并回归 `agent-chat-pane.test.tsx`）
* **Pass/Fail 验收判定**（≤5）：
  1. 设置高级展开可见「对话助手」；模型钥匙主视线无适配器/历史控件。
  2. 右栏仍不可见「选择 Agent」/「历史会话」/「新会话」按钮。
  3. 高级内点「新会话」会创建并切到新会话（与右栏同实例）。
  4. 未注入时高级不出现对话助手区（单测 Settings 独立渲染）。
  5. 四件套全绿；不打印 token。
* **FAIL**：控件回潮右栏；或高级与右栏各管一份会话不同步；或改鉴权。


<a id="task-c.10m"></a>

#### 【Task C.10m】质疑自查裁决按钮接线（缺陷修复 / 新需求演进）`[COMPLETED]`
* **任务编号**：`TASK-C.10m`
* **前置依赖**：`TASK-C.10l` (COMPLETED)；工作区恢复干净 tip `8dd039d`
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `0d65890`；Tina 授权 t673u；四件套 **1319 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）
* **对照痛点**：非 IDE 走查发现质疑自查「按缺陷修复 / 按新需求演进」可点但无反应（空接线）；脏工作区有误回退风险，须先恢复 tip 再改。
* **v0.1 范围（施工合同）**：
  1. **恢复**：`/Users/tina/Desktop/1020` reset 到干净 tip（C.10l / `8dd039d`），丢弃误回退脏区。
  2. **UI**：`DisputeConsolePane` 暴露 `onChooseBugFix` / `onChooseRequirementChange`；降级或 UNATTRIBUTED 时两按钮可点。
  3. **接线**：`index.tsx` 把按钮接到 `runDisputeSelfCheckUi(challenge, user_choice)`；`BUG_FIX` / `REQUIREMENT_CHANGE`。
  4. **API/引擎**：`submitDisputeSelfCheck` 传 `user_choice`；Daemon 校验；`outcomeFromUserChoice` 强制分类与 next_action。
  5. **产品反馈**：选择后旅程卡白话确认；需求演进切合同视口并打开表单。
  6. **纪律**：不改鉴权；不抢 D.1e；不打印 token。
* **明确不包含**：重做整套质疑引擎；自动改代码不经审阅；Cursor 整页右栏复刻。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/studio/DisputeConsolePane.tsx`
  - `src/routes/index.tsx`
  - `src/lib/daemon-api.ts`
  - `daemon/server.ts` / `daemon/supervisor/dispute/*`
  - UI：`tests/ui/studio-viewport-switching.test.tsx`；单测：`tests/unit/dispute-triad.test.ts`
* **Pass/Fail 验收判定**（≤5）：
  1. 降级报告下两按钮可点且回调触发（Harness UI 测）。
  2. `user_choice=BUG_FIX` → IMPLEMENTATION_BUG + REWORK；`REQUIREMENT_CHANGE` → 需求演进路径。
  3. 非法 `user_choice` 被 Daemon 拒绝。
  4. 工作区恢复 hash 为 `8dd039d`（或文档记载的干净 tip）。
  5. 四件套全绿；不打印 token。
* **FAIL**：按钮仍空接线；或借机改鉴权/绕过保护清单。


<a id="task-c.10n"></a>

#### 【Task C.10n】任务图谱空态可感知（禁用无效切换 / 刷新反馈 / 建图 CTA）`[COMPLETED]`
* **任务编号**：`TASK-C.10n`
* **前置依赖**：`TASK-C.10m` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `bcad27f`；Tina 授权 t675u「立卡开做」；四件套 **1322 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。**热修** tip `3e9bb22`：建图 CTA 错误回显图谱顶栏；Tina t676u；四件套 **1323 passed / 6 skipped**）
* **对照痛点**：非 IDE 走查点「任务图谱」顶栏「业务功能导图 / 执行拓扑 / 刷新」像没反应；根因是当前合同无图时正文永远空态，切视图画面不变。
* **v0.1 范围（施工合同）**：
  1. **无图**：禁用（或等效不可用）「业务功能导图 / 执行拓扑」；刷新按钮可见 loading（「刷新中…」/ aria-busy）。
  2. **空态文案**：白话「当前合同还没有图」+ 说明须先确认原型；CTA「确认原型并建图」接到既有 `handleConfirmPrototype` 主路径。
  3. **有图**：顶栏一句只读预期「这里只看进度…不会开工」；选中执行拓扑节点后高亮，并滚到 NodeDetail。
  4. **纪律**：不改鉴权；不接 start/verify；不抢 D.1e；不改架构大方向。
* **明确不包含**：节点开工/验证接线；重做点亮引擎；拆多路由。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - `src/components/graph/TaskGraphPanel.tsx`
  - `src/components/graph/ExecutionDag.tsx`
  - `src/components/studio/TaskGraphPane.tsx`
  - `src/routes/index.tsx`
  - UI：`tests/ui/task-graph-illumination.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. 无图时视图切换按钮 disabled，点击不改变空态。
  2. loading 时刷新按钮文案/aria-busy 可见；空态非 loading 显示「当前合同还没有图」与 CTA（有回调时）。
  3. 有图时只读提示存在；点 DAG 节点出现详情且 `data-selected=true`。
  4. 四件套全绿；不打印 token。
  5. 不引入 start/verify 接线。
* **FAIL**：无图切视图仍「像没反应」且无任何反馈；或借机改鉴权/接开工。

<a id="task-c.10o"></a>

#### 【Task C.10o】任务图谱开工/核销入口（接 start/verify）`[COMPLETED]`
* **任务编号**：`TASK-C.10o`
* **前置依赖**：`TASK-C.10n` (COMPLETED)、`TASK-C.7` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `830fca1`；Tina 授权 t680u「立卡接开工/核销入口」；四件套 **1331 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）
* **对照痛点**：图谱已是只读看板（C.10n）；Daemon 已有 `POST /api/graph/nodes/start` 与 `POST /api/graph/verify`（C.7），UI 未接。老板看见「排队中」无法感知地往前推。
* **v0.1 范围（施工合同）**：
  1. **开工**：有图时顶栏「开工下一节点」（按依赖取下一 PENDING 且前置已点亮）；详情对可开工节点提供「开工此节点」。回调 `startTaskGraphNode` → Daemon `startNode`。
  2. **核销**：顶栏「核销点亮」优先选中可核销节点，否则取第一个 RUNNING/REPAIRING/STALE_REVERIFY；详情亦可核销。回调 `verifyTaskGraphNode`；COMMAND 按声明别名提交 exit 0；写入/Scope/HEAD 仍由 Daemon 现算。
  3. **反馈**：忙态「开工中…/核销中…」；失败/未点亮黄条 `graph-error`；有动作时提示文案改为可开工说明（不再写死「不会开工」）。
  4. **纪律**：点亮只认物理证据（不假绿）；不改鉴权；不抢 D.1e；架构仅 §11 注记 9 轻量锚定。
* **明确不包含**：自动 Worker 全图施工；伪造退出码绕过物理证据；重做点亮引擎；改鉴权大方向。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - 新增：`src/lib/graph/startable.ts`
  - 修改：`src/components/graph/TaskGraphPanel.tsx`、`src/components/studio/TaskGraphPane.tsx`、`src/routes/index.tsx`
  - 测试：`tests/unit/graph-startable.test.ts`、`tests/ui/task-graph-illumination.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. 有图且存在可开工节点时「开工下一节点」可点，回调正确 node_id；无前置点亮时下游禁用。
  2. RUNNING（等）时可「核销点亮」；未点亮时黄条可见且 graph 仍更新。
  3. 无 onStart/onVerify 回调时仍保持 C.10n 只读提示（兼容）。
  4. 四件套全绿；不打印 token。
  5. 不引入假绿路径；不改鉴权。
* **FAIL**：点开工无请求/无状态变化且无任何反馈；或借机改鉴权/伪造证据点亮。

<a id="task-c.10p"></a>

#### 【Task C.10p】图谱开工/核销自动确保任务 Worktree `[COMPLETED]`
* **任务编号**：`TASK-C.10p`
* **前置依赖**：`TASK-C.10o` (COMPLETED)、`TASK-A.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `35b56c9`；Tina 报错 t681u「任务 Worktree 不存在」隐含授权修复；四件套 **1335 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）
* **对照痛点**：C.10o 接上 start/verify 后，历史已 MERGED 合同的图仍可点核销，但批准时创建的 Worktree 合入后已清理；`collectWorktreeEvidence` 直接 409，老板看到黄条「任务 Worktree 不存在：…/task-contract_…」。
* **根因（代码事实）**：Worktree 由 `orchestrator.approve` / `healResume` 创建；`/api/graph/nodes/start` 只改图态、不建树；`/api/graph/verify` 要求树已在盘。合入清理后图与树脱节。
* **v0.1 范围（施工合同）**：
  1. 新增 `ensureTaskWorktree` + `resolveExistingBaseBranch`（`daemon/git/worktree-manager.ts`）。
  2. `POST /api/graph/nodes/start` 与 `POST /api/graph/verify` 在改态/采证前调用确保；缺失则重建。
  3. 基线优先合同 `authorization.git.base_branch`，不存在则回退 `main`/`master`/`HEAD`。
  4. 主工作区脏：`acknowledgeDirty: true`（脏文件本就不进任务树，图谱不得因此卡死）。
  5. 纪律：不假绿；点亮仍只认物理证据；不改鉴权；不抢 D.1e。
* **明确不包含**：自动替 Worker 写业务文件；伪造证据点亮；改合同生命周期机；重做 A.1。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（预期）**：
  - 修改：`daemon/git/worktree-manager.ts`、`daemon/server.ts`
  - 测试：`tests/daemon/worktree-manager.test.ts`（ensure 用例）
* **Pass/Fail 验收判定**（≤5）：
  1. 人为删掉 `task-{contractId}` 后，start 能重建并 PENDING→RUNNING。
  2. 同上条件下 verify 不再报「Worktree 不存在」（缺写入仍可未点亮黄条，不假绿）。
  3. 合同 base_branch 已删除时仍能回退 main/HEAD 建树。
  4. 主区有未提交文件时 ensure 不抛脏确认阻断。
  5. 四件套全绿；不打印 token。
* **FAIL**：核销仍只抛「Worktree 不存在」且无重建；或借机假绿/改鉴权。


<a id="task-c.10q"></a>

#### 【Task C.10q】Studio 全景/施工双视角壳 + 改名消歧义
* **任务编号**：`TASK-C.10q`
* **前置依赖**：`TASK-C.10p` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-24 合入 main tip `4280de6`；Tina 授权 t684u「都放进方案，然后 v0.1 先立双视角壳」；四件套 **1342 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）
* **对照痛点**：非专业用户需要「能干嘛 / 怎么用 / 管什么 / 这轮改哪」四张透视卡；现有「业务功能导图」易与进门全仓脑图撞名；确认原型前中栏只有施工空态。
* **v0.1 范围（施工合同）**：
  1. Studio 中栏「全景 / 施工」双视角切换壳（`StudioLensShell`）；两视角 `hidden` 保活。
  2. 未确认原型（无图）：默认全景；极薄摘要读合同 intent / requirements 提示；诚实空态；三张真全景图仅占位标 v0.2。
  3. 确认原型建图后：自动（无→有）切到施工 = 既有 `TaskGraphPanel`（空态/开工/核销不变）。
  4. 改名消歧义：施工侧「业务功能导图」→「本轮施工·功能汇总」；全景侧「项目功能清单」。
  5. **禁止**全景展示施工绿灯；**不改** illumination / start / verify / C.10o / C.10p。
  6. 方案文档写入四卡体系；三张真全景图记入 v0.2 RFC 附录 C（本卡不实现）。
* **明确不包含**：进门自动业务脑图、用户旅程泳道、业务概念图的真实生成；假绿；改鉴权；抢 D.1e。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件**：
  - 新增：`src/lib/studio/lens-routing.ts`、`src/components/studio/StudioLensShell.tsx`、`src/components/studio/PanoramaPane.tsx`
  - 修改：`src/components/studio/TaskGraphPane.tsx`、`src/components/graph/TaskGraphPanel.tsx`、`src/components/graph/FunctionalTree.tsx`、`src/routes/index.tsx`
  - 文档：见 Git 历史（原 `docs/archive/task-graph-and-panorama-design.md`） §9；`docs/rfc/v0.2-multi-agent-pipeline.md` 附录 C；走查 §6.26
  - 测试：`tests/unit/studio-lens-routing.test.ts`、`tests/ui/studio-lens-shell.test.tsx`
* **Pass/Fail 验收判定**（≤5）：
  1. 无图时 Studio 图谱视口默认「全景」；可见项目功能清单/占位，无 functional-tree 绿灯。
  2. 有图或刚建图后默认「施工」；可见「本轮施工·功能汇总」按钮文案。
  3. 手动全景↔施工可切换；面板 hidden 保活。
  4. 四件套全绿；不打印 token。
  5. 规范/RFC 已写明 v0.2 三卡不实施。
* **FAIL**：全景出现施工点亮态；或顺手改了 start/verify/illumination；或把 v0.2 三卡当成本卡交付。


<a id="task-c.11a"></a>

#### 【Task C.11a】右栏白话推荐选择题（≤2 轮收敛）`[COMPLETED]`
* **任务编号**：`TASK-C.11a`
* **前置依赖**：`TASK-C.10q` (COMPLETED)、`TASK-C.10k` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 过夜合入；立卡+授权 t747u/t748u；见 BRIEF-C11）
* **对照痛点**：Supervisor 定妆照第 1 步——用户说话后应看到带推荐的白话选择题，而不是开放式技术追问；澄清无轮次上限。
* **v0.1 范围（施工合同）**：
  1. 右栏可渲染选择题卡片：每题唯一「推荐」徽标 + 一行通俗理由；选项点击即回填。
  2. 主动澄清轮次硬顶 **≤2**；未决细项用安全默认写入后续合同草案字段（可一键确认）。
  3. 禁止开放式技术填空卷；与 C.10k 右栏只留双方对话纪律兼容（卡片算对话内容）。
  4. 对齐 Top7#4、《Supervisor运转机制》§2.1。
* **明确不包含**：完整 LLM Supervisor 大脑重写；Impact AST；改鉴权；抢 D.1e；升格澄清讨论稿全文。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（实现时锚定，可微调）**：
  - 右栏对话消息渲染 / journey 分流相关组件与 hooks
  - 可选：`POST /api/supervisor/journey` 扩展选择题载荷
  - 测试：UI 渲染推荐徽标 + 轮次上限单元/UI
* **Pass/Fail 验收判定**（≤5）：
  1. 演示路径可见带「推荐」徽标的选择题卡。
  2. 第 3 轮主动澄清被拒绝或自动收束为默认项（可测）。
  3. 四件套绿；不打印 token。
  4. 不回退 C.10k 右栏主视线纪律。
* **FAIL**：出现无推荐的开放技术问卷；或轮次无上限；或改鉴权。

<a id="task-c.11b"></a>

#### 【Task C.11b】隔离 Demo 预览挂载与感官确认 `[COMPLETED]`
* **任务编号**：`TASK-C.11b`
* **前置依赖**：`TASK-C.11a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 过夜合入）
* **对照痛点**：定妆照第 2 步——先玩玩具再写真码；Demo 须可复看且不脏主干。
* **v0.1 范围**：
  1. Demo 资产目录 `.stagent/prototypes/<prototype_id>/`；根 `.gitignore` 忽略该树（或等价忽略规则）。
  2. 独立预览（iframe / 既有 Origin 预览通道均可，须可点试玩）。
  3. 「感官对齐 / 确认 Demo」按钮；未确认不得进入写真码路径（门禁可与 C.11c 衔接）。
  4. 对齐 Top7#1；拒约/轻改默认保留 Demo（资产治理）。
* **明确不包含**：把 Demo 合入用户 package.json/主干；完整多租户沙盒产品化；假绿。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 确认后磁盘可见 prototypes 目录且不被 git 跟踪进主干。
  2. 预览可打开；确认按钮可点并留下状态。
  3. 未确认时写主干被拒（或 UI 阻断）——与 C.11c 联调可接受。
  4. 四件套绿。
* **FAIL**：Demo 进主干；或无确认仍可开工写真码。

<a id="task-c.11c"></a>

#### 【Task C.11c】白话合同卡片与签署拦截 `[COMPLETED]`
* **任务编号**：`TASK-C.11c`
* **前置依赖**：`TASK-C.11b`
* **任务状态**：**[COMPLETED]**（2026-10-26 过夜合入）
* **对照痛点**：定妆照第 3 步——一张白话卡说清要干什么/能改哪/怎么验；签前主干零写入。
* **v0.1 范围**：
  1. 白话合同卡：意图、Scope 摘要、验收要点；一键授权/拒绝/改细节。
  2. **签署前**对项目主干 `writable` 物理零写入（Gateway/Daemon 门禁；只读与 prototypes 除外）。
  3. 签署后签发短命执行凭证（Top7#2：轻量 Token + IPC 校验——本卡至少接线护照生命周期；IPC 深度可与既有 Gateway 对齐，缺口登记但不假称 JWT 离线唯一方案）。
  4. 拒约默认留 Demo；草案版本 `vN-draft` 递增。
* **明确不包含**：整份 API 清单升格；完整 Impact AST；改 D.1 loopback+#token 模型。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 未签署时尝试写主干失败或 UI 不可达写真码。
  2. 签署后合同态推进可观测；护照/token 短命可吊销或过期（至少一种可测）。
  3. 拒绝后 Demo 仍可打开。
  4. 四件套绿。
* **FAIL**：未签署已改主干；或口头改约无重签。

<a id="task-c.11d"></a>

#### 【Task C.11d】施工图 Evidence 点亮 + 越界挂起弹窗 `[COMPLETED]`
* **任务编号**：`TASK-C.11d`
* **前置依赖**：`TASK-C.11c`、`TASK-C.10o` (COMPLETED)、`TASK-C.10p` (COMPLETED)、`TASK-C.10q` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 过夜合入）
* **对照痛点**：定妆照第 4 步——灯是证据亮的；越界要敲门问人。
* **v0.1 范围**：
  1. 图谱节点点亮必须绑定真实 Evidence / verify 路径（延续 C.10o 不假绿）。
  2. `E_OUT_OF_SCOPE` / 保护否决：阻断当次 IO + 任务 `PAUSED` + 前端「扩权 / 回滚」挂起弹窗（Top7#3）。
  3. 禁止静默放行；禁止默认 `kill -9` 整树（用户显式终止除外）。
* **明确不包含**：重做 illumination 算法；全量 AST Impact；D.1e。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 无证据不能点亮（回归）。
  2. 模拟越界出现挂起弹窗且任务暂停。
  3. 四件套绿。
* **FAIL**：假绿；或越界静默；或默认杀进程。

<a id="task-c.11e"></a>

#### 【Task C.11e】真机对照验收与质疑自查回灰 `[COMPLETED]`
* **任务编号**：`TASK-C.11e`
* **前置依赖**：`TASK-C.11d`、`TASK-C.10m` (COMPLETED)、`TASK-S.6b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 过夜合入）
* **对照痛点**：定妆照第 5 步——真页对照 Demo；质疑先自查图纸不是重写需求。
* **v0.1 范围**：
  1. 验收视图可同时感知 Demo 参照与真机预览（复用 S.6b 真机试玩通道）。
  2. 「质疑」触发 Supervisor S.5 风格自查（接线强化 C.10m）；失败则相关图谱节点回灰待重做。
  3. 成功核销才保持点亮；对齐核心资产治理 Evidence 作废规则。
* **明确不包含**：完整红队模型产品化；改鉴权。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 质疑后可见自查结果或明确进行中态。
  2. 自查失败节点回灰（可测 fixture）。
  3. 四件套绿。
* **FAIL**：质疑无响应；或失败仍假绿。




<a id="task-c.12a"></a>

#### 【Task C.12a】双层执行令牌（exec_token + resume_token/jti）`[COMPLETED]`
* **任务编号**：`TASK-C.12a`
* **前置依赖**：`TASK-C.11c` (COMPLETED)、`TASK-C.11e` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 合入；main tip `12b14b1`；Tina t819u 全部一起实现；专用单测 `tests/unit/task-c12-top5-delta.test.ts`）
* **对照痛点 / Spec 锚点**：封版记录 §2.4 / §3 Top5#1；澄清 §6.1；Checklist §3；右栏 **EO-07**。现网仅单层 `session-token` + 同进程拦写；多进程/暂停恢复缺精细凭证。
* **v0.1 范围（施工合同 · Delta，不推翻骨架）**：
  1. **保留**外部 `session-token` 鉴权与 D.1 loopback+#token 通道原则。
  2. 签署后内部施工通道签发 **`exec_token`**：至少绑定 `contract_id`、worktree 路径、可写 Scope 摘要；Gateway/Daemon 写路径校验必须验此令牌。
  3. 进入 **`PAUSED`**（越界/中断/用户挂起）时 **硬吊销**当前 `exec_token`；旧令牌一律拒绝。
  4. 恢复施工时下发**一次性** **`resume_token`**，必须带 **`jti`**（用过即废）；校验失败不得恢复写权。
  5. 字段级目标对齐澄清 §6.1 / Checklist 附录 Schema 草稿（内存级轻量 Token + IPC 即可；**不强制** JWT/gRPC）。
* **明确不包含**：改 D.1 鉴权模型；抢 D.1e；整份讨论稿升格改架构规范正文；Mode 0–4 / 容器沙盒。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（实现时锚定，可微调）**：
  - Daemon 签署/暂停/恢复路径；Gateway 写拦截校验
  - Token 签发/吊销/jti 存储（进程内或本地侧车均可，须可测）
  - 单测：签发→PAUSED 拒旧 token→resume 一次性 jti
* **Pass/Fail 验收判定**（≤5）：
  1. 签署后无 `exec_token` 时写 worktree 被拒。
  2. `PAUSED` 后旧 `exec_token` 写请求失败。
  3. 合法 `resume_token`+未用 `jti` 可恢复；同一 `jti` 第二次失败。
  4. 外部 session 通道回归不破；四件套绿；不打印 token 明文到日志。
* **FAIL**：仅改 UI 文案无真实吊销；或默默沿用 session 当施工写权；或改 D.1 通道。

<a id="task-c.12b"></a>

#### 【Task C.12b】状态广播 epoch/seq + EO-01 DeliveryState `[COMPLETED]`
* **任务编号**：`TASK-C.12b`
* **前置依赖**：`TASK-C.12a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 合入；main tip `12b14b1`；与 C.12a–e 同批）
* **对照痛点 / Spec 锚点**：封版 §2.1 / §3 Top5#2；澄清 §6；右栏 **EO-01**。现网粗粒度全量 STATE 回放，缺序列 → 重连乱序/倒流。
* **v0.1 范围**：
  1. 在现有 STATE / `STATE_CHANGED` 通道上叠 **`session_epoch`**（会话世代）与单调递增 **`state_seq`**。
  2. 广播载荷主交付态严格映射 EO-01 **`DeliveryState`** 强类型枚举（含 `PLAN_*`、Demo 三态 READY、`CONTRACT_SIGNED`、`IMPLEMENTING`/`PAUSED`、`CANDIDATE_VERIFIED`→`MERGED`→`DELIVERED` 等）。
  3. **轨 C 瞬态**：Demo 确认后、`CONTRACT_SIGNED` 前允许 **`CONTRACT_SIGNING`**（白话合同卡渲染/解锁）；不得与轨 A 揉成假主态。
  4. 客户端按 `(epoch, seq)` **去重、拒倒流**；epoch 递增时允许重置 seq。
  5. 资产轨 `DocumentAssetStatus`（DocGov）**不得**冒充 DeliveryState 广播。
* **明确不包含**：重做整套前端状态管理；Impact AST；云端多端同步。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 连续两次 STATE 的 `state_seq` 递增可观测。
  2. 注入更小 seq（同 epoch）被客户端忽略。
  3. 广播中可见 EO-01 枚举值（非笼统 VERIFIED/FROZEN 冒充）。
  4. `CONTRACT_SIGNING` 仅作签署前瞬态可测；四件套绿。
* **FAIL**：仍仅全量无序回放；或资产 FROZEN 当已开工主态。

<a id="task-c.12c"></a>

#### 【Task C.12c】越界原子拦截（SIGINT 3s → SIGKILL → 吊销 → 清锁）`[COMPLETED]`
* **任务编号**：`TASK-C.12c`
* **前置依赖**：`TASK-C.12a` (COMPLETED)、`TASK-C.11d` (COMPLETED)、`TASK-C.12b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 合入；main tip `12b14b1`；与 C.12a–e 同批；软停路径可测钩子）
* **对照痛点 / Spec 锚点**：封版 §2.4 / Top5#3；澄清 §6；**EO-02 / EO-07**。现网有抛错+PAUSED 弹窗，缺进程/锁原子收尾 → 僵尸写。
* **v0.1 范围**：
  1. 保留 C.11d「扩权/回滚」弹窗体感；**补齐弹窗背后**的原子序列。
  2. 触发越界 / 强制中断：先 **阻断当次 IO**，再对施工子进程发 **`SIGINT`，软停等待 3 秒**释锁。
  3. 超时未退出 → **`SIGKILL`**；然后 **吊销 `exec_token`**；清理 **`.git/index.lock`**（及本 worktree 等价锁）；任务进入 **`PAUSED`** 问人。
  4. **禁止静默放行**；**禁止**把「默认立刻 kill -9 整树」当唯一路径（用户显式终止除外）。
  5. Worker 物理范围仍只认 `.stagent/worktrees/{contract_id}/`（本卡不实现容器 Mode）。
* **明确不包含**：容器级沙盒 Mode 0–4；重做 illumination；默认杀整个 Daemon。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 模拟越界可观测：软停窗口内进程收到 SIGINT（或等价可测钩子）。
  2. 超时路径执行 SIGKILL + token 吊销 + 锁文件清除（fixture）。
  3. UI 仍出现 PAUSED 弹窗；无静默继续写。
  4. 四件套绿。
* **FAIL**：只弹窗不吊销/不清锁；或默认无软停直接杀树；或静默放行。

<a id="task-c.12d"></a>

#### 【Task C.12d】Demo 三态门禁 + can_sign + records 轻量拷贝 `[COMPLETED]`
* **任务编号**：`TASK-C.12d`
* **前置依赖**：`TASK-C.11b` (COMPLETED)、`TASK-C.11c` (COMPLETED)、`TASK-C.12b` (COMPLETED)、`TASK-C.12c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 合入；main tip `12b14b1`；与 C.12a–e 同批）
* **对照痛点 / Spec 锚点**：封版 §2.1/§2.4 / Top5#4；**EO-05 / EO-06**。现网 prototypes + 布尔确认；缺三态与 `can_sign`，流程卡可偷渡。
* **v0.1 范围**：
  1. 确认事件升级为 **`demo_mode` 三态**：`INTERACTIVE_DEMO` / `NATIVE_FLOW_CARD` / `DEGRADED_FLOW_CARD`（或主干 `DEMO_READY` + `demo_mode` 字段）。
  2. 签署入库执行 **`can_sign` 硬谓词**：降级/流程卡不得冒充可交互 Demo 偷渡签署（须显式接受并带 ⚠️ 等既有约定）。
  3. **不推翻** `.stagent/prototypes/` 目录与 C.11b 预览骨架；prototypes **不进** Worker worktree 挂载。
  4. 验收合入主干（`MERGED` 路径）后，向 **`.stagent/records/{contract_id}/`** 做**轻量无依赖**拷贝（Demo 快照/必要元数据）；失败不得标 `DELIVERED`。
* **明确不包含**：完整多租户沙盒；云端 records；假绿。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 三态可写入并在 UI/状态机可读。
  2. 故意用流程卡冒充交互 Demo 时 `can_sign` 失败（可测）。
  3. 合入后 `records/{contract_id}/` 出现拷贝产物（或明确失败阻断 DELIVERED）。
  4. 四件套绿。
* **FAIL**：仍仅布尔确认可签任意类型；或 Demo 进 worktree 沙盒。

<a id="task-c.12e"></a>

#### 【Task C.12e】无 Git 审计侧车 audit-manifest `[COMPLETED]`
* **任务编号**：`TASK-C.12e`
* **前置依赖**：`TASK-C.12d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 合入；main tip `12b14b1`；与 C.12a–e 同批）
* **对照痛点 / Spec 锚点**：封版 §2.4 / Top5#5；**EO-03 / EO-04 / EO-05**。无 Git / Trailer 不可用时仍需证明交付完整性。
* **v0.1 范围**：
  1. 落地 **`.stagent/records/{contract_id}/audit-manifest.json`**。
  2. 经**脱敏管道**后落盘：关键快照哈希、审计事件哈希、合同/断言标识（UUIDv5 等既有钉桩）、关联 commit SHA（若有则记录；**无 Git 时仍须可生成清单**）。
  3. **不依赖** Git Trailer 作为唯一审计源；与 D.2 Trailer **并存**时不得互相拆台。
  4. 本地 only；云端多端同步 = **v0.2+**（封版 §4）。
* **明确不包含**：云归档；改写 Git 历史；把 manifest 当签名 CA。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 合入/归档路径生成 `audit-manifest.json` 且字段含哈希与 contract_id。
  2. 模拟无 Git 环境仍能生成清单（不抛「必须有 remote」）。
  3. 清单不含明文密钥/token；四件套绿。
* **FAIL**：仅写 Git Trailer 无侧车；或明文泄密；或阻断 v0.1 只因无 remote。


<a id="task-c.14a"></a>

#### 【Task C.14a】只读沙盒静态扫描器（基线 P0 骨架）`[COMPLETED]`
* **任务编号**：`TASK-C.14a`
* **前置依赖**：`TASK-C.12e` (COMPLETED)、`TASK-C.10q` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 合入 tip `0417203`；Tina t836u 实现+走查；只读沙盒静态扫描器 + 负例单测。**验收注**：逻辑级只读/断网意图已测；**非** OS 只读挂载——已知不挡体验缝，OK）
* **对照痛点 / Spec 锚点**：讨论稿 见 Git 历史（原 `docs/archive/baseline-archive-onboarding-design.md`）（tip `3c8411b`）文首 Tina 定案 3 + 工程补丁 1 + 原则 4 / §7.3。打开已有项目须「打开即自动深扫、零弹窗」，但不得动态执行项目脚本或触网。
* **v0.1 范围（施工合同 · Delta）**：
  1. 实现（或挂载）**基线静态扫描器**：在 **只读挂载 + 物理断网 + 约 3 秒超时熔断** 的轻量沙盒内跑；**禁止**动态执行用户项目脚本（含 Webpack/Vite 配置副作用、加载 `.env` 触发外网、CLI 插件 init）。
  2. **P0 骨架秒级**（目标 T+0~2s）：至少抽出 `package.json` / 顶层目录树 / 粗路由或模块入口线索，供后续全景亮起与右栏解锁（具体接线见 C.14b）。
  3. 扫描过程**不写入**用户业务树；允许仅写入 Stagent 侧车路径（若本卡落地侧车，须可测且不冒充施工合同）。
  4. 界面目标文案：「正在为您安全探查项目结构（纯本地只读分析，不触碰线上业务）」——**机制未证明前**不得当作已兑现硬承诺；可先诚实写「本次会读这些路径」。
  5. 敏感信息扫描须对齐 EO-04 遮蔽精神：不得把密钥/PII 明文写入可展示档案（完整脱敏管道可与 C.14b 协同，本卡至少不得明文落日志）。
* **明确不包含**：完整 Impact AST 产品化（仍 v0.2+ B.1）；云端扫描；改 D.1 鉴权；抢 D.1e；把基线状态并入正式 Delivery/Task 状态机；Spec Freeze 五文档扩写。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（实现时锚定，可微调）**：
  - Daemon 侧基线扫描入口 / 沙盒启动与熔断
  - 只读挂载与断网证明钩子（可测）
  - 单测：动态执行被拒；超时熔断；P0 骨架在时限内返回
* **Pass/Fail 验收判定**（≤5）：
  1. 带副作用的 fixture 配置在扫描中**不被执行**（可测负例）。
  2. 沙盒内出网尝试失败或被阻断（可测）。
  3. 超时触发熔断，不挂死进程；P0 骨架字段可返回。
  4. 不写入用户业务树受测路径；四件套绿。
* **FAIL**：扫描触发用户脚本/外网；或同步卡死 > 数秒无熔断；或改 D.1 / 扩 Freeze。

<a id="task-c.14b"></a>

#### 【Task C.14b】渐进扫 + 基线档案落盘 + 全景视口 `[COMPLETED]`
* **任务编号**：`TASK-C.14b`
* **前置依赖**：`TASK-C.14a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 tips `0417203`/`dd14fa0`；Tina t836u；渐进扫 + `.stagent/records/baseline/` 落盘 + 全景视口 + 确认≠授权。**验收注**：全景可见「项目现状基线档案」与「认可此基线作为后续参考」；深度进度为轮询——已知缝 OK）
* **对照痛点 / Spec 锚点**：讨论稿定案 1–2、工程补丁 2、阶段 A–E、升格备忘 3；产品名 **项目现状基线档案**；落盘 **`.stagent/records/baseline/`**（可带时间戳/commit）；**禁止** `contract_000` 伪合同命名。
* **v0.1 范围**：
  1. **两段式渐进扫描**：P0 骨架亮起后解锁右栏对话；P1/P2（依赖/语义等）后台流式加深，节点逐个亮起；深度未完**不阻塞**用户提需求。
  2. 基线档案落盘至 **`.stagent/records/baseline/`**（语义清晰；可含扫描时点、工具版本、忽略规则、未完成标记）。
  3. Studio **全景**视口呈现基线材料（尽量全：结构图 + 功能图 + 测试统计等均可）；严格遵守「观察 ≠ 质量结论」「结构存在 ≠ 保证可用」。
  4. **确认 ≠ 授权**：确认按钮文案统一为「**认可此基线作为后续参考**」；确认**不得**签发施工 `exec_token`、不得进入正式微合同签署态、不得改 Delivery 主态冒充已授权。
  5. 基线「待审阅 / 已确认」须与正式 Delivery/Task 状态机**隔离**（独立 Baseline 轨或全景资产状态；不得串台）。
* **明确不包含**：把确认写成质量验收/免责签署；三张「真全景图」产品化（仍 v0.2 RFC 附录 C）；改鉴权；整包 Spec Freeze。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 打开已有项目可见「正在整理现状」类进度，且 P0 后右栏可输入。
  2. 深度扫描未完成时右栏不空白/不抛未处理异常（与 C.14c 防抢跑协同）。
  3. 落盘路径在 `.stagent/records/baseline/` 下可观测；无 `contract_000` 目录/字段作产品主名。
  4. 点击「认可此基线作为后续参考」后档案标记已确认，但施工写权仍未授予（可测）；四件套绿。
* **FAIL**：确认即开写；或深度扫卡死右栏；或落盘用 Contract #0 / contract_000 冒充施工合同。

<a id="task-c.14c"></a>

#### 【Task C.14c】Workspace Dirty Check + 图谱白话 + Supervisor 防抢跑 `[COMPLETED]`
* **任务编号**：`TASK-C.14c`
* **前置依赖**：`TASK-C.14b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 tips `0417203`/`e01188f`；Tina t836u；Dirty Check 管家黄标 + 首张微合同排除 + 图谱两行白话 + Supervisor 防抢跑。**验收注**：脏区黄标需工作区确有未提交/未跟踪文件才可见——已知缝 OK）
* **对照痛点 / Spec 锚点**：讨论稿 §2.3、工程补丁 3、升格备忘 1–2；对齐 S.4 / `E_OUT_OF_SCOPE_UNTRACKED` 精神；文案「管家保护」而非系统报错。
* **v0.1 范围**：
  1. 基线扫描强制 **Workspace Dirty Check**：记录扫描时是否存在 `uncommitted changes` / `untracked files`。
  2. 若脏：全景基线打**黄色提示**（非错误恐慌），管家话术示例：「发现您本地有 N 个未保存的临时文件。请放心，系统已自动把它们加入保护白名单，后续施工绝不触碰或覆盖它们。」
  3. **首张正式微合同**默认把上述未跟踪/未提交路径排除在可写 Scope 之外（防止误覆盖）；与既有未跟踪门禁精神一致，不得静默放行覆盖。
  4. 功能基线图谱节点展开统一两行白话：`来源线索：…`；`状态说明：已识别模块结构，但未经自动化测试验证`（或等价诚实表述）。
  5. **P0 解锁后防抢跑**：深度分析未完时，Clarification / Impact 挂等待或按 P0 **保守降级**澄清，不得因深度未完成抛异常或空白。
* **明确不包含**：自动 `git clean`/丢弃用户脏文件；把黄标做成阻断打开项目；完整 Impact AST；改 D.1。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 脏工作区 fixture 下基线出现黄标 + 管家话术（非「代码损坏」类恐吓）。
  2. 首张微合同 Scope/门禁默认可观测地排除脏路径（负例：尝试写入被排除路径失败或需显式扩权）。
  3. 图谱节点展开可见两行白话。
  4. P0 完成后、P1 未完时提问不导致未处理异常；有等待或保守澄清；四件套绿。
* **FAIL**：黄标恐吓成报错；或脏文件被首张合同默认可写覆盖；或深度未完右栏崩溃。

<a id="task-c.14d"></a>

#### 【Task C.14d】脏区→Scope 真链路硬门禁 `[COMPLETED]`
* **任务编号**：`TASK-C.14d`
* **前置依赖**：`TASK-C.14c` (COMPLETED)、`TASK-C.12c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t854u「开工」；合入见本条验收注。`dirty_exclusions`→`scope.forbidden_paths`+白话「绝不触碰」；Gateway touch 脏区→`E_OUT_OF_SCOPE_UNTRACKED`+C.12c 软停链；E2E `.env.local`+未跟踪脚本内容不变。单测 `tests/daemon/baseline-c14d.test.ts`。）
* **对照痛点 / Spec 锚点**：讨论稿 见 Git 历史（原 `docs/archive/baseline-archive-onboarding-design.md`） §2.3 Dirty Check + 升格备忘；对齐 S.4 / `E_OUT_OF_SCOPE_UNTRACKED`；兑现 C.14c「默认排除」从口头约定到物理白名单。Tina 计划：契约安全防线 P0。
* **v0.1 范围（施工合同 · Delta）**：
  1. **扫描期**：Workspace Dirty Check 产出物理清单 `dirty_exclusions`（含 `uncommitted changes` 与 `untracked files`）。
  2. **契约期**：生成**首张**微合同草案时，强制把 `dirty_exclusions` 注入 `scope.forbidden_paths`（或等价禁写字段），并在白话合同正文**显式列出**「绝不触碰」路径。
  3. **施工期**：Worker 若 touch 任一脏区路径，立刻触发越界防御：`E_OUT_OF_SCOPE_UNTRACKED` + **C.12c** 原子链（SIGINT 软停 3s → 超时 SIGKILL → 吊销 exec_token → 清锁 → PAUSED 问人）；**禁止**静默放行覆盖。
  4. **验收套件**：端到端用例——故意放置未提交 `.env.local` 与未跟踪脚本；验证首张合同施工**绝不**修改或删除它们（文件内容/mtime 或哈希不变）。
* **明确不包含**：自动 `git clean`/丢弃用户脏文件；深度进度改 WS；右栏 EO 余面全量补齐；改 D.1 鉴权；扩 Spec Freeze 五正文；抢 D.1e。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（实现时锚定，可微调）**：
  - Dirty Check → `dirty_exclusions` 序列化/落盘或入基线侧车
  - 微合同草案装配：`scope.forbidden_paths` 注入 + 白话列表
  - Worker/Gateway 越界路径与 C.12c 软停链接线
  - E2E：脏区保护负例
* **Pass/Fail 验收判定**（≤5）：
  1. 脏工作区下首张微合同 JSON/`forbidden_paths`（或等价）可观测含脏路径；白话合同可见排除名单。
  2. Worker 尝试写入脏路径必触发 `E_OUT_OF_SCOPE_UNTRACKED`（或等价越界码），且走软停→杀链路，不静默成功。
  3. E2E：`.env.local` 与未跟踪脚本内容在施工后不变。
  4. 四件套绿；不改 D.1；不扩 Freeze 五正文。
* **FAIL**：排除仅文案无字段；或脏文件被默认可写覆盖；或越界不触发 C.12c。

<a id="task-c.14e"></a>

#### 【Task C.14e】扫描器 OS 级只读与断网沙盒证明 `[COMPLETED]`
* **任务编号**：`TASK-C.14e`
* **前置依赖**：`TASK-C.14a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t854u「开工」。`daemon/baseline/os-sandbox.ts`；渐进扫附 `archive.os_sandbox` 证明。**Darwin 实情**：`sandbox-exec` Seatbelt；写拒码多为 **`EPERM`**（平台等价 EROFS，**不是** Linux EROFS）；断网多为 **`ENOTFOUND`**。Linux：`unshare -n`，无 RO mount 权限则 `logical_fallback`。反向证伪单测 `tests/daemon/baseline-c14e.test.ts`。证明前不得升级硬承诺文案。）
* **对照痛点 / Spec 锚点**：讨论稿原则 4 / §7 只读证明；C.14a 验收注「逻辑级只读/断网意图已测；**非** OS 只读挂载」。Tina 计划：物理安全底线 P0。
* **v0.1 范围（施工合同 · Delta）**：
  1. **物理挂载隔离**：扫描分析进程经轻量只读容器或只读绑定挂载（RO bind mount / sandbox read-only）运行；对用户业务树写操作在 OS 层失败。
  2. **物理断网**：扫描进程禁用外网（unshare network namespace 或空网络隔离）；禁止出站请求。
  3. **确定性反向证伪单测**：
     - `test_scan_fails_on_write`：扫描器试图 `fs.writeFileSync`（或等价）业务树路径时必报 `EROFS`（Read-only file system）或平台等价只读错误；
     - `test_scan_fails_on_outbound_network`：试图 `fetch()` / `socket` 出站时必失败（网络不可达/被隔离）。
  4. 机制证明前，界面仍不得把「绝不触碰线上业务」写成已兑现硬承诺；证明通过后可升级文案。
* **明确不包含**：云端扫描；完整 Impact AST；深度进度改 WS；改 D.1；扩 Spec Freeze 五正文；抢 D.1e。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（实现时锚定，可微调）**：
  - 扫描器沙盒启动：RO mount + network namespace
  - 平台适配说明（macOS/Linux 路径差异须诚实登记）
  - 反向证伪单测两则
* **Pass/Fail 验收判定**（≤5）：
  1. write 负例稳定得到 EROFS（或文档登记的平台等价错误），业务树文件未改。
  2. outbound 负例稳定失败，无外网成功回包。
  3. 既有 C.14a P0 骨架时限与禁动态执行回归仍绿。
  4. 四件套绿；不改 D.1；不扩 Freeze 五正文。
* **FAIL**：仍仅逻辑约定无 OS 证明；或负例可写/可出网；或改鉴权/扩 Freeze。


<a id="task-c.14f"></a>

#### 【Task C.14f】基线深度进度真 WS/流式 `[COMPLETED]`
* **任务编号**：`TASK-C.14f`
* **前置依赖**：`TASK-C.14b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（Tina t855u 实现；合入 tip `5f6ca93` `feat: C.14f BASELINE_PROGRESS WS + C.15a–d EO 余面 Delta`；矩阵与卡内双写已于 DOC-2 / 2026-11-01 对齐）
* **对照痛点 / Spec 锚点**：基线讨论稿 §5 渐进扫 + §7 流式协议仍 OPEN；C.14b 验收注「深度进度为轮询——已知缝」。项 2（P1 体验）升格。
* **v0.1 范围（施工合同 · Delta）**：
  1. Daemon 在渐进扫 `onP0` / 深度进展 / `onDone` 时经已有 WebSocket 广播 **`BASELINE_PROGRESS`**（载荷含 `scan_id`、`phase`、`progress_copy`、节点增量或全量摘要、`grants_construction:false`）。
  2. 前端全景**停止**固定 2s `setInterval` 轮询作为主路径；改为订阅 WS；保留首连/重连一次 `GET /api/baseline` 兜底。
  3. **P0 秒级解锁右栏**不变；深度未完不阻塞提需求（与 C.14c 防抢跑协同）。
  4. 帧字典 bump：`BASELINE_PROGRESS` 入 `IPC_FRAME_TYPES` / `FRAME_CATALOG`（server→client）；更新字典单测。
* **明确不包含**：改 D.1 鉴权；抢 D.1e；扩 Spec Freeze 五正文；假百分比进度条；云端多端同步。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件（实现时锚定，可微调）**：
  - `src/lib/ipc/frames.ts`；`daemon/server.ts` `ensureBaselineScan` 回调广播
  - `src/routes/index.tsx` / 全景消费路径
  - 单测：广播可观测；前端不再依赖 2s 轮询主路径
* **Pass/Fail 验收判定**（≤5）：
  1. 扫描过程中客户端可在无 2s 轮询情况下收到 ≥1 次 `BASELINE_PROGRESS`（P0 与 done）。
  2. P0 后右栏仍可输入；深度未完不抛未处理异常。
  3. 帧字典含 `BASELINE_PROGRESS`；字典单测绿。
  4. 相关单测绿；不改 D.1；不扩 Freeze 五正文。
* **FAIL**：仍仅靠 2s 轮询更新全景；或阻塞右栏；或改鉴权。

<a id="task-c.15a"></a>

#### 【Task C.15a】EO-01 DeliveryState 完备 `[COMPLETED]`
* **任务编号**：`TASK-C.15a`
* **前置依赖**：`TASK-C.12b` (COMPLETED)
* **任务状态**：**[COMPLETED]**（Tina t855u 实现；合入 tip `5f6ca93`；`src/lib/delivery-state.ts` + 转移 DAG；DOC-2 / 2026-11-01 对齐）
* **对照痛点 / Spec 锚点**：右栏 §14.11 EO-01；C.12b 已落地 epoch/seq + 简化枚举投影，缺完整态与合法转移表。
* **v0.1 范围**：
  1. 扩展 `DeliveryState` 至 EO-01 完备集（至少补 `PLAN_READY`、`VERIFYING`、`REWORK_REQUIRED`、`ESCALATED_HUMAN`；Demo 三态可用主干 `DEMO_READY`+`demo_mode` 或分立 `DEMO_*_READY`，须可测且与 C.12d 不打架）。
  2. 提供**合法转移**辅助（DAG/单向精神）：`REWORK_REQUIRED` 仅 `VERIFYING` 且 `MERGED` 前；`MERGED` 后新缺陷不得倒流，须新微合同。
  3. `projectDeliveryState` 覆盖更多 lifecycle；`DELIVERED` 仅在归档成功路径投影。
  4. **不推翻** C.12b 的 `session_epoch`/`state_seq` 与客户端去重。
* **明确不包含**：重做前端状态管理；Impact AST；云同步；重复实现 Top5 Token/软停。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 新枚举值 `isDeliveryState` 为真；非法倒流（如 `MERGED`→`REWORK_REQUIRED`）被拒。
  2. 资产 `FROZEN` 仍不得冒充 DeliveryState。
  3. 与 C.12b 单测回归绿。
* **FAIL**：删掉 epoch/seq；或允许 MERGED 后倒流返工。

<a id="task-c.15b"></a>

#### 【Task C.15b】EO-08 断言身份与返工计数 `[COMPLETED]`
* **任务编号**：`TASK-C.15b`
* **前置依赖**：`TASK-C.15a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（Tina t855u 库；t866u 活路径接线）
* **对照痛点 / Spec 锚点**：§14.11 EO-08 / DEC-05；返工 2 次上限须不可伪造身份。
* **v0.1 范围**：
  1. Daemon 以确定性 **`UUIDv5(namespace, assertion_text)`**（或 `contract_id + acceptance_assertion_id`）生成 `assertion_id`。
  2. 返工计数由 Daemon 权威存储；Worker/LLM **只读**；同断言满 2 次 → `ESCALATED_HUMAN`。
  3. **`REWORK_REQUIRED` 期间禁止追加新断言**（须合同修订/新微合同）。
  4. 拆流钩子（可测）：同句老 Bug+新需求时，老断言 +1、新需求标 Out-of-Scope（至少 API/纯函数可测）。
* **明确不包含**：完整 Supervisor 自然语言拆流产品化；改 D.1；云端计数。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 同文本反复生成同一 `assertion_id`；改写文本得新 ID 不得清零旧计数器（旧 ID 仍在）。
  2. 计数到 2 → 进入 `ESCALATED_HUMAN`（或返回该态建议）。
  3. 返工期 `addAssertion` 失败。
  4. 单测绿。
  5. **活路径（t866u）**：签署 seed → execute 断言失败计返工 → 第 3 次升格 `PENDING_RESUME`；HTTP rework 读写权威。
* **FAIL**：模型可自造 ID 清零；或返工期默许加断言；或库绿但 Daemon 不计数。

<a id="task-c.15c"></a>

#### 【Task C.15c】EO-05 两阶段归档/GC 细项 `[COMPLETED]`
* **任务编号**：`TASK-C.15c`
* **前置依赖**：`TASK-C.12d` (COMPLETED)、`TASK-C.12e` (COMPLETED)、`TASK-C.15a`
* **任务状态**：**[COMPLETED]**（Tina t855u 实现；合入 tip `5f6ca93`；签署期白名单 GC + MERGED→DELIVERED 事务边界；DOC-2 / 2026-11-01 对齐）
* **对照痛点 / Spec 锚点**：§14.11 EO-05 / DEC-01；C.12d/e 已有轻量 records+manifest，缺签署期白名单 GC 与完整 `MERGED`→`DELIVERED` 事务边界。
* **v0.1 范围**：
  1. **签署期 GC**：仅白名单临时缓存（未采纳 Diff 碎片、Demo `.cache/` 等）；**禁止**清 drafts / 活跃 Demo / 刚冻结 snapshot。
  2. **`MERGED`→`DELIVERED`**：顺序 ①脱敏 Audit Log ②轻量 Demo 拷贝至 records（无 `node_modules`）③按 EO-09 精神清理/封存 worktree；**任一步失败 → 停 `MERGED` 告警，严禁标 `DELIVERED`**。
  3. 与现有 `archiveContractRecords` / `audit-manifest` **并存加固**，不推翻 C.12e。
* **明确不包含**：云归档；莽撞 `rm -rf` drafts；改 D.1。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. 白名单外路径在签署 GC 中保留。
  2. 模拟归档中段失败 → 状态/标志不得为 `DELIVERED`。
  3. 成功路径可标 `DELIVERED`（或返回可交付证明）。
  4. C.12d/e 回归绿。
* **FAIL**：签署 GC 误删 drafts；或失败仍 DELIVERED。

<a id="task-c.15d"></a>

#### 【Task C.15d】P0 AC-ISOL 草稿隔离 + EO-09 Worktree seal `[COMPLETED]`
* **任务编号**：`TASK-C.15d`
* **前置依赖**：`TASK-C.15c`
* **任务状态**：**[COMPLETED]**（Tina t855u 实现；合入 tip `5f6ca93`；`.stagent/` gitignore + drafts 路由 + worktree seal manifest；DOC-2 / 2026-11-01 对齐）
* **对照痛点 / Spec 锚点**：§13 P0 / AC-ISOL（§8.5.2）；§14.11 EO-09。P1 sufficiency / P2 确认分级 / P3 视口防抖 **本卡不实现，仍 backlog**。
* **v0.1 范围**：
  1. 项目初始化/打开时确保根 `.gitignore` 含 **`.stagent/`**（可幂等追加；不当 ACL）。
  2. 草稿默认路由 **`.stagent/drafts/`**（目录可创建；与 Worker 可写 Scope 隔离精神一致）。
  3. Worktree **路径稳定封存**：写 `.stagent/worktrees/{contract_id}/.stagent_manifest.json`（`sealed: true` 等）；封存失败不得假装已释放排他锁（可测钩子/标志）。
* **明确不包含**：P1 Schema / P2 里程碑 UX / P3 防抖；容器 Mode；改 D.1；裸 `mv` worktree。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **Pass/Fail**：
  1. fixture 无 `.stagent/` ignore 时调用后出现规则。
  2. seal manifest 可写可读；`sealed:true`。
  3. 单测绿；不扩 Freeze 五正文。
* **FAIL**：把 gitignore 当沙盒 ACL 宣传；或 seal 失败仍释放锁且无登记。



<a id="task-c.16"></a>

#### 【Task C.16】ActivityBar 单门：列表+操作台 `[COMPLETED]`
* **任务编号**：`TASK-C.16`
* **前置依赖**：`TASK-C.10f` (COMPLETED)、`TASK-C.10c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t892u 点头授权「单门：列表+操作台」；立卡+实现同批）
* **对照痛点**：左侧 ActivityBar 挂「项目审阅」与「合同操作台」像两套产品；非开发用户懵。
* **v0.1 范围（薄卡）**：
  1. ActivityBar **日常只挂一扇**「合同操作台」门（`activity-workbench`）；收掉并列的审阅/图谱日常图标。
  2. 进门后：本项目**需求/合同列表** + **规范与资产**在操作台**左侧栏**；点需求即在五视口干活。
  3. 「项目全景」（原审阅深页：架构/准入）改为操作台内次入口，**不**再占第二 ActivityBar 图标。
  4. 资源管理器保持**纯文件树**；规范与资产不塞回文件树。
* **明确不包含**：改鉴权 / D.1e；拆多路由；扩 Spec Freeze 五正文；football 项目；重做指挥纪律。
* **三项不变**：本卡不改变鉴权、Demo Origin、点亮三证（ADR-0001 后果节）；核验方式为评审期对照本声明检查代码 diff，不存在运行时证据。
* **涉及核心文件**：`ActivityBar.tsx`、`workbench-labels.ts`、`StudioViewportShell.tsx`、`WorkspaceLayout.tsx`、`routes/index.tsx`；单测 `tests/ui/task-c16-single-door.test.tsx` + ide-shell / left-boss / index-route 回归。
* **Pass/Fail**：
  1. ActivityBar 无 `activity-supervisor` / `activity-graph` 日常图标；有 `activity-workbench`。
  2. 点单门可见 `studio-contract-rail` 需求列表；点需求仍停在合同操作台。
  3. 左栏文件树无需求列表 / 规范与资产。
* **FAIL**：仍挂双门当日常入口；或把规范与资产塞回文件树。

<a id="task-c.17"></a>

#### 【Task C.17】P0 调试日志（JSONL + 旅程 + Worker + UI trace） `[COMPLETED]`
* **任务编号**：`TASK-C.17`
* **前置依赖**：`TASK-C.16` (COMPLETED)、`TASK-H.8` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t894u「按这四项开干」；立卡+实现同批）
* **对照痛点**：Tina 真实试用只能收集主观感受；刷新后「点了没反应 / 澄清绕 / 视口空 / 模型慢」对不上完整时间线——默认无 Daemon 文件日志，右栏对话与点击几乎不落盘。
* **v0.1 范围（薄卡 · 四项）**：
  1. Daemon 默认 JSONL：`<repo>/.stagent/logs/daemon.jsonl`（ts、requestId、contractId、sessionId?、route/frame、code?、duration_ms?；info；约 8MiB 简单轮转 `.1`）。
  2. Supervisor 澄清旅程落盘：每轮 user/assistant → `journey-<cid|orphan>.jsonl`（+ 可选 SupervisorSession）；`GET /api/supervisor/journey` 刷新还原。
  3. WORKER_LOG / TERMINAL_STREAM 有界落盘：`.stagent/logs/worker-<cid>.jsonl`（与 WS 并行）。
  4. 前端轻量 UI trace：CTA 点击 / viewport 切换 / disabled 原因 → `POST /api/client-events` 写入同日志体系；刷新不丢。
  5. （尽量）Enrich/Worker LLM 记 duration_ms、enrichCode/model、token（**禁密钥**）。
* **明确不包含**：改鉴权 / D.1e；扩 Spec Freeze 五正文；football 项目；扩 v0.2；云端日志同步。
* **涉及核心文件**：`daemon/core/debug-log.ts`、`daemon/server.ts`、`daemon/supervisor/enrich-openai.ts`、`daemon/worker/openai-client.ts`、`bin/stagent.ts`、`daemon/pipeline/orchestrator.ts`、`src/lib/ui-trace.ts`、`src/lib/daemon-api.ts`、`src/routes/index.tsx`、`StudioViewportShell.tsx`、`AgentChatPane.tsx`；单测 `tests/unit/task-c17-debug-log.test.ts`、`tests/unit/task-c17-ui-trace.test.ts`。
* **Pass/Fail**：
  1. 起 Daemon 后发任意 `/api/*` → `.stagent/logs/daemon.jsonl` 出现含 ts/requestId/route/duration_ms 的行。
  2. 走一轮澄清 → `journey-*.jsonl` 有 user+assistant；刷新工作台右栏可还原摘要。
  3. 施工/验收有输出 → `worker-<cid>.jsonl` 有界行；与 WS 并存。
  4. 点 CTA / 切视口 / 点禁用发送 → client-events 入 daemon.jsonl（kind=client）。
* **FAIL**：日志写密钥；或落盘失败拖垮施工主路径；或扩写 v0.2 能力。

### 3.4b v0.1 硬化与稳定性收敛（Hardening · Tina t877u 立卡；不碰 v0.2 封印）

<a id="task-c.18"></a>

#### 【Task C.18】方案工作台单页（自由对话 + 方案审阅 + 确认方案开工） `[COMPLETED]`

* **任务编号**：`TASK-C.18`
* **任务名称**：方案工作台单页（自由对话 + 方案审阅 + 确认方案开工）
* **前置依赖**：`TASK-C.17` (COMPLETED)、`TASK-C.16` (COMPLETED)
* **优先级**：P4 体验打磨（Tina 试用阻塞）
* **状态**：`[COMPLETED]`（2026-10-26 Tina t905u「改代码…只需要一个页面」）
* **一句话目标**：去掉五视口；右侧真正自由聊挖需求；中间单页方案审阅（图/决策/冲突）；够完整才「生成 Demo」；最底仅「确认方案」冻结 Spec 并直接开工。
* **范围**：
  1. `StudioViewportShell` 收敛为单页「方案审阅」；ActivityBar 仍单门进「方案工作台」。
  2. 右栏 `AgentChatPane` 取消 ≤2 轮选择题门控；对话启发式刷新 `SchemeDraft`。
  3. `SchemeReviewPane`：mermaid/模块/决策确认/冲突抉择/手改备注；`demoReady` 才显示「生成 Demo」；最底「确认方案」→ 冻结 + PENDING_APPROVAL + approve + 任务图 + Worker。
  4. 旧五视口组件文件保留但不作日常入口；合同/授权主链路经「确认方案」收敛。
* **非目标**：不扩 Spec Freeze 五正文；不抢 D.1e；不扩 v0.2；不做完美 LLM 自动画图（启发式薄切片）。
* **验收**：
  - 打开工作台不见五视口 Tab；见「方案审阅」单页。
  - 右侧可自由发送，不强制选择题。
  - 对话后中间方案更新；完整度≥阈值才出现「生成 Demo」；无「继续澄清」按钮。
  - 「确认方案」后合同进入授权/执行链路。
* **关键文件**：`src/components/studio/StudioViewportShell.tsx`、`SchemeReviewPane.tsx`、`src/lib/journey/scheme-draft.ts`、`src/routes/index.tsx`、`src/lib/workbench-labels.ts`、`src/components/studio/viewport-routing.ts`

<a id="task-c.19"></a>

#### 【Task C.19】Supervisor SSOT 合流（DOC-SSOT-Supervisor） `[COMPLETED]`
* **任务编号**：`TASK-C.19`（别名 `DOC-SSOT-Supervisor`）
* **任务名称**：将 Supervisor 散落设计合流为唯一权威源 v2.0
* **前置依赖**：`TASK-C.18` (COMPLETED)
* **优先级**：P4 规范合流（Tina t906u 点名）
* **状态**：`[COMPLETED]`（2026-10-26 Tina t906u「直接…起草统合后的 Supervisor 完整规范」）
* **一句话目标**：新建 `supervisor.md` 五大章 SSOT；旧右栏/工作流/澄清授权/接口清单等加指针；结束多文档打架。
* **范围**：
  1. 新建 `docs/specs/supervisor.md`：角色人设、旁观编译、中栏呈现、硬门禁、生命周期异常。
  2. 洗练合并右栏设计、端到端工作流、澄清授权、接口清单、运转机制、C.14/C.16/C.18 与已验硬防线；写入 C.18 现行体验定案。
  3. 旧关键文档文首「已迁入 SSOT」指针；reports README + Spec Freeze 指向 SSOT。
  4. 本任务规范薄卡回写 COMPLETED。
* **非目标**：不改 daemon/src 产品代码；不整份删除旧文；不升格 Impact AST/v0.2 封印；不抢 D.1e。
* **验收**：
  - SSOT 文件存在且含五大核心章节。
  - 至少 4 份旧 Supervisor 相关文文首指向 SSOT。
  - 本文矩阵/详细卡/changelog 含 C.19 COMPLETED。
* **关键文件**：`docs/specs/supervisor.md`、`docs/reports/*Supervisor*`、`docs/reports/Stagent_Clarification*`、`docs/reports/Stagent_Interface*`、`docs/reports/README.md`、`docs/reports/spec-freeze-record.md`


<a id="task-c.20"></a>

#### 【Task C.20】Supervisor 合流前碎片归档（DOC-ARCHIVE-Supervisor-pre-SSOT） `[COMPLETED]`
* **任务编号**：`TASK-C.20`（别名 `DOC-ARCHIVE-Supervisor-pre-SSOT`）
* **任务名称**：将 Supervisor SSOT 合流前散落文档归档（不硬删）
* **前置依赖**：`TASK-C.19` (COMPLETED)
* **优先级**：P4 规范归档（Tina t908u 点名「归档」）
* **状态**：`[COMPLETED]`（2026-10-26 Tina t908u「归档」）
* **一句话目标**：5 份 Supervisor 碎片迁入 见 Git 历史（原 `docs/archive/supervisor-pre-ssot/`）；原路径 stub；SSOT 仍为唯一权威。
* **范围**：
  1. 新建 见 Git 历史（原 `docs/archive/supervisor-pre-ssot/`） + README。
  2. `git mv`：右栏设计、E2E 工作流、澄清授权、接口清单、运转机制。
  3. 原 `docs/reports/` 同名 stub → SSOT + 归档路径；更新 archive/reports README、Spec Freeze 指针、SSOT §0 路径表。
  4. Spec Freeze 总册保留在 reports（全局多主题）；本任务规范薄卡回写 COMPLETED。
* **非目标**：不硬删；不改 daemon/src 产品代码；不整份归档 Spec Freeze / DocGov / 合同说明 / Top7；不抢 D.1e；不扩 v0.2。
* **验收**：
  - 归档目录含 5 份正文 + README。
  - reports 同名路径为 stub 且指向 SSOT。
  - 本文矩阵/详细卡/changelog 含 C.20 COMPLETED。
* **关键文件**：见 Git 历史（原 `见 Git 历史（原 `docs/archive/supervisor-pre-ssot/`）**`）、`docs/reports/*`（stub）、`docs/specs/supervisor.md`、`docs/reports/spec-freeze-record.md`、本文。

<a id="task-c.21"></a>

#### 【Task C.21】Supervisor SSOT 审查补丁（DOC-SSOT-Supervisor-Patch） `[COMPLETED]`
* **任务编号**：`TASK-C.21`（别名 `DOC-SSOT-Supervisor-Patch`）
* **任务名称**：将 Tina 审查的 Demo/通配/确认时序/pin/降级/demoReady 冲突钉进 SSOT v2.0.1
* **前置依赖**：`TASK-C.20` (COMPLETED)
* **优先级**：P4 规范补丁（Tina t910u「补丁」）
* **状态**：`[COMPLETED]`（2026-10-26 Tina t910u「补丁」）
* **一句话目标**：SSOT 升 v2.0.1，覆盖 EO-06 硬卡误读与冷启动通配等六处病灶，供后续实现不走样。
* **范围**：
  1. 修订 `docs/specs/supervisor.md`：§2.1/2.2、§3.3/3.4、§4.2/4.6、§5.2.1、§5.4.1 + changelog。
  2. 本任务规范薄卡回写 COMPLETED（矩阵/详细卡/changelog/DAG）。
* **非目标**：不改 daemon/src 产品代码；不重开五视口；不抢 D.1e；不扩 v0.2。
* **验收**：
  - SSOT 文首版本为 v2.0.1 且含六条补丁摘要。
  - 本文矩阵/详细卡/changelog 含 C.21 COMPLETED。
* **关键文件**：`docs/specs/supervisor.md`、本文。

<a id="task-h.1"></a>

#### 【Task H.1】Worker JSON/Patch 解析校验与轻量重试 `[COMPLETED]`

* **任务编号**：`TASK-H.1`
* **前置依赖**：`TASK-W.5a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t878u 全部开工；parse-worker-output + OpenAi ≤1 重试；单测 PASS）
* **对照痛点 / Spec 锚点**：主路径纪要 §4#2 — `run-worker` 偶发 Patch/JSON 解析失败导致施工 flake。
* **v0.1 范围（微卡 · 单毛刺）**：
  1. 对 Worker 模型输出做**格式校验拦截**（非法 JSON / 缺必填 patch 字段 → 明确错误，不挂起）。
  2. 校验失败时允许 **≤1 次**轻量本地重试（同轮）；仍失败则平稳报错退回可观测状态（非无声失败）。
* **明确不包含**：换模型供应商；W.5b/c 容器；改 Scope/鉴权；扩写新能力。
* **涉及核心文件（实现时锚定，可微调）**：`daemon/worker/**` 解析路径；单测 `tests/unit/task-h1-worker-parse-retry.test.ts`
* **Pass/Fail 验收判定**（1~2 条确定性断言）：
  1. 注入非法 JSON → 返回可识别错误码/消息且进程不挂起；可选触发正好 1 次重试钩子。
  2. 合法最小 patch → 一次解析成功、零重试。
* **FAIL**：挂起/无声失败；或重试无限；或借机引入新 Adapter。

<a id="task-h.2"></a>

#### 【Task H.2】MERGED/DELIVERED 终态收口消歧 `[COMPLETED]`
* **任务编号**：`TASK-H.2`
* **前置依赖**：`TASK-C.15a` (COMPLETED)、`TASK-C.15c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t878u；**方案 B**：MERGED=对外终态；DELIVERED 为 EO-01 别名；merger 暴露 deliveryTerminal）
* **对照痛点 / Spec 锚点**：纪要 §4#1 — 规范文案 `DELIVERED` vs 现网运行时终态 `MERGED` 两层皮。
* **v0.1 范围（二选一，卡内必须拍板并测通）**：
  1. **方案 A（升格）**：`MERGED` 后 Daemon 完成本地审计 + 轻量 records 归档校验，**原子**推进 `DELIVERED`；失败停 `MERGED`（对齐 C.15c 精神）。
  2. **方案 B（精简注记）**：正式在文档与前端统一注记 **`MERGED` 即为交付终态**；废弃对外单独 `DELIVERED` 承诺（或仅作别名投影）。
* **明确不包含**：云端 records 同步；改 D.1；重做合并门禁。
* **涉及核心文件**：`DeliveryState` / 归档路径 / 前端终态文案；单测 `tests/unit/task-h2-terminal-state-closure.test.ts`
* **Pass/Fail**（1~2）：
  1. 选定方案后：成功归档路径的对外终态与代码枚举**一致可测**（A：出现 `DELIVERED`；B：UI/API 文案认定 `MERGED`=终态且无悬空 DELIVERED 承诺）。
  2. 归档中段失败不得标交付完成（A：非 DELIVERED；B：不得伪造成功文案）。
* **FAIL**：规范与代码继续两层皮；或失败仍标交付完成。

<a id="task-h.3"></a>

#### 【Task H.3】基线扫描硬上限与超时熔断 `[COMPLETED]`
* **任务编号**：`TASK-H.3`
* **前置依赖**：`TASK-C.14a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t878u；SCAN_MAX_FILES/DEPTH + truncate 白话；单测 PASS）
* **对照痛点 / Spec 锚点**：纪要目标 2 — 超大仓库扫描导致 Daemon 假死/内存暴涨风险；C.14a 已有约 3s 熔断意图，缺文件数/深度硬上限固化。
* **v0.1 范围**：
  1. 扫描增加**文件数量硬上限**与**目录深度硬上限**（常量可配置但有默认值）；超限提前结束并白话说明「已截断」。
  2. 超时中断保持可观测；**不**解除 OS 只读挂载证明。
* **明确不包含**：完整 Impact AST；动态执行扫描；改鉴权。
* **涉及核心文件**：基线扫描器；单测 `tests/unit/task-h3-scan-hard-cap.test.ts`
* **Pass/Fail**（1~2）：
  1. fixture 超文件数上限 → 扫描停止且返回截断标志/文案；Daemon 不假死。
  2. 超时路径可测中断（或 mock 时钟）且只读证明不被绕过。
* **FAIL**：无上限扫爆内存；或借机上 AST。

<a id="task-h.4"></a>

#### 【Task H.4】空目录友好 git init 引导 `[COMPLETED]`
* **任务编号**：`TASK-H.4`
* **前置依赖**：`TASK-D.1b` (COMPLETED)、`TASK-D.1d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t878u；ensureGitInit + CLI open 自动 / API 单键；已有仓幂等）
* **对照痛点 / Spec 锚点**：纪要已知缝 — 空目录打开不会自动 `git init`，后续合同/合并链路卡顿。
* **v0.1 范围**：
  1. 打开空（或无 `.git`）目录时提供**友好自动或单键** `git init` 引导（白话确认，非静默破坏已有仓）。
  2. init 成功后主路径可继续基线/合同；失败给出可理解错误。
* **明确不包含**：D.1e 系统选文件夹；改写已有 Git 历史；云克隆。
* **涉及核心文件**：`stagent open` / 打开项目面板；单测 `tests/unit/task-h4-empty-dir-git-init.test.ts`
* **Pass/Fail**（1~2）：
  1. 无 `.git` 的空目录经引导后出现合法 `.git` 且打开流程可继续。
  2. 已有 `.git` 目录不得被再次 init 破坏（幂等/跳过可测）。
* **FAIL**：静默 `git init` 毁掉已有仓；或抢做 D.1e。


<a id="task-h.5"></a>

#### 【Task H.5】旅程草案 `contract_id` 不丢 `[COMPLETED]`
* **任务编号**：`TASK-H.5`
* **前置依赖**：`TASK-S.6` (COMPLETED)、`TASK-C.11a` (COMPLETED)
* **任务状态**：**[COMPLETED]**（2026-10-26 Tina t881u「开工」；persistJourneyDraft + 顶层 contract_id）
* **对照痛点 / Spec 锚点**：主路径纪要 §4#3 / 走查阻塞 — 旅程草案偶发不直接带出合同 id，靠 API 另立薄卡才继续。
* **v0.1 范围（微卡 · 单毛刺）**：
  1. 草案创建成功路径的响应/会话投影**必须**带回可解析非空 `contract_id`（与落盘合同一致）。
  2. 若创建失败或 id 不可用：返回**显式可观测错误**，禁止静默丢 id 后假装进入签署流。
* **明确不包含**：重做旅程引擎；改 D.1 鉴权；扩写新 Supervisor 能力；云端会话。
* **涉及核心文件（实现时锚定，可微调）**：Supervisor 旅程/草案创建路径；单测 `tests/unit/task-h5-draft-contract-id.test.ts`
* **Pass/Fail 验收判定**（1~2 条确定性断言）：
  1. 最小成功草案 fixture → 响应含非空 `contract_id` 且可读回同 id 合同。
  2. 故意打断创建 → 不得出现「无 id 却可签署」的成功态；错误码/消息可识别。
* **FAIL**：静默丢 id；或借机重写整段旅程/引入新画布。

<a id="task-h.6"></a>

#### 【Task H.6】脏区引导精修（acknowledge_dirty） `[COMPLETED]`
* **任务编号**：`TASK-H.6`
* **前置依赖**：`TASK-C.14c` (COMPLETED)、`TASK-C.14d` (COMPLETED)
* **任务状态**：**[COMPLETED]**（Tina t881u；白话 409 + ack 排除落盘）
* **对照痛点 / Spec 锚点**：硬化目标 2 — 非技术用户卡在脏区 409；临时凭证/本地文件误入脏区缺低恐慌排除建议。
* **v0.1 范围**：
  1. 固化 `acknowledge_dirty` 拦截：未确认开工 → **409** + **白话、低恐慌**排除建议（点名常见凭证/本地文件模式，非堆栈恐吓）。
  2. 确认后脏路径进入 Scope 排除/禁写清单；Worker 不得改这些路径。
* **明确不包含**：改鉴权；放松 Scope；OS 沙盒重做；Impact AST。
* **涉及核心文件**：脏区拦截/文案路径；单测 `tests/unit/task-h6-dirty-guidance.test.ts`
* **Pass/Fail**（1~2）：
  1. 未 `acknowledge_dirty` 开工 → 409，且消息含至少一条可执行排除建议（可测子串/结构字段）。
  2. 确认后脏路径出现在排除/禁写集合，touch 被拒（复用 C.14d 精神，不重做整卡）。
* **FAIL**：仅抛生硬 409 无引导；或确认后仍可改脏文件。

<a id="task-h.7"></a>

#### 【Task H.7】主链路回归套件锁死 `[COMPLETED]`
* **任务编号**：`TASK-H.7`
* **前置依赖**：`TASK-H.1`–`TASK-H.4` (COMPLETED)、`TASK-E.1` (COMPLETED)
* **任务状态**：**[COMPLETED]**（Tina t881u；`scripts/mainline-regression.mjs` + `npm run test:mainline`）
* **对照痛点 / Spec 锚点**：硬化目标 3 — 将打开→基线/脏区→需求/Demo→签署→施工→验收→MERGED 及优先补测（质疑回灰、返工超限、git trim）沉淀为可重复回归。
* **v0.1 范围**：
  1. 提供**本地可重复**主链路回归脚本/断言入口（CI 可挂；允许 fixture/ stub，不强制真模型账单）。
  2. 至少锁住：`git porcelain` 行首空格（trim 回归）与 Top5/门禁相关既有绿测不被静默删掉（清单指纹或显式调用）。
* **明确不包含**：新功能；真云 E2E；W.5b/c；改产品状态机语义。
* **涉及核心文件**：`scripts/` 或 `tests/` 回归入口；单测/脚本断言 `tests/unit/task-h7-mainline-regression.test.ts`（或等价脚本 exit 码约定）
* **Pass/Fail**（1~2）：
  1. 回归入口在干净树上 exit 0（或 vitest 目标绿）且覆盖「打开→…→MERGED」关键节点断言清单（文档列明）。
  2. 故意破坏 porcelain trim 行为时，回归**失败**（防再打坏）。
* **FAIL**：只有文档无脚本；或借机塞进新业务功能。

<a id="task-h.8"></a>

#### 【Task H.8】records 脱敏导出与单项目清理 `[COMPLETED]`
* **任务编号**：`TASK-H.8`
* **前置依赖**：`TASK-C.12e` (COMPLETED)、`TASK-C.15c` (COMPLETED)
* **任务状态**：**[COMPLETED]**（Tina t881u；`POST /api/records/export|cleanup`）
* **对照痛点 / Spec 锚点**：硬化目标 3 / EO-03·EO-05 — 用户需直接拿到交付归档；缺一键脱敏 zip 与单项目彻底清理。
* **v0.1 范围**：
  1. `.stagent/records/` **一键脱敏打包**为 zip（导出物不含明文密钥/Token；敏感字段按既有 redact 规则）。
  2. **单项目彻底清理**机制：可清除该项目 records（及约定附属）且幂等；清理后不影响源码工作树业务文件。
* **明确不包含**：云端 records 同步；多租户；改 D.1；重做 audit-manifest 语义（可复用 C.12e）。
* **涉及核心文件**：records 导出/清理 CLI 或 API；单测 `tests/unit/task-h8-records-export-cleanup.test.ts`
* **Pass/Fail**（1~2）：
  1. 导出 zip 可解开且抽样断言无未脱敏密钥样式字段；含合同/归档清单类文件。
  2. 清理后目标 records 目录不存在（或空）且二次清理不抛致命错（幂等）。
* **FAIL**：zip 含明文 Key；或清理删到源码；或上云。


<a id="task-h.9"></a>

#### 【Task H.9】废止 `.stagent/metadata/` 写入（对齐 ADR-0011）`[COMPLETED]`（ledger **DLV-4**）

* **任务编号**：`TASK-H.9`
* **任务名称**：清除代码对 `.stagent/metadata/` 的写入，统一到 `.stagent/records/`
* **对应规格**：[ADR-0011](../adr/0011-audit-sidecar-records-path.md)；ledger **DLV-4**；scheme REJ-007
* **前置依赖**：`TASK-C.12e` / `TASK-C.15c`（COMPLETED · records 侧车已落地）
* **优先级**：P3 · **NON_BLOCKER**（**不阻断** `TASK-L.15`）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#50](https://github.com/he18718143986-design/IDE/pull/50) / tip `34213c8`（`fix(H.9): move demo-confirm from .stagent/metadata to records`；GitHub squash merge）
* **合入说明**：写入统一 `.stagent/records/demo-confirm.json`；`LEGACY_` 旧路径只读。`readDemoConfirm` 首次读取会迁移落盘；`upsert` 仅在新文件不存在时合并 legacy（有意清空不复活）。
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

<a id="task-c.3"></a>

#### 【Task C.3】Monaco 核心编辑器集成与受控 Worktree 读写
* **任务编号**：`TASK-C.3`
* **前置依赖**：`TASK-C.1`, `TASK-A.2` (COMPLETED)（v1.3.3：移除已删除的 `C.2→C.3` 串行边）
* **任务状态**：**[COMPLETED]**（分支 `feat/c3-monaco-editor` 提交 `88aec68`，**2026-10-21 核验：已合入 main**。Monaco（`@monaco-editor/react`，编辑器本体默认从 jsDelivr CDN 加载，离线不可用）可写/只读区分；保存只走 `POST /api/worktree/files`，越权 403 + `.stagent/audit/gateway-violations.jsonl` + `GATEWAY_VIOLATION` 帧，文件无改动；`EVIDENCE_STATUS_CHANGED=STALE` 时中栏顶部横幅；Agent 的 Edit/Write 完成后中栏自动打开并刷新该文件。无合同（Vibe）时根为主工作树，仅禁写 .git/.stagent（保护清单待 P.1）。）
* **核心目标**：
  1. Monaco Editor 嵌入，可写/只读视觉区分。
  2. **编辑器内 Evidence STALE 提示 (G-18)**：当关联合同 Evidence 变为 STALE 时，在中栏顶部弹出警告横幅，提示代码已被外部修改需重新验证。
  3. 服务端强制保存校验：保存必须调用 `POST /api/worktree/files`，越权保存由 Daemon 403 拒绝，记录 `GATEWAY_VIOLATION`，文件物理无改动。
* **涉及核心文件**：
  - 新增：`src/components/MonacoEditorPane.tsx`
  - 新增：`src/hooks/useWorktreeFile.ts`
  - 修改：`daemon/server.ts`
  - 测试：`tests/ui/monaco-editor-pane.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：越权写入请求返回 403 并在服务端留下违规记录；Evidence 失效时编辑器横幅即时展现。
  - **FAIL**：前端允许写入未授权路径；缺少 STALE 视觉指示。

---


---

### 3.4c 闭环旅程 v2.1 第一批（Journey · 规格 `supervisor.md` 第三部分 §13～§20；对应 §19 落差 L-01～L-10）

<a id="task-j.1"></a>

#### 【Task J.1】右栏 AI 搭档只读工具集（P0 安全） `[COMPLETED]`

* **任务编号**：`TASK-J.1`
* **任务名称**：方案工作台右栏搭档以只读工具集运行
* **对应规格**：SSOT 第三部分 §13.2「AI 搭档只读是硬约束」；§18 `P-01`；§19 `L-02`
* **前置依赖**：无（可立即开工；`TASK-J.7` 硬依赖本卡）
* **优先级**：**P0**（现网安全缺口）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#29](https://github.com/he18718143986-design/IDE/pull/29) / tip `4144a20`（`feat(daemon): TASK-J.1 右栏 partner 只读化`）；partner 只读；相关测本机 51 passed
* **对照痛点（代码事实）**：右栏默认首选适配器是 `ClaudeCodeAdapter`（`daemon/server.ts::defaultChatAdapters`），其 `BASE_TOOLS` 含 `Edit` / `Write` / `MultiEdit`，以 `--permission-mode acceptEdits` 启动，`cwd` 为用户仓库根（`daemon/chat/session-manager.ts` 的 `resolveCwd ?? repoRoot`）。也就是说，右栏聊天今天可以**不经合同、不经 Worktree** 直接改用户主干——违反签署分水岭「签署前主干改动为 0 字节」。
* **一句话目标**：在方案工作台里，无论接哪个适配器，右栏只能读、搜、列目录，不能写文件、不能跑 shell、不能联网。
* **范围**：
  1. `ClaudeCodeAdapter` 新增角色选项 `role: "partner" | "worker"`（默认 `"partner"`）。`partner` 时：`--tools` / `--allowedTools` 仅 `Read,Glob,Grep`（LS 在 CLI 2.1.296 不存在，列目录经 Glob）；`--disallowedTools` 追加 `Edit,Write,MultiEdit,NotebookEdit,Bash,TodoWrite,Task,WebFetch,WebSearch`；`permissions.defaultMode` 与 `--permission-mode` 改为 `default`（**不**用 `acceptEdits`）；`permissions.deny` 同步加入写类工具。`worker` 角色保持现行行为（仅供 Worker 路径使用，不进右栏）。
  2. `defaultChatAdapters` 构造右栏适配器时显式传 `role: "partner"`。
  3. `ChatAdapterInfo` 增加 `tool_mode: "read_only" | "read_write"`；`BaselineChatAdapter` / `DemoChatAdapter` 标 `read_only`。右栏适配器选择（`pick-chat-adapter`）**拒绝**选中 `read_write` 适配器，并在设置页显示白话原因。
  4. PreToolUse hook（`pretool-hook.mjs`）在 `partner` 角色下对任何写类工具调用返回 block（双保险：hook 失败时 CLI 参数仍拦截）。
  5. 同步删除两处 LS 残留（LS 在 CLI 2.1.296 不存在）：`claude-code-adapter.ts` `BASE_TOOLS` 中的 `"LS"`；`pretool-hook.mjs` `READ_TOOLS` 中的 `"LS"`。
* **非目标**：不改 Worker 适配器行为；不做施工对话分流（第二批）；不改 `BaselineChatAdapter` 的提示词。
* **验收（PASS）**：
  - `tests/unit/cli-host-claude-code.test.ts` 新增用例：`role: "partner"` 生成的 argv 中 `--tools` 与 `--allowedTools` 恰为 `Read,Glob,Grep`；`--disallowedTools` 含 `Edit`、`Write`、`MultiEdit`、`Bash`、`Task`、`WebFetch`、`WebSearch`；`--permission-mode` 不是 `acceptEdits`；settings 的 `permissions.deny` 含全部写类工具。
  - `tests/unit/pick-chat-adapter.test.ts` 新增用例：`tool_mode: "read_write"` 的适配器不会被选为右栏适配器。
  - 新增 `tests/integration/partner-readonly.test.ts`（对应 SSOT `P-01`）：用替身 spawn 捕获启动参数并模拟一次 `Write` 工具调用经 hook，断言被 block、仓库内目标文件不存在。
  - `worker` 角色既有用例全部不回归。
* **FAIL**：右栏任一适配器在方案工作台中可产生写文件或 shell 调用；或仅靠 hook、无 CLI 参数层拦截。
* **关键文件**：`daemon/worker/cli-host/claude-code-adapter.ts`、`daemon/worker/cli-host/pretool-hook.mjs`、`daemon/server.ts`、`daemon/chat/types.ts`、`src/lib/chat-events.ts`、`src/lib/pick-chat-adapter.ts`（以实际路径为准）
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围（本卡只收紧右栏 partner 工具白名单与 permission-mode；不放宽 Gateway `writable_paths`）。合入证据见卡内「合入证据」；真 Key 补验仍挂账 OP-28。
* **估算**：S

<a id="task-j.2"></a>

#### 【Task J.2】`ScopePlan` 纯函数与 Daemon 范围预检构建器 `[COMPLETED]`

> **交付全链路备注（2026-10-30）**：本卡不变。后续 `TASK-L.3`、`L.9`、`L.12` 会在 `scope-plan-builder.ts` 中追加签署前的系统范围（`withSystemScope`：`tests/stagent/**`、`docs/system/**`、`stagent check` 命令、按桩种类的安装权限）。实现本卡时请把「组合各来源 → 计算 digest」写成可追加来源的形式。

* **任务编号**：`TASK-J.2`
* **任务名称**：范围预检单一事实源（类型 + 纯函数 + 构建器）
* **对应规格**：SSOT 第三部分 §15.3、§15.4（数据部分）；§18 `S2-02`、`S2-04`；§19 `L-03`（前半）
* **前置依赖**：无
* **优先级**：P1（本批主链起点）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#4](https://github.com/he18718143986-design/IDE/pull/4) / tip `e6e1730`（`feat(J.2): ScopePlan 纯函数与范围预检构建器`）
* **对照痛点（代码事实）**：合同范围今天在「确认方案」那一刻由 `buildL0Plan` 从意图文本临时推出；推不出路径时兜底为 `["src/**"]`（`daemon/supervisor/rules-l0.ts::buildL0Plan`），而老项目（有 `package.json`）的 `src/**` 正是通配符分级必拒的 `bare_top_glob`——这就是「确认后 403」的根因。
* **一句话目标**：把「这一轮会改哪里、不会碰哪里、要谁点头、怎么验收、多大规模」算成一个与方案修订号绑定、可摘要、确定性的 `ScopePlan`，并让它成为后续预检与合同创建**共用**的唯一来源。
* **范围**：
  1. 新建 `src/lib/journey/scope-plan.ts`（前后端共享，**纯函数、零 fs**）：导出 SSOT §15.3 的 `ScopePlan` 类型；`scopePlanDigest(plan)`（规范化 `stableStringify`，剔除时间戳，摘要不含 `plan_digest` 自身）；`applyScopeDecisions(plan, { excluded_area_ids, approvals })`（用户排除区域 / 敏感项表态 → 新 plan，重算 digest）；`scopePlanToContractScope(plan)`（→ `writable_paths` / `forbidden_paths` / `verification_spec` / `budget`，供 J.4/J.5 共用）。
  2. 新建 `daemon/supervisor/scope-plan-builder.ts`：`buildScopePlan({ repoRoot, scheme, decisions })`。内部组合既有 `buildL0Plan`（以方案标题、摘要、模块名、备注合成输入）、`gradeWritableScope` / `isGreenfieldRepo`、保护清单匹配（`protected_files` → `needs_approval`）、`dirty_exclusions` 与 `DEFAULT_FORBIDDEN_PATHS`（→ `never_touch` 白话分组）。
  3. **自动收敛（确定性，写死规则）**：分级拒绝的 `bare_top_glob` 在非绿野仓库中，按以下顺序尝试收敛，命中即替换，全部未命中则保留在 `grade.rejected`：① 方案模块名 / 备注中出现的、仓库里**真实存在**的子目录名（大小写不敏感的英文 token 匹配）→ `<top>/<dir>/**`；② 方案中显式出现的相对路径（已由 `extractPathsFromText` 提取）→ 精确保留。**禁止**为不存在的目录编造路径（如凭空生成 `src/features/<slug>/**`）——新建模块的落点由第二批意图编译器的 `project_anchor` 提供。
  4. `verification`：取仓库 `package.json` 实际存在的 `typecheck` / `test` 脚本生成命令；一个都没有 → `commands = []`、`manual_only = true`、白话「这个项目没有自动检查，完成后需要你试玩确认」。
  5. `budget.plain`：由 `max_file_modifications` 与 `max_duration_seconds` 生成「最多改约 N 个文件，预计 A～B 分钟」；**不得**出现 Token / tool calls 字样。
  6. `areas[].label`：模块可对应时用模块名；否则用目录的白话描述（「`src/pages/home` 这一块」）。
* **非目标**：不建 HTTP 接口（J.4）；不改「确认方案」流程（J.5）；不做 UI（J.6）；不接意图编译器。
* **验收（PASS）**：新增 `tests/unit/scope-plan.test.ts`（对应 SSOT `S2-02`、`S2-04`）：
  - **单一来源**：同一 `(repoRoot, scheme, decisions)` 两次构建得到相同 `plan_digest`；`scopePlanToContractScope` 的输出再经 `gradeWritableScope` 必为 `ok`（当 `plan.grade.ok`）。
  - **三类夹具**：绿野（无 `package.json`）→ `src/**` 作为种子放行；老项目（有 `package.json`）+ 意图命中真实子目录 `src/pages` → 收敛为 `src/pages/**` 且 `grade.ok`；老项目 + 无任何可匹配目录 → `grade.ok === false` 且 `rejected` 含 `src/**`（**不**编造路径）；非 npm（Python 布局）不因缺 `package.json` 被误判。
  - 命中保护清单的路径进入 `needs_approval`，`approved === null`；`applyScopeDecisions` 表态后 digest 变化。
  - 无 `typecheck` / `test` 脚本 → `manual_only === true`。
  - `budget.plain` 与 `areas[].label` 不含 `token`、`tool`、`glob`、`**` 字样。
* **FAIL**：任何收敛结果指向仓库中不存在的目录；或同输入 digest 不稳定。
* **关键文件**：`src/lib/journey/scope-plan.ts`（新）、`daemon/supervisor/scope-plan-builder.ts`（新）、`daemon/supervisor/rules-l0.ts`（只读复用，必要时导出内部函数）、`src/lib/writable-scope-grade.ts`、`daemon/pipeline/scheme-snapshot-store.ts`（复用 `stableStringify`，可抽到共享模块）
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证。网关写范围：本卡把 `ScopePlan` 定为唯一来源（对齐 [ADR-0018](../adr/0018-intent-to-executable-seal.md) INV-SEAL-01/02），**不**放宽 Gateway 物理门禁；签署路径禁止 `buildL0Plan(chat)` 旁路（旁路删除在 J.5）。
* **估算**：M

<a id="task-j.3"></a>

#### 【Task J.3】唯一确认谓词纳入 `ScopePlan` `[COMPLETED]`

> **ADR-0014 修订（2026-10-30，[`delivery-lifecycle.md`](./delivery-lifecycle.md) §5 SA-1，推荐默认，待用户确认）**：`E_SCOPE_APPROVAL_REQUIRED` 保留，但「表态」不再是逐项点击。`needs_approval` 只收用户原话点名的敏感项与系统必需的敏感项（如锁文件），其余默认移入 `never_touch`。授权仍存在 `ScopePlan.needs_approval[].approved` 中：前端在「确认开工」时用 `applyScopeDecisions` 一次性把全部项置为 `true`，带着新 `plan_digest` 提交。T-GATE 用例中「有未表态敏感项」改为「提交的 `ScopePlan` 中仍有 `approved !== true` 的敏感项」。其余判定顺序不变。

* **任务编号**：`TASK-J.3`
* **任务名称**：`evaluateSchemeConfirmation(draft, demo, scopePlan)` 与三个范围拒绝码
* **对应规格**：SSOT 第三部分 §15.5、§17 D7；§7 D1 拒绝码表（v2.1 三行）；`runtime-contract-and-safety.md` §2.3；§18 `S2-01`、`S2-03`（及 `S2-02` 谓词侧）；§19 `L-04`
* **前置依赖**：`TASK-J.2`（类型）
* **优先级**：P1
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#5](https://github.com/he18718143986-design/IDE/pull/5) / tip `f4656a9`（`feat(J.3): 确认谓词纳入 ScopePlan（SCOPE_GATE 默认关）`）
* **一句话目标**：「能不能点确认方案」的唯一谓词把范围也算进去，前端在确认**之前**就能把所有范围问题用白话说清。
* **范围**：
  1. `src/lib/journey/scheme-draft.ts::evaluateSchemeConfirmation` 增加第三参数 `scopePlan: ScopePlan | null`。判定顺序（先命中先返回）：既有 `E_SCHEME_ALREADY_FROZEN` → `E_SCHEME_CONFLICTS_OPEN` → `E_SCHEME_NOT_REVIEWABLE` → Demo 四码 → **`E_SCOPE_NOT_READY`**（`scopePlan == null` 或 `scopePlan.scheme_revision !== draft.scheme_revision`）→ **`E_SCOPE_POLICY`**（`!scopePlan.grade.ok`）→ **`E_SCOPE_APPROVAL_REQUIRED`**（提交的 `ScopePlan` 中存在 `needs_approval[i].approved !== true` 的敏感项；依 ADR-0014 / SA-1，不再支持逐项表态，开工时一并授权）。
  2. 三个码的白话文案按 SSOT §15.5 表格原文；`E_SCOPE_POLICY` 文案须带出被拒的白话区域名（来自 `grade.rejected` 与 `areas`），**不**直接打印 glob。
  3. `canConfirmScheme` 兼容别名改为传 `null` 并在 JSDoc 标注「新代码禁止使用」——其结果将恒为 `E_SCOPE_NOT_READY`，从而迫使遗留调用点暴露出来；`grep` 全仓调用点并列入 PR 描述。
  4. `src/routes/index.tsx` 的 `schemeConfirmation` `useMemo` 暂传 `null`（真正接线在 J.5）。**本卡合入后「确认方案」按钮会显示「正在核对要改哪些地方…」而不可点**——为避免主干出现不可用窗口，本卡与 `TASK-J.5` **必须同一 PR 合入或 J.5 紧随其后**；若需单独合入，用临时开关 `SCOPE_GATE_ENABLED`（默认关）包住第 1 步新增的三条判定，J.5 合入时移除开关。
* **非目标**：不改 Daemon（J.4）；不做 UI 区块（J.6）。
* **验收（PASS）**：
  - `tests/unit/scheme-confirmation-gate.test.ts` 新增 `T-GATE-012`～`T-GATE-016`：修订号不一致 → `E_SCOPE_NOT_READY`；`null` → `E_SCOPE_NOT_READY`；`grade.ok=false` → `E_SCOPE_POLICY` 且文案含白话区域名、不含 `**`；存在未授权敏感项（`approved !== true`） → `E_SCOPE_APPROVAL_REQUIRED`；全部满足 → `ok`。
  - 判定顺序用例：有 OPEN 冲突且范围未就绪时返回 `E_SCHEME_CONFLICTS_OPEN`（冲突优先）。
  - 既有 `T-GATE-001`～`011` 在传入合规 `scopePlan` 夹具后全部不回归。
* **FAIL**：存在第二套范围判断（UI 自行推导 `disabled`）；或谓词读取 `completeness`。
* **关键文件**：`src/lib/journey/scheme-draft.ts`、`src/routes/index.tsx`、`tests/unit/scheme-confirmation-gate.test.ts`
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围物理门禁。本卡只把确认谓词纳入已算好的 `ScopePlan`（含 `E_SCOPE_*`），不另开写路径。
* **估算**：S

<a id="task-j.4"></a>

#### 【Task J.4】Daemon 范围预检接口与快照绑定 `[COMPLETED]`

* **任务编号**：`TASK-J.4`
* **任务名称**：`POST /api/supervisor/scope/preflight` + 快照写入 `ScopePlan` + 签署链按快照校验
* **对应规格**：SSOT 第三部分 §15.5「签署链对齐」1～4；`runtime-contract-and-safety.md` §1「护照的来源」、§2.1 v2.1 补充、§2.3「Daemon 专属码」；§18 `S2-05`、`S2-06`、`S2-07`；§19 `L-03`（后半）
* **前置依赖**：`TASK-J.2`
* **优先级**：P1
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#6](https://github.com/he18718143986-design/IDE/pull/6) / tip `4832506`（`feat(J.4): ScopePlan 预检接口与快照签署绑定`）
* **一句话目标**：Daemon 能随时为当前方案算出 `ScopePlan`；冻结时把它锁进快照；带 `confirmation_id` 的合同只能与快照里的范围一字不差，从此签署链上不可能再出现范围 403。
* **范围**：
  1. **预检接口**：`POST /api/supervisor/scope/preflight`，入参 `{ scheme, decisions }`，返回 `ScopePlan`。只读、零模型、零落盘、不建 Worktree；鉴权同 `/api/supervisor/draft`；前端客户端 `src/lib/daemon-api.ts` 增加 `preflightScope()`。
  2. **快照绑定**：`daemon/pipeline/scheme-snapshot-store.ts` 的 `SchemeSnapshot` 增加 `scope_plan: ScopePlan`，`SCHEME_SNAPSHOT_SCHEMA_VERSION` 升到 `"1.1"`；快照 `digest` 纳入 `scope_plan.plan_digest`。读取 `1.0` 旧快照时 `scope_plan` 视为缺失。
  3. **冻结时重跑预检**：`POST /api/supervisor/scheme/freeze` 入参增加 `scope_plan`。Daemon 用快照内 `scheme` + `scope_plan` 中的用户表态重跑 `buildScopePlan`，`plan_digest` 不一致 → **`409 E_SCOPE_PLAN_DRIFT`**，响应体附新 `ScopePlan`，**不写快照**。
  4. **签署链校验**：`POST /api/contracts` 与 `POST /api/contracts/:id/approve` 在带 `confirmation_id` 时：快照缺 `scope_plan`（1.0 旧快照）→ `409 E_SCHEME_SNAPSHOT_NOT_FOUND`（沿用既有码，消息注明「快照版本过旧」）；合同的 `writable_paths` / `forbidden_paths` / `verification_spec` / `budget` 与 `scopePlanToContractScope(snapshot.scope_plan)` 不一致 → **`409 E_SCHEME_SNAPSHOT_MISMATCH`**；一致时**跳过**对该合同再调 `assertContractScopeAllowed`（预检已保证合规），并在跳过前用 `gradeWritableScope` 做一次断言，失败则记告警并返回 `500 E_SCOPE_INVARIANT_BROKEN`（D1 违约，不得返回 403）。
  5. 不带 `confirmation_id` 的旧路径行为**不变**（仍走 `assertContractScopeAllowed`）。
  6. 新码登记：在 `daemon/server.ts` 错误映射处补 `E_SCOPE_PLAN_DRIFT`、`E_SCHEME_SNAPSHOT_MISMATCH`；若新增 `E_SCOPE_INVARIANT_BROKEN`，须同步补进 `runtime-contract-and-safety.md` §2.3「Daemon 专属码」表与 SSOT §15.5（文档改动随本卡 PR）。
* **非目标**：不改前端确认流程（J.5）；不做 UI。
* **验收（PASS）**：新增 `tests/integration/scheme-confirm-scope-drift.test.ts`（端口段 **3930–3939**，起真 Daemon，断言落盘后的权威状态）：
  - `T-HTTP-S205`：冻结前把临时仓库从绿野改为有 `package.json` → freeze 返回 `409 E_SCOPE_PLAN_DRIFT`，快照文件不存在，响应附新 plan。
  - `T-HTTP-S206`：带 `confirmation_id` 创建合同，`writable_paths` 比快照多一条 → `409 E_SCHEME_SNAPSHOT_MISMATCH`，合同未落库。
  - `T-HTTP-S207a/b/c`：老项目、绿野、非 npm 三类夹具各走一遍「preflight → freeze → create(confirmation_id) → approve(confirmation_id)」，全程不出现 `E_WRITABLE_SCOPE_POLICY`，合同 `lifecycle_state` 到达批准后状态。
  - `T-HTTP-S207d`：1.0 旧快照 + `confirmation_id` → `409 E_SCHEME_SNAPSHOT_NOT_FOUND`。
  - 既有 `tests/integration/scheme-confirm-http-injection.test.ts`（7 条）与 `contract-api` / `resume-abort` 不回归；`tests/unit/test-port-map.test.ts` 通过。
* **FAIL**：preflight 写盘或调用模型；签署链在带 `confirmation_id` 时任何路径返回 403。
* **关键文件**：`daemon/server.ts`、`daemon/pipeline/scheme-snapshot-store.ts`、`daemon/supervisor/scope-plan-builder.ts`、`src/lib/journey/scope-plan.ts`、`src/lib/daemon-api.ts`
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证。网关写范围：经 `scope/preflight` 与快照 `scope_plan`/`plan_digest` 绑定后进入签署（INV-SEAL-03）；漂移拒绝，不放宽 Gateway。
* **估算**：M

<a id="task-j.5"></a>

#### 【Task J.5】「确认方案」接线改造：范围先算好、按快照签 `[COMPLETED]`

> **ADR-0014 修订（2026-10-30）**：按 SA-1，确认请求提交的是已用 `applyScopeDecisions` 置好授权的 `ScopePlan`（见 J.3 修订），Daemon 用快照 + 同一组表态重算，摘要一致；不再有逐项表态往返。防抖预检保留（范围仍须在点击前算好，只是不强迫用户审阅）。

* **任务编号**：`TASK-J.5`
* **任务名称**：前端确认链改用 `ScopePlan`，删除事务前的临时合同推断
* **对应规格**：SSOT 第三部分 §15.5、§16.3（失败分支）；§19 `L-03`、`L-04`
* **前置依赖**：`TASK-J.3`、`TASK-J.4`
* **优先级**：P1
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#7](https://github.com/he18718143986-design/IDE/pull/7) / tip `c877d1c`（`feat(J.5): 确认链接线 ScopePlan 并移除 SCOPE_GATE`）
* **对照痛点（代码事实）**：`src/routes/index.tsx::handleConfirmScheme` 在事务开始前用 `formatSchemeAsIntent` → `submitJourneyMessage` 生成合同骨架，再在 `signAndPrepare` 里 `createContractWithAdmission`——范围从未展示给用户，且失败发生在右栏已锁之后。
* **一句话目标**：方案每变一次就预检一次；确认时只冻结、只按快照建合同；任何范围问题都在点击前暴露。
* **范围**：
  1. `Console()` 新增 `scopePlan` 状态：`schemeDraft.scheme_revision` 变化后 300ms 防抖调用 `preflightScope()`（依 ADR-0014 审阅后置，无开工前逐项表态交互）；在途请求被新修订作废；结果修订号不匹配时丢弃。
  2. `schemeConfirmation` `useMemo` 传入 `scopePlan`（替换 J.3 的 `null`，移除 `SCOPE_GATE_ENABLED` 开关）。
  3. 删除事务前的 `formatSchemeAsIntent` → `submitJourneyMessage` 合同推断块。`persistSnapshot` 发送 `scope_plan`；`signAndPrepare` 用 `scopePlanToContractScope(scopePlan)` 与方案标题 / 摘要组装合同后调用 `createContractWithAdmission(..., { confirmationId })`。
  4. `src/lib/journey/confirm-scheme-atomic.ts`：`persistSnapshot` 抛出 `409 E_SCOPE_PLAN_DRIFT` 时，事务结果码为 `E_SCOPE_PLAN_DRIFT`，执行 `restoreRightChat`（右栏解锁），**不进入** `SIGN_AND_PREPARE`；调用方用响应附带的新 plan 刷新 `scopePlan` 并显示 SSOT §16.3 白话「项目刚刚有变化，我重新核对了改动范围，请再看一眼」。
  5. `formatSchemeAsIntent` 如无其他调用点则删除；有则保留并在 PR 中列出调用点。
* **非目标**：不做范围 UI 区块（J.6，本卡中栏只多一行状态文案）；不改交接进度 UI（J.7）。
* **验收（PASS）**：
  - `tests/unit/confirm-scheme-atomic.test.ts` 新增 `T-ATOM-012`：`persistSnapshot` 抛 `E_SCOPE_PLAN_DRIFT` → 结果码 `E_SCOPE_PLAN_DRIFT`、`signAndPrepare` 调用 0 次、`restoreRightChat` 调用 1 次。
  - `tests/ui/task-c22-confirm-wiring.test.tsx` 新增 `T-UI-011`～`T-UI-013`：预检未返回时按钮不可点且显示「正在核对要改哪些地方…」；预检返回合规 plan 后可点；点击后 `createContractWithAdmission` 收到的 `writable_paths` 与 plan 一致、且**未**调用 `submitJourneyMessage`。
  - J.4 的集成测试继续通过；`T-UI-001`～`010` 不回归（夹具补合规 plan）。
* **FAIL**：确认链任何一步仍从意图文本推断范围；或 drift 后右栏保持锁定。
* **关键文件**：`src/routes/index.tsx`、`src/lib/journey/confirm-scheme-atomic.ts`、`src/lib/daemon-api.ts`、`tests/ui/task-c22-confirm-wiring.test.tsx`、`tests/unit/confirm-scheme-atomic.test.ts`
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证。网关写范围：确认链改用冻结 `ScopePlan` 建合同，删除事务前聊天推断；对齐 INV-SEAL-01（禁 `buildL0Plan(chat)` 签署用法）。
* **估算**：M

<a id="task-j.6"></a>

#### 【Task J.6】中栏《改动范围与验收方式》区块 `[COMPLETED]`

> **ADR-0014 修订（2026-10-30，审阅后置）**：开工前**不展示**路径与区域调整控件。区块在开工前只显示三行白话：「这次大概改 N 处、不碰 M 处」「怎么算做完」「预计多大」；如有敏感项，再显示「含 N 处敏感改动」与「不碰这些，其余照做」按钮。范围 `2` 中「会改动的地方 / 这次不会碰」的完整清单，后置到试玩验收幕**只读**展示，与证据并列。范围 `3` 的「不要改这里」按钮删除：签署后范围已冻结，用户对范围的异议走 supervisor §16.7「这里不对」，或在右栏说出来，按 §16.5 C 类进入下一份合同。验收用例同步调整：开工前页面不含区域级按钮；验收幕清单只读。

* **任务编号**：`TASK-J.6`
* **任务名称**：`ScopeAcceptanceBlock` 白话呈现与用户表态
* **对应规格**：SSOT 第三部分 §15.2、§15.4；§18 `S2-08`
* **前置依赖**：`TASK-J.5`
* **优先级**：P1
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#11](https://github.com/he18718143986-design/IDE/pull/11) / tip `a9d7cb2`（`feat(J.6): 中栏改动范围与验收白话区块`）
* **一句话目标**：用户在点「确认开工」之前，用三行白话看清改动概览（大概改 N 处、不碰 M 处、怎么算做完、预计规模）；如有敏感项，显示白话敏感项与「不碰这些」按钮；具体路径树与命令明细后置到试玩验收幕只读展示。
* **范围**：
  1. 新建 `src/components/studio/ScopeAcceptanceBlock.tsx`，插入 `SchemeReviewPane` 的决议区之后、「生成 Demo」之前（SSOT §15.2 顺序）。
  2. [ADR-0014 / SA-1 条款级重写] 开工前仅展示三行白话概览：1) 改动概览（大概改 N 处、不碰 M 处；不展示路径树与区域按钮）；2) 验收方式（怎么算做完）；3) 预计规模（预计多大）。如有用户点名的敏感项，展示「含 N 处敏感改动：<白话名>」与「不碰这些，其余照做」按钮。原设计的完整清单与路径树后置到验收幕只读展示。原设计的「每项『可以/不行』」物理废止删除。
  3. [ADR-0014 / SA-1 条款级重写] 物理删除「不要改这里」与逐项「可以/不行」按钮；仅保留「不碰这些，其余照做」按钮（以 `excluded_area_ids` 重新预检，将敏感项移入 `never_touch`）。「确认开工」点击时通过 `applyScopeDecisions` 一并记录授权并提交。
  4. `E_SCOPE_POLICY` 时，区块顶部显示谓词返回的白话说明；`E_SCOPE_APPROVAL_REQUIRED` 时，点「确认开工」提示敏感项未授权并展开查看。
  5. 方案冻结后区块只读，表态按钮隐藏。
* **非目标**：不接意图编译器的 `acceptance[]`（第二批）；不提供手写 glob 输入框（SSOT §15.4 明确禁止）。
* **验收（PASS）**：新增 `tests/ui/scope-acceptance-block.test.tsx`（对应 SSOT `S2-08`）：
  - 渲染开工前三行白话概览；开工前不含路径树及区域级按钮。
  - 文案中不出现 `token`、`tool`、`**`、`glob`（大小写不敏感）。
  - 点「不碰这些，其余照做」→ 以 `excluded_area_ids` 触发预检；开工点击 → 一键授权敏感项并带 `plan_digest` 提交。
  - `manual_only` 夹具显示「没有自动检查」提示。
  - 冻结态与验收幕下清单完整且只读。
  - `tests/ui/task-c18-scheme-single-pane.test.tsx` 与 `task-c22` 不回归。
* **FAIL**：区块显示技术单位或原始合同 JSON；或用户表态未进入预检。
* **关键文件**：`src/components/studio/ScopeAcceptanceBlock.tsx`（新）、`src/components/studio/SchemeReviewPane.tsx`、`src/routes/index.tsx`
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围（纯中栏呈现与敏感项旁路 UI；写范围仍以预检 `ScopePlan` 为准）。
* **估算**：M

<a id="task-j.7"></a>

#### 【Task J.7】交接三步进度与右栏解锁（施工对话过渡态） `[COMPLETED]`

> **ADR-0014 / DEC-005 修订（2026-10-30）**：范围 `3` 的「插入系统消息」改为**中栏画布**卡片，右栏不出现任何 Supervisor 消息；范围 `4` 输入框上方的提示同样移到画布。验收用例「系统消息含节点数」改为「画布卡片含节点数，右栏消息列表无新增系统消息」。

* **任务编号**：`TASK-J.7`
* **任务名称**：「确认方案」交接 UI + COMMIT 后右栏解锁
* **对应规格**：SSOT 第三部分 §16.3、§17 D9；§18 `J-02`；§19 `L-05`
* **前置依赖**：`TASK-J.1`（**硬依赖**：右栏未只读前不得在施工期解锁）、`TASK-J.5`
* **优先级**：P1
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#13](https://github.com/he18718143986-design/IDE/pull/13) / tip `67d7605`（`feat(J.7): 交接三步进度与右栏解锁`）
* **对照痛点（代码事实）**：交接成功后 `setSchemeChatLocked(true)` 一直保持，只有「新建需求」解锁（`src/routes/index.tsx`）；冻结后的输入会被 `rebuildSchemeFromCorpus` 静默丢弃。
* **一句话目标**：点击确认后用三步人话进度替代「假死」；成功后右栏立即恢复可用，且冻结后的消息绝不写进方案。
* **范围**：
  1. 「确认方案」按钮原地切换为三步进度（SSOT §16.3 线框）：「保存你确认的方案」对应 `CLAIM_AND_QUIESCE`～`FREEZE_SNAPSHOT`；「准备隔离的施工区」对应 `SIGN_AND_PREPARE` 的建合同与批准；「安排施工步骤」对应建任务图。`runConfirmSchemeAtomic` 增加可选 `onStage(stage)` 回调驱动进度。
  2. 交接期间右栏输入框禁用，占位文案「正在交接，几秒后可以继续聊」。
  3. [ADR-0014 / DEC-005 条款级重写] `COMMIT` 成功 → 右栏**解锁**；中栏画布展示卡片「开工了。一共 N 步…你可以离开，做完或需要你的时候我会提醒你。」（N = 任务图节点数；时长估算取 `ScopePlan.budget.plain`）。严禁向右栏注入任何系统消息。
  4. [ADR-0014 条款级重写] 右栏保持纯净自由对话输入，中栏画布展示过渡态提示；严禁在右栏输入框上方硬编码注入提示。
  5. 失败分支：回到方案态并解锁（沿用既有 `restoreRightChat`）；仅 `E_COMPENSATION_FAILED` 保持锁定并显示「这次准备没清理干净，需要你手动处理」与诊断入口。
* **非目标**：不做四类分流卡片（第二批）；不做施工幕 UI（第二批）。
* **验收（PASS）**：新增 `tests/ui/journey-handoff.test.tsx`（对应 SSOT `J-02`）：
  - 点击后依次出现三步进度，交接期间输入框 `disabled`。
  - 成功后输入框可用；画布卡片含节点数，右栏消息列表新增系统消息数为 0。
  - 冻结后发送一条消息：搭档发送函数被调用 1 次，`rebuildSchemeFromCorpus` 调用 0 次，方案 `scheme_revision` 不变。
  - `E_SIGN_AND_PREPARE_FAILED`（补偿成功）→ 解锁；`E_COMPENSATION_FAILED` → 保持锁定并显示诊断入口。
  - `tests/ui/supervisor-studio-approval.test.tsx`、`task-c22` 不回归。
* **FAIL**：成功后右栏仍锁定；或冻结后的消息改变了方案、合同或任务图。
* **关键文件**：`src/routes/index.tsx`、`src/lib/journey/confirm-scheme-atomic.ts`、`src/components/studio/SchemeReviewPane.tsx`、`src/components/AgentChatPane.tsx`
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围（交接 UX + 右栏解锁；解锁不改变 partner 工具权限，仍受 J.1 只读约束）。
* **估算**：M

<a id="task-j.8"></a>

#### 【Task J.8】`JourneyStage` 投影与广播 `[COMPLETED]`

* **任务编号**：`TASK-J.8`
* **任务名称**：四幕状态由 Daemon 投影并随 `STATE_CHANGED` 下发
* **对应规格**：SSOT 第三部分 §16.2 映射表、§17 D8；§18 `J-01`；§19 `L-08`（呈现层）、`L-10`
* **前置依赖**：无（可与主链并行）
* **优先级**：P1
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#10](https://github.com/he18718143986-design/IDE/pull/10) / tip `b90241e`（`feat(J.8): JourneyStage 投影与 STATE_CHANGED 广播`）
* **对照痛点（代码事实）**：前端在 `index.tsx` 中自行组合合同、图谱与预览状态决定显示什么；`DELIVERY_STATES` 仍含 ADR-0012 已废止的 `DELIVERED`。
* **一句话目标**：用户可见的「当前在哪一幕、幕内什么子态」只有一个来源——Daemon 按规格映射表算出并广播；前端只消费，不推导。
* **范围**：
  1. 新建 `src/lib/state/journey-stage.ts`（纯函数）：`JourneyStage = "scheme" | "construction" | "playtest" | "merged" | "aborted"`，`JourneySubstate` 按 SSOT §16.2 表每一行一个枚举值；`projectJourneyStage({ delivery_state, transient, lifecycle_state, presentation_state, has_contract })` → `{ stage, substate, warning? }`。表外组合 → `{ stage: "construction", substate: "waiting_for_you", warning: "UNMAPPED_COMBINATION" }`。`DELIVERED` 投影为 `merged` 并附 `archived: true`（呈现层收口 `L-08`；**本卡不删枚举**，删除枚举另立卡并评估迁移）。
  2. `src/lib/ipc/frames.ts::StateChangedPayload` 增加可选 `journey_stage`、`journey_substate`、`journey_archived`。
  3. `daemon/state/presentation-projector.ts` 在生成 `STATE_CHANGED` 时调用投影并填充；投影返回 `warning` 时写一条 `daemon.jsonl` 告警（沿用 C.17 日志）。
  4. 前端只把字段存进状态，**本卡不改任何界面**（四幕外壳在第二批）。
* **非目标**：不改 `DELIVERY_TRANSITIONS`；不做四幕 UI；不删 `DELIVERED`。
* **验收（PASS）**：新增 `tests/unit/journey-stage-projection.test.ts`（对应 SSOT `J-01`）：
  - 表驱动：SSOT §16.2 每一行至少一条用例，断言 `stage` 与 `substate`。
  - 表外组合（如 `MERGED` + `EXECUTING`）→ `waiting_for_you` + `UNMAPPED_COMBINATION`。
  - `DELIVERED` → `merged` 且 `archived === true`。
  - `tests/integration/presentation-state-wiring.test.ts` 补断言：`STATE_CHANGED` 帧携带 `journey_stage`；既有断言不回归。
* **FAIL**：前端新增任何基于底层状态组合推导幕次的代码；或映射表有行缺测试。
* **关键文件**：`src/lib/state/journey-stage.ts`（新）、`src/lib/ipc/frames.ts`、`daemon/state/presentation-projector.ts`、`src/lib/state/delivery-state.ts`（只读复用 `projectDeliveryState`）
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围（本卡只做 `JourneyStage` 投影与广播，不改门禁）。
* **估算**：S

<a id="task-j.9"></a>

#### 【Task J.9】SchemePatch 零模型确定性合并引擎 `[COMPLETED]`

* **任务编号**：`TASK-J.9`
* **任务名称**：编译器补丁的确定性合并、证据锚定与墓地复活判定（纯函数）
* **对应规格**：SSOT 第三部分 §14.2、§14.3、§14.11（`INV-LEDGER-01～03`）；§18 `V-01`～`V-04`、`V-10`～`V-13`。**实施口径**：[`scheme-patch-engine.md`](./scheme-patch-engine.md)（与 SSOT 冲突时以 SSOT 为准）
* **前置依赖**：无硬依赖（纯函数，可立即开工）。合并成功后触发范围预检的接线在 `TASK-J.10`，届时依赖 `TASK-J.2`
* **优先级**：P1（闭环 v2.1 第二批首卡；`J.10` 硬依赖本卡）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#12](https://github.com/he18718143986-design/IDE/pull/12) / tip `1ad6eab`（`feat(J.9): SchemePatch 零模型确定性合并引擎`）
* **对照痛点（代码事实）**：方案今天由 `src/lib/journey/scheme-draft.ts` 的 `MODULE_HINTS` 正则启发式整份生成，没有补丁、没有证据、没有 pin 合并规则，也没有墓地；SSOT §14.3 的合并表与 §14.11 的不变式在代码里 0 命中。
* **一句话目标**：给定当前台账状态、编译器补丁与只读对话记录，引擎零模型地算出「整补丁冻结 / 拒绝 / 过期」或「逐 op 写入 / 出卡 / 丢弃」，同样输入永远得到逐字节相同的输出。
* **范围**：
  1. 新建 `src/lib/journey/scheme-patch-types.ts`：类型、zod Schema、码表（`PATCH_CODES` / `OP_CODES` / `SUGGESTION_KINDS` / `WARNING_CODES`）与常量（实施口径 §5.2、§5.3）。
  2. 新建 `src/lib/journey/evidence-anchor.ts`：`normalizeForAnchor`（CRLF、零宽、按字素 NFKC、空白折叠、去首尾）、`anchorQuote`（全部出现位置、短引用整句边界、默认取最后一处、原文偏移映射）（实施口径 §3）。
  3. 新建 `src/lib/journey/graveyard-revival.ts`：墓碑指纹、`matchesTombstone`（id / key / Dice ≥ 0.75）、`judgeRevival`（R0～R9 三值判定）、`buildTombstone`、`migrateGraveyardEntry`（实施口径 §4）。
  4. 新建 `src/lib/journey/scheme-patch-engine.ts`：`mergeSchemePatch` 及其 `stage*` Pipeline；配套 `applyUserEdit`、`undoLastPatch`、`acceptSuggestion`、`rejectSuggestion`、`rejectItemToGraveyard`、`expireSuggestionsOnFreeze`、`auditLedgerState`、`projectEvidenceLedger`（实施口径 §2、§5.4～§5.6）。
  5. 四个文件零 `node:*` 导入、零时钟、零随机数、零网络；id 由 `ctx.newId` 注入。
* **非目标**：不接真模型、不做防抖与预算（`J.10`）；不改 `scheme-draft.ts` 现行启发式（`J.10` 降级为离线兜底）；不做 `renderSchemeDiagrams`（`J.9b`）；不做 Worker 产出物墓地门禁；不做冻结后回写补丁（`INV-LEDGER-04`，`J.16`）；不改任何 UI；不向 `src/lib/error-codes.ts` 的 `ERROR_CODES` 增码（实施口径 K-9）。
* **验收（PASS）**：实施口径 §6 测试矩阵全部用例通过，具体为：
  - `tests/unit/evidence-anchor.test.ts`：Q-01～Q-23 全部判例，锚点偏移逐字段相等。
  - `tests/unit/graveyard-revival.test.ts`：R-01～R-17 与 TM-Y-18～30。
  - `tests/unit/scheme-patch-merge.test.ts`：TM-G（含 144 组笛卡尔积对拍）、TM-P、TM-S、TM-C、TM-X、TM-A、TM-R、TM-D、TM-L、TM-E。
  - `tests/unit/scheme-patch-precedence.test.ts`：TM-Z 14 组对拍 + TM-Z-13～15；对拍神谕由第二人按实施口径 §2.3 表格独立编写。
  - `npm run typecheck` 相对基线无新增；`npm run lint` 0 error。
* **FAIL**：任一 op 在证据不合格时被部分应用；墓地命中的内容以覆盖建议卡形式出现在用户面前（Z-04）；一次成功合并使修订号增加超过 1；同一输入两次调用结果不同；引擎源码出现 `node:` 导入、`Date.now`、`Math.random` 或网络调用。
* **关键文件**：`src/lib/journey/scheme-patch-types.ts`（新）、`src/lib/journey/evidence-anchor.ts`（新）、`src/lib/journey/graveyard-revival.ts`（新）、`src/lib/journey/scheme-patch-engine.ts`（新）、`tests/helpers/scheme-patch-fixtures.ts`（新）
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围（纯函数 `SchemePatch` 合并引擎；不触签署/Gateway）。
* **估算**：M
* **备注**：`runtime-contract-and-safety.md` §8 L3 行的门禁层拒绝码无 §2.3 式闭集。`E_CHECKPOINT_FAILED`（`daemon/server.ts` 两处 catch，Daemon HTTP 层以 409 直接返回）与 `E_WRITABLE_SCOPE_POLICY`（类 `WritableScopePolicyError` 定义于 `daemon/supervisor/scope-gate.ts`）均未登记入 `ERROR_CODES`；待派工门禁产出证据归因时统一补登，不在本卡范围。注意 `E_SCOPE_POLICY`（§2.3 表内，v2.1）与 `E_WRITABLE_SCOPE_POLICY` 是两个不同的码，仅名字相近。
* **待定风险（K-12）**：确认路径（`mark_user_confirmed`，§3.4 / §5.3）同样接受编译器 `occurrence`，存在同型洗白面（「我同意。算了不同意」+ `occurrence: 0`）。复活路径已由 K-12 修复；确认路径修法待定，落地前不得把「待定」读成「无问题」。J.11 金标须含此类对抗样本。

<a id="task-j.10"></a>

#### 【Task J.10】意图编译器生成端与 Daemon 编译循环 `[COMPLETED]`

> **ADR-0014 / DEC-004 修订（2026-10-30）**：删除范围 `5`（`partner-hint-filter.ts`）及生成 Schema 中的 `partner_hint` 字段；编译器输出不得回流到右栏。编译器实现形态开放（单次结构化调用即可），`compile-loop.ts` 对模型的依赖经可替换接口注入。intent-compiler-prompt §5 的 partner_hint 设计作废，以本修订为准。

* **任务编号**：`TASK-J.10`
* **任务名称**：编译器 System Prompt、生成 Schema、输出组装与编译循环
* **对应规格**：SSOT 第三部分 §14.4～§14.8、§14.10；§18 `V-05`、`V-06`、`V-09`；§19 `L-01`、`L-07`。**实施口径**：[`intent-compiler-prompt.md`](./intent-compiler-prompt.md)（与引擎 [`scheme-patch-engine.md`](./scheme-patch-engine.md) 冲突时以引擎为准）
* **前置依赖**：`TASK-J.9`（硬：引擎）；合并成功后触发范围预检依赖 `TASK-J.2`
* **优先级**：P1
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#17](https://github.com/he18718143986-design/IDE/pull/17) / tip `97bb0db`（`feat(J.10): 意图编译器生成端与 Daemon 编译循环`）
* **一句话目标**：用户发消息后 1.2 秒，编译器在结构化输出约束下产出补丁，经组装送进引擎；结构层让近一半（21/47）的引擎码不可能被触发（注：`47` 为定稿时口径，现行引擎码表 51 码，待按 51 重算，见 `consistency-audit.md` OP-15），其余由提示词纪律降低、由引擎兜底。
* **范围**：
  1. `src/lib/journey/compiler-output-schema.ts`：按消息别名、本批别名、现有 id、墓碑 id 动态构造 zod Schema；`assembleCompilerOutput`（别名 → `turn_id`、摘录 qid 展开、`new:` id 替换、代填 `base_revision` 与 `compiled_from_turns`；失败映射 `E_PATCH_SCHEMA_INVALID` 并记子原因）。
  2. `daemon/supervisor/intent-compiler/system-prompt.ts`：实施口径 §6.2 骨架 + §6.5 八条 few-shot；`COMPILER_PROMPT_VERSION`。
  3. `daemon/supervisor/intent-compiler/render-input.ts`：实施口径 §6.3（nonce 标签、N1～N3 预规范化、AI 回复无别名、墓碑只注入是什么与为什么）。
  4. `daemon/supervisor/intent-compiler/compile-loop.ts`：实施口径 §7（防抖、单在途、只重试 STALE 一次、CAS 落盘、三次失败提示、预算账本、离线兜底）。
  5. [ADR-0014 / DEC-004 已废止] 物理删除 `partner-hint-filter.ts` 及生成 Schema 中的 `partner_hint` 字段；编译器输出严禁回流到右栏，保持右栏无系统提示与暗中注入。
  6. `demoReady` 改判（§14.10）。
* **非目标**：不改引擎；不做金标评测脚本（J.11）；不把搭档与编译器合并成一次调用（实施口径 §5.1 已否决）。
* **依赖与风险**：GAP-1（聊天否决不入墓）、GAP-2（墓碑命中不看 `revival_keys`）已由 J.9a 增补关闭，见 `supervisor.md` §14.11 K-10、K-11。
* **验收（PASS）**：
  - `tests/unit/compiler-output-schema.test.ts`：S 类码在组装后不可能出现（逐码构造非法模型输出，断言组装期拒绝）；qid 展开、`new:` 替换、代填字段正确。
  - `tests/unit/compiler-render-input.test.ts`：同一状态两次渲染逐字节相同；AI 回复无别名；nonce 出现在边界标签；墓碑不含 `revival_keys`。
  - `tests/unit/intent-compiler-trigger.test.ts`（`V-05`）：空闲计时与 AI 回复完毕触发模型调用计数为 0。
  - `tests/unit/compile-loop.test.ts`：桩模型重放实施口径 §8.2 ADV-26～28，断言重试次数、批次游标与失败计数。
  - `tests/eval/intent-compiler-adversarial.test.ts`：以对抗补丁回放 ADV-01～29 喂引擎，断言 `expected_engine`（确定性，可进 CI）。
  - `tests/ui/intent-compiler-offline.test.tsx`（`V-06`）。
* **FAIL**：生成 Schema 允许 `occurrence`、`anchor`、`user_confirmed`、`edit` 证据任一出现；模型输出 `base_revision` 或 `compiled_from_turns` 并被采信；op 级丢弃触发重试；提示词出现引擎词表或阈值。
* **关键文件**：见范围 1～4（范围 5 已废止）
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围。本卡只做意图编译生成端与 Daemon 编译循环（产出 `SchemePatch` → 引擎）；编译结果须经 [ADR-0018](../adr/0018-intent-to-executable-seal.md) 密封进入签署，**禁止**确认路径用聊天直推 `ScopePlan`/`buildL0Plan(chat)`；输出不得回流右栏（DEC-004）。不放宽 Gateway `writable_paths`。
* **估算**：M

<a id="task-j.18a"></a>

#### 【Task J.18a】G-MATCH 纯函数与产出物投影 `[COMPLETED]`

* **任务编号**：`TASK-J.18a`
* **任务名称**：墓地匹配单一实现、别名表与产出物投影（纯函数层）
* **对应规格**：SSOT §14.11 第 5 小节 G-MATCH；[`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §2、§4.1～§4.3、§6.1～§6.2（`graveyard-match` / `artifact-*`）、§7.2～§7.3；[`scheme-patch-engine.md`](./scheme-patch-engine.md) §4.2～§4.3（墓碑指纹，只读复用）
* **前置依赖**：`TASK-J.9`（硬：`graveyard-revival.ts` / 墓碑结构与 `matchesTombstone` 语义）
* **优先级**：P1（M3 墓地）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#24](https://github.com/he18718143986-design/IDE/pull/24) / tip `20c2d46`（`feat(J.18a): G-MATCH 纯函数、别名表与产出物投影`）
* **对照痛点（代码事实）**：
  - 墓地匹配公式散落在引擎侧；门禁侧尚无 `G-MATCH` 唯一实现文件（`graveyard-match.ts` 0 命中）。
  - 无「新增行多重集差」与 GateUnit 投影；无法把 Worker 完整文件内容变成强/弱判定单元（F-1、F-7）。
  - 无版本化 `ALIAS_LEXICON`；别名对抗（mongoose ↔ mongodb）无处落。
* **一句话目标**：同一自然语言文本经引擎投影与门禁 `U-NL` 投影得到逐位相同的 (b)(c)(d)；同一代码产出物投影出可复现的 GateUnit 列表。
* **范围**：
  1. 新建 `src/lib/journey/graveyard-match.ts`：导出 `matchNormalize`、`lexemes`、`dice`、`matchesTombstoneText`、`artifactKeys`、`codeTokens`、`matchArtifactUnit`；常量 `GRAVEYARD_DICE_THRESHOLD`、`CODE_STOPLIST`（签名见实施口径 §6.2）。
  2. `evidence-anchor.ts`：**再导出**上述 NL 原语，保持引擎既有导入路径有效；禁止第二份实现。
  3. 新建 `src/lib/journey/artifact-alias-lexicon.ts`：`ALIAS_LEXICON`、`ALIAS_LEXICON_VERSION`（实施口径 §2.4 表）。
  4. 新建 `src/lib/journey/artifact-projection.ts`：`addedLines`、`projectArtifact`、`projectCommand`、`projectText` 与 `GateUnit` 类型。
  5. 共享夹具 `tests/fixtures/graveyard-match/cases.json`（`nl_cases` + `code_cases`）；引擎 TM-Y 可后续同消费。
  6. 单测：`tests/unit/graveyard-match-conformance.test.ts`（TM-GM）、`tests/unit/artifact-projection.test.ts`（TM-GU）。
* **非目标**：不接线 Daemon / Gateway / CLI；不改合同 Schema；不做 `evaluateGraveyardGate`；不登记 `E_PROPOSAL_PREVIOUSLY_REJECTED`。
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围。本卡只新增纯函数与夹具，不触达写盘门禁。
* **验收（PASS）**（均可翻成 `it(...)`）：
  - TM-GM-01～07：`cases.json` 的 `nl_cases` 经引擎投影与门禁 `U-NL` 的 (b)(c)(d) 逐位相等；Dice 0.75/0.74；`graveyard-match.ts` 之外出现墓地阈值字面量 `0.75` → 失败。
  - TM-GU-01～12：`package.json` / npm 别名 / 行移动 / requirements / go.mod / 安装命令 / 新路径 / 注释行 / `\r\n` 归一等投影结果与实施口径 §7.3 表一致。
  - `npm run typecheck` 相对基线无新增；`npm run lint` 0 error。
* **FAIL**：引擎与门禁对同一自然语言文本的匹配结果不同；`graveyard-match.ts` 之外出现第二份墓地匹配逻辑；弱通道（注释）产出 `U-IDENT` 强单元。
* **关键文件**：`src/lib/journey/graveyard-match.ts`（新）、`artifact-alias-lexicon.ts`（新）、`artifact-projection.ts`（新）、`evidence-anchor.ts`（再导出）、`tests/fixtures/graveyard-match/cases.json`（新）、上述两单测文件
* **估算**：M

<a id="task-j.18b"></a>

#### 【Task J.18b】合同 `scheme_binding` 与快照墓地权威源 `[COMPLETED]`

* **任务编号**：`TASK-J.18b`
* **任务名称**：GAP-W1 / GAP-W2——把确认身份与冻结墓地写入合同与快照
* **对应规格**：[`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §3.4、§8 GAP-W1/W2；SSOT §14.11「冻结后以快照为唯一权威」；`runtime-contract-and-safety.md` §1、§2；J.4 快照 1.1 基线
* **前置依赖**：`TASK-J.4`（硬：`plan_digest`、`E_SCHEME_SNAPSHOT_MISMATCH`、快照 1.1 含 `scope_plan`）；`TASK-J.9`（硬：墓地条目结构可供冻结）
* **优先级**：P1（M3 墓地）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#22](https://github.com/he18718143986-design/IDE/pull/22) / tip `ca9ed8f`（`feat(j18b): scheme_binding 合同字段与快照 schema 1.2 墓地权威源`）
* **对照痛点（代码事实）**：
  - `confirmation_id` 只在 `POST /api/contracts` / `/approve` 请求体出现，**不写入合同**（F-8）→ 派工无从回到快照（GAP-W1）。
  - 冻结快照只含方案 / Demo /（J.4 后）`scope_plan`，**不含 `graveyard`**（F-11）→ GAP-W2。
* **一句话目标**：带 `confirmation_id` 建出的合同永久带有不可改的 `scheme_binding`；对应快照升到 1.2 且含冻结时完整墓地，派工侧可读到权威墓碑列表。
* **范围**：
  1. `src/lib/contract.schema.ts`：合同新增可选 `scheme_binding = { confirmation_id, snapshot_digest, plan_digest }`；签署后不可改（既有「改合同本身」禁止不变）。
  2. 建合同路径（J.4 按快照建合同处）：带 `confirmation_id` 且校验通过后写入 `scheme_binding`。
  3. `scheme-snapshot-store.ts`（及快照类型）：快照版本升 **1.2**，增加 `graveyard`（冻结时完整墓地，含 revived）及其 digest 字段；读 1.1 时行为保持兼容，但派工侧对无墓地的 1.1 按「版本过旧」处理（口径见实施口径 TM-GB-05，本卡交付快照读写与 digest；绑定失败语义由 `J.18c` 断言）。
  4. 单测：合同 Schema 往返；建合同写入 `scheme_binding`；快照 1.2 读写含 `graveyard`；篡改 digest 可被检测（哈希不等）。
* **非目标**：不实现 `verifyDispatchBinding` / gate pack（`J.18c`）；不接线写路径（`J.18d`）；不改签署期 `E_SCOPE_PLAN_DRIFT` 语义。
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证；**不改变** Gateway 物理路径写范围。本卡只扩展合同可选字段与快照内容，不放宽任何写盘门禁。
* **验收（PASS）**：
  - 带 `confirmation_id` 的建合同响应/落盘合同含 `scheme_binding` 三字段，且与所用快照 digest / `plan_digest` 一致。
  - 冻结快照 `version === "1.2"`（或项目既有版本字段等价表示）且含 `graveyard` 数组；digest 随墓地内容变化。
  - 1.1 旧快照仍可读取；写入路径对新确认产出 1.2。
  - 签署后尝试改写 `scheme_binding` 被拒绝（或 Schema/运行时断言失败）。
  - `npm run typecheck` / `lint` 相对基线无新增 error。
* **FAIL**：派工仍只能从请求体猜 `confirmation_id`；快照无墓地却被当成权威源；旧直签合同被强制写入假 `scheme_binding`。
* **关键文件**：`src/lib/contract.schema.ts`、`daemon/supervisor/scheme-snapshot-store.ts`（及 J.4 建合同接线文件）、相关单测
* **估算**：M

<a id="task-j.18c"></a>

#### 【Task J.18c】墓地门禁裁决、优先级格与派工绑定 `[COMPLETED]`

* **任务编号**：`TASK-J.18c`
* **任务名称**：`evaluateGraveyardGate` / 优先级格 / `verifyDispatchBinding` / 码表与 L3 闭集
* **对应规格**：[`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §2.5、§3、§5.3、§6.2～§6.3、§7.4～§7.7、§7.9；runtime §8 / §8.1 提案；DEC-1（K-15）
* **前置依赖**：`TASK-J.18a`、`TASK-J.18b`（均须 `COMPLETED`）
* **优先级**：P1（M3 墓地）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#26](https://github.com/he18718143986-design/IDE/pull/26) / tip `b6922ac`（`feat(J.18c): 墓地门禁裁决、优先级格与派工绑定`）
* **对照痛点（代码事实）**：无 `evaluateGraveyardGate` / `pickPrimaryVerdict` / `verifyDispatchBinding`；L3 无闭集表；`E_PROPOSAL_PREVIOUSLY_REJECTED` 未入 `ERROR_CODES`（DEC-1 待代码登记）。
* **一句话目标**：给定快照墓地与一批产出物，门禁确定性给出是否拦截、主码与全部命中证据；派工前绑定失败则不签发 `exec_token`。
* **范围**：
  1. 新建 `daemon/guard/worker-graveyard-gate.ts`：`evaluateGraveyardGate`、`pickPrimaryVerdict`、`buildGatePack`（§6.2 签名）。
  2. 新建 `daemon/guard/dispatch-binding.ts`：`verifyDispatchBinding`（读快照；bound / legacy / 失败三态）。
  3. 码表：`E_PROPOSAL_PREVIOUSLY_REJECTED` 登记入 `ERROR_CODES`（映射 `SCOPE_VIOLATION`，DEC-1）；新增 `E_GATE_SCAN_FAILED` 与门禁日志码 `W_GRAVEYARD_*` / `W_GATE_*`（§6.3；`W_*` 不进 `ERROR_CODES`）。
  4. `runtime-contract-and-safety.md` §8.1：落地 L3 执行期码闭集表（GAP-W5）。
  5. 单测：`worker-graveyard-gate.test.ts`（TM-GS、TM-GA、TM-GE）、`gate-priority.test.ts`（TM-GP 120 组 + 表列特例）、`dispatch-binding.test.ts`（TM-GB）。
* **非目标**：不改 `ai-worker` / `gateway` / `orchestrator` / `merger` / `pretool-hook` 生产接线（`J.18d`）；不做 §16.6 前端卡片 UI（可只导出供接线的结构化结果）；不在施工期提供复活通道。
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证；**不改变** Gateway 物理路径写范围与 `E_SCOPE_PLAN_DRIFT` 签署期语义。**会改变（收紧，不放宽）**：新增内容级裁决纯函数与派工绑定 API，供后续接线调用；本卡本身不把拦截挂到写盘路径。
* **验收（PASS）**：
  - TM-GS-01～08、TM-GA-01～18（含 ⚠ 残余风险的现行口径断言）、TM-GP 笛卡尔积与 TM-GP-01～06、TM-GB-01～07、TM-GE-01～09 与实施口径表一致。
  - `pickPrimaryVerdict`：强用户墓地 + 越界 → 主码墓地（P4>P5）；保护路径 + 强安全墓地 → 主码保护路径（P2>P3）；执行期主码永不为 `E_SCOPE_PLAN_DRIFT`。
  - legacy 合同 → `mode: "legacy"`，不拦截。
  - `ERROR_CODES` 含 `E_PROPOSAL_PREVIOUSLY_REJECTED`；runtime §8.1 闭集表已写。
* **FAIL**：弱证据或软墓碑导致 `block: true`；越界与墓地同时命中时主码为越界；legacy 路径静默启用活台账墓地。
* **关键文件**：`daemon/guard/worker-graveyard-gate.ts`（新）、`daemon/guard/dispatch-binding.ts`（新）、`src/lib/error-codes.ts`（或对应码表）、`docs/specs/runtime-contract-and-safety.md`、上述单测
* **估算**：M

<a id="task-j.18d"></a>

#### 【Task J.18d】写路径接线、CLI pack、全量扫描与集成 `[COMPLETED]`

* **任务编号**：`TASK-J.18d`
* **任务名称**：把墓地门禁挂到派工 / 写入 / 合并检查点，并交付 CLI gate pack 与集成证明
* **对应规格**：[`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §4.4、§5.1～§5.2、§6.4、§7.8、§7.10、§8 GAP-W3/W4/W6；SSOT §15.6、§16.6；runtime §5.2
* **前置依赖**：`TASK-J.18c`（硬）
* **优先级**：P1（M3 墓地）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#27](https://github.com/he18718143986-design/IDE/pull/27) / tip `a2fa7df`（`feat(J.18d): 墓地门禁生产写路径接线（dispatch/Worker/Gateway/CLI/扫描）`）
* **对照痛点（代码事实）**：
  - `buildWorkerTaskInstruction` 不注入墓地（F-10 / GAP-W3）。
  - CLI PreToolUse hook 只看路径不看内容（F-3 / GAP-W4）。
  - `validateChanges` / `handleWriteFile` / `POST_VERIFICATION` / `PRE_MERGE` 无墓地调用（§6.4）。
  - blockers 推送原始 `access.reason` 而非映射后 `E_*`（GAP-W6）。
* **一句话目标**：真实施工路径上，强证据命中活跃硬墓碑时写盘前或合并前停工并留下证据；弱证据只进审阅；旧直签路径明示 `unavailable` 不静默。
* **范围**：
  1. 派工：`verifyDispatchBinding` → `buildGatePack` 写入 `.stagent/claude-config/graveyard-pack.json`；`session-task-injector.ts` 注入「用户否决过的方案」白话段（只列 `proposal` / `rejection_reason`，不列 `artifact_keys`）（GAP-W3）。
  2. API Worker：`ai-worker.ts::validateChanges` 内调用 `evaluateGraveyardGate` + `pickPrimaryVerdict`；阻断则整批不写。
  3. Gateway：`handleWriteFile` 在保护清单之后调用门禁；阻断走既有 `onScopeBlocked` / `runBoundaryStop`。
  4. CLI：`pretool-hook.mjs` 读 gate pack 做集合查找（GAP-W4）；pack 缺失 → allow + `W_GATE_PACK_MISSING`。
  5. `orchestrator.ts`（`POST_VERIFICATION`）与 `merger.ts`（`PRE_MERGE`）全量扫描；扫描失败 → `E_GATE_SCAN_FAILED`。
  6. GAP-W6：blockers 改为 `scopeErrorCode` 映射后的 `E_*`。
  7. 测试：`tests/unit/pretool-hook-graveyard.test.ts`（TM-GH）；`tests/integration/worker-graveyard-gate.test.ts`（TM-GI，端口 **3950–3959**，登记于 `tests/unit/test-port-map.test.ts`）。
* **非目标**：不做语义/AST 判定；不在施工期提供复活捷径（「我改主意了」只回到方案幕流程，由引擎复活）；不修 OBS-1（`workerPid: null`）；不实现 J.15 三段式卡片完整 UI（本卡交付结构化停工与证据；卡片文案若已有通用意外卡则复用）。
* **不变声明（R-12）**：不改变：鉴权 / Demo Origin / 点亮三证；**不改变** Gateway 物理路径写范围（`writable_paths` / 既有路径门禁）与 `E_SCOPE_PLAN_DRIFT` 签署期语义。**会改变（收紧，不放宽）**：在派工 / `gateway.handleWriteFile` / 执行期校验 / `PRE_MERGE` 等检查点按墓地做**内容级**拦截；弱证据只进审阅不停工。
* **验收（PASS）**：
  - TM-GH-01～06；TM-GI-01～04（含：桩 Worker 含 mongoose → 未写盘 + `PENDING_RESUME`；绕过 hook 时 `PRE_MERGE` 拒合并；legacy + mongoose → 放行且 `graveyard_check: "unavailable"`）。
  - 派工提示含否决方案白话且不含 `artifact_keys`。
  - blockers 中的码为映射后的 `E_*`，可供 `pickPrimaryVerdict` 比较。
  - `npm run typecheck` / `lint` 相对基线无新增 error。
* **FAIL**：弱证据导致停工；软墓碑导致停工；执行期出现 `E_SCOPE_PLAN_DRIFT`；越界与墓地同时命中时用户面主码为越界；legacy 路径静默启用活台账。
* **关键文件**：`daemon/worker/ai-worker.ts`、`daemon/mcp/gateway.ts`、`daemon/pipeline/orchestrator.ts`、`daemon/pipeline/merger.ts`、`daemon/worker/cli-host/pretool-hook.mjs`、`daemon/worker/session-task-injector.ts`、上述测例与端口表
* **估算**：M

#### 第二批预告（本批合入后再细化立卡，**本条不立卡**）

| 预定编号 | 内容 | 规格 | 依赖 |
| :--- | :--- | :--- | :--- |
| ~~J.9~~ | **已立卡**（见上方【Task J.9】）：补丁协议与确定性合并。`renderSchemeDiagrams` 拆出为 J.9b | §14.2、§14.3、§14.11；V-01～V-04、V-10～V-13 | — |
| J.9b | `renderSchemeDiagrams`：三张图由结构确定性渲染 | §14.1 原则 1、§14.2 注；V-07 | J.9 |
| ~~J.10~~ | **已立卡**（见上方【Task J.10】） | §14.4～§14.8、§14.10 | J.9 |
| J.11 | 金标对话集与评测脚本。**种子**：[`intent-compiler-prompt.md`](./intent-compiler-prompt.md) §8 的 29 组对抗样例与生成端指标 | §14.9；V-08；**必含**「模块名重叠但意图不同」正反两向样本（§4.2 残余风险兜底）、确认路径 `occurrence` 洗白对抗样本（待定风险） | J.10 |
| J.12 | 用户主动暂停接口 `POST /api/contracts/:id/pause` | §16.4；L-09 | — |
| J.13 | 四幕外壳与施工幕（白话步骤、自动推进、等你确认卡） | §16.1、§16.4；J-06；L-06 | J.8、J.12 |
| J.14 | 施工对话四类分流与中栏卡片 | §16.5；J-03、J-04、J-05 | J.7、J.13 |
| J.15 | 三段式意外卡 | §16.6；J-07 | J.13 |
| J.16 | 试玩幕、对话式验收、合入与「基于这次继续」 | §16.7、§16.8；J-08～J-10 | J.13、J.14；硬依赖 J.4（快照 `scope_plan`）、**J.18b** GAP-W1（`scheme_binding`） |
| J.17 | 单页 Fast Path「直接改」 | §16.11；J-11 | J.5、J.13 |
| ~~J.18~~ | **已立卡并拆分**（母卡 `[SPLIT]` → **J.18a～J.18d**）：Worker 派工墓地门禁 | §14.11 INV-LEDGER-03、G-MATCH | J.4、J.9 → 子卡 |

> **J.17 实施硬性要求（C-3 裁决，2026-10-28）**：实施期必须交付一份可枚举的 glob 匹配规则清单，用于判定「非生产产物」，使「免 Worktree 仅限非生产产物」可在运行时强制执行。本 PR 中的最低清单（`docs/**`、`*.md`、`demos/**`、`.stagent/**`）保留为参考基线，不作为最终规则。J.17 目前仅在预告表中，尚无正式任务卡；立卡时须将本条并入其验收条款。


### 3.4d 交付全链路 · 目标能力（L 系列 · 2026-10-30 立卡）

<a id="task-l.1"></a>

#### 【Task L.1】右栏纯净化：去掉系统提示与消息前缀（DEC-004） `[COMPLETED]`

* **任务编号**：`TASK-L.1`
* **对应规格**：ADR-0014 §1；`scheme.md` conf-2、conf-4、acc-2；`ledger/README.md` DEC-004
* **前置依赖**：无
* **优先级**：P1（M2）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#9](https://github.com/he18718143986-design/IDE/pull/9) / tip `8eb6896`（`feat(L.1): 右栏纯净化去掉系统提示与前缀`）
* **对照痛点（代码事实）**：`daemon/chat/baseline-adapter.ts` 调 `streamText` 时带 `system: "你是 Stagent 右栏助手，用简体中文简洁回答。"`；`daemon/chat/session-manager.ts` 在发给右栏前用 `buildProtectionPromptNotice` 把保护清单拼在用户消息前面。
* **一句话目标**：右栏收到的内容与用户输入逐字节相同，没有任何系统提示或前缀。
* **范围**：
  1. `daemon/chat/baseline-adapter.ts`：删除 `system` 字段，`messages` 只含历史与本条用户消息。
  2. `daemon/chat/session-manager.ts`：删除对 `buildProtectionPromptNotice` 的调用，发送的 `prompt === text`。若 `buildProtectionPromptNotice` 再无调用方，连同其单测一起删除；有调用方则保留函数。
  3. `daemon/worker/cli-host/claude-code-adapter.ts`：不改行为，只加断言测试，证明 argv 不含系统提示参数。
* **非目标**：不改右栏只读工具集（J.1）；不改保护清单的物理拦截（P.1，网关仍按清单拒写）。
* **不变声明**：鉴权、Demo Origin、点亮三证、网关写范围均不变。保护清单从「提示词劝导」变为「仅物理拦截」；右栏本来就没有写工具，所以安全属性不变（ADR-0007 判定口径：删掉提示词后属性仍成立）。
* **验收（PASS）**：新增 `tests/unit/partner-purity.test.ts`：
  - `BaselineChatAdapter.run` 调用 `streamText` 时入参不含 `system`（mock `ai` 模块断言）。
  - 保护清单非空时，`session-manager` 交给适配器的 `prompt` 与用户输入全等。
  - `ClaudeCodeAdapter.buildLaunch` 的 `args` 不含 `--system-prompt`、`--append-system-prompt`。
  - `tests/integration/partner-readonly.test.ts` 与 P.1 既有用例不回归。
* **FAIL**：右栏请求中出现任何非用户撰写的文本；P.1 拦截用例变红。
* **关键文件**：`daemon/chat/baseline-adapter.ts`、`daemon/chat/session-manager.ts`、`daemon/protection/protection-list.ts`（只读核对调用方）
* **估算**：S

<a id="task-l.2"></a>

#### 【Task L.2】Worker 指令补全「你会被这样检查」 `[COMPLETED]`

* **任务编号**：`TASK-L.2`
* **对应规格**：[`verification-strategy.md`](./verification-strategy.md) §8 第 1 项
* **前置依赖**：无
* **优先级**：P1（M2）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#8](https://github.com/he18718143986-design/IDE/pull/8) / tip `16c5176`（`feat(L.2): Worker 指令「你会被这样检查」`）
* **对照痛点（代码事实）**：`daemon/worker/session-task-injector.ts::buildWorkerTaskInstruction` 只用 `verification_spec.commands` 决定是否暴露执行工具（约 L227），不把命令写进指令。
* **一句话目标**：Worker 指令里原样列出验证命令与期望退出码。
* **范围**：
  1. `buildWorkerTaskInstruction` 在「输出契约」之前新增一段「你会被这样检查」：逐条列出 `alias`、`executable` + `args` 拼成的 argv 字符串、`expected_exit_code`。
  2. 命令为空且声明了 `manual_confirmation` 时，输出「本合同没有自动检查，完成后由用户人工确认」。
  3. 导出 `renderChecksSection(contract, extras?: string[])`，供 L.4（分段义务）与 L.12（知识库规则）追加条目，本卡只实现 `extras` 为空的情形。
* **非目标**：不列测试义务（L.4）；不列知识库规则（L.12）；不改判卷与执行工具暴露规则。
* **不变声明**：判卷仍由 Daemon 按退出码派生（ADR-0005）。
* **验收（PASS）**：新增 `tests/unit/worker-instruction-checks.test.ts`：
  - 两条命令的合同 → 指令包含两条 argv 字符串与期望退出码，且位于「输出契约」之前。
  - 无命令 + `manual_confirmation` → 指令含人工确认句，不含命令列表。
  - `renderChecksSection(contract, ["X"])` 输出包含 `X`。
  - `tests/unit/worker-adapter.test.ts` 不回归。
* **FAIL**：指令列出的命令与合同不一致。
* **关键文件**：`daemon/worker/session-task-injector.ts`
* **估算**：S

<a id="task-l.3"></a>

#### 【Task L.3】测试义务：合同元数据、`ScopePlan` 系统范围、证据字段与 `stagent check` `[COMPLETED]`

* **任务编号**：`TASK-L.3`
* **对应规格**：[`verification-strategy.md`](./verification-strategy.md) §2、§3.1、§3.4、§3.5、§5；[`delivery-lifecycle.md`](./delivery-lifecycle.md) §6；`scheme.md` acc-7
* **前置依赖**：`TASK-J.2`（`buildScopePlan`）、`TASK-J.4`（按快照建合同）
* **优先级**：P1（M2）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#15](https://github.com/he18718143986-design/IDE/pull/15) / tip `b4e0091`（`feat(L.3): 测试义务、系统范围与 stagent check`）
* **对照痛点（代码事实）**：
  - 合同 `intent.acceptance_criteria` 是无 id、无 `check` 的 `string[]`（`src/lib/contract.schema.ts` 约 L443），无法派生测试义务。
  - `supervisorMetadataSchema`（约 L278）是非 strict 的 zod 对象，未知键在解析时被剥掉。
  - 两处 refine 只对「当前版本」生效（约 L520-534），一旦升版，1.3.1 合同的 `manual_confirmation` 与 git 字段校验会失效或误拒。
  - `reasonCodeSchema` 是 9 值闭集（`src/lib/evidence.schema.ts` L26）。
* **一句话目标**：合同能追溯到方案验收条目；义务测试的写范围与运行命令在签署前进入 `ScopePlan`；义务结论由真实进程退出码给出。
* **采用的默认值**：L.11 上线前，义务测试路径为 `tests/stagent/<acceptance_id>.test.<ext>`（`ext` 取项目主语言：`ts` / `js` / `py` / `go`）。
* **范围**：
  1. `src/lib/contract.schema.ts`：
     - `supervisor_metadata` 增加可选 `acceptance_refs: { id, text, check: "auto" | "playtest" | "both" }[]`、`scheme_item_ids: string[]`、`stub_id: string | null`；
     - `SOFTWARE_CONTRACT_SCHEMA_VERSION` 升为 `"1.3.2"`；
     - 把两处「仅当前版本」的 refine 改写为版本集合判断（1.3.0 / 1.3.1 / 1.3.2 行为保持现状）。
  2. J.4 的按快照建合同处：从快照方案的 `acceptance[]` 与合同桩填充上述字段。
  3. 新建 `src/lib/verification/obligations.ts`（纯函数）：
     - `detectRunner(repoFacts) → { kind: "vitest" | "jest" | "pytest" | "go" | null, reportArgs: string[] }`；
     - `deriveObligations(contract, runner) → { obligations: TestObligation[], waived: { acceptance_id, reason: "no_runner" }[] }`；
     - `obligationCommand(runner, paths) → argv`（vitest `--reporter=json`、jest `--json`、pytest `--junitxml=<file>`、go `test -json`）；
     - `classifyRun(report) → "red" | "red_invalid" | "green"`。规则：收集到 ≥1 个用例且 ≥1 个断言失败才算 `red`；收集或编译错误算 `red_invalid`。
  4. `scope-plan-builder.ts`（J.2）增加系统贡献 `withSystemScope(plan, ctx)`：
     - 方案含 `check: auto/both` 条目且 `detectRunner` 非空时，加入写范围 `tests/stagent/**`；
     - 加入义务命令，以及 `stagent check obligations` / `stagent check test-integrity` 两条验证命令（argv 精确，进入 `allowed_commands` 与 `plan_digest`）。
  5. `src/lib/evidence.schema.ts`：
     - `EvidenceBundle` 增加可选 `obligations: { acceptance_id, test_path, red, green }[]`；
     - `reasonCodeSchema` 增加 `OBLIGATION_NOT_RED`、`OBLIGATION_RED_INVALID`、`OBLIGATION_NOT_GREEN`、`TEST_WEAKENED`。
  6. `daemon/guard/test-integrity.ts`：新增 `detectTestWeakening(baseText, candidateText, lang)`（规则见 verification-strategy §5）。
  7. `bin/stagent.ts`：`CliCommand` 增加 `"check"`，子命令 `obligations`（读运行报告，调用 `classifyRun`）与 `test-integrity`（比对基线与候选），退出码 0 / 1，stdout 输出 JSON。
* **非目标**：不做两段式编排（L.4）；不生成测试内容；不把义务写进合同正文（义务是运行期产物，存 `.stagent/records/<id>/obligations.json` 与证据）。
* **不变声明**：网关不变（L.4 改）；`can_merge` 仍只由命令退出码派生。
* **验收（PASS）**：新增 `tests/unit/test-obligations.test.ts`：
  - 1.3.1 合同（含 `manual_confirmation`）照常可读；1.3.2 合同的新元数据解析后保留。
  - `deriveObligations`：两条 `auto` 验收 → 两条义务；`detectRunner` 为空 → 两条均在 `waived`。
  - `classifyRun`：1 失败 → `red`；收集错误 → `red_invalid`；全过 → `green`；0 用例 → `red_invalid`。
  - `withSystemScope`：有 `auto` 条目时 `writable_paths` 含 `tests/stagent/**`，`plan_digest` 随之变化；无条目时不变。
  - `detectTestWeakening`：删一条 `expect(` → weakened；新增 `it.only` / `.skip` / `@pytest.mark.skip` → weakened；只增断言 → 不 weakened。
  - `stagent check obligations` 对夹具报告分别以 0 / 1 退出。
* **FAIL**：签署后合同被改写；1.3.1 合同读取失败；义务结论不来自进程退出码。
* **关键文件**：`src/lib/contract.schema.ts`、`src/lib/evidence.schema.ts`、`src/lib/verification/obligations.ts`（新）、`daemon/supervisor/scope-plan-builder.ts`（J.2 新建）、`daemon/guard/test-integrity.ts`、`bin/stagent.ts`
* **估算**：M

<a id="task-l.4"></a>

#### 【Task L.4】两段式施工编排：先红后绿 `[COMPLETED]`

* **任务编号**：`TASK-L.4`
* **对应规格**：[`verification-strategy.md`](./verification-strategy.md) §3.2、§3.3、§3.5、§8 第 2 项
* **前置依赖**：`TASK-L.3`、`TASK-L.2`
* **优先级**：P1（M2）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#18](https://github.com/he18718143986-design/IDE/pull/18) / tip `9263504`（`TASK-L.4：先红后绿两段式施工（phaseOverlay + T/I 编排）`）
* **对照痛点（代码事实）**：
  - `daemon/pipeline/orchestrator.ts` 一次性运行 Worker 后提交并验证（约 L778），Worker 可以同时写实现与测试。
  - `scopeExplicitlyIncludesTests`（`daemon/guard/test-integrity.ts` L46）对整组 `writable_paths` 做一次 `some()`：只要有一条测试路径，任何测试文件都可写。
* **一句话目标**：Worker 先只写义务测试并被证明「红」，再在这些测试只读的情况下实现并被证明「绿」。
* **范围**：
  1. 网关（`daemon/mcp/gateway.ts`）增加**运行期收窄**入参 `phaseOverlay?: { testWriteAllowlist?: string[]; extraForbidden?: string[] }`：
     - `testWriteAllowlist` 存在时，测试文件只有列表内的路径可写；
     - `extraForbidden` 并入禁止判定（优先于可写，复用 `src/lib/scope.ts::checkWriteAccess` 的禁止优先顺序）。

     收窄只能比合同更窄，不持久化、不改合同。
  2. `orchestrator.ts`：存在未豁免义务时分两段：
     - **T 段**：`phaseOverlay = { testWriteAllowlist: 义务路径 }`，并把非测试的写范围全部放进 `extraForbidden`；结束提交记 `red_sha`；运行义务命令，`stagent check obligations --phase t`：`red` 进入 I 段，`red_invalid` / `green` 回 T 段返工（计入 `max_verification_retries`）。
     - **I 段**：`phaseOverlay = { extraForbidden: T 段写过的文件 }`；结束后照现有流程验证（含 `stagent check obligations --phase i` 判绿）。
     - **回 T 段**：I 段义务判绿连续失败 2 次时，允许回到 T 段一次（附失败输出）；再失败 → `PENDING_RESUME`，原因写入 `.stagent/records/<id>/suspension.json`。
  3. 全部义务均被豁免时，跳过 T 段，行为与现在一致；合入卡显示豁免白话（verification-strategy §3.5）。
  4. `renderChecksSection(contract, extras)`（L.2）在 T / I 段分别追加本段义务清单。
  5. 证据写入 `obligations`（L.3 字段）。
* **非目标**：不生成测试内容；不做 DesignNote（L.11）。
* **不变声明**：**网关有变更**（新增运行期收窄入参，依据本卡与 ADR-0005 / ADR-0001：只收窄不放宽）；鉴权、Demo Origin、点亮三证不变。
* **验收（PASS）**：新增 `tests/integration/two-phase-construction.test.ts`（桩 Worker）：
  - T 段写一条基线失败的测试 → 进入 I 段；T 段试图写实现文件 → 网关拒绝。
  - T 段测试有语法错误 → `OBLIGATION_RED_INVALID`，返工计数 +1。
  - T 段测试在基线上通过 → `OBLIGATION_NOT_RED`。
  - I 段试图写 T 段测试文件，或写未列出的既有测试 → 网关拒绝。
  - I 段实现后判绿 → `obligations[0].green.exit_code === 0` 且 `can_merge === true`。
  - I 段连续 2 次判绿失败 → 回到 T 段一次。
  - 全部豁免 → 只运行一段，与 `tests/e2e/happy-path.spec.ts` 结果一致。
* **FAIL**：I 段能修改 T 段测试；收窄被持久化进合同；无义务合同行为改变。
* **关键文件**：`daemon/pipeline/orchestrator.ts`、`daemon/mcp/gateway.ts`、`src/lib/scope.ts`（只读复用）、`daemon/worker/session-task-injector.ts`
* **估算**：M

<a id="task-l.5"></a>

#### 【Task L.5】真实预览：在 Worktree 里启动用户应用 `[COMPLETED]`

* **任务编号**：`TASK-L.5`
* **对应规格**：[`verification-strategy.md`](./verification-strategy.md) §7；`scheme.md` gap-15
* **前置依赖**：无
* **优先级**：P1（M2）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#14](https://github.com/he18718143986-design/IDE/pull/14) / tip `0b6bc7f`（`feat(L.5): Worktree 真实应用预览`）
* **对照痛点（代码事实）**：`daemon/supervisor/preview/real-preview-server.ts` 只服务静态目录或登记已有 URL；都没有时 `daemon/server.ts`（约 L861）写占位页。没有任何代码在 Worktree 里执行 `dev` / `start`。
* **一句话目标**：施工完成后，中栏试玩加载的是 Worktree 里正在运行的真实应用。
* **范围**：
  1. 新建 `daemon/supervisor/preview/app-runner.ts`：`pickPreviewCommand(worktreeDir)`（`dev` → `start` → `preview`，读 `package.json`）；`startAppPreview({ worktreeDir, port })` 用 `daemon/worker/cli-host/process-host.ts::spawnManaged` 启动长驻进程（`runCommand` 只在进程退出时返回，不适用），`PORT` 注入，环境走 `daemon/runner/env-filter.ts` 白名单；`waitReady(port, { intervalMs, timeoutMs })`（默认 500 / 30000，可注入，测试用 3000）；`stopAppPreview(handle)` 复用 `daemon/runner/process-tree.ts`。预览是 Daemon 自有进程（与 Demo 预览服务同类），不进合同 `allowed_commands`，不改合同。
  2. 端口从 `daemon/supervisor/preview/types.ts` 的真机预览段（4200～4210）分配。
  3. 就绪后以「登记已有 URL」模式注册到 real-preview-server；`RealPlaytestPane` 无需改协议。
  4. 合入、放弃、`ABORTED`、Daemon 退出四个时机回收进程组。
  5. 选不到命令时回退到现有静态目录模式；仍无 → 白话「这个项目没有可预览的页面」。
* **非目标**：不做发布（L.15）；不做反向代理；不改 Demo 预览（4100～4110）。
* **不变声明**：Demo Origin 隔离不变（ADR-0008）；预览进程退出码不进 `can_merge`。
* **验收（PASS）**：新增 `tests/unit/app-preview-runner.test.ts`（夹具：一个 `dev` 脚本启动最小 HTTP 服务的临时仓库）：
  - `pickPreviewCommand`：有 `dev` 取 `dev`；只有 `start` 取 `start`；都没有返回 `null`。
  - 启动后 `waitReady` 在 30 秒内返回 true，GET 端口得到 200。
  - 夹具脚本不监听端口 → 注入 `timeoutMs: 3000` 后返回失败，结果含 stderr 尾部。
  - `stopAppPreview` 后端口可再次绑定。
* **FAIL**：预览进程在合入后仍存活；端口落在 4100～4110。
* **关键文件**：`daemon/supervisor/preview/app-runner.ts`（新）、`daemon/supervisor/preview/real-preview-server.ts`、`daemon/server.ts`、`daemon/worker/cli-host/process-host.ts`、`daemon/runner/process-tree.ts`、`daemon/runner/env-filter.ts`
* **估算**：M

<a id="task-l.6"></a>

#### 【Task L.6】黄金切片端到端测试（M2 退出标准） `[COMPLETED]`

* **任务编号**：`TASK-L.6`
* **对应规格**：[`delivery-lifecycle.md`](./delivery-lifecycle.md) §8 M2
* **前置依赖**：`TASK-L.1`～`L.5`、`TASK-J.2`～`J.10`（含各卡「ADR-0014 修订」）
* **优先级**：P1（M2 收口）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#21](https://github.com/he18718143986-design/IDE/pull/21) / tip `93589bf`（`test(L.6): 黄金切片 E2E——一句需求到合入主链`）
* **对照痛点（代码事实）**：`tests/e2e/happy-path.spec.ts` 从已批准合同开始，不覆盖「右栏一句话 → 方案 → 确认开工」；`scripts/mainline-regression.mjs` 只针对 Stagent 自身节点。
* **一句话目标**：一条自动化测试证明「一句话需求 → 一次开工 → 真实预览 → 一次合入」全程跑通，用户只点 2 次。
* **范围**：
  1. 新建 `tests/e2e/golden-slice.test.ts`：临时夹具仓库（有 `dev`、`test`、`typecheck` 脚本）；替身模型端点（复用 J.1 验证用的 stub 思路）返回固定的编译补丁与 Worker 输出。
  2. 步骤：右栏发一条消息 → 断言中栏方案出现 → 调用「确认开工」API（第 1 次点击）→ 等待验证完成 → 断言证据含红绿义务 → 断言真实预览 URL 可访问 → 调用「合入」API（第 2 次点击）→ 断言 `MERGED` 且主分支有 `Stagent-Contract-ID` Trailer。
  3. 把该测试加入 `scripts/mainline-regression.mjs` 的清单。
* **非目标**：不测多合同（M3）；不测发布（M4）。
* **不变声明**：只新增测试。
* **验收（PASS）**：
  - `golden-slice.test.ts` 通过；
  - 全程调用的用户授权类 API 恰好 2 次；
  - 过程中右栏收到的请求不含任何非用户文本（复用 L.1 断言）。
* **FAIL**：需要第 3 次用户点击；预览为占位页。
* **关键文件**：`tests/e2e/golden-slice.test.ts`（新）、`scripts/mainline-regression.mjs`
* **估算**：M

<a id="task-l.7"></a>

#### 【Task L.7】`ProjectPlan` 类型、校验与存储 `[COMPLETED]`

* **任务编号**：`TASK-L.7`
* **对应规格**：[`project-decomposition.md`](./project-decomposition.md) §2、§3、§6、§8；[`project-architecture-baseline.md`](./project-architecture-baseline.md) §3～§5；ADR-0015、ADR-0018、ADR-0019
* **前置依赖**：`TASK-L.6`（M2 收口后才开 M3）；ADR-0018 意图密封路径可用；需实现 PAB Schema/校验并要求 `architecture_baseline_ref`
* **优先级**：P2（M3）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#23](https://github.com/he18718143986-design/IDE/pull/23) / tip `607d742`（`feat(L.7): ProjectPlan 类型、确定性校验与落盘`）
* **对照痛点（代码事实）**：全库无项目级计划；任务图一份合同一张（`src/lib/journey/proposal-from-contract.ts`）。
* **一句话目标**：项目计划有类型、有确定性校验、有带版本的落盘。
* **范围**：
  1. 新建 `src/lib/project/project-plan.ts`：§2 全部类型（含 `origin`、`context`、`dependency` 种类与系统验收条目常量 `SYSTEM_ACCEPTANCE`）；`validateProjectPlan(plan, scheme, repoFacts) → { ok, violations: { rule: "D-1"…"D-11", target }[] }`（纯函数；`repoFacts` 由调用方传入：是否有测试脚本、是否有 `docs/system/modules.yaml`、存在的目录列表）。
  2. 新建 `daemon/project/plan-store.ts`：`readPlan(repoRoot)`、`writePlan(repoRoot, plan)`（写 `.stagent/project/plan.json`，旧版写入 `plan.revisions/<revision>.json`；原子写：临时文件 + rename）。
  3. 错误码 `E_PLAN_INVALID`、`E_PLAN_STALE`、`E_PLAN_STUB_LOCKED`、`E_PLAN_STUB_TOO_LARGE`、`E_PLAN_STUB_REVIVED` 登记进 `src/lib/error-codes.ts`。
* **非目标**：不做补丁合并（L.8）；不做分解器；不做 UI。
* **不变声明**：不触及合同、网关、状态机。
* **验收（PASS）**：新增 `tests/unit/project-plan.test.ts` 覆盖 project-decomposition §8 的 PD-01～PD-07、PD-12、PD-13；`tests/daemon/plan-store.test.ts`：写入后读回等值；第二次写入后 `plan.revisions/1.json` 存在。
* **FAIL**：校验依赖文件系统；同一输入两次校验结果不同。
* **关键文件**：`src/lib/project/project-plan.ts`（新）、`daemon/project/plan-store.ts`（新）、`src/lib/error-codes.ts`
* **估算**：M

<a id="task-l.8"></a>

#### 【Task L.8】计划补丁合并与分解器 `[COMPLETED]`

* **任务编号**：`TASK-L.8`
* **对应规格**：[`project-decomposition.md`](./project-decomposition.md) §1、§4、§8（PD-08、PD-09、PD-11）；[`project-architecture-baseline.md`](./project-architecture-baseline.md) §2～§5；ADR-0018、ADR-0019
* **前置依赖**：`TASK-L.7`、`TASK-J.9`（方案结构）；先经 ADR-0018 密封方案，再生成并通过 PAB，再生成 ProjectPlan
* **优先级**：P2（M3）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#33](https://github.com/he18718143986-design/IDE/pull/33) / tip `fb27504`（`feat(L.8): PlanPatch 合并、分解器与 /api/project/plan 接线`）
* **对照痛点（代码事实）**：
  - 计划类型与校验已在 `src/lib/project/project-plan.ts::validateProjectPlan` / `::ProjectPlan` / `::orderedStubs`（L.7）；落盘已在 `daemon/project/plan-store.ts::readPlan` / `::writePlan`。**今日无** `src/lib/project/plan-patch.ts`、**无** `applyPlanPatch` / `PlanPatch` / `PlanOp` 符号；**无** `daemon/supervisor/decomposer/` 目录（全库对计划侧 `PlanPatch`/`applyPlanPatch`/`decompose` 实现 **0 命中**）。
  - 方案侧已有同构补丁引擎可作挂接参照：`src/lib/journey/scheme-patch-engine.ts::mergeSchemePatch` 与 `src/lib/journey/scheme-patch-types.ts::SchemeDraftV2`；L.8 应对齐该模式做计划补丁，而非再造方案合并。
  - 密封快照入口已在 `daemon/pipeline/scheme-snapshot-store.ts::writeSchemeSnapshot` / `::readSchemeSnapshot` / `::schemeBindingFromSnapshot`（ADR-0018 路径）。分解器应吃密封后的 `SchemeDraftV2` + ready PAB，但 **今日无**「密封方案 → `PlanPatch`」调用链。
  - HTTP：`daemon/server.ts` 已有大量 `/api/*` 路由登记，**今日无** `POST /api/project/plan/patch`（pathname **0 命中**）；用户侧 `remove_stub`/`reorder` 尚无处可挂。
* **一句话目标**：方案冻结前，分解器产出计划补丁；Daemon 确定性合并，不合规整体拒绝。
* **范围**：
  1. `src/lib/project/plan-patch.ts`：`PlanPatch` / `PlanOp` 类型；`applyPlanPatch(plan, patch, scheme, repoFacts)`（纯函数，规则见 §4；合并后调 `validateProjectPlan`）。
  2. `daemon/supervisor/decomposer/decompose.ts`：输入已密封方案（`SchemeDraftV2`）+ `repoFacts` + ready PAB，输出引用 PAB revision/digest 的 `PlanPatch`（`reason: "initial"`）；PAB 缺失、过期或有阻断决策时不得生成可签署合同桩。实现形态开放（同 ADR-0014 §1）：单次结构化模型调用，输出用 zod Schema 约束；`size_hint === "standard"` 时不调模型，确定性生成单里程碑单桩。
  3. 合并失败时把 `violations` 回喂分解器重试一次；仍失败 → 画布白话「这个需求我还没拆好」，不生成合同。
  4. HTTP `POST /api/project/plan/patch`（带 session token）：只接受用户发起的 `remove_stub`（`removed_by: "user"`）与 `reorder`，其余 op 返回 422；供 L.10 调用。
  5. 方案在两份合同之间变化时：§16.5 C 类（新需求）→ `add_stub`；B 类（本轮范围内补充）不产生计划补丁，仍并入当前合同（project-decomposition §5）。
* **非目标**：不做合同序列（L.9）；不做 UI（L.10）。
* **不变声明**：计划不是授权凭据；不改签署链。
* **验收（PASS）**：`tests/unit/plan-patch.test.ts`：PD-08、PD-09、PD-11；`standard` 方案零模型调用得到 1 里程碑 1 桩；桩模型返回违反 D-7 的补丁 → 重试 1 次 → 第二次合法则合并成功。
* **FAIL**：对 `merged` 桩的修改被采纳；用户删除的桩被同义复活且未报 `E_PLAN_STUB_REVIVED`。
* **关键文件**：`src/lib/project/plan-patch.ts`（新；导出 `PlanPatch`/`PlanOp`/`applyPlanPatch`）、`daemon/supervisor/decomposer/decompose.ts`（新）、`daemon/server.ts`（挂 `POST /api/project/plan/patch`）；调用既有 `src/lib/project/project-plan.ts::validateProjectPlan`、`daemon/project/plan-store.ts::readPlan`/`::writePlan`、`daemon/pipeline/scheme-snapshot-store.ts::readSchemeSnapshot`
* **估算**：M

<a id="task-l.9"></a>

#### 【Task L.9】合同序列、桩视图预检与「下一份」交接 `[COMPLETED]`

* **任务编号**：`TASK-L.9`
* **对应规格**：[`project-decomposition.md`](./project-decomposition.md) §5、§8（PD-10）
* **前置依赖**：`TASK-L.8`、`TASK-J.4`、`TASK-J.5`
* **优先级**：P2（M3）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#35](https://github.com/he18718143986-design/IDE/pull/35) / tip `e1cf1bb`（`feat(L.9): 合同序列、桩视图预检与下一份交接`）
* **对照痛点（代码事实）**：J.2 `buildScopePlan` 以整份方案为输入；合入后没有「下一份」的概念。
* **一句话目标**：合入一份后，系统自动选出下一份并为它预检范围；用户只需再点一次「确认开工」。
* **范围**：
  1. `src/lib/project/next-stub.ts`：`nextStub(plan)`（规则见 §5）。
  2. `src/lib/project/stub-view.ts`：`schemeViewForStub(scheme, stub)` → 只含该桩 `scheme_item_ids` 的方案视图 + `area_hints`，作为 `buildScopePlan` 的 `scheme` 入参。
  3. 合同生成时写入 `supervisor_metadata.scheme_item_ids` 与 `supervisor_metadata.stub_id`；合入后回填桩 `status: "merged"`、`contract_id`。
  4. **合同级互斥**：签署路径（J.5 确认 / J.4 建合同）检查是否已有合同处于 `PREPARING`～`AUDITED`；有则拒绝 `409 E_CONTRACT_IN_FLIGHT`（现行代码只有 Daemon 进程锁 `daemon/core/pid-lock.ts`，`server.ts` 的 `activeContracts` 未被填充）。错误码登记进 `src/lib/error-codes.ts`。
  5. **按桩种类的签署前范围规则**（project-decomposition §5.1）：`test_foundation` / `dependency` 桩在 `buildScopePlan` 中加入 `dependency_changes_allowed: true`、精确安装命令（如 `npm install -D vitest`）、`network_policy: "EXPLICIT_TARGETS"`（目标仅包管理器注册表域名），锁文件进入 `needs_approval`（由 SA-1 一次点击授权）。
  6. 合同 `ABORTED` → 桩 `aborted` → 若 `nextStub` 返回 `null` 且仍有 `planned`，触发 L.8 重新分解（`reason: "contract_aborted"`）。
* **非目标**：不做项目地图 UI（L.10）。
* **不变声明**：每份合同仍单独签署；新增合同级互斥是对 ADR-0002「单工作区串行」的落实。
* **验收（PASS）**：`tests/unit/next-stub.test.ts`：PD-10；`tests/integration/contract-sequence.test.ts`：两桩计划，合入第一份后 `nextStub` 返回第二份，其 `ScopePlan` 只含第二份的区域；第一份 `ABORTED` 时第二份（依赖第一份）不可选，并触发重新分解调用；第一份处于 `EXECUTING` 时签第二份 → `E_CONTRACT_IN_FLIGHT`；`test_foundation` 桩的 `ScopePlan` 含安装命令与 `EXPLICIT_TARGETS`。
* **FAIL**：上一份未终结时能签下一份；`ScopePlan` 混入其他桩的区域。
* **关键文件**：`src/lib/project/next-stub.ts`（新）、`src/lib/project/stub-view.ts`（新）、`daemon/server.ts`（合入回调处）
* **估算**：M

<a id="task-l.10"></a>

#### 【Task L.10】画布「项目地图」视图 `[COMPLETED]`

* **任务编号**：`TASK-L.10`
* **对应规格**：[`project-decomposition.md`](./project-decomposition.md) §7；[`supervisor.md`](./supervisor.md) §16（同页四幕 / `PROJECT_MAPPING`）
* **前置依赖**：`TASK-L.9`、`TASK-L.8`
* **优先级**：P2（M3）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#38](https://github.com/he18718143986-design/IDE/pull/38) / tip `e4351b0`（`feat(L.10): 画布同页嵌项目地图与 GET /api/project/plan`）
* **对照痛点（代码事实）**：
  - 中栏方案工作台已在 `src/components/studio/SchemeReviewPane.tsx::SchemeReviewPane`；Studio 可关 Tab 常量在 `src/components/WorkspaceLayout.tsx::STUDIO_TAB_ID`；ActivityBar 壳在 `src/components/layout/ActivityBar.tsx::ActivityBar`（**今日无**「项目」入口）。**Tina 2026-10-31 裁决：跟 supervisor / §7**——地图必须**同页嵌**于方案工作台，**禁止**另开 ActivityBar「项目」Tab / 独立视口 / 第二套导航（不得再造类似 `STUDIO_TAB_ID` 的「项目」Tab）。
  - 计划「下一份」纯函数已在 `src/lib/project/next-stub.ts::nextStub`（L.9）；前端补丁客户端已在 `src/lib/daemon-api.ts::patchProjectPlan`（挂 L.8 `POST /api/project/plan/patch`）。**今日无** `GET /api/project/plan`（`daemon/server.ts` 仅有 POST `.../patch` 与 `.../decompose`，GET pathname **0 命中**）；**今日无** `src/components/project/ProjectMapPane.tsx` / `ProjectMapPane` 符号；**今日无** `tests/ui/project-map-pane.test.tsx`（卡要求的 UI 测尚未落盘）。
  - 中栏现状仍是单合同方案与施工视图；用户无法在同页一眼看到里程碑/桩进度/下一份。
* **一句话目标**：用户在中栏一眼看到整个项目：几个里程碑、每份做到哪、下一份是什么。
* **范围**：
  1. `GET /api/project/plan`（`daemon/server.ts`，带 session token）返回计划 + 每桩状态（含服务端权威的下一份标识；前端**不得**本地重算 `nextStub` 代替）。
  2. 新建 `src/components/project/ProjectMapPane.tsx`：里程碑列表、桩卡片、「下一份」高亮 +「确认开工」按钮（复用 J.5 确认流程）、「先不做这个」「这个往前排」两个操作（调用 L.8 的 `POST /api/project/plan/patch` / `patchProjectPlan`）。
  3. **入口形态（Tina 2026-10-31 裁决：跟 supervisor / [`project-decomposition.md`](./project-decomposition.md) §7）**：将 `ProjectMapPane` **同页嵌**于方案工作台 / `SchemeReviewPane`（「方案 · 整理项目地图」/`PROJECT_MAPPING` 完成后展开，或施工幕顶部嵌套条/折叠区）。**禁止** ActivityBar 增「项目」入口、**禁止**可关独立「项目」Tab、**禁止**另开视口；旧卡面「ActivityBar 增项目入口、可关 Tab（`STUDIO_TAB_ID` 同款）」作废，以本条为准。
* **非目标**：不展示文件路径、glob、Token 单位；不允许在地图上编辑桩内容；不新增 ActivityBar 项。
* **不变声明**：前端只经 `src/lib/daemon-api.ts` 调接口，不自行推导状态（含「下一份」）。
* **验收（PASS）**：`tests/ui/project-map-pane.test.tsx`：渲染两个里程碑三份桩；「下一份」高亮唯一；页面文本不含 `**`、`glob`、`token`；点「先不做这个」调用补丁接口一次且 `removed_by: "user"`；组件挂在方案工作台同页路径下（非独立 Tab）。
* **FAIL**：地图显示技术单位；前端自行计算「下一份」；出现独立「项目」Tab / ActivityBar「项目」入口。
* **相关文件**：`src/components/project/ProjectMapPane.tsx`（新；导出 `ProjectMapPane`）、`src/components/studio/SchemeReviewPane.tsx::SchemeReviewPane`（同页挂载点）、`src/lib/daemon-api.ts`（新建 GET 客户端；复用 `::patchProjectPlan`）、`daemon/server.ts`（挂 `GET /api/project/plan`）；只读复用 `src/lib/project/next-stub.ts::nextStub`；对照 `src/components/WorkspaceLayout.tsx::STUDIO_TAB_ID` / `src/components/layout/ActivityBar.tsx::ActivityBar`（**不**增项目入口）
* **估算**：M

<a id="task-l.11"></a>

#### 【Task L.11】DesignNote 生成、校验与注入 `[COMPLETED]`

* **任务编号**：`TASK-L.11`
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §2、§3、§6（TD-01～TD-05）；[`project-architecture-baseline.md`](./project-architecture-baseline.md) §6；ADR-0016、ADR-0018、ADR-0019
* **前置依赖**：`TASK-L.4`、`TASK-L.9`（DN-2 插入依赖桩）
* **优先级**：P2（M3）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#43](https://github.com/he18718143986-design/IDE/pull/43) / tip `78ec236`（`feat(L.11): DesignNote generate/validate/inject on EXECUTING path`）
* **已知挂账（合入时）**：DN-2「可以」领域方法 `PipelineOrchestrator.resolveDesignDependencyAllow` 已交付并由集成测覆盖；**无** HTTP / 画布意外卡入口可达（`POST .../resume` 不路由至此）。入口接线属后续卡职责（与既有预算/熔断挂起卡片同类债；可挂 J.7 交接类或另立接线卡），本卡不宣称端到端 UI 闭环。见 ledger DLV-6。
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

#### 【Task L.12】系统知识库：Schema、引导合同与漂移门禁 `[COMPLETED]`

* **任务编号**：`TASK-L.12`
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §4、§6（TD-06～TD-10）；ADR-0016；`scheme.md` acc-8
* **前置依赖**：`TASK-L.11`
* **优先级**：P2（M3）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#47](https://github.com/he18718143986-design/IDE/pull/47) / tip `39f426a`（`feat(L.12): 系统知识库 checkKnowledge / withSystemScope / bootstrap`；本地 squash 后推送）
* **合入前拍板（Tina）**：① KB-1 维持「每个改动文件」（含非源码；真实物业口径），不收窄为仅源码；② bootstrap 启发式改 B——只认 `contract_type === "knowledge_bootstrap"`，不以标题含「知识库」触发。
* **对照痛点（代码事实）**：目标项目没有任何系统描述；`daemon/arch/graph.ts::buildDependencyGraph` 结果不落盘。
* **一句话目标**：每份合同合入时，目标仓库的 `docs/system/` 都覆盖本次改动；漂移即判不合格。
* **范围**：
  1. `src/lib/knowledge/modules-schema.ts`（L.11 已建）增加 `coversPath(modules, path)`，glob 匹配复用 `src/lib/scope.ts::matchesAnyPattern`。
  2. 新建 `daemon/knowledge/check-knowledge.ts`：`checkKnowledge({ worktreeDir, baseSha, candidateSha, designNote }) → { ok, failures: { rule: "KB-1"…"KB-5", target }[] }`；由 `bin/stagent.ts` 子命令 `stagent check knowledge` 以真实进程调用（退出码 0 / 1，ADR-0005），作为验证命令排在 V2 之后；失败 → 证据 `FAILED`、原因码 `KNOWLEDGE_DRIFT`。
  3. `withSystemScope`（L.3）扩展：目标仓库已有 `docs/system/modules.yaml`，或本桩为 `knowledge_bootstrap` 时，在签署前把 `docs/system/**` 与 `stagent check knowledge` 并入 `ScopePlan`；`daemon/mcp/gateway.ts` 的文件预算计数排除 `docs/system/**`。
  4. 新建 `daemon/knowledge/bootstrap-draft.ts`：`draftModules(repoRoot)`：顶层源码目录 → 候选模块，`buildDependencyGraph` → `depends_on`（确定性）。`knowledge_bootstrap` 合同的设计步骤以它为输入（触发条件仅 `contract_type`）。
  5. `reasonCodeSchema`（`src/lib/evidence.schema.ts`）增加 `KNOWLEDGE_DRIFT`。
  6. `renderChecksSection` 追加 KB-1～KB-5 规则摘要（verification-strategy §8 第 3 项）。
* **非目标**：不做「为什么有这段代码」入口（L.13）；不做系统地图 UI（**`TASK-L.18`** / DLV-5）。
* **不变声明**：网关写范围判定函数不变，只扩合同范围。
* **验收（PASS）**：`tests/unit/knowledge-check.test.ts`：TD-06～TD-08、TD-10；`tests/unit/knowledge-bootstrap.test.ts`：TD-09。
* **FAIL**：未覆盖的改动文件仍 `can_merge`；`docs/system/**` 写入占用文件预算。
* **关键文件**：`src/lib/knowledge/modules-schema.ts`、`daemon/knowledge/check-knowledge.ts`（新）、`daemon/knowledge/bootstrap-draft.ts`（新）、`bin/stagent.ts`、`daemon/mcp/gateway.ts`、`src/lib/scope.ts`（只读复用）、`daemon/arch/graph.ts`（只读复用）
* **估算**：M

<a id="task-l.13"></a>

#### 【Task L.13】追踪链：Trailer 扩展与「这段为什么存在」反查 `[COMPLETED]`

* **任务编号**：`TASK-L.13`
* **对应规格**：[`delivery-lifecycle.md`](./delivery-lifecycle.md) §6；[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §5
* **前置依赖**：`TASK-L.9`（合同带 `scheme_item_ids`）、`TASK-L.12`（`changelog.md` 条目保证存在）
* **优先级**：P2（M3）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#51](https://github.com/he18718143986-design/IDE/pull/51) / tip `51ea872`（`feat(L.13): Trailer Scheme-Items + explainLine 追踪链反查`；GitHub squash merge）
* **合入说明（行号准确范围）**：反查以 Daemon `repoRoot` 的 HEAD 做 `git blame`；**仅对已合入主干、且本地无未提交改动的文件行准确**。Worktree 打开中的未合入文件、或与 HEAD 行号错位的脏工作区，可能「看起来像查成功」但来历对不上——已知限制，未在本卡修 worktree/ref 传参。
* **已知挂账（合入时）**：① 未提交行（blame 全 0 SHA）当前可能报成「提交无 Stagent Trailer」，更准确应是「该行尚未提交」；② 方案条目只在**当前账本草稿**中查找，后续修订删条目会导致旧代码断在「方案条目」环（规格允许的限制）；③ `rel.includes("..")` 会对合法文件名如 `a..b.ts` 误拒；④ 截断超长 `Stagent-Scheme-Items` 时可能在无知识库仓库凭空建最小 `docs/system/changelog.md`（只在截断路径触发）。
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


<a id="task-l.14"></a>

#### 【Task L.14】凭据保险库 `[COMPLETED]`

* **任务编号**：`TASK-L.14`
* **对应规格**：[`release-and-operations.md`](./release-and-operations.md) §4；ADR-0014 §3；`scheme.md` conf-6、oq-3
* **前置依赖**：`TASK-L.6`；**OQ-REL-1 裁决**（存储后端）
* **优先级**：P2（M4）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#31](https://github.com/he18718143986-design/IDE/pull/31) / tip `ae57543`（`feat(L.14): 凭据保险库（OS Keychain）`）
* **对照痛点（代码事实）**：只有模型 Key 的内存存储（`daemon/worker/key-store.ts`）；无通用密钥存储；`daemon/runner/command-runner.ts::redactSecrets(text, secretValues)` 已支持精确值遮蔽，但跳过 6 个字符以下的值；`daemon/core/debug-log.ts` 另有一份不支持精确值的 `redactSecrets`。
* **采用的默认值**：OQ-REL-1 未裁决前按推荐值 A（系统钥匙串）实现，Linux 无 Secret Service 时回退 B（`.stagent/vault.enc`）。用户改判时只换存储后端，接口不变。
* **一句话目标**：用户的密钥只存在保险库里，只在发布与外网摄取时注入进程环境，任何日志、证据、模型输入里都找不到明文。
* **范围**：
  1. 新建 `daemon/vault/vault.ts`：`setSecret(name, value)`、`listNames()`、`deleteSecret(name)`、`resolveEnv(names) → Record<string,string>`（仅 Daemon 内部调用）；后端适配 `keychain-backend.ts` / `file-backend.ts`。
  2. HTTP：`PUT /api/vault/:name`（只写）、`GET /api/vault`（只返回名字）、`DELETE /api/vault/:name`。永不返回值。
  3. 脱敏：所有命令输出经 `command-runner.ts::redactSecrets(text, vault.currentValues())` 遮蔽；`debug-log.ts` 的 `redactSecrets` 同样接受并使用保险库值。`setSecret` 拒绝短于 8 个字符的值（`E_VAULT_VALUE_TOO_SHORT`，保证遮蔽可靠）。
  4. 设置页新增「密钥」区（`src/components/settings/SettingsTab.tsx`）：掩码输入、列表、删除。
* **非目标**：不做发布（L.15）；不做外网摄取（L.17）。
* **不变声明**：模型 Key 存储方式不变（`key-store.ts`）；Worker 环境白名单不变，保险库值不进 Worker。
* **验收（PASS）**：`tests/daemon/vault.test.ts`：设值后 `GET /api/vault` 只含名字；`resolveEnv` 返回值；对含该值的字符串调用 `redactSecrets` → `[REDACTED]`；Worker 指令构建、Supervisor 输入构建对一个含该值的上下文进行全文搜索 → 0 命中（RO-08）。
* **FAIL**：任何 HTTP 响应出现密钥明文；值写入 `.stagent/` 明文文件。
* **关键文件**：`daemon/vault/*`（新）、`daemon/runner/env-filter.ts` 或 `redactSecrets` 所在模块、`src/components/settings/SettingsTab.tsx`、`daemon/server.ts`
* **估算**：M

<a id="task-l.15"></a>

#### 【Task L.15】发布生命周期与两类部署目标 `[COMPLETED]`

* **任务编号**：`TASK-L.15`
* **对应规格**：[`release-and-operations.md`](./release-and-operations.md) §1～§3、§6、§7（RO-01～RO-09）；ADR-0017；`scheme.md` acc-9
* **前置依赖**：`TASK-L.14`
* **优先级**：P2（M4）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#52](https://github.com/he18718143986-design/IDE/pull/52) / tip `9829385`（`feat(L.15): 发布生命周期与两类部署目标`；GitHub squash merge）
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
* **已知挂账（合入时）**：
  1. `process-registry` 仅内存：Daemon 重启后 LIVE 记录与进程句柄脱节（启动时未自动标 incident）。
  2. `POST /api/releases/:id/run` 同步阻塞（build 超时上限可达 10 分钟），HTTP/UI 干等。
  3. 集成测 RO-01～03 注入替身适配器：`git archive` 真实执行，**未**跑真 `npm start` + HTTP 探活路径——不得写成「真实进程已验证」。
* **估算**：M（如超出，拆为「状态机 + 存储」与「目标适配器 + UI」两卡）

### 3.5 架构感知、监听与差异审阅（C.5 落 Sprint 2；B.1/B.2/C.4 推迟至 v0.2+）

---

<a id="task-l.16"></a>

#### 【Task L.16】线上问题回流 `[COMPLETED]`

* **任务编号**：`TASK-L.16`
* **对应规格**：[`release-and-operations.md`](./release-and-operations.md) §5、§7（RO-10）
* **前置依赖**：`TASK-L.15`、`TASK-L.9`
* **优先级**：P3（M4）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#62](https://github.com/he18718143986-design/IDE/pull/62) / tip `e4dfe1c`（`feat(L.16): 线上问题回流（LiveIncident + E 类分流）`；GitHub squash merge；合入前接线补丁 `52f4eca` 已 squash 进 tip）
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
* **关键文件**：`daemon/release/release-manager.ts`、`daemon/release/live-incident-stub.ts`（新）、`src/components/release/LiveIncidentCard.tsx`（新）、`src/lib/journey/intent-router.ts`、`src/lib/journey/live-incident-context.ts`（新）、`daemon/server.ts`、`daemon/supervisor/journey/orchestrate.ts`
* **已知挂账（合入时）**：
  1. 「线上」卡挂在发布页（`ReleasePane`），**未**进主画布中栏。
  2. 探活失败（`health_watch_failed`）路径有代码；集成夹具偏 `process_exit`。
  3. E 类分流只指引、不自动触发 ask-ai / 开合同。
  4. Daemon 重启后 watch 不重挂（与 L.15 `process-registry` 仅内存同源：定时器随 manager 实例消失；持久化 LIVE 记录重启后无探活、无退出监听）。
  5. E 类词表（`线上`/`生产`/`prod`）可能误报非事故语境（如「线上活动」「生产报表」）；只指引不动作，代价低。
  6. 插桩 patch `reason: "user_request"` 与桩上 `origin: "system"` 语义略歪（无伤大雅）。
  7. （核实无问题）`sys-acc-incident` 已在 `SYSTEM_ACCEPTANCE`；`server.ts` 调用 `orchestrateJourney` 已传 `liveTargetNames` / `hasInProgressContract`（接线 tip `52f4eca`，squash 进 `e4dfe1c`）。
* **估算**：M
* **纪律尾注**：仅文档回写销项；**不**宣称端到端产品闭环；**不**开工 L.17 / W.6。

<a id="task-a.7"></a>

#### 【Task A.7】Worktree seal 路径前缀对齐 `[COMPLETED]`

* **任务编号**：`TASK-A.7`
* **任务名称**：seal / manifest 目录与 `worktree-manager` 统一为 `task-{id}`
* **对应规格**：[`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) §10.5 D1；ledger DOC-5 / 「第 1 波遗留 · Worktree seal 路径前缀」；[`../ledger/README.md`](../ledger/README.md)
* **前置依赖**：`TASK-A.1`（COMPLETED）、`TASK-C.15d`（COMPLETED）
* **优先级**：P3 · **NON_BLOCKER**（**不阻断** `TASK-L.15` 主序；不抢 Sprint「当前首要」）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#49](https://github.com/he18718143986-design/IDE/pull/49) / tip `4b7a709`（`fix(A.7): align worktree-seal dir with manager task-{id} prefix`；GitHub squash merge）
* **合入说明**：旧无前缀 `.stagent/worktrees/{id}/` **不迁移**；读时判「未封存」。合前本地已清旧无前缀目录（提交说明自证）。
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

<a id="task-c.5"></a>

<a id="task-l.18"></a>

#### 【Task L.18】系统地图 UI 与「改这里会影响什么」`[COMPLETED]`（ledger **DLV-5**）

* **任务编号**：`TASK-L.18`
* **任务名称**：中栏系统地图（知识库第二页）+ 影响闭包入口
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §5；supervisor 中栏/地图嵌入；ledger **DLV-5**；对照 `TASK-L.10`（项目地图已 COMPLETED）
* **前置依赖**：`TASK-L.10`（COMPLETED）、`TASK-L.12`（COMPLETED · 提供 `modules.yaml`；**本卡不抢 L.15**）
* **优先级**：P3 · **NON_BLOCKER**（合入时相对 Sprint 首要；前置 `L.12`/`L.13` 已 COMPLETED）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#54](https://github.com/he18718143986-design/IDE/pull/54) / tip `c8e6a81`（`feat(L.18): 系统地图 UI + impactClosure（/api/knowledge/*）`；本地 squash merge 后推送 main）
* **合入说明**：同页嵌 `SystemMapPane`；`impactClosure` 纯函数；`GET /api/knowledge/modules|impact`（Auth）。
* **已知挂账（合入时）**：interfaces 消费者解析只认 `consumers:` / `消费者:` 行——模块文档不写该行则静默漏消费者；`rel.includes("..")` 与 L.13 同款误拒（如 `a..b.ts`）。**不宣称端到端闭环**。
* **对照痛点（代码事实 · 合入前）**：L.10 已有「项目地图」；本卡落地系统地图与 impactClosure（见合入证据）。
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

<a id="task-j.19"></a>

#### 【Task J.19】DN-2「可以」HTTP / 画布入口接线 `[COMPLETED]`（ledger **DLV-6**）

* **任务编号**：`TASK-J.19`
* **任务名称**：把已测的 `resolveDesignDependencyAllow` 接到用户可达入口
* **对应规格**：[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) DN-2；L.11 合入挂账；ledger **DLV-6**；可参照 `TASK-J.7` 交接/意外卡 UX 模式
* **前置依赖**：`TASK-L.11`（COMPLETED）、`TASK-J.7`（COMPLETED · 交接三步/右栏解锁模式可复用）
* **优先级**：P3 · **NON_BLOCKER**（不阻断 L.11 领域验收；**不阻断** `TASK-L.16`）
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#55](https://github.com/he18718143986-design/IDE/pull/55) / tip `4bae423`（`feat(J.19): DN-2「可以/不行」HTTP + 画布入口`；本地 squash merge 后推送 main；rebase 时 `server.ts` 保留 `/api/knowledge/*` + `/api/design/*`）
* **合入说明**：HTTP `/api/design/:id/dependency-surprise|allow|deny`；allow → `resolveDesignDependencyAllow`；deny → abort 不插桩；侧车 `.stagent/records/`；resume 不误路由。
* **已知挂账（合入时）**：无 ledger 时 HTTP 用 `synthesizeSchemeFromPlan` 合成最小 scheme（goals/modules 标 `source: "user_said"`）——降级路径，不是真用户原话。**不宣称端到端产品闭环**。
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

#### 【Task J.20】OP-1 授权清单落地（dec-10 实施约束）`[COMPLETED]`

* **任务编号**：`TASK-J.20`
* **任务名称**：确认路径敏感项授权清单的存储、scope 与失效条件
* **对应规格**：[`../scheme.md`](../scheme.md) dec-10 / q23 / R-OP1；supervisor §14.11 **K-12**（确认路径 occurrence 洗白）；[`delivery-lifecycle.md`](./delivery-lifecycle.md) §5 **SA-1**；consistency-audit OP-1（裁决已销项，**实施**归本卡）
* **前置依赖**：`TASK-J.3` / `TASK-J.5` / `TASK-J.9`（均 **COMPLETED**）；**不**重开 `TASK-J.9`
* **优先级**：P2 · **NON_BLOCKER** 相对 L.15 主序（**不抢** Sprint「当前首要」）；实施敏感授权面，须单卡审
* **状态**：`[COMPLETED]`
* **合入证据**：PR [#57](https://github.com/he18718143986-design/IDE/pull/57) / tip `4d2f8e1`（`feat(J.20): OP-1 授权清单落地（records 侧车 + 确认路径自动放行）`；GitHub squash merge）
* **合入说明**：存储 `.stagent/records/authorization-allowlist.json`；确认路径 `buildScopePlan` 末尾挂载；复活路径源码级断言仍 `ignoreOccurrence` 且不含 allowlist 字样。
* **已知挂账（合入时）**：① 「同一敏感项」= 规范化路径集合完全相同（精确匹配，不是语义区域）；② 路径含 `|` 字符理论上会撞键（现实几乎不存在）。**不宣称端到端闭环**。
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


#### 【Task C.5】双栏 Diff 审阅器与结构化终端日志回放
* **任务编号**：`TASK-C.5`
* **前置依赖**：`TASK-C.1`, `TASK-A.4` (COMPLETED)（v1.3.3：移除已推迟的 `TASK-C.4`）
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：`src/components/diff/*` 双栏/内联 Diff + `src/components/StructuredTerminal.tsx` 结构化终端；服务端 `GET /api/contracts/:id/diff-files` 返回逐文件真实基线/当前内容（`daemon/server.ts:1347`）；超长输出经 `redactSecrets` 先脱敏、后头尾双窗口截断；`tests/ui/diff-terminal-viewer.test.tsx` 5 个用例全绿）
* **核心目标**：
  1. 双栏/内联展示真实 Git Diff。
  2. 结构化终端流式回放日志，ANSI 彩色，超长日志先脱敏后头尾截断 (保留各 200 行)。
* **涉及核心文件**：
  - 新增：`src/components/DiffViewer.tsx`
  - 新增：`src/components/StructuredTerminal.tsx`
  - 测试：`tests/ui/diff-terminal-viewer.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：Diff 准确匹配 git；敏感信息在截断前已被遮蔽；超大输出前端不崩溃。
  - **FAIL**：未脱敏即截断。

---


---

<a id="task-c.6"></a>

#### 【Task C.6】右栏 Agent 流式会话与打断续接 (v1.3.3 新增)
* **任务编号**：`TASK-C.6`
* **前置依赖**：`TASK-C.1`, `TASK-D.1`
* **任务状态**：**[COMPLETED]**（已合并主线 `43496c0`。已用假适配器 + 演示 Agent 测过：流式、工具卡片、排队、打断（门闩立即生效、适配器 <2s 停止）、`.stagent/sessions/` 持久化与重启续接；真实 Claude Code 的流式/打断/续接见 W.5a。Adapter：自研保底（OpenAI 兼容，只聊天）/ 演示 Agent（不调用模型）。打断会清空排队消息。）
* **核心目标**：
  1. 右栏会话流式渲染（逐 Token）、工具调用卡片、改动预览；
  2. Stop/打断：用户随时中断，Agent 进程 2s 内停止输出；排队追加消息；
  3. Adapter 切换（自研保底 Worker / Claude Code / 其他已验证 Adapter）；
  4. 会话列表与 resume：映射各 CLI 的原生会话 ID，持久化于 `.stagent/sessions/`；关闭浏览器与重启 Daemon 后可续接同一会话并保留上下文；
  5. 消费 `CHAT_EVENT` 子类型帧（`delta`/`tool_call`/`tool_result`/`turn_end`/`interrupted`/`error`，架构规范 §6.1）。
* **涉及核心文件**：
  - 新增：`src/components/AgentChatPane.tsx`
  - 新增：`src/hooks/use-agent-session.ts`
  - 测试：`tests/ui/agent-chat-pane.test.tsx`
* **Pass/Fail 验收判定**：
  - **PASS**：首 token 可见延迟 ≤1s（本地测量）；打断后 2s 内 Agent 进程停止输出；Daemon/UI 重启后会话可续接且上下文完整。
  - **FAIL**：打断后仍有输出；重启丢会话。

---


---

<a id="task-c.7"></a>

#### 【Task C.7】业务功能树与 Task Graph 渐进点亮视口 `[v1.6.1 升级]`
* **任务编号**：`TASK-C.7`
* **前置依赖**：`TASK-D.1`, `TASK-S.2`, `TASK-C.1`, `TASK-D.3`
* **任务状态**：**[COMPLETED]**（2026-10-23 合入 main，merge `5117b27`；原交付于 `feat/task-c7-graph-engine`，基线 `main@05f090f`。门禁：干净环境四件套全绿（1032 passed / 6 skipped）；`tests/unit/graph-engine-invariants.test.ts` 24 通过；`tests/ui/task-graph-illumination.test.tsx` 7 通过；`tests/ui/ide-shell.test.tsx` 12 通过（新增 Activity Bar 图谱入口后同步顺序断言）。落地清单：`daemon/graph/graph-engine.ts`（Daemon 独占内存权威 + 原子落盘 `.stagent/specs/task_graph.json`，`revision` 单调递增、对外只给快照）、`daemon/graph/illumination-verifier.ts`（三证充要条件 + C-04 空集拦截）、`daemon/graph/evidence-collector.ts`（目标文件 SHA-256 / 合同 Scope / `git rev-parse HEAD` 全部由 Daemon 现算）、`src/lib/graph/task-graph.ts`（七态、提案类型与 `TASK_GRAPH_UPDATED` 载荷）、`daemon/server.ts` 5 个 `/api/graph*` 端点与全量快照广播、`src/components/graph/{TaskGraphPanel,FunctionalTree,ExecutionDag}.tsx` + `graph-view-model.ts`、`src/components/FileTreeSpecsSection.tsx`、`src/routes/index.tsx` 接线。**口径说明**：① 视图文件名按实际实现落为 `TaskGraphPanel` / `FunctionalTree` / `ExecutionDag`（本卡设计期的 `TaskGraphViewer` / `FunctionalMindmap` / `GraphNodeCard` 命名未沿用）；② 空验证集按架构 §3.2.2 置 `FAILED` + `E_EMPTY_VERIFICATION_BLOCKED`，UI 以「警告灰」（`data-tone="warning"`）呈现，不新增第八个节点状态；③ 点亮同时绑定 Worktree HEAD 的 Commit SHA 与目标文件 SHA-256 指纹，兼容 ADR-009 的 `node_patch_fingerprint` 口径；④ 需求条目以合同 `intent` 呈现（仓库暂无 `.stagent/specs/requirements.md` 实体），Demo 仅在真实文件存在时标「就绪」，进度由 `TASK_GRAPH_UPDATED` 驱动（源头为真实写入与验证，不由模型自报）。**残余口径差（不阻塞验收，需登记）**：① 节点详情暂只展示目标文件/验证命令/Commit SHA/问题码，卡片要求的 Git Diff 摘要与测试报告抽屉未接入；② `POST /api/graph/verify` 的验证命令结果仍由执行器提交（文件写入、Scope、SHA 已不可自报）；③ 建图入口仅控制面 API，不提供「从合同自动拆节点」的伪造拓扑）
* **v0.1 范围**：在中栏呈现业务思维导图与任务执行 DAG 流程图；实现由灰变绿的渐进点亮动效与持久化状态渲染；Daemon 独占权威状态；提案类型剥离运行态；空验证集强拦截。
* **核心目标**：
  1. **Daemon 独占权威状态与提案类型安全 (`daemon/graph/graph-engine.ts`)**：
     - Task Graph 权威状态由 Daemon 单独维护并持久化于 `.stagent/specs/task_graph.json`，严禁前端或 Supervisor 自行篡改；
     - Supervisor 提交的 Graph 提案结构 `SupervisorProposalV1` 在类型层使用 `Omit<TaskNode, "state" | "executed_at" | "commit_sha">` 严格剥离所有运行态字段；
     - 节点七态维护（严格对齐架构 §3.2.1）：`PENDING`（未开始）、`RUNNING`（执行中）、`REPAIRING`（定向返工中）、`ILLUMINATED`（已点亮绿灯）、`FAILED`（失败红灯）、`BLOCKED`（上游失败级联阻断）、`STALE_REVERIFY`（失效待验灰灯）。
  2. **物理证据点亮与空验证集拦截 (`daemon/graph/illumination-verifier.ts`)**：
     - **物理点亮充要条件**：节点由灰变绿点亮，必须同时满足：① 对应受控 Worktree 产生了物理文件写入；② 关联的 `EvidenceBundle` 包含退出码为 0 的验证结果；③ 成功派生 Git Commit SHA 指纹；
     - **空验证集强拦截 (C-04)**：COMMAND 类型的节点若 `verification_commands` 为空或验证结果集为空，**坚决严禁全绿点亮**，状态保持为警告灰；
     - **外部改码级联失效**：当检测到外部文件修改使 Evidence 变为 `STALE` 时，相关任务节点由绿变灰并标记为 `STALE`，提示用户重新执行验证。
  3. **双重视图渲染与点亮动效 (`src/components/graph/TaskGraphViewer.tsx`)**：
     - **业务功能导图 (Functional Tree)**：树状/脑图展开展示一级模块与二级功能点；
     - **任务执行 DAG (Execution DAG)**：直观展示任务节点与依赖连线；
     - 监听 WebSocket 的 `TASK_GRAPH_UPDATED` 帧，当后台验证通过事件到达时，触发平滑翠绿过渡点亮动效（延迟 ≤ 100ms）；
     - 点击任何已点亮节点，可在抽屉中展开查看关联的 Git Diff 摘要与测试报告。
* **文件树规范资产专区**：左侧固定展示 `.stagent/specs/requirements.md`、`contract.json` 与 `.stagent/demo/` 原型入口；文件生成动效必须由真实文件系统变更事件驱动，不得由模型自报进度触发。
* **涉及核心文件（以实际落地为准）**：
  - 新增：`daemon/graph/graph-engine.ts`
  - 新增：`daemon/graph/illumination-verifier.ts`
  - 新增：`daemon/graph/evidence-collector.ts`（文件 / Scope / HEAD 现算，不接受调用方自报）
  - 新增：`src/lib/graph/task-graph.ts`（七态、提案类型、帧载荷与持久化守卫）
  - 新增：`src/components/graph/TaskGraphPanel.tsx`（双视图容器与 100ms 点亮动效）
  - 新增：`src/components/graph/FunctionalTree.tsx`
  - 新增：`src/components/graph/ExecutionDag.tsx`
  - 新增：`src/components/graph/graph-view-model.ts`
  - 新增：`src/components/FileTreeSpecsSection.tsx`（按 §5 路径映射约定落在 `src/components/`）
  - 修改：`daemon/server.ts`（`/api/graph*` 与 `TASK_GRAPH_UPDATED`）、`src/lib/ipc/frames.ts`、`src/lib/daemon-api.ts`、`src/hooks/use-daemon-stream.ts`、`src/routes/index.tsx`、`src/components/WorkspaceLayout.tsx`、`src/components/layout/ActivityBar.tsx`
  - 测试：`tests/unit/graph-engine-invariants.test.ts`（24 用例）
  - 测试：`tests/ui/task-graph-illumination.test.tsx`（7 用例）
* **Pass/Fail 验收判定**：
  - **PASS**：Supervisor 提案在 Schema 校验层成功剥离运行态；节点点亮严格绑定物理退出码 0 与 Commit SHA；空验证集的 COMMAND 节点无法被点亮；外部改码能触发节点变灰 STALE；页面刷新无损恢复点亮状态。
  - **FAIL**：前端通过 Mock 数据自行点亮节点；空验证集节点被显示为绿色已完成。

---

### 3.5b 全局保护清单与 Vibe 安全网 (Sprint 2)

<a id="task-p.1"></a>

#### 【Task P.1】全局保护清单与 Vibe 模式安全网 (v1.3.3 新增) `[用户已确认 D1 / D2 · 2026-10-20]`
* **任务编号**：`TASK-P.1`
* **前置依赖**：`TASK-D.1`
* **任务状态**：**[COMPLETED]**（2026-10-21 只读核验，状态校正：提交 `08e95da`「feat(p1): 全局保护清单、Vibe 安全网与门卫拦截」已合入 main 且为 HEAD 祖先。落地清单：`daemon/protection/protection-list.ts`（清单读写/自锁/模式判定/匹配/授权卡/待审批持久化/推荐/失败关闭/Prompt 注入/hook 请求队列）、`daemon/protection/auto-checkpoint.ts`（快照与整轮撤销）、`src/components/ProtectionCard.tsx`（推荐卡 + 同意卡）、`daemon/server.ts` 9 个 `/api/protection*` 端点、`daemon/mcp/gateway.ts:815` 强制门卫、`daemon/chat/session-manager.ts:226` Prompt 注入、`src/lib/perf-guards.ts:75` 自适应轮询。用例：`protection-silent-contract` 13 + `protection-endpoint` 1 + `gateway-protection` 3 全绿。**残余口径差（不阻塞验收，需登记）**：①「静默合同」当前为 `.stagent/silent-contracts.jsonl` 备案形态，非 `SoftwareContract` 正式落盘——与《P1 白话设计稿》第 5 条一致，但与架构 §0.6.3「后台自动静默生成合同与快照」字面表述存在口径差；②【撤销本轮改动】按 checkpoint 存在与否条件渲染，设计稿写「顶栏常驻」；③ 保护命中后自动进入完整合同 + Evidence 链未实现，合同仍由 UI 手动创建）
* **核心目标**：
  1. `.stagent/protection.json` 全局保护清单（路径 glob + 白话名称），UI 一键加锁/解锁；
  2. 首导入推荐：Supervisor 以规则扫描识别核心模块，弹出白话推荐卡片（"为您推荐锁定【登录】与【支付】模块，一键保护"）；
  3. **Prompt 前置注入**：组装 Worker Prompt 时直接注入已锁定保护清单，引导 AI 主动规避；
  4. **静默合同（Silent Contract）**：Worker 改动未触碰保护清单时，Daemon 后台静默生成合同与快照，前端不弹窗；触碰保护清单时抛出极简白话是/否卡片；
  5. **Vibe 安全网**：Agent 执行改动前 Daemon 自动生成轻量 Git 快照（Auto-Checkpoint）；UI 顶层常驻白话按钮【撤销本轮改动】；
  6. **User-First Discard Rule**：合并冲突永远以用户主分支版本为准，丢弃 Worktree 冲突改动并提示 AI 重新修改；不向用户展示 Git 冲突界面。
  7. **命中行为（任何模式，见架构 §0.6.5）** `[用户已确认 · 2026-10-20]`：先拦后写；多路径合并为一张卡并列出文件清单；同意仅覆盖本轮清单内文件，超出清单才弹补充卡（超出清单时弹出的补充卡属于同一次是/否授权的**补充授权**，计入"≤2"规则内，不另算一次交互）；不同意则拒写并让 AI 换方案；待审批状态跨断线/重启持久化、永不自动放行；验证全绿后一键合并、无二次确认。总交互 ≤ 2。
  8. **保护清单自锁**：`.stagent/protection.json` 本身恒受保护，仅可经 UI 开关修改；快照失败则本轮不开工。
  9. **撤销范围（v0.1 定稿）**：v0.1 撤销 = 回滚整轮快照：本轮开始后这些文件的所有改动（**包括用户本轮的手动修改**）一并撤回；撤销确认文案必须白话写明这一点。细粒度撤销（只撤 Agent 改动、保留手改）推迟至后续版本。
  10. **范围外说明**：锁定 AI 配置文件（`.claude/`、`.mcp.json`、`.cursor/`）不属于本卡验收项，若要纳入须另行更新任务卡与路径规则。
  11. **网关级只读绝对防御 (v1.4.0 新增)**：全局保护清单中声明的敏感核心文件为底层 Scoped Gateway 的不可覆盖只读层；即使用户在对话中输入授权，系统依然阻断对绝对禁区的破坏性操作。
* **涉及核心文件**：
  - 新增：`daemon/protection/protection-list.ts`
  - 新增：`daemon/protection/auto-checkpoint.ts`
  - 新增：`src/components/ProtectionCard.tsx`
  - 测试：`tests/unit/protection-silent-contract.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：保护路径在 VIBE 与 PROTECTED 下写入均被规则拦截（零模型调用）；无保护清单全程零弹窗；撤销按钮一键恢复现场；冲突时主分支版本永远胜出；触保护区任务交互 ≤ 2（一张清单卡 + 一键合并），同轮清单内不重复弹窗；待审批断线/重启后不自动放行；门卫出错/超时按拒绝处理，且原生工具、Shell、改名/删除、符号链接四类绕过负例均失败关闭。
  - **FAIL**：保护路径被静默写入；出现 Git 冲突解决界面；弹窗超过一个是/否问题；同轮清单内文件重复弹窗；待审批被自动放行；合并出现二次确认。

---


---

### 3.6 控制面 API 补齐、快照持久化与合并核销（Sprint 3；前置 C.5/P.1/W.4 于 Sprint 2 完成）

<a id="task-d.2"></a>

#### 【Task D.2】控制面 API 补齐、合并门禁（一键合并）与 Git Trailer 审计
* **任务编号**：`TASK-D.2`
* **前置依赖**：`TASK-D.1`, `TASK-W.4`, `TASK-C.5`, `TASK-P.1`（v1.3.3：移除已推迟的 `TASK-B.2`）
* **任务状态**：**[COMPLETED]**（2026-10-21 步骤 D 收口。**已落地**——控制面 `approve` / `execute` / `run-worker` / `merge` / `resume` / `abort` / `diff-files` / `evidence` 端点（`daemon/server.ts` 中对应控制面路由处理器（以 handler 名称为锚点，行号易漂移））；`squashMerge` 门禁链 Gate 0~4（AUDITED、Evidence 快照存在且同合同、STALE 阻断、Worktree 指纹复核 `assertEvidenceIntegrity`、主树 clean、重复合并防御）；4 条标准 Git Trailer（`daemon/pipeline/merger.ts` 中 Trailer 构造常量/函数）；User-First Discard 冲突仲裁（`daemon/pipeline/merger.ts` 中 User-First Discard 处理器（以函数名为锚点），含 `nothingToMerge` 兜底）；前端一键合并无二次确认（`index.tsx:1014`）。**核心目标 1（原缺口 G-1）已闭环**（`9691b23`，合并 `742d27d`）：`daemon/protection/protection-list.ts` 新增 `intersectWithProtection()`（见证路径 `witnessPath()` + glob 双向覆盖判定 + 清单解析异常一律返回 `hit:true` 的失败关闭）；`daemon/pipeline/orchestrator.ts` 新增 `admit()`，产出 `AUTO_APPROVED` / `AUTO_APPROVAL_FAILED` / `NEEDS_APPROVAL` / `SKIPPED` 四态，无交集或本轮全部同意且无拒绝时自动 `approve()`（`approved_by: "stagent-auto"`）并写 `contract_auto_approved`，门卫异常写 `contract_admission_fail_closed` 阻断，**拒绝优先于同意**；`POST /api/contracts` 创建即准入（响应回传 `admission`），新增 `POST /api/contracts/:id/admit`（`NEEDS_APPROVAL` 返回 202）；并发撞状态机以 `SKIPPED` 兜底不误报失败。`tests/unit/contract-auto-approve.test.ts` 9 用例绿（空清单/无交集/glob×glob/具体路径/本轮同意/本轮拒绝/清单损坏/清单自锁/幂等），全量基线 **682 通过 / 4 跳过**。**残余（不阻塞 v0.1）**——`resume` 在"触碰保护清单时要求新审批版本"未实现：当前 `PENDING_RESUME → EXECUTING` 不区分是否触碰清单，即始终不重批（未触清单的"不重批"减负已满足，触碰清单的"应重批"缺失），与 P.1「静默合同」口径统一一并列为 v0.2+ 待办。）
* **核心目标**：
  1. `POST /api/contracts/:id/approve`：校验 `contract_revision` 与授权指纹（防 TOCTOU），原子推进双状态并创建 Worktree。**v1.3.3 减负**：合同 Scope 与全局保护清单**无交集时自动批准**（记录备案，无需用户点击）；有交集时向用户发**至多一个**白话是/否问题。
  2. `POST /api/contracts/:id/resume`：**双路径裁决负例断言 (G-14)**：
     - 安全违规类 (`SCOPE_VIOLATION`, `UNAUTHORIZED_COMMAND`, `UNSAFE_EXECUTION`) 调用 resume 返回 `409 Conflict`；
     - 预算类 resume：**v1.3.3 减负**——未触碰保护清单时不重批、只记录备案，恢复前后重试计数与累计开销保持连续；触碰保护清单时才要求新审批版本。
  3. `POST /api/contracts/:id/abort` 与 `reject` 接口。
  4. **并发互斥与工作区互斥锁守卫 (G-21)**：
     - 依据 A §6.4(2) 与互斥锁规范，同合同并发冲突返回 409 / `E_WORKSPACE_LOCKED` 并生成 BLOCKED 证据。
  5. **合同与证据快照持久化 (闭环 G-05)**：
     - 合并核销成功后，将合同快照写入 `.stagent/contracts/{contract_id}.json`，证据快照写入 `.stagent/evidence/{contract_id}-{evidence_id}.json`，文件模式严格设为 `0600`。
  6. 严格执行合并门禁（Gate 0 受控源 ➔ Gate 1 主树 Clean ➔ Gate 2 状态通过 ➔ Gate 3 实时指纹复核 ➔ Gate 4 测试完整性）。**v1.3.3 修订**：删除 Gate 5 二次确认弹窗，`can_merge=true` 时**一键合并**；Gate 3 实时指纹复核保留为 Daemon 后台兜底，用户不可见。**合并冲突仲裁（User-First Discard Rule）**：发生 Git 冲突时永远以用户主分支当前版本为准，直接丢弃 Worktree 冲突改动并提示 AI 重新基于最新代码修改，不向用户展示冲突解决界面。
  7. 写入 A §5.2 的 4 个标准 Git Trailer（`Audited-By`, `Stagent-Contract-ID`, `Stagent-Evidence-ID`, `Stagent-Verdict`），执行 Squash Merge 并清理 Worktree。
* **涉及核心文件**：
  - 修改：`daemon/server.ts`
  - 修改：`daemon/pipeline/merger.ts`
  - 修改：`daemon/pipeline/evidence-verifier.ts`
  - 修改：`daemon/pipeline/orchestrator.ts`（`admit()` 准入判定，步骤 D 新增）
  - 修改：`daemon/protection/protection-list.ts`（`intersectWithProtection()` / `witnessPath()`，步骤 D 新增）
  - 测试：`tests/unit/contract-auto-approve.test.ts`（步骤 D 新增，9 用例：无交集自动批准 / 拒绝优先 / Fail-Closed / 幂等）
  - 已存在的相关覆盖（按本轮代码对照报告核验）：`tests/integration/contract-api.test.ts`、`tests/integration/resume-abort.test.ts`、`tests/daemon/merger.test.ts`、`chaos-concurrency.test.ts`、`tests/unit/contract-auto-approve.test.ts`；后续新增测试必须确认仓库目录与文件名后再登记。
  - 本卡不再引用不存在的 `control-plane-approve/merge-gates/resume/concurrent-lock.test.ts` 文件名。
* **Pass/Fail 验收判定**：
  - **PASS**：
    - 边界违规合同调用 resume 必然返回 409。
    - **双门禁合入门槛严格校验 (v1.4.0 新增)**：
      * 校验 EvidenceBundle 携带的 `target_commit_sha` 与 Worktree HEAD 的 Commit SHA 严格一致，防止代码变动后复用旧证据；
      * 合并执行瞬间执行目标分支基线漂移校验（`git merge-base --is-ancestor <base_sha> <target_branch_head>`），若目标分支已推进，跃迁至 `CONFLICT` 并安全阻断合并；
    - **异步停止端点 `/api/task/stop` (v1.4.0 新增)**：接收停止请求后立即置状态为 `STOPPING`，发送 SIGTERM 优雅退出并在 5 秒后 SIGKILL，释放工作区锁后置为 `ABORTED`；
    - 主树 Dirty、Evidence STALE 或 Agent 非受控时 Merge 坚决拒绝。
    - 合并成功后，Commit 包含 4 个标准 Trailer，且 `.stagent/contracts/` 与 `.stagent/evidence/` 快照文件完整落地。
  - **FAIL**：残留 `X-Stagent-*` 临时键；合并后未写入规范快照；SHA 不一致或基线漂移时仍允许合并。

---


---

<a id="task-d.2b"></a>

#### 【Task D.2b】未跟踪文件合并门禁与 Contract v1.3 零静默迁移接入
* **任务编号**：`TASK-D.2b`
* **前置依赖**：`TASK-0.2c`, `TASK-D.2`, `TASK-W.2b`
* **任务状态**：**[COMPLETED]**（2026-10-23，提交 `150dc47`；`npm run typecheck` 0 error，新增 `tests/daemon/merger-d2b-gates.test.ts` 10 例全绿，定向回归 86 例与扩展回归 23 例全绿）
* **范围**：在合并前复核完整工作树范围，阻断合同外未跟踪文件；接入 `migrateContractToV13`，确保旧合同加载时不发生静默授权。该卡不重开 TASK-D.2 已完成的控制面主体。
* **Git Trailer 边界**：沿用已完成 D.2 的单条 ≤512B、合计 ≤4KB 限制；若仓库当前实现/测试事实不符，应先作为差异报告，不把既有完成声明当作新增实现。
* **交付事实与差异报告（2026-10-23）**：
  1. **D.2 并未实现该限制**：`merger.ts` 中不存在任何 Trailer 尺寸度量、常量或断言，D.2 交付的仅是「写入 4 个 Trailer 字段」。本卡新增 `measureTrailerBounds` / `assertTrailerBounds` 与常量 `MAX_TRAILER_LINE_BYTES = 512`、`MAX_TRAILER_BLOCK_BYTES = 4096`，属**新增实现**。
  2. **文档口径冲突**：架构规范 §5.2 写「单条 ≤1024B、合计 ≤4096B」，本卡与裁决写「单条 ≤512B、合计 ≤4KB」。经裁决取**更严格**的 512 并已在代码注释留痕；若后续对齐 §5.2，只需改一个常量。
  3. **旧合同的实际缺口不是「静默授权」而是「读不出来」**：原 `ContractStore.get()` 直接用 v1.3.0 Schema 解析 v1.2.0 文件，失败即返回 `null`，合并时报 `E_CONTRACT_NOT_FOUND`。本卡改为 `getWithMigration` 内存迁移（不写盘），并由 `migration.requiresReapproval` 派生 `E_CONTRACT_REQUIRES_REAPPROVAL` 阻断核销。
* **涉及核心文件**：修改 `daemon/pipeline/merger.ts`、合同加载/迁移调用点及相关测试；测试路径按仓库实存文件核定，避免引用未创建的文件名。
* **Pass/Fail**：PASS：已跟踪和未跟踪文件均参与 Scope 检查；超范围即拒绝合并并产生稳定错误码；DRAFT/PENDING_APPROVAL 历史合同绝不被迁移为 APPROVED；执行态历史合同按明确白名单迁移；FAIL：使用旧 Evidence 或未授权合同仍可合入。

### 3.7 端到端集成与自举发版（v0.1 基线已完成；后续扩展另开卡）

<a id="task-e.1"></a>

#### 【Task E.1】双 Agent 协同与全流程 E2E 自动化测试
* **任务编号**：`TASK-E.1`
* **前置依赖**：`TASK-D.2`
* **任务状态**：**[COMPLETED]**（提交 `c82a7bb`；`tests/e2e/dual-agent-workflow.test.ts`、`tests/e2e/fault-injection-regression.test.ts` 已存在）
* **核心目标**：
  1. Happy Path 全生命周期无人值守自动化回归。
  2. **覆盖 8 类故障分支自动化拦截 (闭环 G-07)**：
     - 故障 1：超时重试熔断；
     - 故障 2：测试文件未经授权篡改阻断；
     - 故障 3：外部手动修改触发 Evidence STALE 阻断；
     - 故障 4：主树 Dirty 阻断合并；
     - **故障 5（v1.3.3 限定）：保护模式下，未批准合同尝试触碰保护资产必须被拒绝**（Vibe 模式下无合同门槛，不适用本条，但保护清单拦截恒生效）；
     - **故障 6：Supervisor 建议尝试直接触发执行必须被拒绝**；
     - **故障 7：Worker 完成声明不得直接改变状态为 PASSED**；
     - **故障 8：外部非受控 Agent 的输出严禁作为受控 Evidence 通过**。
  3. **Vibe 模式新增用例（v1.3.3）**：
     - 新项目、无保护清单、无合同：Agent 新建/修改文件并运行测试，全程零弹窗零审批，Header 显示"自由模式"；
     - Auto-Checkpoint 生成与【撤销本轮改动】一键恢复现场；
     - 保护路径在 VIBE 与 PROTECTED 下写入均被规则拦截；
     - 未触保护区任务用户交互次数 = 1（合并按钮）；触保护区 ≤ 2（一个是/否 + 合并）；
     - 合并冲突时 User-First Discard：以主分支为准丢弃 Worktree 冲突改动。
* **涉及核心文件**：
  - 新增：`tests/e2e/dual-agent-workflow.test.ts`
  - 新增：`tests/e2e/fault-injection-regression.test.ts`
* **Pass/Fail 验收判定**：
  - **PASS**：全链路 E2E 退出码为 0；8 类故障分支全部断言成功触发阻断。
  - **FAIL**：出现任何安全越权或测试挂起。

---


---

<a id="task-e.2"></a>

#### 【Task E.2】Stagent 仓库自举 (Dogfooding) 与发版交付
* **任务编号**：`TASK-E.2`
* **前置依赖**：`TASK-E.1`
* **任务状态**：**[COMPLETED]**（提交 `9b15c20`、`178a8a6`）
* **⚠️ 文档事实校正（2026-10-27）**：本卡原文宣称「报告 `docs/reports/v0.1-dogfooding-report.md` 在位」。该报告已于 **2026-10-25 `docs/reports/` 目录精简时删除**，当前仓库中**不存在**。为杜绝事实性错误，此处按 D-7 裁决更正：
  - **本卡的验收证据** = 提交 `9b15c20` / `178a8a6` + `npm run build` 生产构建 0 错误 + 自举 Commit 含 4 个 Trailer；
  - **不再引用任何已删除的报告路径**；历史自举结论如需复核，以 git 历史中该文件的末次快照为准。
* **核心目标**：
  1. 在 Stagent 自身代码库中通过本地工作台完成真实自举演练。
  2. 输出自举演练结论，客观披露实际开销与平台边界（**原报告 `v0.1-dogfooding-report.md` 已于 2026-10-25 目录精简时删除**，结论不再以独立文件承载）。
  3. 执行 `npm run build`，产出完整干净的生产发行包。
* **涉及核心文件**：
  - 产出：自举 Commit（含 4 个 Trailer）与生产构建产物（**原新增报告已随 2026-10-25 目录精简删除**）
  - 产出：`package.json`（v0.1.0）、生产 dist 目录
* **Pass/Fail 验收判定**：
  - **PASS**：自举 Commit 合规包含 4 个 Trailer，CLI 输出正常，生产构建 0 错误。
  - **FAIL**：生产构建失败或缺少依赖。

---


### 3.4e 台账前置交付（C.22 / W.8）

<a id="task-c.22"></a>

#### 【Task C.22】合同 schema references[] 字段 `[COMPLETED]`
* **任务编号**：`TASK-C.22`
* **状态与证据**：`[COMPLETED]`（[#67](https://github.com/he18718143986-design/IDE/pull/67)/`014cbfc`，squash merge）。
* **交付**：合同顶层可选 `references: string[]` URL 数组；SchemeDraft 和签署投影透传；不可变 scheme snapshot 冻结并将 references 纳入摘要。兼容缺省与空数组，拒收非法 URL。
* **验证**：PR 报告 7 项专用测试通过；相关回归 80 项通过；`git diff --check` 通过。以上为 PR 报告的验证结果。
* **关键文件**：`src/lib/contract.schema.ts`、`src/lib/journey/scheme-draft.ts`、`src/lib/journey/confirm-scheme-contract.ts`、`daemon/pipeline/scheme-snapshot-store.ts`、`tests/unit/contract-schema-references.test.ts`。

<a id="task-w.8"></a>

#### 【Task W.8】Worker 侧 Stagent MCP HTTP 端点 `[COMPLETED]`
* **任务编号**：`TASK-W.8`
* **状态与证据**：`[COMPLETED]`（[#68](https://github.com/he18718143986-design/IDE/pull/68)/`090e5c1`，squash merge）。
* **交付**：Daemon 提供 MCP HTTP/SSE 端点；Worker strict MCP 配置挂载受管端点，首批仅 `stagent_web_ingest`；工具调用复用 Gateway 校验、权限与审计路径；右栏 Partner 维持隔离且未开放外部 MCP。
* **安全决策留痕**：Worker MCP 使用专用 `mcpToken`，通用路由 `isAuthorized` 只识别 session token，MCP token 不具备通用路由授权能力；MCP 路由另走 `isMcpAuthorized` 双轨校验。此处是刻意的最小权限隔离，不以路由前缀作为唯一边界。
* **残余边界 / 后续观察**：
  1. `claude-code-adapter.ts` 的 token 解析顺序仍为 `opts.authToken` → `STAGENT_MCP_TOKEN` → `STAGENT_SESSION_TOKEN`。Worker 正常注入首项；若环境中仍设置 session token，最后一级回退可能放宽权限。建议后续移除回退或另立修复。
  2. `mcpToken` 访问 `/api/shutdown` 返回 401 的双轨路由行为测试使用手写 mock server，不是真实 daemon 路由；作为协议参照即可。真实 `StagentDaemon` 实例测试验证了 Worker 生成的 `mcp.json` Authorization 使用 `mcpToken`，但这不是对真实 shutdown 路由拒绝的直接覆盖。建议为 mock 测试添加该边界说明，后续补真实路由测试。
* **验证**：PR 报告 7 项 MCP endpoint 测试、47 项 Gateway 回归测试通过，`git diff --check` 通过；此处为 PR 报告，并非本次重新运行。
* **关键文件**：`daemon/mcp/http-server.ts`、`daemon/mcp/gateway.ts`、`daemon/server.ts`、`daemon/worker/cli-host/claude-code-adapter.ts`、`tests/unit/mcp-http-endpoint.test.ts`。
---

### 3.4d 北极星受控摄取交付（L.17a）

<a id="task-l.17a"></a>

#### 【Task L.17a】受控摄取与代登代理 `[COMPLETED]`
* **任务编号**：`TASK-L.17a`
* **状态与证据**：`[COMPLETED]`（[#70](https://github.com/he18718143986-design/IDE/pull/70)/`8516c3d`，squash merge）。
* **对应规格**：ADR-0014 §3；`scheme.md` goal-2、conf-6、dec-13、oq-3；[`delivery-lifecycle.md`](./delivery-lifecycle.md) M5
* **交付内容**：
  1. Daemon 受控只读 GET 代理（`daemon/web-ingest/proxy.ts`），域名白名单精确匹配合同顶层 `references[]`（C.22），未授权域名返回 403 `E_WEB_INGEST_FORBIDDEN_DOMAIN`，非 GET 请求返回 405 `E_WEB_INGEST_METHOD_NOT_ALLOWED`。
  2. 防御资源滥用与攻击：响应大小限制（Content-Length 预检 + 流式大小双保险，超限 413 `E_WEB_INGEST_PAYLOAD_TOO_LARGE`），突发与分钟级速率限制（429 `E_WEB_INGEST_RATE_LIMITED`）。
  3. **302 重定向逐跳白名单防线**：`fetch` 显式设置 `redirect: "manual"`，拦截 3xx 重定向并对 Location 目标逐跳重新校验 `references[]` 白名单（上限 3 跳），彻底封堵借合法域名跳转绕过白名单的旁路。
  4. **Worker 请求头防注入**：强制过滤请求头中的 `Cookie` / `Set-Cookie` / `Authorization`，Daemon 会话凭据优先级强制覆盖，杜绝 Worker 注入或篡改 Session。
  5. **dec-13 凭据生命周期与静默重登闭环**（`daemon/web-ingest/auth-session.ts`）：
     - 条款 1：Vault 凭据由用户管理至手动删除，项目切换或会话结束仅清理内存会话，不联动清理 Vault。
     - 条款 2：上游 401/403 触发 Daemon 读取 Vault 账密静默代登重试一次，Worker 全程无感知。
     - 诚实鉴权失败：代登无 `Set-Cookie` 或失败时抛出 401 `E_WEB_INGEST_AUTH_FAILED`，绝不伪造凭据。
  6. **零账密泄漏**：`sanitizeForWorker` 深度脱敏 Vault 活跃值、JSON 字段及内存 Session Cookie，Worker 环境与日志零明文。
  7. 接通网关：替换 `daemon/mcp/gateway.ts` 的 `E_INGEST_NOT_WIRED` 临时阻断为真实受控 Proxy 调用。
* **残余边界 / 后续挂账**：
  1. `request.headers` 目前已对敏感头做严格剥离过滤；当前 gateway 调用暂不传 headers，未来若不需要自定义头可彻底裁剪该字段。
* **验证**：31 项专用测试全部通过（`web-ingest-proxy.test.ts`、`web-ingest-auth.test.ts`、`web-ingest-lifecycle.test.ts`、`web-ingest-relogin.test.ts`、`mcp-http-endpoint.test.ts`、`contract-schema-references.test.ts`）。
* **关键文件**：`daemon/web-ingest/proxy.ts`、`daemon/web-ingest/auth-session.ts`、`daemon/mcp/gateway.ts`、`daemon/vault/vault.ts`、`tests/unit/web-ingest-proxy.test.ts`、`tests/unit/web-ingest-auth.test.ts`、`tests/unit/web-ingest-relogin.test.ts`。

---

### 3.4f 北极星对话试玩与证据桩交付（L.17b · M5 主序收官）

<a id="task-l.17b"></a>

#### 【Task L.17b】对比视图与试玩证据桩 `[COMPLETED]`
* **任务编号**：`TASK-L.17b`
* **状态与证据**：`[COMPLETED]`（[#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`，squash merge；分支阶段 HEAD `9c75af9`）。**M5 北极星主序（L.16 → L.17a → L.17b）至此全部落完**。
* **对应规格**：ADR-0014 §3；`scheme.md` goal-2、dec-12、oq-2、acc-6、gap-11；[`delivery-lifecycle.md`](./delivery-lifecycle.md) M5
* **前置依赖**：`TASK-L.17a`（COMPLETED · #70/`8516c3d`）+ `TASK-L.16`（COMPLETED · #62/`e4dfe1c`，复用「让 AI 看看」通道做试玩引导）
* **交付内容**：
  1. **对比视图 `src/components/project/CompareView.tsx`**：左栏参考站抓取成果（HTML 快照 / DOM 摘要 / 截图预览），右栏 `iframe` 直连真机 / LIVE 预览端口并保留外链直达；**仅复用 lib 层 `realPlaytestIframeProps`**，不引入 studio 层 `RealPlaytestPane` 布局依赖；标题栏明写「仅供人眼对照 · 不做自动比对」——**像素 / DOM 量化机器比对不复活（REJ-009）**。
  2. **右栏试玩引导 `src/lib/journey/playtest-guidance.ts`**：复用 L.16「让 AI 看看」通道（`origin:system` 插桩 + `classifyJourneyIntent` 分流），引导用户对照参考站试玩、提修改意见；修改意见回流微合同修正闭环，路由结论**不带可执行动作**；引导消息维持只读白名单（`read_only:true` / `executable:false` / `permissions:[]`）。
  3. **证据客户端 `src/lib/journey/playtest-evidence.ts`**：仅 zod schema + `submitPlaytestEvidence()` 客户端调用；不 import `node:fs`、不直碰 `.stagent/`。
  4. **Daemon 证据端点与原子落盘**：`POST /api/playtest/evidence`（`daemon/playtest/evidence.ts` + `daemon/server.ts`）请求体**只收** `contract_id + user_verdict`（非空原话，空/缺省/空白三态均拒）；`release_id`（服务端从当前 LIVE 记录解析）/`timestamp`(ISO 精确)/`operator:"user"` 全部服务端装配，请求体携带任一装配字段即判伪造拒绝（400 `E_PLAYTEST_FORGED_FIELD`），无 LIVE 返回 409 `E_PLAYTEST_NO_ACTIVE_RELEASE`；落盘 `.stagent/evidence/playtest-{contract_id}.json` 经 `writeJsonAtomic`（临时文件 → fsync → rename → 目录项 fsync），禁裸 `writeFileSync(finalPath)`。
  5. **版本指纹单一事实源 `daemon/release/active-live.ts`**：独立只读解析当前 LIVE `release_id`，**刻意不 import `release-manager`**，避开 `vault/keychain-backend → node:child_process` 闭包，令 `daemon/supervisor/**` 零工具 lint 不新增违规。
  6. **门禁 `check playtest`**：`bin/stagent.ts` 注册子命令，委托 `daemon/supervisor/preview/playtest-guard.ts` 单一判定源。证据 `release_id` 与当前 LIVE 不匹配 → `STALE_VERSION` + `reset_approval:true`（旧认可即刻失效，不跨版本穿透）；合同无 `references[]` / 非北极星场景 → 明确 `NOT_NORTHSTAR_SCENARIO`，**不静默 PASS**；检查**不碰 canvas 模块**。
* **不变声明**：右栏只读工具白名单不变；AI 仅做引导不代判；证据必须经用户明确表态（原话）后由服务端装配生成；机器自动比对不复活。
* **验收（PASS）**：四组 `tests/unit`（`compare-view` / `playtest-guidance` / `playtest-evidence` / `playtest-reset`）**33 passed**；含真实 HTTP daemon 接线（401 未鉴权 / 400 伪造字段 / 400 空原话 / 201 有效原话且 `release_id` 服务端填入）；核心用例「同 `contract_id` 不同 `release_id` → `STALE_VERSION`」非「文件不存在」退化路径。`npx tsc --noEmit` 全仓 57 个 `error TS` 与 clean `main` 基线一致，新增/修改文件 0 报错。
* **残余边界 / 后续挂账（P-112 归拢，共 6 条）**：
  1. **`resolveCurrentLiveReleaseId` 回退语义**：合同 `contract_ids` 无匹配时回退「最近一条 LIVE」——多合同仓里合同 A 的认可可能绑到合同 B 的发布上。方向保守（绑错后版本变更照样 `STALE_VERSION`，逼重新认可而非误放行），但语义是「最新 LIVE 即当前版本」而非「本合同的 LIVE」，**多合同场景证据绑定粒度粗**。
  2. **合同文件名口径不一致**：`readContractReferences` 用原始 `contractId + ".json"`（不做别名归一），而 `playtestEvidencePath` 对 `contract_id` 做字符归一；两套命名约定并存，含特殊字符的 `contract_id` 会读不到合同文件但写得了证据。实际合同 id 受控生成，风险低。
  3. **每合同只留最新证据**：`playtest-{contract_id}.json` 覆盖写、无历史链；重新认可后旧证据丢失，审计上只有「当前认可」没有「认可历史」。dec-12 未要求历史，可接受。
  4. **（W.8）`claude-code-adapter.ts` token 回退**：解析顺序仍为 `opts.authToken` → `STAGENT_MCP_TOKEN` → `STAGENT_SESSION_TOKEN`；环境中若仍设 session token，最后一级回退可能放宽权限。建议后续移除回退或另立修复。
  5. **（W.8）`/api/shutdown` 401 双轨路由测试用手写 mock**：不等同真实 daemon 路由；真实 `StagentDaemon` 实例测试验证了 `mcp.json` Authorization 使用 `mcpToken`，但非对真实 shutdown 拒绝的直接覆盖。建议补边界说明与真实路由测试。
  6. **（L.17a）`request.headers`**：已对敏感头做严格剥离过滤；当前 gateway 调用暂不传 headers，未来若不需要自定义头可彻底裁剪该字段。
  > 另：**`check playtest` 目前是独立命令、尚未被任何 verification profile 引用，合约验收要不要调用它属后续配置面**——本卡未擅自登记为正式挂账，待裁决。
* **未宣称 / 未接线（不宣称端到端闭环）**：`CompareView` 未挂载进任何 UI 路由；用户原话采集 UI 未实现（右栏引导仅提示，不含提交动作）；`check playtest` 尚未被 verification profile 引用。**本卡交付组件 + lib + 端点 + 门禁判定源，端到端 UI 串联与真机端口联调属后续。**
* **关键文件**：`src/components/project/CompareView.tsx`、`src/lib/journey/playtest-guidance.ts`、`src/lib/journey/playtest-evidence.ts`、`src/lib/daemon-api.ts`、`daemon/playtest/evidence.ts`、`daemon/release/active-live.ts`、`daemon/supervisor/preview/playtest-guard.ts`、`daemon/server.ts`、`bin/stagent.ts`、`tests/unit/compare-view.test.ts`、`tests/unit/playtest-guidance.test.ts`、`tests/unit/playtest-evidence.test.ts`、`tests/unit/playtest-reset.test.ts`。
