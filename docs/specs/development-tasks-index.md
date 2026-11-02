# 研发任务卡号索引

> DOC-1：卡号 → 状态 → 一句话 → 正文链接。权威状态以卡头 / 卡内「任务状态」为准；矩阵见 [`development-tasks.md`](./development-tasks.md) §1。
> 无独立 `#### 【Task …】` 正文的历史卡（如 `TASK-0.1`、`TASK-A.1`～`A.6`、`TASK-S.6b`）仍列入本索引，链到枢纽矩阵 / 修订流水，避免「卡不存在」误读。

| 卡号 | 状态 | 一句话 | 正文 |
| :--- | :--- | :--- | :--- |
| `TASK-0.1` | `COMPLETED` | 工程锁文件与跨平台 CI 自动化基线 | [矩阵行](./development-tasks.md)（无独立详细卡；正文时代已收口进矩阵） |
| `TASK-A.1` | `COMPLETED` | Git Worktree 物理隔离与生命周期管理 | [矩阵行](./development-tasks.md)（无独立详细卡；正文时代已收口进矩阵） |
| `TASK-A.2` | `COMPLETED` | Scoped MCP 工具网关与路径沙箱校验 | [矩阵行](./development-tasks.md)（无独立详细卡；正文时代已收口进矩阵） |
| `TASK-A.3` | `COMPLETED` | 依赖分级复用与工作区构建缓存隔离 | [矩阵行](./development-tasks.md)（无独立详细卡；正文时代已收口进矩阵） |
| `TASK-A.4` | `COMPLETED` | 受限进程执行器与跨平台进程树全回收 | [矩阵行](./development-tasks.md)（无独立详细卡；正文时代已收口进矩阵） |
| `TASK-A.5` | `COMPLETED` | 循环重试熔断与费用/Token 硬上限监控 | [矩阵行](./development-tasks.md)（无独立详细卡；正文时代已收口进矩阵） |
| `TASK-A.6` | `COMPLETED` | Daemon 崩溃自愈、Git 锁清理与 TOCTOU 校验 | [矩阵行](./development-tasks.md)（无独立详细卡；正文时代已收口进矩阵） |
| `TASK-A.7` | `COMPLETED` | Worktree seal 路径前缀对齐 | [打开](./development-tasks-completed.md#task-a.7) |
| `TASK-S.6b` | `COMPLETED` | 真机试玩收口（S.6 降级项；无独立详细卡，见矩阵 S.6 行与 changelog P-22） | [矩阵/流水](./development-tasks.md)（无独立详细卡） |
| `TASK-D.1e` | `DEFERRED` | 桌面壳 / 本机助手：真·选文件夹（Import 与工作台同壳） | [打开](./development-tasks-active.md#task-d.1e) |
| `TASK-S.3` | `DEFERRED` | Supervisor HUD 建议流与 WebSocket 广播 | [打开](./development-tasks-active.md#task-s.3) |
| `TASK-W.5b` | `NEW_TASK` | cursor-agent 适配器黑盒实测 (v1.3.3 新增) | [打开](./development-tasks-active.md#task-w.5b) |
| `TASK-W.5c` | `SPLIT` | OpenHands 适配器（容器隔离）· 拆分母卡（P-118 经授权拆为 i/ii/iii，保留追溯） | [打开](./development-tasks-active.md#task-w.5c) |
| `TASK-W.5c-i` | `COMPLETED` | 双枚举 `SANDBOX_ENFORCED` + `workerSpec` 目标字段（[#81](https://github.com/he18718143986-design/IDE/pull/81)/`c3e75cc` · S/M） | [打开](./development-tasks-completed.md#task-w.5c-i) |
| `TASK-W.5c-ii` | `COMPLETED` | 容器运行时 `runInSandbox` + 派工门禁按宿主可用性解锁（[#85](https://github.com/he18718143986-design/IDE/pull/85)/`648be31` · M · mock/stub 可测；`runInSandbox` 尚未接入执行面） | [打开](./development-tasks-completed.md#task-w.5c-ii) |
| `TASK-W.5c-iii` | `COMPLETED` | OpenHands 适配器 + 真实容器实测 + `verified_on`（围栏档 ruling A · `DockerContainerHost` · 派工即入沙箱 · `SandboxWitness` 证据面消费；[#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a` · M · 真实容器实测 11 passed / 无门禁 11 skipped） | [打开](./development-tasks-completed.md#task-w.5c-iii) |
| `TASK-W.6` | `COMPLETED` | 受控派工接线与默认适配器注册（DLV-3 · #74/`b5d8c53`）· NON_BLOCKER | [打开](./development-tasks-completed.md#task-w.6) |
| `TASK-W.7` | `NEW_TASK` | Worker 自助注册与自动验证（默认 `UNCONTROLLED_EXTERNAL`；探测升格 `GATEWAY_ENFORCED`；**Sprint 首要**）· NON_BLOCKER | [打开](./development-tasks-active.md#task-w.7) |
| `TASK-W.8` | `COMPLETED` | Worker 侧 Stagent MCP HTTP 端点 | [打开](./development-tasks-completed.md#task-w.8) |
| `TASK-J.18` | `SPLIT` | Worker 派工墓地门禁（INV-LEDGER-03 工地侧）· 拆分母卡 | [打开](./development-tasks-active.md#task-j.18) |
| `TASK-J.19` | `COMPLETED` | DN-2「可以」HTTP/画布入口（DLV-6） | [打开](./development-tasks-completed.md#task-j.19) |
| `TASK-J.20` | `COMPLETED` | OP-1 授权清单落地（dec-10 实施） | [打开](./development-tasks-completed.md#task-j.20) |
| `TASK-L.12` | `COMPLETED` | 系统知识库：Schema、引导合同与漂移门禁 | [打开](./development-tasks-completed.md#task-l.12) |
| `TASK-L.13` | `COMPLETED` | 追踪链：Trailer 扩展与「这段为什么存在」反查 | [打开](./development-tasks-completed.md#task-l.13) |
| `TASK-L.15` | `COMPLETED` | 发布生命周期与两类部署目标 | [打开](./development-tasks-completed.md#task-l.15) |
| `TASK-L.16` | `COMPLETED` | 线上问题回流 | [打开](./development-tasks-completed.md#task-l.16) |
| `TASK-L.17` | `SPLIT` | 受控只读外网摄取（北极星前置 · 已拆分） | [打开](./development-tasks-active.md#task-l.17) |
| `TASK-L.17a` | `COMPLETED` | 受控摄取与代登代理 | [打开](./development-tasks-completed.md#task-l.17a) |
| `TASK-L.17b` | `COMPLETED` | 对比视图与试玩证据桩（M5 主序收官 · dec-12 证据桩） | [打开](./development-tasks-completed.md#task-l.17b) |
| `TASK-L.18` | `COMPLETED` | 系统地图 UI +「改这里会影响什么」（DLV-5） | [打开](./development-tasks-completed.md#task-l.18) |
| `TASK-H.9` | `COMPLETED` | 废止 `.stagent/metadata/` 写入（DLV-4 · ADR-0011） | [打开](./development-tasks-completed.md#task-h.9) |
| `TASK-B.1` | `DEFERRED` | 本地 AST 增量依赖图分析引擎 | [打开](./development-tasks-active.md#task-b.1) |
| `TASK-B.2` | `DEFERRED` | 多活跃 Worktree 监听与 Evidence 状态联动 | [打开](./development-tasks-active.md#task-b.2) |
| `TASK-C.4` | `DEFERRED` | 架构雷达视图与 Scope 圈选抽屉 | [打开](./development-tasks-active.md#task-c.4) |
| `TASK-0.2b` | `COMPLETED` | Schema v1.2.0 增量演进、双状态机联动与存量迁移 | [打开](./development-tasks-completed.md#task-0.2b) |
| `TASK-0.2c` | `COMPLETED` | Schema v1.3.0 增量演进、Fast Path 与自愈迁移边实现 [认领架构 P0.2c / C-01] | [打开](./development-tasks-completed.md#task-0.2c) |
| `TASK-D.1` | `COMPLETED` | CLI 引导入口与安全 WebSocket 通信桥 | [打开](./development-tasks-completed.md#task-d.1) |
| `TASK-D.1b` | `COMPLETED` | 一键打开项目（Daemon 托管控制台 + open CLI） | [打开](./development-tasks-completed.md#task-d.1b) |
| `TASK-D.1c` | `COMPLETED` | 最近项目一键重开（控制台「打开项目」） | [打开](./development-tasks-completed.md#task-d.1c) |
| `TASK-D.1d` | `COMPLETED` | 修复同源控制台空白（生产可用单窗口） | [打开](./development-tasks-completed.md#task-d.1d) |
| `TASK-D.3` | `COMPLETED` | 15 状态确定性投影持久化与防死锁自愈引擎 | [打开](./development-tasks-completed.md#task-d.3) |
| `TASK-S.1` | `COMPLETED` | Supervisor 建议会话与持久化存储管理 | [打开](./development-tasks-completed.md#task-s.1) |
| `TASK-S.2` | `COMPLETED` | 按需合同草案生成引擎（L0 规则 / L1 强模型；v1.3.3 拆分精简） | [打开](./development-tasks-completed.md#task-s.2) |
| `TASK-S.4` | `COMPLETED` | Demo 静态原型生成器与 Mock 预览服务 [v1.6.1 升级] | [打开](./development-tasks-completed.md#task-s.4) |
| `TASK-S.5` | `COMPLETED` | Supervisor 质疑自查与根因分流归因引擎 [v1.6.1 升级] | [打开](./development-tasks-completed.md#task-s.5) |
| `TASK-S.6` | `COMPLETED` | 非技术旅程串联（右侧唯一入口分流 + 确认原型开工） | [打开](./development-tasks-completed.md#task-s.6) |
| `TASK-W.1` | `COMPLETED` | Coding Worker 适配器抽象与任务指令装配 | [打开](./development-tasks-completed.md#task-w.1) |
| `TASK-W.2` | `COMPLETED` | Scoped Gateway 强制工具注入与执行拦截 | [打开](./development-tasks-completed.md#task-w.2) |
| `TASK-W.2b` | `COMPLETED` | 未跟踪文件 Scope 联合检查与越界阻断 | [打开](./development-tasks-completed.md#task-w.2b) |
| `TASK-W.3` | `COMPLETED` | 测试环境、秘密脱敏与网络/端口策略守卫 | [打开](./development-tasks-completed.md#task-w.3) |
| `TASK-W.4` | `COMPLETED` | 高风险执行威胁守卫与运行时能力复检 (闭环 G-01 & G-20) | [打开](./development-tasks-completed.md#task-w.4) |
| `TASK-W.5a` | `COMPLETED` | Claude Code 适配器与 cli-host 黑盒实测 (v1.3.3 新增) | [打开](./development-tasks-completed.md#task-w.5a) |
| `TASK-C.1` | `COMPLETED` | Cursor 式三栏 IDE 响应式工作台骨架与 Studio 视口 | [打开](./development-tasks-completed.md#task-c.1) |
| `TASK-C.2` | `COMPLETED` | 中栏 Supervisor Studio 多维视口（Demo / Graph / 质询 / 合同）[v1.5.0 升级] | [打开](./development-tasks-completed.md#task-c.2) |
| `TASK-C.8a` | `COMPLETED` | 老板模式文案与默认助手（消演示恐吓 / Key 向导） | [打开](./development-tasks-completed.md#task-c.8a) |
| `TASK-C.8b` | `COMPLETED` | Fast Path 老板三步台（藏工程师合同细节） | [打开](./development-tasks-completed.md#task-c.8b) |
| `TASK-C.8c` | `COMPLETED` | 连接与打开死路自救（无钥匙一键重开 + 粘贴路径打开） | [打开](./development-tasks-completed.md#task-c.8c) |
| `TASK-C.9a` | `COMPLETED` | 首屏单一主路径（三态只留一个指挥信号） | [打开](./development-tasks-completed.md#task-c.9a) |
| `TASK-C.9b` | `COMPLETED` | 助手模式互斥（练习 vs 真助手 vs 向导） | [打开](./development-tasks-completed.md#task-c.9b) |
| `TASK-C.9c` | `COMPLETED` | 打开项目面板生命周期（默认收 / 成功即关 / 已连接降级为切换） | [打开](./development-tasks-completed.md#task-c.9c) |
| `TASK-C.9d` | `COMPLETED` | 进行中中栏让路（收欢迎页 / 设置深链回跳） | [打开](./development-tasks-completed.md#task-c.9d) |
| `TASK-C.10a` | `COMPLETED` | 进行中生命周期收口（退出 in_progress / 无空让路壳） | [打开](./development-tasks-completed.md#task-c.10a) |
| `TASK-C.10b` | `COMPLETED` | 设置页老板主路径（钥匙主视线 / 工程师项进高级） | [打开](./development-tasks-completed.md#task-c.10b) |
| `TASK-C.10c` | `COMPLETED` | 界面暗号/命名清扫（白话标签 + 图谱单入口） | [打开](./development-tasks-completed.md#task-c.10c) |
| `TASK-C.10d` | `COMPLETED` | 左栏老板主路径（换项目主视线 / 文件与资产进折叠） | [打开](./development-tasks-completed.md#task-c.10d) |
| `TASK-C.10e` | `COMPLETED` | Cursor 式欢迎页承载打开/切换项目 | [打开](./development-tasks-completed.md#task-c.10e) |
| `TASK-C.10f` | `COMPLETED` | 资源管理器纯文件树 + 规范与资产进项目审阅 | [打开](./development-tasks-completed.md#task-c.10f) |
| `TASK-C.10g` | `COMPLETED` | 文件树展开/折叠（默认只展开第一层） | [打开](./development-tasks-completed.md#task-c.10g) |
| `TASK-C.10h` | `COMPLETED` | 文件树右键删除（确认 / P.1 / 尽量废纸篓） | [打开](./development-tasks-completed.md#task-c.10h) |
| `TASK-C.10i` | `COMPLETED` | 文件树第一批（折叠整树 / 新建 / Finder·复制·重命名·删除） | [打开](./development-tasks-completed.md#task-c.10i) |
| `TASK-C.10j` | `COMPLETED` | 中栏 Markdown 预览阅读（默认预览 / 可切源码） | [打开](./development-tasks-completed.md#task-c.10j) |
| `TASK-C.10k` | `COMPLETED` | 右栏只留双方对话（去工程师噪声；Cursor 右栏进 v0.2） | [打开](./development-tasks-completed.md#task-c.10k) |
| `TASK-C.10l` | `COMPLETED` | 设置「高级」可选会话/适配器（不回潮右栏） | [打开](./development-tasks-completed.md#task-c.10l) |
| `TASK-C.10m` | `COMPLETED` | 质疑自查裁决按钮接线（缺陷修复 / 新需求演进） | [打开](./development-tasks-completed.md#task-c.10m) |
| `TASK-C.10n` | `COMPLETED` | 任务图谱空态可感知（禁用无效切换 / 刷新反馈 / 建图 CTA） | [打开](./development-tasks-completed.md#task-c.10n) |
| `TASK-C.10o` | `COMPLETED` | 任务图谱开工/核销入口（接 start/verify） | [打开](./development-tasks-completed.md#task-c.10o) |
| `TASK-C.10p` | `COMPLETED` | 图谱开工/核销自动确保任务 Worktree | [打开](./development-tasks-completed.md#task-c.10p) |
| `TASK-C.10q` | `COMPLETED` | Studio 全景/施工双视角壳 + 改名消歧义 | [打开](./development-tasks-completed.md#task-c.10q) |
| `TASK-C.11a` | `COMPLETED` | 右栏白话推荐选择题（≤2 轮收敛） | [打开](./development-tasks-completed.md#task-c.11a) |
| `TASK-C.11b` | `COMPLETED` | 隔离 Demo 预览挂载与感官确认 | [打开](./development-tasks-completed.md#task-c.11b) |
| `TASK-C.11c` | `COMPLETED` | 白话合同卡片与签署拦截 | [打开](./development-tasks-completed.md#task-c.11c) |
| `TASK-C.11d` | `COMPLETED` | 施工图 Evidence 点亮 + 越界挂起弹窗 | [打开](./development-tasks-completed.md#task-c.11d) |
| `TASK-C.11e` | `COMPLETED` | 真机对照验收与质疑自查回灰 | [打开](./development-tasks-completed.md#task-c.11e) |
| `TASK-C.12a` | `COMPLETED` | 双层执行令牌（exec_token + resume_token/jti） | [打开](./development-tasks-completed.md#task-c.12a) |
| `TASK-C.12b` | `COMPLETED` | 状态广播 epoch/seq + EO-01 DeliveryState | [打开](./development-tasks-completed.md#task-c.12b) |
| `TASK-C.12c` | `COMPLETED` | 越界原子拦截（SIGINT 3s → SIGKILL → 吊销 → 清锁） | [打开](./development-tasks-completed.md#task-c.12c) |
| `TASK-C.12d` | `COMPLETED` | Demo 三态门禁 + can_sign + records 轻量拷贝 | [打开](./development-tasks-completed.md#task-c.12d) |
| `TASK-C.12e` | `COMPLETED` | 无 Git 审计侧车 audit-manifest | [打开](./development-tasks-completed.md#task-c.12e) |
| `TASK-C.14a` | `COMPLETED` | 只读沙盒静态扫描器（基线 P0 骨架） | [打开](./development-tasks-completed.md#task-c.14a) |
| `TASK-C.14b` | `COMPLETED` | 渐进扫 + 基线档案落盘 + 全景视口 | [打开](./development-tasks-completed.md#task-c.14b) |
| `TASK-C.14c` | `COMPLETED` | Workspace Dirty Check + 图谱白话 + Supervisor 防抢跑 | [打开](./development-tasks-completed.md#task-c.14c) |
| `TASK-C.14d` | `COMPLETED` | 脏区→Scope 真链路硬门禁 | [打开](./development-tasks-completed.md#task-c.14d) |
| `TASK-C.14e` | `COMPLETED` | 扫描器 OS 级只读与断网沙盒证明 | [打开](./development-tasks-completed.md#task-c.14e) |
| `TASK-C.14f` | `COMPLETED` | 基线深度进度真 WS/流式 | [打开](./development-tasks-completed.md#task-c.14f) |
| `TASK-C.15a` | `COMPLETED` | EO-01 DeliveryState 完备 | [打开](./development-tasks-completed.md#task-c.15a) |
| `TASK-C.15b` | `COMPLETED` | EO-08 断言身份与返工计数 | [打开](./development-tasks-completed.md#task-c.15b) |
| `TASK-C.15c` | `COMPLETED` | EO-05 两阶段归档/GC 细项 | [打开](./development-tasks-completed.md#task-c.15c) |
| `TASK-C.15d` | `COMPLETED` | P0 AC-ISOL 草稿隔离 + EO-09 Worktree seal | [打开](./development-tasks-completed.md#task-c.15d) |
| `TASK-C.16` | `COMPLETED` | ActivityBar 单门：列表+操作台 | [打开](./development-tasks-completed.md#task-c.16) |
| `TASK-C.17` | `COMPLETED` | P0 调试日志（JSONL + 旅程 + Worker + UI trace） | [打开](./development-tasks-completed.md#task-c.17) |
| `TASK-C.18` | `COMPLETED` | 方案工作台单页（自由对话 + 方案审阅 + 确认方案开工） | [打开](./development-tasks-completed.md#task-c.18) |
| `TASK-C.19` | `COMPLETED` | Supervisor SSOT 合流（DOC-SSOT-Supervisor） | [打开](./development-tasks-completed.md#task-c.19) |
| `TASK-C.20` | `COMPLETED` | Supervisor 合流前碎片归档（DOC-ARCHIVE-Supervisor-pre-SSOT） | [打开](./development-tasks-completed.md#task-c.20) |
| `TASK-C.21` | `COMPLETED` | Supervisor SSOT 审查补丁（DOC-SSOT-Supervisor-Patch） | [打开](./development-tasks-completed.md#task-c.21) |
| `TASK-C.22` | `COMPLETED` | 合同 schema references[] 字段 | [打开](./development-tasks-completed.md#task-c.22) |
| `TASK-C.23` | `COMPLETED` | `check playtest` 接入北极星合同验收档（ruling 3 兑现 · [#82](https://github.com/he18718143986-design/IDE/pull/82)/`a5223fb` · S） | [打开](./development-tasks-completed.md#task-c.23) |
| `TASK-H.1` | `COMPLETED` | Worker JSON/Patch 解析校验与轻量重试 | [打开](./development-tasks-completed.md#task-h.1) |
| `TASK-H.2` | `COMPLETED` | MERGED/DELIVERED 终态收口消歧 | [打开](./development-tasks-completed.md#task-h.2) |
| `TASK-H.3` | `COMPLETED` | 基线扫描硬上限与超时熔断 | [打开](./development-tasks-completed.md#task-h.3) |
| `TASK-H.4` | `COMPLETED` | 空目录友好 git init 引导 | [打开](./development-tasks-completed.md#task-h.4) |
| `TASK-H.5` | `COMPLETED` | 旅程草案 contract_id 不丢 | [打开](./development-tasks-completed.md#task-h.5) |
| `TASK-H.6` | `COMPLETED` | 脏区引导精修（acknowledge_dirty） | [打开](./development-tasks-completed.md#task-h.6) |
| `TASK-H.7` | `COMPLETED` | 主链路回归套件锁死 | [打开](./development-tasks-completed.md#task-h.7) |
| `TASK-H.8` | `COMPLETED` | records 脱敏导出与单项目清理 | [打开](./development-tasks-completed.md#task-h.8) |
| `TASK-C.3` | `COMPLETED` | Monaco 核心编辑器集成与受控 Worktree 读写 | [打开](./development-tasks-completed.md#task-c.3) |
| `TASK-J.1` | `COMPLETED` | 右栏 AI 搭档只读工具集（P0 安全） | [打开](./development-tasks-completed.md#task-j.1) |
| `TASK-J.2` | `COMPLETED` | ScopePlan 纯函数与 Daemon 范围预检构建器 | [打开](./development-tasks-completed.md#task-j.2) |
| `TASK-J.3` | `COMPLETED` | 唯一确认谓词纳入 ScopePlan | [打开](./development-tasks-completed.md#task-j.3) |
| `TASK-J.4` | `COMPLETED` | Daemon 范围预检接口与快照绑定 | [打开](./development-tasks-completed.md#task-j.4) |
| `TASK-J.5` | `COMPLETED` | 「确认方案」接线改造：范围先算好、按快照签 | [打开](./development-tasks-completed.md#task-j.5) |
| `TASK-J.6` | `COMPLETED` | 中栏《改动范围与验收方式》区块 | [打开](./development-tasks-completed.md#task-j.6) |
| `TASK-J.7` | `COMPLETED` | 交接三步进度与右栏解锁（施工对话过渡态） | [打开](./development-tasks-completed.md#task-j.7) |
| `TASK-J.8` | `COMPLETED` | JourneyStage 投影与广播 | [打开](./development-tasks-completed.md#task-j.8) |
| `TASK-J.9` | `COMPLETED` | SchemePatch 零模型确定性合并引擎 | [打开](./development-tasks-completed.md#task-j.9) |
| `TASK-J.10` | `COMPLETED` | 意图编译器生成端与 Daemon 编译循环 | [打开](./development-tasks-completed.md#task-j.10) |
| `TASK-J.18a` | `COMPLETED` | G-MATCH 纯函数与产出物投影 | [打开](./development-tasks-completed.md#task-j.18a) |
| `TASK-J.18b` | `COMPLETED` | 合同 scheme_binding 与快照墓地权威源 | [打开](./development-tasks-completed.md#task-j.18b) |
| `TASK-J.18c` | `COMPLETED` | 墓地门禁裁决、优先级格与派工绑定 | [打开](./development-tasks-completed.md#task-j.18c) |
| `TASK-J.18d` | `COMPLETED` | 写路径接线、CLI pack、全量扫描与集成 | [打开](./development-tasks-completed.md#task-j.18d) |
| `TASK-L.1` | `COMPLETED` | 右栏纯净化：去掉系统提示与消息前缀（DEC-004） | [打开](./development-tasks-completed.md#task-l.1) |
| `TASK-L.2` | `COMPLETED` | Worker 指令补全「你会被这样检查」 | [打开](./development-tasks-completed.md#task-l.2) |
| `TASK-L.3` | `COMPLETED` | 测试义务：合同元数据、ScopePlan 系统范围、证据字段与 stagent check | [打开](./development-tasks-completed.md#task-l.3) |
| `TASK-L.4` | `COMPLETED` | 两段式施工编排：先红后绿 | [打开](./development-tasks-completed.md#task-l.4) |
| `TASK-L.5` | `COMPLETED` | 真实预览：在 Worktree 里启动用户应用 | [打开](./development-tasks-completed.md#task-l.5) |
| `TASK-L.6` | `COMPLETED` | 黄金切片端到端测试（M2 退出标准） | [打开](./development-tasks-completed.md#task-l.6) |
| `TASK-L.7` | `COMPLETED` | ProjectPlan 类型、校验与存储 | [打开](./development-tasks-completed.md#task-l.7) |
| `TASK-L.8` | `COMPLETED` | 计划补丁合并与分解器 | [打开](./development-tasks-completed.md#task-l.8) |
| `TASK-L.9` | `COMPLETED` | 合同序列、桩视图预检与「下一份」交接 | [打开](./development-tasks-completed.md#task-l.9) |
| `TASK-L.10` | `COMPLETED` | 画布「项目地图」视图 | [打开](./development-tasks-completed.md#task-l.10) |
| `TASK-L.11` | `COMPLETED` | DesignNote 生成、校验与注入 | [打开](./development-tasks-completed.md#task-l.11) |
| `TASK-L.14` | `COMPLETED` | 凭据保险库 | [打开](./development-tasks-completed.md#task-l.14) |
| `TASK-C.5` | `COMPLETED` | 双栏 Diff 审阅器与结构化终端日志回放 | [打开](./development-tasks-completed.md#task-c.5) |
| `TASK-C.6` | `COMPLETED` | 右栏 Agent 流式会话与打断续接 (v1.3.3 新增) | [打开](./development-tasks-completed.md#task-c.6) |
| `TASK-C.7` | `COMPLETED` | 业务功能树与 Task Graph 渐进点亮视口 [v1.6.1 升级] | [打开](./development-tasks-completed.md#task-c.7) |
| `TASK-P.1` | `COMPLETED` | 全局保护清单与 Vibe 模式安全网 (v1.3.3 新增) [用户已确认 D1 / D2 · 2026-10-20] | [打开](./development-tasks-completed.md#task-p.1) |
| `TASK-D.2` | `COMPLETED` | 控制面 API 补齐、合并门禁（一键合并）与 Git Trailer 审计 | [打开](./development-tasks-completed.md#task-d.2) |
| `TASK-D.2b` | `COMPLETED` | 未跟踪文件合并门禁与 Contract v1.3 零静默迁移接入 | [打开](./development-tasks-completed.md#task-d.2b) |
| `TASK-E.1` | `COMPLETED` | 双 Agent 协同与全流程 E2E 自动化测试 | [打开](./development-tasks-completed.md#task-e.1) |
| `TASK-E.2` | `COMPLETED` | Stagent 仓库自举 (Dogfooding) 与发版交付 | [打开](./development-tasks-completed.md#task-e.2) |
