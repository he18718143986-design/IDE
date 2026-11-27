# TASK-P0.13: 基线验收独立性、环境共享风险评估与现场恢复加固专项报告

> **地位**：`TASK-P0.13`（Baseline Acceptance Independence & Recovery Hardening，估算 M，P0，Audit + Conditional Fix 型）全维度闭环验收交付报告。
> **基线**：`main`@`5f9edcd74d323c04a7e57771efb34ef47a24a00b`（[#458](https://github.com/he18718143986-design/IDE/pull/458) P-351 立卡 TASK-P0.13 + P0.5–P0.12 去重对照表合入）。
> **卡面原则（逐字遵守）**：**不重复实施已交付的容器执行闭环（P0.3b-2 #434）、Sandbox Witness 强绑定（P1.4 #449）、OS Sandbox 三态门禁与全路径派工审计（P0.1a #455）**。
> **诚实口径（逐字保留）**：**本卡交付不宣称 P0 风险完全解除；硬件级 Attestation 缺失、Merger 不重跑全量测试、容器内无 OS 级二次沙盒、跨进程 Nonce 持久化未做、真实容器运行时 3/10 跳过项等既有事实边界继续保留；严禁表述为「具备完整合同级权限强制和独立验收能力」**。

---

## 一、执行概述与四大 Scope 交付结论

根据 `TASK-P0.13` 卡面要求与工程纪律，本卡按既定优先级推进实施：**Scope D（现场恢复失败 fail-closed 明确修证）先行落地，继以 Scope A 审计、Scope C 评估与最小修补，Scope B 仅交付架构设计不施工**。

| 范围项 | 定性与处理方式 | 核心结论与落地证据 |
| :--- | :--- | :--- |
| **Scope A**<br>验收命令审批冻结与 revision 约束 | **审计与核查**（已满足全链路约束，记录代码与测试证据，做门禁一致性加固） | • 合同 Schema（`contract.schema.ts`）严格具备 `approved_revision === contract_revision` 绑定；<br>• `bumpContractRevision` 在规范变更时强制递增 revision 并重置审批为 `PENDING_REVIEW`，旧审批即刻失效；<br>• 编排器（`orchestrator.ts`）严格以冻结快照 `verification_spec.commands` 驱动基线重跑；<br>• Merger 门禁独立断言 Evidence revision 必须匹配合同最新 revision（`E_EVIDENCE_REVISION_MISMATCH`）；<br>• Merger 新增自相矛盾证据（`passed === true` 但携带 `failure_code`）与未触发但变动测试的 fail-closed 拦截。 |
| **Scope B**<br>测试资产基线登记方案 | **设计先行，不施工** | • 交付《测试资产基线登记方案与扩展架构设计》（见本文第三章）；<br>• 明确针对配置文件（`vitest.config.ts`, `tsconfig.json`）、测试夹具（`fixtures/**`）、共享 helper 的 Base 绑定识别方案；<br>• 保持现有分类器最小职责，本卡零代码施工。 |
| **Scope C**<br>执行环境共享风险评估与最小修补 | **评估 + 最小修补** | • 交付《executeBaselineRerun 与候选执行环境共享风险分析报告》（见本文第四章）；<br>• 梳理工作树、`node_modules`、环境变量与工具链四大共享威胁边界；<br>• **落地最小修补**：在 `daemon/guard/test-integrity.ts` 中封堵漏洞——若修改/删除了既有测试，但筛选后可用测试命令为 0（如配置非测试命令或仅手工确认），严禁放行，立即 fail-closed 返回 `E_TEST_BASELINE_UNAVAILABLE` 并阻断合并。 |
| **Scope D**<br>现场恢复失败 fail-closed 强拦截 | **明确代码修证项** | • 在 `daemon/guard/test-integrity.ts` 中新增 `RecoveryOperationFailure` 与 `TestBaselineRecoveryError`；<br>• `restoreBaselineTestFiles` 与 `hideWorkerAddedTests` 针对每个文件的恢复、重命名操作进行显式校验；<br>• 单个操作失败不静默吞，记录诊断明细；<br>• 恢复清理阶段（`finally`）发生任何异常，严厉覆盖命令执行结果，强制置为 `passed: false` + `E_TEST_BASELINE_UNAVAILABLE`；<br>• 编排器与 Merger 双重拦截恢复失败，阻断 Merge。 |

---

## 二、Scope A 审计：verification_spec 审批冻结与 revision 传递链条

### 1. 全链路调用与约束审计

对代码库中的验收命令传递链进行了逐层深入审查：
1. **合同创建与修订**（`src/lib/contract.schema.ts`）：
   - 合同草案由 `createContractDraft` 生成，包含初始 `contract_revision: 1` 与 `lifecycle_state: "DRAFT"`；
   - 包含必须字段 `verification_spec.commands`，每条命令定义别名、可执行程序、参数、期望退出码与超时限制；
   - 当合同内容（包括 `verification_spec`）需要更新时，`bumpContractRevision` 纯函数负责推进 revision：
     ```ts
     export function bumpContractRevision(contract: SoftwareContract): SoftwareContract {
       return {
         ...contract,
         contract_revision: contract.contract_revision + 1,
         lifecycle_state: "PENDING_APPROVAL",
         approval: {
           status: "PENDING_REVIEW",
         },
       };
     }
     ```
   - **审计判定**：任何规范修改必然使 `contract_revision` 单调递增，且将审批状态强行重置为 `PENDING_REVIEW`，同时 `approved_revision` 被清空，原审批对新版本直接失效。
2. **编排器审批与执行**（`daemon/pipeline/orchestrator.ts`）：
   - 批准入口记录审批当时的 revision：
     ```ts
     current.approval = {
       status: "APPROVED",
       approved_by: approver,
       approved_at: new Date().toISOString(),
       approved_revision: current.contract_revision,
     };
     ```
   - 执行入口（`orchestrator.execute`）严格要求合同处于 `EXECUTING` 或合法的就绪生命周期；
   - `executeBaselineRerun` 显式以 `current.verification_spec.commands` 作为输入，使用当前审批锁定的命令规范，不接受 Worker 动态修改的命令列表。
3. **Merger Gate 独立门禁核验**（`daemon/pipeline/merger.ts`）：
   - `assertEvidenceControlAndRevision` 严格比对：
     ```ts
     if (snapshot.contract_revision !== expectedRevision) {
       throw new MergeGateError(
         "E_EVIDENCE_REVISION_MISMATCH",
         `Evidence contract_revision (${snapshot.contract_revision}) does not match current contract revision (${expectedRevision})`,
       );
     }
     ```
   - **加固修证**：在 `assertEvidenceTestIntegrity` 中增加状态自洽性校验，严防伪造或矛盾字段（如 `baseline_rerun_passed === true` 却携带 `failure_code`，或未获豁免变动既有测试却未触发重跑），一律以 `E_CANNOT_MERGE` 或 `E_TEST_BASELINE_UNAVAILABLE` 拒合。

### 2. 审计结论
`verification_spec.commands` 在审批快照、合同 revision 与 `executeBaselineRerun` 之间具备完整、闭环的强引用关系，审批后篡改命令将因 revision 不匹配或未批准状态被彻底拦截，链条未断裂。

---

## 三、Scope B 设计先行：测试资产基线登记方案

### 1. 现状痛点与威胁边界
目前 `daemon/guard/test-integrity.ts` 中的 `isTestPath` 主要依赖正则匹配（如 `tests/**`, `**/*.test.*`, `**/*.spec.*`）。这种基于文件路径的判定方式存在盲区：
1. **测试配置文件篡改**：例如修改 `vitest.config.ts`、`jest.config.js`、`tsconfig.json` 或 `pytest.ini`，可能通过修改 `testTimeout`、`setupFiles` 或排除某些测试套件实现悄悄弱化（weakening）；
2. **测试夹具与 Mock 污染**：例如篡改 `tests/fixtures/data.json` 或 `tests/mocks/api.ts`，使得测试在篡改后的假数据下虚假通过；
3. **共享 Helper 篡改**：例如修改 `tests/utils/assert-helper.ts`，弱化断言逻辑。

### 2. 测试资产基线清单（Test Asset Manifest）设计
建议在后续演进中引入 `TestAssetManifest` 规范，不扩大现有分类器单次开销，具体结构设计如下：

```ts
export interface TestAssetItem {
  relPath: string;
  assetKind: "test_suite" | "config" | "fixture" | "helper" | "script";
  sha256: string;
  criticality: "BLOCKING" | "AUDIT_ONLY";
}

export interface TestAssetManifest {
  manifestVersion: "1.0.0";
  baseCommit: string;
  assets: Record<string, TestAssetItem>;
}
```

### 3. 工作流与绑定机制
1. **基线抓取**：在工作树创建（`admit`）时，基于 `baseRef` 扫描并哈希化所有测试资产，生成不可变的基线清单；
2. **差异审计**：在 Worker 完成变更后，除对比测试文件路径外，针对清单中的 `config`、`fixture`、`helper` 路径进行哈希校验；
3. **分级处置**：
   - 若 `config` 被修改且未声明豁免，标记为 `E_TEST_CONFIG_MUTATED` 并阻断合并；
   - 若 `fixture` / `helper` 被修改，自动将其纳入基线隔离重跑的还原路径集（`pathsToRestore`），在基线重跑时一并回退至 `baseRef` 版本；
4. **与现有契约兼容**：在合同 `execution_permissions` 中引入可选字段 `allow_test_config_mutation: boolean`，未明确授权时严格 fail-closed。

---

## 四、Scope C 评估与最小修补：执行环境共享风险分析

### 1. 候选执行环境与基线重跑共享风险分析

当前 `executeBaselineRerun` 采用**原位现场还原模式**（In-place Restoration Model），在候选工作树（Candidate Worktree）中就地还原既有测试并隐藏新增测试后运行。经系统评估，梳理出以下四类共享边界风险：

1. **工作树源码共享（Source Code Sharing）**：
   - *现状*：基线测试在 Worker 修改后的业务源码（`src/**`）上运行；
   - *风险*：这是符合设计的（基线重跑的目标正是验证 Worker 的业务修改是否破坏既有测试）；但若 Worker 在业务源码中注入了针对测试环境的嗅探逻辑（例如 `if (process.env.STAGENT_BASELINE) process.exit(0)`），可能产生逃逸；
2. **Node 模块与依赖共享（Dependency Sharing）**：
   - *现状*：测试运行依赖工作树下的 `node_modules`；
   - *风险*：若 Worker 破坏或替换了 `node_modules` 中的包，可能造成测试环境故障（已被 `E_TEST_BASELINE_UNAVAILABLE` 覆盖拦截）；
3. **环境变量共享（Environment Variable Sharing）**：
   - *现状*：命令执行器继承当前进程环境变量；
   - *风险*：无独立命名空间隔离；
4. **验证命令为空或不匹配风险（Command Mismatch / Zero Commands）**：
   - *现状*：若合同中未声明测试命令（例如仅配置了静态检查命令 `npm run lint` 或设置了手工确认），原 `testCommands` 筛选后回退至 `[...verificationCommands]`，可能导致没有执行任何真正的测试逻辑即返回 `passed: true`。

### 2. Scope C 落地最小修补（直接确认且影响合并安全）
在 `daemon/guard/test-integrity.ts` 的 `executeBaselineRerun` 中落地硬拦截：
- **漏洞修补**：当既有测试被修改或删除（`hasExistingTestMutation === true`）时，若筛选出的测试命令集合为空（`testCommands.length === 0`），**严禁假绿放行，立即 fail-closed**：
  ```ts
  if (testCommands.length === 0) {
    runResult = {
      triggered: true,
      passed: false,
      failure_code: "E_TEST_BASELINE_UNAVAILABLE",
      failure_reason: "No verification commands available to execute baseline test rerun",
      restored_paths: affectedPaths,
    };
  }
  ```
- **安全效果**：彻底杜绝了因缺少测试验证命令而导致既有测试被篡改却被无阻断合流的安全漏洞。

### 3. 独立执行器架构评估与建议
未来中长期演进，可考虑在主干单独切出无污染的只读影子工作树（`shadow-baseline-worktree`），将 Worker 的源码变更打补丁（`git apply`）至影子目录运行基线测试，彻底杜绝候选工作树残留文件对基线重跑的干扰。

---

## 五、Scope D 实施落地：工作树恢复失败 fail-closed 强拦截

### 1. 结构与异常模型增强
在 `daemon/guard/test-integrity.ts` 中显式定义恢复失败的诊断结构与专用异常类型：
```ts
export interface RecoveryOperationFailure {
  operation: "restore" | "revert" | "hide";
  relPath: string;
  reason: string;
  error?: unknown;
}

export class TestBaselineRecoveryError extends Error {
  readonly failures: RecoveryOperationFailure[];
  constructor(message: string, failures: RecoveryOperationFailure[]) {
    super(message);
    this.name = "TestBaselineRecoveryError";
    this.failures = failures;
  }
}
```

### 2. `restoreBaselineTestFiles` 细粒度加固
- **逐文件校验**：`git show ${baseRef}:${relPath}` 退出码非零或写文件失败，立刻收集入 `restoreFailures`，严禁静默跳过；
- **准备阶段原子回退**：若有任一文件还原失败，尽力回退已写文件，并抛出 `TestBaselineRecoveryError`；
- **回滚阶段（`revert`）全面收集**：在测试执行结束后执行现场复原时，遍历所有被操作文件，记录所有写回/删除失败项，若存在失败统一抛出 `TestBaselineRecoveryError`。

### 3. `hideWorkerAddedTests` 细粒度加固
- **逐文件重命名校验**：Worker 新增测试重命名为 `.stagent-p04-added.bak` 时若抛出异常，记录进 `hideFailures`；
- **准备阶段原子回退**：发生部分失败时回退已重命名文件并抛出明确异常；
- **复原阶段（`revert`）备份对齐**：检查备份文件是否存在并还原，若备份丢失或无法还原，记录入失败集并抛出 `TestBaselineRecoveryError`。

### 4. `executeBaselineRerun` 恢复错误结果覆盖
在基线重跑主流程中：
- 前置恢复/隐藏失败时，直接返回 `passed: false` + `failure_code: "E_TEST_BASELINE_UNAVAILABLE"`，阻断重跑执行；
- **清理保障（`finally` 覆盖机制）**：重跑命令执行完成后，在 `finally` 块中调用双方 `revert()`。若清理发生任何失败，**无论测试命令原本是否通过，一律将结果覆盖为**：
  ```ts
  runResult = {
    triggered: true,
    passed: false,
    failure_code: "E_TEST_BASELINE_UNAVAILABLE",
    failure_reason: `Recovery cleanup failed: ${cleanupErrors.join("; ")}`,
    restored_paths: affectedPaths,
  };
  ```

### 5. 编排器与 Merger 双重阻断
- **编排器**（`daemon/pipeline/orchestrator.ts`）：外层 try-catch 全捕获，一旦捕获恢复异常，记录 `test_integrity.baseline_rerun_passed = false`，生命周期归入 `BLOCKED`，`reason_code: "UNSAFE_EXECUTION"`，`can_merge: false`；
- **Merger Gate**（`daemon/pipeline/merger.ts`）：
  - 严格校验 `ti.baseline_rerun_passed`；
  - 拦截恢复失败引发的 `E_TEST_BASELINE_UNAVAILABLE`；
  - 拦截自相矛盾与未触发重跑的异常凭据。

---

## 六、测试验证矩阵与回归证据

所有针对 TASK-P0.13 的加固与修证项均有完备的自动化测试守护：

| 测试文件 | 用例编号与描述 | 覆盖 Scope | 状态 |
| :--- | :--- | :--- | :--- |
| `tests/unit/test-integrity-guard.test.ts` | **P013-U1**: `restoreBaselineTestFiles` 在 gitRunner 失败时 fail-closed 抛出 `TestBaselineRecoveryError` | Scope D | **PASS** |
| `tests/unit/test-integrity-guard.test.ts` | **P013-U2**: `restoreBaselineTestFiles.revert` 逐文件尝试并抛出包含明细的异常 | Scope D | **PASS** |
| `tests/unit/test-integrity-guard.test.ts` | **P013-U3**: `hideWorkerAddedTests` 处理重命名失败并干净回滚 | Scope D | **PASS** |
| `tests/unit/test-integrity-guard.test.ts` | **P013-U4**: `hideWorkerAddedTests.revert` 在备份文件丢失时抛出明确异常 | Scope D | **PASS** |
| `tests/unit/test-integrity-guard.test.ts` | **P013-U5**: `executeBaselineRerun` 在准备阶段还原失败时返回 `E_TEST_BASELINE_UNAVAILABLE` | Scope D | **PASS** |
| `tests/unit/test-integrity-guard.test.ts` | **P013-U6**: `executeBaselineRerun` 在清理阶段失败时覆盖测试通过结果并 fail-closed | Scope D | **PASS** |
| `tests/unit/test-integrity-guard.test.ts` | **P013-U7**: `executeBaselineRerun` 在修改既有测试但零命令时 fail-closed | Scope C | **PASS** |
| `tests/daemon/p0-4-test-integrity-wiring.test.ts` | **P013-W1**: Merger 拒绝 `passed: true` 但携带失败码的自相矛盾证据 | Scope D | **PASS** |
| `tests/daemon/p0-4-test-integrity-wiring.test.ts` | **P013-W2**: Merger 拒绝变动既有测试未获豁免但未触发重跑的证据 | Scope D | **PASS** |
| `tests/daemon/p0-4-test-integrity-wiring.test.ts` | **P013-W3**: Merger 拦截因恢复失败导致的 `E_TEST_BASELINE_UNAVAILABLE` | Scope D | **PASS** |
| `tests/daemon/p0-4-test-integrity-wiring.test.ts` | **P013-W4**: 合同修订递增 revision 导致旧审批失效并在合并前由 revision 门禁拦截 | Scope A | **PASS** |
| `tests/daemon/p0-4-test-integrity-fail-closed.test.ts` | **P013-I1**: 全链路集成——执行期间破坏现场导致恢复故障 -> orchestrator fail-closed BLOCKED + E_TEST_BASELINE_UNAVAILABLE -> merger 拦截阻断 | Scope D | **PASS** |
| `tests/daemon/p0-4-test-integrity-fail-closed.test.ts` | **P013-I2**: 全链路集成——变动既有测试但零测试命令 -> orchestrator fail-closed BLOCKED + E_TEST_BASELINE_UNAVAILABLE -> merger 拦截阻断 | Scope C | **PASS** |

**聚焦测试集运行结果**：3 个测试文件共 36 个测试用例全部通过（`36 passed, 0 failed`）。
**质量门禁核查**：
- `npm run typecheck`：通过（0 errors）。
- `npm run lint`：通过（0 errors，18 条既有警告）。
- `npm run check:docs`：通过（0 errors，107 条既有 debt warnings）。

---

## 七、诚实口径与边界声明

1. **P0 风险未宣称解除**：本专项交付针对基线测试验收独立性与恢复稳健性进行了加固与审计，但既有架构局限（硬件级 Attestation 缺失、Merger 不重跑全量测试、容器内无 OS 级二次沙盒、跨进程 Nonce 持久化未做、真实容器运行时 3/10 跳过项）继续存在；
2. **严禁过度断言**：严禁对外宣称「具备完整合同级权限强制和独立验收能力」；
3. **范围收敛**：严格按卡面 8 条 `writable_paths` 施工，未动 6 条 `readonly_paths`。
