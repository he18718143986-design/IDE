# 研发任务卡号索引

> DOC-1：卡号 → 状态 → 一句话 → 正文链接。权威状态以卡头 / 卡内「任务状态」为准；矩阵见 [`development-tasks.md`](./development-tasks.md) §1。[`development-tasks-completed.md`](./development-tasks-completed.md) 是档案，不参与「现行条款以谁为准」。
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
| `TASK-D.1e` | `DEFERRED` | 桌面壳 / 本机助手：维持 DEFERRED；**（P-172）DoR 重写已落（未激活）**；**（P-169）选夹由 [`TASK-DS.1`](./development-tasks-completed.md#task-ds.1) `[COMPLETED]`；新建由 [`TASK-DS.2`](./development-tasks-completed.md#task-ds.2) `[COMPLETED]`（#174/`eacd101`）承接；本卡不激活；切片≠D.1e**；DoR 已入队（P-165）·未改出 DEFERRED（D-6 / P-141） | [打开](./development-tasks-active.md#task-d.1e) |
| `TASK-DS.1` | `COMPLETED` | macOS 本机助手 · 选文件夹开项目（[#171](https://github.com/he18718143986-design/IDE/pull/171)/`1701cab`；P-167 回写；选夹增强；完成≠D.1e；不宣称闭环） | [打开](./development-tasks-completed.md#task-ds.1) |
| `TASK-DS.2` | `COMPLETED` | macOS 本机助手 · 新建空项目开进工作台（[#174](https://github.com/he18718143986-design/IDE/pull/174)/`eacd101`；P-169 回写；新建增强；完成≠D.1e；不宣称闭环） | [打开](./development-tasks-completed.md#task-ds.2) |
| `TASK-S.3` | `DEFERRED` | Supervisor HUD 建议流与 WebSocket 广播（v0.2 评审未激活 · D-5 / P-141） | [打开](./development-tasks-active.md#task-s.3) |
| `TASK-W.5b` | `COMPLETED` | cursor-agent 适配器黑盒实测 (v1.3.3 新增) · [#92](https://github.com/he18718143986-design/IDE/pull/92)/`bdac805`；`UNCONTROLLED_EXTERNAL` 登记 + W.7 探测包非容器负向回归；**（P-160）** `CURSOR_AGENT_VERIFIED_ON` 已回填（`cli_version: "2026.10.22-27dcf5f"` / `verified_at: "2026-11-05"`；run 41959697673）；档位不变；`verified_on` ≠ 已受控 / 可派工；P-125「CA-06 未执行」保留作溯源 | [打开](./development-tasks-completed.md#task-w.5b) |
| `TASK-W.5c` | `SPLIT` | OpenHands 适配器（容器隔离）· 拆分母卡（P-118 经授权拆为 i/ii/iii，保留追溯） | [打开](./development-tasks-active.md#task-w.5c) |
| `TASK-W.5c-i` | `COMPLETED` | 双枚举 `SANDBOX_ENFORCED` + `workerSpec` 目标字段（[#81](https://github.com/he18718143986-design/IDE/pull/81)/`c3e75cc` · S/M） | [打开](./development-tasks-completed.md#task-w.5c-i) |
| `TASK-W.5c-ii` | `COMPLETED` | 容器运行时 `runInSandbox` + 派工门禁按宿主可用性解锁（[#85](https://github.com/he18718143986-design/IDE/pull/85)/`648be31` · M · mock/stub 可测；`runInSandbox` 尚未接入执行面） | [打开](./development-tasks-completed.md#task-w.5c-ii) |
| `TASK-W.5c-iii` | `COMPLETED` | OpenHands 适配器 + 真实容器实测 + `verified_on`（围栏档 ruling A · `DockerContainerHost` · 派工即入沙箱 · `SandboxWitness` 证据面消费；[#87](https://github.com/he18718143986-design/IDE/pull/87)/`2313597a` · M · 真实容器实测 11 passed / 无门禁 11 skipped） | [打开](./development-tasks-completed.md#task-w.5c-iii) |
| `TASK-W.6` | `COMPLETED` | 受控派工接线与默认适配器注册（DLV-3 · #74/`b5d8c53`）· NON_BLOCKER | [打开](./development-tasks-completed.md#task-w.6) |
| `TASK-W.7` | `COMPLETED` | Worker 自助注册与自动验证（两级注册语义 · 五类断言探测包 · `promoteControlMode` 唯一升格入口；[#89](https://github.com/he18718143986-design/IDE/pull/89)/`be480bb` · L · **升格到 `SANDBOX_ENFORCED` 但无执行器 → `dispatchable:false`**；测试 34 passed）· NON_BLOCKER | [打开](./development-tasks-completed.md#task-w.7) |
| `TASK-W.8` | `COMPLETED` | Worker 侧 Stagent MCP HTTP 端点 | [打开](./development-tasks-completed.md#task-w.8) |
| `TASK-W.9` | `COMPLETED（实质闭合）` | 自注册/外部 Worker 执行器接线 · 母卡（历史 `[SPLIT]` 标记保留追溯） | [打开](./development-tasks-active.md#task-w.9) |
| `TASK-W.9a` | `COMPLETED` | 探测报告指纹升格 + launch 解耦（[#99](https://github.com/he18718143986-design/IDE/pull/99)/`22168ee`） | [打开](./development-tasks-completed.md#task-w.9a) |
| `TASK-W.9b` | `COMPLETED` | `ContainerCliAdapter` + `runInSandbox()` + witness 证据面接线；Cursor 容器协议未实证（[#101](https://github.com/he18718143986-design/IDE/pull/101)/`b98e463`） | [打开](./development-tasks-completed.md#task-w.9b) |
| `TASK-W.9c` | `COMPLETED` | 自注册工厂闭环（[#107](https://github.com/he18718143986-design/IDE/pull/107)/`d3397a6`；挂账①②③④均已销 P-154/P-155/P-156/P-157；④口径=钉协议+fail-closed，≠ 已受控） | [打开](./development-tasks-completed.md#task-w.9c) |
| `TASK-W.9d` | `COMPLETED` | 行投影 Docker host probe 成本收敛（[#152](https://github.com/he18718143986-design/IDE/pull/152)/`f5577de`；P-154 回写） | [打开](./development-tasks-completed.md#task-w.9d) |
| `TASK-W.9e` | `COMPLETED` | 受控派工拒绝码穿透诊断（[#154](https://github.com/he18718143986-design/IDE/pull/154)/`5d3d55b`；P-155 回写） | [打开](./development-tasks-completed.md#task-w.9e) |
| `TASK-W.9f` | `COMPLETED` | 容器环境 API key 明文可读面收敛（[#156](https://github.com/he18718143986-design/IDE/pull/156)/`b92accc`；P-156 回写） | [打开](./development-tasks-completed.md#task-w.9f) |
| `TASK-W.9g` | `COMPLETED` | Cursor CLI 容器镜像/运行协议实证（[#158](https://github.com/he18718143986-design/IDE/pull/158)/`691b8b8`；P-157 回写；`empirically_verified=false`；销④ ≠ 已受控） | [打开](./development-tasks-completed.md#task-w.9g) |
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
| `TASK-L.17c` | `COMPLETED` | 中栏同页 CompareView + 原话「认可完成」+ `GET /api/playtest/status`（[#104](https://github.com/he18718143986-design/IDE/pull/104)/`06661be`；挂账①/②/③已销 P-150/P-151/P-152） | [打开](./development-tasks-completed.md#task-l.17c) |
| `TASK-L.17d` | `COMPLETED` | L.17a 参考站抓取 → CompareView `snapshots`（[#145](https://github.com/he18718143986-design/IDE/pull/145)/`e2b8dd3`；P-150 回写） | [打开](./development-tasks-completed.md#task-l.17d) |
| `TASK-L.17e` | `COMPLETED` | 会话原话候选接入试玩认可框（[#147](https://github.com/he18718143986-design/IDE/pull/147)/`aeedecd`；P-151 回写） | [打开](./development-tasks-completed.md#task-l.17e) |
| `TASK-L.17f` | `COMPLETED` | 真机/门禁链 `check playtest` 执行债（[#149](https://github.com/he18718143986-design/IDE/pull/149)/`86da495`；P-152 回写） | [打开](./development-tasks-completed.md#task-l.17f) |
| `TASK-L.18` | `COMPLETED` | 系统地图 UI +「改这里会影响什么」（DLV-5） | [打开](./development-tasks-completed.md#task-l.18) |
| `TASK-H.9` | `COMPLETED` | 废止 `.stagent/metadata/` 写入（DLV-4 · ADR-0011） | [打开](./development-tasks-completed.md#task-h.9) |
| `TASK-B.1` | `COMPLETED` | 本地 AST 增量依赖图分析引擎（parser/graph 增强 + 性能基准 + 恶魔测试 + 契约兼容超集；#124/9c177e9） | [打开](./development-tasks-completed.md#task-b.1) |
| `TASK-CI.1` | `COMPLETED` | B.1 Tarjan 门禁抗 macos CI 抖动（[#161](https://github.com/he18718143986-design/IDE/pull/161)/`bf971d5`；P-159 回写；门禁 4 ≤150ms；抗抖动≠永久全绿） | [打开](./development-tasks-completed.md#task-ci.1) |
| `TASK-CI.2` | `NEW_TASK` · Hold | macOS 性能门禁抗抖动（含 RadarGraph 16ms；arch P100 还原见 [#192](https://github.com/he18718143986-design/IDE/pull/192)；pre-merge 80ms 挂账；立卡 P-177；P-245 评估「不够整卡放宽」· Hold 未开工） | [正文](./development-tasks-active.md#task-ci.2) · [评估简报](../ledger/ci2-sample-assessment-brief.md) |
| `TASK-CI.3` | `COMPLETED` | 测试 fetch 哨兵清零未桩请求并切判红（10 文件；判红已切；立卡 P-178；施工 P-179 · #201 `bdde65c`） | [正文](./development-tasks-completed.md#task-ci.3) |
| `TASK-CI.4` | `COMPLETED` | 判红开关与离线桩回归用例（挂账⑦；立卡 P-180；施工 P-193 · #227 `f8bfbad`） | [正文](./development-tasks-completed.md#task-ci.4) |
| `TASK-CI.5` | `COMPLETED` | 专修 `app-preview-runner.test.ts` 端口隔离（挂账⑨ `:163` / `:199` 三次复发已修；立卡 P-218；施工 [#269](https://github.com/he18718143986-design/IDE/pull/269)/`e12b7b7`；完工回写 P-219；估算 S） | [打开](./development-tasks-completed.md#task-ci.5) |
| `TASK-AUDITED.1` | `COMPLETED` | AUDITED 合同退回待批受控边（[#165](https://github.com/he18718143986-design/IDE/pull/165)/`b390254`；P-162 回写；库层边+Guard；**（P-171）** 生产接线由 [`TASK-AUDITED.2`](./development-tasks-completed.md#task-audited.2) 承接；不宣称闭环） | [打开](./development-tasks-completed.md#task-audited.1) |
| `TASK-AUDITED.2` | `COMPLETED` | AUDITED 退回待批生产接线（[#178](https://github.com/he18718143986-design/IDE/pull/178)/`71684d4`；P-171 回写；orchestrator/API/ContractCard；#178 合入时 index 父级未接 · follow-up 进行中；不宣称闭环） | [打开](./development-tasks-completed.md#task-audited.2) |
| `TASK-B.2` | `COMPLETED` | 多活跃 Worktree 监听与 Evidence 状态联动（Map 监听、指纹单点、合并前兜底；门禁①中位 67.9ms，未达 50ms 体验目标；[#128](https://github.com/he18718143986-design/IDE/pull/128)/`b1aa44f`） | [打开](./development-tasks-completed.md#task-b.2) |
| `TASK-C.4` | `COMPLETED` | 架构雷达视图与 Scope 圈选抽屉（v0.2 激活；[#138](https://github.com/he18718143986-design/IDE/pull/138)/`993e3e9`，P-148 回写） |
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
| `TASK-J.9b` | **已吸收 · 不另立卡** | `renderSchemeDiagrams`（V-07）；**已由 [`TASK-J.38d`](./development-tasks-active.md#task-j.38d) 吸收（P-246），禁双开**；从未有独立卡面 | [见 J.38d](./development-tasks-active.md#task-j.38d) |
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
| `TASK-J.16` | `COMPLETED` | 试玩幕 · 质疑自查续作：surface_log → K-14 归因账本 → K-16 trigger 闭集（立卡 P-176；P-202 J16-P5 五条 PASS；P-203 J16-P6 无封存段分支 PASS；P-204 #244 `8e98538` 官方中栏走查 J16-P7 PASS；P-205 就事论事收口标完成，estimate 仍为 L） | [正文](./development-tasks-completed.md#task-j.16) |
| `TASK-J.21` | `COMPLETED` | intent-compiler 重启后状态恢复（挂账⑫；立卡 P-187；施工 P-194 · #229 `21b8b35`） | [正文](./development-tasks-completed.md#task-j21) |
| `TASK-J.22` | `SPLIT` | 中栏方案来源统一为编译器台账（挂账⑬ 方案 B；立卡 P-187；拆卡 P-215；子卡 a/b/c 均 COMPLETED · P-229；母卡维持 SPLIT 追溯） | [正文](./development-tasks-active.md#task-j.22) |
| `TASK-J.22a` | `COMPLETED` | 中栏方案来源改为编译器台账，含无台账降级标注（拆自 J.22；立卡 P-215；修卡 P-225；施工 #279 `d5a994d`；完工回写 P-226；估算 M） | [正文](./development-tasks-completed.md#task-j.22a) |
| `TASK-J.22b` | `COMPLETED` | 中栏验收条目的条目级呈现（拆自 J.22，承接 J.16 延期项；立卡 P-215；修卡 P-227；施工 #282 `7677ca7`；完工回写 P-228；估算 M） | [正文](./development-tasks-completed.md#task-j.22b) |
| `TASK-J.22c` | `COMPLETED` | 中栏方案来源统一的真实试玩验收（拆自 J.22；立卡 P-215；真实试玩 tip `71fd5b3`；完工回写 P-229；估算 S；J22C-P1 PASS） | [正文](./development-tasks-completed.md#task-j.22c) |
| `TASK-J.23` | `COMPLETED` | 质疑自查生产链路接线：面板挂载 + DISPUTE 路由 + turn_text_sha256 落盘（立卡 P-195；修订 P-196；施工 P-198 · #233 `ab40f3a`；J23-P4 真实界面走查通过 · P-199） | [正文](./development-tasks-completed.md#task-j23) |
| `TASK-J.24` | `COMPLETED` | 开工路径三缺口：脏目录确认 + 空仓库 main 引用 + Worker provider 选择器（立卡 P-195；修订 P-197；施工 P-198 · #235 `72b52ab`；真实开工路径试玩验证通过 · P-199） | [正文](./development-tasks-completed.md#task-j24) |
| `TASK-J.25` | `COMPLETED` | 新增用户旅程与术语表（user-journey.md + glossary.md；立卡 P-206；施工 #248 `f90c881`；完工回写 P-207；估算 S） | [正文](./development-tasks-completed.md#task-j.25) |
| `TASK-J.26` | `COMPLETED` | 文档结构分家：生命周期进度迁索引、scheme 只留 L0、去掉 README 空壳与硬编码计数（立卡 P-206；施工 #251 `9852cff`；完工回写 P-208；估算 M） | [正文](./development-tasks-completed.md#task-j.26) |
| `TASK-J.27` | `COMPLETED` | 固定底线清单写入验证与验收规格，并写明 LLM 审核软层局限（立卡 P-206；施工 #249 `a96623c`；完工回写 P-207；估算 S） | [正文](./development-tasks-completed.md#task-j.27) |
| `TASK-J.28` | `COMPLETED` | 固定底线硬门禁接线：清单检查以子进程退出码进入 can_merge（立卡 P-206；施工 #254 `31c69ec`；完工回写 P-209；估算 M） | [正文](./development-tasks-completed.md#task-j.28) |
| `TASK-J.29` | `COMPLETED` | 把八项既有检查接到固定底线硬门禁（立卡 P-206；修订 P-210 缩范围；施工 #258 `fa514dc`；完工回写 P-212；估算 M） | [正文](./development-tasks-completed.md#task-j.29) |
| `TASK-J.30` | `COMPLETED` | 凭据与秘密不得进入对话的退出码检查（立卡 P-210；修订 P-211 拍板 Vault 运行时断言；修订 P-213：共享断言放 `active.ts` 叶子，接缝不直接引用 `vault.ts`；施工 #261 `27d9c41`；完工回写 P-214；估算 M） | [正文](./development-tasks-completed.md#task-j.30) |
| `TASK-J.31` | `COMPLETED` | 把试玩自查升级为非技术用户可执行的判分表（立卡 P-215；施工 #264 `03acf2a`；完工回写 P-216；估算 S） | [正文](./development-tasks-completed.md#task-j.31) |
| `TASK-J.32` | `SPLIT` | 密封前意图完整性核对：方案卡回链用户原话（立卡 P-215；修卡拆分 P-221；原估算 M，补对照面与信任档后按 R-11 拆出 J.32a / J.32b；不再作为施工依据） | [正文](./development-tasks-active.md#task-j.32) |
| `TASK-J.32a` | `COMPLETED` | 密封前原话回链内核（拆自 J.32；修卡 P-221；施工 #273 `2d48303`；完工回写 P-222；估算 M；硬依赖 J.16） | [正文](./development-tasks-completed.md#task-j.32a) |
| `TASK-J.32b` | `COMPLETED` | 回链对照面与信任档确认形态（拆自 J.32；修卡 P-221；修卡 P-223；施工 #276 `b751b4a`；完工回写 P-224；估算 M） | [正文](./development-tasks-completed.md#task-j.32b) |
| `TASK-J.33` | `COMPLETED` | 新增卡文案规范并做成机器可校验项（立卡 P-215；施工 #266 `838d1f4`；完工回写 P-217；估算 M） | [正文](./development-tasks-completed.md#task-j.33) |
| `TASK-J.34` | `COMPLETED` | 业主确认与试玩操作规程（SOP · S2→Seal + 试玩；立卡 P-230；施工 #286 `51c643e`；完工回写 P-231；估算 S） | [正文](./development-tasks-completed.md#task-j.34) |
| `TASK-J.35` | `COMPLETED` | prompt-builder.ts 对齐台账 / 信任档 / 回链事实（立卡 P-230；施工 #288 `306ff11`；完工回写 P-232；估算 M） | [正文](./development-tasks-completed.md#task-j.35) |
| `TASK-J.36` | `COMPLETED` | 信任档规格缝补丁（v1/V2 双形 + acceptance.check/notes + 五字段投影 DTO；立卡 P-233；施工 #291 `4dc5617`；完工回写 P-234；估算 S） | [正文](./development-tasks-completed.md#task-j.36) |
| `TASK-J.37` | `COMPLETED` | 细模型加层 + 视图投影规格卡（五字段映射 + RFC 附录 C 并轨 + 缺口清单；立卡 P-235；施工 #294 `2c6c7b4`；完工回写 P-236；估算 S；只定口径不实现） | [正文](./development-tasks-completed.md#task-j.37) |
| `TASK-J.38` | `COMPLETED` | 细模型加层 + 视图投影实现（拆分母卡；立卡 P-237；闭合 P-249 选 B；估算 L；子卡 A–E 全交付；**J.9b 已由 J.38d 吸收，不另立卡**） | [正文](./development-tasks-active.md#task-j.38) |
| `TASK-J.38a` | `COMPLETED` | 细模型类型 + V2 派生/回写 SSOT 纯函数（立卡 P-237；施工 #298 `8cabadc`；完工回写 P-238；估算 M） | [正文](./development-tasks-completed.md#task-j.38a) |
| `TASK-J.38b` | `COMPLETED` | 五字段投影加层接入中栏（立卡 P-239；施工 #301 `cb37efe`；完工回写 P-240；估算 S～M） | [正文](./development-tasks-completed.md#task-j.38b) |
| `TASK-J.38c` | `COMPLETED` | 附录 C 投影壳并轨（复用 C.10q 三占位；立卡 P-241；施工 #304 `d2e2b83`；完工回写 P-242；估算 M） | [正文](./development-tasks-completed.md#task-j.38c) |
| `TASK-J.38d` | `COMPLETED` | 真图渲染 `renderSchemeDiagrams`（立卡 P-246；修卡 P-247；施工 #312 `7efb1f7`；完工回写 P-248；吸收 J.9b/V-07；估算 M） | [正文](./development-tasks-completed.md#task-j.38d) |
| `TASK-J.38e` | `COMPLETED` | 测试目标建议层（ai_inferred；立卡 P-243；施工 #307 `6d7faca`；完工回写 P-244；估算 S） | [正文](./development-tasks-completed.md#task-j.38e) |
| `TASK-J.41a` | `COMPLETED` | 目标态文档治理蓝图入库（未激活存档；纯 docs；估算 S；P-250）。蓝图 Q-n 与引擎测试锚点 Q-n 编号分家，不改蓝图正文编号 | [规格](../ledger/target-doc-system-spec.md) · [压力测试索引](../ledger/target-doc-system-stress-test.md) · [对照](../ledger/target-vs-current-gap-brief.md) · [区别](../ledger/target-vs-current-analysis.md) |
| `TASK-J.41b` | `COMPLETED` | 目标态可反哺项第一批（文档口径 + 两条存证；立卡 P-251；施工 #318 `6f2ec65`；完工回写 P-252；估算 M；R18 已拍板：不反哺（P-254）；R23 未施工） | [正文](./development-tasks-completed.md#task-j.41b) |
| `TASK-J.42` | `NEW_TASK` | daemon 路由拆分第一批：合同内联段抽出（立卡 P-256；修卡 P-257；估算 M；施工 [#324](https://github.com/he18718143986-design/IDE/pull/324) 未合入；不含 Console） | [正文](./development-tasks-active.md#task-j.42) |

---

## 七环进度（自 `delivery-lifecycle.md` 迁入）

> **迁入**：2026-11-14（TASK-J.26）。下文是原七环表「现状 → 卡」列与文后「横切」进度的迁入稿。权威状态仍以卡头 / 本索引状态列 / §1.1 矩阵为准；本表只保留进度叙述，不另写一套状态。

| 环 | 进度（迁自七环表「现状 → 卡」列） |
| :--- | :--- |
| **S1 需求摄取** | 只读已实现；纯净化 → **L.1** |
| **S2 方案编译** | **J.9 COMPLETED**（#12）；**J.10 COMPLETED**（#17）；**L.6 COMPLETED**（#21 / `93589bf`）；**L.8 COMPLETED**（#33 / `fb27504`）；**L.9 COMPLETED**（#35 / `e1cf1bb`）；**L.10 COMPLETED**（#38 / `e4351b0`）；**L.11 COMPLETED**（#43 / `78ec236`）；**L.12 COMPLETED**（#47 / `39f426a`）；**L.13 COMPLETED**（#51 / `51ea872`）；L 系下一张 → **L.15** |
| **S2→Seal 意图[密封](../glossary.md#密封)** | **J.2～J.5 COMPLETED**（#4～#7）；编译生成端 **J.10 COMPLETED**（#17）；Seal 消费链齐 |
| **S3 项目架构基线** | 待施工；先于 L.7/L.8 |
| **S3 项目分解** | **L.7 COMPLETED**（#23 / `607d742`：类型/校验/落盘）；**L.8 COMPLETED**（#33 / `fb27504`：PlanPatch/分解器/API）；**L.9 COMPLETED**（#35 / `e1cf1bb`：nextStub/桩视图/互斥/回填）；**L.10 COMPLETED**（#38 / `e4351b0`：同页嵌地图 + GET plan 权威下一份） |
| **S3→合同** | **J.2～J.6 COMPLETED**（#4～#7、#11）；**J.10 COMPLETED**（#17）；**L.7 COMPLETED**（#23）；**L.8 COMPLETED**（#33 / `fb27504`）；**L.9 COMPLETED**（#35 / `e1cf1bb`：合同序列/下一份交接）；**L.10 COMPLETED**（#38 / `e4351b0`：画布同页嵌入口）；**L.11 COMPLETED**（#43 / `78ec236`）；**L.12 COMPLETED**（#47 / `39f426a`：知识库门禁）；**L.13 COMPLETED**（#51 / `51ea872`：Trailer/反查）；发布 **L.15 COMPLETED**（#52/`9829385`）；回流 **L.16 COMPLETED**（#62/`e4dfe1c`） |
| **S4 技术方案** | **L.11 COMPLETED**（#43 / `78ec236`）；**L.12 COMPLETED**（#47 / `39f426a`）；**J.19 COMPLETED**（#55 / `4bae423`：DN-2 HTTP/画布入口；DLV-6 RESOLVED）；**L.18 COMPLETED**（#54 / `c8e6a81`：系统地图 + impactClosure；DLV-5 RESOLVED） |
| **S5 施工** | 单合同已实现；验证命令进指令 → **L.2**；墓地：**J.18a～J.18d COMPLETED**（#24/#22/#26/#27 / tip `a2fa7df`；母卡 J.18 仍 `[SPLIT]`） |
| **S6 验证与验收** | 测试义务 **L.3 COMPLETED**（#15）；两段式 **L.4 COMPLETED**（#18）；真实预览 **L.5 COMPLETED**（#14）；M2 黄金切片 **L.6 COMPLETED**（#21 / `93589bf`）；知识库检查 **L.12 COMPLETED**（#47 / `39f426a`）；Trailer/反查 **L.13 COMPLETED**（#51 / `51ea872`）；发布 **L.15 COMPLETED**（#52/`9829385`）；回流 **L.16 COMPLETED**（#62/`e4dfe1c`） |
| **S7 发布与运维** | 保险库 **L.14 COMPLETED**（#31 / `ae57543`）；**发布生命周期 L.15 COMPLETED**（#52 / `9829385`）；**线上回流 L.16 COMPLETED**（#62 / `e4dfe1c`；挂账见 completed） |

**横切**（同日迁入）：追踪链 **L.13 COMPLETED**（#51 / `51ea872`）；发布 **L.15 COMPLETED**（#52 / `9829385`）；回流 **L.16 COMPLETED**（#62 / `e4dfe1c`）；北极星外网摄取与试玩 **L.17a COMPLETED**（#70/`8516c3d`）、**L.17b COMPLETED**（#72/`d26def6`）——**M5 北极星主序全部落完**（oq-2 dec-12、oq-3 dec-13 均已裁决；L.17b 未宣称端到端 UI 闭环，[挂账](../glossary.md#挂账)见 completed §3.4f；**历史 P-132** 曾立 `TASK-L.17c` `[NEW_TASK]` 未开工；**P-133** `TASK-L.17c` → `[COMPLETED]`（#104/`06661be`；UI 已挂）；**P-150** `TASK-L.17d` → `[COMPLETED]`（#145/`e2b8dd3`；挂账①销项）；**P-151** `TASK-L.17e` → `[COMPLETED]`（#147/`aeedecd`；挂账②销项）；**P-152** `TASK-L.17f` → `[COMPLETED]`（#149/`86da495`；挂账③销项；L.17c 三项挂账均已销，见 completed §3.4p / §3.4u / §3.4v / §3.4w；**仍不宣称闭环**））；**编码内核台账债受控派工 W.6 COMPLETED**（#74/`b5d8c53`，`AdapterRegistry` 挂派工工厂、缺注册/非受控显式失败，见 completed §3.4g）——主序收官后首张债卡销项，不改鉴权 / Demo Origin / Gateway 写范围。
