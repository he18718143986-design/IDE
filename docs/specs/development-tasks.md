
> **DOC-1（冗余治理第 2 波）**：本文件为**薄枢纽**（矩阵 / DAG / 排期 / 路径映射）。
> 详细任务卡已拆至：
> - 索引：[`development-tasks-index.md`](./development-tasks-index.md)
> - 活跃卡：[`development-tasks-active.md`](./development-tasks-active.md)
> - 已完成卡：[`development-tasks-completed.md`](./development-tasks-completed.md)
> - 修订流水：[`development-tasks-changelog.md`](./development-tasks-changelog.md)
> 卡号不变。`scheme.md` dec-4 已 `user_confirmed`。

> **读法（2026-10-29 文档治理加注，不改任何卡的条款与状态）**
> - **本文件是 L3 任务卡层**：Supervisor 方案确认后交给施工 Worker 的机器指令。意图层见 [`../scheme.md`](../scheme.md)，地图见 [`../README.md`](../README.md)。
> - **当前要做的卡见 [`development-tasks-active.md`](./development-tasks-active.md)**（含 §3.4c J 系、§3.4d L 系、§3.4e 台账债；枢纽矩阵 §1.1 为状态总表），按 [`delivery-lifecycle.md`](./delivery-lifecycle.md) §8 里程碑 M2 → M5 排期；每张卡开工前按 [`task-card-standard.md`](./task-card-standard.md) 核对就绪。§1.1 矩阵是状态总表；下方游离的 P-xx 修订行、版本头 98 条状态回写与 §6 修订记录都是历史流水，施工时可跳过。
> - **三 Agent 口径以 J 系列与 [`supervisor.md`](./supervisor.md) §13.2 为准**：右栏 = 只读 AI 搭档（`TASK-J.1`），中栏 = Supervisor 方案画布，Worker 只在 Worktree 施工。C.1「右栏（Coding Agent 对话）」、W.1「推入右侧 Worker 对话窗口」、W.5a「对接右栏会话」、C.6、P.1 / E.1 的 Vibe 直改主工作树、Sprint 1 门禁「右栏 Claude Code 改文件」均为早期叙述，已由 J.1 / C.18 改变；原文保留作溯源。
> - **已知结构问题**（状态矛盾、三处「当前基线」不一致、失效的 `docs/archive/*` 引用（见 Git 历史；本波 DOC-4 已改指针））登记在 [`../ledger/README.md`](../ledger/README.md) DOC-1～DOC-4，未在本轮修改。


- **P-66（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10q`**（Studio 全景/施工双视角壳 + 改名消歧义；三张真全景图仅记入 v0.2 RFC 附录 C，本卡不实现）。同步：版本头第 55 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10p→C.10q`）、§3.4 详细卡、Sprint「当前首要」→ **C.10q**；见 Git 历史（原走查报告 §6.26）；图谱设计说明 §9；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不假绿**；**不改** illumination/start/verify/C.10o/p；**不抢** D.1e。
- **P-65（合入回写，2026-10-24）**：`TASK-C.10p` → **`[COMPLETED]`**（main tip `35b56c9` 快进合入；四件套 **1335 passed / 6 skipped**）。同步：版本头第 54 条 tip/四件套、§1.1 矩阵、§3.4 详细卡、见 Git 历史（原走查报告 §6.25）。**不改**鉴权；**不假绿**。
- **P-64（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10p`**（任务图谱开工/核销前自动确保任务 Worktree：缺失则重建；基线回退 main/HEAD；主区脏不阻断）。同步：版本头第 54 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10o→C.10p`）、§3.4 详细卡、Sprint「当前首要」→ **C.10p**；见 Git 历史（原走查报告 §6.25）；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不假绿**；**不抢** D.1e。
- **P-63（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10o`**（任务图谱开工/核销入口：有图时「开工下一节点」「核销点亮」接到既有 `start`/`verify`；PENDING→RUNNING→点亮；失败黄条；点亮只认物理证据）。同步：版本头第 53 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10n→C.10o`）、§3.4 详细卡、Sprint「当前首要」→ **C.10o**；见 Git 历史（原走查报告 §6.24）；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不抢** D.1e。
- **P-62（热修合入，2026-10-24）**：`TASK-C.10n` 热修——「确认原型并建图」失败/未选合同时错误回显到任务图谱顶栏（原只写演示页，空态 CTA 像无反应）。四件套 **1323 passed / 6 skipped**；tip 见状态回写。**不改**鉴权；**不接** start/verify。
- **P-61（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10n`**（任务图谱空态可感知：无图禁用视图切换、刷新有 loading、白话「当前合同还没有图」+ 确认原型建图 CTA；有图只读提示 + 选中节点高亮/滚到详情）。同步：版本头第 51 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10m→C.10n`）、§3.4 详细卡、Sprint「当前首要」→ **C.10n**；见 Git 历史（原走查报告 §6.23）；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不接** start/verify；**不抢** D.1e。
- **P-60（立卡+实现+合入，2026-10-24）**：工作区先恢复干净 tip（`8dd039d` / C.10l）后新增 **`TASK-C.10m`**（质疑自查「按缺陷修复 / 按新需求演进」空接线：UI 回调 → `user_choice` → Daemon 强制分类）。同步：版本头第 50 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10l→C.10m`）、§3.4 详细卡、Sprint「当前首要」→ **C.10m**；见 Git 历史（原走查报告 §6.22）；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不抢** D.1e。
- **P-59（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10l`**（设置「高级」加回可选会话/适配器：助手下拉、新会话、历史会话；**不**回潮右栏主视线；会话元信息/工具 JSON 仍不展示）。同步：版本头第 49 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10k→C.10l`）、§3.4 详细卡、Sprint「当前首要」→ **C.10l**；见 Git 历史（原走查报告 §6.21）；架构规范 §11 注记 9 轻量续写；v0.2 附录 B 标注本项已落地高级。**不改**鉴权；**不抢** D.1e。
- **P-58（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10k`**（右栏 AI 对话老板主视线：删除多余信息，只留双方对话；Cursor 右侧对话对齐能力写入 v0.2+ RFC 附录 B，**不实施整页复刻**）。同步：版本头第 48 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10j→C.10k`）、§3.4 详细卡、Sprint「当前首要」→ **C.10k**；见 Git 历史（原走查报告 §6.20）；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不抢** D.1e。
- **P-57（C.10j 后打开文件无法关闭热修，2026-10-24）**：Tina 打开文件后无法关闭标签。根因：**不是** Markdown 预览挡住关按钮——文件 Tab 在 `FileTree.onOpen` / `openRequest` / 重命名重开时未设 `closable: true`，顶栏 × 根本不渲染（系统 Tab 才显式 closable）。热修：`fileTab()` 统一补 closable；渲染侧非系统 Tab 默认可关 `(closable ?? !system)`；补 UI 用例。合入 tip `09fdcfd`；四件套 **1313 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。见 Git 历史（原走查报告 §6.19）。**不改**鉴权；不抢 D.1e。
- **P-56（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10j`**（中栏 Markdown 预览阅读：打开 `.md` 默认好看预览含标题/引用/GFM/代码高亮；可切源码编辑；对齐 Cursor 阅读感，不做完整 VS Code）。同步：版本头第 46 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10i→C.10j`）、§3.4 详细卡、Sprint「当前首要」→ **C.10j**；见 Git 历史（原走查报告 §6.18）；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不抢** D.1e；不重做 Monaco 保存门禁。
- **P-55（立卡+实现，2026-10-24）**：新增 **`TASK-C.10i`**（文件树第一批：顶栏路径折叠整树；新建文件/文件夹；右键「在 Finder 显示 / 复制路径 / 重命名 / 删除」）。Cursor 其余右键（Chat/终端/对比/时间线/浏览器打开等）**仅**写入 v0.2+ RFC 锚定，**不实施**、不推翻现架构。同步：版本头第 45 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10h→C.10i`）、§3.4 详细卡、Sprint「当前首要」→ **C.10i**；见 Git 历史（原走查报告 §6.17）；架构规范 §11 注记 9 轻量续写。**不改**鉴权；**不抢** D.1e。
- **P-54（C.10h 删除 Not Found 热修，2026-10-24）**：Tina 确认删除后对话框显示「Not Found」、文件未删。根因：**不是**前后端路径不一致——源码双方都是 `POST /api/repo/delete`；而是 Daemon 于 C.10h 合入前（~13:14）启动，`stagent open` 健康检查通过后**复用旧进程**，路由未挂到活进程（活探针：`/api/repo/tree` 200、`/api/repo/delete` 404）。热修：① `isDaemonCodeStale` + `tryReuseRunningDaemon` 发现 `daemon/server.ts` / `repo-delete.ts` mtime 新于 `startedAt` 则 shutdown/SIGTERM 退役再启；② 前端 404 改白话「本机服务还是旧版…重新打开」；③ 实测删除走废纸篓。四件套 **1295 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。见 Git 历史（原走查报告 §6.16）。
- **P-43（合入回写，2026-10-24）**：`TASK-C.10c` → **`[COMPLETED]`**（main tip `6811f44` 快进合入；四件套 **1267 passed / 6 skipped**）。同步：版本头第 34 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ 第三轮含暗号清扫收口；见 Git 历史（原走查报告 §6.5/§6.7） 回写。交付要点：白话标签、图谱单入口、页脚/欢迎降噪。架构规范仅 §11 注记 9 轻量锚定延续。# Stagent v0.1 研发任务拆解与工程执行规范 (v1.6.2 代码事实对齐与卡片净化版)
- **P-45（合入回写，2026-10-24）**：`TASK-C.10d` → **`[COMPLETED]`**（main tip `51ae8ae` 快进合入；四件套 **1273 passed / 6 skipped**）。同步：版本头第 36 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ 左栏老板主路径收口；见 Git 历史（原走查报告 §6.9/§6.10） 回写。交付要点：换项目主视线、`left-project-files` 默认折叠、跟右侧说话提示。架构规范仅 §11 注记 9 轻量锚定延续。
- **P-46（立卡+实现，2026-10-24）**：新增 **`TASK-C.10e`**（Cursor 式欢迎页承载打开/切换项目）与 **`TASK-C.10f`**（资源管理器纯文件树 + 规范与资产进项目审阅）两张卡（Tina 产品定稿三条）。同步：版本头第 37 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10d→C.10e→C.10f`）、§3.4 详细卡、Sprint「当前首要」→ **C.10e→C.10f**；见 Git 历史（原走查报告 §6.11）。**不改**鉴权；**保留** C.8c 无钥匙重开/粘贴迁到欢迎页；**不抢** D.1e。架构规范仅 §11 注记 9 轻量续写。
- **P-53（C.10f 冗余「文件」标题热修，2026-10-24）**：Tina 反馈资源管理器最上方「文件」应删除。去掉 `left-explorer-heading`，保留 `file-tree-root` 路径与树。合入 tip `f14c8cb`；四件套 **1292 passed / 6 skipped**。
- **P-52（C.10h 确认删除点不了热修，2026-10-24）**：Tina 右键「移到废纸篓」后「确认删除」无法点击。根因：Radix ContextMenu 关闭时短暂给 `body` 加 `pointer-events: none`，同步打开 AlertDialog 则按钮收不到点击（非 `disabled`、非未 build）。热修：菜单 `onSelect` `setTimeout(0)` 延后打开确认框。合入 tip `be4968b`；四件套 **1292 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。见 Git 历史（原走查报告 §6.16）。
- **P-51（立卡+实现+合入，2026-10-24）**：`TASK-C.10h` → **`[COMPLETED]`**（main tip `008fd3a` 快进合入；四件套 **1292 passed / 6 skipped**）。同步：版本头第 41 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10g→C.10h`）、§3.4 详细卡、Sprint「当前首要」→ C.10h 收口；见 Git 历史（原走查报告 §6.16）。交付：右键删除 + 确认、`POST /api/repo/delete`、P.1 门禁白话、尽量废纸篓。架构规范仅 §11 注记 9 轻量锚定延续。
- **P-50（立卡+实现+合入，2026-10-24）**：新增 **`TASK-C.10g`**（文件树点文件夹展开/折叠、默认只展开第一层）并由 `[NEW_TASK]` 收口为 **`[COMPLETED]`**（main tip `a3fa7c7` 快进合入；四件套 **1281 passed / 6 skipped**）。同步：版本头第 40 条、§1.1 矩阵、§2.1 ASCII/JSON（`C.10f→C.10g`）、§3.4 详细卡、Sprint「当前首要」→ 文件树可折叠收口；见 Git 历史（原走查报告 §6.15）。交付要点：`file-tree-expand` + `FileTree` 可点目录；默认展开根下第一层；文件仍可打开。**不改**鉴权；**不抢** D.1e。架构规范仅 §11 注记 9 轻量锚定延续。
- **P-47（合入回写，2026-10-24）**：`TASK-C.10e` / `TASK-C.10f` → **`[COMPLETED]`**（main tip `592f825` 快进合入；四件套 **1274 passed / 6 skipped**）。同步：版本头第 38 条、§1.1 矩阵、§2.1 ASCII、§3.4 详细卡、Sprint「当前首要」→ 欢迎页开项目/纯树/资产进审阅收口；见 Git 历史（原走查报告 §6.11/§6.12）。交付要点：`ProjectWelcomePage` + `OpenProjectEntry` page 变体；左栏 `left-explorer` 纯树；`SupervisorTab.specsSection`；顶栏「切换项目」；保留 C.8c；不抢 D.1e。架构规范仅 §11 注记 9 轻量锚定延续。
- **P-49（C.10f 空文件树热修，2026-10-24）**：Tina 点资源管理器只见「文件」+ 路径、无树节点。根因：左栏 `files` 仍绑架构图 `graph.nodes`，而建连故意不自动拉 AST（缺口 4.2）→ 空数组。非 C.10d 折叠、非 leftExtra。热修：新增轻量 `GET /api/repo/tree` + `listRepoTreePaths`（无 AST）；建连自动灌树；Demo 就绪改看真实目录。四件套 **1277 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。
- **P-48（C.10f 漏接线热修，2026-10-24）**：Tina 打开工作台见左栏仍有「需求（合同 N）」列表——C.10e/f 已迁开项目与规范资产，但 `routes` 仍经 `leftExtra` 把合同列表塞进 `left-explorer`。热修：停渲染左栏 `leftExtra`；合同列表迁 `SupervisorTab.requirementList`（项目审阅）；欢迎/切换项目仍在中栏欢迎页（Tina 粘贴含中栏属整页选中，非左栏再塞）。四件套 **1275 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过。

> **版本定义与基线声明 (v1.6.2 · 2026-10-23)**：
> 1. **架构规范深度对齐**：本工程规范依据《Stagent 系统架构设计规范 (v1.6.1 代码对齐与规范定稿版)》全面修订签发，严格对齐其 §10 演进路线图（包含 P0.2c、P3.7、P4.5、P5.7 等关键里程碑）；
> 2. **代码物理基线明确**：本节 v1.6.2 签发时的历史 tip 为 `main`@`6415fbd`（含 S.6 merge；当时四件套 **1155 passed / 6 skipped**）。**现行权威物理 tip 只认一处**：见下方「Sprint 0 / 2 / 3 / 4 实施基线核验」首条与版本头**最新**状态回写条（本波对齐时为 `e4dfe1c`（含 #62 L.16；其上 P-105/`6b1877d`；主序实现卡已尽，L.17 仍卡 oq-2））。勿再把本条或其它历史 tip 当作「当前 HEAD」。代码当前已交付数据模型为 Contract Schema v1.3.0（经 TASK-0.2c）；
> 3. **底座演进任务认领**：本规范新增 **`TASK-0.2c`**，明确认领架构规范之 P0.2c 里程碑（C-01 整改项），将 Schema v1.3.0（`approval`、`authorization.git`）、Fast Path 确定性流转边 (`DRAFT -> PREPARING -> EXECUTING`)、自愈迁移边 (`PENDING_RESUME -> PREPARING`) 与外部改码级联降级边 (`AUDITED -> VERIFYING`) 列为当前工程第一执行优先级；
> 4. **通信与防死锁引擎认领**：新增 **`TASK-D.3`**，认领架构规范之 P3.7 里程碑（15 展示状态确定性投影持久化与五类死锁自愈机制 D-1~D-5）；
> 5. **卡片状态净化**：已完成任务卡仅描述该卡已交付内容；后续增补需求拆为独立待办卡。新增 `TASK-W.2b` 与 `TASK-D.2b` 承接未跟踪文件 Scope 阻断和 v1.3 合同迁移接入，不再混入已完成卡。
> 6. **状态回写（2026-10-23）**：`TASK-C.7` 已合入 main（merge `5117b27`）。§1.1 矩阵与 §3.5 详细卡状态由 `[NEW_TASK]` 更新为 `[COMPLETED]`，并按实际代码校正卡片文件清单（`TaskGraphPanel` / `FunctionalTree` / `ExecutionDag`，含 `evidence-collector.ts`）。门禁：干净环境四件套全绿（1032 passed / 6 skipped）。残余口径差已在卡片内登记。
> 7. **状态回写（2026-10-23 · 文档校正）**：`TASK-W.2b` 由 `[NEW_TASK]` 更正为 `[COMPLETED]`（证据 `87f909c` / merge `05f090f`，`untracked-scope-guard` + `E_OUT_OF_SCOPE_UNTRACKED`）；`TASK-S.4` 去掉「待合入 main」并注明经 `d5ee448` 合入；`TASK-S.1` PARTIAL 备注校正为「L0/L1 已在 S.2，仅剩 3s 防抖节流器（main 无 `throttler.ts`）」；测试基线改写为 `main`@`9f3b303`，并以 C.7 干净环境复验（1032 passed / 6 skipped）为准。
> 8. **状态回写（2026-10-23 · D.3）**：`TASK-D.3` 由 `[PARTIAL]` 更新为 `[COMPLETED]`（merge `9a19f4d`，含 `c2fcb8a` 持久化/`STATE_CHANGED`/看门狗引擎 + `83ec516` D-2/D-4/D-5 生产接线）。§1.1 矩阵与详细卡状态同步回写；测试基线改写为 `main`@`9a19f4d`，合后四件套 **1084 passed / 6 skipped**。残余口径差已在卡片内登记。
> 9. **状态回写（2026-10-24 · C.2）**：`TASK-C.2` 由 `[PARTIAL]` 更新为 `[COMPLETED]`（merge `51039aa`，功能提交 `c1ad3be`：Studio 四视口壳 + 展示态智能切换）。§1.1 矩阵与详细卡状态同步回写；测试基线改写为 `main`@`51039aa`，合后四件套 **1099 passed / 6 skipped**。残余口径差已在卡片内登记。
> 10. **状态回写（2026-10-24 · S.1）**：`TASK-S.1` 由 `[PARTIAL]` 更新为 `[COMPLETED]`（merge `a9066dd`，功能提交 `a7d7292`：`SupervisorWakeupThrottler` 3s 防抖默认关闭）。§1.1 矩阵与详细卡状态同步回写；测试基线改写为 `main`@`a9066dd`，合后四件套 **1122 passed / 6 skipped**。残余口径差已在卡片内登记。
> 11. **状态回写（2026-10-24 · S.6 立卡）**：新增 **`TASK-S.6` 非技术旅程串联**（当时 `[NEW_TASK]`）。吸收 `TASK-C.2` 残余「【修改原型】/【确认原型并实施真实工程】弱接线」；`TASK-S.3` 仍为 `[DEFERRED → v0.2+]`；**不改**架构规范 v1.6.1。对照：见 Git 历史（原 `docs/archive/non-technical-journey-acceptance.md`）。
> 12. **状态回写（2026-10-24 · S.6 合入）**：`TASK-S.6` 由 `[NEW_TASK]` 更新为 `[COMPLETED]`（merge `6415fbd`，功能 `bbab79e`；合后四件套 **1155 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：右侧确定性分流（质疑/Fast Path/大事草案）、`POST /api/supervisor/journey`、确认原型真建全灰 TaskGraph、需求说明可感知刷新、视口建议切换。**降级登记 S.6b**：`REAL_PLAYTEST` 真预览 URL 挂中栏/外链未做，不阻塞 1–4。
> 13. **状态回写（2026-10-24 · S.6b 合入）**：`TASK-S.6b`（原 S.6 降级项）标 **[COMPLETED]**（merge `024d2b8`，功能 `613ff51`；合后四件套 **1165 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：真机预览 4200–4210 + stub/attach、Studio「真机试玩」视口 iframe/外链、旅程 `REAL_PLAYTEST`→`START_REAL_PLAYTEST`、Origin 防线。不改架构规范；未做 W.5b/c / S.3 HUD。
> 14. **状态回写（2026-10-24 · D.1b 立卡）**：新增 **`TASK-D.1b` 一键打开项目（Daemon 托管控制台 + open CLI）**（`[NEW_TASK]`）。前置 `TASK-D.1`；目标 `stagent open <路径>` → 单浏览器窗口工作台已连上，无需第二终端/手拷 Token。**不改**架构规范 v1.6.1、不改产品代码；不推翻 D.1 鉴权；不含 Electron/Tauri/系统协议。
> 15. **状态回写（2026-10-24 · D.1b 合入）**：`TASK-D.1b` 由 `[NEW_TASK]` 更新为 `[COMPLETED]`（merge `d5b35e0`，功能 `946e9fc`；合后四件套 **1188 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`stagent open <路径>` 复用/启动 Daemon、同源托管 `dist/public`、自动打开 `#token=&base=` 单窗口；无钥匙拒连；`E_WORKSPACE_LOCKED` 白话；Demo 仍独立 Origin。不改架构规范；不含 Electron/Tauri/系统协议。
> 16. **状态回写（2026-10-24 · D.1c 立卡）**：新增 **`TASK-D.1c` 最近项目一键重开**（`[NEW_TASK]`）。前置 `TASK-D.1b`；目标：控制台「打开项目」展示最近列表，一点即复用/唤起带 token 会话，无需再敲 `stagent open`；**不含**真·任意路径文件夹选择器（留给本机助手/Electron）。**不改**架构规范 v1.6.1、不改产品代码；不推翻 D.1/D.1b 鉴权。
> 17. **状态回写（2026-10-24 · D.1c 合入）**：`TASK-D.1c` 由 `[NEW_TASK]` 更新为 `[COMPLETED]`（合入 main tip `f3e371e`，分支 `feat/task-d1c-recent-projects` 快进；合后四件套 **1204 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：本机 `~/.stagent/recent-projects.json` 最近列表；`stagent open` 成功写入；控制台「打开项目」一点重开带 `#token=`；`GET/POST /api/recent-projects`；不含任意路径选择器。不改架构规范；不推翻 D.1/D.1b 鉴权。
> 18. **状态回写（2026-10-24 · D.1d / D.1e 立卡 · 打开项目生产级文档）**：新增 **`TASK-D.1d` 修复同源控制台空白（生产可用单窗口）**（`[NEW_TASK]`）与 **`TASK-D.1e` 桌面壳/本机助手真·选文件夹**（`[NEW_TASK]`，**可 defer**）。登记 D.1b 已知缺陷：`dist/public/index.html` 静态壳无法驱动 TanStack Start 控制台 → `stagent open` 同源页空白；临时绕路 Vite + `#token=` / `#base=`。对照：见 Git 历史（原 `docs/archive/open-project-vision-and-status.md`）。**不改**产品代码；架构规范仅 §11 短注「控制台可同源托管 vs Demo 必须独立 Origin」；不推翻 D.1 loopback+#token；Demo 仍独立 Origin。
> 19. **状态回写（2026-10-24 · Tina 口径对齐 · 打开项目施工合同）**：按产品负责人口径修订——`TASK-D.1d` 前置明确为 `TASK-D.1b` + `TASK-C.2`（均为 COMPLETED），状态 `[NEW_TASK]`，作为非技术可用性**当前最高优先** DX 修复；验收含四件套 + `dist` 静态可用性回归；`TASK-D.1e` 由「NEW 可 defer」改为 **`[DEFERRED → v0.2+]`**（P5.8，不阻塞 v0.1 / D.1d）；Sprint：D.1d 为非技术进门关键门禁，与已合入的 S.6 旅程串联形成优先/并行关系。架构规范仅轻量锚定（单窗口静态 SPA 可由 Daemon 服务；系统文件夹选择器 v0.2+ P5.8），**不推翻** ADR-008 / Demo 独立 Origin / loopback+#token。本轮仍**仅文档**。
> 20. **状态回写（2026-10-24 · D.1d 合入）**：`TASK-D.1d` 由 `[IN_PROGRESS → 功能分支待合]` 更新为 **`[COMPLETED]`**（合入 main tip `b11d15b`，分支 `feat/task-d1d-same-origin-console` 快进；合后四件套 **1208 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：启用 `tanstackStart.spa`；`scripts/package-dist.mjs` 将预渲染 `_shell.html` 提升为 `dist/public/index.html`；`daemon/console/static-host.ts` 仅托管含 `$_TSR` + `index-*.js` 的可 hydrate 壳；新增 `console-dist-spa-shell` 等 dist 静态可用性回归。不推翻 D.1 loopback+#token/AUTH/Origin；Demo 仍独立 Origin。**本轮不改**架构规范 v1.6.1（已有 §4.4 / §11 注记 8 轻量锚定）。
> 21. **状态回写（2026-10-24 · UX 走查 Top3 立卡）**：同源单窗口可用后，非技术走查发现「能开但不能舒服用」。新增 **`TASK-C.8a`**（老板模式文案与默认助手 / 消演示恐吓与 Key 向导）、**`TASK-C.8b`**（Fast Path 老板三步台）、**`TASK-C.8c`**（连接与打开死路自救：无钥匙一键重开 + 粘贴路径打开；**不含** D.1e 系统选择器）三张 `[NEW_TASK]`。前置均锚定 `TASK-D.1d` COMPLETED（`b11d15b` / 文档基线 `fea44e2`）；C.8b 另依赖 `TASK-S.6`；C.8c 依赖 D.1b/D.1c/D.1d 且不抢 D.1e。建议排期 **C.8a → C.8c → C.8b**；**当前首要**指向 C.8a。对照：本文件修订记录 P-30～P-33（**原独立见 Git 历史（原走查报告） `工作台交互走查-2026-10-24.md` 已于 2026-10-25 目录精简时删除**）。**本轮仅文档**；**不改**架构规范（老板模式文案层不改变鉴权 / Demo Origin）。
> 22. **状态回写（2026-10-24 · C.8a 合入）**：`TASK-C.8a` 由 `[IN_PROGRESS]`（`feat/task-c8a-boss-copy`）更新为 **`[COMPLETED]`**（合入 main tip `15ef8e6`，分支快进；合后四件套 **1213 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：演示改为可折叠「练习沙箱」；收起「不调用模型」大黄恐吓；默认优先真助手；未配 Key 时右栏三步向导一键进设置；设置页模型钥匙白话闭环。**不推翻** D.1 鉴权 / Demo Origin；**本轮不改**架构规范 v1.6.1（老板模式仅文案/默认助手呈现）。
> 23. **状态回写（2026-10-24 · C.8c 合入）**：`TASK-C.8c` 由 `[NEW_TASK]`（`feat/task-c8c-open-rescue`）更新为 **`[COMPLETED]`**（合入 main tip `950e53e`，分支快进；合后四件套 **1217 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：无钥匙冷开 `POST /api/session/relaunch` 一键重开带钥匙会话；已鉴权可粘贴绝对路径经 `/api/recent-projects/open` 打开已存在目录；打开面板/空态少催终端与 `#token=`，高级说明折叠。**不抢** `TASK-D.1e`（系统选夹仍 DEFERRED）；**不推翻** D.1 鉴权 / Demo Origin；**本轮不改**架构规范 v1.6.1。
> 24. **状态回写（2026-10-24 · C.8b 合入）**：`TASK-C.8b` 由 `[NEW_TASK]`（`feat/task-c8b-boss-fastpath`）更新为 **`[COMPLETED]`**（合入 main tip `6d16939`，分支快进；合后四件套 **1224 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：小事 Fast Path 中栏默认老板三步「改哪里 / 要不要动保护 / 确认开改」；Scope glob、npm、Daemon、工程师合同细节收入可折叠高级详情；保护命中必须勾选才能开改；中/高风险大事仍走完整合同台。**不改** Fast Path 准入规则与状态机边；**不推翻** D.1 鉴权 / Demo Origin；**本轮不改**架构规范 v1.6.1。
> 25. **状态回写（2026-10-24 · UX 第二轮走查立卡 · 页面逻辑指挥权）**：C.8 Top3 合入后二次走查发现「多个指挥官同时喊」。新增 **`TASK-C.9a`**（首屏单一主路径：无钥匙/有钥匙空闲/进行中三态只留一个指挥信号）、**`TASK-C.9b`**（助手模式互斥：练习 vs 真助手 vs 向导；发送键与中栏随模式）、**`TASK-C.9c`**（打开项目面板生命周期：默认收、成功即关、已连接降级为切换）、**`TASK-C.9d`**（进行中中栏让路：对话/三步台时收欢迎页；设置从向导深链并回跳）四张 `[NEW_TASK]`。前置均锚定 `TASK-C.8a`/`C.8b`/`C.8c` COMPLETED（main tip `15ef8e6` / `950e53e` / `6d16939`，文档基线 `4853823`）。建议排期 **C.9a → C.9b → C.9c → C.9d**；**当前首要**指向 **C.9a**。对照：本文件修订记录 P-34～P-38（第二轮；**原独立见 Git 历史（原走查报告）已删除**）。**本轮仅文档**；**不改**架构规范（呈现/面板生命周期不改变鉴权 / Demo Origin）。
> 26. **状态回写（2026-10-24 · C.9a 合入）**：`TASK-C.9a` 由 `[NEW_TASK]`（`feat/task-c9a-single-command-surface`）更新为 **`[COMPLETED]`**（合入 main tip `ef0e1a7`，分支快进；合后四件套 **1231 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`resolveCommandSurface` 三态（no_key / idle / in_progress）单一主 CTA；欢迎区/打开面板/顶栏徽标降级；UI+单元回归。**不推翻**鉴权 / Demo Origin；架构规范仅 §11 注记 9 轻量锚定（呈现纪律；不改变鉴权/Demo Origin）。
> 27. **状态回写（2026-10-24 · C.9b 合入）**：`TASK-C.9b` 由 `[NEW_TASK]`（`feat/task-c9b-assistant-mode-mutex`）更新为 **`[COMPLETED]`**（合入 main tip `c4818fa`，分支快进；合后四件套 **1239 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`resolveAssistantMode` 三态互斥（wizard / practice / real）；向导态发送禁用+唯一去配置；练习横幅；中栏随模式；`assistant-mode.ts` + UI/单元回归。**不推翻**鉴权 / 真实云调用门禁；架构规范仅 §11 注记 9 轻量锚定延续（呈现层）。
> 28. **状态回写（2026-10-24 · C.9c 合入）**：`TASK-C.9c` 由 `[NEW_TASK]`（`feat/task-c9c-open-panel-lifecycle`）更新为 **`[COMPLETED]`**（合入 main tip `2f5d653`，分支快进；合后四件套 **1246 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：默认收起；打开/切换/重开成功即关；已连接入口「切换项目」；`open-project-panel.ts` + UI/单元回归。**不抢** D.1e；**不回退** C.8c；架构规范仅 §11 注记 9 轻量锚定延续。
> 29. **状态回写（2026-10-24 · C.9d 合入）**：`TASK-C.9d` 由 `[NEW_TASK]`（`feat/task-c9d-middle-yield-settings-return`）更新为 **`[COMPLETED]`**（合入 main tip `edc28ce`，分支快进；合后四件套 **1254 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：进行中 `middle-yield` 收欢迎页；三步台/保护确认自动开 Studio；设置深链模型钥匙 +「配完了，返回对话」；PROTECTED 聊≠改白话。**不含**重做 Studio 四视口；架构规范仅 §11 注记 9 轻量锚定延续。C.9a–d 第二轮指挥权收口。
> 30. **状态回写（2026-10-24 · UX 第三轮走查立卡 · 进行中收口与设置老板主路径）**：C.9 合入后三次走查发现「进行中粘住空壳」与「设置仍像机房」。新增 **`TASK-C.10a`**（进行中生命周期收口：旅程/确认/Fast Path 结束后退出 in_progress；中栏无确认/三步台时不要空 middle-yield 壳）、**`TASK-C.10b`**（设置页老板主路径：模型钥匙主视线；Daemon/Token/工程师项收进「高级」；保留 C.9d 深链+回跳）、**`TASK-C.10c`**（可选/可并入统一抛光：界面暗号清扫，**不挡** C.10a/b，本轮标 **`[DEFERRED · 可并入统一抛光]`**）三张卡。前置：C.10a ← C.9a+C.9d；C.10b ← C.9d+C.8a。建议排期 **C.10a → C.10b**；**当前首要**指向 **C.10a**。对照：本文件修订记录 P-39～P-41（第三轮；**原独立见 Git 历史（原走查报告）已删除**）。**本轮仅文档**；架构规范仅 §11 注记 9 轻量续写（进行中退出/设置呈现层级，不改变鉴权/Demo Origin）。
> 31. **状态回写（2026-10-24 · C.10a 合入）**：`TASK-C.10a` 由 `[NEW_TASK]`（`feat/task-c10a-in-progress-lifecycle`）更新为 **`[COMPLETED]`**（合入 main tip `5207df2`，分支快进；合后四件套 **1261 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：`resolveActiveInProgress` / `shouldRenderMiddleYieldShell`；历史旅程卡不粘住 in_progress；无确认/三步台不空让路壳；三步台进行中保持 Studio；单元+UI 回归。**不推翻**鉴权 / Studio 四视口；架构规范仅 §11 注记 9 轻量锚定延续。
> 32. **状态回写（2026-10-24 · C.10b 合入）**：`TASK-C.10b` 由 `[NEW_TASK]`（`feat/task-c10b-settings-boss-path`）更新为 **`[COMPLETED]`**（合入 main tip `be33a26`，分支快进；合后四件套 **1265 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：设置页主视线「模型钥匙」置顶；Daemon / Session Token / 运行诊断 / 工作区收进默认折叠 `settings-advanced`；保留 C.9d 深链与「配完了，返回对话」。**不推翻**鉴权语义；token 能力保留仅藏层级。`TASK-C.10c` 仍 **DEFERRED**。
> 33. **状态回写（2026-10-24 · C.10c 正式立卡 · 界面暗号/命名清扫）**：按 Tina 对齐范围将 **`TASK-C.10c`** 由 `[DEFERRED · 可并入统一抛光]` 升为 **`[NEW_TASK]`**。 范围：单壳多标签不拆多路由；白话改名（Supervisor→「项目审阅」；Supervisor Studio→「合同操作台」与 C.8b 一致；SmartTerminal/底栏→「验证输出」；ActivityBar title 去英文暗号）；收掉任务图谱双入口（日常只留合同操作台内视口，左栏入口改指向该视口或弱化）；可选弱化空闲「说需求/新建需求」双 CTA。 **不重做** C.9/C.10a/b 指挥纪律；**不改**鉴权；**不抢** D.1e。前置：C.10a/b COMPLETED。**当前首要**→ **C.10c**。 对照：见 Git 历史（原走查报告 §6） 别扭#4–7 + 页面分层说明。**本轮先文档**；架构规范仅 §11 注记 9 轻量续写（命名/入口呈现，不改变鉴权/Demo Origin）。
> 34. **状态回写（2026-10-24 · C.10c 合入）**：`TASK-C.10c` 由 `[NEW_TASK]`（`feat/task-c10c-cipher-cleanup`）更新为 **`[COMPLETED]`**（合入 main tip `6811f44`，分支快进；合后四件套 **1267 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：白话标签 Supervisor→项目审阅、Studio→合同操作台、SmartTerminal→验证输出；ActivityBar 去英文暗号；左栏图谱入口改开合同操作台内图谱视口（不再新建独立任务图谱系统 Tab）；页脚白话；欢迎「新建需求」降为弱链；`workbench-labels.ts` + UI 回归 2 条。**不重做**指挥纪律；**不改**鉴权；**不抢** D.1e。架构规范仅 §11 注记 9 轻量锚定延续。
> 35. **状态回写（2026-10-24 · 立卡 TASK-C.10d · 左栏老板主路径）**：Tina 反馈资源管理器展开后「换项目 + 规范与资产 + 整棵文件树」太吵。新增 **`TASK-C.10d`**（`[NEW_TASK]`）：默认主视线只留打开/切换项目（简洁）+ 必要时一句「跟右侧说话」；规范与资产、完整文件树默认收进折叠「项目文件」；**不取消**能力，只改默认层级与文案；**不改**鉴权；**不抢** D.1e；不拆多路由；与 C.9a/C.10c 指挥纪律一致。前置：`TASK-C.10c` COMPLETED。**当前首要**→ **C.10d**。对照：见 Git 历史（原走查报告 §6.9）。**本轮先文档**；架构规范仅 §11 注记 9 轻量续写（左栏呈现层级，不改变鉴权/Demo Origin）。
> 36. **状态回写（2026-10-24 · C.10d 合入）**：`TASK-C.10d` 由 `[NEW_TASK]`（`feat/task-c10d-left-boss-path`）更新为 **`[COMPLETED]`**（合入 main tip `51ae8ae`，分支快进；合后四件套 **1273 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：左栏默认主视线打开/切换项目；空闲「跟右侧说话」提示；规范与资产 + 文件树默认收进 `left-project-files`「项目文件」；`left-panel-boss.ts` + 单元/UI 回归；规范区默认折叠。**不改**鉴权；**不抢** D.1e。架构规范仅 §11 注记 9 轻量锚定延续。
> 37. **状态回写（2026-10-24 · 立卡 TASK-C.10e / C.10f · 欢迎页开项目 + 纯文件树 + 资产进审阅）**：Tina 产品定稿三条——① 规范与资产绑进「项目审阅」；② 资源管理器只展示纯文件树；③ 打开/切换项目不放 IDE 左栏，单独 Cursor 式欢迎页（最近一键重开 + 粘贴路径；保留 C.8c；不抢 D.1e）。新增 **`TASK-C.10e`**、**`TASK-C.10f`**（`[NEW_TASK]`）。前置：`C.10d` COMPLETED；建议序 **C.10e → C.10f**。**当前首要**→ **C.10e**。对照：见 Git 历史（原走查报告 §6.11）。架构规范仅 §11 注记 9 轻量续写（呈现位置，不改变鉴权/Demo Origin）。
> 38. **状态回写（2026-10-24 · C.10e/f 合入）**：`TASK-C.10e` / `TASK-C.10f` 由 `[NEW_TASK]`（`feat/task-c10e-f-welcome-explorer`）更新为 **`[COMPLETED]`**（合入 main tip `592f825`，分支快进；合后四件套 **1274 passed / 6 skipped**；tsc 0 / eslint 0 errors / build 通过）。交付：欢迎页承载开项目（page 变体 + 顶栏切换项目）；左栏纯文件树；规范与资产进项目审阅；C.8c 能力保留；不抢 D.1e。架构规范仅 §11 注记 9 轻量锚定延续。
> 39. **状态回写（2026-10-24 · C.10f 空文件树热修）**：资源管理器空树根因是 `files` 绑未自动加载的架构图；改为 `/api/repo/tree` 轻量列举并建连加载。见 Git 历史（原走查报告 §6.14）。**不改**鉴权；不回潮缺口 4.2 自动 AST。
> 40. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10g · 文件树展开/折叠）**：Tina 反馈文件树整棵摊开、无法折叠文件夹。新增 **`TASK-C.10g`** 并 **`[COMPLETED]`**（合入 main tip `a3fa7c7`，分支快进；合后四件套 **1281 passed / 6 skipped**）。交付：点文件夹展开/折叠；默认只展开根下第一层目录；更深目录默认收起；点文件仍打开编辑。前置：`TASK-C.10f` COMPLETED。**不改**鉴权；**不抢** D.1e；不拆多路由。见 Git 历史（原走查报告 §6.15）。架构规范仅 §11 注记 9 轻量锚定（呈现交互，不改变鉴权/Demo Origin）。
> 41. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10h · 文件树右键删除）**：Tina 授权做成 Cursor 式「右键删除 / 移到废纸篓」。`TASK-C.10h` → **`[COMPLETED]`**（合入 main tip `008fd3a`；合后四件套 **1292 passed / 6 skipped**）。交付：文件树右键菜单 → 确认 → `POST /api/repo/delete`（鉴权）；P.1 保护清单白话拒绝；macOS 尽量废纸篓，否则普通文件永久删除并诚实文案；删成功刷新树并关同路径标签。**不改**鉴权；**不抢** D.1e。见 Git 历史（原走查报告 §6.16）。架构规范仅 §11 注记 9 轻量锚定延续。
> 42. **状态回写（2026-10-24 · C.10h 确认删除点不了热修）**：右键删除后确认框点不了。根因 ContextMenu→AlertDialog 同步打开叠加 Radix `pointer-events` 锁；延后一帧打开。合入 tip `be4968b`；四件套 **1292 passed / 6 skipped**。见 Git 历史（原走查报告 §6.16）。
> 43. **状态回写（2026-10-24 · 资源管理器去掉冗余「文件」标题）**：删除 `left-explorer-heading`「文件」字样；路径根与文件树保留。合入 tip `f14c8cb`；四件套 **1292 passed / 6 skipped**。
> 44. **状态回写（2026-10-24 · C.10h 删除 Not Found 热修）**：确认删除回「Not Found」——活 Daemon 复用旧进程致 `POST /api/repo/delete` 未挂（路径在源码一致）。退役偏斜 Daemon + 404 白话；四件套 **1295 passed / 6 skipped**。见 Git 历史（原走查报告 §6.16）。
> 45. **状态回写（2026-10-24 · 立卡并实现 TASK-C.10i · 文件树第一批）**：Tina 授权第一批——点顶栏路径折叠整树；顶栏右侧新建文件/文件夹；右键含「在 Finder 中显示 / 复制路径 / 重命名 / 删除（已有）」。新增 **`TASK-C.10i`**（**COMPLETED**，tip `5388f9c`）。Cursor 其余右键菜单项（加进 Chat、在集成终端中打开、选择以进行比较、打开时间线、在浏览器中打开等）写入 **v0.2+ RFC 锚定（不实施）**，不推翻现架构。前置：`TASK-C.10h` COMPLETED。**不改**鉴权；**不抢** D.1e。见 Git 历史（原走查报告 §6.17）。架构规范仅 §11 注记 9 轻量锚定延续。
> 46. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10j · 中栏 Markdown 预览阅读）**：Tina 授权（t666u）复刻 Cursor 式 Markdown 阅读。新增 **`TASK-C.10j`** 并收口为 **`[COMPLETED]`**（合入 tip `836ad6e`；四件套 **1311 passed / 6 skipped**）。交付：打开 `.md`/`.markdown`/`.mdx` 默认好看预览（标题/引用/GFM 表格/代码高亮）；顶栏「预览|源码」切换；源码仍走 Monaco + 既有保存门禁；非 Markdown 不出现切换。前置：`TASK-C.10i` COMPLETED。**不改**鉴权；**不抢** D.1e；不做分栏预览/完整面包屑/完整 VS Code。见 Git 历史（原走查报告 §6.18）。架构规范仅 §11 注记 9 轻量锚定延续。
> 47. **状态回写（2026-10-24 · 打开文件无法关闭热修）**：文件 Tab 漏设 `closable`，× 不渲染；与 C.10j Markdown 预览无关。合入 tip `09fdcfd`；四件套 **1313 passed / 6 skipped**。见 Git 历史（原走查报告 §6.19）。
> 48. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10k · 右栏只留双方对话）**：Tina 授权（t669u）——Cursor 右栏能力记入 v0.2；同时打磨右栏删除多余信息。新增 **`TASK-C.10k`** 并收口为 **`[COMPLETED]`**（合入 tip `0da870c`；四件套 **1313 passed / 6 skipped**）。交付：去掉适配器下拉/历史会话/会话元信息/「当前对话使用」/空闲说明书条/工具 JSON 卡片；保留用户·助手消息与旅程卡及必要门禁提示；自动首选助手开会话。Cursor 右栏对齐项写入 **v0.2+ RFC 附录 B（锚定不实施）**。前置：`TASK-C.10j` COMPLETED。**不改**鉴权；**不抢** D.1e。见 Git 历史（原走查报告 §6.20）。架构规范仅 §11 注记 9 轻量锚定延续。
> 83. **状态回写（2026-10-24 · C.10f 漏接线热修）**：合入后肉眼见左栏仍混「需求（合同）」——`leftExtra` 未随 C.10f 迁出。热修停渲染左栏 `leftExtra`，列表进项目审阅 `requirementList`；四件套 **1275 passed / 6 skipped**。欢迎/切换项目文案属中栏欢迎页，非左栏回归。

## 1. 任务体系与研发全景矩阵 (Engineering Matrix)

### 1.1 研发任务与规范 §10 路线映射表 (v1.6.2：完成状态与新增待办分离)

> 49. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10l · 设置高级可选会话/适配器）**：Tina 授权（t671u）——适配器/新会话/历史会话放回设置「高级」，不进右栏主路径。新增 **`TASK-C.10l`** 并收口为 **`[COMPLETED]`**（合入 tip `d407b5c`；四件套 **1316 passed / 6 skipped**）。交付：`settings-chat-session` 于 `settings-advanced`；Console 上提 `useAgentSession` 与右栏共享；右栏仍无工程师控件（C.10k 保持）。会话元信息/工具 JSON **不**进设置。前置：`TASK-C.10k` COMPLETED。**不改**鉴权；**不抢** D.1e。见 Git 历史（原走查报告 §6.21）。架构规范仅 §11 注记 9 轻量锚定延续。

> 50. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10m · 质疑裁决按钮接线）**：Tina 授权（t673u）——先恢复干净 tip，再修质疑自查两按钮空接线。新增 **`TASK-C.10m`** 并收口为 **`[COMPLETED]`**（合入 tip `0d65890`；四件套 **1319 passed / 6 skipped**）。交付：降级/UNATTRIBUTED 时「按缺陷修复」「按新需求演进」调用 `submitDisputeSelfCheck(..., user_choice)`；引擎 `outcomeFromUserChoice` 强制 BUG→REWORK / 需求→REQUIREMENT_CHANGE；需求演进切合同视口。前置：`TASK-C.10l` COMPLETED；工作区恢复 `8dd039d`。**不改**鉴权；**不抢** D.1e。见 Git 历史（原走查报告 §6.22）。架构规范仅 §11 注记 9 轻量锚定延续。

> 51. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10n · 任务图谱空态可感知）**：Tina 授权（t675u）——任务图谱顶栏按钮像没反应。根因：无图时正文永远空态，切视图画面不变。新增 **`TASK-C.10n`** 并收口为 **`[COMPLETED]`**（合入 tip `bcad27f`；四件套 **1322 passed / 6 skipped**）。交付：无图禁用「业务功能导图/执行拓扑」、刷新「刷新中…」、白话「当前合同还没有图」+「确认原型并建图」CTA；有图只读提示；选中节点高亮并滚到详情。前置：`TASK-C.10m` COMPLETED。**不改**鉴权；**不接** start/verify；**不抢** D.1e。见 Git 历史（原走查报告 §6.23）。架构规范仅 §11 注记 9 轻量锚定延续。
>
> 52. **状态回写（2026-10-24 · C.10n 热修 · 建图 CTA 错误回显）**：Tina 反馈（t676u）合入后仍「按钮点击无法反应」。排查：main 已含 C.10n；dist 已有空态文案；真正缺口是 CTA 触发 `handleConfirmPrototype` 后，未选合同/建图失败的 `confirmPrototypeError` 只写到演示页，图谱空态看不见。热修 tip `3e9bb22`：`error={confirmPrototypeError ?? taskGraphError}`；四件套 **1323 passed / 6 skipped**。并重建 dist、重启同源 daemon。**不改**鉴权；**不接** start/verify。
>
> 53. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10o · 任务图谱开工/核销入口）**：Tina 授权（t680u）——任务图谱只读，后台已有 start/verify（C.7）但 UI 未接。新增 **`TASK-C.10o`** 并收口为 **`[COMPLETED]`**（合入 tip `830fca1`；四件套 **1331 passed / 6 skipped**）。交付：有图时顶栏「开工下一节点」「核销点亮」；详情可对可开工/可核销节点操作；接到 `POST /api/graph/nodes/start` 与 `POST /api/graph/verify`；状态 PENDING→RUNNING→点亮；失败黄条；COMMAND 退出码按声明别名提交，写入/Scope/SHA 仍由 Daemon 现算（不假绿）。前置：`TASK-C.10n` / `TASK-C.7` COMPLETED。**不改**鉴权；**不抢** D.1e。见 Git 历史（原走查报告 §6.24）。架构规范仅 §11 注记 9 轻量锚定延续。
>
> 54. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10p · 图谱开工/核销自动确保 Worktree）**：Tina 反馈（t681u）核销报「任务 Worktree 不存在」（合同已 MERGED、树已清）。新增 **`TASK-C.10p`** 并收口为 **`[COMPLETED]`**（合入 tip `35b56c9`；四件套 **1335 passed / 6 skipped**）。交付：`ensureTaskWorktree` + `resolveExistingBaseBranch`；`POST /api/graph/nodes/start` 与 `POST /api/graph/verify` 前自愈重建；基线优先合同 base_branch，缺失回退 main/master/HEAD；主区脏 `acknowledgeDirty`。前置：`TASK-C.10o` / `TASK-A.1` COMPLETED。**不改**鉴权；**不假绿**；**不抢** D.1e。见 Git 历史（原走查报告 §6.25）。架构规范仅 §11 注记 9 轻量锚定延续。
> 55. **状态回写（2026-10-24 · 立卡并合入 TASK-C.10q · Studio 全景/施工双视角壳）**：Tina 授权（t684u）——图谱相关方案写入设计说明；v0.1 先立双视角壳 + 改名消歧义；三张真全景图进 v0.2。新增 **`TASK-C.10q`** 并收口为 **`[COMPLETED]`**（合入 tip `4280de6`；四件套 **1342 passed / 6 skipped**）。交付：`StudioLensShell` + `PanoramaPane`（合同摘要 + v0.2 占位）；无图默认全景、有图/刚建图切施工；「业务功能导图」→「本轮施工·功能汇总」；全景禁止施工绿灯。前置：`TASK-C.10p` COMPLETED。**不改**鉴权；**不假绿**；**不改** start/verify/illumination；**不抢** D.1e。见 Git 历史（原走查报告 §6.26）、设计说明 §9、RFC 附录 C。
> 59. **状态回写（2026-10-26 · 合入 TASK-C.12a–e COMPLETED · Spec Freeze Top5 Delta）**：Tina t819u 授权「全部一起」实现。五张 Delta 升级卡同批落地：`exec_token`/`resume_token`+`jti`（EO-07）、`session_epoch`+`state_seq`+EO-01（含 `CONTRACT_SIGNING`）、越界 SIGINT 3s→SIGKILL→吊销→清锁→PAUSED（EO-02/07）、Demo 三态+`can_sign`+records 轻量拷贝（EO-05/06）、`audit-manifest.json`（EO-03/04/05）。专用单测 `tests/unit/task-c12-top5-delta.test.ts`；相关回归（gateway/merger/orchestrator/presentation）绿。main tip `12b14b1`。**不改** D.1 鉴权通道；**不抢** D.1e；**不改**左栏文件树/右栏对话 UX（除状态/can_sign 必要字段）；Impact/Mode/AST/云仍 v0.2+。CLOSED≠体验通过——走查后再请 Tina 体验。
> 60. **状态回写（2026-10-26 · 立卡 TASK-C.14a–c · 已有项目基线档案）**：Tina 授权（t835u「升格立卡」）。按讨论稿 见 Git 历史（原 `docs/archive/baseline-archive-onboarding-design.md`）（tip `3c8411b`）升格为三张 **Delta 薄卡**：**`TASK-C.14a`**（只读沙盒静态扫描器：只读挂载+物理断网+约 3s 超时熔断；禁动态执行；P0 骨架秒级）、**`TASK-C.14b`**（两段式渐进扫 + 基线档案落盘 `.stagent/records/baseline/` + 全景视口；尽量全；流式加深；确认≠授权；按钮「认可此基线作为后续参考」）、**`TASK-C.14c`**（Workspace Dirty Check 黄标管家话术 + 首张微合同默认排除未跟踪/未提交；图谱两行白话；P0 解锁后 Supervisor 防抢跑降级）。建议序 **C.14a→C.14b→C.14c**；**当前首要**→ **C.14a**。**本条仅文档立卡**；**CLOSED 设计意图 ≠ 已实现**；**不写** daemon/src 产品码直至 Tina 点名开发；**不**把整篇并进 Spec Freeze 五文档；**不抢** D.1e；Impact/Mode/AST/云仍 **v0.2+**；不改 D.1 鉴权。
> 61. **状态回写（2026-10-26 · 合入验收 TASK-C.14a–c COMPLETED · 基线档案）**：Tina t836u 授权实现+走查；t847u 授权文档验收回写。三卡同批落地：`0417203`（feat 扫描/渐进落盘/Dirty+防抢跑）→ `e01188f`（Dirty porcelain 路径硬化）→ `dd14fa0`（重建控制台露出全景基线卡）。验收：打开已有项目全景可见「项目现状基线档案」+「认可此基线作为后续参考」；确认≠授权；观察≠质量结论。**已知不挡体验缝**：沙盒仍为逻辑级（非 OS 只读挂载）；深度进度轮询；脏区黄标需工作区确有未提交文件才可见。**不**扩 Spec Freeze 五正文；讨论稿仍分治；不抢 D.1e。
> 62. **状态回写（2026-10-26 · 立卡 TASK-C.14d / C.14e · 基线安全闭环加固）**：Tina 授权（t853u 升格立卡）。按「安全闭环优先」点名两张 **Delta 薄卡**（不齐开四项）：**`TASK-C.14d`**（脏区→Scope 真链路硬门禁：`dirty_exclusions` → 首张微合同 `scope.forbidden_paths` + 白话列出；Worker touch 脏区 → `E_OUT_OF_SCOPE_UNTRACKED` + C.12c 软停 3s→SIGKILL；E2E：未提交 `.env.local` + 未跟踪脚本永不被改）；**`TASK-C.14e`**（扫描器 OS 级只读挂载 + 断网沙盒证明：RO bind mount/sandbox RO；network namespace 禁出站；反向证伪 write→EROFS、outbound fetch/socket 失败）。建议序 **C.14d→C.14e**；**当前首要**→ **C.14d**。**暂缓 backlog（本轮不立）**：深度进度改 WS（P1 体验）；右栏 EO 余面 Delta（P2，随微合同端到端按需带出）。权威：讨论稿 §2.3/§7 + C.14c/C.14a 已知缝 + Tina 计划。**本条仅文档立卡**；**不写** daemon/src 产品码直至 Tina 点名开发；**不**扩 Spec Freeze 五正文；不抢 D.1e；不改 D.1 鉴权。
> 63. **状态回写（2026-10-26 · 合入验收 TASK-C.14d / C.14e COMPLETED · 基线安全闭环）**：Tina t854u「开工」。**C.14d**：`dirty_exclusions` 物理清单→首张微合同 `scope.forbidden_paths`+白话「绝不触碰」；Gateway/Worker touch 脏区→`E_OUT_OF_SCOPE_UNTRACKED`+C.12c SIGINT→SIGKILL；E2E `.env.local`+未跟踪脚本不变。**C.14e**：`os-sandbox.ts`；Darwin `sandbox-exec`（写拒 **EPERM**=平台等价 EROFS；断网 **ENOTFOUND**）；档案附 `os_sandbox` 证明；未证明不得升级硬承诺。单测 `baseline-c14d/e` + C.14a–c 回归绿。**不**扩 Spec Freeze 五正文；WS/EO 余面仍 backlog。
> 66. **状态回写（2026-10-26 · TASK-C.15b 活路径接线）**：Tina t866u「接线」。ReworkCounter 接入 `orchestrator.approve` seed、`execute` 断言失败计返工（含 LoopGuard 同轮 BLOCKED 仍计数）、超限 `ESCALATED_HUMAN`+吊销+`PENDING_RESUME`；HTTP `GET/POST /api/contracts/:id/rework(/failure|/assertions|/split)`；execute 响应附 `rework`+`delivery_state`。单测 `task-c15b-rework-live-path` + 库测/orchestrator/contract-api 回归绿。**不**扩 Spec Freeze；不改 D.1。
> 67. **状态回写（2026-10-26 · 立卡 TASK-H.1–H.4 · v0.1 硬化微卡）**：Tina t877u「打 Tag 立卡」。在主路径签收 Tag `v0.1-mainline-signoff`（annotated @ `4f90483` 含纪要；代码锚点 `0b839f3`）之后，进入 **v0.1 Hardening & Resilience**，**不**触碰 v0.2 封印。新增四张独立微卡：**`TASK-H.1`**（Worker JSON/Patch 解析校验 + 轻量本地重试）；**`TASK-H.2`**（`MERGED`/`DELIVERED` 终态收口消歧）；**`TASK-H.3`**（基线扫描文件数/深度硬上限 + 超时熔断）；**`TASK-H.4`**（空目录友好 `git init` 引导）。建议序 **H.1→H.2→H.3→H.4**；**H.1–H.4 已 COMPLETED**（Tina t878u 全部开工）；每卡自带 1~2 条确定性断言；禁止借机扩写新功能；Impact/Mode/AST/云/W.5b/c/D.1e/真脑图 = 继续封印。权威：`docs/reports/v0.1-mainline-milestone.md`。
> 68. **状态回写（2026-10-26 · 立卡 TASK-H.5–H.8 · v0.1 硬化第二批微卡）**：Tina t880u「立卡做」。在 H.1–H.4 COMPLETED（tip `d960263`）之后，补齐纪要目标 1 余缝与目标 2/3：**`TASK-H.5`**（旅程草案偶发丢失 `contract_id`）；**`TASK-H.6`**（脏区引导精修：`acknowledge_dirty` 低恐慌排除建议）；**`TASK-H.7`**（主链路回归套件锁死）；**`TASK-H.8`**（`.stagent/records/` 一键脱敏 zip 导出 + 单项目彻底清理，EO-03/EO-05 落地）。建议序 **H.5→H.6→H.7→H.8**；**当前首要**→ **H.5**。**本条仅文档立卡**；**不写**产品码直至 Tina 点名实现；每卡自带 1~2 条确定性断言；禁止借机扩写新功能；Impact/Mode/AST/云/W.5b/c/D.1e/真脑图 = 继续封印。权威：`docs/reports/v0.1-mainline-milestone.md`；签收 Tag `v0.1-mainline-signoff`。
> 69. **状态回写（2026-10-26 · 完工 TASK-H.5–H.8）**：Tina t881u「开工」。实现：`draft-contract-id.ts` 旅程落盘+顶层 `contract_id`；`dirty-guidance.ts` 白话 409 + ack 排除并入禁写；`mainline-regression` 脚本/单测；`records-export-cleanup` + `/api/records/export|cleanup`。单测 task-h5…h8 PASS。**不**触碰 v0.2 封印。
> 70. **状态回写（2026-10-26 · 立卡并实现 TASK-C.16 · ActivityBar 单门）**：Tina t892u 点头授权「单门：列表+操作台」。新增 **`TASK-C.16`** 并由同授权收口为 **`[COMPLETED]`**。交付：ActivityBar 只挂一扇「合同操作台」；需求列表+规范与资产在操作台左侧栏；点需求仍打开五视口；「项目全景」为操作台内次入口；文件树保持纯源码。**不**扩 Spec Freeze；不抢 D.1e；不改鉴权。
> 71. **状态回写（2026-10-26 · 立卡并实现 TASK-C.17 · P0 调试日志）**：Tina t894u「按这四项开干」。新增 **`TASK-C.17`** 并由同授权收口为 **`[COMPLETED]`**。交付：Daemon 默认 JSONL（`.stagent/logs/daemon.jsonl`，info+简单轮转）；澄清旅程 `journey-<cid>.jsonl`（可刷新还原）；WORKER_LOG/TERMINAL_STREAM 有界落盘 `worker-<cid>.jsonl`；前端 CTA/viewport/disabled → `POST /api/client-events`；Enrich/Worker LLM 记 duration_ms/model/token（禁密钥）。**不**扩 Spec Freeze；不抢 D.1e；不改 football；不扩 v0.2。
> 72. **状态回写（2026-10-26 · 立卡并实现 TASK-C.18 · 方案工作台单页）**：Tina t905u「改代码…只需要一个页面」。新增 **`TASK-C.18`** 并由同授权收口为 **`[COMPLETED]`**。交付：去掉五视口入口；中间仅「方案审阅」；右侧真正自由对话（取消 ≤2 轮选择题门控）；方案随聊更新（启发式模块/mermaid/决策冲突）；完整度够才「生成 Demo」；最底仅「确认方案」冻结 Spec 并开工。**不**扩 Spec Freeze；不抢 D.1e；不扩 v0.2。
> 73. **状态回写（2026-10-26 · 立卡并完成 TASK-C.19 / DOC-SSOT-Supervisor）**：Tina t906u 要求将 Supervisor 散落文档合流为唯一权威源。新增 **`TASK-C.19`**（`DOC-SSOT-Supervisor`）并由同授权收口为 **`[COMPLETED]`**。交付：`docs/specs/supervisor.md` 五大章 SSOT；旧右栏/工作流/澄清授权/接口清单/运转机制文首加「已迁入 SSOT」指针；reports README + Spec Freeze 加指向。**本文档仅薄卡回写**；不改产品代码；不抢 D.1e；不扩 v0.2。
> 74. **状态回写（2026-10-26 · 立卡并完成 TASK-C.20 / DOC-ARCHIVE-Supervisor-pre-SSOT）**：Tina t908u「归档」。新增 **`TASK-C.20`** 并由同授权收口为 **`[COMPLETED]`**。交付：见 Git 历史（原 `docs/archive/supervisor-pre-ssot/`）；`git mv` 右栏设计 / E2E 工作流 / 澄清授权 / 接口清单 / 运转机制；原 `docs/reports/` 路径保留 stub 指向 SSOT+归档；更新 archive/reports README、Spec Freeze、SSOT 路径表；Spec Freeze 总册保留。**仅文档**；不改产品代码；不抢 D.1e；不扩 v0.2。
> 75. **状态回写（2026-10-26 · 立卡并完成 TASK-C.21 / DOC-SSOT-Supervisor-Patch）**：Tina t910u「补丁」。新增 **`TASK-C.21`** 并由同授权收口为 **`[COMPLETED]`**。交付：SSOT 升 **v2.0.1**——钉死 Demo 可选门禁（覆盖 EO-06 硬卡误读）、通配符分级与落盘收敛、「确认方案」五步原子时序、`user_pinned` 字段级脏检查、Demo 失败双按钮降级与风险标记、`demoReady` 硬性布尔底线。**仅文档**；不改产品代码；不抢 D.1e；不扩 v0.2。
> 76. **状态回写（2026-10-27 · 立卡 TASK-J.1–J.8 · 闭环旅程 v2.1 第一批）**：按 [`supervisor.md`](./supervisor.md) 第三部分 §19 落差 L-01～L-10 与 §20 施工顺序拆出第一批八张卡（§3.4c）。主链：**`TASK-J.2`**（`ScopePlan` 单一来源）→ **`TASK-J.3`**（唯一谓词纳入范围）∥ **`TASK-J.4`**（Daemon 预检接口与快照绑定）→ **`TASK-J.5`**（确认接线改造）→ **`TASK-J.6`**（中栏范围区块）∥ **`TASK-J.7`**（交接进度与右栏解锁）。并行：**`TASK-J.1`**（右栏搭档只读，**P0**：现网 Claude Code 右栏以 `acceptEdits` + Edit/Write 在仓库根运行）、**`TASK-J.8`**（`JourneyStage` 投影）。**当前首要**→ **J.1**（并行）与 **J.2**。**本条仅文档立卡**；意图编译器、施工对话、试玩合入留第二批（§3.4c 末预告）。
> 77. **状态回写（2026-10-27 · 立卡 TASK-J.9 · 闭环旅程 v2.1 第二批首卡）**：依 [`supervisor.md`](./supervisor.md) §14.2、§14.3、§14.11 立 **`TASK-J.9`**（SchemePatch 零模型确定性合并引擎）。实施口径与测试矩阵见新文件 [`scheme-patch-engine.md`](./scheme-patch-engine.md)：补丁级闸门「冻结 → 基线审计 → 结构 → 修订号」、op 级「溯源 → 来源 → 墓地 → 钉选 → 写入」拒绝优先；引用锚定算法；墓地复活三值判定。原第二批预告中的 `renderSchemeDiagrams`（V-07）拆为 **J.9b**，不在本卡。**本条仅文档立卡**，代码由本地团队施工。
> 78. **状态回写（2026-10-27 · 立卡 TASK-J.10 · 意图编译器生成端）**：依 [`supervisor.md`](./supervisor.md) §14.4～§14.9 与 [`scheme-patch-engine.md`](./scheme-patch-engine.md) 立 **`TASK-J.10`**。实施口径见新文件 [`intent-compiler-prompt.md`](./intent-compiler-prompt.md)：47 码「生成端 × 引擎」责任表、摘录区与消息别名、墓碑注入丙案、搭档与编译器双调用、System Prompt 骨架、生成 Schema、8 条 few-shot、29 组对抗性金标种子（J.11）。同时登记两处需 J.9 增补的缺口：GAP-1 聊天否决不入墓、GAP-2 墓碑命中不看复活关键词。**本条仅文档立卡**。
> 79. **状态回写（2026-10-28 · PR #4 J.9a 增补 · 确认路径 occurrence 风险登记）**：J.9a 增补（K-10～K-12）已合入后，`scheme-patch-engine.md` §1.3 K-12 登记：复活路径忽略编译器 `occurrence`。**待定风险**：确认路径（`mark_user_confirmed`）同样接受 `occurrence`，存在同型洗白面（「我同意。算了不同意」+ `occurrence: 0`）。修法待定，在 J.9 备注与 J.11 金标中显式挂账；J.11 金标须含此类对抗样本与「模块名重叠但意图不同」的正反两向样本。
> 80. **状态回写（2026-10-28 · J.10 口径：开放 reject_item）**：生成端 Schema 开放 `reject_item`（K-13），发射条件硬规定见 `intent-compiler-prompt.md` §4.5；引擎对已有效用户墓碑的重复否决记 no-op（复用 `W_NOOP_IDENTICAL`）；码表 51 码。任务状态未改（仍 `[NEW_TASK]`）。
> 81. **状态回写（2026-10-28 · 规格增补落地 · 沉默损耗三项）**：`supervisor.md` 增补 ①§14.11 第 3 条墓地跨旅程继承（冻结快照 + 墓地子账本随迁，`disallow_revival` 与证据整体保留）；②§14.11 子账本四 `attributions` 质疑归因账本与收紧项 **K-14**（K-13 已由 `reject_item` 占用，故顺延；只写台账，不改 `requirements-store.ts` 的 `source` 枚举）；③§13.3 第一反应速记前置说明（不新增决定类型）。`intent-compiler-prompt.md` §2.2 补归因字段的生成端不可写边界（非码类，不改 51 码）。全部为 ⏳ 规格态，未实现；验收归 J.11 / 实施期。任务状态未改。
> 82. **状态回写（2026-10-28 · 立卡 TASK-J.18 · Worker 派工墓地门禁）**：依 SSOT §14.11 INV-LEDGER-03 第 1 款立 **`TASK-J.18`**。实施口径见新文件 [`worker-graveyard-gate.md`](./worker-graveyard-gate.md)：判定单元分强弱两类（依赖 / 安装命令 / 导入为强，路径 / 标识符 / 文字为弱），新增内容用行多重集差；派工检查点复核快照绑定；执行期优先级格（保护路径 > 安全墓碑 > 用户墓碑 > 越界）；SSOT §14.11 新增第 5 小节 G-MATCH 作为墓地匹配单一语义源，引擎与门禁共用夹具。登记缺口 GAP-W1～W6 与待拍板项 DEC-1（K-9 对 `ERROR_CODES` 的解释）。**本条仅文档立卡**。
> 84. **状态回写（2026-10-28 · 规格一致性审计收尾）**：`docs/specs/consistency-audit.md` 立档（2026-10-29 文档治理移至 `docs/ledger/consistency-audit.md`）（审计台账，非权威源；待裁决、机械修复、挂账项与权威分层）。K-16 `attributions.linked_reason_code` 类型名由 `reasonCodeSchema`（运行时常量）修正为 `ReasonCode`（推断类型）。审计机械修复 PR #9 已合入 main（`e430193`）。README 补 `playtest-self-check.md` 与 `consistency-audit.md` 索引。**无任务状态变化**，各任务卡状态未改。
> 85. **状态回写（2026-10-31 · J.1 合入）**：`TASK-J.1` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据 PR [#29](https://github.com/he18718143986-design/IDE/pull/29) / tip `4144a20`，`feat(daemon): TASK-J.1 右栏 partner 只读化`；partner 只读；相关测本机 51 passed）。同步：§1.1 矩阵、§3.4c 详细卡、Sprint「当前首要」→ **J.2**（主链起点；J.1 已收口）。**本条仅文档状态回写**；不改生产代码。
> 86. **状态回写（2026-10-31 · M2 真相缝 · J.2～J.9 / L.1～L.3 / L.5 合入）**：下列已合入卡由 `[NEW_TASK]` → **`[COMPLETED]`**（证据均为本仓 GitHub squash merge）：`TASK-J.2` [#4](https://github.com/he18718143986-design/IDE/pull/4)/`e6e1730`；`J.3` [#5](https://github.com/he18718143986-design/IDE/pull/5)/`f4656a9`；`J.4` [#6](https://github.com/he18718143986-design/IDE/pull/6)/`4832506`；`J.5` [#7](https://github.com/he18718143986-design/IDE/pull/7)/`c877d1c`；`J.6` [#11](https://github.com/he18718143986-design/IDE/pull/11)/`a9d7cb2`；`J.7` [#13](https://github.com/he18718143986-design/IDE/pull/13)/`67d7605`；`J.8` [#10](https://github.com/he18718143986-design/IDE/pull/10)/`b90241e`；`J.9` [#12](https://github.com/he18718143986-design/IDE/pull/12)/`1ad6eab`；`L.1` [#9](https://github.com/he18718143986-design/IDE/pull/9)/`8eb6896`；`L.2` [#8](https://github.com/he18718143986-design/IDE/pull/8)/`16c5176`；`L.3` [#15](https://github.com/he18718143986-design/IDE/pull/15)/`b4e0091`；`L.5` [#14](https://github.com/he18718143986-design/IDE/pull/14)/`0b6bc7f`。同步：§1.1 矩阵、§3.4c/§3.4d 详细卡（含 J 系 R-12 不变声明）、Sprint「当前首要」→ **J.10 ∥ L.4**；`J.10` / `L.4` / `L.6` 等未合入卡保持 `[NEW_TASK]`。**本条仅文档状态回写与真相缝**；不改生产代码。
> 87. **状态回写（2026-10-31 · J.10 / L.4 合入）**：`TASK-J.10`、`TASK-L.4` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据均为本仓 GitHub squash merge）：`J.10` [#17](https://github.com/he18718143986-design/IDE/pull/17)/`97bb0db`；`L.4` [#18](https://github.com/he18718143986-design/IDE/pull/18)/`9263504`。同步：§1.1 矩阵、§3.4c/§3.4d 详细卡、Sprint「当前首要」→ **L.6（进行中）**；`L.6` 仍为 `[NEW_TASK]`（本机推进，未合入）。**本条仅文档状态回写**；不改生产代码。
> 88. **状态回写（2026-10-31 · 拆分 TASK-J.18 · DoR R-11）**：原 `TASK-J.18` 估算 **L**，按 [`task-card-standard.md`](./task-card-standard.md) R-11 **禁止开工、必须再拆**。拆为四张 S/M 子卡：**`TASK-J.18a`**（G-MATCH 纯函数与产出物投影）、**`TASK-J.18b`**（`scheme_binding` + 快照 1.2 墓地权威源）、**`TASK-J.18c`**（门禁裁决 / 优先级格 / 派工绑定 / 码表）、**`TASK-J.18d`**（写路径接线、CLI gate pack、全量扫描与集成）。母卡 `TASK-J.18` 标为 **`[SPLIT]`**，指向子卡；实施口径仍见 [`worker-graveyard-gate.md`](./worker-graveyard-gate.md)。**本条仅文档拆卡**；不改生产代码。
> 89. **状态回写（2026-10-31 · J.18a / J.18b / L.6 / L.7 合入）**：下列已合入卡由 `[NEW_TASK]` → **`[COMPLETED]`**（证据均为本仓 GitHub squash merge）：`TASK-J.18b` [#22](https://github.com/he18718143986-design/IDE/pull/22)/`ca9ed8f`；`TASK-J.18a` [#24](https://github.com/he18718143986-design/IDE/pull/24)/`20c2d46`；`TASK-L.6` [#21](https://github.com/he18718143986-design/IDE/pull/21)/`93589bf`；`TASK-L.7` [#23](https://github.com/he18718143986-design/IDE/pull/23)/`607d742`。同步：§1.1 矩阵、§3.4c/§3.4d 详细卡、Sprint「当前首要」→ **J.18c（下一张）∥ L.8（L 系下一张）**；`J.18c`/`J.18d` 仍为 `[NEW_TASK]`（**未**标完成）。main tip `607d742`。**本条仅文档状态回写**；不改生产代码。
> 90. **状态回写（2026-10-31 · J.18c / J.18d 合入）**：下列已合入卡由 `[NEW_TASK]` → **`[COMPLETED]`**（证据均为本仓 GitHub squash merge）：`TASK-J.18c` [#26](https://github.com/he18718143986-design/IDE/pull/26)/`b6922ac`；`TASK-J.18d` [#27](https://github.com/he18718143986-design/IDE/pull/27)/`a2fa7df`。同步：§1.1 矩阵、§3.4c 详细卡、Sprint「当前首要」→ **L.8（下一张）**；母卡 `TASK-J.18` 仍为 **`[SPLIT]`**（子卡 a～d 均 COMPLETED）。main tip `a2fa7df`。**本条仅文档状态回写**；不改生产代码。
> 91. **状态回写（2026-10-31 · L.8 DoR R-4）**：补 `TASK-L.8`「对照痛点（代码事实）」为真实 `file::symbol` 锚点（`project-plan.ts::validateProjectPlan` / `plan-store.ts::readPlan`/`::writePlan` / `scheme-patch-engine.ts::mergeSchemePatch` / `scheme-snapshot-store.ts::writeSchemeSnapshot` 等），并写明今日缺 `plan-patch.ts`、`decomposer/`、`POST /api/project/plan/patch`。**不**改卡状态（仍 `[NEW_TASK]`）、**不**改范围目标到实现、**不**改生产代码。Sprint 仍指向 **L.8**。
> 92. **状态回写（2026-10-31 · L.14 合入）**：`TASK-L.14` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：[#31](https://github.com/he18718143986-design/IDE/pull/31)/`ae57543`（`feat(L.14): 凭据保险库（OS Keychain）`）。同步：§1.1 矩阵、§3.4d 详细卡；Sprint「当前首要」仍为 **L.8（下一张实现卡）**（L.14 为 M4 并行路径，不替代 L.8）。main tip `ae57543`。**本条仅文档状态回写**；不改生产代码；**不**开工 L.8。
> 93. **状态回写（2026-10-31 · L.8 合入）**：`TASK-L.8` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：[#33](https://github.com/he18718143986-design/IDE/pull/33)/`fb27504`（`feat(L.8): PlanPatch 合并、分解器与 /api/project/plan 接线`）。同步：§1.1 矩阵、§3.4d 详细卡、Sprint「当前首要」→ **L.9（下一张实现卡）**。main tip `fb27504`。**本条仅文档状态回写**；不改生产代码；**不**开工 L.9。
> 94. **状态回写（2026-10-31 · L.9 合入）**：`TASK-L.9` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：[#35](https://github.com/he18718143986-design/IDE/pull/35)/`e1cf1bb`（`feat(L.9): 合同序列、桩视图预检与下一份交接`）。同步：§1.1 矩阵、§3.4d 详细卡、Sprint「当前首要」→ **L.10（下一张实现卡）**。main tip `e1cf1bb`。**本条仅文档状态回写**；不改生产代码；**不**开工 L.10。
> 95. **状态回写（2026-10-31 · L.10 DoR R-4）**：补 `TASK-L.10`「对照痛点（代码事实）」为真实 `file::symbol` 锚点（`SchemeReviewPane.tsx::SchemeReviewPane` / `WorkspaceLayout.tsx::STUDIO_TAB_ID` / `ActivityBar.tsx::ActivityBar` / `daemon-api.ts::patchProjectPlan` / `next-stub.ts::nextStub`），并写明今日缺 `GET /api/project/plan`、`ProjectMapPane`、`tests/ui/project-map-pane.test.tsx`。**入口形态**按 Tina 2026-10-31 裁决改为跟 supervisor / [`project-decomposition.md`](./project-decomposition.md) §7：**同页嵌**于方案工作台，**禁止**另开 ActivityBar「项目」Tab / 独立视口。**不**改卡状态（仍 `[NEW_TASK]`）、**不**改生产代码、**不**开工 L.10 实现。Sprint 指针本条不动。
> 96. **状态回写（2026-11-01 · L.10 合入）**：`TASK-L.10` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：[#38](https://github.com/he18718143986-design/IDE/pull/38)/`e4351b0`（`feat(L.10): 画布同页嵌项目地图与 GET /api/project/plan`）。同步：§1.1 矩阵、§3.4d 详细卡、Sprint「当前首要」→ **L.11（下一张实现卡）**（前置 `L.4`/`L.9` 已 COMPLETED；同属 M3。另有就绪并行卡 `L.15`（M4，前置 `L.14`），本条不抢 Sprint）。main tip `e4351b0`。**本条仅文档状态回写**；不改生产代码；**不**开工 L.11；**不**修类型润色。
> 97. **文档治理第 0 波（2026-11-01）**：修 ADR 索引状态、reports 索引、DoR 快照横幅、DOC-3/4/11；见流水 **P-97**。不改生产代码；不动 DOC-1/2 大规模/DOC-5～10。
> 98. **状态回写（2026-11-01 · L.11 合入）**：`TASK-L.11` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓本地 squash merge 后推送 main）：[#43](https://github.com/he18718143986-design/IDE/pull/43)/`78ec236`（`feat(L.11): DesignNote generate/validate/inject on EXECUTING path`）。同步：§1.1 矩阵、§3.4d 详细卡迁 [`development-tasks-completed.md`](./development-tasks-completed.md)、Sprint「当前首要」→ **L.12（下一张实现卡）**（前置 `L.11` 已 COMPLETED；同属 M3。另有就绪并行卡 `L.15`（M4，前置 `L.14`），本条不抢 Sprint）。main tip `78ec236`。DN-2 HTTP/卡片入口缺口挂 ledger **DLV-6**（后续接线卡）。**本条仅文档状态回写**；不改生产代码；**不**开工 L.12；**不**另立 DLV 代码卡。
> 99. **状态回写（2026-11-01 · 台账债六项立卡）**：Tina 授权将第一类六项写成任务卡（纯文档）：`TASK-A.7`（Worktree seal 前缀）· `TASK-H.9`（DLV-4 · metadata→records）· `TASK-W.6`（DLV-3 · AdapterRegistry）· `TASK-L.18`（DLV-5 · 系统地图/影响闭包）· `TASK-J.19`（DLV-6 · DN-2 入口）· `TASK-J.20`（OP-1 授权清单实施约束；**不**回写已 COMPLETED 的 `TASK-J.9`）。同步：§1.1 矩阵、§3.4d/§3.4e 详细卡、索引、changelog P-99、ledger「待立卡→已立卡」。Sprint「当前首要」**仍为 `TASK-L.12`**（六卡均为 NON_BLOCKER，不抢主序）。物理 tip 对齐 `4328e50`（#45）。**本条仅文档立卡**；不改生产代码；**不**开工六卡；**不**重开 OP-1 裁决。
> 100. **状态回写（2026-11-01 · L.12 合入）**：`TASK-L.12` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓本地 squash merge 后推送 main）：[#47](https://github.com/he18718143986-design/IDE/pull/47)/`39f426a`（`feat(L.12): 系统知识库 checkKnowledge / withSystemScope / bootstrap`）。同步：§1.1 矩阵、§3.4d 详细卡迁 [`development-tasks-completed.md`](./development-tasks-completed.md)、Sprint「当前首要」→ **L.13（下一张实现卡）**（前置 `L.9`/`L.12` 已 COMPLETED；同属 M3。另有就绪并行卡 `L.15`（M4，前置 `L.14`），本条不抢 Sprint）。main tip `39f426a`。Tina 拍板（合入前）：① KB-1 维持「每个改动文件」（含非源码；真实物业口径）；② bootstrap 启发式改 B——只认 `contract_type === "knowledge_bootstrap"`，不看标题。**本条仅文档状态回写**；不改生产代码；**不**开工 L.13。
> 101. **状态回写（2026-11-01 · L.13 合入）**：`TASK-L.13` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：[#51](https://github.com/he18718143986-design/IDE/pull/51)/`51ea872`（`feat(L.13): Trailer Scheme-Items + explainLine 追踪链反查`）。同步：§1.1 矩阵、§3.4d 详细卡迁 [`development-tasks-completed.md`](./development-tasks-completed.md)、Sprint「当前首要」→ **L.15（下一张实现卡 · M4）**（前置 `L.14` 已 COMPLETED；L.15 代码 PR [#52](https://github.com/he18718143986-design/IDE/pull/52) 当时仍待修合（**已于** tip `9829385` 合入；docs 销项见版本头第 103 条）。M3 主序 L.13 已收口；台账债六卡中 A.7/H.9 代码已合入 main，**docs 回写另开**，本条不销）。main 物理 tip 对齐 `34213c8`（#51→#49→#50）。合入说明：反查行号**仅对已合入主干、且无本地脏改动的文件准确**；Worktree/脏区行号错位为已知限制。**本条仅文档状态回写**；不改生产代码；**不**开工 L.15；**不**混写 A.7/H.9 COMPLETED。
> 102. **状态回写（2026-11-01 · A.7 + H.9 合入）**：`TASK-A.7` / `TASK-H.9` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：A.7 = [#49](https://github.com/he18718143986-design/IDE/pull/49)/`4b7a709`；H.9 = [#50](https://github.com/he18718143986-design/IDE/pull/50)/`34213c8`。同步：§1.1 矩阵、§3.4e 详细卡迁 [`development-tasks-completed.md`](./development-tasks-completed.md)、索引、changelog P-102、ledger「Worktree seal 路径前缀」/ DOC-5 代码侧与 **DLV-4** → **RESOLVED**（不删行）。Sprint「当前首要」**仍为 `TASK-L.15`**（L.15 **代码已合入** [#52](https://github.com/he18718143986-design/IDE/pull/52)/`9829385`，**docs 回写另开**；本条不销 L.15）。物理 tip 对齐 `8148c2c`（含 #53 L.13 docs）。**本条仅文档状态回写**；不改生产代码；**不**宣称端到端闭环；**不**开工 L.16。
> 103. **状态回写（2026-11-01 · L.15 合入）**：`TASK-L.15` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：[#52](https://github.com/he18718143986-design/IDE/pull/52)/`9829385`（`feat(L.15): 发布生命周期与两类部署目标`）。同步：§1.1 矩阵、§3.4d 详细卡迁 [`development-tasks-completed.md`](./development-tasks-completed.md)、Sprint「当前首要」→ **L.16（下一张实现卡 · M4）**（前置 `L.15`/`L.9` 均已 COMPLETED，L.16 已就绪）。main 物理 tip 对齐 `6944f7d`（含 #58 A.7/H.9 docs；L.15 证据 tip = `9829385`）。**修正** #53/版本头第 101 条过时表述：L.15 代码已合入、本条完成 docs 销项——不再「仍待修合 / 未合实现卡」。已知挂账见 completed 卡（process-registry 仅内存、`/run` 同步阻塞、替身适配器未跑真 npm start）。**本条仅文档状态回写**；不改生产代码；**不**宣称端到端闭环；**不**开工 L.16。
> 104. **状态回写（2026-11-01 · J.20 + L.18 + J.19 合入）**：`TASK-J.20` / `TASK-L.18` / `TASK-J.19` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 squash merge 后推送 main）：J.20 = [#57](https://github.com/he18718143986-design/IDE/pull/57)/`4d2f8e1`；L.18 = [#54](https://github.com/he18718143986-design/IDE/pull/54)/`c8e6a81`；J.19 = [#55](https://github.com/he18718143986-design/IDE/pull/55)/`4bae423`。同步：§1.1 矩阵、§3.4d/§3.4e 详细卡迁 [`development-tasks-completed.md`](./development-tasks-completed.md)、索引、changelog P-104、ledger **DLV-5**/**DLV-6** → **RESOLVED**、OP-1 实施行标注 J.20 COMPLETED（白名单粒度：同一路径集、TTL≤90d、保护清单指纹变失效）。Sprint「当前首要」**仍为 `TASK-L.16`**（已就绪）；物理 tip 对齐 `4bae423`。gap-16 去掉「系统地图 UI 仍待 L.18」；DN-2 HTTP/画布入口已收口。台账债余卡 **`W.6`**（可开；不与 W.5b/c 同窗）。**本条仅文档状态回写**；不改生产代码；**不**宣称端到端闭环；**不**开工 L.16 / W.6。
> 105. **状态回写（2026-11-01 · 立卡 TASK-W.7 · Worker 自助注册与自动验证）**：Tina 授权纯文档立卡 **`TASK-W.7`**（`[NEW_TASK]` · **NON_BLOCKER**）：前端可注册任意 Worker，默认仅 `UNCONTROLLED_EXTERNAL`；升格 `GATEWAY_ENFORCED` 必须过内置四类探测包（文件/命令围栏、证据完整性、能力声明对账）；探测在沙箱执行；`verified_on` 绑版本指纹；`/api/workers*` 与设置页「验证」。硬前置 **`W.6`**（未就绪至 W.6 COMPLETED）；软前置 W.5c；**不抢** W.5b/c 实测窗口。同步：§1.1 矩阵、§3.3 详细卡、索引、changelog P-105、ledger DLV-3/DOR-3 加注。Sprint「当前首要」**仍为 `TASK-L.16`**。物理 tip 对齐 `b6c9a64`（P-104）。**本条仅文档立卡**；不改生产代码；**不**宣称端到端闭环；**不**开工 W.7 / W.6 / L.16。
> 106. **状态回写（2026-11-01 · L.16 合入）**：`TASK-L.16` 由 `[NEW_TASK]` → **`[COMPLETED]`**（证据为本仓 GitHub squash merge）：[#62](https://github.com/he18718143986-design/IDE/pull/62)/`e4dfe1c`（`feat(L.16): 线上问题回流（LiveIncident + E 类分流）`）。同步：§1.1 矩阵、§3.4d 详细卡迁 [`development-tasks-completed.md`](./development-tasks-completed.md)、索引、changelog P-106、Sprint 权威 tip → `e4dfe1c`。**当前首要推进说明**：主序实现卡已尽；**`L.17` 仍卡 oq-2 未裁决**（按 R-10 **不开工**）。台账债余卡 **`W.6`**（可开；不与 W.5b/c 同窗）+ **`W.7`**（硬前置 W.6 · 未就绪）。并同 PR 轻量对齐 [`../scheme.md`](../scheme.md) gap-17、[`delivery-lifecycle.md`](./delivery-lifecycle.md) S7 / 横切回流行。已知挂账见 completed 卡（发布页未进中栏、探活夹具偏 process_exit、E 类只指引、重启不重挂 watch 等）。**本条仅文档状态回写**；不改生产代码；**不**宣称端到端闭环；**不**开工 L.17 / W.6。
> 107. **状态回写（2026-11-01 · oq-2 裁决与 L.17 DoR 补齐）**：Tina 拍板 oq-2 北极星「一模一样」判定标准（`scheme.md` dec-12）：用户对话试玩 + 结构化证据桩（绑定版本/原话/时间戳），AI 引导不代判，无机器自动化对比。同步：`scheme.md`（q25、R-OQ2、dec-12、oq-2 销项、acc-6 更新、REJ-009 入墓）、`consistency-audit.md`（一之二/五 销项）、`ledger/README.md`（OQ-2 RESOLVED）、`development-tasks-active.md`（L.17 解除 oq-2 阻断、补全 PASS/FAIL 与拆分规划）、`delivery-lifecycle.md`（M5 dec-12）、changelog P-107、版本头 #107。**本条仅文档**；不改生产代码；**不**开工 L.17 / W.6。
> 108. **状态回写（2026-11-01 · oq-3 裁决与 L.17 拆分子卡立卡）**：Tina 拍板 oq-3 凭据保管口径（`scheme.md` dec-13）：① 凭据存 Vault 直至用户手动删除（不设自动过期、不按项目联动清理）；② 代登 cookie 过期后由 Daemon 用 Vault 账密静默重登，Worker 全程无感、全程不见账密；重申 ADR-0014 §3 账密/cookie 绝不进合同/日志/Worker 环境。母卡 `TASK-L.17` 标注 `[SPLIT]`（已拆分为 L.17a + L.17b，保留追溯）；立两张子卡并达 DoR `[READY]`：`TASK-L.17a`（受控摄取与代登代理 · 估算 M · 前置 L.14 + oq-3）与 `TASK-L.17b`（对比视图与试玩证据桩 · 估算 M · 前置 L.17a + L.16，状态 READY（待 L.17a））。同步：§1.1 矩阵、索引、changelog P-108、ledger oq-3 销项、delivery-lifecycle M5 拆分完成。权威 tip 对齐 `042e570`（#64 squash）。**本条仅文档**；不改生产代码；**不**开工实现。
> 65. **状态回写（2026-10-26 · 实现完成 TASK-C.14f + TASK-C.15a–d）**：Tina t855u「继续项 2（WS）与项 4（EO 余面 Delta）的立卡实现」。已落地：`BASELINE_PROGRESS` WS（停 2s 轮询）；EO-01 完备+转移 DAG；EO-08 UUIDv5/返工计数；EO-05 签署白名单 GC + MERGED→DELIVERED 失败停 MERGED；P0 drafts 隔离 + EO-09 worktree seal。单测 `task-c14f-*` / `task-c15a–d-*` + C.12 回归绿。**不**扩 Spec Freeze 五正文；P1–P3 仍 backlog。
> 64. **状态回写（2026-10-26 · 立卡 TASK-C.14f + TASK-C.15a–d · WS 深度进度 + EO 余面 Delta）**：Tina t855u「继续项 2（WS）与项 4（EO 余面 Delta）的立卡实现」。按此前安全闭环后暂缓的 backlog 升格为薄卡：**`TASK-C.14f`**（基线深度进度真 WS/流式：Daemon 推 `BASELINE_PROGRESS`，替换前端 2s 轮询；P0 仍秒级解锁右栏）；**`TASK-C.15a`**（EO-01 DeliveryState 完备：补齐 C.12b 简化缺口与合法转移）；**`TASK-C.15b`**（EO-08 断言身份与返工计数：UUIDv5 `assertion_id` + Daemon 权威计数 + 超限 `ESCALATED_HUMAN` + 返工期禁追加）；**`TASK-C.15c`**（EO-05 两阶段归档/GC：签署期白名单 GC；`MERGED`→`DELIVERED` 事务硬化，失败停 `MERGED`）；**`TASK-C.15d`**（P0 AC-ISOL 草稿隔离 + EO-09 Worktree seal 轻量；P1 sufficiency / P2 确认分级 / P3 视口防抖仍 backlog）。建议序 **C.14f → C.15a → C.15b → C.15c → C.15d**；**当前首要**→ **C.14f**。**本条仅文档立卡**；**不写**产品码直至同授权「立卡实现」开工；**不**扩 Spec Freeze 五正文；不抢 D.1e；不改 D.1 鉴权。权威：基线讨论稿 §5/§7 流式 OPEN；右栏 §14.11 EO-01/05/08/09 + §13 P0；C.12 Top5 已覆盖部分不重复。
> 58. **状态回写（2026-10-26 · 立卡 TASK-C.12a–e · Spec Freeze → Top5 Delta 升级卡）**：Tina 授权（t817u「升格立卡」）。按封版记录 `docs/reports/spec-freeze-record.md`（tip `e4779ad`）与澄清 §6 / Checklist §3，将 API Top5 As-is→To-be 映射为五张 **Delta 升级卡**（**不推翻**现网 session / STATE / prototypes / PAUSED 弹窗骨架）：**`TASK-C.12a`**（双层 Token：`exec_token` + `resume_token`+`jti`；PAUSED 吊销；EO-07）、**`TASK-C.12b`**（`session_epoch`+`state_seq` + EO-01 `DeliveryState` 广播；含 `CONTRACT_SIGNING` 瞬态）、**`TASK-C.12c`**（越界原子拦截：SIGINT 3s→SIGKILL→吊销→清锁→PAUSED；EO-02/07）、**`TASK-C.12d`**（Demo 三态 + `can_sign` + records 轻量拷贝；EO-05/06）、**`TASK-C.12e`**（`.stagent/records/{contract_id}/audit-manifest.json`；EO-03/04/05）。建议序 **C.12a→C.12b→C.12c→C.12d→C.12e**；**当前首要**→ **C.12a**。**本条仅文档立卡**；**CLOSED ≠ 已实现**；**不写** daemon/src 产品码直至 Tina 点名开发；**不抢** D.1e；Impact/Mode/AST/云归档仍 **v0.2+**；不改 D.1 loopback+#token 通道原则。
> 57. **状态回写（2026-10-26 · 过夜合入 TASK-C.11a–e COMPLETED）**：Tina t748u 授权过夜开发。五步体感链前端可感知落地（选择题 / prototypes Demo+确认 / 白话合同卡 / 越界 PAUSED 弹窗 / 质疑回灰）；`run-worker` 挂 Demo 确认门禁。验收见 见 Git 历史（原 `docs/archive/c11-supervisor-five-step-brief.md`）。**不升格**讨论稿；**不改** D.1 鉴权；**不抢** D.1e。
> 56. **状态回写（2026-10-26 · 立卡 TASK-C.11a–e · Supervisor 五步体感链）**：Tina 授权（t747u 五张一起写进任务规范；t748u 过夜直接开发）。按定妆照五步新增 **`TASK-C.11a`**（右栏推荐选择题 ≤2 轮）、**`TASK-C.11b`**（隔离 Demo → `.stagent/prototypes/` + 感官确认）、**`TASK-C.11c`**（白话合同卡签署前零写入主干）、**`TASK-C.11d`**（施工图 Evidence 点亮 + 越界 PAUSED 扩权/回滚）、**`TASK-C.11e`**（真机对照验收 + 质疑触发 S.5 自查回灰）。硬标准对齐 见 Git 历史（原 `docs/archive/engineering-decisions-top7.md`） 与《核心资产治理》《Supervisor运转机制》。建议序 **C.11a→C.11b→C.11c→C.11d→C.11e**；**当前首要**→ **C.11a**。**不升格**整份澄清/API 讨论稿；**不抢** D.1e；Impact 完整 AST 仍 v0.2+；架构规范仅 §11 注记 9 轻量锚定（呈现/门禁体感，不改变 loopback+#token / Demo 独立 Origin 原则）。
> **测试数量口径（v1.6.2）**：任务卡中的历史文件/用例数仅供溯源。C.10q tip `4280de6`（当时 **1342 passed / 6 skipped**；此前 C.10p **1335 passed / 6 skipped**）为**历史**测试基线。**现行物理 tip 指针**：见「Sprint … 实施基线核验」与版本头最新条（勿把本句当当前 HEAD）。

| 任务编号 | 任务名称 | 归属模块 | 状态 | 规范 §10 里程碑 | 关键变动与工程闭环要点 (v1.6.1) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-0.1** | 工程锁文件与跨平台 CI 自动化基线 | 基础设施 | **[COMPLETED]** | P0 基础设施 | 依赖锁死、`verify-env.mjs` 门禁脚本、跨平台环境校验已就绪。 |
| **TASK-0.2b** | Schema v1.2.0 增量演进、双状态机联动与存量迁移 | 数据模型 | **[COMPLETED]**（提交 `52c807c` 锁定基线；当前物理基线已交付） | P0 契约底座 | • 升级 `SoftwareContractV12` 与 `EvidenceBundleV11` 完整字段<br>• 实现 `validateStatePair`、`validateTransition` 与原子落盘<br>• 承接历史合同迁移与备份机制，10 错误码映射通过 |
| **TASK-0.2c** | Schema v1.3.0 增量演进、Fast Path 与自愈迁移边实现 | 数据模型与状态机 | **[COMPLETED]**（提交 `fb2cc67`，经 `cd7e7e0` 合入 main；tsc 0 错 / eslint 0 错；新增 48 项单测、迁移矩阵 +7，全量 903 例） | P0.2c 契约与状态机演进 (C-01) | • 认领 C-01 整改项，代码落地第一优先级<br>• 升级 `SoftwareContractV13` 与 Zod Schema，增设 `approval` 与 `authorization.git`<br>• 补齐 Fast Path 严格流转边 (`DRAFT -> PREPARING -> EXECUTING`，严禁直跳)<br>• 补齐外部改码级联降级边 (`AUDITED -> VERIFYING`，使 Evidence 失效并回退重验)<br>• 补齐恢复探测自愈边 (`PENDING_RESUME -> PREPARING`，探测 Worktree 丢失自愈重建)<br>• 升级 `migrateContractToV13`，执行态族白名单回填 (`user:legacy`)，草案/待审安全保持，零静默授权<br>• 新增 `tests/unit/contract-schema-v13.test.ts`、9 态 lifecycle 迁移矩阵覆盖及 15 态展示投影测试 |
| **TASK-D.1** | CLI 引导入口与安全 WebSocket 通信桥 | 通信核销 | **[COMPLETED]**（2026-10-20；48 文件 / 377 用例全绿，含首帧 50ms 切断、Token 轮换、Origin/Host/2MB/速率/心跳断言） | P1 通信鉴权 | • 提前至 Sprint 1 解除 DAG 死锁<br>• CLI `stagent start`、动态端口 (3001~3010)、PID 锁与 Token 轮换 (G-13)<br>• 检测到存活 PID 锁时抛出 `E_WORKSPACE_LOCKED` 拒绝重复绑定工作区<br>• 首帧 AUTH 握手鉴权、非法以 `4401` 关闭<br>• 规范帧字典（同时保留 `EVIDENCE_READY`、`EVIDENCE_STATUS_CHANGED`、`TERMINAL_STREAM`）<br>• 补齐 Origin 校验、帧大小（≤2MB）与速率限制、失联 3 次心跳遮罩 |
| **TASK-D.1b** | 一键打开项目（Daemon 托管控制台 + open CLI） | 通信核销 / DX | **[COMPLETED]**（2026-10-24 合入 main，merge `d5b35e0`；功能 `946e9fc`；合后四件套 1188 passed / 6 skipped） | P1 通信鉴权（DX 增量） | • `stagent open <路径>` → 单浏览器窗口工作台已连上，无需第二终端/手拷 Token<br>• Daemon 托管 `dist/public` 同源控制台；自动 open `#token=` fragment；`#base=` 避免死认 3001<br>• Demo 仍独立 Origin（4100~4110）；不推翻 D.1 鉴权；不含 Electron/Tauri/系统协议 |
| **TASK-D.1c** | 最近项目一键重开（控制台「打开项目」） | 通信核销 / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `f3e371e`；合后四件套 1204 passed / 6 skipped） | P1 通信鉴权（DX 增量） | • 控制台「打开项目」展示最近工作区列表；一点即复用/唤起带 `#token=` 会话，无需再敲 `stagent open`<br>• 本机 `~/.stagent/recent-projects.json`（非业务仓保护区）；`stagent open` 成功写入；`GET/POST /api/recent-projects`<br>• **不含**真·任意路径文件夹选择器；不推翻 D.1/D.1b 鉴权；锁冲突白话 |
| **TASK-D.1d** | 修复同源控制台空白（生产可用单窗口） | 通信核销 / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `b11d15b`；合后四件套 1208 passed / 6 skipped） | P1 通信鉴权（DX 增量） | • 前置 `D.1b`+`C.2`；`dist/public` 驱动完整 Studio（SPA `$_TSR` 壳，非残缺静态壳）<br>• `stagent open` 单窗口可聊、无白屏、不强制二次起 Vite；四件套 + dist 静态可用性回归已绿<br>• **不推翻** D.1 loopback+#token/AUTH/Origin；Demo 仍 4100~4110 独立 Origin |
| **TASK-D.1e** | 桌面壳/本机助手：真·选文件夹（Import 同壳） | 通信核销 / DX | **[DEFERRED → v0.2+]** | P5.8 产品壳（v0.2+） | • 系统文件夹选择器 / 轻量本机助手或 Electron·Tauri；Import/New 与工作台同壳<br>• 仍经 D.1 鉴权发 `#token=`；**推迟至 v0.2+**，不阻塞 v0.1 / D.1d；不含把 Demo 改同源 |
| **TASK-D.3** | 15 状态确定性投影持久化与防死锁自愈引擎 | 通信与控制面 | **[COMPLETED]**（2026-10-23 合入 main，merge `9a19f4d`；含 `c2fcb8a` + `83ec516`；合后四件套 1084 passed / 6 skipped） | P3.7 状态投影与防死锁 | • `presentation_state` 落盘 `.stagent/state.json`（与 contracts 并列，不写回合同）+ Daemon `STATE_CHANGED` 广播与重连回放<br>• D-1~D-5 看门狗引擎（可注入时钟 + `sweep`）及生产接线：D-1 abort 超时、D-2 租约心跳、D-3 `PENDING_RESUME` 自愈、D-4 merge 409 二选一、D-5 Gateway 分层超时<br>• 新增/更新：`presentation-store` / `presentation-projector` / `deadlock-resilience` 与接线、集成测试 |
| **TASK-A.1** | Git Worktree 物理隔离与生命周期管理 | 执行内核 | **[COMPLETED]** | P1 本地 Git | Worktree 创建、销毁、分支保护与 `.git/info/exclude` 隔离就绪。 |
| **TASK-A.2** | Scoped MCP 工具网关与路径沙箱校验 | 执行内核 | **[COMPLETED]** | P2 安全网关 | 路径防逃逸、Scope 读写授权、禁区强拦截与环境脱敏就绪。 |
| **TASK-A.3** | 依赖分级复用与工作区构建缓存隔离 | 执行内核 | **[COMPLETED]** | P1 依赖隔离 | 只读依赖复用 (ADR-002)、构建缓存目录隔离与符号链接降级就绪。 |
| **TASK-A.4** | 受限进程执行器与跨平台进程树全回收 | 执行内核 | **[COMPLETED]** | P2 进程执行 | 白名单命令执行、POSIX 进程组 / Windows taskkill 回收就绪。 |
| **TASK-A.5** | 循环重试熔断与费用/Token 硬上限监控 | 执行内核 | **[COMPLETED]** | P2 熔断守护 | 验证重试熔断 (`max_verification_retries: 3`)、超时与费用预检就绪。 |
| **TASK-A.6** | Daemon 崩溃自愈、Git 锁清理与 TOCTOU 校验 | 执行内核 | **[COMPLETED]** | P1 崩溃自愈 | 孤儿锁安全回收、`resume()` 扫描自愈、快照指纹校验就绪。 |
| **TASK-A.7** | Worktree seal 路径前缀对齐 | 执行内核 / 护栏 | **[COMPLETED]**（tip `4b7a709` / merge [#49](https://github.com/he18718143986-design/IDE/pull/49)） | 台账债（DOC-5 代码侧） | • 前置 `A.1`/`C.15d`<br>• seal 与 manager 统一 `task-{id}`；旧无前缀不迁移<br>• 详见 §3.4e → completed |
| **TASK-S.1** | Supervisor 建议会话与持久化存储管理 | 建议中枢 | **[COMPLETED]**（2026-10-24 合入 main，merge `a9066dd`；功能 `a7d7292`；合后四件套 1122 passed / 6 skipped；节流器单测 23 例） | P4 智能建议 | • Local-First 会话落盘 (`.stagent/sessions/`)、Prompt Pipeline<br>• 依赖层静态 AST 扫描禁令 + 运行时越权调用拦截正例断言<br>• 独立日预算分账 `.stagent/supervisor-budget.json`<br>• `SupervisorWakeupThrottler`：3s Debounce 默认关闭；显式/阻断/回合结束仍唤醒；STREAMING/TOOL_RUNNING 硬静默；SNOOZE 10 分钟 |
| **TASK-S.2** | 按需合同草案生成（L0 规则 / L1 强模型） | 建议中枢 | **[COMPLETED]**（按需触发、L0 规则引擎、L1 强模型补全、G-11 未决问题零丢失、脱敏均已落地） | P4 合同草案 | • 用户显式请求或事件触发时按需生成草案，L0 规则优先、L1 强模型按需；白话文案<br>• 草案全字段生成 (含必填 `worker_spec`)<br>• 断言未决问题 100% 保留至草案元数据供用户确认 (G-11)<br>• 保留脱敏模块 `src/lib/ipc/redaction.ts` |
| **TASK-S.3** | Supervisor HUD 建议流与 WebSocket 广播 | 建议中枢 | **[DEFERRED → v0.2+]** | P4 HUD 广播 | • v0.2+：WebSocket 建议帧广播、ACCEPT/SNOOZE/DISMISS 上行 action<br>• v0.1 保留范围：仅脱敏模块并入 S.2 精简版移植 |
| **TASK-S.4** | Demo 静态原型生成器与 Mock 预览服务 | 建议中枢 | **[COMPLETED]**（提交 `95ea2a3` + `07af0f2`，经 `d5ee448` 合入 main；19 项单测全绿、tsc 0 错 / eslint 0 错） | P4.5 原型先行 (v1.6.1) | • 单文件受控落盘上限 ≤2MB（超限抛 `E_DEMO_PAYLOAD_TOO_LARGE`）<br>• 独立 Origin 端口 (4100~4110) 与轻量预览服务<br>• 前端 `iframe sandbox="allow-scripts"` (严禁 `allow-same-origin`)<br>• 严格 CSP 策略阻断连接 Daemon 端口；Daemon 校验 Origin 阻断 Demo iframe 越权 RPC<br>• 增量演进快照归档与回退机制 |
| **TASK-S.5** | Supervisor 质疑自查与根因分流归因引擎 | 建议中枢 | **[COMPLETED]**（`a1469b7` + `a83f18a`，经 `2bb1313`、`5748ad0` 合入 main；tsc 0 错；新增 19 用例 + main 回归 90 例全绿）<br>注：已知 7 处局限（右栏事实取空 diff、读旧 requirements.md、注释可伪造触及等）由 TASK-J.16 实施时一并修复，见 [`playtest-self-check.md`](./playtest-self-check.md)；本行 COMPLETED 判定不因此回改。 | P5.7 质疑自查 (v1.6.1) | • 第 0 步补齐 `.stagent/specs/requirements.md` 受控快照：合同意图初始化、`specs/revisions/req-v*.md` 冻结、执行期不可变（`E_SPEC_SNAPSHOT_IMMUTABLE`）<br>• `evidence-triad.ts`：会话原始意图/确认记录 + 规范快照命中条目 + Worktree Diff/终端/验证退出码三方抓取<br>• 60s 看门狗 `E_DISPUTE_TIMEOUT`；置信度 < 0.7 自动降级人工裁决<br>• 分流 `IMPLEMENTATION_BUG` / `REQUIREMENT_DRIFT`；返工严格取「变更文件 ∩ 合同 Scope」，越界进 `rejected_paths` 并提示 `EXPANDED_SCOPE_REQUIRED`，绝不扩权<br>• `POST /api/supervisor/dispute` + `DISPUTE_REPORT_READY` 广播（含三方证据链摘要）；`change_request_id` 贯通报告/提案 |
| **TASK-S.6** | 非技术旅程串联（右侧分流 + 确认原型开工） | 建议中枢 / 编排粘合 | **[COMPLETED]**（2026-10-24 合入 main，merge `6415fbd`；功能 `bbab79e`；合后四件套 1155 passed / 6 skipped；**S.6b 已收口** merge `024d2b8` / `613ff51`，1165 passed / 6 skipped） | P4.5 / P5.7 串联（八步旅程最后一公里） | • 右侧唯一入口白话分流：质疑 → `POST /api/supervisor/dispute` + 白话卡；大事 → 草案；小事 → Fast Path（免强制 Demo）<br>• 吸收 C.2 残余：【确认原型并实施真实工程】真建全灰 TaskGraph 并进入审批/开工链（禁止只改 nonce）<br>• 聊完一段落后左侧需求说明可感知刷新；审批/开工后中栏图随真实 Evidence 点亮（复用既有 verify）<br>• **S.6b COMPLETED**：`REAL_PLAYTEST` 真预览 URL 挂中栏 iframe +「在浏览器打开」外链（4200–4210 stub/attach）<br>• 底座复用 S.4/C.7/S.5/C.2/S.2/W.5a，不重砌；对照 见 Git 历史（原 `docs/archive/non-technical-journey-acceptance.md`） |
| **TASK-W.1** | Coding Worker 适配器抽象与任务指令装配 | 编码内核 | **[COMPLETED]**（已合入 main，worker-adapter.interface / adapter-registry 在位） | P2 Worker 适配 | • 统一 `CodingWorkerAdapter` 接口，支持 Managed AI / CLI<br>• 补齐第 9 项 `known_limitations`<br>• 区分 `GATEWAY_ENFORCED` 与 `UNCONTROLLED_EXTERNAL`<br>• 合同上下文装配 + Worktree 隔离校验，专用用例 34 个 |
| **TASK-W.2** | Scoped Gateway 强制工具注入与执行拦截 | 编码内核 | **[COMPLETED]**（2026-10-21 核验：`2e1290c` 已合入 main；仅含当时交付范围） | P2 工具管辖 | • 统一 `stagent_*` 命名空间 5 工具（含 `delete_file` / `list_directory`）<br>• `stagent_write_file` 的 `expected_hash?` 乐观锁（G-03），失配 `E_CONFLICT`<br>• 强制结构化 argv 且 `shell:false`，字面量拦截注入符号 (G-04)<br>• 越界/禁区阻断并标记 `BLOCKED`，专用用例 29 个 |
| **TASK-W.2b** | 未跟踪文件 Scope 联合检查与越界阻断 | 编码内核 | **[COMPLETED]**（提交 `87f909c`，经 `05f090f` 合入 main；`daemon/pipeline/untracked-scope-guard.ts` + `E_OUT_OF_SCOPE_UNTRACKED`） | P2 Scope 完整性 | • 执行后同时检查 tracked Diff 与 untracked 文件<br>• 新增稳定错误码 `E_OUT_OF_SCOPE_UNTRACKED`<br>• 前置：TASK-0.2c、TASK-W.2 |
| **TASK-W.3** | 测试环境、秘密脱敏与网络/端口策略守卫 | 编码内核 | **[COMPLETED]**（policy-guard.ts 已接入 Gateway 与 Runner；14 用例绿） | P2 环境网络 | • 环境变量白名单过滤、`CI=true` 注入、`env_file_grants` 按命令授权<br>• 秘密遮蔽严密发生在日志截断之前<br>• 网络策略拦截 (`DENY` / `EXPLICIT_TARGETS` / `USER_APPROVED`)、动态端口 |
| **TASK-W.4** | 高风险执行威胁守卫与运行时能力复检 | 编码内核 | **[COMPLETED]**（threat-guard.ts + runtime-interceptor.ts 已接入；26 用例绿） | P2 安全威胁 | • 闭环 G-01 & G-20：落地 `daemon/worker/threat-guard.ts`<br>• 命令 argv 与仓库信任检查，高风险特权命令抛 `E_UNSAFE_EXECUTION` 并阻断<br>• 会话期周期性复检，检测到绕过立即降级为 `UNCONTROLLED_EXTERNAL` 并阻断 Evidence<br>• 落实 4 类绕过路径不可用负例断言 |
| **TASK-W.5a** | Claude Code 适配器（cli-host 黑盒实测） | 编码内核 | **[PASS]**（真实 CLI 负例 6/6 全绿，已完成 Shell 加固） | P5.5 受控实测 | cli-host spawn 挂载、Pre-tool hook 拦截、Headless 结构化输出、会话续接；4 类绕过负例实测。 |
| **TASK-W.5b** | cursor-agent 适配器（cli-host 黑盒实测） | 编码内核 | **[NEW_TASK]** | P5.5 受控实测 | 权限 deny 实测；不能完全关闭原生写能力则仅登记 `UNCONTROLLED_EXTERNAL`（仅 Vibe）。 |
| **TASK-W.5c** | OpenHands 适配器（容器隔离） | 编码内核 | **[NEW_TASK]** | P5.5 受控实测 | 容器内仅挂载任务 Worktree；`control_mode = SANDBOX_ENFORCED`。 |
| **TASK-W.6** | AdapterRegistry 接线 / Claude Worker 派工（DLV-3） | 编码内核 | **[NEW_TASK]** · NON_BLOCKER | 台账债 DLV-3 | • 前置 `W.1`/`W.5a`<br>• Registry 进派工；禁硬编码只认 AiWorker<br>• **不阻断** L.15；不抢 W.5b/c；详见 §3.3 |
| **TASK-W.7** | Worker 自助注册与自动验证 | 编码内核 | **[NEW_TASK]** · NON_BLOCKER | 自助注册/探测升格 | • 前置硬 `W.6`；软 `W.5c`<br>• 默认 `UNCONTROLLED_EXTERNAL`；探测通过升格 `GATEWAY_ENFORCED`<br>• **不抢** W.5b/c 实测窗口；不阻断 L.16；详见 §3.3 |
| **TASK-B.1** | 本地 AST 增量依赖图分析引擎 | 架构感知 | **[DEFERRED → v0.2+]** | A §3 架构引擎 | 冷启动 ≤1.5s，单文件增量修补 ≤20ms。 |
| **TASK-B.2** | 多活跃 Worktree 监听与 Evidence 状态联动 | 架构感知 | **[DEFERRED → v0.2+]** | P4 状态失效 | 外部变更在 watcher debounce 窗口内触发 Evidence `STALE`；合并前指纹复核兜底。 |
| **TASK-C.1** | Cursor 式三栏 IDE 响应式工作台骨架与 Studio 视口 | 前端呈现 | **[COMPLETED]**（WorkspaceLayout / WorkspaceHeader / SplitPaneContainer 在位；8 用例绿） | P3 工作台闭环 | • 左侧文件树/Git 状态、中栏多标签、右栏双 Agent 对话<br>• Header 补齐模式、受控徽标与分支指示<br>• 审批后默认绑定合同 Worktree |
| **TASK-C.2** | 中栏 Supervisor Studio 多维视口集成 | 前端呈现 | **[COMPLETED]**（2026-10-24 合入 main，merge `51039aa`；功能 `c1ad3be`；合后四件套 1099 passed / 6 skipped；新增 UI 15 例） | P4 审批与多维视口 | • `StudioViewportShell` 统一挂载 Demo / Graph / 质疑 / 合同四视口（`hidden` 保活，切换不丢表单与点亮）<br>• 默认视口只消费 Daemon `presentation_state`（`STATE_CHANGED` + `GET /api/state` 兜底）；手动 Tab 可覆盖，展示态一变清覆盖<br>• 复用 C.7 `TaskGraphPanel`、S.4 iframe 沙箱（仅 `allow-scripts`）、S.5 质疑自查 API；合同审阅与保护清单白话卡保持 |
| **TASK-C.3** | Monaco 核心编辑器集成与受控 Worktree 读写 | 前端呈现 | **[COMPLETED]**（MonacoEditorPane + useWorktreeFile 在位；4 用例绿） | P3 代码编辑 | Monaco Editor 嵌入，可写/只读视觉区分，编辑器内 Evidence STALE 指示，越权保存 403 拒绝。 |
| **TASK-C.4** | 架构雷达视图与 Scope 圈选抽屉 | 前端呈现 | **[DEFERRED → v0.2+]** | P3 架构雷达 | 1000 节点拓扑渲染；交互式 Scope 圈选。 |
| **TASK-C.5** | 双栏 Diff 审阅器与结构化终端日志回放 | 前端呈现 | **[COMPLETED]**（components/diff/* + StructuredTerminal.tsx 在位；5 用例绿） | P3 差异终端 | 双栏/内联 Git Diff 审阅；结构化终端流式日志展示、ANSI 渲染、先脱敏后截断。 |
| **TASK-C.6** | 右栏 Agent 流式会话与打断续接 | 前端呈现 | **[COMPLETED]**（AgentChatPane + use-agent-session 在位；8 用例绿） | P3 会话闭环 | 流式渲染、工具卡片、Stop/打断、排队追加、Adapter 切换、会话列表与 resume。 |
| **TASK-C.7** | 业务功能树与 Task Graph 渐进点亮视口 | 工作台 UI | **[COMPLETED]**（2026-10-23 合入 main，merge `5117b27`；原交付于 `feat/task-c7-graph-engine`，基线 `main@05f090f`；干净环境四件套全绿：1032 passed / 6 skipped；新增 31 用例：24 单元 + 7 UI） | P4.5 拓扑点亮 (v1.6.1) | • `daemon/graph/graph-engine.ts`：Daemon 独占内存权威 + 原子落盘 `.stagent/specs/task_graph.json`，`revision` 单调递增、对外只给快照<br>• `SupervisorProposalV1` 以 `Omit<TaskNode, "state" \| "executed_at" \| "commit_sha">` 类型层剥离运行态；运行期夹带运行态字段直接 `E_PROPOSAL_INVALID`<br>• 七态严格对齐 §3.2.1；`illumination-verifier.ts` 要求「受控写入 + 退出码 0 + Commit SHA + 文件指纹」，空命令集/空结果集 `E_EMPTY_VERIFICATION_BLOCKED` 拒绝点亮（UI 警告灰，不假绿）<br>• `evidence-collector.ts`：文件 SHA-256、Scope、HEAD 由 Daemon 现算，HTTP 调用方不得自报证据<br>• 外部改码 `STALE_REVERIFY` 变灰并撤销指纹；AUDITED 合同同周期退回 VERIFYING<br>• `TASK_GRAPH_UPDATED` 帧 + `revision` 乱序保护；业务功能树 / 执行 DAG 双视图，100ms 翠绿过渡<br>• 左栏【规范与资产】专区展示需求 / 合同 / Demo 与真实点亮进度；文件树随图谱更新刷新 |
| **TASK-C.8a** | 老板模式文案与默认助手（消演示恐吓 / Key 向导） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `15ef8e6`；合后四件套 1213 passed / 6 skipped） | P4 体验打磨 | • 前置 `D.1d` COMPLETED<br>• 演示→可折叠练习沙箱；收起「不调用模型」恐吓；默认优先真助手<br>• 未配 Key：右栏三步向导 + 一键进设置；设置页白话闭环<br>• **不含**改鉴权 / Demo Origin / 新开桌面壳 |
| **TASK-C.8b** | Fast Path 老板三步台（藏工程师合同细节） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `6d16939`；合后四件套 1224 passed / 6 skipped） | P4 体验打磨 | • 前置 `D.1d` + `S.6` COMPLETED<br>• 小事 Fast Path 中栏收成老板三步：「改哪里 / 要不要动保护 / 确认开改」<br>• 默认折叠 src/**、npm、Daemon、保护解锁等合同工程细节；需要时再展开<br>• **不含**改 Fast Path 准入规则本体 / 状态机边 |
| **TASK-C.8c** | 连接与打开死路自救（无钥匙一键重开 + 粘贴路径） | 工作台 UX / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `950e53e`；合后四件套 1217 passed / 6 skipped） | P4 体验打磨 | • 前置 `D.1b`/`D.1c`/`D.1d` COMPLETED；**不抢** `D.1e`（系统选择器仍 DEFERRED）<br>• 无 token 冷开：一键重开带钥匙会话，不死锁对话<br>• 开新夹：粘贴绝对路径 + 一键重开/唤起，少催「去终端敲 npx stagent open」说明书<br>• **不含**系统文件夹选择器 / Electron·Tauri |
| **TASK-C.9a** | 首屏单一主路径（三态只留一个指挥信号） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `ef0e1a7`；合后四件套 1231 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.8a`/`C.8b`/`C.8c` COMPLETED<br>• `resolveCommandSurface`：no_key / idle / in_progress 单一主 CTA<br>• 欢迎区/打开面板默认收/顶栏徽标降级<br>• **不含**改鉴权 / Demo Origin / 新开桌面壳 |
| **TASK-C.9b** | 助手模式互斥（练习 vs 真助手 vs 向导） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `c4818fa`；合后四件套 1239 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.8a` COMPLETED<br>• `resolveAssistantMode`：wizard / practice / real 互斥；向导发送禁用<br>• 练习横幅 + 中栏随模式；禁止缺钥匙装忙<br>• **不含**改鉴权 / 真实云调用门禁本体 |
| **TASK-C.9c** | 打开项目面板生命周期（默认收 / 成功即关） | 工作台 UX / DX | **[COMPLETED]**（2026-10-24 合入 main，tip `2f5d653`；合后四件套 1246 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.8c` COMPLETED；**不抢** `D.1e`<br>• 默认收；成功即关；已连接「切换项目」；`resolveOpenProjectEntryPresentation`<br>• **不含**系统文件夹选择器 |
| **TASK-C.9d** | 进行中中栏让路（收欢迎页 / 设置深链回跳） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `edc28ce`；合后四件套 1254 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.9b` + `C.8b` COMPLETED<br>• `middle-yield` + 自动开 Studio；设置深链/回跳；聊≠改白话<br>• **不含**重做 Studio 四视口路由本体 |
| **TASK-C.10a** | 进行中生命周期收口（退出 in_progress / 无空让路壳） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `5207df2`；合后四件套 1261 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9a` + `C.9d` COMPLETED<br>• `resolveActiveInProgress`；历史旅程卡不粘；无空 middle-yield；Studio 保持开<br>• 与 C.9a/C.9d 指挥纪律一致<br>• **不含**重做 Studio 四视口；改鉴权 |
| **TASK-C.10b** | 设置页老板主路径（钥匙主视线 / 工程师项进高级） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `be33a26`；合后四件套 1265 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.9d` + `C.8a` COMPLETED<br>• 模型钥匙置顶；高级默认折叠含连接/诊断/工作区<br>• 保留 C.9d 深链 + 返回对话<br>• **不含**改鉴权语义；取消 token 能力 |
| **TASK-C.10c** | 界面暗号/命名清扫（白话标签 + 图谱单入口） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `6811f44`；合后四件套 1267 passed / 6 skipped） | P4 抛光 | • 白话：项目审阅 / 合同操作台 / 验证输出；ActivityBar 去英文暗号<br>• 左栏图谱→合同操作台内视口（收双入口）<br>• 欢迎次要 CTA 降噪；页脚白话<br>• **不含**改鉴权 / 指挥纪律 / D.1e |
| **TASK-C.10d** | 左栏老板主路径（换项目主视线 / 文件与资产进折叠） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `51ae8ae`；合后四件套 1273 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.10c` COMPLETED<br>• 默认主视线：打开/切换项目 + 空闲「跟右侧说话」；规范与资产、文件树默认收进「项目文件」<br>• **不取消**能力；不改鉴权；不抢 D.1e；不拆多路由<br>• `left-panel-boss` + UI 回归 |
| **TASK-C.10e** | Cursor 式欢迎页承载打开/切换项目 | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `592f825`；合后四件套 1274 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.10d` COMPLETED<br>• 开项目迁出 IDE 左栏；欢迎页：最近一键重开 + 粘贴路径（保留 C.8c）<br>• 顶栏「切换项目」回欢迎页；**不抢** D.1e；不改鉴权 |
| **TASK-C.10f** | 资源管理器纯文件树 + 规范与资产进项目审阅 | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `592f825`；合后四件套 1274 passed / 6 skipped） | P4 体验打磨 | • 与 C.10e 同 tip 合入<br>• 左栏只留纯文件树；`FileTreeSpecsSection` 挂「项目审阅」<br>• **不取消**能力；不改鉴权；不拆多路由 |
| **TASK-C.10g** | 文件树展开/折叠（默认只展开第一层） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `a3fa7c7`；合后四件套 1281 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.10f` COMPLETED<br>• 点文件夹展开/折叠；默认根下第一层展开；更深默认收起<br>• 点文件仍打开；不改鉴权；不抢 D.1e<br>• `file-tree-expand` + UI 回归 |
| **TASK-C.10h** | 文件树右键删除（确认 / P.1 / 尽量废纸篓） | 工作台 UX | **[COMPLETED]**（2026-10-24 合入 main，tip `008fd3a`；热修 `be4968b` 确认框可点；合后四件套 1292 passed / 6 skipped） | P4 体验打磨 | • 前置 `C.10g` COMPLETED<br>• 右键菜单 + 确认；`POST /api/repo/delete` 鉴权；保护清单拦则白话<br>• macOS 尽量废纸篓，否则普通文件永久删除并诚实说明；删成功刷新树<br>• 热修：ContextMenu 关闭后延后打开确认框（避免 pointer-events 锁）<br>• **不改**鉴权；不抢 D.1e |
| **TASK-C.10i** | 文件树第一批（折叠整树 / 新建 / Finder·复制·重命名·删除） | 工作台 UX | **[COMPLETED]**（tip `5388f9c`；**1305 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10h` COMPLETED<br>• 点顶栏路径折叠整树；新建文件/文件夹；右键 Finder/复制路径/重命名/删除<br>• 写操作经鉴权 API + P.1；**不改**鉴权；不抢 D.1e<br>• Cursor 其余右键 → v0.2+ RFC 锚定（不实施） |
| **TASK-C.10j** | 中栏 Markdown 预览阅读（默认预览 / 可切源码） | 工作台 UX | **[COMPLETED]**（tip `836ad6e`；**1311 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10i` COMPLETED<br>• `.md` 默认好看预览（标题/引用/GFM/代码高亮）；「预览|源码」切换<br>• 源码仍 Monaco + 既有保存门禁；非 md 无切换<br>• **不含**分栏预览/完整面包屑/完整 VS Code；不改鉴权；不抢 D.1e |
| **TASK-C.10k** | 右栏只留双方对话（去工程师噪声；Cursor 右栏进 v0.2） | 工作台 UX | **[COMPLETED]**（tip `0da870c`；**1313 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10j` COMPLETED<br>• 去掉适配器/历史/元信息/说明书条/工具 JSON<br>• 保留对话+旅程卡+门禁提示；自动开会话<br>• Cursor 右栏对齐 → v0.2 附录 B（不实施）<br>• **不含**整页复刻 Cursor；不改鉴权；不抢 D.1e |
| **TASK-C.10l** | 设置「高级」可选会话/适配器（不回潮右栏） | 工作台 UX | **[COMPLETED]**（tip `d407b5c`；**1316 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10k` COMPLETED<br>• 高级内：助手下拉 / 新会话 / 历史会话；与右栏共享会话实例<br>• 右栏保持 C.10k 只留对话；元信息/工具 JSON 仍不展示<br>• **不含**改鉴权；不抢 D.1e；不整页复刻 Cursor |
| **TASK-C.10m** | 质疑自查裁决按钮接线（缺陷修复 / 新需求演进） | 工作台 UX | **[COMPLETED]**（tip `0d65890`；**1319 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10l` COMPLETED；工作区恢复干净 tip<br>• 两按钮 → `user_choice` → Daemon 强制分类<br>• 需求演进切合同视口；缺陷修复留质疑<br>• **不含**改鉴权；不抢 D.1e；不整页复刻 Cursor |
| **TASK-C.10n** | 任务图谱空态可感知（禁用无效切换 / 刷新反馈 / 建图 CTA） | 工作台 UX | **[COMPLETED]**（tip `bcad27f`；热修 `3e9bb22`；**1323 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10m` COMPLETED<br>• 无图：禁用视图切换；刷新 loading；白话空态 + 确认原型建图 CTA<br>• 有图：只读提示；选中节点高亮并滚到详情<br>• 热修：建图 CTA 错误回显图谱顶栏<br>• **不含** start/verify；不改鉴权；不抢 D.1e |
| **TASK-C.10p** | 图谱开工/核销自动确保任务 Worktree | 工作台 UX / 执行内核 | **[COMPLETED]**（tip `35b56c9`；**1335 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10o` / `A.1` COMPLETED<br>• start/verify 前 `ensureTaskWorktree`；基线回退；主区脏不阻断<br>• **不含**假绿/改鉴权；不抢 D.1e |
| **TASK-C.10q** | Studio 全景/施工双视角壳 + 改名消歧义 | 工作台 UX | **[COMPLETED]**（tip `4280de6`；**1342 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10p` COMPLETED<br>• `StudioLensShell` / `PanoramaPane`；无图全景、有图施工；「本轮施工·功能汇总」改名<br>• 三张真全景图 → v0.2 RFC 附录 C（本卡不实现）<br>• **不含**假绿/改 illumination/start/verify；不抢 D.1e |
| **TASK-C.11a** | 右栏白话推荐选择题（≤2 轮收敛） | Supervisor 体感 | **[COMPLETED]** | P4 Supervisor 链 | • 前置 `C.10q`+`C.10k` COMPLETED<br>• 右栏渲染带「推荐」徽标选择题；主动澄清 ≤2 轮；未决写入合同默认项<br>• Top7#4；不含开放式技术填空；不改鉴权 |
| **TASK-C.11b** | 隔离 Demo 预览挂载与感官确认 | Supervisor 体感 | **[COMPLETED]** | P4 Supervisor 链 | • 前置 `C.11a`<br>• Demo 落 `.stagent/prototypes/<id>/` + gitignore；独立预览；感官确认按钮<br>• Top7#1；未确认禁写真码；不进主干 |
| **TASK-C.11c** | 白话合同卡片与签署拦截 | Supervisor 体感 | **[COMPLETED]** | P4 Supervisor 链 | • 前置 `C.11b`<br>• 合同卡 intent/Scope/验收；签署前主干零写入；签署后短命护照<br>• 拒约默认留 Demo；草案版本递增；对齐核心资产治理 |
| **TASK-C.11d** | 施工图 Evidence 点亮 + 越界挂起 | Supervisor 体感 | **[COMPLETED]** | P4 Supervisor 链 | • 前置 `C.11c`+`C.10o/p/q`<br>• 节点点亮绑真实 Evidence；`E_OUT_OF_SCOPE`→拦当次+PAUSED+扩权/回滚弹窗<br>• Top7#3；禁静默放行/默认杀进程；不假绿 |
| **TASK-C.11e** | 真机对照验收与质疑自查回灰 | Supervisor 体感 | **[COMPLETED]** | P4 Supervisor 链 | • 前置 `C.11d`+`C.10m`+`S.6b`<br>• 真页对照 Demo；质疑→S.5 红队自查；失败回灰重做<br>• 对齐 Supervisor 定稿；不改 D.1 鉴权 |
| **TASK-C.12a** | 双层执行令牌（exec/resume+jti） | 契约/安全 Delta | **[COMPLETED]**（tip `12b14b1`） | P4 Spec Freeze→施工 | • 前置 `C.11c`+`C.11e` COMPLETED<br>• 外部 session 保留；内部 `exec_token` 绑 contract_id+worktree；PAUSED 硬吊销；恢复一次性 `resume_token`+`jti`<br>• Top5#1 / EO-07；不推翻 session；不改 D.1 通道 |
| **TASK-C.12b** | 状态广播 epoch/seq + DeliveryState | 契约/状态机 Delta | **[COMPLETED]**（tip `12b14b1`） | P4 Spec Freeze→施工 | • 前置 `C.12a`<br>• `session_epoch`+`state_seq`；STATE 映射 EO-01；含 `CONTRACT_SIGNING` 瞬态；客户端按 seq 去重防倒流<br>• Top5#2 / EO-01 |
| **TASK-C.12c** | 越界原子拦截（软停→杀→吊销→清锁） | 契约/安全 Delta | **[COMPLETED]**（tip `12b14b1`） | P4 Spec Freeze→施工 | • 前置 `C.12a`+`C.11d`<br>• SIGINT 软停 3s→超时 SIGKILL→吊销 exec_token→清 `.git/index.lock`→PAUSED 问人<br>• Top5#3 / EO-02·07；禁静默放行；不默认立刻 kill -9 |
| **TASK-C.12d** | Demo 三态门禁 + can_sign + records 拷贝 | Supervisor/门禁 Delta | **[COMPLETED]**（tip `12b14b1`） | P4 Spec Freeze→施工 | • 前置 `C.11b`+`C.11c`+`C.12b`<br>• `demo_mode` 三态；`can_sign` 硬谓词；合入后轻量拷贝 `.stagent/records/`<br>• Top5#4 / EO-05·06；不推翻 prototypes |
| **TASK-C.12e** | 无 Git 审计侧车 audit-manifest | 审计/交付 Delta | **[COMPLETED]**（tip `12b14b1`） | P4 Spec Freeze→施工 | • 前置 `C.12d`<br>• `.stagent/records/{contract_id}/audit-manifest.json`；脱敏后哈希；不依赖 Git Trailer<br>• Top5#5 / EO-03·04·05；本地 only（云同步 v0.2+） |
| **TASK-C.14a** | 只读沙盒静态扫描器（基线 P0） | 已有项目/基线档案 | **[COMPLETED]**（tip `0417203`） | P4 基线档案 | • 前置 `C.12e`+`C.10q` COMPLETED<br>• 逻辑级只读+断网意图+约 3s 熔断；禁动态执行；P0 骨架秒级<br>• 打开即扫已落地；已知缝：非 OS 只读挂载 |
| **TASK-C.14b** | 渐进扫 + baseline 落盘 + 全景视口 | 已有项目/基线档案 | **[COMPLETED]**（tips `0417203`/`dd14fa0`） | P4 基线档案 | • 前置 `C.14a`<br>• 两段式渐进；`.stagent/records/baseline/`；确认≠授权；「认可此基线作为后续参考」<br>• 全景可见基线卡；观察≠质量结论 |
| **TASK-C.14c** | Dirty Check + 图谱白话 + 防抢跑 | 已有项目/基线档案 | **[COMPLETED]**（tips `0417203`/`e01188f`） | P4 基线档案 | • 前置 `C.14b`<br>• 脏区黄标管家话术；首张微合同默认排除未跟踪/未提交<br>• 图谱两行白话；P0 解锁后 Supervisor 防抢跑降级 |
| **TASK-C.14d** | 脏区→Scope 真链路硬门禁 | 已有项目/基线档案 | **[COMPLETED]** | P4 基线安全闭环 | • 前置 `C.14c`+`C.12c` COMPLETED<br>• `dirty_exclusions`→`scope.forbidden_paths`+白话列出<br>• touch 脏区→`E_OUT_OF_SCOPE_UNTRACKED`+软停3s→SIGKILL<br>• E2E：`.env.local`/未跟踪脚本永不被改 |
| **TASK-C.14e** | 扫描器 OS 级只读与断网沙盒证明 | 已有项目/基线档案 | **[COMPLETED]** | P4 基线安全闭环 | • 前置 `C.14a` COMPLETED<br>• RO bind mount / sandbox RO；network namespace 禁出站<br>• 反向证伪：write→EROFS；outbound fetch/socket 失败 |
| **TASK-C.14f** | 基线深度进度真 WS/流式 | 已有项目/基线档案 | **[COMPLETED]** | P4 基线体验 | • 前置 `C.14b` COMPLETED<br>• Daemon 推 `BASELINE_PROGRESS`；前端停 2s 轮询；P0 秒级解锁保留<br>• 讨论稿 §5/§7 流式协议 |
| **TASK-C.15a** | EO-01 DeliveryState 完备 | 右栏 EO 余面 | **[COMPLETED]** | P4 EO Delta | • 前置 `C.12b` COMPLETED<br>• 补齐枚举/转移；不重复 Top5 epoch/seq<br>• §14.11 EO-01 |
| **TASK-C.15b** | EO-08 断言身份与返工计数 | 右栏 EO 余面 | **[COMPLETED]** | P4 EO Delta | • 前置 `C.15a`<br>• UUIDv5 `assertion_id`；Daemon 计数；超限 ESCALATED；返工期禁追加<br>• §14.11 EO-08 |
| **TASK-C.15c** | EO-05 两阶段归档/GC 细项 | 右栏 EO 余面 | **[COMPLETED]** | P4 EO Delta | • 前置 `C.12d`+`C.12e`+`C.15a`<br>• 签署白名单 GC；MERGED→DELIVERED 事务；失败停 MERGED<br>• §14.11 EO-05 / DEC-01 |
| **TASK-C.15d** | P0 AC-ISOL + EO-09 seal | 右栏 EO 余面 | **[COMPLETED]** | P4 EO Delta | • 前置 `C.15c`<br>• `.stagent/` gitignore + drafts 路由；worktree seal manifest<br>• §13 P0 / EO-09；P1–P3 仍 backlog |
| **TASK-C.16** | ActivityBar 单门：列表+操作台 | 工作台 UX | **[COMPLETED]**（2026-10-26 Tina t892u 点头；本提交合入） | P4 体验打磨 | • 前置 `C.10f`/`C.10c` COMPLETED<br>• 收日常双 ActivityBar 门；单门进列表+五视口<br>• 规范与资产在操作台左侧栏；文件树纯源码<br>• 项目全景为次入口；不改鉴权；不抢 D.1e；不扩 Spec Freeze |
| **TASK-C.17** | P0 调试日志（JSONL + 旅程 + Worker + UI trace） | 可观测性 | **[COMPLETED]**（2026-10-26 Tina t894u「按这四项开干」；本提交合入） | P4 体验定位 | • 前置 `C.16`/`H.8` COMPLETED<br>• `.stagent/logs/daemon.jsonl` + 轮转<br>• `journey-<cid>.jsonl` 刷新还原<br>• `worker-<cid>.jsonl` 与 WS 并行<br>• `POST /api/client-events` CTA/viewport/disabled<br>• LLM duration_ms/model/token；禁密钥；不扩 v0.2 |
| **TASK-C.18** | 方案工作台单页：自由对话 + 方案审阅 | 工作台 UX | **[COMPLETED]**（2026-10-26 Tina t905u「改代码…只需要一个页面」；本提交合入） | P4 体验打磨 | • 前置 `C.17`/`C.16` COMPLETED<br>• 去掉五视口 Tab；中间仅方案审阅<br>• 右栏自由聊，取消 2 轮选择题门控<br>• 方案启发式更新；Demo 按钮按完整度；确认方案=冻结+授权+Worker<br>• 不扩 Spec Freeze；不抢 D.1e；不扩 v0.2 |
| **TASK-C.19** | Supervisor SSOT 合流（DOC-SSOT-Supervisor） | 文档治理 | **[COMPLETED]**（2026-10-26 Tina t906u；本提交合入） | P4 规范合流 | • 前置 `C.18` COMPLETED<br>• 新建 `docs/specs/supervisor.md` 五大章<br>• 旧右栏/工作流/澄清/接口/运转机制加 SSOT 指针<br>• 不改产品代码；不抢 D.1e；不扩 v0.2 |
| **TASK-C.20** | Supervisor 合流前碎片归档（DOC-ARCHIVE-Supervisor-pre-SSOT） | 文档治理 | **[COMPLETED]**（2026-10-26 Tina t908u「归档」；本提交合入） | P4 规范归档 | • 前置 `C.19` COMPLETED<br>• 见 Git 历史（原 `docs/archive/supervisor-pre-ssot/`） + 5 份 git mv<br>• reports 留 stub；Freeze 总册保留并强化指针<br>• 不改产品代码；不抢 D.1e；不扩 v0.2 |
| **TASK-C.21** | Supervisor SSOT 审查补丁（DOC-SSOT-Supervisor-Patch） | 文档治理 | **[COMPLETED]**（2026-10-26 Tina t910u「补丁」；本提交合入） | P4 规范补丁 | • 前置 `C.20` COMPLETED<br>• SSOT v2.0.1：Demo 门禁 / 通配分级 / 确认原子时序 / pin / 降级 / demoReady<br>• 不改产品代码；不抢 D.1e；不扩 v0.2 |
| **TASK-J.1** | 右栏 AI 搭档只读工具集 | 安全 / 工作台 | **[COMPLETED]**（tip `4144a20` / merge [#29](https://github.com/he18718143986-design/IDE/pull/29)；partner 只读；相关测本机 51 passed） | **P0** 闭环 v2.1 第一批 | • SSOT §13.2 / P-01 / L-02<br>• Claude Code 右栏改 `role: partner`：仅 Read/Glob/Grep，禁写与 Bash，不用 acceptEdits<br>• 右栏拒选 read_write 适配器 |
| **TASK-J.2** | `ScopePlan` 纯函数与范围预检构建器 | 门禁 / 范围 | **[COMPLETED]**（tip `e6e1730` / merge [#4](https://github.com/he18718143986-design/IDE/pull/4)） | P1 闭环 v2.1 第一批 | • SSOT §15.3 / S2-02 / S2-04 / L-03<br>• 单一来源 + 稳定 digest；确定性收敛，不编造路径<br>• 无验证脚本 → manual_only |
| **TASK-J.3** | 唯一确认谓词纳入 `ScopePlan` | 门禁 | **[COMPLETED]**（tip `f4656a9` / merge [#5](https://github.com/he18718143986-design/IDE/pull/5)） | P1 闭环 v2.1 第一批 | • 前置 `J.2`<br>• 新增 `E_SCOPE_NOT_READY` / `E_SCOPE_POLICY` / `E_SCOPE_APPROVAL_REQUIRED`<br>• 与 J.5 同 PR 或开关保护 |
| **TASK-J.4** | Daemon 范围预检接口与快照绑定 | 门禁 / 控制面 | **[COMPLETED]**（tip `4832506` / merge [#6](https://github.com/he18718143986-design/IDE/pull/6)） | P1 闭环 v2.1 第一批 | • 前置 `J.2`<br>• `POST /api/supervisor/scope/preflight`；快照 1.1 含 `scope_plan`<br>• `E_SCOPE_PLAN_DRIFT` / `E_SCHEME_SNAPSHOT_MISMATCH`；签署链不得 403 |
| **TASK-J.5** | 「确认方案」接线改造 | 工作台 / 门禁 | **[COMPLETED]**（tip `c877d1c` / merge [#7](https://github.com/he18718143986-design/IDE/pull/7)） | P1 闭环 v2.1 第一批 | • 前置 `J.3`、`J.4`<br>• 防抖预检；删除事务前意图推断；按快照建合同<br>• drift 解锁并刷新范围 |
| **TASK-J.6** | 中栏《改动范围与验收方式》区块 | 工作台 UX | **[COMPLETED]**（tip `a9d7cb2` / merge [#11](https://github.com/he18718143986-design/IDE/pull/11)） | P1 闭环 v2.1 第一批 | • 前置 `J.5`<br>• 五块白话呈现；排除区域 / 敏感项表态触发预检<br>• 无技术单位、无手写 glob |
| **TASK-J.7** | 交接三步进度与右栏解锁 | 工作台 UX | **[COMPLETED]**（tip `67d7605` / merge [#13](https://github.com/he18718143986-design/IDE/pull/13)） | P1 闭环 v2.1 第一批 | • 前置 `J.1`（硬）、`J.5`<br>• COMMIT 后解锁；冻结后消息只作只读问答<br>• 仅补偿失败保持锁定 |
| **TASK-J.8** | `JourneyStage` 投影与广播 | 状态权威 | **[COMPLETED]**（tip `b90241e` / merge [#10](https://github.com/he18718143986-design/IDE/pull/10)） | P1 闭环 v2.1 第一批 | • SSOT §16.2 / J-01 / L-10<br>• Daemon 投影随 `STATE_CHANGED` 下发；表外组合告警<br>• `DELIVERED` 呈现为已合入（不删枚举） |
| **TASK-J.9** | SchemePatch 零模型确定性合并引擎 | 意图编译器 / 证据台账 | **[COMPLETED]**（tip `1ad6eab` / merge [#12](https://github.com/he18718143986-design/IDE/pull/12)） | P1 闭环 v2.1 第二批 | • SSOT §14.2 / §14.3 / §14.11；V-01～V-04、V-10～V-13<br>• 实施口径 [`scheme-patch-engine.md`](./scheme-patch-engine.md)<br>• 纯函数零模型；可用桩编译器 |
| **TASK-J.10** | 意图编译器生成端与 Daemon 编译循环 | 意图编译器 | **[COMPLETED]**（tip `97bb0db` / merge [#17](https://github.com/he18718143986-design/IDE/pull/17)） | P1 闭环 v2.1 第二批 | • 前置 `J.9`；合并后触发预检依赖 `J.2`<br>• 实施口径 [`intent-compiler-prompt.md`](./intent-compiler-prompt.md)<br>• V-05、V-06、V-09；GAP-1/GAP-2 已关闭，见 `supervisor.md` §14.11 K-10/K-11 |
| **TASK-J.18** | Worker 派工墓地门禁（母卡 · 已拆） | 门禁 / 证据台账 | **[SPLIT]** → `J.18a`～`J.18d` | P1 闭环 v2.1 第二批 / M3 | • 原估算 L，R-11 禁开工<br>• 实施口径仍 [`worker-graveyard-gate.md`](./worker-graveyard-gate.md)<br>• **禁止**直接派工本母卡 |
| **TASK-J.18a** | G-MATCH 纯函数与产出物投影 | 门禁 / 纯函数 | **[COMPLETED]**（tip `20c2d46` / merge [#24](https://github.com/he18718143986-design/IDE/pull/24)） | P1 / M3 墓地 | • 前置 `J.9`<br>• `graveyard-match` / `artifact-projection` / `alias-lexicon`；TM-GM、TM-GU<br>• 估算 M |
| **TASK-J.18b** | 合同 `scheme_binding` 与快照墓地权威源 | 门禁 / Schema | **[COMPLETED]**（tip `ca9ed8f` / merge [#22](https://github.com/he18718143986-design/IDE/pull/22)） | P1 / M3 墓地 | • 前置 `J.4`（硬）、`J.9`<br>• GAP-W1 / GAP-W2；快照 1.2 含 `graveyard`<br>• 估算 M；可与 `J.18a` 并行 |
| **TASK-J.18c** | 墓地门禁裁决、优先级格与派工绑定 | 门禁 / Daemon | **[COMPLETED]**（tip `b6922ac` / merge [#26](https://github.com/he18718143986-design/IDE/pull/26)） | P1 / M3 墓地 | • 前置 `J.18a`、`J.18b`<br>• `evaluateGraveyardGate` / `pickPrimaryVerdict` / `verifyDispatchBinding` / 码表<br>• TM-GS、TM-GA、TM-GP、TM-GB、TM-GE；估算 M |
| **TASK-J.18d** | 写路径接线、CLI pack、全量扫描与集成 | 门禁 / 接线 | **[COMPLETED]**（tip `a2fa7df` / merge [#27](https://github.com/he18718143986-design/IDE/pull/27)） | P1 / M3 墓地 | • 前置 `J.18c`<br>• Worker/Gateway/编排/合并/hook；GAP-W3/W4/W6；TM-GH、TM-GI（3950–3959）<br>• 估算 M |
| **TASK-J.19** | DN-2「可以」HTTP/画布入口（DLV-6） | 画布 / API | **[COMPLETED]**（[#55](https://github.com/he18718143986-design/IDE/pull/55)/`4bae423`） | 台账债 DLV-6 | • 前置 `L.11`/`J.7` COMPLETED<br>• `/api/design/*` + 画布卡<br>• 见 completed |
| **TASK-J.20** | OP-1 授权清单落地（dec-10 实施） | 确认 / 授权 | **[COMPLETED]**（[#57](https://github.com/he18718143986-design/IDE/pull/57)/`4d2f8e1`） | OP-1 实施（裁决已销） | • records 侧车；路径集粒度 / TTL≤90d / 指纹失效<br>• 复活路径仍忽略 occurrence<br>• 见 completed |
| **TASK-L.1** | 右栏纯净化（DEC-004） | 右栏 / Agent | **[COMPLETED]**（tip `8eb6896` / merge [#9](https://github.com/he18718143986-design/IDE/pull/9)） | 交付全链路 M2 | • 前置 无<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.2** | Worker 指令补全「你会被这样检查」 | Worker | **[COMPLETED]**（tip `16c5176` / merge [#8](https://github.com/he18718143986-design/IDE/pull/8)） | 交付全链路 M2 | • 前置 无<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.3** | 测试义务：合同元数据、`ScopePlan` 系统范围、`stagent check` | 验证 | **[COMPLETED]**（tip `b4e0091` / merge [#15](https://github.com/he18718143986-design/IDE/pull/15)） | 交付全链路 M2 | • 前置 `J.2`、`J.4`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.4** | 两段式施工编排：先红后绿 | 验证 / 编排 | **[COMPLETED]**（tip `9263504` / merge [#18](https://github.com/he18718143986-design/IDE/pull/18)） | 交付全链路 M2 | • 前置 `L.3`、`L.2`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.5** | 真实预览：Worktree 启动用户应用 | 试玩 | **[COMPLETED]**（tip `0b6bc7f` / merge [#14](https://github.com/he18718143986-design/IDE/pull/14)） | 交付全链路 M2 | • 前置 无<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.6** | 黄金切片端到端测试（M2 退出） | E2E | **[COMPLETED]**（tip `93589bf` / merge [#21](https://github.com/he18718143986-design/IDE/pull/21)） | 交付全链路 M2 | • 前置 `L.1`～`L.5`、`J.2`～`J.10`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.7** | `ProjectPlan` 类型、校验与存储 | 项目分解 | **[COMPLETED]**（tip `607d742` / merge [#23](https://github.com/he18718143986-design/IDE/pull/23)） | 交付全链路 M3 | • 前置 `L.6`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.8** | 计划补丁合并与分解器 | 项目分解 | **[COMPLETED]**（tip `fb27504` / merge [#33](https://github.com/he18718143986-design/IDE/pull/33)） | 交付全链路 M3 | • 前置 `L.7`、`J.9`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.9** | 合同序列与「下一份」交接 | 项目分解 | **[COMPLETED]**（tip `e1cf1bb` / merge [#35](https://github.com/he18718143986-design/IDE/pull/35)） | 交付全链路 M3 | • 前置 `L.8`、`J.4`、`J.5`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.10** | 画布「项目地图」 | 工作台 UX | **[COMPLETED]**（tip `e4351b0` / merge [#38](https://github.com/he18718143986-design/IDE/pull/38)） | 交付全链路 M3 | • 前置 `L.9`、`L.8`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.11** | DesignNote 生成、校验与注入 | 技术方案 | **[COMPLETED]**（tip `78ec236` / merge [#43](https://github.com/he18718143986-design/IDE/pull/43)） | 交付全链路 M3 | • 前置 `L.4`、`L.9`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.12** | 系统知识库与漂移门禁 | 知识库 | **[COMPLETED]**（tip `39f426a` / merge [#47](https://github.com/he18718143986-design/IDE/pull/47)） | 交付全链路 M3 | • 前置 `L.11`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.13** | 追踪链与「这段为什么存在」 | 追踪 | **[COMPLETED]**（tip `51ea872` / merge [#51](https://github.com/he18718143986-design/IDE/pull/51)） | 交付全链路 M3 | • 前置 `L.9`、`L.12`<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.14** | 凭据保险库 | 安全 | **[COMPLETED]**（tip `ae57543` / merge [#31](https://github.com/he18718143986-design/IDE/pull/31)） | 交付全链路 M4 | • 前置 `L.6`；OQ-REL-1<br>• 详见 §3.4d；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.15** | 发布生命周期与两类目标 | 发布 | **[COMPLETED]**（tip `9829385` / merge [#52](https://github.com/he18718143986-design/IDE/pull/52)） | 交付全链路 M4 | • 前置 `L.14`<br>• ReleaseRecord / local_process+user_command / 失败回滚<br>• 详见 §3.4d → completed；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.16** | 线上问题回流 | 运维 | **[COMPLETED]**（tip `e4dfe1c` / merge [#62](https://github.com/he18718143986-design/IDE/pull/62)） | 交付全链路 M4 | • 前置 `L.15`、`L.9`<br>• LiveIncident / E 类分流 / ask-ai 插桩<br>• 详见 §3.4d → completed；总装图 [`delivery-lifecycle.md`](./delivery-lifecycle.md) |
| **TASK-L.17** | 受控只读外网摄取 | 北极星 | **[SPLIT]** | 交付全链路 M5 | • **已拆分为 L.17a + L.17b，保留追溯**<br>• 前置 `L.14`（COMPLETED）；oq-2（dec-12）、oq-3（dec-13）均已裁决<br>• 详见 active §3.4d |
| **TASK-L.17a** | 受控摄取与代登代理 | 北极星 | **[READY]** | 交付全链路 M5 | • 前置 `L.14`（COMPLETED）；oq-3 裁决（**dec-13**）<br>• daemon 只读 GET 代理 + 白名单 + Vault 代登 + 静默重登（Worker 无感）<br>• 估算 M；详见 active §3.4d |
| **TASK-L.17b** | 对比视图与试玩证据桩 | 北极星 | **[READY（待 L.17a）]** | 交付全链路 M5 | • 前置 `L.17a` + `L.16`（COMPLETED，复用「让 AI 看看」通道）<br>• 对比视图 + 右栏试玩引导 + dec-12 证据桩 + 跨版本重置<br>• 估算 M；详见 active §3.4d |
| **TASK-L.18** | 系统地图 UI +「改这里会影响什么」（DLV-5） | 知识库 / 中栏 | **[COMPLETED]**（[#54](https://github.com/he18718143986-design/IDE/pull/54)/`c8e6a81`） | 台账债 DLV-5 | • 前置 `L.10`/`L.12` COMPLETED<br>• `/api/knowledge/*` + impactClosure<br>• 见 completed |
| **TASK-H.1** | Worker JSON/Patch 解析校验与轻量重试 | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `W.5a` COMPLETED<br>• 格式校验拦截 + ≤1 次本地重试；异常平稳退回非挂起<br>• 纪要 §4#2；禁扩容器/W.5b/c |
| **TASK-H.2** | MERGED/DELIVERED 终态收口消歧 | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `C.15a`+`C.15c` COMPLETED<br>• 统一枚举或正式注记 MERGED=终态；消除规范/代码两层皮<br>• 纪要 §4#1；禁云归档 |
| **TASK-H.3** | 基线扫描硬上限与超时熔断 | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `C.14a` COMPLETED<br>• 文件数/深度硬上限 + 超时中断；防 Daemon 假死<br>• 沿用 OS 只读证明；禁 AST/Impact |
| **TASK-H.4** | 空目录友好 git init 引导 | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `D.1b`/`D.1d` COMPLETED<br>• 空仓自动或单键 `git init`；白话引导<br>• 纪要空目录缝；不抢 D.1e |
| **TASK-H.5** | 旅程草案 `contract_id` 不丢 | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `S.6`/`C.11a` COMPLETED<br>• 草案创建/回传必带可解析 `contract_id`；丢失显式报错非静默<br>• 纪要 §4#3；禁扩新旅程引擎 |
| **TASK-H.6** | 脏区引导精修（acknowledge_dirty） | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `C.14c`/`C.14d` COMPLETED<br>• 409 白话低恐慌排除建议；确认后脏路径进 Scope 排除<br>• 目标 2；不改鉴权 |
| **TASK-H.7** | 主链路回归套件锁死 | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `H.1`–`H.4`+`E.1` COMPLETED<br>• 打开→…→MERGED + 优先补测沉淀为可重复脚本/CI 断言<br>• 目标 3；禁借机新功能 |
| **TASK-H.8** | records 脱敏导出与单项目清理 | v0.1 硬化 | **[COMPLETED]** | Hardening | • 前置 `C.12e`/`C.15c` COMPLETED<br>• 一键 zip 脱敏打包 + 单项目彻底清理（EO-03/EO-05）<br>• 目标 3；禁云同步 |
| **TASK-H.9** | 废止 `.stagent/metadata/` 写入（DLV-4） | v0.1 硬化 / 路径 | **[COMPLETED]**（tip `34213c8` / merge [#50](https://github.com/he18718143986-design/IDE/pull/50)） | 台账债 DLV-4 | • 前置 `C.12e`/`C.15c`<br>• 对齐 ADR-0011；迁 records；legacy 只读<br>• 详见 §3.4e → completed |
| **TASK-C.10o** | 任务图谱开工/核销入口（start/verify UI） | 工作台 UX | **[COMPLETED]**（tip `830fca1`；**1331 passed / 6 skipped**） | P4 体验打磨 | • 前置 `C.10n` / `C.7` COMPLETED<br>• 有图：「开工下一节点」「核销点亮」接 Daemon start/verify<br>• PENDING→RUNNING→点亮；失败黄条；点亮只认物理证据<br>• **不含**假绿/改鉴权；不抢 D.1e |
| **TASK-P.1** | 全局保护清单与 Vibe 模式安全网 | 安全与体验 | **[COMPLETED]**（提交 08e95da 已合入 main；17 用例绿） | P3.5 保护清单 | `.stagent/protection.json`、首导入推荐卡片、Auto-Checkpoint、【撤销本轮改动】、静默合同、User-First Discard 冲突仲裁。 |
| **TASK-D.2** | 控制面 API 补齐、六大合并门禁与 Git Trailer 审计 | 通信核销 | **[COMPLETED]**（2026-10-21 步骤 D 收口；仅含当时交付范围） | P5 核销合并 | • 控制面 approve/execute/resume/abort/merge 与既有 Gate 0–4 已落地<br>• 4 条标准 Git Trailer 与 User-First Discard 已交付；增量范围由 D.2b 承接 |
| **TASK-D.2b** | 未跟踪文件合并门禁与 Contract v1.3 零静默迁移接入 | 通信核销 | **[COMPLETED]**（提交 `150dc47` 锁定；合并前未跟踪门禁、零静默迁移接入、Trailer 尺寸守护均已落地） | P5 增量门禁 | • 在已跟踪/未跟踪文件上执行合同 Scope 联合检查<br>• 接入 `migrateContractToV13`，防止历史合同静默获批<br>• 前置：TASK-0.2c、TASK-D.2、TASK-W.2b |
| **TASK-E.1** | 双 Agent 协同与全流程 E2E 自动化测试 | 集成测试 | **[COMPLETED]**（`c82a7bb`；交付测试在位） | P6 集成自举 | 覆盖 Happy Path 全生命周期无人值守自动化回归；覆盖 8 类故障分支（含 4 类授权不变式与非受控隔离）。 |
| **TASK-E.2** | Stagent 仓库自举 (Dogfooding) 与发版交付 | 交付发版 | **[COMPLETED]**（`9b15c20`、`178a8a6`；报告与发版记录在位） | P6 真实验证 | 真实仓库自举演练、用量与已知限制客观报告、生产打包构建。 |

---
## 2. 关键路径与 DAG 拓扑依赖 (Critical Path DAG，v1.6.2 对齐版)

> **v1.6.2 对齐说明**：纳入架构规范 v1.6.1 核心底座演进任务 `TASK-0.2c`（Schema v1.3.0 与自愈迁移边）与通信/防死锁引擎 `TASK-D.3`（15 状态投影持久化与死锁自愈）。将非技术用户八步闭环（澄清 -> Demo -> Graph -> 点亮 -> 真机 -> 质疑自查 -> 增量演进）牢牢构筑在强类型数据模型与防死锁底座之上。

### 2.1 依赖关系与机器可读边清单 (Machine-Readable Edges)

> **依赖源优先级**：任务卡「前置依赖」与下方 JSON 边清单必须一致；下方 ASCII 图仅表示关键路径示意，不穷举全部边。出现不一致时以任务卡与 JSON 的逐边校验为阻断条件，必须先修正文档再开工。

```
TASK-0.1 ──► TASK-0.2b ──► TASK-0.2c (Schema v1.3.0 & 自愈边) ──► TASK-D.1 ──► TASK-D.3 (15状态投影 & 防死锁)
                                                                    │              │
                                                                    │              ├──► TASK-D.1b (一键打开项目) [COMPLETED]
                                                                    │              │      └──► TASK-D.1c (最近项目一键重开) [COMPLETED]
                                                                    │              │             └──► TASK-D.1d (修复同源空白) [COMPLETED]
                                                                    │              │                    ├──► TASK-D.1e (真·选文件夹/桌面壳) [DEFERRED → v0.2+ / P5.8]
                                                                    │              │                    └──► TASK-C.8a / C.8b / C.8c [COMPLETED] ──► TASK-C.9a–C.9d [COMPLETED] ──► TASK-C.10a/b/c/d [COMPLETED]
                                                                    │              │
                                                                    │              ├──► TASK-C.1 (三栏骨架)
                                                                    │              │      ├──► TASK-C.3 (Monaco 读写)
                                                                    │              │      ├──► TASK-C.6 (右栏流式会话)
                                                                    │              │      └──► TASK-C.5 (Diff 与终端)
                                                                    │              │
                                                                    ├──► TASK-W.1 ─┴─► TASK-W.2 (Gateway) ──► TASK-W.3 ──► TASK-W.4
                                                                    │                                              │
                                                                    │                                              └──► TASK-W.5a
                                                                    │
                                                                    └──► TASK-P.1 (保护清单 + Vibe 安全网)

  TASK-C.5 + TASK-P.1 + TASK-W.4 ──► TASK-D.2 (合并门禁与审计核销)
                                            │
  TASK-S.1 ──► TASK-S.2 (草案生成) ─────────┼──────────────────────────────┐
                 │                          │                              │
                 ▼                          ▼                              ▼
            TASK-S.4 (Demo 原型)      TASK-C.7 (Task Graph 点亮)    TASK-S.5 (质疑自查)
                 │                          │                              │
                 └──────────────────┬───────┴──────────────────────────────┘
                                    ▼
                              TASK-C.2 (Studio 多维视口集成)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼                               ▼
              TASK-S.6 (非技术旅程串联)        TASK-E.1 ──► TASK-E.2
              （右侧分流 + 确认原型开工；       （v0.1 既有基线，已完成）
               前置 S.4/C.7/S.5/C.2/S.2/W.5a）
                                    │
                    ┌───────────────┼──────────────────────────────┐
                    ▼               ▼                              ▼
              TASK-C.8a        TASK-C.8c                      TASK-C.8b
              （老板文案/默认助手） （无钥匙一键重开+粘贴路径）   （Fast Path 老板三步台）
              前置 D.1d         前置 D.1b/D.1c/D.1d；不抢 D.1e   前置 D.1d + S.6
              [COMPLETED]       [COMPLETED]                       [COMPLETED]
              建议序：C.8a（已合）→ C.8c（已合）→ C.8b（已合）· Top3 收口
                                    │
                    ┌───────────────┼──────────────────────────────┐
                    ▼               ▼                              ▼
              TASK-C.9a ──► TASK-C.9b ──► TASK-C.9c ──► TASK-C.9d
              （首屏单一主路径） （助手模式互斥） （打开面板生命周期） （进行中中栏让路）
              前置 C.8a/b/c     前置 C.9a+C.8a   前置 C.9a+C.8c     前置 C.9a+C.9b+C.8b
              [COMPLETED]       [COMPLETED]      [COMPLETED]         [COMPLETED]
              建议序：C.9a→C.9b→C.9c→C.9d 均已合 · **第二轮指挥权收口**
                                    │
                    ┌───────────────┼──────────────────────────────┐
                    ▼               ▼                              ▼
              TASK-C.10a       TASK-C.10b                    TASK-C.10c ──► TASK-C.10d ──► TASK-C.10e ──► TASK-C.10f ──► TASK-C.10g ──► TASK-C.10h ──► TASK-C.10i ──► TASK-C.10j ──► TASK-C.10k ──► TASK-C.10l ──► TASK-C.10m ──► TASK-C.10n ──► TASK-C.10o ──► TASK-C.10p ──► TASK-C.10q ──► TASK-C.11a ──► TASK-C.11b ──► TASK-C.11c ──► TASK-C.11d ──► TASK-C.11e ──► TASK-C.12a ──► TASK-C.12b ──► TASK-C.12c ──► TASK-C.12d ──► TASK-C.12e ──► TASK-C.14a ──► TASK-C.14b ──► TASK-C.14c ──► TASK-C.14d   ；  TASK-C.14a ──► TASK-C.14e
              │                │                             │              │              │              │
              前置 C.9a+C.9d    前置 C.9d+C.8a              前置 C.10a+C.10b  前置 C.10c      前置 C.10d      前置 C.10e      前置 C.10f
              [COMPLETED]       [COMPLETED]                 [COMPLETED]     [COMPLETED]    [COMPLETED]    [COMPLETED]    [COMPLETED]
              建议序：C.10p 已合 · **图谱 Worktree 自愈收口**

  【v0.1 硬化旁支 · Hardening · 不碰 v0.2 封印】
  TASK-W.5a ──► TASK-H.1 (Worker JSON/Patch 解析重试) [COMPLETED]
  TASK-C.15a + TASK-C.15c ──► TASK-H.2 (MERGED/DELIVERED 终态收口) [COMPLETED]
  TASK-C.14a ──► TASK-H.3 (扫描硬上限/超时) [COMPLETED]
  TASK-D.1b/D.1d ──► TASK-H.4 (空目录 git init 引导) [COMPLETED]
  TASK-S.6 / TASK-C.11a ──► TASK-H.5 (草案 contract_id 不丢) [COMPLETED]
  TASK-C.14c + TASK-C.14d ──► TASK-H.6 (脏区引导精修) [COMPLETED]
  TASK-H.1–H.4 + TASK-E.1 ──► TASK-H.7 (主链路回归套件) [COMPLETED]
  TASK-C.12e + TASK-C.15c ──► TASK-H.8 (records 导出/清理) [COMPLETED]
  建议序：H.5 → H.6 → H.7 → H.8 · **H.5–H.8 已 COMPLETED**（Tina t881u 开工）

  【增量门禁旁支，不阻塞主链】TASK-0.2c + TASK-W.2 ──► TASK-W.2b (Scope 检测)
                                   └─ 与 TASK-D.2 汇合 ──► TASK-D.2b (合并门禁) ──► TASK-S.5
```

**机器可读拓扑边列表 (JSON Edges，v1.6.2)**：
```json
[
  { "from": "TASK-0.1", "to": "TASK-0.2b" },
  { "from": "TASK-0.2b", "to": "TASK-0.2c" },
  { "from": "TASK-0.2c", "to": "TASK-D.1" },
  { "from": "TASK-D.1", "to": "TASK-D.3" },
  { "from": "TASK-D.1", "to": "TASK-D.1b" },
  { "from": "TASK-D.1b", "to": "TASK-D.1c" },
  { "from": "TASK-D.1b", "to": "TASK-D.1d" },
  { "from": "TASK-D.1c", "to": "TASK-D.1d" },
  { "from": "TASK-C.2", "to": "TASK-D.1d" },
  { "from": "TASK-D.1d", "to": "TASK-D.1e" },
  { "from": "TASK-D.1", "to": "TASK-C.1" },
  { "from": "TASK-C.1", "to": "TASK-C.3" },
  { "from": "TASK-C.1", "to": "TASK-C.6" },
  { "from": "TASK-C.6", "to": "TASK-W.5a" },
  { "from": "TASK-C.1", "to": "TASK-C.5" },
  { "from": "TASK-D.1", "to": "TASK-W.1" },
  { "from": "TASK-W.1", "to": "TASK-W.2" },
  { "from": "TASK-0.2c", "to": "TASK-W.2b" },
  { "from": "TASK-W.2", "to": "TASK-W.2b" },
  { "from": "TASK-W.2", "to": "TASK-W.3" },
  { "from": "TASK-W.3", "to": "TASK-W.4" },
  { "from": "TASK-W.2", "to": "TASK-W.5a" },
  { "from": "TASK-D.1", "to": "TASK-P.1" },
  { "from": "TASK-C.5", "to": "TASK-D.2" },
  { "from": "TASK-P.1", "to": "TASK-D.2" },
  { "from": "TASK-W.4", "to": "TASK-D.2" },
  { "from": "TASK-0.2c", "to": "TASK-D.2b" },
  { "from": "TASK-D.2", "to": "TASK-D.2b" },
  { "from": "TASK-W.2b", "to": "TASK-D.2b" },
  { "from": "TASK-0.2c", "to": "TASK-S.2" },
  { "from": "TASK-S.1", "to": "TASK-S.2" },
  { "from": "TASK-S.2", "to": "TASK-S.4" },
  { "from": "TASK-S.2", "to": "TASK-C.7" },
  { "from": "TASK-C.1", "to": "TASK-C.7" },
  { "from": "TASK-D.3", "to": "TASK-C.7" },
  { "from": "TASK-D.2", "to": "TASK-S.5" },
  { "from": "TASK-D.2b", "to": "TASK-S.5" },
  { "from": "TASK-S.2", "to": "TASK-S.5" },
  { "from": "TASK-S.4", "to": "TASK-C.2" },
  { "from": "TASK-C.7", "to": "TASK-C.2" },
  { "from": "TASK-S.5", "to": "TASK-C.2" },
  { "from": "TASK-D.3", "to": "TASK-C.2" },
  { "from": "TASK-C.1", "to": "TASK-C.2" },
  { "from": "TASK-C.2", "to": "TASK-E.1" },
  { "from": "TASK-E.1", "to": "TASK-E.2" },
  { "from": "TASK-S.4", "to": "TASK-S.6" },
  { "from": "TASK-C.7", "to": "TASK-S.6" },
  { "from": "TASK-S.5", "to": "TASK-S.6" },
  { "from": "TASK-C.2", "to": "TASK-S.6" },
  { "from": "TASK-S.2", "to": "TASK-S.6" },
  { "from": "TASK-W.5a", "to": "TASK-S.6" },
  { "from": "TASK-D.1d", "to": "TASK-C.8a" },
  { "from": "TASK-D.1d", "to": "TASK-C.8b" },
  { "from": "TASK-S.6", "to": "TASK-C.8b" },
  { "from": "TASK-D.1b", "to": "TASK-C.8c" },
  { "from": "TASK-D.1c", "to": "TASK-C.8c" },
  { "from": "TASK-D.1d", "to": "TASK-C.8c" },
  { "from": "TASK-C.8a", "to": "TASK-C.9a" },
  { "from": "TASK-C.8b", "to": "TASK-C.9a" },
  { "from": "TASK-C.8c", "to": "TASK-C.9a" },
  { "from": "TASK-C.9a", "to": "TASK-C.9b" },
  { "from": "TASK-C.8a", "to": "TASK-C.9b" },
  { "from": "TASK-C.9a", "to": "TASK-C.9c" },
  { "from": "TASK-C.8c", "to": "TASK-C.9c" },
  { "from": "TASK-C.9a", "to": "TASK-C.9d" },
  { "from": "TASK-C.9b", "to": "TASK-C.9d" },
  { "from": "TASK-C.8b", "to": "TASK-C.9d" },
  { "from": "TASK-C.9a", "to": "TASK-C.10a" },
  { "from": "TASK-C.9d", "to": "TASK-C.10a" },
  { "from": "TASK-C.9d", "to": "TASK-C.10b" },
  { "from": "TASK-C.8a", "to": "TASK-C.10b" },
  { "from": "TASK-C.10a", "to": "TASK-C.10c" },
  { "from": "TASK-C.10b", "to": "TASK-C.10c" },
  { "from": "TASK-C.10c", "to": "TASK-C.10d" },
  { "from": "TASK-C.10d", "to": "TASK-C.10e" },
  { "from": "TASK-C.10e", "to": "TASK-C.10f" },
  { "from": "TASK-C.10f", "to": "TASK-C.10g" },
  { "from": "TASK-C.10g", "to": "TASK-C.10h" },
  { "from": "TASK-C.10h", "to": "TASK-C.10i" },
  { "from": "TASK-C.10i", "to": "TASK-C.10j" },
  { "from": "TASK-C.10j", "to": "TASK-C.10k" },
  { "from": "TASK-C.10k", "to": "TASK-C.10l" },
  { "from": "TASK-C.10l", "to": "TASK-C.10m" },
  { "from": "TASK-C.10m", "to": "TASK-C.10n" },
  { "from": "TASK-C.10n", "to": "TASK-C.10o" },
  { "from": "TASK-C.10o", "to": "TASK-C.10p" },
  { "from": "TASK-A.1", "to": "TASK-C.10p" },
  { "from": "TASK-C.10p", "to": "TASK-C.10q" },
  { "from": "TASK-C.10q", "to": "TASK-C.11a" },
  { "from": "TASK-C.10k", "to": "TASK-C.11a" },
  { "from": "TASK-C.11a", "to": "TASK-C.11b" },
  { "from": "TASK-C.11b", "to": "TASK-C.11c" },
  { "from": "TASK-C.11c", "to": "TASK-C.11d" },
  { "from": "TASK-C.10o", "to": "TASK-C.11d" },
  { "from": "TASK-C.11d", "to": "TASK-C.11e" },
  { "from": "TASK-C.10m", "to": "TASK-C.11e" },
  { "from": "TASK-C.11e", "to": "TASK-C.12a" },
  { "from": "TASK-C.11c", "to": "TASK-C.12a" },
  { "from": "TASK-C.12a", "to": "TASK-C.12b" },
  { "from": "TASK-C.12a", "to": "TASK-C.12c" },
  { "from": "TASK-C.11d", "to": "TASK-C.12c" },
  { "from": "TASK-C.12b", "to": "TASK-C.12c" },
  { "from": "TASK-C.11b", "to": "TASK-C.12d" },
  { "from": "TASK-C.11c", "to": "TASK-C.12d" },
  { "from": "TASK-C.12b", "to": "TASK-C.12d" },
  { "from": "TASK-C.12c", "to": "TASK-C.12d" },
  { "from": "TASK-C.12d", "to": "TASK-C.12e" },
  { "from": "TASK-C.12e", "to": "TASK-C.14a" },
  { "from": "TASK-C.10q", "to": "TASK-C.14a" },
  { "from": "TASK-C.14a", "to": "TASK-C.14b" },
  { "from": "TASK-C.14b", "to": "TASK-C.14c" },
  { "from": "TASK-C.14c", "to": "TASK-C.14d" },
  { "from": "TASK-C.12c", "to": "TASK-C.14d" },
  { "from": "TASK-C.14a", "to": "TASK-C.14e" },
  { "from": "TASK-C.14b", "to": "TASK-C.14f" },
  { "from": "TASK-C.12b", "to": "TASK-C.15a" },
  { "from": "TASK-C.15a", "to": "TASK-C.15b" },
  { "from": "TASK-C.12d", "to": "TASK-C.15c" },
  { "from": "TASK-C.12e", "to": "TASK-C.15c" },
  { "from": "TASK-C.15a", "to": "TASK-C.15c" },
  { "from": "TASK-C.15c", "to": "TASK-C.15d" },
  { "from": "TASK-W.5a", "to": "TASK-H.1" },
  { "from": "TASK-C.15a", "to": "TASK-H.2" },
  { "from": "TASK-C.15c", "to": "TASK-H.2" },
  { "from": "TASK-C.14a", "to": "TASK-H.3" },
  { "from": "TASK-D.1b", "to": "TASK-H.4" },
  { "from": "TASK-D.1d", "to": "TASK-H.4" },
  { "from": "TASK-S.6", "to": "TASK-H.5" },
  { "from": "TASK-C.11a", "to": "TASK-H.5" },
  { "from": "TASK-C.14c", "to": "TASK-H.6" },
  { "from": "TASK-C.14d", "to": "TASK-H.6" },
  { "from": "TASK-H.4", "to": "TASK-H.7" },
  { "from": "TASK-E.1", "to": "TASK-H.7" },
  { "from": "TASK-C.12e", "to": "TASK-H.8" },
  { "from": "TASK-C.15c", "to": "TASK-H.8" },
  { "from": "TASK-C.10f", "to": "TASK-C.16" },
  { "from": "TASK-C.16", "to": "TASK-C.17" },
  { "from": "TASK-H.8", "to": "TASK-C.17" },
  { "from": "TASK-C.17", "to": "TASK-C.18" },
  { "from": "TASK-C.16", "to": "TASK-C.18" },
  { "from": "TASK-C.18", "to": "TASK-C.19" },
  { "from": "TASK-C.19", "to": "TASK-C.20" },
  { "from": "TASK-C.20", "to": "TASK-C.21" },
  { "from": "TASK-J.2", "to": "TASK-J.3" },
  { "from": "TASK-J.2", "to": "TASK-J.4" },
  { "from": "TASK-J.3", "to": "TASK-J.5" },
  { "from": "TASK-J.4", "to": "TASK-J.5" },
  { "from": "TASK-J.5", "to": "TASK-J.6" },
  { "from": "TASK-J.5", "to": "TASK-J.7" },
  { "from": "TASK-J.1", "to": "TASK-J.7" },
  { "from": "TASK-L.3", "to": "TASK-L.4" },
  { "from": "TASK-L.1", "to": "TASK-L.6" },
  { "from": "TASK-L.2", "to": "TASK-L.6" },
  { "from": "TASK-L.4", "to": "TASK-L.6" },
  { "from": "TASK-L.5", "to": "TASK-L.6" },
  { "from": "TASK-J.5", "to": "TASK-L.6" },
  { "from": "TASK-J.7", "to": "TASK-L.6" },
  { "from": "TASK-J.8", "to": "TASK-L.6" },
  { "from": "TASK-J.10", "to": "TASK-L.6" },
  { "from": "TASK-J.9", "to": "TASK-J.10" },
  { "from": "TASK-L.6", "to": "TASK-L.7" },
  { "from": "TASK-L.7", "to": "TASK-L.8" },
  { "from": "TASK-J.9", "to": "TASK-L.8" },
  { "from": "TASK-L.8", "to": "TASK-L.9" },
  { "from": "TASK-J.4", "to": "TASK-L.9" },
  { "from": "TASK-J.5", "to": "TASK-L.9" },
  { "from": "TASK-L.9", "to": "TASK-L.10" },
  { "from": "TASK-L.4", "to": "TASK-L.11" },
  { "from": "TASK-L.11", "to": "TASK-L.12" },
  { "from": "TASK-L.9", "to": "TASK-L.13" },
  { "from": "TASK-L.6", "to": "TASK-L.14" },
  { "from": "TASK-L.14", "to": "TASK-L.15" },
  { "from": "TASK-L.15", "to": "TASK-L.16" },
  { "from": "TASK-L.9", "to": "TASK-L.16" },
  { "from": "TASK-L.14", "to": "TASK-L.17" },
  { "from": "TASK-L.14", "to": "TASK-L.17a" },
  { "from": "TASK-L.17a", "to": "TASK-L.17b" },
  { "from": "TASK-L.16", "to": "TASK-L.17b" },
  { "from": "TASK-J.9", "to": "TASK-J.18a" },
  { "from": "TASK-J.4", "to": "TASK-J.18b" },
  { "from": "TASK-J.9", "to": "TASK-J.18b" },
  { "from": "TASK-J.18a", "to": "TASK-J.18c" },
  { "from": "TASK-J.18b", "to": "TASK-J.18c" },
  { "from": "TASK-J.18c", "to": "TASK-J.18d" },
  { "from": "TASK-J.2", "to": "TASK-L.3" },
  { "from": "TASK-J.4", "to": "TASK-L.3" },
  { "from": "TASK-L.2", "to": "TASK-L.4" },
  { "from": "TASK-L.8", "to": "TASK-L.10" },
  { "from": "TASK-L.9", "to": "TASK-L.11" },
  { "from": "TASK-L.12", "to": "TASK-L.13" }
]
```

---
## 3. 详细任务卡明细 (Task Cards)

> **任务状态纪律（v1.6.2）**：`[COMPLETED]` 仅表示该卡列明范围已交付；后续版本的增补不得附加在完成卡内。若核验发现增补未实现，必须拆为有编号、前置依赖、状态及验收条件的独立任务卡。


> 详细任务卡正文已迁出：
> - [活跃 / 未完结卡](./development-tasks-active.md)
> - [已完成卡](./development-tasks-completed.md)
> - [卡号索引](./development-tasks-index.md)

- 3.1 契约基线与通信底座（Sprint 0 基础设施与演进）
- 3.2 Supervisor 建议中枢、原型生成、质疑自查与非技术旅程串联（v1.5.0 全生命周期升级；含 S.6）
- 3.3 受控 Coding Worker、安全策略、威胁守卫与成熟 Agent 适配（W.1/W.2 已完成；W.3/W.4 落 Sprint 2；W.5a 落 Sprint 1，绕过负例收尾落 Sprint 3）
- 3.4 Cursor 式三栏 IDE 工作台与多维 Studio 视口（C.1/C.3 落 Sprint 1；C.2 落 Sprint 4 多维视口；C.8a/b/c 走查 Top3 已合；C.9a–C.9d 第二轮指挥权已合；C.10a–q 第三/四轮体验打磨已合；**C.11a–e Supervisor 五步体感链 COMPLETED**；**C.12a–e Spec Freeze Top5 Delta COMPLETED**；**C.14a–c 基线档案 COMPLETED**；**C.14d/e 安全闭环加固 NEW**；C.4 推迟）
- 3.4b v0.1 硬化与稳定性收敛（Hardening · Tina t877u 立卡；不碰 v0.2 封印）
- 3.4c 闭环旅程 v2.1 第一批（Journey · 规格 `supervisor.md` 第三部分 §13～§20；对应 §19 落差 L-01～L-10）
- 3.4d 交付全链路 · 目标能力（L 系列 · 2026-10-30 立卡）
- 3.5 架构感知、监听与差异审阅（C.5 落 Sprint 2；B.1/B.2/C.4 推迟至 v0.2+）
- 3.5b 全局保护清单与 Vibe 安全网 (Sprint 2)
- 3.6 控制面 API 补齐、快照持久化与合并核销（Sprint 3；前置 C.5/P.1/W.4 于 Sprint 2 完成）
- 3.7 端到端集成与自举发版（v0.1 基线已完成；后续扩展另开卡）

## 4. 单人串行排期与门禁实施指南 (Sprint Schedule，v1.6.2 对齐版)

> **v1.6.2 排期原则**：严守架构规范 §10 依赖次序，底层契约与状态机演进前置。Sprint 0 将 `TASK-0.2c` 作为当前代码实施第一优先级任务；Sprint 4 仅编排其依赖完成后的体验闭环任务，聚焦于「八步体验闭环与状态防死锁」，打通强类型契约、Demo 原型跨源隔离、Task Graph 物理点亮、质疑自查与多维 Studio。

| 迭代阶段 (Sprint) | 计划推进任务卡 | 阶段核心交付物 | 强制门禁检查点 (Gate Check) |
| :--- | :--- | :--- | :--- |
| **Sprint 0: 基础设施与契约演进** | `TASK-0.1` ➔ `TASK-0.2b` ➔ **`TASK-0.2c`**（Schema v1.3.0 与自愈迁移边） | 跨平台环境门禁、Schema v1.2.0 底座、**Schema v1.3.0 (`approval`/`authorization.git`) 与 Fast Path / 自愈迁移边** | `contract-schema-v13.test.ts` 全绿；9 态 lifecycle 迁移矩阵与 15 展示态投影测试通过（Fast Path、自愈、降级边全绿）；`migrateContractToV13` 零静默授权；全量 785+ 测试保持绿灯。 |
| **Sprint 1: 最小端到端（Vibe）** | `TASK-C.1`（三栏骨架）➔ `TASK-C.6`（右栏流式会话）➔ `TASK-W.5a`（Claude Code cli-host 挂载）➔ `TASK-C.3`（Monaco 读写） | 三栏布局、右栏流式/打断/续接、Claude Code 子进程挂载与 Headless 输出 | 右栏 Claude Code 改文件，中栏实时可见，可打断（≤2s）、可续接；全量既有测试以最新 CI 结果为准保持绿灯 |
| **Sprint 2: 保护清单 + 受控执行前置** | `TASK-P.1`（保护清单 + 快照撤销 + 静默合同）➔ `TASK-C.5`（Diff 与终端）➔ `TASK-W.3`（环境/秘密/网络守卫）➔ `TASK-W.4`（威胁守卫与能力复检） | `.stagent/protection.json`、Auto-Checkpoint、【撤销本轮改动】、Header 模式指示、Diff 审阅、环境与网络守卫、`threat-guard.ts` | 保护路径任意模式被拦截；撤销一键恢复；W.4 的 4 类绕过路径负例断言通过；**D.2 的三条前置（C.5、P.1、W.4）全部达成** |
| **Sprint 3: 受控执行实测 + 一键合并** | `TASK-W.5a` 绕过负例实测收尾 ➔ `TASK-D.2`（已完成基线）➔ `TASK-W.2b` ➔ `TASK-D.2b` | 保护模式合同（自动批准/单问）、Worktree 执行、Evidence 生成、增量 Scope 阻断与 Contract v1.3 合并门禁 | Claude Code 在 `GATEWAY_ENFORCED` 下 4 类绕过负例全部失败关闭；`verified_on` 填写实测版本与日期；未触保护区任务用户交互 = 1 次（合并按钮），触保护区 ≤ 2 次 |
| **Sprint 4: 原型试玩、Graph 点亮、质疑自查与防死锁闭环 (八步体验闭环)** | **`TASK-D.3`**（15 状态投影与防死锁）➔ `TASK-S.1` ➔ `TASK-S.2` ➔ `TASK-S.4`（Demo 原型与预览）➔ `TASK-C.7`（Task Graph 渐进点亮）➔ `TASK-S.5`（质疑自查引擎）➔ `TASK-C.2`（Studio 多维视口集成）➔ **`TASK-S.6`（非技术旅程串联，NEW）** | 本地独立端口 Mock 预览 (≤2MB / 独立 Origin / iframe sandbox 无 `allow-same-origin`)、业务脑图与任务 DAG 双重视图、物理指纹点亮动效、质疑自查三方比对报告与置信度治理、Studio 四视口流畅切换、五类防死锁引擎 (D-1~D-5) | 1. 静态 Demo 单文件受控落盘 ≤2MB，在独立随机端口 (4100~4110) 成功预览，iframe sandbox 与 CSP 阻断连接 Daemon 端口，负例 E2E 测试通过；<br>2. Task Graph 节点状态由 Daemon 权威持有，点亮动效延迟 ≤100ms 且严格绑定退出码 0 与 Commit SHA，空验证集 COMMAND 节点禁止全绿；<br>3. 质疑自查看门狗 60s 超时兜底，`confidence < 0.7` 自动降级呈现事实由用户裁决，自动返工严格受限原 Scope 子集；<br>4. 15 状态映射测试通过，D-1~D-5 故障注入测试 100% 成功解除死锁；<br>5. Studio 在 Demo/Graph/质询/代码四视口间流畅切换无状态丢失。 |
| **Sprint 5: 第二/第三个 Agent** | `TASK-W.5b` ➔ `TASK-W.5c` | cursor-agent / OpenHands（`SANDBOX_ENFORCED`）各自 cli-host 实测、计费模型分支 | 每个 Adapter 的 `verified_on` 如实填写；未通过者仅 Vibe 可用且 UI 显示"未受控" |
| **Sprint 6: E2E 与自举发版** | v0.1 基线 `TASK-E.1` / `TASK-E.2` 已完成；v1.6.2 不重开，新增覆盖另建卡 | 既有 E2E 与自举报告基线；新能力的回归范围须在独立 E.3（或后续任务）定义 | 核对历史报告与测试可复现；新增 E.3 另立验收门禁 |
| **v0.2+（推迟，另行立项）** `[用户已确认 D4 · 2026-10-20]` | `TASK-B.1` ➔ `TASK-B.2` ➔ `TASK-C.4` ➔ `TASK-S.3`（建议广播、成熟度评分与 HUD 徽章/Snooze）➔ RFC-2026-002（多子任务 DAG / 新鲜上下文 / Schema-First / 并行 Worktree） | 架构雷达、成熟度评分、多 Agent 编译流水线 | 另行立项评审 |

> **Sprint 0 / 2 / 3 / 4 实施基线核验**：
> - **当前工程物理起点（权威 · 唯一）**：本地代码仓库 `main`@`042e570`（含 [#64](https://github.com/he18718143986-design/IDE/pull/64) oq-2 裁决与 L.17 DoR；其下 `4493178`/#63、`e4dfe1c`/#62 L.16 等）。历史 tip（`e4dfe1c` / `4bae423` / `9829385` 等）仅作溯源，见版本头对应回写条；**不得**再并列自称「当前 HEAD」。
> - **当前首要任务**：主序实现卡已尽，**首要推进 `TASK-L.17a`（已就绪 · `[READY]`）**。oq-2（dec-12）与 oq-3（dec-13）裁决均已落盘，母卡 `TASK-L.17` 已完成拆分为两张 M 卡：`TASK-L.17a`（受控摄取与代登代理 · 前置 L.14 COMPLETED + oq-3 已裁决 → `[READY]`）与 `TASK-L.17b`（对比视图与试玩证据桩 · 前置 L.17a + L.16 COMPLETED → `[READY]`，随 L.17a）。`TASK-J.1`～`J.10`、`J.18a`～`J.18d`、`J.19`、`J.20`、`L.1`～`L.16`、`L.18`、`L.14`、**`A.7`/`H.9`** 已 **COMPLETED**（见版本头第 85～107 条）。台账债余卡 **`W.6`** 仍为 `[NEW_TASK]` · **NON_BLOCKER**（可开；**不与** W.5b/c 同窗）+ **`W.7`**（硬前置 W.6 · 未就绪 · **不抢** W.5b/c 实测窗口）。母卡 `TASK-J.18` / `TASK-L.17` 均标 **`[SPLIT]`**。前序 `TASK-C.21` 及之前均 COMPLETED。**不**宣称端到端闭环；**不**开工实现。
> - **前序（历史）**：`TASK-C.21` → **`[COMPLETED]`**（Tina t910u Supervisor SSOT v2.0.1 审查补丁）。C.20/C.19/C.18/C.17/C.16/H.1–H.8 均 COMPLETED。**不**改产品代码；不抢 D.1e；不扩 v0.2。
> - **Sprint 2 已达成**：`TASK-P.1`、`TASK-C.5`、`TASK-W.3`、`TASK-W.4` 四张卡均已落地并通过各自专用用例；保护路径在任意模式被门卫拦截、撤销一键恢复、4 类绕过负例失败关闭均已成立。
> - **Sprint 3 已达成**：`TASK-D.2` 主体已落地，无交集合同自动批准，交互收敛为 1 次合并按钮。
> - **Sprint 4 进展**：`TASK-D.3`（merge `9a19f4d`）、`TASK-C.2`（merge `51039aa`）与 `TASK-S.1`（merge `a9066dd`）已合入；底座与四视口主链收口完成。**体验最后一公里** `TASK-S.6` 已合入（merge `6415fbd`）；**S.6b REAL_PLAYTEST 真预览挂载已收口**（merge `024d2b8`）。
> - **Sprint 4 体验打磨**：`C.8a/b/c`、`C.9a–d`、`C.10a–q` 均已 **COMPLETED**（C.10q tip `4280de6`）。属非技术可用性打磨，不新开 Sprint 编号。

### 跨阶段门禁准则 (Gate Alignment)
根据 A §10 规定，阶段内任务支持依据 DAG 拓扑关系进行并行编码与单元验证；跨阶段进入联调前，必须以当前 Sprint 的 Gate Check 检查点为准绳，跑通：
```bash
node scripts/verify-env.mjs && npx tsc --noEmit && npm run lint && npm test
```
全部通过后方可推进下一阶段。

---
## 5. 路径映射约定（2026-10-20 核定）

仓库保留既有 `daemon/` 顶层结构，**不再新建平行的 `src/daemon/`**。各任务卡「涉及核心文件」已按下列映射逐条改写为仓库实际布局：

| 任务卡旧路径（v1.2.0 及更早） | 仓库实际路径 |
|---|---|
| `bin/stagent.mjs` / `src/cli/index.ts` | `bin/stagent.ts`（CLI 单一入口） |
| `src/daemon/ws-server.ts` / `src/daemon/http-router.ts` | `daemon/server.ts` |
| `src/daemon/ws-types.ts` | `src/lib/ipc/frames.ts`（协议为 Daemon 与浏览器共享，留在共享协议模块） |
| `src/daemon/scoped-mcp-gateway.ts` | `daemon/mcp/gateway.ts` |
| `src/daemon/process-runner.ts` | `daemon/runner/command-runner.ts` |
| `src/daemon/git-merger.ts` | `daemon/pipeline/merger.ts` |
| `src/daemon/evidence-stale-manager.ts` | `daemon/watcher/invalidation-engine.ts` |
| `src/daemon/evidence-verifier.ts` | `daemon/pipeline/evidence-verifier.ts`（待建） |
| `src/lib/contract-migration.ts`（旧任务草案路径） | `src/lib/migration.ts`（仓库现有迁移模块） |
| `src/supervisor/*` | `daemon/supervisor/*`（待建） |
| `src/worker/*` | `daemon/worker/*`（待建） |
| `src/architecture/*` | `daemon/arch/*`（既有 `graph.ts`/`parser.ts`） |
| `src/watcher/worktree-watcher.ts` | `daemon/watcher/fs-watcher.ts` |
| `src/ui/components/*` | `src/components/*` |
| `src/ui/hooks/*` | `src/hooks/*`（WS 客户端 Hook 既有 `use-daemon-stream.ts`） |

**v1.3.3 新增模块路径（成熟 Agent 与保护清单）**：

| 模块 | 路径 | 说明 |
|---|---|---|
| 成熟 Agent 子进程隔离 | `daemon/worker/cli-host/` | **全仓唯一允许 `child_process`/spawn 的位置**；强制结构化 argv + `shell:false` + 进程树托管回收 |
| Claude Code 适配器 | `daemon/worker/cli-host/claude-code-adapter.ts` | Headless 结构化输出、Pre-tool hook 拦截、会话续接；`verified_on`: Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21（真实 CLI 负例 4/4 全绿；官方 Anthropic 复测为后续回归项） |
| 全局保护清单 | `daemon/protection/protection-list.ts` + `.stagent/protection.json` | 路径 glob + 白话名称；任何模式下规则拦截 |
| Vibe 自动快照 | `daemon/protection/auto-checkpoint.ts` | Agent 改动前自动快照，支撑【撤销本轮改动】 |
| Supervisor 独立预算 | `.stagent/supervisor-budget.json` | 与合同/Worker 预算分账，不互相侵占 |

> **静态约束口径（v1.3.3 收窄）**：`daemon/worker/**` 维持零 `child_process` 静态禁令，唯一例外为 `daemon/worker/cli-host/**`；该例外的测试断言为"cli-host 之外零 spawn"。

测试文件统一归 `tests/{unit,daemon,integration,e2e}/`；浏览器 DOM 测试归 `src/tests/`、`src/hooks/`（vitest `dom` project）。


## 6. 修订流水

完整修订记录与一致性核对已迁至 [`development-tasks-changelog.md`](./development-tasks-changelog.md)（原 §6 全文）。
