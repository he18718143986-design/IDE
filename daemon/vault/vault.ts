/**
 * TASK-L.14 凭据保险库门面。
 *
 * - 值只存在后端（钥匙串 / 加密文件 / 测试内存）与进程内缓存；
 * - HTTP 永不返回明文；
 * - `currentValues()` 供命令输出 / 日志脱敏（同步，读缓存）；
 * - 保险库值**不**进 Worker 环境白名单（由调用方保证；L.15/L.17 才注入）。
 */
import {
  assertValidSecretName,
  assertValidSecretValue,
  type VaultBackend,
  VaultError,
  E_VAULT_NOT_FOUND,
} from "./types";
import { FileVaultBackend } from "./file-backend";
import {
  KeychainVaultBackend,
  probeKeychainAvailable,
} from "./keychain-backend";
import { MemoryVaultBackend } from "./memory-backend";

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

export interface CreateVaultOptions {
  repoRoot: string;
  /**
   * 强制后端：`memory`（测）、`file`（回退/CI）、`keychain`（生产首选）。
   * 缺省：钥匙串可用则 keychain，否则 file。
   * 环境变量 `STAGENT_VAULT_BACKEND` 亦可覆盖。
   */
  backend?: VaultBackend["kind"] | VaultBackend;
}

class VaultImpl implements Vault {
  private readonly cache = new Map<string, string>();

  constructor(private readonly backend: VaultBackend) {}

  get backendKind(): VaultBackend["kind"] {
    return this.backend.kind;
  }

  async hydrate(): Promise<void> {
    this.cache.clear();
    const names = await this.backend.listNames();
    for (const name of names) {
      const value = await this.backend.get(name);
      if (value !== null) this.cache.set(name, value);
    }
  }

  async setSecret(name: string, value: string): Promise<void> {
    assertValidSecretName(name);
    assertValidSecretValue(value);
    await this.backend.set(name, value);
    this.cache.set(name, value);
  }

  async listNames(): Promise<string[]> {
    const fromBackend = await this.backend.listNames();
    // 与缓存并集，避免索引短暂落后
    const set = new Set([...fromBackend, ...this.cache.keys()]);
    return [...set].sort();
  }

  async deleteSecret(name: string): Promise<void> {
    assertValidSecretName(name);
    await this.backend.delete(name);
    this.cache.delete(name);
  }

  async resolveEnv(names: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of names) {
      assertValidSecretName(name);
      let value = this.cache.get(name);
      if (value === undefined) {
        const fromBackend = await this.backend.get(name);
        if (fromBackend === null) {
          throw new VaultError(
            E_VAULT_NOT_FOUND,
            `保险库里没有名为 ${name} 的密钥`,
          );
        }
        value = fromBackend;
        this.cache.set(name, value);
      }
      out[name] = value;
    }
    return out;
  }

  currentValues(): string[] {
    return [...this.cache.values()].filter((v) => v.length >= 6);
  }
}

let activeVault: Vault | null = null;

export function getActiveVault(): Vault | null {
  return activeVault;
}

export function setActiveVault(vault: Vault | null): void {
  activeVault = vault;
}

export async function createVault(options: CreateVaultOptions): Promise<Vault> {
  const envKind = process.env["STAGENT_VAULT_BACKEND"] as
    | VaultBackend["kind"]
    | undefined;
  const requested = options.backend ?? envKind;

  let backend: VaultBackend;
  if (requested && typeof requested === "object") {
    backend = requested;
  } else if (requested === "memory") {
    backend = new MemoryVaultBackend();
  } else if (requested === "file") {
    backend = new FileVaultBackend(options.repoRoot);
  } else if (requested === "keychain") {
    backend = new KeychainVaultBackend(options.repoRoot);
  } else if (await probeKeychainAvailable()) {
    backend = new KeychainVaultBackend(options.repoRoot);
  } else {
    backend = new FileVaultBackend(options.repoRoot);
  }

  const vault = new VaultImpl(backend);
  await vault.hydrate();
  return vault;
}

export {
  VaultError,
  E_VAULT_VALUE_TOO_SHORT,
  E_VAULT_NAME_INVALID,
  E_VAULT_NOT_FOUND,
  VAULT_MIN_VALUE_LENGTH,
} from "./types";
