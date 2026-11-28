# TASK-P0.16 专项交付与审计报告：Records Archive 与公开交付副本幂等补偿修证

- **任务卡**：[`TASK-P0.16`](../specs/development-tasks-active.md#task-p0.16)（Records Archive & Public Delivery Idempotent Compensation，估算 S~M，优先级 P1）
- **来源与背景**：承接 P0.15 Scope B 审计挂账项（见 [`docs/ledger/p0-15-merge-transaction-and-trust-audit.md`](./p0-15-merge-transaction-and-trust-audit.md)）。在 P0.15 的合并事务与恢复一致性审计中，确认 `merger.ts:1312–1348` 提交后辅助性 records 归档与交付副本拷贝采用了隔离捕获设计（try/catch 隔离于 Git squash commit 主路径）。该设计确保辅助拷贝失败不会导致 Git 提交状态未定（in-doubt），但存在挂账缺口：**当辅助归档失败时，缺乏幂等安全重试与断点续拷机制，系统与用户无法在不破坏主分支状态的前提下完成补偿并收敛交付状态**。
- **本卡目标**：为合并后辅助归档构建纯函数的显式幂等补偿机制，支持失败后断点续写、损坏文件修复、完整文件跳过以及显式入口驱动的交付状态收敛。
- **操作者**：由我执行。

---

## 一、DoD 逐条兑现与实施细节

### 1. P016-P1: 辅助拷贝失败路径枚举与现状隔离语义确认

- **调用点核实**：在 `daemon/pipeline/merger.ts:1312–1348`（`mergeInternal` 第 8 步），Git squash commit 提交与合同生命周期转换（`store.transition("MERGED")`）已在步骤 6 与步骤 7 先行落地。
- **失败路径枚举**：
  1. **目录创建失败**：目标目录 `.stagent/records/{contract_id}/` 所在磁盘只读（`EROFS`）或权限不足（`EACCES`）；
  2. **Demo 原型读取/写入异常**：`demo-confirm.json` 读取损坏或写入时磁盘已满（`ENOSPC`）；`demo-index.html` / `demo-meta.json` 拷贝异常；
  3. **侧车摘要写入中断**：`delivery-summary.json` 写入中途进程中断或断电，产生非完整 JSON 或半写残片；
  4. **审计清单计算/脱敏失败**：`writeAuditManifest` 发生脱敏或磁盘写入异常。
- **现状隔离语义确认**：`archiveContractRecords` 在遇到上述异常时，通过 `try { ... } catch` 捕获并返回 `{ ok: false, error: ... }`，未向外冒泡抛错，未触发 Git 回滚。`publicDeliveryCopy` 接受 `archive_ok: false`，将终态文案标为 `"已合入（归档未完成，尚未标交付完成）"`，且 `delivery_complete: false`。`assertRecordsReadyForDelivered` 检查 `audit-manifest.json` 存在性，严格阻断标为已交付。
- **结论**：隔离捕获保证了 Git 提交事务的单一性与不可逆性，但留下了目录半写或交付状态悬空缺口，需 P016-P2～P016-P4 进行补偿修证。

### 2. P016-P2: 幂等补偿机制设计与实现

- **实现位置**：`daemon/pipeline/records-archive.ts::compensateContractRecordsArchive`。
- **幂等键体系**：以 `contract_id` 作为天然幂等键，对应物理隔离的 `.stagent/records/{contract_id}/` 目录。
- **多层比对与断点续写**：
  - **Demo 确认文件 (`demo-confirm.json`)**：检查文件存在性与内容完整性（JSON 结构深比较）。内容一致直接跳过（`skipped`）；缺失或损坏通过临时文件原子覆写（`repaired` 或 `copied`）。
  - **原型文件 (`demo-index.html` / `demo-meta.json`)**：基于源文件与目标文件的 SHA-256 哈希值双向比对。哈希一致即跳过（`skipped`）；哈希不一致或缺失则通过原子临时文件拷贝更新（`copyFileAtomic`）。
  - **侧车摘要 (`delivery-summary.json`)**：校验 `contract_id`、`commit_sha` 与有效性。合法且一致跳过；损坏或缺失则写入原子补正版本，标注 `compensated: true` 与补偿时间戳。
  - **审计清单 (`audit-manifest.json`)**：通过 `readAuditManifest` 校验清单有效性。如果清单完整且绑定 commit_sha 一致，跳过；缺失或损坏则调用 `writeAuditManifest` 原子重建。
- **临时文件安全性**：所有写入操作均先落地为 `.tmp-{filename}-{timestamp}-{random}` 临时文件，完成后通过 `fs.renameSync` 原子更名，确保不会因崩溃或中断留下损坏的目标文件。

### 3. P016-P3: 显式补偿重试入口与交付状态收敛

- **入口位置**：`daemon/pipeline/merger.ts::compensateMergeRecordsArchive`。
- **调用逻辑**：
  - 接收 `{ repoRoot, contract_id, prototype_id, commit_sha, assertion_ids }`；
  - 触发 `compensateContractRecordsArchive` 执行幂等补正；
  - 补偿成功后（`archiveResult.ok === true`），调用 `publicDeliveryCopy({ lifecycle_state: "MERGED", archive_ok: true, compensated: true })`；
  - 返回结果中，`deliveryTerminal` 状态无缝收敛为：
    - `scheme: "B_MERGED_IS_TERMINAL"`
    - `lifecycle_state: "MERGED"`
    - `delivery_complete: true`
    - `label: "已交付归档"`
- **状态收敛验证**：调用显式补偿后，`assertRecordsReadyForDelivered(repoRoot, contract_id)` 顺利通过，完成交付闭环。

### 4. P016-P4: 负向防重、中断恢复与断点续写专项测试

- **测试文件**：`tests/daemon/p0-16-records-archive-compensation.test.ts`。
- **覆盖场景**：
  1. 归档失败时错误捕获与状态隔离（P016-P1）；
  2. 正常场景补偿与解除 DELIVERED 门禁（P016-P2）；
  3. 显式补偿入口驱动 `delivery_complete: true` 状态收敛（P016-P3）；
  4. 损坏 summary 场景下的修复与断点续写（`repaired` 包含损坏文件，`copied` 包含缺失文件）（P016-P4）；
  5. 部分文件完整时跳过完整文件（`skipped` 包含完整文件）（P016-P4）；
  6. 连续 3 次调用严格幂等（第二次与第三次 `copied: []`, `repaired: []`, 全部进入 `skipped`，无悬挂 `.tmp-*` 文件）（P016-P4）；
  7. 专项报告与诚实口径断言（P016-P5）。

### 5. P016-P5: 专项交付报告落盘与诚实口径

- 专项报告落盘本文件：`docs/ledger/p0-16-records-archive-idempotent-compensation.md`。
- 同步更新台账总索引 `docs/ledger/README.md`。

---

## 二、路径约束与边界遵从

### 1. 6 条 Writable Paths 遵从核实

| 路径                                                           | 改动类型 | 说明                                                                   |
| :------------------------------------------------------------- | :------- | :--------------------------------------------------------------------- |
| `daemon/pipeline/records-archive.ts`                           | 修改     | 新增 `compensateContractRecordsArchive` 幂等补偿函数与原子文件操作工具 |
| `daemon/pipeline/merger.ts`                                    | 修改     | 接入显式重试入口 `compensateMergeRecordsArchive`，校准返回类型         |
| `src/lib/state/terminal-delivery-closure.ts`                   | 修改     | 支持 `compensated` 标记与补偿成功后的状态收敛                          |
| `tests/daemon/p0-16-records-archive-compensation.test.ts`      | 新建     | 7 项专项集成/单元测试覆盖全部 DoD                                      |
| `docs/ledger/p0-16-records-archive-idempotent-compensation.md` | 新建     | 本专项审计与交付报告                                                   |
| `docs/ledger/README.md`                                        | 修改     | 登记本报告并更新开放项台账状态                                         |

### 2. 4 条 Readonly Paths 零 Diff 核对

- `daemon/guard/evidence-integrity.ts`：零改动（严格只读）
- `daemon/pipeline/contract-store.ts`：零改动（严格只读）
- `src/lib/contract.schema.ts`：零改动（严格只读）
- `docs/specs/task-card-standard.md`：零改动（严格只读）

### 3. 明确排除逐字约束

- **不改 Git 提交主路径语义**：Git squash commit 依然在主干排他锁内最先原子提交，辅助归档依然作为提交后的副作用存在；
- **不动 merge gate 门禁断言**：8 道 PRE_MERGE 门禁断言（含 P0.15 信任根检查）完全不受影响；
- **不引入外部依赖服务**：不引入 Redis、外部数据库或第三方消息队列；
- **不做跨进程持久化队列**：跨进程队列挂账，保持纯进程内轻量幂等补偿。

---

## 三、诚实口径与五项事实边界保留

本卡修证合并后辅助性 records 归档与公开交付副本拷贝的幂等补偿机制，消除辅助拷贝失败导致的半写或重复脏状态；不改动 Git squash commit 提交主路径语义与门禁断言。

五项架构事实边界继续保留并挂账：

1. **硬件级 Attestation 缺失**；
2. **Merger 不重跑全量测试**；
3. **容器内无 OS 级二次沙盒**；
4. **跨进程 Nonce 持久化未做**；
5. **真实容器运行时 3/10 跳过项**。

**五项事实边界保留，P0 风险未宣称解除**；严禁宣称「P0 风险完全解除」；合同 `MERGED`、端到端闭环走通一次口径不变。
