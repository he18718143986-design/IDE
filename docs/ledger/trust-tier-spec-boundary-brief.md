# 信任档规格卡 · 划界简报（P-230）

> **地位**：planning brief（2026-11-16 · Asia/Hong_Kong）。授权来源为 Tina「立 SOP 卡 + prompt-builder 对齐卡（P-230），同时做信任档规格卡划界简报」。  
> **本条只划界**：**不立卡、不施工、不改 ADR、不把蓝图原文并入 `docs/specs/`**。立卡须另授权。  
> **依据**：P-220 [`blueprint-absorption-ruling.md`](./blueprint-absorption-ruling.md) 分歧 3；P-225「信任档规格卡只补 J.32a/b 未覆盖缝」；[`TASK-J.32a`](../specs/development-tasks-completed.md#task-j.32a) / [`TASK-J.32b`](../specs/development-tasks-completed.md#task-j.32b) 已交付面；细模型简报存档（planning archive）。

## 1. 已交付（规格卡禁止重写）

下列已由 J.32a（内核）与 J.32b（对照面 UI）落地；**新规格卡不得再当未交付重写**：

| 面 | 落点 | 卡 |
| :--- | :--- | :--- |
| 三档枚举 `light` / `standard` / `reconfirm` + 中文别名 | `scheme-snapshot-store.ts`；快照 1.2 追加段 `trust_tier` 计入 digest，不升 `schema_version` | J.32a |
| 三条硬约束（缺登记不得覆盖；哈希不一致拒冻；`ai_inferred` 不得冒充已对照） | `supervisor.md`「密封前原话回链」；`evaluateSchemeItemBacklinks` | J.32a |
| 轻确认不降级机械回链 | 同左 | J.32a |
| 标准档默认出示对照；重确认逐项勾选；轻确认可跳过对照面 UI | `SchemeQuoteBacklinkBlock` + 确认前只读预览 | J.32b |
| 正式试玩证据 | `playtest-self-check.md` 试玩证据表（J.32b） | J.32b |

**禁止**：另起第二套信任档语义、另起第二套「已覆盖」可改写标记、把商业冷静期 / ChangeOrder 计价塞进本规格卡。

## 2. 仍属规格卡范围的缝（若立卡只写这些）

按 P-225 与细模型简报，**信任档规格卡只补下列缝**（均可标 `ai_inferred` 直至业主确认）：

1. **快照 v1/V2 双形缝**：冻结 `SchemeSnapshot.scheme` 仍为前端 v1 `SchemeDraft`；回链取自账本 `SchemeDraftV2`。规格须写清：对照与 digest 以哪一侧为准、双形并存时的失败语义，**不得**借机重做 J.32a 回链规则。
2. **`acceptance.check` / `notes` 类型未落地**：`supervisor.md` §14.2 有，`SchemeDraftV2` / `scheme-patch-types.ts` 尚无。规格只定字段契约与投影，不改 J.32 三条硬约束。
3. **蓝图外壳五字段**（status / scope / provenance / links / confidence）与现行 `SchemeItemMeta` 不对齐：只允许作**投影 DTO 加层**，禁止替换 `source` / `evidence`，禁止双 SSOT（对齐 P-220 分歧 2+7 与 RFC 附录 C 并轨口径；实现 L 另拆）。

**明确不进本规格卡**：

- 商业冷静期 / ChangeOrder / 责任归因（P-220「另立不决」）
- 理解度校验、「是否真懂」门禁化（J.33 已声明不是门禁）
- `prompt-builder.ts` 对齐（见 [`TASK-J.35`](../specs/development-tasks-active.md#task-j.35)）
- 业主操作规程文案（见 [`TASK-J.34`](../specs/development-tasks-completed.md#task-j.34)）
- 细模型加层 + 视图投影实现（蓝图第一批规格卡 S / 实现 L，另授权；见细模型简报）

## 3. 建议立卡形态（待 Tina 授权，本条不立）

| 建议卡号 | 估算 | 状态建议 | 一句话 |
| :--- | :--- | :--- | :--- |
| `TASK-J.36`（建议） | **S** | 待授权后立 `[NEW_TASK]` | 信任档规格缝补丁：只写 §2 三缝的契约与失败语义；`writable_paths` 限规格与类型声明，不含对照面 UI / 冻结内核重写 |

立卡时卡面必须原样写入：

- non_goals：不重写 J.32a/b 已交付硬约束与 UI；不开工商业冷静期；不立双 SSOT
- 硬依赖：`TASK-J.32a`、`TASK-J.32b`（均 COMPLETED）
- 与细模型规格卡的分界：五字段投影 DTO 可在本卡定契约，视图实现归细模型实现子卡

## 4. 结论

- **J.32a/b 已覆盖信任档工程主面**；再立「信任档规格卡」若不以 §2 三缝为界，就会与已交付内核重复。
- **P-230 本回合**：只落本简报；**不立** `TASK-J.36`；不施工。
- 蓝图「细模型加层 + 视图投影」规格卡仍暂不立（与本简报分治）。
