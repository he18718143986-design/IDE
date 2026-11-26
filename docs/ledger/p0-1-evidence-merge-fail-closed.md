# TASK-P0.1 施工记录：Evidence / Merge 失败关闭（控制模式 + 合同版本双重封锁）

> **地位**：施工记录（卡面 `writable_paths` 第 13 条）。不改卡面、不改 Schema 兼容面、不接容器、不动 Gateway。
> **基线**：`main` `f83d001181a95aadeb559ecab97c02b9bd843bd2`（[#417](https://github.com/he18718143986-design/IDE/pull/417) P-324 立卡）。
> **依据**：2026-11-26 Tina 点名开工 TASK-P0.1（操作者由我执行）。
> **口径**：本记录不是 P0 风险解除声明；合入前仍需独立审查实现与测试、负向测试实跑、全量回归、新增绕过路径检查、Evidence 与 Merge 实际裁决行为确认（P-324 审批边界）。

## 一、改了什么

| 文件                                        | 改动                                                                                                                                                                                                                                                                                   |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/evidence.schema.ts`                | `deriveCanMerge` 增可选入参 `workerControlMode` / `contractRevision`：控制模式非 `GATEWAY_ENFORCED`/`SANDBOX_ENFORCED`（含缺失）→ `false`；合同版本缺失或非正整数 → `false`。Schema 字段可选性与 superRefine 不变（旧证据仍可读）。                                                    |
| `daemon/pipeline/orchestrator.ts`           | 证据写入 `contract_revision: contract.contract_revision`；写入证据的同一个 `worker_control_mode`（`resolveEvidenceControlMode` 结果）与合同版本一起传给 `deriveCanMerge`。                                                                                                             |
| `daemon/guard/baseline-gates.ts`            | 第二调用点（`evaluateExitCodesCanMerge`，只隔离评估底线退出码）补受控合成输入，保持该自检语义。                                                                                                                                                                                        |
| `daemon/pipeline/merger.ts`                 | 第二道封锁 `assertEvidenceControlAndRevision`：在 `E_CANNOT_MERGE` 判定后读磁盘快照独立重核控制模式与合同版本；候选提交绑定重核 `assertCandidateCommitBound`（见第三节）。                                                                                                             |
| `src/lib/error-codes.ts`                    | 登记 `E_EVIDENCE_REVISION_MISMATCH` → `EVIDENCE_STALE`。                                                                                                                                                                                                                               |
| `docs/specs/runtime-contract-and-safety.md` | §8.1 新增行，并写明三类用码（见第二节）。                                                                                                                                                                                                                                              |
| 测试                                        | 新建 `tests/daemon/p0-1-evidence-merge-fail-closed.test.ts`；改 `tests/unit/evidence-schema-v11.test.ts`、`tests/unit/baseline-gates.test.ts`、`tests/unit/error-codes-mapping.test.ts`。`tests/daemon/merger.test.ts`、`tests/daemon/merger-d2b-gates.test.ts` 未改即通过（零回归）。 |

readonly 五文件（`src/lib/contract.schema.ts`、`daemon/worker/worker-adapter.interface.ts`、`daemon/guard/evidence-integrity.ts`、`daemon/mcp/gateway.ts`、`docs/specs/evidence-and-acceptance-criteria.md`）零 diff。

## 二、用码结论（DoD 第 4 条）

- `contract_revision` 与当前合同版本不符 → **`E_EVIDENCE_REVISION_MISMATCH`**（新增，§8.1 + `ERROR_CODES`）。
- `contract_revision` **字段缺失复用 `E_EVIDENCE_REVISION_MISMATCH`**：缺失即无法确认与当前合同一致。
- 控制模式缺失 / `UNCONTROLLED_EXTERNAL` / 未知值 → **`E_CANNOT_MERGE`**（merger 既有字面量，不新增码）。
- 候选提交绑定不一致 → **`E_EVIDENCE_STALE`**（既有码）。

## 三、候选提交绑定核实（DoD 第 6 条）

**核实对象**：`worktree_snapshot.head_sha`、`git_info.task_commit_sha`（orchestrator 两者都写同一个 `headSha`）、`git_info.patch_fingerprint`，以及 merger 合并前的 `assertEvidenceIntegrity`。

**已覆盖的部分**：`snapshot_fingerprint` = Worktree HEAD SHA ⊕ `git status --porcelain -uall` ⊕ 变更文件内容哈希（`evidence-integrity.ts:18`、`:108-130`）。Worktree 停在任务分支上时，分支上新增提交或 ref 移动都会改变 HEAD SHA → 指纹不符 → `E_EVIDENCE_FINGERPRINT_MISMATCH` 并标 STALE。`patch_fingerprint` 只是 `git diff HEAD` 的一致性哈希，merger 不复核它。

**缺口（已在卡内补重核）**：merger 实际 squash 的是任务分支 ref（`git merge --squash <task_branch>`，`merger.ts` 第 4 步），而指纹读的是 Worktree HEAD。Worktree 被 `checkout --detach` 后再移动任务分支 ref，HEAD SHA 与工作区不变、指纹仍一致，但合并对象已变成未验收的提交。

**补法**：`merger.ts` 在指纹校验之后新增 `assertCandidateCommitBound`：`git rev-parse --verify refs/heads/<task_branch>^{commit}` 必须同时等于 `worktree_snapshot.head_sha` 与 `git_info.task_commit_sha`；读不到 tip 也拒（失败关闭）。只改 `merger.ts`，没超出卡面。

**测试证明**：`p0-1-evidence-merge-fail-closed.test.ts`「候选提交绑定：Worktree detach 后任务分支被移走（指纹仍一致），合并被拒」——用 `commit-tree` 造一个多带 `src/sneaky.ts` 的提交并移动分支 ref，断言 `E_EVIDENCE_STALE`、主干 HEAD 不动、合同仍 `AUDITED`、`src/sneaky.ts` 没进主干。

## 四、负向测试实跑（本地沙箱）

- `npx vitest run tests/daemon/p0-1-evidence-merge-fail-closed.test.ts`：**13 passed**。
- **反证**：临时去掉 merger 的两处新调用后重跑，**5 条端到端负向用例全部失败**（伪造 `UNCONTROLLED_EXTERNAL`、控制模式缺失、`contract_revision` 缺失、版本不符、候选提交被移走）。说明改动前这些路径确实能绕过 merger；恢复后全部通过。
- 卡面 `p01-unit` 六文件：全部通过。
- `npx tsc --noEmit`：exit 0。

## 五、全量回归（本地沙箱）

`npx vitest run`：除 6 条之外全部通过。这 6 条（`approve-acknowledge-dirty`、`baseline-c14`、`baseline-c14d`、`deps-reuse`、`write-protection`、`task-h6-dirty-guidance`）在**未改动的 main `f83d0011`** 上同样失败（沙箱以 root 运行导致的写保护 / 脏检查环境差异），与本卡无关。以 CI 结论为准。

## 六、落地影响

- 现有证据普遍没写 `contract_revision`：落地后这些旧证据**可读、可展示、不可合并**，须按当前合同重新验收。
- `UNCONTROLLED_EXTERNAL` 证据此前在派生门已因 W.5c 记实被拒于大部分路径；本卡让 merger 也独立拒绝，并覆盖「快照被改成 `can_merge=true`」的情况。
