import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  approveContract,
  type DaemonConnection,
} from "../../src/lib/daemon-api";

const conn: DaemonConnection = {
  baseUrl: "http://127.0.0.1:3001",
  token: "test-token",
};

describe("TASK-J.24 缺口 1：approveContract 透传 acknowledge_dirty", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("T-J24-ACK-001 未显式指定 acknowledgeDirty 时，POST 请求体绝不携带 acknowledge_dirty", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          contract: {
            contract_id: "c-1",
            lifecycle_state: "APPROVED",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await approveContract(conn, "c-1", "alice");
    expect(capturedBody).toEqual({ reviewer: "alice" });
    expect(
      capturedBody && Object.hasOwn(capturedBody, "acknowledge_dirty"),
    ).toBe(false);
  });

  it("T-J24-ACK-002 acknowledgeDirty 为 false 时，POST 请求体不携带 acknowledge_dirty", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          contract: {
            contract_id: "c-1",
            lifecycle_state: "APPROVED",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await approveContract(conn, "c-1", "alice", { acknowledgeDirty: false });
    expect(capturedBody).toEqual({ reviewer: "alice" });
    expect(
      capturedBody && Object.hasOwn(capturedBody, "acknowledge_dirty"),
    ).toBe(false);
  });

  it("T-J24-ACK-003 用户显式确认后，传递 acknowledgeDirty: true，请求体携带 acknowledge_dirty: true", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          contract: {
            contract_id: "c-1",
            lifecycle_state: "APPROVED",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await approveContract(conn, "c-1", "alice", {
      confirmationId: "conf-123",
      acknowledgeDirty: true,
    });
    expect(capturedBody).toEqual({
      reviewer: "alice",
      confirmation_id: "conf-123",
      acknowledge_dirty: true,
    });
  });
});
