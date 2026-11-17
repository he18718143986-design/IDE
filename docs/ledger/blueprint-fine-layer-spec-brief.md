# 细模型加层 + 视图投影 · 规格简报（P-235）

> **地位**：planning brief（2026-11-17 · Asia/Hong_Kong）。授权来源为 Tina「立蓝图第一批主体卡（P-235）」；施工 #294 / 完工回写 P-236。  
> **本条只定规格指针**：**不实现 UI / 细模型运行时、不改 ADR、不把蓝图原文并入 `docs/specs/`**。  
> **卡**：[`TASK-J.37`](../specs/development-tasks-completed.md#task-j.37)（`[COMPLETED]`，估算 S；施工 #294/`2c6c7b4`）。  
> **依据**：P-220 [`blueprint-absorption-ruling.md`](./blueprint-absorption-ruling.md) 分歧 2+7；细模型简报存档（P-225）；[`TASK-J.36`](../specs/development-tasks-completed.md#task-j.36) 已补信任档三缝。

## 1. 规格卡范围（只定口径）

| 面 | 口径 | 说明 |
| :--- | :--- | :--- |
| 五字段外壳 | `status` / `scope` / `provenance` / `links` / `confidence` | 与 `SchemeDraftV2` / `SchemeItemMeta` 映射为**投影加层**；复用 J.36 `SchemeItemProjectionDto`；**禁止**替换 `source` / `evidence` |
| 细模型加层 | Actor / UseCase / Process / Rule / Screen / AC | 可选加层 / 投影源；须从 SSOT 派生或回写 SSOT；不一致以 SSOT 为准；**禁止双 SSOT** |
| 视图投影 | 流程图 / 时序故事 / 规则卡 / 范围对照等 | 不单独存储、不可独立编辑；图上批注回写 SSOT 后重新投影 |
| RFC 附录 C 并轨 | 业务功能脑图 / 用户旅程泳道 / 业务概念图 | 对齐 [`TASK-C.10q`](../specs/development-tasks-completed.md#task-c.10q) 遗留债与 [`../rfc/v0.2-multi-agent-pipeline.md`](../rfc/v0.2-multi-agent-pipeline.md) 附录 C；**不得另起第二套视图体系** |
| 吸收标记 | 一律 `ai_inferred` | 规格落地前不得冒充 `user_said` |

## 2. 已知缺口清单（核对 J.36 后）

| # | 缺口 | 状态（对本卡） |
| :--- | :--- | :--- |
| 1 | 快照 v1/V2 双形缝 | **已由 J.36 交付**（契约 + 失败语义）— 本卡只记指针，不重开 |
| 2 | `acceptance.check` / `notes` | **已由 J.36 交付**（类型 + 契约）— 本卡只记指针，不重开 |
| 3 | 五字段投影 DTO 类型契约 | **已由 J.36 交付**（`SchemeItemProjectionDto`）— 本卡在其上定**细模型/视图映射口径** |
| 4 | 蓝图评审：quote 无哈希 | **已有**（J.32a `frozen_quotes` / 回链哈希）— 吸收时补齐非照抄；本卡不重做 |
| 5 | 蓝图评审：无确认快照实体 | **已有**（密封快照 / digest）— 同上 |
| 6 | 蓝图评审：deprecated 无墓地语义 | **已有**（墓地 / reject 链）— 同上 |
| 7 | 蓝图评审：缺 ChangeOrder | **另立不决**（商业层；冷静期/计价/责任归因同） |
| 8 | 蓝图评审：测试目标自生成 | **仍开** — 规格须写清「补齐而非照抄」的失败/缺省语义；实现归后续卡 |
| 9 | `renderSchemeDiagrams`（J.9b / V-07） | **未交付** — 实现面，不进本 S 规格卡正文交付 |

## 3. 与实现分界（R-11）

| 交付物 | 估算 | 卡 |
| :--- | :--- | :--- |
| 规格（口径 + 附录 C 并轨 + 缺口清单） | **S** | [`TASK-J.37`](../specs/development-tasks-completed.md#task-j.37) **COMPLETED**（本简报） |
| 实现（细模型加层 + 视图投影全套） | **L** | **未立**；拆分建议见 [`blueprint-fine-layer-impl-split-brief.md`](./blueprint-fine-layer-impl-split-brief.md)（过目后再逐张立卡） |

## 4. 分治

- 信任档三缝：[`trust-tier-spec-boundary-brief.md`](./trust-tier-spec-boundary-brief.md) / J.36 **COMPLETED** — 与本卡分治。
- 活发送路径：[`prompt-builder-live-send-path-brief.md`](./prompt-builder-live-send-path-brief.md) — **暂不立**接线卡。
- §3.3 自动点亮：本版不实现；CI.2 攒样本；文档计划暂缓。

## 5. 施工落点指针（J.37）

- 契约与映射：[`../specs/supervisor.md`](../specs/supervisor.md)「细模型加层 + 视图投影（TASK-J.37）」——五字段映射表、细模型可选加层、附录 C 并轨、剩余缺口失败/缺省语义
- J.36 已交付指针（只引用不重开）：同文件「快照 v1/V2 双形缝」「`acceptance.check` / `notes` 字段契约」「条目投影五字段 DTO」；类型面 `src/lib/journey/scheme-patch-types.ts`（`SchemeItemProjectionDto` 等）
- 裁决与附录：[`blueprint-absorption-ruling.md`](./blueprint-absorption-ruling.md) 分歧 2+7；[`../rfc/v0.2-multi-agent-pipeline.md`](../rfc/v0.2-multi-agent-pipeline.md) 附录 C

## 6. 结论

- **P-235**：已立 `TASK-J.37`；只定口径；**不开工实现**。
- **J.37**：已 COMPLETED（#294/`2c6c7b4`；P-236）；规格正文已写入 `supervisor.md`；诚实口径：口径已交付，实现未做（L 按 R-11 后拆另立）、ChangeOrder/冷静期另立不决。
- 实现 L：拆分简报见 [`blueprint-fine-layer-impl-split-brief.md`](./blueprint-fine-layer-impl-split-brief.md)；过目后再逐张立卡。活发送接线仍待另授权。
