# 怎么改文档（贡献指南）

> **来源**：自 `docs/README.md` §8 迁入（2026-11-09 文档治理，修改规则不变）。总地图见 [`README.md`](./README.md)。

## 修改规则（像 Supervisor 一样改）

| 你要做的事 | 改哪里 | 规则 |
| :

## 命名与自动检查

- **文件名**：英文 kebab-case（小写 ASCII、数字与连字符；`v0.2` 类版本号可用 `.`）。`README.md`、`CONTRIBUTING.md` 为惯例大写名。
- **日期后缀**：`reports/` 下的时点快照允许 `-YYYY-MM-DD`。
- **改名或删除**：全仓引用一并更新；旧路径记入 [`ledger/removed-and-moved.md`](./ledger/removed-and-moved.md)。
- **自动检查**：`npm run check:docs`（CI 的 Docs check 同款）校验相对链接与锚点（`link-target` / `link-anchor`）、§1.1 矩阵与索引状态一致（`status-sync`）、任务卡卡头状态与依赖（`card-*`、`dep-*`）、文件名（`filename-kebab`，error）；正文里指向已删除 `docs/archive/` 的活引用报 `archive-ref`（warn，溯源语境「见 Git 历史」放行）。
