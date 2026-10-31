# Stagent 合同状态机硬契约

> **状态**：**`[HISTORICAL]`** — 已于 **2026-11-01**（DOC-7 · 用户拍板提前做）并入 [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) **§11**。
> **本文件不再是权威**。勿引用本文条款施工；冲突时以 runtime §11 + `src/lib/state-machine.ts` 为准。
> **完整原文**：见 Git 历史（升格前版本含目标迁移叙事与 Negative Tests 清单；升格差异见 runtime §11.4）。

## 指针

| 主题 | 现行权威 |
| :--- | :--- |
| 两轨关系（lifecycle vs 交付投影） | [`runtime-contract-and-safety.md`](./runtime-contract-and-safety.md) §11.1；[ADR-0012](../adr/0012-merged-as-terminal-state.md) |
| 迁移表 / 终态 | 同上 §11.2–§11.3；`src/lib/state-machine.ts`（`LIFECYCLE_TRANSITIONS`） |
| 交付投影 `DELIVERED` | `src/lib/state/delivery-state.ts`、`terminal-delivery-closure.ts` |
