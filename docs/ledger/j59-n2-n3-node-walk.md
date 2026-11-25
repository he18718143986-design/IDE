# J.59 主链逐节点推进：n2 点亮、n3 停在目标文件未写入（P-313）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.53–J.59。
> **基线**：`main` `5ff9759b0d7204d961b33089c60401156501d082`（[#400](https://github.com/he18718143986-design/IDE/pull/400) P-312 合入后）；Daemon 进程启动源码为 `53682172d6132956f78a87cccc467869bbb4f22b`（P-312 只改 docs，产品代码与该 SHA 相同）。
> **依据**：2026-11-25 22:48–22:49 香港时间（操作者由我执行）；授权 Tina 本轮：合并 #400 后，用同一 Daemon（pid 26569、端口 3001、J.59 在线）同一试玩目录继续对 `n2` 发官方 start / verify；可逐节点推进，每点亮一个记录一次；出现新断点即停、报她定是否立卡。
> **诚实口径**：`n2` 已 **`ILLUMINATED`**（九条 baseline 全部 `exit 0`，图 `revision` 7→9）。`n3` **未点亮**：九条命令仍全部 `exit 0`，但停在目标文件存在性检查——`E_FILES_NOT_WRITTEN`「节点 n3 的目标文件尚未写入: tsconfig.json」，`n3=FAILED`，`revision` 9→11。这是**计划声明 12 个节点、Worker 只写出 11 个文件**导致的结构性断点，不是命令解析/执行问题。**按授权停下，未发 `run-worker`、未改施工树、未绕过检查**。端到端闭环未宣称（12 节点点亮 2 个）。

## 一、合入与 Daemon（事实）

- [#400](https://github.com/he18718143986-design/IDE/pull/400)（P-312）squash 合入，main 由 `53682172` → **`5ff9759b0d7204d961b33089c60401156501d082`**，合入时间 2026-11-25 22:48:06 香港时间（操作者由我执行）。合入前必需面全绿（Docs check 48s、Knowledge 56s、Perf 44s、三平台 Lint/Typecheck/Unit 全 pass），`mergeable=MERGEABLE`、`mergeStateStatus=CLEAN`、Bugbot `skipping`；只改 4 个 docs 文件（新建 `docs/ledger/j59-n1-illumination-retest.md` + ledger README / changelog P-312 / 版本头第 296 条），无产品代码。
- Daemon 未重启，仍为 pid **26569**（PPID 26568）、`127.0.0.1:3001`，启动源码 `53682172d6132956f78a87cccc467869bbb4f22b`。P-312 仅 docs，产品代码与该 SHA 相同，故本轮实测仍等价于「J.59 在线的当前 main」。
- `/Users/tina/IDE` 工作区干净；重启前收起的 `stash@{0}`（`pre-J59-retest stray whitespace-only daemon/server.ts edit`）**仍保留未处置**，见第七节。
- HTTP 认证只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`；未打印、未外传。

## 二、n2 官方 start / verify（事实）

`n2` 目标 `["package.json"]`（字面路径，非 glob），施工树已由 Worker 写出该文件（443 字节，mtime 2026-11-25 17:54）。

### 2.1 start n2

- 请求：`POST /api/graph/nodes/start`，body `{ "node_id": "n2" }`。
- 客户端：2026-11-25 22:48:29 香港时间，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T14:48:29.706Z`，`requestId=24660b3194fa`，`route=POST /api/graph/nodes/start`，`code=200`，`duration_ms=17`。
- 图：`revision` 7→**8**，`updated_at=2026-11-25T14:48:29.698Z`。
- 节点转移：`n2` `PENDING`→`RUNNING`；`n1` 保持 `ILLUMINATED`；`n3`–`n12` 仍 `BLOCKED`。

### 2.2 verify n2

- 请求：`POST /api/graph/verify`，body `{ "node_id": "n2" }`。
- 客户端：2026-11-25 22:48:34 发 → 22:48:38 回，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T14:48:38.548Z`，`requestId=cd41b3c6bc52`，`route=POST /api/graph/verify`，`code=200`，`duration_ms=4382`。
- 响应：`illuminated=true`，无 `code` / `message` / `error`。
- 图：`revision` 8→**9**，`updated_at=2026-11-25T14:48:38.539Z`。
- 节点转移：`n2` `RUNNING`→**`ILLUMINATED`**；`n3` `BLOCKED`→**`PENDING`**；`n4`–`n12` 仍 `BLOCKED`。进度 `ILLUMINATED=2`、`PENDING=1`、`BLOCKED=9`，`percent=17`。
- `n2.executed_at=2026-11-25T14:48:38.539Z`，`n2.commit_sha=ae03e3cd58bcf30008281e3dccabe60a6dd780d7`（与 n1 同一 `init` 提交）。
- 指纹由 7 条增至 **8 条**：新增 `package.json`；`issues=[]`。

### 2.3 n2 九条 baseline 命令（daemon.jsonl，脱敏）

| # | alias | ts（UTC） | exit_code | stdout_length | stderr_length |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `baseline-safety-writable-scope` | `14:48:34.662Z` | 0 | 102 | 0 |
| 2 | `baseline-safety-test-integrity` | `14:48:35.147Z` | 0 | 102 | 0 |
| 3 | `baseline-safety-secrets` | `14:48:35.630Z` | 0 | 95 | 0 |
| 4 | `baseline-rollback-auto` | `14:48:36.115Z` | 0 | 94 | 0 |
| 5 | `baseline-rollback-manual` | `14:48:36.599Z` | 0 | 96 | 0 |
| 6 | `baseline-rollback-no-live` | `14:48:37.076Z` | 0 | 97 | 0 |
| 7 | `baseline-path-exit-codes` | `14:48:37.560Z` | 0 | 96 | 0 |
| 8 | `baseline-path-mainline-regression` | `14:48:38.041Z` | 0 | 105 | 0 |
| 9 | `baseline-path-knowledge` | `14:48:38.522Z` | 0 | 95 | 0 |

- 全部 `exit_code=0`、`stderr_length=0`；成功路径按 J.59 口径只记 alias / 长度 / 退出码。
- 未出现 `E_COMMAND_NOT_RESOLVED` / `E_COMMAND_SPAWN_FAILED` / `E_COMMAND_FAILED`。

## 三、n3 官方 start / verify（新断点）

`n3` 目标 `["tsconfig.json"]`（字面路径）。施工树**无**该文件（见第五节清单）。

### 3.1 start n3

- 请求：`POST /api/graph/nodes/start`，body `{ "node_id": "n3" }`。
- 客户端：2026-11-25 22:48:57 香港时间，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T14:48:57.976Z`，`requestId=e5b6082da810`，`code=200`，`duration_ms=17`。
- 图：`revision` 9→**10**，`updated_at=2026-11-25T14:48:57.967Z`。`n3` `PENDING`→`RUNNING`。

### 3.2 verify n3

- 请求：`POST /api/graph/verify`，body `{ "node_id": "n3" }`。
- 客户端：2026-11-25 22:48:57 发 → 22:49:02 回，HTTP **200**。
- daemon.jsonl：ts `2026-11-25T14:49:02.418Z`，`requestId=8dbf79070c03`，`code=200`，`duration_ms=4415`。
- 响应：`illuminated=false`，`code` 为 **`E_FILES_NOT_WRITTEN`**，`message` 为「节点 n3 的目标文件尚未写入: tsconfig.json」。
- 图：`revision` 10→**11**，`updated_at=2026-11-25T14:49:02.410Z`。`n3` `RUNNING`→`FAILED`；`n4`–`n12` 仍 `BLOCKED`；`n1`/`n2` 保持 `ILLUMINATED`。进度 `ILLUMINATED=2`、`FAILED=1`、`BLOCKED=9`。
- `issues` 新增一条：`{ node_id: "n3", code: "E_FILES_NOT_WRITTEN", message: "节点 n3 的目标文件尚未写入: tsconfig.json", severity: "ERROR", recorded_at: "2026-11-25T14:49:02.410Z" }`。
- **九条 baseline 命令本轮仍全部 `exit 0`**（`14:48:58.502Z`–`14:49:02.392Z`，stdout 94–105、stderr 0），即命令层通过、停在目标文件存在性检查。与 P-309 那轮「命令全 exit 1」不同，本次不是命令解析或执行问题。

## 四、断点定性（事实，不推断修法）

- 官方点亮判定顺序：命令实跑 → 目标文件存在性 → 指纹。`n3` 命令全绿，停在存在性检查。
- 根因（事实描述）：计划为 12 个节点声明了 12 组目标文件，**Worker 实际只写出 11 个文件**，其中不包含 `tsconfig.json`、`tsconfig.*.json`、`vitest.config.*`、`vite.config.*`、`*.config.ts`、`*.config.mjs`、`*.config.js`。计划与 Worker 产出不一致，属「计划声明的脚手架/配置文件未被写入」，不是 J.58 / J.59 修复未生效。
- 未绕过：未改施工树补文件、未改 `.stagent` 台账、未发 `run-worker`、未改图节点状态、未跳节点。按授权停下待 Tina 定是否立卡（可能方向：计划生成侧只声明实际需要的目标文件，或 Worker 侧按计划补齐脚手架；均需她拍板，本轮不写修法）。

## 五、全图目标文件 vs 施工树实文件（只读盘点）

施工树 `/Users/tina/Downloads/stagent-j45-key-playtest/.stagent/worktrees/task-contract_1795588309763_cy8zx`，`HEAD=ae03e3c`（`init`），11 个文件全部 staged 未提交：`index.html`、`package.json`、`src/auth.js`、`src/lint.js`、`src/main.js`、`src/phone.js`、`src/server.js`、`src/styles.css`、`src/typecheck.js`、`tests/auth.test.js`、`tests/phone.test.js`。

| 节点 | 目标 | 施工树匹配 | 判定 |
| :--- | :--- | :--- | :--- |
| `n1` | `src/**` | 7 个 `src/*.js` | `ILLUMINATED` |
| `n2` | `package.json` | `package.json` | `ILLUMINATED` |
| `n3` | `tsconfig.json` | **无** | `FAILED`（本次） |
| `n4` | `tsconfig.*.json` | **无** | `BLOCKED` |
| `n5` | `vitest.config.*` | **无** | `BLOCKED` |
| `n6` | `vite.config.*` | **无** | `BLOCKED` |
| `n7` | `*.config.ts` | **无** | `BLOCKED` |
| `n8` | `*.config.mjs` | **无** | `BLOCKED` |
| `n9` | `*.config.js` | **无** | `BLOCKED` |
| `n10` | `index.html` | `index.html` | 依赖链未到 |
| `n11` | `tests/**` | 2 个 `tests/*.test.js` | 依赖链未到 |
| `n12` | `**/*.test.ts` | **无**（只有 `.test.js`） | 依赖链未到；**扩展名不匹配已确认** |

- `n12` 的 `**/*.test.ts` 与施工树 `tests/*.test.js` 扩展名不匹配（卡面已预警），本轮**未对它发请求**，只按磁盘事实确认会落空。
- `n10`（`index.html`）与 `n11`（`tests/**`）目标文件已在树内，但因 `n3` 未点亮，依赖链未到，保持 `BLOCKED`。

## 六、不在本落账结论内的事项

- 未宣称端到端闭环：12 节点只点亮 2 个，`n3` 已 `FAILED`。
- 未立卡：`n3`–`n9` 目标文件缺失、`n12` 扩展名不匹配、`markStale` / `nodeTouchesPaths` glob 化、设计层挂账、自动钩子均不在本轮，由 Tina 定。
- 未点「确认方案 / 确认开工」，未调冻结或开工接口，未发 `run-worker`，未改产品代码、未改施工树文件、未改 `.stagent` 台账与图节点状态。
- 合同仍 `EXECUTING` / `APPROVED`（`state.json` `updated_at` 仍为 `2026-11-25T11:30:48.057Z`，本轮未变）。

## 七、待处置：`stash@{0}`

- `/Users/tina/IDE` 现存 `stash@{0}`：`On main: pre-J59-retest stray whitespace-only daemon/server.ts edit`，内容为 `daemon/server.ts` 约 L4610 附近一处**仅缩进 ±5 行、逻辑等价**的未提交改动（`ensureIntentCompilerHost` / `commitUserTurn` 的 try 块缩进）。产生于 P-312 前为跑干净 `53682172` 而收起。
- 本轮未恢复、未丢弃。是否 `git stash drop`（该缩进改动没有语义价值）或 `git stash pop` 保留，等 Tina 指示；当前工作区干净、不影响运行。

## 八、密钥与日志纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容，未把这些文件拷离本机。daemon.jsonl 摘录只含 alias、长度与退出码。
