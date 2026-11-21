# ADR-0015 主链断点（只读走查 · P-261）

> **地位**：只读走查。不改产品代码，不开施工分支，不立施工卡。  
> **基线**：`main` `629f85fded770b05d8ceaef4739b955b67376d22`。  
> **走查范围**：一句需求输入 → `SchemeDraftV2` 生成 → 项目计划 / 里程碑分解 → 合同确认开工 → 试玩 → 合入。  
> **已知候选**（`buildSupervisorPrompt` 生产零调用、`TASK-D.1e` DEFERRED）只作对照，不作为本次结论的前提。

## 断点（一句话）

用户在右栏发出一句需求之后，走不过「得到一份可审阅的 `SchemeDraftV2`」：官方 Daemon 不注入意图编译器模型客户端，编译循环走离线且不把方案写入台账，中栏停在「方案尚未生成」，「确认方案」不会出现。

## 这一步之前发生了什么

右栏发送会先登记原话，再去刷新中栏。非质疑的话随后仍交给右侧对话，发送本身没有被拦住。

- `src/routes/index.tsx` 第 1209–1266 行：`handleJourneyBeforeSend` 调用 `registerSchemeTurn`，未冻结时 `refreshSchemeFromLedger`，非质疑返回 `passthrough`。
- `daemon/server.ts` 第 4316–4365 行：`POST /api/supervisor/turns` 经 `commitUserTurn` 把原话写入 transcript，并通知编译循环。
- `daemon/supervisor/intent-compiler/host.ts` 第 202–229 行：`commitUserTurn` 落盘后调用 `notifyUserTurnCommitted`。

## 为什么方案出不来

官方启动不传入编译器模型客户端，默认是 `null`。没有钥匙时编译循环走离线，离线只打横幅、不写台账。中栏读台账，没有实质内容就标「方案尚未生成」，确认按钮不渲染。

- `bin/stagent.ts` 第 344–351 行：`createDaemon` 只传仓库、端口和可选的 `supervisorEnrich`，不传 `intentCompilerModelClient`。
- `daemon/server.ts` 第 641–644 行：选项缺省时 `intentCompilerModelClient` 为 `null`。全仓生产入口只有这里赋值；测试桩除外。
- `daemon/server.ts` 第 970–991 行：`ensureIntentCompilerHost` 把这个 `null` 交给宿主，且没有接 `onOfflineFallback`。
- `daemon/supervisor/intent-compiler/compile-loop.ts` 第 318–321 行、第 620–629 行：无钥匙或 `modelClient === null` 时 `runOffline`；离线调用 `onOfflineFallback`，不写 `SchemeDraftV2`。
- `daemon/supervisor/intent-compiler/scheme-midpane-projection.ts` 第 137–143 行：台账草案没有实质内容时 `available` 为 false。
- `src/lib/journey/scheme-draft.ts` 第 150–151 行：`available=false` 映射为 `null`。
- `src/components/studio/SchemeReviewPane.tsx` 第 375–383 行：台账缺失时显示「方案尚未生成」，不进入确认方案按钮。

## 后面几步

项目计划分解、确认开工、试玩、合入在代码里有入口，但都排在「已有可审阅方案」之后。这次走查停在方案没有生成，没有把后面几步判成断点。

`buildSupervisorPrompt` 的生产零调用（P-233）不在这句需求到方案的这条调用上，本次不把它写成断点。`TASK-D.1e` 是安装形态，主链还没走到那里，本次也不把它写成断点。

## 不做的事

不立卡，不改 ADR-0015，不改产品代码。若要修这个断点，须另点名。
