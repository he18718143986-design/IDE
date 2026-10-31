# 项目分解规格（S3 · ProjectPlan）

> **地位**：实施口径，从属 [ADR-0015](../adr/0015-contract-as-unit-of-delivery.md)、[ADR-0018](../adr/0018-intent-to-executable-seal.md)、[ADR-0019](../adr/0019-project-architecture-baseline.md) 与 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §1～§2。Standard/large 计划必须引用通过校验的 [PAB](./project-architecture-baseline.md)。冲突时以 ADR 为准。
> **上游意图**：`q18`「把一个无法掌握的大型 AI 软件项目，变成一组你能够理解、能够验收、能够追踪、能够维护的可控任务」（[`../scheme.md`](../scheme.md) goal-8）。
> **施工卡**：TASK-L.7（类型与存储）、L.8（分解器与计划补丁）、L.9（合同序列与交接）、L.10（项目地图画布）。
> **状态**：设计定稿 · 待施工。全库无 `ProjectPlan` 相关代码。

---

## 0. 一句话

方案说「要什么」，计划说「分几份、按什么顺序做」。计划是一张合同桩的 DAG；它不授权任何东西，只决定下一份该签哪份合同。

---

## 1. 何时需要分解

| 方案 `size_hint` | 处理 |
| :--- | :--- |
| `tiny` | 不建计划；直接走 Fast Path「直接改」（supervisor §16.11），仍须遵守 ADR-0018 意图密封；跨模块/数据/安全改动须升为 standard 并建立 PAB |
| `standard` | 须先经 ADR-0018 密封，再有 PAB；通常计划只有 1 个里程碑、1 份合同桩，结构照常落盘 |
| `large` | 须先经 ADR-0018 密封，再有 PAB 并分解；分解结果不满足 §3 尺寸规则时，不得生成任何合同 |

`size_hint` 由方案编译器给出（supervisor §14.2）。分解器可以把 `standard` 升为 `large`，但不能降级。

---

## 2. 数据模型

文件：`src/lib/project/project-plan.ts`（新建，前后端共享、纯类型 + 纯函数、零 fs）。持久化：`.stagent/project/plan.json`；每次合并补丁后，把旧版本写入 `.stagent/project/plan.revisions/<revision>.json`。

```ts
export interface ProjectPlan {
  schema_version: "1.0.0";
  project_id: string;               // 稳定 ID，首次建计划时生成
  plan_revision: number;            // 每合并一次补丁 +1
  architecture_baseline_ref: { baseline_id: string; baseline_revision: number; baseline_digest: string }; // standard/large 必填
  scheme_id: string;                // 来源方案
  scheme_revision: number;          // 分解时的方案修订号
  milestones: Milestone[];
  contracts: ContractStub[];
  graveyard: RemovedStub[];         // 被删除的合同桩（不得悄悄复活）
}

export interface Milestone {
  milestone_id: string;             // "ms-1"
  title: string;                    // 白话，用户可读
  exit_acceptance_ids: string[];    // 绑定方案 acceptance[] 的 id；全部 PASS 才算里程碑完成
  contract_ids: string[];           // 有序
}

export type StubKind = "feature" | "interface_first" | "test_foundation" | "refactor" | "knowledge_bootstrap" | "dependency";

export interface ContractStub {
  stub_id: string;                  // "cs-3"
  milestone_id: string;
  kind: StubKind;
  origin: "scheme" | "system";      // system = 由规则自动生成（见 §2.1）
  context?: {                       // 仅 system 桩可带
    release_id?: string; commit_sha?: string; log_tail?: string;   // 线上问题回流（release §5）
    flaky_test?: string;                                              // 修稳测试（verification §4）
    dependency?: { name: string; version: string };                  // DN-2 依赖桩
  };
  title: string;                    // 白话
  scheme_item_ids: string[];        // ≥1；指向 goals / modules / acceptance
  acceptance_ids: string[];         // ≥1（可观察，见 delivery-lifecycle §3）
  area_hints: string[];             // 预计改动的仓库目录（必须真实存在或在本计划内由前序合同创建）
  depends_on: string[];             // stub_id；硬依赖
  size_estimate: { files: number; diff_lines: number; minutes: number };
  status: "planned" | "signed" | "merged" | "aborted" | "superseded";
  contract_id: string | null;       // 签署后回填
}

export interface RemovedStub {
  stub_id: string;
  title: string;
  removed_by: "user" | "replan";
  reason: string;
  removed_in_revision: number;
}
```

### 2.1 系统桩

下列桩由规则自动生成，不来自方案条目。它们以 `origin: "system"` 标记，`scheme_item_ids` 可以为空，`acceptance_ids` 使用固定的系统验收条目（常量 `SYSTEM_ACCEPTANCE`，定义在 `src/lib/project/project-plan.ts`）：

| 种类 / 来源 | 系统验收 id | 验收文本 |
| :--- | :--- | :--- |
| `test_foundation`（D-8） | `sys-acc-test-foundation` | 项目 `test` 命令退出码 0，且冒烟测试被实际执行 |
| `knowledge_bootstrap`（D-9） | `sys-acc-knowledge` | `docs/system/` 通过 KB-1（覆盖全部源码文件）与 KB-4 |
| `dependency`（DN-2） | `sys-acc-dependency` | 依赖已安装，V0 与 V2 通过 |
| `refactor`（flaky，verification §4） | `sys-acc-flaky` | 该测试在同一候选上连续 5 次通过 |
| `feature`（线上问题，release §5） | `sys-acc-incident` | 复现步骤对应的测试红→绿，且发布后探活通过 |

**放置规则**：系统桩插入到 `nextStub(plan)` 所在里程碑的最前面；该里程碑内原有的 `planned` 桩都对它补一条依赖边。D-5 与 D-6 照常校验。

---

## 3. 分解规则（确定性校验，`validateProjectPlan`）

分解器可以是模型，但它的输出必须通过下面每一条。任何一条不过，补丁整体拒绝，错误码见 §6。

| # | 规则 | 理由 |
| :--- | :--- | :--- |
| D-1 | 每份合同桩的 `size_estimate` 不超过合同预算默认值：files ≤ 10、diff_lines ≤ 2000、minutes ≤ 30（`src/lib/contract.schema.ts` `budget_limits` 默认） | 超出必熔断；必须再拆 |
| D-2 | 每份合同桩 `acceptance_ids.length ≥ 1`；`origin: "scheme"` 时每个 id 存在于方案 `acceptance[]`，`origin: "system"` 时每个 id 存在于 `SYSTEM_ACCEPTANCE` | 可观察、可验收 |
| D-3 | `origin: "scheme"` 的桩 `scheme_item_ids.length ≥ 1` 且每个 id 存在于方案；`origin: "system"` 的桩必须属于 §2.1 所列来源 | 可追踪；杜绝无来源的工作 |
| D-4 | 方案中每条 `goals[]` 与每个 `user_visible` 模块，至少被一份未删除的合同桩覆盖，或出现在 `out_of_scope[]` | 不漏需求 |
| D-5 | `depends_on` 构成 DAG（无环），且只引用本计划内的 stub | 可排序 |
| D-6 | 两份合同桩的 `area_hints` 有交集且无依赖关系时，必须补一条依赖边（先后顺序由分解器定） | 串行执行下避免同一区域被并行设想 |
| D-7 | 两份以上合同桩依赖同一个新接口（跨模块类型、API、数据结构）时，必须存在一份 `kind: "interface_first"` 的合同桩，被它们全部依赖 | 接口先行：先冻结契约，再分头实现 |
| D-8 | 方案的验证方式为 `manual_only`（目标仓库没有任何测试脚本）且 `size_hint === "large"` 时，第一份合同桩必须是 `kind: "test_foundation"` | 大项目不能全靠试玩验收（[`verification-strategy.md`](./verification-strategy.md) §6） |
| D-9 | 目标仓库没有 `docs/system/modules.yaml` 时，第一份合同桩（或紧随 `test_foundation` 之后）必须是 `kind: "knowledge_bootstrap"` | 知识库先于功能（[ADR-0016](../adr/0016-system-knowledge-base-in-repo.md)） |
| D-10 | 每个里程碑的 `exit_acceptance_ids` 是其合同桩 `acceptance_ids` 并集的子集，且非空 | 里程碑有可判定的终点 |
| D-11 | `graveyard` 里的 stub 标题与新 stub 标题做规范化比对（复用 G-MATCH 的 NL 规则，supervisor §14.11 小节 5），命中且 `removed_by === "user"` 时拒绝 | 被用户删掉的不得悄悄复活 |

`size_estimate` 是估计。实际合同由 `ScopePlan` 决定预算；若 `ScopePlan` 构建时发现超出 D-1，Daemon 拒绝签署并要求重新分解该桩（`E_PLAN_STUB_TOO_LARGE`）。

---

## 4. 计划补丁（`PlanPatch`）

计划只经补丁演进，语义与 `SchemePatch` 同构：补丁带 `base_revision`，落后则重算一次；补丁内的 op 全部通过校验才合并。

```ts
export interface PlanPatch {
  base_revision: number;
  reason: "initial" | "scheme_changed" | "contract_aborted" | "user_request" | "stub_too_large";
  ops: PlanOp[];
}

export type PlanOp =
  | { op: "add_milestone"; milestone: Milestone }
  | { op: "add_stub"; stub: Omit<ContractStub, "status" | "contract_id"> }
  | { op: "split_stub"; stub_id: string; into: Omit<ContractStub, "status" | "contract_id">[] }
  | { op: "reorder"; milestone_id: string; contract_ids: string[] }
  | { op: "remove_stub"; stub_id: string; reason: string }
  | { op: "edit_stub"; stub_id: string; fields: Partial<Pick<ContractStub, "title" | "area_hints" | "depends_on" | "size_estimate" | "acceptance_ids" | "scheme_item_ids">> };
```

合并规则（`applyPlanPatch`，纯函数）：

1. 只能修改 `status === "planned"` 的桩；`signed` / `merged` 的桩只读。对它们的 op 被丢弃，并返回 `E_PLAN_STUB_LOCKED`。
2. `remove_stub` 把桩移入 `graveyard`，`removed_by` 由调用方给出：用户在画布上删除为 `user`，重新分解为 `replan`。
3. 合并后整计划过 §3 全部规则；任何一条不过，整个补丁回滚。
4. 合并成功后 `plan_revision + 1`，旧版本写入 `plan.revisions/`。

---

## 5. 合同序列与交接（TASK-L.9）

```text
计划 → 选出「下一份」 → 构建 ScopePlan → 画布「确认开工」 → 合同 → 施工 → 验证 → 合入 → 回填 status=merged → 选出下一份
```

**选出下一份**（`nextStub(plan)`，纯函数）：在 `status === "planned"` 且全部 `depends_on` 均为 `merged` 的桩中，取所在里程碑序号最小、在里程碑内序号最小的一份。没有可选的桩，但仍有 `planned` 的桩时，说明有依赖被 `aborted` 了，此时进入重新分解，`reason: "contract_aborted"`。

**方案继承**：下一份合同沿用同一份方案。每份合同的范围预检只取该桩的 `scheme_item_ids` 与 `area_hints` 作为输入（J.2 `buildScopePlan` 的 `scheme` 参数换成「方案的桩视图」）。施工期间的新消息仍按 supervisor §16.5 的 A～D 分流，本文只改 C 类的去向：

- B 类（本轮范围内补充）：按 §16.5 原规则并入当前合同，不产生计划补丁。
- C 类（新需求）：§16.5 原规则是进入「下一轮」草案；有计划时，「下一轮」就是一份新合同桩（`add_stub`，`reason: "scheme_changed"`），不扩大当前合同。

**中止**：合同 `ABORTED` 后，其桩标为 `aborted`，依赖它的桩不可选，并触发重新分解。

**并发**：同一工作区一次只有一份合同处于 `PREPARING`～`AUDITED`。下一份要等上一份 `MERGED` 或 `ABORTED` 后才能签署。

> 这是 ADR-0002「单工作区互斥」在合同层的落实。现行代码只有 Daemon 进程锁（`daemon/core/pid-lock.ts`），`daemon/server.ts` 的 `activeContracts` 从未被填充，所以没有合同级互斥。TASK-L.9 在签署路径新增检查，冲突返回 `409 E_CONTRACT_IN_FLIGHT`。

### 5.1 按桩种类的签署前范围规则（TASK-L.9）

| 种类 | `ScopePlan` 额外内容（全部在签署前进入 `plan_digest`） |
| :--- | :--- |
| `test_foundation`、`dependency` | `dependency_changes_allowed: true`；精确安装命令进入 `allowed_commands`；`network_policy: "EXPLICIT_TARGETS"`（仅包管理器注册表域名）；锁文件进入 `needs_approval`，由「确认开工」一次点击授权（delivery-lifecycle §5 SA-1） |
| `knowledge_bootstrap` | 写范围仅 `docs/system/**`；验证命令 `stagent check knowledge --all` |
| 其他 | 无额外内容 |

---

## 6. 错误码（需登记进 `src/lib/error-codes.ts`，TASK-L.7）

| 码 | HTTP | 触发 | 白话 |
| :--- | :--- | :--- | :--- |
| `E_PLAN_INVALID` | 422 | §3 任一规则不过（响应体列出规则号与对象） | 「这样拆还不行：<白话原因>，我再拆一次」 |
| `E_PLAN_STALE` | 409 | `base_revision` 落后且重算一次后仍落后 | — |
| `E_PLAN_STUB_LOCKED` | 409 | 修改已签署或已合并的桩 | — |
| `E_PLAN_STUB_TOO_LARGE` | 409 | `ScopePlan` 超出 D-1 | 「这一份太大，我拆成几份小的」 |
| `E_PLAN_STUB_REVIVED` | 409 | D-11 命中 | 「这个你之前删过，要重新加回来吗？」（逃生口：用户点「加回来」） |
| `E_CONTRACT_IN_FLIGHT` | 409 | 已有合同处于 `PREPARING`～`AUDITED` 时签署下一份 | 「上一份还没做完，做完我再开下一份」 |

---

## 7. 画布：项目地图（TASK-L.10）

项目地图是**同一方案工作台页面内**的嵌套条/折叠区，**不是** JourneyStage 之外的第二套导航或独立「项目」入口。

**等待态**：用户点「确认开工」且需跑 PAB / 分解时，中栏主文案「**正在整理项目地图…**」，可附白话子步；完成后展开地图，进度条仍属四幕体系。

只读展示：

- 里程碑列表：白话标题、进度（已合入 / 总数）、退出标准的验收条目及其状态。
- 每份合同桩：白话标题、状态（待做 / 进行中 / 已合入 / 已放弃）、依赖了谁。
- 「下一份」高亮，旁边放「确认开工」按钮。这就是 ADR-0014 对**该份合同**的第 1 次点击；每份合同各一次，合入另计一次。
- 用户可以对 `planned` 的桩做两件事：「先不做这个」（等于 `remove_stub`，`removed_by: "user"`）、「这个往前排」（等于 `reorder`）。其余调整一律通过在右栏说话完成。

**禁止**：在项目地图上展示文件路径、glob、依赖图节点 ID、预算的 Token 单位；禁止另开 Tab/视口专放地图。

---

## 8. 测试矩阵（TASK-L.7 / L.8 的验收依据）

| ID | 场景 | 期望 |
| :--- | :--- | :--- |
| PD-01 | 单桩 `size_estimate.files = 11` | `E_PLAN_INVALID`（D-1） |
| PD-02 | 某个 `user_visible` 模块无桩覆盖、也不在 `out_of_scope` | `E_PLAN_INVALID`（D-4） |
| PD-03 | 依赖成环 cs-1 → cs-2 → cs-1 | `E_PLAN_INVALID`（D-5） |
| PD-04 | 两桩 `area_hints` 都含 `src/api`，无依赖 | `E_PLAN_INVALID`（D-6） |
| PD-05 | 三桩依赖同一新类型，无 `interface_first` 桩 | `E_PLAN_INVALID`（D-7） |
| PD-06 | `manual_only` + `large`，首桩不是 `test_foundation` | `E_PLAN_INVALID`（D-8） |
| PD-07 | 无 `modules.yaml`，前两桩都不是 `knowledge_bootstrap` | `E_PLAN_INVALID`（D-9） |
| PD-08 | 对 `merged` 桩 `edit_stub` | op 丢弃，`E_PLAN_STUB_LOCKED`，其余 op 照常 |
| PD-09 | 用户删除的桩以同义标题重新加入 | `E_PLAN_STUB_REVIVED` |
| PD-10 | `nextStub`：cs-2 依赖 cs-1（`merged`），cs-3 依赖 cs-4（`aborted`） | 返回 cs-2；cs-2 合入后返回 `null` 并触发重新分解 |
| PD-11 | 同一计划 + 同一补丁两次合并 | 结果字节相同（`stableStringify`） |
| PD-12 | 合法补丁合并 | `plan_revision + 1`，`plan.revisions/<旧>.json` 存在 |
| PD-13 | `origin: "system"` 的 `test_foundation` 桩，`scheme_item_ids` 为空，`acceptance_ids: ["sys-acc-test-foundation"]` | 通过 D-2 / D-3 |
