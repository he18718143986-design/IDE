# 变更日志

每份合同合入前必须追加一条，标题固定为 `## <合同号>`（Daemon 的 KB-2 按这个标题判定本合同是否同步了知识库）。一条记录只写「变了什么、为什么、影响谁」，过程细节留在 PR 与提交里。

## repo-knowledge-baseline

- **日期**：2026-11-06
- **合同**：`repo-knowledge-baseline`（本仓自举，无外部合同）
- **方案条目**：ADR-0016 决策 1～4
- **变了什么**：本仓按 ADR-0016 建起 `docs/system/`：`overview.md` 一页纸、`modules.yaml` 模块地图、本变更日志、`decisions/` 决策记录与 `interfaces/` 接口登记。
- **为什么**：ADR-0016 给目标项目规定了随代码入库的知识库与 `KNOWLEDGE_DRIFT` 门禁，但 Stagent 自己的仓库一直没有 `docs/system/`，等于「规定的机制自己不用」。自举之后，本仓的模块边界与改动归属由机器核对，不再只靠人记。
- **影响谁**：后续每张卡的写范围需要覆盖 `docs/system/**`（或由设计步骤在签署前并入），否则知识库会随代码漂移；`npm run check:knowledge` 与 CI 的 `Knowledge check` job 会在漂移时报 `KNOWLEDGE_DRIFT`。
- **相关**：[`../adr/0016-system-knowledge-base-in-repo.md`](../adr/0016-system-knowledge-base-in-repo.md)、[`./overview.md`](./overview.md)、[`./modules.yaml`](./modules.yaml)、[`./decisions/0001-adopt-knowledge-base-for-this-repo.md`](./decisions/0001-adopt-knowledge-base-for-this-repo.md)

## 追加约定

1. 标题只写合同号，不加日期或标题文案，保证 KB-2 的正则可匹配。
2. 新增跨模块依赖时，同一条记录里写明对应 `decisions/NNNN-*.md` 的文件名。
3. 新增跨模块接口时，同一条记录里写明 `interfaces/<module>.md` 的更新位置。
4. 已被取代的记录不删除，由后续记录说明取代关系（与 ADR 的 SUPERSEDE 口径一致）。
