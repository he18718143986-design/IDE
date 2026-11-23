# ADR-0015 主链下一环断点（只读走查 · P-275）

> **地位**：只读走查落账。不改产品代码，不开施工分支，不立施工卡。  
> **基线**：`main` `821182958810bbe8f0d6077b9f01b13c866857a8`（[#351](https://github.com/he18718143986-design/IDE/pull/351) P-274 合入后）。产品代码与 J.49 施工 `b4fecdc09396c1b3654a0fcb8e9d7354d51b8a11` 相同。  
> **走查范围**：沿 P-261 办法，从「已有可审阅方案、确认方案按钮可点」之后继续：项目计划 / 里程碑分解 → 合同确认开工 → 试玩 → 合入。  
> **授权**：Tina t1342u 点名「做主链下一环走查」；t1343u 确认结论并授权落账。  
> **诚实口径**：只读看代码。未点「确认方案」、未冻结、未调用分解。与 J47-P4（P-274）相同：判定用生产同一套逻辑，不是浏览器里的 DOM 点击。

## 断点（一句话）

用户有了可审阅方案、确认方案按钮也可点之后，走不过「先看到项目计划和里程碑，再按合同确认开工」：分解接口和项目地图都在，但生产界面从不调用分解，计划不会出现；中栏「确认方案」会直接冻结并开工写代码。

## 定性

这不是「功能缺失」，而是主链顺序与 ADR-0015 描述不符。

- ADR-0015 决策第 2 条：项目计划由方案（`SchemeDraftV2`）分解得到，持久化在 `.stagent/project/plan.json`；其上再有里程碑。
- ADR-0015 决策第 4 条：每份合同仍有自己的「确认开工」与「合入」两次点击（ADR-0014 §2）。计划本身不是授权凭据；计划里有的合同，也必须单独签署。
- 现行实现是「确认方案 = 冻结 + 直接开工」。中栏按钮说明原文是「确认后冻结 Spec 并直接开工写代码」。计划 / 里程碑这一环被整个跳过。

这是比 P-261 更深一层的断点：不是某环坏了，是一环被绕过了。ADR-0015 背景写明，绕过之前的旧路径正是「一份方案 → 一个 `ScopePlan` → 一份合同 → 一张任务图 → 一次合并」；现行「确认方案」仍走这条路径。

## 这一步之前发生了什么

P-261 原断点「得不到可审阅的 `SchemeDraftV2`」已由 J.45 及后续卡修复。J47-P4 已销（P-274）：真钥匙实测 HEAD `bcf8b08be4740222e855ca5d86bad1a74b50d183`，台账标题「登录页」、`scheme_revision` 2、未冻结；按生产同一套逻辑，`scheme-confirm` 的 `disabled` 为 `false`。本次走查从这一步之后开始。

## 为什么计划出不来、开工被提前

没有 `.stagent/project/plan.json` 时，读取计划会 404；中栏只在已有计划时才画出「项目地图」，否则这块完全不出现。分解接口在服务端和客户端封装里都有，测试会打，生产 UI 零调用。地图上的「确认开工」要先有合同桩才会出现，点了之后仍走同一套确认方案。与此同时，底部「确认方案」按 C.22 五阶段直接冻结、签一份合同、建任务图、拉起 Worker。

- `daemon/server.ts` 第 5427–5432 行：`GET /api/project/plan` 在 `readPlan` 为空时返回 404，错误码 `E_PLAN_INVALID`。
- `src/components/studio/SchemeReviewPane.tsx` 第 432–441 行：`props.projectPlan` 为真才渲染 `ProjectMapPane`，否则为 `null`，没有「尚未生成计划」的空态，也没有触发分解的按钮。
- `daemon/server.ts` 第 5531–5578 行：`POST /api/project/plan/decompose` 服务端入口存在，成功则 `writePlan`。
- `src/lib/daemon-api.ts` 第 1321–1345 行：`decomposeProjectPlan` 是该接口的客户端封装。生产 UI（`src/routes`、`src/components`）没有调用点；调用只出现在测试（如 `tests/daemon/plan-patch-api.test.ts`）。
- `src/components/project/ProjectMapPane.tsx` 第 162 行：地图「确认开工」按钮。
- `src/routes/index.tsx` 第 1855–1867 行：`handleProjectMapConfirmStart` 要求已有方案草稿，按 `stub_id` 做范围预检后，仍调用同一套 `handleConfirmScheme`。
- `src/routes/index.tsx` 第 1457–1461、1546、1610、1733 行：底部「确认方案」走 C.22 五阶段原子事务（冻结 → 签署并准备合同与任务图 → 提交），成功后自动 `runWorker`。
- `src/components/studio/SchemeReviewPane.tsx` 第 7 行、第 846–847 行：最底只有「确认方案」（冻结 Spec → 开工）；说明原文「确认后冻结 Spec 并直接开工写代码」。

## 后面几步（不判为本次断点）

试玩入口在 `src/routes/index.tsx` 第 1886 行起（`handleStartRealPlaytest`）。合入入口为 `mergeContract`（`src/lib/daemon-api.ts` 第 1348 行起，调用点 `src/routes/index.tsx` 第 3184 行）。代码里有入口，这次走查没有走到，不判为本次断点。

分解器本身还要求有 ready 的架构基线（PAB）。`daemon/supervisor/decomposer/decompose.ts` 第 7 行、第 165–188 行、第 301–302 行：PAB 缺失、非 ready、或有阻断未决事项时返回 `E_PAB_NOT_READY`。HTTP 入口在未传入 PAB 时把 `pab` 置为 `null`（`daemon/server.ts` 第 5556 行）。因为生产界面还没有调用分解，本次不把 `E_PAB_NOT_READY` 写成断点。

## 不做的事

不立施工卡，不改 ADR-0015，不改产品代码。修复评估须另点名、在本落账合入之后再开（P-275 本条只记录走查）。
