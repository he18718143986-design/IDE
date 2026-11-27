# P0 问题闭合状态复核对照报告（机制实现、执行路径闭合与安全保证层级核查）

> **地位**：P0 专项问题与外部复审报告缺口轻量对照复核报告（纯文档落账，仅状态对照，不扩大施工，零产品代码改动）。
> **基线**：`main`@`190d153383aa6db9fa5a6f3b47ef9646a009753f`（[#460](https://github.com/he18718143986-design/IDE/pull/460) P-352 TASK-P0.13 完工回写合入）。
> **依据**：Tina 2026-11-28 校正指令「先核 Scope A 落盘再出对照文档，不立新卡」。
> **审计来源**：外部安全复审报告关于 P0/P1 专项执行隔离、测试完整性、审批冻结与恢复鲁棒性之问题清册。
> **审计边界**：**源码路径审计与自动化测试核验，非真实物理环境运行时认证；五项架构事实边界逐字保留；严禁表述为「P0 风险完全解除」或「具备完整合同级权限强制和独立验收能力」**。

---

## 一、三层级定性判据定义

为防止将源码防御机制误判为环境物理验证，本次对照复核严格区分以下三个技术层级：

1. **机制已实现（Level 1）**：
   - 代码库已具备相应的数据结构、校验函数、架构设计或配置接口，但未完全覆盖全部调用入口，或仅交付方案设计尚未完成生产级工程施工。
2. **执行路径已闭合（Level 2）**：
   - 端到端调用链条已打通，在默认与受控派工/合并调用路径上实现了确定性 fail-closed 拦截与门禁断言，具备覆盖正反向链路的单元/集成测试保护。在既有架构假设成立的前提下，执行路径不存在静默放行漏洞。
3. **安全保证已验证（Level 3）**：
   - 在真实物理生产环境、真实 Docker 守护进程及多平台对抗场景下，经受全量运行时动态测试或硬件级加密认证（Attestation）。
   - **红线声明**：**凡未经真实运行测试、全量环境集成或硬件环境认证的项，一律严禁标为「已验证」**。

---

## 二、六项核心对照与定性清册

针对外部复审报告提出的关键关切与 TASK-P0.13 四大 Scope，逐项对照如下：

| 序号 | 对照项与关注点 | 关联任务卡 / 交付 commit | 定性层级 | 核心代码落点与证据引用 | 现状与残余边界界定 |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **P0-1 执行隔离**<br>（Worker 容器文件系统隔离、Scope 约束与沙箱执行链） | [`TASK-P0.3b-1`](../specs/development-tasks-completed.md#task-p0.3b-1) (#432/`dec17e1`)<br>[`TASK-P0.3b-2`](../specs/development-tasks-completed.md#task-p0.3b-2) (#434/`b8a2e5d`)<br>[`TASK-P0.1a`](../specs/development-tasks-completed.md#task-p0.1a) (#455/`670860e`)<br>[`TASK-P1.4`](../specs/development-tasks-completed.md#task-p1.4) (#449/`5901714`) | **执行路径已闭合**<br>（基本闭合） | • `daemon/runner/container-cli-executor.ts`：工作树严格绑定容器卷，非受控目录通过只读占位隔离；<br>• `daemon/baseline/os-sandbox.ts:86-133`：网络探测三态修证（`DENIED`/`UNKNOWN`/`ALLOWED`）消除假阳性断网证明；<br>• `daemon/pipeline/orchestrator.ts`：受控模式下 `HOST_UNAVAILABLE` fail-closed 抛 `E_ADAPTER_SANDBOX_LOCKED` 阻断；<br>• `src/lib/redact.ts`：Gateway 凭据值级脱敏与 Nonce 防重放绑定。 | **基本闭合，边界保留**：<br>在有 Docker 环境且配置受控模式下执行链已闭合；但无 Docker 宿主环境下 3/10 测试跳过（`SKIPPED_NO_DOCKER`），容器内无 OS 级二次沙盒（seccomp/apparmor），不标为 Level 3「已验证」。 |
| **2** | **P0-2 测试完整性核心机制**<br>（测试篡改拦截、基线独立重跑与 Evidence 强绑定） | [`TASK-P0.4`](../specs/development-tasks-completed.md#task-p0.4) (#426/`191779e`)<br>[`TASK-P0.2a`](../specs/development-tasks-completed.md#task-p0.2a) (#452/`b257c22c`) | **执行路径已闭合**<br>（核心机制闭合） | • `src/lib/evidence.schema.ts:187-220`：受控 Evidence 强制必填 `test_integrity`；<br>• `daemon/pipeline/merger.ts:120-155`：封堵 `if (!ti) return` 放行缺口，缺失或 9 核心字段残缺一律抛 `E_CANNOT_MERGE`；<br>• `daemon/guard/test-integrity.ts`：纯函数化测试差异识别，隔离 Worker 新增测试、还原修改/删除测试；<br>• `daemon/pipeline/orchestrator.ts`：基线重跑未过抛 `E_TEST_BASELINE_REGRESSION`，环境故障抛 `E_TEST_BASELINE_UNAVAILABLE`。 | **核心机制闭合**：<br>变动已有测试默认 fail-closed，未获豁免或重跑未过严禁合入；Merger 基于磁盘快照独立核验 Ed25519 签名；但 Merger 自身出于时延考量不重跑全量测试套件（仅增量基线校验）。 |
| **3** | **Scope A 审批冻结**<br>（`verification_spec.commands` 审批锁定与 revision 约束） | [`TASK-P0.13`](../specs/development-tasks-completed.md#task-p0.13) Scope A<br>(#459/`6122e347`<br>回写 P-352/#460) | **执行路径已闭合**<br>（已闭合 / 机制已满足） | • **直接引用原始落盘审计报告** [`docs/ledger/p0-13-baseline-acceptance-independence-and-recovery.md`](./p0-13-baseline-acceptance-independence-and-recovery.md) 第 23–71 行：<br>① `src/lib/contract.schema.ts:33-43` `bumpContractRevision` 确保任何规范变更强制单调递增 `contract_revision`，清空 `approved_revision` 并重置审批为 `PENDING_REVIEW`（L44）；<br>② `daemon/pipeline/orchestrator.ts:48-56` 批准时锁定 `approved_revision`，`executeBaselineRerun` 严格以快照 `verification_spec.commands` 驱动执行；<br>③ `daemon/pipeline/merger.ts:59-67` 独立门禁核验 `snapshot.contract_revision !== expectedRevision` 抛 `E_EVIDENCE_REVISION_MISMATCH`；<br>④ 集成测试 `tests/daemon/p0-4-test-integrity-wiring.test.ts` `P013-W4` 验证通过（专项报告 L220）。 | **已闭合**：<br>全链路源码路径审计证实审批快照、合同 revision 与基线重跑命令强绑定闭环，篡改命令必然导致审批失效或 revision 错配拒合。 |
| **4** | **Scope D 恢复失败**<br>（现场恢复失败 fail-closed 强拦截） | [`TASK-P0.13`](../specs/development-tasks-completed.md#task-p0.13) Scope D<br>(#459/`6122e347`) | **执行路径已闭合**<br>（已修证 fail-closed） | • `daemon/guard/test-integrity.ts:335-364`：引入 `RecoveryOperationFailure` 与 `TestBaselineRecoveryError` 结构化异常；<br>• `daemon/guard/test-integrity.ts:366-558`：`restoreBaselineTestFiles` 与 `hideWorkerAddedTests` 逐文件显式记录操作结果与失败诊断，严禁吞错；<br>• `daemon/guard/test-integrity.ts:779-808`：`finally` 清理阶段若出现恢复错误，强制覆盖重跑结果为 `passed: false` + `E_TEST_BASELINE_UNAVAILABLE`；<br>• `daemon/pipeline/orchestrator.ts:1357-1385`：异常降级为 `UNSAFE_EXECUTION` + `BLOCKED`；<br>• `daemon/pipeline/merger.ts:235-265`：门禁多维拦截。 | **已修证**：<br>彻底消除清理失败被误判为成功的隐患，恢复失败必定 fail-closed 阻断合入。测试用例 `P013-U6`、`P013-W3`、`P013-I1` 验证通过。 |
| **5** | **Scope B 测试资产登记**<br>（测试资产基线登记方案） | [`TASK-P0.13`](../specs/development-tasks-completed.md#task-p0.13) Scope B<br>(#459/`6122e347`) | **机制已实现**<br>（设计已出，施工待立卡） | • **架构设计报告落盘**：见 [`docs/ledger/p0-13-baseline-acceptance-independence-and-recovery.md`](./p0-13-baseline-acceptance-independence-and-recovery.md) 第三章《测试资产基线登记方案与扩展架构设计》；<br>• 明确测试配置文件（`vitest.config.ts`, `tsconfig.json`）、测试夹具（`fixtures/**`）、共享 helper 等关键资产与 Base Commit 的指纹绑定机制；<br>• 规划未登记资产分类器扩展与渐进演进路线。 | **设计先行，施工待立卡**：<br>架构方案已就绪，当前保持现有分类器最小职责，本卡零代码施工；待后续根据工程排期单独点名立卡施工。不提前越权施工。 |
| **6** | **Scope C 执行器独立性**<br>（共享风险评估与最小修补） | [`TASK-P0.13`](../specs/development-tasks-completed.md#task-p0.13) Scope C<br>(#459/`6122e347`) | **机制已实现 / 最小修补已交付**<br>（残余挂账） | • **风险评估报告落盘**：见 [`docs/ledger/p0-13-baseline-acceptance-independence-and-recovery.md`](./p0-13-baseline-acceptance-independence-and-recovery.md) 第四章；<br>• 深度剖析了候选 Worktree、`node_modules` 依赖、环境变量与外部工具链四类共享威胁边界；<br>• **最小修补落地**：`daemon/guard/test-integrity.ts:742-760` 封堵严重漏洞——当存在测试修改但过滤后可用测试命令数为 0 时，严禁放行，强制置为 `passed: false` + `E_TEST_BASELINE_UNAVAILABLE`（测试 `P013-U7` / `P013-I2` 验证通过）。 | **最小修补闭环，残余挂账**：<br>已修补零命令漏洞；但基线重跑仍与宿主共享部分执行上下文，构建完全物理隔离的独立执行器未在本阶段施工，如实挂账。 |

---

## 三、Scope A 专项审计落盘核查结论

本核查确认：**TASK-P0.13 Scope A 并非未落盘，其原始审计记录已随 PR [#459](https://github.com/he18718143986-design/IDE/pull/459)（commit `6122e347abc6d360e4f15c1238fdd6ec9f8f92c7`）正式合入 main，落盘于 [`docs/ledger/p0-13-baseline-acceptance-independence-and-recovery.md`](./p0-13-baseline-acceptance-independence-and-recovery.md) 第二章**。

经逐项直读原文核对，四项判据完整闭环，行号与源码证据摘录如下：

1. **判据 1：是否含在审批快照**
   - 源码位置：`src/lib/contract.schema.ts`、专项报告第 28–30 行。
   - 证据摘录：合同草案由 `createContractDraft` 生成，包含必须字段 `verification_spec.commands`，每条命令定义别名、可执行程序、参数、期望退出码与超时限制，合同审批时快照完整捕获该字段。
2. **判据 2：revision 是否覆盖变更**
   - 源码位置：`src/lib/contract.schema.ts:33-43`、专项报告第 31–44 行。
   - 证据摘录：`bumpContractRevision` 纯函数在规范变更时单调递增 `contract_revision`，并将审批状态重置为 `PENDING_REVIEW`，同时清空 `approved_revision`。任何规范修改必然使原审批直接失效。
3. **判据 3：审批后变更是否强制重审**
   - 源码位置：`daemon/pipeline/orchestrator.ts:48-56`、专项报告第 45–56 行。
   - 证据摘录：编排器审批入口显式记录 `approved_revision: current.contract_revision`；执行入口严格要求合同处于有效审批态；任何合同更新导致 revision 变化后，未经再次显式批准无法进入执行阶段。
4. **判据 4：Baseline Rerun 是否执行已批准版本**
   - 源码位置：`daemon/pipeline/orchestrator.ts`、专项报告第 56 行。
   - 证据摘录：`executeBaselineRerun` 显式以 `current.verification_spec.commands` 作为输入，使用当前审批锁定的命令规范，不接受 Worker 动态修改的命令列表。
5. **判据 5（Evidence 是否绑定实际执行计划）及合并门禁**
   - 源码位置：`daemon/pipeline/merger.ts:59-67`、专项报告第 57–67 行。
   - 证据摘录：`assertEvidenceControlAndRevision` 严格比对 `snapshot.contract_revision !== expectedRevision`，错配则抛出 `E_EVIDENCE_REVISION_MISMATCH` 阻断合并；集成测试 `tests/daemon/p0-4-test-integrity-wiring.test.ts` 中的用例 `P013-W4` 验证通过（报告第 220 行）。

---

## 四、五项架构事实边界（红线逐字保留）

本对照报告重申，尽管在源码执行链路上已构建多重防御与门禁拦截，但系统仍受制于以下五项客观架构边界，**五条红线逐字保留**：

1. **硬件级 Attestation 缺失**：见证与签名建立在宿主 Node.js 进程及 Docker daemon 未被攻破的可信根假设下，未实现零信任硬件级证明。
2. **Merger 不重跑全量测试**：PRE_MERGE 阶段仅做证据结构审计与基线增量重跑校验，Merger 自身不重跑全量测试。
3. **容器内无 OS 级二次沙盒**：容器文件系统隔离基于 Docker 卷挂载与目录占位机制，容器内部未启用 seccomp/apparmor 严格二次限制或只读根文件系统。
4. **跨进程 Nonce 持久化未做**：`WitnessNonceStore` 为内存单例，Daemon 进程重启后重置，缺乏跨进程/跨重启的持久化防重放存储。
5. **真实容器运行时 3/10 跳过项**：在无 Docker 守护进程的环境下，涉及真实容器挂载与运行时执行的 3 项用例标记为 `SKIPPED_NO_DOCKER`，降级为 mock 验证。代码交付 ≠ 安全验证通过。

---

## 五、结论与后续边界

1. **对照定性**：P0 专项针对外部复审报告的各项深层缺口在机制实现与默认执行路径上已完成闭合或已出完备设计；Scope A 审批冻结审计已在 #459 专项报告中完整落盘；Scope D 现场恢复失败已修证 fail-closed。
2. **施工边界**：Scope B（测试资产登记施工）与 Scope C（独立验收执行器）不擅自拆卡、不提前施工，待后续根据工程需求另行点名立卡。
3. **诚实声明**：本报告为源码控制路径审计对照，**严禁宣称「P0 风险完全解除」**，统一口径维持「专项收敛，剩余项挂账」。
