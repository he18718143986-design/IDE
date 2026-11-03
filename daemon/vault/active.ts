/**
 * 活跃保险库注册表（叶子模块，零重依赖）。
 *
 * 为什么单独一个文件：`daemon/core/debug-log.ts` 的 `redactSecrets` 只读
 * `currentValues()`，但 `./vault` 门面为了选后端会 import `keychain-backend`
 * （spawn `security` / `secret-tool`）。一旦 debug-log 走门面，Supervisor 的
 * 「零工具静态依赖闭包」（TASK-S.1）就会被这个子进程依赖污染。
 * 注册表本身只读写一个模块级变量，因此可以安全地放在这里。
 */
import type { Vault } from "./types";

let activeVault: Vault | null = null;

export function getActiveVault(): Vault | null {
  return activeVault;
}

export function setActiveVault(vault: Vault | null): void {
  activeVault = vault;
}
