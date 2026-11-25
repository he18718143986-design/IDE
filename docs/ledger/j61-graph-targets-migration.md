# TASK-J.61 既有图目标迁移：施工落地记录（P-318）

> **地位**：施工记录。施工权威在 [`../specs/development-tasks-active.md`](../specs/development-tasks-active.md#task-j.61)；方案与拍板见 [`j61-graph-targets-migration-plan.md`](./j61-graph-targets-migration-plan.md)。
> **基线**：`main` `94a53eabb9760401888247d41e97df41fcc4c5c7`（[#406](https://github.com/he18718143986-design/IDE/pull/406) P-317 立卡）。
> **状态**：代码已施工并合入 [#407](https://github.com/he18718143986-design/IDE/pull/407)（`cd28cc0`）；**真机迁移已执行**（见第五节）：`dry_run` retired 8 / kept 4 → 实跑 `revision` 13→14、节点 12→4 → `n10`、`n11` 先后官方核销 `ILLUMINATED`，图 `revision=18`、**4/4 全亮**。任务图首次全亮，但**端到端闭环未宣称**（合同仍 `EXECUTING`，未合入、未试玩）。

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

## 五、真机迁移实测（2026-11-26 · P-318）

> 执行时间 2026-11-26 02:32–02:33 香港时间（操作者由我执行）；main `cd28cc078e3f78381907039b853ca5c22f4b28c4`（[#407](https://github.com/he18718143986-design/IDE/pull/407) J.61 施工）。

### 5.1 Daemon

- 旧 Daemon（pid 77517 @ `5173e8e`）已停；新 Daemon 以 `cd28cc0` 启动：`npm run stagent -- open /Users/tina/Downloads/stagent-j45-key-playtest`，监听进程 **51894**、端口 `127.0.0.1:3001`。
- `GET /health` **200**：`status=ok`、`pid=51894`、`port=3001`、`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`。源码 SHA `cd28cc078e3f78381907039b853ca5c22f4b28c4`。

### 5.2 dry_run（`{"dry_run":true}`）

- `POST /api/graph/targets/migrate` **200**（`requestId=ba69dddafc30`，1ms，ts `2026-11-25T18:32:51.167Z`）。
- `migrated=true`、`dry_run=true`、`revision_before=13`、**`revision_after=13`**（未递增）。
- **`retired=8`**：`n3`、`n4`、`n5`、`n6`、`n7`、`n8`、`n9`、`n12`。
- **`kept=4`**：`n1`（`ILLUMINATED`，`["src/**"]`）、`n2`（`ILLUMINATED`，`["package.json"]`）、`n10`（`BLOCKED`，`["index.html"]`）、`n11`（`BLOCKED`，`["tests/**"]`）。
- 与拍板预期完全一致，故继续实跑。

### 5.3 实跑迁移（`{"dry_run":false}`）

- `POST /api/graph/targets/migrate` **200**（`requestId=bbf6f9f35ae6`，10ms，ts `2026-11-25T18:32:56.382Z`）。
- `migrated=true`、`dry_run=false`、`revision` **13→14**（恰好 +1）。
- 节点由 **12 → 4**，`depends_on` 重接为 `n1: []`、`n2: ["n1"]`、`n10: ["n2"]`、`n11: ["n10"]`（原 `n10↔n9`、`n11↔n10` 链上 8 个退役节点被递归跳过）。
- 状态：`n1=ILLUMINATED`、`n2=ILLUMINATED`（`executed_at=2026-11-25T14:39:43.878Z`、`commit_sha=ae03e3c` 原样保留）；`n10` 由 `BLOCKED`→**`PENDING`**（前置全亮）；`n11` 仍 `BLOCKED`（`n10` 未亮）。
- `issues`：原 `n3` 的 `E_FILES_NOT_WRITTEN`（`ERROR`，历史记录未删）+ 8 条新增 `E_TARGET_SUPERSEDED`（`WARNING`，退役留痕）。
- `fingerprints` 8 条保留（`src/*.js` 7 + `package.json`）；无退役节点名下指纹。

### 5.4 迁移后 n10 官方 start / verify

- `POST /api/graph/nodes/start` `{node_id:"n10"}` **200**（`requestId=cbe882f80f35`，17ms，ts `18:33:01.614Z`）；`n10` `PENDING`→`RUNNING`，`revision` **14→15**。
- `POST /api/graph/verify` `{node_id:"n10"}` **200**（`requestId=935869b0c1c6`，4458ms，ts `18:33:06.098Z`）；**`illuminated=true`**，无错误码。
- 九条 baseline 全部 `exit 0`、`stderr_length=0`（`18:33:02.225Z`–`18:33:06.067Z`，stdout 94–105）。
- `n10` `RUNNING`→**`ILLUMINATED`**；`n11` `BLOCKED`→**`PENDING`**；`revision` **15→16**。
- 指纹增至 9 条（新增 `index.html`）。

### 5.5 迁移后 n11 官方 start / verify

- `POST /api/graph/nodes/start` `{node_id:"n11"}` **200**（`requestId=994dc2b27711`，16ms，ts `18:53:24.215Z`）；`n11` `PENDING`→`RUNNING`，`revision` **16→17**。
- `POST /api/graph/verify` `{node_id:"n11"}` **200**（`requestId=698884b60e73`，4422ms，ts `18:53:28.661Z`）；**`illuminated=true`**，无错误码。
- 九条 baseline 全部 `exit 0`、`stderr_length=0`（`18:53:24.783Z`–`18:53:28.631Z`，stdout 94–105）。
- `n11` `RUNNING`→**`ILLUMINATED`**；`revision` **17→18**。
- 指纹增至 11 条（新增 `tests/auth.test.js`、`tests/phone.test.js`）。
- `tests/**` 通配符按 J.58 展开匹配到 2 个 `.test.js`，未触发扩展名问题（本图已无 `n12`）。

### 5.6 迁移后图状态（终态）

| 节点 | 目标 | 状态 |
| :--- | :--- | :--- |
| `n1` | `src/**` | `ILLUMINATED`（迁移前既有，未重新核销） |
| `n2` | `package.json` | `ILLUMINATED`（同上） |
| `n10` | `index.html` | `ILLUMINATED`（本轮核销） |
| `n11` | `tests/**` | `ILLUMINATED`（本轮核销） |

图 `revision=18`，进度 **`ILLUMINATED=4` / `total=4`（100%）**，`FAILED=0`、`BLOCKED=0`、`PENDING=0`。

**诚实口径**：这是**任务图首次全亮**（4/4），但**端到端闭环仍未宣称**——合同仍是 `EXECUTING` / `APPROVED`（`state.json` `updated_at` 仍为 `2026-11-25T11:30:48.057Z`），未走合入、未做试玩认可、未点「确认开工」。`issues` 中 `n3` 的历史 `E_FILES_NOT_WRITTEN`（ERROR）为迁移前记录，未清；8 条 `E_TARGET_SUPERSEDED`（WARNING）为退役留痕。

## 六、密钥与纪律

HTTP 只用试玩目录 `.stagent/session-token`（0600）作 `Authorization: Bearer`。本文件不含 token、密钥或 `.tmp/deepseek.env` 内容。未手工改 `.stagent/specs/task_graph.json`，未重新提案，未伪造证据。按 Tina 后续授权对 `n10`、`n11` 依次官方 start/verify；未发 `run-worker`，未点「确认方案 / 确认开工」，未手工改图文件。
