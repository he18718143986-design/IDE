/**
 * TASK-W.5b：cursor-agent 适配器（`UNCONTROLLED_EXTERNAL` 登记）与 W.7 探测包的
 * **非容器外部适配器负向回归基准**。
 *
 * 覆盖卡正文 PASS `CA-01`～`CA-05` / `CA-07` / `CA-08`（`CA-06` 是真实 CLI 负例，
 * 见 `tests/e2e/cursor-agent-real.real.test.ts`，需 `STAGENT_REAL_CURSOR=1` +
 * 有效 `CURSOR_API_KEY`）。
 *
 * 两重身份在断言里是**分开**的：
 * - 身份①（外部适配器实测）：`CA-01`～`CA-05`、`CA-08` —— 声明如实、档位与门禁、
 *   argv / env / MCP 面、`verified_on` 不虚填；
 * - 身份②（探测包非容器回归基准）：`CA-07` —— 探测包必须**拒绝**这一类适配器。
 *   断言方向是负向：`capability_declaration` 判 `fail` 才算对，出 `pass` 是缺陷。
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import { AdapterRegistrationError } from "../../daemon/worker/adapter-registry";
import { createDefaultWorkerRegistry } from "../../daemon/worker/default-worker-registry";
import { validateAdapterCapability } from "../../daemon/worker/worker-adapter.interface";
import {
  E_ADAPTER_NOT_CONTROLLED,
  E_ADAPTER_SANDBOX_LOCKED,
  WorkerDispatchError,
  requireControlledDispatch,
} from "../../daemon/worker/worker-dispatch";
import {
  CURSOR_AGENT_ALLOWED_FLAGS,
  CURSOR_AGENT_CAPABILITY,
  CURSOR_AGENT_FORBIDDEN_FLAGS,
  CURSOR_AGENT_MEASUREMENT,
  CURSOR_AGENT_VERIFIED_ON,
  CURSOR_AGENT_WORKER_ADAPTER_ID,
  CursorAgentAdapter,
  CursorAgentAdapterError,
  E_CURSOR_AGENT_FORBIDDEN_FLAG,
  E_CURSOR_AGENT_NO_API_KEY,
  E_CURSOR_AGENT_NO_EXECUTOR,
  assertNoForbiddenFlags,
  type CursorAgentAdapterOptions,
  type CursorAgentBuiltLaunch,
} from "../../daemon/worker/cli-host/cursor-agent-adapter";
import type { AdapterTaskInput } from "../../daemon/worker/worker-adapter.interface";
import { WorkerRegistrationService } from "../../daemon/worker/verify/worker-registration-service";
import {
  E_PROBE_SANDBOX_UNAVAILABLE,
  type WorkerRecord,
} from "../../daemon/worker/verify/worker-registration";
import {
  PROBE_IDS,
  probeCapabilityDeclaration,
  probeDispatchWitness,
  runProbePack,
  type ProbeExecutionPort,
  type ProbeId,
  type ProbeStatus,
} from "../../daemon/worker/verify/worker-probe";

const MCP_URL = "http://127.0.0.1:7788/api/mcp";
const NOW = "2026-11-02T22:00:00.000Z";
/** 适配器没有执行入口，`run()` 的入参不会被读取；用占位对象避免构造整个合同 */
const DUMMY_INPUT = {} as unknown as AdapterTaskInput;

const roots: string[] = [];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w5b-cursor-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) safeRmSync(dir);
  }
});

/** 造一个「已登记但只有声明」的 cursor-agent 记录，供探测包负向回归使用 */
function recordFixture(): WorkerRecord {
  return {
    adapter_id: CURSOR_AGENT_WORKER_ADAPTER_ID,
    adapter_version: CURSOR_AGENT_CAPABILITY.protocol_version,
    launch: { command: "cursor-agent", args: ["--print"] },
    declaration: CURSOR_AGENT_CAPABILITY,
    control_mode: "UNCONTROLLED_EXTERNAL",
    builtin: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

/** 不可用执行面：宿主进程适配器没有容器执行面，探测必须被拒绝而不是退回主树 */
function unavailablePort(): ProbeExecutionPort {
  return {
    kind: "sandbox",
    isAvailable: () => false,
    runFenceProbes: async () => {
      throw new Error("不应被调用：执行面不可用时探测包必须先判 isAvailable()");
    },
  };
}

function adapter(options: CursorAgentAdapterOptions = {}): CursorAgentAdapter {
  return new CursorAgentAdapter(options);
}

/** 造一次纯构建；`mcpServerUrl` 用 `in` 判定，以便显式构造「端点缺失」场景 */
function launchOf(
  overrides: {
    apiKey?: string | undefined;
    configDir?: string;
    mcpServerUrl?: string | undefined;
    authToken?: string;
  } = {},
): CursorAgentBuiltLaunch {
  const configDir = overrides.configDir ?? tmpRoot();
  const options: CursorAgentAdapterOptions = {
    configDir,
    apiKey: () => overrides.apiKey,
  };
  if ("mcpServerUrl" in overrides) {
    if (overrides.mcpServerUrl !== undefined) {
      options.mcpServerUrl = overrides.mcpServerUrl;
    }
  } else {
    options.mcpServerUrl = MCP_URL;
  }
  if (overrides.authToken !== undefined)
    options.authToken = overrides.authToken;
  return new CursorAgentAdapter(options).buildLaunch({
    prompt: "ping",
    cwd: "/tmp/worktree-w5b",
  });
}

// ---------------------------------------------------------------------------
// 身份①：外部适配器实测 —— 声明如实（CA-01）
// ---------------------------------------------------------------------------

describe("CA-01 能力声明如实，严格档必拒（不为过校验而美化）", () => {
  it("按最坏事实声明：直连文件系统 + 无限制 Shell + 无工具拦截", () => {
    expect(CURSOR_AGENT_CAPABILITY.filesystem_permissions).toBe(
      "DIRECT_UNCONTROLLED",
    );
    expect(CURSOR_AGENT_CAPABILITY.command_permissions).toBe(
      "UNRESTRICTED_SHELL",
    );
    expect(CURSOR_AGENT_CAPABILITY.tool_interception_supported).toBe(false);
    expect(CURSOR_AGENT_CAPABILITY.known_limitations.length).toBeGreaterThan(0);
  });

  it("严格档校验必须失败（拒因落在直连文件系统 / 无工具拦截）", () => {
    const result = validateAdapterCapability(
      CURSOR_AGENT_CAPABILITY,
      "GATEWAY_ENFORCED",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([
      "FILESYSTEM_DIRECT_UNCONTROLLED",
      "COMMAND_UNRESTRICTED_SHELL",
      "TOOL_INTERCEPTION_UNSUPPORTED",
    ]).toContain(result.code);
  });

  it("标识档校验通过（否则根本登记不进去）", () => {
    expect(
      validateAdapterCapability(
        CURSOR_AGENT_CAPABILITY,
        "UNCONTROLLED_EXTERNAL",
      ).ok,
    ).toBe(true);
  });

  it("反向断言：美化后的副本「能过严格档」——证明上面的失败源于如实，而非校验失效", () => {
    const beautified = {
      ...CURSOR_AGENT_CAPABILITY,
      filesystem_permissions: "GATEWAY_ONLY" as const,
      command_permissions: "WHITELIST_ONLY" as const,
      tool_interception_supported: true,
    };
    expect(validateAdapterCapability(beautified, "GATEWAY_ENFORCED").ok).toBe(
      true,
    );
  });

  it("围栏档校验「能通过」是陷阱：通过校验 ≠ 够格标 SANDBOX_ENFORCED（REJ-010）", () => {
    // 这条不是在夸声明「够沙箱档」，而是把卡内写的陷阱固化成断言：
    // validateSandboxFenceTier 只查 known_limitations + 平台矩阵，所以宿主进程
    // 适配器也能过——真正挡住它的是「没有 runInSandbox() 路径、产不出 SandboxWitness」。
    expect(
      validateAdapterCapability(CURSOR_AGENT_CAPABILITY, "SANDBOX_ENFORCED").ok,
    ).toBe(true);
    expect(CURSOR_AGENT_CAPABILITY.known_limitations.length).toBeGreaterThan(0);
    expect(CURSOR_AGENT_CAPABILITY.platform_support.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 身份①：档位与派工门禁（CA-02）
// ---------------------------------------------------------------------------

describe("CA-02 登记为 UNCONTROLLED_EXTERNAL，不可派工", () => {
  it("默认注册表登记 cursor-agent，档位恒为 UNCONTROLLED_EXTERNAL", () => {
    const registry = createDefaultWorkerRegistry();
    const entry = registry.get(CURSOR_AGENT_WORKER_ADAPTER_ID);
    expect(entry, "cursor-agent 应已登记为内建适配器").toBeDefined();
    expect(entry?.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(entry?.declaration.adapter_id).toBe(CURSOR_AGENT_WORKER_ADAPTER_ID);
  });

  it("派工门禁以 E_ADAPTER_NOT_CONTROLLED 明确拒绝（不静默降级）", () => {
    const registry = createDefaultWorkerRegistry();
    let caught: unknown;
    try {
      requireControlledDispatch(registry, CURSOR_AGENT_WORKER_ADAPTER_ID);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkerDispatchError);
    expect((caught as WorkerDispatchError).code).toBe(E_ADAPTER_NOT_CONTROLLED);
  });

  it("未挂派工工厂（结构性：不存在 cursorAgentDispatchFactory 这类工厂）", () => {
    const registry = createDefaultWorkerRegistry();
    expect(
      registry.getDispatchFactory(CURSOR_AGENT_WORKER_ADAPTER_ID),
    ).toBeUndefined();
  });

  it("默认注册表项数由 4 增到 5", () => {
    expect(createDefaultWorkerRegistry().list()).toHaveLength(5);
  });

  it("列表可见并标「未受控」：内建登记即出 WorkerView，且不写 .stagent/workers.json", () => {
    // 本卡的「注册」是**内建登记**（代码注册进 AdapterRegistry），不是写
    // `.stagent/workers.json`——后者是 W.7 自注册 worker 的持久层，内建项写进去
    // 会与注册表里的同 id 冲突（`E_WORKER_DUPLICATED` / 已被内建占用）。
    // 这里断言「UI 能看到、且显示未受控、且不可派工」这条链路成立。
    const repoRoot = tmpRoot();
    const service = new WorkerRegistrationService({
      repoRoot,
      registry: createDefaultWorkerRegistry(),
      now: () => NOW,
    });

    const view = service.get(CURSOR_AGENT_WORKER_ADAPTER_ID);
    expect(view.builtin).toBe(true);
    expect(view.control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(view.declared_control_mode).toBe("UNCONTROLLED_EXTERNAL");
    expect(view.dispatchable).toBe(false);
    expect(view.dispatch_blocked_reason).toContain("GATEWAY_ENFORCED");
    expect(service.list().map((item) => item.adapter_id)).toContain(
      CURSOR_AGENT_WORKER_ADAPTER_ID,
    );

    // 内建项不入自注册存储
    expect(fs.existsSync(path.join(repoRoot, ".stagent", "workers.json"))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 身份①：argv / env 白名单（CA-03 / CA-04）
// ---------------------------------------------------------------------------

describe("CA-03 argv 白名单：只拼真旗标，禁用注入面旗标", () => {
  it("包含 --print / --output-format stream-json / --mode plan / --workspace <cwd>", () => {
    const launch = launchOf();
    expect(launch.args).toContain("--print");
    expect(launch.args.slice(0, 2)).toEqual(["--print", "--output-format"]);
    expect(launch.args).toContain("stream-json");
    const modeIndex = launch.args.indexOf("--mode");
    expect(launch.args[modeIndex + 1]).toBe("plan");
    const workspaceIndex = launch.args.indexOf("--workspace");
    expect(launch.args[workspaceIndex + 1]).toBe("/tmp/worktree-w5b");
  });

  it("不含任何禁用旗标（放行 / 自动批准 / 额外工作区 / 插件 / 自建 worktree）", () => {
    const launch = launchOf();
    for (const flag of CURSOR_AGENT_FORBIDDEN_FLAGS) {
      expect(launch.args, `argv 不得含 ${flag}`).not.toContain(flag);
    }
  });

  it("API Key 绝不进 argv（走环境变量，避免 ps 泄漏）", () => {
    const launch = launchOf({ apiKey: "ck_live_should_not_appear" });
    expect(launch.args).not.toContain("--api-key");
    expect(launch.args.join(" ")).not.toContain("ck_live_should_not_appear");
    expect(launch.env["CURSOR_API_KEY"]).toBe("ck_live_should_not_appear");
  });

  it("白名单里的旗标都是真旗标：argv 用到的旗标 ⊆ 允许集合（`--` 终止符除外）", () => {
    const launch = launchOf();
    const flags = launch.args.filter(
      (arg) => arg.startsWith("-") && arg !== "--",
    );
    for (const flag of flags) {
      expect(CURSOR_AGENT_ALLOWED_FLAGS as readonly string[]).toContain(flag);
    }
  });

  it("assertNoForbiddenFlags 是独立强制点：任何入口拼错都会被拦下", () => {
    const caught = (() => {
      try {
        assertNoForbiddenFlags(["--print", "--yolo"]);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(caught).toBeInstanceOf(CursorAgentAdapterError);
    expect((caught as CursorAgentAdapterError).code).toBe(
      E_CURSOR_AGENT_FORBIDDEN_FLAG,
    );
    // `--flag=value` 形态同样要拦
    const eqForm = (() => {
      try {
        assertNoForbiddenFlags(["--mode=plan", "--force=true"]);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect((eqForm as CursorAgentAdapterError).code).toBe(
      E_CURSOR_AGENT_FORBIDDEN_FLAG,
    );

    // 终止符之后的 prompt 文本不是旗标：`--force` 出现在 prompt 里不拦
    expect(() =>
      assertNoForbiddenFlags(["--print", "--", "--force"]),
    ).not.toThrow();
  });

  it("prompt 前有 `--` 终止符：prompt 内容不会被当成旗标", () => {
    const configDir = tmpRoot();
    const instance = adapter({ configDir, mcpServerUrl: MCP_URL });

    const plain = instance.buildLaunch({ prompt: "do it", cwd: "/tmp/w" });
    expect(plain.args[plain.args.length - 1]).toBe("do it");
    expect(plain.args[plain.args.length - 2]).toBe("--");
    expect(plain.args).not.toContain("--resume");

    // 恶意 prompt：不带 `--` 时 CLI 会把 --yolo 解析成真旗标（已实测），
    // 带 `--` 之后它只是位置参数，且不应被 assertNoForbiddenFlags 误杀
    const hostile = instance.buildLaunch({ prompt: "--yolo", cwd: "/tmp/w" });
    expect(hostile.args[hostile.args.length - 1]).toBe("--yolo");
    expect(hostile.args[hostile.args.length - 2]).toBe("--");

    const resumed = instance.buildLaunch({
      prompt: "do it",
      cwd: "/tmp/w",
      nativeSessionId: "chat_123",
    });
    expect(resumed.args).toContain("--resume");
    expect(resumed.args[resumed.args.indexOf("--resume") + 1]).toBe("chat_123");
  });
});

describe("CA-04 env 白名单与凭证前置（含执行器缺位）", () => {
  it("env 键集合 ⊆ {PATH, HOME, LANG, CURSOR_API_KEY}，且 HOME 指向专用配置目录", () => {
    const configDir = tmpRoot();
    const launch = launchOf({ apiKey: "ck_x", configDir });
    const allowed = new Set(["PATH", "HOME", "LANG", "CURSOR_API_KEY"]);
    for (const key of Object.keys(launch.env)) {
      expect(allowed.has(key), `env 出现白名单外的键：${key}`).toBe(true);
    }
    expect(launch.env["HOME"]).toBe(configDir);
    expect(launch.configDir).toBe(configDir);
  });

  it("不透传 process.env 任意变量（哨兵变量不得出现）", () => {
    const sentinel = "STAGENT_W5B_SENTINEL_SHOULD_NOT_LEAK";
    const previous = process.env[sentinel];
    process.env[sentinel] = "leak-me";
    try {
      const launch = launchOf();
      expect(launch.env[sentinel]).toBeUndefined();
      expect(JSON.stringify(launch.env)).not.toContain("leak-me");
    } finally {
      if (previous === undefined) delete process.env[sentinel];
      else process.env[sentinel] = previous;
    }
  });

  it("缺 CURSOR_API_KEY → run() 先抛凭证错误（凭证检查先于执行器检查）", async () => {
    const instance = adapter({
      configDir: tmpRoot(),
      mcpServerUrl: MCP_URL,
      apiKey: () => undefined,
    });
    const error = await instance.run(DUMMY_INPUT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CursorAgentAdapterError);
    expect((error as CursorAgentAdapterError).code).toBe(
      E_CURSOR_AGENT_NO_API_KEY,
    );
    expect((error as CursorAgentAdapterError).message).toContain(
      "CURSOR_API_KEY",
    );
  });

  it("有 Key 但本卡未接执行器 → 第二档错误，不假装能跑", async () => {
    const instance = adapter({
      apiKey: () => "ck_x",
      configDir: tmpRoot(),
      mcpServerUrl: MCP_URL,
    });
    const error = await instance.run(DUMMY_INPUT).catch((e: unknown) => e);
    expect((error as CursorAgentAdapterError).code).toBe(
      E_CURSOR_AGENT_NO_EXECUTOR,
    );
  });
});

// ---------------------------------------------------------------------------
// 身份①：MCP 面（CA-05）
// ---------------------------------------------------------------------------

describe("CA-05 MCP 面：仅挂 stagent，落点是专用 HOME", () => {
  it("端点缺失构建显式仅预览契约，MCP 配置为空且不硬抛", () => {
    const previousUrl = process.env["STAGENT_MCP_URL"];
    const previousPort = process.env["STAGENT_DAEMON_PORT"];
    delete process.env["STAGENT_MCP_URL"];
    delete process.env["STAGENT_DAEMON_PORT"];
    try {
      const launch = launchOf({ mcpServerUrl: undefined });
      expect(launch.mcp_status).toBe("ENDPOINT_MISSING_PREVIEW_ONLY");
      expect(launch.degraded_reason).toContain("preview-only");
      expect(JSON.parse(fs.readFileSync(launch.mcpPath, "utf8"))).toEqual({
        mcpServers: {},
      });
    } finally {
      if (previousUrl !== undefined)
        process.env["STAGENT_MCP_URL"] = previousUrl;
      else delete process.env["STAGENT_MCP_URL"];
      if (previousPort !== undefined)
        process.env["STAGENT_DAEMON_PORT"] = previousPort;
      else delete process.env["STAGENT_DAEMON_PORT"];
    }
  });

  it("缺 URL 时可从 Daemon 端口构建受管端点", () => {
    const previousUrl = process.env["STAGENT_MCP_URL"];
    const previousPort = process.env["STAGENT_DAEMON_PORT"];
    delete process.env["STAGENT_MCP_URL"];
    process.env["STAGENT_DAEMON_PORT"] = "4312";
    try {
      const launch = launchOf({ mcpServerUrl: undefined });
      expect(launch.mcp_status).toBe("INJECTED");
      expect(JSON.parse(fs.readFileSync(launch.mcpPath, "utf8"))).toEqual({
        mcpServers: {
          stagent: { type: "http", url: "http://127.0.0.1:4312/api/mcp" },
        },
      });
    } finally {
      if (previousUrl !== undefined)
        process.env["STAGENT_MCP_URL"] = previousUrl;
      else delete process.env["STAGENT_MCP_URL"];
      if (previousPort !== undefined)
        process.env["STAGENT_DAEMON_PORT"] = previousPort;
      else delete process.env["STAGENT_DAEMON_PORT"];
    }
  });

  it("落点为 <专用 HOME>/.cursor/mcp.json（实测该文件会被 CLI 读取）", () => {
    const configDir = tmpRoot();
    const launch = launchOf({ configDir });
    expect(launch.mcpPath).toBe(path.join(configDir, ".cursor", "mcp.json"));
    expect(fs.existsSync(launch.mcpPath)).toBe(true);
    expect(launch.mcp_status).toBe("INJECTED");
  });

  it("mcp.json 内只有 stagent 一项，url 与受管端点一致，token 走 Authorization", () => {
    const configDir = tmpRoot();
    const launch = launchOf({ configDir, authToken: "tok_abc" });
    const parsed = JSON.parse(fs.readFileSync(launch.mcpPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(parsed.mcpServers)).toEqual(["stagent"]);
    const stagent = parsed.mcpServers["stagent"] as {
      type: string;
      url: string;
      headers?: { Authorization?: string };
    };
    expect(stagent.type).toBe("http");
    expect(stagent.url).toBe(MCP_URL);
    expect(stagent.headers?.Authorization).toBe("Bearer tok_abc");
  });

  it("无 token 时不写空的 headers（不伪造认证）", () => {
    const configDir = tmpRoot();
    const launch = launchOf({ configDir });
    const parsed = JSON.parse(fs.readFileSync(launch.mcpPath, "utf8")) as {
      mcpServers: Record<string, { headers?: unknown }>;
    };
    expect(parsed.mcpServers["stagent"]?.headers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 身份②：W.7 探测包对「非容器外部适配器」的负向回归（CA-07）
// ---------------------------------------------------------------------------

/**
 * 卡内「五类断言适用性表」的可执行版本。
 *
 * 表就在这里写死：**五类一个不落**（`Object.keys` 覆盖 `PROBE_IDS` 全量），
 * N/A 项必须写明理由——「不适用」不等于「跳过」。
 */
const APPLICABILITY: Record<
  ProbeId,
  {
    verdict: "applicable" | "not_applicable_by_design" | "not_executable";
    expected: ProbeStatus | "n/a";
    reason: string;
  }
> = {
  filesystem_fence: {
    verdict: "not_executable",
    expected: "n/a",
    reason:
      "观测面依赖注入执行面；唯一实现 SandboxProbeExecutionPort 经 runInSandbox() 入容器，宿主进程适配器没有容器执行面",
  },
  command_fence: {
    verdict: "not_executable",
    expected: "n/a",
    reason: "同上：与 filesystem_fence 共用同一执行面",
  },
  evidence_integrity: {
    verdict: "not_executable",
    expected: "n/a",
    reason: "同上：与 filesystem_fence 共用同一执行面",
  },
  capability_declaration: {
    verdict: "applicable",
    expected: "fail",
    reason:
      "纯函数、不依赖执行面；对 GATEWAY_ENFORCED 目标必须判 fail，出 pass 即说明声明被美化或校验被绕过",
  },
  dispatch_witness: {
    verdict: "not_applicable_by_design",
    expected: "n/a",
    reason:
      "probeDispatchWitness 对非 SANDBOX_ENFORCED 目标硬编码 not_verified + required:false；且 FenceProbeInput.target_mode 类型不含 UNCONTROLLED_EXTERNAL",
  },
};

describe("CA-07 探测包负向回归：必须拒绝这类适配器", () => {
  it("适用性表覆盖全部五类断言（不跳过计数、N/A 必写理由）", () => {
    expect(Object.keys(APPLICABILITY).sort()).toEqual([...PROBE_IDS].sort());
    for (const id of PROBE_IDS) {
      expect(APPLICABILITY[id].reason.length).toBeGreaterThan(0);
    }
  });

  it("capability_declaration：GATEWAY_ENFORCED 目标判 fail（这是对的，不是缺陷）", () => {
    const finding = probeCapabilityDeclaration(
      CURSOR_AGENT_CAPABILITY,
      "GATEWAY_ENFORCED",
    );
    expect(finding.id).toBe("capability_declaration");
    expect(finding.status).toBe(APPLICABILITY.capability_declaration.expected);
    expect(finding.status).toBe("fail");
    expect(finding.required).toBe(true);
  });

  it("dispatch_witness：GATEWAY_ENFORCED 目标下 N/A 且不计为必需项", () => {
    const finding = probeDispatchWitness("GATEWAY_ENFORCED", undefined);
    expect(finding.status).toBe("not_verified");
    expect(finding.required).toBe(false);
    // 若目标档换成 SANDBOX_ENFORCED，同一份声明会判 fail（缺见证）——说明
    // 「N/A」只对非容器档成立，不是把这项整体豁免掉
    expect(probeDispatchWitness("SANDBOX_ENFORCED", undefined).status).toBe(
      "fail",
    );
  });

  it("P1–P3 在无执行面时一律拒绝探测，不退回主树", async () => {
    await expect(
      runProbePack({
        record: recordFixture(),
        targetMode: "GATEWAY_ENFORCED",
        port: unavailablePort(),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: E_PROBE_SANDBOX_UNAVAILABLE });
  });

  it("负向基准的完整链路：该声明永远拿不到「升格可用的报告」", async () => {
    // 对 SANDBOX_ENFORCED 目标探测 → 无执行面即抛错 → 没有报告 → 没有指纹可附
    await expect(
      runProbePack({
        record: recordFixture(),
        targetMode: "SANDBOX_ENFORCED",
        port: unavailablePort(),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: E_PROBE_SANDBOX_UNAVAILABLE });
    // 对 GATEWAY_ENFORCED 目标：capability_declaration 已判 fail，升格判定必为 refused
    // （执行面仍不可用，故这里同样在首行被拒——两条路径都产不出「通过」）
    expect(
      probeCapabilityDeclaration(CURSOR_AGENT_CAPABILITY, "GATEWAY_ENFORCED")
        .status,
    ).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// 身份①：verified_on 不虚填 + 升格拒绝（CA-08）
// ---------------------------------------------------------------------------

describe("CA-08 verified_on 不虚填，升格被拒", () => {
  it("4 类绕过负例未执行 ⇒ verified_on 恒为 undefined，但实测环境有记录", () => {
    expect(CURSOR_AGENT_VERIFIED_ON).toBeUndefined();
    expect(CURSOR_AGENT_MEASUREMENT.negative_cases_executed).toBe(false);
    expect(
      CURSOR_AGENT_MEASUREMENT.negative_cases_reason.length,
    ).toBeGreaterThan(0);
    // 实测环境三要素必须齐全
    expect(CURSOR_AGENT_MEASUREMENT.cli_version).toMatch(
      /^\d{4}\.\d{2}\.\d{2}-/,
    );
    expect(CURSOR_AGENT_MEASUREMENT.platform).toBe("darwin-arm64");
    expect(CURSOR_AGENT_MEASUREMENT.measured_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("升格到 GATEWAY_ENFORCED 被严格档拒绝", () => {
    const registry = createDefaultWorkerRegistry();
    let caught: unknown;
    try {
      registry.promoteControlMode(
        CURSOR_AGENT_WORKER_ADAPTER_ID,
        "GATEWAY_ENFORCED",
        {
          report_fingerprint: "f".repeat(32),
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdapterRegistrationError);
    expect((caught as AdapterRegistrationError).rejection).toBe(
      "E_PROBE_REPORT_NOT_FOUND",
    );
  });

  it("无报告指纹的升格一律被拒（ADAPTER_PROMOTION_REFUSED）", () => {
    const registry = createDefaultWorkerRegistry();
    let caught: unknown;
    try {
      registry.promoteControlMode(
        CURSOR_AGENT_WORKER_ADAPTER_ID,
        "SANDBOX_ENFORCED",
      );
    } catch (error) {
      caught = error;
    }
    expect((caught as AdapterRegistrationError).rejection).toBe(
      "E_PROBE_REPORT_NOT_FOUND",
    );
  });

  it("自造合法形态指纹被拒绝，不会改注册表档位", () => {
    const registry = createDefaultWorkerRegistry();
    expect(() =>
      registry.promoteControlMode(
        CURSOR_AGENT_WORKER_ADAPTER_ID,
        "SANDBOX_ENFORCED",
        { report_id: "made-up", report_fingerprint: "deadbeef".repeat(4) },
      ),
    ).toThrowError(
      expect.objectContaining({ rejection: "E_PROBE_REPORT_NOT_FOUND" }),
    );
    expect(registry.get(CURSOR_AGENT_WORKER_ADAPTER_ID)?.control_mode).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
  });
});
