# TASK-P0.2 施工记录：全量候选变更（Candidate Changes）Scope 审计

> **地位**：施工记录（卡面 `writable_paths` 第 8 条）。不改卡面、不改 Schema 兼容面、不接容器、不动 Gateway。
> **基线**：`main` `24b9768e4a171d6af7098deff23896e5ccc36107`（[#419](https://github.com/he18718143986-design/IDE/pull/419) P-325 TASK-P0.1 完工回写）。
> **依据**：2026-11-26 Tina 点名开工 TASK-P0.2（操作者由我执行），并针对停工点二给出拍板裁决：选 A（新旧路径均审）。
> **口径**：本记录不是 P0 风险解除声明；合入前仍需独立审查实现与测试、负向测试实跑、全量回归、新增绕过路径检查、Evidence 与 Merge 实际裁决行为确认（P-324 审批边界）。

## 一、改了什么

| 文件 | 改动 |
| :--- | :--- |
| `daemon/pipeline/candidate-scope-audit.ts`（新建） | 全量候选变更统一审计函数，覆盖 `git status --porcelain -uall` 全状态（`M`/`A`/`D`/`R`/`C`/`T`/`U`/`??`）与分支 diff（`git diff --name-status -M base...HEAD`）；支持 rename 选 A 新旧路径均审；Delete 原路径审；特殊标记（`mode-only` / `symlink` / `submodule`）识别；白名单（`node_modules/`、`.stagent/`）放行；提供 `CandidateScopeViolationError`。 |
| `daemon/pipeline/untracked-scope-guard.ts` | 将底层纯函数校验与路径解码统一委托给 `candidate-scope-audit`，接口保持完全向后兼容，`tests/unit/untracked-scope-guard.test.ts` 保持只读且 21/21 零回归。 |
| `daemon/pipeline/orchestrator.ts` | PRE_EXECUTION 与 POST_VERIFICATION 检测点统一迁移至 `assertCandidateScope`，未跟踪违规抛出 `UntrackedScopeViolationError`（code `E_OUT_OF_SCOPE_UNTRACKED`），已跟踪文件修改抛出 `CandidateScopeViolationError`（code `E_OUT_OF_SCOPE`）；违规清单以 `untracked:` / `candidate:<type>:` 前缀回写 `forbidden_violations`，生成可追溯的 BLOCKED 证据。 |
| `daemon/pipeline/merger.ts` | PRE_MERGE 阶段将工作树审计升级为 `assertWorktreeCandidateScope`，在审计工作树状态同时附加 `captureBranchDiffCandidateChanges`（`git diff --name-status -M base...HEAD`），以基线 Base SHA 或 base_branch 复核分支完整 diff，发现越权抛出 `MergeGateError`（code `E_OUT_OF_SCOPE`），阻断合并。保留 `assertWorktreeUntrackedScope` 兼容包装。 |
| `docs/specs/runtime-contract-and-safety.md` | §8.1 表头与说明写明 TASK-P0.2 用码口径（已跟踪文件变更复用 `E_OUT_OF_SCOPE`，未跟踪沿用 `E_OUT_OF_SCOPE_UNTRACKED`，不新增错误码；明确重命名选 A 裁决与 PRE_MERGE 分支复核机制）。 |
| `tests/unit/candidate-scope-audit.test.ts`（新建） | 17 个用例，覆盖路径解码、白名单放行、全状态解析、重命名选 A 判定、删除判定、特殊类型标记、白话报错。 |
| `tests/daemon/p0-2-pre-merge-branch-audit.test.ts`（新建） | 6 个用例，覆盖即使 Worktree 干净但任务分支已 commit 越权修改/删除/重命名时的阻断（抛 `MergeGateError` code `E_OUT_OF_SCOPE`）、合法提交顺利合入、以及 PRE_EXECUTION / POST_VERIFICATION 阻断与 BLOCKED 证据生成。 |
| `docs/ledger/p0-2-candidate-scope-audit.md`（新建） | 施工记录。 |

readonly 六文件（`tests/unit/untracked-scope-guard.test.ts`、`src/lib/contract.schema.ts`、`src/lib/evidence.schema.ts`、`daemon/diff/diff-files.ts`、`daemon/mcp/gateway.ts`、`daemon/guard/evidence-integrity.ts`）零 diff。

## 二、停工点核查与裁决结论

1. **停工点一（合同 Base SHA 字段核查）**：
   - **核查结论**：`base_branch` + `git merge-base` 派生基点 + `snapshot.git_info.base_commit_sha` 已构成稳定合同绑定基线。在 `merger.ts` 合并核销入口，已有 `contract.authorization.git.base_branch` 与 `snapshot.git_info.base_commit_sha` 直接传入，无需在 `contract.schema.ts` 新增顶层字段，停工点一未触发成立。
2. **停工点二（重命名判定规则裁决）**：
   - **裁决结论**：Tina 拍板**选 A（新旧路径均审）**。
   - **判定逻辑**：重命名操作时源路径与目标路径均必须在 `writable_paths` 范围内；任一侧越界即判定越权阻断。
   - **裁决理由**：仅按目标路径判定会让 Worker 把 Scope 外文件（如 `.env`、`package.json`、`docs/`）rename 进 `src/` 绕过写权限，等于隐式删除/篡改未授权文件；选 A 同时满足 DoD「目标越界必拒」与审批「新旧路径均审」，防范偷盗只读/受保护文件。

## 三、用码结论（DoD 第 4 条）

- **未跟踪文件越界**：沿用既有 **`E_OUT_OF_SCOPE_UNTRACKED`** 码（§8.1 + `ERROR_CODES`），保持既有未跟踪守卫错误码与文案零回归。
- **已跟踪文件变更 / 重命名 / 删除越界**：复用既有 **`E_OUT_OF_SCOPE`** 码（§8.1 + `ERROR_CODES`），违规详情与路径白话列入错误文案与 Evidence `verdict.summary`，不新增错误码。
- **门禁异常**：合并侧抛出既有 `MergeGateError`，不改 Schema，不造未登记错误码。

## 四、PRE_MERGE 分支 diff vs base 复核设计

- **问题**：Worker 若在任务分支中执行 `git add <out_of_scope>` 并 `git commit`，在执行合并时 Worktree 可能处于干净状态（`git status --porcelain` 输出为空），此前的 Worktree-only 审计会被绕过。
- **解法**：`PRE_MERGE` 阶段统一调用 `enforceCandidateScope`，同时采集：
  1. `captureWorktreeCandidateChanges`（工作区当前未暂存/未跟踪变更）；
  2. `captureBranchDiffCandidateChanges`（`git diff --name-status -M base...HEAD`，以证据快照中的 `base_commit_sha` 或合同 `base_branch` 为基准）。
- **合并去重**：合并两路候选条目，若任意一路包含 Scope 外文件的修改、新增、删除、重命名、特殊变更，即时抛出 `MergeGateError(E_OUT_OF_SCOPE)` 阻断，绝不执行 squash merge。

## 五、负向测试实跑（本地沙箱）

- `tests/unit/candidate-scope-audit.test.ts`：**17 passed**。
- `tests/daemon/p0-2-pre-merge-branch-audit.test.ts`：**6 passed**（含工作区干净但分支已 commit 越权改动的阻断用例、重命名选 A 裁决用例、合法提交合并用例、PRE_EXECUTION / POST_VERIFICATION 证据生成用例）。
- `tests/unit/untracked-scope-guard.test.ts`：**21 passed**（只读文件，零 diff）。
- `tests/daemon/merger-d2b-gates.test.ts`：**10 passed**。
- `tests/daemon/p0-1-evidence-merge-fail-closed.test.ts`：**13 passed**。
- 门禁命令实跑：
  - `npx vitest run tests/unit/candidate-scope-audit.test.ts tests/daemon/p0-2-pre-merge-branch-audit.test.ts tests/unit/untracked-scope-guard.test.ts`：**44 passed**。
  - `npx tsc --noEmit`：exit 0。
  - `npm run lint`：exit 0（0 errors）。
  - `npm run check:docs`：error 0。
  - `npm run check:knowledge`：`{"ok":true,"failures":[]}`。


## 六、完工说明（P-326）

- 施工 PR [#420](https://github.com/he18718143986-design/IDE/pull/420) squash `bf8d3b9ca1fd1247fe861953e14618b3c969de2c` 合入，由我执行。
- 全量候选变更 Scope 审计已交付（统一审计函数、三检测点、PRE_MERGE 分支 diff 复核、rename 新旧路径均审）；P0 风险未宣称解除。
