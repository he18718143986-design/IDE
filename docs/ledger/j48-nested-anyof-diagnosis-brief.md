# TASK-J.48 · 第二轮生成 schema 嵌套 anyOf 缺 type：诊断与施工方案

> **地位**：planning brief（诊断记录）。施工已由 [`TASK-J.48`](../specs/development-tasks-completed.md#task-j.48) COMPLETED（#346/`3a68a81`，P-271）交付。真钥匙复测不在本卡。J47-P4 手工 debt 未销。  
> **基线**：main `50ba47cab8d1a593b4dbae626086644c8c8479f4`（P-269）。  
> **现象来源**：J47-P4 真钥匙复测（试玩目录已有 `ITEM-1`）。  
> **不改产品代码**（本文件仅诊断与方案）。

---

## 1. 诊断结论

| 观测 | 值 |
| :--- | :--- |
| J47-P4 `intent_compiler` | `compiler_failure` / `stage=model` / `detail=network` / `elapsed_ms=261` |
| `client_detail` | `Invalid json schema: field anyOf: field anyOf: missing field type` |
| 空台账首轮（P-267） | 能 `compiler_applied`（当时 `ids` 空，未走到本层） |
| 有 `ITEM-1` 第二轮 | DeepSeek 拒 schema |

**根因（已用 `asSchema(buildCompilerOutputSchema).jsonSchema` 复现）**：

`flowItemSchema` 在 `ids.length > 0` 时：

```ts
z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE)]).nullable()
```

转成 JSON Schema 后，`module_id` 形如：

```json
{
  "anyOf": [
    { "anyOf": [ { "type": "string", "enum": ["ITEM-1"] }, { "type": "string", "pattern": "..." } ] },
    { "type": "null" }
  ]
}
```

外层 `anyOf[0]` **只有内层 `anyOf`、没有 `type`** → DeepSeek 报 `missing field type`。

空 `ids` 走 `z.string().regex(...).nullable()`，分支自带 `type: string` / `null`，故首轮不过此雷。

---

## 2. 全量排查清单（`compiler-output-schema.ts` 内 `z.union` + `.nullable()`）

| 位置 | 形态 | 判定 |
| :--- | :--- | :--- |
| L127 `flowItemSchema` / `module_id`（ids 非空） | `z.union([enumOrNever, regex]).nullable()` | **同根因 · 必修** |
| L128 `module_id`（ids 空） | `z.string().regex(...).nullable()` | 有 type · 不修 |
| L106/123/152/166/188/205 等 `id` | `z.union([enumOrNever, regex])` **无** `.nullable()` | 探针未报 nested missing type · 本卡不扩改，除非施工发现同错 |
| L115 `project_anchor` | `z.string().nullable()` | 非 union · 不修 |
| L329 `reject_item.reason` | `z.string().nullable()` | 非 union · 不修 |
| L93–100 `revivalSchema` | `object.nullable()` | 非 union+nullable 套娃 · 不修 |
| L385 ops `z.union([...])` | 顶层 op 联合 | 各分支为 object 带 type · 探针未报 · 不修 |

**本卡施工默认只改 L127 那一处。** 若施工时用同一探针扫全 schema 仍发现其它「anyOf 套 anyOf 且内层包装缺 type」，同根因同修法一并修；**若必须改 `enumOrNever` 对外返回类型/契约 → 停工上报修卡**。

---

## 3. 施工方案

1. **修形态，不改接受值**：ids 非空时改为三分支联合（或等价、且每分支带 `type` 的写法），例如  
   `z.union([enumOrNever(ids), z.string().regex(NEW_ID_RE), z.null()])`  
   仍接受：现有 id、`new:` id、`null`。  
2. **单测**：`ids: ['ITEM-1']` 时 `asSchema(buildCompilerOutputSchema(...)).jsonSchema`（与 `generateObject` 同路径）断言：不存在「子节点仅有 `anyOf`/`oneOf` 且无 `type`」的嵌套包装。  
3. **既有**：`compiler-output-schema.test.ts` / 标题兜底 / 门禁阈值 / `assembleCompilerOutput` 六参 / L743–772 标题兜底顺序 **不动**。

## 4. 估算

**S**。真钥匙复测不在本卡验收口径内。
