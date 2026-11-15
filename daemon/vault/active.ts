/**
 * 活跃保险库注册表与上下文断言（叶子模块，零重依赖）。
 *
 * 为什么单独一个文件：`daemon/core/debug-log.ts` 的 `redactSecrets` 只读
 * `currentValues()`，但 `./vault` 门面为了选后端会 import `keychain-backend`
 * （spawn `security` / `secret-tool`）。一旦 debug-log 走门面，Supervisor 的
 * 「零工具静态依赖闭包」（TASK-S.1）就会被这个子进程依赖污染。
 * 注册表本身只读写一个模块级变量；共享断言函数同样不得引进 keychain。
 * Supervisor 与 debug-log 可安全引用本文件。
 */
import type { Vault } from "./types";

let activeVault: Vault | null = null;

export function getActiveVault(): Vault | null {
  return activeVault;
}

export function setActiveVault(vault: Vault | null): void {
  activeVault = vault;
}

export const E_VAULT_SECRET_IN_CONTEXT = "E_VAULT_SECRET_IN_CONTEXT" as const;

export class VaultSecretInContextError extends Error {
  readonly code = E_VAULT_SECRET_IN_CONTEXT;

  constructor() {
    super("凭据与秘密不得进入对话上下文");
    this.name = "VaultSecretInContextError";
  }
}

/**
 * 若文本包含已缓存且长度 ≥6 的保险库值，则抛出 VaultSecretInContextError。
 * 失败必须中止发出，不得脱敏后继续。错误消息不得回带密钥本身。
 * 未传入 values 时读 getActiveVault()?.currentValues()；无活跃库或缓存为空
 * 不视为失败（缓存未加载是已知限制，不是硬失败）。
 */
export function assertContextHasNoVaultSecrets(
  text: string,
  values?: readonly string[],
): void {
  const secrets = (values ?? getActiveVault()?.currentValues() ?? []).filter(
    (value) => value.length >= 6,
  );
  for (const value of secrets) {
    if (text.includes(value)) {
      throw new VaultSecretInContextError();
    }
  }
}
