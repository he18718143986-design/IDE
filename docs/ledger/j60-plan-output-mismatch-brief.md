# 计划节点目标与 Worker 实际产出不一致：诊断与施工方案（P-314）

> **地位**：planning brief；施工权威在 [`../specs/development-tasks-active.md`](../specs/development-tasks-active.md#task-j.60)。
> **基线**：`main` `3782c45e5215212f289f82f302a66ce7a129adbd`（[#401](https://github.com/he18718143986-design/IDE/pull/401) P-313 落账）。
> **证据来源**：P-312 / P-313 实测（[`j59-n1-illumination-retest.md`](./j59-n1-illumination-retest.md)、[`j59-n2-n3-node-walk.md`](./j59-n2-n3-node-walk.md)）。
> **不改产品代码**（本文件仅诊断与方案）。

---

## 1. 现象

| 节点 | 目标 | 施工树实文件 | 结果 |
| :--- | :--- | :--- | :--- |
| `n1` | `src/**` | 7 个 `src/*.js` | `ILLUMINATED` |
| `n2` | `package.json` | 有 | `ILLUMINATED` |
| `n3` | `tsconfig.json` | **无** | `FAILED`（`E_FILES_NOT_WRITTEN`，九条命令仍全 `exit 0`） |
| `n4`–`n9` | `tsconfig.*.json` / `vitest.config.*` / `vite.config.*` / `*.config.ts|mjs|js` | **无** | `BLOCKED` |
| `n10` | `index.html` | 有 | `BLOCKED`（依赖链） |
| `n11` | `tests/**` | 2 个 `tests/*.test.js` | `BLOCKED`（依赖链） |
| `n12` | `**/*.test.ts` | **无**（只有 `.test.js`） | `BLOCKED`；扩展名不匹配 |

合同 `contract_1795588309763_cy8zx` 的 `authorization.file_system_scope.writable_paths` 共 **14** 条，与 `daemon/supervisor/rules-l0.ts` 的 `GREENFIELD_NPM_WRITABLE_DEFAULTS` **同序同值**：

```
src/**, package.json, tsconfig.json, tsconfig.*.json, vitest.config.*,
vite.config.*, *.config.ts, *.config.mjs, *.config.js, index.html,
tests/**, **/*.test.ts, **/*.test.tsx, **/*.spec.ts
```

该合同的实际验收命令是九条 `baseline-*`（**不含** `npm typecheck` / `npm test`）。

## 2. 根因（代码事实）

1. **模板来源**：`daemon/supervisor/rules-l0.ts:84-98` 定义 `GREENFIELD_NPM_WRITABLE_DEFAULTS`（14 条），`alignWritableWithNpmVerification()`（`:236-247`）在「绿野仓库 + 命令需要 npm 验收」时把它并入可写范围。注释自述用途是「仅 `src/**` 时 Worker 无法落 package.json / 测试文件，验收命令必然失败」——即**为放行写入权限**而放宽，不是为「必须产物」而设。
2. **一对一派生**：`src/lib/journey/proposal-from-contract.ts:56-66` 取 `writable.slice(0, 12)`，**每条可写路径生成一个节点**，`target_files` 就是该模式本身。14 条 → 12 个节点，正是本图的 `n1`–`n12`。
3. **核销按「必须写入」判定**：`daemon/graph/illumination-verifier.ts:276-287`，`node.target_files` 逐条要求被本次采集的 `files_written` 满足，否则 `E_FILES_NOT_WRITTEN`；判定在命令层之后，所以出现「九条命令全 `exit 0`、仍不点亮」。

**结论（一句话）**：`writable_paths` 承担了两种语义——「允许写」与「必须写」；图把权限上界 1:1 当成必须产物，于是模板里那些纯脚手架路径（`tsconfig*`、`*.config.*`、`**/*.test.ts`）变成必失败节点。

## 3. 为什么不是 J.58 / J.59 的问题

- J.58 已让 `src/**` 这类 glob 能展开匹配，「通配符当字面路径」的问题不存在（`n1` 就是靠它点亮的）。
- J.59 已让裸名 `stagent` 解析到 Daemon 入口，九条命令在 `n2`、`n3` 上全部真实跑通（`exit 0`、`stderr_length=0`）。
- 本次失败发生在**命令层之后的存在性检查**，与 J.58 / J.59 的交付面不重叠。

## 4. 候选方案

### 方案 A（推荐 · 本卡默认）：提案侧按验收命令决定脚手架目标

- 在提案构建时过滤「纯脚手架 / 配置类」目标模式**不进节点**：
  - `tsconfig.json`、`tsconfig.*.json`、`*.config.ts`、`*.config.mjs`、`*.config.js`、`vitest.config.*`、`vite.config.*`、`**/*.test.ts`、`**/*.test.tsx`、`**/*.spec.ts`
- **守卫条件**：仅当验收命令**不要求**相应能力时才过滤——复用既有 `commandsNeedNpmVerification()` 语义（`daemon/supervisor/rules-l0.ts:213-227`）：命令里有 `npm typecheck` → 保留 `tsconfig*`；有 `npm test` → 保留 `vitest.config.*` / `vite.config.*`。避免「把真需要 TS 配置的项目削成过不了 typecheck」。
- 这些路径**仍留在 `writable_paths`**（写入权限不缩），只是不再作为核销目标。真实产物 `src/**`、`tests/**`、`package.json`、`index.html` 全部保留为节点。
- 代价：`E_FILES_NOT_WRITTEN` 对「脚手架」不再兜底；收益：核销目标与产物语义一致。
- 估算：**S**。

### 方案 B：合同新增「必须产物」字段，与 `writable_paths` 分离

- 合同 schema 增可选 `deliverables`（缺失时回退到「按验收命令筛选后的可写范围」），提案只按 `deliverables` 建节点。
- 语义最干净，但要动合同 schema（版本化 + 迁移 + 多处装配点），估算 **M**，且属 ADR 级口径变更。

### 方案 C：Worker 侧按 `writable_paths` 补齐配置文件

- 让 Worker 对纯 JS 项目也写 `tsconfig.json` / `vitest.config.*`。
- **不推荐**：为过核销造无意义文件，接近「为变绿而造产物」，与证据纪律冲突。

**推荐 A**（本卡默认，标 `ai_inferred`）；B 作为后续口径升级另案；C 不采用。方向最终由 Tina 拍板，卡未开工。

## 5. 验收口径（CI 可验证）

- 纯 JS 交付（验收命令为九条 `baseline-*`、无 `npm typecheck` / `npm test`）时，提案节点**不含**上述脚手架目标；`src/**`、`tests/**`、`package.json`、`index.html` 仍各成节点。
- 有 `npm run typecheck` 时 `tsconfig.json` 仍成节点；有 `npm test` 时 `vitest.config.*` / `vite.config.*` 仍成节点。
- 核销侧零改动：`E_FILES_NOT_WRITTEN`、判定顺序、`patternIsSatisfied` 语义全部不变（只读核验 + 既有用例保持绿）。
- 真钥匙复测不在本卡验收口径内。

## 6. 排除

不放宽 fail-closed、不改 J.58 glob 展开、不改 J.59 命令解析、不改门禁阈值、不改 `markStale` / `nodeTouchesPaths`、不改 ADR-0015、不伪造施工树文件、不点「确认开工」、不宣称端到端闭环。
