/**
 * TASK-W.5c-iii：OpenHands 容器 Worker 确定性验收（无需本机容器运行时）。
 *
 * 覆盖卡正文 PASS OH-01～OH-05 + 「派工即入沙箱」断言：
 * - OH-01：越界挂载（宿主根 / `.git` / `.stagent`）→ 围栏拒绝，宿主零调用；
 * - OH-02：逃逸 / 提权 / 未授权出站 → 失败关闭（参数级 + 执行级双向断言）；
 * - OH-03：`runInSandbox()` 仅见任务 Worktree，`cwd` 外写入被拒；
 * - OH-04：`verified_on` 非空且来自实测；无实测记录则不得登记受控档；
 * - OH-05：能力声明对账（如实声明 + 围栏档校验 + 严格档仍拒同一份声明）。
 *
 * 「派工即入沙箱」：`SANDBOX_ENFORCED` 派工必须经 `runInSandbox()`，结果携带
 * `sandbox` 见证；缺见证 = 未入沙箱，不得记为受控证据。
 *
 * 纪律：本文件**不**要求容器运行时，也**不**证明真实隔离——真实容器实测见
 * `tests/e2e/openhands-isolation.real.test.ts`（`STAGENT_REAL_OPENHANDS=1` 门禁）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  SandboxRejectedError,
  runInSandbox,
  sandboxWitness,
  validateSandboxInput,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
  type SandboxWitness,
} from "../../daemon/worker/sandbox/container-host";
import {
  DockerContainerHost,
  type DockerProbe,
} from "../../daemon/worker/cli-host/docker-container-host";
import {
  OPENHANDS_ADAPTER_ID,
  OPENHANDS_BILLING_MODEL,
  OPENHANDS_CAPABILITY,
  OPENHANDS_IMAGE,
  OPENHANDS_VERIFIED_ON,
  OpenHandsSandboxAdapter,
  OpenHandsSandboxError,
} from "../../daemon/worker/cli-host/openhands-adapter";
import {
  OPENHANDS_WORKER_ADAPTER_ID,
  createDefaultWorkerRegistry,
  managedAiDispatchFactory,
  openhandsControlMode,
  openhandsSandboxDispatchFactory,
} from "../../daemon/worker/default-worker-registry";
import {
  MANAGED_AI_CAPABILITY,
  resolveEvidenceControlMode,
  validateAdapterCapability,
  validateSandboxFenceTier,
  type AdapterCapabilityDeclaration,
  type AdapterTaskInput,
  type CodingWorkerAdapter,
} from "../../daemon/worker/worker-adapter.interface";
import { AdapterRegistry } from "../../daemon/worker/adapter-registry";
import {
  E_ADAPTER_SANDBOX_LOCKED,
  WorkerDispatchError,
  requireControlledDispatch,
  type WorkerDispatchContext,
  type WorkerDispatchFactory,
} from "../../daemon/worker/worker-dispatch";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { git } from "../helpers/git";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import type { CostMonitor } from "../../daemon/guard/cost-monitor";
import type { WorkerModelClient } from "../../daemon/worker/ai-worker";

/** 不会被真实调用的模型客户端桩：沙箱派工由 fake 工厂接管，不触网 */
const stubModelClient: WorkerModelClient = {
  generateChanges: async () => ({
    changes: [],
    log: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  }),
};

/** mock 容器宿主：记录真实传入的输入，可按脚本返回终止态 */
function mockHost(
  overrides: {
    available?: boolean;
    kind?: string;
    outcome?: (input: SandboxRunInput) => SandboxRunOutcome;
  } = {},
): ContainerHostPort & { calls: SandboxRunInput[] } {
  const calls: SandboxRunInput[] = [];
  return {
    kind: overrides.kind ?? "mock/1.0",
    calls,
    isAvailable: () => overrides.available ?? true,
    run: async (input) => {
      calls.push(input);
      return (
        overrides.outcome?.(input) ?? {
          exitCode: 0,
          stdout: "openhands ok",
          stderr: "",
          via: "exit",
          durationMs: 7,
        }
      );
    },
  };
}

function makeContract(
  over: Partial<{ adapterId: string; pendingApproval: boolean }> = {},
) {
  const draft = createContractDraft({
    title: "W.5c-iii 沙箱实测",
    description: "OpenHands 容器 Worker 在真实容器内跑越界负例",
    acceptanceCriteria: ["负例全部失败关闭"],
    writablePaths: ["src/**"],
    workerSpec: {
      adapter_id: over.adapterId ?? OPENHANDS_WORKER_ADAPTER_ID,
      control_mode: "SANDBOX_ENFORCED",
    },
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
  // pendingApproval：交给编排器走 approve → EXECUTING 的正规流程（证据链测试用）
  if (over.pendingApproval === true) {
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
  }
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: "2026-11-02T00:00:00.000Z",
    },
  });
}

/** 派工上下文：本工厂不读 gateway / costMonitor / modelClient，仍需满足类型 */
function contextFor(
  contract: SoftwareContract,
  worktreeRoot: string,
  host?: ContainerHostPort,
): WorkerDispatchContext {
  return {
    contract,
    gateway: new ScopedWorktreeGateway(worktreeRoot, contract),
    costMonitor: {} as unknown as CostMonitor,
    modelClient: {} as unknown as WorkerModelClient,
    repoRoot: path.dirname(path.dirname(worktreeRoot)),
    worktreeRoot,
    ...(host === undefined ? {} : { containerHost: host }),
  };
}

function taskInput(worktreeRoot: string): AdapterTaskInput {
  return {
    contract: makeContract(),
    contract_revision: 1,
    worktree_root: worktreeRoot,
    system_prompt: "在容器内完成一次受控改动",
    exposed_tools: ["write_file"],
  };
}

describe("OH-05：能力声明对账（如实声明 + 围栏档校验）", () => {
  it("声明如实写容器边界：直连文件系统 / 无限制 Shell / 工具不拦截", () => {
    expect(OPENHANDS_CAPABILITY.adapter_id).toBe(OPENHANDS_ADAPTER_ID);
    expect(OPENHANDS_CAPABILITY.filesystem_permissions).toBe(
      "DIRECT_UNCONTROLLED",
    );
    expect(OPENHANDS_CAPABILITY.command_permissions).toBe("UNRESTRICTED_SHELL");
    expect(OPENHANDS_CAPABILITY.tool_interception_supported).toBe(false);
    expect(OPENHANDS_CAPABILITY.known_limitations.length).toBeGreaterThan(0);
    // 只写实测过的平台，不虚报
    expect(OPENHANDS_CAPABILITY.platform_support).toEqual(["darwin-arm64"]);
  });

  it("同一份声明：围栏档接受、严格档拒绝（证明档位口径确有差异）", () => {
    expect(validateSandboxFenceTier(OPENHANDS_CAPABILITY).ok).toBe(true);
    expect(
      validateAdapterCapability(OPENHANDS_CAPABILITY, "SANDBOX_ENFORCED").ok,
    ).toBe(true);
    const strict = validateAdapterCapability(
      OPENHANDS_CAPABILITY,
      "GATEWAY_ENFORCED",
    );
    expect(strict.ok).toBe(false);
    expect(strict.ok === false && strict.code).toBe(
      "FILESYSTEM_DIRECT_UNCONTROLLED",
    );
  });

  it("围栏档仍要求 known_limitations 与平台矩阵（不得宣称零限制）", () => {
    const noLimits: AdapterCapabilityDeclaration = {
      ...OPENHANDS_CAPABILITY,
      known_limitations: [],
    };
    const noPlatform: AdapterCapabilityDeclaration = {
      ...OPENHANDS_CAPABILITY,
      platform_support: [],
    };
    expect(validateSandboxFenceTier(noLimits)).toMatchObject({
      ok: false,
      code: "KNOWN_LIMITATIONS_UNDECLARED",
    });
    expect(validateSandboxFenceTier(noPlatform)).toMatchObject({
      ok: false,
      code: "PLATFORM_MATRIX_EMPTY",
    });
  });

  it("GATEWAY_ENFORCED 严格档语义未被放宽（不回归）", () => {
    expect(validateAdapterCapability(MANAGED_AI_CAPABILITY).ok).toBe(true);
    const loose = validateAdapterCapability(
      { ...MANAGED_AI_CAPABILITY, command_permissions: "UNRESTRICTED_SHELL" },
      "GATEWAY_ENFORCED",
    );
    expect(loose.ok).toBe(false);
    expect(loose.ok === false && loose.code).toBe("COMMAND_UNRESTRICTED_SHELL");
  });

  it("OpenHands 以 SANDBOX_ENFORCED 登记，且挂了沙箱派工工厂", () => {
    const registry = createDefaultWorkerRegistry();
    const entry = registry.get(OPENHANDS_WORKER_ADAPTER_ID);
    expect(entry?.control_mode).toBe("SANDBOX_ENFORCED");
    expect(registry.getDispatchFactory(OPENHANDS_WORKER_ADAPTER_ID)).toBe(
      openhandsSandboxDispatchFactory,
    );
  });
});

describe("OH-04：verified_on 来自实测，无实测则不得受控", () => {
  it("实测记录非空且形如「版次 + 日期」", () => {
    expect(OPENHANDS_VERIFIED_ON.cli_version).toMatch(/0\.59\.0/);
    expect(OPENHANDS_VERIFIED_ON.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("镜像以摘要固定（避免 :latest 漂移冒充「实测过的那个镜像」）", () => {
    expect(OPENHANDS_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it("billing_model 按实际接入方式填（LiteLLM 按 token）", () => {
    expect(OPENHANDS_BILLING_MODEL).toBe("PER_TOKEN");
  });

  it("缺实测记录 → 只能登记 UNCONTROLLED_EXTERNAL（不得标受控）", () => {
    expect(openhandsControlMode(OPENHANDS_VERIFIED_ON)).toBe(
      "SANDBOX_ENFORCED",
    );
    expect(openhandsControlMode(undefined)).toBe("UNCONTROLLED_EXTERNAL");
  });
});

describe("OH-01 / OH-03：越界挂载与 cwd 围栏（宿主零调用）", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-oh-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".git"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "a.ts"),
      "export const a = 1;\n",
    );
  });

  afterEach(() => safeRmSync(worktree));

  it("OH-01：诱导挂载宿主根 / .git / .stagent → 拒绝且不进入宿主", async () => {
    const host = mockHost();
    const cases = [
      path.parse(worktree).root,
      path.join(worktree, ".git"),
      path.join(worktree, ".stagent"),
    ];
    for (const source of cases) {
      await expect(
        runInSandbox(host, {
          worktreeRoot: worktree,
          argv: ["python", "-c", "print(1)"],
          mounts: [{ source, target: "/leak" }],
        }),
      ).rejects.toThrow(SandboxRejectedError);
    }
    expect(host.calls).toHaveLength(0);
  });

  it("OH-03：cwd 逃出 Worktree → 拒绝且不进入宿主", async () => {
    const host = mockHost();
    await expect(
      runInSandbox(host, {
        worktreeRoot: worktree,
        cwd: "/etc",
        argv: ["python", "-c", "print(1)"],
      }),
    ).rejects.toThrow(/CWD_OUTSIDE_WORKTREE/);
    expect(host.calls).toHaveLength(0);
  });

  it("OH-03：cwd 在 Worktree 内 → 放行，且宿主只收到 Worktree 根", async () => {
    const host = mockHost();
    const out = await runInSandbox(host, {
      worktreeRoot: worktree,
      cwd: path.join(worktree, "src"),
      argv: ["python", "-c", "print(1)"],
    });
    expect(out.exitCode).toBe(0);
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]!.worktreeRoot).toBe(worktree);
    expect(host.calls[0]!.cwd).toBe(path.join(worktree, "src"));
  });

  it("空 argv 不执行（失败关闭）", () => {
    expect(() =>
      validateSandboxInput({ worktreeRoot: worktree, argv: [] }),
    ).toThrow(/EMPTY_ARGV/);
  });
});

describe("OH-02：提权 / 出站负例（参数级 + 执行级）", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-oh-docker-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  });

  afterEach(() => safeRmSync(worktree));

  const availableProbe: DockerProbe = {
    ok: true,
    server_version: "29.6.1",
    detail: "docker server 29.6.1",
  };

  function host(
    over: {
      probe?: () => DockerProbe;
      spawnCalls?: number;
    } = {},
  ): { host: DockerContainerHost; spawned: string[][] } {
    const spawned: string[][] = [];
    const h = new DockerContainerHost({
      probe: over.probe ?? (() => availableProbe),
      spawn: (opts) => {
        spawned.push([opts.command, ...opts.args]);
        throw new Error("spawn must not be called in this case");
      },
    });
    return { host: h, spawned };
  }

  it("提权面收窄：cap-drop ALL + 只回补 DAC_OVERRIDE + no-new-privileges", () => {
    const { host: h } = host();
    const args = h.buildArgs(
      { worktreeRoot: worktree, argv: ["python", "-V"] },
      "stagent-sbx-test",
    );
    expect(args).toContain("--cap-drop");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args).toContain("--cap-add");
    expect(args[args.indexOf("--cap-add") + 1]).toBe("DAC_OVERRIDE");
    expect(args).toContain("no-new-privileges");
    expect(args).not.toContain("--privileged");
    // 回补的能力有且只有 DAC_OVERRIDE（危险能力一律不得回补）
    const capAdds = args.reduce<string[]>((acc, a, i) => {
      if (a === "--cap-add") acc.push(args[i + 1]!);
      return acc;
    }, []);
    expect(capAdds).toEqual(["DAC_OVERRIDE"]);
    expect(args).toContain("--pids-limit");
    // 唯一宿主挂载点＝任务 Worktree → /work
    const volumes = args.reduce<string[]>((acc, a, i) => {
      if (a === "-v") acc.push(args[i + 1]!);
      return acc;
    }, []);
    expect(volumes).toEqual([`${path.resolve(worktree)}:/work`]);
  });

  it("DENY → --network none", () => {
    const { host: h } = host();
    const args = h.buildArgs(
      { worktreeRoot: worktree, argv: ["python", "-V"], networkPolicy: "DENY" },
      "n",
    );
    expect(args[args.indexOf("--network") + 1]).toBe("none");
  });

  it("未授权出站策略无法逐目标兑现 → 拒绝（不静默放行、也不静默全禁）", async () => {
    const { host: h, spawned } = host();
    const out = await h.run({
      worktreeRoot: worktree,
      argv: ["python", "-V"],
      networkPolicy: "EXPLICIT_TARGETS",
      allowedTargets: ["https://example.com"],
    });
    expect(out.via).toBe("rejected");
    expect(out.rejection).toBe("NETWORK_TARGET_NOT_ALLOWED");
    expect(spawned).toHaveLength(0);
  });

  it("容器内挂载目标非法（相对路径 / 覆盖 /work）→ 拒绝", async () => {
    const { host: h } = host();
    for (const target of ["relative/dir", "/work", "/"]) {
      const out = await h.run({
        worktreeRoot: worktree,
        argv: ["python", "-V"],
        mounts: [{ source: path.join(worktree, "src"), target }],
      });
      expect(out.via).toBe("rejected");
    }
  });

  it("宿主不可用 → rejected/HOST_UNAVAILABLE，绝不本地执行（不降级）", async () => {
    const { host: h, spawned } = host({
      probe: () => ({ ok: false, server_version: "", detail: "daemon down" }),
    });
    expect(h.isAvailable()).toBe(false);
    expect(h.kind).toBe("docker/unavailable");
    const out = await h.run({ worktreeRoot: worktree, argv: ["python", "-V"] });
    expect(out.via).toBe("rejected");
    expect(out.rejection).toBe("HOST_UNAVAILABLE");
    expect(spawned).toHaveLength(0);
  });

  it("cwd 映射：Worktree 内子目录 → /work/<rel>；Worktree 外 → 拒绝", () => {
    const { host: h } = host();
    const inside = h.buildArgs(
      { worktreeRoot: worktree, cwd: path.join(worktree, "src"), argv: ["x"] },
      "n",
    );
    expect(inside[inside.indexOf("-w") + 1]).toBe("/work/src");
    expect(() =>
      h.buildArgs({ worktreeRoot: worktree, cwd: "/etc", argv: ["x"] }, "n"),
    ).toThrow(/CWD_OUTSIDE_WORKTREE/);
  });
});

describe("派工即入沙箱：SANDBOX_ENFORCED 必须经 runInSandbox", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-oh-dispatch-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  });

  afterEach(() => safeRmSync(worktree));

  it("门禁：宿主可用才放行，且解析到沙箱工厂", () => {
    const registry = createDefaultWorkerRegistry();
    const factory = requireControlledDispatch(
      registry,
      OPENHANDS_WORKER_ADAPTER_ID,
      { containerHost: mockHost({ available: true }) },
    );
    expect(factory).toBe(openhandsSandboxDispatchFactory);
  });

  it("门禁：未注入宿主 / 宿主不可用 → E_ADAPTER_SANDBOX_LOCKED（不降级放行）", () => {
    const registry = createDefaultWorkerRegistry();
    expect(() =>
      requireControlledDispatch(registry, OPENHANDS_WORKER_ADAPTER_ID),
    ).toThrow(E_ADAPTER_SANDBOX_LOCKED);
    expect(() =>
      requireControlledDispatch(registry, OPENHANDS_WORKER_ADAPTER_ID, {
        containerHost: mockHost({ available: false }),
      }),
    ).toThrow(E_ADAPTER_SANDBOX_LOCKED);
  });

  it("派工真实进入沙箱：宿主被调用 1 次，结果携带 sandbox 见证", async () => {
    const host = mockHost({ kind: "mock/docker-29.6.1" });
    const contract = makeContract();
    const worker = openhandsSandboxDispatchFactory(
      contextFor(contract, worktree, host),
    );
    const result = await worker.run();

    // 宿主被真实调用 → 说明执行确实走了 runInSandbox（唯一执行路径）
    expect(host.calls).toHaveLength(1);
    const sent = host.calls[0]!;
    expect(sent.worktreeRoot).toBe(worktree);
    expect(sent.argv.slice(0, 3)).toEqual([
      "python",
      "-m",
      "openhands.core.main",
    ]);
    expect(sent.networkPolicy).toBe("DENY");

    // 见证存在＝入过沙箱（缺见证即视为未入沙箱，不得记受控证据）
    expect(result.sandbox).toBeDefined();
    expect(result.sandbox?.host_kind).toBe("mock/docker-29.6.1");
    expect(result.sandbox?.via).toBe("exit");
    expect(result.sandbox?.worktree_root).toBe(worktree);
    expect(result.applied).toBe(true);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("工厂自身也不接受缺宿主：即便门禁被绕过也跑不起来", async () => {
    const contract = makeContract();
    const worker = openhandsSandboxDispatchFactory(
      contextFor(contract, worktree),
    );
    await expect(worker.run()).rejects.toMatchObject({
      code: E_ADAPTER_SANDBOX_LOCKED,
    });
  });

  it("适配器无宿主不可构造（没有本地执行分支）", () => {
    expect(
      () =>
        new OpenHandsSandboxAdapter({
          host: undefined as unknown as ContainerHostPort,
        }),
    ).toThrow(/requires a ContainerHostPort/);
  });

  it("容器内非零退出 → 抛错且不产出见证（不得记成功）", async () => {
    const host = mockHost({
      outcome: () => ({
        exitCode: 2,
        stdout: "",
        stderr: "boom",
        via: "exit",
        durationMs: 3,
      }),
    });
    const adapter = new OpenHandsSandboxAdapter({ host });
    await expect(adapter.run(taskInput(worktree))).rejects.toBeInstanceOf(
      OpenHandsSandboxError,
    );
  });

  it("被围栏拒绝的执行不会产出见证", async () => {
    const host = mockHost({
      outcome: () => ({
        exitCode: null,
        stdout: "",
        stderr: "rejected before start",
        via: "rejected",
        rejection: "EMPTY_ARGV",
        durationMs: 1,
      }),
    });
    const adapter = new OpenHandsSandboxAdapter({ host });
    const err: unknown = await adapter
      .run(taskInput(worktree))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenHandsSandboxError);
    expect((err as OpenHandsSandboxError).outcome.via).toBe("rejected");
  });

  it("见证只由宿主实际 outcome 产出（结构上无法凭空造出）", () => {
    const host = mockHost({ kind: "mock/x" });
    const outcome: SandboxRunOutcome = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      via: "exit",
      durationMs: 11,
    };
    expect(
      sandboxWitness(host, { worktreeRoot: worktree, argv: ["x"] }, outcome),
    ).toEqual({
      host_kind: "mock/x",
      via: "exit",
      exit_code: 0,
      duration_ms: 11,
      worktree_root: worktree,
    });
  });

  it("GATEWAY_ENFORCED 派工不冒充沙箱：内置档仍解析到 Managed AI 工厂", () => {
    const factory = requireControlledDispatch(
      createDefaultWorkerRegistry(),
      "stagent.builtin.ai-sdk",
    );
    expect(factory).toBe(managedAiDispatchFactory);
    expect(factory).not.toBe(openhandsSandboxDispatchFactory);
  });
});

describe("派工门禁错误码口径", () => {
  it("E_ADAPTER_SANDBOX_LOCKED 不复用「非受控」错误码", () => {
    expect(E_ADAPTER_SANDBOX_LOCKED).not.toBe("E_ADAPTER_NOT_CONTROLLED");
    const err = new WorkerDispatchError(
      E_ADAPTER_SANDBOX_LOCKED,
      OPENHANDS_WORKER_ADAPTER_ID,
      "x",
    );
    expect(err.code).toBe(E_ADAPTER_SANDBOX_LOCKED);
    expect(err.adapter_id).toBe(OPENHANDS_WORKER_ADAPTER_ID);
  });
});

/**
 * 记实不记名（TASK-W.5c-iii 的闭环点，P-121 登记的裁决在此强制执行）。
 *
 * 光「产出见证」不算闭环——证据面必须**消费**它：
 * 声明 `SANDBOX_ENFORCED` 只是声称，若本轮派工没有沙箱见证（没走 runInSandbox），
 * 证据必须降记为 `UNCONTROLLED_EXTERNAL`，否则「标了沙箱档」本身就等于受控证据。
 */
describe("记实不记名：声明档经执行面校正（resolveEvidenceControlMode）", () => {
  const witness: SandboxWitness = {
    host_kind: "docker/29.6.1",
    via: "exit",
    exit_code: 0,
    duration_ms: 12,
    worktree_root: "/tmp/wt",
  };

  it("声明 SANDBOX_ENFORCED + 有见证 → 如实记 SANDBOX_ENFORCED", () => {
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", witness)).toBe(
      "SANDBOX_ENFORCED",
    );
  });

  it("声明 SANDBOX_ENFORCED + 无见证 → 降记 UNCONTROLLED_EXTERNAL（不得冒认）", () => {
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", undefined)).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
  });

  it("GATEWAY_ENFORCED 语义不变（见证与否都不影响）", () => {
    expect(resolveEvidenceControlMode("GATEWAY_ENFORCED", undefined)).toBe(
      "GATEWAY_ENFORCED",
    );
    expect(resolveEvidenceControlMode("GATEWAY_ENFORCED", witness)).toBe(
      "GATEWAY_ENFORCED",
    );
  });

  it("UNCONTROLLED_EXTERNAL 不因有见证被「洗白」", () => {
    expect(resolveEvidenceControlMode("UNCONTROLLED_EXTERNAL", witness)).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
  });
});

describe("记实不记名：编排器证据面真实消费见证", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-oh-evidence-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => safeRmSync(repo));

  const SANDBOX_ADAPTER_ID = "test.sandbox-witness.v0";

  /** 声明合法（围栏档）的沙箱适配器载体：只登记，不执行 */
  function sandboxCarrier(): CodingWorkerAdapter {
    return {
      declaration: { ...OPENHANDS_CAPABILITY, adapter_id: SANDBOX_ADAPTER_ID },
      kind: "CLI",
      run: async () => {
        throw new Error(
          "capability carrier is not executable; dispatch via registry dispatchFactory",
        );
      },
    };
  }

  function registryWith(factory: WorkerDispatchFactory): AdapterRegistry {
    const registry = new AdapterRegistry();
    registry.register(sandboxCarrier(), "SANDBOX_ENFORCED");
    registry.registerDispatchFactory(SANDBOX_ADAPTER_ID, factory);
    return registry;
  }

  function seedSandboxContract(): SoftwareContract {
    const contract = makeContract({
      adapterId: SANDBOX_ADAPTER_ID,
      pendingApproval: true,
    });
    new ContractStore(repo).save(contract);
    return contract;
  }

  function sandboxFactory(withWitness: boolean): WorkerDispatchFactory {
    return () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: ["fake sandbox worker ran"],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
        ...(withWitness
          ? {
              sandbox: {
                host_kind: "mock/docker-29.6.1",
                via: "exit" as const,
                exit_code: 0,
                duration_ms: 9,
                worktree_root: "ignored-by-assertion",
              },
            }
          : {}),
      }),
    });
  }

  async function runThenVerify(withWitness: boolean) {
    const orchestrator = new ContractOrchestrator({
      repoRoot: repo,
      registry: registryWith(sandboxFactory(withWitness)),
    });
    const contract = seedSandboxContract();
    await orchestrator.approve(contract.contract_id, "tina");
    const result = await orchestrator.runWorker(contract.contract_id, {
      modelClient: stubModelClient,
      skipDesignStep: true,
      twoPhase: { obligations: [], waived: [] },
      containerHost: mockHost({ available: true }),
    });
    const outcome = await orchestrator.execute(contract.contract_id);
    return { result, outcome };
  }

  it("派工带见证 → 证据记 SANDBOX_ENFORCED", async () => {
    const { result, outcome } = await runThenVerify(true);
    expect(result.sandbox).toBeDefined();
    expect(outcome.evidence.worker_control_mode).toBe("SANDBOX_ENFORCED");
  }, 60_000);

  it("声明沙箱档但派工无见证 → 证据降记 UNCONTROLLED_EXTERNAL（不冒认受控）", async () => {
    const { result, outcome } = await runThenVerify(false);
    // 合同声明档仍是 SANDBOX_ENFORCED，但执行面拿不出入箱证据
    expect(result.sandbox).toBeUndefined();
    expect(outcome.evidence.worker_control_mode).toBe("UNCONTROLLED_EXTERNAL");
  }, 60_000);
});
