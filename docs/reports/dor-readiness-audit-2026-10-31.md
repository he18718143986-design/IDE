# 任务卡就绪度（DoR）全量审计

> ⚠️ **基线快照声明（2026-11-01 · docs 冗余治理第 0 波）**：本报告仅描述当时 `main` @ `a2fa7df` 的 DoR 判定。**不代表当前排期、不代表今日任务矩阵状态**。后续 L.8～L.10 / J.18 等回写以 [`../specs/development-tasks.md`](../specs/development-tasks.md) §1.1 与 Git tip 为准；DOR-2 / DOR-3 见 [`../ledger/README.md`](../ledger/README.md) `[NEEDS_RECHECK]`（历史技术债，不阻断现行 J/L 链路施工）。


> **日期**：2026-10-31（Asia/Hong_Kong）· **基线**：`main` @ `a2fa7df`（含 PR #27 / J.18d 代码合入；docs 状态回写 PR #28 当时尚未合入）
> **标尺**：[`../specs/task-card-standard.md`](../specs/task-card-standard.md) §1 就绪定义 R-1～R-12。任一条不满足 = 卡未就绪。
> **卡源**：[`../specs/development-tasks.md`](../specs/development-tasks.md) §3.4 及子节详细正文；状态对照 §1.1 矩阵。
> **方法**：枚举全部 `#### 【Task …】` 详细卡；对每张卡做字段完整性核对；对矩阵仍为 `NEW_TASK` 的卡逐条评 R-1～R-12，并对 R-4/R-5 做代码库实质核验（路径存在、`file::symbol` 可检索）；R-3 对照 §1.1；R-9 对照 `docs/adr/` 现行状态；R-10 对照 `scheme.md` §7～§8、`docs/ledger/README.md` 与 consistency-audit 挂账。
> **本报告是 L4 证据层**：只追加陈述。不修改任务卡条款与状态，不改 `task-card-standard.md`。旧抽查 [`delivery-path-audit.md`](./delivery-path-audit.md) §4 仍保留，不被本报告改写。

---

## 0. 结论

1. **可立即按 DoR 开工的活跃卡极少。** 在矩阵仍为 `NEW_TASK` 且具备 §3.4 详细正文的 **14** 张卡中：
   - **READY：1**（`TASK-L.14`，约 **7%**）
   - **NOT_READY：11**（约 **79%**）
   - **无法判定：2**（`TASK-J.18c`、`TASK-J.18d`，约 **14%**——纸面字段接近完整，但代码已在 `main` 而矩阵/卡仍写 NEW_TASK，且卡内「代码事实」已过时）
2. **历史卡不追溯改判施工合法性。** §3.4 详细正文共 **126** 张：其中矩阵 `COMPLETED`/`PASS` **106**、`DEFERRED` **5**、`SPLIT` **1** → 一律记 **N/A**（已施工或明确推迟/母卡），仍记录字段完整性观察。早于 DoR 标准成文的卡系统性缺少「一句话目标 / 代码事实 `file::symbol` / 估算 S·M·L」等字段；**COMPLETED ≠ 当时已满足现行 DoR**。
3. **矩阵有、§3.4 无详细正文** 的条目 **7** 张（`TASK-0.1`、`A.1`～`A.6`）→ **无法判定** DoR（无卡可评）。
4. **与旧抽查的关系**：[`delivery-path-audit.md`](./delivery-path-audit.md) §4 点名样板仍是 **J.2**；本全量审计确认：在**当前仍待开工**集合里，严格 READY 的只有 **L.14**；J.2 本身已 COMPLETED，本报告记 N/A，并确认其字段仍是 DoR 样板形态。
5. **按影响排序的共性缺口**（见 §4）：(1) R-3 前置链未完成导致 L.9～L.13 / L.15～L.17 整串阻断；(2) R-4 对全新建卡缺少 `file::symbol`/`file:line` 锚点；(3) W.5b/W.5c 几乎无 DoR 字段；(4) J.18c/d 文档状态与 `main` 代码事实脱节（DOC 类）；(5) L.17 显式卡在 oq-2 + 估算 L。

### 0.1 计数总表（以本基线为准）

| 集合 | 数量 | 说明 |
| :--- | ---: | :--- |
| §1.1 矩阵行（含无详细正文） | 133 | 含 `0.1`、`A.1`～`A.6` |
| §3.4 详细任务卡正文 | 126 | 本审计「有正文可评」的主集合 |
| 矩阵 `COMPLETED`/`PASS` → **N/A** | 106 | 已施工；字段完整性见 §3 |
| 矩阵 `DEFERRED` → **N/A** | 5 | D.1e、S.3、B.1、B.2、C.4 |
| 矩阵 `SPLIT` → **N/A** | 1 | J.18 母卡 |
| 矩阵 `NEW_TASK`（有正文） | 14 | 本审计重点 |
| └ READY | **1** | L.14 |
| └ NOT_READY | **11** | 见 §2.2 |
| └ 无法判定 | **2** | J.18c、J.18d |
| 矩阵有、无 §3.4 正文 → **无法判定** | 7 | 0.1、A.1～A.6 |

**活跃可开工集合（14）占比**：READY **7%** · NOT_READY **79%** · 无法判定 **14%**。

---

## 1. 覆盖清单

### 1.1 §3.4 详细正文覆盖的 126 张卡（按系列）

| 系列 | 卡号 | 矩阵状态（摘要） |
| :--- | :--- | :--- |
| 0.x | 0.2b、0.2c | COMPLETED |
| D | D.1、D.1b、D.1c、D.1d、D.1e、D.2、D.2b、D.3 | COMPLETED；D.1e DEFERRED |
| S | S.1～S.6 | COMPLETED；S.3 DEFERRED |
| W | W.1、W.2、W.2b、W.3、W.4、W.5a、W.5b、W.5c | 前六 COMPLETED/PASS；**W.5b/W.5c NEW_TASK** |
| C | C.1～C.3、C.4、C.5～C.7、C.8a～c、C.9a～d、C.10a～q、C.11a～e、C.12a～e、C.14a～f、C.15a～d、C.16～C.21 | 多数 COMPLETED；C.4 DEFERRED；C.14f/C.15a/c/d **矩阵 COMPLETED / 卡内仍写 NEW_TASK（DOC-2）** |
| H | H.1～H.8 | COMPLETED |
| J | J.1～J.10、J.18、J.18a～d | J.1～J.10、J.18a/b COMPLETED；J.18 SPLIT；**J.18c/d 矩阵 NEW_TASK** |
| L | L.1～L.17 | L.1～L.7 COMPLETED；**L.8～L.17 NEW_TASK** |
| B | B.1、B.2 | DEFERRED |
| P | P.1 | COMPLETED |
| E | E.1、E.2 | COMPLETED |

### 1.2 矩阵有、§3.4 无详细正文（无法按卡评 DoR）

`TASK-0.1`、`TASK-A.1`、`TASK-A.2`、`TASK-A.3`、`TASK-A.4`、`TASK-A.5`、`TASK-A.6` —— 矩阵均标 COMPLETED，但本文件无 `#### 【Task …】` 正文。**无法判定**其字段是否曾满足 R-1～R-12。

### 1.3 非卡内容（已排除）

版本头状态回写行、游离 `P-xx` 修订行、§3.4c「第二批预告」表（明确「本条不立卡」）、§2 DAG / §4 排期 / §6 修订流水 —— 均不计入任务卡。

---

## 2. 判定方法与诚实边界

### 2.1 判定档

| 档 | 含义 |
| :--- | :--- |
| **READY** | R-1～R-12 全部通过（本基线可核对） |
| **NOT_READY** | 至少一条 R 失败；列出失败编号与原因 |
| **N/A** | 矩阵已 `COMPLETED`/`PASS`（已施工，仅作历史记录）、或 `DEFERRED`/`SPLIT`；仍记录字段完整性观察 |
| **无法判定** | 矩阵与正文/代码事实矛盾，或无详细正文，或已知 DOC-1～DOC-4 导致无法诚实下结论——**不得猜** |

### 2.2 关键核对约定

- **R-3**：只认 §1.1 矩阵状态；`PASS` 视为前置完成。卡内写 NEW_TASK 但矩阵 COMPLETED 时，以矩阵为准记 N/A，并点名 DOC-2。
- **R-4/R-5**：对 NEW_TASK 卡列出的路径做 `exists` 检查；对 `file::symbol` 在目标文件内检索 `function/const/class/type` 导出或等价声明。全新建路径「预期不存在」不算 R-4 失败；**痛点声称「不存在」但文件已在树中** → 代码事实过时，记失败或无法判定。
- **R-4 严格读法**：须出现 `file::symbol` 或 `file:line` 锚点，且锚点文件存在。仅写「无某某逻辑 / 全库 0 命中」而无文件锚点 → **R-4 失败**（对全新建卡偏严；见 §4）。
- **R-9**：`docs/adr/0001`～`0019` 本基线均为 **ACCEPTED**（无 SUPERSEDED 阻断本批活跃卡）。有冲突须有有效「ADR-NNNN 修订」块；无冲突则不要求修订块。
- **R-10**：`scheme.md` conf-1～7 已裁决；OQ-REL-1 / SA-1 / DLV-1 **RESOLVED**；**oq-2** 仍为北极星 BLOCKER；consistency-audit **OP-1** 仍挂（原绑定 J.9；J.9 已 COMPLETED，OP-1 作为残余风险仍在台账，不自动阻断未引用它的卡）。
- **R-12**：仅「触及安全门禁」的卡必须声明；有「不变声明 / 三项不变」或明确不碰鉴权·Demo Origin·点亮三证·网关写范围 → 通过。

### 2.3 已知结构问题（不猜）

| 编号 | 对本审计的影响 |
| :--- | :--- |
| DOC-1 | 文件过大、历史重复 —— 不改变逐卡判定，但增加漏读风险；本审计以 `#### 【Task` 枚举为准 |
| DOC-2 | C.14f、C.15a、C.15c、C.15d：矩阵 COMPLETED、卡内 NEW_TASK → 本报告按矩阵记 **N/A**，并标注「是否仍待施工：无法判定」 |
| DOC-3 | 多处「当前基线」SHA 互斥 —— 本报告只采 git `origin/main` = `a2fa7df` |
| DOC-4 | 失效 archive / 走查引用 —— 溯源节若只指向已删路径，R-1 可能无法核「节号真实存在」；对 NEW_TASK 活跃卡未依赖这些失效链 |

---

## 3. 按系列分组明细

### 3.1 活跃 `NEW_TASK`（14）——逐卡 R-1～R-12

#### READY（1）

| 卡 | 判定 | 要点 |
| :--- | :---: | :--- |
| **L.14 凭据保险库** | **READY** | R-1～R-12 全过。代码事实锚到 `daemon/worker/key-store.ts`、`command-runner.ts::redactSecrets`、`debug-log.ts::redactSecrets`（均存在且符号可检索）。前置 L.6 COMPLETED。OQ-REL-1 在 ledger 为 RESOLVED，卡内另有「采用的默认值」。范围/非目标/PASS/FAIL/估算 M/不变声明齐全。不与 ACCEPTED ADR 冲突。 |

#### 无法判定（2）

| 卡 | 判定 | 原因 |
| :--- | :---: | :--- |
| **J.18c** | **无法判定** | 纸面：溯源、目标、前置 J.18a/b COMPLETED、范围签名、非目标、PASS/FAIL、R-12、估算 M 均较完整。但本基线 **`daemon/guard/worker-graveyard-gate.ts` / `dispatch-binding.ts` 已存在**，且导出 `evaluateGraveyardGate` / `pickPrimaryVerdict` / `buildGatePack` / `verifyDispatchBinding`；`E_PROPOSAL_PREVIOUSLY_REJECTED` 已在 `error-codes.ts`。卡仍写「无 …」且矩阵 NEW_TASK，与 `a2fa7df`（PR #27）代码事实矛盾。**不能诚实说 READY（事实过时），也不能在未回写状态下当历史 N/A。** |
| **J.18d** | **无法判定** | 同上脱节；且 R-3 形式上依赖矩阵仍为 NEW_TASK 的 J.18c。接线目标文件（`ai-worker.ts`、`gateway.ts`、`orchestrator.ts`、`merger.ts`、`pretool-hook.mjs`、`session-task-injector.ts`）均存在。是否还应再施工：**无法判定**（需状态回写/对照 #27 范围后另评）。 |

#### NOT_READY（11）

| 卡 | 失败的 R | 原因（摘要） |
| :--- | :--- | :--- |
| **W.5b** | R-1,R-2,R-4,R-5,R-6,R-7,R-8,R-11,R-12（等） | 正文极短：无对应规格节、无一句话目标、无代码事实锚点、无文件/签名范围、无非目标、PASS/FAIL 仅「同 W.5a」、无估算、无安全门禁声明。前置 W.5a=PASS → R-3 过。 |
| **W.5c** | 同上 | 同上量级缺口；另无容器逃逸负例的可执行断言清单与测试文件名。 |
| **L.8** | **R-4** | 其余条目基本齐全；对照痛点仅「无分解逻辑」，**无 `file::symbol` / `file:line`**。拟建路径 `plan-patch.ts` / `decompose.ts` 今日不存在（符合新建预期）；`daemon/server.ts` 存在但未写入代码事实锚点。R-3：L.7、J.9 COMPLETED。 |
| **L.9** | **R-3**（主）、链上等待 L.8 | 依赖 L.8 仍 NEW_TASK。代码事实：`daemon/core/pid-lock.ts` 存在。拟建 `next-stub.ts` / `stub-view.ts` 不存在。字段其余较完整。 |
| **L.10** | **R-3**；**R-4** | 依赖 L.8/L.9 未完成。痛点无文件锚点。`ActivityBar.tsx`、`daemon-api.ts`、`server.ts` 存在；`ProjectMapPane.tsx` 不存在。 |
| **L.11** | **R-3** | 依赖 L.9 未完成。拟建 design/knowledge 路径今日不存在；`orchestrator.ts` / `session-task-injector.ts` 存在。 |
| **L.12** | **R-3** | 依赖 L.11。R-4 锚点 `daemon/arch/graph.ts::buildDependencyGraph`、`src/lib/scope.ts::matchesAnyPattern` **均 FOUND**。 |
| **L.13** | **R-3** | 依赖 L.9、L.12。`merger.ts`、`MonacoEditorPane.tsx` 存在；`daemon/trace/why.ts` 不存在。 |
| **L.15** | **R-3** | 依赖 L.14（L.14 虽 READY 但矩阵仍 NEW_TASK → 前置未 COMPLETED）。拟建 `daemon/release/*` 等不存在。 |
| **L.16** | **R-3** | 依赖 L.15、L.9。`src/lib/journey/intent-router.ts` 存在。 |
| **L.17** | **R-10、R-11、R-7、R-3** | 卡内自标「未就绪」：`oq-2` 未裁决；估算 **L**（标准禁止 L 卡开工须拆）；PASS 写「oq-2 裁决后补写」。R-4：`ALWAYS_DENY` 含 WebFetch/WebSearch 的陈述与 `claude-code-adapter.ts` 一致。依赖 L.14 矩阵未 COMPLETED。 |

### 3.2 N/A · 已施工（矩阵 COMPLETED/PASS，106）

**原则**：不因现行 DoR 回溯否定已合入工作。下表给字段完整性**启发式 + 抽查**结论。

| 观察 | 说明 |
| :--- | :--- |
| **J.2** | 字段形态仍满足样板（对应规格、一句话目标、代码事实含 `::`、非目标、PASS/FAIL、估算、不变声明）。记 N/A（已施工），并确认可作为写法参照。 |
| **J.3 / J.5 / J.6 / J.7 / J.10** | 含「ADR-0014 修订」块；旧抽查曾标 🟡/❌。本轮**不重开冲突判决**（已 COMPLETED）；修订块存在 → 就 R-9 形式要件而言已补。是否施工期完全按修订块落地：**超出本报告 DoR 范围**（属 DoD/回归，未在本审计重跑）。 |
| **L.1～L.7** | 按新标准撰写痕迹明显；均已 COMPLETED。 |
| **C.14f / C.15a / C.15c / C.15d** | **DOC-2**：矩阵 COMPLETED，卡内标题/状态仍 NEW_TASK。记 N/A（跟矩阵）；「是否仍待施工」→ **无法判定**。附：`BASELINE_PROGRESS` 已在 `src/lib/ipc/frames.ts`，与 C.14f 矩阵 COMPLETED 方向一致，但不足以单独消解正文矛盾。 |
| **早年 C/S/W/D/0.x/H/E/P 等** | 抽查 C.1、S.2、W.1：普遍有 Pass/Fail 口径，但缺现行「一句话目标 / 代码事实 `file::symbol` / 估算 / 非目标」等。系统性缺口见 §4。 |

### 3.3 N/A · DEFERRED（5）与 SPLIT（1）

| 卡 | 状态 | 备注 |
| :--- | :--- | :--- |
| D.1e、S.3、B.1、B.2、C.4 | DEFERRED → v0.2+ | 未进入可开工集合；若未来激活须按现行 DoR 重写 |
| J.18 | SPLIT | 施工以 J.18a～d 为准；母卡不单独开工 |

### 3.4 历史 COMPLETED 中与 ADR 相关的备注（非改判）

旧审计指出 J.3/J.5/J.6/J.7/J.10 曾与 ADR-0014 / DEC-004/005 冲突；卡上已加修订块且矩阵 COMPLETED。本报告**不**把它们重新标为 NOT_READY。若需验证「实现是否遵守修订块」，应另开 DoD/回归审计。

---

## 4. 共性缺口（按影响排序）

| # | 缺口 | 影响面 | 对应 R |
| :---: | :--- | :--- | :---: |
| 1 | **前置链未完成** | L.9→L.13、L.15→L.17 全部被 R-3 挡住；即使字段写全也不能开工。唯一不依赖未完成兄弟卡的活跃卡是 L.8（仅 R-4）与 L.14（READY）与 W.5b/c（字段崩） | R-3 |
| 2 | **R-4 锚点缺失（全新建卡）** | L.8、L.10 等只写「无 X」；Agent 仍可能猜「挂在哪」。严格 DoR 要求 `file::symbol` 或 `file:line` | R-4 |
| 3 | **W.5b / W.5c 低于最低可执行线** | 无范围路径/签名、无独立 PASS 清单、无估算 → 任何 Agent 都会现场发明 | R-1～R-8、R-11… |
| 4 | **J.18c/d 文档与代码脱节** | 矩阵/卡 NEW_TASK vs `main` 已含实现；重复施工或跳过回写都会制造双真相 | R-4 + 状态机（DOC 类） |
| 5 | **L.17 产品未决 + 估算 L** | oq-2 未关；卡自宣未就绪；L 须拆分 | R-10、R-11、R-7 |
| 6 | **历史卡缺现行 DoR 字段** | COMPLETED 大盘缺「估算 / 一句话目标 / 代码事实」——不影响已完工，但妨碍「从历史卡复制写法」 | R-2、R-4、R-11 |
| 7 | **矩阵-only 卡无正文** | 0.1、A.1～A.6 无法做 DoR 举证 | （覆盖缺口） |

---

## 5. 每条 NOT_READY / 无法判定：要补什么才能就绪

| 卡 | 要补的动作 |
| :--- | :--- |
| W.5b | 按模板重写：对应规格节、一句话目标、代码事实（现有 adapter 路径与符号）、范围（新建/修改文件与导出）、非目标、可执行 PASS（测试文件+断言）、FAIL、估算 S/M、安全/隔离不变声明；实测纪律可引用 W.5a 但不可替代本卡断言 |
| W.5c | 同上；补容器挂载/网络策略的负例夹具与 `verified_on` 字段约定 |
| L.8 | 在「对照痛点」补锚点，例如挂接已存在的 `src/lib/project/project-plan.ts`（L.7）或 `daemon/server.ts:line`，写明今日缺 decompose/plan-patch 的调用点 |
| L.9 | 等待 L.8 → COMPLETED；其余字段已接近就绪 |
| L.10 | 等待 L.8/L.9；痛点补中栏现有入口的 `file::symbol`（如 Studio / ActivityBar） |
| L.11 | 等待 L.9 COMPLETED |
| L.12 | 等待 L.11；R-4 已较好 |
| L.13 | 等待 L.9 与 L.12 |
| L.15 | 等待 L.14 状态回写为 COMPLETED（卡内容已较完整） |
| L.16 | 等待 L.15 与 L.9 |
| L.17 | 用户裁决 oq-2；将估算 L 拆成 ≥2 张 ≤M 卡；补写 PASS 断言与范围细化 |
| J.18c | **先做状态/事实对齐**：对照 PR #27 将矩阵与卡状态回写 COMPLETED，或开差分卡描述「文档已过时的剩余工作」。在回写前不要当 NEW_TASK 开工 |
| J.18d | 同 J.18c；并在 J.18c 矩阵 COMPLETED 之后再评 R-3 |

**READY 卡 L.14**：无额外文档补丁即可进入实施队列（仍须遵守仓库施工门禁与 supervisor §10，不在本报告范围）。

---

## 6. 代码实质核验摘录（R-4/R-5）

| 断言（来自卡） | 本基线结果 |
| :--- | :--- |
| L.12 `daemon/arch/graph.ts::buildDependencyGraph` | **FOUND** |
| L.12 `src/lib/scope.ts::matchesAnyPattern` | **FOUND** |
| L.14 `command-runner.ts::redactSecrets` / `debug-log.ts::redactSecrets` | **FOUND** |
| L.14 `daemon/worker/key-store.ts` | 文件存在 |
| L.9 `daemon/core/pid-lock.ts` | 文件存在 |
| L.10 `src/components/layout/ActivityBar.tsx` | 文件存在 |
| L.16 `src/lib/journey/intent-router.ts` | 文件存在 |
| L.17 `ALWAYS_DENY` 含 WebFetch/WebSearch | 与 `claude-code-adapter.ts` 一致 |
| L.8/L.9/… 拟建 `plan-patch.ts`、`decompose.ts`、`next-stub.ts`、`vault.ts`、`release/*` 等 | **今日不存在**（符合新建） |
| J.18c 声称不存在的 `worker-graveyard-gate.ts` / `dispatch-binding.ts` | **已存在**（与卡矛盾） |
| J.18c 符号 `evaluateGraveyardGate` 等 | 已在上述文件导出 |
| C.14f `BASELINE_PROGRESS` | 已在 `src/lib/ipc/frames.ts`（支撑矩阵 COMPLETED 一侧） |

---

## 7. ADR / 未决依赖核对（R-9 / R-10）摘要

| 项 | 状态 | 对活跃卡 |
| :--- | :--- | :--- |
| ADR-0001～0019 | 均为 ACCEPTED | 不因 PROPOSED 阻断；L 系列原先「随 PR 才生效」的担心已解除 |
| conf-1～7 | 已裁决（DEC-001～005 等） | 不阻断 L.8+ |
| OQ-REL-1 / SA-1 / DLV-1 | RESOLVED | L.14 R-10 通过 |
| oq-2（「一模一样」判据） | **仍 OPEN（goal-2 BLOCKER）** | **阻断 L.17** |
| OP-1（occurrence 洗白） | 台账仍挂；原「J.9 前裁定」，J.9 已 COMPLETED | 不自动阻断未引用 OP-1 的 L/W 卡；若未来立 J.11 对抗样例卡须再评 |

---

## 8. 本报告引发的挂账

已在 [`../ledger/README.md`](../ledger/README.md) 追加 **DOR-1～DOR-3**（见该文件「DoR 全量审计挂账」节）。不修改任务卡正文。

---

## 9. 刻意不做的事

- 不改 `development-tasks.md` 任何卡条款或状态
- 不改 `task-card-standard.md`
- 不重写 [`delivery-path-audit.md`](./delivery-path-audit.md)
- 不开工任何 TASK 实现代码
- 不对 COMPLETED 卡做「现在是否还能无脑重做」的重新施工评估

---

## 10. 审计元数据

| 项 | 值 |
| :--- | :--- |
| 仓库 | `he18718143986-design/IDE` |
| 基线 SHA | `a2fa7dfdf678920497fd6cb8d08e1b762ccc7b71` |
| 分支（本报告） | `docs/dor-readiness-audit-2026-10-31` |
| 详细卡枚举数 | 126 |
| 矩阵行数 | 133 |
| 活跃 NEW_TASK 评定数 | 14（READY 1 / NOT_READY 11 / 无法判定 2） |
