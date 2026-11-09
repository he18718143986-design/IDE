# 已删除与已移动的文档（历史索引）

> **来源**：自原 `docs/README.md` §9 迁入（2026-11-09 文档治理）。勿再引用下列旧路径；查历史用 `git log --diff-filter=D -- docs/`。

## 2026-11-09 文档治理

- `specs/constants-and-paths.md`、`specs/state-machine-contract.md`：两份 `[HISTORICAL]` 指针桩已删除；内容于 2026-11-01（DOC-7）并入 [`../specs/runtime-contract-and-safety.md`](../specs/runtime-contract-and-safety.md) §10 / §11。
- `reports/完整诊断修订纪要-2026-10-31.md` → `reports/full-diagnosis-revision-notes-2026-10-31.md`
- `reports/J1-partner-cli-verification-2026-10-28.md` → `reports/j1-partner-cli-verification-2026-10-28.md`
- `reports/W5c-iii-真实容器实测-2026-11-02.md` → `reports/w5c-iii-real-container-test-2026-11-02.md`
- `development-tasks.md` 文件头部内联的 P-43～P-66 修订流水：迁至 [`development-tasks-changelog.md`](../specs/development-tasks-changelog.md) 末节（P-45 与既有条目重复，只保留一份）。


**2026-10-29 移动**：

- `specs/consistency-audit.md` → [`consistency-audit.md`](./consistency-audit.md)（台账不是规格）
- `backlog/` → [`ledger/`](./README.md)（含 `w3-known-gaps.md`）

**更早删除**（原文查 `git log --diff-filter=D -- docs/`）：

- `docs/archive/` 整个目录（含 `supervisor-pre-ssot/`、`claude-code-isolation-design.md` 等过程稿），2026-10-27 已移除
- `docs/reports/v0.1-dogfooding-report.md`、`phase-checklist-M1.md` … `M8.md`、`工作台交互走查-2026-10-24.md`、`W5a-真实CLI验证报告-2026-10-21.md`、`stagent-task-flow-and-comparison.md`、5 份 Supervisor stub 短桩，2026-10-25～27 删除
- `docs/tasks/TASK-C.21-未闭环收尾-cursor-brief.md`（一次性执行指令）
