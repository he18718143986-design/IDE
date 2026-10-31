# 验证策略规格（S6 · 测试义务、红绿检查、真实预览）

> **地位**：实施口径，从属 [ADR-0005](../adr/0005-deterministic-verification-gate.md)（确定性验证门禁）与 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §2 S6。验收材料的人工判定规则见 [`evidence-and-acceptance-criteria.md`](./evidence-and-acceptance-criteria.md)（现行规格）；试玩归因见 [`playtest-self-check.md`](./playtest-self-check.md)。
> **上游意图**：`q17`「测试」、`q18`「能够验收」（[`../scheme.md`](../scheme.md) acc-7）。
> **施工卡**：TASK-L.2（验证命令进 Worker 指令）、L.3（测试义务契约与判定）、L.4（两段式施工编排）、L.5（真实预览）。
> **状态**：设计定稿 · 待施工。

---

## 0. 一句话

每条能自动判定的验收条目，都必须有一条测试：它在改动前失败、改动后通过，而且写测试的人不能在实现阶段改它。

---

## 1. 现状（代码事实，决定了设计起点）

| 事实 | 位置 | 后果 |
| :--- | :--- | :--- |
| 写测试文件默认被拦：只有 `writable_paths` 显式包含测试路径时才放行 | `daemon/mcp/gateway.ts:1089` `E_TEST_FILE_WRITE_BLOCKED`；`daemon/guard/test-integrity.ts` | 新功能默认**零测试**合入 |
| Worker 指令不列验证命令，只用它决定是否暴露执行工具 | `daemon/worker/session-task-injector.ts:227` | Worker 不知道自己会被怎么判卷 |
| 验证命令由 L0 按标记文件推断，不读 `package.json` 脚本 | `daemon/supervisor/rules-l0.ts:31` | 可能跑不存在的脚本；J.2 已规定改为读真实脚本 |
| 回归清单只针对 Stagent 自身 | `daemon/pipeline/mainline-regression.ts` | 目标项目没有回归积累机制 |
| 真机预览只服务静态目录或登记已有 URL，否则写占位页 | `daemon/supervisor/preview/real-preview-server.ts`；`daemon/server.ts:861` | 试玩看不到 Worktree 里真正运行的应用 |

---

## 2. 验证分层

| 层 | 内容 | 来源 | 何时必须 |
| :--- | :--- | :--- | :--- |
| V0 静态 | 类型检查、lint | `package.json` 的 `typecheck` / `lint` 脚本（J.2 规则） | 项目有该脚本时，每份合同 |
| V1 测试义务 | 本合同验收条目对应的新测试 | DesignNote `test_plan`（[`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §2） | 每条 `check: auto` / `both` 的验收条目 |
| V2 回归 | 项目全部既有测试 | `package.json` 的 `test` 脚本 | 项目有该脚本时，每份合同 |
| V3 知识库 | `docs/system/` 漂移门禁 KB-1～KB-5 | [`technical-design-and-knowledge.md`](./technical-design-and-knowledge.md) §4.4 | 每份合同（ADR-0016） |
| V4 试玩 | 用户在真实预览里逐条确认 | 验收条目 `check: playtest` / `both` | 有此类条目时 |

`can_merge` 只在 V0～V3 全部 `PASSED`（V0 / V2 不存在时视为不适用，并在证据中注明 `not_applicable`）、且 V4 无未确认项时为真。

**ADR-0005 合规方式**：V1（义务红绿）、V3（知识库）和 §5（测试完整性）的判定逻辑是 Daemon 代码，但它们不在 Daemon 进程内直接给结论。它们以 Daemon 自带的 CLI 子命令运行（`stagent check obligations | test-integrity | knowledge`），是真实子进程，退出码 0 / 1。这些命令在**签署前**由 `ScopePlan` 写进 `verification_spec.commands` 与 `allowed_commands`（TASK-L.3、L.12）。因此 `can_merge` 仍只由真实进程退出码派生，模型对它没有设定权。

---

## 3. 测试义务与红绿检查（V1，TASK-L.3 / L.4）

### 3.1 义务从哪来

方案 `acceptance[]` 中每条 `check: auto` 或 `both` 的条目，在建合同时写进合同 `supervisor_metadata.acceptance_refs`（带 id 与 `check`，TASK-L.3）。测试文件路径在 L.11 之前用约定路径 `tests/stagent/<acceptance_id>.test.<ext>`，之后由 DesignNote `test_plan` 指定（DN-3 保证不漏）。两种情况下路径都必须落在签署前已进入 `ScopePlan` 的 `tests/stagent/**` 内。

义务是**运行期产物**：存于 `.stagent/records/<contract_id>/obligations.json` 与证据，不写进合同正文（签署后不改合同）。一条义务记作：

```ts
interface TestObligation {
  acceptance_id: string;      // 方案验收条目
  test_path: string;          // DesignNote 指定的测试文件
  level: "unit" | "integration" | "e2e";
}
```

### 3.2 两段式施工

一份合同的施工分两段。两段都由 Worker 执行，但写范围不同，因此实现阶段**物理上**改不了测试：

| 段 | Worker 写范围 | Daemon 检查 |
| :--- | :--- | :--- |
| **T 段 · 先写测试** | 只有义务测试文件（以及测试夹具目录，若 DesignNote 声明） | **红**：在基线代码 + 新测试上运行义务命令。按测试运行器的机器报告判定：收集到 ≥1 个用例且 ≥1 个**断言失败**才算红。收集或编译错误记 `OBLIGATION_RED_INVALID`；全部通过记 `OBLIGATION_NOT_RED`。两者都让 T 段返工 |
| **I 段 · 再实现** | 合同 `writable_paths` **减去** T 段写过的测试文件（这些文件在 I 段只读） | **绿**：义务测试全部通过；V0、V2、V3 通过 |

实现方式：

- Daemon 在 T 段结束时提交一次（`task/<id>` 分支上的中间提交），记下 `red_sha`。
- 网关新增**运行期收窄**入参 `phaseOverlay`（TASK-L.4）：T 段 `testWriteAllowlist = 义务文件`，其余写范围列入 `extraForbidden`；I 段 `extraForbidden = T 段写过的文件`。
- 收窄只能比合同更窄，不持久化、不改合同；禁止项优先于可写项（复用 `src/lib/scope.ts::checkWriteAccess` 的顺序）。
- **回 T 段**：I 段义务判绿连续失败 2 次时，允许回到 T 段一次（附失败输出）；再失败 → `PENDING_RESUME`，并弹意外卡。

**义务命令**：由 `detectRunner` 选出运行器，`obligationCommand` 生成精确 argv。运行器与机器报告参数：vitest `--reporter=json`、jest `--json`、pytest `--junitxml=<file>`、go `test -json`。argv 在签署前进入 `allowed_commands`（`runCommand` 只接受精确匹配，`daemon/runner/command-runner.ts`）。

### 3.3 网关策略调整

- `ScopePlan` 在签署前加入写范围 `tests/stagent/**`，满足网关现有的「显式包含测试路径」条件（`daemon/guard/test-integrity.ts::scopeExplicitlyIncludesTests`）。
- **现有规则的缺陷**：`scopeExplicitlyIncludesTests` 对整组 `writable_paths` 做一次 `some()`，只要有一条测试路径，任何可写目录下的测试文件都可写。因此「既有测试只读」不能靠现有规则保证，必须靠 `phaseOverlay.testWriteAllowlist`：两段中，测试文件只有义务清单内的可写。这是**网关变更**，在 TASK-L.4 的不变声明中登记。
- 修改既有测试需要单独的 `kind: "refactor"` 合同。

### 3.4 证据扩展

`EvidenceBundle` 新增可选字段 `obligations`（`src/lib/evidence.schema.ts`，向后兼容）：

```ts
obligations?: Array<{
  acceptance_id: string;
  test_path: string;
  red: { sha: string; exit_code: number };     // 必须 ≠ 0
  green: { sha: string; exit_code: number };   // 必须 = 0
}>;
```

合并 Trailer 不变；`Stagent-Tests-Modified` 继续如实记录。

### 3.5 豁免（必须可见）

只有一种情况允许某条 `check: auto` 的义务不写测试：项目没有任何能运行该层级测试的工具（例如要求 `e2e`，但项目没有 e2e 运行器）。此时：

- `deriveObligations`（TASK-L.3）把该义务的 `level` 改为可用的最低层级；
- 一个层级都不可用时，记 `obligation_waived: "no_runner"`，并把该条目的验收方式降级为 `playtest`；
- 「合入」卡上必须白话显示：「这一条没有自动测试，靠你试玩确认」。

大项目不允许长期这样：见 §6 测试底座。

---

## 4. 回归积累（V2）

每份合同的义务测试合入后，就成为项目 `test` 脚本的一部分。之后每份合同的 V2 都会跑它们。不需要单独的回归清单。

**不稳定测试**：同一候选提交上，某条测试第一次失败、重试后通过，记为 `flaky`。规则：

1. 命令以**最后一次**运行的退出码为准；每次重试计入 `max_verification_retries`。
2. `flaky` 记录追加到 `.stagent/records/flaky.jsonl`（测试名、合同号、次数）。
3. 同一测试在 3 份不同合同中被记为 `flaky`，计划自动追加一份 `kind: "refactor"` 合同桩「修稳这条测试」，等待正常排期。
4. 不自动跳过或隔离任何测试。跳过测试等于削弱门禁（ADR-0001 单向约束）。

---

## 5. 既有测试的完整性

Worker 修改既有测试文件（只可能发生在 `refactor` 合同里）时，Daemon 比对基线与候选，以下任一情况即证据 `FAILED`，原因码 `TEST_WEAKENED`：

- 断言调用数下降（按语言计数 `expect(` / `assert` / `assert_eq!` 等，计数规则放在 `daemon/guard/test-integrity.ts`）；
- 新增 `.skip` / `.only` / `xit` / `@pytest.mark.skip`；
- 删除整个测试文件，而合同 `intent` 没有声明删除。

---

## 6. 测试底座合同（`kind: "test_foundation"`）

目标仓库没有任何测试脚本、且方案为 `large` 时，计划的第一份合同必须是它（[`project-decomposition.md`](./project-decomposition.md) D-8）。

| 项 | 规定 |
| :--- | :--- |
| 产出 | 安装项目语言的主流测试运行器（Node：vitest；Python：pytest；Go / Rust：内置）；新增 `test` 脚本；一条冒烟测试 |
| 依赖与网络 | 在**签署前**由 `ScopePlan` 按桩种类加入（TASK-L.9）：`dependency_changes_allowed: true`；精确安装命令（如 `npm install -D vitest`）进入 `allowed_commands`；`network_policy: "EXPLICIT_TARGETS"`，目标只有包管理器注册表域名 |
| 锁文件 | `package-lock.json` 等在 `src/lib/writable-scope-grade.ts` 中属敏感类，进入 `needs_approval`，由「确认开工」一次点击授权（delivery-lifecycle §5 SA-1） |
| 验收 | `npm test`（或对应命令）退出码 0，且冒烟测试被实际执行（输出中出现测试名） |
| 用户可见 | 「先给项目装上自动检查，之后每一步都能自动验收」 |

---

## 7. 真实预览（V4 的前提，TASK-L.5）

试玩必须看到 Worktree 里**运行着的真实应用**，而不是静态原型。

| 步骤 | 规定 |
| :--- | :--- |
| 1. 选命令 | 按顺序取 Worktree 中 `package.json` 存在的第一个脚本：`dev` → `start` → `preview`。都没有：沿用现有静态目录模式（`dist/`、`build/`、`public/` 中第一个存在的），再没有则显示「这个项目没有可预览的页面」 |
| 2. 分端口 | 复用真机预览端口段 **4200～4210**（`daemon/supervisor/preview/types.ts`）；以 `PORT` 环境变量传入。不新开端口段，避开 Demo 的 4100～4110 |
| 3. 启动 | 用 `daemon/worker/cli-host/process-host.ts::spawnManaged` 启动长驻进程（`runCommand` 只在进程退出时返回，不适用），cwd = Worktree；环境变量走 `daemon/runner/env-filter.ts` 白名单。预览是 Daemon 自有进程，与 Demo 预览服务同类，不进合同 `allowed_commands`，不改合同 |
| 4. 探活 | 每 500ms 对 `http://127.0.0.1:<port>/` 发 GET，任意 HTTP 响应（含 3xx / 4xx）即就绪；默认 30 秒超时（可注入，测试用更短值）→ 预览失败卡，附 stdout / stderr 尾部 |
| 5. 挂载 | 以真机预览的「登记已有 URL」模式注册，中栏 `RealPlaytestPane` 加载 |
| 6. 回收 | 合入、放弃、合同 `ABORTED`、Daemon 退出时，对进程组 SIGTERM，3 秒后 SIGKILL（复用 `daemon/runner/process-tree.ts`），释放端口 |

预览进程不是验证命令，它的退出码不影响 `can_merge`。试玩结果只影响 V4。

---

## 8. Worker 指令补全（TASK-L.2）

`buildWorkerTaskInstruction` 增加「你会被这样检查」一段，原样列出：

1. `verification_spec.commands` 的 argv（TASK-L.2）；
2. 本段（T 或 I）的测试义务（TASK-L.4）；
3. 知识库检查 KB-1～KB-5 的规则摘要（TASK-L.12）。

理由：判卷标准对考生公开，不削弱判卷的独立性（判卷仍由 Daemon 按退出码完成）；不公开只会让 Worker 盲目试错，浪费预算。

---

## 9. 测试矩阵

| ID | 场景 | 期望 |
| :--- | :--- | :--- |
| VS-01 | T 段测试在基线上全部通过 | `OBLIGATION_NOT_RED`，T 段返工 |
| VS-02 | I 段 Worker 试图写 T 段测试文件 | 网关拒绝（越界），证据记 `scope_violation` |
| VS-03 | 义务测试红→绿，V0 / V2 / V3 通过 | `can_merge === true`；`obligations[]` 每项 `red.exit_code ≠ 0`、`green.exit_code = 0` |
| VS-04 | 要求 e2e，但项目无 e2e 运行器、有单测运行器 | 义务降为 `unit`，不豁免 |
| VS-05 | 项目无任何测试运行器（非 large） | `obligation_waived: "no_runner"`；合入卡显示白话提示 |
| VS-06 | `refactor` 合同删掉一条 `expect(` | `TEST_WEAKENED` |
| VS-07 | 新增 `it.only` | `TEST_WEAKENED` |
| VS-08 | 同一测试第一次失败、重试通过 | 以最后结果为准；`flaky.jsonl` 追加一行；重试计数 +1 |
| VS-09 | 预览：`package.json` 有 `dev` 脚本 | 以 `PORT=42xx` 启动，探活成功，`RealPlaytestPane` 加载该 URL |
| VS-10 | 预览：30 秒内无响应 | 预览失败卡含 stderr 尾部；进程组被回收 |
| VS-11 | 合入后 | 预览进程组已退出，端口可再分配 |
| VS-12 | Worker 指令 | 含 `verification_spec.commands` argv 与义务列表 |
| VS-13 | T 段测试有语法或导入错误 | `OBLIGATION_RED_INVALID`，不算红 |
| VS-14 | I 段义务判绿连续失败 2 次 | 回到 T 段一次；再失败 → `PENDING_RESUME` |
| VS-15 | 存在 1 条义务路径时，Worker 写未列出的既有测试 | 网关拒绝（`phaseOverlay.testWriteAllowlist`） |
