/**
 * TASK-W.5c-ii：容器运行时 `runInSandbox` 与派工门禁切换验收。
 *
 * 覆盖（卡正文 PASS CH-01～CH-04）：
 * CH-01：仅见任务 Worktree；诱导挂载宿主根 / `.git` / `.stagent` → 拒绝。
 * CH-02：`cwd` 外被拒；逃逸 / 网络出站至未授权目标 → 失败关闭。
 * CH-03：超时 / `signal` 取消 → 明确终止态，无孤儿进程（经宿主回收）。
 * CH-04：注入 mock 宿主即可完成断言（**不要求本机容器运行时**）；
 *        未注入宿主时 `requireControlledDispatch()` 对 `SANDBOX_ENFORCED` 仍拒绝派工。
 *
 * 纪律：不绑定真实 Docker / Podman；不填 `verified_on`（归 W.5c-iii）；
 * 不以普通本地子进程冒充沙箱（§4.2.3 P-17）。
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  SandboxRejectedError,
  assertMountAllowed,
  assertNetworkAllowed,
  runInSandbox,
  validateSandboxInput,
  type ContainerHostPort,
  type SandboxRunInput,
  type SandboxRunOutcome,
} from "../../daemon/worker/sandbox/container-host";
import { AdapterRegistry } from "../../daemon/worker/adapter-registry";
import {
  E_ADAPTER_SANDBOX_LOCKED,
  WorkerDispatchError,
  requireControlledDispatch,
  type WorkerDispatchFactory,
} from "../../daemon/worker/worker-dispatch";
import {
  MANAGED_AI_CAPABILITY,
  type CodingWorkerAdapter,
} from "../../daemon/worker/worker-adapter.interface";

const SANDBOX_ID = "test.sandbox-enforced.v0";
const GATEWAY_ID = "test.gateway-enforced.v0";
const UNCONTROLLED_ID = "test.uncontrolled-external.v0";

function fakeAdapter(adapterId: string): CodingWorkerAdapter {
  return {
    declaration: { ...MANAGED_AI_CAPABILITY, adapter_id: adapterId },
    kind: "MANAGED_AI",
    run: async () => ({
      changes: [],
      log: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  };
}

/** mock 容器宿主：记录输入、可被脚本化为不可用 / 超时 / 取消 */
function mockHost(
  overrides: {
    available?: boolean;
    outcome?: (input: SandboxRunInput) => SandboxRunOutcome;
  } = {},
): ContainerHostPort & { calls: SandboxRunInput[] } {
  const calls: SandboxRunInput[] = [];
  return {
    calls,
    isAvailable: () => overrides.available ?? true,
    run: async (input) => {
      calls.push(input);
      return (
        overrides.outcome?.(input) ?? {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          via: "exit",
          durationMs: 1,
        }
      );
    },
  };
}

describe("CH-01 / CH-02：挂载与网络围栏（失败关闭）", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-sandbox-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.mkdirSync(path.join(worktree, ".git"), { recursive: true });
  });

  afterEach(() => safeRmSync(worktree));

  it("CH-01：Worktree 内路径放行", () => {
    expect(() =>
      assertMountAllowed(worktree, path.join(worktree, "src")),
    ).not.toThrow();
  });

  it("CH-01：诱导挂载宿主根 → 拒绝", () => {
    expect(() =>
      assertMountAllowed(worktree, path.parse(worktree).root),
    ).toThrow(SandboxRejectedError);
  });

  it("CH-01：诱导挂载 .git / .stagent 保护区 → 拒绝", () => {
    for (const seg of [".git", ".stagent"]) {
      expect(() =>
        assertMountAllowed(worktree, path.join(worktree, seg)),
      ).toThrow(SandboxRejectedError);
    }
  });

  it("CH-02：路径穿越（..）→ 拒绝", () => {
    // 显式含 `..` 字面量 → 更早失败并给出 TRAVERSAL 码
    expect(() => assertMountAllowed(worktree, `${worktree}/../etc`)).toThrow(
      /MOUNT_PATH_TRAVERSAL/,
    );
    // `path.join` 已归一化的等价逃逸 → 落在「越出 Worktree」分支，同样拒绝
    expect(() =>
      assertMountAllowed(worktree, path.join(worktree, "..", "etc")),
    ).toThrow(/MOUNT_OUTSIDE_WORKTREE/);
  });

  it("CH-02：cwd 逃出 Worktree → 拒绝", () => {
    expect(() =>
      validateSandboxInput({
        worktreeRoot: worktree,
        argv: ["node", "-e", "0"],
        cwd: "/etc",
      }),
    ).toThrow(/CWD_OUTSIDE_WORKTREE/);
  });

  it("CH-02：DENY 下携带出口目标 → 拒绝", () => {
    expect(() => assertNetworkAllowed("DENY", ["https://example.com"])).toThrow(
      /NETWORK_TARGET_NOT_ALLOWED/,
    );
  });

  it("CH-02：EXPLICIT_TARGETS 未给白名单 → 拒绝", () => {
    expect(() => assertNetworkAllowed("EXPLICIT_TARGETS", [])).toThrow(
      /NETWORK_TARGET_NOT_ALLOWED/,
    );
  });

  it("空 argv → 拒绝（不执行）", () => {
    expect(() =>
      validateSandboxInput({ worktreeRoot: worktree, argv: [] }),
    ).toThrow(/EMPTY_ARGV/);
  });
});

describe("CH-03：超时 / 取消 → 明确终止态，无孤儿", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-sandbox-"));
  });

  afterEach(() => safeRmSync(worktree));

  it("宿主返回 timeout 终止态", async () => {
    const host = mockHost({
      outcome: () => ({
        exitCode: null,
        stdout: "",
        stderr: "timeout",
        via: "timeout",
        durationMs: 5,
      }),
    });
    const out = await runInSandbox(host, {
      worktreeRoot: worktree,
      argv: ["sleep", "100"],
      timeoutMs: 10,
    });
    expect(out.via).toBe("timeout");
    expect(out.exitCode).toBeNull();
  });

  it("signal 已取消 → 不进入宿主执行，返回 SIGKILL 终止态", async () => {
    const host = mockHost();
    const ac = new AbortController();
    ac.abort();
    const out = await runInSandbox(
      host,
      { worktreeRoot: worktree, argv: ["node", "-e", "0"] },
      ac.signal,
    );
    expect(out.via).toBe("SIGKILL");
    expect(host.calls).toHaveLength(0); // 未启动子进程 → 无孤儿
  });

  it("宿主返回 SIGKILL 终止态（进程树已被回收）", async () => {
    const host = mockHost({
      outcome: () => ({
        exitCode: null,
        stdout: "",
        stderr: "",
        via: "SIGKILL",
        durationMs: 3,
      }),
    });
    const out = await runInSandbox(
      host,
      { worktreeRoot: worktree, argv: ["node", "-e", "0"] },
      AbortSignal.timeout(1),
    );
    expect(out.via).toBe("SIGKILL");
  });
});

describe("CH-04：mock 宿主可完成验收 + 门禁按宿主可用性放行", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-sandbox-"));
  });

  afterEach(() => safeRmSync(worktree));

  it("CH-04：注入 mock 宿主即可跑通（不要求本机容器运行时）", async () => {
    const host = mockHost();
    const out = await runInSandbox(host, {
      worktreeRoot: worktree,
      argv: ["node", "-e", "process.exit(0)"],
      mounts: [{ source: worktree, target: "/workspace" }],
    });
    expect(out.exitCode).toBe(0);
    expect(host.calls).toHaveLength(1);
    // 交给宿主的输入已通过围栏（Worktree 已归一化）
    expect(host.calls[0]!.worktreeRoot).toBe(worktree);
  });

  it("CH-04：未注入宿主 → SANDBOX_ENFORCED 仍拒绝派工（E_ADAPTER_SANDBOX_LOCKED）", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter(SANDBOX_ID), "SANDBOX_ENFORCED");
    registry.registerDispatchFactory(SANDBOX_ID, () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    }));

    const err: unknown = (() => {
      try {
        requireControlledDispatch(registry, SANDBOX_ID);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(WorkerDispatchError);
    expect((err as WorkerDispatchError).code).toBe(E_ADAPTER_SANDBOX_LOCKED);
    expect((err as WorkerDispatchError).message).toContain("ContainerHostPort");
  });

  it("宿主不可用（isAvailable=false）→ 拒绝派工，不静默降级", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter(SANDBOX_ID), "SANDBOX_ENFORCED");
    const factory: WorkerDispatchFactory = () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    });
    registry.registerDispatchFactory(SANDBOX_ID, factory);

    expect(() =>
      requireControlledDispatch(registry, SANDBOX_ID, {
        containerHost: mockHost({ available: false }),
      }),
    ).toThrow(E_ADAPTER_SANDBOX_LOCKED);
  });

  it("宿主可用 → 放行并返回工厂（窗口期「永远拒绝」已解除）", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter(SANDBOX_ID), "SANDBOX_ENFORCED");
    const factory: WorkerDispatchFactory = () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    });
    registry.registerDispatchFactory(SANDBOX_ID, factory);

    expect(
      requireControlledDispatch(registry, SANDBOX_ID, {
        containerHost: mockHost({ available: true }),
      }),
    ).toBe(factory);
  });

  it("未注册适配器 → E_ADAPTER_NOT_REGISTERED（门禁第一分支）", () => {
    const registry = new AdapterRegistry();
    expect(() =>
      requireControlledDispatch(registry, SANDBOX_ID, {
        containerHost: mockHost({ available: true }),
      }),
    ).toThrow(/E_ADAPTER_NOT_REGISTERED/);
  });

  it("UNCONTROLLED_EXTERNAL → E_ADAPTER_NOT_CONTROLLED（不因注入宿主而放行）", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter(UNCONTROLLED_ID), "UNCONTROLLED_EXTERNAL");
    registry.registerDispatchFactory(UNCONTROLLED_ID, () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    }));
    // 即使宿主可用，非受控档位也不得借沙箱宿主「洗白」为受控执行
    expect(() =>
      requireControlledDispatch(registry, UNCONTROLLED_ID, {
        containerHost: mockHost({ available: true }),
      }),
    ).toThrow(/E_ADAPTER_NOT_CONTROLLED/);
  });

  it("GATEWAY_ENFORCED 不受宿主影响（不回归）", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter(GATEWAY_ID), "GATEWAY_ENFORCED");
    const factory: WorkerDispatchFactory = () => ({
      run: async () => ({
        applied: true,
        changes: [],
        log: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        blockers: [],
      }),
    });
    registry.registerDispatchFactory(GATEWAY_ID, factory);
    expect(requireControlledDispatch(registry, GATEWAY_ID)).toBe(factory);
  });
});
