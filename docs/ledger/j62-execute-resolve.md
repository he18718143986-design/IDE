# TASK-J.62 施工与实测记录：`execute` 路径解析产品 CLI（P-322）

> **地位**：施工记录。施工权威在 [`../specs/development-tasks-active.md`](../specs/development-tasks-active.md#task-j.62)；方案与拍板见 [`j62-execute-resolve-plan.md`](./j62-execute-resolve-plan.md)。
> **基线**：`main` `d3b03dd6c2455e815ad7bee4c68fb07dfff51691`（[#411](https://github.com/he18718143986-design/IDE/pull/411) P-321 立卡）。
> **状态**：代码已施工、本地全绿；真机 `execute` 复测在合入并重启 Daemon 后另行追加（本文件先不写结果）。

## 一、交付内容

| 文件 | 动作 | 说明 |
| :--- | :--- | :--- |
| `daemon/mcp/gateway.ts` | modify | `handleExecCommand` 内在白名单编译之后、`runCommand` 之前解析 `stagent`；已解析串 `ensureAllowedCommand` 入白名单；`catch` 区分 `E_COMMAND_SPAWN_FAILED` |
| `daemon/cli-host/resolve-stagent-cli.ts` | modify | 导出 `E_COMMAND_NOT_RESOLVED` / `E_COMMAND_SPAWN_FAILED` 常量（解析逻辑零改动） |
| `tests/unit/j62-execute-stagent-resolve.test.ts` | create | 6 例，覆盖 J62-P1～P6 |
| `docs/ledger/j62-execute-resolve.md` | create | 本文件 |

**readonly 五文件零 diff**（`git diff --stat` 为空）：`daemon/runner/command-runner.ts`、`daemon/graph/illumination-verifier.ts`、`daemon/pipeline/orchestrator.ts`、`src/lib/contract.schema.ts`、`daemon/graph/target-file-match.ts`。

## 二、实现要点

1. **落点**：`handleExecCommand` 的「2. Whitelist compilation」之后新增 2.5 段。该位置**晚于**威胁守卫（Worker 面 `!internal` 时在更早处评估；orchestrator 侧 `internal: true` 由其自己在 `orchestrator.ts:1146-1159` 对原始 argv 评估），**早于** `runCommand`。
2. **白名单前置（施工中加固的一条）**：只在**原始命令串已在合同白名单**时才解析。
   - 若不前置，`stagent <任意参数>` 会因「已解析串自动入白名单」被放行，等于借解析放宽合同授权。
   - 未授权的 `stagent` 命令原样交给 `runCommand` 精确匹配拒掉（`E_UNAUTHORIZED_COMMAND` 零漂移），由 J62-P6 锁定。
3. **改写范围**：仅 `executable === "stagent"` 且已授权时，`execArgv = {executable: process.execPath, args: [tsx, bin, ...原 args]}`；`command`（审计、超时查表用）保持原始串，故 `resolveCommandTimeoutSeconds` 仍按合同声明取值。
4. **解析失败**：`E_COMMAND_NOT_RESOLVED` + `details.reason`（`missing_exec_path` / `missing_tsx` / `missing_bin`），在 `runCommand` 之前 `return`，**不产生子进程**。
5. **spawn 失败**：`catch` 里 `code === "ENOENT" | "EACCES"` → `E_COMMAND_SPAWN_FAILED` + `details.spawn_code`；不再与其它内部异常一起埋进 `EXEC_ERROR`。
6. **零漂移**：`CommandSecurityError` → `E_UNAUTHORIZED_COMMAND`（不变）；检查体非零 → `E_VERIFICATION_FAILED` + `data.exitCode` 原样（不变）；未新增 `verificationResults.error_code`。

## 三、本地验证（事实）

| 命令 | 结果 |
| :--- | :--- |
| `npx vitest run tests/unit/j62-execute-stagent-resolve.test.ts` | **6/6 passed** |
| 相关三文件（J.62 / W.2 五工具 / J.59 解析） | **50/50 passed** |
| `npx vitest run tests/unit tests/daemon` | **271 文件 / 2809 例全绿** |
| `npx tsc --noEmit` | **0 错误** |
| `npx eslint` 三个改动文件 | **0 问题** |

用例覆盖：
- **P1**：白名单内 `stagent check baseline-gate --id …` → `runCommand` 收到 `executable=process.execPath`、`args=[tsx, bin, …原 args]`，且 `allowedCommands` **同时**含已解析串与原始串。
- **P2**：`node -e …` → `argv` 与 `allowedCommands` **逐字不变**（严格 `toEqual`）。
- **P3**：`process.execPath` 置空 → `E_COMMAND_NOT_RESOLVED` + `reason=missing_exec_path`，且 `runCommand` **一次都没被调用**（子进程未产生）。
- **P4**：不存在的可执行文件 → `E_COMMAND_SPAWN_FAILED` + `spawn_code=ENOENT`。
- **P5**：检查体 `exit 3` → `E_VERIFICATION_FAILED` 且 `data.exitCode=3`；白名单外命令 → `E_UNAUTHORIZED_COMMAND`。
- **P6**：合同授权 A 参数、调用 B 参数 → 仍 `E_UNAUTHORIZED_COMMAND`（解析不放宽授权）。

## 四、待执行（本 PR 合入后，不在本文件先写结果）

1. 以新 main 重启 Daemon（旧 Daemon pid 51894 @ `cd28cc0` 必须停）。
2. 走 `resume` → `execute` → `merge` 三步收尾；**`execute` 与 `merge` 之间不往试玩目录 main 追加任何提交**（`merge` 的目标分支门禁比对证据里的 `base_commit_sha`）。
3. 实测结果追加到本文件第五节与 ledger。
4. `n12` 扩展名不匹配、`markStale` / `nodeTouchesPaths` glob 化、设计层挂账、自动钩子仍不在本卡。

## 五、密钥与纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容。未改已签发合同，未在 `runCommand` 内做全局改写，未放宽威胁守卫或白名单精确匹配。
