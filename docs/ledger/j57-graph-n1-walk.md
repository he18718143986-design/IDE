# J.57 后官方 start / verify n1 走查落账（只读 · P-306）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.53 / J.54 / J.55 / J.56 / J.57。
> **基线**：`main` `90efeb10bd97b9933faaa56b6390db9ef548c646`（[#391](https://github.com/he18718143986-design/IDE/pull/391) P-305 落账合入后）。产品代码尖仍为 J.57 施工 [#389](https://github.com/he18718143986-design/IDE/pull/389) squash `fed205a5805f41bc3516249be16d12bbfefaeb08`（docs-only #391 未改产品代码）。
> **依据**：2026-11-25 18:28 香港时间（操作者由我执行）；授权 Tina t1456u：确认 #391 合入与排查结论、不立卡，并按官方控制面对无前置节点 `n1` 先 `POST /api/graph/nodes/start`、再 `POST /api/graph/verify`，然后只观察 `n2`–`n12` 是否可开工。
> **诚实口径**：`n1` 开工 HTTP **200**，`PENDING` → `RUNNING`。`n1` 核销 HTTP **200**（官方受理），判定 **未点亮**，节点转为 `FAILED`，错误码 `E_FILES_NOT_WRITTEN`（「节点 n1 的目标文件尚未写入: src/**」）。下游 `n2`–`n12` 级联为 `BLOCKED`，按 `startable.ts` **均不可开工**。未宣称端到端闭环。是否改采证/通配符匹配、或对 `FAILED` 的 `n1` 再 `start` 重试，由 Tina 定。本落账按授权只记录、不立卡。

## 一、Tina 已确认并拍板（记录，不重开结论）

- #391 合入确认收到：新 main `90efeb10bd97b9933faaa56b6390db9ef548c646`，P-305 落账生效，产品代码尖仍为 #389 / `fed205a5805f41bc3516249be16d12bbfefaeb08`。
- 排查结论拍板：**不立卡**。`PENDING` 是设计初态，不是 bug。合同/Worker 控制面与任务图控制面分离是既有设计（与 J.50b 规划/开工分离同一分工哲学），不是缺失的钩子。是否补自动钩子（Worker 完成 → 自动 start/verify）是产品决策，不是修复——本轮不做，仅作为 backlog 候选记在本台账，不立卡。
- 隔离施工树测试结果确认收到：`node --test tests/auth.test.js tests/phone.test.js`，cwd 为隔离施工树，exit 0，tests 13 / pass 13 / fail 0，`duration_ms=35.710875`。这是 Worker 产出质量的第一个实证，**不作为端到端闭环**。

## 二、走查前环境与图快照（事实）

未重启 Daemon，未再发 `run-worker`，未重建合同，未把规划编号当 `confirmation_id` 发出去。合同在走查前已是 `EXECUTING` / `APPROVED`，无需 `resume`。

- Daemon 仍为父进程 19710、子进程 19712，监听 `127.0.0.1:3001`，cwd `/private/tmp/ide-worktrees/j57-prompt-retry`，`git rev-parse HEAD` 为 `637fb71a6cdb8621bcb99d74aae561cf25f69e98`（#391 只改 docs，产品代码与该 SHA 相同）。`GET /health` **200**：`status=ok`，`version=0.1.0`，`pid=19712`，`port=3001`，`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`，`currentBranch=main`。HTTP 认证只用 `Authorization: Bearer`（读试玩目录 `.stagent/session-token`，权限 0600；未打印、未外传）。
- 合同 `contract_1795588309763_cy8zx`：`lifecycle_state=EXECUTING`，`approval.status=APPROVED`。合同文件 mtime 仍为 2026-11-25 17:52:47 香港时间（官方 `resume` 时点），走查后未变。
- 请求体按产品源码官方形状，不臆造：`POST /api/graph/nodes/start` 只传 `{ "node_id": "n1" }`（`daemon/server.ts` L3413–3430，`src/lib/daemon-api.ts` `startTaskGraphNode` L1920–1929）。`POST /api/graph/verify` 对 `COMMAND` 节点只传 `{ "node_id": "n1" }`（`daemon/server.ts` L3434–3661；`src/lib/daemon-api.ts` `TaskGraphVerifyRequest` / `verifyTaskGraphNode` L1845–1939；控制台 `handleVerifyGraphNode` 对非 MANUAL 同样只传 `node_id`）。未提交 `command_results` 或 `execution_exit_code`（官方会以 `E_UNAUTHORIZED_COMMAND` 硬拒绝）。Worker 已写出的文件与 13/13 测试通过记录不作为客户端伪造字段；文件与命令退出码由 Daemon 在施工树内实采。

走查前权威图文件 `/Users/tina/Downloads/stagent-j45-key-playtest/.stagent/specs/task_graph.json`：

- `graph_id=graph_1795588362553_e4fbb0f1`，`contract_id=contract_1795588309763_cy8zx`
- `revision=1`，`generated_at=2026-11-25T06:32:42.551Z`，`updated_at=2026-11-25T06:32:42.553Z`（2026-11-25 14:32:42 香港时间），文件 mtime 2026-11-25 14:32:42 香港时间，size 10200
- 12 个节点全部 `PENDING`，`executed_at` / `commit_sha` 均为 null，`issues=0`，`fingerprints=0`，progress `illuminated=0` / `percent=0`
- 无前置、当时唯一可开工节点：`n1`，标题「落实：src/**」，`kind=CODE_MODIFICATION`，`depends_on=[]`，`target_files=["src/**"]`，`verification_mode=COMMAND`，`verification_commands` 为合同白名单内 9 条 baseline-gate 别名（`baseline-safety-writable-scope`、`baseline-safety-test-integrity`、`baseline-safety-secrets`、`baseline-rollback-auto`、`baseline-rollback-manual`、`baseline-rollback-no-live`、`baseline-path-exit-codes`、`baseline-path-mainline-regression`、`baseline-path-knowledge`）
- `n2`–`n12` 当时均为 `PENDING`，因前置未点亮，按 `src/lib/graph/startable.ts` L31–34 **不可开工**

隔离施工树 `/Users/tina/Downloads/stagent-j45-key-playtest/.stagent/worktrees/task-contract_1795588309763_cy8zx` 在走查前（及核销后复查）仍有 Worker 于 2026-11-25 17:54:44 香港时间写入的 11 个文件；`src/` 下 7 个文件（`auth.js` / `lint.js` / `main.js` / `phone.js` / `server.js` / `styles.css` / `typecheck.js`）物理存在。`git status --porcelain` 显示它们仍为未跟踪（`?? src/` 等）。`HEAD` 仍为 `ae03e3cd58bcf30008281e3dccabe60a6dd780d7`（2026-11-22 00:11:55 +0800 `init`），没有新的施工提交。

## 三、官方 start n1（事实）

`POST http://127.0.0.1:3001/api/graph/nodes/start`，body `{ "node_id": "n1" }`。

- 请求开始：2026-11-25 18:28:30.608 香港时间
- 响应结束：2026-11-25 18:28:30.631 香港时间（daemon.jsonl `ts=2026-11-25T10:28:30.631Z`，`duration_ms=18`）
- HTTP 状态码：**200**
- 错误码：无（响应体除 `graph` 外无 `error` / `code` / `message`）
- 响应图与盘上权威文件一致：`revision` **1 → 2**，`updated_at=2026-11-25T10:28:30.622Z`（2026-11-25 18:28:30 香港时间），图文件 mtime 2026-11-25 18:28:30 香港时间
- 节点：`n1` **`PENDING` → `RUNNING`**（`executed_at` / `commit_sha` 仍为 null）；`n2`–`n12` 仍为 `PENDING`
- progress：`PENDING=11`，`RUNNING=1`，`illuminated=0`，`percent=0`

## 四、官方 verify n1（事实）

`POST http://127.0.0.1:3001/api/graph/verify`，body `{ "node_id": "n1" }`。

- 请求开始：2026-11-25 18:28:54.750 香港时间
- 响应结束：2026-11-25 18:28:54.796 香港时间（daemon.jsonl `ts=2026-11-25T10:28:54.796Z`，`duration_ms=41`）
- HTTP 状态码：**200**（官方受理；不是 4xx 拒收）
- `illuminated=false`
- 错误码：`E_FILES_NOT_WRITTEN`
- 消息：`节点 n1 的目标文件尚未写入: src/**`
- 无 `scope_violations`
- 响应图与盘上权威文件一致：`revision` **2 → 3**，`updated_at=2026-11-25T10:28:54.788Z`（2026-11-25 18:28:54 香港时间），图文件 mtime 2026-11-25 18:28:54 香港时间，size 10415
- 节点：`n1` **`RUNNING` → `FAILED`**（`executed_at` / `commit_sha` 仍为 null）；`n2`–`n12` **`PENDING` → `BLOCKED`**（`TaskGraphEngine.blockDownstream`，`daemon/graph/graph-engine.ts` L448–456、L580–599）
- `issues` 一条：`node_id=n1`，`code=E_FILES_NOT_WRITTEN`，`severity=ERROR`，`recorded_at=2026-11-25T10:28:54.788Z`
- `fingerprints=[]`
- progress：`FAILED=1`，`BLOCKED=11`，`PENDING=0`，`RUNNING=0`，`ILLUMINATED=0`，`percent=0`
- 合同走查后仍为 `EXECUTING` / `APPROVED`，mtime 仍为 2026-11-25 17:52:47 香港时间

本轮**没有**对 `n2`–`n12` 发 `start` 或 `verify`，也**没有**对已 `FAILED` 的 `n1` 再发 `start`（七态允许 `FAILED → RUNNING` 重试，是否再走由 Tina 定）。

## 五、观察 n2–n12 是否可开工（事实）

按 `src/lib/graph/startable.ts` L31–34：可开工 = `state === "PENDING"` 且全部前置为 `ILLUMINATED`。核销后 `n2`–`n12` 均为 `BLOCKED`，前置均未点亮，故 **12 个下游节点均不可开工**（也没有变为 `PENDING`）。`BLOCKED → PENDING` 的放回路径是上游点亮后的 `releaseDownstream`（`graph-engine.ts` L602–636），本轮未发生。

## 六、只读排查：为何是 E_FILES_NOT_WRITTEN（事实与 `ai_inferred`）

**事实：**

- 核销后复查施工树：`src/auth.js` 等 7 个文件仍在，mtime 仍为 2026-11-25 17:54:44 香港时间；仍为未跟踪文件；`HEAD` 仍为 init 提交 `ae03e3cd58bcf30008281e3dccabe60a6dd780d7`。
- 官方采证 `collectWorktreeEvidence`（`daemon/graph/evidence-collector.ts` L116–123）对 `targetFiles` **逐条当作相对路径去读文件并算 SHA-256**，没有把 `src/**` 展开成目录下的实际文件。本节点 `target_files` 是字面量 `src/**`，施工树里不存在名为 `src/**` 的文件，故 `files_written` 为空。
- 点亮判定 `evaluateIllumination`（`daemon/graph/illumination-verifier.ts` L241–250）用规范化后的 `target_files` 与 `files_written` 做**集合精确包含**，同样不展开通配符，因此缺项就是字面量 `src/**`，返回 `E_FILES_NOT_WRITTEN`。
- 判定顺序是固定的（同文件 L181–184、L199–250）：先确认 COMMAND 结果集齐全，再 Scope，再文件写入，然后才是命令退出码与 Commit SHA。本次返回的是文件写入失败码，说明结果集至少覆盖了节点声明的 9 个别名（否则会先报 `E_EMPTY_VERIFICATION_BLOCKED`）。命令退出码是否为 0、以及未提交的未跟踪写入随后能否通过 Commit SHA / 指纹检查，**本轮未走到**，不能写成已证实结论。本次 `verify` 的 HTTP `duration_ms=41`。

**`ai_inferred`：** 官方核销已被受理；`n1` 转为 `FAILED` 是当前「字面路径采证 + 字面匹配」遇到节点目标 `src/**`（通配符）时的既有判定结果，不是客户端把 body 写错，也不是 session 权限挡住。施工树里 Worker 写出的 `src/*` 文件物理存在，但现有采证不会把它们算作满足 `src/**`。这与「自动钩子」无关（start/verify 官方步骤已执行）。是否要把通配符展开进采证/判定、是否要先有施工提交再核销、或先对 `FAILED` 的 `n1` 再 `start` 重试，是产品/下一步验证决策，本轮不改产品代码、不立卡。

## 七、backlog 候选（不是卡）

自动钩子「Worker 完成 → 自动 start/verify」按 Tina t1456u 拍板：是产品决策，不是修复，暂不做，不立卡。仅作为 backlog 候选记在这里。

## 八、状态维持

「确认开工」已签成；Worker 已写出 11 个文件；本轮已对 `n1` 走官方 start/verify，图推进到 `n1=FAILED`、`n2`–`n12=BLOCKED`；端到端闭环未宣称。CI.2 继续 Hold（P-245）。活发送、§3.3、D.1e、S.3 维持 Hold / DEFERRED。R23 暂缓。Console 拆分与第二批未立卡。`multi-worktree-cross-talk` 挂账未动。不重开 J.53 / J.54 / J.55 / J.56 / J.57。不销 OP-34；不激活 S.3。本条仅文档落账，不改产品代码。
