/**
 * TASK-W.9g P3：容器最小调用或失败留证。
 *
 * 纪律（卡 debt）：无 KEY / 无容器时**不得 skip 冒充通过**；留下失败证据并保持
 * fail-closed。有 KEY+Docker 时可走真实最小调用，但仍受
 * `CURSOR_AGENT_CONTAINER_PROTOCOL.empirically_verified` 门闩约束（常量未回填
 * 前适配器继续 NO_EXECUTOR）。可走专用 workflow（类 ca06-real）另卡触发。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  attemptCursorAgentContainerEmpiricism,
  CURSOR_AGENT_CONTAINER_PROTOCOL,
  isCursorAgentContainerProtocolProven,
} from "../../daemon/worker/sandbox/cursor-agent-container-protocol";
import {
  CursorAgentAdapter,
  CursorAgentAdapterError,
  E_CURSOR_AGENT_NO_EXECUTOR,
  CURSOR_AGENT_WORKER_ADAPTER_ID,
} from "../../daemon/worker/cli-host/cursor-agent-adapter";
import { DockerContainerHost } from "../../daemon/worker/cli-host/docker-container-host";
import { createDefaultWorkerRegistry } from "../../daemon/worker/default-worker-registry";
import type { AdapterTaskInput } from "../../daemon/worker/worker-adapter.interface";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) safeRmSync(root);
});

function worktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w9g-integ-"));
  roots.push(root);
  return root;
}

describe("W.9g Cursor container protocol integration", () => {
  it("W9G-P3: 容器最小调用或失败留证", async () => {
    const root = worktree();
    const evidencePath = path.join(root, "W9G_CONTAINER_EMPIRICISM.json");

    const apiKey = process.env["CURSOR_API_KEY"]?.trim() ?? "";
    // 真实宿主：不可用则 isAvailable()=false，attempt 必须留下 HOST_UNAVAILABLE 证据
    const host = new DockerContainerHost({
      image: CURSOR_AGENT_CONTAINER_PROTOCOL.image_ref,
      containerWorkRoot: CURSOR_AGENT_CONTAINER_PROTOCOL.container_work_root,
    });

    const result = await attemptCursorAgentContainerEmpiricism({
      host,
      apiKey: apiKey.length > 0 ? apiKey : undefined,
      worktreeRoot: root,
      prompt: "W.9g integration probe — do not claim controlled",
    });

    // 永远落盘证据（缺 KEY/缺 Docker 也不得 skip）
    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify(result.evidence, null, 2)}\n`,
      "utf8",
    );
    expect(fs.existsSync(evidencePath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as {
      empirically_verified: boolean;
      failure_code?: string;
      reused_host_ca06_verified_on: boolean;
      protocol_image_ref: string;
    };

    expect(written.reused_host_ca06_verified_on).toBe(false);
    expect(written.protocol_image_ref).toBe(
      CURSOR_AGENT_CONTAINER_PROTOCOL.image_ref,
    );
    expect(result.evidence.empirically_verified).toBe(false);
    expect(isCursorAgentContainerProtocolProven()).toBe(false);

    // 本机常见路径：无 KEY 或 Docker daemon 未起 → 明确失败码，不是 pass
    if (apiKey.length === 0) {
      expect(result.evidence.failure_code).toBe(
        "E_CURSOR_CONTAINER_NO_API_KEY",
      );
    } else if (host.isAvailable() !== true) {
      expect(result.evidence.failure_code).toBe(
        "E_CURSOR_CONTAINER_HOST_UNAVAILABLE",
      );
    } else {
      // 有 KEY + 宿主：允许 EXEC_FAILED 或 PROTOCOL_UNPROVEN（常量未翻），不得报 verified
      expect(result.empirically_verified).toBe(false);
      expect(
        [
          "E_CURSOR_CONTAINER_EXEC_FAILED",
          "E_CURSOR_CONTAINER_PROTOCOL_UNPROVEN",
        ].includes(result.evidence.failure_code ?? ""),
      ).toBe(true);
    }

    // 适配器继续 fail-closed；无派工工厂；无本地/Gateway fallback
    const adapter = new CursorAgentAdapter({
      apiKey: () => (apiKey.length > 0 ? apiKey : "ck_placeholder_for_gate"),
      configDir: path.join(root, "home"),
      mcpServerUrl: "http://127.0.0.1:9/api/mcp",
    });
    expect(adapter.has_executor).toBe(false);
    const err = await adapter
      .run({ worktree_root: root } as unknown as AdapterTaskInput)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CursorAgentAdapterError);
    expect((err as CursorAgentAdapterError).code).toBe(
      E_CURSOR_AGENT_NO_EXECUTOR,
    );

    const registry = createDefaultWorkerRegistry();
    expect(
      registry.getDispatchFactory(CURSOR_AGENT_WORKER_ADAPTER_ID),
    ).toBeUndefined();
    expect(registry.get(CURSOR_AGENT_WORKER_ADAPTER_ID)?.control_mode).not.toBe(
      "GATEWAY_ENFORCED",
    );
  });
});
