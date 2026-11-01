import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { DesignNote } from "../../src/lib/design/design-note";
import type { ScopedWorktreeGateway } from "../mcp/gateway";
import type { CostMonitor } from "../guard/cost-monitor";
import type { WorkerModelClient, WorkerRunResult } from "./ai-worker";
import {
  AdapterRegistrationError,
  type AdapterRegistry,
} from "./adapter-registry";

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
 * TASK-W.5c-i 窗口期专用错误码：`SANDBOX_ENFORCED` 可登记、但容器运行时尚未落地，
 * 派工一律显式拒绝，**不静默降级**到无网关执行、也不复用 `E_ADAPTER_NOT_CONTROLLED`
 * （后者语义是「非受控适配器」，与本档位「受控档位待解锁」不同）。
 *
 * 解锁条件：`W.5c-ii` `container-host` 落地（届时改为按容器宿主可用性校验放行）。
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
}

/** 受控执行器：签名与既有 `AiWorker.run(signal)` 一致 */
export interface DispatchedWorker {
  run(signal?: AbortSignal): Promise<WorkerRunResult>;
}

/** 派工工厂：注册进 Registry，运行时产出受控执行器 */
export type WorkerDispatchFactory = (
  context: WorkerDispatchContext,
) => DispatchedWorker;

/**
 * TASK-W.5c-i 窗口期档位窄化：把合同 / 适配器档位降为运行时二值档位。
 *
 * `SANDBOX_ENFORCED` 在 `W.5c-ii` `container-host` 落地前**不视为受控**——写入
 * Evidence、装配运行时拦截器时一律按 `UNCONTROLLED_EXTERNAL` 处理，杜绝
 * 「标了沙箱档却没有沙箱」的假受控证据；派工面另由 `requireControlledDispatch()`
 * 以 `E_ADAPTER_SANDBOX_LOCKED` 显式拒绝。本函数只收窄，不扩张可执行面。
 *
 * 解锁条件：`W.5c-ii` `container-host` 落地（届时改为按容器宿主可用性判定）。
 */
export function toRuntimeControlMode(
  mode: "GATEWAY_ENFORCED" | "SANDBOX_ENFORCED" | "UNCONTROLLED_EXTERNAL",
): "GATEWAY_ENFORCED" | "UNCONTROLLED_EXTERNAL" {
  return mode === "GATEWAY_ENFORCED"
    ? "GATEWAY_ENFORCED"
    : "UNCONTROLLED_EXTERNAL";
}

/**
 * 单一判定源：解析受控派工工厂。
 *
 * 0. TASK-W.5c-i 窗口期：已登记为 `SANDBOX_ENFORCED` → `E_ADAPTER_SANDBOX_LOCKED`
 *    （登记面接受注册，但容器运行时待 `W.5c-ii` `container-host` 落地解锁）；
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
): WorkerDispatchFactory {
  // TASK-W.5c-i 窗口期门禁（先于既有受控判定）：`SANDBOX_ENFORCED` 是「受控档位但
  // 容器运行时尚未落地」，登记面已接受注册，但派工必须显式拒绝 —— 绝不允许
  // 「标了沙箱档却没有沙箱」的假受控执行，也不静默降级到无网关执行。
  // 解锁条件：W.5c-ii `container-host` 落地（见 E_ADAPTER_SANDBOX_LOCKED 注释）。
  const sandboxEntry = registry.get(adapterId);
  if (sandboxEntry?.control_mode === "SANDBOX_ENFORCED") {
    throw new WorkerDispatchError(
      E_ADAPTER_SANDBOX_LOCKED,
      adapterId,
      "适配器登记为 SANDBOX_ENFORCED（容器隔离档位），但容器运行时 container-host 尚未落地；待 W.5c-ii container-host 落地解锁后方可派工，窗口期内拒绝派工以免假受控",
    );
  }

  try {
    // 门禁：复用 Registry 的既有判定，不复制一份语义
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
