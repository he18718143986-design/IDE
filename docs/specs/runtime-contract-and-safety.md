# Stagent 运行时硬契约与安全规范（Runtime Contract & Safety）

> **状态**：**现行生效 · 运行时工程硬契约的唯一权威**
> **建立日期**：2026-10-27（Asia/Hong_Kong，文档治理重组）
> **为什么新增本文件**：本文件涵盖的内容原先**散落在 6 处**——架构规范 §4/§5/§9、Supervisor SSOT §4、Top7、核心资产治理、合同设计说明 §5、Claude Code 隔离设计——并且**本轮审查发现的 10 条冲突中有 4 条（C-1/C-2/C-3/C-8）全部落在这层**。把它们收口为一份并宣布唯一权威，是消灭冲突成本最低的手段。
> **与三份规范的关系**：[`system-architecture.md`](./system-architecture.md) 管「怎么造 Stagent」；[`supervisor.md`](./supervisor.md) 管「Supervisor 产品与监理灵魂」；[`development-tasks.md`](./development-tasks.md) 管「哪张卡做了什么」；**本文件管「用户每一轮需求被哪些硬约束兜住」**。
> **版本流转**：由 Git Tag 与 commit 历史承载，文件名不含版本号。

---

## 0. 权威声明与失效条文登记

**本文件是下列主题的唯一权威。** 下表中列出的旧条文如与本文件冲突，**一律以本文件为准**：

| 主题 | 本文件章节 | 被取代的旧条文（均已在原文件头部标注失效） |
| :--- | :--- | :--- |
| Demo 是否为开工硬前置 | §3 | 核心资产治理 §二.3-2；文档治理 §3.1；Supervisor E2E Workflow §1.1 — 见 ADR-0010 |
| 无 Git 审计侧车路径 | §6 | Top7 §7（`.stagent/metadata/`）— 见 ADR-0011 |
| 交付终态与归档 | §7 | Spec Freeze §2.1 / 文档治理 §4.2 的 `DELIVERED` — 见 ADR-0012 |
| 终态 Worktree 清理 | §7.2 | 旧「放弃本轮 → 清理临时 worktree」笼统表述；分阶段清理协议尚未实现，见 RFC |
| 澄清轮次上限 | §2.5 | Top7 §4「≤2 轮」— **已正式作废**（裁决 D-3） |
| 合同范围的来源与确认前展示 | §1、§2.2 | 「确认方案」时由意图文本临时推断范围 — 见 Supervisor SSOT 第三部分 §15（D7） |
| 确认后右栏是否锁定 | §2.1 | Supervisor SSOT §7 D3「右栏保持锁定」— 见 SSOT 第三部分 §16.5（D9） |

**相关法律**：[`../adr/`](../adr/) — ADR-0002（互斥）、0003（能力边界）、0004（预算）、0005（验证）、0006（非防篡改）、0008（Demo Origin）、0010、0011、0012、0013。

---

## 1. 合同护照模型（本轮授权的最小完整集）

一轮施工的合同（SoftwareContract）是**本轮授权的唯一凭据**。它必须同时锁定五类信息，缺一不可：

1. **需求意图**（Objective & User Intent）——用户这一轮到底要什么；
2. **可写边界**（`writable_paths` / `forbidden_paths`）——见 §4；
3. **验收断言**（`verification_spec`）——必须是**可执行命令**（argv + `shell:false`），不是散文；
4. **预算与熔断**（Token / 工具调用 / 重试次数）——见 ADR-0004；
5. **授权状态**（`approval` + `authorization.git`）——未达 `APPROVED` 不得写盘。

**铁律**：合同是**护照**不是愿望清单。合同里没写的路径，一律不可写；合同里没写的命令，一律不可跑。

**护照的来源（v2.1 · D7）**：第 2～4 类信息必须在确认前由范围预检算出 `ScopePlan`，以白话展示在中栏《改动范围与验收方式》，并随冻结快照落盘。带 `confirmation_id` 的合同**只能**从快照里的 `ScopePlan` 原样生成，Daemon 不得从意图文本重新推断。详见 [`supervisor.md`](./supervisor.md) 第三部分 §15。

---

## 2. 签署分水岭（零无授权写入）

| 阶段 | 允许 | 禁止 |
| :--- | :--- | :--- |
| **确认方案前** | 只读分析；草案写入 `.stagent/drafts/`；Demo 写入 `.stagent/prototypes/` | 写用户项目主干；下发写权限 `exec_token`；跳过用户确认开工 |
| **确认方案 / 签署后** | Worker 仅在 `.stagent/worktrees/{contract_id}/` 与合同 `writable_paths` 内施工 | 改合同本身；挂载/改写 `prototypes/` 或 `records/`；`../` 穿出 worktree；静默扩 Scope |

**不变量**：签署事件落盘前，主干工作区的改动必须为 **0 字节**（drafts / prototypes 除外，且二者不得进主干）。

### 2.1 「确认方案」原子事务

点击「确认方案」后按五阶段原子执行，任一步失败则整链中止并回滚到可重试的审阅态：

| # | 阶段 | 必须完成 | 失败语义 |
| :--- | :--- | :--- | :--- |
| 1 | `CLAIM_AND_QUIESCE` | 中断右栏流式 + 禁用右栏输入 | 失败即中止，**零落盘** |
| 2 | `VALIDATE_CONFIRMATION` | 在**已冻结**的同一修订上跑唯一谓词 | 失败即解锁，可重试 |
| 3 | `FREEZE_SNAPSHOT` | 写不可变快照 `.stagent/drafts/schemes/{confirmation_id}.json` | 失败即解锁，**不进签署** |
| 4 | `SIGN_AND_PREPARE` | 建合同（带 `confirmation_id`）→ 批准 → 建任务图 | 失败**必须** `compensate` |
| 5 | `COMMIT` | 记住幂等结果，方案冻结；右栏解锁进入施工对话（v2.1 · D9） | — |

**幂等契约**：`confirmation_id` 由**前端生成**，同一修订重试必须复用同一 id（`src/lib/journey/confirm-scheme-atomic.ts`）。同 id + 同内容 → `idempotent: true`；同 id + 换修订 → `E_CONFIRMATION_ID_REUSED`；`confirmation_id` 非法 → `E_CONFIRMATION_ID_INVALID`。
> **裁决 D-1**：内容派生式 `sha256(scheme_id + revision + digest)` **不采纳**（会使 `E_CONFIRMATION_ID_REUSED` 永远无法触发），留档为 v0.2 备选，见 [`../rfc/scheme-snapshot-and-attestation-model.md`](../rfc/scheme-snapshot-and-attestation-model.md) §5。

> **v2.1 补充**：第 2 阶段同时校验 `ScopePlan` 与当前修订绑定，并在 Daemon 上重跑预检比对 `plan_digest`，不一致 → `E_SCOPE_PLAN_DRIFT`（409）；第 3 阶段快照包含完整 `ScopePlan`；第 4 阶段建合同的范围、验证命令与预算只取自快照。冻结后的右栏消息按 SSOT 第三部分 §16.5 分流，**不得**写入冻结快照。

**补偿契约**：第 4 阶段任何失败都必须调用 `compensate`；补偿失败 → `E_COMPENSATION_FAILED`，**保持锁定**（禁止假装成功、禁止静默解锁）。

### 2.2 唯一确认谓词

`evaluateSchemeConfirmation(draft, demo)` 是**唯一**的「能不能点确认方案」判定函数（v2.1 目标签名：`evaluateSchemeConfirmation(draft, demo, scopePlan)`，见 SSOT 第三部分 §15.5）。UI、Daemon、脚本、重试全部调用它；任何第二套判断——包括「UI 根据自己的状态推导 `disabled`」——均视为缺陷。

- 实现锚点：`src/lib/journey/scheme-draft.ts` → `evaluateSchemeConfirmation`
- Daemon 侧等价物：`daemon/supervisor/demo/signing-gate.ts` → `evaluateSnapshotDemoGate` / `evaluateLatestDemoGate`（同一组拒绝码，不得自造新码）
- **权威边界**：UI 求值只是**提前告知**；真正放行以 Daemon 求值为准。不一致时以 Daemon 为准并记告警。

### 2.3 拒绝码闭集

| 码 | 触发条件 | 用户可做什么 |
| :--- | :--- | :--- |
| `E_SCHEME_ALREADY_FROZEN` | 方案已冻结 | 无需操作 |
| `E_SCHEME_CONFLICTS_OPEN` | 仍有 `chosenId === null` 的冲突 | 在中栏决议区选一个 |
| `E_SCHEME_NOT_REVIEWABLE` | 标题 < 2 字或（摘要 < 8 字且无模块） | 继续聊或手改 |
| `E_DEMO_BUILDING` | `demo.status === "building"` | 等完成或重试 |
| `E_DEMO_FAILED` | `demo.status === "failed"` | 重试 / 显式接受降级 |
| `E_DEMO_CONFIRMATION_REQUIRED` | 已生成但 `decision_revision !== scheme_revision` | 点「确认 Demo」或「接受降级」 |
| `E_DEMO_STALE` | `demo.scheme_revision !== scheme_revision` | 重新生成 Demo |
| `E_SCOPE_NOT_READY`（v2.1） | 没有与当前修订绑定的 `ScopePlan` | 等预检完成 |
| `E_SCOPE_POLICY`（v2.1） | 自动收敛后范围仍违反通配符分级（§4.1） | 说清要改哪块，或排除该区域 |
| `E_SCOPE_APPROVAL_REQUIRED`（v2.1） | `ScopePlan.needs_approval` 有未表态项 | 点「可以」或「不行」 |

> **ADR-0014 指针（2026-10-30 加注）**：上一行「点『可以』或『不行』」改为由「确认开工」一次点击授权全部敏感项，授权仍存于 `ScopePlan`。规则见 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §5 SA-1。


**Daemon 专属码**（只有 Daemon 能检出：需要读磁盘、快照或重跑预检；前端无从提前告知）：

| 码 | 触发条件 |
| :--- | :--- |
| `E_DEMO_NOT_CONFIRMED` | Demo 确认记录 `confirmed !== true` |
| `E_SCHEME_SNAPSHOT_NOT_FOUND` | 传了 `confirmation_id` 但快照缺失或损坏（HTTP 409） |
| `E_SCOPE_PLAN_DRIFT`（v2.1） | Daemon 重跑预检得到的 `plan_digest` 与前端提交的不一致（HTTP 409） |
| `E_SCHEME_SNAPSHOT_MISMATCH`（v2.1） | 带 `confirmation_id` 的合同范围、验证命令或预算与快照里的 `ScopePlan` 不一致（HTTP 409） |
| `E_SCOPE_INVARIANT_BROKEN`（v2.1） | 带 `confirmation_id` 且合同与快照一致，但 `gradeWritableScope` 仍失败（D1 违约；HTTP **500**，不得返回 403） |

**新增码必须同时更新本表、Supervisor SSOT §15.5 与测试。** 带 `confirmation_id` 的签署链**不得**返回 `E_WRITABLE_SCOPE_POLICY`；若发生，按 D1 违约缺陷处理（对外应映射为 `E_SCOPE_INVARIANT_BROKEN`）。

### 2.4 允许与禁止的状态边

- ✅ `PLAN_CONFIRMED → CONTRACT_SIGNED`（**直签，Demo 为 `none` 时放行**；见 §3）
- ✅ `PLAN_CONFIRMED → DEMO_READY → CONTRACT_SIGNED`（老链路，继续合法）
- ❌ `PLAN_READY → CONTRACT_SIGNED`（跳级）
- ❌ `MERGED → REWORK_REQUIRED`（合并后只开新微合同）

### 2.5 澄清轮次

**不设固定轮次门禁。** 右栏为自由意图对话，Supervisor 默听并增量刷新中栏方案，不因「还没问完 N 轮」阻塞对话。
> **裁决 D-3**：Top7 §4「主动澄清 ≤2 轮」**正式作废**。旧口径适用于已废弃的五视口 + C.11 体感链；现行体验锚点为 `TASK-C.18`。安全默认与关键冲突一律改在中栏决议区确认，而非用问卷门控逼问。

---

## 3. Demo 门禁（体验增强项，非开工硬前置）

> **ADR-0010**：Demo 是可选增强项，**不是所有任务的开工硬前置**。

| 情形 | 判定 |
| :--- | :--- |
| 未生成 Demo（无 UI 诉求 / 用户未点「生成 Demo」） | **允许直签**，以审阅后的静态方案为准开工；**禁止**弹「请先确认 Demo」类硬阻断 |
| 已生成 Demo 且用户已显式确认 | 允许签署 |
| 已生成 Demo 但**未**确认 | `E_DEMO_NOT_CONFIRMED`，**拒绝** |
| Demo 基于旧修订 | `E_DEMO_STALE`，重新生成 |
| Demo 构建失败 | 中栏必须同时提供【重试生成】与【接受仅用流程图说明开工（标风险）】；降级后落 `demo.status = degraded_flowcard` + `demo.risk_flags ⊇ {NO_INTERACTIVE_DEMO}` |

**`demoReady` 判定**以 `supervisor.md` §14.10（v2.1 改判：`≥ 1` 个 `user_visible` 模块）为准，本节不复述谓词。
`completeness`（0–100）**只作 UI 进度展示**，不参与任何门禁、分支或 `disabled` 推导。

---

## 4. 最小可写 Scope 与保护清单

### 4.1 通配符分级（判据钉死）

判据是「**仓库里有没有项目声明**」——`package.json` 缺失即绿野，与 `daemon/supervisor/rules-l0.ts::isGreenfieldRepo` 同一口径：

| 分类 | 形态 | 裁决 |
| :--- | :--- | :--- |
| `exact` | `src/features/finance/report.ts` | 接受 |
| `module_subdir_glob` | `src/features/finance/**` | 接受 |
| `bare_top_glob`（绿野脚手架种子） | 绿野仓库的 `src/**`、`tests/**` | 接受 |
| `bare_top_glob`（已有项目声明） | 有 `package.json` 却仍声明 `src/**` | **拒绝**，须收敛到精确文件或模块级 |
| `bare_top_glob`（全仓） | `**`、`**/*`、`*`、`*/**` | **任何形态都拒绝** |

> 首版判据「该顶层目录是否已存在」**已被实测证伪并留痕**：仓库内 40+ 处夹具与非 npm 工程（Python/Go/纯脚本）都以 `src/**` 为常规写法，按目录存在性判会把它们一律判死。测试 `T-SCOPE-007/007b/007c/014/015`，实现 `src/lib/writable-scope-grade.ts::gradeWritableScope`。

**落盘收敛**：`exact` 原样保留；glob 被其命中的已写文件替换（去重）；未命中则保留原 glob 种子。验收与审计以**收敛后**的清单为准，不得长期悬挂无界通配。

### 4.2 严禁 / 保护路径（P.1 一票否决）

`.env*`、`.git/**`、`.stagent/**`（治理自锁）、锁文件、认证/支付等敏感区。**即使绿野项目，这些也不得被任何 `writable_paths` 通配吞入。**

保护清单 `.stagent/protection.json` 自身亦受保护：只能由用户在界面上修改，AI 不可改。

**四类绕过必须全部失败关闭**（由测试证明，不由话术声明）：AI 自带改文件工具 ／ 命令行（Shell）／ 改名与删除 ／ 符号链接指向受保护文件（按真实路径判定）。

### 4.3 脏区防误伤

未 `acknowledge_dirty` 不得把脏主仓路径卷入可写施工；API 返回 **409** + 白话低恐慌排除建议；确认后排除并入禁写（`TASK-H.6` / C.14d）。

---

## 5. 执行凭证、越界熔断与隔离

### 5.1 双层 Token

外部 `session-token` + 内部 `exec_token`（绑定 `contract_id` + worktree）。`PAUSED` 时**硬吊销**；恢复使用一次性 `resume_token` + `jti`。

### 5.2 越界原子拦截

阻断当次 IO → `SIGINT` 软停 **3s** 释锁 → 超时 `SIGKILL` → 吊销 `exec_token` → 清锁 → 交付态 **`PAUSED`** 问人。**禁止静默放行**。扩权 = 新卡重签，禁止默许。

### 5.3 物理隔离边界

- Worker **只挂载** `.stagent/worktrees/{contract_id}/`；禁符号链接穿出、禁 `../`。
- Demo 落在 `.stagent/prototypes/{id}/`（gitignore，不进主干）；归档落在 `.stagent/records/{contract_id}/`。**`prototypes ≠ worktrees ≠ records`。**
- Worktree **不是 OS 级沙盒**（ADR-0003）；只读/断网证明由 `daemon/baseline/os-sandbox.ts` 独立给出，未证明不得升级硬承诺。
- CLI Worker 适配器隔离见 **ADR-0013**：弃用 `--bare`，改用 `--setting-sources ""` + 工具白名单 + 严格 MCP + 环境白名单。

### 5.4 验收断言与证据

- 合同须带**可执行**验证命令（`shell:false` 的 argv）。绿野/主路径常用 `npm run typecheck` 与 `npm test`。
- **空验证集不得点亮**；Worker「我说完成」不够——须 Evidence 核销后由 Supervisor 提案点亮，Daemon 裁决。
- 红队质询：查假测试/空断言、既有回归、未跟踪文件是否进 Scope；超时**不静默放行**。
- `can_merge` 只能由 Daemon 依据真实退出码派生（ADR-0005）。
  - 注：`manual_confirmation` 人工确认记录为 `can_merge` 的前置必要条件（合同声明 `manual_confirmation` 时，确认记录不齐全则 `can_merge=false`），不构成退出码派生规则之外的第二种派生源。

---

## 6. 无 Git 审计侧车

> **ADR-0011**：唯一权威落点 `.stagent/records/{contract_id}/audit-manifest.json`。**`.stagent/metadata/` 已废止。**
> 代码证据：`daemon/guard/audit-manifest.ts` → `RECORDS_ROOT = ".stagent/records"`。

- 记录相关文件 **SHA-256** 与合同 Hash；
- **必须先过脱敏管道再落盘**——永久保留的是**脱敏后完整记录**，不是明文原声；
- 它是独立于 Git Trailer 的**对等降级审计链**：有 Git 时二者并存，无 Git 时单独承载完整性；
- 对齐 ADR-0006：以上构成**可验证性**，**不构成**密码学防篡改。

---

## 7. 终态、归档与清理

### 7.1 终态口径（ADR-0012）

**`MERGED` 是唯一运行时交付终态，不设独立 `DELIVERED` 枚举。**

```
… → VERIFYING → CANDIDATE_VERIFIED → MERGED
```

- 合并成功即视为交付成功路径，对外话术统一挂在 `MERGED` 上，**不得伪标**代码里不存在的状态；
- 脱敏归档（写入 `records/` + audit-manifest）失败 → **停在 `MERGED`** 并如实记录归档未完成；**严禁伪造完结、严禁回退已合并轮次**；
- 合并后新缺陷 → 开**新微合同**，**禁止** `MERGED → REWORK_REQUIRED`。

### 7.2 Worktree 清理

**现行口径**：用户放弃本轮或合并完成后清理临时 Worktree；清理失败进入**可重试告警**，不得标成已交付。

**尚未实现的目标协议**：分阶段清理（`SUCCESS → RETAINED_FOR_REVIEW` 禁止立即 prune、终态即吊销 Token、`CLEANUP_FAILED` 可审计）在 `src/` 与 `daemon/` 中 **0 命中**，已抽为 RFC，见 [`../rfc/scheme-snapshot-and-attestation-model.md`](../rfc/scheme-snapshot-and-attestation-model.md) §4.7.3。**不得把它当作现行行为规范引用。**

---

## 8. 错误码分层

| 层 | 位置 | 职责 | 代表码 |
| :--- | :--- | :--- | :--- |
| **L1 前端提前告知** | `evaluateSchemeConfirmation` | 决定按钮 `disabled` 与提示文案，可被用户直接修正 | §2.3 主表（7 码 + v2.1 三个范围码） |
| **L2 Daemon 签署拦截** | `signing-gate.ts` | 真正放行判定；快照缺失即拒 | §2.3 主表 + 「Daemon 专属码」表 |
| **L3 执行期运行时** | Gateway / Orchestrator / Daemon HTTP 层 / 派工门禁 | 越界、预算、锁、越权、墓地命中 | `E_OUT_OF_SCOPE` / `E_OUT_OF_SCOPE_UNTRACKED` / `E_BUDGET_EXCEEDED` / `E_WORKSPACE_LOCKED` / `E_PROPOSAL_PREVIOUSLY_REJECTED`（v2.1，INV-LEDGER-03）/ `E_DISPUTE_TIMEOUT`（质询超时，见 playtest-self-check.md） |

> `E_CHECKPOINT_FAILED`（Daemon HTTP 层 409）为开一轮前的检查点码，不列入 L3 代表码，待门禁码闭集建立时统一登记。
>
> **L3 闭集待补登（提案）**：L3 行目前只列代表码，没有闭集表；`E_FORBIDDEN_PATH`、`E_TEST_FILE_WRITE_BLOCKED` 是执行期码却未列入，`E_CHECKPOINT_FAILED` 实为开一轮前的检查点码。补登方案与候选闭集表见 [`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §5.3，由 `TASK-J.18` 实施 PR 合入本节 §8.1。

**纪律**：凡前端能检出的情形，L1 与 L2 必须使用**同一组拒绝码**；L2 只可额外使用 §2.3「Daemon 专属码」表中登记的码，不得自造未登记的码。两者结论不一致时以 L2 为准并记一条告警。

---

## 9. 权威指针

| 主题 | 权威 |
| :--- | :--- |
| 系统不变量与数据模型 | [`system-architecture.md`](./system-architecture.md) |
| Supervisor 产品与监理语义 | [`supervisor.md`](./supervisor.md) |
| 任务卡与验收状态 | [`development-tasks.md`](./development-tasks.md) |
| 不可逆决策 | [`../adr/`](../adr/) |
| 未实现的快照/清理模型 | [`../rfc/scheme-snapshot-and-attestation-model.md`](../rfc/scheme-snapshot-and-attestation-model.md) |
| 交付状态机（代码即权威） | `src/lib/state/delivery-state.ts` |
| 确认事务（代码即权威） | `src/lib/journey/confirm-scheme-atomic.ts` |
| 签署门禁（代码即权威） | `daemon/supervisor/demo/signing-gate.ts` |
| 保护清单与审计（代码即权威） | `daemon/guard/audit-manifest.ts`、`daemon/supervisor/rules-l0.ts` |
