

---

### 3.4ch DockerContainerHost 接入 Scope 挂载规格、集成负向测试与见证增强（P0.3b-2 · 完工回写 P-335）

> 两卡共用立卡说明与审批边界保留在 [`development-tasks-active.md`](./development-tasks-active.md#task-p0.3b-2) §3.4cd。

<a id="task-p0.3b-2"></a>

#### 【Task P0.3b-2】DockerContainerHost 接入 Scope 挂载规格、集成负向测试与见证增强 `[COMPLETED]`

```yaml task-card
id: TASK-P0.3b-2
status: COMPLETED
contract:
  intent:
    title: DockerContainerHost 接入 Scope 挂载规格、集成负向测试与见证增强
    description: >-
      做完后，DockerContainerHost.run 完整接入 P0.3b-1 的 resolveScopedMounts 挂载规格：
      支持施工期细粒度 scoped 模式与验收期全量只读 readonly_enforced 模式；
      集成负向测试在有 Docker 环境下验证容器写 Scope 外路径及 .git 均被操作系统物理拒绝（EACCES），写授权路径成功；
      SandboxWitness 扩充记录实际生效的 mount_mode 与 mount_count，并在 verifySandboxWitness 中断言有效性；
      STAGENT_DISABLE_CONTAINER 运维逃生门语义不变，既有 GATEWAY_ENFORCED 路径零回归。
    risk_level: HIGH
  acceptance:
    - id: P03B2-P1
      check: auto
      text: >-
        DockerContainerHost.run 接入挂载规格执行：施工阶段以 scoped 模式按授权路径挂载读写点；
        验收阶段（mountMode === "readonly_enforced"）严格仅生成宿主根目录只读挂载（-v hostRoot:/work:ro）且无任何 :rw 挂载。
    - id: P03B2-P2
      check: auto
      text: >-
        集成负向阻断测试（有 Docker 环境）：容器内进程写 Scope 外只读路径物理失败抛 EACCES；
        写 /work/.git 物理失败抛 EACCES 或只读被拒；写 writable_paths 内授权文件正常成功；
        无 Docker 环境如实跳过并显式标注，严禁虚假断言。
    - id: P03B2-P3
      check: auto
      text: >-
        见证链记录挂载姿态：SandboxWitness 扩充 mount_mode（"scoped" | "readonly_enforced" | "legacy_full_rw"）
        与 mount_count 字段，真实反映容器启动参数，并随 EvidenceBundle 原子落盘。
    - id: P03B2-P4
      check: auto
      text: >-
        verifySandboxWitness 增加模式有效性断言：校验 mount_mode 必须为受控已知模式，严禁伪造或非法姿态通过校验；
        双重门禁（生成与合并阶段）持续 fail-closed 拦截。
    - id: P03B2-P5
      check: auto
      text: >-
        STAGENT_DISABLE_CONTAINER 运维逃生门语义不变：启用时记录 WARNING 并以 UNCONTROLLED_EXTERNAL 留痕，严禁冒认受控姿态。
    - id: P03B2-P6
      check: auto
      text: >-
        既有 GATEWAY_ENFORCED、生产 Daemon 装配及全部既有测试套件零回归；
        诚实口径记录容器 OS 级只读能力边界，不宣称硬件级安全防护，不宣称 P0 风险解除。
  scheme_item_ids: []
  scope:
    writable_paths:
      - daemon/worker/cli-host/docker-container-host.ts
      - daemon/worker/sandbox/container-host.ts
      - daemon/pipeline/orchestrator.ts
      - daemon/worker/cli-host/openhands-adapter.ts
      - daemon/worker/sandbox/container-cli-executor.ts
      - src/lib/evidence.schema.ts
      - tests/unit/docker-container-host-mounts.test.ts
      - tests/daemon/p0-3b-container-scope-fail-closed.test.ts
    readonly_paths:
      - src/lib/contract.schema.ts
      - daemon/pipeline/merger.ts
      - daemon/pipeline/candidate-scope-audit.ts
      - daemon/guard/test-integrity.ts
      - daemon/worker/worker-adapter.interface.ts
  verification:
    commands:
      - { alias: docker-mounts-unit, executable: npx, args: [vitest, run, tests/unit/docker-container-host-mounts.test.ts] }
      - { alias: p03b-daemon-test, executable: npx, args: [vitest, run, tests/daemon/p0-3b-container-scope-fail-closed.test.ts] }
      - { alias: typecheck, executable: npx, args: [tsc, --noEmit] }
design:
  approach: >-
    1) 扩展 SandboxRunInput 与 OpenHands/CLI adapter，支持传入 scope: { writable_paths: string[] } 与 mount_mode。
    2) 修改 DockerContainerHost.run，调用 P0.3b-1 的 resolveScopedMounts 生成 docker 参数，在容器启动前执行 prepareHostPlaceholders；
    生成 -v hostRoot:/work:ro、-v tmpfs 遮蔽以及各 writablePath 的 :rw 挂载参数。
    3) 扩展 EvidenceBundle.sandbox_witness 及 SandboxWitness 接口，增加 mount_mode 与 mount_count；
    container-host.ts 中 verifySandboxWitness 加入 mount_mode 有效性断言。
    4) 编写 tests/unit/docker-container-host-mounts.test.ts 验证参数构建；
    编写 tests/daemon/p0-3b-container-scope-fail-closed.test.ts 验证真实/集成容器下的写阻断、.git 阻断及合法写入。
  touches:
    - { path: daemon/worker/cli-host/docker-container-host.ts, change: modify, why: 接入 resolveScopedMounts 构建 scoped 与 readonly docker run 挂载参数，调用宿主占位, symbols: [DockerContainerHost] }
    - { path: daemon/worker/sandbox/container-host.ts, change: modify, why: SandboxWitness 增加 mount_mode/mount_count，verifySandboxWitness 加断言, symbols: [verifySandboxWitness] }
    - { path: daemon/pipeline/orchestrator.ts, change: modify, why: 将合同 scope 传递给 worker adapter，验收阶段指定 readonly_enforced 模式, symbols: [] }
    - { path: daemon/worker/cli-host/openhands-adapter.ts, change: modify, why: 适配器接线透传 scope 挂载参数, symbols: [] }
    - { path: daemon/worker/sandbox/container-cli-executor.ts, change: modify, why: CLI 执行器透传 scope 挂载参数, symbols: [] }
    - { path: src/lib/evidence.schema.ts, change: modify, why: 扩展 sandbox_witness 兼容存储 mount_mode 与 mount_count, symbols: [] }
    - { path: tests/unit/docker-container-host-mounts.test.ts, change: create, why: docker run 挂载命令行参数生成单元测试, symbols: [] }
    - { path: tests/daemon/p0-3b-container-scope-fail-closed.test.ts, change: create, why: 容器内文件系统 Scope 负向阻断、.git 保护与合法写入集成测试, symbols: [] }
  interfaces: []
  test_plan:
    - { acceptance_id: P03B2-P1, test_path: tests/unit/docker-container-host-mounts.test.ts, level: unit, case: "正确构建 scoped 与 readonly_enforced 模式下的 docker 参数" }
    - { acceptance_id: P03B2-P2, test_path: tests/daemon/p0-3b-container-scope-fail-closed.test.ts, level: integration, case: "真实 Docker 环境下 Scope 外写 EACCES、.git 写被拒、授权写放行" }
    - { acceptance_id: P03B2-P3, test_path: tests/unit/docker-container-host-mounts.test.ts, level: unit, case: "SandboxWitness 准确回写 mount_mode 与 mount_count" }
    - { acceptance_id: P03B2-P4, test_path: tests/unit/docker-container-host-mounts.test.ts, level: unit, case: "verifySandboxWitness 严格校验 mount_mode 与 mount_count 合法性" }
    - { acceptance_id: P03B2-P5, test_path: tests/daemon/p0-3b-container-scope-fail-closed.test.ts, level: integration, case: "逃生门 UNCONTROLLED_EXTERNAL 语义不变" }
    - { acceptance_id: P03B2-P6, test_path: tests/daemon/p0-3b-container-scope-fail-closed.test.ts, level: integration, case: "全套门禁双重拦截非法状态，既有功能零回归" }
governance:
  delivered: { pr: 434, commit: 0a92eb773962f5d60189463883be589bd187b8be }
  spec_refs:
    - docs/specs/runtime-contract-and-safety.md
    - docs/specs/evidence-and-acceptance-criteria.md
    - docs/ledger/p0-3b-container-filesystem-scope-proposal.md
  depends_on:
    - { id: TASK-P0.3b-1, kind: hard }
  code_facts:
    - { ref: "daemon/worker/cli-host/docker-container-host.ts:306-310", note: "run 方法仅做单一 worktreeRoot rw 挂载" }
    - { ref: "daemon/worker/sandbox/container-host.ts:168-175", note: "SandboxWitness 目前记录 host_kind、via、exit_code、duration_ms、worktree_root" }
    - { ref: "daemon/pipeline/orchestrator.ts:1818", note: "orchestrator 在任务执行完毕后从 containerHost 采集 witness" }
    - { ref: "daemon/pipeline/orchestrator.ts:2575", note: "writeEvidence 将 witness 写入 EvidenceBundle.sandbox_witness" }
  non_goals:
    - 不替代 merger.ts 与 candidate-scope-audit.ts 的合并前提交审计
    - 不宣称硬件虚拟化安全或完全免疫内核提权漏洞
    - 不改动既有 GATEWAY_ENFORCED 任务链路
    - 不废弃 STAGENT_DISABLE_CONTAINER 逃生门
  fail:
    - 在 Docker 环境下容器写 Scope 外文件或 .git 成功且未抛 EACCES
    - 验收阶段未将容器工作树设为全量只读（出现任何 :rw 挂载）
    - 见证链遗漏 mount_mode 或允许非法 mount_mode 通过验证
    - 破坏既有 GATEWAY_ENFORCED 任务合并或破坏生产装配
  estimate: M
  invariants:
    auth: unchanged
    demo_origin: unchanged
    illumination: unchanged
    gateway_write_scope: unchanged
```


#### 归档注记（P-335 · 2026-11-26）

- **交付 PR**：[#434](https://github.com/he18718143986-design/IDE/pull/434)（head `50331b2359e26a3ffd1fabc31ab597f33e2fd9db`，squash `0a92eb773962f5d60189463883be589bd187b8be`，操作者由我执行）。
- **范围与检查**：仅 8 个授权 `writable_paths`（+974/−10），5 个 `readonly_paths` 保持零 diff。单元测试套件（11 tests in `tests/unit/docker-container-host-mounts.test.ts`）与条件负向集成测试（`tests/daemon/p0-3b-container-scope-fail-closed.test.ts`）全部通过。必需 CI 全绿（三平台 Lint/Typecheck + ubuntu/macOS Unit + Docs/Knowledge/Perf/Detect；无 CANCELLED），Windows Unit 存量失败按先例 `UNSTABLE` 不挡（11 项既有环境差异，新增用例 100% 通过），Cursor Bugbot neutral。
- **P03B2-P1（DockerContainerHost.run 接入细粒度挂载与两阶段模式）**：`daemon/worker/cli-host/docker-container-host.ts` 在 `run` 及 `buildArgs` 中接入 `resolveScopedMounts`，替换既有整卷读写挂载；在容器启动前执行 `prepareHostPlaceholders` 预置缺失目标文件，阻断目录误建；`daemon/pipeline/orchestrator.ts` 落地 `resolveContainerMountMode`，两阶段明确区分：施工阶段（I / construction）`scoped` 模式（根只读 + 授权路径逐项独立 `:rw` + `/work/.git` tmpfs 遮蔽），验收阶段（T / acceptance）`readonly_enforced` 模式（全量根只读且清空合同 `writable_paths`，绝不放行任何 `:rw` 挂载点）。
- **P03B2-P2（真实 Docker 环境负向集成测试）**：`tests/daemon/p0-3b-container-scope-fail-closed.test.ts` 落地分层负向测试：在本地具备 Docker daemon 且已拉取镜像（或显式开启 `STAGENT_LIVE_DOCKER_TEST=1`）时，物理验证容器内写 Scope 外只读文件必抛 `EACCES`（`Read-only file system`）、写 `/work/.git` 受 tmpfs 遮蔽保护宿主真实 Git 元数据不受污染、写授权内路径正常放行、`readonly_enforced` 下即便利诱写入亦全卷只读拦截；在无镜像或无 Docker 环境下如实安全跳过，绝无虚假断言。
- **P03B2-P3（SandboxWitness 记录真实挂载姿态）**：`daemon/worker/sandbox/container-host.ts` 与 `src/lib/evidence.schema.ts` 同步扩充 `SandboxWitness` 结构，增加 `mount_mode`（`scoped` | `readonly_enforced` | `legacy_full_rw`）与 `mount_count` 字段，真实反映容器启动参数与生效挂载点计数，并随 `EvidenceBundle` 原子落盘。
- **P03B2-P4（verifySandboxWitness 与 deriveCanMerge 模式有效性断言）**：`container-host.ts` 中 `verifySandboxWitness` 增加挂载模式与挂载点数量合法性校验，非法姿态抛 `WITNESS_MOUNT_MODE_INVALID` / `WITNESS_MOUNT_COUNT_INVALID`；`src/lib/evidence.schema.ts` 的 `evidenceBundleSchema` 与 `deriveCanMerge` 同步补齐有效性断言，在 `SANDBOX_ENFORCED` 模式下双重 fail-closed 拦截伪造或非法的挂载姿态。
- **P03B2-P5（运维逃生门语义不变）**：保留 `STAGENT_DISABLE_CONTAINER=1` 运维逃生门机制，启用时如实降级为 `UNCONTROLLED_EXTERNAL` 并记录 WARNING 日志，严禁冒认受控姿态。
- **P03B2-P6（测试与既有功能零回归）**：既有 `GATEWAY_ENFORCED` 链路、生产 Daemon 装配以及 314+ 测试套件零回归。
- **诚实口径**：**容器文件系统 Scope 强制挂载执行接入已交付（两阶段挂载、见证记档与断言、负向集成测试）；P0 风险未宣称解除**。
