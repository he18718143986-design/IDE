---
status: draft
activation: 目标态未激活
---

# 目标态文档治理 · 压力测试存档

> **存档口径**（TASK-J.41a）：`status: draft` / 目标态未激活。本文件是目标态蓝图的配套存档，不是本仓施工规范；不进 `docs/specs/`、不作施工依据。任何条款不得直接覆盖现行 docs/；吸收只能经 J.41b 逐条反哺。
>
> **编号分家**：文中 Q-n/S-n 为产品拍板编号，与 [`../specs/scheme-patch-engine.md`](../specs/scheme-patch-engine.md) 的引擎测试锚点 Q-n 编号无关。
>
> **源文边界**：v3 终稿 Q-11 写的是「逐项接受 R17–R23（压力测试修补全部并入正文）」。终稿粘贴里没有 T-1～T-7 的场景正文，也没有 DEF-1～7 的缺陷条目。下面的落点索引只指向终稿已经写明的条款，索引表保持原样。
>
> **P-253 重建补入**：索引之后的 T-1～T-7 与 DEF-1～7 不是找回的原文。`ai_inferred` 重建版——原文在 Claude 会话中截断，按可见内容 + 落点索引重建，与原文可能有出入。编号按 R17→T-1 / DEF-1 到 R23→T-7 / DEF-7 顺序对齐，这个对齐本身也是重建假设。

权威正文：[`target-doc-system-spec.md`](./target-doc-system-spec.md)。

## 落点索引（R17–R23）

| 编号 | 终稿位置 | 终稿已写入的修补 |
| :--- | :--- | :--- |
| R17 | §4 | 条目状态机：`proposed → in_dialogue → in_scheme → confirmed → delegated → building → verified → accepted`；不得跳过 `confirmed` 直接进 `building` |
| R18 | §6 | halt 超时：`T_ack` / `T_remind` / `T_park` 数值待定（Q-13 暂缓）；未响应进入提醒，长期未响应转入 `parked` |
| R19 | §6、§11 | 治理事故 INC-n：登记 → 回滚到回滚点 → 向用户披露 → 追认或保持回滚。已执行而确认无效的，建 INC-n |
| R20 | §5 | 预览不产生确认效力；确认仍须走 approval 显式动作 |
| R21 | §4 | 冲突的 `ai_inferred` 以冲突卡呈现（两方表述 + 术语表 +「都不对，我来说」）；平台不得静默择一 |
| R22 | （终稿无独立条款） | Q-11 写「逐项接受 R17–R23」，正文没有单独展开 R22 |
| R23 | §11 | `confirm_ref` 增 `mode: single\|batch`、`rl: RL-n\|none`、`advisor_ref`。带 `rl` 的条目 `mode` 必须为 `single`，否则确认无效，条目回落 `ai_inferred` |

## 与缺陷编号的关系

终稿 §12 点名本文件应含缺陷清单 DEF-1～7。这些编号没有随 v3 终稿一起粘贴。Q-11 认为对应修补已经进入正文，因此上表以 R17–R23 为落点，不用推测的缺陷情节填充 DEF 行。

## T-1～T-7 与 DEF-1～7（重建版）

> `ai_inferred` 重建版——原文在 Claude 会话中截断，按可见内容 + 落点索引重建，与原文可能有出入。每条只复述落点索引与终稿已写条款。可见文本里没有场景情节，这里不另编故事。

### T-1

可见内容（R17，终稿 §4）：条目状态机 `proposed → in_dialogue → in_scheme → confirmed → delegated → building → verified → accepted`；不得跳过 `confirmed` 直接进 `building`。

### DEF-1

推演（R17）：条目若跳过 `confirmed` 直接进入 `building`，即为该条所禁。修补已写在终稿 §4。

### T-2

可见内容（R18，终稿 §6）：halt 超时 `T_ack` / `T_remind` / `T_park` 数值待定（Q-13 暂缓）；未响应进入提醒，长期未响应转入 `parked`。

### DEF-2

推演（R18）：halt 发出后无人响应，若一直占着资源、不进入提醒再转入 `parked`，即为该条所要拦住的情况。数值仍待定。

### T-3

可见内容（R19，终稿 §6、§11）：治理事故 INC-n：登记 → 回滚到回滚点 → 向用户披露 → 追认或保持回滚。已执行而确认无效的，建 INC-n。

### DEF-3

推演（R19）：误分类、误放行或转述失真若只改结果、不登记、不回滚、不向用户披露，即为该条所禁。

### T-4

可见内容（R20，终稿 §5）：预览不产生确认效力；确认仍须走 approval 显式动作。

### DEF-4

推演（R20）：用户看过预览并表示满意，若因此被记成 `confirmed`，即为该条所禁。

### T-5

可见内容（R21，终稿 §4）：冲突的 `ai_inferred` 以冲突卡呈现（两方表述 + 术语表 +「都不对，我来说」）；平台不得静默择一。

### DEF-5

推演（R21）：两个 Agent 对同一条目冲突时，若平台自己选一边写入方案，即为该条所禁。

### T-6

可见内容（R22，P-253 重建补入终稿 §4）：验收后翻案：`accepted` 永不重开；新 REQ 带 `amends:` 指回旧条目；事因三分类「漏检 / 翻译错 / 需求变」由 AI 顾问初判 + 用户拍板；处置路径按分类分流。

### DEF-6

推演（R22）：已 `accepted` 的条目若被原条重开，而不是另开带 `amends:` 的新 REQ，即为该条所禁。三分类之后各自走哪条路径，可见文本没有写出。

### T-7

可见内容（R23，终稿 §11）：`confirm_ref` 增 `mode: single|batch`、`rl: RL-n|none`、`advisor_ref`。带 `rl` 的条目 `mode` 必须为 `single`，否则确认无效，条目回落 `ai_inferred`。

### DEF-7

推演（R23）：带 `rl` 的条目若以 `batch` 确认并保持原标记，即为该条所禁。终稿写的处置是确认无效、回落 `ai_inferred`。
