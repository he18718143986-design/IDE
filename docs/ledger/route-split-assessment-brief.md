# 路由拆分评估（P-255）

> **地位**：planning brief（2026-11-21 · 香港时间）。授权来源为 Tina「路由拆分评估（只评估不动代码）」。
> **本条只评估结构**：不开施工卡、不改 `daemon/server.ts`、不改 `src/routes/index.tsx`、不改行为。
> **建议口径**：下文凡写「建议」的句子都是 `ai_inferred`。拍板在业主。
> **行号基线**：`main`@`07c3539cdf32c7893a766d17c7681fb346fd6e74`。`daemon/server.ts` 7319 行；`src/routes/index.tsx` 4591 行。

## 1. 一句话结论

**建议暂缓整文件一次拆完。**（`ai_inferred`）若业主点名开工，只立第一批：把 `handleHttpRequest` 里仍内联的合同创建、准入、批准、执行、合入抽成带名字的函数。`Console` 不是 URL 路由表，不进这张卡。

## 2. 分发函数在哪

`DaemonServer.handleHttpRequest` 在 `daemon/server.ts` 第 4984–7076 行。它先做 Host / 预览来源 / CORS / OPTIONS，再按 `pathname` 一条条 `if` 返回。文件里另有已经抽出去的 `handle*` 方法；前门只负责鉴权后转交。审计上难受的是还留在这个函数里面的合同动作，不是已经转交的那些前缀。

`src/routes/index.tsx` 只有一条 TanStack 路由：`createFileRoute("/")`（第 248 行）。`Console` 从第 331 行到第 4273 行之前。同目录还有 `__root.tsx`，没有第二套 URL 表。所谓「Console 侧路由」是这一个组件里的确认、批准、执行、恢复等回调和按钮，不是路径分发。

## 3. 路由清单

行号是分支开始行。职责只写这一支做什么。

### 3.1 前门（所有 `/api` 之前）

| 分支 | 行 | 职责 |
| :--- | ---: | :--- |
| 非回环 Host | 4988 | 拒绝，防 DNS 重绑定 |
| Demo 预览来源 | 4997 | 403，必须在 CORS 之前 |
| 真预览来源 | 5004 | 403，同上 |
| 回环 CORS | 5043 | 给本机控制台加跨端口头 |
| `OPTIONS` | 5053 | 204，不进业务 |
| `GET /health`、`GET /api/status` | 5059 | 进程与分支状态，不鉴权 |
| 静态资源兜底 | 7066 | API 都未命中时托管 `dist/public` |

### 3.2 合同生命周期

都在 `pathname.startsWith("/api/contracts")`（第 6115 行）里面，鉴权一次。

| 分支 | 行 | 职责 |
| :--- | ---: | :--- |
| `GET /api/contracts` | 6126 | 列出合同 |
| `POST /api/contracts` | 6131 | 创建合同：对快照、演示门、准入、写授权清单、回填计划桩 |
| `POST …/scope-revision` | 6289 | 改写范围并派生新修订 |
| `GET/DELETE …/gateway-violation` | 6359 | 读或清除网关越界记录 |
| `…/rework` 及 `/failure` `/assertions` `/split` | 6395 | 返工计数、记失败、加断言、拆断言 |
| `GET /api/contracts/:id` | 6540 | 读一份合同 |
| `GET …/evidence` | 6551 | 读证据 |
| `POST …/admit` | 6564 | 准入裁决 |
| `POST …/approve` | 6579 | 批准开工 |
| `POST …/run-worker` | 6699 | 派工 |
| `POST …/merge` | 6735 | 凭证据快照合入；成功后收预览、关轮、回填桩 |
| `POST …/merge-decision` | 6814 | 目标分支已前进时二选一 |
| `GET …/diff-files`、`GET …/diff` | 6857、6883 | 读差异 |
| `POST …/open-editor` | 6917 | 打开编辑器 |
| `POST …/resume` | 6934 | 从挂起恢复 |
| `POST …/return-to-pending` | 6945 | 已审退回待批 |
| `POST …/abort` | 6963 | 中止：停预览、停证据监听、桩改 aborted |
| `POST …/execute` | 7021 | 跑工序验收；通过后武装证据监听 |

`POST /api/contracts`、`merge`、`execute`、`abort` 的放行条件写在这些 `if` 里面，没有单独的具名函数。

### 3.3 确认与合入（方案侧，已是独立方法）

| 分支 | 行 | 职责 |
| :--- | ---: | :--- |
| `POST /api/supervisor/scheme/freeze` | 6061 | 转 `handleSchemeSnapshot`（2322 行起）：冻结快照 |
| `POST /api/supervisor/scheme/backlink-preview` | 6052 | 转 `handleSchemeBacklinkPreview` |
| `POST /api/supervisor/scope/preflight` | 6070 | 转 `handleScopePreflight` |
| `POST /api/supervisor/draft` | 6079 | 转 `handleSupervisorDraft`：只读草案 |
| `POST /api/supervisor/turns` | 6033 | 转 `handleSchemeTurnRegister` |
| `POST /api/supervisor/journey` | 6024 | 转 `handleSupervisorJourney`（4400 行起） |
| `POST /api/supervisor/dispute` | 5921 | 转 `handleSupervisorDispute` |
| `GET /api/supervisor/scheme-acceptance` | 5930 | 验收条目只读投影 |
| `GET /api/supervisor/scheme-midpane` | 5948 | 中栏只读投影 |
| `POST /api/supervisor/surface-log` | 5966 | 转 `handleSurfaceLog` |
| `POST /api/supervisor/prototype` | 6015 | 转 `handleSupervisorPrototype` |

合入本身在 §3.2 的 `merge` / `merge-decision`，不在这组。

### 3.4 工序验收与试玩

| 分支 | 行 | 职责 |
| :--- | ---: | :--- |
| `GET /api/playtest/status` | 5743 | 试玩门禁只读 |
| `POST /api/playtest/evidence` | 5773 | 写入试玩证据，时间与操作者由服务端填 |
| `GET /api/playtest/reference-snapshots` | 5799 | 参考站快照只读 |
| `POST /api/preview/real/start` `/stop` `/status` | 5975 | 转 `handleRealPlaytest`（3690 行起） |
| `POST …/execute` | 7021 | 见 §3.2 |

### 3.5 证据与记录

| 分支 | 行 | 职责 |
| :--- | ---: | :--- |
| `/api/records` 前缀 | 5894 | 转 `handleRecords`（7183 行起）：导出、清理 |
| `/api/baseline` 前缀 | 5903 | 转 `handleBaseline`（7220 行起）：读、扫描、接受 |
| `GET /api/worktree/files` | 6088 | 转 `handleWorktreeFiles` |
| `GET /api/trace/why` | 5571 | 按行反查这段为什么存在 |
| `POST /api/client-events` | 6043 | 转 `handleClientEvents` |

### 3.6 其他（已按前缀转交或仍内联）

| 分支 | 行 | 职责 |
| :--- | ---: | :--- |
| `POST /api/session/relaunch` | 5083 | 无钥匙重开，故意不鉴权 |
| `GET /api/state` | 5088 | 读界面快照 |
| `GET /api/adapters` | 5102 | 列出已注册适配器 |
| `/api/workers` | 5123 | 转 `handleWorkers`（2071 行起）：列表、注册、探测 |
| `GET /api/repo/tree` | 5133 | 文件树 |
| `POST /api/repo/delete` `/create` `/rename` `/git-init` `/reveal` | 5152–5310 | 资源管理器写与揭示，内联 |
| `GET /api/arch/graph` | 5346 | 架构图 |
| `GET /api/settings`、`POST /api/settings/openai-key` | 5365、5374 | 读设置、写模型钥匙，不回显钥匙 |
| `GET /api/project/plan` | 5406 | 读计划 |
| `POST /api/project/plan/patch` `/decompose` | 5434、5516 | 改计划、分解，内联 |
| `GET /api/knowledge/modules` `/impact` | 5622、5668 | 知识库只读，内联 |
| `/api/design` | 5710 | 转 `handleDesign`（1606 行起）：依赖意外的读、允许、拒绝 |
| `/api/mcp` | 5720 | MCP 令牌，转 `mcpServer` |
| `/api/releases` | 5733 | 转 `handleReleases`（1891 行起） |
| `GET/PUT/DELETE /api/vault` | 5817–5873 | 保险库，内联，不回明文 |
| `/api/graph` | 5912 | 转 `handleTaskGraph`（3333 行起） |
| `/api/protection` | 6097 | 转 `handleProtection`（2999 行起） |
| `/api/chat` | 6106 | 转 `handleChat`（3164 行起） |
| `/api/desktop/pick-folder`、`create-empty-project` | 5988、5997 | 转对应方法 |
| `/api/recent-projects` | 6006 | 转 `handleRecentProjects` |
| `POST /api/shutdown` | 7051 | 鉴权后异步停进程 |

### 3.7 Console 动作（不是 URL）

| 动作 | 行 | 职责 |
| :--- | ---: | :--- |
| `handleConfirmScheme` | 1488 | 确认方案：算范围、调冻结、再创建合同 |
| `approveContract` 调用点 | 1639、2097、2882、2958 | 批准 |
| 运行 Worker 按钮 | 2982 | `runWorker`，并在需要时拉依赖意外 |
| 执行验证按钮 | 3022 | `executeContract` |
| 恢复执行按钮 | 3044 | `resumeContract` |
| 保护清单回调 | 983–1029 | 决定、套用建议、解锁、撤销一轮 |
| `runAction` | 2732 | 这些按钮共用的忙碌与错误包装 |
| WebSocket 与轮询 | 2215 起 | 状态、日志、图谱、基线进度 |

## 4. 拆分方案

以下整节是 `ai_inferred`。

建议目录只服务 daemon，不搬 Console：

| 模块 | 职责 | 从哪搬 | 预计行数 |
| :--- | :--- | :--- | ---: |
| `daemon/http/front-door.ts` | Host、预览来源、CORS、OPTIONS、访问日志、404 与静态兜底 | 4984–5080 与 7066–7075 | 约 120 |
| `daemon/http/contract-routes.ts` | §3.2 全部合同分支 | 6115–7048 | 约 900 |
| `daemon/http/scheme-routes.ts` | §3.3 的 `if`，继续调用现有 `handle*` | 5921–6086 | 约 180 |
| 其余前缀 | 保持现有 `handle*` 方法，前门只留一行转交 | 已抽出的方法 | 不动函数体 |

公共段建议抽 `requireUser(req)`：返回是否已 401。前门对需要用户令牌的分支先调用它。`session/relaunch` 不调用。`/api/mcp` 继续用 `isMcpAuthorized`。记录写入（`appendDaemonLog`）留在前门的 `finish` 监听里，不放进每个模块。

建议调用方传入一个窄上下文，而不是把整个 `DaemonServer` 传进去。上下文里要有：`repoRoot`、`orchestrator`、`sendJson`、`readJsonBody`、`sendActionError`、合同更新与证据监听的开关。第一批若接口太宽，可以暂时传入 `server`，但文件头写明这是过渡，避免每个新文件再复制一份 401 块。

Console 建议另立，不与上表同卡：按「确认方案」「合同按钮」「保护清单」「连接与轮询」拆组件。状态仍由 `Console` 持有，子组件只收回调。这是呈现拆分，不是路由文件拆分。

## 5. 行为不变性

建议：第一批是纯移动，不改判断条件、不改状态码、不改正则顺序。（`ai_inferred`）

必须保持的顺序：

1. Host 与两种预览来源在 CORS 之前。
2. `OPTIONS` 在任何业务 `if` 之前。
3. `/api/contracts` 内部先匹配 `scope-revision`、`gateway-violation`、`rework`，再落入通用 `admit|approve|…` 正则。调换会让更具体的路径被通用正则吃掉。
4. API 都未命中才走静态兜底。

拆分障碍（都在 `DaemonServer` 实例上，搬函数时要显式带上）：

| 状态 | 谁在写 |
| :--- | :--- |
| `activeContracts` | 创建合同、合入、中止 |
| `targetAdvancedContracts` | `merge` 409、`merge-decision`、中止与合入成功时删除 |
| 证据监听 | `execute` 通过后武装；`merge` / `abort` 时停止 |
| 真预览进程 | `merge` 成功与 `abort` 时 `stopRealPlaytest` |
| `deadlock` / `stoppingContracts` | `abort` 的 `finally` |
| `vault` | `/api/vault` 可能在首次写入时创建并 `setActiveVault` |
| `orchestrator` 与合同库 | 几乎所有合同动作 |
| `chat`、`mcpServer` | 聊天与 MCP |

这些不是闭包里的局部变量，而是对象字段。抽成纯函数而不传入它们，行为就会变。建议第一批不要改这些字段的读写时机。（`ai_inferred`）

`POST /api/contracts` 里「快照一致才跳过范围再检、演示门失败 409、然后准入、然后写授权清单」是一条链。建议整段搬走，不要拆成多个中间返回点。（`ai_inferred`）

## 6. 验证

现有 HTTP 测试能罩住第一批的主路径，前提是测试仍打在进程内的 `DaemonServer` 上，而不是只测被搬走之后的纯函数。已看到的文件包括：

- `tests/integration/merge-decision-d4.test.ts`：创建、执行、合入、`merge-decision`
- `tests/integration/resume-abort.test.ts`：恢复、中止、执行
- `tests/integration/scheme-confirm-http-injection.test.ts`、`scheme-confirm-scope-drift.test.ts`：确认后创建合同
- `tests/daemon/scope-revision-api.test.ts`：范围修订
- `tests/daemon/diff-endpoint-security.test.ts`：diff
- `tests/e2e/golden-slice.test.ts`：一句需求到合入
- `tests/daemon/vault.test.ts`、`tests/unit/playtest-evidence.test.ts`、`tests/unit/mcp-http-endpoint.test.ts`

建议：第一批合入前跑上述集成测试，外加 `npm run check:docs` 若只改注释则不必，但动了 `server.ts` 的导入就要跑相关测试。不要求先为仓库文件树、知识库、架构图补测，因为它们不在第一批。（`ai_inferred`）

缺测试、且建议不要放进第一批的路径：`/api/repo/*`、`/api/knowledge/*`、`/api/arch/graph`、`/api/client-events`、静态兜底。这些若要拆，建议先补一条 HTTP 往返再搬。（`ai_inferred`）

Console 拆分不能靠上述 daemon 测试。`tests/ui/` 里的页面测试会跟着状态搬家变脆。建议 Console 单独立项，并先锁住确认开工与执行验证两条点击。（`ai_inferred`）

## 7. 风险与估算

| 范围 | 估算 | 风险 |
| :--- | :--- | :--- |
| 整份 `server.ts` 一次按路由拆完 | L | 正则顺序、鉴权遗漏、`this` 字段读写时机；超过单卡上限 |
| 只抽 §3.2 合同内联段 | M | 仍碰创建与合入；靠现有集成测试 |
| 只把已转交的 `handle*` 再搬文件 | S | 低，但几乎不改善「谁放行」的可读性 |
| `Console` 按区域拆组件 | L | 状态提升；与 daemon 拆分不是同一类改动 |

建议分三批，不一次拆完。（`ai_inferred`）

1. 合同内联段（§3.2）抽到 `contract-routes.ts`，前门留一行转交。这是审计目标。
2. 已有 `handle*` 的前缀按域搬家。无行为变化才做。
3. `Console` 另卡。确认近期没有必须改 `server.ts` 行为的需求再开第 1 批；本评估不判断那项需求是否存在。

主要风险是把「纯移动」做成顺手改条件。建议卡面写明：状态码、错误码、正则顺序为只读约束；改了任一即失败。（`ai_inferred`）

## 8. 结论

**建议暂缓整拆；若点名，只立第 1 批合同内联段的卡（估算 M），Console 不进该卡。**（`ai_inferred`）理由：确认与合入的放行链已经能指到行号，但它们仍嵌在 2000 行的 `handleHttpRequest` 里；其余多数路由已经是独立方法，整文件拆完的回归面大于可读性收益。
