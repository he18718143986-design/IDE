# 怎么改文档（贡献指南）

> **来源**：自 `docs/README.md` §8 迁入（2026-11-09 文档治理，修改规则不变）。总地图见 [`README.md`](./README.md)。

## 修改规则（像 Supervisor 一样改）

| 你要做的事 | 改哪里 | 规则 |
| :--- | :--- | :--- |
| 用户说了新需求或新偏好 | `scheme.md` §0 追加原话，§1～§9 打补丁 | 只增不改原话；新条目标 `user_said` 并引 qid |
| Agent 发现原话与规格打架 | `scheme.md` §7 加冲突卡 | `chosen_id` 留空，等用户选 |
| 用户拍板了一个决定 | 新增 `adr/00NN-*.md`；`scheme.md` 把对应条目改为 `accepted` 并指向 ADR | 被取代的 ADR 标 `SUPERSEDED by`，不删 |
| 用户否决了一个方案 | `scheme.md` §10 墓地加一行 | 写清谁否决、为什么 |
| 规格条款要变 | 先立规格修订任务卡，再改 `specs/` | 实施口径不得反向改上位规格 |
| 卡做完了 | 任务卡状态回写 + `reports/` 或 PR 附证据 | 按 supervisor §10 与 [`evidence-and-acceptance-criteria.md`](./specs/evidence-and-acceptance-criteria.md) 判定，不得假 COMPLETED |
| 发现解决不了的问题 | `ledger/` 加一行 | 必须写清谁来定、判据是什么 |

## 命名与自动检查

- **文件名**：英文 kebab-case（小写 ASCII、数字与连字符；`v0.2` 类版本号可用 `.`）。`README.md`、`CONTRIBUTING.md` 为惯例大写名。
- **日期后缀**：`reports/` 下的时点快照允许 `-YYYY-MM-DD`。
- **改名或删除**：全仓引用一并更新；旧路径记入 [`ledger/removed-and-moved.md`](./ledger/removed-and-moved.md)。
- **自动检查**：`npm run check:docs`（CI 的 Docs check 同款）校验相对链接与锚点（`link-target` / `link-anchor`）、§1.1 矩阵与索引状态一致（`status-sync`）、任务卡卡头状态与依赖（`card-*`、`dep-*`）、文件名（`filename-kebab`，error）；正文里指向已删除 `docs/archive/` 的活引用报 `archive-ref`（warn，溯源语境「见 Git 历史」放行）。
