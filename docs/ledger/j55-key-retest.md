# J.55 真钥匙复测落账（只读 · P-298）

> **地位**：实测记录。不改产品代码，不立施工卡，不重开 J.55。
> **基线**：`main` `58016b7a5be56064a775b00b64e7555058924991`（[#381](https://github.com/he18718143986-design/IDE/pull/381) P-297 回写合入后）。产品代码尖在 J.55 施工 [#380](https://github.com/he18718143986-design/IDE/pull/380) squash `05e6f4e7909b0cf721c684a0b66b681daca794a9`。
> **依据**：2026-11-25 14:26–14:33 香港时间真钥匙复测（操作者由我执行）；授权 Tina t1440u 点名锁定路径。计划与规划阶段冻结快照已就位，本次未再补验收、未再冻结、未再分解。
> **诚实口径**：开工确认已按 `scheme_id`+修订号定位到规划阶段已冻结快照；合同已签署，任务图已建，`runWorker` 已启动随后模型解析失败。未宣称端到端闭环。

## 一、环境（事实）

- 运行源是 `/private/tmp/ide-worktrees/j55-key-retest`，HEAD `58016b7a5be56064a775b00b64e7555058924991`（与当时 `origin/main` 相同，含施工 `05e6f4e7909b0cf721c684a0b66b681daca794a9` 与 P-297 回写）。由已有 `/Users/tina/IDE` **只 fetch**（`origin/main` 由 `739ef21a` 更新到 `58016b7a`）后 `git worktree add --detach` 建成。未拉、未重置、未 checkout 改 `/Users/tina/IDE` 的 HEAD（仍为 `301aec2fa347225fd8fdaf7abe91965b9451afbd`，`main` behind origin）。未在 Tina 的 Mac 上 clone。未用 CloudAgent。
- 旧 Daemon 仍在跑：cwd `/private/tmp/ide-worktrees/j54-key-retest` @ `739ef21a2e97c3172c67d7a8ed3234b39bea4d23`，父进程 13140、子进程 13143 监听 `127.0.0.1:3001`，启动于 2026-11-25 05:44:49 香港时间。2026-11-25 14:26:49 香港时间对父进程 13140 发 SIGTERM，两进程均退出，端口释放。未杀无关进程。
- 新 Daemon 父进程 16648、子进程 16674 于 2026-11-25 14:28:17 香港时间启动：在该 worktree 执行 `./node_modules/.bin/tsx bin/stagent.ts open /Users/tina/Downloads/stagent-j45-key-playtest --port 3001 --no-browser`。依赖与钥匙沿用已有符号链接（`node_modules` → `/Users/tina/IDE/node_modules`，`.tmp/deepseek.env` → `/Users/tina/IDE/.tmp/deepseek.env`），未把 `.stagent/` 或钥匙拷出机、未打印内容。`GET /health` 返回 `status=ok`，`port=3001`，`repoRoot=/Users/tina/Downloads/stagent-j45-key-playtest`，`pid=16674`。启动日志：本机变量已加载 4 项，L1 补全已启用（DeepSeek / OpenAI 兼容口）；session-token 权限 0600。HTTP 认证只用 `Authorization: Bearer`（读该目录 session-token，未打印、未外传）。

## 二、复测前目录状态

未再补验收、未再冻结、未再分解。现场确认计划与规划阶段冻结快照仍在：

- 台账 `scheme-active` 修订号 **3**，`frozen=false`，`size_hint=standard`，标题「打开登录页后可以用手机号登录」，模块 `ITEM-1`「登录页」，合格验收一条：`id=ITEM-2`，`text=打开登录页后可以用手机号登录`，`source=user_said`。`updated_at` 仍为 2026-11-24T21:45:37.013Z，磁盘 mtime 仍为 2026-11-25 05:45:37 香港时间。
- 中栏投影：`available=true`，修订号 3，`frozen=false`，验收 `ITEM-2`，provenance「业主原话 · 细模型加层对齐」。
- `GET /api/project/plan` 200，`plan_revision=1`，`scheme_revision=3`，`next_stub_id=cs-1`。桩 `cs-1` 标题「登录页」，`acceptance_ids=["ITEM-2"]`，`status=planned`，`contract_id=null`。磁盘 `.stagent/project/plan.json` mtime 仍为 2026-11-25 05:47:45 香港时间。
- 规划阶段冻结快照仍在：`scheme-plan-1a20f8774e5-1f1e1f97`（mtime 2026-11-25 05:47:45 香港时间，10523 字节），`digest=13b688f692abab8eac73dd1644a38d12b8fadea7a33dad7966fdbc82baa13d2f`，快照内 `frozen=true`、修订号 3、验收为 `ITEM-2`。
- 历史空验收快照仍在、mtime 未变（本次未改写、未打成 4xx）：
  - `scheme-plan-mwujofon-p66842ot`（2026-11-24 18:21:22 香港时间）
  - `scheme-plan-mwumtg6x-ql5dyc9n`（2026-11-24 19:49:15 香港时间）
  - `scheme-plan-mwuuzd92-2pmvzk8v`（2026-11-24 23:37:48 香港时间）
- 精简 PAB `architecture-baseline.json` mtime 仍为 2026-11-24 19:49:15 香港时间（本次未改）。
- `GET /api/contracts` 仍只有先前旅程副作用那份 `DRAFT` 合同 `contract_1795556756329_1qqpk`（不是确认开工签署）。`GET /health` 的 `activeContracts` 为空。

台账与中栏的 `frozen` 仍为 false；冻结发生在快照文件，不在台账 `draft.frozen`。据实记录。

## 三、「确认开工」

已测。按生产地图路径用 HTTP 复现（不驱动 GUI；新开工 confirmation id，不把规划编号当 `confirmation_id` 发出去「修」）。

- `POST /api/supervisor/scope/preflight`（`stub_id=cs-1`）**200**（2026-11-25 14:31:49 香港时间），`plan_digest=7739b9322303030c3ba125ace4c82c6e31c6936a83adb25dc5d33ae9631372f9`，`needs_approval=[]`。
- 开工确认编号 `scheme-start-mwvqx2wu-l94cgfmw`。`POST /api/contracts` 返回 **201**（14:31:49 香港时间），合同 `contract_1795588309763_cy8zx`，`lifecycle_state=PENDING_APPROVAL`，`approval.status=PENDING_REVIEW`。`scheme_binding` 指向规划编号与该快照 digest：
  - `confirmation_id=scheme-plan-1a20f8774e5-1f1e1f97`
  - `snapshot_digest=13b688f692abab8eac73dd1644a38d12b8fadea7a33dad7966fdbc82baa13d2f`
  - `plan_digest=16493c9ba83e48e19018df7738ea31123c0e0690a23f67f3c850a6e621d1fe85`
  请求里的开工编号未被写入 binding。这是 J.55 查找路径在真钥匙环境下的实测结果（不再是 409 `E_SCHEME_SNAPSHOT_NOT_FOUND`）。
- 随后第一次 `POST /api/contracts/contract_1795588309763_cy8zx/approve`（同一开工编号，未带 `acknowledge_dirty`）返回 **409**，`code=E_WORKTREE_DIRTY`，`error=worktree_dirty_confirmation_required`，白话：「发现本地有 1 个未提交改动（例如 「.tmp/」）。请放心：它们不会进入施工树；点确认后会列入「绝不触碰」禁写名单。这不是故障，只是提醒你本地还有草稿。」（14:31:49 香港时间）。未改用规划编号重试。
- 按官方脏工作区确认路径，用同一开工编号再 `approve` 并带 `acknowledge_dirty=true`，返回 **200**（14:32:42 香港时间）。合同变为 `lifecycle_state=EXECUTING`，`approval.status=APPROVED`，`approved_by=local-user`，`approved_at=2026-11-25T06:32:42.481Z`（即 14:32:42 香港时间）。`scheme_binding` 仍为上述规划编号与 digest，未改。
- `POST /api/graph/proposal` **200**（14:32:42 香港时间），任务图 `graph_id=graph_1795588362553_e4fbb0f1`，12 个节点（「落实：src/**」「落实：package.json」「落实：tsconfig.json」等）。
- `POST /api/contracts/contract_1795588309763_cy8zx/run-worker` 已发出（14:32:42 香港时间）。接口于 14:33:05 香港时间返回 **400**，错误为：`Model call failed for contract contract_1795588309763_cy8zx: [E_WORKER_PARSE] No object generated: could not parse the response.` `runWorker` 已启动（模型调用已发生），随后解析失败。这不是开工确认读快照这一环的失败。

## 四、复测后目录要点

- 新签署合同 `contract_1795588309763_cy8zx`：`EXECUTING` / `APPROVED`，binding 为规划编号 `scheme-plan-1a20f8774e5-1f1e1f97` 与 digest `13b688f692abab8eac73dd1644a38d12b8fadea7a33dad7966fdbc82baa13d2f`。历史 `DRAFT` 合同仍在。
- 台账、规划冻结快照、三份历史空验收快照、PAB、`plan.json` 的 mtime 均未变。`GET /api/project/plan` 在 14:33:05 香港时间仍显示桩 `cs-1` 为 `planned` 且 `contract_id=null`（计划文件未被这次签署回写）。据实记录。
- `GET /health` 仍为 ok，`activeContracts` 仍为空。
- 未重开 J.55，未立新施工卡。

## 五、结论（不引申为施工授权）

锁定路径已走完。J.55 要验证的那一环已在同一试玩目录上实测通过：用新的 `scheme-start-…` 编号创建合同得到 201，`scheme_binding` 写的是规划编号与已冻结快照 digest，而不是开工编号。合同随后在官方脏工作区确认后签署成功（`APPROVED` / `EXECUTING`），任务图已建立（12 节点），`runWorker` 已启动，随后以 `E_WORKER_PARSE`（模型响应无法解析）失败。**未宣称端到端闭环。** 本次只验证开工确认读快照这一环。

## 附：E_WORKER_PARSE 只读排查（P-299 · 标 `ai_inferred`）

> **地位**：排查结论落账，不改产品代码，不立施工卡，不重开 J.55。不改写上文复测事实段。
> **依据**：2026-11-25 合入 #382 后的只读排查；Tina t1441u 授权排查、t1442u 确认结论并拍板落账与先补可观测性。操作者由我执行。
> **诚实口径**：标 `ai_inferred`。不把「解析器有 bug」当已证实结论。未宣称端到端闭环。

Worker 使用 `deepseek-flash`（DeepSeek OpenAI 兼容口）。系统提示来自 `buildWorkerTaskInstruction`，输出契约要求返回 `changes` 数组；结构化 schema 为 `{ changes:[{path,content}], log:string[] }`。

`POST /api/contracts/contract_1795588309763_cy8zx/run-worker` 于 2026-11-25 14:33:05 香港时间返回 **400**，耗时 22642ms，错误为：`[E_WORKER_PARSE] No object generated: could not parse the response.` 该句是 AI SDK 在 JSON 解析失败（不是 schema 校验失败）时的固定文案。

试玩目录日志与记录中无模型原始回复；`NoObjectGeneratedError.text` 未被读取或落盘。`daemon.jsonl` 只有 HTTP 400 索引（`ts=2026-11-25T06:33:05.204Z`，`requestId=068965233fe9`，`duration_ms=22642`）。失败发生在写 Worker 终端日志之前（无 `logs/worker-contract_1795588309763_cy8zx.jsonl`）。本地 `stripMarkdownFence` 未进入这条失败路径（生产主路径走 `generateObject`）。

因成功解析会写入 Worktree、扩大施工，未重试 run-worker。单次失败不能证明必现。

标 `ai_inferred`：约 22.6 秒更像含一次本地重试；在缺原文的前提下，不能判定是纯模型跑偏还是围栏/前后文导致 SDK 拒解析。不把「解析器有 bug」当已证实结论。

拍板已定为：先立卡补可观测性（TASK-J.56，本落账不立卡），`generateObject` 失败时把 SDK 错误对象里的 `text` 结构特征写入 daemon 日志（长度、是否以 markdown 围栏开头、解析失败原因、前后几十个字符片段；不落密钥、不落完整原文），再定修不修；不重试这次已签成合同的 run-worker。拿到原文特征后再定：模型真跑偏 → 修提示词/约束；合法 JSON 被包住 → 失败后回退已有的 `parseWorkerPatch`（含剥围栏）或给 `generateObject` 配同等修复。**未宣称端到端闭环。**
