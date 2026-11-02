import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { DesignNote } from "../../src/lib/design/design-note";
import type { ScopedWorktreeGateway } from "../mcp/gateway";
import type { CostMonitor } from "../guard/cost-monitor";
import type { WorkerModelClient, WorkerRunResult } from "./ai-worker";
import {
  AdapterRegistrationError,
  type AdapterRegistry,
} from "./adapter-registry";
import type { ContainerHostPort } from "./sandbox/container-host";

/**
 * TASK-W.6：受控 Worker 派工契约。
 *
 * 为什么需要这一层：
 * - `CodingWorkerAdapter.run(AdapterTaskInput)` 是「能力契约」，返回纯生成产物；
 *   它不承载 Gateway 写入 / 越界拦截 / 预算熔断 / BLOCKED 证据等执行语义。
 * - 编排器的派工必须保留上述语义（红线：不得绕过 Gateway 直改主树）。
 * 因此 Registry 在「注册适配器」之上再挂一个**派工工厂**：工厂拿到编排器
 * 已构造好的 Gateway / CostMonitor / modelClient，产出一个 `run(signal)` 执行器。
 * 编排器只依赖这里的抽象类型，不 import 任何具体适配器类（OCP）。
 *
 * 门禁前置：`requireControlledDispatch()` 先经 `registry.requireControlled(adapterId)`
 * 做「已注册 + GATEWAY_ENFORCED」校验，再把未注册 / 非受控映射为带 `code` 的
 * `WorkerDispatchError`，确保错误码能透出 HTTP（`.rejection` 字段不会）。
 */

/** 明确错误码：缺注册 / 非受控 / 已注册但未挂派工工厂，均不得静默降级 */
export const E_ADAPTER_NOT_REGISTERED = "E_ADAPTER_NOT_REGISTERED" as const;
export const E_ADAPTER_NOT_CONTROLLED = "E_ADAPTER_NOT_CONTROLLED" as const;
export const E_ADAPTER_NO_DISPATCH_FACTORY = "E_ADAPTER_NO_DISPATCH_FACTORY" as const;
/**
 * `SANDBOX_ENFORCED` 档位不可用时的错误码，**不静默降级**到无网关执行、也不复用
 * `E_ADAPTER_NOT_CONTROLLED`（后者语义是「非受控适配器」，与本档位「受控档位但
 * 容器宿主不可用」不同）。
 *
 * 语义（TASK-W.5c-ii 起）：派工是否放行**按容器宿主可用性判定**——
 * 未注入 `ContainerHostPort`、或宿主 `isAvailable()` 为 false → 本码拒绝；
 * 宿主可用 → 正常放行（窗口期「永远拒绝」的语义已随本卡解除）。
 */
export const E_ADAPTER_SANDBOX_LOCKED = "E_ADAPTER_SANDBOX_LOCKED" as const;

export type WorkerDispatchErrorCode =
  | typeof E_ADAPTER_NOT_REGISTERED
  | typeof E_ADAPTER_NOT_CONTROLLED
  | typeof E_ADAPTER_NO_DISPATCH_FACTORY
  | typeof E_ADAPTER_SANDBOX_LOCKED;

/** 带 `code` 字段，供 `sendActionError` 透出；不静默降级到无网关执行 */
export class WorkerDispatchError extends Error {
  readonly code: WorkerDispatchErrorCode;
  readonly adapter_id: string;

  constructor(
    code: WorkerDispatchErrorCode,
    adapterId: string,
    message: string,
  ) {
    super(`[${code}] adapter '${adapterId}': ${message}`);
    this.name = "WorkerDispatchError";
    this.code = code;
    this.adapter_id = adapterId;
  }
}

/**
 * 派工上下文：由编排器在 `buildRuntime()` 之后装配。
 * 全部句柄由编排器提供，适配器工厂不得自行构造 Gateway 或绕过写范围。
 */
export interface WorkerDispatchContext {
  contract: SoftwareContract;
  gateway: ScopedWorktreeGateway;
  costMonitor: CostMonitor;
  modelClient: WorkerModelClient;
  repoRoot: string;
  /** TASK-L.11：已校验的设计说明 */
  designNote?: DesignNote | undefined;
  /** TASK-L.4：两段式本段义务清单（注入「你会被这样检查」） */
  checksExtras?: readonly string[] | undefined;
  /** TASK-W.5c-ii：容器宿主端口（`SANDBOX_ENFORCED` 执行时取用；未注入则门禁已拒） */
  containerHost?: ContainerHostPort | undefined;
}

/** 受控执行器：签名与既有 `AiWorker.run(signal)` 一致 */
export interface DispatchedWorker {
  run(signal?: AbortSignal): Promise<WorkerRunResult>;
}

/** 派工工厂：注册进 Registry，运行时产出受控执行器 */
export type WorkerDispatchFactory = (
  context: WorkerDispatchContext,
) => DispatchedWorker;

/** `SANDBOX_ENFORCED` 派工的宿主注入选项（W.5c-ii 起） */
export interface ControlledDispatchOptions {
  /**
   * 容器宿主端口。**未注入**时 `SANDBOX_ENFORCED` 一律拒绝派工
   * （`E_ADAPTER_SANDBOX_LOCKED`），不静默降级到无网关执行。
   */
  containerHost?: ContainerHostPort | undefined;
}

/**
 * 单一判定源：解析受控派工工厂。
 *
 * 0. TASK-W.5c-ii：`SANDBOX_ENFORCED` **按容器宿主可用性判定**——
 *    未注入 `ContainerHostPort` 或 `isAvailable()` 为 false → `E_ADAPTER_SANDBOX_LOCKED`；
 *    宿主可用 → 放行并继续工厂校验（窗口期「永远拒绝」语义已解除）。
 * 1. 再调 `registry.requireControlled(adapterId)` —— 未注册 → `ADAPTER_ID_INVALID`、
 *    非 GATEWAY_ENFORCED（含 `UNCONTROLLED_EXTERNAL`）→ `TOOL_INTERCEPTION_UNSUPPORTED`；
 * 2. 把 `AdapterRegistrationError.rejection` 映射为带 `code` 的 `WorkerDispatchError`；
 * 3. 已注册但未挂工厂 → `E_ADAPTER_NO_DISPATCH_FACTORY`。
 *
 * 任何分支都不返回「裸执行」兜底——红线要求缺注册/非受控必须显式失败。
 */
export function requireControlledDispatch(
  registry: AdapterRegistry,
  adapterId: string,
  options?: ControlledDispatchOptions,
): WorkerDispatchFactory {
  const entry = registry.get(adapterId);
  if (entry === undefined) {
    throw new WorkerDispatchError(
      E_ADAPTER_NOT_REGISTERED,
      adapterId,
      `adapter not registered: ${adapterId}`,
    );
  }

  if (entry.control_mode === "UNCONTROLLED_EXTERNAL") {
    // 非受控档位：不得作为受控 / 可合并证据，门禁先拒（与 W.6 语义一致）
    throw new WorkerDispatchError(
      E_ADAPTER_NOT_CONTROLLED,
      adapterId,
      `adapter ${adapterId} is registered as UNCONTROLLED_EXTERNAL; it cannot be used for controlled execution`,
    );
  }

  if (entry.control_mode === "SANDBOX_ENFORCED") {
    // TASK-W.5c-ii：按容器宿主可用性判定放行与否（不再是窗口期「永远拒绝」）。
    const host = options?.containerHost;
    if (host === undefined) {
      throw new WorkerDispatchError(
        E_ADAPTER_SANDBOX_LOCKED,
        adapterId,
        "适配器登记为 SANDBOX_ENFORCED（容器隔离档位），但未注入容器宿主 ContainerHostPort；拒绝派工，不静默降级到无网关执行",
      );
    }
    if (host.isAvailable() !== true) {
      throw new WorkerDispatchError(
        E_ADAPTER_SANDBOX_LOCKED,
        adapterId,
        "适配器登记为 SANDBOX_ENFORCED（容器隔离档位），但容器宿主不可用（isAvailable() 为 false）；拒绝派工，不静默降级到无网关执行",
      );
    }
    // 宿主可用 → 门禁自足（`registry.requireControlled()` 只放行 `GATEWAY_ENFORCED`，
    // 沙箱档不得再过它，否则会被误判为「非受控」）。
  } else {
    try {
      // `GATEWAY_ENFORCED` 复用 Registry 的既有判定，不复制一份语义
      registry.requireControlled(adapterId);
    } catch (err) {
      if (err instanceof AdapterRegistrationError) {
        const code =
          err.rejection === "ADAPTER_ID_INVALID"
            ? E_ADAPTER_NOT_REGISTERED
            : E_ADAPTER_NOT_CONTROLLED;
        throw new WorkerDispatchError(code, adapterId, err.message);
      }
      throw err;
    }
  }

  const factory = registry.getDispatchFactory(adapterId);
  if (factory === undefined) {
    throw new WorkerDispatchError(
      E_ADAPTER_NO_DISPATCH_FACTORY,
      adapterId,
      "已注册为受控适配器，但未挂接派工工厂（dispatchFactory）；拒绝派工以免绕过 Gateway",
    );
  }
  return factory;
}
