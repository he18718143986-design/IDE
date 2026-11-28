# TASK-P0.14: 测试资产基线登记机制与执行验证专项交付报告

> **归档状态**：`DELIVERED`（施工 PR 对应提交合流待定）  
> **基线分支**：`main`（基准 SHA: `f229871fc98f781f0a2e9346acb4f6b1645cc1fc` · P-356）  
> **设计来源**：[`docs/ledger/p0-13-baseline-acceptance-independence-and-recovery.md`](./p0-13-baseline-acceptance-independence-and-recovery.md) 第三章《测试资产基线登记方案与扩展架构设计》  
> **诚实口径**：**本卡交付落实了测试资产识别纯函数、Base Commit 清单绑定、未登记与配置篡改 fail-closed 拦截，以及 fixture/helper 自动纳入基线隔离重跑还原集等核心机制，消除了「非标准测试资产可能绕过基线分类」的已知安全盲区；但不宣称补完后验收链完全无盲区；硬件级 Attestation 缺失、Merger 不重跑全量测试、容器内无 OS 级二次沙盒、跨进程 Nonce 持久化未做、真实容器运行时 3/10 跳过项等五项事实边界继续保留；严禁宣称「P0 风险完全解除」**。

---

## 一、背景与威胁模型

在 TASK-P0.4 及 P0.13 交付中，基线测试完整性守卫（Test Integrity Guard）建立了测试篡改拦截与隔离重跑机制。但既有识别逻辑主要依赖针对测试文件相对路径的正则表达式（`isTestPath`，主要匹配 `*.test.*` 或 `tests/**`）。这在以下非标准测试资产场景存在绕过盲区：
1. **测试与类型配置文件篡改**：Worker 修改 `vitest.config.ts`（例如注入 `passWithNoTests: true` 或调低覆盖率/阈值）或 `tsconfig.json`，绕过用例拦截；
2. **测试夹具与 Mock 污染**：Worker 修改 `tests/fixtures/**` 或 `mocks/**` 中的预设返回值与假数据，让断言在篡改数据下虚假通过；
3. **共享测试辅助库（Helper）弱化**：Worker 修改 `tests/helpers/**` 中的断言封装，使断言逻辑被降级。

TASK-P0.14 基于 P0.13 Scope B 落盘方案，落实测试资产基线识别、不可变清单绑定、篡改分级处置与 Merger 独立核验机制。

---

## 二、核心架构与实现落地

### 1. 测试资产识别与分类（P014-P1）
在 `src/lib/test-asset-manifest.ts` 中实现资产识别纯函数 `classifyTestAssetKind`：
- **`config`**：匹配 `vitest.config.ts`, `tsconfig.json`, `tsconfig.*.json`, `playwright.config.*`, `jest.config.*`, `pytest.ini` 等配置文件；
- **`fixture`**：路径片段包含 `fixtures/`, `__fixtures__/`, `mocks/`, `__mocks__/`；
- **`helper`**：测试目录下的 `helpers/`, `utils/`, `support/` 或名称匹配 `helper`/`test-util`；
- **`test_suite`**：符合 `isTestPath` 的测试套件文件；
- **`script`**：`scripts/verify-*.ts` 等测试执行与校验脚本。

### 2. Base Commit 清单绑定（P014-P2）
- 定义 `TestAssetItem`（含 `relPath`, `assetKind`, `sha256`, `criticality`）与 `TestAssetManifest`（含 `manifestVersion: "1.0.0"`, `baseCommit`, `assets`）；
- 在工作树挂载与 admit 阶段，基于基准提交（`baseRef` / `base_commit_sha`）扫描测试资产并计算 SHA256，生成不可变基线清单；
- 实现 `computeManifestDigest` 计算清单整体签名摘要，存入 Evidence `test_integrity.test_asset_manifest_digest`。

### 3. 分级处置与基线隔离重跑集成（P014-P3 & P014-P4）
在 `daemon/guard/test-integrity.ts` 中实现差异比对与分级处置：
- **测试配置文件未豁免篡改**：若检测到 `modifiedTestConfigs` 且合同未显式声明 `allow_test_config_mutation`，确定性 fail-closed 拦截，抛出 `E_TEST_CONFIG_MUTATED` 阻断合并；
- **夹具与 Helper 篡改**：自动提取被修改/删除的 `modifiedFixturesAndHelpers`，并入 `affectedPaths`（`pathsToRestore`）；在 `executeBaselineRerun` 期间，由 `restoreBaselineTestFiles` 连同测试用例一并还原至 Base Commit 版本进行隔离重跑，重跑完成后在 `finally` 阶段安全回退；
- **未登记测试资产**：未在基线登记的新增配置或关键资产，未获豁免时确定性 fail-closed 拦截。

### 4. 契约与 Evidence 扩展（P014-P5）
- `src/lib/contract.schema.ts`：在 `executionPermissionsSchema` 中增加 `allow_test_config_mutation: z.boolean().optional()` 授权字段；
- `src/lib/evidence.schema.ts`：受控 Evidence `test_integrity` 结构扩展：
  - `test_asset_manifest_digest`
  - `modified_test_configs`
  - `restored_fixtures_and_helpers`
  - `unregistered_test_assets`
  - `allow_test_config_mutation`
  - `failure_code` 包含 `"E_TEST_CONFIG_MUTATED"`；
- `daemon/pipeline/orchestrator.ts`：编排器捕获测试配置篡改并标记 `UNSAFE_EXECUTION` 降级；
- `daemon/pipeline/merger.ts`：PRE_MERGE 门禁独立核验配置文件篡改与豁免一致性，自称豁免但合同未授权一律抛出 `E_CANNOT_MERGE`。

---

## 三、DoD 验收与测试映射（P014-P6）

| 验收项 | 验收标准描述 | 测试文件与用例 | 状态 |
| :--- | :--- | :--- | :--- |
| **P014-P1** | 测试资产识别与分类机制（测试套件/配置/fixture/helper/脚本） | `tests/unit/test-asset-manifest.test.ts` (P014-P1 套件) | **PASSED** |
| **P014-P2** | Base Commit 绑定与不可变 TestAssetManifest 生成 | `tests/unit/test-asset-manifest.test.ts` (P014-P2 套件) | **PASSED** |
| **P014-P3** | 未登记资产检测与 fail-closed 拦截 | `tests/unit/test-asset-manifest.test.ts` & `tests/daemon/p0-4-test-integrity-fail-closed.test.ts` (P014-I1/I2) | **PASSED** |
| **P014-P4** | 分级处置：配置篡改抛 `E_TEST_CONFIG_MUTATED`，fixture/helper 纳入还原集重跑 | `tests/unit/test-integrity-guard.test.ts` (P014-U1/U2/U3) | **PASSED** |
| **P014-P5** | 契约与 Evidence 扩展、merger PRE_MERGE 独立门禁校验 | `tests/daemon/p0-4-test-integrity-wiring.test.ts` (P014-W1/W2/W3) | **PASSED** |
| **P014-P6** | 负向测试覆盖与专项交付报告落盘 | `tests/daemon/p0-4-test-integrity-fail-closed.test.ts` & 本报告 | **PASSED** |

---

## 四、改动文件清单

严格收敛在卡面声明的 11 个 `writable_paths` 范围内：
1. `src/lib/test-asset-manifest.ts`（新增：测试资产清单与分类纯函数）
2. `daemon/guard/test-integrity.ts`（修改：扩展测试资产分类与还原集集成）
3. `src/lib/contract.schema.ts`（修改：新增 `allow_test_config_mutation` 豁免配置）
4. `src/lib/evidence.schema.ts`（修改：扩展 `test_integrity` 资产记录与失败码）
5. `daemon/pipeline/orchestrator.ts`（修改：编排器传递资产清单与配置篡改降级）
6. `daemon/pipeline/merger.ts`（修改：PRE_MERGE 门禁独立核验配置篡改与豁免）
7. `tests/unit/test-asset-manifest.test.ts`（新增：资产分类与清单生成单元测试）
8. `tests/unit/test-integrity-guard.test.ts`（修改：补充测试资产守卫单测 P014-U1～U3）
9. `tests/daemon/p0-4-test-integrity-wiring.test.ts`（修改：补充契约与 Evidence 门禁集成测试 P014-W1～W3）
10. `tests/daemon/p0-4-test-integrity-fail-closed.test.ts`（修改：补充配置篡改拦截负向测试 P014-I1～I2）
11. `docs/ledger/p0-14-test-asset-manifest-and-baseline-registration.md`（新增：本交付报告）

**5 条 readonly paths 零 diff**：
- `daemon/baseline/os-sandbox.ts`
- `daemon/worker/sandbox/container-host.ts`
- `scripts/verify-p0-independent-suite.ts`
- `docs/ledger/p0-13-baseline-acceptance-independence-and-recovery.md`
- `docs/specs/development-tasks-completed.md`

---

## 五、诚实结论与事实边界

1. **消除的盲区**：非标准测试资产（包括但不限于测试配置文件、夹具数据、Mock 实现、共享 Helper）不再作为普通文件被漏放或静默篡改，配置篡改有明确阻断码 `E_TEST_CONFIG_MUTATED`，夹具与 helper 篡改在重跑时会被完整还原到基准提交状态。
2. **保留的五项事实边界**：
   - 硬件级 Attestation 缺失；
   - Merger 阶段只基于快照与证据校验，不重跑全量回归测试；
   - 容器内无 OS 级二次沙盒；
   - 跨进程 Nonce 持久化未做；
   - 真实容器运行时 3/10 跳过项在无 Docker 环境下不作为阻塞项。
3. **安全口径要求**：严禁宣称「P0 风险完全解除」或「具备完整全链路无盲区保证」。
