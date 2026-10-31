/**
 * 本地加密文件后端（OQ-REL-1 回退 B）：`.stagent/vault.enc`
 * AES-256-GCM；主密钥由机器+仓库路径派生，不在仓库留明文值。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { VaultBackend } from "./types";

const VAULT_FILE = "vault.enc";
const VERSION = 1;

interface VaultFilePayload {
  v: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function vaultEncPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".stagent", VAULT_FILE);
}

function deriveKey(repoRoot: string, salt: Buffer): Buffer {
  const material = [
    "stagent-vault-v1",
    path.resolve(repoRoot),
    os.homedir(),
    os.hostname(),
  ].join("|");
  const passphrase = createHash("sha256").update(material).digest("hex");
  return scryptSync(passphrase, salt, 32);
}

function readPayload(repoRoot: string): Record<string, string> {
  const file = vaultEncPath(repoRoot);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as VaultFilePayload;
  if (parsed.v !== VERSION) {
    throw new Error(`unsupported vault.enc version: ${parsed.v}`);
  }
  const salt = Buffer.from(parsed.salt, "hex");
  const iv = Buffer.from(parsed.iv, "hex");
  const tag = Buffer.from(parsed.tag, "hex");
  const key = deriveKey(repoRoot, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "hex")),
    decipher.final(),
  ]).toString("utf-8");
  return JSON.parse(plain) as Record<string, string>;
}

function writePayload(
  repoRoot: string,
  secrets: Record<string, string>,
): void {
  const file = vaultEncPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(repoRoot, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(secrets), "utf-8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload: VaultFilePayload = {
    v: VERSION,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
  fs.writeFileSync(file, JSON.stringify(payload), {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows 无 Unix 权限位
  }
}

export class FileVaultBackend implements VaultBackend {
  readonly kind = "file" as const;

  constructor(private readonly repoRoot: string) {}

  private load(): Record<string, string> {
    return readPayload(this.repoRoot);
  }

  private save(secrets: Record<string, string>): void {
    writePayload(this.repoRoot, secrets);
  }

  async set(name: string, value: string): Promise<void> {
    const secrets = this.load();
    secrets[name] = value;
    this.save(secrets);
  }

  async get(name: string): Promise<string | null> {
    const secrets = this.load();
    return secrets[name] ?? null;
  }

  async delete(name: string): Promise<void> {
    const secrets = this.load();
    if (!(name in secrets)) return;
    delete secrets[name];
    this.save(secrets);
  }

  async listNames(): Promise<string[]> {
    return Object.keys(this.load()).sort();
  }
}
