import {
  validateAdapterCapability,
  type AdapterCapabilityDeclaration,
  type AdapterControlMode,
  type AdapterRejectionCode,
  type CodingWorkerAdapter,
} from "./worker-adapter.interface";
import type { WorkerDispatchFactory } from "./worker-dispatch";
import type { WorkerProbeReportSummary } from "./verify/worker-registration";

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
  | "ADAPTER_PROMOTION_REFUSED"
  | "E_PROBE_REPORT_NOT_FOUND"
  | "E_PROBE_REPORT_FINGERPRINT_MISMATCH"
  | "E_PROBE_REPORT_INVALID";

export class AdapterRegistrationError extends Error {
  readonly rejection: AdapterRegistrationRejection;
  constructor(rejection: AdapterRegistrationRejection, message: string) {
    super(message);
    this.name = "AdapterRegistrationError";
    this.rejection = rejection;
  }
}

export interface DispatchFactoryBinding {
  factory: WorkerDispatchFactory;
  protocol_version?: string | undefined;
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
  report_id?: string | undefined;
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
  report_id?: string | undefined;
  report_fingerprint?: string | undefined;
  /** 降级原因（升格时忽略） */
  reason?: string | undefined;
  decided_at?: string | undefined;
}

export class AdapterRegistry {
  private readonly entries = new Map<string, RegisteredAdapter>();
  /** TASK-W.6：adapter_id → 派工工厂（与 entries 分离，避免改动既有注册项结构） */
  private readonly dispatchFactories = new Map<
    string,
    DispatchFactoryBinding
  >();
  /** 由 WorkerRegistrationService 绑定的服务端持久层查询，不接受调用方传入报告对象。 */
  private probeReportLookup:
    | ((reportId: string) =>
        | {
            report: WorkerProbeReportSummary;
            current_adapter_id: string;
            current_fingerprint: string;
          }
        | undefined)
    | undefined;

  bindProbeReportAuthority(
    lookup: (reportId: string) =>
      | {
          report: WorkerProbeReportSummary;
          current_adapter_id: string;
          current_fingerprint: string;
        }
      | undefined,
  ): void {
    this.probeReportLookup = lookup;
  }

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

  /**
   * TASK-W.9c：为已注册项挂接或替换真实执行器（要求与当前注册声明协议版本一致）。
   */
  attachExecutableAdapter(
    adapterId: string,
    adapter: CodingWorkerAdapter,
  ): void {
    const entry = this.entries.get(adapterId);
    if (!entry) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_INVALID",
        `cannot attach executable adapter: adapter not registered: ${adapterId}`,
      );
    }
    const currentVersion = entry.declaration?.protocol_version;
    const adapterVersion = adapter.declaration?.protocol_version;
    if (
      currentVersion !== undefined &&
      adapterVersion !== undefined &&
      currentVersion !== adapterVersion
    ) {
      throw new AdapterRegistrationError(
        "ADAPTER_PROMOTION_REFUSED",
        `adapter version mismatch for ${adapterId}: expected ${currentVersion} but adapter version is ${adapterVersion}`,
      );
    }
    entry.adapter = adapter;
    if (adapter.declaration) {
      entry.declaration = adapter.declaration;
    }
  }

  get(adapterId: string): RegisteredAdapter | undefined {
    return this.entries.get(adapterId);
  }

  /**
   * TASK-W.6 / W.9c：为已注册适配器挂接派工工厂，并强绑定当前协议版本。
   * 要求该 adapterId 已登记，否则抛 `ADAPTER_ID_INVALID`。
   * 若指定了 expectedVersion，要求与当前注册版本的 protocol_version 一致，否则拒绝挂接。
   */
  registerDispatchFactory(
    adapterId: string,
    factory: WorkerDispatchFactory,
    expectedVersion?: string,
  ): void {
    const entry = this.entries.get(adapterId);
    if (!entry) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_INVALID",
        `cannot attach dispatch factory: adapter not registered: ${adapterId}`,
      );
    }
    const currentVersion = entry.declaration?.protocol_version;
    if (
      expectedVersion !== undefined &&
      currentVersion !== undefined &&
      expectedVersion !== currentVersion
    ) {
      throw new AdapterRegistrationError(
        "ADAPTER_PROMOTION_REFUSED",
        `dispatch factory version mismatch for ${adapterId}: expected ${expectedVersion} but registered version is ${currentVersion}`,
      );
    }
    this.dispatchFactories.set(adapterId, {
      factory,
      protocol_version: expectedVersion ?? currentVersion,
    });
  }

  /**
   * TASK-W.6 / W.9c：读取派工工厂；未登记返回 undefined。
   * 若提供 currentVersion 且绑定记录的版本与当前版本不一致，视为已失效，
   * 立即同步清除旧映射（消除窗口期风险）并返回 undefined。
   */
  getDispatchFactory(
    adapterId: string,
    currentVersion?: string,
  ): WorkerDispatchFactory | undefined {
    const binding = this.dispatchFactories.get(adapterId);
    if (!binding) return undefined;
    if (
      currentVersion !== undefined &&
      binding.protocol_version !== undefined &&
      binding.protocol_version !== currentVersion
    ) {
      this.dispatchFactories.delete(adapterId);
      return undefined;
    }
    return binding.factory;
  }

  /**
   * TASK-W.9c：注销适配器，立即同步清除其注册条目与已绑定的派工工厂。
   * 撤销后重新注册时不会继承原有的受控档位（撤销归零）。
   */
  unregister(adapterId: string): boolean {
    const existed =
      this.entries.has(adapterId) || this.dispatchFactories.has(adapterId);
    this.entries.delete(adapterId);
    this.dispatchFactories.delete(adapterId);
    return existed;
  }

  /** TASK-W.9c：撤销注册（unregister 别名，显式表达撤销语义） */
  revoke(adapterId: string): boolean {
    return this.unregister(adapterId);
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
    if (next === "UNCONTROLLED_EXTERNAL") {
      // 降级为非受控档位时，立即同步清理已绑定的受控派工工厂，消除旧工厂残留
      this.dispatchFactories.delete(adapterId);
    }
    if (previous === next) return entry;

    if (next !== "UNCONTROLLED_EXTERNAL") {
      const reportId = request.report_id;
      const fingerprint = request.report_fingerprint;
      const authority = reportId && this.probeReportLookup?.(reportId);
      if (!authority) {
        throw new AdapterRegistrationError(
          "E_PROBE_REPORT_NOT_FOUND",
          `probe report ${reportId ?? "<missing>"} is not present in the server-side worker store`,
        );
      }
      const { report, current_adapter_id, current_fingerprint } = authority;
      if (
        typeof fingerprint !== "string" ||
        fingerprint.trim().length === 0 ||
        report.fingerprint !== fingerprint
      ) {
        throw new AdapterRegistrationError(
          "E_PROBE_REPORT_FINGERPRINT_MISMATCH",
          `probe report fingerprint does not match the server-side report for ${adapterId}`,
        );
      }
      if (
        current_adapter_id !== adapterId ||
        report.adapter_id !== adapterId ||
        report.target_mode !== next ||
        report.status !== "passed" ||
        report.control_mode !== next ||
        report.version_fingerprint !== report.fingerprint ||
        current_fingerprint !== report.fingerprint ||
        (next === "SANDBOX_ENFORCED" &&
          (report.witness === undefined ||
            !report.findings.some(
              (finding) =>
                finding.id === "dispatch_witness" && finding.status === "pass",
            )))
      ) {
        throw new AdapterRegistrationError(
          "E_PROBE_REPORT_INVALID",
          `server-side probe report is failed, stale, mismatched, or missing its required witness for ${adapterId} → ${next}`,
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
      report_id:
        next === "UNCONTROLLED_EXTERNAL" ? undefined : request.report_id,
      report_fingerprint:
        next === "UNCONTROLLED_EXTERNAL"
          ? undefined
          : request.report_fingerprint,
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
