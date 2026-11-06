# 任务卡模板（满足就绪标准 DoR）

> 复制到 [`../specs/development-tasks.md`](../specs/development-tasks.md) 对应小节，并替换方括号内容。逐条对照 [`../specs/task-card-standard.md`](../specs/task-card-standard.md) §1 的 R-1～R-12；任何一条留空，这张卡都不能开工。样板见 `TASK-C.4`。
>
> ` ```yaml task-card ` 块就是这张卡对应的合同（`SoftwareContract` + DesignNote 去掉运行时字段，见标准 §6），`npm run check:docs` 会逐字段核对；已有合同时用 `stagent export-card --contract-id <id>` 导出再补 `governance`。正文只写卡块装不下的背景与取舍，不要重复卡块里的清单。

~~~~markdown
#### 【Task X.N】[一句话标题] `[NEW_TASK]`

```yaml task-card
id: TASK-X.N                           # = contract_id
status: NEW_TASK                       # NEW_TASK / READY / IN_PROGRESS / BLOCKED / COMPLETED / DEFERRED / SPLIT / ABORTED
contract:
  intent:
    title: [一句话标题]
    description: [做完后谁能看见什么变化]          # R-2
    risk_level: LOW                                # LOW / MEDIUM / HIGH
  acceptance:                                      # R-7：≤12 条
    - { id: XN-P1, check: auto, text: [断言] }     # check：auto / playtest / both
  scheme_item_ids: []                              # R-1（合同侧出处，如 goal-9）
  scope:                                           # = 合同写范围；design.touches 必须落在里面（DN-1）
    writable_paths: [[path 或 glob]]
    readonly_paths: []
  verification:                                    # 必须跑到 test_plan 里的每个测试文件
    commands:
      - { alias: unit, executable: npx, args: [vitest, run, tests/[…].test.ts] }
design:
  approach: [怎么做；R-4 的代码事实写在 governance.code_facts]
  touches:                                         # R-5：create / modify / delete
    - { path: [path], change: modify, why: [为什么改], symbols: [[要新增或改签名的导出符号]] }
  interfaces: []                                   # 跨模块接口：http / type / event / cli / file_format / db_schema
  test_plan:                                       # 每条 auto / both 验收至少一条
    - { acceptance_id: XN-P1, test_path: tests/[…].test.ts, level: unit, case: "[用例标题中的一段原文]" }
governance:
  spec_refs: [docs/specs/[file].md#[anchor]]       # R-1（文档侧出处）
  depends_on: [{ id: TASK-[…], kind: hard }]       # R-3：soft 不阻断开工
  code_facts:                                      # R-4：path::symbol 或 path:起-止
    - { ref: "[path]::[symbol]", note: [今天做了什么、错在哪] }
  non_goals: [[不做什么；与哪张卡分界]]             # R-6
  fail: [[出现即不合格的反例]]                      # R-8
  adr_revisions: []                                # R-9：[{ adr: ADR-NNNN, change: … }]
  defaults: []                                     # R-10：采用的默认值
  open_questions: []                               # R-10：非空则不得 READY
  estimate: S                                      # R-11：S / M；L 必须拆
  invariants:                                      # R-12：unchanged，或写明变更及依据
    auth: unchanged
    demo_origin: unchanged
    illumination: unchanged
    gateway_write_scope: unchanged
  # delivered: { pr: N, commit: abcdef0 }          # COMPLETED 时必填
```

* **背景**：[为什么要做；卡块装不下的上下文]
* **取舍**：[考虑过但没选的做法及理由]
~~~~
