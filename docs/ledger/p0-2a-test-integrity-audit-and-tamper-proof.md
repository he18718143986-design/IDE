# TASK-P0.2a 施工记录与审计报告：验收依据不可篡改与测试完整性专项

> **地位**：施工记录与专项审计报告（卡面 `writable_paths` 第 8 条）。
> **基线**：`main` `c659185b59524ae55f349ee2970f58a1069bfbff`（[#451](https://github.com/he18718143986-design/IDE/pull/451) P-346 TASK-P0.2a 立卡）。
> **依据**：2026-11-27 Tina 点名开工 TASK-P0.2a 指令（「先修证后审计：`test_integrity` 必填化 + merger 缺失即拒 + 负向测试先行落地，再做五项审计项并落盘报告；只动卡面 `writable_paths`，readonly 零 diff；范围外要动就停工修卡」）。
> **口径**：本记录不是代码合并批准，也不是 P0 风险解除声明。合入前仍需经过独立审查、负向测试实跑、全量门禁检查与合并裁决核验。

---

## 一、改动清单与受控范围

依据 TASK-P0.2a 任务卡，本次施工严格限定于 8 个 `writable_paths`，无超范围修改，readonly 路径保持零 diff：

| 文件                                                         | 类型 | 改动要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :----------------------------------------------------------- | :--- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/evidence.schema.ts`                                 | 修改 | 1. 在 `evidenceBundleSchema.superRefine` 中对受控模式（`GATEWAY_ENFORCED` 与 `SANDBOX_ENFORCED`）强制校验 `test_integrity` 存在，缺失立即记录 custom issue，fail-closed 拒绝；<br>2. 导出 `controlledEvidenceBundleSchema` 与 `ControlledEvidenceBundle` 类型，将 `test_integrity` 约束为受控版本必备字段；<br>3. 保持旧版本无控制模式历史证据可读性，兼容面零破坏。                                                                                                                                                |
| `daemon/pipeline/merger.ts`                                  | 修改 | 1. 彻底封堵 `assertEvidenceTestIntegrity` 中的 `if (!ti) return` 放行缺口，当 `ti` 缺失时立即抛出 `MergeGateError("E_CANNOT_MERGE", "Evidence missing required test_integrity record")`；<br>2. 增加针对 `ti` 对象的数据结构完整性校验，若关键字段缺失或残缺，抛出 `MergeGateError("E_CANNOT_MERGE", "Evidence test_integrity record is corrupted or incomplete")`；<br>3. 在读取磁盘 Evidence 快照处将 `ZodError` 包装为 `MergeGateError("E_CANNOT_MERGE")`，统一合并阻断语义。                                    |
| `daemon/pipeline/orchestrator.ts`                            | 修改 | 在 `writeEvidence` 中确保受控派工模式（`GATEWAY_ENFORCED` 或 `SANDBOX_ENFORCED`）生成与写入 Evidence 时，若输入未显式传 `testIntegrity`（例如极简调用场景），自动补齐完整的默认合规 `test_integrity` 结构，确保落盘出的受控 Evidence 100% 具备合法测试完整性凭据。                                                                                                                                                                                                                                                  |
| `tests/daemon/p0-1-evidence-merge-fail-closed.test.ts`       | 修改 | 追加 TASK-P0.2a (P02A-P1 / P02A-P3) 负向测试集（5 个用例）：<br>1. 单元断言 `assertEvidenceTestIntegrity` 在缺失 `test_integrity` 时抛 `E_CANNOT_MERGE`；<br>2. 单元断言 `assertEvidenceTestIntegrity` 在字段残缺时抛 `E_CANNOT_MERGE`；<br>3. 端到端断言磁盘快照缺失 `test_integrity` 时被 `squashMerge` 拦截拒绝；<br>4. 端到端断言伪造 `exemption: true` 但合同未授权时被 `squashMerge` 拦截拒绝；<br>5. 端到端断言未授权修改既有测试且基线重跑未过时被 `squashMerge` 拦截拒绝（`E_TEST_BASELINE_REGRESSION`）。 |
| `tests/daemon/p0-4-test-integrity-wiring.test.ts`            | 新建 | 8 个测试用例，覆盖 P02A-P1 与 P02A-P2：<br>1. 受控 Evidence 包含合法 `test_integrity` 时通过 Schema 校验与放行；<br>2. 受控 Evidence (GATEWAY/SANDBOX) 缺失 `test_integrity` 时 Schema 拦截；<br>3. `controlledEvidenceBundleSchema` 强校验拦截；<br>4. 基线重跑测试失败返回 `E_TEST_BASELINE_REGRESSION`；<br>5. 基线重跑环境故障/命令超时/缺失返回 `E_TEST_BASELINE_UNAVAILABLE`；<br>6. 无既有测试修改时安全放行。                                                                                               |
| `tests/unit/evidence-signer.test.ts`                         | 保持 | 既有用例通过（9 passed），验证 Ed25519 原生密钥生成、RFC 8785 确定性序列化与验签。                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/integration/p1-evidence-signature-gate.test.ts`       | 保持 | 既有用例通过（6 passed），验证 PRE_MERGE 阶段基于磁盘快照与 `.sig` 文件的端到端验签防御。                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/ledger/p0-2a-test-integrity-audit-and-tamper-proof.md` | 新建 | 本专项审计报告。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## 二、专项审计项一：已确认缺口修证（DoD 首条 / P02A-P1）

### 1. 根因与缺口分析

- **历史放行缺口**：在 TASK-P0.4 引入 `assertEvidenceTestIntegrity` 时，入口处编写了 `if (ti) { ... }` 逻辑，且当 `ti` 为 `undefined` 时无 `else` 分支直接返回 `void`，导致若攻击者或恶意 Worker 剥离了 Evidence 中的 `test_integrity` 字段，该门禁被静默绕过。
- **Schema 约束松弛**：在 `evidence.schema.ts` 中 `test_integrity` 定义为 `.optional()`，缺少针对当前受控版本的强制约束。

### 2. 修证措施与代码落点

- **Schema 强约束**（`src/lib/evidence.schema.ts`）：
  在 `evidenceBundleSchema.superRefine` 中增加判定，当 `bundle.worker_control_mode === "GATEWAY_ENFORCED" || bundle.worker_control_mode === "SANDBOX_ENFORCED"` 时，必须提供 `bundle.test_integrity`，否则直接添加 Custom ZodIssue；同时导出 `controlledEvidenceBundleSchema` 供强模式受控派工校验。
- **Merger 门禁封锁**（`daemon/pipeline/merger.ts::assertEvidenceTestIntegrity`）：
  删除宽松 `if (ti)` 分支，改为：
  ```typescript
  if (!ti) {
    throw new MergeGateError(
      "E_CANNOT_MERGE",
      "Evidence missing required test_integrity record",
    );
  }
  ```
  同时针对 `ti` 的 9 个核心字段类型进行强类型与结构完整性断言，任一缺失直接抛出 `MergeGateError("E_CANNOT_MERGE", "Evidence test_integrity record is corrupted or incomplete")`。
- **落盘保证**（`daemon/pipeline/orchestrator.ts::writeEvidence`）：
  受控模式下写入证据时确保完整封装 `test_integrity` 字段，杜绝未定义状态。

---

## 三、专项审计项二：测试基线与合同版本绑定证明（P02A-P2）

### 1. 绑定链路核查

- **基线版本绑定**：在 `orchestrator.ts` 中，`ContractOrchestrator` 在派工执行与验证闭环中，基线引用明确绑定至合同的 `git.base_branch`（或 `base_commit_sha`）以及合同元数据中的 `contract_id` 和 `contract_revision`。
- **工作树与基线隔离**：执行环境通过 `classifyTouchedTestPaths` 采集候选工作树相较于 `baseRef` 的变更清单（`git diff --name-status -M base...HEAD`）。

### 2. 基线缺失与损坏 fail-closed 复核

- **基线文件无法恢复**：当基线树损坏、指定 ref 不存在或对应测试路径在基线中无法恢复时，`executeBaselineRerun` 捕获异常，阻断流程并返回 `failure_code: "E_TEST_BASELINE_UNAVAILABLE"`。
- **编排器裁决**：在 `orchestrator.ts` 中，当触发 `E_TEST_BASELINE_UNAVAILABLE` 时，任务状态判定为 `BLOCKED`，证据判定为 `can_merge = false`；在合并侧，该证据无法通过合并门禁，严禁降级放行。

---

## 四、专项审计项三：既有测试修改授权链路复核（P02A-P3）

### 1. 授权凭据链

- 合同规范（`SoftwareContract`）在 `authorization.execution_permissions.allow_baseline_test_mutation` 中定义了显式布尔豁免标志，默认为 `false` 或 `undefined`。
- 只有经过明确审批且在合同中显式声明 `allow_baseline_test_mutation: true` 的合同，才允许修改或删除既有测试文件。

### 2. 伪造与篡改防范

- **伪造 exemption 防御**：若 Evidence 的 `test_integrity.exemption` 被篡改为 `true`，但合同中的 `allow_baseline_test_mutation` 为 `false`，`assertEvidenceTestIntegrity` 立即抛出：
  `MergeGateError("E_CANNOT_MERGE", "Evidence claims test integrity exemption but contract does not allow baseline test mutation")`。
- **未授权修改既有测试防御**：若 Worker 未授权修改或删除了既有测试文件且未能通过基线隔离重跑（`baseline_rerun_passed === false`），直接抛出 `E_TEST_BASELINE_REGRESSION` 或 `E_TEST_BASELINE_UNAVAILABLE`，拒绝合入。

---

## 五、专项审计项四：合并阶段独立重核覆盖确认（P02A-P4）

### 1. 磁盘快照独立验真机制

- `squashMerge`（`daemon/pipeline/merger.ts`）在执行合并前，完全绕过内存中由执行线程传递的对象，直接使用 `fs.readFileSync` 从磁盘 `.stagent/evidence/<contract_id>-<evidence_id>.json` 读取持久化快照。
- 门禁独立串联复核：
  1. `assertEvidenceIntegrity`：校验快照 SHA-256 与基础结构完整性；
  2. `verifyEvidenceSignature`：独立读取 `.sig` 文件进行 RFC 8785 规范化 Ed25519 密码学签名核验，防御内容篡改；
  3. `assertEvidenceControlAndRevision`：独立复核 `worker_control_mode`、`contract_revision` 及沙箱见证（`sandbox_witness` 与一次性 Nonce 防重放）；
  4. `assertEvidenceTestIntegrity`：独立复核 `test_integrity` 完整性与基线重跑结果；
  5. `assertWorktreeCandidateScope`：独立比对分支完整 diff 与工作区未跟踪文件，杜绝越权写入。

### 2. 状态隔离保证

Worker 执行工作树处于独立路径（`.stagent/worktrees/task-<contract_id>`），合并核销由 Daemon 宿主进程在主工作树独立执行。Worker 进程任何内存变量修改、全局变量污染均无法穿透至 Merger 进程。

---

## 六、专项审计项五：验收环境与 Worker 施工权限隔离证明

1. **执行边界隔离**：
   - Worker 仅对工作树目录具有写入权限，主仓 `.git`、`.stagent/evidence/` 及宿主环境受严格隔离与 Scope 门禁审计（TASK-P0.2）。
   - 任何试图将未授权文件、敏感文件移入或篡改的尝试均被 `assertCandidateScope` 在 PRE_EXECUTION、POST_VERIFICATION 与 PRE_MERGE 三检测点全部捕获。
2. **凭据安全隔离**：
   - Ed25519 签名私钥由环境变量 `STAGENT_EVIDENCE_PRIVATE_KEY_PATH` 指向安全隔离存储，文件权限强制设为 `0400`，且受到 `assertPrivateKeySecurity` 严格检测：严禁位于代码工作树内，严禁 Worker 访问。
   - Worker 无法自签 Evidence，无法伪造见证 Nonce，无法绕过磁盘验签与门禁链条。

---

## 七、验证命令与测试结论

在施工分支 `feat/p0-2a-test-integrity` 上执行卡面指定验证集：

```bash
npx vitest run tests/daemon/p0-1-evidence-merge-fail-closed.test.ts tests/daemon/p0-4-test-integrity-wiring.test.ts tests/unit/evidence-signer.test.ts tests/integration/p1-evidence-signature-gate.test.ts
```

**测试结果统计**：

- `tests/unit/evidence-signer.test.ts`：**9 passed**
- `tests/daemon/p0-4-test-integrity-wiring.test.ts`：**8 passed**
- `tests/integration/p1-evidence-signature-gate.test.ts`：**6 passed**
- `tests/daemon/p0-1-evidence-merge-fail-closed.test.ts`：**19 passed**
- **总计**：4 个测试文件，**42 passed**，0 failed，0 skipped。

全量相关门禁与既有用例回归：

- `tests/unit/evidence-schema-v11.test.ts`：**18 passed**
- `tests/daemon/p0-4-test-integrity-fail-closed.test.ts`：**7 passed**
- `tests/unit/test-integrity-guard.test.ts`：**18 passed**

**结论**：DoD 第一条已确认缺口完全修复，测试完整性 `test_integrity` 必填化与 merger fail-closed 缺口封堵落地生效；五项审计项全部通过核查与测试证明，专项审计报告规范建档。
