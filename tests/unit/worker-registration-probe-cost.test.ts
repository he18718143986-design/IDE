import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AdapterRegistry } from "../../daemon/worker/adapter-registry";
import type {
  AdapterCapabilityDeclaration,
  CodingWorkerAdapter,
} from "../../daemon/worker/worker-adapter.interface";
import type {
  ContainerHostPort,
  SandboxRunOutcome,
} from "../../daemon/worker/sandbox/container-host";
import { DockerContainerHost } from "../../daemon/worker/cli-host/docker-container-host";
import { WorkerRegistrationService } from "../../daemon/worker/verify/worker-registration-service";
import type { WorkerDispatchFactory } from "../../daemon/worker/worker-dispatch";

/**
 * TASK-W.9d：行投影 Docker host probe 成本收敛。
 *
 * 缓存失效策略（写死）：服务实例级单例——同一 WorkerRegistrationService
 * 实例内 list/get 对 SANDBOX 行至多 resolveSharedContainerHost / createContainerHost
 * 一次；新服务实例重新探测。GATEWAY / UNCONTROLLED 行不触发宿主构造。
 */

const NOW = "2026-11-07T00:00:00.000Z";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRepoRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w9d-"));
  tempDirs.push(dir);
  return dir;
}

function cliDeclaration(adapterId: string): AdapterCapabilityDeclaration {
  return {
    adapter_id: adapterId,
    protocol_version: "1.0.0",
    model_metering_source: "LOCAL_ESTIMATE",
    tool_interception_supported: false,
    filesystem_permissions: "DIRECT_UNCONTROLLED",
    command_permissions: "UNRESTRICTED_SHELL",
    cancellation_supported: true,
    session_recovery_supported: false,
    network_requirements: "NONE",
    platform_support: ["darwin-arm64", "linux-x64"],
    known_limitations: ["W.9d probe-cost fixture"],
  };
}

function executableAdapter(adapterId: string): CodingWorkerAdapter {
  return {
    kind: "CLI",
    declaration: cliDeclaration(adapterId),
    async run() {
      return {
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function stubFactory(): WorkerDispatchFactory {
  return () => ({
    run: async () => ({
      applied: false,
      changes: [],
      log: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      blockers: [],
    }),
  });
}

function countingHost(
  available: boolean,
): ContainerHostPort & { isAvailableCalls: number } {
  const host = {
    kind: available ? "fake-docker/ok" : "fake-docker/unavailable",
    isAvailableCalls: 0,
    isAvailable(): boolean {
      host.isAvailableCalls += 1;
      return available;
    },
    async run(): Promise<SandboxRunOutcome> {
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        via: "exit",
        durationMs: 1,
      };
    },
  };
  return host;
}

describe("W.9d · 行投影 Docker host probe 成本", () => {
  it("W9D-P1: N 个 SANDBOX 行 list/get 至多一次 createContainerHost（探测上界=1）", () => {
    const repoRoot = tmpRepoRoot();
    const registry = new AdapterRegistry();
    let createCalls = 0;
    let probeCalls = 0;
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
      createContainerHost: () => {
        createCalls += 1;
        return new DockerContainerHost({
          probe: () => {
            probeCalls += 1;
            return {
              ok: true,
              server_version: "test",
              detail: "injected probe",
            };
          },
        });
      },
    });

    const n = 8;
    for (let i = 0; i < n; i += 1) {
      const id = `w9d.sandbox.${i}`;
      registry.register(executableAdapter(id), "SANDBOX_ENFORCED");
      registry.registerDispatchFactory(id, stubFactory());
    }

    const listed = service.list();
    expect(listed.length).toBe(n);
    expect(createCalls).toBe(1);
    expect(probeCalls).toBe(1);

    // 同实例再次 list + get 不得再造宿主 / 再探测
    service.list();
    service.get("w9d.sandbox.0");
    expect(createCalls).toBe(1);
    expect(probeCalls).toBe(1);

    // 新服务实例：失效策略写死——重新探测一次
    let createCalls2 = 0;
    const service2 = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
      createContainerHost: () => {
        createCalls2 += 1;
        return countingHost(true);
      },
    });
    expect(service2.list().length).toBe(n);
    expect(createCalls2).toBe(1);
  });

  it("W9D-P2: 无宿主探测时静态形态仍诚实（UNCONTROLLED 不触发 createContainerHost）", () => {
    const repoRoot = tmpRepoRoot();
    const registry = new AdapterRegistry();
    let createCalls = 0;
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
      createContainerHost: () => {
        createCalls += 1;
        throw new Error("probe must not run for static-only rows");
      },
    });

    for (let i = 0; i < 5; i += 1) {
      const id = `w9d.uncontrolled.${i}`;
      registry.register(executableAdapter(id), "UNCONTROLLED_EXTERNAL");
    }

    const listed = service.list();
    expect(listed).toHaveLength(5);
    expect(createCalls).toBe(0);
    for (const row of listed) {
      expect(row.control_mode).toBe("UNCONTROLLED_EXTERNAL");
      expect(row.dispatchable).toBe(false);
      expect(row.dispatch_blocked_reason).toBeTruthy();
      expect(row.adapter_id).toMatch(/^w9d\.uncontrolled\./);
      expect(row.builtin).toBe(true);
      expect(row.kind).toBe("CLI");
    }
  });

  it("W9D-P3: SANDBOX_ENFORCED 宿主真实不可用时仍 dispatchable=false（不因缓存放行）", () => {
    const repoRoot = tmpRepoRoot();
    const registry = new AdapterRegistry();
    let createCalls = 0;
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
      createContainerHost: () => {
        createCalls += 1;
        return countingHost(false);
      },
    });

    for (let i = 0; i < 4; i += 1) {
      const id = `w9d.locked.${i}`;
      registry.register(executableAdapter(id), "SANDBOX_ENFORCED");
      registry.registerDispatchFactory(id, stubFactory());
    }

    const listed = service.list();
    expect(listed).toHaveLength(4);
    expect(createCalls).toBe(1);
    for (const row of listed) {
      expect(row.control_mode).toBe("SANDBOX_ENFORCED");
      expect(row.dispatchable).toBe(false);
      expect(row.dispatch_blocked_reason).toBeTruthy();
    }

    // 可用宿主对照：同形态可派工（证明拒绝来自宿主不可用，而非缓存把门禁弄坏）
    const registryOk = new AdapterRegistry();
    const serviceOk = new WorkerRegistrationService({
      repoRoot: tmpRepoRoot(),
      registry: registryOk,
      now: () => NOW,
      createContainerHost: () => countingHost(true),
    });
    registryOk.register(executableAdapter("w9d.ok.0"), "SANDBOX_ENFORCED");
    registryOk.registerDispatchFactory("w9d.ok.0", stubFactory());
    expect(serviceOk.get("w9d.ok.0").dispatchable).toBe(true);
  });

  it("W9D-P4: 回归既有视图字段；混合档位仍共用一次 SANDBOX 探测", () => {
    const repoRoot = tmpRepoRoot();
    const registry = new AdapterRegistry();
    let createCalls = 0;
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
      createContainerHost: () => {
        createCalls += 1;
        return countingHost(true);
      },
    });

    registry.register(executableAdapter("w9d.mix.sandbox"), "SANDBOX_ENFORCED");
    registry.registerDispatchFactory("w9d.mix.sandbox", stubFactory());
    registry.register(
      executableAdapter("w9d.mix.uncontrolled"),
      "UNCONTROLLED_EXTERNAL",
    );

    // 自注册一条，覆盖 storedView 路径
    const stored = service.register({
      adapter_id: "w9d.mix.stored",
      adapter_version: "0.1.0",
      launch: { command: "acme", args: [] },
      declaration: cliDeclaration("w9d.mix.stored"),
    });
    expect(stored.builtin).toBe(false);
    expect(stored.dispatchable).toBe(false);

    const listed = service.list();
    expect(listed.map((w) => w.adapter_id).sort()).toEqual([
      "w9d.mix.sandbox",
      "w9d.mix.stored",
      "w9d.mix.uncontrolled",
    ]);
    expect(createCalls).toBe(1);

    const sandbox = listed.find((w) => w.adapter_id === "w9d.mix.sandbox");
    expect(sandbox).toMatchObject({
      adapter_id: "w9d.mix.sandbox",
      adapter_version: "1.0.0",
      control_mode: "SANDBOX_ENFORCED",
      builtin: true,
      kind: "CLI",
      dispatchable: true,
    });
    expect(sandbox?.launch).toBeDefined();
    expect(sandbox?.created_at).toBeDefined();
    expect(sandbox?.updated_at).toBeDefined();
  });
});
