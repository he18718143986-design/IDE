export {
  createVault,
  getActiveVault,
  setActiveVault,
  VaultError,
  E_VAULT_VALUE_TOO_SHORT,
  E_VAULT_NAME_INVALID,
  E_VAULT_NOT_FOUND,
  VAULT_MIN_VALUE_LENGTH,
  type Vault,
  type CreateVaultOptions,
} from "./vault";
export type { VaultBackend } from "./types";
export { FileVaultBackend, vaultEncPath } from "./file-backend";
export { MemoryVaultBackend } from "./memory-backend";
export {
  KeychainVaultBackend,
  probeKeychainAvailable,
} from "./keychain-backend";
