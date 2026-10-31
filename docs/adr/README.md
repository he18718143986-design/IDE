# Stagent 架构决策记录（ADR）

> **目录定位**：本目录是 Stagent **不可逆技术决策**的唯一权威落点。
> **为什么独立成文**：ADR 需要可被单独引用、单独 supersede、单独追踪生命周期；把它们埋在 1500 行宪法里会导致「决策已变更但正文无从体现」。
> **编号规则**：`NNNN-kebab-case-title.md`，四位数字顺序分配，**一经分配不再复用**（含已 SUPERSEDED 的编号）。
> **状态取值**：`PROPOSED` / `ACCEPTED` / `SUPERSEDED` / `DEPRECATED`。
> **版本流转**：由 Git Tag 与 commit 历史承载；文件名不含版本号。

---

## 索引

| # | 标题 | 状态 | 状态文件 |
| :--- | :--- | :--- | :--- |
| 0001 | [目标用户定位演进与分层适配](./0001-target-user-positioning.md) | ACCEPTED | — |
| 0002 | [单工作区互斥执行与包管理器缓存隔离](./0002-single-workspace-mutex.md) | ACCEPTED | — |
| 0003 | [诚实承认 Worktree 的能力边界](./0003-worktree-capability-boundary.md) | ACCEPTED | — |
| 0004 | [不可绕过的三维预算熔断](./0004-three-dimension-budget-fuse.md) | ACCEPTED | — |
| 0005 | [确定性验证门禁与 Evidence 绑定候选 SHA](./0005-deterministic-verification-gate.md) | ACCEPTED | — |
| 0006 | [本地优先与非防篡改声明](./0006-local-first-no-tamper-proof.md) | ACCEPTED | — |
| 0007 | [双 Agent 分权与 Daemon 单一权威](./0007-dual-agent-daemon-authority.md) | ACCEPTED | — |
| 0008 | [Demo 原型预览服务独立 Origin 与 iframe sandbox 隔离架构](./0008-demo-isolated-origin.md) | ACCEPTED | — |
| 0009 | [任务 Graph 串行拓扑与变更指纹点亮机制](./0009-serial-graph-fingerprint.md) | ACCEPTED | — |
| 0010 | [Demo 降为体验增强项：允许跳过 Demo 直签合同](./0010-demo-optional-not-hard-gate.md) | ACCEPTED | 核心资产治理 §二.3-2 / DocGov §3.1 / Workflow §1.1 |
| 0011 | [无 Git 审计侧车统一落点 `.stagent/records/{contract_id}/`](./0011-audit-sidecar-records-path.md) | ACCEPTED | Top7 §7 `.stagent/metadata/` |
| 0012 | [`MERGED` 为唯一运行时交付终态](./0012-merged-as-terminal-state.md) | ACCEPTED | Spec Freeze §2.1 / DocGov §3.1 的 `DELIVERED` |
| 0013 | [Claude Code 隔离弃用 `--bare`，改用 `--setting-sources ""`](./0013-cli-isolation-without-bare.md) | ACCEPTED | W.5a 早期 `--bare` 方案 |
| 0014 | [三 Agent 拓扑与中栏意图编译组件化（形态开放）](./0014-three-agent-topology-open-supervisor.md) | ACCEPTED | conf-1/conf-5/conf-6 用户裁决（q12～q16） |
| 0015 | [合同是最小可验收交付单元；项目 → 里程碑 → 合同 → 节点](./0015-contract-as-unit-of-delivery.md) | ACCEPTED（随 PR 合入生效） | 目标能力 q18 |
| 0016 | [目标项目系统知识库随代码入库](./0016-system-knowledge-base-in-repo.md) | ACCEPTED（随 PR 合入生效） | 目标能力 q19 |
| 0017 | [发布是合并之后的独立生命周期](./0017-release-lifecycle-after-merge.md) | ACCEPTED（随 PR 合入生效） | 目标能力 q17 |
| 0018 | [意图→可签执行物唯一真相缝](./0018-intent-to-executable-seal.md) | PROPOSED（随 PR 合入生效） | 目标能力 q1/q17～q21；审计「方案→合同」断链；绝对唯一榜首 |
| 0019 | [项目级架构基线先于大型项目分解与合同施工](./0019-project-architecture-baseline.md) | PROPOSED（随 PR 合入生效） | 密封之后的下一步；目标能力 q18～q20；审计 S3/S4 |

---

## 0001–0009 的来源说明

ADR-0001～0009 原内嵌于《系统架构设计规范》§8。2026-10-27 文档治理重组时原样抽出，**未改写任何条文**，仅在每篇补 `背景 / 决策 / 后果` 三段式结构与交叉指针。

架构规范 `§8` 现已收敛为指向本目录的指针，不再重复存放决策正文。

---

## 引用纪律

1. **写代码时**：若要改动受 ADR 约束的行为，先立规范修订任务卡，再决定是否 SUPERSEDE 该 ADR。
2. **SUPERSEDE 必须留痕**：被取代的 ADR **不得删除**，须在文件头标注 `SUPERSEDED by ADR-XXXX`，并保留原文。
3. **决策 ≠ 已实现**：ADR 记录「我们已经拍板这样做」，**不证明**代码已落地。是否实现以《研发任务规范》任务卡状态与测试为准。
