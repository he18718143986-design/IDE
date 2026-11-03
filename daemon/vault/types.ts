/**
 * TASK-L.14 凭据保险库 —— 后端契约与错误。
 * Spec：`docs/specs/release-and-operations.md` §4；ADR-0014 §3。
 */

export const E_VAULT_VALUE_TOO_SHORT = "E_VAULT_VALUE_TOO_SHORT" as const;
export const E_VAULT_NAME_INVALID = "E_VAULT_NAME_INVALID" as const;
export const E_VAULT_NOT_FOUND = "E_VAULT_NOT_FOUND" as const;
export const VAULT_MIN_VALUE_LENGTH = 8;

/** 合法变量名：字母/下划线开头，后接字母数字下划线（环境变量惯例） */
export const VAULT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface VaultBackend {
  readonly kind: "keychain" | "file" | "memory";
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | null>;
  delete(name: string): Promise<void>;
  listNames(): Promise<string[]>;
}

/**
 * 保险库门面接口。
 *
 * 刻意放在本文件（零依赖叶子）：`daemon/core/debug-log.ts` 只需要
 * `currentValues()` 做日志脱敏，若它从 `./vault` 取该接口，模块图会被带到
 * `keychain-backend`（spawn `security` / `secret-tool`），令 Supervisor 的
 * 「零工具静态依赖闭包」失效（TASK-S.1）。
 */
export interface Vault {
  readonly backendKind: VaultBackend["kind"];
  setSecret(name: string, value: string): Promise<void>;
  listNames(): Promise<string[]>;
  deleteSecret(name: string): Promise<void>;
  resolveEnv(names: string[]): Promise<Record<string, string>>;
  /** 同步：当前缓存中的全部秘密值（供 redactSecrets） */
  currentValues(): string[];
  /** 启动时从后端灌入缓存 */
  hydrate(): Promise<void>;
}

export class VaultError extends Error {
  readonly code:
    | typeof E_VAULT_VALUE_TOO_SHORT
    | typeof E_VAULT_NAME_INVALID
    | typeof E_VAULT_NOT_FOUND;

  constructor(
    code:
      | typeof E_VAULT_VALUE_TOO_SHORT
      | typeof E_VAULT_NAME_INVALID
      | typeof E_VAULT_NOT_FOUND,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export function assertValidSecretName(name: string): void {
  if (!name || !VAULT_NAME_RE.test(name)) {
    throw new VaultError(
      E_VAULT_NAME_INVALID,
      `密钥名不合法：只能用字母/下划线开头，后接字母数字下划线（收到：${JSON.stringify(name)}）`,
    );
  }
}

export function assertValidSecretValue(value: string): void {
  if (value.length < VAULT_MIN_VALUE_LENGTH) {
    throw new VaultError(
      E_VAULT_VALUE_TOO_SHORT,
      `密钥太短（至少 ${VAULT_MIN_VALUE_LENGTH} 个字符），太短无法可靠脱敏`,
    );
  }
}
