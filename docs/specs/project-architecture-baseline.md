# 项目架构基线规格（Project Architecture Baseline · PAB）

> **地位**：实施口径，从属 [ADR-0019](../adr/0019-project-architecture-baseline.md)；上游密封见 [ADR-0018](../adr/0018-intent-to-executable-seal.md)。施工授权仍以 [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) 为准。
> **主干位置**：ADR-0018 方案密封之后、项目分解之前；见 [`delivery-lifecycle.md`](./delivery-lifecycle.md)。
> **状态**：设计定稿 · 待施工。

## 0. 一句话

在已按 ADR-0018 密封的方案之上，先给整个项目定下有证据、可检验、可演进的架构边界，再拆成合同；PAB 不是唯一脑力瓶颈（绝对榜首为 ADR-0018 密封），禁止让一组局部可执行卡片临场拼出系统。

## 1. 产物边界

| 产物 | 范围 | 权威作用 |
|---|---|---|
| Scheme | 用户目标、业务规则、非目标 | 用户意图来源 |
| **PAB** | 项目模块边界、数据/API 所有权、依赖方向、关键决策与全局不变量 | standard/large 项目的施工前架构约束 |
| ProjectPlan | 里程碑、合同桩、依赖 DAG | 交付顺序，不改变架构 |
| DesignNote | 单合同的文件、局部实现、测试计划 | 遵守 PAB 的施工输入 |
| `docs/system/` | 已合入系统的架构事实和历史 | 项目长期记忆，不取代预先设计 |

PAB 不是合同、写范围、用户开工确认、秘密凭据授权，也不是模型证明正确。

## 2. 适用性与流程

- `large` 必须有通过校验的 PAB，之后才可生成可签署合同桩。
- `standard` 必须有 PAB；确认为单模块且无跨模块接口、数据边界变化时可用 `minimal` 模式，但仍须满足结构与来源校验。
- `tiny` 可跳过完整 PAB；若涉及跨模块接口、持久化/迁移、依赖、安全边界或非功能不变量，则升为 `standard`，不得按 tiny 绕过。
- 新项目无知识库时，以仓库事实和方案建立 `initial` PAB，明确“尚无系统知识库”；不得把推断冒充代码观察。

```text
SchemeDraftV2（可编译）
→ 需规划：用户点「确认方案，开始规划」 / [ADR-0018] 冻结 UserFace+MachineFace
→ JourneyStage PROJECT_MAPPING ·「正在整理项目地图…」（右栏可聊）
→ 仓库事实快照 + PAB（ready，ADR-0019） → ProjectPlan
→ ContractStub（引用 PAB） → 合同级 ScopePlan 投影（只吃 MachineFace，禁聊天直推）
→ 下一份「确认开工」（施工授权）→ Contract + DesignNote → Worker / 验证 / 合入 → docs/system/ 更新与漂移检查

tiny / 无需 PAB·Plan：方案幕直接「确认开工」或「直接改」（一次密封+授权），跳过 PROJECT_MAPPING
```

未决业务问题与 ADR-0016 升级项由 Supervisor 显示决议卡（可降频/合并/延后，ADR-0001）；一般技术取舍由架构责任者提出并记录。PAB 不增加施工授权点击；「开始规划」≠「确认开工」；等待态不是第二套导航。

## 3. 最小数据模型

持久化于 `.stagent/project/architecture-baseline.json`，旧版不可覆盖，归档于 `.stagent/project/architecture-baseline.revisions/<revision>.json`。ProjectPlan 与每个 ContractStub 必须引用 PAB 身份及 digest。

```ts
interface ProjectArchitectureBaseline {
  schema_version: "1.0.0";
  baseline_id: string;
  baseline_revision: number; // 单调递增；回滚也创建新修订
  status: "draft" | "ready" | "stale";
  scheme_ref: { scheme_id: string; scheme_revision: number };
  repository_ref: { base_sha: string; knowledge_digest: string | null };
  mode: "initial" | "minimal" | "full";
  goals_map: Array<{ scheme_item_id: string; component_ids: string[]; acceptance_ids: string[] }>;
  components: Array<{
    component_id: string; name: string; purpose: string; path_hints: string[];
    owns_data: string[]; depends_on: string[]; must_not_depend_on: string[];
    source: "observed" | "user_said" | "user_confirmed" | "ai_inferred";
    evidence_refs: string[];
  }>;
  interfaces: Array<{
    interface_id: string; name: string;
    kind: "http" | "type" | "event" | "cli" | "file_format" | "db_schema";
    signature: string; provider_component_id: string; consumer_component_ids: string[];
    compatibility: string; verification_ids: string[];
  }>;
  data_contracts: Array<{
    data_id: string; owner_component_id: string; schema_or_invariant: string;
    migration_policy: string; rollback_policy: string;
  }>;
  decisions: Array<{
    decision_id: string; question: string; chosen: string; alternatives: string[];
    rationale: string; source: "observed" | "user_said" | "user_confirmed" | "ai_inferred";
    evidence_refs: string[]; escalation: string | null;
  }>;
  invariants: Array<{ invariant_id: string; statement: string; verification_ids: string[] }>;
  non_functional: Array<{ requirement_id: string; statement: string; verification_ids: string[] }>;
  assumptions: Array<{ assumption_id: string; statement: string; impact: string; blocking: boolean }>;
  open_decisions: Array<{ decision_id: string; question: string; blocking: boolean; owner: "supervisor" | "user" }>;
  verification_catalog: Array<{ verification_id: string; command_or_method: string; covers: string[] }>;
}
```

这是必需语义，不要求一次性照搬为同名运行时代码类型；不得建立平行架构 SSOT。

## 4. `ready` 门禁

`ready` 只表示结构与引用完整，不是架构正确性证明。至少满足：

1. **覆盖**：每个 Scheme goal 与用户可见模块映射至组件、验收和验证；未覆盖项必须说明原因。
2. **边界闭合**：组件职责、路径提示和依赖方向明确；依赖无环；每项持久数据仅有一个 owner；接口精确记载 provider、消费者、签名及兼容策略。
3. **可分解**：每个 ContractStub 引用组件与接口 ID；共享新接口有 interface-first 桩及明确依赖，不允许多个合同同时拥有最终接口决定权。
4. **可验证**：安全、迁移、关键不变量及非功能要求有验证方法；人工验收须标记 manual，不得冒称自动通过。
5. **来源诚实**：观察到的事实带文件/知识库引用及仓库 SHA；用户意图可追溯 Scheme 证据；未证实推断显式标 `ai_inferred`。
6. **决策收口**：阻断级 `open_decisions` 清零；非阻断项记录 owner、影响和临时边界；五类敏感技术决策遵循 ADR-0016。
7. **版本新鲜**：绑定 Scheme revision、仓库 base SHA 和知识库摘要；任一变化使 PAB stale。重新校验或新修订前不得生成/签署后续合同。

结构校验、引用一致性由确定性验证器完成，不能用模型自评替代。架构质量仍须由接口审查、契约/集成测试和明确验收证据验证。

## 5. 修订与冲突

- 仅接受含 `base_revision` 的 PAB patch；整份重新校验后产生新 revision，旧版不可改写。
- 用户目标改变：先更新 Scheme，再更新 PAB 与 ProjectPlan；禁止仅在 DesignNote 中改变全局架构。
- 新发现代码事实与基线冲突：暂停尚未签署的合同桩，生成基线修订和影响清单。已签合同保留签署时 digest，不得静默改写；需要改变时显式中止/重签或按原约束完成。
- 组件、接口或不变量变更时，所有未签合同桩须重校验。已合入历史只通过新修订演进。
- `docs/system/` 记录合入后的现状；知识库漂移不能靠文档更新掩盖，需显式 PAB 与计划修订。

## 6. 与 ProjectPlan、Contract 和 DesignNote 的衔接

- `ProjectPlan` 必须含 `architecture_baseline_ref: { baseline_id, baseline_revision, baseline_digest }`；standard/large 缺失或不匹配即拒绝。
- ContractStub 记录其使用的 `component_ids`、`interface_ids` 与同一 baseline digest。接口桩必须先于消费者桩；计划补丁不得引用不存在的 ID。
- DesignNote 必须引用基线修订，证明 `touches` 对应组件、接口使用与 PAB 一致、数据变更遵循 owner/迁移/回滚策略、局部决策不违反全局不变量。
- DesignNote 不得改变模块职责、公共接口、数据 owner 或已批准决策。越界内容先走 PAB patch，过期或冲突时不得注入 Worker。
- PAB `path_hints` 不扩大合同 `ScopePlan` / `writable_paths`。Worker 只实现已定架构，不在任务卡中裁决跨模块接口、数据 owner、身份/权限模型或不可逆迁移。

## 7. 验收矩阵

| ID | 情形 | 预期 |
|---|---|---|
| PAB-01 | large 无 ready PAB 生成 ProjectPlan | 拒绝；不产生可签署桩 |
| PAB-02 | tiny 改动实际涉及跨模块接口或迁移 | 升为 standard 并要求 PAB |
| PAB-03 | goal 无组件/验收/验证映射 | PAB 不得 ready |
| PAB-04 | 共享接口缺 provider、消费者或兼容策略 | PAB 校验失败 |
| PAB-05 | 桩引用不存在的组件/接口 ID | ProjectPlan 校验失败 |
| PAB-06 | DesignNote 使用旧 digest 或改变全局边界 | 暂停并要求 PAB 修订；不得注入 Worker |
| PAB-07 | Scheme、仓库 SHA 或知识库摘要变化 | 标记 stale；重校验/修订后才能新签合同 |
| PAB-08 | 接口变更但未签合同仍依赖旧 ID | 阻止下游签署并列出影响桩 |
| PAB-09 | `ai_inferred` 冒充 observed/user fact | 校验失败并记录来源违规 |
| PAB-10 | 结构通过但没有集成/契约验证证据 | 不得宣称架构质量已验收 |

## 8. 实施顺序

1. 在 TASK-L.7/L.8 前实现 PAB Schema、存储、确定性校验；ProjectPlan 必须引用 PAB。
2. TASK-L.8/L.9 将 PAB 组件、接口、revision/digest 传给计划补丁、合同桩与 ScopePlan 投影，并校验依赖闭包。
3. TASK-L.11 在 DesignNote 增加基线引用和一致性校验；旧基线不得注入 Worker。
4. TASK-L.12/L.13 更新 `docs/system/` 及漂移检查，维护架构事实和追溯链。
5. 建立黄金夹具：共享接口先行、数据 owner 冲突、旧基线、需求修订、错误来源标签、兼容性变更；架构提示或验证器变化后重跑。

本规格是设计约束，不表示施工卡已完成；状态以任务卡与验证证据为准。
