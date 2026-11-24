# J.52 真钥匙复测落账与验收来源评估（只读 · P-289）

> **地位**：实测记录 + 只读评估。不改产品代码，不立施工卡。
> **基线**：`main` `bd264da84960383b431055ae4fcfecd7bdca98b9`（[#369](https://github.com/he18718143986-design/IDE/pull/369) P-288 合入后）。产品代码与 J.52 施工 `1d022acaca5e653650b0968074dd0a5266800be7` 相同。
> **依据**：2026-11-24 23:37 香港时间真钥匙复测（操作者由 Grok Bot 执行）；授权 Tina t1411u。
> **标记**：修法判断与「普遍 / 个例」推论均标 `ai_inferred`，不是施工授权。
> **诚实口径**：未测「确认开工」，未宣称端到端闭环。

## 一、实测记录（事实，不引申）

2026-11-24 真钥匙复测（J.51 + J.52），操作者由 Grok Bot 执行。

- 运行源是 `/private/tmp/ide-worktrees/j52-key-retest`，HEAD `bd264da84960383b431055ae4fcfecd7bdca98b9`（含施工 #367 `1d022acaca5e653650b0968074dd0a5266800be7`）。未拉、未重置 `/Users/tina/IDE`（仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`）。
- 旧 Daemon pid 7996（源 `0980ff7bec04991a77b97319518833c5811d024a`，3001）已关闭；新 Daemon pid 10243 于 23:37:00 香港时间在 `127.0.0.1:3001` 启动，DeepSeek 已加载。试玩目录 `/Users/tina/Downloads/stagent-j45-key-playtest`。本回合写本文件时 Tina 本机暂时不可达，未再打开该目录核对历史；下列台账字段以当时实测为准。
- 中栏仍 `frozen=false`、投影无 `size_hint`。台账 `scheme-active` 修订号 2、`size_hint=standard`、标题/模块「登录页」、`goals=[]`、`acceptance=[]`，`updated_at` 2026-11-23T06:45:40.385Z = 2026-11-23 14:45:40 香港时间（本次未改）。精简架构基线仍是 `minimal` / `ready` / 修订号 1，`scheme_ref` 修订号 2，mtime 2026-11-24 19:49:15 香港时间。
- `POST /api/supervisor/scheme/freeze` 于 23:37:48 香港时间返回 201，新规划确认 id 为 `scheme-plan-mwuuzd92-2pmvzk8v`。
- 随后 `POST /api/project/plan/decompose` 返回 422，`code=E_PLAN_INVALID`，白话「这个需求我还没拆好」，`model_calls=0`，违规为 `D-2` / `cs-1:acc-missing`。之后 `GET /api/project/plan` 仍是 404，磁盘上没有计划文件。合同仍为 0，未签署，未启动 Worker。

**J.52 修复验证通过**：失败码已从修复前的 `E_DECOMPOSE_FAILED`（入口把没有 `size_hint` 的中栏投影送进需要模型的分支）变为 `E_PLAN_INVALID`。分解已按台账 `standard` 走零模型路径，断点又往下推了一环。

**新断点**：密封台账 `acceptance=[]`（且 `goals=[]`）→ `buildStandardPlanPatch` 占位 `acc-missing` → D-2 校验失败 → `E_PLAN_INVALID`。这不是分解器坏了，是上游方案本身缺验收标准。未测「确认开工」，未宣称端到端闭环。

## 二、评估结论（先给）

`ai_inferred`。这份台账的空验收，不能当成「早期遗留 / 异常个例」来解释。当前产品代码与官方提示词本来就允许、并且在「登录页」这种最小需求上会示范「只写模块、不写验收」。确认与冻结也不查 `acceptance` 是否非空，所以空验收的方案可以点「确认方案，开始规划」并得到 201。分解器却假定「调用方应保证密封方案合法」，用占位 `acc-missing` 去撞 D-2。

因此：若只在 `buildStandardPlanPatch` 里用模块名或目标生成一个验收 id，而不把该 id 写进方案 `acceptance[]` 或放宽 D-2，仍然过不了校验。若把修法理解成「生成器本来就不该交空验收」，现有证据并不支持这一前提。更贴近代码事实的分岔是产品决定——方案层是否允许空验收进入密封。本评估不立施工卡，不建议现在开工，修法由 Tina 拍板。

## 三、空验收是普遍现象还是个例

**不能用多份现场台账证明普遍率。** 本回合未能再打开试玩目录（Tina 本机暂时不可达）；先前该目录 `.stagent/` 为未跟踪（`?? .stagent/`），即使可读也多半没有 git 历史。下面只根据代码、测试夹具和这一次已测台账说话。

已测事实：

- 这份台账 `updated_at` 停在 2026-11-23 14:45:40 香港时间，早于 J.50b / J.51 / J.52 的产品提交。复测当天冻结与分解都没有改这份草案；空的 `goals` / `acceptance` 不是 J.52 引入的。
- 当时精简 PAB 已是 `minimal` / `ready`。`buildMinimalReadyDocument`（`daemon/supervisor/pab/minimal-ready-pab.ts` 第 311–328 行）把方案验收抄进校验目录；验收为空时目录也为空，并不挡 PAB ready。

代码与夹具（当前 main，产品 tip `1d022ac`）：

- 官方编译器 few-shot 例 1（`daemon/supervisor/intent-compiler/system-prompt.ts` 第 41–47 行）正是「就搞个登陆页吧」→ 只发 `upsert_module`（模块名「登录页」），没有 `upsert_acceptance`，也没有 `upsert_goal`。
- 系统提示（同文件第 103–150 行）要求增量翻译意图、拿不准就不写、无操作时 `ops` 与 `quotes` 都是空数组，并不要求每轮或每份方案必须写出验收。
- 台账空草案默认值（`daemon/supervisor/intent-compiler/scheme-ledger-store.ts` `emptySchemeDraftV2`，第 50–59 行）：`size_hint` 缺省为 `"standard"`，`goals` 与 `acceptance` 缺省为 `[]`。`SchemeDraftV2.acceptance` 是必有数组，但空数组合法（`src/lib/journey/scheme-patch-types.ts` 第 227 行）。v1 `SchemeDraft` 仍把验收写成可选（`src/lib/journey/scheme-draft.ts` 第 71–74 行：「V2 白话验收条目（可选…）未接线前可缺省」）。
- 可审阅门禁 `isReviewableScheme`（`src/lib/journey/scheme-draft.ts` 第 524–528 行）只要求标题不少于 2 字，且摘要不少于 8 字或至少有一个模块。`evaluateSchemeConfirmation`（同文件第 615–714 行）不查验收。冻结入口 `handleSchemeSnapshot`（`daemon/server.ts` 第 2342–2526 行）校验方案 id / 修订号、Demo、decision、`scope_plan`、原话、信任档与回链，不要求 `acceptance` 非空。中栏 `canConfirm`（`src/components/studio/SchemeReviewPane.tsx` 第 358–363 行）跟确认谓词走，不跟验收条数走。
- J.49 只在空补丁且标题不足时补 `set_title`（`daemon/supervisor/intent-compiler/compile-loop.ts` `maybeFillEmptyPatchTitle`，第 210–237 行），没有对空验收做同类兜底。这与「登录页」台账只有标题和模块、验收仍空的形态一致。
- 多处测试夹具把 `acceptance: []` 当作合法方案，例如 `tests/helpers/scheme-patch-fixtures.ts`、`tests/unit/scheme-midpane-projection.test.ts`、`tests/ui/scheme-source-unification.test.tsx`。

`ai_inferred`：对「我要一个登录页」这类最小需求，空验收是当前生成器与门禁的常径，不是这份文件独有的损坏。不能据此统计「所有项目都空」，但也不应默认「生成器本来就不会交空验收，所以只需冻结前校验、不必面对空验收设计」。

## 四、验收标准该从哪来

### 1. 方案生成阶段为什么是空的？

实测加上面的提示词与默认值：不是「登录页」这种需求被单独跳过的隐藏分支，而是生成器没有被要求必须写出验收。模型可以发 `upsert_acceptance`（`src/lib/journey/compiler-output-schema.ts` 第 308 行；`docs/specs/intent-compiler-prompt.md` 第 573 行），但官方例子在同一句需求下并不发它。用户如果没说可验收的标准，按「宁缺毋滥」就不写。`ai_inferred`：把这看成生成器漏写，和把这看成最小需求的合法空态，是两种产品解释；代码现状更接近后者。

### 2. 冻结前是否应校验 `acceptance` 非空？

**改动面**：`isReviewableScheme` / `evaluateSchemeConfirmation`（`src/lib/journey/scheme-draft.ts`），必要时冻结入口 `handleSchemeSnapshot`（`daemon/server.ts` 第 2342 行起）；中栏确认按钮与白话（`SchemeReviewPane.tsx`）；`tests/unit/scheme-confirmation-gate.test.ts` 等门禁测试。缺验收就不让冻结，提示要补验收标准。

**风险**：本试玩已经用空验收把确认按钮点亮，并在 23:37:48 香港时间冻出 201。加上这道门后，同样的「登录页」会在冻结前被挡住。若生成器仍然不写验收，用户会停在确认环节，除非同时提供补验收的路径（提示词、编译循环兜底、或界面手写）。已有「空验收仍可冻结」的测试与夹具要改。已经冻过的空验收台账，这道门也救不回来。这与分解器注释「调用方应保证密封方案合法」（`daemon/supervisor/decomposer/decompose.ts` 第 211 行）一致，但与当前「确认 / 冻结不查验收、字段可为空」的实现不一致。`ai_inferred`：若拍板「密封必须带验收」，应同时解决「验收从哪补」，不要只拦冻结。

### 3. 是否应由 `buildStandardPlanPatch` 对空验收做兜底？

**改动面**：`daemon/supervisor/decomposer/decompose.ts` 第 194–248 行 `buildStandardPlanPatch`。现状是验收为空时写入占位 `"acc-missing"`，好让校验暴露 D-2（第 209–211、226–227、240–241 行）。

**风险**：D-2 规定，`origin: "scheme"` 的桩，每个验收 id 必须存在于方案 `acceptance[]`（`src/lib/project/project-plan.ts` 第 254–273 行；`docs/specs/project-decomposition.md` 第 106 行）。只在补丁里用目标或模块名造一个 id，方案里没有对应条目，结果仍是 `D-2` / `cs-1:…`。本份台账 `goals` 也是空的，能当作文案来源的只剩模块名「登录页」。若要兜底真正通过，还得在分解时改密封方案、放宽 D-2，或把桩改成 `origin: "system"` 去引用 `SYSTEM_ACCEPTANCE`（系统验收是测试底座 / 知识库 / 依赖等，语义上不适合「登录页」功能桩）。前两种会动密封边界或「可观察、可验收」；后一种是张冠李戴。`ai_inferred`：单独做「分解兜底」不够，也不应默认为首选。

## 五、三条修法对照（均 `ai_inferred`，不立卡）

| 修法 | 当作什么问题 | 改动面 | 主要风险 |
| :--- | :--- | :--- | :--- |
| 生成器补写验收 | 生成器漏写，或最小需求也应有一条最小验收 | 系统提示 / few-shot；或编译循环按 J.49 同类方式从模块名补 `upsert_acceptance` | 与「宁缺毋滥」及摘录规则冲突；补出来的验收是 `ai_inferred`；已密封的空台账不会被这步救活 |
| 冻结前校验非空 | 空验收不应进入密封 | 确认谓词、冻结入口、中栏白话与门禁测试 | 本试玩这类方案会被挡在冻结前；若无补写路径，用户卡住；已冻空台账仍在 |
| 分解补丁兜底 | 分解器应容忍合法空验收 | `buildStandardPlanPatch`；若要过 D-2，还得动方案、D-2 或桩 origin | 只改补丁过不了 D-2；改密封方案或放宽 D-2 面更大 |

`ai_inferred`：不把「只改分解占位」当作完整修法。若认为密封应当为分解做好准备，应同时考虑冻结前校验，以及校验挡住之前如何得到最小验收。若认为方案层空验收仍合法，就需要另行规定空验收如何分解，而不是继续用 `acc-missing` 去撞 D-2。两种方向都要 Tina 拍板后才能立卡。

本评估不立施工卡，不改 ADR，不改产品代码。
