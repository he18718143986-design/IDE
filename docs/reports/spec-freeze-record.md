# Stagent 规范资产封版记录（Spec Freeze Record）

> **Supervisor SSOT 升级（2026-10-26）**：体验与监理合流权威见 [`../specs/supervisor.md`](../specs/supervisor.md)（`TASK-C.19`）。本 Freeze 记录仍是**全局多主题封版索引**（保留在 `docs/reports/`，**未**整份归档）。  
> **合流前五正文已归档**（Tina t908u · `TASK-C.20`），原位于 `docs/archive/supervisor-pre-ssot/`（目录已移除，见 Git 历史）；该目录已于 2026-10-27 文档治理整体移除，原文查 Git 历史（`git log --diff-filter=D -- docs/archive/`）。**与 SSOT 冲突的体验旧词（五视口日常入口、≤2 轮问卷门控等）以 SSOT 为准**。

**日期**: 2026-10-26（Asia/Hong_Kong）  
**定位**: 短锚点 / 索引 — **不**合并五份正文；正文继续分治。  
**权威声明**: 自消歧锚点 tip **`fb6167d`** 起，经 **`836be2b`**（API Top5）、**`cbc0216`**（DocGov/Workflow 分轨）至**本封版 tip**，**以本记录 + 下列 CLOSED 规范为唯一事实源**；此前讨论草稿、过时「待决议 / Open Decision」、与本记录冲突的旧词（单一 `DEMO_READY`、笼统交付 `VERIFIED`、资产 `FROZEN` 冒充主交付、弹窗静默放行等）**一律作废**。  
**施工权威仍是**: 仓库根 `docs/`《架构规范》《任务规范》+ 升格后的任务卡；讨论稿正文仍分治；**Top5 Delta** `TASK-C.12a`–`e` 与**基线档案** `TASK-C.14a`–`c` 均见《任务规范》（已 COMPLETED；**CLOSED ≠ 免体验**）。

---

## 0. 为什么要有这份记录（结论先行）

一句话：防止人与 AI 陷入「讨论很爽、落地扯皮、反复横跳、永不交卷」。

| # | 要杀的死循环 | 本记录怎么钉死 |
| :--- | :--- | :--- |
| 1 | **全局记忆污染** | 长上下文里新旧草稿并存；没有唯一锚点，Agent 会翻出废弃态写码。本记录 = 物理防火墙。 |
| 2 | **产品拍板 ≠ 工程实现** | **CLOSED ≠ 已实现 / 已验证**。设计选择题已做完；写码阶段禁止借故重开产品哲学。 |
| 3 | **Worker 脑补特权** | 枚举、路径、软停、吊销、侧车路径白纸黑字；不符表字段的实现直接打回。 |
| 4 | **范围蔓延拖死 v0.1** | §4 明确不阻塞清单：Impact/Mode/AST/容器/云归档 → **v0.2+**；v0.1 跑通 Top5 + EO-01/02 要害即胜。 |

> 没有 Spec Freeze 的项目，不是在开发软件，而是在进行一场没有终点的哲学研讨。  
> 本记录 = 前期研讨终点站，也是「概念 → 施工」的出发点。

---

## 1. CLOSED 规范清单（5 + 右栏）

| # | 文件 | 收口要点 | 关键 tip |
| :--- | :--- | :--- | :--- |
| 1 | `Supervisor右栏…`（原文已移除） | **§0** 语义折叠；**§8～§13** 产品 CLOSED；**§14** DEC-01～06 + 四补钉 + **EO-01～10** CLOSED | `fa7f007`…`d610d0a` 等；交叉注记续至 `cbc0216` |
| 2 | `Clarification…`（原文已移除） | Top7 消歧；**§5** 过时待决核销；**§6 API Top5** 定案 | `fb6167d` → `836be2b` |
| 3 | `Interface Checklist`（原文已移除） | **§3** Top5 As-is→To-be 对账表重写；附录 Token Schema 草稿 | `836be2b` |
| 4 | `document-asset-governance-chapter.md` | **DocumentAssetStatus** 与 EO-01 **分轨**；弃用旧交付词 | `cbc0216` |
| 5 | `E2E Workflow`（原文已移除） | 五阶段 ↔ EO-01；越界/沙盒交叉 EO-02/07 / Top5 | `cbc0216` |

索引入口：本文件；阅读顺序仍见 [`README.md`](./README.md)。**不要**把五份正文揉成一篇。

---

## 2. 关键状态名映射（三轨解耦）

### 2.1 轨 A — 交付主生命周期（EO-01 `DeliveryState` / `DeliveryLifecycleState`）

**链（DAG，不可跳步）**：  
`PLAN_*`（含 `PLAN_CONFIRMED`）→ **Demo 三态 READY** → **`CONTRACT_SIGNING`（轨 C 瞬态：Demo 确认后→签署前）** → `CONTRACT_SIGNED` → `IMPLEMENTING`/`EXECUTING`（可 `PAUSED` / `REWORK_REQUIRED`）→ `VERIFYING` → **`CANDIDATE_VERIFIED`** → **`MERGED`** → **`DELIVERED`**（可终态 `ABORTED` / `ESCALATED_HUMAN` 等）。

| 旧写法（作废） | 新写法（CLOSED） |
| :--- | :--- |
| 资产 `FROZEN` / `APPROVED` 冒充「已签署可开工」 | **`CONTRACT_SIGNED`**（资产轨仍可记 `FROZEN` 快照） |
| 笼统交付 `VERIFIED` | **`CANDIDATE_VERIFIED` → `MERGED` → `DELIVERED`** |
| 单一无模式 `DEMO_READY` | **`DEMO_INTERACTIVE_READY` / `DEMO_NATIVE_FLOW_READY` / `DEMO_DEGRADED_READY`**（或主干 `DEMO_READY` + `demo_mode`） |
| `MERGED → REWORK_REQUIRED` | **禁止**；合并后只开新微合同 |

广播须叠 **`session_epoch` + `state_seq`**（Top5 #2）；客户端按 seq 去重防倒流。

### 2.2 轨 B — 文档资产文件态（DocGov `DocumentAssetStatus`）

`DRAFT` → `PROPOSED` → **`FROZEN`** →（资产轨）`VERIFIED` → `ARCHIVED` / `SUPERSEDED`  

**铁律**：资产 `FROZEN` ≠ 交付已开工；资产 `VERIFIED` ≠ 已 `MERGED`/`DELIVERED`。

### 2.3 轨 C — 子任务活动态（`TaskSubState`）

`DEMO_BUILDING` / `DEMO_FAILED` / `CONTRACT_SIGNING` / `MERGING` / `ABORTING` 等瞬态 — **不得**与 A/B 揉成一张扁平表。

### 2.4 工程硬钉（交叉 Top5 / EO）

| 主题 | 定案 |
| :--- | :--- |
| **Token** | 外部 `session-token` + 内部 **`exec_token`**（绑 `contract_id`+worktree）；`PAUSED` 硬吊销；恢复一次性 **`resume_token`+`jti`**（EO-07 / Top5 #1） |
| **越界** | 阻断 IO → **`SIGINT` 软停 3s** → 超时 **`SIGKILL`** → 吊销 `exec_token` → 清锁 → `PAUSED` 问人；**禁静默放行**（Top5 #3） |
| **Demo 门禁** | 三态 + **`can_sign`**；合入后轻量拷贝 `.stagent/records/`（Top5 #4 / EO-05·06） |
| **无 Git 审计** | **`.stagent/records/{contract_id}/audit-manifest.json`**（Top5 #5） |
| **物理隔离** | Worker **只**挂载 **`.stagent/worktrees/{contract_id}/`**；`prototypes/` 与 `records/` **不进**沙盒；禁 `../` 与符号链接穿透（EO-02） |

---

## 3. API Top5（CLOSED · 缺口 ≠ 推翻现网）

现网对账多为 **半有 / 无**；定案映射为 **Delta 升级卡**，不推翻 session / STATE / prototypes 骨架。细节见澄清 **§6**、Checklist **§3**。

| # | 缺口 | To-be 一句话 | EO | 任务卡 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Token | 双层 + PAUSED 吊销 + resume/`jti` | EO-07 | **`TASK-C.12a`** |
| 2 | 重连 | `session_epoch`+`state_seq` → EO-01 | EO-01 | **`TASK-C.12b`** |
| 3 | 越界 | SIGINT 3s → SIGKILL → 吊销 → 清锁 | EO-02·07 | **`TASK-C.12c`** |
| 4 | Demo | 三态 + `can_sign` + records 拷贝 | EO-05·06 | **`TASK-C.12d`** |
| 5 | 无 Git 审计 | `audit-manifest.json` 侧车 | EO-03·04·05 | **`TASK-C.12e`** |

---

## 4. 明确不阻塞 v0.1 的事项（降级免责）

下列为 **v0.2+ 目标能力**；施工中不得以「还没好」卡住 v0.1：

- **Impact Analysis / 完整 AST** 动态分析 → v0.2+；**v0.1 = 保守 Scope + P.1**
- **Mode 0～4** 容器集群 / 多端协同等 → v0.2+
- **容器级沙盒**（相对 worktree 路径隔离的增强）→ v0.2+
- **云端归档 / 多端 records 同步** → v0.2+（v0.1 本地 `.stagent/records/`）

**v0.1 大获全胜口径**：API Top5 硬核契约 + EO-01/02 要害状态与路径跑通 + 保守 Scope/P.1。

---

## 5. CLOSED ≠ 已实现 / 已验证

```
┌────────────────────────────────────────────────────────────┐
│  CLOSED（拍板）= 产品/工程选择题做完，规范词汇收口           │
│  IMPLEMENTED   = 代码落地 + 端到端验证                      │
│  本记录只盖「设计公章」，不盖「已交付」章                    │
└────────────────────────────────────────────────────────────┘
```

讨论稿侧 Spec Freeze **不等于**已实现。Top5 Delta `TASK-C.12a`–`e` 与基线 `TASK-C.14a`–`c` **已立卡并 COMPLETED**（仍须走查/体验；**不**把讨论稿整份并入 Freeze 五正文）。

---

## 6. 升格立卡（2026-10-26 · Tina t817u）

Tina 显式「升格立卡」后，Top5 Delta **已写入**《任务规范》为：

| 卡 | 一句话 | 状态 |
| :--- | :--- | :--- |
| **`TASK-C.12a`** | 双层 Token（exec + resume/`jti`；PAUSED 吊销） | `[COMPLETED]`（tip `12b14b1`） |
| **`TASK-C.12b`** | `session_epoch`+`state_seq` + EO-01（含 `CONTRACT_SIGNING`） | `[COMPLETED]`（tip `12b14b1`） |
| **`TASK-C.12c`** | 越界原子拦截 SIGINT 3s→SIGKILL→吊销→清锁 | `[COMPLETED]`（tip `12b14b1`） |
| **`TASK-C.12d`** | Demo 三态 + `can_sign` + records 拷贝 | `[COMPLETED]`（tip `12b14b1`） |
| **`TASK-C.12e`** | `audit-manifest.json` 无 Git 侧车 | `[COMPLETED]`（tip `12b14b1`） |

- **开发序已收口**：C.12a→…→C.12e 已 COMPLETED（tip `12b14b1`）。  
- **仍成立**：CLOSED ≠ 免体验验证；冲突裁决：本封版记录 → CLOSED 五份正文 → 更早草稿（作废）。  
- 五份讨论稿正文**不整份**并入架构规范；施工只认任务卡 + 本锚点引用。

---

## 7. 已有项目基线档案（短锚 · 不并入五正文）

- 权威讨论稿：`baseline-archive-onboarding-design.md`（该归档文件已于 2026-10-27 移除，原文见 Git 历史）；产品名 **项目现状基线档案**；确认≠授权。  
- 任务卡 **`TASK-C.14a`–`c`** 已 COMPLETED（tips `0417203` / `e01188f` / `dd14fa0`）。  
- **`TASK-C.14d` / `C.14e`** 已 COMPLETED（Tina t854u；tip `fa69cb5`）：脏区→Scope 真链路；OS 沙盒证明。**Darwin**：`sandbox-exec`；写拒多为 **EPERM**（≠ Linux EROFS）；断网多为 **ENOTFOUND**。Linux：`unshare -n`，无 RO mount 则 `logical_fallback`。证明前不得升级硬承诺。  
- **`TASK-C.14f`** + **`TASK-C.15a`–`d`** 已立卡（Tina t855u；WS 深度进度 + EO 余面；不再 backlog-only；**CLOSED/立卡 ≠ 已实现**直至合入）。**不**并入五正文。

- 仍 **不** 把讨论稿整份并入 Freeze 五正文。  

