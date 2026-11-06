# 0001 本仓自举 ADR-0016 的系统知识库

- **状态**：ACCEPTED
- **日期**：2026-11-06
- **依据**：ADR-0016（目标项目的系统知识库随代码入库）、用户授权拍板 q22

## 背景

ADR-0016 要求 Stagent 为用户造的项目维护 `docs/system/`，并由 `stagent check knowledge` 的 KB-1～KB-5 做确定性校验。但 Stagent 自己的仓库只有手写的 `docs/`（ADR、规格、任务卡），没有模块地图，也没有随合同同步的知识库。结果是：给用户规定的机制，自己没在用；模块边界只存在于人的记忆和零散的规格段落里。

## 决策

1. 本仓启用与目标项目相同的结构：`docs/system/overview.md`、`modules.yaml`、`changelog.md`、`decisions/`、`interfaces/`。
2. 模块划分以顶层源码目录为骨架（`bin` / `daemon` / `src`），测试、脚本与根级构建配置各自成模块；`depends_on` 只保留单向依赖，避免 `src ↔ daemon` 的环（共享类型归 `src`，`daemon` 单向依赖 `src`）。
3. 用 `stagent check knowledge --all --contract-id repo-knowledge-baseline` 做仓库级自检，接入 `npm run check:knowledge` 与 CI。合同流程仍按 ADR-0016 的 diff 口径检查每份合同。
4. 本仓不使用合同开发自己，因此 KB-2 的「本合同条目」由 `repo-knowledge-baseline` 这条基线记录承担；后续如改为合同驱动，再按合同号逐条追加。

## 后果

**正面**：新增或移动源码文件时，如果没落进任何模块路径，门禁会直接报出来；模块依赖关系有了机器可读版本，架构雷达与知识库不再是两套事实。

**代价**：多一道 CI 检查；每次改动顶层目录结构都要同步 `modules.yaml`；`--all` 模式只覆盖源码扩展名，纯配置/文档改动仍靠 `check:docs` 与人工评审。

## 被否决的备选

- **只写进现有 specs/**：无法被 `stagent check knowledge` 读取，等于继续靠人工维护。
- **把模块地图生成到 `.stagent/`**：不入库、换机即丢，与 ADR-0016 决策 2 冲突。
- **保留 `src ↔ daemon` 双向依赖**：KB-4 会判定 `depends_on` 成环，无法通过 Schema 门禁。
