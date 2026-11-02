# docs/reports · 历史签收与时点审计

> **更新日期**：2026-11-02（Asia/Hong_Kong）· 新增 W.5c-iii 真实容器实测证据
> **本目录不作现行施工依据**——造 Stagent 只认 [`../specs/`](../specs/) 四件套 + [`../adr/`](../adr/)。地图见 [`../README.md`](../README.md)。
> **本目录两类材料**：① **签收凭据**（封版 / Sign-off / 硬化收官）；② **时点审计快照**（某日基线上的核查，结论会过期，不得直接用于今日排期）。

---

## A. 签收凭据（Sign-off）

| 文件 | 定位 | 说明 |
| :--- | :--- | :--- |
| [`spec-freeze-record.md`](./spec-freeze-record.md) | **Spec Freeze 封版索引** | 全局多主题封版锚点（CLOSED 五正文 + 右栏；**CLOSED ≠ 免体验**）。Supervisor 现行权威为 [`../specs/supervisor.md`](../specs/supervisor.md)；本记录保留为封版历史索引。 |
| [`v0.1-mainline-milestone.md`](./v0.1-mainline-milestone.md) | **v0.1 主路径 Sign-off** | 主路径**可签收**；**不是**全功能完成，不是全卡全绿。 |
| [`v0.1-hardening-closure.md`](./v0.1-hardening-closure.md) | **v0.1 硬化收官** | H.1–H.8 落地；Tag **`v0.1.0`**；终态口径锁定为 `MERGED`（见 [ADR-0012](../adr/0012-merged-as-terminal-state.md)）。 |

## B. 时点审计快照（Audit · 不代表当前排期）

| 文件 | 定位 | 说明 |
| :--- | :--- | :--- |
| [`dor-readiness-audit-2026-10-31.md`](./dor-readiness-audit-2026-10-31.md) | **DoR 全量审计** | 基线 `main` @ `a2fa7df`（2026-10-31）。**快照**：矩阵/卡状态此后已有多轮回写（含 L.8～L.10），不得当作今日开工清单。 |
| [`delivery-path-audit.md`](./delivery-path-audit.md) | **交付全链路审计** | 2026-10-30 七环核查与补全清单；后续以任务卡与 tip 为准。 |
| [`完整诊断修订纪要-2026-10-31.md`](./完整诊断修订纪要-2026-10-31.md) | **完整诊断十四定型** | 产品+交付诊断落盘（确认开工/D9/Canvas/JourneyStage/等待态等）；仅文档；多数结论已吸入 `supervisor` / ADR。 |
| [`J1-partner-cli-verification-2026-10-28.md`](./J1-partner-cli-verification-2026-10-28.md) | **J.1 真实 CLI 验证** | 右栏只读搭档实测报告；会话附件目录 [`j1-cli-session-2026-10-28/`](./j1-cli-session-2026-10-28/)。 |
| [`W5c-iii-真实容器实测-2026-11-02.md`](./W5c-iii-真实容器实测-2026-11-02.md) | **W.5c-iii 容器隔离实测** | Docker 29.6.1 + OpenHands 0.59.0（摘要固定）真实容器负例；**施工期证据**，仅声称「通过已知探测集」，不宣称端到端闭环、不宣称「绝对受控」。 |

---

## 推荐阅读顺序（新同学/新会话）

1. [`../README.md`](../README.md) — 全局地图与三条铁律
2. [`../specs/system-architecture.md`](../specs/system-architecture.md) §0 — 产品定义与八步旅程
3. [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md) — 运行时硬契约（**写代码前必读**）
4. [`../specs/supervisor.md`](../specs/supervisor.md) — Supervisor 产品与监理语义
5. [`../specs/development-tasks.md`](../specs/development-tasks.md) — 该改哪张卡
6. 本目录「签收凭据」三份 — 历史签收口径；审计快照仅在需要溯源时查阅

---

## 已移出本目录（2026-10-27）

设计说明、讨论稿、拍板纪要、过程验收稿全部移出本目录（原 `../archive/`，该目录随后整体移除）；非技术旅程验收稿按裁决 D-6 降为过程稿。现行落点见 [`../README.md`](../README.md)：设计决策看 `../adr/`、未实现提案看 `../rfc/`、施工依据看 `../specs/`。原文见 Git 历史。

## 已删除（勿再引用）

`v0.1-dogfooding-report.md`、`phase-checklist-M1.md`…`M8.md`、`工作台交互走查-2026-10-24.md`、`W5a-真实CLI验证报告-2026-10-21.md`、`stagent-task-flow-and-comparison.md`，以及 5 份 Supervisor stub 短桩。需要时查 Git 历史。

## 反虚构提醒

**仓库中不存在**《产品体验与技术底座设计规范 v1.1》。任何文档或代码注释都不得再引用该路径为正式规范。
