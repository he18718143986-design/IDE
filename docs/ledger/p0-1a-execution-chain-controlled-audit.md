# TASK-P0.1a 执行链受控证明专项审计报告

- **卡号**：TASK-P0.1a（审批编号：`TASK-P0-1A`）
- **类型**：纯审计型（执行链追踪、异常枚举、判据修证、占位区分）
- **依据版本**：main SHA `a751b8cdb236d08fb6a836d0269bdf0d767c07ab`
- **审计人员**：Stagent 治理团队（由 Lovable 执行）
- **状态**：AUDITED·COMPLETED

---

## 1. 派工→真实进程全链路追踪（P01A-P1）

### 1.1 链路拓扑与关键入口
当合同指定受控模式 `worker_control_mode: "SANDBOX_ENFORCED"` 并由 `ContractOrchestrator.execute()` 派工时，调用全链路如下：

```text
ContractOrchestrator.execute(contractId)
  │
  ├─► diagnoseControlledDispatch() / requireControlledDispatch() [worker-dispatch.ts]
  │     └─ 校验 contract_revision、worker_control_mode 与 containerHost 可用性
  │
  ├─► workerAdapter.runTask(contract, worktreeRoot, env) [openhands-adapter.ts]
  │     │
  │     ├─► ContainerCliExecutor.run() [container-cli-executor.ts]
  │     │     │
  │     │     └─► runInSandbox(input, containerHost) [container-host.ts]
  │     │           │
  │     │           ├─► validateSandboxInput(input) [校验 worktree_root、image、timeout]
  │     │           │
  │     │           └─► containerHost.run(worktreeRoot, runner) [docker-container-host.ts]
  │     │                 │
  │     │                 ├─► docker.ping() [不可用即返回 HOST_UNAVAILABLE]
  │     │                 │
  │     │                 └─► docker.createContainer() -> container.start() -> container.wait()
  │     │                       └─ 真实容器子进程（Isolated Linux Container）
  │     │
  │     └─► 捕获 ContainerOutcome [openhands-adapter.ts]
  │           └─ 若 outcome.exit_code === 0 且 status === "completed"：
  │                生成真实 SandboxWitness（via="exit", host_kind, nonce, duration_ms）
  │
  └─► orchestrator.writeEvidence() [orchestrator.ts]
        ├─► deriveCanMerge() 验证 SandboxWitness (verifySandboxWitness)
        └─► Ed25519 签名与 EvidenceBundle 磁盘落盘
```

### 1.2 参数与边界校验
1. `validateSandboxInput`（`daemon/worker/sandbox/container-host.ts:50-70`）：
   - 严格断言 `worktree_root` 为绝对路径且路径在宿主上真实存在；
   - 镜像名只允许白名单字符（`^[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)?$`）；
   - 超时时间限制在 1s ~ 3600s 范围，防止无限制悬挂。
2. 容器绑定挂载：
   - 工作树以读写卷绑定入容器工作目录，宿主系统目录与凭证目录严禁挂载。
3. 容器退出校验：
   - 适配器严格检查 `outcome.status` 与 `outcome.exit_code`，非正常退出抛出 `OpenHandsSandboxError`，中断派工流。

---

## 2. SANDBOX_ENFORCED 所有入口与异常路径枚举（P01A-P2）

### 2.1 派工前门禁（`daemon/worker/worker-dispatch.ts`）
在受控模式下，派工前通过 `diagnoseControlledDispatch` 进行四道强拦截：
1. **合同版本校验**：若缺少 `contract_revision`，拒绝派工（`E_UNREVISED_CONTRACT`）。
2. **模式合法性**：非 `GATEWAY_ENFORCED` 且非 `SANDBOX_ENFORCED` 时拒绝派工（`E_CONTROL_MODE_UNKNOWN`）。
3. **逃生门禁用**：
   - 当环境变量 `STAGENT_DISABLE_CONTAINER=1` 生效时，记录 WARNING 日志；
   - 严禁将控制模式冒认为 `SANDBOX_ENFORCED`；
   - 若合同强制要求 `SANDBOX_ENFORCED`，即便逃生门打开，亦直接 fail-closed 抛出 `E_ADAPTER_SANDBOX_LOCKED`。
4. **宿主容器可用性**：
   - 若 `containerHost` 未注入（`null` 或 `undefined`），抛出 `E_ADAPTER_SANDBOX_LOCKED`；
   - 若 `containerHost.isAvailable()` 返回 `false`，抛出 `E_ADAPTER_SANDBOX_LOCKED`；
   - 绝不静默降级为未受控宿主执行。

### 2.2 运行时执行异常与 HOST_UNAVAILABLE fail-closed
当容器宿主在执行期间发生故障或不可用（例如 Docker 守护进程未启动、套接字无响应、连接超时）：
- `DockerContainerHost.run()` 返回 `status: "rejected"`，`rejection_code: "HOST_UNAVAILABLE"`；
- `OpenHandsAdapter.runTask()` 捕获该结果，严禁降级为本地直接执行；
- 适配器抛出 `OpenHandsSandboxError("OpenHands container execution was rejected: HOST_UNAVAILABLE")`；
- 执行流程立即终止，**绝不生成 SandboxWitness**；
- Orchestrator 捕获异常，派工状态置为 `FAILED`，阻断后续流水线。

---

## 3. SandboxWitness 来源真实性与防伪核查（P01A-P3）

### 3.1 见证生成点与绑定约束
`SandboxWitness` 由容器执行宿主回调根据物理执行结果产生，必须包含 8 项不可伪造字段：
```ts
export interface SandboxWitness {
  contract_id: string;
  contract_revision: number;
  nonce: string; // 32 字节 CSPRNG 十六进制字符串，与 contractId+revision 严格绑定
  worktree_root: string; // 工作树绝对物理路径
  host_kind: "docker" | "podman" | "darwin-seatbelt" | "unshare-ro";
  exit_code: number;
  via: "exit" | "signal" | "timeout" | "rejected";
  duration_ms: number;
  session_id?: string;
}
```

### 3.2 双重校验机制
1. **Orchestrator 派生校验（`verifySandboxWitness`）**：
   - 验证 `witness.via === "exit"`（仅正常退出的入箱容器可作为合规见证）；
   - 验证 `witness.worktree_root` 经规范化后与工作树真实物理路径严格一致；
   - 验证 `witness.host_kind` 属于系统注册的合法沙箱宿主；
   - `exit_code` 如实记录，不作为见证本身的结构校验断言。
2. **Merger 合并前防篡改校验（`assertEvidenceControlAndRevision`）**：
   - 核验 `sandbox_witness.contract_revision === contract.contract_revision`；
   - 核验 `sandbox_witness.contract_id === contract.contract_id`；
   - 核验 `sandbox_witness.nonce` 格式符合 32 字符以上十六进制防伪串；
   - 核验工作树物理路径未被劫持替换。

---

## 4. 网络探测三态修证与 UNKNOWN 降级（P01A-P4）

### 4.1 历史缺陷分析
在旧实现中，`daemon/baseline/os-sandbox.ts` 内的 `probeDeniedFromOutput` 采用二值逻辑：
```ts
// 历史缺陷代码
export function probeDeniedFromOutput(stdout: string, successToken: string): boolean {
  const out = (stdout ?? "").trim();
  if (out.length === 0) return false;
  return out !== successToken;
}
```
该逻辑存在严重失真隐患：
- 当被测目标（如 `example.com` 或 `api.anthropic.com`）因外部宿主自身无外网、DNS 故障、网关未配置或外部服务暂时不可达时，探测子进程输出 `TIMEOUT`、`ENOTFOUND`、`EAI_AGAIN`、`ENETUNREACH` 等错误码；
- 因上述输出不等于 `CONNECTED`，旧代码将其全数判定为 `denied: true`；
- 导致在系统根本没有内核级沙箱拦截能力的情况下，虚假生成了“网络已被沙箱拦截”的合规断网证明。

### 4.2 三态判据修证（TASK-P0.1a 落实）
引入 `ProbeVerdict`（`"DENIED" | "UNKNOWN" | "ALLOWED"`）及交叉校验：
1. **明确沙箱拦截（`DENIED`）**：
   - 必须匹配明确的沙箱内核级拒绝错误码（如 Darwin Seatbelt / Linux 规则拒绝的 `EPERM`、`EACCES`、`EROFS`、`ERR_ACCESS_DENIED`）；
   - 仅当裁决为 `DENIED` 时，`probeDeniedFromOutput` 才返回 `true`。
2. **环境型不确定（`UNKNOWN`）**：
   - 外部网络不可达、DNS 解析超时或失败（`TIMEOUT`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`, `ENETDOWN`, `ECONNRESET` 等）；
   - 宿主基线不可达（`opts.hostReachable === false`）；
   - 任何非明确沙箱拒绝的输出，一律降级判定为 `UNKNOWN`，`probeDeniedFromOutput` 返回 `false`，绝不计入 `network_denied`。
3. **成功连通（`ALLOWED`）**：
   - 输出精确匹配 `CONNECTED`（网络连通）或 `WROTE`（写入成功），证明沙箱未拦截。

---

## 5. test_integrity 占位记录与真实重跑区分性审计（P01A-P5）

### 5.1 占位记录（Default Placeholder）现状
在受控模式下（`GATEWAY_ENFORCED` 或 `SANDBOX_ENFORCED`），若执行未显式提供 `testIntegrity`：
- `orchestrator.ts:writeEvidence` 会自动补齐结构以满足受控 Evidence Schema 的非空约束；
- **加固与区分**：
  1. 当未修改任何测试（`testsModified === false`）且未显式提供测试完整性记录时，补齐结构显式注入 `failure_reason: "placeholder:unmodified_tests_default"`，且 `baseline_rerun_triggered: false`，明确向审计员表明此条为默认占位而非真实基线重跑；
  2. 当改动了测试文件（`testsModified === true`）却未显式提供 `testIntegrity` 证据时，表明发生了测试变更但缺失完整性验证，Orchestrator 自动将补齐结构判定为失败：
     - `baseline_rerun_passed: false`
     - `failure_code: "E_TEST_BASELINE_REGRESSION"`
     - `failure_reason: "tests_modified_without_test_integrity_evaluation"`
     - 该状态直接输入 `deriveCanMerge`，**fail-closed 阻断合并**。

### 5.2 真实基线重跑（Genuine Baseline Rerun）
真实重跑路径位于 `daemon/pipeline/orchestrator.ts:1284-1355`（`runTestIntegrityBaselineRerun`）：
- 仅在识别到已有测试文件被修改或删除时触发；
- 通过 `git checkout` 将被动测试恢复至 base commit 原始状态；
- 在沙箱/工作树环境中完整重跑测试命令，收集 stdout/stderr、退出码与耗时；
- 实际输出结构携带具体的被改测试清单、新增测试清单以及真实的重跑执行日志；与占位记录具有完全可区分的字段内容。

---

## 6. 诚实口径与边界声明（P01A-P6）

为防止对执行链与合规能力产生虚假安全感，特此重申以下四项不可逾越的边界：
1. **硬件级 Attestation 未实施**：当前 `SandboxWitness` 基于软件层 Docker/容器 Host 回调生成，未对接硬件级安全飞地（如 AMD SEV-SNP、Intel SGX、AWS Nitro Enclaves）签名；
2. **Merger 阶段不重跑全量测试**：Merger 是快速合并网关，按规格仅校验 Evidence 结构、Ed25519 签名、版本一致性与 Witness 真实性，不在合并点重新跑全量测试套件；
3. **容器内未叠加 OS 级二次沙盒**：当前容器执行依赖 Docker 自身的命名空间与 cgroups 隔离，容器进程内部未叠加 seatbelt/unshare 只读网络隔离；
4. **P0/P1 安全收敛口径维持**：本次审计与修证消除了网络探测虚假放行与测试占位未区分的漏洞，但**严禁宣称 P0/P1 安全风险完全解除**。剩余项继续挂账，保持防御姿态。
