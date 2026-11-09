# TASK-J.1 partner 只读 · 真实 CLI 验证记录（2026-10-28）

## 结论

以 `role: "partner"` 的启动参数运行**真实 `claude` CLI 2.1.296**，让它写 `target.txt`：

- CLI 在工具准入层直接拒绝：`No such tool available: Write. Write is disabled for this session, in subagents as well as here.`
- `target.txt` 未创建；`README.md` 与 `src/a.ts` 字节不变。
- PreToolUse hook 在本次会话中确实被加载并执行（`Read` 调用留下 `decision:"allow"`），写类调用的 deny 分支由 `tests/integration/partner-readonly.test.ts` 用同一份 env 直接验证（exit 2 + `permissionDecision:"deny"`）。
- 用户级 `~/.claude.json` 与项目级 `.mcp.json` 里埋的 MCP 服务器均未被加载：`init.mcp_servers = []`，且两个 marker 文件都不存在。
- 项目 `.claude/settings.json` 里埋的恶意 hook 也未执行（`--setting-sources ""` 生效）。

## 环境与限制（必须知道的边界）

版本登记（`claude --version` 原样输出，2026-10-28）：

```text
$ claude --version
2.1.296 (Claude Code)
```

| 项 | 值 |
| --- | --- |
| CLI | `claude` 2.1.296（`/Users/tina/.local/node/bin/claude`） |
| 凭据 | **本机未登录、无 `ANTHROPIC_API_KEY`**；`claude -p` 直接返回 `Not logged in` |
| 模型端点 | 本机 stub `127.0.0.1:3955`（Anthropic Messages 兼容，**仅替代模型**） |
| 真实部分 | CLI 二进制、argv、`--settings`、`permissions`、PreToolUse hook、文件系统 |

**口径声明**：本次真实 CLI 验证**使用的是替代模型端点**（本地 stub）；权限层与 hook 为**真实执行**，不是模拟。
CLI 运行时的版本检查不在 TASK-J.1 范围内，本轮**不实现**，仅作为挂账项登记（见 [`../ledger/consistency-audit.md`](../ledger/consistency-audit.md) OP-28；原指向的 `open-items-2026-10-28.md` 从未入库）。

因此本次是「真实 CLI + 替身模型」：权限与 hook 链路完全真实，模型输出是脚本化的（固定返回一次 `Read` + 一次 `Write`）。

## 实际启动参数（节选）

```
--setting-sources ""
--tools Read,Glob,Grep,LS
--permission-mode default
--allowedTools Read,Glob,Grep,LS
--disallowedTools WebFetch,WebSearch,NotebookEdit,Task,Bash,Edit,Write,MultiEdit,TodoWrite
--settings <tmp>/settings.json
--mcp-config <tmp>/mcp.json
--strict-mcp-config
```

- `--permission-mode default`：help 未列出该值，但 2.1.296 的 commander 校验接受它（`bogus` 会报 `Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`），运行时 `init.permissionMode` 回显为 `default`。
- `--setting-sources ""` + `--settings` + `--strict-mcp-config` 组合下，CLI 只加载 Stagent 生成的 settings 与空 MCP 集合。

## 运行时事实（取自 stream-json）

```json
{ "type": "system", "subtype": "init",
  "permissionMode": "default",
  "tools": ["Glob", "Grep", "Read"],
  "mcp_servers": [] }
```

```json
{ "type": "user",
  "message": { "content": [{ "type": "tool_result",
    "content": "<tool_use_error>Error: No such tool available: Write. Write is disabled for this session, in subagents as well as here.</tool_use_error>" }] } }
```

> 注：`--tools` 里传了 `LS`，但 2.1.296 初始化后只暴露 `Glob/Grep/Read`——`LS` 在该版本不是独立工具，会被丢弃。这是可用性差异，不影响只读性（三个工具都是只读）。

## 拒绝记录

`hook.log`（同一会话）：

```json
{"at":"2026-10-27T21:45:31.640Z","tool":"Read","decision":"allow"}
```

写类调用没有到达 hook：它在更前面的工具准入层就被拒了（双层设计的预期优先级）。hook 的 deny 分支见集成测试断言：`status=2`、`permissionDecision="deny"`、理由含「只读」。

## 原始记录

- `summary.json`：本次运行的机器可读结论
- `argv.json`：实际 argv 与 env key 列表（不含密钥值）
- `stdout.jsonl`：CLI stream-json 全量输出
- `hook.log`：PreToolUse 判定日志
- `requests.jsonl`：stub 收到的两次模型请求（脱敏）
- `stderr.log`：空

复现脚本：`.tmp/j1-verify/{stub-anthropic.mjs,run-partner-verify.ts}`（临时目录，不进版本库）。
