# P0-3b 容器文件系统 Scope 强制挂载技术排查与施工方案（讨论稿）

> **地位**：P0-3b 挂账项技术评估与施工方案讨论稿（纯文档，不落卡，不动代码）。
> **基线**：`main`@`eed92757fbd355155862c33dc642a223f6a8a91b`（[#428](https://github.com/he18718143986-design/IDE/pull/428) P-331 P0 线总账复核落账合入）。
> **依据**：2026-11-26 Tina 点名 P0-3b 评估立卡指示（先只读排查出方案，方案 PR 全绿后报审，审过再立卡）。
> **口径**：**本方案为技术论证与施工草案；不宣称 P0 风险解除，不宣称已具备容器内操作系统级只读隔离；立卡须等待 Tina 终审拍板**。

---

## 一、排查现状与代码依据

### 1.1 `DockerContainerHost` 当前挂载模型
- **代码落点**：`daemon/worker/cli-host/docker-container-host.ts:306-310`
  ```typescript
  "-v",
  `${hostRoot}:${this.containerWorkRoot}`,
  "-w",
  containerCwd,
  ```
  其中 `hostRoot` 为宿主端任务 Worktree 绝对路径（`input.worktreeRoot`），`containerWorkRoot` 默认为 `/work`。
- **现状分析**：当前 `DockerContainerHost` 将整个 Worktree 根目录以**单一卷（bind mount）**挂载进容器。由于未指定 `:ro` 旗标，Docker 默认以**读写（rw）**方式挂载。
- **额外挂载通道**：
  - `input.mounts`（`docker-container-host.ts:312-314`）：经过 `container-host.ts:assertMountAllowed` 围栏，仅允许挂载 Worktree 内部非保护区路径；
  - `secretFiles`（`docker-container-host.ts:315-320`）：宿主物化为临时文件后以 `-v hostPath:containerPath:ro` 单独挂载为只读。

### 1.2 `runInSandbox` 调用链与 `SandboxWitness` 生成点
- **执行调用链**：
  1. `daemon/pipeline/orchestrator.ts:1813-1818`：派工工厂（`dispatchFactory`）构造具体 Worker 适配器（如 `OpenHandsSandboxAdapter` 或 `ContainerCliExecutor`）；
  2. Worker 适配器 `run()` 内部调用 `runInSandbox`：
     - `daemon/worker/cli-host/openhands-adapter.ts:230`：`await runSandbox(this.opts.host, sandboxInput, signal)`；
     - `daemon/worker/sandbox/container-cli-executor.ts:254`：`await runner(host, sandboxInput, signal)`；
  3. `daemon/worker/sandbox/container-host.ts:428-448`：`runInSandbox` 执行纯逻辑围栏 `validateSandboxInput` 后，调用宿主实例 `host.run(safe, signal)`；
  4. `DockerContainerHost.run`（`docker-container-host.ts:353-454`）：执行 `docker run` 外部进程，收集 `SandboxRunOutcome`。
- **见证生成与落盘点**：
  1. 见证生成：`openhands-adapter.ts:267` 及 `container-cli-executor.ts:287` 调用 `sandboxWitness(this.opts.host, sandboxInput, outcome)`，作为 `AdapterRunOutcome.sandbox` 字段返回；
  2. 见证暂存：`orchestrator.ts:1818` 调用 `this.recordSandboxWitness(contractId, result.sandbox)` 存入 `this.sandboxWitnesses` 映射；
  3. 见证落盘：`orchestrator.ts:2575` 在生成证据（`writeEvidence`）时，将见证持久化进 `EvidenceBundle.sandbox_witness`；
  4. 见证核验：生成时 `deriveCanMerge`（`evidence.schema.ts:303-311`）与合并时 `merger.assertEvidenceControlAndRevision`（`merger.ts:181-196`）双重调用 `verifySandboxWitness` 强制校验。

### 1.3 P0.3a 交付后容器路径上的未受控写面
根据代码事实，P0.3a 交付后，容器执行路径上仍存在以下未受控写面：
1. **工作树非授权文件可写**：容器挂载了整棵 Worktree 为 `rw`，容器内未对合同 `writable_paths` 之外的文件或目录设置操作系统级只读防护。Worker 容器内进程可直接通过 shell 重定向、进程系统调用等改写未授权代码文件（`ai_inferred`：虽然 P0.2 的 Git 变更审计会在事后拦截合并，但容器内未能实现「当时写不进去」）；
2. **工作树元数据 `.git` 暴露**：`openhands-adapter.ts:93` known_limitations 明记：`任务 Worktree 的 .git 随根目录挂载进入容器（git worktree 指针文件内含宿主主仓路径字符串）`。虽然 `assertMountAllowed` 禁止显式挂载 `.git`，但在整体挂载 `worktreeRoot` 时，`.git` 作为一个子文件不可避免地被映射进容器，容器进程可对其进行读写篡改；
3. **容器本地可写层**：容器根文件系统（除 `/work` 和 `/run/secrets:ro` 外）为可写层，容器内可向 `/tmp`、`/var/tmp` 等路径写入临时文件（容器退出后虽被 `--rm` 自动清理，但运行期无只读限制）。

---

## 二、缺口边界：可选机制对比与可行性分析

为使合同 `writable_paths` 在容器层生效，针对主流技术方案排查对比分析如下：

| 机制 | 工作原理 | 改动面 | 跨平台兼容性（macOS/Win/Linux） | 对 Worker 产出的影响 | 评估结论 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **(a) Docker 多卷精细挂载** | 根目录只读挂载（`-v root:/work:ro`），合同授权路径以读写覆盖挂载（`-v root/src:/work/src:rw`） | 中：`DockerContainerHost.buildArgs` 扩展挂载计算与参数构建 | **存在关键缺陷**：Docker 遇到宿主**尚未存在**的路径时会自动创建同名目录（`mkdir`），导致新建普通文件失败 | **有条件推荐**：需配合宿主侧「新文件空文件预占位」或「父目录级挂载」 |
| **(b) 容器内 chroot / overlay** | 容器启动后在内部将 `/work` 挂为 lowerdir，tmpfs 作 upperdir 进行只读叠加 | 极高：需定制 entrypoint 并授予特权 | **致命阻断**：`DockerContainerHost:64,292` 锁定 `--cap-drop ALL` + `--security-opt no-new-privileges`，无 `CAP_SYS_ADMIN` 无法执行 mount | **坚决否决**：违反容器最小特权基线 |
| **(c) P0.2 Git 审计兜底（现状）** | 容器全卷 rw 挂载，事后由宿主 `candidate-scope-audit.ts` 严格核验 Git diff | 无改动（当前运行中） | 极佳：全平台标准行为 | 零阻碍：完全兼容新建、删除、重命名文件 | **现状维持**：未达到深审「容器内写不进去」目标 |
| **(d) seccomp / AppArmor / SELinux** | 通过内核安全模块拦截 `openat(O_WRONLY)` 等写系统调用 | 极高：需深入 Linux 内核安全配置 | **极差**：macOS/Windows Docker 虚拟机内部不可定制，seccomp 无法安全反解用户态路径 | 严重不可控 | **坚决否决**：不可移植、极度脆弱 |

### 机制 (a) 的深层技术难点剖析（`ai_inferred`）
Docker bind mount 多卷覆盖挂载存在两个核心边界：
1. **新文件创建阻断（The Absent-File Dilemma）**：如果合同 `writable_paths` 指定了 `src/new-feature.ts`（文件在宿主工作树中尚未创建），直接执行 `-v /host/src/new-feature.ts:/work/src/new-feature.ts:rw`，Docker daemon 会在宿主上将其**创建为目录** `src/new-feature.ts/`。Worker 随后在容器内执行 `touch src/new-feature.ts` 会报错 `Is a directory`；
2. **目录级 vs 文件级粒度权衡**：
   - 若将包含该文件的父目录挂载为 `rw`（如挂载 `src/` 为 `rw`），则同级只读文件（如 `src/existing-readonly.ts`）也会被暴露为可写，必须再单独挂载该只读文件为 `:ro`；
   - Linux VFS 支持多层嵌套覆盖挂载（Over-mounting），但挂载项数量随作用域复杂度剧增。

---

## 三、T/I 两阶段权限差异与挂载姿态设计

在任务生命周期中，**施工阶段（Implementation, I）**与**验收阶段（Testing/Verification, T）**对文件系统的权限需求具有根本差异：

1. **施工阶段（I 阶段，Worker 执行阶段）**：
   - **操作诉求**：Worker 需要修改、新增或删除 `writable_paths` 范围内的代码；
   - **挂载姿态**：采用**作用域受限精细挂载（Scoped Mount）**，根目录 `/work` 挂载为 `:ro`，授权路径挂载为 `:rw`；若涉及新文件，由宿主侧预创建 0 字节空占位文件后再执行挂载。
2. **验收阶段（T 阶段，`POST_VERIFICATION` / Baseline Rerun）**：
   - **操作诉求**：执行 `stagent check playtest` 或基线重跑测试命令（如 `npm test`）。验收过程原则上**严禁修改工作树任何受管代码**；
   - **挂载姿态**：采用**全量只读挂载（Strict Read-Only Mount）**，即 `-v hostRoot:/work:ro`；
   - **测试缓存与临时目录处理**：测试框架（如 Vitest、Jest、Python pytest）通常需要在工作区生成缓存（如 `node_modules/.cache`、`__pycache__`）。全量只读挂载时，可通过向容器追加 `--tmpfs /tmp:rw,noexec` 及配置环境变量（如 `TMPDIR=/tmp`、`CACHE_DIR=/tmp`），保证测试套件正常运行且不污染工作树。

---

## 四、与既有系统的衔接设计

### 4.1 `ContainerHostPort` 接口扩展
在 `daemon/worker/sandbox/container-host.ts` 中保持接口稳定，通过 `SandboxRunInput` 最小化扩展挂载策略字段：
```typescript
export type SandboxMountMode = "single_rw" | "scoped" | "readonly_enforced";

export interface SandboxRunInput {
  worktreeRoot: string;
  cwd?: string;
  argv: string[];
  mounts?: SandboxMount[];
  secretFiles?: SandboxSecretFile[];
  networkPolicy?: NetworkPolicy;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** P0-3b：容器工作树挂载策略，缺省保持 single_rw 兼容既有链路 */
  mountMode?: SandboxMountMode;
  /** P0-3b：合同授权的可写路径相对列表（mountMode === "scoped" 时必填） */
  writablePaths?: readonly string[];
}
```

### 4.2 `SandboxWitness` 与证据面记录
在 `SandboxWitness` 结构中追加挂载策略与挂载项指纹，确保受控证明具有真实审计依据：
```typescript
export interface SandboxWitness {
  readonly host_kind: string;
  readonly via: SandboxRunOutcome["via"];
  readonly exit_code: number | null;
  readonly duration_ms: number;
  readonly worktree_root: string;
  /** P0-3b：记录实际启动容器时采用的挂载策略 */
  readonly mount_mode?: SandboxMountMode;
  /** P0-3b：记录生效的可写挂载点数量 */
  readonly writable_mount_count?: number;
}
```

### 4.3 `verifySandboxWitness` 深度断言
在 `verifySandboxWitness` 中增加对 `mount_mode` 的可选校验断言：当合同要求容器级文件系统隔离时，断言 `witness.mount_mode !== "single_rw"`，否则抛出 `SandboxWitnessValidationError("WITNESS_MOUNT_MODE_INSUFFICIENT")`。

### 4.4 运维逃逸门 `STAGENT_DISABLE_CONTAINER` 语义
保持既有设计不动：若环境变量 `STAGENT_DISABLE_CONTAINER=1` 生效，宿主直接记录 WARNING 日志，派工降级记档为 `UNCONTROLLED_EXTERNAL` 并拒绝受控合并。P0-3b 不改变逃生门逻辑。

---

## 五、负向测试可行性与分层验证

| 层级 | 运行环境 | 测试内容与断言目标 | 确定性与 CI 成本 |
| :--- | :--- | :--- | :--- |
| **L1 纯函数计算单测** | 无需 Docker（本地/CI 恒跑） | 测试 `resolveScopedMountArgs` 纯函数：给定工作树与 `writable_paths`，断言生成的 `-v` 列表包含 `/work:ro`、正确的作用域 `:rw` 及非法遍历路径拒绝 | 100% 确定性，毫秒级 |
| **L2 Docker 参数构造断言** | 无需 Docker（使用 stub 宿主） | 验证 `DockerContainerHost.buildArgs` 在 `mountMode === "scoped"` 与 `"readonly_enforced"` 时生成的参数数组，断言 `:ro` 旗标与覆盖挂载参数顺序 | 100% 确定性，不依赖外部环境 |
| **L3 真实容器负向隔离测试** | 需 Docker（`STAGENT_REAL_CONTAINER=1`） | 在真实 Docker 容器中执行写操作探针：<br>1. 尝试写只读路径（如 `/work/package.json`），断言进程收到 `EACCES: permission denied`；<br>2. 尝试写授权路径，断言写入成功；<br>3. 验收阶段全量只读挂载下，断言任何写操作均直接失败 | 真实环境门禁，无容器时如实 skip（不假绿） |

---

## 六、推荐施工方案与落地路径

### 推荐方案：两阶段姿态 + 宿主空文件预置的多卷挂载方案
1. **阶段 1（T 阶段 · 验收与基线重跑全量只读挂载）先行落地**：
   - 在 `orchestrator.ts` 触发基线重跑或独立验收时，将容器挂载参数设为 `mountMode: "readonly_enforced"`；
   - 整个 `/work` 挂为 `:ro`，配 `--tmpfs /tmp:rw`；实现零风险、高收益的验收期代码防篡改。
2. **阶段 2（I 阶段 · 施工期精细挂载与新文件支持）分步推进**：
   - 宿主侧实现 `resolveScopedMounts` 纯函数；
   - 启动 Worker 容器前，扫描 `writable_paths`：若声明的路径是尚未存在的文件，在宿主工作树原子创建 0 字节占位文件（或声明目录权限）；
   - 容器内根挂载 `-v hostRoot:/work:ro`，授权路径挂载 `-v hostRoot/rel:work/rel:rw`；
   - 保护区 `.git` 显式以只读覆盖或阻断挂载（如挂载空 tmpfs 覆盖 `/work/.git`）。

---

## 七、落点文件清单（预估）

### 7.1 预估可写文件清单（`writable_paths`）
1. `daemon/worker/sandbox/container-host.ts`（扩展 `SandboxRunInput`、`SandboxWitness`、挂载策略枚举与纯函数）
2. `daemon/worker/cli-host/docker-container-host.ts`（实现 scoped 与 readonly 挂载参数构建，支持 `.git` 隔离遮蔽）
3. `daemon/pipeline/orchestrator.ts`（传递合同 scope 至 Worker 适配器，并在验收重跑时切换为 readonly 模式）
4. `daemon/worker/cli-host/openhands-adapter.ts`（适配器接线透传挂载参数）
5. `daemon/worker/sandbox/container-cli-executor.ts`（CLI 执行器透传挂载参数）
6. `src/lib/evidence.schema.ts`（`sandbox_witness` 兼容扩展 `mount_mode`）
7. `tests/unit/container-mount-scope.test.ts`（新建纯函数挂载计算单测）
8. `tests/unit/docker-container-host-mounts.test.ts`（新建参数构建断言单测）
9. `tests/daemon/p0-3b-container-scope-fail-closed.test.ts`（新建端到端及真实容器负向测试）

### 7.2 预估只读守卫文件清单（`readonly_paths`）
1. `src/lib/contract.schema.ts`
2. `daemon/pipeline/merger.ts`
3. `daemon/pipeline/candidate-scope-audit.ts`
4. `daemon/guard/test-integrity.ts`
5. `daemon/worker/worker-adapter.interface.ts`

---

## 八、Schema 与错误码变动评估

- **Schema 变动**：
  - `EvidenceBundle.sandbox_witness`：在现有结构上新增可选字段 `mount_mode?: string` 与 `writable_mount_count?: number`；完全向后兼容旧证据，不破坏已有反序列化。
- **错误码设计**：
  - 复用已有 `MOUNT_OUTSIDE_WORKTREE`、`MOUNT_PROTECTED_PATH`；
  - 在 `SandboxRejectionCode` 新增 `MOUNT_SCOPE_INVALID`（当授权路径不合法或存在逃逸遍历时失败关闭抛出）。

---

## 九、验收 DoD 草案

1. **DoD-1（纯函数挂载计算）**：`resolveScopedMounts` 准确将 `worktreeRoot` 与 `writable_paths` 转换为 `/work:ro` + 授权路径 `:rw` 的挂载规格，任何越界或遍历路径抛出 `MOUNT_SCOPE_INVALID`。
2. **DoD-2（验收阶段全量只读）**：在 `mountMode === "readonly_enforced"` 下，生成的 `docker run` 参数严格包含 `-v hostRoot:/work:ro`，且无任何 `:rw` 工作树挂载。
3. **DoD-3（新文件占位机制）**：若 `writable_paths` 包含尚未存在的文件路径，宿主侧在启动容器前安全预置空文件，避免 Docker 自动创建目录。
4. **DoD-4（`.git` 元数据遮蔽）**：通过挂载空只读卷或 tmpfs 覆盖容器内 `/work/.git`，彻底断绝容器进程修改宿主 Git 指针的途径。
5. **DoD-5（见证链如实记档）**：容器启动后，`SandboxWitness` 准确记录实际生效的 `mount_mode`，并随证据原子落盘。
6. **DoD-6（端到端负向阻断）**：真实容器测试（有 Docker 环境）下，Worker 进程尝试写只读路径被操作系统物理拒绝（产生 `EACCES`），证明实现 OS 级拦截。
7. **DoD-7（既有测试与网关零回归）**：既有全部 314 个测试文件、DOM 测试、以及 `GATEWAY_ENFORCED` 路径全部保持全绿。
8. **DoD-8（诚实口径）**：在文档与台账中准确记录容器文件系统隔离能力边界，不宣称硬件级防护。

---

## 十、估算复核与卡片规划建议

- **原估算**：**L**（跨越 Docker 客户端参数层、宿主文件系统预检、容器生命周期、Orchestrator 双阶段调度与集成负向测试）。
- **复核结论**：
  - 若作为单一任务卡整体施工，因涉及「验收全只读」与「施工期精细覆盖挂载 + 占位预置」两个相对复杂的阶段，容易出现单 PR 规模过大、调试周期过长的问题；
  - **建议拆分为两张 M 级任务卡**推进：
    1. **`TASK-P0.3b-1`（验收阶段容器全量只读挂载与防篡改）· 估算 M**：改动小、见效快，直接封闭验收期的代码写入与篡改风险；
    2. **`TASK-P0.3b-2`（施工阶段工作树 Scope 覆盖挂载与元数据遮蔽）· 估算 M**：落实施工期的精细挂载与占位机制。
  - 若 Tina 拍板合并施工，则维持 **L** 级，但需锁定阶段停工点。

---

## 十一、风险清单与停工点（Stop-the-line）

1. **停工点 1（Docker Desktop 目录创建异常）**：若实测发现某些宿主平台（如特定版本的 macOS Docker Desktop 或 Windows WSL2）在覆盖挂载时对预占位文件的权限继承异常，必须立即停工，回退并重新评估挂载方案；
2. **停工点 2（测试套件写缓存崩溃）**：若全量只读挂载导致常见构建/测试工具（如 Vite 预编译或 Vitest 线程通信）在 `/work` 内部写缓存失败抛错，必须通过针对性挂载 tmpfs 解决，严禁私自将 `/work` 改回读写；
3. **停工点 3（范围外代码蔓延）**：改动必须严格限制在 `writable_paths` 范围内的 9 个文件内，严禁触及无关业务逻辑或更改合并核心状态机。
