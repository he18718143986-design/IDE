# J.59 合入后重启 Daemon 并对 n1 官方重试 start / verify 落账（P-312）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.53 / J.54 / J.55 / J.56 / J.57 / J.58 / J.59。
> **基线**：`main` `53682172d6132956f78a87cccc467869bbb4f22b`（[#399](https://github.com/he18718143986-design/IDE/pull/399) P-311 完工回写）；产品代码尖为 J.59 施工 [#398](https://github.com/he18718143986-design/IDE/pull/398) squash `e7e5ca673b2fdf98eceed8c40c09dfe0e68b4787`。
> **依据**：2026-11-25 22:39–22:40 香港时间（操作者由我执行）；授权 Tina 本轮点名：Daemon 必须跑 `53682172` 或更新（J.59 在线），同一试玩目录对已 `FAILED` 的 `n1` 先官方 `POST /api/graph/nodes/start`、再官方 `POST /api/graph/verify`，然后只观察 `n2`–`n12`。
> **诚实口径**：**`n1` 已 `ILLUMINATED`**（HTTP **200**，`illuminated=true`）。九条 baseline 命令本次**全部 `exit 0`**（上一轮 P-309 为全部 `exit 1`），未出现 `E_COMMAND_NOT_RESOLVED` / `E_COMMAND_SPAWN_FAILED` / `E_COMMAND_FAILED`。`n2` → `PENDING`（可开工）；`n3`–`n12` 仍 `BLOCKED`（依赖链未到）。图 `revision` 5→6→7。未对 `n2`–`n12` 发 start / verify，未发 `run-worker`，未点「确认开工」，未宣称端到端闭环。

## 一、Daemon 重启（事实）

- 旧 Daemon：无在跑（操作前 3001 端口为空），无需复用旧源。
- `/Users/tina/IDE`：`git fetch` 后 `checkout main` + `pull`，快进 52 个提交到 `53682172d6132956f78a87cccc467869bbb4f22b`。**操作前工作区有一条仅缩进变化的 `daemon/server.ts` 未提交改动**（5 行 ±，逻辑等价）；为让 Daemon 跑干净的 `53682172`，已 `git stash push` 收起（`stash@{0}: On main: pre-J59-retest stray whitespace-only daemon/server.ts edit`，可恢复）。除此之外工作区干净。
- 启动命令：`npm run stagent -- open /Users/tina/Downloads/stagent-j45-key-playtest`，启动时刻 2026-11-25 22:39:05 香港时间。
- 监听进程 **26569**（PPID 26568），监听 `127.0.0.1:3001`；命令行为 `node --require …/tsx/dist/preflight.cjs --import …/tsx/dist/loader.mjs bin/stagent.ts open <试玩目录>`。
- `GET /health` **200**（daemon.jsonl `requestId=2627e2f3531f`，`duration_ms=9`，ts `2026-11-25T14:39:05.380Z`，即 22:39:05 香港时间）：`status=ok`、`version=0.1.0`、`pid=26569`、`port=3001`、`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`、`currentBranch=main`。
- 源码 SHA `53682172d6132956f78a87cccc467869bbb4f22b`。HTTP 认证只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`；未打印、未外传。

## 二、走查前图快照（start 前，事实）

合同 `contract_1795588309763_cy8zx`（`EXECUTING` / `APPROVED`），图 `graph_1795588362553_e4fbb0f1`。

- 图 `revision=5`，`updated_at=2026-11-25T11:30:48.120Z`（22:30:48 香港时间，即 P-309 那轮 verify 的落点）。
- `n1=FAILED`；`n2`–`n12=BLOCKED`；进度 `FAILED=1`、`BLOCKED=11`、`ILLUMINATED=0`、`PENDING=0`。
- 隔离施工树 `/Users/tina/Downloads/stagent-j45-key-playtest/.stagent/worktrees/task-contract_1795588309763_cy8zx`：`HEAD=ae03e3c`（`init`），Worker 已写出 11 个文件但**仍为 staged 未提交**（`index.html`、`package.json`、`src/auth.js`、`src/lint.js`、`src/main.js`、`src/phone.js`、`src/server.js`、`src/styles.css`、`src/typecheck.js`、`tests/auth.test.js`、`tests/phone.test.js`）。本轮未改这些文件，未发 `run-worker`。

## 三、官方请求与响应（事实）

请求体按产品源码官方形状，不臆造：`POST /api/graph/nodes/start` 与 `POST /api/graph/verify` 均只传 `{ "node_id": "n1" }`。未提交 `command_results` / `execution_exit_code`。

### 3.1 start n1

- 客户端：2026-11-25 22:39:33 香港时间发出，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T14:39:33.801Z`，`requestId=36ea0d4a562a`，`route=POST /api/graph/nodes/start`，`code=200`，`duration_ms=18`。
- 图：`revision` 5→6，`updated_at=2026-11-25T14:39:33.791Z`（22:39:33 香港时间）。
- 节点转移：`n1` `FAILED`→`RUNNING`；`n2`–`n12` 仍 `BLOCKED`。进度 `RUNNING=1`、`BLOCKED=11`、`FAILED=0`。

### 3.2 verify n1

- 客户端：2026-11-25 22:39:39 发出，22:39:43 返回，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T14:39:43.888Z`，`requestId=22fa59356340`，`route=POST /api/graph/verify`，`code=200`，`duration_ms=4657`。
- 响应顶层：`illuminated=true`；**无** `code` / `message` / `error` 字段（成功路径不出错误码）。
- 图：`revision` 6→7，`updated_at=2026-11-25T14:39:43.878Z`（22:39:43 香港时间）。
- 节点转移：`n1` `RUNNING`→`ILLUMINATED`；`n2` `BLOCKED`→`PENDING`；`n3`–`n12` 仍 `BLOCKED`。进度 `ILLUMINATED=1`、`PENDING=1`、`BLOCKED=10`，`percent=8`。
- `n1.executed_at=2026-11-25T14:39:43.878Z`，`n1.commit_sha=ae03e3cd58bcf30008281e3dccabe60a6dd780d7`。
- 点亮后 `issues=[]`（此前 P-309 留存的 `E_FILES_NOT_WRITTEN` / `E_COMMAND_FAILED` 记录不再出现）。
- 点亮后写入 7 条指纹：`src/auth.js`、`src/lint.js`、`src/main.js`、`src/phone.js`、`src/server.js`、`src/styles.css`、`src/typecheck.js`（均 `node_id=n1`、`commit_sha=ae03e3c…`）。`package.json` / `index.html` / `tests/*` 不在本节点指纹内（不属于 `src/**`）。

## 四、九条 baseline 命令实跑（daemon.jsonl 摘录，脱敏后）

| # | alias | ts（UTC） | exit_code | stdout_length | stderr_length |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `baseline-safety-writable-scope` | `2026-11-25T14:39:39.997Z` | 0 | 102 | 0 |
| 2 | `baseline-safety-test-integrity` | `2026-11-25T14:39:40.483Z` | 0 | 102 | 0 |
| 3 | `baseline-safety-secrets` | `2026-11-25T14:39:40.968Z` | 0 | 95 | 0 |
| 4 | `baseline-rollback-auto` | `2026-11-25T14:39:41.451Z` | 0 | 94 | 0 |
| 5 | `baseline-rollback-manual` | `2026-11-25T14:39:41.928Z` | 0 | 96 | 0 |
| 6 | `baseline-rollback-no-live` | `2026-11-25T14:39:42.406Z` | 0 | 97 | 0 |
| 7 | `baseline-path-exit-codes` | `2026-11-25T14:39:42.890Z` | 0 | 96 | 0 |
| 8 | `baseline-path-mainline-regression` | `2026-11-25T14:39:43.373Z` | 0 | 105 | 0 |
| 9 | `baseline-path-knowledge` | `2026-11-25T14:39:43.856Z` | 0 | 95 | 0 |

- 事件 `kind=graph_verify_command`，字段只有 `alias` / `stdout_length` / `stderr_length` / `exit_code`；成功路径按 J.59 口径不落命令片段与已解析命令串，本记录不编造命令串。
- 解析是否生效的佐证：九条命令均在约 0.48 秒间隔内真实执行完毕且 `exit 0`、`stderr_length=0`；上一轮 P-309 同一组命令全部 `exit 1`。本轮未出现 `E_COMMAND_NOT_RESOLVED` / `E_COMMAND_SPAWN_FAILED`，也未出现 `E_COMMAND_FAILED`。
- 本机环境差异：无（本轮无任何命令片段可摘，`stderr` 为空）。

## 五、n2–n12 可开工观察（只观察，未发请求）

- `n2`（`package.json`，依赖 `n1`）已由 `BLOCKED` → **`PENDING`**，按启动规则可开工。
- `n3`–`n12` 仍全部 `BLOCKED`：依赖链为 n3←n2、n4←n3、…、n12←n11，上游未点亮前不开工。本轮未对它们发 start 或 verify。
- 施工树中 `package.json`、`index.html`、`tests/*` 已由 Worker 写出（staged 未提交），属 `n2` / `n10` / `n11` 的目标文件，但本轮不据此推演后续节点是否会点亮。

## 六、不在本落账结论内的事项

- 未宣称端到端闭环；`n1` 点亮不等于整图点亮，也不等于合同合入。
- 未立卡：n12 扩展名不匹配（`**/*.test.ts` vs `tests/*.test.js`）、`markStale` / `nodeTouchesPaths` glob 化、设计层挂账、自动钩子均不在本轮，仍由 Tina 定。
- 未点「确认方案 / 确认开工」，未调用冻结或开工接口，未发 `run-worker`，未改产品代码，未改 `.stagent` 台账。
- 合同仍为 `EXECUTING` / `APPROVED`（`state.json` `updated_at` 仍为 `2026-11-25T11:30:48.057Z`，本轮未变）。
- 仓库侧唯一动作是重启前 `git stash` 收起一条仅缩进的 `daemon/server.ts` 未提交改动（`stash@{0}`），未提交、未推送。

## 七、密钥与日志纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容，未把这些文件拷离本机。daemon.jsonl 摘录只含 alias、长度与退出码。
