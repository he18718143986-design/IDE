import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ManagedProcess,
  ManagedProcessOptions,
} from "../../daemon/worker/cli-host/process-host";
import {
  DockerContainerHost,
  type DockerProbe,
} from "../../daemon/worker/cli-host/docker-container-host";
import {
  SandboxWitnessValidationError,
  sandboxWitness,
  verifySandboxWitness,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
  type SandboxWitness,
  type SandboxMountMode,
} from "../../daemon/worker/sandbox/container-host";
import { OpenHandsSandboxAdapter } from "../../daemon/worker/cli-host/openhands-adapter";
import { executeContainerCli } from "../../daemon/worker/sandbox/container-cli-executor";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  deriveCanMerge,
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import type { SoftwareContract } from "../../src/lib/contract.schema";

const availableProbe: DockerProbe = {
  ok: true,
  server_version: "24.0.0",
  detail: "test docker daemon running",
};

function baseEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const evidence: EvidenceBundle = {
    evidence_id: "evi_p03b2",
    contract_id: "contract_p03b2",
    generated_at: new Date().toISOString(),
    usage: {
      currency: "CNY",
      pricing_version: "v1",
      accounting_mode: "ESTIMATED",
      estimated_cost_minor_units: 100,
      limit_reached: false,
    },
    worktree_snapshot: {
      head_sha: "abc123456789",
      snapshot_fingerprint: "fp_abc123456789",
      captured_at: new Date().toISOString(),
    },
    verdict: {
      status: "PASSED",
      can_merge: true,
      summary: "all gates passed",
    },
    scope_audit: {
      passed: true,
      files_changed: [
        { path: "src/index.ts", additions: 3, deletions: 1, binary: false },
      ],
      forbidden_violations: [],
      budget_exhausted: false,
    },
    verification_results: [
      {
        command_alias: "test",
        exit_code: 0,
        stdout_tail: "ok",
        stderr_tail: "",
        duration_ms: 12,
        passed: true,
      },
    ],
    git_info: {
      base_commit_sha: "base_sha_123",
      task_commit_sha: "task_sha_123",
      diff_stat: "1 file changed",
      patch_fingerprint: "sha256_mock_fp",
    },
  };
  return { ...evidence, ...overrides };
}

describe("DockerContainerHost Mount Execution (TASK-P0.3b-2)", () => {
  let tempDir: string;
  let worktree: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbx-mount-test-"));
    worktree = path.join(tempDir, "worktree");
    fs.mkdirSync(worktree, { recursive: true });
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "index.ts"),
      "export const ok = 1;",
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createHost(
    overrides: {
      probe?: () => DockerProbe;
      spawn?: ((opts: ManagedProcessOptions) => ManagedProcess) | undefined;
    } = {},
  ) {
    return new DockerContainerHost({
      probe: overrides.probe ?? (() => availableProbe),
      spawn:
        overrides.spawn ??
        (() => {
          throw new Error("spawn not expected");
        }),
    });
  }

  it("P03B2-P1: buildArgs 在 scoped 模式生成根 :ro、.git tmpfs 遮蔽与独立 :rw 挂载", () => {
    const host = createHost();
    const args = host.buildArgs(
      {
        worktreeRoot: worktree,
        argv: ["python", "-V"],
        mountMode: "scoped",
        scope: {
          writable_paths: ["src/index.ts", "src/new-file.ts"],
        },
      },
      "test-container",
    );

    const resolvedWorktree = path.resolve(worktree);
    const resolvedIndex = path.resolve(worktree, "src/index.ts");
    const resolvedNew = path.resolve(worktree, "src/new-file.ts");

    // 1. Worktree 根只读挂载
    expect(args).toContain("-v");
    expect(args).toContain(`${resolvedWorktree}:/work:ro`);

    // 2. /work/.git tmpfs 遮蔽
    expect(args).toContain("--tmpfs");
    const tmpfsIdx = args.indexOf("--tmpfs");
    expect(args[tmpfsIdx + 1]).toBe("/work/.git:rw,noexec,nosuid");

    // 3. 授权文件独立 :rw 挂载
    expect(args).toContain(`${resolvedIndex}:/work/src/index.ts:rw`);
    expect(args).toContain(`${resolvedNew}:/work/src/new-file.ts:rw`);
  });

  it("P03B2-P2: buildArgs 在 readonly_enforced 模式仅生成根 :ro 与 .git tmpfs，无任何 :rw 挂载", () => {
    const host = createHost();
    const args = host.buildArgs(
      {
        worktreeRoot: worktree,
        argv: ["npm", "test"],
        mountMode: "readonly_enforced",
        scope: {
          writable_paths: ["src/index.ts"],
        },
      },
      "test-readonly-container",
    );

    const resolvedWorktree = path.resolve(worktree);
    expect(args).toContain(`${resolvedWorktree}:/work:ro`);
    expect(args).toContain("--tmpfs");
    expect(args[args.indexOf("--tmpfs") + 1]).toBe(
      "/work/.git:rw,noexec,nosuid",
    );

    // 不包含任何 :rw 挂载
    const rwMounts = args.filter((a) => a.endsWith(":rw"));
    expect(rwMounts).toHaveLength(0);
  });

  it("P03B2-P3: 未指定 scope/mountMode 时向后兼容回退为全卷单挂载", () => {
    const host = createHost();
    const args = host.buildArgs(
      {
        worktreeRoot: worktree,
        argv: ["python", "-V"],
      },
      "test-legacy-container",
    );

    const resolvedWorktree = path.resolve(worktree);
    expect(args).toContain(`${resolvedWorktree}:/work`);
    expect(args).not.toContain(`${resolvedWorktree}:/work:ro`);
    expect(args).not.toContain("--tmpfs");
  });

  it("P03B2-P3: run 执行产出包含真实 mountMode 与 mountCount，并预建占位文件", async () => {
    let capturedArgs: string[] = [];
    const host = createHost({
      spawn: (opts: ManagedProcessOptions) => {
        capturedArgs = opts.args;
        return {
          pid: 1234,
          lines: (async function* () {
            yield "executed\n";
          })(),
          exited: Promise.resolve({ code: 0, signal: null }),
          stop: async () => ({ via: "exit" as const, ms: 1 }),
          stderr: () => "",
        };
      },
    });

    const placeholderTarget = "src/not-yet-created.ts";
    const hostPlaceholder = path.join(worktree, placeholderTarget);
    expect(fs.existsSync(hostPlaceholder)).toBe(false);

    const outcome = await host.run({
      worktreeRoot: worktree,
      argv: ["python", "-c", "print(1)"],
      mountMode: "scoped",
      scope: {
        writable_paths: ["src/index.ts", placeholderTarget],
      },
    });

    // 占位文件应已被自动创建为 0 字节文件
    expect(fs.existsSync(hostPlaceholder)).toBe(true);
    expect(fs.statSync(hostPlaceholder).size).toBe(0);

    // 产出的 outcome 记录实际挂载模式与挂载总数
    expect(outcome.mountMode).toBe("scoped");
    // 根 ro (1) + .git tmpfs (1) + 2 个 rw 挂载 = 4
    expect(outcome.mountCount).toBe(4);
    expect(outcome.via).toBe("exit");
    expect(outcome.exitCode).toBe(0);
  });

  it("P03B2-P3: 越界或非法 scope 在 run 阶段 fail-closed 拦截并返回 rejected", async () => {
    const host = createHost();
    const outcome = await host.run({
      worktreeRoot: worktree,
      argv: ["python", "-V"],
      mountMode: "scoped",
      scope: {
        writable_paths: ["../escape.txt"],
      },
    });

    expect(outcome.via).toBe("rejected");
    expect(outcome.exitCode).toBeNull();
    expect(outcome.stderr).toContain("MOUNT_SCOPE_INVALID");
  });

  it("P03B2-P4: sandboxWitness 如实记录 mount_mode 与 mount_count", () => {
    const mockHost: ContainerHostPort = {
      kind: "DOCKER",
      isAvailable: () => true,
      run: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        via: "exit",
        durationMs: 100,
      }),
    };

    const input: SandboxRunInput = {
      worktreeRoot: worktree,
      argv: ["echo", "1"],
      mountMode: "scoped",
    };

    const outcome: SandboxRunOutcome = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      via: "exit",
      durationMs: 42,
      mountMode: "scoped",
      mountCount: 3,
    };

    const witness = sandboxWitness(mockHost, input, outcome);
    expect(witness.host_kind).toBe("DOCKER");
    expect(witness.mount_mode).toBe("scoped");
    expect(witness.mount_count).toBe(3);
  });

  it("P03B2-P4: verifySandboxWitness 模式与数量有效性断言", () => {
    const valid = {
      host_kind: "DOCKER",
      via: "exit" as const,
      exit_code: 0,
      duration_ms: 100,
      worktree_root: "/repo",
      mount_mode: "scoped" as const,
      mount_count: 3,
    };

    expect(() => verifySandboxWitness(valid)).not.toThrow();

    const invalidMode = {
      ...valid,
      mount_mode: "arbitrary_mode" as unknown as SandboxWitness["mount_mode"],
    };
    expect(() => verifySandboxWitness(invalidMode)).toThrow(
      SandboxWitnessValidationError,
    );
    expect(() => verifySandboxWitness(invalidMode)).toThrow(
      /WITNESS_MOUNT_MODE_INVALID/,
    );

    const invalidCountNegative = {
      ...valid,
      mount_count: -1,
    };
    expect(() => verifySandboxWitness(invalidCountNegative)).toThrow(
      /WITNESS_MOUNT_COUNT_INVALID/,
    );

    const invalidCountFloat = {
      ...valid,
      mount_count: 2.5,
    };
    expect(() => verifySandboxWitness(invalidCountFloat)).toThrow(
      /WITNESS_MOUNT_COUNT_INVALID/,
    );
  });

  it("P03B2-P4: evidenceBundleSchema 与 deriveCanMerge 校验 mount_mode / mount_count", () => {
    const base = baseEvidence({
      worker_control_mode: "SANDBOX_ENFORCED",
      sandbox_witness: {
        host_kind: "DOCKER",
        via: "exit",
        exit_code: 0,
        duration_ms: 250,
        worktree_root: "/work",
        mount_mode: "scoped",
        mount_count: 4,
      },
    });

    expect(evidenceBundleSchema.safeParse(base).success).toBe(true);

    const invalidBundleMode = {
      ...base,
      sandbox_witness: {
        ...base.sandbox_witness!,
        mount_mode: "not_a_valid_mode" as unknown as NonNullable<
          SandboxWitness["mount_mode"]
        >,
      },
    };
    expect(evidenceBundleSchema.safeParse(invalidBundleMode).success).toBe(
      false,
    );

    const invalidBundleCount = {
      ...base,
      sandbox_witness: {
        ...base.sandbox_witness!,
        mount_count: -5,
      },
    };
    expect(evidenceBundleSchema.safeParse(invalidBundleCount).success).toBe(
      false,
    );

    const passingInput = {
      status: "PASSED" as const,
      scopePassed: true,
      budgetExhausted: false,
      forbiddenViolationCount: 0,
      contractRevision: 1,
      workerControlMode: "SANDBOX_ENFORCED" as const,
      sandboxWitness: {
        host_kind: "DOCKER",
        via: "exit" as const,
        exit_code: 0,
        duration_ms: 250,
        worktree_root: "/work",
        mount_mode: "scoped" as const,
        mount_count: 4,
      },
    };

    expect(deriveCanMerge(passingInput)).toBe(true);

    expect(
      deriveCanMerge({
        ...passingInput,
        sandboxWitness: {
          ...passingInput.sandboxWitness,
          mount_mode: "invalid_mode" as unknown as NonNullable<
            SandboxWitness["mount_mode"]
          >,
        },
      }),
    ).toBe(false);

    expect(
      deriveCanMerge({
        ...passingInput,
        sandboxWitness: {
          ...passingInput.sandboxWitness,
          mount_count: -1,
        },
      }),
    ).toBe(false);
  });

  it("P03B2-P5: OpenHandsSandboxAdapter 从 contract 读取 writable_paths 透传 scope", async () => {
    let capturedInput: SandboxRunInput | undefined;
    const adapter = new OpenHandsSandboxAdapter({
      host: createHost(),
      apiKey: () => "test-key",
      runSandbox: async (_h, input) => {
        capturedInput = input;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          via: "exit",
          durationMs: 10,
        };
      },
    });

    const mockContract = {
      authorization: {
        file_system_scope: {
          writable_paths: ["src/index.ts", "package.json"],
          readonly_paths: [],
          strictly_forbidden_paths: [],
        },
      },
    } as unknown as SoftwareContract;

    await adapter.run({
      contract: mockContract,
      contract_revision: 1,
      worktree_root: worktree,
      system_prompt: "do something",
      exposed_tools: [],
    });

    expect(capturedInput?.mountMode).toBe("scoped");
    expect(capturedInput?.scope?.writable_paths).toEqual([
      "src/index.ts",
      "package.json",
    ]);
  });

  it("P03B2-P5: executeContainerCli 透传 scope 与 mountMode", async () => {
    let capturedInput: SandboxRunInput | undefined;
    await executeContainerCli({
      host: createHost(),
      worktreeRoot: worktree,
      argv: ["node", "-v"],
      expectedArtifacts: [],
      declaredControlMode: "SANDBOX_ENFORCED",
      mountMode: "readonly_enforced",
      scope: {
        writable_paths: ["src/index.ts"],
      },
      runSandbox: async (_h, input) => {
        capturedInput = input;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          via: "exit",
          durationMs: 5,
        };
      },
    });

    expect(capturedInput?.mountMode).toBe("readonly_enforced");
    expect(capturedInput?.scope?.writable_paths).toEqual(["src/index.ts"]);
  });

  it("P03B2-P6: ContractOrchestrator resolveContainerMountMode 区分验收与施工", () => {
    const orchestrator = new ContractOrchestrator({
      repoRoot: worktree,
    });

    expect(orchestrator.resolveContainerMountMode("acceptance")).toBe(
      "readonly_enforced",
    );
    expect(orchestrator.resolveContainerMountMode("t")).toBe(
      "readonly_enforced",
    );
    expect(orchestrator.resolveContainerMountMode("construction")).toBe(
      "scoped",
    );
    expect(orchestrator.resolveContainerMountMode("i")).toBe("scoped");
  });
});
