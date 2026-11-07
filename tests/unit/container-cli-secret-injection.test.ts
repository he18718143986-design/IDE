/**
 * TASK-W.9f：容器 API key 不以普通 Env 明文直通；改 secret 文件挂载。
 * W9F-P1～P4。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DockerContainerHost,
  materializeSecretFiles,
  cleanupMaterializedSecrets,
} from "../../daemon/worker/cli-host/docker-container-host";
import {
  OPENHANDS_CAPABILITY,
  OpenHandsSandboxAdapter,
} from "../../daemon/worker/cli-host/openhands-adapter";
import {
  executeContainerCli,
  splitContainerEnvAndSecrets,
} from "../../daemon/worker/sandbox/container-cli-executor";
import {
  CONTAINER_SECRET_ENV_KEYS,
  CONTAINER_SECRET_MOUNT_DIR,
  containerSecretFile,
  validateSandboxInput,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
} from "../../daemon/worker/sandbox/container-host";

const roots: string[] = [];
function worktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w9f-cli-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

const ok: SandboxRunOutcome = {
  exitCode: 0,
  stdout: "done",
  stderr: "",
  via: "exit",
  durationMs: 5,
};

const SECRET_KEYS = [
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CURSOR_API_KEY",
] as const;

describe("W.9f container secret injection", () => {
  it("W9F-P1: 普通 Env 无四键明文", async () => {
    for (const key of SECRET_KEYS) {
      expect(CONTAINER_SECRET_ENV_KEYS.has(key)).toBe(true);
    }
    const secretValue = "sk-w9f-plain-env-must-not-appear";
    const seen: SandboxRunInput[] = [];
    const runner = vi.fn(
      async (
        _host: ContainerHostPort,
        input: SandboxRunInput,
        _signal?: AbortSignal,
      ) => {
        seen.push(input);
        return ok;
      },
    );
    const host: ContainerHostPort = {
      kind: "fake/w9f",
      isAvailable: () => true,
      run: vi.fn(async () => ok),
    };
    await executeContainerCli({
      host,
      worktreeRoot: worktree(),
      argv: ["tool"],
      expectedArtifacts: [],
      declaredControlMode: "SANDBOX_ENFORCED",
      env: {
        HOME: "/tmp",
        LLM_API_KEY: secretValue,
        OPENAI_API_KEY: secretValue,
        ANTHROPIC_API_KEY: secretValue,
        CURSOR_API_KEY: secretValue,
      },
      runSandbox: runner,
    });
    expect(runner).toHaveBeenCalledOnce();
    const sent = seen[0]!;
    expect(sent.env ?? {}).toEqual({ HOME: "/tmp" });
    for (const key of SECRET_KEYS) {
      expect(sent.env?.[key]).toBeUndefined();
    }
    // validateSandboxInput 也拒绝四键进 plain env
    expect(() =>
      validateSandboxInput({
        worktreeRoot: worktree(),
        argv: ["x"],
        env: { LLM_API_KEY: secretValue },
      }),
    ).toThrow(/SECRET_IN_PLAIN_ENV/);
  });

  it("W9F-P2: 受控通道可读凭据", async () => {
    const secretValue = "sk-w9f-controlled-channel";
    const seen: SandboxRunInput[] = [];
    const runner = vi.fn(
      async (
        _host: ContainerHostPort,
        input: SandboxRunInput,
        _signal?: AbortSignal,
      ) => {
        seen.push(input);
        // 桩宿主：经 secretFiles 受控通道读到凭据（不必真连模型）
        const file = input.secretFiles?.find(
          (s) =>
            s.containerPath === `${CONTAINER_SECRET_MOUNT_DIR}/CURSOR_API_KEY`,
        );
        expect(file?.content).toBe(secretValue);
        return {
          ...ok,
          stdout: `read-via-secret:${file?.content ?? ""}`,
        };
      },
    );
    const host: ContainerHostPort = {
      kind: "fake/w9f",
      isAvailable: () => true,
      run: vi.fn(async () => ok),
    };
    const result = await executeContainerCli({
      host,
      worktreeRoot: worktree(),
      argv: ["tool"],
      expectedArtifacts: [],
      declaredControlMode: "SANDBOX_ENFORCED",
      env: { CURSOR_API_KEY: secretValue },
      runSandbox: runner,
    });
    const sent = seen[0]!;
    expect(sent.env?.["CURSOR_API_KEY"]).toBeUndefined();
    expect(sent.secretFiles).toEqual([
      containerSecretFile("CURSOR_API_KEY", secretValue),
    ]);
    // Docker 物化：临时文件可读，且 buildArgs 以 :ro 挂载、不以 -e 明文
    const materialized = materializeSecretFiles(sent.secretFiles, "/work");
    try {
      expect(materialized).toHaveLength(1);
      expect(fs.readFileSync(materialized[0]!.hostPath, "utf8")).toBe(
        secretValue,
      );
      const docker = new DockerContainerHost({
        forceAvailable: true,
        image: "test/image:w9f",
      });
      const args = docker.buildArgs(
        {
          worktreeRoot: worktree(),
          argv: ["true"],
          ...(sent.secretFiles === undefined
            ? {}
            : { secretFiles: sent.secretFiles }),
        },
        "stagent-sbx-w9f",
        materialized,
      );
      const envFlags = args.reduce<string[]>((acc, a, i) => {
        if (a === "-e") acc.push(args[i + 1]!);
        return acc;
      }, []);
      expect(envFlags.some((e) => e.startsWith("CURSOR_API_KEY="))).toBe(false);
      expect(envFlags).toContain(
        `CURSOR_API_KEY_FILE=${CONTAINER_SECRET_MOUNT_DIR}/CURSOR_API_KEY`,
      );
      const volumes = args.reduce<string[]>((acc, a, i) => {
        if (a === "-v") acc.push(args[i + 1]!);
        return acc;
      }, []);
      expect(
        volumes.some((v) =>
          v.endsWith(`:${CONTAINER_SECRET_MOUNT_DIR}/CURSOR_API_KEY:ro`),
        ),
      ).toBe(true);
    } finally {
      cleanupMaterializedSecrets(materialized);
    }
    // 日志侧不得回显（P3 交叉；此处确认桩 stdout 已被脱敏）
    expect(result.log.join("\n")).not.toContain(secretValue);
  });

  it("W9F-P3: 日志不回显", async () => {
    const secretValue = "sk-w9f-must-redact-in-logs";
    const runner = vi.fn(
      async (
        _host: ContainerHostPort,
        _input: SandboxRunInput,
        _signal?: AbortSignal,
      ) => ({
        ...ok,
        stdout: `token=${secretValue}`,
        stderr: `leak ${secretValue}`,
      }),
    );
    const host: ContainerHostPort = {
      kind: "fake/w9f",
      isAvailable: () => true,
      run: vi.fn(async () => ok),
    };
    const result = await executeContainerCli({
      host,
      worktreeRoot: worktree(),
      argv: ["tool"],
      expectedArtifacts: [],
      declaredControlMode: "SANDBOX_ENFORCED",
      env: {
        LLM_API_KEY: secretValue,
        OPENAI_API_KEY: secretValue,
      },
      runSandbox: runner,
    });
    const joined = result.log.join("\n");
    expect(joined).not.toContain(secretValue);
    expect(joined).toContain("[REDACTED]");
    // 拆分结果：普通 Env 无密钥；secret 通道有值
    const split = splitContainerEnvAndSecrets({
      HOME: "/tmp",
      ANTHROPIC_API_KEY: secretValue,
    });
    expect(split.plainEnv).toEqual({ HOME: "/tmp" });
    expect(split.secretFiles[0]?.content).toBe(secretValue);
  });

  it("W9F-P4: known_limitations 与实现一致", async () => {
    const limitation = OPENHANDS_CAPABILITY.known_limitations.find((line) =>
      line.includes("secret"),
    );
    expect(limitation).toBeDefined();
    expect(limitation).toMatch(/只读 secret 文件挂载/);
    expect(limitation).toMatch(/\/run\/secrets\/LLM_API_KEY/);
    expect(limitation).not.toMatch(/未使用 secret 挂载/);
    expect(limitation).toMatch(/不宣称绝对不可读/);

    const secretValue = "sk-w9f-openhands";
    const seen: SandboxRunInput[] = [];
    const host: ContainerHostPort = {
      kind: "fake/openhands-w9f",
      isAvailable: () => true,
      run: vi.fn(async (input) => {
        seen.push(input);
        return ok;
      }),
    };
    const adapter = new OpenHandsSandboxAdapter({
      host,
      apiKey: () => secretValue,
      networkPolicy: "DENY",
    });
    // containerEnv 不得含 LLM_API_KEY
    expect(adapter.containerEnv()["LLM_API_KEY"]).toBeUndefined();
    expect(adapter.secretFilesForKey(secretValue)).toEqual([
      containerSecretFile("LLM_API_KEY", secretValue),
    ]);

    await adapter.run({
      contract: {
        id: "w9f",
        title: "w9f",
        description: "w9f",
        acceptance_criteria: ["x"],
        writable_paths: ["src/**"],
        lifecycle_state: "EXECUTING",
        revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        approval: {
          status: "APPROVED",
          approved_by: "tina",
          approved_at: new Date().toISOString(),
        },
        worker_spec: { adapter_id: "stagent.openhands.sandbox.v0" },
      } as never,
      contract_revision: 1,
      worktree_root: worktree(),
      system_prompt: "noop",
      exposed_tools: [],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.env?.["LLM_API_KEY"]).toBeUndefined();
    expect(seen[0]!.secretFiles).toEqual([
      containerSecretFile("LLM_API_KEY", secretValue),
    ]);
    // argv 仍是 headless CLI（未改壳，避免破坏既有派工断言）
    expect(seen[0]!.argv.slice(0, 3)).toEqual([
      "python",
      "-m",
      "openhands.core.main",
    ]);
  });
});
