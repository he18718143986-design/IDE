# 合同收尾三步实测：resume → execute → merge，首次走到 MERGED（P-323）

> **地位**：实测记录。不改产品代码，不重开 J.53–J.62。
> **基线**：`main` `6d1590ae744953f0d5e189595ab50efa12bed86c`（[#414](https://github.com/he18718143986-design/IDE/pull/414) P-322 账对平）；**产品代码尖仍为 [#412](https://github.com/he18718143986-design/IDE/pull/412) squash `a05b5bf6b96b53e77325ea07e8cd9b17cb967881`**（J.62 施工；其后 #413 / #414 均为 docs）。
> **依据**：2026-11-26 04:33–04:34 香港时间（操作者由我执行）；授权 Tina 本轮点名：「重启 Daemon，走 `resume`→`execute`→`merge` 三步收尾」。
> **口径**：三步全过、合同 `MERGED`，**首次走到合同终态**。下面第五节写清这次「闭环」覆盖了什么、没覆盖什么，不做超额宣称。

## 一、Daemon

- 旧 Daemon（pid 51894 @ `cd28cc0`）已停；新 Daemon 以 `6d1590a` 启动：`npm run stagent -- open /Users/tina/Downloads/stagent-j45-key-playtest`。
- 监听进程 **46636**、端口 `127.0.0.1:3001`；`GET /health` **200**（`requestId=6a527d9a0fe6`，9ms，ts `2026-11-25T20:33:33.499Z`）：`status=ok`、`pid=46636`、`port=3001`、`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`。
- 源码 SHA `6d1590ae744953f0d5e189595ab50efa12bed86c`；产品代码（J.62）尖 `a05b5bf`。
- HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`；未打印、未外传。

## 二、起点状态

| 项 | 值 |
| :--- | :--- |
| 合同 | `contract_1795588309763_cy8zx`，`PENDING_RESUME`（crash-recovery 置位）、`contract_revision=1`、`approval.status=APPROVED` |
| 试玩目录 main | `66a7e28732c04de640dd3cc153f8c8967c0d73f0`（`.gitignore` housekeeping 那次提交） |
| 试玩目录工作区 | `git status --porcelain -uall` 为空 |
| 任务分支 / worktree | `task/contract_1795588309763_cy8zx` @ `ae03e3c`；worktree 在 `.stagent/worktrees/task-contract_1795588309763_cy8zx` |
| 任务图 | `graph_1795588362553_e4fbb0f1`，`revision=18`，4 节点全 `ILLUMINATED` |

## 三、三步请求与响应（事实）

### 3.1 第一步 `resume`

- 请求：`POST /api/contracts/contract_1795588309763_cy8zx/resume`，body `{}`。
- 时间：客户端 `2026-11-25T20:33:33Z`（04:33:33 香港时间）。
- 响应：HTTP **200**；daemon.jsonl `requestId=22e436d5d958`，`duration_ms=27`，ts `20:33:33.490Z`。
- 合同流转：`PENDING_RESUME` → **`EXECUTING`**（`contract_revision` 仍 1）。

### 3.2 第二步 `execute`

- 请求：`POST /api/contracts/contract_1795588309763_cy8zx/execute`，body `{}`。
- 时间：`20:33:39Z` 发 → `20:33:44Z` 回（约 5 秒）。
- 响应：HTTP **200**；daemon.jsonl `requestId=ed0ad3403f47`，`duration_ms=5085`，ts `20:33:44.402Z`。
- 合同流转：`EXECUTING` → **`VERIFYING`** → **`AUDITED`**。
- **Evidence**：`evidence_id=evi_1795638824033_hu2k0`，落盘 `.stagent/evidence/contract_1795588309763_cy8zx-evi_1795638824033_hu2k0.json`。
- `verdict`：`status=PASSED`、`can_merge=true`、`summary="All 9 verification command(s) passed"`、`verification_retry_count=0`。
- **九条命令全部 `exit 0` / `passed=true`**（J.62 解析生效，不再 ENOENT）：

| alias | exit | 耗时 |
| :--- | :--- | :--- |
| `baseline-safety-writable-scope` | 0 | 565ms |
| `baseline-safety-test-integrity` | 0 | 486ms |
| `baseline-safety-secrets` | 0 | 534ms |
| `baseline-rollback-auto` | 0 | 498ms |
| `baseline-rollback-manual` | 0 | 504ms |
| `baseline-rollback-no-live` | 0 | 479ms |
| `baseline-path-exit-codes` | 0 | 480ms |
| `baseline-path-mainline-regression` | 0 | 500ms |
| `baseline-path-knowledge` | 0 | 482ms |

- 证据其它字段（事实）：`scope_audit.passed=true`、`forbidden_violations=[]`、`budget_exhausted=false`、`graveyard_check="snapshot"`；`tests_modified=true`；`worker_control_mode="GATEWAY_ENFORCED"`（**声明档**，见 §5.4）；`git_info.base_commit_sha=66a7e28`、`task_commit_sha=2028769`、`diff_stat` 为空。
- `delivery_state=CANDIDATE_VERIFIED`。

### 3.3 第三步 `merge`

- 请求：`POST /api/contracts/contract_1795588309763_cy8zx/merge`，body `{"evidence_id":"evi_1795638824033_hu2k0","reviewer":"local-user"}`。
- 时间：`20:34:03Z`。
- 响应：HTTP **200**；daemon.jsonl `requestId=5bdac190ac22`，`duration_ms=154`，ts `20:34:03.654Z`。
- **squash 提交**：`02110b62452348947ab7f9bde3e76628f8665522`（父 `66a7e28`）。
- `nothingToMerge=false`、`conflictResolution=null`、**`worktreeRemoved=true`**。
- 合同流转：`AUDITED` → **`MERGED`**。
- 提交信息（摘录）：`feat(1795588309763_cy8zx): 打开登录页后可以用手机号登录`，trailer 含 `Stagent-Contract-ID: contract_1795588309763_cy8zx`、`Stagent-Scheme-Items: ITEM-2`、`Stagent-Evidence-ID: evi_1795638824033_hu2k0`。
- 归档：`.stagent/records/contract_1795588309763_cy8zx/` 写入 `delivery-summary.json`、`audit-manifest.json`、`design-note.json`、`obligations.json`（`recordsArchive.ok=true`）。

### 3.4 「目标分支前进」门禁未被触发（说明）

- 证据里的 `base_commit_sha=66a7e28` 正是 merge 时 main 的 tip；`execute`（20:33:44Z）与 `merge`（20:34:03Z）之间**没有**往试玩目录 main 追加任何提交，故门禁比对通过。这是本轮硬约束的直接验证。

## 四、收尾后状态（事实）

| 项 | 值 |
| :--- | :--- |
| 试玩目录 main | **`02110b6`**（`feat(1795588309763_cy8zx): 打开登录页后可以用手机号登录`）→ 父 `66a7e28` → `ae03e3c` |
| 试玩目录工作区 | `git status --porcelain -uall` **为空** |
| worktree | `git worktree list` 只剩主工作树；任务 worktree 已删除 |
| 分支 | `git branch` 只剩 `main`；`task/contract_1795588309763_cy8zx` 已删除 |
| 落入 main 的产物 | `src/auth.js`、`src/lint.js`、`src/main.js`、`src/phone.js`、`src/server.js`、`src/styles.css`、`src/typecheck.js`、`tests/auth.test.js`、`tests/phone.test.js`、`index.html`、`package.json`、`.gitignore` |
| 合同文件 | `lifecycle_state=MERGED`、`contract_revision=1`、`approval.status=APPROVED` |
| `state.json` | `presentation_state=MERGED`、`message="打开登录页后可以用手机号登录：已交付归档"`、`updated_at=2026-11-25T20:34:03.666Z` |
| 任务图 | `revision=18` 未变，`n1`/`n2`/`n10`/`n11` 仍全 `ILLUMINATED` |
| 另一合同 | `contract_1795556756329_1qqpk` 仍 `DRAFT`（本轮未动） |

## 五、这次「走通」覆盖了什么、没覆盖什么

### 5.1 走通了（首次）

- 同一条链上 **`PENDING_RESUME → EXECUTING → VERIFYING → AUDITED → MERGED`** 全程由官方端点驱动，无手工改合同/图/证据。
- J.62 的网关解析在**真实合同命令**上生效：九条 `stagent check baseline-gate` 命令不再 ENOENT，全部真实跑完并 `exit 0`。
- 证据三证齐（命令退出码 + scope 审计 + 指纹）且 `can_merge=true`；merge 门禁全过；worktree 与任务分支按设计清理；记录归档落盘。

### 5.2 没有覆盖（不得读成「产品验收通过」）

- 九条命令是**基线自检**（写范围、测试完整性、密钥、回滚×3、退出码、主线回归、知识库），**不是应用级测试**（本合同的 `verification_spec.commands` 没有 `npm typecheck` / `npm test`）。所以这次证明的是「流水线能走通」，不是「登录页功能正确」。
- **未做试玩认可**：`PlaytestAcceptBlock` 的「认可完成」→ `POST /api/playtest/evidence` 未调用；本试玩目录也没有 LIVE 发布（该端点会 409 `E_PLAYTEST_NO_ACTIVE_RELEASE`）。本合同 `references` 为空，按裁决不附加 `check playtest`，故合入门禁不要求它。
- **未做浏览器验证**：`POST /api/preview/real/start` 在 merge 后返回 200，但未在浏览器里打开成品页核对。
- 右栏 AI 对话、活发送路径、§3.3 自动点亮仍 Hold / 未实现，与本轮无关。

### 5.3 证据里两处值得如实的字段

- `tests_modified=true`：任务 worktree 的提交包含新增 `tests/*.test.js`（Worker 写出的文件），证据如实记录；`scope_audit.passed=true`、`forbidden_violations=[]`。
- `worker_control_mode=GATEWAY_ENFORCED`：这是**合同声明档**。本轮派工走的是宿主进程 + 网关白名单，没有 `SandboxWitness`；按 W.5c-iii 的「记实不记名」裁决，声明 `SANDBOX_ENFORCED` 才会降记为 `UNCONTROLLED_EXTERNAL`，声明 `GATEWAY_ENFORCED` 时证据保持声明档。**不得**据此宣称已具备容器级隔离。

### 5.4 结论一句话

**流水线端到端首次走到合同 `MERGED`**；应用级正确性、试玩认可、浏览器成品验证都不在本轮范围，均未宣称。

## 六、密钥与纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容。未手工改 `.stagent/` 下任何合同、图、证据文件；未点「认可完成」；`execute` 与 `merge` 之间未往试玩目录 main 追加提交。
