# J.56 合入后重启 Daemon 并重试 run-worker 落账（只读 · P-302）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.55 / J.56。
> **基线**：`main` `f7b6033e8a67ad5bc3a1befd54096f4e46670b64`（[#386](https://github.com/he18718143986-design/IDE/pull/386) P-301 回写合入后，含 J.56 可观测性）。产品代码尖在 J.56 施工 [#385](https://github.com/he18718143986-design/IDE/pull/385) squash `3529009b1f51fdc6adf207762f9838698185e502`。
> **依据**：2026-11-25 16:20–16:22 香港时间（操作者由我执行）；授权 Tina t1448u 点名：从最新 main 重启 Daemon，并对已签成合同重试一次 `run-worker`，拿 J.56 落盘的原文特征。
> **诚实口径**：J.56 特征日志已在这次重试中落盘。`run-worker` 仍返回 400 `[E_WORKER_PARSE]`。施工树未写入新文件。未宣称端到端闭环。本落账只建议、不立卡。

## 一、环境与 Daemon（事实）

- 运行源是新建 detached worktree `/private/tmp/ide-worktrees/j56-worker-retry`，`git rev-parse HEAD` 为 `f7b6033e8a67ad5bc3a1befd54096f4e46670b64`（与当时 `origin/main` 相同，含 `extractWorkerParseFailureFeatures` 与 `kind: "worker_parse_failure"`）。由已有 `/Users/tina/IDE` **只 fetch**（`origin/main` 由 `58016b7a` 更新到 `f7b6033e`）后 `git worktree add --detach` 建成。未拉、未重置、未 checkout 改 `/Users/tina/IDE` 的 HEAD（仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`，`main` behind origin）。未在 Tina 的 Mac 上 clone。未用 CloudAgent。旧 worktree `/private/tmp/ide-worktrees/j55-key-retest` 仍停在 `58016b7a`，**未**用来这次重试。
- 依赖与钥匙沿用已有符号链接（`node_modules` → `/Users/tina/IDE/node_modules`，`.tmp/deepseek.env` → `/Users/tina/IDE/.tmp/deepseek.env`），未复制密钥文件，未把 session-token 或钥匙拷出机，未打印内容。
- 旧 Daemon：cwd `/private/tmp/ide-worktrees/j55-key-retest` @ `58016b7a5be56064a775b00b64e7555058924991`，父进程 16648、子进程 16674 监听 `127.0.0.1:3001`，启动于 2026-11-25 14:28:17 香港时间。2026-11-25 16:20:19 香港时间对旧进程发 SIGTERM；16:20:20 香港时间两进程均已退出，端口释放。
- 新 Daemon 父进程 18503（ppid 1）、子进程 18505 于 2026-11-25 16:20:37 香港时间启动：在新 worktree 执行 `./node_modules/.bin/tsx bin/stagent.ts open /Users/tina/Downloads/stagent-j45-key-playtest --port 3001 --no-browser`。进程命令行与 cwd 均为 `/private/tmp/ide-worktrees/j56-worker-retry`，不是 `j55-key-retest`。启动日志：本机变量已加载 4 项，L1 补全已启用（DeepSeek / OpenAI 兼容口）；token 路径只记录路径、不记录内容。`GET /health` **200**：`status=ok`，`version=0.1.0`，`pid=18505`，`port=3001`，`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`，`currentBranch=main`。HTTP 认证只用 `Authorization: Bearer`（读试玩目录 `.stagent/session-token`，权限 0600；未打印、未外传）。

## 二、重试前合同与任务图（事实）

未重新创建合同，未把规划编号当 `confirmation_id` 发出去。只读确认：

- 合同 `contract_1795588309763_cy8zx`：`approval.status=APPROVED`（`approved_by=local-user`，`approved_at=2026-11-25T06:32:42.481Z`），`scheme_binding.confirmation_id=scheme-plan-1a20f8774e5-1f1e1f97`，`snapshot_digest=13b688f692abab8eac73dd1644a38d12b8fadea7a33dad7966fdbc82baa13d2f`，`plan_digest=16493c9ba83e48e19018df7738ea31123c0e0690a23f67f3c850a6e621d1fe85`。因本次按授权重启 Daemon，崩溃恢复把先前的 `EXECUTING` 挂起到 `lifecycle_state=PENDING_RESUME`（不是重新签署）。
- 任务图 `graph_1795588362553_e4fbb0f1` 仍在，12 个节点全部 `PENDING`（「落实：src/**」「落实：package.json」等）。
- 隔离施工树 `/Users/tina/Downloads/stagent-j45-key-playtest/.stagent/worktrees/task-contract_1795588309763_cy8zx` 存在且健康，重试前工作区文件只有 `README.md`。

官方续跑：`POST http://127.0.0.1:3001/api/contracts/contract_1795588309763_cy8zx/resume` 于 2026-11-25 16:22:23 香港时间返回 **200**（`requestId=84be31105175`，`duration_ms=27`）。合同回到 `lifecycle_state=EXECUTING`，`approval.status=APPROVED`。然后才发 `run-worker`。这是重启后的官方恢复出口，不是新建合同。

## 三、官方 run-worker（只一次 · 事实）

`POST http://127.0.0.1:3001/api/contracts/contract_1795588309763_cy8zx/run-worker`（无 body）。

- 请求开始：2026-11-25 16:22:43 香港时间
- 响应结束：2026-11-25 16:22:46 香港时间
- 状态码：**400**
- 错误：`Model call failed for contract contract_1795588309763_cy8zx: [E_WORKER_PARSE] No object generated: could not parse the response.`
- `duration_ms=2450`（客户端测得 2454ms）
- `requestId=ca47f349cc29`
- 未二次重试。

## 四、J.56 特征日志摘录（事实 · 已脱敏）

试玩目录 `.stagent/logs/daemon.jsonl` 在本次 Daemon 重启之后新写入两条 `kind: worker_parse_failure`（首次与重试各一条，带 `attempt`）。现场核对：没有名为 `text` / `raw` / `full` 的字段，没有完整原文，没有 `sk-` / `Bearer` / `api_key=` 明文。`head` / `tail` 为已过 `redactSecrets`、上限 40 字符的片段，原文照录如下。

### attempt 0（2026-11-25 16:22:44 香港时间，`ts=2026-11-25T08:22:44.909Z`，daemon.jsonl 第 5958 行）

- `kind`: `worker_parse_failure`
- `attempt`: `0`
- `model_id`: `deepseek-flash`
- `text_present`: `true`
- `text_length`: `261`
- `starts_with_fence`: `false`
- `starts_with_brace`: `false`
- `ends_with_fence`: `false`
- `ends_with_brace`: `false`
- `reason`: `json_parse`
- `head`: `我先查看工作目录结构。\n\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ `
- `tail`: `er>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>`

### attempt 1（2026-11-25 16:22:46 香港时间，`ts=2026-11-25T08:22:46.396Z`，daemon.jsonl 第 5959 行）

- `kind`: `worker_parse_failure`
- `attempt`: `1`
- `model_id`: `deepseek-flash`
- `text_present`: `true`
- `text_length`: `108`
- `starts_with_fence`: `false`
- `starts_with_brace`: `false`
- `ends_with_fence`: `false`
- `ends_with_brace`: `false`
- `reason`: `json_parse`
- `head`: `\n\n<tool_call>\n{"name": "stagent_list_dir`
- `tail`: `": ".", "recursive": true}}\n</tool_call>`

同一次请求的 HTTP 索引：`ts=2026-11-25T08:22:46.398Z`，`route=POST /api/contracts/contract_1795588309763_cy8zx/run-worker`，`code=400`，`duration_ms=2450`，`requestId=ca47f349cc29`。

## 五、重试后状态（事实）

- 合同仍为 `lifecycle_state=EXECUTING`，`approval.status=APPROVED`，修订号 1，binding 未改。
- 任务图仍为 `graph_1795588362553_e4fbb0f1`，12 个节点仍全部 `PENDING`。
- 隔离施工树工作区文件仍只有 `README.md`，未见 Worker 新写入的源码文件。
- `/Users/tina/IDE` HEAD 仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`（`main...origin/main [behind 39]`）。未拉、未重置。

## 六、建议（标 `ai_inferred`，只建议、不立卡）

标 `ai_inferred`。依据是第四节的结构特征，不是完整原文，也不是二次复现。

倾向 **「模型跑偏修提示词」**，而不是「合法 JSON 被 markdown 围栏或其他包装包住、修容错」。判断依据：

- 两轮 `starts_with_fence` / `starts_with_brace` / `ends_with_fence` / `ends_with_brace` 全部为 `false`，`reason` 均为 `json_parse`。这不是「合法 JSON 外包一层围栏」的典型形态。
- attempt 0 的 `head` 以中文自然语言开头（「我先查看工作目录结构。」），随后是工具调用标记，不是 `{ changes, log }` 对象。
- attempt 1 的整体文本以 `<tool_call>` 包裹，片段显示模型在调用 `stagent_list_dir`（参数指向 `"."`、`recursive: true`）。即便标签内有一段 JSON，那也是工具调用对象，不是 Worker 补丁 schema；整段文本也不以 `{` 开头或结尾。
- 因此，回退已有 `parseWorkerPatch` / 剥围栏一类容错，按这两条特征看，不足以把这次输出收成合法 Worker 对象。

不把「解析器有 bug」写成已证实结论。本落账按授权只建议、不立卡；是否修提示词、是否另立卡，由 Tina 定。未二次重试。**未宣称端到端闭环。**
