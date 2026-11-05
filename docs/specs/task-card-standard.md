# 任务卡就绪标准（Definition of Ready / Done）

> **地位**：现行规范的附属标准。它约束 [`development-tasks.md`](./development-tasks.md) 中的每一张卡，也约束 Stagent 为用户项目生成的每一份机器指令（合同 + DesignNote）。两者用同一把尺子，因为后者就是前者的产品化。
> **上游意图**：`q21`「Agent 现在是否能直接照任务无脑开发？」（[`../scheme.md`](../scheme.md) goal-10）。
> **模板**：[`../templates/05-task-card.md`](../templates/05-task-card.md)。
> **样板**：`TASK-J.2`，它是现有卡中第一张完整满足本标准的卡（审计见 [`../reports/delivery-path-audit.md`](../reports/delivery-path-audit.md) §4）。

---

## 0. 一句话

一张卡能被 Agent 直接执行，当且仅当 Agent 不需要做任何**产品决策**、不需要**猜**任何文件名或接口、不需要**问**做完的标准是什么。

---

## 1. 就绪定义（DoR）——开工前逐条打勾

| # | 条目 | 判定方法 |
| :--- | :--- | :--- |
| R-1 | **溯源**：卡写明对应的方案条目或规格节号 | 「对应规格」字段指向的节号真实存在 |
| R-2 | **一句话目标**：用户或系统可观察的结果，不是动作 | 读完能回答「做完后谁能看见什么变化」 |
| R-3 | **前置依赖**全部为 `COMPLETED`，或明确「无」 | 矩阵状态核对 |
| R-4 | **代码事实**：写明今天的代码哪里不对（`file::symbol` 或 `file:line`） | 指向的文件存在 |
| R-5 | **范围**列出每个要新建或修改的文件路径，以及要新增的导出符号与签名 | 路径与符号写全 |
| R-6 | **非目标**：至少一条，划清与相邻卡的边界 | 存在 |
| R-7 | **PASS**：可执行的断言清单，写明测试文件名与每条断言 | 每条都能翻译成一个 `it(...)` |
| R-8 | **FAIL**：至少一条「出现即不合格」的反例 | 存在 |
| R-9 | **不与任何 ACCEPTED 的 ADR 冲突**；有冲突时卡内必须有「ADR-NNNN 修订」块，写明按哪条改 | 对照 [`../adr/README.md`](../adr/README.md) |
| R-10 | **无未决产品问题**：卡依赖的 `scheme.md` 冲突卡已拍板，依赖的 OQ 已关闭，或卡内写明采用的默认值 | 对照 [`../scheme.md`](../scheme.md) §7～§8 与 [`../ledger/`](../ledger/README.md) |
| R-11 | **估算**：S（≤半天）/ M（≤2 天）/ L（需再拆） | L 卡不得开工，必须拆分 |
| R-12 | **触及安全门禁的卡**写明「不改变：鉴权 / Demo Origin / 点亮三证 / 网关写范围」中哪些不变、哪些变及依据 | ADR-0001 纪律 |

**任一条不满足 = 卡未就绪。** Agent 遇到未就绪的卡，不得自行补全后开工。它应在 [`../ledger/README.md`](../ledger/README.md) 登记缺哪一条，并停在这张卡。

---

## 2. 完成定义（DoD）——合入前逐条打勾

| # | 条目 |
| :--- | :--- |
| D-1 | PASS 清单中的每条断言都有对应测试，并在 CI（或 `node scripts/verify-env.mjs`）中通过 |
| D-2 | `npm run typecheck`、`npm run lint`、`npm test` 全绿；既有失败须是基线已有的，并在 PR 中点名 |
| D-3 | 卡状态回写：矩阵行与卡内「状态」改为 `COMPLETED`，附合入 commit 或 PR 号。按 supervisor §10 判定，不得假 COMPLETED |
| D-4 | 卡新增的错误码 / 原因码已登记进 `src/lib/error-codes.ts`（或对应码表），并在规格码表中出现 |
| D-5 | 卡改变了规格中描述的行为时，规格同 PR 修订 |
| D-6 | 有用户可见变化的卡，PR 附验证截图或录像（Lightsprint 验证集） |
| D-7 | 若卡完成后 [`../scheme.md`](../scheme.md) §11 某条落差关闭，同 PR 更新该行 |

---

## 3. 常见不就绪写法（反例）

| 反例 | 为什么不行 | 改成 |
| :--- | :--- | :--- |
| 「优化方案编译体验」 | 不可观察，无判据 | 「用户发消息后 1.2 秒内中栏出现补丁；超时显示『还在想』」 |
| 「在合适的位置新增一个 store」 | 要猜路径 | 「新建 `daemon/project/plan-store.ts`，导出 `readPlan(repoRoot)` / `writePlan(repoRoot, plan)`」 |
| 「补充必要的测试」 | 不知道测什么 | 「`tests/unit/project-plan.test.ts`：PD-01～PD-12（见 project-decomposition §8）」 |
| 「按 SSOT 实现」 | SSOT 有 1600 行，不知道哪一节 | 「按 supervisor §15.3 的 `ScopePlan` 类型」 |
| 「视情况决定是否需要用户确认」 | 把产品决策推给 Agent | 引用决策（如 delivery-lifecycle §5 SA-1），或先在 `scheme.md` 开冲突卡 |

---

## 4. 卡的拆分规则

- 一张卡只碰一个层：纯函数 / Daemon 接口 / 前端呈现分开。J.2～J.6 的拆法是样板。
- 一张卡的 PASS 清单不超过 12 条断言；超过即拆。
- 跨前后端的契约（类型、HTTP 接口）先单独成卡，并被消费方依赖。这与 [`project-decomposition.md`](./project-decomposition.md) D-7「接口先行」同理。

---

## 5. 对 Stagent 生成的机器指令同样适用

Stagent 给 Worker 的合同 + DesignNote，必须满足本标准的产品化版本：

| 本标准 | 合同 / DesignNote 中的对应 |
| :--- | :--- |
| R-1 溯源 | 合同 `supervisor_metadata.scheme_item_ids`（delivery-lifecycle §6） |
| R-2 目标 | 合同 `intent.title` + `acceptance_criteria` |
| R-4 代码事实 | DesignNote `approach` |
| R-5 文件与签名 | DesignNote `touches` + `interfaces` |
| R-7 PASS | DesignNote `test_plan` + 合同 `verification_spec` |
| R-8 FAIL | 网关越界、`TEST_WEAKENED`、`KNOWLEDGE_DRIFT` 等确定性拒绝 |
| R-10 无未决问题 | 可编译判定「可冻结」（delivery-lifecycle §3） |
| R-11 估算 | 合同桩 `size_estimate` ≤ D-1 上限（project-decomposition §3） |

---

## 6. 任务卡 = 导出的合同

卡内的 ` ```yaml task-card ` 代码块就是一份合同的可入库形态：`SoftwareContract` + DesignNote 拆掉运行时字段（审批、Worker、预算、Git 授权、快照绑定）后剩下的部分。实现与互逆证明在 `src/lib/contract-card.ts`（`splitContract` / `joinContract`，测试 `tests/unit/contract-card.test.ts`）。真实合同用 `stagent export-card --contract-id <id>` 导出；文档里手写的卡也必须能配上运行时字段拼回一份通过 `softwareContractSchema` 的合同。填法见 [`../templates/05-task-card.md`](../templates/05-task-card.md)，样板是 `TASK-C.4`（[`development-tasks-completed.md`](./development-tasks-completed.md#task-c.4)）。

卡分三段：

| 段 | 来源 | 内容 |
| :--- | :--- | :--- |
| `contract` | 合同 | `intent`、`acceptance`（= `supervisor_metadata.acceptance_refs`）、`scheme_item_ids`、`scope`（= `file_system_scope`）、`verification`（= `verification_spec`）、`dependency_changes_allowed` |
| `design` | DesignNote | `approach`、`touches`、`interfaces`、`data_changes`、`dependencies`、`decisions`、`test_plan`、`knowledge_delta`；外加两个只服务于门禁的扩展：`touches[].symbols`、`test_plan[].case` / `debt` |
| `governance` | 只在入库的卡里 | R-1 的 `spec_refs`、R-3 `depends_on`、R-4 `code_facts`、R-6 `non_goals`、R-8 `fail`、R-9～R-12、`delivered` |

门禁 `npm run check:docs`（CI `Docs check` job，纯文档 PR 同样运行）对每张卡核对：

| 规则 | 对应 | 核对什么 |
| :--- | :--- | :--- |
| `card-schema` | — | 能被 `contractCardSchema` 解析；`id` 是任务卡号；`test_plan` 只指向存在的验收；无验证命令时须声明人工确认 |
| `card-dor` | R-1/4/6/8/11/12 | 就绪字段齐全；`COMPLETED` 必须写 `delivered` |
| `card-design` | R-5 / R-7 | 与 Worker 交付时同一套 DN-1～DN-5：`touches` 落在 `scope.writable_paths` 内、自动验收都有 `test_plan`、测试在收录目录里等 |
| `card-verification` | R-7 | 每个 `test_plan` 的测试文件都被某条验证命令跑到 |
| `card-test` | R-7 | 测试文件在 vitest 收录范围内；已完成的卡：文件里有标题含 `case` 的 `it` / `test` 且未 skip |
| `card-touches` / `card-scope` | R-5 | 未开工：要改的文件、只读范围存在；已完成：文件存在、`symbols` 有声明 |
| `card-code-fact` | R-4 | 未完成的卡：`path::symbol`、`path:行号` 对得上今天的代码 |
| `card-deps` | R-3 | 卡号存在；`READY` 及之后 `hard` 依赖必须 `COMPLETED`；卡之间不成环 |
| `card-status` | D-3 | 与 §1.1 矩阵、卡号索引三处一致 |

`READY` 及之后的卡不得是 L、不得有 `open_questions`，由 Schema 直接拒绝。`test_plan[].debt`：已知没有测试兑现的验收，写明原因后降为告警；测试补上后门禁会要求删掉 `debt`，挂账因此不会悄悄留下。

同一个命令还检查 `docs/` 全部链接与锚点、§1.1 矩阵与索引的状态同步，以及 [`../scheme.md`](../scheme.md) 中 `user_said` 条目能否追到 §0 原话（引用缺失报错；不是逐字子串只告警，对应 acc-4）。
