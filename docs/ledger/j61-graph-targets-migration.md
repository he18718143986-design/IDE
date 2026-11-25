# TASK-J.61 既有图目标迁移：施工落地记录（P-318）

> **地位**：施工记录。施工权威在 [`../specs/development-tasks-active.md`](../specs/development-tasks-active.md#task-j.61)；方案与拍板见 [`j61-graph-targets-migration-plan.md`](./j61-graph-targets-migration-plan.md)。
> **基线**：`main` `94a53eabb9760401888247d41e97df41fcc4c5c7`（[#406](https://github.com/he18718143986-design/IDE/pull/406) P-317 立卡）。
> **状态**：代码已施工、本地全绿；**真机迁移尚未执行**（需本 PR 合入并重启 Daemon 后调新接口），执行结果另行追加，不在本文件先写。

## 一、交付内容

| 文件 | 动作 | 说明 |
| :--- | :--- | :--- |
| `src/lib/journey/proposal-from-contract.ts` | modify | 导出 `SCAFFOLDING_TARGETS` / `VerificationCapabilities` / `verificationCapabilities` / `isDeliverableTarget`；J.60 提案行为零变化（内部改调导出版） |
| `daemon/graph/graph-engine.ts` | modify | 新增 `migrateTargets()` 与 `TargetMigrationError`（三个专用码） |
| `daemon/server.ts` | modify | 新增 `POST /api/graph/targets/migrate` |
| `tests/unit/graph-targets-migration.test.ts` | create | 8 例，覆盖 J61-P1～P5 |
| `docs/ledger/j61-graph-targets-migration.md` | create | 本文件 |

**readonly 四文件零 diff**（`git diff --stat` 为空）：`daemon/graph/illumination-verifier.ts`、`daemon/graph/target-file-match.ts`、`src/lib/graph/task-graph.ts`、`daemon/supervisor/rules-l0.ts`。

## 二、实现要点（与拍板规则逐条对应）

1. **同一判定**：迁移调 `isDeliverableTarget(pattern, verificationCapabilities(commands))`，与 J.60 提案共用一份实现；能力来源是图所属合同的 `verification_spec.commands`。
2. **重新派生**：逐个节点过滤 `target_files`；多目标节点只剔除脚手架模式，剩余目标保留、状态不动。
3. **空目标退役**：过滤后为空的节点移出 `nodes`；下游 `depends_on` 通过 `resolveUpstream()` **递归跳过**被退役节点指向其上游，并带去重与环保护。
4. **保留语义**：保留节点 `node_id` / `state` / `executed_at` / `commit_sha` 原样；只清掉退役节点名下的指纹。
5. **一次提交**：迁移走 `commit()` 一次 → `revision` 恰好 +1、`updated_at` 刷新、`progress` 重算、`TASK_GRAPH_UPDATED` 广播；`dry_run` 提前返回，不落盘不递增。
6. **退役留痕**：逐条写 `issues`（`severity: "WARNING"`、`code: "E_TARGET_SUPERSEDED"`），含原目标、原状态与「下游依赖已重接」。
7. **已点亮保护**：退役候选 `ILLUMINATED` → `TargetMigrationError("E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE")`，图零改动；`RUNNING` / `REPAIRING` → `E_GRAPH_TARGETS_IN_FLIGHT`。两码均映射 HTTP **409**。
8. **链路缩短后的放行**：退役导致前置全亮的 `BLOCKED` 节点放回 `PENDING`（沿用七态合法边 `BLOCKED → PENDING`）；前置仍未亮的保持 `BLOCKED`。

**为什么不扩 `GraphInvariantCode`**：该联合类型在 `src/lib/graph/task-graph.ts`（本卡 readonly）。迁移是新增动作，错误码收在引擎侧 `TargetMigrationError`，避免为加码改只读文件。

## 三、接口形状（已实现）

```
POST /api/graph/targets/migrate
body: { contract_id?: string, dry_run?: boolean, graph_id?: string }
200: { migrated, dry_run, retired[], kept[], revision_before, revision_after, graph }
404: E_GRAPH_NOT_FOUND（无图） / E_CONTRACT_NOT_FOUND（合同不存在）
409: E_GRAPH_STALE_SNAPSHOT（graph_id 不符，或 body.contract_id 与图所属合同不一致）
409: E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE
409: E_GRAPH_TARGETS_IN_FLIGHT
```

`contract_id` 省略时取当前图所属合同；`dry_run` 缺省为 false。

## 四、本地验证（事实）

| 命令 | 结果 |
| :--- | :--- |
| `npx vitest run tests/unit/graph-targets-migration.test.ts` | **8/8 passed** |
| `npx vitest run` 四个相关文件（迁移 / J.60 提案 / 引擎不变式 / 官方核销） | **47/47 passed** |
| `npx vitest run tests/unit tests/daemon` | **270 文件 / 2803 例全绿** |
| `npx tsc --noEmit` | **0 错误** |
| `npx eslint` 四个改动文件 | **0 问题** |

用例覆盖：旧图 12→4（`n1`/`n2` 状态与 `commit_sha` 原样，`revision` +1，8 条 `E_TARGET_SUPERSEDED`，`n10`→`PENDING`、`n11` 仍 `BLOCKED`）；幂等；`dry_run` 不落盘；`npm run typecheck` 保留 `tsconfig*`、`npm test` 保留 `vitest/vite` 与测试 glob；`ILLUMINATED` / `RUNNING` 退役候选被拒且图零改动；`graph_id` 不符；多目标部分剔除。

## 五、待执行（本 PR 合入后，不在本文件先写结果）

1. 以新 main 重启 Daemon（旧 Daemon pid 77517 @ `5173e8e` 必须停）。
2. `POST /api/graph/targets/migrate` 先 `dry_run: true` 核对 `retired=8` / `kept=4`，再实跑。
3. 迁移后对首个 `PENDING` 节点（预期 `n10`）官方 `start` / `verify`，实测落本文件第五节。
4. `n12` 扩展名不匹配、`markStale` / `nodeTouchesPaths` glob 化、设计层挂账、自动钩子仍不在本卡。

## 六、密钥与纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容。未手工改 `.stagent/specs/task_graph.json`，未重新提案，未伪造证据。
