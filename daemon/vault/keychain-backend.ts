/**
 * 系统钥匙串后端（OQ-REL-1 决议 A）。
 * macOS：`security` CLI；Linux：`secret-tool`（无则探测失败，由 createVault 回退文件）。
 * 名字索引落在 `.stagent/vault-index.json`（仅名字，无值）。
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { VaultBackend } from "./types";

const execFileAsync = promisify(execFile);
const SERVICE = "stagent.vault";
const INDEX_FILE = "vault-index.json";

function indexPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".stagent", INDEX_FILE);
}

function readIndex(repoRoot: string): string[] {
  const file = indexPath(repoRoot);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      names?: string[];
    };
    return Array.isArray(parsed.names) ? [...parsed.names].sort() : [];
  } catch {
    return [];
  }
}

function writeIndex(repoRoot: string, names: string[]): void {
  const file = indexPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ names: [...new Set(names)].sort() }, null, 2) + "\n",
    { encoding: "utf-8", mode: 0o600 },
  );
}

async function run(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "", code: 0 };
  } catch (err) {
    const e = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const code = typeof e.code === "number" ? e.code : 1;
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
      code,
    };
  }
}

function spawnWithStdin(
  cmd: string,
  args: string[],
  stdin: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf-8");
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err) }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function probeKeychainAvailable(): Promise<boolean> {
  if (process.platform === "darwin") {
    const r = await run("which", ["security"]);
    return r.code === 0 && r.stdout.trim().length > 0;
  }
  if (process.platform === "linux") {
    const which = await run("which", ["secret-tool"]);
    return which.code === 0 && which.stdout.trim().length > 0;
  }
  return false;
}

export class KeychainVaultBackend implements VaultBackend {
  readonly kind = "keychain" as const;

  constructor(private readonly repoRoot: string) {}

  private account(name: string): string {
    return `${path.resolve(this.repoRoot)}::${name}`;
  }

  async set(name: string, value: string): Promise<void> {
    if (process.platform === "darwin") {
      const r = await run("security", [
        "add-generic-password",
        "-U",
        "-s",
        SERVICE,
        "-a",
        this.account(name),
        "-w",
        value,
      ]);
      if (r.code !== 0) {
        throw new Error(`macOS Keychain 写入失败: ${r.stderr || r.stdout}`);
      }
    } else if (process.platform === "linux") {
      const r = await spawnWithStdin(
        "secret-tool",
        [
          "store",
          "--label",
          `stagent:${name}`,
          "service",
          SERVICE,
          "account",
          this.account(name),
        ],
        value,
      );
      if (r.code !== 0) {
        throw new Error(`Linux Secret Service 写入失败: ${r.stderr}`);
      }
    } else {
      throw new Error(`keychain backend unsupported on ${process.platform}`);
    }
    const names = readIndex(this.repoRoot);
    if (!names.includes(name)) names.push(name);
    writeIndex(this.repoRoot, names);
  }

  async get(name: string): Promise<string | null> {
    if (process.platform === "darwin") {
      const r = await run("security", [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        this.account(name),
        "-w",
      ]);
      if (r.code !== 0) return null;
      return r.stdout.replace(/\n$/, "");
    }
    if (process.platform === "linux") {
      const r = await run("secret-tool", [
        "lookup",
        "service",
        SERVICE,
        "account",
        this.account(name),
      ]);
      if (r.code !== 0) return null;
      return r.stdout.replace(/\n$/, "");
    }
    return null;
  }

  async delete(name: string): Promise<void> {
    if (process.platform === "darwin") {
      await run("security", [
        "delete-generic-password",
        "-s",
        SERVICE,
        "-a",
        this.account(name),
      ]);
    } else if (process.platform === "linux") {
      await run("secret-tool", [
        "clear",
        "service",
        SERVICE,
        "account",
        this.account(name),
      ]);
    }
    writeIndex(
      this.repoRoot,
      readIndex(this.repoRoot).filter((n) => n !== name),
    );
  }

  async listNames(): Promise<string[]> {
    return readIndex(this.repoRoot);
  }
}
