# 技术方案与系统知识库规格（S4 · DesignNote + `docs/system/`）

> **地位**：实施口径，从属 [ADR-0016](../adr/0016-system-knowledge-base-in-repo.md)、[ADR-0018](../adr/0018-project-architecture-baseline.md) 与 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §2 S4。DesignNote 必须遵守 [PAB](./project-architecture-baseline.md)，不得替代项目级架构决策。
> **上游意图**：`q17`「技术方案」、`q19`「在复杂度超过个人脑容量之后，仍然能够掌握整个系统」、`q1`「其他部分能交给Agent的都交给它」（[`../scheme.md`](../scheme.md)）。
> **施工卡**：TASK-L.11（DesignNote）、L.12（知识库 Schema、引导与漂移门禁）、L.13（追踪反查）。
> **状态**：设计定稿 · 待施工。现有代码没有设计产物；`daemon/arch/parser.ts` 与 `daemon/arch/graph.ts` 只在 `GET /api/arch/graph` 上按需计算依赖图，不落盘。

---

## 0. 一句话

用户不做技术决策，但技术决策必须**写下来**：每份合同开工前出一份设计说明（DesignNote），合入时把设计里长期有效的部分沉淀进目标仓库的 `docs/system/`。一个人掌握复杂系统，靠的是读这份知识库，不是记忆。

---

## 1. 两种产物的分工

| | DesignNote | 系统知识库 `docs/system/` |
| :--- | :--- | :--- |
| 粒度 | 一份合同 | 整个项目 |
| 生命周期 | 合同开工前生成，合入后归档 | 永久，随代码演进 |
| 位置 | `.stagent/records/<contract_id>/design-note.json`（不入库） | 目标仓库 `docs/system/`（入库） |
| 读者 | Worker（施工输入）、Daemon（校验）、审计 | 用户、未来的每一份合同、未来的协作者 |
| 谁写 | 设计步骤（形态开放：中栏组件、单次模型调用或专用 Agent，同 ADR-0014 §1 的开放原则） | Worker 在施工中按 DesignNote 的 `knowledge_delta` 写 |

---

## 2. DesignNote

### 2.1 时机

合同进入 `EXECUTING` 后、Worker 第一次写盘之前，Daemon 调用设计步骤生成 DesignNote。设计是 `EXECUTING` 内的第一步，不新增生命周期状态，也不新增迁移边。Schema 校验不过则重试一次；仍不过则合同经既有的 `EXECUTING → PENDING_RESUME` 边挂起（`src/lib/state-machine.ts` `LIFECYCLE_TRANSITIONS`），原因码 `DESIGN_INVALID`，并向用户弹意外卡：「技术方案没理顺，我再想一次 / 先停下」。

> 不放在 `PREPARING`：现行迁移表里 `PREPARING` 不能进入 `PENDING_RESUME`，只能回 `PENDING_APPROVAL` 或 `ABORTED`。

### 2.2 Schema（`src/lib/design/design-note.ts`，新建，纯类型 + 校验函数）

```ts
export interface DesignNote {
  schema_version: "1.0.0";
  contract_id: string;
  approach: string;                         // 3～8 句白话 + 技术混合的方案概述
  touches: Array<{ path: string; change: "create" | "modify" | "delete"; why: string }>;
  interfaces: Array<{                       // 本合同新增或改变的跨模块接口
    name: string;                           // 例："POST /api/orders" 或 "type OrderDTO"
    kind: "http" | "type" | "event" | "cli" | "file_format" | "db_schema";
    signature: string;                      // 精确签名（TS 类型 / OpenAPI 片段 / SQL DDL）
    consumers: string[];                    // 模块 id（modules.yaml）
  }>;
  data_changes: Array<{ kind: "migration" | "seed" | "destructive"; description: string; reversible: boolean }>;
  dependencies: Array<{ name: string; version: string; why: string }>;   // 新增第三方依赖
  decisions: DesignDecision[];
  test_plan: Array<{ acceptance_id: string; test_path: string; level: "unit" | "integration" | "e2e" }>;
  knowledge_delta: {
    modules_upsert: ModuleEntry[];          // 见 §4.2
    decisions_add: string[];                // decisions[] 中需落 ADR 的 decision_id
    overview_changed: boolean;
  };
}

export interface DesignDecision {
  decision_id: string;                      // "dd-1"
  question: string;
  chosen: string;
  alternatives: string[];
  rationale: string;
  escalation: EscalationClass | null;       // 非空 = 需要用户点头（§3）
}

export type EscalationClass = "irreversible" | "costs_money" | "security" | "external_service" | "data_deletion";
```

### 2.3 确定性校验（`validateDesignNote`）

| # | 规则 | 不满足时 |
| :--- | :--- | :--- |
| DN-1 | `touches[].path` 全部落在合同 `writable_paths` 内（复用网关的路径判定函数） | `DESIGN_INVALID` |
| DN-2 | `dependencies` 非空时，合同 `execution_permissions.dependency_changes_allowed === true` | 设计步骤先重试一次「不引入依赖」；仍需要 → `PENDING_RESUME` + 意外卡「需要装新库 X」。选「可以」→ 本合同安全中止（`ABORTED`），计划在原桩前插入 `kind: "dependency"` 桩，原桩随后重签。**不修改已签合同**（TASK-L.11） |
| DN-3 | 合同 `supervisor_metadata.acceptance_refs` 中每个 `check: auto/both` 的条目，在 `test_plan` 中至少出现一次；`test_path` 都在 `tests/stagent/**` 内 | `DESIGN_INVALID`（测试义务，见 [`verification-strategy.md`](./verification-strategy.md) §3） |
| DN-4 | `data_changes` 中有 `destructive` 或 `reversible === false` 时，必须有一条 `escalation: "data_deletion"` 或 `"irreversible"` 的决策 | `DESIGN_INVALID` |
| DN-5 | `interfaces` 中每个 `consumers` 都存在于 `modules.yaml` 或本 DesignNote 的 `modules_upsert` 中 | `DESIGN_INVALID` |
| DN-6 | 任何决策 `escalation !== null` | 合同进入 `PENDING_RESUME`，等待用户在意外卡上点头；点头记录写进 `.stagent/records/<id>/` |

> **原因记录**：现行 `PENDING_RESUME` 迁移不携带原因字段（`daemon/pipeline/orchestrator.ts`）。`DESIGN_INVALID` / `DESIGN_ESCALATION` / `DESIGN_NEEDS_DEPENDENCY` 写入 `.stagent/records/<contract_id>/suspension.json`，供画布意外卡读取。它们不是证据原因码，不进 `reasonCodeSchema`。

### 2.4 注入 Worker

`buildWorkerTaskInstruction`（`daemon/worker/session-task-injector.ts`）新增一段「技术方案」，按以下顺序注入：

1. `approach`
2. `touches`
3. `interfaces`（原样签名）
4. `test_plan`
5. `knowledge_delta`

Worker 偏离 DesignNote 的 `touches`（写了未列出的文件）不算违规，网关只按合同范围拦截。但证据里会记录 `design_deviation: string[]`，供试玩与审计查看。

---

## 3. 哪些技术决策要用户点头

只有下面五类。其余全部由设计步骤决定并记录。这是 `q1`「能交给 Agent 的都交给它」与 ADR-0001「不得用削弱门锁换体验」之间的分界线。

| 类别 | 判定（设计步骤必须标注，Daemon 二次判定） | 例子 |
| :--- | :--- | :--- |
| `irreversible` | 一旦上线无法回滚的改动 | 对外发布的 API 删字段；改主键类型 |
| `costs_money` | 引入付费服务或会产生账单的配置 | 接入付费地图 API |
| `security` | 改认证、授权、加密、密钥处理 | 换登录方式 |
| `external_service` | 新增对第三方网络服务的运行时依赖 | 改用外部邮件服务 |
| `data_deletion` | 删除或不可逆变换用户数据 | 清理旧表 |

**Daemon 二次判定**（不靠设计步骤自觉）：
- `dependencies` 命中付费 SDK 清单 → `costs_money`；
- `data_changes.kind === "destructive"` → `data_deletion`；
- `touches` 命中保护清单 → `security`；
- `interfaces.kind === "db_schema"` 且 `reversible === false` → `irreversible`。

二次判定为真、但设计步骤没有标注时，按 DN-6 处理，并在证据里记 `escalation_missed`。

---

## 4. 系统知识库 `docs/system/`

### 4.1 目录结构（固定）

```text
docs/system/
  overview.md            系统一页纸：做什么、给谁用、主要模块、怎么跑起来
  modules.yaml           模块地图（机器可读，Daemon 校验）
  decisions/
    0001-<kebab>.md      目标项目自己的 ADR（背景 / 决策 / 后果 / 来源合同）
  interfaces/
    <module-id>.md       该模块对外接口的精确签名与消费者
  changelog.md           每份合同一条
```

### 4.2 `modules.yaml` Schema

```yaml
schema_version: "1.0.0"
modules:
  - id: orders                     # kebab，全仓唯一
    name: 订单                     # 白话
    purpose: 创建、查询、取消订单   # 一句话
    paths: ["src/orders/**", "src/api/orders.ts"]
    depends_on: [auth, db]         # 模块 id
    interfaces: ["POST /api/orders", "type OrderDTO"]
    introduced_by: c-20261030-01   # 合同号
    updated_by: [c-20261102-03]
```

### 4.3 `changelog.md` 条目格式

```markdown
## <contract_id> · <白话标题> · <YYYY-MM-DD>
- 方案条目：goal-3, acc-5
- 模块：orders（新增）、auth（修改）
- 决策：decisions/0004-use-sqlite.md
- 验收：acc-5 PASS（evidence <evidence_id>）
```

### 4.4 漂移门禁（`checkKnowledge`，以 `stagent check knowledge` 真实进程执行，TASK-L.12）

| # | 检查 | 失败原因码 |
| :--- | :--- | :--- |
| KB-1 | 本合同改动的每个文件（`git diff --name-only base..candidate`，排除 `docs/system/**`）至少被一个模块的 `paths` 覆盖 | `KNOWLEDGE_DRIFT` |
| KB-2 | `changelog.md` 存在以本 `contract_id` 开头的条目 | `KNOWLEDGE_DRIFT` |
| KB-3 | DesignNote `decisions_add` 中每项都对应 `decisions/` 下一个新文件 | `KNOWLEDGE_DRIFT` |
| KB-4 | `modules.yaml` 通过 Schema 校验；`depends_on` 无环 | `KNOWLEDGE_DRIFT` |
| KB-5 | DesignNote `interfaces` 中每项都出现在对应 `interfaces/<module>.md` 中（字符串包含） | `KNOWLEDGE_DRIFT` |

任一检查失败，子进程以非零码退出，证据结论记为 `FAILED`，原因码 `KNOWLEDGE_DRIFT`（加入 `src/lib/evidence.schema.ts` 的 `reasonCodeSchema`），并计入合同的验证重试次数（`max_verification_retries`）。以真实进程运行，是为满足 ADR-0005 决策 1。Worker 收到的返工提示只列失败项编号与对象，不含修复建议。

**写范围**：目标仓库已有 `docs/system/modules.yaml`，或本桩是 `knowledge_bootstrap` 时，`ScopePlan` 在**签署前**加入 `docs/system/**` 与 `stagent check knowledge`（签署后不改合同）。该路径不计入 `max_file_modifications`：在 `daemon/mcp/gateway.ts` 的文件预算计数处排除。模块路径匹配复用 `src/lib/scope.ts::matchesAnyPattern`。

### 4.5 老项目引导（`knowledge_bootstrap` 合同）

目标仓库没有 `docs/system/modules.yaml` 时，计划的第一批合同中必须有一份引导合同（[`project-decomposition.md`](./project-decomposition.md) D-9）。它的唯一产出是知识库本身：

1. Daemon 先用 `daemon/arch/graph.ts::buildDependencyGraph` 与顶层目录结构生成**草稿**模块划分（确定性，不用模型）：一个顶层源码目录对应一个候选模块；依赖边取自导入关系。
2. 设计步骤给草稿起白话名、写 `purpose` 与 `overview.md`。
3. 验证：KB-1 对仓库**全部**源码文件执行，而不只是本次改动的文件。

---

## 5. 「我还掌握得住吗」——给用户的三个入口

| 入口 | 位置 | 内容来源 |
| :--- | :--- | :--- |
| 系统地图 | 中栏「项目」视图第二页 | `modules.yaml` 渲染为白话卡片 + 依赖图（图由代码渲染，不由模型画） |
| 为什么有这段代码 | 编辑器右键「这段为什么存在」 | `git blame` → Trailer → 合同 → 方案条目 → 原话（TASK-L.13） |
| 改这里会影响什么 | 编辑器右键 / 右栏问答 | `modules.yaml` 的 `depends_on` 反向闭包 + `interfaces/` 消费者列表 |

右栏 Agent 是只读的，可以直接读 `docs/system/` 来回答用户的系统问题。这不违反「不注入」原则（DEC-004），因为它是用户仓库里的普通文件，由右栏 Agent 自己读取。

---

## 6. 测试矩阵

| ID | 场景 | 期望 |
| :--- | :--- | :--- |
| TD-01 | DesignNote `touches` 含合同范围外路径 | `DESIGN_INVALID`（DN-1） |
| TD-02 | 新增依赖但合同不允许依赖变更 | `DESIGN_INVALID` + 意外卡（DN-2） |
| TD-03 | `check: auto` 验收条目未出现在 `test_plan` | `DESIGN_INVALID`（DN-3） |
| TD-04 | `destructive` 数据变更但无 escalation 决策 | `DESIGN_INVALID`（DN-4） |
| TD-05 | 设计步骤未标注，但依赖命中付费 SDK 清单 | `PENDING_RESUME` + `escalation_missed` |
| TD-06 | 改动文件 `src/new/x.ts` 不被任何模块覆盖 | 证据 `FAILED`，`KNOWLEDGE_DRIFT`（KB-1） |
| TD-07 | 缺 `changelog.md` 本合同条目 | `KNOWLEDGE_DRIFT`（KB-2） |
| TD-08 | `modules.yaml` 依赖成环 | `KNOWLEDGE_DRIFT`（KB-4） |
| TD-09 | 引导合同：仓库有 3 个顶层源码目录 | 草稿含 3 个候选模块，导入边与 `buildDependencyGraph` 一致 |
| TD-10 | `docs/system/**` 写入 | 不计入 `max_file_modifications` |
