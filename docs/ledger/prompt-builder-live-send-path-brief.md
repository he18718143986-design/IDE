# prompt-builder 活发送路径 · 只读定位简报（P-233）

> **地位**：planning brief（2026-11-16 · Asia/Hong_Kong）。授权来源为 Tina「J.36 立卡 docs PR + 活发送路径只读定位简报」。  
> **本条只定位**：**不立接线卡、不施工、不改 ADR、不改产品代码**。立接线卡须另授权。  
> **依据**：[`TASK-J.35`](../specs/development-tasks-completed.md#task-j.35) 归档注记诚实口径（「已对齐台账/信任档/回链，活发送路径未接」）；[`TASK-J.30`](../specs/development-tasks-completed.md#task-j.30) P-211 四处活发送接缝清单；`buildSupervisorPrompt` 现行实现。

## 1. 一句话结论

`buildSupervisorPrompt`（J.35 已对齐台账 / 信任档 / 回链，出口 `assertContextHasNoVaultSecrets`）**今日仍无任何生产调用点**；四处活模型发送缝各自组装自己的 prompt，**不**消费 `SupervisorContextBundle`。接线须另授权立卡，且须先选定唯一接缝——不得默认注入右栏 partner（ADR-0014 / L.1 逐字节相同）。

## 2. 已交付（接线卡禁止重写）

| 面 | 落点 | 卡 |
| :--- | :--- | :--- |
| `SupervisorContextBundle` 可选 `scheme_summary` / `trust_tier` / `backlink_summary` | `daemon/supervisor/types.ts:170-181` | J.35 |
| 有字段才插入三段；`return` 前 vault 断言命中即抛 | `daemon/supervisor/prompt-builder.ts:313-343` | J.35 |
| 纯函数、零 I/O；测试在用 | `tests/unit/supervisor-session.test.ts`；`tests/daemon/vault.test.ts` | J.35 |
| 四处活发送缝已有 vault 断言（与 builder 无关） | chat / L1 draft / compiler / worker（见 J.30） | J.30 |

**禁止**：借接线卡重做 J.35 组装语义；vault 脱敏后继续发送；把 builder 冒充已接进生产。

## 3. 现行活发送缝（只读事实）

| 缝 | 锚点 | 现行组装 | 调 builder？ |
| :--- | :--- | :--- | :--- |
| **右栏 partner** | `daemon/chat/session-manager.ts:175` `send` → `:222` `runOne` → `:239` `adapter.run({ prompt: text })` | 用户原文 + history；`:238` 注释：prompt 与用户输入逐字节相同（TASK-L.1 / ADR-0014 §1） | **否** |
| **L0/L1 草案** | `daemon/supervisor/draft-generator.ts` `generateContractDraft` / `buildEnrichmentPrompt`；HTTP `POST /api/supervisor/draft` | L0 规则 + 可选 L1 补全自有 prompt | **否** |
| **意图编译器** | `daemon/supervisor/intent-compiler/compile-loop.ts` `callModel` → `client.generate`；系统提示 `system-prompt.ts` / `render-input.ts` | 编译器自有栈 | **否** |
| **Worker 指令** | `daemon/worker/session-task-injector.ts` / `ai-worker.ts` | 工人自有指令组装 | **否** |

`buildSupervisorPrompt` 的**唯一**调用方：单元测试（`supervisor-session.test.ts`、`vault.test.ts`）。`daemon/` / `src/` 生产路径零引用。

J.30 已写明：`prompt-builder.ts`「对话上下文」拼装**不是**活的发送点。

## 4. 数据已在别处、未投影进 ContextBundle

| 字段 | 活来源（未接到 builder） |
| :--- | :--- |
| 台账方案 | `scheme-ledger-store` / `scheme-midpane-projection` / `GET /api/supervisor/scheme-midpane` |
| `trust_tier` | `scheme-snapshot-store` 冻结快照；`POST /api/supervisor/scheme/freeze` |
| 回链核对 | `evaluateSchemeItemBacklinks`；freeze / `backlink-preview` |

## 5. 若另授权立接线卡，须仍待办的事

1. **选定（或新建）唯一模型调用缝**消费 `buildSupervisorPrompt` 文本——今日无一缝消费；右栏 partner 注入须先明示推翻「逐字节相同」口径（另议 ADR / 修卡），**默认禁止**。
2. **投影**台账 + `trust_tier` + 回链结果 → `SupervisorContextBundle`（缺字段不伪造；不得在 builder 内重算回链）。
3. **在模型调用前**调用 `buildSupervisorPrompt`；vault 断言 fail-closed（不得脱敏继续）。
4. **接缝级单测**：字段在场时三段进入出站 prompt；负例（缺登记 / 哈希不一致 / `ai_inferred`）不得标「已覆盖」。

## 6. 建议卡形态（本条不立）

| 建议 | 说明 |
| :--- | :--- |
| 卡号 | 待 Tina 另授；**不**占用 `TASK-J.36`（J.36 为本回合信任档规格缝补丁） |
| 估算 | 视选定缝而定；若含右栏逐字节口径变更或跨多缝，按 R-11 先拆 |
| `writable_paths`（示意） | 新投影 helper（`daemon/supervisor/`）+ **单条**选定发送缝胶水 + 对应 `tests/unit`/`tests/daemon`；`prompt-builder.ts` / `types.ts` 宜只读（J.35 已交付） |
| non_goals | 不重写 S.1 零工具；不 vault 脱敏继续；不实现 §3.3；不替换 compiler / L1 自有 prompt 栈；不静默改 partner 逐字节契约；不宣称端到端闭环 |

## 7. 与本回合其它项分界

| 项 | 本简报 |
| :--- | :--- |
| [`TASK-J.36`](../specs/development-tasks-active.md#task-j.36) 信任档规格缝 | **分治**：规格契约 ≠ 活路径接线 |
| 蓝图第一批卡（细模型加层 + 视图投影） | **暂不立** |
| CI.2 / §3.3 / 文档计划 | 攒样本 / Hold / 暂缓 |

## 8. 结论

- J.35 收口组装面；**活发送仍未接**——与归档诚实口径一致。
- P-233 本回合：只落本简报 + 立 `TASK-J.36`；**不立**活发送接线卡；不施工。
