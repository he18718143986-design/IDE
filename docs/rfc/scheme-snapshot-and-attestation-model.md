# RFC · Scheme 快照规范化模型、三元绑定与终态清理协议

> ## `[PROPOSED / 未批准 / 非现行]` · 不得当施工依据（DOC-9）
>
> 本文**不进入**现行 Supervisor / ADR / runtime。与 SSOT 冲突时以 SSOT 为准。
> **DOC-9 · 2026-11-01（用户拍板提前做）**：① 两份 `SchemeSnapshot` 已合并为下文 **唯一权威提案定义**（原瘦身第二份降为历史注记）；② 全文去掉「防篡改 / 不可篡改」升格措辞，完整性校验对齐 [ADR-0006](../adr/0006-local-first-no-tamper-proof.md)（**本地优先 · 不防篡改**——持有宿主写权限者无法被本地 JSON/签名承诺击败）。

> **状态**：**PROPOSED · 未批准 · 不进入现行规范**
> **提案编号**：RFC-2026-003（文档治理重组时分配）
> **来源**：原 `docs/rfc/scheme-snapshot-and-attestation-model.md`（修订草案，2026-10-27）
> **裁决依据**：2026-10-27 文档治理审查裁定 **D-2 = 选项 B**

---

## 0. 为什么它是 RFC 而不是现行规范

**判定事实（2026-10-27 代码核验）**：

| 本 RFC 引入的关键符号 | 在 `src/` + `daemon/` 中的命中数 |
| :--- | :--- |
| `RETAINED_FOR_REVIEW` | **0** |
| `CLEANUP_PENDING` | **0** |
| `worktree_status` | **0** |
| 五份 Markdown 工件序列化（AST → 工件） | **0** |

按《Supervisor SSOT》§10「未接线即未完成」的判定口径，**本 RFC 全部条款均不具备标记 `COMPLETED` 的资格**。因此：

1. **绝不并入现行 SSOT**。现行权威仍为 [`../specs/supervisor.md`](../specs/supervisor.md)（v2.0 正文 + v2.0.2 裁定层的合流件）。
2. **保留其设计价值**。本 RFC 的三类设计——**判别联合类型**、**AST／工件／ExecutionContract 三元哈希绑定**、**终态清理协议**——是当前规范体系里唯一系统化的表述，v0.2 若要落地必须先从这里出发。
3. **已裁决的不采纳项**（见 §5）：`confirmation_id` 的内容派生式 `sha256(scheme_id + revision + digest)` —— 它会使现行 `E_CONFIRMATION_ID_REUSED` 用例永远无法触发，已裁决为**不采纳**，但在本 RFC 中留档为 v0.2 备选。

## 1. 与本 RFC 相关的裁决记录

| 争议 | 裁决 | 影响 |
| :--- | :--- | :--- |
| `confirmation_id` 生成方式 | **D-1 = A**：采「前端生成 + 同修订复用」，维持 v2.0.2 D3，不动代码 | 内容派生式降级为本文档 §5 的备选方案 |
| §4.7 是否并入现行 SSOT | **D-2 = B**：不并入，整章抽为本 RFC | 本文档成为 v0.2 立项输入 |
| `docs/templates/` 四件套模板 | **D-4 = A**：保留并补 Git 跟踪，定位为「Supervisor 未来渲染工件脚手架（对齐 RFC）」 | 见 §4.7.1 的工件映射 |

## 2. 立项前必须回答的三个问题

1. **工件序列化是否值得做？** 五份 Markdown（PRD / 系统设计 / 验收矩阵 / 追溯矩阵 / 填写说明）的自动渲染，需要 Supervisor 侧具备稳定的结构化中间表示。当前实现是启发式 Mermaid 薄切片，是否投入需单独立卡评估。
2. **三元哈希绑定解决什么真实问题？** 它防的是「快照、工件、合同三者悄悄漂移」。若 v0.2 不引入多轮次并发合同，该机制的边际收益可能低于维护成本。
3. **终态清理协议与 `MERGED` 终态如何共存？** `RETAINED_FOR_REVIEW` 与 ADR-0012（`MERGED` 为唯一运行时终态）需要一次显式对齐，否则两套清理语义会打架。

---

## 3. 提案正文（原 v2.0.3 §4.7）

### 4.7 核心数据模型、类型约束与跨阶段不变量（v2.0.3 修订）

本节是产品契约层的规范性数据模型。字段标为必填时对象必须携带；可选字段只允许在所列生命周期阶段缺省。Daemon 必须在持久化边界再次校验，TypeScript 类型不能代替运行时校验、路径拦截或完整性校验（对齐 ADR-0006：非防篡改）。实现字段名可适配现有代码，但不得削弱语义。

#### 4.7.1 Scheme 快照规范化 AST、Demo 绑定与 Markdown 工件映射

##### A. `SchemeSnapshot` 唯一权威提案定义与规范化摘要算法

> **DOC-9**：本节为本 RFC 内**唯一** `SchemeSnapshot` 提案定义。现行代码若尚未接线，仍以 SSOT「未接线即未完成」为准（见 §0）；不得把本接口当作已实现 SSOT。

```ts
export type SchemeStatus = 
  | 'DRAFTING'        // 需求收集中
  | 'REVIEWING'       // 已达到最低结构完整度，中栏开放审阅
  | 'DEMO_GENERATING' // 后台正在运行原型生成
  | 'FROZEN'          // 用户点击「确认方案」，只读锁定，准备编译 Contract
  | 'ABANDONED';      // 方案废弃

export interface SchemeSnapshot {
  schema_version: '2.0.0';
  scheme_id: string;                    // 方案唯一实例 ID
  revision: number;                     // 单调递增正整数 (1, 2, 3...)
  digest: string;                       // 本版本内容的规范化 SHA-256 摘要 (hex, 64 字符；完整性校验，非防篡改)
  created_at: string;                   // ISO 8601
  updated_at: string;                   // ISO 8601 (计算 digest 时排除)
  status: SchemeStatus;

  // 1. 业务与产品（对应 01-PRD模板）
  product: {
    title: string;
    summary: string;
    target_audience: Array<{ role_id: string; name: string; description: string }>; // ROLE-###
    goals: Array<{ goal_id: string; description: string; metric?: string }>;        // GOAL-###
    non_goals: string[];
    user_flows: Array<{ flow_id: string; name: string; steps: string[] }>;          // FLOW-###
    requirements: Array<{                                                           // REQ-###
      req_id: string;
      title: string;
      description: string;
      priority: 'P0' | 'P1' | 'P2';
      acceptance_criteria_ids: string[]; // 关联的 AC-###
    }>;
    business_rules: Array<{ rule_id: string; statement: string }>;                  // RULE-###
  };

  // 2. 架构、契约与不变量（对应 02-系统设计模板）
  architecture: {
    modules: Array<{ module_id: string; name: string; responsibilities: string[] }>;
    diagram_mermaid: string; // 架构/流程拓扑图，供中栏直接渲染
    api_contracts: Array<{   // API-###
      api_id: string;
      name: string;
      method_or_type: string;
      request_schema: Record<string, unknown>;
      response_schema: Record<string, unknown>;
      error_codes: string[];
    }>;
    invariants: Array<{ inv_id: string; assertion: string }>;                       // INV-###
    security_policies: Array<{ sec_id: string; rule: string }>;                     // SEC-###
    adr_refs: Array<{ adr_id: string; title: string; status: string }>;             // ADR-####
  };

  // 3. 验收断言与环境门禁（对应 03-验收矩阵模板）
  verification: {
    assertions: Array<{      // AC-###
      ac_id: string;
      req_id: string;
      given: string;
      when: string;
      then: string;
      is_negative_path: boolean; // 是否防越界/拒绝路径 (硬门禁)
    }>;
    nfr_targets: Array<{ nfr_id: string; category: string; target: string; method: string }>; // NFR-###
    automated_checks: Array<{ command: string; timeout_sec: number }>;
  };

  // 4. 治理与未决事项
  governance: {
    decisions: Array<{
      decision_id: string;
      title: string;
      selected_option: string;
      reason: string;
      source: 'USER_EXPLICIT' | 'AI_RECOMMENDED';
      is_pinned: boolean; // 用户锁定项禁止被模型重写覆盖
    }>;
    open_questions: Array<{ // OQ-### (严格 7 列标准)
      oq_id: string;
      question: string;
      affected_scope: string;
      blocker_level: 'BLOCKER' | 'NON_BLOCKER';
      candidate_options: string[];
      owner: string;
      review_checkpoint: string;
      status: 'OPEN' | 'RESOLVED';
      resolution_summary?: string;
    }>;
  };

  // 5. 原型绑定状态 (全部采用小写短语判别联合类型)
  demo_binding?: SchemeDemoBinding;
}
```

##### B. 对应五份 Markdown 工件的序列化映射
AST 转换为工程工件时必须保持无副作用纯函数渲染，并在 Frontmatter 中显式注入 `source_digest: H_ast`：
- `00-填写说明.md`：静态工程底座，注入本方案统一 ID 空间与规范锚点；
- `01-PRD模板.md`：映射 `product.*` 与 `governance.open_questions` 中的产品级未决项；
- `02-系统设计与接口契约模板.md`：映射 `architecture.*`、`verification.nfr_targets` 及架构级决策；
- `03-验收矩阵模板.md`：映射 `verification.assertions`（Given-When-Then）、自动化验证命令与验收未决项；
- `04-追溯矩阵模板.md`：自动以 `REQ-###` 聚合推导 `AC`、`ARCH/API`、`ADR`、`TEST` 交叉矩阵。

##### C. 原型绑定状态枚举（隶属权威 `SchemeSnapshot.demo_binding`）

```ts
export type SchemeDemoBinding =
  | { status: 'none' }
  | { status: 'building'; bound_scheme_revision: number; bound_scheme_digest: string }
  | { status: 'failed'; bound_scheme_revision: number; bound_scheme_digest: string; failure_code: string }
  | { status: 'ready'; bound_scheme_revision: number; bound_scheme_digest: string; preview_ref: string }
  | { status: 'confirmed'; bound_scheme_revision: number; bound_scheme_digest: string; preview_ref: string; confirmed_at: string }
  | { status: 'degraded_flowcard'; bound_scheme_revision: number; bound_scheme_digest: string; accepted_at: string; risk_flags: ['NO_INTERACTIVE_DEMO', ...string[]] }
  | { 
      status: 'stale'; 
      bound_scheme_revision: number; 
      bound_scheme_digest: string; 
      /** 内部遥测标记：记录因版本递增或内容摘要变化引起的失效原因 */
      stale_trigger: 'REVISION_MISMATCH' | 'DIGEST_MISMATCH'; 
    };
```

> **DOC-9 合并说明（2026-11-01）**：曾并存的第二份瘦身 `SchemeSnapshot`（`product_intent` / `content_digest` / 顶层 `demo`）**已废除**，不再作为本 RFC 定义。其字段语义分别覆盖于权威定义的 `product` / `architecture` / `governance` / `digest` / `demo_binding`。若 Git 历史需对照，见升格前版本。

**字段与谓词规则（兼容 v2.0.2 D1）**：
1. **字段互斥**：Demo 为 `none` 时不得存在任何绑定字段；从 `building` 起必须固定生成时的 `bound_scheme_revision` 与 `bound_scheme_digest`；`ready` 必须包含可解析的 `preview_ref`；`confirmed` 必须包含 `confirmed_at`；降级卡必须记录显式接受时间与风险标记。
2. **陈旧判定收敛（D1 闭集保持）**：当且仅当 `(demo_binding.bound_scheme_revision !== scheme.revision || demo_binding.bound_scheme_digest !== scheme.digest)` 时，系统判定 Demo 失效（`status = 'stale'`）。此时，方案确认谓词 `evaluateSchemeConfirmation` 必须且只能返回 v2.0.2 §1 D1 规定的标准拒绝码 **`E_DEMO_STALE`**。严禁向上层暴露自定义错误码；内部遥测字段 `stale_trigger` 仅供审计，不参与 UI 分支判定。

#### 4.7.2 Contract 生命周期与不可变签署材料

```ts
export interface ContractBase {
  /** 
   * 关联 v2.0.2 §1 D3 事务的幂等键 confirmation_id
   * 必须在 CLAIM_AND_QUIESCE 阶段由前端生成，落盘快照 (.stagent/drafts/schemes/{confirmation_id}.json) 与合同必须共用此键
   */
  confirmation_id: string;
  /** 合同全局唯一 ID，格式如 cnt_94_p52ac */
  contract_id: string;
  /** 绑定的方案快照基线 */
  scheme_ref: { 
    scheme_id: string; 
    scheme_revision: number; 
    bound_scheme_digest: string; 
  };
  /** 签署时刻仓库主干 HEAD 的 commit hash，所有 Worktree 分支必须以此分叉 */
  base_commit_hash: string;
  /** 物理安全与路径策略 */
  scope: ContractScopePolicy;
  /** 验证命令集 */
  verification: {
    commands: VerificationCommandSpec[];
    require_clean_git_status: true;
  };
  /** 资源硬配额 */
  budget_limits: ContractBudgetLimits;
}
export type ContractStatus = 
  | 'PENDING_APPROVAL' 
  | 'SIGNED' 
  | 'EXECUTING' 
  | 'COMPLETED' 
  | 'FAILED' 
  | 'REVOKED_VIOLATION' 
  | 'CANCELLED' 
  | 'VOID';

export type ExecutionContract =
  | (ContractBase & { 
      status: 'PENDING_APPROVAL'; 
      signed_at?: never; 
      contract_signature?: never;
      voided_at?: never;
      void_reason?: never;
    })
  | (ContractBase & {
      status: 'SIGNED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'REVOKED_VIOLATION' | 'CANCELLED';
      signed_at: string;
      contract_signature: string;
      voided_at?: never;
      void_reason?: never;
    })
  | (ContractBase & {
      status: 'VOID';
      signed_at?: string;
      contract_signature?: string;
      voided_at: string;
      void_reason: string; // 签署失败/派发回滚时标记作废
    });
```

`PENDING_APPROVAL` 不是已签署合同，不得伪造签署时间或签名。签署后 `scheme_ref`、`base_commit_hash`、Scope、验证命令与预算不可变；如需改变必须新建合同/新修订，不得覆写原合同。`contract_signature` 若存在，表示可信 Daemon 对规范化合同载荷的**本地完整性证明**（可选密码学附属）；**不构成**对持有宿主写权限攻击者的防篡改（ADR-0006）。不可把前端生成值称为授权凭证。

#### 4.7.3 Task 状态、执行证据与清理阶段

```ts
export type TaskFailureKind = 'VERIFICATION_FAILED' | 'TIMEOUT' | 'SCOPE_VIOLATION' | 'BUDGET_EXCEEDED' | 'WORKER_ERROR' | 'CANCELLED';
export interface TaskVerificationResult {
  command_id: string;              // 必须对应合同中的命令
  exit_code: number;
  duration_ms: number;
  log_artifact_id: string;          // 受控工件引用；不向 UI 暴露任意绝对路径
  stdout_snippet?: string;          // 截断且经脱敏
  stderr_snippet?: string;          // 截断且经脱敏
}
export interface TaskCleanup {
  token_status: 'ACTIVE' | 'REVOKED';
  worktree_status: 'RETAINED_FOR_REVIEW' | 'CLEANUP_PENDING' | 'PRUNED' | 'CLEANUP_FAILED';
  base_integrity: 'VERIFIED' | 'NOT_APPLICABLE' | 'FAILED';
  updated_at: string;
  failure_code?: string;
}
export interface TaskRecordBase {
  touched_files: string[];
  created_files: string[];
  deleted_files: string[];
  git_diff_stat: { insertions: number; deletions: number; total_lines: number };
  verification_results: TaskVerificationResult[];
  cleanup: TaskCleanup;
  failure_kind?: TaskFailureKind;
  failure_detail?: string;
  cost_record?: { input_tokens?: number; output_tokens?: number; estimated_cost_minor_units?: number };
}
export interface ExecutionTaskBase {
  task_id: string;
  contract_id: string;
  contract_signature: string;
  sequence: number;
  title: string;
  depends_on: string[];
  runtime_context: { worktree_ref: string; branch_name: string; base_commit: string };
  security_token: {
    token_id: string;
    allowed_write_globs: string[];
    quota: { allocated_diff_lines: number; timeout_seconds: number; allocated_command_retries: number };
  };
  worker_payload: { instruction: string; related_files: string[]; acceptance_criteria: string[] };
}
export type ExecutionTask =
  | (ExecutionTaskBase & { status: 'PENDING'; execution_record?: never })
  | (ExecutionTaskBase & { status: 'RUNNING'; started_at: string; execution_record?: never })
  | (ExecutionTaskBase & { status: 'SUCCESS'; finished_at: string; execution_record: TaskRecordBase & { failure_kind?: never } })
  | (ExecutionTaskBase & { status: 'FAILED' | 'TIMEOUT' | 'INTERCEPTED_VIOLATION' | 'MANUALLY_CANCELLED'; finished_at: string; execution_record: TaskRecordBase & { failure_kind: TaskFailureKind; failure_detail: string } });
```

> **终态清理分阶段裁定与覆盖声明（Override v2.0.1）**：
> 本条款正式取代并澄清历史文档（包括 v2.0.1 §5.4 表格）中“终态一律物理删除 Worktree”的笼统表述，建立分阶段清理协议：
> 1. **Token 立即注销（原子性）**：任务脱离 `RUNNING` 态（进入 `SUCCESS`、`FAILED`、`TIMEOUT`、`INTERCEPTED_VIOLATION` 或 `MANUALLY_CANCELLED`）的同一物理事务内，必须立即吊销安全 Token（`token_status: 'REVOKED'`）。任何终态任务的 Token 均不得再次接受请求。
> 2. **Worktree 分阶段保留（审查与合并生命周期）**：
>    - 若 `status === 'SUCCESS'`，Worktree 状态**必须标记为 `RETAINED_FOR_REVIEW`**，严禁立即物理 Prune，以确保用户与 UI 能完整审阅工作区代码变更并运行真机试玩；
>    - 直至用户完成**“合并代码”**或**“放弃本轮”**后，Daemon 方可触发清理流（`CLEANUP_PENDING → PRUNED`）；
>    - 若 `status === 'INTERCEPTED_VIOLATION'` 或异常中断，系统冻结现场以备审计，并在人工放弃或明确补偿后执行卸载，状态流转为 `PRUNED`；
> 3. **清理异常审计**：若物理 Prune 发生 EBUSY/权限错误，必须落盘为 `CLEANUP_FAILED` 并触发告警重试队列，严禁伪报已清理。

#### 4.7.4 `canConfirmScheme` 门禁求值与拒绝码判定表（负向硬防线）

方案确认门禁是零容忍的机器求值门禁。任何阻断条件未满足，中栏「确认方案」按钮硬置灰，并向 UI 暴露标准化拒绝码：

| 校验维度 | 判定触发条件 | 门禁结果 | 顶层拒绝码 (严格 7 码闭集) | 结构化错误详情 (detail / subtype) | UI 交互与处理方式 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **需求完整度** | `product.requirements.length === 0` | **阻断** | **`E_SCHEME_NOT_REVIEWABLE`** | `EMPTY_REQUIREMENTS` | 提示「尚未识别出业务需求」，引导在右栏对话。 |
| **断链孤儿** | 存在任一 `REQ` 缺少对应 `AC` 断言 | **阻断** | **`E_SCHEME_NOT_REVIEWABLE`** | `ORPHAN_REQUIREMENT` | 高亮对应需求条目，提示缺少验收准则。 |
| **负向断言硬门禁** | `verification.assertions` 中无 `is_negative_path === true` | **阻断** | **`E_SCHEME_NOT_REVIEWABLE`** | `NEGATIVE_ASSERTION_MISSING` | 提示「必须包含至少一条防越界/异常拒绝断言」。 |
| **验证命令硬门禁** | `verification.automated_checks` 为空集 | **阻断** | **`E_SCHEME_NOT_REVIEWABLE`** | `AUTOMATED_COMMANDS_MISSING` | 要求至少配置一条静态验证命令（如 typecheck 或 test）。 |
| **BLOCKER 级别 OQ** | 存在任一 `OPEN` 且 `blocker_level === 'BLOCKER'` 的 OQ | **阻断** | **`E_SCHEME_CONFLICTS_OPEN`** | `BLOCKER_OQ_UNRESOLVED` | 决议区摇红高亮未决冲突与 OQ，列出选项等待用户裁决。 |
| **NON_BLOCKER 待决** | 存在 `OPEN` 但 `blocker_level === 'NON_BLOCKER'` 的 OQ | **放行 (记录)** | *无拒绝码 (放行)* | `NON_BLOCKER_ADOPT_DEFAULT` | 自动采纳推荐默认值，并在 Contract 风险说明中落盘。 |
| **Demo 生成中** | 原型生成进行中（`status === 'building'`） | **阻断** | **`E_DEMO_BUILDING`** | `BUILDING_IN_PROGRESS` | 禁用确认，展示「原型生成中」进度条。 |
| **Demo 构建失败** | 原型生成失败（`status === 'failed'`）未处理 | **阻断** | **`E_DEMO_FAILED`** | `BUILD_FAILED_UNRESOLVED` | 提示重试生成，或显式接受降级流程图开工。 |
| **Demo 时序冲突** | 原型生成就绪（`status === 'ready'`）但未确认 | **阻断** | **`E_DEMO_CONFIRMATION_REQUIRED`** | `UNCONFIRMED_PROTOTYPE` | 提示「Demo 原型尚未确认」，引导确认或显式放弃。 |
| **Demo 方案陈旧** | 原型绑定的 `digest !== snapshot.digest` 或 revision 漂移 | **阻断** | **`E_DEMO_STALE`** | `DEMO_DIGEST_MISMATCH` | 提示需求漂移原型陈旧，提供重生成或丢弃选项。 |
| **方案已冻结** | 当前方案已被确认过且已处于 `FROZEN` 锁定态 | **阻断** | **`E_SCHEME_ALREADY_FROZEN`** | `SCHEME_IMMUTABLE` | 方案已签署锁定，修改需克隆或进入新修订。 |

> **规则保持保证**：`evaluateSchemeConfirmation` 函数对外暴露的 `code` 字段**必须且只能**为上述 7 码闭集之一；具体的 `detail` 字段供 UI 与调试精准定位原因。若工作区有正在进行的流式编译或处于脏态，由前端确认事务第 1 阶段 `CLAIM_AND_QUIESCE` 静默挂起并等待，不产生业务拒绝码。

#### 4.7.5 AST、Markdown 工件与 ExecutionContract 三元哈希绑定与差异追溯

为实现「所见即所签，所签即所建」，系统建立**三元哈希完整性链条**（一致性 / 漂移检测，**不是**防篡改）。对齐 [ADR-0006](../adr/0006-local-first-no-tamper-proof.md)：本地优先，持有宿主写权限者可改任何本地文件与密钥材料——本机制只帮助诚实主体发现漂移，不宣称密码学不可伪造。

1. **确定性规范化渲染**：
   - `SchemeSnapshot` 基于 RFC 8785 键名排序计算规范化 SHA-256 摘要 $H_{ast}$；
   - 纯函数模板将 AST 序列化为五份 Markdown（00-04），在 Frontmatter 显式注入 `source_digest: H_ast`；
   - 提取五份工件文本组合计算工件集哈希 $H_{md}$。
2. **Contract 本地完整性附属（可选）**：
   - `ExecutionContract` 冻结记录 `scheme_ref: { revision, digest: H_ast }` 与 `artifacts_ref: { digest: H_md }`；
   - 签署时刻捕获底层 Git 树基线 `git_baseline_commit`；
   - Daemon **可**对包含上述哈希与安全 Scope（可写/只读/严禁路径、验证命令、预算）的载荷做 Ed25519 **本地附属签名**（证明「曾被该 Daemon 实例签署」）；**禁止**对外称作「防篡改签名」或「不可篡改」。
3. **差异检测与漂移告警**（非「篡改告警」升格）：
   - 磁盘文件的 `source_digest !== snapshot.digest` 时，判定文件过期，自动触发重新渲染；
   - 磁盘文件实际哈希与登记的 $H_{md}$ 不符时，说明工作区相对登记摘要已漂移，触发 `E_DIRTY_CONFLICT` 告警（诚实主体提示，非攻击证明）。

#### 4.7.6 错误码分层架构与不变量矩阵

为了保障前端工作台、Daemon 门禁与底层安全沙箱的职责绝对正交，系统严格实施**三层错误与拦截码分层**：
1. **方案确认门禁层（Scheme Gate）**：严格保持 v2.0.2 §1 D1 定义的 **7 个拒绝码闭集**（`E_SCHEME_ALREADY_FROZEN`、`E_SCHEME_CONFLICTS_OPEN`、`E_SCHEME_NOT_REVIEWABLE`、`E_DEMO_BUILDING`、`E_DEMO_FAILED`、`E_DEMO_CONFIRMATION_REQUIRED`、`E_DEMO_STALE`）。前端 UI 决策组件与 `evaluateSchemeConfirmation` 禁止返回任何闭集外的自定义错误码。
2. **Daemon 签署拦截层（Signing Gate）**：由 Daemon 在受理签署时校验，对应 HTTP 409/403 冲突（如快照缺失 `E_SCHEME_SNAPSHOT_NOT_FOUND`、代码基线漂移 `E_BASE_COMMIT_MISMATCH`）。
3. **运行时与安全拦截层（Runtime/Task Gate）**：由执行沙箱与安全网关执行，对应 Task 内部的 `failure_kind`（如 `SCOPE_VIOLATION`、`TIMEOUT`），记录于 `execution_record` 中，严禁回写污染 Scheme 门禁层。

| ID | 可验证不变量 | 必须拒绝的反例 | 拒绝时记录 |
| :--- | :--- | :--- | :--- |
| INV-S1 路径围栏 | 每个实际创建、修改、删除路径经统一规范化后必须匹配 Task 白名单且不得匹配只读/禁止规则；符号链接解析后的目标也须在围栏内 | 白名单只有 `src/components/**`，Worker 通过 symlink 写到 `.env.local`，或改 `package.json` | `SCOPE_VIOLATION`、规范化相对路径、操作类型；拒绝写入并终止/隔离任务 |
| INV-S2 操作权限 | CREATE/UPDATE/DELETE 分别受合同策略授权；创建数不得超过 `max_created_files`；路径规则不能仅依赖事后 diff | `allow_file_deletion=false` 时删除既有组件；超过创建数量限制 | `SCOPE_OPERATION_DENIED` / `FILE_CREATION_LIMIT` |
| INV-S3 预算 | Task 局部配额不得超过合同剩余额度；全局累计 diff、时间、重试与成本均不得超过合同上限 | Task 配额申报 900 行但合同仅剩 200 行，或运行超时仍继续写入 | `BUDGET_EXCEEDED` / `TIMEOUT`，拒绝后续执行与提交 |
| INV-V1 Demo 版本 | 若 Demo 非 `none`，签署必须要求其处于明确确认或显式降级状态；若绑定 revision 或 digest 任一不匹配，直接触发陈旧门禁 | rev 1 的 Demo 未重生成，方案已变更为 rev 2 仍签署；或修订号相同但内容摘要发生变更 | 门禁层严格返回 `E_DEMO_STALE`；内部审计记录 `stale_trigger` |
| INV-V2 方案快照 | Contract 的 `scheme_ref` 必须等于已冻结快照的 ID、revision、digest；存在 OPEN 冲突则拒绝 | 前端绕过门禁，直接向 Daemon 提交有 OPEN 冲突的方案 | 409，记录冲突 ID；不签署、不创建 Task |
| INV-V3 基线与凭证 | Contract 签署时捕获 `base_commit_hash`；Task 的 `base_commit` 必须相同，Task 合同签名必须匹配 Daemon 当前有效合同 | 合同基线为 `a1b2`，Task 要求从 `d4e5` 建 Worktree；或旧签名任务在合同撤销后提交 | `BASE_COMMIT_MISMATCH` / `CONTRACT_SIGNATURE_INVALID`，拒绝启动或回写 |
| INV-R1 成功证据 | `SUCCESS` 仅当合同要求的每条验证命令均有唯一结果且退出码等于要求值、变更在范围/预算内 | Worker 自称完成，但 `npm test` 退出码 1 或测试结果缺失 | 标记失败，不进入合并提案 |
| INV-R2 终态回写 | 非运行态必须有 `finished_at` 与 `execution_record`；中断/失败必须有闭集失败类型和说明；回写须带 task/contract/version 标识并幂等 | 越界任务只写状态 `FAILED`，无失败原因或任务 ID 对不上 | 拒绝回写，保留运行审计并告警 |
| INV-R3 清理 | 终态即吊销 Token；Worktree 依审阅/合并生命周期保留或清理，清理结果须可重试、可审计 | 任务失败后 Token 仍有效；或 UI 显示 PRUNED 但目录仍存在 | 拒绝伪终态/合并，标记清理失败并进入补偿流程 |

路径安全必须由 Daemon/Gateway 实际执行边界保障；仅靠 Prompt、glob 字符串校验或 Git commit hook 不构成硬拦截。日志摘要须脱敏，完整日志通过受控 artifact ID 访问，禁止把任意绝对路径暴露给模型或用户界面。

---

## 4. 确认事务的修订提案（原 v2.0.3 §5.2.1）

### 5.2.1 「确认方案」点击瞬间的原子动作链与失败补偿（钉死 · 防前端抢跑 / Daemon 409）

> **v2.0.3 修订约束**：本事务冻结的 Scheme 必须以 `scheme_id + revision + digest` 入快照；签署时同时捕获仓库基线 `base_commit_hash`。Task 只能引用该快照、有效合同签名与同一基线（详见 §4.7）；任何不一致均在 Daemon 侧拒绝。

用户点击「确认方案」后，系统在带幂等键 `confirmation_id` 的事务协议下，**分五阶段原子执行（严格对齐 v2.0.2 D3 事务阶段代码）**：

```
阶段 1: CLAIM_AND_QUIESCE ────夺取并发排他锁，静默并冻结右栏输入流式
   │
阶段 2: VALIDATE_CONFIRMATION ─对静默版本复核 evaluateSchemeConfirmation 7 码闭集
   │
阶段 3: FREEZE_SNAPSHOT ──────方案标记 FROZEN，纯函数渲染五份 Markdown 落盘
   │
阶段 4: SIGN_AND_PREPARE ─────编译 Contract，注入双哈希，Daemon 签名（失败标记 VOID）
   │
阶段 5: COMMIT ───────────────挂载 Worktree 并派发 Worker（失败允许阶段 5 原地安全重试）
```

#### 逐阶段失败场景、回滚边界与补偿协议

| 事务阶段 (D3 代码) | 对应业务动作 | 潜在失败场景 | 损坏边界 | 补偿与回滚策略（All-or-Nothing） |
| :--- | :--- | :--- | :--- | :--- |
| **阶段 1：CLAIM_AND_QUIESCE** | 生成 `confirmation_id`，获取排他锁，静默输入流 | 前端处于高频输入状态，或 Supervisor 正在异步生成 AST。 | 仅前端/内存态。 | **立即可逆**。若无法获得锁则提示稍候重试；不改变 Scheme 任何字段与状态。 |
| **阶段 2：VALIDATE_CONFIRMATION** | 对当前静默快照求值 `evaluateSchemeConfirmation` | 存在未裁决的 BLOCKER OQ、无负向断言、或 Demo 未确认/已陈旧。 | 仅内存态。 | **立即可逆**。释放排他锁，恢复流式交互，弹窗展示 7 码闭集拒绝原因，零副作用。 |
| **阶段 3：FREEZE_SNAPSHOT** | 方案 `status = 'FROZEN'`，落盘 JSON 快照与五份 Markdown | 磁盘只读、存储不足、渲染进程意外中断。 | 磁盘存在半写入临时工件（`.tmp`）。 | **物理回滚**。清理未完成的 `.tmp` 临时文件；方案状态恢复为 `REVIEWING`，释放排他锁。 |
| **阶段 4：SIGN_AND_PREPARE** | 生成 Contract，注入双哈希绑定，Daemon 私钥签名 | 密钥未就绪、预算解析失败、Daemon 存储异常。 | 存在残损未签名的 Contract 记录。 | **作废合同（VOID）**。将残存 Contract 状态标记为 `VOID` 归档并持久化 `void_reason`，吊销已生成预凭证；方案恢复为 `REVIEWING`。 |
| **阶段 5：COMMIT** | 挂载 `git worktree` 隔离目录，启动 Worker 进程 | 磁盘 Git 冲突、Worker 进程启动失败、并发超限。 | 存在空 Worktree 目录和未消费任务。 | **清理与安全重试**。执行 `git worktree remove --force` 清理隔离目录；Contract 保持 `SIGNED` 状态，**允许用户直接原地重试派发，无需重新审阅或重新签名方案**。 |

**安全重试保障**：全局事务由 `confirmation_id = sha256(scheme_id + revision + digest)` 严格幂等保护。若失败发生在阶段 5，因前序 Contract 与工件已锁定并签名，重试时**直接从阶段 5 原地恢复**，绝不要求用户重新确认方案，杜绝破坏已冻结的需求基线。

---

## 5. 已裁决不采纳项 · `confirmation_id` 内容派生式（留档备选）

原 v2.0.3 §5.2.1 末段提出：

> **安全重试保障**：全局事务由 `confirmation_id = sha256(scheme_id + revision + digest)` 严格幂等保护。若失败发生在阶段 5…重试时**直接从阶段 5 原地恢复**。

**不采纳理由（裁决 D-1）**：

1. 它与现行 `TASK-C.22` 验收矩阵中的 **I-02「同 `confirmation_id` + 换修订 → `E_CONFIRMATION_ID_REUSED`，不签署」**（测试 `T-ATOM-003`）**直接互斥**。内容派生式下，"换修订"必然产生不同的 id，该用例**永远无法触发**，等于静默废除一条已通过的负向防线。
2. 现行实现（`src/lib/journey/confirm-scheme-atomic.ts` + `daemon/pipeline/scheme-snapshot-store.ts`）已按「前端生成 + 同修订复用」落地并有 22 处引用，改动面大于收益。
3. 「阶段 5 原地安全重试」这一**目标**仍然成立且有价值——它可以在不改动 id 生成方式的前提下，通过复用同一个 id 重放实现。**这部分目标值得在 v0.2 立项时单独提取。**

---

## 6. 权威指针

| 主题 | 权威文件 |
| :--- | :--- |
| 现行 Supervisor SSOT | [`../specs/supervisor.md`](../specs/supervisor.md) |
| 运行时硬契约 | [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md) |
| v0.2 多 Agent 流水线 | [`./v0.2-multi-agent-pipeline.md`](./v0.2-multi-agent-pipeline.md) |
| 工件模板脚手架 | [`../templates/`](../templates/)（**非当前施工依据**） |
| 终态口径 | [`../adr/0012-merged-as-terminal-state.md`](../adr/0012-merged-as-terminal-state.md) |
