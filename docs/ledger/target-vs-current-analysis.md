---
status: draft
activation: 目标态未激活
---

# 目标态蓝图与现行 docs/ 的区别

> **存档口径**（TASK-J.41a）：`status: draft` / 目标态未激活。本文件是区别分析存档，不是本仓施工规范；不进 `docs/specs/`、不作施工依据。任何条款不得直接覆盖现行 docs/；吸收只能经 J.41b 逐条反哺。
>
> **编号分家**：本文件 Q-n/S-n 为产品拍板编号，与 [`../specs/scheme-patch-engine.md`](../specs/scheme-patch-engine.md) 的引擎测试锚点 Q-n 编号无关。详见文末。

一句话：两套文档同源、平行、用途不同。现行 `docs/` 是本仓已经生效的施工体系。v3 规格是尚未激活的目标态产品蓝图，描述 Stagent 以后写进用户项目的治理能力。它不替换 `docs/`。

## 定位

| | 现行 `docs/` | 目标态规格 |
| :--- | :--- | :--- |
| 状态 | 现行权威。Agent 按 `adr/` 与 `specs/` 施工 | 理想态产品蓝图，未激活（规格 §14） |
| 服务对象 | 本仓自己。`scheme.md` 是用 Stagent 方案格式写的 Stagent 方案 | 未来用户项目上的合同包 |
| 权威 | 意图在 `scheme.md`；决策在 `adr/`；施工依据是 `specs/` 与任务卡。`ledger/`、`rfc/`、`templates/` 不是权威 | 描述产品能力。不进 `docs/specs/` |
| 用户看见的粒度 | 每份合同单独开工、单独合入 | 方案是用户侧合同单位。内部交付单元对用户不可见（§14） |

两边共同的根是：业务用户不做技术活；推断不得冒充决策；原话有主权；不满意时改方案，不直接指挥施工。

## 运行时层

目标态把合同写成用户项目根目录的 Markdown：

```text
brief.md / dialogue.md / scheme/ / approval.md / build/ / gate.md / final.md
```

现行用户项目的状态在 `.stagent/`，不在这七个路径。对照如下。

| 目标态文件 | 现行运行时 | 差异 |
| :--- | :--- | :--- |
| `brief.md` 原话，追责依据，不是合同 | 说话时登记 `turn_id` + sha256；冻结写入快照 `frozen_quotes` | 原话已封存，但是快照的一段，不是项目根上的 brief |
| `dialogue.md` 问答与拍板 | `.stagent/sessions/` | 会话记录，不是方案合同 |
| `scheme/` 唯一合同 | `SchemeDraftV2`；冻结后 `.stagent/drafts/schemes/{confirmation_id}.json` | 方案是密封对象。可验收的交付单元仍是合同 |
| `approval.md` 确认与哈希 | 快照 digest，含 `trust_tier` 与 `item_quote_backlinks` | 哈希在快照上。呈现日志另存 `.stagent/records/surface-log`，不进 digest |
| `build/` 施工记录、`halt.md` | Worktree `.stagent/worktrees/task-<id>`；停工原因 `.stagent/records/<id>/suspension.json` | 有停工，没有目标态那四字段的 halt 文件 |
| `gate.md` 工序验收 | `.stagent/evidence/<contractId>-<evidenceId>.json`；`can_merge` 只由退出码派生 | 证据是 JSON，不是 gate 正文 |
| `final.md` 对完整软件的验收 | 试玩按合同做；发布是另一条生命周期 `.stagent/releases/<id>.json` | 没有一份覆盖整件软件的 final 记录 |
| （内部，用户不可见） | `.stagent/project/plan.json`、`.stagent/contracts/<id>.json`、`.stagent/specs/task_graph.json` | 这是 ADR-0015 的项目 / 里程碑 / 合同 / 任务节点。目标态 §14 说这种拆分可以对用户不可见，现行界面对每次开工和合入仍然可见 |

## 编号撞车

蓝图里的 Q-n 是产品拍板。`scheme-patch-engine.md` 里的 Q-n 是原话锚定测试锚点。两侧 Q-14、Q-15 不是同一件事。

| 编号 | 蓝图（产品拍板） | 引擎测试锚点 |
| :--- | :--- | :--- |
| Q-14 | 合同单位 = 方案；单方案串行；验收对象为完整软件 | 引语「对，就用假数据」：句界符后的「对」能否当整句锚点 |
| Q-15 | AI 技术顾问；确认记录增加 `advisor_ref` | 引语「对」：整条消息即整句 |

处置：蓝图编号保持原样，便于和产出会话对照。阅读和反哺时不要把引擎测试的 Q-14/Q-15 当成产品决定，也不要把产品拍板的 Q-14/Q-15 当成锚定用例。

## 关系

规格描述的是给用户项目用的能力。本仓 `docs/` 继续管 Stagent 自己怎么建。把蓝图整份写进 `specs/`，或按蓝图改掉 ADR-0015，都不在本存档的效力里。可吸收的机制见 [`target-vs-current-gap-brief.md`](./target-vs-current-gap-brief.md)，逐条进入 J.41b 之后才可能变成现行条款。
