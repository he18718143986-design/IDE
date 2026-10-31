# Stagent 系统架构设计规范（架构宪法）

> **定稿基线版本**：**v1.6.1**（Code Alignment & Specification Final Edition）
> **命名约定（2026-10-27 文档治理）**：文件名不含版本号；版本流转交由 **Git Tag 与 commit 历史**承载。本文对应基线 commit `4280de6`（2026-10-24）。
> **文档地位**：本文件与 [`development-tasks.md`](./development-tasks.md)、[`supervisor.md`](./supervisor.md)、[`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) 共同构成 Stagent 现行规范四件套。
> **版本**：v1.6.1 (Code Alignment & Specification Final Edition)  
> **状态**：架构演进与工程实施定稿基线（经四轮架构与代码事实对照评审闭环，确立代码基线与目标数据模型边界，状态机合法边与迁移防御完全闭环）  
> **基线代码对照**：`daemon/`、`src/lib/contract.schema.ts`（当前代码基线为 Schema v1.2.0，目标模型 v1.3.0 显式归入 §10 路线图 P0.2c 阶段）、`src/lib/evidence.schema.ts`、`src/lib/state-machine.ts`、`tests/unit/state-machine-matrix.test.ts`  
> **修订核心目标**：严格对齐代码实现事实与目标架构演进路线；闭环 Fast Path 状态机流转（杜绝跳过 `PREPARING`，规范熔断两步法为升版挂起，杜绝非法逆向边）、收敛数据迁移白名单并确立“零静默授权”不变式、彻底根除 AST 模糊术语、在类型系统层面彻底剥离 Supervisor 提案运行态字段、强化挂起恢复自愈与外部改码级联降级门禁，确立生产级落地与迁移工程规范。
> **2026-10-28 口径补充**：C-3（§0.2.3.1 Worktree 例外指针）、C-4（§6.4 D-3 白话二选）、C-5（§6.4 D-1 计数口径）已拍板，依据 supervisor 第三部分 §16.11 与审计台账。本次为裁决落笔，未改变基线版本号。上一轮审计漏网的「低置信度降级」旧口径已按 supervisor §16.7 修正（consistency-audit OP-20）。
> **2026-10-29 角色口径指针（文档治理加注，不改条款）**：本文 §0.2 步骤一「交互载体：右栏智能助手（Supervisor）」、§1 拓扑「Coding Worker / Supervisor 澄清会话」、§2.1「用户与 Supervisor 的自然语言交互流」把右栏写成 Supervisor 或 Worker，均为旧口径。现行三 Agent 分工：右栏 = 只读 AI 搭档，中栏 = Supervisor 方案画布，Worker = Worktree 施工，以 [`supervisor.md`](./supervisor.md) §13.2 与 [`../scheme.md`](../scheme.md) §3 为准；未决分歧见 `scheme.md` §7。

---

## 0. 产品定义、首版用户流程与功能边界 (Product Contract)

### 0.1 产品定位与目标用户

Stagent 是面向**非技术业务用户、独立开发者与外包工程师**的受控编程桌面环境。其核心理念是：**将 AI 编码过程从黑盒式的“盲目试错”转变为透明、受控、渐进点亮且具备双向反思自查能力的确定性工程交付**。

- **产品定位演进**：项目最初立足于为专业开发者提供可信控制面（ADR-001），随着自然语言交互与可视化界面的成熟，v1.5.0 起全面升级为兼顾非技术业务人员的产品形态。非技术用户无需理解 Git 内部机制、终端命令或复杂的架构分层，只需通过右栏自然语言交流、中栏体验 Mock 原型、直观查看任务拓扑由灰变绿的点亮过程，即可完成软件功能的交付与验收。
- **核心差异化价值**：
  1. **Demo-First 原型先行**：在真实代码实施前，先提供轻量、快速反馈的静态交互原型（Mock Demo），杜绝“聊完需求直接写出一堆无法运行的废代码”；
  2. **工程拓扑渐进点亮**：将复杂系统拆解为业务功能树与任务 DAG，以真实的物理构建与验证证据驱动节点从灰到绿点亮，提供无门槛的施工透明度；
  3. **质疑自查与责任归属机制**：当成果不及预期时，非技术用户无需陷入与 AI 的语义争吵，Supervisor 会自动对照原始意图、已批准需求与实际代码 Diff，出具基于证据的归因建议；
  4. **全生命周期增量演变**：业务变更时，直接在原有需求文档与原型上做增量 Diff 打补丁，保持单一事实源与资产连续性。

---

### 0.2 v0.1 核心用户流程（八步标准产品旅程）

> **⚠️ 用户旅程已由 Supervisor SSOT 取代（2026-10-27）**：本节「八步旅程」描述的是 Demo 必经、多视口切换的旧产品形态。现行旅程以 [`supervisor.md`](./supervisor.md) 为准：Demo 可选（ADR-0010）；中栏是单页「方案工作台」，按「方案 → 施工 → 试玩 → 已合入」四幕推进（第三部分 §13、§16）；需求快照落在 `.stagent/drafts/schemes/`（§7 D3）。本节保留的工程约束（物理证据点亮、双门禁、增量变更）继续有效；与 SSOT 冲突的交互描述（「确认原型并实施真实工程」按钮、视口自动切换、顶部合入按钮等）**不再作为施工依据**。

标准产品旅程定义非技术用户完成一次完整功能交付的标准生命周期：

```text
[1. 右侧探讨需求] ──(实时生成需求草案)──> .stagent/specs/requirements.md
        │
        ▼
[2. 原型试玩确认] ──(独立Origin静态预览)──> 中栏 Studio Demo 试玩 (配置 iframe sandbox)
        │
        ▼ (满意并点击“实施真实项目代码”)
[3. Graph 工程拆解] ──(功能树+任务DAG)──> .stagent/specs/task_graph.json (全灰拓扑)
        │
        ▼
[4. 真实代码实施] ──(物理证据驱动点亮)──> 节点由灰变绿 (写入成功 + 验证退出码0 + 变更指纹)
        │
        ▼
[5. 真实环境验收] ──(双门禁拦截)────────> 真实预览体验 (真机环境与客观证据全绿)
        │
   ┌────┴────────────────────────┐
   ▼ (体验无误)                   ▼ (成果存疑)
[交付合入]                [6. Supervisor 质疑自查]
(Squash Merge)             · 比对: Prompt vs Spec vs Diff
                           · 判定: 范围内核验返工 / 增量需求演化
                                  │
                                  ▼
                          [7. 增量需求增删与原型演化]
                           · 原 requirements.md 增删条目
                           · 原 Demo 打补丁增量修改
                                  │
                                  ▼
                          [8. 原型确认与循环实施] ──> 回到步骤 3/4
```

#### 步骤一：右侧自由澄清与需求梳理（Requirements Exploration & Spec Generation）

- **交互载体**：右栏智能助手（Supervisor）。用户完全使用非技术自然语言表达想法。
- **系统行为**：Supervisor 通过多轮对话主动提炼用户意图，消除核心歧义；在后台生成结构化《产品需求规格提案》（`IntentProposalV1`），由 Daemon 校验后原子写入 `.stagent/specs/requirements.md`。
- **左栏联动**：左侧文件树规范资产区高亮提示 `requirements.md` 正在更新，用户可随时点击查看排版清晰的白话方案。

#### 步骤二：原型试玩与体验确认（Demo-First Prototype & Mock Preview）

- **交互载体**：中栏 Studio「原型试玩视口 (Demo Preview)」。
- **安全边界与隔离规范**：Supervisor 生成静态前端页面代码（HTML/JS/CSS 与 Mock 数据），经 Daemon 受控落盘后，由 Daemon 启动独立 Origin 预览服务。视口采用 `iframe sandbox="allow-scripts"`（**绝对禁止 `allow-same-origin`**），配置严格 CSP 彻底阻断连接 Daemon 端口（详见 §4.6）。明确声明：Demo 视口为跨源静态产物展示，不具备操作系统级沙箱与网络隔离能力。
- **用户心智**：用户可点击按钮、输入表单、体验组件联动。若不符合心意，在右栏继续交流修改；若符合心意，点击中栏顶部【确认原型并实施真实工程】。

#### 步骤三：Graph 工程拆解与可视化编排（Task Graph Decomposition & Visual DAG）

- **交互载体**：中栏 Studio「任务拓扑看板 (Task Graph)」。
- **系统行为**：原型获批后，Supervisor 产出《任务图拓扑提案》（`TaskGraphProposal`），Daemon 校验后原子落盘为 `.stagent/specs/task_graph.json`。中栏自动展开两层视图：
  1. **业务功能思维导图 (Mind Map)**：展示系统由哪些业务模块与特性构成；
  2. **任务执行拓扑图 (Task DAG)**：展示系统被拆解为哪些顺序工程任务，所有节点初始均为未完成的**灰色状态**。
- **资产留存**：左侧文件树规范资产区同步挂载 `task_graph.json` 与初始执行合同 `contract_v1.json`。

#### 步骤四：真实代码实施与拓扑渐进点亮（Implementation & Progressive Illumination）

- **交互载体**：左栏文件树 + 中栏 Task Graph 拓扑看板。
- **调度纪律**：v0.1 严格限制在单任务工作树中**按拓扑序串行执行**（并行度 = 1）。
- **渐进点亮充要条件（物理证据驱动）**：  
  节点点亮不依赖模型声称，亦不要求每节点单独生成 Git Commit（避免后续 Squash Merge 导致 SHA 断裂），而是必须同时满足三项确定性物理证据：
  1. 节点声明的目标文件已成功写入任务 Worktree；
  2. 节点关联的验证命令子集（`applies_to_node_ids`）执行完成且退出码必须为 0；
  3. Daemon 成功计算并持久化该节点的变更集指纹（`node_patch_fingerprint`）。
- **用户可见变化**：中栏 Task Graph 节点逐个由暗灰变为常绿，左栏文件树实时刷新出实际代码文件。

#### 步骤五：真实环境体验与交付验收（Real Experience & Dual-Gate Delivery）

- **交付门禁（双门禁拦截）**：
  1. **Gate 1（主观试玩门禁）**：Daemon 在受控端口拉起真实项目服务，中栏展示真实运行环境；
  2. **Gate 2（客观证据门禁）**：机器验证证据包（`evidence.json`）必须全绿，候选 SHA 必须匹配，合并前 Scope 校验确保越界变更 100% 可被检出并阻断。
- **用户决策**：两道门禁全部通过后，顶部【确认合入主干】按钮高亮可用。用户体验无误即可一键交付（执行 Squash Merge 并归档审计元数据）。
- **第一反应速记（规格态 ⏳）**：Gate 1 试玩呈现后、用户决定前的不阻断时效输入，规格见 [`supervisor.md`](./supervisor.md) §13.3 第 5 条之后的前置说明；本步骤不另行定义。

#### 步骤六：Supervisor 质疑自查与责任判定机制（Supervisor Dispute & Root-Cause Protocol）

- **触发场景**：用户在真实试玩中发现功能缺失或报错，无需与 AI 争吵代码细节，点击【我有疑问/成果不符】发起质询。
- **三方比对引擎**：Supervisor 自动抓取三方基线事实数据源：
  - 数据源 1：用户原始 Prompt 意图与右栏对话流；
  - 数据源 2：已批准的 `requirements.md` 与合同范围；
  - 数据源 3：实际生成的代码 Diff、运行时错误日志与 Evidence 证据。
- **责任判定规则与置信度治理**：
  - **建议性推断**：自查结论为带有置信度（`confidence: 0.0–1.0`）的推断建议，严禁宣称为“绝对不可推翻的客观真理”；
  - **置信度阈值**：设定默认阈值 0.7。当 `confidence >= 0.7` 时出具明确倾向：
    - **判定 A (实现偏差 Bug)**：需求明载但代码遗漏或出错，由系统进行免费定向修复；
    - **判定 B (需求变更 Drift)**：原需求未涉及或用户推翻了原设定，引导进入增量演变流程；
  - **低置信度降级 (D-3 出口)**：当 `confidence < 0.7` 时，系统不出具单方断言，在中栏客观呈现三方差异事实，并向用户提一个业务澄清问题（口径以 supervisor §16.7 为准，不再让用户点选“按缺陷修复 / 按新需求演进”）。
- **修复越权确定性子集检查**：判定为实现偏差自动派发修复任务时，Daemon 必须核验修复目标文件与命令集是否严格属于原合同 Scope 的**确定性子集**。若超出原授权范围，必须强制走合同升版重批流程，禁止 Supervisor 隐式扩权。

#### 步骤七：增量需求增删与原型演化（Incremental Spec Diff & Demo Evolution）

- **演变准则**：
  1. **Spec 增量修补**：在 `.stagent/specs/requirements.md` 原文上以 `[v1.1 Added]` 标记增删条目，统一携带 `change_request_id`；
  2. **Demo 原型增量打补丁**：在原有 Demo 代码上打补丁修改，中栏视口热刷新，先给用户看修改后的静态原型；
  3. **合同差异升版**：生成 `Contract v2` 差异授权，提示用户确认新增范围。

#### 步骤八：原型确认与循环实施（Confirmation & Iteration Loop）

- 用户确认新原型后，Task Graph 追加新任务节点（初始全灰），Worker 在任务工作区增量施工并按物理证据点亮新节点，直至最终无误交付。

---

### 0.2.3 分级自适应准入与轻量通道（Adaptive Admission & Fast Path）

为避免非技术用户在微调场景（如改文字、调颜色）下被繁琐审批打断，系统提供风险分级准入机制：

| 任务类型                       | 判定准则 (L0 确定性规则)                                           | 准入模式与审批要求                                                                                                | 审计与可逆性保障                                                                                                               |
| -------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **轻量修改 (Fast Path)**       | 单文件变更 ∩ 纯视觉/文案白名单后缀 ∩ 无执行命令 ∩ 无依赖增减 ∩ 未命中保护清单 ∩ VIBE 自由模式 | **系统自动准入**：Daemon 自动注入系统审批凭证 (`creator: "system:fast-path"`)，状态机由 `DRAFT` 直通 `EXECUTING`，跳过静态原型与图编排，直接施工 | 签发合同记录 `admitted_policy_decision: "ADMITTED_AUTOMATIC"` 完整留痕，自动生成 Checkpoint 快照，支持用户一键无损撤销；若发生多文件写入或越界越权，立即熔断回退至标准审批流程 |
| **标准功能开发 (Standard Path)** | 涉及 2–5 个业务文件或包含组件交互，未触碰敏感资产                               | **标准八步旅程**：右栏澄清 ➔ Demo 体验 ➔ 原型显式获批 ➔ Graph 编排施工 ➔ 试玩合入                                                   | 必须用户显式批准原型与方案，注入 `approval` 审批实体，完整 Evidence 留痕                                                                        |
| **高风险变更 (High-Risk Path)** | 命中 `.stagent/protection.json`、改动认证/支付/数据库、或引入外部网络与依赖      | **强门禁单项审批**：弹出专用安全风险卡，逐项列出影响范围与操作命令                                                                      | 必须用户明确勾选授权，生成细粒度授权实体，禁止任何形式的静默放行                                                                                       |

#### 0.2.3.1 Fast Path 状态机流转与安全熔断规约 `[v1.6.1 闭环 C-02]`

> **⚠️ 交互已改判（Supervisor SSOT 第三部分 §16.11 · D10）**：小改动**不得**从聊天里静默开工。中栏以「小改动」精简卡呈现，用户点「直接改」后才开工；PROTECTED 模式下同样可用（仍在 Worktree 中施工）。下文的状态边（`DRAFT → PREPARING`）与越界熔断规则继续有效。
>
> **⚠️ Worktree 例外（Supervisor SSOT 第三部分 §16.11 · C-3 已拍板）**：免 Worktree 仅限非生产产物（Demo 展示代码、图标/素材、`.stagent/` 内方案文档）；会进入可执行工程的生产代码（`src/`、`daemon/`、工具链产物）必须走 Worktree。下文第 2 条的 Worktree 要求对生产代码有效。

1. **自动准入与审批注入**：  
   当用户请求满足 Fast Path 判定准则时，Daemon 自动构建轻量合同并注入合法的系统审批实体：
   ```json
   "approval": {
     "status": "APPROVED",
     "approved_by": "system:fast-path",
     "approved_at": "2026-10-23T01:00:00.000Z",
     "approved_contract_revision": 1,
     "admitted_policy_decision": "ADMITTED_AUTOMATIC",
     "decision_notes": "Fast Path: 单文件低风险样式/文案微调，系统自动核准执行"
   }
   ```
2. **状态流转与环境初始化闭环 (C-02)**：  
   合同生命周期严禁直跳 `EXECUTING`，必须遵循物理环境初始化流程：
   - 底层状态机新增合法条件边：`DRAFT → PREPARING`，Guard 条件为 `approval.approved_by === "system:fast-path" && contract.intent.risk_level === "LOW"`；
   - 随后由 Daemon 自动化执行 Worktree 创建与保护清单挂载，平滑进入既有合法边 `PREPARING → EXECUTING`；
   - 面向非技术用户的 UI 展示层实现感知穿透：从 `EXPLORING` 毫秒级直接平滑过渡为 `EXECUTING`（正在施工），无需用户手动点击“确认方案”弹窗，跳过静态 Mock Demo 生成与复杂任务 DAG 解构。
3. **施工越界安全熔断机制 (C-02)**：  
   在 Fast Path 执行期间，Scoped MCP Gateway 与文件监视器保持最高敏感度：
   - 若 Worker 试图创建或写入第 2 个文件，或触碰非白名单后缀文件；
   - 或试图发起外部命令执行 / 网络请求；
   - **规范熔断两步法（杜绝非法逆向边）**：
     1. Daemon 立即强制中止当前 Worker 子进程，合同底层状态机通过合法边跃迁为 `PENDING_RESUME`，附带挂起原因码 `suspend_reason: "FAST_PATH_BREACH"`；
     2. Daemon 自动触发合同升版机制（Contract v2），将 v2 置为 `PENDING_APPROVAL`，`approval.status` 设为 `PENDING_REVIEW`，清理当前微调 Worktree；
     3. 面向用户展示状态原子切换为 `NEEDS_APPROVAL`，并弹出提示：“检测到本次修改超出了轻量微调范围，已自动为您升级为标准审批流程，请确认扩展的影响范围并授权”。

---

### 0.2.4 六条核心支线流程（Alternative Flows, Alt-Flows）

八步旅程为 Happy Path，系统必须完备覆盖以下 6 条工程支线：

1. **A1：项目/仓库初始化引导 (Repo Initialization Flow)**
   - **触发**：当前打开目录非 Git 仓库，或为空工程。
   - **处置**：右栏给出温和提示：“检测到当前项目尚未建立版本保护，Stagent 正在为你进行安全初始化”。Daemon 自动执行 `git init`，并创建初始 `.stagent/` 目录结构与 `.gitignore` 规则，随后才允许进入步骤一。
2. **A2：用户外部手动改码与证据失效联动 (External Modification & STALE Flow) `[v1.6.1 闭环 C-08]`**
   - **触发**：施工期间或验收期间，用户在外部编辑器（如 VS Code）直接修改了工作区或主分支文件。
   - **处置与级联降级不变式 (C-08)**：
     - 文件 Watcher 捕获外部写入事件，定位受影响的 Task Graph 节点，将其状态置为 `STALE_REVERIFY`（琥珀黄待重验态）；
     - **合同级联降级强约束**：无论当前合同处于何种状态（包括已通过自动化检查与真机验证的 `AUDITED`），只要 Task Graph 产生至少 1 个 `STALE_REVERIFY` 节点，Daemon 必须在同一事件循环周期内，**原子将合同 `lifecycle_state` 强制降级为 `VERIFYING`**，将既有 Evidence 标记为 `status = "STALE"`，并将持久化 `presentation_state` 切换为 `VERIFYING`；
     - 前端【一键合入】按钮立即置灰并切换为重验等待态，防止并发点击触发穿透；提示用户：“检测到代码在外部被修改，正在对受影响功能重新进行检查”。
3. **A3：预览服务启动失败降级 (Preview Failure & Diagnostic Flow)**
   - **触发**：步骤二（Demo）或步骤五（真机）预览服务启动抛错（如端口被占、缺少宿主依赖、编译报错）。
   - **处置**：系统不得静默吞掉异常，亦不得将外部服务异常误判为代码验证失败 `FAILED`。系统遵循状态机安全中断规则：合同生命周期保持/安全回退至 `PENDING_APPROVAL`，`approval.status` 原子回置为 `PENDING_REVIEW`（阻断静默施工）；中栏视口展示友好诊断面板，提供【自动释放端口】、【安装必要依赖】或【重试启动服务】操作入口。
4. **A4：用户主动放弃与工作区彻底清理 (User Abort & Clean-up Flow)**
   - **触发**：用户在施工或体验任意阶段点击【放弃本轮修改，推倒重来】。
   - **处置**：Daemon 发起终止流程，强制清理任务 Worktree 并释放文件锁；主分支保持 100% 干净无污染，历史 `.stagent/specs/` 中记录 `ABORTED` 归档标记。
5. **A5：预算耗尽与熔断挂起 (Budget Exhaustion & PAUSED Flow)**
   - **触发**：Token 消耗、工具调用次数或单任务耗时达到合同上限。
   - **处置**：任务立即挂起，进入 `PAUSED`（已暂停）状态；中栏展示已消耗额度与明细，明确提示两个操作：【追加预算继续施工】（触发合同重批）或【放弃本次任务】（清理退出）。
6. **A6：外部副作用不可回滚核查 (Side-Effect Verification Flow)**
   - **触发**：用户放弃任务或终止施工时，检查历史日志中是否执行过带有外部副作用的命令（如写入远程数据库、调用第三方 API）。
   - **处置**：清理代码的同时，中栏明确提示：“代码已安全撤销，但检测到执行过以下可能影响外部环境的操作：[列表]，请人工确认外部服务状态”，严禁谎称所有外部状态均已自动回滚。

---

### 0.3 v0.1 功能边界与支持矩阵

#### 功能边界定义

- **In Scope (必须具备)**：
  - 本地 Daemon 作为唯一受控仲裁面，单工作区互斥执行；
  - 八步用户旅程闭环，含静态 Demo 原型展示与 Task Graph 渐进点亮；
  - 独立 Origin + iframe sandbox 隔离的 Demo 预览服务；
  - 物理证据驱动的节点点亮机制（写入 + 验证退出码 0 + 节点指纹）；
  - Supervisor 质疑自查三方比对引擎与置信度降级机制；
  - 单任务 Git Worktree 隔离与合并前双门禁；
  - 全局保护清单（`.stagent/protection.json`）与确定性 Fast Path 边界；
  - 15 状态映射与防死锁超时看门狗。
- **Out of Scope (v0.1 不做，留待 v0.2+)**：
  - 多任务并行 Worktree 编译流水线（RFC-2026-002）；
  - 将普通 OS 子进程宣称为强对抗性安全容器（不可行）；
  - 跨物理机远程协同编辑；
  - 替代 IDE 深度语言服务（LSP）基础设施。

#### v0.1 支持矩阵与降级策略

| 维度        | 官方支持与验证基线 (Tier 1)                                               | 兼容支持 (Tier 2)                     | 不支持/降级策略                          |
| --------- | ---------------------------------------------------------------- | --------------------------------- | --------------------------------- |
| **操作系统**  | macOS (Darwin arm64 / x64), Linux (Ubuntu 22.04+ x64)            | Windows 11 (x64, 经 Job Object 托管) | 其他 Unix 发行版降级为通用 POSIX 模式         |
| **包管理器**  | `pnpm` (>= 8.0)                                                  | `npm` (>= 9.0), `yarn` (classic)  | `bun` / `deno` 暂不提供专用缓存隔离，降级为常规安装 |
| **语言与框架** | TypeScript / JavaScript, Node.js (>= 18), React / Next.js / Vite | Vue / Svelte, Python (基础验证)       | 暂不支持 Java/Go/Rust 多模块工程的专用语法分析    |
| **验证命令**  | `tsc --noEmit`, `vitest`, `jest`, `eslint`                       | 自定义 shell 测试脚本                    | 无验证命令工程降级为 `MANUAL_REVIEW` 人工点亮   |



---

### 0.4 产品成功与首版验收原则

1. **真实可信原则**：进度、节点点亮、服务状态与安全门禁必须 100% 映射底层真实物理事实。严禁由模型直接设定状态或编造假点亮。
2. **意图与授权分离原则**：用户确认需求方案不等于批准所有破坏性权限。标准通道必须显式批准；Fast Path 必须以系统留痕与 Checkpoint 撤销为底线。
3. **安全诚实原则**：不把 Worktree 宣传为 OS 级沙箱，不把本地 JSON 宣传为防篡改不可逆审计，不把普通子进程拦截宣传为对抗性容器。
4. **确定性权威原则**：Daemon 是系统唯一单一权威，负责裁决状态跃迁、写盘控制与合并门禁，模型仅有提议权，无裁决权。
5. **用户责任边界原则**：技术审计责任必须留在系统内部，不得下推给非技术用户。

> **用户责任边界**：非技术用户的责任是确认业务意图、体验试玩 Demo、对敏感提权进行审批，以及决定是否接受交付；严禁将检查 Contract JSON、Git 哈希或测试退出码等底层技术审计责任转嫁给普通非技术用户。界面仅呈现白话业务范围、体验效果与确定性通过结论。

---

### 0.5 产品决策验收矩阵与失败判据

| 维度 | 验收通过标准 (Pass Criteria) | 致命失败判据 (Kill Criteria) |
|---|---|---|
| **Demo 隔离** | Demo 运行在独立 Origin；配置 `iframe sandbox="allow-scripts"`（无 `allow-same-origin`）；禁止直连 Daemon | Demo 运行在同源上下文；Demo 内 JS 能调用 Daemon 本地 API 或窃取 localStorage |
| **状态一致性** | 15 状态映射表中每个 lifecycle 均存在于底层枚举；状态投影不变式 CI 测试 100% 通过 | 出现未定义枚举值；出现 `DRAFT/APPROVED` 等非法状态组合；状态死锁无出口 |
| **节点点亮** | 节点点亮必须绑定文件落盘 + 验证退出码 0 + 节点指纹三项物理证据；Squash 后审计完整 | 仅凭模型输出即点亮；Squash 后出现断裂的悬空 commit 引用 |
| **越权防护** | 实现偏差自动修复严格限制在原合同 Scope 子集内；超出子集强制升版重批 | Supervisor 或 Worker 借由返工名义修改 Scope 外文件或执行未授权命令 |
| **自查责任** | 质疑自查报告携带置信度；`confidence < 0.7` 自动降级为呈现三方事实由用户裁决 | 模型武断判定并强制用户接受错误归因；自查看门狗超时挂死 |

---

### 0.6 执行模式、保护清单与冲突仲裁规则

> **架构完整性说明**：本节为 Stagent 权限控制核心基线，完整内联原规范引用条款，终结悬空引用。

#### 0.6.1 执行模式（VIBE vs PROTECTED）
- **VIBE 模式（自由体验模式）**：面向探索性原型设计。允许 Worker 在主工作区直接读写（配置 Auto-Checkpoint 自动快照）；遇到非保护资产变更不弹窗打扰；但必须接受 Scoped Gateway 的路径与命令白名单拦截。
- **PROTECTED 模式（受保护工程模式，默认）**：面向生产级代码开发。强制 `use_worktree: true`，所有代码修改严格在独立隔离工作树中进行；涉及保护清单的任何改动必须显式授权；必须通过双门禁方可合入。

#### 0.6.2 全局保护清单 (`.stagent/protection.json`)
由用户或仓库管理员配置的不可侵犯资产边界，任何模式下均生效：
```json
{
  "protected_paths": [
    ".stagent/contracts/**",
    ".stagent/protection.json",
    ".env*",
    "**/*secret*",
    "**/*credentials*",
    ".git/**"
  ],
  "forbidden_commands": [
    "rm -rf /",
    "git push --force*",
    "git reset --hard*",
    "npm publish",
    "curl * | sh"
  ],
  "require_explicit_approval_paths": [
    "prisma/schema.prisma",
    "migrations/**",
    "package.json"
  ]
}
```

> **边界与受信豁免说明**：保护清单（`protection.json`）是 Scoped Gateway 针对 Worker（编码 Agent）文件写入与命令执行的强制边界，任何越界操作均被 Gateway 物理拦截；Daemon 自身受信任的基础设施操作（如执行 `git stash create` 生成快照 Checkpoint、调用 Git 原生命令管理任务 Worktree、写入 `.stagent/contracts/` 合同草案）属于特权控制面行为，不受 Agent 级 Gateway 保护清单拦截。

#### 0.6.3 User-First Discard 冲突仲裁规则
当发生工作区锁冲突（`E_WORKSPACE_LOCKED`）或并发冲突时，严格遵循**用户第一原则**：
1. 用户的本地手动修改（包含编辑器未保存缓冲区）拥有最高优先级，系统绝对禁止以任何自动化手段强制覆盖用户未提交修改；
2. 检测到外部冲突时，暂停 Agent 执行并给出清晰白话提示，由用户选择【以我的修改为准并覆盖任务】、【重基并重新测试任务】或【保留任务在工作树中供手动比对】。

---

### 0.7 可量化的非功能属性与验收方法 (NFR Matrix)

| 质量属性 | 指标名称 | 目标值 (Target) | 测量方法与采样环境 | 目标验收命令 / 测试文件 (含实现状态标注) | 失败判据 |
|---|---|---|---|---|---|
| **性能** | 交互首 Token 延迟 | P95 ≤ 1.0s | 本地 loopback 环境，用户发送消息至前端收到第一帧 delta | `tests/perf/stream-latency.test.ts` `[待建 - 归属 P1]` | 首 token > 1.5s |
| **性能** | 用户打断响应时延 | P95 ≤ 2.0s | 发送打断请求至进程收到 SIGTERM 并确认停止 | `tests/perf/abort-latency.test.ts` `[待建 - 归属 P1]` | 停止响应 > 3.0s |
| **性能** | Graph 渲染帧率与时延 | ≤200 节点拓扑，P95 渲染 < 200ms | 模拟 200 个节点 DAG 全量推送到前端 DOM 挂载完成 | `tests/perf/graph-render.test.ts` `[待建 - 归属 P4.5]` | 渲染阻塞 > 500ms 或丢帧 |
| **性能** | WebSocket 事件吞吐 | ≤ 50 事件/秒无背压与内存泄漏 | 连续高频广播节点状态更新 60 秒 | `tests/perf/ws-backpressure.test.ts` `[待建 - 归属 P3.7]` | 内存上涨 > 50MB 或 WS 断连 |
| **可用性** | Daemon 崩溃重启恢复 (RTO) | ≤ 5.0s，状态 100% 自愈 | 施工中注入 `kill -9` 杀死 Daemon，重启读取持久化快照恢复 | `tests/e2e/daemon-crash-recovery.test.ts` `[待建 - 归属 P1]` | 恢复超时或状态不一致 |
| **可扩展性** | v0.1 并发合同执行数 | **严格限制 = 1** | 多请求并发尝试获取执行锁，验证排队与互斥 | `tests/unit/workspace-lock.test.ts` `[待建 - 归属 P0]` | 出现双 Worktree 并发写入 |
| **安全性** | Demo 跨源访问防御 | **100% 阻断** | Demo 内脚本尝试 `fetch('http://127.0.0.1:<daemon_port>/api')` | `tests/security/demo-sandbox-xorigin.test.ts` `[待建 - 归属 P4.5]` | HTTP/WS 请求成功返回 200 |
| **安全性** | 越界文件写入检出率 | **100% 检出并阻断** | Worker 绕过 Gateway 修改 Scope 外文件后请求合并 | `tests/security/scope-escape-detection.test.ts` `[待建 - 归属 P2]` | `can_merge` 被置为 true |
| **安全性** | 状态矩阵不可变式守护 | **100% 阻断非法跃迁** | 运行全量生命周期矩阵与审批状态单向跃迁校验 | `tests/unit/state-machine-matrix.test.ts` `[已实现，受 CI 守护]` | 允许非法跃迁组合 |
| **可维护性** | 结构化日志保留与轮换 | 单文件 ≤20MB，保留最近 5 份 | 模拟大量运行日志输出，验证日志切分机制 | `tests/unit/logger-rotation.test.ts` `[待建 - 归属 P1]` | 日志无限制膨胀撑爆磁盘 |

> **落地阶段说明**：上表中除 `tests/unit/state-machine-matrix.test.ts` 为当前代码库已实装且受 CI 守护的基线外，其余 8 项性能、安全与崩溃测试均为 §10 对应路线图里程碑的明确交付物。任何宣称指标达标必须以对应阶段实际测试脚本落地并执行 PASS 为准。


## 1. 系统总体架构与拓扑规范 (Local-First System Topology)

Stagent v0.1 采用本地 Daemon 为唯一权威的控制面。用户在 Stagent IDE Workspace 与 Coding Worker 交互；Supervisor Agent 为可选的建议/审阅组件；二者均不得直接控制宿主文件系统。浏览器 UI 只呈现和提交用户意图，不维护独立虚拟仓库。

```text
┌──────────────────────── Stagent IDE Workspace (localhost) ───────────────────────┐
│ 左：文件树/规范资产区 │ 中：主编辑与 Studio 多维审阅视口   │ 右：Coding Worker /     │
│ (requirements/graph) │ (Demo/Task Graph/质询台/Diff)     │     Supervisor 澄清会话  │
│                         Supervisor HUD（页面内提示/建议/状态/证据）                 │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                │ WebSocket (AUTH 帧认证 / 127.0.0.1 内部通信)
                                ▼
┌──────────────────────── Stagent Local Daemon (Core Authority) ───────────────────┐
│ · 状态机与防死锁引擎 (Lifecycle & Deadlock Watchdog)                               │
│ · 软件合同与单工作区执行锁 (Contract Engine & E_WORKSPACE_LOCKED)                 │
│ · Task Graph 拓扑编排与点亮引擎 (DAG Engine & node_patch_fingerprint)             │
│ · 预览服务生命周期注册表 (PreviewServiceRegistry & 独立 Origin 管理)              │
│ · Supervisor 产物受控落盘引擎 (Zod Schema Validator & Atomic File Writer)         │
│ · 验收门禁核销与证据包生成 (Dual-Gate Verifier & Evidence Bundle)                  │
└───────┬───────────────────────┬───────────────────────────────┬──────────────────┘
        │                       │                               │
        ▼                       ▼                               ▼
┌──────────────┐        ┌──────────────┐                ┌──────────────┐
│ Scoped MCP   │        │ Git Worktree │                │ cli-host 托管 │
│ 安全网关      │        │ 隔离引擎     │                │ 进程派生      │
│ (路径/命令/   │        │ (单任务隔离/ │                │ (Worker 子进程│
│  预算拦截)   │        │  Squash合并) │                │  唯一受控源)  │
└───────┬──────┘        └───────┬──────┘                └───────┬──────┘
        │                       │                               │
        ▼                       ▼                               ▼
   Coding Worker           .stagent/worktrees/             受限开发环境
 (执行受控修改)            (受保护工作副本)                (编译器/测试框架)
```

### 1.1 核心拓扑原则与安全事实

1. **Daemon 单一权威原则**：Daemon 拥有全系统最高裁决权。状态机跃迁、文件写入落盘、Task Graph 拓扑更新、证据核销与合并决策均由 Daemon 独占执行。前端 UI 禁止直接从磁盘反序列化 JSON，统一由 Daemon 从持久化介质加载并广播全量状态快照（`STATE_CHANGED` / `TASK_GRAPH_UPDATED`），前端零逻辑消费。
2. **cli-host 唯一派生源原则**：`cli-host` 是全仓**唯一允许代表 Agent/Worker 派生子进程**的受控宿主模块。Daemon 内部的 `worktree-manager`、`command-runner`、`launcher` 属于系统受信组件，其执行走独立受信白名单并接受统一进程树管理。通过架构 lint 测试（`spawn-whitelist`）强制固化此规则，杜绝未经审计的外部子进程调用。
3. **隔离与可逆性**：
   - 依赖 Git Worktree 实现工作目录与分支维度的物理隔离（见 §5）；
   - 代码修改过程不污染主工作树；未提交修改受 Auto-Checkpoint 与基线保护；
   - 依赖 Scoped MCP Gateway 实现文件路径与命令白名单的前置拦截（见 §4）。


## 2. 核心模块与分层职责 (Layered Architecture)

### 2.1 IDE Workspace 与 HUD (Presentation Layer)

> **⚠️ 中栏与右栏的现行形态见 [`supervisor.md`](./supervisor.md) 第三部分**：中栏为单页「方案工作台」（四幕），右栏为只读的 AI 搭档（§13.2），施工中右栏按四类分流（§16.5）。下文的多视口描述保留为组件清单，不再是日常入口。
- **左栏（项目文件树与规范资产区）**：
  - 常规源码目录树与 Git 状态指示；
  - **规范资产专区 (`.stagent/specs/`)**：清晰挂载需求文档（`requirements.md`）、任务拓扑（`task_graph.json`）与合同历史，支持双击查看排版渲染视图。
- **中栏（主编辑与 Studio 多维审阅区）**：
  - **Demo 原型试玩视口 (Demo Preview)**：内嵌独立 Origin 的 Web 视口（配置 `sandbox="allow-scripts"`，坚决不含 `allow-same-origin`，严格 CSP 阻断连接 Daemon 端口），沉浸式预览 Supervisor 生成的静态页面与 Mock 数据；顶部常驻【修改原型】与【确认原型并实施真实工程】操作栏。
  - **Task Graph 拓扑看板 (Task Graph)**：可视化展示业务功能思维导图与任务 DAG，展示由灰变绿的真实渐进点亮动效与实时工单状态。
  - **质疑自查质询台 (Dispute Viewport)**：结构化展示《三方核验自查报告》，并列展示 Prompt 意图、需求文档规范与实际代码 Diff 的对比，提供一键修复或演变入口。
  - **代码与 Diff 视口**： Monaco 编辑器、Git Diff 审查面板与只读终端日志流。
- **右栏（对话与会话层）**：
  - 提供用户与 Supervisor 的自然语言交互流；
  - 智能路由拦截：在真实试玩阶段，用户输入报错或质疑语句时，自动弹出气泡引导转入质询自查台，杜绝沟通失焦。

### 2.2 Supervisor Agent (Advisory & Specification Layer)
- **定位**：非执行型建议与规格制定智能体，面向非技术用户担任“数字架构师”与“驻场监督员”。
- **双层零执行权边界**：Supervisor **绝对无权直接向磁盘写入业务源码、绝对无权运行任何宿主系统命令**。它永不调用 `stagent_*` 写入工具，其所有产出均以结构化提案（`Proposal`）形式提交给 Daemon，由 Daemon 校验后落盘。
- **职责**：
  1. 澄清模糊需求，提炼生成需求草案（`IntentProposalV1`）；
  2. 生成原型页面代码草案（`DemoArtifactProposal`）；
  3. 解构系统功能树，生成任务 DAG（`TaskGraphProposal`）；
  4. 成果存疑时，提取三方基线事实并执行交叉语义比对，出具自查归因报告。

### 2.3 Coding Worker Agent (Execution Layer)
- **定位**：代码编写与验证执行智能体（如 Claude Code、OpenHands、Cline、cursor-agent 等）。
- **权限**：在 Scoped MCP Gateway 与受控 `cli-host` 监管下，仅允许在分配的任务 Worktree 内部读写已授权的 `writable_paths`，以及执行白名单内的构建与测试命令。

### 2.4 Local Daemon (Control & Authority Layer)
- **核心组件**：
  - **状态机与防死锁看门狗**：管理 15 种展示状态，独占计算并广播 `presentation_state`；内置超时熔断与自愈机制。
  - **Contract & Task Graph Engine**：独占持久化合同与任务图拓扑，维护单工作区互斥租约锁（`E_WORKSPACE_LOCKED`），实现基于心跳与 TTL 的过期自愈机制。
  - **Task Lock Lease Manager（任务锁租约管理器）`[v1.6.0 规范]`**：
    维护 `.stagent/task.lock` 结构化租约文件。锁文件格式严格定义为包含 `{lock_id, task_id, contract_id, holder_pid, acquired_at, heartbeat_at, ttl_seconds: 60, lease_token}` 的 JSON。Daemon 与 Worker 执行期间每 15 秒更新一次 `heartbeat_at`；若检测到锁租约超过 60 秒未续租且宿主 `holder_pid` 进程已消亡（通过 OS `kill(pid, 0)` 返回 `ESRCH`），允许新任务启动时自动回收孤儿锁（Stale Lock Reclaim）并记录审计日志，彻底消除因崩溃导致的永久死锁。
  - **PreviewServiceRegistry（预览服务生命周期治理）**：
    统一注册与托管 Demo 预览服务与真实真机预览服务，记录 `{pid_tree, port, origin, owner_contract_id, started_at}`；提供独立 Origin 隔离、端口冲突探测、空闲 10 分钟自动回收以及 STOPPING 阶段基于进程树的彻底清理。
  - **Supervisor 产物受控落盘引擎**：执行严格的 Schema 校验与体积限制，原子写入固定白名单路径。
  - **Evidence 验收核销器**：收集测试退出码与构建指纹，驱动节点点亮与双门禁合并决策。

### 2.5 Scoped MCP Gateway (Policy Enforcement Layer)
- 强制拦截 Agent 的每一次 I/O 与执行调用：
  - 路径边界校验（阻断向主工作树或敏感目录写入）；
  - 命令白名单与参数过滤（阻断高危提权命令）；
  - 资源与费用三维熔断（Token、工具调用次数、验证重试次数）。

### 2.6 Local File Watcher (Integrity Guard)
- 实时监听项目文件系统变动：
  - 检测外部工具或用户手动改码，即时触发任务节点标记为 `STALE_REVERIFY` 与证据失效；
  - 监听主分支 Git HEAD 漂移，在合并前主动触发冲突保护（`CONFLICT`）。

### 2.7 Git Worktree Engine (Isolation Guard)
- 封装底层 Git Worktree 隔离生命周期：
  - 从目标基线原子创建独立工作树目录；
  - 调度 Worker 执行增量修改；
  - 交付时执行原子 Squash Merge 并嵌入 Git Trailer 审计归档；
  - 任务终止时彻底安全回收工作树目录与本地分支。

---

### 2.8 Supervisor 产物受控落盘协议 (Supervisor Drop-off Protocol) `[v1.5.1 新增]`

为解决 Supervisor“零执行权”与其“输出需求、原型代码与任务图”的职责冲突，系统确立严格的受控落盘协议：

```text
Supervisor Agent (只读会话)
      │
      ├─ 1. 输出结构化 JSON 提案 (DemoArtifactProposalV1 / IntentProposalV1 / TaskGraphProposalV1)
      ▼
Daemon 受控落盘引擎 (In-Memory Validator)
      │
      ├─ 2. Zod Schema 强类型校验 (字段结构、枚举合法性)
      ├─ 3. 安全与物理上限校验 (单文件 ≤2MB，包大小 ≤10MB，DAG 节点数 ≤200，无环校验)
      ├─ 4. 固定白名单路径映射 (强制限定于 .stagent/ 内部三处固定目录)
      ▼
原子文件系统落地 (Atomic Disk Commit)
      ├─ a. 写入临时临时文件 (.stagent/tmp_xxx)
      ├─ b. 原子重命名 (rename) 覆盖目标文件
      └─ c. 触发 WebSocket 广播 (SPEC_SYNC_EVENT / TASK_GRAPH_UPDATED)
```


- **路径强制白名单**：
  1. 需求文档提案：固定落盘为 `.stagent/specs/requirements.md`；
  2. 任务拓扑提案：固定落盘为 `.stagent/specs/task_graph.json`；
  3. Demo 原型提案：固定落盘为 `.stagent/demo/` 目录下的静态资源。
- **严禁越界**：落盘引擎严禁将 Supervisor 提案写入任何业务源代码目录或项目根目录。


## 3. 业务功能树与任务 Graph 渐进点亮引擎 (Task Graph & Illumination Engine)

### 3.1 双层模型与串行执行拓扑

非技术用户难以直接理解 AST 依赖图或复杂的微服务拓扑。Stagent 采用“业务导向在前，工程拓扑在后”的双层映射模型：

```text
【上层：业务功能思维导图 (Functional Tree)】 (面向用户直观认知)
 └─ 用户系统
     ├─ 邮箱验证码登录 (已点亮)
     └─ 个人资料设置 (正在实施)

                      │ 一对多拆解映射 (由 Supervisor 提案解构)
                      ▼

【下层：任务执行拓扑图 (Task Execution DAG)】 (面向工程调度)
 [Node 1: 生成数据表迁移] ──> [Node 2: 编写后端认证接口] ──> [Node 3: 编写前端登录弹窗]
 (已点亮: 退出码0+指纹)       (正在施工: RUNNING)          (等待前置: PENDING)
```

- **拓扑执行纪律 (v0.1 严格串行)**：
  DAG 虽然支持在数据模型中表达分支依赖，但在 v0.1 阶段，受限于单任务 Worktree 与全局工作区锁机制，**调度器严格按拓扑序串行执行，执行并发度 = 1**。多工作区并行流水线明确归入 v0.2+（RFC-2026-002）。

---

### 3.2 节点七态模型与渐进点亮充要条件

#### 3.2.1 节点生命周期七态表 `[v1.5.2 统一]`

> **类型系统与命名空间隔离声明**：DAG 节点状态（`TaskGraphNodeState`，7 态）、合同生命周期（`lifecycle_state`，9 态）与展示层状态（`PresentationState`，15 态）分属三个完全独立的类型系统与枚举命名空间。虽然局部存在同名标识（如 `FAILED`、`PENDING`、`RUNNING`），但严禁跨层直接赋值或混用，各层状态流转严格通过显式映射函数与事件总线驱动。

为消除状态语义混淆，节点状态严格定义为七态：

| 节点状态 (Status) | 视觉表现 | 触发条件与核心语义 |
|---|---|---|
| `PENDING` | 暗灰色常驻 | 前置依赖未全部满足，任务在队列中排队等待 |
| `RUNNING` | 蓝绿色呼吸脉冲 | 前置依赖已满足，调度 Worker 正在当前任务工作区中执行首次代码施工 |
| `REPAIRING` | 橙黄色警示脉冲 | 经质疑自查判定为实现偏差（Bug），调度 Worker 正在执行定向局部返工 |
| `ILLUMINATED` | 常亮翡翠绿 | 施工完成，物理证据全部通过，节点成功点亮 |
| `FAILED` | 红色高亮闪烁 | 关联验证命令执行失败（退出码非 0）或心跳租约丢失，阻断后续拓扑流转 |
| `BLOCKED` | 浅灰色带锁图标 | 上游前置节点发生 `FAILED` 或 `ABORTED`，导致下游分支被级联阻断 |
| `STALE_REVERIFY` | 琥珀黄带刷新图标 | 检测到外部改码或代码被后续任务修改，既有证据过期，等待重新验证 |

#### 3.2.2 渐进点亮充要条件（物理证据驱动）`[v1.6.0 深度闭环]`

系统彻底废除“每节点单独生成 Git Commit SHA”的不可行设想（避免 squash merge 后局部 commit 悬空断裂），亦不要求 Node 级增量编译。针对此前版本存在的“空验证集合可能导致虚假点亮”漏洞，v1.6.0 确立**零空集假绿、物理证据闭环**的渐进点亮机制。

**核心红线纪律**：**严禁无证据或空验证集直接点亮！** 当 `verification_mode === "COMMAND"` 时，若绑定的 `commands` 集合为空（`commands.length === 0`），系统判定为无效规格，**绝对禁止**将节点置为 `ILLUMINATED`，强制置为 `FAILED` 并报错 `E_EMPTY_VERIFICATION_BLOCKED`。

不同节点模式下的点亮充要条件严格定义如下：

##### 1. 代码修改型节点 (`CODE_MODIFICATION`)
$$\text{Illuminated}_{\text{code}} \iff \text{FilesWritten} \land \text{ScopeValid} \land (\text{Commands} \ne \emptyset) \land (\forall c \in \text{Commands}, c.\text{exit\_code} == 0) \land \text{FingerprintPersisted}$$
- **目标文件成功落盘**：节点 `target_files` 中的文件已成功写入任务 Worktree；
- **Scope 零越界验证**：通过 `git status --porcelain -uall` 联合比对，确认所有变更与新增未跟踪文件均在白名单内；
- **命令集合非空且全绿**：绑定的验证命令列表数量 $\ge 1$，且每一个命令的退出码均为 0；
- **产物内容指纹持久化**：计算目标文件的 SHA-256 哈希值并持久化记录至 `task_graph.json` 与 Evidence。

##### 2. 纯命令执行型节点 (`COMMAND_EXECUTION`)（如环境配置、依赖安装、数据迁移）
$$\text{Illuminated}_{\text{cmd}} \iff (\text{Execution}.\text{exit\_code} == 0) \land \text{SideEffectVerified} \land \text{FingerprintPersisted}$$
- **显式验证模式**：若配置了独立的后验命令集（如 `npm ls <pkg>` 或 `prisma migrate status`），要求验证集合非空且全绿；
- **隐式副作用验证模式**：若无独立后验命令，则节点本身的执行命令必须 `exit_code === 0`，且必须检测到预期的物理副作用（如 `package-lock.json` 或迁移记录文件发生哈希更新）。绝不允许无副作用检查的纯调用记录点亮。

##### 3. 人工复核与快速通道节点 (`MANUAL_REVIEW` / `FAST_PATH`)
- **人工复核型 (`MANUAL_REVIEW`)**：目标文件落盘 + Scope 校验通过 + 用户在中栏显式点击【确认此项】(`user_manual_approved === true`)；
- **Fast Path 轻量节点 (C-04)**：单文件落盘 + Scope 校验通过 + 语言解析器语法检查通过（TS/JS 项目经 `tsc --noEmit` 检查退出码为 0，其他语言栈经对应轻量 linter 检查无致命语法错误）。（说明：此项仅针对单文件的轻量语法与类型合规校验，不引入 v0.2+ 推迟的重型跨文件 AST 依赖图分析）。

在最终交付合入执行 squash merge 时，Daemon 自动将所有节点的指纹集合打包为 `{squashed_commit_sha, node_fingerprints[]}` 嵌入审计归档，确保历史链条完整不失真。

---

### 3.3 持久化与状态单向广播

- **唯一数据源**：`task_graph.json` 由 Daemon 独占在内存中维护并原子落盘至 `.stagent/specs/task_graph.json`。
- **UI 零逻辑消费**：前端禁止直接读取本地 JSON 文件，统一通过 WebSocket 监听 Daemon 广播的 `TASK_GRAPH_UPDATED` 消息。消息携带节点当前全量状态、变更指纹与进度百分比，前端仅负责视图映射与点亮动效呈现。

---

### 3.4 外部改码级联降级与证据失效机制 (Cascade Demotion & Evidence Revocation) `[v1.6.1 闭环 C-08]`

为杜绝用户在外部编辑器改码导致陈旧验收证据被并发误用于一键合入，系统建立严格的级联降级不变式：

1. **级联降级强约束 (Cascade Invariant)**：
   无论当前合同处于何种状态（包括已通过自动化检查与真机验证的 `AUDITED`），只要 Task Graph 中产生至少 1 个 `STALE_REVERIFY` 节点：
   - Daemon 必须在同一个事件循环周期内，**原子将合同 `lifecycle_state` 由 `AUDITED` 强制降级为 `VERIFYING`**；
   - 现存关联证据包的 `status` 立即由 `"VALID"` 原子更新为 `"STALE"`；
   - Daemon 持久化 `presentation_state` 同步切换为 `VERIFYING` 并向前端广播；
   - 前端视口的【确认合入】按钮立即置灰并切换为重验等待态，任何在失效期间到达的合并请求将被 Daemon 以 `409 Conflict (E_EVIDENCE_STALE)` 坚决拒绝。
2. **重验与恢复闭环**：
   受影响节点重新执行关联验证命令。只有当所有 `STALE_REVERIFY` 节点重新满足点亮充要条件、生成绑定最新 commit SHA 的全新有效证据包后，合同方可重新跃迁至 `AUDITED`，合入门禁重新解锁。


## 4. Scoped MCP 安全网关与沙箱规范 (Security & MCP Protocol)

### 4.1 受控工具集定义
所有由 Worker 调用的工具必须经由 Scoped MCP Gateway 代理，提供以下 6 项标准受控工具：
1. `stagent_read_file`：受限路径只读；
2. `stagent_write_file`：受限路径写入（受合同 Scope 与保护清单双重拦截）；
3. `stagent_list_dir`：目录遍历；
4. `stagent_exec_command`：白名单命令执行（环境变量脱敏 + 超时看门狗）；
5. `stagent_get_diff`：任务工作树 Diff 查看；
6. `stagent_report_status`：结构化进度汇报。

---

### 4.2 拦截策略与资源熔断纪律

#### 4.2.1 资源与费用三维熔断
控制面实时统计以下三项维度消耗：
1. **Token 与财务费用**：累计 Token 达到合同阈值（默认 500,000 tokens）；
2. **命令与工具调用频次**：单合同累计调用达到上限（默认 100 次）；
3. **验证重试次数**：单任务连续验证失败达到上限（默认 3 次）。

- **熔断与恢复裁决 (P-13)**：
  - 触发熔断后，任务立即进入 `PAUSED`（底层对应 `PENDING_RESUME`）状态；
  - **恢复规则**：
    - 若用户选择**追加预算**：属于授权变更，必须生成 Contract v(n+1) 并由用户**重新批准**；
    - 若用户仅**指示继续执行**（未修改预算上限与权限）：属于常规恢复，仅在系统事件中记录备案，无需重新弹窗批准。
  - **恢复执行时的 Worktree 物理存在性自愈校验 (C-07)**：
    当合同处于 `PENDING_RESUME` 且用户触发恢复执行时，Daemon 严禁直接唤醒 Worker，必须先执行物理 Worktree 完备性检查：
    1. **物理目录与分支完好**：状态机平滑跃迁至 `EXECUTING`，唤醒 Worker 推进施工；
    2. **物理目录丢失但分支完好**（如守护进程重启或临时清理导致解挂）：状态机安全回退至 `PREPARING`，幂等重新执行 `git worktree add` 挂载对应任务分支，确认工作区完备后自动跃迁至 `EXECUTING`；
    3. **任务分支与物理目录均丢失**（严重不可逆异常）：合同状态机终止跃迁至 `ABORTED`，报错 `E_WORKTREE_LOST`，提示用户：“任务工作区已损坏或丢失，已安全终止本次任务，请重新发起方案”。

#### 4.2.2 路径与命令受控拦截（Gateway-Enforced）
- **路径校验**：写入路径必须严格满足：
  $$\text{target\_path} \in \text{writable\_paths} \land \text{target\_path} \notin \text{protection.json}$$
- **命令别名与分层超时默认值 (D-6)**：
  为避免全量单命令 60s 造成频繁超时误报，命令执行根据别名执行分层看门狗：
  - 代码风格检查与 Lint：默认超时 **60 秒**；
  - 单元测试与端到端测试：默认超时 **300 秒**；
  - 构建、编译与依赖安装：默认超时 **600 秒**。
  支持在合同中显式配置单命令覆盖超时。

#### 4.2.3 术语纠偏与成熟度边界声明 (P-17)
本规范在术语表层面严格规范如下定义：
- **受控 (Gateway-enforced)**：指在进程内通过拦截层强制执行的路径、参数与白名单策略，不代表操作系统内核层面的隔离；
- **工作区隔离 (Worktree-isolated)**：指通过独立 Git 工作目录和分支管理避免直接污染主分支代码，不保证子进程、环境变量与网络访问的天然隔离；
- **沙箱 (Sandbox-enforced)**：仅用于真正具备 OS 级命名空间、cgroups、MicroVM 或专用容器隔离的场景（标记 `SANDBOX_ENFORCED` 且提供实机验证凭据）。普通本地子进程严禁自称为沙箱。

---

### 4.3 权限变更与自动返工子集检查规则 (P-06)

在执行自动化缺陷修复（`DefectFixTask`）或增量演变时，权限扩展必须严格遵守数学子集判定：

$$\text{FixIsFree} \iff (\text{TargetFiles} \subseteq \text{ApprovedScope}) \land (\text{Commands} \subseteq \text{ApprovedWhitelist})$$

1. **子集免重批**：若修复指令所涉及的文件路径与执行命令完全属于原合同已批准的 `writable_paths` 与命令白名单，允许自动执行免签返工，保障体验流畅；
2. **越权强制重批**：一旦修复尝试触碰任何原合同外的路径，或需要执行新增构建命令，Gateway 必须立即拦截，强制递增 `contract_revision` 生成新版合同，提示用户显式审批，坚决杜绝 Supervisor 或 Worker 借由返工名义隐式扩权。

---

### 4.4 Demo 预览视口安全隔离规范 (P-16) `[v1.5.1 强制安全规范]`

> **与控制台托管的边界（2026-10-24 显式化）**：本节约束的是 **Demo 原型预览**，不是验收控制台本身。控制台可由 Daemon 同源托管（打开项目 DX，见 §11 注记 8 / 任务 `TASK-D.1b`–`D.1d`）；**Demo 仍必须独立 Origin**，不得与控制台或 Daemon API 同源。详细愿景/现状见 `docs/specs/development-tasks.md` 的 `TASK-D.1b`–`D.1d` 卡（原过程稿曾置于 `docs/archive/open-project-vision-and-status.md`（目录已移除，见 Git 历史））。

为彻底消除模型生成的前端代码在 IDE 中同源执行直连本地 Daemon 控制面的严重攻击面，系统确立以下隔离规范：

```text
┌──────────────────────── Stagent IDE Workspace (Origin: ide.stagent.internal) ─────┐
│ ┌───────────────────────────────────────────────────────────────────────────────┐ │
│ │ Studio 中栏：Demo 预览视口                                                     │ │
│ │                                                                               │ │
│ │  <iframe                                                                      │ │
│ │    src="http://127.0.0.1:<随机动态分配端口>"                                   │ │
│ │    sandbox="allow-scripts"  <!-- 坚决不给 allow-same-origin 与 allow-top-navigation -->
│ │  />                                                                           │ │
│ └───────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                       │ 尝试 fetch / WebSocket
                                       ▼ (受 CSP 与 跨源双重阻断)
┌──────────────────────── 外部防御边界 (Boundary Guard) ───────────────────────────┐
│ · 严格 CSP: default-src 'none'; script-src 'self'; connect-src 'none';           │
│ · Daemon Origin 白名单检验: 拒绝来自 http://127.0.0.1:<随机端口> 的任何请求 (403)  │
│ · 同源隔离: 无法读取 IDE 的 localStorage 令牌或发送敏感命令                      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

1. **独立 Origin 服务**：Demo 原型预览必须由 Daemon 的 `PreviewServiceRegistry` 在独立端口（如随机端口 `127.0.0.1:49152+`）或独立子域启动，严禁使用 `srcdoc` 或同源 Blob 嵌入；
2. **严苛 iframe Sandbox 策略**：
   - 视口标签强制配置：`sandbox="allow-scripts"`；
   - **绝对禁止授予 `allow-same-origin`**：彻底阻断 iframe 继承宿主 Origin 权限；
   - **禁止 `allow-top-navigation` / `allow-popups`**：防止恶意跳转或跳出逃逸；
3. **内容安全策略 (Content Security Policy, CSP)**：
   服务响应头必须强制注入严格 CSP：
   ```http
   Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self' data:;
   ```
   **坚决禁止 `connect-src` 允许连接 Daemon 的 HTTP 或 WebSocket 端口**；
4. **Daemon 端 Origin 准入拒绝**：Daemon 的 API 与 WebSocket 路由校验请求的 `Origin` 标头，对所有来自本地预览服务端口的请求一律返回 `403 Forbidden` 并记录告警；
5. **负例 E2E 安全验证**：将“Demo 内 JS 脚本尝试请求 Daemon 端口被物理拦截”固化为 CI 必跑测试用例（`tests/security/demo-sandbox-xorigin.test.ts`）。


## 5. Git 真实分支生命周期与原子核销 (Git Workspace Guard)

### 5.1 工作区目录规范与入库策略 (P-15)

为了在实现隔离的同时确保交付资产可追溯，系统确立三级入库与忽略策略：

```text
.stagent/
├── specs/                   <-- 【强制入库】需求文档 (requirements.md)、任务拓扑 (task_graph.json)
│   └── revisions/           <-- 【强制入库】需求不可变快照 (req-v001.md, req-v002.md ...)
├── contracts/               <-- 【强制入库】历史执行合同快照 (contract_v1.json, contract_v2.json)
├── evidence/                <-- 【强制入库】验收证据包 (evidence.json)
├── demo/
│   └── snapshots/           <-- 【强制忽略 .gitignore】历史 Mock 原型构建快照
└── worktrees/               <-- 【强制忽略 .gitignore】临时任务 Worktree 物理隔离目录
```

1. **自动配置 `.gitignore`**：项目初始化或首次运行 Stagent 时，Daemon 自动在 `.gitignore` 中追加以下规则：
   ```gitignore
   # Stagent Ephemeral Execution Artifacts
   .stagent/worktrees/
   .stagent/demo/snapshots/
   .stagent/*.lock
   ```
2. **规范资产永久入库**：`.stagent/specs/`、`.stagent/contracts/` 与 `.stagent/evidence/` 在交付合入时随代码一并提交到 Git 历史中，构成完整的工程溯源链条；
3. **主树保护提示**：需求澄清阶段在主树创建 `.stagent/` 目录时，系统先检查主工作树状态并做 baseline 快照，UI 温和提示用户系统正在初始化规范资产。
4. **需求快照与工作态分离（文档资产组织）**：`.stagent/specs/requirements.md` 为当前对话工作版本，每一次正式合同签发与重大用户确认均在 `.stagent/specs/revisions/req-v<ID>.md` 留存不可变快照，合同元数据显式引用该快照版本。快照一经签发禁止覆写与删除，仅允许新增下一版本；`requirements.md` 的后续增量修补不影响既有快照内容，二者不得互相覆盖。

---

### 5.2 Worktree 生命周期与 VIBE 模式 Checkpoint 机制 (P-08)

#### 5.2.1 PROTECTED 模式下的 Worktree 生命周期 `[v1.6.0 规范]`
1. **统一工作区与分支命名规范**：
   - 目标基线：以检出时目标主分支的 HEAD SHA 记录为 `base_sha`；
   - 任务分支命名：统一格式为 `stagent/task-{contract_id}`；
   - 临时工作树物理目录：统一路径为 `.stagent/worktrees/task-{contract_id}/`；
   - 执行原子命令：`git worktree add -b stagent/task-{contract_id} .stagent/worktrees/task-{contract_id} {base_sha}`。
2. **环境注入与凭据隔离**：
   仅挂载构建必需的安全环境变量，严禁将宿主全局敏感环境变量、云厂商凭据或未授权私钥注入 Worker 执行进程。
3. **原子合入与 Git Trailer 尺寸防护**：
   双门禁通过后，在主工作树执行 `git merge --squash stagent/task-{contract_id}`，嵌入 4 项标准化 Git Trailer 审计元数据：
   ```git
   Stagent-Contract-Id: <contract_id>
   Stagent-Evidence-Id: <evidence_id>
   Stagent-Change-Request-Id: <change_request_id>
   Stagent-Verifier: <daemon_version_and_engine>
   ```
   **Trailer 尺寸与防溢出红线**：
   - 每项 Trailer 单行长度严格限制在 1024 字节以内；
   - 全部 Trailer 块总尺寸严格限制在 4096 字节以内；
   - 严禁将全量测试输出日志或大 JSON 直接内嵌在 Commit Message 中；详细日志与指纹映射仅存入 `.stagent/evidence/`，Trailer 仅保存不可篡改的索引键。
4. **安全拆除与垃圾回收**：
   合入完成后执行 `git worktree remove --force` 并安全删除临时本地任务分支，确保主仓库工作区整洁零悬空。


#### 5.2.2 VIBE 模式下的 Auto-Checkpoint 机制
在 VIBE 自由模式下，若 `use_worktree === false`：
- **前置硬要求**：必须在执行任何修改前自动生成轻量 Checkpoint 快照（基于 `git stash create` 或临时 reflog 快照）；
- **一键无损撤销**：UI 顶部常驻【撤销本次自由修改】按钮，用户点击即可基于 Checkpoint 句柄 100% 恢复修改前现场；
- **网关不可降级**：即使在主工作树直接编辑，文件写入依然必须通过 Scoped Gateway 的路径与命令白名单过滤。


## 6. 关键时序交互、异常分支与自愈机制 (Sequence & Error Recovery)

### 6.1 Client-Daemon 通信协议 (WebSocket Protocol)
- 默认绑定 `127.0.0.1`，首帧严格校验 `AUTH` 握手令牌。
- **核心广播帧定义**：
  - `STATE_CHANGED`：广播全量状态快照，携带持久化的 `presentation_state` 与白话提示文本；
  - `TASK_GRAPH_UPDATED`：广播 Task Graph 全量节点拓扑、七态迁移事件与指纹数据；
  - `DEMO_PREVIEW_STATUS`：广播 Demo 原型构建状态与独立 Origin 预览 URL；
  - `DISPUTE_REPORT_READY`：广播 Supervisor 质疑自查报告，携带置信度与三方证据链；
  - `SPEC_SYNC_EVENT`：`.stagent/specs/requirements.md` 增量修补同步事件。

---

### 6.2 正常全生命周期交互时序 (Happy Path: 八步标准旅程)

```text
User            IDE/Studio      Supervisor      Task Graph       Daemon/Gateway     Worker        Real App/Git
 |                  |               |               |                  |               |               |
 |-[1] 探讨需求----->|---会话消息--->|               |                  |               |               |
 |                  |<--同步 spec---|--生成规范提案--------------------->|--受控落盘 requirements.md     |
 |                  |               |               |                  |               |               |
 |-[2] 讨论成熟----->|--请求Demo---->|--生成原型提案--------------------->|--受控落盘 demo.html           |
 |                  |<--展示Demo预览-|(独立Origin+沙盒)|<--启动独立Preview-|               |               |
 |<--体验Mock Demo--|               |               |                  |               |               |
 |                  |               |               |                  |               |               |
 |-[3] 确认原型实施->|--批准开工---->|--拆解功能DAG->|--落盘 task_graph.json            |               |
 |                  |<--渲染灰色拓扑-----------------|(全灰拓扑广播)    |--创建Worktree->|               |
 |                  |               |               |                  |               |               |
 |-[4] 真实施工实施->|               |               |<-逐节点推进施工--|--受控写代码/测试-------------->|
 |                  |<--节点点亮帧--|<--------------|--物理校验通过----| (退出码0+指纹) |               |
 |                  | (由灰变绿)     |               |                  |               |               |
 |                  |               |               |                  |               |               |
 |-[5] 施工完成----->|<--双门禁验证通过---------------------------------|--启动真实服务->|               |
 |<--体验真实页面---|                                                                  |               |
 |                  |                                                                  |               |
 |-[6] (若存疑)质疑->|--自然语言质疑->|--启动三方自查--| (比对 Prompt vs Spec vs Diff)   |               |
 |                  |<--出具自查报告-| (判定: 偏差返工 / 需求变更, confidence>=0.7)    |               |
 |                  |               |                                                  |               |
 |-[7] 增量演进----->|--更新需求描述->|--增量打补丁--->|                                  |               |
 |                  |<--展示新Demo--|--增量改原型--->|                                  |               |
 |                  |               |                                                  |               |
 |-[8] 确认新原型--->|--实施增量变更->|--扩展新节点--->|----------------->|--增量施工点亮->|               |
 |                  |               |               |                  |               |               |
 |--体验无误并交付->|--一键确认合入------------------------------------>|--squash merge----------------->|
 |<--合并成功完成---|                                                  | (Git Trailer 审计归档)        |
```

---

### 6.3 状态与决策边界

#### 6.3.1 非技术用户 15 状态与控制面状态机映射 `[v1.5.1 闭环修订]`

系统确立 **15 种面向非技术用户的纯粹白话状态**。底层状态机由 `lifecycle_state`、`approval.status` 与附加运行时判据共同决定。

| 用户可见状态 (UI State) | 底层 lifecycle | 底层 approval.status | 附加运行时判据 (Runtime Criteria) | 核心白话语义与可执行操作 |
| :--- | :--- | :--- | :--- | :--- |
| `EXPLORING` (正在探讨需求) | `DRAFT` | `DRAFT` | 澄清会话活跃，未启动 Demo (`demo_service.status !== 'RUNNING'`) | 自由对话，实时提炼 requirements.md (严格对齐代码 `DRAFT↔DRAFT`) |
| `DEMO_PREVIEW` (原型试玩中) | `DRAFT` | `DRAFT` | `demo_service.status === 'RUNNING'` | 独立 Origin 原型运行中，沉浸式体验组件与交互 (严格对齐代码 `DRAFT↔DRAFT`) |
| `GRAPH_MAPPING` (任务拆解中) | `PREPARING` | `APPROVED` | 原型获批，DAG 拓扑计算中 | 正在解构功能树与生成全灰 Task Graph |
| `NEEDS_APPROVAL` (需要确认授权) | `PENDING_APPROVAL` | `PENDING_REVIEW` | 命中高风险或保护清单 | 阻断执行，等待用户单项勾选批准 |
| `EXECUTING` (正在施工) | `EXECUTING` | `APPROVED` | `stopping_requested === false` | Agent 按拓扑施工，节点逐个点亮；可发起停止 |
| `STOPPING` (正在停止并回收资源) | `EXECUTING` | `APPROVED` | `stopping_requested === true` | 正在回收托管进程树与释放锁，硬超时 15s |
| `PAUSED` (已暂停，等你决定) | `PENDING_RESUME` | `APPROVED` | 预算耗尽或重试达上限熔断 (`budget_exhausted === true \|\| retry_count >= max_retries`) | 提示超限原因；操作：追加预算继续 / 放弃本轮 |
| `VERIFYING` (正在检查成果) | `VERIFYING` | `APPROVED` | 自动化门禁测试运行中 | 运行自动化验证、类型检查与快照比对 |
| `FAILED` (检查未通过) | `VERIFYING` | `APPROVED` | 门禁未通过且重试预算未耗尽 (`verification_passed === false && retry_count < max_retries`) | 门禁未通过，展示白话失败原因与修复选项 (确定性单一映射) |
| `REAL_PLAYTEST` (真实环境试玩中) | `AUDITED` | `APPROVED` | `real_preview.status === 'RUNNING'`，无未决质疑 | 真实服务已启动，用户体验真实环境与功能 |
| `DISPUTED_INSPECTING` (质疑自查中) | `AUDITED` | `APPROVED` | `dispute_session.status === 'OPEN'` | 用户提出质疑，Supervisor 执行三方比对自查 |
| `READY_TO_MERGE` (验收完成，等待交付) | `AUDITED` | `APPROVED` | `evidence.can_merge === true`，无冲突 | 试玩通过且客观证据全绿；可一键合入主干 |
| `CONFLICT` (项目发生并发冲突) | `AUDITED` | `APPROVED` | 合并前检测到目标分支推进 | 目标分支漂移；操作：一键重基重验 / 放弃本轮 |
| `MERGED` (已合入项目) | `MERGED` | `APPROVED` | 代码已原子 Squash 合入主干 | 交付成功，Git Trailer 审计归档完成 |
| `ABORTED` (任务已终止) | `ABORTED` | `REJECTED` 或 `APPROVED`（保留历史审批事实） | 任务被终止、超时熔断或手动放弃 | 工作区已清理干净，主分支零污染 |

- **`(AUDITED, APPROVED)` 四分支的判定优先级 (v1.6.1 澄清)**：
  表中 `REAL_PLAYTEST` / `DISPUTED_INSPECTING` / `READY_TO_MERGE` / `CONFLICT` 四行的运行时判据可能同时为真（如真机预览正在运行且用户同时发起质疑）。投影函数必须按 **`CONFLICT` > `DISPUTED_INSPECTING` > `REAL_PLAYTEST` > `READY_TO_MERGE`** 的顺序短路求值，安全与用户诉求优先，禁止实现自由裁量或依赖判据书写顺序之外的隐式约定。
- **持久化字段与广播约定 (P-20)**：
  Daemon 状态机独占计算并在持久化快照中维护 `presentation_state` 字段；每次状态流转时，通过 `STATE_CHANGED` 广播帧全量推送。前端零业务逻辑，仅消费该字段渲染界面。
- **CI 不变式门禁**：
  将“15 状态表中所有 lifecycle 枚举值必须 100% 存在于 `lifecycleStateSchema` 中”固化为 CI 单元测试（`tests/unit/state-machine-matrix.test.ts`）。

---

#### 6.3.2 `PAUSED` 挂起原因与允许操作矩阵 (Suspend Reason & Action Matrix) `[v1.6.0 新增]`

为彻底杜绝系统处于 `PAUSED` 状态时非技术用户操作不明确、底层权限错配的问题，系统确立 `suspend_reason` 强类型枚举与严格的操作权限矩阵：

| 挂起原因 (`suspend_reason`) | 触发条件 | 面向用户白话提示 | 允许执行的操作 (Allowed Actions) | 禁止操作与异常保护 |
|---|---|---|---|---|
| `USER_MANUAL_PAUSE` | 用户在中栏主动点击【暂停施工】 | “您已暂停了当前施工，您可以随时恢复或调整” | 1. `RESUME` (恢复施工)<br>2. `ABORT` (放弃本轮并清理)<br>3. `AMEND_INTENT` (在右栏调整需求并升版) | 禁止在未恢复前直接发起合入；禁止直接运行测试命令 |
| `BUDGET_EXCEEDED` | Token 消耗或工具调用达到合同上限阈值 | “施工消耗达到了预设的安全上限，请确认是否追加” | 1. `INCREASE_BUDGET_AND_RESUME` (追加预算并继续)<br>2. `ABORT` (终止任务) | 严禁静默继续执行；未追加预算前阻断一切新工具调用 |
| `VERIFICATION_RETRY_EXHAUSTED` | 自动化测试连续失败达 `max_verification_retries` | “自动修复重试已达上限，需要您的介入指导” | 1. `FORCE_RETRY` (重置重试计数再次尝试)<br>2. `DISPUTE_OR_REPAIR` (进入质疑自查或人工定向指导)<br>3. `ABORT` (放弃本轮修改) | 禁止无限次无休止重试消耗算力 |
| `SUSPICIOUS_DRIFT` | 探测到任务工作区或外部文件发生非预期的并发改动 | “检测到外部文件发生了改动，为防止冲突已暂停” | 1. `SYNC_AND_REVERIFY` (对齐外部变动并重新验证)<br>2. `OVERWRITE_AND_RESUME` (以当前工作树为准覆盖继续)<br>3. `ABORT` (终止) | 禁止在基线冲突未决时直接执行 squash merge |
| `WAITING_EXTERNAL_APPROVAL` | 施工中触碰到受保护资产，需要提升权限 | “本次操作需要访问受保护文件，请确认授权” | 1. `APPROVE_AND_RESUME` (勾选授权并签署新合同版本继续)<br>2. `REJECT_AND_ABORT` (拒绝授权并终止任务) | 绝对禁止越权操作；未签署新版合同前相关写入严格拦截 |
| `LOCK_LEASE_CONFLICT` | 工作区锁租约竞争冲突等待重试 | “工作区正在执行其他维护操作，请稍候” | 1. `WAIT_AND_RETRY` (等待锁释放后重试)<br>2. `RECLAIM_STALE_LOCK` (确认原进程消亡后强制回收孤儿锁)<br>3. `ABORT` (放弃) | 严禁破坏持有中的活跃锁租约 |
| `FAST_PATH_BREACH` | Fast Path 施工中试图写入多文件或执行命令 | “修改超出了快速轻量微调范围，已自动为您升级为标准审批流程” | 1. `UPGRADE_TO_CONTRACT_V2` (升级为标准审批并继续)<br>2. `ABORT` (终止任务) | 绝对禁止原地越权执行；必须经用户明确批准新合同版本方可恢复 |

---
### 6.4 六类状态死锁自愈机制 (Deadlock Self-Healing Catalog) `[v1.6.0 核心闭环]`

为根除状态机悬空与死锁，系统为全部 6 类死锁场景设定确定性自愈出口：

| 编号 | 潜在死锁场景 | 触发根因 | 确定性出口与看门狗机制 (D-1 ~ D-6) |
|---|---|---|---|
| **D-1** | `CONFLICT` 死锁 | 外部持续提交导致目标分支持续漂移，重基死循环 | **重试上限 ≤ 3 次**（计数口径：仅计用户手动触发的重试；系统首次自动重试不计入）。达到 3 次后强制停止重试，在 UI 弹出【强制二选一】弹窗：<br>1. `REBASE_AND_REVERIFY`：手动确认重基最新代码并全量重跑；<br>2. `ABORT_AND_KEEP_WORKTREE`：终止合并但保留当前 Worktree 供手动比对。 |
| **D-2** | `STOPPING` 挂死 | 进程死锁或文件锁被占用，`SIGKILL` 无法退出 | **15 秒硬超时看门狗 (`STOP_TIMEOUT = 15s`)**。<br>若 15s 内进程树未完全退出，Daemon 强制将合同跃迁至终态 `ABORTED`，记录错误码 `TERMINATION_FAILED`，释放内存锁并向用户展示需手动杀进程的诊断提示，坚决禁止无限期停留在 `STOPPING`。 |
| **D-3** | `DISPUTED_INSPECTING` 挂死 | Supervisor 预算耗尽、模型断网或报告生成失败 | **60 秒质询看门狗**。<br>若 60s 内未生成自查报告，系统自动降级：在中栏直接呈现抓取到的原始三方事实文本（原始 Prompt、`requirements.md`、代码 Diff），由用户手动点击选择白话二选【这是 Bug，免费修】或【我想要新功能，下一轮做】（C-4 已拍板；分类由系统内部归，接 attributions 路由，不向用户暴露技术分类；按钮文案以 supervisor §16.7 为准，OP-19 已销项）。 |
| **D-4** | 节点 `RUNNING` 挂死 | Worker 崩溃、会话断开或无进度事件推送 | **90 秒心跳与租约机制**。<br>Worker 派生后必须每 15s 发送一次心跳；若连续 90s 无心跳，Daemon 强制判定租约失效，将当前节点置为 `FAILED`（原因码 `WORKER_HEARTBEAT_LOST`），合同转入 `PAUSED` 态。 |
| **D-5** | 无验证命令节点点亮死锁 | 文档、配置或设计类节点无可执行测试命令或空验证集合 | **支持 `verification_mode` 声明与零空集校验**：<br>节点声明为 `MANUAL_REVIEW` 时，由用户在 UI 显式点击【确认此项】人工点亮；声明为 `COMMAND` 时严禁空命令集（若为空报错 `E_EMPTY_VERIFICATION_BLOCKED`）；声明为 `NONE` 时文件写入成功后自动点亮。杜绝因缺少命令或空集导致拓扑死锁或虚假点亮。 |
| **D-6** | `WORKSPACE_LOCK` 永久死锁 `[v1.6.0 新增]` | 前端或 Daemon 崩溃导致 `.stagent/task.lock` 孤儿残留 | **60 秒租约看门狗与进程活性自愈探测**。<br>若当前时间与锁中 `heartbeat_at` 差距超过 `ttl_seconds`（60s），且探测到 `holder_pid` 已无活跃系统进程（OS `kill(pid, 0)` 返回 `ESRCH`），新任务可安全执行 `RECLAIM_STALE_LOCK` 覆写并接管锁，消除人工删锁负担。 |

---

### 6.5 Supervisor 质疑自查与责任判定协议 (Supervisor Dispute Reconciliation Protocol)

#### 6.5.1 三方比对事实数据源
当用户在真实体验中发起质询时，Supervisor 抓取三方基线事实：
- **数据源 1（原始意图）**：用户的原始 Prompt、需求澄清对话上下文；
- **数据源 2（已获批规范）**：`.stagent/specs/requirements.md`、合同 Scope 约定；
- **数据源 3（物理实现事实）**：任务工作区实际代码 Diff、运行报错日志、Evidence 证据。

#### 6.5.2 判定规则与置信度治理

> **⚠️ 用户侧出口已改判（Supervisor SSOT 第三部分 §16.7 · D10）**：`confidence < 0.7` 时系统向用户提一个业务澄清问题，**不再**让用户点选「按缺陷修复 / 按新需求演进」。置信度与三方事实仍落盘供审计。
1. **倾向建议而非绝对裁判**：自查报告为带有置信度（`confidence: 0.0–1.0`）的推断建议；
2. **三条核心推断准则**：
   - **准则 1 (明确记载即实现偏差)**：需求文档或 Mock Demo 中已明确包含该条目，而真实代码未实现或报错，倾向判定为实现偏差（判定 A）；
   - **准则 2 (未曾涉及即需求变更)**：需求文档与 Mock Demo 中均无记载，或用户推翻了原设定，倾向判定为需求变更（判定 B）；
   - **准则 3 (歧义倾斜保护用户)**：前期 Supervisor 梳理时理解有误导致漏记，倾向判定为实现偏差免费返工；
3. **置信度门槛与低置信度降级**：
   - 当 `confidence >= 0.7` 时：系统出具明确的白话归因报告；
   - 当 `confidence < 0.7` 时：系统不出具单方断言，降级为呈现比对事实，由用户手动指定分流方向。

#### 6.5.3 实现偏差自动修复闭环 (`DefectFixTask`) 与越权检查 (P-06)
- 判定为实现偏差时，系统自动生成结构化 `DefectFixTask`；
- **确定性子集检查**：Daemon 检查修复任务涉及的 `{target_files, commands}` 必须是当前合同已批准 Scope 与命令白名单的**严格子集**；
  - 若满足子集：将受影响节点原子置为 `REPAIRING`（橙黄脉冲），直接唤醒 Worker 在 Worktree 中定向重修，**无需用户二次签署新合同**；
  - 若超出子集：Daemon 阻断自动修复，强制生成 Contract v(n+1) 差异补丁并提示用户审批。


#### 6.5.4 统一关联键 `change_request_id` (P-24)
每次需求变更或质疑自查触发时，Daemon 自动分配全局唯一的 `change_request_id`（如 `cr_20261023_xxx`）。需求文档增删标记、新版合同、Task Graph 拓扑与 Demo 快照全部携带该关联键，确保资产溯源链条 100% 贯通。


## 7. IDE/HUD 交互与交付验收门禁规范 (IDE Workspace & Delivery Gates)

### 7.1 Studio 四视口状态联动契约

> **⚠️ 本节已由 Supervisor SSOT 取代（D8）**：用户可见状态只有 `JourneyStage`（四幕），由 Daemon 按 [`supervisor.md`](./supervisor.md) 第三部分 §16.2 映射表投影广播；中栏同页换幕，不再自动切换视口。

Studio 中栏作为核心审阅区，视口切换严格与系统状态机绑定：

```text
[EXPLORING 态] ──────> 默认展示：需求规范视图 (Markdown 实时渲染)
[DEMO_PREVIEW 态] ───> 自动切换：Demo 原型试玩视口 (独立 Origin + iframe sandbox)
[GRAPH/EXECUTING 态] > 自动切换：Task Graph 拓扑看板 (功能树 + DAG 渐进点亮)
[DISPUTED 态] ───────> 自动切换：质疑自查质询台 (三方比对 Diff 与归因报告)
[REAL_PLAYTEST 态] ──> 自动切换：真机预览视口 (双门禁检查栏高亮展示)
```

---

### 7.2 交付验收双门禁契约 (Dual Delivery Gates)

在任务完成进入交付阶段时，必须通过两道确定性门禁：

```text
                    【Worker 汇报施工完毕】
                               │
                               ▼
        ┌─────────────────────────────────────────────┐
        │ Gate 1: 主观试玩门禁 (Subjective Playtest)    │
        │ · 真机预览服务启动正常 (端口与环境无报错)      │
        │ · 用户在真机视口体验功能符合预期            │
        │ · 用户未发起未决质询 (无 Open Dispute)      │
        └──────────────────────┬──────────────────────┘
                               │ 通过
                               ▼
        ┌─────────────────────────────────────────────┐
        │ Gate 2: 客观证据门禁 (Objective Evidence)     │
        │ · 关联测试与类型检查命令退出码全部为 0        │
        │ · 候选 Commit SHA 与 Evidence 严格匹配      │
        │ · 越界写入 100% 可被检出并阻断 (Scope 检查)  │
        │ · 合并前目标分支无并发漂移 (无 CONFLICT)      │
        └──────────────────────┬──────────────────────┘
                               │ 通过
                               ▼
               【启用【确认合入主干】高亮按钮】
               (一键触发原子 Squash Merge 与归档)
```

- **Gate 2 纠偏与未跟踪文件防御规范 (P-18 / v1.6.0 深度闭环)**：
  Scope 校验必须基于合并前对 Worktree 执行的 `git status --porcelain -uall` 联合 `git diff --name-only HEAD` 检查。必须解析所有已暂存修改、未暂存修改以及**新增的未跟踪文件（`??`）**。若 Worker 或外部脚本写入了 Scope 外文件或创建了未跟踪的越界新文件，该门禁**确保 100% 能够检出并坚决阻断合并**（`can_merge = false`，记录 `E_SCOPE_VIOLATION` 或 `E_UNTRACKED_SCOPE_VIOLATION`），彻底消除仅依赖 `git diff` 遗漏未跟踪文件的安全盲区。


## 8. 架构决策记录 (Architecture Decision Records, ADR)

> **本节已于 2026-10-27 文档治理重组时抽出。** 全部 ADR 正文现存放在 [`../adr/`](../adr/)，本节只保留索引。
> **迁移说明**：ADR-0001～0009 原内嵌于本节，抽离时**未改写任何条文**；ADR-0010～0013 为本轮新补录。
> **抽取理由**：ADR 需要能被单独引用、单独 SUPERSEDE、单独追踪生命周期。埋在 1500 行宪法里会导致「决策已变更但正文无从体现」。

| ADR | 标题 | 状态 |
| :--- | :--- | :--- |
| [0001](../adr/0001-target-user-positioning.md) | 目标用户定位演进与分层适配 | ACCEPTED |
| [0002](../adr/0002-single-workspace-mutex.md) | 单工作区互斥执行与包管理器缓存隔离 | ACCEPTED |
| [0003](../adr/0003-worktree-capability-boundary.md) | 诚实承认 Worktree 的能力边界 | ACCEPTED |
| [0004](../adr/0004-three-dimension-budget-fuse.md) | 不可绕过的三维预算熔断 | ACCEPTED |
| [0005](../adr/0005-deterministic-verification-gate.md) | 确定性验证门禁与 Evidence 绑定候选 SHA | ACCEPTED |
| [0006](../adr/0006-local-first-no-tamper-proof.md) | 本地优先与非防篡改声明 | ACCEPTED |
| [0007](../adr/0007-dual-agent-daemon-authority.md) | 双 Agent 分权与 Daemon 单一权威 | ACCEPTED |
| [0008](../adr/0008-demo-isolated-origin.md) | Demo 原型预览服务独立 Origin 与 iframe sandbox 隔离架构 | ACCEPTED |
| [0009](../adr/0009-serial-graph-fingerprint.md) | 任务 Graph 串行拓扑与变更指纹点亮机制 | ACCEPTED |
| [0010](../adr/0010-demo-optional-not-hard-gate.md) | Demo 降为体验增强项，允许跳过 Demo 直签合同 | ACCEPTED |
| [0011](../adr/0011-audit-sidecar-records-path.md) | 无 Git 审计侧车统一落点 `.stagent/records/{contract_id}/` | ACCEPTED |
| [0012](../adr/0012-merged-as-terminal-state.md) | `MERGED` 为唯一运行时交付终态 | ACCEPTED |
| [0013](../adr/0013-cli-isolation-without-bare.md) | Claude Code 隔离弃用 `--bare`，改用 `--setting-sources ""` | ACCEPTED |

**引用纪律**：被取代的 ADR 不得删除，须在文件头标注 `SUPERSEDED by ADR-XXXX` 并保留原文。**决策 ≠ 已实现**——是否落地以 [`development-tasks.md`](./development-tasks.md) 任务卡状态与测试为准。

---


## 9. 数据模型增强定义 (Enhanced Schemas)

### 9.1 软件合同 Schema (v1.3.0) `[待实现 - 目标数据模型，归入 P0.2c 路线图]`

```typescript
export interface SoftwareContractV13 {
  contract_id: string;
  schema_version: "1.3.0";
  contract_revision: number;
  created_at: string;
  creator: "user" | "supervisor" | "system:fast-path"; // 支持 Fast Path 系统留痕签发
  change_request_id?: string; // 关联的变更诉求或质疑 ID (P-24)
  
  conversation_ref?: {
    session_id: string;
    message_ids: string[];
    context_policy: "USER_SELECTED" | "SESSION_SUMMARY" | "NO_TRANSCRIPT";
  };
  
  supervisor_metadata?: {
    suggestion_id: string;
    maturity_assessment?: {
      score?: number; // 仅建议性信号，禁止作为授权或状态门禁
      rationale: string[];
      unresolved_questions: string[];
      model_id?: string;
      assessed_at: string;
    };
    suggested_scope?: { writable_paths: string[]; readonly_paths: string[]; strictly_forbidden_paths: string[] };
  };
  
  worker_spec: {
    adapter_id: string;
    runtime_kind: "MANAGED_TOOL_CALLING" | "EXTERNAL_CLI";
    model_id?: string;
    control_mode: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL";
    adapter_version: string;
    billing_model?: "PER_TOKEN" | "SUBSCRIPTION" | "QUOTA";
    verified_on?: { cli_version: string; verified_at: string };
  };

  lifecycle_state:
    | "DRAFT" | "PENDING_APPROVAL" | "PREPARING" | "EXECUTING" | "VERIFYING"
    | "PENDING_RESUME" | "AUDITED" | "MERGED" | "ABORTED";

  presentation_state?: PresentationState; // Daemon 独占持久化并广播的面向用户 15 状态 (P-20)

  intent: {
    title: string;
    description: string;
    acceptance_criteria: string[];
    risk_level: "LOW" | "MEDIUM" | "HIGH";
  };

  scope: {
    writable_paths: string[];
    readonly_paths: string[];
    strictly_forbidden_paths: string[];
  };

  // 显式审批凭证实体 (闭环 P0 缺陷：审批与意图严格解耦，与 approval.status 严格对齐)
  approval: {
    status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
    approved_by?: "user" | "system:fast-path" | "user:delegated" | "user:legacy"; // 包含历史迁移合成凭证
    approved_at?: string;
    approval_signature?: string; // 审批凭证签名或摘要哈希
    approved_contract_revision?: number; // 绑定的合同版本号，防止版本漂移
    admitted_policy_decision?: "ADMITTED_AUTOMATIC" | "ADMITTED_EXPLICIT_APPROVAL";
    decision_notes?: string;
  };

  // 显式授权凭证实体 (闭环 P0 缺陷：细粒度 Git、命令与网络权限)
  authorization: {
    git: {
      target_branch: string;
      task_worktree_branch: string;
      allowed_operations: Array<"status" | "diff" | "add" | "commit" | "checkout" | "branch" | "merge">;
      forbidden_flags: string[]; // 默认强制包含 ["--force", "-f", "--hard", "--amend", "--no-verify"]
      enforce_clean_base: boolean;
    };
    commands?: {
      allowed_commands: string[];
      forbidden_commands: string[];
      max_execution_seconds: number;
    };
    network?: {
      allow_outbound: boolean;
      allowed_hosts: string[];
    };
  };

  execution_policy: {
    use_worktree: boolean; // PROTECTED 强制为 true；VIBE 可为 false 但强制绑定 checkpoint
    auto_checkpoint_handle?: string;
    max_tokens?: number;
    max_tool_invocations?: number;
    max_verification_retries: number;
    timeout_seconds: number;
    suspend_reason?:
      | "USER_MANUAL_PAUSE"
      | "BUDGET_EXCEEDED"
      | "VERIFICATION_RETRY_EXHAUSTED"
      | "SUSPICIOUS_DRIFT"
      | "WAITING_EXTERNAL_APPROVAL"
      | "LOCK_LEASE_CONFLICT";
  };

  verification_spec: {
    commands: Array<{
      command_id: string;
      command_line: string;
      timeout_seconds: number; // 支持别名分层默认值 (lint 60s / test 300s / build 600s)
      applies_to_node_ids?: string[]; // 关联的 Task Graph 节点 ID
    }>;
  };
}
```

**Schema 不变式与 Zod 状态校验规则 (P-13 / v1.6.0 闭环)**：
1. **执行态审批强制绑定**：当 `lifecycle_state` 进入 `EXECUTING`、`VERIFYING`、`AUDITED` 或 `MERGED` 时，`approval.status` 必须为 `"APPROVED"`，且 `approval.approved_contract_revision === contract_revision`；
2. **升版审批失效规则**：任何 Scope 扩充、命令白名单变更或预算上限追加，均递增 `contract_revision`，同时**强制将 `approval.status` 重置为 `PENDING_REVIEW`**，驱动合同回退至 `PENDING_APPROVAL`；
3. **不可覆盖 Git 禁区**：`authorization.git.forbidden_flags` 严禁为空，系统强制内嵌 `["--force", "-f", "--hard", "--amend", "--no-verify"]`，任何用户配置均不可覆盖；
4. `control_mode === "UNCONTROLLED_EXTERNAL"` 的 Worker 不得进入合同执行状态，不得生成可合并 Evidence。

---

### 9.1.1 合同生命周期与审批子状态联动规则

| 合同 `lifecycle_state` | 合同 `approval.status` | 迁移与约束语义 |
|---|---|---|
| `DRAFT` | `DRAFT` | 方案草案探讨与 Demo 原型试玩中（**唯一合法配对，严格对齐 `src/lib/state-machine.ts`**） |
| `PENDING_APPROVAL` | `PENDING_REVIEW` | 命中高风险或保护清单，等待用户单项勾选批准 |
| `PREPARING` | `APPROVED` | 原型获批，Task Graph 生成与 Worktree 初始化中 |
| `EXECUTING` | `APPROVED` | Agent 按拓扑施工；用户可发起停止 |
| `VERIFYING` | `APPROVED` | 自动化测试与检查执行中 |
| `PENDING_RESUME` | `APPROVED` | 预算耗尽或重试耗尽挂起，对应 UI 态 `PAUSED` |
| `AUDITED` | `APPROVED` | 双门禁检查通过，支持真机试玩与一键交付 |
| `MERGED` | `APPROVED` | 代码已原子 Squash 合入主干，终态 |
| `ABORTED` | `REJECTED` 或 `APPROVED` | 任务被终止或手动放弃，终态 |

---

#### 9.1.1.1 Fast Path 与特殊迁移边扩展规约 `[v1.6.1 闭环 C-02, C-07, C-08]`

为支持 Fast Path 自动化准入与运行期故障自愈，同时维护状态机物理执行纪律，`src/lib/state-machine.ts` 中的 `LIFECYCLE_TRANSITIONS` 迁移表做如下严格受控增补：

1. **增补 Fast Path 准入边 (C-02)**：
   - **边定义**：`DRAFT → PREPARING`；
   - **转移 Guard 判定**：仅当满足 `approval.approved_by === "system:fast-path" && contract.intent.risk_level === "LOW"` 时合法；
   - **执行纪律**：坚决杜绝 `DRAFT → EXECUTING` 直通跃迁，确保 Worktree 物理创建、分支建立与保护清单挂载必须在 `PREPARING` 阶段由 Daemon 严密执行。随后经既有合法边 `PREPARING → EXECUTING` 唤醒 Worker。
2. **增补挂起恢复工作区自愈边 (C-07)**：
   - **边定义**：`PENDING_RESUME → PREPARING`；
   - **转移 Guard 判定**：仅当探测到任务工作区物理目录解挂或丢失、但分支引用完好时触发，由 Daemon 幂等重建 Worktree 后自动进入 `EXECUTING`。
3. **增补外部改码级联降级边 (C-08)**：
   - **边定义**：`AUDITED → VERIFYING`；
   - **转移 Guard 判定**：仅当 Task Graph 出现 `STALE_REVERIFY` 节点时原子触发，同步将 Evidence 标记为 `STALE`，关闭合并门禁。

---

### 9.2 证据包 Schema (EvidenceBundleV12) `[待实现 - 目标数据模型，归入 P0.2c 路线图]`

```typescript
export interface EvidenceBundleV12 {
  evidence_id: string;
  schema_version: "1.2.0";
  contract_id: string;
  contract_revision: number;
  change_request_id?: string;
  worker_session_id?: string;
  generated_at: string;
  
  // 证据有效性状态 (防止陈旧证据被误用)
  status: "VALID" | "STALE" | "REVOKED";
  
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_minor_units?: number;
    reported_cost_minor_units?: number;
  };

  verification_results: Array<{
    command_id: string;
    exit_code: number;
    stdout_summary: string;
    stderr_summary: string;
    duration_ms: number;
  }>;

  base_commit_sha: string;      // 检出时基线 HEAD SHA
  candidate_commit_sha: string; // 施工完毕候选 HEAD SHA
  
  // 产物文件内容 SHA-256 指纹集合 (防止验证与合入间隙发生静默篡改)
  fingerprints: Record<string, string>; // relative_path -> sha256_hash

  // 严格联合 Scope 审查报告 (涵盖跟踪与未跟踪全量文件)
  scope_audit: {
    checked_files: string[];
    untracked_files: string[];
    violations: string[];
    is_strictly_within_scope: boolean;
  };

  can_merge: boolean; // 仅能由 Daemon 计算派生：status === 'VALID' 且所有 exit_code === 0 且 violations.length === 0
}
```



---

### 9.3 运行时错误码与原因码映射表 (ErrorCode Catalog) `[v1.6.0 规范统一]`

| 运行时错误码 (ErrorCode) | 终态原因码 (ReasonCode) | 面向非技术用户解释与恢复建议 |
|---|---|---|
| `E_WORKSPACE_LOCKED` | `WORKSPACE_LOCK_FAILED` | 工作区当前正被其他任务占用，请等待其完成或回收孤儿锁 |
| `E_LOCK_LEASE_EXPIRED` | `LEASE_EXPIRED` | 任务锁心跳租约过期，系统已安全回收，请重试任务 |
| `E_SCOPE_VIOLATION` | `SCOPE_VIOLATION` | 检测到越界写入未授权文件，系统已阻断；可申请扩充授权 |
| `E_UNTRACKED_SCOPE_VIOLATION` | `SCOPE_VIOLATION` | 检测到在授权目录外创建了未跟踪的新文件，已坚决阻断合并 |
| `E_WRITE_CONFLICT` | `WRITE_CONFLICT` | 施工文件被外部编辑器改动，请点击刷新重新同步基线 |
| `E_BUDGET_EXCEEDED` | `BUDGET_EXHAUSTED` | Token 消耗达到安全预算上限，可点击追加预算后继续 |
| `E_INVOCATION_LIMIT` | `BUDGET_EXHAUSTED` | 工具调用次数超出预算限制，请确认后追加预算 |
| `E_COMMAND_TIMEOUT` | `EXECUTION_TIMEOUT` | 验证命令执行超出预设超时阈值，已安全中断执行 |
| `E_STOP_TIMEOUT` | `TERMINATION_FAILED` | 停止任务时进程在 15s 内未完全退出，已触发安全自愈标记 |
| `E_WORKER_HEARTBEAT_LOST` | `EXECUTION_FAILED` | Worker 连续 90s 无响应失联，任务已终止并释放锁 |
| `E_CONFLICT_DRIFT` | `CONCURRENT_DRIFT` | 目标分支在施工期间发生了新提交，建议一键重基最新代码 |
| `E_GIT_DIRTY_BASE` | `DIRTY_BASE_BRANCH` | 主工作树存在未提交的冲突代码，请先提交或保存现场 |
| `E_VERIFICATION_FAILED` | `VERIFICATION_FAILED` | 自动化检查或测试未通过，请查看报错详情或让 AI 修复 |
| `E_EMPTY_VERIFICATION_BLOCKED` | `INVALID_VERIFICATION_SPEC` | 验证命令集合为空，禁止虚假点亮，已阻断任务流转 |

---

### 9.4 业务功能树与任务 Graph Schema (TaskGraphV1) `[待实现：P4.5]`

```typescript
/** 单个 DAG 节点（依赖关系内嵌于 dependencies，不引入独立 edges 集合，避免双事实源） */
export interface TaskGraphNode {
  node_id: string;
  title: string;
  description: string;
  associated_feature_id: string;
  target_files: string[];
  dependencies: string[]; // 依赖的前置 node_id 列表 (无环拓扑)

  // 节点统一七态 (P-11)
  status: "PENDING" | "RUNNING" | "ILLUMINATED" | "FAILED" | "BLOCKED" | "STALE_REVERIFY" | "REPAIRING";

  // 点亮验证模式 (P-22 / D-5)
  verification_mode: "COMMAND" | "MANUAL_REVIEW" | "NONE";

  execution_metadata?: {
    started_at?: string;
    completed_at?: string;
    node_patch_fingerprint?: string; // 节点代码变更指纹，取代局部 commit (P-09)
    checkpoint_sha?: string;         // 可选的本地保护点快照
    duration_ms?: number;
    exit_code?: number;
    error_message?: string;
    user_manual_approved?: boolean;
  };
}

export interface TaskGraphV1 {
  schema_version: "1.0.0"; // 显式版本标识，支持向后兼容迁移 (4.3)
  graph_id: string;
  contract_id: string;
  revision: number;
  updated_at: string;
  origin_change_request_id?: string; // 溯源的变更诉求 ID (P-24)
  
  functional_tree: {
    root_module: string;
    modules: Array<{
      module_id: string;
      title: string;
      description: string;
      features: Array<{
        feature_id: string;
        name: string;
        description: string;
      }>;
    }>;
  };
  
  execution_dag: {
    nodes: TaskGraphNode[];
  };
}
```

> **DAG 权限不变式（授权子集约束）**：TaskGraph 仅定义任务拓扑结构与构建步骤，**不具备授权凭证属性**。DAG 任何节点声明的读写路径与命令集，必须是其父合同 `SoftwareContract.authorization` 的严格子集；任何超出合同范围的节点定义均属非法，将被 Daemon 调度器直接拒载。
>
> **落地口径**：该校验发生在 Daemon **装载** `task_graph.json` 的阶段（装载期拒绝），而非节点执行期的越权拦截；`TaskGraphNode.target_files` 与节点关联的验证命令子集（合同 `verification_spec.commands` 经 `applies_to_node_ids` 映射）须逐项比对父合同 `authorization`，任一项越界即整图拒载并向 UI 呈递白话拒载原因，禁止「先装载、后逐节点纠正」。节点不得以新增目标文件、追加验证命令或声明新依赖的方式自行提权。

---

### 9.5 质疑自查报告 Schema (SupervisorDisputeReportV1) `[待实现：P5.7]`

```typescript
export interface SupervisorDisputeReportV1 {
  schema_version: "1.0.0"; // 显式版本标识，支持向后兼容迁移 (4.3)
  report_id: string;
  contract_id: string;
  change_request_id: string; // 全局统一关联键 (P-24)
  created_at: string;
  user_dispute_query: string;
  
  verdict: {
    disposition: "IMPLEMENTATION_DEVIATION" | "REQUIREMENT_DRIFT" | "AMBIGUOUS_NEED_USER_CHOICE";
    confidence: number; // 0.0 - 1.0 (必须声明置信度，P-06)
    confidence_threshold: number; // 默认 0.7
    summary_zh: string;  // 面向非技术用户的白话归因总结
  };
  
  evidence_triad: {
    prompt_intent: {
      matched_session_message_ids: string[];
      excerpt: string;
    };
    spec_commitment: {
      requirements_doc_path: string;
      matched_section?: string;
      excerpt: string;
    };
    code_reality: {
      inspected_files: string[];
      diff_snippet?: string;
      runtime_logs?: string[];
    };
  };
  
  recommended_actions: Array<{
    action_type: "AUTO_REPAIR_BUG" | "INCREMENTAL_SPEC_REVISION" | "USER_MANUAL_DISAMBIGUATION";
    title_zh: string;
    description_zh: string;
    is_free_repair: boolean; // 是否免二次签署合同 (严格子集检查通过后为 true)
  }>;
}
```

---

### 9.6 面向非技术用户的 15 状态枚举定义 (PresentationState) `[待实现：P3.7]`

```typescript
export type PresentationState =
  | "EXPLORING"           // 正在探讨需求
  | "DEMO_PREVIEW"        // 原型试玩中 (独立 Origin)
  | "GRAPH_MAPPING"       // 任务拆解中
  | "NEEDS_APPROVAL"      // 需要确认授权
  | "EXECUTING"           // 正在施工
  | "STOPPING"            // 正在停止并回收资源
  | "PAUSED"              // 已暂停，等你决定 (预算耗尽或重试超限)
  | "VERIFYING"           // 正在检查成果
  | "FAILED"              // 检查未通过
  | "REAL_PLAYTEST"       // 真实环境试玩中
  | "DISPUTED_INSPECTING" // 质疑自查中
  | "READY_TO_MERGE"      // 验收完成，等待交付
  | "CONFLICT"            // 项目发生并发冲突
  | "MERGED"              // 已合入项目
  | "ABORTED";            // 任务已终止
```




---

### 9.7 Supervisor 结构化提案 Schema (SupervisorProposalV1) `[v1.6.0 闭环]`

为落实 Supervisor“零执行权”原则，其所有产出物必须封装为符合以下强类型定义的结构化提案，由 Daemon 校验后原子落盘：

```typescript
export type SupervisorProposalV1 =
  | IntentProposalV1
  | DemoArtifactProposalV1
  | TaskGraphProposalV1;

/** 需求规范提案 (落地至 .stagent/specs/requirements.md) */
export interface IntentProposalV1 {
  proposal_id: string;
  proposal_type: "INTENT_SPEC";
  created_at: string;
  summary: string;
  requirements_markdown: string;
  suggested_risk_level: "LOW" | "MEDIUM" | "HIGH";
  acceptance_criteria: string[];
}

/** 静态 Mock 原型提案 (落地至 .stagent/demo/ 独立环境) */
export interface DemoArtifactProposalV1 {
  proposal_id: string;
  proposal_type: "MOCK_DEMO";
  created_at: string;
  snapshot_id: string;
  entry_point: string; // 默认 "index.html"
  files: Array<{
    relative_path: string; // 如 "index.html", "style.css", "mock_data.json"
    content: string;
    size_bytes: number; // 单文件 <= 2MB
  }>;
}

/** 任务节点提案输入模型 (在类型层面彻底剔除运行期状态，落实 C-06 契约防御) */
export type TaskGraphNodeProposalInput = Omit<
  TaskGraphNode,
  "status" | "execution_metadata"
>;
// 落盘纪律：Daemon 校验通过后必须强制覆写每个节点 status = "PENDING"，
// 并清空 execution_metadata；Supervisor 无法通过任何字段影响节点点亮状态。

/** 任务功能树与 DAG 拓扑提案 (落地至 .stagent/specs/task_graph.json) */
export interface TaskGraphProposalV1 {
  proposal_id: string;
  proposal_type: "TASK_GRAPH";
  created_at: string;
  functional_tree: TaskGraphV1["functional_tree"];
  execution_dag: {
    // 拓扑边由节点 dependencies 表达（见 §9.4），不另设 edges 集合
    nodes: TaskGraphNodeProposalInput[];
  };
}
```
## 10. v0.1 实施路线与验收门槛 (Implementation Roadmap)

阶段按严格依赖排序；任何模块不得绕过前置安全与状态机基线。通过上一阶段 Gate 校验方可进入下一阶段。

| 阶段 | 阶段目标 | 核心交付物与验收标准 (P-25 补齐) |
|---|---|---|
| **P0**：工程底座与契约 | Schema v1.2.0、锁文件、CI 门禁、不变式测试 | Lint/TypeCheck CI 全绿；9 态 `lifecycle` × 4 审批态配对矩阵不变式测试通过（`tests/unit/state-machine-matrix.test.ts`，15 展示态投影测试归 P3.7） |
| **P0.2c**：契约与状态机演进 `[v1.6.1 认领 C-01]` | Schema v1.3.0 (`approval`/`authorization`)、Fast Path 与自愈迁移边 | `contract-schema-v13.test.ts` 全绿；增补 Fast Path (`DRAFT->PREPARING`)、自愈 (`PENDING_RESUME->PREPARING`) 与降级 (`AUDITED->VERIFYING`) 迁移边通过全量矩阵测试；`migrateContractToV13` 零静默授权 |
| **P1**：Daemon 与 Worktree | CLI、loopback 服务、Worktree 生命周期、互斥锁 | 主工作树代码零污染；崩溃恢复 (≤5s)；支持平台 (macOS/Linux/Win) 测试通过 |
| **P2**：Gateway 与 Adapter | 受控 Worker Adapter；路径/命令/预算三维熔断 | 越界文件写入 100% 检出；命令超时分层看门狗 (60s/300s/600s)；无未受控绕过 |
| **P3**：IDE Workspace 最小闭环 | 三栏布局、Monaco 编辑、Diff、右栏流式会话 | 会话打断时延 P95 ≤ 2s；首 Token P95 ≤ 1s；UI 断线重连零数据丢失 |
| **P3.5**：Vibe 模式与保护清单 | 运行模式切换、Auto-Checkpoint、全局保护清单 | 无保护清单全程零弹窗；一键无损撤销；保护路径任意模式下被坚决拦截 |
| **P3.7**：状态投影与防死锁引擎 `[新增]` | 15 状态投影持久化、五类死锁自愈机制 | 广播持久化 `presentation_state`；D-1~D-5 故障注入测试 100% 通过（15s停止超时、90s心跳租约、冲突二选一） |
| **P4**：Supervisor 与合同审批 | 意图澄清、L0 确定性规则 / L1 强模型生成合同草案 | Supervisor 保持零执行权；未触保护清单轻量交互，触保护清单明确弹窗审批 |
| **P4.5**：原型与 Graph 引擎 `[新增]` | Demo 原型受控落盘与独立 Origin 隔离、Task Graph 点亮 | Supervisor 提案受控落盘 (单文件≤2MB)；Demo iframe sandbox 隔离与 CSP 阻断 (负例 E2E 通过)；拓扑串行调度与变更指纹物理点亮 |
| **P5**：独立 Evidence 与一键合并 | 验证命令退出码、双门禁核销、Squash Merge | Evidence 由 Daemon 生成；`can_merge` 仅由退出码派生；通过后一键合入无冗余弹窗 |
| **P5.5**：成熟 Agent 受控实测 | Claude Code / cursor-agent / OpenHands 实机对接 | 各 Adapter 记录真实 `verified_on`；4 类绕过负例在真实 CLI 上全部失败关闭 |
| **P5.7**：质疑自查与增量演化 `[新增]` | 三方比对引擎、置信度治理、自动返工子集检查 | 质询自查看门狗 60s；`confidence < 0.7` 自动降级呈现事实；自动返工严格子集检查拦截越权；统一关联键 `change_request_id` 资产溯源贯通 |
| **P6**：集成 Dogfood 实测 | 真实业务仓库端到端八步全生命周期验证 | 真实记录费用、时延、失败自愈；发布说明完整披露未验证边界 |
| **v0.2+**（推迟，另行立项） | 多任务并行 Worktree 流水线（RFC-2026-002）、OS 级容器沙箱、桌面 HUD 徽章 | 另行立项评审 |

---

### 10.1 v0.1 退出条件与成熟度边界声明

只有 P0–P6（含新增的 P3.7、P4.5、P5.7）全部验收通过并在真实仓库完成端到端试用，才可将 v0.1 标记为非技术用户与开发者可试用版本。

若在发布阶段存在未完成项目（例如 Demo 视口尚未实现独立端口隔离、Worker 仅通过部分命令测试、或自查看门狗未完全覆盖），**必须在发布说明中明示技术限制**，坚决不得对外宣传为“具备操作系统级安全容器”或“能够 100% 保证模型归因正确”。




---

### 10.2 v1.5.x 至 v1.6.1 数据模型演进与向后兼容迁移指南 (Migration Guide) `[v1.6.1 深度闭环]`

为了确保工程实施团队在平滑升级现有代码库的同时不破坏历史任务归档，系统制定严格的数据模型迁移指南：

#### 10.2.1 变更清单与映射规则
1. **合同模型演进 (`SoftwareContractV12` ➔ `SoftwareContractV13`)**：
   - **新增必填项**：`authorization.git`。迁移策略：若读取历史合同缺少该字段，Daemon 自动填充安全默认值（`allowed_operations: ["status", "diff", "add", "commit", "checkout", "branch", "merge"]`，`forbidden_flags: ["--force", "-f", "--hard", "--amend", "--no-verify"]`，`enforce_clean_base: true`）；
   - **新增审批项**：`approval`。迁移策略：
     - **执行态族白名单回填 (C-03)**：仅当历史合同处于执行态族 `{PREPARING, EXECUTING, VERIFYING, PENDING_RESUME, AUDITED, MERGED}` 时，自动回填 `status: "APPROVED"`，`approved_by: "user:legacy"`；
     - **待审与草案态安全保持**：历史合同若处于 `DRAFT` 则回填 `status: "DRAFT"`；若处于 `PENDING_APPROVAL` 则回填 `status: "PENDING_REVIEW"`，**绝对严禁静默回填为 APPROVED**；
     - **中止态闭环分支**：历史合同若处于 `ABORTED`，依据历史元数据判断——若曾获批后因故障中止则保留 `status: "APPROVED"`，若因审批被拒绝中止则回填 `status: "REJECTED"`，杜绝被拒合同重回 DRAFT 触犯 G-17 规则；
     - **显式安全不变式**：*数据迁移过程仅做格式平移与必要凭证补全，严禁单向将未授权或待审批合同升格为授权状态*。
2. **证据包模型演进 (`EvidenceBundleV11` ➔ `EvidenceBundleV12`)**：
   - **新增字段**：`status`（默认为 `"VALID"`）、`base_commit_sha`、`fingerprints`（空对象回填）与 `scope_audit.untracked_files`（空数组回填）。
3. **任务互斥锁 JSON 结构化**：
   - 彻底废弃旧版空锁文件或仅含单一 PID 的旧锁。升级后，Daemon 启动时若发现旧格式锁，一律视为陈旧锁自动清理并初始化新的标准租约格式。
4. **宽容读取与向后兼容规约 (C-09)**：
   - 后续各版本 Schema 解析器均应启用 `.passthrough()` 策略或安全宽松解析，允许读取含有更高版本扩展字段的数据，防止开发者在 Git 多分支频繁切换时发生反序列化崩溃；
   - 提供降级导出工具函数 `downgradeContractToV12`，支持将新版合同安全擦除扩展字段降级为 v1.2 兼容副本。

#### 10.2.2 运行时升级与数据迁移函数参考 (TypeScript)
```typescript
/**
 * 历史合同升级迁移函数 (落实 C-03 零静默授权与状态闭环)
 */
export function migrateContractToV13(legacy: any): SoftwareContractV13 {
  if (legacy.schema_version === "1.3.0") return legacy;

  const executionStates = new Set([
    "PREPARING", "EXECUTING", "VERIFYING", "PENDING_RESUME", "AUDITED", "MERGED"
  ]);

  let approvalEntity: SoftwareContractV13["approval"];
  if (legacy.approval) {
    approvalEntity = legacy.approval;
  } else if (executionStates.has(legacy.lifecycle_state)) {
    approvalEntity = {
      status: "APPROVED",
      approved_by: legacy.creator === "system:fast-path" ? "system:fast-path" : "user:legacy",
      approved_at: legacy.created_at,
      approved_contract_revision: legacy.contract_revision ?? 1,
      admitted_policy_decision: legacy.creator === "system:fast-path" ? "ADMITTED_AUTOMATIC" : "ADMITTED_EXPLICIT_APPROVAL",
      decision_notes: "自动迁移补齐：历史处于执行态族合同安全回填 APPROVED"
    };
  } else if (legacy.lifecycle_state === "PENDING_APPROVAL") {
    approvalEntity = {
      status: "PENDING_REVIEW",
      decision_notes: "自动迁移补齐：历史待审批合同安全保持 PENDING_REVIEW，严禁静默授权"
    };
  } else if (legacy.lifecycle_state === "ABORTED") {
    const wasRejected = legacy.abort_reason === "USER_REJECTED" || legacy.rejection_reason;
    approvalEntity = {
      status: wasRejected ? "REJECTED" : "APPROVED",
      approved_by: wasRejected ? undefined : "user:legacy",
      approved_at: wasRejected ? undefined : legacy.created_at,
      decision_notes: wasRejected ? "历史被拒合同归档为 REJECTED" : "历史获批后终止合同归档"
    };
  } else {
    // DRAFT 及其他草案态
    approvalEntity = {
      status: "DRAFT",
      decision_notes: "自动迁移补齐：草案态安全回填 DRAFT"
    };
  }

  return {
    ...legacy,
    schema_version: "1.3.0",
    approval: approvalEntity,
    authorization: legacy.authorization ?? {
      git: {
        target_branch: "main",
        task_worktree_branch: `stagent/task-${legacy.contract_id}`,
        allowed_operations: ["status", "diff", "add", "commit", "checkout", "branch", "merge"],
        forbidden_flags: ["--force", "-f", "--hard", "--amend", "--no-verify"],
        enforce_clean_base: true
      }
    }
  };
}

/**
 * 降级导出工具函数 (落实 C-09 向后兼容保障)
 * 允许在切换至旧版代码分支时，将 v1.3.0 合同安全擦除扩展字段并生成 v1.2.0 兼容副本
 */
export function downgradeContractToV12(v13: SoftwareContractV13): any {
  const { approval, authorization, change_request_id, presentation_state, ...v12Base } = v13;
  return {
    ...v12Base,
    schema_version: "1.2.0"
  };
}
```

---

## 11. 定稿后一致性修订注记 (Post-Final Consistency Notes)


> 本节记录 v1.6.1 定稿签发后的一致性修补，不改变任何架构决策，仅消除内部表述歧义与类型不一致，或将既有不变式作书面显式化。

1. **§6.3.1 `ABORTED` 行**：`approval.status` 由"保持历史或 `REJECTED`"更正为"`REJECTED` 或 `APPROVED`（保留历史审批事实）"，与 §9.1.1 配对矩阵严格一致。
2. **§6.3.1 `(AUDITED, APPROVED)` 四分支**：新增判定优先级 `CONFLICT` > `DISPUTED_INSPECTING` > `REAL_PLAYTEST` > `READY_TO_MERGE`，要求投影函数按序短路求值，消除运行时判据同时为真时的实现自由裁量。
3. **§9.4**：抽出具名 `TaskGraphNode` 接口（原先为内联匿名类型），使 §9.7 的 `Omit<TaskGraphNode, "status" | "execution_metadata">` 具备可解析的类型引用；同时明确 `execution_dag` 仅含 `nodes`，拓扑边由 `dependencies` 表达，不设独立 `edges` 集合（避免双事实源）。
4. **§9.7**：删除对不存在的 `TaskGraphV1["execution_dag"]["edges"]` 的引用；补"Daemon 落盘时强制覆写 `status = "PENDING"` 并清空 `execution_metadata`"的落盘纪律。
5. **§10 P0 行**：验收表述由"15 状态映射"更正为"9 态 `lifecycle` × 4 审批态配对矩阵不变式测试（`state-machine-matrix.test.ts`）"，15 展示态投影测试归 P3.7。
6. 本注记所述修改均为文档层一致性修补，**不涉及代码**；`migrateContractToV13`、Schema v1.3.0 等仍按 P0.2c 阶段实施。
7. **职责隔离与权威来源增补（2026-10-23，对应 RFC-2026-002 §7）**：新增三处设计约束层补充，均不改变任何数据模型、接口定义与实施路线——①§0.4 增补第 5 条「用户责任边界原则」；②§9.4 增补「DAG 权限不变式（授权子集约束）」；③§5.1 目录规范增补 `specs/revisions/` 与需求快照机制。三处均为约束声明与目录说明，不引入新字段、不新增错误码，现有代码与测试不受影响。
8. **控制台同源托管 vs Demo 独立 Origin（2026-10-24，打开项目 DX 口径显式化）**：补充书面区分，**不改变** ADR-008 / §4.4 的 Demo 隔离决策，亦不新开 ADR——① **控制台（验收工作台）**允许由 Daemon 在同一 `127.0.0.1` Origin 托管静态/客户端资源（`TASK-D.1b` 方向），以便 `stagent open` 少终端、自动 `#token=`；鉴权仍遵守 D.1（loopback、fragment Token、WS AUTH、Origin/Host 校验），**不得**因同源托管而取消 AUTH。② **Demo 原型预览**必须继续在**独立 Origin**（如 4100~4110）运行，iframe 仅 `sandbox="allow-scripts"`（禁止 `allow-same-origin`），CSP 阻断连接 Daemon；控制台与 Daemon 同源**不**构成 Demo 可同源的理由。③ 打开项目演进：`D.1b` 单窗口托管 → `D.1c` 最近重开 → `D.1d` 修复同源空白壳（v0.1 生产可用单窗口；静态 SPA 可由 Daemon 同源服务）→ **`D.1e` 系统级文件夹选择器 / 桌面壳推迟至 v0.2+（P5.8）**；愿景「Import 与工作台同壳」的原始过程稿已随 `docs/archive/` 移除，现行口径以上文 `D.1b`–`D.1e` 演进为准。本条为表述显式化与演进路标，**不引入**新字段/错误码/状态机边。
9. **工作台指挥权呈现纪律（2026-10-24，C.9a 轻量锚定）**：控制台首屏按连接与会话态只保留**一个**主指挥信号（无钥匙 / 有钥匙空闲 / 进行中），其它面板与横幅降为次要。本条仅锚定**呈现纪律**，**不改变**鉴权（D.1 loopback+#token/AUTH）、**不改变** Demo 独立 Origin（ADR-008）、**不引入**新字段/错误码/状态机边；助手模式互斥、打开面板生命周期、进行中中栏让路分属任务卡 C.9b/c/d，同属呈现层。 **续（2026-10-24，C.10a/b 轻量锚定）**：进行中须可退出且无空「让路」壳（C.10a）；设置页主视线为模型钥匙、工程师项进「高级」且保留深链/回跳（C.10b）。仍仅呈现/信息层级，**不改变**鉴权与 Demo Origin；界面暗号清扫（C.10c）可并入统一抛光，不挡前两张。 **续（2026-10-24，C.10c 立卡轻量锚定）**：工作台用户可见标签白话化（项目审阅 / 合同操作台 / 验证输出）与任务图谱单入口属**呈现/导航命名**；**不改变**鉴权、Demo Origin、Studio 四视口状态机契约本体。 **续（2026-10-24，C.10c 合入轻量锚定）**：用户可见标签已白话化并收图谱双入口；仍仅呈现/导航命名。 **续（2026-10-24，C.10d 立卡轻量锚定）**：左栏默认主视线为打开/切换项目；规范与资产与完整文件树默认收进折叠「项目文件」属**呈现/信息层级**；**不改变**鉴权、Demo Origin、文件读写与合同准入。 **续（2026-10-24，C.10d 合入轻量锚定）**：左栏老板主路径已落地（`left-project-files` 默认折叠）；仍仅呈现/信息层级。 **续（2026-10-24，C.10g 合入轻量锚定）**：资源管理器文件树可点文件夹展开/折叠、默认只展开第一层属**呈现交互**；**不改变**鉴权、Demo Origin、文件读写契约。 **续（2026-10-24，C.10h 合入轻量锚定）**：资源管理器右键删除 + 确认、尽量废纸篓已落地属**呈现交互**；删除经鉴权 API + P.1 保护清单；**不改变**鉴权语义、Demo Origin、保护清单规则本身。 **续（2026-10-24，C.10i 合入轻量锚定）**：文件树第一批（顶栏折叠整树、新建文件/文件夹、右键 Finder/复制路径/重命名/删除）属**呈现交互 + 用户主动文件操作**；写操作经鉴权 API + P.1；**不改变**鉴权语义、Demo Origin、保护清单规则本身。Cursor 其余右键能力见 v0.2+ RFC 锚定（不实施）。 **续（2026-10-24，C.10j 合入轻量锚定）**：中栏打开 Markdown 默认好看预览、可切源码属**呈现交互**；源码保存仍走既有 Worktree 门禁；**不改变**鉴权语义、Demo Origin、文件读写契约本体；不做完整 VS Code（分栏预览/面包屑/插件生态）。 **续（2026-10-24，打开文件标签可关闭热修）**：普通文件 Tab 须可关闭（`closable`）；属呈现交互；**不改变**鉴权与 Demo Origin。 **续（2026-10-24，C.10k 合入轻量锚定）**：右栏主视线只留双方对话（去适配器/历史/元信息/说明书/工具 JSON）；Cursor 右栏对齐能力见 v0.2+ RFC 附录 B（锚定不实施整页复刻）；属**呈现/信息层级**；**不改变**鉴权语义、Demo Origin、一个指挥官纪律。 **续（2026-10-24，C.10l 合入轻量锚定）**：适配器/新会话/历史会话显式控件收进设置「高级」（不回潮右栏）；会话元信息与工具 JSON 仍不展示；属**呈现/信息层级**；**不改变**鉴权语义、Demo Origin、一个指挥官纪律。 **续（2026-10-24，C.10m 合入轻量锚定）**：质疑自查降级裁决按钮接线（`user_choice` → 强制分类）属**指挥面交互收口**；**不改变**鉴权语义、Demo Origin、质疑引擎契约本体（沿用既有 userChoice）。 **续（2026-10-24，C.10n 合入轻量锚定）**：任务图谱无图空态可感知（禁用无效视图切换、刷新 loading、白话空态与确认原型建图 CTA；有图只读提示与选中高亮）属**呈现/信息层级**；**不改变**鉴权语义、Demo Origin、点亮三证与 start/verify 契约。 **续（2026-10-24，C.10n 热修）**：建图 CTA 错误回显任务图谱顶栏属**呈现反馈**；**不改变**鉴权语义、Demo Origin、点亮三证与 start/verify 契约。 **续（2026-10-24，C.10o 合入轻量锚定）**：任务图谱开工/核销入口（UI 接到既有 start/verify；PENDING→RUNNING→点亮；失败黄条）属**指挥面交互收口**；点亮仍只认物理证据；**不改变**鉴权语义、Demo Origin、点亮三证与 start/verify 契约本体。 **续（2026-10-24，C.10p 合入轻量锚定）**：图谱 start/verify 前自动确保/重建任务 Worktree（合入清理后自愈；基线回退）属**执行面自愈**；点亮仍只认物理证据；**不改变**鉴权语义、Demo Origin、点亮三证契约本体。 **续（2026-10-24，C.10q 合入轻量锚定）**：Studio 中栏全景/施工双视角壳与「本轮施工·功能汇总」改名属**呈现/信息层级**；全景禁止施工绿灯；三张真全景图见 v0.2 RFC 附录 C（不实施）；**不改变**鉴权语义、Demo Origin、点亮三证与 start/verify 契约本体。

