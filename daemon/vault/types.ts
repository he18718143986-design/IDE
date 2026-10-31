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
