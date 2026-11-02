# 规格一致性审计收尾记录（2026-10-28）

> **位置（2026-10-29 文档治理）**：本文原在 `docs/specs/`，现移入 [`docs/ledger/`](./README.md)。它是台账（OP 挂账、待裁决、销项），不是规格；放在 `specs/` 会让人误当施工依据。条目与编号不变。

> **性质**：审计收尾记录，只登记、不改任务状态。任务卡（`development-tasks.md`）状态未改动。
> **2026-10-28 裁决落笔**：C-3、C-4、C-5 已拍板并移入「一之二」；OP-11 已销项（见「五」第 10 项）；新增 OP-19（C-4 按钮文案统一）。本次修改不改任务状态。
> **2026-11-01 裁决落笔（Tina）**：OP-1 → 洗白；OP-13 → 第一印象窗口不阻塞。
> **2026-11-01 立卡（Tina）**：台账债六项 → `TASK-A.7` / `H.9` / `W.6` / `L.18` / `J.19` / `J.20`（OP-1 实施）。裁决 OP-1/OP-13 仍销项；Sprint 首要仍 L.12。
见「一之二」增补与「三」划线销项；落点 `scheme.md` dec-10/dec-11、supervisor §13.3 / §14.11 K-12、playtest-self-check §5.1。
> **2026-11-01 裁决落笔（Tina · oq-2）**：北极星「一模一样」判据 → 用户对话试玩 + 结构化证据桩（绑定版本/原话/时间戳）；AI 引导不代判；无机器自动对比。见「一之二」增补；落点 `scheme.md` dec-12、oq-2（已销项）、acc-6，解除 `TASK-L.17` 产品阻塞。
> **2026-11-01 裁决落笔（Tina · oq-3）**：凭据存 Vault 至用户手动删除（不设自动过期、不按项目联动清理）；代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、零账密。见「一之二」增补；落点 `scheme.md` dec-13、oq-3（已销项），解除 `TASK-L.17a` 前置依赖。
> **2026-11-01 L.17a 交付与 L.17b 解封**：L.17a #70（`8516c3d`）已合入 main，标记为 `[COMPLETED]`；`TASK-L.17b`（对比视图与试玩证据桩）正式解除阻塞恢复 `[READY]`。当前 main tip 为 `8516c3d`。
> **2026-11-02 L.17b 交付（P-112 · M5 主序收官）**：L.17b #72（`d26def6`，squash merge）已合入 main，标记 `[COMPLETED]`；**M5 北极星主序（L.16 → L.17a → L.17b）全部落完**。当前 main tip 为 `d26def6`。交付口径见 `development-tasks-completed.md` §3.4f。残余边界挂账共 6 条，**同批归拢**至 `development-tasks-completed.md` §3.4f「残余边界 / 后续挂账」节；其中 L.17b 三条在本文「三」新增登记为 OP-36～OP-38（`resolveCurrentLiveReleaseId` 回退粒度 / 合同文件名两套口径 / 每合同只留最新证据无历史链），另 3 条为 W.8 两条（`STAGENT_SESSION_TOKEN` 回退、`/api/shutdown` 手写 mock）与 L.17a `request.headers` 一条，仅归拢不另立 OP 号。另：`check playtest` 尚未被 verification profile 引用，属后续配置面，**待裁决，本卡未擅自登记为正式挂账**。不宣称端到端 UI 闭环（CompareView 未挂路由、原话采集 UI 未实现）。
> **2026-11-02 W.6 交付（P-113 · 主序收官后首张债卡销项）**：W.6 #74（`b5d8c53`，squash merge）已合入 main，标记 `[COMPLETED]`，ledger **DLV-3 → RESOLVED**。当前 main tip 为 `b5d8c53`。交付口径见 `development-tasks-completed.md` §3.4g：Registry 挂派工工厂、内置 Managed AI 受控派工（双 id 别名）、Claude Code worker 仅登记 `UNCONTROLLED_EXTERNAL` 不挂工厂、`requireControlledDispatch` 缺注册/非受控/无工厂显式错误码不静默降级、能力载体 `run()` 合前改为显式抛错。残余边界 2 条（能力载体 `run()` 语义已修记为设计决策 / `GET /api/adapters` 未做端到端 HTTP 验证）**沿用 P-112 先例仅归拢至 completed §3.4g、不另立 OP 号**（OP 范围仍 OP-1～OP-38）。`TASK-W.7` 硬前置解除（仍 `[NEW_TASK]`）；Sprint 下一张 `W.5c`（容器沙箱）。**`ruling 3`（`check playtest` 接验收档）docs 待落盘**——本文及 §3.4f 均无该裁决原文，本次**未擅自改写裁决口径或虚构登记**，待 Tina 给出裁决原文后落笔。不宣称端到端闭环。
> **2026-11-02 裁决落笔（Tina · P-114 · ruling 3 + W.5b/c 去留）**：上条第 14 行「待 Tina 给出裁决原文后落笔」已于本条兑现（按「保留原文作溯源」惯例不改上条原文）。**① ruling 3（`check playtest` 接验收档）**：北极星合同（带 `references[]`）的 `verification_spec.commands` **自动附加** `{alias:"playtest", executable:"stagent", args:["check","playtest","<contract_id>"]}`，使试玩认可成为合并门禁；**非北极星合同不附加**。实现属小卡（合同装配段 + 测试），**另行立卡或挂账**——本轮仅落裁决口径，**未立卡、未开工**。落点：`development-tasks-completed.md` §3.4f「待裁决」改「已裁决」、`development-tasks.md` 版本头第 114 条 / Sprint 当前首要任务、`development-tasks-changelog.md` P-114、`scheme.md` 更新指针（不改写 dec-12 / dec-13）。**② W.5b/c 去留**：`TASK-W.5b` / `TASK-W.5c` **保留在队列、不再列为待定项**；Sprint 排程写死 **`W.5c` → `W.7` → `W.5b`**（W.5c 兼 W.7 探测地基、W.5b 作 W.7 回归基准）。本裁决**不新增 OP 号**（OP 范围仍 OP-1～OP-38，沿用 P-112 / P-113 先例仅归拢、不虚构登记）；`evidence-and-acceptance-criteria.md:80`「适用范围待裁决」经复核属 §3.4 独立性要求历史判例、与本轮 ruling 3 无关，**未改**。物理 tip `61eb003`（#75 P-113 docs 回写）。**不**宣称 `check playtest` 已接 verification profile（实现未开工）。
> **2026-11-02 W.5c DoR 正文重写与 tip 同步（P-115）**：P-114 已合入 #76/`ec871c4`（squash）。Tina 授权由本侧接手 W.5c 开工前 DoR 复核的后续：`TASK-W.5c` 卡正文按 `task-card-standard.md` R-1～R-12 补齐（原仅 R-3 达标，本表 **DOR-3**），含双枚举 `SANDBOX_ENFORCED` 漏改即 FAIL、代码事实锚点、PASS 七条可译 `it(...)` 断言、不变声明、凭证仅 API Key；**估算判 L，按 R-11 须先拆分子卡（建议 `W.5c-i/ii/iii`），拆卡另行授权**——本轮仅重写正文、不拆、不开工、不改 Sprint 排程与 §1.1 矩阵，`TASK-W.5b` 的 DOR-3 债保留挂账。现行 tip 由 `61eb003` 推进至 `ec871c4`（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）；本文第 14/15 行与版本头第 114 条、changelog P-114、ledger README P-114 注记里的 `61eb003` 按「保留原文作溯源」惯例不改写。写实纠偏：`system-architecture.md` §9.1 标题标 `[待实现 - 目标数据模型]`（原卡误当既成事实）；W.5b 卡所引「架构 §0.6.6」节号不存在（本轮不动 W.5b，留待其重写时校正）。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称 W.5c 已可开工或已实现。
> **2026-11-02 P-115 合入 tip 同步、DoR 措辞归位与 `W.5c-iii` 环境前置登记（P-116）**：P-115（`774ce31`）经 Tina 审阅「可合、6 文件纯 docs」后以 **#77/`1c00db7`**（squash）合入 main（与分支 tree 一致；`774ce31` 非 ancestor 为 squash 语义）。本文第 14/15/16 行、版本头第 114/115 条、changelog P-114/P-115、ledger README P-114/P-115 注记里的 `61eb003` / `ec871c4` 按「保留原文作溯源」惯例**不改写**；**现行 tip 由 `ec871c4` 推进至 `1c00db7`**（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。**① 措辞归位**：按审阅意见将嵌在 W.7 状态括注内的 W.5c/W.5b 债说明移出、独立成句（Sprint 首要块 + `development-tasks-active.md` W.7 卡状态行两处），消除「读成 W.7 的债」的归属歧义；语义 / Sprint 排程 `W.5c → W.7 → W.5b` / §1.1 矩阵 / W.7 卡「非目标」边界声明均未改。**② `W.5c-iii` 环境前置（只读核查）**：`OS-06` 需 `STAGENT_REAL_OPENHANDS=1` 与可用容器运行时；核查本机有 Docker CLI 29.6.1（darwin/arm64）但 daemon 不可达（两种 sock 路径均不存在、无 dockerd/containerd/colima/lima 进程），podman/nerdctl/colima/lima 未装、env 未设置 → **当前仅客户端、无运行时，此时开工实测会空转**。登记为前置事实，不改 W.5c 卡正文。**拆卡授权仍待 Tina 拍板**（本轮未拆、未开工）。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称 W.5c 已可开工或已实现。物理 tip `1c00db7`。
> **2026-11-02 P-116 合入 tip 同步（P-117）**：P-116（`85d3316`）经 Tina 告知已合入，以 **#78/`b5d0ef5`**（squash）落 main；走 `git fetch origin` + `git ls-remote origin` 双重确认远端 tip（`fetch --all` 中 HTTPS remote 报 502、不影响 SSH 的 `origin`），与分支 tree 一致，`85d3316` 非 ancestor 为 squash 语义。本文第 16/17 行、版本头第 115/116 条、changelog P-115/P-116、ledger README P-115/P-116 注记里的 `ec871c4` / `1c00db7` 按「保留原文作溯源」惯例**不改写**；**现行 tip 由 `1c00db7` 推进至 `b5d0ef5`**（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。P-116 的 W.7 措辞归位与 `W.5c-iii` 环境前置登记为现行内容、本轮未改。**拆卡授权仍待 Tina 拍板**（本轮未拆、未开工）；`W.5b` 的 DOR-3 债仍在。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称 W.5c 已可开工或已实现。物理 tip `b5d0ef5`。
> **2026-11-02 W.5c 拆分授权落卡、TASK-C.23 立卡（P-118）**：P-116 以 **#78/`b5d0ef5`**（squash）合入 main（走 `git fetch origin` + `git ls-remote origin` 双重确认；`fetch --all` 中 HTTPS remote 报 502、不影响 `origin`）；上轮推送的 tip 同步分支 `99d3387` 已由 **#79/`b0fa8a0`** 以 **P-117** 先行落 main 承接，本条顺延为 **P-118**（`P-117` 流水被 tip 同步占用，非跳号）。本文第 16/17 行、版本头第 115/116 条、changelog P-115/P-116、ledger README P-115/P-116 注记里的 `ec871c4` / `1c00db7` 按「保留原文作溯源」惯例**不改写**；**现行 tip 由 `1c00db7` 推进至 `b0fa8a0`**（#79 P-117；其下 #78 `b5d0ef5` 为 P-116；`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。**① W.5c 拆分（经 Tina 2026-11-02 授权）**：母卡 `[SPLIT]` 保留追溯；三张子卡按 DoR R-1～R-12 写全——`W.5c-i`（`[READY]`，S/M）、`W.5c-ii`（`[READY（跟随 i）]`，M，mock/stub 可测）、`W.5c-iii`（**`[BLOCKED · 等容器环境]`**，M，硬前置容器运行时 + `STAGENT_REAL_OPENHANDS=1`）；`W.5c-i` 窗口期语义「注册接受、派工拒绝」入库防假受控；DAG JSON 增 `i→iii`、`ii→iii` 两条边。**② 立 `TASK-C.23`**（`[READY]`，S）：兑现 ruling 3（P-114 已裁决），带 `references[]` 合同自动附加 `check playtest` 验收命令、非北极星不附加、幂等；R-4 写实两处装配点（`createContractDraft` + scheme 确认覆盖路径）须同改。**纠正本文第 15 行 P-114 落笔中「未立卡、未开工」的当日口径**：ruling 3 实现卡已于本次落为 `TASK-C.23`（按「保留原文作溯源」惯例**不改第 15 行原文**，现行口径以本条为准）。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**开工实现、**不**宣称端到端闭环。物理 tip `b0fa8a0`。
> **2026-11-02 W.5c-i 与 C.23 双卡合入回写（P-119）**：本文第 16/17 行、版本头第 115/116 条、changelog P-115/P-116、ledger README P-115/P-116 注记里的 `ec871c4` / `1c00db7` 按「保留原文作溯源」惯例**不改写**；**现行 tip 由 `b0fa8a0` 推进至 `a5223fb`**（#82 C.23 代码 squash；其下 #81 `c3e75cc` 为 W.5c-i 代码 squash、#80 `cda4e13` 为 P-118 docs 回写；`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。**① `TASK-W.5c-i` → `[COMPLETED]`**（#81/`c3e75cc`）：`AdapterControlMode` 与 `workerControlModeSchema` 两处同扩 `SANDBOX_ENFORCED`（SE-01 读源码正则断言防单边漏改）、`workerSpecSchema` 增 `billing_model` / `verified_on`、**窗口期语义**（注册接受、`requireControlledDispatch()` 显式拒绝派工 `E_ADAPTER_SANDBOX_LOCKED`、挂了工厂也拒绝）。下游 5 处 TS2322 以 `toRuntimeControlMode()` 收窄解决；**`evidence.schema.ts` 二值枚举有意未扩**，挂账待 `W.5c-ii` 评估证据模型版本语义。**② `TASK-C.23` → `[COMPLETED]`**（#82/`a5223fb`）：以单一 helper 接 `createContractDraft` 与 scheme 确认覆盖路径**双装配点**，ruling 3 兑现，判定源 `playtest-guard.ts` 未动。**③ 合并顺序**：两 PR 均改 `contract.schema.ts`（区域不重叠），按「先合 A、B rebase 后合」执行；rebase 前后均验证（零冲突、88 passed、`tsc` 57=baseline）。**④ 挂账 7 条**入 completed §3.4h / §3.4i。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称容器隔离运行时已落地或 `check playtest` 端到端闭环。物理 tip `a5223fb`。
> **2026-11-02 P-119 合入 tip 同步（P-120）**：本文第 19 行、版本头第 119 条、changelog P-119、ledger README P-119 注记里的 `b0fa8a0` / `a5223fb` 按「保留原文作溯源」惯例**不改写**；**现行 tip 由 `a5223fb` 推进至 `64b737f`**（#83 P-119 docs 回写；其下 #82 `a5223fb` 为 C.23 代码、#81 `c3e75cc` 为 W.5c-i 代码；`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。双重确认走 `git fetch origin` + `git ls-remote origin`（HTTPS remote 报 502 不影响 `origin`），与分支 tree 一致。P-119 的双卡 COMPLETED 与挂账 7 条为现行内容、本轮未改。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**开工 `W.5c-ii` 实现。物理 tip `64b737f`。
> **2026-11-02 W.5c-ii 交付（P-121）**：`TASK-W.5c-ii`（容器运行时 `runInSandbox` + 派工门禁按宿主可用性解锁）→ **`[COMPLETED]`**（[#85](https://github.com/he18718143986-design/IDE/pull/85)/`648be31`，squash）。上条（P-120 注记）物理 tip `64b737f` 为当日状态，按「保留原文作溯源」惯例**不改写**；**现行 tip 由 `64b737f` 推进至 `648be31`**（#85 W.5c-ii 代码 squash；其下 #84 `cc55037` 为 P-120 docs 回写、#83 `64b737f` 为 P-119 docs 回写）。**W.5c-i 窗口期语义解除**：`SANDBOX_ENFORCED` 派工按 `ContainerHostPort` 可用性判定（未注入 / 不可用 → `E_ADAPTER_SANDBOX_LOCKED`，可用 → 放行，且沙箱档不再过 `registry.requireControlled()`）；`toRuntimeControlMode()` 收窄移除、`evidence.schema.ts::worker_control_mode` 扩三值并如实记档（经 Tina 裁决「本卡同步扩三值」）。**证据面裁决注记（记实不记名）**：`worker_control_mode` 记实际执行面而非合同声明档，容器路径未实际执行记 `UNCONTROLLED_EXTERNAL`（沿用 `W.4` 降级记实惯例）；`runInSandbox` 生产零调用、无「是否真进容器」信号，故该裁决在执行面接线前不可强制执行，随 `W.5c-iii` 落地。**关键边界（W.5c-iii 必收）**：`ContainerHostPort` 只是「给工厂用」的注入端口，执行面无法外部强制派工必须走 `runInSandbox`，绕过容器本地执行仍可能 → `W.5c-iii` FAIL 已补「派工未走 `runInSandbox` → FAIL」，`W.7` 探测包可作验证项。其余 4 条挂账（`durationMs ??` 死代码、取消前置 `via:"SIGKILL"` 语义偏移、`evidence.schema.ts` 跨版本可读性、施工指令误传的 `E_ADAPTER_SANDBOX_AVAILABLE` / `E_ADAPTER_SANDBOX_FAILED` 在代码中不存在）**沿用 P-112 / P-113 先例仅归拢至 completed §3.4j、不另立 OP 号**（OP 范围仍 OP-1～OP-38）。**本表 DOR-3** 中 `TASK-W.5b` 的债**仍在**。Sprint 首要推进 `W.5c-iii`（仍 `[BLOCKED · 等容器环境]`）。**不**宣称容器隔离执行已落地或端到端闭环。
> **2026-11-02 W.5c-iii 交付（P-122 · 容器隔离链路收官）**：`TASK-W.5c-iii`（OpenHands 适配器 + 真实容器实测 + `verified_on`）→ **`[COMPLETED]`**（[#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a`，squash merge）。本文第 22 行（P-121 注记）中「现行 tip `648be31`」「Sprint 首要推进 `W.5c-iii`（仍 `[BLOCKED · 等容器环境]`）」为当日状态，按「保留原文作溯源」惯例**不改写**；**现行 tip 由 `648be31` 推进至 `2313597a`**（#87 W.5c-iii 代码 squash；其下 #86 `8ffcde2` 为 P-121 docs 回写；`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针），**Sprint 首要推进至 `TASK-W.7`**（排程 `W.7 → W.5b`）。**① 环境前置解除**：P-116 记载的「仅 Docker 客户端、无守护进程」为 2026-11-01 状态；2026-11-02 施工前环境验证全绿（Docker Desktop 29.6.1 daemon 可达 + 镜像按摘要固定 + `STAGENT_REAL_OPENHANDS=1` 实测 11/11），`[BLOCKED] → 施工 → COMPLETED` 全段走完。**② 围栏档与 REJ-010（本表口径相关）**：`W.5c-i` 曾把 `SANDBOX_ENFORCED` 判为「同走严格档」，`W.5c-iii` 经裁决（ruling A）改为**独立围栏档**——只校验 `known_limitations` 非空 + 平台矩阵非空，允许 `DIRECT_UNCONTROLLED` / `UNRESTRICTED_SHELL` / `tool_interception=false`；严格档与标识档原样不动、不新增拒绝码。为防该放宽被用来「按宿主侧修辞口径填声明」，**新增 `scheme.md` §10 墓地条目 `REJ-010`「能力声明不得按宿主侧修辞口径造假」**——档位差异由校验档与运行时门禁承载，不得由声明文字承载。**③ 证据面裁决可强制执行**：P-121 登记的「`worker_control_mode` 记实际执行面而非合同声明档」此前因 `runInSandbox` 生产零调用**不可强制执行**；本卡补 `SandboxWitness` 证据面消费（`resolveEvidenceControlMode`：声明 `SANDBOX_ENFORCED` + 无见证 → `UNCONTROLLED_EXTERNAL`），该裁决**自此成为强制执行点**。**④ 挂账 4 条**仅归拢至 `development-tasks-completed.md` §3.4k（`openhandsControlMode` 降级分支是防呆非废码 / `durationMs ??` 死代码 / `EXPLICIT_TARGETS` 需 netns·iptables 级实现 / **`runWorker` outcome 的 `worker_control_mode` 仍为声明档未校正——两个记录点只有证据面被校正**），**沿用 P-112 / P-113 / P-121 先例不另立 OP 号**（OP 范围仍 OP-1～OP-38）。**本表 DOR-3** 中 `TASK-W.5b` 的债**仍在**。**不**宣称端到端闭环（模型驱动链路因出站 `DENY` 未实测、`EXPLICIT_TARGETS` 未兑现、diff / 范围校验仍由后续网关侧采集）、**不**宣称「绝对受控」（见证为结构性约束、非密码学不可伪造；实测措辞限定「通过已知探测集」；平台仅 `darwin-arm64`）。

> **基线**：`main` @ `e610016`。**PR #9 仍为 open、未合入**。本记录的机械修复与 PR #9 不重叠：PR #9 改动 supervisor §12 与 §20、dev-tasks 的 S.5 / J.10 / J.16 与状态回写 39→83、runtime §8 L3 行、README 附属段；本记录不触及这些位置。两者合并顺序互不影响。**本记录完成后更新**：PR #9（`e430193`）与本记录所在 PR #10（`99cfe51`）已先后合入 main；上文「open、未合入」为撰写时的历史状态。
> **行号**：本文「行号」指 `e610016` 快照中的物理行，仅供审计定位；规格正文不引用行号。
> **编号**：`C-` 待裁决矛盾；`M-` 本 PR 机械修复；`OP-` 挂账项。`C-1` 本轮无前次记录，留空位。

## 一、待裁决矛盾（未修，等裁决）

| 编号 | 矛盾 | 双方位置 | 建议（待裁决，未采纳） | 裁决人 |
| :--- | :--- | :--- | :--- | :--- |
| C-1 | 留空：本轮未找到前次审计的 C-1 记录 | — | 若前次 C-1 存在，请告知后合并编号 | Tina |

**C-2 已修**（见 M-7、M-8）：`demoReady` 的「≥2 个业务模块」与 supervisor 第三部分 §14.10 的「≥1 个 `user_visible` 模块」冲突。已按 §14.10 裁决，相关位置改为指针，不再复述谓词。

## 一之二、已拍板裁决（2026-10-28，Tina）

| 编号 | 原矛盾 | 裁决 | 裁决依据 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| C-3 | Fast Path 的施工载体（Worktree / VIBE 直改）口径不一致 | 免 Worktree **仅限非生产产物**（Demo 展示代码、图标/素材、`.stagent/` 内方案文档）；会进入可执行工程的生产代码（`src/`、`daemon/`、工具链产物）**一律走 Worktree**。VIBE 直改仅适用于上述非生产产物。 | Tina 裁决（2026-10-28）。非生产产物无交付风险；生产代码须可审计、可撤销，故走 Worktree。 | supervisor §16.11「免 Worktree 边界」；架构 §0.2.3.1 加例外指针 |
| C-4 | 超时卡（D-3）仍请用户选「按 Bug 修复 / 按新需求演进」 | 出口改为白话二选【这是 Bug，免费修】/【我想要新功能，下一轮做】；分类由系统内部归，接 attributions 路由，不向用户暴露技术分类。**按钮文案已统一为 supervisor §16.7 文案，OP-19 已销项。** | Tina 裁决（2026-10-28）。 | 架构 §6.4 D-3 单元格 |
| C-5 | 「三次上限」是否包含自动重试 | 三次上限**仅计用户手动触发的重试**；系统首次自动重试不计入，计数器只在用户手动重试时递增。 | Tina 裁决（2026-10-28）。原审计所指的冲突自动重试位于 supervisor 第三部分 §16.8。 | 架构 §6.4 D-1 单元格；supervisor §16.8 |
| J9-1 | 墓地 A-04 与被拒建议（墓碑 `item_ref` 指向仍存活条目，(a) 按 id 命中导致自我违反不变量） | 保留豁免，不改墓碑结构：A-04 跳过 `item_ref` 指向且仍存活的那一条（用户选择保留的版本）；后续补丁仍由 P3 的 (a) 拦截。`item_ref` 是 K-4 回溯链，去掉会削弱 (a) 闸门 | K-4 回溯链；(a) 是后续同 id 复活的最强闸门 | `scheme-patch-engine.md` §5.5 A-04 行豁免条款；代码注释改指向该条款 |
| J9-2 | 锚定判例 Q-16、Q-19 与 §3.3 步骤 5「先过滤后选取」冲突 | 以步骤 5 为准，判例改写：Q-16 取过滤后第 1 处，Q-19 判 `E_QUOTE_TOO_SHORT_UNBOUNDED`。规格勘误：判例与算法冲突时以算法为准，但判例必须同步修改，不得保留旧期望 | 步骤 5 是规范算法，`anchorQuote` 实现与之一致 | `scheme-patch-engine.md` §3.3 步骤 5 澄清、§3.4 勘误说明与 Q-16/Q-19 行；测试已按新口径 |
| J9-3 | TM-Z-11 门禁墓碑的期望码（包装码 `E_PROPOSAL_PREVIOUSLY_REJECTED` 或 op 级码） | op 级码 `E_REVIVAL_SECURITY_LOCKED`。门禁墓碑永不复活，与用户否决墓碑的可复活路径是两类语义，包装码会模糊区分 | K-5 | `scheme-patch-engine.md` §5.3 码表注释；Z-11/Z-12 测试断言 |
| J9-4 | 旧墓碑缺 `rejected_after_turn_seq` 时的迁移默认值 | 默认 0，登记为行为性默认值（偏宽放，不偏紧收）；复活仍须过 R1–R9 闸门 | 旧数据无法确知否决水位 | `scheme-patch-engine.md` §1.3 K-13 |
| OP-1 | 确认路径 `occurrence` 洗白（`mark_user_confirmed`） | **洗白**：确认路径 `occurrence` 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同同一敏感项再次出现自动放行（对齐 K-12「显式风险」与 SA-1）。落地细节（白名单存储位置、scope 粒度、失效条件）由实施卡 **`TASK-J.20`** 确定（**不**回写已 COMPLETED 的 J.9）；本条只销裁决。 | **用户拍板 2026-11-01**；原话：「确认路径上 occurrence 机制生效——用户在「确认开工」时点名的敏感项进入授权清单，后续合同中同一敏感项再次出现自动放行」 | `scheme.md` dec-10；supervisor §14.11 K-12；SA-1 / delivery-lifecycle §5 |
| OP-13 | 第一印象窗口长度 | **不阻塞**：不设等待时长；可选速记提示；可跳过；跳过直接进入验收决定；异议随时经右栏 `user_dispute`。 | **用户拍板 2026-11-01**；原话：「第一印象速记窗口不设等待时长、非阻塞、可跳过；用户跳过则直接进入验收决定；用户异议随时经右栏走 user_dispute trigger」 | supervisor §13.3；playtest-self-check §5.1；`scheme.md` dec-11 |
| oq-2 | 北极星「一模一样」的判定方式（像素对比 / DOM 结构 / 用户试玩） | **用户对话试玩 + 结构化证据桩**：用户在右栏对着 AI 自由评阅，最终判定由用户明确表态（点「认可完成」或原话确认）并写入带 `contract_id`、用户原话、版本号（`release_id` 或快照）与时间戳的结构化证据记录；AI 在对话中只做引导和修改建议，不做机器代判；无机器自动对比。认可状态绑定具体版本，新版本重置。 | **用户拍板 2026-11-01**；原话：「acc-6 判定 = 用户与 AI 对话确认 + 「认可完成」动作落成结构化证据（用户原话 + 版本号 + 时间戳）；AI 只做引导，不做判定；无机器自动对比（不追求像素/DOM 指标）」 | `scheme.md` dec-12、oq-2、acc-6；`TASK-L.17` 验收栏；delivery-lifecycle M5 |
| oq-3 | 登录信息属于用户秘密：保存多久、谁能读、是否允许进入 Worker 环境？ | **凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登**：① 凭据存 Vault 直至用户手动删除，不设自动过期、不按项目联动清理；② 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密。**不变量重申**：账密与 cookie 绝不进合同、绝不进日志、绝不进 Worker 环境（维持 ADR-0014 §3 原口径）。 | **用户拍板 2026-11-01**；原话：「oq-3 凭据保管口径 = ① 凭据存 Vault 至用户手动删除（不设自动过期、不按项目联动清理）；② 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密」。出处记 conf-6「受控+Vault」裁决的延伸。 | `scheme.md` dec-13、oq-3（已销项）；`TASK-L.17a` 条款；conf-6 |


## 二、机械修复清单（本 PR）

| 编号 | 文件 | 位置（`e610016` 行） | 修改 | 依据 |
| :--- | :--- | :--- | :--- | :--- |
| M-1 | `docs/specs/supervisor.md` | §18 表，行 1604 | 第二个 `V-10`（点击中栏条目滚动并高亮）改为 **`V-14`** | 与行 1580 的 `V-10`（INV-LEDGER-01）撞号。未采用「改为 V-11」：行 1581 的 V-11（INV-LEDGER-02）已占用，改 V-11 会产生新撞号。V-14 全库无 §18 占用（intent-compiler 的 ADV-14 属另一命名空间）。 |
| M-2 | `docs/specs/supervisor.md` | §18 统计行，行 1611 | 「本节 35 条，`⏳ 35`」→「本节 39 条，`⏳ 39`」 | 表内实际 39 行：V-01～V-13 共 13、S2-01～S2-09 共 9、J-01～J-15 共 15、P-01 共 1、UI 的 V 行 1。 |
| M-3 | `docs/specs/supervisor.md` | §14.11 `attributions` 块，行 1155 | `trigger` 删除 `\| string` 兜底；新增可选 `linked_reason_code?: reasonCodeSchema`（只读引用，仅 `acceptance_fail` 可带） | K-16 原文；`playtest-self-check.md` §5.2、SR-5、TM-PK-11/12 与之一致。intent-compiler-prompt §2.2 的「非码类写入边界」无需改。 |
| M-4 | `docs/specs/playtest-self-check.md` | §5.2，行 274 | 「现行 SSOT」→「K-16 前 SSOT 口径（已由 K-16 收紧为闭集）」 | 避免把已收紧前的类型写成现行。 |
| M-5 | `docs/specs/supervisor.md` | 版本记录，行 27 | 「47 码责任表」后补注现行 51 码 | 历史条目不回改，只补注。`scheme-patch-engine.md` 与 `intent-compiler-prompt.md` §2.1/§2.2 无 47 命中，已核。 |
| M-6 | `docs/specs/development-tasks.md` | TASK-J.10 正文，行 2856 | 「（21/47）」后补注：47 为定稿口径，现行 51 码，待重算（OP-15） | 全库「21/47」仅此一处。 |
| M-7 | `docs/specs/runtime-contract-and-safety.md` | §3，行 133 | 「demoReady 的四条布尔底线」整行改为指针：「`demoReady` 判定以 `supervisor.md` §14.10（v2.1 改判：`≥ 1` 个 `user_visible` 模块）为准，本节不复述谓词。」 | C-2。 |
| M-8 | `docs/specs/supervisor.md` | §2.2 标题行，行 115（第 1 条在行 117） | 标题加改判指针：第 1 条已由第三部分 §14.10 改判 | C-2。§7 D5 段（行 822）已声称「各处已加改判指针」，本处此前缺失，属新发现。 |
| M-9 | `src/lib/error-codes.ts`（代码注释，可选项） | 文件头，行 6 | 「14 个 `error_code`」→「17 个 `error_code`」 | `ERROR_CODES` 数组实为 17 项。仅改注释，不改码表。若认为代码注释不应进文档 PR，撤回本条并转 OP-16。 |
| M-10 | 核对，无需改 | `development-tasks.md` TASK-J.9 卡（行 219、2823）与第二批预告（行 2905）的「V-10～V-13」 | 不改 | 指向 §18 行 1580–1583（INV-LEDGER-01～03 与 V-13），与 M-1 无关。 |

## 三、挂账项（本 PR 不改）

| 编号 | 挂账项 | owner | 触发条件 | 依据 |
| :--- | :--- | :--- | :--- | :--- |
| ~~OP-1~~ | ~~确认路径 `occurrence` 洗白（`mark_user_confirmed`）~~ | — | **已销项（2026-11-01）**：裁决「洗白」——确认路径 `occurrence` 生效，点名敏感项进授权清单、后续合同同项自动放行（K-12 / SA-1）。见「一之二」OP-1；实施卡 **`TASK-J.20`**（2026-11-01 立卡） | supervisor §14.11 K-12；`scheme.md` dec-10 |
| OP-2 | `remove_item` 去留（可绕过入墓） | J.10 实施 | J.10 实施期；若保留，先做组装期否定词检查 | PR #5 审核挂账 |
| OP-3 | `surface_log`（GAP-P8）呈现日志 | J.16 实施 | J.16 实施时写入 §15.4 投影 | playtest-self-check 行 61、305。非错误码，是数据字段；代码 0 命中。 |
| OP-4 | 门禁码无成表闭集 | J.18 实施 PR | 建立 runtime §8.1 闭集并同步 ERROR_CODES 映射时 | runtime §8 L3 行脚注；K-15 |
| OP-5 | `E_GATE_SCAN_FAILED` 仅存在于规格 | J.18 | J.18 实施时 | worker-graveyard-gate 行 338、439；`src/` 与 `daemon/` 0 命中 |
| OP-6 | `E_TEST_FILE_WRITE_BLOCKED` 有代码、未登记 | 门禁闭集 owner（J.18） | 闭集建立时登记入 §8.1 与 ERROR_CODES（需定映射） | `daemon/mcp/gateway.ts` 行 137 及多处抛出；不在 ERROR_CODES，runtime §8 L3 亦未列 |
| OP-7 | `E_PROPOSAL_PREVIOUSLY_REJECTED` 代码未实现 | J.18 | J.18 实施 PR（K-15） | 规格已登记；`src/` 与 `daemon/` 0 命中 |
| OP-8 | `E_CHECKPOINT_FAILED` 以字符串直接返回 409，未入码表 | J.18 闭集 | 同 OP-4 | `daemon/server.ts` 行 1767、1844；runtime §8 L3 脚注已注明 |
| OP-9 | `E_WRITABLE_SCOPE_POLICY` 为类上的码，未入码表 | 签署链（J.3/J.5）；裁定 | 闭集建立时 | `daemon/supervisor/scope-gate.ts` 行 15；runtime §2.3 已注明与 `E_SCOPE_POLICY` 不同 |
| OP-10 | `E_PREPARATION_FAILED` 孤儿码：表内有，`src/` 与 `daemon/` 无抛出点 | 码表维护（待指定） | 下次 error-codes 修订，二选一：删除，或补抛出点 | `src/lib/error-codes.ts` 行 33、194；仅测试手工构造 |
| OP-11 | ~~`E_COMMAND_TIMEOUT` 值分歧~~ | — | **已销项**（见「五」第 10 项） | 原依据见「五」第 10 项 |
| OP-12 | S.5 已知 7 处局限 | J.16 实施 | J.16 实施时 | dev-tasks S.5 行注（PR #9） |
| ~~OP-13~~ | ~~第一印象窗口长度~~ | — | **已销项（2026-11-01）**：裁决「不阻塞」——不设等待时长、可跳过；跳过直接验收决定；异议走 `user_dispute`。见「一之二」OP-13 | supervisor §13.3；playtest-self-check §5.1；`scheme.md` dec-11 |
| OP-14 | `attributions` 回填方 | J.16 | J.16 实施前 | playtest-self-check §5 与 §7.10 |
| OP-15 | 「21/47」按 51 码重算 | J.10 | J.10 实施前 | M-6 |
| OP-16 | M-9 代码注释是否进文档 PR | Tina | 本 PR 审核时 | M-9 为可选项 |
| OP-17 | PR #9 合入 | Tina | 审核后 | PR #9 open，clean |
| OP-18 | 审计未覆盖范围：架构 §1–§4、§9；state-machine-contract 其余章节；constants-and-paths | 下一轮审计 | 下一轮 | 本轮只核 §0.2.3.1、§5.2.2、§6.4、§6.5、§7.1 与 state-machine §4 |
| ~~OP-19~~ | ~~按钮文案统一~~ | — | **已销项**：以 supervisor §16.7 与 §18 行为规范层文案为准，架构 §6.4 D-3 已同步为「这是 Bug，免费修 / 我想要新功能，下一轮做」（Tina 裁决，2026-10-28） | C-4 裁决落笔时发现 |
| ~~OP-20~~ | 上一轮审计漏网：架构「低置信度降级」条目仍写用户点选「按缺陷修复 / 按新需求演进」，未随 OP-19 同步 | — | **已销项**（本 PR）：该条改为系统向用户提业务澄清问题，口径指向 supervisor §16.7；架构底部改判说明与 supervisor §16.7 的取代说明、禁止项保留 | 逐处核对 OP-19 相关 grep 命中时发现 |
| ~~OP-21~~ | supervisor §16.7 内部口径冲突：低置信度时既写「系统问一个业务问题、不把技术分类推给用户」，又写「底部仍显示两按钮，上方加一行『我不确定是谁的问题，你定』」 | — | **已销项**（本 PR）：裁决为「以 supervisor §16.7 澄清问题口径为准，质询台规格段已同步，按钮保留为用户主动裁决入口」；底部按钮段改为低置信度先问业务澄清问题、按钮标注「我不确定是谁的问题」 | 本 PR 修架构时发现；后续提交已同步 supervisor 质询台规格段 |
| OP-22 | J.8「施工·返工」行歧义：§16.2 第 1404 行用「→」把过程压成一行（`REWORK_REQUIRED → IMPLEMENTING`、`VERIFYING → EXECUTING`），返工回到 IMPLEMENTING 后快照上与首次施工同构，无法区分 | Tina 裁决；J.8 后续 | 裁决：代码按现状保留（返工仅在 REWORK_REQUIRED 瞬态可见，之后归「进行中」）；建议补充可观测标记（如快照字段 `rework_in_progress`），否则返工子态只能覆盖 REWORK_REQUIRED 瞬态 | PR #4（J.8）审核，`src/lib/state/journey-stage.ts` 的 `build_rework` 行注释；supervisor §16.2 第 1404 行 |
| OP-23 | J.9 TM-G / TM-Z 的 oracle 为单人编写，未满足规格 §6.1 的独立编写要求 | 第三方复核人（待指定；非实现者、非 J.9 实施上下文） | 已销项-TM-G/TM-Z 独立复核完成，证据见 PR #5 评论 | `scheme-patch-engine.md` §6.1、§8 第 5 条；PR #5（草稿）；缺口 3 项与 TM-Y/TM-P 抽查并入 PR #5 转正评审清单 |
| OP-24 | J.8 瞬态行整组生产不可达：`JOURNEY_ROWS` 中依赖 `transient` 的行（交接 `plan_handoff`、Demo 构建、合并中）在生产路径永不命中，因为 `daemon/server.ts` 调用 `toStateChangedPayload` 时从未传入 `activity_transient`；J.8 实际只覆盖 lifecycle×presentation 的静态子集，§16.2 文档声称映射交接，口径与实现分叉 | 待指定（候选：J.5 签署链或 J.2 ScopePlan，负责产生瞬态事件） | 补 `activity_transient` 生产来源前，文档须把交接、Demo 构建、合并中的映射标为「待接线」；回放路径（`replayPresentationState`）不传 `on_journey_warning` 为有意取舍，表外告警防线在实时广播路径 | 核对 PR #3 时全量检索 main：`activity_transient` 仅出现于 delivery-state、journey-stage、projector 与测试；PR #4 评审时未发现 |
| OP-25 | N-11 DAG 装载期缺少授权子集校验 | 待指定 | 已实现（PR #24） | J.5 前置依赖 |
| OP-26 | N-5 C.8～C.16 任务卡均未声明三项不变 | 待指定 | 已实现（PR #23） | ADR-0001 纪律执行 |
| OP-27 | N-1 任务图核销退出码由前端常量代填 | 待指定 | 已立卡待排期 | J.5 manual_confirmation 硬前置 |
| OP-28 | N-2 右栏 ClaudeCodeAdapter 可写主干 | 待指定 | 已实现（PR #29 右栏 partner 只读化 + PR #30 LS 残留清理）；真 Key 行为验证与 Glob 目录模式真机补验挂账中 | J.1 右栏只读化；右栏自由脑暴裁决同批回写；实机证据（J.1）为前置关键路径；失败分支=停用非静默回退 |
| OP-29 | J.1 上下文注入判别位未生效致 CLI 判别位误判的判例（事件：曾以"机器人身份致 CLI 不注入"解释，复核确认为判别位未注入；产出：verify-env --check-context） | — | 已裁决-入标准 | docs/specs/evidence-and-acceptance-criteria.md §3.2 |
| OP-30 | J.1 "无 tool_use 不算通过"裁决先例（事件：声称在真实 Claude CLI 执行的验证，无 tool_use 记录不予通过） | — | 已裁决-入标准 | docs/specs/evidence-and-acceptance-criteria.md §3.2 |
| OP-31 | J.1 沙箱 root 全绿不具真机外推效力的判例（事件：沙箱 root 权限可绕过权限类测试，须真实用户环境验证；关联 PR #3 分支真机 Glob 条款） | — | 已裁决-入标准 | docs/specs/evidence-and-acceptance-criteria.md §3.2 |
| OP-32 | 验证证据升级为实测/可信证据（exit_code 实采 + API 级确认防伪造） | 待指定 | 已裁决-A 已实现(PR #19)/B 缓议 | 关联 OP-27；设计先决：执行环境/超时/白名单边界；SYNTAX_CHECK/IMPLICIT_SIDE_EFFECT 实采通道待补 |
| OP-33 | Windows 单测既有红（main 基线 45 项/20 文件；每次都失败的稳定层 26 项：spawn/信号、符号链接、合并、迁移、worktree 等；WS/auth/Origin/端口类为抖动层） | 待指定 | 已登记-挂账 | 关联 PR #19 合并；基线 run 40821117113；PR 重跑 run 40838762021 |
| OP-34 | macOS CI runner 不稳定（多次出现 job 排队后零步骤取消，PR #28/#29/#30 均发生，判定为 GitHub 平台侧问题非测试失败；main 同 job 在 95c6698/4144a201 为绿） | 待指定 | 已登记-挂账 | 与 OP-33 Windows 债并列独立；关联 PR #28/#29/#30 判定声明 |
| OP-35 | 跨平台测试偶发抖动（① ipc-stream.test.ts 期望 ERROR 帧先收到 BASELINE_PROGRESS 帧的 WS 竞态，Ubuntu 与 macOS 均有发生，重跑即转绿；② scheme-confirm-scope-drift.test.ts 的 git index.lock 并发竞态，全量跑 2 条失败、单文件复跑 4/4 通过） | 待指定 | 已登记-挂账 | 与 OP-33/OP-34 分开登记；见 PR #28/#29/#30 CI 记录与 e7f57b4 本地实机基线验证 |
| OP-36 | L.17b 证据绑定粒度：`resolveCurrentLiveReleaseId` 在合同 `contract_ids` 无匹配时回退「最近一条 LIVE」，多合同仓里合同 A 的认可可能绑到合同 B 的发布（方向保守：版本变更照样 STALE，逼重新认可而非误放行） | 待指定 | 已登记-挂账（P-112） | #72/`d26def6`；`daemon/release/active-live.ts`；语义是「最新 LIVE 即当前版本」而非「本合同的 LIVE」 |
| OP-37 | L.17b 合同文件名两套口径：`readContractReferences` 用原始 `contractId + ".json"`（不做别名归一），`playtestEvidencePath` 对 `contract_id` 做字符归一；含特殊字符的 id 会读不到合同文件但写得了证据（实际 id 受控生成，风险低） | 待指定 | 已登记-挂账（P-112） | #72/`d26def6`；`playtest-guard.ts` / `daemon/playtest/evidence.ts` |
| OP-38 | L.17b 证据无历史链：`playtest-{contract_id}.json` 覆盖写，重新认可后旧证据丢失，审计只有「当前认可」无「认可历史」（dec-12 未要求历史） | 待指定 | 已登记-挂账（P-112） | #72/`d26def6`；`daemon/playtest/evidence.ts`；与 W.8 两条（`STAGENT_SESSION_TOKEN` 回退、`/api/shutdown` 手写 mock）、L.17a `request.headers` 一条同批归拢，详见 `development-tasks-completed.md` §3.4f |

## 四、三层皮权威表

| 层 | 管什么 | 文件 | 冲突时 |
| :--- | :--- | :--- | :--- |
| **规格 SSOT** | 产品与契约 | 架构 `system-architecture.md`（宪法；§0.2 与 §7.1 等已有改判横幅）；`supervisor.md` 第三部分（v2.1，现行生效）；`runtime-contract-and-safety.md`（硬契约）；`development-tasks.md`（任务卡与施工 DAG） | 上位规格优先；第三部分 §17 决策与第一部分 §7 同级 |
| **实施口径（附属）** | 某条 SSOT 的实施细节 | `scheme-patch-engine.md`（§14.2/§14.3/§14.11）；`intent-compiler-prompt.md`（§14.4–§14.9，引擎码表以引擎为准）；`worker-graveyard-gate.md`（§14.11 INV-LEDGER-03）；`playtest-self-check.md`（§16.7） | 以所指上位规格为准 |
| **代码即权威** | 运行时事实 | `src/lib/state/delivery-state.ts`；`src/lib/journey/confirm-scheme-atomic.ts`；`daemon/supervisor/demo/signing-gate.ts`；`daemon/guard/audit-manifest.ts`；`daemon/supervisor/rules-l0.ts`；`src/lib/error-codes.ts`（码表目录） | 代码现状不等于目标规格，差距登记在 supervisor §19 |
| **历史指针（非依据）** | 已并入 runtime 的 HISTORICAL 指针 | `constants-and-paths.md`、`state-machine-contract.md`（DOC-7 升格后仅指针）；`rfc/`、`templates/` | 路径/状态机以 `runtime-contract-and-safety.md` §10 / §11 与代码为准 |

## 五、已验证销项清单（本轮）

| 项 | 结论 | 证据 |
| :--- | :--- | :--- |
| 1. 架构 §0.2.3.1、§5.2.2、§6.4、§6.5、§7.1 的外部引用逐条核对 | 编号与所指内容一致：§0.2.3.1 第 3 条（越界熔断）、§5.2.2（Checkpoint）、§6.5.2（0.7 门槛）、§6.5.3（子集检查）、§6.5.4、§7.1（被 D8 取代）。有三处语义问题，见 C-3、C-4、C-5 | supervisor 行 873、1457、1507、1518、1548、1559；架构行 141、703、807、813、815、822、855 |
| 2. state-machine-contract §4 的 `ReasonCode` | 代表码引用，非全量枚举，**不触发 F-6**。未被引用的 4 码（`UNSAFE_EXECUTION`、`EVIDENCE_STALE`、`PREPARATION_INTERRUPTED`、`WORKSPACE_LOCKED`）不构成缺口 | state-machine 行 100–103 |
| 3. `ERROR_CODES` 孤儿码反向检查 | 17 码（头注释「14 个」为旧值，M-9）。除 `E_PREPARATION_FAILED`（OP-10）外，16 码在 `daemon/` 均有抛出或返回点。`E_COMMAND_TIMEOUT` 值分歧见 OP-11。检查范围为 `src/` 与 `daemon/`（抛出点在 `daemon/`，只查 `src/` 会误报） | 非注释、非测试命中计数，见 OP-10、OP-11 |
| 4. 门禁码补登归属清点 | `E_GATE_SCAN_FAILED`（仅规格）、`E_TEST_FILE_WRITE_BLOCKED`（有代码、未登记）、`E_PROPOSAL_PREVIOUSLY_REJECTED`（仅规格）、`surface_log`（数据字段，代码 0 命中）。已归入 OP-3、OP-5 至 OP-7 | 见 OP-3 至 OP-9 |
| 5. 「≥2 模块」残留 | 除 M-7、M-8 外，supervisor 行 1627（L-07 落差登记，记录当前代码事实）无需改；§7 D5 段（行 822）已指向 §14.10 | — |
| 6. 51 码计数 | intent-compiler-prompt 行 11 与 §2.2 已为 51；47 残留两处（M-5、M-6） | — |
| 7. `attributions` 的三处引用 | playtest、intent-compiler-prompt、supervisor 对 `trigger` 的描述一致，除 M-3（类型）与 M-4（措辞）外无需改 | TM-PK-11、TM-PK-12、SR-5 已按闭集写 |
| 8. §18 撞号与统计 | 修复前 `V-10` 重复、统计 35（应为 39），已修为 M-1、M-2；修复后 V-01～V-14 无重复 | — |
| 9. J.9 卡的 V-10～V-13 指针 | 核对正确，无需改（M-10） | — |
| 10. OP-11 `E_COMMAND_TIMEOUT` / `E_COMMAND_REJECTED` 常量值对齐 | 销项。`daemon/runner/command-runner.ts` 两常量值改为 `E_` 前缀，与 gateway 实际产出一致。**纠正原记录**：`E_COMMAND_REJECTED` 并非无引用，它是 `CommandSecurityError` 的默认码（gateway 对该类统一映射为 `E_UNAUTHORIZED_COMMAND`，对外输出不变；内部 `.code` 与错误消息前缀随之变化）。`E_COMMAND_TIMEOUT` 确无引用。 | 仓库全文检索（克隆后 grep）；`tests/` 无字面量 `COMMAND_REJECTED` / `COMMAND_TIMEOUT` |
| 11. C-3 | 销项（裁决已落笔） | 见「一之二」 |
| 12. C-4 | 销项（口径已落笔；文案统一见 OP-19，已销项） | 见「一之二」 |
| 13. C-5 | 销项（计数口径已写死） | 见「一之二」 |
| 14. OP-1 | 销项（洗白裁决已落笔） | 见「一之二」OP-1；`scheme.md` dec-10 |
| 15. OP-13 | 销项（第一印象不阻塞） | 见「一之二」OP-13；supervisor §13.3 |
| 16. oq-2 | 销项（对话试玩+证据桩裁决已落笔） | 见「一之二」oq-2；`scheme.md` dec-12；L.17 oq-2 阻断解除 |
| 17. oq-3 | 销项（凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登已落笔） | 见「一之二」oq-3；`scheme.md` dec-13；L.17a 前置解除 |


### DLV-6（2026-11-01 · L.11 合入挂账，非 OP）

- **项**：DN-2「可以」HTTP / 画布意外卡入口缺口。
- **事实**：`PipelineOrchestrator.resolveDesignDependencyAllow` + `applyDesignDependencyAllow` 已合入；集成测直接调用；生产路径无 HTTP action / 卡片路由可达。
- **处理**：挂 [`README.md`](./README.md) **DLV-6**（NON_BLOCKER）。**2026-11-01 已立卡 `TASK-J.19`**（参照 J.7 UX；不抢 L.12）；本波 docs 回写时未补端点。
- **依据**：Tina 合前确认「若本是后续卡职责则挂账即可」；PR #43 正文审查确认。

**未覆盖**：本轮未逐字核对的范围见 OP-18；`src/` 与 `daemon/` 的检查基于 `e610016` 快照的文本检索，未运行测试。
