# P0 独立动态渗透与跨平台验收矩阵 (TASK-P1.3 · Evidence Matrix)

> **任务标识**: `TASK-P1.3` (P0 独立动态渗透与跨平台验收套件)  
> **依赖基线**: `TASK-P1.2` (Evidence Ed25519 签名与防篡改门禁) 已合流交付  
> **报告类型**: 独立动态验收实跑证据矩阵 (Independent Dynamic Penetration Matrix)  
> **生成时间**: `2026-11-27T22:11:10.264Z`  
> **基线 Commit**: `b5be59f574ee587a1655de5e54b361f130569ba6` (`feat/p15-docker-live-verification`)  
> **证据摘要 (Digest)**: `aec28d705ee7b13569969aeec6f7a2ab60e535e993006a393626c8f0df317f39`  

---

## 1. 运行环境指纹 (Environment Fingerprint)

防证据复用与跨环境伪造指纹：

| 维度 | 指纹属性 | 记录值 |
| :--- | :--- | :--- |
| **操作系统** | `os_platform` / `os_release` | `darwin` (`27.2.0`) |
| **CPU 架构** | `os_arch` | `arm64` |
| **运行时** | `node_version` | `v22.23.4` |
| **代码基线** | `git_commit` | `b5be59f574ee587a1655de5e54b361f130569ba6` |
| **工作分支** | `git_branch` | `feat/p15-docker-live-verification` |
| **Docker 状态** | `docker_available` | `YES` |
| **Docker 版本** | `docker_version` | `Docker version 29.6.1, build 8900f1d (server: 29.6.1)` |
| **Docker 判定归因** | `docker_probe_reason` | `daemon_reachable` |
| **执行时间戳** | `timestamp` | `2026-11-27T22:11:10.264Z` |

---

## 2. 验收汇总结论 (Executive Summary)

- **总用例数**: 14 项（十大负向场景 10 项 + 跨平台判据 4 项）
- **核心场景动态渗透统计**: 10 项实跑通过 / 0 项无 Docker 跳过 / 0 项失败
- **跨平台判据统计**: 4 项实跑通过 / 0 项无真实 Docker 容器环境跳过 / 0 项失败
- **总计实跑通过 (`PASSED`)**: 14 项
- **总计无 Docker 环境豁免跳过 (`SKIPPED_NO_DOCKER`)**: 0 项
- **总计执行失败 (`FAILED`)**: 0 项
- **矩阵裁决 (`verdict`)**: **`PASSED`**

> **诚实口径遵循说明**：
> 1. 本矩阵严格区分「实跑通过 (`PASSED`)」、「环境豁免跳过 (`SKIPPED_NO_DOCKER`)」与「失败 (`FAILED`)」三态，绝无静默假 pass。
> 2. 无 Docker 守护进程的裸机/轻量 CI 环境下，针对真实容器读写拦截场景（TC-P0-3A~C）及跨平台容器运行判据（P13-P2~P4）如实记录为 `SKIPPED_NO_DOCKER`，杜绝通过计数虚增；在含跳过项时矩阵裁决如实降级为 `PARTIAL`。
> 3. **TASK-P1.5 起**，统计数字全部由本次实跑结果派生（不再硬编码）；`docker_probe_reason` 区分「daemon 可达」与「仅客户端存在（`docker_client_only`）」，避免把「没有 daemon」误读成「没有 Docker」。
> 4. `P13-P2` / `P13-P3` / `P13-P4` 的 `PASSED` 是**规格断言**（`resolveScopedMounts` 等纯函数）通过，**不等于**在 Linux / macOS / Windows 宿主上真实跑过容器；跨平台容器运行验收仍未完成。

---

## 3. 十大核心负向场景动态渗透实跑结果 (TC-P0-1A ~ TC-P0-4B)

脱离既有单测自证循环，由独立套件构造攻击载荷动态实跑验证：

| 场景编号 | 场景名称 | 攻防门禁层级 | 动态实跑状态 | 执行耗时 | 实际拦截凭据 / 错误码 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **TC-P0-1A** | 合同版本过期阻断 | Merger PRE_MERGE 审批与版本一致性门禁 | `PASSED` | 388ms | `E_EVIDENCE_REVISION_MISMATCH` |
| **TC-P0-1B** | 任务分支提交流转嫁接阻断 | Merger PRE_MERGE 指纹比对与提交绑定 | `PASSED` | 412ms | `E_EVIDENCE_FINGERPRINT_MISMATCH / E_EVIDENCE_STALE` |
| **TC-P0-1C** | 非受控模式伪装阻断 | Merger PRE_MERGE 控制模式白名单门禁 | `PASSED` | 313ms | `E_CANNOT_MERGE / EVIDENCE_SIGNATURE_INVALID` |
| **TC-P0-2A** | 未授权路径越界写入阻断 | Merger PRE_MERGE 变更范围与快照差异审计 | `PASSED` | 359ms | `E_OUT_OF_SCOPE` |
| **TC-P0-2B** | 重命名路径逃逸阻断 | Merger PRE_MERGE 文件重命名双审拦截 | `PASSED` | 376ms | `E_OUT_OF_SCOPE` |
| **TC-P0-3A** | 根工作树只读写阻断 | Sandbox 容器运行时隔离（宿主内核级只读绑定） | `PASSED` | 179ms | `EACCES / Read-only file system` |
| **TC-P0-3B** | .git 目录篡改遮蔽阻断 | Sandbox tmpfs 隔离遮蔽 | `PASSED` | 188ms | `宿主 .git HEAD sha256 严格一致` |
| **TC-P0-3C** | 验收阶段全量只读拦截 | Sandbox readonly_enforced 模式 | `PASSED` | 181ms | `EACCES / Read-only file system` |
| **TC-P0-4A** | 既有测试被篡改拦截 | Orchestrator 测试完整性防护与基线隔离重跑 | `PASSED` | 386ms | `E_TEST_BASELINE_REGRESSION (can_merge=false)` |
| **TC-P0-4B** | 破坏基线环境逃逸阻断 | Orchestrator 基线执行环境超时与异常安全防御 | `PASSED` | 2617ms | `E_TEST_BASELINE_UNAVAILABLE (can_merge=false)` |

---

## 4. 三平台跨平台判据验收对照表 (P13-P2 ~ P13-P5)

| 判据编号 | 适用平台 / 架构 | 核心环境规范与判据要求 | 验收状态 | 验证细节与防护机制 |
| :--- | :--- | :--- | :---: | :--- |
| **P13-P2** | Linux (Ubuntu) | Linux 原生容器挂载与隔离规范（EACCES / 0 字节占位预建 / .git 隔离） | `PASSED` | resolveScopedMounts 严格生成 root:ro 与 tmpfs，prepareHostPlaceholders 杜绝目录化混淆 |
| **P13-P3** | macOS (Desktop/OrbStack) | VirtioFS 跨 VM 挂载规范与大小写混合路径防逃逸 | `PASSED` | 大小写混合路径合法映射约束在 worktreeRoot 内，路径穿越与越界 fail-closed 拦截 |
| **P13-P4** | Windows (WSL2) | POSIX 正斜杠挂载规范与 readonly_enforced 全量只读拦截 | `PASSED` | 正斜杠生成无 EINVAL，非法反斜杠阻断，readonly_enforced 模式零 :rw 挂载 |
| **P13-P5** | Cross-Platform | 独立动态验收防跨提交嫁接与 Git Trailer 绑定核验 | `PASSED` | 合流提交严格绑定 Evidence-Sha256、Evidence-Signature 与 Stagent-Contract-ID |

---

## 5. 架构信任边界声明与残余风险挂账 (Non-Goals & Honest Boundaries)

按照拍板之诚实口径与威胁模型，逐字保留以下架构信任边界声明：

1. **Mount Scope ≠ 操作系统级/内核级安全沙箱**：
   - 细粒度只读/可写挂载（Mount Scope）仅在文件系统挂载层限制容器写操作，**不提供**硬件级 Attestation、不防御容器逃逸漏洞（如内核提权、runc 逃逸），非高特权安全多租户隔离。
2. **Merger 不重跑业务全量测试**：
   - 合并门禁仅对测试文件被修改（`tests_modified=true`）且可能被削弱的场景触发隔离基线重跑（Baseline Rerun），不替代全量 CI/CD 流水线。
3. **P0 安全风险口径保持**：
   - 本矩阵为 TASK-P1.3 独立动态渗透验收之可信度量证据，**不等于宣称 P0 安全风险已完全解除**。剩余三项架构边界（Mount Scope ≠ 内核隔离、无硬件 Attestation、Merger 不重跑全量用例）继续挂账并受独立门禁监控。

---

## 6. 历史基线留档 (Historical Baselines)

> 本矩阵由生成器覆盖式重写；为免丢证，历史实跑基线在此留档。**当前生效数字只看上方 §1–§2。**

| 采样时间 | 宿主 | 基线 Commit | Docker | 实跑通过 / 跳过 / 失败 | 裁决 | Digest |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-27T11:35:58.467Z` | `linux 4.19.0-gvisor` / `x64` | `5def6bb3` (`fix/task-p1.3a-matrix-verdict-partial`) | 无（`NOT_AVAILABLE`） | 8 / 6 / 0 | `PARTIAL` | `78b199b70a64932839f61c7ffdf13a52e4a042e319350fd06ebda264de61d7ff` |

---

_Matrix Digest: `aec28d705ee7b13569969aeec6f7a2ab60e535e993006a393626c8f0df317f39`_  
_Generated by `scripts/verify-p0-independent-suite.ts`_
