# docs/ledger · 台账（还没解决的事）

> **建立**：2026-10-27 以 `docs/backlog/` 建立（裁决 D-8）；2026-10-29 文档治理改名 `ledger/`，并把原 `specs/consistency-audit.md` 并入。
> **对应 Supervisor 产物**：证据台账里「没定的、没修的、被挂起的」那一部分——方案的 `conflicts` / `open_questions` 落盘后，若一轮内解决不了，就进这里。
> **分界**：`ledger/` 不是权威。它只回答「还欠什么、谁来定、做完的判据是什么」。与 `specs/`、`adr/` 冲突时，以后者为准。

---

## 清单

| 文件 | 内容 | 状态 |
| :--- | :--- | :--- |
| [`consistency-audit.md`](./consistency-audit.md) | 规格一致性审计台账：`C-` 待裁决矛盾、`M-` 机械修复、`OP-` 挂账项（OP-1～OP-38）、权威分层表 | 持续追加；**OP-1 / OP-13 / oq-2 / oq-3 已于 2026-11-01 销项**（见 consistency-audit「一之二」）；**2026-11-02 P-112 新增 OP-36～OP-38**（L.17b 三条边界，见 completed §3.4f）；**P-113 W.6 两条边界沿用 P-112 先例仅归拢至 completed §3.4g、不另立 OP 号**；**2026-11-02 P-121 W.5c-ii 挂账同理归拢至 completed §3.4j（含「派工未走 `runInSandbox`」这条 W.5c-iii 必收边界）**；**P-122 W.5c-iii 已 COMPLETED（#87/`2313597a`）——挂账 4 条归拢至 completed §3.4k、不另立 OP 号；`REJ-010` 已进 `scheme.md` §10 墓地**；**2026-11-03 P-138 OP-33～38 挂账清扫销项（#118/96225df）**：OP-33 部分销项/改定性平台侧不可修，OP-34 改定性平台侧持续观察不销项，OP-35①/35②/36/37/38 销项，新增两条边界挂账（归一化多对一碰撞未区分、.history.jsonl 无界增长）；**2026-11-03 P-140 v0.2 范围 RFC 起草**（[`../rfc/v0.2-scope.md`](../rfc/v0.2-scope.md)，讨论稿）：B.1 / B.2 / C.4 / S.3 / D.1e 状态维持 DEFERRED，不新增 OP 号、无新挂账 |
| [`w3-known-gaps.md`](./w3-known-gaps.md) | W.3 环境 / 秘密 / 网络守卫的已知缺口 | 7 项中 2 项未修（`tmpRoot` GC、`splitShellSegments` 引号边界） |

## 文档治理挂账（2026-10-29 新增）

2026-10-29 通读 `docs/` 时挂账。**第 0 波**已 RESOLVED：DOC-3 / DOC-4 / DOC-11（#40）。**第 1 波（SSOT / 代码对齐，2026-11-01）**已 RESOLVED：DOC-2 / DOC-5 / DOC-6 / DOC-7 / DOC-8 / DOC-9 / DOC-10（见各行；[#41](https://github.com/he18718143986-design/IDE/pull/41)）。**第 2 波（DOC-1 拆卡，2026-11-01）**已 RESOLVED：DOC-1（见下行；#42）。

| 编号 | 问题 | 位置 | 建议 | 阻断级别 |
| :--- | :--- | :--- | :--- | :--- |
| DOC-1 | `development-tasks.md` 约 460KB：约 65% 是已完成卡历史，版本头 84 条状态回写与 §6 修订流水重复，卡内样板句重复上百次 | `specs/development-tasks.md` | 拆成卡号索引 + 活跃卡 + 已完成卡 + 修订流水，卡号不变（[`../scheme.md`](../scheme.md) dec-4） → **已做**：拆为枢纽 + index/active/completed/changelog；卡号不变 | **RESOLVED**（docs 冗余治理第 2 波 · #42） |
| DOC-2 | 任务卡状态矛盾：C.14f、C.15a、C.15c、C.15d 矩阵写 COMPLETED、卡内写 NEW_TASK；J.1 代码已合入（PR #29 / #30）但卡仍为 NEW_TASK | 同上 | 由卡 owner 按 supervisor §10 判定口径回写 → **已做**：四卡回写 COMPLETED（证据 `5f6ca93`）；J.1 此前已对齐；全库矩阵↔卡内抽查仅余该四处 | **RESOLVED**（docs 冗余治理第 1 波 · #41） |
| DOC-3 | 任务卡文件内三处「当前基线」互相矛盾（`6415fbd` / `4280de6` / `f14c8cb`） | 同上 L28、L121、§4 | 只保留一处，其余改指针 → **已做**：权威 tip 见 Sprint「当前工程物理起点」/`e4351b0`，另两处改历史指针 | **RESOLVED**（docs 冗余治理第 0 波 · #40） |
| DOC-4 | 约 24 处引用已删除的 `docs/archive/*`，约 98 处引用已删除的「走查报告 §6.x」 | 同上 | 统一改为「见 Git 历史」或删除 → **已做**（docs 内活引用改指针；历史叙述保留路径字面作溯源） | **RESOLVED**（docs 冗余治理第 0 波 · #40） |
| DOC-5 | 路径三方不一致：Worktree 目录（`task-{id}` vs `{id}`）、Demo 目录（`.stagent/demo/` vs `.stagent/prototypes/`）、Git Trailer 键名与长度上限 | `system-architecture.md` §5、`constants-and-paths.md` §2/§3、`runtime-contract-and-safety.md` §5.3、代码 | 以代码为准回写规格，或立卡改代码 → **已做**：constants §0 代码事实表 + runtime §2/§5.3 注记；**`worktree-seal` 无 `task-` 前缀**曾挂代码债 → **代码侧已收口** `TASK-A.7` COMPLETED（[#49](https://github.com/he18718143986-design/IDE/pull/49)/`4b7a709`） | **RESOLVED**（docs 第 1 波 · #41；**代码侧** · #49 / A.7） |
| DOC-6 | `delivery-state.ts` 仍有 `DELIVERED`，与 ADR-0012、`state-machine-contract.md` 冲突；两套状态机（生命周期 9 态 / 交付轨 A）关系未交代 | `state-machine-contract.md`、runtime §7、§9 | 在 state-machine-contract 补一节两轨关系 → **已做**：§0 两轨关系 + ADR-0012/H.2 指针；`DELIVERED` 仅交付投影内部标记 | **RESOLVED**（docs 冗余治理第 1 波 · #41） |
| DOC-7 | `state-machine-contract.md` 标「目标、待测试固化」，但 `src/lib/state-machine.ts` 已实现其迁移表；`constants-and-paths.md` 同为草案 | `specs/` 两份草案 | 核对后升格或合并入 runtime 契约 → 第 1 波仅加指针；**2026-11-01 用户拍板提前做**：内容并入 `runtime-contract-and-safety.md` §10 / §11（以代码为准回写）；原文件降为 `[HISTORICAL]` 指针 | **CLOSED**（升格完成 · 2026-11-01；遗留「另议」关闭） |
| DOC-8 | RFC v0.2 阶段 0「右栏可写主干」、§3.1「删除旁听」与现行 SSOT 冲突；附录 A/B/C 是 UI 候选清单，不是 RFC | `rfc/v0.2-multi-agent-pipeline.md` | 第 1 波仅横幅；**2026-11-01 用户拍板提前做**：§3.1 与附录 A/B/C 改写为与 DEFERRED 一致——保留设想并标注被 REJ-001 / supervisor §14.4 等否决或取代 | **CLOSED**（正文清理完成 · 2026-11-01；遗留「另议」关闭） |
| DOC-9 | RFC-003 内两份 `SchemeSnapshot` 定义并存；Ed25519「防篡改」措辞与 ADR-0006 冲突 | `rfc/scheme-snapshot-and-attestation-model.md` | 第 1 波仅横幅；**2026-11-01 用户拍板提前做**：合并为一份权威 `SchemeSnapshot` 提案定义；彻底去掉「防篡改/不可篡改」措辞，对齐 ADR-0006 本地优先不防篡改 | **CLOSED**（正文清理完成 · 2026-11-01；遗留「另议」关闭） |
| DOC-10 | 三份实施口径（引擎 / 墓地门禁 / 试玩自查）把 K-1～K-13、G-MATCH、墓地交叉逻辑各写一遍，已出现 K-9 漂移 | `specs/scheme-patch-engine.md` 等 | 只在 supervisor §14.11 保留一份，其余改指针 → **已做**：三份删重复公式/K 表，改 SSOT 指针；K-9/K-13/K-15 以 supervisor 为准；supervisor §14.11 标明唯一权威 | **RESOLVED**（docs 冗余治理第 1 波 · #41） |
| DOC-11 | `supervisor.md` 内部旧节号（§9.5 写「§3.1–§3.5」、L694「§5.4」）与计数（§18 写 35 条、实为 39 条）；intent-compiler few-shot 例 6 用 `remove_item` 处理否决，与 §4.5 冲突 | `specs/supervisor.md`、`specs/intent-compiler-prompt.md` | 机械修复 → **已做**：§9.1–§9.5、§11.3、changelog 对齐 39 条；例 6 改 `reject_item` | **RESOLVED**（docs 冗余治理第 0 波 · #40） |

---

## 第 1 波遗留

| 项 | 说明 |
| :--- | :--- |
| Worktree seal 路径前缀 | **RESOLVED（代码 · 2026-11-01）**：`TASK-A.7` COMPLETED — seal `worktreeDir` 与 manager 统一 `task-{id}`（[#49](https://github.com/he18718143986-design/IDE/pull/49)/`4b7a709`）；旧无前缀不迁移、读时判未封存。DOC-5 **代码侧**随本项收口。 |
| 草案升格（DOC-7） | **CLOSED（2026-11-01）**：已并入 runtime §10 / §11；原文件 `[HISTORICAL]` 指针 |
| RFC 正文（DOC-8/9） | **CLOSED（2026-11-01）**：冲突正文已改写为 DEFERRED/PROPOSED 一致表述；ADR-0006 对齐 |
| DOC-1 | **RESOLVED**（第 2 波 · #42） |

## 纪律

1. 每一项都必须能回答「**谁来做、做完的判据是什么**」。没有判据的不得放进来。
2. 一项被修完后不删除——标记已修复并注明 commit / PR，或随任务卡归档进 Git 历史。
3. 立卡施工时，把卡号回填到对应条目。

## 架构决议落盘记录（2026-10-30 用户拍板）

依据用户在 2026-10-30 的终审裁决（`q12`～`q16`），关闭以下冲突并立项：

| 裁决编号 | 涉及冲突 | 裁决核心 | 落地归宿 |
| :--- | :--- | :--- | :--- |
| **DEC-001** | `conf-1` | 中栏 Supervisor 意图编译组件化，形态开放（不锁死 Claude Code，允许轻量实现） | 立项并合入 [`../adr/0014-three-agent-topology-open-supervisor.md`](../adr/0014-three-agent-topology-open-supervisor.md)；关闭 conf-1 |
| **DEC-002** | `conf-5` | 审阅内容（路径树/命令明细）后置验收幕；保留“确认开工”与“合入”两次点击授权；物理写门禁与保护清单不动 | 回写 `scheme.md` §7；更新运行时签署规范；关闭 conf-5 |
| **DEC-003** | `conf-6` | 允许 Worker 受控只读外网通道，但必须强绑定凭据保险库（Vault）一并实施，账密严禁进入对话上下文 | 登记为 Vault 前置依赖；关闭 conf-6；闭环 goal-2 / oq-3 |
| **DEC-004** | `conf-2, 4` | 右栏剥离写死的架构师人设与 `partner_hint` / `buildProtectionPromptNotice` 前缀，恢复纯粹自由对话 | 关闭 conf-2、conf-4；更新 Claude/Baseline Adapter |
| **DEC-005** | `conf-3, 7` | 中栏仅经画布交互；右栏维持精确只读白名单防穿透 | 关闭 conf-3、conf-7 |
| **DEC-006** | `goal-8 / dec-5` | ADR-0015 大需求四级分解（项目 → 里程碑 → 合同 → 任务节点），合同为最小可验收交付单元 | 立项并合入 [`../adr/0015-contract-as-unit-of-delivery.md`](../adr/0015-contract-as-unit-of-delivery.md)；用户 q22 拍板 |
| **DEC-007** | `goal-9 / dec-6` | ADR-0016 目标项目系统知识库随代码入库，每份合同强制同步维护，静态防漂移 | 立项并合入 [`../adr/0016-system-knowledge-base-in-repo.md`](../adr/0016-system-knowledge-base-in-repo.md)；用户 q22 拍板 |
| **DEC-008** | `goal-7 / dec-7` | ADR-0017 发布（Release）为独立生命周期，合同终态仍为 MERGED，支持探活失败自动回滚 | 立项并合入 [`../adr/0017-release-lifecycle-after-merge.md`](../adr/0017-release-lifecycle-after-merge.md)；用户 q22 拍板 |
| **DEC-009** | `dec-8, 9 / SA-1` | 敏感改动仅在用户原话点名时进入审批并在开工时一并授权；凭据保险库选定系统钥匙串（OS Keychain） | 写入 [`../specs/delivery-lifecycle.md`](../specs/delivery-lifecycle.md) §5 与 [`../specs/release-and-operations.md`](../specs/release-and-operations.md) §4；用户 q22 拍板 |

## 交付全链路挂账（2026-10-30 新增）

| 编号 | 问题 | 阻断级别 | 决策人 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| OQ-REL-1 | 凭据保险库存储后端已选定系统钥匙串（OS Keychain，dec-9） | **RESOLVED** | 用户（q22） | [`../specs/release-and-operations.md`](../specs/release-and-operations.md) §4 |
| SA-1 | ADR-0014 敏感项授权已选定开工一并授权机制（dec-8） | **RESOLVED** | 用户（q22） | [`../specs/delivery-lifecycle.md`](../specs/delivery-lifecycle.md) §5 |
| DLV-1 | ADR-0015～0017 均已由用户原话 q22 明确授权生效（DEC-006～008） | **RESOLVED** | 用户（q22） | [`../scheme.md`](../scheme.md) §6 |
| DLV-2 | PR #3 已由用户批准并执行物理关闭 | **RESOLVED** | 用户 | PR #3 已关闭 |
| DLV-3 | ~~`AdapterRegistry` 未接线，Worker 只有 OpenAI `AiWorker`；Claude Code 作 Worker 未接入派工~~ | **RESOLVED**（原 NON_BLOCKER · M2 不依赖） | 卡 owner | **`TASK-W.6` COMPLETED**（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`）：Registry 挂派工工厂、双内置 id 受控派工、缺注册/非受控显式错误码不静默降级；Claude Code worker 仅登记 `UNCONTROLLED_EXTERNAL`（红线，不作受控执行器）；能力载体 `run()` 显式抛错。见 completed §3.4g。**自助注册/自动验证 `TASK-W.7`** 后续派工闭环由 `TASK-W.9` 承接；母卡现为 `[SPLIT]`，P-128 经授权拆为 W.9a/b/c；DLV-3 保持 RESOLVED，不回开原债。 |
| DLV-4 | `.stagent/metadata/` 写入与 ADR-0011 冲突 → **已迁 records** | **RESOLVED** | 卡 owner | **`TASK-H.9` COMPLETED**（[#50](https://github.com/he18718143986-design/IDE/pull/50)/`34213c8`）；legacy 只读迁移 |
| DLV-5 | 系统地图 UI（项目视图第二页）与「改这里会影响什么」入口 | **RESOLVED** | 卡 owner | **`TASK-L.18` COMPLETED**（[#54](https://github.com/he18718143986-design/IDE/pull/54)/`c8e6a81`）；interfaces consumers 行依赖见 completed 挂账 |
| DLV-6 | L.11 DN-2「可以」HTTP / 画布入口 | **RESOLVED** | 卡 owner | **`TASK-J.19` COMPLETED**（[#55](https://github.com/he18718143986-design/IDE/pull/55)/`4bae423`）；`/api/design/*` + 画布卡；resume 不误路由 |
| OQ-2 | 北极星「一模一样」判定标准已由用户拍板（dec-12）：对话试玩 + 结构化证据桩（绑定版本/原话/时间戳）；AI 引导不代判 | **RESOLVED** | 用户（q25） | [`../scheme.md`](../scheme.md) dec-12；L.17 验收标准补齐 |
| OQ-3 | 登录信息保管口径已由用户拍板（dec-13）：凭据存 Vault 至手动删；cookie 过期 Daemon 静默重登（Worker 全程无感、零账密） | **RESOLVED** | 用户（q26） | [`../scheme.md`](../scheme.md) dec-13；`TASK-L.17a` 条款 |


> **OP-1 实施（2026-11-01）**：裁决仍销项（consistency-audit / scheme dec-10）。**`TASK-J.20` COMPLETED**（[#57](https://github.com/he18718143986-design/IDE/pull/57)/`4d2f8e1`）。**`TASK-L.16` COMPLETED**（[#62](https://github.com/he18718143986-design/IDE/pull/62)/`e4dfe1c`）。
> **oq-2 裁决（2026-11-01）**：北极星「一模一样」判据裁决已落笔（`scheme.md` dec-12 / `consistency-audit.md`「一之二」）。**`TASK-L.17` 产品阻塞已解除**，补写 PASS/FAIL 证据桩；按 DoR R-11 仍待拆分 L 估算开工；主序实现卡阶段性完备。物理 tip `e4dfe1c`。
> **oq-3 裁决（2026-11-01）**：凭据保管与代登重登口径已落笔（`scheme.md` dec-13 / `consistency-audit.md`「一之二」）。`TASK-L.17a`（受控摄取与代登代理）已合入完成 **`[COMPLETED]`**（[#70](https://github.com/he18718143986-design/IDE/pull/70)/`8516c3d`）；`TASK-L.17b` 解除阻断就绪为 **`[READY]`**。当前物理 tip `8516c3d`。
> **L.17b 交付（2026-11-02 · P-112 · M5 主序收官）**：`TASK-L.17b`（对比视图与试玩证据桩）已合入完成 **`[COMPLETED]`**（[#72](https://github.com/he18718143986-design/IDE/pull/72)/`d26def6`，squash merge）。**M5 北极星主序 L.16 → L.17a → L.17b 全部落完**，当前物理 tip `d26def6`。残余边界 6 条同批归拢（L.17b 三条 OP-36～38 + W.8 两条 + L.17a `request.headers` 一条，见 consistency-audit「三」与 completed §3.4f）。**不宣称端到端 UI 闭环**（CompareView 未挂路由、原话采集 UI 未实现、`check playtest` 未接 verification profile）。
> **W.6 交付（2026-11-02 · P-113 · 主序收官后首张债卡销项）**：`TASK-W.6`（AdapterRegistry 接线与 Claude Worker 派工，ledger **DLV-3**）已合入完成 **`[COMPLETED]`**（[#74](https://github.com/he18718143986-design/IDE/pull/74)/`b5d8c53`，squash merge），**DLV-3 台账债销项**。当前物理 tip `b5d8c53`。落实「Registry 挂派工工厂」：内置 Managed AI 受控派工 + 双 id 别名化解默认值不一致；Claude Code worker 仅登记 `UNCONTROLLED_EXTERNAL`、不挂工厂（红线：不当受控证据）；缺注册/非受控/无工厂显式错误码、不静默降级；能力载体 `run()` 合前审阅修复为显式 `throw`。残余边界 2 条（能力载体 `run()` 语义已修记为设计决策、`GET /api/adapters` 未做端到端 HTTP 验证）**仅归拢**至 `development-tasks-completed.md` §3.4g，**沿用 P-112 先例不另立 OP 号**（OP 范围仍 OP-1～OP-38）。**不宣称端到端闭环**；Sprint 下一张 `W.5c`（容器沙箱），`ruling 3`（`check playtest` 接验收档）docs 待落盘。
> **裁决落盘（2026-11-02 · P-114 · ruling 3 + W.5b/c 去留）**：上条（P-113 注记）末句「`ruling 3` docs 待落盘」「W.5b/c 去留待定」为当日状态，**本条为现行口径**（按「保留原文作溯源」惯例不改上条原文）。**ruling 3 已裁决**：北极星合同（带 `references[]`）的 `verification_spec.commands` 自动附加 `{alias:"playtest", executable:"stagent", args:["check","playtest","<contract_id>"]}`，试玩认可成为合并门禁；非北极星合同不附加；实现属小卡（合同装配段 + 测试），另行立卡或挂账（本轮未立卡、未开工）。**W.5b/c 去留已裁决**：`TASK-W.5b` / `TASK-W.5c` 保留队列、不再列为待定项；Sprint 排程写死 **`W.5c`（容器沙箱，兼 W.7 探测地基）→ `W.7`（自助注册/自动验证）→ `W.5b`（cursor-agent 实测，作 W.7 回归基准）**。本裁决**不新增 OP 号**（OP 范围仍 OP-1～OP-38；沿用 P-112 / P-113 先例仅归拢，不虚构登记）。物理 tip `61eb003`（#75 P-113 docs 回写）。
> **W.5c DoR 正文重写 + tip 同步（2026-11-02 · P-115）**：P-114 已合入 #76/`ec871c4`（squash），上条（P-114 注记）物理 tip `61eb003` 为当日状态，按「保留原文作溯源」惯例不改上条原文。Tina 授权由本侧接手 W.5c 开工前 DoR 复核后续：`TASK-W.5c` 卡正文按 `task-card-standard.md` R-1～R-12 补齐（原仅 R-3 达标，本表 **DOR-3**），含双枚举 `SANDBOX_ENFORCED` 漏改即 FAIL、代码事实锚点、PASS 七条断言、不变声明、凭证仅 API Key。**估算判 L**：按 R-11「L 卡不得开工、必须拆分」，建议拆 `W.5c-i/ii/iii`，**拆卡须 Tina 另行授权**——本轮仅重写正文、不拆、不开工、不改状态 `[NEW_TASK]`、不改 Sprint 排程 `W.5c → W.7 → W.5b` 与 §1.1 矩阵；`TASK-W.5b` 的 DOR-3 债保留挂账（本轮不动 W.5b）。写实纠偏：`system-architecture.md` §9.1 标题标 `[待实现 - 目标数据模型]`（原卡误当既成事实）；W.5b 卡所引「架构 §0.6.6」节号不存在，留待 W.5b 重写时校正。现行 tip `ec871c4`（#76）。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称 W.5c 已可开工或已实现。
> **P-115 合入 tip 同步 + 措辞归位 + `W.5c-iii` 环境前置（2026-11-02 · P-116）**：上条（P-115 注记）物理 tip `ec871c4` 为当日状态，按「保留原文作溯源」惯例不改上条原文。P-115（`774ce31`）经 Tina 审阅「可合」后以 **#77/`1c00db7`**（squash）合入 main。现行 tip 推进至 `1c00db7`（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。按审阅意见把嵌进 W.7 状态括注的 W.5c/W.5b 债说明移出、独立成句（两处：Sprint 首要块、`development-tasks-active.md` W.7 卡状态行；语义 / 排程 `W.5c → W.7 → W.5b` / §1.1 矩阵未动）。**新增开工前置事实登记**：本轮只读核查确认本机已装 Docker CLI 29.6.1（darwin/arm64）但 daemon 不可达（`~/.docker/run/docker.sock`、`/var/run/docker.sock` 均不存在，无 dockerd/containerd/colima/lima 进程），`podman`/`nerdctl`/`colima`/`lima` 未安装、`STAGENT_REAL_OPENHANDS` 未设置 → **`OS-06` 真实容器实测当前无可用运行时，`W.5c-iii` 开工前须先备妥容器环境**，否则实测空转。**拆卡（`W.5c-i/ii/iii`）授权仍待 Tina 拍板**，本轮不拆、不开工、不动 W.5c 卡正文。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称 W.5c 已可开工或已实现。物理 tip `1c00db7`。
> **P-116 合入 tip 同步（2026-11-02 · P-117）**：上条（P-116 注记）物理 tip `1c00db7` 为当日状态，按「保留原文作溯源」惯例不改上条原文。P-116（`85d3316`）经 Tina 告知已合入 **#78/`b5d0ef5`**（squash，走 SSH 通道 `git fetch origin` + `git ls-remote` 双重确认远端 tip、与分支 tree 一致）。现行 tip 推进至 `b5d0ef5`（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。P-116 落定的措辞归位与 `W.5c-iii` 环境前置登记为现行内容、本轮未改。**拆卡（`W.5c-i/ii/iii`）授权仍待 Tina 拍板**（本轮未拆、未开工）；`W.5b` 的 DOR-3 债仍在。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称 W.5c 已可开工或已实现。物理 tip `b5d0ef5`。
> **W.5c 拆分授权落卡 + TASK-C.23 立卡（2026-11-02 · P-118）**：上条（P-117 注记）物理 tip `b5d0ef5` 为当日状态，按「保留原文作溯源」惯例不改上条原文。P-116 已合入 **#78/`b5d0ef5`**（squash）；上轮推送的 tip 同步分支 `99d3387` 已由 **#79/`b0fa8a0`** 以 **P-117** 先行落 main 承接，故本条顺延为 **P-118**（`P-117` 流水被 tip 同步占用，非跳号）。现行 tip 推进至 `b0fa8a0`（#79 P-117；其下 #78 `b5d0ef5` 为 P-116；`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。**W.5c 拆分经 Tina 授权（2026-11-02）**：母卡 `[SPLIT]` 保留追溯，拆为 `W.5c-i`（`[READY]`，S/M，Sprint 首要）/ `W.5c-ii`（`[READY（跟随 i）]`，M）/ `W.5c-iii`（**`[BLOCKED · 等容器环境]`**，M，硬前置本机容器运行时可用 + `STAGENT_REAL_OPENHANDS=1`）；三张子卡均按 DoR R-1～R-12 写全，DAG 增 `i→iii`、`ii→iii` 两条边。本表 **DOR-3** 中 `TASK-W.5c` 的正文重写债随 P-115 重写 + P-118 拆分落卡**销项**；`TASK-W.5b` 的 DOR-3 债**仍在**（本轮不动 W.5b）。同 PR 立 `TASK-C.23`（`[READY]`，S）兑现 ruling 3 裁决，纠正 P-114「未立卡」状态。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**开工 W.5c-i/ii/iii 或 C.23 的实现（属下一步纯代码 PR）、**不**宣称 W.5c 已可整体开工或端到端闭环。物理 tip `b0fa8a0`。
> **W.5c-i 与 C.23 双卡合入回写（2026-11-02 · P-119）**：上条（P-118 注记）物理 tip `b0fa8a0` 为当日状态，按「保留原文作溯源」惯例不改上条原文。`TASK-W.5c-i` 与 `TASK-C.23` 同日以两个并行纯代码 PR 合入，均由 Tina 审阅「可合」。**`TASK-W.5c-i` → `[COMPLETED]`**（#81/`c3e75cc`，squash）：双枚举同扩 `SANDBOX_ENFORCED` + `workerSpecSchema` 两可选目标字段；**窗口期语义写死**——注册接受、`requireControlledDispatch()` 显式抛新增错误码 `E_ADAPTER_SANDBOX_LOCKED`（即便已挂派工工厂也拒绝），消息注明「待 `W.5c-ii` `container-host` 落地解锁」；SE-01 以读源码正则断言锁死「漏改单边即 FAIL」。扩枚举触发 5 处下游 TS2322，以 `toRuntimeControlMode()` 收窄处理（Evidence / 拦截器快照按 `UNCONTROLLED_EXTERNAL` 记档），**`evidence.schema.ts` 二值枚举有意不扩**（冻结证据模型不在本卡范围），登记为挂账待 `W.5c-ii` 评估。**`TASK-C.23` → `[COMPLETED]`**（#82/`a5223fb`，squash；A 合入后 rebase `6f819dd`）：单一 helper `withPlaytestCommand()` 接双装配点，ruling 3 **兑现**。两卡全量 `vitest run` 均 2555 passed、失败项与 baseline 一致（零新增）；`tsc` 57 = clean 基线。**本表 DOR-3** 中 `TASK-W.5b` 的债**仍在**（本轮不动 W.5b）。现行 tip 推进至 `a5223fb`（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**宣称 `SANDBOX_ENFORCED` 已有容器隔离运行时、**不**宣称 `check playtest` 端到端门禁闭环。物理 tip `a5223fb`。

> **P-119 合入 tip 同步（2026-11-02 · P-120）**：上条（P-119 注记）物理 tip `a5223fb` 为当日状态，按「保留原文作溯源」惯例不改上条原文。`docs/p119-w5ci-c23-complete`（`cdcf929`）以 **#83/`64b737f`**（squash）合入 main（走 `git fetch origin` + `git ls-remote origin` 双重确认；`fetch --all` 中 HTTPS remote 报 502、不影响 `origin`），与分支 tree 一致（`git diff` 为空）。现行 tip 推进至 `64b737f`（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。P-119 落定的双卡 COMPLETED、挂账 7 条与 Sprint 转 `W.5c-ii` 为现行内容、本轮未改。**本表 DOR-3** 中 `TASK-W.5b` 的债**仍在**。**不新增 OP 号**（OP 范围仍 OP-1～OP-38）；不改产品代码；**不**开工 `W.5c-ii` 实现。物理 tip `64b737f`。

> **W.5c-ii 交付（2026-11-02 · P-121 · 容器隔离第二张子卡销项）**：`TASK-W.5c-ii`（容器运行时 `runInSandbox` + 派工门禁按宿主可用性解锁）已合入完成 **`[COMPLETED]`**（[#85](https://github.com/he18718143986-design/IDE/pull/85)/`648be31`，squash merge）。上条（P-120 注记）物理 tip `64b737f` 为当日状态，按「保留原文作溯源」惯例不改上条原文。现行 tip 推进至 `648be31`（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针）。**W.5c-i 窗口期语义至此解除**：`SANDBOX_ENFORCED` 派工改按 `ContainerHostPort` 可用性判定（未注入 / 不可用 → `E_ADAPTER_SANDBOX_LOCKED`，可用 → 放行），`toRuntimeControlMode()` 收窄移除、`evidence.schema.ts::worker_control_mode` 扩三值并如实记档（经 Tina 裁决「本卡同步扩三值」，原收窄会让受控派工成功产出不可合并证据）。**证据面裁决注记（记实不记名）**：`worker_control_mode` 记实际执行面而非合同声明档，容器路径未实际执行记 `UNCONTROLLED_EXTERNAL`（沿用 `W.4` 降级记实惯例）；因 `runInSandbox` 生产零调用、暂无「是否真进容器」信号，该裁决执行面接线前不可强制执行，随 `W.5c-iii` 落地。**关键残余边界（W.5c-iii 必收）**：`ContainerHostPort` 只是「给工厂用」的注入端口，**执行面无法外部强制 `SANDBOX_ENFORCED` 派工必须走 `runInSandbox`**——绕过容器本地执行仍可能，`W.5c-iii` 的 FAIL 已补「派工未走 `runInSandbox` → FAIL」，`W.7` 探测包可作验证项。其余挂账 4 条（`durationMs ??` 死代码、取消前置 `via:"SIGKILL"` 语义偏移、`evidence.schema.ts` 跨版本可读性、施工指令误传两个不存在的错误码）**沿用 P-112 / P-113 先例仅归拢**至 `development-tasks-completed.md` §3.4j，**不另立 OP 号**（OP 范围仍 OP-1～OP-38）。**本表 DOR-3** 中 `TASK-W.5b` 的债**仍在**。Sprint 首要推进 **`W.5c-iii`**（仍 `[BLOCKED · 等容器环境]`，解除须 Tina 另行确认）。**不**宣称容器隔离执行已落地或端到端闭环。

> **W.5c-iii 交付（2026-11-02 · P-122 · 容器隔离链路收官）**：`TASK-W.5c-iii`（OpenHands 适配器 + 真实容器实测 + `verified_on`）已合入完成 **`[COMPLETED]`**（[#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a`，squash merge；分支 `feat/w5ciii-openhands-real`，本地三提交 `d23b185` 主体 + `00c0494` 证据面消费见证 + docs 开工声明）。上条（P-121 注记）物理 tip `648be31` 与「Sprint 首要 `W.5c-iii`（仍 `[BLOCKED · 等容器环境]`）」为当日状态，按「保留原文作溯源」惯例不改上条原文；**现行 tip 推进至 `2313597a`**（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针），**Sprint 首要推进至 `TASK-W.7`**，排程 `W.7 → W.5b`。**① 环境前置已解除**：P-116 记载的「仅 Docker 客户端、无守护进程」为 2026-11-01 状态；2026-11-02 施工前环境验证全绿（Docker Desktop 29.6.1 daemon 可达 + 镜像按摘要固定拉取 + `STAGENT_REAL_OPENHANDS=1` 实测 11/11），`[BLOCKED] → 施工 → COMPLETED` 全段走完。**② 交付五项**：围栏档校验（ruling A，`SANDBOX_ENFORCED` 只校验 `known_limitations` 非空 + 平台矩阵非空，隔离靠运行时；**`REJ-010`「能力声明不得按宿主侧修辞口径造假」落盘 `scheme.md` §10 墓地**）/ `DockerContainerHost`（探 daemon + `docker run` 唯一挂载 `/work` + cap 裁剪 + `DENY` 网络；**双路径拒绝** `E_ADAPTER_SANDBOX_LOCKED` 派工前 / `HOST_UNAVAILABLE` 执行时，都不降级本地）/ OpenHands 适配器注册（摘要固定镜像、11 条 `known_limitations`、`verified_on` = OpenHands 0.59.0 · 2026-11-02、注册表 3→4）/ 派工即入沙箱（`host` 必填、`run()` 唯一路径 `runSandbox()`、工厂缺宿主再兜一次）/ **`SandboxWitness` + `resolveEvidenceControlMode` 证据面消费**（声明 `SANDBOX_ENFORCED` + 无见证 → 记 `UNCONTROLLED_EXTERNAL`）——**P-121 登记的证据面裁决至此可强制执行**。**③ 挂账 4 条**（`openhandsControlMode` 降级分支是防呆非废码 / `durationMs ??` 死代码 / `EXPLICIT_TARGETS` 逐目标出站需 netns / iptables 级实现 / **`runWorker` outcome 的 `worker_control_mode` 仍为声明档未校正——两个记录点只有证据面被校正**）**沿用 P-112 / P-113 / P-121 先例仅归拢**至 `development-tasks-completed.md` §3.4k，**不另立 OP 号**（OP 范围仍 OP-1～OP-38）。**本表 DOR-3** 中 `TASK-W.5b` 的债**仍在**。**④ 与 `W.7` 的接口**：`W.7` 探测包新增验证项「`SANDBOX_ENFORCED` 派工是否带 `SandboxWitness`」，判定**复用** `resolveEvidenceControlMode`、不另造判据。**不**宣称端到端闭环（模型驱动链路因出站 `DENY` 未实测、`EXPLICIT_TARGETS` 未兑现）、**不**宣称「绝对受控」（见证为结构性约束、实测限定「通过已知探测集」、平台仅 `darwin-arm64`）。

> **W.7 交付（2026-11-02 · P-123 · Worker 自助注册与探测升格销项）**：`TASK-W.7`（Worker 自助注册与自动验证）已合入完成 **`[COMPLETED]`**（[#89](https://github.com/he18718143986-design/IDE/pull/89)/`be480bb`，squash merge；分支 `feat/w7-worker-self-serve-verify`，本地单提交 `63ee74a`；链序核实 parent `5dccebdd`（#88 P-122））。上条（P-122 注记）物理 tip `2313597a` 与「Sprint 首要 `W.7`」为当日状态，按「保留原文作溯源」惯例不改上条原文；**现行 tip 推进至 `be480bb`**（`development-tasks.md` Sprint 物理起点 / `scheme.md` 现行指针），**Sprint 首要推进至 `TASK-W.5b`**，并带前置注记：**`W.5b` 的 DOR-3 债未偿，卡正文须先按 `task-card-standard.md` R-1～R-12 重写达 DoR 才能施工**（与 `W.5c` 当年同款处理），不得直接开工。**① 两级注册语义（红线「填表不等于受控」）**：注册恒落 `UNCONTROLLED_EXTERNAL`；请求体出现 `control_mode` / `verified_on` / `probe_report` 等九类字段**直接拒绝**（不是忽略）；`AdapterRegistry.promoteControlMode()` 成为**唯一档位变更入口**——此前注册中心既无升格也无注销，「升格」这个动作在 W.7 之前根本不存在；单向守卫：降级恒允许、升格必须附 `report_fingerprint` 并**重跑** `validateAdapterCapability`（注册期只按标识档校验，结论不得复用）。**② 探测包五类断言**：文件围栏 / 命令围栏 / 证据完整性 / 能力声明对账 / **派工见证**；P5 **严格复用** `resolveEvidenceControlMode`（不另造「有没有见证」的判据，测试交叉断言两者结论一致），GATEWAY 目标记 N/A 且非必需；**执行面不可用即拒绝探测**（`E_PROBE_SANDBOX_UNAVAILABLE`，不产报告、一次容器调用都不发生——卡正文 FAIL「探测无沙箱直接跑主树」的机制防线）；报告措辞闸门对注入执行面返回的 `detail` 一视同仁。**③ 指纹读侧重算降级**：`effectiveControlMode()` 每次读时重算版本 / 命令 / 声明指纹，不一致即降 `UNCONTROLLED_EXTERNAL`——刻意不在写入时判定，否则手改 `.stagent/workers.json` 即可绕过。**④ 六条挂账**仅归拢至 `development-tasks-completed.md` §3.4l（**PASS 3 未达成：「升格 ≠ 可派工」是结构性边界**——自注册 worker 无 `run()` / 派工工厂、`requireControlled` 只放行 `GATEWAY_ENFORCED`，故升格后 `dispatchable:false`，刻意不造假执行器 / **无真实容器实测**（桩宿主断言，非 `STAGENT_REAL_OPENHANDS=1` 级）/ 命令围栏只 3 项可观测、白名单外逐命令枚举未做 / 文件围栏改为等价断言而非卡原话 / 报告查询未单开 `.../verify`、定期重测无调度接口 / `W.5c-iii` 遗留未动），**沿用 P-112 / P-113 / P-121 / P-122 先例不另立 OP 号**（OP 范围仍 OP-1～OP-38）。**本表 DOR-3** 中 `TASK-W.5b` 的债**仍在**（且已升为 Sprint 首要的前置条件）。**不**宣称端到端闭环（升格后无执行器、探测无真实容器实测）、**不**宣称注册即受控或「绝对受控」。物理 tip `be480bb`。

> **W.5b 卡正文 DoR 重写（2026-11-02 · P-124 · DOR-3 重写债偿还）**：`TASK-W.5b` 原正文 5 行、R-1～R-12 仅 R-3 达标；本轮按样板重写 12 条，状态仍 `[NEW_TASK]`、不开工。**关键新写死两件事**：① 双重身份——外部适配器实测 ＋ `W.7` 探测包对「非容器外部适配器」的**负向回归基准**（被测对象是探测包，出 `pass` 即缺陷）；② 五类断言适用性——`capability_declaration` 适用且应判 `fail`、`dispatch_witness` N/A-by-design（`required:false`）、`filesystem_fence` / `command_fence` / `evidence_integrity` 不可执行（唯一执行面经 `runInSandbox()` 入容器，`runProbePack()` 遇不可用执行面即抛 `E_PROBE_SANDBOX_UNAVAILABLE`）。**可达档位按代码事实写死**：唯一合法 `UNCONTROLLED_EXTERNAL`（另两档对宿主进程型适配器不可达；围栏档校验能通过 ≠ 够格标沙箱，按 REJ-010 不得据此标档）。**修正原卡失效引用**：所引「架构 §0.6.6」节号不存在（§0.6 下仅 0.6.1 / 0.6.2 / 0.6.3）。**开工前置未满足**：本机 CLI 已在位（`2026.10.01-e373342`）但为订阅登录态、`CURSOR_API_KEY` 未设置，须先隔离环境方可实测。**本条仅 docs 回写**；不改产品代码；不新增 OP 号。

> **W.5b 交付（2026-11-02 · P-125 · cursor-agent 外部适配器销项 · 在队实现卡清零）**：`TASK-W.5b` → **`[COMPLETED]`**（[#92](https://github.com/he18718143986-design/IDE/pull/92)/`bdac805`，squash；本地 `33cf6c2`，parent `b8d53c5`）。**完成口径（Tina 2026-11-02 裁决）**：代码侧闭环即标完成，**PASS 8 条中 `CA-06`（真实 CLI 四类越权负例）未执行**入挂账 1——本机无有效 `CURSOR_API_KEY`、卡内 FAIL 禁止用订阅登录态凑数，故 `CURSOR_AGENT_VERIFIED_ON` 恒空，该卡**不产出任何受控证据**；`CA-01`～`CA-05` / `CA-07` / `CA-08` 达成。**档位是结构性上界，不是「没测出来」**：`GATEWAY_ENFORCED` 要求 `tool_interception_supported === true`（本进程无拦截点）、`SANDBOX_ENFORCED` 要求派工经 `runInSandbox()` 并携 `SandboxWitness`（宿主进程不经该入口）→ 唯一合法档位 `UNCONTROLLED_EXTERNAL`，**实测不改变档位**。**探测包非容器负向回归**：`capability_declaration` 应判 `fail`、`dispatch_witness` N/A-by-design、其余三类不可执行（`E_PROBE_SANDBOX_UNAVAILABLE` 拒绝退回主树）；适用性表覆盖 `PROBE_IDS` 全量。**实测发现并修掉**：不带 `--` 时 prompt 里的 `--yolo` 会被当成真旗标 → argv 已插入 `--` 终止符。**残余边界**：`AdapterRegistry.promoteControlMode()` 只校验指纹形态（自造指纹可改档位，但派工仍被 `E_ADAPTER_SANDBOX_LOCKED` 拒）、项目级 `.cursor/mcp.json` 需人工批准故 MCP 只写专用 `HOME`。**在队清零**：矩阵已无 `[NEW_TASK]` 实现卡（余 3 张 `[SPLIT]`、5 张 `[DEFERRED → v0.2+]`），下一张卡待 Tina 指定。本条仅 docs 回写；不改产品代码；不新增 OP 号；不宣称 cursor-agent 受控或端到端闭环。

> **P-125 合入 tip 同步（2026-11-02 · P-126）**：`docs/p125-w5b-complete`（`cedd5a6`）经 Tina 告知已合入 **#93/`1a50cb15`**（squash）。**指针推进**：物理起点与 `scheme.md` 现行指针由 `bdac805` → `1a50cb15`；本文件 P-125 注记里的 `bdac805` 按「保留原文作溯源」惯例**不改写**。**账目未变**：DOR-3 重写债已于 P-124 偿还、`TASK-W.5b` 已于 P-125 标 `[COMPLETED]` 且 `CA-06` 留在挂账（`CURSOR_AGENT_VERIFIED_ON` 恒空、**不产出任何受控证据**）；矩阵内仍无 `[NEW_TASK]` 实现卡、下一张卡待 Tina 指定。**口径不变**：档位是结构性上界（`UNCONTROLLED_EXTERNAL` 唯一合法），不因 tip 推进改变。本条仅 docs 回写；不改产品代码；不新增 OP 号。

## DoR 全量审计挂账（2026-10-31 新增）

来源：[`../reports/dor-readiness-audit-2026-10-31.md`](../reports/dor-readiness-audit-2026-10-31.md)（L4 证据；本表只登记结构/状态问题，不改卡条款）。

> **L.10 / #39 → #40（Tina 微调）**：本第 0 波 PR [#40](https://github.com/he18718143986-design/IDE/pull/40) 以 `docs/l10-completed`（[#39](https://github.com/he18718143986-design/IDE/pull/39) tip `38dd621`）为底叠治理改动；矩阵与 tip 已对齐 `TASK-L.10` `[COMPLETED]` / `e4351b0`。**#40 supersedes #39**（合入 #40 后关闭 #39）。

| 编号 | 问题 | 阻断级别 | 决策人 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| DOR-1 | ~~`TASK-J.18c` / `J.18d`：矩阵与卡内仍 `NEW_TASK`，但代码已合入 `a2fa7df`（#27）~~ → **已关闭（2026-10-31）**：随 [#28](https://github.com/he18718143986-design/IDE/pull/28)/`e7ac058` 回写为 `[COMPLETED]`；main tip 含 J.18c/d 文档闭环 | NON_BLOCKER（文档真相） | 卡 owner | **RESOLVED**：#28 合入；本行保留作审计溯源 |
| DOR-2 | §1.1 矩阵有 `TASK-0.1`、`TASK-A.1`～`A.6`，但 `development-tasks.md` §3.4 无对应 `#### 【Task …】` 详细正文 → 无法按 R-1～R-12 举证 | NON_BLOCKER · **`[NEEDS_RECHECK]`**（2026-11-01 第 0 波：历史技术债，**不阻断**现行 J/L 链路施工；本波不重写历史卡正文） | 卡 owner / 文档治理 | 补历史正文指针，或矩阵改注「正文见 Git 历史 / 已归档」 |
| DOR-3 | `TASK-W.5b` / `W.5c` 正文远低于现行 DoR（缺范围路径与签名、独立 PASS 清单、估算、代码事实锚点等），却仍挂在矩阵 `NEW_TASK` | NON_BLOCKER（未排入 M2～M4 关键路径）· **`[NEEDS_RECHECK]`**（2026-11-01 第 0 波：历史技术债，**不阻断**现行 J/L 链路施工；本波不重写历史卡正文） | 卡 owner | 按 `task-card-standard.md` 重写后再进入可开工队列；**注**：`TASK-W.7` 落地后 W.5b/c 转为回归用例基准（不解除本行重写债）。**→ 2026-11-02 · P-124 复核：两卡正文均已按 R-1～R-12 重写、本行「重写债」已偿**（`W.5c` = P-115，母卡 `[SPLIT]` 属拆分追溯、非 DoR 债；`W.5b` = P-124，双重身份 + 五类断言适用性写死，状态仍 `[NEW_TASK]` 待授权开工）。 |


### TASK-W.9（2026-11-02 · P-127 · 新立卡注记，非 OP）

- **事项**：自注册/外部 Worker 缺少可执行 `run()` 与派工工厂；`promoteControlMode()` 的非空指纹形态校验未消费真实探测报告/见证，另有 `buildLaunch()` 对 MCP endpoint 的硬依赖。
- **处理**：新立 `TASK-W.9` `[NEW_TASK]`，覆盖 Gateway 会话注入与容器 CLI 执行器方案对比、工厂接线、报告/见证消费及缺端点降级。估算 **L**；按 R-11 建议拆为 `W.9a/b/c`，**拆分与开工均待 DoR 过审及 Tina 授权，本轮不执行**。
- **口径**：DLV-3 的 W.6 交付仍为 RESOLVED；W.9 是 W.7/W.5b 后续边界的独立新任务，不新增 OP 号、不改历史记录。

### TASK-W.9 拆分（2026-11-02 · P-128 · 非 OP）

- **授权**：Tina 拍板 W.9 升为 Sprint 首要，并授权按原规划拆为 W.9a/b/c。
- **处理**：母卡标 `[SPLIT]` 保留追溯；W.9a（S/M）与 W.9b（M）`[READY]`，W.9c（M）`[BLOCKED · 待 a+b]`。DAG 明确 `a→c`、`b→c`；Sprint 首要为 W.9a，W.9b 可并行。
- **边界**：READY 不等同施工授权；Tina 逐卡授权开工。不新增 OP 号，DLV-3 仍 RESOLVED。

### P-129（2026-11-02 · P-128 合入 tip 同步）

- **合入**：`docs/w9-split` 以 [#97](https://github.com/he18718143986-design/IDE/pull/97)/`332828f4` squash 合入 main（父 #96 `c999253`）。
- **指针**：当前物理 tip 更新为 `332828f4`；P-128 W.9 拆分状态照旧。既有 P-125～P-128 历史注记不改写。
- **范围**：仅 docs tip 同步；不新增 OP，不改产品代码或任务判定。


### TASK-W.9（P-130 · 2026-11-02 · 非 OP）

- **状态回写**：W.9a 已 COMPLETED（PR #99 / `22168ee`），W.9b 经 Tina 授权进入施工，W.9c 等待 W.9b。
- **后续挂账**（归档见 [`development-tasks-completed.md` §3.4n](../specs/development-tasks-completed.md#task-w.9a)，不新增 OP）：清理死码导出 `E_CURSOR_AGENT_MCP_ENDPOINT_MISSING`；W.9c 接执行面时重估 `bindProbeReportAuthority` 公开重绑边界。
- **审查说明**：PR #99 的 Claude spawn LEGACY 白名单新增四文件是既有 `child_process` import 补登记，非 W.9a 新增执行面。
- **开工边界**：W.9b 当前选容器路径，Gateway capability 不可用且不冒称 `GATEWAY_ENFORCED`；仅容器成功并产 witness 才可标 `SANDBOX_ENFORCED`。

### TASK-W.9（P-131 · 2026-11-03 · 非 OP）

- **状态回写**：W.9b 已 COMPLETED（PR #101 / `b98e463`）；W.9a、W.9b 的 DAG 前置均满足，Sprint 首要转 W.9c（READY，仍待 Tina 单卡授权）。
- **交付与边界**：容器 CLI 仅走 `runInSandbox()`，成功 witness 经证据面消费；`dispatchable` 共享门禁现支持宿主可用且工厂齐备的 `SANDBOX_ENFORCED`。Cursor 镜像/协议未实证，仍 `E_CURSOR_AGENT_NO_EXECUTOR`。完整记录见 [`development-tasks-completed.md` §3.4o](../specs/development-tasks-completed.md#task-w.9b)。
- **挂账（四项，不新增 OP）**：逐行 Docker host probe 放大；拒绝原因被 `isControlledDispatchable()` 吞并导致诊断收窄；四类 API key 可读于容器 env（日志脱敏不改变该事实）；Cursor 容器镜像与运行协议未实证。
- **语义变更注记**：dispatchable 从仅 GATEWAY 判定扩为 `GATEWAY_ENFORCED` 或（宿主可用且工厂齐备的）`SANDBOX_ENFORCED`；不可据此声称 Cursor 已跨越真容器执行边界。现行物理 tip `b98e463`。

### TASK-L.17c（P-132 · 2026-11-03 · 非 OP）

- **立卡**：Tina 授权纯文档立卡 `TASK-L.17c`「中栏方案审阅页嵌入试玩认可提交」`[NEW_TASK]`（S/M）。
- **范围要点**：同页挂载既有 `CompareView`；原话 +「认可完成」→ `submitPlaytestEvidence`；读侧反映 `playtest-guard`；不改三本体；不碰 W.9c 施工面。
- **挂账归口**：兑现 L.17b / C.23 已声明的端到端 UI 未接线（CompareView 未挂中栏、原话采集 UI）；**不新增 OP**；历史「未宣称」原文保留。
- **Sprint**：首要仍为 `TASK-W.9c`（READY · 待 Tina 单卡授权）；L.17c **不抢**首要，开工须另授。物理 tip `e3262c9`（#102）。

### TASK-L.17c（P-133 · 2026-11-03 · 非 OP）

- **状态回写**：L.17c 已 COMPLETED（PR [#104](https://github.com/he18718143986-design/IDE/pull/104) / `06661be`）；中栏方案审阅同页已挂既有 CompareView + 原话「认可完成」+ 薄读侧 `GET /api/playtest/status`。
- **挂账（三项，不新增 OP · 不宣称关闭）**：① CompareView `snapshots` 前端拉数（L.17a 抓取成果接线）；② 会话原话候选未灌 `index`（props `sessionVerbatimCandidates` 已留）；③ 真机整段 `check playtest` 执行债。完整记录见 [`development-tasks-completed.md` §3.4p](../specs/development-tasks-completed.md#task-l.17c)。
- **窄口径**：UI 已挂 / 代码合入；**不**宣称端到端 UI/产品闭环。Sprint 首要仍为 W.9c。现行物理 tip `06661be`。


> **W.9c 合入回写（P-134 · 2026-11-03 · 非 OP）**：`TASK-W.9c` 已 COMPLETED（[#107](https://github.com/he18718143986-design/IDE/pull/107)/`d3397a6`），W.9 母卡实质闭合，拆分追溯 `[SPLIT]` 保留。W.9b 四项挂账逐条归档至 completed §3.4q，**均仍未销项**：逐行 Docker host probe 成本；布尔判据导致诊断码信息收窄；四类 API key 在容器 env 内可读；Cursor 镜像/运行协议未实证且继续 fail-closed。沿用先例，不新增 OP。Sprint 首要「在队清零」；下一张卡待 Tina 指定。仅 docs 回写；基于最新 main `10bc1d3`（#108 tip 同步）；不宣称端到端闭环。

> **P-135 清扫成果入账与挂账（2026-11-03）**：基于 `main`@`2559f5c3`（#113 squash），将无任务卡基建修正留痕：typecheck 54→0（含 `CompilerCasWriteInput` nullable 契约与 graveyard lock 收窄堵 `soft` 逃逸）；Unit tests 7 项既有红销项（Supervisor 闭包拆叶子、spawn 白名单 4 例外、test-port-map 27 条迁至 4210–4778、断言同步）；`E_SCOPE_PLAN_DRIFT` 假漂移由两端点等待 `ensureBaselineScan()` 修复；macOS 续租 flake 改为事件等待；#109 CI 启用及三 job、#111 Prettier 1366 条、#112 lint 29 条、#113 清扫均记为无卡基建修正。挂账：`CompilerCasWriteInput` 类型放宽后手工植入路径审计语义未定义；Windows CRLF 归一、`path.sep`、临时目录 `EBUSY` 重试（建议 TASK-CI.1 `[DEFERRED]` 或挂账待立卡）；completed §3.4q 重复锚点已清理。Sprint 首要仍「在队清零」；不新增 OP、不改产品代码；历史条目保留原文。

> **P-136（2026-11-03 · P-135 合入 tip 同步）**：`docs/p135-gate-green` 以 [#114](https://github.com/he18718143986-design/IDE/pull/114)/`de50d38` squash 合入 main（父 #113 `2559f5c3`）。当前物理 tip 更新为 `de50d38`；P-135 清扫成果与挂账状态照旧。既有 P-135 历史注记不改写。仅 docs tip 同步；不新增 OP，不改产品代码或任务判定。
> **P-137（2026-11-03 · P-136 合入 tip 同步与门禁留痕）**：`docs/p136-tip-sync` 以 [#115](https://github.com/he18718143986-design/IDE/pull/115)/`08e1a60` squash 合入 main（父 #114 `de50d38`）。当前物理 tip 更新为 `08e1a60`。**门禁状态变更留痕**：GitHub Branch Ruleset `main`（ID 26435584）已激活生效，开启 required status checks（ubuntu/macos，排除 Windows）与防 force push / 删分支 / 非线性历史；「全绿才准合」正式由惯例升格为物理强制门禁。清扫成果、挂账与在队清零状态照旧；既有历史注记保留原文作溯源。仅 docs 回写；不新增 OP，不改产品代码或任务判定。

> **P-138（2026-11-03 · OP-33～38 挂账清扫销项与新增边界挂账）**：基于最新 `main`（[#118](https://github.com/he18718143986-design/IDE/pull/118)/`96225dfdafbba04b813da63c8e524cd22bbcc087`，squash）完成台账回写。对 consistency-audit.md 六条账逐条处理：OP-33 部分销项（CRLF / path.sep / safeRmSync 退避重试在 #118/96225df 已修，symlink 权限类系统限制保留挂账改定性「平台侧不可修」）；OP-34 改定性「平台侧、代码不可修、持续观察」不销项；OP-35① 销项（定向帧等待全仓替换）；OP-35② 销项（#113 已修不重复改）；OP-36 销项（回退已删、无匹配返回 null、调用方收敛保守拒绝）；OP-37 销项（normalizeContractId 读写共用 + 读侧原始名兜底）；OP-38 销项（.history.jsonl 单行追加 + readPlaytestEvidenceHistory）。新增两条边界挂账（多对一映射碰撞未区分、.history.jsonl 无界增长边界）；不新增 OP 号（OP 范围仍 OP-1～OP-38）；不宣称 OP 挂账区清零（OP-1～32 及其他卡内挂账仍在）。Sprint 物理起点推进至 `96225df`（首要仍「在队清零」）。仅 docs 回写，不改产品代码。

> **P-141 v0.2 RFC 拍板（2026-11-03）**：B.1/B.2/C.4 激活待 DoR 重写；S.3/D.1e 维持 DEFERRED（D-5/D-6）。激活不等于开工，三卡须按 R-1～R-12 重写并经 Tina 单卡授权；B.1 重写前先对账 main 存量实现。


> **P-142 · TASK-B.1 DoR 重写（2026-11-03）**：B.1 卡正文按 R-1～R-12 重写并对齐 main 存量；状态仍 `[READY · 待 DoR 重写]`，施工授权待 Tina 单卡拍。存量分为已存在 / 需新建 / 需重构；性能门禁含 GC 后 `heapUsed` 差值三次中位 ≤40 MiB 与 Tarjan 高深度环 ≤100ms；`.json` 入图为叶子节点。**本注仅同步审计留痕，不新增 OP 号**。

> **P-143 · TASK-B.1 合入回写（2026-11-04）**：基于最新 `main`@`9c177e92992566522929efecd9c1435244a17491`（[#124](https://github.com/he18718143986-design/IDE/pull/124) 代码 squash，parent `ad19bcd3`）。TASK-B.1 标 `[COMPLETED]` 并从 active 迁出至 completed §3.4r；交付 parser/graph/server 增强、新建 perf 与 boundaries 测试、契约兼容超集（toJSON 旧形状、topologicalSort 签名与方向修正、has/getNode 兼容、bootstrap-draft 零破坏）及实测性能四项（228.81ms / 0.080ms / 1.00MiB / 17.11ms，实测值非目标值）。登记四条挂账（① global.gc 暴露、② isUnderScanRoot 收敛、③ IGNORED_DIRS 过滤、④ addModule 覆盖式语义已核销）。物理指针链推进两格：`2cbd91c` → `ad19bcd3`（#123 DoR）→ `9c177e9`（#124 代码）。Sprint 首要转为 `TASK-B.2`（待 DoR 重写）。本注仅同步审计留痕，不新增 OP 号（范围仍 OP-1～OP-38）。

> **P-144 · TASK-B.2 DoR 正文重写（2026-11-04 · 非 OP）**：基于最新 `main`@`5b0a8cd08f1bca54930d6bf43db0ea78f0d55e23`（[#125](https://github.com/he18718143986-design/IDE/pull/125) P-143 squash）重写 `development-tasks-active.md` B.2 卡正文，按 `task-card-standard.md` R-1～R-12 与存量对账矩阵补齐；状态保持 `[READY · 待 DoR 重写]`，施工授权待 Tina 单卡拍。三类存量资产清点：已存在（fs-watcher/invalidation-engine/server.ts 基础方法）、需重构（server.ts 单实例退化点消除、merger.ts 合并前快照指纹复核兜底）、需新建（多 worktree 并发监听、跨任务串扰负例、指纹复核兜底测试）。指纹优化方向写死变更路径增量比对，全量指纹仅在 register 与合并前复核两处使用且两处算法口径一致。四项性能门禁可测断言入卡（外部修改→STALE ≤50ms 体验/≤100ms 门禁、≥5 worktree 增量 ≤30MB、合并前复核 ≤50ms、句柄/定时器 100% 释放）；FAIL 红线五条 + watcher 全挂时合并前兜底仍拒。物理起点对齐 `5b0a8cd0`，首要任务仍为 B.2（待 Tina 单卡授权开工）。本注仅同步审计留痕，不新增 OP 号（范围仍 OP-1～OP-38），不改产品代码。

> **P-145 · TASK-B.2 合入回写（2026-11-04 · 非 OP）**：基于最新 `main`@`b1aa44f320a33f0c61197f63550e8c0f173a3a82`（[#128](https://github.com/he18718143986-design/IDE/pull/128) 代码 squash）。`TASK-B.2` 标 `[COMPLETED]` 并迁入 completed §3.4s。**B.1 挂账② 销项**（`updateRepoGraphFile` 前置 `isUnderScanRoot` 守卫，含移出 `src/` 的 purge）。B.2 新增四项挂账：① `record.fingerprint` 死字段（daemon 内无读取方，保留意图注明或删除待裁决）；② 非 Git 目录由「抛错」改为「降级哈希」（口径变化）；③ `shouldIgnore` 语义变化，`..` 前缀目录纳入指纹范围；④ `readyState` 超时后迟到 ready 不翻回（`isReady` 永久 false，注释级）。门禁①标题与断言口径统一为「体验目标 ≤50ms、门禁上限 ≤100ms」，实测中位 67.9ms 记为已知边界。Sprint 首要转为 `TASK-C.4`（待 DoR 重写）。本注仅同步审计留痕，不新增 OP 号（范围仍 OP-1～OP-38），不改产品代码。
> **P-147 · TASK-C.4 DoR 正文重写（2026-11-04 · 非 OP）**：基于最新 `main`@`78ae73b2924e4854b4c4c5b7e6dce157ccdd1896`（[#129](https://github.com/he18718143986-design/IDE/pull/129) P-145 回写 squash；其下 #128 `b1aa44f` 为 B.2 代码 squash）重写 `development-tasks-active.md` C.4 卡正文，按 `task-card-standard.md` R-1～R-12 与已批存量对账矩阵补齐；状态保持 `[READY · 待 DoR 重写]`，施工授权待 Tina 单卡拍。存量资产清点明确三类：已存在（`src/components/radar/` 三组件基础实现、`/api/arch/graph` 契约超集、`SupervisorTab` 非零调用方挂载纠偏确认、`bumpContractRevision` 辅助函数、WS 订阅基建）；需重构（`RadarGraph` 消除全量重建退化点改为 `cy.batch()` 元素级 patch、`ScopeSelector` 升级为圈选抽屉）；需新建（WS 新鲜度着色接线推荐帧扩展 `worktree_path`、Scope 变更强制派生 Revision 重置审批生产路径、前端性能与审批失效专项测试）。四项性能门禁（1000 节点局部 patch ≤16ms、增量内存 ≤30MB、>1000 节点明确降级、卸载时资源 100% 释放）；FAIL 红线写死任何状态变化触发 `cy.destroy()` 重建与旧 Revision 审批放行。物理起点对齐 `78ae73b`，首要任务仍为 C.4（待 Tina 单卡授权开工）。本注仅同步审计留痕，不新增 OP 号（范围仍 OP-1～OP-38），不改产品代码。
