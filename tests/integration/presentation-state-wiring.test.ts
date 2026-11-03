import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import type { StateChangedPayload } from "../../src/lib/ipc/frames";
import { initRepo } from "../helpers/e2e-repo";

/**
 * TASK-D.3（续）：Daemon 侧接线的端到端证据。
 *
 * 三条链路各自独立可证：
 * 1. `emitContractUpdate` → `.stagent/state.json` 落盘；
 * 2. `GET /api/state` 能读回同一份快照（首帧前的还原通道）；
 * 3. WS 重连后，AUTH_OK 之后立即回放 `STATE_CHANGED`（断线还原通道）。
 */

let repo: string;
let daemon: StagentDaemon | null = null;

function contractDraft(): SoftwareContract {
  const draft = createContractDraft({
    title: "持久化接线",
    description: "D.3 wiring",
    acceptanceCriteria: ["能读回展示态"],
    writablePaths: ["src/lib/example.ts"],
  });
  return softwareContractSchema.parse(draft);
}

function getJson(
  port: number,
  pathname: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "GET",
        headers: { authorization: `Bearer ${token}`, connection: "close" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * 连接 → AUTH → 收集回放帧。
 *
 * 这里是「等待预算」而不是延迟断言：全量 8 fork 并发时进程会被整段饿死，
 * 收紧预算会把「帧晚到」误判成「没回放」。断言只看内容，不看到达时刻。
 * 预算给到 5s 只用于兜底（连 AUTH_OK 都没到的情况）；正常路径靠
 * AUTH_OK 之后的一小段宽限收工，不让用例白等。
 */
const REPLAY_GRACE_MS = 500;

function connectAndCollect(
  port: number,
  token: string,
  timeoutMs = 5_000,
): Promise<{ authOk: boolean; states: StateChangedPayload[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const states: StateChangedPayload[] = [];
    let authOk = false;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ authOk, states });
    };

    const timer = setTimeout(finish, timeoutMs);
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          trace_id: "t1",
          type: "AUTH",
          timestamp: new Date().toISOString(),
          payload: { token },
        }),
      );
    });
    ws.on("message", (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString()) as {
        type: string;
        payload?: StateChangedPayload;
      };
      if (frame.type === "AUTH_OK") {
        authOk = true;
        // 服务端发完 AUTH_OK 紧接着回放，给一小段宽限后收工
        graceTimer = setTimeout(finish, REPLAY_GRACE_MS);
      }
      if (frame.type === "STATE_CHANGED" && frame.payload) {
        states.push(frame.payload);
      }
    });
    ws.on("error", reject);
    // 连接被服务端关掉就别再空等预算：立刻交回已收到的帧，让断言直接说出
    // 「没拿到 AUTH_OK」，而不是 5s 后报一个含糊的超时。
    ws.on("close", finish);
  });
}

beforeEach(async () => {
  repo = initRepo("stagent-d3-wiring-");
  daemon = createDaemon({
    repoRoot: repo,
    // 端口段：与其余套件不重叠，登记表见 tests/unit/test-port-map.test.ts
    startPort: 4489,
    endPort: 4498,
    enableCrashRecovery: false,
  });
  await daemon.start();
});

afterEach(async () => {
  if (daemon?.isRunning) await daemon.stop();
  daemon = null;
  try {
    safeRmSync(repo);
  } catch {
    /* 受限环境可能拦截删除 */
  }
});

describe("展示态接线：落盘 / 读取 / 回放", () => {
  it("emitContractUpdate 后写入 state.json，并可经 GET /api/state 读回", async () => {
    const contract = contractDraft();
    daemon!.emitContractUpdate(contract);

    const port = daemon!.port!;
    const token = daemon!.getSessionToken()!;
    const res = await getJson(port, "/api/state", token);

    expect(res.status).toBe(200);
    const contracts = res.body["contracts"] as Record<string, unknown>;
    const record = contracts[contract.contract_id] as Record<string, unknown>;

    expect(record).toBeDefined();
    expect(record["presentation_state"]).toBe("EXPLORING");
    expect(record["lifecycle_state"]).toBe("DRAFT");
    expect(String(record["message"])).toContain("确认需求");

    // 同一份事实也落在磁盘上，而不是只活在内存里
    const onDisk = JSON.parse(
      fs.readFileSync(`${repo}/.stagent/state.json`, "utf8"),
    ) as { contracts: Record<string, unknown> };
    expect(onDisk.contracts[contract.contract_id]).toBeDefined();
  });

  it("AUDITED 缺证据信号时不广播也不落盘（不猜状态）", async () => {
    const draft = contractDraft();
    const audited = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "AUDITED",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: "2026-10-23T09:00:00.000Z",
        approved_revision: 1,
      },
    });

    daemon!.emitContractUpdate(audited);

    const res = await getJson(
      daemon!.port!,
      "/api/state",
      daemon!.getSessionToken()!,
    );
    const contracts = res.body["contracts"] as Record<string, unknown>;
    expect(contracts[audited.contract_id]).toBeUndefined();
  });

  it("WS 重连：AUTH_OK 之后立即回放持久化的 STATE_CHANGED", async () => {
    const contract = contractDraft();
    daemon!.emitContractUpdate(contract);

    const { authOk, states } = await connectAndCollect(
      daemon!.port!,
      daemon!.getSessionToken()!,
    );

    expect(authOk).toBe(true);
    const replayed = states.find(
      (item) => item.contract_id === contract.contract_id,
    );
    expect(replayed).toBeDefined();
    expect(replayed?.presentation_state).toBe("EXPLORING");
    expect(replayed?.persisted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // TASK-J.8 / J-01：STATE_CHANGED 帧携带 Daemon 投影的幕次
    expect(replayed?.journey_stage).toBe("scheme");
    expect(replayed?.journey_substate).toBe("plan_chatting");
    expect(replayed?.journey_archived).toBe(false);
  });
});
