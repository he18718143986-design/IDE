import { redactSecrets } from "../core/debug-log";
import {
  WORKER_PARSE_FAILURE_SNIPPET_MAX,
  WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH,
} from "../worker/parse-worker-output";

/** 与 J.56 常量相等：片段头尾各最多 40 字符 */
export const VERIFY_COMMAND_SNIPPET_MAX = WORKER_PARSE_FAILURE_SNIPPET_MAX;
/** 与 J.56 常量相等：长度大于 80 才写 head/tail */
export const VERIFY_COMMAND_SNIPPET_MIN_LENGTH =
  WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH;

export type VerifyCommandSnippet = {
  text_length: number;
  head?: string;
  tail?: string;
};

/**
 * 先 redactSecrets，再按 J.56 口径切片段。
 * 禁止产出名为 text / raw / full 的字段；长度小于等于 80 不写 head/tail。
 */
export function buildCommandOutputSnippet(raw: string): VerifyCommandSnippet {
  const redacted = redactSecrets(raw);
  const text_length = redacted.length;
  if (text_length > VERIFY_COMMAND_SNIPPET_MIN_LENGTH) {
    return {
      text_length,
      head: redacted.slice(0, VERIFY_COMMAND_SNIPPET_MAX),
      tail: redacted.slice(-VERIFY_COMMAND_SNIPPET_MAX),
    };
  }
  return { text_length };
}

export type VerifyCommandLogDetailInput = {
  alias: string;
  stdout: string;
  stderr: string;
  /** 失败与启动/解析失败为 true；成功路径必须为 false（只写长度和退出码） */
  includeSnippets: boolean;
  exit_code?: number;
  error?: string;
  reason?: string;
  spawn_code?: string;
};

/** 供 appendDaemonLog detail 使用；不含 text/raw/full，不把原文写入 message。 */
export function buildVerifyCommandLogDetail(
  input: VerifyCommandLogDetailInput,
): Record<string, unknown> {
  const stdoutSnippet = buildCommandOutputSnippet(input.stdout);
  const stderrSnippet = buildCommandOutputSnippet(input.stderr);
  const detail: Record<string, unknown> = {
    alias: input.alias,
    stdout_length: stdoutSnippet.text_length,
    stderr_length: stderrSnippet.text_length,
  };
  if (input.exit_code !== undefined) {
    detail["exit_code"] = input.exit_code;
  }
  if (input.error !== undefined) {
    detail["error"] = input.error;
  }
  if (input.reason !== undefined) {
    detail["reason"] = input.reason;
  }
  if (input.spawn_code !== undefined) {
    detail["spawn_code"] = input.spawn_code;
  }
  if (input.includeSnippets) {
    if (stdoutSnippet.head !== undefined) {
      detail["stdout_head"] = stdoutSnippet.head;
    }
    if (stdoutSnippet.tail !== undefined) {
      detail["stdout_tail"] = stdoutSnippet.tail;
    }
    if (stderrSnippet.head !== undefined) {
      detail["stderr_head"] = stderrSnippet.head;
    }
    if (stderrSnippet.tail !== undefined) {
      detail["stderr_tail"] = stderrSnippet.tail;
    }
  }
  return detail;
}
