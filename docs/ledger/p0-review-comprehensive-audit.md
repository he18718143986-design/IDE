# P0 复审专项总账复核报告（执行链受控与验收依据不可篡改对齐及收敛裁定）

> **地位**：P0 复审专项交付物总账复核记录（纯文档落账，不改产品代码，不新立施工卡）。
> **基线**：`main`@`e28d6110b4f58e86452b18e8516d07669963951f`（[#456](https://github.com/he18718143986-design/IDE/pull/456) P-349 TASK-P0.1a 完工回写合入）。
> **依据**：2026-11-28 Tina 裁定方案 A，指示推进 P0 复审专项总账复核落盘，宣称「P0 复审专项收敛（剩余项挂账）」。
> **诚实口径**：**五条红线边界逐字保留；不得表述为「P0 风险完全解除」或「具备完整合同级权限强制和独立验收能力」；残余风险清册如实挂账**。

---

## 一、两卡交付物 vs 外部复审报告缺口逐条对齐

针对外部复审报告提出的 P0 专项深层缺口，Stagent 治理团队立项并交付了两张复审专项卡（`TASK-P0.1a` 与 `TASK-P0.2a`），对齐事实如下：

| 编号 | 任务卡 / 施工 PR | 外部复审报告缺口核心 | 闭合状态 | 核心代码落点与依据 | 自动化与负向测试验证 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-1A** | [`TASK-P0.1a`](../specs/development-tasks-completed.md#task-p0.1a)<br>PR [#455](https://github.com/he18718143986-design/IDE/pull/455) (`670860eb`)<br>回写 PR [#456](https://github.com/he18718143986-design/IDE/pull/456) (`e28d6110`) | ① 派工至容器真实进程全链路缺乏端到端追踪审计；<br>② `os-sandbox.ts` 网络探测将外部不可达/超时误判为 DENIED，产生假阳性断网证明；<br>③ `writeEvidence` 自动补齐的 `test_integrity` 占位记录与真实重跑记录在 downstream 缺乏区分性，改动测试缺审计时存在漏拦风险。 | **已闭合** | • 全链路追踪证实从 `openhands-adapter` / `container-cli-executor` 经 `runInSandbox` 直达 `DockerContainerHost.run`，真实容器执行拓扑成立；<br>• `daemon/baseline/os-sandbox.ts:86-133`：引入 `ProbeVerdict`（`DENIED`/`UNKNOWN`/`ALLOWED`）三态判定，探测前通过 `checkHostNetworkConnectivity` 宿主连通性交叉校验，超时/不可达一律降级 `UNKNOWN`，`probeDeniedFromOutput` 严格返回 `false`；<br>• `daemon/pipeline/orchestrator.ts:2692-2733`：自动补齐占位显式标记 `failure_reason: "placeholder:unmodified_tests_default"` 与 `baseline_rerun_triggered: false`；改动已有测试却缺显式证据时自动注入 `baseline_rerun_passed: false` 与 `E_TEST_BASELINE_REGRESSION`，fail-closed 拦截；<br>• 专项审计报告落盘 [`docs/ledger/p0-1a-execution-chain-controlled-audit.md`](./p0-1a-execution-chain-controlled-audit.md)。 | • `tests/daemon/baseline-c14e.test.ts:171-205`（网络探测三态降级与交叉校验覆盖）；<br>• `tests/daemon/p0-3a-container-wiring-and-witness.test.ts:511-871`（派工栈追踪、宿主不可用拦截、见证防伪、占位区分与报告落盘五组专项断言全绿）。 |
| **P0-2A** | [`TASK-P0.2a`](../specs/development-tasks-completed.md#task-p0.2a)<br>PR [#452](https://github.com/he18718143986-design/IDE/pull/452) (`b257c22c`)<br>回写 PR [#453](https://github.com/he18718143986-design/IDE/pull/453) (`89d96ff9`) | ① `assertEvidenceTestIntegrity` 中 `if (!ti) return` 存在放行缺口，缺失时被静默绕过；<br>② `evidence.schema.ts` 中 `test_integrity` 为可选；<br>③ 缺乏测试基线引用绑定、修改授权与独立重核的专项审计。 | **已闭合** | • `src/lib/evidence.schema.ts:187-220`：`evidenceBundleSchema.superRefine` 强制受控模式（`GATEWAY_ENFORCED` 与 `SANDBOX_ENFORCED`）必须包含 `test_integrity`，导出 `controlledEvidenceBundleSchema`；<br>• `daemon/pipeline/merger.ts:120-155`：删除放行分支，缺失即拒抛 `MergeGateError("E_CANNOT_MERGE", "Evidence missing required test_integrity record")`；核验 9 项核心字段结构完整性，残缺即拒；<br>• `daemon/pipeline/orchestrator.ts`：受控模式落盘必须包含完整 `test_integrity`；<br>• 专项审计报告落盘 [`docs/ledger/p0-2a-test-integrity-audit-and-tamper-proof.md`](./p0-2a-test-integrity-audit-and-tamper-proof.md)。 | • `tests/daemon/p0-1-evidence-merge-fail-closed.test.ts`（追加 5 例负向断言：缺失、残缺、伪造豁免、未授权修改且重跑未过均阻断）；<br>• `tests/daemon/p0-4-test-integrity-wiring.test.ts`（8 例覆盖合法通过、Schema 拦截、重跑失败与环境故障）。 |

---

## 二、关键技术落点与专项审计成果

### 1. 执行链受控与网络探测三态判据（TASK-P0.1a）
- **真实进程全链路追踪**：系统枚举并复核了从 `openhands-adapter` 至 `DockerContainerHost.run` 的全链路。在 `SANDBOX_ENFORCED` 模式下，派工指令严格限制在隔离容器内执行；当容器宿主不可用或逃生门开启时，系统严格 fail-closed 抛出 `E_ADAPTER_SANDBOX_LOCKED`，严禁回退至本地非受控执行。
- **网络探测三态修证**：针对此前网络探测仅有二态且容易将超时或环境故障误判为规则生效的缺陷，`os-sandbox.ts` 引入 `ProbeVerdict`（`DENIED`/`UNKNOWN`/`ALLOWED`）三态类型，并在执行前通过 `checkHostNetworkConnectivity` 交叉校验宿主网络连通性。仅当宿主连通但沙箱内阻断，或捕获到确定性 `EPERM`/`EACCES` 时才判定为 `DENIED`；宿主不可达或探测超时降级为 `UNKNOWN`，`probeDeniedFromOutput` 严格返回 `false`，彻底消除了假阳性断网证明。
- **占位记录区分性审计与拦截**：`orchestrator.ts` 构建受控 Evidence 时，未修改测试的文件显式标记占位原因 `placeholder:unmodified_tests_default`；改动了已有测试却缺少重跑证据时，强制注入 `baseline_rerun_passed: false` 与 `E_TEST_BASELINE_REGRESSION`，确保下游合并判定严格 fail-closed。

### 2. 验收依据防篡改与完整性强约束（TASK-P0.2a）
- **Schema 必填化强约束**：在 `evidence.schema.ts` 中对受控模式施加强校验，禁止剥离 `test_integrity` 字段。
- **Merger 门禁缺失即拒**：彻底封堵了 `merger.ts` 中的 `if (!ti) return` 历史放行缺口。合并阶段核验 Evidence 快照时，若 `test_integrity` 缺失或 9 项核心字段残缺，一律抛出 `E_CANNOT_MERGE` 阻断合并。
- **测试基线强绑定与修改授权复核**：基线重跑严格绑定合同 `base_branch` / `base_commit_sha`，且仅在合同显式授权 `allow_baseline_test_mutation: true` 时才允许变更测试文件；未授权修改或基线重跑未过直接触发拦截。

---

## 三、残余风险清册与五项架构事实边界（红线保留）

在 P0.1a 与 P0.2a 两张复审专项卡交付核销后，针对系统现状进行全量总账复核，以下五项架构事实边界继续如实挂账，**五条红线边界逐字保留**：

| 序号 | 架构事实边界 | 风险现状与机制界定 | 诚实口径与红线保留说明 |
| :---: | :--- | :--- | :--- |
| **1** | **硬件级 Attestation 缺失** | 当前见证与 Ed25519 签名建立在宿主 Node.js 进程及 Docker daemon 未被攻破的可信根假设下。见证为软件层结构记录，无安全硬件（如 TPM、SGX、Nitro Enclave 等安全飞地）生成的硬件级加密 attestation。 | **红线保留**：见证与签名建立在宿主 Node.js 进程及 Docker daemon 未被攻破的可信根假设下，未实现零信任硬件级证明。 |
| **2** | **Merger 不重跑全量测试** | `merger.ts` 在 `PRE_MERGE` 阶段出于架构分工与时延考虑，仅核验磁盘 Evidence 快照中的测试完整性结构、基线增量重跑结论与 Ed25519 签名，**不再次调用测试运行器重新执行全量测试套件**。 | **红线保留**：PRE_MERGE 仅证据结构审计与基线增量重跑校验，Merger 自身不重跑全量测试。 |
| **3** | **容器内无 OS 级二次沙盒** | 容器文件系统隔离基于 Docker 卷挂载与目录占位机制，容器内部未配置 seccomp、apparmor 严格二次限制配置文件，亦未启用完全只读根文件系统（read-only rootfs）。 | **红线保留**：容器内无 OS 级二次沙盒（无 seccomp/apparmor 严格二次限制或只读根文件系统）。 |
| **4** | **跨进程 Nonce 持久化未做** | `WitnessNonceStore` 当前为 Daemon 进程内内存单例存储。Daemon 进程重启后内存 Nonce 记录重置，缺乏跨进程/跨重启的持久化防重放存储。 | **红线保留**：跨进程 Nonce 持久化未做（内存单例、Daemon 重启重置）。 |
| **5** | **真实容器运行时 3/10 跳过项** | TASK-P1.3 独立动态套件中，在无 Docker 守护进程的宿主/CI 环境下，涉及真实容器挂载与运行时执行的 3 项用例（TC-P0-3A/B/C）依判据如实标记为 `SKIPPED_NO_DOCKER`，降级为 mock 验证，套件裁决为 `PARTIAL`。 | **红线保留**：真实容器运行时 3/10 跳过项（无 Docker 环境降级 mock 验证）。代码交付 ≠ 安全验证通过。 |

---

## 四、收敛口径原文与报审裁决结论

1. **工程闭环事实**：
   - 外部复审报告要求的两张专项审计卡（`TASK-P0.1a` 执行链受控证明专项、`TASK-P0.2a` 验收依据不可篡改专项）均已全面交付、回归验证并通过全量门禁，对应专项审计报告已正式落盘 `docs/ledger/`。
   - 系统在执行链追踪、网络探测三态防伪、占位与重跑区分、Evidence Schema 必填化约束、以及 Merger 缺失即拒门禁上建立了完整闭环。

2. **裁定结论（Tina 批准方案 A）**：
   > **宣称「P0 复审专项收敛（剩余项挂账）」**

3. **统一收敛口径原文**：
   - **「P0 复审专项两卡（P0.1a 执行链受控证明、P0.2a 验收依据不可篡改）已交付核销；五项架构事实边界继续挂账，不构成当前默认可达路径上的活跃利用链」**；
   - **五条红线边界逐字保留**：
     1. 硬件级 Attestation 缺失（见证与签名建立在宿主 Node.js 进程及 Docker daemon 未被攻破的可信根假设下）；
     2. Merger 不重跑全量测试（PRE_MERGE 仅证据结构审计与基线增量重跑校验）；
     3. 容器内无 OS 级二次沙盒（无 seccomp/apparmor 严格二次限制或只读根文件系统）；
     4. 跨进程 Nonce 持久化未做（内存单例、Daemon 重启重置）；
     5. 真实容器运行时 3/10 跳过项（无 Docker 环境降级 mock 验证）。
   - **红线禁令**：**不得**表述为「P0 风险完全解除」或「具备完整合同级权限强制和独立验收能力」。
