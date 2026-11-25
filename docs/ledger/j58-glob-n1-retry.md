# J.58 合入后重启 Daemon 并对 n1 官方重试 start / verify 落账（只读 · P-309）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.53 / J.54 / J.55 / J.56 / J.57 / J.58。
> **基线**：`main` `c3a25e29e565fb5b7420fa173fa3e20b2ded79db`（[#395](https://github.com/he18718143986-design/IDE/pull/395) P-308 完工回写合入后）。产品代码尖为 J.58 施工 [#394](https://github.com/he18718143986-design/IDE/pull/394) squash `025cdb01e62f81e7ef86e46595c49f5873f383f7`（#395 只改 docs，产品代码与该 SHA 相同；`c3a25e29` 的父提交即为该施工 SHA）。
> **依据**：2026-11-25 19:29–19:30 香港时间（操作者由我执行）；授权 Tina t1462u：确认 #395 合入与 J.58 正式关闭，点名从最新 main（含 J.58 通配符采证）重启 Daemon，同一试玩对已 `FAILED` 的 `n1` 先官方 `POST /api/graph/nodes/start`、再官方 `POST /api/graph/verify`，然后只观察 `n2`–`n12` 是否可开工。
> **诚实口径**：通配符存在性检查已越过：官方核销 HTTP **200**，错误码为 **`E_COMMAND_FAILED`**，不是 `E_FILES_NOT_WRITTEN`。`n1` 仍为 `FAILED`；九条基线门禁命令全部 `exit 1`。下游 `n2`–`n12` 仍为 `BLOCKED`，按 `startable.ts` **均不可开工**。官方 verify 响应体不含 `files_written` / `file_hashes` 字段（只有 `illuminated` / `code` / `message` / `graph`）。未宣称端到端闭环。n12 扩展名不匹配与过期标记 glob 化、以及命令退出码失败是否另立卡，由 Tina 定。本落账按授权只记录、不立卡。自动钩子仍只作 backlog 候选，不立卡。

## 一、Tina 已确认并拍板（记录，不重开结论）

- #395 合入确认收到：新 main `c3a25e29e565fb5b7420fa173fa3e20b2ded79db`，索引 L229 `TASK-J.58` 为 `COMPLETED` 且链接指向 completed 文件，completed 卡位 §3.4bu / `delivered` 锚定 #394 / `025cdb01e62f81e7ef86e46595c49f5873f383f7`，changelog P-308（L250，P-307 / P-306 原文未改），版本头第 292 条（L202，第 291 / 290 条原文未改），归档注记诚实口径含「端到端闭环未宣称」，ledger L68（J.58 已交付、n1 重试待点名）。**J.58 正式关闭**。
- #394 施工落点确认已在 t1461u / t1462u 收悉，J.58 施工已交付。本轮不再复述施工代码行号。
- 点名下一步：必须用 `c3a25e29` 或更新（J.58 通配符采证在线）重启 Daemon，不得继续用旧源 `637fb71a6cdb8621bcb99d74aae561cf25f69e98`。官方重试 `n1` start / verify；不对 `n2`–`n12` 发 start/verify；不发 `run-worker`；不立卡。

## 二、重启 Daemon（事实）

- 旧 Daemon：父进程 19710、子进程 19712，监听 `127.0.0.1:3001`，cwd `/private/tmp/ide-worktrees/j57-prompt-retry`，`HEAD` `637fb71a6cdb8621bcb99d74aae561cf25f69e98`（J.58 之前，不得用于本轮重试）。对该父进程发 SIGTERM，时间 2026-11-25 19:29:44 香港时间；同秒端口 3001 空闲，旧进程退出。
- `/Users/tina/IDE` 仅 fetch、未 pull/reset：本地 `HEAD` 仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`；`origin/main` 为 `c3a25e29e565fb5b7420fa173fa3e20b2ded79db`，其父提交为施工 SHA `025cdb01e62f81e7ef86e46595c49f5873f383f7`。
- 新建游离工作树 `/private/tmp/ide-worktrees/j58-glob-retry`，检出 `c3a25e29e565fb5b7420fa173fa3e20b2ded79db`。`node_modules` 与 `.tmp/deepseek.env` 符号链接到 `/Users/tina/IDE` 对应路径，未把密钥或 session-token 拷离本机，未打印。
- 自该工作树启动官方 Daemon：`./node_modules/.bin/tsx bin/stagent.ts open /Users/tina/Downloads/stagent-j45-key-playtest --port 3001 --no-browser`。启动时刻 2026-11-25 19:29:59 香港时间。父进程 **21883**，子进程 **21885**（监听 3001）。`GET /health` **200** 于 2026-11-25 19:30:00 香港时间（daemon.jsonl `requestId=6e34e9a8b88d`，`duration_ms=16`，ts `2026-11-25T11:30:00.424Z`）：`status=ok`，`version=0.1.0`，`pid=21885`，`port=3001`，`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`，`currentBranch=main`。源码 SHA `c3a25e29e565fb5b7420fa173fa3e20b2ded79db`。工作树内存在 `daemon/graph/target-file-match.ts`。HTTP 认证只用 `Authorization: Bearer`（读试玩目录 `.stagent/session-token`，权限 0600；未打印、未外传）。未发 `run-worker`。
- 重启后合同被置为 `PENDING_RESUME` / `APPROVED`（合同文件 mtime 2026-11-25 19:29:59 香港时间）。按授权先官方 resume，不重建合同，不把规划编号当 `confirmation_id`。

## 三、走查前图快照（resume 前 / start 前，事实）

合同 `contract_1795588309763_cy8zx`，图 `graph_1795588362553_e4fbb0f1`。隔离施工树 `/Users/tina/Downloads/stagent-j45-key-playtest/.stagent/worktrees/task-contract_1795588309763_cy8zx`。

- resume 前：`lifecycle_state=PENDING_RESUME`，`approval.status=APPROVED`。图文件 mtime 仍为 2026-11-25 18:28:54 香港时间，size 10415，`revision=3`，`updated_at=2026-11-25T10:28:54.788Z`（18:28:54 香港时间）。进度 `FAILED=1`、`BLOCKED=11`、`ILLUMINATED=0`。`n1=FAILED`（`target_files=["src/**"]`），`n2`–`n12=BLOCKED`。既有 issue 一条：`E_FILES_NOT_WRITTEN`「节点 n1 的目标文件尚未写入: src/**」（`recorded_at` 仍为上次走查 2026-11-25T10:28:54.788Z）。指纹空。
- 隔离施工树磁盘清单（只读，不是 HTTP `files_written` 字段）：`README.md`、`index.html`、`package.json`、`src/auth.js`、`src/lint.js`、`src/main.js`、`src/phone.js`、`src/server.js`、`src/styles.css`、`src/typecheck.js`、`tests/auth.test.js`、`tests/phone.test.js`。**没有** `src/store.js`。mtime 仍为 2026-11-25 17:54:44 香港时间（`README.md` 除外）。本轮未改这些文件，未再发 `run-worker`。

## 四、官方请求与响应（事实）

请求体按产品源码官方形状，不臆造。J.58 未改 `daemon/server.ts` 请求处理：`POST /api/graph/nodes/start` 只传 `{ "node_id": "n1" }`（L3414–3429）；`POST /api/graph/verify` 只传 `{ "node_id": "n1" }`（L3434–3440）。未提交 `command_results`。

### 4.1 resume（需要）

- `POST /api/contracts/contract_1795588309763_cy8zx/resume`，body `{}`。
- 客户端：2026-11-25 19:30:48.006–19:30:48.066 香港时间，HTTP **200**，测得 `duration_ms=59`。
- daemon.jsonl：ts `2026-11-25T11:30:48.066Z`，`requestId=5a5ff25e59cc`，`code=200`，`duration_ms=34`。
- 之后合同 `lifecycle_state=EXECUTING`，`approval.status=APPROVED`，mtime 2026-11-25 19:30:48 香港时间。图 `revision` 仍为 3，未变。

### 4.2 start n1

- `POST /api/graph/nodes/start`，body `{ "node_id": "n1" }`。
- 客户端：2026-11-25 19:30:48.066–19:30:48.085 香港时间，HTTP **200**，测得 `duration_ms=18`。
- daemon.jsonl：ts `2026-11-25T11:30:48.084Z`，`requestId=51a78194d5ee`，`code=200`，`duration_ms=17`。
- 图：`revision` 3→4，`updated_at=2026-11-25T11:30:48.076Z`（19:30:48 香港时间），文件 mtime 2026-11-25 19:30:48 香港时间，size 10416。`n1`：`FAILED` → `RUNNING`。`n2`–`n12` 仍为 `BLOCKED`。进度 `RUNNING=1`、`BLOCKED=11`。指纹仍空。响应 `graph.issues` 仍带上次走查留下的 `E_FILES_NOT_WRITTEN` 记录（`recorded_at=2026-11-25T10:28:54.788Z`），不是本次 start 的新判定。

### 4.3 verify n1

- `POST /api/graph/verify`，body `{ "node_id": "n1" }`。
- 客户端：2026-11-25 19:30:48.085–19:30:48.128 香港时间，HTTP **200**，测得 `duration_ms=43`。
- daemon.jsonl：ts `2026-11-25T11:30:48.128Z`，`requestId=c100ccba3a4b`，`code=200`，`duration_ms=43`。
- 响应顶层：`illuminated=false`，`code=E_COMMAND_FAILED`，`message=节点 n1 的验证命令未通过: baseline-safety-writable-scope(exit 1), baseline-safety-test-integrity(exit 1), baseline-safety-secrets(exit 1), baseline-rollback-auto(exit 1), baseline-rollback-manual(exit 1), baseline-rollback-no-live(exit 1), baseline-path-exit-codes(exit 1), baseline-path-mainline-regression(exit 1), baseline-path-knowledge(exit 1)`。
- **不是** `E_FILES_NOT_WRITTEN`。按点亮判定顺序，命令退出码检查在目标文件写入检查之后；本次已越过存在性 / 通配符展开步，停在命令步。与卡面观察项（修好存在性后本试玩仍可能在命令退出码等后续步骤失败）相符。
- 官方响应体**没有** `files_written` / `file_hashes` 字段，本落账不编造该名单。隔离施工树磁盘上的 `src/` 实文件见第三节（七个路径，无 `src/store.js`）。
- 图：`revision` 4→5，`updated_at=2026-11-25T11:30:48.120Z`（19:30:48 香港时间），文件 mtime 2026-11-25 19:30:48 香港时间，size 10939。`n1`：`RUNNING` → `FAILED`。`n1.executed_at=null`，`n1.commit_sha=null`。指纹仍空（未点亮，未记录指纹）。进度 `FAILED=1`、`BLOCKED=11`、`ILLUMINATED=0`。`issues` 现为两条：旧 `E_FILES_NOT_WRITTEN`（`recorded_at=2026-11-25T10:28:54.788Z`）和新 `E_COMMAND_FAILED`（`recorded_at=2026-11-25T11:30:48.120Z`，文言同上）。合同仍为 `EXECUTING` / `APPROVED`。

## 五、n2–n12 可开工观察（只观察，未发请求）

`n1` 未点亮，仍为 `FAILED`。`n2`–`n12` 仍全部 `BLOCKED`（依赖链未变：n2 依赖 n1，其后依次依赖）。按 `startable.ts`（`PENDING` 且前置均为 `ILLUMINATED`），**均不可开工**。本轮未对它们发 start 或 verify。

## 六、不在本落账结论内的事项

- 未宣称端到端闭环。
- 未立卡：不因本次 `E_COMMAND_FAILED` 立新卡；n12 目标 `**/*.test.ts` 而 Worker 写出 `tests/*.test.js`，扩展名不匹配是否另立卡届时再定；`markStale` / `nodeTouchesPaths` glob 化届时再定；自动钩子仍 backlog 候选，不立卡。
- 本轮未重试第二次 start/verify，未发 `run-worker`，未改产品代码，未拉/重置 `/Users/tina/IDE`。

## 七、密钥与日志纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容，未把这些文件拷离本机。
