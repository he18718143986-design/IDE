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
| [`decision-class-crosswalk.md`](./decision-class-crosswalk.md) | 现行五类与目标态八类的对照。不改五类，不把八类写进规格正文 | 对照；不是施工权威 |

## 蓝图存档（目标态未激活 · TASK-J.41a）

与上面的流水台账分开。四份都是 `status: draft` / 目标态未激活：描述 Stagent 未来给用户项目用的治理能力，不是本仓施工规范；不进 `docs/specs/`、不作施工依据。任何条款不得直接覆盖现行 docs/；吸收只能经 J.41b 逐条反哺。

**编号分家**：蓝图内 Q-n/S-n 为产品拍板编号，与 [`../specs/scheme-patch-engine.md`](../specs/scheme-patch-engine.md) 的引擎测试锚点 Q-n 编号无关（Q-14/Q-15 两侧语义不同）。不改蓝图正文编号。

| 文件 | 内容 |
| :--- | :--- |
| [`target-doc-system-spec.md`](./target-doc-system-spec.md) | v3 终稿。合同单位 = 方案（Q-14）；AI 技术顾问（Q-15）；单方案串行；§8 多需求并行默认关闭 |
| [`target-doc-system-stress-test.md`](./target-doc-system-stress-test.md) | R17–R23 落点索引。T-1～T-7 与 DEF-1～7 的情节未随终稿粘贴，存档不补写 |
| [`target-vs-current-gap-brief.md`](./target-vs-current-gap-brief.md) | 合同单位差异、四态标记差异、六件可反哺机制三栏表 |
| [`target-vs-current-analysis.md`](./target-vs-current-analysis.md) | 区别分析：同源但平行；`.stagent/` 运行时层对照；编号撞车 |

### 存档待补（不挡 #315 合入）

两条都是终稿粘贴时的原文缺口，不是仓库侧读错。补写从 Claude 会话取回，或由业主直接补；补完另开 docs PR 更新存档文件，不改已合入的 v3 正文编号。

| 编号 | 记录 | 补法 |
| :--- | :--- | :--- |
| GAP-R22 | spec v3 缺 R22 正文，待补。Q-11 接受 R17–R23，终稿没有 R22 单独条款。待补内容为：验收后翻案（accepted 永不重开）、新 REQ 带 `amends:`、事因三分类。 | 回 Claude 会话或业主直接补，再走 docs PR |
| GAP-STRESS | `target-doc-system-stress-test.md` 只有 R17–R23 落点索引。T-1～T-7 情节与 DEF-1～7 推演过程未随终稿粘贴。 | 从 Claude 会话取回原文后补入该存档文件 |

## 开放项

已关闭的裁决和 P-流水不在本文件重复。原文留在 [`../specs/development-tasks-changelog.md`](../specs/development-tasks-changelog.md)，本文件不删除那些条目。

| 项 | 还欠什么 | 谁来定 |
| :--- | :--- | :--- |
| [`w3-known-gaps.md`](./w3-known-gaps.md) §4.1、§4.3 | `tmpRoot` GC 与 `splitShellSegments` 引号边界仍未修 | 见该文件的 PASS/FAIL |
| [`consistency-audit.md`](./consistency-audit.md) OP-39 | `daemon/server.ts` 与 `src/routes/index.tsx` 的大文件结构债。清算时机在 v0.3 方向拍板之后 | 待指定 |
| [`ci2-sample-assessment-brief.md`](./ci2-sample-assessment-brief.md) | CI.2 维持 Hold，不开工 | P-245 |
| `TASK-D.1e`、`TASK-S.3` | 维持 DEFERRED | 另案，不在本轮 |
| 上方 GAP-R22、GAP-STRESS | 终稿粘贴缺 R22 正文，压力测试缺场景情节 | 业主整理原文后另开 docs PR |
