# TASK-J.61 既有任务图目标迁移：施工方案（P-316）

> **地位**：planning brief；**未立卡、未开工**。施工权威待审后写入 `development-tasks-active.md`。
> **基线**：`main` `80263ceda9f0168d8dfe7ebfbe4ef79b67459ca7`（[#404](https://github.com/he18718143986-design/IDE/pull/404) P-315）。
> **由来**：P-315 复测证明 J.60 只对新提案生效——既有图 `graph_1795588362553_e4fbb0f1` 的 `n3.target_files` 持久化为 `["tsconfig.json"]`，重启 Daemon 只重读不重建，故仍报 `E_FILES_NOT_WRITTEN`。Tina 拍板走「迁移卡」而非重建图 / 保留卡死。
> **估算**：S（含一条新路由、引擎内一次原子重写、一个共享纯函数、一份新用例）。

---

## 1. 必须先讲清的一个冲突（请重点审这一节）

Tina 的约束是「保留节点 id、`depends_on`、状态与 `revision` 递增语义」。但按 J.60 规则，本图 12 个节点里有 **8 个目标会被判定为非交付物**：

| 节点 | 目标 | J.60 下是否保留 |
| :--- | :--- | :--- |
| `n1` | `src/**` | 保留 |
| `n2` | `package.json` | 保留 |
| `n3` | `tsconfig.json` | **不保留** |
| `n4` | `tsconfig.*.json` | **不保留** |
| `n5` | `vitest.config.*` | **不保留** |
| `n6` | `vite.config.*` | **不保留** |
| `n7` | `*.config.ts` | **不保留** |
| `n8` | `*.config.mjs` | **不保留** |
| `n9` | `*.config.js` | **不保留** |
| `n10` | `index.html` | 保留 |
| `n11` | `tests/**` | 保留 |
| `n12` | `**/*.test.ts` | **不保留** |

节点 `target_files` 被清空不行——核销侧 `E_TARGET_FILES_MISSING` 会拦（`illumination-verifier.ts:255-265`：`CODE_MODIFICATION` 必须声明目标）。所以「目标被剔除」的节点只有三种处置，逐一说明代价：

- **(a) 退役（从图里移除）**：保留存活节点的 id / 状态 / `executed_at` / `commit_sha`，把被移除节点记录进图的 `issues`（`WARNING`，码 `E_TARGET_SUPERSEDED`）+ 迁移报告。**代价**：节点数 12→4；`n3` 的 `FAILED` 消失（它本来就是 J.60 缺陷造成的误报，需在 issues 与 ledger 留痕）。
- **(b) 保留节点 + 重定向目标**：把脚手架节点指向真实产物（如都指向 `package.json`）。**不推荐**：标题写「落实：tsconfig.json」而核销的是 `package.json`，等于为了变绿造假证据。
- **(c) 新增节点状态 `SUPERSEDED`**：语义最诚实、节点数不变，但要改 `src/lib/graph/task-graph.ts` 状态机、前端 `TaskGraphPanel`、多处切换与测试，估算升到 **M/L**，且改动面远大于本卡。

**我的建议：走 (a) 退役**，这是唯一「S 级 + 不伪造证据」的路。若你坚持节点数不变，就得接受 (c) 升卡到 M——请拍板。

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
409: E_GRAPH_TARGETS_IN_FLIGHT（有节点处于 RUNNING / REPAIRING，拒绝迁移）
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
- **J61-P4**：退役节点处于 `RUNNING` / `REPAIRING` → 409 `E_GRAPH_TARGETS_IN_FLIGHT`，图零改动；合同不存在 → 404；`graph_id` 不符 → 409。
- **J61-P5**：四个 readonly 文件相对父提交零 diff；核销侧 `E_FILES_NOT_WRITTEN` / 判定顺序未改。

## 7. 执行后（不在本卡验收）

迁移后对 `n3`（若仍存在则已换目标；本图 `n3` 会退役）与新的首个 `PENDING` 节点做官方 start/verify，实测落 ledger。`n12` 扩展名不匹配、`markStale` / `nodeTouchesPaths` glob 化、设计层挂账、自动钩子仍不在本卡。

## 8. 排除

不擅自重建图、不改 `.stagent` 图文件手工修数据、不放宽 fail-closed、不改 J.60 判定口径、不改 ADR-0015、不伪造证据、不宣称端到端闭环。
