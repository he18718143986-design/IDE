import {
  validateAdapterCapability,
  type AdapterCapabilityDeclaration,
  type AdapterControlMode,
  type AdapterRejectionCode,
  type CodingWorkerAdapter,
} from "./worker-adapter.interface";
import type { WorkerDispatchFactory } from "./worker-dispatch";

/**
 * 适配器注册中心（TASK-W.1 目标 4 / B PASS 判据）。
 *
 * 默认拒绝：未声明能力、声明直连文件系统 / 无限制 Shell、或无法拦截工具调用的
 * 适配器，**不能**以 `GATEWAY_ENFORCED` 注册；只允许登记为
 * `UNCONTROLLED_EXTERNAL`（用户自管，产物不得作为受控执行证据）。
 *
 * 注册中心不持有执行能力，也不调用适配器。
 *
 * TASK-W.6：新增「派工工厂」登记。工厂由编排器在受控派工时取用，产出
 * 持有 Gateway 的执行器；注册中心仍只做登记与查询，不执行、不构造 Gateway。
 */

export type AdapterRegistrationRejection =
  AdapterRejectionCode | "ADAPTER_ID_DUPLICATED";

export class AdapterRegistrationError extends Error {
  readonly rejection: AdapterRegistrationRejection;
  constructor(rejection: AdapterRegistrationRejection, message: string) {
    super(message);
    this.name = "AdapterRegistrationError";
    this.rejection = rejection;
  }
}

export interface RegisteredAdapter {
  adapter: CodingWorkerAdapter;
  control_mode: AdapterControlMode;
  declaration: AdapterCapabilityDeclaration;
}

export class AdapterRegistry {
  private readonly entries = new Map<string, RegisteredAdapter>();
  /** TASK-W.6：adapter_id → 派工工厂（与 entries 分离，避免改动既有注册项结构） */
  private readonly dispatchFactories = new Map<string, WorkerDispatchFactory>();

  /**
   * 注册适配器。
   *
   * @param controlMode 默认 `GATEWAY_ENFORCED`（严格校验）；
   *   仅当调用方明确声明 `UNCONTROLLED_EXTERNAL` 时放宽。
   */
  register(
    adapter: CodingWorkerAdapter,
    controlMode: AdapterControlMode = "GATEWAY_ENFORCED",
  ): RegisteredAdapter {
    const declaration = adapter.declaration;
    const adapterId = declaration?.adapter_id;

    if (typeof adapterId === "string" && this.entries.has(adapterId)) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_DUPLICATED",
        `adapter already registered: ${adapterId}`,
      );
    }

    const validation = validateAdapterCapability(declaration, controlMode);
    if (!validation.ok) {
      throw new AdapterRegistrationError(
        validation.code,
        `[${validation.code}] adapter ${adapterId ?? "<unknown>"} rejected for ${controlMode}: ${validation.reason}`,
      );
    }

    const entry: RegisteredAdapter = {
      adapter,
      control_mode: controlMode,
      declaration,
    };
    this.entries.set(adapterId, entry);
    return entry;
  }

  get(adapterId: string): RegisteredAdapter | undefined {
    return this.entries.get(adapterId);
  }

  /**
   * TASK-W.6：为已注册适配器挂接派工工厂。
   * 要求该 adapterId 已登记，否则抛 `ADAPTER_ID_INVALID`——不允许给「幽灵 id」挂工厂。
   */
  registerDispatchFactory(
    adapterId: string,
    factory: WorkerDispatchFactory,
  ): void {
    if (!this.entries.has(adapterId)) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_INVALID",
        `cannot attach dispatch factory: adapter not registered: ${adapterId}`,
      );
    }
    this.dispatchFactories.set(adapterId, factory);
  }

  /** TASK-W.6：读取派工工厂；未登记返回 undefined，由 `requireControlledDispatch` 决定错误码 */
  getDispatchFactory(adapterId: string): WorkerDispatchFactory | undefined {
    return this.dispatchFactories.get(adapterId);
  }

  /** 取受控适配器；非受控或不存在时抛错，避免误把外部助手当执行者 */
  requireControlled(adapterId: string): CodingWorkerAdapter {
    const entry = this.entries.get(adapterId);
    if (!entry) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_INVALID",
        `adapter not registered: ${adapterId}`,
      );
    }
    if (entry.control_mode !== "GATEWAY_ENFORCED") {
      throw new AdapterRegistrationError(
        "TOOL_INTERCEPTION_UNSUPPORTED",
        `adapter ${adapterId} is registered as ${entry.control_mode}; it cannot be used for controlled execution`,
      );
    }
    return entry.adapter;
  }

  list(): RegisteredAdapter[] {
    return [...this.entries.values()];
  }

  has(adapterId: string): boolean {
    return this.entries.has(adapterId);
  }

  clear(): void {
    this.entries.clear();
    this.dispatchFactories.clear();
  }
}
