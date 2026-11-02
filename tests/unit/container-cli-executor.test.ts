import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContainerCliAdapter,
  ContainerCliExecutionError,
  executeContainerCli,
  WORKER_EXECUTION_PATH_COMPARISON,
} from "../../daemon/worker/sandbox/container-cli-executor";
import type {
  ContainerHostPort,
  SandboxRunInput,
  SandboxRunOutcome,
} from "../../daemon/worker/sandbox/container-host";
import {
  resolveEvidenceControlMode,
  type AdapterCapabilityDeclaration,
} from "../../daemon/worker/worker-adapter.interface";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  createDefaultWorkerRegistry,
  BUILTIN_AI_SDK_ADAPTER_ID,
  MANAGED_AI_ADAPTER_ID,
  CLAUDE_CODE_WORKER_ADAPTER_ID,
  CURSOR_AGENT_WORKER_ADAPTER_ID,
  OPENHANDS_WORKER_ADAPTER_ID,
} from "../../daemon/worker/default-worker-registry";
import {
  isControlledDispatchable,
} from "../../daemon/worker/worker-dispatch";
import { CursorAgentAdapter } from "../../daemon/worker/cli-host/cursor-agent-adapter";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";

const roots: string[] = [];
function worktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w9b-cli-"));
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
  durationMs: 12,
};
const host: ContainerHostPort = {
  kind: "fake/container",
  isAvailable: () => true,
  run: vi.fn(async () => ok),
};
function fakeRunner(outcome: SandboxRunOutcome) {
  return vi.fn(
    async (
      _host: ContainerHostPort,
      _input: SandboxRunInput,
      _signal?: AbortSignal,
    ) => outcome,
  );
}

const mockDeclaration: AdapterCapabilityDeclaration = {
  adapter_id: "test.container-cli.v0",
  protocol_version: "1.0",
  model_metering_source: "PROVIDER",
  tool_interception_supported: false,
  filesystem_permissions: "DIRECT_UNCONTROLLED",
  command_permissions: "UNRESTRICTED_SHELL",
  cancellation_supported: true,
  session_recovery_supported: false,
  network_requirements: "NONE",
  platform_support: ["linux-x64"],
  known_limitations: ["test adapter"],
};

function makeTestContract(adapterId: string): SoftwareContract {
  const draft = createContractDraft({
    title: "W.9b test",
    description: "test contract",
    acceptanceCriteria: ["works"],
    writablePaths: ["dist/**"],
    workerSpec: { adapter_id: adapterId },
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });
}

describe("executeContainerCli", () => {
  it("executes only via runInSandbox and collects exact expected Worktree files with witness", async () => {
    const root = worktree();
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "main.ts"), "export const safe = true;\n");
    const runner = fakeRunner(ok);
    const signal = new AbortController().signal;
    const result = await executeContainerCli({
      host,
      worktreeRoot: root,
      argv: ["tool", "--action"],
      cwd: root,
      expectedArtifacts: ["src/main.ts"],
      declaredControlMode: "SANDBOX_ENFORCED",
      signal,
      timeoutMs: 1000,
      runSandbox: runner,
    });
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]?.[2]).toBe(signal);
    expect(result.changes).toEqual([{ path: "src/main.ts", content: "export const safe = true;\n" }]);
    expect(result.sandbox).toMatchObject({ host_kind: "fake/container", via: "exit", exit_code: 0, worktree_root: root });
    expect(result.evidenceControlMode).toBe("SANDBOX_ENFORCED");
  });

  it.each([
    { ...ok, via: "rejected" as const, rejection: "HOST_UNAVAILABLE" as const },
    { ...ok, via: "timeout" as const },
    { ...ok, exitCode: 1 },
    { ...ok, via: "SIGKILL" as const },
  ])("does not accept outputs or witness for unsuccessful execution %#", async (outcome) => {
    const root = worktree();
    const runner = fakeRunner(outcome);
    await expect(executeContainerCli({ host, worktreeRoot: root, argv: ["tool"], expectedArtifacts: [], declaredControlMode: "SANDBOX_ENFORCED", runSandbox: runner })).rejects.toBeInstanceOf(ContainerCliExecutionError);
    expect(runner).toHaveBeenCalledOnce();
  });

  it.each(["../outside", "/tmp/outside", ".git/config", ".stagent/workers.json", "src//x.ts", "src/./x.ts"])("rejects unsafe expected artifact path %s before execution", async (artifact) => {
    const root = worktree();
    const runner = fakeRunner(ok);
    await expect(executeContainerCli({ host, worktreeRoot: root, argv: ["tool"], expectedArtifacts: [artifact], declaredControlMode: "SANDBOX_ENFORCED", runSandbox: runner })).rejects.toMatchObject({ code: "E_SANDBOX_ARTIFACT_INVALID" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports a missing expected artifact as an artifact error", async () => {
    await expect(executeContainerCli({ host, worktreeRoot: worktree(), argv: ["tool"], expectedArtifacts: ["missing.txt"], declaredControlMode: "SANDBOX_ENFORCED", runSandbox: fakeRunner(ok) })).rejects.toMatchObject({ code: "E_SANDBOX_ARTIFACT_INVALID" });
  });

  it("rejects symlink artifacts even when the requested path is inside the Worktree", async () => {
    const root = worktree();
    const outside = path.join(os.tmpdir(), `w9b-outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(root, "out.txt"));
    const runner = fakeRunner(ok);
    await expect(executeContainerCli({ host, worktreeRoot: root, argv: ["tool"], expectedArtifacts: ["out.txt"], declaredControlMode: "SANDBOX_ENFORCED", runSandbox: runner })).rejects.toMatchObject({ code: "E_SANDBOX_ARTIFACT_INVALID" });
    fs.rmSync(outside, { force: true });
  });

  it("refuses an unavailable container host before invoking the sandbox", async () => {
    const runner = fakeRunner(ok);
    await expect(executeContainerCli({ host: { ...host, isAvailable: () => false }, worktreeRoot: worktree(), argv: ["tool"], expectedArtifacts: [], declaredControlMode: "SANDBOX_ENFORCED", runSandbox: runner })).rejects.toMatchObject({ code: "E_SANDBOX_CLI_REJECTED" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not label an execution Gateway-controlled without Gateway capability", async () => {
    await expect(executeContainerCli({ host, worktreeRoot: worktree(), argv: ["tool"], expectedArtifacts: [], declaredControlMode: "GATEWAY_ENFORCED" })).rejects.toMatchObject({ code: "E_SANDBOX_CLI_REJECTED" });
  });

  it("documents the distinct Gateway and container control capabilities", () => {
    expect(WORKER_EXECUTION_PATH_COMPARISON.gateway.availableHere).toBe(false);
    expect(WORKER_EXECUTION_PATH_COMPARISON.container.availableHere).toBe(true);
    expect(WORKER_EXECUTION_PATH_COMPARISON.gateway.evidenceMode).toContain("only when");
  });

  it("rejects env keys outside the explicit container allowlist", async () => {
    const runner = fakeRunner(ok);
    await expect(executeContainerCli({ host, worktreeRoot: worktree(), argv: ["tool"], expectedArtifacts: [], declaredControlMode: "SANDBOX_ENFORCED", env: { HOME: "/tmp", INHERITED_SECRET: "bad" }, runSandbox: runner })).rejects.toMatchObject({ code: "E_SANDBOX_CLI_REJECTED" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("redacts credential values from sandbox logs", async () => {
    const runner = fakeRunner({ ...ok, stdout: "token=super-secret" });
    const result = await executeContainerCli({ host, worktreeRoot: worktree(), argv: ["tool"], expectedArtifacts: [], declaredControlMode: "SANDBOX_ENFORCED", env: { CURSOR_API_KEY: "super-secret" }, runSandbox: runner });
    expect(result.log.join("\n")).not.toContain("super-secret");
    expect(result.log.join("\n")).toContain("[REDACTED]");
  });

  it("passes network, timeout and abort signal to the sandbox runner", async () => {
    const runner = fakeRunner(ok);
    const controller = new AbortController();
    await executeContainerCli({ host, worktreeRoot: worktree(), argv: ["tool"], expectedArtifacts: [], declaredControlMode: "SANDBOX_ENFORCED", networkPolicy: "DENY", timeoutMs: 250, signal: controller.signal, runSandbox: runner });
    expect(runner.mock.calls[0]?.[1]).toMatchObject({ networkPolicy: "DENY", timeoutMs: 250 });
    expect(runner.mock.calls[0]?.[2]).toBe(controller.signal);
  });
});

describe("ContainerCliAdapter contract and witness delivery", () => {
  it("implements CodingWorkerAdapter and delegates run to executeContainerCli", async () => {
    const root = worktree();
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "out.js"), "console.log(1);\n");
    const runner = fakeRunner(ok);
    const adapter = new ContainerCliAdapter({ host, declaration: mockDeclaration, buildArgv: (input) => ["compile", input.system_prompt], expectedArtifacts: () => ["dist/out.js"], runSandbox: runner });
    const signal = new AbortController().signal;
    const outcome = await adapter.run({ contract: makeTestContract("test.container-cli.v0"), contract_revision: 1, worktree_root: root, system_prompt: "build it", exposed_tools: [] }, signal);
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]?.[1].argv).toEqual(["compile", "build it"]);
    expect(runner.mock.calls[0]?.[2]).toBe(signal);
    expect(outcome.changes).toEqual([{ path: "dist/out.js", content: "console.log(1);\n" }]);
    expect(outcome.sandbox).toBeDefined();
  });

  it("refuses a non-SANDBOX_ENFORCED declaration mode at construction", () => {
    expect(() => new ContainerCliAdapter({ host, declaration: mockDeclaration, declaredControlMode: "UNCONTROLLED_EXTERNAL", buildArgv: () => ["echo"] })).toThrow(/SANDBOX_ENFORCED/);
  });

  it("yields witness into evidence only on success; missing witness falls back to UNCONTROLLED_EXTERNAL", () => {
    const witness = { host_kind: "fake/container", via: "exit" as const, exit_code: 0, worktree_root: "/tmp/fake", duration_ms: 10, network_policy: "DENY" as const, timestamp: new Date().toISOString() };
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", witness)).toBe("SANDBOX_ENFORCED");
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", undefined)).toBe("UNCONTROLLED_EXTERNAL");
  });
});

describe("Boundary check: Cursor CLI is not claimed to be executable in container", () => {
  it("Cursor CLI image/protocol remain unverified; adapter is not executable", async () => {
    const cursorAdapter = new CursorAgentAdapter({ apiKey: () => "test-key" });
    expect(cursorAdapter.declaration.tool_interception_supported).toBe(false);
    expect(cursorAdapter.declaration.filesystem_permissions).toBe("DIRECT_UNCONTROLLED");
    expect(cursorAdapter.declaration.command_permissions).toBe("UNRESTRICTED_SHELL");
    await expect(cursorAdapter.run({ contract: makeTestContract("cursor-agent"), contract_revision: 1, worktree_root: "/tmp", system_prompt: "do something", exposed_tools: [] })).rejects.toThrow(/capability carrier is not executable/);
  });

  it("default registry keeps Cursor UNCONTROLLED_EXTERNAL without dispatch factory", () => {
    const registry = createDefaultWorkerRegistry();
    const cursor = registry.get(CURSOR_AGENT_WORKER_ADAPTER_ID);
    expect(cursor).toBeDefined();
    expect(cursor?.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(registry.getDispatchFactory(CURSOR_AGENT_WORKER_ADAPTER_ID)).toBeUndefined();
    expect(isControlledDispatchable(registry, CURSOR_AGENT_WORKER_ADAPTER_ID)).toBe(false);
  });
});

describe("isControlledDispatchable alignment with requireControlledDispatch", () => {
  it("projects dispatchability for the default registry", () => {
    const registry = createDefaultWorkerRegistry();
    expect(isControlledDispatchable(registry, BUILTIN_AI_SDK_ADAPTER_ID)).toBe(true);
    expect(isControlledDispatchable(registry, MANAGED_AI_ADAPTER_ID)).toBe(true);
    expect(isControlledDispatchable(registry, CLAUDE_CODE_WORKER_ADAPTER_ID)).toBe(false);
    expect(isControlledDispatchable(registry, CURSOR_AGENT_WORKER_ADAPTER_ID)).toBe(false);
    expect(isControlledDispatchable(registry, OPENHANDS_WORKER_ADAPTER_ID, { containerHost: host })).toBe(true);
    expect(isControlledDispatchable(registry, OPENHANDS_WORKER_ADAPTER_ID, { containerHost: { ...host, isAvailable: () => false } })).toBe(false);
    expect(isControlledDispatchable(registry, OPENHANDS_WORKER_ADAPTER_ID)).toBe(false);
  });

  it("Orchestrator projection reflects container host availability", () => {
    const withHost = new ContractOrchestrator({ repoRoot: worktree(), containerHost: host });
    expect(withHost.isAdapterDispatchable(MANAGED_AI_ADAPTER_ID)).toBe(true);
    expect(withHost.isAdapterDispatchable(OPENHANDS_WORKER_ADAPTER_ID)).toBe(true);
    expect(withHost.isAdapterDispatchable(CURSOR_AGENT_WORKER_ADAPTER_ID)).toBe(false);
    const noHost = new ContractOrchestrator({ repoRoot: worktree(), containerHost: { ...host, isAvailable: () => false } });
    expect(noHost.isAdapterDispatchable(OPENHANDS_WORKER_ADAPTER_ID)).toBe(false);
  });
});
