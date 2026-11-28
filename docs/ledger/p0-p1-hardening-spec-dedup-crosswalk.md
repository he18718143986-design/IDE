# docs/stagent-p0-p1-hardening-spec 分支规格去重对照与 TASK-P1.6 划界报告

> **生成流水**：P-362（2026-11-29 · 随 docs PR 交付）  
> **审计对象**：分支 `docs/stagent-p0-p1-hardening-spec` 提交 `4aa68449a01351c335a4845715d1a46d33bc843a` 之规格文件 `docs/specs/v0.1-p0-p1-hardening-remediation.md`（《Stagent v0.1 P0/P1 Hardening Remediation Specification》）  
> **对比基线**：仓库 `main` 分支最新 HEAD（`dd0ef3f0`，含 TASK-P0.16 完工回写 P-361 / #475）  
> **核查原则**：严格执行增量式防护与去重原则；已在主线闭环交付或完成审计项严禁重复立卡二次施工；唯一真实增量转立卡 `TASK-P1.6`；执行纪律核验对齐；分支保留作审计参考不删、不合入主线。  
> **诚实口径**：**本报告为去重映射与范围划界文档；不改动任何产品代码；硬件级 Attestation 缺失、Merger 不重跑全量测试、容器内无 OS 级二次沙盒、跨进程 Nonce 持久化未做、真实容器运行时 3/10 跳过项等五项事实边界继续保留；严禁宣称「P0 风险完全解除」**。

---

## 1. 背景与审计源

在 2026-11-29，远端分支 `docs/stagent-p0-p1-hardening-spec` 提交了 `4aa68449`，引入了规格文档 `docs/specs/v0.1-p0-p1-hardening-remediation.md`。该规格梳理了针对 Stagent v0.1 的 5 项补救任务定义（P0-A、P0-B、P1-A、P1-B、P1-C）、测试矩阵、Evidence 契约与执行纪律。

为避免在已有大量 P0/P1 闭环交付成果的基础上出现重叠立卡、代码返工或破坏已建立的门禁与诚实边界，本报告逐条比对该分支规格要求与现行 `main` 代码事实，明确各项任务的交付状态与处置去向。

---

## 2. 五项任务逐条去重映射矩阵

| 分支规格任务 | 规格目标与核心要求 | 现行 main 交付事实与证据 | 去重结论与处置建议 |
| :--- | :--- | :--- | :--- |
| **P0-A — Execution Assurance and policy-to-runtime binding** | 1. 显式化执行保障层级（L0 本地子进程 / L1 受限运行时 / L2 容器或 VM 隔离）并做 Schema 验证；<br>2. 执行记录绑定后端标识、策略指纹、平台、会话绑定与时间戳；<br>3. 缺失、失配、过期或不可验证 attestation 必须 fail-closed（判 BLOCKED）；<br>4. 合同固定命令与 Worker 自增命令均受同一授权边界管辖；<br>5. 严格区分工作树、进程约束与 OS 级隔离；<br>6. CI 运行对应检查，不可静默跳过。 | • **[`TASK-P0.3b-2`](../specs/development-tasks-completed.md#task-p0.3b-2)**（施工 [#434](https://github.com/he18718143986-design/IDE/pull/434)/`0a92eb7`，P-335）：实现容器文件系统 Scope 强制两阶段挂载，区分只读根与可写子树，`mount_mode` 与挂载计数纳入见证；<br>• **[`TASK-P0.1a`](../specs/development-tasks-completed.md#task-p0.1a)**（施工 [#455](https://github.com/he18718143986-design/IDE/pull/455)/`670860eb`，P-349）：执行链受控证明专项，派工至真实进程全链路追踪、异常路径枚举、见证真实性防伪核查、`os-sandbox.ts` 网络探测三态判据（`DENIED`/`UNKNOWN`/`ALLOWED`）与 UNKNOWN fail-closed 降级；<br>• **[`TASK-P1.5`](../specs/development-tasks-completed.md#task-p1.5)**（施工 [#463](https://github.com/he18718143986-design/IDE/pull/463)/`583c580`，P-355）：Docker 在场补验，真实容器隔离实跑（alpine:3.20），网络 `DENY` 与 `EXPLICIT_TARGETS` 拦截生效，证据链字段（`worker_control_mode`、`sandbox_witness`、Trailer 签名）全量核对闭环。 | **已交付，不重复施工**。<br>主线已有完备的容器挂载隔离、真实进程追踪、见证采集断言及网络出网探测。规格要求已在 P0.3b-2、P0.1a、P1.5 落地，无需二次开发。 |
| **P0-B — Independent Acceptance and protected baseline** | 1. 基线测试资产由 Daemon 受保护所有权控制，不可由 Worker 单方篡改；<br>2. 记录基线版本/指纹与候选提交指纹；<br>3. 检测基线资产变动、跳过、削弱与恢复失败，不确定检测不得报 PASS；<br>4. 独立于 Worker 自增测试运行基线验收；<br>5. 现场恢复失败阻断 PASS 和 merge；<br>6. 验收标准变更须经独立角色审批记录。 | • **[`TASK-P0.2a`](../specs/development-tasks-completed.md#task-p0.2a)**（施工 [#452](https://github.com/he18718143986-design/IDE/pull/452)/`b257c22c`，P-347）：受控 Evidence 强制必填 `test_integrity`，merger 缺失即拒（`E_CANNOT_MERGE`），9 项字段断言生效；<br>• **[`TASK-P0.13`](../specs/development-tasks-completed.md#task-p0.13)**（施工 [#459](https://github.com/he18718143986-design/IDE/pull/459)/`6122e347`，P-352）：基线验收独立性与现场恢复加固，`test-integrity.ts` 引入 `TestBaselineRecoveryError`，hide/restore 恢复失败 fail-closed 拦截，清理失败覆盖为 `E_TEST_BASELINE_UNAVAILABLE`，编排器降级 `BLOCKED`，merger 强断言拦截；<br>• **[`TASK-P0.14`](../specs/development-tasks-completed.md#task-p0.14)**（施工 [#466](https://github.com/he18718143986-design/IDE/pull/466)/`ee43d64e`，P-357）：测试资产基线登记，五类资产识别分类器，基于 Base Commit 生成不可变清单 `TestAssetManifest`，未登记测试资产与配置篡改（`E_TEST_CONFIG_MUTATED`）分级拦截，fixture/helper 自动还原重跑。 | **已交付，不重复施工**。<br>基线防篡改、不可变清单绑定、动态篡改检测与现场恢复失败 fail-closed 强拦截已在 P0.2a、P0.13、P0.14 全量交付。 |
| **P1-A — Evidence signing trust-root and verification policy** | 1. 区分信任层级（自声明、Pinned 本地密钥、授权签名者、外部信任锚点）；<br>2. Merger 必须从独立受信配置/注册表获取策略，不得仅凭 Evidence 自身公钥声明；<br>3. 签名载荷强绑定 contract_id、session、candidate、runtime attestation 等字段；<br>4. 拒绝非受信公钥、篡改载荷或不支持的版本；<br>5. 文档化密钥生命周期与威胁模型。 | • **[`TASK-P0.15`](../specs/development-tasks-completed.md#task-p0.15)** Scope A（施工 [#471](https://github.com/he18718143986-design/IDE/pull/471)/`ccaf6f19`，P-359）：Evidence 信任根强制与合并事务一致性审计，修证 `merger.ts` `assertEvidenceSignatureGate`：受控合并强制要求配置可信公钥或显式信任策略，Evidence 自带 `public_key` 严禁单独获得受控合并授权；缺可信根 fail-closed 抛 `E_EVIDENCE_UNTRUSTED_KEY`；无 expectedPublicKey 时完整性校验显式降级为 `integrity_only` 并阻断受控合并；9 项专项单测覆盖未知公钥、伪造信任来源、载荷篡改、签名密文损坏与 Contract 错绑。 | **已交付（规格基于旧快照），不重复施工**。<br>分支规格起草时基于旧快照，未识别主线已在 P0.15 全面落盘受控合并信任根校验规则与负向测试矩阵。 |
| **P1-B — Merge transaction, race, and recovery audit** | 1. 盘点所有 merge/retry/resume 入口；<br>2. 所有路径调用共享的集中门禁（Shared Gate）；<br>3. 在合流边界即时复查候选提交指纹，杜绝竞态 TOCTOU；<br>4. 明确并发锁属主、超时与争用语义；<br>5. 明确合并后处理、补偿边界、归档语义与中断恢复；<br>6. 门禁失败输出结构化拒绝原因与 Evidence 记录。 | • **[`TASK-P0.15`](../specs/development-tasks-completed.md#task-p0.15)** Scope B（[#471](https://github.com/he18718143986-design/IDE/pull/471) / [`docs/ledger/p0-15-merge-transaction-and-trust-audit.md`](./p0-15-merge-transaction-and-trust-audit.md)）：系统枚举 E1–E4 四大合流与交付入口，审查 PRE_MERGE 门禁阶段（8 道检查只读）与 Git Squash 临界边界，确认 `withContractLock` 单合同锁与并发冲突防御，排查失败回滚逻辑，并将归档补偿挂账立项；<br>• **[`TASK-P0.16`](../specs/development-tasks-completed.md#task-p0.16)**（施工 [#474](https://github.com/he18718143986-design/IDE/pull/474)/`abf25163`，P-361）：Records Archive 与公开交付副本幂等补偿修证，实现 `compensateContractRecordsArchive`（`contract_id` 幂等键、比对跳过、损坏原子覆写、断点续拷、`.tmp-*`+`rename` 原子提交）、显式重试入口与 `deliveryTerminal` 状态收敛（`delivery_complete: true`）。 | **已交付（审计落盘 + 幂等补偿），不重复施工**。<br>合并入口审查、门禁共享、临界边界与归档副本幂等补偿已通过 P0.15 Scope B 与 P0.16 完工闭环。 |
| **P1-C — Cross-layer invariants and state projection** | 1. 文档化各状态字段的权威属主；<br>2. 集中定义不变量与状态转换矩阵；<br>3. UI 投影为派生属性，不可篡夺执行、验证或合并授权；<br>4. 非法或矛盾状态 fail-closed 并暴露恢复入口；<br>5. 增加状态转换矩阵与矛盾状态测试覆盖。 | • 现行主线虽然在核心 `merger.ts`（PRE_MERGE 8 门禁）、`ContractStore` 状态机与 `terminal-delivery-closure.ts` 中已有关键状态保护，但关于 **Lifecycle / Delivery / Presentation 三层状态投影点** 的系统性全量枚举、跨层矛盾组合（如 UI 显示 DELIVERED 但 merge gate 未过或合同仍为 EXECUTING）在代码层面的可达性分析，以及相关不变量测试覆盖缺口，尚未单独形成专项盘点报告。 | **唯一真实增量，转立新卡 TASK-P1.6**。<br>作为该规格中唯一具备独立价值的新增审计需求，转为审计型任务卡 `TASK-P1.6`（跨层状态一致性盘点评估，估算 S），只做盘点不改产品代码。 |

---

## 3. 规格执行纪律与现行规范核对

分支规格 §5（Contract-driven execution sequence）、§6（Definition of Done）与 §7（Audit limitations and risk communication）提出了系列执行纪律，核对结论如下：

1. **Worker 不得单方改动验收标准**：与主线现行卡面标准（[`../specs/task-card-standard.md`](../specs/task-card-standard.md)）、`verification_spec.commands` 审批冻结机制以及 `TASK-P0.2a` 验收依据不可篡改机制完全一致；
2. **环境不可用不得转为 PASS**：与主线现行 `[PASSED]` / `[PARTIAL]` / `[BLOCKED]` 三态判据（见 `TASK-P1.3`、`TASK-P1.3a` 与 `TASK-P1.5`）以及 fail-closed 原则完全一致；
3. **验收绑定候选指纹与基线指纹**：与主线 `EvidenceBundle` 中 `candidate_commit_sha`、`base_commit_sha` 及 `TestAssetManifest` 强绑定机制完全一致；
4. **UI 状态不得作为安全授权依据**：与主线三 Agent 架构（J 系列规范，中栏 Supervisor 方案画布 / 右栏只读 AI / Worker 在隔离工作树施工，UI 仅为纯只读投影）完全一致；
5. **诚实沟通与限制说明**：与主线每张卡强制要求保留的五项事实边界声明（硬件级 Attestation 缺失、Merger 不重跑全量测试等）完全对齐。

**核对结论**：上述执行纪律要求均为现行主线早已严格执行的日常工程规范，**与现行卡面纪律一致，非新发现**。

---

## 4. 分支处置结论与后续建议

1. **分支保留作审计参考**：`docs/stagent-p0-p1-hardening-spec` 分支（commit `4aa68449`）作为外部规格审计输入的历史凭证，**永久保留在远端仓库，不予删除，亦不合入主线原文**（避免引入未适配的重叠文本）；
2. **增量转立 TASK-P1.6**：将 P1-C 增量收敛至 `TASK-P1.6`（跨层状态一致性盘点评估，估算 S，审计型），仅落盘盘点报告，不改任何产品代码；
3. **主线施工队列维持**：本报告落盘后，main 仍无处于 `READY` 或 `IN_PROGRESS` 的施工卡，`TASK-P1.6` 处于 `NEW_TASK`，待 Tina 明确点名授权。
