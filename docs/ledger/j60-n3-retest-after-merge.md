# J.60 合入后重启 Daemon 并对 n3 官方重试 start / verify 落账（P-315）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.53–J.60。
> **基线**：`main` `5173e8ece9e0391c0b893ba61284094ae04ed0b5`（[#403](https://github.com/he18718143986-design/IDE/pull/403) J.60 施工）。
> **依据**：2026-11-26 01:09–01:12 香港时间（操作者由我执行）；授权 Tina 本轮：`TASK-J.60` 开工并合并；「J.60 合入并重启 Daemon 后，对 n3 官方重试 start/verify——计划目标对齐后应能过存在性检查；实测落 ledger」。
> **诚实口径**：`n3` **仍未点亮**，错误码仍是 `E_FILES_NOT_WRITTEN`（`tsconfig.json`）。原因不是 J.60 未生效，而是**既有任务图在 J.60 之前生成并持久化**，其 `n3.target_files` 仍是旧的 `["tsconfig.json"]`；重启 Daemon 不会重建图。J.60 只影响**新提案**。九条 baseline 命令本轮仍全部 `exit 0`。未改施工树、未改图节点、未绕过检查。端到端闭环未宣称。

## 一、合入与 Daemon（事实）

- [#403](https://github.com/he18718143986-design/IDE/pull/403)（J.60 施工）squash 合入，main 由 `968def32` → **`5173e8ece9e0391c0b893ba61284094ae04ed0b5`**，合入时间 2026-11-25T17:09:42Z（2026-11-26 01:09 香港时间，操作者由我执行）。合入前必需面全绿；Windows Unit 为存量 16 文件 / 28 例（`continue-on-error`，本卡用例在 Windows 上 5/5 绿）；`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`；Bugbot `skipping`。
- 旧 Daemon（pid 26569，源码 `53682172`）已停；新 Daemon 以 `5173e8e` 启动：`npm run stagent -- open /Users/tina/Downloads/stagent-j45-key-playtest`，监听进程 **77517**（PPID 77516），`127.0.0.1:3001`。
- `GET /health` **200**（`requestId=e7ce3de9bfee`，8ms，ts `2026-11-25T17:11:43.005Z`）：`status=ok`、`version=0.1.0`、`pid=77517`、`port=3001`、`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`、`currentBranch=main`。源码 SHA `5173e8ece9e0391c0b893ba61284094ae04ed0b5`。
- HTTP 认证只用试玩目录 `.stagent/session-token`（0600）；未打印、未外传。

## 二、复测前图快照（事实）

- 图 `revision=11`，`updated_at=2026-11-25T14:49:02.410Z`（P-313 那轮落点，早于 J.60）。
- `n3.target_files` 仍为 `["tsconfig.json"]`。
- 节点状态：`n1=ILLUMINATED`、`n2=ILLUMINATED`、`n3=FAILED`、`n4`–`n12=BLOCKED`。
- 结论：图是持久化产物，J.60 的提案侧过滤不回溯改写已生成的节点。

## 三、官方请求与响应（事实）

### 3.1 start n3

- `POST /api/graph/nodes/start`，body `{ "node_id": "n3" }`。
- 客户端 2026-11-26 01:11:49 香港时间，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T17:11:49.871Z`，`requestId=e6274107f798`，`code=200`，`duration_ms=16`。
- 图：`revision` 11→**12**，`updated_at=2026-11-25T17:11:49.863Z`；`n3` `FAILED`→`RUNNING`。

### 3.2 verify n3

- `POST /api/graph/verify`，body `{ "node_id": "n3" }`。
- 客户端 01:11:49 发 → 01:11:54 回，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T17:11:54.320Z`，`requestId=e6ec1f6755f1`，`code=200`，`duration_ms=4423`。
- 响应：`illuminated=false`，`code` 为 **`E_FILES_NOT_WRITTEN`**，`message` 为「节点 n3 的目标文件尚未写入: tsconfig.json」。
- 图：`revision` 12→**13**，`updated_at=2026-11-25T17:11:54.312Z`；`n3` `RUNNING`→`FAILED`；`n1`/`n2` 保持 `ILLUMINATED`；`n4`–`n12` 仍 `BLOCKED`。
- `issues` 为一条同文言记录（`recorded_at=2026-11-25T17:11:54.312Z`）。

### 3.3 九条 baseline 命令（daemon.jsonl，脱敏）

| # | alias | ts（UTC） | exit_code | stdout_length | stderr_length |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `baseline-safety-writable-scope` | `2026-11-25T17:11:50.432Z` | 0 | 102 | 0 |
| 2 | `baseline-safety-test-integrity` | `2026-11-25T17:11:50.904Z` | 0 | 102 | 0 |
| 3 | `baseline-safety-secrets` | `2026-11-25T17:11:51.398Z` | 0 | 95 | 0 |
| 4 | `baseline-rollback-auto` | `2026-11-25T17:11:51.892Z` | 0 | 94 | 0 |
| 5 | `baseline-rollback-manual` | `2026-11-25T17:11:52.370Z` | 0 | 96 | 0 |
| 6 | `baseline-rollback-no-live` | `2026-11-25T17:11:52.851Z` | 0 | 97 | 0 |
| 7 | `baseline-path-exit-codes` | `2026-11-25T17:11:53.330Z` | 0 | 96 | 0 |
| 8 | `baseline-path-mainline-regression` | `2026-11-25T17:11:53.811Z` | 0 | 105 | 0 |
| 9 | `baseline-path-knowledge` | `2026-11-25T17:11:54.292Z` | 0 | 95 | 0 |

- 共 9 条 `kind=graph_verify_command`，`all exit_code=0`、`stderr_length=0`；命令层仍然通过，停在目标文件存在性检查。

## 四、结论（事实）

- **J.60 的过滤没有消失，也没有被绕过**：代码侧单测与实跑都证明新提案不再产出 `tsconfig.json` 节点（`tests/unit/proposal-scope-align.test.ts` 5/5，其中 14 条绿野模板 + 九条 `baseline-*` → 只剩 `src/**`、`package.json`、`index.html`、`tests/**`）。
- **本次复测用不上它**：图 `graph_1795588362553_e4fbb0f1` 生成于 2026-11-25 06:32（J.60 之前），`n3` 的目标在生成时就固定为 `tsconfig.json`；Daemon 重启只重读图，不重建图。
- 因此「J.60 合入后 n3 应能过存在性检查」这一预期，只在**重新提案/重建图**后成立；对既有图做官方 start/verify 必然仍是 `E_FILES_NOT_WRITTEN`。
- 未做：未重新提案、未重建图、未改图节点目标、未改施工树、未发 `run-worker`、未点「确认开工」。

## 五、待 Tina 定的下一步（不擅自执行）

1. **重新提案重建图**：`POST /api/graph/proposal` 用 J.60 后的提案重建，节点将变为 4 个（`src/**`、`package.json`、`index.html`、`tests/**`）。代价：图重置为全 `PENDING`，`n1`/`n2` 的 `ILLUMINATED` 与指纹需重新核销。
2. **保留既有图**：接受 `n3` 永久 `FAILED`，J.60 只对后续新合同/新图生效，本试玩目录停在「12 节点点亮 2 个」。
3. 其他（如另开一张「图迁移/重建」卡）由 Tina 定。

## 六、不在本落账结论内的事项

- 未宣称端到端闭环（12 节点点亮 2 个）。
- 未立卡：`n12` 扩展名不匹配（`**/*.test.ts` vs `tests/*.test.js`）、`markStale` / `nodeTouchesPaths` glob 化、设计层挂账、自动钩子均不在本轮。
- 未改 J.58 / J.59 / J.60 的验收口径，不重开已完成卡。

## 七、密钥与日志纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容，未把这些文件拷离本机。daemon.jsonl 摘录只含 alias、长度与退出码。
