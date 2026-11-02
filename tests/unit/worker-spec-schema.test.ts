/**
 * TASK-W.5c-i：`SANDBOX_ENFORCED` 双枚举 + `workerSpecSchema` 目标字段验收。
 *
 * 覆盖（卡正文 PASS SE-01～SE-04）：
 * SE-01：两处枚举（contract.schema.ts / worker-adapter.interface.ts）均含
 *        `SANDBOX_ENFORCED`；只改一处的夹具 → 断言失败（漏改即 FAIL）。
 * SE-02：`workerSpecSchema` 接受 `billing_model` / `verified_on`，缺省不写时解析
 *        通过；`DEFAULT_WORKER_SPEC` 仍为 `GATEWAY_ENFORCED`。
 * SE-03：`SANDBOX_ENFORCED` 注册成功（登记面接受），但 `requireControlledDispatch()`
 *        抛带 `code` 的 `WorkerDispatchError`、消息含「待 W.5c-ii 解锁」语义；
 *        `GATEWAY_ENFORCED` 派工正例仍通过（不回归）。
 * SE-04：五键锁定断言同步更新后仍通过（既有四必需键语义不变）。
 *
 * 纪律：本卡不实现容器运行时，不宣称端到端闭环。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKER_SPEC,
  workerControlModeSchema,
  workerSpecSchema,
} from "../../src/lib/contract.schema";
import { AdapterRegistry } from "../../daemon/worker/adapter-registry";
import {
  MANAGED_AI_CAPABILITY,
  type AdapterTaskInput,
  type CodingWorkerAdapter,
} from "../../daemon/worker/worker-adapter.interface";
import {
  E_ADAPTER_SANDBOX_LOCKED,
  WorkerDispatchError,
  requireControlledDispatch,
  type WorkerDispatchFactory,
} from "../../daemon/worker/worker-dispatch";

const SANDBOX_ID = "test.sandbox-enforced.v0";
const GATEWAY_ID = "test.gateway-enforced.v0";

/** 能力声明克隆内置声明并改 id，保证能过受控严格校验（SANDBOX_ENFORCED 同） */
function fakeAdapter(adapterId: string): CodingWorkerAdapter {
  return {
    declaration: { ...MANAGED_AI_CAPABILITY, adapter_id: adapterId },
    kind: "MANAGED_AI",
    run: async (_input: AdapterTaskInput) => ({
      changes: [],
      log: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  };
}

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

describe("SE-01：双枚举 SANDBOX_ENFORCED 必须同改（漏改单边即 FAIL）", () => {
  it("contract.schema.ts 的 workerControlModeSchema 含三值（含 SANDBOX_ENFORCED）", () => {
    expect(workerControlModeSchema.options).toEqual([
      "GATEWAY_ENFORCED",
      "SANDBOX_ENFORCED",
      "UNCONTROLLED_EXTERNAL",
    ]);
  });

  it("daemon 侧 AdapterControlMode 类型定义同样含 SANDBOX_ENFORCED", () => {
    const source = readSource(
      "daemon",
      "worker",
      "worker-adapter.interface.ts",
    );
    // 只改 contract.schema.ts 单边 → 本断言失败（源码层不留情面）
    expect(source).toMatch(
      /export type AdapterControlMode\s*=\s*\|?\s*"GATEWAY_ENFORCED"\s*\|?\s*"SANDBOX_ENFORCED"/,
    );
    expect(source).toContain('"UNCONTROLLED_EXTERNAL"');
  });

  it("schema 源码内 workerControlModeSchema 亦含 SANDBOX_ENFORCED（防单边回退）", () => {
    const source = readSource("src", "lib", "contract.schema.ts");
    expect(source).toMatch(
      /workerControlModeSchema = z\.enum\(\[[^\]]*"SANDBOX_ENFORCED"[^\]]*\]\)/s,
    );
  });
});

describe("SE-02：workerSpecSchema 目标字段（可选，缺省不写）", () => {
  it("接受 billing_model / verified_on 且缺省时解析通过", () => {
    const base = { ...DEFAULT_WORKER_SPEC };
    const withTargets = workerSpecSchema.safeParse({
      ...base,
      billing_model: "PER_TOKEN",
      verified_on: { cli_version: "0.1.0", verified_at: "2026-11-02" },
    });
    expect(withTargets.success).toBe(true);
    expect(workerSpecSchema.safeParse(base).success).toBe(true);
  });

  it("billing_model 取值受限，verified_on 缺字段被拒", () => {
    const base = { ...DEFAULT_WORKER_SPEC };
    expect(
      workerSpecSchema.safeParse({ ...base, billing_model: "FREE" }).success,
    ).toBe(false);
    expect(
      workerSpecSchema.safeParse({
        ...base,
        verified_on: { cli_version: "0.1.0" },
      }).success,
    ).toBe(false);
  });

  it("合同可合法书写 control_mode = SANDBOX_ENFORCED", () => {
    const parsed = workerSpecSchema.safeParse({
      ...DEFAULT_WORKER_SPEC,
      control_mode: "SANDBOX_ENFORCED",
    });
    expect(parsed.success).toBe(true);
  });

  it("DEFAULT_WORKER_SPEC 仍为 GATEWAY_ENFORCED（不得被改成 SANDBOX_ENFORCED）", () => {
    expect(DEFAULT_WORKER_SPEC.control_mode).toBe("GATEWAY_ENFORCED");
  });
});

describe("SE-03：注册接受、未注入宿主时派工显式拒绝（W.5c-ii 起按宿主可用性判定）", () => {
  it("SANDBOX_ENFORCED 适配器注册成功（登记面接受）", () => {
    const registry = new AdapterRegistry();
    const entry = registry.register(fakeAdapter(SANDBOX_ID), "SANDBOX_ENFORCED");
    expect(entry.control_mode).toBe("SANDBOX_ENFORCED");
    expect(registry.has(SANDBOX_ID)).toBe(true);
  });

  it("requireControlledDispatch 对其抛带 code 的 WorkerDispatchError", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter(SANDBOX_ID), "SANDBOX_ENFORCED");
    // 即便挂了派工工厂，窗口期也必须拒绝（防假受控）
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
    const dispatchErr = err as WorkerDispatchError;
    expect(dispatchErr.code).toBe(E_ADAPTER_SANDBOX_LOCKED);
    expect(dispatchErr.adapter_id).toBe(SANDBOX_ID);
    // W.5c-ii 起：未注入容器宿主 → 拒绝（语义由「窗口期永远拒绝」改为宿主可用性判定）
    expect(dispatchErr.message).toContain("ContainerHostPort");
    // 不得复用既有「非受控」错误码
    expect(dispatchErr.code).not.toBe("E_ADAPTER_NOT_CONTROLLED");
  });

  it("GATEWAY_ENFORCED 派工正例仍通过（不回归）", () => {
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

describe("SE-05：档位如实记三值（W.5c-ii 解锁后，窗口期收窄已解除）", () => {
  it("SANDBOX_ENFORCED 记入证据时如实记为该档位（不再收窄为 UNCONTROLLED_EXTERNAL）", () => {
    // 收窄会让「受控派工成功」产出「不可合并证据」，解锁后如实记档。
    expect(workerControlModeSchema.options).toContain("SANDBOX_ENFORCED");
    expect(workerControlModeSchema.safeParse("SANDBOX_ENFORCED").success).toBe(
      true,
    );
    expect(
      workerControlModeSchema.safeParse("UNCONTROLLED_EXTERNAL").success,
    ).toBe(true);
    expect(workerControlModeSchema.safeParse("GATEWAY_ENFORCED").success).toBe(
      true,
    );
  });

  it("证据 schema 的 worker_control_mode 同步为三值（源码断言）", () => {
    const source = readSource("src", "lib", "evidence.schema.ts");
    expect(source).toMatch(
      /worker_control_mode:[\s\S]{0,200}?"SANDBOX_ENFORCED"/,
    );
  });
});

describe("SE-04：五键锁定断言更新后既有语义不变", () => {
  it("Schema 形状含两新增可选键，实例四必需键不变", () => {
    expect(Object.keys(workerSpecSchema.shape).sort()).toEqual(
      [
        "adapter_id",
        "adapter_version",
        "billing_model",
        "control_mode",
        "model_id",
        "runtime_kind",
        "verified_on",
      ].sort(),
    );
    // 实例键集合不受新增可选键影响（缺省不写）
    expect(Object.keys(DEFAULT_WORKER_SPEC).sort()).toEqual(
      ["adapter_id", "adapter_version", "control_mode", "runtime_kind"].sort(),
    );
  });

  it("既有必填约束不变：缺 adapter_id / adapter_version 仍被拒", () => {
    const base = { ...DEFAULT_WORKER_SPEC };
    expect(
      workerSpecSchema.safeParse({ ...base, adapter_id: "" }).success,
    ).toBe(false);
    expect(
      workerSpecSchema.safeParse({ ...base, adapter_version: "" }).success,
    ).toBe(false);
  });
});
