# P0 专项实施线总账复核报告（P0.1～P0.4 对齐深审与剩余风险清册）

> **地位**：P0 专项交付物总账复核记录（纯文档落账，不改产品代码，不新立施工卡）。
> **基线**：`main`@`166b2ed476da37e2125c63b032e7793265d1e2b1`（[#427](https://github.com/he18718143986-design/IDE/pull/427) P-330 TASK-P0.4 完工回写合入）。
> **依据**：2026-11-26 Tina 授权合并 #427 并指示推进 P0 线总账复核（四卡交付物 vs 深审缺口逐条对齐 + 剩余风险清册）。
> **诚实口径**：**复核期间与本报告交付后均不宣称 P0 风险解除；四项剩余风险如实挂账；是否宣称「P0 专项收敛」或继续挂账留待审批方 Tina 终审裁定**。

---

## 一、四卡交付物 vs 原深审报告 P0-1～P0-4 缺口逐条对齐

| 编号 | 任务卡 / 施工 PR | 原深审报告缺口核心 | 闭合状态 | 核心代码落点与依据 | 自动化与负向测试验证 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-1** | [`TASK-P0.1`](../specs/development-tasks-completed.md#task-p0.1)<br>PR [#418](https://github.com/he18718143986-design/IDE/pull/418) (`dc225a0`) | ① `deriveCanMerge` 无控制模式入参，只看 `status` 等指标；<br>② `merger.ts` 仅看证据 `can_merge`，不重核控制模式与合同版本；<br>③ 证据未写 `contract_revision`，版本过时或造假可被放行。 | **已闭合** | • `src/lib/evidence.schema.ts:285-350`：`deriveCanMerge` 增加 `workerControlMode` 与 `contractRevision` 强校验；<br>• `daemon/pipeline/orchestrator.ts:2518-2535`：证据构造必填 `contract_revision` 与 `worker_control_mode`；<br>• `daemon/pipeline/merger.ts:153-205`：`assertEvidenceControlAndRevision` 从磁盘快照独立核验两字段；<br>• `daemon/pipeline/merger.ts:210-245`：`assertCandidateCommitBound` 强校验候选分支 tip 与证据一致；<br>• `src/lib/error-codes.ts` & §8.1 登记 `E_EVIDENCE_REVISION_MISMATCH`。 | • `tests/unit/evidence-schema-v11.test.ts`（入参及派生断言）；<br>• `tests/daemon/p0-1-evidence-merge-fail-closed.test.ts`（13 例端到端：伪造控制模式、缺失版本、版本不符、候选提交移走均 fail-closed 阻断，反证已通过）。 |
| **P0-2** | [`TASK-P0.2`](../specs/development-tasks-completed.md#task-p0.2)<br>PR [#420](https://github.com/he18718143986-design/IDE/pull/420) (`bf8d3b9`) | ① Scope 守卫仅解析 `??`（未跟踪文件）；<br>② 已跟踪文件的越权修改、删除、重命名无法被拦截；<br>③ 已提交进分支的越权改动在 `PRE_MERGE` 逃逸。 | **已闭合** | • `daemon/pipeline/candidate-scope-audit.ts:1-350`：全量候选变更统一审计函数，覆盖 `git status --porcelain -uall` 全状态（`M`/`A`/`D`/`R`/`C`/`T`/`U`/`??`）与分支 diff；<br>• `daemon/pipeline/untracked-scope-guard.ts`：统一委托底层 candidate-scope-audit；<br>• `orchestrator.ts`（PRE_EXECUTION / POST_VERIFICATION）与 `merger.ts`（PRE_MERGE）三检测点同一函数、同一判定；<br>• rename 选 A 拍板（新旧路径均审），Delete 审原路径，symlink/submodule 单独标记；<br>• `merger.ts:635-670` 保留 `git diff --name-status -M base...HEAD` 分支 diff 最终复核。 | • `tests/unit/candidate-scope-audit.test.ts`（14 例：覆盖修改/删除/rename/特殊条目/特殊字符）；<br>• `tests/daemon/p0-2-pre-merge-branch-audit.test.ts`（8 例：提交进分支的越权改动在合并前被拦截阻断）；<br>• `tests/unit/untracked-scope-guard.test.ts` 保持 21/21 零回归。 |
| **P0-3** | [`TASK-P0.3a`](../specs/development-tasks-completed.md#task-p0.3a)<br>PR [#424](https://github.com/he18718143986-design/IDE/pull/424) (`5de16ebe`)<br>（P0-3b 挂账） | ① 生产 Daemon 未装配容器宿主，`SANDBOX_ENFORCED` 派工抛 `E_ADAPTER_SANDBOX_LOCKED` 死结；<br>② `SandboxWitness` 仅内存驻留未落盘进证据；<br>③ 控制模式仅看字符串，无深层断言与真实性校验；<br>④ 容器内缺乏文件系统 Scope 强制隔离（挂账）。 | **部分闭合**<br>（P0.3a 已交付；P0-3b 仍开口挂账） | • `daemon/server.ts:639-650`：构造 ContractOrchestrator 注入 `DockerContainerHost`（环境可用时启用）；<br>• `STAGENT_DISABLE_CONTAINER=1` 运维逃生门落 WARNING 且 Evidence 如实记档 `UNCONTROLLED_EXTERNAL`，严禁冒认；<br>• `src/lib/evidence.schema.ts:187-210`：增加可选 `sandbox_witness` 结构并原子落盘；<br>• `daemon/worker/sandbox/container-host.ts:320-410`：`verifySandboxWitness` 严格断言 `via === "exit"`（排除 timeout/rejected/SIGKILL 冒认受控）、工作树规范化路径严格匹配合同根、`host_kind` 有效已知类型，`exit_code` 只记不断言；<br>• 生成时（`deriveCanMerge`）与合并时（`merger.ts`）双重强制校验见证。 | • `tests/unit/container-host.test.ts`（10 例见证断言）；<br>• `tests/daemon/p0-3a-container-wiring-fail-closed.test.ts`（5 例端到端容器装配与见证门禁，双重拦截伪造见证与非法退出状态）。 |
| **P0-4** | [`TASK-P0.4`](../specs/development-tasks-completed.md#task-p0.4)<br>PR [#426](https://github.com/he18718143986-design/IDE/pull/426) (`191779e0`) | ① 验收命令在 Worker 工作树执行，Worker 可篡改/删除既有测试文件制造 False Green；<br>② 既有实现仅写 `Stagent-Tests-Modified` trailer，不阻断合并；<br>③ merger 未独立核验测试完整性。 | **部分闭合 / 主体闭合**<br>（重跑防护闭合；merger 不重跑测试边界保留） | • `daemon/guard/test-integrity.ts:163-450`：纯函数化 `classifyTouchedTestPaths` 准确识别改动；<br>• `restoreBaselineTestFiles` 仅将被改/删测试还原至 baseRef；<br>• `hideWorkerAddedTests` 隔离 Worker 新增测试（重命名 `.stagent-p04-added.bak`），确保新增测试不参与基线重跑；<br>• `executeBaselineRerun` 触发基线重跑：命令超时/缺失 fail-closed 抛 `E_TEST_BASELINE_UNAVAILABLE`，测试回归抛 `E_TEST_BASELINE_REGRESSION`；<br>• `src/lib/contract.schema.ts` 新增 `allow_baseline_test_mutation` 显式豁免并在 Evidence `test_integrity` 留痕；<br>• `daemon/pipeline/merger.ts:118-152`：`assertEvidenceTestIntegrity` 独立核验磁盘快照与豁免。 | • `tests/unit/test-integrity-guard.test.ts`（15 例：分类、还原、隔离与判定）；<br>• `tests/daemon/p0-4-test-integrity-fail-closed.test.ts`（6 例全链路：弱化断言被拒、删除测试还原重跑被拒、环境故障阻断、豁免审计放行、merger 独立拦截、纯新增测试零回归放行）。 |

---

## 二、剩余风险清单（逐条深入分析与边界界定）

经过 P0 四卡施工，系统在控制模式封锁、合同版本重核、全量候选变更 Scope 审计、生产容器装配与见证链校验、以及测试完整性基线隔离重跑等关键环节建立了确定性的 fail-closed 防线。然而，依据深审标准，仍存在以下四项已知边界与残留风险：

### 1. P0-3b 容器文件系统 Scope 强制挂载挂账（估算 L · 仍开口）
- **现状机制**：当前 `DockerContainerHost` 在装配与启动容器时，将工作树以单一卷挂载（bind mount）挂入容器；容器内部并未按合同 `writable_paths` 建立操作系统级或命名空间级的只读文件系统映射。
- **潜在风险**：如果 Worker 容器逃离 MCP Gateway 约束（如直接在容器内派生子进程或执行 shell 写操作），容器文件系统本身不会主动拒绝写入工作树中的只读路径。
- **补偿防线**：依赖宿主侧的三道防线：（a）MCP Gateway 逐请求路径鉴权；（b）`POST_VERIFICATION` 阶段工作树全量 Git 变更审计；（c）`PRE_MERGE` 阶段 `git diff --name-status base...HEAD` 分支差异审计。即使容器内发生越权写入，合并门禁依然会严格 fail-closed 阻断，但未能实现「容器内写不进去」。
- **治理处置**：继续按 L 级挂账待评估，不列入当前已闭合范围。

### 2. SandboxWitness 深层验证的边界（已知架构边界）
- **现状机制**：`verifySandboxWitness` 严格断言了 `via === "exit"`（排除了 timeout、rejected、SIGKILL 等异常退出的冒认）、规范化工作树路径严格一致、有效已知 `host_kind`（如 `docker`）；`exit_code` 只记不断言（由外层命令检验）。
- **潜在风险**：见证数据由宿主进程在 Worker 容器进程退出后收集并组装写入磁盘证据。见证的信任根建立在「宿主 Node.js 进程及 Docker daemon 未被攻破」的前提下；它不具备硬件级密码学 attestation（如 SGX/Nitro Enclave 远程签名）。
- **治理处置**：确立「SandboxWitness 是宿主可信上下文下的容器执行生命周期见证，非零信任密码学证明」的架构认知。

### 3. `GATEWAY_ENFORCED`/`SANDBOX_ENFORCED` 字符串不构成真实性证明的残留语义
- **现状机制**：在 `worker_control_mode === "GATEWAY_ENFORCED"` 下，Worker 在宿主本地运行，依赖 Gateway 进行工具与路径守卫；在 `SANDBOX_ENFORCED` 下，容器装配与见证链生效。
- **潜在风险**：`GATEWAY_ENFORCED` 本质上是证据记档字段，表明派工时协商的执行模式。若 Worker 具有直接宿主执行能力（非通过受控工具调用），则本地进程本身不受操作系统沙箱拘束。
- **治理处置**：在合同与设计规格中继续严格贯彻「控制模式字符串是审计记档，不构成隔离真实性证明」；在无容器见证的情况下，`GATEWAY_ENFORCED` 仅代表网关守卫档位。

### 4. 独立验收中「merger 不重跑测试」的残余缺口（架构设计边界）
- **现状机制**：`merger.ts` 在 `PRE_MERGE` 阶段执行 `assertEvidenceTestIntegrity`，直接从磁盘读取 Evidence Snapshot 中的 `test_integrity` 对象，核验是否触发基线重跑、重跑是否通过、以及合同是否授权豁免。
- **潜在风险**：Merger 在合并阶段出于执行时延与架构责任解耦考虑，**不再次调用测试运行器重复执行测试套件**。如果离线环境下有特权操作者直接篡改了磁盘上的 Evidence JSON 文件（强行将 `baseline_rerun_passed` 改为 `true`），merger 在不复跑测试的情况下依赖证据指纹校验，无法靠自身重新执行测试发现该作假。
- **治理处置**：明确「验证重跑在 POST_VERIFICATION 完成，merger 负责独立凭据审计而非二次执行测试」的责任边界；该缺口由 Evidence 签名防篡改机制共同制约。

---

## 三、总账复核结论与报审裁决

1. **工程事实**：
   - 四张 P0 施工卡（`TASK-P0.1`、`TASK-P0.2`、`TASK-P0.3a`、`TASK-P0.4`）已全部通过严格的单元测试、集成负向测试及全量回归，均已完成完工回写并合入主干（`main`）。
   - P0-1（双重门禁阻断与合同版本绑定）与 P0-2（全量候选变更 Scope 审计）原深审报告缺口**已全面闭合**；
   - P0-3（容器装配与见证链）与 P0-4（测试完整性防护与基线隔离重跑）在应用架构与门禁验证层**主体闭合**；
   - P0-3b（容器文件系统 Scope 强制挂载，L）继续挂账；上述三项已知架构边界已清晰界定并记档。

2. **报审裁决项（待 Tina 拍板）**：
   - **选项 A（宣称「P0 专项收敛」）**：认可 P0 专项防线（双重门禁 + 全量审计 + 容器见证链 + 测试篡改基线重跑）已建立并具备完整 fail-closed 能力，P0 专项施工阶段收敛；P0-3b 与残余边界转入长期挂账治理。
   - **选项 B（不宣称收敛，继续挂账）**：在 P0-3b 容器文件系统强制挂载落地前，维持 P0 整体开放挂账状态，不作收敛宣称。
   - **硬性约束**：无论选择何种裁决，**P0 风险均不宣称彻底解除**。
