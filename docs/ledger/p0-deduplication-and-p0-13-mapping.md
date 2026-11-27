# P0.5–P0.12 去重对照表与 TASK-P0.13 架构映射报告

> **地位**：P0 系列复审建议去重分析与 `TASK-P0.13` 立卡映射落盘记录（纯文档落盘，不改产品代码，立卡 ≠ 开工）。
> **基线**：`main`@`0d72029e9a0932969906d5193e7c52c3f9ab2a8c`（[#457](https://github.com/he18718143986-design/IDE/pull/457) P-350 P0 复审专项总账复核与专项收敛落账合入）。
> **依据**：2026-11-28 Tina 明确指令「按此口径点名立卡 TASK-P0.13（Baseline Acceptance Independence & Recovery Hardening，估算 M，P0，Audit + Conditional Fix 型），对照落盘随卡交付，在卡面交付物中登记 P0.5–P0.12 去重对照表」。
> **卡面原则（逐字遵守）**：**不重复实施已交付的容器执行闭环（P0.3b-2 #434）、Sandbox Witness 强绑定（P1.4 #449）、OS Sandbox 三态门禁与全路径派工审计（P0.1a #455）**。
> **审批边界（逐字保留）**：**非代码施工授权、非代码合并批准、非 P0 风险解除声明；立卡 ≠ 开工；实际代码施工须等待 Tina 单卡点名授权；残余架构红线逐字保留，不得表述为「P0 风险完全解除」或「具备完整合同级权限强制和独立验收能力」**。

---

## 一、P0.5–P0.12 去重分析与既有交付对齐

针对外部复审与架构演进建议中提及的 P0.5～P0.12 事项，Stagent 治理团队进行了严格的工程去重审计与现状对齐：

| 原始编号 | 事项核心内容 | 去重核查结论 | 对应已交付 PR / 任务卡 / 归宿 | 处理决策 |
| :--- | :--- | :--- | :--- | :--- |
| **P0.5** | 容器文件系统 Scope 强制挂载与写权限限制 | **已闭合交付**，不重复立卡 | • [`TASK-P0.3b-1`](../specs/development-tasks-completed.md#task-p0.3b-1)（[#432](https://github.com/he18718143986-design/IDE/pull/432)/`dec17e1`）：挂载规格纯函数、合法性校验与宿主占位；<br>• [`TASK-P0.3b-2`](../specs/development-tasks-completed.md#task-p0.3b-2)（[#434](https://github.com/he18718143986-design/IDE/pull/434)/`0a92eb7`）：容器文件系统 Scope 强制挂载执行接入、两阶段挂载、见证增强与真实容器负向测试；<br>• [`TASK-P0.1a`](../specs/development-tasks-completed.md#task-p0.1a)（[#455](https://github.com/he18718143986-design/IDE/pull/455)/`670860eb`）：派工入箱全链路调用栈证实。 | **去重核销**：不重复立卡。 |
| **P0.6** | Gateway 凭据脱敏与 SandboxWitness 强绑定 | **已闭合交付**，不重复立卡 | • [`TASK-P1.4`](../specs/development-tasks-completed.md#task-p1.4)（[#449](https://github.com/he18718143986-design/IDE/pull/449)/`5901714f`）：递归值级敏感凭据脱敏、256-bit CSPRNG Nonce 绑定会话与工作树、merger 单次原子消费防重放、Ed25519 签名全覆盖。 | **去重核销**：不重复立卡。 |
| **P0.7** | OS Sandbox 三态门禁与假阳性探测修证 | **已闭合交付**，不重复立卡 | • [`TASK-P0.1a`](../specs/development-tasks-completed.md#task-p0.1a)（[#455](https://github.com/he18718143986-design/IDE/pull/455)/`670860eb`）：`daemon/baseline/os-sandbox.ts` 引入 `ProbeVerdict`（`DENIED`/`UNKNOWN`/`ALLOWED`）三态判定，探测前引入宿主连通性交叉校验，超时/不可达降级 `UNKNOWN`，`probeDeniedFromOutput` 严格返回 `false`。 | **去重核销**：不重复立卡。 |
| **P0.8** | 受控派工全链路追踪审计与异常路径覆盖 | **已闭合交付**，不重复立卡 | • [`TASK-P0.1a`](../specs/development-tasks-completed.md#task-p0.1a)（[#455](https://github.com/he18718143986-design/IDE/pull/455)/`670860eb`）：系统枚举所有 `SANDBOX_ENFORCED` 入口，确认 `HOST_UNAVAILABLE` fail-closed 拦截，产出专项报告 [`docs/ledger/p0-1a-execution-chain-controlled-audit.md`](./p0-1a-execution-chain-controlled-audit.md)。 | **去重核销**：不重复立卡。 |
| **P0.9** | 验收命令审批冻结与 revision 全链路约束 | **未闭合，纳入本卡** | 纳入 [`TASK-P0.13`](../specs/development-tasks-active.md#task-p0.13) **Scope A**。 | **纳入 TASK-P0.13 Scope A** |
| **P0.10** | 测试资产基线登记方案（配置/helper/fixture/入口识别） | **未闭合，纳入本卡** | 纳入 [`TASK-P0.13`](../specs/development-tasks-active.md#task-p0.13) **Scope B（设计先行）**。 | **纳入 TASK-P0.13 Scope B** |
| **P0.11** | executeBaselineRerun 与候选执行环境共享风险评估 | **未闭合，纳入本卡** | 纳入 [`TASK-P0.13`](../specs/development-tasks-active.md#task-p0.13) **Scope C（评估+最小修证）**。 | **纳入 TASK-P0.13 Scope C** |
| **P0.12** | hideWorkerAddedTests / restoreBaselineTestFiles 恢复失败 fail-closed | **未闭合，纳入本卡** | 纳入 [`TASK-P0.13`](../specs/development-tasks-active.md#task-p0.13) **Scope D（明确修证项）**。 | **纳入 TASK-P0.13 Scope D** |

---

## 二、TASK-P0.13 架构映射与范围分解

`TASK-P0.13` 统一收敛 P0.9～P0.12 四项未决议题，定性为 **Audit + Conditional Fix** 型，范围清晰划分如下：

### 1. Scope A（审计+条件修证）：验收命令审批冻结与 revision 约束
- **核心核实目标**：`verification_spec.commands` 从 Contract / 审批快照 / revision 到 `executeBaselineRerun` 全链路核实：
  - 是否包含在审批快照中；
  - revision 是否覆盖其变更；
  - 审批后变更是否强制重审；
  - Baseline Rerun 是否严格执行已批准版本；
  - Evidence 是否绑定实际执行计划。
- **处置原则**：若全链路核查已满足上述约束，则记录代码证据与用例依据，不进行代码改动；若存在断链或未冻结缺陷，则按最小侵入原则进行条件修证。

### 2. Scope B（设计先行，不施工）：测试资产基线登记方案
- **核心设计目标**：针对仅基于文件名分类的局限性，制定系统化的测试资产基线登记方案：
  - 测试文件、配置文件、helper、fixture 以及动态加载入口的全面识别；
  - 与 Base Commit 强绑定机制；
  - 未登记测试资产检测；
  - 测试资产增删改豁免审计记录；
  - 与现有 `daemon/guard/test-integrity.ts` 的兼容性与演进路径。
- **处置原则**：本卡仅交付架构设计与实施建议文档，不扩大现有分类器职责，本阶段不进行代码施工。

### 3. Scope C（评估+最小修证）：执行环境共享风险分析
- **核心评估目标**：`executeBaselineRerun` 与候选执行环境共享风险评估：
  - `runCommand` 执行器与配置依赖；
  - 候选 Worktree 对执行环境的影响；
  - 依赖、环境变量与工具链的可控性；
  - 独立验收执行器的可行架构与演进路线。
- **处置原则**：交付风险分析与隔离边界报告；仅对可直接确认且明确影响合并安全的漏洞做最小修补。

### 4. Scope D（明确修证项）：工作树恢复失败 fail-closed 强拦截
- **核心修证目标**：加固 `daemon/guard/test-integrity.ts` 中 `hideWorkerAddedTests` 与 `restoreBaselineTestFiles` 的异常处理：
  - 每个恢复与重命名操作显式检查执行结果；
  - 单个文件恢复失败严禁静默忽略；
  - 部分失败时保留完整的可诊断记录；
  - 恢复失败产生明确错误状态，且不得视为基线重跑成功（不得产生 false green）；
  - 恢复失败在 Evidence 与 Merge Gate 中必须严格阻断合并；
  - 验证失败、操作异常与部分成功均严格 fail-closed。
- **处置原则**：最小改动加固恢复判定与状态穿透，不进行扩大重构。

### 5. 交付物与详细专项报告链接
- 完整落地报告详见 [`docs/ledger/p0-13-baseline-acceptance-independence-and-recovery.md`](./p0-13-baseline-acceptance-independence-and-recovery.md)；
- 包含四大 Scope 的审计证据、设计方案、风险评估与代码/测试修证记录。

---

## 三、审批边界与诚实口径

1. **审批边界**：
   - 本报告与关联任务卡 `TASK-P0.13` 为纯文档立卡（`status: NEW_TASK`）；
   - **立卡 ≠ 开工**，非代码施工授权、非代码合并批准；
   - 代码改动必须严格限制在授权的 `writable_paths` 范围内；
   - 范围外问题单独提后续卡，不擅自扩大施工范围。
2. **诚实口径**：
   - 本卡立卡与交付均**不得宣称 P0 风险完全解除**；
   - 硬件级 Attestation 缺失、Merger 不重跑全量测试、容器内无 OS 级二次沙盒、跨进程 Nonce 持久化未做、真实容器运行时 3/10 跳过项等五项事实边界继续保留；
   - 严禁表述为「具备完整合同级权限强制和独立验收能力」。
