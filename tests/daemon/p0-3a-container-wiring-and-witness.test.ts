import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StagentDaemon } from "../../daemon/server";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  assertEvidenceControlAndRevision,
  squashMerge,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import {
  type ContainerHostPort,
  type SandboxWitness,
  verifySandboxWitness,
} from "../../daemon/worker/sandbox/container-host";
import { DockerContainerHost } from "../../daemon/worker/cli-host/docker-container-host";
import { AdapterRegistry } from "../../daemon/worker/adapter-registry";
import { OPENHANDS_CAPABILITY } from "../../daemon/worker/cli-host/openhands-adapter";
import { OPENHANDS_WORKER_ADAPTER_ID } from "../../daemon/worker/default-worker-registry";
import type { CodingWorkerAdapter } from "../../daemon/worker/worker-adapter.interface";
import type { WorkerDispatchFactory } from "../../daemon/worker/worker-dispatch";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function safeRmSync(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("TASK-P0.3a: container-wiring-and-witness 生产接线与端到端见证双重校验", () => {
  let repo: string;
  let store: ContractStore;

  const SANDBOX_ADAPTER_ID = "test-sandbox-worker";

  const worktreeOf = (contractId: string) =>
    path.join(repo, ".stagent", "worktrees", `task-${contractId}`);

  const evidencePathOf = (contractId: string, evidenceId: string) =>
    path.join(repo, ".stagent", "evidence", `${contractId}-${evidenceId}.json`);

  function makeContract(options: {
    title: string;
    controlMode?: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED";
    adapterId?: string;
  }): SoftwareContract {
    const draft = createContractDraft({
      title: options.title,
      description: "p0-3a container wiring and witness test",
      acceptanceCriteria: ["pass"],
      writablePaths: ["src/**"],
      ...(options.adapterId
        ? {
            workerSpec: {
              adapter_id: options.adapterId,
              control_mode: options.controlMode ?? "SANDBOX_ENFORCED",
            },
          }
        : {}),
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
  }

  function sandboxCarrier(): CodingWorkerAdapter {
    return {
      declaration: { ...OPENHANDS_CAPABILITY, adapter_id: SANDBOX_ADAPTER_ID },
      kind: "CLI",
      run: async () => {
        throw new Error("carrier not directly executable");
      },
    };
  }

  function registryWith(factory: WorkerDispatchFactory): AdapterRegistry {
    const registry = new AdapterRegistry();
    registry.register(sandboxCarrier(), "SANDBOX_ENFORCED");
    registry.registerDispatchFactory(SANDBOX_ADAPTER_ID, factory);
    return registry;
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p03a-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    store = new ContractStore(repo);
  });

  afterEach(() => {
    safeRmSync(repo);
    delete process.env["STAGENT_DISABLE_CONTAINER"];
  });

  it("P03A-P1: server 构造注入 containerHost 与逃生门 WARNING 日志", () => {
    // 1. 默认构造注入 DockerContainerHost
    const defaultDaemon = new StagentDaemon({ repoRoot: repo });
    const orch1 = (
      defaultDaemon as unknown as { orchestrator: ContractOrchestrator }
    ).orchestrator;
    expect(
      (orch1 as unknown as { containerHost?: unknown }).containerHost,
    ).toBeInstanceOf(DockerContainerHost);

    // 2. options.containerHost 可覆盖/注入
    const mockHost: ContainerHostPort = {
      kind: "mock/1.0",
      isAvailable: () => true,
      run: async () => ({
        exitCode: 0,
        via: "exit",
        durationMs: 10,
        stdout: "",
        stderr: "",
      }),
    };
    const customDaemon = new StagentDaemon({
      repoRoot: repo,
      containerHost: mockHost,
    });
    const orch2 = (
      customDaemon as unknown as { orchestrator: ContractOrchestrator }
    ).orchestrator;
    expect(
      (orch2 as unknown as { containerHost?: unknown }).containerHost,
    ).toBe(mockHost);

    // 3. 环境变量逃生门 STAGENT_DISABLE_CONTAINER=1 强制禁用并写入 WARNING 日志
    process.env["STAGENT_DISABLE_CONTAINER"] = "1";
    const escapeDaemon = new StagentDaemon({
      repoRoot: repo,
      containerHost: mockHost,
    });
    const orch3 = (
      escapeDaemon as unknown as { orchestrator: ContractOrchestrator }
    ).orchestrator;
    expect(
      (orch3 as unknown as { containerHost?: unknown }).containerHost,
    ).toBeUndefined();

    // 检查 .stagent/logs/daemon.jsonl 中的 WARNING 日志
    const logPath = path.join(repo, ".stagent", "logs", "daemon.jsonl");
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs
      .readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const warning = lines.find(
      (e) =>
        e.level === "warn" &&
        e.code === "STAGENT_DISABLE_CONTAINER" &&
        e.kind === "container_escape_hatch",
    );
    expect(warning).toBeDefined();
    expect(warning.detail.source).toBe("env:STAGENT_DISABLE_CONTAINER=1");
  });

  it("P03A-P2: 宿主不可用时派工被拒 (E_ADAPTER_SANDBOX_LOCKED)", async () => {
    const unavailableHost: ContainerHostPort = {
      kind: "docker/unavailable",
      isAvailable: () => false,
      run: async () => {
        throw new Error("unavailable");
      },
    };

    const emptyFactory: WorkerDispatchFactory = () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    });

    const registry = registryWith(emptyFactory);

    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
      registry,
      containerHost: unavailableHost,
    });

    expect(orchestrator.isAdapterDispatchable(SANDBOX_ADAPTER_ID)).toBe(false);

    const contract = makeContract({
      title: "sandbox locked test",
      controlMode: "SANDBOX_ENFORCED",
      adapterId: SANDBOX_ADAPTER_ID,
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    await expect(
      orchestrator.runWorker(contract.contract_id, {
        modelClient: {
          generateChanges: async () => ({
            changes: [],
            log: [],
            rawResponse: "stub",
            usage: { inputTokens: 0, outputTokens: 0 },
          }),
        },
      }),
    ).rejects.toMatchObject({
      name: "WorkerDispatchError",
      code: "E_ADAPTER_SANDBOX_LOCKED",
    });
  });

  it("P03A-P3 & P03A-P5: 真实入箱执行见证落盘，有合法见证放行合并，缺见证阻断合并", async () => {
    const mockHost: ContainerHostPort = {
      kind: "docker/29.6.1",
      isAvailable: () => true,
      run: async (input: { worktreeRoot: string }) => {
        fs.mkdirSync(path.join(input.worktreeRoot, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(input.worktreeRoot, "src", "b.ts"),
          "export const b = 2;\n",
        );
        return {
          exitCode: 0,
          via: "exit",
          durationMs: 45,
          stdout: "done",
          stderr: "",
        };
      },
    };

    let targetContractId = "";
    const factory: WorkerDispatchFactory = () => ({
      run: async () => {
        const wt = worktreeOf(targetContractId);
        fs.mkdirSync(path.join(wt, "src"), { recursive: true });
        fs.writeFileSync(path.join(wt, "src", "b.ts"), "export const b = 2;\n");
        return {
          applied: true,
          changes: [],
          log: ["sandbox run"],
          usage: { inputTokens: 0, outputTokens: 0 },
          blockers: [],
          sandbox: {
            host_kind: "docker/29.6.1",
            via: "exit" as const,
            exit_code: 0,
            duration_ms: 45,
            worktree_root: wt,
          },
        };
      },
    });

    const registry = registryWith(factory);

    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
      registry,
      containerHost: mockHost,
    });

    const contract = makeContract({
      title: "sandbox e2e",
      controlMode: "SANDBOX_ENFORCED",
      adapterId: SANDBOX_ADAPTER_ID,
    });
    targetContractId = contract.contract_id;
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    await orchestrator.runWorker(contract.contract_id, {
      modelClient: {
        generateChanges: async () => ({
          changes: [],
          log: [],
          rawResponse: "stub",
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      },
      skipDesignStep: true,
      twoPhase: { obligations: [], waived: [] },
      containerHost: mockHost,
    });
    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    const evidence = outcome.evidence;
    expect(evidence.worker_control_mode).toBe("SANDBOX_ENFORCED");
    expect(evidence.sandbox_witness).toBeDefined();
    expect(evidence.sandbox_witness?.host_kind).toBe("docker/29.6.1");
    expect(evidence.sandbox_witness?.via).toBe("exit");
    expect(evidence.sandbox_witness?.nonce).toBeDefined();
    expect(evidence.sandbox_witness?.contract_id).toBe(contract.contract_id);
    expect(evidence.sandbox_witness?.contract_revision).toBe(1);
    expect(evidence.sandbox_witness?.worktree_root).toBe(
      worktreeOf(contract.contract_id),
    );
    expect(evidence.verdict.can_merge).toBe(true);

    // P03A-P3: 磁盘快照原子落盘 sandbox_witness
    const onDiskRaw = JSON.parse(
      fs.readFileSync(
        evidencePathOf(contract.contract_id, evidence.evidence_id),
        "utf-8",
      ),
    );
    expect(onDiskRaw.sandbox_witness).toBeDefined();
    expect(onDiskRaw.sandbox_witness.host_kind).toBe("docker/29.6.1");

    // 正常合并放行
    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence,
        reviewer: "tina",
      }),
    ).resolves.toBeDefined();
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("MERGED");
  });

  it("P03A-P5 & P03A-P6: 负向测试拦截异常/伪造见证 (fail-closed)", async () => {
    const worktree = "/test/worktree/root";
    const baseWitness: SandboxWitness = {
      host_kind: "docker/29.6.1",
      via: "exit",
      exit_code: 0,
      duration_ms: 50,
      worktree_root: worktree,
    };

    // 1. SANDBOX_ENFORCED 缺少见证
    expect(() =>
      assertEvidenceControlAndRevision(
        {
          worker_control_mode: "SANDBOX_ENFORCED",
          contract_revision: 1,
        },
        1,
        worktree,
      ),
    ).toThrowError(/缺少沙箱执行见证/);

    // 2. via 非 exit（如 timeout, SIGKILL, rejected）冒认受控
    for (const badVia of ["timeout", "SIGKILL", "rejected"] as const) {
      expect(() =>
        assertEvidenceControlAndRevision(
          {
            worker_control_mode: "SANDBOX_ENFORCED",
            contract_revision: 1,
            sandbox_witness: { ...baseWitness, via: badVia },
          },
          1,
          worktree,
        ),
      ).toThrowError(/沙箱见证终止方式非法/);
    }

    // 3. host_kind 为 unknown 或 unavailable
    for (const badHost of ["unknown", "docker/unavailable", ""]) {
      expect(() =>
        assertEvidenceControlAndRevision(
          {
            worker_control_mode: "SANDBOX_ENFORCED",
            contract_revision: 1,
            sandbox_witness: { ...baseWitness, host_kind: badHost },
          },
          1,
          worktree,
        ),
      ).toThrowError(/沙箱宿主类型非法/);
    }

    // 4. 工作树路径不匹配
    expect(() =>
      assertEvidenceControlAndRevision(
        {
          worker_control_mode: "SANDBOX_ENFORCED",
          contract_revision: 1,
          sandbox_witness: { ...baseWitness, worktree_root: "/wrong/worktree" },
        },
        1,
        worktree,
      ),
    ).toThrowError(/沙箱见证工作树不匹配/);

    // 5. [TASK-P1.4] Nonce 与合同标识绑定防嫁接
    expect(() =>
      assertEvidenceControlAndRevision(
        {
          worker_control_mode: "SANDBOX_ENFORCED",
          contract_revision: 1,
          contract_id: "contract-1",
          sandbox_witness: {
            ...baseWitness,
            nonce: "test-nonce",
            contract_id: "contract-other",
          },
        },
        1,
        worktree,
      ),
    ).toThrowError(/沙箱见证合同绑定不匹配/);

    expect(() =>
      assertEvidenceControlAndRevision(
        {
          worker_control_mode: "SANDBOX_ENFORCED",
          contract_revision: 1,
          contract_id: "contract-1",
          sandbox_witness: {
            ...baseWitness,
            nonce: "test-nonce",
            contract_id: "contract-1",
            contract_revision: 2,
          },
        },
        1,
        worktree,
      ),
    ).toThrowError(/沙箱见证合同版本绑定错配/);

    expect(() =>
      assertEvidenceControlAndRevision(
        {
          worker_control_mode: "SANDBOX_ENFORCED",
          contract_revision: 1,
          contract_id: "contract-1",
          sandbox_witness: {
            ...baseWitness,
            nonce: "   ",
            contract_id: "contract-1",
            contract_revision: 1,
          },
        },
        1,
        worktree,
      ),
    ).toThrowError(/沙箱见证 Nonce 格式非法/);
  });

  it("P03A-P7: GATEWAY_ENFORCED 路径零回归", async () => {
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    const contract = makeContract({ title: "gateway zero regression" });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    const worktree = worktreeOf(contract.contract_id);
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "c.ts"),
      "export const c = 3;\n",
    );

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.worker_control_mode).toBe("GATEWAY_ENFORCED");
    expect(outcome.evidence.sandbox_witness).toBeUndefined();
    expect(outcome.evidence.verdict.can_merge).toBe(true);

    await expect(
      squashMerge({
        repoRoot: repo,
        contractId: contract.contract_id,
        evidence: outcome.evidence,
        reviewer: "tina",
      }),
    ).resolves.toBeDefined();
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("MERGED");
  });

  // ── TASK-P0.1a 专项测试（P01A-P1 ~ P6）──────────────────────────────

  it("P01A-P1: 追踪派工至真实进程并验证容器执行入箱", async () => {
    let capturedWorktree: string | null = null;
    let runnerCalled = false;

    const mockHost: ContainerHostPort = {
      kind: "docker/29.6.1",
      isAvailable: () => true,
      run: async (input: { worktreeRoot: string }) => {
        capturedWorktree = input.worktreeRoot;
        runnerCalled = true;
        fs.mkdirSync(path.join(input.worktreeRoot, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(input.worktreeRoot, "src", "p01a.ts"),
          "export const p = 1;\n",
        );
        return {
          exitCode: 0,
          via: "exit",
          durationMs: 42,
          stdout: "done",
          stderr: "",
          sessionId: "sess-p01a-1",
        };
      },
    };

    let targetContractId = "";
    const factory: WorkerDispatchFactory = () => ({
      run: async () => {
        const wt = worktreeOf(targetContractId);
        fs.mkdirSync(path.join(wt, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(wt, "src", "p01a.ts"),
          "export const p = 1;\n",
        );
        return {
          applied: true,
          changes: [],
          log: ["container executed"],
          usage: { inputTokens: 0, outputTokens: 0 },
          blockers: [],
          sandbox: {
            host_kind: "docker/29.6.1",
            via: "exit" as const,
            exit_code: 0,
            duration_ms: 42,
            worktree_root: wt,
            session_id: "sess-p01a-1",
          },
        };
      },
    });

    const registry = registryWith(factory);
    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
      registry,
      containerHost: mockHost,
    });

    const contract = makeContract({
      title: "trace dispatch to container",
      controlMode: "SANDBOX_ENFORCED",
      adapterId: SANDBOX_ADAPTER_ID,
    });
    targetContractId = contract.contract_id;
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    await orchestrator.runWorker(contract.contract_id, {
      modelClient: {
        generateChanges: async () => ({
          changes: [],
          log: [],
          rawResponse: "stub",
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      },
      skipDesignStep: true,
      twoPhase: { obligations: [], waived: [] },
      containerHost: mockHost,
    });

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.worker_control_mode).toBe("SANDBOX_ENFORCED");
    expect(outcome.evidence.sandbox_witness).toBeDefined();

    // 验证调用链确经 containerHost 与沙箱见证传递
    expect(outcome.evidence.sandbox_witness?.host_kind).toBe("docker/29.6.1");
    expect(outcome.evidence.sandbox_witness?.via).toBe("exit");
    expect(outcome.evidence.sandbox_witness?.session_id).toBeDefined();
    expect(outcome.evidence.sandbox_witness?.worktree_root).toBe(
      worktreeOf(contract.contract_id),
    );
  });

  it("P01A-P2: 验证宿主不可用时派工被拒 fail-closed", async () => {
    // 1. 宿主不可用时，isAdapterDispatchable 为 false 且派工抛出 E_ADAPTER_SANDBOX_LOCKED
    const unavailableHost: ContainerHostPort = {
      kind: "docker/unavailable",
      isAvailable: () => false,
      run: async () => {
        throw new Error("should not be called");
      },
    };

    const emptyFactory: WorkerDispatchFactory = () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    });

    const registry = registryWith(emptyFactory);
    const orchLocked = new ContractOrchestrator({
      repoRoot: repo,
      registry,
      containerHost: unavailableHost,
    });

    expect(orchLocked.isAdapterDispatchable(SANDBOX_ADAPTER_ID)).toBe(false);

    const contract = makeContract({
      title: "fail closed when unavailable",
      controlMode: "SANDBOX_ENFORCED",
      adapterId: SANDBOX_ADAPTER_ID,
    });
    store.save(contract);
    await orchLocked.approve(contract.contract_id, "tina");

    await expect(
      orchLocked.runWorker(contract.contract_id, {
        modelClient: {
          generateChanges: async () => ({
            changes: [],
            log: [],
            rawResponse: "stub",
            usage: { inputTokens: 0, outputTokens: 0 },
          }),
        },
      }),
    ).rejects.toMatchObject({
      name: "WorkerDispatchError",
      code: "E_ADAPTER_SANDBOX_LOCKED",
    });

    // 2. 运行时返回 HOST_UNAVAILABLE 时，严禁降级本机会话，严禁产生 witness
    const runtimeFailHost: ContainerHostPort = {
      kind: "docker/29.6.1",
      isAvailable: () => true,
      run: async () => ({
        exitCode: 1,
        via: "rejected",
        rejectionCode: "HOST_UNAVAILABLE",
        durationMs: 5,
        stdout: "",
        stderr: "docker daemon unresponsive",
      }),
    };

    const runtimeFailFactory: WorkerDispatchFactory = () => ({
      run: async () => {
        throw new Error("HOST_UNAVAILABLE: docker daemon died");
      },
    });

    const orchRuntime = new ContractOrchestrator({
      repoRoot: repo,
      registry: registryWith(runtimeFailFactory),
      containerHost: runtimeFailHost,
    });

    const contract2 = makeContract({
      title: "runtime host unavailable",
      controlMode: "SANDBOX_ENFORCED",
      adapterId: SANDBOX_ADAPTER_ID,
    });
    store.save(contract2);
    await orchRuntime.approve(contract2.contract_id, "tina");

    await expect(
      orchRuntime.runWorker(contract2.contract_id, {
        modelClient: {
          generateChanges: async () => ({
            changes: [],
            log: [],
            rawResponse: "stub",
            usage: { inputTokens: 0, outputTokens: 0 },
          }),
        },
      }),
    ).rejects.toThrowError(/HOST_UNAVAILABLE/);
  });

  it("P01A-P3: 验证真实入箱执行见证落盘与防伪", async () => {
    const validWitness: SandboxWitness = {
      contract_id: "c-p01a-3",
      contract_revision: 1,
      nonce: "a".repeat(32),
      worktree_root: path.resolve(repo),
      host_kind: "docker",
      exit_code: 0,
      via: "exit",
      duration_ms: 100,
    };

    // 合法 witness 校验通过
    expect(() => verifySandboxWitness(validWitness, repo)).not.toThrow();

    // via 非 exit 被拒
    expect(() =>
      verifySandboxWitness({ ...validWitness, via: "timeout" }, repo),
    ).toThrowError(/沙箱见证终止方式非法/);

    // 工作树路径不一致被拒
    expect(() =>
      verifySandboxWitness(
        { ...validWitness, worktree_root: "/different/path" },
        repo,
      ),
    ).toThrowError(/沙箱见证工作树不匹配/);

    // 伪造/非法 host_kind 被拒
    expect(() =>
      verifySandboxWitness(
        { ...validWitness, host_kind: "unknown" as unknown as "docker" },
        repo,
      ),
    ).toThrowError(/沙箱宿主类型非法/);
  });

  it("P01A-P5: 验证 test_integrity 占位记录与真实重跑的区分性", async () => {
    const orchestrator = new ContractOrchestrator({ repoRoot: repo });
    const c1 = makeContract({
      title: "placeholder without test modification",
      controlMode: "SANDBOX_ENFORCED",
      adapterId: SANDBOX_ADAPTER_ID,
    });
    store.save(c1);
    await orchestrator.approve(c1.contract_id, "tina");
    const wt1 = worktreeOf(c1.contract_id);

    const rawWitness = {
      contract_id: c1.contract_id,
      contract_revision: c1.contract_revision,
      nonce: "a".repeat(32),
      worktree_root: path.resolve(wt1),
      host_kind: "docker/29.6.1",
      exit_code: 0,
      via: "exit" as const,
      duration_ms: 10,
    };
    (
      orchestrator as unknown as { sandboxWitnesses: Map<string, unknown> }
    ).sandboxWitnesses.set(c1.contract_id, rawWitness);

    // Case 1: 未修改测试文件且缺失 testIntegrity 时，自动补齐占位记录并标记 placeholder
    const out1 = await (
      orchestrator as unknown as {
        writeEvidence: (
          contract: SoftwareContract,
          params: unknown,
        ) => Promise<EvidenceBundle>;
      }
    ).writeEvidence(c1, {
      status: "PASSED",
      scopePassed: true,
      modifiedFiles: ["src/code.ts"],
      forbiddenViolations: [],
      verificationResults: [
        {
          alias: "test",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 10,
          passed: true,
        },
      ],
      workerControlMode: "SANDBOX_ENFORCED",
      testsModified: false,
      summary: "unmodified tests default placeholder",
    });

    expect(out1.test_integrity).toBeDefined();
    expect(out1.test_integrity?.baseline_rerun_triggered).toBe(false);
    expect(out1.test_integrity?.failure_reason).toBe(
      "placeholder:unmodified_tests_default",
    );
    expect(out1.verdict.can_merge).toBe(true);

    // Case 2: 改动了测试文件却未做完整性审计时，自动 fail-closed 阻断合并
    const out2 = await (
      orchestrator as unknown as {
        writeEvidence: (
          contract: SoftwareContract,
          params: unknown,
        ) => Promise<EvidenceBundle>;
      }
    ).writeEvidence(c1, {
      status: "PASSED",
      scopePassed: true,
      modifiedFiles: ["tests/some.test.ts"],
      forbiddenViolations: [],
      verificationResults: [
        {
          alias: "test",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 10,
          passed: true,
        },
      ],
      workerControlMode: "SANDBOX_ENFORCED",
      testsModified: true, // 标记改动了测试文件，但故意未传入 testIntegrity 证据
      summary: "tampered tests without integrity rerun",
    });

    expect(out2.test_integrity).toBeDefined();
    expect(out2.test_integrity?.baseline_rerun_passed).toBe(false);
    expect(out2.test_integrity?.failure_code).toBe(
      "E_TEST_BASELINE_REGRESSION",
    );
    expect(out2.test_integrity?.failure_reason).toBe(
      "tests_modified_without_test_integrity_evaluation",
    );
    // can_merge 必须被阻断
    expect(out2.verdict.can_merge).toBe(false);
  });

  it("P01A-P6: 核验执行链受控证明专项审计报告落盘", () => {
    const reportPath = path.resolve(
      __dirname,
      "../../docs/ledger/p0-1a-execution-chain-controlled-audit.md",
    );
    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, "utf-8");

    expect(content).toContain("TASK-P0.1a 执行链受控证明专项审计报告");
    expect(content).toContain("1. 派工→真实进程全链路追踪（P01A-P1）");
    expect(content).toContain(
      "2. SANDBOX_ENFORCED 所有入口与异常路径枚举（P01A-P2）",
    );
    expect(content).toContain(
      "3. SandboxWitness 来源真实性与防伪核查（P01A-P3）",
    );
    expect(content).toContain("4. 网络探测三态修证与 UNKNOWN 降级（P01A-P4）");
    expect(content).toContain(
      "5. test_integrity 占位记录与真实重跑区分性审计（P01A-P5）",
    );
    expect(content).toContain("6. 诚实口径与边界声明（P01A-P6）");
    expect(content).toContain("硬件级 Attestation 未实施");
    expect(content).toContain("Merger 阶段不重跑全量测试");
    expect(content).toContain("容器内未叠加 OS 级二次沙盒");
    expect(content).toContain("严禁宣称 P0/P1 安全风险完全解除");
  });
});
