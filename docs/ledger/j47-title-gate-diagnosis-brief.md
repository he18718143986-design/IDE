# TASK-J.47 · 确认门禁标题不足：诊断与施工方案

> **地位**：planning brief（诊断记录）。施工已由 [`TASK-J.47`](../specs/development-tasks-completed.md#task-j.47) COMPLETED（#342/`1dfac26`，P-269）交付。J47-P4 手工 debt 未销：真钥匙看按钮可点待实测，未点未冻结。  
> **基线**：main `2166adc1652692402bd174abf71e08a202484180`（P-267）。  
> **试玩目录**：`/Users/tina/Downloads/stagent-j45-key-playtest`。  
> **不改产品代码**（本文件仅诊断与方案）。

---

## 1. 诊断结论（已核对台账，非猜测）

| 观测 | 值 |
| :--- | :--- |
| `active.json` → `state.draft.title` | `""`（长度 0） |
| `active.json` → `state.draft.summary` | `""`（长度 0） |
| `modules` | 1：`ITEM-1` / name=`登录页` / `source=user_said` |
| `last_journal.verdicts` | **仅 1 条**：`op_kind=upsert_module`，`target_id=ITEM-1`，`verdict=APPLY` |
| `GET /api/supervisor/scheme-midpane` | `available=true`，`title=""`，`summary=""`，`modules_len=1` |
| 浏览器 `scheme-confirm` | 存在且 **disabled**；挡句：`方案摘要不足，至少需要可读标题与摘要/模块` |

**根因分类：模型输出缺标题，不是组装/投影丢字段。**

依据：

1. 台账与 midpane 标题同为空 → 投影未单独吞掉标题。  
2. 本批 journal 无 `set_title` / `set_summary` → 引擎未收到标题补丁，谈不上映射丢失。  
3. 门禁 `isReviewableScheme`（`scheme-draft.ts` L524–528）要求 `title.trim().length >= 2`，且 `(summary≥8 || modules≥1)`。本次 **模块=1 已满足第二项，卡在第一项标题**。读字段正确；**不改阈值**。

浏览器挡句与 `evaluateSchemeConfirmation` L638–639 在 `!isReviewableScheme` 时推入的 reason 文案一致。

---

## 2. 施工方案（立卡后待授权再动代码）

**选定主路径（ai_inferred · 可靠兜底）**：在生成端组装收口补 `set_title`，不放宽门禁。

1. **组装兜底**（主交付）：在 `assembleCompilerOutput` 成功组装出 `ops` 之后、返回 patch 之前：  
   - 若本批 `ops` **已有** `set_title` → 不动；  
   - 若无 `set_title`，且存在本批 `upsert_module` 且其 `item.name.trim().length >= 2` → 注入一条 `set_title`，`value` 取该模块名（截断至 schema 上限），`evidence` 复用该模块的 evidence；  
   - 若无可用模块名，则用本批首条用户 turn 原文 trim 后截断（≥2 字才注入；否则不造空标题）。  
2. **Prompt 轻提醒**（可选同卡）：`intent-compiler-prompt.md` 加一句「首轮有模块时须同时 `set_title`」——**不得**替代组装兜底（模型仍可能省略）。  
3. **单测**：空标题 + 仅 `upsert_module`（name=`登录页`）→ 组装后含 `set_title` 且 value 长度 ≥2；已有 `set_title` 时不重复注入。  
4. **真钥匙浏览器验收**（playtest）：同一句「我要一个登录页」→ 台账 `title` ≥2 字 → 中栏 `data-testid=scheme-confirm` **可点**（允许 disabled=false；本卡验收可点到按钮，不强制点下去冻结开工——点下去冻结属下一环，卡面写清「验证可点即可，勿在 CI 真冻结」或手工 playtest 勾选）。

**明确不做**：不改 `isReviewableScheme` / `evaluateSchemeConfirmation` 阈值与文案；不改右栏逐字节；不改 ADR-0015；不把离线启发式写入台账；不重试模型。

---

## 3. 估算

**S**（≤半天）：组装兜底 + 单测 + 可选 prompt 一句；门禁不动。
