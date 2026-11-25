# TASK-J.61 既有任务图目标迁移：施工方案（P-316）

> **地位**：planning brief；**未立卡、未开工**。施工权威待审后写入 `development-tasks-active.md`。
> **基线**：`main` `80263ceda9f0168d8dfe7ebfbe4ef79b67459ca7`（[#404](https://github.com/he18718143986-design/IDE/pull/404) P-315）。
> **由来**：P-315 复测证明 J.60 只对新提案生效——既有图 `graph_1795588362553_e4fbb0f1` 的 `n3.target_files` 持久化为 `["tsconfig.json"]`，重启 Daemon 只重读不重建，故仍报 `E_FILES_NOT_WRITTEN`。Tina 拍板走「迁移卡」而非重建图 / 保留卡死。
> **估算**：S（含一条新路由、引擎内一次原子重写、一个共享纯函数、一份新用例）。

---

## 1. 冲突与拍板结论（2026-11-26 · Tina 已拍板）

Tina 的约束是「保留节点 id、`depends_on`、状态与 `revision` 递增语义」。但按 J.60 规则，本图 12 个节点里有 **8 个目标会被判定为非交付物**：

| 节点 | 目标 | J.60 下是否保留 |
| :--- | :--- | :--- |
| `n1` | `src/**` | 保留 |
| `n2` | `package.json` | 保留 |
| `n3` | `tsconfig.json` | **退役** |
| `n4` | `tsconfig.*.json` | **退役** |
| `n5` | `vitest.config.*` | **退役** |
| `n6` | `vite.config.*` | **退役** |
| `n7` | `*.config.ts` | **退役** |
| `n8` | `*.config.mjs` | **退役** |
| `n9` | `*.config.js` | **退役** |
| `n10` | `index.html` | 保留 |
| `n11` | `tests/**` | 保留 |
| `n12` | `**/*.test.ts` | **退役** |

节点 `target_files` 被清空不行——核销侧 `E_TARGET_FILES_MISSING` 会拦（`illumination-verifier.ts:255-265`：`CODE_MODIFICATION` 必须声明目标）。三种处置的代价：

- **(a) 重新派生 + 空目标节点删除 + 依赖重接** —— **Tina 拍板采纳**。
- (b) 保留节点 + 重定向目标 —— 等于为了变绿造假证据，**不采用**。
- (c) 新增 `SUPERSEDED` 状态 —— 语义最诚实但改状态机与前端，升 **M**，**不采用**。

### 1.1 拍板理由（原话要点）

1. 「保留全部节点」与「目标重新派生」不可兼得——8 个节点的目标按 J.60 属非交付物，说明这些节点本身就是旧拆解规则的产物（把不该由 Worker 交付的东西当成了节点目标）。
2. 「允许空 `target_files`」不可选——等于给核销器开「无文件证据也能点亮」的口子，违背「目标文件未写入不得点亮」的门禁语义，比删节点危害大。
3. 「保留旧目标不派生」等于迁移不做，`n3` 永久 `FAILED`，已否过。

### 1.2 拍板后的迁移规则（施工必须逐条守住）

1. 按 J.60 新规则**重新派生每个节点的 `target_files`**。
2. **派生结果为空的节点从图中删除**；其下游节点的 `depends_on` **改指向被删节点的上游**（跳过被删节点），保持拓扑一致、无悬空依赖、无环。
3. 保留的节点维持 `node_id`、`state`（`ILLUMINATED` / `FAILED` / `BLOCKED` 等）与 `executed_at` / `commit_sha`。
4. 图 `revision` 仍按「一次迁移 = 一次提交 = +1」递增。
5. **`n1` / `n2` 的已点亮状态必须保住**。若某个 `ILLUMINATED` 节点本身落入「空目标」名单，**不得擅自删除**——`ILLUMINATED` 节点退役候选即**停工上报**（`E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE`），由 Tina 另议。本图中 `n1`（`src/**`）、`n2`（`package.json`）都属交付物，不触发该分支。
6. `FAILED` 节点允许退役（本图 `n3` 即此情形，其失败系 J.60 缺陷造成的误报），但必须逐条写 `issues` 留痕。

## 2. 迁移触发点：显式接口（推荐），不做启动静默迁移

- **推荐**：`POST /api/graph/targets/migrate`，body `{ "contract_id": "...", "dry_run": true|false }`。
  - 优点：可审计（谁、何时、改了什么）、可 dry-run 预览、幂等、失败有明确状态码；不动启动路径。
  - 缺点：需要人手触发一次（迁移本来就该是一次性动作）。
- **不推荐**：启动时检测旧形态自动迁移——Daemon 每次起都写权威文件，难以区分「迁移」与「意外写入」，出问题时排查成本高，也容易被当成启动副作用。
- 不做 CLI 脚本独立写盘：绕过 `TaskGraphEngine`「唯一写入口」约束。

### 接口形状（草案）

```
POST /api/graph/targets/migrate
body: { contract_id: string, dry_run?: boolean, graph_id?: string }
200: { migrated: boolean, dry_run: boolean, retired: [{node_id, target_files, previous_state}],
       kept: [{node_id, state, target_files}], revision_before, revision_after }
404: E_GRAPH_NOT_FOUND / E_CONTRACT_NOT_FOUND
409: E_GRAPH_TARGETS_IN_FLIGHT（有退役候选处于 RUNNING / REPAIRING，拒绝迁移）
409: E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE（退役候选已 ILLUMINATED，按拍板规则停工上报）
409: E_GRAPH_STALE_SNAPSHOT（body.graph_id 与当前图不符）
```

## 3. `target_files` 重新派生的规则：与 J.60 同一函数（必须）

- 从 `src/lib/journey/proposal-from-contract.ts` **导出**两个纯函数（J.60 里已是私有实现）：
  - `verificationCapabilities(commands)` → `{ typescript, tests }`
  - `isDeliverableTarget(pattern, capabilities)` → 该模式是否仍应作为核销目标（= `!isUnneededScaffoldingTarget`）
- J.60 的提案构建改用导出版（行为零变化），**迁移复用同一份判定**，不另写第二套规则——否则提案与迁移会漂移。
- 能力来源：图所属合同的 `verification_spec.commands`（`orchestrator.getStore().get(contract_id)`）。合同缺失 → 404，不猜。
- 本图合同是九条 `baseline-*`（`executable: stagent`），不要求 typecheck/test → 8 个脚手架节点全部退役。
- 依赖图重连：按原拓扑序保留存活节点的相对顺序，`depends_on` 指向**前一个存活节点**；存活节点 id 不变。
  - 多目标节点：只把非交付物模式从 `target_files` 里剔除；若剔除后仍非空，节点保留、状态不变（不因目标缩减而重置）。
  - 剔除后为空 → 节点退役，下游 `depends_on` 跳过它指向其上游（递归跳过连续退役节点），保证无悬空 / 无环。
  - **已点亮节点保护**：退役候选 `state === "ILLUMINATED"` → 整个迁移拒绝（409 `E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE`），图零改动，报 Tina 另议。

## 4. 状态与 `revision` 的保留语义

- 存活节点：`state` / `executed_at` / `commit_sha` **原样保留**（`n1`、`n2` 仍是 `ILLUMINATED` 且 `commit_sha=ae03e3c`）；`n10`/`n11` 仍是 `BLOCKED`，迁移后因 `n2` 已点亮、中间链路被移除，应自动转 `PENDING`（复用引擎既有 `releaseDependents` 逻辑，不新写）。
- 退役节点：不保留在 `nodes` 里；逐条写 `issues`（`WARNING`，`code: "E_TARGET_SUPERSEDED"`，`message` 含原目标与原因）。
- 指纹：只删退役节点名下的指纹（本图退役节点无指纹），存活节点指纹保留。
- `revision`：**一次迁移 = 一次提交 = `revision += 1`**（复用 `commit()` 的语义：`updated_at` 刷新、`progress` 重算、`TASK_GRAPH_UPDATED` 广播）。`graph_id` 不变。`dry_run` 不落盘、不递增。
- 幂等：迁移后再调，检测到「无退役候选」直接返回 `migrated: false`，不递增 `revision`。

## 5. 落点与改动面（预估）

| 文件 | 动作 | 说明 |
| :--- | :--- | :--- |
| `src/lib/journey/proposal-from-contract.ts` | modify | 导出 `verificationCapabilities` / `isDeliverableTarget`，J.60 行为不变 |
| `daemon/graph/graph-engine.ts` | modify | 新增 `migrateTargets({contractCommands, dryRun, expectedGraphId})`：校验 → 退役 → 重连 → `commit()` |
| `daemon/server.ts` | modify | 新路由 `POST /api/graph/targets/migrate`（含 404 / 409 映射） |
| `tests/unit/graph-targets-migration.test.ts` | create | 见 §6 |
| `docs/ledger/j61-graph-targets-migration.md` | create | 迁移实测记录（施工后写） |

**readonly（零改动，施工时以 diff 自证）**：`daemon/graph/illumination-verifier.ts`、`daemon/graph/target-file-match.ts`、`src/lib/graph/task-graph.ts`、`daemon/supervisor/rules-l0.ts`。

> 注：若拍板走 (c) 新增 `SUPERSEDED` 状态，`src/lib/graph/task-graph.ts` 与前端 `src/components/graph/TaskGraphPanel.tsx` 必须进 `writable_paths`，估算改 M，且需另审。

## 6. 验收草案（CI 可验证）

- **J61-P1**：旧形态图 + 九条 `baseline-*` 合同 → dry-run 返回 `retired` 8 条、`kept` 4 条且不落盘；实跑后 `nodes.length=4`，`n1`/`n2` 的 `state`/`executed_at`/`commit_sha` 与迁移前逐字相同，`revision` 恰好 +1，`issues` 含 8 条 `E_TARGET_SUPERSEDED`。
- **J61-P2**：幂等——已迁移图再次调用返回 `migrated:false`，`revision` 不变、无新 issue。
- **J61-P3**：合同含 `npm run typecheck` / `npm test` 时，`tsconfig*` 与 `vitest/vite config` 节点**不被退役**（与 J.60 同一判定）。
- **J61-P4**：退役候选处于 `RUNNING` / `REPAIRING` → 409 `E_GRAPH_TARGETS_IN_FLIGHT`，图零改动；退役候选处于 `ILLUMINATED` → 409 `E_GRAPH_ILLUMINATED_TARGET_NOT_DELIVERABLE`，图零改动（已点亮节点不得擅自删除）；合同不存在 → 404；`graph_id` 不符 → 409。
- **J61-P5**：多目标节点只剔除脚手架模式、保留其余目标且状态不变；连续多个退役节点时下游 `depends_on` 递归跳过、无悬空 / 无环（拓扑序可重算）。
- **J61-P6**：四个 readonly 文件相对父提交零 diff；核销侧 `E_FILES_NOT_WRITTEN` / 判定顺序未改。

## 7. 执行后（不在本卡验收）

迁移后对 `n3`（若仍存在则已换目标；本图 `n3` 会退役）与新的首个 `PENDING` 节点做官方 start/verify，实测落 ledger。`n12` 扩展名不匹配、`markStale` / `nodeTouchesPaths` glob 化、设计层挂账、自动钩子仍不在本卡。

## 8. 排除

不擅自重建图、不改 `.stagent` 图文件手工修数据、不放宽 fail-closed、不改 J.60 判定口径、不改 ADR-0015、不伪造证据、不宣称端到端闭环。
