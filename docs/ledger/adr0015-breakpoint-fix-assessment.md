# ADR-0015 断点修复评估（只读 · P-262）

> **地位**：只读评估。不改产品代码，不立施工卡。建议标 `ai_inferred`。  
> **基线**：`main` `288d0d6658c1fc652081af92e2720388e1e67850`（[#331](https://github.com/he18718143986-design/IDE/pull/331) P-261）。  
> **要修的断点**：[`adr0015-mainline-breakpoint.md`](./adr0015-mainline-breakpoint.md) 第 10 行。用户发出一句需求后，得不到可审阅的 `SchemeDraftV2`。

## 结论

建议下一张卡做「生产注入意图编译器模型客户端」，估算 M。不把离线语料写进台账。无钥匙时继续离线、不产方案，这是编译循环已写明的 L-7，不是这张卡要绕过的行为。

## 事实

1. 接口已经在。`IntentCompilerModelClient.generate` 定义在 `daemon/supervisor/intent-compiler/compile-loop.ts` 第 95–98 行。注释写「生产注入 generateObject」。全仓没有这个接口的生产实现，只有测试桩。
2. 官方进程不注入。`bin/stagent.ts` 第 344–351 行的 `createDaemon` 不传 `intentCompilerModelClient`。`daemon/server.ts` 第 641–644 行缺省为 `null`。
3. `null` 走离线，离线不写方案。`compile-loop.ts` 第 318–321 行、第 620–629 行：无钥匙或客户端为 `null` 时 `runOffline`，只调用 `onOfflineFallback`。`daemon/server.ts` 第 970–991 行创建宿主时没有接这个回调。
4. 有桩就能落盘。`tests/integration/intent-compiler-journey-wiring.test.ts` 在传入桩客户端时，一句「我要一个登录页」会 CAS 写入台账，模块来源是 `user_said`，且结果里没有 `partner_hint`。同一文件证明客户端为 `null` 时 `lastStatus` 为 `offline`、`modelCalls` 为 0。
5. 工人客户端不能直接拿来当编译器客户端。`daemon/worker/openai-client.ts` 的 `OpenAiWorkerClient` 输出的是授权范围内的文件补丁，不是方案 op。钥匙在 `daemon/worker/key-store.ts`：`getRuntimeKey()` 读进程内钥匙，否则读 `OPENAI_API_KEY`。编译循环今天不读这个钥匙库。
6. 离线启发式存在，但标明不可溯源。`compile-loop.ts` 第 651–657 行 `buildOfflineSchemeDraft` 调用 `rebuildSchemeFromCorpus`，注释写「无证据、不可溯源（L-7）」。编译循环文件头第 9 行：无钥匙只发离线信号，不把编译器输出回流右栏。

## 两条修法

### A. 生产注入模型客户端（建议）

`ai_inferred`：在 Daemon 启动时，若 `getRuntimeKey()` 有值，构造一个 `IntentCompilerModelClient`，用现有 `generateObject` 路径按编译器 schema 要方案 op，交给 `createDaemon({ intentCompilerModelClient })`。无钥匙则保持 `null`，行为与现在的离线一致。

这样做对齐的是断点本身：客户端不再永远是 `null`。有钥匙时走已有的组装、merge、CAS。失败仍走现成的 `noteFailure` 和横幅，不伪造一份方案。

预计要动：新建编译器客户端（不复用工人文件补丁客户端）、`bin/stagent.ts` 注入、以及一份「有钥匙写出 `user_said` 模块 / 无钥匙仍 offline」的测试。`src/routes/index.tsx` 不必改，右栏发送已经调用 `commitUserTurn`。估算 M。

### B. 把离线语料写进台账（不建议）

`ai_inferred`：给宿主接上 `onOfflineFallback`，把 `buildOfflineSchemeDraft` 的结果 CAS 进台账。中栏会离开「方案尚未生成」，但内容无证据、不可溯源，和 L-7 的写法相反。不作为这张断点的修法。

## 不在这张评估里做的事

不改 ADR-0014，不把编译结果写进右栏。不把 `buildSupervisorPrompt` 接到这条编译循环上。不改 ADR-0015 的合同单位。不激活蓝图。不在本评估里写产品代码，不立施工卡。

无钥匙时用户仍然看不到方案。那是 L-7 已写明的离线，要另点名才讨论要不要改。
