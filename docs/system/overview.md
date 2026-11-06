# Stagent 系统一页纸

Stagent 是一个本地优先的「合同化施工」工作台：人用自然语言提出需求，系统把意图收敛成可执行的合同，由 Agent 在隔离的 Worktree 里施工，Daemon 跑真实命令出证据，人工核准后合并。目标不是替人写代码，而是让 AI 的每一次改动都可理解、可验收、可追踪、可回滚。

## 三条角色线与一个裁判

| 角色       | 位置        | 权限                     | 职责                                                     |
| :--------- | :---------- | :----------------------- | :------------------------------------------------------- |
| Partner    | 右栏对话    | 只读（`Read,Glob,Grep`） | 陪人梳理模糊意图、查代码、列选项；绝不写主干             |
| Supervisor | 中栏画布    | 生成草案，不落盘施工     | 把意图编译成 `SchemeDraftV2` / `SchemePatch`，冻结成合同 |
| Worker     | Worktree 内 | 仅 `writable_paths` 范围 | 在物理隔离目录里施工，两段式先红后绿                     |
| Daemon     | 本机进程    | 唯一裁判                 | 状态机、合同落盘、Worktree、证据校验、合并放行           |

权威约束见 [`../adr/0007-dual-agent-daemon-authority.md`](../adr/0007-dual-agent-daemon-authority.md)、[`../adr/0014-three-agent-topology-open-supervisor.md`](../adr/0014-three-agent-topology-open-supervisor.md)、[`../adr/0018-intent-to-executable-seal.md`](../adr/0018-intent-to-executable-seal.md)。

## 一次合同的生命周期

1. **意图**：右栏对话把用户原话整理进 `docs/scheme.md` 风格的意图层，Agent 推断必须显式标注。
2. **方案**：Supervisor 生成草案，`docs/specs/task-card-standard.md` 的就绪标准（DoR）决定它能不能开工。
3. **签署**：合同写入 `.stagent/contracts/<id>.json`，写范围、验证命令、预算与审批一次定死；签署后不改合同，改范围必须派生新 Revision。
4. **施工**：Worker 在 Worktree 内执行；改动越界、命令不在白名单、预算超额都会直接失败关闭。
5. **证据**：Daemon 跑合同里的验证命令，账本绑定 head SHA；验收断言必须对应真实存在、未被跳过的用例。
6. **合并**：审批绑定 Revision 校验通过才放行；合并产生提交与可审查的 Diff。

## 代码分层

| 模块         | 路径                    | 说明                                                                                |
| :----------- | :---------------------- | :---------------------------------------------------------------------------------- |
| CLI 入口     | `bin/**`                | `stagent open / start / check`，负责起 Daemon 与鉴权入口                            |
| 确定性宿主   | `daemon/**`             | 状态机、合同仓库、Worktree、证据、合并、知识库检查                                  |
| 前端与共享库 | `src/**`                | 三栏工作台、方案画布、架构雷达；合同 Schema 与纯函数也被 daemon 复用                |
| 测试         | `tests/**`              | unit / integration / daemon / ui / e2e；`tests/e2e/golden-slice.test.ts` 是主链回归 |
| 脚本         | `scripts/**`            | 打包、环境校验、文档门禁、主链回归                                                  |
| 根级配置     | `*.ts`、`*.js`、`*.mjs` | Vite / Vitest / ESLint；测试收录范围直接决定门禁覆盖面                              |

模块与路径的机器可读版本见 [`modules.yaml`](./modules.yaml)，由 `stagent check knowledge` 的 KB-1 核对：本次改动的每个文件都必须落在某个模块的 `paths` 里。

## 真相在哪里

- **代码事实**：仓库本身。文档只做指针，不复制代码。
- **合同与证据**：`.stagent/`（不入库），合并后由提交与 PR 承载历史。
- **意图与决策**：[`../scheme.md`](../scheme.md)、[`../adr/`](../adr/)、[`../specs/`](../specs/)。
- **系统知识**：本目录。每份合同交付时必须同步 `changelog.md`，新增依赖要有 `decisions/` 记录。

## 不做什么

- 不替代编辑器：日常改代码仍可用 Cursor 等工具，通过 `STAGENT_EDITOR` 打开工作区。
- 不让模型自批：审批、预算、合并放行都是确定性的，模型输出只作为证据的一部分。
- 不静默降级：失败按明确错误码返回（402 / 409 / `KNOWLEDGE_DRIFT` 等），不悄悄跳过。
