# Stagent 运行时硬契约与安全规范（Runtime Contract & Safety）

> **状态**：**现行生效 · 运行时工程硬契约的唯一权威**
> **建立日期**：2026-10-27（Asia/Hong_Kong，文档治理重组）
> **DOC-7 升格**：2026-11-01 — §10 路径/常量、§11 状态机合同并入（用户拍板提前做；原两草案降为历史指针）。
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
| **确认方案 / 签署后** | Worker 仅在 `.stagent/worktrees/` 下该合同目录与合同 `writable_paths` 内施工 | 改合同本身；挂载/改写 `prototypes/` 或 `records/`；`../` 穿出 worktree；静默扩 Scope |

> **路径字面（DOC-5 / DOC-7）**：活跃 Worktree 代码路径为 `.stagent/worktrees/task-{contract_id}/`（`worktree-manager` / `server` / `launcher`）。表格里的 `{contract_id}` 是合同键简写，**不等于**目录名一定无前缀。`worktree-seal` 当前写无前缀目录，与创建路径不一致 → 需立卡，本波不改代码。权威摘要见本文 **§10**（原 `constants-and-paths.md` §0 已升格）。

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

- Worker **只挂载** `.stagent/worktrees/task-{contract_id}/`（代码事实；禁符号链接穿出、禁 `../`）。
- Demo：**隔离预览**落在 `.stagent/prototypes/{id}/`（gitignore，不进主干）；遗留生成器仍可能写 `.stagent/demo/`（见 constants §0）。归档落在 `.stagent/records/{contract_id}/`。**`prototypes ≠ worktrees ≠ records`。**
- 合并 commit trailer 键名以 `daemon/pipeline/merger.ts` 为准（`Stagent-Contract-ID` 等）；长度/集合以代码为 SSOT。
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

> `E_CHECKPOINT_FAILED`（Daemon HTTP 层 409）为开一轮前的检查点码，**不列入 L3 闭集**（改登记为开工前码；见 §8.1）。

### 8.1 L3 执行期码闭集（TASK-J.18c / GAP-W5）

执行期（派工后写入 / 全量扫描 / CLI hook / Gateway）只允许下表码作为停工主码或失败关闭码。求值不短路（P0 除外），用户面只显示一个主码，优先级见 [`worker-graveyard-gate.md`](./worker-graveyard-gate.md) §3.3。

| 码 | 触发点 | 停止语义 | 用户面 | `ERROR_CODES` | `reason_code` |
| :--- | :--- | :--- | :--- | :-: | :--- |
| `E_UNSAFE_EXECUTION` | runtime-interceptor | 短路、降级 | 「Worker 失联 / 不受控」 | ✓ | `UNSAFE_EXECUTION` |
| `PATH_TRAVERSAL_DETECTED` | Gateway 路径解析 | 短路 | 同上 | ✓ | `SCOPE_VIOLATION` |
| `E_FORBIDDEN_PATH` | Gateway `checkWriteAccess` | §5.2 | 超出范围（保护） | ✓ | `SCOPE_VIOLATION` |
| `E_OUT_OF_SCOPE` | Gateway / AiWorker / 检查点 | §5.2 | §15.6 扩权卡 | ✓ | `SCOPE_VIOLATION` |
| `E_OUT_OF_SCOPE_UNTRACKED` | 未跟踪文件检查点 | §5.2 | §15.6 扩权卡 | ✓ | `SCOPE_VIOLATION` |
| `E_TEST_FILE_WRITE_BLOCKED` | Gateway 测试文件守卫 | 拒绝当次写 | 检查反复失败类 | 待登记 | `SCOPE_VIOLATION`（提案） |
| `E_BUDGET_EXCEEDED` | 成本监视 | 熔断 | 接近 / 超出预算 | ✓ | `BUDGET_EXHAUSTED` |
| `E_COMMAND_TIMEOUT` / `E_TASK_TIMEOUT` | 命令执行 | 熔断 | 同上 | ✓ | `BUDGET_EXHAUSTED` |
| `E_UNAUTHORIZED_COMMAND` | 命令白名单 | 拒绝 | 超出范围 | ✓ | `UNAUTHORIZED_COMMAND` |
| `E_WORKSPACE_LOCKED` | 工作区互斥 | 拒绝 | 「等一下」 | ✓ | `WORKSPACE_LOCKED` |
| `E_PROPOSAL_PREVIOUSLY_REJECTED` | 派工门禁 / 全量扫描 / CLI hook | §5.2 | 墓地卡（§5.1） | ✓（DEC-1） | `SCOPE_VIOLATION` |
| `E_GATE_SCAN_FAILED` | 全量扫描无法读取完整 diff | 失败关闭：不进合并 | 「自动检查没跑完」 | ✓ | `PREPARATION_INTERRUPTED` |
| `E_SCHEME_SNAPSHOT_NOT_FOUND` / `E_SCHEME_SNAPSHOT_MISMATCH` | 派工绑定（复用 L2 Daemon 专属码） | 不签发 `exec_token` | 「方案快照对不上，需要重新确认」 | L2 表 | （签署/派工归因，不写入执行期 evidence 主码） |
| `E_DISPUTE_TIMEOUT` | 质询看门狗 | 熔断 | 见 playtest-self-check | ✓ | `BUDGET_EXHAUSTED` |

**移出 L3**：`E_CHECKPOINT_FAILED`（开一轮前打检查点失败）——不是执行期码。

**门禁日志码（不进本表、不进 `ERROR_CODES`）**：`W_GRAVEYARD_WEAK_MATCH` / `W_GRAVEYARD_CHECK_UNAVAILABLE` / `W_GATE_PACK_MISSING` / `W_GATE_DIFF_TRUNCATED`（口径同 K-9 / worker-graveyard-gate.md §6.3）。

**纪律**：凡前端能检出的情形，L1 与 L2 必须使用**同一组拒绝码**；L2 只可额外使用 §2.3「Daemon 专属码」表中登记的码，不得自造未登记的码。两者结论不一致时以 L2 为准并记一条告警。执行期主码**永不为**签署期 `E_SCOPE_PLAN_DRIFT`。

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
| 路径与常量（DOC-7 升格） | 本文 **§10**；代码：`daemon/git/worktree-manager.ts`、`daemon/guard/worktree-seal.ts`、`daemon/pipeline/merger.ts` |
| 状态机合同（DOC-7 升格） | 本文 **§11**；代码：`src/lib/state-machine.ts`、`src/lib/state/delivery-state.ts` |
| 历史指针 | [`constants-and-paths.md`](./constants-and-paths.md)、[`state-machine-contract.md`](./state-machine-contract.md)（仅指针，非权威） |

---

## 10. 路径与常量（DOC-7 升格 · 代码权威）

> **升格（2026-11-01 · 用户拍板提前做 DOC-7）**：自 `constants-and-paths.md` 的「代码事实」并入。冲突时以代码为准。原文件降为 `[HISTORICAL]` 指针。
> **权威代码**：`daemon/git/worktree-manager.ts`、`daemon/guard/worktree-seal.ts`、`daemon/pipeline/merger.ts`、`daemon/supervisor/demo/demo-generator.ts`、`src/lib/journey/scheme-draft.ts`。

### 10.1 运行时路径（代码事实）

| 资产 | 代码事实 | 权威落点 |
| :--- | :--- | :--- |
| 活跃 Worktree 目录 | `.stagent/worktrees/task-{contractId}/` | `getWorktreePath`（`worktree-manager.ts`）；`server` / `launcher` |
| Worktree seal 目录 | `.stagent/worktrees/{contractId}/`（**无** `task-` 前缀） | `worktree-seal.ts` → **与创建路径不一致**；改代码另立卡（本升格不改代码） |
| Demo（遗留入口） | `.stagent/demo/`（`DEMO_ROOT`） | `demo-generator.ts` |
| Demo（隔离预览） | `.stagent/prototypes/{prototype_id}/`（`PROTOTYPES_ROOT`，C.11b） | 现行隔离 Demo；见本文 §2 |
| 合并 Git Trailer | `Stagent-Contract-ID` / `Stagent-Evidence-ID` / `Stagent-Evidence-Hash` / `Stagent-Verdict` / `Stagent-Approval-Status`；可选 `Stagent-Tests-Modified`、人工确认 trailer | `merger.ts` |
| 方案确认唯一守卫 | `evaluateSchemeConfirmation(draft, demo)` | `src/lib/journey/scheme-draft.ts`（Daemon 签署结论须与之同码） |

### 10.2 目标路径 vs 代码（不得误标为已实现）

下列曾出现在草案「目标规范」表中；**升格后明确：非现行代码事实**，仅作远期设计备忘，施工仍以 §10.1 与代码为准：

| 资产 | 草案目标路径 | 现行处理 |
| :--- | :--- | :--- |
| 合同快照 | `.stagent/contracts/{contract_id}.json` | 以 Daemon 实际导出为准；未在本升格宣布为 SSOT |
| Evidence 快照 | `.stagent/evidence/{contract_id}-{evidence_id}.json` | 同上 |
| 任务 Worktree（目标简写无前缀） | `.stagent/worktrees/{contract_id}/` | **否**：活跃创建路径有 `task-` 前缀（§10.1） |
| 审计侧车 | `.stagent/records/{contract_id}/audit-manifest.json` | 见 ADR-0011 / runtime 既有条款；非「防篡改」 |

**废止声明校正**：草案曾写「废止 `.stagent/prototypes/`、`.stagent/metadata/` 以及 `task-{id}` 规范路径」。**以代码为准**：`prototypes/` 仍是现行隔离 Demo 根；`task-{id}` 是活跃 Worktree 目录名；`.stagent/metadata/` 与 ADR-0011 冲突见 DLV-4（另卡）。不得再把「废止 task- 前缀」写成现行规范。

### 10.3 跨端字段与 Trailer（代码 vs 草案）

- **合同关联键（跨端 JSON/IPC）**：小写下划线 `contract_id`（草案目标，与代码字段一致处保留）。
- **Git Trailer 键名（合并提交）**：以 `merger.ts` 的 `Stagent-*` PascalCase 为准（§10.1）。草案曾禁止 `Stagent-Contract-ID` 并要求裸小写 `contract_id:` trailer 块——**与代码冲突，升格时废弃该禁令**；字节上限（单行 512 / 块 4096）仍可作为目标测试约定，未在本文件升格为硬门禁除非代码已实现。

### 10.4 ReasonCode（证据/执行失败闭集 · 与 runtime L3 表分工）

草案闭集（目标）：`SCOPE_VIOLATION` · `BUDGET_EXHAUSTED` · `WORKSPACE_LOCKED` · `UNAUTHORIZED_COMMAND` · `VERIFICATION_RETRY_LIMIT` · `UNSAFE_EXECUTION` · `EVIDENCE_STALE` · `PREPARATION_INTERRUPTED` · `WORKTREE_LOST`。

执行期用户面主码仍以本文 §8 / L3 表与 `ERROR_CODES` 为准；本闭集描述证据与失败归因语义，**不是**另立第二套 HTTP 路由码表。

### 10.5 升格差异清单（供 PR 审查）

| # | 草案曾写 | 代码事实 | 本文件处理 |
| --- | --- | --- | --- |
| D1 | Worktree 规范路径无 `task-` 前缀 / 「废止 task- 表达」 | 创建路径为 `task-{id}` | §10.1 / §10.2 按代码；废止声明作废 |
| D2 | seal 与创建同目录（未区分） | seal 无前缀、创建有前缀 | §10.1 明示；改代码另卡 |
| D3 | 禁止 `Stagent-Contract-ID` 等，改裸小写 trailer | `merger` 写入 `Stagent-*` | §10.3 按代码 |
| D4 | 「废止 `.stagent/prototypes/`」 | prototypes 仍为隔离 Demo 根 | §10.2 校正 |
| D5 | 目标 contracts/evidence/records 路径作规范 | 未全部在代码落地为 SSOT | §10.2 降为备忘 |

---

## 11. 状态机合同（DOC-7 升格 · 代码权威）

> **升格（2026-11-01 · 用户拍板提前做 DOC-7）**：自 `state-machine-contract.md` 并入；迁移表与终态以 `src/lib/state-machine.ts` 的 `LIFECYCLE_TRANSITIONS` / `TERMINAL_STATES` 为准。交付投影见 `src/lib/state/delivery-state.ts` + `terminal-delivery-closure.ts`（H.2）与 [ADR-0012](../adr/0012-merged-as-terminal-state.md)。

### 11.1 两轨关系

| 轨 | 类型 / 模块 | 是否含 `DELIVERED` | 对外终态 |
| :--- | :--- | :--- | :--- |
| **生命周期轨** | `LifecycleState` + `ApprovalStatus`；`state-machine.ts` | **否**（止于 `MERGED` / `ABORTED`） | 成功公开终态 = **`MERGED`** |
| **交付投影轨** | `DeliveryState`；`delivery-state.ts` | **是**：`DELIVERED` = MERGED 后归档事务成功的内部/投影标记 | 对外文案收敛为 `MERGED`；禁止独立 `DELIVERED` 运行时 lifecycle 名 |

lifecycle 进入 `MERGED` 后，归档流水线可尝试投影到 `DELIVERED`；**任一步失败则停在 `MERGED`，绝不回退 lifecycle**。

### 11.2 LifecycleState × ApprovalStatus（代码枚举）

```ts
// 与 src/lib/contract.schema / state-machine.ts 一致
LifecycleState =
  DRAFT | PENDING_APPROVAL | PREPARING | EXECUTING | VERIFYING |
  PENDING_RESUME | AUDITED | MERGED | ABORTED;

TERMINAL_STATES = MERGED | ABORTED;
```

| LifecycleState | 唯一合法 ApprovalStatus | 语义 |
| --- | --- | --- |
| `DRAFT` | `DRAFT` | 方案草案，尚未获得施工审批 |
| `PENDING_APPROVAL` | `PENDING_REVIEW` | 等待用户审批 |
| `PREPARING` | `APPROVED` | 创建/恢复 Worktree 与受控环境 |
| `EXECUTING` | `APPROVED` | Worker 持有效 exec token 施工 |
| `VERIFYING` | `APPROVED` | Daemon 验证 / Scope / 指纹 |
| `PENDING_RESUME` | `APPROVED` | 安全挂起 |
| `AUDITED` | `APPROVED` | Evidence 已核验，待合并 |
| `MERGED` | `APPROVED` | 唯一成功运行时终态 |
| `ABORTED` | `REJECTED` 或 `APPROVED` | 拒绝或获批后安全终止 |

### 11.3 允许迁移（与 `LIFECYCLE_TRANSITIONS` 逐字一致）

| From | To |
| --- | --- |
| `DRAFT` | `PENDING_APPROVAL`, `PREPARING`, `ABORTED` |
| `PENDING_APPROVAL` | `PREPARING`, `ABORTED` |
| `PREPARING` | `EXECUTING`, `PENDING_APPROVAL`, `ABORTED` |
| `EXECUTING` | `VERIFYING`, `PENDING_RESUME`, `ABORTED` |
| `VERIFYING` | `AUDITED`, `EXECUTING`, `PENDING_RESUME`, `ABORTED` |
| `PENDING_RESUME` | `EXECUTING`, `PREPARING`, `ABORTED` |
| `AUDITED` | `MERGED`, `EXECUTING`, `VERIFYING`, `ABORTED` |
| `MERGED` | （无） |
| `ABORTED` | （无） |

未列出的边一律禁止（`canTransition` / 附加 Guard 见代码）。`DRAFT → PREPARING` 仅 Fast Path（带 Guard）；**不存在** `DRAFT → EXECUTING`。

### 11.4 升格差异

| # | 草案曾写 | 代码事实 | 本文件处理 |
| --- | --- | --- | --- |
| S1 | 全文标「目标、待测试固化」易被误当未实现 | `LIFECYCLE_TRANSITIONS` 已实现核心边 | §11 升格为代码权威摘要 |
| S2 | 叙事上易把 `DELIVERED` 混入 lifecycle | 仅交付投影 | §11.1 两轨 |
| S3 | 负例/回滚表偏目标测试清单 | 与代码边兼容处保留为实施口径，权威仍是 §11.3 + 代码 | 细节仍可读 Git 历史中的原草案 §4/§5 |

---
