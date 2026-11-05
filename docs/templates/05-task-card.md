# 任务卡模板（满足就绪标准 DoR）

> 复制到 [`../specs/development-tasks.md`](../specs/development-tasks.md) 对应小节，并替换方括号内容。逐条对照 [`../specs/task-card-standard.md`](../specs/task-card-standard.md) §1 的 R-1～R-12；任何一条留空，这张卡都不能开工。样板见 `TASK-J.2`（正文）与 `TASK-C.4`（卡头）。
>
> 卡头（` ```yaml task-card ` 块）是机器权威，`npm run check:docs` 会逐字段核对（见标准 §6）；正文只写卡头装不下的背景与取舍，不要重复卡头里的清单。

~~~~markdown
#### 【Task X.N】[一句话标题] `[NEW_TASK]`

```yaml task-card
id: TASK-X.N
title: [一句话标题]
status: NEW_TASK                       # NEW_TASK / READY / IN_PROGRESS / BLOCKED / COMPLETED / DEFERRED / SPLIT
spec_refs:                             # R-1：docs/ 下文件，可带 #锚点
  - docs/specs/[file].md#[anchor]
goal: [做完后谁能看见什么变化]           # R-2
depends_on:                            # R-3：soft 不阻断开工
  - { id: TASK-[…], kind: hard }
code_facts:                            # R-4：path::symbol 或 path:起-止
  - { ref: "[path]::[symbol]", note: [今天做了什么、错在哪] }
touches:                               # R-5：create / modify / delete / read
  - path: [path]
    action: modify
    symbols: [[要新增或改签名的导出符号]]
non_goals:                             # R-6
  - [不做什么；与哪张卡分界]
pass:                                  # R-7：≤12 条，每条落到一个 it(...)
  - { id: XN-P1, test: tests/[…].test.ts, case: "[用例标题中的一段原文]", assert: [断言] }
fail:                                  # R-8
  - [出现即不合格的反例]
adr_revisions: []                      # R-9：[{ adr: ADR-NNNN, change: … }]
defaults: []                           # R-10：采用的默认值
open_questions: []                     # R-10：非空则不得 READY
estimate: S                            # R-11：S / M；L 必须拆
invariants:                            # R-12：unchanged，或写明变更及依据
  auth: unchanged
  demo_origin: unchanged
  illumination: unchanged
  gateway_write_scope: unchanged
# delivered: { pr: N, commit: abcdef0 }  # COMPLETED 时必填
```

* **背景**：[为什么要做；卡头装不下的上下文]
* **取舍**：[考虑过但没选的做法及理由]
~~~~
