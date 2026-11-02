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
  | AdapterRejectionCode
  | "ADAPTER_ID_DUPLICATED"
  /** TASK-W.7：升格被拒（未附探测报告 / 目标档位能力不达标） */
  | "ADAPTER_PROMOTION_REFUSED";

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
  /** TASK-W.7：最近一次档位变更（升格需附探测报告指纹；降级记原因） */
  last_transition?: AdapterModeTransition | undefined;
}

/** 档位变更记录（审计用；不参与任何判定） */
export interface AdapterModeTransition {
  from: AdapterControlMode;
  to: AdapterControlMode;
  /** 升格时为探测报告指纹；降级时为 undefined */
  report_fingerprint?: string | undefined;
  /** 降级原因 */
  reason?: string | undefined;
  /** 由调用方注入时间，便于测试确定性（缺省不填） */
  decided_at?: string | undefined;
}

/** 升格 / 降级请求参数 */
export interface AdapterModeChangeRequest {
  /**
   * 探测报告指纹（卡正文范围 1「升格唯一的入口是探测通过」）。
   * **升格到受控档位时必填**；降级不需要。
   */
  report_fingerprint?: string | undefined;
  /** 降级原因（升格时忽略） */
  reason?: string | undefined;
  decided_at?: string | undefined;
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

  /**
   * TASK-W.7：**唯一的档位变更入口**（升格 / 降级）。
   *
   * 为什么必须有这个入口而不是「再 register 一次」：`register()` 遇到同 id 直接抛
   * `ADAPTER_ID_DUPLICATED`，注册中心既无升格也无注销 API，于是「探测通过后升格」
   * 这个动作在 W.7 之前**根本不存在**（用户注册进来的适配器只能永远停在非受控档）。
   * 但「能升格」正是「填表即受控」风险的入口，故按单向守卫实现：
   *
   * - 降级（→ `UNCONTROLLED_EXTERNAL`）：**恒允许**，不需要任何证据。安全方向不设闸。
   * - 升格（目标为受控档）：必须同时满足
   *   1. 附 `report_fingerprint`（探测确有报告，且由服务层绑定适配器指纹）；
   *   2. 重新跑 `validateAdapterCapability(declaration, next)` ——注册时的校验结果
   *      **不得**被复用为升格依据（注册期只按标识档校验过）。
   * - 同档位重复调用：幂等返回，不抛错（避免重试导致状态机抖动）。
   *
   * 注意本方法**只改档位**，不校验探测内容真伪——"报告是否对应本次版本"由
   * `worker-registration.ts::effectiveControlMode()` 在读侧重算指纹兜底，
   * 两条防线分工不同：这里防「无报告就升格」，那里防「手改文件 / 换版本后仍记受控」。
   */
  promoteControlMode(
    adapterId: string,
    next: AdapterControlMode,
    request: AdapterModeChangeRequest = {},
  ): RegisteredAdapter {
    const entry = this.entries.get(adapterId);
    if (!entry) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_INVALID",
        `cannot change control mode: adapter not registered: ${adapterId}`,
      );
    }
    const previous = entry.control_mode;
    if (previous === next) return entry;

    if (next !== "UNCONTROLLED_EXTERNAL") {
      const fingerprint = request.report_fingerprint;
      if (typeof fingerprint !== "string" || fingerprint.trim().length === 0) {
        throw new AdapterRegistrationError(
          "ADAPTER_PROMOTION_REFUSED",
          `refusing to promote ${adapterId} (${previous} → ${next}) without a probe report fingerprint; promotion requires a passed probe pack`,
        );
      }
      const validation = validateAdapterCapability(entry.declaration, next);
      if (!validation.ok) {
        throw new AdapterRegistrationError(
          validation.code,
          `[${validation.code}] ${adapterId} cannot be promoted to ${next}: ${validation.reason}`,
        );
      }
    }

    entry.control_mode = next;
    entry.last_transition = {
      from: previous,
      to: next,
      report_fingerprint:
        next === "UNCONTROLLED_EXTERNAL" ? undefined : request.report_fingerprint,
      reason: request.reason,
      decided_at: request.decided_at,
    };
    return entry;
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
