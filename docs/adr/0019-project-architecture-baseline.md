# ADR-0019: 项目级架构基线必须先于大型项目分解与合同施工

> **状态**：ACCEPTED（随 PR #1 合入；2026-10-31 完整诊断补丁增等待态 UX）
> **日期**：2026-10-31
> **范围**：`docs/` 规范；不改实现代码
> **依据**：ADR-0018（意图→可签执行物唯一真相缝，绝对榜首）；`delivery-path-audit.md` 的 S3/S4 断点；ADR-0015、ADR-0016；项目分解与技术设计规格
> **权威正文**：[项目架构基线规格](../specs/project-architecture-baseline.md)
> **编号说明**：本 ADR 由原 PR 草案 ADR-0018（PAB）顺延而来。PAB **不再**自称唯一脑力瓶颈；密封见 ADR-0018。

## 背景

ADR-0018 封死「聊天直推合同范围」之后，standard/large 项目仍缺施工前的技术基线来统一模块边界、数据所有权、跨合同接口、依赖方向与架构不变量。现行链路若仅有 Scheme → ProjectPlan → 合同级 DesignNote，则每个合同可局部正确却整体不互操作。

项目分解 D-7 只在分解器显式识别多个合同共享新接口时要求 `interface_first` 桩，无法证明所有共享接口都被发现。单份 DesignNote 在计划与合同签署之后生成，视野不足以约束彼此隔离施工的合同。普通 Worker 按卡施工不能替项目作出这些全局架构选择。

**前提（不可省略）**：PAB 只消费 ADR-0018 已密封的方案结构与仓库事实。旁路未关时，PAB 只会给虚假意图做精密施工——因此本 ADR 是密封之后的下一步，不是榜首替代品。

## 在流水线中的位置（方案 A）

```text
用户点「确认方案，开始规划」（需 PAB/Plan）
  → [ADR-0018 真相缝] 冻结 MachineFace
  → JourneyStage PROJECT_MAPPING（右栏可聊）
  → [ADR-0019 PAB] 全系统管网基线          ← 本 ADR
  → [ADR-0015 ProjectPlan] 拆合同
  → 合同级「确认开工」→ Worker 施工
```

## 决策

1. 每个 `standard` / `large` 项目，在**已密封方案**之后、生成或批准 ProjectPlan 之前，必须生成并通过校验 Project Architecture Baseline（PAB）。`tiny` Fast Path 可跳过完整 PAB；一旦触及跨模块接口、数据/迁移、依赖、安全边界或持久化，必须升级为至少 `standard`。
2. 顺序固定为：可编译 Scheme → 用户「确认方案，开始规划」→ **ADR-0018 双面冻结** → 仓库事实与 PAB → ProjectPlan → ContractStub → 合同级 ScopePlan 投影（只吃 MachineFace）/ 用户 **「确认开工」** → 合同级 DesignNote → Worker。PAB 缺失、过期、结构校验失败或存在阻断级未决项时，不得产生可签署合同桩。
3. PAB 定义项目级模块、接口、数据所有权、依赖方向、关键决策、不变量和验证策略；DesignNote 只在 PAB 边界内细化单合同实现。DesignNote 必须引用 PAB 修订和 digest；改变公共边界须先提交 PAB 补丁。
4. Supervisor 对架构方案与取舍负责；模型输出是提案，Daemon 对 Schema、覆盖、引用、版本、新鲜度和跨文档一致性作确定性校验。所有断言标出 `observed`、`user_said`、`user_confirmed` 或 `ai_inferred` 来源。推断不得伪装成用户事实。
5. **等待态 UX**：用户点「确认方案，开始规划」后若需生成/校验 PAB，进入 `PROJECT_MAPPING`；中栏同页白话「正在整理项目地图…」，右栏可聊、不锁；不得另开导航；不得把此态复用为「交接中」/`GRAPH_MAPPING`。
6. PAB 不是写权限、密钥授权或开工批准。「开始规划」≠「确认开工」。既有合同级「确认开工」、ScopePlan（须遵守 ADR-0018）、保护清单、预算和验证门禁不变；不可逆、费用、安全、外部服务、数据删除等升级项仍按 ADR-0016 交用户裁决。
7. **禁止**再将 PAB 表述为「当前最致命的唯一脑力瓶颈」；该榜首仅属于 ADR-0018。

## 后果

- ProjectPlan、ContractStub 与 DesignNote 增加对 PAB `baseline_id`、revision、digest 的引用；交付主干须把 PAB 放在密封之后、分解之前。
- PAB、合同级 DesignNote、随代码更新的 `docs/system/` 建立版本链：前者定全局边界，后者细化施工，知识库记录合入后的事实。
- `standard` / `large` 项目增加一次架构分析和校验成本；tiny 单模块改动仍轻量。
- PAB 使架构责任与证据可审查，不等于证明架构正确。正确性仍由接口/集成测试与用户验收验证。

## 本 ADR 的验收条件

- [ ] PAB Schema、必需字段、门禁、版本失效、合同引用和测试矩阵写入权威规格，且规格从属 ADR-0019（非 0018）。
- [ ] 主干、项目分解、DesignNote 与相关施工卡都指向「密封 → PAB → 分解」同一顺序。
- [ ] 明确 PAB 是架构约束，不是施工授权；Worker 不负责全局架构裁决；文档中无「PAB 唯一瓶颈」表述。
