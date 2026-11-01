# docs/ledger · 台账（还没解决的事）

> **建立**：2026-10-27 以 `docs/backlog/` 建立（裁决 D-8）；2026-10-29 文档治理改名 `ledger/`，并把原 `specs/consistency-audit.md` 并入。
> **对应 Supervisor 产物**：证据台账里「没定的、没修的、被挂起的」那一部分——方案的 `conflicts` / `open_questions` 落盘后，若一轮内解决不了，就进这里。
> **分界**：`ledger/` 不是权威。它只回答「还欠什么、谁来定、做完的判据是什么」。与 `specs/`、`adr/` 冲突时，以后者为准。

---

## 清单

| 文件 | 内容 | 状态 |
| :--- | :--- | :--- |
| [`consistency-audit.md`](./consistency-audit.md) | 规格一致性审计台账：`C-` 待裁决矛盾、`M-` 机械修复、`OP-` 挂账项（OP-1～OP-35）、权威分层表 | 持续追加；**OP-1 / OP-13 已于 2026-11-01 销项**（见 consistency-audit「一之二」） |
| [`w3-known-gaps.md`](./w3-known-gaps.md) | W.3 环境 / 秘密 / 网络守卫的已知缺口 | 7 项中 2 项未修（`tmpRoot` GC、`splitShellSegments` 引号边界） |

## 文档治理挂账（2026-10-29 新增）

2026-10-29 通读 `docs/` 时挂账。**第 0 波**已 RESOLVED：DOC-3 / DOC-4 / DOC-11（#40）。**第 1 波（SSOT / 代码对齐，2026-11-01）**已 RESOLVED：DOC-2 / DOC-5 / DOC-6 / DOC-7 / DOC-8 / DOC-9 / DOC-10（见各行；[#41](https://github.com/he18718143986-design/IDE/pull/41)）。**第 2 波（DOC-1 拆卡，2026-11-01）**已 RESOLVED：DOC-1（见下行；#42）。

| 编号 | 问题 | 位置 | 建议 | 阻断级别 |
| :--- | :--- | :--- | :--- | :--- |
| DOC-1 | `development-tasks.md` 约 460KB：约 65% 是已完成卡历史，版本头 84 条状态回写与 §6 修订流水重复，卡内样板句重复上百次 | `specs/development-tasks.md` | 拆成卡号索引 + 活跃卡 + 已完成卡 + 修订流水，卡号不变（[`../scheme.md`](../scheme.md) dec-4） → **已做**：拆为枢纽 + index/active/completed/changelog；卡号不变 | **RESOLVED**（docs 冗余治理第 2 波 · #42） |
| DOC-2 | 任务卡状态矛盾：C.14f、C.15a、C.15c、C.15d 矩阵写 COMPLETED、卡内写 NEW_TASK；J.1 代码已合入（PR #29 / #30）但卡仍为 NEW_TASK | 同上 | 由卡 owner 按 supervisor §10 判定口径回写 → **已做**：四卡回写 COMPLETED（证据 `5f6ca93`）；J.1 此前已对齐；全库矩阵↔卡内抽查仅余该四处 | **RESOLVED**（docs 冗余治理第 1 波 · #41） |
| DOC-3 | 任务卡文件内三处「当前基线」互相矛盾（`6415fbd` / `4280de6` / `f14c8cb`） | 同上 L28、L121、§4 | 只保留一处，其余改指针 → **已做**：权威 tip 见 Sprint「当前工程物理起点」/`e4351b0`，另两处改历史指针 | **RESOLVED**（docs 冗余治理第 0 波 · #40） |
| DOC-4 | 约 24 处引用已删除的 `docs/archive/*`，约 98 处引用已删除的「走查报告 §6.x」 | 同上 | 统一改为「见 Git 历史」或删除 → **已做**（docs 内活引用改指针；历史叙述保留路径字面作溯源） | **RESOLVED**（docs 冗余治理第 0 波 · #40） |
| DOC-5 | 路径三方不一致：Worktree 目录（`task-{id}` vs `{id}`）、Demo 目录（`.stagent/demo/` vs `.stagent/prototypes/`）、Git Trailer 键名与长度上限 | `system-architecture.md` §5、`constants-and-paths.md` §2/§3、`runtime-contract-and-safety.md` §5.3、代码 | 以代码为准回写规格，或立卡改代码 → **已做**：constants §0 代码事实表 + runtime §2/§5.3 注记；**`worktree-seal` 无 `task-` 前缀与创建路径不一致 → 需立卡改代码（本波未改代码）** | **RESOLVED**（docs 冗余治理第 1 波 · #41；代码对齐另立卡） |
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
| Worktree seal 路径前缀 | `daemon/guard/worktree-seal.ts` 使用 `.stagent/worktrees/{id}/`，与 `worktree-manager` 的 `task-{id}` 不一致；docs 已注明（runtime §10）。**已立卡 `TASK-A.7`**（NEW_TASK · NON_BLOCKER · 不抢 L.13） |
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
| DLV-3 | `AdapterRegistry` 未接线，Worker 只有 OpenAI `AiWorker`；Claude Code 作 Worker（W.5a 的 worker 角色）未接入派工 | NON_BLOCKER（M2 不依赖） | 卡 owner | **已立卡 `TASK-W.6`**（不抢 L.13） |
| DLV-4 | `.stagent/metadata/` 仍在代码写入路径列表中，与 ADR-0011 废止该路径冲突 | NON_BLOCKER | 卡 owner | **已立卡 `TASK-H.9`**（不抢 L.13） |
| DLV-5 | 系统地图 UI（项目视图第二页）与「改这里会影响什么」入口 | NON_BLOCKER | — | **已立卡 `TASK-L.18`**（前置 L.12 COMPLETED；不抢 L.13）；规格 [`../specs/technical-design-and-knowledge.md`](../specs/technical-design-and-knowledge.md) §5 |
| DLV-6 | L.11 DN-2「可以」：`resolveDesignDependencyAllow` 已合入且集成测覆盖，**无** HTTP / 画布意外卡入口（`POST .../resume` 不路由至此）。**不**阻断 L.11 领域验收 | NON_BLOCKER | 卡 owner | **已立卡 `TASK-J.19`**（可参照 J.7 UX；不抢 L.13）；代码 `orchestrator.ts::resolveDesignDependencyAllow` |


> **OP-1 实施（2026-11-01）**：裁决仍销项（consistency-audit / scheme dec-10）；白名单存储/scope/失效落地归 **`TASK-J.20`**（**不**回写已 COMPLETED 的 `TASK-J.9`）。Sprint 首要现为 **L.13**（L.12 已 COMPLETED / #47 / `39f426a`）。

## DoR 全量审计挂账（2026-10-31 新增）

来源：[`../reports/dor-readiness-audit-2026-10-31.md`](../reports/dor-readiness-audit-2026-10-31.md)（L4 证据；本表只登记结构/状态问题，不改卡条款）。

> **L.10 / #39 → #40（Tina 微调）**：本第 0 波 PR [#40](https://github.com/he18718143986-design/IDE/pull/40) 以 `docs/l10-completed`（[#39](https://github.com/he18718143986-design/IDE/pull/39) tip `38dd621`）为底叠治理改动；矩阵与 tip 已对齐 `TASK-L.10` `[COMPLETED]` / `e4351b0`。**#40 supersedes #39**（合入 #40 后关闭 #39）。

| 编号 | 问题 | 阻断级别 | 决策人 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| DOR-1 | ~~`TASK-J.18c` / `J.18d`：矩阵与卡内仍 `NEW_TASK`，但代码已合入 `a2fa7df`（#27）~~ → **已关闭（2026-10-31）**：随 [#28](https://github.com/he18718143986-design/IDE/pull/28)/`e7ac058` 回写为 `[COMPLETED]`；main tip 含 J.18c/d 文档闭环 | NON_BLOCKER（文档真相） | 卡 owner | **RESOLVED**：#28 合入；本行保留作审计溯源 |
| DOR-2 | §1.1 矩阵有 `TASK-0.1`、`TASK-A.1`～`A.6`，但 `development-tasks.md` §3.4 无对应 `#### 【Task …】` 详细正文 → 无法按 R-1～R-12 举证 | NON_BLOCKER · **`[NEEDS_RECHECK]`**（2026-11-01 第 0 波：历史技术债，**不阻断**现行 J/L 链路施工；本波不重写历史卡正文） | 卡 owner / 文档治理 | 补历史正文指针，或矩阵改注「正文见 Git 历史 / 已归档」 |
| DOR-3 | `TASK-W.5b` / `W.5c` 正文远低于现行 DoR（缺范围路径与签名、独立 PASS 清单、估算、代码事实锚点等），却仍挂在矩阵 `NEW_TASK` | NON_BLOCKER（未排入 M2～M4 关键路径）· **`[NEEDS_RECHECK]`**（2026-11-01 第 0 波：历史技术债，**不阻断**现行 J/L 链路施工；本波不重写历史卡正文） | 卡 owner | 按 `task-card-standard.md` 重写后再进入可开工队列 |
