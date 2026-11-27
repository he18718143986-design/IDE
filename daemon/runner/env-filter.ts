/**
 * 子进程环境隔离（TASK-W.3 / 规范 A §4.3）。
 *
 * 策略为**白名单**而非黑名单：
 * 1. 默认只透传运行所必需的基础变量（PATH / HOME / LANG / TMPDIR 等）；
 * 2. 合同 `allowed_environment_variable_names` 显式声明的变量名可透传宿主值；
 * 3. 其余宿主变量一律不进入子进程——即使名字看起来「无害」；
 * 4. 凭据类变量**硬拒绝**：即便合同显式声明，也不把宿主 Token / 云密钥 /
 *    SSH 认证变量交给任务代码（规范 A §4.3「不得把宿主密钥交给不可信代码」）。
 *
 * 另外注入 `CI=true`、`NODE_ENV=test`、`TERM=dumb`，保证测试行为可复现。
 */

const PRESERVED_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "NODE_PATH",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "PWD",
]);

/**
 * 凭据类硬拒绝：命中即丢弃，合同显式授权也不放行。
 * 覆盖 OpenAI/Anthropic/AWS/GitHub/Slack 令牌、SSH 认证套接字与通用
 * SECRET/TOKEN/PASSWORD/CREDENTIAL/PRIVATE_KEY 命名。
 */
const HARD_DENIED_PATTERNS: RegExp[] = [
  /^AWS_/i,
  /^GITHUB_/i,
  /^GH_/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
  /^LOVABLE_/i,
  /^SSH_/i,
  /^GPG_/i,
  /^AZURE_/i,
  /^GOOGLE_/i,
  /^SLACK_/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /PRIVATE_KEY/i,
  /API_KEY/i,
];

export interface EnvSanitizerOptions {
  /** 合同 `env_file_grants` 解析出的变量（已按 alias 授权，直接注入） */
  extraEnv?: Record<string, string>;
  /** 合同 `allowed_environment_variable_names`：允许透传宿主值的变量名 */
  allowedKeyOverrides?: string[];
}

function isHardDenied(key: string): boolean {
  return HARD_DENIED_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * 白名单过滤：返回可直接传给 `spawn` 的环境字典。
 */
export function sanitizeEnvironment(
  rawEnv: NodeJS.ProcessEnv = process.env,
  options: EnvSanitizerOptions = {},
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const overrides = new Set(options.allowedKeyOverrides ?? []);

  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === undefined) continue;
    // 凭据类硬拒绝优先于任何授权
    if (isHardDenied(key)) continue;

    const allowedByDefault = PRESERVED_KEYS.has(key);
    const allowedByContract = overrides.has(key);
    if (!allowedByDefault && !allowedByContract) continue;

    sanitized[key] = value;
  }

  // 显式注入的合同 env-file 变量：来源是合同授权的文件（非宿主环境），
  // 允许 TOKEN/SECRET 之类命名；其值由命令层登记为秘密值，输出时遮蔽。
  if (options.extraEnv) {
    for (const [key, value] of Object.entries(options.extraEnv)) {
      sanitized[key] = value;
    }
  }

  sanitized["CI"] = "true";
  if (!sanitized["NODE_ENV"]) {
    sanitized["NODE_ENV"] = "test";
  }
  sanitized["TERM"] = "dumb";

  return sanitized;
}

/**
 * 解析合同显式授权的 env 文件内容（`KEY=VALUE` 行）。
 *
 * 只做最小解析：忽略空行与 `#` 注释，去掉成对引号；不执行变量插值，
 * 不复制未在 `env_file_grants.variable_names` 中声明的键（由调用方筛选）。
 */
export function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

/**
 * TASK-P1.4: 敏感凭据脱敏函数。
 * 覆盖「凭据值出现在输出中即替换」而非仅按变量名过滤。
 * 只要秘密值非空且长度达到阈值（或已登记），凡在字符串中出现，均替换为 [REDACTED]。
 */
export function redactSensitiveText(
  text: string,
  secretValues: readonly string[],
): { text: string; redacted: boolean } {
  if (!text || !secretValues || secretValues.length === 0) {
    return { text: text ?? "", redacted: false };
  }
  let out = text;
  let redacted = false;
  // 过滤空串，并按长度降序排列（避免短前缀提前截断长字符串）
  const validSecrets = secretValues
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  for (const secret of validSecrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join("[REDACTED]");
      redacted = true;
    }
  }
  return { text: out, redacted };
}

/**
 * 递归对象深度脱敏，用于 audit entry、error details、MCP 回包等复杂对象
 */
export function redactSensitiveObject<T>(
  target: T,
  secretValues: readonly string[],
): T {
  if (target === null || target === undefined) return target;
  if (typeof target === "string") {
    return redactSensitiveText(target, secretValues).text as unknown as T;
  }
  if (Array.isArray(target)) {
    return target.map((item) =>
      redactSensitiveObject(item, secretValues),
    ) as unknown as T;
  }
  if (typeof target === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
      res[k] = redactSensitiveObject(v, secretValues);
    }
    return res as T;
  }
  return target;
}
