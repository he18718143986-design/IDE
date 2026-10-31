import type { VaultBackend } from "./types";

/** 测试用内存后端；进程内有效，不落盘。 */
export class MemoryVaultBackend implements VaultBackend {
  readonly kind = "memory" as const;
  private readonly store = new Map<string, string>();

  async set(name: string, value: string): Promise<void> {
    this.store.set(name, value);
  }

  async get(name: string): Promise<string | null> {
    return this.store.has(name) ? (this.store.get(name) as string) : null;
  }

  async delete(name: string): Promise<void> {
    this.store.delete(name);
  }

  async listNames(): Promise<string[]> {
    return [...this.store.keys()].sort();
  }
}
