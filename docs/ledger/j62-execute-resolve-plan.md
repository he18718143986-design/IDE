# TASK-J.62 施工方案：`execute` 命令路径解析产品 CLI（P-320）

> **地位**：planning brief；**未立卡、未开工、未改产品代码**。施工权威待审后写入 `development-tasks-active.md`。
> **基线**：`main` `4e84a7e601a19e50e814af28042e417ecf4d58bb`（[#409](https://github.com/he18718143986-design/IDE/pull/409) P-319）。
> **由来**：P-319 收尾排查发现——图核销路径已有 J.59 的 CLI 解析，但**合同 `execute` 路径没有**。本机无全局 `stagent`，故 `execute` 的九条验收命令必然 spawn 失败。
> **估算**：S。

---

## 1. 根因（代码事实）

| 环节 | 事实 |
| :--- | :--- |
| 合同命令 | 九条均为 `executable: "stagent"`、`args: ["check","baseline-gate","--id",…]`（合同文件 `verification_spec.commands`） |
| execute 调用链 | `orchestrator.ts:1172` → `gateway.callTool("stagent_exec_command", {executable, args}, {internal:true})` → `gateway.ts:1911` `runCommand(command, {argv: structured, …})` → `command-runner.ts:454` `spawn(executable, args, {shell:false})` |
| 白名单 | `gateway.ts:1855-1863` 由合同编译成字符串数组，`command-runner.ts:393-404` 做**精确匹配** |
| spawn 失败现状 | `command-runner.ts:568-576` 监听 `error` 事件后 `reject(err)`；gateway `catch`（`:2009-2017`）把非 `CommandSecurityError` 一律记成 **`EXEC_ERROR`**；orchestrator `:1181-1191` 落成 `exitCode = data.exitCode ?? 1`、`passed = !res.isError` |
| 本机实况 | `command -v stagent` 为空；J.59 的 `resolveStagentCli` 只接在图核销路径（`daemon/server.ts:3663-3664`） |

**一句话**：`execute` 走的是「合同命令 → 网关 → `spawn(executable)`」，而 `stagent` 这个裸名在本机 PATH 上不存在，也没有任何解析步骤；九条命令因此全部落到 `EXEC_ERROR` → `exitCode=1` → `passed=false` → `verdict=FAILED` → `can_merge=false` → 合同回 `EXECUTING`。

与 J.59 同一根因（裸名 `stagent` 不可执行），但是**不同路径**：J.59 修的是图核销（`/api/graph/verify`），本卡要修的是合同 `execute`。

## 2. 落点：推荐在 `gateway.handleExecCommand`，不动 `runCommand`

| 方案 | 做法 | 判断 |
| :--- | :--- | :--- |
| **A（推荐）** | 在 `gateway.ts` `handleExecCommand` 里，**威胁守卫之后、`runCommand` 之前**解析；已解析命令串用 `ensureAllowedCommand` 追加进本轮 `allowedCommands`，`runCommand` 收 `argv` = 已解析 argv | **推荐**。白名单就在网关编译（`:1855`），解析 + 白名单增补与它同层，语义闭环；`runCommand` 保持「拿什么跑什么」的通用执行器本色 |
| B | 改 `runCommand` 内部：遇到 `stagent` 就改写并自动放行 | **不推荐**。`runCommand` 被网关、Worker 工具集等多处复用；在通用执行器里静默改写可执行文件并自动放行白名单，等于**全局削弱白名单门禁**，也会改变所有调用方的 `result.command` 语义 |
| C | 合同命令改成绝对入口 | **不可行**：合同已签发，改内容等于改已授权事实 |

### 2.1 为什么必须在「威胁守卫之后」解析

`orchestrator.ts:1146-1159` 用**未解析**的 `{executable:"stagent", args:[…]}` 跑 `assessCommandThreat`；J.59 的注释也写明「威胁守卫拒 Worktree 外绝对路径」。解析结果里带 `/Users/tina/IDE/node_modules/tsx/dist/cli.mjs` 与 `/Users/tina/IDE/bin/stagent.ts`（都在 Worktree 之外），**若先解析再守门会被自己的守卫拒掉**。所以顺序固定为：`主题守卫（原始 argv）→ 解析 → 追加白名单 → runCommand`。

### 2.2 非 `stagent` 命令原样透传

`resolveStagentCli`（`daemon/cli-host/resolve-stagent-cli.ts:68-81`）对 `executable !== "stagent"` 直接返回 `{ok:true, executable, args}`，**不改写**。因此 `npm test`、`node script.js` 等合同命令行为零变化；白名单也不会被追加无关串。

## 3. 错误码：复用 J.59 的两个码，不新造

| 情形 | 码 | 与既有码的分工 |
| :--- | :--- | :--- |
| 解析失败（`missing_exec_path` / `missing_tsx` / `missing_bin`） | **`E_COMMAND_NOT_RESOLVED`** | 区别于 `E_UNAUTHORIZED_COMMAND`（白名单不匹配）与 `E_VERIFICATION_FAILED`（检查体非零） |
| 解析成功但 spawn 失败（`ENOENT` / `EACCES`） | **`E_COMMAND_SPAWN_FAILED`**（`details.spawn_code` 带原始系统码） | 与图核销路径同名同义，排障口径一致 |
| 检查体返回非零 | 保持 `E_VERIFICATION_FAILED`（现状） | 不变 |
| 白名单不匹配 | 保持 `E_UNAUTHORIZED_COMMAND` | 不变 |

- 常量放 `daemon/cli-host/resolve-stagent-cli.ts`（解析器自己的家，也是本卡 `writable_paths`），`gateway.ts` 从这里 import。
- `daemon/graph/illumination-verifier.ts` 里 J.59 自己的同名字面量**保持不动**（readonly）。两处是同一字符串常量、无行为耦合，不强行合并以免动只读文件。
- **不新增** `verificationResults` 字段：`VerificationResultInput`（`orchestrator.ts:219-226`）现无 `error_code`。新码通过 `res.error.code` 回给调用方 + 落 `daemon.jsonl` 审计，`execute` 的响应里仍是「某条命令失败」；若要让证据包逐条带码，需另改 `orchestrator` 与 evidence schema，**超出 S 估算，本卡不做**。

## 4. `writable_paths`（预估四条）

| 文件 | 动作 | 说明 |
| :--- | :--- | :--- |
| `daemon/mcp/gateway.ts` | modify | `handleExecCommand`：威胁守卫后解析 + 追加白名单 + `argv` 用已解析值；catch 区分 `E_COMMAND_NOT_RESOLVED` / `E_COMMAND_SPAWN_FAILED` |
| `daemon/cli-host/resolve-stagent-cli.ts` | modify | 导出两个错误码常量（解析逻辑本身不动） |
| `tests/unit/j62-execute-stagent-resolve.test.ts` | create | 见 §5 |
| `docs/ledger/j62-execute-resolve.md` | create | 施工与实测记录 |

**readonly（零 diff 自证）**：`daemon/runner/command-runner.ts`、`daemon/graph/illumination-verifier.ts`、`daemon/pipeline/orchestrator.ts`、`src/lib/contract.schema.ts`、`daemon/graph/target-file-match.ts`。

## 5. 验收草案（CI 可验证）

- **J62-P1**：`executable:"stagent"` + 合同白名单含原始串 → 网关实际调用 `runCommand` 时 `argv.executable = process.execPath`、`argv.args` 以包内 `tsx` 与 `bin/stagent.ts` 开头、其后原样接合同 args；且已解析命令串在白名单内（否则会抛 `E_UNAUTHORIZED_COMMAND`）。
- **J62-P2**：`executable:"npm"` / `node` / 任意非 `stagent` → `argv` 与白名单**逐字不变**（零改写）。
- **J62-P3**：`missing_tsx` / `missing_bin` / `missing_exec_path` → 返回 `isError` 且 `error.code === "E_COMMAND_NOT_RESOLVED"`，`details.reason` 为对应短码；**不**产生子进程（`onSpawn` 未触发）。
- **J62-P4**：解析成功但 spawn 抛 `ENOENT` → `error.code === "E_COMMAND_SPAWN_FAILED"`、`details.spawn_code === "ENOENT"`；**不**再落成 `EXEC_ERROR`。
- **J62-P5**：检查体返回非零（正常 spawn）→ 仍是 `E_VERIFICATION_FAILED`、`data.exitCode` 原样；白名单外命令仍是 `E_UNAUTHORIZED_COMMAND`（既有语义零漂移）。
- **J62-P6**：`command-runner.ts` / `illumination-verifier.ts` / `orchestrator.ts` / `contract.schema.ts` 相对父提交零 diff；威胁守卫仍在解析之前（用越界绝对路径样本断言仍被拒）。

## 6. 执行顺序与前置（Tina 已锁）

1. ~~试玩目录 `.gitignore` housekeeping~~ —— **已完成**（见 §7）。
2. 本方案报审 → 立卡 → 施工 → 合入 → 重启 Daemon。
3. 再走 `resume` → `execute` → `merge` 三步收尾（不在本卡内）。

## 7. 已完成的前置 housekeeping（问题①，非本卡）

- 试玩目录 `/Users/tina/Downloads/stagent-j45-key-playtest` 新建 `.gitignore`（内容 `.tmp/`）并提交：`66a7e28 chore: ignore .tmp/ (local key material must not be tracked)`，父 `ae03e3c`。
- 钥匙符号链接 `.tmp/deepseek.env` **仍在原位、未被提交**（`git ls-files .tmp` 为 0 条）；提交后 `git status --porcelain -uall` 为空，`assertMainTreeClean` 可通过。
- **副作用提示**：main 由 `ae03e3c` 前进到 `66a7e28`。`merge` 的「目标分支前进」门禁比对的是**证据快照里的 `base_commit_sha`**（`merger.ts:602-606`；该值在 `orchestrator.ts:2477-2481` 于写证据时用 `rev-parse main` 现取），所以只要**在 `execute` 与 `merge` 之间不再往 main 追加提交**，本门禁不会 409。任务分支仍在 `ae03e3c`，`merge-base = ae03e3c`，squash 只应用分支差异，不会删掉 `.gitignore`。

## 8. 排除

不改合同内容、不改 `runCommand` 白名单语义、不放宽威胁守卫、不改图核销路径、不改 evidence schema、不新增第四个错误码、不宣称端到端闭环。
