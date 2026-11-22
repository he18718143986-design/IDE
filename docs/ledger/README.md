# docs/ledger · 台账（还没解决的事）

> **建立**：2026-10-27 以 `docs/backlog/` 建立（裁决 D-8）；2026-10-29 文档治理改名 `ledger/`，并把原 `specs/consistency-audit.md` 并入。
> **对应 Supervisor 产物**：证据台账里「没定的、没修的、被挂起的」那一部分——方案的 `conflicts` / `open_questions` 落盘后，若一轮内解决不了，就进这里。
> **分界**：`ledger/` 不是权威。它只回答「还欠什么、谁来定、做完的判据是什么」。与 `specs/`、`adr/` 冲突时，以后者为准。

---

## 清单

| 文件 | 内容 | 状态 |
| :--- | :--- | :--- |
| [`consistency-audit.md`](./consistency-audit.md) | 规格一致性审计台账：`C-` 待裁决矛盾、`M-` 机械修复、`OP-` 挂账项（OP-1～OP-39）、权威分层表 | 持续追加；**OP-1 / OP-13 / oq-2 / oq-3 已于 2026-11-01 销项**（见 consistency-audit「一之二」）；**2026-11-02 P-112 新增 OP-36～OP-38**（L.17b 三条边界，见 completed §3.4f）；**P-113 W.6 两条边界沿用 P-112 先例仅归拢至 completed §3.4g、不另立 OP 号**；**2026-11-02 P-121 W.5c-ii 挂账同理归拢至 completed §3.4j（含「派工未走 `runInSandbox`」这条 W.5c-iii 必收边界）**；**P-122 W.5c-iii 已 COMPLETED（#87/`2313597a`）——挂账 4 条归拢至 completed §3.4k、不另立 OP 号；`REJ-010` 已进 `scheme.md` §10 墓地**；**2026-11-03 P-138 OP-33～38 挂账清扫销项（#118/96225df）**：OP-33 部分销项/改定性平台侧不可修，OP-34 改定性平台侧持续观察不销项，OP-35①/35②/36/37/38 销项，新增两条边界挂账（归一化多对一碰撞未区分、.history.jsonl 无界增长）；**2026-11-03 P-140 v0.2 范围 RFC 起草**（[`../rfc/v0.2-scope.md`](../rfc/v0.2-scope.md)，讨论稿）：B.1 / B.2 / C.4 / S.3 / D.1e 状态维持 DEFERRED，不新增 OP 号、无新挂账；**2026-11-08 P-173 结构债挂账**（OP-39）：大文件结构债登记（server.ts handleHttpRequest ~2128 行 / index.tsx Console ~3447 行），外部评审误判更正（daemon→src/lib 为共享契约层非违规），清算前置条件与时机明确（v0.3 方向拍板后立项），不新增施工 OP 号 |
| [`w3-known-gaps.md`](./w3-known-gaps.md) | W.3 环境 / 秘密 / 网络守卫的已知缺口 | 7 项中 2 项未修（`tmpRoot` GC、`splitShellSegments` 引号边界） |
| [`scheme-settled-decisions.md`](./scheme-settled-decisions.md) | 自 [`../scheme.md`](../scheme.md) 迁出的已落盘裁决（原 §6）及其余非 L0 正文（原 §2 / §4 / §5 / §7～§11）；不是施工权威 | 2026-11-14（TASK-J.26）迁入；原位只留指针 |
| [`removed-and-moved.md`](./removed-and-moved.md) | 已删除与已移动的文档索引（原 `docs/README.md` §9） | 2026-11-09 迁入；旧路径勿再引用 |
| [`blueprint-absorption-ruling.md`](./blueprint-absorption-ruling.md) | 蓝图机制吸收七分歧裁决（P-220）：Tina t1309u 确认，标 `user_confirmed` | 已拍板；P-235 已立第一批主体规格卡 [`TASK-J.37`](../specs/development-tasks-active.md#task-j.37)（仍不施工、不改 ADR）；吸收内容规格落地前一律标 `ai_inferred`；托管部署档 / 商业契约层 / 理解度校验另立不决 |
| [`trust-tier-spec-boundary-brief.md`](./trust-tier-spec-boundary-brief.md) | 信任档规格卡划界简报（P-230）：只补 J.32a/b 未覆盖三缝；[`TASK-J.36`](../specs/development-tasks-completed.md#task-j.36) 已 COMPLETED（P-234） | planning brief；三缝已交付；与细模型卡分治 |
| [`blueprint-fine-layer-spec-brief.md`](./blueprint-fine-layer-spec-brief.md) | 细模型加层 + 视图投影规格简报（P-235）：五字段映射 + 附录 C 并轨 + 缺口清单；[`TASK-J.37`](../specs/development-tasks-completed.md#task-j.37) 已 COMPLETED（#294 / P-236） | planning brief；口径已交付；实现 L 未立 |
| [`blueprint-fine-layer-impl-split-brief.md`](./blueprint-fine-layer-impl-split-brief.md) | 细模型加层 + 视图投影实现拆分（R-11）：A–E COMPLETED（D=#312/`7efb1f7`；P-248）；母卡 P-249 选 B 已 SPLIT→COMPLETED 闭合 | planning brief；**J.9b/V-07 债清**（已由 J.38d 吸收） |
| [`prompt-builder-live-send-path-brief.md`](./prompt-builder-live-send-path-brief.md) | prompt-builder 活发送路径只读定位（P-233）：J.35 已对齐但生产零调用；四缝事实 + 接线前置 | planning brief；**不立**接线卡；不施工 |
| [`ci2-sample-assessment-brief.md`](./ci2-sample-assessment-brief.md) | CI.2 只读样本量评估（P-245）：三门禁样本表 + 中位数 + 排除口径；结论「不够整卡放宽开工」 | evidence brief；**Hold 不开工**；下次评估触发见简报 §2 |
| [`route-split-assessment-brief.md`](./route-split-assessment-brief.md) | 路由拆分只读评估（P-255）：合同内联段与 Console 集中度；结论「暂缓整拆」 | planning brief；第一批 [`TASK-J.42`](../specs/development-tasks-completed.md#task-j.42) 已 COMPLETED（#324/`b331cd4`，P-258）。Console 与第二批未立卡 |
| [`adr0015-mainline-breakpoint.md`](./adr0015-mainline-breakpoint.md) | ADR-0015 主链只读走查（P-261）：一句需求之后得不到可审阅的 `SchemeDraftV2` | 已修。真钥匙复测（P-267，main `59f9798`）已落 `user_said` 台账，中栏投影 `available=true`。报告写「确认方案」应可出，未记录浏览器里点到按钮 |
| [`adr0015-breakpoint-fix-assessment.md`](./adr0015-breakpoint-fix-assessment.md) | 断点修复评估（P-262）：建议生产注入意图编译器模型客户端，不把离线语料写入台账 | 建议已由 J.45 交付。评估正文仍是当时的只读记录 |
| [`j47-title-gate-diagnosis-brief.md`](./j47-title-gate-diagnosis-brief.md) | 确认门禁标题不足诊断与施工方案（P-268）：模型未 `set_title`；组装兜底；不改门禁阈值 | 诊断简报；[`TASK-J.47`](../specs/development-tasks-completed.md#task-j.47) 已 COMPLETED（#342/`1dfac26`，P-269）。J47-P4 手工 debt 未销 |
| [`j48-nested-anyof-diagnosis-brief.md`](./j48-nested-anyof-diagnosis-brief.md) | 第二轮生成 schema 嵌套 anyOf 缺 type（P-270）：ids 非空时 `union.nullable()` → DeepSeek 拒；修每分支带 type | 诊断简报；[`TASK-J.48`](../specs/development-tasks-completed.md#task-j.48) 已 COMPLETED（#346/`3a68a81`，P-271）。真钥匙不在本卡；J47-P4 手工 debt 未销 |
| [`decision-class-crosswalk.md`](./decision-class-crosswalk.md) | 现行五类与目标态八类的对照。不改五类，不把八类写进规格正文 | 对照；不是施工权威 |

## 蓝图存档（目标态未激活 · TASK-J.41a）

与上面的流水台账分开。四份都是 `status: draft` / 目标态未激活：描述 Stagent 未来给用户项目用的治理能力，不是本仓施工规范；不进 `docs/specs/`、不作施工依据。任何条款不得直接覆盖现行 docs/；吸收只能经任务卡逐条反哺。J.41b 第一批已交付（施工 [#318](https://github.com/he18718143986-design/IDE/pull/318)/`6f2ec65`，完工回写 P-252）：文档口径五条、白话哈希存证、`escalation_missed` 记录、五类↔八类对照表。R23 仍未施工，单独评估。R18 已拍板：不反哺（P-254）。蓝图仍未激活。蓝图反哺线收口。

**编号分家**：蓝图内 Q-n/S-n 为产品拍板编号，与 [`../specs/scheme-patch-engine.md`](../specs/scheme-patch-engine.md) 的引擎测试锚点 Q-n 编号无关（Q-14/Q-15 两侧语义不同）。不改蓝图正文编号。

**拍板（P-254）**：R18（超时 `parked` 停放）不反哺现行——现行 D-3 看门狗推回 `PREPARING` 自愈方向维持不变；R18 与 Q-14 同类，归「仅目标态保留」，蓝图反哺线收口。已拍板：不反哺。不改 `deadlock-resilience.ts`。

| 文件 | 内容 |
| :--- | :--- |
| [`target-doc-system-spec.md`](./target-doc-system-spec.md) | v3 终稿。合同单位 = 方案（Q-14）；AI 技术顾问（Q-15）；单方案串行；§8 多需求并行默认关闭 |
| [`target-doc-system-stress-test.md`](./target-doc-system-stress-test.md) | R17–R23 落点索引仍在。T-1～T-7 与 DEF-1～7 已按 P-253 重建版补入，原文未逐字核对 |
| [`target-vs-current-gap-brief.md`](./target-vs-current-gap-brief.md) | 合同单位差异、四态标记差异、六件可反哺机制三栏表 |
| [`target-vs-current-analysis.md`](./target-vs-current-analysis.md) | 区别分析：同源但平行；`.stagent/` 运行时层对照；编号撞车 |

### 存档待补（P-253 已补，重建版）

两条都是终稿粘贴时的原文缺口，不是仓库侧读错。P-253 已补入，重建版补入，原文未逐字核对。不改已合入的 v3 正文编号。

| 编号 | 记录 | 补法 |
| :--- | :--- | :--- |
| GAP-R22 | 已补。重建版补入，原文未逐字核对。补入位置为 `target-doc-system-spec.md` §4：验收后翻案（`accepted` 永不重开）、新 REQ 带 `amends:`、事因三分类「漏检 / 翻译错 / 需求变」。 | P-253 已落入。原句仍可在找回 Claude 原文后另开 docs PR 替换 |
| GAP-STRESS | 已补。重建版补入，原文未逐字核对。`target-doc-system-stress-test.md` 保留 R17–R23 落点索引，并在其后补入 T-1～T-7 与 DEF-1～7。 | P-253 已落入。编号按 R17–R23 顺序对齐，不是原文编号 |

## 开放项

已关闭的裁决和 P-流水不在本文件重复。原文留在 [`../specs/development-tasks-changelog.md`](../specs/development-tasks-changelog.md)，本文件不删除那些条目。

| 项 | 还欠什么 | 谁来定 |
| :--- | :--- | :--- |
| [`w3-known-gaps.md`](./w3-known-gaps.md) §4.1、§4.3 | `tmpRoot` GC 与 `splitShellSegments` 引号边界仍未修 | 见该文件的 PASS/FAIL |
| [`consistency-audit.md`](./consistency-audit.md) OP-39 | `daemon/server.ts` 与 `src/routes/index.tsx` 的大文件结构债。清算时机在 v0.3 方向拍板之后 | 待指定 |
| [`ci2-sample-assessment-brief.md`](./ci2-sample-assessment-brief.md) | CI.2 维持 Hold，不开工 | P-245 |
| [`route-split-assessment-brief.md`](./route-split-assessment-brief.md) | 整拆仍不做。第一批 [`TASK-J.42`](../specs/development-tasks-completed.md#task-j.42) 已抽出合同内联段（#324/`b331cd4`）。Console 与第二批未立卡 | P-258 |
| [`adr0015-mainline-breakpoint.md`](./adr0015-mainline-breakpoint.md) | 已修。J.45 注入客户端（[#334](https://github.com/he18718143986-design/IDE/pull/334)/`92e5a63`）。真钥匙复测（P-267，main `59f9798`）：「我要一个登录页」`compiler_applied`，`active.json` 有 1 处 `user_said`，`offline=false`，中栏 `available=true`。报告写「确认方案」应可出，未见禁用挡因；未记录浏览器里点到按钮 | P-267 |
| 编译器有钥匙时模型调用失败 | 根因是 DeepSeek 拒绝 schema（`required` 未覆盖全部 properties）。[#339](https://github.com/he18718143986-design/IDE/pull/339)/`59f9798` 已改成 nullable 必填。复测（P-267）`compiler_applied`，`elapsed_ms=1163`，无 `client_detail`。未再记端到端按钮点击 | P-267 |
| 确认方案因标题空被禁用 | [`TASK-J.47`](../specs/development-tasks-completed.md#task-j.47) 已交付（[#342](https://github.com/he18718143986-design/IDE/pull/342)/`1dfac26`，P-269）：组装兜底注入 `set_title`（模块名优先、quotes 兜底、已有不重复），门禁阈值未动。**真钥匙看 `scheme-confirm` 的 `disabled` 为 false 仍欠**，未点按钮、未冻结。销账以实测记录为准 | P-269 |
| 第二轮生成 schema 嵌套 anyOf 缺 type | [`TASK-J.48`](../specs/development-tasks-completed.md#task-j.48) 已交付（[#346](https://github.com/he18718143986-design/IDE/pull/346)/`3a68a81`，P-271）：一层联合三支带 `type`，接受值仍是现有 id、`new:` id、`null`。`enumOrNever` 对外契约未动。真钥匙复测不在本卡。J47-P4 手工 debt 仍挂账 | P-271 |
| 跨工作区串扰测试间歇性失败 | 存量，疑似时序相关。`multi-worktree-cross-talk` 期望 `STALE`、实际 `PASSED`（第 190 行）。#324 出现、#329 未复现、#337 复现。不在 J.46 修。待 Windows 存量清理专项或单独立卡 | P-266 |
| Windows 路径分隔符导致 spawn/cli-host 白名单匹配失效 | 已修，J.43。[#329](https://github.com/he18718143986-design/IDE/pull/329)/`32bdab9` 在 cli-host 静态禁令比较前把 `path.relative` 收成正斜杠。19 条反斜杠红消除。其余 Windows 存量未动 | P-260 |
| `TASK-D.1e`、`TASK-S.3` | 维持 DEFERRED | 另案，不在本轮 |
| 上方 GAP-R22、GAP-STRESS | 已补。重建版补入，原文未逐字核对 | P-253；找回原文后可再替换 |
