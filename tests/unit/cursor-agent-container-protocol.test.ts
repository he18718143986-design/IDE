/**
 * TASK-W.9g：Cursor 容器协议钉死 + 未实证 fail-closed（W9G-P1/P2/P4）。
 *
 * 不要求本机 Docker / CURSOR_API_KEY。真实最小容器调用或失败留证见
 * `tests/integration/cursor-agent-container-protocol.test.ts`（W9G-P3）。
 */
import { describe, expect, it } from "vitest";
import {
  CURSOR_AGENT_CONTAINER_ARGV_TEMPLATE,
  CURSOR_AGENT_CONTAINER_IMAGE_DIGEST,
  CURSOR_AGENT_CONTAINER_IMAGE_TAG,
  CURSOR_AGENT_CONTAINER_PROTOCOL,
  CURSOR_AGENT_CONTAINER_WORK_ROOT,
  buildCursorAgentContainerArgv,
  cursorAgentContainerEvidenceMode,
  isCursorAgentContainerProtocolProven,
} from "../../daemon/worker/sandbox/cursor-agent-container-protocol";
import {
  CURSOR_AGENT_CAPABILITY,
  CURSOR_AGENT_FORBIDDEN_FLAGS,
  CURSOR_AGENT_VERIFIED_ON,
  CURSOR_AGENT_WORKER_ADAPTER_ID,
  CursorAgentAdapter,
  CursorAgentAdapterError,
  E_CURSOR_AGENT_NO_EXECUTOR,
} from "../../daemon/worker/cli-host/cursor-agent-adapter";
import { createDefaultWorkerRegistry } from "../../daemon/worker/default-worker-registry";
import {
  resolveEvidenceControlMode,
  validateAdapterCapability,
} from "../../daemon/worker/worker-adapter.interface";
import {
  requireControlledDispatch,
  WorkerDispatchError,
} from "../../daemon/worker/worker-dispatch";
import type { AdapterTaskInput } from "../../daemon/worker/worker-adapter.interface";

/** run() 入参不被读取；占位即可 */
const DUMMY_INPUT = {} as unknown as AdapterTaskInput;

describe("W.9g Cursor container protocol", () => {
  it("W9G-P1: 镜像引用钉死", () => {
    // digest 或等价不可漂标签
    expect(CURSOR_AGENT_CONTAINER_IMAGE_DIGEST).toMatch(
      /^docker\/sandbox-templates@sha256:[a-f0-9]{64}$/,
    );
    expect(CURSOR_AGENT_CONTAINER_IMAGE_TAG).toBe(
      "docker/sandbox-templates:cursor-agent-2026.10.01-e373342-docker",
    );
    expect(CURSOR_AGENT_CONTAINER_IMAGE_TAG.includes(":latest")).toBe(false);
    expect(CURSOR_AGENT_CONTAINER_PROTOCOL.image_ref).toBe(
      CURSOR_AGENT_CONTAINER_IMAGE_DIGEST,
    );
    expect(CURSOR_AGENT_CONTAINER_PROTOCOL.image_tag_ref).toBe(
      CURSOR_AGENT_CONTAINER_IMAGE_TAG,
    );

    // 最小 argv / cwd / 挂载协议文档化在常量
    expect(CURSOR_AGENT_CONTAINER_PROTOCOL.cwd).toBe(
      CURSOR_AGENT_CONTAINER_WORK_ROOT,
    );
    expect(CURSOR_AGENT_CONTAINER_PROTOCOL.container_work_root).toBe("/work");
    expect(CURSOR_AGENT_CONTAINER_PROTOCOL.mounts).toEqual([
      { source: "<worktreeRoot>", target: "/work", readonly: false },
    ]);
    expect([...CURSOR_AGENT_CONTAINER_ARGV_TEMPLATE]).toEqual([
      "cursor-agent",
      "--print",
      "--output-format",
      "stream-json",
      "--mode",
      "plan",
      "--workspace",
      "/work",
      "--",
      "<prompt>",
    ]);
    const argv = buildCursorAgentContainerArgv("hello");
    expect(argv.at(-1)).toBe("hello");
    expect(argv).toContain("--");
    for (const flag of CURSOR_AGENT_FORBIDDEN_FLAGS) {
      expect(argv.includes(flag)).toBe(false);
    }
    // 协议明确切断与宿主 CA-06 的等价
    expect(
      CURSOR_AGENT_CONTAINER_PROTOCOL.host_ca06_verified_on_is_not_protocol_proof,
    ).toBe(true);
  });

  it("W9G-P2: 未实证 NO_EXECUTOR", async () => {
    expect(CURSOR_AGENT_CONTAINER_PROTOCOL.empirically_verified).toBe(false);
    expect(isCursorAgentContainerProtocolProven()).toBe(false);

    const adapter = new CursorAgentAdapter({
      apiKey: () => "ck_w9g_not_enough_alone",
      configDir: "/tmp/w9g-cursor-config-unused",
      mcpServerUrl: "http://127.0.0.1:9/api/mcp",
    });
    expect(adapter.has_executor).toBe(false);

    const error = await adapter.run(DUMMY_INPUT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CursorAgentAdapterError);
    expect((error as CursorAgentAdapterError).code).toBe(
      E_CURSOR_AGENT_NO_EXECUTOR,
    );
    expect((error as CursorAgentAdapterError).message).toContain("W.9g");
    expect((error as CursorAgentAdapterError).message).toContain(
      "CURSOR_AGENT_VERIFIED_ON",
    );

    // 不得挂派工工厂冒充可派工
    const registry = createDefaultWorkerRegistry();
    expect(
      registry.getDispatchFactory(CURSOR_AGENT_WORKER_ADAPTER_ID),
    ).toBeUndefined();
    expect(registry.get(CURSOR_AGENT_WORKER_ADAPTER_ID)?.control_mode).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
    let caught: unknown;
    try {
      requireControlledDispatch(registry, CURSOR_AGENT_WORKER_ADAPTER_ID);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WorkerDispatchError);

    // 宿主 CA-06 verified_on 存在也不得把协议标成已实证
    expect(CURSOR_AGENT_VERIFIED_ON).toBeDefined();
    expect(isCursorAgentContainerProtocolProven()).toBe(false);
  });

  it("W9G-P4: 不升 GATEWAY_ENFORCED", () => {
    // 结构性：无 tool interception → 严格档必拒
    expect(CURSOR_AGENT_CAPABILITY.tool_interception_supported).toBe(false);
    expect(
      validateAdapterCapability(CURSOR_AGENT_CAPABILITY, "GATEWAY_ENFORCED").ok,
    ).toBe(false);

    const registry = createDefaultWorkerRegistry();
    expect(registry.get(CURSOR_AGENT_WORKER_ADAPTER_ID)?.control_mode).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
    expect(registry.get(CURSOR_AGENT_WORKER_ADAPTER_ID)?.control_mode).not.toBe(
      "GATEWAY_ENFORCED",
    );

    // 证据面：无 SandboxWitness 不得记 SANDBOX_ENFORCED；更不得升 Gateway
    expect(resolveEvidenceControlMode("SANDBOX_ENFORCED", undefined)).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
    expect(cursorAgentContainerEvidenceMode(undefined)).toBe(
      "UNCONTROLLED_EXTERNAL",
    );
    expect(resolveEvidenceControlMode("GATEWAY_ENFORCED", undefined)).toBe(
      "GATEWAY_ENFORCED",
    );
    // 本卡协议未实证 → 不得借宿主 verified_on 改档
    expect(CURSOR_AGENT_CONTAINER_PROTOCOL.empirically_verified).toBe(false);
    expect(
      CURSOR_AGENT_CONTAINER_PROTOCOL.host_ca06_verified_on_is_not_protocol_proof,
    ).toBe(true);
  });
});
