# J.57 合入后重启 Daemon 并重试 run-worker 落账（只读 · P-305）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.53 / J.54 / J.55 / J.56 / J.57。
> **基线**：`main` `637fb71a6cdb8621bcb99d74aae561cf25f69e98`（[#390](https://github.com/he18718143986-design/IDE/pull/390) P-304 回写合入后，含 J.57 提示词约束）。产品代码尖在 J.57 施工 [#389](https://github.com/he18718143986-design/IDE/pull/389) squash `fed205a5805f41bc3516249be16d12bbfefaeb08`。
> **依据**：2026-11-25 17:51–17:54 香港时间（操作者由我执行）；授权 Tina t1454u 点名：从最新 main（含 J.57 提示词约束）重启 Daemon，并对已签成合同重试一次 `run-worker`，验证提示词约束是否生效。
> **诚实口径**：官方 `run-worker` 返回 **200**，模型 `deepseek-flash` 解析成功。隔离施工树新写入 11 个文件。任务图 12 个节点仍全部 `PENDING`。合同仍为 `EXECUTING` / `APPROVED`。未宣称端到端闭环。下一步验证由 Tina 定。

## 一、环境与 Daemon（事实）

- 运行源是新建 detached worktree `/private/tmp/ide-worktrees/j57-prompt-retry`，`git rev-parse HEAD` 为 `637fb71a6cdb8621bcb99d74aae561cf25f69e98`（与当时 `origin/main` 相同，含 J.57 提示词改写：`session-task-injector.ts`「输出契约」「角色与边界」「可用工具」段首、`openai-client.ts` 的 `WORKER_JSON_ONLY_USER_RULE` / `WORKER_PARSE_RETRY_STRICT_SUFFIX`、`worker-adapter.interface.ts` 的 `known_limitations`）。由已有 `/Users/tina/IDE` **只 fetch**（`origin/main` 由先前 tip 更新到 `637fb71a`）后 `git worktree add --detach` 建成。未拉、未重置、未 checkout 改 `/Users/tina/IDE` 的 HEAD（仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`，`main` behind origin）。未在 Tina 的 Mac 上 clone。未用 CloudAgent。旧 worktree `/private/tmp/ide-worktrees/j56-worker-retry` 仍停在 `f7b6033e`，**未**用来这次重试。
- 依赖与钥匙沿用已有符号链接（`node_modules` → `/Users/tina/IDE/node_modules`，`.tmp/deepseek.env` → `/Users/tina/IDE/.tmp/deepseek.env`），未复制密钥文件，未把 session-token 或钥匙拷出机，未打印内容。启动前在源码 worktree 中 `source` 了该 `.tmp/deepseek.env` 符号链接（不打印变量）。
- 旧 Daemon：cwd `/private/tmp/ide-worktrees/j56-worker-retry` @ `f7b6033e8a67ad5bc3a1befd54096f4e46670b64`，父进程 18503、子进程 18505 监听 `127.0.0.1:3001`，启动于 2026-11-25 16:20:37 香港时间。2026-11-25 17:51:19 香港时间对旧父进程发 SIGTERM；约 1 秒内两进程均已退出，端口释放。
- 新 Daemon 父进程 19710（ppid 1）、子进程 19712 于 2026-11-25 17:51:34 香港时间启动：在新 worktree 执行 `./node_modules/.bin/tsx bin/stagent.ts open /Users/tina/Downloads/stagent-j45-key-playtest --port 3001 --no-browser`。进程命令行与 cwd 均为 `/private/tmp/ide-worktrees/j57-prompt-retry`，不是 `j56-worker-retry`。启动日志：本机变量「已加载 0 项」（`injectLocalModelEnv` 以试玩目录为 repo 注入；进程环境里已有从源码 worktree 符号链接 source 的变量），同时「L1 补全: 已启用（DeepSeek / OpenAI 兼容口）」；token 路径只记录路径、不记录内容。`GET /health` **200**：`status=ok`，`version=0.1.0`，`pid=19712`，`port=3001`，`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`，`currentBranch=main`。HTTP 认证只用 `Authorization: Bearer`（读试玩目录 `.stagent/session-token`，权限 0600；未打印、未外传）。

## 二、重试前合同与任务图（事实）

未重新创建合同，未把规划编号当 `confirmation_id` 发出去。只读确认：

- 合同 `contract_1795588309763_cy8zx`：`approval.status=APPROVED`（`approved_at=2026-11-25T06:32:42.481Z`），`scheme_binding.confirmation_id=scheme-plan-1a20f8774e5-1f1e1f97`，`snapshot_digest=13b688f692abab8eac73dd1644a38d12b8fadea7a33dad7966fdbc82baa13d2f`，`plan_digest=16493c9ba83e48e19018df7738ea31123c0e0690a23f67f3c850a6e621d1fe85`。因本次按授权重启 Daemon，崩溃恢复把先前的 `EXECUTING` 挂起到 `lifecycle_state=PENDING_RESUME`（不是重新签署）。
- 任务图 `graph_1795588362553_e4fbb0f1` 仍在，12 个节点全部 `PENDING`（「落实：src/**」「落实：package.json」「落实：tsconfig.json」「落实：tsconfig.*.json」「落实：vitest.config.*」「落实：vite.config.*」「落实：*.config.ts」「落实：*.config.mjs」「落实：*.config.js」「落实：index.html」「落实：tests/**」「落实：**/*.test.ts」）。
- 隔离施工树 `/Users/tina/Downloads/stagent-j45-key-playtest/.stagent/worktrees/task-contract_1795588309763_cy8zx` 存在且健康，重试前工作区文件只有 `README.md`（11 字节，mtime 仍为 2026-11-25 14:32:42 香港时间）。

官方续跑：`POST http://127.0.0.1:3001/api/contracts/contract_1795588309763_cy8zx/resume` 于 2026-11-25 17:52:47 香港时间返回 **200**（客户端测得 0.028s）。合同回到 `lifecycle_state=EXECUTING`，`approval.status=APPROVED`。然后才发 `run-worker`。这是重启后的官方恢复出口，不是新建合同。

## 三、官方 run-worker（只一次 · 事实）

`POST http://127.0.0.1:3001/api/contracts/contract_1795588309763_cy8zx/run-worker`（无 body）。

- 请求开始：2026-11-25 17:53:28 香港时间
- 响应结束：2026-11-25 17:54:44 香港时间（日志 `ts=2026-11-25T09:54:44.967Z`）
- 状态码：**200**
- `duration_ms=76629`
- `requestId=a449c63817d5`
- 同一次请求的 LLM 日志（daemon.jsonl 第 5975 行，`ts=2026-11-25T09:54:44.940Z`）：`kind=llm`，`code=OK`，`duration_ms=76595`，`detail.source=worker`，`detail.model=deepseek-flash`。第 5976 行：`kind=worker`，`frame=WORKER_LOG`，`detail.lines=11`。第 5977 行：`kind=http`，`route=POST /api/contracts/contract_1795588309763_cy8zx/run-worker`，`code=200`。
- 本次 Daemon 重启之后的 `daemon.jsonl` **没有**新的 `kind: worker_parse_failure`（既有第 5958 / 5959 行仍是 16:22 香港时间那次 J.56 重试的记录，未改写）。
- 未二次重试。采集响应的客户端脚本在读到 HTTP 结果之后因本地 `TypeError`（把时间字符串当函数调用）退出，但 Daemon 侧第 5977 行已记录本次官方 POST 以 200 结束；没有再发第二次 `run-worker`。

## 四、Worker 产出与任务图（事实）

隔离施工树在 2026-11-25 17:54:44 香港时间新写入 11 个文件（只记路径与字节数，不抄正文、不落密钥）：

- `index.html`（2540）
- `package.json`（443）
- `src/auth.js`（4300）
- `src/lint.js`（1917）
- `src/main.js`（5451）
- `src/phone.js`（1258）
- `src/server.js`（1850）
- `src/styles.css`（3645）
- `src/typecheck.js`（2074）
- `tests/auth.test.js`（3534）
- `tests/phone.test.js`（1462）

原有 `README.md`（11 字节）仍在，mtime 仍为 2026-11-25 14:32:42 香港时间，未在本次写入中被改。

任务图仍为 `graph_1795588362553_e4fbb0f1`，12 个节点仍全部 `PENDING`。图文件 mtime 仍为 2026-11-25 14:32:42 香港时间，未见节点状态变为 `DONE` 或 `FAILED`。

合同重试后仍为 `lifecycle_state=EXECUTING`，`approval.status=APPROVED`，`approved_at` 与 `scheme_binding` 未改。

## 五、建议（不立卡）

提示词约束在这次 `deepseek-flash` 官方重试中生效：模型返回了可被现有 `generateObject` / `{changes, log}` 契约解析的输出，Daemon 把 11 个文件落到了隔离施工树。这与 P-302 仍 400 `[E_WORKER_PARSE]`、特征为中文开场 + DSML / `<tool_call>` 的那次形成对照。不把「解析器有 bug」写成已证实结论，也不把本次成功写成端到端闭环：任务图节点未推进，未做试玩验收，未跑施工树里的测试，未评估写出文件是否符合验收「打开登录页后可以用手机号登录」。下一步验证（例如看写出的文件、跑测试、或查节点为何仍为 `PENDING`）由 Tina 定。本落账按授权只记录、不立卡。**未宣称端到端闭环。**

`/Users/tina/IDE` HEAD 仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`（`main...origin/main [behind 43]`）。未拉、未重置。
