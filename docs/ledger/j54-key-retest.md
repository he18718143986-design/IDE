# J.54 真钥匙复测落账（只读 · P-295）

> **地位**：实测记录。不改产品代码，不立施工卡。
> **基线**：`main` `739ef21a2e97c3172c67d7a8ed3234b39bea4d23`（[#377](https://github.com/he18718143986-design/IDE/pull/377) P-294 合入后）。产品代码尖在 J.54 施工 [#375](https://github.com/he18718143986-design/IDE/pull/375) squash `6ea454c6fe535dc1272900989b699b54e7b3a51f`。
> **依据**：2026-11-25 05:44–05:50 香港时间真钥匙复测（操作者由我执行）；授权 Tina t1432u 点名锁定路径。
> **诚实口径**：确认开工已测但未签署成功；未宣称端到端闭环。

## 一、环境（事实）

- 运行源是 `/private/tmp/ide-worktrees/j54-key-retest`，HEAD `739ef21a2e97c3172c67d7a8ed3234b39bea4d23`（与当时 `origin/main` 相同，含施工 `6ea454c6fe535dc1272900989b699b54e7b3a51f`）。由已有 `/Users/tina/IDE` **只 fetch** 后 `git worktree add --detach` 建成。未拉、未重置、未 checkout 改 `/Users/tina/IDE` 的 HEAD（仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`，`main` behind origin）。未在 Tina 的 Mac 上 clone。未用 CloudAgent。
- 旧 Daemon pid 10243（源 `/private/tmp/ide-worktrees/j52-key-retest` @ `bd264da84960383b431055ae4fcfecd7bdca98b9`，`127.0.0.1:3001`，2026-11-24 23:37 起）已 SIGTERM 停掉。新 Daemon pid 13143（父进程 13140）于 2026-11-25 05:44:48 香港时间启动：在该 worktree 执行 `./node_modules/.bin/tsx bin/stagent.ts open /Users/tina/Downloads/stagent-j45-key-playtest --port 3001 --no-browser`。`GET /health` 返回 `status=ok`，`port=3001`，`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`，`pid=13143`。源码树 `.tmp/deepseek.env` 已找到（符号链接，未拷到 box、未打印内容）。启动日志：本机变量已加载 4 项，L1 补全已启用（DeepSeek / OpenAI 兼容口）。
- 试玩目录：`/Users/tina/Downloads/stagent-j45-key-playtest`。HTTP 认证只用 `Authorization: Bearer`（读该目录 session-token，未打印、未外传）。

## 二、复测前目录状态

- 台账 `scheme-active` 修订号 **2**，`frozen=false`，`size_hint=standard`，标题/模块「登录页」，`goals=[]`，`acceptance=[]`，`updated_at` 仍为 2026-11-23 14:45:40 香港时间。模块 `ITEM-1` 有 1 条 evidence。
- 中栏投影：`available=true`，修订号 2，`frozen=false`，验收为空。
- `GET /api/project/plan` 404，`code=E_PLAN_INVALID`，「project plan not found」。磁盘当时无 `plan.json`。`GET /api/contracts` 0 份。
- 精简 PAB 仍是 `architecture-baseline.json`：`minimal` / `ready` / 修订号 1，`scheme_ref` 修订号 2，mtime 2026-11-24 19:49:15 香港时间（本次未改）。
- 已有历史冻结快照（本次未改写、未用新门禁打成 4xx）：
  - `scheme-plan-mwujofon-p66842ot`（2026-11-24 18:21:22 香港时间）
  - `scheme-plan-mwumtg6x-ql5dyc9n`（2026-11-24 19:49:15 香港时间）
  - `scheme-plan-mwuuzd92-2pmvzk8v`（2026-11-24 23:37:48 香港时间，P-289 空验收冻结 201）

## 三、补验收并升修订

2026-11-25 05:45:33 香港时间，走生产右栏路径（不是直接改台账文件）：

- `POST /api/supervisor/turns` 201，登记原话 `T8`（seq=8）。正文是：「请给登录页补一条可检查的验收标准：打开登录页后可以用手机号登录」。
- 意图编译循环随后自动跑完：daemon 日志 `compiler_applied`，`status=applied`，`model_id=deepseek-flash`，`elapsed_ms=2459`，`ops=2`（05:45:37 香港时间）。
- `POST /api/supervisor/journey`（带已登记的 `T8`）200，分流 `MAJOR_DRAFT`，白话「我按大事帮你出了草案。」这是旅程编排副作用，另落了一份生命周期为 `DRAFT` 的合同 `contract_1795556756329_1qqpk`（审批 `DRAFT`，无 `stub_id`）。**这不是「确认开工」签署。**

补完后台账（mtime 2026-11-25 05:45:37 香港时间）：

- 修订号 **2 → 3**，仍 `frozen=false`。
- 合格验收一条：`id=ITEM-2`，`text=打开登录页后可以用手机号登录`，`source=user_said`（证据指向 `T8`）。中栏 provenance：「业主原话 · 细模型加层对齐」。id 与 text 去空白后均非空。
- 编译器同时把方案 **标题** 改成了「打开登录页后可以用手机号登录」（模块名仍是「登录页」）。据实录下，不是预定改标题。

## 四、「确认方案，开始规划」

先对空验收做一次受控探针（新 confirmation id，不碰历史快照）：

- `POST /api/supervisor/scheme/freeze`，`confirmation_id=scheme-plan-1a20f8774d9-5386a817`，正文验收为空。返回 **422**，`code=E_SCHEME_ACCEPTANCE_EMPTY`，`error=scheme_acceptance_empty`，用户可见文案：**「方案还没有验收标准，先补一条再冻结」**。磁盘未写出该 id 的快照；历史三份快照仍在、mtime 未变。J.54 空验收门禁在冻结入口触发。

再走规划确认冻结（生产入口 `handleSchemeSnapshot`，带预检 `scope_plan` 与原话 `T8`）：

- `POST /api/supervisor/scope/preflight` 200，`scheme_revision=3`，`plan_digest=16493c9ba83e48e19018df7738ea31123c0e0690a23f67f3c850a6e621d1fe85`，`needs_approval=0`。
- `POST /api/supervisor/scheme/freeze`，`confirmation_id=scheme-plan-1a20f8774e5-1f1e1f97`，方案含 `ITEM-2` 且 `frozen=true`。返回 **201**（05:47:45 香港时间），`snapshot_id=scheme-plan-1a20f8774e5-1f1e1f97`，`digest=13b688f692abab8eac73dd1644a38d12b8fadea7a33dad7966fdbc82baa13d2f`，`idempotent=false`，`frozen_quotes_count=1`。快照文件已落盘（10523 字节）；快照内 `scheme.frozen=true`，`scheme_revision=3`，验收为 `ITEM-2`。
- 随后 `POST /api/project/plan/decompose`（`pab: null`）**200**，`ok=true`，`model_calls=0`，无违规。写出 `.stagent/project/plan.json`（05:47:45 香港时间）：
  - `plan_revision=1`，`project_id=proj-scheme-active`，`scheme_id=scheme-active`，`scheme_revision=3`
  - 里程碑 `ms-1` 标题「第一期」，`exit_acceptance_ids=["ITEM-2"]`，`contract_ids=["cs-1"]`
  - 合同桩 `cs-1`：标题「登录页」，`origin=scheme`，`scheme_item_ids=["ITEM-1"]`，`acceptance_ids=["ITEM-2"]`，`status=planned`，`contract_id=null`
- `GET /api/project/plan` 200，`ok=true`，`next_stub_id=cs-1`，正文与磁盘计划一致。地图所读即此计划。

台账 `scheme-ledger/active.json` 在冻结后仍是 `frozen=false`、修订号 3（中栏投影同样 `frozen=false`）。冻结发生在快照文件，不在这份台账的 `draft.frozen` 字段。据实记录。

## 五、「确认开工」

已测。按生产地图路径：对桩 `cs-1` 预检后，用新的开工 confirmation id `scheme-start-mwv89tnb-uomvzpdv` 调 `createContractWithAdmission`（ADR-0015 option i：开工是 `scheme-start-…`，不与规划 `scheme-plan-…` 混用；不走规划冻结重入）。

- `POST /api/supervisor/scope/preflight`（`stub_id=cs-1`）200，`plan_digest=7739b9322303030c3ba125ace4c82c6e31c6936a83adb25dc5d33ae9631372f9`，`needs_approval=0`。
- `POST /api/contracts`（`confirmation_id=scheme-start-mwv89tnb-uomvzpdv`）返回 **409**，`code=E_SCHEME_SNAPSHOT_NOT_FOUND`，`error=scheme_snapshot_not_found`，用户可见文案：**「确认快照不存在或已损坏，拒绝创建可签署合同」**（2026-11-25 05:49:51 香港时间）。
- 未批准、未建任务图、未 `runWorker`、未签字。桩 `cs-1` 仍是 `planned` 且 `contract_id=null`。`GET /api/contracts` 仍只有先前旅程副作用那份 `DRAFT` 合同。`GET /health` 的 `activeContracts` 仍为空。

现象对应实现：`daemon/http/contract-routes.ts` 用请求里的 `confirmation_id` 直接 `readSchemeSnapshot`；规划冻结把快照写在 `scheme-plan-1a20f8774e5-1f1e1f97`，开工 id `scheme-start-mwv89tnb-uomvzpdv` 下没有快照。这是可复现失败，不是机器中断。本落账不立新施工卡。

## 六、复测后目录要点

- 台账：修订号 3，`frozen=false`，验收 `ITEM-2`，标题「打开登录页后可以用手机号登录」，模块「登录页」。
- 新快照：`scheme-plan-1a20f8774e5-1f1e1f97`（frozen=true，修订号 3，含 `ITEM-2`）。历史三份空验收快照仍在。
- 新计划：`.stagent/project/plan.json` 修订号 1，地图下一桩 `cs-1`（planned，未签）。
- PAB 文件 mtime 未变。无新的已签署合同。未启动 Worker。

## 七、结论（不引申为施工授权）

锁定路径已完整走完。J.53 补验收 + J.54 冻结门禁 + 分解出计划/地图，在本试玩目录上已实测通过：空验收冻结 422 且不写盘；补合格验收升修订后冻结 201；分解 200、`model_calls=0`，计划与地图写出。**「确认开工」已测，未签署成功**（409 `E_SCHEME_SNAPSHOT_NOT_FOUND`，「确认快照不存在或已损坏，拒绝创建可签署合同」）。**未宣称端到端闭环。**
