import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { safeRmSync } from "../helpers/tmp";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  createVault,
  setActiveVault,
  getActiveVault,
  VaultError,
  E_VAULT_VALUE_TOO_SHORT,
  E_VAULT_NAME_INVALID,
  E_VAULT_NOT_FOUND,
  vaultEncPath,
  MemoryVaultBackend,
} from "../../daemon/vault";
import { redactSecrets as redactCmd } from "../../daemon/runner/command-runner";
import { redactSecrets as redactLog } from "../../daemon/core/debug-log";
import { buildCommandEnvironment } from "../../daemon/worker/policy-guard";
import { buildWorkerTaskInstruction } from "../../daemon/worker/session-task-injector";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { buildSupervisorPrompt } from "../../daemon/supervisor/prompt-builder";
import type {
  SupervisorContextBundle,
  SupervisorSession,
} from "../../daemon/supervisor/types";
import { SUPERVISOR_SESSION_SCHEMA_VERSION } from "../../daemon/supervisor/types";

const SECRET = "vault-secret-value-XYZ-42";
const SECRET_NAME = "DEPLOY_TOKEN";

function requestJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; raw: string; body: T }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: T;
          try {
            body = raw ? (JSON.parse(raw) as T) : ({} as T);
          } catch {
            body = raw as unknown as T;
          }
          resolve({ status: res.statusCode ?? 0, raw, body });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

describe("TASK-L.14 凭据保险库", () => {
  let repo: string;
  let prevBackend: string | undefined;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-vault-"));
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    prevBackend = process.env["STAGENT_VAULT_BACKEND"];
    process.env["STAGENT_VAULT_BACKEND"] = "file";
    setActiveVault(null);
  });

  afterEach(() => {
    setActiveVault(null);
    if (prevBackend === undefined) delete process.env["STAGENT_VAULT_BACKEND"];
    else process.env["STAGENT_VAULT_BACKEND"] = prevBackend;
    safeRmSync(repo);
  });

  it("file 后端：set / list / resolve / delete；vault.enc 无明文", async () => {
    const vault = await createVault({ repoRoot: repo, backend: "file" });
    setActiveVault(vault);
    expect(vault.backendKind).toBe("file");

    await vault.setSecret(SECRET_NAME, SECRET);
    expect(await vault.listNames()).toEqual([SECRET_NAME]);
    expect(await vault.resolveEnv([SECRET_NAME])).toEqual({
      [SECRET_NAME]: SECRET,
    });
    expect(vault.currentValues()).toContain(SECRET);

    const enc = fs.readFileSync(vaultEncPath(repo), "utf-8");
    expect(enc).not.toContain(SECRET);
    expect(enc).not.toContain(SECRET_NAME); // 名字也在密文载荷里

    await vault.deleteSecret(SECRET_NAME);
    expect(await vault.listNames()).toEqual([]);
  });

  it("短于 8 字符 → E_VAULT_VALUE_TOO_SHORT；非法名 → E_VAULT_NAME_INVALID", async () => {
    const vault = await createVault({
      repoRoot: repo,
      backend: new MemoryVaultBackend(),
    });
    await expect(vault.setSecret("X", "short")).rejects.toMatchObject({
      code: E_VAULT_VALUE_TOO_SHORT,
    });
    await expect(vault.setSecret("bad-name!", SECRET)).rejects.toMatchObject({
      code: E_VAULT_NAME_INVALID,
    });
    await expect(vault.resolveEnv(["MISSING"])).rejects.toMatchObject({
      code: E_VAULT_NOT_FOUND,
    });
  });

  it("command-runner 与 debug-log 的 redactSecrets 均遮蔽保险库值", async () => {
    const vault = await createVault({
      repoRoot: repo,
      backend: new MemoryVaultBackend(),
    });
    setActiveVault(vault);
    await vault.setSecret(SECRET_NAME, SECRET);

    const sample = `deploy with ${SECRET} ok`;
    const cmd = redactCmd(sample);
    expect(cmd.text).toContain("[REDACTED]");
    expect(cmd.text).not.toContain(SECRET);
    expect(cmd.redacted).toBe(true);

    const logged = redactLog(sample);
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain(SECRET);
  });

  it("RO-08：Worker 指令 / Supervisor 输入 / 命令环境不含保险库值", async () => {
    const vault = await createVault({
      repoRoot: repo,
      backend: new MemoryVaultBackend(),
    });
    setActiveVault(vault);
    await vault.setSecret(SECRET_NAME, SECRET);

    const draft = createContractDraft({
      title: "task",
      description: "desc",
      acceptanceCriteria: ["ok"],
      writablePaths: ["src/**"],
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tester",
        approved_at: new Date().toISOString(),
      },
    });
    const worktreeRoot = path.join(repo, ".stagent", "worktrees", "c1");
    fs.mkdirSync(worktreeRoot, { recursive: true });
    const instruction = buildWorkerTaskInstruction({
      contract,
      worktreeRoot,
      repoRoot: repo,
    });
    const workerBlob = JSON.stringify(instruction);
    expect(workerBlob.includes(SECRET)).toBe(false);

    const now = new Date().toISOString();
    const session: SupervisorSession = {
      schema_version: SUPERVISOR_SESSION_SCHEMA_VERSION,
      session_id: "s1",
      created_at: now,
      updated_at: now,
      messages: [
        {
          message_id: "m1",
          role: "user",
          text: "请帮我部署",
          created_at: now,
          source: "ui",
        },
      ],
    };
    const context: SupervisorContextBundle = {
      project: {
        repo_root: repo,
        branch: "main",
        dirty: false,
      },
      architecture: {
        constraints: ["local-first"],
      },
    };
    const prompt = buildSupervisorPrompt({ session, context });
    expect(prompt.text.includes(SECRET)).toBe(false);

    const envPack = buildCommandEnvironment({
      permissions: contract.authorization.execution_permissions,
      worktreeRoot,
    });
    expect(JSON.stringify(envPack.env).includes(SECRET)).toBe(false);
    // 脱敏清单应含保险库值（供输出遮蔽），但 env 本身不含
    // （gateway 合并 secretValues；此处直接测 policy-guard 不注入）
  });

  describe("HTTP /api/vault（生产主路径）", () => {
    let daemon: StagentDaemon | null = null;

    afterEach(async () => {
      if (daemon?.isRunning) await daemon.stop();
      daemon = null;
    });

    it("PUT 后 GET 只含名字；响应体无明文；短值 400；DELETE 清空", async () => {
      process.env["STAGENT_VAULT_BACKEND"] = "file";
      daemon = createDaemon({
        repoRoot: repo,
        startPort: 3701,
        endPort: 3710,
        consolePublicDir: null,
      });
      const info = await daemon.start();
      const token = daemon.getSessionToken();
      expect(token).toBeTruthy();
      const base = `http://127.0.0.1:${info.port}`;
      const auth = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      };

      const put = await requestJson<{ ok: boolean; name: string }>(
        `${base}/api/vault/${SECRET_NAME}`,
        {
          method: "PUT",
          headers: auth,
          body: JSON.stringify({ value: SECRET }),
        },
      );
      expect(put.status).toBe(200);
      expect(put.raw).not.toContain(SECRET);
      expect(put.body.name).toBe(SECRET_NAME);

      const listed = await requestJson<{
        names: string[];
        backend: string;
      }>(`${base}/api/vault`, { headers: auth });
      expect(listed.status).toBe(200);
      expect(listed.body.names).toEqual([SECRET_NAME]);
      expect(listed.raw).not.toContain(SECRET);

      const shortPut = await requestJson<{ code?: string }>(
        `${base}/api/vault/SHORT`,
        {
          method: "PUT",
          headers: auth,
          body: JSON.stringify({ value: "abc" }),
        },
      );
      expect(shortPut.status).toBe(400);
      expect(shortPut.body.code).toBe(E_VAULT_VALUE_TOO_SHORT);
      expect(shortPut.raw).not.toContain("abc");

      // 进程内 resolveEnv（Daemon 内部 API）
      const active = getActiveVault();
      expect(active).toBeTruthy();
      expect(await active!.resolveEnv([SECRET_NAME])).toEqual({
        [SECRET_NAME]: SECRET,
      });

      const del = await requestJson(`${base}/api/vault/${SECRET_NAME}`, {
        method: "DELETE",
        headers: auth,
      });
      expect(del.status).toBe(200);
      const after = await requestJson<{ names: string[] }>(
        `${base}/api/vault`,
        { headers: auth },
      );
      expect(after.body.names).toEqual([]);

      // FAIL：vault.enc 无明文
      if (fs.existsSync(vaultEncPath(repo))) {
        const enc = fs.readFileSync(vaultEncPath(repo), "utf-8");
        expect(enc).not.toContain(SECRET);
      }
    });

    it("无 Token → 401", async () => {
      daemon = createDaemon({
        repoRoot: repo,
        startPort: 3711,
        endPort: 3720,
        consolePublicDir: null,
      });
      const info = await daemon.start();
      const base = `http://127.0.0.1:${info.port}`;
      const get = await requestJson(`${base}/api/vault`);
      expect(get.status).toBe(401);
    });
  });
});
