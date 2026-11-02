import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AdapterRegistry } from "../../daemon/worker/adapter-registry";
import {
  resolveEvidenceControlMode,
  type AdapterCapabilityDeclaration,
} from "../../daemon/worker/worker-adapter.interface";
import type {
  ContainerHostPort,
  SandboxRunInput,
  SandboxRunOutcome,
  SandboxWitness,
} from "../../daemon/worker/sandbox/container-host";
import {
  E_PROBE_EXECUTOR_UNIMPLEMENTED,
  E_PROBE_REPORT_WORDING,
  E_PROBE_SANDBOX_UNAVAILABLE,
  E_WORKER_BUILTIN_LOCKED,
  E_WORKER_DUPLICATED,
  E_WORKER_FORBIDDEN_FIELD,
  WorkerRegistrationError,
  effectiveControlMode,
  normalizeRegistration,
  workerFingerprint,
  type WorkerRecord,
} from "../../daemon/worker/verify/worker-registration";
import {
  PROBE_IDS,
  PROBE_REPORT_WORDING,
  assertReportWording,
  probeDispatchWitness,
  runProbePack,
  type ProbeExecutionPort,
  type ProbeFinding,
} from "../../daemon/worker/verify/worker-probe";
import { SandboxProbeExecutionPort } from "../../daemon/worker/verify/probe-execution-sandbox";
import { WorkerRegistrationService } from "../../daemon/worker/verify/worker-registration-service";
import { loadWorkerStore } from "../../daemon/worker/verify/worker-store";

/**
 * TASK-W.7 验收：Worker 自助注册 + 自动探测升格。
 *
 * 断言口径（与卡正文 FAIL 红线一一对应）：
 * - 注册**不可能**直接得到受控档（含「请求体伪造 control_mode」）；
 * - 探测**没有**沙箱执行面就不跑（不退回主树）；
 * - `SANDBOX_ENFORCED` 缺 `SandboxWitness` 一律不许升格，判定复用
 *   `resolveEvidenceControlMode`（不是本套测试另立的判据）；
 * - 报告措辞不得出现「绝对受控」类判断（代码生成与执行面返回一视同仁）；
 * - 版本 / 命令 / 声明任一变更即自动降级。
 */

const NOW = "2026-11-02T00:00:00.000Z";

const tempDirs: string[] = [];
const escapeFiles: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const file of escapeFiles.splice(0)) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* 已不存在 */
    }
  }
});

function tmpRepoRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w7-"));
  tempDirs.push(dir);
  return dir;
}

/** 容器档声明：如实写「直连文件系统 / 无限制 Shell / 无工具拦截」 */
function cliDeclaration(
  overrides: Partial<AdapterCapabilityDeclaration> = {},
): AdapterCapabilityDeclaration {
  return {
    adapter_id: "acme.cli.v1",
    protocol_version: "1.0.0",
    model_metering_source: "LOCAL_ESTIMATE",
    tool_interception_supported: false,
    filesystem_permissions: "DIRECT_UNCONTROLLED",
    command_permissions: "UNRESTRICTED_SHELL",
    cancellation_supported: true,
    session_recovery_supported: false,
    network_requirements: "NONE",
    platform_support: ["darwin-arm64", "linux-x64"],
    known_limitations: ["容器内直连文件系统；隔离由运行时围栏负责"],
    ...overrides,
  };
}

function registrationBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    adapter_id: "acme.cli.v1",
    adapter_version: "0.1.0",
    launch: { command: "acme", args: ["--headless"] },
    declaration: cliDeclaration(),
    ...overrides,
  };
}

function recordFixture(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  const base = normalizeRegistration(registrationBody(), NOW);
  return { ...base, ...overrides };
}

/** `AdapterRegistrationError` 的判定看 `rejection` 字段（消息里不一定带码） */
function expectAdapterRejection(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected rejection ${code}, but call succeeded`);
  } catch (err) {
    expect((err as { rejection?: string }).rejection).toBe(code);
  }
}

const WITNESS: SandboxWitness = {
  host_kind: "fake/1.0",
  via: "exit",
  exit_code: 0,
  duration_ms: 5,
  worktree_root: "/tmp/stagent-fake-worktree",
};

function passPort(
  overrides: Partial<ProbeExecutionPort> = {},
): ProbeExecutionPort {
  return {
    kind: "fake",
    isAvailable: () => true,
    async runFenceProbes(): Promise<ProbeFinding[]> {
      return [
        {
          id: "filesystem_fence",
          status: "pass",
          detail: "工作区内写入可见",
          required: true,
        },
        {
          id: "command_fence",
          status: "pass",
          detail: "网络仅环回",
          required: true,
        },
        {
          id: "evidence_integrity",
          status: "pass",
          detail: "写操作逐条可读",
          required: true,
        },
      ];
    },
    getWitness: () => WITNESS,
    ...overrides,
  };
}

/**
 * 假容器宿主：**保留 `runInSandbox` 的围栏校验**（默认执行入口不替换），
 * 只把「容器内执行」替换成按脚本内容产生确定性结果 + 真实写盘。
 *
 * 这样测的是「解析与判定」这一段，同时仍受 `validateSandboxInput()` 约束
 * （例如 cwd 传容器路径会被围栏拒绝——W.7 施工期真踩过这个坑）。
 */
function fakeContainerHost(
  behaviour: {
    escapeToHostTmp?: boolean;
    dockerSock?: "present" | "absent";
    ifaces?: string;
    capEff?: string;
    unavailable?: boolean;
  } = {},
): ContainerHostPort & { calls: SandboxRunInput[] } {
  const calls: SandboxRunInput[] = [];
  return {
    kind: "fake-docker/1.0",
    calls,
    isAvailable: () => behaviour.unavailable !== true,
    async run(input: SandboxRunInput): Promise<SandboxRunOutcome> {
      calls.push(input);
      const script = input.argv[input.argv.length - 1] ?? "";
      const root = input.worktreeRoot;
      const lines: string[] = [];

      if (script.includes("INSIDE_WRITE")) {
        fs.writeFileSync(path.join(root, ".probe-fs-inside.txt"), "ok");
        const escapeName = /\/tmp\/(stagent-probe-[A-Za-z0-9-]+\.escape)/.exec(
          script,
        )?.[1];
        if (behaviour.escapeToHostTmp === true && escapeName !== undefined) {
          const target = path.join("/tmp", escapeName);
          fs.writeFileSync(target, "x");
          escapeFiles.push(target);
        }
        lines.push("INSIDE_WRITE=ok", "ESCAPE_WRITE=ok", "READ_BACK=ok", "ok");
      } else if (script.includes("DOCKER_SOCK")) {
        lines.push(
          `DOCKER_SOCK=${behaviour.dockerSock ?? "absent"}`,
          `NET_IFACES=${behaviour.ifaces ?? "lo,"}`,
          `CAP_EFF=${behaviour.capEff ?? "0000000000000002"}`,
        );
      } else {
        fs.writeFileSync(path.join(root, ".probe-ev-1.txt"), "a");
        fs.writeFileSync(path.join(root, ".probe-ev-2.txt"), "bb");
        lines.push("EV_MARK=2");
      }

      return {
        exitCode: 0,
        stdout: lines.join("\n"),
        stderr: "",
        via: "exit",
        durationMs: 1,
      };
    },
  };
}

describe("W.7 · 注册侧：填表不可能得到受控档", () => {
  it("注册结果恒为 UNCONTROLLED_EXTERNAL", () => {
    const record = normalizeRegistration(registrationBody(), NOW);
    expect(record.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(record.builtin).toBe(false);
  });

  it("请求体带 control_mode 被拒绝（不是忽略）", () => {
    expect(() =>
      normalizeRegistration(
        registrationBody({ control_mode: "GATEWAY_ENFORCED" }),
        NOW,
      ),
    ).toThrowError(WorkerRegistrationError);
    try {
      normalizeRegistration(
        registrationBody({ control_mode: "GATEWAY_ENFORCED" }),
        NOW,
      );
    } catch (err) {
      expect((err as WorkerRegistrationError).code).toBe(
        E_WORKER_FORBIDDEN_FIELD,
      );
    }
  });

  it("请求体带 verified_on / probe_report 同样被拒", () => {
    for (const field of ["verified_on", "probe_report", "report"]) {
      expect(() =>
        normalizeRegistration(registrationBody({ [field]: {} }), NOW),
      ).toThrowError(WorkerRegistrationError);
    }
  });

  it("启动命令不接受 shell 写法", () => {
    expect(() =>
      normalizeRegistration(
        registrationBody({ launch: { command: "acme && rm -rf ~" } }),
        NOW,
      ),
    ).toThrowError(WorkerRegistrationError);
  });
});

describe("W.7 · 探测包：五类断言齐全", () => {
  it("findings 覆盖 PROBE_IDS 且顺序固定", async () => {
    const result = await runProbePack({
      record: recordFixture(),
      targetMode: "SANDBOX_ENFORCED",
      port: passPort(),
      now: NOW,
    });
    expect(result.findings.map((item) => item.id)).toEqual([...PROBE_IDS]);
  });

  it("执行面漏项按 not_verified 处理，不补假通过", async () => {
    const partial = passPort({
      runFenceProbes: async () => [
        {
          id: "filesystem_fence",
          status: "pass",
          detail: "ok",
          required: true,
        },
      ],
    });
    const result = await runProbePack({
      record: recordFixture(),
      targetMode: "SANDBOX_ENFORCED",
      port: partial,
      now: NOW,
    });
    const byId = new Map(result.findings.map((item) => [item.id, item.status]));
    expect(byId.get("command_fence")).toBe("not_verified");
    expect(byId.get("evidence_integrity")).toBe("not_verified");
    expect(result.promotion.allowed).toBe(false);
  });

  it("SANDBOX 目标 + 有见证 → 允许升格", async () => {
    const result = await runProbePack({
      record: recordFixture(),
      targetMode: "SANDBOX_ENFORCED",
      port: passPort(),
      now: NOW,
    });
    expect(result.promotion.allowed).toBe(true);
    expect(result.promotion.control_mode).toBe("SANDBOX_ENFORCED");
    expect(result.report.status).toBe("passed");
    expect(result.report.fingerprint).toHaveLength(32);
  });

  it("GATEWAY 目标下 dispatch_witness 记 N/A 且非必需", async () => {
    const strict = cliDeclaration({
      filesystem_permissions: "GATEWAY_ONLY",
      command_permissions: "WHITELIST_ONLY",
      tool_interception_supported: true,
    });
    const result = await runProbePack({
      record: recordFixture({ declaration: strict }),
      targetMode: "GATEWAY_ENFORCED",
      port: passPort({ getWitness: () => undefined }),
      now: NOW,
    });
    const witnessFinding = result.findings.find(
      (item) => item.id === "dispatch_witness",
    );
    expect(witnessFinding?.status).toBe("not_verified");
    expect(witnessFinding?.required).toBe(false);
    // 该档位本就不进容器，见证不适用 ⇒ 不因此拒绝升格
    expect(result.promotion.allowed).toBe(true);
  });
});

describe("W.7 · P5：缺 SandboxWitness 一律不许记受控档", () => {
  it("判定与 resolveEvidenceControlMode 完全一致（不另造判据）", () => {
    const pass = probeDispatchWitness("SANDBOX_ENFORCED", WITNESS);
    const fail = probeDispatchWitness("SANDBOX_ENFORCED", undefined);
    expect(pass.status).toBe("pass");
    expect(fail.status).toBe("fail");
    // 交叉校验：探测判据的「通过」当且仅当证据面校正后仍是 SANDBOX_ENFORCED
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", WITNESS)).toBe(
      "SANDBOX_ENFORCED",
    );
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", undefined)).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
  });

  it("执行面给不出见证 → 其余全绿也不升格", async () => {
    const result = await runProbePack({
      record: recordFixture(),
      targetMode: "SANDBOX_ENFORCED",
      port: passPort({ getWitness: () => undefined }),
      now: NOW,
    });
    expect(result.promotion.allowed).toBe(false);
    expect(result.promotion.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(result.promotion.refusals.join(" ")).toContain("dispatch_witness");
    expect(result.report.status).toBe("failed");
  });
});

describe("W.7 · 负例：没有沙箱就不许探测", () => {
  it("执行面不可用 → 直接拒绝且不产报告", async () => {
    const port = passPort({ isAvailable: () => false });
    await expect(
      runProbePack({
        record: recordFixture(),
        targetMode: "SANDBOX_ENFORCED",
        port,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: E_PROBE_SANDBOX_UNAVAILABLE });
  });

  it("容器实现拿不到宿主时同样拒绝执行（不退回主树）", async () => {
    const host = fakeContainerHost({ unavailable: true });
    const port = new SandboxProbeExecutionPort({ host });
    expect(port.isAvailable()).toBe(false);
    await expect(
      runProbePack({
        record: recordFixture(),
        targetMode: "SANDBOX_ENFORCED",
        port,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: E_PROBE_SANDBOX_UNAVAILABLE });
    // 关键：一次容器调用都没有发生
    expect(host.calls).toHaveLength(0);
  });
});

describe("W.7 · 报告措辞：不得宣称绝对受控", () => {
  it("固定结语本身不含绝对判断", () => {
    expect(PROBE_REPORT_WORDING).toContain("通过已知探测集");
    expect(() => assertReportWording(PROBE_REPORT_WORDING)).not.toThrow();
  });

  it("执行面返回「绝对受控」也会被拦下", async () => {
    const port = passPort({
      runFenceProbes: async () => [
        {
          id: "filesystem_fence",
          status: "pass",
          detail: "该适配器绝对受控",
          required: true,
        },
      ],
    });
    await expect(
      runProbePack({
        record: recordFixture(),
        targetMode: "SANDBOX_ENFORCED",
        port,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: E_PROBE_REPORT_WORDING });
  });
});

describe("W.7 · 容器探测执行面：三类围栏的真实观测", () => {
  it("全部符合时三项 pass，且见证来自真实宿主执行", async () => {
    const host = fakeContainerHost();
    const port = new SandboxProbeExecutionPort({ host });
    const findings = await port.runFenceProbes({
      adapter_id: "acme.cli.v1",
      launch: { command: "acme", args: [] },
      declaration: cliDeclaration(),
      target_mode: "SANDBOX_ENFORCED",
    });
    expect(findings.map((item) => [item.id, item.status])).toEqual([
      ["filesystem_fence", "pass"],
      ["command_fence", "pass"],
      ["evidence_integrity", "pass"],
    ]);
    const witness = port.getWitness();
    expect(witness?.host_kind).toBe("fake-docker/1.0");
    port.dispose();
  });

  it("容器内写到宿主 /tmp 可见 → 文件围栏判 fail", async () => {
    const host = fakeContainerHost({ escapeToHostTmp: true });
    const port = new SandboxProbeExecutionPort({ host });
    const findings = await port.runFenceProbes({
      adapter_id: "acme.cli.v1",
      launch: { command: "acme", args: [] },
      declaration: cliDeclaration(),
      target_mode: "SANDBOX_ENFORCED",
    });
    const fsFinding = findings.find((item) => item.id === "filesystem_fence");
    expect(fsFinding?.status).toBe("fail");
    expect(fsFinding?.detail).toContain("围栏不成立");
    port.dispose();
  });

  it("容器可见 docker socket / 多网卡 / 能力未收敛 → 命令围栏判 fail", async () => {
    const host = fakeContainerHost({
      dockerSock: "present",
      ifaces: "lo,eth0,",
      capEff: "000001ffffffffff",
    });
    const port = new SandboxProbeExecutionPort({ host });
    const findings = await port.runFenceProbes({
      adapter_id: "acme.cli.v1",
      launch: { command: "acme", args: [] },
      declaration: cliDeclaration(),
      target_mode: "SANDBOX_ENFORCED",
    });
    const cmdFinding = findings.find((item) => item.id === "command_fence");
    expect(cmdFinding?.status).toBe("fail");
    expect(cmdFinding?.detail).toContain("docker socket");
    expect(cmdFinding?.detail).toContain("网络接口");
    expect(cmdFinding?.detail).toContain("能力集");
    port.dispose();
  });

  it("探测工作区是独立临时目录，绝不挂载仓库主树", async () => {
    const host = fakeContainerHost();
    const port = new SandboxProbeExecutionPort({ host });
    await port.runFenceProbes({
      adapter_id: "acme.cli.v1",
      launch: { command: "acme", args: [] },
      declaration: cliDeclaration(),
      target_mode: "SANDBOX_ENFORCED",
    });
    for (const call of host.calls) {
      expect(call.worktreeRoot).toContain("stagent-probe-");
      expect(call.worktreeRoot.startsWith(os.tmpdir())).toBe(true);
      expect(call.networkPolicy).toBe("DENY");
    }
    port.dispose();
  });
});

describe("W.7 · 升格入口：注册中心唯一通道", () => {
  function registryWithEntry(): { registry: AdapterRegistry; id: string } {
    const registry = new AdapterRegistry();
    const id = "acme.cli.v1";
    registry.register(
      {
        kind: "CLI",
        declaration: cliDeclaration(),
        async run() {
          throw new Error("no executor");
        },
      },
      "UNCONTROLLED_EXTERNAL",
    );
    return { registry, id };
  }

  it("降级恒允许且无需证据", () => {
    const { registry, id } = registryWithEntry();
    registry.promoteControlMode(id, "SANDBOX_ENFORCED", {
      report_fingerprint: "f".repeat(32),
    });
    const down = registry.promoteControlMode(id, "UNCONTROLLED_EXTERNAL", {
      reason: "手动降级",
    });
    expect(down.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(down.last_transition?.reason).toBe("手动降级");
  });

  it("升格缺报告指纹 → ADAPTER_PROMOTION_REFUSED", () => {
    const { registry, id } = registryWithEntry();
    expectAdapterRejection(
      () => registry.promoteControlMode(id, "SANDBOX_ENFORCED"),
      "ADAPTER_PROMOTION_REFUSED",
    );
  });

  it("升格到 GATEWAY 仍要过严格档校验", () => {
    const { registry, id } = registryWithEntry();
    expectAdapterRejection(
      () =>
        registry.promoteControlMode(id, "GATEWAY_ENFORCED", {
          report_fingerprint: "f".repeat(32),
        }),
      "FILESYSTEM_DIRECT_UNCONTROLLED",
    );
  });

  it("同档位重复调用幂等", () => {
    const { registry, id } = registryWithEntry();
    registry.promoteControlMode(id, "SANDBOX_ENFORCED", {
      report_fingerprint: "f".repeat(32),
    });
    const again = registry.promoteControlMode(id, "SANDBOX_ENFORCED");
    expect(again.control_mode).toBe("SANDBOX_ENFORCED");
  });

  it("幽灵 id 拒绝改档", () => {
    const { registry } = registryWithEntry();
    expectAdapterRejection(
      () => registry.promoteControlMode("ghost.id", "UNCONTROLLED_EXTERNAL"),
      "ADAPTER_ID_INVALID",
    );
  });
});

describe("W.7 · 指纹变更自动降级（手改文件也绕不过）", () => {
  it("指纹一致则保持受控；版本变更 / 缺实测 → 降级", () => {
    const base = recordFixture({ control_mode: "SANDBOX_ENFORCED" });
    const verified: WorkerRecord = {
      ...base,
      verified_on: {
        cli_version: "0.1.0",
        verified_at: NOW,
        fingerprint: workerFingerprint(base),
      },
    };
    expect(effectiveControlMode(verified).mode).toBe("SANDBOX_ENFORCED");

    const bumped: WorkerRecord = { ...verified, adapter_version: "0.2.0" };
    expect(effectiveControlMode(bumped).mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(effectiveControlMode(bumped).demoted_reason).toContain("指纹不一致");

    // 标了受控但没有实测记录 → 同样降级（记录本身不可信）
    expect(effectiveControlMode(base).mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(effectiveControlMode(base).demoted_reason).toContain("verified_on");
  });

  it("改启动命令也会使原探测结论失效", () => {
    const base = recordFixture({ control_mode: "SANDBOX_ENFORCED" });
    const verified: WorkerRecord = {
      ...base,
      verified_on: {
        cli_version: "0.1.0",
        verified_at: NOW,
        fingerprint: workerFingerprint(base),
      },
    };
    const swapped: WorkerRecord = {
      ...verified,
      launch: { command: "other-cli", args: [] },
    };
    expect(effectiveControlMode(swapped).mode).toBe("UNCONTROLLED_EXTERNAL");
  });
});

describe("W.7 · 服务层：登记 → 探测 → 升格", () => {
  function makeService(
    repoRoot: string,
    host: ContainerHostPort,
  ): { service: WorkerRegistrationService; registry: AdapterRegistry } {
    const registry = new AdapterRegistry();
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
      createContainerHost: () => host,
    });
    return { service, registry };
  }

  it("登记后为非受控且不可派工；重复登记被拒", () => {
    const repoRoot = tmpRepoRoot();
    const { service } = makeService(repoRoot, fakeContainerHost());
    const view = service.register(registrationBody());
    expect(view.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(view.dispatchable).toBe(false);
    expect(view.dispatch_blocked_reason).toContain("派工工厂");
    expect(() => service.register(registrationBody())).toThrowError(
      WorkerRegistrationError,
    );
    try {
      service.register(registrationBody());
    } catch (err) {
      expect((err as WorkerRegistrationError).code).toBe(E_WORKER_DUPLICATED);
    }
  });

  it("探测通过后升为 SANDBOX_ENFORCED，存储与注册表同时生效", async () => {
    const repoRoot = tmpRepoRoot();
    const host = fakeContainerHost();
    const { service, registry } = makeService(repoRoot, host);
    service.register(registrationBody());

    const outcome = await service.verify("acme.cli.v1", {
      target_mode: "SANDBOX_ENFORCED",
    });
    expect(outcome.promoted).toBe(true);
    expect(outcome.control_mode).toBe("SANDBOX_ENFORCED");
    expect(outcome.report.findings).toHaveLength(PROBE_IDS.length);

    const stored = loadWorkerStore(repoRoot).workers[0];
    expect(stored?.control_mode).toBe("SANDBOX_ENFORCED");
    expect(stored?.verified_on?.fingerprint).toBe(outcome.report.fingerprint);
    expect(registry.get("acme.cli.v1")?.control_mode).toBe("SANDBOX_ENFORCED");
    // 派工仍不可用：档位记录 ≠ 有执行器
    expect(outcome.worker.dispatchable).toBe(false);
  });

  it("探测失败只落报告，档位保持非受控", async () => {
    const repoRoot = tmpRepoRoot();
    const host = fakeContainerHost({ dockerSock: "present" });
    const { service, registry } = makeService(repoRoot, host);
    service.register(registrationBody());

    const outcome = await service.verify("acme.cli.v1", {
      target_mode: "SANDBOX_ENFORCED",
    });
    expect(outcome.promoted).toBe(false);
    expect(outcome.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(outcome.refusals.length).toBeGreaterThan(0);
    expect(loadWorkerStore(repoRoot).workers[0]?.control_mode).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
    expect(registry.get("acme.cli.v1")?.control_mode).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
  });

  it("GATEWAY 目标无执行器 → 明确报未实现（不拿 mock 冒充生产）", async () => {
    const repoRoot = tmpRepoRoot();
    const registry = new AdapterRegistry();
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
    });
    service.register(registrationBody());
    await expect(
      service.verify("acme.cli.v1", { target_mode: "GATEWAY_ENFORCED" }),
    ).rejects.toMatchObject({ code: E_PROBE_EXECUTOR_UNIMPLEMENTED });
  });

  it("内建项不允许经 API 改档", async () => {
    const repoRoot = tmpRepoRoot();
    const registry = new AdapterRegistry();
    registry.register(
      {
        kind: "MANAGED_AI",
        declaration: cliDeclaration({
          adapter_id: "stagent.builtin.v0",
          filesystem_permissions: "GATEWAY_ONLY",
          command_permissions: "WHITELIST_ONLY",
          tool_interception_supported: true,
        }),
        async run() {
          throw new Error("no executor");
        },
      },
      "GATEWAY_ENFORCED",
    );
    const service = new WorkerRegistrationService({
      repoRoot,
      registry,
      now: () => NOW,
    });
    await expect(
      service.verify("stagent.builtin.v0", { target_mode: "SANDBOX_ENFORCED" }),
    ).rejects.toMatchObject({ code: E_WORKER_BUILTIN_LOCKED });
  });
});

/**
 * 卡正文范围 3 的落地方式（施工期按代码事实校正过）：
 * 「把 `SANDBOX_ENFORCED` 扩进两处枚举，漏改即 FAIL」在 W.5c-i 已完成，
 * 故 W.7 不再把它当待做前置，而是降级为**源码回归断言**——防的是将来有人
 * 只在一边加档位，导致「编排器认三值、证据面认两值」这类静默分叉。
 */
describe("W.7 · 枚举双扩回归（漏改单边即 FAIL）", () => {
  const repoRoot = path.resolve(__dirname, "../..");

  it("daemon 侧 AdapterControlMode 为三值", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "daemon/worker/worker-adapter.interface.ts"),
      "utf8",
    );
    const match = /export type AdapterControlMode\s*=([\s\S]*?);/.exec(source);
    expect(match).not.toBeNull();
    for (const mode of [
      "GATEWAY_ENFORCED",
      "SANDBOX_ENFORCED",
      "UNCONTROLLED_EXTERNAL",
    ]) {
      expect(match?.[1]).toContain(mode);
    }
  });

  it("合同 schema 侧 workerControlModeSchema 为三值", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "src/lib/contract.schema.ts"),
      "utf8",
    );
    const match =
      /workerControlModeSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/.exec(source);
    expect(match).not.toBeNull();
    for (const mode of [
      "GATEWAY_ENFORCED",
      "SANDBOX_ENFORCED",
      "UNCONTROLLED_EXTERNAL",
    ]) {
      expect(match?.[1]).toContain(mode);
    }
  });

  it("能力校验按三档分派（SANDBOX 走围栏档，不套严格档）", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "daemon/worker/worker-adapter.interface.ts"),
      "utf8",
    );
    const body =
      /export function validateAdapterCapability\(([\s\S]*?)\n}/.exec(
        source,
      )?.[1];
    expect(body).toBeTruthy();
    expect(body).toContain("validateSandboxFenceTier");
    expect(body).toContain('controlMode === "UNCONTROLLED_EXTERNAL"');
  });

  it("探测包 P5 引用 resolveEvidenceControlMode（不另造判据）", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "daemon/worker/verify/worker-probe.ts"),
      "utf8",
    );
    expect(source).toContain("resolveEvidenceControlMode(");
    // 反向：不得出现自己判 `witness === undefined` 的替代判据
    expect(source).not.toMatch(
      /witness\s*===?\s*undefined\s*\?\s*"UNCONTROLLED_EXTERNAL"/,
    );
  });
});
