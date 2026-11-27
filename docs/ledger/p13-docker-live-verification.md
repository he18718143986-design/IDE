# Docker 在场补验：容器隔离策略与证据链字段核销（TASK-P1.5 · P-355 施工记录）

> **地位**：实测记录。施工权威在 [`../specs/development-tasks-active.md`](../specs/development-tasks-active.md#task-p1.5)。
> **基线**：`main` `b5be59f574ee587a1655de5e54b361f130569ba6`（[#462](https://github.com/he18718143986-design/IDE/pull/462) P-354 立卡）。
> **执行**：2026-11-28 06:07–06:12 香港时间（操作者由我执行）。
> **不含**：`SANDBOX_ENFORCED` + OpenHands 真实派工（需 GB 级固定摘要镜像 + 容器内模型凭据 + 真实模型花费，另案）。

---

## 1. 环境指纹

| 维度 | 值 |
| :--- | :--- |
| OS | macOS **27.2.1**（Build `26B131`），`darwin` / `arm64` |
| Node / npm | `v22.23.4` / `10.9.9` |
| Docker Client / Server | **29.6.1** / **29.6.1** |
| Docker OperatingSystem | Docker Desktop |
| KernelVersion | **6.12.76-linuxkit** |
| StorageDriver | **overlayfs** |
| CPUs / MemTotal | **18** / **8,319,213,568 B（≈7.9 GiB）** |
| socket | `~/.docker/run/docker.sock` 存在 |
| 测试镜像 | `alpine:3.20`，13.7 MB，digest `sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc` |
| 代码基线 | `b5be59f574ee587a1655de5e54b361f130569ba6`（分支 `feat/p15-docker-live-verification`） |

### 1.1 Docker Desktop 启动踩坑（如实记录）

`open -a Docker` 首次启动时 VM 起来后**约 8 秒被回收**：`com.docker.virtualization.log` 记 `watchdog detected parent process disappeared`，`monitor.log` 记 `com.docker.backend fork: signal: killed`。原因是该进程挂在发起命令的 shell 会话下，命令结束即被一并终止。

改用 `launchctl submit -l stagent.docker.launch -- /usr/bin/open -a /Applications/Docker.app` 挂到 launchd 后脱离会话，12 秒内 socket 出现，20 秒后复测仍存活。**结论：本机启动 Docker Desktop 必须脱离 shell 会话。**

### 1.2 残留测试 Daemon 清理

| 阶段 | 结果 |
| :--- | :--- |
| 清理前 | `pgrep -f "vitest/stagent-ds2-api-parent"` → **6 个**：`13245` `13357` `28531` `28599` `61644` `61703` |
| 操作 | 逐个 `kill -9`（全部返回 killed） |
| 清理后 | `pgrep` 复测 **0** |
| 3001 端口 | 试玩 Daemon **pid 46636** 仍在监听，未受影响 |

---

## 2. `probeDocker()` 修证（P13D-P1）

### 2.1 修前缺陷

`scripts/verify-p0-independent-suite.ts` 原实现只跑 `docker --version`（客户端二进制）就判 `available: true`。于是「装了 Docker CLI 但 daemon 没起」会被记成 `docker_available: true`，让「无容器环境跳过」与「容器存在但场景失败」在报告里长得一样，跳过归因失真。

### 2.2 修后三态

| 场景 | `available` | `version` | `reason` |
| :--- | :--- | :--- | :--- |
| daemon 可达（`docker info --format {{.ServerVersion}}` 成功） | `true` | `Docker version 29.6.1, build 8900f1d (server: 29.6.1)` | 不写 |
| 客户端在、daemon 不在 | `false` | 客户端版本原文 | **`docker_client_only`** |
| 客户端都没有 | `false` | `NOT_AVAILABLE` | `docker_not_installed` |

`EnvFingerprint` 增可选字段 `docker_probe_reason`；markdown 矩阵增「Docker 判定归因」行（daemon 可达时显示 `daemon_reachable`）。

### 2.3 三态实测输出

| 场景 | 实际输出 |
| :--- | :--- |
| daemon 在场 | `{"available":true,"version":"Docker version 29.6.1, build 8900f1d (server: 29.6.1)"}` |
| 仅客户端（`PATH` 前置桩 `docker`：`--version` 成功、`info` 失败） | `{"available":false,"version":"Docker version 29.6.1, build 8900f1d","reason":"docker_client_only"}` |
| 无 docker（`PATH` 剥掉 docker） | `{"available":false,"version":"NOT_AVAILABLE","reason":"docker_not_installed"}` |

### 2.4 daemon 不在时仍归 skipped，不误判 failed

用「仅客户端」桩跑完整套件：

| 指标 | 值 |
| :--- | :--- |
| `docker_available` | `false` |
| `docker_probe_reason` | `docker_client_only` |
| `total_tests` | 14 |
| `passed` | 8 |
| **`skipped_no_docker`** | **6** |
| **`failed`** | **0** |
| `verdict` | `PARTIAL` |
| `TC-P0-3A/3B/3C` | 全为 `SKIPPED_NO_DOCKER`（0ms） |

即：**归因正确、无一例被记成 FAILED**。

---

## 3. 容器隔离实跑（P13D-P2 / P13D-P3）

### 3.1 三项此前跳过的用例，本轮真实执行

`STAGENT_TEST_CONTAINER_IMAGE=alpine:3.20 STAGENT_LIVE_DOCKER_TEST=1 npx vitest run tests/daemon/p1-3-cross-platform-penetration.test.ts`

| 用例 | 结果 | 耗时 | 断言依据 |
| :--- | :--- | :--- | :--- |
| `TC-P0-3A` 根工作树只读写阻断 | **PASSED** | 1306ms（另轮 179ms / 178ms） | 容器内写只读根文件 → `exit != 0` 且 `stderr` 含 `Read-only file system`；宿主 `package.json` 未被污染 |
| `TC-P0-3B` `.git` 篡改遮蔽阻断 | **PASSED** | 229ms（另轮 166ms / 170ms） | 容器内删改 `/work/.git` 不生效；宿主 `.git` 哈希严格一致 |
| `TC-P0-3C` 验收阶段全量只读拦截 | **PASSED** | 208ms（另轮 164ms / 201ms） | `readonly_enforced` 下即使写「授权路径」也 `Read-only file system` |

该文件整体：`Test Files 1 passed`、`Tests 10 passed (10)`（0 skip）。

### 3.2 套件裁决：`PARTIAL` → `PASSED`

`npx tsx scripts/verify-p0-independent-suite.ts --json`（Docker 在场）：

| 指标 | 修前（无 daemon） | 本轮（daemon 在场） |
| :--- | :--- | :--- |
| `total_tests` | 14 | **14** |
| `passed` | 11 | **14** |
| `skipped_no_docker` | 3 | **0** |
| `failed` | 0 | 0 |
| **`verdict`** | `PARTIAL` | **`PASSED`** |
| Digest（示例一轮） | `40107197385f8cb3…` | `aec28d705ee7b13569969aeec6f7a2ab60e535e993006a393626c8f0df317f39` |

> Digest 含 `timestamp`，每次运行都会变；矩阵文件里的 digest 与同次写入一致，跨轮不可比。

### 3.3 直接压测（绕过 vitest，走真实 `DockerContainerHost`）

| 验证项 | 实测输出 | 判定 |
| :--- | :--- | :--- |
| **网络 `DENY`** | `wget: can't connect to remote host (1.1.1.1): Network unreachable` | **实跑通过**（无出网） |
| **非 DENY fail-closed** | `via=rejected`、`rejection=NETWORK_TARGET_NOT_ALLOWED`、`exitCode=null`、`stderr="[NETWORK_TARGET_NOT_ALLOWED] network policy EXPLICIT_TARGETS requires non-empty allowedTargets"` | **实跑通过**（拒绝而非静默放行/静默断网，且未产生容器） |
| **越界写**（`package.json` 不在 `writable_paths`） | `sh: can't create /work/package.json: Read-only file system`；宿主文件未污染 | **实跑通过** |
| **`.git` tmpfs 遮蔽** | 容器内读回自己写的 `hacked`，但**宿主 `.git/HEAD` 严格不变** | **实跑通过** |
| **`readonly_enforced`** | `sh: can't create /work/src/allowed.ts: Read-only file system`；宿主文件不变 | **实跑通过** |

> 实现细节：`run()` 的 fail-closed 是**返回 `outcome.rejection`**，不抛异常（`docker-container-host.ts:378-390`）。首版探针按「抛异常」写，读到 `null`；修正后复跑得上述结果。此点保留，避免读者误以为拒绝路径未生效。
>
> 残留检查：`docker ps -a --filter label=stagent.sandbox=1` → **0 个**（全部 `--rm` 清理）。

---

## 4. 证据链字段核对（P13D-P4）

### 4.1 Ed25519 签名凭据

| 项 | 事实 | 来源 |
| :--- | :--- | :--- |
| 算法 | `Ed25519`，`node:crypto` 原生，零外部依赖 | `daemon/pipeline/evidence-signer.ts:1-20` |
| 规范化 | RFC 8785 JCS（键按 UTF-16 排序、无空格） | `evidence-signer.ts:41-62` |
| 签名记录字段 | `algorithm` / `signature` / `canonical_hash` / `key_id` / `public_key` / `signed_at`（实测 6 个键） | 实测 `signEvidencePayload` |
| 实测形状 | `canonical_hash` 长度 **64**（sha256 hex）、`signature` 长度 **88**（base64 Ed25519） | 实测 |
| 私钥位置 | `~/.stagent/keys/evidence-ed25519.pem`，**不在仓库内、不在 evidence 目录** | 实测 `getDefaultPrivateKeyPath` |
| 私钥权限 | 八进制 **`400`** | 实测 `statSync().mode & 0o777` |
| 内嵌字段 | 证据 JSON 顶层可含 `signature`（`bundle.signature = sigRecord`） | `orchestrator.ts:2866-2867` |
| 独立凭据 | `.stagent/signatures/<contract_id>-<evidence_id>.sig`（JSON 落盘） | `orchestrator.ts:2878-2885` |
| 合并侧读取 | 优先独立 `.sig`，回退内嵌 `signature`；两者皆无 → `EVIDENCE_SIGNATURE_MISSING` | `merger.ts:145-183` |
| 验签失败 | `EVIDENCE_SIGNATURE_INVALID`（含「签名损坏、公钥不匹配、内容遭篡改」） | `merger.ts:115-116, 186-195` |

**篡改拒绝实测**：对已签名载荷的 `verdict.can_merge` 改值后验签 → `{ ok: false, reason: "Missing or malformed signature record" }`；未篡改时通过。单测 `tests/unit/evidence-signer.test.ts` 的 P12-P5 四条负例（改内容 / 改签名密文 / 缺结构 / 换公钥）全部通过。

**合并级签名拒绝实测**：套件 `TC-P0-1C`（非受控模式伪装）实际返回 `E_CANNOT_MERGE / EVIDENCE_SIGNATURE_INVALID`。

### 4.2 Git Trailer

代码注入点 `daemon/pipeline/merger.ts:564-572`，**四键**（+ 既有其它 trailer）：

| Trailer | 条件 |
| :--- | :--- |
| `Stagent-Evidence-ID` | 恒写 |
| `Evidence-Sha256` | 有 `evidenceSha256` 时 |
| `Evidence-Signature` | 有 `evidenceSignature` 时 |
| `Stagent-Evidence-Hash` | 有 `evidenceHash` 时 |

另有 `Stagent-Contract-ID` / `Stagent-Scheme-Items` / `Stagent-Verdict` / `Stagent-Approval-Status` / `Reviewed-By` / `Stagent-Tests-Modified`。

**真实合流提交实测**（试玩目录 `02110b6`）：

```
Stagent-Contract-ID: contract_1795588309763_cy8zx
Stagent-Scheme-Items: ITEM-2
Stagent-Evidence-ID: evi_1795638824033_hu2k0
Stagent-Evidence-Hash: 3c8a0b09a77afca97096d03791c75e7efbc3283cd9dd67abed415eeee8b19a12
Stagent-Verdict: PASSED
Stagent-Approval-Status: APPROVED
Reviewed-By: local-user
Stagent-Tests-Modified: true
```

**注意**：该提交**没有** `Evidence-Sha256` 与 `Evidence-Signature`——因为它产生于 P1.2 合流之前（见 §4.5）。

### 4.3 `test_integrity` 字段

现行 schema `src/lib/evidence.schema.ts:211-237`，实测 11 个键：

`tests_modified` / `modified_existing_tests` / `deleted_existing_tests` / `added_tests` / `exemption` / `baseline_rerun_triggered` / `baseline_rerun_passed` / `failure_code` / `failure_reason` / `restored_paths` / `weakened_tests`

**占位与真实重跑的区分**（`orchestrator.ts:2699-2738`）：

| 情形 | 记录 |
| :--- | :--- |
| 受控模式未传 `testIntegrity`，测试未改动 | `failure_reason: "placeholder:unmodified_tests_default"` |
| 受控模式未传 `testIntegrity`，但 `testsModified=true` | `failure_code: "E_TEST_BASELINE_REGRESSION"` + `failure_reason: "tests_modified_without_test_integrity_evaluation"`（fail-closed） |
| 真实隔离基线重跑 | `baseline_rerun_triggered: true`，成败写 `baseline_rerun_passed`；失败码 `E_TEST_BASELINE_REGRESSION` / `E_TEST_BASELINE_UNAVAILABLE` |

相关用例实测全绿（共 46 例）：`P04-I1`（改既有测试掩盖回归 → `E_TEST_BASELINE_REGRESSION`）、`P04-I2`（删除测试 → 阻断）、`P04-I3`（环境故障 → `E_TEST_BASELINE_UNAVAILABLE`）、`P04-I4`（合同显式豁免 → 放行并留痕）、`P04-I5`（merger 独立核验）、`P04-I6`（仅新增测试 → 零阻断）、`P013-I1` / `P013-I2`（Scope C/D 恢复异常与无可用命令 → fail-closed）、`P01A-P5`（占位与真实重跑的区分性）。

### 4.4 `SandboxWitness` 字段

`src/lib/evidence.schema.ts:165-181`，实测 11 个键：

`host_kind` / `via`（`exit`·`timeout`·`SIGKILL`·`rejected`）/ `exit_code` / `duration_ms` / `worktree_root` / `mount_mode` / `mount_count` / `nonce` / `contract_id` / `contract_revision` / `session_id`

- Nonce 绑定：`SANDBOX_ENFORCED` 派工前生成 CSPRNG Nonce，并把 `nonce` / `contract_id` / `contract_revision` / `session_id` 一并写入见证（`orchestrator.ts:1869-1880`、`:2041-2053`）。
- 见证写入与校验：`P03A-P3 & P03A-P5`（真实入箱见证落盘、有合法见证放行、缺见证阻断）、`P03A-P5 & P03A-P6`（伪造见证 fail-closed）、`P14-P3`（Nonce 绑定与重放防御 fail-closed）、`P01A-P3`（见证落盘与防伪）——全部实测通过。

### 4.5 现有试玩证据的前置缺口（如实记录）

试玩目录现存 `contract_1795588309763_cy8zx-evi_1795638824033_hu2k0.json` 的顶层键为：

`contract_id` / `evidence_id` / `generated_at` / `git_info` / `scope_audit` / `tests_modified` / `usage` / `verdict` / `verification_results` / `worker_control_mode` / `worktree_snapshot`

| 检查 | 结果 |
| :--- | :--- |
| `signature` 内嵌 | **无** |
| `.stagent/signatures/` | **0 个文件** |
| `test_integrity` | **无** |
| `sandbox_witness` | **无** |

原因：该证据产生于 `main 6d1590a`（2026-11-26 04:33），当时 P1.2（#440）、P0.2a、P0.3a 尚未合流。**因此「真实试玩数据」这一侧目前拿不到签名/见证/完整性记录；本轮字段核对以 schema + 代码 + 当场实测签名为准，不以旧证据冒充已签。** 要拿到带签名的真实合流，需要在新 main 上重跑一次试玩（不在本卡范围）。

---

## 5. 三处「文档 vs 代码」漂移（P13D-P4 要求如实列出）

| # | 文档写法 | 代码实际 | 证据 |
| :--- | :--- | :--- | :--- |
| 1 | `test_integrity.baseline_fingerprint: "none"` 占位 | **该字段不存在**。占位标识为 `failure_reason: "placeholder:unmodified_tests_default"`；`testsModified` 却无完整性证据时 `failure_code: E_TEST_BASELINE_REGRESSION` + `failure_reason: "tests_modified_without_test_integrity_evaluation"` | `evidence.schema.ts:211-237`、`orchestrator.ts:2699-2738` |
| 2 | `SandboxWitness.mount_scope` | **无 `mount_scope`**，实为 `mount_mode`（`scoped` / `readonly_enforced` / `legacy_full_rw`）+ `mount_count` | `evidence.schema.ts:165-181` |
| 3 | Git Trailer「`Evidence-Sha256` / `Evidence-Signature`」 | 是四键：`Stagent-Evidence-ID` + `Evidence-Sha256` + `Evidence-Signature` + `Stagent-Evidence-Hash` | `merger.ts:564-572` |

另记一处**生成器缺陷**（已在本卡修掉）：`probeDocker()` 原以 `docker --version` 判可用，daemon 不可达仍记 `docker_available: true`；markdown 矩阵 §2 的三行统计原为**硬编码**（`7 项实跑通过 / 3 项跳过`），与环境实际不符，已改为由本次结果派生。

---

## 6. 改动清单

| 文件 | 动作 | 说明 |
| :--- | :--- | :--- |
| `scripts/verify-p0-independent-suite.ts` | modify | `probeDocker()` 三态归因 + `docker_probe_reason` 落指纹 + 矩阵「判定归因」行 + §2 统计改由结果派生 + 新增 §6 历史基线留档 |
| `docs/ledger/p0-independent-verification-matrix.md` | modify | 生成器重写（Docker 在场：14/14、0 skip、`PASSED`）+ 历史基线表 |
| `docs/ledger/p13-docker-live-verification.md` | create | 本文件 |
| `tests/daemon/p1-3-cross-platform-penetration.test.ts` | **未改动** | 现有用例已覆盖三项容器实跑与跨平台判据；本卡未需新增用例（`daemon 不在仍归 skip` 已由 §2.4 实跑证明） |

**readonly 五文件零 diff**：`daemon/worker/cli-host/docker-container-host.ts`、`src/lib/evidence.schema.ts`、`daemon/pipeline/merger.ts`、`daemon/pipeline/evidence-signer.ts`、`daemon/pipeline/orchestrator.ts`。

---

## 7. 诚实口径（逐字）

1. **`alpine:3.20` 证明的是挂载 / 只读 / 网络策略的容器隔离行为**，**不等于 OpenHands 适配器实测**——OpenHands 的 `/app` 属主、`entrypoint.sh` 权限、固定摘要镜像那一层未覆盖。
2. **`P13-P2` / `P13-P3` / `P13-P4` 的 `PASSED` 是规格断言**（`resolveScopedMounts` / `prepareHostPlaceholders` / 路径规范化等纯函数）通过，**不是**在 Linux / macOS / Windows 宿主上真实跑过容器；跨平台容器运行验收仍未完成。
3. **不宣称 P0 风险解除**。本文件只核销「容器隔离策略在 darwin + Docker Desktop 上实测」与「证据链字段与代码一致」两件事。
4. 旧试玩证据缺 `signature` / `test_integrity` / `sandbox_witness`，属**前置缺口**，未以任何方式补写或冒充。
5. `SANDBOX_ENFORCED` + OpenHands 真实派工**未做**，需另案授权（GB 级镜像 + 容器内模型凭据 + 真实模型花费）。
