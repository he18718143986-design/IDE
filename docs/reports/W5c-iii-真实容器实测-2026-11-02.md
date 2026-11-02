# W.5c-iii 真实容器实测证据（2026-11-02）

> **定位**：`TASK-W.5c-iii` 施工期的**实测记录**（证据面），不是签收凭据、也不代表完成回写。
> 施工依据仍为 [`../specs/development-tasks-active.md`](../specs/development-tasks-active.md) 卡正文；完成回写见 P-122。
> **措辞纪律**：本报告只声称「**通过已知探测集**」的结论，不写「绝对受控」，不声称端到端闭环。

---

## 1. 环境自证（施工前必做，先于任何施工）

### 1.1 daemon 可达（服务端，不只是客户端）

```
$ docker info --format '{{.ServerVersion}}|{{.OperatingSystem}}|{{.Architecture}}'
29.6.1|Docker Desktop|aarch64
```

`docker version` 含完整 **Server** 段：Docker Desktop **4.80.0** / Engine **29.6.1** /
containerd **v2.2.5** / runc **1.3.6**。`docker ps` 可见运行中容器，`docker info` 报
`Containers=22`、`Images=30`、`Driver=overlayfs`——**daemon 真的在跑**，不是「只装了 CLI」。

> 对照：P-116（2026-10-31）曾坐实本机**仅 Docker CLI、无守护进程**（`docker.sock` 不存在、
> 无 `dockerd`/`containerd`/`colima`/`lima`）。本卡环境前置由此解除。

### 1.2 OS-06 所需镜像（摘要固定）

```
$ docker image inspect ghcr.io/all-hands-ai/openhands:latest --format '{{.Id}}|{{.Created}}'
sha256:00968de77a7b36546413e1f3b5c6b4e2c387d19ade54de7926e10f5b3d265fa6|2025-10-10T18:42:25.969801425Z

$ docker image inspect ... --format '{{json .RepoDigests}}'
["ghcr.io/all-hands-ai/openhands@sha256:00968de77a7b36546413e1f3b5c6b4e2c387d19ade54de7926e10f5b3d265fa6"]

$ docker image inspect ... --format '{{.Os}}/{{.Architecture}}'
linux/arm64
```

镜像大小 1.83GB；`Config.Entrypoint=["/app/entrypoint.sh"]`、
`Config.Cmd=["uvicorn","openhands.server.listen:app","--host","0.0.0.0","--port","3000"]`。

### 1.3 容器内 CLI 版本（`verified_on` 的来源）

```
$ docker run --rm --network none --entrypoint python <image> \
    -c "import openhands, sys; print(openhands.__version__, sys.version.split()[0])"
openhands 0.59.0 3.13.7

$ ... -m openhands.core.main --help
usage: main.py [-h] [--config-file CONFIG_FILE] [-t TASK] [-f FILE] [-n NAME]
               [--log-level LOG_LEVEL] [-l LLM_CONFIG]
               [--agent-config AGENT_CONFIG] [-v] [-d DIRECTORY] [-c AGENT_CLS]
               [-i MAX_ITERATIONS] [-b MAX_BUDGET_PER_TASK] [--no-auto-continue]
               [--selected-repo SELECTED_REPO]
```

参数可用：`-t/--task`、`-d/--directory`、`-c/--agent-cls`、`-i/--max-iterations`、
`-b/--max-budget-per-task`、`-l/--llm-config`、`--config-file`。
镜像的 `entrypoint.sh` 末行为 `"$@"`，故 `docker run <image> python …` 会透传命令
（输出前缀两行横幅：`Starting OpenHands...` / `Running OpenHands as root`）。

---

## 2. 构建期两条**实测约束**（影响实现，如实记录）

### 2.1 全量 `--cap-drop ALL` 会让镜像起不来

```
$ docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges <image> python -c "print(1)"
docker: Error response from daemon: ... exec: "/app/entrypoint.sh": stat /app/entrypoint.sh: permission denied
```

根因（容器内实测）：`/app/entrypoint.sh` 为 **`0770`、owner uid 42420**，容器以 root（uid 0）
运行时本可凭 `CAP_DAC_OVERRIDE` 绕过权限位；cap-drop ALL 后该能力被丢弃，root 连 stat
自己的 entrypoint 都被拒。

结论与做法：`--cap-drop ALL` **保留**，只回补 **`DAC_OVERRIDE`** 一项；其余全无。

```
$ docker run --rm ... --cap-drop ALL --cap-add DAC_OVERRIDE ... \
    -c "print([l for l in open('/proc/self/status') if l.startswith('CapEff')][0].strip())"
CapEff:	0000000000000002        # 只剩 CAP_DAC_OVERRIDE
```

`no-new-privileges` 生效；`NET_ADMIN` / `SYS_ADMIN` / `SYS_PTRACE` / `SYS_MODULE` 全无；
未使用 `--privileged`。

### 2.2 无法兑现 `EXPLICIT_TARGETS` → 一律拒绝

`docker run` 层做不到逐目标限制出站。宿主实现**不**降级为「全放行」也**不**静默改为
「全禁」，而是返回 `via:"rejected"` / `rejection:"NETWORK_TARGET_NOT_ALLOWED"`
（失败关闭，且不误导调用方以为白名单已生效）。

由此产生一个必须写清楚的**边界**：容器出站恒为 `DENY` ⇒ 容器内**调不到模型 API** ⇒
「模型驱动的端到端改动」**未实测**。`verified_on` 只覆盖「headless CLI 可启动 + 隔离负例
全部失败关闭」，**不**覆盖端到端闭环。

---

## 3. 自动化实测结果

### 3.1 真实容器套件（`STAGENT_REAL_OPENHANDS=1`）

```
$ STAGENT_REAL_OPENHANDS=1 npx vitest run tests/e2e/openhands-isolation.real.test.ts

 ✓  node  tests/e2e/openhands-isolation.real.test.ts (11 tests) 8738ms
     ✓ OH-R00：环境自证——daemon 可达、镜像可用、宿主自报身份          1ms
     ✓ OH-R01：OpenHands headless CLI 在容器内可启动（版本与 verified_on 一致）  2347ms
     ✓ OH-R02 / OH-03：容器内只看得见任务 Worktree（cwd=/work，宿主路径不可达）  164ms
     ✓ OH-02：逃逸负例——读宿主越界文件 / 相对穿越均失败关闭             351ms
     ✓ OH-02：提权负例——容器内仅剩 DAC_OVERRIDE，无 NET_ADMIN / SYS_ADMIN  198ms
     ✓ OH-02：出站负例——DENY 下连不出去                                218ms
     ✓ OH-01：越界挂载在进入容器前即被拒（宿主根 / .git / .stagent）        1ms
     ✓ 终止态如实回传：非零退出不美化成成功                             159ms
     ✓ 超时熔断：到点回收，不无限等待                                   2967ms
     ✓ 适配器在真实宿主上失败关闭（无出站 / 无凭据时不得假装成功）         2210ms
     ✓ OH-05：能力声明与实测一致（声明值就是刚测到的边界）                 0ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

事后核查无残留容器：`docker ps -a --filter name=stagent-sbx` 输出为空。

### 3.2 无门禁时必须「跳过」，不得假绿

```
$ npx vitest run tests/e2e/openhands-isolation.real.test.ts
 ↓  node  tests/e2e/openhands-isolation.real.test.ts (11 tests | 11 skipped)
 Test Files  1 skipped (1)
```

跳过 **≠** 通过：无容器环境的 CI 不得据此判绿，须核对 `STAGENT_REAL_OPENHANDS=1` 是否设置。

### 3.3 确定性负例（无需容器）

```
$ npx vitest run tests/unit/openhands-sandbox.test.ts
 ✓  node  tests/unit/openhands-sandbox.test.ts (29 tests) 166ms
```

覆盖 OH-01～OH-05 + 「派工即入沙箱」：越界挂载拒绝（宿主零调用）、cwd 越界拒绝、
提权参数收窄、未授权出站拒绝、宿主不可用拒绝、派工经 `runInSandbox` 且结果携带
`sandbox` 见证、缺宿主时工厂与适配器双重拒跑、非零退出不产出见证。

---

## 4. 隔离边界的**已知缺口**（不掩盖）

1. **任务 Worktree 的 `.git` 随根目录挂进容器**。git worktree 的 `.git` 是指针文件，
   内含宿主主仓路径字符串；容器内该路径不可达（不存在），但**路径信息可读**。
   未做 mask（`-v /dev/null:/work/.git`）——mask 会连带打断容器内 git 类工具，代价更大。
2. **模型 API Key 经容器环境变量注入**（`LLM_API_KEY`），容器内进程与宿主侧
   `docker inspect` 均可读；未用 secret 挂载 / 文件句柄。
3. **应用层围栏仍是进程内围栏**：`SANDBOX_ENFORCED` 的隔离由「宿主可用性门禁 +
   唯一挂载点 + `runInSandbox` 唯一执行路径」共同保证，不是内核级强制；不宣称「绝对受控」。
4. **仅 darwin-arm64 + Docker Desktop 实测**，其他平台未实测，未写入平台矩阵。

---

## 5. 未完成项（本卡范围内外）

- P-122 文档回写（矩阵 / index / changelog / ledger、completed 卡迁移）——本报告不含。
- `verified_on` 的端到端场景（模型驱动改动）——受 `DENY` 出站限制，未测，另行立卡或扩展宿主能力后再补。
- 逐目标出站白名单（`EXPLICIT_TARGETS` 真正可兑现）——需 network namespace / iptables 级实现，超出本卡估算。
- W.7 探测包复用本卡宿主作为「自动探测沙箱」——留待 W.7。
