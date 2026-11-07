/**
 * TASK-W.9e：受控派工拒绝码穿透诊断。
 *
 * 验收：
 * - W9E-P1：诊断结果与 requireControlledDispatch 抛出的 .code 同源
 * - W9E-P2：WorkerView 在 dispatchable=false 时带回 dispatch_blocked_code
 * - W9E-P3：isControlledDispatchable 保留 boolean；门禁放行条件零放宽
 * - W9E-P4：至少三类不同拒绝码可区分
 */
import { afterEach, describe, expect, it } from "vitest";
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
import { WorkerRegistrationService } from "../../daemon/worker/verify/worker-registration-service";
import {
  diagnoseControlledDispatch,
  isControlledDispatchable,
  requireControlledDispatch,
  WorkerDispatchError,
  E_ADAPTER_NOT_REGISTERED,
  E_ADAPTER_NOT_CONTROLLED,
  E_ADAPTER_NO_DISPATCH_FACTORY,
  E_ADAPTER_SANDBOX_LOCKED,
  E_WORKER_NO_EXECUTOR,
  type WorkerDispatchFactory,
} from "../../daemon/worker/worker-dispatch";

const NOW = "2026-11-07T00:00:00.000Z";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRepoRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w9e-"));
  tempDirs.push(dir);
  return dir;
}

function gatewayCapability(adapterId: string): AdapterCapabilityDeclaration {
  return {
    adapter_id: adapterId,
    protocol_version: "1.0.0",
    model_metering_source: "LOCAL_ESTIMATE",
    tool_interception_supported: true,
    filesystem_permissions: "GATEWAY_ONLY",
    command_permissions: "WHITELIST_ONLY",
    cancellation_supported: true,
    session_recovery_supported: false,
    network_requirements: "NONE",
    platform_support: ["darwin-arm64", "linux-x64"],
    known_limitations: ["W.9e diagnostic fixture"],
  };
}

function sandboxCapability(adapterId: string): AdapterCapabilityDeclaration {
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
    known_limitations: ["W.9e diagnostic fixture"],
  };
}

function executableAdapter(
  adapterId: string,
  mode:
    | "GATEWAY_ENFORCED"
    | "SANDBOX_ENFORCED"
    | "UNCONTROLLED_EXTERNAL" = "GATEWAY_ENFORCED",
): CodingWorkerAdapter {
  const declaration =
    mode === "GATEWAY_ENFORCED"
      ? gatewayCapability(adapterId)
      : sandboxCapability(adapterId);
  return {
    kind: mode === "GATEWAY_ENFORCED" ? "MANAGED_AI" : "CLI",
    declaration,
    async run() {
      return {
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function declarationOnlyAdapter(adapterId: string): CodingWorkerAdapter {
  return {
    kind: "CLI",
    declaration: gatewayCapability(adapterId),
    has_executor: false,
    async run() {
      throw new Error("E_WORKER_NO_EXECUTOR");
    },
  } as CodingWorkerAdapter;
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

function host(available: boolean): ContainerHostPort {
  return {
    kind: available ? "fake-docker/ok" : "fake-docker/unavailable",
    isAvailable(): boolean {
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
}

function expectRequireCode(
  registry: AdapterRegistry,
  adapterId: string,
  code: string,
  options?: { containerHost?: ContainerHostPort },
): void {
  try {
    requireControlledDispatch(registry, adapterId, options);
    throw new Error(`expected requireControlledDispatch to throw ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(code);
  }
}

describe("TASK-W.9e · diagnoseControlledDispatch 同源拒绝码", () => {
  it("W9E-P1: 拒绝码与 requireControlledDispatch 同源（未注册 / 非受控 / 无工厂 / 沙箱锁 / 无执行器）", () => {
    const registry = new AdapterRegistry();

    // 未注册
    const missing = diagnoseControlledDispatch(registry, "w9e.missing");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe(E_ADAPTER_NOT_REGISTERED);
    }
    expectRequireCode(registry, "w9e.missing", E_ADAPTER_NOT_REGISTERED);
    expect(isControlledDispatchable(registry, "w9e.missing")).toBe(false);

    // UNCONTROLLED_EXTERNAL
    registry.register(
      executableAdapter("w9e.uncontrolled", "UNCONTROLLED_EXTERNAL"),
      "UNCONTROLLED_EXTERNAL",
    );
    const uncontrolled = diagnoseControlledDispatch(
      registry,
      "w9e.uncontrolled",
    );
    expect(uncontrolled.ok).toBe(false);
    if (!uncontrolled.ok) {
      expect(uncontrolled.code).toBe(E_ADAPTER_NOT_CONTROLLED);
    }
    expectRequireCode(registry, "w9e.uncontrolled", E_ADAPTER_NOT_CONTROLLED);
    expect(isControlledDispatchable(registry, "w9e.uncontrolled")).toBe(false);

    // GATEWAY 已注册但无工厂
    registry.register(executableAdapter("w9e.no-factory"), "GATEWAY_ENFORCED");
    const noFactory = diagnoseControlledDispatch(registry, "w9e.no-factory");
    expect(noFactory.ok).toBe(false);
    if (!noFactory.ok) {
      expect(noFactory.code).toBe(E_ADAPTER_NO_DISPATCH_FACTORY);
    }
    expectRequireCode(
      registry,
      "w9e.no-factory",
      E_ADAPTER_NO_DISPATCH_FACTORY,
    );

    // SANDBOX 无宿主
    registry.register(
      executableAdapter("w9e.sandbox-locked", "SANDBOX_ENFORCED"),
      "SANDBOX_ENFORCED",
    );
    registry.registerDispatchFactory("w9e.sandbox-locked", stubFactory());
    const locked = diagnoseControlledDispatch(registry, "w9e.sandbox-locked");
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.code).toBe(E_ADAPTER_SANDBOX_LOCKED);
    }
    expectRequireCode(registry, "w9e.sandbox-locked", E_ADAPTER_SANDBOX_LOCKED);
    const lockedUnavailable = diagnoseControlledDispatch(
      registry,
      "w9e.sandbox-locked",
      { containerHost: host(false) },
    );
    expect(lockedUnavailable.ok).toBe(false);
    if (!lockedUnavailable.ok) {
      expect(lockedUnavailable.code).toBe(E_ADAPTER_SANDBOX_LOCKED);
    }

    // 有工厂但无合规执行器
    registry.register(
      declarationOnlyAdapter("w9e.no-executor"),
      "GATEWAY_ENFORCED",
    );
    registry.registerDispatchFactory("w9e.no-executor", stubFactory());
    const noExec = diagnoseControlledDispatch(registry, "w9e.no-executor");
    expect(noExec.ok).toBe(false);
    if (!noExec.ok) {
      expect(noExec.code).toBe(E_WORKER_NO_EXECUTOR);
    }
    expectRequireCode(registry, "w9e.no-executor", E_WORKER_NO_EXECUTOR);
  });

  it("W9E-P2: View/API 在 dispatchable=false 时带回 dispatch_blocked_code", () => {
    const repoRoot = tmpRepoRoot();
    const registry = new AdapterRegistry();
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
      createContainerHost: () => host(false),
    });

    registry.register(
      executableAdapter("w9e.view.uncontrolled", "UNCONTROLLED_EXTERNAL"),
      "UNCONTROLLED_EXTERNAL",
    );
    registry.register(
      executableAdapter("w9e.view.sandbox", "SANDBOX_ENFORCED"),
      "SANDBOX_ENFORCED",
    );
    registry.registerDispatchFactory("w9e.view.sandbox", stubFactory());
    registry.register(
      executableAdapter("w9e.view.no-factory"),
      "GATEWAY_ENFORCED",
    );

    const uncontrolled = service.get("w9e.view.uncontrolled");
    expect(uncontrolled.dispatchable).toBe(false);
    expect(uncontrolled.dispatch_blocked_code).toBe(E_ADAPTER_NOT_CONTROLLED);
    expect(uncontrolled.dispatch_blocked_reason).toBeTruthy();

    const sandbox = service.get("w9e.view.sandbox");
    expect(sandbox.dispatchable).toBe(false);
    expect(sandbox.dispatch_blocked_code).toBe(E_ADAPTER_SANDBOX_LOCKED);
    expect(sandbox.dispatch_blocked_reason).toBeTruthy();

    const noFactory = service.get("w9e.view.no-factory");
    expect(noFactory.dispatchable).toBe(false);
    expect(noFactory.dispatch_blocked_code).toBe(E_ADAPTER_NO_DISPATCH_FACTORY);
    expect(noFactory.dispatch_blocked_reason).toBeTruthy();

    // 列表序列化同样带码（GET /api/workers 直接回传 list()）
    const listed = service.list();
    const byId = Object.fromEntries(listed.map((row) => [row.adapter_id, row]));
    expect(byId["w9e.view.uncontrolled"]?.dispatch_blocked_code).toBe(
      E_ADAPTER_NOT_CONTROLLED,
    );
    expect(byId["w9e.view.sandbox"]?.dispatch_blocked_code).toBe(
      E_ADAPTER_SANDBOX_LOCKED,
    );
    expect(byId["w9e.view.no-factory"]?.dispatch_blocked_code).toBe(
      E_ADAPTER_NO_DISPATCH_FACTORY,
    );

    // 可派工正例：不设 blocked code（不破坏旧契约）
    const registryOk = new AdapterRegistry();
    const serviceOk = new WorkerRegistrationService({
      repoRoot: tmpRepoRoot(),
      registry: registryOk,
      now: () => NOW,
      createContainerHost: () => host(true),
    });
    registryOk.register(executableAdapter("w9e.view.ok"), "GATEWAY_ENFORCED");
    registryOk.registerDispatchFactory("w9e.view.ok", stubFactory());
    const ok = serviceOk.get("w9e.view.ok");
    expect(ok.dispatchable).toBe(true);
    expect(ok.dispatch_blocked_code).toBeUndefined();
    expect(ok.dispatch_blocked_reason).toBeUndefined();
  });

  it("W9E-P3: 门禁条件不放宽——boolean 与 diagnose/require 一致，放行仍需完整条件", () => {
    const registry = new AdapterRegistry();
    const id = "w9e.gate.ok";
    const factory = stubFactory();

    // 缺任一门禁条件 → 不可派工
    registry.register(executableAdapter(id), "GATEWAY_ENFORCED");
    expect(isControlledDispatchable(registry, id)).toBe(false);
    expect(diagnoseControlledDispatch(registry, id).ok).toBe(false);

    registry.registerDispatchFactory(id, factory);
    expect(isControlledDispatchable(registry, id)).toBe(true);
    const ok = diagnoseControlledDispatch(registry, id);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.factory).toBe(factory);
    }
    expect(requireControlledDispatch(registry, id)).toBe(factory);

    // SANDBOX：有工厂但无可用宿主 → 仍拒绝（不因诊断助手放行）
    const sandboxId = "w9e.gate.sandbox";
    registry.register(
      executableAdapter(sandboxId, "SANDBOX_ENFORCED"),
      "SANDBOX_ENFORCED",
    );
    registry.registerDispatchFactory(sandboxId, factory);
    expect(isControlledDispatchable(registry, sandboxId)).toBe(false);
    expect(
      isControlledDispatchable(registry, sandboxId, {
        containerHost: host(false),
      }),
    ).toBe(false);
    expect(
      isControlledDispatchable(registry, sandboxId, {
        containerHost: host(true),
      }),
    ).toBe(true);

    // UNCONTROLLED 永不因诊断助手变成可派工
    const uncId = "w9e.gate.unc";
    registry.register(
      executableAdapter(uncId, "UNCONTROLLED_EXTERNAL"),
      "UNCONTROLLED_EXTERNAL",
    );
    registry.registerDispatchFactory(uncId, factory);
    expect(isControlledDispatchable(registry, uncId)).toBe(false);
    const unc = diagnoseControlledDispatch(registry, uncId);
    expect(unc.ok).toBe(false);
    if (!unc.ok) {
      expect(unc.code).toBe(E_ADAPTER_NOT_CONTROLLED);
    }
  });

  it("W9E-P4: 三类以上拒绝码可区分（NOT_CONTROLLED / SANDBOX_LOCKED / NO_DISPATCH_FACTORY）", () => {
    const registry = new AdapterRegistry();
    registry.register(
      executableAdapter("w9e.d.unc", "UNCONTROLLED_EXTERNAL"),
      "UNCONTROLLED_EXTERNAL",
    );
    registry.register(executableAdapter("w9e.d.nf"), "GATEWAY_ENFORCED");
    registry.register(
      executableAdapter("w9e.d.lock", "SANDBOX_ENFORCED"),
      "SANDBOX_ENFORCED",
    );
    registry.registerDispatchFactory("w9e.d.lock", stubFactory());

    const codes = [
      diagnoseControlledDispatch(registry, "w9e.d.unc"),
      diagnoseControlledDispatch(registry, "w9e.d.nf"),
      diagnoseControlledDispatch(registry, "w9e.d.lock"),
    ].map((d) => {
      expect(d.ok).toBe(false);
      return d.ok ? null : d.code;
    });

    expect(new Set(codes).size).toBe(3);
    expect(codes).toEqual([
      E_ADAPTER_NOT_CONTROLLED,
      E_ADAPTER_NO_DISPATCH_FACTORY,
      E_ADAPTER_SANDBOX_LOCKED,
    ]);
  });
});
