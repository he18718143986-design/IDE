import { z } from "zod";

/**
 * Scoped MCP 工具协议类型（Daemon 侧唯一事实源）。
 * 浏览器端内存网关已随 M5 双轨消解删除（审计 D7）。
 */

export const StagentReadFileSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
});
export type StagentReadFileInput = z.infer<typeof StagentReadFileSchema>;

export const StagentWriteFileSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
  content: z.string(),
  /**
   * 乐观并发锁（TASK-W.2 G-03）：可选。
   * 传入时必须等于磁盘现有内容的 SHA-256（hex）；不匹配抛 `E_CONFLICT`。
   */
  expected_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "expected_hash must be a SHA-256 hex digest")
    .optional(),
});
export type StagentWriteFileInput = z.infer<typeof StagentWriteFileSchema>;

/**
 * 命令执行输入。
 * - 首选 `command_alias`：仅接受合同 `verification_spec.commands[].alias`；
 * - 兼容 `command` / `executable + args`（内部验证路径，不经 Worker 暴露）。
 */
export const StagentExecCommandSchema = z
  .object({
    command: z.string().min(1).optional(),
    executable: z.string().min(1).optional(),
    command_alias: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
  })
  .refine(
    (value) =>
      (value.command !== undefined && value.command.length > 0) ||
      (value.executable !== undefined && value.executable.length > 0) ||
      (value.command_alias !== undefined && value.command_alias.length > 0),
    { message: "command, executable or command_alias is required" },
  );
export type StagentExecCommandInput = z.infer<typeof StagentExecCommandSchema>;

export const StagentListDirSchema = z.object({
  path: z.string().default("."),
  /** 递归列举（深度优先，上限 500 条，跳过 .git/.stagent/禁区） */
  recursive: z.boolean().optional(),
});
export type StagentListDirInput = z.infer<typeof StagentListDirSchema>;

/** 规范命名别名：`stagent_list_directory` 与历史 `stagent_list_dir` 共用同一 Schema */
export const StagentListDirectorySchema = StagentListDirSchema;
export type StagentListDirectoryInput = StagentListDirInput;

/** 删除普通文件（目录删除在 v0.1 不提供，避免误删整棵子树） */
export const StagentDeleteFileSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
});
export type StagentDeleteFileInput = z.infer<typeof StagentDeleteFileSchema>;

/** 第 5 个工具：由服务端依据实际 Scope / 预算 / 测试结果判定是否可进入审计 */
export const StagentDeclareCompleteSchema = z.object({
  summary: z.string().max(2000).optional(),
  touched_paths: z.array(z.string()).optional(),
});
export type StagentDeclareCompleteInput = z.infer<
  typeof StagentDeclareCompleteSchema
>;

export interface DeclareCompleteBlocker {
  code: string;
  message: string;
}

export interface DeclareCompleteResult {
  ready_for_audit: boolean;
  blockers: DeclareCompleteBlocker[];
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCallResult<T = unknown> {
  isError?: boolean;
  content: Array<{
    type: "text";
    text: string;
  }>;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AuditLogEntry {
  timestamp: string;
  tool: string;
  input: unknown;
  outcome: "SUCCESS" | "BLOCKED" | "FAILED";
  violationCode?: string;
  details?: string;
}

/**
 * TASK-W.8 / TASK-L.17a：只读外网参考源抓取工具输入 Schema。
 * 目标 URL 的域名必须命中合同/方案 references[] 白名单。
 */
export const StagentWebIngestSchema = z.object({
  url: z.string().url("url must be a valid HTTP/HTTPS URL"),
  format: z.enum(["html", "text", "summary"]).default("html").optional(),
});
export type StagentWebIngestInput = z.infer<typeof StagentWebIngestSchema>;

export const E_INGEST_NOT_WIRED = "E_INGEST_NOT_WIRED";
export const E_WEB_INGEST_FORBIDDEN_DOMAIN = "E_WEB_INGEST_FORBIDDEN_DOMAIN";
