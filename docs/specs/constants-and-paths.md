# Stagent 常量、路径与降级边界契约

> **状态**：**`[HISTORICAL]`** — 已于 **2026-11-01**（DOC-7 · 用户拍板提前做）并入 [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) **§10**。
> **本文件不再是权威**。勿引用本文条款施工；冲突时以 runtime §10 + 代码为准。
> **完整原文**：见 Git 历史（升格前版本含 §0 代码事实快照与目标规范表；升格差异见 runtime §10.5）。

## 指针

| 主题 | 现行权威 |
| :--- | :--- |
| 运行时路径 / Worktree / seal / Trailer | [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) §10 |
| 签署前后可写边界 | 同上 §2 / §4 / §5 |
| 机器可读实现 | `daemon/git/worktree-manager.ts`、`daemon/guard/worktree-seal.ts`、`daemon/pipeline/merger.ts` |
