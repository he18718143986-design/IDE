# bin 模块接口

## stagent open

- **类型**：cli
- **签名**：`stagent open <path> [--port <n>]` → 启动 Daemon 并打印带 `#token=` 的本地控制台地址
- **提供方**：`bin` / [`../../../bin/stagent.ts`](../../../bin/stagent.ts)
- **消费方**：用户、`STAGENT_EDITOR` 集成
- **引入合同**：`repo-knowledge-baseline`

## stagent check knowledge

- **类型**：cli
- **签名**：`stagent check knowledge --base <sha> --candidate <sha> --contract-id <id> [--all]` → 退出码 0/1，stdout JSON
- **提供方**：`bin` / `bin/stagent.ts`（调用 `daemon/knowledge/check-knowledge.ts`）
- **消费方**：Daemon 合并前证据、CI 的 `Knowledge check` job
- **引入合同**：`repo-knowledge-baseline`
