# 细模型加层 + 视图投影 · 实现拆分简报（R-11）

> **地位**：planning brief（2026-11-17 · Asia/Hong_Kong）。授权来源为 Tina「J.37 关闭后出实现拆分简报」。  
> **本条只读拆分建议**：过目后逐张立卡；**不施工、不改 ADR、不改产品代码**。  
> **立卡进度（P-237）**：母卡 [`TASK-J.38`](../specs/development-tasks-active.md#task-j.38) `[SPLIT]`；首张 [`TASK-J.38a`](../specs/development-tasks-active.md#task-j.38a) `[NEW_TASK]`；B–E 仍待立卡。  
> **前置**：[`TASK-J.37`](../specs/development-tasks-completed.md#task-j.37) 规格口径已 COMPLETED（#294/`2c6c7b4`；P-236）。  
> **依据**：P-220 [`blueprint-absorption-ruling.md`](./blueprint-absorption-ruling.md) 分歧 2+7；[`blueprint-fine-layer-spec-brief.md`](./blueprint-fine-layer-spec-brief.md)；[`../specs/supervisor.md`](../specs/supervisor.md)「细模型加层 + 视图投影」；[`TASK-C.10q`](../specs/development-tasks-completed.md#task-c.10q) / RFC 附录 C；[`TASK-J.36`](../specs/development-tasks-completed.md#task-j.36) 已交付三缝。

## 0. 为何拆（R-11）

整包「细模型加层 + 视图投影实现」估算 **L**。按 R-11 拆成可独立验收的子卡，避免单卡同时改类型面、中栏投影、全景真图与测试建议层。

**硬边界（所有子卡共用）**：

- 禁止双 SSOT；`SchemeDraftV2` 唯一可签执行层
- 禁止替换 / 覆写 `source` / `evidence`
- 吸收内容标 `ai_inferred`，不得冒充 `user_said`
- **不重开** J.36：v1/V2 双形、`acceptance.check`/`notes`、`SchemeItemProjectionDto` 只引用
- 不把蓝图原文并入 `docs/specs/`
- ChangeOrder / 冷静期 **另立不决**；活发送路径接线 **暂不立**；§3.3 本版不实现

## 1. 对齐点（必写入各子卡 non_goals / code_facts）

### 1.1 快照 v1/V2 双形缝（J.36 已交付）

| 面 | 权威 | 实现子卡须遵守 |
| :--- | :--- | :--- |
| 快照内 `scheme` | 前端 v1 `SchemeDraft` | 展示 / 旧路径；**不得**为「消双形」升格 v1→V2 或整树塞进快照 |
| 回链 / 账本 | `SchemeDraftV2` | 细模型派生与视图投影**以 V2 为输入**；不一致以 V2/SSOT 为准 |
| digest / 密封 | 整份快照（含既有段） | 投影字段**不得**写入冻结快照作密封权威 |

规格指针：`supervisor.md`「快照 v1/V2 双形缝」「细模型加层 + 视图投影」。

### 1.2 TASK-C.10q 遗留债 + RFC 附录 C

| 已有 | 未有 | 实现对齐 |
| :--- | :--- | :--- |
| `StudioLensShell` / `PanoramaPane` 双视角壳；三张**占位**卡；改名消歧义 | 三张真全景图（业务功能脑图 / 用户旅程泳道 / 业务概念图） | **优先复用**附录 C 锚定与 C.10q 壳；**不得另起第二套视图体系** |
| 全景禁止施工绿灯 | `renderSchemeDiagrams`（J.9b / V-07）未交付 | 真图卡可硬依赖或并序 J.9b；空态 / 占位合法，不得假绿 |

规格指针：`docs/rfc/v0.2-multi-agent-pipeline.md` 附录 C；`supervisor.md`「视图投影与 RFC 附录 C 并轨」。

## 2. 建议子卡（编号待立卡时拍板；下表为建议号）

依赖顺序：**A → B**；**A → C**（C 可与 B 并行若类型面已合）；**C → D**（真图建议在投影壳稳定后）；**E** 可后置、软依赖 A。

```
A 细模型类型+派生 ──┬──► B 五字段中栏投影
                   └──► C 附录 C 投影壳 ──► D 真图/renderSchemeDiagrams
A ──（软）──► E 测试目标建议层
```

### A · 细模型可选加层：类型与 SSOT 派生/回写

| 项 | 建议 |
| :--- | :--- |
| 建议号 | `TASK-J.38a`（或立卡时统一编号） |
| 估算初判 | **M** |
| 范围 | Actor / UseCase / Process / Rule / Screen / AC 的**类型声明**与「从 `SchemeDraftV2` 派生 / 回写 SSOT」纯函数；不一致以 SSOT 为准并标投影版本；默认 `ai_inferred` |
| 不含 | UI；附录 C 真图；五字段中栏绘制；ChangeOrder；活发送 |
| `writable_paths`（示意） | `src/lib/journey/scheme-patch-types.ts`（或新建 `fine-model-types.ts` 并由 patch-types 再导出）；新建 `src/lib/journey/fine-model-derive.ts`（名可议）；对应 `tests/unit/*` |
| 硬依赖 | `TASK-J.37` COMPLETED；`TASK-J.36` COMPLETED（只读复用 DTO / V2） |
| 对齐 | 不重开 v1/V2 双形；派生输入用 V2；不得平行持久化第二套方案 |

### B · 五字段投影加层接入中栏

| 项 | 建议 |
| :--- | :--- |
| 建议号 | `TASK-J.38b` |
| 估算初判 | **S～M** |
| 范围 | 消费已有 `SchemeItemProjectionDto`：条目级展示 `status` / `scope` / `provenance` / `links` / `confidence`；只读投影；缺省/非法枚举按 J.37 失败语义丢弃字段、不改 `source` |
| 不含 | 细模型六实体实现（归 A）；真全景图（归 C/D）；§3.3 自动点亮 |
| `writable_paths`（示意） | `src/lib/journey/scheme-midpane-projection.ts`（或等价投影层）；中栏呈现组件（如 `ScopeAcceptanceBlock.tsx` / 相关 Studio 块，立卡前再核对行号）；对应 UI/unit 测 |
| 硬依赖 | `TASK-J.37`；建议硬依赖 **A**（若投影需加层字段）或软依赖 A（若首期仅五字段、不加细模型实体） |
| 对齐 | 复用 J.22a 中栏只读通路；禁止投影写入快照密封权威 |

### C · 附录 C 投影壳并轨（占位 → 可挂真图）

| 项 | 建议 |
| :--- | :--- |
| 建议号 | `TASK-J.38c` |
| 估算初判 | **M** |
| 范围 | 在 C.10q `PanoramaPane` 三占位上挂「附录 C 三卡」投影契约：数据源声明、空态、与 SSOT 不一致时以 SSOT 为准；**仍可不交付真渲染** |
| 不含 | mermaid/结构真渲染（归 D）；另起第二套全景路由；假绿 |
| `writable_paths`（示意） | `src/components/studio/PanoramaPane.tsx`；`src/lib/studio/lens-routing.ts`（若需）；新建 `src/lib/studio/panorama-projection.ts`（名可议）；对应测 |
| 硬依赖 | `TASK-C.10q` COMPLETED；`TASK-J.37`；建议软/硬依赖 **A**（有加层才有丰富投影源） |
| 对齐 | **不得另起第二套视图体系**；全景进度不得冒充施工点亮 |

### D · 真图渲染（`renderSchemeDiagrams` / 附录 C 真内容）

| 项 | 建议 |
| :--- | :--- |
| 建议号 | `TASK-J.38d`（可与历史 **J.9b** 合并立项或硬依赖 J.9b，立卡时二选一，禁止双开同范围） |
| 估算初判 | **M** |
| 范围 | 由 SSOT / 细模型**确定性**生成可展示图（业务功能脑图 / 旅程泳道 / 概念图，或 supervisor 既有三 mermaid 目标）；挂到 C 的投影壳 |
| 不含 | 可独立编辑的图存储；图上批注直写旁路 SSOT（批注须回写 SSOT 后重投影） |
| `writable_paths`（示意） | 新建 `src/lib/journey/render-scheme-diagrams.ts`（或等价）；`PanoramaPane` / 中栏图位接线；对应测 |
| 硬依赖 | **C**；`TASK-J.37`；建议硬依赖 **A** |
| 对齐 | J.9b / V-07 债；双形缝：渲染输入用 V2，不得为渲染改写快照 v1 权威 |

### E · 测试目标自生成（建议层）

| 项 | 建议 |
| :--- | :--- |
| 建议号 | `TASK-J.38e` |
| 估算初判 | **S** |
| 范围 | 由加层/投影**建议**测试目标；一律 `ai_inferred`；缺省 = 不生成；**不得**自动写入硬门禁或冒充用户验收 |
| 不含 | `can_merge` / 底线硬门禁改写；ChangeOrder |
| `writable_paths`（示意） | 建议层纯函数 + 可选中栏「建议」展示块；对应测 |
| 硬依赖 | `TASK-J.37`；软依赖 **A** |
| 对齐 | J.37 缺口表「测试目标自生成仍开」失败/缺省语义 |

## 3. 明确不进本拆分

| 项 | 处置 |
| :--- | :--- |
| ChangeOrder / 冷静期 / 责任归因 | 另立不决（商业层） |
| 活发送路径接线 | 暂不立（见 [`prompt-builder-live-send-path-brief.md`](./prompt-builder-live-send-path-brief.md)） |
| §3.3 自动点亮 | 本版不实现 |
| 信任档三缝重开 | 禁止（J.36 COMPLETED） |
| CI.2 / 文档计划 | 攒样本 / 暂缓 |

## 4. 立卡前核对清单（过目用）

1. 是否采纳建议号 `J.38a–e`，或改用其他编号族  
2. B 对 A：硬依赖还是「首期仅五字段」软依赖  
3. D 与历史 `TASK-J.9b`：合并 vs 硬依赖（禁止范围重叠双卡）  
4. 各卡 `writable_paths` 施工前再核现行行号（中栏组件可能漂移）  
5. 首张授权开工顺序建议：**A → B**，并行准备 **C**

## 5. 结论

- J.37 规格已关闭；本简报把实现 L 拆为 **A–E** 五张建议子卡（估算合计仍覆盖原 L，单卡均 ≤M）。  
- **不立卡**；Tina 过目并逐张授权后再立。  
- 活发送 / §3.3 / CI.2 / 文档计划口径不变。
