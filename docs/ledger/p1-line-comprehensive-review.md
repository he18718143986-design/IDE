# P1 专项实施线总账复核报告（P1.1～P1.4 对齐评估建议与剩余风险清册）

> **地位**：P1 专项交付物总账复核记录（纯文档落账，不改产品代码，不新立施工卡）。
> **基线**：`main`@`5901714f4652bd4f3cdc116c8b7aa337881ce82b`（[#449](https://github.com/he18718143986-design/IDE/pull/449) P-345 TASK-P1.4 完工回写合入）。
> **依据**：2026-11-27 Tina 授权合并 #449 并指示推进 P1 线总账复核（五卡交付物 vs 评估报告三卡建议与微型修证逐条对齐 + 剩余风险清册）。
> **诚实口径**：**复核期间与本报告交付后均不宣称 P0/P1 风险解除；残余风险清册如实挂账；是否宣称「P1 专项收敛（剩余项挂账）」留待审批方 Tina 终审裁定**。

---

## 一、五卡交付物 vs 评估报告建议与微型修证逐条对齐

| 编号 | 任务卡 / 施工 PR | 评估报告建议与修证目标 | 闭合状态 | 核心代码落点与依据 | 自动化与负向测试验证 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P1.1** | [`TASK-P1.1`](../specs/development-tasks-completed.md#task-p1.1)<br>PR [#437](https://github.com/he18718143986-design/IDE/pull/437) (`caadfbf`) | ① 威胁模型梳理 Evidence 落盘明文 JSON 与伪造面；<br>② 选型报告确立 Ed25519 签名与 Git Trailer 哈希绑定；<br>③ 规划后续施工卡建议与验收矩阵。 | **已闭合** | • [`docs/ledger/p1-eval-evidence-trust-chain-and-p0-acceptance.md`](./p1-eval-evidence-trust-chain-and-p0-acceptance.md)：完整交付威胁模型、选型报告、十大负向验收矩阵与架构契约草案；<br>• 确立零外部运行时依赖原则。 | 纯文档评估型卡，DoD 6 项评审通过。 |
| **P1.2** | [`TASK-P1.2`](../specs/development-tasks-completed.md#task-p1.2)<br>PR [#440](https://github.com/he18718143986-design/IDE/pull/440) (`6b098dbe`) | ① Evidence Ed25519 签名生成与私钥安全管理（0400 权限，工作区外隔离）；<br>② `writeEvidence` RFC 8785 规范化落盘签名；<br>③ `merger.ts` PRE_MERGE 强验签门禁与 Git Trailer 绑定。 | **已闭合** | • `daemon/pipeline/evidence-signer.ts`：实现 Ed25519 密钥对生成、私钥权限 0400 检查（`assertPrivateKeySecurity`）、RFC 8785 规范化 JSON（`canonicalizeJson`）与 `stripUnsignedFields`；<br>• `daemon/pipeline/orchestrator.ts:2808`：落盘前签名并生成独立 `.sig` 凭据；<br>• `daemon/pipeline/merger.ts:182-205`：`assertEvidenceSignatureGate` 强验签 fail-closed；<br>• `daemon/pipeline/merger.ts:400-435`：注入 `Evidence-Sha256` 与 `Evidence-Signature` Git Trailer。 | • `tests/unit/evidence-signer.test.ts`（9 项单元测试）；<br>• `tests/integration/p1-evidence-signature-gate.test.ts`（6 项负向集成测试：签名缺失、篡改、密钥错配、未规范化均 fail-closed 拦截）。 |
| **P1.3** | [`TASK-P1.3`](../specs/development-tasks-completed.md#task-p1.3)<br>PR [#443](https://github.com/he18718143986-design/IDE/pull/443) (`ba9325f`) | ① 构建独立于既有测试套件的动态渗透测试集；<br>② 实跑验证 TC-P0-1A～TC-P0-4B 十大负向场景拦截；<br>③ 产出跨平台验收矩阵与标准化证据。 | **已闭合** | • `tests/integration/p1-3-independent-dynamic-suite.test.ts`：实跑覆盖版本过期、提交嫁接、非受控伪造、越界写、rename 逃逸、基线篡改等场景；<br>• `tests/daemon/p1-3-cross-platform-penetration.test.ts`：跨平台路径与挂载安全判据；<br>• `scripts/verify-p0-independent-suite.ts`：自动化采集环境指纹与证据生成；<br>• [`docs/ledger/p0-independent-verification-matrix.md`](./p0-independent-verification-matrix.md)：矩阵文档。 | 10 项负向场景中 7 项实跑通过、3 项因环境无 Docker 准确标记为跳过；动态实跑拦截与 Git Trailer 注入断言全通过。 |
| **P1.3a** | [`TASK-P1.3a`](../specs/development-tasks-completed.md#task-p1.3a)<br>PR [#446](https://github.com/he18718143986-design/IDE/pull/446) (`1340494a`) | ① 修复证据生成器裁决聚合缺陷（跳过项时误判 PASSED）；<br>② 引入 `PARTIAL` 状态；<br>③ 修正无 Docker 跨平台判据默认 PASSED 导致的通过数虚增。 | **已闭合** | • `scripts/verify-p0-independent-suite.ts`：引入 `PARTIAL` 裁决聚合（`failed > 0 ? FAILED : (skippedNoDocker > 0 ? PARTIAL : PASSED)`）；未连接真实 Docker 容器时，平台判据准确标记为 `SKIPPED_NO_DOCKER`；<br>• `tests/unit/verify-p0-independent-suite-verdict.test.ts`：纯函数单测；<br>• 矩阵文档同步重跑，Digest 重新确定性计算。 | • `tests/unit/verify-p0-independent-suite-verdict.test.ts`（9 项纯单测全绿）；<br>• 矩阵如实反映 7 实跑/3 跳过与 PARTIAL 裁决，虚增通过数已消除。 |
| **P1.4** | [`TASK-P1.4`](../specs/development-tasks-completed.md#task-p1.4)<br>PR [#449](https://github.com/he18718143986-design/IDE/pull/449) (`5901714f`) | ① Gateway 授权注入的敏感凭据值全局递归脱敏（禁止进入 stdout/stderr/MCP 回包/audit/Evidence）；<br>② SANDBOX_ENFORCED 见证引入基于单次随机 Nonce 的会话级防重放绑定；<br>③ Evidence Schema 扩展与 Ed25519 签名全覆盖。 | **已闭合** | • `daemon/runner/env-filter.ts`：实现 `redactSensitiveText` 与 `redactSensitiveObject` 全局递归值级脱敏；<br>• `daemon/mcp/gateway.ts` & `daemon/pipeline/orchestrator.ts`：命令输出、审计日志、工具入参回包与 Evidence 文本全面接入脱敏；<br>• `daemon/pipeline/sandbox-witness-nonce.ts`：256-bit CSPRNG Nonce，绑定 contract_id/revision/session/worktree_root，单次消费防重放；<br>• `daemon/pipeline/merger.ts`：PRE_MERGE 强核验 Nonce 与绑定并原子消费；<br>• `src/lib/evidence.schema.ts`：结构化字段与 Ed25519 签名覆盖。 | • `tests/unit/sandbox-witness-nonce.test.ts`（Nonce 生成、绑定、单次消费、跨合同/版本/工作树/会话嫁接拒绝、merger 拦截全覆盖）；<br>• `tests/daemon/env-filter.test.ts` & `tests/daemon/mcp-gateway.test.ts`（凭据值泄漏负向用例全绿）；<br>• `tests/daemon/p0-1-evidence-merge-fail-closed.test.ts` & `tests/daemon/p0-3a-container-wiring-and-witness.test.ts`。 |

---

## 二、关键技术落点、防御机制与测试证据

### 1. Gateway 凭据值级深度脱敏（TASK-P1.4）
- **核心机制**：区别于仅基于环境变量名过滤的浅层防护，`redactSensitiveText` 与 `redactSensitiveObject`（`daemon/runner/env-filter.ts:141-185`）收集所有已授权凭据的实际秘密值，按长度降序优先匹配，并在命令标准输出、标准错误、MCP 工具入参回包、审计日志（`daemon/mcp/gateway.ts:658,817,2044,2090,2156`）及 Evidence 摘要（`daemon/pipeline/orchestrator.ts:2685,2771`）中递归替换为 `[REDACTED]`。
- **负向验证**：`tests/daemon/mcp-gateway.test.ts` 实跑断言凭据被硬编码泄漏至 stdout/回包时，输出与审计文件均无明文泄露。

### 2. 沙箱见证 Nonce 会话级强绑定与防重放（TASK-P1.4）
- **CSPRNG 随机性**：`daemon/pipeline/sandbox-witness-nonce.ts:84` 强制采用 `crypto.randomBytes(32)` 生成 256 位熵安全随机串，严禁使用 `Math.random`。
- **上下文强绑定**：每个 Nonce 登记时强行绑定 `contract_id`、`contract_revision`、`session_id` 以及经过大小写与分隔符规范化处理的 `worktree_root`。
- **单次原子消费与重放阻断**：`WitnessNonceStore.verifyAndConsume` 执行单次原子消费。若 Nonce 缺失、未登记、跨合同嫁接、版本不符、工作树不匹配或已被消费（重放），一律抛出 `WitnessNonceError` 并在 `merger.ts:345` 转换为 `MergeGateError(E_CANNOT_MERGE)` 阻断合并。
- **签名防篡改覆盖**：`src/lib/evidence.schema.ts` 将 `nonce` 及绑定字段纳入 `sandboxWitnessSchema`，并在 `writeEvidence` 时作为核心载荷参与 RFC 8785 规范化序列化与 Ed25519 签名（`daemon/pipeline/evidence-signer.ts:290-320`）。攻击者若伪造或篡改 Nonce，直接触发签名验签失败。

---

## 三、残余风险清册与挂账项更新

在 P1.1～P1.4 全部交付合入后，复核以下残余风险与架构边界，继续如实挂账：

| 风险项编号 | 风险描述与现状 | 代码交付状态 | 安全验证状态 | 诚实口径与残余风险说明 |
| :--- | :--- | :--- | :--- | :--- |
| **RISK-P1-RESIDUAL-1** | **跨进程 Nonce 持久化缺失** | 内存单例存储（已交付） | 单元测试已覆盖内存防重放 | **当前 `WitnessNonceStore` 为 Daemon 进程内内存存储**。Daemon 重启后内存清空，无跨进程持久化防重放能力。若攻击者在两次 Daemon 进程生命周期之间重放历史 Evidence，内存存储无法识别（但仍受限于 `contract_revision`、Git commit tip 绑定、工作树路径与 Ed25519 签名校验）。此项作为架构边界挂账保留，未宣称跨重启持久覆盖。 |
| **RISK-P1-RESIDUAL-2** | **三平台真实容器运行时验收跳过（3/10 跳过项）** | 验收套件已交付（P1.3/P1.3a） | 7 实跑通过，3 项 SKIPPED_NO_DOCKER | TASK-P1.3 独立动态套件中，由于当前宿主/CI 环境无 Docker 守护进程，涉及容器挂载生效（TC-P0-3A/B）与真实容器内执行的跨平台判据标记为 `SKIPPED_NO_DOCKER`，裁决为 `PARTIAL`。**真实容器在 Linux/macOS Docker Desktop/Windows WSL2 下的实机渗透尚未完整闭环**。代码交付 ≠ 安全验证通过。 |
| **ARCH-BOUND-1** | **硬件级 Attestation 缺失** | 架构边界挂账 | 不在承诺范围 | 容器见证为软件层结构记录，无硬件加密安全芯片（如 TPM / 安全飞地）背书，继续保留诚实披露。 |
| **ARCH-BOUND-2** | **Merger 自身不重跑全量测试** | 架构边界挂账 | 不在承诺范围 | Merger 仅基于可信链验签、版本核验与门禁规则做准入裁决，不重跑测试套件，依赖前置验证与签名保真。 |
| **ARCH-BOUND-3** | **容器内无 OS 内核级只读隔离** | 架构边界挂账 | 不在承诺范围 | 仅依赖 Docker Mount Namespace 隔离，非硬件虚拟化级完全隔离。 |

---

## 四、收敛口径与报审裁定建议

1. **工程闭环确认**：P1 专项规划的评估（P1.1）、签名门禁（P1.2）、独立动态套件（P1.3）、裁决修证（P1.3a）、凭据脱敏与见证 Nonce（P1.4）共五张任务卡全部按规范完成代码、文档与测试闭环交付，代码库中已具备密码学防篡改可信链与凭据泄露防护。
2. **建议收敛口径**：建议提请审批方 Tina 审定后宣称：
   > **「P1 专项收敛（剩余项挂账）」**
3. **红线禁令维持**：
   - **严禁宣称「P0/P1 风险已解除」**；
   - **严禁宣称「具备硬件级完整可信」或「完全阻断所有跨重启攻击」**；
   - 残余风险清册中两项技术挂账（跨进程 Nonce 持久化、真实容器 3/10 跳过项）与三项架构边界需在后续技术台账中持续保留。
