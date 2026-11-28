# TASK-P0.15 专项审计与交付报告：Evidence 信任根强制与合并事务一致性审计

- **任务编号**：TASK-P0.15（P-358，估算 M，P0）
- **关联去重对照**：`docs/ledger/pr468-dedup-crosswalk-task-p0-15.md`
- **审计与修证日期**：2026-11-28
- **执行分支**：`feat/task-p0.15-trust-root-and-audit`
- **合流基线**：main `f9d994f7455ee0aeaaac59bf20996139cd031b34`

---

## 1. 摘要与背景

基于 PR #468 去重对照落盘方案（《PR #468 Deduplication Crosswalk and Incremental Disposition》），本卡聚焦高风险安全增量与合并事务边界审计，严格排除了已交付机制的重复施工，闭环以下两项核心任务：
1. **Scope A（明确修证 - 凭据信任根强制）**：修正 `daemon/pipeline/merger.ts` 签名验签门禁，受控合并强制要求配置可信公钥或显式信任策略；Evidence 自带 `public_key` 严禁单独获得受控合并授权；无 `expectedPublicKey` 时显式降级为 `integrity-only` 并阻断受控合并；落地 9 项负向拦截与正向验证测试。
2. **Scope B（审计型 - 合并事务与恢复一致性审计）**：全面枚举 Merge/Delivery 入口与调用链，审查门禁检查与 Git 操作临界边界、锁机制、并发一致性及失败恢复路径，映射新增缺口至既有账本，禁止擅自扩大施工。

---

## 2. Scope A：Evidence 信任根强制修证说明

### 2.1 漏洞与风险根因
在 TASK-P1.2 引入 Ed25519 签名门禁时，`evidence-signer.ts` 的密钥解析链允许回退至签名记录自带的 `signature.public_key`（用于载荷自解释与离线完整性校验）。然而在 `merger.ts` 的 `assertEvidenceSignatureGate` 中，受控合并门禁未强制比对系统配置的可信根，导致攻击者若伪造并自签凭据（同时将自签公钥填入凭据自带字段），在未配置全局信任根的环境下可能绕过密码学信任源检查。

### 2.2 修证与降级机制实现（`merger.ts`）
1. **显式可信密钥集合归集**：
   - 汇总 `expectedPublicKey`（入参显式指定）、`policy.trustedPublicKeys`、`policy.trustedPublicKeyPath`，以及环境变量 `STAGENT_EVIDENCE_PUBLIC_KEY_PEM` / `STAGENT_EVIDENCE_PUBLIC_KEY_PATH`；
   - 坚决将凭据自带的 `signature.public_key` 与本地未受控默认公钥路径排除在隐式信任根之外。
2. **受控合并信任根强制**：
   - 当可信公钥集合为空时，若处于受控合并模式（`enforceMergeControlledTrust !== false`），立即抛出 `MergeGateError`（错误码 `E_EVIDENCE_UNTRUSTED_KEY`），fail-closed 阻断合流；
   - 明确规定：凭据自带公钥不得作为受控合并授权的信任基准。
3. **安全降级分支**：
   - 仅在非受控合并环境下，且调用方显式声明 `allowIntegrityOnly: true` 与 `enforceMergeControlledTrust: false` 时，才允许降级为仅完整性校验（`integrity_only`）；
   - 该模式仅自证载荷自签未被篡改，绝不具备授权受控合并的权限。
4. **多根匹配与防伪比对**：
   - 在配置了合法受信任公钥时，凭据必须能通过至少一个受信任公钥的密码学验签；任一未知公钥、伪造来源、损坏签名或内容篡改均抛出 `EVIDENCE_SIGNATURE_INVALID`。

### 2.3 验证套件（`tests/daemon/p0-15-evidence-trust-root.test.ts`）
新建 9 项专项测试，9/9 绿色通过：
- **P015-P1 负向场景 1**：Evidence 自带公钥自签，缺少受信任根时受控合并被 fail-closed 阻断（抛 `E_EVIDENCE_UNTRUSTED_KEY`）；
- **P015-P1 降级场景 2**：自带公钥在显式 `allowIntegrityOnly` 且非受控模式下降级为 `integrity_only`；
- **P015-P2 负向场景 3**：未知密钥 / 密钥不匹配时阻断合并（抛 `EVIDENCE_SIGNATURE_INVALID`）；
- **P015-P2 负向场景 4**：伪造信任来源（声称受信 keyId 但实际公钥非受信）阻断合并；
- **P015-P2 负向场景 5**：载荷变更（签名后篡改 Evidence 内容）阻断合并；
- **P015-P2 负向场景 6**：签名密文损坏阻断合并；
- **P015-P2 负向场景 7**：Contract 错绑阻断合并（抛 `E_CONTRACT_NOT_FOUND`）；
- **P015-P2 负向场景 8**：Candidate Commit 错绑阻断合并（工作区变更或提交不符抛 `E_EVIDENCE_FINGERPRINT_MISMATCH` / `E_EVIDENCE_STALE`）；
- **P015-P3 正向流程**：配置合法可信密钥路径时顺利通过受控合并，并在 Git 提交注入 `Evidence-Sha256` 与 `Evidence-Signature` Trailer。

---

## 3. Scope B：合并事务与恢复一致性审计

### 3.1 入口与调用链枚举
| 入口标识 | 入口位置 | 协议/触发源 | 核心调用链 | 锁与并发控制 |
|---|---|---|---|---|
| **E1: HTTP Merge** | `daemon/http/contract-routes.ts:716-780` | `POST /api/contracts/:id/merge` | 路由解析 -> `squashMerge` -> `store.updateState("MERGED")` -> `store.closeRound` | 契约级锁 `withContractLock` |
| **E2: Core Squash** | `daemon/pipeline/merger.ts:814-1274` | `squashMerge` / `executeMerge` | 门禁阶段 (8道检查) -> Git Squash 合流 -> 提交留痕 -> 记录归档 -> 公开交付 | 契约级锁 `withContractLock` |
| **E3: Archive Pipeline** | `daemon/pipeline/records-archive.ts:40-96` | `archiveContractRecords` | 提取 Evidence / Audit / Signatures -> 归档至 `.stagent/archive/` | 无独立锁，依赖 E2 的上下文执行 |
| **E4: Delivery Closure** | `src/lib/state/terminal-delivery-closure.ts:48-96` | `publicDeliveryCopy` | 导出任务产物并建立终端展品闭环 | 无独立锁，依赖 E2 的上下文执行 |

### 3.2 门禁检查与 Git 操作临界边界（TOCTOU 审计）
在 `merger.ts:mergeInternal` 中，合流操作严格划分为两个阶段：
1. **PRE_MERGE 门禁核验（只读核查阶段）**：
   - 顺序执行：生命周期状态校验 -> 磁盘 Evidence 校验 -> Revision 匹配核验 -> 测试资产基线未篡改（`assertTestAssetManifestPreserved`） -> Ed25519 信任根与签名校验（`assertEvidenceSignatureGate`） -> Candidate 提交绑定校验（`assertCandidateCommitBound`） -> 工作区指纹比对（`assertWorktreeFingerprint`） -> 主线前进校验（`assertTargetBranchNotAdvanced`）。
2. **Git 临界操作（写入与提交阶段）**：
   - `git merge --squash` 引入候选改动；
   - 冲突检测与回滚；
   - 注入审计 Trailer 并执行 `git commit`。

**TOCTOU 风险与防御假设审计**：
- **当前防御**：门禁与 Git 操作均包裹在 `withContractLock(contractId)` 临界区内，保证单个合同不能并发重入；
- **潜在 TOCTOU 窗口**：在 `assertTargetBranchNotAdvanced`（读取目标分支 HEAD）与 `git commit` 之间，若外部进程或另一合同向主线分支提交，可能引发主线隐式交叉前进；
- **Git 层面自然防御**：若外部发生冲突，Git squash/commit 会自然报错中断；
- **归属挂账**：多合同并发合流排他锁，属于已挂账项 `multi-worktree-cross-talk` 与多任务并发调度范畴，本卡不自行制造超范围锁机制。

### 3.3 失败、重试与恢复一致性审计
1. **门禁阶段失败**：完全只读，工作区、Git 历史与合同状态保持原样，可重试；
2. **Git 合并冲突（Squash Failure）**：
   - `merger.ts` 捕获异常后立即执行 `git merge --abort`，清理主线临时工作索引，确保主线工作区干净；
   - 抛出结构化 `MergeGateError(E_MERGE_CONFLICT)`，暴露冲突文件列表，供用户或调度器决策；
3. **提交后副作用失败（归档 / 交付闭环）**：
   - `merger.ts:1151` 与 `1164` 采用隔离捕获设计（`try { ... } catch (err) { logger.warn(...) }`）；
   - **审计判定**：这是务实的设计——Git 提交已落地且不可逆，不应因辅助性文件拷贝失败而使已合流的提交处于未定状态；但缺少后台异步重试队列；
   - **审计建议**：归档与公开交付若需严格事务一致性，应在后续引入持久化 Outbox 或幂等归档补偿机制。

---

## 4. 缺口映射与去重闭环

严格遵照 `pr468-dedup-crosswalk-task-p0-15.md`：
- **不立新卡、不重复施工**：
  - 硬件级 Attestation：按拍板排除；
  - 跨层沙箱大规模改造：按拍板排除；
  - 归档补偿队列与多合同并发主线锁：分别映射并挂账至 `multi-worktree-cross-talk` 及未来后台可靠性卡，本卡不新增施工路径。

---

## 5. 诚实口径与风险保留

1. **信任根强制已完成代码与测试闭环**：受控合并已完全消除自带公钥自签越权的漏洞；
2. **事实边界保留**：
   - 不宣称 P0 安全风险完全消除；
   - 不宣称合并事务达到分布式 ACID 数据库级别；
   - 不宣称不存在外部跨进程 Git 竞争风险；
3. 状态维持：主线其余挂账项（Nonce 持久化、Scope C 残余、真实派工、跨平台沙箱穿透、OS 沙盒等）继续维持，不越权关闭。
